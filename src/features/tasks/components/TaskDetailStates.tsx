import type { Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";

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
  backHref: string;
  backLabel: string;
}> = (props) => (
  <section class="projects-panel task-detail-state-card">
    <h3 class="project-section-title">Task not found</h3>
    <p class="project-placeholder-text">
      This task may have been removed or the link is no longer valid.
    </p>
    <BackIconLink href={props.backHref} label={props.backLabel} />
  </section>
);
