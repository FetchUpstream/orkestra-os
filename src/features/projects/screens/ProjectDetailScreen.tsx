import { A } from "@solidjs/router";
import { For, Show, type Component } from "solid-js";
import CreateTaskModal from "../components/CreateTaskModal";
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
  const defaultRepo = () =>
    model.project()?.repositories.find((r) => r.is_default);
  const otherRepos = () =>
    model.project()?.repositories.filter((r) => !r.is_default) ?? [];

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
                  <A
                    href="/projects"
                    class="project-detail-back-link project-detail-back-link--icon"
                    aria-label="Back to projects"
                    title="Back to projects"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 12L6 8L10 4"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </A>
                </nav>

                <header
                  class="project-detail-hero"
                  aria-labelledby="project-name"
                >
                  <div class="project-identity-card">
                    <span
                      class={`project-key-badge${projectValue().key?.trim() ? "" : "project-key-badge--fallback"}`}
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
                        {(desc) => <p class="project-description">{desc()}</p>}
                      </Show>
                    </div>
                  </div>
                </header>

                <section
                  class="projects-panel projects-panel--repos"
                  aria-labelledby="repositories-heading"
                >
                  <div class="project-section-header">
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
                    <ul class="projects-list" role="list">
                      <Show when={defaultRepo()}>
                        {(repo) => (
                          <li class="projects-list-item projects-list-item-default">
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
                          <li class="projects-list-item">
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

                <section class="projects-panel" aria-labelledby="tasks-heading">
                  <div class="project-section-header">
                    <h2 id="tasks-heading" class="project-section-title">
                      Tasks ({model.tasks().length})
                    </h2>
                    <button
                      type="button"
                      class="projects-button-primary"
                      onClick={() => {
                        model.resetTaskForm();
                        model.setIsModalOpen(true);
                      }}
                    >
                      Add task
                    </button>
                  </div>

                  <Show
                    when={!model.taskError()}
                    fallback={<p class="projects-error">{model.taskError()}</p>}
                  >
                    <Show
                      when={!model.isTasksLoading()}
                      fallback={
                        <p class="project-placeholder-text">Loading...</p>
                      }
                    >
                      <Show
                        when={model.tasks().length > 0}
                        fallback={
                          <p class="project-placeholder-text">No tasks yet.</p>
                        }
                      >
                        <ul class="project-task-list" role="list">
                          <For each={model.tasks()}>
                            {(task) => (
                              <li class="project-task-item">
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
                                  <div class="project-task-meta">
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
                  <div class="project-placeholder-compact">
                    <span class="project-placeholder-label">Runs</span>
                    <span class="project-placeholder-soon">Soon</span>
                  </div>
                  <div class="project-placeholder-compact">
                    <span class="project-placeholder-label">Settings</span>
                    <span class="project-placeholder-soon">Soon</span>
                  </div>
                </section>

                <CreateTaskModal
                  isOpen={model.isModalOpen}
                  project={model.project}
                  taskTitle={model.taskTitle}
                  taskDescription={model.taskDescription}
                  taskImplementationGuide={model.taskImplementationGuide}
                  taskStatus={model.taskStatus}
                  targetRepositoryId={model.targetRepositoryId}
                  taskFormError={model.taskFormError}
                  isSubmittingTask={model.isSubmittingTask}
                  setIsModalOpen={model.setIsModalOpen}
                  setTaskTitle={model.setTaskTitle}
                  setTaskDescription={model.setTaskDescription}
                  setTaskImplementationGuide={model.setTaskImplementationGuide}
                  setTaskStatus={model.setTaskStatus}
                  setTargetRepositoryId={model.setTargetRepositoryId}
                  onCreateTask={model.onCreateTask}
                />
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailScreen;
