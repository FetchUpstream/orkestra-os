use crate::app::state::AppState;
use crate::app::tasks::dto::{
    AddTaskDependencyRequest, CreateTaskRequest, DeleteTaskResponse, MoveTaskRequest,
    RemoveTaskDependencyRequest, RemoveTaskDependencyResponse, SetTaskStatusRequest,
    TaskDependenciesDto, TaskDependencyEdgeDto, TaskDto, TaskUpdatedEventDto, UpdateTaskRequest,
};
use crate::app::{commands::context, commands::error_mapping::map_result};
use tauri::Emitter;

#[tauri::command]
pub async fn create_task(
    state: tauri::State<'_, AppState>,
    input: CreateTaskRequest,
) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.create_task(input).await)
}

#[tauri::command]
pub async fn list_project_tasks(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TaskDto>, String> {
    let service = context::tasks_service(&state);
    map_result(service.list_project_tasks(&project_id).await)
}

#[tauri::command]
pub async fn get_task(state: tauri::State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.get_task(&id).await)
}

#[tauri::command]
pub async fn update_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateTaskRequest,
) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.update_task(&id, input).await)
}

#[tauri::command]
pub async fn set_task_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    input: SetTaskStatusRequest,
) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    let updated = map_result(service.set_task_status(&id, input).await)?;
    let payload = TaskUpdatedEventDto {
        task_id: updated.id.clone(),
        project_id: updated.project_id.clone(),
        status: updated.status.clone(),
    };
    let _ = app.emit("task-updated", payload);
    Ok(updated)
}

#[tauri::command]
pub async fn move_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: MoveTaskRequest,
) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.move_task(&id, input).await)
}

#[tauri::command]
pub async fn delete_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<DeleteTaskResponse, String> {
    let service = context::tasks_service(&state);
    map_result(service.delete_task(&id).await)
}

#[tauri::command]
pub async fn list_task_dependencies(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<TaskDependenciesDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.list_task_dependencies(&task_id).await)
}

#[tauri::command]
pub async fn add_task_dependency(
    state: tauri::State<'_, AppState>,
    input: AddTaskDependencyRequest,
) -> Result<TaskDependencyEdgeDto, String> {
    let service = context::tasks_service(&state);
    map_result(service.add_task_dependency(input).await)
}

#[tauri::command]
pub async fn remove_task_dependency(
    state: tauri::State<'_, AppState>,
    input: RemoveTaskDependencyRequest,
) -> Result<RemoveTaskDependencyResponse, String> {
    let service = context::tasks_service(&state);
    map_result(service.remove_task_dependency(input).await)
}
