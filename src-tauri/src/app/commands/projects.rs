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

use crate::app::projects::dto::{
    CloneProjectRequest, CreateProjectRequest, LocalDirectorySearchResultDto, ProjectDetailsDto,
    ProjectDto, SearchLocalDirectoriesRequest, SearchProjectFilesRequest, UpdateProjectRequest,
};
use crate::app::runs::dto::RunSelectionCatalogResponseDto;
use crate::app::state::AppState;
use crate::app::{commands::context, commands::error_mapping::map_result};

#[tauri::command]
pub async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectDto>, String> {
    let service = context::projects_service(&state);
    map_result(service.list_projects().await)
}

#[tauri::command]
pub async fn get_project(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<ProjectDetailsDto, String> {
    let service = context::projects_service(&state);
    map_result(service.get_project(&id).await)
}

#[tauri::command]
pub async fn create_project(
    state: tauri::State<'_, AppState>,
    input: CreateProjectRequest,
) -> Result<ProjectDetailsDto, String> {
    let service = context::projects_service(&state);
    map_result(service.create_project(input).await)
}

#[tauri::command]
pub async fn update_project(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateProjectRequest,
) -> Result<ProjectDetailsDto, String> {
    let service = context::projects_service(&state);
    map_result(service.update_project(&id, input).await)
}

#[tauri::command]
pub async fn clone_project(
    state: tauri::State<'_, AppState>,
    source_project_id: String,
    input: CloneProjectRequest,
) -> Result<ProjectDetailsDto, String> {
    let service = context::projects_service(&state);
    map_result(service.clone_project(&source_project_id, input).await)
}

#[tauri::command]
pub async fn delete_project(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let service = context::projects_service(&state);
    map_result(service.delete_project(&id).await)
}

#[tauri::command]
pub async fn search_project_files(
    state: tauri::State<'_, AppState>,
    input: SearchProjectFilesRequest,
) -> Result<Vec<String>, String> {
    let service = context::projects_service(&state);
    map_result(
        service
            .search_project_files(
                &input.project_id,
                &input.repository_id,
                &input.query,
                input.limit,
            )
            .await,
    )
}

#[tauri::command]
pub async fn search_local_directories(
    state: tauri::State<'_, AppState>,
    input: SearchLocalDirectoriesRequest,
) -> Result<Vec<LocalDirectorySearchResultDto>, String> {
    let service = context::projects_service(&state);
    map_result(
        service
            .search_local_directories(&input.query, input.limit)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_project_opencode_selection_catalog(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<RunSelectionCatalogResponseDto, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .get_project_opencode_selection_catalog(&project_id)
            .await,
    )
}
