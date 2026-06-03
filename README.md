# NightWorkers

NightWorkers is a local-first autonomous development control plane. It coordinates project-scoped work sessions, runs supervisor-worker executions, and records verifiable run evidence such as events, logs, diffs, todos, test results, and final reports.

## Table of Contents
- [Why NightWorkers](#why-nightworkers)
- [Current Capabilities](#current-capabilities)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Development Commands](#development-commands)
- [Testing](#testing)
- [Documentation Map](#documentation-map)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Why NightWorkers
- Local-first operation with SQLite/libSQL by default
- Structured run lifecycle with task/run/event persistence
- Model-provider aware LLM settings (OpenAI, Azure OpenAI, Bedrock, Codex SDK)
- Non-authenticated MCP Server settings for the coding agent
- Agent Hooks settings for lifecycle command / HTTP automation
- Optional contextStill integration (degrades gracefully when unavailable)
- Chat-first workbench flow for draft sessions, queue ordering, and run execution
- App Blueprint review with governed preview settings, DB Design revisions, and adopted-artifact state

## Current Capabilities
- Project Folder registration and per-project Session/Task management
- Draft / queue / run lifecycle with drag-reorderable queue sessions
- Project-level Session queue Play/Pause controls with global and per-project processing limits
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

Known non-goals at this stage:
- No automatic PR creation/merge/deploy
- No multi-agent orchestration in parallel
- No mandatory external memory service requirement

## Architecture
- Backend: Hono + TypeScript (`api/`)
- Frontend: React + Vite + TanStack Router (`src/`)
- Database: Drizzle ORM + SQLite/libSQL (`drizzle/`, `sqlite.db`)
- Shared schemas: Zod (`shared/schemas`)
- Design System: local workspace package (`designSystem/`)

Details: [Architecture and Module Boundaries](./spec/docs/architecture.md)

## Requirements
- Node.js 20+
- pnpm 10+

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

## Configuration
Important environment variables:
- `DATABASE_URL`: SQLite/libSQL connection target (default local file: `sqlite.db`)
- `AUTH_MODE`: `local` / `oauth` / `both`
- `APP_URL`: required for OAuth and secure cookie scenarios
- `TRUST_PROXY`: set `true` behind reverse proxy
- `CONTEXT_STILL_ENABLED`: enable optional contextStill integration
- `SESSION_QUEUE_MAX_CONCURRENCY`: global maximum active Session queue runs
- `NIGHTWORKERS_MCP_SETTINGS_PATH`: optional override for the MCP Server settings JSON path
- `NIGHTWORKERS_HOOKS_SETTINGS_PATH`: optional override for the Agent Hooks settings JSON path

Detailed runtime configuration:
- [Runtime Configuration Reference](./spec/docs/configuration.md)

## Development Commands
| Command | Description |
| --- | --- |
| `pnpm dev` | Start API + web in watch mode |
| `pnpm build` | Build frontend and backend |
| `pnpm start` | Start production backend bundle |
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
| `pnpm design-system:storybook` | Start the design system Storybook |
| `pnpm verify` | Run the default fast confidence gate: TypeScript + Biome |
| `pnpm verify:fast` | Alias for `pnpm verify` |
| `pnpm verify:full` | Run the explicit full gate: `verify` + Vitest |

## Testing
- Default fast gate: `pnpm verify` runs TypeScript and Biome. It should finish without TypeScript errors or Biome diagnostics.
- Fast alias: `pnpm verify:fast` is kept as an alias for `pnpm verify`.
- Full gate: `pnpm verify:full` runs the default fast gate plus Vitest. Use it when a change touches runtime behavior, API contracts, schemas, or user-visible flows.
- Smoke E2E: `pnpm test:e2e:smoke` remains separate until local app/server prerequisites are explicitly available.
- Husky hooks: `pre-commit` and `pre-push` both run `pnpm verify` only. Vitest is intentionally opt-in through `pnpm verify:full`, so everyday Git operations stay fast.
- Unit/integration: Vitest
- End-to-end: Playwright (`@smoke`, `@regression` tags)
- Agent outcome E2E: `pnpm test:e2e:agent-outcome` uses the deterministic `test` provider, scratch git workspaces, real API/DB/run event paths, and requires no provider credentials. Set `KEEP_E2E_WORKSPACE=1` to keep the scratch workspace after a failure.
- Live agent E2E: `pnpm test:e2e:agent-live` is optional and skips unless provider credentials are configured.
- If validation fails, first identify the phase that failed: TypeScript (`pnpm typecheck`), Biome (`pnpm lint`), Vitest (`pnpm test run`), or Playwright (`pnpm test:e2e:smoke`).
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
- Engineering specs and internal references:
  - `spec/docs/` (primary specification/reference docs)
  - [`Architecture and Module Boundaries`](./spec/docs/architecture.md)
  - [`Runtime Configuration Reference`](./spec/docs/configuration.md)
  - [`Project Intelligence Overview 実装計画`](./spec/docs/project-intelligence-layer-concept.md)
  - [`品質価値向上 実装計画`](./spec/docs/quality-value-uplift-implementation-plan.md)
  - [`Runtime Worker and CLI Implementation Plan`](./spec/docs/runtime-worker-cli-implementation-plan.md)
- `spec/public/` (public-facing specs managed outside GitHub-rendered root docs)

Note: `spec/public/` is reserved for non-GitHub-public spec artifacts. GitHub-rendered documents are intentionally kept at the repository root.

## Contributing
Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening issues or pull requests.

## Security
Please report vulnerabilities via [SECURITY.md](./SECURITY.md).

## License
MIT
