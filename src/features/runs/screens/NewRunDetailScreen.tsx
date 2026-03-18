import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import NewRunChatWorkspace from "../components/NewRunChatWorkspace";
import RunTerminal from "../components/RunTerminal";
import { useRunDetailModel } from "../model/useRunDetailModel";

type OverlayState =
  | "none"
  | "drawer-files"
  | "drawer-diff"
  | "drawer-git"
  | "sheet-terminal";

const NewRunDetailScreen: Component = () => {
  const model = useRunDetailModel();
  const [overlayState, setOverlayState] = createSignal<OverlayState>("none");
  const [lastTriggerButton, setLastTriggerButton] =
    createSignal<HTMLButtonElement | null>(null);
  let overlayCloseButtonRef: HTMLButtonElement | undefined;

  const isOverlayOpen = createMemo(() => overlayState() !== "none");
  const isDrawerOverlay = createMemo(
    () =>
      overlayState() === "drawer-files" ||
      overlayState() === "drawer-diff" ||
      overlayState() === "drawer-git",
  );
  const overlayTitle = createMemo(() => {
    switch (overlayState()) {
      case "drawer-files":
        return "Files";
      case "drawer-diff":
        return "Diff";
      case "drawer-git":
        return "Git";
      case "sheet-terminal":
        return "Terminal";
      default:
        return "";
    }
  });
  const overlayCloseLabel = createMemo(() => {
    switch (overlayState()) {
      case "drawer-files":
        return "Close Files panel";
      case "drawer-diff":
        return "Close Diff panel";
      case "drawer-git":
        return "Close Git panel";
      case "sheet-terminal":
        return "Close Terminal panel";
      default:
        return "Close panel";
    }
  });

  const toggleOverlay = (
    nextState: Exclude<OverlayState, "none">,
    triggerButton: HTMLButtonElement,
  ) => {
    setLastTriggerButton(triggerButton);
    setOverlayState((current) => (current === nextState ? "none" : nextState));
  };

  const closeOverlay = () => {
    if (overlayState() === "none") {
      return;
    }
    setOverlayState("none");
  };

  createEffect(() => {
    if (!isOverlayOpen()) {
      const trigger = lastTriggerButton();
      if (trigger) {
        trigger.focus();
      }
      return;
    }

    const frame = requestAnimationFrame(() => {
      overlayCloseButtonRef?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div class="run-detail-page">
      <Show
        when={!model.error()}
        fallback={
          <section class="projects-panel run-detail-card">
            <p class="projects-error">{model.error()}</p>
          </section>
        }
      >
        <Show
          when={!model.isLoading()}
          fallback={
            <section class="projects-panel run-detail-card">
              <p class="project-placeholder-text">Loading run details.</p>
            </section>
          }
        >
          <Show
            when={model.run()}
            fallback={
              <section class="projects-panel run-detail-card">
                <p class="project-placeholder-text">Run not found.</p>
              </section>
            }
          >
            <>
              <section class="run-chat-back-nav" aria-label="Run navigation">
                <BackIconLink
                  href={model.backHref()}
                  label={model.backLabel()}
                  class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                />
              </section>
              <NewRunChatWorkspace model={model} />
              <div
                class="run-chat-floating-toolbar"
                role="toolbar"
                aria-label="Run chat tools"
              >
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Files"
                  aria-pressed={overlayState() === "drawer-files"}
                  title="Files"
                  onClick={(event) =>
                    toggleOverlay("drawer-files", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.75 1A1.75 1.75 0 0 0 2 2.75v10.5C2 14.216 2.784 15 3.75 15h8.5A1.75 1.75 0 0 0 14 13.25V4.81a2.5 2.5 0 0 0-.732-1.768L11.958 1.73A2.5 2.5 0 0 0 10.19 1H3.75Zm0 1.5h6v2.75c0 .966.784 1.75 1.75 1.75h1v6.25a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25V2.75a.25.25 0 0 1 .25-.25Zm7.5.56.68.68a1 1 0 0 1 .294.707v1.053h-.723a.25.25 0 0 1-.25-.25V3.06ZM4.75 8a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5A.75.75 0 0 1 4.75 8Zm0 2.5a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1-.75-.75Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Terminal"
                  aria-pressed={overlayState() === "sheet-terminal"}
                  title="Terminal"
                  onClick={(event) =>
                    toggleOverlay("sheet-terminal", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm0 1.5h10.5a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Zm1.24 2.09a.75.75 0 0 0-.98 1.14l1.75 1.5a.25.25 0 0 1 0 .38l-1.75 1.5a.75.75 0 1 0 .98 1.14l1.75-1.5a1.75 1.75 0 0 0 0-2.66l-1.75-1.5Zm4.26 4.66a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Diff"
                  aria-pressed={overlayState() === "drawer-diff"}
                  title="Diff"
                  onClick={(event) =>
                    toggleOverlay("drawer-diff", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.75 2a.75.75 0 0 1 .75.75V5h2.5V2.75a.75.75 0 0 1 1.5 0V5h.75a1.75 1.75 0 0 1 1.75 1.75v6.5A1.75 1.75 0 0 1 11.75 15h-7A1.75 1.75 0 0 1 3 13.25v-6.5A1.75 1.75 0 0 1 4.75 5h.75V2.75A.75.75 0 0 1 5.75 2Zm0 4.5h-1a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h7a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-1v1.75a.75.75 0 0 1-1.5 0V6.5H6.5v1.75a.75.75 0 0 1-1.5 0V6.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Git"
                  aria-pressed={overlayState() === "drawer-git"}
                  title="Git"
                  onClick={(event) =>
                    toggleOverlay("drawer-git", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1.5a2.5 2.5 0 0 0-1.25 4.665v3.17A2.5 2.5 0 1 0 8.5 11.7v-1.35h2.17a2.5 2.5 0 1 0 0-1.5H8.5v-2.68A2.5 2.5 0 1 0 8 1.5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm7-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
                  </svg>
                </button>
              </div>
              <Show when={isOverlayOpen()}>
                <div
                  class="run-chat-overlay-backdrop"
                  aria-hidden="true"
                  onClick={() => closeOverlay()}
                />
              </Show>
              <Show when={isDrawerOverlay()}>
                <section
                  class="run-chat-overlay-panel run-chat-overlay-panel--drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="run-chat-overlay-title"
                >
                  <header class="run-chat-overlay-panel__header">
                    <h2
                      id="run-chat-overlay-title"
                      class="run-chat-overlay-panel__title"
                    >
                      {overlayTitle()}
                    </h2>
                    <button
                      ref={overlayCloseButtonRef}
                      type="button"
                      class="run-chat-overlay-panel__close"
                      aria-label={overlayCloseLabel()}
                      title={overlayCloseLabel()}
                      onClick={() => closeOverlay()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>
                  </header>
                  <p class="project-placeholder-text">Coming soon.</p>
                </section>
              </Show>
              <Show when={overlayState() === "sheet-terminal"}>
                <section
                  class="run-chat-overlay-panel run-chat-overlay-panel--sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="run-chat-overlay-title"
                >
                  <header class="run-chat-overlay-panel__header">
                    <h2
                      id="run-chat-overlay-title"
                      class="run-chat-overlay-panel__title"
                    >
                      {overlayTitle()}
                    </h2>
                    <button
                      ref={overlayCloseButtonRef}
                      type="button"
                      class="run-chat-overlay-panel__close"
                      aria-label={overlayCloseLabel()}
                      title={overlayCloseLabel()}
                      onClick={() => closeOverlay()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>
                  </header>
                  <div class="run-chat-overlay-panel__body run-chat-overlay-panel__body--terminal">
                    <RunTerminal
                      isVisible={overlayState() === "sheet-terminal"}
                      isStarting={model.terminal.isStarting()}
                      isReady={model.terminal.isReady()}
                      error={model.terminal.error()}
                      writeTerminal={model.terminal.writeTerminal}
                      resizeTerminal={model.terminal.resizeTerminal}
                      setTerminalFrameHandler={
                        model.terminal.setTerminalFrameHandler
                      }
                    />
                  </div>
                </section>
              </Show>
            </>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default NewRunDetailScreen;
