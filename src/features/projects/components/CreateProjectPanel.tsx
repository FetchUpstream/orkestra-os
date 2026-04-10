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

import { For, Index, Show, type Component, type JSX } from "solid-js";
import type {
  RunAgentOption,
  RunModelOption,
  RunSelectionOption,
} from "../../../app/lib/runs";
import { AppIcon } from "../../../components/ui/icons";
import RunAgentSelectOptions from "../../runs/components/RunAgentSelectOptions";
import RepositoryPathPicker from "./RepositoryPathPicker";
import type { EnvVarInput, RepoInput } from "../utils/projectForm";

type Props = {
  mode: () => "create" | "edit";
  name: () => string;
  keyValue: () => string;
  description: () => string;
  envVars: () => EnvVarInput[];
  repositories: () => RepoInput[];
  defaultRepoIndex: () => number;
  error: () => string;
  runDefaultsError: () => string;
  isSubmitting: () => boolean;
  isDeletingProject: () => boolean;
  isLoadingProjectForEdit: () => boolean;
  isLoadingRunDefaults: () => boolean;
  hasRunSelectionOptions: () => boolean;
  projectKeyError: () => string;
  defaultRunProvider: () => string;
  defaultRunAgent: () => string;
  defaultRunModel: () => string;
  runAgentOptions: () => RunAgentOption[];
  runProviderOptions: () => RunSelectionOption[];
  visibleRunModelOptions: () => RunModelOption[];
  runDefaultsValidationError: () => string;
  projectEnvVarError: () => string;
  setDescription: (value: string) => void;
  setTouched: (
    next: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setDefaultRepoIndex: (index: number) => void;
  setDefaultRunProvider: (value: string) => void;
  setDefaultRunAgent: (value: string) => void;
  setDefaultRunModel: (value: string) => void;
  updateName: (value: string) => void;
  updateKey: (value: string) => void;
  addEnvVar: () => void;
  addRepository: () => void;
  removeEnvVar: (index: number) => void;
  removeRepository: (index: number) => void;
  updateEnvVar: (
    index: number,
    field: keyof EnvVarInput,
    value: string,
  ) => void;
  updateRepository: (
    index: number,
    field: keyof RepoInput,
    value: string,
  ) => void;
  searchRepositoryDirectories: (
    query: string,
    limit?: number,
  ) => Promise<
    Array<{ path: string; directoryName: string; parentPath: string }>
  >;
  flushAutosave: () => void | Promise<void>;
  onDeleteProject: () => void | Promise<void>;
  onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

const CreateProjectPanel: Component<Props> = (props) =>
  (() => {
    const isFormDisabled = () =>
      props.isSubmitting() ||
      props.isDeletingProject() ||
      props.isLoadingProjectForEdit();

    return (
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
                onBlur={() => {
                  props.setTouched((prev) => ({ ...prev, name: true }));
                  void props.flushAutosave();
                }}
                placeholder="Enter project name"
                required
                aria-required="true"
                disabled={isFormDisabled()}
              />
            </label>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Project key</span>
              </span>
              <input
                value={props.keyValue()}
                onInput={(event) => props.updateKey(event.currentTarget.value)}
                onBlur={() => {
                  props.setTouched((prev) => ({ ...prev, key: true }));
                  void props.flushAutosave();
                }}
                minlength={2}
                maxlength={4}
                placeholder="e.g., PROJ"
                required
                aria-required="true"
                aria-invalid={!!props.projectKeyError()}
                aria-describedby={
                  props.projectKeyError() ? "key-error" : "key-help"
                }
                disabled={isFormDisabled()}
              />
              <Show
                when={props.projectKeyError()}
                fallback={
                  <p id="key-help" class="field-help">
                    A short identifier used in references. Auto-generated from
                    the project name.
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
                onInput={(event) =>
                  props.setDescription(event.currentTarget.value)
                }
                onBlur={() => void props.flushAutosave()}
                placeholder="Brief description of the project"
                rows={3}
                disabled={isFormDisabled()}
              />
            </label>
          </div>
          <div class="form-section">
            <div>
              <h3 class="form-section-title">Project Environment</h3>
              <p class="form-section-subtitle">
                Project-scoped environment variables for run terminals and
                OpenCode.
              </p>
            </div>
            <div class="projects-repos-block border-base-content/15 bg-base-100 rounded-none border">
              <div class="projects-repos-head">
                <div>
                  <h3 class="projects-repos-title">Environment variables</h3>
                  <p class="projects-repos-subtitle">
                    Optional Terminal Session Environment Variables for this
                    project. These variables will be injected into the terminal
                    and agent sessions.
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                  onClick={props.addEnvVar}
                  disabled={isFormDisabled()}
                >
                  Add variable
                </button>
              </div>
              <Show
                when={props.envVars().length > 0}
                fallback={
                  <p class="project-placeholder-text px-4 py-4 text-sm">
                    No project env vars configured.
                  </p>
                }
              >
                <div class="projects-repo-list" role="list">
                  <Index each={props.envVars()}>
                    {(entry, index) => (
                      <div
                        class="projects-repo-row border-base-content/15 bg-base-200/35 relative rounded-none border pt-5 pr-12"
                        role="listitem"
                      >
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-error hover:bg-error/10 hover:text-error absolute top-3 right-3 h-7 min-h-7 w-7 rounded-none p-0"
                          onClick={() => {
                            if (isFormDisabled()) return;
                            props.removeEnvVar(index);
                          }}
                          disabled={isFormDisabled()}
                          aria-disabled={isFormDisabled()}
                          aria-label={`Remove environment variable ${index + 1}`}
                          title="Remove environment variable"
                        >
                          <AppIcon name="action.delete" size={14} />
                        </button>
                        <label class="projects-field">
                          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                            <span class="field-label-text">Key</span>
                          </span>
                          <input
                            placeholder="API_TOKEN"
                            value={entry().key}
                            onInput={(event) =>
                              props.updateEnvVar(
                                index,
                                "key",
                                event.currentTarget.value,
                              )
                            }
                            onBlur={() => void props.flushAutosave()}
                            aria-label={`Environment variable ${index + 1} key`}
                            disabled={isFormDisabled()}
                          />
                        </label>
                        <label class="projects-field">
                          <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                            <span class="field-label-text">Value</span>
                            <span class="field-optional">optional</span>
                          </span>
                          <input
                            placeholder="your-value"
                            value={entry().value}
                            onInput={(event) =>
                              props.updateEnvVar(
                                index,
                                "value",
                                event.currentTarget.value,
                              )
                            }
                            onBlur={() => void props.flushAutosave()}
                            aria-label={`Environment variable ${index + 1} value`}
                            disabled={isFormDisabled()}
                          />
                        </label>
                      </div>
                    )}
                  </Index>
                </div>
              </Show>
              <Show when={props.projectEnvVarError()}>
                {(message) => <p class="field-error px-4 pb-4">{message()}</p>}
              </Show>
            </div>
          </div>
          <div class="form-section">
            <div>
              <h3 class="form-section-title">Default Run Configuration</h3>
              <p class="form-section-subtitle">
                These agent/provider/model defaults are used for future runs in
                this project.
              </p>
            </div>
            <Show when={props.hasRunSelectionOptions()}>
              <div class="task-runs-defaults-grid">
                <label class="projects-field task-runs-default-field">
                  <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                    <span class="field-label-text">Agent</span>
                    <span class="field-optional">optional</span>
                  </span>
                  <select
                    class="select select-sm border-base-content/15 bg-base-100 text-base-content h-10 min-h-10 rounded-none px-3 text-xs font-medium"
                    value={props.defaultRunAgent()}
                    onChange={(event) =>
                      props.setDefaultRunAgent(event.currentTarget.value)
                    }
                    onBlur={() => void props.flushAutosave()}
                    disabled={isFormDisabled()}
                    aria-label="Project default run agent"
                  >
                    <RunAgentSelectOptions
                      options={props.runAgentOptions()}
                      includeSystemDefaultOption
                    />
                  </select>
                </label>
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
                    onBlur={() => void props.flushAutosave()}
                    disabled={isFormDisabled()}
                    aria-label="Project default run provider"
                    required
                  >
                    <option value="">Select provider</option>
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
                    value={props.defaultRunModel()}
                    onChange={(event) =>
                      props.setDefaultRunModel(event.currentTarget.value)
                    }
                    onBlur={() => void props.flushAutosave()}
                    disabled={isFormDisabled()}
                    aria-label="Project default run model"
                    required
                  >
                    <option value="">Select model</option>
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
                !props.hasRunSelectionOptions() && props.isLoadingRunDefaults()
              }
            >
              <p class="project-placeholder-text text-sm">
                Loading run defaults...
              </p>
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
                  disabled={isFormDisabled()}
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
                        <RepositoryPathPicker
                          value={repo().path}
                          placeholder="Repository path"
                          ariaLabel={`Repository ${index + 1} path`}
                          required
                          onInput={(value) =>
                            props.updateRepository(index, "path", value)
                          }
                          onBlur={() => void props.flushAutosave()}
                          disabled={isFormDisabled()}
                          searchDirectories={props.searchRepositoryDirectories}
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
                          onBlur={() => void props.flushAutosave()}
                          aria-label={`Repository ${index + 1} display name`}
                          disabled={isFormDisabled()}
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
                          onBlur={() => void props.flushAutosave()}
                          aria-label={`Repository ${index + 1} setup script`}
                          rows={2}
                          disabled={isFormDisabled()}
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
                          onBlur={() => void props.flushAutosave()}
                          aria-label={`Repository ${index + 1} cleanup script`}
                          rows={2}
                          disabled={isFormDisabled()}
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
                            disabled={isFormDisabled()}
                          />
                          Default
                        </label>
                        <div class="repo-actions">
                          <button
                            type="button"
                            class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                            onClick={() => props.removeRepository(index)}
                            disabled={
                              isFormDisabled() ||
                              props.repositories().length === 1
                            }
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
            <Show when={props.mode() === "create"}>
              <button
                type="submit"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                disabled={isFormDisabled()}
              >
                {props.isSubmitting()
                  ? "Creating project..."
                  : "Create project"}
              </button>
            </Show>
            <Show when={props.mode() === "edit"}>
              <button
                type="button"
                class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                onClick={() => void props.onDeleteProject()}
                disabled={isFormDisabled()}
              >
                Delete project
              </button>
            </Show>
          </div>
        </form>
      </section>
    );
  })();

export default CreateProjectPanel;
