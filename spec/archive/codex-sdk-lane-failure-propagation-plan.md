# Codex SDK Lane Failure Propagation Plan

## Purpose

Fix Codex SDK lane failure reporting so that recovered tool failures, terminal provider failures, and non-zero Codex exec exits are not collapsed into one misleading final error.

This plan targets two concrete issues observed in run `08afc31f-4646-4b78-94ea-03a1ebdb3452`:

- A recovered `apply_patch verification failed` stderr was surfaced as the final run failure.
- The run ended as `failed` while Todo seq 3 remained `running` and later Todos remained `pending`.

## Confirmed Baseline

Observed run:

- Run id: `08afc31f-4646-4b78-94ea-03a1ebdb3452`
- Task id: `aabb580f-dc8d-41c8-8d66-7de1655231c2`
- Repo: `/Users/y.noguchi/Code/todolist`
- Runtime: `codex-agent`
- DB: `/Users/y.noguchi/Code/nightWorkers/sqlite.db`

Observed facts:

- `apply_patch verification failed` occurred at `2026-06-29T13:26:53Z`.
- After that, Codex re-read `web/src/styles.css` and successfully applied smaller CSS patches.
- `activity_events` includes later `file.diff` completed events for `web/src/styles.css`.
- The final verification-style inspection command completed with exit code `0`.
- `task_runs.log_content` later includes `Selected model is at capacity. Please try a different model.`
- `task_runs.status` is `failed`.
- `task_runs.summary` and `final_report` show `Codex Exec exited with code 1... apply_patch verification failed...`.
- `task_run_todos` left seq 3 as `running`.

Implementation evidence:

- `@openai/codex-sdk/dist/index.js` throws after stdout is drained when child exit code is non-zero, using the entire stderr buffer in the thrown error.
- `api/services/agent-runtime/CodexAgentRuntime.ts` catches that thrown error and directly turns it into `Codex Agent Runtime failed: ${message}`.
- `CodexAgentRuntime` records mapped `runtime_error` events in `logs`, but the catch path can still make the child process stderr dominate the final summary.
- Failed `AgentRuntimeResult` closeout is finalized in `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`, not only inside the runtime adapter.
- The existing orchestration closeout only auto-closes open Todos for `needs_human`, cancelled runs, and thrown orchestration crashes. A normal `runtimeResult.terminalState === 'failed'` can therefore leave a running Todo open.
- `AgentRuntimeEvent` does not currently include custom `run.*` runtime event names. Runtime diagnostics should use existing `runtime_warning` / `runtime_error` events with structured payload fields unless a broader event-schema migration is intentionally added later.

## Scope

In scope:

- Codex SDK lane final failure classification.
- Summary/final report source selection.
- Recovered tool failure diagnostics.
- Todo state consistency on terminal failure.
- Focused tests for the above behavior.

Out of scope:

- Preventing provider capacity errors themselves.
- Preventing all `apply_patch` verification failures.
- Reworking the whole runtime event model.
- UI redesign.
- Native API runner behavior unless a shared helper is already the narrowest change.

## Target Behavior

For a run with both a recovered tool failure and a later provider failure:

- Final summary should identify the terminal provider failure.
- Recovered tool failures should appear only as diagnostics or warnings.
- Old stderr should not become the primary failure reason.
- Current running Todo should not remain `running` after the run is marked terminal `failed`.

Example desired final summary:

```text
Codex Agent Runtime failed: provider_capacity: Selected model is at capacity. Please try a different model.
```

Example desired diagnostics:

```text
Recovered tool failure: apply_patch verification failed in web/src/styles.css.
Codex exec exited with code 1; stderr retained in diagnostics.
```

## Implementation Plan

### 1. Add runtime failure state tracking

File:

- `api/services/agent-runtime/CodexAgentRuntime.ts`

Add internal state inside `start()`:

- `lastRuntimeError`
- `lastTurnFailure`
- `execExitError`
- `toolFailureDiagnostics`
- `recoveredToolFailureDiagnostics`

Rules:

- When a mapped event has `type === 'runtime_error'`, store it as the current terminal candidate.
- Do not rely on catch error text as the primary failure reason if a mapped terminal error exists.
- Keep child-process non-zero exit details as diagnostics unless no better terminal error exists.

### 2. Classify Codex exec non-zero errors

Add a small helper near the bottom of `CodexAgentRuntime.ts`:

- `parseCodexExecExitError(message: string)`
- `classifyTerminalRuntimeError(message: string)`
- `buildCodexFailureReport(input)`

Initial classifications:

- `provider_capacity` when message contains `Selected model is at capacity`
- `codex_exec_nonzero` when message starts with `Codex Exec exited with`
- `unknown_runtime_error` fallback

Do not parse ANSI-colored stderr into the primary summary unless it is the only available terminal evidence.

### 3. Detect recovered apply_patch failures

Track failed tool diagnostics and later file-change evidence.

Minimum viable detection:

- If stderr contains `apply_patch verification failed`
- And Codex events after that failure include `file_change completed`
- And the changed file path mentioned in the stderr is included in a later completed file change
- Then classify the apply_patch failure as recovered

The recovered failure should:

- Be included in `contractWarnings` or diagnostics.
- Not set `terminalState=failed` by itself.
- Not overwrite provider failure summaries.

Implementation guardrails:

- Do not classify a tool failure as recovered from file changes that occurred before the failing stderr evidence.
- If the stderr does not expose a usable file path, keep the failure as exec diagnostics and avoid claiming recovery.
- The current SDK exposes the failed `apply_patch` evidence in the final non-zero exec error rather than as a first-class tool event, so the recovery check must compare stderr details against already observed later `file_change completed` events from the stream.

### 4. Fix catch-path final report selection

Current catch path builds:

```ts
summary: `Codex Agent Runtime failed: ${message}`
```

Change it to:

- Prefer `lastRuntimeError.message` when available.
- Attach `execExitError` and recovered tool failures to `logContent`.
- Make `summary` concise and terminal-cause specific.
- Keep raw child stderr in diagnostics, not in user-facing summary.

Expected precedence:

1. `lastRuntimeError` / `turn.failed`
2. unrecovered tool failure
3. Codex exec non-zero without structured terminal error
4. unknown runtime error

### 5. Emit explicit diagnostic events

Use existing `runtime_warning` / `runtime_error` event types with structured payload fields:

- `reason`
- `terminalReason`
- `diagnosticKind`
- `recovered`
- `toolName`
- `filePath`

Do not introduce new `run.*` event kinds in this change. That would widen the change into event schema, canonicalization, timeline rendering, and persistence compatibility work.

### 6. Align Todo state on terminal failure

File:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

Use the narrowest existing service path that finalizes `task_runs` after `AgentRuntimeResult`.

Current boundary:

- `CodexAgentRuntime` returns `AgentRuntimeResult`.
- `nightworkers.run-orchestration.service.ts` maps that result to the persisted `task_runs.status`.
- Existing helper `closeOpenTodosForFailedRun` already closes running Todos as `failed` and pending Todos as `skipped`, but it is only used in the orchestration crash catch path.

For Codex terminal failure:

- If a current Todo is `running`, transition it to a terminal non-running state.
- Recommended status: `blocked` when the terminal reason is provider/runtime availability, such as `provider_capacity`.
- Use `failed` only for unrecovered implementation/tool failures.
- Set `status_reason` to a stable machine-readable value:
  - `provider_capacity`
  - `codex_exec_nonzero`
  - `unrecovered_tool_failure`
  - `unknown_runtime_error`

Do not mark later pending Todos complete.

Minimum implementation for this change:

- Reuse or lightly generalize the existing failed-run Todo closeout helper in the normal `outcome.status === 'failed'` path.
- Keep later `pending` Todos as non-complete terminal states such as `skipped`; do not mark them `passed` or `completed`.
- If provider-capacity-specific `blocked` semantics would require widening Todo status policy, keep the persisted Todo transition aligned with existing statuses and store the terminal classification in `status_reason` / completion gate evidence.

### 7. Add focused tests

File:

- `tests/services.codex-agent-runtime.test.ts`

Required test cases:

1. `turn.failed` plus old stderr:
   - Fake stream yields a recovered `file_change completed`.
   - Fake executor throws `Codex Exec exited with code 1...apply_patch verification failed...`.
   - A prior mapped runtime error says `Selected model is at capacity`.
   - Expect final summary to contain `Selected model is at capacity`.
   - Expect summary not to contain `apply_patch verification failed`.

2. Recovered `apply_patch` diagnostic:
   - Fake events include a failed apply_patch stderr and later completed file change for the same file.
   - Expect a recovered diagnostic/warning.
   - Expect terminal reason not to be `unrecovered_tool_failure`.

3. Non-zero exec without structured runtime error:
   - No `turn.failed`.
   - Executor exits non-zero with stderr.
   - Expect terminal reason `codex_exec_nonzero`.
   - Expect stderr retained in log diagnostics.

4. Unrecovered tool failure:
   - apply_patch failure appears.
   - No later matching file change.
   - Expect terminal reason `unrecovered_tool_failure` if the run fails.

5. Todo consistency:
   - Simulate terminal failure while current Todo is running.
   - Expect current Todo is no longer `running`.
   - Expect `status_reason` matches terminal classification.

Todo consistency belongs in an orchestration/service test, not only in `tests/services.codex-agent-runtime.test.ts`, because `CodexAgentRuntime` does not persist Todo state.

## Verification Commands

Focused:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts
bunx vitest run tests/nightworkers-service/services-nightworkers-02.test.ts
bunx biome check api/services/agent-runtime/CodexAgentRuntime.ts tests/services.codex-agent-runtime.test.ts
git diff --check
```

Final:

```bash
bun run verify
```

## Acceptance Criteria

- The same observed scenario no longer reports `apply_patch verification failed` as the primary final failure.
- Provider capacity is shown as the terminal failure when it is the latest structured terminal error.
- Recovered tool failures remain visible as diagnostics.
- `task_runs.status=failed` does not leave a current Todo in `running`.
- Existing successful Codex runtime tests continue to pass.
- Native/local runner behavior is unchanged.

## Residual Risk

This does not prevent model capacity failures. It makes them correctly visible and keeps run/Todo state consistent.

If the SDK throws before yielding a structured `turn.failed` or `error` event, NightWorkers can only classify the result as `codex_exec_nonzero`. Even then, the summary should not be polluted by stale stderr details.

## Notes For Implementation

- Keep this as a focused runtime correctness fix.
- Do not add broad retry behavior in the same change.
- Do not update persisted historical rows as part of the implementation unless explicitly requested.
- If retry policy is added later, it should be a separate plan with rate-limit and idempotency controls.
