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

## API Surface (high level)
- `/api/repositories`: Project Folder registration and listing
- `/api/repositories/:id`: Project Folder updates, including Session queue Play/Pause and per-project concurrency
- `/api/tasks`: Session/Task CRUD, queue updates, and run start
- `/api/runs/:id`: run detail and event timeline
- `/api/workbench/*`: chat-first workbench read/write model
- `/api/settings/llm/*`: provider/model settings, runtime settings, and smoke checks

## Design Rule
- Keep provider and runtime boundaries explicit.
- Keep optional integrations optional (e.g., contextStill).
- Keep Session queue controls scoped: global capacity is a runtime setting, while Play/Pause and per-project capacity live on the Project Folder.
- Prefer additive, test-backed schema changes.
