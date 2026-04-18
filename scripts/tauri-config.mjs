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

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const BASE_CONFIG_PATH = path.join("src-tauri", "tauri.conf.json");
const VERSION_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_MSI_BUILD = 65535;

export async function loadBaseTauriConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, BASE_CONFIG_PATH);
  const configText = await readFile(configPath, "utf8");

  return JSON.parse(configText);
}

function deriveWindowsWixVersion(version) {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(VERSION_PATTERN);
  if (!match?.groups) {
    throw new Error(
      `Unsupported Tauri app version \"${version}\". Expected semver like 1.2.3 or 1.2.3-rc.4.`,
    );
  }

  const { major, minor, patch, prerelease } = match.groups;
  if (!prerelease) {
    return null;
  }

  const prereleaseParts = prerelease.split(".");
  const buildIdentifier = prereleaseParts.at(-1);
  if (!buildIdentifier || !/^\d+$/.test(buildIdentifier)) {
    throw new Error(
      `Windows MSI requires a numeric prerelease suffix. Update \"${version}\" to end with .<number> (for example 1.2.3-rc.4).`,
    );
  }

  const buildNumber = Number(buildIdentifier);
  if (buildNumber > MAX_MSI_BUILD) {
    throw new Error(
      `Windows MSI prerelease build number must be <= ${MAX_MSI_BUILD}, received ${buildNumber} from \"${version}\".`,
    );
  }

  return `${major}.${minor}.${patch}.${buildNumber}`;
}

export function buildTauriConfigForWindowsMsi(baseConfig) {
  const config = structuredClone(baseConfig);
  const resolvedVersion =
    typeof config.version === "string"
      ? deriveWindowsWixVersion(config.version)
      : null;

  if (!resolvedVersion) {
    return config;
  }

  config.bundle ??= {};
  config.bundle.windows ??= {};
  config.bundle.windows.wix ??= {};
  config.bundle.windows.wix.version = resolvedVersion;

  return config;
}

export async function writeWindowsBuildConfig(
  outPath,
  projectRoot = process.cwd(),
) {
  const baseConfig = await loadBaseTauriConfig(projectRoot);
  const config = buildTauriConfigForWindowsMsi(baseConfig);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(config, null, 2));

  return outPath;
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    throw new Error("Expected an output path argument.");
  }

  const resolvedPath = path.resolve(outPath);
  await writeWindowsBuildConfig(resolvedPath);
  console.log(resolvedPath);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[tauri-config]", error);
    process.exit(1);
  });
}
