use crate::app::errors::AppError;
use git2::{BranchType, Repository};
use std::path::{Component, Path, PathBuf};

const PROJECT_KEY_MIN_LEN: usize = 2;
const PROJECT_KEY_MAX_LEN: usize = 4;

pub fn sanitize_branch_segment(branch_title: &str) -> String {
    let mut slug = String::new();
    let mut in_separator = false;

    for ch in branch_title.chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            slug.push(ch);
            in_separator = false;
        } else if ch.is_ascii_uppercase() {
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

pub fn compose_worktree_id(project_key: &str, branch_segment: &str) -> String {
    format!("{project_key}/{branch_segment}")
}

pub fn validate_project_key_segment(project_key: &str) -> Result<(), AppError> {
    if project_key.is_empty() {
        return Err(AppError::validation("project_key is required"));
    }

    let len = project_key.len();
    if !(PROJECT_KEY_MIN_LEN..=PROJECT_KEY_MAX_LEN).contains(&len) {
        return Err(AppError::validation(format!(
            "project_key length must be {PROJECT_KEY_MIN_LEN} to {PROJECT_KEY_MAX_LEN}"
        )));
    }

    if !project_key
        .chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    {
        return Err(AppError::validation(
            "project_key must be uppercase alphanumeric",
        ));
    }

    Ok(())
}

pub fn validate_branch_segment(branch_segment: &str) -> Result<(), AppError> {
    if branch_segment.is_empty() {
        return Err(AppError::validation("worktree branch segment is required"));
    }

    if !branch_segment
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err(AppError::validation(
            "worktree branch segment must match [a-z0-9-]",
        ));
    }

    Ok(())
}

pub fn parse_worktree_id(worktree_id: &str) -> Result<(&str, &str), AppError> {
    let normalized_id = worktree_id.trim();
    if normalized_id.is_empty() {
        return Err(AppError::not_found("run worktree not found"));
    }

    let path = Path::new(normalized_id);
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::RootDir
            | Component::CurDir
            | Component::ParentDir
            | Component::Prefix(_) => {
                return Err(AppError::validation(
                    "worktree id must use exactly two normal path segments",
                ));
            }
        }
    }

    let mut parts = normalized_id.split('/');
    let project_key = parts.next().unwrap_or_default();
    let branch_segment = parts.next().unwrap_or_default();
    if parts.next().is_some() || project_key.is_empty() || branch_segment.is_empty() {
        return Err(AppError::validation(
            "worktree id must be '<PROJECT_KEY>/<branch-segment>'",
        ));
    }

    validate_project_key_segment(project_key)?;
    validate_branch_segment(branch_segment)?;

    Ok((project_key, branch_segment))
}

pub fn resolve_worktree_path(
    worktrees_root: &Path,
    worktree_id: &str,
) -> Result<PathBuf, AppError> {
    let _ = parse_worktree_id(worktree_id)?;
    let normalized_id = worktree_id.trim();

    let worktree_path = worktrees_root.join(normalized_id);
    if !worktree_path.exists() {
        return Err(AppError::not_found("run worktree path not found"));
    }

    let canonical_root = std::fs::canonicalize(worktrees_root).map_err(|err| {
        AppError::validation(format!(
            "failed to resolve worktrees root path '{}': {err}",
            worktrees_root.display()
        ))
    })?;
    let canonical_candidate = std::fs::canonicalize(&worktree_path).map_err(|err| {
        AppError::validation(format!(
            "failed to resolve worktree path '{}': {err}",
            worktree_path.display()
        ))
    })?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::validation(
            "resolved worktree path is outside worktrees root",
        ));
    }

    Ok(worktree_path)
}

pub fn choose_unique_worktree_id(
    base_root: &Path,
    project_key: &str,
    branch_slug: &str,
    repo: &Repository,
) -> String {
    let mut suffix = 1_usize;
    loop {
        let branch_segment = if suffix == 1 {
            branch_slug.to_string()
        } else {
            format!("{branch_slug}-{suffix}")
        };
        let candidate = compose_worktree_id(project_key, &branch_segment);
        let candidate_path = base_root.join(&candidate);
        let worktree_exists = repo.find_worktree(&candidate).is_ok();
        let branch_exists = repo.find_branch(&candidate, BranchType::Local).is_ok();
        if !candidate_path.exists() && !worktree_exists && !branch_exists {
            return candidate;
        }
        suffix += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        choose_unique_worktree_id, compose_worktree_id, parse_worktree_id, resolve_worktree_path,
        sanitize_branch_segment,
    };
    use git2::{Repository, Signature};
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
                std::env::temp_dir().join(format!("orkestra-pathing-tests-{}", Uuid::new_v4()));
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

    fn init_git_repo(path: &Path) -> Repository {
        fs::create_dir_all(path).unwrap();
        let repo = Repository::init(path).unwrap();
        let readme_path = path.join("README.md");
        fs::write(&readme_path, "seed\n").unwrap();

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

    #[test]
    fn sanitize_branch_segment_formats_ascii_groups() {
        assert_eq!(
            sanitize_branch_segment("  Fix Login --- Flow!!!  "),
            "fix-login-flow"
        );
        assert_eq!(sanitize_branch_segment("___"), "run");
        assert_eq!(sanitize_branch_segment("a__b--c"), "a-b-c");
    }

    #[test]
    fn compose_worktree_id_uses_project_key_and_branch_segment() {
        assert_eq!(compose_worktree_id("ALP", "fix-login"), "ALP/fix-login");
    }

    #[test]
    fn parse_worktree_id_rejects_traversal_absolute_and_legacy_shapes() {
        for invalid in [
            "",
            "   ",
            "../ALP/fix-login",
            "ALP/../fix-login",
            "/ALP/fix-login",
            "./ALP/fix-login",
            "ALP",
            "ALP/fix/login",
            "ALP_fix-login",
            "alp/fix-login",
            "ALP/Fix-Login",
            "ALP/fix_login",
        ] {
            assert!(
                parse_worktree_id(invalid).is_err(),
                "expected invalid worktree id: {invalid}"
            );
        }
    }

    #[test]
    fn resolve_worktree_path_rejects_path_outside_root_via_symlink() {
        let temp_dir = TempDir::new();
        let root = temp_dir.path().join("worktrees");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("ALP")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, root.join("ALP")).unwrap();

        let result = resolve_worktree_path(&root, "ALP/fix-login");
        assert!(result.is_err());
    }

    #[test]
    fn choose_unique_worktree_id_uses_deterministic_numeric_suffixes() {
        let temp_dir = TempDir::new();
        let repo = init_git_repo(&temp_dir.path().join("repo"));
        let root = temp_dir.path().join("worktrees");

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("ALP/fix-login", &head, false).unwrap();
        fs::create_dir_all(root.join("ALP/fix-login-2")).unwrap();

        let id = choose_unique_worktree_id(&root, "ALP", "fix-login", &repo);
        assert_eq!(id, "ALP/fix-login-3");
    }
}
