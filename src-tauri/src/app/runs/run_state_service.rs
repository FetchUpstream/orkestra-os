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
        if Self::is_terminal_status(run.status.as_str()) {
            return Ok(None);
        }

        let stored = run
            .run_state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty());

        if matches!(
            stored,
            Some(PERMISSION_REQUESTED | COMMITTING_CHANGES | RESOLVING_REBASE_CONFLICTS)
        ) {
            return Ok(stored.map(ToString::to_string));
        }

        if run.status == "idle" && self.is_ready_to_merge(run).await? {
            return Ok(Some(READY_TO_MERGE.to_string()));
        }

        if let Some(state) = stored {
            return Ok(Some(state.to_string()));
        }

        Ok(Self::fallback_state_for_status(run.status.as_str()).map(ToString::to_string))
    }

    pub async fn handle_run_started(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(BUSY_CODING), "run_started")
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

        if matches!(current, Some(COMMITTING_CHANGES | RESOLVING_REBASE_CONFLICTS)) {
            return Ok(None);
        }

        self.transition_to_state(run_id, Some(BUSY_CODING), "user_reply")
            .await
    }

    pub async fn handle_waiting_for_input(
        &self,
        run_id: &str,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(WAITING_FOR_INPUT), transition_source)
            .await
    }

    pub async fn handle_permission_requested(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(PERMISSION_REQUESTED), "permission_requested")
            .await
    }

    pub async fn handle_permission_resolved(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let Some(run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };

        let next = if run.status == "idle" {
            WAITING_FOR_INPUT
        } else {
            BUSY_CODING
        };

        self.transition_to_state(run_id, Some(next), "permission_resolved")
            .await
    }

    pub async fn handle_commit_requested(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, Some(COMMITTING_CHANGES), "commit_requested")
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
        )
        .await
    }

    pub async fn handle_run_merged(
        &self,
        run_id: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        self.transition_to_state(run_id, None, "run_merged").await
    }

    async fn transition_to_state(
        &self,
        run_id: &str,
        next_state: Option<&str>,
        transition_source: &str,
    ) -> Result<Option<RunStateChangedEventDto>, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Ok(None);
        }

        let Some(previous_run) = self.runs_repository.get_run(run_id).await? else {
            return Ok(None);
        };
        let previous_run_state = self.resolve_effective_run_state(&previous_run).await?;

        let persisted_next_state = match next_state {
            Some(WAITING_FOR_INPUT) if previous_run.status == "idle" => {
                if self.is_ready_to_merge(&previous_run).await? {
                    Some(READY_TO_MERGE)
                } else {
                    Some(WAITING_FOR_INPUT)
                }
            }
            other => other,
        };

        let changed = self
            .runs_repository
            .update_run_state(run_id, persisted_next_state)
            .await?;
        if !changed {
            return Ok(None);
        }

        let Some(updated_run) = self.runs_repository.get_run(run_id).await? else {
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

        app_handle.emit(RUN_STATE_CHANGED_EVENT, payload).map_err(|source| {
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
        let (analysis, _) = match source_repo.merge_analysis_for_ref(&mut source_ref, &[&worktree_annotated]) {
            Ok(analysis) => analysis,
            Err(_) => return Ok(false),
        };

        Ok(analysis.is_fast_forward() || analysis.is_up_to_date())
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
        matches!(status, "complete" | "failed" | "cancelled")
    }
}
