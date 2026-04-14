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
use crate::app::runs::dto::RunStateChangedEventDto;
use crate::app::runs::models::Run;
use crate::app::runs::service::RunsService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use chrono::Utc;
use git2::{BranchType, Repository};
use std::path::PathBuf;
use tauri::Emitter;

const RUN_STATE_CHANGED_EVENT: &str = "run-state-changed";

const WARMING_UP: &str = "warming_up";
const BUSY_CODING: &str = "busy_coding";
const WAITING_FOR_INPUT: &str = "waiting_for_input";
const QUESTION_PENDING: &str = "question_pending";
const PERMISSION_REQUESTED: &str = "permission_requested";
const COMMITTING_CHANGES: &str = "committing_changes";
const RESOLVING_REBASE_CONFLICTS: &str = "resolving_rebase_conflicts";
const READY_TO_MERGE: &str = "ready_to_merge";

#[derive(Clone, Debug)]
pub struct RunStateService {
    runs_repository: RunsRepository,
    runs_service: RunsService,
    app_handle: Option<tauri::AppHandle>,
    worktrees_root: PathBuf,
}

impl RunStateService {
    pub fn new(
        runs_repository: RunsRepository,
        runs_service: RunsService,
        app_handle: Option<tauri::AppHandle>,
        app_data_dir: PathBuf,
    ) -> Self {
        Self {
            runs_repository,
            runs_service,
            app_handle,
            worktrees_root: app_data_dir.join("worktrees"),
        }
    }

    pub async fn resolve_effective_run_state(&self, run: &Run) -> Result<Option<String>, AppError> {
        self.resolve_run_state(run, true).await
    }

    pub async fn handle_run_started(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(BUSY_CODING), "run_started", true)
            .await
    }

    pub async fn handle_agent_active(
        &self,
        run_id: &str,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };
        if Self::is_terminal_status(run.status.as_str()) {
            return Ok(None);
        }

        let current = run
            .run_state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty());

        if current.is_some_and(Self::is_special_stored_state) {
            return Ok(None);
        }

        self.transition_to_state(run_id, Some(BUSY_CODING), transition_source, true)
            .await
    }

    pub async fn handle_user_replied(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        let current = run
            .run_state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty());

        if matches!(
            current,
            Some(COMMITTING_CHANGES | RESOLVING_REBASE_CONFLICTS)
        ) {
            return Ok(None);
        }

        self.recompute_run_state(run_id, "user_reply").await
    }

    pub async fn handle_waiting_for_input(
        &self,
        run_id: &str,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(
            run_id,
            Some(WAITING_FOR_INPUT),
            transition_source,
            !Self::is_non_authoritative_source(transition_source),
        )
        .await
    }

    pub async fn handle_question_pending(
        &self,
        run_id: &str,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(QUESTION_PENDING), transition_source, false)
            .await
    }

    pub async fn handle_permission_requested(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(
            run_id,
            Some(PERMISSION_REQUESTED),
            "permission_requested",
            true,
        )
        .await
    }

    pub async fn handle_commit_requested(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(COMMITTING_CHANGES), "commit_requested", true)
            .await
    }

    pub async fn handle_rebase_conflicts_started(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(
            run_id,
            Some(RESOLVING_REBASE_CONFLICTS),
            "rebase_conflicts_started",
            true,
        )
        .await
    }

    pub async fn handle_run_merged(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, None, "run_merged", true)
            .await
    }

    pub async fn recompute_run_state(
        &self,
        run_id: &str,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(latest_run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        let next_state = self.resolve_run_state(&latest_run, false).await?;
        self.transition_to_state_from_snapshot(
            latest_run,
            next_state.as_deref(),
            transition_source,
            false,
        )
        .await
    }

    async fn transition_to_state(
        &self,
        run_id: &str,
        next_state: Option<&str>,
        transition_source: &str,
        authoritative: bool,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(latest_run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        self.transition_to_state_from_snapshot(
            latest_run,
            next_state,
            transition_source,
            authoritative,
        )
        .await
    }

    async fn transition_to_state_from_snapshot(
        &self,
        latest_run: Run,
        next_state: Option<&str>,
        transition_source: &str,
        authoritative: bool,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        if Self::is_terminal_status(latest_run.status.as_str()) {
            return Ok(None);
        }

        let current_stored_state = latest_run
            .run_state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty());

        if current_stored_state.is_some_and(Self::is_special_stored_state)
            && (!authoritative || matches!(next_state, Some(BUSY_CODING)))
        {
            return Ok(None);
        }

        let previous_run_state = self.resolve_effective_run_state(&latest_run).await?;

        let persisted_next_state = match next_state {
            Some(WAITING_FOR_INPUT) if latest_run.status == "idle" => {
                if self.is_ready_to_merge(&latest_run).await? {
                    Some(READY_TO_MERGE)
                } else {
                    Some(WAITING_FOR_INPUT)
                }
            }
            other => other,
        };

        let changed = self
            .runs_repository
            .update_run_state(
                latest_run.id.as_str(),
                latest_run.run_state.as_deref(),
                persisted_next_state,
            )
            .await?;
        if !changed {
            return Ok(None);
        }

        let Some(updated_run) = self.runs_repository.get_run(latest_run.id.as_str()).await? else {
            return Ok(None);
        };
        let new_run_state = self.resolve_effective_run_state(&updated_run).await?;

        if previous_run_state == new_run_state {
            return Ok(None);
        }

        let payload = RunStateChangedEventDto {
            run_id: updated_run.id.clone(),
            task_id: updated_run.task_id.clone(),
            project_id: updated_run.project_id.clone(),
            previous_run_state,
            new_run_state,
            transition_source: transition_source.to_string(),
            timestamp: Utc::now().to_rfc3339(),
        };

        self.emit_run_state_changed(&payload)?;
        Ok(Some(payload))
    }

    fn emit_run_state_changed(&self, payload: &RunStateChangedEventDto) -> Result<(), AppError> {
        let Some(app_handle) = self.app_handle.as_ref() else {
            return Ok(());
        };

        app_handle
            .emit(RUN_STATE_CHANGED_EVENT, payload)
            .map_err(|source| {
                AppError::infrastructure_with_source(
                    "runs",
                    "emit_run_state_changed_failed",
                    "failed to emit run state changed event",
                    source,
                )
            })
    }

    async fn is_ready_to_merge(&self, run: &Run) -> Result<bool, AppError> {
        let source_branch = match run.source_branch.as_deref().map(str::trim) {
            Some(branch) if !branch.is_empty() => branch.to_string(),
            _ => return Ok(false),
        };
        let worktree_branch = match run.worktree_id.as_deref().map(str::trim) {
            Some(branch) if !branch.is_empty() => branch.to_string(),
            _ => return Ok(false),
        };

        let worktree_path = resolve_worktree_path(&self.worktrees_root, &worktree_branch)?;
        let repo = match Repository::open(worktree_path) {
            Ok(repo) => repo,
            Err(_) => return Ok(false),
        };
        let source_repo_path = match self.runs_service.get_run_repository_path(&run.id).await {
            Ok(path) => path,
            Err(_) => return Ok(false),
        };
        let source_repo = match Repository::open(&source_repo_path) {
            Ok(repo) => repo,
            Err(_) => return Ok(false),
        };

        if repo.state() != git2::RepositoryState::Clean {
            return Ok(false);
        }

        let index = match repo.index() {
            Ok(index) => index,
            Err(_) => return Ok(false),
        };
        if index.has_conflicts() {
            return Ok(false);
        }

        let source_ref = match source_repo.find_branch(&source_branch, BranchType::Local) {
            Ok(branch) => branch,
            Err(_) => return Ok(false),
        };
        let source_oid = match source_ref.get().target() {
            Some(oid) => oid,
            None => return Ok(false),
        };

        let worktree_ref = match repo.find_branch(&worktree_branch, BranchType::Local) {
            Ok(branch) => branch,
            Err(_) => return Ok(false),
        };
        let worktree_oid = match worktree_ref.get().target() {
            Some(oid) => oid,
            None => return Ok(false),
        };

        let (ahead_count, behind_count) = match repo.graph_ahead_behind(worktree_oid, source_oid) {
            Ok(counts) => counts,
            Err(_) => return Ok(false),
        };

        if ahead_count == 0 || behind_count > 0 {
            return Ok(false);
        }

        let source_ref_name = format!("refs/heads/{source_branch}");
        let mut source_ref = match source_repo.find_reference(&source_ref_name) {
            Ok(reference) => reference,
            Err(_) => return Ok(false),
        };
        let worktree_annotated = match source_repo.find_annotated_commit(worktree_oid) {
            Ok(commit) => commit,
            Err(_) => return Ok(false),
        };
        let (analysis, _) =
            match source_repo.merge_analysis_for_ref(&mut source_ref, &[&worktree_annotated]) {
                Ok(analysis) => analysis,
                Err(_) => return Ok(false),
            };

        Ok(analysis.is_fast_forward() || analysis.is_up_to_date())
    }

    async fn resolve_run_state(
        &self,
        run: &Run,
        preserve_special_stored_states: bool,
    ) -> Result<Option<String>, AppError> {
        if Self::is_terminal_status(run.status.as_str()) {
            return Ok(None);
        }

        let stored = run
            .run_state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty());

        if preserve_special_stored_states && stored.is_some_and(Self::is_special_stored_state) {
            return Ok(stored.map(ToString::to_string));
        }

        if run.status == "idle" && self.is_ready_to_merge(run).await? {
            return Ok(Some(READY_TO_MERGE.to_string()));
        }

        if let Some(state) = stored
            .filter(|state| preserve_special_stored_states || !Self::is_special_stored_state(state))
        {
            return Ok(Some(state.to_string()));
        }

        Ok(Self::fallback_state_for_status(run.status.as_str()).map(ToString::to_string))
    }

    fn fallback_state_for_status(status: &str) -> Option<&'static str> {
        match status {
            "queued" | "preparing" => Some(WARMING_UP),
            "in_progress" => Some(BUSY_CODING),
            "idle" => Some(WAITING_FOR_INPUT),
            _ => None,
        }
    }

    fn is_terminal_status(status: &str) -> bool {
        matches!(status, "complete" | "failed" | "cancelled" | "rejected")
    }

    fn is_special_stored_state(state: &str) -> bool {
        matches!(
            state,
            QUESTION_PENDING
                | PERMISSION_REQUESTED
                | COMMITTING_CHANGES
                | RESOLVING_REBASE_CONFLICTS
        )
    }

    fn is_non_authoritative_source(transition_source: &str) -> bool {
        let source = transition_source.trim().to_ascii_lowercase();
        source.contains("refresh") || source.contains("recompute")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use crate::app::worktrees::service::WorktreesService;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("orkestraos-run-state-service-{}", Uuid::new_v4()));
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

    async fn setup_service() -> (RunStateService, SqlitePool, TempDir) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let temp_dir = TempDir::new();
        let app_data_dir = temp_dir.path().join("app-data");
        let runs_repository = RunsRepository::new(pool.clone());
        let runs_service = RunsService::new(
            RunsRepository::new(pool.clone()),
            WorktreesService::new(app_data_dir.clone()),
        );
        let service = RunStateService::new(runs_repository, runs_service, None, app_data_dir);

        (service, pool, temp_dir)
    }

    async fn seed_task(pool: &SqlitePool, task_id: &str, repo_path: &Path) {
        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("project-1")
        .bind("Alpha")
        .bind("ALP")
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

    async fn seed_run(
        pool: &SqlitePool,
        run_id: &str,
        task_id: &str,
        status: &str,
        run_state: &str,
    ) {
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, run_state, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(task_id)
        .bind("project-1")
        .bind("repo-1")
        .bind(status)
        .bind(run_state)
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn transition_to_state_skips_terminal_runs() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "complete", "busy_coding").await;

        let event = service
            .handle_waiting_for_input("run-1", "test_transition")
            .await
            .unwrap();

        assert!(event.is_none());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("busy_coding"));
    }

    #[tokio::test]
    async fn transition_to_state_updates_non_terminal_runs() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "in_progress", "busy_coding").await;

        let event = service
            .handle_waiting_for_input("run-1", "test_transition")
            .await
            .unwrap();

        assert!(event.is_some());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("waiting_for_input"));
    }

    #[tokio::test]
    async fn transition_to_busy_coding_does_not_overwrite_special_stored_state() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "in_progress", "question_pending").await;

        let event = service.handle_run_started("run-1").await.unwrap();

        assert!(event.is_none());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("question_pending"));
    }

    #[tokio::test]
    async fn recompute_preserves_special_stored_state_for_non_authoritative_transition() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(
            &pool,
            "run-1",
            "task-1",
            "in_progress",
            "permission_requested",
        )
        .await;

        let event = service
            .recompute_run_state("run-1", "poll_refresh")
            .await
            .unwrap();

        assert!(event.is_none());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("permission_requested"));
    }

    #[tokio::test]
    async fn question_pending_non_authoritative_transition_preserves_special_stored_state() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "idle", "committing_changes").await;

        let event = service
            .handle_question_pending("run-1", "question_refresh")
            .await
            .unwrap();

        assert!(event.is_none());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("committing_changes"));
    }

    #[tokio::test]
    async fn permission_requested_authoritative_transition_overwrites_prior_special_state() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "idle", "question_pending").await;

        let event = service.handle_permission_requested("run-1").await.unwrap();

        assert!(event.is_some());
        let run_state: Option<String> =
            sqlx::query_scalar("SELECT run_state FROM runs WHERE id = ?")
                .bind("run-1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_state.as_deref(), Some("permission_requested"));
    }
}
