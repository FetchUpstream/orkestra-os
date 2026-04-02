# Orkestra OS

Desktop app for orchestrating AI agents with OpenCode across projects, tasks, and runs.

License: MIT OR Apache-2.0

> [!WARNING]
> **Alpha software:** Orkestra OS is an active work in progress and is provided as-is. Behavior, workflows, data formats, and supported integrations may change at any time, and parts of the app may be incomplete, unstable, or replaced before a final release.

## Features

- Project workspace with repositories, environment variables, and default run settings
- Task management with statuses, dependencies, repository targeting, and implementation notes
- Kanban board for moving work across task states
- Run workspace with chat, logs, terminal, git diff views, and commit/rebase flow
- Local desktop packaging with Tauri

## Prerequisites

- [Node.js](https://nodejs.org/)
- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install) and Cargo
- [OpenCode](https://opencode.ai/)

OpenCode is required for runs and agent workflows. Right now this project only supports OpenCode; support for additional harnesses is planned.

After installing OpenCode, configure a provider and model before creating runs. Useful docs:

- https://opencode.ai/docs/
- https://opencode.ai/docs/providers/
- https://opencode.ai/docs/models/
- https://opencode.ai/docs/cli/

## Install from source

```bash
bun install
```

## Development

Run the desktop app with Tauri:

```bash
bun run tauri dev
```

## Build from source

Build the frontend:

```bash
bun run build
```

Build the desktop app bundle:

```bash
bun run tauri build
```

## Test

```bash
bun run test
```
