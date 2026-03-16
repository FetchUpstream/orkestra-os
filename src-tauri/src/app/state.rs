use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::db::repositories::runs::RunsRepository;
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::projects::service::ProjectsService;
use crate::app::runs::diff_service::RunsDiffService;
use crate::app::runs::opencode_service::RunsOpenCodeService;
use crate::app::runs::service::RunsService;
use crate::app::tasks::service::TasksService;
use crate::app::terminal::service::TerminalService;
use crate::app::worktrees::service::WorktreesService;
use sqlx::SqlitePool;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppState {
    pub projects_service: ProjectsService,
    pub runs_service: RunsService,
    pub runs_diff_service: RunsDiffService,
    pub runs_opencode_service: RunsOpenCodeService,
    pub tasks_service: TasksService,
    pub worktrees_service: WorktreesService,
    pub terminal_service: TerminalService,
}

impl AppState {
    pub fn new(db_pool: SqlitePool, app_data_dir: PathBuf) -> Self {
        let repository = ProjectsRepository::new(db_pool.clone());
        let runs_repository = RunsRepository::new(db_pool.clone());
        let tasks_repository = TasksRepository::new(db_pool.clone());
        let projects_service = ProjectsService::new(repository);
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let runs_service = RunsService::new(runs_repository, worktrees_service.clone());
        let runs_diff_service = RunsDiffService::new(runs_service.clone(), app_data_dir.clone());
        let runs_opencode_service =
            RunsOpenCodeService::new(runs_service.clone(), app_data_dir.clone());
        let terminal_service = TerminalService::new(runs_service.clone(), app_data_dir);
        let tasks_service = TasksService::new(tasks_repository);
        Self {
            projects_service,
            runs_service,
            runs_diff_service,
            runs_opencode_service,
            tasks_service,
            worktrees_service,
            terminal_service,
        }
    }
}
