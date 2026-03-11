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

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = (input: CreateProjectInput) =>
  invoke<Project>("create_project", { input });

export const getProject = (id: string) => invoke<Project>("get_project", { id });
