//! Local folder sync for the desktop app.
//!
//! WebKit (macOS, Linux) has no File System Access API, so the web app talks
//! to these commands through a stand-in for `showDirectoryPicker`
//! (src/lib/desktop/folder-handle.ts). Every command only reaches inside a
//! folder the user picked in the system dialog; those folders are remembered
//! in `folders.json` in the app's config directory.
//!
//! Errors are strings starting with the DOMException name the browser API
//! would throw ("NotFoundError: …"), which the stand-in turns back into one.

use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{ipc, AppHandle, Manager, Runtime, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

const FOLDERS_FILE: &str = "folders.json";

/// The folders the user picked, canonicalized.
pub struct Folders {
    roots: Mutex<Vec<PathBuf>>,
    file: Option<PathBuf>,
}

impl Folders {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let file = match crate::selftest::config_dir() {
            Some(dir) => Some(dir.join(FOLDERS_FILE)),
            None => app.path().app_config_dir().ok().map(|d| d.join(FOLDERS_FILE)),
        };
        let roots = file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default();
        Folders { roots: Mutex::new(roots), file }
    }

    #[cfg(test)]
    fn with_roots(roots: Vec<PathBuf>) -> Self {
        Folders { roots: Mutex::new(roots), file: None }
    }

    fn add(&self, root: PathBuf) {
        let mut roots = self.roots.lock().unwrap();
        if !roots.contains(&root) {
            roots.push(root);
        }
        if let Some(file) = &self.file {
            if let Some(dir) = file.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::write(file, serde_json::to_string_pretty(&*roots).unwrap_or_default());
        }
    }

    /// `path` if it lies inside a picked folder, also after resolving
    /// symlinks, so nothing outside can be reached.
    fn authorize(&self, path: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(path);
        let denied = || format!("NotAllowedError: {} is outside the folders you picked", path.display());
        // By name too: in Windows \\?\ paths `..` isn't parsed as ParentDir.
        let dotted = |c: Component| {
            matches!(c, Component::ParentDir | Component::CurDir) || c.as_os_str() == ".." || c.as_os_str() == "."
        };
        if !path.is_absolute() || path.components().any(dotted) {
            return Err(denied());
        }
        let roots = self.roots.lock().unwrap();
        let root = roots.iter().find(|r| path.starts_with(r)).ok_or_else(denied)?;
        // The deepest part that exists must still be inside once resolved.
        let mut existing = path.as_path();
        while !existing.exists() {
            existing = existing.parent().ok_or_else(denied)?;
        }
        let resolved = existing.canonicalize().map_err(io_error)?;
        if !resolved.starts_with(root) {
            return Err(denied());
        }
        Ok(path)
    }
}

fn io_error(e: std::io::Error) -> String {
    let name = match e.kind() {
        ErrorKind::NotFound => "NotFoundError",
        ErrorKind::PermissionDenied => "NotAllowedError",
        ErrorKind::DirectoryNotEmpty => "InvalidModificationError",
        _ => "UnknownError",
    };
    format!("{name}: {e}")
}

fn not_found(path: &Path) -> String {
    format!("NotFoundError: {} doesn't exist", path.display())
}

fn type_mismatch(path: &Path) -> String {
    format!("TypeMismatchError: {} is not the expected kind of entry", path.display())
}

#[derive(Serialize)]
pub struct Picked {
    path: PathBuf,
    name: String,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
    size: u64,
    /// Milliseconds since the epoch, like File.lastModified.
    modified: f64,
}

fn entry(path: &Path, meta: &fs::Metadata) -> Entry {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Entry {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
    }
}

fn picked(path: PathBuf) -> Picked {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    Picked { path, name }
}

#[cfg(desktop)]
fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
    Ok(app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()))
}

/// Phones: no folder dialog (iOS would also need security-scoped bookmarks).
#[cfg(mobile)]
fn pick_folder<R: Runtime>(_app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
    Err("Local folder sync isn't available in the phone app yet. Use the Kurumi server, S3, WebDAV or Git.".into())
}

/// Shows the folder dialog; the chosen folder becomes reachable.
#[tauri::command]
pub async fn folder_pick<R: Runtime>(app: AppHandle<R>, folders: State<'_, Folders>) -> Result<Option<Picked>, String> {
    // The self-test can't click through a dialog.
    let chosen = match crate::selftest::folder() {
        Some(dir) => Some(dir),
        None => pick_folder(&app)?,
    };
    let Some(chosen) = chosen else { return Ok(None) };
    let root = chosen.canonicalize().map_err(io_error)?;
    folders.add(root.clone());
    Ok(Some(picked(root)))
}

/// Whether a remembered folder can still be used (queryPermission).
#[tauri::command]
pub fn folder_granted(path: String, folders: State<'_, Folders>) -> bool {
    folders.authorize(&path).map(|p| p.is_dir()).unwrap_or(false)
}

#[tauri::command]
pub fn fs_list(path: String, folders: State<'_, Folders>) -> Result<Vec<Entry>, String> {
    list(&folders, &path)
}

fn list(folders: &Folders, path: &str) -> Result<Vec<Entry>, String> {
    let dir = folders.authorize(path)?;
    let mut out = Vec::new();
    for item in fs::read_dir(&dir).map_err(io_error)? {
        let item = item.map_err(io_error)?;
        // Follow symlinks like the browser does; skip broken ones.
        if let Ok(meta) = fs::metadata(item.path()) {
            out.push(entry(&item.path(), &meta));
        }
    }
    Ok(out)
}

/// getDirectoryHandle / getFileHandle: checks the entry, creating it if asked.
#[tauri::command]
pub fn fs_open(path: String, dir: bool, create: bool, folders: State<'_, Folders>) -> Result<(), String> {
    open(&folders, &path, dir, create)
}

fn open(folders: &Folders, path: &str, dir: bool, create: bool) -> Result<(), String> {
    let path = folders.authorize(path)?;
    match fs::metadata(&path) {
        Ok(meta) if meta.is_dir() == dir => Ok(()),
        Ok(_) => Err(type_mismatch(&path)),
        Err(e) if e.kind() == ErrorKind::NotFound && create => {
            if dir {
                fs::create_dir(&path).map_err(io_error)
            } else {
                fs::OpenOptions::new().write(true).create_new(true).open(&path).map(|_| ()).map_err(io_error)
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Err(not_found(&path)),
        Err(e) => Err(io_error(e)),
    }
}

#[tauri::command]
pub fn fs_stat(path: String, folders: State<'_, Folders>) -> Result<Entry, String> {
    let path = folders.authorize(&path)?;
    let meta = fs::metadata(&path).map_err(|e| if e.kind() == ErrorKind::NotFound { not_found(&path) } else { io_error(e) })?;
    Ok(entry(&path, &meta))
}

#[tauri::command]
pub fn fs_read(path: String, folders: State<'_, Folders>) -> Result<ipc::Response, String> {
    read(&folders, &path).map(ipc::Response::new)
}

fn read(folders: &Folders, path: &str) -> Result<Vec<u8>, String> {
    let path = folders.authorize(path)?;
    if path.is_dir() {
        return Err(type_mismatch(&path));
    }
    fs::read(&path).map_err(|e| if e.kind() == ErrorKind::NotFound { not_found(&path) } else { io_error(e) })
}

/// The file's new contents as the raw request body; its path in the
/// `x-kurumi-path` header (URI-encoded). Written beside it, then renamed
/// over it, so a reader never sees half a file.
#[tauri::command]
pub fn fs_write(request: ipc::Request<'_>, folders: State<'_, Folders>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-kurumi-path")
        .and_then(|v| v.to_str().ok())
        .map(decode_uri_component)
        .ok_or("TypeError: missing x-kurumi-path header")?;
    let ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("TypeError: expected raw bytes".into());
    };
    write(&folders, &path, bytes)
}

fn write(folders: &Folders, path: &str, bytes: &[u8]) -> Result<(), String> {
    let path = folders.authorize(path)?;
    if path.is_dir() {
        return Err(type_mismatch(&path));
    }
    let parent = path.parent().ok_or_else(|| not_found(&path))?;
    let name = path.file_name().ok_or_else(|| not_found(&path))?.to_string_lossy();
    let tmp = parent.join(format!(".{name}.kurumi-tmp"));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(io_error)
}

#[tauri::command]
pub fn fs_remove(path: String, recursive: bool, folders: State<'_, Folders>) -> Result<(), String> {
    remove(&folders, &path, recursive)
}

fn remove(folders: &Folders, path: &str, recursive: bool) -> Result<(), String> {
    let path = folders.authorize(path)?;
    if folders.roots.lock().unwrap().contains(&path) {
        return Err(format!("NotAllowedError: won't remove the picked folder {}", path.display()));
    }
    let meta = fs::symlink_metadata(&path).map_err(|e| if e.kind() == ErrorKind::NotFound { not_found(&path) } else { io_error(e) })?;
    if !meta.is_dir() {
        return fs::remove_file(&path).map_err(io_error);
    }
    if recursive {
        return fs::remove_dir_all(&path).map_err(io_error);
    }
    fs::remove_dir(&path).map_err(|e| match e.kind() {
        ErrorKind::DirectoryNotEmpty => format!("InvalidModificationError: {} isn't empty", path.display()),
        _ if fs::read_dir(&path).map(|mut d| d.next().is_some()).unwrap_or(false) => {
            format!("InvalidModificationError: {} isn't empty", path.display())
        }
        _ => io_error(e),
    })
}

fn decode_uri_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Paths are joined with Path::join, as the app joins them with the
    /// platform's separator: in Windows \\?\ paths only `\` separates.
    fn at(root: &Path, rel: &str) -> String {
        rel.split('/').fold(root.to_path_buf(), |p, part| p.join(part)).to_string_lossy().into_owned()
    }

    fn setup() -> (tempfile::TempDir, Folders, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let folders = Folders::with_roots(vec![root.clone()]);
        (tmp, folders, root)
    }

    #[test]
    fn reaches_only_inside_picked_folders() {
        let (tmp, folders, root) = setup();
        fs::write(tmp.path().join("secret.txt"), "no").unwrap();
        assert!(folders.authorize(&at(&root, "a.md")).is_ok());
        assert!(folders.authorize(&at(&root, "../secret.txt")).unwrap_err().starts_with("NotAllowedError"));
        assert!(folders.authorize(&tmp.path().join("secret.txt").to_string_lossy()).is_err());
        assert!(folders.authorize("relative/a.md").is_err());
        // A prefix of the name isn't the folder: …/vault2 is not in …/vault.
        let sibling = PathBuf::from(format!("{}2", root.display()));
        assert!(folders.authorize(&at(&sibling, "a.md")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_out_of_the_folder_are_refused() {
        let (tmp, folders, root) = setup();
        fs::create_dir(tmp.path().join("outside")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("outside"), root.join("link")).unwrap();
        assert!(folders.authorize(&at(&root, "link/x.md")).is_err());
    }

    #[test]
    fn behaves_like_the_file_system_access_api() {
        let (_tmp, folders, root) = setup();
        let sub = at(&root, "notes");
        let file = at(&root, "notes/a.md");
        assert!(open(&folders, &sub, true, false).unwrap_err().starts_with("NotFoundError"));
        open(&folders, &sub, true, true).unwrap();
        assert!(open(&folders, &sub, false, false).unwrap_err().starts_with("TypeMismatchError"));
        open(&folders, &file, false, true).unwrap();
        assert_eq!(read(&folders, &file).unwrap(), b"");
        write(&folders, &file, "hällo".as_bytes()).unwrap();
        write(&folders, &file, "hällo".as_bytes()).unwrap(); // replacing an existing file
        assert_eq!(read(&folders, &file).unwrap(), "hällo".as_bytes());
        let listed = list(&folders, &sub).unwrap();
        assert_eq!(listed.len(), 1, "no temp file left behind");
        assert_eq!((listed[0].name.as_str(), listed[0].dir, listed[0].size), ("a.md", false, 6));
        assert!(remove(&folders, &sub, false).unwrap_err().starts_with("InvalidModificationError"));
        remove(&folders, &file, false).unwrap();
        remove(&folders, &sub, false).unwrap();
        assert!(read(&folders, &file).unwrap_err().starts_with("NotFoundError"));
        assert!(remove(&folders, &root.to_string_lossy(), true).unwrap_err().starts_with("NotAllowedError"));
    }

    #[test]
    fn decodes_header_paths() {
        assert_eq!(decode_uri_component("/a%20b/%C3%A4.md"), "/a b/ä.md");
        assert_eq!(decode_uri_component("/100%"), "/100%");
    }
}
