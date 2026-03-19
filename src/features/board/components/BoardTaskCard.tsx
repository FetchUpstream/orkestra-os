import { A } from "@solidjs/router";
import { Show, createSignal, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { Task } from "../../../app/lib/tasks";
import type { BoardTaskRunMiniCard } from "../model/useBoardModel";
import {
  dependencyBadgeState,
  taskDisplayKey,
} from "../../projects/utils/projectDetail";
import { taskPriorityLabel } from "../utils/board";

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
  const showRunMiniCard = () =>
    props.task.status !== "done" && !!props.runMiniCard;
  const repositoryTag = () =>
    props.task.targetRepositoryName || props.task.targetRepositoryPath || "";

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
          <p class="project-task-repo">
            {taskDisplayKey(props.task, props.project) || "Task"}
          </p>
          <Show when={repositoryTag()}>
            {(tag) => <p class="project-task-repo">{tag()}</p>}
          </Show>
          <p class="project-task-repo">{taskPriorityLabel(props.task)}</p>
          <Show when={dependencyState() !== "none"}>
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
        </div>
      </A>
      <Show when={showRunMiniCard() && props.runMiniCard}>
        {(miniCard) => (
          <A
            href={`/runs/${miniCard().runId}`}
            class="board-task-run-details board-task-run-details-link"
            aria-label="Run Details"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <p class="board-task-run-details-title">Run Details</p>
            <p class="run-inline-loading-row board-task-run-details-row">
              <Show
                when={miniCard().state === "active"}
                fallback={
                  <span class="board-task-run-check" aria-hidden="true">
                    ✓
                  </span>
                }
              >
                <span class="run-inline-spinner" aria-hidden="true" />
              </Show>
              <span>
                {miniCard().state === "active"
                  ? miniCard().label
                  : "Awaiting review"}
              </span>
            </p>
          </A>
        )}
      </Show>
    </li>
  );
};

export default BoardTaskCard;
