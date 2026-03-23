import { A } from "@solidjs/router";
import type { Component } from "solid-js";

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
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 12L6 8L10 4"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </A>
  );
};

export default BackIconLink;
