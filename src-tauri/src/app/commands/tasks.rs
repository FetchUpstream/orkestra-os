use crate::app::state::AppState;
use crate::app::tasks::dto::{
    AddTaskDependencyRequest, CreateTaskRequest, DeleteTaskResponse, MoveTaskRequest,
    RemoveTaskDependencyRequest, RemoveTaskDependencyResponse, SetTaskStatusRequest,
    TaskDependenciesDto, TaskDependencyEdgeDto, TaskDto, UpdateTaskRequest,
};

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

#[tauri::command]
pub async fn update_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateTaskRequest,
) -> Result<TaskDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .update_task(&id, input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_task_status(
    state: tauri::State<'_, AppState>,
    id: String,
    input: SetTaskStatusRequest,
) -> Result<TaskDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .set_task_status(&id, input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn move_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: MoveTaskRequest,
) -> Result<TaskDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .move_task(&id, input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<DeleteTaskResponse, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service.delete_task(&id).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_task_dependencies(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<TaskDependenciesDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .list_task_dependencies(&task_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn add_task_dependency(
    state: tauri::State<'_, AppState>,
    input: AddTaskDependencyRequest,
) -> Result<TaskDependencyEdgeDto, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .add_task_dependency(input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn remove_task_dependency(
    state: tauri::State<'_, AppState>,
    input: RemoveTaskDependencyRequest,
) -> Result<RemoveTaskDependencyResponse, String> {
    let service = state
        .tasks_service
        .as_ref()
        .ok_or_else(|| "tasks service unavailable".to_string())?;
    service
        .remove_task_dependency(input)
        .await
        .map_err(|err| err.to_string())
}
