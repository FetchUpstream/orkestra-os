use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub project_id: String,
    pub repository_id: String,
    pub title: String,
    pub description: Option<String>,
    pub implementation_guide: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub implementation_guide: Option<Option<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SetTaskStatusRequest {
    pub status: String,
    pub source_action: Option<String>,
    pub agent_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskUpdatedEventDto {
    pub task_id: String,
    pub project_id: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoveTaskRequest {
    pub repository_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeleteTaskResponse {
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskDto {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub task_number: i64,
    pub display_key: String,
    pub title: String,
    pub description: Option<String>,
    pub implementation_guide: Option<String>,
    pub status: String,
    pub blocked_by_count: i64,
    pub is_blocked: bool,
    pub target_repository_name: Option<String>,
    pub target_repository_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskDependencyTaskDto {
    pub id: String,
    pub display_key: String,
    pub title: String,
    pub status: String,
    pub target_repository_name: Option<String>,
    pub target_repository_path: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskDependenciesDto {
    pub task_id: String,
    pub parents: Vec<TaskDependencyTaskDto>,
    pub children: Vec<TaskDependencyTaskDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AddTaskDependencyRequest {
    pub parent_task_id: String,
    pub child_task_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskDependencyEdgeDto {
    pub parent_task_id: String,
    pub child_task_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveTaskDependencyRequest {
    pub parent_task_id: String,
    pub child_task_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveTaskDependencyResponse {
    pub parent_task_id: String,
    pub child_task_id: String,
    pub removed: bool,
}
