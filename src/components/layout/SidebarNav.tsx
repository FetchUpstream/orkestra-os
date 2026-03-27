import { A, useLocation } from "@solidjs/router";
import { getVersion } from "@tauri-apps/api/app";
import {
  createMemo,
  createResource,
  type Accessor,
  type Component,
} from "solid-js";
import { buildProjectNavItem } from "../../app/lib/nav";
import type { Project } from "../../app/lib/projects";
import appIcon from "../../assets/logo.svg";

type SidebarNavProps = {
  projects?: Accessor<Project[]>;
  isMobile?: boolean;
  onNavigate?: () => void;
  isVisible?: Accessor<boolean>;
};

const SidebarNav: Component<SidebarNavProps> = (props) => {
  const location = useLocation();
  const [version] = createResource(getVersion);
  const projectNavItems = createMemo(() =>
    (props.projects?.() ?? []).map(buildProjectNavItem),
  );
  const versionLabel = createMemo(() => (version() ? `v${version()}` : "v--"));

  const isProjectActive = (projectId: string) => {
    const params = new URLSearchParams(location.search);
    const projectPathMatch = location.pathname.match(/^\/projects\/([^/]+)/);
    return (
      (location.pathname === "/board" &&
        params.get("projectId") === projectId) ||
      projectPathMatch?.[1] === projectId
    );
  };

  const isCreateProjectRoute = () => location.pathname === "/projects";

  return (
    <aside
      id="app-sidebar"
      class="z-30 flex min-h-0 flex-col"
      classList={{
        "pointer-events-none -translate-x-full opacity-0":
          props.isMobile && !props.isVisible?.(),
        "translate-x-0 opacity-100": !props.isMobile || props.isVisible?.(),
        "fixed inset-y-0 left-0 w-[min(20rem,calc(100vw-2rem))] p-2 transition duration-200 ease-out":
          !!props.isMobile,
        "sticky top-0 h-screen p-0": !props.isMobile,
      }}
      aria-hidden={props.isVisible && !props.isVisible() ? "true" : undefined}
    >
      <div
        class="border-base-content/15 bg-base-200 flex h-full min-h-0 flex-col rounded-none border"
        classList={{
          "w-[4.5rem]": !props.isMobile,
        }}
      >
        {props.isMobile ? (
          <>
            <div class="border-base-content/10 flex items-center justify-between gap-3 border-b px-3 py-3">
              <div class="min-w-0">
                <div class="text-primary/80 text-xs font-semibold tracking-[0.28em] uppercase">
                  OrkestraOS
                </div>
                <div class="text-base-content/55 truncate text-xs">
                  Desktop workflow orchestration
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between px-3 pt-3 pb-2">
              <span class="text-base-content/45 text-[11px] font-medium tracking-[0.24em] uppercase">
                Projects
              </span>
              <span class="badge badge-ghost badge-xs border-base-content/10 text-base-content/55 rounded-none text-[10px]">
                {projectNavItems().length}
              </span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <nav
                class="sidebar-nav menu menu-sm gap-1 bg-transparent p-0"
                aria-label="Project navigation"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("a")) {
                    props.onNavigate?.();
                  }
                }}
              >
                {projectNavItems().map((item) => (
                  <li>
                    <A
                      href={item.href}
                      class="group text-base-content/70 flex min-h-11 items-center gap-3 border border-transparent px-3 py-2 text-sm transition-colors"
                      classList={{
                        "bg-primary/12 text-primary border-primary/20 shadow-sm":
                          isProjectActive(item.id),
                        "hover:border-base-content/10 hover:bg-base-100/60 hover:text-base-content":
                          !isProjectActive(item.id),
                      }}
                    >
                      <span
                        class="border-base-content/10 bg-base-100 text-base-content/75 inline-flex h-8 min-w-8 items-center justify-center border px-2 text-[11px] font-semibold tracking-[0.2em] transition-colors"
                        classList={{
                          "border-primary/25 bg-primary/10 text-primary":
                            isProjectActive(item.id),
                        }}
                        aria-hidden="true"
                      >
                        {item.keyAvatar}
                      </span>
                      <span class="min-w-0 truncate">{item.label}</span>
                    </A>
                  </li>
                ))}
              </nav>
            </div>
          </>
        ) : (
          <div class="flex h-full flex-col items-center gap-3 p-2">
            <div class="flex h-10 w-10 items-center justify-center overflow-hidden">
              <img
                src={appIcon}
                alt="OrkestraOS"
                class="h-full w-full object-cover"
              />
            </div>
            <div class="border-base-content/10 my-1 h-px w-8" />
            <nav
              class="sidebar-nav flex flex-col items-center gap-2"
              aria-label="Project navigation"
            >
              {projectNavItems().map((item) => (
                <A
                  href={item.href}
                  class="text-base-content/55 flex h-10 w-10 items-center justify-center border border-transparent text-[11px] font-semibold tracking-[0.2em] transition-colors"
                  classList={{
                    "border-primary/30 bg-primary/14 text-primary":
                      isProjectActive(item.id),
                    "hover:border-base-content/10 hover:bg-base-100 hover:text-base-content":
                      !isProjectActive(item.id),
                  }}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => props.onNavigate?.()}
                >
                  {item.keyAvatar}
                </A>
              ))}
              <A
                href="/projects"
                class="text-base-content/55 flex h-10 w-10 items-center justify-center border border-transparent text-lg font-semibold transition-colors"
                classList={{
                  "border-primary/30 bg-primary/14 text-primary":
                    isCreateProjectRoute(),
                  "hover:border-base-content/10 hover:bg-base-100 hover:text-base-content":
                    !isCreateProjectRoute(),
                }}
                aria-label="Create project"
                title="Create project"
                onClick={() => props.onNavigate?.()}
              >
                +
              </A>
            </nav>
            <div class="mt-auto flex w-full flex-col items-center gap-2 pb-1">
              <div class="border-base-content/10 h-px w-8" />
              <div class="flex w-full flex-col items-center gap-1">
                <div
                  class="text-base-content/40 max-w-full truncate px-1 text-center text-[10px] font-medium tracking-[0.14em] tabular-nums"
                  title={versionLabel()}
                  aria-label="Application version"
                >
                  {versionLabel()}
                </div>
                <div class="text-base-content/28 text-center text-[8px] font-semibold tracking-[0.24em] uppercase">
                  ALPHA
                </div>
              </div>
            </div>
          </div>
        )}
        {props.isMobile ? (
          <div class="border-base-content/10 border-t p-3">
            <div class="badge badge-outline badge-sm border-primary/20 text-primary/80 w-full justify-center rounded-none py-3 text-[11px] tracking-[0.2em] uppercase">
              Dark workspace
            </div>
            <div class="mt-2 flex flex-col items-center gap-1">
              <div
                class="text-base-content/45 text-center text-[11px] font-medium tracking-[0.12em] tabular-nums"
                title={versionLabel()}
                aria-label="Application version"
              >
                {versionLabel()}
              </div>
              <div class="text-base-content/30 text-center text-[9px] font-semibold tracking-[0.2em] uppercase">
                ALPHA
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
};

export default SidebarNav;
