use crate::app::projects::service::ProjectsService;
use crate::app::state::AppState;
use crate::app::tasks::service::TasksService;

pub fn projects_service(state: &tauri::State<'_, AppState>) -> ProjectsService {
    state.projects_service.clone()
}

pub fn tasks_service(state: &tauri::State<'_, AppState>) -> TasksService {
    state.tasks_service.clone()
}
