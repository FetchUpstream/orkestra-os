import { A, useParams } from "@solidjs/router";
import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { getProject, type Project } from "../app/lib/projects";
import {
  createTask,
  listProjectTasks,
  type Task,
  type TaskStatus,
} from "../app/lib/tasks";
import PageHeader from "../components/layout/PageHeader";

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
      <PageHeader title="Project Detail" />

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
              <>
                <section class="project-detail-top" aria-labelledby="project-name">
                  <div class="project-identity-card">
                    <div class="project-key-badge">{projectValue().key}</div>
                    <h1 id="project-name" class="project-name">{projectValue().name}</h1>
                    <Show when={projectValue().description?.trim()} fallback={
                      <p class="project-description project-description-empty">No description yet.</p>
                    }>
                      {(desc) => <p class="project-description">{desc()}</p>}
                    </Show>
                  </div>

                  <div class="projects-panel project-meta-card" aria-label="Project meta">
                    <div class="project-meta-grid">
                      <div class="project-meta-item">
                        <p class="project-meta-label">Default repository</p>
                        <p class="project-meta-value">
                          {defaultRepo()?.name || defaultRepo()?.path || "Not set"}
                        </p>
                      </div>
                      <div class="project-meta-item">
                        <p class="project-meta-label">Linked repositories</p>
                        <p class="project-meta-value">{projectValue().repositories.length}</p>
                      </div>
                    </div>
                    <div class="project-action-placeholder" aria-hidden="true">
                      Project actions coming soon
                    </div>
                  </div>
                </section>

                {/* Repositories Section */}
                <section class="projects-panel" aria-labelledby="repositories-heading">
                  <div class="project-section-header">
                    <h2 id="repositories-heading" class="project-section-title">Repositories</h2>
                    <span class="projects-list-meta">
                      {projectValue().repositories.length} {projectValue().repositories.length === 1 ? "repository" : "repositories"}
                    </span>
                  </div>

                  <Show when={projectValue().repositories.length > 0} fallback={
                    <div class="project-detail-empty" style={{ padding: "32px 24px" }}>
                      <p class="project-detail-empty-text">No repositories configured for this project yet.</p>
                    </div>
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
                    <h2 id="tasks-heading" class="project-section-title">Tasks</h2>
                    <button
                      type="button"
                      class="projects-button-primary"
                      onClick={() => {
                        resetTaskForm();
                        setIsModalOpen(true);
                      }}
                    >
                      Create task
                    </button>
                  </div>

                  <Show when={!taskError()} fallback={<p class="projects-error">{taskError()}</p>}>
                    <Show when={!isTasksLoading()} fallback={<p class="page-placeholder">Loading tasks...</p>}>
                      <Show when={tasks().length > 0} fallback={<p class="project-placeholder-text">No tasks in this project yet.</p>}>
                        <ul class="projects-list" role="list">
                          <For each={tasks()}>
                            {(task) => (
                              <li class="projects-list-item projects-task-item">
                                <div>
                                  <A href={`/projects/${params.projectId}/tasks/${task.id}`} class="projects-task-link">{task.title}</A>
                                  <p class="projects-list-meta">{task.targetRepositoryName || task.targetRepositoryPath || "No repository"}</p>
                                </div>
                                <div class="projects-task-meta">
                                  <span class="projects-task-status">{task.status}</span>
                                  <span class="projects-list-meta">Updated {formatUpdatedAt(task.updatedAt)}</span>
                                </div>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Show>
                  </Show>
                </section>

                <section class="project-placeholders" aria-label="Project scoped sections">
                  <div class="projects-panel project-placeholder-card" aria-labelledby="runs-heading">
                    <h2 id="runs-heading" class="project-section-title">Runs</h2>
                    <p class="project-placeholder-text">Run activity for this project will be shown here in a future update.</p>
                  </div>
                  <div class="projects-panel project-placeholder-card" aria-labelledby="settings-heading">
                    <h2 id="settings-heading" class="project-section-title">Settings</h2>
                    <p class="project-placeholder-text">Project-specific settings will live here once configuration controls are available.</p>
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
              </>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailPage;
