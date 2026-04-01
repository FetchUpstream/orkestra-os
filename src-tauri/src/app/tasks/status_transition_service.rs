use crate::app::db::repositories::runs::RunsRepository;
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::tasks::dto::TaskStatusChangedEventDto;
use crate::app::tasks::errors::TaskServiceError;
use crate::app::tasks::models::{Task, UpdateTaskStatus};
use chrono::Utc;
use tauri::Emitter;
use tracing::{info, warn};

const TASK_STATUS_CHANGED_EVENT: &str = "task-status-changed";

#[derive(Clone, Debug)]
pub struct TaskStatusTransitionService {
    runs_repository: RunsRepository,
    tasks_repository: TasksRepository,
    app_handle: Option<tauri::AppHandle>,
}

impl TaskStatusTransitionService {
    pub fn new(
        runs_repository: RunsRepository,
        tasks_repository: TasksRepository,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        Self {
            runs_repository,
            tasks_repository,
            app_handle,
        }
    }

    pub async fn handle_agent_turn_completed(
        &self,
        task_id: &str,
        run_id: &str,
        opencode_session_id: &str,
        source_event: &str,
    ) -> Result<Option<TaskStatusChangedEventDto>, AppError> {
        self.transition_task_status(
            task_id,
            run_id,
            Some(opencode_session_id),
            "doing",
            "review",
            "agent_idle",
            Some(source_event),
        )
        .await
    }

    pub async fn handle_user_replied_to_agent(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<Option<TaskStatusChangedEventDto>, AppError> {
        self.transition_task_status(
            task_id,
            run_id,
            None,
            "review",
            "doing",
            "user_reply",
            None,
        )
        .await
    }

    pub fn emit_task_status_changed(
        &self,
        payload: &TaskStatusChangedEventDto,
    ) -> Result<(), AppError> {
        let Some(app_handle) = self.app_handle.as_ref() else {
            return Ok(());
        };

        app_handle
            .emit(TASK_STATUS_CHANGED_EVENT, payload)
            .map_err(|source| {
                AppError::infrastructure_with_source(
                    "tasks",
                    "emit_task_status_changed_failed",
                    "failed to emit task status changed event",
                    source,
                )
            })
    }

    async fn transition_task_status(
        &self,
        task_id: &str,
        run_id: &str,
        expected_session_id: Option<&str>,
        expected_from_status: &str,
        next_status: &str,
        transition_source: &str,
        source_event: Option<&str>,
    ) -> Result<Option<TaskStatusChangedEventDto>, AppError> {
        let task_id = task_id.trim();
        let run_id = run_id.trim();
        if task_id.is_empty() || run_id.is_empty() {
            return Ok(None);
        }

        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            warn!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, "Ignoring missing run");
            return Ok(None);
        };

        if run.task_id != task_id {
            warn!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, actual_task_id = run.task_id, "Ignoring mismatched task/run pair");
            return Ok(None);
        }

        if let Some(expected_session_id) = expected_session_id {
            let expected_session_id = expected_session_id.trim();
            if expected_session_id.is_empty()
                || run.opencode_session_id.as_deref() != Some(expected_session_id)
            {
                info!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, expected_session_id, run_session_id = run.opencode_session_id.as_deref().unwrap_or(""), source_event = source_event.unwrap_or(""), "Ignoring stale session transition");
                return Ok(None);
            }
        }

        let Some(task) = self
            .tasks_repository
            .get_task(task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        else {
            warn!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, "Ignoring missing task");
            return Ok(None);
        };

        if task.status == next_status {
            info!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, status = task.status.as_str(), "Ignoring idempotent transition");
            return Ok(None);
        }

        if task.status != expected_from_status || Self::is_terminal_status(&task) {
            info!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, current_status = task.status.as_str(), expected_from_status, "Ignoring invalid transition");
            return Ok(None);
        }

        let timestamp = Utc::now().to_rfc3339();
        let previous_status = task.status.clone();
        let (updated_task, changed) = if next_status == "review" {
            let changed = self
                .runs_repository
                .transition_task_doing_to_review_on_session_idle(
                    run_id,
                    expected_session_id.unwrap_or_default(),
                    &timestamp,
                )
                .await?;
            let updated_task = self
                .tasks_repository
                .get_task(task_id)
                .await
                .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;
            (updated_task, changed)
        } else {
            self.tasks_repository
                .update_task_status(
                    task_id,
                    UpdateTaskStatus {
                        status: next_status.to_string(),
                        updated_at: timestamp.clone(),
                    },
                )
                .await
                .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        };

        if !changed {
            info!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id, run_id, "Ignoring duplicate transition write");
            return Ok(None);
        }

        let Some(updated_task) = updated_task else {
            return Ok(None);
        };

        let payload = TaskStatusChangedEventDto {
            task_id: updated_task.id.clone(),
            project_id: updated_task.project_id.clone(),
            run_id: Some(run_id.to_string()),
            previous_status,
            new_status: updated_task.status.clone(),
            transition_source: transition_source.to_string(),
            timestamp,
        };

        self.emit_task_status_changed(&payload)?;

        info!(subsystem = "tasks", operation = "transition_task_status", transition_source, task_id = updated_task.id, project_id = updated_task.project_id, run_id, previous_status = payload.previous_status.as_str(), new_status = payload.new_status.as_str(), source_event = source_event.unwrap_or(""), "Applied task status transition");

        Ok(Some(payload))
    }

    fn is_terminal_status(task: &Task) -> bool {
        task.status == "done"
    }
}
