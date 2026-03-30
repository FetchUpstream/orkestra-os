import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onMount, type JSX } from "solid-js";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";
import {
  cloneProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
  type Project,
} from "../../../app/lib/projects";
import {
  getRunSelectionOptionsWithCache,
  readRunSelectionOptionsCache,
} from "../../../app/lib/runSelectionOptionsCache";
import {
  filterModelsForProvider,
  resolveProjectRunDefaults,
} from "../../../app/lib/projectRunDefaults";
import {
  normalizeProjectKey,
  recommendProjectKey,
} from "../../../app/lib/projectKey";
import {
  createProjectKeyError,
  emptyRepo,
  getCreateProjectErrorMessage,
  type RepoInput,
} from "../utils/projectForm";

export const useProjectsPageModel = () => {
  const navigate = useNavigate();
  const [mode, setMode] = createSignal<"create" | "edit">("create");
  const [editingProjectId, setEditingProjectId] = createSignal<string | null>(
    null,
  );
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [repositories, setRepositories] = createSignal<RepoInput[]>([
    emptyRepo(),
  ]);
  const [defaultRepoIndex, setDefaultRepoIndex] = createSignal(0);
  const [error, setError] = createSignal("");
  const [runDefaultsError, setRunDefaultsError] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isLoadingRunDefaults, setIsLoadingRunDefaults] = createSignal(false);
  const [runProviderOptions, setRunProviderOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runAgentOptions, setRunAgentOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runModelOptions, setRunModelOptions] = createSignal<RunModelOption[]>(
    [],
  );
  const [defaultRunProvider, setDefaultRunProvider] = createSignal("");
  const [defaultRunAgent, setDefaultRunAgent] = createSignal("");
  const [defaultRunModel, setDefaultRunModelSignal] = createSignal("");
  const [isLoadingProjectForEdit, setIsLoadingProjectForEdit] =
    createSignal(false);
  const [isKeyEdited, setIsKeyEdited] = createSignal(false);
  const [touched, setTouched] = createSignal<Record<string, boolean>>({});
  const [isCloneModalOpen, setIsCloneModalOpen] = createSignal(false);
  const [cloneSourceProjectId, setCloneSourceProjectId] = createSignal("");
  const [cloneSourceProjectName, setCloneSourceProjectName] = createSignal("");
  const [cloneSourceProjectKey, setCloneSourceProjectKey] = createSignal("");
  const [cloneProjectName, setCloneProjectName] = createSignal("");
  const [cloneProjectKey, setCloneProjectKey] = createSignal("");
  const [cloneRepositoryDestination, setCloneRepositoryDestination] =
    createSignal("");
  const [cloneTouched, setCloneTouched] = createSignal<Record<string, boolean>>(
    {},
  );
  const [cloneError, setCloneError] = createSignal("");
  const [isCloning, setIsCloning] = createSignal(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = createSignal(false);
  const [deleteProjectId, setDeleteProjectId] = createSignal<string | null>(
    null,
  );
  const [deleteProjectName, setDeleteProjectName] = createSignal("");
  const [deleteProjectKey, setDeleteProjectKey] = createSignal("");
  const [deleteError, setDeleteError] = createSignal("");
  const [isDeletingProject, setIsDeletingProject] = createSignal(false);

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
  };

  const visibleRunModelOptions = createMemo(() => {
    return filterModelsForProvider(
      runModelOptions(),
      defaultRunProvider().trim(),
    );
  });

  const doesModelMatchProvider = (modelId: string, providerId: string) => {
    if (!modelId || !providerId) return true;
    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    if (!selectedModel?.providerId) return true;
    return selectedModel.providerId === providerId;
  };

  const hasRunSelectionOptions = createMemo(
    () =>
      runAgentOptions().length > 0 ||
      runProviderOptions().length > 0 ||
      runModelOptions().length > 0,
  );

  const runDefaultsValidationError = createMemo(() => {
    if (runProviderOptions().length === 0) {
      return "No run providers are available. Configure providers before saving.";
    }
    if (!defaultRunProvider().trim()) return "Default provider is required.";
    if (visibleRunModelOptions().length === 0) {
      return "No models are available for the selected provider.";
    }
    if (!defaultRunModel().trim()) return "Default model is required.";
    if (
      !visibleRunModelOptions().some(
        (option) => option.id === defaultRunModel().trim(),
      )
    ) {
      return "Selected model is unavailable for the selected provider. Please reselect.";
    }
    return "";
  });

  const setDefaultRunModel = (modelId: string) => {
    setDefaultRunModelSignal(modelId);
    if (!modelId) return;
    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    const providerId = selectedModel?.providerId?.trim() || "";
    if (providerId && providerId !== defaultRunProvider().trim()) {
      setDefaultRunProvider(providerId);
    }
  };

  const setDefaultRunProviderAndValidate = (providerId: string) => {
    setDefaultRunProvider(providerId);
    const modelId = defaultRunModel().trim();
    if (modelId && !doesModelMatchProvider(modelId, providerId.trim())) {
      setDefaultRunModelSignal("");
    }
  };

  const applyResolvedRunDefaults = (persisted: {
    agentId?: string | null;
    providerId?: string | null;
    modelId?: string | null;
  }) => {
    const normalizedPersistedAgentId = persisted.agentId?.trim() || "";
    if (runAgentOptions().length === 0) {
      setDefaultRunAgent(normalizedPersistedAgentId);
    } else {
      const persistedAgentExists = runAgentOptions().some(
        (option) => option.id === normalizedPersistedAgentId,
      );
      setDefaultRunAgent(
        persistedAgentExists ? normalizedPersistedAgentId : "",
      );
    }

    if (runProviderOptions().length === 0 && runModelOptions().length === 0) {
      setDefaultRunProvider(persisted.providerId?.trim() || "");
      setDefaultRunModelSignal(persisted.modelId?.trim() || "");
      return;
    }

    const resolved = resolveProjectRunDefaults({
      persisted,
      providers: runProviderOptions(),
      models: runModelOptions(),
    });
    setDefaultRunProvider(resolved.providerId);
    setDefaultRunModelSignal(resolved.modelId);
  };

  const loadRunSelectionOptions = async () => {
    const cachedOptions = readRunSelectionOptionsCache();
    if (cachedOptions) {
      setRunProviderOptions(cachedOptions.providers);
      setRunAgentOptions(cachedOptions.agents);
      setRunModelOptions(cachedOptions.models);
      applyResolvedRunDefaults({
        agentId: defaultRunAgent(),
        providerId: defaultRunProvider(),
        modelId: defaultRunModel(),
      });
      setRunDefaultsError("");
      return;
    }

    setIsLoadingRunDefaults(true);
    setRunDefaultsError("");
    try {
      const options = await getRunSelectionOptionsWithCache();
      setRunProviderOptions(options.providers);
      setRunAgentOptions(options.agents);
      setRunModelOptions(options.models);
      applyResolvedRunDefaults({
        agentId: defaultRunAgent(),
        providerId: defaultRunProvider(),
        modelId: defaultRunModel(),
      });
    } catch {
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
      setRunDefaultsError("Failed to load run defaults.");
    } finally {
      setIsLoadingRunDefaults(false);
    }
  };

  onMount(() => {
    void Promise.all([loadProjects(), loadRunSelectionOptions()]);
  });

  const projectKeyError = createProjectKeyError(key, touched);
  const cloneProjectKeyError = createProjectKeyError(
    cloneProjectKey,
    cloneTouched,
  );
  const cloneRepositoryDestinationError = createMemo(() => {
    if (!cloneTouched().repositoryDestination) return "";
    if (!cloneRepositoryDestination().trim()) {
      return "Repository destination is required.";
    }
    return "";
  });

  const hasInvalidDefaultRepo = createMemo(() => {
    const index = defaultRepoIndex();
    return index < 0 || index >= repositories().length;
  });

  const resetForm = () => {
    setMode("create");
    setEditingProjectId(null);
    setName("");
    setKey("");
    setDescription("");
    setRepositories([emptyRepo()]);
    setDefaultRepoIndex(0);
    setDefaultRunProvider("");
    setDefaultRunAgent("");
    setDefaultRunModelSignal("");
    setIsKeyEdited(false);
    setTouched({});
    setError("");
  };

  const updateName = (value: string) => {
    setName(value);
    if (!isKeyEdited()) {
      setKey(recommendProjectKey(value));
    }
  };

  const updateKey = (value: string) => {
    setIsKeyEdited(true);
    setKey(normalizeProjectKey(value));
    setTouched((prev) => ({ ...prev, key: true }));
  };

  const addRepository = () => {
    setRepositories((prev) => [...prev, emptyRepo()]);
  };

  const removeRepository = (index: number) => {
    setRepositories((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
    setDefaultRepoIndex((prev) => {
      if (prev === index) return -1;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  const updateRepository = (
    index: number,
    field: keyof RepoInput,
    value: string,
  ) => {
    setRepositories((prev) =>
      prev.map((repo, itemIndex) =>
        itemIndex === index ? { ...repo, [field]: value } : repo,
      ),
    );
  };

  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (
    event,
  ) => {
    event.preventDefault();
    setError("");

    if (!name().trim()) {
      setError("Project name is required.");
      setTouched((prev) => ({ ...prev, name: true }));
      return;
    }

    if (projectKeyError() || !key().trim()) {
      setError(projectKeyError() || "Project key is required.");
      setTouched((prev) => ({ ...prev, key: true }));
      return;
    }

    const normalizedRepositories = repositories().map((repo) => ({
      id: repo.id,
      path: repo.path.trim(),
      name: repo.name.trim(),
      setup_script: repo.setupScript.trim(),
      cleanup_script: repo.cleanupScript.trim(),
    }));

    if (normalizedRepositories.some((repo) => !repo.path)) {
      setError("Repository path is required for each entry.");
      return;
    }

    if (hasInvalidDefaultRepo()) {
      setError("Select exactly one default repository.");
      return;
    }

    if (runDefaultsValidationError()) {
      setError(runDefaultsValidationError());
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: name().trim(),
        key: normalizeProjectKey(key()),
        description: description().trim() || undefined,
        defaultRunProvider: defaultRunProvider().trim(),
        defaultRunModel: defaultRunModel().trim(),
        defaultRunAgent: defaultRunAgent().trim() || undefined,
        repositories: normalizedRepositories.map((repo, index) => ({
          id: repo.id,
          path: repo.path,
          name: repo.name || undefined,
          is_default: index === defaultRepoIndex(),
          setup_script: repo.setup_script || undefined,
          cleanup_script: repo.cleanup_script || undefined,
        })),
      };
      const activeEditProjectId = editingProjectId();

      if (mode() === "edit" && activeEditProjectId) {
        await updateProject(activeEditProjectId, payload);
        await loadProjects();
        navigate(`/board?projectId=${encodeURIComponent(activeEditProjectId)}`);
        return;
      }

      const createdProject = await createProject(payload);
      await loadProjects();
      resetForm();
      navigate(`/projects/${createdProject.id}`);
    } catch (submitError) {
      const backendMessage = getCreateProjectErrorMessage(submitError);
      const prefix =
        mode() === "edit"
          ? "Failed to save project."
          : "Failed to create project.";
      setError(
        backendMessage
          ? `${prefix} ${backendMessage}`
          : `${prefix} Please try again.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const onEditProject = async (projectId: string) => {
    setError("");
    setIsLoadingProjectForEdit(true);
    setEditingProjectId(projectId);
    try {
      const projectDetails = await getProject(projectId);
      const nextRepositories = projectDetails.repositories.map(
        (repository) => ({
          id: repository.id,
          path: repository.path,
          name: repository.name ?? "",
          setupScript: repository.setup_script ?? "",
          cleanupScript: repository.cleanup_script ?? "",
        }),
      );

      setMode("edit");
      setName(projectDetails.name);
      setKey(projectDetails.key);
      setDescription(projectDetails.description ?? "");
      setRepositories(
        nextRepositories.length > 0 ? nextRepositories : [emptyRepo()],
      );
      applyResolvedRunDefaults({
        agentId: projectDetails.defaultRunAgent,
        providerId: projectDetails.defaultRunProvider,
        modelId: projectDetails.defaultRunModel,
      });
      const defaultRepositoryIndex = projectDetails.repositories.findIndex(
        (repository) => repository.is_default,
      );
      setDefaultRepoIndex(
        defaultRepositoryIndex >= 0 ? defaultRepositoryIndex : 0,
      );
      setIsKeyEdited(true);
      setTouched({});
    } catch (loadError) {
      const backendMessage = getCreateProjectErrorMessage(loadError);
      setError(
        backendMessage
          ? `Failed to load project for editing. ${backendMessage}`
          : "Failed to load project for editing. Please try again.",
      );
      setMode("create");
      setEditingProjectId(null);
    } finally {
      setIsLoadingProjectForEdit(false);
    }
  };

  const closeCloneModal = () => {
    setIsCloneModalOpen(false);
    setCloneSourceProjectId("");
    setCloneSourceProjectName("");
    setCloneSourceProjectKey("");
    setCloneProjectName("");
    setCloneProjectKey("");
    setCloneRepositoryDestination("");
    setCloneTouched({});
    setCloneError("");
    setIsCloning(false);
  };

  const onOpenCloneModal = (project: Project) => {
    const nextName = `${project.name} - Copy`;
    setCloneSourceProjectId(project.id);
    setCloneSourceProjectName(project.name);
    setCloneSourceProjectKey(project.key);
    setCloneProjectName(nextName);
    setCloneProjectKey(recommendProjectKey(nextName));
    setCloneRepositoryDestination("");
    setCloneTouched({});
    setCloneError("");
    setIsCloneModalOpen(true);
  };

  const updateCloneProjectKey = (value: string) => {
    setCloneProjectKey(normalizeProjectKey(value));
    setCloneTouched((prev) => ({ ...prev, key: true }));
  };

  const onSubmitClone = async (event: Event) => {
    event.preventDefault();
    setCloneError("");

    if (cloneProjectKeyError() || !cloneProjectKey().trim()) {
      setCloneError(cloneProjectKeyError() || "Project key is required.");
      setCloneTouched((prev) => ({ ...prev, key: true }));
      return;
    }

    if (!cloneRepositoryDestination().trim()) {
      setCloneError("Repository destination is required.");
      setCloneTouched((prev) => ({ ...prev, repositoryDestination: true }));
      return;
    }

    setIsCloning(true);
    try {
      const createdProject = await cloneProject(cloneSourceProjectId(), {
        name: cloneProjectName().trim(),
        key: normalizeProjectKey(cloneProjectKey()),
        repository_destination: cloneRepositoryDestination().trim(),
      });
      await loadProjects();
      closeCloneModal();
      navigate(`/projects/${createdProject.id}`);
    } catch (submitError) {
      const backendMessage = getCreateProjectErrorMessage(submitError);
      setCloneError(
        backendMessage
          ? `Failed to clone project. ${backendMessage}`
          : "Failed to clone project. Please try again.",
      );
    } finally {
      setIsCloning(false);
    }
  };

  const closeDeleteModal = () => {
    if (isDeletingProject()) return;
    setIsDeleteModalOpen(false);
    setDeleteProjectId(null);
    setDeleteProjectName("");
    setDeleteProjectKey("");
    setDeleteError("");
  };

  const onOpenDeleteModal = (project: Project) => {
    setDeleteProjectId(project.id);
    setDeleteProjectName(project.name);
    setDeleteProjectKey(project.key);
    setDeleteError("");
    setIsDeleteModalOpen(true);
  };

  const onConfirmDeleteProject = async () => {
    const projectId = deleteProjectId();
    if (!projectId) return;

    setDeleteError("");
    setIsDeletingProject(true);
    try {
      try {
        await deleteProject(projectId);
      } catch (deleteProjectError) {
        const backendMessage = getCreateProjectErrorMessage(deleteProjectError);
        setDeleteError(
          backendMessage
            ? `Failed to delete project. ${backendMessage}`
            : "Failed to delete project. Please try again.",
        );
        return;
      }

      try {
        await loadProjects();
      } catch (refreshError) {
        const backendMessage = getCreateProjectErrorMessage(refreshError);
        setDeleteError(
          backendMessage
            ? `Project deleted, but failed to refresh projects. ${backendMessage}`
            : "Project deleted, but failed to refresh projects. Please refresh the page.",
        );
        return;
      }

      if (editingProjectId() === projectId) {
        resetForm();
      }
      setIsDeleteModalOpen(false);
      setDeleteProjectId(null);
      setDeleteProjectName("");
      setDeleteProjectKey("");
      setDeleteError("");
    } finally {
      setIsDeletingProject(false);
    }
  };

  return {
    mode,
    editingProjectId,
    projects,
    name,
    key,
    description,
    repositories,
    defaultRepoIndex,
    error,
    runDefaultsError,
    isSubmitting,
    isLoadingRunDefaults,
    runProviderOptions,
    runAgentOptions,
    runModelOptions,
    visibleRunModelOptions,
    hasRunSelectionOptions,
    defaultRunProvider,
    defaultRunAgent,
    defaultRunModel,
    runDefaultsValidationError,
    isLoadingProjectForEdit,
    isCloneModalOpen,
    touched,
    cloneSourceProjectName,
    cloneSourceProjectKey,
    cloneProjectName,
    cloneProjectKey,
    cloneRepositoryDestination,
    cloneError,
    isCloning,
    isDeleteModalOpen,
    deleteProjectId,
    deleteProjectName,
    deleteProjectKey,
    deleteError,
    isDeletingProject,
    projectKeyError,
    cloneProjectKeyError,
    cloneRepositoryDestinationError,
    setDescription,
    setTouched,
    setDefaultRunProvider: setDefaultRunProviderAndValidate,
    setDefaultRunAgent,
    setDefaultRunModel,
    setCloneTouched,
    setDefaultRepoIndex,
    setCloneRepositoryDestination,
    updateName,
    updateKey,
    updateCloneProjectKey,
    addRepository,
    removeRepository,
    updateRepository,
    resetForm,
    onEditProject,
    onOpenCloneModal,
    closeCloneModal,
    onOpenDeleteModal,
    closeDeleteModal,
    onConfirmDeleteProject,
    onSubmit,
    onSubmitClone,
  };
};
