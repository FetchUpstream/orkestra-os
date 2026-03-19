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
}) => {
  const [diffPaths, setDiffPaths] = createSignal(options?.diffPaths ?? []);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(
    options?.isSubmittingPrompt ?? false,
  );

  return {
    error: () => "",
    isLoading: () => false,
    run: () => ({ id: "run-1", status: "running" }),
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
      error: () => "",
      state: () => "running",
      events: () => [],
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
  >;
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

  it("opens commit modal with editable prefill and submits through submitPrompt", async () => {
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
});
