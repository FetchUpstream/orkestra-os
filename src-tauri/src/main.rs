// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _ = fix_path_env::fix();
    let _sentry_guard = sentry::init(sentry::ClientOptions {
        dsn: Some(
            "https://c29687522ed5834f352498b551610f69@o4511093307015168.ingest.de.sentry.io/4511093427273808"
                .parse()
                .expect("Invalid Sentry DSN"),
        ),
        release: sentry::release_name!(),
        environment: std::env::var("SENTRY_ENVIRONMENT").ok().map(Into::into),
        auto_session_tracking: true,
        session_mode: sentry::SessionMode::Application,
        ..Default::default()
    });
    orkestraos_lib::run()
}
