//! Linked folder vaults for the desktop app: a folder of Markdown notes that
//! Kurumi reads where it lies, instead of keeping its own copy.
//!
//! The web side (src/lib/linked/) opens a vault with `linked_open`, which
//! scans a folder the user picked in the system dialog (folders.rs), returns
//! its notes and starts watching it. What changes in the folder afterwards is
//! kept in a log per vault, which `linked_changes` hands out as a long poll.
//! `linked_read` re-reads one note. Nothing here writes to the folder.
//!
//! What a scan leaves out, `linked_read` refuses and the watcher doesn't
//! report: hidden entries, the vault's ignore patterns, `.gitignore` if
//! asked, files that aren't Markdown and anything that resolves outside the
//! folder.
//!
//! Errors are strings starting with a DOMException name, as in folders.rs.

use crate::folders::{io_error, modified_ms, not_found, type_mismatch, Folders};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::{Match, WalkBuilder};
use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, NoCache};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::fmt::Write as _;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::sync::watch;

/// Larger Markdown files are counted as skipped, not loaded.
const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;
/// How long the watcher waits for a path to settle before reporting it.
const DEBOUNCE: Duration = Duration::from_millis(300);
/// Without a watcher the folder is compared with what's known this often.
const POLL_EVERY: Duration = Duration::from_secs(5);
/// How long `linked_changes` waits for something to report.
const LONG_POLL: Duration = Duration::from_secs(25);
/// More changes than this at once (a `git pull`) are reported as "rescan".
const BURST: usize = 500;
/// The change log keeps this many entries and about this much note text.
const LOG_ENTRIES: usize = 5000;
const LOG_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy)]
struct Timing {
    /// Use the system's file events; false goes straight to polling.
    events: bool,
    debounce: Duration,
    poll_every: Duration,
}

/// The open linked vaults, by the vault id the web side chose.
pub struct Linked {
    vaults: Mutex<HashMap<String, Arc<Vault>>>,
    /// Counts opens, so that no two logs share a cursor (see `open`).
    opens: AtomicU64,
    timing: Timing,
}

impl Default for Linked {
    fn default() -> Self {
        Linked::with(Timing { events: true, debounce: DEBOUNCE, poll_every: POLL_EVERY })
    }
}

impl Linked {
    fn with(timing: Timing) -> Self {
        Linked { vaults: Mutex::new(HashMap::new()), opens: AtomicU64::new(0), timing }
    }

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
    /// What the web side knows of the folder. Held while the folder is
    /// scanned or a watcher batch is worked through, so those happen one
    /// at a time per vault.
    index: Mutex<Index>,
    log: Mutex<Log>,
    /// Wakes the long polls.
    signal: watch::Sender<Signal>,
    watcher: Mutex<Option<Watcher>>,
}

#[derive(Clone, Copy)]
struct Signal {
    /// The cursor after the newest change.
    head: u64,
    /// Closed, or replaced by opening the vault again.
    closed: bool,
}

/// Dropping it stops the watching.
enum Watcher {
    Events(#[allow(dead_code)] Box<Debouncer<RecommendedWatcher, NoCache>>),
    Polling(#[allow(dead_code)] mpsc::Sender<()>),
}

/// How a vault learns of changes in its folder.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WatchMode {
    /// The system's file events: changes show up within a second.
    Events,
    /// The watcher couldn't start (too many folders for inotify, some
    /// network shares): the folder is compared every few seconds instead.
    Polling,
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

    /// Whether the scan would leave out the entry at `parts` below `root`
    /// (`is_dir`: whether the last part is a directory): the same decisions
    /// as the walk in `walk`, for one path. Like git, an excluded directory
    /// excludes everything in it.
    fn ignores(&self, root: &Path, parts: &[&str], is_dir: bool) -> bool {
        let mut path = root.to_path_buf();
        // The .gitignore of each directory on the way down, root first.
        let mut gitignores: Vec<Option<Gitignore>> = Vec::new();
        for (i, part) in parts.iter().enumerate() {
            if self.respect_gitignore {
                let file = path.join(".gitignore");
                gitignores.push(file.is_file().then(|| Gitignore::new(&file).0));
            }
            path.push(part);
            let is_dir = is_dir || i + 1 < parts.len();
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

#[derive(Serialize, Clone, Debug)]
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
    /// Where to start asking `linked_changes`.
    cursor: u64,
    notes: Vec<NoteFile>,
    /// Every directory with a note in or below it, relative like `rel`.
    dirs: Vec<String>,
    /// Markdown files left out: over 2 MB, not UTF-8 or unreadable.
    skipped: u64,
    watch: WatchMode,
}

/// `{ "type": "upsert", "note": NoteFile }` for a note that is new or has
/// other content, `{ "type": "remove", "rel": "…" }` for one that is gone
/// (deleted, renamed away, now ignored or no longer readable as a note).
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Change {
    Upsert { note: NoteFile },
    Remove { rel: String },
}

impl Change {
    fn weight(&self) -> usize {
        match self {
            Change::Upsert { note } => note.content.len(),
            Change::Remove { .. } => 0,
        }
    }
}

#[derive(Serialize, Debug)]
pub struct Changes {
    /// What to pass to the next `linked_changes`.
    cursor: u64,
    /// In the order they were noticed; empty when the wait ran out.
    changes: Vec<Change>,
    /// Too much changed, or the cursor is not of this log: the changes
    /// can't be listed, call `linked_open` again.
    rescan: bool,
}

/// The newest changes of a vault. A cursor is the number of a change: the
/// log's first plus its place in `entries`.
struct Log {
    first: u64,
    entries: VecDeque<Change>,
    bytes: usize,
}

impl Log {
    fn head(&self) -> u64 {
        self.first + self.entries.len() as u64
    }

    fn push(&mut self, change: Change) {
        self.bytes += change.weight();
        self.entries.push_back(change);
        while self.entries.len() > LOG_ENTRIES || (self.bytes > LOG_BYTES && self.entries.len() > 1) {
            if let Some(dropped) = self.entries.pop_front() {
                self.bytes -= dropped.weight();
                self.first += 1;
            }
        }
    }

    /// Leaves every cursor handed out so far behind the log.
    fn reset(&mut self) {
        self.first = self.head() + 1;
        self.entries.clear();
        self.bytes = 0;
    }

    fn since(&self, cursor: u64) -> Changes {
        if cursor < self.first || cursor > self.head() {
            return Changes { cursor: self.head(), changes: Vec::new(), rescan: true };
        }
        let changes = self.entries.iter().skip((cursor - self.first) as usize).cloned().collect();
        Changes { cursor: self.head(), changes, rescan: false }
    }
}

/// A Markdown file as the web side last heard of it.
struct Stamp {
    /// None: not a note (too large, not UTF-8), so the web side doesn't have it.
    hash: Option<String>,
    mtime: f64,
    size: u64,
}

/// The Markdown files of a vault by `rel`. Changes are told by comparing
/// with it, by content: a file that hashes to what is here is not news,
/// so a save that changes nothing isn't reported.
#[derive(Default)]
struct Index(HashMap<String, Stamp>);

impl Index {
    /// Takes in a fresh read of the file at `rel`; the change, if it is one.
    fn settle(&mut self, rel: &str, loaded: Result<NoteFile, String>, mtime: f64, size: u64) -> Option<Change> {
        let known = self.0.get(rel).and_then(|stamp| stamp.hash.as_deref());
        match loaded {
            Ok(note) => {
                let news = known != Some(note.hash.as_str());
                self.0.insert(rel.to_owned(), Stamp { hash: Some(note.hash.clone()), mtime: note.mtime, size: note.size });
                news.then_some(Change::Upsert { note })
            }
            Err(_) => {
                let was_note = known.is_some();
                self.0.insert(rel.to_owned(), Stamp { hash: None, mtime, size });
                was_note.then(|| Change::Remove { rel: rel.to_owned() })
            }
        }
    }

    /// `rel` is gone, with everything below it if it was a directory.
    fn forget(&mut self, rel: &str) -> Vec<Change> {
        let below = format!("{rel}/");
        let mut gone: Vec<String> = self.0.keys().filter(|k| *k == rel || k.starts_with(&below)).cloned().collect();
        gone.sort();
        gone.retain(|rel| self.0.remove(rel).is_some_and(|stamp| stamp.hash.is_some()));
        gone.into_iter().map(|rel| Change::Remove { rel }).collect()
    }
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

/// mtime and size, following symlinks; None if there's nothing there.
fn stat(path: &Path) -> Option<(f64, u64)> {
    fs::metadata(path).ok().map(|meta| (modified_ms(&meta), meta.len()))
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

/// The Markdown files below `root` (canonical) that `rules` let through,
/// with their `rel`, and how many have a name that can't be one.
fn walk(root: &Path, rules: &Rules) -> (Vec<(PathBuf, String)>, u64) {
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

    let mut files = Vec::new();
    let mut unnamed = 0;
    // Unreadable directories and symlink loops come as errors: left out.
    for entry in builder.build().flatten() {
        let name = entry.file_name().to_string_lossy();
        if !entry.file_type().is_some_and(|t| t.is_file()) || !is_markdown(&name) {
            continue;
        }
        match relative(root, entry.path()) {
            Some(rel) => files.push((entry.into_path(), rel)),
            None => unnamed += 1,
        }
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    (files, unnamed)
}

/// Every note below `root`, and into `index` what was found.
fn scan(root: &Path, rules: &Rules, index: &mut Index) -> Scan {
    let (files, mut skipped) = walk(root, rules);
    let mut notes = Vec::new();
    let mut dirs = BTreeSet::new();
    index.0.clear();
    for (path, rel) in files {
        let (mtime, size) = stat(&path).unwrap_or_default();
        let Some(Change::Upsert { note }) = index.settle(&rel, load(&path, rel.clone()), mtime, size) else {
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
    Scan { notes, dirs: dirs.into_iter().collect(), skipped }
}

impl Vault {
    /// Puts changes in the log and wakes the long polls; more than a burst
    /// are not listed.
    fn publish(&self, changes: Vec<Change>) {
        if changes.is_empty() {
            return;
        }
        let head = {
            let mut log = self.log.lock().unwrap();
            if changes.len() > BURST {
                log.reset();
            } else {
                changes.into_iter().for_each(|change| log.push(change));
            }
            log.head()
        };
        self.signal.send_modify(|signal| signal.head = head);
    }

    /// Tells the web side to scan again instead of listing changes.
    fn ask_for_rescan(&self) {
        let head = {
            let mut log = self.log.lock().unwrap();
            log.reset();
            log.head()
        };
        self.signal.send_modify(|signal| signal.head = head);
    }

    /// Stops watching and lets waiting long polls go.
    fn stop(&self) {
        self.watcher.lock().unwrap().take();
        self.signal.send_modify(|signal| signal.closed = true);
    }

    /// Compares the whole folder with the index: files are read only if
    /// their time or size differs, then told apart by hash.
    fn resync(&self, index: &mut Index) -> Vec<Change> {
        let mut gone: HashSet<String> = index.0.keys().cloned().collect();
        let mut upserts = Vec::new();
        for (path, rel) in walk(&self.root, &self.rules).0 {
            let Some((mtime, size)) = stat(&path) else { continue };
            gone.remove(&rel);
            if index.0.get(&rel).is_some_and(|stamp| stamp.mtime == mtime && stamp.size == size) {
                continue;
            }
            upserts.extend(index.settle(&rel, load(&path, rel.clone()), mtime, size));
        }
        let mut gone: Vec<String> = gone.into_iter().collect();
        gone.sort();
        let mut changes: Vec<Change> = gone.iter().flat_map(|rel| index.forget(rel)).collect();
        changes.append(&mut upserts);
        changes
    }

    /// Looks at one path the watcher reported, whatever happened to it.
    fn refresh(&self, index: &mut Index, path: &Path, rel: &str) -> Vec<Change> {
        // A symlink that now leads out of the folder counts as gone.
        let inside = path.canonicalize().is_ok_and(|resolved| resolved.starts_with(&self.root));
        match stat(path) {
            Some((mtime, size)) if inside && is_markdown(rel) => {
                index.settle(rel, load(path, rel.to_owned()), mtime, size).into_iter().collect()
            }
            // Nothing there, or nothing that can be a note: also a removed
            // or renamed directory, whose notes go with it.
            _ => index.forget(rel),
        }
    }

    /// A batch from the watcher. The kinds of the events are hardly used:
    /// each path is compared with the index, so it doesn't matter how the
    /// platform describes a rename or a save through a temporary file.
    fn on_events(&self, result: DebounceEventResult) {
        let mut index = self.index.lock().unwrap();
        let mut paths: BTreeSet<(&Path, String)> = BTreeSet::new();
        // Events were dropped, or a directory appeared or moved: look at everything.
        let mut everything = result.is_err();
        for event in result.iter().flatten() {
            if event.need_rescan() {
                everything = true;
            }
            if matches!(event.kind, EventKind::Access(_)) {
                continue;
            }
            let content = matches!(event.kind, EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_)));
            for path in &event.paths {
                let Some(rel) = relative(&self.root, path) else { continue };
                let is_dir = path.is_dir();
                // New rules: what they hide or show isn't in the events.
                if self.rules.respect_gitignore && rel.rsplit('/').next() == Some(".gitignore") {
                    everything = true;
                }
                let parts: Vec<&str> = rel.split('/').collect();
                if self.rules.ignores(&self.root, &parts, is_dir) {
                    continue;
                }
                if is_dir {
                    // Windows reports a directory as modified when a file in it is.
                    everything |= !content;
                } else {
                    paths.insert((path.as_path(), rel));
                }
            }
        }
        if !everything && paths.len() > BURST {
            drop(index);
            return self.ask_for_rescan();
        }
        let changes = if everything {
            self.resync(&mut index)
        } else {
            paths.iter().flat_map(|(path, rel)| self.refresh(&mut index, path, rel)).collect()
        };
        // Still holding the index, so changes are logged in the order found.
        self.publish(changes);
    }
}

fn watch_events(vault: &Arc<Vault>, debounce: Duration) -> notify::Result<Watcher> {
    let weak = Arc::downgrade(vault);
    let handler = move |result: DebounceEventResult| {
        if let Some(vault) = weak.upgrade() {
            vault.on_events(result);
        }
    };
    // No file id cache: it would walk the whole folder, ignored parts too,
    // to pair renames, and paths are compared with the index here anyway.
    let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
        debounce,
        None,
        handler,
        NoCache::new(),
        notify::Config::default(),
    )?;
    debouncer.watch(&vault.root, RecursiveMode::Recursive)?;
    Ok(Watcher::Events(Box::new(debouncer)))
}

/// A thread that compares the folder with the index every so often, until
/// the returned sender is dropped.
fn watch_by_polling(vault: &Arc<Vault>, every: Duration) -> Watcher {
    let (stop, stopped) = mpsc::channel::<()>();
    let weak = Arc::downgrade(vault);
    let _ = std::thread::Builder::new().name("kurumi linked folder".into()).spawn(move || {
        while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(every) {
            let Some(vault) = weak.upgrade() else { break };
            let mut index = vault.index.lock().unwrap();
            let changes = vault.resync(&mut index);
            vault.publish(changes);
        }
    });
    Watcher::Polling(stop)
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
    // Each open gets cursors of its own (2^32 apart), so one from before
    // the vault was opened again, or from another vault, is never mistaken
    // for a place in this log.
    let first = (linked.opens.fetch_add(1, Ordering::Relaxed) + 1) << 32;
    let opened = Arc::new(Vault {
        root,
        rules,
        read_only,
        index: Mutex::new(Index::default()),
        log: Mutex::new(Log { first, entries: VecDeque::new(), bytes: 0 }),
        signal: watch::Sender::new(Signal { head: first, closed: false }),
        watcher: Mutex::new(None),
    });
    let (scanned, watch) = {
        // The watcher starts first and waits for the index, so nothing that
        // changes during the scan is missed.
        let mut index = opened.index.lock().unwrap();
        let events = linked.timing.events.then(|| watch_events(&opened, linked.timing.debounce).ok()).flatten();
        let watch = if events.is_some() { WatchMode::Events } else { WatchMode::Polling };
        let watcher = events.unwrap_or_else(|| watch_by_polling(&opened, linked.timing.poll_every));
        *opened.watcher.lock().unwrap() = Some(watcher);
        (scan(&opened.root, &opened.rules, &mut index), watch)
    };
    if let Some(previous) = linked.vaults.lock().unwrap().insert(vault.to_owned(), opened) {
        previous.stop();
    }
    let Scan { notes, dirs, skipped } = scanned;
    Ok(Opened { cursor: first, notes, dirs, skipped, watch })
}

fn close(linked: &Linked, vault: &str) {
    let closed = linked.vaults.lock().unwrap().remove(vault);
    if let Some(closed) = closed {
        closed.stop();
    }
}

/// What changed since `cursor`, waiting up to `wait` for something to tell.
async fn changes(linked: &Linked, vault: &str, cursor: u64, wait: Duration) -> Result<Changes, String> {
    let waited = linked.get(vault)?;
    let mut signal = waited.signal.subscribe();
    // An error is the wait running out: then there is nothing to tell.
    let _ = tokio::time::timeout(wait, signal.wait_for(|signal| signal.closed || signal.head != cursor)).await;
    if signal.borrow().closed {
        // Closed while waiting, or opened again: then the cursor is old.
        let current = linked.get(vault)?;
        let head = current.log.lock().unwrap().head();
        return Ok(Changes { cursor: head, changes: Vec::new(), rescan: true });
    }
    let log = waited.log.lock().unwrap();
    Ok(log.since(cursor))
}

/// The file `rel` names, if it may be a note of the vault: a plain relative
/// path to a Markdown file that the rules don't leave out and that doesn't
/// lead out of the folder.
fn note_path(folders: &Folders, vault: &Vault, rel: &str) -> Result<PathBuf, String> {
    let parts = rel_parts(rel)?;
    if !parts.last().is_some_and(|name| is_markdown(name)) {
        return Err(format!("NotAllowedError: {rel:?} is not a Markdown file"));
    }
    if vault.rules.ignores(&vault.root, &parts, false) {
        return Err(format!("NotAllowedError: {rel:?} is excluded by the linked folder's ignore rules"));
    }
    let path = parts.iter().fold(vault.root.clone(), |path, part| path.join(part));
    // Also refuses a symlink that leads out of the folder.
    folders.authorize(&path.to_string_lossy())
}

fn read(folders: &Folders, linked: &Linked, vault: &str, rel: &str) -> Result<NoteFile, String> {
    let vault = linked.get(vault)?;
    let path = note_path(folders, &vault, rel)?;
    load(&path, rel.to_owned())
}

/// Scans a picked folder, remembers it under `vault` and starts watching
/// it; opening the same vault again rescans and replaces all of that.
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

/// A long poll: answers as soon as the folder changed after `cursor`, with
/// nothing after 25 s, and at once when the vault is closed (an error) or
/// opened again (`rescan`).
#[tauri::command]
pub async fn linked_changes(vault: String, cursor: u64, linked: State<'_, Linked>) -> Result<Changes, String> {
    changes(&linked, &vault, cursor, LONG_POLL).await
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

/// Stops watching and forgets the vault; fine if it wasn't open.
#[tauri::command]
pub fn linked_close(vault: String, linked: State<'_, Linked>) {
    close(&linked, &vault);
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: &str = "lf.test";
    /// No watching: for the tests that aren't about it.
    const QUIET: Timing = Timing { events: false, debounce: DEBOUNCE, poll_every: Duration::from_secs(3600) };

    fn setup() -> (tempfile::TempDir, Folders, Linked, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let folders = Folders::with_roots(vec![root.clone()]);
        (tmp, folders, Linked::with(QUIET), root)
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
        assert_eq!(opened.skipped, 0);
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

        close(&linked, VAULT);
        close(&linked, VAULT);
        refused(read(&folders, &linked, VAULT, "a.md"), "InvalidStateError");
    }

    #[test]
    fn the_web_side_gets_the_field_names_it_expects() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "notes/a.md", "a");
        let json = serde_json::to_value(open_with(&folders, &linked, &root, &[], true)).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["cursor", "dirs", "notes", "skipped", "watch"]);
        assert_eq!(json["cursor"], 1u64 << 32);
        assert_eq!(json["watch"], "polling");
        assert_eq!(json["dirs"], serde_json::json!(["notes"]));
        let mut keys: Vec<&str> = json["notes"][0].as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["content", "hash", "mtime", "rel", "size"]);
    }

    // --- Watching, the change log and the long poll ---

    /// File events with a short debounce.
    const FAST: Timing = Timing { events: true, debounce: Duration::from_millis(50), poll_every: POLL_EVERY };
    /// As if the watcher couldn't start.
    const POLLING: Timing = Timing { events: false, debounce: DEBOUNCE, poll_every: Duration::from_millis(50) };
    /// How long a test waits for the watcher before it fails.
    const PATIENCE: Duration = Duration::from_secs(20);

    fn setup_with(timing: Timing) -> (tempfile::TempDir, Folders, Linked, PathBuf) {
        let (tmp, folders, _, root) = setup();
        (tmp, folders, Linked::with(timing), root)
    }

    fn open_as(folders: &Folders, linked: &Linked, root: &Path, patterns: &[&str], read_only: bool) -> Opened {
        let patterns: Vec<String> = patterns.iter().map(|p| p.to_string()).collect();
        open(folders, linked, VAULT, &root.to_string_lossy(), &patterns, true, read_only).unwrap()
    }

    fn poll(linked: &Linked, cursor: u64, wait: Duration) -> Result<Changes, String> {
        tauri::async_runtime::block_on(changes(linked, VAULT, cursor, wait))
    }

    /// `+rel` for an upsert, `-rel` for a remove.
    fn told(changes: &[Change]) -> Vec<String> {
        changes
            .iter()
            .map(|change| match change {
                Change::Upsert { note } => format!("+{}", note.rel),
                Change::Remove { rel } => format!("-{rel}"),
            })
            .collect()
    }

    fn upserted(changes: &[Change], rel: &str, content: &str) -> bool {
        changes.iter().any(|c| matches!(c, Change::Upsert { note } if note.rel == rel && note.content == content))
    }

    fn removed(changes: &[Change], rel: &str) -> bool {
        changes.iter().any(|c| matches!(c, Change::Remove { rel: gone } if gone == rel))
    }

    /// Polls until the changes since `cursor` are `enough`; no sleeping and
    /// hoping. Returns them and moves the cursor on.
    fn wait_for(linked: &Linked, cursor: &mut u64, enough: impl Fn(&[Change]) -> bool) -> Vec<Change> {
        let deadline = std::time::Instant::now() + PATIENCE;
        let mut all = Vec::new();
        loop {
            let got = poll(linked, *cursor, Duration::from_millis(250)).unwrap();
            assert!(!got.rescan, "asked for a rescan after {:?}", told(&all));
            *cursor = got.cursor;
            all.extend(got.changes);
            if enough(&all) {
                return all;
            }
            assert!(std::time::Instant::now() < deadline, "waited too long, got only {:?}", told(&all));
        }
    }

    /// What the polling thread does, on demand.
    fn resync(linked: &Linked) -> Vec<Change> {
        let vault = linked.get(VAULT).unwrap();
        let mut index = vault.index.lock().unwrap();
        vault.resync(&mut index)
    }

    #[test]
    fn the_watcher_reports_what_changes_in_the_folder() {
        let (_tmp, folders, linked, root) = setup_with(FAST);
        put(&root, "notes/a.md", "a");
        put(&root, "notes/b.md", "b");
        put(&root, "drafts/old.md", "old");
        let opened = open_as(&folders, &linked, &root, &["drafts/"], true);
        assert_eq!(opened.watch, WatchMode::Events);
        let mut cursor = opened.cursor;
        let mut all = Vec::new();

        // Created.
        put(&root, "notes/new.md", "new");
        all.extend(wait_for(&linked, &mut cursor, |c| upserted(c, "notes/new.md", "new")));
        // Modified.
        put(&root, "notes/a.md", "changed");
        all.extend(wait_for(&linked, &mut cursor, |c| upserted(c, "notes/a.md", "changed")));
        // Removed.
        fs::remove_file(root.join("notes").join("b.md")).unwrap();
        all.extend(wait_for(&linked, &mut cursor, |c| removed(c, "notes/b.md")));
        // Renamed.
        fs::rename(root.join("notes").join("new.md"), root.join("notes").join("renamed.md")).unwrap();
        all.extend(wait_for(&linked, &mut cursor, |c| {
            removed(c, "notes/new.md") && upserted(c, "notes/renamed.md", "new")
        }));
        // A new directory, then renamed with what's in it.
        put(&root, "more/deep/c.md", "c");
        all.extend(wait_for(&linked, &mut cursor, |c| upserted(c, "more/deep/c.md", "c")));
        fs::rename(root.join("more"), root.join("moved")).unwrap();
        all.extend(wait_for(&linked, &mut cursor, |c| {
            removed(c, "more/deep/c.md") && upserted(c, "moved/deep/c.md", "c")
        }));

        // What the scan leaves out isn't reported: these come before the
        // note that is waited for.
        put(&root, "drafts/old.md", "edited");
        put(&root, "drafts/x.md", "x");
        put(&root, ".hidden/y.md", "y");
        put(&root, "notes/.z.md", "z");
        put(&root, "notes/pic.png", [0xff, 0xd8]);
        put(&root, "notes/big.md", vec![b'a'; MAX_NOTE_BYTES as usize + 1]);
        put(&root, "notes/last.md", "last");
        all.extend(wait_for(&linked, &mut cursor, |c| upserted(c, "notes/last.md", "last")));
        put(&root, "notes/really-last.md", "end");
        all.extend(wait_for(&linked, &mut cursor, |c| upserted(c, "notes/really-last.md", "end")));
        for change in told(&all) {
            let rel = &change[1..];
            assert!(!rel.starts_with("drafts/") && !rel.contains("/.") && !rel.starts_with('.'), "{change}");
            assert!(!rel.ends_with(".png") && rel != "notes/big.md", "{change}");
        }
        // A note that was never listed isn't reported as removed either.
        assert_eq!(told(&all).iter().filter(|c| c.starts_with('-')).count(), 3, "{:?}", told(&all));
    }

    #[test]
    fn without_a_watcher_the_folder_is_polled() {
        let (_tmp, folders, linked, root) = setup_with(POLLING);
        put(&root, "a.md", "a");
        put(&root, "gone.md", "gone");
        let opened = open_as(&folders, &linked, &root, &[], false);
        assert_eq!(opened.watch, WatchMode::Polling);
        let mut cursor = opened.cursor;

        put(&root, "a.md", "changed");
        put(&root, "sub/new.md", "new");
        fs::remove_file(root.join("gone.md")).unwrap();
        wait_for(&linked, &mut cursor, |c| {
            upserted(c, "a.md", "changed") && upserted(c, "sub/new.md", "new") && removed(c, "gone.md")
        });

    }

    #[test]
    fn comparing_the_folder_tells_changes_by_content() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        put(&root, "b.md", "b");
        put(&root, "dir/c.md", "c");
        put(&root, "dir/d.md", "d");
        open_as(&folders, &linked, &root, &[], false);
        assert!(resync(&linked).is_empty());

        fs::remove_file(root.join("a.md")).unwrap();
        put(&root, "b.md", "bb");
        put(&root, "new.md", "new");
        put(&root, "skip.txt", "not a note");
        assert_eq!(told(&resync(&linked)), ["-a.md", "+b.md", "+new.md"]);
        assert!(resync(&linked).is_empty());

        // Saved again with the same content: not a change.
        put(&root, "b.md", "bb");
        assert!(resync(&linked).is_empty());
        // A note that stops being readable as one is removed, and comes back.
        put(&root, "new.md", [0xff, 0xfe]);
        assert_eq!(told(&resync(&linked)), ["-new.md"]);
        assert!(resync(&linked).is_empty());
        put(&root, "new.md", "text again");
        assert_eq!(told(&resync(&linked)), ["+new.md"]);
        // A directory goes with its notes.
        fs::remove_dir_all(root.join("dir")).unwrap();
        assert_eq!(told(&resync(&linked)), ["-dir/c.md", "-dir/d.md"]);
    }

    #[test]
    fn the_long_poll_answers_at_once_or_when_the_wait_runs_out() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        let cursor = open_as(&folders, &linked, &root, &[], false).cursor;
        let vault = linked.get(VAULT).unwrap();

        // Nothing to tell.
        let started = std::time::Instant::now();
        let got = poll(&linked, cursor, Duration::from_millis(100)).unwrap();
        assert!(started.elapsed() >= Duration::from_millis(100));
        assert!(got.changes.is_empty() && !got.rescan);
        assert_eq!(got.cursor, cursor);

        // Something that already happened.
        put(&root, "b.md", "b");
        vault.publish(resync(&linked));
        let got = poll(&linked, cursor, PATIENCE).unwrap();
        assert_eq!(told(&got.changes), ["+b.md"]);
        assert!(!got.rescan);
        // The same cursor again gives the same; the new one only what's new.
        assert_eq!(told(&poll(&linked, cursor, PATIENCE).unwrap().changes), ["+b.md"]);
        let cursor = got.cursor;

        // Something that happens while it waits.
        let started = std::time::Instant::now();
        let got = std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                fs::remove_file(root.join("a.md")).unwrap();
                vault.publish(resync(&linked));
            });
            poll(&linked, cursor, PATIENCE).unwrap()
        });
        assert_eq!(told(&got.changes), ["-a.md"]);
        assert!(started.elapsed() < PATIENCE);

        // The JSON the web side reads.
        let json = serde_json::to_value(poll(&linked, cursor - 1, PATIENCE).unwrap()).unwrap();
        assert_eq!(json["rescan"], false);
        assert_eq!(json["cursor"], cursor + 1);
        assert_eq!(json["changes"][0]["type"], "upsert");
        assert_eq!(json["changes"][0]["note"]["rel"], "b.md");
        assert_eq!(json["changes"][0]["note"]["content"], "b");
        assert_eq!(json["changes"][1], serde_json::json!({ "type": "remove", "rel": "a.md" }));
    }

    #[test]
    fn a_waiting_long_poll_is_let_go_when_the_vault_closes_or_reopens() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        let cursor = open_as(&folders, &linked, &root, &[], false).cursor;

        // Opened again: the old cursor is of no use, scan again.
        let started = std::time::Instant::now();
        let (got, reopened) = std::thread::scope(|scope| {
            let reopening = scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                open_as(&folders, &linked, &root, &[], false).cursor
            });
            (poll(&linked, cursor, PATIENCE).unwrap(), reopening.join().unwrap())
        });
        assert!(got.rescan && got.changes.is_empty());
        assert_eq!(got.cursor, reopened);
        assert_ne!(reopened, cursor);

        // Closed: an error, at once.
        let got = std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                close(&linked, VAULT);
            });
            poll(&linked, reopened, PATIENCE)
        });
        assert!(got.unwrap_err().starts_with("InvalidStateError"));
        assert!(started.elapsed() < PATIENCE);
        assert!(poll(&linked, reopened, PATIENCE).unwrap_err().starts_with("InvalidStateError"));
    }

    #[test]
    fn an_old_cursor_or_a_burst_asks_for_a_rescan() {
        let (_tmp, folders, linked, root) = setup();
        put(&root, "a.md", "a");
        let cursor = open_as(&folders, &linked, &root, &[], false).cursor;
        let vault = linked.get(VAULT).unwrap();

        // Cursors that aren't of this log: from before it, from another open, made up.
        for stale in [0, cursor - 1, cursor + 1, cursor + (1 << 32)] {
            let got = poll(&linked, stale, PATIENCE).unwrap();
            assert!(got.rescan && got.changes.is_empty(), "{stale}");
            assert_eq!(got.cursor, cursor);
        }

        // More at once than is worth listing.
        for i in 0..=BURST {
            put(&root, &format!("many/{i}.md"), "x");
        }
        vault.publish(resync(&linked));
        let got = poll(&linked, cursor, PATIENCE).unwrap();
        assert!(got.rescan && got.changes.is_empty());
        // The same from the watcher's side, before it reads anything.
        vault.ask_for_rescan();
        assert!(poll(&linked, got.cursor, PATIENCE).unwrap().rescan);
    }

    #[test]
    fn the_change_log_is_bounded() {
        let remove = |i: usize| Change::Remove { rel: format!("{i}.md") };
        let mut log = Log { first: 7, entries: VecDeque::new(), bytes: 0 };
        (0..LOG_ENTRIES + 3).for_each(|i| log.push(remove(i)));
        assert_eq!((log.entries.len(), log.first), (LOG_ENTRIES, 10));
        assert!(log.since(9).rescan);
        let all = log.since(10);
        assert_eq!((all.changes.len(), all.rescan, all.cursor), (LOG_ENTRIES, false, log.head()));
        assert_eq!(told(&log.since(log.head() - 1).changes), [format!("-{}.md", LOG_ENTRIES + 2)]);
        assert!(log.since(log.head()).changes.is_empty() && !log.since(log.head()).rescan);
        assert!(log.since(log.head() + 1).rescan);

        // By the size of the notes too.
        let mut log = Log { first: 0, entries: VecDeque::new(), bytes: 0 };
        let content = "a".repeat(MAX_NOTE_BYTES as usize);
        for i in 0..20 {
            let note = NoteFile { rel: format!("{i}.md"), content: content.clone(), hash: String::new(), mtime: 0.0, size: 0 };
            log.push(Change::Upsert { note });
        }
        assert_eq!(log.entries.len(), LOG_BYTES / MAX_NOTE_BYTES as usize);
        assert_eq!(log.head(), 20);
        assert!(log.bytes <= LOG_BYTES);
    }
}
