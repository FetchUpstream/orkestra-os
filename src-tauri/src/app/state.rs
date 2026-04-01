use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::db::repositories::runs::RunsRepository;
use crate::app::db::repositories::task_search::TaskSearchRepository;
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::projects::search_service::ProjectFileSearchService;
use crate::app::projects::service::ProjectsService;
use crate::app::runs::diff_service::RunsDiffService;
use crate::app::runs::merge_service::RunsMergeService;
use crate::app::runs::opencode_service::RunsOpenCodeService;
use crate::app::runs::run_state_service::RunStateService;
use crate::app::runs::service::RunsService;
use crate::app::runs::status_transition_service::RunStatusTransitionService;
use crate::app::tasks::search_service::TaskSearchService;
use crate::app::tasks::service::TasksService;
use crate::app::tasks::status_transition_service::TaskStatusTransitionService;
use crate::app::terminal::service::TerminalService;
use crate::app::worktrees::service::WorktreesService;
use sqlx::SqlitePool;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppState {
    pub projects_service: ProjectsService,
    pub runs_service: RunsService,
    pub runs_diff_service: RunsDiffService,
    pub runs_merge_service: RunsMergeService,
    pub runs_opencode_service: RunsOpenCodeService,
    pub tasks_service: TasksService,
    pub task_status_transition_service: TaskStatusTransitionService,
    pub worktrees_service: WorktreesService,
    pub terminal_service: TerminalService,
}

impl AppState {
    pub fn new(db_pool: SqlitePool, app_data_dir: PathBuf, app_handle: tauri::AppHandle) -> Self {
        let repository = ProjectsRepository::new(db_pool.clone());
        let runs_repository = RunsRepository::new(db_pool.clone());
        let tasks_repository = TasksRepository::new(db_pool.clone());
        let task_search_repository = TaskSearchRepository::new(db_pool.clone());
        let task_search_service =
            TaskSearchService::new(tasks_repository.clone(), task_search_repository);
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let projects_service = ProjectsService::new(
            repository,
            ProjectFileSearchService::new(),
            worktrees_service.clone(),
        );
        let task_status_transition_service = TaskStatusTransitionService::new(
            RunsRepository::new(db_pool.clone()),
            tasks_repository.clone(),
            Some(app_handle.clone()),
        );
        let runs_service = RunsService::new(runs_repository, worktrees_service.clone());
        let run_state_service = RunStateService::new(
            RunsRepository::new(db_pool.clone()),
            runs_service.clone(),
            Some(app_handle.clone()),
            app_data_dir.clone(),
        );
        let run_status_transition_service = RunStatusTransitionService::new(
            RunsRepository::new(db_pool.clone()),
            run_state_service.clone(),
            Some(app_handle),
        );
        let runs_diff_service = RunsDiffService::new(runs_service.clone(), app_data_dir.clone());
        let runs_merge_service = RunsMergeService::new(
            runs_service.clone(),
            run_state_service.clone(),
            run_status_transition_service.clone(),
            app_data_dir.clone(),
        );
        let runs_opencode_service = RunsOpenCodeService::new(
            runs_service.clone(),
            projects_service.clone(),
            task_status_transition_service.clone(),
            run_state_service.clone(),
            run_status_transition_service.clone(),
            app_data_dir.clone(),
        );
        let terminal_service =
            TerminalService::new(projects_service.clone(), runs_service.clone(), app_data_dir);
        let tasks_service = TasksService::new(tasks_repository, task_search_service);
        Self {
            projects_service,
            runs_service,
            runs_diff_service,
            runs_merge_service,
            runs_opencode_service,
            tasks_service,
            task_status_transition_service,
            worktrees_service,
            terminal_service,
        }
    }
}
