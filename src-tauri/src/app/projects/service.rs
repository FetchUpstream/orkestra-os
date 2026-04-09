// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::errors::AppError;
use crate::app::projects::directory_search_service::LocalDirectorySearchService;
use crate::app::projects::dto::{
    CloneProjectRequest, CreateProjectRequest, LocalDirectorySearchResultDto,
    ProjectDetailsDto, ProjectDto, ProjectRepositoryDto, UpdateProjectRequest,
};
use crate::app::projects::env::{normalize_project_env_vars, project_env_var_map};
use crate::app::projects::errors::ProjectsServiceError;
use crate::app::projects::models::{NewProject, NewProjectRepository, UpsertProjectRepository};
use crate::app::projects::search_service::ProjectFileSearchService;
use crate::app::worktrees::service::WorktreesService;
use chrono::Utc;
use git2::Repository;
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Debug)]
pub struct ProjectsService {
    repository: ProjectsRepository,
    file_search_service: ProjectFileSearchService,
    directory_search_service: LocalDirectorySearchService,
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
            directory_search_service: LocalDirectorySearchService::new(),
            worktrees_service,
        }
    }

    pub async fn search_local_directories(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<LocalDirectorySearchResultDto>, AppError> {
        self.directory_search_service
            .search_directories(query, limit)
            .await
            .map_err(|source| ProjectsServiceError::SearchLocalDirectories { source })
            .map_err(AppError::from)
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
                env_vars: project.env_vars,
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
                env_vars: details.project.env_vars,
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
        let normalized_env_vars = normalize_project_env_vars(input.env_vars.as_deref())
            .map_err(ProjectsServiceError::Validation)?;
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
            env_vars: (!normalized_env_vars.is_empty()).then_some(normalized_env_vars),
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
                env_vars: created.project.env_vars,
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
        let normalized_env_vars = normalize_project_env_vars(input.env_vars.as_deref())
            .map_err(ProjectsServiceError::Validation)?;
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
                &(!normalized_env_vars.is_empty()).then_some(normalized_env_vars),
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
                env_vars: updated.project.env_vars,
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
                env_vars: cloned.project.env_vars,
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

        for repository in repositories {
            let repo_path = repository.repo_path.trim();
            if repo_path.is_empty() {
                return Err(ProjectsServiceError::Validation("repository path is required"));
            }

            let path = Path::new(repo_path);
            if !path.exists() {
                return Err(ProjectsServiceError::Validation("repository path must exist"));
            }
            if !path.is_dir() {
                return Err(ProjectsServiceError::Validation(
                    "repository path must be a directory",
                ));
            }

            let Ok(repository) = Repository::open(path) else {
                return Err(ProjectsServiceError::Validation(
                    "repository path must point to a Git repository",
                ));
            };

            if repository.is_bare() {
                return Err(ProjectsServiceError::Validation(
                    "repository path must point to a Git repository",
                ));
            }
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

    pub async fn resolve_project_env_vars(
        &self,
        project_id: &str,
    ) -> Result<HashMap<String, String>, AppError> {
        let project_id = project_id.trim();
        if project_id.is_empty() {
            return Err(AppError::validation("project id is required"));
        }

        let details = self
            .repository
            .get_project(project_id)
            .await
            .map_err(|source| ProjectsServiceError::QueryProjectData { source })
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::from(ProjectsServiceError::NotFound("project not found")))?;

        project_env_var_map(details.project.env_vars.as_deref())
            .map_err(ProjectsServiceError::Validation)
            .map_err(AppError::from)
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

    fn make_git_repository(name: &str) -> String {
        let repo_path =
            std::env::temp_dir().join(format!("orkestra-project-repo-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&repo_path).unwrap();
        Repository::init(&repo_path).unwrap();
        repo_path.to_string_lossy().to_string()
    }

    fn make_repository_request(
        name: &str,
        repo_path: String,
        is_default: bool,
    ) -> crate::app::projects::dto::CreateProjectRepositoryRequest {
        crate::app::projects::dto::CreateProjectRepositoryRequest {
            id: None,
            name: name.to_string(),
            repo_path,
            is_default,
            setup_script: None,
            cleanup_script: None,
        }
    }

    #[tokio::test]
    async fn clone_project_rejects_multi_repository_source() {
        let service = setup_service().await;
        let main_repo_path = make_git_repository("clone-multi-main");
        let docs_repo_path = make_git_repository("clone-multi-docs");

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRC".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![
                    make_repository_request("Main", main_repo_path, true),
                    make_repository_request("Docs", docs_repo_path, false),
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
        let repo_path = make_git_repository("clone-zero-main");

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRZ".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request("Main", repo_path, true)],
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
                &source.project.env_vars,
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
        let repo_path = make_git_repository("clone-empty-name");

        let source = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SRC".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request("Main", repo_path, true)],
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
        let repo_path = make_git_repository("scripts-main");

        let created = service
            .create_project(CreateProjectRequest {
                name: "Source".to_string(),
                description: None,
                key: "SCR".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                    id: None,
                    name: "Main".to_string(),
                    repo_path,
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
    async fn create_project_persists_and_resolves_project_env_vars() {
        let service = setup_service().await;
        let repo_path = make_git_repository("env-main");

        let created = service
            .create_project(CreateProjectRequest {
                name: "Env Source".to_string(),
                description: None,
                key: "ENV".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: Some(vec![
                    crate::app::projects::env::ProjectEnvVar {
                        key: " API_TOKEN ".to_string(),
                        value: "secret".to_string(),
                    },
                    crate::app::projects::env::ProjectEnvVar {
                        key: "EMPTY_OK".to_string(),
                        value: "".to_string(),
                    },
                ]),
                repositories: vec![make_repository_request("Main", repo_path, true)],
            })
            .await
            .unwrap();

        assert_eq!(created.project.env_vars.as_ref().map(Vec::len), Some(2));
        assert_eq!(
            created
                .project
                .env_vars
                .as_ref()
                .and_then(|vars| vars.first())
                .map(|entry| entry.key.as_str()),
            Some("API_TOKEN")
        );

        let resolved = service
            .resolve_project_env_vars(&created.project.id)
            .await
            .unwrap();
        assert_eq!(resolved.get("API_TOKEN"), Some(&"secret".to_string()));
        assert_eq!(resolved.get("EMPTY_OK"), Some(&"".to_string()));
    }

    #[tokio::test]
    async fn delete_project_removes_project_records_and_worktree_artifacts() {
        let service = setup_service().await;
        let repo_path = make_git_repository("delete-main");

        let created = service
            .create_project(CreateProjectRequest {
                name: "Delete Me".to_string(),
                description: None,
                key: "DEL".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request("Main", repo_path, true)],
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
        let repo_path = make_git_repository("legacy-main");

        let created = service
            .create_project(CreateProjectRequest {
                name: "Rename Me".to_string(),
                description: None,
                key: "OLD".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request("Main", repo_path.clone(), true)],
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
                    env_vars: None,
                    repositories: vec![crate::app::projects::dto::CreateProjectRepositoryRequest {
                        id: Some(created.repositories[0].id.clone()),
                        name: "Main".to_string(),
                        repo_path,
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
        let first_repo_path = make_git_repository("search-first");
        let second_repo_path = make_git_repository("search-second");

        let first = service
            .create_project(CreateProjectRequest {
                name: "First".to_string(),
                description: None,
                key: "FST".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request("Main", first_repo_path, true)],
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
                env_vars: None,
                repositories: vec![make_repository_request("Main", second_repo_path, true)],
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

    #[tokio::test]
    async fn create_project_rejects_missing_repository_path() {
        let service = setup_service().await;

        let result = service
            .create_project(CreateProjectRequest {
                name: "Orkestra".to_string(),
                description: None,
                key: "ORK".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request(
                    "Main",
                    "/tmp/definitely-missing-repo".to_string(),
                    true,
                )],
            })
            .await;

        assert_eq!(result.unwrap_err().to_string(), "repository path must exist");
    }

    #[tokio::test]
    async fn create_project_rejects_non_git_repository_paths() {
        let service = setup_service().await;
        let plain_dir =
            std::env::temp_dir().join(format!("orkestra-plain-dir-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&plain_dir).unwrap();

        let result = service
            .create_project(CreateProjectRequest {
                name: "Orkestra".to_string(),
                description: None,
                key: "ORK".to_string(),
                default_run_agent: None,
                default_run_provider: "provider-a".to_string(),
                default_run_model: "model-a".to_string(),
                env_vars: None,
                repositories: vec![make_repository_request(
                    "Main",
                    plain_dir.to_string_lossy().to_string(),
                    true,
                )],
            })
            .await;

        assert_eq!(
            result.unwrap_err().to_string(),
            "repository path must point to a Git repository"
        );
    }
}
