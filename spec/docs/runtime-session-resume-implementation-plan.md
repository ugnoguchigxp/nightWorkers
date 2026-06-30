# Runtime Session Resume Implementation Plan

## Purpose

NightWorkers の同一 TaskId で会話が途切れないように、次の 2 系統の resume を実装する。

1. Codex SDK lane: Codex が返す `thread_id` を保存し、後続 run で `resumeThread()` に渡す。
2. native/API runner lane: provider 側 session id ではなく、NightWorkers DB に保存済みの completed turn history を後続 run の初期 history として復元する。

この計画は実装順序、保存境界、復元条件、検証ゲートを固定し、途中で runtime / provider / UI 全体の再設計へ広げないためのもの。

## Confirmed Baseline

### Codex SDK Lane

- `@openai/codex-sdk` version is `0.135.0`.
- SDK has `Codex.resumeThread(id, options)`.
- `thread.started` emits `thread_id`, and the SDK comment says it can be used to resume the thread later.
- NightWorkers currently creates Codex threads through `codex.startThread(threadOptions)`.
- `thread_id` is mapped into runtime events as `providerThreadId`.
- `providerThreadId` is persisted as run event payload data, but is not stored as first-class resume state.
- Later runs do not read `providerThreadId`; they start a new Codex thread.

Relevant files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-client.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`

### Native/API Runner Lane

- OpenAI and Azure native tool turns call Chat Completions style endpoints with full `messages`.
- There is no provider-side thread/session id equivalent to Codex `thread_id` in the current implementation.
- `NativeApiSessionStore` persists `native_api_turns.history_json`.
- Current run startup builds initial native API history from fresh system prompt, latest user message, current Todo, and role working context.
- Previous run completed turn history is not loaded into the next run.

Relevant files:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-session-store.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/structured-llm/providers.ts`

## Scope

In scope:

- Persisting Codex provider thread ids as runtime resume state.
- Resuming Codex SDK threads on later runs when safe.
- Falling back to new Codex threads when resume state is missing, invalid, or rejected by the SDK.
- Restoring native/API runner conversation state from the last completed `native_api_turns.history_json`.
- Adding runtime events that show whether a run resumed, started fresh, or fell back.
- Focused unit tests and integration-level service tests for the resume paths.

Out of scope:

- Switching native/API runner from Chat Completions to Responses API.
- Adding OpenAI `previous_response_id` support.
- Resuming across different NightWorkers tasks.
- Reworking Plan Mode, Specification Workspace, or Todo runtime semantics.
- UI redesign beyond exposing existing run events.
- Changing provider routing policy except where route compatibility is needed for resume safety.

## Target Behavior

### Codex SDK Lane

When a later run starts for the same task, repository, runtime lane, and compatible execution context:

- NightWorkers loads the latest usable Codex resume state.
- It calls `codex.resumeThread(providerThreadId, threadOptions)` instead of `codex.startThread(threadOptions)`.
- The run still sends a fresh NightWorkers Runtime Contract prompt for the new turn.
- A run event records `resumeState: reused`.

If resume fails:

- NightWorkers records `resumeState: fallback_started_fresh`.
- It starts a fresh Codex thread.
- The new `thread_id` replaces or supersedes the stale resume state.
- The user-facing final answer should not pretend the original Codex thread continued.

### Native/API Runner Lane

When a later native/API run starts for the same task and compatible route:

- NightWorkers loads the latest completed native API turn from the previous run.
- It sanitizes that turn's `history_json`.
- It builds the new run history as:

```text
fresh system prompt
sanitized previous provider exchange
fresh latest user request
fresh current Todo context
fresh role working context / StateCard context
```

If no safe completed history exists:

- The run starts from current behavior.
- A run event records `resumeState: unavailable`.

## Data Model

Add a small runtime session state store.

Recommended table:

```text
runtime_session_states
  id text primary key
  task_id text not null references tasks(id)
  repository_id text references repositories(id)
  run_id text references task_runs(id)
  runtime_lane text not null
  provider text not null
  provider_session_id text
  execution_mode text
  model text
  status text not null
  last_seen_at integer not null
  metadata_json text
  created_at integer not null
  updated_at integer not null
```

Status values:

- `active`
- `superseded`
- `invalid`
- `resume_failed`

Initial unique lookup should be logical rather than hard unique:

- latest `active`
- same `task_id`
- same `repository_id`
- same `runtime_lane`
- same `provider`
- same `execution_mode` for the first implementation slice

Reason for keeping `execution_mode` strict initially:

- Planning, implementation, review, runtime_debug, and general_answer carry different runtime contracts.
- Cross-mode resume may be useful later, but it can leak stale role instructions into a new mode.
- The first implementation should preserve safety over broad continuity.

## Implementation Plan

### Phase 0. Baseline and Failing Tests

Add focused tests that describe current missing behavior before implementation.

Files:

- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.native-api-session-store.test.ts`
- `tests/services.native-api-runner.test.ts`
- potentially `tests/nightworkers-service/services-nightworkers-02.test.ts`

Codex tests:

- A first Codex run receives `thread.started` with `thread_id`.
- That id is persisted as resume state.
- A second compatible Codex run uses `resumeThread(threadId, options)`.
- If `resumeThread` throws, the run falls back to `startThread`.

Native/API tests:

- A completed native API turn history can be listed as latest resumable history for a task.
- A new native/API run can start with sanitized prior history plus fresh current prompt.
- Running or failed incomplete turns are not used as resume source.
- Tool messages without matching assistant tool calls are rejected from resume history.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-session-store.test.ts tests/services.native-api-runner.test.ts
```

Expected before implementation:

- New resume tests fail for missing behavior.
- Existing unrelated tests should remain unaffected.

### Phase 1. Runtime Session State Store

Add a small backend service for runtime resume state.

Recommended file:

- `api/services/agent-runtime/runtime-session-state.ts`

Responsibilities:

- Ensure or migrate `runtime_session_states`.
- `upsertRuntimeSessionState(input)`.
- `getLatestRuntimeSessionStateForTask(input)`.
- `markRuntimeSessionStateInvalid(input)`.
- `markRuntimeSessionStateSuperseded(input)`.

Avoid:

- Reading raw `task_events.payload_json` as the primary lookup path.
- Embedding resume state only in `task_runs.context_snapshot`.
- Making UI state the source of truth.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-session-store.test.ts
```

### Phase 2. Codex SDK Resume

Update Codex runtime creation to accept optional resume state.

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-client.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

Design:

1. Load latest compatible Codex resume state before runtime start.
2. Put resume metadata into `AgentRunContext.contextSnapshot.runtimeResume`.
3. In `createCodexRuntimeThread`, choose:

```ts
resumeThread(threadId, threadOptions)
```

when a valid thread id exists, otherwise:

```ts
startThread(threadOptions)
```

4. When `thread.started` arrives, persist `providerThreadId` through the runtime session state store.
5. Emit structured runtime events:

```text
runtime.resume_state_loaded
runtime.resume_state_reused
runtime.resume_state_missing
runtime.resume_state_failed
runtime.resume_state_superseded
```

Use existing event plumbing if new canonical event types would widen the change too much. In that case use `runtime_warning` / `runtime_started` payload fields first.

Failure policy:

- If `resumeThread` fails before a turn starts, mark old state `resume_failed` and start fresh.
- If resume starts but the provider later fails during normal turn execution, treat it as a runtime failure, not as a resume lookup failure.
- Do not loop between resume and fresh start more than once.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts
```

Expected:

- Compatible second Codex run calls `resumeThread`.
- Fresh run is used when no resume state exists.
- Failed resume marks old state and starts a new thread once.

### Phase 3. Native/API History Resume

Extend `NativeApiSessionStore`.

File:

- `api/services/agent-runtime/native-api-runner/native-api-session-store.ts`

Add:

- `getLatestCompletedTurnForTask(input)`
- `getLatestCompletedTurnForPreviousRun(input)`
- `sanitizeNativeApiResumeHistory(history)`

Sanitization rules:

- Drop previous `system` items.
- Drop stale user items with `source` of `todo`, `runtime`, or `state_card`.
- Preserve prior real user prompts, assistant messages, and completed tool results.
- Validate assistant tool call and tool result pairing.
- Reject histories ending with unmatched assistant tool calls.
- Cap restored history by token or item count if needed.

Update initial history builder.

File:

- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`

Add a new builder path:

```ts
buildInitialNativeApiHistory(context, { resumeHistory })
```

Target order:

1. fresh system prompt
2. sanitized previous provider exchange
3. fresh latest user message
4. fresh current Todo
5. fresh role working context

Gate:

```bash
bunx vitest run tests/services.native-api-session-store.test.ts tests/services.native-api-runner.test.ts
```

Expected:

- Completed previous history is restored.
- Stale Todo and runtime context are not restored.
- Fresh Todo and role context still appear.
- Invalid history falls back to fresh run with a diagnostic event.

### Phase 4. Orchestration Wiring and Observability

Wire resume state into run start.

File:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

Responsibilities:

- Resolve runtime lane and execution mode as it does today.
- Load resume state only after lane and mode are known.
- Attach resume metadata to `runtimeContextSnapshot`.
- Emit run event before provider call:

```text
Resume state loaded: kind=codex_thread | native_api_history | none
```

Add payload fields:

```json
{
  "runtimeResume": {
    "kind": "codex_thread",
    "status": "reused",
    "sourceRunId": "...",
    "providerThreadId": "...",
    "executionMode": "implementation"
  }
}
```

For native/API:

```json
{
  "runtimeResume": {
    "kind": "native_api_history",
    "status": "reused",
    "sourceRunId": "...",
    "sourceTurnId": "...",
    "restoredItemCount": 12
  }
}
```

Avoid making resume invisible. If continuity fails, the timeline should show why.

Gate:

```bash
bunx vitest run tests/nightworkers-service/services-nightworkers-02.test.ts tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
```

### Phase 5. End-to-End Regression and Verify

After focused tests pass:

```bash
bun run typecheck
bun run verify
```

Expected:

- No type regressions.
- No runtime contract regressions.
- Resume state tests pass.
- Existing Codex failure propagation behavior remains intact.
- Existing native/API tool dispatch behavior remains intact.

## Stop Conditions

Stop and revise the plan if any of these are found:

- `resumeThread` cannot read the target `~/.codex/sessions` in the packaged app or worker process.
- Codex SDK resume causes a turn to run against the wrong repository path.
- Cross-mode resume is required for the immediate user workflow but strict same-mode policy blocks it.
- Native/API restored history replays stale tool calls or stale Todo state.
- A provider route change makes prior native/API history unsafe to reuse.

## Rollout Strategy

Recommended rollout order:

1. Ship Codex SDK resume first behind deterministic compatibility checks.
2. Add native/API history resume after Codex tests are stable.
3. Keep fallback-to-fresh behavior enabled from the start.
4. Emit resume diagnostics in every path.
5. Only consider cross-mode resume after same-mode resume has proven stable.

## Open Questions

- Should cross-mode resume be allowed for Codex SDK threads after the first implementation?
- Should the UI show a small continuity badge when a run resumed from prior state?
- Should stale resume states be invalidated after a configurable age?
- Should native/API resume restore only the last completed turn, or compact multiple completed turns?
- Should Codex provider calls in `structured-llm/providers.ts` also use resume state, or remain one-shot supervisor calls?

Initial answers for implementation:

- Cross-mode resume: no.
- UI badge: not in the first implementation.
- Stale age invalidation: yes, but use a conservative default after the core path works.
- Native/API history scope: last completed turn only.
- Structured LLM Codex provider: keep one-shot for now; it is not the coding-agent runtime lane.

## Completion Criteria

The work is complete when:

- Codex SDK lane persists `thread_id` as first-class resume state.
- A compatible later Codex run calls `resumeThread`.
- Codex resume failure falls back to one fresh `startThread` and records the failure.
- Native/API runner restores a sanitized completed history from the previous compatible run.
- Invalid or incomplete native/API histories are rejected safely.
- Run events make resume/fallback decisions visible.
- Focused tests and `bun run verify` pass.
