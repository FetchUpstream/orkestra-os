// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

use crate::app::state::AppState;
use crate::app::tasks::dto::{
    AddTaskDependencyRequest, CreateTaskRequest, DeleteTaskResponse, MoveTaskRequest,
    RemoveTaskDependencyRequest, RemoveTaskDependencyResponse, SearchProjectTasksRequest,
    SetTaskStatusRequest, TaskDependenciesDto, TaskDependencyEdgeDto, TaskDto,
    TaskStatusChangedEventDto, UpdateTaskRequest,
};
use crate::app::{commands::context, commands::error_mapping::map_result};

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
pub async fn search_project_tasks(
    state: tauri::State<'_, AppState>,
    input: SearchProjectTasksRequest,
) -> Result<Vec<TaskDto>, String> {
    let service = context::tasks_service(&state);
    map_result(
        service
            .search_project_tasks(&input.project_id, &input.query)
            .await,
    )
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
    state: tauri::State<'_, AppState>,
    id: String,
    input: SetTaskStatusRequest,
) -> Result<TaskDto, String> {
    let service = context::tasks_service(&state);
    let transition_service = context::task_status_transition_service(&state);
    let existing = map_result(service.get_task(&id).await)?;
    let updated = map_result(service.set_task_status(&id, input).await)?;
    let payload = TaskStatusChangedEventDto {
        task_id: updated.id.clone(),
        project_id: updated.project_id.clone(),
        run_id: None,
        previous_status: existing.status,
        new_status: updated.status.clone(),
        transition_source: "manual_status_change".to_string(),
        timestamp: updated.updated_at.clone(),
    };
    map_result(transition_service.emit_task_status_changed(&payload))?;
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
