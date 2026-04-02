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

import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import CodeMirrorDiffEditor, {
  shouldSubmitInlineReviewComposer,
} from "./CodeMirrorDiffEditor";

const {
  mergeViewConstructor,
  unifiedMergeViewMock,
  editorViewConstructor,
  modifiedEditorDispatchMock,
  decorationsFromMock,
  lineNumbersMock,
  editableOfMock,
  readOnlyOfMock,
  gutterMock,
  stateEffectDefineMock,
  stateFieldDefineMock,
  resolveLanguageExtensionMock,
} = vi.hoisted(() => {
  const modifiedEditorDispatchMock = vi.fn();
  const mergeViewConstructor = vi.fn(function MockMergeView(config: {
    b?: { doc?: string };
  }) {
    const modifiedDoc = config.b?.doc ?? "";
    const lines = modifiedDoc.length === 0 ? [""] : modifiedDoc.split("\n");
    return {
      destroy: vi.fn(),
      chunks: [{ fromB: 0, toB: Math.max(1, modifiedDoc.length) }],
      b: {
        dispatch: modifiedEditorDispatchMock,
        state: {
          doc: {
            lines: lines.length,
            length: modifiedDoc.length,
            lineAt: (position: number) => {
              const safe = Math.max(0, Math.min(position, modifiedDoc.length));
              let consumed = 0;
              for (let index = 0; index < lines.length; index += 1) {
                const lineText = lines[index] ?? "";
                const lineLength = lineText.length;
                const boundary = consumed + lineLength;
                if (safe <= boundary || index === lines.length - 1) {
                  return {
                    number: index + 1,
                    from: consumed,
                    to: boundary,
                    text: lineText,
                  };
                }
                consumed = boundary + 1;
              }
              return { number: 1, from: 0, to: 0, text: "" };
            },
            line: (lineNumber: number) => {
              const safeLine = Math.max(1, Math.min(lineNumber, lines.length));
              const text = lines[safeLine - 1] ?? "";
              return { number: safeLine, from: 0, to: text.length, text };
            },
          },
        },
      },
    };
  });
  const unifiedMergeViewMock = vi.fn(() => ({ extension: "unified" }));
  const editorViewConstructor = vi.fn(function MockEditorView() {
    return { destroy: vi.fn() };
  });
  const decorationsFromMock = vi.fn(() => ({ extension: "decorations" }));
  const lineNumbersMock = vi.fn(() => ({ extension: "lineNumbers" }));
  const editableOfMock = vi.fn(() => ({ extension: "editable" }));
  const readOnlyOfMock = vi.fn(() => ({ extension: "readonly" }));
  const gutterMock = vi.fn(() => ({ extension: "gutter" }));
  const stateEffectDefineMock = vi.fn(() => ({
    of: vi.fn((value: unknown) => ({ value })),
    is: vi.fn(() => false),
  }));
  const stateFieldDefineMock = vi.fn((config: unknown) => config);
  const resolveLanguageExtensionMock = vi.fn<
    (input: {
      language?: string;
      filePath?: string;
    }) => { extension: string } | null
  >(() => ({ extension: "language" }));

  return {
    mergeViewConstructor,
    unifiedMergeViewMock,
    editorViewConstructor,
    modifiedEditorDispatchMock,
    decorationsFromMock,
    lineNumbersMock,
    editableOfMock,
    readOnlyOfMock,
    gutterMock,
    stateEffectDefineMock,
    stateFieldDefineMock,
    resolveLanguageExtensionMock,
  };
});

vi.mock("@codemirror/merge", () => ({
  MergeView: mergeViewConstructor,
  unifiedMergeView: unifiedMergeViewMock,
}));

vi.mock("@codemirror/view", () => ({
  Decoration: {
    none: { extension: "none" },
    line: vi.fn(() => ({ extension: "line" })),
    widget: vi.fn(() => ({ extension: "widget" })),
  },
  GutterMarker: class {},
  WidgetType: class {},
  gutter: gutterMock,
  EditorView: Object.assign(editorViewConstructor, {
    lineWrapping: { extension: "lineWrapping" },
    editable: {
      of: editableOfMock,
    },
    decorations: {
      from: decorationsFromMock,
    },
  }),
  lineNumbers: lineNumbersMock,
}));

vi.mock("@codemirror/state", () => ({
  RangeSetBuilder: class {
    add() {
      return undefined;
    }

    finish() {
      return { extension: "ranges" };
    }
  },
  StateEffect: {
    define: stateEffectDefineMock,
  },
  StateField: {
    define: stateFieldDefineMock,
  },
  EditorState: {
    readOnly: {
      of: readOnlyOfMock,
    },
  },
}));

vi.mock("@codemirror/theme-one-dark", () => ({
  oneDark: { extension: "oneDark" },
}));

vi.mock("./codemirrorLanguages", () => ({
  resolveCodeMirrorLanguageExtension: resolveLanguageExtensionMock,
}));

describe("CodeMirrorDiffEditor", () => {
  beforeEach(() => {
    mergeViewConstructor.mockClear();
    unifiedMergeViewMock.mockClear();
    editorViewConstructor.mockClear();
    modifiedEditorDispatchMock.mockClear();
    decorationsFromMock.mockClear();
    lineNumbersMock.mockClear();
    editableOfMock.mockClear();
    readOnlyOfMock.mockClear();
    gutterMock.mockClear();
    stateEffectDefineMock.mockClear();
    stateFieldDefineMock.mockClear();
    resolveLanguageExtensionMock.mockReset();
    resolveLanguageExtensionMock.mockReturnValue({ extension: "language" });
  });

  it("renders side-by-side diffs with MergeView", async () => {
    render(() => (
      <CodeMirrorDiffEditor
        original="const before = 1;"
        modified="const after = 2;"
        language="typescript"
        filePath="src/demo.ts"
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });
    expect(editorViewConstructor).not.toHaveBeenCalled();
    expect(resolveLanguageExtensionMock).toHaveBeenCalledWith({
      language: "typescript",
      filePath: "src/demo.ts",
    });
    expect(lineNumbersMock).toHaveBeenCalled();
    expect(editableOfMock).toHaveBeenCalledWith(false);
    expect(readOnlyOfMock).toHaveBeenCalledWith(true);
    expect(mergeViewConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        collapseUnchanged: {
          margin: 3,
          minSize: 4,
        },
      }),
    );

    const mergeViewCalls = mergeViewConstructor.mock.calls as unknown[][];
    const mergeViewConfig = mergeViewCalls[0]?.[0] as {
      a: { extensions: unknown[] };
    };
    expect(mergeViewConfig.a.extensions).toContainEqual({
      extension: "language",
    });
  });

  it("renders unified diffs with unifiedMergeView", async () => {
    render(() => (
      <CodeMirrorDiffEditor
        original="const before = 1;"
        modified="const after = 2;"
        language="typescript"
        renderSideBySide={false}
      />
    ));

    await waitFor(() => {
      expect(editorViewConstructor).toHaveBeenCalledTimes(1);
    });
    expect(unifiedMergeViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "const before = 1;",
        gutter: true,
        mergeControls: false,
        collapseUnchanged: {
          margin: 3,
          minSize: 4,
        },
      }),
    );
    expect(mergeViewConstructor).not.toHaveBeenCalled();
    expect(lineNumbersMock).toHaveBeenCalled();
    expect(editableOfMock).toHaveBeenCalledWith(false);
    expect(readOnlyOfMock).toHaveBeenCalledWith(true);
  });

  it("stays stable when language resolver returns null", async () => {
    resolveLanguageExtensionMock.mockImplementation(() => null);

    render(() => (
      <CodeMirrorDiffEditor
        original="before"
        modified="after"
        language="unknown-lang"
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });

    const mergeViewCalls = mergeViewConstructor.mock.calls as unknown[][];
    const mergeViewConfig = mergeViewCalls[0]?.[0] as {
      a: { extensions: unknown[] };
    };
    expect(mergeViewConfig.a.extensions).not.toContainEqual({
      extension: "language",
    });
  });

  it("uses natural height for smaller diffs", async () => {
    const { container } = render(() => (
      <CodeMirrorDiffEditor
        original="before"
        modified="after"
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });

    const root = container.querySelector(".run-detail-codemirror-root");
    expect(
      root?.classList.contains("run-detail-codemirror-root--bounded"),
    ).toBe(false);
  });

  it("uses bounded height for very large diffs", async () => {
    const veryLargeDiff = `${"line\n".repeat(1_400)}final`;
    const { container } = render(() => (
      <CodeMirrorDiffEditor
        original="before"
        modified={veryLargeDiff}
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });

    const root = container.querySelector(".run-detail-codemirror-root");
    expect(
      root?.classList.contains("run-detail-codemirror-root--bounded"),
    ).toBe(true);
  });

  it("does not recreate merge editor when draft comments update", async () => {
    const [draftComments, setDraftComments] = createSignal<
      { id: string; line: number; body: string }[]
    >([]);

    render(() => (
      <CodeMirrorDiffEditor
        original="const before = 1;"
        modified="const after = 2;"
        renderSideBySide={true}
        draftComments={draftComments()}
        canCreateDraftComments={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });

    setDraftComments([
      {
        id: "draft-1",
        line: 1,
        body: "Looks good",
      },
    ]);

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });
  });

  it("re-dispatches current review comments after editor recreation", async () => {
    const [modified, setModified] = createSignal("const after = 2;");
    const stableDraftComments = [
      {
        id: "draft-1",
        line: 1,
        body: "Looks good",
      },
    ];

    render(() => (
      <CodeMirrorDiffEditor
        original="const before = 1;"
        modified={modified()}
        renderSideBySide={true}
        draftComments={stableDraftComments}
        canCreateDraftComments={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
      expect(modifiedEditorDispatchMock).toHaveBeenCalled();
    });

    const initialDispatchCount = modifiedEditorDispatchMock.mock.calls.length;

    setModified("const after = 3;\nconst next = 4;");

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(2);
      expect(modifiedEditorDispatchMock.mock.calls.length).toBeGreaterThan(
        initialDispatchCount,
      );
    });
  });

  it("submits inline composer on bare Enter only", () => {
    expect(
      shouldSubmitInlineReviewComposer({
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe(true);

    expect(
      shouldSubmitInlineReviewComposer({
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe(false);

    expect(
      shouldSubmitInlineReviewComposer({
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe(false);

    expect(
      shouldSubmitInlineReviewComposer({
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });
});
