pub mod commands;
pub mod db;
pub mod errors;
pub mod projects;
pub mod state;
pub mod tasks;

use state::AppState;

pub fn build_state() -> AppState {
    AppState::new_placeholder()
}
