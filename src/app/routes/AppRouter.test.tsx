import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppRouter from "../../router";
import { resetRunSelectionOptionsCacheForTests } from "../lib/runSelectionOptionsCache";

const { invokeMock, listenMock, emitTauriEvent } = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(event: { payload: unknown }) => void>
  >();
  return {
    invokeMock: vi.fn(),
    listenMock: vi.fn(
      async (
        eventName: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        let handlers = listeners.get(eventName);
        if (!handlers) {
          handlers = new Set();
          listeners.set(eventName, handlers);
        }
        handlers.add(handler);
        return () => {
          handlers?.delete(handler);
          if (handlers && handlers.size === 0) {
            listeners.delete(eventName);
          }
        };
      },
    ),
    emitTauriEvent: (eventName: string, payload: unknown) => {
      for (const handler of listeners.get(eventName) ?? []) {
        handler({ payload });
      }
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../../components/ui/TaskMarkdownEditor", () => ({
  default: (props: {
    value: string;
    onChange: (next: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <div>
      <label for="task-markdown-editor">
        {props.ariaLabel || "Description"}
      </label>
      <textarea
        id="task-markdown-editor"
        role="textbox"
        aria-label={props.ariaLabel || "Task description"}
        value={props.value}
        disabled={props.disabled}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  ),
}));

vi.mock("../../components/MonacoDiffEditor", () => ({
  default: () => <div data-testid="monaco-diff-editor" />,
}));

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class MockEditorWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({
  default: class MockCssWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({
  default: class MockHtmlWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({
  default: class MockJsonWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({
  default: class MockTsWorker {},
}));

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(() => <AppRouter />);
};

const setViewportMobile = (isMobile: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 900px)" ? isMobile : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const resetLocalStorageMock = () => {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
  });
};

describe("app routing and shell", () => {
  beforeEach(() => {
    resetRunSelectionOptionsCacheForTests();
    setViewportMobile(false);
    resetLocalStorageMock();
    invokeMock.mockReset();
    listenMock.mockClear();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            {
              id: "r-2",
              name: "Tools",
              path: "/repo/tools",
              is_default: false,
            },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "task-parent-1",
              display_key: "ALP-1",
              title: "Setup schema",
              status: "done",
              target_repository_name: "Main",
            },
          ],
          children: [
            {
              id: "task-child-1",
              display_key: "ALP-9",
              title: "Ship UI",
              status: "todo",
              target_repository_name: "Main",
            },
          ],
        });
      if (command === "list_task_runs") return Promise.resolve([]);
      if (command === "create_run")
        return Promise.resolve({
          id: "run-new",
          task_id: "task-123",
          project_id: "p-1",
          status: "queued",
          triggered_by: "user",
          created_at: "2026-01-03T00:00:00.000Z",
        });
      if (command === "get_run")
        return Promise.resolve({
          id: "run-456",
          task_id: "task-123",
          project_id: "p-1",
          status: "running",
          triggered_by: "user",
          created_at: "2026-01-02T00:00:00.000Z",
          started_at: "2026-01-02T00:01:00.000Z",
          finished_at: null,
          summary: null,
          error_message: null,
        });
      if (command === "add_task_dependency") return Promise.resolve(null);
      if (command === "remove_task_dependency") return Promise.resolve(null);
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description:
            "### Checklist\n- **Ship** update\n- Visit [Docs](https://example.com)\n\n> Keep scope tight\n\nUse `inline` markers.\n\n```ts\nconst ready = true;\n```",
          status: "todo",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "update_task")
        return Promise.resolve({
          id: "task-123",
          title: "Updated task",
          description: "Updated details",
          status: "todo",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "set_task_status")
        return Promise.resolve({
          id: "task-123",
          title: "Updated task",
          description: "Updated details",
          status: "doing",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "move_task")
        return Promise.resolve({
          id: "task-123",
          title: "Updated task",
          description: "Updated details",
          status: "doing",
          project_id: "p-1",
          target_repository_id: "r-2",
          target_repository_name: "Tools",
          display_key: "ALP-7",
        });
      if (command === "delete_task") return Promise.resolve(null);
      if (command === "create_task")
        return Promise.resolve({
          id: "task-999",
          title: "Created task",
          status: "todo",
        });
      if (command === "create_project") {
        return Promise.resolve({
          project: { id: "p-2", name: "Beta", key: "BET", description: null },
          repositories: [
            {
              id: "r-1",
              name: "Beta",
              repo_path: "/repo/beta",
              is_default: true,
            },
          ],
        });
      }
      if (command === "clone_project") {
        return Promise.resolve({
          project: {
            id: "p-3",
            name: "Alpha - Copy",
            key: "ACP",
            description: null,
          },
          repositories: [
            {
              id: "r-3",
              name: "Main",
              repo_path: "/repo/alpha-copy",
              is_default: true,
            },
          ],
        });
      }
      return Promise.resolve(null);
    });
  });

  it("refreshes board tasks when backend emits task-updated", async () => {
    let taskStatus: "todo" | "doing" = "todo";

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-live-1",
            title: "Live update task",
            status: taskStatus,
            display_key: "ALP-101",
          },
        ]);
      }
      if (command === "list_task_runs") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
    });

    taskStatus = "doing";
    emitTauriEvent("task-updated", {
      task_id: "task-live-1",
      project_id: "p-1",
      status: "doing",
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
    });
  });

  it("renders expected sidebar links", () => {
    renderAt("/board");

    const links = [
      "/board",
      "/projects",
      "/agents",
      "/worktrees",
      "/reviews",
      "/settings",
    ];
    for (const href of links) {
      const link = screen.getByRole("link", {
        name: new RegExp(href.slice(1), "i"),
      });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("toggles desktop sidebar state with shell collapse class", async () => {
    renderAt("/board");

    const collapseButton = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    expect(collapseButton.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(collapseButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Board" })).toBeTruthy();
    const appShell = document.querySelector(".app-shell") as HTMLElement;
    expect(appShell.classList.contains("app-shell--desktop-collapsed")).toBe(
      false,
    );

    await fireEvent.click(collapseButton);

    expect(screen.queryByRole("link", { name: "Board" })).toBeNull();
    expect(appShell.classList.contains("app-shell--desktop-collapsed")).toBe(
      true,
    );

    const expandButton = screen.getByRole("button", {
      name: "Expand sidebar",
    });
    expect(expandButton.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Board" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Collapse sidebar" }),
      ).toBeTruthy();
      expect(appShell.classList.contains("app-shell--desktop-collapsed")).toBe(
        false,
      );
    });
  });

  it("opens and closes mobile overlay navigation", async () => {
    setViewportMobile(true);
    renderAt("/board");

    expect(screen.queryByRole("link", { name: "Board" })).toBeNull();

    const openButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    expect(openButton.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(openButton.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Board" })).toBeTruthy();
    });

    const backdrop = document.querySelector(
      ".sidebar-backdrop-open",
    ) as HTMLElement;
    expect(backdrop).toBeTruthy();
    await fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Board" })).toBeNull();
    });
  });

  it("switches routes while keeping shell layout visible", async () => {
    renderAt("/board");

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Board" })).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByLabelText("Project")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Review (0)" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Done (0)" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: "Agents" }));

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Agents" })).toHaveLength(2);
    expect(screen.getByText("Manage and configure agents.")).toBeTruthy();
  });

  it("loads board with project summaries and uses project detail for new task", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task") {
        return Promise.resolve({
          id: "task-1",
          title: "Created from board",
          status: "todo",
          display_key: "ALP-8",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByLabelText("Project")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "New task" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "New task" }));
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Created from board" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_task", {
        input: {
          project_id: "p-1",
          title: "Created from board",
          description: undefined,
          implementation_guide: undefined,
          status: "todo",
          repository_id: "r-1",
        },
      });
    });
  });

  it("restores board project selection from localStorage", async () => {
    window.localStorage.removeItem("board.selectedProjectId");

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          { id: "p-1", name: "Alpha", key: "ALP" },
          { id: "p-2", name: "Beta", key: "BET" },
        ]);
      }
      if (command === "get_project") {
        const projectId = (args as { id?: string } | undefined)?.id || "p-1";
        return Promise.resolve({
          id: projectId,
          name: projectId === "p-2" ? "Beta" : "Alpha",
          key: projectId === "p-2" ? "BET" : "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const firstRender = renderAt("/board");

    const projectSelect = (await screen.findByLabelText(
      "Project",
    )) as HTMLSelectElement;
    await fireEvent.change(projectSelect, { target: { value: "p-2" } });

    await waitFor(() => {
      expect(window.localStorage.getItem("board.selectedProjectId")).toBe(
        "p-2",
      );
      expect(projectSelect.value).toBe("p-2");
    });

    firstRender.unmount();
    renderAt("/board");

    const restoredSelect = (await screen.findByLabelText(
      "Project",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(restoredSelect.value).toBe("p-2");
    });
  });

  it("falls back to first board project when remembered project is missing", async () => {
    window.localStorage.setItem("board.selectedProjectId", "p-missing");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          { id: "p-1", name: "Alpha", key: "ALP" },
          { id: "p-2", name: "Beta", key: "BET" },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/board");

    const projectSelect = (await screen.findByLabelText(
      "Project",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(projectSelect.value).toBe("p-1");
    });
  });

  it("shows blocked badge on board cards", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Blocked board task",
            description: "Dependency chain is still running",
            status: "todo",
            display_key: "ALP-1",
            target_repository_name: "InfraRepo",
            priority: "P0",
            is_blocked: true,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Blocked board task/i }),
      ).toBeTruthy();
      expect(screen.getByText("ALP-1")).toBeTruthy();
      expect(screen.getByText("Blocked")).toBeTruthy();
      expect(
        screen.getByText("Dependency chain is still running"),
      ).toBeTruthy();
      expect(screen.queryByText("InfraRepo")).toBeNull();
      expect(screen.queryByText("Priority: P0")).toBeNull();
    });
  });

  it("shows ready badge on board cards when blockers are resolved", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Ready board task",
            status: "todo",
            display_key: "ALP-2",
            is_blocked: false,
            blocked_by_count: 2,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Ready board task/i }),
      ).toBeTruthy();
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(screen.queryByText("Blocked")).toBeNull();
    });
  });

  it("shows no dependency badge on board cards without dependencies", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Plain board task",
            status: "todo",
            display_key: "ALP-3",
            is_blocked: false,
            blocked_by_count: 0,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Plain board task/i }),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("hides dependency badges on non-todo board cards", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-doing",
            title: "Doing task",
            status: "doing",
            display_key: "ALP-4",
            is_blocked: true,
            blocked_by_count: 1,
          },
          {
            id: "task-review",
            title: "Review task",
            status: "review",
            display_key: "ALP-5",
            is_blocked: false,
            blocked_by_count: 2,
          },
          {
            id: "task-done",
            title: "Done task",
            status: "done",
            display_key: "ALP-6",
            is_blocked: true,
            blocked_by_count: 3,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Doing task/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Review task/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Done task/i })).toBeTruthy();
    });

    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows active run details mini-card on non-done board tasks", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Run in progress",
            status: "doing",
            display_key: "ALP-20",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-1") {
          return Promise.resolve([
            {
              id: "run-1",
              task_id: "task-1",
              project_id: "p-1",
              status: "running",
              display_key: "RUN-20",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByText("Run Details")).toBeTruthy();
      expect(screen.getByText("Coding")).toBeTruthy();
      expect(
        document.querySelector(".board-task-run-details .run-inline-spinner"),
      ).toBeTruthy();
      const runLink = document.querySelector(
        '.board-task-run-details-link[href="/runs/run-1?origin=board"]',
      ) as HTMLAnchorElement | null;
      expect(runLink).toBeTruthy();
    });
  });

  it("returns to board when run detail is opened from board mini-card", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Run in progress",
            status: "doing",
            display_key: "ALP-20",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-1") {
          return Promise.resolve([
            {
              id: "run-1",
              task_id: "task-1",
              project_id: "p-1",
              status: "running",
              display_key: "RUN-20",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      if (command === "get_run") {
        return Promise.resolve({
          id: "run-1",
          task_id: "task-1",
          project_id: "p-1",
          status: "running",
          display_key: "RUN-20",
          triggered_by: "user",
          created_at: "2026-01-02T00:00:00.000Z",
          started_at: "2026-01-02T00:01:00.000Z",
          finished_at: null,
          summary: null,
          error_message: null,
        });
      }
      if (command === "get_task") {
        return Promise.resolve({
          id: "task-1",
          title: "Run in progress",
          description: "",
          status: "doing",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-20",
        });
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    const runLink = (await screen.findByRole("link", {
      name: "Run Details",
    })) as HTMLAnchorElement;
    expect(runLink.getAttribute("href")).toBe("/runs/run-1?origin=board");

    await fireEvent.click(runLink);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/runs/run-1");
    });
    expect(window.location.search).toBe("?origin=board");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to board" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: "Back to board" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/board");
      expect(window.location.search).toBe("?projectId=p-1");
    });
  });

  it("shows waiting-for-merge mini-card for review tasks with completed run", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-review",
            title: "Review pending",
            status: "review",
            display_key: "ALP-22",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-review") {
          return Promise.resolve([
            {
              id: "run-review-1",
              task_id: "task-review",
              project_id: "p-1",
              status: "completed",
              display_key: "RUN-22",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByText("Waiting for merge")).toBeTruthy();
      expect(
        document.querySelector(".board-task-run-details .run-inline-spinner"),
      ).toBeNull();
      expect(document.querySelector(".board-task-run-warning")).toBeTruthy();
    });
  });

  it("shows waiting mini-card with warning icon for review tasks with active run", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-review-active",
            title: "Review waiting",
            status: "review",
            display_key: "ALP-23",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-review-active") {
          return Promise.resolve([
            {
              id: "run-review-active",
              task_id: "task-review-active",
              project_id: "p-1",
              status: "running",
              display_key: "RUN-23",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByText("Waiting")).toBeTruthy();
      expect(
        document.querySelector(".board-task-run-details .run-inline-spinner"),
      ).toBeNull();
      expect(document.querySelector(".board-task-run-warning")).toBeTruthy();
    });
  });

  it("hides active run details mini-card for done board tasks", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-done",
            title: "Completed task",
            status: "done",
            display_key: "ALP-21",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-done") {
          return Promise.resolve([
            {
              id: "run-done",
              task_id: "task-done",
              project_id: "p-1",
              status: "running",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Completed task/i }),
      ).toBeTruthy();
    });

    expect(screen.queryByText("Run Details")).toBeNull();
    expect(document.querySelector(".board-task-run-details")).toBeNull();
  });

  it("keeps board functional when selected project detail fetch fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.reject(new Error("project detail unavailable"));
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByLabelText("Project")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
    expect(
      screen.queryByText("Failed to load project tasks. Please refresh."),
    ).toBeNull();
  });

  it("applies selected run settings when confirming board move to in progress", async () => {
    let resolveStatusUpdate: ((value: unknown) => void) | undefined;
    const statusUpdatePromise = new Promise((resolve) => {
      resolveStatusUpdate = resolve;
    });

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Draft onboarding flow",
            status: "todo",
            display_key: "ALP-1",
          },
        ]);
      }
      if (command === "set_task_status") return statusUpdatePromise;
      if (command === "list_run_opencode_agents") {
        return Promise.resolve({
          agents: [{ id: "agent-a", name: "Agent A" }],
        });
      }
      if (command === "list_run_opencode_providers") {
        return Promise.resolve({
          providers: [
            {
              id: "provider-a",
              name: "Provider A",
              models: [{ id: "model-a", name: "Model A" }],
            },
          ],
        });
      }
      if (command === "list_task_runs") {
        return Promise.resolve([
          {
            id: "run-task-1",
            task_id: "task-1",
            project_id: "p-1",
            status: "running",
            display_key: "RUN-1",
            triggered_by: "user",
            created_at: "2026-01-02T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Draft onboarding flow/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    expect(
      screen.getByRole("dialog", { name: "New run settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "In Progress (0)" }),
    ).toBeTruthy();

    await fireEvent.change(screen.getByLabelText("Default run agent"), {
      target: { value: "agent-a" },
    });
    await fireEvent.change(screen.getByLabelText("Default run provider"), {
      target: { value: "provider-a" },
    });
    await fireEvent.change(screen.getByLabelText("Default run model"), {
      target: { value: "model-a" },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "set_task_status",
      expect.objectContaining({
        id: "task-1",
        input: expect.objectContaining({
          status: "doing",
          source_action: "board_manual_move",
          agent_id: "agent-a",
          provider_id: "provider-a",
          model_id: "model-a",
        }),
      }),
    );

    resolveStatusUpdate?.({
      id: "task-1",
      title: "Draft onboarding flow",
      status: "doing",
      display_key: "ALP-1",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
      expect(screen.getByText("Run Details")).toBeTruthy();
      expect(screen.getByText("Coding")).toBeTruthy();
    });
  });

  it("shows mini-card immediately after confirming in-progress move", async () => {
    let resolveStatusUpdate: ((value: unknown) => void) | undefined;
    const statusUpdatePromise = new Promise((resolve) => {
      resolveStatusUpdate = resolve;
    });

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-optimistic-mini-card",
            title: "Optimistic mini-card",
            status: "todo",
            display_key: "ALP-31",
          },
        ]);
      }
      if (command === "set_task_status") return statusUpdatePromise;
      if (command === "list_task_runs") {
        return Promise.resolve([
          {
            id: "run-task-optimistic-mini-card",
            task_id: "task-optimistic-mini-card",
            project_id: "p-1",
            status: "running",
            display_key: "RUN-31",
            triggered_by: "user",
            created_at: "2026-01-02T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Optimistic mini-card/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(
      screen.getByRole("heading", { name: "In Progress (1)" }),
    ).toBeTruthy();
    expect(screen.getByText("Run Details")).toBeTruthy();
    expect(screen.getByText("Coding")).toBeTruthy();
    expect(window.location.pathname).toBe("/board");
    expect(document.querySelector(".board-task-run-details-link")).toBeNull();

    const optimisticMiniCard = document.querySelector(
      ".board-task-run-details",
    ) as HTMLElement | null;
    expect(optimisticMiniCard).toBeTruthy();
    if (optimisticMiniCard) {
      await fireEvent.click(optimisticMiniCard);
    }
    expect(window.location.pathname).toBe("/board");

    resolveStatusUpdate?.({
      id: "task-optimistic-mini-card",
      title: "Optimistic mini-card",
      status: "doing",
      display_key: "ALP-31",
    });

    await waitFor(() => {
      expect(screen.getByText("Coding")).toBeTruthy();
      const runLink = document.querySelector(
        '.board-task-run-details-link[href="/runs/run-task-optimistic-mini-card?origin=board"]',
      ) as HTMLAnchorElement | null;
      expect(runLink).toBeTruthy();
    });

    const runLink = document.querySelector(
      '.board-task-run-details-link[href="/runs/run-task-optimistic-mini-card?origin=board"]',
    ) as HTMLAnchorElement | null;
    expect(runLink).toBeTruthy();
    if (runLink) {
      await fireEvent.click(runLink);
    }

    await waitFor(() => {
      expect(window.location.pathname).toBe(
        "/runs/run-task-optimistic-mini-card",
      );
    });
  });

  it("prefers app drag payload when text/plain contains a URL", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Drag payload preference",
            status: "todo",
            display_key: "ALP-1",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-1",
          title: "Drag payload preference",
          status: "doing",
          display_key: "ALP-1",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Drag payload preference/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
      setDragImage() {
        return;
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    dataTransfer.setData("text/plain", "https://example.com/tasks/task-1");
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-1",
        input: { status: "doing", source_action: "board_manual_move" },
      });
    });
  });

  it("allows board drag transition from review to in progress", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-review-doing",
            title: "Review to in progress",
            status: "review",
            display_key: "ALP-11",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-review-doing",
          title: "Review to in progress",
          status: "doing",
          display_key: "ALP-11",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Review to in progress/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (0)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-review-doing",
        input: { status: "doing", source_action: "board_manual_move" },
      });
    });
  });

  it("allows board drag transition from review to todo", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-review-todo",
            title: "Review to todo",
            status: "review",
            display_key: "ALP-12",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-review-todo",
          title: "Review to todo",
          status: "todo",
          display_key: "ALP-12",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (1)" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
    });

    const todoSection = screen
      .getByRole("heading", { name: "Todo (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Review to todo/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(todoSection, { dataTransfer });
    await fireEvent.drop(todoSection, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (0)" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-review-todo",
        input: { status: "todo" },
      });
    });
  });

  it("allows board drag transition from doing to todo", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-doing-todo",
            title: "Doing to todo",
            status: "doing",
            display_key: "ALP-13",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-doing-todo",
          title: "Doing to todo",
          status: "todo",
          display_key: "ALP-13",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
    });

    const todoSection = screen
      .getByRole("heading", { name: "Todo (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Doing to todo/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(todoSection, { dataTransfer });
    await fireEvent.drop(todoSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-doing-todo",
        input: { status: "todo" },
      });
    });
  });

  it("ignores invalid board drag transitions and does not persist status", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Invalid transition candidate",
            status: "todo",
            display_key: "ALP-1",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-1",
          title: "Invalid transition candidate",
          status: "review",
          display_key: "ALP-1",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Review (0)" })).toBeTruthy();
    });

    const reviewSection = screen
      .getByRole("heading", { name: "Review (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Invalid transition candidate/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
      setDragImage() {
        return;
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(reviewSection, { dataTransfer });

    expect(reviewSection.classList.contains("board-column--drop-active")).toBe(
      false,
    );

    await fireEvent.drop(reviewSection, { dataTransfer });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Review (0)" })).toBeTruthy();
    });

    const statusCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "set_task_status",
    );
    expect(statusCalls).toHaveLength(0);
  });

  it("rolls back optimistic board move when status persist fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-rollback",
            title: "Rollback candidate",
            status: "todo",
            display_key: "ALP-2",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.reject(new Error("save failed"));
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Rollback candidate/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "In Progress (1)" }),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
      expect(
        screen.getByText("Failed to update task status. Please try again."),
      ).toBeTruthy();
    });
  });

  it("keeps board task in place when in-progress run settings are canceled", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-cancel",
            title: "Cancel move",
            status: "todo",
            display_key: "ALP-44",
          },
        ]);
      }
      if (command === "set_task_status") {
        return Promise.resolve({
          id: "task-cancel",
          title: "Cancel move",
          status: "doing",
          display_key: "ALP-44",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Cancel move/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(inProgressSection, { dataTransfer });
    await fireEvent.drop(inProgressSection, { dataTransfer });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "New run settings" }),
      ).toBeNull();
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (0)" }),
      ).toBeTruthy();
    });

    const statusCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "set_task_status",
    );
    expect(statusCalls).toHaveLength(0);
  });

  it("restores previous mini-card when optimistic move to done fails", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-done-fail",
            title: "Done failure",
            status: "review",
            display_key: "ALP-41",
          },
        ]);
      }
      if (command === "list_task_runs") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task-done-fail") {
          return Promise.resolve([
            {
              id: "run-done-fail",
              task_id: "task-done-fail",
              project_id: "p-1",
              status: "completed",
              display_key: "RUN-41",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ]);
        }
      }
      if (command === "set_task_status") {
        return Promise.reject(new Error("save failed"));
      }
      return Promise.resolve([]);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (1)" })).toBeTruthy();
      expect(screen.getByText("Waiting for merge")).toBeTruthy();
    });

    const doneSection = screen
      .getByRole("heading", { name: "Done (0)" })
      .closest("section") as HTMLElement;
    const taskCard = screen
      .getByRole("link", { name: /Done failure/i })
      .closest("li") as HTMLElement;

    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
    };

    await fireEvent.dragStart(taskCard, { dataTransfer });
    await fireEvent.dragOver(doneSection, { dataTransfer });
    await fireEvent.drop(doneSection, { dataTransfer });

    expect(screen.getByRole("heading", { name: "Done (1)" })).toBeTruthy();
    expect(screen.queryByText("Run Details")).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review (1)" })).toBeTruthy();
      expect(screen.getByText("Waiting for merge")).toBeTruthy();
      expect(
        screen.getByText("Failed to update task status. Please try again."),
      ).toBeTruthy();
    });
  });

  it("rolls back only the failed task when another optimistic move succeeds", async () => {
    let taskOnePersist:
      | {
          resolve: (value: unknown) => void;
          reject: (reason?: unknown) => void;
        }
      | undefined;
    let taskTwoPersist:
      | {
          resolve: (value: unknown) => void;
          reject: (reason?: unknown) => void;
        }
      | undefined;

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Task one",
            status: "todo",
            display_key: "ALP-1",
          },
          {
            id: "task-2",
            title: "Task two",
            status: "todo",
            display_key: "ALP-2",
          },
        ]);
      }
      if (command === "set_task_status") {
        const taskId = (args as { id?: string } | undefined)?.id;
        return new Promise((resolve, reject) => {
          if (taskId === "task-1") {
            taskOnePersist = { resolve, reject };
            return;
          }
          taskTwoPersist = { resolve, reject };
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (2)" })).toBeTruthy();
    });

    const inProgressSection = screen
      .getByRole("heading", { name: "In Progress (0)" })
      .closest("section") as HTMLElement;

    const createDataTransfer = () => ({
      data: {} as Record<string, string>,
      effectAllowed: "move",
      dropEffect: "move",
      setData(format: string, value: string) {
        this.data[format] = value;
      },
      getData(format: string) {
        return this.data[format] ?? "";
      },
      setDragImage() {
        return;
      },
    });

    const taskOneCard = screen
      .getByRole("link", { name: /Task one/i })
      .closest("li") as HTMLElement;
    const firstTransfer = createDataTransfer();
    await fireEvent.dragStart(taskOneCard, { dataTransfer: firstTransfer });
    await fireEvent.dragOver(inProgressSection, {
      dataTransfer: firstTransfer,
    });
    await fireEvent.drop(inProgressSection, { dataTransfer: firstTransfer });

    const taskTwoCard = screen
      .getByRole("link", { name: /Task two/i })
      .closest("li") as HTMLElement;
    const secondTransfer = createDataTransfer();
    await fireEvent.dragStart(taskTwoCard, { dataTransfer: secondTransfer });
    await fireEvent.dragOver(inProgressSection, {
      dataTransfer: secondTransfer,
    });
    await fireEvent.drop(inProgressSection, { dataTransfer: secondTransfer });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (0)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (2)" }),
      ).toBeTruthy();
    });

    taskOnePersist?.resolve({
      id: "task-1",
      title: "Task one",
      status: "doing",
      display_key: "ALP-1",
    });
    taskTwoPersist?.reject(new Error("save failed"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: "In Progress (1)" }),
      ).toBeTruthy();
      const inProgressList = screen
        .getByRole("heading", { name: "In Progress (1)" })
        .closest("section") as HTMLElement;
      expect(within(inProgressList).getByText("Task one")).toBeTruthy();
      expect(
        screen.getByText("Failed to update task status. Please try again."),
      ).toBeTruthy();
    });
  });

  it("ignores stale board task responses when switching projects quickly", async () => {
    let projectOneCallCount = 0;
    let resolveProjectOneLatest: ((value: unknown) => void) | undefined;
    let resolveProjectTwoTasks: ((value: unknown) => void) | undefined;

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
          {
            id: "p-2",
            name: "Beta",
            key: "BET",
            repositories: [
              { id: "r-2", name: "Beta", path: "/repo/beta", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        const projectId =
          (args as { projectId?: string } | undefined)?.projectId || "";
        if (projectId === "p-1") {
          projectOneCallCount += 1;
          if (projectOneCallCount === 1) {
            return Promise.resolve([
              {
                id: "task-alpha-initial",
                title: "Alpha initial task",
                status: "todo",
                display_key: "ALP-1",
              },
            ]);
          }
        }
        return new Promise((resolve) => {
          if (projectId === "p-1") {
            resolveProjectOneLatest = resolve;
            return;
          }
          resolveProjectTwoTasks = resolve;
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(screen.getByText("Alpha initial task")).toBeTruthy();
    });

    const projectSelect = (await screen.findByLabelText(
      "Project",
    )) as HTMLSelectElement;
    await fireEvent.change(projectSelect, { target: { value: "p-2" } });
    await fireEvent.change(projectSelect, { target: { value: "p-1" } });

    resolveProjectOneLatest?.([
      {
        id: "task-alpha-latest",
        title: "Alpha latest task",
        status: "todo",
        display_key: "ALP-2",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Alpha latest task")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Todo (1)" })).toBeTruthy();
    });

    resolveProjectTwoTasks?.([
      {
        id: "task-beta-1",
        title: "Beta task",
        status: "todo",
        display_key: "BET-1",
      },
    ]);

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.queryByText("Beta task")).toBeNull();
    expect(screen.getByText("Alpha latest task")).toBeTruthy();
  });

  it("renders dynamic task title for task route", () => {
    renderAt("/tasks/task-123");
    expect(screen.getByRole("heading", { name: "Task Detail" })).toBeTruthy();
  });

  it("returns to board when task detail is opened from board", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-123",
            title: "Sample task",
            status: "todo",
            display_key: "ALP-7",
          },
        ]);
      }
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      return Promise.resolve(null);
    });

    renderAt("/board");

    await fireEvent.click(
      await screen.findByRole("link", { name: /Sample task/i }),
    );
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/task-123");
      expect(window.location.search).toBe("?origin=board");
    });

    await fireEvent.click(screen.getByRole("link", { name: "Back to board" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/board");
    });
  });

  it("preserves board origin when navigating to dependency task from board context", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-parent-1") {
          return Promise.resolve({
            id: "task-parent-1",
            title: "Seed data",
            description: "Parent dependency task",
            status: "done",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-5",
          });
        }
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_dependencies") {
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "task-parent-1",
              display_key: "ALP-5",
              title: "Seed data",
              status: "done",
              target_repository_name: "Main",
            },
          ],
          children: [],
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/tasks/task-123?origin=board");

    await waitFor(() => {
      expect(screen.getByText("ALP-5 - Seed data")).toBeTruthy();
    });

    await fireEvent.click(screen.getByText("ALP-5 - Seed data"));

    await waitFor(() => {
      expect(window.location.pathname).toBe(
        "/projects/p-1/tasks/task-parent-1",
      );
      expect(window.location.search).toBe("?origin=board");
      expect(screen.getByRole("link", { name: "Back to board" })).toBeTruthy();
    });
  });

  it("keeps non-board task detail back navigation unchanged", async () => {
    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample task" })).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("link", { name: "Back to project" }),
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/p-1");
    });
  });

  it("renders project-scoped task detail route", async () => {
    renderAt("/projects/p-1/tasks/task-123");
    expect(screen.getByRole("heading", { name: "Task Detail" })).toBeTruthy();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_task", { id: "task-123" });
      const inspectorColumn = document.querySelector(
        ".task-detail-inspector-column",
      ) as HTMLElement | null;
      expect(inspectorColumn).toBeTruthy();
      const panels = inspectorColumn?.querySelectorAll(".projects-panel") ?? [];
      expect(panels.length).toBe(1);
      const panel = panels[0] as HTMLElement;
      expect(
        within(panel).getByRole("heading", { name: "Task controls" }),
      ).toBeTruthy();
      expect(
        within(panel).getByRole("heading", { name: "Dependencies" }),
      ).toBeTruthy();
    });
  });

  it("renders markdown task descriptions as structured content", async () => {
    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Checklist" })).toBeTruthy();
    });

    const markdownRegion = screen
      .getByRole("heading", { name: "Checklist" })
      .closest(".run-chat-markdown");
    expect(markdownRegion).toBeTruthy();
    const list = within(markdownRegion as HTMLElement).getByRole("list");
    expect(within(list).getByText("Ship")).toBeTruthy();
    const docsLink = screen.getByRole("link", { name: "Docs" });
    expect(docsLink.getAttribute("href")).toBe("https://example.com");
    expect(screen.getByText("Keep scope tight")).toBeTruthy();
    expect(screen.getByText("const ready = true;")).toBeTruthy();
    expect(screen.queryByText("**Ship** update")).toBeNull();
    expect(screen.queryByText("[Docs](https://example.com)")).toBeNull();
  });

  it("wires task detail edit, status, move, and delete actions", async () => {
    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample task" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Edit task" }));

    expect(
      screen.getByRole("textbox", { name: "Task description" }),
    ).toBeTruthy();

    await fireEvent.input(screen.getByLabelText("Task title"), {
      target: { value: "Updated task" },
    });
    await fireEvent.input(
      screen.getByRole("textbox", { name: "Task description" }),
      {
        target: {
          value:
            "### Updated checklist\n- **Ship** update\n- [Docs](https://example.com)",
        },
      },
    );

    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_task", {
        id: "task-123",
        input: {
          title: "Updated task",
          description:
            "### Updated checklist\n- **Ship** update\n- [Docs](https://example.com)",
          implementation_guide: undefined,
        },
      });
      expect(
        screen.getByRole("heading", { name: "Updated task" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Open status transitions" }),
    );

    expect(
      screen.getByRole("menu", { name: "Valid status transitions" }),
    ).toBeTruthy();

    await fireEvent.click(
      screen.getByRole("menuitem", { name: "In progress" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-123",
        input: { status: "doing" },
      });
    });

    await fireEvent.change(screen.getByLabelText("Move task repository"), {
      target: { value: "r-2" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("move_task", {
        id: "task-123",
        input: { repository_id: "r-2" },
      });
      expect(screen.getByText("Tools")).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Delete task" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Delete task?" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete task?" })).toBeNull();
    });
    expect(invokeMock).not.toHaveBeenCalledWith("delete_task", {
      id: "task-123",
    });

    await fireEvent.click(screen.getByRole("button", { name: "Delete task" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Delete task?" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("presentation"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete task?" })).toBeNull();
    });
    expect(invokeMock).not.toHaveBeenCalledWith("delete_task", {
      id: "task-123",
    });

    await fireEvent.click(screen.getByRole("button", { name: "Delete task" }));

    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete task?",
    });
    await fireEvent.click(
      within(deleteDialog).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_task", {
        id: "task-123",
      });
      expect(window.location.pathname).toBe("/projects/p-1");
    });
  });

  it("shows only valid transition options and applies selected status", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "list_task_runs") return Promise.resolve([]);
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Review task",
          description: "Task details",
          status: "review",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "set_task_status")
        return Promise.resolve({
          id: "task-123",
          title: "Review task",
          description: "Task details",
          status: "doing",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review task" })).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Open status transitions" }),
    );

    const transitionMenu = screen.getByRole("menu", {
      name: "Valid status transitions",
    });
    expect(
      within(transitionMenu).getByRole("menuitem", { name: "To do" }),
    ).toBeTruthy();
    expect(
      within(transitionMenu).getByRole("menuitem", { name: "In progress" }),
    ).toBeTruthy();
    expect(
      within(transitionMenu).getByRole("menuitem", { name: "Done" }),
    ).toBeTruthy();
    expect(
      within(transitionMenu).queryByRole("menuitem", { name: "In review" }),
    ).toBeNull();

    await fireEvent.click(
      within(transitionMenu).getByRole("menuitem", { name: "In progress" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
        id: "task-123",
        input: { status: "doing" },
      });
    });
  });

  it("shows move repository controls only when multiple repositories exist", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample task" })).toBeTruthy();
    });

    expect(screen.queryByLabelText("Move task repository")).toBeNull();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(
      screen.queryByText(
        "Move is available when a project has multiple repositories.",
      ),
    ).toBeNull();
  });

  it("renders run detail with chat workspace and floating tools", async () => {
    renderAt("/runs/run-456");

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to task" })).toBeTruthy();
      expect(
        screen.getByRole("region", { name: "Conversation transcript" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("toolbar", { name: "Run chat tools" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Logs" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Git" })).toBeTruthy();
      expect(screen.queryByText("run-456")).toBeNull();
    });
  });

  it("opens and closes review overlay in run detail", async () => {
    renderAt("/runs/run-456");

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Conversation transcript" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Review" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Close Review panel" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Close Review panel" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull();
      expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    });
  });

  it("navigates back from run detail to linked task detail", async () => {
    renderAt("/runs/run-456");

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to task" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: "Back to task" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/p-1/tasks/task-123");
      expect(window.location.search).toBe("");
    });
  });

  it("falls back to projects back target when run has no task context", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_run") {
        return Promise.resolve({
          id: "run-no-task",
          task_id: "",
          project_id: "p-1",
          status: "running",
          triggered_by: "user",
          created_at: "2026-01-02T00:00:00.000Z",
        });
      }
      if (command === "get_task") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    renderAt("/runs/run-no-task");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Back to projects" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("link", { name: "Back to projects" }),
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
      expect(window.location.search).toBe("");
    });
  });

  it("returns to the same run when task detail is opened from run detail", async () => {
    renderAt("/runs/run-456");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "SESSION TITLE" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: /ALP-7/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/p-1/tasks/task-123");
      expect(window.location.search).toBe("?origin=run&runId=run-456");
      expect(screen.getByRole("link", { name: "Back to run" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: "Back to run" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/runs/run-456");
      expect(
        screen.getByRole("heading", { name: "SESSION TITLE" }),
      ).toBeTruthy();
    });
  });

  it("renders run not found state when get_run returns not found", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_run") {
        return Promise.reject(new Error("run not found"));
      }
      if (command === "get_task") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    renderAt("/runs/missing-run");

    await waitFor(() => {
      expect(screen.getByText("Run not found.")).toBeTruthy();
      expect(screen.queryByText("Failed to load run details.")).toBeNull();
    });
  });

  it("ignores stale run detail responses when switching run routes quickly", async () => {
    let resolveRunOne: ((value: unknown) => void) | undefined;
    let resolveRunTwo: ((value: unknown) => void) | undefined;

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_run") {
        const runId = (args as { runId?: string } | undefined)?.runId;
        return new Promise((resolve) => {
          if (runId === "run-1") {
            resolveRunOne = resolve;
            return;
          }
          resolveRunTwo = resolve;
        });
      }

      if (command === "get_task") {
        return Promise.resolve(null);
      }

      return Promise.resolve(null);
    });

    renderAt("/runs/run-1");

    window.history.pushState({}, "", "/runs/run-2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new Event("popstate"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_run", { runId: "run-2" });
    });

    resolveRunTwo?.({
      id: "run-2",
      task_id: "task-2",
      project_id: "p-1",
      status: "running",
      triggered_by: "user",
      created_at: "2026-01-02T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    });

    resolveRunOne?.({
      id: "run-1",
      task_id: "task-1",
      project_id: "p-1",
      status: "completed",
      triggered_by: "user",
      created_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:05:00.000Z",
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("creates a run from task detail, lists it, and navigates to run detail", async () => {
    let listRunsCallCount = 0;
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-99") {
          return Promise.resolve({
            id: "task-99",
            title: "Run target task",
            status: "todo",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-99",
          });
        }
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_dependencies") {
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      }
      if (command === "list_task_runs") {
        listRunsCallCount += 1;
        if (listRunsCallCount === 1) {
          return Promise.resolve([
            {
              id: "run-active",
              task_id: "task-123",
              run_number: 14,
              project_id: "p-1",
              status: "running",
              triggered_by: "user",
              created_at: "2026-01-02T00:00:00.000Z",
              started_at: "2026-01-02T00:01:00.000Z",
            },
            {
              id: "run-old",
              task_id: "task-123",
              run_number: 12,
              project_id: "p-1",
              status: "completed",
              triggered_by: "user",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ]);
        }
        return Promise.resolve([
          {
            id: "run-new",
            task_id: "task-99",
            run_number: 13,
            project_id: "p-1",
            status: "queued",
            triggered_by: "user",
            created_at: "2026-01-03T00:00:00.000Z",
          },
          {
            id: "run-active",
            task_id: "task-123",
            run_number: 14,
            project_id: "p-1",
            status: "running",
            triggered_by: "user",
            created_at: "2026-01-02T00:00:00.000Z",
            started_at: "2026-01-02T00:01:00.000Z",
          },
          {
            id: "run-old",
            task_id: "task-123",
            run_number: 12,
            project_id: "p-1",
            status: "completed",
            triggered_by: "user",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      if (command === "create_run") {
        return Promise.resolve({
          id: "run-new",
          task_id: "task-123",
          run_number: 13,
          project_id: "p-1",
          status: "queued",
          triggered_by: "user",
          created_at: "2026-01-03T00:00:00.000Z",
        });
      }
      if (command === "get_run") {
        return Promise.resolve({
          id: "run-new",
          task_id: "task-99",
          project_id: "p-1",
          status: "running",
          triggered_by: "user",
          created_at: "2026-01-03T00:00:00.000Z",
          started_at: "2026-01-03T00:01:00.000Z",
          finished_at: null,
          summary: "In progress",
          error_message: null,
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runs" })).toBeTruthy();
      expect(screen.getByText("Run #12")).toBeTruthy();
      expect(screen.getByText("Run #14")).toBeTruthy();
      expect(screen.getByText("Completed")).toBeTruthy();
      expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
      const completedRunRow = screen.getByText("Run #12").closest("li");
      const runningRunRow = screen.getByText("Run #14").closest("li");
      expect(completedRunRow).toBeTruthy();
      expect(runningRunRow).toBeTruthy();
      expect(
        within(completedRunRow as HTMLElement).queryByRole("button", {
          name: "Start",
        }),
      ).toBeNull();
      expect(
        within(runningRunRow as HTMLElement).queryByRole("button", {
          name: "Start",
        }),
      ).toBeNull();
      expect(screen.queryByText("Blocked")).toBeNull();
      expect(screen.queryByText("Ready")).toBeNull();
      expect(
        screen.getByText(
          "Execution completed successfully and outputs are ready.",
        ),
      ).toBeTruthy();
      expect(screen.queryByLabelText("Default run agent")).toBeNull();
    });

    await fireEvent.click(screen.getByRole("button", { name: "New run" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_run", {
        request: {
          taskId: "task-123",
          agentId: undefined,
          providerId: undefined,
          modelId: undefined,
        },
      });
      expect(listRunsCallCount).toBe(2);
      expect(screen.getByText("Run #13")).toBeTruthy();
      expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
      const queuedRunRow = screen.getByText("Run #13").closest("li");
      expect(queuedRunRow).toBeTruthy();
      expect(
        within(queuedRunRow as HTMLElement).getByRole("button", {
          name: "Start",
        }),
      ).toBeTruthy();
      expect(
        screen.getByText("Waiting for an available runner to start execution."),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("link", { name: /Run #13/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/runs/run-new");
      expect(
        screen.getByRole("heading", { name: "SESSION TITLE" }),
      ).toBeTruthy();
      expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    });
  });

  it("gates blocked task new run with warning modal and does not create run", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-123") {
          return Promise.resolve({
            id: "task-123",
            title: "Blocked task",
            description: "Task details",
            status: "todo",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-7",
            is_blocked: true,
            blocked_by_count: 4,
          });
        }
        return Promise.resolve(null);
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_runs") return Promise.resolve([]);
      if (command === "list_task_dependencies") {
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "parent-1",
              display_key: "ALP-1",
              title: "Schema",
              status: "todo",
            },
            {
              id: "parent-2",
              display_key: "ALP-2",
              title: "Migrations",
              status: "doing",
            },
            {
              id: "parent-3",
              display_key: "ALP-3",
              title: "Fixtures",
              status: "review",
            },
            {
              id: "parent-4",
              display_key: "ALP-4",
              title: "Docs",
              status: "todo",
            },
          ],
          children: [],
        });
      }
      if (command === "create_run") {
        return Promise.resolve({
          id: "run-should-not-happen",
          task_id: "task-123",
          project_id: "p-1",
          status: "queued",
          triggered_by: "user",
          created_at: "2026-01-03T00:00:00.000Z",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByText("Blocked")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "New run blocked by dependencies" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "New run blocked by dependencies" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Run blocked" })).toBeTruthy();
      expect(
        screen.queryByRole("dialog", { name: "New run settings" }),
      ).toBeNull();
      expect(
        screen.getByText(
          "This task is blocked. Wait for ALP-1 - Schema, ALP-2 - Migrations, ALP-3 - Fixtures +1 more to complete first.",
        ),
      ).toBeTruthy();
    });

    const createRunCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "create_run",
    );
    expect(createRunCalls).toHaveLength(0);

    await fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Run blocked" })).toBeNull();
    });
  });

  it("shows ready badge and allows creating run when blockers are resolved", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-123") {
          return Promise.resolve({
            id: "task-123",
            title: "Ready task",
            description: "Task details",
            status: "todo",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-7",
            is_blocked: false,
            blocked_by_count: 2,
          });
        }
        return Promise.resolve(null);
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_runs") return Promise.resolve([]);
      if (command === "list_task_dependencies") {
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "parent-1",
              display_key: "ALP-1",
              title: "Schema",
              status: "done",
            },
          ],
          children: [],
        });
      }
      if (command === "create_run") {
        return Promise.resolve({
          id: "run-created",
          task_id: "task-123",
          project_id: "p-1",
          status: "queued",
          triggered_by: "user",
          created_at: "2026-01-03T00:00:00.000Z",
        });
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(screen.queryByText("Blocked")).toBeNull();
      expect(screen.getByRole("button", { name: "New run" })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "New run" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New run settings" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_run", {
        request: {
          taskId: "task-123",
          agentId: undefined,
          providerId: undefined,
          modelId: undefined,
        },
      });
      expect(screen.queryByRole("dialog", { name: "Run blocked" })).toBeNull();
    });
  });

  it("renders run delete actions and removes a run without opening details", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-123") {
          return Promise.resolve({
            id: "task-123",
            title: "Sample task",
            description: "Task details",
            status: "todo",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-7",
          });
        }
        return Promise.resolve(null);
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "list_task_dependencies") {
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      }
      if (command === "list_task_runs") {
        return Promise.resolve([
          {
            id: "run-delete",
            task_id: "task-123",
            run_number: 5,
            project_id: "p-1",
            status: "queued",
            triggered_by: "user",
            created_at: "2026-01-03T00:00:00.000Z",
          },
          {
            id: "run-keep",
            task_id: "task-123",
            run_number: 4,
            project_id: "p-1",
            status: "completed",
            triggered_by: "user",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      if (command === "delete_run") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Delete run" }),
      ).toHaveLength(2);
      expect(screen.getByText("Run #5")).toBeTruthy();
      expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
      expect(screen.getByText("Completed")).toBeTruthy();
    });

    const pathBeforeDelete = window.location.pathname;
    const runToDelete = screen.getByText("Run #5").closest("li");
    expect(runToDelete).toBeTruthy();

    await fireEvent.click(
      within(runToDelete as HTMLElement).getByRole("button", {
        name: "Delete run",
      }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_run", {
        runId: "run-delete",
      });
      expect(screen.queryByText("Run #5")).toBeNull();
      expect(screen.getByText("Completed")).toBeTruthy();
      expect(window.location.pathname).toBe(pathBeforeDelete);
    });
  });

  it("renders dependencies and wires add/remove payloads", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "get_task") {
        const taskId = (args as { id?: string } | undefined)?.id;
        if (taskId === "task-parent-1") {
          return Promise.resolve({
            id: "task-parent-1",
            title: "Seed data",
            description: "Parent dependency task",
            status: "done",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-5",
          });
        }
        if (taskId === "task-child-1") {
          return Promise.resolve({
            id: "task-child-1",
            title: "Wire dashboard",
            description: "Child dependency task",
            status: "todo",
            project_id: "p-1",
            target_repository_name: "Main",
            display_key: "ALP-8",
          });
        }
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      }
      if (command === "list_project_tasks")
        return Promise.resolve([
          {
            id: "task-123",
            title: "Sample task",
            status: "todo",
            display_key: "ALP-7",
          },
          {
            id: "task-222",
            title: "Prep API",
            status: "doing",
            display_key: "ALP-222",
          },
          {
            id: "task-333",
            title: "QA pass",
            status: "review",
            display_key: "ALP-333",
          },
          {
            id: "task-444",
            title: "Already done",
            status: "done",
            display_key: "ALP-444",
          },
        ]);
      if (command === "list_task_dependencies") {
        if (
          (args as { taskId?: string } | undefined)?.taskId === "task-empty"
        ) {
          return Promise.resolve({
            task_id: "task-empty",
            parents: [],
            children: [],
          });
        }
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "task-parent-1",
              display_key: "ALP-5",
              title: "Seed data",
              status: "done",
              target_repository_name: "Main",
            },
          ],
          children: [
            {
              id: "task-child-1",
              display_key: "ALP-8",
              title: "Wire dashboard",
              status: "todo",
              target_repository_name: "Main",
            },
          ],
        });
      }
      if (command === "add_task_dependency") return Promise.resolve(null);
      if (command === "remove_task_dependency") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByText("ALP-5 - Seed data")).toBeTruthy();
      expect(screen.getByText("ALP-8 - Wire dashboard")).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Link parent dependency" }),
    );
    let linkDialog: HTMLElement;
    await waitFor(() => {
      linkDialog = screen.getByRole("dialog", {
        name: "Link blocking prerequisite",
      });
      expect(linkDialog).toBeTruthy();
    });
    expect(screen.queryByText("ALP-444 - Already done")).toBeNull();
    await fireEvent.change(screen.getByLabelText("Search dependency tasks"), {
      target: { value: "ALP-44" },
    });
    expect(screen.queryByText("ALP-444 - Already done")).toBeNull();
    await fireEvent.click(screen.getByLabelText("Show done tasks"));
    await waitFor(() => {
      expect(screen.getByText("ALP-444 - Already done")).toBeTruthy();
    });
    await fireEvent.change(screen.getByLabelText("Search dependency tasks"), {
      target: { value: "ALP-222" },
    });
    await fireEvent.click(
      within(linkDialog!).getByRole("button", { name: /Link ALP-222/i }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_task_dependency", {
        input: { parent_task_id: "task-222", child_task_id: "task-123" },
      });
      expect(
        screen.queryByRole("dialog", { name: "Link blocking prerequisite" }),
      ).toBeNull();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
    });
    const childRow = screen.getByText("ALP-8 - Wire dashboard").closest("li");
    expect(childRow).toBeTruthy();
    const pathBeforeRemove = window.location.pathname;
    await fireEvent.click(
      within(childRow as HTMLElement).getByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("remove_task_dependency", {
        input: { parent_task_id: "task-123", child_task_id: "task-child-1" },
      });
    });
    expect(window.location.pathname).toBe(pathBeforeRemove);

    await waitFor(() => {
      expect(screen.getByText("ALP-5 - Seed data")).toBeTruthy();
    });

    const parentDependencyRow = screen
      .getByText("ALP-5 - Seed data")
      .closest("li");
    expect(parentDependencyRow).toBeTruthy();
    await fireEvent.click(parentDependencyRow as HTMLElement);
    await waitFor(() => {
      expect(window.location.pathname).toBe(
        "/projects/p-1/tasks/task-parent-1",
      );
      expect(screen.getByRole("heading", { name: "Seed data" })).toBeTruthy();
    });
  });

  it("shows empty dependency states when there are no links", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_task")
        return Promise.resolve({
          id: "task-empty",
          title: "Empty deps task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-10",
        });
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-empty",
          parents: [],
          children: [],
        });
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-empty");

    await waitFor(() => {
      expect(screen.getByText("No prerequisites yet.")).toBeTruthy();
      expect(screen.getByText("No downstream tasks yet.")).toBeTruthy();
    });
  });

  it("does not offer self or duplicate parent candidates in link modal", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [
            {
              id: "task-parent-1",
              display_key: "ALP-5",
              title: "Seed data",
              status: "done",
            },
          ],
          children: [],
        });
      if (command === "list_project_tasks")
        return Promise.resolve([
          {
            id: "task-123",
            title: "Sample task",
            status: "todo",
            display_key: "ALP-7",
          },
          {
            id: "task-parent-1",
            title: "Seed data",
            status: "done",
            display_key: "ALP-5",
          },
        ]);
      if (command === "add_task_dependency") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByText("ALP-5 - Seed data")).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Link parent dependency" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Link blocking prerequisite",
    });

    expect(within(dialog).queryByText("ALP-7 - Sample task")).toBeNull();
    expect(within(dialog).queryByText("ALP-5 - Seed data")).toBeNull();
    expect(
      within(dialog).getByText("No tasks match your filters."),
    ).toBeTruthy();
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "add_task_dependency",
      ),
    ).toBe(false);
  });

  it("closes link modal on Escape", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "list_project_tasks")
        return Promise.resolve([
          {
            id: "task-222",
            title: "Prep API",
            status: "doing",
            display_key: "ALP-222",
          },
        ]);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Link parent dependency" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Link parent dependency" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Link blocking prerequisite" }),
      ).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Link blocking prerequisite" }),
      ).toBeNull();
    });
  });

  it("closes link modal on backdrop click", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "list_project_tasks")
        return Promise.resolve([
          {
            id: "task-222",
            title: "Prep API",
            status: "doing",
            display_key: "ALP-222",
          },
        ]);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Link parent dependency" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Link parent dependency" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Link blocking prerequisite" }),
      ).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("presentation"));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Link blocking prerequisite" }),
      ).toBeNull();
    });
  });

  it("creates and links dependency tasks from Blocked by and Blocking headers", async () => {
    let createdTaskCounter = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project")
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      if (command === "get_task")
        return Promise.resolve({
          id: "task-123",
          title: "Sample task",
          description: "Task details",
          status: "todo",
          project_id: "p-1",
          target_repository_id: "r-1",
          target_repository_name: "Main",
          display_key: "ALP-7",
        });
      if (command === "list_task_dependencies")
        return Promise.resolve({
          task_id: "task-123",
          parents: [],
          children: [],
        });
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task") {
        createdTaskCounter += 1;
        return Promise.resolve({
          id: `task-new-${createdTaskCounter}`,
          title: `Created ${createdTaskCounter}`,
          status: "todo",
        });
      }
      if (command === "add_task_dependency") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Dependencies" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Create parent dependency" }),
    );
    await fireEvent.input(screen.getByLabelText("Dependency task title"), {
      target: { value: "Parent via plus" },
    });
    await fireEvent.input(
      screen.getByLabelText("Dependency task implementation guide"),
      {
        target: { value: "  Parent implementation steps  " },
      },
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Create and link" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_task", {
        input: {
          project_id: "p-1",
          title: "Parent via plus",
          description: undefined,
          implementation_guide: "Parent implementation steps",
          status: "todo",
          repository_id: "r-1",
        },
      });
      expect(invokeMock).toHaveBeenCalledWith("add_task_dependency", {
        input: { parent_task_id: "task-new-1", child_task_id: "task-123" },
      });
      expect(
        screen.queryByRole("dialog", { name: "Create blocking prerequisite" }),
      ).toBeNull();
    });

    const parentCreateIndex = invokeMock.mock.calls.findIndex(
      ([cmd, args]) =>
        cmd === "create_task" &&
        (args as { input?: { title?: string } }).input?.title ===
          "Parent via plus",
    );
    const parentLinkIndex = invokeMock.mock.calls.findIndex(
      ([cmd, args]) =>
        cmd === "add_task_dependency" &&
        (
          args as {
            input?: { parent_task_id?: string; child_task_id?: string };
          }
        ).input?.parent_task_id === "task-new-1" &&
        (
          args as {
            input?: { parent_task_id?: string; child_task_id?: string };
          }
        ).input?.child_task_id === "task-123",
    );
    expect(parentCreateIndex).toBeGreaterThanOrEqual(0);
    expect(parentLinkIndex).toBeGreaterThan(parentCreateIndex);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create blocked task" }),
      ).toBeTruthy();
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Create blocked task" }),
    );
    await fireEvent.input(screen.getByLabelText("Dependency task title"), {
      target: { value: "Child via plus" },
    });
    await fireEvent.input(
      screen.getByLabelText("Dependency task implementation guide"),
      {
        target: { value: "Child implementation steps" },
      },
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Create and link" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_task", {
        input: {
          project_id: "p-1",
          title: "Child via plus",
          description: undefined,
          implementation_guide: "Child implementation steps",
          status: "todo",
          repository_id: "r-1",
        },
      });
      expect(invokeMock).toHaveBeenCalledWith("add_task_dependency", {
        input: { parent_task_id: "task-123", child_task_id: "task-new-2" },
      });
      expect(
        screen.queryByRole("dialog", { name: "Create blocked task" }),
      ).toBeNull();
    });

    const childCreateIndex = invokeMock.mock.calls.findIndex(
      ([cmd, args]) =>
        cmd === "create_task" &&
        (args as { input?: { title?: string } }).input?.title ===
          "Child via plus",
    );
    const childLinkIndex = invokeMock.mock.calls.findIndex(
      ([cmd, args]) =>
        cmd === "add_task_dependency" &&
        (
          args as {
            input?: { parent_task_id?: string; child_task_id?: string };
          }
        ).input?.parent_task_id === "task-123" &&
        (
          args as {
            input?: { parent_task_id?: string; child_task_id?: string };
          }
        ).input?.child_task_id === "task-new-2",
    );
    expect(childCreateIndex).toBeGreaterThanOrEqual(0);
    expect(childLinkIndex).toBeGreaterThan(childCreateIndex);
  });

  it("renders not-found fallback page", () => {
    renderAt("/missing-route");
    expect(screen.getByRole("heading", { name: "Not Found" })).toBeTruthy();
    expect(
      screen.getByText("The requested page could not be found."),
    ).toBeTruthy();
  });

  it("renders projects route in app shell", async () => {
    renderAt("/projects");

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Projects" })).toHaveLength(
      2,
    );
    await waitFor(() => {
      expect(screen.getByText("Existing Projects")).toBeTruthy();
    });
  });

  it("redirects to projects when there are no projects", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/board");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
    });
  });

  it("keeps shell content stable when startup project load fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.reject("database error: startup failed");
      return Promise.resolve(null);
    });

    renderAt("/board");

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to load projects during startup",
        "database error: startup failed",
      );
      expect(
        screen.getByText("Failed to load projects. Please refresh."),
      ).toBeTruthy();
      expect(
        screen.getByText("No projects yet.", { exact: false }),
      ).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/board");

    warnSpy.mockRestore();
  });

  it("enforces default repository selection on create form", async () => {
    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/one" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Add repository" }),
    );
    await fireEvent.input(
      screen.getAllByPlaceholderText("Repository path")[1],
      {
        target: { value: "/repo/two" },
      },
    );

    await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await fireEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    expect(
      screen.getByText("Select exactly one default repository."),
    ).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "create_project",
      expect.anything(),
    );
  });

  it("maps create payload repository path to repo_path", async () => {
    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/demo" },
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_project", {
        input: {
          name: "Demo Project",
          key: "DEM",
          description: undefined,
          repositories: [
            { repo_path: "/repo/demo", name: "/repo/demo", is_default: true },
          ],
        },
      });
    });
  });

  it("shows backend message when create fails with validation error", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_project")
        return Promise.reject("project key already exists");
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/demo" },
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Failed to create project. project key already exists",
        ),
      ).toBeTruthy();
    });
  });

  it("hides internal project-create errors behind generic message", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_project")
        return Promise.reject("database error: sqlx query failed");
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/demo" },
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Failed to create project. Please try again."),
      ).toBeTruthy();
      expect(
        screen.queryByText("database error: sqlx query failed"),
      ).toBeNull();
    });
  });

  it("opens clone modal and clones a project", async () => {
    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Clone project Alpha/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Clone project" }),
      ).toBeTruthy();
      expect(screen.getByText(/New project name:/i)).toBeTruthy();
      expect(
        screen.getByText("Enter the path for the cloned repository."),
      ).toBeTruthy();
    });

    const cloneDialog = screen.getByRole("dialog", { name: "Clone project" });
    const [projectKeyInput, repositoryDestinationInput] =
      within(cloneDialog).getAllByRole("textbox");

    await fireEvent.blur(repositoryDestinationInput);
    expect(repositoryDestinationInput.getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(repositoryDestinationInput.getAttribute("aria-describedby")).toBe(
      "clone-repository-destination-error",
    );
    expect(
      within(cloneDialog).getByText("Repository destination is required."),
    ).toBeTruthy();

    await fireEvent.input(projectKeyInput, {
      target: { value: "ACP" },
    });
    await fireEvent.input(repositoryDestinationInput, {
      target: { value: "/repo/alpha-copy" },
    });
    expect(repositoryDestinationInput.getAttribute("aria-invalid")).toBe(
      "false",
    );
    expect(repositoryDestinationInput.getAttribute("aria-describedby")).toBe(
      "clone-repository-destination-help",
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Clone project" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("clone_project", {
        sourceProjectId: "p-1",
        input: {
          name: "Alpha - Copy",
          key: "ACP",
          repository_destination: "/repo/alpha-copy",
        },
      });
      expect(window.location.pathname).toBe("/projects/p-3");
    });
  });

  it("closes clone modal on Escape", async () => {
    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Clone project Alpha/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Clone project" }),
      ).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Clone project" }),
      ).toBeNull();
    });
  });

  it("does not dismiss clone modal via Escape or backdrop while cloning", async () => {
    let resolveClone: ((value: unknown) => void) | undefined;
    const clonePromise = new Promise((resolve) => {
      resolveClone = resolve;
    });

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "clone_project") return clonePromise;
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Clone project Alpha/i }),
    );

    const cloneDialog = await screen.findByRole("dialog", {
      name: "Clone project",
    });
    const [projectKeyInput, repositoryDestinationInput] =
      within(cloneDialog).getAllByRole("textbox");

    await fireEvent.input(projectKeyInput, {
      target: { value: "ACP" },
    });
    await fireEvent.input(repositoryDestinationInput, {
      target: { value: "/repo/alpha-copy" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Clone project" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cloning..." })).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Clone project" })).toBeTruthy();

    const modalBackdrop = document.querySelector(
      ".projects-modal-backdrop",
    ) as HTMLElement;
    expect(modalBackdrop).toBeTruthy();
    await fireEvent.click(modalBackdrop);
    expect(screen.getByRole("dialog", { name: "Clone project" })).toBeTruthy();

    resolveClone?.({
      project: {
        id: "p-3",
        name: "Alpha - Copy",
        key: "ACP",
        description: null,
      },
      repositories: [
        {
          id: "r-3",
          name: "Main",
          repo_path: "/repo/alpha-copy",
          is_default: true,
        },
      ],
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Clone project" }),
      ).toBeNull();
      expect(window.location.pathname).toBe("/projects/p-3");
    });
  });

  it("opens delete confirmation modal and cancels deletion", async () => {
    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Delete project Alpha/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Delete project permanently?" }),
      ).toBeTruthy();
      expect(screen.getByText(/This action cannot be undone/i)).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Delete project permanently?" }),
      ).toBeNull();
    });

    expect(invokeMock).not.toHaveBeenCalledWith("delete_project", {
      id: "p-1",
    });
  });

  it("deletes project after confirmation and refreshes list", async () => {
    let projects = [
      {
        id: "p-1",
        name: "Alpha",
        key: "ALP",
        repositories: [
          { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
        ],
      },
      {
        id: "p-2",
        name: "Beta",
        key: "BET",
        repositories: [
          { id: "r-2", name: "Main", path: "/repo/beta", is_default: true },
        ],
      },
    ];

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_projects") {
        return Promise.resolve(projects);
      }
      if (command === "delete_project") {
        const projectId = (args as { id?: string } | undefined)?.id;
        projects = projects.filter((project) => project.id !== projectId);
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeTruthy();
      expect(screen.getByText("Beta")).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: /Delete project Alpha/i }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Delete project" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_project", { id: "p-1" });
      expect(screen.queryByText("Alpha")).toBeNull();
      expect(screen.getByText("Beta")).toBeTruthy();
    });
  });

  it("shows delete API failure in project delete modal", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "delete_project") {
        return Promise.reject(new Error("backend delete blocked"));
      }
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Delete project Alpha/i }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Delete project" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to delete project\./i)).toBeTruthy();
      expect(screen.getByText(/backend delete blocked/i)).toBeTruthy();
      expect(
        screen.getByRole("dialog", { name: "Delete project permanently?" }),
      ).toBeTruthy();
    });
  });

  it("shows refresh-specific error when delete succeeds but project reload fails", async () => {
    let deleteCalled = false;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        if (!deleteCalled) {
          return Promise.resolve([
            {
              id: "p-1",
              name: "Alpha",
              key: "ALP",
              repositories: [
                {
                  id: "r-1",
                  name: "Main",
                  path: "/repo/main",
                  is_default: true,
                },
              ],
            },
          ]);
        }
        return Promise.reject(new Error("refresh unavailable"));
      }
      if (command === "delete_project") {
        deleteCalled = true;
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.click(
      await screen.findByRole("button", { name: /Delete project Alpha/i }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Delete project" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Project deleted, but failed to refresh projects\./i),
      ).toBeTruthy();
      expect(screen.getByText(/refresh unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Failed to delete project\./i)).toBeNull();
  });

  it("shows tasks section in project detail", async () => {
    renderAt("/projects/p-1");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Tasks/ })).toBeTruthy();
      expect(screen.getByText("Add task")).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "Back to projects" }),
      ).toBeTruthy();
    });
  });

  it("shows task display key prefix on task cards", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Created task",
            status: "todo",
            display_key: "ALP-1",
            is_blocked: true,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await waitFor(() => {
      expect(screen.getByText("ALP-1")).toBeTruthy();
      expect(screen.getByRole("link", { name: /Created task/i })).toBeTruthy();
      expect(screen.getByText("Blocked")).toBeTruthy();
    });
  });

  it("uses display keys in task labels and does not render raw UUIDs", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            title: "Created task",
            status: "todo",
            display_key: "ORK-12",
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await waitFor(() => {
      expect(screen.getByText("ORK-12")).toBeTruthy();
      expect(
        screen.queryByText("550e8400-e29b-41d4-a716-446655440000"),
      ).toBeNull();
    });
  });

  it("falls back to project-key task-number labels and suppresses raw UUID text", async () => {
    const taskId = "550e8400-e29b-41d4-a716-446655440000";
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") {
        return Promise.resolve([
          {
            id: taskId,
            title: "Task without display key",
            status: "todo",
            task_number: 12,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await waitFor(() => {
      expect(screen.getByText("ALP-12")).toBeTruthy();
      expect(screen.queryByText(taskId)).toBeNull();
    });
  });

  it("renders project name/key from wrapped get_project response", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") {
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      }
      if (command === "get_project") {
        return Promise.resolve({
          project: {
            id: "p-1",
            name: "Gamma Project",
            key: "GAM",
            description: "Wrapped detail",
          },
          repositories: [
            {
              id: "r-1",
              name: "Main",
              repo_path: "/repo/main",
              is_default: true,
            },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Gamma Project" }),
      ).toBeTruthy();
      expect(screen.getByText("GAM")).toBeTruthy();
      expect(screen.queryByText("Untitled project")).toBeNull();
      expect(screen.queryByText("NO-KEY")).toBeNull();
    });
  });

  it("enforces title required for create-task modal", async () => {
    renderAt("/projects/p-1");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Add task" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(screen.getByText("Title is required.")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "create_task",
      expect.anything(),
    );
  });

  it("shows project-scoped repository options in create-task modal", async () => {
    renderAt("/projects/p-1");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Add task" }),
    );

    const repositoryField = screen.getByLabelText(
      "Target repository",
    ) as HTMLSelectElement;
    const options = Array.from(repositoryField.options).map(
      (option) => option.textContent,
    );

    expect(options).toEqual(["Main", "Tools"]);
    expect(repositoryField.value).toBe("r-1");
  });

  it("refreshes project task list after successful create", async () => {
    let listCallCount = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") {
        listCallCount += 1;
        if (listCallCount === 1) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: "task-1",
            title: "Created task",
            status: "todo",
            target_repository_name: "Main",
            updated_at: "2026-01-01T12:00:00.000Z",
          },
        ]);
      }
      if (command === "create_task")
        return Promise.resolve({
          id: "task-1",
          title: "Created task",
          status: "todo",
        });
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Add task" }),
    );
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Created task" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(listCallCount).toBe(2);
      expect(screen.getByRole("link", { name: /Created task/i })).toBeTruthy();
    });

    expect(invokeMock).toHaveBeenCalledWith("create_task", {
      input: {
        project_id: "p-1",
        title: "Created task",
        description: undefined,
        implementation_guide: undefined,
        status: "todo",
        repository_id: "r-1",
      },
    });
  });

  it("shows backend validation message when task create fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task")
        return Promise.reject("invalid task status");
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Add task" }),
    );
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Created task" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to create task. invalid task status"),
      ).toBeTruthy();
    });
  });

  it("hides internal task-create errors behind generic message", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects")
        return Promise.resolve([
          {
            id: "p-1",
            name: "Alpha",
            key: "ALP",
            repositories: [
              { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            ],
          },
        ]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task")
        return Promise.reject("database error: constraint failed");
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Add task" }),
    );
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Created task" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to create task. Please try again."),
      ).toBeTruthy();
    });
  });
});
