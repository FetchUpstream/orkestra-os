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
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
  type Component,
} from "solid-js";
import * as opener from "@tauri-apps/plugin-opener";
import { SUPPORT_LINKS } from "../../app/config/supportLinks";
import {
  formatAppVersionForDisplay,
  formatSupportDebugInfo,
  readAppSupportMetadata,
} from "../../app/lib/appSupport";
import { LINUX_PACKAGE_UPDATE_METADATA_URL } from "../../app/lib/linuxPackageUpdates";
import {
  installTauriAppUpdate,
  isTauriAppUpdateAvailable,
  type AppUpdateCheckState,
} from "../../app/lib/appUpdates";
import { AppIcon } from "../ui/icons";
import appLogo from "../../assets/logo.svg";
import LinuxPackageUpdatePanel from "./LinuxPackageUpdatePanel";

type AboutModalProps = {
  isOpen: Accessor<boolean>;
  onClose: () => void;
  updateState?: Accessor<AppUpdateCheckState>;
  onCheckForUpdates?: () => void | Promise<void>;
};

const openExternalUrl = async (url: string) => {
  if ("openUrl" in opener && typeof opener.openUrl === "function") {
    try {
      await opener.openUrl(url);
      return;
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const PRODUCT_NAME = "Orkestra OS";
const PRODUCT_DESCRIPTION =
  "Desktop app for orchestrating AI agent runs across projects, tasks, and Git worktrees.";
const RESOURCE_LINKS = [
  {
    label: "Source code",
    description: "Browse the repository, releases, and roadmap.",
    href: SUPPORT_LINKS.githubRepository,
    icon: "action.github" as const,
  },
  {
    label: "Documentation",
    description: "Read the README, setup steps, and usage notes.",
    href: SUPPORT_LINKS.documentation,
    icon: "action.documentation" as const,
  },
] as const;

const formatBadgeLabel = (value?: string) => {
  if (!value) return undefined;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const AboutModal: Component<AboutModalProps> = (props) => {
  const [metadata] = createResource(readAppSupportMetadata);
  const [copyStatus, setCopyStatus] = createSignal<"idle" | "copied" | "error">(
    "idle",
  );
  const [updateCommandCopyStatus, setUpdateCommandCopyStatus] = createSignal<
    "idle" | "copied" | "error"
  >("idle");
  const [updateInstallStatus, setUpdateInstallStatus] = createSignal<
    "idle" | "installing" | "error"
  >("idle");
  let closeButtonRef: HTMLButtonElement | undefined;

  const appVersion = createMemo(() =>
    formatAppVersionForDisplay(metadata()?.appVersion),
  );
  const releaseChannel = createMemo(() => formatBadgeLabel(metadata()?.build));
  const updateState = createMemo<AppUpdateCheckState>(
    () => props.updateState?.() ?? { status: "idle" },
  );
  const availableLinuxUpdate = createMemo(() => {
    const nextState = updateState();
    return nextState.status === "update-available" &&
      nextState.kind === "linux-package"
      ? nextState
      : null;
  });
  const upToDateLinuxUpdate = createMemo(() => {
    const nextState = updateState();
    return nextState.status === "up-to-date" &&
      nextState.kind === "linux-package"
      ? nextState
      : null;
  });
  const availableTauriUpdate = createMemo(() => {
    const nextState = updateState();
    return isTauriAppUpdateAvailable(nextState) ? nextState : null;
  });
  const upToDateTauriUpdate = createMemo(() => {
    const nextState = updateState();
    return nextState.status === "up-to-date" && nextState.kind === "tauri"
      ? nextState
      : null;
  });
  const manualCheckStatusMessage = createMemo(() => {
    const nextState = updateState();

    switch (nextState.status) {
      case "checking":
        return "Checking for updates...";
      case "update-available":
        return nextState.kind === "linux-package"
          ? `Checked ${LINUX_PACKAGE_UPDATE_METADATA_URL}. Update found.`
          : "Checked for an in-app update. Update found.";
      case "up-to-date":
        return nextState.kind === "linux-package"
          ? `Checked ${LINUX_PACKAGE_UPDATE_METADATA_URL}. You're up to date.`
          : "Checked for an in-app update. You're up to date.";
      case "not-applicable":
        return nextState.reason === "bundle-type-unavailable"
          ? "Checked for updates, but this build does not expose an install type for updater guidance."
          : "Checked for updates. Package-manager guidance only applies to Linux deb and rpm installs.";
      case "error":
        return nextState.kind === "linux-package"
          ? `Couldn't check ${LINUX_PACKAGE_UPDATE_METADATA_URL} right now.`
          : "Couldn't check for an in-app update right now.";
      default:
        return "Checks for in-app updates on packaged desktop installs and shows package-manager guidance for Linux deb and rpm installs.";
    }
  });

  createEffect(() => {
    if (!props.isOpen()) return;
    const previousActiveElement = document.activeElement;
    queueMicrotask(() => closeButtonRef?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousActiveElement instanceof HTMLElement) {
        queueMicrotask(() => previousActiveElement.focus());
      }
    });
  });

  createEffect(() => {
    if (!props.isOpen()) {
      setCopyStatus("idle");
      setUpdateCommandCopyStatus("idle");
      setUpdateInstallStatus("idle");
    }
  });

  const onCopyDebugInfo = async () => {
    try {
      const debugInfo = formatSupportDebugInfo(metadata() ?? {});
      await navigator.clipboard.writeText(debugInfo);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const onReportBug = async () => {
    await openExternalUrl(SUPPORT_LINKS.issueReporting);
  };

  const onCopyUpdateCommand = async () => {
    const nextUpdateState = updateState();
    if (nextUpdateState.status !== "update-available" || nextUpdateState.kind !== "linux-package") {
      return;
    }

    try {
      await navigator.clipboard.writeText(nextUpdateState.command);
      setUpdateCommandCopyStatus("copied");
    } catch {
      setUpdateCommandCopyStatus("error");
    }
  };

  const onInstallUpdate = async () => {
    const nextUpdateState = availableTauriUpdate();
    if (!nextUpdateState || updateInstallStatus() === "installing") {
      return;
    }

    try {
      setUpdateInstallStatus("installing");
      await installTauriAppUpdate(nextUpdateState.manifestUrl);
    } catch {
      setUpdateInstallStatus("error");
    }
  };

  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            props.onClose();
          }
        }}
      >
        <section
          class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-modal-title"
          aria-describedby="about-modal-description"
        >
          <div class="border-base-content/10 flex items-start justify-between gap-4 border-b px-5 py-4">
            <div class="space-y-1">
              <p class="text-base-content/50 text-[11px] font-semibold tracking-[0.2em] uppercase">
                About
              </p>
              <h2 id="about-modal-title" class="task-delete-modal-title">
                About {PRODUCT_NAME}
              </h2>
            </div>
            <button
              type="button"
              ref={(element) => {
                closeButtonRef = element;
              }}
              class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
              onClick={props.onClose}
              aria-label="Close about modal"
              title="Close"
            >
              <AppIcon name="panel.close" size={16} stroke={1.75} />
            </button>
          </div>

          <div class="space-y-4 px-5 py-4">
            <div class="border-base-content/10 bg-base-100/55 flex items-start gap-3 border px-4 py-4">
              <div class="border-base-content/10 bg-base-100 flex h-11 w-11 shrink-0 items-center justify-center border p-2">
                <img
                  src={appLogo}
                  alt=""
                  class="h-full w-full object-contain"
                />
              </div>
              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-base-content text-sm font-semibold tracking-[0.08em] uppercase">
                    {PRODUCT_NAME}
                  </p>
                  <Show when={releaseChannel()}>
                    {(label) => (
                      <span class="badge badge-ghost badge-sm border-base-content/10 text-base-content/60 rounded-none text-[10px] uppercase">
                        {label()}
                      </span>
                    )}
                  </Show>
                </div>
                <p
                  id="about-modal-description"
                  class="text-base-content/65 text-sm leading-5"
                >
                  {PRODUCT_DESCRIPTION}
                </p>
                <div class="text-base-content/55 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span class="font-medium">Version {appVersion()}</span>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.18em] uppercase">
                Links
              </p>
              <div class="space-y-2">
                <For each={RESOURCE_LINKS}>
                  {(link) => (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      class="border-base-content/10 bg-base-100/45 hover:bg-base-100/70 focus-visible:border-primary/40 focus-visible:ring-primary/20 flex w-full items-center justify-between gap-3 border px-3 py-3 text-left transition focus-visible:ring-2 focus-visible:outline-none"
                      onClick={async (event) => {
                        event.preventDefault();
                        await openExternalUrl(link.href);
                      }}
                    >
                      <span class="flex min-w-0 items-start gap-3">
                        <span class="text-base-content/70 border-base-content/10 bg-base-100 mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center border">
                          <AppIcon name={link.icon} size={16} stroke={1.75} />
                        </span>
                        <span class="min-w-0">
                          <span class="text-base-content block text-sm font-medium">
                            {link.label}
                          </span>
                          <span class="text-base-content/55 mt-0.5 block text-xs leading-4">
                            {link.description}
                          </span>
                        </span>
                      </span>
                      <span class="text-base-content/45 shrink-0">
                        <AppIcon
                          name="action.external"
                          size={15}
                          stroke={1.75}
                        />
                      </span>
                    </a>
                  )}
                </For>
              </div>
            </div>

            <div class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.18em] uppercase">
                    Updates
                  </p>
                  <p class="text-base-content/55 mt-1 text-xs leading-5">
                    Checks for in-app updates on packaged desktop installs and
                    shows package-manager upgrade guidance for Linux deb and rpm
                    installs.
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
                  onClick={() => {
                    setUpdateCommandCopyStatus("idle");
                    setUpdateInstallStatus("idle");
                    void props.onCheckForUpdates?.();
                  }}
                  disabled={
                    !props.onCheckForUpdates ||
                    updateState().status === "checking" ||
                    updateInstallStatus() === "installing"
                  }
                >
                  {updateState().status === "checking"
                    ? "Checking..."
                    : updateInstallStatus() === "installing"
                      ? "Installing..."
                      : "Check for updates"}
                </button>
              </div>

              <p
                class="text-base-content/60 text-xs leading-5"
                aria-live="polite"
              >
                {manualCheckStatusMessage()}
              </p>

              <Show when={updateState().status === "idle"}>
                <div class="border-base-content/10 bg-base-100/45 rounded-none border px-4 py-3">
                  <p class="text-base-content/65 text-xs leading-5">
                    Run a manual update check for this install.
                  </p>
                </div>
              </Show>

              <Show when={updateState().status === "checking"}>
                <div class="border-base-content/10 bg-base-100/45 rounded-none border px-4 py-3">
                  <p class="text-base-content/65 text-xs leading-5">
                    Checking for the latest available update...
                  </p>
                </div>
              </Show>

              <Show when={updateState().status === "error"}>
                <div class="border-error/25 bg-error/8 rounded-none border px-4 py-3">
                  <p class="text-error text-xs leading-5">
                    Couldn’t check for updates right now. Try again in a moment.
                  </p>
                </div>
              </Show>

              <Show when={updateState().status === "not-applicable"}>
                <div class="border-base-content/10 bg-base-100/45 rounded-none border px-4 py-3">
                  <p class="text-base-content/65 text-xs leading-5">
                    This build does not currently support automatic in-app
                    updates.
                  </p>
                </div>
              </Show>

              <Show when={availableLinuxUpdate()}>
                {(result) => (
                  <LinuxPackageUpdatePanel
                    result={result()}
                    title="A newer Linux package is available"
                    summary="A newer published package is available for this install type. Copy the command below to upgrade with your package manager."
                    copyStatus={updateCommandCopyStatus()}
                    onCopyCommand={() => void onCopyUpdateCommand()}
                  />
                )}
              </Show>

              <Show when={upToDateLinuxUpdate()}>
                {(result) => (
                  <LinuxPackageUpdatePanel
                    result={result()}
                    title="You’re up to date"
                    summary="This Linux package install already matches the latest published update metadata."
                  />
                )}
              </Show>

              <Show when={availableTauriUpdate()}>
                {(result) => (
                  <section class="border-base-content/10 bg-base-100/45 rounded-none border px-4 py-4">
                    <div class="flex items-start justify-between gap-3">
                      <div class="space-y-1">
                        <p class="text-base-content/50 text-[11px] font-semibold tracking-[0.18em] uppercase">
                          In-app update
                        </p>
                        <h3 class="text-base-content text-sm font-semibold">
                          A newer app update is available
                        </h3>
                        <p class="text-base-content/65 text-xs leading-5">
                          This build can download and install the latest release
                          in-app. The app will restart to finish applying the
                          update.
                        </p>
                      </div>
                      <span class="badge badge-primary badge-sm rounded-none text-[10px] uppercase">
                        New
                      </span>
                    </div>

                    <dl class="text-base-content/60 mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt class="font-semibold tracking-[0.16em] uppercase">
                          Installed
                        </dt>
                        <dd class="text-base-content mt-1 font-medium">
                          v{result().currentVersion}
                        </dd>
                      </div>
                      <div>
                        <dt class="font-semibold tracking-[0.16em] uppercase">
                          Latest
                        </dt>
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
                          <For each={result().notes}>
                            {(note) => <li>{note}</li>}
                          </For>
                        </ul>
                      </Show>
                    </div>

                    <div class="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        class="btn btn-sm border-primary/35 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                        onClick={() => void onInstallUpdate()}
                        disabled={updateInstallStatus() === "installing"}
                      >
                        {updateInstallStatus() === "installing"
                          ? "Installing..."
                          : "Download and install"}
                      </button>
                      <div class="min-h-4 text-xs" aria-live="polite">
                        <Show when={updateInstallStatus() === "error"}>
                          <p class="text-error">
                            Couldn’t install the app update.
                          </p>
                        </Show>
                      </div>
                    </div>
                  </section>
                )}
              </Show>

              <Show when={upToDateTauriUpdate()}>
                {(result) => (
                  <section class="border-base-content/10 bg-base-100/45 rounded-none border px-4 py-4">
                    <p class="text-base-content/50 text-[11px] font-semibold tracking-[0.18em] uppercase">
                      In-app update
                    </p>
                    <h3 class="text-base-content mt-1 text-sm font-semibold">
                      You’re up to date
                    </h3>
                    <p class="text-base-content/65 mt-1 text-xs leading-5">
                      This packaged desktop install already matches the latest
                      available in-app update.
                    </p>
                    <div class="text-base-content/60 mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt class="font-semibold tracking-[0.16em] uppercase">
                          Installed
                        </dt>
                        <dd class="text-base-content mt-1 font-medium">
                          v{result().currentVersion}
                        </dd>
                      </div>
                      <div>
                        <dt class="font-semibold tracking-[0.16em] uppercase">
                          Latest
                        </dt>
                        <dd class="text-base-content mt-1 font-medium">
                          v{result().availableVersion}
                        </dd>
                      </div>
                    </div>
                  </section>
                )}
              </Show>
            </div>
          </div>

          <div class="border-base-content/10 flex items-center justify-between gap-3 border-t px-5 py-4">
            <div class="min-h-4 text-xs" aria-live="polite">
              <Show when={copyStatus() === "copied"}>
                <p class="text-success">Copied support details.</p>
              </Show>
              <Show when={copyStatus() === "error"}>
                <p class="text-error">Couldn’t copy support details.</p>
              </Show>
            </div>

            <div class="task-delete-modal-actions mt-0 justify-end gap-2">
              <button
                type="button"
                class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
                onClick={onReportBug}
              >
                <AppIcon name="action.bug" size={14} stroke={1.75} />
                Report a bug
              </button>
              <button
                type="button"
                class="btn btn-sm border-primary/35 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={onCopyDebugInfo}
              >
                <AppIcon name="action.copy" size={14} stroke={1.75} />
                Copy debug info
              </button>
            </div>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default AboutModal;
