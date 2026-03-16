use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateWorktreeRequest {
    pub project_id: String,
    pub repo_path: String,
    pub branch_title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateWorktreeResponse {
    pub worktree_id: String,
    pub branch_name: String,
    pub source_branch: Option<String>,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveWorktreeRequest {
    pub repo_path: String,
    pub worktree_id: String,
}
