import { A } from "@solidjs/router";
import { Show, type Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime, formatRunStatus } from "../../tasks/utils/taskDetail";

const RunDetailScreen: Component = () => {
  const model = useRunDetailModel();

  return (
    <div class="run-detail-page">
      <Show
        when={!model.error()}
        fallback={
          <section class="projects-panel run-detail-card">
            <p class="projects-error">{model.error()}</p>
          </section>
        }
      >
        <Show
          when={!model.isLoading()}
          fallback={
            <section class="projects-panel run-detail-card">
              <p class="project-placeholder-text">Loading run details.</p>
            </section>
          }
        >
          <Show
            when={model.run()}
            fallback={
              <section class="projects-panel run-detail-card">
                <p class="project-placeholder-text">Run not found.</p>
              </section>
            }
          >
            {(runValue) => (
              <>
                <section class="projects-panel run-detail-card">
                  <BackIconLink
                    href={model.backHref()}
                    label={model.backLabel()}
                    class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                  />
                  <div class="run-detail-header-row">
                    <h1 class="run-detail-title">Current run</h1>
                    <span
                      class={`project-task-status project-task-status--${runValue().status}`}
                    >
                      {formatRunStatus(runValue().status)}
                    </span>
                  </div>

                  <Show
                    when={model.task()}
                    fallback={
                      <p class="project-placeholder-text run-detail-task-context">
                        Linked task: Current task
                      </p>
                    }
                  >
                    {(taskValue) => (
                      <p class="project-placeholder-text run-detail-task-context">
                        Linked task:{" "}
                        <A href={model.taskHref()} class="run-detail-task-link">
                          {taskValue().displayKey?.trim() || "Current task"} -{" "}
                          {taskValue().title}
                        </A>
                      </p>
                    )}
                  </Show>

                  <dl class="task-detail-definition-list run-detail-metadata">
                    <div>
                      <dt>Created</dt>
                      <dd>{formatDateTime(runValue().createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatDateTime(runValue().startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{formatDateTime(runValue().finishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Summary</dt>
                      <dd>{runValue().summary?.trim() || "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Error message</dt>
                      <dd>
                        {runValue().errorMessage?.trim() || "Unavailable"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section
                  class="run-detail-placeholders"
                  aria-label="Run systems"
                >
                  <div class="project-placeholder-compact run-detail-placeholder">
                    <span class="project-placeholder-label">Logs</span>
                    <span class="project-placeholder-soon">Placeholder</span>
                  </div>
                  <div class="project-placeholder-compact run-detail-placeholder">
                    <span class="project-placeholder-label">Events</span>
                    <span class="project-placeholder-soon">Placeholder</span>
                  </div>
                  <div class="project-placeholder-compact run-detail-placeholder">
                    <span class="project-placeholder-label">Files</span>
                    <span class="project-placeholder-soon">Placeholder</span>
                  </div>
                  <div class="project-placeholder-compact run-detail-placeholder">
                    <span class="project-placeholder-label">Review</span>
                    <span class="project-placeholder-soon">Placeholder</span>
                  </div>
                </section>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default RunDetailScreen;
