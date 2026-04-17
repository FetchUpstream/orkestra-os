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
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALPHA_BUILD_GITHUB_HOMEPAGE,
  ALPHA_BUILD_RELEASE_NOTES,
} from "../../app/config/alphaBuild";
import AlphaNoticeModal, {
  ALPHA_NOTICE_ACK_STORAGE_KEY,
} from "./AlphaNoticeModal";

const { getVersionMock } = vi.hoisted(() => ({
  getVersionMock: vi.fn<() => Promise<string>>(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

describe("AlphaNoticeModal", () => {
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

    getVersionMock.mockReset();
    getVersionMock.mockResolvedValue("0.1.0");
    window.localStorage.removeItem(ALPHA_NOTICE_ACK_STORAGE_KEY);
  });

  it("renders the approved alpha notice copy with a single Continue button", async () => {
    render(() => <AlphaNoticeModal />);

    expect(
      await screen.findByRole("dialog", { name: "Alpha Build" }),
    ).toBeTruthy();

    expect(
      screen.getByText("You’re using an alpha version of this app."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This build is still under active development and may contain:",
      ),
    ).toBeTruthy();
    expect(screen.getByText("unfinished features")).toBeTruthy();
    expect(screen.getByText("bugs and visual issues")).toBeTruthy();
    expect(screen.getByText("unexpected crashes or data loss")).toBeTruthy();
    expect(
      screen.getByText("workflows that may change without notice"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Please use caution and avoid relying on this build for critical work.",
      ),
    ).toBeTruthy();

    expect(screen.getByText("Version: 0.1.0")).toBeTruthy();
    expect(screen.getByText("What’s new in this build")).toBeTruthy();
    for (const note of ALPHA_BUILD_RELEASE_NOTES) {
      expect(screen.getByText(note)).toBeTruthy();
    }
    expect(
      screen.getByText(
        "This project is dual-licensed under Apache 2.0 and MIT.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: ALPHA_BUILD_GITHUB_HOMEPAGE }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "By continuing, you acknowledge that this is an early test build and that the experience may be unstable.",
      ),
    ).toBeTruthy();

    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open GitHub/i })).toBeNull();
  });

  it("persists acknowledgement when Continue is clicked", async () => {
    render(() => <AlphaNoticeModal />);

    const continueButton = await screen.findByRole("button", {
      name: "Continue",
    });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Alpha Build" })).toBeNull();
    });
    expect(window.localStorage.getItem(ALPHA_NOTICE_ACK_STORAGE_KEY)).toBe(
      "0.1.0",
    );
  });

  it("does not open when the current version was already acknowledged", async () => {
    window.localStorage.setItem(ALPHA_NOTICE_ACK_STORAGE_KEY, "0.1.0");

    render(() => <AlphaNoticeModal />);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Alpha Build" })).toBeNull();
    });
  });
});
