use crate::app::errors::AppError;
use crate::app::runs::dto::{
    BootstrapRunOpenCodeResponse, EnsureRunOpenCodeResponse, RawAgentEvent, RunDto,
    RunOpenCodeSessionMessageDto, RunOpenCodeSessionTodoDto, StartRunOpenCodeResponse,
    SubmitRunOpenCodePromptResponse,
};
use crate::app::runs::service::RunsService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use chrono::Utc;
use opencode::{
    create_opencode_client, create_opencode_server, types::PartInput, OpencodeClient,
    OpencodeClientConfig, OpencodeServer, OpencodeServerOptions, RequestOptions,
};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration, Instant};
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{error, info};

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

const MAX_BUFFERED_EVENTS: usize = 500;
const EVENT_BROADCAST_CAPACITY: usize = 512;
const STREAM_RECONNECT_BASE_DELAY_MS: u64 = 250;
const STREAM_RECONNECT_MAX_DELAY_MS: u64 = 8_000;
const STREAM_MAX_RECONNECT_ATTEMPTS: u32 = 8;

#[derive(Clone)]
pub struct RunsOpenCodeService {
    runs_service: RunsService,
    worktrees_root: PathBuf,
    handles: Arc<RwLock<HashMap<String, Arc<RunOpenCodeHandle>>>>,
    init_locks: Arc<RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
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
    session_id: Arc<Mutex<Option<String>>>,
    session_init_lock: tokio::sync::Mutex<()>,
    subscribers: Arc<Mutex<HashMap<String, Channel<RawAgentEvent>>>>,
    subscriber_tasks: Arc<Mutex<HashMap<String, SubscriberTaskEntry>>>,
    subscriber_generation: AtomicU64,
    subscriber_lifecycle_lock: tokio::sync::Mutex<()>,
    event_tx: tokio::sync::broadcast::Sender<RawAgentEvent>,
    buffered_events: Arc<Mutex<VecDeque<RawAgentEvent>>>,
}

struct SubscriberTaskEntry {
    generation: u64,
    handle: JoinHandle<()>,
}

impl RunsOpenCodeService {
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
        if matches!(status, "completed" | "failed" | "cancelled") {
            return Some(format!("run status '{}' is not supported", status));
        }

        if !matches!(status, "queued" | "preparing" | "running") {
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
            let run = self.runs_service.get_run(run_id).await?;
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
                .map_err(|_| AppError::validation("failed to lock OpenCode session id"))?;
            session_guard.clone()
        };

        if let Some(existing) = persisted_session_id.or(in_memory_session_id) {
            let mut session_guard = handle
                .session_id
                .lock()
                .map_err(|_| AppError::validation("failed to lock OpenCode session id"))?;
            if session_guard.is_none() {
                *session_guard = Some(existing.clone());
            }
            return Ok(existing);
        }

        let create_start = Instant::now();
        let created = handle
            .client
            .session()
            .create(RequestOptions::default())
            .await
            .map_err(|err| {
                AppError::validation(format!("failed to create OpenCode session: {err}"))
            })?;
        let id = created
            .data
            .get("id")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .ok_or_else(|| AppError::validation("OpenCode session create response missing id"))?;
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
                    AppError::validation(
                        "OpenCode session id was not persisted and no canonical value exists",
                    )
                })?
        };

        let mut session_guard = handle
            .session_id
            .lock()
            .map_err(|_| AppError::validation("failed to lock OpenCode session id"))?;
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

    pub fn new(runs_service: RunsService, app_data_dir: PathBuf) -> Self {
        Self {
            runs_service,
            worktrees_root: app_data_dir.join("worktrees"),
            handles: Arc::new(RwLock::new(HashMap::new())),
            init_locks: Arc::new(RwLock::new(HashMap::new())),
            handle_generation: Arc::new(AtomicU64::new(1)),
        }
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

        if self.handles.read().await.contains_key(&run.id) {
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
        let mut options = OpencodeServerOptions {
            cwd: Some(worktree_path.clone()),
            ..Default::default()
        };
        options.port = 0;
        options.config = Some(serde_json::json!({}));

        let server = create_opencode_server(Some(options)).await.map_err(|err| {
            AppError::validation(format!("failed to start OpenCode server: {err}"))
        })?;
        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(worktree_path.to_string_lossy().to_string()),
            timeout: Duration::from_secs(1800),
            ..Default::default()
        }))
        .map_err(|err| AppError::validation(format!("failed to create OpenCode client: {err}")))?;

        let max_health_wait = Duration::from_secs(10);
        let health_retry_interval = Duration::from_millis(250);
        let health_start = Instant::now();

        loop {
            match client.global().health(RequestOptions::default()).await {
                Ok(_) => break,
                Err(err) => {
                    if health_start.elapsed() >= max_health_wait {
                        return Err(AppError::validation(format!(
                            "OpenCode health check failed after retries: {err}"
                        )));
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
        let handle = Arc::new(RunOpenCodeHandle {
            generation,
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            client: client.clone(),
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: subscribers.clone(),
            subscriber_tasks,
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx: event_tx.clone(),
            buffered_events: buffered_events.clone(),
        });

        self.handles
            .write()
            .await
            .insert(run.id.clone(), handle.clone());

        self.spawn_event_stream(
            run.id.clone(),
            generation,
            client,
            event_tx,
            buffered_events,
        );

        if run.status == "queued" {
            let _ = self
                .runs_service
                .transition_queued_to_running(&run.id)
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
        agent: Option<String>,
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

        let selected_agent = agent
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("build");

        let mut request = RequestOptions::default().with_path("id", session_id);
        if let Some(request_id) = client_request_id.as_ref() {
            request = request.with_header("x-request-id", request_id.clone());
        }
        request = request.with_body(serde_json::json!({
            "agent": selected_agent,
            "model": {
                "providerID": "kimi-for-coding",
                "modelID": "k2p5",
            },
            "parts": [PartInput::Raw(serde_json::json!({
                "type": "text",
                "text": prompt,
            }))],
        }));

        let send_result = handle.client.session().prompt_async(request).await;

        if let Err(err) = send_result {
            self.release_initial_seed_claim_if_claimant(run_id, claimed_initial_seed_request_id)
                .await?;
            return Err(AppError::validation(format!(
                "failed to submit OpenCode prompt: {err}"
            )));
        }

        if let Some(claim_request_id) = claimed_initial_seed_request_id {
            let finalized = self
                .runs_service
                .finalize_initial_prompt_send_for_claimant(run_id, claim_request_id)
                .await?;
            if !finalized {
                return Err(AppError::validation(
                    "initial prompt claimant failed to finalize sent state",
                ));
            }
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

    pub async fn start_run_opencode(
        &self,
        run_id: &str,
    ) -> Result<StartRunOpenCodeResponse, AppError> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(AppError::validation("run_id is required"));
        }

        let context = self
            .runs_service
            .get_run_initial_prompt_context(run_id)
            .await?;
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
    ) -> Result<Vec<RunOpenCodeSessionMessageDto>, AppError> {
        let run = self.runs_service.get_run_model(run_id).await?;
        let Some(session_id) = run.opencode_session_id else {
            return Ok(vec![]);
        };

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(vec![]);
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        let request = RequestOptions::default().with_path("id", session_id);
        let response = handle
            .client
            .session()
            .messages(request)
            .await
            .map_err(|err| {
                AppError::validation(format!("failed to fetch OpenCode session messages: {err}"))
            })?;

        Ok(value_array_to_message_wrappers(response.data))
    }

    pub async fn get_run_opencode_session_todos(
        &self,
        run_id: &str,
    ) -> Result<Vec<RunOpenCodeSessionTodoDto>, AppError> {
        let run = self.runs_service.get_run_model(run_id).await?;
        let Some(session_id) = run.opencode_session_id else {
            return Ok(vec![]);
        };

        let (ensured, handle, _) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(vec![]);
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        let request = RequestOptions::default().with_path("id", session_id);
        let response = handle.client.session().todo(request).await.map_err(|err| {
            AppError::validation(format!("failed to fetch OpenCode session todos: {err}"))
        })?;

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
                .map_err(|_| AppError::validation("failed to lock OpenCode subscribers"))?;
            subscribers.insert(subscriber_id.to_string(), on_output);
        }

        let previous_task = {
            let mut subscriber_tasks = handle
                .subscriber_tasks
                .lock()
                .map_err(|_| AppError::validation("failed to lock OpenCode subscriber tasks"))?;
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
                .map_err(|_| AppError::validation("failed to lock OpenCode subscriber tasks"))?;
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

        let buffered = handle
            .buffered_events
            .lock()
            .map_err(|_| AppError::validation("failed to lock OpenCode buffered events"))?;
        Ok(buffered.iter().cloned().collect())
    }

    pub async fn build_run_opencode_bootstrap_payload(
        &self,
        run_id: &str,
    ) -> Result<BootstrapRunOpenCodeResponse, AppError> {
        let bootstrap_start = Instant::now();
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
                buffered_events: vec![],
                messages: vec![],
                todos: vec![],
                session_id: None,
                stream_connected: false,
                ready_phase: Some(ready_phase.to_string()),
            });
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;
        let buffered_events = {
            let buffered = handle
                .buffered_events
                .lock()
                .map_err(|_| AppError::validation("failed to lock OpenCode buffered events"))?;
            buffered.iter().cloned().collect::<Vec<_>>()
        };

        let run = self.runs_service.get_run_model(run_id).await?;
        let session_id = run.opencode_session_id.filter(|id| !id.trim().is_empty());

        let (messages, todos) = if let Some(session_id) = session_id.as_ref() {
            let request = RequestOptions::default().with_path("id", session_id.clone());
            let messages_response =
                handle
                    .client
                    .session()
                    .messages(request)
                    .await
                    .map_err(|err| {
                        AppError::validation(format!(
                            "failed to fetch OpenCode session messages: {err}"
                        ))
                    })?;
            let request = RequestOptions::default().with_path("id", session_id.clone());
            let todos_response = handle.client.session().todo(request).await.map_err(|err| {
                AppError::validation(format!("failed to fetch OpenCode session todos: {err}"))
            })?;

            (
                value_array_to_message_wrappers(messages_response.data),
                value_array_to_todo_wrappers(todos_response.data),
            )
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
                    .map_err(|_| AppError::validation("failed to lock OpenCode subscribers"))?;
                subscribers.remove(subscriber_id);
            }

            let subscriber_task = {
                let mut subscriber_tasks = handle.subscriber_tasks.lock().map_err(|_| {
                    AppError::validation("failed to lock OpenCode subscriber tasks")
                })?;
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
    ) {
        let handles = self.handles.clone();
        let init_locks = self.init_locks.clone();
        tauri::async_runtime::spawn(async move {
            let mut reconnect_attempt: u32 = 0;

            loop {
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
                            break;
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
                    break;
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

            let mut handles_guard = handles.write().await;
            let should_remove = handles_guard
                .get(&run_id)
                .map(|current| current.generation == generation)
                .unwrap_or(false);
            if should_remove {
                handles_guard.remove(&run_id);
                init_locks.write().await.remove(&run_id);
            }
        });
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
    use super::RunsOpenCodeService;
    use crate::app::db::migrations::run_migrations;
    use crate::app::db::repositories::runs::RunsRepository;
    use crate::app::runs::service::RunsService;
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

    async fn setup_services() -> (RunsService, RunsOpenCodeService, SqlitePool, TempDir) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();

        let repository = RunsRepository::new(pool.clone());
        let temp_dir = TempDir::new();
        let app_data_dir = temp_dir.path().join("app-data");
        let worktrees_service = WorktreesService::new(app_data_dir.clone());
        let runs_service = RunsService::new(repository, worktrees_service);
        let opencode_service = RunsOpenCodeService::new(runs_service.clone(), app_data_dir);

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
            session_id: Arc::new(Mutex::new(None)),
            session_init_lock: tokio::sync::Mutex::new(()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            subscriber_tasks: Arc::new(Mutex::new(HashMap::new())),
            subscriber_generation: AtomicU64::new(1),
            subscriber_lifecycle_lock: tokio::sync::Mutex::new(()),
            event_tx,
            buffered_events: Arc::new(Mutex::new(VecDeque::new())),
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
            )
            .await;
        assert!(result.is_err());

        let reclaimed = runs_service
            .claim_initial_prompt_send_if_unset("run-1", "initial-run-message:run-1-retry")
            .await
            .unwrap();
        assert!(reclaimed);
    }
}
