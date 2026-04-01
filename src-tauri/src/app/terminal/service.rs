use crate::app::errors::AppError;
use crate::app::runs::dto::RunDto;
use crate::app::runs::service::RunsService;
use crate::app::terminal::error::TerminalServiceError;
use crate::app::worktrees::pathing::resolve_worktree_path_typed;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tracing::{info, warn};

const TERMINAL_ENV_KEYS: [&str; 7] = ["SHELL", "HOME", "PATH", "TERM", "COLORTERM", "LANG", "USER"];
const DEFAULT_TERM: &str = "xterm-256color";
const DEFAULT_COLORTERM: &str = "truecolor";
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DEFAULT_LANG: &str = "C.UTF-8";

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

        info!(
            subsystem = "terminal",
            operation = "open",
            run_id = run_id,
            owner_label = owner_label,
            cols = cols,
            rows = rows,
            "Opening run terminal"
        );

        let size = Self::validate_size(cols, rows)?;
        let run = self.runs_service.get_run(run_id).await.map_err(|source| {
            TerminalServiceError::ResolveRun {
                run_id: run_id.to_string(),
                source,
            }
        })?;
        let cwd = self.resolve_worktree_path_typed(&run)?;
        let shell = Self::resolve_shell();
        let shell_args = Self::resolve_shell_args(&shell);
        let inherited_env = Self::capture_terminal_env();
        let child_env = Self::build_terminal_env(&shell, &inherited_env);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|source| TerminalServiceError::OpenPty { source })?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(&shell_args);
        cmd.cwd(cwd.clone());
        for (key, value) in &child_env {
            cmd.env(key, value);
        }

        info!(
            subsystem = "terminal",
            operation = "open",
            run_id = run_id,
            shell = shell.as_str(),
            shell_args = ?shell_args,
            cwd = %cwd.display(),
            inherited_env = ?inherited_env,
            child_env = ?child_env,
            controlling_tty = cmd.get_controlling_tty(),
            "Resolved terminal shell startup"
        );

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

        info!(
            subsystem = "terminal",
            operation = "open",
            run_id = run_id,
            session_id = session_id.as_str(),
            generation = generation,
            "Opened run terminal"
        );

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
        info!(
            subsystem = "terminal",
            operation = "write",
            session_id = session_id,
            generation = generation,
            byte_len = data.len(),
            "Writing terminal input"
        );
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
        info!(
            subsystem = "terminal",
            operation = "resize",
            session_id = session_id,
            generation = generation,
            cols = cols,
            rows = rows,
            "Resizing terminal"
        );
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
        info!(
            subsystem = "terminal",
            operation = "kill",
            session_id = session_id,
            generation = generation,
            "Killing terminal session"
        );
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
        info!(
            subsystem = "terminal",
            operation = "kill",
            session_id = session_id,
            generation = generation,
            "Killed terminal session"
        );
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

    fn resolve_shell_args(shell: &str) -> Vec<&'static str> {
        if Self::is_bash_shell(shell) {
            return vec!["-i"];
        }

        Vec::new()
    }

    fn is_bash_shell(shell: &str) -> bool {
        std::path::Path::new(shell)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq("bash"))
            .unwrap_or(false)
    }

    fn capture_terminal_env() -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();

        for key in TERMINAL_ENV_KEYS {
            if let Some(value) = Self::read_env_var(key) {
                env.insert(key.to_string(), value);
            }
        }

        if !env.contains_key("USER") {
            if let Some(value) = Self::read_env_var("LOGNAME") {
                env.insert("USER".to_string(), value);
            }
        }

        env
    }

    fn build_terminal_env(
        shell: &str,
        inherited_env: &BTreeMap<String, String>,
    ) -> BTreeMap<String, String> {
        let mut env = inherited_env.clone();

        env.insert("SHELL".to_string(), shell.to_string());
        env.insert("TERM".to_string(), DEFAULT_TERM.to_string());
        Self::ensure_env_value(&mut env, "COLORTERM", DEFAULT_COLORTERM);
        Self::ensure_env_value(&mut env, "PATH", DEFAULT_PATH);
        Self::ensure_env_value(&mut env, "LANG", DEFAULT_LANG);

        env
    }

    fn ensure_env_value(env: &mut BTreeMap<String, String>, key: &str, default: &str) {
        let needs_default = env
            .get(key)
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);

        if needs_default {
            env.insert(key.to_string(), default.to_string());
        }
    }

    fn read_env_var(key: &str) -> Option<String> {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
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
                        warn!(
                            subsystem = "terminal",
                            operation = "reader",
                            session_id = session_id.as_str(),
                            generation = generation,
                            error = %err,
                            "Terminal read failed"
                        );
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
                        warn!(
                            subsystem = "terminal",
                            operation = "wait",
                            session_id = session_id.as_str(),
                            generation = generation,
                            error = %err,
                            "Terminal wait failed"
                        );
                        let _ = on_output.send(TerminalFrame::Error {
                            message: format!("terminal wait failed: {err}"),
                        });
                        (None, None)
                    }
                },
                Err(_) => {
                    warn!(
                        subsystem = "terminal",
                        operation = "wait",
                        session_id = session_id.as_str(),
                        generation = generation,
                        "Failed to lock terminal process handle"
                    );
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

#[cfg(test)]
mod tests {
    use super::{
        TerminalService, DEFAULT_COLORTERM, DEFAULT_LANG, DEFAULT_PATH, DEFAULT_TERM,
    };
    use std::collections::BTreeMap;

    #[test]
    fn bash_shell_uses_explicit_interactive_mode() {
        assert_eq!(TerminalService::resolve_shell_args("/bin/bash"), vec!["-i"]);
        assert_eq!(TerminalService::resolve_shell_args("bash"), vec!["-i"]);
    }

    #[test]
    fn non_bash_shell_keeps_default_args() {
        assert!(TerminalService::resolve_shell_args("/bin/zsh").is_empty());
    }

    #[test]
    fn terminal_env_normalizes_terminal_capabilities() {
        let inherited = BTreeMap::from([
            ("HOME".to_string(), "/home/louis".to_string()),
            ("PATH".to_string(), "/custom/bin".to_string()),
            ("TERM".to_string(), "dumb".to_string()),
        ]);

        let env = TerminalService::build_terminal_env("/bin/bash", &inherited);

        assert_eq!(env.get("SHELL"), Some(&"/bin/bash".to_string()));
        assert_eq!(env.get("TERM"), Some(&DEFAULT_TERM.to_string()));
        assert_eq!(env.get("COLORTERM"), Some(&DEFAULT_COLORTERM.to_string()));
        assert_eq!(env.get("PATH"), Some(&"/custom/bin".to_string()));
        assert_eq!(env.get("HOME"), Some(&"/home/louis".to_string()));
    }

    #[test]
    fn terminal_env_fills_missing_core_values() {
        let env = TerminalService::build_terminal_env("/bin/bash", &BTreeMap::new());

        assert_eq!(env.get("SHELL"), Some(&"/bin/bash".to_string()));
        assert_eq!(env.get("TERM"), Some(&DEFAULT_TERM.to_string()));
        assert_eq!(env.get("COLORTERM"), Some(&DEFAULT_COLORTERM.to_string()));
        assert_eq!(env.get("PATH"), Some(&DEFAULT_PATH.to_string()));
        assert_eq!(env.get("LANG"), Some(&DEFAULT_LANG.to_string()));
    }
}
