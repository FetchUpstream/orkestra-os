import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewRunDetailScreen from "./NewRunDetailScreen";

const submitPromptMock = vi.fn<(value: string) => Promise<boolean>>();
const modelFactoryMock = vi.fn();

vi.mock("../../../components/ui/BackIconLink", () => ({
  default: () => <a href="/">Back</a>,
}));

vi.mock("../components/NewRunChatWorkspace", () => ({
  default: () => <div>workspace</div>,
}));

vi.mock("../components/RunDiffDrawerPanel", () => ({
  default: () => <div>diff panel</div>,
}));

vi.mock("../components/RunTerminal", () => ({
  default: () => <div>terminal</div>,
}));

vi.mock("../model/useRunDetailModel", () => ({
  useRunDetailModel: () => modelFactoryMock(),
}));

const createModelStub = (options?: {
  run?: {
    id?: string;
    displayKey?: string | null;
    runNumber?: number | null;
    taskTitle?: string | null;
    status?:
      | "queued"
      | "preparing"
      | "running"
      | "completed"
      | "failed"
      | "cancelled";
  };
  task?: {
    title?: string | null;
  };
  gitStatus?: {
    state?: string;
    rawState?: string;
    sourceBranch?: { name: string; ahead: number; behind: number };
    worktreeBranch?: { name: string; ahead: number; behind: number };
    isRebaseAllowed?: boolean;
    isMergeAllowed?: boolean;
    requiresRebase?: boolean;
    isWorktreeClean?: boolean | null;
  };
  diffPaths?: string[];
  refreshedDiffPaths?: string[];
  isSubmittingPrompt?: boolean;
  agent?: {
    state?:
      | "idle"
      | "accepted"
      | "starting"
      | "running"
      | "unsupported"
      | "error";
    readinessPhase?:
      | "warming_backend"
      | "creating_session"
      | "ready"
      | "reconnecting"
      | "submit_failed"
      | null;
    storeStatus?: "connecting" | "idle" | "active" | "error";
    streamConnected?: boolean;
    error?: string;
  };
  agentEvents?: Array<{
    runId?: string;
    ts?: string | number | null;
    event?: string;
    data?: unknown;
  }>;
}) => {
  const [diffPaths, setDiffPaths] = createSignal(options?.diffPaths ?? []);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(
    options?.isSubmittingPrompt ?? false,
  );

  const refreshStatus = vi.fn(async () => undefined);

  return {
    error: () => "",
    isLoading: () => false,
    run: () => ({
      id: options?.run?.id ?? "run-1",
      status: options?.run?.status ?? "running",
      displayKey:
        options?.run?.displayKey !== undefined ? options.run.displayKey : "123",
      runNumber:
        options?.run?.runNumber !== undefined ? options.run.runNumber : 123,
      taskTitle: options?.run?.taskTitle,
    }),
    task: () => ({ title: options?.task?.title ?? "Ship redesign" }),
    backHref: () => "/tasks/task-1",
    backLabel: () => "task",
    setIsDiffTabActive: vi.fn(),
    postMergeCompletionMessage: () => "",
    isRunCompleted: () => false,
    diffFiles: () =>
      diffPaths().map((path) => ({
        path,
        additions: 1,
        deletions: 0,
        status: "modified",
      })),
    isDiffFilesLoading: () => false,
    refreshDiffFiles: vi.fn(async () => {
      setDiffPaths(options?.refreshedDiffPaths ?? options?.diffPaths ?? []);
    }),
    git: {
      status: () => ({
        state: options?.gitStatus?.state ?? "clean",
        rawState: options?.gitStatus?.rawState ?? "clean",
        sourceBranch: options?.gitStatus?.sourceBranch ?? {
          name: "main",
          ahead: 0,
          behind: 0,
        },
        worktreeBranch: options?.gitStatus?.worktreeBranch ?? {
          name: "wt",
          ahead: 0,
          behind: 0,
        },
        isRebaseAllowed: options?.gitStatus?.isRebaseAllowed ?? false,
        isMergeAllowed: options?.gitStatus?.isMergeAllowed ?? false,
        requiresRebase: options?.gitStatus?.requiresRebase ?? false,
        isWorktreeClean: options?.gitStatus?.isWorktreeClean ?? null,
      }),
      isLoading: () => false,
      statusError: () => "",
      actionError: () => "",
      lastActionMessage: () => "",
      isRebasePending: () => false,
      isMergePending: () => false,
      refreshStatus,
      rebaseWorktreeOntoSource: vi.fn(async () => undefined),
      mergeWorktreeIntoSource: vi.fn(async () => undefined),
    },
    terminal: {
      isStarting: () => false,
      isReady: () => true,
      isInputEnabled: () => true,
      error: () => "",
      writeTerminal: vi.fn(async () => undefined),
      resizeTerminal: vi.fn(async () => undefined),
      setTerminalFrameHandler: vi.fn(),
    },
    agent: {
      error: () => options?.agent?.error ?? "",
      state: () => options?.agent?.state ?? "running",
      readinessPhase: () => options?.agent?.readinessPhase ?? "ready",
      store: () => ({
        status: options?.agent?.storeStatus ?? "active",
        streamConnected: options?.agent?.streamConnected ?? true,
      }),
      events: () =>
        options?.agentEvents?.map((event) => ({
          runId: event.runId ?? "run-1",
          ts: event.ts ?? null,
          event: event.event ?? "unknown",
          data: event.data ?? null,
        })) ?? [],
      submitError: () => "",
      isSubmittingPrompt,
      submitPrompt: async (value: string) => {
        setIsSubmittingPrompt(true);
        const accepted = await submitPromptMock(value);
        setIsSubmittingPrompt(false);
        return accepted;
      },
    },
  } as unknown as ReturnType<
    typeof import("../model/useRunDetailModel").useRunDetailModel
  > & { git: { refreshStatus: ReturnType<typeof vi.fn> } };
};

describe("NewRunDetailScreen git actions", () => {
  beforeEach(() => {
    submitPromptMock.mockReset();
    submitPromptMock.mockResolvedValue(true);
  });

  it("hides unavailable rebase and merge actions while showing commit when dirty", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: false,
          isMergeAllowed: false,
          requiresRebase: false,
          isWorktreeClean: false,
        },
      }),
    );

    render(() => <NewRunDetailScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(screen.queryByText("Rebase Worktree onto Source")).toBeNull();
      expect(screen.queryByText("Merge Worktree into Source")).toBeNull();
      expect(screen.getByText("Commit Changes")).toBeTruthy();
    });
  });

  it("closes commit modal and git drawer after successful submitPrompt", async () => {
    submitPromptMock.mockResolvedValue(true);
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
        diffPaths: ["src/foo.ts", "src/bar.ts"],
      }),
    );

    render(() => <NewRunDetailScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("Commit Changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "There are still uncommited changes, please attomically commit the following changes",
      );
      expect((textarea as HTMLTextAreaElement).value).toContain("- src/foo.ts");
      expect((textarea as HTMLTextAreaElement).value).toContain("- src/bar.ts");
    });

    fireEvent.input(textarea, { target: { value: "commit these files" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));

    await waitFor(() => {
      expect(submitPromptMock).toHaveBeenCalledWith("commit these files");
      expect(screen.queryByLabelText("Commit request message")).toBeNull();
      expect(screen.queryByText("Commit Changes")).toBeNull();
    });
  });

  it("keeps git drawer open when commit modal submitPrompt fails", async () => {
    submitPromptMock.mockResolvedValue(false);
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
        diffPaths: ["src/foo.ts"],
      }),
    );

    render(() => <NewRunDetailScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("Commit Changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    fireEvent.input(textarea, { target: { value: "commit these files" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));

    await waitFor(() => {
      expect(submitPromptMock).toHaveBeenCalledWith("commit these files");
      expect(screen.getByLabelText("Commit request message")).toBeTruthy();
      expect(screen.getByText("Commit Changes")).toBeTruthy();
    });
  });

  it("populates commit modal changed files from git drawer without opening review", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
        diffPaths: [],
        refreshedDiffPaths: ["src/git-only.ts", "src/another.ts"],
      }),
    );

    render(() => <NewRunDetailScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("Commit Changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- src/git-only.ts",
      );
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- src/another.ts",
      );
    });
  });

  it("hides commit action when worktree is clean", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isWorktreeClean: true,
        },
      }),
    );

    render(() => <NewRunDetailScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(screen.queryByText("Commit Changes")).toBeNull();
    });
  });

  it("hides commit action when worktree cleanliness is unknown", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isWorktreeClean: null,
        },
      }),
    );

    render(() => <NewRunDetailScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(screen.queryByText("Commit Changes")).toBeNull();
    });
  });

  it("refreshes git status and diff files when git drawer opens", async () => {
    const model = createModelStub();
    modelFactoryMock.mockReturnValue(model);

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(0);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(1);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(1);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(2);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(2);
    });
  });

  it("renders inline run title and green status indicator when ready", () => {
    modelFactoryMock.mockReturnValue(createModelStub());

    render(() => <NewRunDetailScreen />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "RUN #123 Ship redesign",
    );
    expect(screen.getByLabelText("Agent ready")).toBeTruthy();
    expect(
      screen.getByTestId("run-status-indicator").getAttribute("data-status"),
    ).toBe("green");
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("renders task title without synthetic run number fallback", () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        task: { title: "" },
        run: {
          id: "run-27",
          displayKey: "",
          runNumber: null,
          taskTitle: "Fix websocket transport",
        },
      }),
    );

    render(() => <NewRunDetailScreen />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Fix websocket transport",
    );
  });

  it("uses fallback title and red status indicator when unavailable", () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        task: { title: "" },
        run: { displayKey: "", runNumber: null, status: "failed" },
        agent: {
          state: "error",
          readinessPhase: "reconnecting",
          storeStatus: "error",
          streamConnected: false,
          error: "Backend unavailable",
        },
      }),
    );

    render(() => <NewRunDetailScreen />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Current task",
    );
    expect(screen.getByLabelText("Agent unavailable")).toBeTruthy();
    expect(
      screen.getByTestId("run-status-indicator").getAttribute("data-status"),
    ).toBe("red");
  });

  it("renders orange status indicator for warming and connecting state", () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agent: {
          state: "starting",
          readinessPhase: "warming_backend",
          storeStatus: "connecting",
          streamConnected: false,
          error: "",
        },
        run: { status: "running" },
      }),
    );

    render(() => <NewRunDetailScreen />);

    expect(screen.getByLabelText("Agent connecting")).toBeTruthy();
    expect(
      screen.getByTestId("run-status-indicator").getAttribute("data-status"),
    ).toBe("orange");
    expect(screen.getByText("~")).toBeTruthy();
  });

  it("prioritizes red over orange and green status signals", () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agent: {
          state: "running",
          readinessPhase: "ready",
          storeStatus: "error",
          streamConnected: true,
          error: "",
        },
        run: { status: "running" },
      }),
    );

    render(() => <NewRunDetailScreen />);

    expect(screen.getByLabelText("Agent unavailable")).toBeTruthy();
    expect(
      screen.getByTestId("run-status-indicator").getAttribute("data-status"),
    ).toBe("red");
    expect(screen.getByText("!")).toBeTruthy();
  });

  it("renders session.idle and completed message.updated logs with completed styling", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agentEvents: [
          {
            event: "session.idle",
            data: { sessionID: "session-1" },
          },
          {
            event: "message.updated",
            data: {
              info: {
                id: "msg-1",
                sessionID: "session-1",
                time: { completed: "2026-01-01T00:00:00.000Z" },
              },
            },
          },
          {
            event: "message.updated",
            data: {
              info: {
                id: "msg-2",
                sessionID: "session-1",
              },
            },
          },
        ],
      }),
    );

    render(() => <NewRunDetailScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));

    await waitFor(() => {
      const idleLine = screen.getByText(/session\.idle/);
      const completedMessageLine = screen.getByText(
        /message\.updated.*completed/i,
      );
      const regularMessageLine = screen.getAllByText(/message\.updated/)[1];

      expect(idleLine.className).toContain(
        "run-chat-log-stream__line--completed",
      );
      expect(completedMessageLine.className).toContain(
        "run-chat-log-stream__line--completed",
      );
      expect(regularMessageLine.className).not.toContain(
        "run-chat-log-stream__line--completed",
      );
    });
  });
});
