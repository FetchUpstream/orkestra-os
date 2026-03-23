import { A, useLocation } from "@solidjs/router";
import { createMemo, type Accessor, type Component } from "solid-js";
import { buildProjectNavItem } from "../../app/lib/nav";
import type { Project } from "../../app/lib/projects";

type SidebarNavProps = {
  projects?: Accessor<Project[]>;
  isMobile?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  desktopCollapsed?: Accessor<boolean>;
  isVisible?: Accessor<boolean>;
};

const SidebarNav: Component<SidebarNavProps> = (props) => {
  const location = useLocation();
  const projectNavItems = createMemo(() =>
    (props.projects?.() ?? []).map(buildProjectNavItem),
  );

  const isProjectActive = (projectId: string) => {
    const params = new URLSearchParams(location.search);
    return (
      location.pathname === "/board" && params.get("projectId") === projectId
    );
  };

  const isCollapsed = () => props.desktopCollapsed?.() ?? false;

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
        "sticky top-0 h-screen p-2": !props.isMobile,
      }}
      aria-hidden={props.isVisible && !props.isVisible() ? "true" : undefined}
    >
      <div
        class="border-base-content/15 bg-base-200 flex h-full min-h-0 flex-col rounded-none border"
        classList={{
          "w-[17rem]": !props.isMobile && !isCollapsed(),
          "w-14": !props.isMobile && isCollapsed(),
        }}
      >
        {isCollapsed() ? (
          <div class="flex h-full flex-col items-center gap-3 p-2">
            <div class="border-primary/25 bg-primary/10 text-primary flex h-10 w-10 items-center justify-center border font-semibold tracking-[0.2em]">
              ORK
            </div>
            {props.onExpand ? (
              <button
                type="button"
                class="btn btn-ghost btn-square btn-sm text-base-content/70 hover:bg-base-100 hover:text-base-content rounded-none"
                aria-label="Expand sidebar"
                title="Expand sidebar"
                aria-controls="app-sidebar"
                aria-expanded="false"
                onClick={props.onExpand}
              >
                <span aria-hidden="true">›</span>
              </button>
            ) : null}
          </div>
        ) : (
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
              {props.onCollapse ? (
                <button
                  type="button"
                  class="btn btn-ghost btn-square btn-sm text-base-content/70 hover:bg-base-100 hover:text-base-content rounded-none"
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                  aria-controls="app-sidebar"
                  aria-expanded="true"
                  onClick={props.onCollapse}
                >
                  <span aria-hidden="true">‹</span>
                </button>
              ) : null}
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
        )}
        {props.isMobile ? (
          <div class="border-base-content/10 border-t p-3">
            <div class="badge badge-outline badge-sm border-primary/20 text-primary/80 w-full justify-center rounded-none py-3 text-[11px] tracking-[0.2em] uppercase">
              Dark workspace
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
};

export default SidebarNav;
