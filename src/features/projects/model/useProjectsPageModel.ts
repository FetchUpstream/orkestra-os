import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onMount, type JSX } from "solid-js";
import {
  cloneProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
  type Project,
} from "../../../app/lib/projects";
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
  const [isSubmitting, setIsSubmitting] = createSignal(false);
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

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
  };

  onMount(loadProjects);

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
    }));

    if (normalizedRepositories.some((repo) => !repo.path)) {
      setError("Repository path is required for each entry.");
      return;
    }

    if (hasInvalidDefaultRepo()) {
      setError("Select exactly one default repository.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: name().trim(),
        key: normalizeProjectKey(key()),
        description: description().trim() || undefined,
        repositories: normalizedRepositories.map((repo, index) => ({
          id: repo.id,
          path: repo.path,
          name: repo.name || undefined,
          is_default: index === defaultRepoIndex(),
        })),
      };
      const activeEditProjectId = editingProjectId();

      if (mode() === "edit" && activeEditProjectId) {
        await updateProject(activeEditProjectId, payload);
        await loadProjects();
        resetForm();
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
        }),
      );

      setMode("edit");
      setName(projectDetails.name);
      setKey(projectDetails.key);
      setDescription(projectDetails.description ?? "");
      setRepositories(
        nextRepositories.length > 0 ? nextRepositories : [emptyRepo()],
      );
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
    isSubmitting,
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
    projectKeyError,
    cloneProjectKeyError,
    cloneRepositoryDestinationError,
    setDescription,
    setTouched,
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
    onSubmit,
    onSubmitClone,
  };
};
