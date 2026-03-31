use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunDto {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub target_repo_id: Option<String>,
    pub status: String,
    pub triggered_by: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub summary: Option<String>,
    pub error_message: Option<String>,
    pub worktree_id: Option<String>,
    pub agent_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub source_branch: Option<String>,
    pub initial_prompt_sent_at: Option<String>,
    pub initial_prompt_client_request_id: Option<String>,
    pub setup_state: String,
    pub setup_started_at: Option<String>,
    pub setup_finished_at: Option<String>,
    pub setup_error_message: Option<String>,
    pub cleanup_state: String,
    pub cleanup_started_at: Option<String>,
    pub cleanup_finished_at: Option<String>,
    pub cleanup_error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunModelSelectionDto {
    pub provider_id: String,
    pub provider_name: Option<String>,
    pub model_id: String,
    pub model_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProviderDto {
    pub id: String,
    pub name: Option<String>,
    pub models: Vec<RunModelSelectionDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProvidersResponseDto {
    pub providers: Vec<RunProviderDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAgentDto {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAgentsResponseDto {
    pub agents: Vec<RunAgentDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSelectionCatalogResponseDto {
    pub agents: Vec<RunAgentDto>,
    pub providers: Vec<RunProviderDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunDiffFileDto {
    pub path: String,
    pub additions: usize,
    pub deletions: usize,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunDiffFilePayloadDto {
    pub path: String,
    pub additions: usize,
    pub deletions: usize,
    pub original: String,
    pub modified: String,
    pub language: String,
    pub status: String,
    pub is_binary: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunDiffUpdatedEventDto {
    pub run_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawAgentEvent {
    pub timestamp: String,
    pub event_name: String,
    pub payload: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureRunOpenCodeResponse {
    pub state: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeDependencyStatusDto {
    pub state: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunOpenCodePromptResponse {
    pub state: String,
    pub reason: Option<String>,
    pub queued_at: String,
    pub client_request_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyRunOpenCodePermissionResponse {
    pub state: String,
    pub reason: Option<String>,
    pub replied_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunOpenCodeResponse {
    pub state: String,
    pub reason: Option<String>,
    pub queued_at: String,
    pub client_request_id: String,
    pub ready_phase: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOpenCodeSessionMessageDto {
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOpenCodeSessionTodoDto {
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMergeStatusDto {
    pub run_id: String,
    pub source_branch: String,
    pub worktree_branch: String,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub is_worktree_clean: bool,
    pub repository_state: String,
    pub is_rebase_in_progress: bool,
    pub state: String,
    pub can_rebase: bool,
    pub can_merge: bool,
    pub disable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMergeConflictDto {
    pub files: Vec<String>,
    pub chat_prompt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRebaseResponseDto {
    pub state: String,
    pub status: RunMergeStatusDto,
    pub conflict: Option<RunMergeConflictDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMergeResponseDto {
    pub state: String,
    pub status: RunMergeStatusDto,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOpenCodeChatModeDto {
    Interactive,
    ReadOnly,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRunOpenCodeResponse {
    pub state: String,
    pub reason: Option<String>,
    pub chat_mode: RunOpenCodeChatModeDto,
    pub buffered_events: Vec<RawAgentEvent>,
    pub messages: Vec<RunOpenCodeSessionMessageDto>,
    pub todos: Vec<RunOpenCodeSessionTodoDto>,
    pub session_id: Option<String>,
    pub stream_connected: bool,
    pub ready_phase: Option<String>,
}
