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

import { invoke } from "@tauri-apps/api/core";

export type ProjectRepository = {
  id?: string;
  path: string;
  name?: string | null;
  is_default?: boolean;
  setup_script?: string | null;
  cleanup_script?: string | null;
};

export type ProjectEnvironmentVariable = {
  key: string;
  value: string;
};

export type Project = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  defaultRunAgent?: string | null;
  defaultRunProvider?: string | null;
  defaultRunModel?: string | null;
  envVars?: ProjectEnvironmentVariable[] | null;
  repositories: ProjectRepository[];
};

export type CreateProjectInput = {
  name: string;
  key: string;
  description?: string;
  defaultRunAgent?: string;
  defaultRunProvider: string;
  defaultRunModel: string;
  envVars?: ProjectEnvironmentVariable[];
  repositories: Array<{
    id?: string;
    path: string;
    name?: string;
    is_default: boolean;
    setup_script?: string;
    cleanup_script?: string;
  }>;
};

export type UpdateProjectInput = CreateProjectInput;

export type CloneProjectInput = {
  name: string;
  key: string;
  repository_destination: string;
};

type ProjectDetailsResponse = {
  project: {
    id: string;
    name: string;
    key: string;
    description?: string | null;
    default_run_agent?: string | null;
    default_run_provider?: string | null;
    default_run_model?: string | null;
    env_vars?: ProjectEnvironmentVariable[] | null;
  };
  repositories: Array<{
    id: string;
    name: string;
    repo_path: string;
    is_default: boolean;
    setup_script?: string | null;
    cleanup_script?: string | null;
  }>;
};

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = async (
  input: CreateProjectInput,
): Promise<Project> => {
  const payload = {
    name: input.name,
    key: input.key,
    description: input.description,
    default_run_agent: input.defaultRunAgent?.trim() || undefined,
    default_run_provider: input.defaultRunProvider,
    default_run_model: input.defaultRunModel,
    env_vars: input.envVars?.length ? input.envVars : undefined,
    repositories: input.repositories.map((repository) => ({
      repo_path: repository.path,
      name: repository.name ?? repository.path,
      is_default: repository.is_default,
      setup_script: repository.setup_script?.trim() || undefined,
      cleanup_script: repository.cleanup_script?.trim() || undefined,
    })),
  };

  const response = await invoke<ProjectDetailsResponse>("create_project", {
    input: payload,
  });
  return {
    id: response.project.id,
    name: response.project.name,
    key: response.project.key,
    description: response.project.description,
    defaultRunAgent: response.project.default_run_agent,
    defaultRunProvider: response.project.default_run_provider,
    defaultRunModel: response.project.default_run_model,
    envVars: response.project.env_vars,
    repositories: response.repositories.map((repository) => ({
      id: repository.id,
      path: repository.repo_path,
      name: repository.name,
      is_default: repository.is_default,
      setup_script: repository.setup_script,
      cleanup_script: repository.cleanup_script,
    })),
  };
};

export const updateProject = async (
  id: string,
  input: UpdateProjectInput,
): Promise<Project> => {
  const payload = {
    name: input.name,
    key: input.key,
    description: input.description,
    default_run_agent: input.defaultRunAgent?.trim() || undefined,
    default_run_provider: input.defaultRunProvider,
    default_run_model: input.defaultRunModel,
    env_vars: input.envVars?.length ? input.envVars : undefined,
    repositories: input.repositories.map((repository) => ({
      id: repository.id,
      repo_path: repository.path,
      name: repository.name ?? repository.path,
      is_default: repository.is_default,
      setup_script: repository.setup_script?.trim() || undefined,
      cleanup_script: repository.cleanup_script?.trim() || undefined,
    })),
  };

  const response = await invoke<ProjectDetailsResponse>("update_project", {
    id,
    input: payload,
  });

  return {
    id: response.project.id,
    name: response.project.name,
    key: response.project.key,
    description: response.project.description,
    defaultRunAgent: response.project.default_run_agent,
    defaultRunProvider: response.project.default_run_provider,
    defaultRunModel: response.project.default_run_model,
    envVars: response.project.env_vars,
    repositories: response.repositories.map((repository) => ({
      id: repository.id,
      path: repository.repo_path,
      name: repository.name,
      is_default: repository.is_default,
      setup_script: repository.setup_script,
      cleanup_script: repository.cleanup_script,
    })),
  };
};

type ProjectResponse =
  | Project
  | {
      project: {
        id: string;
        name: string;
        key: string;
        description?: string | null;
        default_run_agent?: string | null;
        default_run_provider?: string | null;
        default_run_model?: string | null;
        env_vars?: ProjectEnvironmentVariable[] | null;
      };
      repositories: Array<{
        id?: string;
        name?: string | null;
        path?: string;
        repo_path?: string;
        is_default?: boolean;
        setup_script?: string | null;
        cleanup_script?: string | null;
      }>;
    };

const normalizeProject = (response: ProjectResponse): Project => {
  if ("project" in response) {
    return {
      id: response.project.id,
      name: response.project.name,
      key: response.project.key,
      description: response.project.description,
      defaultRunAgent: response.project.default_run_agent,
      defaultRunProvider: response.project.default_run_provider,
      defaultRunModel: response.project.default_run_model,
      envVars: response.project.env_vars,
      repositories: response.repositories.map((repository) => ({
        id: repository.id,
        path: repository.path ?? repository.repo_path ?? "",
        name: repository.name,
        is_default: repository.is_default,
        setup_script: repository.setup_script,
        cleanup_script: repository.cleanup_script,
      })),
    };
  }

  return response;
};

export const getProject = async (id: string): Promise<Project> => {
  const response = await invoke<ProjectResponse>("get_project", { id });
  return normalizeProject(response);
};

export const cloneProject = async (
  sourceProjectId: string,
  input: CloneProjectInput,
): Promise<Project> => {
  const response = await invoke<ProjectDetailsResponse>("clone_project", {
    sourceProjectId,
    input,
  });
  return {
    id: response.project.id,
    name: response.project.name,
    key: response.project.key,
    description: response.project.description,
    defaultRunAgent: response.project.default_run_agent,
    defaultRunProvider: response.project.default_run_provider,
    defaultRunModel: response.project.default_run_model,
    envVars: response.project.env_vars,
    repositories: response.repositories.map((repository) => ({
      id: repository.id,
      path: repository.repo_path,
      name: repository.name,
      is_default: repository.is_default,
      setup_script: repository.setup_script,
      cleanup_script: repository.cleanup_script,
    })),
  };
};

export const deleteProject = async (id: string): Promise<void> => {
  await invoke("delete_project", { id });
};

export const searchProjectFiles = async (input: {
  projectId: string;
  repositoryId: string;
  query: string;
  limit?: number;
}): Promise<string[]> => {
  return invoke<string[]>("search_project_files", {
    input: {
      project_id: input.projectId,
      repository_id: input.repositoryId,
      query: input.query,
      limit: input.limit,
    },
  });
};
