# Implementation Queue Redesign Plan

## Purpose
NightWorkers の queue を、通常の Session 応答とは独立した「実装計画後の自動実行レーン」として作り直す。

現在の Workbench 上に表示されている queue 要素と `DRAFT | READY` トグルは撤去する。代わりに、各 Project の最上部から開ける専用 Queue 画面を設け、Project 横断の実装タスク Queue、Processor、Queue 外の候補を視覚的に扱えるようにする。

## Core Principle
Queue は Session の代替ではない。

- Session は、通常の会話、調査、設計、コーディング依頼を今まで通り受け付ける。
- Queue は、実装計画が作られた後に、ユーザーが明示的に自動処理へ入れると決めたものだけを扱う。
- Queue に入っていない Session でも、ユーザーが直接 AI に依頼すれば通常通りコーディングやドキュメンテーションを実行できる。
- Processor は実装タスク専用であり、Chat 応答可否や通常 Session の受付可否を制御しない。

## Implementation Decisions
These decisions are fixed for the first implementation slice so implementation can start without re-litigating the design.

- Queue Entry is a separate table. Do not overload `tasks.status` as the Queue source of truth.
- Processor capacity is global for v1. Existing project-level `queueEnabled` / `maxConcurrentSessions` should be removed from the visible queue UX and deprecated after the new path is working.
- The dedicated Queue screen is global by default. Project entrypoints open the same screen and may pass a project filter.
- Queue admission requires explicit user action after an implementation plan is available.
- Processor execution starts from an atomically claimed Queue Entry, then creates a normal `task_runs` row.
- TodoList remains run-internal. Queue ordering never operates on individual Todos.
- Completion archive means Queue execution archive, not Session archive.
- First slice proves one Processor end to end. Multi-processor support is enabled only after the claim path and stale recovery are covered by tests.

## Scope
### In Scope
- 既存 Workbench 上の queue 表示要素の撤去
- `DRAFT | READY` トグルの撤去
- 各 Project 上部に Queue 専用メニューを追加
- Project 横断の Queue 実行画面を追加
- Processor レーンを 1 から 3 個まで設定できる UI と backend 設定
- Queue 外候補エリアの追加
- 実装計画完成後の「処理 Queue に入れるか」確認フロー
- Processor 開始時の task analysis と TodoList 生成
- Todo Workflow 設定
- Todo ごとの code review / fix / quality gate を標準化
- 完了時の commit 確認
- Queue execution 完了後の archive

### Out of Scope
- Session の通常 Chat 応答制御
- Queue に入っていない Session の実装能力制限
- Project の定義変更
- Git 必須化
- Blueprint / DB Design / Design Token の責務変更
- MCP や Hooks の認証・接続モデル変更

## Domain Model
### Hierarchy
```text
Project
  Session / Task
    Implementation Plan
      Implementation Queue Entry
        Processor Run
          TodoList
            Todo Workflow Step
```

### Responsibility Boundary
| Layer | Responsibility | Not Responsible For |
| --- | --- | --- |
| Project | Folder-level grouping and entrypoint | Queue ownership as an isolated project-only queue |
| Session / Task | Conversation, planning, user-directed work | Processor capacity control |
| Implementation Plan | Defines executable implementation intent | Automatic execution before user consent |
| Queue Entry | User-approved automatic execution candidate | Todo-level execution details |
| Processor Run | Claims one queued implementation task and executes it | Blocking normal Chat |
| TodoList | Run-internal milestones and gates | User-visible queue ordering |
| Todo Workflow | Defines required behavior around each Todo | Replacing the Session model |

## Queue Screen UX
### Entry Point
- Each Project row/header gets a dedicated `Queue` menu item at the top level.
- The opened screen represents the global Implementation Queue, not only that Project.
- The active Project can be used as a filter, but the default view should show cross-project processing pressure.

### Layout
```text
+---------------------+-------------------------------+-------------------------------+
| Processors          | Implementation Queue          | Not Queued                    |
|                     |                               |                               |
| Processor 1         | #1 Project A / Session X      | Project C / Plan Draft        |
| Processor 2         | #2 Project B / Session Y      | Project A / Plan Ready        |
| Processor 3         | #3 Project A / Session Z      | Project D / Needs Plan        |
+---------------------+-------------------------------+-------------------------------+
```

### Processor Area
- Shows active processor lanes.
- Allowed processor count is configurable from this screen.
- Supported range: `1..3`.
- Each lane shows:
  - claimed Queue Entry
  - Project / Session title
  - current run phase
  - active Todo
  - latest quality gate status
  - archive / pause / needs-human state if applicable

### Implementation Queue Area
- Shows user-approved implementation tasks waiting for a Processor.
- Queue is Project-independent.
- Ordering is global priority plus explicit queue position.
- Drag reorder can be supported after the new model is stable.

### Not Queued Area
- Shows Sessions / Tasks that are not in the execution Queue.
- Includes:
  - implementation plan exists but user has not queued it
  - draft/spec/blueprint activity that is not implementation-ready
  - completed queue execution where the Session remains available for normal chat, if not archived from the execution view
- Actions:
  - open Session
  - ask AI in Session
  - queue implementation plan when eligible
  - mark as not planned / dismissed if needed

## State Model
Replace UI-facing `DRAFT | READY` semantics with execution-oriented states.

### Queue Entry States
| State | Meaning |
| --- | --- |
| `queued` | Approved and waiting for Processor |
| `claimed` | Atomically reserved by a Processor, not yet running |
| `processing` | Processor run is active |
| `needs_human` | Execution requires user decision or input |
| `awaiting_commit_decision` | Todos are complete; user must choose commit or no commit |
| `execution_completed` | Processor work completed |
| `execution_archived` | Queue execution is no longer occupying a Processor |
| `failed` | Execution failed |
| `cancelled` | Execution was cancelled |

### Session Planning States
These may remain derived from existing `tasks.status`, task messages, and implementation-plan artifacts. They are not the Queue source of truth.

| State | Meaning |
| --- | --- |
| `session_active` | Normal Session can continue; no queue decision implied |
| `plan_draft` | Implementation plan is being drafted |
| `plan_ready` | Implementation plan exists and can be queued |
| `not_queued` | User has not approved automatic execution |

### Allowed Queue Entry Transitions
```text
queued -> claimed -> processing -> awaiting_commit_decision -> execution_completed -> execution_archived
queued -> cancelled
claimed -> queued                  # stale claim recovery before run start
claimed -> failed
processing -> needs_human
processing -> failed
processing -> cancelled
needs_human -> processing
awaiting_commit_decision -> execution_completed
```

Only backend service functions may update Queue Entry state. UI mutations must call explicit queue endpoints and should not patch arbitrary statuses.

### Important Distinction
`execution_archived` must not mean the Session is dead. It only means the Queue execution instance has left Processing and should no longer block the next Queue item.

## Backend Plan
### Data Model
Use additive schema changes and keep `tasks`, `task_runs`, `task_run_todos`, and `task_events` as the execution ledger.

#### Required Tables
`implementation_queue_entries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text primary key | UUID |
| `task_id` | text not null | FK to `tasks.id`, cascade delete |
| `repository_id` | text not null | FK to `repositories.id`, denormalized for queue filtering |
| `status` | text not null | Queue Entry state enum |
| `priority` | integer not null default `0` | Higher priority sorts first |
| `queue_position` | integer | Stable manual ordering within same priority |
| `processor_slot` | integer | `1..3` while claimed/processing |
| `active_run_id` | text | FK to `task_runs.id` once run starts |
| `claimed_at` | integer timestamp | Set on claim |
| `last_heartbeat_at` | integer timestamp | Updated while processing |
| `archived_at` | integer timestamp | Set when Queue execution leaves active view |
| `status_reason` | text | Human-readable failure/recovery reason |
| `created_at` / `updated_at` | integer timestamp | Standard columns |

Indexes:
- unique active entry per task where `status` is not terminal if SQLite partial indexes are acceptable; otherwise enforce in repository transaction.
- `(status, priority, queue_position, created_at)` for claim ordering.
- `(repository_id, status)` for filters.

`implementation_queue_settings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text primary key | Use singleton id `global` |
| `processor_count` | integer not null default `1` | Clamp to `1..3` |
| `created_at` / `updated_at` | integer timestamp | Standard columns |

`todo_workflow_settings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text primary key | Use singleton id `global` for v1 |
| `require_per_todo_review` | integer boolean not null default `true` | |
| `require_per_todo_fix` | integer boolean not null default `true` | |
| `require_final_verification` | integer boolean not null default `true` | |
| `ask_commit_on_completion` | integer boolean not null default `true` | |
| `hook_policy_json` | json text | Named hook prompts only in v1 |
| `created_at` / `updated_at` | integer timestamp | Standard columns |

#### Existing Table Usage
- `tasks.status` remains Session/planning status. It should not be the queue claim lock.
- `task_runs` remains the run execution record created after Queue Entry claim.
- `task_run_todos` remains the TodoList source of truth.
- `task_events` records Queue Entry state transitions, processor claims, workflow gates, and archive decisions.

### Claim Semantics
- Processor claim must be atomic.
- A Queue Entry must move from `queued` to `claimed` before long-running work starts.
- The claim query must prevent two processors from taking the same entry.
- Startup recovery must detect stale `claimed` / `processing` entries and move them to a recoverable state.
- Claim ordering is `priority desc`, then `queue_position asc nulls last`, then `created_at asc`.
- Claim must check active count against `implementation_queue_settings.processor_count` inside the same service path that changes state.
- If a run fails to start after claim, the Queue Entry moves to `failed` with `status_reason`; do not silently requeue unless the failure is a stale claim recovery.

### Processor Capacity
- Global processor count defaults to `1`.
- UI allows `1..3`.
- Processor count controls only Implementation Queue execution.
- It must not throttle normal Workbench Chat or direct user commands.
- The visible Processor lanes are derived from settings plus active Queue Entries. A separate persistent `implementation_processors` table is not required for v1.

### Queue Admission
Implementation plans are not queued automatically.

When an implementation plan is created or updated to an executable state:
1. Persist the plan artifact/message.
2. Mark the Session as `plan_ready` or equivalent.
3. Ask the user whether to add it to the Implementation Queue.
4. Only on explicit Yes, create a Queue Entry.

Admission must reject:
- missing task
- missing implementation plan artifact/message
- an already active Queue Entry for the same task
- terminal or deleted tasks

## Replacement Map
### Backend
| Existing path | Action |
| --- | --- |
| `api/modules/nightworkers/nightworkers.repository.ts::claimNextQueuedTask` | Replace with Queue Entry claim repository function |
| `api/modules/nightworkers/nightworkers.service.ts::queueTask` | Change to explicit Queue Entry creation or wrap new service temporarily |
| `api/modules/nightworkers/nightworkers.service.ts::runSessionQueueForRepository` | Replace with global Implementation Queue drain |
| `api/modules/nightworkers/nightworkers.service.ts::startWorkbenchTaskRun` | Keep as run creation path, but call after Queue Entry claim for queued automation |
| `api/modules/nightworkers/nightworkers.routes.ts` queue routes | Add `/api/implementation-queue/*`; deprecate old workbench queue route after UI migration |
| `api/db/schema.ts` | Add new queue/settings tables and migration |

### Frontend
| Existing path | Action |
| --- | --- |
| `src/modules/nightworkers/components/ProjectSidebar.tsx` | Remove embedded `ProjectQueuePanel`; add top-level Queue menu entry |
| `src/modules/nightworkers/components/NightWorkersShell.tsx` | Add Queue screen mode and route-like navigation state |
| `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` | Stop deriving global queue from `processing` / `queue` groups; add queue API hooks |
| `src/modules/nightworkers/workbenchSelectors.ts` | Remove old queue grouping as execution source; keep only Session/planning projections |
| `src/modules/nightworkers/types.ts` | Add Queue Entry, Processor Lane, Todo Workflow settings types |
| `src/modules/nightworkers/components/SettingsScreen.tsx` | Replace Session Queue controls with TODO Workflow settings and/or link to Queue screen settings |

### Documentation
| Existing path | Action |
| --- | --- |
| `README.md` | Update feature bullets after implementation lands |
| `spec/docs/architecture.md` | Replace old Session Queue runtime model text after behavior is verified |
| `spec/docs/configuration.md` | Replace `SESSION_QUEUE_MAX_CONCURRENCY` and project queue controls with new settings after migration |

## Todo Workflow Plan
### Default Workflow
Each Processor Run should create or confirm a TodoList with this minimum workflow:

1. Analyze implementation plan and task requirements.
2. Generate TodoList for the run.
3. Execute implementation Todo.
4. Review code for that Todo.
5. Apply review fixes.
6. Run relevant verification or quality gate.
7. Repeat for all implementation Todos.
8. Run final verification.
9. Ask whether to commit.
10. Archive Queue execution.

### Todo Invariants
- Every implementation Todo must include review and fix steps.
- Verification must be explicit and recorded as a gate result.
- Workflow step outcomes should be persisted to `task_events` and/or `task_run_todos`.

### Configurable TODO Workflow
Settings screen gets a `TODO Workflow` section.

Initial configurable options:
- Require review/fix for every Todo
- Require final verification
- Ask for commit at completion
- Hook prompts before or after selected workflow steps

Avoid arbitrary script execution in the first version. Use named workflow behaviors first, then expand if the model proves stable.

## Hooks Plan
Hooks should prompt or gate behavior at workflow boundaries.

Examples:
- Before file edits: remind or enforce repository safety checks.
- After implementation step: prompt review.
- After review fixes: prompt targeted tests.
- Before archive: confirm final quality gate and commit decision.

Hooks should not replace Queue state transitions. State transitions remain owned by backend services.

## Frontend Plan
### Remove Existing Queue Elements
Remove or replace:
- queue panel embedded inside `ProjectSidebar`
- `DRAFT | READY` style toggle UI
- queue count displays that imply Project-local queue ownership
- drag/drop behavior tied to the old `processing` / `queue` / `archive` grouping

### Add Queue Screen
Likely frontend areas:
- `src/modules/nightworkers/components/ProjectSidebar.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- new `ImplementationQueueScreen` component
- new queue-specific selectors and types

### UI Behavior
- Project top menu opens the dedicated Queue screen.
- Queue screen can filter by Project but remains global by default.
- Session Chat remains accessible from Queue cards.
- Queue cards should link back to the Session.
- Processor cards should show active Todo and gate status.

## API Plan
Add or adapt endpoints around explicit Implementation Queue behavior.

### Required Endpoints
`GET /api/implementation-queue`

Returns:
- `processors`: derived lane list from processor count and active entries
- `queued`: Queue Entries waiting for claim
- `notQueued`: plan-ready Sessions without active Queue Entry
- `settings`: queue settings

`POST /api/implementation-queue/entries`

Body:
- `taskId`

Behavior:
- validates plan readiness
- creates one active Queue Entry
- triggers drain if capacity is available

`PATCH /api/implementation-queue/entries/:id`

Allowed v1 operations:
- reorder by `priority` / `queuePosition` while status is `queued`
- cancel while status is `queued`, `claimed`, `processing`, or `needs_human`
- resume from `needs_human`

`POST /api/implementation-queue/entries/:id/archive`

Behavior:
- moves `execution_completed`, `failed`, or `cancelled` entries to `execution_archived`
- triggers drain for next queued entry

`POST /api/implementation-queue/drain`

Behavior:
- service-only or admin/debug endpoint
- drains while active processor count is below configured capacity
- must be idempotent

`GET /api/implementation-queue/settings`

Returns:
- `processorCount`

`PATCH /api/implementation-queue/settings`

Body:
- `processorCount`, clamped to `1..3`

`GET /api/todo-workflow/settings`

Returns global v1 Todo Workflow settings.

`PATCH /api/todo-workflow/settings`

Updates global v1 Todo Workflow settings with named options only.

Existing Workbench Chat endpoints should remain usable regardless of Queue membership.

## Migration Plan
### Phase 1: Model and Read Surface
1. Add schema, migration, repository functions, and service types.
2. Add Queue settings and Todo Workflow settings defaults.
3. Add `GET /api/implementation-queue` with derived `processors`, `queued`, and `notQueued`.
4. Add frontend types and a read-only Queue screen.

### Phase 2: Queue Admission and Single Processor
1. Add explicit Queue Entry creation from plan-ready Session.
2. Add atomic single-processor claim and drain.
3. Start `task_runs` only after Queue Entry claim.
4. Persist Queue state transitions to `task_events`.
5. Verify Chat remains usable for queued, not queued, and processing Sessions.

### Phase 3: UI Replacement
1. Add top-level Queue menu in each Project.
2. Remove embedded `ProjectQueuePanel`.
3. Remove `DRAFT | READY` queue controls and old queue counts.
4. Replace Settings `Session Queue` controls with new Processor / TODO Workflow settings.

### Phase 4: Multi-Processor and Recovery
1. Enable `processorCount` values `2` and `3`.
2. Add active-count enforcement and duplicate-claim tests.
3. Add startup stale-claim recovery.
4. Add archive-triggered drain for the next queued entry.

### Phase 5: Documentation Cleanup
1. Update `README.md`.
2. Update `spec/docs/architecture.md`.
3. Update `spec/docs/configuration.md`.
4. Remove references that describe the old Session Queue as current behavior.

## Implementation Task Breakdown
### Backend Tasks
1. Add Drizzle tables and migration for queue entries and settings.
2. Add repository methods:
   - create Queue Entry
   - list Queue dashboard data
   - claim next Queue Entry atomically
   - update Queue Entry state
   - archive Queue Entry
   - read/update settings
3. Add service layer:
   - admission validation
   - drain coordinator
   - processor capacity enforcement
   - stale recovery
   - task run start from claimed entry
4. Add Hono routes and zod schemas.
5. Add event logging for state transitions.

### Frontend Tasks
1. Add queue types.
2. Add query/mutation hooks.
3. Add `ImplementationQueueScreen`.
4. Add Project top-level Queue entrypoint.
5. Remove old sidebar queue panel and DnD grouping.
6. Add Processor count control.
7. Add TODO Workflow settings controls.
8. Keep Session Chat actions available from Queue cards.

### Test Tasks
1. Add service tests for admission, claim, drain, archive, and stale recovery.
2. Add route tests for queue endpoints.
3. Update selector tests after old queue grouping removal.
4. Add UI/component tests where the current test setup supports them.
5. Run targeted tests first, then `pnpm verify`.

## Verification Plan
### Unit / Service Tests
- Queue Entry is created only after explicit user approval.
- Queue Entry claim is atomic.
- Processor count caps active processing to `1..3`.
- Queue processing does not block normal Chat.
- Stale claimed entries recover on startup or drain.
- Queue archive releases Processor capacity.
- Todo Workflow creates required review/fix/gate steps.
- Old `queueEnabled` / `maxConcurrentSessions` behavior no longer starts implementation automation from the removed UI path.

### UI Tests
- Old queue UI is absent from ProjectSidebar.
- `DRAFT | READY` toggle is absent.
- Queue menu opens dedicated Queue screen.
- Processor lanes render correctly for 1, 2, and 3 slots.
- Not Queued area shows eligible plan-ready Sessions.
- Session Chat still works for queued and not-queued Sessions.
- Processor count control clamps to `1..3`.
- Queue screen empty states are useful for no processors active, no queued entries, and no not-queued candidates.

### End-to-End Checks
- Create implementation plan.
- Answer No to queue prompt and verify Session remains usable.
- Answer Yes and verify Queue Entry appears.
- Processor claims the next Queue Entry.
- TodoList is generated with required review/fix/verify steps.
- Completion asks for commit decision.
- Queue execution archives and next Queue Entry starts.

### Commands
Run focused tests while implementing:

```bash
pnpm test run tests/services.nightworkers-service.test.ts tests/routes.nightworkers-workbench.test.ts tests/nightworkers.workbench-selectors.test.ts
```

Before completion:

```bash
pnpm verify
```

## Risks
- Reusing `tasks.status` alone may keep UI semantics and execution semantics tangled.
- Multiple processors can duplicate work if claim is not atomic.
- Archive wording can confuse users if it appears to archive the Session instead of the execution.
- Arbitrary workflow customization can become unsafe if introduced before named workflow steps are stable.
- Project-specific controls can obscure that Processor capacity is global.

## Open Decisions
- Exact UI label for `execution_archived`.
- Whether Not Queued should include completed-but-still-chat-active Sessions.
- Whether commit decision is always human-confirmed or can be defaulted by project setting later.
- Whether old `SESSION_QUEUE_MAX_CONCURRENCY` should be retained temporarily as a fallback env default for `processor_count`, or removed in the same migration.

## First Implementation Slice
1. Introduce `implementation_queue_entries`, `implementation_queue_settings`, and `todo_workflow_settings`.
2. Add queue repository/service functions and `GET /api/implementation-queue`.
3. Add read-only global Queue screen and Project top-level Queue menu.
4. Add explicit queue admission action for plan-ready Sessions.
5. Add single Processor claim path with atomic reservation.
6. Start a normal `task_runs` row from the claimed Queue Entry.
7. Remove existing embedded queue UI and `DRAFT | READY` toggle.
8. Verify normal Chat still works outside and inside Queue.

This slice intentionally starts with one Processor before expanding to 2 or 3. The UI can expose the final setting shape early, but backend concurrency should be proven with one Processor first.
