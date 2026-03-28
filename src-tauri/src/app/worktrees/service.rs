use crate::app::errors::AppError;
use crate::app::worktrees::dto::{
    CreateWorktreeRequest, CreateWorktreeResponse, RemoveWorktreeRequest,
};
use crate::app::worktrees::error::WorktreesServiceError;
use crate::app::worktrees::pathing::{
    choose_unique_worktree_id, parse_worktree_id_typed, sanitize_branch_segment,
    validate_project_key_segment_typed,
};
use git2::{
    BranchType, Error, ErrorClass, ErrorCode, Repository, WorktreeAddOptions, WorktreePruneOptions,
};
use std::io::ErrorKind;
use std::path::PathBuf;
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

        validate_project_key_segment_typed(&input.project_key)?;
        if input.repo_path.is_empty() {
            return Err(WorktreesServiceError::RepoPathRequired);
        }

        info!(
            subsystem = "worktrees",
            operation = "create",
            project_key = input.project_key.as_str(),
            branch_title = input.branch_title.as_str(),
            "Creating worktree"
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

            let mut branch_created_in_attempt = false;
            let branch = match repo.find_branch(&branch_name, BranchType::Local) {
                Ok(branch) => branch,
                Err(err) if err.code() == ErrorCode::NotFound => {
                    match repo.branch(&branch_name, &head_commit, false) {
                        Ok(branch) => {
                            branch_created_in_attempt = true;
                            branch
                        }
                        Err(source) if is_retryable_branch_create_conflict(&source) => {
                            warn!(
                                subsystem = "worktrees",
                                operation = "create",
                                project_key = input.project_key.as_str(),
                                branch_name = branch_name.as_str(),
                                attempt = attempt + 1,
                                "Retrying worktree create after branch conflict"
                            );
                            continue;
                        }
                        Err(source) => {
                            return Err(WorktreesServiceError::CreateBranch {
                                branch_name: branch_name.clone(),
                                source,
                            });
                        }
                    }
                }
                Err(err) => {
                    return Err(WorktreesServiceError::LookupBranch {
                        branch_name: branch_name.clone(),
                        source: err,
                    });
                }
            };

            let mut options = WorktreeAddOptions::new();
            options.reference(Some(branch.get()));

            let metadata_parent = repo.path().join("worktrees").join(
                PathBuf::from(&worktree_id)
                    .parent()
                    .ok_or(WorktreesServiceError::InvalidWorktreeId)?,
            );
            std::fs::create_dir_all(&metadata_parent).map_err(|source| {
                WorktreesServiceError::PrepareWorktreeMetadataDir {
                    path: metadata_parent.display().to_string(),
                    source,
                }
            })?;

            match repo.worktree(&worktree_id, &worktree_path, Some(&mut options)) {
                Ok(_) => {
                    info!(
                        subsystem = "worktrees",
                        operation = "create",
                        project_key = input.project_key.as_str(),
                        worktree_id = worktree_id.as_str(),
                        branch_name = branch_name.as_str(),
                        source_branch = source_branch.as_deref().unwrap_or("<none>"),
                        "Created worktree"
                    );
                    return Ok(CreateWorktreeResponse {
                        worktree_id,
                        branch_name,
                        source_branch,
                        path: worktree_path.to_string_lossy().to_string(),
                    });
                }
                Err(source) if is_retryable_worktree_add_conflict(&source) => {
                    if let Err(rollback_err) = rollback_failed_worktree_add_attempt(
                        &repo,
                        &worktree_id,
                        &worktree_path,
                        &branch_name,
                        branch_created_in_attempt,
                    ) {
                        return Err(WorktreesServiceError::CreateWorktree {
                            worktree_id,
                            source: Error::from_str(&format!(
                                "worktree creation rollback failed after conflict: {}",
                                rollback_err.message()
                            )),
                        });
                    }
                    warn!(
                        subsystem = "worktrees",
                        operation = "create",
                        project_key = input.project_key.as_str(),
                        worktree_id = worktree_id.as_str(),
                        attempt = attempt + 1,
                        "Retrying worktree create after metadata conflict"
                    );
                    continue;
                }
                Err(source) => {
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
            worktree_id = input.worktree_id.as_str(),
            "Removing worktree"
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
            worktree_id = input.worktree_id.as_str(),
            "Removed worktree"
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

fn is_retryable_branch_create_conflict(err: &Error) -> bool {
    err.code() == ErrorCode::Exists
}

fn is_retryable_worktree_add_conflict(err: &Error) -> bool {
    if err.class() != ErrorClass::Worktree {
        return false;
    }

    if err.code() == ErrorCode::Exists {
        let message = err.message().to_ascii_lowercase();
        return message.contains("already checked out")
            || message.contains("already exists")
            || message.contains("is already used")
            || message.contains("already registered");
    }

    let message = err.message().to_ascii_lowercase();
    message.contains("already checked out")
        || message.contains("already exists")
        || message.contains("is already used")
}

fn cleanup_newly_created_branch(repo: &Repository, branch_name: &str) -> Result<(), Error> {
    match repo.find_branch(branch_name, BranchType::Local) {
        Ok(mut branch) => branch.delete(),
        Err(err) if err.code() == ErrorCode::NotFound => Ok(()),
        Err(err) => Err(err),
    }
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

    debug!(
        subsystem = "worktrees",
        operation = "create_rollback",
        worktree_id,
        branch_name,
        metadata_found_after = metadata_path.exists(),
        worktree_dir_exists_after = worktree_path.exists(),
        "Completed rollback after worktree add conflict"
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
        assert!(!super::is_retryable_worktree_add_conflict(
            &non_worktree_exists
        ));

        let worktree_exists = git2::Error::new(
            ErrorCode::Exists,
            ErrorClass::Worktree,
            "worktree already exists",
        );
        assert!(super::is_retryable_worktree_add_conflict(&worktree_exists));
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
}
