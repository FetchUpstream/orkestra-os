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

import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const BASE_TAURI_CONFIG_PATH = path.join("src-tauri", "tauri.conf.json");
const CARGO_MANIFEST_PATH = path.join("src-tauri", "Cargo.toml");
const VERSION_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+(?<buildmetadata>[0-9A-Za-z.-]+))?$/;
const DEFAULT_SUMMARY = "Desktop app for orchestrating AI agents";
const ICON_FILE_PATTERN = /^(?<width>\d+)x(?<height>\d+)(?<density>@2x)?\.png$/;

export function parseSemverVersion(version) {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(VERSION_PATTERN);
  if (!match?.groups) {
    throw new Error(
      `Unsupported Tauri app version \"${version}\". Expected semver like 1.2.3 or 1.2.3-rc.4.`,
    );
  }

  return {
    normalizedVersion,
    ...match.groups,
  };
}

export function toKebabCase(value) {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z\d]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function sanitizeRpmSegment(value) {
  return value.trim().replace(/-/g, ".");
}

export function deriveRpmVersionParts(version) {
  const { major, minor, patch, prerelease, buildmetadata } = parseSemverVersion(version);
  const rpmVersion = `${major}.${minor}.${patch}`;

  if (!prerelease) {
    return {
      version: rpmVersion,
      release: "1",
    };
  }

  const releaseSegments = [
    "0",
    sanitizeRpmSegment(prerelease),
    ...(buildmetadata ? buildmetadata.split(".").map(sanitizeRpmSegment) : []),
  ];

  return {
    version: rpmVersion,
    release: releaseSegments.join("."),
  };
}

export function mapArchitecture(nodeArch = process.arch) {
  switch (nodeArch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    default:
      throw new Error(`Unsupported RPM architecture for Node arch \"${nodeArch}\".`);
  }
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCargoPackageMetadata(projectRoot) {
  const cargoText = await readFile(path.join(projectRoot, CARGO_MANIFEST_PATH), "utf8");
  const getValue = (key) => {
    const match = cargoText.match(new RegExp(`^${key}\\s*=\\s*\"([^\"]+)\"`, "m"));
    return match ? match[1] : "";
  };

  return {
    name: getValue("name"),
    description: getValue("description"),
    homepage: getValue("homepage"),
    repository: getValue("repository"),
    license: getValue("license"),
  };
}

export async function listLinuxIconFiles(iconDirPath) {
  const entries = await readdir(iconDirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && ICON_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(ICON_FILE_PATTERN);
      return {
        sourcePath: path.join(iconDirPath, entry.name),
        width: Number(match.groups.width),
        height: Number(match.groups.height),
        isHighDensity: Boolean(match.groups.density),
      };
    })
    .sort((left, right) => left.width - right.width || left.height - right.height);
}

export function renderDesktopEntry({ categories, comment, binaryName, iconName, displayName }) {
  return [
    "[Desktop Entry]",
    `Categories=${categories}`,
    ...(comment ? [`Comment=${comment}`] : []),
    `Exec=${binaryName}`,
    `StartupWMClass=${binaryName}`,
    `Icon=${iconName}`,
    `Name=${displayName}`,
    "Terminal=false",
    "Type=Application",
    "",
  ].join("\n");
}

export function renderRpmSpec(metadata) {
  const files = [
    `%attr(0755,root,root) /usr/bin/${metadata.binaryName}`,
    `/usr/share/applications/${metadata.desktopFileName}`,
    ...metadata.iconPaths,
  ];

  return [
    "%global _build_id_links none",
    `Name:           ${metadata.packageName}`,
    `Version:        ${metadata.version}`,
    `Release:        ${metadata.release}%{?dist}`,
    `Summary:        ${metadata.summary}`,
    "",
    `License:        ${metadata.license}`,
    `URL:            ${metadata.homepage}`,
    `BuildArch:      ${metadata.architecture}`,
    `Source0:        ${metadata.sourceArchiveName}`,
    "",
    "%description",
    metadata.description,
    "",
    "%prep",
    `%setup -q -n ${metadata.sourceDirectoryName}`,
    "",
    "%install",
    "mkdir -p %{buildroot}",
    "cp -a usr %{buildroot}/",
    "",
    "%files",
    ...files,
    "",
  ].join("\n");
}

async function runCommand(command, args, options = {}) {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")} (exit ${exitCode})`);
  }
}

export async function createRpmBuildContext(projectRoot = process.cwd()) {
  const tauriConfig = await loadJson(path.join(projectRoot, BASE_TAURI_CONFIG_PATH));
  if (typeof tauriConfig.version !== "string") {
    throw new Error("Expected src-tauri/tauri.conf.json to define a string version.");
  }

  const cargoPackage = await readCargoPackageMetadata(projectRoot);
  const binaryName = tauriConfig.mainBinaryName || cargoPackage.name;
  if (!binaryName) {
    throw new Error("Unable to determine the Linux binary name from Tauri config or Cargo.toml.");
  }

  const packageName = toKebabCase(tauriConfig.productName || binaryName);
  const architecture = mapArchitecture();
  const versionParts = deriveRpmVersionParts(tauriConfig.version);
  const sourceDirectoryName = `${packageName}-${versionParts.version}-${versionParts.release}`;
  const sourceArchiveName = `${sourceDirectoryName}.tar.gz`;
  const desktopFileName = `${packageName}.desktop`;
  const iconName = binaryName;
  const comment = cargoPackage.description || undefined;
  const categories = tauriConfig.bundle?.category === "Development" ? "Development;" : "Utility;";
  const iconFiles = await listLinuxIconFiles(path.join(projectRoot, "src-tauri", "icons"));
  if (iconFiles.length === 0) {
    throw new Error("Expected at least one PNG icon in src-tauri/icons for RPM packaging.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "orkestra-rpm-"));
  const topDir = path.join(tempRoot, "rpmbuild");
  const buildRoot = path.join(topDir, sourceDirectoryName);
  const payloadRoot = path.join(buildRoot, "usr");
  const rpmOutputDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "rpm");
  const binarySourcePath = path.join(projectRoot, "src-tauri", "target", "release", binaryName);

  return {
    architecture,
    binaryName,
    binarySourcePath,
    categories,
    comment,
    desktopFileName,
    iconFiles,
    iconName,
    packageName,
    projectRoot,
    rpmOutputDir,
    sourceArchiveName,
    sourceDirectoryName,
    topDir,
    version: versionParts.version,
    release: versionParts.release,
    description:
      cargoPackage.description || "Desktop app for orchestrating AI agents with OpenCode.",
    homepage: cargoPackage.homepage || cargoPackage.repository || "https://github.com/FetchUpstream/orkestra-os",
    license: cargoPackage.license || "MIT OR Apache-2.0",
    summary: DEFAULT_SUMMARY,
    buildRoot,
    payloadRoot,
    tempRoot,
    displayName: tauriConfig.productName || binaryName,
  };
}

export async function buildRpmPackage(projectRoot = process.cwd()) {
  const context = await createRpmBuildContext(projectRoot);

  try {
    await mkdir(path.join(context.topDir, "BUILD"), { recursive: true });
    await mkdir(path.join(context.topDir, "BUILDROOT"), { recursive: true });
    await mkdir(path.join(context.topDir, "RPMS"), { recursive: true });
    await mkdir(path.join(context.topDir, "SOURCES"), { recursive: true });
    await mkdir(path.join(context.topDir, "SPECS"), { recursive: true });
    await mkdir(path.join(context.topDir, "SRPMS"), { recursive: true });
    await mkdir(path.join(context.payloadRoot, "bin"), { recursive: true });
    await mkdir(path.join(context.payloadRoot, "share", "applications"), { recursive: true });

    await cp(context.binarySourcePath, path.join(context.payloadRoot, "bin", context.binaryName));
    await chmod(path.join(context.payloadRoot, "bin", context.binaryName), 0o755);

    const desktopEntryPath = path.join(
      context.payloadRoot,
      "share",
      "applications",
      context.desktopFileName,
    );
    await writeFile(
      desktopEntryPath,
      renderDesktopEntry({
        categories: context.categories,
        comment: context.comment,
        binaryName: context.binaryName,
        iconName: context.iconName,
        displayName: context.displayName,
      }),
    );

    const iconPaths = [];
    for (const icon of context.iconFiles) {
      const iconDestinationDir = path.join(
        context.payloadRoot,
        "share",
        "icons",
        "hicolor",
        `${icon.width}x${icon.height}${icon.isHighDensity ? "@2" : ""}`,
        "apps",
      );
      await mkdir(iconDestinationDir, { recursive: true });
      const destinationPath = path.join(iconDestinationDir, `${context.iconName}.png`);
      await cp(icon.sourcePath, destinationPath);
      iconPaths.push(destinationPath.replace(context.buildRoot, ""));
    }

    const specPath = path.join(context.topDir, "SPECS", `${context.packageName}.spec`);
    await writeFile(
      specPath,
      renderRpmSpec({
        architecture: context.architecture,
        binaryName: context.binaryName,
        description: context.description,
        desktopFileName: context.desktopFileName,
        homepage: context.homepage,
        iconPaths,
        license: context.license,
        packageName: context.packageName,
        release: context.release,
        sourceArchiveName: context.sourceArchiveName,
        sourceDirectoryName: context.sourceDirectoryName,
        summary: context.summary,
        version: context.version,
      }),
    );

    await runCommand(
      "tar",
      ["-czf", path.join(context.topDir, "SOURCES", context.sourceArchiveName), "-C", context.topDir, context.sourceDirectoryName],
      { cwd: context.topDir },
    );

    await rm(context.rpmOutputDir, { recursive: true, force: true });
    await mkdir(context.rpmOutputDir, { recursive: true });
    await runCommand(
      "rpmbuild",
      ["--define", `_topdir ${context.topDir}`, "-bb", specPath],
      { cwd: context.projectRoot },
    );

    const rpmArtifactDir = path.join(
      context.topDir,
      "RPMS",
      context.architecture,
    );
    const builtRpmName = (await readdir(rpmArtifactDir)).find(
      (entry) =>
        entry.startsWith(`${context.packageName}-${context.version}-`) &&
        entry.endsWith(`.${context.architecture}.rpm`),
    );

    if (!builtRpmName) {
      throw new Error("rpmbuild completed without producing an RPM artifact.");
    }

    const builtRpmPath = path.join(rpmArtifactDir, builtRpmName);
    const outputPath = path.join(
      context.rpmOutputDir,
      builtRpmName,
    );
    await cp(builtRpmPath, outputPath);
    return outputPath;
  } finally {
    await rm(context.tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const outputPath = await buildRpmPackage(process.cwd());
  console.log(outputPath);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[rpm-package]", error);
    process.exit(1);
  });
}
