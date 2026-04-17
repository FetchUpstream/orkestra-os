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
import { invoke } from "@tauri-apps/api/core";
import {
  checkForLinuxPackageUpdate,
  type LinuxPackageUpdateAvailableResult,
  type LinuxPackageUpdateCheckResult,
  type LinuxPackageUpdateErrorResult,
  type LinuxPackageUpdateNotApplicableResult,
  type LinuxPackageUpToDateResult,
} from "./linuxPackageUpdates";

export type LinuxPackageAppUpdateAvailableResult =
  LinuxPackageUpdateAvailableResult & {
    kind: "linux-package";
  };

export type LinuxPackageAppUpdateUpToDateResult = LinuxPackageUpToDateResult & {
  kind: "linux-package";
};

export type LinuxPackageAppUpdateNotApplicableResult =
  LinuxPackageUpdateNotApplicableResult & {
    kind: "linux-package";
  };

export type LinuxPackageAppUpdateErrorResult = LinuxPackageUpdateErrorResult & {
  kind: "linux-package";
};

export type TauriAppUpdateAvailableResult = {
  kind: "tauri";
  status: "update-available";
  currentVersion: string;
  availableVersion: string;
  manifestUrl: string;
  releasedAt?: string | null;
  notes: string[];
};

export type TauriAppUpToDateResult = {
  kind: "tauri";
  status: "up-to-date";
  currentVersion: string;
  availableVersion: string;
  releasedAt?: string | null;
  notes: string[];
};

export type TauriAppUpdateNotApplicableResult = {
  kind: "tauri";
  status: "not-applicable";
  reason: "bundle-type-unavailable";
  currentVersion?: string;
};

export type TauriAppUpdateErrorResult = {
  kind: "tauri";
  status: "error";
  message: string;
};

type RawTauriAppUpdateCheckResult =
  | Omit<TauriAppUpdateAvailableResult, "kind">
  | Omit<TauriAppUpToDateResult, "kind">
  | Omit<TauriAppUpdateErrorResult, "kind">;

export type TauriAppUpdateCheckResult =
  | TauriAppUpdateAvailableResult
  | TauriAppUpToDateResult
  | TauriAppUpdateNotApplicableResult
  | TauriAppUpdateErrorResult;

export type AppUpdateCheckResult =
  | LinuxPackageAppUpdateAvailableResult
  | LinuxPackageAppUpdateUpToDateResult
  | LinuxPackageAppUpdateNotApplicableResult
  | LinuxPackageAppUpdateErrorResult
  | TauriAppUpdateCheckResult;

export type AppUpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | AppUpdateCheckResult;

const addLinuxPackageKind = (
  result: LinuxPackageUpdateCheckResult,
): AppUpdateCheckResult => ({
  ...result,
  kind: "linux-package",
});

const normalizeBundleType = (value?: string | null): string => value?.trim() ?? "";
const normalizeVersion = (value?: string | null): string => value?.trim() ?? "";

const isLinuxPackageBundleType = (value: string): value is "deb" | "rpm" => {
  return value === "deb" || value === "rpm";
};

export const checkForAppUpdate = async (): Promise<AppUpdateCheckResult> => {
  const [bundleTypeResult, versionResult] = await Promise.allSettled([
    getBundleType(),
    getVersion(),
  ]);
  const bundleType = normalizeBundleType(
    bundleTypeResult.status === "fulfilled" ? `${bundleTypeResult.value}` : "",
  );
  const currentVersion = normalizeVersion(
    versionResult.status === "fulfilled" ? versionResult.value : "",
  );

  if (isLinuxPackageBundleType(bundleType)) {
    return addLinuxPackageKind(
      await checkForLinuxPackageUpdate({
        runtimeContext: {
          bundleType,
          currentVersion,
        },
      }),
    );
  }

  if (!bundleType) {
    return {
      kind: "tauri",
      status: "not-applicable",
      reason: "bundle-type-unavailable",
      currentVersion: currentVersion || undefined,
    };
  }

  try {
    const tauriResult = await invoke<RawTauriAppUpdateCheckResult>(
      "check_tauri_app_update",
    );
    return {
      ...tauriResult,
      kind: "tauri",
    } as TauriAppUpdateCheckResult;
  } catch (error) {
    return {
      kind: "tauri",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const installTauriAppUpdate = async (
  manifestUrl: string,
): Promise<void> => {
  await invoke("install_tauri_app_update", { manifestUrl });
};

export const isLinuxPackageAppUpdateAvailable = (
  value: AppUpdateCheckResult | null | undefined,
): value is LinuxPackageAppUpdateAvailableResult => {
  return value?.kind === "linux-package" && value.status === "update-available";
};

export const isTauriAppUpdateAvailable = (
  value: AppUpdateCheckState | AppUpdateCheckResult | null | undefined,
 ): value is TauriAppUpdateAvailableResult => {
  return Boolean(
    value &&
      "kind" in value &&
      value.kind === "tauri" &&
      value.status === "update-available",
  );
};
