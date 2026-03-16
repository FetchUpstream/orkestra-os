use serde::{Deserialize, Serialize};

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
