import { createSignal, onMount, Show, type Component } from "solid-js";
import { useParams } from "@solidjs/router";
import { getTask, type Task } from "../app/lib/tasks";
import PageHeader from "../components/layout/PageHeader";

const TaskDetailPage: Component = () => {
  const params = useParams();
  const [task, setTask] = createSignal<Task | null>(null);
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
    } catch {
      setError("Failed to load task details.");
    } finally {
      setIsLoading(false);
    }
  });

  return (
    <>
      <PageHeader title={`Task ${params.taskId}`} />
      <Show when={!error()} fallback={<p class="projects-error">{error()}</p>}>
        <Show when={!isLoading()} fallback={<p class="page-placeholder">Loading task details...</p>}>
          <Show when={task()} fallback={<p class="page-placeholder">Task not found.</p>}>
            {(taskValue) => (
              <section class="projects-panel">
                <h2 class="project-section-title">Task Detail</h2>
                <p class="projects-list-name">{taskValue().title}</p>
                <p class="projects-list-meta">Status: {taskValue().status}</p>
                <p class="projects-list-meta">Repository: {taskValue().targetRepositoryName || taskValue().targetRepositoryPath || "Not set"}</p>
                <Show when={taskValue().description?.trim()}>
                  {(description) => <p class="project-placeholder-text">{description()}</p>}
                </Show>
              </section>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default TaskDetailPage;
