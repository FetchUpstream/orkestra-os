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

import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  type Component,
  type JSX,
} from "solid-js";

type PastedBlock = {
  text: string;
  lineCount: number;
};

type RunChatComposerProps = {
  value: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  submitting?: boolean;
  placeholder?: string;
  submitLabel?: string;
  textareaLabel?: string;
  minRows?: number;
  maxRows?: number;
  class?: string;
};

const pastedTokenPrefix = "run-chat-paste-";

const normalizeLineEndings = (value: string) =>
  value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const countMeaningfulLines = (value: string) => {
  const normalized = normalizeLineEndings(value);
  const withoutSingleTrailingNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;

  if (!withoutSingleTrailingNewline) {
    return 1;
  }

  return withoutSingleTrailingNewline.split("\n").length;
};

const nodeText = (
  node: Node,
  pastedBlocks: Map<string, PastedBlock>,
): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeName === "BR") {
    return "\n";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const pasteId = node.dataset.pasteId;
  if (pasteId) {
    return pastedBlocks.get(pasteId)?.text ?? "";
  }

  let text = "";
  node.childNodes.forEach((child) => {
    text += nodeText(child, pastedBlocks);
  });

  if (node.tagName === "DIV" || node.tagName === "P") {
    text += "\n";
  }

  return text;
};

const serializeComposer = (
  editor: HTMLElement | undefined,
  pastedBlocks: Map<string, PastedBlock>,
) => {
  if (!editor) return "";

  let text = "";
  editor.childNodes.forEach((child) => {
    text += nodeText(child, pastedBlocks);
  });

  return text;
};

const insertNodesAtSelection = (editor: HTMLElement, nodes: Node[]) => {
  const selection = window.getSelection();
  if (!selection) return;

  let range: Range;
  if (selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  } else {
    range = selection.getRangeAt(0);
  }

  range.deleteContents();

  const fragment = document.createDocumentFragment();
  nodes.forEach((node) => fragment.append(node));
  range.insertNode(fragment);

  const nextRange = document.createRange();
  const lastNode = nodes.at(-1);
  if (lastNode) {
    nextRange.setStartAfter(lastNode);
  } else {
    nextRange.selectNodeContents(editor);
    nextRange.collapse(false);
  }
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
};

const createPastedToken = (id: string, lineCount: number) => {
  const token = document.createElement("span");
  token.className = "run-chat-composer__paste-token";
  token.contentEditable = "false";
  token.dataset.pasteId = id;
  token.textContent = `[Pasted ${lineCount} Lines]`;
  token.setAttribute("role", "img");
  token.setAttribute("aria-label", `Pasted ${lineCount} Lines`);
  return token;
};

const textToNodes = (text: string): Node[] => {
  const normalized = normalizeLineEndings(text);
  const nodes: Node[] = [];
  const lines = normalized.split("\n");

  lines.forEach((line, index) => {
    if (index > 0) {
      nodes.push(document.createElement("br"));
    }
    if (line) {
      nodes.push(document.createTextNode(line));
    }
  });

  return nodes;
};

const RunChatComposer: Component<RunChatComposerProps> = (props) => {
  let editorRef: HTMLDivElement | undefined;
  const pastedBlocks = new Map<string, PastedBlock>();
  let pastedBlockIndex = 0;
  const [currentValue, setCurrentValue] = createSignal(props.value);
  const [isComposing, setIsComposing] = createSignal(false);
  const editorId = createUniqueId();
  const labelId = `${editorId}-label`;

  const minRows = () => props.minRows ?? 1;
  const maxRows = () => props.maxRows ?? 8;

  const replaceEditorText = (value: string) => {
    if (!editorRef) return;
    pastedBlocks.clear();
    editorRef.replaceChildren(...textToNodes(value));
  };

  const syncValueFromEditor = () => {
    const value = serializeComposer(editorRef, pastedBlocks);
    setCurrentValue(value);
    props.onInput(value);
  };

  const installTextareaLikeEditorProperties = (editor: HTMLDivElement) => {
    if (Object.prototype.hasOwnProperty.call(editor, "value")) return;

    Object.defineProperties(editor, {
      value: {
        configurable: true,
        get: () => serializeComposer(editor, pastedBlocks),
        set: (value: string) => {
          pastedBlocks.clear();
          editor.replaceChildren(...textToNodes(String(value)));
        },
      },
      disabled: {
        configurable: true,
        get: () => Boolean(props.disabled || props.submitting),
      },
    });
  };

  const setEditorRef = (editor: HTMLDivElement) => {
    editorRef = editor;
    installTextareaLikeEditorProperties(editor);
  };

  const resizeEditor = () => {
    if (!editorRef) return;
    const styles = getComputedStyle(editorRef);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const borderHeight =
      Number.parseFloat(styles.borderTopWidth) +
      Number.parseFloat(styles.borderBottomWidth);
    const minHeight = lineHeight * minRows() + borderHeight;
    const maxHeight = lineHeight * maxRows() + borderHeight;

    editorRef.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(editorRef.scrollHeight, minHeight),
      maxHeight,
    );
    editorRef.style.height = `${nextHeight}px`;
    editorRef.style.overflowY =
      editorRef.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  createEffect(on(currentValue, resizeEditor));

  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!editorRef) return;
        const editorValue = serializeComposer(editorRef, pastedBlocks);
        if (value === editorValue && value === currentValue()) return;
        replaceEditorText(value);
        setCurrentValue(value);
        resizeEditor();
      },
    ),
  );

  createEffect(() => {
    if (!editorRef) return;
    if (props.disabled || props.submitting) {
      editorRef.setAttribute("disabled", "");
    } else {
      editorRef.removeAttribute("disabled");
    }
  });

  const submit = () => {
    const value = serializeComposer(editorRef, pastedBlocks).trim();
    if (!value || props.disabled || props.submitting) return;
    props.onSubmit(value);
  };

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key !== "Enter") return;
    if (isComposing() || event.isComposing) return;

    event.preventDefault();

    if (event.shiftKey) {
      if (!editorRef) return;
      insertNodesAtSelection(editorRef, [document.createElement("br")]);
      syncValueFromEditor();
      return;
    }

    submit();
  };

  const onPaste: JSX.EventHandler<HTMLDivElement, ClipboardEvent> = (event) => {
    const pastedText = event.clipboardData?.getData("text/plain") ?? "";
    if (!pastedText || !editorRef) return;

    event.preventDefault();
    const lineCount = countMeaningfulLines(pastedText);

    if (lineCount < 2) {
      insertNodesAtSelection(editorRef, textToNodes(pastedText));
      syncValueFromEditor();
      return;
    }

    pastedBlockIndex += 1;
    const id = `${pastedTokenPrefix}${pastedBlockIndex}`;
    pastedBlocks.set(id, { text: pastedText, lineCount });
    insertNodesAtSelection(editorRef, [createPastedToken(id, lineCount)]);
    syncValueFromEditor();
  };

  return (
    <form
      class={`run-chat-composer ${props.class ?? ""}`.trim()}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-label="Chat composer"
    >
      <label id={labelId} class="run-chat-composer__label sr-only">
        {props.textareaLabel ?? "Message"}
      </label>
      <div
        id={editorId}
        ref={setEditorRef}
        class="run-chat-composer__textarea run-chat-composer__rich-input"
        role="textbox"
        contentEditable={!props.disabled && !props.submitting}
        aria-disabled={props.disabled || props.submitting ? "true" : undefined}
        aria-labelledby={labelId}
        aria-multiline="true"
        data-placeholder={props.placeholder ?? "Ask anything"}
        onInput={syncValueFromEditor}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
      />
      <button
        type="submit"
        class="run-chat-composer__button"
        disabled={
          props.disabled ||
          props.submitting ||
          currentValue().trim().length === 0
        }
        aria-label={props.submitLabel ?? "Send message"}
      >
        {props.submitting ? "Sending..." : (props.submitLabel ?? "Send")}
      </button>
    </form>
  );
};

export default RunChatComposer;
