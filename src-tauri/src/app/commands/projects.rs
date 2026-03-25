use crate::app::projects::dto::{
    CloneProjectRequest, CreateProjectRequest, ProjectDetailsDto, ProjectDto,
    ProjectFileSearchResultDto, SearchProjectFilesRequest, UpdateProjectRequest,
};
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
) -> Result<Vec<ProjectFileSearchResultDto>, String> {
    let service = context::projects_service(&state);
    map_result(
        service
            .search_project_files(&input.project_id, &input.query, input.limit)
            .await,
    )
}
