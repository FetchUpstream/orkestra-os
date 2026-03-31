import { For, Show, type Accessor, type Component } from "solid-js";
import type {
  Task,
  TaskDependencies,
  TaskDependencyTask,
} from "../../../app/lib/tasks";
import { AppIcon } from "../../../components/ui/icons";
import {
  dependencyDisplayLabel,
  dependencyScopeLabel,
  formatStatus,
} from "../utils/taskDetail";

export type DependencyDirection = "parent" | "child";

type TaskDependenciesSidebarProps = {
  dependencies: Accessor<TaskDependencies | null>;
  error: Accessor<string>;
  isLoading: Accessor<boolean>;
  onRetry?: () => void;
  onOpenLinkDependencyModal: (direction: DependencyDirection) => void;
  onOpenCreateDependencyModal?: (direction: DependencyDirection) => void;
  onNavigateToDependencyTask?: (dependencyTaskId: string) => void;
  onRemoveParentDependency?: (dependencyTask: TaskDependencyTask) => void;
  onRemoveChildDependency?: (dependencyTask: TaskDependencyTask) => void;
  removingParentDependencyId?: Accessor<string | null>;
  removingChildDependencyId?: Accessor<string | null>;
};

const TaskDependencyListItem: Component<{
  dependencyTask: TaskDependencyTask;
  isRemoving: boolean;
  onNavigateToDependencyTask?: (dependencyTaskId: string) => void;
  onRemoveDependency?: (dependencyTask: TaskDependencyTask) => void;
}> = (props) => {
  const isClickable = () => Boolean(props.onNavigateToDependencyTask);

  return (
    <li
      class={`task-dependency-row${isClickable() ? "task-dependency-row--clickable" : ""}`}
      role={isClickable() ? "button" : undefined}
      tabindex={isClickable() ? 0 : undefined}
      onClick={() =>
        props.onNavigateToDependencyTask?.(props.dependencyTask.id)
      }
      onKeyDown={(event) => {
        if (!isClickable()) return;
        if (event.currentTarget !== event.target) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onNavigateToDependencyTask?.(props.dependencyTask.id);
        }
      }}
    >
      <div
        class={`task-dependency-main${isClickable() ? "task-dependency-link" : ""}`}
      >
        <span class="sr-only">
          {dependencyDisplayLabel(props.dependencyTask)}
        </span>
        <div class="task-dependency-row-primary">
          <div class="task-dependency-row-leading">
            <span class="task-dependency-key">
              {props.dependencyTask.displayKey?.trim() || "Task"}
            </span>
          </div>
          <div class="task-dependency-meta">
            <span
              class={`project-task-status project-task-status--${props.dependencyTask.status}`}
            >
              {formatStatus(props.dependencyTask.status)}
            </span>
            <Show when={props.onRemoveDependency}>
              <button
                type="button"
                class="task-control-icon-button task-control-icon-button-danger task-dependency-remove-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onRemoveDependency?.(props.dependencyTask);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                  }
                }}
                disabled={props.isRemoving}
                aria-label={props.isRemoving ? "Removing" : "Remove"}
                title={props.isRemoving ? "Removing" : "Remove"}
              >
                <AppIcon name="action.delete" size={14} stroke={1.5} />
              </button>
            </Show>
          </div>
        </div>
        <p class="task-dependency-title">
          {props.dependencyTask.title?.trim() || "Untitled task"}
        </p>
      </div>
    </li>
  );
};

export const TaskDependenciesSidebar: Component<
  TaskDependenciesSidebarProps
> = (props) => {
  return (
    <div class="task-detail-panel-section task-dependencies-panel">
      <h2 class="project-section-title">Dependencies</h2>
      <Show
        when={!props.error()}
        fallback={
          <div class="task-dependencies-error-block">
            <p class="project-placeholder-text">{props.error()}</p>
            <Show when={props.onRetry}>
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={() => props.onRetry?.()}
              >
                Retry
              </button>
            </Show>
          </div>
        }
      >
        <Show
          when={!props.isLoading() && props.dependencies()}
          fallback={
            <p class="project-placeholder-text">Loading dependencies.</p>
          }
        >
          {(dependencyState) => (
            <div class="task-dependencies-content">
              <div class="task-dependencies-section">
                <div class="task-dependencies-heading-row">
                  <h3 class="task-dependencies-heading">
                    Blocked by · {dependencyState().parents.length}
                  </h3>
                  <div class="task-dependencies-heading-actions">
                    <Show when={props.onOpenCreateDependencyModal}>
                      <button
                        type="button"
                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 task-dependencies-heading-icon-action rounded-none border"
                        onClick={() =>
                          props.onOpenCreateDependencyModal?.("parent")
                        }
                        aria-label="Create parent dependency"
                        title="Create parent dependency"
                      >
                        <AppIcon name="action.add" size={14} stroke={1.5} />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 task-dependencies-heading-icon-action rounded-none border"
                      onClick={() => props.onOpenLinkDependencyModal("parent")}
                      aria-label="Link parent dependency"
                      title="Link parent dependency"
                    >
                      <AppIcon name="action.link" size={14} stroke={1.5} />
                    </button>
                  </div>
                </div>
                <Show
                  when={dependencyState().parents.length > 0}
                  fallback={
                    <p class="project-placeholder-text task-detail-sidebar-empty-state">
                      No prerequisites yet.
                    </p>
                  }
                >
                  <ul class="task-dependencies-list">
                    <For each={dependencyState().parents}>
                      {(dependencyTask) => (
                        <TaskDependencyListItem
                          dependencyTask={dependencyTask}
                          isRemoving={
                            props.removingParentDependencyId?.() ===
                            dependencyTask.id
                          }
                          onNavigateToDependencyTask={
                            props.onNavigateToDependencyTask
                          }
                          onRemoveDependency={props.onRemoveParentDependency}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              <div class="task-dependencies-section">
                <div class="task-dependencies-heading-row">
                  <h3 class="task-dependencies-heading">
                    Blocking · {dependencyState().children.length}
                  </h3>
                  <div class="task-dependencies-heading-actions">
                    <Show when={props.onOpenCreateDependencyModal}>
                      <button
                        type="button"
                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 task-dependencies-heading-icon-action rounded-none border"
                        onClick={() =>
                          props.onOpenCreateDependencyModal?.("child")
                        }
                        aria-label="Create blocked task"
                        title="Create blocked task"
                      >
                        <AppIcon name="action.add" size={14} stroke={1.5} />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 task-dependencies-heading-icon-action rounded-none border"
                      onClick={() => props.onOpenLinkDependencyModal("child")}
                      aria-label="Link blocked task"
                      title="Link blocked task"
                    >
                      <AppIcon name="action.link" size={14} stroke={1.5} />
                    </button>
                  </div>
                </div>
                <Show
                  when={dependencyState().children.length > 0}
                  fallback={
                    <p class="project-placeholder-text task-detail-sidebar-empty-state">
                      No downstream tasks yet.
                    </p>
                  }
                >
                  <ul class="task-dependencies-list">
                    <For each={dependencyState().children}>
                      {(dependencyTask) => (
                        <TaskDependencyListItem
                          dependencyTask={dependencyTask}
                          isRemoving={
                            props.removingChildDependencyId?.() ===
                            dependencyTask.id
                          }
                          onNavigateToDependencyTask={
                            props.onNavigateToDependencyTask
                          }
                          onRemoveDependency={props.onRemoveChildDependency}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
};

type TaskLinkDependencyModalProps = {
  isOpen: Accessor<boolean>;
  linkDependencyDirection: Accessor<DependencyDirection>;
  linkDependencySearch: Accessor<string>;
  showDoneLinkCandidates: Accessor<boolean>;
  filteredLinkCandidates: Accessor<Task[]>;
  isLinkingDependency: Accessor<boolean>;
  onCancelLinkDependency: () => void;
  onSetLinkDependencyDirection: (direction: DependencyDirection) => void;
  setLinkDependencySearch: (value: string) => void;
  setShowDoneLinkCandidates: (value: boolean) => void;
  onLinkDependency: (dependencyTaskId: string) => void | Promise<void>;
};

export const TaskLinkDependencyModal: Component<
  TaskLinkDependencyModalProps
> = (props) => {
  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={props.onCancelLinkDependency}
      >
        <section
          class="projects-modal task-create-dependency-modal task-link-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-label={
            props.linkDependencyDirection() === "parent"
              ? "Link blocking prerequisite"
              : "Link blocked task"
          }
          onClick={(event) => event.stopPropagation()}
        >
          <div class="border-base-content/10 mb-4 border-b pb-3">
            <h2
              id="task-link-dependency-modal-title"
              class="task-delete-modal-title"
            >
              Link task
            </h2>
            <p class="text-base-content/55 mt-1 text-xs">
              Search existing tasks and attach them as dependencies.
            </p>
          </div>
          <label class="projects-field">
            <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
              <span class="field-label-text">Relationship</span>
            </span>
            <select
              class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
              value={props.linkDependencyDirection()}
              onChange={(event) =>
                props.onSetLinkDependencyDirection(
                  event.currentTarget.value as DependencyDirection,
                )
              }
              disabled={props.isLinkingDependency()}
              aria-label="Dependency relationship"
            >
              <option value="parent">Blocked by</option>
              <option value="child">Blocking</option>
            </select>
          </label>
          <label class="projects-field">
            <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
              <span class="field-label-text">Search tasks</span>
            </span>
            <input
              value={props.linkDependencySearch()}
              onInput={(event) =>
                props.setLinkDependencySearch(event.currentTarget.value)
              }
              placeholder="Search by key, title, or repository"
              aria-label="Search dependency tasks"
            />
          </label>
          <label class="task-link-dependency-toggle">
            <input
              type="checkbox"
              checked={props.showDoneLinkCandidates()}
              onChange={(event) =>
                props.setShowDoneLinkCandidates(event.currentTarget.checked)
              }
            />
            Show done tasks
          </label>
          <Show
            when={props.filteredLinkCandidates().length > 0}
            fallback={
              <p class="project-placeholder-text">
                No tasks match your filters.
              </p>
            }
          >
            <ul class="task-link-candidate-list" aria-label="Link candidates">
              <For each={props.filteredLinkCandidates()}>
                {(candidateTask) => (
                  <li class="task-link-candidate-item">
                    <div class="task-link-candidate-main">
                      <span class="sr-only">
                        {dependencyDisplayLabel({
                          id: candidateTask.id,
                          displayKey: candidateTask.displayKey || "",
                          title: candidateTask.title,
                          status: candidateTask.status,
                          targetRepositoryName:
                            candidateTask.targetRepositoryName,
                          targetRepositoryPath:
                            candidateTask.targetRepositoryPath,
                          updatedAt: candidateTask.updatedAt,
                        })}
                      </span>
                      <div class="task-link-candidate-primary">
                        <p class="task-dependency-title task-link-candidate-title">
                          {candidateTask.title?.trim() || "Untitled task"}
                        </p>
                      </div>
                      <div class="task-link-candidate-subtitle">
                        <span class="task-dependency-key">
                          {candidateTask.displayKey?.trim() || "Task"}
                        </span>
                        <span
                          class={`project-task-status project-task-status--${candidateTask.status} task-link-candidate-status`}
                        >
                          {formatStatus(candidateTask.status)}
                        </span>
                        <p class="task-link-candidate-repository">
                          {dependencyScopeLabel({
                            id: candidateTask.id,
                            displayKey: candidateTask.displayKey || "",
                            title: candidateTask.title,
                            status: candidateTask.status,
                            targetRepositoryName:
                              candidateTask.targetRepositoryName,
                            targetRepositoryPath:
                              candidateTask.targetRepositoryPath,
                            updatedAt: candidateTask.updatedAt,
                          })}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-xs border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-3 text-[11px] font-semibold"
                      onClick={() =>
                        void props.onLinkDependency(candidateTask.id)
                      }
                      disabled={props.isLinkingDependency()}
                      aria-label={`Link ${dependencyDisplayLabel({
                        id: candidateTask.id,
                        displayKey: candidateTask.displayKey || "",
                        title: candidateTask.title,
                        status: candidateTask.status,
                        targetRepositoryName:
                          candidateTask.targetRepositoryName,
                        targetRepositoryPath:
                          candidateTask.targetRepositoryPath,
                        updatedAt: candidateTask.updatedAt,
                      })}`}
                    >
                      {props.isLinkingDependency() ? "Linking..." : "Link"}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="task-delete-modal-actions">
            <button
              type="button"
              class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
              onClick={props.onCancelLinkDependency}
              disabled={props.isLinkingDependency()}
            >
              Cancel
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};
