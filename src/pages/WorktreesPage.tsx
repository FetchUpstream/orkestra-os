import type { Component } from "solid-js";
import PageHeader from "../components/layout/PageHeader";

const WorktreesPage: Component = () => {
  return (
    <>
      <PageHeader title="Worktrees" />
      <p class="page-placeholder">Repository worktree management.</p>
    </>
  );
};

export default WorktreesPage;
