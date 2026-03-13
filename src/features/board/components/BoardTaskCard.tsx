import { A } from "@solidjs/router";
import { Show, createSignal, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { Task } from "../../../app/lib/tasks";
import { taskDisplayKey } from "../../projects/utils/projectDetail";
import { taskPriorityLabel } from "../utils/board";

type Props = {
  task: Task;
  project: Project | null;
  isDragging?: boolean;
  isStatusUpdating?: boolean;
  onDragStart?: (taskId: string, event: DragEvent) => void;
  onDragEnd?: () => void;
};

const BoardTaskCard: Component<Props> = (props) => {
  const [dragJustEnded, setDragJustEnded] = createSignal(false);
  const repositoryTag = () =>
    props.task.targetRepositoryName || props.task.targetRepositoryPath || "";

  const onDragStart = (event: DragEvent) => {
    setDragJustEnded(false);
    if (event.dataTransfer) {
      const dragImage = document.createElement("canvas");
      dragImage.width = 1;
      dragImage.height = 1;
      if (typeof event.dataTransfer.setDragImage === "function") {
        event.dataTransfer.setDragImage(dragImage, 0, 0);
      }
    }
    props.onDragStart?.(props.task.id, event);
  };

  const onDragEnd = () => {
    setDragJustEnded(true);
    window.setTimeout(() => setDragJustEnded(false), 0);
    props.onDragEnd?.();
  };

  return (
    <li
      class="project-task-item"
      draggable={!props.isStatusUpdating}
      style={{
        opacity: props.isDragging ? "0.5" : "1",
        transition: "opacity 0.2s ease",
        cursor: props.isStatusUpdating ? "wait" : "grab",
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        aria-hidden="true"
        style={{
          "font-size": "0.75rem",
          opacity: "0.7",
          "margin-bottom": "4px",
          "user-select": "none",
        }}
      >
        Drag to move
      </div>
      <A
        href={`/tasks/${props.task.id}?origin=board`}
        class="project-task-link"
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
        </div>
      </A>
    </li>
  );
};

export default BoardTaskCard;
