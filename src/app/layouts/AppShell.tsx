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
import { listProjects, type Project } from "../lib/projects";
import { primeRunSelectionOptionsCache } from "../lib/runSelectionOptionsCache";
import type { TaskStatus } from "../lib/tasks";
import MainContent from "../../components/layout/MainContent";
import SidebarNav from "../../components/layout/SidebarNav";
import Topbar from "../../components/layout/Topbar";
import { formatStatus } from "../../features/tasks/utils/taskDetail";

type TaskDetailTopbarConfig =
  | {
      mode: "detail";
      backHref: string;
      backLabel: string;
      autosaveState: "idle" | "saving" | "saved" | "error";
      isChangingStatus: boolean;
      isTransitionMenuOpen: boolean;
      isDeleting: boolean;
      validTransitionOptions: TaskStatus[];
      onToggleTransitionMenu: () => void;
      onCloseTransitionMenu: () => void;
      onSetStatus: (status: TaskStatus) => void | Promise<void>;
      onRequestDeleteTask: () => void;
    }
  | {
      mode: "create";
      backHref: string;
      backLabel: string;
      isSubmitting: boolean;
      onRequestCreateTask: () => void | Promise<void>;
      onRequestClose: () => void;
    };

const CloseIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
    <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7l-1.42-1.4L9.17 12 2.87 5.7l1.42-1.42 6.3 6.3 6.29-6.3z" />
  </svg>
);

const StatusTransitionIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
    <path d="M5 11h11.17l-3.58-3.59L14 6l6 6-6 6-1.41-1.41L16.17 13H5z" />
  </svg>
);

const DeleteIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-current">
    <path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z" />
  </svg>
);

type AppShellProps = {
  children?: JSX.Element;
};

const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  let mobileMenuButtonRef: HTMLButtonElement | undefined;
  let shellRootRef: HTMLDivElement | undefined;

  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [boardSearchQuery, setBoardSearchQuery] = createSignal("");
  const [taskDetailTopbarConfig, setTaskDetailTopbarConfig] =
    createSignal<TaskDetailTopbarConfig | null>(null);

  const isSidebarVisible = () => (isMobile() ? mobileSidebarOpen() : true);

  onMount(async () => {
    primeRunSelectionOptionsCache();

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
      const projects = await listProjects();
      setProjects(projects);
      if (projects.length === 0 && location.pathname !== "/projects") {
        navigate("/projects", { replace: true });
      }
    } catch (error) {
      console.warn("Failed to load projects during startup", error);
    }

    const onTaskDetailTopbarConfig = (event: Event) => {
      const customEvent = event as CustomEvent<TaskDetailTopbarConfig>;
      setTaskDetailTopbarConfig(customEvent.detail);
    };
    const onTaskDetailTopbarClear = () => {
      setTaskDetailTopbarConfig(null);
    };

    window.addEventListener(
      "task-detail:topbar-config",
      onTaskDetailTopbarConfig,
    );
    window.addEventListener(
      "task-detail:topbar-clear",
      onTaskDetailTopbarClear,
    );

    onCleanup(() => {
      window.removeEventListener(
        "task-detail:topbar-config",
        onTaskDetailTopbarConfig,
      );
      window.removeEventListener(
        "task-detail:topbar-clear",
        onTaskDetailTopbarClear,
      );
    });
  });

  createEffect(() => {
    if (!location.pathname.includes("/tasks/")) {
      setTaskDetailTopbarConfig(null);
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

  const dispatchBoardSearchQuery = (query: string) => {
    window.dispatchEvent(
      new CustomEvent("board:search-query", {
        detail: { query },
      }),
    );
  };

  const shellTitle = () => {
    if (location.pathname.endsWith("/tasks/new")) return "Create task";
    if (location.pathname === "/board") {
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
    if (location.pathname === "/board") {
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

  const boardProjectId = () => {
    if (location.pathname !== "/board") return "";
    const queryProjectId = new URLSearchParams(location.search).get(
      "projectId",
    );
    if (queryProjectId) return queryProjectId;
    try {
      return window.localStorage.getItem("board.selectedProjectId") ?? "";
    } catch {
      return "";
    }
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
          />
        </>
      ) : (
        <SidebarNav
          projects={projects}
          isMobile={false}
          isVisible={() => true}
        />
      )}
      <div class="shell-main min-w-0 overflow-hidden">
        <div class="shell-content-wrapper flex h-full min-h-0 flex-col gap-0">
          <Topbar
            title={shellTitle()}
            subtitle={shellSubtitle()}
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
                  <span aria-hidden="true">☰</span>
                </button>
              ) : null
            }
            center={
              location.pathname === "/board" ? (
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
                          class="btn btn-sm rounded-none border border-amber-500/35 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-500"
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
                          <CloseIcon />
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
                          <StatusTransitionIcon />
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
                        <DeleteIcon />
                      </button>
                      <a
                        href={config.backHref}
                        class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 ml-1 rounded-none border"
                        aria-label={`Back to ${config.backLabel}`}
                        title={`Back to ${config.backLabel}`}
                      >
                        <CloseIcon />
                      </a>
                    </div>
                  );
                })()
              ) : location.pathname === "/board" ? (
                <>
                  <button
                    type="button"
                    class="btn btn-sm rounded-none border border-amber-500/35 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-500"
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
                      <span aria-hidden="true">⚙</span>
                    </a>
                  ) : null}
                </>
              ) : settingsProjectId() ? (
                <a
                  href={`/board?projectId=${settingsProjectId()}`}
                  class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
                  aria-label="Close project settings"
                  title="Close project settings"
                >
                  <span aria-hidden="true">✕</span>
                </a>
              ) : undefined
            }
          />
          <div class="shell-body grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden">
            <MainContent>{props.children}</MainContent>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
