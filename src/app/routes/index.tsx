import { Route } from "@solidjs/router";
import type { Component } from "solid-js";
import AppShell from "../layouts/AppShell";
import AgentsPage from "../../pages/AgentsPage";
import BoardPage from "../../pages/BoardPage";
import NotFoundPage from "../../pages/NotFoundPage";
import ReviewsPage from "../../pages/ReviewsPage";
import ProjectDetailPage from "../../pages/ProjectDetailPage";
import ProjectsPage from "../../pages/ProjectsPage";
import RunDetailPage from "../../pages/RunDetailPage";
import SettingsPage from "../../pages/SettingsPage";
import TaskDetailPage from "../../pages/TaskDetailPage";
import WorktreesPage from "../../pages/WorktreesPage";

const AppRoutes: Component = () => {
  return (
    <>
      <Route path="/" component={AppShell}>
        <Route path="/" component={BoardPage} />
        <Route path="/board" component={BoardPage} />
        <Route path="/tasks/:taskId" component={TaskDetailPage} />
        <Route path="/projects/:projectId/tasks/:taskId" component={TaskDetailPage} />
        <Route path="/runs/:runId" component={RunDetailPage} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/projects" component={ProjectsPage} />
        <Route path="/projects/:projectId" component={ProjectDetailPage} />
        <Route path="/worktrees" component={WorktreesPage} />
        <Route path="/reviews" component={ReviewsPage} />
        <Route path="/settings" component={SettingsPage} />
      </Route>
      <Route path="*404" component={NotFoundPage} />
    </>
  );
};

export default AppRoutes;
