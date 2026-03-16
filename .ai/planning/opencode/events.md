Here’s the clean mental model:

**OpenCode chat is not “one response string.”** It is a **session-scoped event stream** where you bootstrap from HTTP, then keep the UI live with SSE deltas. The server docs expose `GET /session/:id/message` for the current message graph, `GET /session/:id/todo` for todos, and an SSE stream at `GET /event` whose first event is `server.connected` followed by bus events. The server docs also expose `GET /global/event` as a global SSE endpoint. ([OpenCode][1])

## The IDs that tie everything together

These are the keys your reducer should care about:

* **`sessionID`**: the top-level conversation / agent run bucket.
* **`messageID`**: one logical message within that session.
* **`partID`**: one renderable unit inside a message.
* **`requestID`**: a pending user-interaction request, used for questions and permissions.
* **`callID`**: a tool invocation identifier inside a `ToolPart`. ([GitHub][2])

That means your frontend state should look more like:

```text
session
  messages[messageID]
    parts[partID]
  pendingQuestions[requestID]
  pendingPermissions[requestID]
  todos
  status
```

That shape is an implementation recommendation from me, but it follows directly from the event payloads and IDs OpenCode exposes. ([GitHub][2])

## The event graph

```text
Open Run / Reconnect
    |
    +--> GET /session/:id/message   --> build full message tree
    +--> GET /session/:id/todo      --> build todo state
    +--> connect SSE /event
              |
              +--> server.connected
              |      |
              |      +--> treat as "stream attached"
              |      +--> on reconnect, re-fetch session state
              |
              +--> session.created / session.updated / session.deleted
              +--> session.status(active|idle|error)
              +--> message.updated
              +--> message.part.updated (repeated, often many times)
              +--> message.part.removed / message.removed
              +--> todo.updated
              +--> question.asked ----> question.replied / question.rejected
              +--> permission.asked --> permission.replied
              +--> session.diff
              +--> session.error
```

The key connection is: **messages are containers; parts are the stream.** `message.updated` gives you the message shell/info, while `message.part.updated` is what usually drives the visible assistant output, tool progress, reasoning, patches, and other renderable items. ([GitHub][2])

## The event families

### 1) Transport / stream events

**`server.connected`**
This is the first SSE event on `GET /event`. The architecture doc says the server sends it immediately on connection, then forwards bus events, and also sends heartbeats every 30 seconds. ([OpenCode][1])

**How to use it in your UI:**
Treat it as a **sync boundary**, not a chat item. A recent reconnect bug report shows missed SSE events are not automatically recovered, and a practical fix was to treat `server.connected` as a refresh trigger and re-bootstrap state from the HTTP endpoints. ([GitHub][3])

### 2) Message container events

**`message.updated`**
Fired when a message is created or modified; it contains the full message info. This is the event that tells you “there is a message here,” but not necessarily every final part payload by itself. ([GitHub][2])

**`message.removed`**
Delete a message by `sessionID` + `messageID`. ([GitHub][2])

**How to render:**
Use `message.updated` to upsert the message shell and metadata, then attach parts under that message as `message.part.updated` arrives. That mapping is partly inference, but it is the natural fit with the documented payload split. ([GitHub][2])

### 3) Message part events

**`message.part.updated`**
This is the most important event in the whole system. It fires when a message part is created or updated, and for streaming text it may include a `delta` string for incremental updates. The architecture doc explicitly says it is used for streaming responses. ([GitHub][2])

**`message.part.removed`**
Delete a part by `sessionID` + `messageID` + `partID`. ([GitHub][2])

**How to render:**
Upsert the part by `part.id`. If `delta` is present, append it to the visible text immediately, but still replace your stored part with the full `part` payload from the event. That last sentence is my recommendation, not a documented rule, but it is the safest reducer strategy for streamed text. ([GitHub][2])

### 4) Todo events

**`todo.updated`**
Replaces the todo state for a session with a fresh `todos` array. The docs point to `GET /session/:sessionID/todo` as the fetch endpoint. ([GitHub][2])

**How to render:**
This should drive a separate todo panel, not the chat transcript itself. ([GitHub][2])

### 5) Question events

**`question.asked`**
When the AI needs user input, OpenCode creates a question request with a `requestID`, broadcasts `question.asked`, then waits for a reply or rejection through the question endpoints. The architecture doc explicitly mentions the follow-up events `question.replied` and `question.rejected`. ([GitHub][2])

**How to render:**
Show this as an **inline interrupt card** or modal keyed by `requestID`. It is not ordinary assistant text; it is a blocking request for human input. ([GitHub][2])

### 6) Permission events

**`permission.asked`**
Used when the AI wants approval for something like a command. The documented flow is: ask → broadcast `permission.asked` → user replies → broadcast `permission.replied`. ([GitHub][2])

**How to render:**
Show a permission card with approve / deny actions. This is also not ordinary chat text; it is workflow state. ([GitHub][2])

### 7) Session-level events

The architecture doc lists these session events:

* `session.created`
* `session.updated`
* `session.deleted`
* `session.diff`
* `session.error` ([GitHub][2])

And separately documents **`session.status`** with statuses `idle | active | error`. ([GitHub][2])

**How to use them:**

* `session.status`: drive the “agent is running / idle / failed” indicator.
* `session.diff`: update any file-changes panel or diff badge.
* `session.updated`: session metadata changes.
* `session.error`: session-level failure surface.
* `session.created` / `session.deleted`: mostly list-management / navigation events. ([GitHub][2])

One caution: logs from real issues also show internal-looking events such as `session.idle`, but the public event docs emphasize `session.status` as the stable status contract. I would build UI state off the documented `session.status`, not undocumented extras. ([GitHub][4])

## The part types inside messages

OpenCode documents the message part union as:

* `TextPart`
* `ToolPart`
* `FilePart`
* `ReasoningPart`
* `SnapshotPart`
* `PatchPart`
* `AgentPart`
* `RetryPart`
* `CompactionPart`
* `SubtaskPart`
* `StepStartPart`
* `StepFinishPart` ([GitHub][2])

Here is how I would interpret and render them.

### `TextPart`

This is ordinary visible message text. In the processor source, text is created on `text-start`, extended on `text-delta`, and finalized on `text-end`; the reducer path uses delta updates on the `text` field. ([GitHub][5])

**UI:** render as normal assistant markdown/text.

### `ReasoningPart`

The processor source shows reasoning parts have `type: "reasoning"`, `text`, `time`, and optional metadata, and they stream via `reasoning-start` / `reasoning-delta` / `reasoning-end`. ([GitHub][5])

**UI:** either hide by default, show in a collapsible “thinking” section, or keep it behind a debug toggle.

### `ToolPart`

This one is well defined in the processor source. It starts as `pending`, becomes `running`, and then ends as `completed` or `error`. It carries a `tool` name, a `callID`, and a state object that may include `input`, `output`, `error`, `time`, `title`, `metadata`, and `attachments`. ([GitHub][5])

**UI:** render as a timeline row like:

* Running `bash`
* Completed `read`
* Error in `edit`

Tool parts are often more important than raw token streaming in an agent UI.

### `PatchPart`

The processor source shows a `patch` part is emitted after a step finishes if `patch.files.length` is nonzero, with fields including `hash` and `files`. ([GitHub][5])

**UI:** render as “files changed” / patch summary, not as chat text.

### `StepStartPart` / `StepFinishPart`

The processor source shows step-start creates a `step-start` part with a `snapshot`, and step-finish creates a `step-finish` part with `reason`, `snapshot`, `tokens`, and `cost`. ([GitHub][5])

**UI:** these are good for an execution timeline and per-step metrics, but you can hide them in a first-pass chat renderer.

### `FilePart`

This part type is documented in the part union and is also accepted in prompt input for messages. The server docs show message submission supports `parts`, and the architecture doc says messages can include `FilePart`s. ([GitHub][2])

**UI:** render as an attachment chip, linked file, or expandable file preview.

### `AgentPart`, `RetryPart`, `CompactionPart`, `SubtaskPart`, `SnapshotPart`

These are publicly documented as part names, but I did **not** find enough authoritative public payload examples to tell you their exact runtime shape with confidence. For `SnapshotPart`, there is a strong hint from the processor code that snapshots are tied to step boundaries and patch generation. For `SubtaskPart`, public issue traffic shows OpenCode does have subtask/subsession concepts, but not enough published schema detail here to recommend a final renderer. ([GitHub][6])

**UI recommendation:**
For now:

* show a generic structured card for unknown part types,
* include `part.type`,
* preserve raw JSON in a debug expander.

That is the safest way to avoid breaking when you encounter these rarer parts.

## How the events usually link together in a normal turn

A typical conversation turn looks like this:

```text
1. POST /session/:id/message or /prompt_async
2. session.status -> active
3. message.updated        (user message appears / updates)
4. message.updated        (assistant message shell appears)
5. message.part.updated   (reasoning/text/tool parts start appearing)
6. question.asked or permission.asked may interrupt the flow
7. more message.part.updated after reply/approval
8. session.diff / todo.updated / session.updated may follow
9. session.status -> idle   (or error)
```

That order is partly documented and partly inferred from real OpenCode logs. The docs explicitly define the event families; issue logs show real runs publishing `session.status`, `message.updated`, `session.updated`, `session.diff`, many `message.part.updated` events, and then a closing `session.status`. ([GitHub][2])

So the important takeaway is:

* **`message.updated`** creates/updates the container.
* **`message.part.updated`** is the live stream.
* **`question.*` / `permission.*`** are blocking side channels.
* **`session.status`** drives the global busy/idle state.
* **`session.diff` / `todo.updated`** update secondary panes, not the transcript. ([GitHub][2])

## The reducer strategy I’d use in your app

For your Tauri/Solid UI, I’d use this model:

1. On load or reconnect:

   * fetch `GET /session/:id/message`
   * fetch `GET /session/:id/todo`
   * then attach SSE. ([OpenCode][1])

2. Filter SSE by `sessionID` whenever the event has one, because the server stream is forwarding bus events, not just one session’s data. ([GitHub][2])

3. Upsert message shells on `message.updated`. ([GitHub][2])

4. Upsert parts on `message.part.updated`, keyed by `part.id`. Apply `delta` for immediate append, but retain the full `part` payload as source of truth. ([GitHub][2])

5. Delete on `message.part.removed` and `message.removed`. ([GitHub][2])

6. Keep `pendingQuestions[requestID]` and `pendingPermissions[requestID]` separately from chat messages. ([GitHub][2])

7. Drive header/pill state from `session.status`. ([GitHub][2])

8. On `server.connected`, do a full resync because reconnect gaps can otherwise leave the UI stale. ([GitHub][3])

## The minimal rendering priority

If you want the smallest chat renderer that still feels correct, I’d support these first:

* `TextPart`
* `ToolPart`
* `ReasoningPart` (collapsible)
* `FilePart`
* `PatchPart`
* `question.*`
* `permission.*`
* `session.status` ([GitHub][6])

And for everything else, fall back to a raw structured event/part viewer until you collect real payload samples.

That is the fastest way to get a robust UI without guessing wrong about rarer part types.

Next I’d turn this into a concrete frontend reducer spec for your app: exact TypeScript unions, normalized store shape, and the render mapping for the renamed Agent tab.

[1]: https://opencode.ai/docs/server/ "Server | OpenCode"
[2]: https://github.com/anomalyco/opencode/issues/11616 "Documentation: Web Interface Client Interaction Architecture · Issue #11616 · anomalyco/opencode · GitHub"
[3]: https://github.com/anomalyco/opencode/issues/13947?utm_source=chatgpt.com "Web UI freezes after SSE reconnect — missed events not ..."
[4]: https://github.com/anomalyco/opencode/issues/4587?utm_source=chatgpt.com "opencode hangs until it eventually times out · Issue #4587"
[5]: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts "opencode/packages/opencode/src/session/processor.ts at dev · anomalyco/opencode · GitHub"
[6]: https://github.com/anomalyco/opencode/issues/11616?utm_source=chatgpt.com "Web Interface Client Interaction Architecture · Issue #11616"

