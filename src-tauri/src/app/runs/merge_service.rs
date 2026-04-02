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
use crate::app::runs::dto::{
    RunMergeConflictDto, RunMergeResponseDto, RunMergeStatusDto, RunRebaseResponseDto,
};
use crate::app::runs::run_state_service::RunStateService;
use crate::app::runs::service::RunsService;
use crate::app::runs::status_transition_service::RunStatusTransitionService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use git2::{
    build::CheckoutBuilder, AnnotatedCommit, BranchType, ErrorCode, Repository, RepositoryState,
    Signature, Status, StatusOptions,
};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

#[derive(Clone, Debug)]
pub struct RunsMergeService {
    runs_service: RunsService,
    run_state_service: RunStateService,
    run_status_transition_service: RunStatusTransitionService,
    worktrees_root: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MergeState {
    Clean,
    NeedsRebase,
    RebaseInProgress,
    Mergeable,
    Conflicted,
    Merged,
    Completing,
}

impl MergeState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Clean => "clean",
            Self::NeedsRebase => "needs_rebase",
            Self::RebaseInProgress => "rebase_in_progress",
            Self::Mergeable => "mergeable",
            Self::Conflicted => "conflicted",
            Self::Merged => "merged",
            Self::Completing => "completing",
        }
    }
}

struct MergeContext {
    run_id: String,
    task_id: String,
    run_status: String,
    source_branch: String,
    worktree_branch: String,
    repo: Repository,
    source_repo: Repository,
}

impl RunsMergeService {
    pub fn new(
        runs_service: RunsService,
        run_state_service: RunStateService,
        run_status_transition_service: RunStatusTransitionService,
        app_data_dir: PathBuf,
    ) -> Self {
        Self {
            runs_service,
            run_state_service,
            run_status_transition_service,
            worktrees_root: app_data_dir.join("worktrees"),
        }
    }

    pub async fn get_merge_status(&self, run_id: &str) -> Result<RunMergeStatusDto, AppError> {
        let context = self.load_context(run_id).await?;
        self.compute_status(&context)
    }

    pub async fn rebase_worktree_branch(
        &self,
        run_id: &str,
    ) -> Result<RunRebaseResponseDto, AppError> {
        let context = self.load_context(run_id).await?;
        if let Some(reason) = Self::dirty_worktree_disable_reason(&context.repo)? {
            return Err(AppError::validation(reason));
        }
        let status_before = self.compute_status(&context)?;

        if !status_before.can_rebase {
            return Ok(RunRebaseResponseDto {
                state: status_before.state.clone(),
                status: status_before,
                conflict: None,
            });
        }

        let rebase_conflict = {
            Self::ensure_head_on_worktree_branch(&context.repo, &context.worktree_branch)?;
            let source_annotated =
                self.source_annotated_commit(&context.repo, &context.source_branch)?;
            let mut rebase = context
                .repo
                .rebase(None, Some(&source_annotated), Some(&source_annotated), None)
                .map_err(|err| AppError::validation(format!("failed to start rebase: {err}")))?;

            let mut conflict_result = None;
            loop {
                let next = match rebase.next() {
                    Some(Ok(op)) => Some(op),
                    Some(Err(err)) => {
                        return Err(AppError::validation(format!("rebase failed: {err}")));
                    }
                    None => None,
                };
                if next.is_none() {
                    break;
                }

                let index = context.repo.index().map_err(|err| {
                    AppError::validation(format!("failed to inspect rebase index: {err}"))
                })?;
                if index.has_conflicts() {
                    Self::attach_head_to_worktree_branch(&context.repo, &context.worktree_branch)?;
                    let conflict =
                        Self::build_conflict_payload(&context.repo, &context.source_branch)?;
                    let status = self.compute_status(&context)?;
                    conflict_result = Some((conflict, status));
                    break;
                }

                let signature = Self::signature(&context.repo)?;
                rebase.commit(None, &signature, None).map_err(|err| {
                    AppError::validation(format!("failed to commit rebase step: {err}"))
                })?;
            }

            if conflict_result.is_none() {
                let signature = Self::signature(&context.repo)?;
                rebase.finish(Some(&signature)).map_err(|err| {
                    AppError::validation(format!("failed to finish rebase: {err}"))
                })?;
                Self::reattach_head_to_branch_if_needed(&context.repo, &context.worktree_branch)?;
            }

            conflict_result
        };

        if let Some((conflict, status)) = rebase_conflict {
            let _ = self
                .run_state_service
                .handle_rebase_conflicts_started(run_id)
                .await?;
            return Ok(RunRebaseResponseDto {
                state: MergeState::Conflicted.as_str().to_string(),
                status,
                conflict: Some(conflict),
            });
        }

        let status = self.compute_status(&context)?;
        if context.run_status == "idle" {
            let _ = self
                .run_state_service
                .handle_waiting_for_input(run_id, "rebase_completed")
                .await?;
        }
        Ok(RunRebaseResponseDto {
            state: status.state.clone(),
            status,
            conflict: None,
        })
    }

    pub async fn merge_into_source_branch(
        &self,
        run_id: &str,
    ) -> Result<RunMergeResponseDto, AppError> {
        let context = self.load_context(run_id).await?;
        if let Some(reason) = Self::dirty_worktree_disable_reason(&context.repo)? {
            return Err(AppError::validation(reason));
        }
        if let Some(reason) = Self::source_merge_block_reason(&context)? {
            return Err(AppError::validation(reason));
        }
        let status_before = self.compute_status(&context)?;
        let source_oid = Self::branch_commit_oid(&context.source_repo, &context.source_branch)?;
        let worktree_oid = Self::branch_commit_oid(&context.repo, &context.worktree_branch)?;
        let should_finalize_existing_merge = source_oid == worktree_oid
            && context.run_status != "complete"
            && context.run_status != "queued";

        if !status_before.can_merge && !should_finalize_existing_merge {
            return Ok(RunMergeResponseDto {
                state: status_before.state.clone(),
                status: status_before,
            });
        }

        let source_ref_name = Self::source_ref_name(&context.source_branch);

        if source_oid != worktree_oid {
            Self::ensure_head_on_worktree_branch(&context.source_repo, &context.source_branch)
                .map_err(|_| {
                    AppError::validation(format!(
                        "cannot merge: source repository HEAD must be on source branch '{}'",
                        context.source_branch
                    ))
                })?;
            let mut source_ref = context
                .source_repo
                .find_reference(&source_ref_name)
                .map_err(|err| {
                    AppError::validation(format!(
                        "failed to resolve source branch reference: {err}"
                    ))
                })?;
            let worktree_annotated = context
                .source_repo
                .find_annotated_commit(worktree_oid)
                .map_err(|err| {
                    AppError::validation(format!("failed to load worktree commit: {err}"))
                })?;
            let (analysis, _) = context
                .source_repo
                .merge_analysis_for_ref(&mut source_ref, &[&worktree_annotated])
                .map_err(|err| AppError::validation(format!("failed to analyze merge: {err}")))?;

            if !analysis.is_fast_forward() && !analysis.is_up_to_date() {
                return Ok(RunMergeResponseDto {
                    state: MergeState::NeedsRebase.as_str().to_string(),
                    status: self.compute_status(&context)?,
                });
            }

            if analysis.is_fast_forward() {
                Self::fast_forward_source_branch_worktree(
                    &context.source_repo,
                    &context.source_branch,
                    worktree_oid,
                )?;
            }
        }

        let _ = self
            .run_status_transition_service
            .handle_run_merged(&context.task_id, run_id)
            .await?;
        let mut status = self.compute_status(&context)?;
        status.state = MergeState::Merged.as_str().to_string();
        status.can_merge = false;
        status.can_rebase = false;
        status.disable_reason = Some("run has already been merged".to_string());

        Ok(RunMergeResponseDto {
            state: MergeState::Completing.as_str().to_string(),
            status,
        })
    }

    async fn load_context(&self, run_id: &str) -> Result<MergeContext, AppError> {
        let run = self.runs_service.get_run(run_id).await?;
        let source_branch = run
            .source_branch
            .as_deref()
            .map(str::trim)
            .filter(|branch| !branch.is_empty())
            .ok_or_else(|| AppError::validation("run source branch is required"))?
            .to_string();
        let worktree_branch = run
            .worktree_id
            .as_deref()
            .map(str::trim)
            .filter(|branch| !branch.is_empty())
            .ok_or_else(|| AppError::not_found("run worktree not found"))?
            .to_string();
        let worktree_path = resolve_worktree_path(&self.worktrees_root, &worktree_branch)?;
        let repo = Repository::open(worktree_path).map_err(|err| {
            AppError::validation(format!("failed to open worktree repository: {err}"))
        })?;
        let source_repo_path = self.runs_service.get_run_repository_path(run_id).await?;
        let source_repo = Repository::open(&source_repo_path).map_err(|err| {
            AppError::validation(format!("failed to open source repository: {err}"))
        })?;

        Ok(MergeContext {
            run_id: run.id,
            task_id: run.task_id,
            run_status: run.status,
            source_branch,
            worktree_branch,
            repo,
            source_repo,
        })
    }

    fn compute_status(&self, context: &MergeContext) -> Result<RunMergeStatusDto, AppError> {
        let repo_state = context.repo.state();
        let repository_state = Self::repository_state_name(repo_state);
        let is_rebase_in_progress = Self::is_rebase_in_progress(repo_state);
        let source_oid = Self::branch_commit_oid(&context.source_repo, &context.source_branch)?;
        let worktree_oid = Self::branch_commit_oid(&context.repo, &context.worktree_branch)?;
        let (ahead_count, behind_count) = context
            .repo
            .graph_ahead_behind(worktree_oid, source_oid)
            .map_err(|err| {
                AppError::validation(format!("failed to compute ahead/behind: {err}"))
            })?;
        let has_conflicts = context
            .repo
            .index()
            .map_err(|err| {
                AppError::validation(format!("failed to inspect repository index: {err}"))
            })?
            .has_conflicts();
        let dirty_disable_reason = Self::dirty_worktree_disable_reason(&context.repo)?;
        let is_worktree_clean = dirty_disable_reason.is_none();

        let mut state = if is_rebase_in_progress {
            MergeState::RebaseInProgress
        } else if context.run_status == "complete" {
            MergeState::Merged
        } else if has_conflicts {
            MergeState::Conflicted
        } else if behind_count > 0 {
            MergeState::NeedsRebase
        } else if ahead_count > 0 {
            MergeState::Mergeable
        } else {
            MergeState::Clean
        };

        if source_oid == worktree_oid && !matches!(state, MergeState::RebaseInProgress) {
            state = if context.run_status == "complete" {
                MergeState::Merged
            } else {
                MergeState::Clean
            };
        }

        let mut can_rebase = matches!(state, MergeState::NeedsRebase);
        let mut can_merge = if matches!(state, MergeState::Mergeable) {
            let source_ref_name = Self::source_ref_name(&context.source_branch);
            let mut source_ref = context
                .source_repo
                .find_reference(&source_ref_name)
                .map_err(|err| {
                    AppError::validation(format!(
                        "failed to resolve source branch reference: {err}"
                    ))
                })?;
            let worktree_annotated = context
                .source_repo
                .find_annotated_commit(worktree_oid)
                .map_err(|err| {
                    AppError::validation(format!("failed to load worktree commit: {err}"))
                })?;
            let (analysis, _) = context
                .source_repo
                .merge_analysis_for_ref(&mut source_ref, &[&worktree_annotated])
                .map_err(|err| AppError::validation(format!("failed to analyze merge: {err}")))?;
            analysis.is_fast_forward() || analysis.is_up_to_date()
        } else {
            false
        };

        let source_disable_reason = Self::source_merge_block_reason(context)?;

        let mut disable_reason = match state {
            MergeState::NeedsRebase => Some(
                "worktree branch is behind source branch; rebase is required before merge"
                    .to_string(),
            ),
            MergeState::RebaseInProgress => Some(
                "repository has a rebase in progress; resolve it before rebasing or merging"
                    .to_string(),
            ),
            MergeState::Conflicted => Some("worktree branch has unresolved conflicts".to_string()),
            MergeState::Clean => Some("worktree branch has no commits to merge".to_string()),
            MergeState::Merged => Some("run has already been merged".to_string()),
            MergeState::Completing => Some("merge is finalizing run completion".to_string()),
            MergeState::Mergeable => None,
        };

        if is_rebase_in_progress {
            can_rebase = false;
            can_merge = false;
        } else if let Some(reason) = dirty_disable_reason {
            can_rebase = false;
            can_merge = false;
            disable_reason = Some(reason);
        } else if let Some(reason) = source_disable_reason {
            can_merge = false;
            disable_reason = Some(reason);
        }

        Ok(RunMergeStatusDto {
            run_id: context.run_id.clone(),
            source_branch: context.source_branch.clone(),
            worktree_branch: context.worktree_branch.clone(),
            ahead_count,
            behind_count,
            is_worktree_clean,
            repository_state,
            is_rebase_in_progress,
            state: state.as_str().to_string(),
            can_rebase,
            can_merge,
            disable_reason,
        })
    }

    fn source_annotated_commit<'repo>(
        &self,
        repo: &'repo Repository,
        source_branch: &str,
    ) -> Result<AnnotatedCommit<'repo>, AppError> {
        self.branch_annotated_commit(repo, source_branch)
    }

    fn branch_annotated_commit<'repo>(
        &self,
        repo: &'repo Repository,
        branch_name: &str,
    ) -> Result<AnnotatedCommit<'repo>, AppError> {
        let source_oid = Self::branch_commit_oid(repo, branch_name)?;
        repo.find_annotated_commit(source_oid)
            .map_err(|err| AppError::validation(format!("failed to resolve source branch: {err}")))
    }

    fn ensure_head_on_worktree_branch(
        repo: &Repository,
        worktree_branch: &str,
    ) -> Result<(), AppError> {
        let head = repo.head().map_err(|err| {
            AppError::validation(format!("failed to inspect repository HEAD: {err}"))
        })?;
        if !head.is_branch() {
            return Err(AppError::validation(
                "cannot rebase: repository HEAD is detached from worktree branch".to_string(),
            ));
        }
        let head_branch = head.shorthand().unwrap_or_default();
        if head_branch != worktree_branch {
            return Err(AppError::validation(format!(
                "cannot rebase: repository HEAD is on '{head_branch}', expected worktree branch '{worktree_branch}'"
            )));
        }
        Ok(())
    }

    fn reattach_head_to_branch_if_needed(
        repo: &Repository,
        worktree_branch: &str,
    ) -> Result<(), AppError> {
        Self::attach_head_to_worktree_branch(repo, worktree_branch)?;

        let mut checkout = CheckoutBuilder::new();
        checkout.safe();
        repo.checkout_head(Some(&mut checkout)).map_err(|err| {
            AppError::validation(format!(
                "failed to safely checkout worktree branch '{worktree_branch}': {err}"
            ))
        })?;

        Ok(())
    }

    fn attach_head_to_worktree_branch(
        repo: &Repository,
        worktree_branch: &str,
    ) -> Result<(), AppError> {
        let head = repo.head().map_err(|err| {
            AppError::validation(format!("failed to inspect repository HEAD: {err}"))
        })?;
        let head_branch = head.shorthand().unwrap_or_default();
        if head.is_branch() && head_branch == worktree_branch {
            return Ok(());
        }

        let worktree_ref_name = Self::source_ref_name(worktree_branch);
        repo.set_head(&worktree_ref_name).map_err(|err| {
            AppError::validation(format!(
                "failed to reattach HEAD to worktree branch '{worktree_branch}': {err}"
            ))
        })?;

        let head = repo.head().map_err(|err| {
            AppError::validation(format!("failed to inspect repository HEAD: {err}"))
        })?;
        let head_branch = head.shorthand().unwrap_or_default();
        if !head.is_branch() || head_branch != worktree_branch {
            return Err(AppError::validation(format!(
                "repository HEAD is on '{head_branch}', expected worktree branch '{worktree_branch}'"
            )));
        }

        Ok(())
    }

    fn fast_forward_source_branch_worktree(
        repo: &Repository,
        branch_name: &str,
        target_oid: git2::Oid,
    ) -> Result<(), AppError> {
        let workdir = repo.workdir().ok_or_else(|| {
            AppError::validation("source repository has no working directory".to_string())
        })?;
        let target = target_oid.to_string();
        let merge_status = Command::new("git")
            .arg("merge")
            .arg("--ff-only")
            .arg(target)
            .current_dir(workdir)
            .status()
            .map_err(|err| AppError::validation(format!("failed to execute git merge: {err}")))?;

        if !merge_status.success() {
            return Err(AppError::validation(format!(
                "failed to fast-forward source branch '{branch_name}'"
            )));
        }

        let mut checkout = CheckoutBuilder::new();
        checkout.safe();
        repo.checkout_head(Some(&mut checkout)).map_err(|err| {
            AppError::validation(format!(
                "failed to safely refresh source branch '{branch_name}' working tree: {err}"
            ))
        })
    }

    fn source_merge_block_reason(context: &MergeContext) -> Result<Option<String>, AppError> {
        if let Some(reason) = Self::dirty_worktree_disable_reason(&context.source_repo)? {
            return Ok(Some(format!("source branch worktree is dirty: {reason}")));
        }

        if Self::ensure_head_on_worktree_branch(&context.source_repo, &context.source_branch)
            .is_err()
        {
            return Ok(Some(format!(
                "source repository HEAD must be on source branch '{}' before merge",
                context.source_branch
            )));
        }

        Ok(None)
    }

    fn is_rebase_in_progress(state: RepositoryState) -> bool {
        matches!(
            state,
            RepositoryState::Rebase
                | RepositoryState::RebaseInteractive
                | RepositoryState::RebaseMerge
        )
    }

    fn repository_state_name(state: RepositoryState) -> String {
        match state {
            RepositoryState::Clean => "clean",
            RepositoryState::Merge => "merge",
            RepositoryState::Revert => "revert",
            RepositoryState::RevertSequence => "revert_sequence",
            RepositoryState::CherryPick => "cherry_pick",
            RepositoryState::CherryPickSequence => "cherry_pick_sequence",
            RepositoryState::Bisect => "bisect",
            RepositoryState::Rebase => "rebase",
            RepositoryState::RebaseInteractive => "rebase_interactive",
            RepositoryState::RebaseMerge => "rebase_merge",
            RepositoryState::ApplyMailbox => "apply_mailbox",
            RepositoryState::ApplyMailboxOrRebase => "apply_mailbox_or_rebase",
        }
        .to_string()
    }

    fn dirty_worktree_disable_reason(repo: &Repository) -> Result<Option<String>, AppError> {
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .include_unmodified(false)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true);

        let statuses = repo.statuses(Some(&mut options)).map_err(|err| {
            AppError::validation(format!("failed to inspect worktree status: {err}"))
        })?;

        let has_dirty_changes = statuses.iter().any(|entry| {
            let status = entry.status();
            status.intersects(
                Status::INDEX_NEW
                    | Status::INDEX_MODIFIED
                    | Status::INDEX_DELETED
                    | Status::INDEX_RENAMED
                    | Status::INDEX_TYPECHANGE
                    | Status::WT_MODIFIED
                    | Status::WT_DELETED
                    | Status::WT_TYPECHANGE
                    | Status::WT_RENAMED
                    | Status::WT_NEW,
            )
        });

        if has_dirty_changes {
            Ok(Some(
                "Conflicts Detected! We have sent the details of the conflicts to your agent to be resolved"
                    .to_string(),
            ))
        } else {
            Ok(None)
        }
    }

    fn branch_commit_oid(repo: &Repository, branch_name: &str) -> Result<git2::Oid, AppError> {
        let ref_name = Self::source_ref_name(branch_name);
        let branch_ref = repo.find_reference(&ref_name).or_else(|err| {
            if err.code() == ErrorCode::NotFound {
                repo.find_branch(branch_name, BranchType::Local)
                    .and_then(|branch| branch.into_reference().resolve())
            } else {
                Err(err)
            }
        });

        let branch_ref = branch_ref.map_err(|err| {
            AppError::validation(format!("failed to resolve branch '{branch_name}': {err}"))
        })?;
        branch_ref.target().ok_or_else(|| {
            AppError::validation(format!("branch '{branch_name}' has no target commit"))
        })
    }

    fn source_ref_name(branch_name: &str) -> String {
        if branch_name.starts_with("refs/heads/") {
            branch_name.to_string()
        } else {
            format!("refs/heads/{branch_name}")
        }
    }

    fn signature(repo: &Repository) -> Result<Signature<'static>, AppError> {
        repo.signature()
            .or_else(|_| Signature::now("orkestra", "orkestra@example.com"))
            .map_err(|err| AppError::validation(format!("failed to resolve git signature: {err}")))
    }

    fn build_conflict_payload(
        repo: &Repository,
        source_branch: &str,
    ) -> Result<RunMergeConflictDto, AppError> {
        let mut files = BTreeSet::new();
        let index = repo.index().map_err(|err| {
            AppError::validation(format!("failed to inspect rebase conflicts: {err}"))
        })?;
        if let Ok(conflicts) = index.conflicts() {
            for conflict in conflicts.flatten() {
                if let Some(path) = conflict
                    .our
                    .as_ref()
                    .or(conflict.their.as_ref())
                    .or(conflict.ancestor.as_ref())
                    .and_then(|entry| std::str::from_utf8(&entry.path).ok())
                {
                    files.insert(path.to_string());
                }
            }
        }
        let files = files.into_iter().collect::<Vec<_>>();

        let conflicted_files = if files.is_empty() {
            "- none reported by Git\n".to_string()
        } else {
            files
                .iter()
                .map(|path| format!("- `{path}`\n"))
                .collect::<String>()
        };

        let prompt = format!(
            "A rebase is already in progress for this worktree. Resolve the conflicts in the listed files and continue the existing rebase safely.\n\nConflicting files:\n{conflicted_files}\nRequirements:\n\n* First confirm a rebase is in progress with `git status`.\n\n* This is an existing rebase continuation flow, not a normal standalone commit flow.\n\n* Resolve only the listed conflict markers and preserve both `{source_branch}`-intended changes and this run's valid changes.\n\n* Before continuing, verify there are no unresolved conflicts with `git diff --name-only --diff-filter=U`.\n\n* Stage only the resolved conflicted files.\n\n* Continue the rebase non-interactively using:\n  `GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --continue`\n\n* Inspect the real exit status and stderr/stdout of `git rebase --continue`. Do not assume success just because the command ran.\n\n* Do not create a normal commit unless Git explicitly requires it as part of the rebase flow.\n\n* Never edit, recreate, or patch files inside `.git`, `rebase-merge`, or `git-rebase-todo`.\n\n* Never try to repair broken rebase metadata manually.\n\n* If `git rebase --continue` fails because rebase metadata is missing or corrupt, stop and report that the rebase state is broken instead of trying to repair Git internals manually.\n\n* After attempting to continue, run `git status --short --branch` and report the exact resulting rebase state, including whether the rebase completed or more conflicts remain."
        );

        Ok(RunMergeConflictDto {
            files,
            chat_prompt: prompt,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::RunsMergeService;
    use crate::app::db::migrations::run_migrations;
    use crate::app::db::repositories::runs::RunsRepository;
    use crate::app::errors::AppError;
    use crate::app::runs::run_state_service::RunStateService;
    use crate::app::runs::service::RunsService;
    use crate::app::runs::status_transition_service::RunStatusTransitionService;
    use crate::app::worktrees::service::WorktreesService;
    use git2::{Repository, Signature};
    use sqlx::SqlitePool;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    #[derive(Debug)]
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("orkestra-merge-tests-{}", Uuid::new_v4()));
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

    async fn setup_services() -> (RunsService, RunsMergeService, SqlitePool, TempDir) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let temp_dir = TempDir::new();
        let app_data_dir = temp_dir.path().join("app-data");
        let runs_repository = RunsRepository::new(pool.clone());
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let runs_service = RunsService::new(runs_repository, worktrees_service);
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
        let merge_service = RunsMergeService::new(
            runs_service.clone(),
            run_state_service,
            run_status_transition_service,
            app_data_dir,
        );
        (runs_service, merge_service, pool, temp_dir)
    }

    fn init_git_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        let repo = Repository::init(path).unwrap();
        fs::write(path.join("README.md"), "seed\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();

        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
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

    fn append_commit(repo_path: &Path, file: &str, text: &str, message: &str) {
        let repo = Repository::open(repo_path).unwrap();
        fs::write(repo_path.join(file), text).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("orkestra", "orkestra@example.com").unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .unwrap();
    }

    fn detach_head(repo_path: &Path) {
        let repo = Repository::open(repo_path).unwrap();
        let head = repo.head().unwrap();
        let head_oid = head.target().unwrap();
        repo.set_head_detached(head_oid).unwrap();
        repo.checkout_head(None).unwrap();
    }

    fn start_rebase_without_finishing(
        repo_path: &Path,
        worktree_branch: &str,
        source_branch: &str,
    ) {
        let repo = Repository::open(repo_path).unwrap();
        let worktree_oid = repo
            .find_reference(&format!("refs/heads/{worktree_branch}"))
            .unwrap()
            .target()
            .unwrap();
        let source_oid = repo
            .find_reference(&format!("refs/heads/{source_branch}"))
            .unwrap()
            .target()
            .unwrap();
        let worktree = repo.find_annotated_commit(worktree_oid).unwrap();
        let source = repo.find_annotated_commit(source_oid).unwrap();
        let _rebase = repo
            .rebase(Some(&worktree), Some(&source), Some(&source), None)
            .unwrap();
    }

    fn write_staged_change(repo_path: &Path, file: &str, text: &str) {
        let repo = Repository::open(repo_path).unwrap();
        fs::write(repo_path.join(file), text).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
    }

    fn write_unstaged_change(repo_path: &Path, file: &str, text: &str) {
        fs::write(repo_path.join(file), text).unwrap();
    }

    fn write_untracked_file(repo_path: &Path, file: &str, text: &str) {
        fs::write(repo_path.join(file), text).unwrap();
    }

    fn repo_status_codes(repo_path: &Path) -> Vec<String> {
        let repo = Repository::open(repo_path).unwrap();
        let mut options = git2::StatusOptions::new();
        options.include_untracked(false).include_ignored(false);
        let statuses = repo.statuses(Some(&mut options)).unwrap();
        statuses
            .iter()
            .map(|entry| format!("{:?}", entry.status()))
            .collect()
    }

    #[tokio::test]
    async fn status_reports_needs_rebase_when_worktree_is_behind() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();

        append_commit(&repo_path, "README.md", "main-change\n", "main change");
        let status = merge_service.get_merge_status(&run.id).await.unwrap();

        assert_eq!(status.state, "needs_rebase");
        assert!(status.behind_count > 0);
        assert!(status.can_rebase);
        assert!(!status.can_merge);
    }

    #[tokio::test]
    async fn rebase_conflict_returns_files_and_chat_prompt() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );
        append_commit(&repo_path, "README.md", "main-change\n", "main change");

        let response = merge_service.rebase_worktree_branch(&run.id).await.unwrap();

        assert_eq!(response.state, "conflicted");
        let conflict = response.conflict.expect("expected conflict payload");
        assert!(conflict.files.iter().any(|file| file == "README.md"));
        assert!(conflict.chat_prompt.contains("Conflicting files"));
        assert!(conflict
            .chat_prompt
            .contains("A rebase is already in progress for this worktree."));
        assert!(conflict.chat_prompt.contains("`git status`"));
        assert!(conflict.chat_prompt.contains(&format!(
            "`{}`-intended changes",
            run.source_branch.clone().unwrap()
        )));
        assert!(conflict
            .chat_prompt
            .contains("`git diff --name-only --diff-filter=U`"));
        assert!(conflict
            .chat_prompt
            .contains("Stage only the resolved conflicted files."));
        assert!(conflict
            .chat_prompt
            .contains("`GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --continue`"));
        assert!(conflict
            .chat_prompt
            .contains("Inspect the real exit status and stderr/stdout"));
        assert!(conflict
            .chat_prompt
            .contains("Do not create a normal commit unless Git explicitly requires it"));
        assert!(conflict.chat_prompt.contains("Never edit, recreate, or patch files inside `.git`, `rebase-merge`, or `git-rebase-todo`."));
        assert!(conflict
            .chat_prompt
            .contains("Never try to repair broken rebase metadata manually."));
        assert!(conflict.chat_prompt.contains("rebase state is broken"));
        assert!(conflict
            .chat_prompt
            .contains("`git status --short --branch`"));

        let repo = Repository::open(&worktree_path).unwrap();
        let head = repo.head().unwrap();
        assert!(head.is_branch());
        assert_eq!(
            head.shorthand().unwrap_or_default(),
            run.worktree_id.unwrap()
        );
    }

    #[tokio::test]
    async fn rebase_success_keeps_head_attached_to_worktree_branch() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(&repo_path, "README.md", "main-change\n", "main change");
        append_commit(
            &worktree_path,
            "NOTES.md",
            "worktree-change\n",
            "worktree change",
        );

        let response = merge_service.rebase_worktree_branch(&run.id).await.unwrap();
        assert_eq!(response.state, "mergeable");

        let repo = Repository::open(&worktree_path).unwrap();
        let head = repo.head().unwrap();
        assert!(head.is_branch());
        assert_eq!(
            head.shorthand().unwrap_or_default(),
            run.worktree_id.unwrap()
        );
    }

    #[tokio::test]
    async fn rebase_fails_when_head_is_not_on_worktree_branch() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();

        append_commit(&repo_path, "README.md", "main-change\n", "main change");

        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());
        detach_head(&worktree_path);

        let err = merge_service
            .rebase_worktree_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(
                    message.contains("expected worktree branch")
                        || message.contains("HEAD is detached")
                );
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn status_blocks_actions_when_rebase_is_in_progress() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();

        append_commit(&repo_path, "README.md", "main-change\n", "main change");
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());
        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );

        start_rebase_without_finishing(&worktree_path, &run.worktree_id.unwrap(), "main");

        let status = merge_service.get_merge_status(&run.id).await.unwrap();
        assert_eq!(status.state, "rebase_in_progress");
        assert_eq!(status.repository_state, "rebase_merge");
        assert!(status.is_rebase_in_progress);
        assert!(!status.can_rebase);
        assert!(!status.can_merge);
        assert!(status
            .disable_reason
            .unwrap_or_default()
            .contains("rebase in progress"));
    }

    #[tokio::test]
    async fn dirty_worktree_status_loads_and_disables_actions() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        write_unstaged_change(&worktree_path, "README.md", "dirty\n");

        let status = merge_service.get_merge_status(&run.id).await.unwrap();
        assert_eq!(status.state, "clean");
        assert!(!status.is_worktree_clean);
        assert!(!status.can_rebase);
        assert!(!status.can_merge);
        assert!(status
            .disable_reason
            .unwrap_or_default()
            .contains("clean the worktree"));
    }

    #[tokio::test]
    async fn dirty_worktree_blocks_rebase_with_validation_error() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(&repo_path, "README.md", "main-change\n", "main change");
        write_unstaged_change(&worktree_path, "README.md", "dirty\n");

        let err = merge_service
            .rebase_worktree_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(message.contains("clean the worktree"));
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn dirty_worktree_blocks_merge_with_validation_error() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );
        write_staged_change(&worktree_path, "README.md", "staged-dirty\n");

        let err = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(message.contains("clean the worktree"));
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn untracked_worktree_file_blocks_merge_preflight() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );
        write_untracked_file(&worktree_path, "UNTRACKED.md", "pending\n");

        let err = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(message.contains("clean the worktree"));
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn status_reports_mergeable_when_worktree_is_ahead_only() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );

        let status = merge_service.get_merge_status(&run.id).await.unwrap();
        assert_eq!(status.state, "mergeable");
        assert!(status.can_merge);
        assert!(!status.can_rebase);
        assert!(status.ahead_count > 0);
        assert_eq!(status.behind_count, 0);
    }

    #[tokio::test]
    async fn fast_forward_merge_marks_run_complete() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );

        let merge_response = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(merge_response.state, "completing");

        let run_after = runs_service.get_run_model(&run.id).await.unwrap();
        assert_eq!(run_after.status, "complete");
        assert!(run_after.finished_at.is_some());

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "done");

        let repo = Repository::open(&repo_path).unwrap();
        let main_oid = repo
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        let worktree_oid = repo
            .find_reference(&format!("refs/heads/{}", run.worktree_id.unwrap()))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(main_oid, worktree_oid);
        let head = repo.head().unwrap();
        assert!(head.is_branch());
        assert_eq!(head.shorthand().unwrap_or_default(), "main");
        assert_eq!(head.target().unwrap(), worktree_oid);
        let statuses = repo_status_codes(&repo_path);
        assert!(statuses.is_empty(), "source repo statuses: {statuses:?}");
    }

    #[tokio::test]
    async fn dirty_source_worktree_blocks_merge_with_validation_error() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );
        write_unstaged_change(&repo_path, "README.md", "dirty-main\n");

        let err = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(message.contains("source branch worktree is dirty"));
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn untracked_source_worktree_file_blocks_merge_preflight() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );
        write_untracked_file(&repo_path, "UNTRACKED.md", "pending\n");

        let err = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap_err();
        match err {
            AppError::Validation(message) => {
                assert!(message.contains("source branch worktree is dirty"));
            }
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn clean_run_without_merge_evidence_cannot_be_completed() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();

        let response = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(response.state, "clean");

        let run_after = runs_service.get_run_model(&run.id).await.unwrap();
        assert_ne!(run_after.status, "complete");
        assert!(run_after.finished_at.is_none());

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_ne!(task_status, "done");
    }

    #[tokio::test]
    async fn merge_is_idempotent_at_up_to_date_tip_with_merge_evidence() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );

        let first = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(first.state, "completing");

        sqlx::query("UPDATE runs SET status = 'in_progress' WHERE id = ?")
            .bind(&run.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE tasks SET status = 'review' WHERE id = ?")
            .bind("task-1")
            .execute(&pool)
            .await
            .unwrap();

        let second = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(second.state, "completing");

        let run_after = runs_service.get_run_model(&run.id).await.unwrap();
        assert_eq!(run_after.status, "complete");
        assert!(run_after.finished_at.is_some());

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "done");
    }

    #[tokio::test]
    async fn merge_retry_finalizes_when_run_not_completed_and_finished_at_missing() {
        let (runs_service, merge_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        let run = runs_service
            .create_run_with_defaults("task-1", None, None, None)
            .await
            .unwrap();
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(run.worktree_id.clone().unwrap());

        append_commit(
            &worktree_path,
            "README.md",
            "worktree-change\n",
            "worktree change",
        );

        let first = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(first.state, "completing");

        sqlx::query("UPDATE runs SET status = 'in_progress', finished_at = NULL WHERE id = ?")
            .bind(&run.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE tasks SET status = 'review' WHERE id = ?")
            .bind("task-1")
            .execute(&pool)
            .await
            .unwrap();

        let second = merge_service
            .merge_into_source_branch(&run.id)
            .await
            .unwrap();
        assert_eq!(second.state, "completing");

        let run_after = runs_service.get_run_model(&run.id).await.unwrap();
        assert_eq!(run_after.status, "complete");
        assert!(run_after.finished_at.is_some());

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "done");
    }
}
