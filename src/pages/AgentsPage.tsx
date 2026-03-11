import type { Component } from "solid-js";
import PageHeader from "../components/layout/PageHeader";

const AgentsPage: Component = () => {
  return (
    <>
      <PageHeader title="Agents" />
      <p class="page-placeholder">Manage and configure agents.</p>
    </>
  );
};

export default AgentsPage;
