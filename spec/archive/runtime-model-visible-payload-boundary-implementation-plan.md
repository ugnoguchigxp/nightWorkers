# Runtime Model-visible Payload Boundary Implementation Plan

## Purpose

NightWorkers runtime の token 効率を改善するため、DB / artifact / timeline に保存する full evidence と、LLM に再投入する model-visible payload を分離する。

この計画は `runtime-prompt-history-compaction-improvement-ideas.md` の改善案を実装可能な順序へ落とすもの。Codex の bounded context 原則を主軸にし、OpenHands の condenser taxonomy は設定・将来拡張の参考に留める。

最初の実装では LLM summarizing condenser は作らない。まず、NightWorkers が所有する payload を履歴へ入れる前に deterministic に小さくし、必要な full evidence は artifact / DB から再取得できる形にする。

## Confirmed Baseline

### Existing NightWorkers Behavior

- `run_command` / `run_verification` は stdout / stderr の圧縮機構を持つ。
- ただし `run_command` の default は `compressionMode='off'` で、tool 説明も stdout / stderr を既定で全文返す前提になっている。
- `read_file` は default `compressionMode='auto'` で、大きな file read や repeated read を compact view にできる。
- native/API runner は provider request 前に baseline compaction を行うが、これは履歴が大きくなった後の safety net であり、各 item の model-visible payload を常に bounded にする仕組みではない。
- Codex SDK lane の CLI 実行は NightWorkers MCP `run_command` ではなく Codex native `command_execution` event として観測される。
- Codex SDK event adapter は `command_execution.aggregated_output` と redacted provider event を activity payload に載せる。

Relevant files:

- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/run-verification.ts`
- `api/services/worker-tools/output-compression/command-output.ts`
- `api/services/worker-tools/read-file.ts`
- `api/services/supervisor/prompt-tool-registry.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-session-store.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`

### External Reference Behavior

Codex is the primary reference:

- model-visible context is incremental, not frequently rewritten.
- every injected item must be bounded and have a hard cap.
- large context fragments are represented through typed fragments.
- context compaction has explicit before / after token accounting.
- compaction is not a substitute for bounding individual injected items.

OpenHands is the secondary reference:

- condenser strategies are configurable.
- history truncation / condensation is treated as a runtime subsystem.
- LLM summarization can be useful, but it adds non-determinism and should not be the first NightWorkers slice.

Headroom is the CLI-output reference:

- CLI output savings are split into two mechanisms:
  - command-side shaping before execution, such as scoped `rg`, short `git` formats, and bounded listings.
  - output-side compaction after execution, such as log / search / diff compaction with full-output retrieval.
- RTK-style command rewriting belongs at the wrapper / agent-guidance layer, not inside the proxy or generic output compressor.
- The useful NightWorkers takeaway is not "add RTK", but "teach Supervisor to prefer bounded commands and then compact any large output that remains."
- Savings must be observable by layer: command output original size, model-visible returned size, and whether the reduction came from scoped command guidance or post-output compaction.

## Scope

In scope for this plan:

- Establishing a model-visible payload policy for NightWorkers-owned runtime payloads.
- Making command / verification output compact by default where NightWorkers controls the tool result.
- Adding command guidance so Supervisor prefers scoped, short-output commands before relying on output compaction.
- Compacting Codex SDK `command_execution` activity projection without pretending to control Codex internal thread history.
- Ensuring native/API `tool_result.content` and persisted `modelVisibleOutput` are bounded.
- Keeping full evidence in DB / artifact / provider event refs.
- Adding regression tests that prove important failure information is preserved.
- Adding observability that separates full evidence size from model-visible payload size.

Out of scope for the first implementation pass:

- Adding an LLM summarizing condenser.
- Installing or depending on RTK / lean-ctx / external shell hooks.
- Rewriting commands transparently at shell execution time.
- Rewriting Codex SDK internal thread history.
- Changing provider routing.
- Replacing native/API baseline compaction.
- Redesigning the entire Todo, specification, import, or diff artifact models.
- UI redesign beyond using existing timeline / activity data.

## Implementation Readiness Review

This plan is ready for implementation only if each implementation slice has:

- a concrete file list,
- the exact function or type to add or update,
- a model-visible output shape,
- a focused test command,
- an expected failure mode before the change,
- and an explicit non-goal for that slice.

The first review found three gaps that this plan must address before coding:

- Phase 1 needed an explicit helper API, not only a helper file name.
- Phase 3 needed a clear rule for compacting `providerEvent`, not only `aggregatedOutput`.
- Phase 4 needed concrete native/API call sites, because `modelVisibleOutput` is written from the runner, startup controller, and closeout controller.

The sections below include those implementation details. Do not start implementation from the older high-level bullets alone.

## Target Behavior

### Model-visible Payload Rule

Every NightWorkers-owned payload that can be sent back to a model must fit this shape:

```text
kind
status / exitCode / ok
short summary
selected excerpt or structured highlights
original size
returned size
compression strategy
full evidence reference when omitted
```

Payloads must not rely on "the model probably will not reread this" as the boundary. The boundary is explicit:

- full evidence remains queryable by DB / artifact / provider event.
- model-visible text is capped before it enters runtime history.
- user-facing timeline can show compact text by default and link to full evidence when available.

### Command and Verification Results

For `run_command` and `run_verification`:

- default behavior uses `compressionMode='auto'`.
- large stdout / stderr returns command, exit code, status, important lines, summary lines, head / tail, truncation reason, and full-output artifact ref.
- explicit `compressionMode='off'` remains available for targeted debugging.
- verification commands preserve failed test names, assertion diffs, stack tops, coverage gate failures, and command metadata.
- tool descriptions and Supervisor skill guidance tell the model to prefer bounded commands before executing:
  - use `rg` with path / glob / context limits instead of broad recursive scans.
  - use `git diff --stat`, `git diff --name-only`, or path-scoped `git diff -- <path>` before full diffs.
  - use `git show --stat --oneline` or path-scoped `git show -- <path>` before full patch output.
  - use `list_dir` with `maxEntries` or non-recursive mode before broad `find` / recursive `ls`.
  - use targeted test commands before broad verify when investigating one failure, while still running the required final gate before closeout.
- output compaction remains the safety net; it must not be the only defense against broad commands.

### Codex SDK `command_execution`

For Codex SDK lane:

- NightWorkers does not rewrite Codex's internal thread history.
- activity payload stores a compact `aggregatedOutput` projection for timeline / audit.
- full provider event is either kept behind an existing event ref or compacted with size metadata before being stored in NightWorkers-owned payload.
- final reports still require command, exit code, stdout / stderr evidence where important, but should not force full command output back into subsequent prompts.

### Native/API Runner

For native/API lane:

- `NativeApiToolResult.content` is model-visible and must be capped.
- `NativeApiToolResult.payload` / session-store `resultJson` can retain structured full payload when needed.
- `NativeApiSessionStore.finishToolCall(...).modelVisibleOutput` stores compact text, not full payload by accident.
- baseline compaction remains as the hard-limit safety net.
- context budget debug reports item count and estimated prompt size before and after compaction.

## First Implementation Slice

The first PR should stop after Phase 2 unless the diff is still small. This gives a reviewable slice that changes only NightWorkers-owned worker tool results and the shared cap helper.

First PR scope:

- Add the shared model-visible payload helper.
- Add helper unit tests.
- Make `run_command` default to `compressionMode='auto'`.
- Prove `run_verification` inherits the default.
- Update tool descriptions and Supervisor guidance to describe compact default behavior and bounded command preference.

First PR non-goals:

- No Codex SDK event projection changes.
- No native/API runner history changes.
- No Todo / import / specification / diff compact view changes.
- No DB schema changes.
- No UI changes.

First PR gate:

```bash
bunx vitest run tests/worker-tools/services-worker-tools-05.test.ts tests/worker-tools/services-worker-tools-06.test.ts tests/services.supervisor-skills.test.ts
```

## Implementation Plan

### Phase 0. Baseline and Guard Tests

Add tests that capture the current risk before behavior changes.

Files:

- `tests/worker-tools/services-worker-tools-06.test.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-session-store.test.ts`

Test cases:

- `run_command` with large output compresses by default without passing `compressionMode='auto'`.
- `run_verification` inherits the same default compression.
- `compressionMode='off'` still returns full output for small targeted debugging.
- prompt tool descriptions recommend bounded command forms before broad output-producing commands.
- a large Codex SDK `command_execution.aggregated_output` is compacted in NightWorkers activity payload.
- native/API `tool_result.content` cannot exceed the model-visible cap after dispatch.
- compacted failure output still contains failed test names, assertion diff / error lines, exit code, and command.

Expected before implementation:

- tests for default command compression and Codex SDK projection fail.
- existing explicit `compressionMode='auto'` tests still pass.

Gate:

```bash
bunx vitest run tests/worker-tools/services-worker-tools-06.test.ts tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/services.native-api-session-store.test.ts
```

### Phase 1. Shared Model-visible Payload Policy

Create a small shared helper for bounded model-visible payloads.

Recommended file:

- `api/services/agent-runtime/model-visible-payload.ts`

Recommended tests:

- `tests/services.model-visible-payload.test.ts`

Responsibilities:

- Define default caps in characters, with token-estimate metadata where existing helpers are available.
- Build a `ModelVisiblePayloadSummary` shape:
  - `strategy`
  - `originalChars`
  - `returnedChars`
  - `truncated`
  - `omittedReason`
  - `artifactRef` or `providerEventRef`
  - `contentHash`
- Provide helpers for:
  - command output compact text
  - generic text cap
  - structured payload summary
- Keep helpers deterministic. No LLM call.

Recommended API:

```ts
export const DEFAULT_MODEL_VISIBLE_TEXT_LIMIT_CHARS = 20_000;
export const DEFAULT_MODEL_VISIBLE_PROVIDER_EVENT_LIMIT_CHARS = 40_000;

export type ModelVisibleCompressionStrategy =
  | 'none'
  | 'text_head_tail'
  | 'json_summary'
  | 'command_output'
  | 'provider_event_redacted_summary';

export type ModelVisiblePayloadSummary = {
  truncated: boolean;
  strategy: ModelVisibleCompressionStrategy;
  originalChars: number;
  returnedChars: number;
  omittedReason?: string;
  contentHash?: string;
  artifactRef?: string;
  providerEventRef?: string;
};

export type ModelVisibleTextResult = {
  content: string;
  summary: ModelVisiblePayloadSummary;
};

export function compactModelVisibleText(input: {
  content: string;
  limitChars?: number;
  strategy?: Exclude<ModelVisibleCompressionStrategy, 'none'>;
  omittedReason: string;
  artifactRef?: string;
  providerEventRef?: string;
}): ModelVisibleTextResult;

export function summarizeModelVisibleJson(input: {
  value: unknown;
  limitChars?: number;
  omittedReason: string;
  providerEventRef?: string;
}): ModelVisibleTextResult;
```

Behavior requirements:

- Content at or under the limit returns unchanged with `strategy='none'`.
- Content over the limit keeps the beginning, selected important lines when available, and the tail.
- The returned text must include a visible marker such as `[model-visible-payload-compressed]`.
- The helper must never drop `omittedReason`, original size, returned size, and hash metadata.
- The helper must not write artifacts itself. Existing tool-specific artifact writers stay responsible for full evidence storage.

Avoid:

- Creating a new storage backend.
- Hiding full evidence without a ref.
- Adding provider-specific logic to the generic helper.

Gate:

```bash
bunx vitest run tests/services.model-visible-payload.test.ts tests/worker-tools/services-worker-tools-06.test.ts
```

Expected result:

- existing command compression metadata can be mapped to the shared summary shape.
- no behavior changes yet unless Phase 2 tests are included.
- tests show the helper is deterministic and preserves error-like lines.

### Phase 2. Worker Tool Default Compression

Change NightWorkers-controlled command tools to compact by default.

Files:

- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/run-verification.ts`
- `api/services/supervisor/prompt-tool-registry.ts`
- `api/services/supervisor/skills/builtin/SKILL.md`
- `api/services/supervisor/skills/builtin/references/overlays/evidence.md`
- `api/services/supervisor/skills/builtin/references/modes/code_edit.md`
- `api/services/supervisor/skills/builtin/references/phases/verify.md`
- `tests/worker-tools/services-worker-tools-05.test.ts`
- `tests/worker-tools/services-worker-tools-06.test.ts`
- `tests/services.supervisor-skills.test.ts`

Changes:

- Set `runCommandTool` default `compressionMode` to `auto`.
- Keep `compressionMode='off'` as an explicit escape hatch.
- Update prompt tool descriptions:
  - default stdout / stderr are compacted when large.
  - use `compressionMode='off'` only when exact full output is necessary.
- Add bounded command guidance to the Supervisor tool descriptions and these skill references:
  - prefer `read_file` with line ranges over `cat` / full-file command output.
  - prefer `search_files` / path-scoped `rg` over broad recursive shell searches.
  - prefer `git_status`, `git_diff` summary paths, and path-scoped diffs before full `git diff`.
  - when a command can produce many lines, choose flags that limit count, paths, format, or context before execution.
- Put the guidance where it belongs:
  - `overlays/evidence.md`: general evidence collection should prefer bounded tool output.
  - `modes/code_edit.md`: editing investigation should use `read_file` ranges / `search_files` before broad shell commands.
  - `phases/verify.md`: focused verification is allowed during investigation, but final closeout still prefers the required verify command.
- Ensure `run_verification` passes through default auto behavior.
- Preserve artifact-writing behavior for long outputs.

Implementation notes:

- Change only the destructuring default in `runCommandTool`; do not change the input schema enum.
- `runVerificationTool` should not introduce its own default. It should keep delegating to `runCommandTool`.
- Keep `MAX_OUTPUT_CHARS` aligned with the shared helper limit unless a test proves command output needs a different cap.
- Update tests that assumed default full output only when the output exceeds the cap. Small output tests should not need changes.
- Do not add a hidden shell hook, command rewriter, or dependency on RTK / lean-ctx in this phase.
- Keep guidance Japanese to match existing Supervisor prompt conventions.

Verification expectations:

- large output is compacted by default.
- small output is unchanged.
- explicit `compressionMode='off'` preserves full output.
- full output artifact contains the original output.
- tool registry or skill tests assert that command guidance mentions bounded / scoped command usage.
- no test relies on transparent command rewriting.

Gate:

```bash
bunx vitest run tests/worker-tools/services-worker-tools-05.test.ts tests/worker-tools/services-worker-tools-06.test.ts tests/services.supervisor-skills.test.ts
```

### Phase 3. Codex SDK Command Execution Projection

Compact Codex SDK `command_execution` events at the NightWorkers activity boundary.

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/thread-timeline-codex-tool-card.test.ts`
- `tests/thread-timeline-edit-summary/thread-timeline-edit-summary-02.test.ts`

Changes:

- Add a compact projection for `item.aggregated_output`.
- Include metadata:
  - `aggregatedOutputTruncated`
  - `aggregatedOutputOriginalChars`
  - `aggregatedOutputReturnedChars`
  - `compressionStrategy`
  - `fullProviderEventAvailable`
- Do not duplicate the entire provider event in multiple NightWorkers-owned payloads if a persisted event already carries it.
- Keep command, exit code, commandClass, providerItemId, and status visible.
- Timeline cards should show compact output and truncation badge when applicable.

Recommended implementation:

- Add a local adapter helper in `codex-sdk-event-adapter.ts`:

```ts
function compactCodexCommandExecutionItem(input: {
  item: Extract<ThreadItem, { type: 'command_execution' }>;
  rawEvent: ThreadEvent;
}): {
  aggregatedOutput: string | undefined;
  aggregation: ModelVisiblePayloadSummary | null;
  providerEvent: unknown;
  providerEventSummary: ModelVisiblePayloadSummary | null;
};
```

- Use `compactModelVisibleText` for `item.aggregated_output`.
- Apply `summarizeModelVisibleJson` to `redactProviderEvent(rawEvent)` when the serialized provider event exceeds the provider-event limit.
- Preserve `providerEvent` as a compact JSON summary when it is too large.
- Add `providerEventCompacted: true` when compaction happens.
- Keep existing field names `aggregatedOutput`, `exitCode`, `status`, and `commandClass` so timeline and audit code do not need broad rewrites.

Do not:

- Remove `providerItemId`.
- Change `classifyCodexCommand`.
- Change Codex SDK thread creation or resume behavior.
- Store full provider output in a new DB table in this phase.

Verification expectations:

- long `aggregated_output` does not appear in full in activity payload.
- command audit still classifies read-before-edit and verification commands.
- timeline summaries remain stable.
- final report evidence extraction still sees command, status, exit code, and relevant excerpts.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/thread-timeline-codex-tool-card.test.ts tests/thread-timeline-edit-summary/thread-timeline-edit-summary-02.test.ts
```

### Phase 4. Native/API Tool Result Boundary

Ensure native/API runner never stores unbounded full payload as model-visible tool result content.

Files:

- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-session-store.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-session-store.test.ts`

Changes:

- Apply model-visible cap to `NativeApiToolResult.content` after each tool dispatch.
- Preserve full structured result in `payload` / `resultJson` when available.
- Store compact text as `modelVisibleOutput`.
- Add context-budget debug for largest model-visible item:
  - type
  - char count
  - cap exceeded before compaction
  - cap exceeded after compaction
- Keep existing baseline compaction unchanged.

Concrete call sites:

- `native-api-tool-dispatcher.ts`
  - update `projectWorkerResult(...)` so worker tool output is compacted before it becomes `NativeApiToolResult.content`.
  - apply the same cap to `dispatchMcpCatalog`, `dispatchTodoTool`, and contextStill tool results when their rendered `content` is large.
- `native-api-startup-controller.ts`
  - use the same projector for startup tool results before calling `finishToolCall`.
  - keep startup-specific rendered history helpers, but cap their returned text.
- `native-api-closeout-controller.ts`
  - cap closeout tool result content before `finishToolCall`.
- `native-api-runner.ts`
  - keep `modelVisibleOutput: dispatch.toolResult.content`; the invariant should be that `dispatch.toolResult.content` is already compacted.
- `native-api-session-store.ts`
  - keep `resultJson` unchanged.
  - keep `modelVisibleOutput` as the compact text.

Recommended helper placement:

- Put worker-result projection in one exported function, not three local copies:

```ts
export function projectWorkerResultToNativeApiToolResult(
  result: WorkerToolResult<unknown>,
  options?: { contentLimitChars?: number }
): NativeApiToolResult;
```

- Reuse it from dispatcher, startup controller, and closeout controller.
- Existing local `projectWorkerResult` functions should either delegate to the exported helper or be removed.

Verification expectations:

- a tool returning a very large text payload stores compact model-visible output.
- provider messages contain compact text, not full payload.
- session store still retains enough full payload for diagnostics.
- baseline compaction tests still pass.
- startup controller and closeout controller tests cover the same invariant, not only normal dispatch.

Gate:

```bash
bunx vitest run tests/services.native-api-runner.test.ts tests/services.native-api-session-store.test.ts tests/services.native-api-runner-startup.test.ts tests/services.native-api-runner-closeout.test.ts
```

### Phase 5. Todo, Import, Specification, and Diff Follow-up Slice

After command / runtime payload boundaries are stable, apply the same rule to NightWorkers-specific high-volume tools.

Split this into separate PRs. Do not implement all four tool families in one change.

#### Phase 5A. Todo Mutation Compact Result

Files:

- `api/services/worker-tools/todo-list.ts`
- `api/services/todo-runtime/*`
- `tests/services.todo-runtime.test.ts`
- native/API Todo tests in `tests/services.native-api-runner.test.ts`

Changes:

- `todo_list` mutation results return changed todo, next todo, open count, terminal count, and compact evidence.
- full Todo list remains available through `operation=list`.

Recommended API:

```ts
export type TodoActionCompactPayload = {
  runId: string;
  taskId: string;
  action: 'todo_list';
  operation?: TodoListOperation;
  changedTodo?: TodoListPayloadTodo | null;
  currentTodo?: TodoListPayloadTodo | null;
  nextTodo?: TodoListPayloadTodo | null;
  counts: {
    total: number;
    pending: number;
    running: number;
    passed: number;
    failed: number;
    needsHuman: number;
  };
  transition?: TodoActionTransition;
  diagnostics?: TodoActionDiagnostics;
  fullListAvailableVia: 'todo_list operation=list';
};
```

Implementation rule:

- Do not remove `TodoActionPayload` immediately if UI or timeline selectors consume it.
- Add a compact projection used for model-visible `content`.
- Keep `payload.todos` only where UI source-of-truth paths require it.

Gate:

```bash
bunx vitest run tests/services.todo-runtime.test.ts tests/services.native-api-runner.test.ts
```

#### Phase 5B. Import Project Compact Post-import View

Files:

- `api/services/worker-tools/import-project.ts`
- `api/services/worker-tools/project-post-import.ts`
- `tests/worker-tools/services-worker-tools-01.test.ts`
- `tests/services.native-api-runner-import-project.test.ts`

Changes:

- Add a compact post-import projection containing:
  - import mode,
  - template id or git URL summary,
  - generated file count and notable files,
  - manifest package / scripts / recommended verification commands,
  - postImport notes and warnings,
  - llmContext digest and selected highlights.
- Keep full `postImport` in structured payload while model-visible `content` uses compact projection.
- Do not re-read `LLM_CONTEXT.md` or `package.json` when compact post-import already carries the necessary fields.

Gate:

```bash
bunx vitest run tests/worker-tools/services-worker-tools-01.test.ts tests/services.native-api-runner-import-project.test.ts
```

#### Phase 5C. Specification Views

Files:

- `api/services/worker-tools/read-current-specification.ts`
- `api/services/supervisor/prompt-tool-registry.ts`
- `tests/read-current-specification-tool.test.ts`
- startup tests that call `read_current_specification`

Recommended input change:

```ts
export type ReadCurrentSpecificationView =
  | 'compact'
  | 'implementation'
  | 'migration'
  | 'ui'
  | 'verification'
  | 'full';

export interface ReadCurrentSpecificationInput {
  taskId: string;
  view?: ReadCurrentSpecificationView;
}
```

Default behavior:

- `view` defaults to `compact`.
- `compact` must include title, digest, goal, scope, acceptance criteria, routes, data model, migration notes, and verification.
- `full` returns the existing full `content`.
- If section extraction is uncertain, `compact` must include an explicit warning and point to `view='full'`.

Gate:

```bash
bunx vitest run tests/read-current-specification-tool.test.ts tests/services.native-api-runner-startup.test.ts
```

#### Phase 5D. Diff Compact View

Files:

- `api/services/worker-tools/git.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- timeline edit-summary tests

Changes:

- Add compact diff summary with changed files, insertions, deletions, binary/generated markers, and hunk summaries.
- Keep full diff behind existing artifact / payload path.
- Use compact diff in final prompt-visible reporting unless review mode explicitly requests full hunks.

Gate:

```bash
bunx vitest run tests/thread-timeline-edit-summary/thread-timeline-edit-summary-01.test.ts tests/thread-timeline-edit-summary/thread-timeline-edit-summary-02.test.ts tests/services.codex-agent-runtime.test.ts
```

Verification expectations:

- TodoList UI still has source-of-truth data.
- model-visible mutation result stays compact.
- specification-dependent implementation still sees goal, scope, acceptance criteria, migration, and verification.
- full views remain available through explicit operations.

Combined Phase 5 gate after all sub-slices:

```bash
bunx vitest run tests/services.todo-runtime.test.ts tests/read-current-specification-tool.test.ts tests/worker-tools/services-worker-tools-01.test.ts tests/nightworkers.activity-transcript.test.ts
```

### Phase 6. Usage and Observability

Add metrics that separate cost and prompt-shape concerns.

Files:

- `api/services/llm-usage/*`
- `api/services/agent-runtime/codex-sdk/codex-sdk-usage.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- Project detail / overview selectors if they already expose usage breakdowns

Changes:

- Preserve existing input / cached input / output metrics.
- Add or derive `nonCachedInput = input - cachedInput` where safe.
- Record model-visible payload size estimates for runtime turns.
- Record full evidence original size vs returned model-visible size for compacted payloads.
- For command outputs, distinguish `commandGuidanceApplied` / `boundedCommandHinted` style metadata from post-output compaction metadata when the source can report it.
- Track counts and size reductions by layer:
  - worker tool command compaction.
  - Codex SDK command projection compaction.
  - native/API model-visible tool-result compaction.
  - high-volume NightWorkers tool compact views.
- Do not treat cached input as free for prompt-design analysis.

Verification expectations:

- usage records still persist for Codex SDK lane.
- cached and non-cached input can be displayed or queried separately.
- compacted payload count and size reduction can be inspected without reading raw artifacts.
- reports can answer whether a task saved context by issuing smaller commands, compacting large outputs, or both.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/services.conversation-context.test.ts
```

## Rollout Order

Recommended order:

1. Phase 0 and Phase 1 in one PR.
2. Phase 2 worker tool default compression.
3. Phase 3 Codex SDK command projection.
4. Phase 4 native/API model-visible boundary.
5. Phase 5 high-volume NightWorkers-specific tools.
6. Phase 6 usage observability.

Do not start Phase 5 before Phase 2 and Phase 3 are stable. BBS usage indicates command output and Codex SDK `command_execution` are the largest immediate sources.

## Safety Checks

Before each implementation slice:

```bash
git status --short
```

After each implementation slice:

```bash
git diff --check
bunx vitest run <focused tests for the phase>
```

Before final closeout:

```bash
bun run verify
```

If `bun run verify` fails for unrelated existing failures, record:

- exact command
- failure summary
- why the failure is unrelated
- focused tests that passed for this plan

## Acceptance Criteria

- Long command output is no longer model-visible by default.
- Supervisor prompt/tool guidance prefers bounded commands before broad command output.
- Codex SDK `command_execution` activity payload does not carry unbounded `aggregated_output`.
- native/API `tool_result.content` is bounded before provider requests are built.
- Full evidence remains available by artifact, DB payload, or provider event ref.
- Important debugging information remains visible after compaction:
  - command
  - exit code
  - failed test names
  - assertion diff or top error lines
  - stack top when available
  - coverage gate failures when available
- Usage reporting distinguishes cached input from non-cached input and prompt-shape growth.
- Usage reporting can separate pre-command output reduction guidance from post-output compaction where NightWorkers owns the event.
- Existing runtime resume, Todo progression, and role working context behavior are not regressed.

## Explicit Non-goals

- No LLM summarization in the first implementation.
- No RTK / lean-ctx installation, shell hook, or transparent command rewrite.
- No cross-lane history rewrite.
- No Codex SDK thread mutation beyond supported SDK options.
- No replacement of existing baseline compaction.
- No UI redesign as a prerequisite.
- No broad refactor of worker tools unrelated to model-visible payload size.
