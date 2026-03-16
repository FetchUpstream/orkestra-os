use crate::app::runs::dto::{RunDiffFileDto, RunDiffFilePayloadDto, RunDto};
use crate::app::state::AppState;
use crate::app::{commands::context, commands::error_mapping::map_result};
use tauri::Manager;

#[tauri::command]
pub async fn create_run(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(service.create_run(&task_id).await)
}

#[tauri::command]
pub async fn list_task_runs(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<RunDto>, String> {
    let service = context::runs_service(&state);
    map_result(service.list_task_runs(&task_id).await)
}

#[tauri::command]
pub async fn get_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(service.get_run(&run_id).await)
}

#[tauri::command]
pub async fn delete_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<(), String> {
    let service = context::runs_service(&state);
    map_result(service.delete_run(&run_id).await)
}

#[tauri::command]
pub async fn list_run_diff_files(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Vec<RunDiffFileDto>, String> {
    let service = context::runs_diff_service(&state);
    map_result(service.list_run_diff_files(&run_id).await)
}

#[tauri::command]
pub async fn get_run_diff_file(
    state: tauri::State<'_, AppState>,
    run_id: String,
    path: String,
) -> Result<RunDiffFilePayloadDto, String> {
    let service = context::runs_diff_service(&state);
    map_result(service.get_run_diff_file(&run_id, &path).await)
}

#[tauri::command]
pub async fn set_run_diff_watch(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    run_id: String,
    enabled: bool,
) -> Result<(), String> {
    let service = context::runs_diff_service(&state);
    map_result(
        service
            .set_run_diff_watch(&window.app_handle(), &window, &run_id, enabled)
            .await,
    )
}
