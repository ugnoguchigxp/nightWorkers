# Architecture and Module Boundaries

## Top-Level Components
- `api/`: backend API, domain services, integrations, and runners
- `src/`: frontend routes and feature modules
- `src-tauri/`: macOS Tauri shell and desktop sidecar lifecycle
- `shared/`: shared schemas and type contracts
- `drizzle/`: database schema migrations and seed data
- `designSystem/`: reusable UI primitives and stories

## Runtime Model
NightWorkers manages Project Folder sessions through a chat-first task lifecycle:
1. Draft Session creation
2. Implementation plan generation or adoption
3. Optional explicit admission into the global Implementation Queue
4. Processor claim and run creation
5. Event append (state changes, tool outcomes, todos, diffs, and decisions)
6. Final report and archived/completed state
7. Queue execution archive, while the Session remains available for normal chat

Run observation is ledger-first. Task events are persisted in SQLite and then
projected to WebSocket clients. Workbench reattach uses `runId` plus an optional
event sequence cursor so page navigation or WebSocket reconnect can replay
missed events from the database instead of relying only on in-memory broker
history.

Blueprint review lives inside the same Workbench lifecycle. A generated
App Blueprint is stored as a `markdown_document` task message with structured
`metadataJson.appBlueprint`. The Artifact Pane renders that artifact through
Blueprint Preview, where users can adjust governed preview design settings,
request DB Design revisions, and mark which Blueprint, DB Design, or Design
Token artifact should be adopted for later planning.

## Desktop Packaging Boundary
The desktop app keeps the existing Node backend boundary. The Tauri shell owns
window lifecycle, app data path resolution, dynamic loopback port allocation,
Node sidecar startup, health readiness, and shutdown. The backend still owns
Hono routes, SQLite/libSQL, supervisor/worker execution, MCP, hooks, and Codex
SDK integration.

Writable desktop state is rooted at `NIGHTWORKERS_RUNTIME_DIR`, which Tauri sets
to the app data directory. Bundled readonly resources are rooted at
`NIGHTWORKERS_RESOURCE_DIR`, which points to the packaged resource directory.
Registered Project work still uses the Project repo root and must not use the
Tauri temporary/resource directory as a workspace.

The frontend receives the sidecar API origin through the Tauri
`get_desktop_config` command and uses `src/lib/api-base.ts` to build REST and
WebSocket URLs. Browser development keeps the existing Vite `/api` proxy path.

## API Surface (high level)
- `/api/repositories`: Project Folder registration and listing
- `/api/repositories/:id`: Project Folder updates
- `/api/tasks`: Session/Task CRUD, queue updates, and run start
- `/api/tasks/:id/blueprint-design-settings`: session-scoped Blueprint Preview design settings
- `/api/tasks/:id/blueprint-adoption`: adopted/not-adopted state for a Blueprint artifact message
- `/api/tasks/:id/blueprint-db-design-adoption`: adopted/not-adopted state for a DB Design revision message
- `/api/tasks/:id/blueprint-design-token-adoption`: adopted/not-adopted state for Design Token settings tied to a message
- `/api/runs/:id`: run detail and event timeline
- `/api/runs/:id/events`: run events after an optional `afterSeq` cursor
- `/api/workbench/*`: chat-first workbench read/write model
- `/api/implementation-queue/*`: explicit implementation Queue dashboard, admission, Processor settings, drain, and archive
- `/api/todo-workflow/settings`: Processor Todo Workflow gate settings
- `/api/settings/llm/*`: provider/model settings, runtime settings, and smoke checks
- `/api/settings/mcp/*`: non-authenticated MCP Server settings, connection tests, and tool discovery
- `/api/settings/hooks/*`: Agent Hooks settings, CRUD, and sample-input test execution
- `/api/settings/preflight/startup`: startup diagnostics for runtime/resource paths

## Blueprint Boundaries
- Normal App Blueprint generation owns visual application structure: screens,
  sections, component choices, visual intent, sample preview props, and
  implementation task hints.
- Normal App Blueprint generation must not invent DB tables, columns, relations,
  bindings, or DDL. It leaves `databaseSchema` and `dataBindings` empty unless a
  DB Design revision has explicitly produced those fields.
- DB Design is a dedicated Workbench intent (`design_blueprint_data`) launched
  from the Blueprint Preview DB Design panel. It returns a revised
  App Blueprint artifact and does not apply migrations or physical database
  changes.
- Adoption state is persistence, not artifact content. Blueprint, DB Design,
  and Design Token adoption decisions are stored separately and keyed by
  session/task ID plus source message ID.

## Design Rule
- Keep provider and runtime boundaries explicit.
- Keep run execution transport-independent: Hono, CLI, worker, and future terminal surfaces should share the same run orchestration and event ledger contracts.
- Keep run detail and event replay separate: full run detail should remain complete, while cursor-based attach reads through the dedicated run-events surface.
- Keep Workbench intake routing schema-first: execution path decisions should come from Round 1 `jobType`, persisted `routingHypothesis`, or explicit UI `intent`, not user-text keyword or title heuristics.
- Keep MCP Server execution inside the native worker-tool bridge unless a later Codex SDK integration preserves equivalent policy and run-event evidence.
- Keep Agent Hooks inside the native runtime and supervisor tool boundary; hook commands use the hook runner, while worker commands still use worker-tool policy.
- Keep Implementation Queue execution separate from Session chat. Queue Entries
  are explicit user-approved automation items; normal Session chat and direct
  coding requests remain available outside the Queue.
- Keep Blueprint visual design, DB Design, and implementation planning as
  separate reasoning boundaries. A UI action should map to a distinct backend
  intent and persistence path when it changes the model's scope.
- Prefer additive, test-backed schema changes.

Related implementation plans are kept under `spec/` when they are still active
planning artifacts.
