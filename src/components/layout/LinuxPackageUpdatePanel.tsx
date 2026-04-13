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

import { For, Show, type Component, type JSX } from "solid-js";
import type {
  LinuxPackageUpdateAvailableResult,
  LinuxPackageUpToDateResult,
} from "../../app/lib/linuxPackageUpdates";
import { AppIcon } from "../ui/icons";

type LinuxPackageUpdatePanelProps = {
  result: LinuxPackageUpdateAvailableResult | LinuxPackageUpToDateResult;
  title: string;
  summary: string;
  copyStatus?: "idle" | "copied" | "error";
  onCopyCommand?: () => void | Promise<void>;
  actions?: JSX.Element;
  variant?: "notice" | "embedded";
};

const formatReleaseDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const LinuxPackageUpdatePanel: Component<LinuxPackageUpdatePanelProps> = (
  props,
) => {
  const variant = () => props.variant ?? "embedded";
  const releaseDate = () => formatReleaseDate(props.result.metadata.releasedAt);
  const availableResult = () =>
    props.result.status === "update-available" ? props.result : null;

  return (
    <section
      class={
        variant() === "notice"
          ? "border-base-content/15 bg-base-200 w-full rounded-none border p-4 shadow-2xl"
          : "border-base-content/10 bg-base-100/45 rounded-none border px-4 py-4"
      }
    >
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <p class="text-base-content/50 text-[11px] font-semibold tracking-[0.18em] uppercase">
            Package update
          </p>
          <h3 class="text-base-content text-sm font-semibold">{props.title}</h3>
          <p class="text-base-content/65 text-xs leading-5">{props.summary}</p>
        </div>
        <Show when={props.result.status === "update-available"}>
          <span class="badge badge-primary badge-sm rounded-none text-[10px] uppercase">
            New
          </span>
        </Show>
      </div>

      <dl class="text-base-content/60 mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt class="font-semibold tracking-[0.16em] uppercase">Installed</dt>
          <dd class="text-base-content mt-1 font-medium">
            v{props.result.currentVersion}
          </dd>
        </div>
        <div>
          <dt class="font-semibold tracking-[0.16em] uppercase">Latest</dt>
          <dd class="text-base-content mt-1 font-medium">
            v{props.result.availableVersion}
          </dd>
        </div>
        <div>
          <dt class="font-semibold tracking-[0.16em] uppercase">
            Install type
          </dt>
          <dd class="text-base-content mt-1 font-medium uppercase">
            {props.result.bundleType}
          </dd>
        </div>
        <Show when={releaseDate()}>
          {(value) => (
            <div>
              <dt class="font-semibold tracking-[0.16em] uppercase">
                Released
              </dt>
              <dd class="text-base-content mt-1 font-medium">{value()}</dd>
            </div>
          )}
        </Show>
      </dl>

      <Show when={availableResult()}>
        <div class="mt-4 space-y-2">
          <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.18em] uppercase">
            Upgrade command
          </p>
          <div class="border-base-content/10 bg-base-300/45 rounded-none border px-3 py-3">
            <code class="text-base-content block text-xs leading-5 break-words">
              {availableResult()?.command}
            </code>
          </div>
          <Show when={props.onCopyCommand}>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="btn btn-sm border-primary/35 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={() => void props.onCopyCommand?.()}
              >
                <AppIcon name="action.copy" size={14} stroke={1.75} />
                Copy update command
              </button>
              <div class="min-h-4 text-xs" aria-live="polite">
                <Show when={props.copyStatus === "copied"}>
                  <p class="text-success">Copied update command.</p>
                </Show>
                <Show when={props.copyStatus === "error"}>
                  <p class="text-error">Couldn’t copy update command.</p>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <div class="mt-4 space-y-2">
        <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.18em] uppercase">
          Release notes
        </p>
        <Show
          when={props.result.metadata.notes.length > 0}
          fallback={
            <p class="text-base-content/60 text-xs leading-5">
              No release notes were published for this release.
            </p>
          }
        >
          <ul class="text-base-content/75 list-disc space-y-2 pl-5 text-xs leading-5">
            <For each={props.result.metadata.notes}>
              {(note) => <li>{note}</li>}
            </For>
          </ul>
        </Show>
      </div>

      <Show when={props.actions}>
        <div class="mt-4">{props.actions}</div>
      </Show>
    </section>
  );
};

export default LinuxPackageUpdatePanel;
