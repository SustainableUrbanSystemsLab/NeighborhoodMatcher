// NeighborhoodMatcher desktop app: the built webapp served from inside the
// binary. Everything the page needs (Pyodide runtime, numpy wheel, matcher
// sources) ships in the bundle, so the app never touches the network.

use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Keeps only a plain file name: no directories, no characters Windows or
/// macOS reject, never empty.
fn sanitize_file_name(requested: &str) -> String {
    let base = requested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "matcher_results.zip".to_string()
    } else {
        cleaned
    }
}

/// `name`, or `name (1)`, `name (2)`, … — never overwrites an existing file.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (name.to_string(), String::new()),
    };
    for n in 1..10_000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}

/// Saves a file produced by the page (the results zip) into the user's
/// Downloads folder and returns its full path, which the page shows.
///
/// The webview's own download machinery is not used: WKWebView (macOS)
/// cancels any download unless the app installs a handler, and it would not
/// tell the page where the file went. Body: the raw bytes; header
/// `x-filename`: the suggested name.
#[tauri::command]
fn save_download(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let requested = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("matcher_results.zip");
    let name = sanitize_file_name(requested);
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| format!("no Downloads folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let path = unique_path(&dir, &name);
    std::fs::write(&path, bytes).map_err(|e| format!("could not save {}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Citation and repository links open in the system browser instead
        // of navigating the app window (see webapp/src/lib/platform.ts).
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_download])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_plain_and_safe() {
        assert_eq!(sanitize_file_name("20260928-1200-matcher_results.zip"), "20260928-1200-matcher_results.zip");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("C:\\x\\a:b?.zip"), "a_b_.zip");
        assert_eq!(sanitize_file_name(".."), "matcher_results.zip");
        assert_eq!(sanitize_file_name(""), "matcher_results.zip");
    }

    #[test]
    fn never_overwrites() {
        let dir = std::env::temp_dir().join(format!("nbhdmatch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "r.zip");
        std::fs::write(&first, b"1").unwrap();
        let second = unique_path(&dir, "r.zip");
        assert_eq!(second.file_name().unwrap(), "r (1).zip");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
