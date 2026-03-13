import { createMemo, createSignal, onMount } from "solid-js";
import { listProjects, type Project } from "../../../app/lib/projects";
import { listProjectTasks, type Task } from "../../../app/lib/tasks";
import { groupTasksByStatus } from "../utils/board";

export const useBoardModel = () => {
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = createSignal("");
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const selectedProject = createMemo(
    () =>
      projects().find((project) => project.id === selectedProjectId()) ?? null,
  );

  const groupedTasks = createMemo(() => groupTasksByStatus(tasks()));

  const loadTasks = async (projectId: string) => {
    setIsTasksLoading(true);
    setError("");

    try {
      const loadedTasks = await listProjectTasks(projectId);
      setTasks(loadedTasks);
    } catch {
      setTasks([]);
      setError("Failed to load project tasks. Please refresh.");
    } finally {
      setIsTasksLoading(false);
    }
  };

  const onProjectChange = async (projectId: string) => {
    setSelectedProjectId(projectId);
    await loadTasks(projectId);
  };

  onMount(async () => {
    setError("");
    try {
      const loadedProjects = await listProjects();
      setProjects(loadedProjects);

      const firstProjectId = loadedProjects[0]?.id;
      if (!firstProjectId) {
        setSelectedProjectId("");
        setTasks([]);
        return;
      }

      await onProjectChange(firstProjectId);
    } catch {
      setError("Failed to load projects. Please refresh.");
      setProjects([]);
      setSelectedProjectId("");
      setTasks([]);
    } finally {
      setIsProjectsLoading(false);
    }
  });

  return {
    projects,
    selectedProjectId,
    selectedProject,
    groupedTasks,
    isProjectsLoading,
    isTasksLoading,
    error,
    onProjectChange,
  };
};
