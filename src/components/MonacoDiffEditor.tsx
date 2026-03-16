import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { createEffect, onCleanup, onMount, type Component } from "solid-js";
import { ensureMonacoEnvironment } from "./monacoEnvironment";

ensureMonacoEnvironment();

type MonacoDiffEditorProps = {
  original: string;
  modified: string;
  language?: string;
};

const MonacoDiffEditor: Component<MonacoDiffEditorProps> = (props) => {
  let rootRef: HTMLDivElement | null = null;
  let editor: monaco.editor.IStandaloneDiffEditor | null = null;
  let originalModel: monaco.editor.ITextModel | null = null;
  let modifiedModel: monaco.editor.ITextModel | null = null;

  const getLanguage = () => props.language || "typescript";

  onMount(() => {
    if (!rootRef) return;

    monaco.editor.setTheme("vs-dark");

    editor = monaco.editor.createDiffEditor(rootRef, {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: true,
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
  });

  onCleanup(() => {
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
      ref={(element) => {
        rootRef = element;
      }}
    />
  );
};

export default MonacoDiffEditor;
