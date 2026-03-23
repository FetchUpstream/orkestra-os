import { Show, createEffect, onCleanup, type Component } from "solid-js";
import PageHeader from "../../../components/layout/PageHeader";
import CloneProjectModal from "../components/CloneProjectModal";
import CreateProjectPanel from "../components/CreateProjectPanel";
import ProjectsListPanel from "../components/ProjectsListPanel";
import { useProjectsPageModel } from "../model/useProjectsPageModel";

const ProjectsScreen: Component = () => {
  const model = useProjectsPageModel();

  createEffect(() => {
    if (!model.isCloneModalOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || model.isCloning()) return;
      event.preventDefault();
      model.closeCloneModal();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  createEffect(() => {
    if (!model.isDeleteModalOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || model.isDeletingProject()) return;
      event.preventDefault();
      model.closeDeleteModal();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <>
      <PageHeader title="Projects" />
      <div class="projects-layout">
        <ProjectsListPanel
          projects={model.projects}
          activeEditProjectId={model.editingProjectId}
          isLoadingProjectForEdit={model.isLoadingProjectForEdit}
          deletingProjectId={model.deleteProjectId}
          isDeletingProject={model.isDeletingProject}
          onEditProject={model.onEditProject}
          onCloneProject={model.onOpenCloneModal}
          onDeleteProject={model.onOpenDeleteModal}
        />
        <CreateProjectPanel
          mode={model.mode}
          name={model.name}
          keyValue={model.key}
          description={model.description}
          repositories={model.repositories}
          defaultRepoIndex={model.defaultRepoIndex}
          error={model.error}
          isSubmitting={model.isSubmitting}
          projectKeyError={model.projectKeyError}
          setDescription={model.setDescription}
          setTouched={model.setTouched}
          setDefaultRepoIndex={model.setDefaultRepoIndex}
          updateName={model.updateName}
          updateKey={model.updateKey}
          addRepository={model.addRepository}
          removeRepository={model.removeRepository}
          updateRepository={model.updateRepository}
          resetToCreateMode={model.resetForm}
          onSubmit={model.onSubmit}
        />
      </div>
      <CloneProjectModal
        isOpen={model.isCloneModalOpen}
        sourceProjectName={model.cloneSourceProjectName}
        sourceProjectKey={model.cloneSourceProjectKey}
        newProjectName={model.cloneProjectName}
        projectKey={model.cloneProjectKey}
        repositoryDestination={model.cloneRepositoryDestination}
        projectKeyError={model.cloneProjectKeyError}
        repositoryDestinationError={model.cloneRepositoryDestinationError}
        error={model.cloneError}
        isSubmitting={model.isCloning}
        setProjectKey={model.updateCloneProjectKey}
        setRepositoryDestination={model.setCloneRepositoryDestination}
        setTouched={model.setCloneTouched}
        onClose={model.closeCloneModal}
        onSubmit={model.onSubmitClone}
      />
      <Show when={model.isDeleteModalOpen()}>
        <div
          class="projects-modal-backdrop"
          role="presentation"
          onClick={model.closeDeleteModal}
        >
          <div
            class="projects-modal task-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-modal-title"
            aria-describedby="project-delete-modal-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="project-delete-modal-title" class="task-delete-modal-title">
              Delete project permanently?
            </h2>
            <p id="project-delete-modal-copy" class="project-placeholder-text">
              This action cannot be undone. Deleting project
              <strong> {model.deleteProjectName()}</strong> (
              {model.deleteProjectKey()}) will remove all linked tasks, runs,
              repositories, worktrees, and related data.
            </p>
            <Show when={model.deleteError()}>
              <p class="projects-error" role="alert" aria-live="polite">
                {model.deleteError()}
              </p>
            </Show>
            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="projects-button-muted"
                onClick={model.closeDeleteModal}
                disabled={model.isDeletingProject()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="projects-button-danger"
                onClick={model.onConfirmDeleteProject}
                disabled={model.isDeletingProject()}
              >
                {model.isDeletingProject() ? "Deleting..." : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

export default ProjectsScreen;
