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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_LINKS } from "../../app/config/supportLinks";
import type { LinuxPackageUpdateCheckState } from "../../app/lib/linuxPackageUpdates";
import AboutModal from "./AboutModal";

const { getNameMock, getVersionMock, getTauriVersionMock, openUrlMock } =
  vi.hoisted(() => ({
    getNameMock: vi.fn<() => Promise<string>>(),
    getVersionMock: vi.fn<() => Promise<string>>(),
    getTauriVersionMock: vi.fn<() => Promise<string>>(),
    openUrlMock: vi.fn<(url: string) => Promise<void>>(),
  }));

vi.mock("@tauri-apps/api/app", () => ({
  getName: getNameMock,
  getVersion: getVersionMock,
  getTauriVersion: getTauriVersionMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

describe("AboutModal", () => {
  let windowOpenMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getNameMock.mockReset();
    getVersionMock.mockReset();
    getTauriVersionMock.mockReset();
    openUrlMock.mockReset();

    getNameMock.mockResolvedValue("OrkestraOS");
    getVersionMock.mockResolvedValue("0.0.12+105");
    getTauriVersionMock.mockResolvedValue("2.0.0");
    openUrlMock.mockResolvedValue();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    windowOpenMock = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpenMock.mockRestore();
  });

  const renderOpenModal = () => {
    const [isOpen, setIsOpen] = createSignal(true);
    render(() => (
      <AboutModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    ));
    return { setIsOpen };
  };

  const renderOpenModalWithUpdateState = (
    status: LinuxPackageUpdateCheckState,
  ) => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [updateState] = createSignal(status);
    const onCheckForUpdates = vi.fn();
    render(() => (
      <AboutModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        updateState={updateState}
        onCheckForUpdates={onCheckForUpdates}
      />
    ));
    return { onCheckForUpdates };
  };

  it("renders support info and opens external links", async () => {
    renderOpenModal();

    expect(
      await screen.findByRole("dialog", { name: "About Orkestra OS" }),
    ).toBeTruthy();
    expect(screen.getByText("Orkestra OS")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Version v0.0.12+105")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "Desktop app for orchestrating AI agent runs across projects, tasks, and Git worktrees.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Source code" }));
    expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.githubRepository);

    fireEvent.click(screen.getByRole("link", { name: "Documentation" }));
    expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.documentation);

    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.issueReporting);
  });

  it("copies debug info to clipboard", async () => {
    renderOpenModal();

    await waitFor(() => {
      expect(screen.getByText("Version v0.0.12+105")).toBeTruthy();
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy debug info" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Copied support details.")).toBeTruthy();
    });

    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("App: OrkestraOS");
    expect(writeText.mock.calls[0]?.[0]).toContain("Version: 0.0.12+105");
    expect(writeText.mock.calls[0]?.[0]).toContain("Build:");
  });

  it("falls back to window.open when opener.openUrl rejects", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("failed to open"));
    renderOpenModal();

    await fireEvent.click(screen.getByRole("link", { name: "Source code" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.githubRepository);
      expect(windowOpenMock).toHaveBeenCalledWith(
        SUPPORT_LINKS.githubRepository,
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("shows Linux package update details and copies the update command", async () => {
    const { onCheckForUpdates } = renderOpenModalWithUpdateState({
      status: "update-available" as const,
      bundleType: "deb" as const,
      currentVersion: "0.0.1+2",
      availableVersion: "0.0.2",
      command: "sudo apt update && sudo apt install --only-upgrade orkestraos",
      metadata: {
        version: "0.0.2",
        releasedAt: "2026-04-13T12:00:00Z",
        notes: ["Sidebar polish"],
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      },
    });

    expect(screen.getByText("A newer Linux package is available")).toBeTruthy();
    expect(screen.getByText("Sidebar polish")).toBeTruthy();
    expect(
      screen.getByText(
        "Checked https://fetchupstream.github.io/orkestra-os/updates/latest.json. Update found.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);

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
});
