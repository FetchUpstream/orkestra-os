use crate::app::errors::AppError;
use crate::app::worktrees::dto::{
    CreateWorktreeRequest, CreateWorktreeResponse, RemoveWorktreeRequest,
};
use crate::app::worktrees::pathing::{
    choose_unique_worktree_id, parse_worktree_id, sanitize_branch_segment,
    validate_project_key_segment,
};
use git2::{BranchType, ErrorCode, Repository, WorktreeAddOptions, WorktreePruneOptions};
use std::path::PathBuf;

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

    pub fn create(
        &self,
        mut input: CreateWorktreeRequest,
    ) -> Result<CreateWorktreeResponse, AppError> {
        input.project_key = input.project_key.trim().to_string();
        input.repo_path = input.repo_path.trim().to_string();
        input.branch_title = input.branch_title.trim().to_string();

        if input.project_key.is_empty() {
            return Err(AppError::validation("project_key is required"));
        }
        validate_project_key_segment(&input.project_key)?;
        if input.repo_path.is_empty() {
            return Err(AppError::validation("repo_path is required"));
        }

        let repo = Repository::open(&input.repo_path)
            .map_err(|err| AppError::validation(format!("failed to open repository: {err}")))?;
        if repo.is_bare() {
            return Err(AppError::validation("repository must not be bare"));
        }

        let head = repo.head().map_err(|err| {
            AppError::validation(format!("failed to resolve HEAD reference: {err}"))
        })?;
        let source_branch = if head.is_branch() {
            head.shorthand().map(str::to_string)
        } else {
            None
        };
        let head_commit = head
            .peel_to_commit()
            .map_err(|err| AppError::validation(format!("failed to resolve HEAD commit: {err}")))?;

        let branch_slug = sanitize_branch_segment(&input.branch_title);
        let worktree_id =
            choose_unique_worktree_id(&self.base_root, &input.project_key, &branch_slug, &repo);
        let branch_name = worktree_id.clone();
        let worktree_path = self.base_root.join(&worktree_id);
        std::fs::create_dir_all(
            worktree_path
                .parent()
                .ok_or_else(|| AppError::validation("invalid worktree path"))?,
        )
        .map_err(|err| {
            AppError::validation(format!("failed to create worktree parent directory: {err}"))
        })?;

        let branch = match repo.find_branch(&branch_name, BranchType::Local) {
            Ok(branch) => branch,
            Err(err) if err.code() == ErrorCode::NotFound => repo
                .branch(&branch_name, &head_commit, false)
                .map_err(|err| AppError::validation(format!("failed to create branch: {err}")))?,
            Err(err) => {
                return Err(AppError::validation(format!(
                    "failed to lookup branch: {err}"
                )));
            }
        };

        let mut options = WorktreeAddOptions::new();
        options.reference(Some(branch.get()));

        let metadata_parent = repo.path().join("worktrees").join(
            PathBuf::from(&worktree_id)
                .parent()
                .ok_or_else(|| AppError::validation("invalid worktree id"))?,
        );
        std::fs::create_dir_all(&metadata_parent).map_err(|err| {
            AppError::validation(format!(
                "failed to prepare worktree metadata directory: {err}"
            ))
        })?;

        repo.worktree(&worktree_id, &worktree_path, Some(&mut options))
            .map_err(|err| {
                AppError::validation(format!("failed to create worktree '{worktree_id}': {err}"))
            })?;

        Ok(CreateWorktreeResponse {
            worktree_id,
            branch_name,
            source_branch,
            path: worktree_path.to_string_lossy().to_string(),
        })
    }

    pub fn remove(&self, mut input: RemoveWorktreeRequest) -> Result<(), AppError> {
        input.repo_path = input.repo_path.trim().to_string();
        input.worktree_id = input.worktree_id.trim().to_string();

        if input.repo_path.is_empty() {
            return Err(AppError::validation("repo_path is required"));
        }
        if input.worktree_id.is_empty() {
            return Err(AppError::validation("worktree_id is required"));
        }

        let repo = Repository::open(&input.repo_path)
            .map_err(|err| AppError::validation(format!("failed to open repository: {err}")))?;
        let worktree = repo.find_worktree(&input.worktree_id).map_err(|err| {
            AppError::not_found(format!("worktree '{}' not found: {err}", input.worktree_id))
        })?;

        let mut prune_options = WorktreePruneOptions::new();
        prune_options.working_tree(true).valid(true).locked(true);
        worktree
            .prune(Some(&mut prune_options))
            .map_err(|err| AppError::validation(format!("failed to prune worktree: {err}")))?;

        Ok(())
    }

    pub fn remove_project_artifacts(
        &self,
        project_key: &str,
        worktree_ids: &[String],
    ) -> Result<(), AppError> {
        let project_key = project_key.trim();
        validate_project_key_segment(project_key)?;

        for worktree_id in worktree_ids {
            let (parsed_project_key, _) = parse_worktree_id(worktree_id)?;

            let worktree_path = self.base_root.join(worktree_id.trim());
            if !worktree_path.exists() {
                continue;
            }
            std::fs::remove_dir_all(&worktree_path).map_err(|err| {
                AppError::validation(format!(
                    "failed to remove worktree directory '{}': {err}",
                    worktree_path.display()
                ))
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
            std::fs::remove_dir_all(&project_root).map_err(|err| {
                AppError::validation(format!(
                    "failed to remove project worktree root '{}': {err}",
                    project_root.display()
                ))
            })?;
        }

        Ok(())
    }

    #[cfg(test)]
    pub fn base_root_for_tests(&self) -> &PathBuf {
        &self.base_root
    }
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
