use crate::app::errors::AppError;
use crate::app::projects::service::ProjectsService;
use crate::app::runs::dto::{
    BootstrapRunOpenCodeResponse, EnsureRunOpenCodeResponse, OpenCodeDependencyStatusDto,
    RawAgentEvent, ReplyRunOpenCodePermissionResponse, RunAgentDto, RunAgentsResponseDto, RunDto,
    RunModelSelectionDto, RunOpenCodeChatModeDto, RunOpenCodeSessionMessageDto,
    RunOpenCodeSessionTodoDto, RunProviderDto, RunProvidersResponseDto,
    RunSelectionCatalogResponseDto, StartRunOpenCodeResponse, StopRunOpenCodeResponse,
    SubmitRunOpenCodePromptResponse,
};
use crate::app::runs::run_state_service::RunStateService;
use crate::app::runs::service::RunsService;
use crate::app::runs::status_transition_service::RunStatusTransitionService;
use crate::app::tasks::status_transition_service::TaskStatusTransitionService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use anyhow::{Context, Error as AnyhowError};
use chrono::Utc;
use git2::Repository;
use opencode::{
    create_opencode_client, create_opencode_server, types::PartInput, OpencodeClient,
    OpencodeClientConfig, OpencodeServer, OpencodeServerOptions, RequestOptions,
};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration, Instant};
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{error, info, warn};

#[derive(Debug, Error)]
enum OpenCodeServiceError {
    #[error("failed to lock {resource}")]
    LockPoisoned { resource: &'static str },

    #[allow(dead_code)]
    #[error("OpenCode run handle not found")]
    MissingRunHandle,

    #[error("OpenCode session create response missing id")]
    MissingSessionIdField,

    #[error("OpenCode session id was not persisted and no canonical value exists")]
    MissingCanonicalSessionId,

    #[error("failed to start OpenCode server")]
    ServerStart {
        #[source]
        source: opencode::Error,
    },

    #[error("failed to create OpenCode client")]
    ClientCreate {
        #[source]
        source: opencode::Error,
    },

    #[error("OpenCode health check failed")]
    HealthCheck {
        #[source]
        source: opencode::Error,
    },

    #[error("failed to create OpenCode session")]
    SessionCreate {
        #[source]
        source: opencode::Error,
    },

    #[error("failed to fetch OpenCode session messages for session '{session_id}'")]
    SessionMessages {
        session_id: String,
        #[source]
        source: opencode::Error,
    },

    #[error("failed to fetch OpenCode session todos for session '{session_id}'")]
    SessionTodos {
        session_id: String,
        #[source]
        source: opencode::Error,
    },

    #[error("failed to submit OpenCode prompt for run '{run_id}'")]
    PromptSubmit {
        run_id: String,
        #[source]
        source: opencode::Error,
    },

    #[error("failed to reply to OpenCode permission request '{request_id}'")]
    PermissionReply {
        request_id: String,
        #[source]
        source: opencode::Error,
    },

    #[error("failed to execute lifecycle script for run '{run_id}'")]
    LifecycleScriptSpawn {
        run_id: String,
        #[source]
        source: std::io::Error,
    },

    #[error("lifecycle script failed for run '{run_id}' (status: {exit_status}): {details}")]
    LifecycleScriptFailed {
        run_id: String,
        exit_status: String,
        details: String,
    },

    #[error("initial prompt claimant failed to finalize sent state")]
    InitialPromptFinalizeRejected,
}

fn format_error_chain<E>(err: &E) -> Option<String>
where
    E: std::error::Error + 'static,
{
    let mut chain = vec![err.to_string()];
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push(cause.to_string());
        source = cause.source();
    }

    Some(chain.join(": "))
}

fn app_error_from_anyhow(err: AnyhowError) -> AppError {
    let chain = err
        .chain()
        .map(|cause| cause.to_string())
        .collect::<Vec<_>>()
        .join(": ");
    AppError::validation(chain)
}

#[derive(Debug)]
struct LifecycleScriptExecutionError {
    app_error: AppError,
    failed_commands: Vec<String>,
}

impl LifecycleScriptExecutionError {
    fn failed_commands(&self) -> &[String] {
        &self.failed_commands
    }
}

impl From<AppError> for LifecycleScriptExecutionError {
    fn from(app_error: AppError) -> Self {
        Self {
            app_error,
            failed_commands: Vec::new(),
        }
    }
}

impl fmt::Display for LifecycleScriptExecutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.app_error.fmt(f)
    }
}

fn lock_error(resource: &'static str) -> AppError {
    app_error_from_anyhow(AnyhowError::new(OpenCodeServiceError::LockPoisoned {
        resource,
    }))
}

fn value_array_to_message_wrappers(value: serde_json::Value) -> Vec<RunOpenCodeSessionMessageDto> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .cloned()
                .map(|payload| RunOpenCodeSessionMessageDto { payload })
                .collect()
        })
        .unwrap_or_default()
}

fn value_array_to_todo_wrappers(value: serde_json::Value) -> Vec<RunOpenCodeSessionTodoDto> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .cloned()
                .map(|payload| RunOpenCodeSessionTodoDto { payload })
                .collect()
        })
        .unwrap_or_default()
}

fn to_nonempty_trimmed_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_opencode_server_options(
    cwd: PathBuf,
    project_env: HashMap<String, String>,
) -> OpencodeServerOptions {
    let mut options = OpencodeServerOptions {
        cwd: Some(cwd),
        ..Default::default()
    };
    options.port = 0;
    options.config = Some(serde_json::json!({}));
    options.env = project_env;
    options
}

fn build_permission_reply_body(session_id: &str, reply: &str, remember: bool) -> serde_json::Value {
    serde_json::json!({
        "sessionID": session_id,
        "reply": reply,
        "remember": remember,
    })
}

fn map_permission_decision_to_reply(decision: &str) -> Option<&'static str> {
    match decision {
        "deny" => Some("reject"),
        "once" => Some("once"),
        "always" => Some("always"),
        "reject" => Some("reject"),
        _ => None,
    }
}

fn parse_string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        let found = object.get(*key).and_then(|candidate| candidate.as_str());
        if let Some(found) = to_nonempty_trimmed_string(found) {
            return Some(found);
        }
    }
    None
}

fn collect_named_child_values<'a>(
    value: &'a serde_json::Value,
    keys: &[&str],
) -> Vec<&'a serde_json::Value> {
    let mut collected = Vec::new();
    if let Some(object) = value.as_object() {
        for key in keys {
            if let Some(child) = object.get(*key) {
                collected.push(child);
            }
        }
    }
    collected
}

fn parse_models_from_provider_value(
    provider_id: &str,
    provider_name: Option<&str>,
    value: &serde_json::Value,
) -> Vec<RunModelSelectionDto> {
    let mut models = Vec::new();

    let mut push_model = |model: &serde_json::Value, fallback_id: Option<&str>| {
        let model_id = parse_string_field(model, &["id", "modelID", "modelId", "key", "value"])
            .or_else(|| fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v))));
        let Some(model_id) = model_id else {
            return;
        };

        let model_name =
            parse_string_field(model, &["name", "title", "displayName", "display_name"])
                .or_else(|| fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v))));

        models.push(RunModelSelectionDto {
            provider_id: provider_id.to_string(),
            provider_name: provider_name.map(|name| name.to_string()),
            model_id,
            model_name,
        });
    };

    if let Some(array) = value.as_array() {
        for model in array {
            push_model(model, None);
        }
        return models;
    }

    if let Some(object) = value.as_object() {
        if parse_string_field(value, &["id", "modelID", "modelId"]).is_some() {
            push_model(value, None);
            return models;
        }

        for (key, model_value) in object {
            if model_value.is_object() || model_value.is_array() {
                push_model(model_value, Some(key));
            }
        }
    }

    models
}

fn parse_providers_from_payload(value: &serde_json::Value) -> Vec<RunProviderDto> {
    fn parse_provider_entry(
        entry: &serde_json::Value,
        fallback_id: Option<&str>,
        allow_fallback_id: bool,
    ) -> Option<RunProviderDto> {
        let id = parse_string_field(entry, &["id", "providerID", "providerId", "key", "value"])
            .or_else(|| {
                if allow_fallback_id {
                    fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v)))
                } else {
                    None
                }
            })?;
        let name = parse_string_field(entry, &["name", "title", "displayName", "display_name"])
            .or_else(|| fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v))));

        let mut model_values: Vec<&serde_json::Value> = Vec::new();
        if let Some(object) = entry.as_object() {
            for key in ["models", "model", "availableModels", "available_models"] {
                if let Some(models_value) = object.get(key) {
                    model_values.push(models_value);
                }
            }
        }

        let mut models = Vec::new();
        for models_value in model_values {
            models.extend(parse_models_from_provider_value(
                &id,
                name.as_deref(),
                models_value,
            ));
        }

        Some(RunProviderDto { id, name, models })
    }

    let mut providers = Vec::new();

    if let Some(array) = value.as_array() {
        for entry in array {
            if let Some(provider) = parse_provider_entry(entry, None, false) {
                providers.push(provider);
            }
        }
        return providers;
    }

    if value.as_object().is_some() {
        if parse_string_field(value, &["id", "providerID", "providerId"]).is_some() {
            if let Some(provider) = parse_provider_entry(value, None, false) {
                providers.push(provider);
            }
            return providers;
        }

        for child in collect_named_child_values(value, &["providers", "provider"]) {
            if let Some(array) = child.as_array() {
                for entry in array {
                    if let Some(provider) = parse_provider_entry(entry, None, false) {
                        providers.push(provider);
                    }
                }
                continue;
            }

            if let Some(child_object) = child.as_object() {
                if parse_string_field(child, &["id", "providerID", "providerId"]).is_some() {
                    if let Some(provider) = parse_provider_entry(child, None, false) {
                        providers.push(provider);
                    }
                    continue;
                }

                for (key, entry) in child_object {
                    if !entry.is_object() {
                        continue;
                    }
                    if let Some(provider) = parse_provider_entry(entry, Some(key), true) {
                        providers.push(provider);
                    }
                }
            }
        }
    }

    providers
}

fn merge_provider_options(sources: Vec<Vec<RunProviderDto>>) -> Vec<RunProviderDto> {
    let mut provider_order: Vec<String> = Vec::new();
    let mut provider_index: HashMap<String, usize> = HashMap::new();
    let mut merged: Vec<RunProviderDto> = Vec::new();

    for source in sources {
        for provider in source {
            let index = if let Some(existing) = provider_index.get(&provider.id) {
                *existing
            } else {
                let idx = merged.len();
                provider_index.insert(provider.id.clone(), idx);
                provider_order.push(provider.id.clone());
                merged.push(RunProviderDto {
                    id: provider.id.clone(),
                    name: provider.name.clone(),
                    models: Vec::new(),
                });
                idx
            };

            if merged[index].name.is_none() {
                merged[index].name = provider.name.clone();
            }

            let mut existing_models: HashSet<String> = merged[index]
                .models
                .iter()
                .map(|model| format!("{}::{}", model.provider_id, model.model_id))
                .collect();

            for model in provider.models {
                let key = format!("{}::{}", model.provider_id, model.model_id);
                if existing_models.insert(key) {
                    merged[index].models.push(model);
                }
            }
        }
    }

    merged.sort_by_key(|provider| {
        provider_order
            .iter()
            .position(|id| id == &provider.id)
            .unwrap_or(usize::MAX)
    });

    merged
}

fn parse_agents_from_config_payload(value: &serde_json::Value) -> Vec<RunAgentDto> {
    fn parse_agent_entry(
        entry: &serde_json::Value,
        fallback_id: Option<&str>,
        allow_fallback_id: bool,
    ) -> Option<RunAgentDto> {
        let id = parse_string_field(entry, &["id", "agentID", "agentId", "key", "value"]).or_else(
            || {
                if allow_fallback_id {
                    fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v)))
                } else {
                    None
                }
            },
        )?;
        let name = parse_string_field(entry, &["name", "title", "displayName", "display_name"])
            .or_else(|| fallback_id.and_then(|v| to_nonempty_trimmed_string(Some(v))));
        Some(RunAgentDto { id, name })
    }

    let mut agents = Vec::new();

    if let Some(array) = value.as_array() {
        for entry in array {
            if let Some(agent) = parse_agent_entry(entry, None, false) {
                agents.push(agent);
            }
        }
        return agents;
    }

    if value.as_object().is_some() {
        if parse_string_field(value, &["id", "agentID", "agentId"]).is_some() {
            if let Some(agent) = parse_agent_entry(value, None, false) {
                agents.push(agent);
            }
            return agents;
        }

        for child in collect_named_child_values(value, &["agents", "agent"]) {
            if let Some(array) = child.as_array() {
                for entry in array {
                    if let Some(agent) = parse_agent_entry(entry, None, false) {
                        agents.push(agent);
                    }
                }
                continue;
            }

            if let Some(child_object) = child.as_object() {
                if parse_string_field(child, &["id", "agentID", "agentId"]).is_some() {
                    if let Some(agent) = parse_agent_entry(child, None, false) {
                        agents.push(agent);
                    }
                    continue;
                }

                for (key, entry) in child_object {
                    if !entry.is_object() {
                        continue;
                    }
                    if let Some(agent) = parse_agent_entry(entry, Some(key), true) {
                        agents.push(agent);
                    }
                }
            }
        }
    }

    agents
}

fn dedupe_agents(agents: Vec<RunAgentDto>) -> Vec<RunAgentDto> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for agent in agents {
        if seen.insert(agent.id.clone()) {
            deduped.push(agent);
        }
    }
    deduped
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PromptSelection {
    agent: String,
    provider_id: String,
    model_id: String,
}

const MAX_BUFFERED_EVENTS: usize = 500;
const EVENT_BROADCAST_CAPACITY: usize = 512;
const STREAM_RECONNECT_BASE_DELAY_MS: u64 = 250;
const STREAM_RECONNECT_MAX_DELAY_MS: u64 = 8_000;
const STREAM_MAX_RECONNECT_ATTEMPTS: u32 = 8;

#[derive(Clone)]
pub struct RunsOpenCodeService {
    runs_service: RunsService,
    projects_service: ProjectsService,
    task_status_transition_service: TaskStatusTransitionService,
    run_state_service: RunStateService,
    run_status_transition_service: RunStatusTransitionService,
    worktrees_root: PathBuf,
    handles: Arc<RwLock<HashMap<String, Arc<RunOpenCodeHandle>>>>,
    init_locks: Arc<RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    shutdown_requests: Arc<RwLock<HashSet<String>>>,
    dependency_status: Arc<RwLock<Option<OpenCodeDependencyStatusDto>>>,
    dependency_check_lock: Arc<tokio::sync::Mutex<()>>,
    handle_generation: Arc<AtomicU64>,
}

impl std::fmt::Debug for RunsOpenCodeService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunsOpenCodeService")
            .field("worktrees_root", &self.worktrees_root)
            .finish_non_exhaustive()
    }
}

struct RunOpenCodeHandle {
    generation: u64,
    _server: Arc<tokio::sync::Mutex<OpencodeServer>>,
    client: OpencodeClient,
    lifecycle: Arc<Mutex<RunOpenCodeLifecycle>>,
    session_id: Arc<Mutex<Option<String>>>,
    session_init_lock: tokio::sync::Mutex<()>,
    subscribers: Arc<Mutex<HashMap<String, Channel<RawAgentEvent>>>>,
    subscriber_tasks: Arc<Mutex<HashMap<String, SubscriberTaskEntry>>>,
    subscriber_generation: AtomicU64,
    subscriber_lifecycle_lock: tokio::sync::Mutex<()>,
    event_tx: tokio::sync::broadcast::Sender<RawAgentEvent>,
    event_stream_task: Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>,
    buffered_events: Arc<Mutex<VecDeque<RawAgentEvent>>>,
    session_runtime_state: Arc<Mutex<SessionRuntimeState>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RunOpenCodeLifecycleState {
    Active,
    ShuttingDown,
    Stopped,
}

#[derive(Clone, Debug)]
struct RunOpenCodeLifecycle {
    run_id: String,
    run_status: Option<String>,
    is_read_only: bool,
    created_at: String,
    last_interaction_at: String,
    last_main_session_activity_at: Option<String>,
    shutdown_requested: bool,
    shutdown_reason: Option<String>,
    event_stream_task_registered: bool,
    state: RunOpenCodeLifecycleState,
}

impl RunOpenCodeHandle {
    fn sync_run_metadata(&self, run: &RunDto) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        lifecycle.run_status = Some(run.status.clone());
        lifecycle.is_read_only = matches!(run.status.as_str(), "complete" | "cancelled" | "failed");
        Ok(())
    }

    fn lifecycle_state(&self) -> Result<RunOpenCodeLifecycleState, AppError> {
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        Ok(lifecycle.state)
    }

    fn touch_interaction(&self) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        lifecycle.last_interaction_at = Utc::now().to_rfc3339();
        Ok(())
    }

    fn touch_main_session_activity(&self) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        let now = Utc::now().to_rfc3339();
        lifecycle.last_interaction_at = now.clone();
        lifecycle.last_main_session_activity_at = Some(now);
        Ok(())
    }

    fn register_event_stream_task(&self) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        lifecycle.event_stream_task_registered = true;
        Ok(())
    }

    fn request_shutdown(&self, reason: &str) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        lifecycle.shutdown_requested = true;
        lifecycle.shutdown_reason = Some(reason.to_string());
        lifecycle.state = RunOpenCodeLifecycleState::ShuttingDown;
        lifecycle.last_interaction_at = Utc::now().to_rfc3339();
        Ok(())
    }

    fn mark_stopped(&self) -> Result<(), AppError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| lock_error("OpenCode lifecycle state"))?;
        lifecycle.state = RunOpenCodeLifecycleState::Stopped;
        lifecycle.last_interaction_at = Utc::now().to_rfc3339();
        lifecycle.event_stream_task_registered = false;
        Ok(())
    }
}

struct SubscriberTaskEntry {
    generation: u64,
    handle: JoinHandle<()>,
}

struct SessionRuntimeState {
    last_status_hint: Option<String>,
    pending_questions: HashSet<String>,
    pending_permissions: HashSet<String>,
    idle_cleanup_ready: bool,
}

impl Default for SessionRuntimeState {
    fn default() -> Self {
        Self {
            last_status_hint: None,
            pending_questions: HashSet::new(),
            pending_permissions: HashSet::new(),
            idle_cleanup_ready: false,
        }
    }
}

impl RunsOpenCodeService {
    fn normalize_lifecycle_command_label(command: &str) -> Option<String> {
        let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return None;
        }

        const MAX_COMMAND_LABEL_LEN: usize = 120;
        if normalized.chars().count() <= MAX_COMMAND_LABEL_LEN {
            return Some(normalized);
        }

        let truncated = normalized
            .chars()
            .take(MAX_COMMAND_LABEL_LEN.saturating_sub(1))
            .collect::<String>();
        Some(format!("{}…", truncated.trim_end()))
    }

    fn parse_failed_lifecycle_commands(raw: &str) -> Vec<String> {
        let mut commands = Vec::new();
        for line in raw.lines() {
            let command = line
                .split_once('\t')
                .map(|(_, command)| command)
                .unwrap_or(line);
            let Some(command) = Self::normalize_lifecycle_command_label(command) else {
                continue;
            };
            if !commands.contains(&command) {
                commands.push(command);
            }
        }

        commands
    }

    fn script_contains_command(script: &str, command: &str) -> bool {
        Self::normalize_lifecycle_command_label(script)
            .is_some_and(|normalized_script| normalized_script.contains(command))
    }

    fn compose_cleanup_failure_prompt(failed_commands: &[String]) -> String {
        if failed_commands.is_empty() {
            return "Cleanup failed before the affected step could be identified. Please investigate the cleanup script and apply the appropriate fix.".to_string();
        }

        if failed_commands.len() == 1 {
            return format!(
                "The cleanup step `{}` failed. Please investigate the failure and apply the appropriate fix.",
                failed_commands[0]
            );
        }

        let command_list = failed_commands
            .iter()
            .map(|command| format!("- `{command}`"))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "The following cleanup steps failed:\n{command_list}\nPlease investigate these failures and apply the appropriate fixes."
        )
    }

    async fn handle_session_idle_signal(
        &self,
        run_id: &str,
        session_id: &str,
        source_event: &str,
        require_cleanup_ready: bool,
        session_runtime_state: &Arc<Mutex<SessionRuntimeState>>,
    ) -> Result<(), AppError> {
        let should_block = {
            let mut state = session_runtime_state
                .lock()
                .map_err(|_| lock_error("OpenCode session runtime state"))?;
            if !state.pending_questions.is_empty()
                || !state.pending_permissions.is_empty()
                || (require_cleanup_ready && !state.idle_cleanup_ready)
            {
                true
            } else {
                if require_cleanup_ready {
                    state.idle_cleanup_ready = false;
                }
                false
            }
        };

        if should_block {
            return Ok(());
        }

        let run = self.runs_service.get_run_model(run_id).await?;
        let context = self
            .runs_service
            .get_run_initial_prompt_context(run_id)
            .await?;
        let _ = self.runs_service.mark_cleanup_running(run_id).await?;
        let cleanup_result = self
            .run_lifecycle_script_in_worktree(run_id, context.cleanup_script.as_deref())
            .await;
        match cleanup_result {
            Ok(()) => {
                let _ = self.runs_service.mark_cleanup_succeeded(run_id).await?;
                let _ = self
                    .run_status_transition_service
                    .handle_agent_waiting(&run.task_id, run_id, session_id, source_event)
                    .await?;
                let _ = self
                    .task_status_transition_service
                    .handle_agent_turn_completed(&run.task_id, run_id, session_id, source_event)
                    .await?;
            }
            Err(err) => {
                let error_text = err.to_string();
                let failure_prompt = Self::compose_cleanup_failure_prompt(err.failed_commands());
                let _ = self
                    .runs_service
                    .mark_cleanup_failed(run_id, &error_text)
                    .await?;
                let _ = self
                    .submit_run_opencode_prompt(
                        run_id,
                        &failure_prompt,
                        None,
                        None,
                        None,
                        None,
                        None,
                    )
                    .await;
            }
        }

        Ok(())
    }

    fn resolve_prompt_selection(
        run_defaults_agent: Option<&str>,
        run_defaults_provider_id: Option<&str>,
        run_defaults_model_id: Option<&str>,
        prompt_agent: Option<&str>,
        prompt_provider_id: Option<&str>,
        prompt_model_id: Option<&str>,
    ) -> Result<PromptSelection, AppError> {
        let prompt_agent = to_nonempty_trimmed_string(prompt_agent);
        let prompt_provider = to_nonempty_trimmed_string(prompt_provider_id);
        let prompt_model = to_nonempty_trimmed_string(prompt_model_id);
        let run_provider = to_nonempty_trimmed_string(run_defaults_provider_id);
        let run_model = to_nonempty_trimmed_string(run_defaults_model_id);

        if prompt_provider.is_some() ^ prompt_model.is_some() {
            return Err(AppError::validation(
                "prompt provider and model must be provided together",
            ));
        }

        if prompt_agent.is_some() && prompt_provider.is_none() {
            return Err(AppError::validation(
                "prompt agent override requires provider and model overrides",
            ));
        }

        let (provider_id, model_id) =
            if let (Some(provider_id), Some(model_id)) = (prompt_provider, prompt_model) {
                (provider_id, model_id)
            } else if let (Some(provider_id), Some(model_id)) = (run_provider, run_model) {
                (provider_id, model_id)
            } else {
                ("kimi-for-coding".to_string(), "k2p5".to_string())
            };

        let agent = prompt_agent
            .or_else(|| to_nonempty_trimmed_string(run_defaults_agent))
            .unwrap_or_else(|| "build".to_string());

        Ok(PromptSelection {
            agent,
            provider_id,
            model_id,
        })
    }

    async fn event_matches_current_run_session(
        &self,
        run_id: &str,
        session_id: &str,
    ) -> Result<bool, AppError> {
        let run = self.runs_service.get_run_model(run_id).await?;
        let current = run
            .opencode_session_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty());

        Ok(current.as_deref() == Some(session_id.trim()))
    }

    fn parse_payload_property(payload: &str, keys: &[&str]) -> Option<String> {
        let value: serde_json::Value = serde_json::from_str(payload).ok()?;
        let object = value.as_object()?;
        let properties = object.get("properties").and_then(|value| value.as_object());
        for source in [Some(object), properties] {
            let Some(source) = source else {
                continue;
            };
            for key in keys {
                let value = source.get(*key).and_then(|value| value.as_str());
                if let Some(value) = value {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }

    fn parse_permission_request_id(payload: &str) -> Option<String> {
        // Live OpenCode permission events commonly send request id in properties.id.
        // Keep requestID/requestId first for backwards-compatibility, then fall back.
        Self::parse_payload_property(
            payload,
            &[
                "requestID",
                "requestId",
                "id",
                "permissionID",
                "permissionId",
            ],
        )
    }

    fn parse_status_hint(payload: &str) -> Option<String> {
        let value: serde_json::Value = serde_json::from_str(payload).ok()?;
        let object = value.as_object()?;
        let properties = object.get("properties").and_then(|value| value.as_object());

        for source in [Some(object), properties] {
            let Some(source) = source else {
                continue;
            };
            let Some(status) = source.get("status") else {
                continue;
            };

            if let Some(status) = status.as_str() {
                let trimmed = status.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
                continue;
            }

            let Some(status_obj) = status.as_object() else {
                continue;
            };
            let Some(status_type) = status_obj.get("type").and_then(|value| value.as_str()) else {
                continue;
            };
            let trimmed = status_type.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        None
    }

    async fn process_runtime_event(
        &self,
        run_id: &str,
        event_name: &str,
        payload: &str,
        session_runtime_state: &Arc<Mutex<SessionRuntimeState>>,
    ) -> Result<(), AppError> {
        let runtime_event_name = if event_name == "message" {
            Self::parse_payload_property(payload, &["type"])
                .unwrap_or_else(|| event_name.to_string())
        } else {
            event_name.to_string()
        };

        match runtime_event_name.as_str() {
            "session.status" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };

                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                let Some(status) = Self::parse_status_hint(payload) else {
                    return Ok(());
                };

                if status != "busy" && status != "idle" && status != "active" && status != "error" {
                    return Ok(());
                }

                let should_handle_idle = {
                    let mut state = session_runtime_state
                        .lock()
                        .map_err(|_| lock_error("OpenCode session runtime state"))?;
                    state.last_status_hint = Some(status.clone());
                    if state.last_status_hint.as_deref() == Some("busy")
                        || state.last_status_hint.as_deref() == Some("active")
                    {
                        state.idle_cleanup_ready = true;
                    }
                    status == "idle"
                };

                if should_handle_idle {
                    return self
                        .handle_session_idle_signal(
                            run_id,
                            &session_id,
                            "session.status=idle",
                            true,
                            session_runtime_state,
                        )
                        .await;
                }

                Ok(())
            }
            "question.asked" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };
                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                let Some(request_id) =
                    Self::parse_payload_property(payload, &["requestID", "requestId"])
                else {
                    return Ok(());
                };
                {
                    let mut state = session_runtime_state
                        .lock()
                        .map_err(|_| lock_error("OpenCode session runtime state"))?;
                    state.pending_questions.insert(request_id);
                }
                let _ = self
                    .run_state_service
                    .handle_waiting_for_input(run_id, "question_asked")
                    .await?;
                Ok(())
            }
            "question.replied" | "question.rejected" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };
                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                let Some(request_id) =
                    Self::parse_payload_property(payload, &["requestID", "requestId"])
                else {
                    return Ok(());
                };
                {
                    let mut state = session_runtime_state
                        .lock()
                        .map_err(|_| lock_error("OpenCode session runtime state"))?;
                    state.pending_questions.remove(&request_id);
                }
                let _ = self.run_state_service.handle_user_replied(run_id).await?;
                Ok(())
            }
            "permission.asked" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };
                let request_id_hint = Self::parse_permission_request_id(payload);
                let permission_kind = Self::parse_payload_property(
                    payload,
                    &["kind", "permission", "tool", "action"],
                );
                info!(
                    target: "opencode.runtime",
                    marker = "permission_event_received",
                    run_id = run_id,
                    event = "permission.asked",
                    session_id = session_id,
                    request_id = request_id_hint.as_deref().unwrap_or(""),
                    request_id_fields = "requestID|requestId|id|permissionID|permissionId",
                    permission_type = permission_kind.as_deref().unwrap_or(""),
                    "Received OpenCode permission event"
                );
                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                let Some(request_id) = Self::parse_permission_request_id(payload) else {
                    return Ok(());
                };
                let (was_new, pending_count) = {
                    let mut state = session_runtime_state
                        .lock()
                        .map_err(|_| lock_error("OpenCode session runtime state"))?;
                    let was_new = state.pending_permissions.insert(request_id.clone());
                    let pending_count = state.pending_permissions.len();
                    (was_new, pending_count)
                };
                info!(
                    target: "opencode.runtime",
                    marker = "permission_pending_added",
                    run_id = run_id,
                    event = "permission.asked",
                    session_id = session_id,
                    request_id = request_id,
                    permission_type = permission_kind.as_deref().unwrap_or(""),
                    pending_count = pending_count,
                    was_new = was_new,
                    "Tracked pending permission request"
                );
                let _ = self
                    .run_state_service
                    .handle_permission_requested(run_id)
                    .await?;
                Ok(())
            }
            "permission.replied" | "permission.rejected" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };
                let request_id_hint = Self::parse_permission_request_id(payload);
                info!(
                    target: "opencode.runtime",
                    marker = "permission_event_received",
                    run_id = run_id,
                    event = runtime_event_name.as_str(),
                    session_id = session_id,
                    request_id = request_id_hint.as_deref().unwrap_or(""),
                    request_id_fields = "requestID|requestId|id|permissionID|permissionId",
                    "Received OpenCode permission resolution event"
                );
                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                let Some(request_id) = Self::parse_permission_request_id(payload) else {
                    return Ok(());
                };
                let (removed, pending_count) = {
                    let mut state = session_runtime_state
                        .lock()
                        .map_err(|_| lock_error("OpenCode session runtime state"))?;
                    let removed = state.pending_permissions.remove(&request_id);
                    let pending_count = state.pending_permissions.len();
                    (removed, pending_count)
                };
                info!(
                    target: "opencode.runtime",
                    marker = "permission_pending_cleared",
                    run_id = run_id,
                    event = runtime_event_name.as_str(),
                    session_id = session_id,
                    request_id = request_id,
                    pending_count = pending_count,
                    removed = removed,
                    "Cleared pending permission request from runtime state"
                );
                let _ = self
                    .run_state_service
                    .handle_permission_resolved(run_id)
                    .await?;
                Ok(())
            }
            "session.idle" => {
                let Some(session_id) =
                    Self::parse_payload_property(payload, &["sessionID", "sessionId"])
                else {
                    return Ok(());
                };

                if !self
                    .event_matches_current_run_session(run_id, &session_id)
                    .await?
                {
                    return Ok(());
                }

                self.handle_session_idle_signal(
                    run_id,
                    &session_id,
                    "session.idle",
                    false,
                    session_runtime_state,
                )
                .await
            }
            _ => Ok(()),
        }
    }

    fn initial_seed_request_id_for_run(run_id: &str) -> String {
        format!("initial-run-message:{run_id}")
    }

    fn is_initial_seed_request(run_id: &str, client_request_id: Option<&str>) -> bool {
        let Some(request_id) = client_request_id else {
            return false;
        };

        request_id.trim() == Self::initial_seed_request_id_for_run(run_id)
    }

    fn unsupported_reason_for_run_status(status: &str) -> Option<String> {
        if matches!(status, "complete" | "failed" | "cancelled") {
            return Some(format!("run status '{}' is not supported", status));
        }

        if !matches!(status, "queued" | "preparing" | "in_progress" | "idle") {
            return Some(format!("run status '{}' is not supported", status));
        }

        None
    }

    fn compute_stream_connected(buffered_events: &[RawAgentEvent]) -> bool {
        for event in buffered_events.iter().rev() {
            match event.event_name.as_str() {
                "stream.disconnected" | "stream.reconnecting" | "stream.terminated" => {
                    return false
                }
                "stream.reconnected" => return true,
                _ => {}
            }
        }

        true
    }

    async fn fetch_session_history_with_client(
        client: &OpencodeClient,
        session_id: &str,
    ) -> Result<
        (
            Vec<RunOpenCodeSessionMessageDto>,
            Vec<RunOpenCodeSessionTodoDto>,
        ),
        AppError,
    > {
        let request = RequestOptions::default().with_path("id", session_id.to_string());
        let messages_response = client
            .session()
            .messages(request)
            .await
            .map_err(|source| OpenCodeServiceError::SessionMessages {
                session_id: session_id.to_string(),
                source,
            })
            .with_context(|| {
                format!("while fetching OpenCode message history for session '{session_id}'")
            })
            .map_err(app_error_from_anyhow)?;

        let request = RequestOptions::default().with_path("id", session_id.to_string());
        let todos_response = client
            .session()
            .todo(request)
            .await
            .map_err(|source| OpenCodeServiceError::SessionTodos {
                session_id: session_id.to_string(),
                source,
            })
            .with_context(|| {
                format!("while fetching OpenCode todo history for session '{session_id}'")
            })
            .map_err(app_error_from_anyhow)?;

        Ok((
            value_array_to_message_wrappers(messages_response.data),
            value_array_to_todo_wrappers(todos_response.data),
        ))
    }

    fn normalize_initial_prompt_field(value: Option<&str>) -> String {
        let Some(value) = value else {
            return String::new();
        };

        let trimmed = value.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        let mut normalized = String::with_capacity(trimmed.len());
        let mut newline_count = 0u8;
        for ch in trimmed.chars() {
            if ch == '\r' {
                continue;
            }
            if ch == '\n' {
                newline_count = newline_count.saturating_add(1);
                if newline_count <= 2 {
                    normalized.push('\n');
                }
                continue;
            }
            newline_count = 0;
            normalized.push(ch);
        }

        normalized.trim().to_string()
    }

    fn compose_initial_prompt(
        task_title: &str,
        description: Option<&str>,
        implementation_guide: Option<&str>,
    ) -> String {
        let title = Self::normalize_initial_prompt_field(Some(task_title));
        let description = Self::normalize_initial_prompt_field(description);
        let implementation_guide = Self::normalize_initial_prompt_field(implementation_guide);

        let mut sections: Vec<String> = Vec::new();
        if !title.is_empty() {
            sections.push(title);
        }
        if !description.is_empty() {
            sections.push(description);
        }
        if !implementation_guide.is_empty() {
            sections.push(format!("Implementation guide:\n{}", implementation_guide));
        }

        if sections.is_empty() {
            return "Please continue with the current task.".to_string();
        }

        sections.join("\n\n")
    }

    async fn run_lifecycle_script_in_worktree(
        &self,
        run_id: &str,
        script: Option<&str>,
    ) -> Result<(), LifecycleScriptExecutionError> {
        let script = script.map(str::trim).filter(|script| !script.is_empty());
        let Some(script) = script else {
            return Ok(());
        };

        info!(
            target: "opencode.runtime",
            subsystem = "runs.opencode",
            operation = "lifecycle_script",
            run_id = run_id,
            "Executing lifecycle script"
        );

        let run = self
            .runs_service
            .get_run(run_id)
            .await
            .map_err(LifecycleScriptExecutionError::from)?;
        let worktree_path = self
            .resolve_worktree_path(&run)
            .map_err(LifecycleScriptExecutionError::from)?;
        let failure_log_path = std::env::temp_dir().join(format!(
            "orkestraos-lifecycle-failures-{}.log",
            uuid::Uuid::new_v4()
        ));
        let wrapped_script = format!(
            r#"set -E
set -o pipefail
failure_log_path="${{ORK_LIFECYCLE_FAILURE_LOG_PATH:?}}"
: > "$failure_log_path"
trap 'status=$?; command=${{BASH_COMMAND:-}}; if [ "$status" -ne 0 ] && [ -n "$command" ]; then printf "%s\t%s\n" "$status" "$command" >> "$failure_log_path"; fi' ERR
{script}"#
        );
        let output = Command::new("bash")
            .arg("--noprofile")
            .arg("--norc")
            .arg("-lc")
            .arg(&wrapped_script)
            .env("ORK_LIFECYCLE_FAILURE_LOG_PATH", &failure_log_path)
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|source| OpenCodeServiceError::LifecycleScriptSpawn {
                run_id: run_id.to_string(),
                source,
            })
            .with_context(|| format!("while executing lifecycle script for run '{run_id}'"))
            .map_err(app_error_from_anyhow)
            .map_err(LifecycleScriptExecutionError::from)?;

        if output.status.success() {
            let _ = std::fs::remove_file(&failure_log_path);
            info!(
                target: "opencode.runtime",
                subsystem = "runs.opencode",
                operation = "lifecycle_script",
                run_id = run_id,
                "Lifecycle script completed successfully"
            );
            return Ok(());
        }

        let failed_commands = std::fs::read_to_string(&failure_log_path)
            .ok()
            .map(|raw| Self::parse_failed_lifecycle_commands(&raw))
            .map(|commands| {
                commands
                    .into_iter()
                    .filter(|command| Self::script_contains_command(script, command))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let _ = std::fs::remove_file(&failure_log_path);

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        warn!(
            target: "opencode.runtime",
            subsystem = "runs.opencode",
            operation = "lifecycle_script",
            run_id = run_id,
            exit_status = output.status.to_string(),
            "Lifecycle script failed"
        );
        Err(LifecycleScriptExecutionError {
            app_error: app_error_from_anyhow(AnyhowError::new(
                OpenCodeServiceError::LifecycleScriptFailed {
                    run_id: run_id.to_string(),
                    exit_status: output.status.to_string(),
                    details,
                },
            )),
            failed_commands,
        })
    }

    async fn ensure_run_ready_for_operation(
        &self,
        run_id: &str,
    ) -> Result<
        (
            EnsureRunOpenCodeResponse,
            Option<Arc<RunOpenCodeHandle>>,
            &'static str,
        ),
        AppError,
    > {
        if let Some(handle) = self.handles.read().await.get(run_id).cloned() {
            handle.touch_interaction()?;
            let run = self.runs_service.get_run(run_id).await?;
            handle.sync_run_metadata(&run)?;
            if let Some(reason) = Self::unsupported_reason_for_run_status(run.status.as_str()) {
                return Ok((
                    EnsureRunOpenCodeResponse {
                        state: "unsupported".to_string(),
                        reason: Some(reason),
                    },
                    None,
                    "unsupported",
                ));
            }

            if handle.lifecycle_state()? != RunOpenCodeLifecycleState::Active {
                return Err(AppError::conflict(
                    "OpenCode run runtime is shutting down and cannot accept new work",
                ));
            }

            return Ok((
                EnsureRunOpenCodeResponse {
                    state: "running".to_string(),
                    reason: None,
                },
                Some(handle),
                "warm_handle",
            ));
        }

        let ensured = self.ensure_run_opencode(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok((ensured, None, "unsupported"));
        }

        let handle = self.handles.read().await.get(run_id).cloned();
        Ok((ensured, handle, "cold_ensure"))
    }

    async fn get_or_create_session_id(
        &self,
        run_id: &str,
        handle: Arc<RunOpenCodeHandle>,
    ) -> Result<String, AppError> {
        let _session_guard = handle.session_init_lock.lock().await;

        let run = self.runs_service.get_run_model(run_id).await?;
        let persisted_session_id = run.opencode_session_id.filter(|id| !id.trim().is_empty());

        let in_memory_session_id = {
            let session_guard = handle
                .session_id
                .lock()
                .map_err(|_| lock_error("OpenCode session id"))?;
            session_guard.clone()
        };

        if let Some(existing) = persisted_session_id.or(in_memory_session_id) {
            let mut session_guard = handle
                .session_id
                .lock()
                .map_err(|_| lock_error("OpenCode session id"))?;
            if session_guard.is_none() {
                *session_guard = Some(existing.clone());
            }
            return Ok(existing);
        }

        let create_start = Instant::now();
        handle.touch_interaction()?;
        let created = handle
            .client
            .session()
            .create(RequestOptions::default())
            .await
            .map_err(|source| OpenCodeServiceError::SessionCreate { source })
            .with_context(|| format!("while creating OpenCode session for run '{run_id}'"))
            .map_err(app_error_from_anyhow)?;
        let id = created
            .data
            .get("id")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .ok_or_else(|| {
                app_error_from_anyhow(AnyhowError::new(
                    OpenCodeServiceError::MissingSessionIdField,
                ))
            })?;
        info!(
            target: "opencode.runtime",
            marker = "session_create",
            run_id = run_id,
            latency_ms = create_start.elapsed().as_millis() as u64,
            "OpenCode session created"
        );

        let persisted = self
            .runs_service
            .set_run_opencode_session_id_if_unset(run_id, &id)
            .await?;

        let canonical_session_id = if persisted {
            id.clone()
        } else {
            let canonical_run = self.runs_service.get_run_model(run_id).await?;
            canonical_run
                .opencode_session_id
                .filter(|existing| !existing.trim().is_empty())
                .ok_or_else(|| {
                    app_error_from_anyhow(AnyhowError::new(
                        OpenCodeServiceError::MissingCanonicalSessionId,
                    ))
                })?
        };

        let mut session_guard = handle
            .session_id
            .lock()
            .map_err(|_| lock_error("OpenCode session id"))?;
        if let Some(existing) = session_guard.as_ref() {
            Ok(existing.clone())
        } else {
            *session_guard = Some(canonical_session_id.clone());
            Ok(canonical_session_id)
        }
    }

    async fn release_initial_seed_claim_if_claimant(
        &self,
        run_id: &str,
        claim_request_id: Option<&str>,
    ) -> Result<(), AppError> {
        let Some(claim_request_id) = claim_request_id else {
            return Ok(());
        };

        let _ = self
            .runs_service
            .release_initial_prompt_claim_for_claimant(run_id, claim_request_id)
            .await?;
        Ok(())
    }

    fn push_event(
        event_tx: &tokio::sync::broadcast::Sender<RawAgentEvent>,
        buffered_events: &Arc<Mutex<VecDeque<RawAgentEvent>>>,
        event_name: impl Into<String>,
        payload: impl Into<String>,
    ) {
        let agent_event = RawAgentEvent {
            timestamp: Utc::now().to_rfc3339(),
            event_name: event_name.into(),
            payload: payload.into(),
        };

        if let Ok(mut buffered) = buffered_events.lock() {
            if buffered.len() >= MAX_BUFFERED_EVENTS {
                buffered.pop_front();
            }
            buffered.push_back(agent_event.clone());
        }

        let _ = event_tx.send(agent_event);
    }

    pub fn new(
        runs_service: RunsService,
        projects_service: ProjectsService,
        task_status_transition_service: TaskStatusTransitionService,
        run_state_service: RunStateService,
        run_status_transition_service: RunStatusTransitionService,
        app_data_dir: PathBuf,
    ) -> Self {
        Self {
            runs_service,
            projects_service,
            task_status_transition_service,
            run_state_service,
            run_status_transition_service,
            worktrees_root: app_data_dir.join("worktrees"),
            handles: Arc::new(RwLock::new(HashMap::new())),
            init_locks: Arc::new(RwLock::new(HashMap::new())),
            shutdown_requests: Arc::new(RwLock::new(HashSet::new())),
            dependency_status: Arc::new(RwLock::new(None)),
            dependency_check_lock: Arc::new(tokio::sync::Mutex::new(())),
            handle_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    fn build_run_lifecycle(run: &RunDto) -> RunOpenCodeLifecycle {
        let now = Utc::now().to_rfc3339();
        RunOpenCodeLifecycle {
            run_id: run.id.clone(),
            run_status: Some(run.status.clone()),
            is_read_only: matches!(run.status.as_str(), "complete" | "cancelled" | "failed"),
            created_at: now.clone(),
            last_interaction_at: now,
            last_main_session_activity_at: None,
            shutdown_requested: false,
            shutdown_reason: None,
            event_stream_task_registered: false,
            state: RunOpenCodeLifecycleState::Active,
        }
    }

    async fn mark_shutdown_requested(&self, run_id: &str) {
        self.shutdown_requests
            .write()
            .await
            .insert(run_id.to_string());
    }

    async fn clear_shutdown_requested(&self, run_id: &str) {
        self.shutdown_requests.write().await.remove(run_id);
    }

    async fn is_shutdown_requested(&self, run_id: &str) -> bool {
        self.shutdown_requests.read().await.contains(run_id)
    }

    async fn remove_run_handle(&self, run_id: &str) -> (Option<Arc<RunOpenCodeHandle>>, bool) {
        let handle = self.handles.write().await.remove(run_id);
        let init_lock_removed = self.init_locks.write().await.remove(run_id).is_some();
        (handle, init_lock_removed)
    }

    async fn abort_event_stream_task(&self, run_id: &str, handle: &RunOpenCodeHandle) -> bool {
        let event_stream_task = handle.event_stream_task.lock().await.take();
        if let Some(task) = event_stream_task {
            task.abort();
            info!(
                target: "opencode.runtime",
                marker = "shutdown_event_stream_aborted",
                run_id = run_id,
                "OpenCode event stream task aborted"
            );
            true
        } else {
            false
        }
    }

    fn abort_subscriber_tasks(
        &self,
        run_id: &str,
        handle: &RunOpenCodeHandle,
    ) -> Result<usize, AppError> {
        let mut subscriber_tasks = handle
            .subscriber_tasks
            .lock()
            .map_err(|_| lock_error("OpenCode subscriber tasks"))?;
        let task_count = subscriber_tasks.len();
        for (_, entry) in subscriber_tasks.drain() {
            entry.handle.abort();
        }

        handle
            .subscribers
            .lock()
            .map_err(|_| lock_error("OpenCode subscribers"))?
            .clear();

        info!(
            target: "opencode.runtime",
            marker = "shutdown_subscribers_aborted",
            run_id = run_id,
            subscriber_task_count = task_count,
            "OpenCode subscriber tasks aborted"
        );

        Ok(task_count)
    }

    async fn stop_run_opencode_internal(
        &self,
        run_id: &str,
        reason: &str,
        abort_event_stream_task: bool,
    ) -> Result<StopRunOpenCodeResponse, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let reason = reason.trim();
        let reason = if reason.is_empty() {
            "shutdown_requested"
        } else {
            reason
        };

        self.mark_shutdown_requested(run_id).await;
        info!(
            target: "opencode.runtime",
            marker = "shutdown_requested",
            run_id = run_id,
            reason = reason,
            "OpenCode runtime shutdown requested"
        );

        let stopped_at = Utc::now().to_rfc3339();
        let (handle, init_lock_removed) = self.remove_run_handle(run_id).await;

        let response = if let Some(handle) = handle {
            handle.request_shutdown(reason)?;

            if abort_event_stream_task {
                self.abort_event_stream_task(run_id, &handle).await;
            }

            let _subscriber_count = self.abort_subscriber_tasks(run_id, &handle)?;
            handle.mark_stopped()?;

            info!(
                target: "opencode.runtime",
                marker = "shutdown_handle_removed",
                run_id = run_id,
                reason = reason,
                init_lock_removed = init_lock_removed,
                "OpenCode runtime handle removed"
            );

            drop(handle);

            info!(
                target: "opencode.runtime",
                marker = "shutdown_complete",
                run_id = run_id,
                reason = reason,
                "OpenCode runtime teardown completed"
            );

            StopRunOpenCodeResponse {
                state: "stopped".to_string(),
                reason: Some(reason.to_string()),
                stopped_at,
            }
        } else {
            info!(
                target: "opencode.runtime",
                marker = "shutdown_noop",
                run_id = run_id,
                reason = reason,
                init_lock_removed = init_lock_removed,
                "OpenCode runtime shutdown found no active handle"
            );

            StopRunOpenCodeResponse {
                state: "stopped".to_string(),
                reason: Some(reason.to_string()),
                stopped_at,
            }
        };

        self.clear_shutdown_requested(run_id).await;
        Ok(response)
    }

    pub async fn stop_run_opencode(
        &self,
        run_id: &str,
        reason: Option<&str>,
    ) -> Result<StopRunOpenCodeResponse, AppError> {
        self.stop_run_opencode_internal(run_id, reason.unwrap_or("shutdown_requested"), true)
            .await
    }

    fn missing_dependency_reason() -> String {
        "OpenCode is required for run and agent workflows, but it was not detected on this system. Install OpenCode and check again.".to_string()
    }

    fn failed_dependency_reason(message: &str) -> String {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return "OpenCode was detected, but it could not be started.".to_string();
        }

        format!("OpenCode was detected, but it could not be started: {trimmed}")
    }

    fn dependency_status_from_error(err: &opencode::Error) -> OpenCodeDependencyStatusDto {
        match err {
            opencode::Error::CLINotFound(_) => OpenCodeDependencyStatusDto {
                state: "missing".to_string(),
                reason: Some(Self::missing_dependency_reason()),
            },
            _ => OpenCodeDependencyStatusDto {
                state: "failure".to_string(),
                reason: Some(Self::failed_dependency_reason(&err.to_string())),
            },
        }
    }

    async fn detect_opencode_dependency(&self) -> OpenCodeDependencyStatusDto {
        let cwd = if self.worktrees_root.exists() {
            self.worktrees_root.clone()
        } else {
            self.worktrees_root
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
        };
        let options = build_opencode_server_options(cwd.clone(), HashMap::new());

        let server = match create_opencode_server(Some(options)).await {
            Ok(server) => server,
            Err(err) => return Self::dependency_status_from_error(&err),
        };

        let client = match create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(cwd.to_string_lossy().to_string()),
            timeout: Duration::from_secs(10),
            ..Default::default()
        })) {
            Ok(client) => client,
            Err(err) => {
                return OpenCodeDependencyStatusDto {
                    state: "failure".to_string(),
                    reason: Some(Self::failed_dependency_reason(&err.to_string())),
                };
            }
        };

        match client.global().health(RequestOptions::default()).await {
            Ok(_) => OpenCodeDependencyStatusDto {
                state: "available".to_string(),
                reason: None,
            },
            Err(err) => OpenCodeDependencyStatusDto {
                state: "failure".to_string(),
                reason: Some(Self::failed_dependency_reason(&err.to_string())),
            },
        }
    }

    pub async fn get_opencode_dependency_status(
        &self,
        force_refresh: bool,
    ) -> Result<OpenCodeDependencyStatusDto, AppError> {
        if !force_refresh {
            if let Some(cached) = self.dependency_status.read().await.clone() {
                return Ok(cached);
            }
        }

        let _guard = self.dependency_check_lock.lock().await;

        if !force_refresh {
            if let Some(cached) = self.dependency_status.read().await.clone() {
                return Ok(cached);
            }
        }

        let status = self.detect_opencode_dependency().await;
        *self.dependency_status.write().await = Some(status.clone());
        Ok(status)
    }

    async fn with_ephemeral_client<T, F>(&self, cwd: PathBuf, op: F) -> Result<T, AppError>
    where
        F: for<'a> FnOnce(
            &'a OpencodeClient,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, AppError>> + Send + 'a>,
        >,
    {
        let options = build_opencode_server_options(cwd, HashMap::new());

        let server = create_opencode_server(Some(options))
            .await
            .map_err(|source| OpenCodeServiceError::ServerStart { source })
            .context("while creating ephemeral OpenCode server")
            .map_err(app_error_from_anyhow)?;
        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            timeout: Duration::from_secs(30),
            ..Default::default()
        }))
        .map_err(|source| OpenCodeServiceError::ClientCreate { source })
        .context("while creating ephemeral OpenCode client")
        .map_err(app_error_from_anyhow)?;

        op(&client).await
    }

    async fn resolve_project_repo_root(&self, project_id: &str) -> Result<PathBuf, AppError> {
        let project = self.projects_service.get_project(project_id).await?;
        let default_repo_id = project
            .project
            .default_repo_id
            .ok_or_else(|| AppError::validation("project default repository is missing"))?;
        let default_repo = project
            .repositories
            .into_iter()
            .find(|repo| repo.id == default_repo_id)
            .ok_or_else(|| AppError::validation("project default repository was not found"))?;

        let configured_repo_path = default_repo.repo_path.trim();
        if configured_repo_path.is_empty() {
            return Err(AppError::validation(
                "project default repository path is empty",
            ));
        }

        let configured_path = PathBuf::from(configured_repo_path);
        let canonical_configured_path =
            std::fs::canonicalize(&configured_path).map_err(|error| {
                AppError::validation(format!(
                    "project default repository path is invalid or stale: {} ({error})",
                    configured_path.display()
                ))
            })?;

        if !canonical_configured_path.is_dir() {
            return Err(AppError::validation(format!(
                "project default repository path is not a directory: {}",
                canonical_configured_path.display()
            )));
        }

        let repo = Repository::discover(&canonical_configured_path).map_err(|error| {
            AppError::validation(format!(
                "project default repository path is not inside a git repository: {} ({error})",
                canonical_configured_path.display()
            ))
        })?;

        let git_root = repo.workdir().ok_or_else(|| {
            AppError::validation(
                "project default repository must resolve to a non-bare git workdir",
            )
        })?;
        let canonical_git_root = std::fs::canonicalize(git_root).map_err(|error| {
            AppError::validation(format!(
                "failed to canonicalize project git repository root: {} ({error})",
                git_root.display()
            ))
        })?;

        info!(
            target: "opencode.discovery",
            marker = "resolve_root",
            project_id,
            configured_repo_path = configured_path.display().to_string(),
            resolved_git_root = canonical_git_root.display().to_string(),
            "Resolved OpenCode canonical project repository root"
        );

        Ok(canonical_git_root)
    }

    async fn detect_opencode_selection_catalog(
        &self,
        project_id: &str,
    ) -> Result<RunSelectionCatalogResponseDto, AppError> {
        let canonical_repo_root = self.resolve_project_repo_root(project_id).await?;
        info!(
            target: "opencode.discovery",
            marker = "start",
            project_id,
            repo_root = canonical_repo_root.display().to_string(),
            "Starting OpenCode selection discovery"
        );

        let detection_started = Instant::now();
        let result = self
            .with_ephemeral_client(canonical_repo_root.clone(), |client| {
                Box::pin(async move {
                    let provider_list_response = client
                        .provider()
                        .list(RequestOptions::default())
                        .await
                        .map_err(|err| {
                            AppError::validation(format!(
                                "failed to list OpenCode providers: {err}"
                            ))
                        })?;

                    let config_providers_response = client
                        .config()
                        .providers(RequestOptions::default())
                        .await
                        .map_err(|err| {
                            AppError::validation(format!(
                                "failed to list OpenCode providers: {err}"
                            ))
                        })?;

                    let config_response = client
                        .config()
                        .get(RequestOptions::default())
                        .await
                        .map_err(|err| {
                            AppError::validation(format!("failed to load OpenCode config: {err}"))
                        })?;

                    let app_agents_response = client
                        .app()
                        .agents(RequestOptions::default())
                        .await
                        .map_err(|err| {
                            AppError::validation(format!(
                                "failed to list OpenCode app agents: {err}"
                            ))
                        })?;

                    let providers = merge_provider_options(vec![
                        parse_providers_from_payload(&provider_list_response.data),
                        parse_providers_from_payload(&config_providers_response.data),
                        parse_providers_from_payload(&config_response.data),
                    ]);
                    let agents = dedupe_agents(
                        [
                            parse_agents_from_config_payload(&app_agents_response.data),
                            parse_agents_from_config_payload(&config_response.data),
                        ]
                        .concat(),
                    );

                    Ok(RunSelectionCatalogResponseDto { agents, providers })
                })
            })
            .await;

        match &result {
            Ok(payload) => info!(
                target: "opencode.discovery",
                marker = "done",
                project_id,
                repo_root = canonical_repo_root.display().to_string(),
                agents_count = payload.agents.len(),
                providers_count = payload.providers.len(),
                latency_ms = detection_started.elapsed().as_millis() as u64,
                "OpenCode selection discovery finished"
            ),
            Err(error) => warn!(
                target: "opencode.discovery",
                marker = "failed",
                project_id,
                repo_root = canonical_repo_root.display().to_string(),
                latency_ms = detection_started.elapsed().as_millis() as u64,
                error = error.to_string(),
                "OpenCode selection discovery failed"
            ),
        }

        result
    }

    pub async fn get_project_opencode_selection_catalog(
        &self,
        project_id: &str,
    ) -> Result<RunSelectionCatalogResponseDto, AppError> {
        self.detect_opencode_selection_catalog(project_id).await
    }

    pub async fn list_run_opencode_providers(&self) -> Result<RunProvidersResponseDto, AppError> {
        Err(AppError::validation(
            "project-scoped OpenCode selection API required",
        ))
    }

    pub async fn list_run_opencode_agents(&self) -> Result<RunAgentsResponseDto, AppError> {
        Err(AppError::validation(
            "project-scoped OpenCode selection API required",
        ))
    }

    async fn get_or_create_init_lock(&self, run_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        if let Some(lock) = self.init_locks.read().await.get(run_id).cloned() {
            return lock;
        }

        let mut locks = self.init_locks.write().await;
        locks
            .entry(run_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub async fn ensure_run_opencode(
        &self,
        run_id: &str,
    ) -> Result<EnsureRunOpenCodeResponse, AppError> {
        let ensure_start = Instant::now();
        let dependency_status = self.get_opencode_dependency_status(false).await?;
        if dependency_status.state == "missing" {
            let response = EnsureRunOpenCodeResponse {
                state: "unsupported".to_string(),
                reason: dependency_status.reason,
            };
            info!(
                target: "opencode.runtime",
                marker = "ensure",
                run_id = run_id,
                state = response.state.as_str(),
                ready_phase = "dependency_missing",
                latency_ms = ensure_start.elapsed().as_millis() as u64,
                "OpenCode ensure finished"
            );
            return Ok(response);
        }

        let run = self.runs_service.get_run(run_id).await?;
        if let Some(reason) = Self::unsupported_reason_for_run_status(run.status.as_str()) {
            let response = EnsureRunOpenCodeResponse {
                state: "unsupported".to_string(),
                reason: Some(reason),
            };
            info!(
                target: "opencode.runtime",
                marker = "ensure",
                run_id = run.id.as_str(),
                state = response.state.as_str(),
                latency_ms = ensure_start.elapsed().as_millis() as u64,
                "OpenCode ensure finished"
            );
            return Ok(response);
        }

        if self.handles.read().await.contains_key(&run.id) {
            if let Some(handle) = self.handles.read().await.get(&run.id).cloned() {
                handle.sync_run_metadata(&run)?;
                handle.touch_interaction()?;
                if handle.lifecycle_state()? != RunOpenCodeLifecycleState::Active {
                    return Err(AppError::conflict(
                        "OpenCode run runtime is shutting down and cannot accept new work",
                    ));
                }
            }
            let response = EnsureRunOpenCodeResponse {
                state: "running".to_string(),
                reason: None,
            };
            info!(
                target: "opencode.runtime",
                marker = "ensure",
                run_id = run.id.as_str(),
                state = response.state.as_str(),
                ready_phase = "warm_handle",
                latency_ms = ensure_start.elapsed().as_millis() as u64,
                "OpenCode ensure finished"
            );
            return Ok(response);
        }

        let init_lock = self.get_or_create_init_lock(&run.id).await;
        let _guard = init_lock.lock().await;

        if self.is_shutdown_requested(&run.id).await {
            return Err(AppError::conflict(
                "OpenCode run runtime shutdown is in progress",
            ));
        }

        if self.handles.read().await.contains_key(&run.id) {
            if let Some(handle) = self.handles.read().await.get(&run.id).cloned() {
                handle.sync_run_metadata(&run)?;
                handle.touch_interaction()?;
                if handle.lifecycle_state()? != RunOpenCodeLifecycleState::Active {
                    return Err(AppError::conflict(
                        "OpenCode run runtime is shutting down and cannot accept new work",
                    ));
                }
            }
            let response = EnsureRunOpenCodeResponse {
                state: "running".to_string(),
                reason: None,
            };
            info!(
                target: "opencode.runtime",
                marker = "ensure",
                run_id = run.id.as_str(),
                state = response.state.as_str(),
                ready_phase = "warm_handle",
                latency_ms = ensure_start.elapsed().as_millis() as u64,
                "OpenCode ensure finished"
            );
            return Ok(response);
        }

        let worktree_path = self.resolve_worktree_path(&run)?;
        let project_env = self
            .projects_service
            .resolve_project_env_vars(&run.project_id)
            .await?;
        let options = build_opencode_server_options(worktree_path.clone(), project_env);
        info!(
            target: "opencode.runtime",
            marker = "ensure",
            subsystem = "runs.opencode",
            operation = "ensure_runtime",
            run_id = run.id.as_str(),
            "Starting OpenCode runtime"
        );

        let server = create_opencode_server(Some(options)).await.map_err(|err| {
            match &err {
                opencode::Error::CLINotFound(inner) => {
                    error!(
                        target: "opencode.runtime",
                        marker = "ensure",
                        run_id = run.id.as_str(),
                        error_variant = "CLINotFound",
                        cli_path = ?inner.cli_path,
                        message = inner.message.as_str(),
                        "OpenCode server launch failed"
                    );
                }
                opencode::Error::Process(inner) => {
                    error!(
                        target: "opencode.runtime",
                        marker = "ensure",
                        run_id = run.id.as_str(),
                        error_variant = "Process",
                        exit_code = ?inner.exit_code,
                        message = inner.message.as_str(),
                        "OpenCode server launch failed"
                    );
                }
                opencode::Error::Io(inner) => {
                    error!(
                        target: "opencode.runtime",
                        marker = "ensure",
                        run_id = run.id.as_str(),
                        error_variant = "Io",
                        io_kind = ?inner.kind(),
                        message = inner.to_string(),
                        "OpenCode server launch failed"
                    );
                }
                opencode::Error::ServerStartupTimeout { timeout_ms } => {
                    error!(
                        target: "opencode.runtime",
                        marker = "ensure",
                        run_id = run.id.as_str(),
                        error_variant = "ServerStartupTimeout",
                        timeout_ms = *timeout_ms,
                        "OpenCode server launch failed"
                    );
                }
                _ => {
                    error!(
                        target: "opencode.runtime",
                        marker = "ensure",
                        run_id = run.id.as_str(),
                        error_variant = "Other",
                        error = err.to_string(),
                        "OpenCode server launch failed"
                    );
                }
            }
            error!(
                target: "opencode.runtime",
                marker = "ensure",
                run_id = run.id.as_str(),
                error = err.to_string(),
                "OpenCode server launch failed"
            );
            app_error_from_anyhow(
                AnyhowError::new(OpenCodeServiceError::ServerStart { source: err }).context(
                    format!("while ensuring OpenCode runtime for run '{}'", run.id),
                ),
            )
        })?;
        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(worktree_path.to_string_lossy().to_string()),
            timeout: Duration::from_secs(1800),
            ..Default::default()
        }))
        .map_err(|source| OpenCodeServiceError::ClientCreate { source })
        .with_context(|| format!("while creating OpenCode client for run '{}'", run.id))
        .map_err(app_error_from_anyhow)?;

        let max_health_wait = Duration::from_secs(10);
        let health_retry_interval = Duration::from_millis(250);
        let health_start = Instant::now();

        loop {
            match client.global().health(RequestOptions::default()).await {
                Ok(_) => break,
                Err(err) => {
                    let health_err =
                        AnyhowError::new(OpenCodeServiceError::HealthCheck { source: err })
                            .context(format!(
                                "while waiting for OpenCode health on run '{}'",
                                run.id
                            ));
                    if health_start.elapsed() >= max_health_wait {
                        let elapsed_ms = health_start.elapsed().as_millis();
                        return Err(app_error_from_anyhow(health_err.context(format!(
                            "OpenCode health check failed after retries (elapsed_ms={elapsed_ms})"
                        ))));
                    }
                    sleep(health_retry_interval).await;
                }
            }
        }

        let (event_tx, _rx) = tokio::sync::broadcast::channel(EVENT_BROADCAST_CAPACITY);
        let subscribers = Arc::new(Mutex::new(HashMap::new()));
        let subscriber_tasks = Arc::new(Mutex::new(HashMap::new()));
        let buffered_events = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_BUFFERED_EVENTS)));
        let generation = self.handle_generation.fetch_add(1, Ordering::Relaxed);

        if self.is_shutdown_requested(&run.id).await {
            info!(
                target: "opencode.runtime",
                marker = "ensure_cancelled",
                run_id = run.id.as_str(),
                reason = "shutdown_requested",
                "OpenCode runtime creation cancelled before registration"
            );
            self.init_locks.write().await.remove(&run.id);
            return Err(AppError::conflict(
                "OpenCode run runtime shutdown is in progress",
            ));
        }

        let handle = Arc::new(RunOpenCodeHandle {
            generation,
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            client: client.clone(),
            lifecycle: Arc::new(Mutex::new(Self::build_run_lifecycle(&run))),
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: subscribers.clone(),
            subscriber_tasks,
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx: event_tx.clone(),
            event_stream_task: Arc::new(tokio::sync::Mutex::new(None)),
            buffered_events: buffered_events.clone(),
            session_runtime_state: Arc::new(Mutex::new(SessionRuntimeState::default())),
        });

        info!(
            target: "opencode.runtime",
            marker = "server_created",
            run_id = run.id.as_str(),
            generation = generation,
            "OpenCode runtime server created"
        );

        self.handles
            .write()
            .await
            .insert(run.id.clone(), handle.clone());

        info!(
            target: "opencode.runtime",
            marker = "server_registered",
            run_id = run.id.as_str(),
            generation = generation,
            "OpenCode runtime lifecycle registered"
        );

        let event_stream_task = self.spawn_event_stream(
            run.id.clone(),
            generation,
            client,
            event_tx,
            buffered_events,
            handle.session_runtime_state.clone(),
        );
        handle.register_event_stream_task()?;
        *handle.event_stream_task.lock().await = Some(event_stream_task);

        if matches!(run.status.as_str(), "queued" | "preparing") {
            let _ = self
                .run_status_transition_service
                .handle_run_started(&run.id)
                .await?;
        }

        let response = EnsureRunOpenCodeResponse {
            state: "running".to_string(),
            reason: None,
        };
        info!(
            target: "opencode.runtime",
            marker = "ensure",
            run_id = run.id.as_str(),
            state = response.state.as_str(),
            ready_phase = "cold_start",
            latency_ms = ensure_start.elapsed().as_millis() as u64,
            "OpenCode ensure finished"
        );
        Ok(response)
    }

    pub async fn submit_run_opencode_prompt(
        &self,
        run_id: &str,
        prompt: &str,
        client_request_id: Option<String>,
        run_state_hint: Option<String>,
        agent: Option<String>,
        provider_id: Option<String>,
        model_id: Option<String>,
    ) -> Result<SubmitRunOpenCodePromptResponse, AppError> {
        let submit_start = Instant::now();
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::validation("prompt is required"));
        }

        let is_initial_seed_request =
            Self::is_initial_seed_request(run_id, client_request_id.as_deref());
        let mut claimed_initial_seed_request_id: Option<&str> = None;
        if is_initial_seed_request {
            let claim_request_id = client_request_id
                .as_deref()
                .ok_or_else(|| AppError::validation("client_request_id is required"))?;
            let claimed = self
                .runs_service
                .claim_initial_prompt_send_if_unset(run_id, claim_request_id)
                .await?;
            if !claimed {
                return Ok(SubmitRunOpenCodePromptResponse {
                    state: "accepted".to_string(),
                    reason: None,
                    queued_at: Utc::now().to_rfc3339(),
                    client_request_id,
                });
            }

            claimed_initial_seed_request_id = Some(claim_request_id);
        }

        let (ensured, handle, ready_phase) = match self.ensure_run_ready_for_operation(run_id).await
        {
            Ok(result) => result,
            Err(err) => {
                self.release_initial_seed_claim_if_claimant(
                    run_id,
                    claimed_initial_seed_request_id,
                )
                .await?;
                return Err(err);
            }
        };
        if ensured.state == "unsupported" {
            self.release_initial_seed_claim_if_claimant(run_id, claimed_initial_seed_request_id)
                .await?;
            return Ok(SubmitRunOpenCodePromptResponse {
                state: "unsupported".to_string(),
                reason: ensured.reason,
                queued_at: Utc::now().to_rfc3339(),
                client_request_id,
            });
        }

        let handle = match handle {
            Some(handle) => handle,
            None => {
                self.release_initial_seed_claim_if_claimant(
                    run_id,
                    claimed_initial_seed_request_id,
                )
                .await?;
                return Err(AppError::not_found("OpenCode run handle not found"));
            }
        };

        let session_id = match self.get_or_create_session_id(run_id, handle.clone()).await {
            Ok(session_id) => session_id,
            Err(err) => {
                self.release_initial_seed_claim_if_claimant(
                    run_id,
                    claimed_initial_seed_request_id,
                )
                .await?;
                return Err(err);
            }
        };

        let run_defaults = self.runs_service.get_run_model(run_id).await?;
        let selected = match Self::resolve_prompt_selection(
            run_defaults.agent_id.as_deref(),
            run_defaults.provider_id.as_deref(),
            run_defaults.model_id.as_deref(),
            agent.as_deref(),
            provider_id.as_deref(),
            model_id.as_deref(),
        ) {
            Ok(selected) => selected,
            Err(err) => {
                self.release_initial_seed_claim_if_claimant(
                    run_id,
                    claimed_initial_seed_request_id,
                )
                .await?;
                return Err(err);
            }
        };

        let mut request = RequestOptions::default().with_path("id", session_id);
        if let Some(request_id) = client_request_id.as_ref() {
            request = request.with_header("x-request-id", request_id.clone());
        }
        request = request.with_body(serde_json::json!({
            "agent": selected.agent,
            "model": {
                "providerID": selected.provider_id,
                "modelID": selected.model_id,
            },
            "parts": [PartInput::Raw(serde_json::json!({
                "type": "text",
                "text": prompt,
            }))],
        }));

        {
            handle.touch_main_session_activity()?;
            let mut runtime_state = handle
                .session_runtime_state
                .lock()
                .map_err(|_| lock_error("OpenCode session runtime state"))?;
            runtime_state.idle_cleanup_ready = false;
        }

        let send_result = handle.client.session().prompt_async(request).await;

        if let Err(err) = send_result {
            self.release_initial_seed_claim_if_claimant(run_id, claimed_initial_seed_request_id)
                .await?;
            return Err(app_error_from_anyhow(
                AnyhowError::new(OpenCodeServiceError::PromptSubmit {
                    run_id: run_id.to_string(),
                    source: err,
                })
                .context("while submitting prompt to OpenCode session"),
            ));
        }

        if let Some(claim_request_id) = claimed_initial_seed_request_id {
            let finalized = self
                .runs_service
                .finalize_initial_prompt_send_for_claimant(run_id, claim_request_id)
                .await?;
            if !finalized {
                return Err(app_error_from_anyhow(AnyhowError::new(
                    OpenCodeServiceError::InitialPromptFinalizeRejected,
                )));
            }
        }

        let _ = self
            .run_status_transition_service
            .handle_user_replied(&run_defaults.task_id, run_id)
            .await?;
        let _ = self
            .task_status_transition_service
            .handle_user_replied_to_agent(&run_defaults.task_id, run_id)
            .await?;
        if run_state_hint.as_deref() == Some("committing_changes") {
            let _ = self
                .run_state_service
                .handle_commit_requested(run_id)
                .await?;
        }

        info!(
            target: "opencode.runtime",
            marker = "submit",
            run_id = run_id,
            ready_phase = ready_phase,
            latency_ms = submit_start.elapsed().as_millis() as u64,
            "OpenCode submit finished"
        );

        Ok(SubmitRunOpenCodePromptResponse {
            state: "accepted".to_string(),
            reason: None,
            queued_at: Utc::now().to_rfc3339(),
            client_request_id,
        })
    }

    pub async fn reply_run_opencode_permission(
        &self,
        run_id: &str,
        session_id: &str,
        request_id: &str,
        decision: &str,
        remember: bool,
    ) -> Result<ReplyRunOpenCodePermissionResponse, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("session_id is required"));
        }

        let request_id = request_id.trim();
        if request_id.is_empty() {
            return Err(AppError::validation("request_id is required"));
        }

        let decision = decision.trim().to_lowercase();
        let opencode_reply =
            map_permission_decision_to_reply(decision.as_str()).ok_or_else(|| {
                AppError::validation("decision must be one of: deny, once, always, reject")
            })?;
        info!(
            target: "opencode.runtime",
            marker = "permission_reply_command_start",
            run_id = run_id,
            request_id = request_id,
            session_id = session_id,
            decision = decision.as_str(),
            mapped_reply = opencode_reply,
            remember = remember,
            "Permission reply command started"
        );

        let run = self.runs_service.get_run_model(run_id).await?;
        let canonical_session_id = run
            .opencode_session_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .ok_or_else(|| AppError::validation("OpenCode session not initialized for run"))?;
        if canonical_session_id != session_id {
            info!(
                target: "opencode.runtime",
                marker = "permission_reply_stale",
                run_id = run_id,
                request_id = request_id,
                session_id = session_id,
                canonical_session_id = canonical_session_id,
                "Ignoring stale permission reply due to canonical session mismatch"
            );
            return Ok(ReplyRunOpenCodePermissionResponse {
                state: "accepted".to_string(),
                reason: Some("stale_permission_request".to_string()),
                replied_at: Utc::now().to_rfc3339(),
            });
        }

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(ReplyRunOpenCodePermissionResponse {
                state: "unsupported".to_string(),
                reason: ensured.reason,
                replied_at: Utc::now().to_rfc3339(),
            });
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        handle.touch_main_session_activity()?;

        {
            let in_memory_session_id = handle
                .session_id
                .lock()
                .map_err(|_| lock_error("OpenCode session id"))?
                .clone();
            if let Some(in_memory_session_id) = in_memory_session_id {
                if in_memory_session_id.trim() != session_id {
                    info!(
                        target: "opencode.runtime",
                        marker = "permission_reply_stale",
                        run_id = run_id,
                        request_id = request_id,
                        session_id = session_id,
                        in_memory_session_id = in_memory_session_id,
                        "Ignoring stale permission reply due to in-memory session mismatch"
                    );
                    return Ok(ReplyRunOpenCodePermissionResponse {
                        state: "accepted".to_string(),
                        reason: Some("stale_permission_request".to_string()),
                        replied_at: Utc::now().to_rfc3339(),
                    });
                }
            }
        }

        {
            let state = handle
                .session_runtime_state
                .lock()
                .map_err(|_| lock_error("OpenCode session runtime state"))?;
            if !state.pending_permissions.contains(request_id) {
                let pending_count = state.pending_permissions.len();
                info!(
                    target: "opencode.runtime",
                    marker = "permission_reply_stale",
                    run_id = run_id,
                    request_id = request_id,
                    session_id = session_id,
                    pending_count = pending_count,
                    mapped_reply = opencode_reply,
                    "Ignoring stale permission reply for missing pending permission"
                );
                return Ok(ReplyRunOpenCodePermissionResponse {
                    state: "accepted".to_string(),
                    reason: Some("stale_permission_request".to_string()),
                    replied_at: Utc::now().to_rfc3339(),
                });
            }
        }

        let reply_start = Instant::now();
        info!(
            target: "opencode.runtime",
            marker = "permission_reply_send_start",
            run_id = run_id,
            request_id = request_id,
            session_id = session_id,
            reply = opencode_reply,
            remember = remember,
            "Sending permission reply to OpenCode"
        );

        let response_result = handle
            .client
            .call_operation(
                "permission.reply",
                RequestOptions::default()
                    .with_path("requestID", request_id.to_string())
                    .with_body(build_permission_reply_body(
                        session_id,
                        opencode_reply,
                        remember,
                    )),
            )
            .await;

        let response = match response_result {
            Ok(response) => response,
            Err(source) => {
                let permission_reply_error = OpenCodeServiceError::PermissionReply {
                    request_id: request_id.to_string(),
                    source,
                };
                error!(
                    target: "opencode.runtime",
                    marker = "permission_reply_send_error",
                    run_id = run_id,
                    request_id = request_id,
                    session_id = session_id,
                    reply = opencode_reply,
                    latency_ms = reply_start.elapsed().as_millis() as u64,
                    error = ?permission_reply_error,
                    error_chain = format_error_chain(&permission_reply_error),
                    "Failed to send permission reply to OpenCode"
                );
                return Err(app_error_from_anyhow(
                    AnyhowError::new(permission_reply_error)
                        .context("while forwarding permission decision to OpenCode"),
                ));
            }
        };

        let response_state = response
            .data
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("accepted");
        let response_reason = response
            .data
            .get("reason")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        info!(
            target: "opencode.runtime",
            marker = "permission_reply_send_success",
            run_id = run_id,
            request_id = request_id,
            session_id = session_id,
            reply = opencode_reply,
            latency_ms = reply_start.elapsed().as_millis() as u64,
            response_state = response_state,
            response_reason = response_reason.as_deref(),
            "Permission reply acknowledged by OpenCode"
        );

        if response_state.eq_ignore_ascii_case("unsupported") {
            return Ok(ReplyRunOpenCodePermissionResponse {
                state: "unsupported".to_string(),
                reason: response_reason,
                replied_at: Utc::now().to_rfc3339(),
            });
        }

        Ok(ReplyRunOpenCodePermissionResponse {
            state: "accepted".to_string(),
            reason: None,
            replied_at: Utc::now().to_rfc3339(),
        })
    }

    pub async fn start_run_opencode(
        &self,
        run_id: &str,
    ) -> Result<StartRunOpenCodeResponse, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let run_state = self.runs_service.get_run(run_id).await?;
        if run_state.setup_state == "failed" {
            return Ok(StartRunOpenCodeResponse {
                state: "error".to_string(),
                reason: Some("Setup script failed. Please fix it before you continue.".to_string()),
                queued_at: Utc::now().to_rfc3339(),
                client_request_id: Self::initial_seed_request_id_for_run(run_id),
                ready_phase: Some("setup_failed".to_string()),
            });
        }

        let context = self
            .runs_service
            .get_run_initial_prompt_context(run_id)
            .await?;

        if context
            .setup_script
            .as_deref()
            .is_some_and(|script| !script.trim().is_empty())
            && run_state.setup_state != "succeeded"
        {
            let _ = self
                .runs_service
                .mark_setup_running_if_pending(run_id)
                .await?;
            let setup_result = self
                .run_lifecycle_script_in_worktree(run_id, context.setup_script.as_deref())
                .await;
            match setup_result {
                Ok(()) => {
                    let _ = self.runs_service.mark_setup_succeeded(run_id).await?;
                }
                Err(err) => {
                    let _ = self
                        .runs_service
                        .mark_setup_failed_if_unset(run_id, &err.to_string())
                        .await?;
                    return Ok(StartRunOpenCodeResponse {
                        state: "error".to_string(),
                        reason: Some(
                            "Setup script failed. Please fix it before you continue.".to_string(),
                        ),
                        queued_at: Utc::now().to_rfc3339(),
                        client_request_id: Self::initial_seed_request_id_for_run(&context.run_id),
                        ready_phase: Some("setup_failed".to_string()),
                    });
                }
            }
        } else if run_state.setup_state == "pending" {
            let _ = self.runs_service.mark_setup_succeeded(run_id).await?;
        }

        let prompt = Self::compose_initial_prompt(
            &context.task_title,
            context.task_description.as_deref(),
            context.task_implementation_guide.as_deref(),
        );
        let client_request_id = Self::initial_seed_request_id_for_run(&context.run_id);

        let (ensured, _, ready_phase) =
            self.ensure_run_ready_for_operation(&context.run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(StartRunOpenCodeResponse {
                state: "unsupported".to_string(),
                reason: ensured.reason,
                queued_at: Utc::now().to_rfc3339(),
                client_request_id,
                ready_phase: Some(ready_phase.to_string()),
            });
        }

        let submitted = self
            .submit_run_opencode_prompt(
                &context.run_id,
                &prompt,
                Some(client_request_id.clone()),
                None,
                None,
                None,
                None,
            )
            .await?;

        Ok(StartRunOpenCodeResponse {
            state: submitted.state,
            reason: submitted.reason,
            queued_at: submitted.queued_at,
            client_request_id,
            ready_phase: Some(ready_phase.to_string()),
        })
    }

    pub async fn get_run_opencode_session_messages(
        &self,
        run_id: &str,
        session_id: Option<&str>,
    ) -> Result<Vec<RunOpenCodeSessionMessageDto>, AppError> {
        let run = self.runs_service.get_run_model(run_id).await?;
        let session_id = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or(run.opencode_session_id);
        let Some(session_id) = session_id else {
            return Ok(vec![]);
        };
        let session_id_for_error = session_id.clone();

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(vec![]);
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        handle.touch_interaction()?;

        let request = RequestOptions::default().with_path("id", session_id);
        let response = handle
            .client
            .session()
            .messages(request)
            .await
            .map_err(|source| OpenCodeServiceError::SessionMessages {
                session_id: session_id_for_error.clone(),
                source,
            })
            .context("while loading run OpenCode session messages")
            .map_err(app_error_from_anyhow)?;

        Ok(value_array_to_message_wrappers(response.data))
    }

    pub async fn get_run_opencode_session_todos(
        &self,
        run_id: &str,
        session_id: Option<&str>,
    ) -> Result<Vec<RunOpenCodeSessionTodoDto>, AppError> {
        let run = self.runs_service.get_run_model(run_id).await?;
        let session_id = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or(run.opencode_session_id);
        let Some(session_id) = session_id else {
            return Ok(vec![]);
        };
        let session_id_for_error = session_id.clone();

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(vec![]);
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        handle.touch_interaction()?;

        let request = RequestOptions::default().with_path("id", session_id);
        let response = handle
            .client
            .session()
            .todo(request)
            .await
            .map_err(|source| OpenCodeServiceError::SessionTodos {
                session_id: session_id_for_error.clone(),
                source,
            })
            .context("while loading run OpenCode session todos")
            .map_err(app_error_from_anyhow)?;

        Ok(value_array_to_todo_wrappers(response.data))
    }

    pub async fn subscribe_run_opencode_events(
        &self,
        subscriber_id: &str,
        run_id: &str,
        on_output: Channel<RawAgentEvent>,
    ) -> Result<(), AppError> {
        let subscriber_id = subscriber_id.trim();
        if subscriber_id.is_empty() {
            return Err(AppError::validation("subscriber_id is required"));
        }

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Err(AppError::validation(
                ensured
                    .reason
                    .unwrap_or_else(|| "run status is not supported".to_string()),
            ));
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        let _lifecycle_guard = handle.subscriber_lifecycle_lock.lock().await;

        {
            let mut subscribers = handle
                .subscribers
                .lock()
                .map_err(|_| lock_error("OpenCode subscribers"))?;
            subscribers.insert(subscriber_id.to_string(), on_output);
        }

        let previous_task = {
            let mut subscriber_tasks = handle
                .subscriber_tasks
                .lock()
                .map_err(|_| lock_error("OpenCode subscriber tasks"))?;
            subscriber_tasks.remove(subscriber_id)
        };
        if let Some(previous_task) = previous_task {
            previous_task.handle.abort();
        }

        let subscriber_id_owned = subscriber_id.to_string();
        let subscribers = handle.subscribers.clone();
        let subscriber_tasks = handle.subscriber_tasks.clone();
        let subscriber_generation = handle.subscriber_generation.fetch_add(1, Ordering::Relaxed);
        let mut stream = BroadcastStream::new(handle.event_tx.subscribe());
        let run_id_owned = run_id.to_string();
        let forwarder_task = tauri::async_runtime::spawn(async move {
            while let Some(frame) = stream.next().await {
                let event = match frame {
                    Ok(event) => event,
                    Err(BroadcastStreamRecvError::Lagged(skipped)) => {
                        let synthetic = RawAgentEvent {
                            timestamp: Utc::now().to_rfc3339(),
                            event_name: "stream.resync_needed".to_string(),
                            payload: serde_json::json!({
                                "runId": run_id_owned,
                                "subscriberId": subscriber_id_owned,
                                "reason": "subscriber_lagged",
                                "skipped": skipped,
                            })
                            .to_string(),
                        };

                        let channel = {
                            let subscribers_guard = subscribers.lock();
                            if let Ok(subscribers_guard) = subscribers_guard {
                                subscribers_guard.get(&subscriber_id_owned).cloned()
                            } else {
                                None
                            }
                        };

                        if let Some(channel) = channel {
                            let _ = channel.send(synthetic);
                        }

                        if let Ok(mut subscribers_guard) = subscribers.lock() {
                            subscribers_guard.remove(&subscriber_id_owned);
                        }
                        break;
                    }
                };

                let channel = {
                    let subscribers_guard = subscribers.lock();
                    if let Ok(subscribers_guard) = subscribers_guard {
                        subscribers_guard.get(&subscriber_id_owned).cloned()
                    } else {
                        None
                    }
                };

                if let Some(channel) = channel {
                    if channel.send(event).is_err() {
                        if let Ok(mut subscribers_guard) = subscribers.lock() {
                            subscribers_guard.remove(&subscriber_id_owned);
                        }
                        break;
                    }
                } else {
                    if let Ok(mut subscribers_guard) = subscribers.lock() {
                        subscribers_guard.remove(&subscriber_id_owned);
                    }
                    break;
                }
            }

            if let Ok(mut subscriber_tasks_guard) = subscriber_tasks.lock() {
                let should_remove = subscriber_tasks_guard
                    .get(&subscriber_id_owned)
                    .map(|entry| entry.generation == subscriber_generation)
                    .unwrap_or(false);
                if should_remove {
                    subscriber_tasks_guard.remove(&subscriber_id_owned);
                }
            }
        });

        {
            let mut subscriber_tasks = handle
                .subscriber_tasks
                .lock()
                .map_err(|_| lock_error("OpenCode subscriber tasks"))?;
            subscriber_tasks.insert(
                subscriber_id.to_string(),
                SubscriberTaskEntry {
                    generation: subscriber_generation,
                    handle: forwarder_task,
                },
            );
        }

        Ok(())
    }

    pub async fn get_buffered_run_opencode_events(
        &self,
        run_id: &str,
    ) -> Result<Vec<RawAgentEvent>, AppError> {
        let handle = self
            .handles
            .read()
            .await
            .get(run_id)
            .cloned()
            .ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        handle.touch_interaction()?;

        let buffered = handle
            .buffered_events
            .lock()
            .map_err(|_| lock_error("OpenCode buffered events"))?;
        Ok(buffered.iter().cloned().collect())
    }

    pub async fn build_run_opencode_bootstrap_payload(
        &self,
        run_id: &str,
    ) -> Result<BootstrapRunOpenCodeResponse, AppError> {
        let bootstrap_start = Instant::now();
        let run = self.runs_service.get_run_model(run_id).await?;

        if run.status == "complete" {
            let session_id = run.opencode_session_id.filter(|id| !id.trim().is_empty());
            let (messages, todos) = if let Some(session_id) = session_id.as_ref() {
                let session_id_for_fetch = session_id.clone();
                self.with_ephemeral_client(self.worktrees_root.clone(), |client| {
                    Box::pin(async move {
                        Self::fetch_session_history_with_client(client, &session_id_for_fetch).await
                    })
                })
                .await
                .unwrap_or_else(|err| {
                    warn!(
                        target: "opencode.runtime",
                        marker = "bootstrap_completed_history_failed",
                        run_id = run_id,
                        error = %err,
                        "OpenCode completed run history fetch failed"
                    );
                    (vec![], vec![])
                })
            } else {
                (vec![], vec![])
            };

            info!(
                target: "opencode.runtime",
                marker = "bootstrap_gather",
                run_id = run_id,
                ready_phase = "completed_history",
                stream_connected = false,
                latency_ms = bootstrap_start.elapsed().as_millis() as u64,
                "OpenCode bootstrap payload gathered"
            );

            return Ok(BootstrapRunOpenCodeResponse {
                state: "ready".to_string(),
                reason: None,
                chat_mode: RunOpenCodeChatModeDto::ReadOnly,
                buffered_events: vec![],
                messages,
                todos,
                session_id,
                stream_connected: false,
                ready_phase: Some("completed_history".to_string()),
            });
        }

        let (ensured, handle, ready_phase) = self.ensure_run_ready_for_operation(run_id).await?;

        if ensured.state == "unsupported" {
            info!(
                target: "opencode.runtime",
                marker = "bootstrap_gather",
                run_id = run_id,
                ready_phase = ready_phase,
                stream_connected = false,
                latency_ms = bootstrap_start.elapsed().as_millis() as u64,
                "OpenCode bootstrap payload gathered"
            );
            return Ok(BootstrapRunOpenCodeResponse {
                state: ensured.state,
                reason: ensured.reason,
                chat_mode: RunOpenCodeChatModeDto::Unavailable,
                buffered_events: vec![],
                messages: vec![],
                todos: vec![],
                session_id: None,
                stream_connected: false,
                ready_phase: Some(ready_phase.to_string()),
            });
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        handle.touch_interaction()?;
        let buffered_events = {
            let buffered = handle
                .buffered_events
                .lock()
                .map_err(|_| lock_error("OpenCode buffered events"))?;
            buffered.iter().cloned().collect::<Vec<_>>()
        };

        let session_id = run.opencode_session_id.filter(|id| !id.trim().is_empty());

        let (messages, todos) = if let Some(session_id) = session_id.as_ref() {
            Self::fetch_session_history_with_client(&handle.client, session_id).await?
        } else {
            (vec![], vec![])
        };

        let stream_connected = Self::compute_stream_connected(&buffered_events);
        info!(
            target: "opencode.runtime",
            marker = "bootstrap_gather",
            run_id = run_id,
            ready_phase = ready_phase,
            stream_connected = stream_connected,
            latency_ms = bootstrap_start.elapsed().as_millis() as u64,
            "OpenCode bootstrap payload gathered"
        );

        Ok(BootstrapRunOpenCodeResponse {
            state: ensured.state,
            reason: ensured.reason,
            chat_mode: RunOpenCodeChatModeDto::Interactive,
            buffered_events,
            messages,
            todos,
            session_id,
            stream_connected,
            ready_phase: Some(ready_phase.to_string()),
        })
    }

    pub async fn bootstrap_run_opencode(
        &self,
        run_id: &str,
    ) -> Result<BootstrapRunOpenCodeResponse, AppError> {
        self.build_run_opencode_bootstrap_payload(run_id).await
    }

    pub async fn unsubscribe_run_opencode_events(
        &self,
        subscriber_id: &str,
        run_id: &str,
    ) -> Result<(), AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let subscriber_id = subscriber_id.trim();
        if subscriber_id.is_empty() {
            return Err(AppError::validation("subscriber_id is required"));
        }

        let handle = self.handles.read().await.get(run_id).cloned();
        if let Some(handle) = handle {
            let _lifecycle_guard = handle.subscriber_lifecycle_lock.lock().await;

            {
                let mut subscribers = handle
                    .subscribers
                    .lock()
                    .map_err(|_| lock_error("OpenCode subscribers"))?;
                subscribers.remove(subscriber_id);
            }

            let subscriber_task = {
                let mut subscriber_tasks = handle
                    .subscriber_tasks
                    .lock()
                    .map_err(|_| lock_error("OpenCode subscriber tasks"))?;
                subscriber_tasks.remove(subscriber_id)
            };

            if let Some(subscriber_task) = subscriber_task {
                subscriber_task.handle.abort();
            }
        }

        Ok(())
    }

    fn spawn_event_stream(
        &self,
        run_id: String,
        generation: u64,
        client: OpencodeClient,
        event_tx: tokio::sync::broadcast::Sender<RawAgentEvent>,
        buffered_events: Arc<Mutex<VecDeque<RawAgentEvent>>>,
        session_runtime_state: Arc<Mutex<SessionRuntimeState>>,
    ) -> JoinHandle<()> {
        let handles = self.handles.clone();
        let runs_opencode_service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut reconnect_attempt: u32 = 0;

            loop {
                let should_stop = match handles.read().await.get(&run_id).cloned() {
                    Some(handle) if handle.generation == generation => {
                        handle.lifecycle_state().ok() != Some(RunOpenCodeLifecycleState::Active)
                    }
                    _ => true,
                };
                if should_stop {
                    info!(
                        target: "opencode.runtime",
                        marker = "stream_stop_requested",
                        run_id = run_id.as_str(),
                        generation = generation,
                        "OpenCode event stream exiting due to lifecycle shutdown"
                    );
                    break;
                }

                let mut stream = match client.event().subscribe(RequestOptions::default()).await {
                    Ok(stream) => {
                        if reconnect_attempt > 0 {
                            RunsOpenCodeService::push_event(
                                &event_tx,
                                &buffered_events,
                                "stream.reconnected",
                                serde_json::json!({
                                    "runId": run_id.as_str(),
                                    "attempt": reconnect_attempt,
                                })
                                .to_string(),
                            );
                        }
                        reconnect_attempt = 0;
                        stream
                    }
                    Err(err) => {
                        let error_chain = format_error_chain(&err);
                        error!(
                            target: "opencode.runtime",
                            marker = "stream_subscribe_failed",
                            run_id = run_id.as_str(),
                            reconnect_attempt = reconnect_attempt,
                            error_display = %err,
                            error_debug = ?err,
                            error_chain = error_chain.as_deref().unwrap_or("unavailable"),
                            "OpenCode stream subscribe failed"
                        );
                        RunsOpenCodeService::push_event(
                            &event_tx,
                            &buffered_events,
                            "stream.disconnected",
                            serde_json::json!({
                                "runId": run_id.as_str(),
                                "error": "stream subscribe failed",
                            })
                            .to_string(),
                        );

                        reconnect_attempt += 1;
                        if reconnect_attempt > STREAM_MAX_RECONNECT_ATTEMPTS {
                            RunsOpenCodeService::push_event(
                                &event_tx,
                                &buffered_events,
                                "stream.terminated",
                                serde_json::json!({
                                    "runId": run_id.as_str(),
                                    "reason": "reconnect_exhausted",
                                    "attempts": reconnect_attempt,
                                })
                                .to_string(),
                            );
                            let _ = runs_opencode_service
                                .stop_run_opencode_internal(
                                    &run_id,
                                    "stream_reconnect_exhausted",
                                    false,
                                )
                                .await;
                            return;
                        }

                        let backoff_ms = (STREAM_RECONNECT_BASE_DELAY_MS
                            .saturating_mul(1_u64 << (reconnect_attempt - 1)))
                        .min(STREAM_RECONNECT_MAX_DELAY_MS);

                        RunsOpenCodeService::push_event(
                            &event_tx,
                            &buffered_events,
                            "stream.reconnecting",
                            serde_json::json!({
                                "runId": run_id.as_str(),
                                "attempt": reconnect_attempt,
                                "backoffMs": backoff_ms,
                            })
                            .to_string(),
                        );

                        sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                };

                while let Some(frame) = stream.next().await {
                    let sse = match frame {
                        Ok(event) => event,
                        Err(err) => {
                            let error_chain = format_error_chain(&err);
                            error!(
                                target: "opencode.runtime",
                                marker = "stream_frame_decode_failed",
                                run_id = run_id.as_str(),
                                reconnect_attempt = reconnect_attempt,
                                error_display = %err,
                                error_debug = ?err,
                                error_chain = error_chain.as_deref().unwrap_or("unavailable"),
                                "OpenCode stream frame decode failed"
                            );
                            break;
                        }
                    };

                    let event_name = sse.event.unwrap_or_else(|| "message".to_string());
                    if let Err(err) = runs_opencode_service
                        .process_runtime_event(
                            &run_id,
                            &event_name,
                            &sse.data,
                            &session_runtime_state,
                        )
                        .await
                    {
                        warn!(
                            target: "opencode.runtime",
                            marker = "runtime_event_processing_failed",
                            run_id = run_id.as_str(),
                            event_name = event_name.as_str(),
                            error = %err,
                            "OpenCode runtime event processing failed"
                        );
                    }
                    RunsOpenCodeService::push_event(
                        &event_tx,
                        &buffered_events,
                        event_name,
                        sse.data,
                    );
                }

                RunsOpenCodeService::push_event(
                    &event_tx,
                    &buffered_events,
                    "stream.disconnected",
                    serde_json::json!({
                        "runId": run_id.as_str(),
                        "error": "event stream ended",
                    })
                    .to_string(),
                );

                reconnect_attempt += 1;
                if reconnect_attempt > STREAM_MAX_RECONNECT_ATTEMPTS {
                    RunsOpenCodeService::push_event(
                        &event_tx,
                        &buffered_events,
                        "stream.terminated",
                        serde_json::json!({
                            "runId": run_id.as_str(),
                            "reason": "reconnect_exhausted",
                            "attempts": reconnect_attempt,
                        })
                        .to_string(),
                    );
                    let _ = runs_opencode_service
                        .stop_run_opencode_internal(&run_id, "stream_reconnect_exhausted", false)
                        .await;
                    return;
                }

                let backoff_ms = (STREAM_RECONNECT_BASE_DELAY_MS
                    .saturating_mul(1_u64 << (reconnect_attempt - 1)))
                .min(STREAM_RECONNECT_MAX_DELAY_MS);

                RunsOpenCodeService::push_event(
                    &event_tx,
                    &buffered_events,
                    "stream.reconnecting",
                    serde_json::json!({
                        "runId": run_id.as_str(),
                        "attempt": reconnect_attempt,
                        "backoffMs": backoff_ms,
                    })
                    .to_string(),
                );

                sleep(Duration::from_millis(backoff_ms)).await;
            }
        })
    }

    fn resolve_worktree_path(&self, run: &RunDto) -> Result<PathBuf, AppError> {
        let worktree_id = run
            .worktree_id
            .as_deref()
            .ok_or_else(|| AppError::not_found("run worktree not found"))?
            .trim();
        resolve_worktree_path(&self.worktrees_root, worktree_id)
    }
}

#[cfg(test)]
mod tests {
    use super::{build_opencode_server_options, RunsOpenCodeService};
    use crate::app::db::migrations::run_migrations;
    use crate::app::db::repositories::projects::ProjectsRepository;
    use crate::app::db::repositories::runs::RunsRepository;
    use crate::app::db::repositories::tasks::TasksRepository;
    use crate::app::projects::search_service::ProjectFileSearchService;
    use crate::app::projects::service::ProjectsService;
    use crate::app::runs::run_state_service::RunStateService;
    use crate::app::runs::service::RunsService;
    use crate::app::runs::status_transition_service::RunStatusTransitionService;
    use crate::app::tasks::status_transition_service::TaskStatusTransitionService;
    use crate::app::worktrees::service::WorktreesService;
    use opencode::{
        create_opencode_client, create_opencode_server, OpencodeClientConfig, OpencodeServerOptions,
    };
    use sqlx::SqlitePool;
    use std::collections::{HashMap, VecDeque};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicU64;
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    #[test]
    fn build_opencode_server_options_applies_project_env() {
        let cwd = PathBuf::from("/tmp/project");
        let env = HashMap::from([("API_TOKEN".to_string(), "secret".to_string())]);

        let options = build_opencode_server_options(cwd.clone(), env.clone());

        assert_eq!(options.cwd, Some(cwd));
        assert_eq!(options.port, 0);
        assert_eq!(options.env, env);
        assert_eq!(options.config, Some(serde_json::json!({})));
    }

    async fn setup_services() -> (RunsService, RunsOpenCodeService, SqlitePool, TempDir) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        let repository = RunsRepository::new(pool.clone());
        let temp_dir = TempDir::new();
        let app_data_dir = temp_dir.path().join("app-data");
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let runs_service = RunsService::new(repository, worktrees_service);
        let projects_service = ProjectsService::new(
            ProjectsRepository::new(pool.clone()),
            ProjectFileSearchService::new(),
            WorktreesService::new(app_data_dir.clone()),
        );
        let task_status_transition_service = TaskStatusTransitionService::new(
            RunsRepository::new(pool.clone()),
            TasksRepository::new(pool.clone()),
            None,
        );
        let run_state_service = RunStateService::new(
            RunsRepository::new(pool.clone()),
            runs_service.clone(),
            None,
            app_data_dir.clone(),
        );
        let run_status_transition_service = RunStatusTransitionService::new(
            RunsRepository::new(pool.clone()),
            run_state_service.clone(),
            None,
        );
        let opencode_service = RunsOpenCodeService::new(
            runs_service.clone(),
            projects_service,
            task_status_transition_service,
            run_state_service,
            run_status_transition_service,
            app_data_dir,
        );

        (runs_service, opencode_service, pool, temp_dir)
    }

    async fn seed_task(pool: &SqlitePool, task_id: &str, repo_path: &Path) {
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
        .bind("todo")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_run(pool: &SqlitePool, run_id: &str, task_id: &str, status: &str) {
        let status = match status {
            "running" => "in_progress",
            "completed" => "complete",
            other => other,
        };
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

    async fn insert_running_handle(
        opencode_service: &RunsOpenCodeService,
        run_id: &str,
        task_id: &str,
        repo_path: &Path,
        client_base_url: Option<String>,
    ) {
        let server = create_opencode_server(Some(OpencodeServerOptions {
            cwd: Some(repo_path.to_path_buf()),
            port: 0,
            config: Some(serde_json::json!({})),
            ..Default::default()
        }))
        .await
        .unwrap();

        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: client_base_url.unwrap_or_else(|| server.url.clone()),
            directory: Some(repo_path.to_string_lossy().to_string()),
            ..Default::default()
        }))
        .unwrap();

        let (event_tx, _rx) = tokio::sync::broadcast::channel(8);
        let handle = Arc::new(super::RunOpenCodeHandle {
            generation: 1,
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            client,
            lifecycle: Arc::new(Mutex::new(super::RunsOpenCodeService::build_run_lifecycle(
                &super::RunDto {
                    id: run_id.to_string(),
                    task_id: task_id.to_string(),
                    project_id: "project-1".to_string(),
                    target_repo_id: None,
                    status: "running".to_string(),
                    run_state: None,
                    triggered_by: "user".to_string(),
                    created_at: "2024-01-01T00:00:00Z".to_string(),
                    started_at: None,
                    finished_at: None,
                    summary: None,
                    error_message: None,
                    worktree_id: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                    source_branch: None,
                    initial_prompt_sent_at: None,
                    initial_prompt_client_request_id: None,
                    setup_state: "pending".to_string(),
                    setup_started_at: None,
                    setup_finished_at: None,
                    setup_error_message: None,
                    cleanup_state: "pending".to_string(),
                    cleanup_started_at: None,
                    cleanup_finished_at: None,
                    cleanup_error_message: None,
                },
            ))),
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            subscriber_tasks: Arc::new(Mutex::new(HashMap::new())),
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx,
            event_stream_task: Arc::new(tokio::sync::Mutex::new(None)),
            buffered_events: Arc::new(Mutex::new(VecDeque::new())),
            session_runtime_state: Arc::new(Mutex::new(super::SessionRuntimeState::default())),
        });

        opencode_service
            .handles
            .write()
            .await
            .insert(run_id.to_string(), handle);
    }

    #[derive(Debug)]
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("orkestra-opencode-tests-{}", Uuid::new_v4()));
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

    #[test]
    fn initial_seed_request_detection_is_exact_and_run_scoped() {
        assert!(RunsOpenCodeService::is_initial_seed_request(
            "run-1",
            Some("initial-run-message:run-1")
        ));
        assert!(!RunsOpenCodeService::is_initial_seed_request(
            "run-1",
            Some("initial-run-message:run-2")
        ));
        assert!(!RunsOpenCodeService::is_initial_seed_request("run-1", None));
    }

    #[test]
    fn compose_initial_prompt_combines_task_context() {
        let prompt = RunsOpenCodeService::compose_initial_prompt(
            "Ship release notes",
            Some("\n\nDraft changelog\n\n\n\nVerify links\n"),
            Some("\n\nUse release template\n"),
        );

        assert_eq!(
            prompt,
            "Ship release notes\n\nDraft changelog\n\nVerify links\n\nImplementation guide:\nUse release template"
        );
    }

    #[test]
    fn parse_failed_lifecycle_commands_deduplicates_and_normalizes_commands() {
        let commands = RunsOpenCodeService::parse_failed_lifecycle_commands(
            "1\tbun install\n2\t  bun   install  \n1\tbun test\n",
        );

        assert_eq!(commands, vec!["bun install", "bun test"]);
    }

    #[test]
    fn compose_cleanup_failure_prompt_formats_single_command() {
        let prompt =
            RunsOpenCodeService::compose_cleanup_failure_prompt(&["bun install".to_string()]);

        assert_eq!(
            prompt,
            "The cleanup step `bun install` failed. Please investigate the failure and apply the appropriate fix."
        );
    }

    #[test]
    fn compose_cleanup_failure_prompt_formats_multiple_commands() {
        let prompt = RunsOpenCodeService::compose_cleanup_failure_prompt(&[
            "bun install".to_string(),
            "bun test".to_string(),
        ]);

        assert_eq!(
            prompt,
            "The following cleanup steps failed:\n- `bun install`\n- `bun test`\nPlease investigate these failures and apply the appropriate fixes."
        );
    }

    #[test]
    fn compose_cleanup_failure_prompt_uses_fallback_when_commands_are_unavailable() {
        let prompt = RunsOpenCodeService::compose_cleanup_failure_prompt(&[]);

        assert_eq!(
            prompt,
            "Cleanup failed before the affected step could be identified. Please investigate the cleanup script and apply the appropriate fix."
        );
    }

    #[tokio::test]
    async fn run_lifecycle_script_in_worktree_collects_failed_commands() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "queued").await;

        let worktree_id = "ALP/cleanup-fail";
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(worktree_id);
        fs::create_dir_all(&worktree_path).unwrap();
        update_run_worktree_id(&pool, "run-1", worktree_id).await;

        let err = opencode_service
            .run_lifecycle_script_in_worktree(
                "run-1",
                Some("set +e\nfalse\nls /definitely-missing-cleanup-dir\nexit 1"),
            )
            .await
            .expect_err("script should fail");

        assert_eq!(
            err.failed_commands(),
            ["false", "ls /definitely-missing-cleanup-dir"]
        );
    }

    #[test]
    fn map_permission_decision_to_reply_preserves_ui_contract() {
        assert_eq!(
            super::map_permission_decision_to_reply("deny"),
            Some("reject")
        );
        assert_eq!(
            super::map_permission_decision_to_reply("once"),
            Some("once")
        );
        assert_eq!(
            super::map_permission_decision_to_reply("always"),
            Some("always")
        );
        assert_eq!(
            super::map_permission_decision_to_reply("reject"),
            Some("reject")
        );
        assert_eq!(super::map_permission_decision_to_reply("allow"), None);
    }

    #[test]
    fn build_permission_reply_body_matches_opencode_contract() {
        let body = super::build_permission_reply_body("ses_123", "once", false);
        assert_eq!(
            body,
            serde_json::json!({
                "sessionID": "ses_123",
                "reply": "once",
                "remember": false,
            })
        );
        assert!(body.get("decision").is_none());
    }

    #[test]
    fn resolve_prompt_selection_prefers_complete_prompt_override_then_run_defaults_then_backend_defaults(
    ) {
        let selected = RunsOpenCodeService::resolve_prompt_selection(
            Some("run-agent"),
            Some("run-provider"),
            Some("run-model"),
            Some("prompt-agent"),
            Some("prompt-provider"),
            Some("prompt-model"),
        )
        .expect("complete prompt override should resolve");
        assert_eq!(
            selected,
            super::PromptSelection {
                agent: "prompt-agent".to_string(),
                provider_id: "prompt-provider".to_string(),
                model_id: "prompt-model".to_string(),
            }
        );

        let selected = RunsOpenCodeService::resolve_prompt_selection(
            Some("run-agent"),
            Some("run-provider"),
            Some("run-model"),
            None,
            None,
            None,
        );
        assert_eq!(
            selected.expect("run defaults should resolve"),
            super::PromptSelection {
                agent: "run-agent".to_string(),
                provider_id: "run-provider".to_string(),
                model_id: "run-model".to_string(),
            }
        );

        let selected = RunsOpenCodeService::resolve_prompt_selection(
            None,
            Some("run-provider"),
            None,
            Some("  "),
            None,
            None,
        )
        .expect("backend defaults should resolve");
        assert_eq!(
            selected,
            super::PromptSelection {
                agent: "build".to_string(),
                provider_id: "kimi-for-coding".to_string(),
                model_id: "k2p5".to_string(),
            }
        );
    }

    #[test]
    fn resolve_prompt_selection_rejects_partial_or_agent_only_overrides() {
        let partial = RunsOpenCodeService::resolve_prompt_selection(
            Some("run-agent"),
            Some("run-provider"),
            Some("run-model"),
            None,
            Some("prompt-provider"),
            None,
        );
        assert!(partial.is_err());

        let agent_only = RunsOpenCodeService::resolve_prompt_selection(
            Some("run-agent"),
            Some("run-provider"),
            Some("run-model"),
            Some("prompt-agent"),
            None,
            None,
        );
        assert!(agent_only.is_err());
    }

    #[test]
    fn parse_and_merge_provider_sources_collects_models_from_sdk_discovery_surfaces() {
        let provider_list = serde_json::json!([
            { "id": "openai", "name": "OpenAI" },
            { "id": "anthropic", "name": "Anthropic" }
        ]);
        let config_providers = serde_json::json!({
            "providers": [
                {
                    "id": "openai",
                    "models": [
                        { "id": "gpt-4.1", "name": "GPT-4.1" },
                        { "id": "gpt-4.1-mini", "name": "GPT-4.1 Mini" }
                    ]
                }
            ]
        });
        let config_get = serde_json::json!({
            "provider": {
                "anthropic": {
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4": { "name": "Claude Sonnet 4" }
                    }
                }
            }
        });

        let merged = super::merge_provider_options(vec![
            super::parse_providers_from_payload(&provider_list),
            super::parse_providers_from_payload(&config_providers),
            super::parse_providers_from_payload(&config_get),
        ]);

        assert_eq!(merged.len(), 2);

        let openai = merged
            .iter()
            .find(|provider| provider.id == "openai")
            .unwrap();
        assert_eq!(openai.name.as_deref(), Some("OpenAI"));
        assert_eq!(openai.models.len(), 2);

        let anthropic = merged
            .iter()
            .find(|provider| provider.id == "anthropic")
            .unwrap();
        assert_eq!(anthropic.name.as_deref(), Some("Anthropic"));
        assert_eq!(anthropic.models.len(), 1);
        assert_eq!(anthropic.models[0].model_id, "claude-sonnet-4");
    }

    #[test]
    fn parse_agents_from_config_get_supports_array_and_map_shapes() {
        let config_get = serde_json::json!({
            "agents": [
                { "id": "build", "name": "Build" },
                { "id": "plan", "name": "Plan" }
            ],
            "agent": {
                "review": { "name": "Review" },
                "build": { "name": "Build duplicate" }
            }
        });

        let agents = super::dedupe_agents(super::parse_agents_from_config_payload(&config_get));
        assert_eq!(agents.len(), 3);
        assert!(agents.iter().any(|agent| agent.id == "build"));
        assert!(agents.iter().any(|agent| agent.id == "plan"));
        assert!(agents.iter().any(|agent| agent.id == "review"));
    }

    #[test]
    fn merge_agent_sources_includes_app_agents_and_config_agents_without_duplicates() {
        let app_agents = serde_json::json!([
            { "id": "build", "name": "Build" },
            { "id": "review", "name": "Review" }
        ]);
        let config_get = serde_json::json!({
            "agents": {
                "build": { "name": "Build from config" },
                "plan": { "name": "Plan" }
            }
        });

        let agents = super::dedupe_agents(
            [
                super::parse_agents_from_config_payload(&app_agents),
                super::parse_agents_from_config_payload(&config_get),
            ]
            .concat(),
        );

        assert_eq!(agents.len(), 3);
        assert_eq!(agents[0].id, "build");
        assert_eq!(agents[1].id, "review");
        assert_eq!(agents[2].id, "plan");
    }

    #[test]
    fn parse_discovery_ignores_unrelated_sections_in_mixed_roots() {
        let config_get = serde_json::json!({
            "providers": {
                "openai": {
                    "models": {
                        "gpt-4.1": { "name": "GPT-4.1" }
                    }
                }
            },
            "agents": {
                "build": { "name": "Build" }
            },
            "featureFlags": {
                "provider": {
                    "name": "Not a provider"
                },
                "agent": {
                    "name": "Not an agent"
                }
            },
            "ui": {
                "providers": {
                    "theme": { "name": "Not a provider" }
                },
                "agents": {
                    "mode": { "name": "Not an agent" }
                }
            }
        });

        let providers = super::parse_providers_from_payload(&config_get);
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "openai");

        let agents = super::dedupe_agents(super::parse_agents_from_config_payload(&config_get));
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "build");
    }

    #[test]
    fn parse_providers_does_not_infer_from_unrelated_root_with_models() {
        let config_get = serde_json::json!({
            "workspace": {
                "models": {
                    "gpt-4.1": { "name": "GPT-4.1" }
                }
            }
        });

        let providers = super::parse_providers_from_payload(&config_get);
        assert!(providers.is_empty());
    }

    #[test]
    fn parse_agents_does_not_infer_from_unrelated_root_with_agent_like_fields() {
        let config_get = serde_json::json!({
            "workspace": {
                "model": "gpt-4.1",
                "tools": ["bash"],
                "prompt": "build it"
            }
        });

        let agents = super::dedupe_agents(super::parse_agents_from_config_payload(&config_get));
        assert!(agents.is_empty());
    }

    #[test]
    fn app_error_from_anyhow_preserves_context_chain() {
        let err = anyhow::Error::new(super::OpenCodeServiceError::MissingRunHandle)
            .context("while preparing run bootstrap payload");
        let app_err = super::app_error_from_anyhow(err);
        let rendered = app_err.to_string();
        assert!(rendered.contains("while preparing run bootstrap payload"));
        assert!(rendered.contains("OpenCode run handle not found"));
    }

    #[tokio::test]
    async fn start_run_opencode_respects_unsupported_and_preserves_idempotency_key() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "completed").await;

        let response = opencode_service.start_run_opencode("run-1").await.unwrap();
        assert_eq!(response.state, "unsupported");
        assert_eq!(response.client_request_id, "initial-run-message:run-1");

        let reclaimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1-retry")
            .await
            .unwrap();
        assert!(reclaimed);
    }

    #[tokio::test]
    async fn submit_initial_seed_releases_claim_when_run_is_unsupported() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "completed").await;

        let response = opencode_service
            .submit_run_opencode_prompt(
                "run-1",
                "seed prompt",
                Some("initial-run-message:run-1".to_string()),
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        assert_eq!(response.state, "unsupported");

        let reclaimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1-retry")
            .await
            .unwrap();
        assert!(reclaimed);
    }

    #[tokio::test]
    async fn bootstrap_completed_run_returns_read_only_without_registering_handle() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "completed").await;

        let response = opencode_service
            .bootstrap_run_opencode("run-1")
            .await
            .unwrap();

        assert_eq!(response.chat_mode, super::RunOpenCodeChatModeDto::ReadOnly);
        assert_eq!(response.state, "ready");
        assert!(response.reason.is_none());
        assert!(response.buffered_events.is_empty());
        assert!(!response.stream_connected);
        assert!(!opencode_service.handles.read().await.contains_key("run-1"));
    }

    #[tokio::test]
    async fn bootstrap_failed_run_remains_unavailable() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "failed").await;

        let response = opencode_service
            .bootstrap_run_opencode("run-1")
            .await
            .unwrap();

        assert_eq!(
            response.chat_mode,
            super::RunOpenCodeChatModeDto::Unavailable
        );
        assert_eq!(response.state, "unsupported");
        assert!(response.messages.is_empty());
        assert!(response.todos.is_empty());
        assert!(!opencode_service.handles.read().await.contains_key("run-1"));
    }

    #[tokio::test]
    async fn bootstrap_running_run_preserves_interactive_mode() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;

        let server = create_opencode_server(Some(OpencodeServerOptions {
            cwd: Some(repo_path.clone()),
            port: 0,
            config: Some(serde_json::json!({})),
            ..Default::default()
        }))
        .await
        .unwrap();

        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(repo_path.to_string_lossy().to_string()),
            ..Default::default()
        }))
        .unwrap();

        let (event_tx, _rx) = tokio::sync::broadcast::channel(8);
        let handle = Arc::new(super::RunOpenCodeHandle {
            generation: 1,
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            client,
            lifecycle: Arc::new(Mutex::new(super::RunsOpenCodeService::build_run_lifecycle(
                &super::RunDto {
                    id: "run-1".to_string(),
                    task_id: "task-1".to_string(),
                    project_id: "project-1".to_string(),
                    target_repo_id: None,
                    status: "running".to_string(),
                    run_state: None,
                    triggered_by: "user".to_string(),
                    created_at: "2024-01-01T00:00:00Z".to_string(),
                    started_at: None,
                    finished_at: None,
                    summary: None,
                    error_message: None,
                    worktree_id: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                    source_branch: None,
                    initial_prompt_sent_at: None,
                    initial_prompt_client_request_id: None,
                    setup_state: "pending".to_string(),
                    setup_started_at: None,
                    setup_finished_at: None,
                    setup_error_message: None,
                    cleanup_state: "pending".to_string(),
                    cleanup_started_at: None,
                    cleanup_finished_at: None,
                    cleanup_error_message: None,
                },
            ))),
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            subscriber_tasks: Arc::new(Mutex::new(HashMap::new())),
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx,
            event_stream_task: Arc::new(tokio::sync::Mutex::new(None)),
            buffered_events: Arc::new(Mutex::new(VecDeque::new())),
            session_runtime_state: Arc::new(Mutex::new(super::SessionRuntimeState::default())),
        });

        let mut handles = opencode_service.handles.write().await;
        handles.insert("run-1".to_string(), handle);
        drop(handles);

        let response = opencode_service
            .bootstrap_run_opencode("run-1")
            .await
            .unwrap();

        assert_eq!(
            response.chat_mode,
            super::RunOpenCodeChatModeDto::Interactive
        );
        assert_eq!(response.state, "running");
        assert_eq!(response.ready_phase.as_deref(), Some("warm_handle"));
    }

    #[tokio::test]
    async fn submit_initial_seed_releases_claim_when_ensure_ready_fails() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "queued").await;

        let result = opencode_service
            .submit_run_opencode_prompt(
                "run-1",
                "seed prompt",
                Some("initial-run-message:run-1".to_string()),
                None,
                None,
                None,
                None,
            )
            .await;

        assert!(result.is_err());

        let reclaimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1-retry")
            .await
            .unwrap();
        assert!(reclaimed);
    }

    #[tokio::test]
    async fn duplicate_initial_seed_non_claimant_is_accepted_no_op() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "queued").await;

        let claimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1")
            .await
            .unwrap();
        assert!(claimed);

        let response = opencode_service
            .submit_run_opencode_prompt(
                "run-1",
                "seed prompt",
                Some("initial-run-message:run-1".to_string()),
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        assert_eq!(response.state, "accepted");

        let finalizing_duplicate = runs_service
            .finalize_initial_prompt_send_for_claimant(
                "run-1",
                "initial-run-message:run-1-duplicate",
            )
            .await
            .unwrap();
        assert!(!finalizing_duplicate);
    }

    #[tokio::test]
    async fn manual_client_request_path_remains_unaffected() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "queued").await;

        let result = opencode_service
            .submit_run_opencode_prompt(
                "run-1",
                "manual prompt",
                Some("manual-123".to_string()),
                None,
                None,
                None,
                None,
            )
            .await;

        assert!(result.is_err());

        let initial_seed_claim_available = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1")
            .await
            .unwrap();
        assert!(initial_seed_claim_available);
    }

    #[tokio::test]
    async fn submit_initial_seed_releases_claim_when_session_creation_fails() {
        let (runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;

        let server = create_opencode_server(Some(OpencodeServerOptions {
            cwd: Some(repo_path.clone()),
            port: 0,
            config: Some(serde_json::json!({})),
            ..Default::default()
        }))
        .await
        .unwrap();

        let invalid_client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: "http://127.0.0.1:1".to_string(),
            directory: Some(repo_path.to_string_lossy().to_string()),
            ..Default::default()
        }))
        .unwrap();

        let (event_tx, _rx) = tokio::sync::broadcast::channel(8);
        let handle = Arc::new(super::RunOpenCodeHandle {
            generation: 1,
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            client: invalid_client,
            lifecycle: Arc::new(Mutex::new(super::RunsOpenCodeService::build_run_lifecycle(
                &super::RunDto {
                    id: "run-1".to_string(),
                    task_id: "task-1".to_string(),
                    project_id: "project-1".to_string(),
                    target_repo_id: None,
                    status: "running".to_string(),
                    run_state: None,
                    triggered_by: "user".to_string(),
                    created_at: "2024-01-01T00:00:00Z".to_string(),
                    started_at: None,
                    finished_at: None,
                    summary: None,
                    error_message: None,
                    worktree_id: None,
                    agent_id: None,
                    provider_id: None,
                    model_id: None,
                    source_branch: None,
                    initial_prompt_sent_at: None,
                    initial_prompt_client_request_id: None,
                    setup_state: "pending".to_string(),
                    setup_started_at: None,
                    setup_finished_at: None,
                    setup_error_message: None,
                    cleanup_state: "pending".to_string(),
                    cleanup_started_at: None,
                    cleanup_finished_at: None,
                    cleanup_error_message: None,
                },
            ))),
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            subscriber_tasks: Arc::new(Mutex::new(HashMap::new())),
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx,
            event_stream_task: Arc::new(tokio::sync::Mutex::new(None)),
            buffered_events: Arc::new(Mutex::new(VecDeque::new())),
            session_runtime_state: Arc::new(Mutex::new(super::SessionRuntimeState::default())),
        });

        let mut handles = opencode_service.handles.write().await;
        handles.insert("run-1".to_string(), handle);
        drop(handles);

        let result = opencode_service
            .submit_run_opencode_prompt(
                "run-1",
                "seed prompt",
                Some("initial-run-message:run-1".to_string()),
                None,
                None,
                None,
                None,
            )
            .await;
        assert!(result.is_err());

        let reclaimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1-retry")
            .await
            .unwrap();
        assert!(reclaimed);
    }

    #[tokio::test]
    async fn stop_run_opencode_removes_handle_and_is_idempotent() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        insert_running_handle(&opencode_service, "run-1", "task-1", &repo_path, None).await;

        let first = opencode_service
            .stop_run_opencode("run-1", Some("test_shutdown"))
            .await
            .unwrap();
        assert_eq!(first.state, "stopped");
        assert!(!opencode_service.handles.read().await.contains_key("run-1"));

        let second = opencode_service
            .stop_run_opencode("run-1", Some("test_shutdown_repeat"))
            .await
            .unwrap();
        assert_eq!(second.state, "stopped");
        assert!(!opencode_service.handles.read().await.contains_key("run-1"));
    }

    async fn set_run_session_id(pool: &SqlitePool, run_id: &str, session_id: &str) {
        sqlx::query("UPDATE runs SET opencode_session_id = ? WHERE id = ?")
            .bind(session_id)
            .bind(run_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn set_task_status(pool: &SqlitePool, task_id: &str, status: &str) {
        sqlx::query("UPDATE tasks SET status = ? WHERE id = ?")
            .bind(status)
            .bind(task_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn fetch_task_status(pool: &SqlitePool, task_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn update_repository_scripts(
        pool: &SqlitePool,
        repository_id: &str,
        setup_script: Option<&str>,
        cleanup_script: Option<&str>,
    ) {
        sqlx::query(
            "UPDATE project_repositories SET setup_script = ?, cleanup_script = ? WHERE id = ?",
        )
        .bind(setup_script)
        .bind(cleanup_script)
        .bind(repository_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn update_run_worktree_id(pool: &SqlitePool, run_id: &str, worktree_id: &str) {
        sqlx::query("UPDATE runs SET worktree_id = ? WHERE id = ?")
            .bind(worktree_id)
            .bind(run_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn fetch_run_setup_state(pool: &SqlitePool, run_id: &str) -> String {
        sqlx::query_scalar("SELECT setup_state FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn session_idle_transitions_doing_task_to_review_for_matching_session() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-1"}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "review");
    }

    #[tokio::test]
    async fn session_status_idle_hint_does_not_transition_task() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.status",
                r#"{"sessionID":"session-1","status":"idle"}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "doing");
    }

    #[tokio::test]
    async fn session_idle_mismatch_and_pending_blockers_prevent_transition() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-stale"}"#,
                &state,
            )
            .await
            .unwrap();

        opencode_service
            .process_runtime_event(
                "run-1",
                "question.asked",
                r#"{"sessionID":"session-1","requestID":"q-1"}"#,
                &state,
            )
            .await
            .unwrap();
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-1"}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "doing");
    }

    #[tokio::test]
    async fn duplicate_session_idle_events_are_idempotent() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-1"}"#,
                &state,
            )
            .await
            .unwrap();
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-1"}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "review");
    }

    #[tokio::test]
    async fn pending_permission_blocks_session_idle_transition() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "permission.asked",
                r#"{"sessionID":"session-1","requestID":"p-1"}"#,
                &state,
            )
            .await
            .unwrap();
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"sessionID":"session-1"}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "doing");
    }

    #[tokio::test]
    async fn permission_asked_tracks_request_id_from_properties_id() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));

        opencode_service
            .process_runtime_event(
                "run-1",
                "message",
                r#"{"type":"permission.asked","properties":{"id":"per_d42b2cd3e001QDIROGPkXz54d3","permission":"external_directory","patterns":["/home/louis/*"],"always":["/home/louis/*"],"metadata":{"filepath":"/home/louis","parentDir":"/home/louis"},"sessionID":"session-1","tool":{"messageID":"...","callID":"..."}}}"#,
                &state,
            )
            .await
            .unwrap();

        let guard = state.lock().unwrap();
        assert!(guard
            .pending_permissions
            .contains("per_d42b2cd3e001QDIROGPkXz54d3"));
    }

    #[tokio::test]
    async fn wrapped_session_idle_payload_transitions_task_to_review() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "session.idle",
                r#"{"type":"session.idle","properties":{"sessionID":"session-1"}}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "review");
    }

    #[tokio::test]
    async fn message_envelope_routes_inner_type_and_preserves_blockers() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "running").await;
        set_run_session_id(&pool, "run-1", "session-1").await;
        set_task_status(&pool, "task-1", "doing").await;

        let state = Arc::new(Mutex::new(super::SessionRuntimeState::default()));
        opencode_service
            .process_runtime_event(
                "run-1",
                "message",
                r#"{"type":"session.status","properties":{"sessionID":"session-1","status":{"type":"busy"}}}"#,
                &state,
            )
            .await
            .unwrap();

        {
            let guard = state.lock().unwrap();
            assert_eq!(guard.last_status_hint.as_deref(), Some("busy"));
        }

        opencode_service
            .process_runtime_event(
                "run-1",
                "message",
                r#"{"type":"question.asked","properties":{"sessionID":"session-1","requestID":"q-1"}}"#,
                &state,
            )
            .await
            .unwrap();
        opencode_service
            .process_runtime_event(
                "run-1",
                "message",
                r#"{"type":"session.idle","properties":{"sessionID":"session-1"}}"#,
                &state,
            )
            .await
            .unwrap();

        assert_eq!(fetch_task_status(&pool, "task-1").await, "doing");
    }

    #[tokio::test]
    async fn start_run_opencode_blocks_initial_prompt_when_setup_script_fails() {
        let (_runs_service, opencode_service, pool, temp_dir) = setup_services().await;
        let repo_path = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        seed_task(&pool, "task-1", &repo_path).await;
        seed_run(&pool, "run-1", "task-1", "queued").await;

        update_repository_scripts(&pool, "repo-1", Some("exit 7"), None).await;
        let worktree_id = "ALP/setup-fail";
        let worktree_path = temp_dir
            .path()
            .join("app-data")
            .join("worktrees")
            .join(worktree_id);
        fs::create_dir_all(&worktree_path).unwrap();
        update_run_worktree_id(&pool, "run-1", worktree_id).await;

        let response = opencode_service.start_run_opencode("run-1").await.unwrap();
        assert_eq!(response.state, "error");
        assert_eq!(
            response.reason.as_deref(),
            Some("Setup script failed. Please fix it before you continue.")
        );
        assert_eq!(fetch_run_setup_state(&pool, "run-1").await, "failed");
    }
}
