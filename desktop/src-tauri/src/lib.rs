//! Kurumi desktop: one window showing the static web build (../../build).
//!
//! The build is served from a fixed origin (tauri://localhost on macOS and
//! Linux, https://tauri.localhost on Windows), so the vault in IndexedDB
//! survives restarts and updates. Links to the web open in the default
//! browser, downloads land in the Downloads folder, and local folder sync
//! goes through folders.rs.

mod folders;
mod selftest;

use std::path::{Path, PathBuf};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn is_app_url(url: &Url) -> bool {
    url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (tauri::is_dev() && url.host_str() == Some("localhost"))
}

/// http(s) and mailto links go to the system; anything else stays put.
fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// `name`, or `name (2)`, … if that's taken.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

fn create_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let nav_app = app.clone();
    let popup_app = app.clone();
    let download_app = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Kurumi")
        .inner_size(1360.0, 880.0)
        .min_inner_size(360.0, 480.0)
        // The web app handles dropped files itself (editor/fileDrop.ts).
        .disable_drag_drop_handler()
        // https://tauri.localhost on Windows: a secure origin. Changing it
        // later would leave the vault behind, so it stays on.
        .use_https_scheme(true)
        .on_navigation(move |url| {
            if is_app_url(url) || !matches!(url.scheme(), "http" | "https" | "mailto") {
                return true;
            }
            open_outside(&nav_app, url);
            false
        })
        .on_new_window(move |url, _features| {
            open_outside(&popup_app, &url);
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { destination, .. } = event {
                let dir = selftest::downloads()
                    .or_else(|| download_app.path().download_dir().ok())
                    .unwrap_or_else(std::env::temp_dir);
                let _ = std::fs::create_dir_all(&dir);
                let name = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "Kurumi download".into());
                *destination = unique_path(&dir, &name);
            }
            true
        });

    if let Some(script) = selftest::script() {
        builder = builder.initialization_script(script);
        if let Some(data) = selftest::webview_data() {
            builder = builder.data_directory(data);
        }
        #[cfg(target_os = "macos")]
        {
            builder = builder.data_store_identifier(selftest::DATA_STORE);
        }
    }

    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Also gives the page a window.Notification for due to-dos.
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app.manage(folders::Folders::load(app.handle()));
            create_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            folders::folder_pick,
            folders::folder_granted,
            folders::fs_list,
            folders::fs_open,
            folders::fs_stat,
            folders::fs_read,
            folders::fs_write,
            folders::fs_remove,
            selftest::selftest_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kurumi");
}
