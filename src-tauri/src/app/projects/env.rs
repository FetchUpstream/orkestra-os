use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectEnvVar {
    pub key: String,
    pub value: String,
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
    use super::{normalize_project_env_vars, project_env_var_map, ProjectEnvVar};

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
