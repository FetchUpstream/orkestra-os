import { useParams } from "@solidjs/router";
import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { getProject, type Project } from "../app/lib/projects";
import PageHeader from "../components/layout/PageHeader";

const ProjectDetailPage: Component = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [error, setError] = createSignal("");

  onMount(async () => {
    if (!params.projectId) {
      setError("Missing project id.");
      return;
    }
    try {
      const detail = await getProject(params.projectId);
      setProject(detail);
    } catch {
      setError("Failed to load project.");
    }
  });

  return (
    <>
      <PageHeader title={`Project ${params.projectId}`} />
      <Show when={!error()} fallback={<p class="projects-error">{error()}</p>}>
        <Show when={project()} fallback={<p class="page-placeholder">Loading project details...</p>}>
          {(projectValue) => (
            <section class="projects-panel">
              <p class="projects-list-name">{projectValue().name}</p>
              <p class="projects-list-meta">Key: {projectValue().key}</p>
              <p class="page-placeholder">
                {projectValue().description?.trim() || "No description yet."}
              </p>
              <h3 class="projects-section-title">Repositories</h3>
              <ul class="projects-list">
                <For each={projectValue().repositories}>
                  {(repo) => (
                    <li class="projects-list-item">
                      <div>
                        <p class="projects-list-name">{repo.name || repo.path}</p>
                        <p class="projects-list-meta">{repo.path}</p>
                      </div>
                      <Show when={repo.is_default}>
                        <span class="projects-default-badge">Default</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailPage;
