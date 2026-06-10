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

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectEnvVar {
    pub key: String,
    pub value: String,
}

pub const DEFAULT_RUNTIME_PATH: &str =
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
pub const DEFAULT_RUNTIME_TERM: &str = "xterm-256color";
pub const DEFAULT_RUNTIME_COLORTERM: &str = "truecolor";
pub const DEFAULT_RUNTIME_LANG: &str = "C.UTF-8";

const RESERVED_PROJECT_ENV_VAR_KEYS: [&str; 14] = [
    "PATH",
    "SHELL",
    "HOME",
    "TERM",
    "COLORTERM",
    "LANG",
    "USER",
    "PWD",
    "OLDPWD",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
];

pub fn is_reserved_project_env_var_key(key: &str) -> bool {
    RESERVED_PROJECT_ENV_VAR_KEYS
        .iter()
        .any(|reserved_key| reserved_key.eq_ignore_ascii_case(key))
}

pub fn reserved_project_env_var_error() -> &'static str {
    "environment variable keys PATH, SHELL, HOME, TERM, COLORTERM, LANG, USER, PWD, OLDPWD, TMPDIR, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_DATA_HOME, and XDG_CACHE_HOME are managed by Orkestra and cannot be configured as project environment variables"
}

pub fn apply_safe_project_env_to_btree(
    env: &mut BTreeMap<String, String>,
    project_env: &HashMap<String, String>,
) {
    for (key, value) in project_env {
        if !is_reserved_project_env_var_key(key) {
            env.insert(key.clone(), value.clone());
        }
    }
}

pub fn build_safe_process_env(project_env: &HashMap<String, String>) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();

    ensure_hash_env_value(&mut env, "PATH", DEFAULT_RUNTIME_PATH);
    ensure_hash_env_value(&mut env, "TERM", DEFAULT_RUNTIME_TERM);
    ensure_hash_env_value(&mut env, "COLORTERM", DEFAULT_RUNTIME_COLORTERM);
    ensure_hash_env_value(&mut env, "LANG", DEFAULT_RUNTIME_LANG);

    for (key, value) in project_env {
        if !is_reserved_project_env_var_key(key) {
            env.insert(key.clone(), value.clone());
        }
    }

    env
}

fn ensure_hash_env_value(env: &mut HashMap<String, String>, key: &str, default: &str) {
    let matching_keys = find_existing_env_keys_case_insensitive(env, key);

    if matching_keys.is_empty() {
        env.insert(key.to_string(), default.to_string());
        return;
    }

    if matching_keys.iter().any(|existing_key| {
        env.get(existing_key)
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        return;
    }

    let target_key = matching_keys
        .iter()
        .find(|existing_key| existing_key.as_str() == key)
        .unwrap_or(&matching_keys[0])
        .clone();
    env.insert(target_key, default.to_string());
}

fn find_existing_env_keys_case_insensitive(
    env: &HashMap<String, String>,
    key: &str,
) -> Vec<String> {
    env.keys()
        .filter(|existing_key| existing_key.eq_ignore_ascii_case(key))
        .cloned()
        .collect()
}

pub fn normalize_project_env_vars(
    entries: Option<&[ProjectEnvVar]>,
) -> Result<Vec<ProjectEnvVar>, &'static str> {
    let mut normalized = Vec::new();

    for entry in entries.unwrap_or_default() {
        let key = entry.key.trim();
        let value_is_empty = entry.value.trim().is_empty();

        if key.is_empty() && value_is_empty {
            continue;
        }

        if key.is_empty() {
            return Err("environment variable keys are required");
        }

        if !is_valid_env_var_key(key) {
            return Err(
                "environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores",
            );
        }

        if is_reserved_project_env_var_key(key) {
            return Err(reserved_project_env_var_error());
        }

        normalized.push(ProjectEnvVar {
            key: key.to_string(),
            value: entry.value.clone(),
        });
    }

    Ok(normalized)
}

pub fn project_env_var_map(
    entries: Option<&[ProjectEnvVar]>,
) -> Result<HashMap<String, String>, &'static str> {
    Ok(normalize_project_env_vars(entries)?
        .into_iter()
        .map(|entry| (entry.key, entry.value))
        .collect())
}

pub fn runtime_project_env_var_map(
    entries: Option<&[ProjectEnvVar]>,
) -> Result<HashMap<String, String>, &'static str> {
    let mut env = HashMap::new();

    for entry in entries.unwrap_or_default() {
        let key = entry.key.trim();
        let value_is_empty = entry.value.trim().is_empty();

        if key.is_empty() && value_is_empty {
            continue;
        }

        if key.is_empty() {
            return Err("environment variable keys are required");
        }

        if !is_valid_env_var_key(key) {
            return Err(
                "environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores",
            );
        }

        env.insert(key.to_string(), entry.value.clone());
    }

    Ok(env)
}

fn is_valid_env_var_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }

    chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_safe_project_env_to_btree, build_safe_process_env, ensure_hash_env_value,
        normalize_project_env_vars, project_env_var_map, runtime_project_env_var_map,
        ProjectEnvVar, DEFAULT_RUNTIME_LANG, DEFAULT_RUNTIME_PATH, DEFAULT_RUNTIME_TERM,
    };
    use std::collections::{BTreeMap, HashMap};

    #[test]
    fn normalization_drops_fully_empty_rows_and_trims_keys() {
        let normalized = normalize_project_env_vars(Some(&[
            ProjectEnvVar {
                key: "  API_TOKEN  ".to_string(),
                value: "secret".to_string(),
            },
            ProjectEnvVar {
                key: "   ".to_string(),
                value: "   ".to_string(),
            },
        ]))
        .unwrap();

        assert_eq!(
            normalized,
            vec![ProjectEnvVar {
                key: "API_TOKEN".to_string(),
                value: "secret".to_string(),
            }]
        );
    }

    #[test]
    fn normalization_rejects_invalid_keys() {
        let err = normalize_project_env_vars(Some(&[ProjectEnvVar {
            key: "1INVALID".to_string(),
            value: "value".to_string(),
        }]))
        .unwrap_err();

        assert_eq!(
            err,
            "environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores"
        );
    }

    #[test]
    fn normalization_rejects_reserved_runtime_keys() {
        let err = normalize_project_env_vars(Some(&[ProjectEnvVar {
            key: "PATH".to_string(),
            value: "/bad/bin".to_string(),
        }]))
        .unwrap_err();

        assert!(err.contains("managed by Orkestra"));
    }

    #[test]
    fn safe_btree_overlay_skips_reserved_keys_and_keeps_normal_empty_values() {
        let mut env = BTreeMap::from([
            ("PATH".to_string(), "/base/bin".to_string()),
            ("SHELL".to_string(), "/bin/bash".to_string()),
        ]);
        let project = HashMap::from([
            ("API_TOKEN".to_string(), "secret".to_string()),
            ("EMPTY_OK".to_string(), "".to_string()),
            ("PATH".to_string(), "".to_string()),
            ("SHELL".to_string(), "".to_string()),
        ]);

        apply_safe_project_env_to_btree(&mut env, &project);

        assert_eq!(env.get("API_TOKEN"), Some(&"secret".to_string()));
        assert_eq!(env.get("EMPTY_OK"), Some(&"".to_string()));
        assert_eq!(env.get("PATH"), Some(&"/base/bin".to_string()));
        assert_eq!(env.get("SHELL"), Some(&"/bin/bash".to_string()));
    }

    #[test]
    fn safe_process_env_contains_base_values_and_skips_reserved_overrides() {
        let project = HashMap::from([
            ("API_TOKEN".to_string(), "secret".to_string()),
            ("PATH".to_string(), "/bad/bin".to_string()),
            ("TERM".to_string(), "".to_string()),
            ("LANG".to_string(), "".to_string()),
        ]);

        let env = build_safe_process_env(&project);

        assert_eq!(env.get("API_TOKEN"), Some(&"secret".to_string()));
        assert_ne!(env.get("PATH"), Some(&"/bad/bin".to_string()));
        assert_ne!(env.get("TERM"), Some(&"".to_string()));
        assert_ne!(env.get("LANG"), Some(&"".to_string()));
        assert!(env
            .get("PATH")
            .is_some_and(|value| !value.trim().is_empty()));
        assert!(env
            .get("TERM")
            .is_some_and(|value| !value.trim().is_empty()));
        assert!(env
            .get("LANG")
            .is_some_and(|value| !value.trim().is_empty()));

        let _ = (
            DEFAULT_RUNTIME_PATH,
            DEFAULT_RUNTIME_TERM,
            DEFAULT_RUNTIME_LANG,
        );
    }

    #[test]
    fn runtime_map_preserves_reserved_legacy_keys_for_safe_runtime_filtering() {
        let env = runtime_project_env_var_map(Some(&[
            ProjectEnvVar {
                key: "PATH".to_string(),
                value: "/legacy/bin".to_string(),
            },
            ProjectEnvVar {
                key: "  API_TOKEN  ".to_string(),
                value: "secret".to_string(),
            },
        ]))
        .unwrap();

        assert_eq!(env.get("PATH"), Some(&"/legacy/bin".to_string()));
        assert_eq!(env.get("API_TOKEN"), Some(&"secret".to_string()));
    }

    #[test]
    fn ensure_hash_env_value_preserves_existing_key_casing() {
        let mut env = HashMap::from([("Path".to_string(), "C:\\Windows\\System32".to_string())]);

        ensure_hash_env_value(&mut env, "PATH", DEFAULT_RUNTIME_PATH);

        assert_eq!(env.get("Path"), Some(&"C:\\Windows\\System32".to_string()));
        assert!(!env.contains_key("PATH"));
    }

    #[test]
    fn ensure_hash_env_value_fills_empty_existing_key_with_original_casing() {
        let mut env = HashMap::from([("Path".to_string(), "   ".to_string())]);

        ensure_hash_env_value(&mut env, "PATH", DEFAULT_RUNTIME_PATH);

        assert_eq!(env.get("Path"), Some(&DEFAULT_RUNTIME_PATH.to_string()));
        assert!(!env.contains_key("PATH"));
    }

    #[test]
    fn map_last_duplicate_key_wins_deterministically() {
        let env = project_env_var_map(Some(&[
            ProjectEnvVar {
                key: "API_TOKEN".to_string(),
                value: "old".to_string(),
            },
            ProjectEnvVar {
                key: "API_TOKEN".to_string(),
                value: "new".to_string(),
            },
        ]))
        .unwrap();

        assert_eq!(env.get("API_TOKEN"), Some(&"new".to_string()));
    }
}
