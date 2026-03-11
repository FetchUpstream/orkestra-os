import { Router } from "@solidjs/router";
import type { Component } from "solid-js";
import AppRoutes from "./app/routes";

const AppRouter: Component = () => {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
};

export default AppRouter;
