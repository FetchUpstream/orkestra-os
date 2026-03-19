import { A } from "@solidjs/router";
import { For, Show, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";

type Props = {
  projects: () => Project[];
  activeEditProjectId: () => string | null;
  isLoadingProjectForEdit: () => boolean;
  onEditProject: (projectId: string) => void;
  onCloneProject: (project: Project) => void;
};

const EditIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a.996.996 0 0 0 0-1.41L18.2 3.29a.996.996 0 1 0-1.41 1.41l2.5 2.5c.39.39 1.03.39 1.42.01z" />
  </svg>
);

const ProjectsListPanel: Component<Props> = (props) => (
  <section class="projects-panel" aria-labelledby="existing-projects-heading">
    <h2 id="existing-projects-heading" class="projects-section-title">
      Existing Projects
    </h2>
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
            <li class="projects-list-item">
              <span class="projects-card-content">
                <span class="projects-card-info">
                  <span class="projects-list-name">{project.name}</span>
                  <span class="projects-list-meta">{project.key}</span>
                </span>
                <span class="projects-card-actions">
                  <A
                    href={`/projects/${project.id}`}
                    class="projects-open-cue"
                    aria-label={`Open project ${project.name} (${project.key})`}
                  >
                    Open
                  </A>
                  <button
                    type="button"
                    class="projects-open-cue projects-open-cue-button"
                    aria-label={`Clone project ${project.name} (${project.key})`}
                    onClick={() => props.onCloneProject(project)}
                  >
                    Clone
                  </button>
                  <button
                    type="button"
                    class="projects-icon-action"
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
