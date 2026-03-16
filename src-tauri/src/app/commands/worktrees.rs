use crate::app::state::AppState;
use crate::app::worktrees::dto::{
    CreateWorktreeRequest, CreateWorktreeResponse, RemoveWorktreeRequest,
};
use crate::app::{commands::context, commands::error_mapping::map_result};

#[tauri::command]
pub async fn create_worktree(
    state: tauri::State<'_, AppState>,
    input: CreateWorktreeRequest,
) -> Result<CreateWorktreeResponse, String> {
    let service = context::worktrees_service(&state);
    map_result(service.create(input))
}

#[tauri::command]
pub async fn remove_worktree(
    state: tauri::State<'_, AppState>,
    input: RemoveWorktreeRequest,
) -> Result<(), String> {
    let service = context::worktrees_service(&state);
    map_result(service.remove(input))
}
