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
    pub source_branch: Option<String>,
    pub initial_prompt_sent_at: Option<String>,
    pub initial_prompt_client_request_id: Option<String>,
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
pub struct SubmitRunOpenCodePromptResponse {
    pub state: String,
    pub reason: Option<String>,
    pub queued_at: String,
    pub client_request_id: Option<String>,
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
pub struct BootstrapRunOpenCodeResponse {
    pub state: String,
    pub reason: Option<String>,
    pub buffered_events: Vec<RawAgentEvent>,
    pub messages: Vec<RunOpenCodeSessionMessageDto>,
    pub todos: Vec<RunOpenCodeSessionTodoDto>,
    pub session_id: Option<String>,
    pub stream_connected: bool,
    pub ready_phase: Option<String>,
}
