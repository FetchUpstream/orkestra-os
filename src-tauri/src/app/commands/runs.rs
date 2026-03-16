use crate::app::runs::dto::{
    EnsureRunOpenCodeResponse, RawAgentEvent, RunDiffFileDto, RunDiffFilePayloadDto, RunDto,
    SubmitRunOpenCodePromptResponse,
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
}

#[tauri::command]
pub async fn create_run(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(service.create_run(&task_id).await)
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
pub async fn get_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<RunDto, String> {
    let service = context::runs_service(&state);
    map_result(service.get_run(&run_id).await)
}

#[tauri::command]
pub async fn delete_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<(), String> {
    let service = context::runs_service(&state);
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
pub async fn subscribe_run_opencode_events(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    run_id: String,
    on_output: Channel<RawAgentEvent>,
) -> Result<(), String> {
    let service = context::runs_opencode_service(&state);
    let subscriber_id = format!("{}:{}:{}", window.label(), run_id, uuid::Uuid::new_v4());
    map_result(
        service
            .subscribe_run_opencode_events(&subscriber_id, &run_id, on_output)
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
            .submit_run_opencode_prompt(&request.run_id, &request.prompt, request.client_request_id)
            .await,
    )
}
