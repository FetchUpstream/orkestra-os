use crate::app::projects::dto::{CreateProjectRequest, ProjectDetailsDto, ProjectDto};
use crate::app::state::AppState;

#[tauri::command]
pub async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectDto>, String> {
    let service = state
        .projects_service
        .as_ref()
        .ok_or_else(|| "projects service unavailable".to_string())?;
    service.list_projects().await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_project(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<ProjectDetailsDto, String> {
    let service = state
        .projects_service
        .as_ref()
        .ok_or_else(|| "projects service unavailable".to_string())?;
    service.get_project(&id).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_project(
    state: tauri::State<'_, AppState>,
    input: CreateProjectRequest,
) -> Result<ProjectDetailsDto, String> {
    let service = state
        .projects_service
        .as_ref()
        .ok_or_else(|| "projects service unavailable".to_string())?;
    service.create_project(input).await.map_err(|err| err.to_string())
}
