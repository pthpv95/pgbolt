mod convert;
mod db;

use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Restore/persist window size & position across launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            db::connect,
            db::disconnect,
            db::run_query,
            db::cancel_query,
            db::list_schemas,
            db::list_tables,
            db::search_tables,
            db::list_columns,
            db::primary_keys,
            db::update_row,
            db::delete_row,
        ])
        // Clicking the window's close button hides the window instead of
        // quitting the app (macOS convention). The app keeps running.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Clicking the dock icon (or reopening) re-shows the hidden window.
        .run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
