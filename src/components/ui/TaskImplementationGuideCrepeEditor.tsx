import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import { replaceAll } from "@milkdown/utils";
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { searchProjectFiles } from "../../app/lib/projects";
import TaskFileMentionDropdown from "./TaskFileMentionDropdown";
import {
  createFileMentionPlugin,
  type FileMentionState,
} from "./crepe/fileMentionPlugin";

type TaskImplementationGuideCrepeEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  projectId?: string;
  repositoryId?: string;
};

const TaskImplementationGuideCrepeEditor: Component<
  TaskImplementationGuideCrepeEditorProps
> = (props) => {
  let mountRef: HTMLDivElement | undefined;
  let crepe: Crepe | null = null;
  let initToken = 0;
  let isApplyingExternalValue = false;
  let isEditorFocused = false;
  let mentionDebounceTimer: number | undefined;
  let requestVersion = 0;

  const [mentionState, setMentionState] = createSignal<FileMentionState>({
    active: false,
    query: "",
    range: null,
    anchor: null,
  });
  const [open, setOpen] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [results, setResults] = createSignal<string[]>([]);
  const [errorText, setErrorText] = createSignal<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);

  const getMentionSearchErrorMessage = (value: unknown): string => {
    if (value instanceof Error && value.message?.trim()) {
      return value.message;
    }
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (value && typeof value === "object") {
      const objectValue = value as Record<string, unknown>;
      const message = objectValue.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
      const error = objectValue.error;
      if (typeof error === "string" && error.trim()) {
        return error;
      }
    }
    return "File search failed. Check repository configuration.";
  };

  const clearMentionUi = () => {
    requestVersion += 1;
    if (mentionDebounceTimer) {
      window.clearTimeout(mentionDebounceTimer);
      mentionDebounceTimer = undefined;
    }
    setOpen(false);
    setLoading(false);
    setResults([]);
    setErrorText(null);
    setHighlightedIndex(0);
  };

  const insertMentionSelection = (path: string) => {
    if (!crepe) return;
    const state = mentionState();
    const range = state.range;
    if (!state.active || !range) return;

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { from, to } = range;
      const transaction = view.state.tr.insertText(`\`${path}\` `, from, to);
      view.dispatch(transaction);
      view.focus();
    });

    clearMentionUi();
  };

  const onEditorKeyDown = (event: KeyboardEvent) => {
    if (!open()) return;
    if (!results().length && event.key !== "Escape") return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % results().length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        current <= 0 ? results().length - 1 : current - 1,
      );
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const selected = results()[highlightedIndex()];
      if (!selected) return;
      event.preventDefault();
      insertMentionSelection(selected);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearMentionUi();
    }
  };

  const flushMarkdown = () => {
    if (!crepe) return;
    props.onChange(crepe.getMarkdown());
  };

  const applyExternalValue = (nextMarkdown: string) => {
    if (!crepe) return;
    const currentMarkdown = crepe.getMarkdown();
    if (currentMarkdown === nextMarkdown) return;
    if (isEditorFocused) return;

    isApplyingExternalValue = true;
    crepe.editor.action(replaceAll(nextMarkdown, true));
    isApplyingExternalValue = false;
  };

  onMount(() => {
    if (!mountRef || crepe) return;

    const currentToken = ++initToken;
    const crepeInstance = new Crepe({
      root: mountRef,
      defaultValue: props.value || "",
      featureConfigs: props.placeholder
        ? {
            [Crepe.Feature.Placeholder]: {
              text: props.placeholder,
            },
          }
        : undefined,
    });

    crepeInstance.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => [
        ...plugins,
        createFileMentionPlugin(setMentionState),
      ]);
    });

    crepeInstance.setReadonly(Boolean(props.disabled));
    crepeInstance.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (isApplyingExternalValue) return;
        props.onChange(markdown);
      });
    });

    void crepeInstance.create().then(() => {
      if (currentToken !== initToken) {
        void crepeInstance.destroy();
        return;
      }
      crepe = crepeInstance;
      mountRef?.addEventListener("keydown", onEditorKeyDown, true);
    });
  });

  createEffect(() => {
    const mention = mentionState();
    const projectId = props.projectId;
    const repositoryId = props.repositoryId;

    if (!mention.active || !projectId || !repositoryId) {
      clearMentionUi();
      return;
    }

    if (mentionDebounceTimer) {
      window.clearTimeout(mentionDebounceTimer);
    }

    setOpen(true);
    setLoading(true);
    setErrorText(null);
    setHighlightedIndex(0);

    const activeVersion = ++requestVersion;
    const expectedQuery = mention.query;
    mentionDebounceTimer = window.setTimeout(() => {
      void searchProjectFiles({
        projectId,
        repositoryId,
        query: expectedQuery,
        limit: 20,
      })
        .then((paths) => {
          if (activeVersion !== requestVersion) return;
          const currentMention = mentionState();
          if (
            !currentMention.active ||
            currentMention.query !== expectedQuery ||
            props.projectId !== projectId ||
            props.repositoryId !== repositoryId
          ) {
            return;
          }
          const relativePaths = paths.filter(
            (path) => !path.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(path),
          );
          setResults(relativePaths);
          setErrorText(null);
          setHighlightedIndex(0);
          setLoading(false);
          setOpen(true);
        })
        .catch((error) => {
          if (activeVersion !== requestVersion) return;
          setResults([]);
          setErrorText(getMentionSearchErrorMessage(error));
          setHighlightedIndex(0);
          setLoading(false);
          setOpen(true);
        });
    }, 160);
  });

  createEffect(() => {
    if (!crepe) return;
    crepe.setReadonly(Boolean(props.disabled));
  });

  createEffect(() => {
    applyExternalValue(props.value || "");
  });

  onCleanup(() => {
    initToken += 1;
    mountRef?.removeEventListener("keydown", onEditorKeyDown, true);
    clearMentionUi();
    if (!crepe) return;
    const editorToDestroy = crepe;
    crepe = null;
    void editorToDestroy.destroy();
  });

  return (
    <div class="task-guide-crepe-shell" aria-label={props.ariaLabel}>
      <div
        class="task-guide-crepe"
        ref={(element) => {
          mountRef = element;
        }}
        onFocusIn={() => {
          isEditorFocused = true;
        }}
        onFocusOut={() => {
          queueMicrotask(() => {
            if (!mountRef?.contains(document.activeElement)) {
              isEditorFocused = false;
              flushMarkdown();
              props.onBlur?.();
            }
          });
        }}
      />
      <TaskFileMentionDropdown
        open={open() && Boolean(mentionState().active)}
        loading={loading()}
        results={results()}
        errorText={errorText()}
        highlightedIndex={highlightedIndex()}
        anchor={mentionState().anchor}
        onHover={setHighlightedIndex}
        onSelect={insertMentionSelection}
      />
    </div>
  );
};

export default TaskImplementationGuideCrepeEditor;
