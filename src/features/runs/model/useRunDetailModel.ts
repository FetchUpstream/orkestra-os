import { useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal } from "solid-js";
import { getRun, type Run } from "../../../app/lib/runs";
import { getTask, type Task } from "../../../app/lib/tasks";

export const useRunDetailModel = () => {
  const params = useParams();
  const [run, setRun] = createSignal<Run | null>(null);
  const [task, setTask] = createSignal<Task | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let activeRunRequestVersion = 0;

  const isNotFoundError = (value: unknown): boolean => {
    if (value instanceof Error) {
      return value.message.toLowerCase().includes("not found");
    }

    if (typeof value === "string") {
      return value.toLowerCase().includes("not found");
    }

    if (!value || typeof value !== "object") {
      return false;
    }

    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage.toLowerCase().includes("not found");
    }

    return false;
  };

  const taskHref = createMemo(() => {
    const taskValue = task();
    const runId = params.runId;
    if (!taskValue) return "";
    const originSearch = runId
      ? `?origin=run&runId=${encodeURIComponent(runId)}`
      : "";
    if (taskValue.projectId) {
      return `/projects/${taskValue.projectId}/tasks/${taskValue.id}${originSearch}`;
    }
    return `/tasks/${taskValue.id}${originSearch}`;
  });

  const backHref = createMemo(() => {
    const taskValue = task();
    if (taskValue?.id) {
      if (taskValue.projectId) {
        return `/projects/${taskValue.projectId}/tasks/${taskValue.id}`;
      }
      return `/tasks/${taskValue.id}`;
    }

    const runValue = run();
    if (runValue?.taskId) {
      if (runValue.projectId) {
        return `/projects/${runValue.projectId}/tasks/${runValue.taskId}`;
      }
      return `/tasks/${runValue.taskId}`;
    }

    return "/projects";
  });

  const backLabel = createMemo(() => {
    return backHref() === "/projects" ? "projects" : "task";
  });

  createEffect(() => {
    const runId = params.runId;
    const requestVersion = ++activeRunRequestVersion;
    if (!runId) {
      setError("Missing run ID.");
      setIsLoading(false);
      setRun(null);
      setTask(null);
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError("");
      setRun(null);
      setTask(null);
      try {
        const loadedRun = await getRun(runId);
        if (
          requestVersion !== activeRunRequestVersion ||
          params.runId !== runId
        ) {
          return;
        }
        setRun(loadedRun);
        try {
          const loadedTask = await getTask(loadedRun.taskId);
          if (
            requestVersion !== activeRunRequestVersion ||
            params.runId !== runId
          ) {
            return;
          }
          setTask(loadedTask);
        } catch {
          if (
            requestVersion !== activeRunRequestVersion ||
            params.runId !== runId
          ) {
            return;
          }
          setTask(null);
        }
      } catch (loadError) {
        if (
          requestVersion !== activeRunRequestVersion ||
          params.runId !== runId
        ) {
          return;
        }
        if (isNotFoundError(loadError)) {
          setError("");
          setRun(null);
          setTask(null);
          return;
        }
        setError("Failed to load run details.");
      } finally {
        if (requestVersion === activeRunRequestVersion) {
          setIsLoading(false);
        }
      }
    })();
  });

  return {
    run,
    task,
    isLoading,
    error,
    taskHref,
    backHref,
    backLabel,
  };
};
