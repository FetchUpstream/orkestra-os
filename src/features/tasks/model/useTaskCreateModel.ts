import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal } from "solid-js";
import { getProject } from "../../../app/lib/projects";
import { createTask, type TaskStatus } from "../../../app/lib/tasks";
import { getCreateTaskErrorMessage } from "../../projects/utils/projectDetail";

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
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal("");
  const [hasSubmitted, setHasSubmitted] = createSignal(false);
  const [initialSnapshot, setInitialSnapshot] =
    createSignal<CreateTaskFormSnapshot | null>(null);
  const [isDiscardModalOpen, setIsDiscardModalOpen] = createSignal(false);

  const origin = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("origin")?.trim().toLowerCase() || "";
  });

  const backHref = createMemo(() => {
    if (origin() === "board") return "/board";
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
      current.targetRepositoryId !== baseline.targetRepositoryId
    );
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
      const detailHref = `/projects/${params.projectId}/tasks/${created.id}`;
      const originQuery = origin();
      navigate(
        originQuery
          ? `${detailHref}?origin=${encodeURIComponent(originQuery)}`
          : detailHref,
      );
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
      setInitialSnapshot({
        title: "",
        description: "",
        implementationGuide: "",
        status: "todo",
        targetRepositoryId: initialTargetRepositoryId,
      });
    } catch {
      setLoadError("Failed to load project. Please try again.");
      setRepositories([]);
      setTargetRepositoryId("");
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
    isSubmitting,
    isLoading,
    loadError,
    backHref,
    backLabel,
    isDirty,
    isDiscardModalOpen,
    setTitle,
    setDescription,
    setImplementationGuide,
    setStatus,
    setTargetRepositoryId,
    loadProjectContext,
    onSubmit,
    onClose,
    onCancelDiscard,
    onConfirmDiscard,
    onTitleBlur,
    onTargetRepositoryBlur,
  };
};
