use tauri::Manager;

/// The staff panel in a native window. The web UI is the same build as the browser panel;
/// the shell adds native notifications and keeps a single instance per machine (a kitchen
/// screen should never end up with two copies ringing for the same order).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running the ProChia panel");
}
