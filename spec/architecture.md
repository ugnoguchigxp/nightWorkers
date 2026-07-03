# Architecture and Module Boundaries

## Top-Level Components
- `api/`: backend API, domain services, integrations, and runners
- `src/`: frontend routes and feature modules
- `src-tauri/`: macOS Tauri shell and desktop sidecar lifecycle
- `shared/`: shared schemas and type contracts
- `drizzle/`: database schema migrations and seed data
- `src/components/ui/`: NightWorkers-owned reusable UI primitives

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

Blueprint review lives inside the same Workbench lifecycle. The current read
model prefers persisted artifact rows and `artifactRef` projections, then falls
back to legacy `markdown_document` messages with structured
`metadataJson.appBlueprint` for old data. Synthetic IDs such as
`artifact-<activityArtifactId>` are frontend projection IDs; the server
resolvable ID is the raw `artifactId` inside `artifactRef` or an artifact-row
source. The Artifact Pane renders App Blueprint artifacts through Blueprint
Preview, and renders Plan Mode Workspace artifacts for Feature Plan, Blueprint,
Data Model, and additional dedicated design views.

## Desktop Packaging Boundary
The desktop app keeps the existing Node backend boundary. The Tauri shell owns
window lifecycle, runtime path resolution, dynamic loopback port allocation,
Node sidecar startup, health readiness, and shutdown. The backend still owns
Hono routes, SQLite/libSQL, supervisor/worker execution, MCP, hooks, and Codex
SDK integration.

Writable desktop state is rooted at `NIGHTWORKERS_RUNTIME_DIR` when that
environment variable is set; otherwise the Tauri sidecar resolves it from the
desktop resource root. Bundled readonly resources are rooted at
`NIGHTWORKERS_RESOURCE_DIR`, which points to the packaged resource directory.
Registered Project work still uses the Project repo root and must not use the
Tauri temporary/resource directory as a workspace.

The frontend receives the sidecar API origin through the Tauri
`get_desktop_config` command and uses `src/lib/api-base.ts` to build REST and
WebSocket URLs. Browser development keeps the existing Vite `/api` proxy path.

## Worker Runtime Boundary
- The current native worker is an in-process async runtime owned by the API
  process. `startTaskRun` returns after run setup and then executes the runtime
  loop asynchronously, but it is not a separate worker daemon or OS process.
- The native runtime is appropriate for the current single-user local desktop
  scope. If API responsiveness, crash isolation, or sustained parallel run
  execution becomes a bottleneck, introduce a separate worker executor after the
  run ownership and queue lease model are explicit.
- The Codex Agent runtime may create external Codex/MCP subprocesses, but
  NightWorkers-owned run state still flows through the same persisted run ledger
  and task/activity artifact model.

## API Surface (high level)
- `/api/repositories`: Project Folder registration and listing
- `/api/repositories/:id`: Project Folder updates
- `/api/tasks`: Session/Task CRUD, queue updates, and run start
- `/api/tasks/:id/blueprint-design-settings`: session-scoped Blueprint Preview design settings
- `/api/tasks/:id/blueprint-adoption`: adopted/not-adopted state for a Blueprint artifact message
- `/api/tasks/:id/blueprint-design-token-adoption`: adopted/not-adopted state for Design Token settings tied to a message
- `/api/tasks/:id/plan-mode-workspace`: Plan Mode Workspace read model
- `/api/tasks/:id/plan-mode/data-model`: Data Model artifact generation
- `/api/tasks/:id/plan-mode/views/:view`: additional dedicated design view generation
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
  bindings, or DDL. Canonical data structure decisions belong to the Data Model
  view.
- Data Model generation produces Plan mode dedicated-view artifacts and does not
  apply migrations or physical database changes.
- Adoption state is persistence, not artifact content. Blueprint and Design
  Token adoption decisions are stored separately and keyed by session/task ID
  plus source message ID.

## Artifact Projection Rules
- Canonical artifact rows outrank embedded task message payloads. Selectors
  should prefer `artifact_row` sources and use `task_message` sources only when
  no artifact row exists.
- Activity artifacts may be projected into synthetic task messages for read-only
  compatibility. New write paths should persist a projection message with
  `metadataJson.artifactRef` instead of relying on synthetic IDs.
- Data Model artifacts are classified through Plan mode dedicated-view metadata:
  `artifactKind: "plan_mode_dedicated_view"` with `view: "data_model"`, or the
  current `source: "data-model"` compatibility marker.
- `artifact-*` IDs in the frontend are display/projection IDs. Code that needs
  to fetch persisted content must use `artifactRef.artifactId` or an
  `artifact_row` source.

## Queue And Run Lifecycle Rules
- Session chat and Implementation Queue automation are separate. A Session can
  continue normal Workbench chat while queue entries represent explicit,
  user-approved automation work.
- Queue draining is currently process-local. The Implementation Queue uses an
  in-memory drain promise to avoid duplicate drains inside one API process, and
  queue claims assume the single desktop API process model.
- Do not scale the API into multiple queue-draining processes without moving
  claim ownership to a database lease or equivalent durable owner record.
- Queue admission creates or updates an `implementation_queue_entries` row and
  moves the Session status to `queued`. Removing a queued entry returns the
  Session to `ready` unless the run has already advanced into execution.
- Queue side effects are controlled by service input: queue mutations may pass
  `{ autoDrain: false }` for deterministic tests or maintenance flows. The
  production default still drains unless `NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN`
  disables it.
- Run orchestration status changes are governed by
  `runStatusTransitionTable` in
  `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`.
  Important transitions include `ready -> queued/running`,
  `running -> finalizing/cancelled/failed/needs_human`,
  `finalizing -> needs_review/completed/failed/needs_human/cancelled`, and
  terminal `completed` / `failed` states.
- Queue completion follows run finalization: update the run, update the Session
  task status, then complete/archive the queue entry. Tests should cover both
  the run transition and queue dashboard state when this order changes.
- A normal Session currently has at most one active run. Future multi-agent work
  should model concurrent attempts as candidate/proposal records or artifacts
  under a parent task/run, not as multiple agents racing to update the same
  shared run status and Todo rows.

## Write Tool And Proposal Boundary
- Direct repository writes are centralized in worker tools such as
  `apply_patch`, `replace_content`, and `copy_directory`, reached through the
  worker-tool dispatcher. Keep new write capabilities behind this boundary.
- Future multi-agent proposal runs should be read-only against the real Project
  repo. They should persist planned changes, diffs, generated files, reasoning,
  and verification plans as artifacts instead of mutating the worktree.
- Adoption is the only step that should apply a selected proposal to the real
  worktree. Adoption should revalidate that the proposal still applies against
  the current repo state before calling write tools.
- Proposal metadata can initially live in the existing run `contextSnapshot`,
  `diffPatch`, and activity/artifact ledger. Add dedicated candidate/proposal
  tables only when the review and adoption workflow needs queryable state that
  artifacts cannot provide cleanly.

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
- Keep Blueprint visual design, Data Model, and implementation planning as
  separate reasoning boundaries. A UI action should map to a distinct backend
  intent and persistence path when it changes the model's scope.
- Prefer additive, test-backed schema changes.

Related implementation plans are kept under `spec/` when they are still active
planning artifacts.
