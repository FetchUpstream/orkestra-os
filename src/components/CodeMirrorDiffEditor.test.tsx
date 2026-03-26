import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import CodeMirrorDiffEditor from "./CodeMirrorDiffEditor";

const {
  mergeViewConstructor,
  unifiedMergeViewMock,
  editorViewConstructor,
  decorationsFromMock,
  lineNumbersMock,
  editableOfMock,
  readOnlyOfMock,
  gutterMock,
  stateEffectDefineMock,
  stateFieldDefineMock,
  resolveLanguageExtensionMock,
} = vi.hoisted(() => {
  const mergeViewConstructor = vi.fn(function MockMergeView() {
    return { destroy: vi.fn() };
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
});
