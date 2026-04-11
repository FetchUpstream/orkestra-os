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

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
} from "solid-js";
import type {
  RunAgentOption,
  RunModelOption,
  RunSelectionOption,
  RunSourceBranchOption,
} from "../../../app/lib/runs";
import { useOpenCodeDependency } from "../../../app/contexts/OpenCodeDependencyContext";
import RunAgentSelectOptions from "./RunAgentSelectOptions";

type RunSettingsModalProps = {
  isOpen: Accessor<boolean>;
  isSubmitting: Accessor<boolean>;
  actionError: Accessor<string>;
  hasRunSelectionOptions: Accessor<boolean>;
  isLoadingRunSelectionOptions: Accessor<boolean>;
  isLoadingRunSourceBranches: Accessor<boolean>;
  runSelectionOptionsError: Accessor<string>;
  runSourceBranchError: Accessor<string>;
  runAgentOptions: Accessor<RunAgentOption[]>;
  runProviderOptions: Accessor<RunSelectionOption[]>;
  runSourceBranchOptions: Accessor<RunSourceBranchOption[]>;
  visibleRunModelOptions: Accessor<RunModelOption[]>;
  selectedRunAgentId: Accessor<string>;
  selectedRunProviderId: Accessor<string>;
  selectedRunModelId: Accessor<string>;
  selectedRunSourceBranch: Accessor<string>;
  setSelectedRunAgentId: (value: string) => void;
  setSelectedRunProviderId: (value: string) => void;
  setSelectedRunModelId: (value: string) => void;
  setSelectedRunSourceBranch: (value: string) => void;
  isOpenCodeMissing?: Accessor<boolean>;
  openCodeDependencyReason?: Accessor<string>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

const RunSourceBranchSelect: Component<{
  options: Accessor<RunSourceBranchOption[]>;
  selectedValue: Accessor<string>;
  disabled: Accessor<boolean>;
  onChange: (value: string) => void;
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  let containerRef: HTMLDivElement | undefined;

  const filteredOptions = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) {
      return props.options();
    }

    return props
      .options()
      .filter((option) => option.name.toLowerCase().includes(query));
  });

  const selectedOption = createMemo(() => {
    const selectedValue = props.selectedValue().trim();
    return (
      props.options().find((option) => option.name === selectedValue) ?? null
    );
  });

  const close = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (
      containerRef &&
      event.target instanceof Node &&
      !containerRef.contains(event.target)
    ) {
      close();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() =>
      document.removeEventListener("pointerdown", handlePointerDown),
    );
  }

  return (
    <div ref={containerRef} class="relative">
      <button
        type="button"
        class="select select-sm border-base-content/15 bg-base-100 text-base-content flex h-10 min-h-10 w-full items-center justify-between rounded-none border px-3 pr-8 text-xs font-medium"
        onClick={() => {
          if (props.disabled()) return;
          setIsOpen((current) => !current);
        }}
        disabled={props.disabled()}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
      >
        <span class="truncate pr-3 text-left">
          {selectedOption()?.name ||
            props.selectedValue().trim() ||
            "Select branch"}
        </span>
        <span class="text-base-content/45 mr-3 text-[10px] tracking-[0.18em] uppercase">
          Branch
        </span>
      </button>
      <Show when={isOpen()}>
        <div class="border-base-content/15 bg-base-100 absolute z-20 mt-1 w-full rounded-none border shadow-lg">
          <div class="border-base-content/10 border-b p-2">
            <input
              type="search"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              class="input input-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 w-full rounded-none border px-3 text-xs"
              placeholder="Search branches"
              aria-label="Search branches"
            />
          </div>
          <div
            class="max-h-64 overflow-y-auto py-1"
            role="listbox"
            aria-label="Source branches"
          >
            <Show
              when={filteredOptions().length > 0}
              fallback={
                <p class="text-base-content/55 px-3 py-2 text-xs">
                  No matching branches.
                </p>
              }
            >
              <For each={filteredOptions()}>
                {(option) => (
                  <button
                    type="button"
                    class="hover:bg-base-200 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
                    onClick={() => {
                      props.onChange(option.name);
                      close();
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate font-medium">
                      {option.name}
                    </span>
                    <div class="flex shrink-0 items-center gap-2">
                      <Show when={option.isCheckedOut}>
                        <span class="text-base-content/55 border-base-content/15 bg-base-200 rounded-none border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
                          Checked out
                        </span>
                      </Show>
                      <Show when={props.selectedValue().trim() === option.name}>
                        <span class="border-primary/35 bg-primary/10 text-primary rounded-none border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
                          Selected
                        </span>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
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
            <label class="projects-field task-runs-default-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Source branch</span>
              </span>
              <RunSourceBranchSelect
                options={props.runSourceBranchOptions}
                selectedValue={props.selectedRunSourceBranch}
                onChange={props.setSelectedRunSourceBranch}
                disabled={() =>
                  props.isSubmitting() ||
                  props.isLoadingRunSourceBranches() ||
                  props.runSourceBranchOptions().length === 0
                }
              />
            </label>
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
            <Show when={props.isLoadingRunSourceBranches()}>
              <p class="project-placeholder-text text-sm">
                Loading source branches...
              </p>
            </Show>
            <Show when={props.runSourceBranchError()}>
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
                disabled={
                  props.isSubmitting() ||
                  !!props.isOpenCodeMissing?.() ||
                  props.isLoadingRunSourceBranches() ||
                  !!props.runSourceBranchError()
                }
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
