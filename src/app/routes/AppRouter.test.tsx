import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import AppRouter from "../../router";

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(() => <AppRouter />);
};

describe("app routing and shell", () => {
  it("renders expected sidebar links", () => {
    renderAt("/board");

    const links = ["/board", "/agents", "/worktrees", "/reviews", "/settings"];
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
});
