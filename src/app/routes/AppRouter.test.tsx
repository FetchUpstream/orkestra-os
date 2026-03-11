import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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
      if (command === "list_projects") return Promise.resolve([{ id: "p-1", name: "Alpha", key: "ALP", repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }] }]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [
            { id: "r-1", name: "Main", path: "/repo/main", is_default: true },
            { id: "r-2", name: "Tools", path: "/repo/tools", is_default: false },
          ],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "get_task") return Promise.resolve({ id: "task-123", title: "Sample task", status: "todo" });
      if (command === "create_task") return Promise.resolve({ id: "task-999", title: "Created task", status: "todo" });
      if (command === "create_project") {
        return Promise.resolve({
          project: { id: "p-2", name: "Beta", key: "BET", description: null },
          repositories: [{ id: "r-1", name: "Beta", repo_path: "/repo/beta", is_default: true }],
        });
      }
      return Promise.resolve(null);
    });
  });

  it("renders expected sidebar links", () => {
    renderAt("/board");

    const links = ["/board", "/projects", "/agents", "/worktrees", "/reviews", "/settings"];
    for (const href of links) {
      const link = screen.getByRole("link", { name: new RegExp(href.slice(1), "i") });
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
    expect(screen.getByRole("heading", { name: "Task task-123" })).toBeTruthy();
  });

  it("renders project-scoped task detail route", async () => {
    renderAt("/projects/p-1/tasks/task-123");
    expect(screen.getByRole("heading", { name: "Task task-123" })).toBeTruthy();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_task", { taskId: "task-123" });
    });
  });

  it("renders dynamic run title for run route", () => {
    renderAt("/runs/run-456");
    expect(screen.getByRole("heading", { name: "Run run-456" })).toBeTruthy();
  });

  it("renders not-found fallback page", () => {
    renderAt("/missing-route");
    expect(screen.getByRole("heading", { name: "Not Found" })).toBeTruthy();
    expect(screen.getByText("The requested page could not be found.")).toBeTruthy();
  });

  it("renders projects route in app shell", async () => {
    renderAt("/projects");

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Projects" })).toHaveLength(2);
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
    await fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await fireEvent.input(screen.getAllByPlaceholderText("Repository path")[1], {
      target: { value: "/repo/two" },
    });

    await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByText("Select exactly one default repository.")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith("create_project", expect.anything());
  });

  it("maps create payload repository path to repo_path", async () => {
    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/demo" },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_project", {
        input: {
          name: "Demo Project",
          key: "DEM",
          description: undefined,
          repositories: [{ repo_path: "/repo/demo", name: "/repo/demo", is_default: true }],
        },
      });
    });
  });

  it("shows backend message when create fails with validation error", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([]);
      if (command === "create_project") return Promise.reject("project key already exists");
      return Promise.resolve(null);
    });

    renderAt("/projects");

    await fireEvent.input(screen.getByLabelText("Project name"), {
      target: { value: "Demo Project" },
    });
    await fireEvent.input(screen.getByPlaceholderText("Repository path"), {
      target: { value: "/repo/demo" },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to create project. project key already exists")).toBeTruthy();
    });
  });

  it("shows tasks section in project detail", async () => {
    renderAt("/projects/p-1");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
      expect(screen.getByText("Create task")).toBeTruthy();
    });
  });

  it("enforces title required for create-task modal", async () => {
    renderAt("/projects/p-1");

    await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    await fireEvent.click(screen.getAllByRole("button", { name: "Create task" })[1]);

    expect(screen.getByText("Title is required.")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith("create_task", expect.anything());
  });

  it("shows project-scoped repository options in create-task modal", async () => {
    renderAt("/projects/p-1");

    await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));

    const repositoryField = screen.getByLabelText("Target repository") as HTMLSelectElement;
    const options = Array.from(repositoryField.options).map((option) => option.textContent);

    expect(options).toEqual(["Main", "Tools"]);
    expect(repositoryField.value).toBe("r-1");
  });

  it("refreshes project task list after successful create", async () => {
    let listCallCount = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([{ id: "p-1", name: "Alpha", key: "ALP", repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }] }]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }],
        });
      }
      if (command === "list_project_tasks") {
        listCallCount += 1;
        if (listCallCount === 1) return Promise.resolve([]);
        return Promise.resolve([{ id: "task-1", title: "Created task", status: "todo", target_repository_name: "Main", updated_at: "2026-01-01T12:00:00.000Z" }]);
      }
      if (command === "create_task") return Promise.resolve({ id: "task-1", title: "Created task", status: "todo" });
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    await fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Created task" } });
    await fireEvent.click(screen.getAllByRole("button", { name: "Create task" })[1]);

    await waitFor(() => {
      expect(listCallCount).toBe(2);
      expect(screen.getByRole("link", { name: "Created task" })).toBeTruthy();
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
      if (command === "list_projects") return Promise.resolve([{ id: "p-1", name: "Alpha", key: "ALP", repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }] }]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task") return Promise.reject("invalid task status");
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    await fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Created task" } });
    await fireEvent.click(screen.getAllByRole("button", { name: "Create task" })[1]);

    await waitFor(() => {
      expect(screen.getByText("Failed to create task. invalid task status")).toBeTruthy();
    });
  });

  it("hides internal task-create errors behind generic message", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([{ id: "p-1", name: "Alpha", key: "ALP", repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }] }]);
      if (command === "get_project") {
        return Promise.resolve({
          id: "p-1",
          name: "Alpha",
          key: "ALP",
          repositories: [{ id: "r-1", name: "Main", path: "/repo/main", is_default: true }],
        });
      }
      if (command === "list_project_tasks") return Promise.resolve([]);
      if (command === "create_task") return Promise.reject("database error: constraint failed");
      return Promise.resolve(null);
    });

    renderAt("/projects/p-1");

    await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    await fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Created task" } });
    await fireEvent.click(screen.getAllByRole("button", { name: "Create task" })[1]);

    await waitFor(() => {
      expect(screen.getByText("Failed to create task. Please try again.")).toBeTruthy();
    });
  });
});
