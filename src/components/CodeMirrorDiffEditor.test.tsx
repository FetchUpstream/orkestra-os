import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CodeMirrorDiffEditor from "./CodeMirrorDiffEditor";

const {
  mergeViewConstructor,
  unifiedMergeViewMock,
  editorViewConstructor,
  editableOfMock,
  readOnlyOfMock,
} = vi.hoisted(() => {
  const mergeViewConstructor = vi.fn(function MockMergeView() {
    return { destroy: vi.fn() };
  });
  const unifiedMergeViewMock = vi.fn(() => ({ extension: "unified" }));
  const editorViewConstructor = vi.fn(function MockEditorView() {
    return { destroy: vi.fn() };
  });
  const editableOfMock = vi.fn(() => ({ extension: "editable" }));
  const readOnlyOfMock = vi.fn(() => ({ extension: "readonly" }));

  return {
    mergeViewConstructor,
    unifiedMergeViewMock,
    editorViewConstructor,
    editableOfMock,
    readOnlyOfMock,
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

describe("CodeMirrorDiffEditor", () => {
  beforeEach(() => {
    mergeViewConstructor.mockClear();
    unifiedMergeViewMock.mockClear();
    editorViewConstructor.mockClear();
    editableOfMock.mockClear();
    readOnlyOfMock.mockClear();
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
    expect(editableOfMock).toHaveBeenCalledWith(false);
    expect(readOnlyOfMock).toHaveBeenCalledWith(true);
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
        mergeControls: false,
        gutter: true,
      }),
    );
    expect(mergeViewConstructor).not.toHaveBeenCalled();
    expect(editableOfMock).toHaveBeenCalledWith(false);
    expect(readOnlyOfMock).toHaveBeenCalledWith(true);
  });
});
