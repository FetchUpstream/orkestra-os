import { Route } from "@solidjs/router";
import type { Component } from "solid-js";
import AppShell from "../layouts/AppShell";
import { BoardScreen } from "../../features/board";
import NotFoundPage from "../../pages/NotFoundPage";
import ProjectsPage from "../../pages/ProjectsPage";
import RunDetailPage from "../../pages/RunDetailPage";
import StartupRedirectPage from "../../pages/StartupRedirectPage";
import TaskCreatePage from "../../pages/TaskCreatePage";
import TaskDetailPage from "../../pages/TaskDetailPage";

const AppRoutes: Component = () => {
  return (
    <>
      <Route path="/" component={AppShell}>
        <Route path="/" component={StartupRedirectPage} />
        <Route path="/board" component={BoardScreen} />
        <Route path="/tasks/:taskId" component={TaskDetailPage} />
        <Route
          path="/projects/:projectId/tasks/new"
          component={TaskCreatePage}
        />
        <Route
          path="/projects/:projectId/tasks/:taskId"
          component={TaskDetailPage}
        />
        <Route path="/runs/:runId" component={RunDetailPage} />
        <Route path="/projects" component={ProjectsPage} />
        <Route path="/projects/:projectId" component={ProjectsPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </>
  );
};

export default AppRoutes;
