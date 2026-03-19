use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::errors::AppError;
use crate::app::projects::dto::{
    CloneProjectRequest, CreateProjectRequest, ProjectDetailsDto, ProjectDto, ProjectRepositoryDto,
    UpdateProjectRequest,
};
use crate::app::projects::models::{NewProject, NewProjectRepository, UpsertProjectRepository};
use chrono::Utc;

#[derive(Clone, Debug)]
pub struct ProjectsService {
    repository: ProjectsRepository,
}

impl ProjectsService {
    pub fn new(repository: ProjectsRepository) -> Self {
        Self { repository }
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectDto>, AppError> {
        let projects = self.repository.list_projects().await?;
        Ok(projects
            .into_iter()
            .map(|project| ProjectDto {
                id: project.id,
                key: project.key,
                name: project.name,
                description: project.description,
                default_repo_id: project.default_repo_id,
                created_at: project.created_at,
                updated_at: project.updated_at,
            })
            .collect())
    }

    pub async fn get_project(&self, id: &str) -> Result<ProjectDetailsDto, AppError> {
        let details = self
            .repository
            .get_project(id)
            .await?
            .ok_or_else(|| AppError::not_found("project not found"))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: details.project.id,
                key: details.project.key,
                name: details.project.name,
                description: details.project.description,
                default_repo_id: details.project.default_repo_id,
                created_at: details.project.created_at,
                updated_at: details.project.updated_at,
            },
            repositories: details
                .repositories
                .into_iter()
                .map(|repository| ProjectRepositoryDto {
                    id: repository.id,
                    project_id: repository.project_id,
                    name: repository.name,
                    repo_path: repository.repo_path,
                    is_default: repository.is_default,
                    created_at: repository.created_at,
                })
                .collect(),
        })
    }

    pub async fn create_project(
        &self,
        mut input: CreateProjectRequest,
    ) -> Result<ProjectDetailsDto, AppError> {
        input.key = input.key.trim().to_string();
        self.validate_key(&input.key)?;
        self.validate_repositories(&input.repositories)?;

        if self.repository.key_exists(&input.key).await? {
            return Err(AppError::validation("project key already exists"));
        }

        let now = Utc::now().to_rfc3339();
        let new_project = NewProject {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name.trim().to_string(),
            key: input.key,
            description: input
                .description
                .map(|description| description.trim().to_string()),
            default_repo_id: None,
            created_at: now.clone(),
            updated_at: now,
            repositories: input
                .repositories
                .into_iter()
                .map(|repository| NewProjectRepository {
                    name: repository.name.trim().to_string(),
                    repo_path: repository.repo_path.trim().to_string(),
                    is_default: repository.is_default,
                })
                .collect(),
        };

        let created = self.repository.create_project(new_project).await?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: created.project.id,
                key: created.project.key,
                name: created.project.name,
                description: created.project.description,
                default_repo_id: created.project.default_repo_id,
                created_at: created.project.created_at,
                updated_at: created.project.updated_at,
            },
            repositories: created
                .repositories
                .into_iter()
                .map(|repository| ProjectRepositoryDto {
                    id: repository.id,
                    project_id: repository.project_id,
                    name: repository.name,
                    repo_path: repository.repo_path,
                    is_default: repository.is_default,
                    created_at: repository.created_at,
                })
                .collect(),
        })
    }

    pub async fn update_project(
        &self,
        id: &str,
        mut input: UpdateProjectRequest,
    ) -> Result<ProjectDetailsDto, AppError> {
        input.key = input.key.trim().to_string();
        self.validate_key(&input.key)?;
        self.validate_repositories(&input.repositories)?;

        if self
            .repository
            .key_exists_for_other_project(&input.key, id)
            .await?
        {
            return Err(AppError::validation("project key already exists"));
        }

        let now = Utc::now().to_rfc3339();
        let normalized_description = input
            .description
            .map(|description| description.trim().to_string());
        let normalized_name = input.name.trim().to_string();
        let normalized_repositories = input
            .repositories
            .into_iter()
            .map(|repository| UpsertProjectRepository {
                id: repository.id,
                name: repository.name.trim().to_string(),
                repo_path: repository.repo_path.trim().to_string(),
                is_default: repository.is_default,
            })
            .collect::<Vec<_>>();

        let updated = self
            .repository
            .update_project(
                id,
                &normalized_name,
                &input.key,
                &normalized_description,
                &now,
                &normalized_repositories,
            )
            .await?
            .ok_or_else(|| AppError::not_found("project not found"))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: updated.project.id,
                key: updated.project.key,
                name: updated.project.name,
                description: updated.project.description,
                default_repo_id: updated.project.default_repo_id,
                created_at: updated.project.created_at,
                updated_at: updated.project.updated_at,
            },
            repositories: updated
                .repositories
                .into_iter()
                .map(|repository| ProjectRepositoryDto {
                    id: repository.id,
                    project_id: repository.project_id,
                    name: repository.name,
                    repo_path: repository.repo_path,
                    is_default: repository.is_default,
                    created_at: repository.created_at,
                })
                .collect(),
        })
    }

    pub async fn clone_project(
        &self,
        source_project_id: &str,
        mut input: CloneProjectRequest,
    ) -> Result<ProjectDetailsDto, AppError> {
        input.name = input.name.trim().to_string();
        input.key = input.key.trim().to_string();

        if input.name.is_empty() {
            return Err(AppError::validation("project name is required"));
        }

        self.validate_key(&input.key)?;

        if input.repository_destination.trim().is_empty() {
            return Err(AppError::validation("repository destination is required"));
        }

        if self.repository.key_exists(&input.key).await? {
            return Err(AppError::validation("project key already exists"));
        }

        let source = self
            .repository
            .get_project(source_project_id)
            .await?
            .ok_or_else(|| AppError::not_found("project not found"))?;

        if source.repositories.len() != 1 {
            return Err(AppError::validation(
                "cloning requires exactly one source repository",
            ));
        }

        let now = Utc::now().to_rfc3339();
        let cloned = self
            .repository
            .clone_project(
                source_project_id,
                &uuid::Uuid::new_v4().to_string(),
                &input.name,
                &input.key,
                &input.repository_destination.trim().to_string(),
                &now,
            )
            .await?
            .ok_or_else(|| AppError::not_found("project not found"))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: cloned.project.id,
                key: cloned.project.key,
                name: cloned.project.name,
                description: cloned.project.description,
                default_repo_id: cloned.project.default_repo_id,
                created_at: cloned.project.created_at,
                updated_at: cloned.project.updated_at,
            },
            repositories: cloned
                .repositories
                .into_iter()
                .map(|repository| ProjectRepositoryDto {
                    id: repository.id,
                    project_id: repository.project_id,
                    name: repository.name,
                    repo_path: repository.repo_path,
                    is_default: repository.is_default,
                    created_at: repository.created_at,
                })
                .collect(),
        })
    }

    fn validate_key(&self, key: &str) -> Result<(), AppError> {
        if key.is_empty() {
            return Err(AppError::validation("project key is required"));
        }

        let len = key.len();
        if !(2..=4).contains(&len) {
            return Err(AppError::validation("project key length must be 2 to 4"));
        }

        if !key
            .chars()
            .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
        {
            return Err(AppError::validation(
                "project key must be uppercase alphanumeric",
            ));
        }

        Ok(())
    }

    fn validate_repositories(
        &self,
        repositories: &[crate::app::projects::dto::CreateProjectRepositoryRequest],
    ) -> Result<(), AppError> {
        if repositories.is_empty() {
            return Err(AppError::validation("at least one repository is required"));
        }

        let default_count = repositories
            .iter()
            .filter(|repository| repository.is_default)
            .count();
        if default_count != 1 {
            return Err(AppError::validation(
                "exactly one default repository is required",
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use sqlx::SqlitePool;

    async fn setup_service() -> ProjectsService {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        ProjectsService::new(ProjectsRepository::new(pool))
    }

    #[tokio::test]
    async fn clone_project_rejects_multi_repository_source() {
        let service = setup_service().await;

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRC".to_string(),
                repositories: vec![
                    crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: None,
                        name: "Main".to_string(),
                        repo_path: "/repo/main".to_string(),
                        is_default: true,
                    },
                    crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: None,
                        name: "Docs".to_string(),
                        repo_path: "/repo/docs".to_string(),
                        is_default: false,
                    },
                ],
            })
            .await
            .unwrap();

        let result = service
            .clone_project(
                &source.project.id,
                CloneProjectRequest {
                    name: "Source Clone".to_string(),
                    key: "CPY".to_string(),
                    repository_destination: "/repo/destination".to_string(),
                },
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "cloning requires exactly one source repository"
        );
    }

    #[tokio::test]
    async fn clone_project_rejects_zero_repository_source() {
        let service = setup_service().await;

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRZ".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                }],
            })
            .await
            .unwrap();

        service
            .repository
            .update_project(
                &source.project.id,
                &source.project.name,
                &source.project.key,
                &source.project.description,
                "2024-01-02T00:00:00Z",
                &[],
            )
            .await
            .unwrap()
            .unwrap();

        let result = service
            .clone_project(
                &source.project.id,
                CloneProjectRequest {
                    name: "Source Clone".to_string(),
                    key: "CPY".to_string(),
                    repository_destination: "/repo/destination".to_string(),
                },
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "cloning requires exactly one source repository"
        );
    }

    #[tokio::test]
    async fn clone_project_rejects_empty_name() {
        let service = setup_service().await;

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRC".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                }],
            })
            .await
            .unwrap();

        let result = service
            .clone_project(
                &source.project.id,
                CloneProjectRequest {
                    name: "   ".to_string(),
                    key: "CPY".to_string(),
                    repository_destination: "/repo/destination".to_string(),
                },
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "project name is required"
        );
    }
}
