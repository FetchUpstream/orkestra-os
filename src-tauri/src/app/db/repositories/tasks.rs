use crate::app::errors::AppError;
use crate::app::tasks::models::{
    MoveTaskRepository, NewTask, Task, TaskDependencies, TaskDependencyEdge, TaskDependencyTask,
    UpdateTaskDetails, UpdateTaskStatus,
};
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
                (SELECT COUNT(*) FROM task_dependencies td WHERE td.child_task_id = t.id) AS blocked_by_count,
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
                let blocked_by_count: i64 = row.get("blocked_by_count");
                Task {
                    id: row.get("id"),
                    project_id: row.get("project_id"),
                    repository_id: row.get("repository_id"),
                    task_number,
                    display_key: format!("{}-{}", project_key, task_number),
                    title: row.get("title"),
                    description: row.get("description"),
                    status: row.get("status"),
                    blocked_by_count,
                    is_blocked: blocked_by_count > 0,
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
                (SELECT COUNT(*) FROM task_dependencies td WHERE td.child_task_id = t.id) AS blocked_by_count,
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
            let blocked_by_count: i64 = row.get("blocked_by_count");
            Task {
                id: row.get("id"),
                project_id: row.get("project_id"),
                repository_id: row.get("repository_id"),
                task_number,
                display_key: format!("{}-{}", project_key, task_number),
                title: row.get("title"),
                description: row.get("description"),
                status: row.get("status"),
                blocked_by_count,
                is_blocked: blocked_by_count > 0,
                target_repository_name: row.get("target_repository_name"),
                target_repository_path: row.get("target_repository_path"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            }
        }))
    }

    pub async fn update_task_details(
        &self,
        id: &str,
        input: UpdateTaskDetails,
    ) -> Result<Option<Task>, AppError> {
        sqlx::query(
            "UPDATE tasks
             SET title = ?, description = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.title)
        .bind(&input.description)
        .bind(&input.updated_at)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_task(id).await
    }

    pub async fn update_task_status(
        &self,
        id: &str,
        input: UpdateTaskStatus,
    ) -> Result<Option<Task>, AppError> {
        sqlx::query(
            "UPDATE tasks
             SET status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.status)
        .bind(&input.updated_at)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_task(id).await
    }

    pub async fn move_task_repository(
        &self,
        id: &str,
        input: MoveTaskRepository,
    ) -> Result<Option<Task>, AppError> {
        sqlx::query(
            "UPDATE tasks
             SET repository_id = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.repository_id)
        .bind(&input.updated_at)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_task(id).await
    }

    pub async fn delete_task(&self, id: &str) -> Result<bool, AppError> {
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn get_task_project_id(&self, task_id: &str) -> Result<Option<String>, AppError> {
        let row = sqlx::query("SELECT project_id FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| row.get("project_id")))
    }

    pub async fn dependency_exists(
        &self,
        parent_task_id: &str,
        child_task_id: &str,
    ) -> Result<bool, AppError> {
        let row = sqlx::query(
            "SELECT 1
             FROM task_dependencies
             WHERE parent_task_id = ? AND child_task_id = ?
             LIMIT 1",
        )
        .bind(parent_task_id)
        .bind(child_task_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.is_some())
    }

    pub async fn dependency_would_create_cycle(
        &self,
        parent_task_id: &str,
        child_task_id: &str,
    ) -> Result<bool, AppError> {
        if parent_task_id == child_task_id {
            return Ok(true);
        }

        let row = sqlx::query(
            "WITH RECURSIVE reachable(task_id) AS (
                SELECT child_task_id
                FROM task_dependencies
                WHERE parent_task_id = ?

                UNION

                SELECT td.child_task_id
                FROM task_dependencies td
                JOIN reachable r ON td.parent_task_id = r.task_id
            )
            SELECT 1 FROM reachable WHERE task_id = ? LIMIT 1",
        )
        .bind(child_task_id)
        .bind(parent_task_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.is_some())
    }

    pub async fn list_task_dependencies(
        &self,
        task_id: &str,
    ) -> Result<Option<TaskDependencies>, AppError> {
        let Some(project_id) = self.get_task_project_id(task_id).await? else {
            return Ok(None);
        };

        let parent_rows = sqlx::query(
            "SELECT
                t.id,
                p.key AS project_key,
                t.task_number,
                t.title,
                t.status,
                r.name AS target_repository_name,
                r.repo_path AS target_repository_path,
                t.updated_at
             FROM task_dependencies td
             JOIN tasks t ON t.id = td.parent_task_id AND t.project_id = td.project_id
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_repositories r ON r.id = t.repository_id
             WHERE td.project_id = ? AND td.child_task_id = ?
             ORDER BY t.task_number ASC",
        )
        .bind(&project_id)
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;

        let child_rows = sqlx::query(
            "SELECT
                t.id,
                p.key AS project_key,
                t.task_number,
                t.title,
                t.status,
                r.name AS target_repository_name,
                r.repo_path AS target_repository_path,
                t.updated_at
             FROM task_dependencies td
             JOIN tasks t ON t.id = td.child_task_id AND t.project_id = td.project_id
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_repositories r ON r.id = t.repository_id
             WHERE td.project_id = ? AND td.parent_task_id = ?
             ORDER BY t.task_number ASC",
        )
        .bind(&project_id)
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;

        let parents = parent_rows
            .into_iter()
            .map(|row| {
                let project_key: String = row.get("project_key");
                let task_number: i64 = row.get("task_number");
                TaskDependencyTask {
                    id: row.get("id"),
                    display_key: format!("{}-{}", project_key, task_number),
                    title: row.get("title"),
                    status: row.get("status"),
                    target_repository_name: row.get("target_repository_name"),
                    target_repository_path: row.get("target_repository_path"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        let children = child_rows
            .into_iter()
            .map(|row| {
                let project_key: String = row.get("project_key");
                let task_number: i64 = row.get("task_number");
                TaskDependencyTask {
                    id: row.get("id"),
                    display_key: format!("{}-{}", project_key, task_number),
                    title: row.get("title"),
                    status: row.get("status"),
                    target_repository_name: row.get("target_repository_name"),
                    target_repository_path: row.get("target_repository_path"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(Some(TaskDependencies {
            parents,
            children,
        }))
    }

    pub async fn add_task_dependency(
        &self,
        project_id: &str,
        parent_task_id: &str,
        child_task_id: &str,
        created_at: &str,
    ) -> Result<TaskDependencyEdge, AppError> {
        sqlx::query(
            "INSERT INTO task_dependencies (
                project_id,
                parent_task_id,
                child_task_id,
                created_at
             ) VALUES (?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind(parent_task_id)
        .bind(child_task_id)
        .bind(created_at)
        .execute(&self.pool)
        .await?;

        Ok(TaskDependencyEdge {
            parent_task_id: parent_task_id.to_string(),
            child_task_id: child_task_id.to_string(),
            created_at: created_at.to_string(),
        })
    }

    pub async fn remove_task_dependency(
        &self,
        parent_task_id: &str,
        child_task_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "DELETE FROM task_dependencies
             WHERE parent_task_id = ? AND child_task_id = ?",
        )
        .bind(parent_task_id)
        .bind(child_task_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}
