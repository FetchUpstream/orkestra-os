use crate::app::errors::AppError;
use crate::app::projects::models::ProjectRepository;
use ignore::WalkBuilder;
use nucleo::pattern::{CaseMatching, Normalization, Pattern};
use nucleo::{Config, Matcher, Utf32Str};
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static PROJECT_FILE_MATCHER: Lazy<Mutex<Matcher>> =
    Lazy::new(|| Mutex::new(Matcher::new(Config::DEFAULT)));

const DEFAULT_LIMIT: usize = 60;
const MAX_LIMIT: usize = 200;

#[derive(Clone, Debug, Default)]
pub struct ProjectFileSearchService;

#[derive(Debug)]
struct FileSearchCandidate {
    relative_path: String,
    score: u32,
    relative_path_depth: usize,
}

impl ProjectFileSearchService {
    pub fn new() -> Self {
        Self
    }

    pub async fn search_project_files(
        &self,
        repository: ProjectRepository,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<String>, AppError> {
        let normalized_query = Self::normalize_query(query);
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let max_results = Self::normalize_limit(limit);
        tokio::task::spawn_blocking(move || {
            Self::search_project_files_blocking(repository, normalized_query, max_results)
        })
        .await
        .map_err(|_| AppError::validation("project file search failed"))?
    }

    fn search_project_files_blocking(
        repository: ProjectRepository,
        query: String,
        limit: usize,
    ) -> Result<Vec<String>, AppError> {
        let pattern = Pattern::parse(&query, CaseMatching::Ignore, Normalization::Smart);
        let mut matcher = PROJECT_FILE_MATCHER
            .lock()
            .map_err(|_| AppError::validation("project file matcher unavailable"))?;
        let mut buf = Vec::new();

        let repo_root = PathBuf::from(&repository.repo_path);
        if !repo_root.exists() {
            return Err(AppError::validation(format!(
                "repository path does not exist for '{}'",
                repository.name
            )));
        }

        if !repo_root.is_dir() {
            return Err(AppError::validation(format!(
                "repository path is not a directory for '{}'",
                repository.name
            )));
        }

        let walker = WalkBuilder::new(&repo_root)
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .follow_links(false)
            .build();

        let mut candidates = Vec::new();
        for entry in walker {
            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            let Some(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }

            let Ok(relative_path) = path.strip_prefix(&repo_root) else {
                continue;
            };
            let normalized_relative_path = Self::normalize_relative_path(relative_path);
            if normalized_relative_path.is_empty() {
                continue;
            }

            let basename_score = pattern.score(
                Utf32Str::new(
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default(),
                    &mut buf,
                ),
                &mut matcher,
            );
            let relpath_score = pattern.score(
                Utf32Str::new(normalized_relative_path.as_str(), &mut buf),
                &mut matcher,
            );

            if basename_score.is_none() && relpath_score.is_none() {
                continue;
            }

            let score = (basename_score.unwrap_or(0) * 5) + (relpath_score.unwrap_or(0) * 2);

            let relative_path_depth = normalized_relative_path.matches('/').count();
            candidates.push(FileSearchCandidate {
                relative_path: normalized_relative_path,
                score,
                relative_path_depth,
            });
        }

        candidates.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.relative_path_depth.cmp(&b.relative_path_depth))
                .then_with(|| a.relative_path.len().cmp(&b.relative_path.len()))
                .then_with(|| a.relative_path.cmp(&b.relative_path))
        });

        Ok(candidates
            .into_iter()
            .take(limit)
            .map(|candidate| candidate.relative_path)
            .collect())
    }

    fn normalize_relative_path(path: &Path) -> String {
        path.components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    }

    fn normalize_query(query: &str) -> String {
        query
            .trim()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn normalize_limit(limit: Option<usize>) -> usize {
        let requested = limit.unwrap_or(DEFAULT_LIMIT);
        requested.clamp(1, MAX_LIMIT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_repository(name: &str, repo_path: String) -> ProjectRepository {
        ProjectRepository {
            id: format!("repo-{name}"),
            project_id: "project-1".to_string(),
            name: name.to_string(),
            repo_path,
            is_default: true,
            setup_script: None,
            cleanup_script: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn empty_query_returns_no_results() {
        let temp_root = std::env::temp_dir().join(format!("orkestra-search-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_root).unwrap();
        std::fs::write(temp_root.join("Cargo.toml"), "[package]").unwrap();

        let service = ProjectFileSearchService::new();
        let results = service
            .search_project_files(make_repository("main", temp_root.to_string_lossy().to_string()), "   ", Some(20))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn returns_relative_paths_and_excludes_directories() {
        let temp_root = std::env::temp_dir().join(format!("orkestra-search-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(temp_root.join("src/nested")).unwrap();
        std::fs::write(temp_root.join("src/main.rs"), "fn main() {}\n").unwrap();

        let service = ProjectFileSearchService::new();
        let results = service
            .search_project_files(
                make_repository("main", temp_root.to_string_lossy().to_string()),
                "src",
                Some(20),
            )
            .await
            .unwrap();

        assert!(results.iter().all(|path| !path.starts_with('/')));
        assert!(results.contains(&"src/main.rs".to_string()));
        assert!(!results.contains(&"src".to_string()));
        assert!(!results.contains(&"src/nested".to_string()));
    }

    #[tokio::test]
    async fn invalid_repository_path_fails_cleanly() {
        let service = ProjectFileSearchService::new();
        let missing_repo = make_repository(
            "missing",
            "/tmp/orkestra-search-nonexistent-repo".to_string(),
        );

        let result = service
            .search_project_files(missing_repo, "main", Some(20))
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .starts_with("repository path does not exist for"));
    }

    #[tokio::test]
    async fn non_directory_repository_path_fails_cleanly() {
        let temp_file = std::env::temp_dir().join(format!("orkestra-search-file-{}", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, "not a directory").unwrap();

        let service = ProjectFileSearchService::new();
        let result = service
            .search_project_files(
                make_repository("bad", temp_file.to_string_lossy().to_string()),
                "main",
                Some(20),
            )
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .starts_with("repository path is not a directory for"));
    }

    #[tokio::test]
    async fn search_is_scoped_to_selected_repository_only() {
        let base = std::env::temp_dir().join(format!("orkestra-search-{}", uuid::Uuid::new_v4()));
        let repo_a = base.join("repo-a");
        let repo_b = base.join("repo-b");
        std::fs::create_dir_all(&repo_a).unwrap();
        std::fs::create_dir_all(&repo_b).unwrap();
        std::fs::write(repo_a.join("alpha_only.txt"), "a").unwrap();
        std::fs::write(repo_b.join("beta_only.txt"), "b").unwrap();

        let service = ProjectFileSearchService::new();
        let results = service
            .search_project_files(
                make_repository("alpha", repo_a.to_string_lossy().to_string()),
                "beta_only",
                Some(20),
            )
            .await
            .unwrap();

        assert!(results.is_empty());
    }
}
