import { useLocation, useNavigate } from "@solidjs/router";
import { onMount, type Component } from "solid-js";
import {
  buildBoardHref,
  getBoardProjectIdFromSearch,
  readRememberedBoardProjectId,
} from "../app/lib/boardNavigation";

const StartupRedirectPage: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    const projectId =
      getBoardProjectIdFromSearch(location.search) ||
      readRememberedBoardProjectId();
    navigate(buildBoardHref(projectId), { replace: true });
  });

  return null;
};

export default StartupRedirectPage;
