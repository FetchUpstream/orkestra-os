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

  it("restarts search when editing after selection", async () => {
    const searchDirectories = vi
      .fn()
      .mockResolvedValueOnce([
        {
          path: "/Users/test/code/orkestra-os",
          directoryName: "orkestra-os",
          parentPath: "/Users/test/code",
        },
      ])
      .mockResolvedValue([
        {
          path: "/Users/test/code/orkestra",
          directoryName: "orkestra",
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

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe(
        "/Users/test/code/orkestra-os",
      );
    });

    fireEvent.input(input, { target: { value: "/Users/test/code/orkestra" } });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() =>
      expect(searchDirectories).toHaveBeenLastCalledWith(
        "/Users/test/code/orkestra",
        24,
      ),
    );
  });

  it("closes the first dropdown when focus moves to a second picker", async () => {
    const searchDirectories = vi.fn().mockResolvedValue([]);

    const TestHarness = () => {
      const [firstValue, setFirstValue] = createSignal("");
      const [secondValue, setSecondValue] = createSignal("");

      return (
        <>
          <RepositoryPathPicker
            value={firstValue()}
            ariaLabel="First repository path"
            onInput={setFirstValue}
            searchDirectories={searchDirectories}
          />
          <RepositoryPathPicker
            value={secondValue()}
            ariaLabel="Second repository path"
            onInput={setSecondValue}
            searchDirectories={searchDirectories}
          />
        </>
      );
    };

    render(() => <TestHarness />);

    const firstInput = screen.getByRole("textbox", {
      name: "First repository path",
    });
    const secondInput = screen.getByRole("textbox", {
      name: "Second repository path",
    });

    fireEvent.focusIn(firstInput);
    expect(firstInput.getAttribute("aria-expanded")).toBe("true");

    fireEvent.focusOut(firstInput, { relatedTarget: secondInput });
    fireEvent.focusIn(secondInput);
    await Promise.resolve();

    expect(firstInput.getAttribute("aria-expanded")).toBe("false");
    expect(secondInput.getAttribute("aria-expanded")).toBe("true");
  });
});
