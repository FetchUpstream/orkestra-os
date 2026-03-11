import type { Component } from "solid-js";

type PageHeaderProps = {
  title: string;
};

const PageHeader: Component<PageHeaderProps> = (props) => {
  return <h2 class="page-title">{props.title}</h2>;
};

export default PageHeader;
