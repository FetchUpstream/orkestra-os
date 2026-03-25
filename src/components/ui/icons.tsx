import {
  IconArrowLeft,
  IconArrowRight,
  IconFileText,
  IconGitBranch,
  IconGitCompare,
  IconLink,
  IconMenu2,
  IconPencil,
  IconPlus,
  IconSettings,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-solidjs";
import { type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

const iconRegistry = {
  "nav.back": IconArrowLeft,
  "nav.menu": IconMenu2,
  "panel.close": IconX,
  "action.delete": IconTrash,
  "action.add": IconPlus,
  "action.link": IconLink,
  "action.edit": IconPencil,
  "task.transition": IconArrowRight,
  "run.logs": IconFileText,
  "run.terminal": IconTerminal2,
  "run.review": IconGitCompare,
  "run.git": IconGitBranch,
  "project.settings": IconSettings,
} as const;

export type AppIconName = keyof typeof iconRegistry;

type AppIconProps = Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "stroke"> & {
  name: AppIconName;
  size?: number;
  stroke?: number;
};

export const AppIcon = (props: AppIconProps) => {
  const Icon = iconRegistry[props.name];
  const { name: unusedName, size, stroke, color, ...rest } = props;
  void unusedName;

  return (
    <Dynamic
      component={Icon}
      size={size ?? 16}
      stroke={`${stroke ?? 1.75}`}
      color={color ?? "currentColor"}
      aria-hidden={props["aria-hidden"] ?? "true"}
      {...rest}
    />
  );
};
