import type { Component } from "solid-js";
import PageHeader from "../../../components/layout/PageHeader";
import CreateProjectPanel from "../components/CreateProjectPanel";
import ProjectsListPanel from "../components/ProjectsListPanel";
import { useProjectsPageModel } from "../model/useProjectsPageModel";

const ProjectsScreen: Component = () => {
  const model = useProjectsPageModel();

  return (
    <>
      <PageHeader title="Projects" />
      <div class="projects-layout">
        <ProjectsListPanel projects={model.projects} />
        <CreateProjectPanel
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
          onSubmit={model.onSubmit}
        />
      </div>
    </>
  );
};

export default ProjectsScreen;
