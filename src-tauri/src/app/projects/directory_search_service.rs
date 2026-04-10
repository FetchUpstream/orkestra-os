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

use crate::app::projects::dto::LocalDirectorySearchResultDto;
use crate::app::projects::errors::DirectorySearchError;
use nucleo::pattern::{CaseMatching, Normalization, Pattern};
use nucleo::{Config, Matcher, Utf32Str};
use once_cell::sync::Lazy;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

static DIRECTORY_MATCHER: Lazy<Mutex<Matcher>> =
    Lazy::new(|| Mutex::new(Matcher::new(Config::DEFAULT)));

const DEFAULT_LIMIT: usize = 24;
const MAX_LIMIT: usize = 60;
const MAX_SCAN_DEPTH: usize = 5;
const MAX_INDEXED_DIRECTORIES: usize = 4_000;
const CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct LocalDirectorySearchService {
    roots: Vec<PathBuf>,
    cache: Arc<Mutex<Option<DirectoryIndexCache>>>,
    index_build_guard: Arc<Mutex<()>>,
    #[cfg(test)]
    build_index_calls: Arc<AtomicUsize>,
    #[cfg(test)]
    build_index_delay_ms: Arc<AtomicU64>,
}

#[derive(Clone, Debug)]
struct IndexedDirectory {
    path: String,
    directory_name: String,
    parent_path: String,
    depth: usize,
}

#[derive(Clone, Debug)]
struct DirectoryIndexCache {
    indexed_at: Instant,
    candidates: Vec<IndexedDirectory>,
}

#[derive(Clone, Debug)]
struct DirectorySearchCandidate {
    result: LocalDirectorySearchResultDto,
    score: u32,
    depth: usize,
}

impl LocalDirectorySearchService {
    pub fn new() -> Self {
        Self::new_with_roots(Self::default_roots())
    }

    pub fn new_with_roots(roots: Vec<PathBuf>) -> Self {
        Self {
            roots,
            cache: Arc::new(Mutex::new(None)),
            index_build_guard: Arc::new(Mutex::new(())),
            #[cfg(test)]
            build_index_calls: Arc::new(AtomicUsize::new(0)),
            #[cfg(test)]
            build_index_delay_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn search_directories(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<LocalDirectorySearchResultDto>, DirectorySearchError> {
        let service = self.clone();
        let normalized_query = Self::normalize_query(query);
        let max_results = Self::normalize_limit(limit);
        tokio::task::spawn_blocking(move || {
            service.search_directories_blocking(&normalized_query, max_results)
        })
        .await
        .map_err(|source| DirectorySearchError::TaskJoin { source })?
    }

    fn search_directories_blocking(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<LocalDirectorySearchResultDto>, DirectorySearchError> {
        let indexed = self.indexed_directories()?;
        if indexed.is_empty() {
            return Ok(Vec::new());
        }

        if query.is_empty() {
            let mut results = indexed
                .into_iter()
                .map(Self::to_search_result)
                .collect::<Vec<_>>();
            results.sort_by(|a, b| {
                a.path
                    .len()
                    .cmp(&b.path.len())
                    .then_with(|| a.path.cmp(&b.path))
            });
            results.truncate(limit);
            return Ok(results);
        }

        let pattern = Pattern::parse(query, CaseMatching::Ignore, Normalization::Smart);
        let mut matcher = DIRECTORY_MATCHER
            .lock()
            .map_err(|_| DirectorySearchError::MatcherUnavailable)?;
        let mut buf = Vec::new();
        let mut matches = Vec::new();

        for entry in indexed {
            let directory_name_score = pattern.score(
                Utf32Str::new(entry.directory_name.as_str(), &mut buf),
                &mut matcher,
            );
            let full_path_score =
                pattern.score(Utf32Str::new(entry.path.as_str(), &mut buf), &mut matcher);
            let parent_path_score = pattern.score(
                Utf32Str::new(entry.parent_path.as_str(), &mut buf),
                &mut matcher,
            );

            if directory_name_score.is_none()
                && full_path_score.is_none()
                && parent_path_score.is_none()
            {
                continue;
            }

            matches.push(DirectorySearchCandidate {
                result: Self::to_search_result(entry.clone()),
                score: (directory_name_score.unwrap_or(0) * 6)
                    + (full_path_score.unwrap_or(0) * 3)
                    + parent_path_score.unwrap_or(0),
                depth: entry.depth,
            });
        }

        matches.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.depth.cmp(&b.depth))
                .then_with(|| a.result.path.len().cmp(&b.result.path.len()))
                .then_with(|| a.result.path.cmp(&b.result.path))
        });

        Ok(matches
            .into_iter()
            .take(limit)
            .map(|candidate| candidate.result)
            .collect())
    }

    fn indexed_directories(&self) -> Result<Vec<IndexedDirectory>, DirectorySearchError> {
        if let Some(cached) = self.cached_candidates_if_fresh() {
            return Ok(cached);
        }

        let _index_build_guard = self
            .index_build_guard
            .lock()
            .map_err(|_| DirectorySearchError::MatcherUnavailable)?;

        if let Some(cached) = self.cached_candidates_if_fresh() {
            return Ok(cached);
        }

        let candidates = self.build_index();
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| DirectorySearchError::MatcherUnavailable)?;
        *cache = Some(DirectoryIndexCache {
            indexed_at: Instant::now(),
            candidates: candidates.clone(),
        });
        Ok(candidates)
    }

    fn cached_candidates_if_fresh(&self) -> Option<Vec<IndexedDirectory>> {
        let cache = self.cache.lock().ok()?;
        let cache = cache.as_ref()?;
        if cache.indexed_at.elapsed() <= CACHE_TTL {
            Some(cache.candidates.clone())
        } else {
            None
        }
    }

    fn build_index(&self) -> Vec<IndexedDirectory> {
        #[cfg(test)]
        {
            self.build_index_calls.fetch_add(1, Ordering::SeqCst);
            let delay_ms = self.build_index_delay_ms.load(Ordering::SeqCst);
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
        }

        let mut seen = HashSet::new();
        let mut indexed = Vec::new();
        let mut queue = VecDeque::new();
        let mut enqueued_directories = 0usize;

        for root in &self.roots {
            if !root.exists() || !root.is_dir() {
                continue;
            }

            if enqueued_directories >= MAX_INDEXED_DIRECTORIES {
                break;
            }

            queue.push_back((root.clone(), 0usize));
            enqueued_directories += 1;
        }

        while let Some((path, depth)) = queue.pop_front() {
            let key = path.to_string_lossy().into_owned();
            if !seen.insert(key.clone()) {
                continue;
            }

            if Self::is_git_repository_root(&path) {
                indexed.push(IndexedDirectory {
                    path: key,
                    directory_name: Self::directory_name(&path),
                    parent_path: Self::parent_path(&path),
                    depth,
                });
            }

            if depth >= MAX_SCAN_DEPTH {
                continue;
            }

            let Ok(entries) = fs::read_dir(&path) else {
                continue;
            };

            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }

                let child_path = entry.path();
                if Self::should_skip_directory(&child_path) {
                    continue;
                }

                if enqueued_directories >= MAX_INDEXED_DIRECTORIES {
                    break;
                }

                queue.push_back((child_path, depth + 1));
                enqueued_directories += 1;
            }
        }

        indexed.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.path.cmp(&b.path)));
        indexed
    }

    fn default_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        let Some(home_dir) = Self::resolve_home_dir() else {
            return roots;
        };

        for relative in [
            "code",
            "src",
            "dev",
            "development",
            "projects",
            "repos",
            "repositories",
            "workspace",
            "workspaces",
            "git",
            "Documents",
            "Desktop",
            "",
        ] {
            let candidate = if relative.is_empty() {
                home_dir.clone()
            } else {
                home_dir.join(relative)
            };
            if !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }

        roots
    }

    fn resolve_home_dir() -> Option<PathBuf> {
        Self::resolve_home_dir_for_platform(cfg!(windows), |key| std::env::var_os(key))
    }

    fn resolve_home_dir_for_platform<F>(is_windows: bool, mut get_env: F) -> Option<PathBuf>
    where
        F: FnMut(&str) -> Option<std::ffi::OsString>,
    {
        let home_dir = if is_windows {
            get_env("HOME")
                .or_else(|| get_env("USERPROFILE"))
                .or_else(|| match (get_env("HOMEDRIVE"), get_env("HOMEPATH")) {
                    (Some(mut drive), Some(path)) => {
                        drive.push(path);
                        Some(drive)
                    }
                    _ => None,
                })
        } else {
            get_env("HOME")
        };

        home_dir
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
    }

    fn should_skip_directory(path: &Path) -> bool {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with('.'))
            .unwrap_or(false)
    }

    fn is_git_repository_root(path: &Path) -> bool {
        path.join(".git").exists()
    }

    fn directory_name(path: &Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned())
    }

    fn parent_path(path: &Path) -> String {
        path.parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn normalize_query(query: &str) -> String {
        query
            .trim()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn normalize_limit(limit: Option<usize>) -> usize {
        limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
    }

    fn to_search_result(entry: IndexedDirectory) -> LocalDirectorySearchResultDto {
        LocalDirectorySearchResultDto {
            path: entry.path,
            directory_name: entry.directory_name,
            parent_path: entry.parent_path,
        }
    }

    #[cfg(test)]
    fn build_index_call_count(&self) -> usize {
        self.build_index_calls.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    fn set_build_index_test_delay(&self, delay: Duration) {
        self.build_index_delay_ms
            .store(delay.as_millis() as u64, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn matches_directory_name_and_parent_path() {
        let base =
            std::env::temp_dir().join(format!("orkestra-repo-search-{}", uuid::Uuid::new_v4()));
        let workspace_a = base.join("workspace-a");
        let workspace_b = base.join("workspace-b");
        let repo_a = workspace_a.join("orkestra-os");
        let repo_b = workspace_b.join("orkestra-os");
        std::fs::create_dir_all(repo_a.join(".git")).unwrap();
        std::fs::create_dir_all(repo_b.join(".git")).unwrap();

        let service = LocalDirectorySearchService::new_with_roots(vec![base]);
        let results = service
            .search_directories("orkestra-os", Some(10))
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|item| item.directory_name == "orkestra-os"));
        assert!(results
            .iter()
            .any(|item| item.parent_path.contains("workspace-a")));
        assert!(results
            .iter()
            .any(|item| item.parent_path.contains("workspace-b")));
    }

    #[tokio::test]
    async fn only_returns_git_repository_roots() {
        let base =
            std::env::temp_dir().join(format!("orkestra-repo-search-{}", uuid::Uuid::new_v4()));
        let repo = base.join("repo-root");
        let plain_dir = base.join("plain-directory");
        let nested_plain = repo.join("src");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(&plain_dir).unwrap();
        std::fs::create_dir_all(&nested_plain).unwrap();

        let service = LocalDirectorySearchService::new_with_roots(vec![base]);
        let results = service.search_directories("repo", Some(10)).await.unwrap();

        assert!(results.iter().any(|item| item.path.ends_with("repo-root")));
        assert!(!results
            .iter()
            .any(|item| item.path.ends_with("plain-directory")));
        assert!(!results.iter().any(|item| item.path.ends_with("src")));
    }

    #[test]
    fn resolves_windows_home_from_userprofile_when_home_is_unset() {
        let home_dir =
            LocalDirectorySearchService::resolve_home_dir_for_platform(true, |key| match key {
                "HOME" => None,
                "USERPROFILE" => Some(r"C:\Users\orkestra".into()),
                _ => None,
            });

        assert_eq!(home_dir, Some(PathBuf::from(r"C:\Users\orkestra")));
    }

    #[test]
    fn resolves_windows_home_from_home_drive_and_path_when_needed() {
        let home_dir =
            LocalDirectorySearchService::resolve_home_dir_for_platform(true, |key| match key {
                "HOME" | "USERPROFILE" => None,
                "HOMEDRIVE" => Some("C:".into()),
                "HOMEPATH" => Some(r"\Users\orkestra".into()),
                _ => None,
            });

        assert_eq!(home_dir, Some(PathBuf::from(r"C:\Users\orkestra")));
    }

    #[test]
    fn traversal_budget_limits_enqueued_roots() {
        let base = std::env::temp_dir().join(format!(
            "orkestra-repo-search-enqueue-budget-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&base).unwrap();

        let mut roots = Vec::new();
        for index in 0..=MAX_INDEXED_DIRECTORIES {
            let root = base.join(format!("plain-{index}"));
            std::fs::create_dir_all(&root).unwrap();
            roots.push(root);
        }

        let repo_root = base.join("target-repo");
        std::fs::create_dir_all(repo_root.join(".git")).unwrap();
        roots.push(repo_root.clone());

        let service = LocalDirectorySearchService::new_with_roots(roots);
        let indexed = service.build_index();

        assert!(indexed
            .iter()
            .all(|entry| entry.path != repo_root.to_string_lossy()));
    }

    #[tokio::test]
    async fn concurrent_callers_share_single_cold_cache_build() {
        let base = std::env::temp_dir().join(format!(
            "orkestra-repo-search-concurrent-build-{}",
            uuid::Uuid::new_v4()
        ));
        let repo = base.join("repo-root");
        std::fs::create_dir_all(repo.join(".git")).unwrap();

        let service = LocalDirectorySearchService::new_with_roots(vec![base]);
        service.set_build_index_test_delay(Duration::from_millis(120));

        let mut handles = Vec::new();
        for _ in 0..8 {
            let service = service.clone();
            handles.push(tokio::spawn(async move {
                service.search_directories("repo", Some(10)).await
            }));
        }

        for handle in handles {
            let result = handle.await.unwrap().unwrap();
            assert!(result.iter().any(|entry| entry.path.ends_with("repo-root")));
        }

        assert_eq!(service.build_index_call_count(), 1);
    }
}
