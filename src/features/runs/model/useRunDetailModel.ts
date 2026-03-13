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

  const taskHref = createMemo(() => {
    const taskValue = task();
    if (!taskValue) return "";
    if (taskValue.projectId) {
      return `/projects/${taskValue.projectId}/tasks/${taskValue.id}`;
    }
    return `/tasks/${taskValue.id}`;
  });

  createEffect(() => {
    const runId = params.runId;
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
        setRun(loadedRun);
        try {
          const loadedTask = await getTask(loadedRun.taskId);
          setTask(loadedTask);
        } catch {
          setTask(null);
        }
      } catch {
        setError("Failed to load run details.");
      } finally {
        setIsLoading(false);
      }
    })();
  });

  return {
    run,
    task,
    isLoading,
    error,
    taskHref,
  };
};
