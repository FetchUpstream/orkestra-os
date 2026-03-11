import { useParams } from "@solidjs/router";
import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { getProject, type Project } from "../app/lib/projects";
import PageHeader from "../components/layout/PageHeader";

const ProjectDetailPage: Component = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(true);

  onMount(async () => {
    if (!params.projectId) {
      setError("Missing project ID.");
      setIsLoading(false);
      return;
    }
    try {
      const detail = await getProject(params.projectId);
      setProject(detail);
    } catch {
      setError("Failed to load project. Please try again.");
    } finally {
      setIsLoading(false);
    }
  });

  const defaultRepo = () => project()?.repositories.find((r) => r.is_default);
  const otherRepos = () => project()?.repositories.filter((r) => !r.is_default) ?? [];

  return (
    <>
      <PageHeader title="Project Detail" />

      <Show when={!error()} fallback={
        <div class="projects-panel" role="alert" aria-live="assertive">
          <div class="projects-error">{error()}</div>
        </div>
      }>
        <Show when={!isLoading()} fallback={
          <div class="projects-panel">
            <div class="page-placeholder">Loading project details...</div>
          </div>
        }>
          <Show when={project()} fallback={
            <div class="projects-panel">
              <div class="project-detail-empty">
                <h2 class="project-detail-empty-title">Project not found</h2>
                <p class="project-detail-empty-text">The project you're looking for doesn't exist or has been removed.</p>
              </div>
            </div>
          }>
            {(projectValue) => (
              <>
                <section class="project-detail-top" aria-labelledby="project-name">
                  <div class="project-identity-card">
                    <div class="project-key-badge">{projectValue().key}</div>
                    <h1 id="project-name" class="project-name">{projectValue().name}</h1>
                    <Show when={projectValue().description?.trim()} fallback={
                      <p class="project-description project-description-empty">No description yet.</p>
                    }>
                      {(desc) => <p class="project-description">{desc()}</p>}
                    </Show>
                  </div>

                  <div class="projects-panel project-meta-card" aria-label="Project meta">
                    <div class="project-meta-grid">
                      <div class="project-meta-item">
                        <p class="project-meta-label">Default repository</p>
                        <p class="project-meta-value">
                          {defaultRepo()?.name || defaultRepo()?.path || "Not set"}
                        </p>
                      </div>
                      <div class="project-meta-item">
                        <p class="project-meta-label">Linked repositories</p>
                        <p class="project-meta-value">{projectValue().repositories.length}</p>
                      </div>
                    </div>
                    <div class="project-action-placeholder" aria-hidden="true">
                      Project actions coming soon
                    </div>
                  </div>
                </section>

                {/* Repositories Section */}
                <section class="projects-panel" aria-labelledby="repositories-heading">
                  <div class="project-section-header">
                    <h2 id="repositories-heading" class="project-section-title">Repositories</h2>
                    <span class="projects-list-meta">
                      {projectValue().repositories.length} {projectValue().repositories.length === 1 ? "repository" : "repositories"}
                    </span>
                  </div>

                  <Show when={projectValue().repositories.length > 0} fallback={
                    <div class="project-detail-empty" style={{ padding: "32px 24px" }}>
                      <p class="project-detail-empty-text">No repositories configured for this project yet.</p>
                    </div>
                  }>
                    <ul class="projects-list" role="list">
                      {/* Default repository first */}
                      <Show when={defaultRepo()}>
                        {(repo) => (
                          <li class="projects-list-item projects-list-item-default">
                            <div>
                              <p class="projects-list-name">{repo().name || repo().path}</p>
                              <p class="projects-list-meta">{repo().path}</p>
                            </div>
                            <span class="projects-default-badge">Default</span>
                          </li>
                        )}
                      </Show>

                      {/* Other repositories */}
                      <For each={otherRepos()}>
                        {(repo) => (
                          <li class="projects-list-item">
                            <div>
                              <p class="projects-list-name">{repo.name || repo.path}</p>
                              <p class="projects-list-meta">{repo.path}</p>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section class="project-placeholders" aria-label="Project scoped sections">
                  <div class="projects-panel project-placeholder-card" aria-labelledby="tasks-heading">
                    <h2 id="tasks-heading" class="project-section-title">Tasks</h2>
                    <p class="project-placeholder-text">Project tasks will appear here when task workflows are added.</p>
                  </div>
                  <div class="projects-panel project-placeholder-card" aria-labelledby="runs-heading">
                    <h2 id="runs-heading" class="project-section-title">Runs</h2>
                    <p class="project-placeholder-text">Run activity for this project will be shown here in a future update.</p>
                  </div>
                  <div class="projects-panel project-placeholder-card" aria-labelledby="settings-heading">
                    <h2 id="settings-heading" class="project-section-title">Settings</h2>
                    <p class="project-placeholder-text">Project-specific settings will live here once configuration controls are available.</p>
                  </div>
                </section>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
};

export default ProjectDetailPage;
