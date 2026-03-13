import { A } from "@solidjs/router";
import { Show, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { Task } from "../../../app/lib/tasks";
import { taskDisplayKey } from "../../projects/utils/projectDetail";
import { taskPriorityLabel } from "../utils/board";

type Props = {
  task: Task;
  project: Project | null;
};

const BoardTaskCard: Component<Props> = (props) => {
  const repositoryTag = () =>
    props.task.targetRepositoryName || props.task.targetRepositoryPath || "";

  return (
    <li class="project-task-item">
      <A href={`/tasks/${props.task.id}`} class="project-task-link">
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
