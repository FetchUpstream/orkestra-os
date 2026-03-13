use crate::app::errors::AppError;
use crate::app::runs::models::{NewRun, Run, TaskRunContext};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct RunsRepository {
    pool: SqlitePool,
}

impl RunsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_task_run_context(&self, task_id: &str) -> Result<Option<TaskRunContext>, AppError> {
        let row = sqlx::query("SELECT project_id, repository_id FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| TaskRunContext {
            project_id: row.get("project_id"),
            repository_id: row.get("repository_id"),
        }))
    }

    pub async fn create_run(&self, input: NewRun) -> Result<Run, AppError> {
        sqlx::query(
            "INSERT INTO runs (
                id,
                task_id,
                project_id,
                target_repo_id,
                status,
                triggered_by,
                created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.task_id)
        .bind(&input.project_id)
        .bind(&input.target_repo_id)
        .bind(&input.status)
        .bind(&input.triggered_by)
        .bind(&input.created_at)
        .execute(&self.pool)
        .await?;

        self.get_run(&input.id)
            .await?
            .ok_or_else(|| AppError::not_found("run not found after create"))
    }

    pub async fn list_task_runs(&self, task_id: &str) -> Result<Vec<Run>, AppError> {
        let rows = sqlx::query(
            "SELECT
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
                agent_id
             FROM runs
             WHERE task_id = ?
             ORDER BY created_at DESC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(Self::map_row_to_run).collect())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<Run>, AppError> {
        let row = sqlx::query(
            "SELECT
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
                agent_id
             FROM runs
             WHERE id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Self::map_row_to_run))
    }

    fn map_row_to_run(row: sqlx::sqlite::SqliteRow) -> Run {
        Run {
            id: row.get("id"),
            task_id: row.get("task_id"),
            project_id: row.get("project_id"),
            target_repo_id: row.get("target_repo_id"),
            status: row.get("status"),
            triggered_by: row.get("triggered_by"),
            created_at: row.get("created_at"),
            started_at: row.get("started_at"),
            finished_at: row.get("finished_at"),
            summary: row.get("summary"),
            error_message: row.get("error_message"),
            worktree_id: row.get("worktree_id"),
            agent_id: row.get("agent_id"),
        }
    }
}
