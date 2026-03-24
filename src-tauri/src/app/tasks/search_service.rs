use crate::app::db::repositories::task_search::{TaskSearchCandidate, TaskSearchRepository};
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::tasks::dto::TaskDto;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::Utf32Str;
use nucleo_matcher::{Config, Matcher};
use once_cell::sync::Lazy;
use std::cmp::Ordering;
use std::sync::Mutex;

static TASK_QUERY_MATCHER: Lazy<Mutex<Matcher>> =
    Lazy::new(|| Mutex::new(Matcher::new(Config::DEFAULT)));

const MAX_CANDIDATES: i64 = 160;
const MAX_RESULTS: usize = 60;
const FALLBACK_TOP_SCORE_RATIO_CUTOFF: f32 = 0.72;
const FALLBACK_MIN_SCORE: u32 = 70;

#[derive(Clone, Debug)]
pub struct TaskSearchService {
    tasks_repository: TasksRepository,
    repository: TaskSearchRepository,
}

#[derive(Clone, Debug)]
struct RankedCandidate {
    task_id: String,
    rank_score: u32,
    fts_rank: f64,
}

impl TaskSearchService {
    pub fn new(tasks_repository: TasksRepository, repository: TaskSearchRepository) -> Self {
        Self {
            tasks_repository,
            repository,
        }
    }

    pub async fn search_project_tasks(
        &self,
        project_id: &str,
        query: &str,
    ) -> Result<Vec<TaskDto>, AppError> {
        if !self.tasks_repository.project_exists(project_id).await? {
            return Err(AppError::not_found("project not found"));
        }

        let normalized_query = Self::normalize_query(query);
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let fts_query = Self::build_fts_query(&normalized_query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let strict_candidates = self
            .repository
            .list_project_candidates(project_id, &fts_query, MAX_CANDIDATES)
            .await?;
        let (candidates, used_fallback) = if strict_candidates.is_empty() {
            let relaxed_fts_query = Self::build_relaxed_fts_query(&normalized_query);
            if relaxed_fts_query.is_empty() {
                return Ok(Vec::new());
            }

            (
                self.repository
                    .list_project_candidates(project_id, &relaxed_fts_query, MAX_CANDIDATES)
                    .await?,
                true,
            )
        } else {
            (strict_candidates, false)
        };
        if candidates.is_empty() {
            return Ok(Vec::new());
        }

        let ranked = Self::rerank_candidates(&normalized_query, candidates, used_fallback)?;
        let mut results = Vec::new();
        for candidate in ranked.into_iter().take(MAX_RESULTS) {
            if let Some(task) = self.tasks_repository.get_task(&candidate.task_id).await? {
                results.push(TaskDto {
                    id: task.id,
                    project_id: task.project_id,
                    repository_id: task.repository_id,
                    task_number: task.task_number,
                    display_key: task.display_key,
                    title: task.title,
                    description: task.description,
                    implementation_guide: task.implementation_guide,
                    status: task.status,
                    blocked_by_count: task.blocked_by_count,
                    is_blocked: task.is_blocked,
                    target_repository_name: task.target_repository_name,
                    target_repository_path: task.target_repository_path,
                    created_at: task.created_at,
                    updated_at: task.updated_at,
                });
            }
        }

        Ok(results)
    }

    fn normalize_query(query: &str) -> String {
        query
            .trim()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn build_fts_query(normalized_query: &str) -> String {
        normalized_query
            .split_whitespace()
            .filter_map(|token| {
                let escaped = token.replace('"', "\"\"");
                if escaped.is_empty() {
                    return None;
                }

                if escaped.chars().count() >= 3 {
                    Some(format!("\"{}\"*", escaped))
                } else {
                    Some(format!("\"{}\"", escaped))
                }
            })
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    fn build_relaxed_fts_query(normalized_query: &str) -> String {
        normalized_query
            .split_whitespace()
            .filter_map(|token| {
                let escaped = token.replace('"', "\"\"");
                if escaped.is_empty() {
                    return None;
                }

                if escaped.chars().count() >= 3 {
                    Some(format!("\"{}\"*", escaped))
                } else {
                    Some(format!("\"{}\"", escaped))
                }
            })
            .collect::<Vec<_>>()
            .join(" OR ")
    }

    fn rerank_candidates(
        query: &str,
        candidates: Vec<TaskSearchCandidate>,
        fallback_mode: bool,
    ) -> Result<Vec<RankedCandidate>, AppError> {
        let pattern = Pattern::parse(query, CaseMatching::Ignore, Normalization::Smart);
        let mut matcher = TASK_QUERY_MATCHER
            .lock()
            .map_err(|_| AppError::validation("task search matcher unavailable"))?;
        let mut buf = Vec::new();

        let mut ranked = candidates
            .into_iter()
            .filter_map(|candidate| {
                let title_score = pattern.score(
                    Utf32Str::new(candidate.title.as_str(), &mut buf),
                    &mut matcher,
                );
                let display_key_score = pattern.score(
                    Utf32Str::new(candidate.display_key.as_str(), &mut buf),
                    &mut matcher,
                );
                let description_score = pattern.score(
                    Utf32Str::new(candidate.description.as_str(), &mut buf),
                    &mut matcher,
                );

                if title_score.is_none() && display_key_score.is_none() && description_score.is_none() {
                    return None;
                }

                Some(RankedCandidate {
                    task_id: candidate.task_id,
                    rank_score: (title_score.unwrap_or(0) * 3)
                        + (display_key_score.unwrap_or(0) * 3)
                        + description_score.unwrap_or(0),
                    fts_rank: candidate.fts_rank,
                })
            })
            .collect::<Vec<_>>();

        ranked.sort_by(|a, b| {
            b.rank_score
                .cmp(&a.rank_score)
                .then_with(|| {
                    a.fts_rank
                        .partial_cmp(&b.fts_rank)
                        .unwrap_or(Ordering::Equal)
                })
                .then_with(|| a.task_id.cmp(&b.task_id))
        });

        if fallback_mode {
            let Some(top_score) = ranked.first().map(|candidate| candidate.rank_score) else {
                return Ok(Vec::new());
            };

            let relative_cutoff = ((top_score as f32) * FALLBACK_TOP_SCORE_RATIO_CUTOFF) as u32;
            let min_cutoff = FALLBACK_MIN_SCORE.max(relative_cutoff);
            ranked.retain(|candidate| candidate.rank_score >= min_cutoff);
        }

        Ok(ranked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use sqlx::SqlitePool;

    async fn setup_service() -> (TaskSearchService, SqlitePool) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let tasks_repository = TasksRepository::new(pool.clone());
        let service = TaskSearchService::new(
            tasks_repository.clone(),
            TaskSearchRepository::new(pool.clone()),
        );
        (service, pool)
    }

    async fn seed_project(pool: &SqlitePool, project_id: &str, key: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        )
        .bind(project_id)
        .bind(format!("Project {}", key))
        .bind(key)
        .bind(format!("repo-{}", project_id))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, 'Main', '/tmp/repo', 1, '2024-01-01T00:00:00Z')",
        )
        .bind(format!("repo-{}", project_id))
        .bind(project_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_task(
        pool: &SqlitePool,
        id: &str,
        project_id: &str,
        task_number: i64,
        title: &str,
        description: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'todo', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(project_id)
        .bind(format!("repo-{}", project_id))
        .bind(task_number)
        .bind(title)
        .bind(description)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn search_finds_exact_title_match() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(&pool, "task-1", "project-1", 1, "Run Details", None).await;

        let results = service
            .search_project_tasks("project-1", "Run Details")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Run Details");
    }

    #[tokio::test]
    async fn search_finds_prefix_match() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(&pool, "task-1", "project-1", 1, "Runbook Generator", None).await;

        let results = service
            .search_project_tasks("project-1", "Runbo")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Runbook Generator");
    }

    #[tokio::test]
    async fn search_finds_multi_word_query() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(
            &pool,
            "task-1",
            "project-1",
            1,
            "Fix login flow",
            Some("Ensure oauth callback handling is stable"),
        )
        .await;

        let results = service
            .search_project_tasks("project-1", "login oauth")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "task-1");
    }

    #[tokio::test]
    async fn search_handles_typo_with_matcher_rerank() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(&pool, "task-0", "project-1", 1, "Runbook Setup", None).await;
        seed_task(&pool, "task-1", "project-1", 1, "Run Details", None).await;
        seed_task(&pool, "task-2", "project-1", 1, "Release Notes", None).await;

        let results = service
            .search_project_tasks("project-1", "rund etails")
            .await
            .unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].title, "Run Details");
    }

    #[tokio::test]
    async fn search_typo_fallback_stays_selective() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(&pool, "task-1", "project-1", 1, "Run Details", None).await;
        seed_task(&pool, "task-2", "project-1", 2, "Roadmap Planning", None).await;
        seed_task(&pool, "task-3", "project-1", 3, "Release Notes", None).await;
        seed_task(&pool, "task-4", "project-1", 4, "Database Migration", None).await;
        seed_task(&pool, "task-5", "project-1", 5, "Monitoring Setup", None).await;

        let results = service
            .search_project_tasks("project-1", "rund etails")
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "task-1");
        assert_eq!(results[0].title, "Run Details");
    }

    #[tokio::test]
    async fn search_is_project_scoped() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_project(&pool, "project-2", "OPS").await;
        seed_task(&pool, "task-1", "project-1", 1, "Run Details", None).await;
        seed_task(&pool, "task-2", "project-2", 1, "Run Details", None).await;

        let results = service
            .search_project_tasks("project-1", "Run Details")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].project_id, "project-1");
    }

    #[tokio::test]
    async fn search_stays_consistent_after_update_and_delete() {
        let (service, pool) = setup_service().await;
        seed_project(&pool, "project-1", "PRJ").await;
        seed_task(&pool, "task-1", "project-1", 1, "Old title", None).await;

        let before_update = service
            .search_project_tasks("project-1", "Old")
            .await
            .unwrap();
        assert_eq!(before_update.len(), 1);

        sqlx::query("UPDATE tasks SET title = 'New title', updated_at = '2024-01-02T00:00:00Z' WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        let old_results = service
            .search_project_tasks("project-1", "Old")
            .await
            .unwrap();
        assert!(old_results.is_empty());

        let new_results = service
            .search_project_tasks("project-1", "New")
            .await
            .unwrap();
        assert_eq!(new_results.len(), 1);

        sqlx::query("DELETE FROM tasks WHERE id = 'task-1'")
            .execute(&pool)
            .await
            .unwrap();

        let after_delete = service
            .search_project_tasks("project-1", "New")
            .await
            .unwrap();
        assert!(after_delete.is_empty());
    }
}
