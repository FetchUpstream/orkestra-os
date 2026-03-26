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
  reviewComments?: Array<{
    id: string;
    side: "original" | "modified";
    lineNumber: number;
    body: string;
    anchorTrust?: "trusted" | "untrusted";
    anchorIssue?: string | null;
  }>;
  activeReviewComposer?: {
    side: "original" | "modified";
    lineNumber: number;
    body: string;
    anchorTrust?: "trusted" | "untrusted";
    anchorIssue?: string | null;
  } | null;
  onOpenReviewComposer?: (anchor: {
    side: "original" | "modified";
    lineNumber: number;
  }) => void;
  onUpdateReviewComposerBody?: (body: string) => void;
  onCloseReviewComposer?: () => void;
  onSaveReviewComposer?: () => void;
  onDeleteReviewComment?: (commentId: string) => void;
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
  let disposeOriginalGutterMouseListener: monaco.IDisposable | null = null;
  let disposeModifiedGutterMouseListener: monaco.IDisposable | null = null;
  let originalCommentDecorations: string[] = [];
  let modifiedCommentDecorations: string[] = [];
  let originalZoneIds: string[] = [];
  let modifiedZoneIds: string[] = [];
  let commentableOriginalLines = new Set<number>();
  let commentableModifiedLines = new Set<number>();

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

  const clearReviewDecorations = () => {
    if (!editor) {
      return;
    }

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    originalCommentDecorations = originalEditor.deltaDecorations(
      originalCommentDecorations,
      [],
    );
    modifiedCommentDecorations = modifiedEditor.deltaDecorations(
      modifiedCommentDecorations,
      [],
    );
  };

  const clearReviewZonesForEditor = (
    targetEditor: monaco.editor.IStandaloneCodeEditor,
    zoneIds: string[],
  ): string[] => {
    if (zoneIds.length === 0) {
      return zoneIds;
    }

    targetEditor.changeViewZones((accessor) => {
      for (const zoneId of zoneIds) {
        accessor.removeZone(zoneId);
      }
    });
    return [];
  };

  const clearReviewZones = () => {
    if (!editor) {
      return;
    }

    originalZoneIds = clearReviewZonesForEditor(
      editor.getOriginalEditor(),
      originalZoneIds,
    );
    modifiedZoneIds = clearReviewZonesForEditor(
      editor.getModifiedEditor(),
      modifiedZoneIds,
    );
  };

  const isCommentableMouseTarget = (type: monaco.editor.MouseTargetType) => {
    return (
      type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
      type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
      type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
    );
  };

  const refreshGutterListeners = () => {
    disposeOriginalGutterMouseListener?.dispose();
    disposeModifiedGutterMouseListener?.dispose();
    disposeOriginalGutterMouseListener = null;
    disposeModifiedGutterMouseListener = null;

    if (
      !editor ||
      props.renderSideBySide === false ||
      !props.onOpenReviewComposer
    ) {
      return;
    }

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();

    disposeOriginalGutterMouseListener = originalEditor.onMouseDown((event) => {
      if (!isCommentableMouseTarget(event.target.type)) {
        return;
      }

      const lineNumber = event.target.position?.lineNumber;
      if (!lineNumber || !commentableOriginalLines.has(lineNumber)) {
        return;
      }

      event.event.preventDefault();
      event.event.stopPropagation();
      props.onOpenReviewComposer?.({ side: "original", lineNumber });
    });

    disposeModifiedGutterMouseListener = modifiedEditor.onMouseDown((event) => {
      if (!isCommentableMouseTarget(event.target.type)) {
        return;
      }

      const lineNumber = event.target.position?.lineNumber;
      if (!lineNumber || !commentableModifiedLines.has(lineNumber)) {
        return;
      }

      event.event.preventDefault();
      event.event.stopPropagation();
      props.onOpenReviewComposer?.({ side: "modified", lineNumber });
    });
  };

  const rebuildReviewLayer = () => {
    if (!editor) {
      return;
    }

    const isSideBySide = props.renderSideBySide !== false;
    const lineChanges = isSideBySide ? (editor.getLineChanges() ?? []) : [];
    const comments = props.reviewComments ?? [];
    const activeComposer = props.activeReviewComposer ?? null;
    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();

    commentableOriginalLines = new Set<number>();
    commentableModifiedLines = new Set<number>();

    if (isSideBySide) {
      for (const change of lineChanges) {
        const originalStart = Math.max(change.originalStartLineNumber, 1);
        const originalEnd = Math.max(change.originalEndLineNumber, 0);
        for (
          let lineNumber = originalStart;
          lineNumber <= originalEnd;
          lineNumber += 1
        ) {
          commentableOriginalLines.add(lineNumber);
        }

        const modifiedStart = Math.max(change.modifiedStartLineNumber, 1);
        const modifiedEnd = Math.max(change.modifiedEndLineNumber, 0);
        for (
          let lineNumber = modifiedStart;
          lineNumber <= modifiedEnd;
          lineNumber += 1
        ) {
          commentableModifiedLines.add(lineNumber);
        }
      }
    }

    const originalDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    const modifiedDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    const originalLineCount = originalModel?.getLineCount() ?? 0;
    const modifiedLineCount = modifiedModel?.getLineCount() ?? 0;

    const isLineInBounds = (
      side: "original" | "modified",
      lineNumber: number,
    ): boolean => {
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
        return false;
      }

      return side === "original"
        ? lineNumber <= originalLineCount
        : lineNumber <= modifiedLineCount;
    };

    if (isSideBySide && props.onOpenReviewComposer) {
      for (const lineNumber of commentableOriginalLines) {
        originalDecorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName:
              "run-diff-comment-gutter run-diff-comment-gutter--commentable",
          },
        });
      }

      for (const lineNumber of commentableModifiedLines) {
        modifiedDecorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName:
              "run-diff-comment-gutter run-diff-comment-gutter--commentable",
          },
        });
      }
    }

    for (const comment of comments) {
      if (!isLineInBounds(comment.side, comment.lineNumber)) {
        continue;
      }
      const isOriginal = comment.side === "original";
      const targetDecorations = isOriginal
        ? originalDecorations
        : modifiedDecorations;
      targetDecorations.push({
        range: new monaco.Range(comment.lineNumber, 1, comment.lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "run-diff-comment-line run-diff-comment-line--has-comment",
          linesDecorationsClassName:
            "run-diff-comment-gutter run-diff-comment-gutter--has-comment",
        },
      });
    }

    if (activeComposer) {
      if (!isLineInBounds(activeComposer.side, activeComposer.lineNumber)) {
        // Composer stays in app state; a fallback thread card is rendered below.
      } else {
        const targetDecorations =
          activeComposer.side === "original"
            ? originalDecorations
            : modifiedDecorations;
        targetDecorations.push({
          range: new monaco.Range(
            activeComposer.lineNumber,
            1,
            activeComposer.lineNumber,
            1,
          ),
          options: {
            isWholeLine: true,
            className:
              "run-diff-comment-line run-diff-comment-line--composer-active",
            linesDecorationsClassName:
              "run-diff-comment-gutter run-diff-comment-gutter--composer-active",
          },
        });
      }
    }

    originalCommentDecorations = originalEditor.deltaDecorations(
      originalCommentDecorations,
      originalDecorations,
    );
    modifiedCommentDecorations = modifiedEditor.deltaDecorations(
      modifiedCommentDecorations,
      modifiedDecorations,
    );

    clearReviewZones();

    const groupCommentsByLine = (
      side: "original" | "modified",
    ): Map<number, Array<(typeof comments)[number]>> => {
      const grouped = new Map<number, Array<(typeof comments)[number]>>();
      for (const comment of comments) {
        if (comment.side !== side) {
          continue;
        }
        if (!isLineInBounds(comment.side, comment.lineNumber)) {
          continue;
        }
        const current = grouped.get(comment.lineNumber) ?? [];
        current.push(comment);
        grouped.set(comment.lineNumber, current);
      }
      return grouped;
    };

    const originalCommentsByLine = groupCommentsByLine("original");
    const modifiedCommentsByLine = groupCommentsByLine("modified");

    const renderZonesForSide = (
      side: "original" | "modified",
      sideEditor: monaco.editor.IStandaloneCodeEditor,
      sideCommentsByLine: Map<number, Array<(typeof comments)[number]>>,
    ): string[] => {
      const fallbackComments = comments.filter(
        (comment) =>
          comment.side === side &&
          !isLineInBounds(comment.side, comment.lineNumber),
      );
      const composerLine =
        activeComposer?.side === side &&
        isLineInBounds(activeComposer.side, activeComposer.lineNumber)
          ? activeComposer.lineNumber
          : null;
      const fallbackComposer =
        activeComposer?.side === side &&
        !isLineInBounds(activeComposer.side, activeComposer.lineNumber)
          ? activeComposer
          : null;
      const anchorLines = new Set<number>(sideCommentsByLine.keys());
      if (composerLine !== null) {
        anchorLines.add(composerLine);
      }

      const sortedLines = Array.from(anchorLines).sort((a, b) => a - b);
      const addedZoneIds: string[] = [];
      if (
        sortedLines.length === 0 &&
        fallbackComments.length === 0 &&
        !fallbackComposer
      ) {
        return addedZoneIds;
      }

      sideEditor.changeViewZones((accessor) => {
        if (fallbackComments.length > 0 || fallbackComposer) {
          const fallbackNode = document.createElement("div");
          fallbackNode.className =
            "run-diff-inline-thread run-diff-inline-thread--anchor-review";

          const fallbackTitle = document.createElement("p");
          fallbackTitle.className = "run-diff-inline-thread__anchor-warning";
          fallbackTitle.textContent =
            "Some anchors no longer map to visible diff lines. Review manually.";
          fallbackNode.append(fallbackTitle);

          for (const comment of fallbackComments) {
            const item = document.createElement("article");
            item.className = "run-diff-inline-thread__comment";

            const warning = document.createElement("p");
            warning.className = "run-diff-inline-thread__anchor-warning";
            warning.textContent =
              comment.anchorIssue ??
              `Anchor line ${comment.lineNumber} needs review.`;

            const body = document.createElement("p");
            body.className = "run-diff-inline-thread__comment-body";
            body.textContent = comment.body;

            const actionRow = document.createElement("div");
            actionRow.className = "run-diff-inline-thread__comment-actions";
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className =
              "run-diff-inline-thread__action run-diff-inline-thread__action--danger";
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => {
              props.onDeleteReviewComment?.(comment.id);
            });
            actionRow.append(deleteButton);

            item.append(warning, body, actionRow);
            fallbackNode.append(item);
          }

          if (fallbackComposer) {
            const composerWarning = document.createElement("p");
            composerWarning.className =
              "run-diff-inline-thread__anchor-warning";
            composerWarning.textContent =
              fallbackComposer.anchorIssue ??
              `Composer anchor line ${fallbackComposer.lineNumber} needs review.`;
            fallbackNode.append(composerWarning);
          }

          const fallbackZoneId = accessor.addZone({
            afterLineNumber: 1,
            heightInLines: Math.min(
              24,
              Math.max(
                5,
                4 + fallbackComments.length * 4 + (fallbackComposer ? 3 : 0),
              ),
            ),
            domNode: fallbackNode,
            suppressMouseDown: false,
          });
          addedZoneIds.push(fallbackZoneId);
        }

        for (const lineNumber of sortedLines) {
          const lineComments = sideCommentsByLine.get(lineNumber) ?? [];
          const isComposerLine = composerLine === lineNumber;

          const zoneNode = document.createElement("div");
          zoneNode.className = "run-diff-inline-thread";

          if (lineComments.length > 0) {
            const commentsWrap = document.createElement("div");
            commentsWrap.className = "run-diff-inline-thread__comments";
            for (const comment of lineComments) {
              const item = document.createElement("article");
              item.className = "run-diff-inline-thread__comment";

              if (comment.anchorTrust === "untrusted") {
                const warning = document.createElement("p");
                warning.className = "run-diff-inline-thread__anchor-warning";
                warning.textContent =
                  comment.anchorIssue ??
                  `Anchor line ${comment.lineNumber} needs review.`;
                item.append(warning);
              }

              const body = document.createElement("p");
              body.className = "run-diff-inline-thread__comment-body";
              body.textContent = comment.body;

              const actionRow = document.createElement("div");
              actionRow.className = "run-diff-inline-thread__comment-actions";
              const deleteButton = document.createElement("button");
              deleteButton.type = "button";
              deleteButton.className =
                "run-diff-inline-thread__action run-diff-inline-thread__action--danger";
              deleteButton.textContent = "Delete";
              deleteButton.addEventListener("click", () => {
                props.onDeleteReviewComment?.(comment.id);
              });
              actionRow.append(deleteButton);

              item.append(body, actionRow);
              commentsWrap.append(item);
            }

            zoneNode.append(commentsWrap);
          }

          if (isComposerLine && activeComposer) {
            const composer = document.createElement("div");
            composer.className = "run-diff-inline-thread__composer";
            if (activeComposer.anchorTrust === "untrusted") {
              const warning = document.createElement("p");
              warning.className = "run-diff-inline-thread__anchor-warning";
              warning.textContent =
                activeComposer.anchorIssue ??
                `Anchor line ${activeComposer.lineNumber} needs review.`;
              composer.append(warning);
            }
            const textarea = document.createElement("textarea");
            textarea.className = "run-diff-inline-thread__composer-input";
            textarea.rows = 3;
            textarea.placeholder = "Add a draft comment";
            textarea.value = activeComposer.body;
            textarea.addEventListener("input", (event) => {
              props.onUpdateReviewComposerBody?.(
                (event.currentTarget as HTMLTextAreaElement).value,
              );
            });
            textarea.addEventListener("keydown", (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (textarea.value.trim().length > 0) {
                  props.onSaveReviewComposer?.();
                }
              }

              if (event.key === "Escape") {
                event.preventDefault();
                props.onCloseReviewComposer?.();
              }
            });

            const composerActions = document.createElement("div");
            composerActions.className =
              "run-diff-inline-thread__composer-actions";

            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "run-diff-inline-thread__action";
            cancelButton.textContent = "Cancel";
            cancelButton.addEventListener("click", () => {
              props.onCloseReviewComposer?.();
            });

            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.className =
              "run-diff-inline-thread__action run-diff-inline-thread__action--primary";
            saveButton.textContent = "Save draft";
            saveButton.disabled = activeComposer.body.trim().length === 0;
            saveButton.addEventListener("click", () => {
              if (textarea.value.trim().length > 0) {
                props.onSaveReviewComposer?.();
              }
            });

            composerActions.append(cancelButton, saveButton);
            composer.append(textarea, composerActions);
            zoneNode.append(composer);
          }

          if (!zoneNode.hasChildNodes()) {
            continue;
          }

          const heightInLines = Math.min(
            24,
            Math.max(4, lineComments.length * 4 + (isComposerLine ? 7 : 0)),
          );
          const zoneId = accessor.addZone({
            afterLineNumber: lineNumber,
            heightInLines,
            domNode: zoneNode,
            suppressMouseDown: false,
          });
          addedZoneIds.push(zoneId);
        }
      });

      return addedZoneIds;
    };

    originalZoneIds = renderZonesForSide(
      "original",
      originalEditor,
      originalCommentsByLine,
    );
    modifiedZoneIds = renderZonesForSide(
      "modified",
      modifiedEditor,
      modifiedCommentsByLine,
    );

    refreshGutterListeners();
  };

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
      glyphMargin: true,
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
      rebuildReviewLayer();
    });

    requestAnimationFrame(() => {
      measureAndApplyHeight();
      rebuildReviewLayer();
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
      rebuildReviewLayer();
    });
  });

  onCleanup(() => {
    disposeOriginalContentSizeListener?.dispose();
    disposeModifiedContentSizeListener?.dispose();
    disposeDiffUpdateListener?.dispose();
    disposeOriginalGutterMouseListener?.dispose();
    disposeModifiedGutterMouseListener?.dispose();
    clearReviewDecorations();
    clearReviewZones();
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
