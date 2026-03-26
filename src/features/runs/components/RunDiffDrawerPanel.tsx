import {
  For,
  Suspense,
  Show,
  createEffect,
  createSignal,
  lazy,
  type Component,
} from "solid-js";
import { useRunDetailModel } from "../model/useRunDetailModel";

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
  const [expandedDiffPaths, setExpandedDiffPaths] = createSignal<
    Record<string, boolean>
  >({});

  createEffect(() => {
    if (!props.isActive) {
      return;
    }

    const files = props.model.diffFiles();
    setExpandedDiffPaths((current) => {
      const next: Record<string, boolean> = {};
      let didChange = false;

      for (const file of files) {
        if (Object.prototype.hasOwnProperty.call(current, file.path)) {
          next[file.path] = current[file.path] === true;
          continue;
        }

        next[file.path] = true;
        didChange = true;
      }

      if (!didChange) {
        const currentPaths = Object.keys(current);
        if (currentPaths.length !== files.length) {
          didChange = true;
        } else {
          for (const path of currentPaths) {
            if (!Object.prototype.hasOwnProperty.call(next, path)) {
              didChange = true;
              break;
            }
            if (current[path] !== next[path]) {
              didChange = true;
              break;
            }
          }
        }
      }

      return didChange ? next : current;
    });
  });

  createEffect(() => {
    if (!props.isActive) {
      return;
    }

    const files = props.model.diffFiles();
    const expanded = expandedDiffPaths();
    const openPaths = files
      .map((file) => file.path)
      .filter((path) => expanded[path] === true);

    for (const path of openPaths) {
      void props.model.loadDiffFile(path);
    }
  });

  return (
    <section class="run-chat-diff-panel" aria-label="Run diff files">
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
              const expanded = () => expandedDiffPaths()[file.path] === true;
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
                      const previousExpanded =
                        expandedDiffPaths()[file.path] === true;
                      const nextExpanded = !previousExpanded;
                      setExpandedDiffPaths((current) => ({
                        ...current,
                        [file.path]: nextExpanded,
                      }));
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
