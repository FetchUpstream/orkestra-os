import type { Component } from "solid-js";
import PageHeader from "../components/layout/PageHeader";

const NotFoundPage: Component = () => {
  return (
    <>
      <PageHeader title="Not Found" />
      <p class="page-placeholder">The requested page could not be found.</p>
    </>
  );
};

export default NotFoundPage;
