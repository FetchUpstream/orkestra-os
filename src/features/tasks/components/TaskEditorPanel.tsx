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

import { Show, type Accessor, type Component } from "solid-js";
import type { TaskStatus } from "../../../app/lib/tasks";
import TaskImplementationGuideCrepeEditor from "../../../components/ui/TaskImplementationGuideCrepeEditor";
import { formatDateTime, formatStatus } from "../utils/taskDetail";

type FieldErrors = {
  title?: string;
  targetRepositoryId?: string;
};

type Props = {
  mode: "detail" | "create";
  title: Accessor<string>;
  description: Accessor<string>;
  implementationGuide: Accessor<string>;
  status: Accessor<TaskStatus>;
  onStatusChange?: (value: TaskStatus) => void;
  onTitleInput: (value: string) => void;
  onDescriptionInput: (value: string) => void;
  onImplementationGuideInput: (value: string) => void;
  onTitleBlur?: () => void;
  onDescriptionBlur?: () => void;
  onImplementationGuideBlur?: () => void;
  displayKey?: Accessor<string>;
  projectName?: Accessor<string | null>;
  repositoryScope?: Accessor<string>;
  projectId?: Accessor<string | undefined>;
  repositoryId?: Accessor<string | undefined>;
  updatedAt?: Accessor<string | null | undefined>;
  dependencyBadgeState?: Accessor<"blocked" | "ready" | "none">;
  targetRepositoryId?: Accessor<string>;
  targetRepositories?: Accessor<Array<{ id: string; name: string }>>;
  onTargetRepositoryChange?: (value: string) => void;
  onTargetRepositoryBlur?: () => void;
  fieldErrors?: Accessor<FieldErrors>;
};

const TaskEditorPanel: Component<Props> = (props) => {
  const fieldErrors = () => props.fieldErrors?.() ?? {};
  const statusOptions: TaskStatus[] = ["todo", "doing", "review", "done"];

  return (
    <section class="projects-panel task-detail-main-card">
      <Show when={props.mode === "create"}>
        <label class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
          <span class="field-label-text">Title</span>
          <span class="field-required">required</span>
        </label>
      </Show>
      <input
        class="task-detail-title-input"
        value={props.title()}
        onInput={(event) => props.onTitleInput(event.currentTarget.value)}
        onBlur={props.onTitleBlur}
        aria-label="Task title"
        aria-invalid={fieldErrors().title ? "true" : "false"}
      />
      <Show when={fieldErrors().title}>
        {(message) => <p class="field-error mt-0">{message()}</p>}
      </Show>

      <div class="task-detail-meta-row">
        <Show when={props.mode === "detail" && props.displayKey?.().trim()}>
          {(displayKey) => (
            <span class="border-base-content/25 bg-base-100 text-base-content/70 inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)]">
              {displayKey()}
            </span>
          )}
        </Show>
        <Show
          when={props.mode === "create"}
          fallback={
            <span
              class={`project-task-status project-task-status--${props.status()}`}
            >
              {formatStatus(props.status())}
            </span>
          }
        >
          <label class="projects-field task-create-status-field">
            <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
              <span class="field-label-text">Status</span>
              <span class="field-optional">optional</span>
            </span>
            <select
              class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
              value={props.status()}
              onChange={(event) =>
                props.onStatusChange?.(event.currentTarget.value as TaskStatus)
              }
              aria-label="Task status"
            >
              {statusOptions.map((statusOption) => (
                <option value={statusOption}>
                  {formatStatus(statusOption)}
                </option>
              ))}
            </select>
          </label>
        </Show>
        <Show
          when={
            props.mode === "detail" && props.dependencyBadgeState?.() !== "none"
          }
        >
          <span
            class={
              props.dependencyBadgeState?.() === "blocked"
                ? "project-task-blocked"
                : "project-task-ready"
            }
          >
            {props.dependencyBadgeState?.() === "blocked" ? "Blocked" : "Ready"}
          </span>
        </Show>
      </div>

      <Show
        when={props.mode === "detail"}
        fallback={
          <div class="task-detail-summary-strip">
            <div class="task-detail-summary-item">
              <span class="task-detail-summary-label">Repository scope</span>
              <span class="task-detail-summary-value">
                {props.repositoryScope?.() || "No repository"}
              </span>
            </div>
          </div>
        }
      >
        <div class="task-detail-secondary-meta-row">
          <span class="task-detail-secondary-meta-item">
            <span class="task-detail-secondary-meta-label">Repository</span>
            <span class="task-detail-secondary-meta-value">
              {props.repositoryScope?.() || "No repository"}
            </span>
          </span>
          <span class="task-detail-secondary-meta-item">
            <span class="task-detail-secondary-meta-label">Updated</span>
            <span class="task-detail-secondary-meta-value">
              {formatDateTime(props.updatedAt?.())}
            </span>
          </span>
        </div>
      </Show>

      <Show when={props.mode === "create"}>
        <label class="projects-field">
          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
            <span class="field-label-text">Target repository</span>
            <span class="field-required">required</span>
          </span>
          <select
            class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
            value={props.targetRepositoryId?.() ?? ""}
            onChange={(event) =>
              props.onTargetRepositoryChange?.(event.currentTarget.value)
            }
            onBlur={props.onTargetRepositoryBlur}
            aria-invalid={fieldErrors().targetRepositoryId ? "true" : "false"}
          >
            <Show
              when={(props.targetRepositories?.() ?? []).length > 0}
              fallback={<option value="">No repositories available</option>}
            >
              {props.targetRepositories?.()?.map((repository) => (
                <option value={repository.id}>{repository.name}</option>
              ))}
            </Show>
          </select>
          <Show when={fieldErrors().targetRepositoryId}>
            {(message) => <p class="field-error mt-0">{message()}</p>}
          </Show>
        </label>
      </Show>

      <div class="task-detail-description-block task-detail-description-block--summary">
        <h2 class="project-section-title task-detail-description-title">
          Description{" "}
          {props.mode === "create" ? (
            <span class="field-optional">optional</span>
          ) : null}
        </h2>
        <TaskImplementationGuideCrepeEditor
          value={props.description()}
          onChange={props.onDescriptionInput}
          placeholder="Describe the goal of this task in short .."
          onBlur={props.onDescriptionBlur}
          ariaLabel="Task description"
          projectId={props.projectId?.()}
          repositoryId={props.repositoryId?.()}
        />
      </div>
      <div class="task-detail-description-block task-detail-description-block--guide">
        <h2 class="project-section-title task-detail-description-title">
          Implementation guide <span class="field-optional">optional</span>
        </h2>
        <TaskImplementationGuideCrepeEditor
          value={props.implementationGuide()}
          onChange={props.onImplementationGuideInput}
          placeholder="Create a detailed specific implementation guide for the AI to follow ..."
          onBlur={props.onImplementationGuideBlur}
          ariaLabel="Task implementation guide"
          projectId={props.projectId?.()}
          repositoryId={props.repositoryId?.()}
        />
      </div>
    </section>
  );
};

export default TaskEditorPanel;
