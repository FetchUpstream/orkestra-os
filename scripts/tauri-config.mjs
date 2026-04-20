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
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+(?<buildmetadata>[0-9A-Za-z.-]+))?$/;
const MAX_MSI_BUILD = 65535;
const SUPPORTED_BUILD_TARGETS = ["macos", "windows"];

export async function loadBaseTauriConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, BASE_CONFIG_PATH);
  const configText = await readFile(configPath, "utf8");

  return JSON.parse(configText);
}

function parseSemverVersion(version) {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(VERSION_PATTERN);
  if (!match?.groups) {
    throw new Error(
      `Unsupported Tauri app version "${version}". Expected semver like 1.2.3 or 1.2.3-rc.4.`,
    );
  }

  return {
    normalizedVersion,
    ...match.groups,
  };
}

function parsePositiveInteger(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function deriveWindowsWixVersion(version) {
  const { major, minor, patch, prerelease } = parseSemverVersion(version);
  if (!prerelease) {
    return null;
  }

  const prereleaseParts = prerelease.split(".");
  const buildIdentifier = prereleaseParts.at(-1);
  if (!buildIdentifier || !/^\d+$/.test(buildIdentifier)) {
    throw new Error(
      `Windows MSI requires a numeric prerelease suffix. Update "${version}" to end with .<number> (for example 1.2.3-rc.4).`,
    );
  }

  const buildNumber = Number(buildIdentifier);
  if (buildNumber > MAX_MSI_BUILD) {
    throw new Error(
      `Windows MSI prerelease build number must be <= ${MAX_MSI_BUILD}, received ${buildNumber} from "${version}".`,
    );
  }

  return `${major}.${minor}.${patch}.${buildNumber}`;
}

function deriveMacBundleShortVersion(version) {
  const { major, minor, patch } = parseSemverVersion(version);
  return `${major}.${minor}.${patch}`;
}

function deriveMacBundleVersion(version, options = {}) {
  const runNumber = parsePositiveInteger(options.runNumber);
  if (runNumber === null) {
    return deriveMacBundleShortVersion(version);
  }

  const runAttempt = parsePositiveInteger(options.runAttempt) ?? 1;
  return `${runNumber}.${runAttempt}`;
}

function createMacInfoPlistOverride(shortVersion) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${shortVersion}</string>
</dict>
</plist>
`;
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

export function buildTauriConfigForMacBundles(baseConfig, options = {}) {
  const config = structuredClone(baseConfig);
  if (typeof config.version !== "string") {
    return config;
  }

  config.bundle ??= {};
  config.bundle.macOS ??= {};
  config.bundle.macOS.bundleVersion = deriveMacBundleVersion(
    config.version,
    options,
  );

  if (options.infoPlistPath) {
    config.bundle.macOS.infoPlist = options.infoPlistPath;
  }

  return config;
}

export function buildTauriConfigForCi(baseConfig, platform, options = {}) {
  if (platform === "windows") {
    return buildTauriConfigForWindowsMsi(baseConfig);
  }

  if (platform === "macos") {
    return buildTauriConfigForMacBundles(baseConfig, options);
  }

  throw new Error(
    `Unsupported CI config platform "${platform}". Expected one of: ${SUPPORTED_BUILD_TARGETS.join(", ")}.`,
  );
}

export async function writeCiBuildConfig(
  outPath,
  platform,
  projectRoot = process.cwd(),
  options = {},
) {
  const baseConfig = await loadBaseTauriConfig(projectRoot);
  const resolvedOutPath = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOutPath), { recursive: true });

  let configOptions = options;
  if (
    platform === "macos" &&
    typeof baseConfig.version === "string" &&
    !options.infoPlistPath
  ) {
    const infoPlistPath = `${resolvedOutPath}.Info.plist`;
    await writeFile(
      infoPlistPath,
      createMacInfoPlistOverride(deriveMacBundleShortVersion(baseConfig.version)),
    );
    configOptions = {
      ...options,
      infoPlistPath,
    };
  }

  const config = buildTauriConfigForCi(baseConfig, platform, configOptions);
  await writeFile(resolvedOutPath, JSON.stringify(config, null, 2));

  return resolvedOutPath;
}

async function main() {
  const [platform, outPath] = process.argv.slice(2);
  if (!SUPPORTED_BUILD_TARGETS.includes(platform)) {
    throw new Error(
      `Expected a build target (${SUPPORTED_BUILD_TARGETS.join(" | ")}) as the first argument.`,
    );
  }

  if (!outPath) {
    throw new Error("Expected an output path argument.");
  }

  const resolvedPath = path.resolve(outPath);
  await writeCiBuildConfig(resolvedPath, platform, process.cwd(), {
    runNumber: process.env.GITHUB_RUN_NUMBER,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  console.log(resolvedPath);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[tauri-config]", error);
    process.exit(1);
  });
}
