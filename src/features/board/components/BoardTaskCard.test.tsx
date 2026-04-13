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
                    identityLabel: "RUN-2",
                    label: "Waiting for Input",
                    state: "waiting_for_input",
                    status: "idle",
                    statusLabel: "Idle",
                    agentLabel: "Planner",
                    modelLabel: "GPT-5",
                    isNavigable: true,
                  },
                  {
                    runId: "run-1",
                    identityLabel: "RUN-1",
                    label: "Busy Coding",
                    state: "busy_coding",
                    status: "in_progress",
                    statusLabel: "In Progress",
                    agentLabel: "Builder",
                    modelLabel: "Claude Sonnet 4",
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

  it("renders question pending mini-card state with question mark icon", () => {
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
                    runId: "run-1",
                    identityLabel: "RUN-1",
                    label: "Question Pending",
                    state: "question_pending",
                    status: "idle",
                    statusLabel: "Idle",
                    agentLabel: "Planner",
                    modelLabel: "GPT-5",
                    isNavigable: true,
                  },
                ]}
              />
            </ul>
          )}
        />
      </Router>
    ));

    expect(screen.getByText("Question Pending")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("renders run identity, status, agent, and model separately from state", () => {
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
                    runId: "run-1",
                    identityLabel: "RUN-42",
                    label: "Waiting for Input",
                    state: "waiting_for_input",
                    status: "idle",
                    statusLabel: "Idle",
                    agentLabel: "Planner",
                    modelLabel: "GPT-5",
                    isNavigable: true,
                  },
                ]}
              />
            </ul>
          )}
        />
      </Router>
    ));

    expect(screen.getByText("RUN-42")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.getByText("GPT-5")).toBeTruthy();
    expect(screen.getByText("Waiting for Input")).toBeTruthy();
    expect(screen.queryByText("Run Details")).toBeNull();
  });
});
