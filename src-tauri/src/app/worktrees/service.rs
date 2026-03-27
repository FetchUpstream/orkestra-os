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
use std::path::PathBuf;
use tracing::{info, warn};

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

            let branch = match repo.find_branch(&branch_name, BranchType::Local) {
                Ok(branch) => branch,
                Err(err) if err.code() == ErrorCode::NotFound => {
                    match repo.branch(&branch_name, &head_commit, false) {
                        Ok(branch) => branch,
                        Err(source) if is_retryable_worktree_conflict(&source) => {
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
                Err(source) if is_retryable_worktree_conflict(&source) => {
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

fn is_retryable_worktree_conflict(err: &Error) -> bool {
    if err.code() == ErrorCode::Exists {
        return true;
    }

    if err.class() != ErrorClass::Worktree {
        return false;
    }

    let message = err.message().to_ascii_lowercase();
    message.contains("already checked out")
        || message.contains("already exists")
        || message.contains("is already used")
}

#[cfg(test)]
mod tests {
    use super::WorktreesService;
    use crate::app::errors::AppError;
    use crate::app::worktrees::dto::CreateWorktreeRequest;
    use crate::app::worktrees::pathing::{compose_worktree_id, sanitize_branch_segment};
    use std::path::{Path, PathBuf};

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
}
