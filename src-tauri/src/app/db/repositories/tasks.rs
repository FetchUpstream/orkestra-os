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
            "INSERT INTO tasks (
                id,
                project_id,
                repository_id,
                task_number,
                title,
                description,
                status,
                created_at,
                updated_at
            )
             VALUES (
                ?,
                ?,
                ?,
                COALESCE((SELECT MAX(task_number) + 1 FROM tasks WHERE project_id = ?), 1),
                ?,
                ?,
                ?,
                ?,
                ?
            )",
        )
        .bind(&input.id)
        .bind(&input.project_id)
        .bind(&input.repository_id)
        .bind(&input.project_id)
        .bind(&input.title)
        .bind(&input.description)
        .bind(&input.status)
        .bind(&input.created_at)
        .bind(&input.updated_at)
        .execute(&self.pool)
        .await?;

        self.get_task(&input.id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found after create"))
    }

    pub async fn list_project_tasks(&self, project_id: &str) -> Result<Vec<Task>, AppError> {
        let rows = sqlx::query(
            "SELECT
                t.id,
                t.project_id,
                t.repository_id,
                t.task_number,
                p.key AS project_key,
                t.title,
                t.description,
                t.status,
                r.name AS target_repository_name,
                r.repo_path AS target_repository_path,
                t.created_at,
                t.updated_at
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_repositories r ON r.id = t.repository_id
             WHERE t.project_id = ?
             ORDER BY t.task_number DESC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let project_key: String = row.get("project_key");
                let task_number: i64 = row.get("task_number");
                Task {
                    id: row.get("id"),
                    project_id: row.get("project_id"),
                    repository_id: row.get("repository_id"),
                    task_number,
                    display_key: format!("{}-{}", project_key, task_number),
                    title: row.get("title"),
                    description: row.get("description"),
                    status: row.get("status"),
                    target_repository_name: row.get("target_repository_name"),
                    target_repository_path: row.get("target_repository_path"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect())
    }

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, AppError> {
        let row = sqlx::query(
            "SELECT
                t.id,
                t.project_id,
                t.repository_id,
                t.task_number,
                p.key AS project_key,
                t.title,
                t.description,
                t.status,
                r.name AS target_repository_name,
                r.repo_path AS target_repository_path,
                t.created_at,
                t.updated_at
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_repositories r ON r.id = t.repository_id
             WHERE t.id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let project_key: String = row.get("project_key");
            let task_number: i64 = row.get("task_number");
            Task {
                id: row.get("id"),
                project_id: row.get("project_id"),
                repository_id: row.get("repository_id"),
                task_number,
                display_key: format!("{}-{}", project_key, task_number),
                title: row.get("title"),
                description: row.get("description"),
                status: row.get("status"),
                target_repository_name: row.get("target_repository_name"),
                target_repository_path: row.get("target_repository_path"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            }
        }))
    }
}
