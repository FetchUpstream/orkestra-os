#[derive(Clone, Debug)]
pub struct Project {
    pub id: String,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub default_repo_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct ProjectRepository {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct ProjectDetails {
    pub project: Project,
    pub repositories: Vec<ProjectRepository>,
}

#[derive(Clone, Debug)]
pub struct NewProjectRepository {
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
}

#[derive(Clone, Debug)]
pub struct UpsertProjectRepository {
    pub id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
}

#[derive(Clone, Debug)]
pub struct NewProject {
    pub id: String,
    pub name: String,
    pub key: String,
    pub description: Option<String>,
    pub default_repo_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub repositories: Vec<NewProjectRepository>,
}
