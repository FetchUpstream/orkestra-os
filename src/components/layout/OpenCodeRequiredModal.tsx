import { Show, type Accessor, type Component } from "solid-js";

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
              OpenCode required
            </h2>
          </div>
          <p
            id="opencode-required-modal-copy"
            class="project-placeholder-text task-delete-modal-copy"
          >
            OpenCode is required to continue with runs and agent workflows. It
            was not detected on this system. Install OpenCode, then check again.
          </p>
          <Show when={props.reason()}>
            {(message) => (
              <p class="projects-error border-error/35 bg-error/10 m-0 text-sm">
                {message()}
              </p>
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
