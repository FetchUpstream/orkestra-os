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

import * as tauriApp from "@tauri-apps/api/app";

export type AppSupportMetadata = {
  appName?: string;
  appVersion?: string;
  tauriVersion?: string;
  packageIdentifier?: string;
  platform?: string;
  architecture?: string;
  build?: string;
};

const normalize = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const readPlatform = () => {
  if (typeof navigator === "undefined") return undefined;
  const platform =
    normalize(
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform,
    ) ?? normalize(navigator.platform);
  return platform;
};

const readArchitecture = () => {
  if (typeof navigator === "undefined") return undefined;
  return normalize(
    (navigator as Navigator & { userAgentData?: { architecture?: string } })
      .userAgentData?.architecture,
  );
};

const readBuildChannel = () => {
  const mode = normalize(import.meta.env.MODE);
  if (!mode) return undefined;
  return mode.toLowerCase() === "production" ? "stable" : mode;
};

export const readAppSupportMetadata = async (): Promise<AppSupportMetadata> => {
  const getIdentifier =
    "getIdentifier" in tauriApp && typeof tauriApp.getIdentifier === "function"
      ? tauriApp.getIdentifier
      : undefined;

  const [
    appNameResult,
    appVersionResult,
    tauriVersionResult,
    identifierResult,
  ] = await Promise.allSettled([
    tauriApp.getName(),
    tauriApp.getVersion(),
    tauriApp.getTauriVersion(),
    getIdentifier ? getIdentifier() : Promise.resolve(undefined),
  ]);

  return {
    appName:
      appNameResult.status === "fulfilled"
        ? normalize(appNameResult.value)
        : undefined,
    appVersion:
      appVersionResult.status === "fulfilled"
        ? normalize(appVersionResult.value)
        : undefined,
    tauriVersion:
      tauriVersionResult.status === "fulfilled"
        ? normalize(tauriVersionResult.value)
        : undefined,
    packageIdentifier:
      identifierResult.status === "fulfilled"
        ? normalize(identifierResult.value)
        : undefined,
    platform: readPlatform(),
    architecture: readArchitecture(),
    build: readBuildChannel(),
  };
};

export const formatSupportDebugInfo = (metadata: AppSupportMetadata) => {
  const rows: Array<[string, string | undefined]> = [
    ["App", metadata.appName],
    ["Version", metadata.appVersion],
    ["Platform", metadata.platform],
    ["Architecture", metadata.architecture],
    ["Build", metadata.build],
    ["Tauri", metadata.tauriVersion],
    ["Package", metadata.packageIdentifier],
  ];

  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
};

export const formatAppVersionForDisplay = (version?: string | null) => {
  const normalized = normalize(version);
  if (!normalized) {
    return "unknown";
  }

  const stripped = normalized.replace(/^v/i, "");
  if (!stripped) {
    return "unknown";
  }

  return `v${stripped}`;
};
