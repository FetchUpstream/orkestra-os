import { For, Index, Show, type Component, type JSX } from "solid-js";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";
import type { RepoInput } from "../utils/projectForm";

type Props = {
  mode: () => "create" | "edit";
  name: () => string;
  keyValue: () => string;
  description: () => string;
  repositories: () => RepoInput[];
  defaultRepoIndex: () => number;
  error: () => string;
  runDefaultsError: () => string;
  isSubmitting: () => boolean;
  isLoadingRunDefaults: () => boolean;
  hasRunSelectionOptions: () => boolean;
  projectKeyError: () => string;
  defaultRunProvider: () => string;
  defaultRunModel: () => string;
  runProviderOptions: () => RunSelectionOption[];
  visibleRunModelOptions: () => RunModelOption[];
  runDefaultsValidationError: () => string;
  setDescription: (value: string) => void;
  setTouched: (
    next: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setDefaultRepoIndex: (index: number) => void;
  setDefaultRunProvider: (value: string) => void;
  setDefaultRunModel: (value: string) => void;
  updateName: (value: string) => void;
  updateKey: (value: string) => void;
  addRepository: () => void;
  removeRepository: (index: number) => void;
  updateRepository: (
    index: number,
    field: keyof RepoInput,
    value: string,
  ) => void;
  resetToCreateMode: () => void;
  onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

const CreateProjectPanel: Component<Props> = (props) => (
  <section
    class="projects-panel border-base-content/15 bg-base-200/35 border"
    aria-labelledby="create-project-heading"
  >
    <div class="project-section-header border-base-content/10 mb-4 border-b pb-3">
      <div>
        <h2 id="create-project-heading" class="projects-section-title m-0">
          {props.mode() === "edit" ? "Edit Project" : "Create Project"}
        </h2>
        <p class="text-base-content/55 mt-1 text-xs">
          Configure project identity and tracked repositories.
        </p>
      </div>
    </div>
    <form class="projects-form" onSubmit={props.onSubmit}>
      <div class="form-section">
        <div>
          <h3 class="form-section-title">Project Identity</h3>
          <p class="form-section-subtitle">
            Define the basic information for your project.
          </p>
        </div>
        <label class="projects-field">
          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
            <span class="field-label-text">Project name</span>
          </span>
          <input
            value={props.name()}
            onInput={(event) => props.updateName(event.currentTarget.value)}
            onBlur={() => props.setTouched((prev) => ({ ...prev, name: true }))}
            placeholder="Enter project name"
            required
            aria-required="true"
          />
        </label>
        <label class="projects-field">
          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
            <span class="field-label-text">Project key</span>
          </span>
          <input
            value={props.keyValue()}
            onInput={(event) => props.updateKey(event.currentTarget.value)}
            onBlur={() => props.setTouched((prev) => ({ ...prev, key: true }))}
            minlength={2}
            maxlength={4}
            placeholder="e.g., PROJ"
            required
            aria-required="true"
            aria-invalid={!!props.projectKeyError()}
            aria-describedby={
              props.projectKeyError() ? "key-error" : "key-help"
            }
          />
          <Show
            when={props.projectKeyError()}
            fallback={
              <p id="key-help" class="field-help">
                A short identifier used in references. Auto-generated from the
                project name.
              </p>
            }
          >
            <p id="key-error" class="field-error">
              {props.projectKeyError()}
            </p>
          </Show>
        </label>
        <label class="projects-field">
          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
            <span class="field-label-text">Description</span>
            <span class="field-optional">optional</span>
          </span>
          <textarea
            value={props.description()}
            onInput={(event) => props.setDescription(event.currentTarget.value)}
            placeholder="Brief description of the project"
            rows={3}
          />
        </label>
      </div>
      <div class="form-section">
        <div>
          <h3 class="form-section-title">Default Run Configuration</h3>
          <p class="form-section-subtitle">
            These provider/model defaults are used for future runs in this
            project.
          </p>
        </div>
        <Show when={props.hasRunSelectionOptions()}>
          <div class="task-runs-defaults-grid">
            <label class="projects-field task-runs-default-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Provider</span>
              </span>
              <select
                class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                value={props.defaultRunProvider()}
                onChange={(event) =>
                  props.setDefaultRunProvider(event.currentTarget.value)
                }
                disabled={props.isSubmitting()}
                aria-label="Project default run provider"
                required
              >
                <option value="">Select provider</option>
                <For each={props.runProviderOptions()}>
                  {(option) => <option value={option.id}>{option.label}</option>}
                </For>
              </select>
            </label>
            <label class="projects-field task-runs-default-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Model</span>
              </span>
              <select
                class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                value={props.defaultRunModel()}
                onChange={(event) =>
                  props.setDefaultRunModel(event.currentTarget.value)
                }
                disabled={props.isSubmitting()}
                aria-label="Project default run model"
                required
              >
                <option value="">Select model</option>
                <For each={props.visibleRunModelOptions()}>
                  {(option) => <option value={option.id}>{option.label}</option>}
                </For>
              </select>
            </label>
          </div>
        </Show>
        <Show when={!props.hasRunSelectionOptions() && props.isLoadingRunDefaults()}>
          <p class="project-placeholder-text text-sm">Loading run defaults...</p>
        </Show>
        <Show
          when={
            !props.hasRunSelectionOptions() &&
            !props.isLoadingRunDefaults() &&
            !props.runDefaultsError()
          }
        >
          <p class="project-placeholder-text text-sm">
            Run defaults are unavailable right now.
          </p>
        </Show>
        <Show when={props.runDefaultsError()}>
          {(message) => (
            <p class="projects-error border-error/35 bg-error/10 m-0 text-sm">
              {message()}
            </p>
          )}
        </Show>
        <Show when={props.runDefaultsValidationError()}>
          {(message) => <p class="field-error">{message()}</p>}
        </Show>
      </div>
      <div class="form-section">
        <div class="projects-repos-block border-base-content/15 bg-base-100 rounded-none border">
          <div class="projects-repos-head">
            <div>
              <h3 class="projects-repos-title">Repositories</h3>
              <p class="projects-repos-subtitle">
                Add code repositories to track with this project.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
              onClick={props.addRepository}
            >
              Add repository
            </button>
          </div>
          <div class="projects-repo-list" role="list">
            <Index each={props.repositories()}>
              {(repo, index) => (
                <div
                  class="projects-repo-row border-base-content/15 bg-base-200/35 rounded-none border"
                  role="listitem"
                >
                  <label class="projects-field">
                    <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                      <span class="field-label-text">Repository path</span>
                    </span>
                    <input
                      placeholder="Repository path"
                      value={repo().path}
                      onInput={(event) =>
                        props.updateRepository(
                          index,
                          "path",
                          event.currentTarget.value,
                        )
                      }
                      required
                      aria-label={`Repository ${index + 1} path`}
                      aria-required="true"
                    />
                  </label>
                  <label class="projects-field">
                    <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                      <span class="field-label-text">Display name</span>
                      <span class="field-optional">optional</span>
                    </span>
                    <input
                      placeholder="Display name"
                      value={repo().name}
                      onInput={(event) =>
                        props.updateRepository(
                          index,
                          "name",
                          event.currentTarget.value,
                        )
                      }
                      aria-label={`Repository ${index + 1} display name`}
                    />
                  </label>
                  <label class="projects-field">
                    <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                      <span class="field-label-text">Setup script</span>
                      <span class="field-optional">optional</span>
                    </span>
                    <textarea
                      placeholder="Setup script"
                      value={repo().setupScript}
                      onInput={(event) =>
                        props.updateRepository(
                          index,
                          "setupScript",
                          event.currentTarget.value,
                        )
                      }
                      aria-label={`Repository ${index + 1} setup script`}
                      rows={2}
                    />
                  </label>
                  <label class="projects-field">
                    <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                      <span class="field-label-text">Cleanup script</span>
                      <span class="field-optional">optional</span>
                    </span>
                    <textarea
                      placeholder="Cleanup script"
                      value={repo().cleanupScript}
                      onInput={(event) =>
                        props.updateRepository(
                          index,
                          "cleanupScript",
                          event.currentTarget.value,
                        )
                      }
                      aria-label={`Repository ${index + 1} cleanup script`}
                      rows={2}
                    />
                  </label>
                  <div class="projects-repo-controls">
                    <label class="projects-default-label">
                      <input
                        type="radio"
                        name="default-repository"
                        checked={props.defaultRepoIndex() === index}
                        onChange={() => props.setDefaultRepoIndex(index)}
                        aria-label={`Set repository ${index + 1} as default`}
                      />
                      Default
                    </label>
                    <div class="repo-actions">
                      <button
                        type="button"
                        class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                        onClick={() => props.removeRepository(index)}
                        disabled={props.repositories().length === 1}
                        title={
                          props.repositories().length === 1
                            ? "Cannot remove the only repository"
                            : "Remove repository"
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Index>
          </div>
        </div>
      </div>
      <Show when={props.error()}>
        <div class="projects-error" role="alert" aria-live="polite">
          {props.error()}
        </div>
      </Show>
      <div class="form-actions">
        <button
          type="submit"
          class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
          disabled={props.isSubmitting()}
        >
          {props.isSubmitting()
            ? props.mode() === "edit"
              ? "Saving..."
              : "Creating project..."
            : props.mode() === "edit"
              ? "Save"
              : "Create project"}
        </button>
        <Show when={props.mode() === "edit"}>
          <button
            type="button"
            class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
            onClick={props.resetToCreateMode}
            disabled={props.isSubmitting()}
          >
            Cancel
          </button>
        </Show>
      </div>
    </form>
  </section>
);

export default CreateProjectPanel;
