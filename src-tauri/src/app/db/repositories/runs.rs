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

use crate::app::errors::AppError;
use crate::app::runs::errors::RunsRepositoryError;
use crate::app::runs::models::{NewRun, Run, RunInitialPromptContext, TaskRunContext};
use sqlx::{Row, SqlitePool};
use std::sync::LazyLock;

pub(crate) const ACTIVE_RUN_STATUSES: [&str; 4] = ["queued", "preparing", "in_progress", "idle"];
static ACTIVE_RUN_STATUSES_SQL: LazyLock<String> = LazyLock::new(|| {
    ACTIVE_RUN_STATUSES
        .iter()
        .map(|status| format!("'{status}'"))
        .collect::<Vec<_>>()
        .join(", ")
});
const TERMINAL_RUN_STATUSES: [&str; 4] = ["complete", "failed", "cancelled", "rejected"];

pub(crate) fn is_active_run_status(status: &str) -> bool {
    ACTIVE_RUN_STATUSES.contains(&status)
}

trait RunsSqlxResultExt<T> {
    fn runs_db(self, operation: &'static str) -> Result<T, RunsRepositoryError>;
}

impl<T> RunsSqlxResultExt<T> for Result<T, sqlx::Error> {
    fn runs_db(self, operation: &'static str) -> Result<T, RunsRepositoryError> {
        self.map_err(|source| RunsRepositoryError::database(operation, source))
    }
}

#[derive(Clone, Debug)]
pub struct RunsRepository {
    pool: SqlitePool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunDeleteTaskStatusReconciliation {
    pub task_id: String,
    pub project_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunDeleteResult {
    pub deleted: bool,
    pub task_status_reconciled: Option<RunDeleteTaskStatusReconciliation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunStatusChangeTarget {
    pub run_id: String,
    pub task_id: String,
    pub project_id: String,
    pub previous_status: String,
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
            "SELECT t.project_id,
                    p.key AS project_key,
                    p.key || '-' || t.task_number AS task_display_key,
                    t.repository_id,
                    t.title AS branch_title,
                    pr.repo_path AS repository_path
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             JOIN project_repositories pr ON pr.id = t.repository_id
             WHERE t.id = ?",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await
        .runs_db("loading task run context")?;

        Ok(row.map(|row| TaskRunContext {
            project_id: row.get("project_id"),
            project_key: row.get("project_key"),
            task_display_key: row.get("task_display_key"),
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
            "SELECT r.id AS run_id, t.title AS task_title, t.description AS task_description, t.implementation_guide AS task_implementation_guide,
                    pr.setup_script AS setup_script, pr.cleanup_script AS cleanup_script
              FROM runs r
              JOIN tasks t ON t.id = r.task_id
              LEFT JOIN project_repositories pr ON pr.id = r.target_repo_id
              WHERE r.id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .runs_db("loading run initial prompt context")?;

        Ok(row.map(|row| RunInitialPromptContext {
            run_id: row.get("run_id"),
            task_title: row.get("task_title"),
            task_description: row.get("task_description"),
            task_implementation_guide: row.get("task_implementation_guide"),
            setup_script: row.get("setup_script"),
            cleanup_script: row.get("cleanup_script"),
        }))
    }

    pub async fn get_run_repository_path(&self, run_id: &str) -> Result<Option<String>, AppError> {
        let row = sqlx::query(
            "SELECT pr.repo_path AS repository_path
             FROM runs r
             JOIN project_repositories pr ON pr.id = r.target_repo_id
             WHERE r.id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .runs_db("loading run repository path")?;

        Ok(row.map(|row| row.get("repository_path")))
    }

    pub async fn create_run_with_generated_identifiers(
        &self,
        input: &NewRun,
        task_display_key: &str,
    ) -> Result<Run, AppError> {
        sqlx::query(
            "WITH next_identifier AS (
                SELECT COALESCE(MAX(run_number), 0) + 1 AS run_number
                FROM runs
                WHERE task_id = ?
             )
             INSERT INTO runs (
                id,
                task_id,
                project_id,
                run_number,
                display_key,
                target_repo_id,
                status,
                run_state,
                triggered_by,
                created_at,
                worktree_id,
                agent_id,
                provider_id,
                model_id,
                source_branch
             )
             SELECT
                ?,
                ?,
                ?,
                next_identifier.run_number,
                CASE
                    WHEN TRIM(?) != '' THEN TRIM(?) || '-R' || next_identifier.run_number
                    ELSE 'T' || ? || '-R' || next_identifier.run_number
                END,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?
             FROM next_identifier",
        )
        .bind(&input.task_id)
        .bind(&input.id)
        .bind(&input.task_id)
        .bind(&input.project_id)
        .bind(task_display_key)
        .bind(task_display_key)
        .bind(&input.task_id)
        .bind(&input.target_repo_id)
        .bind(&input.status)
        .bind(&input.run_state)
        .bind(&input.triggered_by)
        .bind(&input.created_at)
        .bind(&input.worktree_id)
        .bind(&input.agent_id)
        .bind(&input.provider_id)
        .bind(&input.model_id)
        .bind(&input.source_branch)
        .execute(&self.pool)
        .await
        .runs_db("creating run with generated identifiers")?;

        self.get_run(&input.id).await?.ok_or_else(|| {
            RunsRepositoryError::RunMissingAfterCreate {
                run_id: input.id.clone(),
            }
            .into()
        })
    }

    pub async fn list_task_runs(&self, task_id: &str) -> Result<Vec<Run>, AppError> {
        let rows = sqlx::query(
            "SELECT
                id,
                task_id,
                project_id,
                run_number,
                display_key,
                target_repo_id,
                status,
                run_state,
                triggered_by,
                created_at,
                started_at,
                finished_at,
                summary,
                error_message,
                worktree_id,
                agent_id,
                provider_id,
                model_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id,
                setup_state,
                setup_started_at,
                setup_finished_at,
                setup_error_message,
                cleanup_state,
                cleanup_started_at,
                cleanup_finished_at,
                cleanup_error_message
             FROM runs
             WHERE task_id = ?
             ORDER BY created_at DESC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await
        .runs_db("listing task runs")?;

        Ok(rows.into_iter().map(Self::map_row_to_run).collect())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<Run>, AppError> {
        let row = sqlx::query(
            "SELECT
                id,
                task_id,
                project_id,
                run_number,
                display_key,
                target_repo_id,
                status,
                run_state,
                triggered_by,
                created_at,
                started_at,
                finished_at,
                summary,
                error_message,
                worktree_id,
                agent_id,
                provider_id,
                model_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id,
                setup_state,
                setup_started_at,
                setup_finished_at,
                setup_error_message,
                cleanup_state,
                cleanup_started_at,
                cleanup_finished_at,
                cleanup_error_message
             FROM runs
             WHERE id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .runs_db("loading run by id")?;

        Ok(row.map(Self::map_row_to_run))
    }

    pub async fn list_active_runs(&self) -> Result<Vec<Run>, AppError> {
        let query = format!(
            "SELECT
                id,
                task_id,
                project_id,
                run_number,
                display_key,
                target_repo_id,
                status,
                run_state,
                triggered_by,
                created_at,
                started_at,
                finished_at,
                summary,
                error_message,
                worktree_id,
                agent_id,
                provider_id,
                model_id,
                source_branch,
                opencode_session_id,
                initial_prompt_sent_at,
                initial_prompt_client_request_id,
                setup_state,
                setup_started_at,
                setup_finished_at,
                setup_error_message,
                cleanup_state,
                cleanup_started_at,
                cleanup_finished_at,
                cleanup_error_message
             FROM runs
             WHERE status IN ({})
             ORDER BY created_at DESC",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let rows = sqlx::query(&query)
            .fetch_all(&self.pool)
            .await
            .runs_db("listing active runs")?;

        Ok(rows.into_iter().map(Self::map_row_to_run).collect())
    }

    pub async fn hard_delete_run_and_reconcile_task_status(
        &self,
        run_id: &str,
        updated_at: &str,
    ) -> Result<RunDeleteResult, AppError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .runs_db("starting run delete transaction")?;

        let run_context: Option<(String, String)> =
            sqlx::query_as("SELECT task_id, project_id FROM runs WHERE id = ?")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .runs_db("loading run context for run delete")?;

        let Some((task_id, project_id)) = run_context else {
            tx.commit()
                .await
                .runs_db("committing run delete transaction")?;
            return Ok(RunDeleteResult {
                deleted: false,
                task_status_reconciled: None,
            });
        };

        let deleted = sqlx::query("DELETE FROM runs WHERE id = ?")
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .runs_db("deleting run in transaction")?;

        if deleted.rows_affected() == 0 {
            tx.commit()
                .await
                .runs_db("committing run delete transaction")?;
            return Ok(RunDeleteResult {
                deleted: false,
                task_status_reconciled: None,
            });
        }

        let task_update_query = format!(
            "UPDATE tasks
             SET status = 'review',
                 updated_at = ?
             WHERE id = ?
               AND status = 'doing'
               AND NOT EXISTS (
                    SELECT 1
                    FROM runs
                    WHERE task_id = ?
                      AND status IN ({})
                )",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let task_update = sqlx::query(&task_update_query)
            .bind(updated_at)
            .bind(&task_id)
            .bind(&task_id)
            .execute(&mut *tx)
            .await
            .runs_db("reconciling task status after run delete")?;

        let task_status_reconciled = if task_update.rows_affected() > 0 {
            Some(RunDeleteTaskStatusReconciliation {
                task_id,
                project_id,
            })
        } else {
            None
        };

        tx.commit()
            .await
            .runs_db("committing run delete transaction")?;

        Ok(RunDeleteResult {
            deleted: true,
            task_status_reconciled,
        })
    }

    pub async fn transition_run_to_cancelled(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let query = format!(
            "UPDATE runs
             SET status = 'cancelled',
                 run_state = NULL,
                 finished_at = COALESCE(finished_at, ?)
             WHERE id = ?
                 AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let result = sqlx::query(&query)
            .bind(finished_at)
            .bind(run_id)
            .execute(&self.pool)
            .await
            .runs_db("transitioning run to cancelled")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn transition_run_to_in_progress_and_mark_task_doing(
        &self,
        run_id: &str,
        started_at: &str,
    ) -> Result<bool, AppError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .runs_db("starting transition transaction")?;

        let run_update = sqlx::query(
            "UPDATE runs
             SET status = 'in_progress',
                 started_at = COALESCE(started_at, ?)
             WHERE id = ?
               AND status IN ('queued', 'preparing', 'idle')",
        )
        .bind(started_at)
        .bind(run_id)
        .execute(&mut *tx)
        .await
        .runs_db("transitioning run to in_progress")?;

        if run_update.rows_affected() == 0 {
            tx.commit()
                .await
                .runs_db("committing transition transaction")?;
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
        .await
        .runs_db("marking task as doing for running transition")?;

        tx.commit()
            .await
            .runs_db("committing transition transaction")?;
        Ok(true)
    }

    pub async fn transition_run_to_idle(&self, run_id: &str) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET status = 'idle'
             WHERE id = ?
               AND status = 'in_progress'",
        )
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("transitioning run to idle")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_run_state(
        &self,
        run_id: &str,
        expected_run_state: Option<&str>,
        run_state: Option<&str>,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET run_state = ?
             WHERE id = ?
               AND (
                 (run_state IS NULL AND ? IS NULL)
                 OR run_state = ?
               )
                AND (
                   (run_state IS NULL AND ? IS NOT NULL)
                   OR (run_state IS NOT NULL AND ? IS NULL)
                   OR run_state != ?
                 )
                AND status NOT IN (?, ?, ?, ?)",
        )
        .bind(run_state)
        .bind(run_id)
        .bind(expected_run_state)
        .bind(expected_run_state)
        .bind(run_state)
        .bind(run_state)
        .bind(run_state)
        .bind(TERMINAL_RUN_STATUSES[0])
        .bind(TERMINAL_RUN_STATUSES[1])
        .bind(TERMINAL_RUN_STATUSES[2])
        .bind(TERMINAL_RUN_STATUSES[3])
        .execute(&self.pool)
        .await
        .runs_db("updating run state")?;

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
        .await
        .runs_db("setting opencode session id")?;

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
        .await
        .runs_db("claiming initial prompt send")?;

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
        .await
        .runs_db("finalizing initial prompt send")?;

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
        .await
        .runs_db("releasing initial prompt claim")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_setup_running_if_pending(
        &self,
        run_id: &str,
        started_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET setup_state = 'running',
                 setup_started_at = COALESCE(setup_started_at, ?)
             WHERE id = ?
               AND setup_state = 'pending'",
        )
        .bind(started_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking setup running")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_setup_succeeded(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET setup_state = 'succeeded',
                 setup_finished_at = COALESCE(setup_finished_at, ?),
                 setup_error_message = NULL
             WHERE id = ?
               AND setup_state != 'succeeded'",
        )
        .bind(finished_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking setup succeeded")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_setup_failed_if_unset(
        &self,
        run_id: &str,
        finished_at: &str,
        error_message: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET setup_state = 'failed',
                 setup_finished_at = COALESCE(setup_finished_at, ?),
                 setup_error_message = COALESCE(setup_error_message, ?)
             WHERE id = ?
               AND setup_state != 'succeeded'",
        )
        .bind(finished_at)
        .bind(error_message)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking setup failed")?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_cleanup_running(
        &self,
        run_id: &str,
        started_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET cleanup_state = 'running',
                  cleanup_started_at = ?
             WHERE id = ?
               AND cleanup_state = 'pending'",
        )
        .bind(started_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking cleanup running")?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_cleanup_succeeded(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET cleanup_state = 'succeeded',
                 cleanup_finished_at = ?,
                 cleanup_error_message = NULL
             WHERE id = ?",
        )
        .bind(finished_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking cleanup succeeded")?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_cleanup_failed(
        &self,
        run_id: &str,
        finished_at: &str,
        error_message: &str,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE runs
             SET cleanup_state = 'failed',
                 cleanup_finished_at = ?,
                 cleanup_error_message = ?
             WHERE id = ?",
        )
        .bind(finished_at)
        .bind(error_message)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .runs_db("marking cleanup failed")?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn finalize_run_completion_and_task_done(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<bool, AppError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .runs_db("starting completion transaction")?;

        let run_update_query = format!(
            "UPDATE runs
             SET status = 'complete',
                 finished_at = COALESCE(finished_at, ?)
             WHERE id = ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let run_update = sqlx::query(&run_update_query)
            .bind(finished_at)
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .runs_db("marking run complete")?;

        if run_update.rows_affected() == 0 {
            tx.commit()
                .await
                .runs_db("committing completion transaction")?;
            return Ok(false);
        }

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
        .await
        .runs_db("marking task done")?;

        tx.commit()
            .await
            .runs_db("committing completion transaction")?;

        Ok(run_update.rows_affected() > 0 || task_update.rows_affected() > 0)
    }

    pub async fn finalize_run_completion_and_reject_siblings(
        &self,
        run_id: &str,
        finished_at: &str,
    ) -> Result<Option<(RunStatusChangeTarget, Vec<RunStatusChangeTarget>)>, AppError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .runs_db("starting merge completion transaction")?;

        let merged_run_query = format!(
            "SELECT id, task_id, project_id, status
             FROM runs
             WHERE id = ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let merged_run = sqlx::query(&merged_run_query)
            .bind(run_id)
            .fetch_optional(&mut *tx)
            .await
            .runs_db("loading merged run transition target")?
            .map(|row| RunStatusChangeTarget {
                run_id: row.get("id"),
                task_id: row.get("task_id"),
                project_id: row.get("project_id"),
                previous_status: row.get("status"),
            });

        let Some(merged_run) = merged_run else {
            tx.commit()
                .await
                .runs_db("committing merge completion transaction")?;
            return Ok(None);
        };

        let sibling_query = format!(
            "SELECT id, task_id, project_id, status
             FROM runs
             WHERE task_id = ?
               AND id != ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let rejected_siblings = sqlx::query(&sibling_query)
            .bind(&merged_run.task_id)
            .bind(run_id)
            .fetch_all(&mut *tx)
            .await
            .runs_db("loading sibling run transition targets")?
            .into_iter()
            .map(|row| RunStatusChangeTarget {
                run_id: row.get("id"),
                task_id: row.get("task_id"),
                project_id: row.get("project_id"),
                previous_status: row.get("status"),
            })
            .collect::<Vec<_>>();

        let run_update_query = format!(
            "UPDATE runs
             SET status = 'complete',
                 run_state = NULL,
                 finished_at = COALESCE(finished_at, ?)
             WHERE id = ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let run_update = sqlx::query(&run_update_query)
            .bind(finished_at)
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .runs_db("marking merged run complete")?;

        if run_update.rows_affected() == 0 {
            tx.commit()
                .await
                .runs_db("committing merge completion transaction")?;
            return Ok(None);
        }

        let sibling_update_query = format!(
            "UPDATE runs
             SET status = 'rejected',
                 run_state = NULL,
                 finished_at = COALESCE(finished_at, ?)
             WHERE task_id = (SELECT task_id FROM runs WHERE id = ?)
               AND id != ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        sqlx::query(&sibling_update_query)
            .bind(finished_at)
            .bind(run_id)
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .runs_db("rejecting sibling runs")?;

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
        .await
        .runs_db("marking task done after merge")?;

        tx.commit()
            .await
            .runs_db("committing merge completion transaction")?;

        let _ = task_update;

        Ok(Some((merged_run, rejected_siblings)))
    }

    pub async fn cancel_task_active_runs(
        &self,
        task_id: &str,
        finished_at: &str,
    ) -> Result<Vec<RunStatusChangeTarget>, AppError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .runs_db("starting task cancel transaction")?;

        sqlx::query("DROP TABLE IF EXISTS temp.cancel_task_active_run_targets")
            .execute(&mut *tx)
            .await
            .runs_db("resetting task cancel targets")?;

        sqlx::query(
            "CREATE TEMP TABLE temp.cancel_task_active_run_targets (
                run_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                previous_status TEXT NOT NULL
            )",
        )
        .execute(&mut *tx)
        .await
        .runs_db("creating task cancel targets")?;

        let seed_targets_query = format!(
            "INSERT INTO temp.cancel_task_active_run_targets (run_id, task_id, project_id, previous_status)
             SELECT id, task_id, project_id, status
             FROM runs
             WHERE task_id = ?
               AND status IN ({})",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );
        sqlx::query(&seed_targets_query)
            .bind(task_id)
            .execute(&mut *tx)
            .await
            .runs_db("loading task cancel targets")?;

        let update_query = format!(
            "UPDATE runs
             SET status = 'cancelled',
                 run_state = NULL,
                 finished_at = COALESCE(finished_at, ?)
             WHERE task_id = ?
               AND status IN ({})
             RETURNING
                 id,
                 task_id,
                 project_id,
                 (
                     SELECT previous_status
                     FROM temp.cancel_task_active_run_targets
                     WHERE run_id = id
                 ) AS previous_status",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let cancelled_runs = sqlx::query(&update_query)
            .bind(finished_at)
            .bind(task_id)
            .fetch_all(&mut *tx)
            .await
            .runs_db("cancelling task active runs")?
            .into_iter()
            .map(|row| RunStatusChangeTarget {
                run_id: row.get("id"),
                task_id: row.get("task_id"),
                project_id: row.get("project_id"),
                previous_status: row.get("previous_status"),
            })
            .collect::<Vec<_>>();

        sqlx::query("DROP TABLE temp.cancel_task_active_run_targets")
            .execute(&mut *tx)
            .await
            .runs_db("dropping task cancel targets")?;

        tx.commit()
            .await
            .runs_db("committing task cancel transaction")?;

        Ok(cancelled_runs)
    }

    pub async fn transition_task_doing_to_review_on_session_idle(
        &self,
        run_id: &str,
        opencode_session_id: &str,
        updated_at: &str,
    ) -> Result<bool, AppError> {
        let query = format!(
            "UPDATE tasks
             SET status = 'review',
                  updated_at = ?
              WHERE id = (
                  SELECT task_id
                  FROM runs
                  WHERE id = ?
                      AND status = 'idle'
                      AND opencode_session_id = ?
                )
                 AND NOT EXISTS (
                     SELECT 1
                     FROM runs AS other_runs
                     WHERE other_runs.task_id = (SELECT task_id FROM runs WHERE id = ?)
                       AND other_runs.status IN ({})
                       AND other_runs.id != ?
                  )
                 AND status = 'doing'",
            ACTIVE_RUN_STATUSES_SQL.as_str(),
        );

        let result = sqlx::query(&query)
            .bind(updated_at)
            .bind(run_id)
            .bind(opencode_session_id)
            .bind(run_id)
            .bind(run_id)
            .execute(&self.pool)
            .await
            .runs_db("transitioning task to review on session idle")?;

        Ok(result.rows_affected() > 0)
    }

    fn map_row_to_run(row: sqlx::sqlite::SqliteRow) -> Run {
        Run {
            id: row.get("id"),
            task_id: row.get("task_id"),
            project_id: row.get("project_id"),
            run_number: row.get("run_number"),
            display_key: row.get("display_key"),
            target_repo_id: row.get("target_repo_id"),
            status: row.get("status"),
            run_state: row.get("run_state"),
            triggered_by: row.get("triggered_by"),
            created_at: row.get("created_at"),
            started_at: row.get("started_at"),
            finished_at: row.get("finished_at"),
            summary: row.get("summary"),
            error_message: row.get("error_message"),
            worktree_id: row.get("worktree_id"),
            agent_id: row.get("agent_id"),
            provider_id: row.get("provider_id"),
            model_id: row.get("model_id"),
            source_branch: row.get("source_branch"),
            opencode_session_id: row.get("opencode_session_id"),
            initial_prompt_sent_at: row.get("initial_prompt_sent_at"),
            initial_prompt_client_request_id: row.get("initial_prompt_client_request_id"),
            setup_state: row.get("setup_state"),
            setup_started_at: row.get("setup_started_at"),
            setup_finished_at: row.get("setup_finished_at"),
            setup_error_message: row.get("setup_error_message"),
            cleanup_state: row.get("cleanup_state"),
            cleanup_started_at: row.get("cleanup_started_at"),
            cleanup_finished_at: row.get("cleanup_finished_at"),
            cleanup_error_message: row.get("cleanup_error_message"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;

    async fn setup_repository() -> RunsRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        RunsRepository::new(pool)
    }

    async fn seed_project_task_and_repository(pool: &SqlitePool) {
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

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind(1)
        .bind("Task")
        .bind(Option::<String>::None)
        .bind("todo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_run(pool: &SqlitePool, run_id: &str, status: &str, created_at: &str) {
        let status = match status {
            "running" => "in_progress",
            "completed" => "complete",
            other => other,
        };
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind(status)
        .bind("user")
        .bind(created_at)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn transition_task_doing_to_review_on_session_idle_skips_when_another_run_in_progress() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, opencode_session_id)
             VALUES
             ('run-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:00:00Z', 'session-idle'),
             ('run-busy', 'task-1', 'project-1', 'repo-1', 'in_progress', 'user', '2024-01-01T00:01:00Z', 'session-busy')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .transition_task_doing_to_review_on_session_idle(
                "run-idle",
                "session-idle",
                "2024-01-01T00:10:00Z",
            )
            .await
            .unwrap();

        assert!(!changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");
    }

    #[test]
    fn active_run_statuses_sql_matches_active_run_statuses() {
        let expected = ACTIVE_RUN_STATUSES
            .iter()
            .map(|status| format!("'{status}'"))
            .collect::<Vec<_>>()
            .join(", ");

        assert_eq!(ACTIVE_RUN_STATUSES_SQL.as_str(), expected);
    }

    #[tokio::test]
    async fn transition_run_to_in_progress_and_mark_task_doing_sets_review_task_back_to_doing() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'review' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES ('run-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .transition_run_to_in_progress_and_mark_task_doing("run-idle", "2024-01-01T00:05:00Z")
            .await
            .unwrap();

        assert!(changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");

        let run_status: String =
            sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-idle'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_status, "in_progress");
    }

    #[tokio::test]
    async fn transition_task_doing_to_review_on_session_idle_skips_when_another_active_sibling_exists(
    ) {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, opencode_session_id)
             VALUES
             ('run-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:00:00Z', 'session-idle'),
             ('run-other-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:01:00Z', 'session-other')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .transition_task_doing_to_review_on_session_idle(
                "run-idle",
                "session-idle",
                "2024-01-01T00:10:00Z",
            )
            .await
            .unwrap();

        assert!(!changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");
    }

    #[tokio::test]
    async fn transition_task_doing_to_review_on_session_idle_updates_when_no_active_siblings_exist()
    {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, opencode_session_id)
             VALUES
             ('run-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:00:00Z', 'session-idle'),
             ('run-complete', 'task-1', 'project-1', 'repo-1', 'complete', 'user', '2024-01-01T00:01:00Z', 'session-complete')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .transition_task_doing_to_review_on_session_idle(
                "run-idle",
                "session-idle",
                "2024-01-01T00:10:00Z",
            )
            .await
            .unwrap();

        assert!(changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "review");
    }

    #[tokio::test]
    async fn finalize_run_completion_and_task_done_marks_task_done() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        seed_run(&pool, "run-1", "in_progress", "2024-01-01T00:00:00Z").await;

        let changed = repository
            .finalize_run_completion_and_task_done("run-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "done");

        let run_status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_status, "complete");
    }

    #[tokio::test]
    async fn finalize_run_completion_and_task_done_skips_cancelled_run() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        seed_run(&pool, "run-1", "cancelled", "2024-01-01T00:00:00Z").await;

        let changed = repository
            .finalize_run_completion_and_task_done("run-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(!changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");

        let run_status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_status, "cancelled");
    }

    #[tokio::test]
    async fn finalize_run_completion_and_task_done_skips_failed_run() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        seed_run(&pool, "run-1", "failed", "2024-01-01T00:00:00Z").await;

        let changed = repository
            .finalize_run_completion_and_task_done("run-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(!changed);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");

        let run_status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_status, "failed");
    }

    #[tokio::test]
    async fn transition_run_to_cancelled_clears_run_state() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("in_progress")
        .bind("busy_coding")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .transition_run_to_cancelled("run-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(changed);

        let status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "cancelled");

        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state, None);
    }

    #[tokio::test]
    async fn cancel_task_active_runs_returns_only_rows_updated_by_cancellation_query() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES ('task-2', 'project-1', 'repo-1', 2, 'Task 2', NULL, 'todo', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES
             ('run-queued', 'task-1', 'project-1', 'repo-1', 'queued', 'queued_state', 'user', '2024-01-01T00:00:00Z'),
             ('run-idle', 'task-1', 'project-1', 'repo-1', 'idle', 'idle_state', 'user', '2024-01-01T00:01:00Z'),
             ('run-complete', 'task-1', 'project-1', 'repo-1', 'complete', 'done_state', 'user', '2024-01-01T00:02:00Z'),
             ('run-already-cancelled', 'task-1', 'project-1', 'repo-1', 'cancelled', 'cancelled_state', 'user', '2024-01-01T00:03:00Z'),
             ('run-other-task', 'task-2', 'project-1', 'repo-1', 'preparing', 'other_state', 'user', '2024-01-01T00:04:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut cancelled = repository
            .cancel_task_active_runs("task-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();
        cancelled.sort_by(|left, right| left.run_id.cmp(&right.run_id));

        assert_eq!(
            cancelled,
            vec![
                RunStatusChangeTarget {
                    run_id: "run-idle".to_string(),
                    task_id: "task-1".to_string(),
                    project_id: "project-1".to_string(),
                    previous_status: "idle".to_string(),
                },
                RunStatusChangeTarget {
                    run_id: "run-queued".to_string(),
                    task_id: "task-1".to_string(),
                    project_id: "project-1".to_string(),
                    previous_status: "queued".to_string(),
                },
            ]
        );

        let task_1_rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, status, run_state FROM runs WHERE task_id = 'task-1' ORDER BY created_at ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            task_1_rows,
            vec![
                ("run-queued".to_string(), "cancelled".to_string(), None),
                ("run-idle".to_string(), "cancelled".to_string(), None),
                (
                    "run-complete".to_string(),
                    "complete".to_string(),
                    Some("done_state".to_string()),
                ),
                (
                    "run-already-cancelled".to_string(),
                    "cancelled".to_string(),
                    Some("cancelled_state".to_string()),
                ),
            ]
        );

        let other_task_row: (String, Option<String>) =
            sqlx::query_as("SELECT status, run_state FROM runs WHERE id = 'run-other-task'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            other_task_row,
            ("preparing".to_string(), Some("other_state".to_string()))
        );
    }

    #[tokio::test]
    async fn update_run_state_updates_when_expected_state_matches() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("in_progress")
        .bind("busy_coding")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .update_run_state("run-1", Some("busy_coding"), Some("waiting_for_input"))
            .await
            .unwrap();

        assert!(changed);

        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("waiting_for_input"));
    }

    #[tokio::test]
    async fn update_run_state_skips_when_expected_state_mismatches() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("in_progress")
        .bind("question_pending")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .update_run_state("run-1", Some("busy_coding"), Some("waiting_for_input"))
            .await
            .unwrap();

        assert!(!changed);

        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("question_pending"));
    }

    #[tokio::test]
    async fn update_run_state_skips_when_run_status_is_terminal() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("complete")
        .bind("busy_coding")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .update_run_state("run-1", Some("busy_coding"), Some("waiting_for_input"))
            .await
            .unwrap();

        assert!(!changed);

        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("busy_coding"));
    }

    #[tokio::test]
    async fn update_run_state_skips_when_run_status_is_rejected() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("rejected")
        .bind("busy_coding")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let changed = repository
            .update_run_state("run-1", Some("busy_coding"), Some("waiting_for_input"))
            .await
            .unwrap();

        assert!(!changed);

        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("busy_coding"));
    }

    #[tokio::test]
    async fn hard_delete_run_and_reconcile_task_status_sets_review_when_last_active_deleted() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES ('run-1', 'task-1', 'project-1', 'repo-1', 'cancelled', 'user', '2024-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let deleted = repository
            .hard_delete_run_and_reconcile_task_status("run-1", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(deleted.deleted);
        assert_eq!(
            deleted.task_status_reconciled,
            Some(RunDeleteTaskStatusReconciliation {
                task_id: "task-1".to_string(),
                project_id: "project-1".to_string(),
            })
        );

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "review");
    }

    #[tokio::test]
    async fn hard_delete_run_and_reconcile_task_status_keeps_doing_when_other_active_exists() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES
             ('run-delete', 'task-1', 'project-1', 'repo-1', 'cancelled', 'user', '2024-01-01T00:00:00Z'),
             ('run-active', 'task-1', 'project-1', 'repo-1', 'idle', 'user', '2024-01-01T00:01:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let deleted = repository
            .hard_delete_run_and_reconcile_task_status("run-delete", "2024-01-01T00:10:00Z")
            .await
            .unwrap();

        assert!(deleted.deleted);
        assert_eq!(deleted.task_status_reconciled, None);

        let task_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE id = 'task-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(task_status, "doing");
    }

    #[tokio::test]
    async fn list_active_runs_returns_only_active_statuses_newest_first() {
        let repository = setup_repository().await;
        let pool = repository.pool.clone();
        seed_project_task_and_repository(&pool).await;

        for (task_id, task_number) in [("task-2", 2_i64), ("task-3", 3_i64)] {
            sqlx::query(
                "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(task_id)
            .bind("project-1")
            .bind("repo-1")
            .bind(task_number)
            .bind("Task")
            .bind(Option::<String>::None)
            .bind("todo")
            .bind("2024-01-01T00:00:00Z")
            .bind("2024-01-01T00:00:00Z")
            .execute(&pool)
            .await
            .unwrap();
        }

        seed_run(&pool, "run-completed", "complete", "2024-01-01T00:00:00Z").await;
        seed_run(&pool, "run-queued", "queued", "2024-01-02T00:00:00Z").await;
        seed_run(&pool, "run-failed", "failed", "2024-01-03T00:00:00Z").await;
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-preparing")
        .bind("task-2")
        .bind("project-1")
        .bind("repo-1")
        .bind("preparing")
        .bind("user")
        .bind("2024-01-04T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-running")
        .bind("task-3")
        .bind("project-1")
        .bind("repo-1")
        .bind("in_progress")
        .bind("user")
        .bind("2024-01-05T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();
        seed_run(&pool, "run-cancelled", "cancelled", "2024-01-06T00:00:00Z").await;

        let active_runs = repository.list_active_runs().await.unwrap();

        let ids: Vec<&str> = active_runs.iter().map(|run| run.id.as_str()).collect();
        assert_eq!(ids, vec!["run-running", "run-preparing", "run-queued"]);
        assert!(active_runs
            .iter()
            .all(|run| is_active_run_status(run.status.as_str())));
    }
}
