# NightWorkers

NightWorkers is a local-first autonomous development control plane. It coordinates project-scoped work sessions, runs supervisor-worker executions, and records verifiable run evidence such as events, logs, diffs, todos, test results, and final reports.

## Table of Contents
- [What NightWorkers Is](#what-nightworkers-is)
- [Why NightWorkers](#why-nightworkers)
- [Current Capabilities](#current-capabilities)
- [Current Limits](#current-limits)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Five-Minute Orientation](#five-minute-orientation)
- [What You Should See First](#what-you-should-see-first)
- [Trust and Local-First Model](#trust-and-local-first-model)
- [Configuration](#configuration)
- [Development Commands](#development-commands)
- [Testing](#testing)
- [Documentation Map](#documentation-map)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## What NightWorkers Is
NightWorkers is not a chat UI with a task list attached. It is a local-first
control plane for autonomous development runs: you register a Project Folder,
work in a project-scoped Workbench Session, decide when a plan enters the
Implementation Queue, and inspect the run evidence that proves what happened.

The main adoption question is whether you want autonomous coding work to be
operated through durable local state: Project, Session, Queue, run events,
artifacts, diffs, todos, settings, and provider usage records.

## Why NightWorkers
- Local-first operation with SQLite/libSQL by default, with desktop runtime
  state stored outside the repo checkout
- Structured run lifecycle with task/run/event persistence, so run outcomes do
  not depend on a live chat connection
- Model-provider aware LLM settings (OpenAI, Azure OpenAI, Bedrock, Codex SDK)
- Explicit separation between structured LLM providers and the implementation
  runtime lane such as `codex-agent`
- Non-authenticated MCP Server settings for the coding agent
- Agent Hooks settings for lifecycle command / HTTP automation
- Chat-first workbench flow with explicit Implementation Queue admission and run execution
- App Blueprint review with governed preview settings, DB Design revisions, and adopted-artifact state
- Clear current limits: no automatic PR/merge/deploy, no parallel multi-agent
  orchestration, no required external memory service, and no bundled demo
  project or fixed seed transcript yet

## Current Capabilities
- Project Folder registration and per-project Session/Task management
- Dedicated Implementation Queue screen with Processor lanes, queued work, and not-queued plan-ready Sessions
- Global Processor capacity controls plus TODO Workflow gates for implementation runs
- Chat timeline inspection with run events, todo state, context output, diffs, and final reports
- DB-backed run event replay for Workbench WebSocket reattach through `runId` / `afterSeq` cursors
- Cursor-based run event API at `/api/runs/:id/events?afterSeq=...`
- Artifact pane with project tree and source file preview
- App Blueprint artifacts rendered as reviewable Blueprint Preview surfaces
- Design settings in Blueprint Preview for governed theme, density, shape, shadow, font, contrast, motion, and component variants
- DB Design action in Blueprint Preview for revising Blueprint `databaseSchema` and `dataBindings` without applying physical database changes
- Separate adopted/not-adopted decisions for Blueprint artifacts, DB Design revisions, and Design Token settings, tied to the Workbench session and source conversation message
- LLM provider settings UI and smoke-test API
- MCP Server settings UI for non-auth stdio / Streamable HTTP servers, with paste-import, immediate connection tests, ON/OFF controls, and legacy SSE compatibility
- Agent Hooks settings UI for `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, and session lifecycle hooks
- MCP auth headers/API keys/secret-like env values are rejected; MCP tool calls stay in the runtime evidence path through the worker-tool bridge
- Agent Hook commands run through the hook runner, not recursive worker `run_command`, and failure summaries are redacted
- Health/readiness endpoints and API docs UI

## Current Limits
- No automatic PR creation/merge/deploy
- No multi-agent orchestration in parallel
- No mandatory external memory service requirement
- No bundled sample Project Folder, fixed demo seed data, or `pnpm demo:*`
  workflow yet
- No hosted demo GIF/video in the repository docs yet

## Architecture
- Backend: Hono + TypeScript (`api/`)
- Frontend: React + Vite + TanStack Router (`src/`)
- Database: Drizzle ORM + SQLite/libSQL (`drizzle/`, `sqlite.db`)
- Shared schemas: Zod (`shared/schemas`)
- UI primitives: NightWorkers-owned components under `src/components/ui`

Details: [Architecture and Module Boundaries](./spec/docs/architecture.md)

## Requirements
- Node.js 20+
- pnpm 10+
- Rust toolchain and macOS build tools for desktop packaging

## Quick Start
1. Install dependencies
```bash
pnpm install
```
2. Create local environment file
```bash
cp .env.example .env
```
3. Apply migrations and seed data
```bash
pnpm db:migrate
pnpm db:seed
```
4. Start the app
```bash
pnpm dev
```

Default URL: `http://localhost:39174`

After startup, use the [First Run Orientation](./spec/docs/first-run-orientation.md)
if you are trying NightWorkers against an existing local repository for the
first time.

## Five-Minute Orientation
1. Open `http://localhost:39174` and confirm the Overview loads.
2. Register a Project Folder that you are comfortable using for local
   investigation. Start with a throwaway repo or a repo where you can review
   changes before committing them.
3. Create or select a Workbench Session for that project.
4. Send a read-only investigation request first, for example: "Inspect the repo
   structure and summarize the test commands without editing files."
5. Watch whether the message stays as normal Workbench chat or becomes an
   execution run. Runs create task events, todos, tool outcomes, diffs, and a
   final report.
6. Open the Artifact Pane only when the Session has produced artifacts such as
   a diff or App Blueprint.
7. Visit Settings before connecting real provider credentials, MCP servers, or
   Agent Hooks.

For a fuller step-by-step walkthrough, see
[First Run Orientation](./spec/docs/first-run-orientation.md).

## What You Should See First
- Project Folder: the local repo root NightWorkers will use for workbench and
  worker-tool activity.
- Workbench Session: the chat-first workspace where intake, planning,
  Blueprint generation, and direct coding requests start.
- Run Timeline: persisted task events for execution state, tool outcomes, todo
  changes, diffs, test results, and final reports.
- Artifact Pane: project tree, source previews, diff artifacts, and Blueprint
  Preview when those artifacts exist.
- Implementation Queue: explicit user-approved automation work, separate from
  normal Session chat.
- Settings: LLM providers, MCP servers, Agent Hooks, appearance, and TODO
  Workflow gates.
- Overview: repository, queue, settings, usage, and warning summaries across
  the local NightWorkers workspace.

See [Feature Tour](./spec/docs/feature-tour.md) for each surface's evidence
path and current limits.

## Trust and Local-First Model
NightWorkers stores its primary runtime state locally. Development mode uses the
repo-local database/settings/log defaults; desktop mode writes runtime state
under the macOS app data directory. Registered Project work is still performed
relative to the registered Project repo root, not a temporary provider or
desktop resource directory.

Provider calls can include the current user request, supervisor prompt context,
StateCard continuity context when enabled, tool/result summaries, and relevant
artifact or task context. Usage records are normalized and stored locally.
Structured providers handle schema-first reasoning and generation; the runtime
lane handles repository execution. MCP servers and Agent Hooks are configured
locally, reject secret-like auth inputs in the current implementation slice,
and run through NightWorkers evidence paths instead of bypassing the ledger.

Read [Trust Model](./spec/docs/trust-model.md) before connecting provider
credentials, MCP servers, hooks, or a repository that contains sensitive data.

## Desktop App
NightWorkers can also be built as a macOS Tauri app. The desktop shell launches
the Vite frontend in a WebView and manages the Node backend as a sidecar.

```bash
pnpm desktop:build
pnpm desktop:smoke
```

The generated app is written to:

```text
src-tauri/target/release/bundle/macos/NightWorkers.app
```

Desktop runtime state is stored under the macOS app data directory, not the repo
checkout. On this platform the default identifier path is:

```text
~/Library/Application Support/dev.nightworkers.desktop/runtime
```

Desktop diagnostics are written under:

```text
~/Library/Application Support/dev.nightworkers.desktop/runtime/logs
```

The main files are `desktop.log` for the Tauri shell startup path, `sidecar.log`
for the bundled Node process stdout/stderr, and `api.log` for API request and
runtime events.

The desktop build currently produces a verified `.app` artifact. DMG creation is
kept as a separate release gate via `pnpm desktop:build:dmg` because create-dmg
can fail on local mount/Finder state. Signing requires Developer ID credentials
and is run separately with `pnpm desktop:sign`.

## Configuration
Important environment variables:
- `DATABASE_URL`: SQLite/libSQL connection target (default local file: `sqlite.db`)
- `AUTH_MODE`: `local` / `oauth` / `both`
- `API_AUTH_REQUIRED`: opt-in protection for product APIs and the NightWorkers WebSocket. Defaults to `false` for local personal use; set `true` when intentionally exposing the app beyond localhost.
- `APP_URL`: required for OAuth and secure cookie scenarios
- `TRUST_PROXY`: set `true` behind reverse proxy
- `SESSION_QUEUE_MAX_CONCURRENCY`: legacy Session queue default retained for migration compatibility
- `CONVERSATION_CONTEXT_ENABLED`: enables the derived conversation context cache by default. Set `false` to disable StateCard build and runtime prompt injection.
- `CONVERSATION_CONTEXT_STATE_CARD_ENABLED`: requires `CONVERSATION_CONTEXT_ENABLED=true`; injects the latest compact StateCard into the runtime `latestUserMessage` only, leaving `tasks.compiled_prompt` raw.
- `CONVERSATION_CONTEXT_BUILD_ON_IDLE`: requires `CONVERSATION_CONTEXT_ENABLED=true`; refreshes the derived StateCard cache after Workbench intake and run completion.
- `NIGHTWORKERS_MCP_SETTINGS_PATH`: optional override for the MCP Server settings JSON path
- `NIGHTWORKERS_HOOKS_SETTINGS_PATH`: optional override for the Agent Hooks settings JSON path
- `NIGHTWORKERS_LLM_SETTINGS_PATH`: optional override for the LLM settings JSON path in tests or local experiments

Detailed runtime configuration:
- [Runtime Configuration Reference](./spec/docs/configuration.md)

## Development Commands
| Command | Description |
| --- | --- |
| `pnpm dev` | Start API + web in watch mode |
| `pnpm build` | Build frontend and backend |
| `pnpm start` | Start production backend bundle |
| `pnpm desktop:dev` | Start the Tauri desktop app in development mode |
| `pnpm desktop:build` | Build the macOS `.app` desktop artifact |
| `pnpm desktop:build:dmg` | Build a DMG release artifact as a separate gate |
| `pnpm desktop:lint` | Run Rust format and Clippy checks for the Tauri shell |
| `pnpm desktop:prepare-sidecar` | Stage the Node sidecar runtime resources |
| `pnpm desktop:smoke-sidecar` | Smoke-test the staged sidecar health endpoint |
| `pnpm desktop:smoke` | Launch the packaged `.app` and verify API, WebSocket, logs, and shutdown |
| `pnpm desktop:sign` | Sign/verify an app path when Developer ID credentials are available |
| `pnpm lint` | Run Biome checks |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm test` | Run Vitest |
| `pnpm test:e2e` | Run Playwright E2E |
| `pnpm test:e2e:agent-outcome` | Run deterministic agent outcome E2E |
| `pnpm test:e2e:agent-live` | Run optional live-provider agent E2E |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:seed` | Seed local development data |
| `pnpm cleanup:test-data:dry-run` | Preview cleanup of TEST-prefixed local data |
| `pnpm cleanup:test-data` | Delete TEST-prefixed local data |
| `pnpm verify:base` | Run the base gate: TypeScript, Biome, and supervisor regression tests |
| `pnpm verify:desktop` | Run Tauri/Rust checks, build the `.app`, and smoke-test it |
| `pnpm verify` | Run `verify:base` and `verify:desktop` |
| `pnpm verify:fast` | Run only `verify:base` |
| `pnpm verify:full` | Run `verify` plus the full Vitest suite |

## Testing
- Default gate: `pnpm verify` runs TypeScript, Biome, supervisor regression tests, Rust format/Clippy checks, Tauri `.app` build, and packaged app smoke.
- Fast gate: `pnpm verify:fast` runs only the TypeScript/Biome/supervisor regression base gate.
- Full gate: `pnpm verify:full` runs the default gate plus the full Vitest suite. Use it when a change touches runtime behavior, API contracts, schemas, or user-visible flows.
- Smoke E2E: `pnpm test:e2e:smoke` remains separate until local app/server prerequisites are explicitly available.
- Husky hooks: `pre-commit` and `pre-push` both run `pnpm verify`.
- Unit/integration: Vitest
- End-to-end: Playwright (`@smoke`, `@regression` tags)
- Agent outcome E2E: `pnpm test:e2e:agent-outcome` uses the deterministic `test` provider, scratch git workspaces, real API/DB/run event paths, and requires no provider credentials. Set `KEEP_E2E_WORKSPACE=1` to keep the scratch workspace after a failure.
- Live agent E2E: `pnpm test:e2e:agent-live` is optional and skips unless provider credentials are configured.
- If validation fails, first identify the phase that failed: TypeScript (`pnpm typecheck`), Biome (`pnpm lint`), Rust/Tauri (`pnpm desktop:lint` / `pnpm desktop:build`), packaged smoke (`pnpm desktop:smoke`), Vitest (`pnpm test run`), or Playwright (`pnpm test:e2e:smoke`).
- Recommended pre-PR validation:
```bash
pnpm verify
pnpm verify:full
pnpm test:e2e:smoke
```

## Documentation Map
This repository uses the following documentation layout.

- GitHub-rendered OSS documents (root):
  - [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  - [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
  - [`SECURITY.md`](./SECURITY.md)
  - [`SUPPORT.md`](./SUPPORT.md)
  - [`GOVERNANCE.md`](./GOVERNANCE.md)
  - [`CHANGELOG.md`](./CHANGELOG.md)
- Adoption and first-run references:
  - [`Trust Model`](./spec/docs/trust-model.md)
  - [`First Run Orientation`](./spec/docs/first-run-orientation.md)
  - [`Feature Tour`](./spec/docs/feature-tour.md)
  - [`Adoption Checklist`](./spec/docs/adoption-checklist.md)
- Engineering specs and internal references:
  - `spec/docs/` (primary specification/reference docs)
  - [`Architecture and Module Boundaries`](./spec/docs/architecture.md)
  - [`Runtime Configuration Reference`](./spec/docs/configuration.md)
  - [`Project Intelligence Overview 実装計画`](./spec/docs/project-intelligence-layer-concept.md)
- `spec/public/` (public-facing specs managed outside GitHub-rendered root docs)

Note: `spec/public/` is reserved for non-GitHub-public spec artifacts. GitHub-rendered documents are intentionally kept at the repository root.

## Contributing
Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening issues or pull requests.

## Security
Please report vulnerabilities via [SECURITY.md](./SECURITY.md).

## License
MIT
