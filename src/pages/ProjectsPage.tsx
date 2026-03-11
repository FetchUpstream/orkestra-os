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
  const [touched, setTouched] = createSignal<Record<string, boolean>>({});

  const loadProjects = async () => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
  };

  onMount(loadProjects);

  const projectKeyError = createMemo(() => {
    if (!touched().key && !key().trim()) return "";
    if (!key().trim()) return "Project key is required";
    if (!isValidProjectKey(key())) return "Must be 2-4 letters or numbers";
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
    } catch {
      setError("Failed to create project. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Projects" />
      <div class="projects-layout">
        <section class="projects-panel" aria-labelledby="existing-projects-heading">
          <h2 id="existing-projects-heading" class="projects-section-title">
            Existing Projects
          </h2>
          <Show when={projects().length > 0} fallback={<p class="page-placeholder">No projects yet. Create your first project to get started.</p>}>
            <ul class="projects-list" role="list">
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

        <section class="projects-panel" aria-labelledby="create-project-heading">
          <h2 id="create-project-heading" class="projects-section-title">
            Create Project
          </h2>
          <form class="projects-form" onSubmit={onSubmit}>
            <div class="form-section">
              <div>
                <h3 class="form-section-title">Project Identity</h3>
                <p class="form-section-subtitle">Define the basic information for your project.</p>
              </div>

              <label class="projects-field">
                <span class="field-label">
                  <span class="field-label-text">Project name</span>
                </span>
                <input
                  value={name()}
                  onInput={(event) => updateName(event.currentTarget.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                  placeholder="Enter project name"
                  required
                  aria-required="true"
                />
              </label>

              <label class="projects-field">
                <span class="field-label">
                  <span class="field-label-text">Project key</span>
                </span>
                <input
                  value={key()}
                  onInput={(event) => updateKey(event.currentTarget.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, key: true }))}
                  minlength={2}
                  maxlength={4}
                  placeholder="e.g., PROJ"
                  required
                  aria-required="true"
                  aria-invalid={!!projectKeyError()}
                  aria-describedby={projectKeyError() ? "key-error" : "key-help"}
                />
                <Show when={projectKeyError()} fallback={<p id="key-help" class="field-help">A short identifier used in references. Auto-generated from the project name.</p>}>
                  <p id="key-error" class="field-error">{projectKeyError()}</p>
                </Show>
              </label>

              <label class="projects-field">
                <span class="field-label">
                  <span class="field-label-text">Description</span>
                  <span class="field-optional">optional</span>
                </span>
                <textarea
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  placeholder="Brief description of the project"
                  rows={3}
                />
              </label>
            </div>

            <div class="form-section">
              <div class="projects-repos-block">
                <div class="projects-repos-head">
                  <div>
                    <h3 class="projects-repos-title">Repositories</h3>
                    <p class="projects-repos-subtitle">Add code repositories to track with this project.</p>
                  </div>
                  <button type="button" class="projects-button-muted" onClick={addRepository}>
                    Add repository
                  </button>
                </div>
                <div class="projects-repo-list" role="list">
                  <For each={repositories()}>
                    {(repo, index) => (
                      <div class="projects-repo-row" role="listitem">
                        <input
                          placeholder="Repository path"
                          value={repo.path}
                          onInput={(event) => updateRepository(index(), "path", event.currentTarget.value)}
                          required
                          aria-label={`Repository ${index() + 1} path`}
                          aria-required="true"
                        />
                        <input
                          placeholder="Display name (optional)"
                          value={repo.name}
                          onInput={(event) => updateRepository(index(), "name", event.currentTarget.value)}
                          aria-label={`Repository ${index() + 1} display name`}
                        />
                        <label class="projects-default-label">
                          <input
                            type="radio"
                            name="default-repository"
                            checked={defaultRepoIndex() === index()}
                            onChange={() => setDefaultRepoIndex(index())}
                            aria-label={`Set repository ${index() + 1} as default`}
                          />
                          Default
                        </label>
                        <div class="repo-actions">
                          <button
                            type="button"
                            class="projects-button-danger"
                            onClick={() => removeRepository(index())}
                            disabled={repositories().length === 1}
                            title={repositories().length === 1 ? "Cannot remove the only repository" : "Remove repository"}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>

            <Show when={error()}>
              <div class="projects-error" role="alert" aria-live="polite">
                {error()}
              </div>
            </Show>

            <div class="form-actions">
              <button type="submit" class="projects-button-primary" disabled={isSubmitting()}>
                {isSubmitting() ? "Creating project..." : "Create project"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
};

export default ProjectsPage;
