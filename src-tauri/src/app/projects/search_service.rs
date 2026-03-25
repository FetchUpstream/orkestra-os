use crate::app::errors::AppError;
use crate::app::projects::dto::ProjectFileSearchResultDto;
use crate::app::projects::models::ProjectRepository;
use ignore::WalkBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::Utf32Str;
use nucleo_matcher::{Config, Matcher};
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
    result: ProjectFileSearchResultDto,
    score: u32,
    relative_path_depth: usize,
}

impl ProjectFileSearchService {
    pub fn new() -> Self {
        Self
    }

    pub async fn search_project_files(
        &self,
        repositories: Vec<ProjectRepository>,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<ProjectFileSearchResultDto>, AppError> {
        let normalized_query = Self::normalize_query(query);
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let max_results = Self::normalize_limit(limit);
        tokio::task::spawn_blocking(move || {
            Self::search_project_files_blocking(repositories, normalized_query, max_results)
        })
        .await
        .map_err(|_| AppError::validation("project file search failed"))?
    }

    fn search_project_files_blocking(
        repositories: Vec<ProjectRepository>,
        query: String,
        limit: usize,
    ) -> Result<Vec<ProjectFileSearchResultDto>, AppError> {
        let pattern = Pattern::parse(&query, CaseMatching::Ignore, Normalization::Smart);
        let mut matcher = PROJECT_FILE_MATCHER
            .lock()
            .map_err(|_| AppError::validation("project file matcher unavailable"))?;
        let mut buf = Vec::new();

        let mut candidates = Vec::new();
        for repository in repositories {
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
                .hidden(false)
                .follow_links(false)
                .build();

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

                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string();
                let basename_score =
                    pattern.score(Utf32Str::new(file_name.as_str(), &mut buf), &mut matcher);
                let relpath_score = pattern.score(
                    Utf32Str::new(normalized_relative_path.as_str(), &mut buf),
                    &mut matcher,
                );
                let repo_name_score = pattern.score(
                    Utf32Str::new(repository.name.as_str(), &mut buf),
                    &mut matcher,
                );

                if basename_score.is_none() && relpath_score.is_none() && repo_name_score.is_none()
                {
                    continue;
                }

                let score = (basename_score.unwrap_or(0) * 5)
                    + (relpath_score.unwrap_or(0) * 2)
                    + repo_name_score.unwrap_or(0);

                let relative_path_depth = normalized_relative_path.matches('/').count();
                candidates.push(FileSearchCandidate {
                    result: ProjectFileSearchResultDto {
                        repository_id: repository.id.clone(),
                        repository_name: repository.name.clone(),
                        relative_path: normalized_relative_path,
                        file_name,
                    },
                    score,
                    relative_path_depth,
                });
            }
        }

        candidates.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.relative_path_depth.cmp(&b.relative_path_depth))
                .then_with(|| {
                    a.result
                        .relative_path
                        .len()
                        .cmp(&b.result.relative_path.len())
                })
                .then_with(|| a.result.repository_name.cmp(&b.result.repository_name))
                .then_with(|| a.result.relative_path.cmp(&b.result.relative_path))
                .then_with(|| a.result.repository_id.cmp(&b.result.repository_id))
        });

        Ok(candidates
            .into_iter()
            .take(limit)
            .map(|candidate| candidate.result)
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
