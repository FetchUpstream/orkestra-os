use crate::app::errors::AppError;
use crate::app::worktrees::dto::{
    CreateWorktreeRequest, CreateWorktreeResponse, RemoveWorktreeRequest,
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
        input.project_id = input.project_id.trim().to_string();
        input.repo_path = input.repo_path.trim().to_string();
        input.branch_title = input.branch_title.trim().to_string();

        if input.project_id.is_empty() {
            return Err(AppError::validation("project_id is required"));
        }
        if input.repo_path.is_empty() {
            return Err(AppError::validation("repo_path is required"));
        }

        let slug = Self::slugify_branch_title(&input.branch_title);
        let worktree_id = Self::generate_worktree_id(&slug);
        let worktree_path = self.base_root.join(&input.project_id).join(&worktree_id);

        std::fs::create_dir_all(
            worktree_path
                .parent()
                .ok_or_else(|| AppError::validation("invalid worktree path"))?,
        )
        .map_err(|err| {
            AppError::validation(format!("failed to create worktree parent directory: {err}"))
        })?;

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

        let branch_name = worktree_id.clone();
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

    fn generate_worktree_id(slug: &str) -> String {
        let random = uuid::Uuid::new_v4().simple().to_string();
        format!("ork/{slug}-{}", &random[..8])
    }

    fn slugify_branch_title(branch_title: &str) -> String {
        let mut slug = String::new();
        let mut in_separator = false;

        for ch in branch_title.chars() {
            if ch.is_ascii_alphanumeric() {
                slug.push(ch.to_ascii_lowercase());
                in_separator = false;
            } else if !slug.is_empty() && !in_separator {
                slug.push('-');
                in_separator = true;
            }
        }

        while slug.ends_with('-') {
            slug.pop();
        }

        if slug.is_empty() {
            "run".to_string()
        } else {
            slug
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WorktreesService;
    use std::path::{Path, PathBuf};

    #[test]
    fn slugify_branch_title_formats_ascii_groups() {
        assert_eq!(
            WorktreesService::slugify_branch_title("  Fix Login --- Flow!!!  "),
            "fix-login-flow"
        );
        assert_eq!(WorktreesService::slugify_branch_title("___"), "run");
        assert_eq!(WorktreesService::slugify_branch_title("a__b--c"), "a-b-c");
    }

    #[test]
    fn generate_worktree_id_uses_expected_format() {
        let id = WorktreesService::generate_worktree_id("feature");

        assert!(id.starts_with("ork/feature-"));
        assert_eq!(id.len(), "ork/feature-".len() + 8);
        assert!(id
            .chars()
            .skip("ork/feature-".len())
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn constructor_uses_app_data_worktrees_root() {
        let service = WorktreesService::new(PathBuf::from("/tmp/app-data"));
        assert_eq!(service.base_root, Path::new("/tmp/app-data/worktrees"));
    }
}
