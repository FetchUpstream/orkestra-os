import { For, Show, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";
import type { TaskStatus } from "../../../app/lib/tasks";
import { formatTaskStatus, TASK_STATUSES } from "../utils/projectDetail";

type Props = {
  isOpen: () => boolean;
  project: () => Project | null;
  taskTitle: () => string;
  taskDescription: () => string;
  taskImplementationGuide: () => string;
  taskStatus: () => TaskStatus;
  targetRepositoryId: () => string;
  taskFormError: () => string;
  isSubmittingTask: () => boolean;
  setIsModalOpen: (open: boolean) => void;
  setTaskTitle: (value: string) => void;
  setTaskDescription: (value: string) => void;
  setTaskImplementationGuide: (value: string) => void;
  setTaskStatus: (value: TaskStatus) => void;
  setTargetRepositoryId: (value: string) => void;
  onCreateTask: (event: Event) => Promise<void>;
};

const CreateTaskModal: Component<Props> = (props) => (
  <Show when={props.isOpen()}>
    <div
      class="projects-modal-backdrop"
      role="presentation"
      onClick={() => props.setIsModalOpen(false)}
    >
      <div
        class="projects-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-task-title" class="form-section-title">
          Create Task
        </h2>
        <form class="projects-form" onSubmit={props.onCreateTask}>
          <div class="projects-field">
            <label for="task-title" class="field-label">
              Title
            </label>
            <input
              id="task-title"
              value={props.taskTitle()}
              onInput={(event) => props.setTaskTitle(event.currentTarget.value)}
              aria-invalid={props.taskFormError() ? "true" : "false"}
            />
          </div>
          <div class="projects-field">
            <label for="task-description" class="field-label">
              Description <span class="field-optional">optional</span>
            </label>
            <textarea
              id="task-description"
              value={props.taskDescription()}
              onInput={(event) =>
                props.setTaskDescription(event.currentTarget.value)
              }
            />
          </div>
          <div class="projects-field">
            <label for="task-implementation-guide" class="field-label">
              Implementation guide <span class="field-optional">optional</span>
            </label>
            <textarea
              id="task-implementation-guide"
              value={props.taskImplementationGuide()}
              onInput={(event) =>
                props.setTaskImplementationGuide(event.currentTarget.value)
              }
              aria-label="Task implementation guide"
            />
          </div>
          <div class="projects-field">
            <label for="task-target-repository" class="field-label">
              Target repository
            </label>
            <select
              id="task-target-repository"
              value={props.targetRepositoryId()}
              onChange={(event) =>
                props.setTargetRepositoryId(event.currentTarget.value)
              }
            >
              <For each={props.project()?.repositories ?? []}>
                {(repository) => (
                  <option value={repository.id ?? ""}>
                    {repository.name || repository.path}
                  </option>
                )}
              </For>
            </select>
          </div>
          <div class="projects-field">
            <label for="task-status" class="field-label">
              Status
            </label>
            <select
              id="task-status"
              value={props.taskStatus()}
              onChange={(event) =>
                props.setTaskStatus(event.currentTarget.value as TaskStatus)
              }
            >
              <For each={TASK_STATUSES}>
                {(status) => (
                  <option value={status}>{formatTaskStatus(status)}</option>
                )}
              </For>
            </select>
          </div>
          <Show when={props.taskFormError()}>
            {(formError) => <p class="field-error">{formError()}</p>}
          </Show>
          <div class="form-actions">
            <button
              type="button"
              class="projects-button-muted"
              onClick={() => props.setIsModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="projects-button-primary"
              disabled={props.isSubmittingTask()}
            >
              {props.isSubmittingTask() ? "Creating..." : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Show>
);

export default CreateTaskModal;
