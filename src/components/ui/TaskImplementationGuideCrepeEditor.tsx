import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";
import { createEffect, onCleanup, onMount, type Component } from "solid-js";

type TaskImplementationGuideCrepeEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
};

const TaskImplementationGuideCrepeEditor: Component<
  TaskImplementationGuideCrepeEditorProps
> = (props) => {
  let mountRef: HTMLDivElement | undefined;
  let crepe: Crepe | null = null;
  let initToken = 0;
  let isApplyingExternalValue = false;
  let isEditorFocused = false;

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
    });
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
    </div>
  );
};

export default TaskImplementationGuideCrepeEditor;
