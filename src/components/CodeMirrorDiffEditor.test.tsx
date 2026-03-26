import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CodeMirrorDiffEditor from "./CodeMirrorDiffEditor";

const {
  mergeViewConstructor,
  unifiedMergeViewMock,
  editorViewConstructor,
  lineNumbersMock,
  editableOfMock,
  readOnlyOfMock,
  pythonMock,
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
  const pythonMock = vi.fn(() => ({ extension: "python" }));

  return {
    mergeViewConstructor,
    unifiedMergeViewMock,
    editorViewConstructor,
    lineNumbersMock,
    editableOfMock,
    readOnlyOfMock,
    pythonMock,
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

vi.mock("@codemirror/lang-javascript", () => ({
  javascript: vi.fn(() => ({ extension: "javascript" })),
}));

vi.mock("@codemirror/lang-json", () => ({
  json: vi.fn(() => ({ extension: "json" })),
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => ({ extension: "markdown" })),
}));

vi.mock("@codemirror/lang-python", () => ({
  python: pythonMock,
}));

vi.mock("@codemirror/lang-go", () => ({
  go: vi.fn(() => ({ extension: "go" })),
}));

vi.mock("@codemirror/lang-rust", () => ({
  rust: vi.fn(() => ({ extension: "rust" })),
}));

vi.mock("@codemirror/lang-java", () => ({
  java: vi.fn(() => ({ extension: "java" })),
}));

vi.mock("@codemirror/lang-css", () => ({
  css: vi.fn(() => ({ extension: "css" })),
}));

vi.mock("@codemirror/lang-html", () => ({
  html: vi.fn(() => ({ extension: "html" })),
}));

vi.mock("@codemirror/lang-xml", () => ({
  xml: vi.fn(() => ({ extension: "xml" })),
}));

vi.mock("@codemirror/lang-sql", () => ({
  sql: vi.fn(() => ({ extension: "sql" })),
}));

vi.mock("@codemirror/lang-php", () => ({
  php: vi.fn(() => ({ extension: "php" })),
}));

vi.mock("@codemirror/lang-yaml", () => ({
  yaml: vi.fn(() => ({ extension: "yaml" })),
}));

describe("CodeMirrorDiffEditor", () => {
  beforeEach(() => {
    mergeViewConstructor.mockClear();
    unifiedMergeViewMock.mockClear();
    editorViewConstructor.mockClear();
    lineNumbersMock.mockClear();
    editableOfMock.mockClear();
    readOnlyOfMock.mockClear();
    pythonMock.mockClear();
  });

  it("renders side-by-side diffs with MergeView", async () => {
    render(() => (
      <CodeMirrorDiffEditor
        original="const before = 1;"
        modified="const after = 2;"
        language="typescript"
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });
    expect(editorViewConstructor).not.toHaveBeenCalled();
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
    const mergeViewConfig = mergeViewCalls[0]?.[0];
    expect(mergeViewConfig).not.toHaveProperty("revertControls");
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

  it("resolves highlighting extension for additional languages", async () => {
    render(() => (
      <CodeMirrorDiffEditor
        original="print('before')"
        modified="print('after')"
        language="python"
        renderSideBySide={true}
      />
    ));

    await waitFor(() => {
      expect(mergeViewConstructor).toHaveBeenCalledTimes(1);
    });

    expect(pythonMock).toHaveBeenCalledTimes(2);
  });
});
