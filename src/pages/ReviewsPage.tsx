import type { Component } from "solid-js";
import PageHeader from "../components/layout/PageHeader";

const ReviewsPage: Component = () => {
  return (
    <>
      <PageHeader title="Reviews" />
      <p class="page-placeholder">Code review queue and history.</p>
    </>
  );
};

export default ReviewsPage;
