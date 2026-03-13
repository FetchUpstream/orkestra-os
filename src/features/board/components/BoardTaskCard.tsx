import { A } from "@solidjs/router";
import { Show, type Component } from "solid-js";
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
  const repositoryTag = () =>
    props.task.targetRepositoryName || props.task.targetRepositoryPath || "";

  return (
    <li
      class="project-task-item"
      draggable={!props.isStatusUpdating}
      style={{
        opacity: props.isDragging ? "0.5" : "1",
        transition: "opacity 0.2s ease",
        cursor: props.isStatusUpdating ? "wait" : "grab",
      }}
      onDragStart={(event) => props.onDragStart?.(props.task.id, event)}
      onDragEnd={() => props.onDragEnd?.()}
    >
      <A
        href={`/tasks/${props.task.id}?origin=board`}
        class="project-task-link"
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
