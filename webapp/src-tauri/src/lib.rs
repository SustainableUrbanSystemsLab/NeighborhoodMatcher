// NeighborhoodMatcher desktop app: the built webapp served from inside the
// binary. Everything the page needs (Pyodide runtime, numpy wheel, matcher
// sources) ships in the bundle, so the app never touches the network.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Citation and repository links open in the system browser instead
        // of navigating the app window (see webapp/src/lib/platform.ts).
        .plugin(tauri_plugin_opener::init())
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
