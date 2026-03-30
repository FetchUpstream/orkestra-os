import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Show,
  type Accessor,
  type Component,
} from "solid-js";
import * as opener from "@tauri-apps/plugin-opener";
import { SUPPORT_LINKS } from "../../app/config/supportLinks";
import {
  formatSupportDebugInfo,
  readAppSupportMetadata,
} from "../../app/lib/appSupport";
import { AppIcon } from "../ui/icons";

type AboutModalProps = {
  isOpen: Accessor<boolean>;
  onClose: () => void;
};

const openExternalUrl = async (url: string) => {
  if ("openUrl" in opener && typeof opener.openUrl === "function") {
    await opener.openUrl(url);
    return;
  }
  if ("open" in opener && typeof opener.open === "function") {
    await opener.open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const AboutModal: Component<AboutModalProps> = (props) => {
  const [metadata] = createResource(readAppSupportMetadata);
  const [copyStatus, setCopyStatus] = createSignal<"idle" | "copied" | "error">(
    "idle",
  );

  const appName = createMemo(() => metadata()?.appName ?? "OrkestraOS");
  const appVersion = createMemo(() => metadata()?.appVersion ?? "unknown");

  createEffect(() => {
    if (!props.isOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  createEffect(() => {
    if (!props.isOpen()) {
      setCopyStatus("idle");
    }
  });

  const onCopyDebugInfo = async () => {
    try {
      const debugInfo = formatSupportDebugInfo(metadata() ?? {});
      await navigator.clipboard.writeText(debugInfo);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const onReportBug = async () => {
    await openExternalUrl(SUPPORT_LINKS.issueReporting);
  };

  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            props.onClose();
          }
        }}
      >
        <section
          class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-modal-title"
        >
          <div class="flex items-start justify-between gap-4">
            <h2 id="about-modal-title" class="task-delete-modal-title">
              About
            </h2>
            <button
              type="button"
              class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
              onClick={props.onClose}
              aria-label="Close about modal"
              title="Close"
            >
              <AppIcon name="panel.close" size={16} stroke={1.75} />
            </button>
          </div>

          <div class="space-y-1 text-sm">
            <p class="text-base-content font-medium">{appName()}</p>
            <p class="text-base-content/65">Version {appVersion()}</p>
          </div>

          <div class="space-y-1 text-sm">
            <p class="text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
              Links
            </p>
            <div class="flex flex-col items-start gap-1">
              <button
                type="button"
                class="link link-hover"
                onClick={() =>
                  void openExternalUrl(SUPPORT_LINKS.githubRepository)
                }
              >
                GitHub repository
              </button>
              <button
                type="button"
                class="link link-hover"
                onClick={() =>
                  void openExternalUrl(SUPPORT_LINKS.issueReporting)
                }
              >
                Report an issue
              </button>
              <button
                type="button"
                class="link link-hover"
                onClick={() =>
                  void openExternalUrl(SUPPORT_LINKS.documentation)
                }
              >
                Documentation / Homepage
              </button>
            </div>
          </div>

          <div class="task-delete-modal-actions mt-1 justify-start">
            <button
              type="button"
              class="btn btn-sm rounded-none border px-4 text-xs font-semibold"
              onClick={() => void onReportBug()}
            >
              Report bug
            </button>
            <button
              type="button"
              class="btn btn-sm border-base-content/20 bg-base-100 text-base-content rounded-none border px-4 text-xs font-semibold"
              onClick={() => void onCopyDebugInfo()}
            >
              Copy debug info
            </button>
          </div>

          <Show when={copyStatus() === "copied"}>
            <p class="text-success text-xs">Debug info copied.</p>
          </Show>
          <Show when={copyStatus() === "error"}>
            <p class="text-error text-xs">Could not copy debug info.</p>
          </Show>
        </section>
      </div>
    </Show>
  );
};

export default AboutModal;
