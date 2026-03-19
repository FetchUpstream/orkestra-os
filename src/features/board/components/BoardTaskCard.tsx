import { A } from "@solidjs/router";
import { Show, createSignal, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { Task } from "../../../app/lib/tasks";
import type { BoardTaskRunMiniCard } from "../model/useBoardModel";
import {
  dependencyBadgeState,
  taskDisplayKey,
} from "../../projects/utils/projectDetail";

type Props = {
  task: Task;
  project: Project | null;
  runMiniCard?: BoardTaskRunMiniCard;
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
    props.task.status !== "done" && !!props.runMiniCard;
  const isRunStateActive = () => {
    const state = props.runMiniCard?.state;
    return state === "coding" || state === "committing";
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

  return (
    <li
      class="project-task-item board-task-card"
      classList={{
        "board-task-card--dragging": Boolean(props.isDragging),
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
        class="project-task-link"
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          if (dragJustEnded() || props.isDragging) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div class="project-task-main">
          <p class="project-task-title">{props.task.title}</p>
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
            <p class="board-task-description">{props.task.description}</p>
          </Show>
          <span class="project-key-badge board-task-key-tag">
            {taskDisplayKey(props.task, props.project) || "Task"}
          </span>
        </div>
      </A>
      <Show when={showRunMiniCard() && props.runMiniCard}>
        {(miniCard) => (
          <Show
            when={miniCard().isNavigable}
            fallback={
              <div class="board-task-run-details" aria-label="Run Details">
                <p class="board-task-run-details-title">Run Details</p>
                <p class="run-inline-loading-row board-task-run-details-row">
                  <Show
                    when={isRunStateActive()}
                    fallback={
                      <span class="board-task-run-warning" aria-hidden="true">
                        !
                      </span>
                    }
                  >
                    <span class="run-inline-spinner" aria-hidden="true" />
                  </Show>
                  <span>{miniCard().label}</span>
                </p>
              </div>
            }
          >
            <A
              href={`/runs/${miniCard().runId}?origin=board`}
              class="board-task-run-details board-task-run-details-link"
              aria-label="Run Details"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <p class="board-task-run-details-title">Run Details</p>
              <p class="run-inline-loading-row board-task-run-details-row">
                <Show
                  when={isRunStateActive()}
                  fallback={
                    <span class="board-task-run-warning" aria-hidden="true">
                      !
                    </span>
                  }
                >
                  <span class="run-inline-spinner" aria-hidden="true" />
                </Show>
                <span>{miniCard().label}</span>
              </p>
            </A>
          </Show>
        )}
      </Show>
    </li>
  );
};

export default BoardTaskCard;
