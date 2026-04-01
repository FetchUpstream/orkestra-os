import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal } from "solid-js";
import { buildBoardHref } from "../../../app/lib/boardNavigation";
import { getProject } from "../../../app/lib/projects";
import {
  addTaskDependency,
  createTask,
  listProjectTasks,
  type Task,
  type TaskDependencies,
  type TaskDependencyTask,
  type TaskStatus,
} from "../../../app/lib/tasks";
import { getCreateTaskErrorMessage } from "../../projects/utils/projectDetail";
import {
  filterDependencyCandidates,
  getActionErrorMessage,
  isDependencyCandidateLinkable,
} from "../utils/taskDetail";
import type { DependencyDirection } from "../components/TaskDependenciesSidebar";

type FieldErrors = {
  title?: string;
  targetRepositoryId?: string;
};

type CreateTaskFormSnapshot = {
  title: string;
  description: string;
  implementationGuide: string;
  status: TaskStatus;
  targetRepositoryId: string;
  parentDependencyIds: string[];
  childDependencyIds: string[];
};

export const useTaskCreateModel = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [projectName, setProjectName] = createSignal<string | null>(null);
  const [repositories, setRepositories] = createSignal<
    Array<{ id: string; name: string }>
  >([]);
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [implementationGuide, setImplementationGuide] = createSignal("");
  const [status, setStatus] = createSignal<TaskStatus>("todo");
  const [targetRepositoryId, setTargetRepositoryId] = createSignal("");
  const [fieldErrors, setFieldErrors] = createSignal<FieldErrors>({});
  const [actionError, setActionError] = createSignal("");
  const [createdTaskLinkErrorHref, setCreatedTaskLinkErrorHref] =
    createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal("");
  const [hasSubmitted, setHasSubmitted] = createSignal(false);
  const [initialSnapshot, setInitialSnapshot] =
    createSignal<CreateTaskFormSnapshot | null>(null);
  const [isDiscardModalOpen, setIsDiscardModalOpen] = createSignal(false);
  const [candidateTasks, setCandidateTasks] = createSignal<Task[]>([]);
  const [dependencies, setDependencies] = createSignal<TaskDependencies>({
    taskId: "new",
    parents: [],
    children: [],
  });
  const [dependencyCandidatesError, setDependencyCandidatesError] =
    createSignal("");
  const [isLinkDependencyModalOpen, setIsLinkDependencyModalOpen] =
    createSignal(false);
  const [linkDependencyDirection, setLinkDependencyDirection] =
    createSignal<DependencyDirection>("parent");
  const [linkDependencySearch, setLinkDependencySearch] = createSignal("");
  const [showDoneLinkCandidates, setShowDoneLinkCandidates] =
    createSignal(false);
  const [isLinkingDependency, setIsLinkingDependency] = createSignal(false);
  const [removingParentDependencyId, setRemovingParentDependencyId] =
    createSignal<string | null>(null);
  const [removingChildDependencyId, setRemovingChildDependencyId] =
    createSignal<string | null>(null);

  const origin = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("origin")?.trim().toLowerCase() || "";
  });

  const backHref = createMemo(() => {
    if (origin() === "board") return buildBoardHref(params.projectId);
    return params.projectId ? `/projects/${params.projectId}` : "/projects";
  });

  const backLabel = createMemo(() => {
    if (origin() === "board") return "board";
    return params.projectId ? "project" : "projects";
  });

  const currentSnapshot = (): CreateTaskFormSnapshot => ({
    title: title(),
    description: description(),
    implementationGuide: implementationGuide(),
    status: status(),
    targetRepositoryId: targetRepositoryId(),
    parentDependencyIds: dependencies().parents.map((task) => task.id),
    childDependencyIds: dependencies().children.map((task) => task.id),
  });

  const isDirty = createMemo(() => {
    const baseline = initialSnapshot();
    if (!baseline) return false;

    const current = currentSnapshot();
    return (
      current.title !== baseline.title ||
      current.description !== baseline.description ||
      current.implementationGuide !== baseline.implementationGuide ||
      current.status !== baseline.status ||
      current.targetRepositoryId !== baseline.targetRepositoryId ||
      current.parentDependencyIds.join(",") !==
        baseline.parentDependencyIds.join(",") ||
      current.childDependencyIds.join(",") !==
        baseline.childDependencyIds.join(",")
    );
  });

  const availableParentCandidates = createMemo(() => {
    const linkedTaskIds = new Set(
      dependencies().parents.map((dependencyTask) => dependencyTask.id),
    );
    return candidateTasks().filter((candidateTask) =>
      isDependencyCandidateLinkable(candidateTask, "new", linkedTaskIds),
    );
  });

  const availableChildCandidates = createMemo(() => {
    const linkedTaskIds = new Set(
      dependencies().children.map((dependencyTask) => dependencyTask.id),
    );
    return candidateTasks().filter((candidateTask) =>
      isDependencyCandidateLinkable(candidateTask, "new", linkedTaskIds),
    );
  });

  const filteredLinkCandidates = createMemo(() => {
    const candidates =
      linkDependencyDirection() === "parent"
        ? availableParentCandidates()
        : availableChildCandidates();
    return filterDependencyCandidates(candidates, {
      searchTerm: linkDependencySearch(),
      includeDone: showDoneLinkCandidates(),
    });
  });

  const createdTaskHref = (taskId: string) => {
    const detailHref = `/projects/${params.projectId}/tasks/${taskId}`;
    const originQuery = origin();
    return originQuery
      ? `${detailHref}?origin=${encodeURIComponent(originQuery)}`
      : detailHref;
  };

  const toDependencyTask = (taskValue: Task): TaskDependencyTask => ({
    id: taskValue.id,
    displayKey: taskValue.displayKey?.trim() || "",
    title: taskValue.title,
    status: taskValue.status,
    targetRepositoryName: taskValue.targetRepositoryName,
    targetRepositoryPath: taskValue.targetRepositoryPath,
    updatedAt: taskValue.updatedAt,
  });

  const validate = () => {
    const nextErrors: FieldErrors = {};
    if (!title().trim()) {
      nextErrors.title = "Title is required.";
    }
    const hasAvailableTargetRepository = repositories().some(
      (repo) => !!repo.id,
    );
    if (!hasAvailableTargetRepository) {
      nextErrors.targetRepositoryId =
        "No target repository is available for this project.";
    } else if (!targetRepositoryId()) {
      nextErrors.targetRepositoryId = "Select a target repository.";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onClose = () => {
    if (isSubmitting()) return;
    if (isDirty()) {
      setIsDiscardModalOpen(true);
      return;
    }
    navigate(backHref());
  };

  const onCancelDiscard = () => {
    if (isSubmitting()) return;
    setIsDiscardModalOpen(false);
  };

  const onConfirmDiscard = () => {
    if (isSubmitting()) return;
    setIsDiscardModalOpen(false);
    navigate(backHref());
  };

  const onSubmit = async () => {
    if (isSubmitting()) return;
    setHasSubmitted(true);
    if (!validate()) return;
    if (!params.projectId) return;

    setActionError("");
    setCreatedTaskLinkErrorHref("");
    setIsSubmitting(true);
    try {
      const created = await createTask({
        projectId: params.projectId,
        title: title().trim(),
        description: description().trim() || undefined,
        implementationGuide: implementationGuide().trim() || undefined,
        status: status(),
        targetRepositoryId: targetRepositoryId() || undefined,
      });
      try {
        await Promise.all([
          ...dependencies().parents.map((dependencyTask) =>
            addTaskDependency(dependencyTask.id, created.id),
          ),
          ...dependencies().children.map((dependencyTask) =>
            addTaskDependency(created.id, dependencyTask.id),
          ),
        ]);
      } catch (linkError) {
        setCreatedTaskLinkErrorHref(createdTaskHref(created.id));
        setActionError(
          getActionErrorMessage(
            "Task created, but dependencies could not be linked. Open the task and retry linking.",
            linkError,
          ),
        );
        return;
      }
      navigate(createdTaskHref(created.id));
    } catch (createError) {
      const backendMessage = getCreateTaskErrorMessage(createError);
      setActionError(
        backendMessage
          ? `Failed to create task. ${backendMessage}`
          : "Failed to create task. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadProjectContext = async () => {
    if (!params.projectId) {
      setLoadError("Missing project ID.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const project = await getProject(params.projectId);
      const name = project.name.trim();
      const key = project.key.trim();
      setProjectName(key ? `${name} (${key})` : name || null);
      const repositories = project.repositories
        .filter(
          (
            repository,
          ): repository is {
            id: string;
            name?: string | null;
            path: string;
            is_default?: boolean;
          } => Boolean(repository.id),
        )
        .map((repository) => ({
          id: repository.id,
          name: repository.name?.trim() || repository.path,
          isDefault: Boolean(repository.is_default),
        }));
      setRepositories(repositories.map(({ id, name }) => ({ id, name })));
      const defaultRepository = repositories.find((item) => item.isDefault);
      const initialTargetRepositoryId =
        defaultRepository?.id || repositories[0]?.id || "";
      setTargetRepositoryId(initialTargetRepositoryId);
      try {
        setCandidateTasks(await listProjectTasks(params.projectId));
        setDependencyCandidatesError("");
      } catch (error) {
        setCandidateTasks([]);
        setDependencyCandidatesError(
          getActionErrorMessage("Failed to load dependency candidates.", error),
        );
      }
      setDependencies({ taskId: "new", parents: [], children: [] });
      setInitialSnapshot({
        title: "",
        description: "",
        implementationGuide: "",
        status: "todo",
        targetRepositoryId: initialTargetRepositoryId,
        parentDependencyIds: [],
        childDependencyIds: [],
      });
    } catch {
      setLoadError("Failed to load project. Please try again.");
      setProjectName(null);
      setRepositories([]);
      setTargetRepositoryId("");
      setCandidateTasks([]);
      setDependencies({ taskId: "new", parents: [], children: [] });
      setDependencyCandidatesError("");
      setInitialSnapshot(null);
    } finally {
      setIsLoading(false);
    }
  };

  const onTitleBlur = () => {
    if (!hasSubmitted()) return;
    void validate();
  };

  const onTargetRepositoryBlur = () => {
    if (!hasSubmitted()) return;
    void validate();
  };

  const reloadDependencyCandidates = async () => {
    if (!params.projectId) return;
    setDependencyCandidatesError("");
    try {
      setCandidateTasks(await listProjectTasks(params.projectId));
    } catch (error) {
      setDependencyCandidatesError(
        getActionErrorMessage("Failed to load dependency candidates.", error),
      );
    }
  };

  const onOpenLinkDependencyModal = (direction: DependencyDirection) => {
    setActionError("");
    setLinkDependencyDirection(direction);
    setLinkDependencySearch("");
    setShowDoneLinkCandidates(false);
    setIsLinkDependencyModalOpen(true);
  };

  const onCancelLinkDependency = () => {
    if (isLinkingDependency()) return;
    setIsLinkDependencyModalOpen(false);
  };

  const onSetLinkDependencyDirection = (direction: DependencyDirection) => {
    setLinkDependencyDirection(direction);
  };

  const onLinkDependency = async (dependencyTaskId: string) => {
    if (!dependencyTaskId || isLinkingDependency()) return;
    const candidateTask = filteredLinkCandidates().find(
      (taskValue) => taskValue.id === dependencyTaskId,
    );
    if (!candidateTask) return;

    setIsLinkingDependency(true);
    try {
      setDependencies((currentDependencies) => ({
        ...currentDependencies,
        parents:
          linkDependencyDirection() === "parent"
            ? [...currentDependencies.parents, toDependencyTask(candidateTask)]
            : currentDependencies.parents,
        children:
          linkDependencyDirection() === "child"
            ? [...currentDependencies.children, toDependencyTask(candidateTask)]
            : currentDependencies.children,
      }));
      setIsLinkDependencyModalOpen(false);
    } finally {
      setIsLinkingDependency(false);
    }
  };

  const onRemoveParentDependency = (dependencyTask: TaskDependencyTask) => {
    setRemovingParentDependencyId(dependencyTask.id);
    setDependencies((currentDependencies) => ({
      ...currentDependencies,
      parents: currentDependencies.parents.filter(
        (taskValue) => taskValue.id !== dependencyTask.id,
      ),
    }));
    setRemovingParentDependencyId(null);
  };

  const onRemoveChildDependency = (dependencyTask: TaskDependencyTask) => {
    setRemovingChildDependencyId(dependencyTask.id);
    setDependencies((currentDependencies) => ({
      ...currentDependencies,
      children: currentDependencies.children.filter(
        (taskValue) => taskValue.id !== dependencyTask.id,
      ),
    }));
    setRemovingChildDependencyId(null);
  };

  const onOpenCreatedTaskAfterLinkFailure = () => {
    const href = createdTaskLinkErrorHref();
    if (!href) return;
    navigate(href);
  };

  return {
    params,
    projectName,
    repositories,
    title,
    description,
    implementationGuide,
    status,
    targetRepositoryId,
    fieldErrors,
    actionError,
    createdTaskLinkErrorHref,
    isSubmitting,
    isLoading,
    loadError,
    dependencies,
    dependencyCandidatesError,
    isLinkDependencyModalOpen,
    linkDependencyDirection,
    linkDependencySearch,
    showDoneLinkCandidates,
    filteredLinkCandidates,
    isLinkingDependency,
    removingParentDependencyId,
    removingChildDependencyId,
    backHref,
    backLabel,
    isDirty,
    isDiscardModalOpen,
    setTitle,
    setDescription,
    setImplementationGuide,
    setStatus,
    setTargetRepositoryId,
    setLinkDependencySearch,
    setShowDoneLinkCandidates,
    loadProjectContext,
    reloadDependencyCandidates,
    onSubmit,
    onClose,
    onCancelDiscard,
    onConfirmDiscard,
    onTitleBlur,
    onTargetRepositoryBlur,
    onOpenLinkDependencyModal,
    onCancelLinkDependency,
    onSetLinkDependencyDirection,
    onLinkDependency,
    onRemoveParentDependency,
    onRemoveChildDependency,
    onOpenCreatedTaskAfterLinkFailure,
  };
};
