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

use crate::app::runs::dto::{
    BootstrapRunOpenCodeResponse, EnsureRunOpenCodeResponse, OpenCodeDependencyStatusDto,
    RawAgentEvent, RejectRunOpenCodeQuestionResponse, ReplyRunOpenCodePermissionResponse,
    ReplyRunOpenCodeQuestionResponse, RunAgentsResponseDto, RunDiffFileDto, RunDiffFilePayloadDto,
    RunDto, RunMergeResponseDto, RunMergeStatusDto, RunOpenCodeQuestionRequestDto,
    RunOpenCodeSessionMessageDto, RunOpenCodeSessionMessagesPageDto, RunOpenCodeSessionTodoDto,
    RunProvidersResponseDto, RunRebaseResponseDto, StartRunOpenCodeResponse,
    StopRunOpenCodeResponse, SubmitRunOpenCodePromptResponse,
};
use crate::app::state::AppState;
use crate::app::{commands::context, commands::error_mapping::map_result};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunOpenCodePromptRequest {
    pub run_id: String,
    pub prompt: String,
    pub client_request_id: Option<String>,
    pub run_state_hint: Option<String>,
    pub agent: Option<String>,
    pub agent_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRunRequest {
    pub task_id: String,
    pub agent_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub source_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyRunOpenCodePermissionRequest {
    pub run_id: String,
    pub session_id: String,
    pub request_id: String,
    pub decision: String,
    pub remember: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyRunOpenCodeQuestionRequest {
    pub run_id: String,
    pub request_id: String,
    pub answers: Vec<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectRunOpenCodeQuestionRequest {
    pub run_id: String,
    pub request_id: String,
}

#[tauri::command]
pub async fn create_run(
    state: tauri::State<'_, AppState>,
    request: CreateRunRequest,
) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(
        service
            .create_run_with_defaults(
                &request.task_id,
                request.agent_id.as_deref(),
                request.provider_id.as_deref(),
                request.model_id.as_deref(),
                request.source_branch.as_deref(),
            )
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_task_run_source_branches(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<crate::app::worktrees::dto::LocalBranchDto>, String> {
    let service = context::runs_service(&state);
    map_result(service.list_task_source_branches(&task_id).await)
}

#[tauri::command]
pub async fn list_task_runs(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Vec<RunDto>, String> {
    let service = context::runs_service(&state);
    map_result(service.list_task_runs(&task_id).await)
}

#[tauri::command]
pub async fn list_active_runs(state: tauri::State<'_, AppState>) -> Result<Vec<RunDto>, String> {
    let service = context::runs_service(&state);
    map_result(service.list_active_runs().await)
}

#[tauri::command]
pub async fn get_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(service.get_run(&run_id).await)
}

#[tauri::command]
pub async fn delete_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<(), String> {
    let service = context::runs_delete_service(&state);
    map_result(service.delete_run(&run_id).await)
}

#[tauri::command]
pub async fn list_run_diff_files(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Vec<RunDiffFileDto>, String> {
    let service = context::runs_diff_service(&state);
    map_result(service.list_run_diff_files(&run_id).await)
}

#[tauri::command]
pub async fn get_run_diff_file(
    state: tauri::State<'_, AppState>,
    run_id: String,
    path: String,
) -> Result<RunDiffFilePayloadDto, String> {
    let service = context::runs_diff_service(&state);
    map_result(service.get_run_diff_file(&run_id, &path).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_run_merge_status(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunMergeStatusDto, String> {
    let service = context::runs_merge_service(&state);
    map_result(service.get_merge_status(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_run_git_merge_status(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunMergeStatusDto, String> {
    get_run_merge_status(state, run_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rebase_run_worktree_branch(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunRebaseResponseDto, String> {
    let service = context::runs_merge_service(&state);
    map_result(service.rebase_worktree_branch(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rebase_run_worktree_onto_source(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunRebaseResponseDto, String> {
    rebase_run_worktree_branch(state, run_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn merge_run_into_source_branch(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunMergeResponseDto, String> {
    let service = context::runs_merge_service(&state);
    map_result(service.merge_into_source_branch(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn merge_run_worktree_into_source(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<RunMergeResponseDto, String> {
    merge_run_into_source_branch(state, run_id).await
}

#[tauri::command]
pub async fn set_run_diff_watch(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    run_id: String,
    enabled: bool,
) -> Result<(), String> {
    let service = context::runs_diff_service(&state);
    map_result(
        service
            .set_run_diff_watch(&window.app_handle(), &window, &run_id, enabled)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ensure_run_opencode(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<EnsureRunOpenCodeResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.ensure_run_opencode(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_opencode_dependency_status(
    state: tauri::State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<OpenCodeDependencyStatusDto, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .get_opencode_dependency_status(force_refresh.unwrap_or(false))
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn bootstrap_run_opencode(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<BootstrapRunOpenCodeResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.bootstrap_run_opencode(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_run_opencode(
    state: tauri::State<'_, AppState>,
    run_id: String,
    reason: Option<String>,
) -> Result<StopRunOpenCodeResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.stop_run_opencode(&run_id, reason.as_deref()).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn subscribe_run_opencode_events(
    state: tauri::State<'_, AppState>,
    run_id: String,
    subscriber_id: String,
    on_output: Channel<RawAgentEvent>,
) -> Result<(), String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .subscribe_run_opencode_events(&subscriber_id, &run_id, on_output)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unsubscribe_run_opencode_events(
    state: tauri::State<'_, AppState>,
    run_id: String,
    subscriber_id: String,
) -> Result<(), String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .unsubscribe_run_opencode_events(&subscriber_id, &run_id)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_buffered_run_opencode_events(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Vec<RawAgentEvent>, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.get_buffered_run_opencode_events(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn submit_run_opencode_prompt(
    state: tauri::State<'_, AppState>,
    request: SubmitRunOpenCodePromptRequest,
) -> Result<SubmitRunOpenCodePromptResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .submit_run_opencode_prompt(
                &request.run_id,
                &request.prompt,
                request.client_request_id,
                request.run_state_hint,
                request.agent_id.or(request.agent),
                request.provider_id,
                request.model_id,
            )
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_run_opencode_providers(
    state: tauri::State<'_, AppState>,
) -> Result<RunProvidersResponseDto, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.list_run_opencode_providers().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_run_opencode_agents(
    state: tauri::State<'_, AppState>,
) -> Result<RunAgentsResponseDto, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.list_run_opencode_agents().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reply_run_opencode_permission(
    state: tauri::State<'_, AppState>,
    request: ReplyRunOpenCodePermissionRequest,
) -> Result<ReplyRunOpenCodePermissionResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .reply_run_opencode_permission(
                &request.run_id,
                &request.session_id,
                &request.request_id,
                &request.decision,
                request.remember.unwrap_or(false),
            )
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_run_opencode_question_requests(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Vec<RunOpenCodeQuestionRequestDto>, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.list_run_opencode_question_requests(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reply_run_opencode_question(
    state: tauri::State<'_, AppState>,
    request: ReplyRunOpenCodeQuestionRequest,
) -> Result<ReplyRunOpenCodeQuestionResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .reply_run_opencode_question(&request.run_id, &request.request_id, request.answers)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reject_run_opencode_question(
    state: tauri::State<'_, AppState>,
    request: RejectRunOpenCodeQuestionRequest,
) -> Result<RejectRunOpenCodeQuestionResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .reject_run_opencode_question(&request.run_id, &request.request_id)
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_run_opencode(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<StartRunOpenCodeResponse, String> {
    let service = context::runs_opencode_service(&state);
    map_result(service.start_run_opencode(&run_id).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_run_opencode_session_messages(
    state: tauri::State<'_, AppState>,
    run_id: String,
    session_id: Option<String>,
) -> Result<Vec<RunOpenCodeSessionMessageDto>, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .get_run_opencode_session_messages(&run_id, session_id.as_deref())
            .await,
    )
}

/// Additive paged transcript API retained alongside the legacy full-history
/// command so the current run-details UI can stay unchanged until Phase 2.
#[tauri::command(rename_all = "camelCase")]
pub async fn get_run_opencode_session_messages_page(
    state: tauri::State<'_, AppState>,
    run_id: String,
    session_id: Option<String>,
    limit: Option<usize>,
    before: Option<String>,
) -> Result<RunOpenCodeSessionMessagesPageDto, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .get_run_opencode_session_messages_page(
                &run_id,
                session_id.as_deref(),
                limit,
                before.as_deref(),
            )
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_run_opencode_session_todos(
    state: tauri::State<'_, AppState>,
    run_id: String,
    session_id: Option<String>,
) -> Result<Vec<RunOpenCodeSessionTodoDto>, String> {
    let service = context::runs_opencode_service(&state);
    map_result(
        service
            .get_run_opencode_session_todos(&run_id, session_id.as_deref())
            .await,
    )
}
