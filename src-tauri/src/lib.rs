use tauri::Emitter;

#[tauri::command]
fn health_check(app: tauri::AppHandle) -> String {
    let _ = app.emit("app://runtime-status", "ready");
    "Rust backend is working".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.emit("app://runtime-status", "ready")?;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![health_check])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
