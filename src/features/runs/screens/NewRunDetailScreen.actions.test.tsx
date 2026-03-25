import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewRunDetailScreen from "./NewRunDetailScreen";

const submitPromptMock =
  vi.fn<(value: string, options?: unknown) => Promise<boolean>>();
const modelFactoryMock = vi.fn();

const bindRunTopbarActions = () => {
  let latestConfig:
    | {
        actions?: Array<{ label: string; onClick: () => void }>;
      }
    | undefined;

  const onConfig = (event: Event) => {
    latestConfig = (event as CustomEvent).detail;
  };

  window.addEventListener("run-detail:topbar-config", onConfig);

  return {
    invokeAction: async (label: string) => {
      await waitFor(() => {
        const action = latestConfig?.actions?.find(
          (item) => item.label === label,
        );
        expect(action).toBeTruthy();
      });
      latestConfig?.actions?.find((item) => item.label === label)?.onClick();
    },
    cleanup: () =>
      window.removeEventListener("run-detail:topbar-config", onConfig),
  };
};

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
    chatMode?: "interactive" | "read_only" | "unavailable";
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
  gitActionError?: string;
  gitLastActionMessage?: string;
  postMergeCompletionMessage?: string;
  isRunCompleted?: boolean;
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
    postMergeCompletionMessage: () => options?.postMergeCompletionMessage ?? "",
    isRunCompleted: () => options?.isRunCompleted ?? false,
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
      actionError: () => options?.gitActionError ?? "",
      lastActionMessage: () => options?.gitLastActionMessage ?? "",
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
      chatMode: () => options?.agent?.chatMode ?? "interactive",
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
      submitPrompt: async (value: string, options?: unknown) => {
        setIsSubmittingPrompt(true);
        const accepted = await submitPromptMock(value, options);
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
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(screen.queryByText("Rebase onto main")).toBeNull();
      expect(screen.queryByText("Merge into main")).toBeNull();
      expect(screen.getByText("Commit changes")).toBeTruthy();
    });
    topbar.cleanup();
  });

  it("shows Source Control title and compact signed branch sync", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          sourceBranch: { name: "main", ahead: 0, behind: 1 },
          worktreeBranch: { name: "feature/redesign", ahead: 2, behind: 0 },
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Source Control" }),
      ).toBeTruthy();
      expect(screen.getByText("Source")).toBeTruthy();
      expect(screen.getByText("Current")).toBeTruthy();
      expect(screen.getByText("Repository status")).toBeTruthy();
      expect(screen.getByText("Working tree status")).toBeTruthy();
      expect(screen.getByText("+0")).toBeTruthy();
      expect(screen.getByText("-1")).toBeTruthy();
      expect(screen.getByText("+2")).toBeTruthy();
      expect(screen.getByText("-0")).toBeTruthy();
      expect(
        screen.queryByText(
          "Ahead/behind counts show committed branch sync. Working tree status covers local edits.",
        ),
      ).toBeNull();
    });
    topbar.cleanup();
  });

  it("shows rebase as the only primary action when required", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          sourceBranch: { name: "main", ahead: 0, behind: 0 },
          isWorktreeClean: true,
          requiresRebase: true,
          isRebaseAllowed: true,
          isMergeAllowed: false,
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(screen.getByText("Rebase onto main")).toBeTruthy();
      expect(screen.queryByText("Commit changes")).toBeNull();
      expect(screen.queryByText("Merge into main")).toBeNull();
    });
    topbar.cleanup();
  });

  it("hides primary action and shows completion state after merge", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          state: "merged",
          isWorktreeClean: false,
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
        },
        postMergeCompletionMessage: "Merge completed. Returning to board...",
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      const completedIndicator = screen.getByText("MERGED");
      expect(completedIndicator).toBeTruthy();
      expect(completedIndicator.className).toContain(
        "run-chat-git-drawer__button--success",
      );
      expect(screen.queryByText("Commit changes")).toBeNull();
      expect(screen.queryByText("Rebase onto main")).toBeNull();
      expect(screen.queryByText("Merge into main")).toBeNull();
    });
    topbar.cleanup();
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
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Git");
    fireEvent.click(await screen.findByText("Commit changes"));

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
      expect(submitPromptMock).toHaveBeenCalledWith("commit these files", {
        markCommitPending: true,
      });
      expect(screen.queryByLabelText("Commit request message")).toBeNull();
      expect(screen.queryByText("Commit changes")).toBeNull();
    });
    topbar.cleanup();
  });

  it("shows committing changes while commit request is in flight", async () => {
    let resolveSubmit: ((value: boolean) => void) | undefined;
    submitPromptMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Git");
    fireEvent.click(await screen.findByText("Commit changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    fireEvent.input(textarea, { target: { value: "commit these files" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Committing changes" }),
      ).toBeTruthy();
    });

    resolveSubmit?.(true);
    topbar.cleanup();
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
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Git");
    fireEvent.click(await screen.findByText("Commit changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    fireEvent.input(textarea, { target: { value: "commit these files" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));

    await waitFor(() => {
      expect(submitPromptMock).toHaveBeenCalledWith("commit these files", {
        markCommitPending: true,
      });
      expect(screen.getByLabelText("Commit request message")).toBeTruthy();
      expect(screen.getByText("Commit changes")).toBeTruthy();
    });
    topbar.cleanup();
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
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Git");
    fireEvent.click(await screen.findByText("Commit changes"));

    const textarea = await screen.findByLabelText("Commit request message");
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- src/git-only.ts",
      );
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- src/another.ts",
      );
    });
    topbar.cleanup();
  });

  it("hides commit action when worktree is clean", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isWorktreeClean: true,
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(screen.queryByText("Commit changes")).toBeNull();
    });
    topbar.cleanup();
  });

  it("hides commit action when worktree cleanliness is unknown", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isWorktreeClean: null,
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(screen.queryByText("Commit changes")).toBeNull();
    });
    topbar.cleanup();
  });

  it("refreshes git status and diff files when git drawer opens", async () => {
    const model = createModelStub();
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(0);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(0);
    });

    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(1);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(1);
    });

    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(1);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(1);
    });

    await topbar.invokeAction("Git");

    await waitFor(() => {
      expect(model.git.refreshStatus).toHaveBeenCalledTimes(2);
      expect(model.refreshDiffFiles).toHaveBeenCalledTimes(2);
    });
    topbar.cleanup();
  });

  it("renders backend state guidance as non-error text", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
        gitLastActionMessage: "Rebase/merge backend state: mergeable.",
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      const message = screen.getByText(
        "Rebase/merge backend state: mergeable.",
      );
      expect(message.className).toContain("project-placeholder-text");
      expect(message.className).not.toContain("projects-error");
    });
    topbar.cleanup();
  });

  it("renders real failed messages as error text even with merged/completed words", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        gitStatus: {
          isRebaseAllowed: true,
          isMergeAllowed: true,
          requiresRebase: false,
          isWorktreeClean: false,
        },
        gitActionError:
          "Rebase failed after merged checks completed with unresolved conflicts.",
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Git");

    await waitFor(() => {
      const message = screen.getByText(
        "Rebase failed after merged checks completed with unresolved conflicts.",
      );
      expect(message.className).toContain("projects-error");
    });
    topbar.cleanup();
  });

  it("dispatches run topbar config with task title and workspace subtitle", async () => {
    modelFactoryMock.mockReturnValue(createModelStub());

    const topbarEvents: CustomEvent[] = [];
    const onTopbarConfig = (event: Event) => {
      topbarEvents.push(event as CustomEvent);
    };
    window.addEventListener("run-detail:topbar-config", onTopbarConfig);

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      expect(topbarEvents.length).toBeGreaterThan(0);
      const payload = topbarEvents[topbarEvents.length - 1]?.detail as {
        title: string;
        subtitle: string;
      };
      expect(payload.title).toBe("Ship redesign");
      expect(payload.subtitle).toBe("Run workspace");
    });

    window.removeEventListener("run-detail:topbar-config", onTopbarConfig);
  });

  it("renders task title without synthetic run number fallback", async () => {
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

    const topbarEvents: CustomEvent[] = [];
    const onTopbarConfig = (event: Event) => {
      topbarEvents.push(event as CustomEvent);
    };
    window.addEventListener("run-detail:topbar-config", onTopbarConfig);

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      const payload = topbarEvents[topbarEvents.length - 1]?.detail as {
        title: string;
      };
      expect(payload.title).toBe("Fix websocket transport");
    });

    window.removeEventListener("run-detail:topbar-config", onTopbarConfig);
  });

  it("uses fallback title when task title is unavailable", async () => {
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

    const topbarEvents: CustomEvent[] = [];
    const onTopbarConfig = (event: Event) => {
      topbarEvents.push(event as CustomEvent);
    };
    window.addEventListener("run-detail:topbar-config", onTopbarConfig);

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      const payload = topbarEvents[topbarEvents.length - 1]?.detail as {
        title: string;
      };
      expect(payload.title).toBe("Current task");
    });

    window.removeEventListener("run-detail:topbar-config", onTopbarConfig);
  });

  it("still renders run workspace content when warming and connecting", () => {
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

    expect(screen.getByText("workspace")).toBeTruthy();
  });

  it("hides Logs topbar action in read-only chat mode", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        run: { status: "completed" },
        agent: { chatMode: "read_only" },
      }),
    );

    const topbarEvents: CustomEvent[] = [];
    const onTopbarConfig = (event: Event) => {
      topbarEvents.push(event as CustomEvent);
    };
    window.addEventListener("run-detail:topbar-config", onTopbarConfig);

    render(() => <NewRunDetailScreen />);

    await waitFor(() => {
      const payload = topbarEvents[topbarEvents.length - 1]?.detail as {
        actions: Array<{ label: string }>;
      };
      expect(payload.actions.some((action) => action.label === "Logs")).toBe(
        false,
      );
    });

    window.removeEventListener("run-detail:topbar-config", onTopbarConfig);
  });

  it("still renders run workspace content when agent store reports error", () => {
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

    expect(screen.getByText("workspace")).toBeTruthy();
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
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

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
    topbar.cleanup();
  });
});
