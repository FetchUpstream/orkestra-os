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

import { A } from "@solidjs/router";
import { For, Show, createSignal, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { Task } from "../../../app/lib/tasks";
import RunInlineLoader from "../../../components/ui/RunInlineLoader";
import type { BoardTaskRunMiniCard } from "../model/useBoardModel";
import {
  dependencyBadgeState,
  taskDisplayKey,
} from "../../projects/utils/projectDetail";

type Props = {
  task: Task;
  project: Project | null;
  runMiniCards?: BoardTaskRunMiniCard[];
  isDragging?: boolean;
  isStatusUpdating?: boolean;
  onDragStart?: (taskId: string, event: DragEvent) => void;
  onDragEnd?: () => void;
};

const BoardTaskCard: Component<Props> = (props) => {
  const [dragJustEnded, setDragJustEnded] = createSignal(false);
  const dependencyState = () => dependencyBadgeState(props.task);
  const showDependencyBadge = () =>
    props.task.status === "todo" && dependencyState() !== "none";
  const showRunMiniCard = () =>
    props.task.status !== "done" && (props.runMiniCards?.length ?? 0) > 0;
  const isRunStateActive = (miniCard: BoardTaskRunMiniCard) => {
    const state = miniCard.state;
    return (
      state === "warming_up" ||
      state === "busy_coding" ||
      state === "committing_changes" ||
      state === "resolving_rebase_conflicts"
    );
  };
  const runStateIcon = (miniCard: BoardTaskRunMiniCard) => {
    switch (miniCard.state) {
      case "ready_to_merge":
        return <span class="text-success font-semibold">✓</span>;
      case "question_pending":
        return <span class="board-task-run-warning font-semibold">?</span>;
      case "permission_requested":
        return <span class="board-task-run-warning font-semibold">?</span>;
      case "waiting_for_input":
        return <span class="board-task-run-warning font-semibold">…</span>;
      default:
        return <span class="board-task-run-warning font-semibold">…</span>;
    }
  };

  const onDragStart = (event: DragEvent) => {
    setDragJustEnded(false);
    props.onDragStart?.(props.task.id, event);
  };

  const onDragEnd = () => {
    setDragJustEnded(true);
    window.setTimeout(() => setDragJustEnded(false), 0);
    props.onDragEnd?.();
  };

  const suppressChildLinkDrag = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const forwardTaskDragStart = (event: DragEvent) => {
    event.stopPropagation();
    onDragStart(event);
  };

  const forwardTaskDragEnd = (event: DragEvent) => {
    event.stopPropagation();
    onDragEnd();
  };

  return (
    <li
      class="project-task-item board-task-card border-l-2 border-l-transparent bg-transparent"
      classList={{
        "board-task-card--dragging": Boolean(props.isDragging),
        "opacity-60": Boolean(props.isStatusUpdating),
      }}
      draggable={!props.isStatusUpdating}
      style={{
        cursor: props.isStatusUpdating
          ? "wait"
          : props.isDragging
            ? "grabbing"
            : "grab",
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <A
        href={`/tasks/${props.task.id}?origin=board`}
        class="project-task-link flex flex-col gap-2"
        draggable={false}
        onDragStart={suppressChildLinkDrag}
        onClick={(event) => {
          if (dragJustEnded() || props.isDragging) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div class="project-task-main gap-2">
          <div class="flex items-start justify-between gap-3">
            <p class="project-task-title text-[13px] font-medium">
              {props.task.title}
            </p>
            <span class="project-key-badge board-task-key-tag border-base-content/10 bg-base-100 text-base-content/65 mt-0 shrink-0 self-start border px-2 py-1 text-[10px]">
              {taskDisplayKey(props.task, props.project) || "Task"}
            </span>
          </div>
          <Show when={showDependencyBadge()}>
            <span
              class={
                dependencyState() === "blocked"
                  ? "project-task-blocked"
                  : "project-task-ready"
              }
            >
              {dependencyState() === "blocked" ? "Blocked" : "Ready"}
            </span>
          </Show>
          <div class="board-task-title-separator" aria-hidden="true" />
          <Show when={props.task.description?.trim()}>
            <p class="board-task-description text-base-content/65 text-xs">
              {props.task.description}
            </p>
          </Show>
        </div>
      </A>
      <Show when={showRunMiniCard() && props.runMiniCards}>
        {(miniCards) => (
          <div class="mt-1 flex flex-col gap-1">
            <For each={miniCards()}>
              {(miniCard) => (
                <Show
                  when={miniCard.isNavigable}
                  fallback={
                    <div
                      class="board-task-run-details"
                      data-run-id={miniCard.runId}
                      aria-label="Run Details"
                      draggable={!props.isStatusUpdating}
                      onDragStart={forwardTaskDragStart}
                      onDragEnd={forwardTaskDragEnd}
                    >
                      <p class="board-task-run-details-title">Run Details</p>
                      <Show
                        when={isRunStateActive(miniCard)}
                        fallback={
                          <p class="run-inline-loading-row board-task-run-details-row">
                            <span aria-hidden="true">
                              {runStateIcon(miniCard)}
                            </span>
                            <span>{miniCard.label}</span>
                          </p>
                        }
                      >
                        <RunInlineLoader
                          as="p"
                          class="board-task-run-details-row"
                          srLabel="Run pending"
                        >
                          <span>{miniCard.label}</span>
                        </RunInlineLoader>
                      </Show>
                    </div>
                  }
                >
                  <A
                    href={`/runs/${miniCard.runId}?origin=board`}
                    class="board-task-run-details board-task-run-details-link"
                    data-run-id={miniCard.runId}
                    aria-label="Run Details"
                    draggable={!props.isStatusUpdating}
                    onDragStart={forwardTaskDragStart}
                    onDragEnd={forwardTaskDragEnd}
                    onClick={(event) => {
                      if (dragJustEnded() || props.isDragging) {
                        event.preventDefault();
                      }
                      event.stopPropagation();
                    }}
                  >
                    <p class="board-task-run-details-title">Run Details</p>
                    <Show
                      when={isRunStateActive(miniCard)}
                      fallback={
                        <p class="run-inline-loading-row board-task-run-details-row">
                          <span aria-hidden="true">
                            {runStateIcon(miniCard)}
                          </span>
                          <span>{miniCard.label}</span>
                        </p>
                      }
                    >
                      <RunInlineLoader
                        as="p"
                        class="board-task-run-details-row"
                        srLabel="Run pending"
                      >
                        <span>{miniCard.label}</span>
                      </RunInlineLoader>
                    </Show>
                  </A>
                </Show>
              )}
            </For>
          </div>
        )}
      </Show>
    </li>
  );
};

export default BoardTaskCard;
