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
      if (command === "list_projects") return Promise.resolve([{ id: "p-1", name: "Alpha", key: "ALP", repositories: [] }]);
      if (command === "get_project") return Promise.resolve({ id: "p-1", name: "Alpha", key: "ALP", repositories: [] });
      if (command === "create_project") return Promise.resolve({ id: "p-2", name: "Beta", key: "BET", repositories: [] });
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
      expect(screen.getByText("Existing projects")).toBeTruthy();
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
    await fireEvent.click(screen.getByRole("button", { name: "Add repo" }));
    await fireEvent.input(screen.getAllByPlaceholderText("Repository path")[1], {
      target: { value: "/repo/two" },
    });

    await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByText("Select exactly one default repository.")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith("create_project", expect.anything());
  });
});
