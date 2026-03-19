import { For, Show, createSignal, type Component } from "solid-js";
import { A } from "@solidjs/router";
import PageHeader from "../../../components/layout/PageHeader";
import CreateTaskModal from "../../projects/components/CreateTaskModal";
import { useCreateTaskModalModel } from "../../projects/model/useCreateTaskModalModel";
import BoardTaskCard from "../components/BoardTaskCard";
import { useBoardModel } from "../model/useBoardModel";
import { BOARD_COLUMNS } from "../utils/board";
import type { TaskStatus } from "../../../app/lib/tasks";

const BOARD_TASK_TRANSFER_TYPE = "application/x-orkestra-task";

const isUrlLikePayload = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("/")
  );
};

const resolveDroppedTaskId = (
  event: DragEvent,
  draggingTaskId: string | null,
) => {
  const appPayload = (
    event.dataTransfer?.getData(BOARD_TASK_TRANSFER_TYPE) ?? ""
  ).trim();
  if (appPayload) {
    return appPayload;
  }

  const plainPayload = (event.dataTransfer?.getData("text/plain") ?? "").trim();
  if (plainPayload && !isUrlLikePayload(plainPayload)) {
    return plainPayload;
  }

  return draggingTaskId;
};

const BoardScreen: Component = () => {
  const model = useBoardModel();
  const taskCreateModel = useCreateTaskModalModel({
    project: model.selectedProjectDetail,
    projectId: model.selectedProjectId,
    onTaskCreated: async () => {
      await model.refreshSelectedProjectTasks();
    },
  });
  const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);
  const [activeDropStatus, setActiveDropStatus] =
    createSignal<TaskStatus | null>(null);

  const onTaskDragStart = (taskId: string, event: DragEvent) => {
    event.stopPropagation();
    setDraggingTaskId(taskId);
    if (!event.dataTransfer) return;
    event.dataTransfer.setData("text/plain", taskId);
    event.dataTransfer.setData(BOARD_TASK_TRANSFER_TYPE, taskId);
    event.dataTransfer.effectAllowed = "move";
  };

  const resetDragState = () => {
    setDraggingTaskId(null);
    setActiveDropStatus(null);
  };

  const onColumnDrop = (status: TaskStatus, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedTaskId = resolveDroppedTaskId(event, draggingTaskId());
    if (
      !droppedTaskId ||
      !model.canTaskTransitionToStatus(droppedTaskId, status)
    ) {
      resetDragState();
      return;
    }
    resetDragState();
    void model.moveTaskToStatus(droppedTaskId, status);
  };

  return (
    <>
      <PageHeader title="Board" />

      <section class="projects-panel" aria-label="Project selector">
        <div class="project-section-header">
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
          <Show
            when={(model.selectedProjectDetail()?.repositories.length ?? 0) > 0}
          >
            <button
              type="button"
              class="projects-button-primary"
              onClick={() => {
                taskCreateModel.resetTaskForm();
                taskCreateModel.setIsModalOpen(true);
              }}
            >
              New task
            </button>
          </Show>
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
        <div class="board-columns">
          <For each={BOARD_COLUMNS}>
            {(column) => (
              <section
                class="projects-panel board-column"
                classList={{
                  "board-column--drop-active":
                    activeDropStatus() === column.status,
                }}
                aria-labelledby={`board-column-${column.status}`}
                data-board-status={column.status}
                onDragOver={(event) => {
                  const droppedTaskId = resolveDroppedTaskId(
                    event,
                    draggingTaskId(),
                  );
                  const canDrop =
                    !!droppedTaskId &&
                    model.canTaskTransitionToStatus(
                      droppedTaskId,
                      column.status,
                    );
                  if (!canDrop) {
                    if (activeDropStatus() === column.status) {
                      setActiveDropStatus(null);
                    }
                    return;
                  }

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
                            runMiniCard={model.taskRunMiniCards()[task.id]}
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

      <CreateTaskModal
        isOpen={taskCreateModel.isModalOpen}
        project={model.selectedProjectDetail}
        taskTitle={taskCreateModel.taskTitle}
        taskDescription={taskCreateModel.taskDescription}
        taskImplementationGuide={taskCreateModel.taskImplementationGuide}
        taskStatus={taskCreateModel.taskStatus}
        targetRepositoryId={taskCreateModel.targetRepositoryId}
        taskFormError={taskCreateModel.taskFormError}
        isSubmittingTask={taskCreateModel.isSubmittingTask}
        setIsModalOpen={taskCreateModel.setIsModalOpen}
        setTaskTitle={taskCreateModel.setTaskTitle}
        setTaskDescription={taskCreateModel.setTaskDescription}
        setTaskImplementationGuide={taskCreateModel.setTaskImplementationGuide}
        setTaskStatus={taskCreateModel.setTaskStatus}
        setTargetRepositoryId={taskCreateModel.setTargetRepositoryId}
        onCreateTask={taskCreateModel.onCreateTask}
      />
    </>
  );
};

export default BoardScreen;
