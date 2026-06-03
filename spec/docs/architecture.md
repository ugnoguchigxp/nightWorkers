# Architecture and Module Boundaries

## Top-Level Components
- `api/`: backend API, domain services, integrations, and runners
- `src/`: frontend routes and feature modules
- `shared/`: shared schemas and type contracts
- `drizzle/`: database schema migrations and seed data
- `designSystem/`: reusable UI primitives and stories

## Runtime Model
NightWorkers manages Project Folder sessions through a chat-first task lifecycle:
1. Draft Session creation
2. Queue readiness and queue ordering
3. Run creation
4. Event append (state changes, tool outcomes, todos, diffs, and decisions)
5. Final report and archived/completed state
6. Optional Session queue drain for enabled Project Folders when capacity is available

Blueprint review lives inside the same Workbench lifecycle. A generated
App Blueprint is stored as a `markdown_document` task message with structured
`metadataJson.appBlueprint`. The Artifact Pane renders that artifact through
Blueprint Preview, where users can adjust governed preview design settings,
request DB Design revisions, and mark which Blueprint, DB Design, or Design
Token artifact should be adopted for later planning.

## API Surface (high level)
- `/api/repositories`: Project Folder registration and listing
- `/api/repositories/:id`: Project Folder updates, including Session queue Play/Pause and per-project concurrency
- `/api/tasks`: Session/Task CRUD, queue updates, and run start
- `/api/tasks/:id/blueprint-design-settings`: session-scoped Blueprint Preview design settings
- `/api/tasks/:id/blueprint-adoption`: adopted/not-adopted state for a Blueprint artifact message
- `/api/tasks/:id/blueprint-db-design-adoption`: adopted/not-adopted state for a DB Design revision message
- `/api/tasks/:id/blueprint-design-token-adoption`: adopted/not-adopted state for Design Token settings tied to a message
- `/api/runs/:id`: run detail and event timeline
- `/api/workbench/*`: chat-first workbench read/write model
- `/api/settings/llm/*`: provider/model settings, runtime settings, and smoke checks
- `/api/settings/mcp/*`: non-authenticated MCP Server settings, connection tests, and tool discovery
- `/api/settings/hooks/*`: Agent Hooks settings, CRUD, and sample-input test execution

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
- Keep optional integrations optional (e.g., contextStill).
- Keep MCP Server execution inside the native worker-tool bridge unless a later Codex SDK integration preserves equivalent policy and run-event evidence.
- Keep Agent Hooks inside the native runtime and supervisor tool boundary; hook commands use the hook runner, while worker commands still use worker-tool policy.
- Keep Session queue controls scoped: global capacity is a runtime setting, while Play/Pause and per-project capacity live on the Project Folder.
- Keep Blueprint visual design, DB Design, and implementation planning as
  separate reasoning boundaries. A UI action should map to a distinct backend
  intent and persistence path when it changes the model's scope.
- Prefer additive, test-backed schema changes.
