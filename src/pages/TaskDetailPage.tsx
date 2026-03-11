import type { Component } from "solid-js";
import { useParams } from "@solidjs/router";
import PageHeader from "../components/layout/PageHeader";

const TaskDetailPage: Component = () => {
  const params = useParams();
  return (
    <>
      <PageHeader title={`Task ${params.taskId}`} />
      <p class="page-placeholder">Task details and actions.</p>
    </>
  );
};

export default TaskDetailPage;
