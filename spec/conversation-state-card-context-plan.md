# Conversation StateCard Context Plan

## Goal

Workbench の複数ターン会話で、2 回目以降の実行が前回の会話・分類・変更状態を失わないようにする。ただし、既存の Supervisor / provider / skill routing ロジックは壊さない。新しい context 構築は独立ドメインとして追加し、入口と出口を最小化する。

## Non-Goals

- Supervisor の Round 1 / Round 2 schema 契約を置き換えない。
- `llm-provider` に用途別 SystemContext や実行判断を追加しない。
- AGENTS.md / skill reference の runtime ingestion 方針を変えない。
- 過去の `task_messages` / `run_events` 全文を毎回 LLM に渡さない。
- 初期実装で LLM 要約器を必須にしない。

## Current Problem

現行の `startTaskRun(...)` は task の最後の user message を `compiledPromptText` として runtime に渡す。`runSupervisorLoop(...)` は `latestUserMessage` があればそれを `userInput` にし、その単一入力に対して Round 1 classification を再実行する。

このため、Workbench intake では `minor_code_edit` と判定済みでも、runtime Round 1 が最新 user message だけを見て `planning` と再判定しうる。これは provider session id の違いというより、runtime prompt に継続文脈が入っていないことが原因。

## Design Principle

Source of truth と LLM context を分ける。

```text
source of truth:
  task_messages
  task_runs
  run_events
  repository/git state

derived cache:
  conversation_context_snapshots.snapshot_json
  conversation_context_snapshots.state_card_text

runtime prompt:
  latest user request
  compact StateCard text
```

内部は JSON で保持し、LLM には短い StateCard text として渡す。巨大 JSON を prompt に直接入れない。

## Turn Lifecycle

引き継ぎ Context は「ユーザーが依頼し、AI が回答して止まる」単位で更新する。ここでの 1 turn は、単一 user message だけではなく、その user message に対する assistant/system/tool/run events と最終応答までを含む。

基本フロー:

```text
turn N starts:
  latest user message
  + latest StateCard from turn N-1
  -> runtime prompt

turn N runs:
  supervisor decisions
  tool calls/results
  file changes
  final answer
  -> task_messages / task_runs / run_events / git state

turn N stops:
  source of truth
  + previous snapshot as continuity hint
  -> new ConversationContextSnapshot
  -> new StateCard for turn N+1
```

重要なのは、`StateCard(N+1) = StateCard(N) + turn N の会話内容` だけで作らないこと。StateCard は prompt 用の短い派生物なので、連鎖的に要約だけを要約すると情報落ちや誤りが蓄積する。

新しい snapshot は常に以下を読み直して作る。

- `task_messages`
- `task_runs`
- `run_events`
- repository/git state
- previous snapshot の continuity fields

previous snapshot は「前回の作業文脈を拾いやすくする補助」であり、DB/event/git の真実を置き換えない。

## New Domain

`api/services/conversation-context/` を追加する。

```text
api/services/conversation-context/
  index.ts
  types.ts
  build.ts
  render.ts
  token-budget.ts
  flags.ts
  git.ts
  repository.ts
```

このドメインは既存 Supervisor に依存しない。入力は task id / repository path / optional run id、出力は `ConversationContextSnapshot` と `stateCardText` のみ。

### Public API

他ドメインが import してよい関数は `index.ts` から export する次の 3 つだけ。

```ts
export async function refreshConversationContextSnapshot(
  input: RefreshConversationContextInput
): Promise<ConversationContextRefreshResult>;

export async function getLatestConversationContextForTask(
  taskId: string
): Promise<ConversationContextSnapshotRecord | null>;

export function buildPromptWithStateCard(input: {
  latestUserMessage: string;
  stateCardText?: string | null;
}): string;
```

`buildPromptWithStateCard(...)` は pure function にする。feature flag の判定や DB access を含めない。Supervisor / provider からはこの domain を import しない。

### Files To Modify

実装時に触るファイルを限定する。

Add:

```text
api/services/conversation-context/index.ts
api/services/conversation-context/types.ts
api/services/conversation-context/build.ts
api/services/conversation-context/render.ts
api/services/conversation-context/token-budget.ts
api/services/conversation-context/flags.ts
api/services/conversation-context/git.ts
api/services/conversation-context/repository.ts
tests/services.conversation-context.test.ts
tests/services.conversation-context-integration.test.ts
drizzle/migrations/0008_conversation_context_snapshots.sql
```

Modify:

```text
api/db/schema.ts
api/db/bootstrap.ts
api/modules/nightworkers/nightworkers.service.ts
api/services/agent-runtime/types.ts
api/services/agent-runtime/NativeAgentRuntime.ts
.env.example
README.md
spec/conversation-state-card-context-plan.md
```

Do not modify:

```text
api/services/supervisor/prompt.ts
api/services/supervisor/supervisor-loop.ts
api/services/supervisor/llm-provider/*
api/services/supervisor/skills/**
```

Supervisor に StateCard schema を認識させない。Supervisor には、従来どおり 1 本の user input string が渡るだけにする。

## Data Model

新規 table を追加する。既存 `tasks.compiled_prompt` や `task_runs.context_snapshot` は互換維持する。

```text
conversation_context_snapshots
- id text primary key
- task_id text not null references tasks(id) on delete cascade
- run_id text null references task_runs(id) on delete set null
- version integer not null
- source_message_id text null
- source_run_id text null
- source_event_cursor text null
- job_type text null
- latest_user_message_id text null
- previous_run_id text null
- terminal_state text null
- token_estimate integer not null default 0
- snapshot_json text not null
- state_card_text text not null
- created_at integer not null
- updated_at integer not null
```

Index:

```text
conversation_context_snapshots_task_id_idx(task_id)
conversation_context_snapshots_run_id_idx(run_id)
conversation_context_snapshots_task_updated_idx(task_id, updated_at)
```

Optional child table は初期実装では作らない。target files の検索が必要になったら追加する。

```text
conversation_context_snapshot_files
- snapshot_id
- path
- role
```

### Drizzle Schema

`api/db/schema.ts` に `conversationContextSnapshots` を追加する。TypeScript property names は camelCase、DB column names は snake_case で既存 style に合わせる。

```ts
export const conversationContextSnapshots = sqliteTable(
  'conversation_context_snapshots',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    sourceMessageId: text('source_message_id'),
    sourceRunId: text('source_run_id'),
    sourceEventCursor: text('source_event_cursor'),
    jobType: text('job_type'),
    latestUserMessageId: text('latest_user_message_id'),
    previousRunId: text('previous_run_id'),
    terminalState: text('terminal_state'),
    tokenEstimate: integer('token_estimate').default(0).notNull(),
    snapshotJson: text('snapshot_json', { mode: 'json' }).notNull(),
    stateCardText: text('state_card_text').notNull(),
  },
  (table) => ({
    taskIdIdx: index('conversation_context_snapshots_task_id_idx').on(table.taskId),
    runIdIdx: index('conversation_context_snapshots_run_id_idx').on(table.runId),
    taskUpdatedAtIdx: index('conversation_context_snapshots_task_updated_idx').on(
      table.taskId,
      table.updatedAt
    ),
  })
);
```

### Bootstrap Compatibility

`api/db/bootstrap.ts` にも `CREATE TABLE IF NOT EXISTS conversation_context_snapshots` と index 作成を追加する。ローカル既存 DB は Drizzle migration だけでなく bootstrap path でも起動されるため、両方を更新する。

### Migration

`drizzle/migrations/0008_conversation_context_snapshots.sql` を追加する。既存 migration の style に合わせ、`--> statement-breakpoint` を使う。

```sql
CREATE TABLE `conversation_context_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `version` integer NOT NULL,
  `source_message_id` text,
  `source_run_id` text,
  `source_event_cursor` text,
  `job_type` text,
  `latest_user_message_id` text,
  `previous_run_id` text,
  `terminal_state` text,
  `token_estimate` integer DEFAULT 0 NOT NULL,
  `snapshot_json` text NOT NULL,
  `state_card_text` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_context_snapshots_task_id_idx` ON `conversation_context_snapshots` (`task_id`);
--> statement-breakpoint
CREATE INDEX `conversation_context_snapshots_run_id_idx` ON `conversation_context_snapshots` (`run_id`);
--> statement-breakpoint
CREATE INDEX `conversation_context_snapshots_task_updated_idx` ON `conversation_context_snapshots` (`task_id`, `updated_at`);
```

If using `pnpm db:generate`, verify it does not rewrite unrelated migration metadata. If it does, prefer a hand-written migration that matches existing SQL style and run `pnpm typecheck`.

### Repository Contract

`api/services/conversation-context/repository.ts` owns DB access for this domain. Do not add these functions to `nightworkers.repository.ts`.

```ts
export async function loadConversationContextSource(input: {
  taskId: string;
  runId?: string | null;
}): Promise<ConversationContextSource>;

export async function getLatestConversationContextForTask(
  taskId: string
): Promise<ConversationContextSnapshotRecord | null>;

export async function upsertConversationContextSnapshot(input: {
  taskId: string;
  runId?: string | null;
  snapshot: ConversationContextSnapshotV1;
  stateCardText: string;
}): Promise<ConversationContextSnapshotRecord>;
```

`loadConversationContextSource(...)` loads only the fields needed by the builder:

- task row
- repository row, only for `localPath`
- task messages ordered by `createdAt asc`
- task runs for task ordered by `startedAt desc`
- run events/activity events only if already available through existing tables and bounded by latest run
- latest previous snapshot, if any

Rows returned from Drizzle should be converted into explicit domain types in `repository.ts`; builder code should not depend on raw table row shapes.

Upsert rule:

- If `runId` is provided, latest snapshot for `(taskId, runId)` can be replaced.
- If `runId` is null, insert a task-level idle snapshot.
- Do not delete old snapshots in initial implementation.
- Consumers read latest by `updatedAt desc limit 1`.

## Snapshot Shape

JSON は保存・debug・再 render 用。prompt 表示用ではない。

```ts
type ConversationContextSnapshotV1 = {
  version: 1;
  task: {
    id: string;
    status: string;
    latestUserMessageId: string | null;
    latestUserRequest: string;
    title: string;
  };
  classification: {
    jobType: string | null;
    goal: string | null;
    source: 'intake_metadata' | 'previous_run' | 'none';
  };
  continuity: {
    isContinuation: boolean;
    previousRunId: string | null;
    previousTerminalState: string | null;
    previousAction: string | null;
  };
  files: {
    target: string[];
    touched: string[];
    created: string[];
    modified: string[];
    deleted: string[];
  };
  runState: {
    lastError: string | null;
    lastFinalReport: string | null;
    lastToolFailure: string | null;
  };
  code: {
    snippets: Array<{
      path: string;
      reason: 'target_file_small' | 'relevant_hunk' | 'none';
      content: string;
      truncated: boolean;
    }>;
  };
  limits: {
    tokenEstimate: number;
    truncatedFields: string[];
  };
};
```

### Domain Types

`types.ts` に最低限以下を置く。

```ts
export const CONVERSATION_CONTEXT_VERSION = 1 as const;

export type ConversationContextBuildReason =
  | 'intake_idle'
  | 'run_started'
  | 'run_finished'
  | 'manual_refresh';

export type ConversationContextSnapshotRecord = {
  id: string;
  taskId: string;
  runId: string | null;
  version: number;
  jobType: string | null;
  latestUserMessageId: string | null;
  previousRunId: string | null;
  terminalState: string | null;
  tokenEstimate: number;
  snapshotJson: ConversationContextSnapshotV1;
  stateCardText: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationContextSource = {
  task: {
    id: string;
    title: string;
    status: string;
    description: string | null;
    objective: string | null;
    repositoryPath: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    metadataJson: unknown;
    createdAt: Date;
  }>;
  runs: Array<{
    id: string;
    status: string;
    summary: string | null;
    finalReport: string | null;
    contextSnapshot: unknown;
    startedAt: Date;
    finishedAt: Date | null;
    endedAt: Date | null;
  }>;
  previousSnapshot: ConversationContextSnapshotRecord | null;
};
```

## StateCard Format

LLM に渡すのは JSON ではなく短い text。

```text
<STATE_CARD>
Task: <taskId> | <jobType> | <continuation|new>
User: <latest user request>
Goal: <normalized goal if present>

Continuity:
- <previous completed action or none>
- current intent: continue/edit existing work, not re-plan

Files:
- target: <path>
- touched: <path status>, <path status>

Current state:
- previous run: <terminal state or unknown>
- last error: <short error or none>

Relevant code:
<only target hunk or small target file>

Next:
- <specific expected next action if deterministic>
</STATE_CARD>
```

Renderer rules:

- Always include latest user request.
- Always include intake `jobType` / `goal` if present.
- Include recent previous action only if task has prior run or previous assistant/system metadata.
- Include target file content only when small and known.
- Include diff/stat/hunks only when bounded.
- Never include raw `llm-trace.jsonl`, broad search output, full run event lists, or large JSON.

### Rendered Prompt Wrapper

`buildPromptWithStateCard(...)` returns raw latest user message when StateCard is empty.

```ts
export function buildPromptWithStateCard(input: {
  latestUserMessage: string;
  stateCardText?: string | null;
}) {
  const request = input.latestUserMessage.trim();
  const card = input.stateCardText?.trim();
  if (!card) return request;
  return `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`;
}
```

This wrapper is the only text augmentation. Do not alter system prompt text.

## Deterministic Build Rules

Initial implementation is LLM-free.

1. Load task and task messages.
2. Select latest user message.
3. Find latest `metadataJson.intakeJobSelection` from system messages.
4. Load latest prior task run and terminal state.
5. Extract previous action from final report, run summary, or run-start metadata.
6. Compute git state:
   - `git diff --name-status`
   - `git diff --stat`
   - optional target hunk only when target path is known
7. Derive target files:
   - paths explicitly present in latest user message
   - paths from previous run final report
   - paths from git name-status
   - no broad search
8. If a target file is small, include raw file content.
9. Render StateCard under token budget.
10. Persist snapshot JSON and rendered StateCard.

### Builder Algorithm

`buildConversationContextSnapshot(source, options)` is pure except for git/file reads passed through `git.ts` helpers. For unit tests, allow injecting a fake `gitState`.

```ts
export async function buildConversationContextSnapshot(input: {
  source: ConversationContextSource;
  gitState?: ConversationGitState;
  options?: ConversationContextOptions;
}): Promise<ConversationContextSnapshotV1> {
  const latestUser = findLatestUserMessage(input.source.messages);
  const intake = findLatestIntakeJobSelection(input.source.messages);
  const previousRun = findPreviousRun(input.source.runs, input.options?.currentRunId);
  const previousSnapshot = input.source.previousSnapshot?.snapshotJson ?? null;
  const gitState = input.gitState ?? emptyGitState();
  const targetFiles = deriveTargetFiles({ latestUser, intake, previousRun, previousSnapshot, gitState });
  const snippets = await collectCodeSnippets({ repositoryPath, targetFiles, gitState, options });
  return snapshot;
}
```

Extraction rules:

- `findLatestUserMessage`: last `role === 'user'`.
- `findLatestIntakeJobSelection`: scan messages from newest to oldest and return first `metadataJson.intakeJobSelection` with string `jobType`.
- `findPreviousRun`: newest run that is not the current run, or newest completed/failed run if current run is unknown.
- `previousAction`: prefer `previousRun.finalReport`, then `previousRun.summary`, then `previousSnapshot.continuity.previousAction`; truncate to 360 chars.
- `lastError`: first bounded error text from previous run final judgment/context if available; otherwise null.
- `isContinuation`: true when there is any previous run, previous snapshot, or more than one user message in the task.
- `current intent`: renderer may emit fixed phrase only when `classification.jobType` is one of code edit job types; otherwise omit.

Target file derivation order:

1. Explicit file paths in latest user message.
2. Explicit file paths in intake goal.
3. `previousSnapshot.files.target`.
4. `git diff --name-status` changed files.
5. File paths mentioned in previous final report.

Path extraction must be conservative:

- Accept relative paths with extensions or slash segments.
- Reject paths containing `..`, absolute paths outside repo, `logs/`, `coverage/`, `node_modules/`, `dist/`, `dist-api/`, `.git/`.
- Do not run broad `search_files` or `rg` from this builder.

Git helpers:

```ts
export type ConversationGitState = {
  nameStatus: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown' }>;
  diffStat: string | null;
  hunks: Array<{ path: string; content: string; truncated: boolean }>;
  errors: string[];
};
```

Implementation detail:

- Use `execFile('git', ['-C', repoRoot, 'diff', '--name-status'])`.
- Use `execFile('git', ['-C', repoRoot, 'diff', '--stat'])`.
- Only run `git diff -- <path>` for already-derived target paths.
- Set stdout max buffer or manually truncate outputs before adding to snapshot.
- Git failure never throws from refresh; it returns `errors`.

Snippet collection:

- Only read files under repo root.
- Only include raw content when `CONVERSATION_CONTEXT_INCLUDE_SMALL_TARGET_FILE=true` and file size <= `CONVERSATION_CONTEXT_SMALL_FILE_CHAR_LIMIT`.
- For large files, include no raw file in v1 unless a bounded git hunk exists.
- Prefer git hunk over full file when both exist and hunk is non-empty.

## Token Budget

Default budget for StateCard: 1200 tokens estimate.

Priority:

```text
P0 keep:
- latest user request
- classification jobType / goal
- continuation marker
- target files
- last error

P1 keep if available:
- previous final report excerpt
- changed file status
- target file raw content when small

P2 prune first:
- assistant prose excerpts
- successful tool outputs
- old run events
- non-target file hunks
```

Token estimate can start as a cheap character estimate:

```text
estimatedTokens = Math.ceil(text.length / 4)
```

Exact tokenizer can be added later, but should not block the first version.

### Budget Enforcement

`renderStateCard(snapshot, options)` builds sections in priority order, then prunes before returning.

Section priority:

```text
0: Task/User/Goal
1: Continuity
2: Files
3: Current state
4: Relevant code
5: Next
```

Pruning order:

1. Drop `Relevant code` if over budget and snippet reason is `target_file_small`.
2. Replace `Relevant code` with hunk-only if hunk exists.
3. Truncate `Continuity` previous action to 160 chars.
4. Truncate `Files.touched` to first 10 paths.
5. Drop `Next` if still over budget.
6. If still over budget, return a minimal card containing only Task/User/Goal/Files.

Every dropped field is recorded in `snapshot.limits.truncatedFields`.

## Integration Points

Keep入口/出口を最小化する。

### Entry 1: idle/post-turn snapshot generation

After Workbench message handling or run completion, call:

```ts
await refreshConversationContextSnapshot({ taskId, runId, reason });
```

This writes/updates the derived cache. Failure must be non-fatal and only emit a debug/run event.

Concrete call sites:

1. `handleWorkbenchIntakeMessage(...)`
   - After user/system intake messages are persisted.
   - Only when `CONVERSATION_CONTEXT_BUILD_ON_IDLE=true`.
   - `reason: 'intake_idle'`.
   - Do not await if this would delay user-visible response; use a safe background helper that catches/logs errors.

2. `startTaskRun(...)` async runtime completion path
   - After `runtime.start(...)` finishes and `updateTaskRun(...)` writes terminal fields.
   - `reason: 'run_finished'`.
   - Awaiting is acceptable after run finalization, but failure remains non-fatal.

3. Optional manual refresh is not exposed through UI in v1.

### Entry 2: run start prompt preparation

Inside `startTaskRun(...)`, after `compiledPromptText` is computed:

```ts
const context = await getLatestConversationContextForTask(taskId);
const stateCardText = context?.stateCardText || '';
```

Then append the StateCard to runtime input through a small wrapper:

```text
<USER_REQUEST>
...
</USER_REQUEST>

<STATE_CARD>
...
</STATE_CARD>
```

Do not replace `compiledPromptText` storage. Store the augmented prompt only in `task_runs.context_snapshot` metadata and runtime input.

Concrete implementation:

```ts
const rawLatestUserMessage = lastUserMessage?.content || compiledPromptText;
const stateCard = await maybeLoadStateCard(taskId);
const runtimeLatestUserMessage = buildPromptWithStateCard({
  latestUserMessage: rawLatestUserMessage,
  stateCardText: stateCard?.stateCardText,
});
```

Then pass:

```ts
compiledPrompt: compiledPromptText,
latestUserMessage: runtimeLatestUserMessage,
contextSnapshot: {
  ...contextSnapshot,
  conversationContext: stateCard
    ? {
        snapshotId: stateCard.id,
        version: stateCard.version,
        tokenEstimate: stateCard.tokenEstimate,
        stateCardIncluded: true,
      }
    : { stateCardIncluded: false },
},
```

Compatibility requirements:

- `await repo.updateTaskCompiledPrompt(taskId, compiledPromptText)` must keep the raw latest user prompt.
- `contextSnapshot.compiledPrompt` must keep the raw latest user prompt.
- Only `latestUserMessage` passed to runtime/Supervisor is augmented.
- When flags are off or no snapshot exists, `latestUserMessage` is exactly the current value.

### Entry 3: Supervisor input only

`runSupervisorLoop(...)` should still receive one `latestUserMessage` string. The string can be augmented by the caller. Supervisor internals do not need to know the snapshot schema.

### Entry 4: Agent Runtime Hook Prompt

`NativeAgentRuntime` currently sends `context.latestUserMessage || context.compiledPrompt` to the `UserPromptSubmit` hook. Use the same augmented `latestUserMessage` as Supervisor so hooks see what the Supervisor sees. Do not add separate hook-only context.

### Non-Fatal Helper

Use a tiny helper local to `nightworkers.service.ts` or exported from `conversation-context`:

```ts
async function safelyRefreshConversationContext(input: RefreshConversationContextInput) {
  if (!isConversationContextEnabled()) return;
  try {
    await refreshConversationContextSnapshot(input);
  } catch (error) {
    logger.warn({ error, taskId: input.taskId, runId: input.runId }, 'conversation context refresh failed');
  }
}
```

Do not throw from this helper.

## Feature Flags

```text
CONVERSATION_CONTEXT_ENABLED=false
CONVERSATION_CONTEXT_STATE_CARD_ENABLED=false
CONVERSATION_CONTEXT_BUILD_ON_IDLE=false
CONVERSATION_CONTEXT_MAX_TOKENS=1200
CONVERSATION_CONTEXT_INCLUDE_SMALL_TARGET_FILE=true
CONVERSATION_CONTEXT_SMALL_FILE_CHAR_LIMIT=6000
```

Rollout starts disabled by default. Tests can enable flags explicitly.

`flags.ts` should mirror the existing local `isEnabled(key, fallback)` behavior used by provider code. Do not create a global feature flag framework in this change.

Flag semantics:

- `CONVERSATION_CONTEXT_ENABLED`: allows repository/build/render functions to run.
- `CONVERSATION_CONTEXT_BUILD_ON_IDLE`: enables refresh after intake/run completion.
- `CONVERSATION_CONTEXT_STATE_CARD_ENABLED`: enables StateCard injection into runtime prompt.
- If `CONVERSATION_CONTEXT_ENABLED=false`, both build and injection are off regardless of other flags.

## Migration Plan

### Phase 0: Guardrails

- Confirm current tests pass before implementation if the worktree is otherwise stable:
  - `pnpm vitest run tests/routes.nightworkers-workbench.test.ts tests/services.agent-runtime.test.ts`
- Add feature flags to `.env.example` with all disabled defaults.
- Do not enable the feature in `.env`.

### Phase 1: Schema

1. Add `conversationContextSnapshots` to `api/db/schema.ts`.
2. Add `drizzle/migrations/0008_conversation_context_snapshots.sql`.
3. Add bootstrap table/index creation in `api/db/bootstrap.ts`.
4. Run:
   - `pnpm typecheck`

### Phase 2: Isolated Domain

1. Add `api/services/conversation-context/types.ts`.
2. Add `token-budget.ts`.
3. Add `render.ts` and `buildPromptWithStateCard(...)`.
4. Add `git.ts` with safe bounded git helpers.
5. Add `repository.ts`.
6. Add `build.ts`.
7. Add `index.ts` exports.
8. Add unit tests.

No existing runtime files are modified in this phase.

### Phase 3: Safe Refresh Wiring

1. Import only `refreshConversationContextSnapshot` and flag helpers in `nightworkers.service.ts`.
2. Add non-fatal refresh after intake persistence behind `CONVERSATION_CONTEXT_BUILD_ON_IDLE`.
3. Add non-fatal refresh after run finish behind `CONVERSATION_CONTEXT_BUILD_ON_IDLE`.
4. Verify flag-off behavior with existing tests.

### Phase 4: StateCard Injection

1. Import `getLatestConversationContextForTask` and `buildPromptWithStateCard` in `nightworkers.service.ts`.
2. In `startTaskRun(...)`, compute:
   - `rawLatestUserMessage`
   - `stateCard`
   - `runtimeLatestUserMessage`
3. Pass only `runtimeLatestUserMessage` to runtime as `latestUserMessage`.
4. Preserve raw `compiledPromptText` everywhere else.
5. Add `contextSnapshot.conversationContext` metadata.

### Phase 5: Targeted Regression

1. Add two-turn fizzbuzz integration test with flags on.
2. Assert StateCard is included in runtime latest user message.
3. Assert `tasks.compiled_prompt` is still raw latest user message.
4. Assert flag-off path is byte-for-byte equivalent for runtime latest user message.

### Phase 6: Documentation

1. Update README with disabled-by-default flags and behavior.
2. Keep this spec as implementation reference; do not add broad architecture prose elsewhere until the feature is enabled by default.

## Tests

Unit:

- builder extracts latest user message.
- builder picks intake job selection from system metadata.
- builder ignores malformed `metadataJson.intakeJobSelection`.
- builder treats previous snapshot as continuity hint, not source of truth.
- path extractor rejects `logs/`, `coverage/`, `node_modules/`, `dist/`, `dist-api/`, `.git/`, absolute outside-root paths, and `..`.
- renderer emits compact StateCard, not JSON.
- renderer respects token budget and prunes P2 fields first.
- `buildPromptWithStateCard(...)` returns raw user message when StateCard is blank.
- small target file is included raw.
- large file is omitted or hunk-only.
- git helper failures return bounded errors and do not throw through refresh.

Service:

- `startTaskRun(...)` remains unchanged when flags are off.
- when flags are on, runtime receives latest request plus StateCard.
- `tasks.compiled_prompt` remains latest raw user prompt, not augmented context.
- snapshot generation failure does not block intake or run start.
- `task_runs.context_snapshot.conversationContext.stateCardIncluded` records true/false without replacing existing fields.
- `NativeAgentRuntime` hook prompt and Supervisor prompt receive the same `latestUserMessage`.

Regression:

- two-turn fizzbuzz flow:
  - first turn creates `fizzbuzz.ts`
  - second turn says `foo 条件も追加してください７で割ってください`
  - StateCard contains prior file/context and `minor_code_edit`
  - runtime Round 1 sees edit continuation context

Suggested commands:

```text
pnpm vitest run tests/services.conversation-context.test.ts
pnpm vitest run tests/services.conversation-context-integration.test.ts
pnpm vitest run tests/routes.nightworkers-workbench.test.ts tests/services.agent-runtime.test.ts
pnpm typecheck
```

## Failure Handling

- Snapshot build failure: log and continue without StateCard.
- Git command failure: omit git-derived sections and mark truncated/error in snapshot.
- Missing target file: omit code snippet and keep target path if known.
- Snapshot schema version mismatch: ignore old snapshot and rebuild.
- StateCard over budget: prune by priority, never fail the run.
- Invalid JSON in old snapshot: ignore old snapshot, rebuild from source of truth.
- DB write failure during idle refresh: log only.
- DB read failure during run start injection: log and continue with raw latest user message.
- File read failure for target snippet: omit snippet and record truncated/error field.

## Review Checklist

Before implementation is considered ready:

- Feature flags default off in code and `.env.example`.
- No Supervisor prompt, skill reference, llm-provider, or schema-first contract changes.
- `tasks.compiled_prompt` stores raw prompt only.
- Runtime receives augmented `latestUserMessage` only when both context flags are enabled and a StateCard exists.
- StateCard is text, not JSON.
- Snapshot JSON is stored as derived cache and can be ignored/rebuilt.
- All broad search/log ingestion paths are absent from builder.
- Git/file output is bounded before snapshot/render.
- Existing tests pass with flags off.
- New targeted tests pass with flags on.
- Rollback is environment-only.

## Later LLM Summary Extension

Add only after deterministic StateCard is stable.

Trigger:

```text
if recent natural-language history exceeds threshold
or deterministic snapshot cannot fit within budget
or session turn count exceeds threshold
```

LLM summary output must be stored separately:

```text
conversation_context_summaries
- id
- task_id
- source_snapshot_id
- summary_json
- summary_text
- model
- token_usage_json
```

The LLM summary is advisory context only. It must not replace DB/event/git truth.

## Rollback

Set:

```text
CONVERSATION_CONTEXT_ENABLED=false
CONVERSATION_CONTEXT_STATE_CARD_ENABLED=false
CONVERSATION_CONTEXT_BUILD_ON_IDLE=false
```

With flags off, existing `compiledPromptText`, `RuntimePromptSnapshot`, Supervisor Round 1 / Round 2, provider calls, and skill routing continue on the current path.
