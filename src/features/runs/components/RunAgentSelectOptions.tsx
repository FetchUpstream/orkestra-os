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

import { For, Show, type Component } from "solid-js";
import type { RunAgentOption } from "../../../app/lib/runs";

type RunAgentSelectOptionsProps = {
  options: RunAgentOption[];
  includeSystemDefaultOption?: boolean;
};

const RunAgentSelectOptions: Component<RunAgentSelectOptionsProps> = (
  props,
) => {
  const projectOptions = () =>
    props.options.filter((option) => option.scope === "project");
  const globalOptions = () =>
    props.options.filter((option) => option.scope === "global");
  const inheritedOptions = () =>
    props.options.filter(
      (option) => option.scope !== "project" && option.scope !== "global",
    );

  return (
    <>
      <Show when={props.includeSystemDefaultOption}>
        <option value="">System default agent</option>
      </Show>
      <Show when={projectOptions().length > 0}>
        <optgroup label="Project agents">
          <For each={projectOptions()}>
            {(option) => <option value={option.id}>{option.label}</option>}
          </For>
        </optgroup>
      </Show>
      <Show when={globalOptions().length > 0}>
        <optgroup label="Global agents">
          <For each={globalOptions()}>
            {(option) => <option value={option.id}>{option.label}</option>}
          </For>
        </optgroup>
      </Show>
      <Show when={inheritedOptions().length > 0}>
        <optgroup label="Available agents">
          <For each={inheritedOptions()}>
            {(option) => <option value={option.id}>{option.label}</option>}
          </For>
        </optgroup>
      </Show>
    </>
  );
};

export default RunAgentSelectOptions;
