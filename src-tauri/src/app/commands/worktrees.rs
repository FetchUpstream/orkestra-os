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
