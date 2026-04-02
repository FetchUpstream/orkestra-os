// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

use super::app_error::UserSafeTelemetryClass;
use super::AppError;
use sentry::Level;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const USER_SAFE_CAPTURE_SAMPLE_RATE_PERCENT: u8 = 35;
const USER_SAFE_DEDUPE_WINDOW: Duration = Duration::from_secs(300);
const USER_SAFE_DEDUPE_MIN_INTERVAL: Duration = Duration::from_secs(30);
const USER_SAFE_DEDUPE_MAX_PER_WINDOW: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DedupeEntry {
    window_start_ms: u64,
    last_captured_ms: u64,
    captures_in_window: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum HandledCapturePayload {
    RawError,
    SanitizedMessage(String),
}

static USER_SAFE_CAPTURE_DEDUPE_STATE: OnceLock<Mutex<HashMap<String, DedupeEntry>>> =
    OnceLock::new();
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandledCapturePolicy {
    pub should_capture: bool,
    pub user_safe_class: Option<UserSafeTelemetryClass>,
    pub subsystem: Option<&'static str>,
    pub code: Option<&'static str>,
}

pub fn should_capture_handled_error(error: &AppError) -> bool {
    handled_capture_policy(error).should_capture
}

pub fn handled_capture_policy(error: &AppError) -> HandledCapturePolicy {
    handled_capture_policy_with_sample_rate(error, USER_SAFE_CAPTURE_SAMPLE_RATE_PERCENT)
}

pub fn capture_handled_error(error: &AppError) {
    let policy = handled_capture_policy(error);
    if !policy.should_capture {
        return;
    }

    let fingerprint_parts = build_fingerprint(error, &policy);

    if policy.user_safe_class.is_some() {
        let key = fingerprint_parts.join("|");
        if !allow_user_safe_capture_with_dedupe(
            &key,
            USER_SAFE_DEDUPE_WINDOW.as_millis() as u64,
            USER_SAFE_DEDUPE_MIN_INTERVAL.as_millis() as u64,
            USER_SAFE_DEDUPE_MAX_PER_WINDOW,
        ) {
            return;
        }
    }

    let capture_payload = handled_capture_payload(error, &policy);

    sentry::with_scope(
        |scope| {
            scope.set_tag("handled", "true");
            scope.set_tag("error.category", error.category());

            if let Some(class) = policy.user_safe_class {
                scope.set_tag("error.class", class.as_str());
            }

            if let Some(subsystem) = policy.subsystem {
                scope.set_tag("error.subsystem", subsystem);
            }

            if let Some(code) = policy.code {
                scope.set_tag("error.code", code);
            }

            let fingerprint_refs: Vec<&str> =
                fingerprint_parts.iter().map(String::as_str).collect();
            scope.set_fingerprint(Some(&fingerprint_refs));
        },
        || match &capture_payload {
            HandledCapturePayload::RawError => {
                sentry::capture_error(error);
            }
            HandledCapturePayload::SanitizedMessage(message) => {
                sentry::capture_message(message, Level::Warning);
            }
        },
    );
}

fn handled_capture_policy_with_sample_rate(
    error: &AppError,
    sample_rate_percent: u8,
) -> HandledCapturePolicy {
    let user_safe_class = error.user_safe_telemetry_class();

    if !error.is_user_safe() {
        return HandledCapturePolicy {
            should_capture: true,
            user_safe_class,
            subsystem: error.subsystem(),
            code: error.code(),
        };
    }

    let Some(class) = user_safe_class else {
        return HandledCapturePolicy {
            should_capture: false,
            user_safe_class: None,
            subsystem: None,
            code: None,
        };
    };

    let subsystem = Some(class.subsystem());
    let code = Some(class.code());
    let should_capture = should_sampled_capture(class, subsystem, code, sample_rate_percent);

    HandledCapturePolicy {
        should_capture,
        user_safe_class: Some(class),
        subsystem,
        code,
    }
}

fn should_sampled_capture(
    class: UserSafeTelemetryClass,
    subsystem: Option<&'static str>,
    code: Option<&'static str>,
    sample_rate_percent: u8,
) -> bool {
    let bounded_rate = sample_rate_percent.min(100);
    if bounded_rate == 0 {
        return false;
    }
    if bounded_rate == 100 {
        return true;
    }

    let mut sampling_key = String::from(class.as_str());
    sampling_key.push('|');
    sampling_key.push_str(subsystem.unwrap_or("unknown_subsystem"));
    sampling_key.push('|');
    sampling_key.push_str(code.unwrap_or("unknown_code"));

    deterministic_percentile(&sampling_key) < u32::from(bounded_rate)
}

fn deterministic_percentile(input: &str) -> u32 {
    let mut hash: u32 = 0x811C9DC5;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash % 100
}

fn handled_capture_payload(
    error: &AppError,
    policy: &HandledCapturePolicy,
) -> HandledCapturePayload {
    if let Some(class) = policy.user_safe_class {
        let subsystem = policy.subsystem.unwrap_or("unknown_subsystem");
        let code = policy.code.unwrap_or("unknown_code");
        return HandledCapturePayload::SanitizedMessage(format!(
            "Handled user-safe error (class={}; subsystem={}; code={}; category={})",
            class.as_str(),
            subsystem,
            code,
            error.category()
        ));
    }

    HandledCapturePayload::RawError
}

fn allow_user_safe_capture_with_dedupe(
    fingerprint_key: &str,
    window_ms: u64,
    min_interval_ms: u64,
    max_per_window: u32,
) -> bool {
    let mut state = USER_SAFE_CAPTURE_DEDUPE_STATE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now_ms = now_ms_since_process_start();
    should_emit_with_rate_limit(
        &mut state,
        fingerprint_key,
        now_ms,
        window_ms,
        min_interval_ms,
        max_per_window,
    )
}

fn now_ms_since_process_start() -> u64 {
    let start = PROCESS_START.get_or_init(Instant::now);
    start.elapsed().as_millis() as u64
}

fn should_emit_with_rate_limit(
    dedupe_state: &mut HashMap<String, DedupeEntry>,
    fingerprint_key: &str,
    now_ms: u64,
    window_ms: u64,
    min_interval_ms: u64,
    max_per_window: u32,
) -> bool {
    let Some(existing) = dedupe_state.get_mut(fingerprint_key) else {
        dedupe_state.insert(
            fingerprint_key.to_string(),
            DedupeEntry {
                window_start_ms: now_ms,
                last_captured_ms: now_ms,
                captures_in_window: 1,
            },
        );
        return true;
    };

    if now_ms.saturating_sub(existing.last_captured_ms) < min_interval_ms {
        return false;
    }

    if now_ms.saturating_sub(existing.window_start_ms) >= window_ms {
        existing.window_start_ms = now_ms;
        existing.last_captured_ms = now_ms;
        existing.captures_in_window = 1;
        return true;
    }

    if existing.captures_in_window >= max_per_window {
        return false;
    }

    existing.last_captured_ms = now_ms;
    existing.captures_in_window += 1;
    true
}

fn build_fingerprint(error: &AppError, policy: &HandledCapturePolicy) -> Vec<String> {
    let mut fingerprint = vec!["handled".to_string(), error.category().to_string()];

    if let Some(class) = policy.user_safe_class {
        fingerprint.push(class.as_str().to_string());
    }
    if let Some(subsystem) = policy.subsystem {
        fingerprint.push(subsystem.to_string());
    }
    if let Some(code) = policy.code {
        fingerprint.push(code.to_string());
    }

    fingerprint
}

#[cfg(test)]
mod tests {
    use super::{
        deterministic_percentile, handled_capture_payload, handled_capture_policy_with_sample_rate,
        should_emit_with_rate_limit, DedupeEntry, HandledCapturePayload,
    };
    use crate::app::errors::AppError;
    use std::collections::HashMap;

    #[test]
    fn suppresses_non_allowlisted_user_safe_validation() {
        let err = AppError::validation("run_id is required");
        let policy = handled_capture_policy_with_sample_rate(&err, 100);
        assert!(!policy.should_capture);
    }

    #[test]
    fn captures_allowlisted_user_safe_class_when_sampling_allows() {
        let err = AppError::not_found("OpenCode run handle not found");
        let policy = handled_capture_policy_with_sample_rate(&err, 100);
        assert!(policy.should_capture);
        assert_eq!(policy.subsystem, Some("opencode.runtime"));
        assert_eq!(policy.code, Some("runtime_handle_not_found"));
    }

    #[test]
    fn captures_allowlisted_lifecycle_conflict_when_sampling_allows() {
        let err = AppError::conflict("OpenCode run runtime shutdown is in progress");
        let policy = handled_capture_policy_with_sample_rate(&err, 100);
        assert!(policy.should_capture);
        assert_eq!(policy.subsystem, Some("opencode.runtime"));
        assert_eq!(policy.code, Some("lifecycle_race_conflict"));
    }

    #[test]
    fn suppresses_routine_user_safe_conflict() {
        let err = AppError::conflict("project key already exists");
        let policy = handled_capture_policy_with_sample_rate(&err, 100);
        assert!(!policy.should_capture);
    }

    #[test]
    fn captures_non_user_safe_errors_without_sampling_gate() {
        let err = AppError::infrastructure("filesystem", "io_failure", "disk unavailable");
        let policy = handled_capture_policy_with_sample_rate(&err, 0);
        assert!(policy.should_capture);
        assert_eq!(policy.subsystem, Some("filesystem"));
        assert_eq!(policy.code, Some("io_failure"));
    }

    #[test]
    fn user_safe_sampling_is_deterministic() {
        let err = AppError::validation("failed to start rebase: lock failure");
        let policy_first = handled_capture_policy_with_sample_rate(&err, 35);
        let policy_second = handled_capture_policy_with_sample_rate(&err, 35);
        assert_eq!(policy_first.should_capture, policy_second.should_capture);
    }

    #[test]
    fn deterministic_percentile_stays_within_expected_range() {
        let percentile = deterministic_percentile(
            "opencode_runtime_not_found|opencode.runtime|runtime_handle_not_found",
        );
        assert!(percentile < 100);
    }

    #[test]
    fn user_safe_capture_payload_is_sanitized_for_allowlisted_errors() {
        let err = AppError::validation(
            "project default repository path is invalid or stale: /home/louis/private/repo (missing)",
        );
        let policy = handled_capture_policy_with_sample_rate(&err, 100);

        let payload = handled_capture_payload(&err, &policy);
        match payload {
            HandledCapturePayload::SanitizedMessage(message) => {
                assert!(message.contains("opencode_project_repo_config_drift"));
                assert!(!message.contains("/home/louis/private/repo"));
            }
            HandledCapturePayload::RawError => panic!("expected sanitized payload"),
        }
    }

    #[test]
    fn non_user_safe_capture_payload_uses_raw_error() {
        let err = AppError::infrastructure("filesystem", "io_failure", "disk unavailable");
        let policy = handled_capture_policy_with_sample_rate(&err, 100);

        assert_eq!(
            handled_capture_payload(&err, &policy),
            HandledCapturePayload::RawError
        );
    }

    #[test]
    fn rate_limit_suppresses_immediate_duplicates_and_caps_window() {
        let mut state: HashMap<String, DedupeEntry> = HashMap::new();
        let key = "handled|validation|opencode_runtime_not_found|opencode.runtime|runtime_handle_not_found";

        assert!(should_emit_with_rate_limit(
            &mut state, key, 0, 300_000, 30_000, 3
        ));
        assert!(!should_emit_with_rate_limit(
            &mut state, key, 10_000, 300_000, 30_000, 3
        ));
        assert!(should_emit_with_rate_limit(
            &mut state, key, 31_000, 300_000, 30_000, 3
        ));
        assert!(should_emit_with_rate_limit(
            &mut state, key, 61_000, 300_000, 30_000, 3
        ));
        assert!(!should_emit_with_rate_limit(
            &mut state, key, 91_000, 300_000, 30_000, 3
        ));
    }

    #[test]
    fn rate_limit_resets_after_window_rollover() {
        let mut state: HashMap<String, DedupeEntry> = HashMap::new();
        let key = "handled|conflict|opencode_lifecycle_race_conflict|opencode.runtime|lifecycle_race_conflict";

        assert!(should_emit_with_rate_limit(
            &mut state, key, 0, 300_000, 30_000, 1
        ));
        assert!(!should_emit_with_rate_limit(
            &mut state, key, 40_000, 300_000, 30_000, 1
        ));
        assert!(should_emit_with_rate_limit(
            &mut state, key, 301_000, 300_000, 30_000, 1
        ));
    }
}
