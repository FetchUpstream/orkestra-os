import {
  For,
  Show,
  createEffect,
  createSignal,
  type Component,
} from "solid-js";
import MonacoDiffEditor from "../../../components/MonacoDiffEditor";
import { useRunDetailModel } from "../model/useRunDetailModel";

type RunDiffDrawerPanelProps = {
  model: ReturnType<typeof useRunDetailModel>;
  isActive: boolean;
  isSideBySide: boolean;
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
        <p class="projects-error">{props.model.diffFilesError()}</p>
      </Show>
      <Show
        when={props.model.diffFiles().length > 0}
        fallback={
          <Show when={!props.model.isDiffFilesLoading()}>
            <p class="project-placeholder-text">No changed files.</p>
          </Show>
        }
      >
        <div class="run-diff-accordion">
          <For each={props.model.diffFiles()}>
            {(file) => {
              const expanded = () => expandedDiffPaths()[file.path] === true;
              const payload = () => props.model.diffFilePayloads()[file.path];
              const isFileLoading = () =>
                props.model.diffFileLoadingPaths()[file.path] === true;

              return (
                <article class="run-diff-item">
                  <button
                    type="button"
                    class="run-diff-item-header rounded-none"
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
                    <span class="run-diff-item-path">{file.path}</span>
                    <span class="run-diff-item-stats">
                      <span class="run-diff-item-stat-additions">
                        +{file.additions}
                      </span>
                      <span class="run-diff-item-stat-deletions">
                        -{file.deletions}
                      </span>
                    </span>
                  </button>
                  <Show when={expanded()}>
                    <div class="run-diff-item-body">
                      <Show
                        when={!isFileLoading()}
                        fallback={
                          <p class="project-placeholder-text">Loading diff.</p>
                        }
                      >
                        <Show
                          when={payload()}
                          fallback={
                            <p class="project-placeholder-text">
                              Diff unavailable.
                            </p>
                          }
                        >
                          <p class="run-diff-item-meta">
                            {payload()?.status},{" "}
                            {payload()?.isBinary ? "binary" : "text"}
                            {payload()?.truncated ? ", truncated" : ""}
                          </p>
                          <div class="run-detail-monaco-panel">
                            <MonacoDiffEditor
                              original={payload()?.original ?? ""}
                              modified={payload()?.modified ?? ""}
                              language={payload()?.language}
                              renderSideBySide={props.isSideBySide}
                            />
                          </div>
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
