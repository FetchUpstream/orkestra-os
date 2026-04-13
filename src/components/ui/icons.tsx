// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
  IconArrowLeft,
  IconArrowRight,
  IconBook2,
  IconBrandGithub,
  IconBug,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconGitBranch,
  IconGitCompare,
  IconLink,
  IconLoader2,
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
  "action.copy": IconCopy,
  "action.documentation": IconBook2,
  "action.external": IconExternalLink,
  "action.github": IconBrandGithub,
  "action.bug": IconBug,
  "action.link": IconLink,
  "action.edit": IconPencil,
  "task.transition": IconArrowRight,
  "run.logs": IconFileText,
  "run.terminal": IconTerminal2,
  "run.review": IconGitCompare,
  "run.git": IconGitBranch,
  "status.loading": IconLoader2,
  "status.error": IconX,
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
