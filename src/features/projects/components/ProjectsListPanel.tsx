import { A } from "@solidjs/router";
import { For, Show, type Component } from "solid-js";
import type { Project } from "../../../app/lib/projects";

type Props = {
  projects: () => Project[];
};

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
              <A
                href={`/projects/${project.id}`}
                class="projects-card-link"
                aria-label={`Open project ${project.name} (${project.key})`}
              >
                <span class="projects-card-content">
                  <span class="projects-card-info">
                    <span class="projects-list-name">{project.name}</span>
                    <span class="projects-list-meta">{project.key}</span>
                  </span>
                  <span class="projects-open-cue" aria-hidden="true">
                    Open
                  </span>
                </span>
              </A>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </section>
);

export default ProjectsListPanel;
