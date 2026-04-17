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
import LinuxPackageUpdateNotice, {
  LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
} from "./LinuxPackageUpdateNotice";

describe("LinuxPackageUpdateNotice", () => {
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  const renderNotice = () => {
    const [result] = createSignal({
      status: "update-available" as const,
      bundleType: "deb" as const,
      currentVersion: "0.0.1+2",
      availableVersion: "0.0.2-RC.1",
      command: "sudo apt update && sudo apt install --only-upgrade orkestraos",
      metadata: {
        version: "0.0.2-RC.1",
        releasedAt: "2026-04-17T12:00:00Z",
        notes: ["About modal refresh"],
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      },
    });

    render(() => <LinuxPackageUpdateNotice result={result} />);
  };

  it("renders update details and copies the upgrade command", async () => {
    renderNotice();

    expect(screen.getByText("A newer Linux package is available")).toBeTruthy();
    expect(screen.getByText("v0.0.2-RC.1")).toBeTruthy();
    expect(screen.getByText("v0.0.1+2")).toBeTruthy();
    expect(screen.getByText("deb")).toBeTruthy();
    expect(screen.getByText("About modal refresh")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Copy update command" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Copied update command.")).toBeTruthy();
    });

    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledWith(
      "sudo apt update && sudo apt install --only-upgrade orkestraos",
    );
  });

  it("persists dismissal per available version", async () => {
    renderNotice();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(
        screen.queryByText("A newer Linux package is available"),
      ).toBeNull();
    });

    expect(
      window.localStorage.getItem(
        LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      ),
    ).toBe("0.0.2-RC.1");
  });

  it("stays hidden when the available version was already dismissed", async () => {
    window.localStorage.setItem(
      LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      "0.0.2-RC.1",
    );

    renderNotice();

    await waitFor(() => {
      expect(
        screen.queryByText("A newer Linux package is available"),
      ).toBeNull();
    });
  });
});
