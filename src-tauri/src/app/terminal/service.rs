use crate::app::errors::AppError;
use crate::app::runs::dto::RunDto;
use crate::app::runs::service::RunsService;
use crate::app::terminal::error::TerminalServiceError;
use crate::app::worktrees::pathing::resolve_worktree_path_typed;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Clone)]
pub struct TerminalService {
    runs_service: RunsService,
    worktrees_root: PathBuf,
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl std::fmt::Debug for TerminalService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TerminalService")
            .field("worktrees_root", &self.worktrees_root)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRunTerminalResponse {
    pub session_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "event")]
pub enum TerminalFrame {
    Data {
        chunk_base64: String,
    },
    Exit {
        code: Option<i32>,
        signal: Option<i32>,
    },
    Error {
        message: String,
    },
    Closed,
}

struct TerminalSession {
    generation: u64,
    owner_label: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

impl TerminalService {
    pub fn new(runs_service: RunsService, app_data_dir: PathBuf) -> Self {
        Self {
            runs_service,
            worktrees_root: app_data_dir.join("worktrees"),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_run_terminal(
        &self,
        owner_label: &str,
        run_id: &str,
        route_instance_id: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalFrame>,
    ) -> Result<OpenRunTerminalResponse, AppError> {
        self.open_run_terminal_typed(
            owner_label,
            run_id,
            route_instance_id,
            cols,
            rows,
            on_output,
        )
        .await
        .map_err(|err| err.to_app_error())
    }

    async fn open_run_terminal_typed(
        &self,
        owner_label: &str,
        run_id: &str,
        route_instance_id: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalFrame>,
    ) -> Result<OpenRunTerminalResponse, TerminalServiceError> {
        let owner_label = owner_label.trim();
        let route_instance_id = route_instance_id.trim();
        if owner_label.is_empty() {
            return Err(TerminalServiceError::OwnerLabelRequired);
        }
        if route_instance_id.is_empty() {
            return Err(TerminalServiceError::RouteInstanceIdRequired);
        }

        let size = Self::validate_size(cols, rows)?;
        let run = self.runs_service.get_run(run_id).await.map_err(|source| {
            TerminalServiceError::ResolveRun {
                run_id: run_id.to_string(),
                source,
            }
        })?;
        let cwd = self.resolve_worktree_path_typed(&run)?;
        let shell = Self::resolve_shell();

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|source| TerminalServiceError::OpenPty { source })?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd.clone());

        let child =
            pair.slave
                .spawn_command(cmd)
                .map_err(|source| TerminalServiceError::SpawnProcess {
                    shell: shell.clone(),
                    cwd: cwd.display().to_string(),
                    source,
                })?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|source| TerminalServiceError::CreateReader { source })?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|source| TerminalServiceError::CreateWriter { source })?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let generation = 1_u64;
        let child_arc = Arc::new(Mutex::new(child));

        let session = TerminalSession {
            generation,
            owner_label: owner_label.to_string(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer: child_arc.clone(),
        };

        self.sessions
            .lock()
            .map_err(|_| TerminalServiceError::LockSessionRegistry)?
            .insert(session_id.clone(), session);

        self.spawn_terminal_reader(session_id.clone(), generation, reader, child_arc, on_output);

        Ok(OpenRunTerminalResponse {
            session_id,
            generation,
        })
    }

    pub fn write_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        data: &str,
    ) -> Result<(), AppError> {
        self.write_run_terminal_typed(owner_label, session_id, generation, data)
            .map_err(|err| err.to_app_error())
    }

    fn write_run_terminal_typed(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        data: &str,
    ) -> Result<(), TerminalServiceError> {
        let writer = self.with_session(owner_label, session_id, generation, |session| {
            session.writer.clone()
        })?;
        let mut writer = writer
            .lock()
            .map_err(|_| TerminalServiceError::LockWriter)?;
        writer
            .write_all(data.as_bytes())
            .map_err(|source| TerminalServiceError::WriteTerminal { source })?;
        writer
            .flush()
            .map_err(|source| TerminalServiceError::FlushTerminal { source })
    }

    pub fn resize_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        self.resize_run_terminal_typed(owner_label, session_id, generation, cols, rows)
            .map_err(|err| err.to_app_error())
    }

    fn resize_run_terminal_typed(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        cols: u16,
        rows: u16,
    ) -> Result<(), TerminalServiceError> {
        let size = Self::validate_size(cols, rows)?;
        let master = self.with_session(owner_label, session_id, generation, |session| {
            session.master.clone()
        })?;
        let master = master.lock().map_err(|_| TerminalServiceError::LockPty)?;
        master
            .resize(size)
            .map_err(|source| TerminalServiceError::ResizeTerminal { source })
    }

    pub fn kill_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), AppError> {
        self.kill_run_terminal_typed(owner_label, session_id, generation)
            .map_err(|err| err.to_app_error())
    }

    fn kill_run_terminal_typed(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), TerminalServiceError> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| TerminalServiceError::LockSessionRegistry)?;
            let Some(session) = sessions.get(session_id) else {
                return Ok(());
            };
            self.validate_owner_generation(owner_label, session_id, generation, session)?;
            sessions
                .remove(session_id)
                .ok_or(TerminalServiceError::SessionNotFound)?
        };

        let mut killer = session
            .killer
            .lock()
            .map_err(|_| TerminalServiceError::LockProcessHandle)?;
        let _ = killer.kill();
        Ok(())
    }

    fn with_session<T>(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        selector: impl FnOnce(&TerminalSession) -> T,
    ) -> Result<T, TerminalServiceError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| TerminalServiceError::LockSessionRegistry)?;
        let session = sessions
            .get(session_id)
            .ok_or(TerminalServiceError::SessionNotFound)?;
        self.validate_owner_generation(owner_label, session_id, generation, session)?;
        Ok(selector(session))
    }

    fn validate_owner_generation(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        session: &TerminalSession,
    ) -> Result<(), TerminalServiceError> {
        if session.generation != generation {
            return Err(TerminalServiceError::SessionGenerationMismatch {
                session_id: session_id.to_string(),
            });
        }
        if session.owner_label != owner_label {
            return Err(TerminalServiceError::SessionOwnerMismatch {
                session_id: session_id.to_string(),
            });
        }
        Ok(())
    }

    fn resolve_worktree_path_typed(&self, run: &RunDto) -> Result<PathBuf, TerminalServiceError> {
        let worktree_id = run
            .worktree_id
            .as_deref()
            .ok_or(TerminalServiceError::RunWorktreeMissing)?
            .trim();
        resolve_worktree_path_typed(&self.worktrees_root, worktree_id)
            .map_err(TerminalServiceError::from)
    }

    fn validate_size(cols: u16, rows: u16) -> Result<PtySize, TerminalServiceError> {
        if cols == 0 || rows == 0 {
            return Err(TerminalServiceError::InvalidTerminalSize);
        }
        Ok(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
    }

    fn resolve_shell() -> String {
        #[cfg(windows)]
        {
            for candidate in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
                if Self::is_executable_on_path(candidate) {
                    return candidate.to_string();
                }
            }
            "cmd.exe".to_string()
        }

        #[cfg(not(windows))]
        {
            if let Ok(shell) = std::env::var("SHELL") {
                let trimmed = shell.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
            if std::path::Path::new("/bin/bash").exists() {
                return "/bin/bash".to_string();
            }
            "/bin/sh".to_string()
        }
    }

    #[cfg(windows)]
    fn is_executable_on_path(candidate: &str) -> bool {
        if candidate.contains(std::path::MAIN_SEPARATOR) {
            return std::path::Path::new(candidate).exists();
        }
        std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths)
                    .map(|path| path.join(candidate))
                    .any(|full_path| full_path.exists())
            })
            .unwrap_or(false)
    }

    fn spawn_terminal_reader(
        &self,
        session_id: String,
        generation: u64,
        mut reader: Box<dyn Read + Send>,
        child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
        on_output: Channel<TerminalFrame>,
    ) {
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let mut buf = [0_u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk_base64 =
                            base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        if on_output
                            .send(TerminalFrame::Data { chunk_base64 })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(err) => {
                        let _ = on_output.send(TerminalFrame::Error {
                            message: format!("terminal read failed: {err}"),
                        });
                        break;
                    }
                }
            }

            let (code, signal) = match child.lock() {
                Ok(mut child) => match child.wait() {
                    Ok(status) => {
                        let code = i32::try_from(status.exit_code()).ok();
                        let signal = status.signal().and_then(|value| value.parse::<i32>().ok());
                        (code, signal)
                    }
                    Err(err) => {
                        let _ = on_output.send(TerminalFrame::Error {
                            message: format!("terminal wait failed: {err}"),
                        });
                        (None, None)
                    }
                },
                Err(_) => {
                    let _ = on_output.send(TerminalFrame::Error {
                        message: "failed to lock terminal process handle".to_string(),
                    });
                    (None, None)
                }
            };

            let _ = on_output.send(TerminalFrame::Exit { code, signal });
            let _ = on_output.send(TerminalFrame::Closed);

            if let Ok(mut sessions) = sessions.lock() {
                if let Some(session) = sessions.get(&session_id) {
                    if session.generation == generation {
                        sessions.remove(&session_id);
                    }
                }
            }
        });
    }
}
