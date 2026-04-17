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

import { getVersion } from "@tauri-apps/api/app";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from "solid-js";
import {
  ALPHA_BUILD_GITHUB_HOMEPAGE,
  ALPHA_BUILD_RELEASE_NOTES,
} from "../../app/config/alphaBuild";

export const ALPHA_NOTICE_ACK_STORAGE_KEY = "alphaNotice.acknowledgedVersion";

const readAcknowledgedVersion = () => {
  try {
    return window.localStorage.getItem(ALPHA_NOTICE_ACK_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const persistAcknowledgedVersion = (version: string) => {
  try {
    window.localStorage.setItem(ALPHA_NOTICE_ACK_STORAGE_KEY, version);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.)
  }
};

const AlphaNoticeModal: Component = () => {
  const [version] = createResource(getVersion);
  const [isOpen, setIsOpen] = createSignal(false);

  const resolvedVersion = createMemo(
    () => version() ?? (version.error ? "unknown" : "loading..."),
  );

  createEffect(() => {
    const currentVersion = resolvedVersion();
    if (currentVersion === "loading...") return;

    setIsOpen(readAcknowledgedVersion() !== currentVersion);
  });

  const onContinue = () => {
    persistAcknowledgedVersion(resolvedVersion());
    setIsOpen(false);
  };

  return (
    <Show when={isOpen()}>
      <div class="projects-modal-backdrop" role="presentation">
        <section
          class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alpha-build-modal-title"
          aria-describedby="alpha-build-modal-copy"
        >
          <h2 id="alpha-build-modal-title" class="task-delete-modal-title">
            Alpha Build
          </h2>

          <div id="alpha-build-modal-copy" class="space-y-3 text-sm font-sans">
            <p class="project-placeholder-text">
              You’re using an alpha version of this app.
            </p>
            <p class="project-placeholder-text">
              This build is still under active development and may contain:
            </p>
            <ul class="project-placeholder-text list-disc space-y-1 pl-5">
              <li>unfinished features</li>
              <li>bugs and visual issues</li>
              <li>unexpected crashes or data loss</li>
              <li>workflows that may change without notice</li>
            </ul>
            <p class="project-placeholder-text">
              Please use caution and avoid relying on this build for critical
              work.
            </p>
            <p
              class="m-0 text-[0.85rem] leading-[1.4] font-sans"
              style={{ color: "var(--text)" }}
            >
              Version: {resolvedVersion()}
            </p>

            <div class="border-base-content/10 bg-base-100/55 rounded-none border px-3 py-2">
              <p class="text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                What’s new in this build
              </p>
              <ul
                class="mt-1 list-disc space-y-1 pl-5 text-[0.85rem] leading-[1.4] font-sans"
                style={{ color: "var(--text)" }}
              >
                <For each={ALPHA_BUILD_RELEASE_NOTES}>
                  {(note) => <li>{note}</li>}
                </For>
              </ul>
            </div>

            <p class="project-placeholder-text">
              This project is dual-licensed under Apache 2.0 and MIT.
            </p>
            <p class="project-placeholder-text">
              GitHub:{" "}
              <a
                href={ALPHA_BUILD_GITHUB_HOMEPAGE}
                class="link link-hover"
                target="_blank"
                rel="noopener noreferrer"
              >
                {ALPHA_BUILD_GITHUB_HOMEPAGE}
              </a>
            </p>

            <p class="text-base-content/65 text-xs">
              By continuing, you acknowledge that this is an early test build
              and that the experience may be unstable.
            </p>
          </div>

          <div class="task-delete-modal-actions mt-4">
            <button
              type="button"
              class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
              onClick={onContinue}
            >
              Continue
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default AlphaNoticeModal;
