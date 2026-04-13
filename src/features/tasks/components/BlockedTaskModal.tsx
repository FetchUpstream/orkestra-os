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

import { For, Show, type Accessor, type Component } from "solid-js";
import type { TaskDependencyTask } from "../../../app/lib/tasks";
import { dependencyDisplayLabel } from "../utils/taskDetail";

type BlockedTaskModalProps = {
  isOpen: Accessor<boolean>;
  blockingTasks: Accessor<TaskDependencyTask[]>;
  onClose: () => void;
};

const BlockedTaskModal: Component<BlockedTaskModalProps> = (props) => {
  return (
    <Show when={props.isOpen()}>
      <div
        class="projects-modal-backdrop"
        role="presentation"
        onClick={props.onClose}
      >
        <section
          class="projects-modal border-base-content/15 bg-base-200 rounded-none border"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-blocked-modal-title"
          aria-describedby="task-blocked-modal-copy"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="border-base-content/10 border-b pb-3">
            <h2 id="task-blocked-modal-title" class="task-delete-modal-title">
              Task is blocked
            </h2>
          </div>
          <div class="mt-4 flex flex-col gap-4">
            <p id="task-blocked-modal-copy" class="project-placeholder-text">
              This task cannot be started yet because it is blocked by:
            </p>
            <ul class="border-base-content/10 bg-base-100 max-h-60 overflow-y-auto border px-4 py-3 text-sm">
              <For each={props.blockingTasks()}>
                {(blockingTask) => (
                  <li class="text-base-content py-1 font-medium">
                    {dependencyDisplayLabel(blockingTask)}
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div class="task-delete-modal-actions mt-5">
            <button
              type="button"
              class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
              onClick={props.onClose}
            >
              Close
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};

export default BlockedTaskModal;
