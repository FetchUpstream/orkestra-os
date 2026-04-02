// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  type Component,
  type JSX,
} from "solid-js";

type RunChatComposerProps = {
  value: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  submitting?: boolean;
  placeholder?: string;
  submitLabel?: string;
  textareaLabel?: string;
  minRows?: number;
  maxRows?: number;
  class?: string;
};

const RunChatComposer: Component<RunChatComposerProps> = (props) => {
  let textareaRef: HTMLTextAreaElement | undefined;
  const [isComposing, setIsComposing] = createSignal(false);
  const textareaId = createUniqueId();

  const minRows = () => props.minRows ?? 1;
  const maxRows = () => props.maxRows ?? 8;

  const resizeTextarea = () => {
    if (!textareaRef) return;
    const styles = getComputedStyle(textareaRef);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const borderHeight =
      Number.parseFloat(styles.borderTopWidth) +
      Number.parseFloat(styles.borderBottomWidth);
    const minHeight = lineHeight * minRows() + borderHeight;
    const maxHeight = lineHeight * maxRows() + borderHeight;

    textareaRef.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(textareaRef.scrollHeight, minHeight),
      maxHeight,
    );
    textareaRef.style.height = `${nextHeight}px`;
    textareaRef.style.overflowY =
      textareaRef.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  createEffect(on(() => props.value, resizeTextarea));

  const submit = () => {
    const value = props.value.trim();
    if (!value || props.disabled || props.submitting) return;
    props.onSubmit(value);
  };

  const onKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (isComposing() || event.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      class={`run-chat-composer ${props.class ?? ""}`.trim()}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-label="Chat composer"
    >
      <label class="run-chat-composer__label sr-only" for={textareaId}>
        {props.textareaLabel ?? "Message"}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        class="run-chat-composer__textarea"
        value={props.value}
        rows={minRows()}
        placeholder={props.placeholder ?? "Ask anything"}
        disabled={props.disabled || props.submitting}
        aria-label={props.textareaLabel ?? "Message"}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
      />
      <button
        type="submit"
        class="run-chat-composer__button"
        disabled={
          props.disabled || props.submitting || props.value.trim().length === 0
        }
        aria-label={props.submitLabel ?? "Send message"}
      >
        {props.submitting ? "Sending..." : (props.submitLabel ?? "Send")}
      </button>
    </form>
  );
};

export default RunChatComposer;
