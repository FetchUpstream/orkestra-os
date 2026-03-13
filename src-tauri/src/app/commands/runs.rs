use crate::app::runs::dto::RunDto;
use crate::app::state::AppState;
use crate::app::{commands::context, commands::error_mapping::map_result};

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
