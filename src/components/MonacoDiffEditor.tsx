import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { createEffect, onCleanup, onMount, type Component } from "solid-js";
import { ensureMonacoEnvironment } from "./monacoEnvironment";

ensureMonacoEnvironment();

type MonacoDiffEditorProps = {
  original: string;
  modified: string;
  language?: string;
  renderSideBySide?: boolean;
};

const MonacoDiffEditor: Component<MonacoDiffEditorProps> = (props) => {
  let rootRef: HTMLDivElement | null = null;
  let editor: monaco.editor.IStandaloneDiffEditor | null = null;
  let originalModel: monaco.editor.ITextModel | null = null;
  let modifiedModel: monaco.editor.ITextModel | null = null;
  let editorHeightPx = "180px";
  let disposeOriginalContentSizeListener: monaco.IDisposable | null = null;
  let disposeModifiedContentSizeListener: monaco.IDisposable | null = null;
  let disposeDiffUpdateListener: monaco.IDisposable | null = null;

  const MIN_EDITOR_HEIGHT_PX = 120;
  const MAX_EDITOR_HEIGHT_PX = 680;

  const measureAndApplyHeight = () => {
    if (!editor) {
      return;
    }

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    const contentHeight = Math.max(
      originalEditor.getContentHeight(),
      modifiedEditor.getContentHeight(),
    );
    const lineHeight = modifiedEditor.getOption(
      monaco.editor.EditorOption.lineHeight,
    );
    const nextHeight = Math.max(
      MIN_EDITOR_HEIGHT_PX,
      Math.min(MAX_EDITOR_HEIGHT_PX, Math.ceil(contentHeight + lineHeight + 8)),
    );
    const nextHeightPx = `${nextHeight}px`;

    if (editorHeightPx !== nextHeightPx) {
      editorHeightPx = nextHeightPx;
      if (rootRef) {
        rootRef.style.height = nextHeightPx;
      }
      editor.layout();
    }
  };

  const getLanguage = () => props.language || "typescript";

  onMount(() => {
    if (!rootRef) return;

    monaco.editor.setTheme("vs-dark");

    editor = monaco.editor.createDiffEditor(rootRef, {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: props.renderSideBySide !== false,
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: 4,
        minimumLineCount: 3,
        revealLineCount: 8,
      },
      readOnly: true,
      originalEditable: false,
    });

    originalModel = monaco.editor.createModel(props.original, getLanguage());
    modifiedModel = monaco.editor.createModel(props.modified, getLanguage());

    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    disposeOriginalContentSizeListener = editor
      .getOriginalEditor()
      .onDidContentSizeChange(() => {
        measureAndApplyHeight();
      });
    disposeModifiedContentSizeListener = editor
      .getModifiedEditor()
      .onDidContentSizeChange(() => {
        measureAndApplyHeight();
      });
    disposeDiffUpdateListener = editor.onDidUpdateDiff(() => {
      measureAndApplyHeight();
    });

    requestAnimationFrame(() => {
      measureAndApplyHeight();
    });
  });

  createEffect(() => {
    if (!originalModel || !modifiedModel) return;

    if (originalModel.getValue() !== props.original) {
      originalModel.setValue(props.original);
    }

    if (modifiedModel.getValue() !== props.modified) {
      modifiedModel.setValue(props.modified);
    }

    const nextLanguage = getLanguage();
    if (originalModel.getLanguageId() !== nextLanguage) {
      monaco.editor.setModelLanguage(originalModel, nextLanguage);
    }
    if (modifiedModel.getLanguageId() !== nextLanguage) {
      monaco.editor.setModelLanguage(modifiedModel, nextLanguage);
    }

    editor?.updateOptions({
      renderSideBySide: props.renderSideBySide !== false,
    });

    requestAnimationFrame(() => {
      measureAndApplyHeight();
    });
  });

  onCleanup(() => {
    disposeOriginalContentSizeListener?.dispose();
    disposeModifiedContentSizeListener?.dispose();
    disposeDiffUpdateListener?.dispose();
    editor?.setModel(null);
    editor?.dispose();
    originalModel?.dispose();
    modifiedModel?.dispose();
    editor = null;
    originalModel = null;
    modifiedModel = null;
  });

  return (
    <div
      class="monaco-editor-root"
      style={{ height: editorHeightPx }}
      ref={(element) => {
        rootRef = element;
      }}
    />
  );
};

export default MonacoDiffEditor;
