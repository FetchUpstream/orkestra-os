import {
  For,
  Suspense,
  Show,
  createEffect,
  createSignal,
  lazy,
  type Component,
} from "solid-js";
import type {
  CodeMirrorReviewValidationContext,
  UpsertCodeMirrorDiffDraftCommentInput,
} from "../../../components/CodeMirrorDiffEditor";
import { useRunDetailModel } from "../model/useRunDetailModel";

const formatAnchorTrustReasonLabel = (reason: string | undefined): string => {
  switch (reason) {
    case "diff_changed":
      return "Needs review after diff refresh.";
    case "file_removed":
      return "File is no longer in the latest diff.";
    case "line_out_of_range":
      return "Anchored line is no longer available.";
    case "line_not_commentable":
      return "Anchored line is not in a changed hunk anymore.";
    case "snippet_mismatch":
      return "Anchored line content changed.";
    case "side_not_supported":
      return "Anchor side is not supported in this view.";
    default:
      return "Anchor needs manual review.";
  }
};

const CodeMirrorDiffEditor = lazy(
  () => import("../../../components/CodeMirrorDiffEditor"),
);

type RunDiffDrawerPanelProps = {
  model: ReturnType<typeof useRunDetailModel>;
  isActive: boolean;
  isSideBySide: boolean;
};

const formatDiffStatusLabel = (status: string): string => {
  const normalized = status.trim().replace(/[_-]+/g, " ");
  if (normalized.length === 0) {
    return "Changed";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const RunDiffDrawerPanel: Component<RunDiffDrawerPanelProps> = (props) => {
  const [expandedDiffPath, setExpandedDiffPath] = createSignal<string | null>(
    null,
  );

  createEffect(() => {
    if (!props.isActive) {
      return;
    }

    const files = props.model.diffFiles();
    const currentPath = expandedDiffPath();

    if (files.length === 0) {
      if (currentPath !== null) {
        setExpandedDiffPath(null);
      }
      return;
    }

    if (
      currentPath !== null &&
      files.some((file) => file.path === currentPath)
    ) {
      return;
    }

    setExpandedDiffPath(files[0]?.path ?? null);
  });

  createEffect(() => {
    if (!props.isActive) {
      return;
    }

    const files = props.model.diffFiles();
    const openPath = expandedDiffPath();

    if (
      !openPath ||
      !files.some((file) => file.path === openPath) ||
      props.model.diffFilePayloads()[openPath] ||
      props.model.diffFileLoadingPaths()[openPath] === true
    ) {
      return;
    }

    void props.model.loadDiffFile(openPath);
  });

  return (
    <section class="run-chat-diff-panel" aria-label="Run diff files">
      <Show
        when={props.model.review.getDraftCommentsNeedingAttention().length > 0}
      >
        <div class="run-diff-review-attention-list" role="status">
          <h3 class="run-diff-review-attention-list__title">Needs review</h3>
          <ul class="run-diff-review-attention-list__items">
            <For each={props.model.review.getDraftCommentsNeedingAttention()}>
              {(comment) => (
                <li class="run-diff-review-attention-list__item">
                  <p class="run-diff-review-attention-list__meta">
                    {comment.filePath}: line {comment.line}
                  </p>
                  <p class="run-diff-review-attention-list__reason">
                    {formatAnchorTrustReasonLabel(comment.anchorTrustReason)}
                  </p>
                  <p class="run-diff-review-attention-list__body">
                    {comment.body}
                  </p>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={props.model.diffFilesError().length > 0}>
        <p class="projects-error run-chat-diff-panel__state">
          {props.model.diffFilesError()}
        </p>
      </Show>
      <Show
        when={
          props.model.isDiffFilesLoading() &&
          props.model.diffFiles().length === 0
        }
      >
        <p class="project-placeholder-text run-chat-diff-panel__state">
          Loading changed files.
        </p>
      </Show>
      <Show
        when={props.model.diffFiles().length > 0}
        fallback={
          <Show when={!props.model.isDiffFilesLoading()}>
            <p class="project-placeholder-text run-chat-diff-panel__state">
              No changed files.
            </p>
          </Show>
        }
      >
        <div class="run-diff-review-sections">
          <For each={props.model.diffFiles()}>
            {(file) => {
              const expanded = () => expandedDiffPath() === file.path;
              const payload = () => props.model.diffFilePayloads()[file.path];
              const isFileLoading = () =>
                props.model.diffFileLoadingPaths()[file.path] === true;

              return (
                <article
                  classList={{
                    "run-diff-section": true,
                    "run-diff-section--expanded": expanded(),
                  }}
                >
                  <button
                    type="button"
                    class="run-diff-section__header rounded-none"
                    aria-expanded={expanded() ? "true" : "false"}
                    onClick={() => {
                      if (expanded()) {
                        setExpandedDiffPath(null);
                        return;
                      }

                      setExpandedDiffPath(file.path);
                    }}
                  >
                    <span class="run-diff-section__path-wrap">
                      <span class="run-diff-section__path">{file.path}</span>
                      <span class="run-diff-section__status">
                        {formatDiffStatusLabel(file.status)}
                      </span>
                    </span>
                    <span class="run-diff-section__header-meta">
                      <span class="run-diff-section__stats">
                        <span class="run-diff-section__stat run-diff-section__stat--additions">
                          +{file.additions}
                        </span>
                        <span class="run-diff-section__stat run-diff-section__stat--deletions">
                          -{file.deletions}
                        </span>
                      </span>
                      <span
                        classList={{
                          "run-diff-section__toggle": true,
                          "run-diff-section__toggle--expanded": expanded(),
                        }}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 16 16" fill="none">
                          <path
                            d="M4 6.5 8 10.5l4-4"
                            stroke="currentColor"
                            stroke-width="1.3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </span>
                    </span>
                  </button>
                  <Show when={expanded()}>
                    <div class="run-diff-section__workspace">
                      <Show
                        when={!isFileLoading()}
                        fallback={
                          <p class="project-placeholder-text run-diff-section__helper">
                            Loading diff.
                          </p>
                        }
                      >
                        <Show
                          when={payload()}
                          fallback={
                            <p class="project-placeholder-text run-diff-section__helper">
                              Diff unavailable.
                            </p>
                          }
                        >
                          <p class="run-diff-section__helper">
                            {payload()?.status},{" "}
                            {payload()?.isBinary ? "binary" : "text"}
                            {payload()?.truncated ? ", truncated" : ""}
                          </p>
                          <Show when={!props.isSideBySide}>
                            <p class="run-diff-section__helper">
                              Inline review comments are available only in
                              side-by-side mode.
                            </p>
                          </Show>
                          <Show
                            when={payload()?.isBinary || payload()?.truncated}
                          >
                            <p class="run-diff-section__helper">
                              Inline comments are disabled for binary or
                              truncated diffs.
                            </p>
                          </Show>
                          <Suspense
                            fallback={
                              <p class="project-placeholder-text run-diff-section__helper">
                                Loading editor.
                              </p>
                            }
                          >
                            <CodeMirrorDiffEditor
                              original={payload()?.original ?? ""}
                              modified={payload()?.modified ?? ""}
                              language={payload()?.language}
                              filePath={payload()?.path}
                              renderSideBySide={props.isSideBySide}
                              draftComments={props.model.review
                                .getDraftCommentsForFile(file.path)
                                .filter(
                                  (comment) =>
                                    comment.side === "modified" &&
                                    comment.anchorTrust === "trusted",
                                )}
                              canCreateDraftComments={
                                props.isSideBySide &&
                                !payload()?.isBinary &&
                                !payload()?.truncated
                              }
                              onUpsertDraftComment={(
                                nextComment: UpsertCodeMirrorDiffDraftCommentInput,
                              ) => {
                                props.model.review.upsertDraftComment(
                                  nextComment,
                                );
                              }}
                              onDeleteDraftComment={(commentId: string) => {
                                props.model.review.removeDraftComment(
                                  commentId,
                                );
                              }}
                              onReviewValidationContext={(
                                context: CodeMirrorReviewValidationContext,
                              ) => {
                                props.model.review.validateDraftAnchorsForFile(
                                  context,
                                );
                              }}
                            />
                          </Suspense>
                        </Show>
                      </Show>
                    </div>
                  </Show>
                </article>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
};

export default RunDiffDrawerPanel;
