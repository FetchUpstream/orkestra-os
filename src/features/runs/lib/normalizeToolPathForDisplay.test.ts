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
  normalizeToolOutputTextForDisplay,
  normalizeToolPathForDisplay,
} from "./normalizeToolPathForDisplay";

describe("normalizeToolPathForDisplay", () => {
  it("returns repo-relative display path for worktree-local absolute paths", () => {
    const normalized = normalizeToolPathForDisplay(
      "/tmp/worktrees/wt-123/src/features/runs/components/NewRunChatWorkspace.tsx",
      {
        worktreeId: "wt-123",
        targetRepositoryPath: "/tmp/worktrees/wt-123",
      },
    );

    expect(normalized).toBe(
      "./src/features/runs/components/NewRunChatWorkspace.tsx",
    );
  });

  it("keeps outside-worktree absolute path unchanged", () => {
    const outsidePath = "/etc/hosts";

    const normalized = normalizeToolPathForDisplay(outsidePath, {
      worktreeId: "wt-123",
      targetRepositoryPath: "/tmp/worktrees/wt-123",
    });

    expect(normalized).toBe(outsidePath);
  });

  it("does not ellipsize long paths during normalization", () => {
    const longPath =
      "/tmp/worktrees/wt-123/src/features/runs/components/some/deeply/nested/path/with/a/very/long/file/name/that/should/remain/intact/in/the/tool/rail/output/without/truncation.ts";

    const normalized = normalizeToolPathForDisplay(longPath, {
      worktreeId: "wt-123",
      targetRepositoryPath: "/tmp/worktrees/wt-123",
    });

    expect(normalized.includes("...")).toBe(false);
    expect(normalized).toContain(
      "./src/features/runs/components/some/deeply/nested/path/with/a/very/long/file/name",
    );
  });

  it("prefixes repo root matches with dot slash", () => {
    const normalized = normalizeToolPathForDisplay("/repo/src/app.ts", {
      targetRepositoryPath: "/repo",
      worktreeId: null,
    });

    expect(normalized).toBe("./src/app.ts");
  });

  it("keeps absolute paths unchanged when worktree id is not under a worktrees root", () => {
    const outsidePath = "/var/tmp/wt-123/log.txt";

    const normalized = normalizeToolPathForDisplay(outsidePath, {
      worktreeId: "wt-123",
      targetRepositoryPath: null,
    });

    expect(normalized).toBe(outsidePath);
  });

  it("normalizes read tool output path tags for display", () => {
    const output = [
      "<path>/repo/src-tauri/src/app/runs/merge_service.rs</path>",
      "<type>file</type>",
    ].join("\n");

    const normalized = normalizeToolOutputTextForDisplay(output, {
      targetRepositoryPath: "/repo",
      worktreeId: null,
    });

    expect(normalized).toContain(
      "<path>./src-tauri/src/app/runs/merge_service.rs</path>",
    );
  });

  it("keeps non-worktree path tags absolute in tool output", () => {
    const output = "<path>/etc/hosts</path>";

    const normalized = normalizeToolOutputTextForDisplay(output, {
      targetRepositoryPath: "/repo",
      worktreeId: "wt-123",
    });

    expect(normalized).toBe(output);
  });

  it("strips absolute worktree prefixes from plain rendered text", () => {
    const output =
      "-> Read /home/louis/.local/share/com.fetchupstream.orkestraos/worktrees/ORK/resolve-sibling-runs-when-one-run-is-merged-or-when-the-task-is-manually-marked-done/src-tauri/src/app/runs/merge_service.rs";

    const normalized = normalizeToolOutputTextForDisplay(output, {
      worktreeId:
        "ORK/resolve-sibling-runs-when-one-run-is-merged-or-when-the-task-is-manually-marked-done",
      targetRepositoryPath: null,
    });

    expect(normalized).toBe(
      "-> Read ./src-tauri/src/app/runs/merge_service.rs",
    );
  });

  it("shows the worktree root as a relative path", () => {
    const normalized = normalizeToolPathForDisplay(
      "/home/louis/.local/share/com.fetchupstream.orkestraos/worktrees/ORK/feature-branch",
      {
        worktreeId: "ORK/feature-branch",
        targetRepositoryPath: null,
      },
    );

    expect(normalized).toBe("./");
  });

  it("normalizes Windows worktree paths in plain rendered text", () => {
    const output =
      "Read C:\\Users\\louis\\AppData\\Local\\orkestraos\\worktrees\\ORK\\feature-branch\\src\\main.ts";

    const normalized = normalizeToolOutputTextForDisplay(output, {
      worktreeId: "ORK/feature-branch",
      targetRepositoryPath: null,
    });

    expect(normalized).toBe("Read ./src/main.ts");
  });

  it("does not rewrite URLs that happen to contain worktree-like segments", () => {
    const output =
      "Docs: https://example.com/worktrees/ORK/feature-branch/src/main.ts";

    const normalized = normalizeToolOutputTextForDisplay(output, {
      worktreeId: "ORK/feature-branch",
      targetRepositoryPath: null,
    });

    expect(normalized).toBe(output);
  });

  it("resolves absolute paths using multi-segment worktree ids", () => {
    const normalized = normalizeToolPathForDisplay(
      "/home/louis/.local/share/com.fetchupstream.orkestraos/worktrees/ORK/resolve-sibling-runs-when-one-run-is-merged-or-when-the-task-is-manually-marked-done/src-tauri/src/app/runs/merge_service.rs",
      {
        worktreeId:
          "ORK/resolve-sibling-runs-when-one-run-is-merged-or-when-the-task-is-manually-marked-done",
        targetRepositoryPath: null,
      },
    );

    expect(normalized).toBe("./src-tauri/src/app/runs/merge_service.rs");
  });
});
