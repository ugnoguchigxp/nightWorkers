# Codex Provider / Runtime Separation Refactor Plan

## Objective

Codex SDK 由来の実行と、Azure OpenAI / OpenAI API / Bedrock などの structured provider 実行を分離する。

Plan mode の現在の使用感は維持する。計画・仕様策定では既存の Design Questionnaire / Blueprint / DB Design / Decision Review / Specification Workspace をそのまま使う。一方、実装 Run で Codex SDK を使う場合は、NightWorkers の Round1 / Round2 schema-first tool-call loop に閉じ込めず、Codex の native coding-agent runtime に渡す。

Codex には NightWorkers builtin capability を MCP tool guidance として渡す。Codex は必要に応じてその MCP tool を使い、NightWorkers は tool call / command / diff / verification / evidence report を run_events に保存する。

この計画の主目的は provider/runtime 分離である。Codex が実際に行ったファイル変更・コマンド実行・MCP tool call の監査は、実装 Run を Codex native runtime に逃がした後に必ず必要になるため、後続フェーズとして分けて計画する。

## Current Problem

最新ログでは `provider=codex`, `providerClass=agent_runtime`, `label=supervisor`, `round=2` が `callSupervisorLLM(...)` から繰り返し呼ばれていた。つまり Codex SDK は自由な coding-agent runtime ではなく、schema-first Supervisor の JSON tool-call provider として使われている。

結果として次の問題が起きる。

- Round2 prompt が NightWorkers worker tool catalog / Todo / procedure / previous tool results を膨らませる。
- Codex は `apply_patch` / `git_diff` など NightWorkers worker tool を選ぶだけになり、Codex native tool use が活きない。
- git repo ではない target workspace で `git_diff` が失敗し、その巨大な失敗出力が次の Round2 prompt に再投入される。
- `ACTIVE_LLM_PROVIDER=codex && CODEX_ENABLED=true` でも `resolveRuntimeLane(...)` は既定で `native-supervisor` を返す。
- 現行テストも「Codex provider 有効でも native-supervisor のまま」を期待しており、誤動作ではなく現行仕様になっている。

## Target Model

### Three Separate Axes

1. Conversation lane
   - `chat`: 通常会話。
   - `plan`: Plan mode。仕様策定のための一時状態。

2. Runtime lane
   - `native-supervisor`: Round1 / Round2 schema-first Supervisor loop。structured provider 向け。
   - `codex-agent`: Codex SDK の native coding-agent runtime。実装 Run 向け。

3. LLM provider
   - `openai`: OpenAI API structured JSON provider。
   - `azure-openai`: Azure OpenAI structured JSON provider。
   - `bedrock`: Bedrock structured JSON provider。
   - `fixture`: tests。
   - `codex`: legacy structured Codex provider としては残してもよいが、通常の実装 Run では選ばない。

この3軸を混ぜない。Plan mode は conversation lane であり、runtime lane ではない。Codex agent は runtime lane であり、Plan mode の代替ではない。

### Codex Round1 Decision

Codex 由来の実装 Run では Round1 判定は不要にする。

理由:

- Codex SDK 自体が task understanding / tool choice / file edit / command execution を行う coding-agent runtime である。
- NightWorkers の Round1 / Round2 は Azure/OpenAI API のような JSON completion provider に worker tool 選択をさせるための制御層である。
- Codex に同じ制御層を被せると、Codex native tool を殺して Supervisor tool-call loop だけが残る。

ただし Plan mode の intake は維持する。

- ユーザーが仕様策定や質問票を求める場面では、既存の Plan mode routing / Design Questionnaire の使用感を維持する。
- Plan mode の成果が揃い、実装 Run を開始するときに runtime lane を選ぶ。
- `codex-agent` lane の実装 Run では、Plan mode 成果を prompt / MCP context として渡し、Round1 jobType selection は行わない。

## Desired User Experience

### Plan Mode

- 今の Plan mode と同じように、質問票、Blueprint、DB Design、Decision Review、Specification Workspace を使える。
- Plan mode は「Codex にすぐ実装させる前に仕様を固める」体験として維持する。
- Plan mode 内の generation は structured provider を使ってよい。ここは schema-first JSON が適している。
- Plan mode の完了後、ユーザーが実装開始するときに Codex runtime lane へ渡せる。

### Codex Implementation Run

- Codex SDK を使う実装 Run は `codex-agent` lane に入る。
- NightWorkers は `runId`, `taskId`, `repoRoot`, latest user message, Specification Workspace summary, active Blueprint / DB Design / Decision Review refs, NightWorkers MCP guidance を渡す。
- Codex は native tools と NightWorkers MCP tools を自由に使う。
- NightWorkers は Codex の stream events を `run_events` に保存し、completion は evidence gate で判定する。

## Auditability Findings

Codex native runtime に寄せると、NightWorkers の Round2 tool loop ではなく Codex 側の tool/thinking/runtime に実作業が移る。これは実装能力の面では望ましいが、何を変更し、どのコマンドを実行し、どの MCP tool を使ったかが NightWorkers から見えなくなる危険がある。

2026-06-09 時点の確認:

- OpenAI の Codex manual は、Codex CLI / Codex SDK / Codex App Server / Skills / Universal cloud environment を open-source components として挙げている。
- 同じ表では IDE extension と Codex web は open source ではない扱いになっている。Desktop app 全体の source を安定 API として参照できる根拠は確認できなかった。
- ローカルには `codex-cli 0.130.0` が `/Users/y.noguchi/.local/share/mise/installs/node/24.11.1/bin/codex` として入っている。npm package は `@openai/codex@0.130.0`, Apache-2.0, repository `github.com/openai/codex`。
- `codex exec --json` は JSONL event output を持つ。`codex debug app-server` もあるため、CLI / SDK / app-server の observable event を比較できる。
- `~/.codex/sessions/.../*.jsonl` には `session_meta`, `agent_reasoning`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output` などが残る。ただしこれは Codex Desktop / CLI の内部保存形式であり、NightWorkers の安定依存先にはしない。
- Codex hooks は `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop` などで Bash / apply_patch / MCP tool を matcher にできる。Codex 側の補助監査として使える可能性はあるが、NightWorkers の canonical audit source は SDK/app-server stream event と post-run workspace evidence に置く。

方針:

- Desktop app の private implementation には依存しない。
- Local Codex CLI / open-source `openai/codex` は、event shape と hook/app-server behavior の調査対象にする。
- NightWorkers 側には Codex event をそのまま保存する raw event layer と、UI/判定用の normalized audit event layer を分けて持つ。
- `~/.codex/sessions` は regression fixture / manual recovery の参考に留め、通常 runtime の primary source にはしない。

## Builtin MCP Capability Direction

Codex に渡す tool surface は、NightWorkers 内部 worker tool ではなく、Codex が理解できる MCP capability にする。

Initial builtin MCP tools:

- `nightworkers.get_task_context`
  - Input: `{ taskId, runId }`
  - Output: task title/objective, repository path, runtime lane, current specification refs, queue context.
- `nightworkers.get_specification_workspace`
  - Input: `{ taskId }`
  - Output: Blueprint / DB Design / Questionnaire / Decision Review / implementation reference summaries.
- `nightworkers.list_artifacts`
  - Input: `{ taskId, kinds? }`
  - Output: artifact refs with ids, kind, title, source, digest.
- `nightworkers.read_artifact`
  - Input: `{ taskId, artifactId }`
  - Output: normalized artifact body and source metadata.
- `nightworkers.report_evidence`
  - Input: `{ runId, status, summary, changedFiles?, verification?, blockers?, risk? }`
  - Output: persisted evidence event id.
- `nightworkers.report_verification`
  - Input: `{ runId, command?, status, outputDigest?, notes? }`
  - Output: persisted verification event id.

Later tools:

- `nightworkers.create_blueprint_draft`
- `nightworkers.create_db_design_draft`
- `nightworkers.start_questionnaire`
- `nightworkers.submit_questionnaire_answers`
- `nightworkers.create_decision_review`

Important boundary:

- Codex must not edit the NightWorkers internal DB directly.
- MCP writes must validate `taskId`, `runId`, repository ownership, source refs, and operation kind.
- Adoption remains explicit unless a later trusted automation policy is added.

## Refactor Slices

### Slice 0: Pre-Implementation Checkpoint

Purpose: avoid mixing this refactor with the current large working tree.

Actions:

1. Commit this plan as a dedicated planning commit.
2. Do not stage the unrelated current dirty tree.
3. Before implementation, either start a clean branch/worktree or explicitly decide whether the existing UI primitive changes belong to the next implementation snapshot.

Acceptance:

- Plan file is committed alone.
- Existing dirty files remain unstaged.

### Slice 1: Rename and Split Codex Provider Responsibilities

Purpose: stop treating Codex SDK as a normal Supervisor provider by default.

Files:

- `api/services/supervisor/llm-provider/codex.ts`
- `api/services/supervisor/llm-provider/providers.ts`
- `api/services/supervisor/llm-provider/request.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- tests under `tests/supervisor-llm-provider/*`

Actions:

1. Rename helpers so their responsibility is explicit:
   - `buildCodexSupervisorSdkOptions` -> `buildCodexStructuredProviderSdkOptions`
   - `buildCodexSupervisorThreadOptions` -> `buildCodexStructuredProviderThreadOptions`
2. Add a separate runtime config builder for `CodexAgentRuntime`, not reusing structured provider feature suppression.
3. Keep structured provider Codex path only as legacy/explicit mode.
4. Add diagnostics when `provider=codex` is used for `label=supervisor`, recommending `codex-agent` runtime for implementation Runs.

Acceptance:

- Structured provider tests still pass.
- `CodexAgentRuntime` no longer imports helpers named `Supervisor`.
- Codex runtime config can enable NightWorkers MCP projection while structured provider config keeps MCP disabled.

### Slice 2: Runtime Lane Resolution

Purpose: route Codex implementation Runs to `codex-agent` without Round1.

Files:

- `api/services/agent-runtime/runtime-lane.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/modules/nightworkers/nightworkers.queue-management.service.ts`
- settings schema/routes if runtime lane setting is exposed
- `tests/services.agent-runtime-registry.test.ts`
- `tests/nightworkers-service/services-nightworkers-*.test.ts`

Actions:

1. Add explicit runtime lane setting, for example `IMPLEMENTATION_RUNTIME_LANE`.
2. Resolve order:
   - task override
   - queue override
   - settings override
   - env override
   - provider-derived default
3. If `ACTIVE_LLM_PROVIDER=codex && CODEX_ENABLED=true` and no explicit override exists, default implementation Run to `codex-agent`.
4. If Plan mode generation is running, continue to use structured provider path and do not force `codex-agent`.
5. Persist `context_snapshot.runtimeLane`, `runtimeLaneResolution`, and diagnostics.

Acceptance:

- Codex provider + enabled settings produce `workerKind: codex-agent` for implementation Run.
- Azure/OpenAI/Bedrock settings produce `workerKind: native-local`.
- Plan mode questionnaire/blueprint generation remains structured provider.
- Existing env override behavior is still deterministic.

### Slice 3: Skip Supervisor Round1/Round2 for Codex Agent Runs

Purpose: make `codex-agent` a true runtime lane.

Files:

- `api/services/agent-runtime/NativeAgentRuntime.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/todo-context/*`
- tests for startTaskRun and Codex runtime

Actions:

1. `NativeAgentRuntime` remains the only caller of `runSupervisorLoop(...)`.
2. `CodexAgentRuntime` receives a composed runtime prompt and starts Codex SDK directly.
3. Do not build `buildRound1JobTypePrompt` or `buildRound2ToolCallPrompt` for `codex-agent` Runs.
4. Do not auto-load Supervisor procedure summaries into Codex prompt.
5. Pass compact Plan mode/specification context as user/runtime context, not as Round2 tool-call history.

Acceptance:

- A Codex implementation Run produces no `round1.prompt_built` or `round2.prompt_built` events.
- It does produce `runtime_started`, `turn_started`, Codex tool/model events, and `runtime_finished`.
- Native supervisor Runs still produce Round1/Round2 events.

### Slice 4: NightWorkers Builtin MCP Projection

Purpose: let Codex use NightWorkers capability tools directly.

Files:

- new `api/services/nightworkers-capabilities/*`
- new `api/services/agent-runtime/codex-runtime-config.ts`
- MCP server entrypoint or local adapter under existing MCP service structure
- `api/services/mcp/*`
- tests for capability schemas and runtime config

Actions:

1. Create a shared capability service with typed request/response schemas.
2. Expose read-only tools first:
   - task context
   - specification workspace
   - list/read artifacts
3. Expose write/report tools second:
   - report evidence
   - report verification
4. Project those tools into Codex runtime config as an MCP server named `nightworkers`.
5. Render concise Japanese guidance explaining when to use each tool.
6. Keep this guidance out of structured provider prompts.

Acceptance:

- Codex runtime config includes `nightworkers` MCP server when enabled.
- Structured provider config still has `mcp: false` and empty `mcp_servers`.
- MCP tool calls are mapped by `codex-event-mapper` as runtime tool events, not provider rejection.
- Tool validation rejects mismatched `taskId` / `runId`.

### Slice 5: Plan Mode Context Handoff

Purpose: preserve Plan mode while making it useful to Codex runtime.

Files:

- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`
- Specification Workspace aggregation service
- `CodexAgentRuntime` prompt builder
- UI components only if needed for handoff state

Actions:

1. Keep current Plan mode generation behavior.
2. When implementation starts, build a compact context packet:
   - latest user implementation request
   - accepted Decision Review
   - latest Blueprint summary
   - latest DB Design summary
   - open questions/blockers
   - artifact refs available through MCP
3. Codex runtime prompt says: use MCP tools for full artifact bodies instead of relying on long injected text.
4. Do not run Round1 jobType selection for Codex handoff.

Acceptance:

- Existing Plan mode route tests continue to pass.
- Codex runtime receives artifact refs and summaries.
- Large Blueprint/Questionnaire bodies are not injected wholesale when MCP read tools are available.

### Slice 6: Evidence Gate and Finalization

Purpose: avoid trusting Codex prose alone.

Files:

- new `api/services/agent-runtime/codex-outcome-gate.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- tests for outcome gate

Actions:

1. Collect inputs:
   - final assistant text
   - `nightworkers.report_evidence`
   - `nightworkers.report_verification`
   - Codex command/MCP/file-change events
   - post-run diff if repo is a git repo
   - runtime errors
2. Decide:
   - `completed`
   - `needs_review`
   - `blocked`
   - `failed`
   - `cancelled`
3. If workspace is not a git repo, do not treat `git diff` failure as fatal by itself. Require file-change evidence or explicit no-change explanation.
4. Keep existing finalization path by returning `AgentRuntimeResult`.

Acceptance:

- "done" with no diff/evidence for a code task cannot become `completed`.
- verification failure becomes `needs_review` or `failed`.
- MCP-reported blocker becomes `blocked`.
- non-git target workspace can complete if file-change/evidence exists.

### Slice 7: Codex Audit Discovery

Purpose: define what can be traced from public/local Codex surfaces before building durable audit UX.

Files:

- new `spec/codex-auditability-discovery.md`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-event-mapper.ts`
- tests/fixtures under `tests/fixtures/codex-events/*`

Actions:

1. Inspect local `codex exec --json` event output with a tiny read-only task, a file-edit task, and a command-running task.
2. Inspect Codex SDK/app-server event stream for the same task shapes.
3. Compare with local `~/.codex/sessions` JSONL only as evidence of extra event types, not as a contract.
4. Inspect open-source `openai/codex` CLI / SDK / app-server source for documented event names, hook payloads, and stability notes.
5. Document which fields are stable enough for NightWorkers:
   - command execution
   - apply_patch / file edit
   - MCP tool call
   - final response
   - failure / cancellation
   - sandbox / approval status
6. Capture raw fixtures with secrets redacted.

Acceptance:

- Discovery doc separates stable SDK/app-server events from private session-log observations.
- Fixtures cover at least one file edit, one shell command, one MCP call, one failure, and one no-change completion.
- No implementation code depends on Desktop app private files.

### Slice 8: Runtime Event Capture

Purpose: persist Codex work as audit events while keeping raw events available for future parser fixes.

Files:

- new `api/services/agent-runtime/codex-audit-event-store.ts`
- `api/services/agent-runtime/codex-event-mapper.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- DB migration for `run_events` payload extensions or a dedicated audit artifact table
- tests for redaction and event mapping

Actions:

1. Store every Codex SDK/app-server stream event as a raw event with `runId`, sequence number, timestamp, event type, and redacted payload.
2. Normalize known events into:
   - `codex.command.started`
   - `codex.command.finished`
   - `codex.file_change.detected`
   - `codex.mcp.started`
   - `codex.mcp.finished`
   - `codex.final_response`
   - `codex.runtime.failed`
3. Preserve unknown events as `codex.raw_event` with a digest and preview.
4. Redact env vars, auth tokens, large stdout/stderr, and MCP arguments according to existing artifact redaction policy.
5. Add event sequence integrity checks so UI can show gaps.

Acceptance:

- A Codex implementation Run has a complete raw event chain.
- Normalized events are enough for timeline display and outcome gate decisions.
- Unknown event types do not crash the run.

### Slice 9: File Change Audit

Purpose: prove what Codex changed without trusting Codex prose or Desktop private logs.

Files:

- new `api/services/agent-runtime/workspace-change-auditor.ts`
- `api/services/agent-runtime/codex-outcome-gate.ts`
- tests for git and non-git workspaces

Actions:

1. Record pre-run workspace snapshot:
   - git `HEAD` and `git status --porcelain=v1` when inside a git repo
   - fallback file manifest for non-git target roots
2. Record post-run snapshot and derive changed files.
3. For git repos, store `git diff --name-status` and a bounded patch artifact.
4. For non-git roots, store path-level changes plus hashes / sizes / mtimes; store content diff only for safe text files under size limits.
5. Treat ignored/generated files according to project ignore rules.
6. Attach file-change evidence to outcome gate.

Acceptance:

- Git workspaces produce file list and patch evidence.
- Non-git workspaces can still produce reliable file-change evidence.
- `git diff` failure in a non-git directory cannot poison the Codex prompt loop.

### Slice 10: Command and MCP Tool Audit

Purpose: make Codex-side actions reviewable even when Codex chooses native tools.

Files:

- `api/services/agent-runtime/codex-event-mapper.ts`
- new `api/services/agent-runtime/codex-command-audit.ts`
- new `api/services/agent-runtime/codex-mcp-audit.ts`
- tests for command/MCP event redaction

Actions:

1. For commands, record:
   - command text or argv
   - cwd
   - start/end timestamps
   - exit code/status
   - stdout/stderr digest and bounded preview
   - timeout/sandbox/approval metadata when available
2. For MCP calls, record:
   - server name
   - tool name
   - redacted args digest/preview
   - result digest/preview
   - duration
   - status/error
3. If SDK/app-server event lacks a required field, mark it `unknown` rather than inventing values.
4. Optionally test Codex hooks as a secondary command/MCP observer, but do not make hooks the only audit path.

Acceptance:

- Timeline can show which commands and MCP tools Codex used.
- Sensitive args and outputs are redacted.
- Missing fields are visible as missing, not silently normalized away.

### Slice 11: Audit UI, Export, and Replay

Purpose: make Codex implementation Runs explainable after the fact.

Files:

- run/timeline UI
- artifact/export service
- replay/import service if reused
- tests for timeline event rendering and export shape

Actions:

1. Add Codex audit timeline groups:
   - model/turn events
   - file changes
   - commands
   - MCP tool calls
   - verification/evidence
2. Collapse noisy raw events by default, with a raw JSON drawer for debugging.
3. Add run export JSONL containing raw Codex events, normalized audit events, file-change evidence, and final outcome.
4. Add replay/import fixture support so event mapper regressions can be tested without re-running Codex.
5. Surface audit gaps explicitly, for example `command output unavailable` or `unknown event type`.

Acceptance:

- A reviewer can answer "what files changed?", "what commands ran?", and "which MCP tools were called?" from the NightWorkers UI/export.
- Replay fixtures can reproduce timeline and outcome gate decisions.
- UI does not imply NightWorkers worker tools performed actions that Codex performed natively.

### Slice 12: UI and Settings

Purpose: make the split understandable without changing Plan mode UX.

Files:

- settings panels
- run/timeline UI
- implementation queue UI
- task/session start controls

Actions:

1. Add compact runtime lane display: `Native Supervisor` / `Codex Agent`.
2. Add settings copy that says Codex SDK is a runtime lane for implementation, not a structured provider for Supervisor decisions.
3. Keep Plan mode controls and Specification Workspace flow unchanged.
4. Collapse noisy Codex progress events by default.
5. Show MCP tool failures and evidence reports in timeline.

Acceptance:

- Plan mode still feels like the current Plan mode.
- Codex implementation Run visibly uses `Codex Agent`.
- Timeline does not imply NightWorkers worker tools performed Codex native actions.

## Verification Plan

Focused tests:

```bash
pnpm test run tests/services.agent-runtime-registry.test.ts
pnpm test run tests/services.codex-agent-runtime.test.ts
pnpm test run tests/supervisor-llm-provider
pnpm test run tests/nightworkers-service
pnpm test run tests/nightworkers-workbench-routes
pnpm test run tests/services.mcp-settings.test.ts
```

Broader checks:

```bash
pnpm typecheck
pnpm lint
pnpm verify
```

Manual smoke:

1. Use OpenAI/Azure provider and confirm Plan mode questionnaire generation still works.
2. Use Codex provider and start an implementation Run.
3. Confirm run events do not include Round1/Round2 prompt events.
4. Confirm Codex can call `nightworkers.get_specification_workspace`.
5. Confirm file changes and verification evidence are visible.
6. Confirm final status is evidence-derived.
7. After audit phases, confirm command execution, MCP tool calls, raw Codex events, and file-change evidence are exportable from a run JSONL.
8. Confirm a replay fixture can rebuild the same timeline and outcome without re-running Codex.

## Non-Goals

- Do not rewrite Plan mode.
- Do not make Codex edit NightWorkers internal DB directly.
- Do not expose every worker tool as MCP on the first slice.
- Do not remove Azure/OpenAI/Bedrock structured provider support.
- Do not classify user text with regex/keywords.
- Do not inject long English operating rules into prompt text; keep NightWorkers prompt wording Japanese.

## Open Decisions

- Whether to remove `codex` from selectable structured providers entirely or keep it as an advanced legacy option.
- Whether runtime lane setting should live in global settings, per project, per queue entry, or all three.
- Whether write-capable NightWorkers MCP tools should be enabled by default or require an explicit project trust toggle.
- Whether Codex runtime should update project AGENTS.md or receive thread-scoped guidance only.
- Whether Codex hooks should be officially supported as a secondary audit source, or kept as operator-local instrumentation only.
- Whether raw Codex events should stay in `run_events` or move to a dedicated append-only audit artifact table.
