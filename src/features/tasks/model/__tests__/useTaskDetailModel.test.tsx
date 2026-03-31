import { render, waitFor } from "@solidjs/testing-library";
import { createMutable } from "solid-js/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskDetailModel } from "../useTaskDetailModel";

const paramsState = createMutable({ projectId: "project-1", taskId: "task-1" });

const {
  navigateMock,
  getProjectMock,
  getTaskMock,
  listTaskRunsMock,
  startRunOpenCodeMock,
  createRunMock,
  listTaskDependenciesMock,
  getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCacheMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getProjectMock: vi.fn(),
  getTaskMock: vi.fn(),
  listTaskRunsMock: vi.fn(),
  startRunOpenCodeMock: vi.fn(),
  createRunMock: vi.fn(),
  listTaskDependenciesMock: vi.fn(),
  getRunSelectionOptionsWithCacheMock: vi.fn(),
  readRunSelectionOptionsCacheMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
  useLocation: () => ({ search: "" }),
}));

vi.mock("../../../../app/lib/projects", () => ({
  getProject: getProjectMock,
}));

vi.mock("../../../../app/lib/tasks", () => ({
  getTask: getTaskMock,
  listTaskDependencies: listTaskDependenciesMock,
  listProjectTasks: vi.fn(async () => []),
  createTask: vi.fn(),
  addTaskDependency: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
  removeTaskDependency: vi.fn(),
  setTaskStatus: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("../../../../app/lib/runs", () => ({
  createRun: createRunMock,
  deleteRun: vi.fn(),
  listTaskRuns: listTaskRunsMock,
  startRunOpenCode: startRunOpenCodeMock,
}));

vi.mock("../../../../app/lib/runSelectionOptionsCache", () => ({
  getRunSelectionOptionsWithCache: getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCache: readRunSelectionOptionsCacheMock,
}));

vi.mock("../../../../app/contexts/OpenCodeDependencyContext", () => ({
  useOpenCodeDependency: () => ({
    state: () => "available",
    reason: () => "",
    isModalVisible: () => false,
    refresh: vi.fn(async () => "available"),
    ensureAvailableForRequiredFlow: vi.fn(async () => true),
    showRequiredModal: vi.fn(),
  }),
}));

describe("useTaskDetailModel start run", () => {
  beforeEach(() => {
    paramsState.projectId = "project-1";
    paramsState.taskId = "task-1";
    navigateMock.mockReset();
    getTaskMock.mockReset();
    getProjectMock.mockReset();
    listTaskRunsMock.mockReset();
    startRunOpenCodeMock.mockReset();
    createRunMock.mockReset();
    listTaskDependenciesMock.mockReset();
    getRunSelectionOptionsWithCacheMock.mockReset();
    readRunSelectionOptionsCacheMock.mockReset();

    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "todo",
      isBlocked: false,
      blockedByCount: 0,
    });
    listTaskDependenciesMock.mockResolvedValue({ parents: [], children: [] });
    getProjectMock.mockResolvedValue({
      name: "Project",
      key: "PRJ",
      repositories: [],
    });
    listTaskRunsMock.mockResolvedValue([
      {
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        status: "queued",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "run-2",
        taskId: "task-1",
        projectId: "project-1",
        status: "queued",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    startRunOpenCodeMock.mockResolvedValue({
      state: "running",
      queuedAt: "2026-01-01T00:00:01.000Z",
      clientRequestId: "initial-run-message:run-1",
      readyPhase: "warm_handle",
    });
    readRunSelectionOptionsCacheMock.mockReturnValue(null);
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });
  });

  it("starts run from task detail without navigation", async () => {
    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.runs().length).toBe(2);
    });

    await ref.current?.onStartRun("run-1");
    expect(startRunOpenCodeMock).toHaveBeenCalledWith("run-1");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("creates and immediately starts run when confirming run settings", async () => {
    createRunMock.mockResolvedValue({
      id: "run-created",
      taskId: "task-1",
      projectId: "project-1",
      status: "queued",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    listTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: "run-1",
          taskId: "task-1",
          projectId: "project-1",
          status: "queued",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-created",
          taskId: "task-1",
          projectId: "project-1",
          status: "queued",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-created",
          taskId: "task-1",
          projectId: "project-1",
          status: "running",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      ]);

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onConfirmCreateRun();

    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: undefined,
      providerId: "provider-1",
      modelId: "model-1",
    });
    expect(startRunOpenCodeMock).toHaveBeenCalledWith("run-created");
  });

  it("does not attempt start when create fails on confirm", async () => {
    createRunMock.mockRejectedValue(new Error("create failed"));

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onConfirmCreateRun();

    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(startRunOpenCodeMock).not.toHaveBeenCalled();
  });

  it("keeps created run retryable when immediate start fails", async () => {
    createRunMock.mockResolvedValue({
      id: "run-created",
      taskId: "task-1",
      projectId: "project-1",
      status: "queued",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    listTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: "run-1",
          taskId: "task-1",
          projectId: "project-1",
          status: "queued",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-created",
          taskId: "task-1",
          projectId: "project-1",
          status: "queued",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-created",
          taskId: "task-1",
          projectId: "project-1",
          status: "running",
          triggeredBy: "user",
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      ]);
    startRunOpenCodeMock
      .mockRejectedValueOnce(new Error("start failed"))
      .mockResolvedValueOnce({
        state: "running",
        queuedAt: "2026-01-01T00:00:03.000Z",
        clientRequestId: "initial-run-message:run-created",
        readyPhase: "warm_handle",
      });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onConfirmCreateRun();

    await waitFor(() => {
      expect(ref.current?.runs().some((run) => run.id === "run-created")).toBe(
        true,
      );
      expect(ref.current?.runStartErrors()["run-created"]).toBe(
        "Failed to start. Try again.",
      );
    });

    await ref.current?.onStartRun("run-created");

    expect(startRunOpenCodeMock).toHaveBeenCalledTimes(2);
    expect(startRunOpenCodeMock).toHaveBeenLastCalledWith("run-created");
  });

  it("does not block task detail readiness on run option loading", async () => {
    let resolveOptions: () => void = () => {};
    getRunSelectionOptionsWithCacheMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOptions = () =>
            resolve({
              agents: [{ id: "agent-1", label: "Planner" }],
              providers: [{ id: "provider-1", label: "OpenAI" }],
              models: [
                { id: "model-1", label: "GPT-5", providerId: "provider-1" },
              ],
            });
        }),
    );

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
      expect(ref.current?.isLoading()).toBe(false);
      expect(ref.current?.isLoadingRunSelectionOptions()).toBe(true);
    });

    resolveOptions();

    await waitFor(() => {
      expect(ref.current?.isLoadingRunSelectionOptions()).toBe(false);
      expect(ref.current?.hasRunSelectionOptions()).toBe(true);
    });
  });

  it("loads run options from resolved task project before project context signal is set", async () => {
    paramsState.projectId = "";

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(getRunSelectionOptionsWithCacheMock).toHaveBeenCalledWith(
        "project-1",
      );
      expect(ref.current?.runSelectionOptionsError()).toBe("");
    });
  });

  it("uses startup-cached run options when available", async () => {
    readRunSelectionOptionsCacheMock.mockReturnValueOnce({
      agents: [{ id: "agent-cached", label: "Cached Agent" }],
      providers: [{ id: "provider-cached", label: "Cached Provider" }],
      models: [
        {
          id: "model-cached",
          label: "Cached Model",
          providerId: "provider-cached",
        },
      ],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.runProviderOptions()).toEqual([
        { id: "provider-cached", label: "Cached Provider" },
      ]);
      expect(ref.current?.isLoadingRunSelectionOptions()).toBe(false);
    });

    expect(getRunSelectionOptionsWithCacheMock).not.toHaveBeenCalled();
  });

  it("ignores stale run option responses across rapid task switches", async () => {
    getTaskMock.mockImplementation(async (taskId: string) => ({
      id: taskId,
      projectId: "project-1",
      title: `Task ${taskId}`,
      description: "Desc",
      implementationGuide: "Guide",
      status: "todo",
      isBlocked: false,
      blockedByCount: 0,
    }));

    let resolveFirstOptions: () => void = () => {};
    let resolveSecondOptions: () => void = () => {};
    getRunSelectionOptionsWithCacheMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstOptions = () =>
              resolve({
                agents: [{ id: "agent-stale", label: "Stale" }],
                providers: [{ id: "provider-stale", label: "Stale" }],
                models: [
                  {
                    id: "model-stale",
                    label: "Stale",
                    providerId: "provider-stale",
                  },
                ],
              });
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondOptions = () =>
              resolve({
                agents: [{ id: "agent-current", label: "Current" }],
                providers: [{ id: "provider-current", label: "Current" }],
                models: [
                  {
                    id: "model-current",
                    label: "Current",
                    providerId: "provider-current",
                  },
                ],
              });
          }),
      );

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()?.id).toBe("task-1");
    });

    paramsState.taskId = "task-2";

    await waitFor(() => {
      expect(ref.current?.task()?.id).toBe("task-2");
    });

    resolveSecondOptions();
    await waitFor(() => {
      expect(ref.current?.runProviderOptions()).toEqual([
        { id: "provider-current", label: "Current" },
      ]);
      expect(ref.current?.isLoadingRunSelectionOptions()).toBe(false);
    });

    resolveFirstOptions();
    await waitFor(() => {
      expect(ref.current?.runProviderOptions()).toEqual([
        { id: "provider-current", label: "Current" },
      ]);
    });
  });

  it("blocks concurrent start requests while one start is in flight", async () => {
    let resolveStart: () => void = () => {};
    startRunOpenCodeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = () =>
            resolve({
              state: "running",
              queuedAt: "2026-01-01T00:00:01.000Z",
              clientRequestId: "initial-run-message:run-1",
              readyPhase: "warm_handle",
            });
        }),
    );

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.runs().length).toBe(2);
    });

    const firstStartPromise = ref.current?.onStartRun("run-1");

    await waitFor(() => {
      expect(ref.current?.isAnyRunStarting()).toBe(true);
    });

    await ref.current?.onStartRun("run-2");
    expect(startRunOpenCodeMock).toHaveBeenCalledTimes(1);
    expect(startRunOpenCodeMock).toHaveBeenCalledWith("run-1");

    resolveStart();
    await firstStartPromise;
    await waitFor(() => {
      expect(ref.current?.isAnyRunStarting()).toBe(false);
    });
  });

  it("opens blocked warning and does not create run when task is blocked", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "todo",
      isBlocked: true,
      blockedByCount: 1,
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onCreateRun();

    expect(ref.current?.isBlocked()).toBe(true);
    expect(ref.current?.taskDependencyBadgeState()).toBe("blocked");
    expect(ref.current?.isBlockedRunWarningOpen()).toBe(true);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("shows ready state and allows creating run when dependencies are resolved", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "todo",
      isBlocked: false,
      blockedByCount: 2,
    });
    listTaskDependenciesMock.mockResolvedValue({
      parents: [
        {
          id: "task-parent",
          displayKey: "PRJ-1",
          title: "Parent",
          status: "doing",
          targetRepositoryName: "Main",
          targetRepositoryPath: "/repo/main",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onCreateRun();

    expect(ref.current?.isBlocked()).toBe(false);
    expect(ref.current?.taskDependencyBadgeState()).toBe("ready");
    expect(ref.current?.isBlockedRunWarningOpen()).toBe(false);
    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: undefined,
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("hides ready state once task is in progress even when blockers are resolved", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "doing",
      isBlocked: false,
      blockedByCount: 2,
    });
    listTaskDependenciesMock.mockResolvedValue({
      parents: [
        {
          id: "task-parent",
          displayKey: "PRJ-1",
          title: "Parent",
          status: "done",
          targetRepositoryName: "Main",
          targetRepositoryPath: "/repo/main",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onCreateRun();

    expect(ref.current?.isBlocked()).toBe(false);
    expect(ref.current?.taskDependencyBadgeState()).toBe("none");
    expect(ref.current?.isBlockedRunWarningOpen()).toBe(false);
    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: undefined,
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("hides ready state once task is in review even when blockers are resolved", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "review",
      isBlocked: false,
      blockedByCount: 2,
    });
    listTaskDependenciesMock.mockResolvedValue({
      parents: [
        {
          id: "task-parent",
          displayKey: "PRJ-1",
          title: "Parent",
          status: "done",
          targetRepositoryName: "Main",
          targetRepositoryPath: "/repo/main",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onCreateRun();

    expect(ref.current?.isBlocked()).toBe(false);
    expect(ref.current?.taskDependencyBadgeState()).toBe("none");
    expect(ref.current?.isBlockedRunWarningOpen()).toBe(false);
    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: undefined,
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("shows none state and allows creating run when there are no dependencies", async () => {
    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    await ref.current?.onCreateRun();

    expect(ref.current?.isBlocked()).toBe(false);
    expect(ref.current?.taskDependencyBadgeState()).toBe("none");
    expect(ref.current?.isBlockedRunWarningOpen()).toBe(false);
    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: undefined,
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("passes selected run defaults into createRun", async () => {
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Planner" }],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    ref.current?.setSelectedRunAgentId("agent-1");
    ref.current?.setSelectedRunProviderId("provider-1");
    ref.current?.setSelectedRunModelId("model-1");

    await ref.current?.onCreateRun();

    expect(createRunMock).toHaveBeenCalledWith("task-1", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("auto-selects provider when selecting a model", async () => {
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    ref.current?.setSelectedRunProviderId("");
    ref.current?.setSelectedRunModelId("model-1");

    expect(ref.current?.selectedRunProviderId()).toBe("provider-1");
    expect(ref.current?.selectedRunModelId()).toBe("model-1");
  });

  it("preselects project defaults when opening run settings modal", async () => {
    getProjectMock.mockResolvedValue({
      name: "Project",
      key: "PRJ",
      repositories: [],
      defaultRunAgent: "agent-1",
      defaultRunProvider: "provider-1",
      defaultRunModel: "model-1",
    });
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Planner" }],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    ref.current?.onOpenRunSettingsModal();

    expect(ref.current?.selectedRunAgentId()).toBe("agent-1");
    expect(ref.current?.selectedRunProviderId()).toBe("provider-1");
    expect(ref.current?.selectedRunModelId()).toBe("model-1");
  });

  it("falls back gracefully when project default agent is unavailable", async () => {
    getProjectMock.mockResolvedValue({
      name: "Project",
      key: "PRJ",
      repositories: [],
      defaultRunAgent: "agent-missing",
      defaultRunProvider: "provider-1",
      defaultRunModel: "model-1",
    });
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Planner" }],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    ref.current?.onOpenRunSettingsModal();

    expect(ref.current?.selectedRunAgentId()).toBe("");
    expect(ref.current?.selectedRunProviderId()).toBe("provider-1");
    expect(ref.current?.selectedRunModelId()).toBe("model-1");
  });

  it("clears stale selected model when provider changes", async () => {
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [],
      providers: [
        { id: "provider-1", label: "OpenAI" },
        { id: "provider-2", label: "Anthropic" },
      ],
      models: [
        { id: "model-1", label: "GPT-5", providerId: "provider-1" },
        { id: "model-2", label: "Claude", providerId: "provider-2" },
      ],
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.task()).toBeTruthy();
    });

    ref.current?.setSelectedRunProviderId("provider-1");
    ref.current?.setSelectedRunModelId("model-1");
    expect(ref.current?.selectedRunModelId()).toBe("model-1");

    ref.current?.setSelectedRunProviderId("provider-2");

    await waitFor(() => {
      expect(ref.current?.selectedRunModelId()).toBe("");
    });
  });

  it("prevents starting existing run while blocked", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      description: "Desc",
      implementationGuide: "Guide",
      status: "todo",
      isBlocked: true,
      blockedByCount: 1,
    });

    const ref: { current: ReturnType<typeof useTaskDetailModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useTaskDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.runs().length).toBe(2);
    });

    await ref.current?.onStartRun("run-1");

    expect(startRunOpenCodeMock).not.toHaveBeenCalled();
  });
});
