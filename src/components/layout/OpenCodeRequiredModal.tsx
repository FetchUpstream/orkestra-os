import { For, Show, type Accessor, type Component } from "solid-js";

const OPENCODE_DOC_LINKS = [
  {
    href: "https://opencode.ai/download",
    label: "Install OpenCode",
    description: "Download and install OpenCode on this machine.",
  },
  {
    href: "https://opencode.ai/docs/providers/",
    label: "Configure providers",
    description: "Connect a model provider after installation.",
  },
  {
    href: "https://opencode.ai/docs/models/",
    label: "Models guide",
    description: "Choose a model that works for your workflow.",
  },
  {
    href: "https://opencode.ai/docs/zen/",
    label: "OpenCode Zen",
    description: "Use Zen for a simpler setup and free-model path.",
  },
  {
    href: "https://opencode.ai/docs/config/",
    label: "Config docs",
    description: "Review config and environment setup details.",
  },
  {
    href: "https://opencode.ai/docs/cli/",
    label: "CLI auth",
    description: "Sign in or connect auth from the OpenCode CLI.",
  },
];

type OpenCodeRequiredModalProps = {
  isOpen: Accessor<boolean>;
  isChecking: Accessor<boolean>;
  reason: Accessor<string>;
  onRetry: () => void;
};

const OpenCodeRequiredModal: Component<OpenCodeRequiredModalProps> = (
  props,
) => {
  return (
    <Show when={props.isOpen()}>
      <div class="projects-modal-backdrop" role="presentation">
        <section
          class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="opencode-required-modal-title"
          aria-describedby="opencode-required-modal-copy"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="border-base-content/10 border-b pb-3">
            <h2
              id="opencode-required-modal-title"
              class="task-delete-modal-title"
            >
              Set up OpenCode to continue
            </h2>
          </div>
          <div id="opencode-required-modal-copy" class="space-y-4 text-sm">
            <p class="project-placeholder-text m-0">
              Runs and agent workflows require OpenCode. It is not available on
              this system yet, so this part of the app stays locked until setup
              is complete.
            </p>

            <div class="border-base-content/10 bg-base-100/55 rounded-none border px-3 py-3">
              <p class="text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                Setup steps
              </p>
              <ol class="project-placeholder-text mt-2 list-decimal space-y-2 pl-5">
                <li>Install OpenCode on this machine.</li>
                <li>Configure a provider and choose a model.</li>
                <li>
                  Or use OpenCode Zen for a simpler path with recommended
                  models.
                </li>
                <li>Return here and click Check again.</li>
              </ol>
            </div>

            <div class="border-base-content/10 bg-base-100/55 rounded-none border px-3 py-3">
              <p class="text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                Helpful links
              </p>
              <ul class="mt-2 space-y-2">
                <For each={OPENCODE_DOC_LINKS}>
                  {(link) => (
                    <li class="project-placeholder-text">
                      <a
                        href={link.href}
                        class="link link-hover font-medium"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}
                      </a>
                      <span class="text-base-content/60">
                        {" "}
                        — {link.description}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
              <p class="project-placeholder-text mt-3">
                Docs home:{" "}
                <a
                  href="https://opencode.ai/docs/"
                  class="link link-hover"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  opencode.ai/docs
                </a>
              </p>
            </div>
          </div>
          <Show when={props.reason()}>
            {(message) => (
              <div class="projects-error border-error/35 bg-error/10 m-0 text-sm">
                <p class="m-0 text-[11px] font-semibold tracking-[0.18em] uppercase">
                  Detection details
                </p>
                <p class="mt-2 mb-0">{message()}</p>
              </div>
            )}
          </Show>
          <div class="task-delete-modal-actions">
            <button
              type="button"
              class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
              onClick={props.onRetry}
              disabled={props.isChecking()}
            >
              {props.isChecking() ? "Checking..." : "Check again"}
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default OpenCodeRequiredModal;
