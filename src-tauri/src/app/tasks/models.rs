#[derive(Clone, Debug)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub task_number: i64,
    pub display_key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub target_repository_name: Option<String>,
    pub target_repository_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct NewTask {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}
