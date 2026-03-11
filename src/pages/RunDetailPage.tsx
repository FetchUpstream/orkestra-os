import type { Component } from "solid-js";
import { useParams } from "@solidjs/router";
import PageHeader from "../components/layout/PageHeader";

const RunDetailPage: Component = () => {
  const params = useParams();
  return (
    <>
      <PageHeader title={`Run ${params.runId}`} />
      <p class="page-placeholder">Run logs and status.</p>
    </>
  );
};

export default RunDetailPage;
