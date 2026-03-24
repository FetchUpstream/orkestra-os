import { Show, createEffect, onCleanup, type Component } from "solid-js";
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
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default TaskCreateScreen;
