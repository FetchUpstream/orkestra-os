import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskDetailModel } from "../useTaskDetailModel";

const {
  paramsState,
  navigateMock,
  getTaskMock,
  listTaskRunsMock,
  startRunOpenCodeMock,
  createRunMock,
  listTaskDependenciesMock,
  getRunSelectionOptionsMock,
} = vi.hoisted(() => ({
  paramsState: { projectId: "project-1", taskId: "task-1" },
  navigateMock: vi.fn(),
  getTaskMock: vi.fn(),
  listTaskRunsMock: vi.fn(),
  startRunOpenCodeMock: vi.fn(),
  createRunMock: vi.fn(),
  listTaskDependenciesMock: vi.fn(),
  getRunSelectionOptionsMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
  useLocation: () => ({ search: "" }),
}));

vi.mock("../../../../app/lib/projects", () => ({
  getProject: vi.fn(async () => ({
    name: "Project",
    key: "PRJ",
    repositories: [],
  })),
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
  getRunSelectionOptions: getRunSelectionOptionsMock,
}));

describe("useTaskDetailModel start run", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getTaskMock.mockReset();
    listTaskRunsMock.mockReset();
    startRunOpenCodeMock.mockReset();
    createRunMock.mockReset();
    listTaskDependenciesMock.mockReset();
    getRunSelectionOptionsMock.mockReset();

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
    getRunSelectionOptionsMock.mockResolvedValue({
      agents: [],
      providers: [],
      models: [],
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
      providerId: undefined,
      modelId: undefined,
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
      providerId: undefined,
      modelId: undefined,
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
      providerId: undefined,
      modelId: undefined,
    });
  });

  it("passes selected run defaults into createRun", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
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

  it("clears stale selected model when provider changes", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
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
