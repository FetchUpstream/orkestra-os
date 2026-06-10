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

import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildTauriConfigForCi,
  buildTauriConfigForMacBundles,
  buildTauriConfigForWindowsMsi,
} from "./tauri-config.mjs";

type TauriWindowConfig = {
  label?: string;
  maximized?: boolean;
};

type TauriConfigWithWindows = {
  app: {
    windows: TauriWindowConfig[];
  };
};

function expectMainWindowMaximized(config: TauriConfigWithWindows) {
  const mainWindow = config.app.windows.find(
    (windowConfig) => windowConfig.label === "main",
  );

  expect(mainWindow).toMatchObject({
    label: "main",
    maximized: true,
  });
}

describe("tauri-config CI helpers", () => {
  it("keeps the shared main window maximized for desktop CI configs", async () => {
    const baseConfig = JSON.parse(
      await readFile(
        path.join(process.cwd(), "src-tauri", "tauri.conf.json"),
        "utf8",
      ),
    );

    expectMainWindowMaximized(baseConfig);
    expectMainWindowMaximized(buildTauriConfigForCi(baseConfig, "macos"));
    expectMainWindowMaximized(buildTauriConfigForCi(baseConfig, "windows"));
  });

  it("keeps the Linux main window override maximized", async () => {
    const linuxConfig = JSON.parse(
      await readFile(
        path.join(process.cwd(), "src-tauri", "tauri.linux.conf.json"),
        "utf8",
      ),
    );

    expectMainWindowMaximized(linuxConfig);
  });

  it("keeps the app version while deriving a Windows MSI version", () => {
    const baseConfig = {
      version: "0.0.2-RC.1",
      bundle: {},
    };

    const result = buildTauriConfigForWindowsMsi(baseConfig);

    expect(result.version).toBe("0.0.2-RC.1");
    expect(result.bundle.windows.wix.version).toBe("0.0.2.1");
  });

  it("keeps the app version while deriving macOS bundle metadata", () => {
    const baseConfig = {
      version: "0.0.2-RC.1+1",
      bundle: {},
    };

    const result = buildTauriConfigForMacBundles(baseConfig, {
      infoPlistPath: "/tmp/tauri.macos.ci.Info.plist",
      runNumber: "120",
      runAttempt: "2",
    });

    expect(result.version).toBe("0.0.2-RC.1+1");
    expect(result.bundle.macOS.bundleVersion).toBe("120.2");
    expect(result.bundle.macOS.infoPlist).toBe(
      "/tmp/tauri.macos.ci.Info.plist",
    );
  });

  it("falls back to the core release version for macOS bundleVersion outside CI", () => {
    const baseConfig = {
      version: "0.0.2-RC.1",
      bundle: {},
    };

    const result = buildTauriConfigForMacBundles(baseConfig);

    expect(result.bundle.macOS.bundleVersion).toBe("0.0.2");
  });

  it("rejects unsupported CI platforms", () => {
    expect(() =>
      buildTauriConfigForCi({ version: "0.0.2", bundle: {} }, "linux"),
    ).toThrow(/Unsupported CI config platform/);
  });
});
