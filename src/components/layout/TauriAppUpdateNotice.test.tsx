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

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TauriAppUpdateNotice, {
  TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
} from "./TauriAppUpdateNotice";

const { installTauriAppUpdateMock } = vi.hoisted(() => ({
  installTauriAppUpdateMock: vi.fn<(manifestUrl: string) => Promise<void>>(),
}));

vi.mock("../../app/lib/appUpdates", async () => {
  const actual = await vi.importActual<typeof import("../../app/lib/appUpdates")>(
    "../../app/lib/appUpdates",
  );

  return {
    ...actual,
    installTauriAppUpdate: installTauriAppUpdateMock,
  };
});

describe("TauriAppUpdateNotice", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, String(value));
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });

    installTauriAppUpdateMock.mockReset();
    installTauriAppUpdateMock.mockResolvedValue();
  });

  const renderNotice = () => {
    const [result] = createSignal({
      kind: "tauri" as const,
      status: "update-available" as const,
      currentVersion: "0.0.2-RC.1",
      availableVersion: "0.0.2",
      manifestUrl:
        "https://github.com/fetchupstream/orkestra-os/releases/download/v0.0.2/latest.json",
      releasedAt: "2026-04-17T12:00:00Z",
      notes: ["Installer and updater polish"],
    });

    render(() => <TauriAppUpdateNotice result={result} />);
  };

  it("renders in-app update details and installs the selected release", async () => {
    renderNotice();

    expect(screen.getByText("A newer app update is available")).toBeTruthy();
    expect(screen.getByText("v0.0.2-RC.1")).toBeTruthy();
    expect(screen.getByText("v0.0.2")).toBeTruthy();
    expect(screen.getByText("Installer and updater polish")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );

    await waitFor(() => {
      expect(installTauriAppUpdateMock).toHaveBeenCalledWith(
        "https://github.com/fetchupstream/orkestra-os/releases/download/v0.0.2/latest.json",
      );
    });
  });

  it("persists dismissal per available version", async () => {
    renderNotice();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(
        screen.queryByText("A newer app update is available"),
      ).toBeNull();
    });

    expect(
      window.localStorage.getItem(
        TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      ),
    ).toBe("0.0.2");
  });

  it("stays hidden when the available version was already dismissed", async () => {
    window.localStorage.setItem(
      TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      "0.0.2",
    );

    renderNotice();

    await waitFor(() => {
      expect(
        screen.queryByText("A newer app update is available"),
      ).toBeNull();
    });
  });
});
