import type { Component } from "solid-js";
import PageHeader from "../components/layout/PageHeader";

const SettingsPage: Component = () => {
  return (
    <>
      <PageHeader title="Settings" />
      <p class="page-placeholder">Application preferences and configuration.</p>
    </>
  );
};

export default SettingsPage;
