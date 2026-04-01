// @vitest-environment jsdom

import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "@solidjs/router";
import BoardTaskCard from "./BoardTaskCard";

describe("BoardTaskCard", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/board");
  });

  it("starts task drag from a run mini-card link", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();

    render(() => (
      <Router>
        <Route
          path="/board"
          component={() => (
            <ul>
              <BoardTaskCard
                task={{
                  id: "task-1",
                  title: "Task with runs",
                  status: "review",
                  projectId: "project-1",
                }}
                project={{
                  id: "project-1",
                  name: "Project",
                  key: "PRJ",
                  repositories: [],
                }}
                runMiniCards={[
                  {
                    runId: "run-2",
                    label: "Waiting for Input",
                    state: "waiting_for_input",
                    isNavigable: true,
                  },
                  {
                    runId: "run-1",
                    label: "Busy Coding",
                    state: "busy_coding",
                    isNavigable: true,
                  },
                ]}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </ul>
          )}
        />
      </Router>
    ));

    const runLinks = screen.getAllByRole("link", { name: "Run Details" });
    expect(runLinks).toHaveLength(2);
    expect(runLinks[0]?.getAttribute("draggable")).toBe("true");

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

    await fireEvent.dragStart(runLinks[0], { dataTransfer });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledWith("task-1", expect.any(Object));

    await fireEvent.dragEnd(runLinks[0]);

    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
