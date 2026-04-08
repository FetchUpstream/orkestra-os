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
use crate::app::worktrees::dto::{
    CreateWorktreeRequest, CreateWorktreeResponse, LocalBranchDto, RemoveWorktreeRequest,
};
use crate::app::worktrees::error::WorktreesServiceError;
use crate::app::worktrees::pathing::{
    choose_unique_worktree_id, parse_worktree_id_typed, sanitize_branch_segment,
    validate_project_key_segment_typed,
};
use git2::{BranchType, Error, ErrorCode, Repository, WorktreeAddOptions, WorktreePruneOptions};
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use tracing::{debug, info, warn};

const CREATE_WORKTREE_MAX_RETRIES: usize = 8;

#[derive(Clone, Debug)]
pub struct WorktreesService {
    base_root: PathBuf,
}

impl WorktreesService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            base_root: app_data_dir.join("worktrees"),
        }
    }

    pub fn create(&self, input: CreateWorktreeRequest) -> Result<CreateWorktreeResponse, AppError> {
        self.create_typed(input).map_err(|err| err.to_app_error())
    }

    fn create_typed(
        &self,
        mut input: CreateWorktreeRequest,
    ) -> Result<CreateWorktreeResponse, WorktreesServiceError> {
        input.project_key = input.project_key.trim().to_string();
        input.repo_path = input.repo_path.trim().to_string();
        input.branch_title = input.branch_title.trim().to_string();
        input.source_branch = input
            .source_branch
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        validate_project_key_segment_typed(&input.project_key)?;
        if input.repo_path.is_empty() {
            return Err(WorktreesServiceError::RepoPathRequired);
        }

        info!(
            subsystem = "worktrees",
            operation = "create",
            phase = "start",
            project_key = input.project_key.as_str(),
            repo_path = input.repo_path.as_str(),
            branch_title = input.branch_title.as_str(),
            "Worktree creation started"
        );

        let repo = Repository::open(&input.repo_path).map_err(|source| {
            WorktreesServiceError::OpenRepository {
                repo_path: input.repo_path.clone(),
                source,
            }
        })?;
        if repo.is_bare() {
            return Err(WorktreesServiceError::BareRepository);
        }

        let (source_branch, start_point) =
            resolve_source_branch(&repo, input.source_branch.as_deref())?;

        let branch_slug = sanitize_branch_segment(&input.branch_title);
        for attempt in 0..CREATE_WORKTREE_MAX_RETRIES {
            let worktree_id =
                choose_unique_worktree_id(&self.base_root, &input.project_key, &branch_slug, &repo);
            let branch_name = worktree_id.clone();
            let worktree_path = self.base_root.join(&worktree_id);
            std::fs::create_dir_all(
                worktree_path
                    .parent()
                    .ok_or(WorktreesServiceError::InvalidWorktreePath)?,
            )
            .map_err(|source| WorktreesServiceError::CreateWorktreeParentDir {
                path: worktree_path
                    .parent()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default(),
                source,
            })?;
            prepare_worktree_metadata_parent(&repo, &worktree_id).map_err(|source| {
                WorktreesServiceError::PrepareWorktreeMetadataDir {
                    path: repo
                        .path()
                        .join("worktrees")
                        .join(&worktree_id)
                        .parent()
                        .map(|path| path.display().to_string())
                        .unwrap_or_default(),
                    source,
                }
            })?;

            debug!(
                subsystem = "worktrees",
                operation = "create",
                phase = "attempt",
                project_key = input.project_key.as_str(),
                repo_path = input.repo_path.as_str(),
                worktree_id = worktree_id.as_str(),
                worktree_path = %worktree_path.display(),
                branch_name = branch_name.as_str(),
                start_point = start_point.to_string(),
                attempt = attempt + 1,
                "Creating worktree via git2"
            );

            match create_worktree_with_new_branch(&repo, &worktree_id, &worktree_path, start_point)
            {
                Ok(()) => {
                    info!(
                        subsystem = "worktrees",
                        operation = "create",
                        phase = "success",
                        project_key = input.project_key.as_str(),
                        repo_path = input.repo_path.as_str(),
                        worktree_id = worktree_id.as_str(),
                        worktree_path = %worktree_path.display(),
                        branch_name = branch_name.as_str(),
                        source_branch = source_branch.as_deref().unwrap_or("<none>"),
                        "Worktree creation succeeded"
                    );
                    return Ok(CreateWorktreeResponse {
                        worktree_id,
                        branch_name,
                        source_branch,
                        path: worktree_path.to_string_lossy().to_string(),
                    });
                }
                Err(source) if is_retryable_git_worktree_add_conflict(&source) => {
                    if worktree_path.exists() || repo.find_worktree(&worktree_id).is_ok() {
                        debug!(
                            subsystem = "worktrees",
                            operation = "create",
                            phase = "rollback",
                            project_key = input.project_key.as_str(),
                            worktree_id = worktree_id.as_str(),
                            attempt = attempt + 1,
                            "Retryable conflict left artifacts; attempting cleanup"
                        );
                        if let Err(rollback_err) = rollback_failed_worktree_add_attempt(
                            &repo,
                            &worktree_id,
                            &worktree_path,
                            &branch_name,
                            false,
                        ) {
                            return Err(WorktreesServiceError::CreateWorktree {
                                worktree_id,
                                source: Error::from_str(&format!(
                                    "worktree creation rollback failed after conflict: {}",
                                    rollback_err.message()
                                )),
                            });
                        }
                    }
                    warn!(
                        subsystem = "worktrees",
                        operation = "create",
                        project_key = input.project_key.as_str(),
                        worktree_id = worktree_id.as_str(),
                        source = source.message(),
                        attempt = attempt + 1,
                        "Retrying worktree create after metadata conflict"
                    );
                    continue;
                }
                Err(source) => {
                    warn!(
                        subsystem = "worktrees",
                        operation = "create",
                        phase = "failed",
                        project_key = input.project_key.as_str(),
                        worktree_id = worktree_id.as_str(),
                        source = source.message(),
                        "Worktree creation failed"
                    );
                    return Err(WorktreesServiceError::CreateWorktree {
                        worktree_id,
                        source,
                    });
                }
            }
        }

        let worktree_id =
            choose_unique_worktree_id(&self.base_root, &input.project_key, &branch_slug, &repo);
        Err(WorktreesServiceError::CreateWorktree {
            worktree_id,
            source: Error::from_str(
                "worktree creation retries exhausted due to repeated conflicts",
            ),
        })
    }

    pub fn remove(&self, input: RemoveWorktreeRequest) -> Result<(), AppError> {
        self.remove_typed(input).map_err(|err| err.to_app_error())
    }

    pub fn list_local_branches(&self, repo_path: &str) -> Result<Vec<LocalBranchDto>, AppError> {
        self.list_local_branches_typed(repo_path)
            .map_err(|err| err.to_app_error())
    }

    fn list_local_branches_typed(
        &self,
        repo_path: &str,
    ) -> Result<Vec<LocalBranchDto>, WorktreesServiceError> {
        let repo_path = repo_path.trim();
        if repo_path.is_empty() {
            return Err(WorktreesServiceError::RepoPathRequired);
        }

        let repo = Repository::open(repo_path).map_err(|source| {
            WorktreesServiceError::OpenRepository {
                repo_path: repo_path.to_string(),
                source,
            }
        })?;
        if repo.is_bare() {
            return Err(WorktreesServiceError::BareRepository);
        }

        let mut branches = Vec::new();
        let branch_iter = repo
            .branches(Some(BranchType::Local))
            .map_err(|source| WorktreesServiceError::ListLocalBranches { source })?;

        for branch_entry in branch_iter {
            let (branch, _) = branch_entry
                .map_err(|source| WorktreesServiceError::ListLocalBranches { source })?;
            let branch_name = branch
                .name()
                .map_err(|source| WorktreesServiceError::ResolveLocalBranchName { source })?
                .map(str::to_string)
                .ok_or_else(|| WorktreesServiceError::ResolveLocalBranchName {
                    source: Error::from_str("local branch name is not valid UTF-8"),
                })?;

            branches.push(LocalBranchDto {
                name: branch_name,
                is_checked_out: branch.is_head(),
            });
        }

        branches.sort_by(|left, right| {
            right
                .is_checked_out
                .cmp(&left.is_checked_out)
                .then_with(|| left.name.cmp(&right.name))
        });

        Ok(branches)
    }

    fn remove_typed(&self, mut input: RemoveWorktreeRequest) -> Result<(), WorktreesServiceError> {
        input.repo_path = input.repo_path.trim().to_string();
        input.worktree_id = input.worktree_id.trim().to_string();

        if input.repo_path.is_empty() {
            return Err(WorktreesServiceError::RepoPathRequired);
        }
        if input.worktree_id.is_empty() {
            return Err(WorktreesServiceError::WorktreeIdRequired);
        }

        info!(
            subsystem = "worktrees",
            operation = "remove",
            phase = "start",
            repo_path = input.repo_path.as_str(),
            worktree_id = input.worktree_id.as_str(),
            "Worktree cleanup started"
        );

        let repo = Repository::open(&input.repo_path).map_err(|source| {
            WorktreesServiceError::OpenRepository {
                repo_path: input.repo_path.clone(),
                source,
            }
        })?;
        let worktree = repo.find_worktree(&input.worktree_id).map_err(|source| {
            WorktreesServiceError::WorktreeNotFound {
                worktree_id: input.worktree_id.clone(),
                source,
            }
        })?;

        let mut prune_options = WorktreePruneOptions::new();
        prune_options.working_tree(true).valid(true).locked(true);
        worktree.prune(Some(&mut prune_options)).map_err(|source| {
            WorktreesServiceError::PruneWorktree {
                worktree_id: input.worktree_id.clone(),
                source,
            }
        })?;

        info!(
            subsystem = "worktrees",
            operation = "remove",
            phase = "success",
            repo_path = input.repo_path.as_str(),
            worktree_id = input.worktree_id.as_str(),
            "Worktree cleanup succeeded"
        );

        Ok(())
    }

    pub fn remove_project_artifacts(
        &self,
        project_key: &str,
        worktree_ids: &[String],
    ) -> Result<(), AppError> {
        self.remove_project_artifacts_typed(project_key, worktree_ids)
            .map_err(|err| err.to_app_error())
    }

    fn remove_project_artifacts_typed(
        &self,
        project_key: &str,
        worktree_ids: &[String],
    ) -> Result<(), WorktreesServiceError> {
        let project_key = project_key.trim();
        validate_project_key_segment_typed(project_key)?;

        info!(
            subsystem = "worktrees",
            operation = "remove_project_artifacts",
            project_key = project_key,
            worktree_count = worktree_ids.len(),
            "Removing project worktree artifacts"
        );

        for worktree_id in worktree_ids {
            let (parsed_project_key, _) = parse_worktree_id_typed(worktree_id)?;

            let worktree_path = self.base_root.join(worktree_id.trim());
            if !worktree_path.exists() {
                continue;
            }
            std::fs::remove_dir_all(&worktree_path).map_err(|source| {
                WorktreesServiceError::RemoveWorktreeDirectory {
                    path: worktree_path.display().to_string(),
                    source,
                }
            })?;

            let legacy_project_root = self.base_root.join(parsed_project_key);
            if legacy_project_root != self.base_root.join(project_key)
                && legacy_project_root.exists()
            {
                let _ = std::fs::remove_dir(&legacy_project_root);
            }
        }

        let project_root = self.base_root.join(project_key);
        if project_root.exists() {
            std::fs::remove_dir_all(&project_root).map_err(|source| {
                WorktreesServiceError::RemoveProjectWorktreeRoot {
                    path: project_root.display().to_string(),
                    source,
                }
            })?;
        }

        info!(
            subsystem = "worktrees",
            operation = "remove_project_artifacts",
            project_key = project_key,
            "Removed project worktree artifacts"
        );

        Ok(())
    }

    #[cfg(test)]
    pub fn base_root_for_tests(&self) -> &PathBuf {
        &self.base_root
    }
}

fn resolve_source_branch(
    repo: &Repository,
    requested_source_branch: Option<&str>,
) -> Result<(Option<String>, git2::Oid), WorktreesServiceError> {
    if let Some(branch_name) = requested_source_branch {
        let branch_name = branch_name.trim();
        let branch = repo
            .find_branch(branch_name, BranchType::Local)
            .map_err(|source| {
                if source.code() == ErrorCode::NotFound {
                    WorktreesServiceError::SourceBranchNotFound {
                        branch_name: branch_name.to_string(),
                    }
                } else {
                    WorktreesServiceError::ResolveSourceBranch {
                        branch_name: branch_name.to_string(),
                        source,
                    }
                }
            })?;
        let branch_commit = branch.get().peel_to_commit().map_err(|source| {
            WorktreesServiceError::ResolveSourceBranchCommit {
                branch_name: branch_name.to_string(),
                source,
            }
        })?;

        return Ok((Some(branch_name.to_string()), branch_commit.id()));
    }

    let head = repo
        .head()
        .map_err(|source| WorktreesServiceError::ResolveHeadRef { source })?;
    let source_branch = if head.is_branch() {
        head.shorthand().map(str::to_string)
    } else {
        None
    };
    let head_commit = head
        .peel_to_commit()
        .map_err(|source| WorktreesServiceError::ResolveHeadCommit { source })?;

    Ok((source_branch, head_commit.id()))
}

fn create_worktree_with_new_branch(
    repo: &Repository,
    worktree_id: &str,
    worktree_path: &Path,
    start_point: git2::Oid,
) -> Result<(), Error> {
    let start_commit = repo.find_commit(start_point)?;
    let worktree_add_result = {
        let branch = repo.branch(worktree_id, &start_commit, false)?;
        let mut options = WorktreeAddOptions::new();
        options.reference(Some(branch.get()));
        repo.worktree(worktree_id, worktree_path, Some(&mut options))
    };

    if let Err(worktree_add_error) = worktree_add_result {
        warn!(
            subsystem = "worktrees",
            operation = "create",
            phase = "rollback_start",
            worktree_id,
            branch_name = worktree_id,
            worktree_path = %worktree_path.display(),
            source = worktree_add_error.message(),
            "Worktree add failed after branch creation; rolling back branch"
        );

        match cleanup_newly_created_branch(repo, worktree_id) {
            Ok(()) => {
                info!(
                    subsystem = "worktrees",
                    operation = "create",
                    phase = "rollback_success",
                    worktree_id,
                    branch_name = worktree_id,
                    "Rolled back newly created branch after worktree add failure"
                );
                return Err(worktree_add_error);
            }
            Err(rollback_error) => {
                warn!(
                    subsystem = "worktrees",
                    operation = "create",
                    phase = "rollback_failed",
                    worktree_id,
                    branch_name = worktree_id,
                    worktree_path = %worktree_path.display(),
                    source = rollback_error.message(),
                    "Failed to roll back newly created branch after worktree add failure"
                );
                return Err(Error::from_str(&format!(
                    "worktree add failed for '{}' at '{}': {}; branch rollback failed for '{}': {}",
                    worktree_id,
                    worktree_path.display(),
                    worktree_add_error.message(),
                    worktree_id,
                    rollback_error.message()
                )));
            }
        }
    }

    Ok(())
}

fn prepare_worktree_metadata_parent(
    repo: &Repository,
    worktree_id: &str,
) -> Result<(), std::io::Error> {
    let metadata_path = repo.path().join("worktrees").join(worktree_id);
    if let Some(parent) = metadata_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn is_retryable_git_worktree_add_conflict(err: &Error) -> bool {
    if err.code() == ErrorCode::Exists {
        let message = err.message().to_ascii_lowercase();
        return message.contains("a branch named")
            || message.contains("could not lock ref")
            || message.contains("a reference with that name already exists");
    }

    if err.code() != ErrorCode::GenericError {
        return false;
    }

    let message = err.message().to_ascii_lowercase();
    message.contains("already exists")
        || message.contains("already checked out")
        || message.contains("is already used")
        || message.contains("already registered")
        || message.contains("reference already exists")
        || message.contains("a branch named")
        || message.contains("could not lock ref")
}

fn cleanup_newly_created_branch(repo: &Repository, branch_name: &str) -> Result<(), Error> {
    match repo.find_branch(branch_name, BranchType::Local) {
        Ok(mut branch) => branch.delete(),
        Err(err) if err.code() == ErrorCode::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn run_git_worktree_cleanup(repo: &Repository, worktree_path: &PathBuf) -> Result<(), Error> {
    let Some(repo_root) = repo.workdir() else {
        return Err(Error::from_str(
            "failed to cleanup linked worktree: repository workdir unavailable",
        ));
    };

    let remove_output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .map_err(|err| {
            Error::from_str(&format!(
                "failed to execute git worktree remove for '{}': {}",
                worktree_path.display(),
                err
            ))
        })?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        let stdout = String::from_utf8_lossy(&remove_output.stdout);
        if !stderr.contains("is not a working tree") {
            return Err(Error::from_str(&format!(
                "git worktree remove failed for '{}': status={} stdout='{}' stderr='{}'",
                worktree_path.display(),
                remove_output.status,
                stdout.trim(),
                stderr.trim()
            )));
        }
    }

    let prune_output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("worktree")
        .arg("prune")
        .arg("--expire")
        .arg("now")
        .output()
        .map_err(|err| {
            Error::from_str(&format!(
                "failed to execute git worktree prune after removing '{}': {}",
                worktree_path.display(),
                err
            ))
        })?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        let stdout = String::from_utf8_lossy(&prune_output.stdout);
        return Err(Error::from_str(&format!(
            "git worktree prune failed after removing '{}': status={} stdout='{}' stderr='{}'",
            worktree_path.display(),
            prune_output.status,
            stdout.trim(),
            stderr.trim()
        )));
    }

    Ok(())
}

fn rollback_failed_worktree_add_attempt(
    repo: &Repository,
    worktree_id: &str,
    worktree_path: &PathBuf,
    branch_name: &str,
    branch_created_in_attempt: bool,
) -> Result<(), Error> {
    let metadata_path = repo.path().join("worktrees").join(worktree_id);
    let metadata_found_before = metadata_path.exists();
    let worktree_dir_existed_before = worktree_path.exists();

    debug!(
        subsystem = "worktrees",
        operation = "create_rollback",
        worktree_id,
        branch_name,
        candidate_path = %worktree_path.display(),
        metadata_path = %metadata_path.display(),
        metadata_found_before,
        worktree_dir_existed_before,
        branch_created_in_attempt,
        "Starting rollback after worktree add conflict"
    );

    let linked_git_dir_path = worktree_path.join(".git");
    let linked_repo_exists_by_path = Repository::open(worktree_path).is_ok();
    debug!(
        subsystem = "worktrees",
        operation = "create_rollback",
        worktree_id,
        branch_name,
        candidate_path = %worktree_path.display(),
        linked_git_dir_path = %linked_git_dir_path.display(),
        linked_git_dir_exists = linked_git_dir_path.exists(),
        linked_repo_exists_by_path,
        "Inspected rollback candidate path before linked-worktree cleanup"
    );

    if linked_repo_exists_by_path || linked_git_dir_path.exists() {
        if let Ok(linked_repo) = Repository::open(worktree_path) {
            let linked_head = linked_repo
                .head()
                .ok()
                .and_then(|head| head.shorthand().map(str::to_string))
                .unwrap_or_else(|| "<unknown>".to_string());
            debug!(
                subsystem = "worktrees",
                operation = "create_rollback",
                worktree_id,
                branch_name,
                candidate_path = %worktree_path.display(),
                linked_head = linked_head.as_str(),
                "Opened linked repository via attempted path"
            );
        }

        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            candidate_path = %worktree_path.display(),
            "Detaching linked worktree via git worktree remove"
        );
        run_git_worktree_cleanup(repo, worktree_path).map_err(|err| {
            Error::from_str(&format!(
                "failed to detach linked worktree at '{}' before branch cleanup: {}",
                worktree_path.display(),
                err.message()
            ))
        })?;
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            candidate_path = %worktree_path.display(),
            "Detached linked worktree via path-aware git cleanup"
        );
    }

    if let Ok(worktree) = repo.find_worktree(worktree_id) {
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "Found linked worktree metadata via repository handle"
        );
        let mut prune_options = WorktreePruneOptions::new();
        prune_options.working_tree(true).valid(true).locked(true);
        worktree.prune(Some(&mut prune_options)).map_err(|err| {
            Error::from_str(&format!(
                "failed to prune linked worktree metadata for '{}' at '{}': {}",
                worktree_id,
                worktree_path.display(),
                err
            ))
        })?;
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "Pruned linked worktree through repository handle"
        );
    } else {
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "No linked worktree found through repository handle"
        );
    }

    if worktree_path.exists() {
        std::fs::remove_dir_all(worktree_path).map_err(|err| {
            Error::from_str(&format!(
                "failed to remove worktree directory '{}': {}",
                worktree_path.display(),
                err
            ))
        })?;
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            candidate_path = %worktree_path.display(),
            "Removed worktree directory"
        );
    } else {
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            candidate_path = %worktree_path.display(),
            "Worktree directory did not exist during rollback"
        );
    }

    if metadata_path.exists() {
        std::fs::remove_dir_all(&metadata_path).map_err(|err| {
            Error::from_str(&format!(
                "failed to remove worktree metadata directory '{}': {}",
                metadata_path.display(),
                err
            ))
        })?;
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            metadata_path = %metadata_path.display(),
            "Removed worktree metadata directory"
        );
    } else {
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            metadata_path = %metadata_path.display(),
            "Worktree metadata directory did not exist during rollback"
        );
    }

    if let Ok(worktree) = repo.find_worktree(worktree_id) {
        let mut prune_options = WorktreePruneOptions::new();
        prune_options.working_tree(true).valid(true).locked(true);
        worktree.prune(Some(&mut prune_options)).map_err(|err| {
            Error::from_str(&format!(
                "failed to prune linked worktree metadata after filesystem cleanup for '{}' at '{}': {}",
                worktree_id,
                worktree_path.display(),
                err
            ))
        })?;
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "Pruned linked worktree metadata after filesystem cleanup"
        );
    }

    if branch_created_in_attempt {
        cleanup_newly_created_branch(repo, branch_name).map_err(|err| {
            Error::from_str(&format!(
                "failed to remove rollback branch '{}' for worktree '{}' at '{}': {}",
                branch_name,
                worktree_id,
                worktree_path.display(),
                err
            ))
        })?;
        info!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "Removed rollback branch after linked-worktree cleanup"
        );
    } else {
        debug!(
            subsystem = "worktrees",
            operation = "create_rollback",
            worktree_id,
            branch_name,
            "Skipped branch cleanup because branch pre-existed"
        );
    }

    if let Some(parent) = worktree_path.parent() {
        match std::fs::remove_dir(parent) {
            Ok(_) => {}
            Err(err)
                if err.kind() == ErrorKind::NotFound
                    || err.kind() == ErrorKind::DirectoryNotEmpty => {}
            Err(err) => {
                return Err(Error::from_str(&format!(
                    "failed to remove worktree parent directory '{}': {}",
                    parent.display(),
                    err
                )));
            }
        }
    }

    info!(
        subsystem = "worktrees",
        operation = "create_rollback",
        phase = "success",
        worktree_id,
        branch_name,
        metadata_found_after = metadata_path.exists(),
        worktree_dir_exists_after = worktree_path.exists(),
        "Worktree rollback cleanup completed"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::WorktreesService;
    use crate::app::errors::AppError;
    use crate::app::worktrees::dto::CreateWorktreeRequest;
    use crate::app::worktrees::pathing::{compose_worktree_id, sanitize_branch_segment};
    use git2::{BranchType, ErrorClass, ErrorCode, Repository, Signature};
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    #[test]
    fn path_helpers_produce_project_key_and_slug_segments() {
        assert_eq!(
            sanitize_branch_segment("  Fix Login --- Flow!!!  "),
            "fix-login-flow"
        );
        assert_eq!(
            compose_worktree_id("ALP", "fix-login-flow"),
            "ALP/fix-login-flow"
        );
    }

    #[test]
    fn constructor_uses_app_data_worktrees_root() {
        let service = WorktreesService::new(PathBuf::from("/tmp/app-data"));
        assert_eq!(service.base_root, Path::new("/tmp/app-data/worktrees"));
    }

    #[test]
    fn create_rejects_invalid_project_key_before_repo_checks() {
        let service = WorktreesService::new(PathBuf::from("/tmp/app-data"));
        let result = service.create(CreateWorktreeRequest {
            project_key: "alp".to_string(),
            repo_path: "/path/that/does/not/matter/yet".to_string(),
            branch_title: "branch".to_string(),
            source_branch: None,
        });

        match result {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "project_key must be uppercase alphanumeric")
            }
            _ => panic!("expected project_key validation error"),
        }
    }

    #[test]
    fn cleanup_newly_created_branch_deletes_only_target_branch() {
        let repo_root =
            std::env::temp_dir().join(format!("orkestra-worktrees-tests-{}", Uuid::new_v4()));
        fs::create_dir_all(&repo_root).unwrap();
        let repo = Repository::init(&repo_root).unwrap();

        fs::write(repo_root.join("README.md"), "seed\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        let commit_id = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "initial commit",
                &tree,
                &[],
            )
            .unwrap();
        let commit = repo.find_commit(commit_id).unwrap();

        repo.branch("ALP/branch-a", &commit, false).unwrap();
        repo.branch("ALP/branch-b", &commit, false).unwrap();

        super::cleanup_newly_created_branch(&repo, "ALP/branch-a").unwrap();

        assert!(repo.find_branch("ALP/branch-a", BranchType::Local).is_err());
        assert!(repo.find_branch("ALP/branch-b", BranchType::Local).is_ok());

        let _ = fs::remove_dir_all(&repo_root);
    }

    #[test]
    fn worktree_add_retry_classifier_is_not_blanket_exists() {
        let non_worktree_exists = git2::Error::new(
            ErrorCode::Exists,
            ErrorClass::Reference,
            "reference already exists",
        );
        assert!(!super::is_retryable_git_worktree_add_conflict(
            &non_worktree_exists
        ));

        let worktree_exists = git2::Error::new(
            ErrorCode::GenericError,
            ErrorClass::None,
            "git worktree add -b failed: fatal: a branch named 'ALP/x' already exists",
        );
        assert!(super::is_retryable_git_worktree_add_conflict(
            &worktree_exists
        ));
    }

    #[test]
    fn rollback_cleans_linked_worktree_before_deleting_branch() {
        let temp_root = std::env::temp_dir().join(format!(
            "orkestra-worktrees-rollback-tests-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let repo_root = temp_root.join("repo");
        let repo = Repository::init(&repo_root).unwrap();

        fs::write(repo_root.join("README.md"), "seed\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        let commit_id = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "initial commit",
                &tree,
                &[],
            )
            .unwrap();
        let commit = repo.find_commit(commit_id).unwrap();

        let worktree_id = "ALP/rollback-test";
        let worktree_path = temp_root.join("linked").join(worktree_id);
        fs::create_dir_all(worktree_path.parent().unwrap()).unwrap();
        let branch = repo.branch(worktree_id, &commit, false).unwrap();

        let mut options = git2::WorktreeAddOptions::new();
        options.reference(Some(branch.get()));
        super::prepare_worktree_metadata_parent(&repo, worktree_id).unwrap();
        repo.worktree(worktree_id, &worktree_path, Some(&mut options))
            .unwrap();

        super::rollback_failed_worktree_add_attempt(
            &repo,
            worktree_id,
            &worktree_path,
            worktree_id,
            true,
        )
        .unwrap();

        assert!(repo.find_worktree(worktree_id).is_err());
        assert!(repo.find_branch(worktree_id, BranchType::Local).is_err());
        assert!(!worktree_path.exists());

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn rollback_detaches_linked_repo_by_path_before_branch_delete() {
        let temp_root = std::env::temp_dir().join(format!(
            "orkestra-worktrees-path-rollback-tests-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let repo_root = temp_root.join("repo");
        let repo = Repository::init(&repo_root).unwrap();

        fs::write(repo_root.join("README.md"), "seed\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        let commit_id = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "initial commit",
                &tree,
                &[],
            )
            .unwrap();
        let commit = repo.find_commit(commit_id).unwrap();

        let actual_worktree_id = "ALP/path-rollback-test";
        let rollback_lookup_id = "ALP/path-rollback-test-wrong-id";
        let worktree_path = temp_root.join("linked").join(actual_worktree_id);
        fs::create_dir_all(worktree_path.parent().unwrap()).unwrap();
        let branch = repo.branch(actual_worktree_id, &commit, false).unwrap();

        let mut options = git2::WorktreeAddOptions::new();
        options.reference(Some(branch.get()));
        super::prepare_worktree_metadata_parent(&repo, actual_worktree_id).unwrap();
        repo.worktree(actual_worktree_id, &worktree_path, Some(&mut options))
            .unwrap();

        super::rollback_failed_worktree_add_attempt(
            &repo,
            rollback_lookup_id,
            &worktree_path,
            actual_worktree_id,
            true,
        )
        .unwrap();

        assert!(repo
            .find_branch(actual_worktree_id, BranchType::Local)
            .is_err());
        assert!(!worktree_path.exists());

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn list_local_branches_marks_checked_out_branch() {
        let temp_root = std::env::temp_dir().join(format!(
            "orkestra-worktrees-branch-list-tests-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let repo = seed_repo_with_initial_commit(&temp_root);
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/a", &head_commit, false).unwrap();

        let service = WorktreesService::new(temp_root.join("app-data"));
        let branches = service
            .list_local_branches_typed(&temp_root.display().to_string())
            .unwrap();
        let checked_out_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        assert!(branches
            .iter()
            .any(|branch| branch.name == checked_out_branch && branch.is_checked_out));
        assert!(branches
            .iter()
            .any(|branch| branch.name == "feature/a" && !branch.is_checked_out));

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn create_uses_selected_source_branch_without_switching_head() {
        let temp_root = std::env::temp_dir().join(format!(
            "orkestra-worktrees-create-source-branch-tests-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let repo_root = temp_root.join("repo");
        let repo = seed_repo_with_initial_commit(&repo_root);
        let checked_out_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let master_commit = repo.head().unwrap().peel_to_commit().unwrap();

        fs::write(repo_root.join("feature.txt"), "feature\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("feature.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        let feature_commit_id = repo
            .commit(
                Some("refs/heads/feature/source"),
                &signature,
                &signature,
                "feature commit",
                &tree,
                &[&master_commit],
            )
            .unwrap();

        let service = WorktreesService::new(temp_root.join("app-data"));
        let created = service
            .create_typed(CreateWorktreeRequest {
                project_key: "PRJ".to_string(),
                repo_path: repo_root.display().to_string(),
                branch_title: "Run branch".to_string(),
                source_branch: Some("feature/source".to_string()),
            })
            .unwrap();

        assert_eq!(created.source_branch.as_deref(), Some("feature/source"));
        assert_eq!(
            repo.head().unwrap().shorthand(),
            Some(checked_out_branch.as_str())
        );

        let linked_repo = Repository::open(&created.path).unwrap();
        let linked_head = linked_repo.head().unwrap();
        let linked_commit = linked_head.peel_to_commit().unwrap();
        assert_eq!(linked_commit.id(), feature_commit_id);

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn create_worktree_with_new_branch_rolls_back_branch_on_worktree_add_failure() {
        let temp_root = std::env::temp_dir().join(format!(
            "orkestra-worktrees-create-rollback-branch-tests-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let repo_root = temp_root.join("repo");
        let repo = seed_repo_with_initial_commit(&repo_root);
        let start_point = repo.head().unwrap().peel_to_commit().unwrap().id();

        let blocking_path = temp_root.join("blocking-file");
        fs::write(&blocking_path, "not a directory").unwrap();

        let worktree_id = "PRJ/failing-worktree";
        let invalid_worktree_path = blocking_path.join("child");

        let result = super::create_worktree_with_new_branch(
            &repo,
            worktree_id,
            &invalid_worktree_path,
            start_point,
        );

        assert!(result.is_err());
        assert!(repo.find_branch(worktree_id, BranchType::Local).is_err());

        let _ = fs::remove_dir_all(&temp_root);
    }

    fn seed_repo_with_initial_commit(repo_root: &Path) -> Repository {
        let repo = Repository::init(repo_root).unwrap();
        fs::write(repo_root.join("README.md"), "seed\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("orkestra", "orkestra@example.com").unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "initial commit",
            &tree,
            &[],
        )
        .unwrap();
        drop(tree);
        repo
    }
}
