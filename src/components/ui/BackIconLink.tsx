import { A } from "@solidjs/router";
import type { Component } from "solid-js";
import { AppIcon } from "./icons";

type BackIconLinkProps = {
  href: string;
  label: string;
  class?: string;
  className?: string;
  title?: string;
};

const BackIconLink: Component<BackIconLinkProps> = (props) => {
  const title = () => props.title ?? `Back to ${props.label}`;
  const classes = () =>
    props.class ??
    props.className ??
    "project-detail-back-link project-detail-back-link--icon btn btn-sm btn-square rounded-none border border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100";

  return (
    <A href={props.href} class={classes()} aria-label={title()} title={title()}>
      <AppIcon name="nav.back" size={16} stroke={1.75} />
    </A>
  );
};

export default BackIconLink;
