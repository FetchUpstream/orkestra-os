#[derive(Clone, Debug)]
pub struct Run {
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
    pub opencode_session_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewRun {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub target_repo_id: Option<String>,
    pub status: String,
    pub triggered_by: String,
    pub created_at: String,
    pub worktree_id: Option<String>,
    pub source_branch: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TaskRunContext {
    pub project_id: String,
    pub repository_id: String,
    pub repository_path: String,
    pub branch_title: String,
}
