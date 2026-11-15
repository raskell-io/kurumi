//! Self-test mode, used by desktop/selftest.mjs on built apps (also in CI).
//!
//! `KURUMI_SELFTEST=<empty dir>` runs the app with its data in that dir (a
//! separate WebKit store on macOS), answers the folder dialog with
//! `<dir>/folder` (or another folder under `<dir>` that selftest.js names
//! with `selftest_folder`), saves downloads to `<dir>/downloads`, and injects
//! selftest.js, which checks the page and reports through `selftest_report`.
//! Without the variable none of this is active.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

pub fn dir() -> Option<PathBuf> {
    std::env::var_os("KURUMI_SELFTEST").map(PathBuf::from)
}

/// The folder under the self-test dir that the folder dialog is answered
/// with: `folder`, unless selftest.js asked for another.
static PICKED: Mutex<Option<String>> = Mutex::new(None);

/// How often the folder dialog was asked for since the app started.
static DIALOGS: AtomicUsize = AtomicUsize::new(0);

/// The self-test's answer to the folder dialog (called once per dialog).
pub fn folder() -> Option<PathBuf> {
    DIALOGS.fetch_add(1, Ordering::Relaxed);
    let name = PICKED.lock().unwrap().clone().unwrap_or_else(|| "folder".into());
    dir().map(|d| d.join(name))
}

pub fn config_dir() -> Option<PathBuf> {
    dir().map(|d| d.join("config"))
}

#[cfg_attr(mobile, allow(dead_code))] // desktop only
pub fn downloads() -> Option<PathBuf> {
    dir().map(|d| d.join("downloads"))
}

#[cfg_attr(mobile, allow(dead_code))] // desktop only
pub fn webview_data() -> Option<PathBuf> {
    dir().map(|d| d.join("webview"))
}

/// A WebKit data store of its own (macOS 14+), never the real vault's.
#[cfg_attr(mobile, allow(dead_code))] // desktop only
pub const DATA_STORE: [u8; 16] = *b"kurumi-selftest!";

pub fn script() -> Option<String> {
    dir()?;
    let phase = std::env::var("KURUMI_SELFTEST_PHASE").unwrap_or_else(|_| "1".into());
    let nonce = std::env::var("KURUMI_SELFTEST_NONCE").unwrap_or_default();
    Some(
        include_str!("selftest.js")
            .replace("__PHASE__", &serde_json::to_string(&phase).unwrap())
            .replace("__NONCE__", &serde_json::to_string(&nonce).unwrap()),
    )
}

/// Which folder under the self-test dir the next folder dialogs "choose".
/// A plain name only, and nothing at all outside self-test mode.
#[tauri::command]
pub fn selftest_folder(name: String) {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if dir().is_some() && plain {
        *PICKED.lock().unwrap() = Some(name);
    }
}

/// How many folder dialogs the app asked for: none after a restart, if
/// what was picked before is remembered.
#[tauri::command]
pub fn selftest_dialogs() -> usize {
    dir().map_or(0, |_| DIALOGS.load(Ordering::Relaxed))
}

#[tauri::command]
pub fn selftest_report<R: tauri::Runtime>(app: tauri::AppHandle<R>, report: String) {
    if dir().is_none() {
        return;
    }
    println!("KURUMI_SELFTEST {report}");
    app.exit(0);
}
