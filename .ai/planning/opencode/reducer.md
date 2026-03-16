Here’s the reducer implementation guide again, tightened up and focused on what you should actually build.

## Goal

Build one frontend function that turns:

* the current Agent UI state
* plus one incoming OpenCode event

into:

* the next Agent UI state

That matches how OpenCode works: you first hydrate from `GET /session/:id/message` and `GET /session/:id/todo`, then keep the UI live from the SSE stream. The server docs expose those endpoints, plus `/global/event` for SSE, and `message.part.updated` is the key streaming event with optional `delta`; `session.status` carries `idle | active | error`. ([OpenCode][1])

## What to build

You want four pieces:

1. A normalized store
2. A hydrate step from the HTTP snapshot
3. A reducer for live events
4. A renderer that reads only from that store

The flow is:

```text
snapshot -> hydrate store
SSE event -> reducer -> updated store -> UI rerenders
```

## 1) Store shape

Use a normalized store, not one flat transcript array.

```ts
export type AgentStore = {
  sessionId: string | null
  status: 'connecting' | 'idle' | 'active' | 'error'
  streamConnected: boolean
  lastSyncAt: number | null

  messagesById: Record<string, UiMessage>
  messageOrder: string[]

  pendingQuestionsById: Record<string, UiQuestionRequest>
  pendingPermissionsById: Record<string, UiPermissionRequest>

  todos: UiTodo[]
  diffSummary: UiDiffSummary | null

  rawEvents: RawAgentEvent[]
}
```

Each message owns ordered parts:

```ts
export type UiMessage = {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'unknown'
  createdAt?: number
  updatedAt?: number

  partsById: Record<string, UiPart>
  partOrder: string[]
}
```

And the part union:

```ts
export type UiPart =
  | UiTextPart
  | UiReasoningPart
  | UiToolPart
  | UiFilePart
  | UiPatchPart
  | UiStepStartPart
  | UiStepFinishPart
  | UiUnknownPart
```

That shape matches OpenCode’s model: messages contain parts, and the documented part family includes text, reasoning, tool, file, patch, and step boundary parts. ([GitHub][2])

## 2) Hydrate from snapshot first

Before consuming live SSE, fetch:

* `GET /session/:id/message`
* `GET /session/:id/todo`

Then convert that into `AgentStore`. OpenCode documents both endpoints as the canonical session snapshot endpoints. ([OpenCode][1])

Use a hydrate function:

```ts
export function hydrateAgentStore(input: {
  sessionId: string
  messages: Array<{ info: any; parts: any[] }>
  todos: any[]
}): AgentStore {
  const state: AgentStore = createEmptyAgentStore(input.sessionId)

  for (const item of input.messages) {
    const message = normalizeMessageInfo(item.info)
    state.messagesById[message.id] = message
    state.messageOrder.push(message.id)

    for (const rawPart of item.parts) {
      const part = normalizePart(rawPart)
      message.partsById[part.id] = part
      message.partOrder.push(part.id)
    }
  }

  state.todos = normalizeTodos(input.todos)
  state.status = 'idle'
  state.streamConnected = false
  state.lastSyncAt = Date.now()

  return state
}
```

## 3) Reducer signature

This is the core function:

```ts
export function reduceOpenCodeEvent(
  state: AgentStore,
  event: OpenCodeBusEvent,
): AgentStore
```

It should be a pure function:

* no network calls inside
* no DOM work inside
* no side effects inside

Just state in, state out.

## 4) Event union

Use one frontend event union that mirrors the important OpenCode events you care about:

```ts
export type OpenCodeBusEvent =
  | { type: 'server.connected'; properties?: Record<string, never> }
  | { type: 'message.updated'; properties: { info: any } }
  | { type: 'message.removed'; properties: { sessionID: string; messageID: string } }
  | { type: 'message.part.updated'; properties: { part: any; delta?: string } }
  | { type: 'message.part.removed'; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: 'todo.updated'; properties: { sessionID: string; todos: any[] } }
  | { type: 'question.asked'; properties: { requestID: string; sessionID: string; questions: any[] } }
  | { type: 'question.replied'; properties: { requestID: string; sessionID: string } }
  | { type: 'question.rejected'; properties: { requestID: string; sessionID: string } }
  | { type: 'permission.asked'; properties: { requestID: string; sessionID: string } }
  | { type: 'permission.replied'; properties: { requestID: string; sessionID: string } }
  | { type: 'session.status'; properties: { sessionID: string; status: 'idle' | 'active' | 'error' } }
  | { type: 'session.diff'; properties: any }
  | { type: 'session.error'; properties: any }
  | { type: string; properties: any }
```

Those are the core documented event families: message events, part events, todo events, question events, permission events, and session status/events. ([GitHub][2])

## 5) Reducer behavior by event

Here is the exact behavior I’d implement.

### `server.connected`

```ts
case 'server.connected':
  return {
    ...state,
    streamConnected: true,
    status: state.status === 'connecting' ? 'idle' : state.status,
    lastSyncAt: Date.now(),
  }
```

Important rule: treat this as a reconnect boundary and trigger a resync outside the reducer. The reducer itself should only mark the stream as attached. OpenCode’s model is snapshot + SSE, so reconnect-safe UIs should be able to refresh from the snapshot endpoints. ([OpenCode][1])

### `session.status`

```ts
case 'session.status':
  if (event.properties.sessionID !== state.sessionId) return state
  return { ...state, status: event.properties.status }
```

This drives your header badge: active, idle, error. ([GitHub][2])

### `message.updated`

```ts
case 'message.updated':
  return upsertMessage(state, event.properties.info)
```

This creates or updates the message shell. Do not wipe existing parts when this arrives.

### `message.removed`

```ts
case 'message.removed':
  if (event.properties.sessionID !== state.sessionId) return state
  return removeMessage(state, event.properties.messageID)
```

### `message.part.updated`

This is the important one.

```ts
case 'message.part.updated':
  return upsertPart(state, event.properties.part, event.properties.delta)
```

`message.part.updated` is the documented streaming event, and the `delta` field is specifically for incremental updates. ([GitHub][2])

### `message.part.removed`

```ts
case 'message.part.removed':
  if (event.properties.sessionID !== state.sessionId) return state
  return removePart(state, event.properties.messageID, event.properties.partID)
```

### `todo.updated`

```ts
case 'todo.updated':
  if (event.properties.sessionID !== state.sessionId) return state
  return { ...state, todos: normalizeTodos(event.properties.todos) }
```

### `question.asked`

```ts
case 'question.asked':
  if (event.properties.sessionID !== state.sessionId) return state
  return {
    ...state,
    pendingQuestionsById: {
      ...state.pendingQuestionsById,
      [event.properties.requestID]: normalizeQuestion(event.properties),
    },
  }
```

OpenCode’s documented flow is question asked → user POST reply/reject → `question.replied` or `question.rejected`. ([GitHub][2])

### `question.replied` / `question.rejected`

```ts
case 'question.replied':
case 'question.rejected': {
  const next = { ...state.pendingQuestionsById }
  delete next[event.properties.requestID]
  return { ...state, pendingQuestionsById: next }
}
```

### `permission.asked`

```ts
case 'permission.asked':
  if (event.properties.sessionID !== state.sessionId) return state
  return {
    ...state,
    pendingPermissionsById: {
      ...state.pendingPermissionsById,
      [event.properties.requestID]: normalizePermission(event.properties),
    },
  }
```

Permission flow is similarly ask → user reply → `permission.replied`. ([GitHub][2])

### `permission.replied`

```ts
case 'permission.replied': {
  const next = { ...state.pendingPermissionsById }
  delete next[event.properties.requestID]
  return { ...state, pendingPermissionsById: next }
}
```

### `session.diff`

```ts
case 'session.diff':
  return { ...state, diffSummary: normalizeDiff(event.properties) }
```

### `session.error`

```ts
case 'session.error':
  return { ...state, status: 'error' }
```

## 6) The actual reducer skeleton

```ts
export function reduceOpenCodeEvent(
  state: AgentStore,
  event: OpenCodeBusEvent,
): AgentStore {
  switch (event.type) {
    case 'server.connected':
      return {
        ...state,
        streamConnected: true,
        status: state.status === 'connecting' ? 'idle' : state.status,
        lastSyncAt: Date.now(),
      }

    case 'session.status':
      if (event.properties.sessionID !== state.sessionId) return state
      return { ...state, status: event.properties.status }

    case 'message.updated':
      return upsertMessage(state, event.properties.info)

    case 'message.removed':
      if (event.properties.sessionID !== state.sessionId) return state
      return removeMessage(state, event.properties.messageID)

    case 'message.part.updated':
      return upsertPart(state, event.properties.part, event.properties.delta)

    case 'message.part.removed':
      if (event.properties.sessionID !== state.sessionId) return state
      return removePart(state, event.properties.messageID, event.properties.partID)

    case 'todo.updated':
      if (event.properties.sessionID !== state.sessionId) return state
      return { ...state, todos: normalizeTodos(event.properties.todos) }

    case 'question.asked':
      if (event.properties.sessionID !== state.sessionId) return state
      return upsertQuestion(state, event.properties)

    case 'question.replied':
    case 'question.rejected':
      return removeQuestion(state, event.properties.requestID)

    case 'permission.asked':
      if (event.properties.sessionID !== state.sessionId) return state
      return upsertPermission(state, event.properties)

    case 'permission.replied':
      return removePermission(state, event.properties.requestID)

    case 'session.diff':
      return { ...state, diffSummary: normalizeDiff(event.properties) }

    case 'session.error':
      return { ...state, status: 'error' }

    default:
      return appendRawEvent(state, event)
  }
}
```

## 7) The most important helper: `upsertPart`

This is where most of the live chat behavior comes from.

```ts
function upsertPart(
  state: AgentStore,
  rawPart: any,
  delta?: string,
): AgentStore {
  const sessionId = rawPart?.sessionID
  const messageId = rawPart?.messageID
  const partId = rawPart?.id

  if (!sessionId || !messageId || !partId) return state
  if (sessionId !== state.sessionId) return state

  const existingMessage = state.messagesById[messageId] ?? createStubMessage(messageId, sessionId)

  const normalized = normalizePart(rawPart)

  let finalPart = normalized

  const existingPart = existingMessage.partsById[partId]
  if (delta && existingPart) {
    if (existingPart.kind === 'text' && normalized.kind === 'text') {
      finalPart = { ...normalized, text: existingPart.text + delta, streaming: true }
    }
    if (existingPart.kind === 'reasoning' && normalized.kind === 'reasoning') {
      finalPart = { ...normalized, text: existingPart.text + delta, streaming: true }
    }
  }

  const nextMessage: UiMessage = {
    ...existingMessage,
    partsById: {
      ...existingMessage.partsById,
      [partId]: finalPart,
    },
    partOrder: existingMessage.partOrder.includes(partId)
      ? existingMessage.partOrder
      : [...existingMessage.partOrder, partId],
  }

  return {
    ...state,
    messagesById: {
      ...state.messagesById,
      [messageId]: nextMessage,
    },
    messageOrder: state.messageOrder.includes(messageId)
      ? state.messageOrder
      : [...state.messageOrder, messageId],
  }
}
```

Why this matters:

* text streams through repeated updates
* reasoning streams the same way
* tools update state over time
* patch and step parts usually appear as discrete upserts

The processor code shows text and reasoning parts being updated incrementally, and tool parts moving through pending → running → completed/error. ([GitHub][3])

## 8) `normalizePart`

This should be conservative.

```ts
function normalizePart(raw: any): UiPart {
  switch (raw?.type) {
    case 'text':
      return {
        kind: 'text',
        id: raw.id,
        text: raw.text ?? '',
        streaming: true,
        metadata: raw.metadata,
      }

    case 'reasoning':
      return {
        kind: 'reasoning',
        id: raw.id,
        text: raw.text ?? '',
        streaming: true,
        metadata: raw.metadata,
      }

    case 'tool':
      return {
        kind: 'tool',
        id: raw.id,
        toolName: raw.tool ?? 'tool',
        callId: raw.callID,
        status: raw.state?.status ?? 'pending',
        title: raw.state?.title,
        input: raw.state?.input,
        output: raw.state?.output,
        error: raw.state?.error,
        metadata: raw.metadata,
      }

    case 'file':
      return {
        kind: 'file',
        id: raw.id,
        filename: raw.filename,
        url: raw.url,
        mime: raw.mime,
      }

    case 'patch':
      return {
        kind: 'patch',
        id: raw.id,
        hash: raw.hash,
        files: raw.files ?? [],
      }

    case 'step-start':
      return {
        kind: 'step-start',
        id: raw.id,
        snapshot: raw.snapshot,
      }

    case 'step-finish':
      return {
        kind: 'step-finish',
        id: raw.id,
        reason: raw.reason,
        tokens: raw.tokens,
        cost: raw.cost,
        snapshot: raw.snapshot,
      }

    default:
      return {
        kind: 'unknown',
        id: raw?.id ?? `unknown-${Math.random().toString(36).slice(2)}`,
        rawType: raw?.type ?? 'unknown',
        raw,
      }
  }
}
```

This mapping is grounded in the documented part/event families plus the processor behavior for reasoning, text deltas, tool state changes, step boundaries, and patch creation. ([GitHub][3])

## 9) Render rules

Drive the Agent tab from the normalized store only.

Render like this:

* `text` → normal assistant/user bubble
* `reasoning` → collapsible thinking block
* `tool` → tool execution card
* `file` → file chip / attachment row
* `patch` → changed-files card
* `step-start` / `step-finish` → subtle timeline markers
* `unknown` → debug card with raw JSON

Outside the transcript:

* `pendingQuestionsById` → “agent needs input” cards
* `pendingPermissionsById` → approval cards
* `status` → badge in header
* `todos` → side panel or collapsible list

## 10) The one rule that prevents bugs

Do not use `delta` as the only truth.

Use `delta` only to make streaming feel immediate, but always keep the latest full `part` payload as your canonical stored value. OpenCode explicitly documents `delta` on `message.part.updated`, and the processor updates the actual stored part too. ([GitHub][2])

## 11) Where this lives in your app

For your repo, I’d put this in:

* `src/features/runs/model/agentReducer.ts` — reducer + helpers
* `src/features/runs/model/agentTypes.ts` — store and UI types
* `src/features/runs/model/useRunDetailModel.ts` — owns agent state and calls reducer on each event
* `src/features/runs/screens/RunDetailScreen.tsx` — renders the Agent tab

And the integration line is just:

```ts
channel.onmessage = (event) => {
  setAgentState((prev) => reduceOpenCodeEvent(prev, event))
}
```

## 12) Build order

Do it in this order:

1. `AgentStore` type
2. `hydrateAgentStore()`
3. `reduceOpenCodeEvent()`
4. `upsertMessage`, `removeMessage`, `upsertPart`, `removePart`
5. `normalizePart()`
6. minimal UI renderers for text, tool, reasoning, patch
7. question/permission cards
8. resync on reconnect

The next useful step is turning this into the actual TypeScript files for your repo structure.

[1]: https://opencode.ai/docs/server/ "Server | OpenCode"
[2]: https://github.com/anomalyco/opencode/issues/11616 "Documentation: Web Interface Client Interaction Architecture · Issue #11616 · anomalyco/opencode · GitHub"
[3]: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts "opencode/packages/opencode/src/session/processor.ts at dev · anomalyco/opencode · GitHub"

