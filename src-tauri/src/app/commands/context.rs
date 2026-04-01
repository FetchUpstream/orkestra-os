use crate::app::projects::service::ProjectsService;
use crate::app::runs::diff_service::RunsDiffService;
use crate::app::runs::merge_service::RunsMergeService;
use crate::app::runs::opencode_service::RunsOpenCodeService;
use crate::app::runs::service::RunsService;
use crate::app::state::AppState;
use crate::app::tasks::service::TasksService;
use crate::app::tasks::status_transition_service::TaskStatusTransitionService;
use crate::app::terminal::service::TerminalService;
use crate::app::worktrees::service::WorktreesService;

pub fn projects_service(state: &tauri::State<'_, AppState>) -> ProjectsService {
    state.projects_service.clone()
}

pub fn tasks_service(state: &tauri::State<'_, AppState>) -> TasksService {
    state.tasks_service.clone()
}

pub fn task_status_transition_service(
    state: &tauri::State<'_, AppState>,
) -> TaskStatusTransitionService {
    state.task_status_transition_service.clone()
}

pub fn runs_service(state: &tauri::State<'_, AppState>) -> RunsService {
    state.runs_service.clone()
}

pub fn runs_diff_service(state: &tauri::State<'_, AppState>) -> RunsDiffService {
    state.runs_diff_service.clone()
}

pub fn runs_opencode_service(state: &tauri::State<'_, AppState>) -> RunsOpenCodeService {
    state.runs_opencode_service.clone()
}

pub fn runs_merge_service(state: &tauri::State<'_, AppState>) -> RunsMergeService {
    state.runs_merge_service.clone()
}

pub fn worktrees_service(state: &tauri::State<'_, AppState>) -> WorktreesService {
    state.worktrees_service.clone()
}

pub fn terminal_service(state: &tauri::State<'_, AppState>) -> TerminalService {
    state.terminal_service.clone()
}
