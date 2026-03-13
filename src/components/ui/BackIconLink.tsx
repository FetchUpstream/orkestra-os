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

  return (
    <A
      href={props.href}
      class={props.class ?? props.className}
      aria-label={title()}
      title={title()}
    >
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
