use crate::app::projects::service::ProjectsService;
use crate::app::runs::service::RunsService;
use crate::app::state::AppState;
use crate::app::tasks::service::TasksService;

pub fn projects_service(state: &tauri::State<'_, AppState>) -> ProjectsService {
    state.projects_service.clone()
}

pub fn tasks_service(state: &tauri::State<'_, AppState>) -> TasksService {
    state.tasks_service.clone()
}

pub fn runs_service(state: &tauri::State<'_, AppState>) -> RunsService {
    state.runs_service.clone()
}
