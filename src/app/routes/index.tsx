import { Route } from "@solidjs/router";
import type { Component } from "solid-js";
import AppShell from "../layouts/AppShell";
import BoardPage from "../../pages/BoardPage";
import NotFoundPage from "../../pages/NotFoundPage";
import ProjectDetailPage from "../../pages/ProjectDetailPage";
import ProjectsPage from "../../pages/ProjectsPage";
import RunDetailPage from "../../pages/RunDetailPage";
import TaskDetailPage from "../../pages/TaskDetailPage";

const AppRoutes: Component = () => {
  return (
    <>
      <Route path="/" component={AppShell}>
        <Route path="/" component={BoardPage} />
        <Route path="/board" component={BoardPage} />
        <Route path="/tasks/:taskId" component={TaskDetailPage} />
        <Route
          path="/projects/:projectId/tasks/:taskId"
          component={TaskDetailPage}
        />
        <Route path="/runs/:runId" component={RunDetailPage} />
        <Route path="/projects" component={ProjectsPage} />
        <Route path="/projects/:projectId" component={ProjectDetailPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </>
  );
};

export default AppRoutes;
