import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onMount, type JSX } from "solid-js";
import {
  createProject,
  listProjects,
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
  const [isKeyEdited, setIsKeyEdited] = createSignal(false);
  const [touched, setTouched] = createSignal<Record<string, boolean>>({});

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
  };

  onMount(loadProjects);

  const projectKeyError = createProjectKeyError(key, touched);

  const hasInvalidDefaultRepo = createMemo(() => {
    const index = defaultRepoIndex();
    return index < 0 || index >= repositories().length;
  });

  const resetForm = () => {
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
      const createdProject = await createProject({
        name: name().trim(),
        key: normalizeProjectKey(key()),
        description: description().trim() || undefined,
        repositories: normalizedRepositories.map((repo, index) => ({
          path: repo.path,
          name: repo.name || undefined,
          is_default: index === defaultRepoIndex(),
        })),
      });
      await loadProjects();
      resetForm();
      navigate(`/projects/${createdProject.id}`);
    } catch (createError) {
      const backendMessage = getCreateProjectErrorMessage(createError);
      setError(
        backendMessage
          ? `Failed to create project. ${backendMessage}`
          : "Failed to create project. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    projects,
    name,
    key,
    description,
    repositories,
    defaultRepoIndex,
    error,
    isSubmitting,
    touched,
    projectKeyError,
    setDescription,
    setTouched,
    setDefaultRepoIndex,
    updateName,
    updateKey,
    addRepository,
    removeRepository,
    updateRepository,
    onSubmit,
  };
};
