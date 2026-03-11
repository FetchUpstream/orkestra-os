import { A, useParams } from "@solidjs/router";
import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { getProject, type Project } from "../app/lib/projects";
import {
  createTask,
  listProjectTasks,
  type Task,
  type TaskStatus,
} from "../app/lib/tasks";

const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];

const getCreateTaskErrorMessage = (error: unknown): string | null => {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : null;

  if (!message) return null;
  if (message.toLowerCase().includes("database error")) return null;
  return message;
};

const formatUpdatedAt = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const ProjectDetailPage: Component = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [isSubmittingTask, setIsSubmittingTask] = createSignal(false);
  const [taskError, setTaskError] = createSignal("");
  const [taskFormError, setTaskFormError] = createSignal("");
  const [taskTitle, setTaskTitle] = createSignal("");
  const [taskDescription, setTaskDescription] = createSignal("");
  const [taskStatus, setTaskStatus] = createSignal<TaskStatus>("todo");
  const [targetRepositoryId, setTargetRepositoryId] = createSignal("");

  const loadTasks = async (projectId: string) => {
    setIsTasksLoading(true);
    try {
      const list = await listProjectTasks(projectId);
      setTasks(list);
    } catch {
      setTaskError("Failed to load project tasks. Please refresh.");
    } finally {
      setIsTasksLoading(false);
    }
  };

  const resetTaskForm = () => {
    setTaskTitle("");
    setTaskDescription("");
    setTaskStatus("todo");
    setTaskFormError("");
    const selectedProject = project();
    const defaultRepository = selectedProject?.repositories.find((repo) => repo.is_default);
    const fallbackRepository = selectedProject?.repositories[0];
    setTargetRepositoryId(defaultRepository?.id ?? fallbackRepository?.id ?? "");
  };

  onMount(async () => {
    if (!params.projectId) {
      setError("Missing project ID.");
      setIsLoading(false);
      return;
    }
    try {
      const detail = await getProject(params.projectId);
      setProject(detail);
      setTaskError("");
      await loadTasks(params.projectId);
      const defaultRepository = detail.repositories.find((repo) => repo.is_default);
      setTargetRepositoryId(defaultRepository?.id ?? detail.repositories[0]?.id ?? "");
    } catch {
      setError("Failed to load project. Please try again.");
    } finally {
      setIsLoading(false);
    }
  });

  const defaultRepo = () => project()?.repositories.find((r) => r.is_default);
  const otherRepos = () => project()?.repositories.filter((r) => !r.is_default) ?? [];

  const onCreateTask = async (event: Event) => {
    event.preventDefault();
    const projectId = params.projectId;
    if (!projectId) return;

    if (!taskTitle().trim()) {
      setTaskFormError("Title is required.");
      return;
    }

    setTaskFormError("");
    setIsSubmittingTask(true);
    try {
      await createTask({
        projectId,
        title: taskTitle().trim(),
        description: taskDescription().trim() || undefined,
        status: taskStatus(),
        targetRepositoryId: targetRepositoryId() || undefined,
      });
      setIsModalOpen(false);
      resetTaskForm();
      setTaskError("");
      await loadTasks(projectId);
    } catch (error) {
      const backendMessage = getCreateTaskErrorMessage(error);
      setTaskFormError(
        backendMessage
          ? `Failed to create task. ${backendMessage}`
          : "Failed to create task. Please try again.",
      );
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return (
    <>
      <Show when={!error()} fallback={
        <div class="projects-panel" role="alert" aria-live="assertive">
          <div class="projects-error">{error()}</div>
        </div>
      }>
        <Show when={!isLoading()} fallback={
          <div class="projects-panel">
            <div class="page-placeholder">Loading project details...</div>
          </div>
        }>
          <Show when={project()} fallback={
            <div class="projects-panel">
              <div class="project-detail-empty">
                <h2 class="project-detail-empty-title">Project not found</h2>
                <p class="project-detail-empty-text">The project you're looking for doesn't exist or has been removed.</p>
              </div>
            </div>
          }>
            {(projectValue) => (
              <div class="project-detail-container">
                {/* Navigation */}
                <nav class="project-detail-nav" aria-label="Project navigation">
                  <A href="/projects" class="project-detail-back-link">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Back to Projects
                  </A>
                </nav>

                {/* Project Identity Hero - compact with dominant name */}
                <header class="project-detail-hero" aria-labelledby="project-name">
                  <div class="project-identity-card">
                    <span
                      class={`project-key-badge${projectValue().key?.trim() ? "" : " project-key-badge--fallback"}`}
                      aria-label={`Project key: ${projectValue().key?.trim() || "not set"}`}
                    >
                      {projectValue().key?.trim() || "NO-KEY"}
                    </span>
                    <div class="project-identity-main">
                      <h1
                        id="project-name"
                        class={`project-name${projectValue().name?.trim() ? "" : " project-name--fallback"}`}
                      >
                        {projectValue().name?.trim() || "Untitled project"}
                      </h1>
                      <p class="project-meta-line">
                        {projectValue().repositories.length} repositories · Default: {defaultRepo()?.name || defaultRepo()?.path || "—"}
                      </p>
                      <Show when={projectValue().description?.trim()}>
                        {(desc) => <p class="project-description">{desc()}</p>}
                      </Show>
                    </div>
                  </div>
                </header>

                {/* Repositories Section - lighter visual weight */}
                <section class="projects-panel projects-panel--repos" aria-labelledby="repositories-heading">
                  <div class="project-section-header">
                    <h2 id="repositories-heading" class="project-section-title">Repositories ({projectValue().repositories.length})</h2>
                  </div>

                  <Show when={projectValue().repositories.length > 0} fallback={
                    <p class="project-placeholder-text">No repositories linked.</p>
                  }>
                    <ul class="projects-list" role="list">
                      {/* Default repository first */}
                      <Show when={defaultRepo()}>
                        {(repo) => (
                          <li class="projects-list-item projects-list-item-default">
                            <div>
                              <p class="projects-list-name">{repo().name || repo().path}</p>
                              <p class="projects-list-meta">{repo().path}</p>
                            </div>
                            <span class="projects-default-badge">Default</span>
                          </li>
                        )}
                      </Show>

                      {/* Other repositories */}
                      <For each={otherRepos()}>
                        {(repo) => (
                          <li class="projects-list-item">
                            <div>
                              <p class="projects-list-name">{repo.name || repo.path}</p>
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
                    <h2 id="tasks-heading" class="project-section-title">Tasks ({tasks().length})</h2>
                    <button
                      type="button"
                      class="projects-button-primary"
                      onClick={() => {
                        resetTaskForm();
                        setIsModalOpen(true);
                      }}
                    >
                      Add task
                    </button>
                  </div>

                  <Show when={!taskError()} fallback={<p class="projects-error">{taskError()}</p>}>
                    <Show when={!isTasksLoading()} fallback={<p class="project-placeholder-text">Loading...</p>}>
                      <Show when={tasks().length > 0} fallback={<p class="project-placeholder-text">No tasks yet.</p>}>
                        <ul class="project-task-list" role="list">
                          <For each={tasks()}>
                            {(task) => (
                              <li class="project-task-item">
                                <div class="project-task-main">
                                  <A href={`/projects/${params.projectId}/tasks/${task.id}`} class="project-task-title">{task.title}</A>
                                  <p class="project-task-repo">{task.targetRepositoryName || task.targetRepositoryPath || "No repository"}</p>
                                </div>
                                <div class="project-task-meta">
                                  <span class={`project-task-status project-task-status--${task.status}`}>{task.status}</span>
                                  <span class="project-task-updated">{formatUpdatedAt(task.updatedAt)}</span>
                                </div>
                              </li>
                            )}
          </For>
                        </ul>
                      </Show>
                    </Show>
                  </Show>
                </section>

                {/* Placeholders */}
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

                <Show when={isModalOpen()}>
                  <div class="projects-modal-backdrop" role="presentation" onClick={() => setIsModalOpen(false)}>
                    <div class="projects-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title" onClick={(event) => event.stopPropagation()}>
                      <h2 id="create-task-title" class="form-section-title">Create Task</h2>
                      <form class="projects-form" onSubmit={onCreateTask}>
                        <div class="projects-field">
                          <label for="task-title" class="field-label">Title</label>
                          <input
                            id="task-title"
                            value={taskTitle()}
                            onInput={(event) => setTaskTitle(event.currentTarget.value)}
                            aria-invalid={taskFormError() ? "true" : "false"}
                          />
                        </div>
                        <div class="projects-field">
                          <label for="task-description" class="field-label">Description <span class="field-optional">optional</span></label>
                          <textarea
                            id="task-description"
                            value={taskDescription()}
                            onInput={(event) => setTaskDescription(event.currentTarget.value)}
                          />
                        </div>
                        <div class="projects-field">
                          <label for="task-target-repository" class="field-label">Target repository</label>
                          <select
                            id="task-target-repository"
                            value={targetRepositoryId()}
                            onChange={(event) => setTargetRepositoryId(event.currentTarget.value)}
                          >
                            <For each={projectValue().repositories}>
                              {(repository) => (
                                <option value={repository.id ?? ""}>{repository.name || repository.path}</option>
                              )}
                            </For>
                          </select>
                        </div>
                        <div class="projects-field">
                          <label for="task-status" class="field-label">Status</label>
                          <select id="task-status" value={taskStatus()} onChange={(event) => setTaskStatus(event.currentTarget.value as TaskStatus)}>
                            <For each={TASK_STATUSES}>{(status) => <option value={status}>{status}</option>}</For>
                          </select>
                        </div>

                        <Show when={taskFormError()}>
                          {(formError) => <p class="field-error">{formError()}</p>}
                        </Show>

                        <div class="form-actions">
                          <button type="button" class="projects-button-muted" onClick={() => setIsModalOpen(false)}>Cancel</button>
                          <button type="submit" class="projects-button-primary" disabled={isSubmittingTask()}>
                            {isSubmittingTask() ? "Creating..." : "Create task"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailPage;
