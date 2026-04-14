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
  Show,
  createEffect,
  createSignal,
  type Accessor,
  type Component,
} from "solid-js";
import type { LinuxPackageUpdateAvailableResult } from "../../app/lib/linuxPackageUpdates";
import LinuxPackageUpdatePanel from "./LinuxPackageUpdatePanel";

export const LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY =
  "linuxPackageUpdateNotice.dismissedVersion";

const readDismissedVersion = () => {
  try {
    return (
      window.localStorage.getItem(
        LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      ) ?? ""
    );
  } catch {
    return "";
  }
};

const persistDismissedVersion = (version: string) => {
  try {
    window.localStorage.setItem(
      LINUX_PACKAGE_UPDATE_NOTICE_DISMISSED_VERSION_STORAGE_KEY,
      version,
    );
  } catch {
    // Ignore storage failures.
  }
};

type LinuxPackageUpdateNoticeProps = {
  result: Accessor<LinuxPackageUpdateAvailableResult | null>;
};

const LinuxPackageUpdateNotice: Component<LinuxPackageUpdateNoticeProps> = (
  props,
) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal<"idle" | "copied" | "error">(
    "idle",
  );

  createEffect(() => {
    const result = props.result();
    if (!result) {
      setIsOpen(false);
      return;
    }

    setCopyStatus("idle");
    setIsOpen(readDismissedVersion() !== result.availableVersion);
  });

  const onDismiss = () => {
    const result = props.result();
    if (!result) return;
    persistDismissedVersion(result.availableVersion);
    setIsOpen(false);
  };

  const onCopyCommand = async () => {
    const result = props.result();
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.command);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <Show when={isOpen() ? props.result() : null}>
      {(result) => (
        <div class="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(30rem,calc(100vw-2rem))]">
          <div class="pointer-events-auto">
            <LinuxPackageUpdatePanel
              result={result()}
              variant="notice"
              title="A newer Linux package is available"
              summary="This install is managed by your system package manager. Copy the command below to upgrade when you’re ready."
              copyStatus={copyStatus()}
              onCopyCommand={() => void onCopyCommand()}
              actions={
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
                    onClick={onDismiss}
                  >
                    Later
                  </button>
                </div>
              }
            />
          </div>
        </div>
      )}
    </Show>
  );
};

export default LinuxPackageUpdateNotice;
