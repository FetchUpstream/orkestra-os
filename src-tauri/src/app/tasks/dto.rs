use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub project_id: String,
    pub repository_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskDto {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}
