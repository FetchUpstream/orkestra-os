import {
  Show,
  createMemo,
  createEffect,
  type Accessor,
  type Component,
} from "solid-js";

type CloseWhileRunsActiveModalProps = {
  isOpen: Accessor<boolean>;
  activeRunCount: Accessor<number>;
  onCancel: () => void;
  onConfirm: () => void;
};

const CloseWhileRunsActiveModal: Component<CloseWhileRunsActiveModalProps> = (
  props,
) => {
  createEffect(() => {
    if (!props.isOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeRunsLabel = createMemo(() => {
    const count = Math.max(0, Math.floor(props.activeRunCount()));
    if (count === 1) {
      return "There is still 1 run in progress.";
    }
    return `There are still ${count} runs in progress.`;
  });

  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            props.onCancel();
          }
        }}
      >
        <section
          class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-while-runs-active-modal-title"
          aria-describedby="close-while-runs-active-modal-copy"
        >
          <h2
            id="close-while-runs-active-modal-title"
            class="task-delete-modal-title"
          >
            Close app while runs are in progress?
          </h2>
          <p
            id="close-while-runs-active-modal-copy"
            class="project-placeholder-text task-delete-modal-copy"
          >
            {activeRunsLabel()} Closing the app now may interrupt them or cause
            issues.
          </p>
          <p class="project-placeholder-text task-delete-modal-copy">
            If possible, wait for queued, preparing, or running jobs to finish
            before closing.
          </p>
          <div class="task-delete-modal-actions">
            <button
              type="button"
              class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
              onClick={props.onCancel}
            >
              Keep app open
            </button>
            <button
              type="button"
              class="btn btn-sm border-error/35 bg-error text-error-content hover:bg-error rounded-none border px-4 text-xs font-semibold"
              onClick={props.onConfirm}
            >
              Close app anyway
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default CloseWhileRunsActiveModal;
