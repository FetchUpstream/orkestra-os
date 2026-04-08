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
import RepositoryPathPicker from "./RepositoryPathPicker";

describe("RepositoryPathPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects a result with the keyboard", async () => {
    const searchDirectories = vi.fn().mockResolvedValue([
      {
        path: "/Users/test/code/orkestra-os",
        directoryName: "orkestra-os",
        parentPath: "/Users/test/code",
      },
      {
        path: "/Users/test/workspace/orkestra-os",
        directoryName: "orkestra-os",
        parentPath: "/Users/test/workspace",
      },
    ]);

    const TestHarness = () => {
      const [value, setValue] = createSignal("");
      return (
        <RepositoryPathPicker
          value={value()}
          ariaLabel="Repository path"
          onInput={setValue}
          searchDirectories={searchDirectories}
        />
      );
    };

    render(() => <TestHarness />);
    const input = screen.getByRole("textbox", { name: "Repository path" });

    fireEvent.focusIn(input);
    fireEvent.input(input, { target: { value: "orkestra-os" } });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() =>
      expect(searchDirectories).toHaveBeenCalledWith("orkestra-os", 24),
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe(
        "/Users/test/workspace/orkestra-os",
      );
    });
  });

  it("selects a result with the mouse", async () => {
    const searchDirectories = vi.fn().mockResolvedValue([
      {
        path: "/Users/test/code/orkestra-os",
        directoryName: "orkestra-os",
        parentPath: "/Users/test/code",
      },
    ]);

    const TestHarness = () => {
      const [value, setValue] = createSignal("");
      return (
        <RepositoryPathPicker
          value={value()}
          ariaLabel="Repository path"
          onInput={setValue}
          searchDirectories={searchDirectories}
        />
      );
    };

    render(() => <TestHarness />);
    const input = screen.getByRole("textbox", { name: "Repository path" });

    fireEvent.focusIn(input);
    fireEvent.input(input, { target: { value: "orkestra-os" } });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() =>
      expect(searchDirectories).toHaveBeenCalledWith("orkestra-os", 24),
    );

    const option = screen.getByRole("option", { name: /orkestra-os/i });
    fireEvent.mouseDown(option);

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe(
        "/Users/test/code/orkestra-os",
      );
    });
  });
});
