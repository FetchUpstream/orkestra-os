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
          runDefaultsError={model.runDefaultsError}
          isSubmitting={model.isSubmitting}
          isLoadingRunDefaults={model.isLoadingRunDefaults}
          hasRunSelectionOptions={model.hasRunSelectionOptions}
          projectKeyError={model.projectKeyError}
          defaultRunProvider={model.defaultRunProvider}
          defaultRunAgent={model.defaultRunAgent}
          defaultRunModel={model.defaultRunModel}
          runAgentOptions={model.runAgentOptions}
          runProviderOptions={model.runProviderOptions}
          visibleRunModelOptions={model.visibleRunModelOptions}
          runDefaultsValidationError={model.runDefaultsValidationError}
          setDescription={model.setDescription}
          setTouched={model.setTouched}
          setDefaultRepoIndex={model.setDefaultRepoIndex}
          setDefaultRunProvider={model.setDefaultRunProvider}
          setDefaultRunAgent={model.setDefaultRunAgent}
          setDefaultRunModel={model.setDefaultRunModel}
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
