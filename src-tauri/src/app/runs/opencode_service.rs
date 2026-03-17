use crate::app::errors::AppError;
use crate::app::runs::dto::{
    BootstrapRunOpenCodeResponse, EnsureRunOpenCodeResponse, RawAgentEvent, RunDto,
    RunOpenCodeSessionMessageDto,
    RunOpenCodeSessionTodoDto, SubmitRunOpenCodePromptResponse,
};
use crate::app::runs::service::RunsService;
use chrono::Utc;
use opencode::{
    OpencodeClient, OpencodeClientConfig, OpencodeServer, OpencodeServerOptions, RequestOptions,
    create_opencode_client, create_opencode_server, types::PartInput,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::async_runtime::JoinHandle;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant, sleep};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
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
                "stream.disconnected" | "stream.reconnecting" | "stream.terminated" => return false,
                "stream.reconnected" => return true,
                _ => {}
            }
        }

        true
    }

    async fn ensure_run_ready_for_operation(
        &self,
        run_id: &str,
    ) -> Result<(EnsureRunOpenCodeResponse, Option<Arc<RunOpenCodeHandle>>, &'static str), AppError> {
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
            .map_err(|err| AppError::validation(format!("failed to create OpenCode session: {err}")))?;
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

    pub async fn ensure_run_opencode(&self, run_id: &str) -> Result<EnsureRunOpenCodeResponse, AppError> {
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

        let server = create_opencode_server(Some(options))
            .await
            .map_err(|err| AppError::validation(format!("failed to start OpenCode server: {err}")))?;
        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(worktree_path.to_string_lossy().to_string()),
            timeout: Duration::from_secs(300),
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

        self.spawn_event_stream(run.id.clone(), generation, client, event_tx, buffered_events);

        if run.status == "queued" {
            let _ = self.runs_service.transition_queued_to_running(&run.id).await?;
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

        let (ensured, handle, ready_phase) = self.ensure_run_ready_for_operation(run_id).await?;
        if ensured.state == "unsupported" {
            return Ok(SubmitRunOpenCodePromptResponse {
                state: "unsupported".to_string(),
                reason: ensured.reason,
                queued_at: Utc::now().to_rfc3339(),
                client_request_id,
            });
        }

        let handle = handle.ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        let session_id = self.get_or_create_session_id(run_id, handle.clone()).await?;

        let mut request = RequestOptions::default().with_path("id", session_id);
        if let Some(request_id) = client_request_id.as_ref() {
            request = request.with_header("x-request-id", request_id.clone());
        }
        request = request.with_body(serde_json::json!({
            "model": {
                "providerID": "kimi-for-coding",
                "modelID": "k2p5",
            },
            "parts": [PartInput::Raw(serde_json::json!({
                "type": "text",
                "text": prompt,
            }))],
        }));

        handle
            .client
            .session()
            .prompt_async(request)
            .await
            .map_err(|err| AppError::validation(format!("failed to submit OpenCode prompt: {err}")))?;

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
            .map_err(|err| AppError::validation(format!("failed to fetch OpenCode session messages: {err}")))?;

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
        let response = handle
            .client
            .session()
            .todo(request)
            .await
            .map_err(|err| AppError::validation(format!("failed to fetch OpenCode session todos: {err}")))?;

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
            let messages_response = handle
                .client
                .session()
                .messages(request)
                .await
                .map_err(|err| {
                    AppError::validation(format!("failed to fetch OpenCode session messages: {err}"))
                })?;
            let request = RequestOptions::default().with_path("id", session_id.clone());
            let todos_response = handle
                .client
                .session()
                .todo(request)
                .await
                .map_err(|err| {
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
                let mut subscriber_tasks = handle
                    .subscriber_tasks
                    .lock()
                    .map_err(|_| AppError::validation("failed to lock OpenCode subscriber tasks"))?;
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
                    RunsOpenCodeService::push_event(&event_tx, &buffered_events, event_name, sse.data);
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
        if worktree_id.is_empty() {
            return Err(AppError::not_found("run worktree not found"));
        }

        if run.project_id.trim().is_empty() {
            return Err(AppError::validation("run project_id is required"));
        }

        let worktree_path = self.worktrees_root.join(&run.project_id).join(worktree_id);
        if !worktree_path.exists() {
            return Err(AppError::not_found("run worktree path not found"));
        }

        Ok(worktree_path)
    }
}
