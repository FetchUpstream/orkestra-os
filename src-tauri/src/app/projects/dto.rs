use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectDto {
    pub id: String,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub default_repo_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: Option<String>,
    pub key: String,
    pub repositories: Vec<CreateProjectRepositoryRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: String,
    pub description: Option<String>,
    pub key: String,
    pub repositories: Vec<CreateProjectRepositoryRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloneProjectRequest {
    pub name: String,
    pub key: String,
    pub repository_destination: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateProjectRepositoryRequest {
    pub id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectRepositoryDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectDetailsDto {
    pub project: ProjectDto,
    pub repositories: Vec<ProjectRepositoryDto>,
}
