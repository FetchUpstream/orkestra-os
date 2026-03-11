mod app;

use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("orkestra.db");

            let app_state = tauri::async_runtime::block_on(async {
                let pool = app::db::connection::connect(&db_path).await?;
                app::db::migrations::run_migrations(&pool).await?;
                Ok::<app::state::AppState, app::errors::AppError>(
                    app::state::AppState::new_with_pool(pool),
                )
            })?;

            app.manage(app_state);
            app.emit("app://runtime-status", "ready")?;
            Ok(())
        })
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
