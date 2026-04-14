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
use crate::app::runs::opencode_service::RunsOpenCodeService;
use crate::app::runs::service::RunsService;
use crate::app::tasks::status_transition_service::TaskStatusTransitionService;

const DELETE_SHUTDOWN_REASON: &str = "run_deleted";

#[derive(Clone, Debug)]
pub struct RunsDeleteService {
    runs_service: RunsService,
    runs_opencode_service: RunsOpenCodeService,
    task_status_transition_service: TaskStatusTransitionService,
}

impl RunsDeleteService {
    pub fn new(
        runs_service: RunsService,
        runs_opencode_service: RunsOpenCodeService,
        task_status_transition_service: TaskStatusTransitionService,
    ) -> Self {
        Self {
            runs_service,
            runs_opencode_service,
            task_status_transition_service,
        }
    }

    pub async fn delete_run(&self, run_id: &str) -> Result<(), AppError> {
        self.runs_service.prepare_run_for_deletion(run_id).await?;
        self.runs_opencode_service
            .stop_run_opencode(run_id, Some(DELETE_SHUTDOWN_REASON))
            .await?;
        let status_changed = self
            .runs_service
            .hard_delete_run_and_reconcile_task_status(run_id)
            .await?;

        if let Some(payload) = status_changed {
            self.task_status_transition_service
                .emit_task_status_changed(&payload)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use crate::app::db::repositories::projects::ProjectsRepository;
    use crate::app::db::repositories::runs::RunsRepository;
    use crate::app::db::repositories::tasks::TasksRepository;
    use crate::app::projects::search_service::ProjectFileSearchService;
    use crate::app::projects::service::ProjectsService;
    use crate::app::runs::run_state_service::RunStateService;
    use crate::app::runs::status_transition_service::RunStatusTransitionService;
    use crate::app::tasks::status_transition_service::TaskStatusTransitionService;
    use crate::app::worktrees::service::WorktreesService;
    use sqlx::SqlitePool;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("orkestraos-runs-delete-service-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    async fn setup_services() -> (
        RunsDeleteService,
        RunsService,
        RunsOpenCodeService,
        SqlitePool,
        TempDir,
    ) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        let repository = RunsRepository::new(pool.clone());
        let temp_dir = TempDir::new();
        let app_data_dir = temp_dir.path().join("app-data");
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let runs_service = RunsService::new(repository, worktrees_service);
        let projects_service = ProjectsService::new(
            ProjectsRepository::new(pool.clone()),
            ProjectFileSearchService::new(),
            WorktreesService::new(app_data_dir.clone()),
        );
        let task_status_transition_service = TaskStatusTransitionService::new(
            RunsRepository::new(pool.clone()),
            TasksRepository::new(pool.clone()),
            None,
        );
        let run_state_service = RunStateService::new(
            RunsRepository::new(pool.clone()),
            runs_service.clone(),
            None,
            app_data_dir.clone(),
        );
        let run_status_transition_service = RunStatusTransitionService::new(
            RunsRepository::new(pool.clone()),
            run_state_service.clone(),
            None,
        );
        let runs_opencode_service = RunsOpenCodeService::new(
            runs_service.clone(),
            projects_service,
            task_status_transition_service.clone(),
            run_state_service,
            run_status_transition_service,
            app_data_dir,
        );
        let runs_delete_service = RunsDeleteService::new(
            runs_service.clone(),
            runs_opencode_service.clone(),
            task_status_transition_service,
        );

        (
            runs_delete_service,
            runs_service,
            runs_opencode_service,
            pool,
            temp_dir,
        )
    }

    async fn seed_task(pool: &SqlitePool, task_id: &str, repo_path: &Path) {
        let project_id = "project-1";
        let repository_id = "repo-1";

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind("Alpha")
        .bind("ALP")
        .bind(Option::<String>::None)
        .bind(repository_id)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(repository_id)
        .bind(project_id)
        .bind("Main")
        .bind(repo_path.to_string_lossy().to_string())
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(task_id)
        .bind(project_id)
        .bind(repository_id)
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

    async fn seed_run(pool: &SqlitePool, run_id: &str, task_id: &str, status: &str) {
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(task_id)
        .bind("project-1")
        .bind("repo-1")
        .bind(status)
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn delete_run_stops_active_opencode_runtime_before_hard_delete() {
        let (delete_service, runs_service, opencode_service, pool, temp_dir) =
            setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "in_progress").await;
        opencode_service
            .insert_test_running_handle("run-1", "task-1", &repo_path)
            .await;

        delete_service.delete_run("run-1").await.unwrap();

        assert!(matches!(
            runs_service.get_run_model("run-1").await,
            Err(AppError::NotFound(_))
        ));
        assert!(!opencode_service.has_run_handle("run-1").await);
    }

    #[tokio::test]
    async fn delete_run_succeeds_when_no_active_opencode_runtime_exists() {
        let (delete_service, runs_service, _opencode_service, pool, temp_dir) =
            setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "complete").await;

        delete_service.delete_run("run-1").await.unwrap();

        assert!(matches!(
            runs_service.get_run_model("run-1").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn delete_run_surfaces_shutdown_failures_and_skips_hard_delete() {
        let (delete_service, runs_service, opencode_service, pool, temp_dir) =
            setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "in_progress").await;
        opencode_service
            .insert_test_running_handle("run-1", "task-1", &repo_path)
            .await;
        opencode_service.poison_subscriber_tasks_lock("run-1").await;

        let result = delete_service.delete_run("run-1").await;

        assert!(result.is_err());
        let run = runs_service.get_run_model("run-1").await.unwrap();
        assert_eq!(run.status, "cancelled");
    }

    #[tokio::test]
    async fn delete_run_moves_task_from_doing_to_review_when_no_other_active_runs() {
        let (delete_service, runs_service, _opencode_service, pool, temp_dir) =
            setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "in_progress").await;
        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = ?")
            .bind("task-1")
            .execute(&pool)
            .await
            .unwrap();

        delete_service.delete_run("run-1").await.unwrap();

        assert!(matches!(
            runs_service.get_run_model("run-1").await,
            Err(AppError::NotFound(_))
        ));
        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "review");
    }

    #[tokio::test]
    async fn delete_run_keeps_task_doing_when_another_active_run_exists() {
        let (delete_service, runs_service, _opencode_service, pool, temp_dir) =
            setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-delete", "task-1", "in_progress").await;
        seed_run(&pool, "run-active", "task-1", "idle").await;
        sqlx::query("UPDATE tasks SET status = 'doing' WHERE id = ?")
            .bind("task-1")
            .execute(&pool)
            .await
            .unwrap();

        delete_service.delete_run("run-delete").await.unwrap();

        assert!(matches!(
            runs_service.get_run_model("run-delete").await,
            Err(AppError::NotFound(_))
        ));
        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "doing");
    }
}
