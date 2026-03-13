import type { Component } from "solid-js";

export const ProjectDetailErrorState: Component<{ error: string }> = (
  props,
) => (
  <div class="projects-panel" role="alert" aria-live="assertive">
    <div class="projects-error">{props.error}</div>
  </div>
);

export const ProjectDetailLoadingState: Component = () => (
  <div class="projects-panel">
    <div class="page-placeholder">Loading project details...</div>
  </div>
);

export const ProjectDetailNotFoundState: Component = () => (
  <div class="projects-panel">
    <div class="project-detail-empty">
      <h2 class="project-detail-empty-title">Project not found</h2>
      <p class="project-detail-empty-text">
        The project you're looking for doesn't exist or has been removed.
      </p>
    </div>
  </div>
);
