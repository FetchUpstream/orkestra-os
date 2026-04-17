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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForAppUpdate, installTauriAppUpdate } from "./appUpdates";

const {
  getBundleTypeMock,
  getVersionMock,
  invokeMock,
  checkForLinuxPackageUpdateMock,
} = vi.hoisted(() => ({
  getBundleTypeMock: vi.fn<() => Promise<string>>(),
  getVersionMock: vi.fn<() => Promise<string>>(),
  invokeMock: vi.fn(),
  checkForLinuxPackageUpdateMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getBundleType: getBundleTypeMock,
  getVersion: getVersionMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("./linuxPackageUpdates", () => ({
  checkForLinuxPackageUpdate: checkForLinuxPackageUpdateMock,
}));

describe("appUpdates", () => {
  beforeEach(() => {
    getBundleTypeMock.mockReset();
    getVersionMock.mockReset();
    invokeMock.mockReset();
    checkForLinuxPackageUpdateMock.mockReset();
  });

  it("routes deb installs through the Linux package update flow", async () => {
    getBundleTypeMock.mockResolvedValue("deb");
    getVersionMock.mockResolvedValue("0.0.2-RC.1");
    checkForLinuxPackageUpdateMock.mockResolvedValue({
      status: "update-available",
      bundleType: "deb",
      currentVersion: "0.0.2-RC.1",
      availableVersion: "0.0.2",
      command: "sudo apt update && sudo apt install --only-upgrade orkestraos",
      metadata: {
        version: "0.0.2",
        releasedAt: "2026-04-17T12:00:00Z",
        notes: ["Release note"],
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      },
    });

    await expect(checkForAppUpdate()).resolves.toMatchObject({
      kind: "linux-package",
      status: "update-available",
      bundleType: "deb",
      currentVersion: "0.0.2-RC.1",
    });
    expect(checkForLinuxPackageUpdateMock).toHaveBeenCalledWith({
      runtimeContext: {
        bundleType: "deb",
        currentVersion: "0.0.2-RC.1",
      },
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes non-package installs through the Tauri updater command", async () => {
    getBundleTypeMock.mockResolvedValue("nsis");
    getVersionMock.mockResolvedValue("0.0.2-RC.1");
    invokeMock.mockResolvedValue({
      kind: "tauri",
      status: "update-available",
      currentVersion: "0.0.2-RC.1",
      availableVersion: "0.0.2",
      manifestUrl:
        "https://github.com/fetchupstream/orkestra-os/releases/download/v0.0.2/latest.json",
      releasedAt: "2026-04-17T12:00:00Z",
      notes: ["Release note"],
    });

    await expect(checkForAppUpdate()).resolves.toMatchObject({
      kind: "tauri",
      status: "update-available",
      currentVersion: "0.0.2-RC.1",
      availableVersion: "0.0.2",
    });
    expect(invokeMock).toHaveBeenCalledWith("check_tauri_app_update");
    expect(checkForLinuxPackageUpdateMock).not.toHaveBeenCalled();
  });

  it("installs the selected Tauri update manifest", async () => {
    invokeMock.mockResolvedValue(undefined);

    await installTauriAppUpdate(
      "https://github.com/fetchupstream/orkestra-os/releases/download/v0.0.2/latest.json",
    );

    expect(invokeMock).toHaveBeenCalledWith("install_tauri_app_update", {
      manifestUrl:
        "https://github.com/fetchupstream/orkestra-os/releases/download/v0.0.2/latest.json",
    });
  });
});
