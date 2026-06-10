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
  runPrependInstructions?: string | null;
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
  runPrependInstructions?: string;
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

export type LocalDirectorySearchResult = {
  path: string;
  directoryName: string;
  parentPath: string;
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
    run_prepend_instructions?: string | null;
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

export const listProjects = async () =>
  (await invoke<ProjectResponse[]>("list_projects")).map(normalizeProject);

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
    run_prepend_instructions:
      input.runPrependInstructions?.trim() || undefined,
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
    runPrependInstructions: response.project.run_prepend_instructions,
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
    run_prepend_instructions:
      input.runPrependInstructions?.trim() || undefined,
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
    runPrependInstructions: response.project.run_prepend_instructions,
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
      id: string;
      name: string;
      key: string;
      description?: string | null;
      default_run_agent?: string | null;
      default_run_provider?: string | null;
      default_run_model?: string | null;
      env_vars?: ProjectEnvironmentVariable[] | null;
      run_prepend_instructions?: string | null;
      repositories?: ProjectRepository[];
    }
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
        run_prepend_instructions?: string | null;
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
      runPrependInstructions: response.project.run_prepend_instructions,
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

  if (
    "default_run_agent" in response ||
    "default_run_provider" in response ||
    "default_run_model" in response ||
    "env_vars" in response ||
    "run_prepend_instructions" in response
  ) {
    return {
      id: response.id,
      name: response.name,
      key: response.key,
      description: response.description,
      defaultRunAgent: response.default_run_agent,
      defaultRunProvider: response.default_run_provider,
      defaultRunModel: response.default_run_model,
      envVars: response.env_vars,
      runPrependInstructions: response.run_prepend_instructions,
      repositories: response.repositories ?? [],
    };
  }

  return response as Project;
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
    runPrependInstructions: response.project.run_prepend_instructions,
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

export const searchLocalDirectories = async (input: {
  query: string;
  limit?: number;
}): Promise<LocalDirectorySearchResult[]> => {
  const response = await invoke<
    Array<{
      path: string;
      directory_name: string;
      parent_path: string;
    }>
  >("search_local_directories", {
    input: {
      query: input.query,
      limit: input.limit,
    },
  });

  return response.map((entry) => ({
    path: entry.path,
    directoryName: entry.directory_name,
    parentPath: entry.parent_path,
  }));
};
