# Phase 1 - Reliability and Hot Path Stabilization

## Goal

Stop stream dropouts, reduce per-event overhead, and remove the biggest sources of visible lag without changing the overall chat architecture.

## Success Criteria

- Streams recover from transient OpenCode disconnects instead of silently dying.
- Long chats no longer get progressively slower during token streaming.
- The transcript and event log stay responsive under sustained output.
- Sending a prompt feels consistent once a run is active.

## Scope

- Backend stream lifecycle and event fanout in `src-tauri/src/app/runs/opencode_service.rs`
- Frontend event buffering and reducer hot path in `src/features/runs/model/useRunDetailModel.ts`
- Frontend raw event storage in `src/features/runs/model/agentReducer.ts`
- Transcript scroll trigger logic in `src/features/runs/screens/RunDetailScreen.tsx`

## Problems To Fix

1. Stream subscription exits permanently on transient SSE errors.
2. Broadcast fanout buffer is too small and can silently drop events.
3. Event arrays are copied on every incoming event.
4. Raw event history grows unbounded and increases reducer cost.
5. Deep transcript anchor serialization does too much work just to autoscroll.
6. Autoscroll runs too aggressively and causes layout churn.

## Implementation Plan

### 1. Make backend stream lifecycle resilient

- Update `spawn_event_stream` in `src-tauri/src/app/runs/opencode_service.rs` to retry subscription with exponential backoff instead of removing the handle immediately on the first failure.
- Emit explicit lifecycle events such as `stream.disconnected`, `stream.reconnecting`, and `stream.reconnected` so the UI can show accurate status and resync when needed.
- Only remove the handle when the run is truly terminal or after a bounded number of reconnect failures.

### 2. Fix backend event fanout under load

- Increase the broadcast channel size from the current small default to a value that can absorb bursty token streams.
- Detect `BroadcastStream` lag explicitly instead of ignoring errors.
- When a subscriber lags, trigger a frontend snapshot resync path rather than continuing with missing deltas.
- Avoid calling `channel.send` while holding the subscriber map lock; clone the destination channel first, then send outside the lock.

### 3. Cap frontend event history

- Replace `[...current, event]` growth for `agentEvents` in `src/features/runs/model/useRunDetailModel.ts` with a capped ring buffer or fixed-size append helper.
- Replace `rawEvents: [...state.rawEvents, event]` in `src/features/runs/model/agentReducer.ts` with the same capped strategy.
- Keep the event log sized for diagnostics, not as an unbounded source of truth.
- Add a shared constant for max retained events so the UI and reducer use the same limit.

### 4. Batch frontend event application

- Introduce a small event queue in `useRunDetailModel`.
- Buffer incoming channel events and flush them to state once per animation frame or every 16-33ms.
- Apply multiple events in one reducer pass so Solid does not rerender on every token.
- Preserve ordering and ensure `server.connected` still triggers a snapshot hydrate when needed.

### 5. Remove deep anchor-key serialization

- Delete the `messageAnchorKey` dependency chain in `src/features/runs/screens/RunDetailScreen.tsx`.
- Replace it with a cheap revision signal derived from the latest visible message id, latest updated part id, or a monotonically increasing reducer revision number.
- Stop serializing nested tool payloads just to know that the transcript changed.

### 6. Make autoscroll conditional

- Track whether the user is near the bottom of the transcript before auto-scrolling.
- Only scroll automatically when already pinned near the bottom.
- Coalesce scroll work into one pending RAF callback instead of scheduling a new scroll for every token.
- Apply the same treatment to the raw event log panel.

### 7. Add unsubscribe and cleanup support

- Add a backend unsubscribe command for OpenCode event subscribers.
- Call it from the frontend cleanup path instead of only detaching the JS channel handler.
- Prune stale subscribers and old init locks when runs disconnect or pages unmount.

## Verification

- Start a long-running assistant response and confirm streaming continues through transient backend hiccups.
- Leave the chat open for several minutes and confirm CPU usage and UI responsiveness stay stable.
- Open the agent event panel during a noisy run and confirm events continue without obvious gaps.
- Scroll upward in the transcript during streaming and verify the UI does not yank the user back to the bottom.

## Risks

- Reconnect logic can duplicate events if snapshot replay boundaries are not handled carefully.
- Buffered frontend flushing can delay UI updates slightly if the flush interval is too high.
- Smaller retained histories reduce debugging detail unless there is a separate diagnostics path.

## Deliverables

- Resilient backend stream handling
- Capped frontend and reducer event buffers
- Batched frontend event ingestion
- Cheap transcript change tracking
- Conditional autoscroll
- Explicit subscriber cleanup
