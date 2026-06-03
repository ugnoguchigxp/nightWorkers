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
- Model-provider aware LLM settings (OpenAI, Azure OpenAI, Bedrock)
- Optional contextStill integration (degrades gracefully when unavailable)
- Chat-first workbench flow for draft sessions, queue ordering, and run execution

## Current Capabilities
- Project Folder registration and per-project Session/Task management
- Draft / queue / run lifecycle with drag-reorderable queue sessions
- Project-level Session queue Play/Pause controls with global and per-project processing limits
- Chat timeline inspection with run events, todo state, context output, diffs, and final reports
- Artifact pane with project tree and source file preview
- LLM provider settings UI and smoke-test API
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

Detailed setup and provider configuration:
- [Runtime Configuration Reference](./spec/docs/configuration.md)
- [LLM Provider Operations](./spec/docs/llm-providers.md)

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
| `pnpm verify` | Typecheck + lint |

## Testing
- Unit/integration: Vitest
- End-to-end: Playwright (`@smoke`, `@regression` tags)
- Agent outcome E2E: `pnpm test:e2e:agent-outcome` uses the deterministic `test` provider, scratch git workspaces, real API/DB/run event paths, and requires no provider credentials. Set `KEEP_E2E_WORKSPACE=1` to keep the scratch workspace after a failure.
- Live agent E2E: `pnpm test:e2e:agent-live` is optional and skips unless provider credentials are configured.
- Recommended pre-PR validation:
```bash
pnpm verify
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
  - [`NightWorkers Concept`](./spec/docs/nightworkers-concept.md)
  - [`App Blueprint and Design Governance Implementation Plan`](./spec/docs/app-blueprint-design-governance-implementation-plan.md)
  - [`Blueprint Design Settings UI Implementation Plan`](./spec/docs/blueprint-design-settings-ui-plan.md)
- `spec/public/` (public-facing specs managed outside GitHub-rendered root docs)

Note: `spec/public/` is reserved for non-GitHub-public spec artifacts. GitHub-rendered documents are intentionally kept at the repository root.

## Contributing
Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening issues or pull requests.

## Security
Please report vulnerabilities via [SECURITY.md](./SECURITY.md).

## License
MIT
