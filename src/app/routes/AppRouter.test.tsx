import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppRouter from "../../router";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(() => <AppRouter />);
};

describe("app routing and shell", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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
      return Promise.resolve(null);
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

  it("switches routes while keeping shell layout visible", async () => {
    renderAt("/board");

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Board" })).toHaveLength(2);
    expect(screen.getByText("Task board view coming soon.")).toBeTruthy();

    await fireEvent.click(screen.getByRole("link", { name: "Agents" }));

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Agents" })).toHaveLength(2);
    expect(screen.getByText("Manage and configure agents.")).toBeTruthy();
  });

  it("renders dynamic task title for task route", () => {
    renderAt("/tasks/task-123");
    expect(screen.getByRole("heading", { name: "Task Detail" })).toBeTruthy();
  });

  it("renders project-scoped task detail route", async () => {
    renderAt("/projects/p-1/tasks/task-123");
    expect(screen.getByRole("heading", { name: "Task Detail" })).toBeTruthy();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_task", { id: "task-123" });
    });
  });

  it("renders markdown task descriptions as structured content", async () => {
    renderAt("/projects/p-1/tasks/task-123");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Checklist" })).toBeTruthy();
    });

    const markdownRegion = screen
      .getByRole("heading", { name: "Checklist" })
      .closest(".markdown-content");
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

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await fireEvent.input(screen.getByLabelText("Task title"), {
      target: { value: "Updated task" },
    });
    await fireEvent.input(screen.getByLabelText("Task description"), {
      target: { value: "Updated details" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_task", {
        id: "task-123",
        input: { title: "Updated task", description: "Updated details" },
      });
      expect(
        screen.getByRole("heading", { name: "Updated task" }),
      ).toBeTruthy();
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Move to In progress" }),
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

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

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

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

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

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

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
      screen.getByText(
        "Move is available when a project has multiple repositories.",
      ),
    ).toBeTruthy();
  });

  it("renders dynamic run title for run route", () => {
    renderAt("/runs/run-456");
    expect(screen.getByRole("heading", { name: "Run run-456" })).toBeTruthy();
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

    await fireEvent.change(screen.getByLabelText("Add parent dependency"), {
      target: { value: "task-222" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Add parent" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_task_dependency", {
        input: { parent_task_id: "task-222", child_task_id: "task-123" },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
    });
    const childRow = screen.getByText("ALP-8 - Wire dashboard").closest("li");
    expect(childRow).toBeTruthy();
    await fireEvent.click(
      within(childRow as HTMLElement).getByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("remove_task_dependency", {
        input: { parent_task_id: "task-123", child_task_id: "task-child-1" },
      });
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

  it("shows tasks section in project detail", async () => {
    renderAt("/projects/p-1");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Tasks/ })).toBeTruthy();
      expect(screen.getByText("Add task")).toBeTruthy();
      expect(
        screen.getByRole("link", { name: /Back to Projects/i }),
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
          },
        ]);
      }
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await waitFor(() => {
      expect(screen.getByText("ALP-1")).toBeTruthy();
      expect(screen.getByRole("link", { name: /Created task/i })).toBeTruthy();
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
