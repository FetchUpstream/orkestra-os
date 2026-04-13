// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
  For,
  Show,
  createEffect,
  createSignal,
  type Component,
} from "solid-js";
import { A, useLocation } from "@solidjs/router";
import RunSettingsModal from "../../runs/components/RunSettingsModal";
import BlockedTaskModal from "../../tasks/components/BlockedTaskModal";
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

  createEffect(() => {
    const projectId =
      new URLSearchParams(location.search).get("projectId") ?? "";
    if (!projectId || projectId === model.selectedProjectId()) return;
    void model.onProjectChange(projectId);
  });

  createEffect(() => {
    const onSearchQuery = (event: Event) => {
      const customEvent = event as CustomEvent<{ query?: string }>;
      model.setSearchQuery(customEvent.detail?.query ?? "");
    };

    window.addEventListener("board:search-query", onSearchQuery);
    return () =>
      window.removeEventListener("board:search-query", onSearchQuery);
  });

  return (
    <div class="flex min-h-full flex-col">
      <Show when={model.error()}>
        {(message) => (
          <p class="projects-error border-error/35 bg-error/10 text-sm">
            {message()}
          </p>
        )}
      </Show>

      <Show when={model.isSearchActive()}>
        <p
          class="text-base-content/60 px-1 py-2 text-xs"
          role="status"
          aria-live="polite"
        >
          <Show
            when={!model.isSearchLoading()}
            fallback={<span>Searching…</span>}
          >
            <Show
              when={model.searchMatchCount() > 0}
              fallback={<span>No matches</span>}
            >
              <span>{model.searchMatchCount()} match(es)</span>
            </Show>
          </Show>
        </p>
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
        <div class="board-columns min-h-0 flex-1">
          <For each={BOARD_COLUMNS}>
            {(column) => (
              <section
                class="board-column border-base-content/10 flex flex-col border-l p-0 first:border-l-0"
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
                            runMiniCards={model.taskRunMiniCards()[task.id]}
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
      <RunSettingsModal
        isOpen={model.isRunSettingsModalOpen}
        isSubmitting={model.isConfirmingMoveTaskToInProgress}
        actionError={model.error}
        hasRunSelectionOptions={model.hasRunSelectionOptions}
        isOpenCodeMissing={model.isOpenCodeMissing}
        isLoadingRunSelectionOptions={model.isLoadingRunSelectionOptions}
        isLoadingRunSourceBranches={model.isLoadingRunSourceBranches}
        openCodeDependencyReason={model.openCodeDependencyReason}
        runSelectionOptionsError={model.runSelectionOptionsError}
        runSourceBranchError={model.runSourceBranchError}
        runAgentOptions={model.runAgentOptions}
        runProviderOptions={model.runProviderOptions}
        runSourceBranchOptions={model.runSourceBranchOptions}
        visibleRunModelOptions={model.visibleRunModelOptions}
        selectedRunAgentId={model.selectedRunAgentId}
        selectedRunProviderId={model.selectedRunProviderId}
        selectedRunModelId={model.selectedRunModelId}
        selectedRunSourceBranch={model.selectedRunSourceBranch}
        setSelectedRunAgentId={model.setSelectedRunAgentId}
        setSelectedRunProviderId={model.setSelectedRunProviderId}
        setSelectedRunModelId={model.setSelectedRunModelId}
        setSelectedRunSourceBranch={model.setSelectedRunSourceBranch}
        onCancel={model.onCancelMoveTaskToInProgress}
        onConfirm={model.onConfirmMoveTaskToInProgress}
      />
      <BlockedTaskModal
        isOpen={model.isBlockedTaskModalOpen}
        blockingTasks={model.blockingStartTasks}
        onClose={model.onCloseBlockedTaskModal}
      />
    </div>
  );
};

export default BoardScreen;
