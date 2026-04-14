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

import { Show, type Accessor, type Component } from "solid-js";

type ActionWarningModalProps = {
  isOpen: Accessor<boolean>;
  title: string;
  body: string;
  confirmLabel: string;
  isConfirming?: Accessor<boolean>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

const ActionWarningModal: Component<ActionWarningModalProps> = (props) => {
  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={() => {
          if (!props.isConfirming?.()) {
            props.onCancel();
          }
        }}
      >
        <section
          class="projects-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-warning-modal-title"
          aria-describedby="action-warning-modal-copy"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="border-base-content/10 border-b pb-3">
            <h2 id="action-warning-modal-title" class="task-delete-modal-title">
              {props.title}
            </h2>
          </div>
          <p
            id="action-warning-modal-copy"
            class="project-placeholder-text mt-4"
          >
            {props.body}
          </p>
          <div class="task-delete-modal-actions mt-5">
            <button
              type="button"
              class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
              onClick={props.onCancel}
              disabled={props.isConfirming?.()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-sm border-success/40 bg-success text-success-content hover:bg-success/90 rounded-none border px-4 text-xs font-medium"
              onClick={() => void props.onConfirm()}
              disabled={props.isConfirming?.()}
            >
              {props.isConfirming?.() ? "Working..." : props.confirmLabel}
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default ActionWarningModal;
