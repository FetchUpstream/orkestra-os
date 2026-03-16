use crate::app::state::AppState;
use crate::app::terminal::service::{OpenRunTerminalResponse, TerminalFrame};
use crate::app::{commands::context, commands::error_mapping::map_result};
use tauri::ipc::Channel;

#[tauri::command(rename_all = "camelCase")]
pub async fn open_run_terminal(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    run_id: String,
    route_instance_id: String,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalFrame>,
) -> Result<OpenRunTerminalResponse, String> {
    let service = context::terminal_service(&state);
    map_result(
        service
            .open_run_terminal(
                window.label(),
                &run_id,
                &route_instance_id,
                cols,
                rows,
                on_output,
            )
            .await,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_run_terminal(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    session_id: String,
    generation: u64,
    data: String,
) -> Result<(), String> {
    let service = context::terminal_service(&state);
    map_result(service.write_run_terminal(window.label(), &session_id, generation, &data))
}

#[tauri::command(rename_all = "camelCase")]
pub fn resize_run_terminal(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    session_id: String,
    generation: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let service = context::terminal_service(&state);
    map_result(service.resize_run_terminal(
        window.label(),
        &session_id,
        generation,
        cols,
        rows,
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub fn kill_run_terminal(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    session_id: String,
    generation: u64,
) -> Result<(), String> {
    let service = context::terminal_service(&state);
    map_result(service.kill_run_terminal(window.label(), &session_id, generation))
}
