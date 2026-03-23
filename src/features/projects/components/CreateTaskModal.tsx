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
        class="projects-modal border-base-content/15 bg-base-200 rounded-none border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="border-base-content/10 mb-4 border-b pb-3">
          <h2 id="create-task-title" class="form-section-title m-0 text-sm">
            Create Task
          </h2>
          <p class="text-base-content/55 mt-1 text-xs">
            Add a task within the current project workspace.
          </p>
        </div>
        <form class="projects-form" onSubmit={props.onCreateTask}>
          <div class="projects-field">
            <label
              for="task-title"
              class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase"
            >
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
            <label
              for="task-description"
              class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase"
            >
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
            <label
              for="task-implementation-guide"
              class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase"
            >
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
            <label
              for="task-target-repository"
              class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase"
            >
              Target repository
            </label>
            <select
              id="task-target-repository"
              class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
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
            <label
              for="task-status"
              class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase"
            >
              Status
            </label>
            <select
              id="task-status"
              class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
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
              class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
              onClick={() => props.setIsModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
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
