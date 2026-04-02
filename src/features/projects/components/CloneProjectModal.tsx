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

import { Show, type Component } from "solid-js";

type Props = {
  isOpen: () => boolean;
  sourceProjectName: () => string;
  sourceProjectKey: () => string;
  newProjectName: () => string;
  projectKey: () => string;
  repositoryDestination: () => string;
  projectKeyError: () => string;
  repositoryDestinationError: () => string;
  error: () => string;
  isSubmitting: () => boolean;
  setProjectKey: (value: string) => void;
  setRepositoryDestination: (value: string) => void;
  setTouched: (
    next: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  onClose: () => void;
  onSubmit: (event: Event) => Promise<void>;
};

const CloneProjectModal: Component<Props> = (props) => {
  const requestClose = () => {
    if (props.isSubmitting()) return;
    props.onClose();
  };

  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={requestClose}
      >
        <div
          class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clone-project-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id="clone-project-modal-title" class="task-delete-modal-title">
            Clone project
          </h2>
          <p class="project-placeholder-text">
            Clone <strong>{props.sourceProjectName()}</strong> (
            {props.sourceProjectKey()}) into a new project.
          </p>
          <p class="field-help">
            New project name: <strong>{props.newProjectName()}</strong>
          </p>
          <form class="projects-form" onSubmit={props.onSubmit}>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Project key</span>
              </span>
              <input
                value={props.projectKey()}
                onInput={(event) =>
                  props.setProjectKey(event.currentTarget.value)
                }
                onBlur={() =>
                  props.setTouched((prev) => ({ ...prev, key: true }))
                }
                minlength={2}
                maxlength={4}
                required
                aria-required="true"
                aria-invalid={!!props.projectKeyError()}
                aria-describedby={
                  props.projectKeyError() ? "clone-key-error" : "clone-key-help"
                }
              />
              <Show
                when={props.projectKeyError()}
                fallback={
                  <p id="clone-key-help" class="field-help">
                    Use 2-4 uppercase letters or digits.
                  </p>
                }
              >
                <p id="clone-key-error" class="field-error">
                  {props.projectKeyError()}
                </p>
              </Show>
            </label>

            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Repository destination</span>
              </span>
              <input
                value={props.repositoryDestination()}
                onInput={(event) =>
                  props.setRepositoryDestination(event.currentTarget.value)
                }
                onBlur={() =>
                  props.setTouched((prev) => ({
                    ...prev,
                    repositoryDestination: true,
                  }))
                }
                placeholder="/path/to/new/repo"
                required
                aria-required="true"
                aria-invalid={!!props.repositoryDestinationError()}
                aria-describedby={
                  props.repositoryDestinationError()
                    ? "clone-repository-destination-error"
                    : "clone-repository-destination-help"
                }
              />
              <Show
                when={props.repositoryDestinationError()}
                fallback={
                  <p id="clone-repository-destination-help" class="field-help">
                    Enter the path for the cloned repository.
                  </p>
                }
              >
                <p id="clone-repository-destination-error" class="field-error">
                  {props.repositoryDestinationError()}
                </p>
              </Show>
            </label>

            <Show when={props.error()}>
              <div class="projects-error" role="alert" aria-live="polite">
                {props.error()}
              </div>
            </Show>

            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={requestClose}
                disabled={props.isSubmitting()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                disabled={props.isSubmitting()}
              >
                {props.isSubmitting() ? "Cloning..." : "Clone project"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default CloneProjectModal;
