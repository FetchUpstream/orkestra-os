use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::errors::AppError;
use crate::app::projects::dto::{
    CloneProjectRequest, CreateProjectRequest, ProjectDetailsDto, ProjectDto, ProjectRepositoryDto,
    UpdateProjectRequest,
};
use crate::app::projects::errors::ProjectsServiceError;
use crate::app::projects::models::{NewProject, NewProjectRepository, UpsertProjectRepository};
use crate::app::projects::search_service::ProjectFileSearchService;
use crate::app::worktrees::service::WorktreesService;
use chrono::Utc;

#[derive(Clone, Debug)]
pub struct ProjectsService {
    repository: ProjectsRepository,
    file_search_service: ProjectFileSearchService,
    worktrees_service: WorktreesService,
}

impl ProjectsService {
    pub fn new(
        repository: ProjectsRepository,
        file_search_service: ProjectFileSearchService,
        worktrees_service: WorktreesService,
    ) -> Self {
        Self {
            repository,
            file_search_service,
            worktrees_service,
        }
    }

    pub async fn search_project_files(
        &self,
        project_id: &str,
        repository_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<String>, AppError> {
        self.search_project_files_internal(project_id, repository_id, query, limit)
            .await
            .map_err(AppError::from)
    }

    async fn search_project_files_internal(
        &self,
        project_id: &str,
        repository_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<String>, ProjectsServiceError> {
        let details = self
            .repository
            .get_project(project_id)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })?
            .ok_or(ProjectsServiceError::NotFound("project not found"))?;

        let repository = details
            .repositories
            .into_iter()
            .find(|repository| repository.id == repository_id)
            .ok_or(ProjectsServiceError::Validation(
                "repository not found for project",
            ))?;

        self.file_search_service
            .search_project_files(repository, query, limit)
            .await
            .map_err(|source| ProjectsServiceError::SearchProjectFiles { source })
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectDto>, AppError> {
        let projects = self
            .repository
            .list_projects()
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?;
        Ok(projects
            .into_iter()
            .map(|project| ProjectDto {
                id: project.id,
                key: project.key,
                name: project.name,
                description: project.description,
                default_repo_id: project.default_repo_id,
                default_run_agent: project.default_run_agent,
                default_run_provider: project.default_run_provider,
                default_run_model: project.default_run_model,
                created_at: project.created_at,
                updated_at: project.updated_at,
            })
            .collect())
    }

    pub async fn get_project(&self, id: &str) -> Result<ProjectDetailsDto, AppError> {
        let details = self
            .repository
            .get_project(id)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::from(ProjectsServiceError::NotFound("project not found")))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: details.project.id,
                key: details.project.key,
                name: details.project.name,
                description: details.project.description,
                default_repo_id: details.project.default_repo_id,
                default_run_agent: details.project.default_run_agent,
                default_run_provider: details.project.default_run_provider,
                default_run_model: details.project.default_run_model,
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
                    setup_script: repository.setup_script,
                    cleanup_script: repository.cleanup_script,
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
        let default_run_agent = input
            .default_run_agent
            .take()
            .map(|agent| agent.trim().to_string())
            .filter(|agent| !agent.is_empty());
        input.default_run_provider = input.default_run_provider.trim().to_string();
        input.default_run_model = input.default_run_model.trim().to_string();
        self.validate_key(&input.key).map_err(AppError::from)?;
        self.validate_repositories(&input.repositories)
            .map_err(AppError::from)?;
        self.validate_run_defaults(&input.default_run_provider, &input.default_run_model)
            .map_err(AppError::from)?;

        if self
            .repository
            .key_exists(&input.key)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
        {
            return Err(AppError::from(ProjectsServiceError::Validation(
                "project key already exists",
            )));
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
            default_run_agent,
            default_run_provider: Some(input.default_run_provider),
            default_run_model: Some(input.default_run_model),
            created_at: now.clone(),
            updated_at: now,
            repositories: input
                .repositories
                .into_iter()
                .map(|repository| NewProjectRepository {
                    name: repository.name.trim().to_string(),
                    repo_path: repository.repo_path.trim().to_string(),
                    is_default: repository.is_default,
                    setup_script: repository
                        .setup_script
                        .map(|script| script.trim().to_string())
                        .filter(|script| !script.is_empty()),
                    cleanup_script: repository
                        .cleanup_script
                        .map(|script| script.trim().to_string())
                        .filter(|script| !script.is_empty()),
                })
                .collect(),
        };

        let created = self
            .repository
            .create_project(new_project)
            .await
            .map_err(|source| ProjectsServiceError::PersistProjectData { source })
            .map_err(AppError::from)?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: created.project.id,
                key: created.project.key,
                name: created.project.name,
                description: created.project.description,
                default_repo_id: created.project.default_repo_id,
                default_run_agent: created.project.default_run_agent,
                default_run_provider: created.project.default_run_provider,
                default_run_model: created.project.default_run_model,
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
                    setup_script: repository.setup_script,
                    cleanup_script: repository.cleanup_script,
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
        let default_run_agent = input
            .default_run_agent
            .take()
            .map(|agent| agent.trim().to_string())
            .filter(|agent| !agent.is_empty());
        input.default_run_provider = input.default_run_provider.trim().to_string();
        input.default_run_model = input.default_run_model.trim().to_string();
        self.validate_key(&input.key).map_err(AppError::from)?;
        self.validate_repositories(&input.repositories)
            .map_err(AppError::from)?;
        self.validate_run_defaults(&input.default_run_provider, &input.default_run_model)
            .map_err(AppError::from)?;

        if self
            .repository
            .key_exists_for_other_project(&input.key, id)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
        {
            return Err(AppError::from(ProjectsServiceError::Validation(
                "project key already exists",
            )));
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
                setup_script: repository
                    .setup_script
                    .map(|script| script.trim().to_string())
                    .filter(|script| !script.is_empty()),
                cleanup_script: repository
                    .cleanup_script
                    .map(|script| script.trim().to_string())
                    .filter(|script| !script.is_empty()),
            })
            .collect::<Vec<_>>();

        let updated = self
            .repository
            .update_project(
                id,
                &normalized_name,
                &input.key,
                &normalized_description,
                &default_run_agent,
                &input.default_run_provider,
                &input.default_run_model,
                &now,
                &normalized_repositories,
            )
            .await
            .map_err(|source| ProjectsServiceError::PersistProjectData { source })
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::from(ProjectsServiceError::NotFound("project not found")))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: updated.project.id,
                key: updated.project.key,
                name: updated.project.name,
                description: updated.project.description,
                default_repo_id: updated.project.default_repo_id,
                default_run_agent: updated.project.default_run_agent,
                default_run_provider: updated.project.default_run_provider,
                default_run_model: updated.project.default_run_model,
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
                    setup_script: repository.setup_script,
                    cleanup_script: repository.cleanup_script,
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
            return Err(AppError::from(ProjectsServiceError::Validation(
                "project name is required",
            )));
        }

        self.validate_key(&input.key).map_err(AppError::from)?;

        if input.repository_destination.trim().is_empty() {
            return Err(AppError::from(ProjectsServiceError::Validation(
                "repository destination is required",
            )));
        }

        if self
            .repository
            .key_exists(&input.key)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
        {
            return Err(AppError::from(ProjectsServiceError::Validation(
                "project key already exists",
            )));
        }

        let source = self
            .repository
            .get_project(source_project_id)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::from(ProjectsServiceError::NotFound("project not found")))?;

        if source.repositories.len() != 1 {
            return Err(AppError::from(ProjectsServiceError::Validation(
                "cloning requires exactly one source repository",
            )));
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
            .await
            .map_err(|source| ProjectsServiceError::CloneProject { source })
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::from(ProjectsServiceError::NotFound("project not found")))?;

        Ok(ProjectDetailsDto {
            project: ProjectDto {
                id: cloned.project.id,
                key: cloned.project.key,
                name: cloned.project.name,
                description: cloned.project.description,
                default_repo_id: cloned.project.default_repo_id,
                default_run_agent: cloned.project.default_run_agent,
                default_run_provider: cloned.project.default_run_provider,
                default_run_model: cloned.project.default_run_model,
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
                    setup_script: repository.setup_script,
                    cleanup_script: repository.cleanup_script,
                    created_at: repository.created_at,
                })
                .collect(),
        })
    }

    pub async fn delete_project(&self, id: &str) -> Result<(), AppError> {
        self.delete_project_internal(id)
            .await
            .map_err(AppError::from)
    }

    async fn delete_project_internal(&self, id: &str) -> Result<(), ProjectsServiceError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(ProjectsServiceError::Validation("project id is required"));
        }

        let context = self
            .repository
            .get_project_deletion_context(id)
            .await
            .map_err(|source| ProjectsServiceError::DeleteProject { source })?
            .ok_or(ProjectsServiceError::NotFound("project not found"))?;

        self.worktrees_service
            .remove_project_artifacts(&context.project_key, &context.worktree_ids)
            .map_err(|source| ProjectsServiceError::RemoveProjectArtifacts { source })?;

        let deleted = self
            .repository
            .delete_project(id)
            .await
            .map_err(|source| ProjectsServiceError::DeleteProject { source })?;
        if !deleted {
            return Err(ProjectsServiceError::NotFound("project not found"));
        }

        Ok(())
    }

    fn validate_key(&self, key: &str) -> Result<(), ProjectsServiceError> {
        if key.is_empty() {
            return Err(ProjectsServiceError::Validation("project key is required"));
        }

        let len = key.len();
        if !(2..=4).contains(&len) {
            return Err(ProjectsServiceError::Validation(
                "project key length must be 2 to 4",
            ));
        }

        if !key
            .chars()
            .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
        {
            return Err(ProjectsServiceError::Validation(
                "project key must be uppercase alphanumeric",
            ));
        }

        Ok(())
    }

    fn validate_repositories(
        &self,
        repositories: &[crate::app::projects::dto::CreateProjectRepositoryRequest],
    ) -> Result<(), ProjectsServiceError> {
        if repositories.is_empty() {
            return Err(ProjectsServiceError::Validation(
                "at least one repository is required",
            ));
        }

        let default_count = repositories
            .iter()
            .filter(|repository| repository.is_default)
            .count();
        if default_count != 1 {
            return Err(ProjectsServiceError::Validation(
                "exactly one default repository is required",
            ));
        }

        Ok(())
    }

    fn validate_run_defaults(
        &self,
        default_run_provider: &str,
        default_run_model: &str,
    ) -> Result<(), ProjectsServiceError> {
        if default_run_provider.is_empty() {
            return Err(ProjectsServiceError::Validation(
                "default run provider is required",
            ));
        }
        if default_run_model.is_empty() {
            return Err(ProjectsServiceError::Validation(
                "default run model is required",
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
        let temp_dir =
            std::env::temp_dir().join(format!("orkestra-projects-tests-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        ProjectsService::new(
            ProjectsRepository::new(pool),
            ProjectFileSearchService::new(),
            WorktreesService::new(temp_dir),
        )
    }

    #[tokio::test]
    async fn clone_project_rejects_multi_repository_source() {
        let service = setup_service().await;

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRC".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![
                    crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: None,
                        name: "Main".to_string(),
                        repo_path: "/repo/main".to_string(),
                        is_default: true,
                        setup_script: None,
                        cleanup_script: None,
                    },
                    crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: None,
                        name: "Docs".to_string(),
                        repo_path: "/repo/docs".to_string(),
                        is_default: false,
                        setup_script: None,
                        cleanup_script: None,
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
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
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
                &source.project.default_run_agent,
                source.project.default_run_provider.as_deref().unwrap_or(""),
                source.project.default_run_model.as_deref().unwrap_or(""),
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
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
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
        assert_eq!(result.unwrap_err().to_string(), "project name is required");
    }

    #[tokio::test]
    async fn create_project_persists_repository_setup_and_cleanup_scripts() {
        let service = setup_service().await;

        let created = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SCR".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                    setup_script: Some("bun install".to_string()),
                    cleanup_script: Some("bun test".to_string()),
                }],
            })
            .await
            .unwrap();

        assert_eq!(created.repositories.len(), 1);
        assert_eq!(
            created.repositories[0].setup_script.as_deref(),
            Some("bun install")
        );
        assert_eq!(
            created.repositories[0].cleanup_script.as_deref(),
            Some("bun test")
        );
    }

    #[tokio::test]
    async fn delete_project_removes_project_records_and_worktree_artifacts() {
        let service = setup_service().await;

        let created = service
            .create_project(CreateProjectRequest {
                name: "Delete Me".to_string(),
                description: None,
                key: "DEL".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
                }],
            })
            .await
            .unwrap();

        let worktree_root = service
            .worktrees_service
            .base_root_for_tests()
            .join("DEL")
            .join("cleanup-me");
        std::fs::create_dir_all(&worktree_root).unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, implementation_guide, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("task-del-1")
        .bind(&created.project.id)
        .bind(&created.repositories[0].id)
        .bind(1_i64)
        .bind("Cleanup")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("todo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(service.repository.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, worktree_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-del-1")
        .bind("task-del-1")
        .bind(&created.project.id)
        .bind(&created.repositories[0].id)
        .bind("queued")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .bind("DEL/cleanup-me")
        .execute(service.repository.pool())
        .await
        .unwrap();

        service.delete_project(&created.project.id).await.unwrap();

        let project_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind(&created.project.id)
            .fetch_one(service.repository.pool())
            .await
            .unwrap();
        let repository_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM project_repositories WHERE project_id = ?")
                .bind(&created.project.id)
                .fetch_one(service.repository.pool())
                .await
                .unwrap();
        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE project_id = ?")
            .bind(&created.project.id)
            .fetch_one(service.repository.pool())
            .await
            .unwrap();
        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE project_id = ?")
            .bind(&created.project.id)
            .fetch_one(service.repository.pool())
            .await
            .unwrap();

        assert_eq!(project_exists, 0);
        assert_eq!(repository_count, 0);
        assert_eq!(task_count, 0);
        assert_eq!(run_count, 0);
        assert!(!worktree_root.exists());
    }

    #[tokio::test]
    async fn delete_project_allows_legacy_worktree_prefix_after_key_rename() {
        let service = setup_service().await;

        let created = service
            .create_project(CreateProjectRequest {
                name: "Rename Me".to_string(),
                description: None,
                key: "OLD".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/main".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
                }],
            })
            .await
            .unwrap();

        service
            .update_project(
                &created.project.id,
                UpdateProjectRequest {
                    name: "Rename Me".to_string(),
                    description: None,
                    key: "NEW".to_string(),
                    default_run_agent: None,
                    default_run_provider: "provider-a".to_string(),
                    default_run_model: "model-a".to_string(),
                    repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: Some(created.repositories[0].id.clone()),
                        name: "Main".to_string(),
                        repo_path: "/repo/main".to_string(),
                        is_default: true,
                        setup_script: None,
                        cleanup_script: None,
                    }],
                },
            )
            .await
            .unwrap();

        let legacy_worktree_root = service
            .worktrees_service
            .base_root_for_tests()
            .join("OLD")
            .join("legacy-branch");
        std::fs::create_dir_all(&legacy_worktree_root).unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, implementation_guide, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("task-legacy-1")
        .bind(&created.project.id)
        .bind(&created.repositories[0].id)
        .bind(1_i64)
        .bind("Cleanup")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("todo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(service.repository.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, worktree_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-legacy-1")
        .bind("task-legacy-1")
        .bind(&created.project.id)
        .bind(&created.repositories[0].id)
        .bind("queued")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .bind("OLD/legacy-branch")
        .execute(service.repository.pool())
        .await
        .unwrap();

        service.delete_project(&created.project.id).await.unwrap();

        let project_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind(&created.project.id)
            .fetch_one(service.repository.pool())
            .await
            .unwrap();

        assert_eq!(project_exists, 0);
        assert!(!legacy_worktree_root.exists());
    }

    #[tokio::test]
    async fn search_project_files_rejects_repository_outside_project() {
        let service = setup_service().await;

        let first = service
            .create_project(CreateProjectRequest {
                name: "First".to_string(),
                description: None,
                key: "FST".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/first".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
                }],
            })
            .await
            .unwrap();

        let second = service
            .create_project(CreateProjectRequest {
                name: "Second".to_string(),
                description: None,
                key: "SCD".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path: "/repo/second".to_string(),
                    is_default: true,
                    setup_script: None,
                    cleanup_script: None,
                }],
            })
            .await
            .unwrap();

        let result = service
            .search_project_files(
                &first.project.id,
                &second.repositories[0].id,
                "Cargo",
                Some(10),
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "repository not found for project"
        );
    }
}
