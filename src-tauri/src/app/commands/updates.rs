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

use crate::app::commands::error_mapping::map_app_error;
use crate::app::errors::AppError;
use reqwest::{Client, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_VERSION: &str = "2022-11-28";
const UPDATER_LATEST_MANIFEST_NAME: &str = "latest.json";

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum TauriAppUpdateCheckResult {
    UpdateAvailable(TauriAppUpdateAvailableResult),
    UpToDate(TauriAppUpToDateResult),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriAppUpdateAvailableResult {
    pub current_version: String,
    pub available_version: String,
    pub manifest_url: String,
    pub released_at: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriAppUpToDateResult {
    pub current_version: String,
    pub available_version: String,
    pub released_at: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAssetSummary {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseSummary {
    tag_name: String,
    draft: bool,
    #[allow(dead_code)]
    prerelease: bool,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAssetSummary>,
}

#[derive(Debug)]
struct SelectedGitHubRelease {
    tag_name: String,
    version: Version,
    body: Option<String>,
    published_at: Option<String>,
}

#[tauri::command]
pub async fn check_tauri_app_update(
    app: AppHandle,
) -> Result<TauriAppUpdateCheckResult, String> {
    check_tauri_app_update_inner(app).await.map_err(map_app_error)
}

#[tauri::command]
pub async fn install_tauri_app_update(
    app: AppHandle,
    manifest_url: String,
) -> Result<(), String> {
    install_tauri_app_update_inner(app, manifest_url)
        .await
        .map_err(map_app_error)
}

async fn check_tauri_app_update_inner(
    app: AppHandle,
) -> Result<TauriAppUpdateCheckResult, AppError> {
    let current_version = app.package_info().version.clone();
    let selected_release = select_latest_release(&current_version, &fetch_github_releases().await?)
        .unwrap_or_else(|| SelectedGitHubRelease {
            tag_name: String::new(),
            version: current_version.clone(),
            body: None,
            published_at: None,
        });

    if selected_release.version <= current_version || selected_release.tag_name.is_empty() {
        return Ok(TauriAppUpdateCheckResult::UpToDate(
            TauriAppUpToDateResult {
                current_version: current_version.to_string(),
                available_version: selected_release.version.to_string(),
                released_at: selected_release.published_at,
                notes: split_release_notes(selected_release.body.as_deref()),
            },
        ));
    }

    let manifest_url = build_release_manifest_url(&selected_release.tag_name)?;
    let updater = build_channel_updater(&app, manifest_url.clone())?;
    let update = updater.check().await.map_err(|error| {
        AppError::infrastructure_with_source(
            "updates",
            "tauri_updater_check_failed",
            "Unable to check for an in-app update right now.",
            error,
        )
    })?;

    if let Some(update) = update {
        return Ok(TauriAppUpdateCheckResult::UpdateAvailable(
            TauriAppUpdateAvailableResult {
                current_version: update.current_version,
                available_version: update.version,
                manifest_url: manifest_url.to_string(),
                released_at: selected_release.published_at,
                notes: split_release_notes(selected_release.body.as_deref()),
            },
        ));
    }

    Ok(TauriAppUpdateCheckResult::UpToDate(
        TauriAppUpToDateResult {
            current_version: current_version.to_string(),
            available_version: selected_release.version.to_string(),
            released_at: selected_release.published_at,
            notes: split_release_notes(selected_release.body.as_deref()),
        },
    ))
}

async fn install_tauri_app_update_inner(
    app: AppHandle,
    manifest_url: String,
) -> Result<(), AppError> {
    let manifest_url = parse_and_validate_manifest_url(&manifest_url)?;
    let updater = build_channel_updater(&app, manifest_url)?;
    let update = updater.check().await.map_err(|error| {
        AppError::infrastructure_with_source(
            "updates",
            "tauri_updater_install_check_failed",
            "Unable to verify the selected app update.",
            error,
        )
    })?;
    let Some(update) = update else {
        return Err(AppError::validation(
            "No in-app update is currently available for this build.",
        ));
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| {
            AppError::infrastructure_with_source(
                "updates",
                "tauri_updater_download_install_failed",
                "Unable to download and install the app update.",
                error,
            )
        })
}

fn build_channel_updater(
    app: &AppHandle,
    manifest_url: Url,
) -> Result<tauri_plugin_updater::Updater, AppError> {
    app.updater_builder()
        .endpoints(vec![manifest_url])
        .map_err(|error| {
            AppError::infrastructure_with_source(
                "updates",
                "tauri_updater_endpoint_config_failed",
                "Unable to prepare the updater endpoint configuration.",
                error,
            )
        })?
        .build()
        .map_err(|error| {
            AppError::infrastructure_with_source(
                "updates",
                "tauri_updater_build_failed",
                "Unable to initialize the in-app updater.",
                error,
            )
        })
}

async fn fetch_github_releases() -> Result<Vec<GitHubReleaseSummary>, AppError> {
    let api_url = github_releases_api_url()?;
    let response = Client::new()
        .get(api_url.as_str())
        .header("accept", GITHUB_API_ACCEPT)
        .header("x-github-api-version", GITHUB_API_VERSION)
        .send()
        .await
        .map_err(|error| {
            AppError::infrastructure_with_source(
                "updates",
                "github_release_list_request_failed",
                "Unable to reach the release feed for app updates.",
                error,
            )
        })?;

    if !response.status().is_success() {
        return Err(AppError::infrastructure(
            "updates",
            "github_release_list_status_invalid",
            format!(
                "Release feed request failed with status {}.",
                response.status()
            ),
        ));
    }

    response.json().await.map_err(|error| {
        AppError::infrastructure_with_source(
            "updates",
            "github_release_list_parse_failed",
            "Unable to parse the release feed for app updates.",
            error,
        )
    })
}

fn github_releases_api_url() -> Result<String, AppError> {
    let (owner, repo) = github_repository_parts()?;
    Ok(format!(
        "https://api.github.com/repos/{owner}/{repo}/releases?per_page=100"
    ))
}

fn build_release_manifest_url(tag_name: &str) -> Result<Url, AppError> {
    let (owner, repo) = github_repository_parts()?;
    Url::parse(&format!(
        "https://github.com/{owner}/{repo}/releases/download/{tag_name}/{UPDATER_LATEST_MANIFEST_NAME}"
    ))
    .map_err(|error| {
        AppError::infrastructure_with_source(
            "updates",
            "manifest_url_build_failed",
            "Unable to construct the app update manifest URL.",
            error,
        )
    })
}

fn parse_and_validate_manifest_url(value: &str) -> Result<Url, AppError> {
    let manifest_url = Url::parse(value.trim()).map_err(|_| {
        AppError::validation("The selected app update manifest URL is invalid.")
    })?;

    let (owner, repo) = github_repository_parts()?;
    let expected_prefix = format!("/{owner}/{repo}/releases/download/");
    let is_valid = manifest_url.scheme() == "https"
        && manifest_url.host_str() == Some("github.com")
        && manifest_url.path().starts_with(expected_prefix.as_str())
        && manifest_url.path().ends_with("/latest.json");
    if !is_valid {
        return Err(AppError::validation(
            "The selected app update manifest URL is not allowed.",
        ));
    }

    Ok(manifest_url)
}

fn github_repository_parts() -> Result<(&'static str, &'static str), AppError> {
    let repo_url = env!("CARGO_PKG_REPOSITORY");
    let path = repo_url
        .trim_end_matches('/')
        .split("github.com/")
        .nth(1)
        .ok_or_else(|| {
            AppError::infrastructure(
                "updates",
                "repository_slug_missing",
                "Unable to determine the GitHub repository for updater checks.",
            )
        })?;
    let mut segments = path.split('/');
    let owner = segments.next().filter(|segment| !segment.is_empty());
    let repo = segments.next().filter(|segment| !segment.is_empty());

    match (owner, repo) {
        (Some(owner), Some(repo)) => Ok((owner, repo)),
        _ => Err(AppError::infrastructure(
            "updates",
            "repository_slug_invalid",
            "Unable to parse the GitHub repository for updater checks.",
        )),
    }
}

fn select_latest_release(
    current_version: &Version,
    releases: &[GitHubReleaseSummary],
) -> Option<SelectedGitHubRelease> {
    let include_prereleases = !current_version.pre.is_empty();

    releases
        .iter()
        .filter(|release| !release.draft)
        .filter(|release| release.assets.iter().any(|asset| asset.name == UPDATER_LATEST_MANIFEST_NAME))
        .filter_map(|release| {
            let version = parse_release_version(&release.tag_name)?;
            if !include_prereleases && !version.pre.is_empty() {
                return None;
            }

            Some(SelectedGitHubRelease {
                tag_name: release.tag_name.clone(),
                version,
                body: release.body.clone(),
                published_at: release.published_at.clone(),
            })
        })
        .max_by(|left, right| left.version.cmp(&right.version))
}

fn parse_release_version(tag_name: &str) -> Option<Version> {
    let normalized = tag_name.trim().trim_start_matches('v').trim_start_matches('V');
    Version::parse(normalized).ok()
}

fn split_release_notes(body: Option<&str>) -> Vec<String> {
    body.unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.strip_prefix("- ")
                .or_else(|| line.strip_prefix("* "))
                .unwrap_or(line)
                .trim()
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{parse_release_version, select_latest_release, GitHubReleaseAssetSummary, GitHubReleaseSummary};
    use semver::Version;

    fn release(tag_name: &str, draft: bool, prerelease: bool) -> GitHubReleaseSummary {
        GitHubReleaseSummary {
            tag_name: tag_name.to_string(),
            draft,
            prerelease,
            body: Some(format!("Notes for {tag_name}")),
            published_at: Some("2026-04-17T12:00:00Z".to_string()),
            assets: vec![GitHubReleaseAssetSummary {
                name: "latest.json".to_string(),
            }],
        }
    }

    #[test]
    fn parses_semver_from_v_prefixed_tags() {
        let version = parse_release_version("v0.0.2-RC.1").expect("expected semver");
        assert_eq!(version, Version::parse("0.0.2-RC.1").unwrap());
    }

    #[test]
    fn stable_clients_ignore_prereleases() {
        let current = Version::parse("0.0.2").unwrap();
        let selected = select_latest_release(
            &current,
            &[
                release("v0.0.3-RC.1", false, true),
                release("v0.0.2", false, false),
            ],
        )
        .expect("expected stable release");

        assert_eq!(selected.tag_name, "v0.0.2");
    }

    #[test]
    fn prerelease_clients_can_see_newer_prereleases() {
        let current = Version::parse("0.0.2-RC.1").unwrap();
        let selected = select_latest_release(
            &current,
            &[
                release("v0.0.2-RC.2", false, true),
                release("v0.0.2", false, false),
            ],
        )
        .expect("expected release");

        assert_eq!(selected.tag_name, "v0.0.2");
    }

    #[test]
    fn skips_drafts_and_releases_without_latest_manifest() {
        let current = Version::parse("0.0.2-RC.1").unwrap();
        let mut missing_manifest = release("v0.0.2-RC.2", false, true);
        missing_manifest.assets.clear();
        let selected = select_latest_release(
            &current,
            &[
                release("v0.0.3-RC.1", true, true),
                missing_manifest,
                release("v0.0.2-RC.1", false, true),
            ],
        )
        .expect("expected release with manifest");

        assert_eq!(selected.tag_name, "v0.0.2-RC.1");
    }
}
