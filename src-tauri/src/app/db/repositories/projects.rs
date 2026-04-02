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

use crate::app::projects::env::ProjectEnvVar;
use crate::app::projects::errors::ProjectsRepositoryError;
use crate::app::projects::models::{
    NewProject, Project, ProjectDetails, ProjectRepository, UpsertProjectRepository,
};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};

fn parse_project_env_vars(
    raw: Option<String>,
) -> Result<Option<Vec<ProjectEnvVar>>, ProjectsRepositoryError> {
    match raw {
        Some(value) => serde_json::from_str::<Vec<ProjectEnvVar>>(&value)
            .map(Some)
            .map_err(|_| {
                ProjectsRepositoryError::validation(
                    "stored project environment variables are invalid",
                )
            }),
        None => Ok(None),
    }
}

fn serialize_project_env_vars(
    env_vars: &Option<Vec<ProjectEnvVar>>,
) -> Result<Option<String>, ProjectsRepositoryError> {
    match env_vars {
        Some(entries) => serde_json::to_string(entries).map(Some).map_err(|_| {
            ProjectsRepositoryError::validation(
                "project environment variables could not be serialized",
            )
        }),
        None => Ok(None),
    }
}

#[derive(Clone, Debug)]
pub struct ProjectsRepository {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct ProjectDeletionContext {
    pub project_key: String,
    pub worktree_ids: Vec<String>,
}

impl ProjectsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>, ProjectsRepositoryError> {
        let rows = sqlx::query(
            "SELECT id, key, name, description, default_repo_id, default_run_agent, default_run_provider, default_run_model, env_vars_json, created_at, updated_at
            FROM projects
            ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|source| ProjectsRepositoryError::db("listing projects", source))?;

        let projects = rows
            .into_iter()
            .map(|row| {
                Ok(Project {
                    id: row.get("id"),
                    key: row.get("key"),
                    name: row.get("name"),
                    description: row.get("description"),
                    default_repo_id: row.get("default_repo_id"),
                    default_run_agent: row.get("default_run_agent"),
                    default_run_provider: row.get("default_run_provider"),
                    default_run_model: row.get("default_run_model"),
                    env_vars: parse_project_env_vars(row.get("env_vars_json"))?,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(projects)
    }

    pub async fn get_project(
        &self,
        id: &str,
    ) -> Result<Option<ProjectDetails>, ProjectsRepositoryError> {
        let maybe_project = sqlx::query(
            "SELECT id, key, name, description, default_repo_id, default_run_agent, default_run_provider, default_run_model, env_vars_json, created_at, updated_at
            FROM projects
            WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|source| ProjectsRepositoryError::db("loading project", source))?;

        let Some(project_row) = maybe_project else {
            return Ok(None);
        };

        let project = Project {
            id: project_row.get("id"),
            key: project_row.get("key"),
            name: project_row.get("name"),
            description: project_row.get("description"),
            default_repo_id: project_row.get("default_repo_id"),
            default_run_agent: project_row.get("default_run_agent"),
            default_run_provider: project_row.get("default_run_provider"),
            default_run_model: project_row.get("default_run_model"),
            env_vars: parse_project_env_vars(project_row.get("env_vars_json"))?,
            created_at: project_row.get("created_at"),
            updated_at: project_row.get("updated_at"),
        };

        let repository_rows = sqlx::query(
            "SELECT id, project_id, name, repo_path, is_default, setup_script, cleanup_script, created_at
            FROM project_repositories
            WHERE project_id = ?
            ORDER BY created_at ASC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(|source| ProjectsRepositoryError::db("loading project repositories", source))?;

        let repositories = repository_rows
            .into_iter()
            .map(|row| ProjectRepository {
                id: row.get("id"),
                project_id: row.get("project_id"),
                name: row.get("name"),
                repo_path: row.get("repo_path"),
                is_default: row.get::<i64, _>("is_default") == 1,
                setup_script: row.get("setup_script"),
                cleanup_script: row.get("cleanup_script"),
                created_at: row.get("created_at"),
            })
            .collect();

        Ok(Some(ProjectDetails {
            project,
            repositories,
        }))
    }

    pub async fn key_exists(&self, key: &str) -> Result<bool, ProjectsRepositoryError> {
        let row = sqlx::query("SELECT 1 FROM projects WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("checking project key uniqueness", source)
            })?;
        Ok(row.is_some())
    }

    pub async fn key_exists_for_other_project(
        &self,
        key: &str,
        project_id: &str,
    ) -> Result<bool, ProjectsRepositoryError> {
        let row = sqlx::query("SELECT 1 FROM projects WHERE key = ? AND id != ? LIMIT 1")
            .bind(key)
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("checking project key uniqueness for update", source)
            })?;
        Ok(row.is_some())
    }

    pub async fn create_project(
        &self,
        input: NewProject,
    ) -> Result<ProjectDetails, ProjectsRepositoryError> {
        let mut tx = self.pool.begin().await.map_err(|source| {
            ProjectsRepositoryError::db("starting project creation transaction", source)
        })?;
        let env_vars_json = serialize_project_env_vars(&input.env_vars)?;

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, default_run_agent, default_run_provider, default_run_model, env_vars_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.name)
        .bind(&input.key)
        .bind(&input.description)
        .bind(&input.default_repo_id)
        .bind(&input.default_run_agent)
        .bind(&input.default_run_provider)
        .bind(&input.default_run_model)
        .bind(&env_vars_json)
        .bind(&input.created_at)
        .bind(&input.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|source| ProjectsRepositoryError::db("inserting project", source))?;

        let mut saved_repositories = Vec::with_capacity(input.repositories.len());
        let mut selected_default_repo_id: Option<String> = None;

        for repository in &input.repositories {
            let repository_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, setup_script, cleanup_script, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&repository_id)
            .bind(&input.id)
            .bind(&repository.name)
            .bind(&repository.repo_path)
            .bind(if repository.is_default { 1_i64 } else { 0_i64 })
            .bind(&repository.setup_script)
            .bind(&repository.cleanup_script)
            .bind(&input.created_at)
            .execute(&mut *tx)
            .await
            .map_err(|source| ProjectsRepositoryError::db("inserting project repository", source))?;

            if repository.is_default {
                selected_default_repo_id = Some(repository_id.clone());
            }

            saved_repositories.push(ProjectRepository {
                id: repository_id,
                project_id: input.id.clone(),
                name: repository.name.clone(),
                repo_path: repository.repo_path.clone(),
                is_default: repository.is_default,
                setup_script: repository.setup_script.clone(),
                cleanup_script: repository.cleanup_script.clone(),
                created_at: input.created_at.clone(),
            });
        }

        sqlx::query("UPDATE projects SET default_repo_id = ?, updated_at = ? WHERE id = ?")
            .bind(&selected_default_repo_id)
            .bind(&input.updated_at)
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("updating project default repository", source)
            })?;

        tx.commit().await.map_err(|source| {
            ProjectsRepositoryError::db("committing project creation transaction", source)
        })?;

        Ok(ProjectDetails {
            project: Project {
                id: input.id,
                key: input.key,
                name: input.name,
                description: input.description,
                default_repo_id: selected_default_repo_id,
                default_run_agent: input.default_run_agent,
                default_run_provider: input.default_run_provider,
                default_run_model: input.default_run_model,
                env_vars: input.env_vars,
                created_at: input.created_at,
                updated_at: input.updated_at,
            },
            repositories: saved_repositories,
        })
    }

    pub async fn update_project(
        &self,
        project_id: &str,
        name: &str,
        key: &str,
        description: &Option<String>,
        default_run_agent: &Option<String>,
        default_run_provider: &str,
        default_run_model: &str,
        env_vars: &Option<Vec<ProjectEnvVar>>,
        updated_at: &str,
        repositories: &[UpsertProjectRepository],
    ) -> Result<Option<ProjectDetails>, ProjectsRepositoryError> {
        let mut tx = self.pool.begin().await.map_err(|source| {
            ProjectsRepositoryError::db("starting project update transaction", source)
        })?;
        let env_vars_json = serialize_project_env_vars(env_vars)?;

        let project_exists = sqlx::query("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
            .bind(project_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|source| ProjectsRepositoryError::db("checking project existence", source))?
            .is_some();

        if !project_exists {
            tx.rollback().await.map_err(|source| {
                ProjectsRepositoryError::db("rolling back missing project update", source)
            })?;
            return Ok(None);
        }

        sqlx::query(
            "UPDATE projects SET name = ?, key = ?, description = ?, default_run_agent = ?, default_run_provider = ?, default_run_model = ?, env_vars_json = ?, updated_at = ? WHERE id = ?",
        )
        .bind(name)
        .bind(key)
        .bind(description)
        .bind(default_run_agent)
        .bind(default_run_provider)
        .bind(default_run_model)
        .bind(&env_vars_json)
        .bind(updated_at)
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|source| ProjectsRepositoryError::db("updating project fields", source))?;

        let existing_repository_rows = sqlx::query(
            "SELECT id, name, repo_path, is_default, setup_script, cleanup_script, created_at
            FROM project_repositories
            WHERE project_id = ?",
        )
        .bind(project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|source| {
            ProjectsRepositoryError::db("loading existing project repositories", source)
        })?;

        let existing_repository_ids: HashSet<String> = existing_repository_rows
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect();

        let mut touched_repository_ids = HashSet::new();
        let mut selected_default_repo_id: Option<String> = None;

        for repository in repositories {
            let repository_id = match &repository.id {
                Some(id) if existing_repository_ids.contains(id) => id.clone(),
                _ => uuid::Uuid::new_v4().to_string(),
            };
            let is_existing = existing_repository_ids.contains(&repository_id);

            if is_existing {
                sqlx::query(
                    "UPDATE project_repositories
                    SET name = ?, repo_path = ?, is_default = ?, setup_script = ?, cleanup_script = ?
                    WHERE id = ? AND project_id = ?",
                )
                .bind(&repository.name)
                .bind(&repository.repo_path)
                .bind(if repository.is_default { 1_i64 } else { 0_i64 })
                .bind(&repository.setup_script)
                .bind(&repository.cleanup_script)
                .bind(&repository_id)
                .bind(project_id)
                .execute(&mut *tx)
                .await
                .map_err(|source| ProjectsRepositoryError::db("updating existing project repository", source))?;
            } else {
                sqlx::query(
                    "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, setup_script, cleanup_script, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&repository_id)
                .bind(project_id)
                .bind(&repository.name)
                .bind(&repository.repo_path)
                .bind(if repository.is_default { 1_i64 } else { 0_i64 })
                .bind(&repository.setup_script)
                .bind(&repository.cleanup_script)
                .bind(updated_at)
                .execute(&mut *tx)
                .await
                .map_err(|source| ProjectsRepositoryError::db("inserting new project repository", source))?;
            }

            if repository.is_default {
                selected_default_repo_id = Some(repository_id.clone());
            }

            touched_repository_ids.insert(repository_id);
        }

        for existing_repository_id in existing_repository_ids {
            if touched_repository_ids.contains(&existing_repository_id) {
                continue;
            }

            let used_by_task = sqlx::query("SELECT 1 FROM tasks WHERE repository_id = ? LIMIT 1")
                .bind(&existing_repository_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|source| {
                    ProjectsRepositoryError::db("checking repository task usage", source)
                })?
                .is_some();

            if used_by_task {
                tx.rollback().await.map_err(|source| {
                    ProjectsRepositoryError::db(
                        "rolling back repository removal blocked by tasks",
                        source,
                    )
                })?;
                return Err(ProjectsRepositoryError::validation(
                    "cannot remove repository with existing tasks",
                ));
            }

            sqlx::query("DELETE FROM project_repositories WHERE id = ? AND project_id = ?")
                .bind(&existing_repository_id)
                .bind(project_id)
                .execute(&mut *tx)
                .await
                .map_err(|source| {
                    ProjectsRepositoryError::db("deleting removed project repository", source)
                })?;
        }

        sqlx::query("UPDATE projects SET default_repo_id = ?, updated_at = ? WHERE id = ?")
            .bind(&selected_default_repo_id)
            .bind(updated_at)
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("updating project default repository", source)
            })?;

        tx.commit().await.map_err(|source| {
            ProjectsRepositoryError::db("committing project update transaction", source)
        })?;

        self.get_project(project_id).await
    }

    pub async fn clone_project(
        &self,
        source_project_id: &str,
        new_project_id: &str,
        new_name: &str,
        new_key: &str,
        repository_destination: &str,
        now: &str,
    ) -> Result<Option<ProjectDetails>, ProjectsRepositoryError> {
        let mut tx = self.pool.begin().await.map_err(|source| {
            ProjectsRepositoryError::db("starting project clone transaction", source)
        })?;

        let source_project_row =
            sqlx::query(
                "SELECT id, description, default_run_agent, default_run_provider, default_run_model, env_vars_json FROM projects WHERE id = ? LIMIT 1",
            )
                .bind(source_project_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|source| {
                    ProjectsRepositoryError::db("loading clone source project", source)
                })?;

        let Some(source_project_row) = source_project_row else {
            tx.rollback().await.map_err(|source| {
                ProjectsRepositoryError::db("rolling back missing clone source project", source)
            })?;
            return Ok(None);
        };

        let source_description: Option<String> = source_project_row.get("description");

        let source_repository_rows = sqlx::query(
            "SELECT id, name, repo_path, is_default, setup_script, cleanup_script
             FROM project_repositories
             WHERE project_id = ?
             ORDER BY created_at ASC",
        )
        .bind(source_project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|source| {
            ProjectsRepositoryError::db("loading clone source repositories", source)
        })?;

        if source_repository_rows.len() != 1 {
            tx.rollback().await.map_err(|source| {
                ProjectsRepositoryError::db(
                    "rolling back invalid clone source repositories",
                    source,
                )
            })?;
            return Err(ProjectsRepositoryError::validation(
                "cloning requires exactly one source repository",
            ));
        }

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, default_run_agent, default_run_provider, default_run_model, env_vars_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(new_project_id)
        .bind(new_name)
        .bind(new_key)
        .bind(&source_description)
        .bind(Option::<String>::None)
        .bind(
            source_project_row
                .try_get::<Option<String>, _>("default_run_agent")
                .ok()
                .flatten(),
        )
        .bind(
            source_project_row
                .try_get::<Option<String>, _>("default_run_provider")
                .ok()
                .flatten(),
        )
        .bind(
            source_project_row
                .try_get::<Option<String>, _>("default_run_model")
                .ok()
                .flatten(),
        )
        .bind(
            source_project_row
                .try_get::<Option<String>, _>("env_vars_json")
                .ok()
                .flatten(),
        )
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|source| ProjectsRepositoryError::db("inserting cloned project", source))?;

        let mut selected_default_repo_id: Option<String> = None;
        let mut repository_id_map = HashMap::new();

        for row in source_repository_rows {
            let source_repository_id: String = row.get("id");
            let source_name: String = row.get("name");
            let source_repo_path: String = row.get("repo_path");
            let source_is_default = row.get::<i64, _>("is_default") == 1;
            let source_setup_script: Option<String> = row.get("setup_script");
            let source_cleanup_script: Option<String> = row.get("cleanup_script");
            let next_repository_id = uuid::Uuid::new_v4().to_string();
            let next_repo_path = if source_is_default {
                repository_destination.to_string()
            } else {
                source_repo_path
            };

            sqlx::query(
                "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, setup_script, cleanup_script, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&next_repository_id)
            .bind(new_project_id)
            .bind(&source_name)
            .bind(&next_repo_path)
            .bind(if source_is_default { 1_i64 } else { 0_i64 })
            .bind(&source_setup_script)
            .bind(&source_cleanup_script)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|source| ProjectsRepositoryError::db("inserting cloned project repository", source))?;

            if source_is_default {
                selected_default_repo_id = Some(next_repository_id.clone());
            }

            repository_id_map.insert(source_repository_id, next_repository_id);
        }

        sqlx::query("UPDATE projects SET default_repo_id = ?, updated_at = ? WHERE id = ?")
            .bind(&selected_default_repo_id)
            .bind(now)
            .bind(new_project_id)
            .execute(&mut *tx)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("setting cloned project default repository", source)
            })?;

        let source_task_rows = sqlx::query(
            "SELECT id, repository_id, task_number, title, description, implementation_guide, status
             FROM tasks
             WHERE project_id = ?
             ORDER BY task_number ASC",
        )
        .bind(source_project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|source| ProjectsRepositoryError::db("loading clone source tasks", source))?;

        let mut task_id_map = HashMap::new();

        for row in source_task_rows {
            let source_task_id: String = row.get("id");
            let source_repository_id: String = row.get("repository_id");
            let Some(next_repository_id) = repository_id_map.get(&source_repository_id) else {
                tx.rollback().await.map_err(|source| {
                    ProjectsRepositoryError::db(
                        "rolling back invalid cloned repository mapping",
                        source,
                    )
                })?;
                return Err(ProjectsRepositoryError::validation(
                    "source project repository mapping is invalid",
                ));
            };

            let next_task_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO tasks (
                    id,
                    project_id,
                    repository_id,
                    task_number,
                    title,
                    description,
                    implementation_guide,
                    status,
                    created_at,
                    updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&next_task_id)
            .bind(new_project_id)
            .bind(next_repository_id)
            .bind(row.get::<i64, _>("task_number"))
            .bind(row.get::<String, _>("title"))
            .bind(row.get::<Option<String>, _>("description"))
            .bind(row.get::<Option<String>, _>("implementation_guide"))
            .bind(row.get::<String, _>("status"))
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|source| ProjectsRepositoryError::db("inserting cloned task", source))?;

            task_id_map.insert(source_task_id, next_task_id);
        }

        let source_dependency_rows = sqlx::query(
            "SELECT parent_task_id, child_task_id
             FROM task_dependencies
             WHERE project_id = ?",
        )
        .bind(source_project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|source| {
            ProjectsRepositoryError::db("loading clone source task dependencies", source)
        })?;

        for row in source_dependency_rows {
            let parent_task_id: String = row.get("parent_task_id");
            let child_task_id: String = row.get("child_task_id");
            let Some(next_parent_task_id) = task_id_map.get(&parent_task_id) else {
                tx.rollback().await.map_err(|source| {
                    ProjectsRepositoryError::db(
                        "rolling back invalid cloned parent dependency mapping",
                        source,
                    )
                })?;
                return Err(ProjectsRepositoryError::validation(
                    "source task dependency mapping is invalid",
                ));
            };
            let Some(next_child_task_id) = task_id_map.get(&child_task_id) else {
                tx.rollback().await.map_err(|source| {
                    ProjectsRepositoryError::db(
                        "rolling back invalid cloned child dependency mapping",
                        source,
                    )
                })?;
                return Err(ProjectsRepositoryError::validation(
                    "source task dependency mapping is invalid",
                ));
            };

            sqlx::query(
                "INSERT INTO task_dependencies (project_id, parent_task_id, child_task_id, created_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(new_project_id)
            .bind(next_parent_task_id)
            .bind(next_child_task_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|source| ProjectsRepositoryError::db("inserting cloned task dependency", source))?;
        }

        tx.commit().await.map_err(|source| {
            ProjectsRepositoryError::db("committing project clone transaction", source)
        })?;
        self.get_project(new_project_id).await
    }

    pub async fn get_project_deletion_context(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectDeletionContext>, ProjectsRepositoryError> {
        let maybe_project = sqlx::query("SELECT key FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| {
                ProjectsRepositoryError::db("loading project deletion context", source)
            })?;

        let Some(project_row) = maybe_project else {
            return Ok(None);
        };

        let worktree_rows = sqlx::query(
            "SELECT DISTINCT worktree_id FROM runs WHERE project_id = ? AND worktree_id IS NOT NULL AND TRIM(worktree_id) != ''",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|source| ProjectsRepositoryError::db("loading project worktree references", source))?;

        let worktree_ids = worktree_rows
            .into_iter()
            .map(|row| row.get::<String, _>("worktree_id"))
            .collect();

        Ok(Some(ProjectDeletionContext {
            project_key: project_row.get("key"),
            worktree_ids,
        }))
    }

    pub async fn delete_project(&self, project_id: &str) -> Result<bool, ProjectsRepositoryError> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|source| ProjectsRepositoryError::db("deleting project", source))?;

        Ok(result.rows_affected() > 0)
    }

    #[cfg(test)]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;

    async fn setup_repository() -> ProjectsRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        ProjectsRepository::new(pool)
    }

    #[tokio::test]
    async fn clone_project_copies_tasks_and_dependencies() {
        let repository = setup_repository().await;

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("source-project")
        .bind("Source")
        .bind("SRC")
        .bind(Option::<String>::None)
        .bind("source-repo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repository.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("source-repo")
        .bind("source-project")
        .bind("Main")
        .bind("/repo/source")
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(&repository.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, implementation_guide, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("source-task-1")
        .bind("source-project")
        .bind("source-repo")
        .bind(1)
        .bind("First")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("todo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .bind("source-task-2")
        .bind("source-project")
        .bind("source-repo")
        .bind(2)
        .bind("Second")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("doing")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repository.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO task_dependencies (project_id, parent_task_id, child_task_id, created_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind("source-project")
        .bind("source-task-1")
        .bind("source-task-2")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repository.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (
                id,
                task_id,
                project_id,
                target_repo_id,
                status,
                triggered_by,
                created_at,
                started_at,
                finished_at,
                summary,
                error_message,
                worktree_id,
                agent_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id,
                initial_prompt_claimed_at,
                initial_prompt_claim_request_id
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("source-run-1")
        .bind("source-task-1")
        .bind("source-project")
        .bind(Option::<String>::None)
        .bind("complete")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .execute(&repository.pool)
        .await
        .unwrap();

        let cloned = repository
            .clone_project(
                "source-project",
                "cloned-project",
                "Source - Copy",
                "CPY",
                "/repo/destination",
                "2024-01-02T00:00:00Z",
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(cloned.project.name, "Source - Copy");
        assert_eq!(cloned.project.key, "CPY");
        assert_eq!(cloned.repositories.len(), 1);
        assert_eq!(cloned.repositories[0].repo_path, "/repo/destination");

        let cloned_tasks = sqlx::query(
            "SELECT id, task_number, title FROM tasks WHERE project_id = ? ORDER BY task_number ASC",
        )
        .bind("cloned-project")
        .fetch_all(&repository.pool)
        .await
        .unwrap();
        assert_eq!(cloned_tasks.len(), 2);
        assert_eq!(cloned_tasks[0].get::<i64, _>("task_number"), 1);
        assert_eq!(cloned_tasks[1].get::<i64, _>("task_number"), 2);

        let cloned_dependency_count =
            sqlx::query("SELECT COUNT(*) AS count FROM task_dependencies WHERE project_id = ?")
                .bind("cloned-project")
                .fetch_one(&repository.pool)
                .await
                .unwrap()
                .get::<i64, _>("count");
        assert_eq!(cloned_dependency_count, 1);

        let source_run_count =
            sqlx::query("SELECT COUNT(*) AS count FROM runs WHERE project_id = ?")
                .bind("source-project")
                .fetch_one(&repository.pool)
                .await
                .unwrap()
                .get::<i64, _>("count");
        assert_eq!(source_run_count, 1);

        let cloned_run_count =
            sqlx::query("SELECT COUNT(*) AS count FROM runs WHERE project_id = ?")
                .bind("cloned-project")
                .fetch_one(&repository.pool)
                .await
                .unwrap()
                .get::<i64, _>("count");
        assert_eq!(cloned_run_count, 0);
    }

    #[tokio::test]
    async fn clone_project_rejects_zero_repository_source() {
        let repository = setup_repository().await;

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("source-project")
        .bind("Source")
        .bind("SRC")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&repository.pool)
        .await
        .unwrap();

        let result = repository
            .clone_project(
                "source-project",
                "cloned-project",
                "Source - Copy",
                "CPY",
                "/repo/destination",
                "2024-01-02T00:00:00Z",
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            "cloning requires exactly one source repository"
        );

        let cloned_project_exists = sqlx::query("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
            .bind("cloned-project")
            .fetch_optional(&repository.pool)
            .await
            .unwrap()
            .is_some();
        assert!(!cloned_project_exists);
    }
}
