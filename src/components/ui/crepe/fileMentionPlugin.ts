import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type FileMentionState = {
  active: boolean;
  query: string;
  range: { from: number; to: number } | null;
  anchor: { left: number; top: number } | null;
};

const inactiveMentionState: FileMentionState = {
  active: false,
  query: "",
  range: null,
  anchor: null,
};

const isCodeSelection = (view: EditorView) => {
  const { selection } = view.state;
  if (!selection.empty) return true;
  const { $from } = selection;
  if ($from.parent.type.spec.code) return true;
  return $from.marks().some((mark) => mark.type.spec.code);
};

const resolveMentionState = (view: EditorView): FileMentionState => {
  const { selection } = view.state;
  if (!selection.empty) return inactiveMentionState;
  if (isCodeSelection(view)) return inactiveMentionState;

  const { $from } = selection;
  if (!$from.parent.isTextblock) return inactiveMentionState;

  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "",
  );
  const match = /(?:^|\s)(@[^\s`]*)$/.exec(textBefore);
  if (!match) return inactiveMentionState;

  const token = match[1] ?? "";
  if (!token.startsWith("@")) return inactiveMentionState;

  const query = token.slice(1);
  const from = selection.from - token.length;
  const to = selection.from;
  const coords = view.coordsAtPos(selection.from);

  return {
    active: true,
    query,
    range: { from, to },
    anchor: { left: coords.left, top: coords.bottom },
  };
};

export const fileMentionPluginKey = new PluginKey<FileMentionState>(
  "task-file-mention",
);

export const createFileMentionPlugin = (
  onStateChange: (state: FileMentionState) => void,
) =>
  new Plugin<FileMentionState>({
    key: fileMentionPluginKey,
    view: (view) => {
      onStateChange(resolveMentionState(view));
      return {
        update: (updatedView) => {
          onStateChange(resolveMentionState(updatedView));
        },
        destroy: () => {
          onStateChange(inactiveMentionState);
        },
      };
    },
  });
