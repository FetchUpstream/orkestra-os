import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { createEffect, onCleanup, onMount, type Component } from "solid-js";
import { ensureMonacoEnvironment } from "./monacoEnvironment";

ensureMonacoEnvironment();

type MonacoEditorProps = {
  value: string;
  language?: string;
  ariaLabel?: string;
};

const MonacoEditor: Component<MonacoEditorProps> = (props) => {
  let rootRef: HTMLDivElement | null = null;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;

  onMount(() => {
    if (!rootRef) return;

    editor = monaco.editor.create(rootRef, {
      value: props.value,
      language: props.language || "typescript",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      ariaLabel: props.ariaLabel || "Code editor",
    });
  });

  createEffect(() => {
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const nextValue = props.value;
    if (model.getValue() !== nextValue) {
      model.setValue(nextValue);
    }

    const nextLanguage = props.language || "typescript";
    if (model.getLanguageId() !== nextLanguage) {
      monaco.editor.setModelLanguage(model, nextLanguage);
    }
  });

  onCleanup(() => {
    const model = editor?.getModel();
    editor?.dispose();
    model?.dispose();
    editor = null;
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

export default MonacoEditor;
