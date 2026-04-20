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

import { describe, expect, it } from "vitest";
import {
  buildTauriConfigForCi,
  buildTauriConfigForLinuxBundles,
  buildTauriConfigForMacBundles,
  buildTauriConfigForWindowsMsi,
} from "./tauri-config.mjs";

describe("tauri-config CI helpers", () => {
  it("rewrites Linux prerelease bundle versions to package-safe syntax", () => {
    const baseConfig = {
      version: "0.0.2-RC.1",
      bundle: {},
    };

    const result = buildTauriConfigForLinuxBundles(baseConfig);

    expect(result.version).toBe("0.0.2~RC.1");
    expect(baseConfig.version).toBe("0.0.2-RC.1");
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
      buildTauriConfigForCi({ version: "0.0.2", bundle: {} }, "android"),
    ).toThrow(/Unsupported CI config platform/);
  });
});
