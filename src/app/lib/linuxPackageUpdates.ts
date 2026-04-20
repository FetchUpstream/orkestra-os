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

import { getBundleType, getVersion } from "@tauri-apps/api/app";
import { z } from "zod";
import { compareAppVersions, normalizeAppVersion } from "./appVersion";

export const LINUX_PACKAGE_UPDATE_METADATA_URL =
  "https://fetchupstream.github.io/orkestra-os/updates/latest.json";

export const SUPPORTED_LINUX_PACKAGE_BUNDLE_TYPES = ["deb", "rpm"] as const;

export type SupportedLinuxPackageBundleType =
  (typeof SUPPORTED_LINUX_PACKAGE_BUNDLE_TYPES)[number];

export const linuxPackageUpdateMetadataSchema = z
  .object({
    version: z.string().trim().min(1),
    releasedAt: z.string().trim().min(1),
    notes: z.array(z.string().trim().min(1)).optional().default([]),
    commands: z
      .object({
        deb: z.string().trim().min(1),
        rpm: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type LinuxPackageUpdateMetadata = z.infer<
  typeof linuxPackageUpdateMetadataSchema
>;

export type LinuxPackageUpdateAvailableResult = {
  status: "update-available";
  bundleType: SupportedLinuxPackageBundleType;
  currentVersion: string;
  availableVersion: string;
  command: string;
  metadata: LinuxPackageUpdateMetadata;
};

export type LinuxPackageUpToDateResult = {
  status: "up-to-date";
  bundleType: SupportedLinuxPackageBundleType;
  currentVersion: string;
  availableVersion: string;
  metadata: LinuxPackageUpdateMetadata;
};

export type LinuxPackageUpdateNotApplicableResult = {
  status: "not-applicable";
  reason: "unsupported-bundle-type" | "bundle-type-unavailable";
  bundleType?: string;
  currentVersion?: string;
};

export type LinuxPackageUpdateErrorResult = {
  status: "error";
  message: string;
};

export type LinuxPackageUpdateCheckResult =
  | LinuxPackageUpdateAvailableResult
  | LinuxPackageUpToDateResult
  | LinuxPackageUpdateNotApplicableResult
  | LinuxPackageUpdateErrorResult;

export type LinuxPackageUpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | LinuxPackageUpdateCheckResult;

type RuntimeContext = {
  bundleType: string;
  currentVersion: string;
};

type CheckForLinuxPackageUpdateOptions = {
  fetchImpl?: typeof fetch;
  runtimeContext?: RuntimeContext;
  cacheBustValue?: string;
};

const normalizeVersion = (value: string) => normalizeAppVersion(value) ?? value.trim();

export const isSupportedLinuxPackageBundleType = (
  value: string,
 ): value is SupportedLinuxPackageBundleType =>
  SUPPORTED_LINUX_PACKAGE_BUNDLE_TYPES.includes(
    value as SupportedLinuxPackageBundleType,
  );

export const parseLinuxPackageUpdateMetadata = (
  payload: unknown,
 ): LinuxPackageUpdateMetadata =>
  linuxPackageUpdateMetadataSchema.parse(payload);

export const selectLinuxPackageUpgradeCommand = (
  metadata: LinuxPackageUpdateMetadata,
  bundleType: SupportedLinuxPackageBundleType,
 ) => metadata.commands[bundleType];

export const fetchLinuxPackageUpdateMetadata = async (
  fetchImpl: typeof fetch = fetch,
  cacheBustValue = `${Date.now()}`,
 ): Promise<LinuxPackageUpdateMetadata> => {
  const url = new URL(LINUX_PACKAGE_UPDATE_METADATA_URL);
  url.searchParams.set("t", cacheBustValue);

  const response = await fetchImpl(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Update metadata request failed (${response.status})`);
  }

  return parseLinuxPackageUpdateMetadata(await response.json());
};

const readRuntimeContext = async (): Promise<RuntimeContext> => {
  const [bundleTypeResult, versionResult] = await Promise.allSettled([
    getBundleType(),
    getVersion(),
  ]);

  const currentVersion =
    versionResult.status === "fulfilled"
      ? normalizeVersion(versionResult.value)
      : undefined;

  if (bundleTypeResult.status !== "fulfilled") {
    return {
      bundleType: "",
      currentVersion: currentVersion ?? "",
    };
  }

  return {
    bundleType: `${bundleTypeResult.value}`.trim(),
    currentVersion: currentVersion ?? "",
  };
};

export const checkForLinuxPackageUpdate = async (
  options: CheckForLinuxPackageUpdateOptions = {},
 ): Promise<LinuxPackageUpdateCheckResult> => {
  try {
    const runtimeContext =
      options.runtimeContext ?? (await readRuntimeContext());
    const currentVersion = normalizeVersion(runtimeContext.currentVersion);

    if (!runtimeContext.bundleType) {
      return {
        status: "not-applicable",
        reason: "bundle-type-unavailable",
        currentVersion: currentVersion || undefined,
      };
    }

    if (!isSupportedLinuxPackageBundleType(runtimeContext.bundleType)) {
      return {
        status: "not-applicable",
        reason: "unsupported-bundle-type",
        bundleType: runtimeContext.bundleType,
        currentVersion: currentVersion || undefined,
      };
    }

    if (!currentVersion) {
      return {
        status: "error",
        message: "Unable to determine the installed app version.",
      };
    }

    const metadata = await fetchLinuxPackageUpdateMetadata(
      options.fetchImpl,
      options.cacheBustValue,
    );
    const availableVersion = normalizeVersion(metadata.version);

    if (compareAppVersions(availableVersion, currentVersion) > 0) {
      return {
        status: "update-available",
        bundleType: runtimeContext.bundleType,
        currentVersion,
        availableVersion,
        command: selectLinuxPackageUpgradeCommand(
          metadata,
          runtimeContext.bundleType,
        ),
        metadata,
      };
    }

    return {
      status: "up-to-date",
      bundleType: runtimeContext.bundleType,
      currentVersion,
      availableVersion,
      metadata,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to check for package updates.",
    };
  }
};
