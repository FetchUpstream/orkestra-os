import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { java } from "@codemirror/lang-java";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, lineNumbers } from "@codemirror/view";
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
  const normalized = language?.trim().toLowerCase();

  switch (normalized) {
    case "typescript":
    case "ts":
    case "application/typescript":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "javascript":
    case "js":
    case "mjs":
    case "cjs":
    case "application/javascript":
    case "text/javascript":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "json":
    case "jsonc":
    case "application/json":
      return [json()];
    case "markdown":
    case "md":
    case "mdx":
    case "text/markdown":
      return [markdown()];
    case "python":
    case "py":
      return [python()];
    case "go":
    case "golang":
      return [go()];
    case "rust":
    case "rs":
      return [rust()];
    case "java":
      return [java()];
    case "css":
      return [css()];
    case "html":
      return [html()];
    case "xml":
      return [xml()];
    case "sql":
      return [sql()];
    case "php":
      return [php()];
    case "yaml":
    case "yml":
      return [yaml()];
    default:
      return [];
  }
};

const collapseUnchanged = {
  margin: 3,
  minSize: 4,
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
    lineNumbers(),
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
        collapseUnchanged,
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
          gutter: true,
          collapseUnchanged,
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
