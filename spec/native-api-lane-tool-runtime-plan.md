# Native/API Lane Tool Runtime 実装計画

> Status: Superseded.
>
> この計画は `spec/native-api-lane-rebuild-codex-plan.md` に置き換えられた。
> 現行方針では、native/API lane の抜本改修は Codex の runtime / protocol / tool / turn state 設計を主参照にする。
> このファイルは過去調査の記録として残し、次の実装計画としては使わない。

## 1. 目的

`native-supervisor` / API provider 経由の implementation lane で、実装力が不足する問題を改善する。

現状の native lane は、Supervisor Round 2 で LLM に `toolCall` JSON を1つ返させ、NightWorkers の `executeWorkerTool(...)` がそれを実行する。この構造は動くが、provider の native tool calling / streaming tool result / tool-result continuation を十分に使っていないため、読み取りや Todo 更新に寄り、実装・検証へ進む力が弱くなりやすい。

この計画では、opencode の実装から転用できる設計を参考にし、NightWorkers の既存境界を崩さずに `worker tool` を provider-native tool runtime として扱える実験的実行経路を追加する。

## 2. opencode 調査から得た解決策

### 2.1 tool definition と executor を同じ registry で扱う

opencode は `ToolRegistry` で built-in / plugin tool を集約し、`SessionTools.resolve(...)` が provider へ渡す tool schema と executor を同時に構築する。

参考:

- `/Users/y.noguchi/Code/opencode/packages/opencode/src/tool/registry.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/tools.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/tool/tool.ts`

NightWorkers への転用:

- `api/services/supervisor/prompt-tool-registry.ts` の `ToolDefinition` と `api/services/worker-tools/dispatcher.ts` の executor を、provider-native tool 用 adapter から同じ source of truth として参照する。
- `read_file`, `search_files`, `apply_patch`, `replace_content`, `run_verification`, `todo_list`, `finalize_answer` をまず対象にする。
- tool schema だけを prompt へ文字列で埋める経路と、provider-native tools として渡す経路を同じ registry 入力から生成する。

### 2.2 native runtime でも executor を別物にしない

opencode の native runtime は、AI SDK tool を `@opencode-ai/llm` の native tool に再ラップし、provider の tool call を同じ executor へ dispatch する。

参考:

- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/llm/native-runtime.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/llm/native-request.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/llm.ts`

NightWorkers への転用:

- `structured-llm` provider adapter に worker tool 実行判断を分散させない。
- runtime lane 側で `WorkerToolRuntime` を作り、provider-native tool call を `executeWorkerTool(...)` に接続する。
- provider が native tool calling をサポートしない場合だけ、現行 Round 2 JSON toolCall loop に fallback する。

### 2.3 tool result を履歴へ戻して継続する

opencode は tool call / tool result を session processor で処理し、tool result を次 provider turn に戻して loop を継続する。これにより、LLM は「次の JSON toolCall を推測する」のではなく、実際の tool result を会話履歴として受け取って次の作業に進む。

参考:

- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/prompt.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/processor.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/session/llm/ai-sdk.ts`

NightWorkers への転用:

- native/API lane に、tool result を provider message として戻す `NativeToolTurnLoop` を追加する。
- 既存の `toolResults`, run event ledger, Todo state は維持する。
- provider message 履歴は runtime 内部の ephemeral history とし、DB の Task / Run / Todo source of truth を置き換えない。

### 2.4 API 入口も同じ runner に接続する

opencode の HTTP API は `SessionPrompt.Service` を呼ぶだけで、CLI と API で別の実装力に分岐していない。

参考:

- `/Users/y.noguchi/Code/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `/Users/y.noguchi/Code/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`

NightWorkers への転用:

- Workbench / API / background run が使う implementation runtime を同じ lane adapter に寄せる。
- API provider adapter は provider call に集中し、workspace edit / verification / Todo mutation は runtime lane の worker tool runtime に限定する。

## 3. NightWorkers の現状

主要な既存境界:

- `api/services/agent-runtime/NativeAgentRuntime.ts`
  - `native-local` runtime の入口。
  - Hooks / contextStill gate / `runSupervisorLoop(...)` への受け渡しを持つ。
- `api/services/supervisor/supervisor-loop.ts`
  - Round 1 で jobType / goal を決める。
  - Round 2 以降で JSON `toolCall` を1つ受け取り、validation 後に worker tool を実行する。
- `api/services/supervisor/prompt-tool-registry.ts`
  - LLM-visible tool definitions を持つ。
- `api/services/worker-tools/dispatcher.ts`
  - 実際の worker tool executor を持つ。
- `api/services/structured-llm/*`
  - Supervisor / planning / structured JSON generation の provider adapter。
- `api/services/agent-runtime/runtime-lane.ts`
  - `native-supervisor` と `codex-sdk` の runtime lane 解決を持つ。

問題:

- tool schema と executor の接続は runtime 内部の型として閉じていない。
- provider-native tool calling を使わず、JSON structured output で toolCall を1つ選ばせている。
- tool result は `toolResults` と prompt 再構成には入るが、provider-native tool result continuation ではない。
- `structured-llm` は structured JSON generation の責務を持つため、ここへ workspace tool execution 判断を足すと既存ルールに反する。

## 4. 目標状態

### 4.1 短期目標

- `native-supervisor` の既存挙動を壊さない。
- experimental flag 付きで provider-native worker tool runtime を追加する。
- worker tool 実行は必ず `executeWorkerTool(...)` 経由にする。
- Todo / run event ledger / closeout gate / review / verify gate は既存契約を維持する。
- provider-native tool path が使えない provider では現行 Round 2 JSON loop に fallback する。

### 4.2 中期目標

- `native-supervisor` の Round 2 実装力を、prompt 指示ではなく runtime 構造で改善する。
- tool call / tool result / final answer を provider-native loop の一級要素にする。
- `api/services/supervisor/prompt-tool-registry.ts` と `api/services/worker-tools/dispatcher.ts` を、文字列 prompt 用と provider-native tool 用の共通 source of truth として扱う。

### 4.3 長期目標

- API provider 経由でも Codex lane ほどではない実装実行力を持つ。
- provider-native tool runtime と Codex SDK lane は別 lane として維持する。
- `structured-llm` は structured JSON generation に限定し、workspace tool execution runtime にはしない。

## 5. 非目標

- Codex SDK lane の置き換え。
- `structured-llm` provider に用途別 SystemContext や workspace tool 実行判断を追加すること。
- Supervisor Round 1 / Round 2 prompt を英語の汎用 agent prompt に置き換えること。
- Todo / closeout gate / review / verify gate を bypass すること。
- worker tool を対象 repo 側 MCP として配置すること。
- 既存の `native-supervisor` を一度に削除すること。
- provider-native tool calling 未対応 provider で無理に新 runtime を使うこと。
- UI redesign。

## 6. 設計方針

### 6.1 runtime lane に置く

provider-native worker tool runtime は `agent-runtime` domain に置く。`structured-llm` は provider 呼び出し、JSON 抽出、schema 検証、互換正規化に留める。

候補配置:

```text
api/services/agent-runtime/native-tool-runtime/
  native-tool-definitions.ts
  native-tool-executor.ts
  native-tool-turn-loop.ts
  native-tool-provider-adapter.ts
  native-tool-events.ts
  native-tool-result-projection.ts
```

### 6.2 既存 worker tools を executor として再利用する

`executeWorkerTool(...)` を直接の実行入口にする。

provider-native tool runtime は次だけを行う。

- provider-facing tool schema を作る。
- provider の tool call input を schema validate する。
- `executeWorkerTool(...)` へ渡す。
- `WorkerToolResult` を provider-facing tool result と run event ledger payload へ投影する。
- Todo / final answer / verification gate の既存 closeout 契約を守る。

### 6.3 provider support を明示的に判定する

provider-native tool runtime は、provider / model capability を見て opt-in する。

初期対象候補:

- OpenAI Responses / Chat Completions compatible で tool calling が安定している route。
- Anthropic compatible tool use が既存 adapter で扱える route。

未対応の場合:

- `native_tool_runtime_unavailable` を warning-only で run event に残す。
- 現行 Round 2 JSON loop に fallback する。

### 6.4 tool result continuation を短く保つ

provider に戻す tool result は、完全な stdout / file body を常に返さない。

方針:

- `WorkerToolResult.summary` と重要 metadata を優先する。
- `read_file` は必要行だけ、または compressed payload を使う。
- `run_verification` は exit code、command、stdout/stderr preview、artifact path を分ける。
- complete evidence は DB event / existing payload に残す。

## 7. 実装順

```text
R1 Worker tool definition adapter を作る
R2 Provider-native tool executor bridge を作る
R3 Experimental native tool turn loop を作る
R4 NativeAgentRuntime から opt-in できるようにする
R4.5 Todo evidence attribution hardening を入れる
R5 Tool result projection と evidence 保護を強化する
R6 Fallback / warning / observability を入れる
R7 API / Workbench 経路で同じ runtime を使うことを確認する
```

## 7.1 実装状況

- R1: 実装済み。
  - `api/services/agent-runtime/native-tool-runtime/native-tool-definitions.ts`
  - `ToolDefinition` から provider-native tool definition を生成する。
  - `todo_list` は control、`finalize_answer` は terminal、dispatcher 対象 tool は worker として分類する。
- R2: 実装済み。
  - `api/services/agent-runtime/native-tool-runtime/native-tool-executor.ts`
  - worker tool call を `executeWorkerTool(...)` 経由で実行する。
  - `todo_list` と `finalize_answer` は dispatcher に流さず、後続 turn loop が処理する制御結果として返す。
- R3: 実装済み。
  - `api/services/agent-runtime/native-tool-runtime/native-tool-turn-loop.ts`
  - provider-native tool call を複数 turn で往復させ、worker tool result を次 provider turn の `tool` message として返す。
  - `todo_list` は turn loop 内で既存 `todoListTool(...)` を呼び、`finalize_answer` は open Todo が残る場合に拒否して provider に継続させる。
  - provider transport は `api/services/structured-llm/providers.ts` の `callProviderToolTurn(...)` として通常 JSON 経路と分離した。現時点の live support は OpenAI / OpenAI-compatible chat completions の `tools` のみ。
- R4: 実装済み。
  - `api/services/agent-runtime/NativeAgentRuntime.ts`
  - `NIGHTWORKERS_EXPERIMENTAL_NATIVE_TOOL_RUNTIME=true|1` または `runtimeOptions.experimentalNativeToolRuntime=true` のとき、contextStill gate 後に NativeToolTurnLoop を試す。
  - unsupported provider または初回 native tool call 不成立では現行 `runSupervisorLoop(...)` へ fallback する。
- R4.5: 実装済み。
  - `api/services/supervisor/supervisor-loop-types.ts`
  - `api/services/supervisor/supervisor-loop-helpers.ts`
  - `api/services/supervisor/supervisor-loop.ts`
  - worker tool result に `observedTodoSeq` / `attributedTodoSeq` を付け、read-only Todo 中に実行された `import_project` / `copy_directory` / mutation tool を次の mutation Todo の evidence として扱う。
  - `todo_list operation=done` の evidence gap は `ask_user` ではなく `advance_current_todo` recovery として projection し、同じ `done` の繰り返しを抑制する。
- R5: 実装済み。
  - `api/services/agent-runtime/native-tool-runtime/native-tool-result-projection.ts`
  - provider-facing tool result は bounded JSON にし、`NativeToolEvidence` の `recoveryDirective` / `doNotRepeat` / `criticalEvidence` / attribution を含める。
  - complete payload は worker result / DB event 側に残し、provider へは必要な復旧指示を短く返す。
- R6: 実装済み。
  - `NativeAgentRuntime` が experimental native tool runtime 選択時に `native_tool_runtime_selected` trace と info warning event を残す。
  - unsupported / thrown failure は `native_tool_runtime_fallback` trace と warning event を残して現行 `runSupervisorLoop(...)` へ一度 fallback する。
  - provider-native turn failure は `NATIVE_TOOL_RUNTIME_PROVIDER_FAILED` warning として ledger に残す。
  - 注意: role routing に fallback endpoint が未設定の場合は `NO_PROVIDER_FALLBACK_CONFIGURED` を ledger に残す。
- R7: 実装済み。
  - `api/modules/nightworkers/nightworkers.run-orchestration.service.ts` の runtime lane 解決で、implementation role route が non-Codex API provider の場合は `native-supervisor` を選ぶようにした。
  - `IMPLEMENTATION_RUNTIME_LANE=codex-sdk` が残っていても、implementation route が API/local provider なら native/API lane を優先し、Codex SDK に逃げない。
  - `effectiveLlmRouting` は provider route 診断として残し、実行 runtime は `runtimeLaneResolution` に `role_route` source として明示する。
  - `api/services/structured-llm/*` で role route fallback 候補を列挙し、primary provider の transport / timeout / 5xx / 429 系失敗時に次の fallback route へ実行時 retry する。
  - fallback 実行時は `model.route_fallback_scheduled` / `model.route_fallback_started`、fallback 不在時は `model.route_fallback_unavailable` を run event に残す。
- R8 以降: 未実装。
  - runtime settings / UI 露出、API / Workbench 経路での追加確認は後続で扱う。

## 8. R1 Worker tool definition adapter

### 目的

既存 `ToolDefinition` から provider-native tool schema を生成できるようにする。

対象:

- `api/services/supervisor/prompt-tool-registry.ts`
- 新規 `api/services/agent-runtime/native-tool-runtime/native-tool-definitions.ts`
- tests: `tests/services.native-tool-runtime.test.ts`

作業:

- `ToolDefinition` を読み取り、provider-native tool definition へ変換する helper を作る。
- 初期対象 tool を allowlist で限定する。
- `finalize_answer` は executor ではなく loop termination signal として扱う。
- `todo_list` は public MCP schema と native Supervisor 内部 schema の違いを保つ。

初期対象 tool:

- `read_current_specification`
- `read_file`
- `search_files`
- `apply_patch`
- `replace_content`
- `run_verification`
- `todo_list`
- `finalize_answer`

確認観点:

- prompt 用 schema と provider-native schema が同じ定義から生成される。
- `todo_list operation=list` を native Supervisor progress tool として露出しない既存制約が維持される。
- `finalize_answer` は worker tool dispatcher に渡されない。

完了条件:

- 対象 tool の provider-native schema snapshot が安定している。
- 未対象 tool は明示的に除外される。

## 9. R2 Provider-native tool executor bridge

### 目的

provider の tool call を `executeWorkerTool(...)` に接続する。

対象:

- `api/services/worker-tools/dispatcher.ts`
- 新規 `api/services/agent-runtime/native-tool-runtime/native-tool-executor.ts`
- 新規 `api/services/agent-runtime/native-tool-runtime/native-tool-events.ts`

作業:

- tool call context を定義する。
  - `runId`
  - `taskId`
  - `repoRoot`
  - `safetyPolicy`
  - `readFiles`
  - `toolContext`
  - `currentTodo`
- provider tool name を `WorkerToolName | todo_list | finalize_answer` へ validate する。
- `executeWorkerTool(...)` の結果を `WorkerToolResult` と provider-facing output へ変換する。
- run event ledger へ `tool_call_started` / `tool_call_finished` を投影する。
- `readFilesChanged` を loop state に戻す。

確認観点:

- worker tool execution は dispatcher 以外から直接行われない。
- safetyPolicy / allowed paths / denied paths が維持される。
- failed tool result は model-visible tool result と ledger の両方に残る。

完了条件:

- `read_file`, `apply_patch`, `run_verification` の成功 / 失敗が provider-facing tool result へ変換できる。

## 10. R3 Experimental native tool turn loop

### 目的

LLM に1回ごとの JSON toolCall を返させるのではなく、provider-native tool call / tool result continuation を使う experimental loop を作る。

対象:

- 新規 `api/services/agent-runtime/native-tool-runtime/native-tool-turn-loop.ts`
- `api/services/structured-llm/providers.ts` または provider call adapter の最小 extension
- tests: provider fixture / fake stream tests

作業:

- `NativeToolTurnLoopInput` を定義する。
  - system prompt
  - messages
  - available tools
  - model target
  - max steps
  - abort signal
- provider が返す tool call を逐次実行する。
- tool result を次 provider turn に戻す。
- `finalize_answer` tool call で terminal result を作る。
- max steps / max tool calls / timeout を既存 `runSupervisorLoop` と同等以上に守る。

設計制約:

- ここで Round 1 jobType selection を置き換えない。
- 初期版は Round 2 以降だけを experimental にする。
- provider-native loop が失敗した場合は、同じ run で無限 fallback しない。失敗理由を記録し、必要なら現行 loop へ一度だけ fallback する。

確認観点:

- tool result が次 turn の context に入る。
- `apply_patch` 成功後に `read_file` または `run_verification` へ進める。
- `finalize_answer` 前に open Todo がある場合は既存 closeout guard が止める。

完了条件:

- fake provider で `read_file -> apply_patch -> run_verification -> finalize_answer` が1 run 内で完了する。

## 11. R4 NativeAgentRuntime opt-in

### 目的

既存 `native-supervisor` を壊さず、experimental flag で新 loop を選べるようにする。

対象:

- `api/services/agent-runtime/NativeAgentRuntime.ts`
- `api/services/agent-runtime/registry.ts`
- `api/services/agent-runtime/runtime-lane.ts`
- runtime settings / env flag reader

作業:

- `native-supervisor` lane の中に experimental mode を追加する。
- canonical lane name は変えない。
- `workerKind` は `native-local` のまま維持する。
- `runtimeLaneResolution` に `nativeToolRuntime: enabled | disabled | fallback` を metadata として残す。
- unsupported provider では現行 `runSupervisorLoop(...)` へ fallback する。

確認観点:

- Codex SDK lane は変更されない。
- Role Routing の implementation route は従来通り lane selection に使われる。
- flag off では完全に現行挙動になる。

完了条件:

- unit test で flag on/off の runtime selection が確認できる。
- existing native Supervisor regression tests が flag off で通る。

## 12. R5 Tool result projection と evidence 保護

### 目的

provider-native loop に渡す tool result と、NightWorkers の evidence / Progress Context / StateCard を一致させる。

対象:

- `api/services/supervisor/supervisor-loop-helpers.ts`
- `api/services/conversation-context/*`
- `api/services/run-events/*`
- 新規 `native-tool-result-projection.ts`

作業:

- `WorkerToolResult` から provider-facing output を生成する。
- `NativeToolEvidence` があれば provider-facing output に復旧指示を短く含める。
- complete payload は DB event に残し、provider-facing text は bounded にする。
- `apply_patch` / `replace_content` failure は、同じ失敗を繰り返さないための `doNotRepeat` と `nextConcreteAction` を保持する。

確認観点:

- PromptBudget / StateCard 圧縮で critical evidence が落ちない。
- provider-facing output が巨大化しない。
- exact stdout/stderr が必要な verification では DB payload に残る。

完了条件:

- failed patch から target read once / corrected patch へ進む fake-provider test が通る。

## 13. R6 Fallback / warning / observability

### 目的

experimental runtime の状態をログ・DB・UI から診断できるようにする。

対象:

- `logs/llm-trace.jsonl`
- `logs/supervisor-trace.log`
- `task_events`
- `llm_usage_records`
- activity repository / timeline projection

作業:

- runtime selection を trace に残す。
  - `native_tool_runtime_selected`
  - `native_tool_runtime_unsupported`
  - `native_tool_runtime_fallback`
- provider-native tool call の started / finished / failed を event ledger に残す。
- usage は provider measured usage と prompt estimate を混ぜない。
- fallback reason を `runtimeLaneResolution.diagnostics` に残す。

確認観点:

- 最新ログと DB row から、どちらの runtime path を使ったか分かる。
- provider-native path の失敗が固定エラー文だけで潰れない。
- LLM から本文が返った場合は、parse/schema 失敗でも実装側の固定文へ差し替えない。

完了条件:

- fake unsupported provider で fallback reason が trace / DB event に残る。

## 14. R7 API / Workbench 経路確認

### 目的

Workbench 経由、API 経由、background run 経由で実装力が分岐しないことを確認する。

対象:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/modules/nightworkers/routes/run-routes.ts`
- `api/modules/nightworkers/nightworkers.run-query.service.ts`
- route tests

作業:

- implementation run の runtime context が同じ `NativeAgentRuntime` を通ることを確認する。
- API route 専用の低能力 shortcut がないことを確認する。
- experimental flag が route 経由 run にも反映されることを確認する。

確認観点:

- Workbench からの run と API からの run で `runtimeLaneResolution` が同じ形になる。
- UI 表示は provider-native runtime を誇張せず、diagnostic metadata として扱う。

完了条件:

- route test で runtime metadata と fallback metadata が確認できる。

## 15. 推奨する最初の PR 粒度

### PR 1: plan / schema adapter only

- この計画書を追加する。
- `ToolDefinition` から provider-native schema を生成する pure helper を追加する。
- executor や runtime behavior は変えない。

### PR 2: executor bridge with fake calls

- provider call なしで `executeWorkerTool(...)` bridge をテストする。
- run event projection まで確認する。
- runtime selection はまだ変えない。

### PR 3: fake provider native loop

- fake provider で tool call / tool result continuation を確認する。
- real provider は使わない。
- `native-supervisor` default は変えない。

### PR 4: experimental flag integration

- flag on の時だけ NativeAgentRuntime から new loop を選べるようにする。
- unsupported provider fallback を入れる。
- live E2E は別計画または手動検証に分ける。

## 16. リスクと対策

### 16.1 provider adapter が肥大化する

対策:

- provider adapter は tool-call transport までに留める。
- workspace tool execution 判断は runtime lane の `native-tool-runtime` に置く。

### 16.2 Todo / closeout gate を bypass する

対策:

- `finalize_answer` は provider-native tool として見せても、terminal result 化の前に既存 Todo gate を確認する。
- open Todo がある場合は model-visible tool result として closeout rejection を返し、loop 継続または needs_human にする。

### 16.3 context が巨大化する

対策:

- provider-facing tool result と DB evidence payload を分ける。
- stdout/stderr / file content は bounded preview にする。
- complete evidence は DB event payload に残す。

### 16.4 現行 native Supervisor regression を壊す

対策:

- flag off で現行 path を完全維持する。
- `runtimeLane` canonical name は変えない。
- existing tests は flag off で通す。

### 16.5 Codex lane と混同する

対策:

- Codex SDK lane は触らない。
- provider-native worker tool runtime は `native-supervisor` lane の experimental mode として扱う。
- Codex MCP audit / import_project terminal policy をここへ移植しない。

## 17. 検証計画

### Unit

- tool schema adapter
- executor bridge
- provider-facing output projection
- fallback reason generation
- final answer Todo gate rejection

### Integration

- fake provider:
  - `read_file -> apply_patch -> run_verification -> finalize_answer`
  - `apply_patch failed -> read_file once -> corrected apply_patch`
  - `todo_list replace -> implementation tool -> todo_list done -> verification -> finalize_answer`
- unsupported provider fallback
- abort / timeout

### Regression

- existing supervisor loop tests with flag off
- existing worker tool tests
- runtime lane registry tests
- run orchestration route tests
- conversation context / prompt budget tests for critical evidence

### Live E2E

Live provider E2E は最後に別タスクとして行う。

最低限確認すること:

- provider-native tool call が実際に出る。
- worker tool が dispatcher 経由で実行される。
- tool result が次 turn に戻る。
- verification evidence と final report が DB / logs に残る。

## 18. 完了条件

- flag off で現行 native Supervisor behavior が維持される。
- flag on で provider-native tool runtime が fake provider test を通る。
- worker tool execution は dispatcher 経由に限定される。
- Todo / review / verify / knowledge / final report gate が維持される。
- unsupported provider では fallback reason が記録され、現行 loop へ戻る。
- `structured-llm` provider に workspace execution 判断が増えていない。
