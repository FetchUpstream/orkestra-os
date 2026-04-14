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

use crate::app::db::repositories::runs::RunsRepository;
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::runs::dto::RunStatusChangedEventDto;
use crate::app::runs::opencode_service::RunsOpenCodeService;
use crate::app::runs::status_transition_service::RunStatusTransitionService;
use crate::app::tasks::models::{Task, UpdateTaskStatus};
use chrono::Utc;
use tracing::warn;

const MERGE_REJECTION_SHUTDOWN_REASON: &str = "task_completed_run_rejected";
const MANUAL_DONE_CANCELLATION_SHUTDOWN_REASON: &str = "task_completed_run_cancelled";

#[derive(Clone, Debug)]
pub struct RunTaskCompletionService {
    runs_repository: RunsRepository,
    tasks_repository: TasksRepository,
    runs_opencode_service: RunsOpenCodeService,
    run_status_transition_service: RunStatusTransitionService,
}

impl RunTaskCompletionService {
    pub fn new(
        runs_repository: RunsRepository,
        tasks_repository: TasksRepository,
        runs_opencode_service: RunsOpenCodeService,
        run_status_transition_service: RunStatusTransitionService,
    ) -> Self {
        Self {
            runs_repository,
            tasks_repository,
            runs_opencode_service,
            run_status_transition_service,
        }
    }

    pub async fn resolve_after_run_merge(&self, run_id: &str) -> Result<(), AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let finished_at = Utc::now().to_rfc3339();
        let Some((completed_run, rejected_siblings)) = self
            .runs_repository
            .finalize_run_completion_and_reject_siblings(run_id, &finished_at)
            .await?
        else {
            return Ok(());
        };

        for sibling_run in &rejected_siblings {
            if let Err(error) = self
                .runs_opencode_service
                .stop_run_opencode(&sibling_run.run_id, Some(MERGE_REJECTION_SHUTDOWN_REASON))
                .await
            {
                warn!(
                    subsystem = "runs",
                    operation = "resolve_after_run_merge",
                    run_id = completed_run.run_id.as_str(),
                    sibling_run_id = sibling_run.run_id.as_str(),
                    error = %error,
                    "Failed to stop rejected sibling run after merge"
                );
            }
        }

        self.emit_run_status_changed(RunStatusChangedEventDto {
            run_id: completed_run.run_id.clone(),
            task_id: completed_run.task_id.clone(),
            project_id: completed_run.project_id.clone(),
            previous_status: completed_run.previous_status.clone(),
            new_status: "complete".to_string(),
            transition_source: "run_merged".to_string(),
            timestamp: finished_at.clone(),
        })?;

        for sibling_run in rejected_siblings {
            self.emit_run_status_changed(RunStatusChangedEventDto {
                run_id: sibling_run.run_id,
                task_id: sibling_run.task_id,
                project_id: sibling_run.project_id,
                previous_status: sibling_run.previous_status,
                new_status: "rejected".to_string(),
                transition_source: "task_completed_run_rejected".to_string(),
                timestamp: finished_at.clone(),
            })?;
        }

        Ok(())
    }

    pub async fn complete_task_and_cancel_runs(&self, task_id: &str) -> Result<Task, AppError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(AppError::validation("task_id is required"));
        }

        let updated_at = Utc::now().to_rfc3339();
        let (updated_task, _) = self
            .tasks_repository
            .update_task_status(
                task_id,
                UpdateTaskStatus {
                    status: "done".to_string(),
                    updated_at: updated_at.clone(),
                },
            )
            .await
            .map_err(|source| {
                AppError::infrastructure_with_source(
                    "tasks",
                    "update_task_status_failed",
                    "failed to update task status",
                    source,
                )
            })?;
        let updated_task = updated_task.ok_or_else(|| AppError::not_found("task not found"))?;

        let cancelled_runs = self
            .runs_repository
            .cancel_task_active_runs(task_id, &updated_at)
            .await?;

        for run in &cancelled_runs {
            if let Err(error) = self
                .runs_opencode_service
                .stop_run_opencode(&run.run_id, Some(MANUAL_DONE_CANCELLATION_SHUTDOWN_REASON))
                .await
            {
                warn!(
                    subsystem = "runs",
                    operation = "complete_task_and_cancel_runs",
                    task_id = task_id,
                    run_id = run.run_id.as_str(),
                    error = %error,
                    "Failed to stop cancelled run after task completion"
                );
            }
        }

        for run in cancelled_runs {
            self.emit_run_status_changed(RunStatusChangedEventDto {
                run_id: run.run_id,
                task_id: run.task_id,
                project_id: run.project_id,
                previous_status: run.previous_status,
                new_status: "cancelled".to_string(),
                transition_source: "task_completed_run_cancelled".to_string(),
                timestamp: updated_at.clone(),
            })?;
        }

        Ok(updated_task)
    }

    fn emit_run_status_changed(&self, payload: RunStatusChangedEventDto) -> Result<(), AppError> {
        self.run_status_transition_service
            .emit_run_status_changed(&payload)
    }
}
