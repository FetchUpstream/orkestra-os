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
            app::commands::runs::list_run_diff_files,
            app::commands::runs::get_run_diff_file,
            app::commands::runs::get_run_merge_status,
            app::commands::runs::rebase_run_worktree_branch,
            app::commands::runs::merge_run_into_source_branch,
            app::commands::runs::set_run_diff_watch,
            app::commands::runs::ensure_run_opencode,
            app::commands::runs::bootstrap_run_opencode,
            app::commands::runs::submit_run_opencode_prompt,
            app::commands::runs::start_run_opencode,
            app::commands::runs::subscribe_run_opencode_events,
            app::commands::runs::unsubscribe_run_opencode_events,
            app::commands::runs::get_buffered_run_opencode_events,
            app::commands::runs::get_run_opencode_session_messages,
            app::commands::runs::get_run_opencode_session_todos,
            app::commands::terminal::open_run_terminal,
            app::commands::terminal::write_run_terminal,
            app::commands::terminal::resize_run_terminal,
            app::commands::terminal::kill_run_terminal,
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
