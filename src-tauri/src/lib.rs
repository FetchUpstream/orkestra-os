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
                Ok::<app::state::AppState, app::errors::AppError>(app::state::AppState::new(
                    pool,
                    app_data_dir,
                ))
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
            app::commands::projects::update_project,
            app::commands::tasks::create_task,
            app::commands::runs::create_run,
            app::commands::runs::list_task_runs,
            app::commands::runs::get_run,
            app::commands::runs::delete_run,
            app::commands::worktrees::create_worktree,
            app::commands::worktrees::remove_worktree,
            app::commands::tasks::list_project_tasks,
            app::commands::tasks::get_task,
            app::commands::tasks::update_task,
            app::commands::tasks::set_task_status,
            app::commands::tasks::move_task,
            app::commands::tasks::delete_task,
            app::commands::tasks::list_task_dependencies,
            app::commands::tasks::add_task_dependency,
            app::commands::tasks::remove_task_dependency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
