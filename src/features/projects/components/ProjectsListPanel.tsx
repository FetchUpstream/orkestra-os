import { A } from "@solidjs/router";
import { For, Show, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";

type Props = {
  projects: () => Project[];
  activeEditProjectId: () => string | null;
  isLoadingProjectForEdit: () => boolean;
  deletingProjectId: () => string | null;
  isDeletingProject: () => boolean;
  onEditProject: (projectId: string) => void;
  onCloneProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
};

const EditIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a.996.996 0 0 0 0-1.41L18.2 3.29a.996.996 0 1 0-1.41 1.41l2.5 2.5c.39.39 1.03.39 1.42.01z" />
  </svg>
);

const ProjectsListPanel: Component<Props> = (props) => (
  <section
    class="projects-panel border-base-content/15 bg-base-200/35 border"
    aria-labelledby="existing-projects-heading"
  >
    <div class="project-section-header border-base-content/10 mb-4 border-b pb-3">
      <h2 id="existing-projects-heading" class="projects-section-title m-0">
        Existing Projects
      </h2>
      <span class="badge badge-ghost border-base-content/10 text-base-content/55 rounded-none border px-2 text-[10px]">
        {props.projects().length}
      </span>
    </div>
    <Show
      when={props.projects().length > 0}
      fallback={
        <p class="page-placeholder">
          No projects yet. Create your first project to get started.
        </p>
      }
    >
      <ul class="projects-list" role="list">
        <For each={props.projects()}>
          {(project) => (
            <li class="projects-list-item border-base-content/15 bg-base-100 rounded-none border">
              <span class="projects-card-content">
                <span class="projects-card-info">
                  <span class="projects-list-name">{project.name}</span>
                  <span class="projects-list-meta">{project.key}</span>
                </span>
                <span class="projects-card-actions">
                  <A
                    href={`/projects/${project.id}`}
                    class="btn btn-xs border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 rounded-none border px-3 text-[11px] font-medium"
                    aria-label={`Open project ${project.name} (${project.key})`}
                  >
                    Open
                  </A>
                  <button
                    type="button"
                    class="btn btn-xs border-base-content/15 bg-base-100 text-base-content/75 hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                    aria-label={`Clone project ${project.name} (${project.key})`}
                    onClick={() => props.onCloneProject(project)}
                  >
                    Clone
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-3 text-[11px] font-medium"
                    aria-label={`Delete project ${project.name} (${project.key})`}
                    disabled={
                      props.isDeletingProject() &&
                      props.deletingProjectId() === project.id
                    }
                    onClick={() => props.onDeleteProject(project)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    class="projects-icon-action btn btn-square btn-xs border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
                    aria-label={`Edit project ${project.name} (${project.key})`}
                    title={`Edit project ${project.name} (${project.key})`}
                    disabled={
                      props.isLoadingProjectForEdit() &&
                      props.activeEditProjectId() === project.id
                    }
                    onClick={() => props.onEditProject(project.id)}
                  >
                    <EditIcon />
                  </button>
                </span>
              </span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </section>
);

export default ProjectsListPanel;
