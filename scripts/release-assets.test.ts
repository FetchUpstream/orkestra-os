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

import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTauriAssetNamePattern,
  normalizeFilenameSegment,
  normalizeLinuxPackageFileNames,
} from "./release-assets.mjs";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
  tempRoots.length = 0;
});

async function makeTempRoot() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "orkestra-release-assets-"),
  );
  tempRoots.push(root);
  return root;
}

describe("release asset naming", () => {
  it("normalizes filename segments to lowercase without spaces", () => {
    expect(normalizeFilenameSegment("Orkestra OS 0.0.2-RC.1+Build 7")).toBe(
      "orkestra-os-0.0.2-rc.1-build-7",
    );
  });

  it("builds the Tauri action upload pattern without a v prefix", () => {
    expect(
      buildTauriAssetNamePattern({
        productName: "Orkestra OS",
        version: "0.0.2",
      }),
    ).toBe("orkestra-os-0.0.2-[arch][setup][ext]");
  });

  it("normalizes Linux deb package filenames and signatures", async () => {
    const root = await makeTempRoot();
    const debDir = path.join(root, "bundle", "deb");
    await mkdir(debDir, { recursive: true });
    await writeFile(path.join(debDir, ".keep"), "");
    await writeFile(
      path.join(debDir, "Orkestra OS_0.0.2-RC.1_amd64.deb"),
      "deb",
    );
    await writeFile(
      path.join(debDir, "Orkestra OS_0.0.2-RC.1_amd64.deb.sig"),
      "sig",
    );

    const renamed = await normalizeLinuxPackageFileNames({
      bundleRoot: path.join(root, "bundle"),
      tauriConfig: {
        productName: "Orkestra OS",
        version: "0.0.2-RC.1",
      },
    });

    expect(renamed).toHaveLength(2);
    await expect(
      readdir(debDir).then((entries) => entries.sort()),
    ).resolves.toEqual([
      ".keep",
      "orkestra-os-0.0.2-rc.1-amd64.deb",
      "orkestra-os-0.0.2-rc.1-amd64.deb.sig",
    ]);
  });
});
