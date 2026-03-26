import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import {
  createEffect,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";

type CodeMirrorDiffEditorProps = {
  original: string;
  modified: string;
  language?: string;
  renderSideBySide?: boolean;
};

const resolveLanguageExtensions = (language?: string): Extension[] => {
  const normalized = language?.toLowerCase();

  switch (normalized) {
    case "typescript":
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "javascript":
    case "js":
    case "mjs":
    case "cjs":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "json":
      return [json()];
    case "markdown":
    case "md":
    case "mdx":
      return [markdown()];
    default:
      return [];
  }
};

const CodeMirrorDiffEditor: Component<CodeMirrorDiffEditorProps> = (props) => {
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>();
  let mergeView: MergeView | null = null;
  let unifiedView: EditorView | null = null;

  const destroyCurrentView = () => {
    mergeView?.destroy();
    unifiedView?.destroy();
    mergeView = null;
    unifiedView = null;

    const root = rootElement();
    if (root) {
      root.replaceChildren();
    }
  };

  const createEditorExtensions = (language?: string): Extension[] => [
    oneDark,
    EditorView.lineWrapping,
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    ...resolveLanguageExtensions(language),
  ];

  createEffect(() => {
    const root = rootElement();
    const original = props.original;
    const modified = props.modified;
    const renderSideBySide = props.renderSideBySide !== false;
    const language = props.language;

    if (!root) {
      return;
    }

    destroyCurrentView();

    if (renderSideBySide) {
      mergeView = new MergeView({
        parent: root,
        a: {
          doc: original,
          extensions: createEditorExtensions(language),
        },
        b: {
          doc: modified,
          extensions: createEditorExtensions(language),
        },
        revertControls: false,
      });
      return;
    }

    unifiedView = new EditorView({
      parent: root,
      doc: modified,
      extensions: [
        ...createEditorExtensions(language),
        unifiedMergeView({
          original,
          mergeControls: false,
          gutter: true,
        }),
      ],
    });
  });

  onCleanup(() => {
    destroyCurrentView();
  });

  return <div class="run-detail-codemirror-root" ref={setRootElement} />;
};

export default CodeMirrorDiffEditor;
