# Runtime Lane Domain Separation 実装計画

## 1. 目的

Codex SDK 専用レーンと OpenAI API 準拠フローを、ドメインレベルで分離する。

共通で使う契約、プロンプト構築、usage 正規化、event ledger 投影、Todo / closeout gate は shared domain に置く。各 runtime lane は shared domain を利用する adapter として実装し、lane 固有の SDK / API / process 操作を shared domain へ混ぜない。

この計画は、第3の runtime lane が追加されても既存レーンを横断編集しなくてよい構造を目標にする。

## 1.1 ドキュメントレビュー結果

この計画は実装に移れる。ただし、最初の版では `api-structured` を `runtime-lanes/` の例に含めており、OpenAI API 準拠フローを runtime lane と誤読できる余地があった。

修正後の方針では、runtime lane domain と structured LLM provider domain を明確に別 tree として扱う。shared domain は runtime lane が共通で使う契約を持つが、structured LLM provider の request shape は持たない。

実装開始時は、まず behavior を変えない shared contract 抽出から始める。Codex provider 削除や settings UI 分離は、shared contract が入ってから行う。

## 2. 現状の問題

### 2.1 Codex が provider と runtime lane の両方にいる

現在の実装では、Codex は次の2箇所に存在する。

- `api/services/agent-runtime/CodexAgentRuntime.ts`
  - Codex SDK を implementation runtime lane として使う。
- 旧 structured provider dispatcher
  - `callCodexProvider(...)` が legacy structured provider として Codex SDK を使っていた。

これにより、LLM が「Codex SDK lane」と「Supervisor structured provider」を同じものとして扱いやすい。

### 2.2 OpenAI API 準拠フローと Codex SDK lane の責務が同じ dispatcher に入っている

旧 structured provider dispatcher は OpenAI / Azure / Bedrock / fixture と Codex SDK を同じ `callProvider(...)` dispatcher で扱っていた。

OpenAI API 準拠フローは、structured JSON を返す API provider adapter である。一方 Codex SDK lane は、workspace と tool surface を持つ agent runtime である。この2つは同じ provider abstraction に置かない。

### 2.3 共通処理が lane 固有ファイルへ寄っている

`CodexAgentRuntime.ts` は次をまとめて持っている。

- Codex SDK thread 作成
- Codex runtime prompt contract
- SDK event mapping 後の audit
- NightWorkers MCP tool policy
- import_project terminal policy
- usage 記録
- diff 収集

このうち、prompt contract の一部、warning 型、usage 記録、event ledger 投影、Todo / closeout gate は shared domain 化できる。

### 2.4 SystemContext / prompt ownership が複数箇所にある

Supervisor Round 1 / Round 2 は `prompt-packet.ts` と `skills/registry.ts` に集約されている。

一方、Blueprint / DB Design / Design Questionnaire / Specification generation は、それぞれの service 内に SystemContext 相当の文字列を持つ。

これは即時の動作バグではないが、prompt 変更時に LLM が異なる運用ルールを参照する温床になる。

## 3. 目標アーキテクチャ

### 3.1 レイヤー

```text
api/services/runtime-lanes/
  shared/
    contracts/
    prompt-contracts/
    usage/
    events/
    todos/
    closeout/
    policy/
  codex-sdk/
    CodexSdkLaneRuntime.ts
    codex-sdk-client.ts
    codex-sdk-event-adapter.ts
    codex-sdk-mcp-audit.ts
    codex-sdk-import-policy.ts
    codex-sdk-runtime-config.ts
  native-supervisor/
    NativeSupervisorLaneRuntime.ts
    supervisor-loop-bridge.ts
  future-example/
    FutureLaneRuntime.ts

api/services/structured-llm/
  shared/
    request.ts
    usage.ts
    json.ts
    events.ts
  providers/
    openai-compatible.ts
    azure-openai.ts
    bedrock.ts
    fixture.ts
```

実際の移行では、既存 path を一度に rename しない。まず `api/services/agent-runtime/shared/` を作り、安定後に `runtime-lanes/` へ移すかを判断する。

`structured-llm/` は runtime lane ではない。Supervisor Round 1 / Round 2、Blueprint、DB Design、Questionnaire などの structured JSON generation が使う API provider domain である。

### 3.2 shared domain の責務

shared domain に置くもの:

- lane 共通型
  - `RuntimeLaneKind`
  - `RuntimeLaneResult`
  - `RuntimeLaneEvent`
  - `RuntimeContractWarning`
  - `RuntimeUsageRecordInput`
- prompt contract の共通部品
  - Todo gate contract
  - closeout contract
  - verification contract
  - repository workspace boundary
  - AGENTS / project rule injection boundary
- usage 正規化
  - measured usage と estimate usage の区別
  - prompt part estimate の扱い
  - provider / lane metadata の共通 schema
- event ledger 投影
  - runtime event から run event への canonical mapping
  - warning severity mapping
  - activity payload の共通 shape
- Todo / closeout gate
  - open Todo completion guard
  - final gate naming
  - review / verify / knowledge / final report gate
- policy 共通部品
  - workspace root validation
  - external path policy の型
  - command evidence の共通分類型

shared domain に置かないもの:

- Codex SDK import / `Thread` / `ThreadEvent`
- Codex MCP server config
- OpenAI Chat Completions / Responses request body
- Azure endpoint / deployment URL construction
- Bedrock request construction
- native Supervisor Round 1 / Round 2 loop implementation
- lane 固有 prompt の全文

### 3.3 Codex SDK lane の責務

Codex SDK lane は次だけを持つ。

- Codex SDK client / thread 作成
- Codex SDK runtime options
  - auth
  - `CODEX_HOME`
  - MCP config
  - sandbox / approval / network / web search
  - model reasoning effort
- Codex SDK event を shared `RuntimeLaneEvent` へ変換する adapter
- Codex native activity の lane-specific audit
  - `command_execution`
  - `file_change`
  - `mcp_tool_call`
- NightWorkers MCP surface の投影
- `import_project` 失敗 / cancel 後 fallback 禁止 policy
- Codex SDK measured usage の抽出

Codex SDK lane は Supervisor structured JSON provider として使わない。

### 3.4 OpenAI API 準拠フローの責務

OpenAI API 準拠フローは API provider adapter に限定する。

- OpenAI compatible adapter
  - base URL
  - API key
  - model
  - structured output / JSON schema
  - streaming delta parse
- Azure OpenAI adapter
  - endpoint
  - deployment
  - api-version
- Bedrock adapter
  - region
  - model
  - Converse API shape
- fixture / test adapter

この flow は workspace edit や native command execution を持たない。必要な repository write は native Supervisor lane の worker tool dispatcher 経由で行う。

### 3.5 将来の第3 lane の追加条件

第3 lane は、次の interface を満たせば追加できる。

```ts
export interface RuntimeLaneAdapter {
  readonly kind: RuntimeLaneKind;
  start(context: RuntimeLaneContext, sink: RuntimeLaneSink, signal?: AbortSignal): Promise<RuntimeLaneResult>;
  stop(runId: string): Promise<void>;
}
```

lane registry は adapter だけでなく、lane 固有の setup を1箇所に集める。

```ts
export interface RuntimeLaneDefinition {
  readonly kind: RuntimeLaneKind;
  readonly aliases: readonly string[];
  buildInitialTodos(input: RuntimeLaneSetupInput): ImplementationTodoInput[];
  buildRuntimeOptions(input: RuntimeLaneSetupInput): Record<string, unknown>;
  createAdapter(): RuntimeLaneAdapter;
}
```

追加時に変更してよい場所:

- lane registry
- lane settings schema
- lane 固有 adapter directory
- lane 固有 tests

追加時に変更しない場所:

- shared Todo / closeout gate
- shared runtime event schema
- shared usage schema
- native Supervisor prompt ownership
- OpenAI API provider adapters
- Codex SDK lane implementation

第3 lane 追加時に `startTaskRun(...)` の本文へ `if (lane === "...")` を足さない。必要な差分は lane registry と lane 固有 directory に閉じる。

## 4. 用語整理

### 4.1 provider

provider は structured LLM call の接続先を指す。

例:

- `openai-compatible`
- `azure-openai`
- `bedrock`
- `fixture`

`codex` は provider ではなく runtime lane として扱う。

### 4.2 runtime lane

runtime lane は Run を実行する主体を指す。

例:

- `native-supervisor`
- `codex-sdk`
- future lane

### 4.3 shared domain

shared domain は lane / provider に依存しない NightWorkers 実行契約である。

shared domain は「共通で使える実装」を置く場所であり、「どの lane でも便利だから」という理由で lane 固有 SDK や request shape を置かない。

## 5. 実装方針

### Phase 0: 実装開始前の固定事項を確認する

目的:

- behavior change を伴う refactor に入る前に、現行の入口と検証対象を固定する。

作業:

- 現行の runtime lane entrypoint を確認する。
  - `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
  - `api/services/agent-runtime/registry.ts`
  - `api/services/agent-runtime/runtime-lane.ts`
- Codex SDK import の現状を確認する。
  - `api/services/agent-runtime/*`
  - `api/services/structured-llm/*`
- structured LLM call の利用元を確認する。
  - Supervisor Round 1 / Round 2
  - Blueprint
  - DB Design
  - Design Questionnaire
  - Specification generation
- baseline test を実行する。
  - `bun x vitest run tests/services.codex-agent-runtime.test.ts`
  - `bun x vitest run tests/services.agent-runtime.test.ts`
  - `bun x vitest run tests/structured-llm`

検証:

- baseline failure がある場合は、この refactor 由来か既存 failure かを記録してから進む。
- Codex SDK import が agent runtime と supervisor provider の両方にあることを確認できる。
- structured generation の呼び出し元が `callStructuredJsonLLM(...)` に集約されていることを確認できる。

### Phase 1: 型と命名を分ける

目的:

- `provider` と `runtime lane` の語彙を分ける。
- 後続 refactor の compile-time guard を作る。

作業:

- `AgentRuntimeKind` を `RuntimeLaneKind` へ寄せる。
- 現行の `codex-agent` は互換 alias として受け付けるが、内部 canonical name は `codex-sdk` にする。
- まず `SupervisorProviderId` の `codex` を deprecated 扱いにする。削除は Phase 4 で行う。
- まず `SupervisorProviderClass` の `agent_runtime` を deprecated 扱いにする。削除は Phase 4 で行う。
- `ACTIVE_LLM_PROVIDER=codex` による implementation lane default を compatibility path として残し、diagnostic warning を出す。
- canonical setting は `IMPLEMENTATION_RUNTIME_LANE=codex-sdk` に寄せる。

検証:

- `resolveRuntimeLane(...)` が provider と lane を混同しない。
- `ACTIVE_LLM_PROVIDER=codex` だけでは structured provider として Codex が選ばれない。
- 既存設定の互換 warning が run event または settings diagnostics に出る。

Phase 1 では `callCodexProvider(...)` を削除しない。削除を同時に行うと、settings 互換と provider 分離の失敗原因が混ざるため。

### Phase 2: shared domain を作る

目的:

- Codex lane と native Supervisor lane の共通契約をファイル分離する。

作業:

- `api/services/agent-runtime/shared/` を追加する。
- 次を移す。
  - `CodexContractWarning` を `RuntimeContractWarning` に一般化
  - runtime event type
  - runtime result type
  - usage recorder helper
  - warning normalization / dedupe
  - closeout guard helper
  - Todo gate labels / final gate contract
- `CodexAgentRuntime.ts` と `nightworkers.run-orchestration.service.ts` は shared helper を使う。
- 既存 export 名は一時 alias を残し、PR 内の差分を behavior-preserving にする。
  - `CodexContractWarning` は `RuntimeContractWarning` の alias から始める。
  - `AgentRuntimeEvent` は `RuntimeLaneEvent` の alias から始める。
  - `AgentRuntimeResult` は `RuntimeLaneResult` の alias から始める。

検証:

- Codex warning が `runtimeContract.warnings` として保存される。
- native lane でも同じ result / event 型を使える。
- shared domain に `@openai/codex-sdk` import が存在しない。
- `git diff` 上で prompt 文言、terminal policy、Todo gate の意味が変わっていない。

### Phase 3: Codex SDK lane を lane adapter に分割する

目的:

- `CodexAgentRuntime.ts` を SDK adapter、prompt、audit、policy、usage に分ける。

作業:

- `codex-runtime-config.ts` を `codex-sdk/codex-sdk-runtime-config.ts` へ移す。
- `codex-event-mapper.ts` を `codex-sdk/codex-sdk-event-adapter.ts` へ移す。
- `buildCodexRuntimePrompt(...)` を `codex-sdk/codex-sdk-runtime-prompt.ts` へ移す。
- MCP audit を `codex-sdk/codex-sdk-mcp-audit.ts` へ切る。
- import policy を `codex-sdk/codex-sdk-import-policy.ts` へ切る。
- usage extraction を shared usage helper + Codex-specific extractor に分ける。
- `CodexAgentRuntime.ts` は次だけを残す。
  - adapter lifecycle
  - `createThread(...)` 呼び出し
  - event stream loop
  - shared sink への emit
  - finishRun orchestration

検証:

- Codex SDK lane directory 以外で `@openai/codex-sdk` を import していない。
- Codex runtime prompt は shared Todo / closeout contract を参照して構築される。
- import_project failure / cancelled hard gate が維持される。
- measured Codex usage と prompt part estimate が混同されない。
- `tests/services.codex-agent-runtime.test.ts` の既存 contract warning / import_project / usage tests が通る。

### Phase 4: OpenAI API 準拠 provider flow を structured-llm domain に分ける

目的:

- structured JSON generation と native runtime execution を分離する。

作業:

- 旧 Supervisor provider 互換層を削除し、structured JSON generation は `api/services/structured-llm/` に集約する。
- `providers.ts` の dispatcher を API provider だけにする。
- `callCodexProvider(...)` と旧 Codex structured provider を削除する。
- `buildNormalizedSupervisorLlmRequest(...)` は provider class を API provider に限定する。
- OpenAI compatible adapter は `/chat/completions` 互換に閉じる。
- 将来 Responses API adapter を足す場合も `structured-llm` 内の provider adapter として追加し、runtime lane にはしない。
- 旧 provider import path の一時 re-export は残さず、利用元を `structured-llm` へ移す。

検証:

- `rg "@openai/codex-sdk" api/services/supervisor api/services/structured-llm` が 0 件になる。
- `SupervisorProviderId` に `codex` がない。
- Blueprint / Questionnaire / Supervisor Round 1 / Round 2 は API structured flow を使い続ける。
- structured artifact generation は workspace write capability を持たない。
- `callStructuredJsonLLM(...)` は structured-llm domain から export され、Supervisor loop は provider 実装詳細を import しない。

### Phase 5: run orchestration を lane-neutral にする

目的:

- `startTaskRun(...)` から lane 固有の条件分岐を減らす。

作業:

- lane setup を registry に寄せる。
  - initial Todo builder
  - prompt contract builder
  - runtime options builder
  - lane diagnostics
- `startTaskRun(...)` は次だけを担当する。
  - task / repo validation
  - run creation
  - shared context snapshot 作成
  - lane adapter 起動
  - shared finalizer 実行
- Codex-specific finalization は `codexContract` ではなく shared `runtimeContract` へ保存する。
- Codex 固有表示が必要な UI selector は `runtimeContract.lane === "codex-sdk"` を見て表示する。
- 既存 `codexContract` は read compatibility として残し、新規保存は `runtimeContract` に寄せる。

検証:

- `nightworkers.run-orchestration.service.ts` から Codex 固有 warning normalize 関数を削除できる。
- 第3 lane 追加時、`startTaskRun(...)` の main body を変更しない。
- open Todo finalization guard は全 lane で同じ。
- 旧 run の `contextSnapshot.codexContract` を UI が引き続き読める。

### Phase 6: prompt ownership を整理する

目的:

- AGENTS.md の「Supervisor 実行方針は prompt 側で定義する」に沿って、SystemContext を集約する。

作業:

- Supervisor Round 1 / Round 2 は現行の `prompt-packet.ts` と `skills/registry.ts` を維持する。
- Blueprint / DB Design / Questionnaire / Specification generation は `api/services/structured-generation/prompts/` に集約する。
- 各 service は prompt 本文を直接持たず、prompt builder を呼ぶ。
- 日本語文言は維持する。
- keyword / regex ベースの user intent 分岐を増やさない。

検証:

- `rg "\\[SystemContext\\]|あなたは NightWorkers|あなたは AppBlueprint" api/modules api/services` の結果が prompt builder directory に寄る。
- Supervisor provider は provider call / JSON 抽出 / schema 検証 / 最小互換正規化に限定される。
- artifact generation prompt は structured generation domain に集約される。

## 6. PR 分割

### PR 0: baseline と shared type alias の準備

対象:

- `api/services/agent-runtime/types.ts`
- 新規 `api/services/agent-runtime/shared/*`
- runtime lane tests

完了条件:

- shared type alias が入り、既存 runtime behavior は変わらない。
- baseline test の結果を PR description に残せる。
- shared directory に lane 固有 SDK import がない。

### PR 1: shared runtime contract の導入

対象:

- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/shared/*`
- `api/services/agent-runtime/ledger-sink.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

完了条件:

- `RuntimeContractWarning` と shared event / result 型がある。
- Codex runtime は既存 behavior を変えずに shared 型を使う。
- native runtime も shared 型を参照できる。

### PR 2: Codex SDK lane のファイル分割

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-*`
- 新規 `api/services/agent-runtime/codex-sdk/*`

完了条件:

- `CodexAgentRuntime.ts` は orchestration class だけになる。
- SDK config、event adapter、prompt、audit、import policy、usage extraction が別ファイルになる。
- Codex SDK import は codex-sdk domain に閉じる。

### PR 3: API structured provider から Codex を外す

対象:

- `api/services/structured-llm/*`
- tests under `tests/structured-llm/`
- settings diagnostics

完了条件:

- structured provider dispatcher に Codex branch がない。
- `SupervisorProviderId` に `codex` がない。
- Codex を structured provider として選ぶ UI / settings 文言がない。
- `ACTIVE_LLM_PROVIDER=codex` の旧設定は structured provider ではなく runtime lane compatibility path として処理される。

### PR 4: settings と UI の語彙分離

対象:

- `api/routes/settings-runtime.ts`
- `src/modules/nightworkers/types/provider-settings.ts`
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx`
- runtime lane selector UI

完了条件:

- LLM provider 設定と implementation runtime lane 設定が別 UI になる。
- OpenAI API compatible provider と Codex SDK lane が同じ provider list に並ばない。
- 既存 persisted settings は migration / normalization で読める。

### PR 5: run orchestration の lane-neutral 化

対象:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- runtime lane registry
- Todo initial builder
- finalizer helper

完了条件:

- `startTaskRun(...)` が lane-specific policy を直接持たない。
- 第3 lane は registry 追加で起動できる。
- final Todo guard は全 lane 共通で動く。

### PR 6: structured generation prompt 集約

対象:

- `api/services/blueprints/llm-draft.ts`
- `api/services/blueprints/data-design.ts`
- `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`
- 新規 `api/services/structured-generation/prompts/*`

完了条件:

- SystemContext 相当の文言が prompt builder に集約される。
- 既存 artifact generation の JSON schema / parse / validation behavior は変わらない。

## 7. テスト方針

### Unit tests

- runtime lane resolution
- provider normalization
- shared warning normalize / dedupe
- shared usage normalize
- Codex SDK event adapter
- Codex MCP audit
- import_project terminal policy
- OpenAI compatible structured request body
- Azure OpenAI request URL construction
- prompt builder snapshots

### Integration tests

- native Supervisor lane starts and finalizes with shared closeout guard
- Codex SDK lane starts and emits shared runtime events
- structured artifact generation uses API provider flow
- settings compatibility reads old `ACTIVE_LLM_PROVIDER=codex` without selecting Codex as structured provider

### Regression checks

- `bun x vitest run tests/services.codex-agent-runtime.test.ts`
- `bun x vitest run tests/services.agent-runtime.test.ts`
- `bun x vitest run tests/structured-llm`
- `bun x vitest run tests/nightworkers-service/services-nightworkers-01.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts`
- `bunx biome check api/services/agent-runtime api/services/supervisor api/modules/nightworkers src/modules/nightworkers`

### Static boundary checks

各 PR で次を確認する。

- `rg "@openai/codex-sdk" api/services/agent-runtime/shared api/services/structured-llm api/services/supervisor`
  - Phase 4 完了後は 0 件。
  - Phase 4 完了後は旧 Codex structured provider が残っていないこと。
- `rg "providerClass: 'agent_runtime'|agent_runtime" api/services/supervisor api/services/structured-llm`
  - Phase 4 完了後は 0 件。
- `rg "codexContract" api/modules src/modules api/services`
  - Phase 5 完了後、新規書き込みは `runtimeContract`、旧データ読み取りだけが残る。
- `rg "\\[SystemContext\\]|あなたは NightWorkers|あなたは AppBlueprint" api/modules api/services`
  - Phase 6 完了後、prompt builder directory 以外の新規 SystemContext 文字列が増えない。

## 8. 移行時の互換方針

- 既存 `codex-agent` は external value として当面受け付ける。
- 内部 canonical name は `codex-sdk` に寄せる。
- persisted `ACTIVE_LLM_PROVIDER=codex` は warning 付きで `IMPLEMENTATION_RUNTIME_LANE=codex-sdk` 相当として読めるようにする。
- UI 上は Codex を structured provider として表示しない。
- `CODEX_ENABLED` / `CODEX_ACCESS_TOKEN` / `CODEX_MODEL` は runtime lane settings に移す。
- migration は DB migration ではなく runtime settings normalization から始める。

## 9. 非目標

- 第3 lane 自体は実装しない。
- Codex native command / file_change を全面禁止しない。
- Codex 標準 tool を NightWorkers MCP として再エクスポートしない。
- OpenAI Responses API 移行はこの計画の必須作業にしない。
- Plan mode / Blueprint / DB Design の product flow は変えない。
- queue concurrency / DB schema / desktop packaging は変更しない。
- contextStill の責務を NightWorkers shared domain に混ぜない。

## 10. 禁止事項

- shared domain から `@openai/codex-sdk` を import しない。
- shared domain から OpenAI / Azure / Bedrock request body を組み立てない。
- lane 固有の warning code を shared domain の必須分岐にしない。
- provider 選択で runtime lane を暗黙決定しない。
- runtime lane 追加のために Supervisor provider dispatcher を編集しない。
- prompt 文言を英語の一般論へ置き換えない。
- ユーザー文言の keyword / regex 判定で lane を切り替えない。

## 11. 完了条件

- Codex SDK は runtime lane domain に閉じている。
- OpenAI API 準拠 flow は structured LLM provider domain に閉じている。
- shared domain は lane-neutral な契約、usage、event、Todo、closeout だけを持つ。
- 第3 lane は shared domain を使う adapter として追加できる。
- AGENTS.md の Supervisor / provider / prompt ownership ルールに反しない。
- 既存 Codex lane P0 guard、Todo gate、usage telemetry、import_project hard gate が維持される。

## 12. すぐ着手する最初の実装スライス

最初の実装は PR 0 と PR 1 に限定する。

1. baseline test を実行し、現状を記録する。
2. `api/services/agent-runtime/shared/types.ts` を作る。
3. `RuntimeLaneKind`、`RuntimeLaneEvent`、`RuntimeLaneResult`、`RuntimeContractWarning` を定義する。
4. 既存 `AgentRuntimeKind`、`AgentRuntimeEvent`、`AgentRuntimeResult`、`CodexContractWarning` は shared 型への alias に寄せる。
5. `api/services/agent-runtime/shared/warnings.ts` を作り、warning normalize / dedupe を移す。
6. `CodexAgentRuntime.ts` は behavior を変えずに shared warning helper を使う。
7. `nightworkers.run-orchestration.service.ts` は behavior を変えずに shared warning helper を使う。
8. 次を確認する。
   - `bun x vitest run tests/services.codex-agent-runtime.test.ts`
   - `bun x vitest run tests/services.agent-runtime.test.ts`
   - `git diff --check`

このスライスでは、Codex provider 削除、settings UI 変更、directory rename、prompt 集約は行わない。
