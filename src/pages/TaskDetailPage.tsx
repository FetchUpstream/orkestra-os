import { A, useParams } from "@solidjs/router";
import { createSignal, onMount, Show, type Component } from "solid-js";
import { getProject } from "../app/lib/projects";
import { getTask, type Task } from "../app/lib/tasks";
import PageHeader from "../components/layout/PageHeader";

const formatStatus = (status: Task["status"]) => {
  if (status === "todo") return "To do";
  if (status === "doing") return "In progress";
  if (status === "review") return "In review";
  return "Done";
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const repositoryLabel = (taskValue: Task) =>
  taskValue.targetRepositoryName ||
  taskValue.targetRepositoryPath ||
  "Project-wide";

const projectLabel = (name: string | null) => name || "Current project";

const TaskDetailPage: Component = () => {
  const params = useParams();
  const [task, setTask] = createSignal<Task | null>(null);
  const [projectName, setProjectName] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  onMount(async () => {
    if (!params.taskId) {
      setError("Missing task ID.");
      setIsLoading(false);
      return;
    }
    try {
      const detail = await getTask(params.taskId);
      setTask(detail);

      if (detail.projectId) {
        try {
          const project = await getProject(detail.projectId);
          const name = project.name.trim();
          const key = project.key.trim();
          setProjectName(key ? `${name} (${key})` : name || null);
        } catch {
          setProjectName(null);
        }
      }
    } catch {
      setError("Failed to load task details.");
    } finally {
      setIsLoading(false);
    }
  });

  return (
    <>
      <PageHeader title="Task Detail" />
      <div class="task-detail-page">
        <Show
          when={!error()}
          fallback={
            <section class="projects-panel task-detail-state-card">
              <h3 class="project-section-title">Unable to load task</h3>
              <p class="project-placeholder-text">{error()}</p>
              <p class="project-placeholder-text">
                Try going back to projects and reopening this task.
              </p>
            </section>
          }
        >
          <Show
            when={!isLoading()}
            fallback={
              <section class="projects-panel task-detail-state-card">
                <h3 class="project-section-title">Loading task</h3>
                <p class="project-placeholder-text">
                  Pulling task details and context.
                </p>
              </section>
            }
          >
            <Show
              when={task()}
              fallback={
                <section class="projects-panel task-detail-state-card">
                  <h3 class="project-section-title">Task not found</h3>
                  <p class="project-placeholder-text">
                    This task may have been removed or the link is no longer
                    valid.
                  </p>
                  <A
                    href={
                      params.projectId
                        ? `/projects/${params.projectId}`
                        : "/projects"
                    }
                    class="project-detail-back-link"
                  >
                    Back to {params.projectId ? "project" : "projects"}
                  </A>
                </section>
              }
            >
              {(taskValue) => (
                <div class="task-detail-workspace">
                  <header class="projects-panel task-detail-hero-panel">
                    <div class="task-detail-header-row">
                      <div class="task-detail-header-main">
                        <A
                          href={
                            params.projectId
                              ? `/projects/${params.projectId}`
                              : "/projects"
                          }
                          class="project-detail-back-link"
                        >
                          Back to {params.projectId ? "project" : "projects"}
                        </A>
                        <h1 class="task-detail-title">{taskValue().title}</h1>
                        <div class="task-detail-meta-row">
                          <Show when={taskValue().displayKey?.trim()}>
                            {(displayKey) => (
                              <span class="projects-list-meta">
                                {displayKey()}
                              </span>
                            )}
                          </Show>
                          <span
                            class={`project-task-status project-task-status--${taskValue().status}`}
                          >
                            {formatStatus(taskValue().status)}
                          </span>
                          <Show
                            when={
                              taskValue().targetRepositoryName ||
                              taskValue().targetRepositoryPath
                            }
                          >
                            <span class="projects-default-badge">
                              {repositoryLabel(taskValue())}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="task-detail-header-actions">
                        <button
                          type="button"
                          class="projects-button-muted"
                          disabled
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="projects-button-muted"
                          disabled
                        >
                          Change status
                        </button>
                        <button
                          type="button"
                          class="projects-button-primary"
                          disabled
                        >
                          Start run
                        </button>
                      </div>
                    </div>
                    <div class="task-detail-summary-strip">
                      <div class="task-detail-summary-item">
                        <span class="task-detail-summary-label">Project</span>
                        <span class="task-detail-summary-value">
                          {projectLabel(projectName())}
                        </span>
                      </div>
                      <div class="task-detail-summary-item">
                        <span class="task-detail-summary-label">Scope</span>
                        <span class="task-detail-summary-value">
                          {repositoryLabel(taskValue())}
                        </span>
                      </div>
                      <div class="task-detail-summary-item">
                        <span class="task-detail-summary-label">Created</span>
                        <span class="task-detail-summary-value">
                          Unavailable
                        </span>
                      </div>
                      <div class="task-detail-summary-item">
                        <span class="task-detail-summary-label">Updated</span>
                        <span class="task-detail-summary-value">
                          {formatDateTime(taskValue().updatedAt)}
                        </span>
                      </div>
                      <div class="task-detail-summary-item">
                        <span class="task-detail-summary-label">Status</span>
                        <span class="task-detail-summary-value">
                          {formatStatus(taskValue().status)}
                        </span>
                      </div>
                    </div>
                  </header>

                  <div class="task-detail-columns">
                    <div class="task-detail-main-column">
                      <section class="projects-panel">
                        <h2 class="project-section-title">Description</h2>
                        <Show
                          when={taskValue().description?.trim()}
                          fallback={
                            <p class="project-placeholder-text">
                              No description yet
                            </p>
                          }
                        >
                          {(description) => (
                            <p class="project-placeholder-text">
                              {description()}
                            </p>
                          )}
                        </Show>
                      </section>

                      <section class="projects-panel">
                        <h2 class="project-section-title">
                          Notes and criteria
                        </h2>
                        <p class="project-placeholder-text">
                          Add acceptance notes, constraints, and delivery
                          criteria.
                        </p>
                      </section>

                      <section class="projects-panel">
                        <h2 class="project-section-title">
                          Activity and comments
                        </h2>
                        <p class="project-placeholder-text">
                          Team discussion and timeline activity will appear
                          here.
                        </p>
                      </section>
                    </div>

                    <aside class="task-detail-inspector-column">
                      <section class="projects-panel">
                        <h2 class="project-section-title">
                          Context and metadata
                        </h2>
                        <dl class="task-detail-definition-list">
                          <div>
                            <dt>Project</dt>
                            <dd>{projectLabel(projectName())}</dd>
                          </div>
                          <div>
                            <dt>Scope</dt>
                            <dd>{repositoryLabel(taskValue())}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{formatStatus(taskValue().status)}</dd>
                          </div>
                          <div>
                            <dt>Created</dt>
                            <dd>Unavailable</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatDateTime(taskValue().updatedAt)}</dd>
                          </div>
                        </dl>
                      </section>

                      <section class="projects-panel">
                        <h2 class="project-section-title">Runs</h2>
                        <p class="project-placeholder-text">
                          Task runs will be listed here once execution wiring
                          lands.
                        </p>
                      </section>

                      <section class="projects-panel">
                        <h2 class="project-section-title">Quick actions</h2>
                        <p class="project-placeholder-text">
                          Edit, status transitions, and run controls are
                          available in the header for now.
                        </p>
                      </section>
                    </aside>
                  </div>
                </div>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </>
  );
};

export default TaskDetailPage;
