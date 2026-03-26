import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import MonacoDiffEditor from "./MonacoDiffEditor";

const { diffEditor } = vi.hoisted(() => {
  const diffEditor = {
    getOriginalEditor: vi.fn(() => ({
      getContentHeight: vi.fn(() => 120),
      getOption: vi.fn(() => 20),
      onDidContentSizeChange: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    getModifiedEditor: vi.fn(() => ({
      getContentHeight: vi.fn(() => 120),
      getOption: vi.fn(() => 20),
      onDidContentSizeChange: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    setModel: vi.fn(),
    onDidUpdateDiff: vi.fn(() => ({ dispose: vi.fn() })),
    updateOptions: vi.fn(),
    layout: vi.fn(),
    dispose: vi.fn(),
  };

  return { diffEditor };
});

const createModel = () => ({
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  getLanguageId: vi.fn(() => "typescript"),
  dispose: vi.fn(),
});

vi.mock("./monacoEnvironment", () => ({
  ensureMonacoEnvironment: vi.fn(),
}));

vi.mock("monaco-editor/min/vs/editor/editor.main.css", () => ({}));

vi.mock("monaco-editor", () => ({
  editor: {
    EditorOption: {
      lineHeight: "lineHeight",
    },
    createDiffEditor: vi.fn(() => diffEditor),
    createModel: vi.fn(() => createModel()),
    setModelLanguage: vi.fn(),
    setTheme: vi.fn(),
  },
}));

describe("MonacoDiffEditor", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  beforeEach(() => {
    diffEditor.updateOptions.mockClear();
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it("renders read-only diff in unified mode", async () => {
    render(() => (
      <MonacoDiffEditor
        original={"const before = 1;"}
        modified={"const after = 2;"}
        language="typescript"
        renderSideBySide={false}
      />
    ));

    await waitFor(() => {
      expect(diffEditor.updateOptions).toHaveBeenCalledWith({
        renderSideBySide: false,
      });
    });
  });
});
