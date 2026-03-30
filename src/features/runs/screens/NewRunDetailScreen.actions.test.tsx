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
  default: (props: { isSideBySide: boolean }) => (
    <div>
      <span>diff panel</span>
      <span data-testid="review-layout-mode">
        {props.isSideBySide ? "side-by-side" : "unified"}
      </span>
    </div>
  ),
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
  reviewPlan?: {
    message: string;
    submittedCommentIds: string[];
    eligibleCount: number;
    ineligibleCount: number;
    fileCount: number;
    isSubmittable: boolean;
    blockedReason: string;
  };
}) => {
  const [diffPaths, setDiffPaths] = createSignal(options?.diffPaths ?? []);
  const [agentEvents, setAgentEvents] = createSignal(
    options?.agentEvents ?? [],
  );
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(
    options?.isSubmittingPrompt ?? false,
  );

  const refreshStatus = vi.fn(async () => undefined);
  const removeDraftComments = vi.fn();
  const defaultReviewPlan = {
    message: "",
    submittedCommentIds: [],
    eligibleCount: 0,
    ineligibleCount: 0,
    fileCount: 0,
    isSubmittable: false,
    blockedReason:
      "Add at least one trusted draft comment on modified lines to submit review.",
  };

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
        agentEvents().map((event) => ({
          runId: event.runId ?? "run-1",
          ts: event.ts ?? null,
          event: event.event ?? "unknown",
          data: event.data ?? null,
        })),
      submitError: () => "",
      isSubmittingPrompt,
      submitPrompt: async (value: string, options?: unknown) => {
        setIsSubmittingPrompt(true);
        const accepted = await submitPromptMock(value, options);
        setIsSubmittingPrompt(false);
        return accepted;
      },
    },
    review: {
      getDraftReviewSubmissionPlan: () =>
        options?.reviewPlan ?? defaultReviewPlan,
      removeDraftComments,
      getDraftCommentsNeedingAttention: () => [],
      getDraftCommentsForFile: () => [],
      upsertDraftComment: vi.fn(),
      removeDraftComment: vi.fn(),
      validateDraftAnchorsForFile: vi.fn(),
    },
    __setAgentEvents: setAgentEvents,
    __removeDraftComments: removeDraftComments,
  } as unknown as ReturnType<
    typeof import("../model/useRunDetailModel").useRunDetailModel
  > & {
    git: { refreshStatus: ReturnType<typeof vi.fn> };
    __removeDraftComments: ReturnType<typeof vi.fn>;
    __setAgentEvents: (
      next:
        | Array<{
            runId?: string;
            ts?: string | number | null;
            event?: string;
            data?: unknown;
          }>
        | ((
            previous: Array<{
              runId?: string;
              ts?: string | number | null;
              event?: string;
              data?: unknown;
            }>,
          ) =>
            | Array<{
                runId?: string;
                ts?: string | number | null;
                event?: string;
                data?: unknown;
              }>
            | undefined),
    ) => void;
  };
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
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- `src/foo.ts`",
      );
      expect((textarea as HTMLTextAreaElement).value).toContain(
        "- `src/bar.ts`",
      );
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

  it("submits review through chat pipeline and clears submitted drafts on success", async () => {
    submitPromptMock.mockResolvedValue(true);
    const model = createModelStub({
      reviewPlan: {
        message:
          "# Review: Requested changes\n\nSummary: 2 comments across 1 file.",
        submittedCommentIds: ["draft-1", "draft-2"],
        eligibleCount: 2,
        ineligibleCount: 0,
        fileCount: 1,
        isSubmittable: true,
        blockedReason: "",
      },
    });
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit review" }),
    );

    await waitFor(() => {
      expect(submitPromptMock).toHaveBeenCalledWith(
        "# Review: Requested changes\n\nSummary: 2 comments across 1 file.",
        undefined,
      );
      expect(model.__removeDraftComments).toHaveBeenCalledWith([
        "draft-1",
        "draft-2",
      ]);
      expect(screen.queryByText("diff panel")).toBeNull();
    });

    topbar.cleanup();
  });

  it("defaults review layout to unified in normal drawer and side-by-side when maximized", async () => {
    modelFactoryMock.mockReturnValue(createModelStub());
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Unified diff layout" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getByTestId("review-layout-mode").textContent).toBe(
        "unified",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Maximize panel" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Side-by-side diff layout" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getByTestId("review-layout-mode").textContent).toBe(
        "side-by-side",
      );
    });

    topbar.cleanup();
  });

  it("preserves manual review layout toggle after defaults are applied", async () => {
    modelFactoryMock.mockReturnValue(createModelStub());
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");

    fireEvent.click(
      await screen.findByRole("button", { name: "Side-by-side diff layout" }),
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Side-by-side diff layout" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getByTestId("review-layout-mode").textContent).toBe(
        "side-by-side",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Maximize panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore panel" }));

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Side-by-side diff layout" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getByTestId("review-layout-mode").textContent).toBe(
        "side-by-side",
      );
    });

    topbar.cleanup();
  });

  it("keeps review drawer open and preserves drafts when review submission fails", async () => {
    submitPromptMock.mockResolvedValue(false);
    const model = createModelStub({
      reviewPlan: {
        message: "Review payload",
        submittedCommentIds: ["draft-1"],
        eligibleCount: 1,
        ineligibleCount: 0,
        fileCount: 1,
        isSubmittable: true,
        blockedReason: "",
      },
    });
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit review" }),
    );

    await waitFor(() => {
      expect(submitPromptMock).toHaveBeenCalledWith(
        "Review payload",
        undefined,
      );
      expect(model.__removeDraftComments).not.toHaveBeenCalled();
      expect(screen.getByText("diff panel")).toBeTruthy();
    });

    topbar.cleanup();
  });

  it("disables submit review for ineligible drafts without showing helper banner", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        reviewPlan: {
          message: "",
          submittedCommentIds: [],
          eligibleCount: 1,
          ineligibleCount: 1,
          fileCount: 1,
          isSubmittable: false,
          blockedReason:
            "Resolve or remove 1 draft comment that cannot be submitted yet.",
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Submit review" });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute("title")).toBe(
        "Resolve or remove 1 draft comment that cannot be submitted yet.",
      );
      expect(
        screen.queryByText(
          "Resolve or remove 1 draft comment that cannot be submitted yet.",
        ),
      ).toBeNull();
    });

    topbar.cleanup();
  });

  it("hides submit review action when no draft comments exist", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        reviewPlan: {
          message: "",
          submittedCommentIds: [],
          eligibleCount: 0,
          ineligibleCount: 0,
          fileCount: 0,
          isSubmittable: false,
          blockedReason:
            "Add at least one trusted draft comment on modified lines to submit review.",
        },
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);

    await topbar.invokeAction("Review");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Submit review" }),
      ).toBeNull();
      expect(
        screen.queryByText(
          "Add at least one trusted draft comment on modified lines to submit review.",
        ),
      ).toBeNull();
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
      expect(screen.getByRole("heading", { name: "Agent Logs" })).toBeTruthy();
      const idleLine = screen.getByText(/session\.idle/);
      const regularMessageLine = screen.getAllByText(/message\.updated/)[1];
      const completedRows = document.querySelectorAll(
        ".run-chat-log-stream__line--completed",
      );

      expect(
        idleLine.closest(".run-chat-log-stream__line")?.className,
      ).toContain("run-chat-log-stream__line--completed");
      expect(completedRows.length).toBe(2);
      expect(
        regularMessageLine.closest(".run-chat-log-stream__line")?.className,
      ).not.toContain("run-chat-log-stream__line--completed");
    });
    topbar.cleanup();
  });

  it("keeps all rows visible while highlighting search matches", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agentEvents: [
          {
            ts: "2026-01-01T15:31:20.570Z",
            event: "tool.started",
            data: "Compile project",
          },
          {
            ts: "2026-01-01T15:31:21.120Z",
            event: "tool.output",
            data: "Build failed due to lint error",
          },
        ],
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    const searchInput = await screen.findByPlaceholderText("Find in logs");
    fireEvent.input(searchInput, { target: { value: "failed" } });

    await waitFor(() => {
      expect(screen.getByText(/Compile project/i)).toBeTruthy();
      const matchingText = screen.getByText(/Build failed due to lint error/i);
      expect(matchingText).toBeTruthy();

      const allRows = document.querySelectorAll(".run-chat-log-stream__line");
      expect(allRows.length).toBe(2);
      expect(
        matchingText.closest(".run-chat-log-stream__line")?.className,
      ).toContain("run-chat-log-stream__line--match");
    });

    topbar.cleanup();
  });

  it("shows jump to latest when user scrolls away from bottom", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agentEvents: [
          {
            ts: "2026-01-01T15:31:20.570Z",
            event: "tool.started",
            data: "Compile project",
          },
          {
            ts: "2026-01-01T15:31:21.120Z",
            event: "tool.output",
            data: "Line A",
          },
          {
            ts: "2026-01-01T15:31:22.120Z",
            event: "tool.output",
            data: "Line B",
          },
        ],
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    const stream = await screen.findByRole("log");
    Object.defineProperty(stream, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(stream, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(stream, "scrollTop", {
      value: 50,
      writable: true,
      configurable: true,
    });

    fireEvent.scroll(stream);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Jump to latest" }),
      ).toBeTruthy();
    });

    topbar.cleanup();
  });

  it("keeps viewport stable when new logs arrive during manual inspection", async () => {
    const model = createModelStub({
      agentEvents: Array.from({ length: 140 }, (_, index) => ({
        ts: `2026-01-01T15:35:${String(index % 60).padStart(2, "0")}.000Z`,
        event: "tool.output",
        data: `Inspect line ${index}`,
      })),
    });
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    const stream = await screen.findByRole("log");
    let scrollTopValue = 50;
    let scrollToCalls = 0;
    Object.defineProperty(stream, "scrollHeight", {
      value: 2_400,
      configurable: true,
    });
    Object.defineProperty(stream, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(stream, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(stream, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollToCalls += 1;
        scrollTopValue = top;
      },
    });

    fireEvent.scroll(stream);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Jump to latest" }),
      ).toBeTruthy();
    });

    scrollToCalls = 0;
    scrollTopValue = 50;

    model.__setAgentEvents((previous) => [
      ...(previous ?? []),
      {
        ts: "2026-01-01T15:36:40.000Z",
        event: "tool.output",
        data: "Inspect line 140",
      },
    ]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Jump to latest" }),
      ).toBeTruthy();
      expect(scrollTopValue).toBe(50);
      expect(scrollToCalls).toBe(0);
    });

    topbar.cleanup();
  });

  it("removes new-row highlight after about one second", async () => {
    const model = createModelStub({
      agentEvents: [
        {
          ts: "2026-01-01T15:31:20.570Z",
          event: "tool.output",
          data: "Line 1",
        },
      ],
    });
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    model.__setAgentEvents((previous) => [
      ...(previous ?? []),
      {
        ts: "2026-01-01T15:31:21.570Z",
        event: "tool.output",
        data: "Line 2",
      },
    ]);

    await waitFor(() => {
      const newestLine = screen
        .getByText("Line 2")
        .closest(".run-chat-log-stream__line");
      expect(newestLine?.className).toContain("run-chat-log-stream__line--new");
    });

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(
      screen.getByText("Line 2").closest(".run-chat-log-stream__line")
        ?.className,
    ).toContain("run-chat-log-stream__line--new");

    await new Promise((resolve) => setTimeout(resolve, 250));

    await waitFor(() => {
      expect(
        screen.getByText("Line 2").closest(".run-chat-log-stream__line")
          ?.className,
      ).not.toContain("run-chat-log-stream__line--new");
    });

    topbar.cleanup();
  });

  it("mounts only the latest window by default and prepends older chunks on upward scroll", async () => {
    modelFactoryMock.mockReturnValue(
      createModelStub({
        agentEvents: Array.from({ length: 250 }, (_, index) => ({
          ts: `2026-01-01T15:31:${String(index % 60).padStart(2, "0")}.000Z`,
          event: "tool.output",
          data: `Line ${index}`,
        })),
      }),
    );
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    const stream = await screen.findByRole("log");
    let scrollTopValue = 0;
    Object.defineProperty(stream, "scrollHeight", {
      configurable: true,
      get: () =>
        document.querySelectorAll(".run-chat-log-stream__line").length * 24,
    });
    Object.defineProperty(stream, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(stream, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(stream, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollTopValue = top;
      },
    });

    await waitFor(() => {
      expect(
        document.querySelectorAll(".run-chat-log-stream__line").length,
      ).toBe(100);
      expect(screen.getByText("Line 249")).toBeTruthy();
      expect(screen.getByText("Line 150")).toBeTruthy();
      expect(screen.queryByText("Line 149")).toBeNull();
    });

    scrollTopValue = 0;
    fireEvent.scroll(stream);

    await waitFor(() => {
      expect(
        document.querySelectorAll(".run-chat-log-stream__line").length,
      ).toBe(200);
      expect(screen.getByText("Line 50")).toBeTruthy();
      expect(screen.queryByText("Line 49")).toBeNull();
      expect(scrollTopValue).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: "Jump to latest" }),
      ).toBeTruthy();
    });

    topbar.cleanup();
  });

  it("keeps rendered rows bounded to the latest window while following live logs", async () => {
    const model = createModelStub({
      agentEvents: Array.from({ length: 120 }, (_, index) => ({
        ts: `2026-01-01T15:32:${String(index % 60).padStart(2, "0")}.000Z`,
        event: "tool.output",
        data: `Stream line ${index}`,
      })),
    });
    modelFactoryMock.mockReturnValue(model);
    const topbar = bindRunTopbarActions();

    render(() => <NewRunDetailScreen />);
    await topbar.invokeAction("Logs");

    await waitFor(() => {
      expect(
        document.querySelectorAll(".run-chat-log-stream__line").length,
      ).toBe(100);
      expect(screen.queryByText("Stream line 19")).toBeNull();
      expect(screen.getByText("Stream line 20")).toBeTruthy();
      expect(screen.getByText("Stream line 119")).toBeTruthy();
    });

    model.__setAgentEvents([
      ...Array.from({ length: 120 }, (_, index) => ({
        ts: `2026-01-01T15:32:${String(index % 60).padStart(2, "0")}.000Z`,
        event: "tool.output",
        data: `Stream line ${index}`,
      })),
      {
        ts: "2026-01-01T15:33:00.000Z",
        event: "tool.output",
        data: "Stream line 120",
      },
    ]);

    await waitFor(() => {
      expect(
        document.querySelectorAll(".run-chat-log-stream__line").length,
      ).toBe(100);
      expect(screen.queryByText("Stream line 20")).toBeNull();
      expect(screen.getByText("Stream line 21")).toBeTruthy();
      expect(screen.getByText("Stream line 120")).toBeTruthy();
    });

    topbar.cleanup();
  });
});
