# Phase 3 - Send Latency and Bootstrap Simplification

## Goal

Make prompt submission feel immediate by removing avoidable setup work from the send path and consolidating redundant initialization.

## Success Criteria

- Opening a run prepares chat infrastructure before the first prompt is sent.
- The first send avoids server boot and session creation whenever possible.
- Frontend bootstrap uses fewer round trips.
- Prompt submission acknowledges quickly and predictably.

## Scope

- OpenCode initialization and session setup in `src-tauri/src/app/runs/opencode_service.rs`
- Tauri commands in `src-tauri/src/app/commands/runs.rs`
- Frontend bootstrap and submit flow in `src/features/runs/model/useRunDetailModel.ts`
- Tauri client calls in `src/app/lib/runs.ts`

## Problems To Fix

1. First send may start the server, poll health, create a session, persist it, and only then submit the prompt.
2. Multiple frontend bootstrap calls repeat readiness checks and snapshot fetches.
3. Several backend commands call `ensure_run_opencode` independently.
4. Session creation can race under concurrent submits.

## Implementation Plan

### 1. Prewarm OpenCode before the user sends a prompt

- Start `ensure_run_opencode` as soon as the run detail screen mounts or when a run becomes active.
- Consider eagerly creating the OpenCode session during this warmup if the run is eligible.
- Surface readiness states clearly in the UI so the user sees when chat is warming up versus truly unavailable.

### 2. Consolidate bootstrap into one backend command

- Add a single command that returns:
  - ensure result
  - buffered events
  - current session messages
  - current session todos
  - stream/session metadata needed for hydration
- Replace the current frontend sequence of separate ensure, buffered-event, message, and todo calls in `src/features/runs/model/useRunDetailModel.ts`.
- Keep the frontend bootstrap path single-shot and deterministic.

### 3. Remove repeated ensure calls from hot operations

- After a run is initialized, store readiness in the backend handle and use a fast path for commands that currently call `ensure_run_opencode` again.
- Let message/todo fetches and subscribe operations reuse the existing initialized handle when present.
- Reserve full ensure logic for explicit initialization and reconnect scenarios.

### 4. Guard session creation with a per-run once/mutex

- Add a per-run async guard around session creation and persistence in `src-tauri/src/app/runs/opencode_service.rs`.
- Ensure concurrent prompt submissions await the same session creation result instead of racing to create duplicate sessions.
- Store the canonical session id in memory after the first successful creation.

### 5. Separate prompt acceptance from heavy follow-up work

- Keep prompt submission focused on queueing work and returning quickly.
- Move any non-essential snapshot refresh or reconciliation out of the blocking send path.
- If needed, emit a local optimistic UI entry so the user sees immediate feedback after submit.

### 6. Improve readiness telemetry and failure visibility

- Distinguish in UI and logs between:
  - warming up backend
  - creating session
  - ready for prompt
  - reconnecting stream
  - submit failed
- Add timing logs around ensure, session creation, bootstrap fetch, and prompt submit to verify improvements and catch regressions.

## Verification

- Measure time from opening the run page to chat-ready state.
- Measure time from pressing Send to accepted response for cold and warm runs.
- Confirm concurrent prompt submissions do not create duplicate sessions.
- Confirm bootstrap now uses one cohesive initialization call instead of several round trips.

## Risks

- Eager warmup increases background resource usage if many runs are opened briefly.
- A combined bootstrap endpoint must be carefully versioned to avoid brittle frontend assumptions.
- Optimistic UI needs reconciliation if submission ultimately fails.

## Deliverables

- Prewarmed OpenCode/session initialization
- Unified bootstrap command
- Reduced hot-path ensure usage
- Safe per-run session initialization guard
- Faster and more predictable prompt submission
