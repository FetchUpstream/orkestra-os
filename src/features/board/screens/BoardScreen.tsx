import {
  For,
  Show,
  createEffect,
  createSignal,
  type Component,
} from "solid-js";
import { A, useLocation } from "@solidjs/router";
import CreateTaskModal from "../../projects/components/CreateTaskModal";
import { useCreateTaskModalModel } from "../../projects/model/useCreateTaskModalModel";
import RunSettingsModal from "../../runs/components/RunSettingsModal";
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
  const location = useLocation();
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
    if (status === "doing") {
      model.onRequestMoveTaskToInProgress(droppedTaskId);
      return;
    }
    void model.moveTaskToStatus(droppedTaskId, status);
  };

  const totalBoardTasks = () =>
    Object.values(model.groupedTasks()).reduce(
      (count, tasks) => count + tasks.length,
      0,
    );

  createEffect(() => {
    const projectId =
      new URLSearchParams(location.search).get("projectId") ?? "";
    if (!projectId || projectId === model.selectedProjectId()) return;
    void model.onProjectChange(projectId);
  });

  createEffect(() => {
    const onCreateTask = () => {
      if ((model.selectedProjectDetail()?.repositories.length ?? 0) <= 0)
        return;
      taskCreateModel.resetTaskForm();
      taskCreateModel.setIsModalOpen(true);
    };

    window.addEventListener("board:create-task", onCreateTask);
    return () => window.removeEventListener("board:create-task", onCreateTask);
  });

  return (
    <>
      <div class="border-base-content/10 mb-3 flex flex-col gap-3 border-b px-4 pt-3 pb-3">
        <div class="flex min-w-0 items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-base-content text-[15px] font-semibold tracking-[0.01em]">
              {model.selectedProjectDetail()?.name ?? "Board"}
            </div>
          </div>
        </div>
        <section class="flex flex-wrap items-center gap-2">
          <span class="badge badge-outline border-base-content/10 text-base-content/50 rounded-none border px-2 text-[10px]">
            {totalBoardTasks()} total
          </span>
        </section>
      </div>

      <Show when={model.error()}>
        {(message) => (
          <p class="projects-error border-error/35 bg-error/10 text-sm">
            {message()}
          </p>
        )}
      </Show>

      <Show
        when={!model.isProjectsLoading() && model.projects().length > 0}
        fallback={
          <section class="projects-panel border-base-content/15 bg-base-200/40 border border-dashed p-6">
            <p class="page-placeholder m-0 text-sm">
              No projects yet.{" "}
              <A href="/projects">Create a project to get started.</A>
            </p>
          </section>
        }
      >
        <div class="board-columns items-start">
          <For each={BOARD_COLUMNS}>
            {(column) => (
              <section
                class="board-column border-base-content/10 flex min-h-[34rem] flex-col border-l bg-transparent p-0 first:border-l-0"
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
                <div class="project-section-header border-base-content/10 flex items-center justify-between border-b px-3 py-3">
                  <h3
                    id={`board-column-${column.status}`}
                    aria-label={`${column.label} (${model.groupedTasks()[column.status].length})`}
                    class="projects-section-title text-base-content/55 m-0 text-[11px] tracking-[0.24em] uppercase"
                  >
                    {column.label} ({model.groupedTasks()[column.status].length}
                    )
                  </h3>
                  <span class="badge badge-ghost border-base-content/10 text-base-content/55 rounded-none border px-2 text-[10px]">
                    {model.groupedTasks()[column.status].length}
                  </span>
                </div>

                <Show
                  when={!model.isTasksLoading()}
                  fallback={
                    <p class="project-placeholder-text px-4 py-4 text-sm">
                      Loading...
                    </p>
                  }
                >
                  <Show
                    when={model.groupedTasks()[column.status].length > 0}
                    fallback={
                      <div class="flex flex-1 items-start px-4 py-4">
                        <p class="project-placeholder-text text-sm">
                          No tasks.
                        </p>
                      </div>
                    }
                  >
                    <ul class="project-task-list flex-1 px-2 pt-2" role="list">
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

      <RunSettingsModal
        isOpen={model.isRunSettingsModalOpen}
        isSubmitting={model.isConfirmingMoveTaskToInProgress}
        hasRunSelectionOptions={model.hasRunSelectionOptions}
        isLoadingRunSelectionOptions={model.isLoadingRunSelectionOptions}
        runSelectionOptionsError={model.runSelectionOptionsError}
        runAgentOptions={model.runAgentOptions}
        runProviderOptions={model.runProviderOptions}
        visibleRunModelOptions={model.visibleRunModelOptions}
        selectedRunAgentId={model.selectedRunAgentId}
        selectedRunProviderId={model.selectedRunProviderId}
        selectedRunModelId={model.selectedRunModelId}
        setSelectedRunAgentId={model.setSelectedRunAgentId}
        setSelectedRunProviderId={model.setSelectedRunProviderId}
        setSelectedRunModelId={model.setSelectedRunModelId}
        onCancel={model.onCancelMoveTaskToInProgress}
        onConfirm={model.onConfirmMoveTaskToInProgress}
      />
    </>
  );
};

export default BoardScreen;
