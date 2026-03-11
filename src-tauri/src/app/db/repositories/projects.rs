use crate::app::errors::AppError;
use crate::app::projects::models::{NewProject, Project, ProjectDetails, ProjectRepository};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct ProjectsRepository {
    pool: SqlitePool,
}

impl ProjectsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>, AppError> {
        let rows = sqlx::query(
            "SELECT id, key, name, description, default_repo_id, created_at, updated_at
            FROM projects
            ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        let projects = rows
            .into_iter()
            .map(|row| Project {
                id: row.get("id"),
                key: row.get("key"),
                name: row.get("name"),
                description: row.get("description"),
                default_repo_id: row.get("default_repo_id"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(projects)
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<ProjectDetails>, AppError> {
        let maybe_project = sqlx::query(
            "SELECT id, key, name, description, default_repo_id, created_at, updated_at
            FROM projects
            WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(project_row) = maybe_project else {
            return Ok(None);
        };

        let project = Project {
            id: project_row.get("id"),
            key: project_row.get("key"),
            name: project_row.get("name"),
            description: project_row.get("description"),
            default_repo_id: project_row.get("default_repo_id"),
            created_at: project_row.get("created_at"),
            updated_at: project_row.get("updated_at"),
        };

        let repository_rows = sqlx::query(
            "SELECT id, project_id, name, repo_path, is_default, created_at
            FROM project_repositories
            WHERE project_id = ?
            ORDER BY created_at ASC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let repositories = repository_rows
            .into_iter()
            .map(|row| ProjectRepository {
                id: row.get("id"),
                project_id: row.get("project_id"),
                name: row.get("name"),
                repo_path: row.get("repo_path"),
                is_default: row.get::<i64, _>("is_default") == 1,
                created_at: row.get("created_at"),
            })
            .collect();

        Ok(Some(ProjectDetails {
            project,
            repositories,
        }))
    }

    pub async fn key_exists(&self, key: &str) -> Result<bool, AppError> {
        let row = sqlx::query("SELECT 1 FROM projects WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    pub async fn create_project(&self, input: NewProject) -> Result<ProjectDetails, AppError> {
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.name)
        .bind(&input.key)
        .bind(&input.description)
        .bind(&input.default_repo_id)
        .bind(&input.created_at)
        .bind(&input.updated_at)
        .execute(&mut *tx)
        .await?;

        let mut saved_repositories = Vec::with_capacity(input.repositories.len());
        let mut selected_default_repo_id: Option<String> = None;

        for repository in &input.repositories {
            let repository_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
                VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&repository_id)
            .bind(&input.id)
            .bind(&repository.name)
            .bind(&repository.repo_path)
            .bind(if repository.is_default { 1_i64 } else { 0_i64 })
            .bind(&input.created_at)
            .execute(&mut *tx)
            .await?;

            if repository.is_default {
                selected_default_repo_id = Some(repository_id.clone());
            }

            saved_repositories.push(ProjectRepository {
                id: repository_id,
                project_id: input.id.clone(),
                name: repository.name.clone(),
                repo_path: repository.repo_path.clone(),
                is_default: repository.is_default,
                created_at: input.created_at.clone(),
            });
        }

        sqlx::query("UPDATE projects SET default_repo_id = ?, updated_at = ? WHERE id = ?")
            .bind(&selected_default_repo_id)
            .bind(&input.updated_at)
            .bind(&input.id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(ProjectDetails {
            project: Project {
                id: input.id,
                key: input.key,
                name: input.name,
                description: input.description,
                default_repo_id: selected_default_repo_id,
                created_at: input.created_at,
                updated_at: input.updated_at,
            },
            repositories: saved_repositories,
        })
    }
}
