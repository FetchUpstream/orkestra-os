import { MergeView, unifiedMergeView } from "@codemirror/merge";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  lineNumbers,
} from "@codemirror/view";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import { resolveCodeMirrorLanguageExtension } from "./codemirrorLanguages";

type ReviewCommentSide = "original" | "modified";

export type CodeMirrorDiffDraftComment = {
  id: string;
  line: number;
  body: string;
};

export type UpsertCodeMirrorDiffDraftCommentInput = {
  id?: string;
  filePath: string;
  side: ReviewCommentSide;
  line: number;
  body: string;
  anchorLineSnippet?: string;
};

export type CodeMirrorReviewValidationContext = {
  filePath: string;
  side: "modified";
  modifiedLineCount: number;
  commentableModifiedLines: Set<number>;
  modifiedLineTextByLine: Map<number, string>;
};

type CodeMirrorDiffEditorProps = {
  original: string;
  modified: string;
  language?: string;
  filePath?: string;
  renderSideBySide?: boolean;
  draftComments?: CodeMirrorDiffDraftComment[];
  canCreateDraftComments?: boolean;
  onUpsertDraftComment?: (input: UpsertCodeMirrorDiffDraftCommentInput) => void;
  onDeleteDraftComment?: (commentId: string) => void;
  onReviewValidationContext?: (
    context: CodeMirrorReviewValidationContext,
  ) => void;
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

type ReviewComposerState = {
  line: number | null;
  draftId: string | null;
  seedBody: string;
};

type ReviewUiState = {
  commentableLines: Set<number>;
  comments: CodeMirrorDiffDraftComment[];
  composer: ReviewComposerState;
  canCreateDraftComments: boolean;
};

const setReviewCommentableLinesEffect = StateEffect.define<Set<number>>();
const setReviewCommentsEffect =
  StateEffect.define<CodeMirrorDiffDraftComment[]>();
const setReviewCreationSupportEffect = StateEffect.define<boolean>();
const openReviewComposerEffect = StateEffect.define<{
  line: number;
  draftId: string | null;
  seedBody: string;
}>();
const closeReviewComposerEffect = StateEffect.define<void>();

const areCommentsEqual = (
  left: CodeMirrorDiffDraftComment[],
  right: CodeMirrorDiffDraftComment[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      !rightItem ||
      leftItem.id !== rightItem.id ||
      leftItem.line !== rightItem.line ||
      leftItem.body !== rightItem.body
    ) {
      return false;
    }
  }

  return true;
};

const areLineSetsEqual = (left: Set<number>, right: Set<number>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const line of left) {
    if (!right.has(line)) {
      return false;
    }
  }

  return true;
};

const normalizeDraftComments = (
  comments: CodeMirrorDiffDraftComment[] | undefined,
): CodeMirrorDiffDraftComment[] => {
  const normalized = (comments ?? [])
    .filter((comment) => {
      return (
        typeof comment.id === "string" &&
        comment.id.trim().length > 0 &&
        Number.isFinite(comment.line)
      );
    })
    .map((comment) => ({
      id: comment.id,
      line: Math.max(1, Math.floor(comment.line)),
      body: comment.body,
    }))
    .sort((left, right) => {
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      return left.id.localeCompare(right.id);
    });

  return normalized;
};

const reviewUiStateField = StateField.define<ReviewUiState>({
  create: () => ({
    commentableLines: new Set<number>(),
    comments: [],
    composer: {
      line: null,
      draftId: null,
      seedBody: "",
    },
    canCreateDraftComments: false,
  }),
  update: (value, transaction) => {
    let next = value;

    for (const effect of transaction.effects) {
      if (effect.is(setReviewCommentableLinesEffect)) {
        const nextLines = effect.value;
        if (!areLineSetsEqual(next.commentableLines, nextLines)) {
          next = {
            ...next,
            commentableLines: nextLines,
          };
        }
        continue;
      }

      if (effect.is(setReviewCommentsEffect)) {
        const nextComments = effect.value;
        if (!areCommentsEqual(next.comments, nextComments)) {
          const composerDraftId = next.composer.draftId;
          const hasComposerDraft =
            composerDraftId !== null &&
            nextComments.some((comment) => comment.id === composerDraftId);
          next = {
            ...next,
            comments: nextComments,
            composer:
              composerDraftId !== null && !hasComposerDraft
                ? {
                    line: null,
                    draftId: null,
                    seedBody: "",
                  }
                : next.composer,
          };
        }
        continue;
      }

      if (effect.is(setReviewCreationSupportEffect)) {
        if (next.canCreateDraftComments !== effect.value) {
          next = {
            ...next,
            canCreateDraftComments: effect.value,
          };
        }
        continue;
      }

      if (effect.is(openReviewComposerEffect)) {
        const payload = effect.value;
        next = {
          ...next,
          composer: {
            line: payload.line,
            draftId: payload.draftId,
            seedBody: payload.seedBody,
          },
        };
        continue;
      }

      if (effect.is(closeReviewComposerEffect)) {
        if (next.composer.line !== null) {
          next = {
            ...next,
            composer: {
              line: null,
              draftId: null,
              seedBody: "",
            },
          };
        }
      }
    }

    return next;
  },
});

type ReviewWidgetRuntime = {
  getFilePath: () => string;
  onUpsertDraftComment: () =>
    | ((input: UpsertCodeMirrorDiffDraftCommentInput) => void)
    | undefined;
  onDeleteDraftComment: () => ((commentId: string) => void) | undefined;
};

export const shouldSubmitInlineReviewComposer = (
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing"
  >,
): boolean => {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing
  );
};

class ReviewLineMarker extends GutterMarker {
  constructor(private readonly kind: "commentable" | "commented") {
    super();
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className =
      this.kind === "commented"
        ? "cm-review-gutter__marker cm-review-gutter__marker--commented"
        : "cm-review-gutter__marker";
    marker.setAttribute(
      "aria-label",
      this.kind === "commented" ? "Draft comment" : "Add draft comment",
    );
    return marker;
  }
}

class InlineReviewWidget extends WidgetType {
  constructor(
    private readonly lineNumber: number,
    private readonly comments: CodeMirrorDiffDraftComment[],
    private readonly composer: ReviewComposerState,
    private readonly runtime: ReviewWidgetRuntime,
  ) {
    super();
  }

  eq(other: InlineReviewWidget): boolean {
    return (
      this.lineNumber === other.lineNumber &&
      this.composer.line === other.composer.line &&
      this.composer.draftId === other.composer.draftId &&
      this.composer.seedBody === other.composer.seedBody &&
      areCommentsEqual(this.comments, other.comments)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-review-thread";

    if (this.comments.length > 0) {
      const list = document.createElement("div");
      list.className = "cm-review-thread__list";

      for (const comment of this.comments) {
        const item = document.createElement("article");
        item.className = "cm-review-thread__item";

        const label = document.createElement("p");
        label.className = "cm-review-thread__label";
        label.textContent = "Draft comment";

        const body = document.createElement("p");
        body.className = "cm-review-thread__body";
        body.textContent = comment.body;

        const actions = document.createElement("div");
        actions.className = "cm-review-thread__actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "cm-review-thread__button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => {
          view.dispatch({
            effects: openReviewComposerEffect.of({
              line: this.lineNumber,
              draftId: comment.id,
              seedBody: comment.body,
            }),
          });
        });

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className =
          "cm-review-thread__button cm-review-thread__button--danger";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          const onDelete = this.runtime.onDeleteDraftComment();
          onDelete?.(comment.id);
          view.dispatch({ effects: closeReviewComposerEffect.of(undefined) });
        });

        actions.append(editButton, removeButton);
        item.append(label, body, actions);
        list.append(item);
      }

      container.append(list);
    }

    if (this.composer.line === this.lineNumber) {
      const composer = document.createElement("form");
      composer.className = "cm-review-composer";

      const textarea = document.createElement("textarea");
      textarea.className = "cm-review-composer__input";
      textarea.placeholder = "Add a draft comment";
      textarea.rows = 3;
      textarea.value = this.composer.seedBody;

      const controls = document.createElement("div");
      controls.className = "cm-review-composer__actions";

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className =
        "cm-review-composer__button cm-review-composer__button--ghost";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => {
        view.dispatch({ effects: closeReviewComposerEffect.of(undefined) });
      });

      const saveButton = document.createElement("button");
      saveButton.type = "submit";
      saveButton.className = "cm-review-composer__button";
      saveButton.textContent = "Create";

      textarea.addEventListener("keydown", (event) => {
        if (!shouldSubmitInlineReviewComposer(event)) {
          return;
        }

        event.preventDefault();
        if (typeof composer.requestSubmit === "function") {
          composer.requestSubmit();
          return;
        }

        saveButton.click();
      });

      const handleSubmit = (event: Event): void => {
        event.preventDefault();
        const body = textarea.value.trim();
        if (!body) {
          textarea.focus();
          return;
        }

        const filePath = this.runtime.getFilePath();
        if (!filePath) {
          return;
        }

        const onUpsert = this.runtime.onUpsertDraftComment();
        onUpsert?.({
          id: this.composer.draftId ?? undefined,
          filePath,
          side: "modified",
          line: this.lineNumber,
          body,
          anchorLineSnippet: view.state.doc.line(this.lineNumber).text,
        });
        view.dispatch({ effects: closeReviewComposerEffect.of(undefined) });
      };

      composer.addEventListener("submit", handleSubmit);
      controls.append(cancelButton, saveButton);
      composer.append(textarea, controls);
      container.append(composer);
    }

    return container;
  }
}

const buildReviewDecorations = (
  state: EditorState,
  reviewState: ReviewUiState,
  runtime: ReviewWidgetRuntime,
) => {
  const builder = new RangeSetBuilder<Decoration>();
  const commentsByLine = new Map<number, CodeMirrorDiffDraftComment[]>();

  for (const comment of reviewState.comments) {
    const current = commentsByLine.get(comment.line) ?? [];
    current.push(comment);
    commentsByLine.set(comment.line, current);
  }

  for (const [lineNumber, comments] of commentsByLine.entries()) {
    if (lineNumber < 1 || lineNumber > state.doc.lines) {
      continue;
    }

    const line = state.doc.line(lineNumber);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: "cm-review-commented-line",
      }),
    );
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        block: true,
        side: 1,
        widget: new InlineReviewWidget(
          lineNumber,
          comments,
          reviewState.composer,
          runtime,
        ),
      }),
    );
  }

  const composerLine = reviewState.composer.line;
  if (composerLine !== null && !commentsByLine.has(composerLine)) {
    if (composerLine >= 1 && composerLine <= state.doc.lines) {
      const line = state.doc.line(composerLine);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          block: true,
          side: 1,
          widget: new InlineReviewWidget(
            composerLine,
            [],
            reviewState.composer,
            runtime,
          ),
        }),
      );
    }
  }

  return builder.finish();
};

const createReviewExtension = (runtime: ReviewWidgetRuntime): Extension => {
  const reviewDecorationField = StateField.define({
    create: () => Decoration.none,
    update: (_value, transaction) => {
      const reviewState = transaction.state.field(reviewUiStateField);
      return buildReviewDecorations(transaction.state, reviewState, runtime);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [
    reviewUiStateField,
    reviewDecorationField,
    gutter({
      class: "cm-review-gutter",
      lineMarker: (view, line) => {
        const reviewState = view.state.field(reviewUiStateField, false);
        if (!reviewState) {
          return null;
        }
        const lineNumber = view.state.doc.lineAt(line.from).number;

        const hasComment = reviewState.comments.some(
          (comment) => comment.line === lineNumber,
        );
        if (hasComment) {
          return new ReviewLineMarker("commented");
        }

        if (
          reviewState.canCreateDraftComments &&
          reviewState.commentableLines.has(lineNumber)
        ) {
          return new ReviewLineMarker("commentable");
        }

        return null;
      },
      domEventHandlers: {
        click: (view, line, event) => {
          const reviewState = view.state.field(reviewUiStateField, false);
          if (!reviewState) {
            return false;
          }
          const lineNumber = view.state.doc.lineAt(line.from).number;

          const lineComments = reviewState.comments.filter(
            (comment) => comment.line === lineNumber,
          );
          const hasComment = lineComments.length > 0;
          const isCommentable = reviewState.commentableLines.has(lineNumber);

          if (
            !hasComment &&
            (!reviewState.canCreateDraftComments || !isCommentable)
          ) {
            return false;
          }

          const activeComment = lineComments[0] ?? null;
          view.dispatch({
            effects: openReviewComposerEffect.of({
              line: lineNumber,
              draftId: activeComment?.id ?? null,
              seedBody: activeComment?.body ?? "",
            }),
          });
          event.preventDefault();
          return true;
        },
      },
    }),
  ];
};

const isEditorViewLike = (value: unknown): value is EditorView => {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    "dispatch" in value
  );
};

const getMergePaneEditor = (
  mergeView: MergeView | null,
  pane: "a" | "b",
): EditorView | null => {
  if (!mergeView) {
    return null;
  }

  const paneValue = (mergeView as unknown as Record<string, unknown>)[pane];
  if (isEditorViewLike(paneValue)) {
    return paneValue;
  }

  if (typeof paneValue !== "object" || paneValue === null) {
    return null;
  }

  const nestedEditor = (paneValue as { editor?: unknown; view?: unknown })
    .editor;
  if (isEditorViewLike(nestedEditor)) {
    return nestedEditor;
  }

  const nestedView = (paneValue as { editor?: unknown; view?: unknown }).view;
  if (isEditorViewLike(nestedView)) {
    return nestedView;
  }

  return null;
};

type MergeChunkLike = {
  fromB: number;
  toB: number;
};

const deriveModifiedCommentableLines = (
  activeMergeView: MergeView,
  modifiedView: EditorView,
): Set<number> => {
  const lines = new Set<number>();
  const mergeChunks =
    (activeMergeView as unknown as { chunks?: MergeChunkLike[] }).chunks ?? [];

  for (const chunk of mergeChunks) {
    if (
      !chunk ||
      !Number.isFinite(chunk.fromB) ||
      !Number.isFinite(chunk.toB) ||
      chunk.toB <= chunk.fromB
    ) {
      continue;
    }

    const startPosition = Math.max(
      0,
      Math.min(chunk.fromB, modifiedView.state.doc.length),
    );
    const endPosition = Math.max(
      0,
      Math.min(chunk.toB - 1, modifiedView.state.doc.length),
    );
    const startLine = modifiedView.state.doc.lineAt(startPosition).number;
    const endLine = modifiedView.state.doc.lineAt(endPosition).number;

    for (let line = startLine; line <= endLine; line += 1) {
      lines.add(line);
    }
  }

  return lines;
};

const collectModifiedLineTextByLine = (
  view: EditorView,
): Map<number, string> => {
  const lines = new Map<number, string>();
  for (
    let lineNumber = 1;
    lineNumber <= view.state.doc.lines;
    lineNumber += 1
  ) {
    lines.set(lineNumber, view.state.doc.line(lineNumber).text);
  }
  return lines;
};

const CodeMirrorDiffEditor: Component<CodeMirrorDiffEditorProps> = (props) => {
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>();
  const [editorViewVersion, setEditorViewVersion] = createSignal(0);
  let mergeView: MergeView | null = null;
  let unifiedView: EditorView | null = null;

  const reviewRuntime: ReviewWidgetRuntime = {
    getFilePath: () => props.filePath?.trim() ?? "",
    onUpsertDraftComment: () => props.onUpsertDraftComment,
    onDeleteDraftComment: () => props.onDeleteDraftComment,
  };
  const reviewExtension = createReviewExtension(reviewRuntime);

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

  const getModifiedEditor = (): EditorView | null => {
    return getMergePaneEditor(mergeView, "b");
  };

  const syncModifiedCommentableLines = (): void => {
    const modifiedEditor = getModifiedEditor();
    if (!mergeView || !modifiedEditor) {
      return;
    }

    const commentableLines = deriveModifiedCommentableLines(
      mergeView,
      modifiedEditor,
    );

    modifiedEditor.dispatch({
      effects: setReviewCommentableLinesEffect.of(commentableLines),
    });

    const filePath = props.filePath?.trim() ?? "";
    if (!filePath) {
      return;
    }

    props.onReviewValidationContext?.({
      filePath,
      side: "modified",
      modifiedLineCount: modifiedEditor.state.doc.lines,
      commentableModifiedLines: commentableLines,
      modifiedLineTextByLine: collectModifiedLineTextByLine(modifiedEditor),
    });
  };

  const createEditorExtensions = (
    language: string | undefined,
    filePath: string | undefined,
    includeReviewExtension: boolean,
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
      ...(includeReviewExtension ? [reviewExtension] : []),
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
          extensions: createEditorExtensions(language, filePath, false),
        },
        b: {
          doc: modified,
          extensions: createEditorExtensions(language, filePath, true),
        },
        collapseUnchanged,
      });

      setEditorViewVersion((current) => current + 1);

      queueMicrotask(() => {
        syncModifiedCommentableLines();
      });
      return;
    }

    unifiedView = new EditorView({
      parent: root,
      doc: modified,
      extensions: [
        ...createEditorExtensions(language, filePath, false),
        unifiedMergeView({
          original,
          gutter: true,
          mergeControls: false,
          collapseUnchanged,
        }),
      ],
    });

    setEditorViewVersion((current) => current + 1);
  });

  createEffect(() => {
    editorViewVersion();
    rootElement();
    const normalizedComments = normalizeDraftComments(props.draftComments);
    const canCreateDraftComments = props.canCreateDraftComments === true;

    const modifiedEditor = getModifiedEditor();
    if (!modifiedEditor) {
      return;
    }

    modifiedEditor.dispatch({
      effects: [
        setReviewCommentsEffect.of(normalizedComments),
        setReviewCreationSupportEffect.of(canCreateDraftComments),
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
