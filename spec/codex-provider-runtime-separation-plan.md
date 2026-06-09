# Codex Provider / Runtime Separation Refactor Plan

## Objective

Codex SDK 由来の実行と、Azure OpenAI / OpenAI API / Bedrock などの structured provider 実行を分離する。

Plan mode の現在の使用感は維持する。計画・仕様策定では既存の Design Questionnaire / Blueprint / DB Design / Decision Review / Specification Workspace をそのまま使う。一方、実装 Run で Codex SDK を使う場合は、NightWorkers の Round1 / Round2 schema-first tool-call loop に閉じ込めず、Codex の native coding-agent runtime に渡す。

Codex には NightWorkers builtin capability を MCP tool guidance として渡す。Codex は必要に応じてその MCP tool を使い、NightWorkers は tool call / command / diff / verification / evidence report を run_events に保存する。

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
3. Before implementation, either start a clean branch/worktree or explicitly decide whether the existing design system/UI changes belong to the next implementation snapshot.

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

### Slice 7: UI and Settings

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
