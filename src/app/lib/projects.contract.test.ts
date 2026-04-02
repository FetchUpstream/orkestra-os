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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cloneProject,
  createProject,
  deleteProject,
  getProject,
  updateProject,
  type CreateProjectInput,
  type Project,
} from "./projects";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("projects contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends snake_case fields in create_project payload", async () => {
    invokeMock.mockResolvedValue({
      project: { id: "project-1", name: "Orkestra", key: "ORK" },
      repositories: [
        {
          id: "repo-1",
          name: "Main",
          repo_path: "/repo/main",
          is_default: true,
        },
      ],
    });

    const input: CreateProjectInput = {
      name: "Orkestra",
      key: "ORK",
      defaultRunAgent: "agent-a",
      defaultRunProvider: "provider-a",
      defaultRunModel: "model-a",
      envVars: [{ key: "API_TOKEN", value: "secret" }],
      repositories: [{ path: "/repo/main", is_default: true }],
    };

    await createProject(input);

    expect(invokeMock).toHaveBeenCalledWith("create_project", {
      input: {
        name: "Orkestra",
        key: "ORK",
        description: undefined,
        default_run_agent: "agent-a",
        default_run_provider: "provider-a",
        default_run_model: "model-a",
        env_vars: [{ key: "API_TOKEN", value: "secret" }],
        repositories: [
          {
            repo_path: "/repo/main",
            name: "/repo/main",
            is_default: true,
            setup_script: undefined,
            cleanup_script: undefined,
          },
        ],
      },
    });
  });

  it("sends snake_case fields in update_project payload", async () => {
    invokeMock.mockResolvedValue({
      project: { id: "project-1", name: "Orkestra", key: "ORK" },
      repositories: [
        {
          id: "repo-1",
          name: "Main",
          repo_path: "/repo/main",
          is_default: true,
        },
      ],
    });

    await updateProject("project-1", {
      name: "Orkestra",
      key: "ORK",
      defaultRunAgent: "agent-a",
      defaultRunProvider: "provider-a",
      defaultRunModel: "model-a",
      envVars: [{ key: "NODE_ENV", value: "test" }],
      repositories: [{ id: "repo-1", path: "/repo/main", is_default: true }],
    });

    expect(invokeMock).toHaveBeenCalledWith("update_project", {
      id: "project-1",
      input: {
        name: "Orkestra",
        key: "ORK",
        description: undefined,
        default_run_agent: "agent-a",
        default_run_provider: "provider-a",
        default_run_model: "model-a",
        env_vars: [{ key: "NODE_ENV", value: "test" }],
        repositories: [
          {
            id: "repo-1",
            repo_path: "/repo/main",
            name: "/repo/main",
            is_default: true,
            setup_script: undefined,
            cleanup_script: undefined,
          },
        ],
      },
    });
  });

  it("normalizes wrapped get_project repository path for path and repo_path variants", async () => {
    invokeMock
      .mockResolvedValueOnce({
        project: {
          id: "project-path",
          name: "Path Project",
          key: "PAT",
          description: null,
          default_run_agent: "agent-a",
          env_vars: [{ key: "API_TOKEN", value: "secret" }],
        },
        repositories: [
          {
            id: "repo-path",
            name: "Main",
            path: "/repo/path-variant",
            is_default: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        project: {
          id: "project-repo-path",
          name: "Repo Path Project",
          key: "RPP",
          description: null,
          default_run_agent: "agent-b",
        },
        repositories: [
          {
            id: "repo-repo-path",
            name: "Tools",
            repo_path: "/repo/repo-path-variant",
            is_default: false,
          },
        ],
      });

    const withPath = await getProject("project-path");
    const withRepoPath = await getProject("project-repo-path");

    expect(withPath).toEqual({
      id: "project-path",
      name: "Path Project",
      key: "PAT",
      description: null,
      defaultRunAgent: "agent-a",
      envVars: [{ key: "API_TOKEN", value: "secret" }],
      repositories: [
        {
          id: "repo-path",
          path: "/repo/path-variant",
          name: "Main",
          is_default: true,
        },
      ],
    } satisfies Project);
    expect(withRepoPath).toEqual({
      id: "project-repo-path",
      name: "Repo Path Project",
      key: "RPP",
      description: null,
      defaultRunAgent: "agent-b",
      defaultRunProvider: undefined,
      defaultRunModel: undefined,
      envVars: undefined,
      repositories: [
        {
          id: "repo-repo-path",
          path: "/repo/repo-path-variant",
          name: "Tools",
          is_default: false,
          setup_script: undefined,
          cleanup_script: undefined,
        },
      ],
    } satisfies Project);
  });

  it("sends clone_project payload with source project id", async () => {
    invokeMock.mockResolvedValue({
      project: { id: "project-copy", name: "Orkestra - Copy", key: "ORC" },
      repositories: [
        {
          id: "repo-copy",
          name: "Main",
          repo_path: "/repo/copy",
          is_default: true,
        },
      ],
    });

    await cloneProject("project-1", {
      name: "Orkestra - Copy",
      key: "ORC",
      repository_destination: "/repo/copy",
    });

    expect(invokeMock).toHaveBeenCalledWith("clone_project", {
      sourceProjectId: "project-1",
      input: {
        name: "Orkestra - Copy",
        key: "ORC",
        repository_destination: "/repo/copy",
      },
    });
  });

  it("sends delete_project payload with project id", async () => {
    invokeMock.mockResolvedValue(null);

    await deleteProject("project-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_project", {
      id: "project-1",
    });
  });
});
