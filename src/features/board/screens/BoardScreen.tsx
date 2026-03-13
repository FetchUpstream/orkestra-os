import { For, Show, createSignal, type Component } from "solid-js";
import { A } from "@solidjs/router";
import PageHeader from "../../../components/layout/PageHeader";
import BoardTaskCard from "../components/BoardTaskCard";
import { useBoardModel } from "../model/useBoardModel";
import { BOARD_COLUMNS } from "../utils/board";
import type { TaskStatus } from "../../../app/lib/tasks";

const BoardScreen: Component = () => {
  const model = useBoardModel();
  const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);
  const [activeDropStatus, setActiveDropStatus] =
    createSignal<TaskStatus | null>(null);

  const onTaskDragStart = (taskId: string, event: DragEvent) => {
    event.stopPropagation();
    setDraggingTaskId(taskId);
    if (!event.dataTransfer) return;
    event.dataTransfer.setData("text/plain", taskId);
    event.dataTransfer.setData("application/x-orkestra-task", taskId);
    event.dataTransfer.effectAllowed = "move";
  };

  const resetDragState = () => {
    setDraggingTaskId(null);
    setActiveDropStatus(null);
  };

  const onColumnDrop = (status: TaskStatus, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedTaskId =
      event.dataTransfer?.getData("application/x-orkestra-task") ||
      event.dataTransfer?.getData("text/plain") ||
      draggingTaskId();
    resetDragState();
    if (!droppedTaskId) return;
    void model.moveTaskToStatus(droppedTaskId, status);
  };

  return (
    <>
      <PageHeader title="Board" />

      <section class="projects-panel" aria-label="Project selector">
        <div class="projects-field" style={{ "max-width": "320px" }}>
          <label
            for="board-project"
            id="board-project-selector"
            class="field-label"
          >
            Project
          </label>
          <select
            id="board-project"
            value={model.selectedProjectId()}
            onChange={(event) =>
              void model.onProjectChange(event.currentTarget.value)
            }
            disabled={
              model.isProjectsLoading() || model.projects().length === 0
            }
          >
            <For each={model.projects()}>
              {(project) => (
                <option value={project.id}>
                  {project.name} ({project.key})
                </option>
              )}
            </For>
          </select>
        </div>
      </section>

      <Show when={model.error()}>
        {(message) => <p class="projects-error">{message()}</p>}
      </Show>

      <Show
        when={!model.isProjectsLoading() && model.projects().length > 0}
        fallback={
          <p class="page-placeholder">
            No projects yet.{" "}
            <A href="/projects">Create a project to get started.</A>
          </p>
        }
      >
        <div
          style={{
            display: "grid",
            gap: "12px",
            "grid-template-columns": "repeat(4, minmax(0, 1fr))",
            "align-items": "start",
          }}
        >
          <For each={BOARD_COLUMNS}>
            {(column) => (
              <section
                class="projects-panel"
                aria-labelledby={`board-column-${column.status}`}
                data-board-status={column.status}
                style={{
                  transition: "box-shadow 0.2s ease",
                  "box-shadow":
                    activeDropStatus() === column.status
                      ? "inset 0 0 0 2px var(--accent)"
                      : "none",
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "move";
                  }
                  setActiveDropStatus(column.status);
                }}
                onDragLeave={() => {
                  if (activeDropStatus() === column.status) {
                    setActiveDropStatus(null);
                  }
                }}
                onDrop={(event) => onColumnDrop(column.status, event)}
              >
                <div class="project-section-header">
                  <h3
                    id={`board-column-${column.status}`}
                    class="projects-section-title"
                  >
                    {column.label} ({model.groupedTasks()[column.status].length}
                    )
                  </h3>
                </div>

                <Show
                  when={!model.isTasksLoading()}
                  fallback={<p class="project-placeholder-text">Loading...</p>}
                >
                  <Show
                    when={model.groupedTasks()[column.status].length > 0}
                    fallback={<p class="project-placeholder-text">No tasks.</p>}
                  >
                    <ul class="project-task-list" role="list">
                      <For each={model.groupedTasks()[column.status]}>
                        {(task) => (
                          <BoardTaskCard
                            task={task}
                            project={model.selectedProject()}
                            isDragging={draggingTaskId() === task.id}
                            isStatusUpdating={model.isTaskStatusUpdating(
                              task.id,
                            )}
                            onDragStart={onTaskDragStart}
                            onDragEnd={resetDragState}
                          />
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </section>
            )}
          </For>
        </div>
      </Show>
    </>
  );
};

export default BoardScreen;
