export type NavItemConfig = {
  label: string;
  href: string;
};

export const navItems: NavItemConfig[] = [
  { label: "Board", href: "/board" },
  { label: "Agents", href: "/agents" },
  { label: "Worktrees", href: "/worktrees" },
  { label: "Reviews", href: "/reviews" },
  { label: "Settings", href: "/settings" },
];
