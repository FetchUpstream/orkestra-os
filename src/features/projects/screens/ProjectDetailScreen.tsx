import { A, useNavigate } from "@solidjs/router";
import { For, Show, type Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import {
  ProjectDetailErrorState,
  ProjectDetailLoadingState,
  ProjectDetailNotFoundState,
} from "../components/ProjectDetailStates";
import { useProjectDetailModel } from "../model/useProjectDetailModel";
import {
  formatTaskStatus,
  formatUpdatedAt,
  isTaskBlocked,
  taskDisplayKey,
} from "../utils/projectDetail";

const ProjectDetailScreen: Component = () => {
  const model = useProjectDetailModel();
  const navigate = useNavigate();
  const defaultRepo = () =>
    model.project()?.repositories.find((r) => r.is_default);
  const otherRepos = () =>
    model.project()?.repositories.filter((r) => !r.is_default) ?? [];
  const envVars = () => model.project()?.envVars ?? [];

  return (
    <>
      <Show
        when={!model.error()}
        fallback={<ProjectDetailErrorState error={model.error()} />}
      >
        <Show
          when={!model.isLoading()}
          fallback={<ProjectDetailLoadingState />}
        >
          <Show
            when={model.project()}
            fallback={<ProjectDetailNotFoundState />}
          >
            {(projectValue) => (
              <div class="project-detail-container">
                <nav class="project-detail-nav" aria-label="Project navigation">
                  <BackIconLink href="/projects" label="projects" />
                </nav>

                <header
                  class="project-detail-hero border-base-content/15 bg-base-200/35 mb-4 border px-5 py-5"
                  aria-labelledby="project-name"
                >
                  <div class="project-identity-card items-start justify-between gap-5">
                    <div class="flex min-w-0 items-start gap-4">
                      <span
                        class={`project-key-badge mt-0 ${projectValue().key?.trim() ? "" : "project-key-badge--fallback"}`}
                        aria-label={`Project key: ${projectValue().key?.trim() || "not set"}`}
                      >
                        {projectValue().key?.trim() || "NO-KEY"}
                      </span>
                      <div class="project-identity-main">
                        <h1
                          id="project-name"
                          class={`project-name${projectValue().name?.trim() ? "" : "project-name--fallback"}`}
                        >
                          {projectValue().name?.trim() || "Untitled project"}
                        </h1>
                        <p class="project-meta-line">
                          {projectValue().repositories.length} repositories ·
                          Default:{" "}
                          {defaultRepo()?.name || defaultRepo()?.path || "—"}
                        </p>
                        <Show when={projectValue().description?.trim()}>
                          {(desc) => (
                            <p class="project-description">{desc()}</p>
                          )}
                        </Show>
                      </div>
                    </div>
                    <div class="hidden shrink-0 md:flex md:flex-col md:items-end md:gap-2">
                      <span class="badge badge-outline border-primary/20 text-primary/80 rounded-none px-2 text-[10px] tracking-[0.2em] uppercase">
                        Project workspace
                      </span>
                      <span class="badge badge-ghost border-base-content/10 text-base-content/55 rounded-none border px-2 text-[10px]">
                        {model.tasks().length} tasks
                      </span>
                    </div>
                  </div>
                </header>

                <Show when={envVars().length > 0}>
                  <section
                    class="projects-panel border-base-content/15 bg-base-200/25 mb-4 border"
                    aria-labelledby="project-env-vars-heading"
                  >
                    <div class="project-section-header border-base-content/10 border-b px-4 py-3">
                      <h2
                        id="project-env-vars-heading"
                        class="project-section-title"
                      >
                        Environment variables ({envVars().length})
                      </h2>
                    </div>
                    <div class="px-4 py-4">
                      <p class="project-placeholder-text mb-3 text-sm">
                        Project-scoped variables applied to run terminals and
                        OpenCode sessions.
                      </p>
                      <div class="flex flex-wrap gap-2">
                        <For each={envVars()}>
                          {(entry) => (
                            <span class="badge badge-outline border-base-content/15 text-base-content/75 rounded-none px-2 py-2 font-mono text-[11px]">
                              {entry.key}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  </section>
                </Show>

                <section
                  class="projects-panel projects-panel--repos border-base-content/15 bg-base-200/25 border"
                  aria-labelledby="repositories-heading"
                >
                  <div class="project-section-header border-base-content/10 border-b px-4 py-3">
                    <h2 id="repositories-heading" class="project-section-title">
                      Repositories ({projectValue().repositories.length})
                    </h2>
                  </div>
                  <Show
                    when={projectValue().repositories.length > 0}
                    fallback={
                      <p class="project-placeholder-text">
                        No repositories linked.
                      </p>
                    }
                  >
                    <ul class="projects-list px-4 pt-3 pb-4" role="list">
                      <Show when={defaultRepo()}>
                        {(repo) => (
                          <li class="projects-list-item projects-list-item-default border-primary/20 bg-base-100 rounded-none border">
                            <div>
                              <p class="projects-list-name">
                                {repo().name || repo().path}
                              </p>
                              <p class="projects-list-meta">{repo().path}</p>
                            </div>
                            <span class="projects-default-badge">Default</span>
                          </li>
                        )}
                      </Show>
                      <For each={otherRepos()}>
                        {(repo) => (
                          <li class="projects-list-item border-base-content/15 bg-base-100 rounded-none border">
                            <div>
                              <p class="projects-list-name">
                                {repo.name || repo.path}
                              </p>
                              <p class="projects-list-meta">{repo.path}</p>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section
                  class="projects-panel border-base-content/15 bg-base-200/30 border"
                  aria-labelledby="tasks-heading"
                >
                  <div class="project-section-header border-base-content/10 border-b px-4 py-3">
                    <h2 id="tasks-heading" class="project-section-title">
                      Tasks ({model.tasks().length})
                    </h2>
                    <button
                      type="button"
                      class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                      onClick={() => {
                        navigate(
                          `/projects/${model.params.projectId}/tasks/new`,
                        );
                      }}
                    >
                      Add task
                    </button>
                  </div>

                  <Show
                    when={!model.taskError()}
                    fallback={
                      <p class="projects-error mx-4 my-4 text-sm">
                        {model.taskError()}
                      </p>
                    }
                  >
                    <Show
                      when={!model.isTasksLoading()}
                      fallback={
                        <p class="project-placeholder-text px-4 py-4 text-sm">
                          Loading...
                        </p>
                      }
                    >
                      <Show
                        when={model.tasks().length > 0}
                        fallback={
                          <p class="project-placeholder-text px-4 py-4 text-sm">
                            No tasks yet.
                          </p>
                        }
                      >
                        <ul class="project-task-list" role="list">
                          <For each={model.tasks()}>
                            {(task) => (
                              <li class="project-task-item border-base-content/15 bg-base-100 rounded-none border">
                                <A
                                  href={`/projects/${model.params.projectId}/tasks/${task.id}`}
                                  class="project-task-link"
                                >
                                  <div class="project-task-main">
                                    <p class="project-task-title">
                                      <Show
                                        when={taskDisplayKey(
                                          task,
                                          projectValue(),
                                        )}
                                      >
                                        {(displayKey) => (
                                          <span class="project-task-key">
                                            {displayKey()}
                                          </span>
                                        )}
                                      </Show>
                                      {task.title}
                                    </p>
                                    <p class="project-task-repo">
                                      {task.targetRepositoryName ||
                                        task.targetRepositoryPath ||
                                        "No repository"}
                                    </p>
                                  </div>
                                  <div class="project-task-meta min-w-[9rem]">
                                    <span
                                      class={`project-task-status project-task-status--${task.status}`}
                                    >
                                      {formatTaskStatus(task.status)}
                                    </span>
                                    <Show when={isTaskBlocked(task)}>
                                      <span class="project-task-blocked">
                                        Blocked
                                      </span>
                                    </Show>
                                    <span class="project-task-updated">
                                      {formatUpdatedAt(task.updatedAt)}
                                    </span>
                                  </div>
                                </A>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Show>
                  </Show>
                </section>

                <section class="project-placeholders" aria-label="Coming soon">
                  <div class="project-placeholder-compact border-base-content/15 bg-base-200/25 rounded-none border">
                    <span class="project-placeholder-label">Runs</span>
                    <span class="project-placeholder-soon">Soon</span>
                  </div>
                  <div class="project-placeholder-compact border-base-content/15 bg-base-200/25 rounded-none border">
                    <span class="project-placeholder-label">Settings</span>
                    <span class="project-placeholder-soon">Soon</span>
                  </div>
                </section>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailScreen;
