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

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEffect, onCleanup, type Component } from "solid-js";

type TaskMarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
};

const TaskMarkdownEditor: Component<TaskMarkdownEditorProps> = (props) => {
  let rootRef: HTMLDivElement | null = null;
  let editorView: EditorView | null = null;
  let isApplyingExternalValue = false;
  let lastDisabled = Boolean(props.disabled);
  let lastAriaLabel = props.ariaLabel || "Task description";

  const destroyEditor = () => {
    if (!editorView) return;
    editorView.destroy();
    editorView = null;
  };

  const mountEditor = (value: string) => {
    if (!rootRef) return;
    destroyEditor();

    const ariaLabel = props.ariaLabel || "Task description";
    const state = EditorState.create({
      doc: value,
      extensions: [
        markdown(),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-content": {
            minHeight: "180px",
            padding: "12px",
            fontSize: "0.9rem",
            lineHeight: "1.55",
          },
          ".cm-scroller": {
            fontFamily: "inherit",
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isApplyingExternalValue) return;
          props.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: () => {
            props.onBlur?.();
            return false;
          },
        }),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          role: "textbox",
          "aria-multiline": "true",
        }),
        EditorView.editable.of(!props.disabled),
      ],
    });

    editorView = new EditorView({
      state,
      parent: rootRef,
    });
  };

  createEffect(() => {
    const nextValue = props.value;
    const nextAriaLabel = props.ariaLabel || "Task description";
    const nextDisabled = Boolean(props.disabled);

    if (!editorView) {
      mountEditor(nextValue);
      lastDisabled = nextDisabled;
      lastAriaLabel = nextAriaLabel;
      return;
    }

    if (nextDisabled !== lastDisabled || nextAriaLabel !== lastAriaLabel) {
      mountEditor(editorView.state.doc.toString());
      lastDisabled = nextDisabled;
      lastAriaLabel = nextAriaLabel;
      return;
    }

    const currentValue = editorView.state.doc.toString();
    if (nextValue !== currentValue) {
      isApplyingExternalValue = true;
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: nextValue,
        },
      });
      isApplyingExternalValue = false;
    }
  });

  onCleanup(() => {
    destroyEditor();
  });

  return (
    <div
      class="task-markdown-editor"
      ref={(element) => {
        rootRef = element;
      }}
    />
  );
};

export default TaskMarkdownEditor;
