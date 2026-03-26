import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import { resolveCodeMirrorLanguageExtension } from "./codemirrorLanguages";

type CodeMirrorDiffEditorProps = {
  original: string;
  modified: string;
  language?: string;
  filePath?: string;
  renderSideBySide?: boolean;
};

const collapseUnchanged = {
  margin: 3,
  minSize: 4,
};

const countLines = (content: string): number => {
  if (content.length === 0) {
    return 0;
  }

  let lineCount = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }
  return lineCount;
};

const BOUNDED_DIFF_LINE_THRESHOLD = 1200;
const BOUNDED_DIFF_CHAR_THRESHOLD = 150_000;

const CodeMirrorDiffEditor: Component<CodeMirrorDiffEditorProps> = (props) => {
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>();
  let mergeView: MergeView | null = null;
  let unifiedView: EditorView | null = null;

  const shouldUseBoundedHeight = createMemo(() => {
    const original = props.original;
    const modified = props.modified;
    const totalCharCount = original.length + modified.length;

    if (totalCharCount >= BOUNDED_DIFF_CHAR_THRESHOLD) {
      return true;
    }

    const maxLineCount = Math.max(countLines(original), countLines(modified));
    return maxLineCount >= BOUNDED_DIFF_LINE_THRESHOLD;
  });

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

  const createEditorExtensions = (
    language?: string,
    filePath?: string,
  ): Extension[] => {
    const languageExtension = resolveCodeMirrorLanguageExtension({
      language,
      filePath,
    });

    return [
      oneDark,
      lineNumbers(),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      ...(languageExtension ? [languageExtension] : []),
    ];
  };

  createEffect(() => {
    const root = rootElement();
    const original = props.original;
    const modified = props.modified;
    const renderSideBySide = props.renderSideBySide !== false;
    const language = props.language;
    const filePath = props.filePath;

    if (!root) {
      return;
    }

    destroyCurrentView();

    if (renderSideBySide) {
      mergeView = new MergeView({
        parent: root,
        a: {
          doc: original,
          extensions: createEditorExtensions(language, filePath),
        },
        b: {
          doc: modified,
          extensions: createEditorExtensions(language, filePath),
        },
        collapseUnchanged,
      });
      return;
    }

    unifiedView = new EditorView({
      parent: root,
      doc: modified,
      extensions: [
        ...createEditorExtensions(language, filePath),
        unifiedMergeView({
          original,
          gutter: true,
          mergeControls: false,
          collapseUnchanged,
        }),
      ],
    });
  });

  onCleanup(() => {
    destroyCurrentView();
  });

  return (
    <div
      classList={{
        "run-detail-codemirror-root": true,
        "run-detail-codemirror-root--split": props.renderSideBySide !== false,
        "run-detail-codemirror-root--unified": props.renderSideBySide === false,
        "run-detail-codemirror-root--bounded": shouldUseBoundedHeight(),
      }}
      ref={setRootElement}
    />
  );
};

export default CodeMirrorDiffEditor;
