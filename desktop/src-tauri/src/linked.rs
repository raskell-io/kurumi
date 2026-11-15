//! Linked folder vaults for the desktop app: a folder of Markdown notes that
//! Kurumi reads where it lies, instead of keeping its own copy.
//!
//! The web side (src/lib/linked/) opens a vault with `linked_open`, which
//! scans a folder the user picked in the system dialog (folders.rs) and
//! returns its notes, and re-reads single notes with `linked_read`. Nothing
//! here writes to the folder. What a scan leaves out, `linked_read` refuses:
//! hidden entries, the vault's ignore patterns, `.gitignore` if asked, files
//! that aren't Markdown and anything that resolves outside the folder.
//!
//! Errors are strings starting with a DOMException name, as in folders.rs.

use crate::folders::{io_error, modified_ms, not_found, type_mismatch, Folders};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::{Match, WalkBuilder};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fmt::Write;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

/// Larger Markdown files are counted as skipped, not loaded.
const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

/// The open linked vaults, by the vault id the web side chose.
#[derive(Default)]
pub struct Linked {
    vaults: Mutex<HashMap<String, Arc<Vault>>>,
}

impl Linked {
    fn get(&self, vault: &str) -> Result<Arc<Vault>, String> {
        let vaults = self.vaults.lock().unwrap();
        vaults.get(vault).cloned().ok_or_else(|| format!("InvalidStateError: the linked folder {vault} isn't open"))
    }
}

struct Vault {
    /// A picked folder, canonical.
    root: PathBuf,
    rules: Rules,
    /// Kept for the write commands, which will refuse such a vault.
    #[allow(dead_code)]
    read_only: bool,
}

/// What a vault leaves out, besides hidden entries.
#[derive(Clone)]
struct Rules {
    /// The vault's own patterns, in .gitignore syntax, relative to the root.
    patterns: Gitignore,
    respect_gitignore: bool,
}

impl Rules {
    fn new(root: &Path, patterns: &[String], respect_gitignore: bool) -> Result<Self, String> {
        let mut builder = GitignoreBuilder::new(root);
        for line in patterns {
            builder.add_line(None, line).map_err(|e| format!("SyntaxError: ignore pattern {line:?}: {e}"))?;
        }
        let patterns = builder.build().map_err(|e| format!("SyntaxError: ignore patterns: {e}"))?;
        Ok(Rules { patterns, respect_gitignore })
    }

    /// Whether the scan would leave out the file at `parts` below `root`:
    /// the same decisions as the walk in `scan`, for one path. Like git, an
    /// excluded directory excludes everything in it.
    fn ignores(&self, root: &Path, parts: &[&str]) -> bool {
        let mut path = root.to_path_buf();
        // The .gitignore of each directory on the way down, root first.
        let mut gitignores: Vec<Option<Gitignore>> = Vec::new();
        for (i, part) in parts.iter().enumerate() {
            if self.respect_gitignore {
                let file = path.join(".gitignore");
                gitignores.push(file.is_file().then(|| Gitignore::new(&file).0));
            }
            path.push(part);
            let is_dir = i + 1 < parts.len();
            if part.starts_with('.') || self.patterns.matched(&path, is_dir).is_ignore() {
                return true;
            }
            // The nearest .gitignore with an opinion decides.
            for gitignore in gitignores.iter().rev().flatten() {
                match gitignore.matched(&path, is_dir) {
                    Match::Ignore(_) => return true,
                    Match::Whitelist(_) => break,
                    Match::None => {}
                }
            }
        }
        false
    }
}

#[derive(Serialize, Debug)]
pub struct NoteFile {
    /// Relative to the vault's root, `/`-separated.
    rel: String,
    /// The file's text as it is on disk: line endings and a BOM are kept.
    content: String,
    /// SHA-256 of the file's bytes, in hex.
    hash: String,
    /// Milliseconds since the epoch, like File.lastModified.
    mtime: f64,
    /// In bytes.
    size: u64,
}

#[derive(Serialize, Debug)]
pub struct Opened {
    /// Where the vault's change log starts; nothing is watched yet, so 0.
    cursor: u64,
    notes: Vec<NoteFile>,
    /// Every directory with a note in or below it, relative like `rel`.
    dirs: Vec<String>,
    /// Markdown files left out: over 2 MB, not UTF-8 or unreadable.
    skipped: u64,
}

struct Scan {
    notes: Vec<NoteFile>,
    dirs: Vec<String>,
    skipped: u64,
}

fn is_markdown(name: &str) -> bool {
    // As MARKDOWN_FILE in src/lib/sync/local-fs.ts.
    name.rsplit_once('.').is_some_and(|(_, ext)| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().fold(String::with_capacity(64), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

/// `path` below `root` as a `/`-separated string; None for names that aren't
/// Unicode, which the web side couldn't ask for again.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.strip_prefix(root).ok()?.components() {
        match component {
            Component::Normal(name) => parts.push(name.to_str()?),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// The parts of a `rel` from the web side. Only plain names get through: no
/// absolute path, drive, `..`, `.` or empty part.
fn rel_parts(rel: &str) -> Result<Vec<&str>, String> {
    let plain = |part: &&str| {
        let mut components = Path::new(part).components();
        matches!((components.next(), components.next()), (Some(Component::Normal(name)), None) if name == *part)
    };
    let parts: Vec<&str> = rel.split('/').collect();
    if Path::new(rel).is_absolute() || !parts.iter().all(plain) {
        return Err(format!("NotAllowedError: {rel:?} is not a path inside the linked folder"));
    }
    Ok(parts)
}

/// Reads one note. The caller has checked that `path` may be read.
fn load(path: &Path, rel: String) -> Result<NoteFile, String> {
    let missing = |e: std::io::Error| if e.kind() == ErrorKind::NotFound { not_found(path) } else { io_error(e) };
    let too_large = || format!("NotReadableError: {} is larger than 2 MB", path.display());
    // Follows symlinks, like the walk.
    let meta = fs::metadata(path).map_err(missing)?;
    if meta.is_dir() {
        return Err(type_mismatch(path));
    }
    if meta.len() > MAX_NOTE_BYTES {
        return Err(too_large());
    }
    let bytes = fs::read(path).map_err(missing)?;
    let size = bytes.len() as u64;
    if size > MAX_NOTE_BYTES {
        return Err(too_large());
    }
    let hash = hex_sha256(&bytes);
    let content =
        String::from_utf8(bytes).map_err(|_| format!("NotReadableError: {} is not UTF-8 text", path.display()))?;
    Ok(NoteFile { rel, content, hash, mtime: modified_ms(&meta), size })
}

/// Every Markdown note below `root` (canonical) that `rules` let through.
fn scan(root: &Path, rules: &Rules) -> Scan {
    let mut builder = WalkBuilder::new(root);
    builder
        // Only what a vault asks for: not the user's global gitignore,
        // .ignore files or ignore files above the root.
        .standard_filters(false)
        .hidden(true)
        .git_ignore(rules.respect_gitignore)
        // A folder needn't be a repository for its .gitignore to count.
        .require_git(false)
        .follow_links(true);
    let (walk_root, walk_rules) = (root.to_path_buf(), rules.clone());
    builder.filter_entry(move |entry| {
        if entry.depth() == 0 {
            return true;
        }
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        if walk_rules.patterns.matched(entry.path(), is_dir).is_ignore() {
            return false;
        }
        // Symlinks are followed only while they stay inside the folder.
        !entry.path_is_symlink() || entry.path().canonicalize().is_ok_and(|p| p.starts_with(&walk_root))
    });

    let mut notes = Vec::new();
    let mut dirs = BTreeSet::new();
    let mut skipped = 0;
    // Unreadable directories and symlink loops come as errors: left out.
    for entry in builder.build().flatten() {
        let name = entry.file_name().to_string_lossy();
        if !entry.file_type().is_some_and(|t| t.is_file()) || !is_markdown(&name) {
            continue;
        }
        let Some(note) = relative(root, entry.path()).and_then(|rel| load(entry.path(), rel).ok()) else {
            skipped += 1;
            continue;
        };
        let mut dir = note.rel.as_str();
        while let Some((parent, _)) = dir.rsplit_once('/') {
            if !dirs.insert(parent.to_owned()) {
                break;
            }
            dir = parent;
        }
        notes.push(note);
    }
    notes.sort_by(|a, b| a.rel.cmp(&b.rel));
    Scan { notes, dirs: dirs.into_iter().collect(), skipped }
}

/// Linked folders need the folder dialog, which phones don't have.
#[cfg(desktop)]
fn available() -> Result<(), String> {
    Ok(())
}

#[cfg(mobile)]
fn available() -> Result<(), String> {
    Err("NotSupportedError: Linked folders aren't available in the phone app yet.".into())
}

fn open(
    folders: &Folders,
    linked: &Linked,
    vault: &str,
    root: &str,
    patterns: &[String],
    respect_gitignore: bool,
    read_only: bool,
) -> Result<Opened, String> {
    // A picked folder that is gone (an unplugged disk) is missing, not forbidden.
    if folders.is_root(Path::new(root)) && !Path::new(root).is_dir() {
        return Err(not_found(Path::new(root)));
    }
    let root = folders.authorize(root)?;
    // A picked folder itself: nothing typed, and no folder inside one.
    if !folders.is_root(&root) {
        return Err(format!("NotAllowedError: {} is not a folder you picked", root.display()));
    }
    let rules = Rules::new(&root, patterns, respect_gitignore)?;
    let Scan { notes, dirs, skipped } = scan(&root, &rules);
    linked.vaults.lock().unwrap().insert(vault.to_owned(), Arc::new(Vault { root, rules, read_only }));
    Ok(Opened { cursor: 0, notes, dirs, skipped })
}

fn read(folders: &Folders, linked: &Linked, vault: &str, rel: &str) -> Result<NoteFile, String> {
    let vault = linked.get(vault)?;
    let parts = rel_parts(rel)?;
    if !parts.last().is_some_and(|name| is_markdown(name)) {
        return Err(format!("NotAllowedError: {rel:?} is not a Markdown file"));
    }
    if vault.rules.ignores(&vault.root, &parts) {
        return Err(format!("NotAllowedError: {rel:?} is excluded by the linked folder's ignore rules"));
    }
    let path = parts.iter().fold(vault.root.clone(), |path, part| path.join(part));
    // Also refuses a symlink that leads out of the folder.
    let path = folders.authorize(&path.to_string_lossy())?;
    load(&path, rel.to_owned())
}

/// Scans a picked folder and remembers it under `vault`; opening the same
/// vault again rescans and replaces what was remembered.
#[tauri::command(async)]
pub fn linked_open(
    vault: String,
    root: String,
    ignore: Vec<String>,
    respect_gitignore: bool,
    read_only: bool,
    folders: State<'_, Folders>,
    linked: State<'_, Linked>,
) -> Result<Opened, String> {
    available()?;
    open(&folders, &linked, &vault, &root, &ignore, respect_gitignore, read_only)
}

/// One note of an open vault, as it is on disk now.
#[tauri::command(async)]
pub fn linked_read(
    vault: String,
    rel: String,
    folders: State<'_, Folders>,
    linked: State<'_, Linked>,
) -> Result<NoteFile, String> {
    available()?;
    read(&folders, &linked, &vault, &rel)
}

/// Forgets the vault; fine if it wasn't open.
#[tauri::command]
pub fn linked_close(vault: String, linked: State<'_, Linked>) {
    linked.vaults.lock().unwrap().remove(&vault);
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: &str = "lf.test";

    fn setup() -> (tempfile::TempDir, Folders, Linked, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let folders = Folders::with_roots(vec![root.clone()]);
        (tmp, folders, Linked::default(), root)
    }

    fn put(root: &Path, rel: &str, bytes: impl AsRef<[u8]>) {
        let path = rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn open_with(folders: &Folders, linked: &Linked, root: &Path, patterns: &[&str], respect_gitignore: bool) -> Opened {
        let patterns: Vec<String> = patterns.iter().map(|p| p.to_string()).collect();
        open(folders, linked, VAULT, &root.to_string_lossy(), &patterns, respect_gitignore, true).unwrap()
    }

    fn rels(opened: &Opened) -> Vec<&str> {
        opened.notes.iter().map(|n| n.rel.as_str()).collect()
    }

    fn refused(result: Result<NoteFile, String>, name: &str) {
        let error = result.unwrap_err();
        assert!(error.starts_with(name), "expected {name}, got {error}");
    }

    #[test]
    fn scan_returns_markdown_notes_and_their_directories() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        put(&root, "notes/b.markdown", "b");
        put(&root, "notes/deep/er/c.MD", "c");
        put(&root, "notes/deep/pic.png", [0xff, 0xd8]);
        put(&root, "other/readme.txt", "no");
        put(&root, ".obsidian/workspace.md", "hidden directory");
        put(&root, ".git/info/notes.md", "hidden directory");
        put(&root, "notes/.draft.md", "hidden file");
        fs::create_dir(root.join("empty")).unwrap();

        let opened = open_with(&folders, &linked, &root, &[], true);
        assert_eq!(rels(&opened), ["a.md", "notes/b.markdown", "notes/deep/er/c.MD"]);
        assert_eq!(opened.dirs, ["notes", "notes/deep", "notes/deep/er"]);
        assert_eq!((opened.skipped, opened.cursor), (0, 0));
        assert!(opened.notes.iter().all(|n| !n.rel.contains('\\')));

        refused(read(&folders, &linked, VAULT, ".obsidian/workspace.md"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, ".git/info/notes.md"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "notes/.draft.md"), "NotAllowedError");
    }

    #[test]
    fn scan_honours_the_vaults_ignore_patterns() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "keep.md", "");
        put(&root, "top.md", "");
        put(&root, "sub/top.md", "");
        put(&root, "sub/a.tmp.md", "");
        put(&root, "drafts/x.md", "");
        put(&root, "sub/drafts/y.md", "");
        put(&root, "templates/t.md", "");
        put(&root, "templates/keep.md", "");

        let patterns = ["drafts/", "*.tmp.md", "/top.md", "templates/*", "!templates/keep.md"];
        let opened = open_with(&folders, &linked, &root, &patterns, true);
        assert_eq!(rels(&opened), ["keep.md", "sub/top.md", "templates/keep.md"]);
        assert_eq!(opened.dirs, ["sub", "templates"]);
        assert_eq!(opened.skipped, 0, "ignored files aren't counted as skipped");

        assert!(read(&folders, &linked, VAULT, "templates/keep.md").is_ok());
        for rel in ["top.md", "sub/a.tmp.md", "drafts/x.md", "sub/drafts/y.md", "templates/t.md"] {
            refused(read(&folders, &linked, VAULT, rel), "NotAllowedError");
        }
    }

    #[test]
    fn scan_honours_gitignore_only_when_asked() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, ".gitignore", "build/\nsecret.md\n*.log.md\n");
        put(&root, "sub/.gitignore", "!secret.md\nlocal.md\n");
        put(&root, "ok.md", "");
        put(&root, "secret.md", "");
        put(&root, "run.log.md", "");
        put(&root, "build/out.md", "");
        put(&root, "sub/secret.md", "");
        put(&root, "sub/local.md", "");
        put(&root, "sub/build/deep.md", "");
        let all = ["build/out.md", "ok.md", "run.log.md", "secret.md", "sub/build/deep.md", "sub/local.md", "sub/secret.md"];

        let opened = open_with(&folders, &linked, &root, &[], true);
        assert_eq!(rels(&opened), ["ok.md", "sub/secret.md"]);
        assert_eq!(opened.dirs, ["sub"]);
        // linked_read decides like the scan.
        for rel in all {
            assert_eq!(read(&folders, &linked, VAULT, rel).is_ok(), rels(&opened).contains(&rel), "{rel}");
        }

        let opened = open_with(&folders, &linked, &root, &[], false);
        assert_eq!(rels(&opened), all);
        assert_eq!(opened.dirs, ["build", "sub", "sub/build"]);
        for rel in all {
            assert!(read(&folders, &linked, VAULT, rel).is_ok(), "{rel}");
        }
    }

    #[test]
    fn oversized_and_non_utf8_notes_are_counted_not_returned() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "fits.md", vec![b'a'; MAX_NOTE_BYTES as usize]);
        put(&root, "big.md", vec![b'a'; MAX_NOTE_BYTES as usize + 1]);
        put(&root, "latin1.md", [b'c', b'a', b'f', 0xe9]);
        put(&root, "sub/utf16.markdown", [0xff, 0xfe, b'a', 0x00]);
        put(&root, "sub/image.png", [0xff, 0xd8, 0xff]);

        let opened = open_with(&folders, &linked, &root, &[], true);
        assert_eq!(rels(&opened), ["fits.md"]);
        assert_eq!(opened.notes[0].size, MAX_NOTE_BYTES);
        assert_eq!(opened.skipped, 3);
        assert!(opened.dirs.is_empty(), "a directory with only skipped files isn't listed");

        refused(read(&folders, &linked, VAULT, "big.md"), "NotReadableError");
        refused(read(&folders, &linked, VAULT, "latin1.md"), "NotReadableError");
    }

    #[test]
    fn content_is_returned_unmodified_with_the_hash_of_its_bytes() {
        let (_tmp, folders, linked, root) = setup();
        let text = "\u{feff}---\r\ntitle: Ünïcode\r\n---\r\n\r\nbody without a final newline";
        put(&root, "abc.md", "abc");
        put(&root, "empty.md", "");
        put(&root, "windows.md", text);

        let opened = open_with(&folders, &linked, &root, &[], true);
        let [abc, empty, windows] = opened.notes.as_slice() else { panic!("three notes") };
        // The published test vectors for SHA-256.
        assert_eq!(abc.hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(empty.hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!((empty.content.as_str(), empty.size), ("", 0));
        assert_eq!(windows.content, text);
        assert_eq!(windows.content.as_bytes(), fs::read(root.join("windows.md")).unwrap());
        assert_eq!(windows.hash, hex_sha256(text.as_bytes()));
        assert_eq!(windows.size, text.len() as u64);
        assert!(windows.mtime > 0.0);

        let again = read(&folders, &linked, VAULT, "windows.md").unwrap();
        assert_eq!((again.rel.as_str(), &again.content, &again.hash), ("windows.md", &windows.content, &windows.hash));
        assert_eq!((again.size, again.mtime), (windows.size, windows.mtime));

        // A fresh read: what's on disk now, not what the scan saw.
        put(&root, "abc.md", "abcd");
        assert_eq!(read(&folders, &linked, VAULT, "abc.md").unwrap().content, "abcd");
    }

    #[test]
    fn read_refuses_paths_that_are_not_notes_of_the_vault() {
        let (tmp, folders, linked, root) = setup();
        put(tmp.path(), "secret.md", "outside");
        put(&root, "a.md", "a");
        put(&root, "a.txt", "text");
        put(&root, "notes/b.md", "b");
        put(&root, "private/c.md", "c");
        fs::create_dir(root.join("folder.md")).unwrap();
        open_with(&folders, &linked, &root, &["private/"], true);

        assert_eq!(read(&folders, &linked, VAULT, "notes/b.md").unwrap().content, "b");
        let absolute = root.join("a.md").to_string_lossy().into_owned();
        for rel in ["..", "../secret.md", "notes/../a.md", "notes/../../secret.md", ".", "./a.md", "notes/./b.md"] {
            refused(read(&folders, &linked, VAULT, rel), "NotAllowedError");
        }
        for rel in ["", "/a.md", "notes//b.md", "notes/", absolute.as_str(), "\\a.md", "C:\\a.md", "C:a.md"] {
            assert!(read(&folders, &linked, VAULT, rel).is_err(), "{rel}");
        }
        refused(read(&folders, &linked, VAULT, absolute.as_str()), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "/a.md"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "private/c.md"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "a.txt"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "notes"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "missing.md"), "NotFoundError");
        refused(read(&folders, &linked, VAULT, "folder.md"), "TypeMismatchError");
        refused(read(&folders, &linked, "lf.other", "a.md"), "InvalidStateError");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_followed_only_inside_the_folder() {
        use std::os::unix::fs::symlink;
        let (tmp, folders, linked, root) = setup();
        put(tmp.path(), "outside/secret.md", "outside");
        put(&root, "notes/a.md", "a");
        symlink(tmp.path().join("outside"), root.join("out")).unwrap();
        symlink(tmp.path().join("outside").join("secret.md"), root.join("leak.md")).unwrap();
        symlink(root.join("notes"), root.join("alias")).unwrap();
        symlink(root.join("gone.md"), root.join("broken.md")).unwrap();
        symlink(&root, root.join("notes").join("loop")).unwrap();

        let opened = open_with(&folders, &linked, &root, &[], true);
        assert_eq!(rels(&opened), ["alias/a.md", "notes/a.md"]);
        assert_eq!(opened.dirs, ["alias", "notes"]);
        assert_eq!(opened.skipped, 0);

        assert_eq!(read(&folders, &linked, VAULT, "alias/a.md").unwrap().content, "a");
        refused(read(&folders, &linked, VAULT, "leak.md"), "NotAllowedError");
        refused(read(&folders, &linked, VAULT, "out/secret.md"), "NotAllowedError");
    }

    #[test]
    fn only_a_picked_folder_can_be_opened() {
        let (tmp, folders, linked, root) = setup();
        put(tmp.path(), "other/a.md", "a");
        put(&root, "notes/b.md", "b");
        let try_open = |path: &Path| open(&folders, &linked, VAULT, &path.to_string_lossy(), &[], true, true);

        let other = tmp.path().join("other").canonicalize().unwrap();
        assert!(try_open(&other).unwrap_err().starts_with("NotAllowedError"));
        // Inside a picked folder isn't enough: fs_* may reach it, a vault may not start there.
        assert!(try_open(&root.join("notes")).unwrap_err().starts_with("NotAllowedError"));
        assert!(try_open(&root.join("..").join("other")).unwrap_err().starts_with("NotAllowedError"));
        assert!(try_open(Path::new("vault")).unwrap_err().starts_with("NotAllowedError"));
        refused(read(&folders, &linked, VAULT, "notes/b.md"), "InvalidStateError");

        assert_eq!(rels(&try_open(&root).unwrap()), ["notes/b.md"]);
    }

    #[test]
    fn a_picked_folder_that_is_gone_is_not_found() {
        let (_tmp, folders, linked, root) = setup();
        fs::remove_dir(&root).unwrap();
        let error = open(&folders, &linked, VAULT, &root.to_string_lossy(), &[], true, true).unwrap_err();
        assert!(error.starts_with("NotFoundError"), "{error}");
    }

    #[test]
    fn reopening_replaces_the_vault_and_closing_forgets_it() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        put(&root, "drafts/b.md", "b");

        assert_eq!(rels(&open_with(&folders, &linked, &root, &["drafts/"], true)), ["a.md"]);
        refused(read(&folders, &linked, VAULT, "drafts/b.md"), "NotAllowedError");
        // The same vault again: a rescan under the new rules, still one vault.
        assert_eq!(rels(&open_with(&folders, &linked, &root, &[], true)), ["a.md", "drafts/b.md"]);
        assert!(read(&folders, &linked, VAULT, "drafts/b.md").is_ok());
        assert_eq!(linked.vaults.lock().unwrap().len(), 1);
        assert!(linked.get(VAULT).unwrap().read_only);

        linked.vaults.lock().unwrap().remove(VAULT);
        refused(read(&folders, &linked, VAULT, "a.md"), "InvalidStateError");
    }

    #[test]
    fn the_web_side_gets_the_field_names_it_expects() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "notes/a.md", "a");
        let json = serde_json::to_value(open_with(&folders, &linked, &root, &[], true)).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["cursor", "dirs", "notes", "skipped"]);
        assert_eq!(json["cursor"], 0);
        assert_eq!(json["dirs"], serde_json::json!(["notes"]));
        let mut keys: Vec<&str> = json["notes"][0].as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["content", "hash", "mtime", "rel", "size"]);
    }
}
