import type { Component } from "solid-js";
import PageHeader from "../../../components/layout/PageHeader";
import CloneProjectModal from "../components/CloneProjectModal";
import CreateProjectPanel from "../components/CreateProjectPanel";
import ProjectsListPanel from "../components/ProjectsListPanel";
import { useProjectsPageModel } from "../model/useProjectsPageModel";

const ProjectsScreen: Component = () => {
  const model = useProjectsPageModel();

  return (
    <>
      <PageHeader title="Projects" />
      <div class="projects-layout">
        <ProjectsListPanel
          projects={model.projects}
          activeEditProjectId={model.editingProjectId}
          isLoadingProjectForEdit={model.isLoadingProjectForEdit}
          onEditProject={model.onEditProject}
          onCloneProject={model.onOpenCloneModal}
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
        error={model.cloneError}
        isSubmitting={model.isCloning}
        setProjectKey={model.updateCloneProjectKey}
        setRepositoryDestination={model.setCloneRepositoryDestination}
        setTouched={model.setCloneTouched}
        onClose={model.closeCloneModal}
        onSubmit={model.onSubmitClone}
      />
    </>
  );
};

export default ProjectsScreen;
