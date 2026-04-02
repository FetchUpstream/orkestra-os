# Orkestra OS

Orkestra OS is a desktop app for orchestrating AI coding agents across real software projects.

It gives you a structured workspace for managing projects, planning tasks, running agents, reviewing changes, and shipping work — all from a local desktop app built around repeatable agent workflows.

> Official support is currently limited to **Ubuntu 24.04 LTS**. It may work on newer Ubuntu releases, but compatibility outside Ubuntu 24.04 should still be considered experimental.

> [!WARNING]
> **Alpha software:** Orkestra OS is under active development and is provided as-is. Features, workflows, data formats, and integrations may change without notice. Expect rough edges, incomplete areas, and breaking changes while the product matures.

## Why Orkestra OS?

Most AI coding tools are optimized for single prompts and short-lived sessions.

Orkestra OS is built for ongoing project execution:

* multiple projects
* structured task management
* repeatable agent runs
* code review before merge
* local desktop workflows with source control built in

It is designed for developers who want more control than a chat window, while still moving quickly with AI agents.

## Current focus

Today, Orkestra OS is focused on **OpenCode-powered** agent workflows.

You can:

* organize work by project, task, and run
* define task notes and implementation context
* launch agent runs against a repository
* inspect logs, terminal activity, git changes, and diffs
* commit, rebase, and merge through the run workflow

Support for additional harnesses is planned later. Right now, **OpenCode is required** for agent execution.

## Features

* **Project workspaces** with repository settings, environment variables, and default run configuration
* **Task management** with statuses, dependencies, repository targeting, and implementation notes
* **Kanban board workflow** for moving tasks across execution states
* **Run workspaces** with:

  * chat
  * logs
  * terminal
  * git views
  * diff review
  * commit / rebase / merge flow
* **Local desktop app** packaging via Tauri

## Quick install

Install from Cloudsmith:

```bash
curl -1sLf \
  'https://dl.cloudsmith.io/public/fetchupstream/orkestra-os/setup.deb.sh' \
  | sudo -E bash

sudo apt-get install orkestraos
```

## Prerequisites

To use Orkestra OS effectively, install the following first:

* [OpenCode](https://opencode.ai/)

## OpenCode setup

Orkestra OS currently depends on OpenCode for agent runs.

After installing OpenCode, make sure you configure:

* a provider
* a model
* any required credentials for that provider

Useful OpenCode docs:

* [OpenCode documentation](https://opencode.ai/docs/)
* [Providers](https://opencode.ai/docs/providers/)
* [Models](https://opencode.ai/docs/models/)
* [CLI documentation](https://opencode.ai/docs/cli/)

## Development


* [Node.js](https://nodejs.org/)
* [Bun](https://bun.sh/)
* [Rust and Cargo](https://www.rust-lang.org/tools/install)

Run the desktop app in development mode:

```bash
bun run tauri dev
```

## Build from source

Build the frontend:

```bash
bun run build
```

Build the desktop application bundle:

```bash
bun run tauri build
```

## Test

```bash
bun run test
```

## Status

Orkestra OS is in **alpha**.

That means:

* APIs and internal data structures may change
* workflows may be revised significantly
* not all planned functionality is implemented yet
* stability and compatibility are still improving

This repository is being developed in public as the product takes shape.

## License

Licensed under either of:

* [MIT](LICENSE-MIT)
* [Apache-2.0](LICENSE-APACHE)

at your option.
