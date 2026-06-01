# Architecture and Module Boundaries

## Top-Level Components
- `api/`: backend API, domain services, integrations, and runners
- `src/`: frontend routes and feature modules
- `shared/`: shared schemas and type contracts
- `drizzle/`: database schema migrations and seed data
- `designSystem/`: reusable UI primitives and stories

## Runtime Model
NightWorkers manages repository tasks as a run ledger:
1. Task creation
2. Run creation
3. Event append (state changes, tool outcomes, decisions)
4. Human review and status finalization

## API Surface (high level)
- `/api/repositories`: repository registration and listing
- `/api/tasks`: task CRUD and run start
- `/api/runs/:id`: run detail and event timeline
- `/api/settings/llm/*`: provider/model settings and smoke checks

## Design Rule
- Keep provider and runtime boundaries explicit.
- Keep optional integrations optional (e.g., contextStill).
- Prefer additive, test-backed schema changes.
