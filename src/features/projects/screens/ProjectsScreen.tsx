// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useNavigate, useParams } from "@solidjs/router";
import { Show, createEffect, type Component } from "solid-js";
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
          envVars={model.envVars}
          repositories={model.repositories}
          defaultRepoIndex={model.defaultRepoIndex}
          error={model.error}
          runDefaultsError={model.runDefaultsError}
          isSubmitting={model.isSubmitting}
          isDeletingProject={model.isDeletingProject}
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
          projectEnvVarError={model.projectEnvVarError}
          setDescription={model.setDescription}
          setTouched={model.setTouched}
          setDefaultRepoIndex={model.setDefaultRepoIndex}
          setDefaultRunProvider={model.setDefaultRunProvider}
          setDefaultRunAgent={model.setDefaultRunAgent}
          setDefaultRunModel={model.setDefaultRunModel}
          updateName={model.updateName}
          updateKey={model.updateKey}
          addEnvVar={model.addEnvVar}
          addRepository={model.addRepository}
          removeEnvVar={model.removeEnvVar}
          removeRepository={model.removeRepository}
          updateEnvVar={model.updateEnvVar}
          updateRepository={model.updateRepository}
          onDeleteProject={model.onOpenDeleteCurrentProject}
          resetToCreateMode={() => {
            model.resetForm();
            void navigate("/projects");
          }}
          onSubmit={model.onSubmit}
        />
      </div>
      <Show when={model.isDeleteModalOpen()}>
        <div
          class="projects-modal-backdrop"
          role="presentation"
          onClick={model.closeDeleteModal}
        >
          <section
            class="projects-modal border-base-content/15 bg-base-200 rounded-none border"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-modal-title"
            aria-describedby="project-delete-modal-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="border-base-content/10 mb-4 border-b pb-3">
              <h2
                id="project-delete-modal-title"
                class="task-delete-modal-title"
              >
                Delete project?
              </h2>
            </div>
            <p id="project-delete-modal-copy" class="project-placeholder-text">
              This permanently deletes &quot;{model.deleteProjectName()}&quot;.
              All tasks and runs for this project will also be permanently
              removed. This action cannot be undone.
            </p>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">
                  Type the project name to confirm
                </span>
              </span>
              <input
                value={model.deleteConfirmationInput()}
                onInput={(event) =>
                  model.setDeleteConfirmationInput(event.currentTarget.value)
                }
                placeholder={model.deleteProjectName()}
                aria-label="Type the project name to confirm deletion"
                disabled={model.isDeletingProject()}
              />
            </label>
            <Show when={model.deleteError()}>
              {(message) => (
                <p class="projects-error" role="alert" aria-live="polite">
                  {message()}
                </p>
              )}
            </Show>
            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={model.closeDeleteModal}
                disabled={model.isDeletingProject()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                onClick={model.onConfirmDeleteProject}
                disabled={
                  model.isDeletingProject() ||
                  !model.isDeleteConfirmationEnabled()
                }
              >
                {model.isDeletingProject() ? "Deleting..." : "Delete project"}
              </button>
            </div>
          </section>
        </div>
      </Show>
    </>
  );
};

export default ProjectsScreen;
