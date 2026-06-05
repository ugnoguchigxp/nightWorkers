# LLM Token Usage Observability Plan

## Goal

NightWorkers が LLM provider へ送った入力 token と、provider から受け取った出力 token を task 単位で計測・永続化し、Workbench のチャット欄最上部に `i:xxx / o:xxx` として表示する。

StateCard は「LLM 入力の一部」として扱う。provider が返す input usage は総量として保存し、StateCard / user request / system prompt の内訳はこのシステムが構築した prompt text から推定して保存する。

## Review Findings

現状の確認結果:

- `api/services/supervisor/llm-provider/codex.ts` は `turn.completed` で `usage` を取得している。
- `api/services/supervisor/llm-provider/providers.ts` は Codex usage を `providerDebug.usage` に入れるだけで、永続化や task aggregate には使っていない。
- `api/services/supervisor/llm-provider/index.ts` は request / response を `logs/llm-trace.jsonl` に残すが、文字数・bytes・hash が中心で token usage table はない。
- OpenAI / Azure / Bedrock provider は response body に usage があっても共通の戻り値として返していない。
- `conversation_context_snapshots.token_estimate` は StateCard 全体の概算で、LLM call usage の内訳としては保存されていない。
- `task_runs.context_snapshot.conversationContext` は StateCard inclusion を持つが、チャット上部の usage 表示に使える aggregate API はない。
- UI の表示位置は `src/modules/nightworkers/components/ThreadWorkspace.tsx` の header が最小変更で適切。

結論:

- audit log / trace の後追い復元では不十分。LLM call boundary で usage record を作る。
- provider 実測値とシステム推定値を混ぜるため、`usage_mode` と内訳 source を必ず保存する。
- StateCard は provider に渡る user prompt 内の部分入力なので、総 input と別に `state_card_tokens` を保存する。

## Non-Goals

- LLM 内部で消費された非公開 token を推測しない。
- Supervisor の workflow / routing 判断を変えない。
- `llm-provider` に用途別 SystemContext や実行判断を追加しない。
- StateCard schema を Supervisor に認識させない。
- 過去の `logs/llm-trace.jsonl` から完全 backfill しない。
- 初期実装で provider 別の課金額計算を入れない。

## Measurement Contract

### Definitions

```ts
type LlmUsageMode = 'measured' | 'estimated' | 'mixed' | 'unavailable';

type NormalizedLlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  mode: LlmUsageMode;
  rawUsage?: unknown;
};
```

Rules:

- Provider が usage を返した場合は `mode='measured'`。
- Provider usage がない場合は `estimateTokens(systemPrompt + userPrompt)` と response text から推定し、`mode='estimated'`。
- input は実測、StateCard 内訳は推定のように混在する aggregate は `mode='mixed'`。
- `reasoningOutputTokens` は provider が返す場合だけ保存する。返さない provider では `null`。
- `cachedInputTokens` も provider が返す場合だけ保存する。返さない provider では `null`。

### Provider Mapping

| Provider | Current call path | Usage source | Initial behavior |
| --- | --- | --- | --- |
| Codex | `readCodexStreamedTurn(...)` | `turn.completed.usage` | measured |
| OpenAI non-stream | `/chat/completions` JSON | `responseData.usage` | measured |
| OpenAI stream | SSE chunks | usage chunk if present, otherwise estimate | measured or estimated |
| Azure OpenAI | `/chat/completions` JSON | `responseData.usage` | measured |
| Bedrock | `ConverseCommand` response | `res.usage` if SDK response exposes it | measured or estimated |
| fixture / test | fixture output | text estimate | estimated in tests only |

OpenAI streaming must request usage when supported by adding `stream_options: { include_usage: true }` to the chat completion body. If no usage chunk arrives, keep the response usable and save estimated usage.

## Data Model

Add `llm_usage_records`.

```text
llm_usage_records
- id text primary key
- created_at integer not null
- updated_at integer not null
- task_id text not null references tasks(id) on delete cascade
- run_id text null references task_runs(id) on delete set null
- call_id text not null
- provider text not null
- model text null
- label text not null
- round integer null
- usage_mode text not null
- input_tokens integer null
- output_tokens integer null
- cached_input_tokens integer null
- reasoning_output_tokens integer null
- total_tokens integer null
- system_prompt_tokens integer null
- user_prompt_tokens integer null
- state_card_tokens integer null
- response_tokens_estimate integer null
- duration_ms integer not null
- raw_usage_json text null
- metadata_json text null
```

Indexes:

```text
llm_usage_records_task_created_idx(task_id, created_at)
llm_usage_records_run_created_idx(run_id, created_at)
llm_usage_records_call_id_uidx(call_id)
llm_usage_records_provider_created_idx(provider, created_at)
```

Schema files:

- Add table to `api/db/schema.ts`.
- Add `CREATE TABLE IF NOT EXISTS` and indexes to `api/db/bootstrap.ts`.
- Add `drizzle/migrations/0009_llm_usage_records.sql`.

Do not store raw prompts in this table. Store prompt hashes / lengths in `metadata_json` if needed.

## StateCard Shape

Keep current rendered StateCard text as prompt input, but add explicit usage metadata at runtime.

`buildPromptWithStateCard(...)` remains pure and can be extended to return parts through a new helper instead of changing existing callers blindly.

Add:

```ts
export type PromptWithStateCardParts = {
  latestUserMessage: string;
  stateCardText: string | null;
  promptText: string;
  estimates: {
    latestUserMessageTokens: number;
    stateCardTokens: number;
    promptTokens: number;
  };
};

export function buildPromptWithStateCardParts(input: {
  latestUserMessage: string;
  stateCardText?: string | null;
}): PromptWithStateCardParts;
```

Keep:

```ts
export function buildPromptWithStateCard(input: {
  latestUserMessage: string;
  stateCardText?: string | null;
}): string;
```

`buildPromptWithStateCard(...)` should delegate to `buildPromptWithStateCardParts(...).promptText`.

Extend `RuntimePromptSnapshot.conversationContext`:

```ts
conversationContext: {
  snapshotId: string;
  version: number;
  tokenEstimate: number;
  stateCardIncluded: true;
  stateCardText: string;
  snapshotJson: unknown;
  usage: {
    latestUserMessageTokens: number;
    stateCardTokens: number;
    runtimeUserPromptTokens: number;
  };
}
```

If no StateCard is included:

```ts
conversationContext: {
  stateCardIncluded: false;
  usage: {
    latestUserMessageTokens: number;
    stateCardTokens: 0;
    runtimeUserPromptTokens: number;
  };
}
```

This makes StateCard observable without making Supervisor parse or understand it.

## Backend Flow

### 1. Add usage context to LLM options

Modify `api/services/supervisor/llm-provider/types.ts`:

```ts
export type CallSupervisorOptions = {
  tolerateSchemaFailure?: boolean;
  round?: 1 | 2;
  schemaFirst?: boolean;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
  timeoutMs?: number;
  workingDirectory?: string;
  taskId?: string;
  runId?: string | null;
  stateCardTokenEstimate?: number | null;
  promptPartTokenEstimates?: {
    systemPromptTokens?: number;
    userPromptTokens?: number;
    latestUserMessageTokens?: number;
    stateCardTokens?: number;
  };
};
```

### 2. Return structured provider result

Change provider boundary from string-only to structured result.

```ts
export type ProviderCallResult = {
  content: string;
  usage: NormalizedLlmUsage;
  model?: string | null;
  providerDebug?: Record<string, unknown>;
};
```

`callProvider(...)` returns `ProviderCallResult`.

`callRawJsonLLM(...)` still returns `rawContent: string` to callers, but after provider completion it persists usage when `options.taskId` exists.

### 3. Persist at common boundary

Add `api/services/llm-usage/`:

```text
api/services/llm-usage/
  index.ts
  normalize.ts
  repository.ts
  summary.ts
```

Responsibilities:

- `normalizeProviderUsage(provider, rawUsage, fallback)` maps provider-specific usage.
- `recordLlmUsage(input)` inserts `llm_usage_records`.
- `summarizeTaskLlmUsage(taskId)` aggregates for UI.

The LLM provider should not import NightWorkers service. It may import this small usage service, or `callRawJsonLLM(...)` can call a repository helper directly after provider returns. Prefer the usage service to keep normalization testable.

### 4. Wire task/run IDs

Runtime supervisor calls:

- In `api/services/supervisor/supervisor-loop.ts`, pass `taskId: task.id`, `runId`, and prompt part estimates to both Round 1 and Round 2 calls.
- Round 1 user input can include StateCard. Use prompt part estimates from runtime input context when available.
- Round 2 user prompt includes tool results and loaded skill summaries; StateCard estimate is normally `0` there unless the StateCard is embedded in the serialized user prompt.

Workbench intake calls:

- In `api/modules/nightworkers/nightworkers.service.ts`, pass `taskId`, `runId: null` for intake Round 1.
- Blueprint generation calls should pass `taskId`, `runId: null`, `label` / `schemaName` as already available.

Settings smoke test:

- Do not persist usage. It has no task and would pollute task totals.

### 5. Activity / realtime event

After `llm_usage_records` insert, append an activity event:

```text
kind: llm.usage
source: provider
status: completed
visibility: debug
payload_json:
  usageRecordId
  provider
  model
  label
  round
  usageMode
  inputTokens
  outputTokens
  stateCardTokens
```

Add `llm.usage` to `KNOWN_ACTIVITY_KINDS`.

The activity event gives realtime updates. The summary API gives page reload consistency.

## API Contract

Add route:

```text
GET /api/tasks/:id/llm-usage
```

Response:

```ts
type TaskLlmUsageSummary = {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  stateCardTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageMode: 'measured' | 'estimated' | 'mixed' | 'unavailable';
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
  lastUpdatedAt: string | null;
};
```

Aggregation rules:

- Sum nullable token fields as `0`.
- `totalTokens` uses stored `total_tokens` when present; otherwise `input + output`.
- `usageMode='measured'` only when every counted call is measured.
- `usageMode='estimated'` only when every counted call is estimated.
- `usageMode='mixed'` when both exist.
- `usageMode='unavailable'` when `callCount=0`.

Add schema to `shared/schemas/nightworkers.schema.ts`.

## Frontend Contract

Add type:

```ts
export type TaskLlmUsageSummary = {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  stateCardTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageMode: 'measured' | 'estimated' | 'mixed' | 'unavailable';
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
  lastUpdatedAt?: unknown | null;
};
```

`useNightWorkersWorkspace.ts`:

- Fetch `GET /api/tasks/:id/llm-usage` as `llmUsageSummary`.
- Invalidate query on `activity_event_created` where `event.kind === 'llm.usage'`.
- Also invalidate on `task_message_created` and `task_run_updated` as a fallback.

`ThreadWorkspace.tsx`:

- Add prop `llmUsageSummary`.
- Render in header near session title:

```text
i:12.3k / o:678
```

Tooltip/title:

```text
input 12,345 / output 678 / StateCard 1,204 / mode mixed
```

Formatting:

- `0..999`: raw integer.
- `1000..999999`: one decimal `k`, trim `.0`.
- `>=1000000`: one decimal `m`, trim `.0`.
- If no calls: `i:0 / o:0`.

No large card, no extra explanatory in-app text.

## Implementation Phases

### Phase 1: Schema and repository

Files:

- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- `drizzle/migrations/0009_llm_usage_records.sql`
- `api/services/llm-usage/repository.ts`
- `api/services/llm-usage/summary.ts`

Steps:

1. Add `llmUsageRecords` table.
2. Add bootstrap table and indexes.
3. Add migration.
4. Add insert helper.
5. Add task summary helper.

Tests:

- Add route/repository test that `ensureNightWorkersSchema()` creates the table.
- Add summary test for measured-only, estimated-only, mixed, and empty task.

### Phase 2: Provider usage normalization

Files:

- `api/services/supervisor/llm-provider/types.ts`
- `api/services/supervisor/llm-provider/providers.ts`
- `api/services/supervisor/llm-provider/openai.ts`
- `api/services/supervisor/llm-provider/codex.ts`
- `api/services/supervisor/llm-provider/index.ts`
- `api/services/llm-usage/normalize.ts`

Steps:

1. Add `NormalizedLlmUsage` and `ProviderCallResult`.
2. Map Codex usage.
3. Map OpenAI/Azure `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`.
4. Parse OpenAI streaming usage chunk when present.
5. Map Bedrock usage if response exposes it.
6. Add fallback estimate using `estimateTokens`.
7. Persist usage in `callRawJsonLLM(...)` after non-empty response.

Tests:

- Existing schema-first tests still pass.
- Add OpenAI non-stream usage test.
- Add OpenAI stream usage chunk test.
- Add Codex normalization unit test if direct SDK stream mocking is too heavy.
- Add fallback estimated usage test for fixture provider.

### Phase 3: StateCard prompt part estimates

Files:

- `api/services/conversation-context/render.ts`
- `api/services/conversation-context/types.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/agent-runtime/types.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `tests/services.conversation-context.test.ts`
- `tests/services.nightworkers-service.test.ts`

Steps:

1. Add `buildPromptWithStateCardParts(...)`.
2. Keep existing `buildPromptWithStateCard(...)` compatibility.
3. Store prompt part estimates in `RuntimePromptSnapshot.conversationContext.usage`.
4. Pass estimates into runtime supervisor calls.
5. Ensure Round 1 usage can attribute StateCard tokens when included.

Tests:

- Existing StateCard prompt wrapper test remains valid.
- New test asserts `stateCardTokens > 0` when card exists.
- New service test asserts runtime context snapshot includes usage details.

### Phase 4: API and activity event

Files:

- `shared/schemas/nightworkers.schema.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`

Steps:

1. Add `taskLlmUsageSummarySchema`.
2. Add `GET /api/tasks/:id/llm-usage`.
3. Add service wrapper that checks task existence.
4. Add `llm.usage` to known activity kinds.
5. Publish usage activity after usage record insert.

Tests:

- Route returns `404` for missing task.
- Route returns empty summary for no calls.
- Route returns aggregate after inserted usage rows.

### Phase 5: Frontend display

Files:

- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `tests/nightworkers.workbench-selectors.test.ts` or focused component test if available

Steps:

1. Add `TaskLlmUsageSummary` type.
2. Fetch active task usage summary.
3. Invalidate on `llm.usage` activity event.
4. Pass summary into `ThreadWorkspace`.
5. Render `i:xxx / o:xxx` in the chat header.
6. Add compact formatter.

Tests:

- Formatter test for `999`, `1.2k`, `1m`.
- Header render test if component test harness exists.
- Manual browser check after implementation if dev server is used.

### Phase 6: Documentation and cleanup

Files:

- `README.md`
- `spec/docs/architecture.md`
- This plan

Steps:

1. Document the new endpoint.
2. Document usage modes and StateCard attribution.
3. Update this plan status or replace with implementation notes after code lands.

## Verification Commands

Run after implementation:

```bash
pnpm typecheck
pnpm test:supervisor-regression
pnpm test tests/services.conversation-context.test.ts tests/services.nightworkers-service.test.ts tests/routes.nightworkers-workbench.test.ts tests/routes.nightworkers.test.ts
pnpm verify
```

If frontend display changes are substantial, also run:

```bash
pnpm dev
```

Then inspect the active Workbench session in the browser and confirm the header shows:

```text
i:<input> / o:<output>
```

## Rollback

No feature flag is required for persistence. If the UI display causes trouble, hide only the frontend header display while keeping `llm_usage_records`.

Database rollback for local development:

```sql
DROP TABLE llm_usage_records;
```

Do not remove usage capture from provider boundary as a UI rollback; observability data should continue to be recorded.

## Implementation Checklist

- [ ] Add `llm_usage_records` schema, bootstrap, migration.
- [ ] Add usage repository and task summary helper.
- [ ] Normalize Codex / OpenAI / Azure / Bedrock / fixture usage.
- [ ] Persist usage from `callRawJsonLLM(...)`.
- [ ] Add `buildPromptWithStateCardParts(...)`.
- [ ] Add StateCard usage metadata to runtime context snapshot.
- [ ] Pass `taskId`, `runId`, and prompt part estimates into supervisor LLM calls.
- [ ] Add `GET /api/tasks/:id/llm-usage`.
- [ ] Emit `llm.usage` activity event.
- [ ] Fetch and display `i:xxx / o:xxx` in `ThreadWorkspace`.
- [ ] Add targeted tests.
- [ ] Update architecture docs after implementation.
