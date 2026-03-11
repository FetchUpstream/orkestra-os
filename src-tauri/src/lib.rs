mod app;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = tauri::async_runtime::block_on(async {
        let pool = app::db::connection::connect("sqlite:orkestra.db")
            .await
            .expect("failed to connect sqlite database");
        app::db::migrations::run_migrations(&pool)
            .await
            .expect("failed to run migrations");
        app::state::AppState::new_with_pool(pool)
    });

    tauri::Builder::default()
        .setup(|app| {
            app.emit("app://runtime-status", "ready")?;
            Ok(())
        })
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app::commands::health::health_check,
            app::commands::projects::list_projects,
            app::commands::projects::get_project,
            app::commands::projects::create_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
