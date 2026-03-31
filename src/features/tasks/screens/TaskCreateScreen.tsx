import { Show, createEffect, onCleanup, type Component } from "solid-js";
import {
  TaskDependenciesSidebar,
  TaskLinkDependencyModal,
} from "../components/TaskDependenciesSidebar";
import TaskEditorPanel from "../components/TaskEditorPanel";
import {
  TaskDetailErrorState,
  TaskDetailLoadingState,
} from "../components/TaskDetailStates";
import { useTaskCreateModel } from "../model/useTaskCreateModel";

const TaskCreateScreen: Component = () => {
  const model = useTaskCreateModel();

  createEffect(() => {
    void model.loadProjectContext();
  });

  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("task-detail:topbar-config", {
        detail: {
          mode: "create",
          title: "Create task",
          subtitle: model.projectName()?.trim() || "Current project",
          backHref: model.backHref(),
          backLabel: model.backLabel(),
          isSubmitting: model.isSubmitting(),
          onRequestCreateTask: model.onSubmit,
          onRequestClose: model.onClose,
        },
      }),
    );
  });

  onCleanup(() => {
    window.dispatchEvent(new CustomEvent("task-detail:topbar-clear"));
  });

  return (
    <div class="task-detail-page task-detail-page--create">
      <Show
        when={!model.loadError()}
        fallback={<TaskDetailErrorState error={model.loadError()} />}
      >
        <Show when={!model.isLoading()} fallback={<TaskDetailLoadingState />}>
          <div class="task-detail-workspace">
            <div class="task-detail-columns">
              <div class="task-detail-main-column">
                <Show when={model.actionError()}>
                  <div class="projects-error" role="alert" aria-live="polite">
                    {model.actionError()}
                    <Show when={model.createdTaskLinkErrorHref()}>
                      <div class="mt-3">
                        <button
                          type="button"
                          class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                          onClick={model.onOpenCreatedTaskAfterLinkFailure}
                        >
                          Open created task
                        </button>
                      </div>
                    </Show>
                  </div>
                </Show>
                <TaskEditorPanel
                  mode="create"
                  title={model.title}
                  description={model.description}
                  implementationGuide={model.implementationGuide}
                  status={model.status}
                  projectName={model.projectName}
                  repositoryScope={() =>
                    model
                      .repositories()
                      .find((r) => r.id === model.targetRepositoryId())?.name ||
                    "No repository"
                  }
                  projectId={() => model.params.projectId}
                  repositoryId={model.targetRepositoryId}
                  targetRepositoryId={model.targetRepositoryId}
                  targetRepositories={model.repositories}
                  fieldErrors={model.fieldErrors}
                  onTitleInput={model.setTitle}
                  onDescriptionInput={model.setDescription}
                  onImplementationGuideInput={model.setImplementationGuide}
                  onStatusChange={model.setStatus}
                  onTargetRepositoryChange={model.setTargetRepositoryId}
                  onTargetRepositoryBlur={model.onTargetRepositoryBlur}
                  onTitleBlur={model.onTitleBlur}
                  onDescriptionBlur={model.onTitleBlur}
                  onImplementationGuideBlur={model.onTitleBlur}
                />
              </div>
              <aside class="task-detail-inspector-column">
                <section class="projects-panel task-detail-inspector-panel">
                  <TaskDependenciesSidebar
                    dependencies={model.dependencies}
                    error={model.dependencyCandidatesError}
                    isLoading={model.isLoading}
                    onRetry={() => void model.reloadDependencyCandidates()}
                    onOpenLinkDependencyModal={model.onOpenLinkDependencyModal}
                    onRemoveParentDependency={model.onRemoveParentDependency}
                    onRemoveChildDependency={model.onRemoveChildDependency}
                    removingParentDependencyId={
                      model.removingParentDependencyId
                    }
                    removingChildDependencyId={model.removingChildDependencyId}
                  />
                </section>
              </aside>
            </div>
          </div>
          <TaskLinkDependencyModal
            isOpen={model.isLinkDependencyModalOpen}
            linkDependencyDirection={model.linkDependencyDirection}
            linkDependencySearch={model.linkDependencySearch}
            showDoneLinkCandidates={model.showDoneLinkCandidates}
            filteredLinkCandidates={model.filteredLinkCandidates}
            isLinkingDependency={model.isLinkingDependency}
            onCancelLinkDependency={model.onCancelLinkDependency}
            onSetLinkDependencyDirection={model.onSetLinkDependencyDirection}
            setLinkDependencySearch={model.setLinkDependencySearch}
            setShowDoneLinkCandidates={model.setShowDoneLinkCandidates}
            onLinkDependency={model.onLinkDependency}
          />
          <Show when={model.isDiscardModalOpen()}>
            <div
              class="projects-modal-backdrop"
              role="presentation"
              onClick={model.onCancelDiscard}
            >
              <section
                class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
                role="dialog"
                aria-modal="true"
                aria-labelledby="task-create-discard-modal-title"
                aria-describedby="task-create-discard-modal-copy"
                onClick={(event) => event.stopPropagation()}
              >
                <div class="border-base-content/10 border-b pb-3">
                  <h2
                    id="task-create-discard-modal-title"
                    class="task-delete-modal-title"
                  >
                    Discard changes?
                  </h2>
                </div>
                <p
                  id="task-create-discard-modal-copy"
                  class="project-placeholder-text task-delete-modal-copy"
                >
                  You have unsaved changes on this new task. Leave without
                  saving?
                </p>
                <div class="task-delete-modal-actions">
                  <button
                    type="button"
                    class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                    onClick={model.onCancelDiscard}
                    disabled={model.isSubmitting()}
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                    onClick={model.onConfirmDiscard}
                    disabled={model.isSubmitting()}
                  >
                    Discard changes
                  </button>
                </div>
              </section>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default TaskCreateScreen;
