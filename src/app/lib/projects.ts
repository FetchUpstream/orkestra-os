import { invoke } from "@tauri-apps/api/core";

export type ProjectRepository = {
  id?: string;
  path: string;
  name?: string | null;
  is_default?: boolean;
};

export type Project = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  repositories: ProjectRepository[];
};

export type CreateProjectInput = {
  name: string;
  key: string;
  description?: string;
  repositories: Array<{
    path: string;
    name?: string;
    is_default: boolean;
  }>;
};

type ProjectDetailsResponse = {
  project: {
    id: string;
    name: string;
    key: string;
    description?: string | null;
  };
  repositories: Array<{
    id: string;
    name: string;
    repo_path: string;
    is_default: boolean;
  }>;
};

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = async (input: CreateProjectInput): Promise<Project> => {
  const payload = {
    ...input,
    repositories: input.repositories.map((repository) => ({
      repo_path: repository.path,
      name: repository.name ?? repository.path,
      is_default: repository.is_default,
    })),
  };

  const response = await invoke<ProjectDetailsResponse>("create_project", { input: payload });
  return {
    id: response.project.id,
    name: response.project.name,
    key: response.project.key,
    description: response.project.description,
    repositories: response.repositories.map((repository) => ({
      id: repository.id,
      path: repository.repo_path,
      name: repository.name,
      is_default: repository.is_default,
    })),
  };
};

export const getProject = (id: string) => invoke<Project>("get_project", { id });
