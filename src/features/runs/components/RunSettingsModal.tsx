import { For, Show, type Accessor, type Component } from "solid-js";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";

type RunSettingsModalProps = {
  isOpen: Accessor<boolean>;
  isSubmitting: Accessor<boolean>;
  hasRunSelectionOptions: Accessor<boolean>;
  isLoadingRunSelectionOptions: Accessor<boolean>;
  runSelectionOptionsError: Accessor<string>;
  runAgentOptions: Accessor<RunSelectionOption[]>;
  runProviderOptions: Accessor<RunSelectionOption[]>;
  visibleRunModelOptions: Accessor<RunModelOption[]>;
  selectedRunAgentId: Accessor<string>;
  selectedRunProviderId: Accessor<string>;
  selectedRunModelId: Accessor<string>;
  setSelectedRunAgentId: (value: string) => void;
  setSelectedRunProviderId: (value: string) => void;
  setSelectedRunModelId: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

const RunSettingsModal: Component<RunSettingsModalProps> = (props) => {
  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={props.onCancel}
      >
        <section
          class="projects-modal task-create-dependency-modal task-run-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-run-settings-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h2
            id="task-run-settings-modal-title"
            class="task-delete-modal-title"
          >
            New run settings
          </h2>
          <Show when={props.hasRunSelectionOptions()}>
            <div class="task-runs-defaults-grid">
              <label class="projects-field task-runs-default-field">
                <span class="field-label">
                  <span class="field-label-text">Agent</span>
                </span>
                <select
                  value={props.selectedRunAgentId()}
                  onChange={(event) =>
                    props.setSelectedRunAgentId(event.currentTarget.value)
                  }
                  disabled={props.isSubmitting()}
                  aria-label="Default run agent"
                >
                  <option value="">Use run default</option>
                  <For each={props.runAgentOptions()}>
                    {(option) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field task-runs-default-field">
                <span class="field-label">
                  <span class="field-label-text">Provider</span>
                </span>
                <select
                  value={props.selectedRunProviderId()}
                  onChange={(event) =>
                    props.setSelectedRunProviderId(event.currentTarget.value)
                  }
                  disabled={props.isSubmitting()}
                  aria-label="Default run provider"
                >
                  <option value="">Use run default</option>
                  <For each={props.runProviderOptions()}>
                    {(option) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field task-runs-default-field">
                <span class="field-label">
                  <span class="field-label-text">Model</span>
                </span>
                <select
                  value={props.selectedRunModelId()}
                  onChange={(event) =>
                    props.setSelectedRunModelId(event.currentTarget.value)
                  }
                  disabled={props.isSubmitting()}
                  aria-label="Default run model"
                >
                  <option value="">Use run default</option>
                  <For each={props.visibleRunModelOptions()}>
                    {(option) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
            </div>
          </Show>
          <Show
            when={
              !props.hasRunSelectionOptions() &&
              props.isLoadingRunSelectionOptions()
            }
          >
            <p class="project-placeholder-text">Loading run defaults...</p>
          </Show>
          <Show
            when={
              !props.hasRunSelectionOptions() &&
              !props.isLoadingRunSelectionOptions() &&
              !props.runSelectionOptionsError()
            }
          >
            <p class="project-placeholder-text">
              Run defaults are unavailable. A run will use system defaults.
            </p>
          </Show>
          <div class="task-delete-modal-actions">
            <button
              type="button"
              class="projects-button-muted"
              onClick={props.onCancel}
              disabled={props.isSubmitting()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="projects-button-primary"
              onClick={() => void props.onConfirm()}
              disabled={props.isSubmitting()}
            >
              {props.isSubmitting() ? "Starting..." : "Create run"}
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default RunSettingsModal;
