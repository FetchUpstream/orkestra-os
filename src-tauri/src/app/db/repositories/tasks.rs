use crate::app::errors::AppError;
use crate::app::tasks::models::{NewTask, Task};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct TasksRepository {
    pool: SqlitePool,
}

impl TasksRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn project_exists(&self, project_id: &str) -> Result<bool, AppError> {
        let row = sqlx::query("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    pub async fn repository_belongs_to_project(
        &self,
        repository_id: &str,
        project_id: &str,
    ) -> Result<bool, AppError> {
        let row = sqlx::query(
            "SELECT 1 FROM project_repositories WHERE id = ? AND project_id = ? LIMIT 1",
        )
        .bind(repository_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    pub async fn create_task(&self, input: NewTask) -> Result<Task, AppError> {
        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.project_id)
        .bind(&input.repository_id)
        .bind(&input.title)
        .bind(&input.description)
        .bind(&input.status)
        .bind(&input.created_at)
        .bind(&input.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(Task {
            id: input.id,
            project_id: input.project_id,
            repository_id: input.repository_id,
            title: input.title,
            description: input.description,
            status: input.status,
            created_at: input.created_at,
            updated_at: input.updated_at,
        })
    }

    pub async fn list_project_tasks(&self, project_id: &str) -> Result<Vec<Task>, AppError> {
        let rows = sqlx::query(
            "SELECT id, project_id, repository_id, title, description, status, created_at, updated_at
             FROM tasks
             WHERE project_id = ?
             ORDER BY created_at DESC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| Task {
                id: row.get("id"),
                project_id: row.get("project_id"),
                repository_id: row.get("repository_id"),
                title: row.get("title"),
                description: row.get("description"),
                status: row.get("status"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, AppError> {
        let row = sqlx::query(
            "SELECT id, project_id, repository_id, title, description, status, created_at, updated_at
             FROM tasks
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| Task {
            id: row.get("id"),
            project_id: row.get("project_id"),
            repository_id: row.get("repository_id"),
            title: row.get("title"),
            description: row.get("description"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    }
}
