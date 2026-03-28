use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::tasks::dto::{
    AddTaskDependencyRequest, CreateTaskRequest, DeleteTaskResponse, MoveTaskRequest,
    RemoveTaskDependencyRequest, RemoveTaskDependencyResponse, SetTaskStatusRequest,
    TaskDependenciesDto, TaskDependencyEdgeDto, TaskDependencyTaskDto, TaskDto, UpdateTaskRequest,
};
use crate::app::tasks::errors::TaskServiceError;
use crate::app::tasks::models::{
    MoveTaskRepository, NewTask, Task, TaskDependencyTask, UpdateTaskDetails, UpdateTaskStatus,
};
use crate::app::tasks::search_service::TaskSearchService;
use chrono::Utc;

#[derive(Clone, Debug)]
pub struct TasksService {
    repository: TasksRepository,
    search_service: TaskSearchService,
}

impl TasksService {
    pub fn new(repository: TasksRepository, search_service: TaskSearchService) -> Self {
        Self {
            repository,
            search_service,
        }
    }

    pub async fn create_task(&self, mut input: CreateTaskRequest) -> Result<TaskDto, AppError> {
        input.project_id = input.project_id.trim().to_string();
        input.repository_id = input.repository_id.trim().to_string();
        input.title = input.title.trim().to_string();
        input.status = input.status.trim().to_string();
        input.description = input.description.map(|value| value.trim().to_string());
        input.implementation_guide = input
            .implementation_guide
            .map(|value| value.trim().to_string());

        if input.title.is_empty() {
            return Err(AppError::validation("task title is required"));
        }

        Self::validate_status(&input.status)?;

        if !self
            .repository
            .project_exists(&input.project_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::not_found("project not found"));
        }

        if !self
            .repository
            .repository_belongs_to_project(&input.repository_id, &input.project_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::validation(
                "repository must belong to the specified project",
            ));
        }

        let now = Utc::now().to_rfc3339();
        let created = self
            .repository
            .create_task(NewTask {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: input.project_id,
                repository_id: input.repository_id,
                title: input.title,
                description: input.description,
                implementation_guide: input.implementation_guide,
                status: input.status,
                created_at: now.clone(),
                updated_at: now,
            })
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;

        Ok(Self::to_dto(created))
    }

    pub async fn list_project_tasks(&self, project_id: &str) -> Result<Vec<TaskDto>, AppError> {
        if !self
            .repository
            .project_exists(project_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::not_found("project not found"));
        }

        let tasks = self
            .repository
            .list_project_tasks(project_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;
        Ok(tasks.into_iter().map(Self::to_dto).collect())
    }

    pub async fn search_project_tasks(
        &self,
        project_id: &str,
        query: &str,
    ) -> Result<Vec<TaskDto>, AppError> {
        self.search_service
            .search_project_tasks(project_id, query)
            .await
            .map_err(|source| TaskServiceError::Search { source }.into_app_error())
    }

    pub async fn get_task(&self, id: &str) -> Result<TaskDto, AppError> {
        let task = self
            .repository
            .get_task(id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(task))
    }

    pub async fn update_task(
        &self,
        id: &str,
        mut input: UpdateTaskRequest,
    ) -> Result<TaskDto, AppError> {
        input.title = input.title.trim().to_string();
        input.description = input.description.map(|value| value.trim().to_string());
        input.implementation_guide = input.implementation_guide.map(|value| {
            value
                .map(|guide| guide.trim().to_string())
                .and_then(|guide| if guide.is_empty() { None } else { Some(guide) })
        });

        if input.title.is_empty() {
            return Err(AppError::validation("task title is required"));
        }

        let updated = self
            .repository
            .update_task_details(
                id,
                UpdateTaskDetails {
                    title: input.title,
                    description: input.description,
                    implementation_guide: input.implementation_guide,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn set_task_status(
        &self,
        id: &str,
        mut input: SetTaskStatusRequest,
    ) -> Result<TaskDto, AppError> {
        input.status = input.status.trim().to_string();
        Self::validate_status(&input.status)?;

        let existing_task = self
            .repository
            .get_task(id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if !Self::can_transition_status(&existing_task.status, &input.status) {
            return Err(AppError::validation("invalid task status transition"));
        }

        let (updated_task, _) = self
            .repository
            .update_task_status(
                id,
                UpdateTaskStatus {
                    status: input.status,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;
        let updated = updated_task.ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn move_task(
        &self,
        id: &str,
        mut input: MoveTaskRequest,
    ) -> Result<TaskDto, AppError> {
        input.repository_id = input.repository_id.trim().to_string();

        let existing_task = self
            .repository
            .get_task(id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if !self
            .repository
            .repository_belongs_to_project(&input.repository_id, &existing_task.project_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::validation(
                "repository must belong to the specified project",
            ));
        }

        let updated = self
            .repository
            .move_task_repository(
                id,
                MoveTaskRepository {
                    repository_id: input.repository_id,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn delete_task(&self, id: &str) -> Result<DeleteTaskResponse, AppError> {
        let deleted = self
            .repository
            .delete_task(id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;
        if !deleted {
            return Err(AppError::not_found("task not found"));
        }

        Ok(DeleteTaskResponse { id: id.to_string() })
    }

    pub async fn list_task_dependencies(
        &self,
        task_id: &str,
    ) -> Result<TaskDependenciesDto, AppError> {
        let task_id = task_id.trim().to_string();

        self.repository
            .get_task(&task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        let dependencies = self
            .repository
            .list_task_dependencies(&task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(TaskDependenciesDto {
            task_id,
            parents: dependencies
                .parents
                .into_iter()
                .map(Self::to_dependency_task_dto)
                .collect(),
            children: dependencies
                .children
                .into_iter()
                .map(Self::to_dependency_task_dto)
                .collect(),
        })
    }

    pub async fn add_task_dependency(
        &self,
        mut input: AddTaskDependencyRequest,
    ) -> Result<TaskDependencyEdgeDto, AppError> {
        input.parent_task_id = input.parent_task_id.trim().to_string();
        input.child_task_id = input.child_task_id.trim().to_string();

        if input.parent_task_id == input.child_task_id {
            return Err(AppError::validation("task cannot depend on itself"));
        }

        let parent_task = self
            .repository
            .get_task(&input.parent_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;
        let child_task = self
            .repository
            .get_task(&input.child_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if parent_task.project_id != child_task.project_id {
            return Err(AppError::validation(
                "dependency tasks must belong to the same project",
            ));
        }

        if self
            .repository
            .dependency_exists(&input.parent_task_id, &input.child_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::validation("dependency already exists"));
        }

        if self
            .repository
            .dependency_would_create_cycle(&input.parent_task_id, &input.child_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
        {
            return Err(AppError::validation("dependency would create a cycle"));
        }

        let created_at = Utc::now().to_rfc3339();
        let edge = self
            .repository
            .add_task_dependency(
                &parent_task.project_id,
                &input.parent_task_id,
                &input.child_task_id,
                &created_at,
            )
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;

        Ok(TaskDependencyEdgeDto {
            parent_task_id: edge.parent_task_id,
            child_task_id: edge.child_task_id,
            created_at: edge.created_at,
        })
    }

    pub async fn remove_task_dependency(
        &self,
        mut input: RemoveTaskDependencyRequest,
    ) -> Result<RemoveTaskDependencyResponse, AppError> {
        input.parent_task_id = input.parent_task_id.trim().to_string();
        input.child_task_id = input.child_task_id.trim().to_string();

        if input.parent_task_id == input.child_task_id {
            return Err(AppError::validation("task cannot depend on itself"));
        }

        let parent_task = self
            .repository
            .get_task(&input.parent_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;
        let child_task = self
            .repository
            .get_task(&input.child_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if parent_task.project_id != child_task.project_id {
            return Err(AppError::validation(
                "dependency tasks must belong to the same project",
            ));
        }

        let removed = self
            .repository
            .remove_task_dependency(&input.parent_task_id, &input.child_task_id)
            .await
            .map_err(|source| TaskServiceError::Repository { source }.into_app_error())?;

        Ok(RemoveTaskDependencyResponse {
            parent_task_id: input.parent_task_id,
            child_task_id: input.child_task_id,
            removed,
        })
    }

    fn to_dto(task: Task) -> TaskDto {
        TaskDto {
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
        }
    }

    fn to_dependency_task_dto(task: TaskDependencyTask) -> TaskDependencyTaskDto {
        TaskDependencyTaskDto {
            id: task.id,
            display_key: task.display_key,
            title: task.title,
            status: task.status,
            target_repository_name: task.target_repository_name,
            target_repository_path: task.target_repository_path,
            updated_at: task.updated_at,
        }
    }

    fn validate_status(status: &str) -> Result<(), AppError> {
        if ["todo", "doing", "review", "done"].contains(&status) {
            Ok(())
        } else {
            Err(AppError::validation("invalid task status"))
        }
    }

    fn next_status(status: &str) -> Option<&'static str> {
        match status {
            "todo" => Some("doing"),
            "doing" => Some("review"),
            "review" => Some("done"),
            "done" => Some("todo"),
            _ => None,
        }
    }

    fn can_transition_status(from: &str, to: &str) -> bool {
        if from == "review" {
            return ["todo", "doing", "done"].contains(&to);
        }

        if from == "doing" {
            return ["review", "todo"].contains(&to);
        }

        Self::next_status(from) == Some(to)
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use crate::app::db::repositories::task_search::TaskSearchRepository;
    use sqlx::SqlitePool;

    async fn setup_service() -> (TasksService, SqlitePool) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let repository = TasksRepository::new(pool.clone());
        let search_service =
            TaskSearchService::new(repository.clone(), TaskSearchRepository::new(pool.clone()));
        (TasksService::new(repository, search_service), pool)
    }


    async fn seed_project_and_repository(pool: &SqlitePool) {
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
        .bind("/repo/main")
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_task(pool: &SqlitePool, task_status: &str) {
        let project_id = "project-1";
        let repository_id = "repo-1";

        seed_project_and_repository(pool).await;

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("task-1")
        .bind(project_id)
        .bind(repository_id)
        .bind(1)
        .bind("Task")
        .bind(Option::<String>::None)
        .bind(task_status)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_task_keeps_implementation_guide_optional_when_omitted() {
        let (service, pool) = setup_service().await;
        seed_project_and_repository(&pool).await;

        let created = service
            .create_task(CreateTaskRequest {
                project_id: "project-1".to_string(),
                repository_id: "repo-1".to_string(),
                title: "Task".to_string(),
                description: Some("  desc  ".to_string()),
                implementation_guide: None,
                status: "todo".to_string(),
            })
            .await
            .unwrap();

        assert_eq!(created.description, Some("desc".to_string()));
        assert_eq!(created.implementation_guide, None);
    }

    #[tokio::test]
    async fn create_and_update_task_trim_implementation_guide_when_present() {
        let (service, pool) = setup_service().await;
        seed_project_and_repository(&pool).await;

        let created = service
            .create_task(CreateTaskRequest {
                project_id: " project-1 ".to_string(),
                repository_id: " repo-1 ".to_string(),
                title: " Task ".to_string(),
                description: Some(" desc ".to_string()),
                implementation_guide: Some("  step 1  ".to_string()),
                status: " todo ".to_string(),
            })
            .await
            .unwrap();

        assert_eq!(created.implementation_guide, Some("step 1".to_string()));

        let updated = service
            .update_task(
                &created.id,
                UpdateTaskRequest {
                    title: " Updated task ".to_string(),
                    description: Some(" updated desc ".to_string()),
                    implementation_guide: Some(Some("  step 2  ".to_string())),
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.description, Some("updated desc".to_string()));
        assert_eq!(updated.implementation_guide, Some("step 2".to_string()));
    }

    #[tokio::test]
    async fn update_task_keeps_implementation_guide_when_omitted() {
        let (service, pool) = setup_service().await;
        seed_project_and_repository(&pool).await;

        let created = service
            .create_task(CreateTaskRequest {
                project_id: "project-1".to_string(),
                repository_id: "repo-1".to_string(),
                title: "Task".to_string(),
                description: Some("desc".to_string()),
                implementation_guide: Some("step 1".to_string()),
                status: "todo".to_string(),
            })
            .await
            .unwrap();

        let updated = service
            .update_task(
                &created.id,
                UpdateTaskRequest {
                    title: "Task updated".to_string(),
                    description: Some("desc updated".to_string()),
                    implementation_guide: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.implementation_guide, Some("step 1".to_string()));
    }

    #[tokio::test]
    async fn update_task_clears_implementation_guide_when_null_or_empty() {
        let (service, pool) = setup_service().await;
        seed_project_and_repository(&pool).await;

        let created = service
            .create_task(CreateTaskRequest {
                project_id: "project-1".to_string(),
                repository_id: "repo-1".to_string(),
                title: "Task".to_string(),
                description: Some("desc".to_string()),
                implementation_guide: Some("step 1".to_string()),
                status: "todo".to_string(),
            })
            .await
            .unwrap();

        let cleared_with_null = service
            .update_task(
                &created.id,
                UpdateTaskRequest {
                    title: "Task updated".to_string(),
                    description: Some("desc updated".to_string()),
                    implementation_guide: Some(None),
                },
            )
            .await
            .unwrap();
        assert_eq!(cleared_with_null.implementation_guide, None);

        let restored = service
            .update_task(
                &created.id,
                UpdateTaskRequest {
                    title: "Task updated again".to_string(),
                    description: Some("desc updated again".to_string()),
                    implementation_guide: Some(Some("step 2".to_string())),
                },
            )
            .await
            .unwrap();
        assert_eq!(restored.implementation_guide, Some("step 2".to_string()));

        let cleared_with_empty = service
            .update_task(
                &created.id,
                UpdateTaskRequest {
                    title: "Task updated final".to_string(),
                    description: Some("desc updated final".to_string()),
                    implementation_guide: Some(Some("   ".to_string())),
                },
            )
            .await
            .unwrap();
        assert_eq!(cleared_with_empty.implementation_guide, None);
    }

    #[test]
    fn transition_matrix_allows_review_backflow_and_preserves_other_rules() {
        assert!(TasksService::can_transition_status("todo", "doing"));
        assert!(TasksService::can_transition_status("doing", "review"));
        assert!(TasksService::can_transition_status("doing", "todo"));
        assert!(TasksService::can_transition_status("review", "done"));
        assert!(TasksService::can_transition_status("review", "doing"));
        assert!(TasksService::can_transition_status("review", "todo"));
        assert!(TasksService::can_transition_status("done", "todo"));

        assert!(!TasksService::can_transition_status("todo", "review"));
        assert!(!TasksService::can_transition_status("todo", "done"));
        assert!(!TasksService::can_transition_status("todo", "todo"));
        assert!(!TasksService::can_transition_status("doing", "done"));
        assert!(!TasksService::can_transition_status("invalid", "todo"));
    }

    #[tokio::test]
    async fn set_task_status_allows_review_to_doing() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "review").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "doing".to_string(),
                    source_action: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "doing");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "doing");
    }

    #[tokio::test]
    async fn set_task_status_allows_review_to_todo() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "review").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "todo".to_string(),
                    source_action: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "todo");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }

    #[tokio::test]
    async fn set_task_status_allows_doing_to_todo() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "doing").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "todo".to_string(),
                    source_action: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "todo");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }

    #[tokio::test]
    async fn set_task_status_rejects_invalid_transition_and_keeps_state() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "todo").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "review".to_string(),
                    source_action: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                },
            )
            .await;

        match result {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "invalid task status transition")
            }
            _ => panic!("expected validation error for invalid transition"),
        }

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }

    #[tokio::test]
    async fn set_task_status_with_board_source_action_updates_status_without_creating_run() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "todo").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "doing".to_string(),
                    source_action: Some("board_manual_move".to_string()),
                    agent_id: Some("agent-a".to_string()),
                    provider_id: Some("provider-a".to_string()),
                    model_id: Some("model-a".to_string()),
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "doing");
        let persisted_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(persisted_status, "doing");

        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE task_id = ?")
            .bind("task-1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_count, 0);
    }
}
