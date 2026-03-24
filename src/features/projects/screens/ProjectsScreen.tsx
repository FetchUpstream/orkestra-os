import { useNavigate, useParams } from "@solidjs/router";
import { createEffect, type Component } from "solid-js";
import CreateProjectPanel from "../components/CreateProjectPanel";
import { useProjectsPageModel } from "../model/useProjectsPageModel";

const ProjectsScreen: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  const model = useProjectsPageModel();

  createEffect(() => {
    const projectId = params.projectId?.trim() ?? "";
    if (!projectId) {
      if (model.mode() !== "create") {
        model.resetForm();
      }
      return;
    }

    if (model.editingProjectId() === projectId && model.mode() === "edit") {
      return;
    }

    void model.onEditProject(projectId);
  });

  return (
    <>
      <div>
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
          resetToCreateMode={() => {
            model.resetForm();
            void navigate("/projects");
          }}
          onSubmit={model.onSubmit}
        />
      </div>
    </>
  );
};

export default ProjectsScreen;
