use crate::app::db::repositories::runs::RunsRepository;
use crate::app::errors::AppError;
use crate::app::runs::dto::RunDto;
use crate::app::runs::models::{NewRun, Run, RunInitialPromptContext};
use crate::app::worktrees::dto::CreateWorktreeRequest;
use crate::app::worktrees::service::WorktreesService;
use chrono::Utc;

#[derive(Clone, Debug)]
pub struct RunsService {
    repository: RunsRepository,
    worktrees_service: WorktreesService,
}

impl RunsService {
    pub fn new(repository: RunsRepository, worktrees_service: WorktreesService) -> Self {
        Self {
            repository,
            worktrees_service,
        }
    }

    pub async fn create_run(&self, task_id: &str) -> Result<RunDto, AppError> {
        self.create_run_with_defaults(task_id, None, None, None)
            .await
    }

    pub async fn create_run_with_defaults(
        &self,
        task_id: &str,
        agent_id: Option<&str>,
        provider_id: Option<&str>,
        model_id: Option<&str>,
    ) -> Result<RunDto, AppError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(AppError::validation("task_id is required"));
        }

        let selected_agent_id = normalize_optional_nonempty(agent_id);
        let selected_provider_id = normalize_optional_nonempty(provider_id);
        let selected_model_id = normalize_optional_nonempty(model_id);
        let (provider_id, model_id) = match (selected_provider_id, selected_model_id) {
            (Some(provider_id), Some(model_id)) => (Some(provider_id), Some(model_id)),
            _ => (None, None),
        };

        let task_context = self
            .repository
            .get_task_run_context(task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        let worktree = self.worktrees_service.create(CreateWorktreeRequest {
            project_key: task_context.project_key,
            repo_path: task_context.repository_path,
            branch_title: task_context.branch_title,
        })?;

        let created = self
            .repository
            .create_run(NewRun {
                id: uuid::Uuid::new_v4().to_string(),
                task_id: task_id.to_string(),
                project_id: task_context.project_id,
                target_repo_id: Some(task_context.repository_id),
                status: "queued".to_string(),
                triggered_by: "user".to_string(),
                created_at: Utc::now().to_rfc3339(),
                worktree_id: Some(worktree.worktree_id),
                agent_id: selected_agent_id,
                provider_id,
                model_id,
                source_branch: worktree.source_branch,
            })
            .await?;

        Ok(Self::to_dto(created))
    }

    pub async fn create_or_reuse_active_run(&self, task_id: &str) -> Result<RunDto, AppError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(AppError::validation("task_id is required"));
        }

        if let Some(existing) = self
            .repository
            .get_latest_active_run_for_task(task_id)
            .await?
        {
            return Ok(Self::to_dto(existing));
        }

        match self.create_run(task_id).await {
            Ok(created) => Ok(created),
            Err(err) if Self::is_active_run_uniqueness_violation(&err) => {
                if let Some(existing) = self
                    .repository
                    .get_latest_active_run_for_task(task_id)
                    .await?
                {
                    return Ok(Self::to_dto(existing));
                }

                Err(err)
            }
            Err(err) => Err(err),
        }
    }

    fn is_active_run_uniqueness_violation(err: &AppError) -> bool {
        let AppError::Database(sqlx::Error::Database(db_err)) = err else {
            return false;
        };

        let code_matches = db_err.code().as_deref() == Some("2067");
        let message = db_err.message();
        code_matches
            && (message.contains("idx_runs_single_active_per_task")
                || message.contains("runs.task_id"))
    }

    pub async fn list_task_runs(&self, task_id: &str) -> Result<Vec<RunDto>, AppError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(AppError::validation("task_id is required"));
        }

        self.repository
            .get_task_run_context(task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        let runs = self.repository.list_task_runs(task_id).await?;
        Ok(runs.into_iter().map(Self::to_dto).collect())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<RunDto, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let run = self
            .repository
            .get_run(run_id)
            .await?
            .ok_or_else(|| AppError::not_found("run not found"))?;

        Ok(Self::to_dto(run))
    }

    pub async fn get_run_model(&self, run_id: &str) -> Result<Run, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        self.repository
            .get_run(run_id)
            .await?
            .ok_or_else(|| AppError::not_found("run not found"))
    }

    pub async fn get_run_initial_prompt_context(
        &self,
        run_id: &str,
    ) -> Result<RunInitialPromptContext, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        self.repository
            .get_run_initial_prompt_context(run_id)
            .await?
            .ok_or_else(|| AppError::not_found("run not found"))
    }

    pub async fn get_run_repository_path(&self, run_id: &str) -> Result<String, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        self.repository
            .get_run_repository_path(run_id)
            .await?
            .ok_or_else(|| AppError::not_found("run repository not found"))
    }

    pub async fn delete_run(&self, run_id: &str) -> Result<(), AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let deleted = self.repository.delete_run(run_id).await?;
        if !deleted {
            return Err(AppError::not_found("run not found"));
        }

        Ok(())
    }

    pub async fn transition_queued_to_running(&self, run_id: &str) -> Result<RunDto, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let started_at = Utc::now().to_rfc3339();
        let updated = self
            .repository
            .transition_queued_to_running_and_mark_task_doing(run_id, &started_at)
            .await?;

        if !updated {
            return self.get_run(run_id).await;
        }

        self.get_run(run_id).await
    }

    pub async fn update_run_opencode_session_id(
        &self,
        run_id: &str,
        opencode_session_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let opencode_session_id = opencode_session_id.trim();
        if opencode_session_id.is_empty() {
            return Err(AppError::validation("opencode_session_id is required"));
        }

        self.repository
            .update_opencode_session_id(run_id, opencode_session_id)
            .await
    }

    pub async fn set_run_opencode_session_id_if_unset(
        &self,
        run_id: &str,
        opencode_session_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let opencode_session_id = opencode_session_id.trim();
        if opencode_session_id.is_empty() {
            return Err(AppError::validation("opencode_session_id is required"));
        }

        self.repository
            .set_opencode_session_id_if_unset(run_id, opencode_session_id)
            .await
    }

    pub async fn mark_initial_prompt_sent_if_unset(
        &self,
        run_id: &str,
        client_request_id: Option<&str>,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let sent_at = Utc::now().to_rfc3339();
        self.repository
            .mark_initial_prompt_sent_if_unset(run_id, &sent_at, client_request_id)
            .await
    }

    pub async fn claim_initial_prompt_send_if_unset(
        &self,
        run_id: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let claim_request_id = claim_request_id.trim();
        if claim_request_id.is_empty() {
            return Err(AppError::validation("claim_request_id is required"));
        }

        let claimed_at = Utc::now().to_rfc3339();
        self.repository
            .claim_initial_prompt_send_if_unset(run_id, &claimed_at, claim_request_id)
            .await
    }

    pub async fn finalize_initial_prompt_send_for_claimant(
        &self,
        run_id: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let claim_request_id = claim_request_id.trim();
        if claim_request_id.is_empty() {
            return Err(AppError::validation("claim_request_id is required"));
        }

        let sent_at = Utc::now().to_rfc3339();
        self.repository
            .finalize_initial_prompt_send_for_claimant(run_id, &sent_at, claim_request_id)
            .await
    }

    pub async fn release_initial_prompt_claim_for_claimant(
        &self,
        run_id: &str,
        claim_request_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let claim_request_id = claim_request_id.trim();
        if claim_request_id.is_empty() {
            return Err(AppError::validation("claim_request_id is required"));
        }

        self.repository
            .release_initial_prompt_claim_for_claimant(run_id, claim_request_id)
            .await
    }

    pub async fn mark_run_completed(&self, run_id: &str) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let finished_at = Utc::now().to_rfc3339();
        self.repository
            .finalize_run_completion_and_task_done(run_id, &finished_at)
            .await
    }

    pub async fn mark_setup_running_if_pending(&self, run_id: &str) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let started_at = Utc::now().to_rfc3339();
        self.repository
            .mark_setup_running_if_pending(run_id, &started_at)
            .await
    }

    pub async fn mark_setup_succeeded(&self, run_id: &str) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let finished_at = Utc::now().to_rfc3339();
        self.repository
            .mark_setup_succeeded(run_id, &finished_at)
            .await
    }

    pub async fn mark_setup_failed_if_unset(
        &self,
        run_id: &str,
        error_message: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let finished_at = Utc::now().to_rfc3339();
        self.repository
            .mark_setup_failed_if_unset(run_id, &finished_at, error_message)
            .await
    }

    pub async fn mark_cleanup_running(&self, run_id: &str) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let started_at = Utc::now().to_rfc3339();
        self.repository
            .mark_cleanup_running(run_id, &started_at)
            .await
    }

    pub async fn mark_cleanup_succeeded(&self, run_id: &str) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let finished_at = Utc::now().to_rfc3339();
        self.repository
            .mark_cleanup_succeeded(run_id, &finished_at)
            .await
    }

    pub async fn mark_cleanup_failed(
        &self,
        run_id: &str,
        error_message: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }
        let finished_at = Utc::now().to_rfc3339();
        self.repository
            .mark_cleanup_failed(run_id, &finished_at, error_message)
            .await
    }

    pub async fn transition_task_to_review_on_session_idle(
        &self,
        run_id: &str,
        opencode_session_id: &str,
    ) -> Result<bool, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let opencode_session_id = opencode_session_id.trim();
        if opencode_session_id.is_empty() {
            return Err(AppError::validation("opencode_session_id is required"));
        }

        let updated_at = Utc::now().to_rfc3339();
        self.repository
            .transition_task_doing_to_review_on_session_idle(
                run_id,
                opencode_session_id,
                &updated_at,
            )
            .await
    }

    fn to_dto(run: Run) -> RunDto {
        RunDto {
            id: run.id,
            task_id: run.task_id,
            project_id: run.project_id,
            target_repo_id: run.target_repo_id,
            status: run.status,
            triggered_by: run.triggered_by,
            created_at: run.created_at,
            started_at: run.started_at,
            finished_at: run.finished_at,
            summary: run.summary,
            error_message: run.error_message,
            worktree_id: run.worktree_id,
            agent_id: run.agent_id,
            provider_id: run.provider_id,
            model_id: run.model_id,
            source_branch: run.source_branch,
            initial_prompt_sent_at: run.initial_prompt_sent_at,
            initial_prompt_client_request_id: run.initial_prompt_client_request_id,
            setup_state: run.setup_state,
            setup_started_at: run.setup_started_at,
            setup_finished_at: run.setup_finished_at,
            setup_error_message: run.setup_error_message,
            cleanup_state: run.cleanup_state,
            cleanup_started_at: run.cleanup_started_at,
            cleanup_finished_at: run.cleanup_finished_at,
            cleanup_error_message: run.cleanup_error_message,
        }
    }
}

fn normalize_optional_nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use crate::app::worktrees::service::WorktreesService;
    use git2::{Repository, Signature};
    use sqlx::SqlitePool;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    async fn setup_service() -> (RunsService, SqlitePool, TempDir) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let repository = RunsRepository::new(pool.clone());
        let temp_dir = TempDir::new();
        let worktrees_service = WorktreesService::new(temp_dir.path().join("app-data"));
        (
            RunsService::new(repository, worktrees_service),
            pool,
            temp_dir,
        )
    }

    async fn seed_task(pool: &SqlitePool, task_id: &str, repo_path: &Path) {
        seed_task_with_status(pool, task_id, repo_path, "todo").await;
    }

    async fn seed_task_with_status(
        pool: &SqlitePool,
        task_id: &str,
        repo_path: &Path,
        status: &str,
    ) {
        let project_id = "project-1";
        let repository_id = "repo-1";

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind("Alpha")
        .bind("ALP")
        .bind(Option::<String>::None)
        .bind(repository_id)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(repository_id)
        .bind(project_id)
        .bind("Main")
        .bind(repo_path.to_string_lossy().to_string())
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(task_id)
        .bind(project_id)
        .bind(repository_id)
        .bind(1)
        .bind("Task")
        .bind(Option::<String>::None)
        .bind(status)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    fn init_git_repo(path: &Path) {
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
    }

    #[derive(Debug)]
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("orkestra-runs-tests-{}", Uuid::new_v4()));
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

    async fn seed_run(pool: &SqlitePool, run_id: &str, task_id: &str) {
        seed_run_with_status(pool, run_id, task_id, "queued").await;
    }

    async fn seed_run_with_status(pool: &SqlitePool, run_id: &str, task_id: &str, status: &str) {
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(task_id)
        .bind("project-1")
        .bind("repo-1")
        .bind(status)
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_run_happy_path_sets_queued_and_task_context() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        let run = service.create_run("task-1").await.unwrap();

        assert_eq!(run.task_id, "task-1");
        assert_eq!(run.project_id, "project-1");
        assert_eq!(run.target_repo_id, Some("repo-1".to_string()));
        assert_eq!(run.status, "queued");
        assert_eq!(run.triggered_by, "user");
        assert!(run.worktree_id.is_some());
        let worktree_id = run.worktree_id.unwrap();
        let mut segments = worktree_id.split('/');
        let project_segment = segments.next().unwrap_or_default();
        let branch_segment = segments.next().unwrap_or_default();
        assert_eq!(project_segment, "ALP");
        assert!(!branch_segment.is_empty());
        assert!(branch_segment
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'));
        assert!(segments.next().is_none());
        assert!(run.source_branch.is_some());
    }

    #[tokio::test]
    async fn create_run_with_defaults_persists_agent_and_model_pair() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        let run = service
            .create_run_with_defaults("task-1", Some("build"), Some("provider-a"), Some("model-a"))
            .await
            .unwrap();

        assert_eq!(run.agent_id.as_deref(), Some("build"));
        assert_eq!(run.provider_id.as_deref(), Some("provider-a"));
        assert_eq!(run.model_id.as_deref(), Some("model-a"));
    }

    #[tokio::test]
    async fn create_run_with_partial_model_defaults_drops_unpaired_model_selection() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        let run = service
            .create_run_with_defaults("task-1", Some("build"), Some("provider-a"), None)
            .await
            .unwrap();

        assert_eq!(run.agent_id.as_deref(), Some("build"));
        assert_eq!(run.provider_id, None);
        assert_eq!(run.model_id, None);
    }

    #[tokio::test]
    async fn create_run_returns_not_found_for_missing_task() {
        let (service, _, _) = setup_service().await;

        let result = service.create_run("missing-task").await;

        match result {
            Err(AppError::NotFound(message)) => assert_eq!(message, "task not found"),
            _ => panic!("expected not found error"),
        }
    }

    #[tokio::test]
    async fn create_run_returns_validation_error_for_empty_task_id() {
        let (service, _, _) = setup_service().await;

        let result = service.create_run("   ").await;

        match result {
            Err(AppError::Validation(message)) => assert_eq!(message, "task_id is required"),
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn create_or_reuse_active_run_reuses_existing_active_run() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run_with_status(&pool, "run-active", "task-1", "running").await;

        let run = service.create_or_reuse_active_run("task-1").await.unwrap();

        assert_eq!(run.id, "run-active");
        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE task_id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_count, 1);
    }

    #[tokio::test]
    async fn create_or_reuse_active_run_creates_new_when_no_active_run_exists() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run_with_status(&pool, "run-old", "task-1", "completed").await;

        let run = service.create_or_reuse_active_run("task-1").await.unwrap();

        assert_ne!(run.id, "run-old");
        assert_eq!(run.status, "queued");
        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs WHERE task_id = ? AND status IN ('queued','preparing','running')",
        )
        .bind("task-1")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active_count, 1);
    }

    #[tokio::test]
    async fn create_or_reuse_active_run_is_concurrent_safe_with_single_active_run() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        let mut tasks = Vec::new();
        for _ in 0..8 {
            let service_clone = service.clone();
            tasks.push(tokio::spawn(async move {
                service_clone
                    .create_or_reuse_active_run("task-1")
                    .await
                    .unwrap()
            }));
        }

        let mut returned_run_ids = Vec::new();
        for task in tasks {
            returned_run_ids.push(task.await.unwrap().id);
        }

        let first_id = returned_run_ids.first().cloned().unwrap();
        assert!(returned_run_ids
            .iter()
            .all(|run_id| run_id.as_str() == first_id.as_str()));

        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs WHERE task_id = ? AND status IN ('queued','preparing','running')",
        )
        .bind("task-1")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active_count, 1);
    }

    #[tokio::test]
    async fn list_task_runs_orders_by_created_at_desc() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-1")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("queued")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-2")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("running")
        .bind("user")
        .bind("2024-01-02T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        let runs = service.list_task_runs("task-1").await.unwrap();

        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].id, "run-2");
        assert_eq!(runs[1].id, "run-1");
    }

    #[tokio::test]
    async fn list_task_runs_returns_not_found_for_missing_task() {
        let (service, _, _) = setup_service().await;

        let result = service.list_task_runs("missing-task").await;

        match result {
            Err(AppError::NotFound(message)) => assert_eq!(message, "task not found"),
            _ => panic!("expected not found error"),
        }
    }

    #[tokio::test]
    async fn list_task_runs_returns_validation_error_for_empty_task_id() {
        let (service, _, _) = setup_service().await;

        let result = service.list_task_runs(" ").await;

        match result {
            Err(AppError::Validation(message)) => assert_eq!(message, "task_id is required"),
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn get_run_returns_not_found_for_missing_run() {
        let (service, _, _) = setup_service().await;

        let result = service.get_run("missing-run").await;

        match result {
            Err(AppError::NotFound(message)) => assert_eq!(message, "run not found"),
            _ => panic!("expected not found error"),
        }
    }

    #[tokio::test]
    async fn get_run_returns_validation_error_for_empty_run_id() {
        let (service, _, _) = setup_service().await;

        let result = service.get_run("   ").await;

        match result {
            Err(AppError::Validation(message)) => assert_eq!(message, "run_id is required"),
            _ => panic!("expected validation error"),
        }
    }

    #[tokio::test]
    async fn delete_run_succeeds_for_existing_run() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1").await;

        let result = service.delete_run("run-1").await;

        assert!(result.is_ok());
        let found = service.get_run("run-1").await;
        assert!(matches!(found, Err(AppError::NotFound(_))));
    }

    #[tokio::test]
    async fn delete_run_returns_not_found_for_missing_run() {
        let (service, _, _) = setup_service().await;

        let result = service.delete_run("missing-run").await;

        match result {
            Err(AppError::NotFound(message)) => assert_eq!(message, "run not found"),
            _ => panic!("expected not found error"),
        }
    }

    #[tokio::test]
    async fn migration_rejects_invalid_run_status() {
        let (_, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;

        let result = sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("run-invalid")
        .bind("task-1")
        .bind("project-1")
        .bind("repo-1")
        .bind("unknown")
        .bind("user")
        .bind("2024-01-01T00:00:00Z")
        .execute(&pool)
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn mark_initial_prompt_sent_is_idempotent() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1").await;

        let first = service
            .mark_initial_prompt_sent_if_unset("run-1", Some("initial-run-message:run-1"))
            .await
            .unwrap();
        let second = service
            .mark_initial_prompt_sent_if_unset("run-1", Some("initial-run-message:run-1"))
            .await
            .unwrap();

        assert!(first);
        assert!(!second);

        let run = service.get_run_model("run-1").await.unwrap();
        assert!(run.initial_prompt_sent_at.is_some());
        assert_eq!(
            run.initial_prompt_client_request_id.as_deref(),
            Some("initial-run-message:run-1")
        );
    }

    #[tokio::test]
    async fn claim_initial_prompt_send_is_concurrency_safe_and_single_winner() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1").await;

        let mut tasks = Vec::new();
        for idx in 0..8 {
            let service_clone = service.clone();
            tasks.push(tokio::spawn(async move {
                let claim_id = format!("claim-{idx}");
                service_clone
                    .claim_initial_prompt_send_if_unset("run-1", &claim_id)
                    .await
                    .unwrap()
            }));
        }

        let mut successful_claims = 0;
        for task in tasks {
            if task.await.unwrap() {
                successful_claims += 1;
            }
        }

        assert_eq!(successful_claims, 1);
    }

    #[tokio::test]
    async fn releasing_claim_allows_new_claimant_and_finalize_marks_sent() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1").await;

        let first_claim = service
            .claim_initial_prompt_send_if_unset("run-1", "claim-a")
            .await
            .unwrap();
        assert!(first_claim);

        let released = service
            .release_initial_prompt_claim_for_claimant("run-1", "claim-a")
            .await
            .unwrap();
        assert!(released);

        let second_claim = service
            .claim_initial_prompt_send_if_unset("run-1", "claim-b")
            .await
            .unwrap();
        assert!(second_claim);

        let finalized = service
            .finalize_initial_prompt_send_for_claimant("run-1", "claim-b")
            .await
            .unwrap();
        assert!(finalized);

        let run = service.get_run_model("run-1").await.unwrap();
        assert!(run.initial_prompt_sent_at.is_some());
        assert_eq!(
            run.initial_prompt_client_request_id.as_deref(),
            Some("claim-b")
        );
    }

    #[tokio::test]
    async fn transition_to_running_marks_todo_task_doing() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task_with_status(&pool, "task-1", &repo_path, "todo").await;
        seed_run(&pool, "run-1", "task-1").await;

        let updated = service.transition_queued_to_running("run-1").await.unwrap();

        assert_eq!(updated.status, "running");
        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "doing");
    }

    #[tokio::test]
    async fn transition_to_running_is_concurrent_single_winner_and_idempotent() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task_with_status(&pool, "task-1", &repo_path, "review").await;
        seed_run(&pool, "run-1", "task-1").await;

        let mut tasks = Vec::new();
        for _ in 0..8 {
            let service_clone = service.clone();
            tasks.push(tokio::spawn(async move {
                service_clone
                    .transition_queued_to_running("run-1")
                    .await
                    .unwrap()
            }));
        }

        for task in tasks {
            let run = task.await.unwrap();
            assert_eq!(run.status, "running");
        }

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "doing");

        let run_after = service.get_run_model("run-1").await.unwrap();
        assert_eq!(run_after.status, "running");
        assert!(run_after.started_at.is_some());
    }

    #[tokio::test]
    async fn session_idle_transition_updates_task_to_review_only_for_active_run() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task_with_status(&pool, "task-1", &repo_path, "doing").await;
        seed_run(&pool, "run-1", "task-1").await;

        sqlx::query(
            "UPDATE runs SET status = 'running', opencode_session_id = 'session-1' WHERE id = ?",
        )
        .bind("run-1")
        .execute(&pool)
        .await
        .unwrap();

        let transitioned = service
            .transition_task_to_review_on_session_idle("run-1", "session-1")
            .await
            .unwrap();
        assert!(transitioned);

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "review");
    }

    #[tokio::test]
    async fn session_idle_transition_does_not_update_terminal_or_mismatched_run() {
        let (service, pool, temp_dir) = setup_service().await;
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        seed_task_with_status(&pool, "task-1", &repo_path, "doing").await;
        seed_run(&pool, "run-1", "task-1").await;

        sqlx::query(
            "UPDATE runs SET status = 'completed', opencode_session_id = 'session-1' WHERE id = ?",
        )
        .bind("run-1")
        .execute(&pool)
        .await
        .unwrap();

        let transitioned_terminal = service
            .transition_task_to_review_on_session_idle("run-1", "session-1")
            .await
            .unwrap();
        let transitioned_mismatch = service
            .transition_task_to_review_on_session_idle("run-1", "other-session")
            .await
            .unwrap();
        assert!(!transitioned_terminal);
        assert!(!transitioned_mismatch);

        let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(task_status, "doing");
    }
}
