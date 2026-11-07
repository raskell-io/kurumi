//! Self-test mode, used by desktop/selftest.mjs on built apps (also in CI).
//!
//! `KURUMI_SELFTEST=<empty dir>` runs the app with its data in that dir (a
//! separate WebKit store on macOS), answers the folder dialog with
//! `<dir>/folder`, saves downloads to `<dir>/downloads`, and injects
//! selftest.js, which checks the page and reports through `selftest_report`.
//! Without the variable none of this is active.

use std::path::PathBuf;

pub fn dir() -> Option<PathBuf> {
    std::env::var_os("KURUMI_SELFTEST").map(PathBuf::from)
}

pub fn folder() -> Option<PathBuf> {
    dir().map(|d| d.join("folder"))
}

pub fn config_dir() -> Option<PathBuf> {
    dir().map(|d| d.join("config"))
}

pub fn downloads() -> Option<PathBuf> {
    dir().map(|d| d.join("downloads"))
}

pub fn webview_data() -> Option<PathBuf> {
    dir().map(|d| d.join("webview"))
}

/// A WebKit data store of its own (macOS 14+), never the real vault's.
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

#[tauri::command]
pub fn selftest_report<R: tauri::Runtime>(app: tauri::AppHandle<R>, report: String) {
    if dir().is_none() {
        return;
    }
    println!("KURUMI_SELFTEST {report}");
    app.exit(0);
}
