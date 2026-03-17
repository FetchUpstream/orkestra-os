# Phase 2 - Frontend Rendering and State Architecture

## Goal

Remove full-history recomputation from the chat UI so token streaming updates only the parts that actually changed.

## Success Criteria

- Streaming a long answer does not rerender the entire chat on every token.
- Transcript performance remains stable as message count grows.
- Markdown-heavy messages and tool output no longer cause repeated parsing spikes.
- The chat remains smooth even with long histories and verbose tool output.

## Scope

- Transcript derivation in `src/features/runs/screens/RunDetailScreen.tsx`
- Message and part update flow in `src/features/runs/model/agentReducer.ts`
- Markdown rendering in `src/components/ui/MarkdownContent.tsx`
- Tool/event payload formatting in `src/features/runs/screens/RunDetailScreen.tsx`

## Problems To Fix

1. Full transcript is rebuilt on every store update.
2. Streaming text uses repeated full-string concatenation.
3. Markdown is reparsed during hot-path rerenders.
4. Tool payloads and agent event payloads are stringified in render.
5. Long transcript and event lists are not virtualized.

## Implementation Plan

### 1. Stop rebuilding the full transcript on each event

- Replace the large `transcript()` memo in `src/features/runs/screens/RunDetailScreen.tsx` with per-message derived components.
- Render from normalized store data directly using message ids and stable keyed children.
- Keep unchanged messages referentially stable so Solid only updates the changed message or part.
- Move step metadata extraction closer to the message component so only that message recomputes.

### 2. Restructure the message renderer

- Introduce focused components such as `RunConversationMessage`, `RunConversationPart`, and `RunToolPart` under `src/features/runs/components/`.
- Pass only the specific message/part data each component needs.
- Keep markdown, tool summaries, and fallback payload rendering isolated so they do not force parent recomputation.

### 3. Replace per-token string rebuilding

- Update `upsertPart` in `src/features/runs/model/agentReducer.ts` so streaming text accumulates chunk arrays or a mutable buffer representation rather than `existingText + delta` on every token.
- Join buffered chunks only when flushing UI updates or when the part is finalized.
- Keep finalized message text as a plain string after completion.

### 4. Memoize markdown work

- Update `src/components/ui/MarkdownContent.tsx` so parsed markdown is memoized by the input content string.
- For actively streaming text parts, render lightweight plain text until the part stops streaming, then upgrade to markdown.
- Avoid reparsing already-settled content when unrelated messages change.

### 5. Memoize expensive payload formatting

- Precompute formatted payload strings when events are ingested or when tool parts settle.
- Avoid calling `JSON.stringify` from render for large payloads.
- Prefer lazy expansion for large tool outputs and raw event payloads so the collapsed view stays cheap.

### 6. Add transcript and event log windowing

- Virtualize the transcript list if sessions can become very long.
- If full virtualization is too invasive, implement a simpler first pass: show the latest N items with a "load older" control.
- Apply the same strategy to the raw agent event log.

### 7. Tighten reactive boundaries

- Audit `createMemo` and `createEffect` usage in `RunDetailScreen` to ensure hot-path state does not cause unrelated sections to rerender.
- Keep terminal, diff, transcript, and raw event sections isolated.
- Ensure agent-tab-only work does not run while the chat transcript is active and vice versa.

## Verification

- Stream a response with several thousand tokens and confirm only the active message updates.
- Open a run with many historical messages and verify initial render and scroll performance are still acceptable.
- Render messages with heavy markdown and large tool outputs and confirm CPU spikes are reduced.
- Use browser devtools profiling to confirm fewer scripting and layout spikes during token streaming.

## Risks

- Component decomposition can introduce prop churn if message objects are still recreated too often.
- Chunked text buffering needs a clean transition from streaming to finalized text.
- Virtualization can complicate auto-scroll and copy behavior if introduced too early.

## Deliverables

- Incremental conversation rendering
- Streaming text chunk buffering
- Memoized markdown parsing
- Memoized payload formatting
- Transcript and event log windowing
