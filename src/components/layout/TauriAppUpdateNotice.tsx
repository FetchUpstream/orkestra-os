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
  createSignal,
  type Accessor,
  type Component,
} from "solid-js";
import {
  installTauriAppUpdate,
  type TauriAppUpdateAvailableResult,
} from "../../app/lib/appUpdates";

export const TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY =
  "tauriAppUpdateNotice.dismissedVersion";

const readDismissedVersion = () => {
  try {
    return (
      window.localStorage.getItem(
        TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      ) ?? ""
    );
  } catch {
    return "";
  }
};

const persistDismissedVersion = (version: string) => {
  try {
    window.localStorage.setItem(
      TAURI_APP_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      version,
    );
  } catch {
    // Ignore storage failures.
  }
};

type TauriAppUpdateNoticeProps = {
  result: Accessor<TauriAppUpdateAvailableResult | null>;
};

const TauriAppUpdateNotice: Component<TauriAppUpdateNoticeProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [installStatus, setInstallStatus] = createSignal<
    "idle" | "installing" | "error"
  >("idle");

  createEffect(() => {
    const result = props.result();
    if (!result) {
      setIsOpen(false);
      return;
    }

    setInstallStatus("idle");
    setIsOpen(readDismissedVersion() !== result.availableVersion);
  });

  const onDismiss = () => {
    const result = props.result();
    if (!result) return;
    persistDismissedVersion(result.availableVersion);
    setIsOpen(false);
  };

  const onInstall = async () => {
    const result = props.result();
    if (!result || installStatus() === "installing") return;

    try {
      setInstallStatus("installing");
      await installTauriAppUpdate(result.manifestUrl);
    } catch {
      setInstallStatus("error");
    }
  };

  return (
    <Show when={isOpen() ? props.result() : null}>
      {(result) => (
        <div class="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(30rem,calc(100vw-2rem))]">
          <div class="pointer-events-auto border-base-content/15 bg-base-200 rounded-none border p-4 shadow-2xl">
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-1">
                <p class="text-base-content/50 text-[11px] font-semibold tracking-[0.18em] uppercase">
                  In-app update
                </p>
                <h3 class="text-base-content text-sm font-semibold">
                  A newer app update is available
                </h3>
                <p class="text-base-content/65 text-xs leading-5">
                  This packaged desktop install can download and install the latest
                  release in-app. The app will restart to finish applying the
                  update.
                </p>
              </div>
              <span class="badge badge-primary badge-sm rounded-none text-[10px] uppercase">
                New
              </span>
            </div>

            <dl class="text-base-content/60 mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt class="font-semibold tracking-[0.16em] uppercase">Installed</dt>
                <dd class="text-base-content mt-1 font-medium">
                  v{result().currentVersion}
                </dd>
              </div>
              <div>
                <dt class="font-semibold tracking-[0.16em] uppercase">Latest</dt>
                <dd class="text-base-content mt-1 font-medium">
                  v{result().availableVersion}
                </dd>
              </div>
            </dl>

            <div class="mt-4 space-y-2">
              <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.18em] uppercase">
                Release notes
              </p>
              <Show
                when={result().notes.length > 0}
                fallback={
                  <p class="text-base-content/60 text-xs leading-5">
                    No release notes were published for this release.
                  </p>
                }
              >
                <ul class="text-base-content/75 list-disc space-y-2 pl-5 text-xs leading-5">
                  <For each={result().notes}>{(note) => <li>{note}</li>}</For>
                </ul>
              </Show>
            </div>

            <div class="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
                onClick={onDismiss}
                disabled={installStatus() === "installing"}
              >
                Later
              </button>
              <button
                type="button"
                class="btn btn-sm border-primary/35 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={() => void onInstall()}
                disabled={installStatus() === "installing"}
              >
                {installStatus() === "installing"
                  ? "Installing..."
                  : "Download and install"}
              </button>
            </div>

            <div class="mt-3 min-h-4 text-xs" aria-live="polite">
              <Show when={installStatus() === "error"}>
                <p class="text-error">Couldn’t install the app update.</p>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default TauriAppUpdateNotice;
