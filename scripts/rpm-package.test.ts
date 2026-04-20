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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveRpmVersionParts,
  parseCargoPackageMetadata,
  renderDesktopEntry,
  renderRpmSpec,
  toKebabCase,
} from "./rpm-package.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rpm-package helpers", () => {
  it("derives stable RPM version parts", () => {
    expect(deriveRpmVersionParts("0.0.2")).toEqual({
      version: "0.0.2",
      release: "1",
    });
  });

  it("includes stable build metadata in the RPM release", () => {
    expect(deriveRpmVersionParts("0.0.2+build.7")).toEqual({
      version: "0.0.2",
      release: "1.build.7",
    });
  });

  it("derives prerelease RPM version parts from semver", () => {
    expect(deriveRpmVersionParts("0.0.2-RC.1+1")).toEqual({
      version: "0.0.2",
      release: "0.RC.1.1",
    });
  });

  it("reads package metadata from the Cargo [package] table only", () => {
    const parseMock = vi.fn().mockReturnValue({
      package: {
        name: "orkestraos",
        description: 'Desktop app for orchestrating "AI" agents.',
        homepage: "https://example.com",
        repository: "https://example.com/repo",
        license: "MIT OR Apache-2.0",
      },
      dependencies: {
        name: "should-not-win",
      },
    });
    vi.stubGlobal("Bun", { TOML: { parse: parseMock } });

    const cargoText = `
[package]
name = "orkestraos"
description = "Desktop app for orchestrating \"AI\" agents."
homepage = "https://example.com"
repository = "https://example.com/repo"
license = "MIT OR Apache-2.0"

[dependencies]
name = "should-not-win"
`;
    const metadata = parseCargoPackageMetadata(cargoText);

    expect(parseMock).toHaveBeenCalledWith(cargoText);
    expect(metadata).toEqual({
      name: "orkestraos",
      description: 'Desktop app for orchestrating "AI" agents.',
      homepage: "https://example.com",
      repository: "https://example.com/repo",
      license: "MIT OR Apache-2.0",
    });
  });

  it("matches the package naming convention used by Tauri deb packaging", () => {
    expect(toKebabCase("Orkestra OS")).toBe("orkestra-os");
  });

  it("renders a freedesktop desktop entry", () => {
    expect(
      renderDesktopEntry({
        categories: "Development;",
        comment: "Desktop app for orchestrating AI agents.",
        binaryName: "orkestraos",
        iconName: "orkestraos",
        displayName: "Orkestra OS",
      }),
    ).toContain("Exec=orkestraos");
  });

  it("renders an RPM spec with the expected files", () => {
    const spec = renderRpmSpec({
      architecture: "x86_64",
      binaryName: "orkestraos",
      description: "Desktop app for orchestrating AI agents.",
      desktopFileName: "orkestra-os.desktop",
      homepage: "https://github.com/FetchUpstream/orkestra-os",
      iconPaths: ["/usr/share/icons/hicolor/128x128/apps/orkestraos.png"],
      license: "MIT OR Apache-2.0",
      packageName: "orkestra-os",
      release: "0.RC.1",
      sourceArchiveName: "orkestra-os-0.0.2-0.RC.1.tar.gz",
      sourceDirectoryName: "orkestra-os-0.0.2-0.RC.1",
      summary: "Desktop app for orchestrating AI agents",
      version: "0.0.2",
    });

    expect(spec).toContain("Name:           orkestra-os");
    expect(spec).toContain("Release:        0.RC.1%{?dist}");
    expect(spec).toContain("/usr/share/applications/orkestra-os.desktop");
    expect(spec).toContain("%attr(0755,root,root) /usr/bin/orkestraos");
  });
});
