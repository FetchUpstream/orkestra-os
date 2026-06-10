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

import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import RunChatComposer from "./RunChatComposer";

const paste = (element: HTMLElement, text: string) => {
  fireEvent.paste(element, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
};

const placeCaretAtEnd = (element: HTMLElement) => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const typeText = (element: HTMLElement, text: string) => {
  element.append(document.createTextNode(text));
  placeCaretAtEnd(element);
  fireEvent.input(element);
};

const renderComposer = (onSubmit = vi.fn()) => {
  const Harness = () => {
    const [value, setValue] = createSignal("");
    return (
      <RunChatComposer
        value={value()}
        onInput={setValue}
        onSubmit={onSubmit}
        textareaLabel="Message agent"
      />
    );
  };

  render(() => <Harness />);
  return screen.getByRole("textbox", { name: "Message agent" });
};

describe("RunChatComposer", () => {
  it("renders an initial controlled value in the rich editor", () => {
    const onSubmit = vi.fn();
    const Harness = () => {
      const [value, setValue] = createSignal("Restored draft");
      return (
        <RunChatComposer
          value={value()}
          onInput={setValue}
          onSubmit={onSubmit}
          textareaLabel="Message agent"
        />
      );
    };
    render(() => <Harness />);
    const editor = screen.getByRole("textbox", { name: "Message agent" });

    expect(editor.textContent).toBe("Restored draft");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Restored draft");
  });

  it("updates the rich editor when the controlled value changes", () => {
    const onSubmit = vi.fn();
    const Harness = () => {
      const [value, setValue] = createSignal("");
      return (
        <>
          <button type="button" onClick={() => setValue("Programmatic draft")}>
            Restore draft
          </button>
          <RunChatComposer
            value={value()}
            onInput={setValue}
            onSubmit={onSubmit}
            textareaLabel="Message agent"
          />
        </>
      );
    };
    render(() => <Harness />);
    const editor = screen.getByRole("textbox", { name: "Message agent" });

    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));

    expect(editor.textContent).toBe("Programmatic draft");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith("Programmatic draft");
  });

  it("inserts a newline without submitting on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    typeText(editor, "first line");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });

    expect(editor.querySelector("br")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("inserts a one-line paste as normal text", () => {
    const editor = renderComposer();

    paste(editor, "hello");

    expect(editor.textContent).toBe("hello");
    expect(screen.queryByText("[Pasted 1 Lines]")).toBeNull();
  });


  it("prevents native paste when clipboard plain text is empty", () => {
    const editor = renderComposer();
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { getData: () => "" },
    });
    const preventDefault = vi.spyOn(pasteEvent, "preventDefault");

    editor.dispatchEvent(pasteEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(editor.childNodes).toHaveLength(0);
  });

  it("renders a two-line paste as a compact pasted-lines token", () => {
    const editor = renderComposer();

    paste(editor, "hello\nworld");

    expect(screen.getByText("[Pasted 2 Lines]")).toBeTruthy();
    expect(editor.textContent).toBe("[Pasted 2 Lines]");
  });

  it("renders a three-line paste as a compact pasted-lines token", () => {
    const editor = renderComposer();

    paste(editor, "a\nb\nc");

    expect(screen.getByText("[Pasted 3 Lines]")).toBeTruthy();
  });

  it("sends the original multi-line paste content", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    paste(editor, "hello\nworld");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("hello\nworld");
  });

  it("preserves typed text before and after a paste token in send order", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    typeText(editor, "Please review this:\n");
    paste(editor, "a\nb\nc");
    typeText(editor, "\nFocus on validation.");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Please review this:\na\nb\nc\nFocus on validation.",
    );
  });

  it("serializes multiple paste tokens correctly", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    paste(editor, "a\nb");
    typeText(editor, " between ");
    paste(editor, "c\nd\ne");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("a\nb between c\nd\ne");
  });

  it("removes pasted content from the outgoing message when its token is deleted", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    typeText(editor, "before ");
    paste(editor, "a\nb");
    typeText(editor, " after");
    screen.getByText("[Pasted 2 Lines]").remove();
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("before  after");
  });


  it("prunes deleted pasted content from token state", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    typeText(editor, "before ");
    paste(editor, "sensitive\ncontent");
    const token = screen.getByText("[Pasted 2 Lines]");
    const pasteId = token.dataset.pasteId;
    token.remove();
    fireEvent.input(editor);
    typeText(editor, " after");
    const staleToken = document.createElement("span");
    if (pasteId) staleToken.dataset.pasteId = pasteId;
    staleToken.textContent = "[Pasted 2 Lines]";
    editor.append(staleToken);
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("before  after");
  });

  it("clears pasted token state after a successful send clears the value", () => {
    const onSubmit = vi.fn();
    const Harness = () => {
      const [value, setValue] = createSignal("");
      return (
        <RunChatComposer
          value={value()}
          onInput={setValue}
          onSubmit={(message) => {
            onSubmit(message);
            setValue("");
          }}
          textareaLabel="Message agent"
        />
      );
    };
    render(() => <Harness />);
    const editor = screen.getByRole("textbox", { name: "Message agent" });

    paste(editor, "a\nb");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("a\nb");
    expect(editor.textContent).toBe("");
    expect(screen.queryByText("[Pasted 2 Lines]")).toBeNull();
  });

  it("preserves composer state when submit does not clear the value", () => {
    const onSubmit = vi.fn();
    const editor = renderComposer(onSubmit);

    paste(editor, "a\nb");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(screen.getByText("[Pasted 2 Lines]")).toBeTruthy();
  });
});
