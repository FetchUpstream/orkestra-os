import { A } from "@solidjs/router";
import type { Component } from "solid-js";

export const TaskDetailErrorState: Component<{ error: string }> = (props) => (
  <section class="projects-panel task-detail-state-card">
    <h3 class="project-section-title">Unable to load task</h3>
    <p class="project-placeholder-text">{props.error}</p>
    <p class="project-placeholder-text">
      Try going back to projects and reopening this task.
    </p>
  </section>
);

export const TaskDetailLoadingState: Component = () => (
  <section class="projects-panel task-detail-state-card">
    <h3 class="project-section-title">Loading task</h3>
    <p class="project-placeholder-text">Pulling task details and context.</p>
  </section>
);

export const TaskDetailNotFoundState: Component<{
  paramsProjectId?: string;
  backLabel: string;
}> = (props) => (
  <section class="projects-panel task-detail-state-card">
    <h3 class="project-section-title">Task not found</h3>
    <p class="project-placeholder-text">
      This task may have been removed or the link is no longer valid.
    </p>
    <A
      href={
        props.paramsProjectId
          ? `/projects/${props.paramsProjectId}`
          : "/projects"
      }
      class="project-detail-back-link project-detail-back-link--icon"
      aria-label={`Back to ${props.backLabel}`}
      title={`Back to ${props.backLabel}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 12L6 8L10 4"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </A>
  </section>
);
