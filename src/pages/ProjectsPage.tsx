import { A, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, onMount, Show, type Component, type JSX } from "solid-js";
import { createProject, listProjects, type Project } from "../app/lib/projects";
import { isValidProjectKey, normalizeProjectKey, recommendProjectKey } from "../app/lib/projectKey";
import PageHeader from "../components/layout/PageHeader";

type RepoInput = {
  path: string;
  name: string;
};

const emptyRepo = (): RepoInput => ({ path: "", name: "" });

const ProjectsPage: Component = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [repositories, setRepositories] = createSignal<RepoInput[]>([emptyRepo()]);
  const [defaultRepoIndex, setDefaultRepoIndex] = createSignal(0);
  const [error, setError] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isKeyEdited, setIsKeyEdited] = createSignal(false);

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
  };

  onMount(loadProjects);

  const projectKeyError = createMemo(() => {
    if (!key().trim()) return "Project key is required.";
    if (!isValidProjectKey(key())) return "Project key must be 2 to 4 letters or numbers.";
    return "";
  });

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

  const updateRepository = (index: number, field: keyof RepoInput, value: string) => {
    setRepositories((prev) =>
      prev.map((repo, itemIndex) => (itemIndex === index ? { ...repo, [field]: value } : repo)),
    );
  };

  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault();
    setError("");

    if (!name().trim()) {
      setError("Project name is required.");
      return;
    }

    if (projectKeyError()) {
      setError(projectKeyError());
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
    } catch {
      setError("Failed to create project.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Projects" />
      <div class="projects-layout">
        <section class="projects-panel">
          <h3 class="projects-section-title">Existing projects</h3>
          <Show when={projects().length > 0} fallback={<p class="page-placeholder">No projects yet.</p>}>
            <ul class="projects-list">
              <For each={projects()}>
                {(project) => (
                  <li class="projects-list-item">
                    <div>
                      <p class="projects-list-name">{project.name}</p>
                      <p class="projects-list-meta">{project.key}</p>
                    </div>
                    <A href={`/projects/${project.id}`} class="projects-open-link">
                      Open
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="projects-panel">
          <h3 class="projects-section-title">Create project</h3>
          <form class="projects-form" onSubmit={onSubmit}>
            <label class="projects-field">
              <span>Project name</span>
              <input value={name()} onInput={(event) => updateName(event.currentTarget.value)} required />
            </label>

            <label class="projects-field">
              <span>Project key (2-4)</span>
              <input
                value={key()}
                onInput={(event) => updateKey(event.currentTarget.value)}
                minlength={2}
                maxlength={4}
                required
              />
            </label>

            <label class="projects-field">
              <span>Description (optional)</span>
              <textarea
                value={description()}
                onInput={(event) => setDescription(event.currentTarget.value)}
                rows={3}
              />
            </label>

            <div class="projects-repos-block">
              <div class="projects-repos-head">
                <span>Repositories</span>
                <button type="button" class="projects-button-muted" onClick={addRepository}>
                  Add repo
                </button>
              </div>
              <For each={repositories()}>
                {(repo, index) => (
                  <div class="projects-repo-row">
                    <input
                      placeholder="Repository path"
                      value={repo.path}
                      onInput={(event) => updateRepository(index(), "path", event.currentTarget.value)}
                      required
                    />
                    <input
                      placeholder="Display name (optional)"
                      value={repo.name}
                      onInput={(event) => updateRepository(index(), "name", event.currentTarget.value)}
                    />
                    <label class="projects-default-label">
                      <input
                        type="radio"
                        name="default-repository"
                        checked={defaultRepoIndex() === index()}
                        onChange={() => setDefaultRepoIndex(index())}
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      class="projects-button-muted"
                      onClick={() => removeRepository(index())}
                      disabled={repositories().length === 1}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>

            <Show when={error()}>
              <p class="projects-error">{error()}</p>
            </Show>

            <button type="submit" class="projects-button-primary" disabled={isSubmitting()}>
              {isSubmitting() ? "Creating..." : "Create project"}
            </button>
          </form>
        </section>
      </div>
    </>
  );
};

export default ProjectsPage;
