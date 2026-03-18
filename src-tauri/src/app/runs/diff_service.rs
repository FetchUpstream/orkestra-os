use crate::app::errors::AppError;
use crate::app::runs::dto::{RunDiffFileDto, RunDiffFilePayloadDto, RunDiffUpdatedEventDto};
use crate::app::runs::service::RunsService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use git2::{Commit, Delta, Diff, DiffDelta, DiffOptions, Repository, Tree};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, NoCache};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const RUN_DIFF_EVENT: &str = "run-diff-updated";
const MAX_TEXT_BYTES: usize = 500_000;

type ActiveDebouncer = Debouncer<notify::RecommendedWatcher, NoCache>;

#[derive(Clone)]
pub struct RunsDiffService {
    runs_service: RunsService,
    worktrees_root: PathBuf,
    watchers: Arc<Mutex<HashMap<String, ActiveDebouncer>>>,
}

impl std::fmt::Debug for RunsDiffService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunsDiffService")
            .field("worktrees_root", &self.worktrees_root)
            .finish_non_exhaustive()
    }
}

impl RunsDiffService {
    pub fn new(runs_service: RunsService, app_data_dir: PathBuf) -> Self {
        Self {
            runs_service,
            worktrees_root: app_data_dir.join("worktrees"),
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn list_run_diff_files(&self, run_id: &str) -> Result<Vec<RunDiffFileDto>, AppError> {
        let run = self.runs_service.get_run(run_id).await?;
        let worktree_path = self.resolve_worktree_path(&run)?;
        let repo = self.open_repository(&worktree_path)?;
        let baseline_tree = Self::resolve_baseline_tree(&repo, run.source_branch.as_deref())?;
        let diff = Self::build_workdir_diff(&repo, &baseline_tree)?;
        let counts = Self::line_counts_by_path(&diff);

        let mut files = Vec::new();
        for delta in diff.deltas() {
            let path = Self::delta_path(&delta)
                .ok_or_else(|| AppError::validation("failed to resolve changed file path"))?;
            let (additions, deletions) = counts.get(&path).copied().unwrap_or((0, 0));
            files.push(RunDiffFileDto {
                path,
                additions,
                deletions,
                status: Self::status_to_string(delta.status()).to_string(),
            });
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(files)
    }

    pub async fn get_run_diff_file(
        &self,
        run_id: &str,
        path: &str,
    ) -> Result<RunDiffFilePayloadDto, AppError> {
        let normalized_path = path.trim();
        if normalized_path.is_empty() {
            return Err(AppError::validation("path is required"));
        }

        let run = self.runs_service.get_run(run_id).await?;
        let worktree_path = self.resolve_worktree_path(&run)?;
        let repo = self.open_repository(&worktree_path)?;
        let baseline_tree = Self::resolve_baseline_tree(&repo, run.source_branch.as_deref())?;
        let diff = Self::build_workdir_diff(&repo, &baseline_tree)?;
        let counts = Self::line_counts_by_path(&diff);

        let delta = diff
            .deltas()
            .find(|delta| Self::delta_path(delta).as_deref() == Some(normalized_path))
            .ok_or_else(|| AppError::not_found("diff file not found"))?;

        let status = Self::status_to_string(delta.status()).to_string();
        let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();
        let old_path = delta.old_file().path();
        let new_path = delta.new_file().path();
        let original = if delta.status() == Delta::Added {
            String::new()
        } else {
            Self::read_tree_blob_text(&repo, &baseline_tree, old_path)?
        };
        let modified = if delta.status() == Delta::Deleted {
            String::new()
        } else {
            Self::read_worktree_text(&worktree_path, new_path)?
        };
        let language = Self::language_from_path(normalized_path).to_string();
        let (additions, deletions) = counts.get(normalized_path).copied().unwrap_or((0, 0));
        let (original, original_truncated) = Self::truncate_text(original);
        let (modified, modified_truncated) = Self::truncate_text(modified);

        Ok(RunDiffFilePayloadDto {
            path: normalized_path.to_string(),
            additions,
            deletions,
            original,
            modified,
            language,
            status,
            is_binary,
            truncated: original_truncated || modified_truncated,
        })
    }

    pub async fn set_run_diff_watch(
        &self,
        app_handle: &tauri::AppHandle,
        window: &tauri::Window,
        run_id: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        let normalized_run_id = run_id.trim();
        if normalized_run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let key = format!("{}:{normalized_run_id}", window.label());

        if !enabled {
            let mut watchers = self
                .watchers
                .lock()
                .map_err(|_| AppError::validation("failed to lock run diff watcher registry"))?;
            watchers.remove(&key);
            return Ok(());
        }

        let has_existing = self
            .watchers
            .lock()
            .map_err(|_| AppError::validation("failed to lock run diff watcher registry"))?
            .contains_key(&key);
        if has_existing {
            return Ok(());
        }

        let run = self.runs_service.get_run(normalized_run_id).await?;
        let worktree_path = self.resolve_worktree_path(&run)?;
        let app_handle = app_handle.clone();
        let payload = RunDiffUpdatedEventDto {
            run_id: run.id.clone(),
        };

        let mut debouncer = new_debouncer(
            Duration::from_millis(300),
            None,
            move |result: DebounceEventResult| {
                if result.is_ok() {
                    let _ = app_handle.emit(RUN_DIFF_EVENT, payload.clone());
                }
            },
        )
        .map_err(|err| AppError::validation(format!("failed to create watcher: {err}")))?;

        debouncer
            .watch(&worktree_path, RecursiveMode::Recursive)
            .map_err(|err| AppError::validation(format!("failed to watch worktree path: {err}")))?;

        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| AppError::validation("failed to lock run diff watcher registry"))?;
        watchers.insert(key, debouncer);
        Ok(())
    }

    fn resolve_worktree_path(
        &self,
        run: &crate::app::runs::dto::RunDto,
    ) -> Result<PathBuf, AppError> {
        let worktree_id = run
            .worktree_id
            .as_deref()
            .ok_or_else(|| AppError::not_found("run worktree not found"))?
            .trim();
        resolve_worktree_path(&self.worktrees_root, worktree_id)
    }

    fn open_repository(&self, worktree_path: &Path) -> Result<Repository, AppError> {
        Repository::open(worktree_path).map_err(|err| {
            AppError::validation(format!("failed to open worktree repository: {err}"))
        })
    }

    fn build_workdir_diff<'repo>(
        repo: &'repo Repository,
        baseline_tree: &Tree<'repo>,
    ) -> Result<Diff<'repo>, AppError> {
        let mut options = DiffOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_typechange(true)
            .include_unmodified(false);
        repo.diff_tree_to_workdir_with_index(Some(baseline_tree), Some(&mut options))
            .map_err(|err| AppError::validation(format!("failed to build git diff: {err}")))
    }

    fn resolve_baseline_tree<'repo>(
        repo: &'repo Repository,
        source_branch: Option<&str>,
    ) -> Result<Tree<'repo>, AppError> {
        let head_commit = Self::head_commit(repo)?;
        let head_tree = head_commit
            .tree()
            .map_err(|err| AppError::validation(format!("failed to resolve HEAD tree: {err}")))?;

        let resolve_merge_base_tree = |base_commit: Commit<'repo>| -> Option<Tree<'repo>> {
            let merge_base_oid = match repo.merge_base(base_commit.id(), head_commit.id()) {
                Ok(oid) => oid,
                Err(err) => {
                    eprintln!(
                        "[RunsDiffService] failed to resolve merge-base for '{}': {err}",
                        Self::describe_commit_reference(repo, base_commit.id())
                    );
                    return None;
                }
            };

            let merge_base_commit = match repo.find_commit(merge_base_oid) {
                Ok(commit) => commit,
                Err(err) => {
                    eprintln!(
                        "[RunsDiffService] failed to load merge-base commit for '{}': {err}",
                        Self::describe_commit_reference(repo, base_commit.id())
                    );
                    return None;
                }
            };

            match merge_base_commit.tree() {
                Ok(tree) => Some(tree),
                Err(err) => {
                    eprintln!(
                        "[RunsDiffService] failed to resolve merge-base tree for '{}': {err}",
                        Self::describe_commit_reference(repo, base_commit.id())
                    );
                    None
                }
            }
        };

        if let Some(source_branch) = source_branch
            .map(str::trim)
            .filter(|branch| !branch.is_empty())
        {
            if let Some(source_commit) = Self::resolve_source_commit(repo, source_branch) {
                if let Some(tree) = resolve_merge_base_tree(source_commit) {
                    return Ok(tree);
                }
            } else {
                eprintln!(
                    "[RunsDiffService] failed to resolve source branch '{source_branch}', trying default branch fallback"
                );
            }
        }

        if let Some(default_commit) = Self::resolve_default_branch_commit(repo) {
            if let Some(tree) = resolve_merge_base_tree(default_commit) {
                return Ok(tree);
            }
        }

        Ok(head_tree)
    }

    fn head_commit<'repo>(repo: &'repo Repository) -> Result<Commit<'repo>, AppError> {
        repo.head()
            .and_then(|head| head.peel_to_commit())
            .map_err(|err| AppError::validation(format!("failed to resolve HEAD commit: {err}")))
    }

    fn resolve_source_commit<'repo>(
        repo: &'repo Repository,
        source_branch: &str,
    ) -> Option<Commit<'repo>> {
        let candidates = [
            source_branch.to_string(),
            format!("refs/heads/{source_branch}"),
            format!("refs/remotes/{source_branch}"),
            format!("refs/remotes/origin/{source_branch}"),
            format!("origin/{source_branch}"),
        ];

        for candidate in candidates {
            if let Ok(obj) = repo.revparse_single(&candidate) {
                if let Ok(commit) = obj.peel_to_commit() {
                    return Some(commit);
                }
            }
        }

        None
    }

    fn resolve_default_branch_commit<'repo>(repo: &'repo Repository) -> Option<Commit<'repo>> {
        if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
            if let Some(symbolic_target) = reference.symbolic_target() {
                if let Ok(obj) = repo.revparse_single(symbolic_target) {
                    if let Ok(commit) = obj.peel_to_commit() {
                        return Some(commit);
                    }
                }
            }
        }

        let fallback_refs = [
            "refs/heads/main",
            "refs/remotes/origin/main",
            "refs/heads/master",
            "refs/remotes/origin/master",
        ];

        for reference in fallback_refs {
            if let Ok(obj) = repo.revparse_single(reference) {
                if let Ok(commit) = obj.peel_to_commit() {
                    return Some(commit);
                }
            }
        }

        None
    }

    fn describe_commit_reference(repo: &Repository, oid: git2::Oid) -> String {
        if let Ok(names) = repo.references() {
            for reference in names.flatten() {
                if reference.target() == Some(oid) {
                    if let Some(name) = reference.name() {
                        return name.to_string();
                    }
                }
            }
        }

        oid.to_string()
    }

    fn line_counts_by_path(diff: &Diff<'_>) -> HashMap<String, (usize, usize)> {
        let mut counts = HashMap::<String, (usize, usize)>::new();
        let _ = diff.foreach(
            &mut |_delta, _progress| true,
            None,
            None,
            Some(&mut |delta, _hunk, line| {
                if let Some(path) = Self::delta_path(&delta) {
                    let entry = counts.entry(path).or_insert((0, 0));
                    match line.origin() {
                        '+' => entry.0 += 1,
                        '-' => entry.1 += 1,
                        _ => {}
                    }
                }
                true
            }),
        );
        counts
    }

    fn delta_path(delta: &DiffDelta<'_>) -> Option<String> {
        delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|path| path.to_string_lossy().to_string())
    }

    fn read_tree_blob_text(
        repo: &Repository,
        tree: &Tree<'_>,
        path: Option<&Path>,
    ) -> Result<String, AppError> {
        let Some(path) = path else {
            return Ok(String::new());
        };

        let Ok(entry) = tree.get_path(path) else {
            return Ok(String::new());
        };
        let blob = repo
            .find_blob(entry.id())
            .map_err(|err| AppError::validation(format!("failed to read baseline blob: {err}")))?;
        Ok(String::from_utf8_lossy(blob.content()).to_string())
    }

    fn read_worktree_text(root: &Path, path: Option<&Path>) -> Result<String, AppError> {
        let Some(path) = path else {
            return Ok(String::new());
        };
        let absolute_path = root.join(path);
        match std::fs::read(&absolute_path) {
            Ok(content) => Ok(String::from_utf8_lossy(&content).to_string()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(err) => Err(AppError::validation(format!(
                "failed to read worktree file '{}': {err}",
                absolute_path.display()
            ))),
        }
    }

    fn status_to_string(status: Delta) -> &'static str {
        match status {
            Delta::Added => "added",
            Delta::Deleted => "deleted",
            Delta::Modified => "modified",
            Delta::Renamed => "renamed",
            Delta::Copied => "copied",
            Delta::Typechange => "typechange",
            Delta::Untracked => "untracked",
            _ => "modified",
        }
    }

    fn language_from_path(path: &str) -> &'static str {
        let extension = Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        match extension.as_str() {
            "ts" => "typescript",
            "tsx" => "typescript",
            "js" => "javascript",
            "jsx" => "javascript",
            "rs" => "rust",
            "json" => "json",
            "md" => "markdown",
            "css" => "css",
            "html" => "html",
            "yml" | "yaml" => "yaml",
            "toml" => "toml",
            _ => "plaintext",
        }
    }

    fn truncate_text(text: String) -> (String, bool) {
        if text.len() <= MAX_TEXT_BYTES {
            return (text, false);
        }
        let mut end = MAX_TEXT_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        (text[..end].to_string(), true)
    }
}
