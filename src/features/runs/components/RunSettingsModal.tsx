import {
  For,
  Show,
  createEffect,
  type Accessor,
  type Component,
} from "solid-js";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";
import { useOpenCodeDependency } from "../../../app/contexts/OpenCodeDependencyContext";

type RunSettingsModalProps = {
  isOpen: Accessor<boolean>;
  isSubmitting: Accessor<boolean>;
  actionError: Accessor<string>;
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
  isOpenCodeMissing?: Accessor<boolean>;
  openCodeDependencyReason?: Accessor<string>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

const RunSettingsModal: Component<RunSettingsModalProps> = (props) => {
  const openCodeDependency = useOpenCodeDependency();

  createEffect(() => {
    if (props.isOpen() && props.isOpenCodeMissing?.()) {
      openCodeDependency.showRequiredModal();
    }
  });

  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={props.onCancel}
      >
        <section
          class="projects-modal task-create-dependency-modal task-run-settings-modal border-base-content/15 bg-base-200 rounded-none border p-0 shadow-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-run-settings-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="border-base-content/10 border-b px-5 py-4">
            <h2
              id="task-run-settings-modal-title"
              class="task-delete-modal-title text-base-content m-0 text-base font-semibold"
            >
              New run settings
            </h2>
            <p class="text-base-content/60 mt-1 text-xs">
              Override agent, provider, or model for this run.
            </p>
          </div>
          <div class="flex flex-col gap-4 px-5 py-4">
            <Show when={props.hasRunSelectionOptions()}>
              <div class="task-runs-defaults-grid">
                <label class="projects-field task-runs-default-field">
                  <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                    <span class="field-label-text">Agent</span>
                  </span>
                  <select
                    class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                    value={props.selectedRunAgentId()}
                    onChange={(event) =>
                      props.setSelectedRunAgentId(event.currentTarget.value)
                    }
                    disabled={props.isSubmitting()}
                    aria-label="Default run agent"
                  >
                    <For each={props.runAgentOptions()}>
                      {(option) => (
                        <option value={option.id}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="projects-field task-runs-default-field">
                  <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                    <span class="field-label-text">Provider</span>
                  </span>
                  <select
                    class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                    value={props.selectedRunProviderId()}
                    onChange={(event) =>
                      props.setSelectedRunProviderId(event.currentTarget.value)
                    }
                    disabled={props.isSubmitting()}
                    aria-label="Default run provider"
                  >
                    <For each={props.runProviderOptions()}>
                      {(option) => (
                        <option value={option.id}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="projects-field task-runs-default-field">
                  <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                    <span class="field-label-text">Model</span>
                  </span>
                  <select
                    class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                    value={props.selectedRunModelId()}
                    onChange={(event) =>
                      props.setSelectedRunModelId(event.currentTarget.value)
                    }
                    disabled={props.isSubmitting()}
                    aria-label="Default run model"
                  >
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
              <p class="project-placeholder-text text-sm">
                Loading run defaults...
              </p>
            </Show>
            <Show
              when={
                !props.hasRunSelectionOptions() &&
                !props.isLoadingRunSelectionOptions() &&
                !props.runSelectionOptionsError()
              }
            >
              <p class="project-placeholder-text text-sm">
                Run defaults are unavailable. A run will use system defaults.
              </p>
            </Show>
            <Show when={props.runSelectionOptionsError()}>
              {(message) => (
                <p class="projects-error border-error/35 bg-error/10 m-0 text-sm">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={props.actionError()}>
              {(message) => (
                <p
                  class="projects-error border-error/35 bg-error/10 m-0 text-sm"
                  role="alert"
                  aria-live="polite"
                >
                  {message()}
                </p>
              )}
            </Show>
            <Show when={props.isOpenCodeMissing?.()}>
              <div class="projects-error border-error/35 bg-error/10 m-0 space-y-2 text-sm">
                <p class="m-0 font-medium">
                  Finish OpenCode setup before creating a run.
                </p>
                <p class="m-0 text-xs">
                  The onboarding modal includes install, provider, model, CLI,
                  config, and Zen setup links, plus a retry action.
                </p>
                <Show when={props.openCodeDependencyReason?.()?.trim()}>
                  {(message) => <p class="m-0 text-xs">{message()}</p>}
                </Show>
              </div>
            </Show>
            <div class="task-delete-modal-actions border-base-content/10 mt-1 justify-end gap-2 border-t pt-4">
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={props.onCancel}
                disabled={props.isSubmitting()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={() => void props.onConfirm()}
                disabled={props.isSubmitting() || !!props.isOpenCodeMissing?.()}
              >
                {props.isSubmitting() ? "Starting..." : "Create run"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default RunSettingsModal;
