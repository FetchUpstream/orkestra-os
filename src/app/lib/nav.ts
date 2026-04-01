import type { Project } from "./projects";
import { buildBoardHref } from "./boardNavigation";

export type ProjectNavItemConfig = {
  id: string;
  label: string;
  keyAvatar: string;
  href: string;
};

const PROJECT_KEY_AVATAR_FALLBACK = "PRJ";

const normalizeAvatarKey = (project: Pick<Project, "key" | "name">) => {
  const fromKey = project.key?.trim().toUpperCase();
  if (fromKey) return fromKey;

  const fromName = project.name
    .trim()
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 3);
  return fromName || PROJECT_KEY_AVATAR_FALLBACK;
};

export const buildProjectNavItem = (
  project: Pick<Project, "id" | "name" | "key">,
): ProjectNavItemConfig => ({
  id: project.id,
  label: project.name,
  keyAvatar: normalizeAvatarKey(project),
  href: buildBoardHref(project.id),
});
