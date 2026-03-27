use crate::app::tasks::errors::TaskRepositoryError;
use crate::app::tasks::models::{
    MoveTaskRepository, NewTask, Task, TaskDependencies, TaskDependencyEdge, TaskDependencyTask,
    UpdateTaskDetails, UpdateTaskStatus,
};
use sqlx::sqlite::SqliteRow;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

#[derive(Clone, Debug)]
pub struct TasksRepository {
    pool: SqlitePool,
}

impl TasksRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn project_exists(&self, project_id: &str) -> Result<bool, TaskRepositoryError> {
        let row = sqlx::query("SELECT 1 FROM projects WHERE id = ? LIMIT 1")
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| TaskRepositoryError::db("project_exists", source))?;
        Ok(row.is_some())
    }

    pub async fn repository_belongs_to_project(
        &self,
        repository_id: &str,
        project_id: &str,
    ) -> Result<bool, TaskRepositoryError> {
        let row = sqlx::query(
            "SELECT 1 FROM project_repositories WHERE id = ? AND project_id = ? LIMIT 1",
        )
        .bind(repository_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("repository_belongs_to_project", source))?;
        Ok(row.is_some())
    }

    pub async fn create_task(&self, input: NewTask) -> Result<Task, TaskRepositoryError> {
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
             VALUES (
                ?,
                ?,
                ?,
                COALESCE((SELECT MAX(task_number) + 1 FROM tasks WHERE project_id = ?), 1),
                ?,
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
        .bind(&input.implementation_guide)
        .bind(&input.status)
        .bind(&input.created_at)
        .bind(&input.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("create_task", source))?;

        self.get_task(&input.id).await?.ok_or_else(|| {
            TaskRepositoryError::db("create_task.fetch_created_task", sqlx::Error::RowNotFound)
        })
    }

    pub async fn list_project_tasks(
        &self,
        project_id: &str,
    ) -> Result<Vec<Task>, TaskRepositoryError> {
        let rows = sqlx::query(
            "SELECT
                t.id,
                t.project_id,
                t.repository_id,
                t.task_number,
                p.key AS project_key,
                t.title,
                t.description,
                t.implementation_guide,
                t.status,
                (
                    SELECT COUNT(*)
                    FROM task_dependencies td
                    WHERE td.project_id = t.project_id
                      AND td.child_task_id = t.id
                ) AS blocked_by_count,
                EXISTS(
                    SELECT 1
                    FROM task_dependencies td
                    JOIN tasks parent ON parent.id = td.parent_task_id AND parent.project_id = td.project_id
                    WHERE td.child_task_id = t.id
                      AND td.project_id = t.project_id
                      AND parent.status != 'done'
                ) AS is_blocked,
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
        .await
        .map_err(|source| TaskRepositoryError::db("list_project_tasks", source))?;

        Ok(rows.into_iter().map(Self::map_task_row).collect())
    }

    pub async fn list_tasks_by_ids(
        &self,
        task_ids: &[String],
    ) -> Result<Vec<Task>, TaskRepositoryError> {
        if task_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_builder = QueryBuilder::<Sqlite>::new(
            "SELECT
                t.id,
                t.project_id,
                t.repository_id,
                t.task_number,
                p.key AS project_key,
                t.title,
                t.description,
                t.implementation_guide,
                t.status,
                (
                    SELECT COUNT(*)
                    FROM task_dependencies td
                    WHERE td.project_id = t.project_id
                      AND td.child_task_id = t.id
                ) AS blocked_by_count,
                EXISTS(
                    SELECT 1
                    FROM task_dependencies td
                    JOIN tasks parent ON parent.id = td.parent_task_id AND parent.project_id = td.project_id
                    WHERE td.child_task_id = t.id
                      AND td.project_id = t.project_id
                      AND parent.status != 'done'
                ) AS is_blocked,
                r.name AS target_repository_name,
                r.repo_path AS target_repository_path,
                t.created_at,
                t.updated_at
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN project_repositories r ON r.id = t.repository_id
             WHERE t.id IN (",
        );

        {
            let mut separated = query_builder.separated(", ");
            for task_id in task_ids {
                separated.push_bind(task_id);
            }
        }

        query_builder.push(")");

        let rows = query_builder
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(|source| TaskRepositoryError::db("list_tasks_by_ids", source))?;
        Ok(rows.into_iter().map(Self::map_task_row).collect())
    }

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, TaskRepositoryError> {
        let row = sqlx::query(
            "SELECT
                t.id,
                t.project_id,
                t.repository_id,
                t.task_number,
                p.key AS project_key,
                t.title,
                t.description,
                t.implementation_guide,
                t.status,
                (
                    SELECT COUNT(*)
                    FROM task_dependencies td
                    WHERE td.project_id = t.project_id
                      AND td.child_task_id = t.id
                ) AS blocked_by_count,
                EXISTS(
                    SELECT 1
                    FROM task_dependencies td
                    JOIN tasks parent ON parent.id = td.parent_task_id AND parent.project_id = td.project_id
                    WHERE td.child_task_id = t.id
                      AND td.project_id = t.project_id
                      AND parent.status != 'done'
                ) AS is_blocked,
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
        .await
        .map_err(|source| TaskRepositoryError::db("get_task", source))?;

        Ok(row.map(Self::map_task_row))
    }

    fn map_task_row(row: SqliteRow) -> Task {
        let project_key: String = row.get("project_key");
        let task_number: i64 = row.get("task_number");
        let blocked_by_count: i64 = row.get("blocked_by_count");
        let is_blocked: bool = row.get("is_blocked");
        Task {
            id: row.get("id"),
            project_id: row.get("project_id"),
            repository_id: row.get("repository_id"),
            task_number,
            display_key: format!("{}-{}", project_key, task_number),
            title: row.get("title"),
            description: row.get("description"),
            implementation_guide: row.get("implementation_guide"),
            status: row.get("status"),
            blocked_by_count,
            is_blocked,
            target_repository_name: row.get("target_repository_name"),
            target_repository_path: row.get("target_repository_path"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    pub async fn update_task_details(
        &self,
        id: &str,
        input: UpdateTaskDetails,
    ) -> Result<Option<Task>, TaskRepositoryError> {
        sqlx::query(
            "UPDATE tasks
             SET title = ?,
                 description = ?,
                 implementation_guide = CASE WHEN ? THEN ? ELSE implementation_guide END,
                 updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.title)
        .bind(&input.description)
        .bind(input.implementation_guide.is_some())
        .bind(input.implementation_guide.flatten())
        .bind(&input.updated_at)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("update_task_details", source))?;

        self.get_task(id).await
    }

    pub async fn update_task_status(
        &self,
        id: &str,
        input: UpdateTaskStatus,
    ) -> Result<(Option<Task>, bool), TaskRepositoryError> {
        let result = sqlx::query(
            "UPDATE tasks
              SET status = ?, updated_at = ?
             WHERE id = ?
               AND status != ?",
        )
        .bind(&input.status)
        .bind(&input.updated_at)
        .bind(id)
        .bind(&input.status)
        .execute(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("update_task_status", source))?;

        Ok((self.get_task(id).await?, result.rows_affected() > 0))
    }

    pub async fn move_task_repository(
        &self,
        id: &str,
        input: MoveTaskRepository,
    ) -> Result<Option<Task>, TaskRepositoryError> {
        sqlx::query(
            "UPDATE tasks
             SET repository_id = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&input.repository_id)
        .bind(&input.updated_at)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("move_task_repository", source))?;

        self.get_task(id).await
    }

    pub async fn delete_task(&self, id: &str) -> Result<bool, TaskRepositoryError> {
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|source| TaskRepositoryError::db("delete_task", source))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn get_task_project_id(
        &self,
        task_id: &str,
    ) -> Result<Option<String>, TaskRepositoryError> {
        let row = sqlx::query("SELECT project_id FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| TaskRepositoryError::db("get_task_project_id", source))?;

        Ok(row.map(|row| row.get("project_id")))
    }

    pub async fn dependency_exists(
        &self,
        parent_task_id: &str,
        child_task_id: &str,
    ) -> Result<bool, TaskRepositoryError> {
        let row = sqlx::query(
            "SELECT 1
             FROM task_dependencies
             WHERE parent_task_id = ? AND child_task_id = ?
             LIMIT 1",
        )
        .bind(parent_task_id)
        .bind(child_task_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("dependency_exists", source))?;

        Ok(row.is_some())
    }

    pub async fn dependency_would_create_cycle(
        &self,
        parent_task_id: &str,
        child_task_id: &str,
    ) -> Result<bool, TaskRepositoryError> {
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
        .await
        .map_err(|source| TaskRepositoryError::db("dependency_would_create_cycle", source))?;

        Ok(row.is_some())
    }

    pub async fn list_task_dependencies(
        &self,
        task_id: &str,
    ) -> Result<Option<TaskDependencies>, TaskRepositoryError> {
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
        .await
        .map_err(|source| TaskRepositoryError::db("list_task_dependencies.parents", source))?;

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
        .await
        .map_err(|source| TaskRepositoryError::db("list_task_dependencies.children", source))?;

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

        Ok(Some(TaskDependencies { parents, children }))
    }

    pub async fn add_task_dependency(
        &self,
        project_id: &str,
        parent_task_id: &str,
        child_task_id: &str,
        created_at: &str,
    ) -> Result<TaskDependencyEdge, TaskRepositoryError> {
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
        .await
        .map_err(|source| TaskRepositoryError::db("add_task_dependency", source))?;

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
    ) -> Result<bool, TaskRepositoryError> {
        let result = sqlx::query(
            "DELETE FROM task_dependencies
             WHERE parent_task_id = ? AND child_task_id = ?",
        )
        .bind(parent_task_id)
        .bind(child_task_id)
        .execute(&self.pool)
        .await
        .map_err(|source| TaskRepositoryError::db("remove_task_dependency", source))?;

        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;

    async fn setup_repository() -> TasksRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        TasksRepository::new(pool)
    }

    async fn seed_project_and_repository(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("project-1")
        .bind("Project")
        .bind("PRJ")
        .bind(Option::<String>::None)
        .bind("repo-1")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("repo-1")
        .bind("project-1")
        .bind("Main")
        .bind("/repo/main")
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_task(pool: &SqlitePool, id: &str, task_number: i64, status: &str) {
        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind("project-1")
        .bind("repo-1")
        .bind(task_number)
        .bind(format!("Task {}", task_number))
        .bind(Option::<String>::None)
        .bind(status)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_dependency(pool: &SqlitePool, parent_task_id: &str, child_task_id: &str) {
        sqlx::query(
            "INSERT INTO task_dependencies (project_id, parent_task_id, child_task_id, created_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind("project-1")
        .bind(parent_task_id)
        .bind(child_task_id)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn done_parent_dependency_does_not_block_task_for_get_and_list() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_and_repository(&pool).await;
        seed_task(&pool, "task-parent", 1, "done").await;
        seed_task(&pool, "task-child", 2, "todo").await;
        seed_dependency(&pool, "task-parent", "task-child").await;

        let task = repository.get_task("task-child").await.unwrap().unwrap();
        assert!(task.blocked_by_count > 0);
        assert!(!task.is_blocked);

        let tasks = repository.list_project_tasks("project-1").await.unwrap();
        let listed = tasks.into_iter().find(|t| t.id == "task-child").unwrap();
        assert!(listed.blocked_by_count > 0);
        assert!(!listed.is_blocked);
    }

    #[tokio::test]
    async fn non_done_parent_dependency_blocks_task_for_get_and_list() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_and_repository(&pool).await;
        seed_task(&pool, "task-parent", 1, "doing").await;
        seed_task(&pool, "task-child", 2, "todo").await;
        seed_dependency(&pool, "task-parent", "task-child").await;

        let task = repository.get_task("task-child").await.unwrap().unwrap();
        assert_eq!(task.blocked_by_count, 1);
        assert!(task.is_blocked);

        let tasks = repository.list_project_tasks("project-1").await.unwrap();
        let listed = tasks.into_iter().find(|t| t.id == "task-child").unwrap();
        assert!(listed.blocked_by_count > 0);
        assert!(listed.is_blocked);
    }

    #[tokio::test]
    async fn update_task_status_reports_only_persisted_status_changes() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_and_repository(&pool).await;
        seed_task(&pool, "task-1", 1, "todo").await;

        let (first_update, first_changed) = repository
            .update_task_status(
                "task-1",
                UpdateTaskStatus {
                    status: "doing".to_string(),
                    updated_at: "2024-01-02T00:00:00Z".to_string(),
                },
            )
            .await
            .unwrap();
        assert!(first_changed);
        assert_eq!(first_update.unwrap().status, "doing");

        let (second_update, second_changed) = repository
            .update_task_status(
                "task-1",
                UpdateTaskStatus {
                    status: "doing".to_string(),
                    updated_at: "2024-01-03T00:00:00Z".to_string(),
                },
            )
            .await
            .unwrap();
        assert!(!second_changed);
        assert_eq!(second_update.unwrap().status, "doing");
    }

    #[tokio::test]
    async fn list_tasks_by_ids_fetches_requested_tasks() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_and_repository(&pool).await;
        seed_task(&pool, "task-1", 1, "todo").await;
        seed_task(&pool, "task-2", 2, "doing").await;

        let tasks = repository
            .list_tasks_by_ids(&["task-2".to_string(), "task-1".to_string()])
            .await
            .unwrap();

        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|task| task.id == "task-1"));
        assert!(tasks.iter().any(|task| task.id == "task-2"));
    }
}
