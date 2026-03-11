use tauri::Emitter;

#[tauri::command]
pub fn health_check(app: tauri::AppHandle) -> String {
    let _ = app.emit("app://runtime-status", "ready");
    "Rust backend is working".to_string()
}
