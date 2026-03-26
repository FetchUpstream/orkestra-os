import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CodeMirrorDiffEditor from "./CodeMirrorDiffEditor";

const {
  mergeViewConstructor,
  unifiedMergeViewMock,
  editorViewConstructor,
  lineNumbersMock,
  editableOfMock,
  readOnlyOfMock,
  resolveLanguageExtensionMock,
} = vi.hoisted(() => {
  const mergeViewConstructor = vi.fn(function MockMergeView() {
    return { destroy: vi.fn() };
  });
  const unifiedMergeViewMock = vi.fn(() => ({ extension: "unified" }));
  const editorViewConstructor = vi.fn(function MockEditorView() {
    return { destroy: vi.fn() };
  });
  const lineNumbersMock = vi.fn(() => ({ extension: "lineNumbers" }));
  const editableOfMock = vi.fn(() => ({ extension: "editable" }));
  const readOnlyOfMock = vi.fn(() => ({ extension: "readonly" }));
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
    lineNumbersMock,
    editableOfMock,
    readOnlyOfMock,
    resolveLanguageExtensionMock,
  };
});

vi.mock("@codemirror/merge", () => ({
  MergeView: mergeViewConstructor,
  unifiedMergeView: unifiedMergeViewMock,
}));

vi.mock("@codemirror/view", () => ({
  EditorView: Object.assign(editorViewConstructor, {
    lineWrapping: { extension: "lineWrapping" },
    editable: {
      of: editableOfMock,
    },
  }),
  lineNumbers: lineNumbersMock,
}));

vi.mock("@codemirror/state", () => ({
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
    lineNumbersMock.mockClear();
    editableOfMock.mockClear();
    readOnlyOfMock.mockClear();
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
});
