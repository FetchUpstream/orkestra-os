use crate::app::errors::AppError;
use crate::app::runs::models::{NewRun, Run, RunInitialPromptContext, TaskRunContext};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct RunsRepository {
    pool: SqlitePool,
}

impl RunsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_task_run_context(
        &self,
        task_id: &str,
    ) -> Result<Option<TaskRunContext>, AppError> {
        let row = sqlx::query(
            "SELECT t.project_id, p.key AS project_key, t.repository_id, t.title AS branch_title, pr.repo_path AS repository_path
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             JOIN project_repositories pr ON pr.id = t.repository_id
             WHERE t.id = ?",
        )
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| TaskRunContext {
            project_id: row.get("project_id"),
            project_key: row.get("project_key"),
            repository_id: row.get("repository_id"),
            repository_path: row.get("repository_path"),
            branch_title: row.get("branch_title"),
        }))
    }

    pub async fn get_run_initial_prompt_context(
        &self,
        run_id: &str,
    ) -> Result<Option<RunInitialPromptContext>, AppError> {
        let row = sqlx::query(
            "SELECT r.id AS run_id, t.title AS task_title, t.description AS task_description, t.implementation_guide AS task_implementation_guide
             FROM runs r
             JOIN tasks t ON t.id = r.task_id
             WHERE r.id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| RunInitialPromptContext {
            run_id: row.get("run_id"),
            task_title: row.get("task_title"),
            task_description: row.get("task_description"),
            task_implementation_guide: row.get("task_implementation_guide"),
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
                created_at,
                worktree_id,
                source_branch
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.task_id)
        .bind(&input.project_id)
        .bind(&input.target_repo_id)
        .bind(&input.status)
        .bind(&input.triggered_by)
        .bind(&input.created_at)
        .bind(&input.worktree_id)
        .bind(&input.source_branch)
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
                agent_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id
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
                agent_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id
             FROM runs
             WHERE id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Self::map_row_to_run))
    }

    pub async fn delete_run(&self, run_id: &str) -> Result<bool, AppError> {
        let result = sqlx::query("DELETE FROM runs WHERE id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_run_status(
        &self,
        run_id: &str,
        from_status: &str,
        to_status: &str,
        started_at: Option<&str>,
    ) -> Result<bool, AppError> {
        let started_at_value = started_at.map(std::string::ToString::to_string);
        let result = sqlx::query(
            "UPDATE runs
             SET status = ?,
                 started_at = COALESCE(?, started_at)
             WHERE id = ? AND status = ?",
        )
        .bind(to_status)
        .bind(started_at_value)
        .bind(run_id)
        .bind(from_status)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn transition_queued_to_running_and_mark_task_doing(
        &self,
        run_id: &str,
        started_at: &str,
    ) -> Result<bool, AppError> {
        let mut tx = self.pool.begin().await?;

        let run_update = sqlx::query(
            "UPDATE runs
             SET status = 'running',
                 started_at = COALESCE(started_at, ?)
             WHERE id = ?
               AND status = 'queued'",
        )
        .bind(started_at)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        if run_update.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(false);
        }

        sqlx::query(
            "UPDATE tasks
             SET status = 'doing',
                 updated_at = ?
             WHERE id = (SELECT task_id FROM runs WHERE id = ?)
               AND status IN ('todo', 'review')",
        )
        .bind(started_at)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(true)
    }

    pub async fn update_opencode_session_id(
        &self,
        run_id: &str,
        opencode_session_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET opencode_session_id = ?
             WHERE id = ?",
        )
        .bind(opencode_session_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn set_opencode_session_id_if_unset(
        &self,
        run_id: &str,
        opencode_session_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET opencode_session_id = ?
             WHERE id = ?
               AND (opencode_session_id IS NULL OR TRIM(opencode_session_id) = '')",
        )
        .bind(opencode_session_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_initial_prompt_sent_if_unset(
        &self,
        run_id: &str,
        sent_at: &str,
        client_request_id: Option<&str>,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET initial_prompt_sent_at = ?,
                 initial_prompt_client_request_id = COALESCE(?, initial_prompt_client_request_id)
             WHERE id = ?
               AND initial_prompt_sent_at IS NULL",
        )
        .bind(sent_at)
        .bind(client_request_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn claim_initial_prompt_send_if_unset(
        &self,
        run_id: &str,
        claimed_at: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET initial_prompt_claimed_at = ?,
                 initial_prompt_claim_request_id = ?
             WHERE id = ?
               AND initial_prompt_sent_at IS NULL
               AND initial_prompt_claim_request_id IS NULL",
        )
        .bind(claimed_at)
        .bind(claim_request_id)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn finalize_initial_prompt_send_for_claimant(
        &self,
        run_id: &str,
        sent_at: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET initial_prompt_sent_at = ?,
                 initial_prompt_client_request_id = COALESCE(initial_prompt_client_request_id, ?),
                 initial_prompt_claimed_at = NULL,
                 initial_prompt_claim_request_id = NULL
             WHERE id = ?
               AND initial_prompt_sent_at IS NULL
               AND initial_prompt_claim_request_id = ?",
        )
        .bind(sent_at)
        .bind(claim_request_id)
        .bind(run_id)
        .bind(claim_request_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn release_initial_prompt_claim_for_claimant(
        &self,
        run_id: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET initial_prompt_claimed_at = NULL,
                 initial_prompt_claim_request_id = NULL
             WHERE id = ?
               AND initial_prompt_sent_at IS NULL
               AND initial_prompt_claim_request_id = ?",
        )
        .bind(run_id)
        .bind(claim_request_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_run_completed(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET status = 'completed',
                 finished_at = COALESCE(finished_at, ?)
             WHERE id = ?
               AND status != 'completed'",
        )
        .bind(finished_at)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn finalize_run_completion_and_task_done(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let mut tx = self.pool.begin().await?;

        let run_update = sqlx::query(
            "UPDATE runs
             SET status = 'completed',
                 finished_at = COALESCE(finished_at, ?)
             WHERE id = ?
               AND status != 'completed'",
        )
        .bind(finished_at)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        let task_update = sqlx::query(
            "UPDATE tasks
             SET status = 'done',
                 updated_at = ?
             WHERE id = (SELECT task_id FROM runs WHERE id = ?)
               AND status != 'done'",
        )
        .bind(finished_at)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(run_update.rows_affected() > 0 || task_update.rows_affected() > 0)
    }

    pub async fn transition_task_doing_to_review_on_session_idle(
        &self,
        run_id: &str,
        opencode_session_id: &str,
        updated_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE tasks
             SET status = 'review',
                 updated_at = ?
             WHERE id = (
                 SELECT task_id
                 FROM runs
                 WHERE id = ?
                   AND status IN ('queued', 'preparing', 'running')
                   AND opencode_session_id = ?
             )
               AND status = 'doing'",
        )
        .bind(updated_at)
        .bind(run_id)
        .bind(opencode_session_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
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
            source_branch: row.get("source_branch"),
            opencode_session_id: row.get("opencode_session_id"),
            initial_prompt_sent_at: row.get("initial_prompt_sent_at"),
            initial_prompt_client_request_id: row.get("initial_prompt_client_request_id"),
        }
    }
}
