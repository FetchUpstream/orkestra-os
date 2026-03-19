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
    pub project_key: String,
    pub repository_id: String,
    pub repository_path: String,
    pub branch_title: String,
}

#[derive(Clone, Debug)]
pub struct RunInitialPromptContext {
    pub run_id: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub task_implementation_guide: Option<String>,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
}
