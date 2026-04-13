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

import { describe, expect, it, vi } from "vitest";
import {
  checkForLinuxPackageUpdate,
  fetchLinuxPackageUpdateMetadata,
  parseLinuxPackageUpdateMetadata,
} from "./linuxPackageUpdates";

describe("linuxPackageUpdates", () => {
  it("parses the canonical metadata shape", () => {
    expect(
      parseLinuxPackageUpdateMetadata({
        version: "0.0.2",
        releasedAt: "2026-04-13T12:00:00Z",
        notes: ["Fixes and polish"],
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      }),
    ).toMatchObject({
      version: "0.0.2",
      notes: ["Fixes and polish"],
    });
  });

  it("defaults missing notes to an empty list", () => {
    expect(
      parseLinuxPackageUpdateMetadata({
        version: "0.0.2",
        releasedAt: "2026-04-13T12:00:00Z",
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      }),
    ).toMatchObject({ notes: [] });
  });

  it("fetches metadata with cache busting", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "0.0.2",
        releasedAt: "2026-04-13T12:00:00Z",
        notes: [],
        commands: {
          deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
          rpm: "sudo dnf upgrade orkestraos",
        },
      }),
    } as Response);

    await fetchLinuxPackageUpdateMetadata(fetchMock, "12345");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("updates/latest.json?t=12345"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns update-available for newer deb metadata", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "deb",
        currentVersion: "0.0.1+2",
      },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.0.2",
          releasedAt: "2026-04-13T12:00:00Z",
          notes: ["Run chat transcript UX fixes"],
          commands: {
            deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
            rpm: "sudo dnf upgrade orkestraos",
          },
        }),
      } as Response),
      cacheBustValue: "1",
    });

    expect(result).toMatchObject({
      status: "update-available",
      bundleType: "deb",
      availableVersion: "0.0.2",
      command: "sudo apt update && sudo apt install --only-upgrade orkestraos",
    });
  });

  it("returns update-available for newer rpm metadata", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "rpm",
        currentVersion: "0.0.1",
      },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.0.2",
          releasedAt: "2026-04-13T12:00:00Z",
          notes: [],
          commands: {
            deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
            rpm: "sudo dnf upgrade orkestraos",
          },
        }),
      } as Response),
      cacheBustValue: "1",
    });

    expect(result).toMatchObject({
      status: "update-available",
      bundleType: "rpm",
      command: "sudo dnf upgrade orkestraos",
    });
  });

  it("returns up-to-date when versions match", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "deb",
        currentVersion: "0.0.2",
      },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.0.2",
          releasedAt: "2026-04-13T12:00:00Z",
          notes: [],
          commands: {
            deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
            rpm: "sudo dnf upgrade orkestraos",
          },
        }),
      } as Response),
      cacheBustValue: "1",
    });

    expect(result).toMatchObject({
      status: "up-to-date",
      availableVersion: "0.0.2",
      currentVersion: "0.0.2",
    });
  });

  it("returns up-to-date when metadata is older", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "deb",
        currentVersion: "0.0.3",
      },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.0.2",
          releasedAt: "2026-04-13T12:00:00Z",
          notes: [],
          commands: {
            deb: "sudo apt update && sudo apt install --only-upgrade orkestraos",
            rpm: "sudo dnf upgrade orkestraos",
          },
        }),
      } as Response),
      cacheBustValue: "1",
    });

    expect(result).toMatchObject({
      status: "up-to-date",
      currentVersion: "0.0.3",
    });
  });

  it("returns not-applicable for unsupported bundle types", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "appimage",
        currentVersion: "0.0.1",
      },
      fetchImpl: vi.fn<typeof fetch>(),
      cacheBustValue: "1",
    });

    expect(result).toEqual({
      status: "not-applicable",
      reason: "unsupported-bundle-type",
      bundleType: "appimage",
      currentVersion: "0.0.1",
    });
  });

  it("returns an error for invalid metadata", async () => {
    const result = await checkForLinuxPackageUpdate({
      runtimeContext: {
        bundleType: "deb",
        currentVersion: "0.0.1",
      },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "0.0.2",
        }),
      } as Response),
      cacheBustValue: "1",
    });

    expect(result.status).toBe("error");
  });
});
