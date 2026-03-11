use crate::app::state::AppState;
use crate::app::tasks::dto::{CreateTaskRequest, TaskDto};

#[tauri::command]
pub async fn create_task(
    state: tauri::State<'_, AppState>,
    input: CreateTaskRequest,
) -> Result<TaskDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service.create_task(input).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_project_tasks(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TaskDto>, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .list_project_tasks(&project_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_task(state: tauri::State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service.get_task(&id).await.map_err(|err| err.to_string())
}
