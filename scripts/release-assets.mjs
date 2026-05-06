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

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
} from "fs/promises";
import path from "path";

import { toKebabCase } from "./rpm-package.mjs";

const BASE_TAURI_CONFIG_PATH = path.join("src-tauri", "tauri.conf.json");
const DEFAULT_BUNDLE_ROOT = path.join(
  "src-tauri",
  "target",
  "release",
  "bundle",
);

export function normalizeFilenameSegment(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveReleasePackageName(tauriConfig) {
  const sourceName = tauriConfig.productName || tauriConfig.mainBinaryName;
  const packageName = normalizeFilenameSegment(toKebabCase(sourceName || ""));

  if (!packageName) {
    throw new Error(
      "Unable to derive a release package name from Tauri config.",
    );
  }

  return packageName;
}

export function deriveReleaseVersion(tauriConfig) {
  if (typeof tauriConfig.version !== "string") {
    throw new Error(
      "Expected src-tauri/tauri.conf.json to define a string version.",
    );
  }

  const version = normalizeFilenameSegment(tauriConfig.version);
  if (!version) {
    throw new Error("Unable to derive a release version from Tauri config.");
  }

  return version;
}

export function buildTauriAssetNamePattern(tauriConfig) {
  return `${deriveReleasePackageName(tauriConfig)}-${deriveReleaseVersion(tauriConfig)}-[arch][setup][ext]`;
}

function debExtension(fileName) {
  if (fileName.endsWith(".deb.sig")) {
    return ".deb.sig";
  }

  if (fileName.endsWith(".deb")) {
    return ".deb";
  }

  return null;
}

function deriveDebianArchitecture(fileName, extension) {
  const stem = fileName.slice(0, -extension.length);
  const separator = stem.includes("_") ? "_" : "-";
  const architecture = stem.split(separator).at(-1);
  return normalizeFilenameSegment(architecture || "");
}

async function assertNoClobber(targetPath) {
  try {
    await stat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  throw new Error(
    `Refusing to overwrite existing release asset: ${targetPath}`,
  );
}

export async function normalizeLinuxPackageFileNames({
  projectRoot = process.cwd(),
  bundleRoot = path.join(projectRoot, DEFAULT_BUNDLE_ROOT),
  tauriConfig,
} = {}) {
  const config =
    tauriConfig ??
    JSON.parse(
      await readFile(path.join(projectRoot, BASE_TAURI_CONFIG_PATH), "utf8"),
    );
  const packageName = deriveReleasePackageName(config);
  const version = deriveReleaseVersion(config);
  const debDir = path.join(bundleRoot, "deb");

  await mkdir(debDir, { recursive: true });

  const renamed = [];
  for (const entry of await readdir(debDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = debExtension(entry.name);
    if (!extension) {
      continue;
    }

    const architecture = deriveDebianArchitecture(entry.name, extension);
    if (!architecture) {
      throw new Error(
        `Unable to derive Debian architecture from ${entry.name}.`,
      );
    }

    const targetName = `${packageName}-${version}-${architecture}${extension}`;
    if (entry.name === targetName) {
      continue;
    }

    const sourcePath = path.join(debDir, entry.name);
    const targetPath = path.join(debDir, targetName);
    await assertNoClobber(targetPath);
    await rename(sourcePath, targetPath);
    renamed.push({ from: sourcePath, to: targetPath });
  }

  return renamed;
}

async function loadBaseTauriConfig(projectRoot = process.cwd()) {
  return JSON.parse(
    await readFile(path.join(projectRoot, BASE_TAURI_CONFIG_PATH), "utf8"),
  );
}

async function printTauriAssetNamePattern() {
  const pattern = buildTauriAssetNamePattern(await loadBaseTauriConfig());
  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput) {
    await appendFile(githubOutput, `tauri_asset_name_pattern=${pattern}\n`);
  }

  console.log(pattern);
}

async function main() {
  const [command] = process.argv.slice(2);

  if (command === "tauri-pattern") {
    await printTauriAssetNamePattern();
    return;
  }

  if (command === "normalize-linux") {
    const renamed = await normalizeLinuxPackageFileNames();
    for (const { from, to } of renamed) {
      console.log(`${from} -> ${to}`);
    }
    return;
  }

  throw new Error("Expected command: tauri-pattern | normalize-linux");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[release-assets]", error);
    process.exit(1);
  });
}
