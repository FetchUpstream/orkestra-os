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

import { useLocation, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
} from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listProjects, type Project } from "../lib/projects";
import { primeRunSelectionOptionsCache } from "../lib/runSelectionOptionsCache";
import { listActiveRuns } from "../lib/runs";
import type { TaskStatus } from "../lib/tasks";
import {
  checkForLinuxPackageUpdate,
  type LinuxPackageUpdateAvailableResult,
  type LinuxPackageUpdateCheckState,
} from "../lib/linuxPackageUpdates";
import MainContent from "../../components/layout/MainContent";
import OpenCodeRequiredModal from "../../components/layout/OpenCodeRequiredModal";
import SidebarNav from "../../components/layout/SidebarNav";
import Topbar from "../../components/layout/Topbar";
import AlphaNoticeModal from "../../components/layout/AlphaNoticeModal";
import AboutModal from "../../components/layout/AboutModal";
import CloseWhileRunsActiveModal from "../../components/layout/CloseWhileRunsActiveModal";
import LinuxPackageUpdateNotice from "../../components/layout/LinuxPackageUpdateNotice";
import { AppIcon } from "../../components/ui/icons";
import { formatStatus } from "../../features/tasks/utils/taskDetail";
import {
  OpenCodeDependencyProvider,
  useOpenCodeDependency,
} from "../contexts/OpenCodeDependencyContext";
import {
  BOARD_ROUTE_PATH,
  buildBoardHref,
  getBoardProjectIdFromSearch,
  readRememberedBoardProjectId,
} from "../lib/boardNavigation";

type TaskDetailTopbarConfig =
  | {
      mode: "detail";
      title?: string;
      projectKey?: string;
      subtitle?: string;
      backHref: string;
      backLabel: string;
      autosaveState: "idle" | "saving" | "saved" | "error";
      isCreatingRun: boolean;
      isBlocked: boolean;
      isChangingStatus: boolean;
      isTransitionMenuOpen: boolean;
      isDeleting: boolean;
      validTransitionOptions: TaskStatus[];
      onOpenRunSettingsModal: () => void;
      onToggleTransitionMenu: () => void;
      onCloseTransitionMenu: () => void;
      onSetStatus: (status: TaskStatus) => void | Promise<void>;
      onRequestDeleteTask: () => void;
    }
  | {
      mode: "create";
      title?: string;
      subtitle?: string;
      backHref: string;
      backLabel: string;
      isSubmitting: boolean;
      onRequestCreateTask: () => void | Promise<void>;
      onRequestClose: () => void;
    };

type RunDetailTopbarConfig = {
  title: string;
  subtitle: string;
  connectionStatus: "warming" | "connected" | "idle" | "disconnected";
  backHref: string;
  backLabel: string;
  actions: Array<{
    key: "logs" | "terminal" | "review" | "git";
    label: string;
    icon: "run.logs" | "run.terminal" | "run.review" | "run.git";
    pressed: boolean;
    onClick: () => void;
  }>;
};

type ProjectSettingsTopbarConfig = {
  autosaveState: "idle" | "saving" | "saved" | "error";
  hasPendingChanges: boolean;
  onRequestClose?: () => void | Promise<void>;
};

type AppShellProps = {
  children?: JSX.Element;
};

const AppShell: Component<AppShellProps> = (props) => {
  return (
    <OpenCodeDependencyProvider>
      <AppShellContent>{props.children}</AppShellContent>
    </OpenCodeDependencyProvider>
  );
};

const AppShellContent: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  const openCodeDependency = useOpenCodeDependency();
  let mobileMenuButtonRef: HTMLButtonElement | undefined;
  let shellRootRef: HTMLDivElement | undefined;

  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [hasLoadedProjects, setHasLoadedProjects] = createSignal(false);
  const [boardSearchQuery, setBoardSearchQuery] = createSignal("");
  const [taskDetailTopbarConfig, setTaskDetailTopbarConfig] =
    createSignal<TaskDetailTopbarConfig | null>(null);
  const [runDetailTopbarConfig, setRunDetailTopbarConfig] =
    createSignal<RunDetailTopbarConfig | null>(null);
  const [projectSettingsTopbarConfig, setProjectSettingsTopbarConfig] =
    createSignal<ProjectSettingsTopbarConfig | null>(null);
  const [aboutModalOpen, setAboutModalOpen] = createSignal(false);
  const [closeWarningOpen, setCloseWarningOpen] = createSignal(false);
  const [closeWarningRunCount, setCloseWarningRunCount] = createSignal(0);
  const [confirmedCloseInProgress, setConfirmedCloseInProgress] =
    createSignal(false);
  const [linuxPackageUpdateState, setLinuxPackageUpdateState] =
    createSignal<LinuxPackageUpdateCheckState>({ status: "idle" });
  const [startupLinuxPackageUpdate, setStartupLinuxPackageUpdate] =
    createSignal<LinuxPackageUpdateAvailableResult | null>(null);
  let linuxPackageUpdateRequestId = 0;

  const isSidebarVisible = () => (isMobile() ? mobileSidebarOpen() : true);

  const applyProjects = (nextProjects: Project[]) => {
    setProjects(nextProjects);
    if (nextProjects.length === 0 && location.pathname !== "/projects") {
      navigate("/projects", { replace: true });
    }
  };

  const refreshProjects = async () => {
    const nextProjects = await listProjects();
    applyProjects(nextProjects);
  };

  const runLinuxPackageUpdateCheck = async ({
    silent = false,
  }: {
    silent?: boolean;
  } = {}) => {
    const requestId = ++linuxPackageUpdateRequestId;

    if (!silent) {
      setLinuxPackageUpdateState({ status: "checking" });
    }

    const result = await checkForLinuxPackageUpdate();

    if (requestId !== linuxPackageUpdateRequestId) {
      return result;
    }

    if (silent && result.status === "error") {
      console.warn("Linux package update check failed", result.message);
      return result;
    }

    setLinuxPackageUpdateState(result);
    setStartupLinuxPackageUpdate(
      result.status === "update-available" ? result : null,
    );
    return result;
  };

  onMount(async () => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateMobileMode = (matches: boolean) => {
      setIsMobile(matches);
      if (matches) {
        setMobileSidebarOpen(false);
      }
    };

    updateMobileMode(mediaQuery.matches);

    const handleMediaChange = (event: MediaQueryListEvent) => {
      updateMobileMode(event.matches);
    };

    mediaQuery.addEventListener("change", handleMediaChange);

    onCleanup(() => {
      mediaQuery.removeEventListener("change", handleMediaChange);
    });

    try {
      await refreshProjects();
      const projectIdToPrime = boardProjectId() || projects()[0]?.id;
      if (projectIdToPrime) {
        primeRunSelectionOptionsCache(projectIdToPrime);
      }
    } catch (error) {
      console.warn("Failed to load projects during startup", error);
    } finally {
      setHasLoadedProjects(true);
    }

    void runLinuxPackageUpdateCheck({ silent: true });

    const onTaskDetailTopbarConfig = (event: Event) => {
      const customEvent = event as CustomEvent<TaskDetailTopbarConfig>;
      setTaskDetailTopbarConfig(customEvent.detail);
    };
    const onTaskDetailTopbarClear = () => {
      setTaskDetailTopbarConfig(null);
    };
    const onRunDetailTopbarConfig = (event: Event) => {
      const customEvent = event as CustomEvent<RunDetailTopbarConfig>;
      setRunDetailTopbarConfig(customEvent.detail);
    };
    const onRunDetailTopbarClear = () => {
      setRunDetailTopbarConfig(null);
    };
    const onProjectSettingsTopbarConfig = (event: Event) => {
      const customEvent = event as CustomEvent<ProjectSettingsTopbarConfig>;
      setProjectSettingsTopbarConfig(customEvent.detail);
    };
    const onProjectSettingsTopbarClear = () => {
      setProjectSettingsTopbarConfig(null);
    };
    const onProjectsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Project[]>;
      applyProjects(customEvent.detail);
    };

    window.addEventListener(
      "task-detail:topbar-config",
      onTaskDetailTopbarConfig,
    );
    window.addEventListener(
      "task-detail:topbar-clear",
      onTaskDetailTopbarClear,
    );
    window.addEventListener(
      "run-detail:topbar-config",
      onRunDetailTopbarConfig,
    );
    window.addEventListener("run-detail:topbar-clear", onRunDetailTopbarClear);
    window.addEventListener(
      "project-settings:topbar-config",
      onProjectSettingsTopbarConfig,
    );
    window.addEventListener(
      "project-settings:topbar-clear",
      onProjectSettingsTopbarClear,
    );
    window.addEventListener("projects:updated", onProjectsUpdated);

    onCleanup(() => {
      window.removeEventListener(
        "task-detail:topbar-config",
        onTaskDetailTopbarConfig,
      );
      window.removeEventListener(
        "task-detail:topbar-clear",
        onTaskDetailTopbarClear,
      );
      window.removeEventListener(
        "run-detail:topbar-config",
        onRunDetailTopbarConfig,
      );
      window.removeEventListener(
        "run-detail:topbar-clear",
        onRunDetailTopbarClear,
      );
      window.removeEventListener(
        "project-settings:topbar-config",
        onProjectSettingsTopbarConfig,
      );
      window.removeEventListener(
        "project-settings:topbar-clear",
        onProjectSettingsTopbarClear,
      );
      window.removeEventListener("projects:updated", onProjectsUpdated);
    });

    try {
      const appWindow = getCurrentWindow();
      const unlistenCloseRequested = await appWindow.onCloseRequested(
        async (event) => {
          if (confirmedCloseInProgress()) {
            return;
          }

          try {
            const activeRuns = await listActiveRuns();
            if (activeRuns.length === 0) {
              return;
            }

            event.preventDefault();
            setCloseWarningRunCount(activeRuns.length);
            setCloseWarningOpen(true);
          } catch (error) {
            console.warn("Failed to check active runs before close", error);
          }
        },
      );

      onCleanup(() => {
        unlistenCloseRequested();
      });
    } catch (error) {
      console.warn("Failed to register app close interceptor", error);
    }
  });

  createEffect(() => {
    if (!location.pathname.includes("/tasks/")) {
      setTaskDetailTopbarConfig(null);
    }
  });

  createEffect(() => {
    if (!location.pathname.startsWith("/runs/")) {
      setRunDetailTopbarConfig(null);
    }
  });

  createEffect(() => {
    if (!location.pathname.startsWith("/projects/")) {
      setProjectSettingsTopbarConfig(null);
    }
  });

  createEffect(() => {
    if (isMobile()) {
      location.pathname;
      setMobileSidebarOpen(false);
    }
  });

  createEffect(() => {
    if (isMobile() && !mobileSidebarOpen()) {
      if (
        document.activeElement &&
        shellRootRef?.contains(document.activeElement)
      ) {
        mobileMenuButtonRef?.focus();
      }
    }
  });

  createEffect(() => {
    if (isSidebarVisible()) {
      queueMicrotask(() => {
        const firstNavLink = document.querySelector(
          "#app-sidebar .sidebar-nav a",
        ) as HTMLAnchorElement | null;
        if (firstNavLink && document.activeElement?.tagName === "BUTTON") {
          const active = document.activeElement as HTMLElement;
          if (active.getAttribute("aria-label") === "Open navigation menu") {
            firstNavLink.focus();
          }
        }
      });
    }
  });

  const onMobileOpen = () => {
    setMobileSidebarOpen(true);
  };

  const onMobileClose = () => {
    setMobileSidebarOpen(false);
  };

  const onOpenSettings = () => {
    setAboutModalOpen(true);
  };

  const onCloseSettings = () => {
    setAboutModalOpen(false);
  };

  const onCancelCloseWarning = () => {
    setCloseWarningOpen(false);
    setCloseWarningRunCount(0);
  };

  const onConfirmCloseWarning = async () => {
    setConfirmedCloseInProgress(true);
    setCloseWarningOpen(false);
    try {
      await getCurrentWindow().destroy();
    } catch (error) {
      setConfirmedCloseInProgress(false);
      console.warn("Failed to close app window", error);
    }
  };

  const dispatchBoardSearchQuery = (query: string) => {
    window.dispatchEvent(
      new CustomEvent("board:search-query", {
        detail: { query },
      }),
    );
  };

  const isStartupProjectSetupBlocked = () => {
    const dependencyState = openCodeDependency.state();
    if (
      !hasLoadedProjects() ||
      projects().length > 0 ||
      location.pathname !== "/projects"
    ) {
      return false;
    }
    return dependencyState !== "available";
  };

  const isStartupProjectSetupBooting = () => {
    if (!isStartupProjectSetupBlocked()) {
      return false;
    }
    const dependencyState = openCodeDependency.state();
    return dependencyState === "unknown" || dependencyState === "checking";
  };

  const shellTitle = () => {
    if (location.pathname.endsWith("/tasks/new")) return "Create task";
    if (location.pathname === BOARD_ROUTE_PATH) {
      const projectId = boardProjectId();
      const project = projectId
        ? projects().find((item) => item.id === projectId)
        : projects()[0];
      return project?.name ?? "Board";
    }
    if (location.pathname.startsWith("/runs/")) return "Run workspace";
    if (location.pathname.includes("/tasks/")) return "Task detail";
    if (location.pathname.startsWith("/tasks/")) return "Task detail";
    if (location.pathname.startsWith("/projects/")) return "Project settings";
    if (location.pathname === "/projects") return "Projects";
    return "Board";
  };

  const shellSubtitle = () => {
    if (location.pathname === BOARD_ROUTE_PATH) {
      return undefined;
    }
    if (location.pathname.startsWith("/runs/")) {
      return "Review conversations, diffs, and terminal activity.";
    }
    if (location.pathname === "/projects") {
      return "Create a new project workspace and configure repositories.";
    }
    if (
      location.pathname.endsWith("/tasks/new") ||
      location.pathname.startsWith("/tasks/") ||
      location.pathname.includes("/tasks/")
    ) {
      return location.pathname.endsWith("/tasks/new")
        ? "Create a new task in project context."
        : "Follow task state and execution context.";
    }
    if (location.pathname.startsWith("/projects/")) {
      return "Edit project identity and repository configuration.";
    }
    return "Track work across your active projects.";
  };

  const topbarTitle = () => {
    const config = taskDetailTopbarConfig();
    const runConfig = runDetailTopbarConfig();
    if (location.pathname.includes("/tasks/") && config?.title?.trim()) {
      if (config.mode === "detail") {
        const key = config.projectKey?.trim();
        return (
          <span class="inline-flex min-w-0 items-center gap-2">
            <Show when={key}>
              {(projectKey) => (
                <span class="border-base-content/25 bg-base-100 text-base-content/70 inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)]">
                  {projectKey()}
                </span>
              )}
            </Show>
            <span>{config.title}</span>
          </span>
        );
      }
      return config.title;
    }
    if (location.pathname.startsWith("/runs/") && runConfig?.title?.trim()) {
      return (
        <span class="inline-flex min-w-0 items-center gap-2">
          <span
            class="run-detail-topbar__status-dot"
            data-status={runConfig.connectionStatus}
            aria-hidden="true"
          />
          <span class="truncate">{runConfig.title}</span>
        </span>
      );
    }
    return shellTitle();
  };

  const topbarSubtitle = () => {
    const config = taskDetailTopbarConfig();
    const runConfig = runDetailTopbarConfig();
    if (location.pathname.includes("/tasks/") && config?.subtitle?.trim()) {
      return config.subtitle;
    }
    if (location.pathname.startsWith("/runs/") && runConfig?.subtitle?.trim()) {
      return runConfig.subtitle;
    }
    return shellSubtitle();
  };

  const boardProjectId = () => {
    if (location.pathname !== BOARD_ROUTE_PATH) return "";
    const queryProjectId = getBoardProjectIdFromSearch(location.search);
    if (queryProjectId) return queryProjectId;
    const rememberedProjectId = readRememberedBoardProjectId();
    if (rememberedProjectId) return rememberedProjectId;
    return projects()[0]?.id ?? "";
  };

  const settingsProjectId = () => {
    const match = location.pathname.match(/^\/projects\/([^/]+)$/);
    return match?.[1] ?? "";
  };

  const handleShellKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key === "Escape" && isMobile() && mobileSidebarOpen()) {
      event.preventDefault();
      onMobileClose();
    }
  };

  const onBoardSearchInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event,
  ) => {
    const query = event.currentTarget.value;
    setBoardSearchQuery(query);
    dispatchBoardSearchQuery(query);
  };

  const onBoardSearchKeyDown: JSX.EventHandler<
    HTMLInputElement,
    KeyboardEvent
  > = (event) => {
    if (event.key !== "Escape") return;
    if (!boardSearchQuery()) return;
    event.preventDefault();
    setBoardSearchQuery("");
    dispatchBoardSearchQuery("");
  };

  return (
    <div
      class="app-shell bg-base-300 text-base-content min-h-screen"
      data-theme="orkestra-dark"
      ref={shellRootRef}
      onKeyDown={handleShellKeyDown}
      style={{
        "grid-template-columns": isMobile() ? "1fr" : "4.5rem minmax(0, 1fr)",
      }}
    >
      {isMobile() ? (
        <>
          <div
            class="sidebar-backdrop bg-neutral/70 fixed inset-0 z-20 transition-opacity duration-200"
            classList={{
              "sidebar-backdrop-open opacity-100": mobileSidebarOpen(),
              "pointer-events-none opacity-0": !mobileSidebarOpen(),
            }}
            aria-hidden={mobileSidebarOpen() ? "false" : "true"}
            onClick={onMobileClose}
          />
          <SidebarNav
            projects={projects}
            isMobile
            isVisible={isSidebarVisible}
            onNavigate={onMobileClose}
            onOpenSettings={onOpenSettings}
          />
        </>
      ) : (
        <SidebarNav
          projects={projects}
          isMobile={false}
          isVisible={() => true}
          onOpenSettings={onOpenSettings}
        />
      )}
      <div class="shell-main min-w-0 overflow-hidden">
        <div class="shell-content-wrapper flex h-full min-h-0 flex-col gap-0">
          <Topbar
            title={topbarTitle()}
            subtitle={topbarSubtitle()}
            leading={
              isMobile() ? (
                <button
                  ref={mobileMenuButtonRef}
                  type="button"
                  class="btn btn-ghost btn-square btn-sm border-base-content/15 bg-base-100 rounded-none border"
                  aria-label="Open navigation menu"
                  aria-controls="app-sidebar"
                  aria-expanded={isSidebarVisible() ? "true" : "false"}
                  onClick={onMobileOpen}
                >
                  <AppIcon name="nav.menu" size={18} stroke={1.75} />
                </button>
              ) : null
            }
            center={
              location.pathname === BOARD_ROUTE_PATH ? (
                <div class="projects-field m-0 w-[min(32rem,38vw)] min-w-64">
                  <input
                    type="search"
                    placeholder="Search tasks…"
                    aria-label="Search tasks"
                    value={boardSearchQuery()}
                    onInput={onBoardSearchInput}
                    onKeyDown={onBoardSearchKeyDown}
                  />
                </div>
              ) : undefined
            }
            actions={
              location.pathname.includes("/tasks/") &&
              taskDetailTopbarConfig() ? (
                (() => {
                  const config = taskDetailTopbarConfig()!;
                  if (config.mode === "create") {
                    return (
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="task-create-action-btn btn btn-sm rounded-none border px-4 text-xs font-semibold"
                          onClick={() => void config.onRequestCreateTask()}
                          disabled={config.isSubmitting}
                        >
                          {config.isSubmitting ? "Creating..." : "Create"}
                        </button>
                        <a
                          href={config.backHref}
                          class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 ml-1 rounded-none border"
                          aria-label={`Back to ${config.backLabel}`}
                          title={`Back to ${config.backLabel}`}
                          onClick={(event) => {
                            event.preventDefault();
                            config.onRequestClose();
                          }}
                        >
                          <AppIcon name="panel.close" size={16} stroke={1.75} />
                        </a>
                      </div>
                    );
                  }
                  return (
                    <div class="flex items-center gap-2">
                      <Show when={config.autosaveState !== "idle"}>
                        <span class="task-detail-autosave-indicator text-[11px] tracking-[0.08em] uppercase">
                          {config.autosaveState === "saving"
                            ? "Saving…"
                            : config.autosaveState === "saved"
                              ? "Saved"
                              : "Autosave failed"}
                        </span>
                      </Show>
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        onClick={config.onOpenRunSettingsModal}
                        disabled={config.isCreatingRun}
                        aria-label={
                          config.isBlocked
                            ? "New run blocked by dependencies"
                            : "New run"
                        }
                      >
                        New Run
                      </button>
                      <div class="relative flex items-center gap-2">
                        <button
                          type="button"
                          class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border"
                          onClick={config.onToggleTransitionMenu}
                          disabled={config.isChangingStatus}
                          aria-label={
                            config.isChangingStatus
                              ? "Updating task status"
                              : "Open status transitions"
                          }
                          title={
                            config.isChangingStatus
                              ? "Updating task status"
                              : "Change task status"
                          }
                          aria-haspopup="menu"
                          aria-expanded={config.isTransitionMenuOpen}
                        >
                          <AppIcon
                            name="task.transition"
                            size={16}
                            stroke={1.75}
                          />
                        </button>
                        <Show
                          when={
                            config.isTransitionMenuOpen &&
                            !config.isChangingStatus
                          }
                        >
                          <div
                            class="task-status-transition-menu"
                            role="menu"
                            aria-label="Valid status transitions"
                          >
                            <Show
                              when={config.validTransitionOptions.length > 0}
                              fallback={
                                <p class="task-status-transition-empty">
                                  No transitions available.
                                </p>
                              }
                            >
                              <For each={config.validTransitionOptions}>
                                {(statusOption) => (
                                  <button
                                    type="button"
                                    class="task-status-transition-option rounded-none text-xs"
                                    role="menuitem"
                                    onClick={() => {
                                      config.onCloseTransitionMenu();
                                      void config.onSetStatus(statusOption);
                                    }}
                                  >
                                    {formatStatus(statusOption)}
                                  </button>
                                )}
                              </For>
                            </Show>
                          </div>
                        </Show>
                      </div>
                      <button
                        type="button"
                        class="btn btn-sm btn-square border-error/35 bg-error/10 text-error hover:bg-error/10 rounded-none border"
                        onClick={config.onRequestDeleteTask}
                        disabled={config.isDeleting}
                        aria-label={
                          config.isDeleting ? "Deleting task" : "Delete task"
                        }
                        title={
                          config.isDeleting ? "Deleting task" : "Delete task"
                        }
                      >
                        <AppIcon name="action.delete" size={16} stroke={1.75} />
                      </button>
                      <a
                        href={config.backHref}
                        class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 ml-1 rounded-none border"
                        aria-label={`Back to ${config.backLabel}`}
                        title={`Back to ${config.backLabel}`}
                      >
                        <AppIcon name="panel.close" size={16} stroke={1.75} />
                      </a>
                    </div>
                  );
                })()
              ) : settingsProjectId() ? (
                (() => {
                  const projectId = settingsProjectId()!;
                  const config = projectSettingsTopbarConfig();
                  return (
                    <div class="flex items-center gap-2">
                      <Show
                        when={
                          !!config &&
                          (config.autosaveState !== "idle" ||
                            config.hasPendingChanges)
                        }
                      >
                        <span class="task-detail-autosave-indicator text-[11px] tracking-[0.08em] uppercase">
                          {config?.autosaveState === "saving"
                            ? "Saving…"
                            : config?.autosaveState === "error"
                              ? "Autosave failed"
                              : config?.hasPendingChanges
                                ? "Unsaved changes"
                                : config?.autosaveState === "saved"
                                  ? "Saved"
                                  : ""}
                        </span>
                      </Show>
                      <a
                        href={buildBoardHref(projectId)}
                        class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
                        aria-label="Close project settings"
                        title="Close project settings"
                        onClick={(event) => {
                          if (!config?.onRequestClose) {
                            return;
                          }
                          event.preventDefault();
                          void config.onRequestClose();
                        }}
                      >
                        <AppIcon name="panel.close" size={16} stroke={1.75} />
                      </a>
                    </div>
                  );
                })()
              ) : location.pathname.startsWith("/runs/") &&
                runDetailTopbarConfig() ? (
                (() => {
                  const config = runDetailTopbarConfig()!;
                  return (
                    <div class="flex items-center gap-2">
                      <For each={config.actions}>
                        {(action) => (
                          <button
                            type="button"
                            class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                            aria-label={action.label}
                            title={action.label}
                            aria-pressed={action.pressed}
                            onClick={action.onClick}
                          >
                            <AppIcon
                              name={action.icon}
                              size={16}
                              stroke={1.75}
                            />
                          </button>
                        )}
                      </For>
                      <a
                        href={config.backHref}
                        class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 ml-1 rounded-none border"
                        aria-label={`Back to ${config.backLabel}`}
                        title={`Back to ${config.backLabel}`}
                      >
                        <AppIcon name="panel.close" size={16} stroke={1.75} />
                      </a>
                    </div>
                  );
                })()
              ) : location.pathname === BOARD_ROUTE_PATH ? (
                <>
                  <button
                    type="button"
                    class="task-create-action-btn btn btn-sm rounded-none border px-4 text-xs font-semibold"
                    onClick={() => {
                      if (boardProjectId()) {
                        navigate(
                          `/projects/${boardProjectId()}/tasks/new?origin=board`,
                        );
                      }
                    }}
                    disabled={!boardProjectId()}
                  >
                    New task
                  </button>
                  {boardProjectId() ? (
                    <a
                      href={`/projects/${boardProjectId()}`}
                      class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
                      aria-label="Project settings"
                      title="Project settings"
                    >
                      <AppIcon
                        name="project.settings"
                        size={16}
                        stroke={1.75}
                      />
                    </a>
                  ) : null}
                </>
              ) : undefined
            }
          />
          <div class="shell-body grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden">
            <MainContent>{props.children}</MainContent>
          </div>
        </div>
      </div>
      <AboutModal
        isOpen={aboutModalOpen}
        onClose={onCloseSettings}
        updateState={linuxPackageUpdateState}
        onCheckForUpdates={() => {
          void runLinuxPackageUpdateCheck();
        }}
      />
      <CloseWhileRunsActiveModal
        isOpen={closeWarningOpen}
        activeRunCount={closeWarningRunCount}
        onCancel={onCancelCloseWarning}
        onConfirm={() => void onConfirmCloseWarning()}
      />
      <OpenCodeRequiredModal
        isOpen={() =>
          openCodeDependency.isModalVisible() || isStartupProjectSetupBlocked()
        }
        isChecking={() =>
          openCodeDependency.state() === "checking" ||
          openCodeDependency.state() === "unknown"
        }
        variant={() => (isStartupProjectSetupBooting() ? "booting" : "setup")}
        reason={openCodeDependency.reason}
        onRetry={() => {
          void openCodeDependency.refresh(true);
        }}
      />
      <AlphaNoticeModal />
      <LinuxPackageUpdateNotice result={startupLinuxPackageUpdate} />
    </div>
  );
};

export default AppShell;
