# Project Queue Session View Implementation Plan

## Purpose

Project Queue mockup を本番運用前提の Session ベース view に置き換える。

現在の mockup は UI 検討用の dummy task を持っているが、実装後は NightWorkers の実 Session と Implementation Queue を唯一のデータ源にする。Kanban と Table は同じ Session 集合を、異なる見え方で表示するだけにする。

## Scope

対象:

- Project sidebar の queue icon から開く Project Queue 画面
- Project Queue の Kanban view
- Project Queue の Table view
- Project Queue 用の derived view model
- Session / Implementation Queue dashboard からの実データ接続
- Executing slot 数の global queue setting 参照
- mock data と mock schema の削除
- 600 行以下を前提にした component 分割
- frontend command / mutation に queue entry `queuePosition` 更新を接続する作業

対象外:

- Implementation Queue の backend 実行ロジック変更
- queue processor の claim / drain 仕様変更
- Project ごとの concurrent execution 制御追加
- provider / supervisor / prompt 実行判断の変更
- unrelated UI refresh
- DB schema migration
- existing `Task.priority` based sidebar ordering の再設計

## Current State

現在の Project Queue は `ProjectQueueMockupScreen.tsx` に mock data と UI 実装が同居している。

問題:

- `TASK_TITLES`, `STATUS_SEQUENCE`, `buildMockTasks` などの dummy data が本番データと無関係
- mock task schema が実 Session / queue entry と一致しない
- 1 file が 600 行を超えている
- component と helper が同じ file に密集している
- Executing の数が mock data の状態に依存している

既存の本番データ源:

- `Task`
- `WorkbenchSessionView`
- `ImplementationQueueEntry`
- `ImplementationQueueDashboard`
- `ImplementationQueueDashboard.settings.processorCount`
- `ImplementationQueueDashboard.processors`
- `ImplementationQueueDashboard.queued`
- `ImplementationQueueDashboard.completed`
- `ImplementationQueueDashboard.notQueued`

既存の永続操作:

- create queue entry: `POST /api/implementation-queue/entries`
- update queued entry position: `PATCH /api/implementation-queue/entries/:id` with `queuePosition`
- requeue attention entry: `POST /api/implementation-queue/entries/:id/requeue`
- archive completed entry: `POST /api/implementation-queue/entries/:id/archive`

重要な制約:

- `reorderQueueSessions` は `Task.priority` を更新する Session sidebar 用 mutation であり、Project Queue の Planned Queue reorder には使わない。
- Planned Queue reorder は `ImplementationQueueEntry.queuePosition` を更新する。
- `Task.priority` は Queue Priority として表示しない。
- frontend には `PATCH /implementation-queue/entries/:id` の汎用 wrapper がまだないため、本番実装で追加する。

## Product Behavior

### Shared Task Set

Kanban と Table は完全に同じ Session 集合を表示する。

違ってよいもの:

- layout
- column density
- sortable table headers
- card/table row presentation

違ってはいけないもの:

- 表示対象 Session
- Session の status 判定
- queue position
- Need Attention 判定
- Executing slot 判定

### Kanban Lanes

Kanban は以下の lane を持つ。

1. Unclassified
2. Planned
3. Executing
4. Recently Completed

Need Attention は Recently Completed lane の中で区別して表示する。Need Attention task だけ Planned へ戻せる。

### Table Default Order

Table の default order は以下に固定する。

1. Executing
2. Need Attention
3. Planned Queue by `queuePosition`
4. Remaining sessions

Table header click では各項目ごとに ASC / DESC sort を行う。header sort 中も表示対象 Session は変えない。

### Queue Priority

`Queue Priority` は Planned Queue 内の順番だけを表す。

- Planned: `#1`, `#2`, ...
- Unclassified: empty
- Executing: empty
- Need Attention: empty
- Completed: empty

Task priority such as `task.priority` must not be shown as Queue Priority.

### Executing Slots

Executing slot 数は all projects 共通の system upper limit として扱う。

参照元:

- `implementationQueue.settings.processorCount`
- `implementationQueue.processors`

Project Queue 画面内で固定値を持たない。

対象 Project の Session が実行中の場合は Executing lane に表示する。他 Project が slot を占有している場合、Project scoped view では以下のどちらかを採用する。

Preferred:

- slot capacity は global count として表示する
- lane content は対象 Project の executing sessions のみ表示する

Alternative:

- 他 Project 占有 slot を muted placeholder として表示する

初回実装は Preferred とする。

## Data Model

Project Queue 専用の derived type を定義する。永続 schema ではない。

```ts
export type ProjectQueueTaskStatus =
  | 'unclassified'
  | 'planned'
  | 'executing'
  | 'attention'
  | 'completed';

export type ProjectQueueTask = {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  status: ProjectQueueTaskStatus;
  phase: string;
  updatedAt: unknown;
  queueEntryId?: string;
  queuePosition?: number | null;
  processorSlot?: number | null;
  activeRunId?: string | null;
  statusReason?: string | null;
};
```

Do not include:

- dummy title
- dummy owner
- mock priority
- generated summary unrelated to Session

## Status Mapping

### Executing

Source:

- `implementationQueue.processors[*].entry`

Condition:

- entry exists
- entry repository matches current project
- entry status is `claimed` or `processing`

Fields:

- `processorSlot` from processor lane
- `queueEntryId` from entry id
- `activeRunId` from entry

### Need Attention

Source:

- active or completed queue entries
- Session view when available

Conditions:

- queue entry status is `needs_human`
- queue entry status is `awaiting_commit_decision`
- queue entry status is `execution_completed`
- queue entry status is `failed`
- session email state is `needs_input`
- session email state is `review_needed`
- session email state is `failed`

Need Attention remains visually associated with Recently Completed lane in Kanban, but Table default order places it after Executing.

### Planned

Source:

- `implementationQueue.queued`

Condition:

- entry repository matches current project
- entry status is `queued`

Fields:

- `queuePosition` from entry
- label `#${queuePosition}`

### Unclassified

Source:

- project Sessions not represented by active queue entry
- `implementationQueue.notQueued`
- `WorkbenchSessionView` group data

Condition:

- not executing
- not attention
- not planned
- not completed

This should include real Sessions only. Do not synthesize dummy rows.

### Completed

Source:

- `implementationQueue.completed`
- completed / archived Session views

Condition:

- queue entry status is `cancelled` or `execution_archived`
- queue entry status is a terminal state already archived or not requiring retry/review
- task status is completed/cancelled/failed only when it does not qualify as Need Attention

## Sorting Contract

Project Queue must expose two independent order contracts.

Kanban order:

1. Unclassified lane
2. Planned lane by `queuePosition`
3. Executing lane by `processorSlot`
4. Recently Completed lane, with Need Attention before Completed

Table default order:

1. Executing by `processorSlot`
2. Need Attention by most recent `updatedAt`
3. Planned by `queuePosition`
4. Remaining sessions by status rank, then most recent `updatedAt`

Table header sort:

- `Status`: status label ASC / DESC
- `Queue Priority`: numeric `queuePosition`, empty values last in ASC and first in DESC only if TanStack default inversion requires it
- `Task`: title ASC / DESC
- `Phase`: phase ASC / DESC
- `Updated`: timestamp ASC / DESC

Header sort must not mutate queue data. It is display-only.

## File Structure

All files must remain below 600 lines.

Target files:

```txt
src/modules/nightworkers/components/project-queue/ProjectQueueScreen.tsx
src/modules/nightworkers/components/project-queue/ProjectQueueBoard.tsx
src/modules/nightworkers/components/project-queue/ProjectQueueLane.tsx
src/modules/nightworkers/components/project-queue/ProjectQueueTaskCard.tsx
src/modules/nightworkers/components/project-queue/ProjectQueueTable.tsx
src/modules/nightworkers/components/project-queue/projectQueueModel.ts
src/modules/nightworkers/components/project-queue/projectQueueDnd.ts
src/modules/nightworkers/components/project-queue/projectQueueTypes.ts
src/modules/nightworkers/components/project-queue/index.ts
```

Expected responsibilities:

- `ProjectQueueScreen.tsx`
  - parent layout
  - board/table toggle
  - passes callbacks
  - no business-heavy mapping

- `ProjectQueueBoard.tsx`
  - Kanban grid
  - lane composition
  - no data fetching

- `ProjectQueueLane.tsx`
  - lane header
  - lane body
  - drop highlighting

- `ProjectQueueTaskCard.tsx`
  - card display
  - draggable/sortable wrappers

- `ProjectQueueTable.tsx`
  - TanStack Table columns
  - default order
  - ASC/DESC header sorting

- `projectQueueModel.ts`
  - build `ProjectQueueTask[]`
  - group tasks into lanes
  - default table sort
  - status mapping

- `projectQueueDnd.ts`
  - allowed move rules
  - planned reorder helper
  - drag collision helper if needed

- `projectQueueTypes.ts`
  - shared derived types only

## Component Contract

`ProjectQueueScreen` should receive production data through props.

```ts
type ProjectQueueScreenProps = {
  project: Repository;
  sessions: Task[];
  sessionViews: WorkbenchSessionView[];
  implementationQueue: ImplementationQueueDashboard | null;
  isLoading: boolean;
  onOpenSession: (sessionId: string) => void;
  onRequeueEntry: (entryId: string, note?: string) => Promise<void>;
  onQueueSession: (sessionId: string) => Promise<void>;
  onUpdateQueueEntry: (
    entryId: string,
    input: { queuePosition?: number | null; priority?: number }
  ) => Promise<void>;
};
```

`onUpdateQueueEntry` must call `PATCH /implementation-queue/entries/:id` and invalidate `implementationQueue`. Planned reorder must not use `reorderQueueSessions`, because that mutation updates `Task.priority`, not `ImplementationQueueEntry.queuePosition`.

`NightWorkersShell` should derive `sessionViews` from `workspace.groupedSessionViews[project.id]` by flattening `processing`, `queue`, and `archive`. Do not make `ProjectQueueScreen` read global workspace state directly.

## Implementation Readiness Checklist

Complete these checks before editing production code:

```sh
rg -n "patchImplementationQueueEntryRoute|queuePosition" api/modules/nightworkers
rg -n "reorderQueueSessions|createImplementationQueueEntry|requeueImplementationQueueEntry" src/modules/nightworkers/hooks src/modules/nightworkers/nightWorkersCommands.ts
wc -l src/modules/nightworkers/components/ProjectQueueMockupScreen.tsx
```

Expected:

- backend route accepts `queuePosition`
- frontend has create/requeue mutations
- frontend lacks generic queue entry patch wrapper and needs one
- current mock screen is over 600 lines and must be split

Do not start UI replacement before confirming the above. If the backend route stops accepting `queuePosition`, stop and add backend support first.

## Implementation Phases

### Phase 1: Add Queue Entry Update Command And Mutation

Goal:

- Make Planned Queue reorder persist through existing queue entry API.

Tasks:

- Add `updateImplementationQueueEntry(entryId, input)` to `nightWorkersCommands.ts`
- Accept `{ queuePosition?: number | null; priority?: number }`
- Add `updateImplementationQueueEntryMutation` to `useNightWorkersMutations`
- Invalidate `implementationQueue`
- Expose `updateImplementationQueueEntry` through `useNightWorkersWorkspace`
- Add the method to `NightWorkersWorkspaceState`

Gate:

- `bun run typecheck`
- `rg -n "updateImplementationQueueEntry" src/modules/nightworkers` shows command, mutation, workspace exposure
- No usage of `reorderQueueSessions` from Project Queue

### Phase 2: Add Production View Model

Goal:

- Create the Session / Implementation Queue projection before rendering code depends on it.

Tasks:

- Add `projectQueueTypes.ts`
- Add `projectQueueModel.ts`
- Implement `buildProjectQueueTasks`
- Implement status mapping
- Implement table default sort:
  1. Executing
  2. Need Attention
  3. Planned by `queuePosition`
  4. Remaining sessions
- Implement lane grouping
- Add focused tests for:
  - duplicate row precedence
  - Executing first
  - Need Attention second
  - Planned `queuePosition` ordering
  - empty Queue Priority outside Planned

Gate:

- Model can build tasks from real `ImplementationQueueDashboard`
- No dummy row creation in model
- Tests cover default order and no dummy synthesis
- `bunx vitest run` or repo-equivalent targeted test command passes

### Phase 3: Create Split Production Components

Goal:

- Build production components against `ProjectQueueTask[]`, not mock data.

Tasks:

- Create `components/project-queue/`
- Add `ProjectQueueScreen.tsx`
- Add `ProjectQueueBoard.tsx`
- Add `ProjectQueueLane.tsx`
- Add `ProjectQueueTaskCard.tsx`
- Add `ProjectQueueTable.tsx`
- Add `projectQueueDnd.ts`
- Add `index.ts`
- Keep all files under 600 lines
- Components must be named top-level functions before use
- No mock constants or generated fake tasks

Gate:

- `wc -l src/modules/nightworkers/components/project-queue/*`
- every file is under 600 lines
- `rg "TASK_TITLES|STATUS_SEQUENCE|buildMockTasks|MockProjectTask" src/modules/nightworkers/components/project-queue` returns no matches
- `bun run typecheck`

### Phase 4: Wire Production Data Into Shell

Goal:

- Replace mock screen with production Session / Queue dashboard data.

Tasks:

- Change `NightWorkersShell` to pass:
  - `workspace.sessions`
  - `workspace.groupedSessionViews`
  - `workspace.implementationQueue`
  - `workspace.isImplementationQueueLoading`
  - queue callbacks
  - `workspace.updateImplementationQueueEntry`
- Replace `ProjectQueueMockupScreen` usage with `ProjectQueueScreen`
- Rename sidebar tooltip from mockup to production wording
- Remove mock-specific labels from dictionaries

Gate:

- Project Queue displays real Sessions
- Empty state is shown when a project has no Sessions
- Executing slot count comes from `implementationQueue.settings.processorCount`
- No static mock tasks appear
- Project Queue still opens from project sidebar

### Phase 5: Replace DnD With Persisted Operations

Goal:

- Drag/drop only performs real supported operations.

Tasks:

- Need Attention -> Planned:
  - if queue entry exists and is resumable, call `requeueImplementationQueueEntry`
  - if no queue entry exists but session is plan-ready, call `createImplementationQueueEntry`
- Planned reorder:
  - call `updateImplementationQueueEntry(entryId, { queuePosition })` for affected queued entries
  - wait for mutation success or refetch before showing persisted order
  - do not keep local-only reorder after mutation failure
- Disallow:
  - drop into Executing
  - Planned -> Complete
  - Completed -> Planned unless it qualifies as Need Attention
  - Unclassified -> Planned unless existing product rules permit queueing

Gate:

- Any visible drag result is persisted through queue entry mutation or blocked
- React Query invalidates `implementationQueue`
- UI returns to server truth after mutation
- Browser test confirms Planned reorder survives refetch

### Phase 6: Delete Legacy Mock Screen And Data

Goal:

- Remove all dummy data and mock schema.

Delete:

- `TASK_TITLES`
- `STATUS_SEQUENCE`
- `MockTaskStatus`
- `MockProjectTask`
- `buildMockTasks`
- `resolvePhase`
- `resolveSummary`
- any fake owner/priority/processor data
- `ProjectQueueMockupScreen.tsx` if fully replaced

Gate:

```sh
rg "Mock|TASK_TITLES|STATUS_SEQUENCE|buildMockTasks|resolveSummary|resolvePhase" src/modules/nightworkers
```

Expected:

- no Project Queue mock references remain

### Phase 7: Remove Mock Naming

Goal:

- Product UI no longer says mockup.

Tasks:

- Rename component export
- Rename dictionary keys
- Rename sidebar tooltip
- Optional: keep file alias temporarily only if imports require incremental migration

Gate:

```sh
rg "mockup|Mockup|ProjectQueueMockup" src/modules/nightworkers
```

Expected:

- no user-facing mockup naming remains

## Validation Plan

Run after each implementation phase:

```sh
bunx biome check src/modules/nightworkers/components/project-queue src/modules/nightworkers/components/NightWorkersShell.tsx src/modules/nightworkers/components/ProjectSidebar.tsx src/modules/nightworkers/i18n/dictionaries/ja.ts src/modules/nightworkers/i18n/dictionaries/en.ts
bun run typecheck
```

Run after model phase:

```sh
bunx vitest run src/modules/nightworkers/components/project-queue
```

If the repo does not already colocate component tests there, place model tests next to the model using the established local test naming convention and run that exact target.

Run before final closeout:

```sh
bun run build:frontend
bun run verify
```

Manual/browser checks:

- Project sidebar queue icon opens Project Queue
- No mock data is visible
- Kanban and Table show the same Session set
- Table default order is Executing -> Need Attention -> Planned by queue position -> remaining
- Queue Priority is empty outside Planned
- Executing slot count matches `implementationQueue.settings.processorCount`
- Table header click toggles ASC / DESC
- Need Attention can return to Planned only through persisted operation
- Planned reorder persists through `PATCH /implementation-queue/entries/:id`
- lane scrollbars do not reappear

Suggested Playwright assertions:

- collect Kanban task ids and Table task ids, sort both sets, assert equality
- read first Table statuses, assert all Executing rows precede Need Attention rows, and Need Attention rows precede Planned rows
- read Planned queue labels, assert `#1`, `#2`, ... without gaps for queued entries
- drag a Planned row/card, wait for mutation/refetch, assert order remains after reload
- drag a Need Attention card to Planned, assert a queue entry mutation or requeue call completes and row moves after refetch
- attempt drop into Executing, assert no mutation and no lane change

Line count gate:

```sh
wc -l src/modules/nightworkers/components/project-queue/*
```

Expected:

- every file is under 600 lines

## Stop Conditions

Stop and resolve before continuing if:

- `PATCH /implementation-queue/entries/:id` no longer accepts `queuePosition`
- Session status mapping cannot distinguish completed from attention safely
- Project Queue would need to synthesize rows not backed by `Task` or `ImplementationQueueEntry`
- Executing slot count cannot be read from `ImplementationQueueDashboard`
- any split file grows beyond 600 lines
- Table and Kanban task id sets diverge after production wiring

## Risks

### Reorder Persistence Gap

The current UI has local Planned reorder behavior. Production cannot keep local-only reorder. Backend support exists through `PATCH /implementation-queue/entries/:id` with `queuePosition`, but frontend command/mutation wiring must be added before enabling reorder.

### Status Mapping Drift

`WorkbenchSessionView.emailState`, `Task.status`, and `ImplementationQueueEntry.status` overlap but are not identical. The derived model must prioritize queue entry truth for queue lanes and use session view as supporting evidence.

### Duplicate Rows

The same Session may appear through `processors`, `queued`, `completed`, and `sessions`. The model must de-duplicate by `task.id` / `taskId` with deterministic precedence:

1. Executing processor entry
2. Need Attention queue entry/session state
3. Queued entry
4. Completed entry
5. Unclassified session

### Global Slot Semantics

Project Queue is project scoped, but Executing slots are global. The UI must not imply each Project has its own slot pool.

## Final Acceptance Criteria

- Project Queue is production Session based.
- Dummy data is fully removed.
- Kanban and Table use the same `ProjectQueueTask[]`.
- Executing uses global queue processor settings.
- Table default order matches the specified production order.
- Queue Priority only shows planned queue position.
- Planned reorder persists by updating queue entry `queuePosition`.
- Need Attention to Planned is persisted through requeue or queue-entry creation.
- DnD never fakes persistence.
- All new Project Queue files are under 600 lines.
- Components are explicitly defined and imported before use.
- `bun run verify` passes.
