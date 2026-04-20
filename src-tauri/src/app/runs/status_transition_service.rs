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
use crate::app::errors::AppError;
use crate::app::runs::dto::RunStatusChangedEventDto;
use crate::app::runs::run_state_service::RunStateService;
use chrono::Utc;
use tauri::Emitter;
use tracing::{info, warn};

const RUN_STATUS_CHANGED_EVENT: &str = "run-status-changed";

#[derive(Clone, Debug)]
pub struct RunStatusTransitionService {
    runs_repository: RunsRepository,
    run_state_service: RunStateService,
    app_handle: Option<tauri::AppHandle>,
}

impl RunStatusTransitionService {
    pub fn new(
        runs_repository: RunsRepository,
        run_state_service: RunStateService,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        Self {
            runs_repository,
            run_state_service,
            app_handle,
        }
    }

    pub async fn handle_run_started(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStatusChangedEventDto>, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        if run.status == "in_progress" {
            return Ok(None);
        }

        if Self::is_terminal_status(run.status.as_str())
            || !matches!(run.status.as_str(), "queued" | "preparing" | "idle")
        {
            return Ok(None);
        }

        let timestamp = Utc::now().to_rfc3339();
        let changed = self
            .runs_repository
            .transition_run_to_in_progress_and_mark_task_doing(run_id, &timestamp)
            .await?;

        if !changed {
            return Ok(None);
        }

        let Some(updated_run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        let payload = RunStatusChangedEventDto {
            run_id: updated_run.id.clone(),
            task_id: updated_run.task_id.clone(),
            project_id: updated_run.project_id.clone(),
            previous_status: run.status,
            new_status: updated_run.status.clone(),
            transition_source: "run_started".to_string(),
            timestamp,
        };

        self.emit_run_status_changed(&payload)?;
        let _ = self.run_state_service.handle_run_started(run_id).await?;
        Ok(Some(payload))
    }

    pub async fn handle_agent_waiting(
        &self,
        task_id: &str,
        run_id: &str,
        opencode_session_id: &str,
        source_event: &str,
    ) -> Result<Option<RunStatusChangedEventDto>, AppError> {
        self.transition_run_status_for_active_task(
            task_id,
            run_id,
            Some(opencode_session_id),
            &["in_progress"],
            "idle",
            "agent_idle",
            Some(source_event),
        )
        .await
    }

    pub async fn handle_user_replied(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<Option<RunStatusChangedEventDto>, AppError> {
        self.transition_run_status_for_active_task(
            task_id,
            run_id,
            None,
            &["idle"],
            "in_progress",
            "user_reply",
            None,
        )
        .await
    }

    pub fn emit_run_status_changed(
        &self,
        payload: &RunStatusChangedEventDto,
    ) -> Result<(), AppError> {
        let Some(app_handle) = self.app_handle.as_ref() else {
            return Ok(());
        };

        app_handle
            .emit(RUN_STATUS_CHANGED_EVENT, payload)
            .map_err(|source| {
                AppError::infrastructure_with_source(
                    "runs",
                    "emit_run_status_changed_failed",
                    "failed to emit run status changed event",
                    source,
                )
            })
    }

    async fn transition_run_status_for_active_task(
        &self,
        task_id: &str,
        run_id: &str,
        expected_session_id: Option<&str>,
        expected_from_statuses: &[&str],
        next_status: &str,
        transition_source: &str,
        source_event: Option<&str>,
    ) -> Result<Option<RunStatusChangedEventDto>, AppError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Ok(None);
        }

        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            warn!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                task_id,
                run_id,
                "Ignoring missing run"
            );
            return Ok(None);
        };

        if run.task_id != task_id {
            warn!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                task_id,
                run_id,
                actual_task_id = run.task_id,
                "Ignoring mismatched task/run pair"
            );
            return Ok(None);
        }

        if let Some(expected_session_id) = expected_session_id {
            let expected_session_id = expected_session_id.trim();
            if expected_session_id.is_empty()
                || run.opencode_session_id.as_deref() != Some(expected_session_id)
            {
                info!(
                    subsystem = "runs",
                    operation = "transition_run_status",
                    transition_source,
                    task_id,
                    run_id,
                    expected_session_id,
                    run_session_id = run.opencode_session_id.as_deref().unwrap_or(""),
                    source_event = source_event.unwrap_or(""),
                    "Ignoring stale session transition"
                );
                return Ok(None);
            }
        }

        self.transition_run_status(
            run_id,
            Some(task_id),
            expected_from_statuses,
            next_status,
            transition_source,
            source_event,
        )
        .await
    }

    async fn transition_run_status(
        &self,
        run_id: &str,
        expected_task_id: Option<&str>,
        expected_from_statuses: &[&str],
        next_status: &str,
        transition_source: &str,
        source_event: Option<&str>,
    ) -> Result<Option<RunStatusChangedEventDto>, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            warn!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                run_id,
                "Ignoring missing run"
            );
            return Ok(None);
        };

        if let Some(expected_task_id) = expected_task_id {
            if run.task_id != expected_task_id {
                warn!(
                    subsystem = "runs",
                    operation = "transition_run_status",
                    transition_source,
                    run_id,
                    expected_task_id,
                    actual_task_id = run.task_id,
                    "Ignoring mismatched task/run pair"
                );
                return Ok(None);
            }
        }

        if run.status == next_status {
            info!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                run_id,
                status = run.status.as_str(),
                "Ignoring idempotent transition"
            );
            return Ok(None);
        }

        if Self::is_terminal_status(run.status.as_str()) {
            info!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                run_id,
                current_status = run.status.as_str(),
                source_event = source_event.unwrap_or(""),
                "Ignoring transition from terminal run state"
            );
            return Ok(None);
        }

        if !expected_from_statuses.contains(&run.status.as_str()) {
            info!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                run_id,
                current_status = run.status.as_str(),
                source_event = source_event.unwrap_or(""),
                "Ignoring invalid transition"
            );
            return Ok(None);
        }

        let timestamp = Utc::now().to_rfc3339();
        let changed = match next_status {
            "in_progress" => {
                self.runs_repository
                    .transition_run_to_in_progress_and_mark_task_doing(run_id, &timestamp)
                    .await?
            }
            "idle" => self.runs_repository.transition_run_to_idle(run_id).await?,
            "complete" => {
                self.runs_repository
                    .finalize_run_completion_and_task_done(run_id, &timestamp)
                    .await?
            }
            _ => return Ok(None),
        };

        if !changed {
            info!(
                subsystem = "runs",
                operation = "transition_run_status",
                transition_source,
                run_id,
                "Ignoring duplicate transition write"
            );
            return Ok(None);
        }

        let Some(updated_run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        let payload = RunStatusChangedEventDto {
            run_id: updated_run.id.clone(),
            task_id: updated_run.task_id.clone(),
            project_id: updated_run.project_id.clone(),
            previous_status: run.status,
            new_status: updated_run.status.clone(),
            transition_source: transition_source.to_string(),
            timestamp,
        };

        self.emit_run_status_changed(&payload)?;

        match next_status {
            "in_progress" => {
                let _ = self.run_state_service.handle_user_replied(run_id).await?;
            }
            "idle" => {
                let _ = self
                    .run_state_service
                    .handle_waiting_for_input(run_id, transition_source)
                    .await?;
            }
            "complete" => {
                let _ = self.run_state_service.handle_run_merged(run_id).await?;
            }
            _ => {}
        }

        info!(
            subsystem = "runs",
            operation = "transition_run_status",
            transition_source,
            run_id = updated_run.id,
            task_id = updated_run.task_id,
            project_id = updated_run.project_id,
            previous_status = payload.previous_status.as_str(),
            new_status = payload.new_status.as_str(),
            source_event = source_event.unwrap_or(""),
            "Applied run status transition"
        );

        Ok(Some(payload))
    }

    fn is_terminal_status(status: &str) -> bool {
        matches!(status, "complete" | "failed" | "cancelled" | "rejected")
    }
}
