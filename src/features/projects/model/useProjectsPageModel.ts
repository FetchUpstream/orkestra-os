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

import { useNavigate } from "@solidjs/router";
import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { useOpenCodeDependency } from "../../../app/contexts/OpenCodeDependencyContext";
import { buildBoardHref } from "../../../app/lib/boardNavigation";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";
import {
  cloneProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  searchLocalDirectories,
  updateProject,
  type CreateProjectInput,
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
  emptyEnvVar,
  emptyRepo,
  getCreateProjectErrorMessage,
  getProjectEnvVarError,
  normalizeProjectEnvVars,
  type EnvVarInput,
  type RepoInput,
} from "../utils/projectForm";

export const useProjectsPageModel = () => {
  const AUTOSAVE_DEBOUNCE_MS = 900;
  const AUTOSAVE_MAX_WAIT_MS = 5000;
  const navigate = useNavigate();
  const openCodeDependency = useOpenCodeDependency();
  let runSelectionOptionsRequestVersion = 0;
  let projectRouteSyncVersion = 0;
  let projectLoadRequestVersion = 0;
  const [mode, setMode] = createSignal<"create" | "edit">("create");
  const [editingProjectId, setEditingProjectId] = createSignal<string | null>(
    null,
  );
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [loadedProjectName, setLoadedProjectName] = createSignal("");
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [envVars, setEnvVars] = createSignal<EnvVarInput[]>([]);
  const [repositories, setRepositories] = createSignal<RepoInput[]>([
    emptyRepo(),
  ]);
  const [defaultRepoIndex, setDefaultRepoIndex] = createSignal(0);
  const [error, setError] = createSignal("");
  const [autosaveState, setAutosaveState] = createSignal<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [hasPendingProjectChanges, setHasPendingProjectChanges] =
    createSignal(false);
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
  const [deleteConfirmationInput, setDeleteConfirmationInput] =
    createSignal("");
  const [deleteError, setDeleteError] = createSignal("");
  const [isDeletingProject, setIsDeletingProject] = createSignal(false);
  let editMutationVersion = 0;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveInFlight = false;
  let autosaveQueued = false;
  let lastPersistedDraftSignature = "";
  let currentAutosavePromise: Promise<boolean> | null = null;

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    return nextProjects;
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
    if (openCodeDependency.state() !== "available") {
      return "";
    }
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
    const projectId = editingProjectId()?.trim() || "";
    const catalogProjectId = projectId;
    const requestVersion = ++runSelectionOptionsRequestVersion;
    const isCurrentRequest = () =>
      requestVersion === runSelectionOptionsRequestVersion &&
      (editingProjectId()?.trim() || "") === projectId;

    if (!projectId && openCodeDependency.state() !== "available") {
      setIsLoadingRunDefaults(true);
      setRunDefaultsError("");
      const isAvailable =
        await openCodeDependency.ensureAvailableForRequiredFlow();
      if (!isCurrentRequest()) {
        return;
      }
      if (!isAvailable) {
        setRunAgentOptions([]);
        setRunProviderOptions([]);
        setRunModelOptions([]);
        setIsLoadingRunDefaults(false);
        return;
      }
    }

    const cachedOptions = readRunSelectionOptionsCache(catalogProjectId);
    if (cachedOptions) {
      if (!isCurrentRequest()) {
        return;
      }
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
      const options = await getRunSelectionOptionsWithCache(catalogProjectId);
      if (!isCurrentRequest()) {
        return;
      }
      setRunProviderOptions(options.providers);
      setRunAgentOptions(options.agents);
      setRunModelOptions(options.models);
      applyResolvedRunDefaults({
        agentId: defaultRunAgent(),
        providerId: defaultRunProvider(),
        modelId: defaultRunModel(),
      });
    } catch {
      if (!isCurrentRequest()) {
        return;
      }
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
      setRunDefaultsError("Failed to load run defaults.");
    } finally {
      if (isCurrentRequest()) {
        setIsLoadingRunDefaults(false);
      }
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

  const projectEnvVarError = createMemo(() => getProjectEnvVarError(envVars()));

  const isDeleteConfirmationEnabled = createMemo(() => {
    const projectId = deleteProjectId()?.trim() ?? "";
    if (!projectId) return false;
    return (
      deleteConfirmationInput().trim() === deleteProjectName().trim() &&
      deleteProjectName().trim().length > 0
    );
  });

  const resetDeleteModalState = () => {
    setIsDeleteModalOpen(false);
    setDeleteProjectId(null);
    setDeleteProjectName("");
    setDeleteConfirmationInput("");
    setDeleteError("");
  };

  const resetForm = () => {
    clearProjectSettingsAutosaveState();
    setMode("create");
    setEditingProjectId(null);
    setLoadedProjectName("");
    setName("");
    setKey("");
    setDescription("");
    setEnvVars([]);
    setRepositories([emptyRepo()]);
    setDefaultRepoIndex(0);
    setDefaultRunProvider("");
    setDefaultRunAgent("");
    setDefaultRunModelSignal("");
    setIsKeyEdited(false);
    setTouched({});
    setError("");
    resetDeleteModalState();
  };

  const normalizeOptionalValue = (value: string | null | undefined) => {
    const normalized = value?.trim() || "";
    return normalized.length > 0 ? normalized : undefined;
  };

  const normalizePersistedRepositoryName = (
    repository: Project["repositories"][number],
  ) => {
    const normalizedName = normalizeOptionalValue(repository.name);
    const normalizedPath = repository.path.trim();
    if (!normalizedName || normalizedName === normalizedPath) {
      return undefined;
    }
    return normalizedName;
  };

  const toProjectPayloadFromPersisted = (
    project: Project,
  ): CreateProjectInput => {
    const normalizedEnvVars = normalizeProjectEnvVars(project.envVars ?? []);
    return {
      name: project.name.trim(),
      key: normalizeProjectKey(project.key),
      description: normalizeOptionalValue(project.description),
      defaultRunProvider: project.defaultRunProvider?.trim() || "",
      defaultRunModel: project.defaultRunModel?.trim() || "",
      defaultRunAgent: normalizeOptionalValue(project.defaultRunAgent),
      envVars: normalizedEnvVars.length > 0 ? normalizedEnvVars : undefined,
      repositories: project.repositories.map((repository) => ({
        id: repository.id,
        path: repository.path.trim(),
        name: normalizePersistedRepositoryName(repository),
        is_default: repository.is_default === true,
        setup_script: normalizeOptionalValue(repository.setup_script),
        cleanup_script: normalizeOptionalValue(repository.cleanup_script),
      })),
    };
  };

  const draftSignature = (payload: CreateProjectInput) =>
    JSON.stringify(payload);

  const clearProjectSettingsAutosaveTimers = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (autosaveMaxWaitTimer) {
      clearTimeout(autosaveMaxWaitTimer);
      autosaveMaxWaitTimer = null;
    }
  };

  const clearProjectSettingsAutosaveState = () => {
    clearProjectSettingsAutosaveTimers();
    autosaveQueued = false;
    setAutosaveState("idle");
    setHasPendingProjectChanges(false);
    lastPersistedDraftSignature = "";
  };

  const applyProjectToForm = (project: Project) => {
    const nextRepositories = project.repositories.map((repository) => ({
      id: repository.id,
      path: repository.path,
      name: normalizePersistedRepositoryName(repository) ?? "",
      setupScript: repository.setup_script ?? "",
      cleanupScript: repository.cleanup_script ?? "",
    }));

    setMode("edit");
    setEditingProjectId(project.id);
    setLoadedProjectName(project.name);
    setName(project.name);
    setKey(project.key);
    setDescription(project.description ?? "");
    setEnvVars(project.envVars ?? []);
    setRepositories(
      nextRepositories.length > 0 ? nextRepositories : [emptyRepo()],
    );
    applyResolvedRunDefaults({
      agentId: project.defaultRunAgent,
      providerId: project.defaultRunProvider,
      modelId: project.defaultRunModel,
    });
    const defaultRepositoryIndex = project.repositories.findIndex(
      (repository) => repository.is_default,
    );
    setDefaultRepoIndex(
      defaultRepositoryIndex >= 0 ? defaultRepositoryIndex : 0,
    );
    setIsKeyEdited(project.key.trim().length > 0);
    setTouched({});
  };

  const syncPersistedProject = (project: Project) => {
    const persistedSignature = draftSignature(
      toProjectPayloadFromPersisted(project),
    );
    lastPersistedDraftSignature = persistedSignature;
    setLoadedProjectName(project.name);
    setError("");
    setProjects((currentProjects) => {
      let found = false;
      const nextProjects = currentProjects.map((currentProject) => {
        if (currentProject.id !== project.id) return currentProject;
        found = true;
        return project;
      });
      return found ? nextProjects : currentProjects;
    });

    const { payload: currentPayload } = buildProjectPayload();
    if (!currentPayload) {
      setHasPendingProjectChanges(true);
      return persistedSignature;
    }

    const currentSignature = draftSignature(currentPayload);
    setHasPendingProjectChanges(currentSignature !== persistedSignature);
    return persistedSignature;
  };

  const buildProjectPayload = (markTouched = false) => {
    if (!name().trim()) {
      if (markTouched) {
        setTouched((prev) => ({ ...prev, name: true }));
      }
      return {
        payload: null,
        validationError: "Project name is required.",
      };
    }

    if (!key().trim()) {
      if (markTouched) {
        setTouched((prev) => ({ ...prev, key: true }));
      }
      return {
        payload: null,
        validationError: "Project key is required.",
      };
    }

    if (projectKeyError()) {
      if (markTouched) {
        setTouched((prev) => ({ ...prev, key: true }));
      }
      return {
        payload: null,
        validationError: projectKeyError(),
      };
    }

    const normalizedRepositories = repositories().map((repo) => ({
      id: repo.id,
      path: repo.path.trim(),
      name: repo.name.trim(),
      setup_script: repo.setupScript.trim(),
      cleanup_script: repo.cleanupScript.trim(),
    }));
    const normalizedEnvVars = normalizeProjectEnvVars(envVars());

    if (normalizedRepositories.some((repo) => !repo.path)) {
      return {
        payload: null,
        validationError: "Repository path is required for each entry.",
      };
    }

    if (hasInvalidDefaultRepo()) {
      return {
        payload: null,
        validationError: "Select exactly one default repository.",
      };
    }

    if (runDefaultsValidationError()) {
      return {
        payload: null,
        validationError: runDefaultsValidationError(),
      };
    }

    if (projectEnvVarError()) {
      return {
        payload: null,
        validationError: projectEnvVarError(),
      };
    }

    return {
      payload: {
        name: name().trim(),
        key: normalizeProjectKey(key()),
        description: description().trim() || undefined,
        defaultRunProvider: defaultRunProvider().trim(),
        defaultRunModel: defaultRunModel().trim(),
        defaultRunAgent: defaultRunAgent().trim() || undefined,
        envVars: normalizedEnvVars.length > 0 ? normalizedEnvVars : undefined,
        repositories: normalizedRepositories.map((repo, index) => ({
          id: repo.id,
          path: repo.path,
          name: repo.name || undefined,
          is_default: index === defaultRepoIndex(),
          setup_script: repo.setup_script || undefined,
          cleanup_script: repo.cleanup_script || undefined,
        })),
      } satisfies CreateProjectInput,
      validationError: "",
    };
  };

  const markProjectSettingsDirty = () => {
    if (mode() !== "edit") return;
    setHasPendingProjectChanges(true);
    setError("");
    if (autosaveState() === "saved" || autosaveState() === "error") {
      setAutosaveState("idle");
    }
    scheduleProjectSettingsAutosave();
  };

  const flushProjectSettingsAutosaveNow = async () => {
    if (mode() !== "edit") return true;
    return flushProjectSettingsAutosave("submit");
  };

  const flushProjectSettingsAutosave = async (
    _reason: "debounced" | "max-wait" | "submit" | "route-change" | "unmount",
  ): Promise<boolean> => {
    clearProjectSettingsAutosaveTimers();

    if (mode() !== "edit") return true;

    const activeProjectId = editingProjectId()?.trim() || "";
    if (!activeProjectId) return true;

    const { payload, validationError } = buildProjectPayload(true);
    if (!payload) {
      setAutosaveState("error");
      setError(validationError);
      return false;
    }

    const nextSignature = draftSignature(payload);
    if (nextSignature === lastPersistedDraftSignature) {
      setHasPendingProjectChanges(false);
      setAutosaveState("idle");
      setError("");
      return true;
    }

    if (autosaveInFlight) {
      autosaveQueued = true;
      return currentAutosavePromise ?? false;
    }

    const requestVersion = ++editMutationVersion;
    autosaveInFlight = true;
    setAutosaveState("saving");
    let didPersist = false;

    const requestPromise = (async () => {
      try {
        const updatedProject = await updateProject(activeProjectId, payload);

        if (requestVersion !== editMutationVersion) return false;
        if ((editingProjectId()?.trim() || "") !== activeProjectId)
          return false;

        const persistedSignature = syncPersistedProject(updatedProject);
        const { payload: currentPayload } = buildProjectPayload();
        const currentSignature = currentPayload
          ? draftSignature(currentPayload)
          : null;
        if (currentSignature === persistedSignature) {
          setAutosaveState("saved");
        }
        didPersist = true;
      } catch (submitError) {
        if (requestVersion !== editMutationVersion) return false;
        if ((editingProjectId()?.trim() || "") !== activeProjectId)
          return false;
        const backendMessage = getCreateProjectErrorMessage(submitError);
        setAutosaveState("error");
        setError(
          backendMessage
            ? `Failed to autosave project settings. ${backendMessage}`
            : "Failed to autosave project settings.",
        );
      } finally {
        if (requestVersion === editMutationVersion) {
          autosaveInFlight = false;
        }
      }

      if (requestVersion !== editMutationVersion) return false;

      if (autosaveQueued) {
        autosaveQueued = false;
        return flushProjectSettingsAutosave("debounced");
      }

      return didPersist;
    })();

    currentAutosavePromise = requestPromise;

    try {
      return await requestPromise;
    } finally {
      if (currentAutosavePromise === requestPromise) {
        currentAutosavePromise = null;
      }
    }
  };

  const scheduleProjectSettingsAutosave = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    autosaveTimer = setTimeout(() => {
      void flushProjectSettingsAutosave("debounced");
    }, AUTOSAVE_DEBOUNCE_MS);

    if (!autosaveMaxWaitTimer) {
      autosaveMaxWaitTimer = setTimeout(() => {
        void flushProjectSettingsAutosave("max-wait");
      }, AUTOSAVE_MAX_WAIT_MS);
    }
  };

  const flushQueuedProjectSettingsAutosave = async (): Promise<boolean> => {
    return flushProjectSettingsAutosave("debounced");
  };

  const syncProjectRoute = async (projectId: string) => {
    const requestVersion = ++projectRouteSyncVersion;
    const nextProjectId = projectId.trim();

    if (!nextProjectId) {
      if (mode() !== "create") {
        await flushQueuedProjectSettingsAutosave();
        if (requestVersion !== projectRouteSyncVersion) return;
        resetForm();
      }
      return;
    }

    if (mode() === "edit" && editingProjectId() === nextProjectId) {
      return;
    }

    if (mode() === "edit" && editingProjectId()) {
      await flushQueuedProjectSettingsAutosave();
      if (requestVersion !== projectRouteSyncVersion) return;
    }

    await onEditProject(nextProjectId);
  };

  const resetFormWithAutosave = async () => {
    await flushQueuedProjectSettingsAutosave();
    resetForm();
  };

  const updateName = (value: string) => {
    setName(value);
    if (!isKeyEdited() || !key().trim()) {
      setKey(recommendProjectKey(value));
    }
    markProjectSettingsDirty();
  };

  const updateKey = (value: string) => {
    const normalizedKey = normalizeProjectKey(value);
    setIsKeyEdited(normalizedKey.length > 0);
    setKey(normalizedKey);
    setTouched((prev) => ({ ...prev, key: true }));
    markProjectSettingsDirty();
  };

  const addRepository = () => {
    setRepositories((prev) => [...prev, emptyRepo()]);
    markProjectSettingsDirty();
  };

  const addEnvVar = () => {
    setEnvVars((prev) => [...prev, emptyEnvVar()]);
    markProjectSettingsDirty();
  };

  const removeEnvVar = (index: number) => {
    setEnvVars((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    markProjectSettingsDirty();
  };

  const updateEnvVar = (
    index: number,
    field: keyof EnvVarInput,
    value: string,
  ) => {
    setEnvVars((prev) =>
      prev.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
    markProjectSettingsDirty();
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
    markProjectSettingsDirty();
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
    markProjectSettingsDirty();
  };

  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (
    event,
  ) => {
    event.preventDefault();
    setError("");

    if (mode() === "edit") {
      await flushQueuedProjectSettingsAutosave();
      return;
    }

    const { payload, validationError } = buildProjectPayload(true);
    if (!payload) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
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

  const searchRepositoryDirectories = (query: string, limit?: number) =>
    searchLocalDirectories({ query, limit });

  const onEditProject = async (projectId: string) => {
    const requestVersion = ++projectLoadRequestVersion;
    setError("");
    clearProjectSettingsAutosaveTimers();
    autosaveQueued = false;
    setAutosaveState("idle");
    setHasPendingProjectChanges(false);
    setIsLoadingProjectForEdit(true);
    setEditingProjectId(projectId);
    try {
      await loadRunSelectionOptions();
      const projectDetails = await getProject(projectId);
      if (requestVersion !== projectLoadRequestVersion) return;
      if ((editingProjectId()?.trim() || "") !== projectId.trim()) return;
      applyProjectToForm(projectDetails);
      syncPersistedProject(projectDetails);
    } catch (loadError) {
      if (requestVersion !== projectLoadRequestVersion) return;
      if ((editingProjectId()?.trim() || "") !== projectId.trim()) return;
      const backendMessage = getCreateProjectErrorMessage(loadError);
      setError(
        backendMessage
          ? `Failed to load project for editing. ${backendMessage}`
          : "Failed to load project for editing. Please try again.",
      );
      setMode("create");
      setEditingProjectId(null);
      setLoadedProjectName("");
      setAutosaveState("idle");
      setHasPendingProjectChanges(false);
    } finally {
      if (requestVersion === projectLoadRequestVersion) {
        setIsLoadingProjectForEdit(false);
      }
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
    resetDeleteModalState();
  };

  const onOpenDeleteModal = (project: Pick<Project, "id" | "name">) => {
    setDeleteProjectId(project.id);
    setDeleteProjectName(project.name);
    setDeleteConfirmationInput("");
    setDeleteError("");
    setIsDeleteModalOpen(true);
  };

  const onOpenDeleteCurrentProject = async () => {
    const projectId = editingProjectId()?.trim() ?? "";
    if (!projectId || mode() !== "edit") return;

    await flushQueuedProjectSettingsAutosave();

    onOpenDeleteModal({
      id: projectId,
      name: loadedProjectName().trim() || name().trim(),
    });
  };

  const onConfirmDeleteProject = async () => {
    const projectId = deleteProjectId();
    if (!projectId || !isDeleteConfirmationEnabled()) return;

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
        const nextProjects = await loadProjects();
        window.dispatchEvent(
          new CustomEvent("projects:updated", { detail: nextProjects }),
        );

        if (editingProjectId() === projectId) {
          resetForm();
        } else {
          resetDeleteModalState();
        }

        const nextProject = nextProjects[0];
        if (nextProject) {
          navigate(buildBoardHref(nextProject.id));
          return;
        }

        navigate("/projects");
      } catch (refreshError) {
        const backendMessage = getCreateProjectErrorMessage(refreshError);
        setDeleteError(
          backendMessage
            ? `Project deleted, but failed to refresh projects. ${backendMessage}`
            : "Project deleted, but failed to refresh projects. Please refresh the page.",
        );
        return;
      }
    } finally {
      setIsDeletingProject(false);
    }
  };

  onCleanup(() => {
    projectRouteSyncVersion += 1;
    if (mode() === "edit" && hasPendingProjectChanges()) {
      void flushQueuedProjectSettingsAutosave();
    } else {
      clearProjectSettingsAutosaveTimers();
    }
  });

  return {
    mode,
    editingProjectId,
    projects,
    name,
    key,
    description,
    envVars,
    repositories,
    defaultRepoIndex,
    error,
    autosaveState,
    hasPendingProjectChanges,
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
    projectEnvVarError,
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
    deleteConfirmationInput,
    deleteError,
    isDeletingProject,
    isDeleteConfirmationEnabled,
    projectKeyError,
    cloneProjectKeyError,
    cloneRepositoryDestinationError,
    setDescription: (value: string) => {
      setDescription(value);
      markProjectSettingsDirty();
    },
    setTouched,
    setDefaultRunProvider: (value: string) => {
      setDefaultRunProviderAndValidate(value);
      markProjectSettingsDirty();
    },
    setDefaultRunAgent: (value: string) => {
      setDefaultRunAgent(value);
      markProjectSettingsDirty();
    },
    setDefaultRunModel: (value: string) => {
      setDefaultRunModel(value);
      markProjectSettingsDirty();
    },
    setCloneTouched,
    setDefaultRepoIndex: (index: number) => {
      setDefaultRepoIndex(index);
      markProjectSettingsDirty();
    },
    flushProjectSettingsAutosaveNow,
    setCloneRepositoryDestination,
    setDeleteConfirmationInput,
    updateName,
    updateKey,
    updateCloneProjectKey,
    addRepository,
    addEnvVar,
    removeEnvVar,
    removeRepository,
    updateEnvVar,
    updateRepository,
    searchRepositoryDirectories,
    resetForm,
    resetFormWithAutosave,
    syncProjectRoute,
    onEditProject,
    onOpenCloneModal,
    closeCloneModal,
    onOpenDeleteModal,
    onOpenDeleteCurrentProject,
    closeDeleteModal,
    onConfirmDeleteProject,
    onSubmit,
    onSubmitClone,
  };
};
