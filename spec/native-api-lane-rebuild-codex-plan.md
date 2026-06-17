# Native/API Lane Rebuild Plan based on Codex

## 1. 結論

現行の `native-supervisor` / experimental `NativeToolRuntime` は、これ以上の小規模 hardening を主軸にしない。

`../codex` の runtime / protocol / tool / turn state 設計を主な手本にして、Codex SDK lane とは完全に分離した `native-api-runner` を新規に作る。既存 Codex lane は触らない。現行 `native-supervisor` / experimental `NativeToolRuntime` は残さず、削除してから作り直す。

理由:

- 直近の失敗は prompt 不足ではなく runtime 構造の問題で発生している。
- provider message / Todo / contextStill / fallback / cancellation が 1 つの loop に混ざり、1 行修正でも別の退行を生んでいる。
- tool call と tool result が durable な履歴要素ではなく、in-memory `messages` 配列へ逐次 push されている。
- native/API lane が失敗すると SchemaFirst fallback や Codex lane 側の設定に近づきやすく、lane 分離が壊れやすい。
- `context_compile` の前提確認、停止要求、Todo 進捗、provider request 形式など、runtime が機械的に守るべき契約を prompt 指示に寄せすぎている。

この計画では、Native/API lane を「Supervisor loop」ではなく「coding agent runner」として作り直す。

今回必要なのは provider-native tool calling の薄い adapter ではなく、coding agent としての turn lifecycle、tool dispatch、cancellation、protocol item、permission/event discipline である。そのため、設計参照は `../codex` に一本化する。

## 2. 触らないもの

明示的に対象外:

- `codex-sdk` lane の挙動変更
- `@openai/codex-sdk` への依存追加
- Codex lane の prompt / event mapper / import policy / MCP audit の変更
- `CodexAgentRuntime` の既存 contract warning 変更
- Workbench intake / plan routing の大規模変更
- `ACTIVE_LLM_PROVIDER=codex` 互換 path の整理

保持対象:

- `api/services/worker-tools/*`
- `api/services/tool-policy/*`
- `api/services/structured-llm/*`
- Task / Run / Todo / `task_events` / `task_run_todos` の既存 DB contract
- Codex SDK lane

削除対象:

- `api/services/agent-runtime/native-tool-runtime/*`
- `NativeAgentRuntime` 内の現行 Supervisor loop / NativeToolRuntime fallback 実行経路
- `experimentalNativeToolRuntime` flag と関連 runtimeOptions
- 現行 native/API 実行核にだけ紐づく tests

Codex lane から取り込むのは考え方だけにする。実装依存や runtime fallback は持ち込まない。

## 3. Codex から採用する設計

`../codex/codex-rs/core/src/tools/router.rs`

- model-visible tool spec と internal dispatch registry を分ける。
- provider item から tool call を組み立て、dispatch は registry に委譲する。
- tool call は provider response の副産物ではなく、runtime が処理する protocol item として扱う。

`../codex/codex-rs/core/src/tools/registry.rs`

- tool runtime は typed contract を持つ。
- pre/post hook、telemetry、cancellation、model-visible output を tool runtime 側で扱う。
- tool execution の成功/失敗は response item 化できる形で返す。
- tool ごとの parallel support、runtime cancellation wait、argument diff consumer を registry 側に閉じる。

`../codex/codex-rs/core/src/tools/context.rs`

- tool invocation は session / turn / cancellation token / call id / tool name / payload を持つ。
- worker tool 実行時に必要な実行 context を provider adapter に混ぜない。

`../codex/codex-rs/protocol/src/models.rs`

- assistant message、function call、tool output、custom tool call などを protocol item として表現する。
- provider response を直接 DB や UI に流さず、runtime protocol に正規化して扱う。

`../codex/codex-rs/app-server/src/thread_state.rs`

- active turn、interrupt、listener、terminal turn を thread state として持つ。
- 停止要求は UI event ではなく runner state に作用する。
- terminal turn と active turn の区別を runtime が所有する。

`../codex/codex-rs/app-server/src/request_processors/turn_processor.rs`

- turn start / steer / interrupt を thread operation として扱う。
- user input admission と実行中 turn の制御を分ける。

`../codex/codex-rs/core/src/tools/runtimes/*`

- shell、apply_patch、unified_exec などは tool handler として独立する。
- tool handler は protocol output を返し、runner が次 turn へ戻す。

これらは Native/API lane の構造設計に使う。Codex SDK 実装そのものは使わない。

## 4. 削除境界

この rebuild は legacy を残さない。

削除するもの:

```text
api/services/agent-runtime/native-tool-runtime/
  native-tool-definitions.ts
  native-tool-executor.ts
  native-tool-result-projection.ts
  native-tool-turn-loop.ts
```

置き換えるもの:

```text
api/services/agent-runtime/NativeAgentRuntime.ts
```

`NativeAgentRuntime` はファイル名を維持してもよいが、中身は現行 Supervisor loop / experimental NativeToolRuntime を削除し、`NativeApiRunner` への薄い adapter にする。あるいは `native-api-runner/native-api-agent-runtime.ts` へ移して registry から参照する。

削除または全面更新する tests:

```text
tests/services.native-tool-turn-loop.test.ts
tests/services.native-tool-runtime.test.ts
tests/services.native-agent-runtime-tool-runtime.test.ts
```

残すもの:

```text
api/services/worker-tools/
api/services/tool-policy/
api/services/structured-llm/
api/services/agent-runtime/codex-sdk/
api/services/agent-runtime/CodexAgentRuntime.ts
api/services/agent-runtime/shared/
```

worker tool 類は現状のまま維持し、Native API runner の tool handler が既存 tool を呼び出す。

## 5. 新しい構成

新規 domain:

```text
api/services/agent-runtime/native-api-runner/
  native-api-agent-runtime.ts
  native-api-runner.ts
  native-api-session-store.ts
  native-api-request-adapter.ts
  native-api-provider-client.ts
  native-api-tool-router.ts
  native-api-tool-registry.ts
  native-api-tool-dispatcher.ts
  native-api-tool-history.ts
  native-api-cancellation.ts
  native-api-events.ts
  native-api-finalization.ts
```

既存 domain との境界:

```text
NightWorkers Task/Run/Todo DB
        |
        v
NativeApiAgentRuntime
        |
        v
NativeApiRunner
        |
        +--> NativeApiSessionStore       durable run/session/turn/tool state
        +--> NativeApiRequestAdapter     canonical provider request
        +--> NativeApiProviderClient     OpenAI-compatible / Anthropic-compatible call
        +--> NativeApiToolRouter         provider tool call -> internal invocation
        +--> NativeApiToolRegistry       model-visible specs + internal handlers
        +--> NativeApiToolDispatcher     worker tool / MCP / Todo / finalize execution
        +--> NativeApiEvents             task_events / timeline projection
```

## 6. 原則

### 6.1 Lane 分離

- `native-api-runner` から `CodexAgentRuntime` を import しない。
- `native-api-runner` から `@openai/codex-sdk` を import しない。
- native/API provider failure 後に Codex lane へ fallback しない。
- native/API provider failure 後に SchemaFirst fallback しない。
- `workerKind` は `native-local` のまま維持する。
- runtime lane の canonical name は `native-api-runner` にする。
- `native-supervisor` は必要なら settings / DB 互換 alias として読むが、実行経路名としては使わない。

### 6.2 Provider request は adapter 境界で正規化する

現行のように loop 内で `ProviderToolMessage[]` を直接 append し続けない。

内部表現:

```ts
type NativeApiHistoryItem =
  | { type: 'system'; content: string }
  | { type: 'user'; content: string; source: 'user' | 'runtime' | 'todo' | 'state_card' }
  | { type: 'assistant'; content: string; toolCalls: NativeApiToolCall[] }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: NativeApiToolResult };
```

provider adapter の責務:

- system を provider 固有の正しい位置/field に移す。
- provider が non-leading system を拒否する場合でも、runner の履歴構造は壊さない。
- OpenAI-compatible / Anthropic-compatible / Bedrock-compatible の tool schema 差分を吸収する。
- request payload を `llm-trace.jsonl` に provider-safe な形で出す。

### 6.3 Tool lifecycle は DB に残す

少なくとも次を durable に保存する。

- `turn_id`
- `tool_call_id`
- `tool_name`
- `arguments_json`
- `status`: `pending` / `running` / `completed` / `failed` / `cancelled`
- `started_at`
- `finished_at`
- `result_json`
- `error_json`
- `model_visible_output`
- `todo_seq`
- `source`: `provider_native` / `runtime_gate` / `user_interrupt`

これにより、resume/retry は in-memory 配列ではなく DB から projected history を再構築して進める。

### 6.4 Todo は prompt ではなく runtime state と同期する

- current Todo は provider message に毎回雑に append しない。
- Todo state は `NativeApiSessionStore` から runner state として読む。
- Todo 更新 tool は mutation のみ model-visible にする。
- `todo_list list` は model-visible tool から外す。内部確認は runner が行う。
- open Todo がある状態の finalize は runtime が機械的に拒否する。
- stop/cancel 後は Todo を skip せず、run terminal state を `cancelled` にする。

### 6.5 contextStill は gate ではなく tool contract にする

- `context_compile` は空 `{}` で呼べない schema にする。
- `goal` は required string にする。
- `read_current_specification` 成功前の `context_compile` は provider へ戻す failed tool result として扱う。
- ただし、この制約は prompt 指示だけでなく dispatcher 側で enforced contract にする。
- `context_compile` failure 後に code review / finalize へ進ませない。必要なら Todo を `needs_human` ではなく recoverable failed tool result として戻す。

### 6.6 Stop / cancel は runner の最優先状態にする

停止判定ポイント:

- provider turn 開始前
- provider stream 中
- tool dispatch 前
- tool dispatch 後
- Todo mutation 前
- finalize 前

stop が入ったら:

- 新規 tool call は実行しない。
- pending tool call は `cancelled` として durable に残す。
- open Todo は勝手に skip / done にしない。
- code review / verify gate へ進まない。
- final state は `cancelled`。

## 7. 実装 Phase

### Phase 0: Delete legacy native/API execution core

目的:

- 現行 native/API 実行核を削除し、fallback で戻れない状態にする。
- worker tool 類は保持し、新 runner の tool handler から再利用する。

作業:

- `api/services/agent-runtime/native-tool-runtime/*` を削除する。
- `NativeAgentRuntime` から `runSupervisorLoop(...)` と `runNativeToolTurnLoop(...)` への分岐を削除する。
- `experimentalNativeToolRuntime` flag と関連 runtimeOptions を削除する。
- 旧 native/API execution tests を削除または新 runner tests に置き換える。
- `resolveAgentRuntime('native-local')` は一時的に skeleton `NativeApiAgentRuntime` を返す。
- skeleton runner は未実装時に明示的な `needs_human` を返し、Codex / SchemaFirst へ fallback しない。

検証:

```sh
bun x vitest run tests/services.agent-runtime-registry.test.ts tests/nightworkers-service/services-nightworkers-01.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
bun run typecheck
```

### Phase 1: Canonical history / provider request adapter

目的:

- provider message 構築を loop から追い出す。
- non-leading system / malformed tool result / schema mismatch を adapter test で潰す。

作業:

- `native-api-tool-history.ts` を追加する。
- `native-api-request-adapter.ts` を追加する。
- `buildNativeApiProviderRequest(...)` を実装する。
- OpenAI-compatible tool call request の fixture test を作る。
- Anthropic-compatible は最初は unsupported reason でもよいが、adapter の型は分ける。

受け入れ条件:

- system message が provider message 配列の途中に入らない。
- current Todo は `system` ではなく runtime context として投影される。
- request adapter 単体 test が provider 別に通る。
- provider request payload の trace で system/user/tool の配置を確認できる。

### Phase 2: DB-backed NativeApiSessionStore

目的:

- in-memory `messages` 依存をやめる。
- resume/retry/cancel を DB から復元できる状態にする。

作業:

- `native_api_turns` / `native_api_tool_calls` 相当の永続化を追加する。
  - 既存 migration 方針に合わせ、テーブル追加か `task_events` projection のどちらかを選ぶ。
- `createTurn`, `appendAssistantMessage`, `recordToolCallStarted`, `recordToolCallFinished`, `projectHistory` を実装する。
- 既存 `task_events` にも timeline 用 event は引き続き出す。

受け入れ条件:

- provider turn 後に process を止めても、tool call history を DB から読める。
- failed tool result が projected history に戻る。
- run cancellation state が provider/tool 実行より優先される。

### Phase 3: Tool registry / dispatcher rebuild

目的:

- model-visible tool spec と internal worker tool dispatch を分離する。
- tool ごとの lifecycle / validation / cancellation を runtime が所有する。

作業:

- `NativeApiToolRegistry` を追加する。
- `NativeApiToolRouter` を追加する。
- `NativeApiToolDispatcher` を追加する。
- worker tools を handler として登録する。
- `todo_list` は mutation operations だけを visible にする。
- `context_compile` は required schema と prerequisite を dispatcher で enforce する。
- `finalize_answer` は open Todo / cancellation / failed required gate を確認してから通す。

受け入れ条件:

- provider が `context_compile {}` を出しても dispatcher が拒否し、runner が次 turn に recoverable tool result を返す。
- provider が stop 後に tool call を返しても実行されない。
- `todo_list list` が model-visible tool として出ない。
- open Todo がある `finalize_answer` は機械的に拒否される。

### Phase 4: NativeApiRunner turn loop

目的:

- 新しい runner で provider/tool/finalize の最小 loop を動かす。

作業:

- `NativeApiRunner.run(...)` を実装する。
- loop は以下だけにする。
  1. cancellation check
  2. projected history load
  3. provider request build
  4. provider call
  5. tool call persist
  6. tool dispatch
  7. tool result persist
  8. finalize or next turn
- SchemaFirst fallback を入れない。
- Codex fallback を入れない。
- max turns 到達時は `needs_human` にする。

受け入れ条件:

- provider 400/404 は `needs_human` または recoverable provider error で終わる。別 lane へ逃げない。
- tool call なしの初回 response は unsupported ではなく `needs_human` として扱うか、明示的な final text policy に従う。
- run event ledger で provider turn / tool lifecycle / cancellation が追える。

### Phase 5: NativeAgentRuntime integration

目的:

- 既存 NightWorkers 外枠へ新 runner を差し込む。

作業:

- `NativeAgentRuntime.start(...)` は `NativeApiRunner` だけを呼ぶ薄い adapter にする。
- `resolveRuntimeLaneDefinition(...)` で canonical `native-api-runner` を扱う。
- 旧 `native-supervisor` 設定値は互換 alias として `native-api-runner` に正規化する。
- route が `codex` の場合は native runner を選ばない。
- route が API/local provider の場合だけ native runner を選ぶ。

受け入れ条件:

- Codex lane run は既存 `CodexAgentRuntime` を通る。
- native/API lane run は `NativeApiRunner` を通る。
- `IMPLEMENTATION_RUNTIME_LANE=codex-sdk` があっても API provider route なら native/API が Codex SDK に逃げない既存方針を維持する。

### Phase 6: Live smoke

目的:

- 実際の失敗パターンを潰せたか確認する。

対象シナリオ:

- `context_compile` Todo で先に `read_current_specification` を実行する。
- `context_compile {}` を出した場合、failed tool result から復旧できる。
- stop ボタンで provider/tool/finalize が止まる。
- Todo を skip せず `cancelled` になる。
- apply_patch failure 後に同じ patch を繰り返さない。
- open Todo がある状態で finalize できない。
- provider 400/404 後に Codex lane / SchemaFirst へ fallback しない。

確認する source of truth:

- `logs/api.log`
- `logs/llm-trace.jsonl`
- `task_runs`
- `task_events`
- `task_run_todos`
- native-api-runner session/tool state table または projection

## 8. 既存計画との関係

`spec/native-supervisor-evidence-runtime-hardening-plan.md`

- 現行 loop 延命としては使わない。
- evidence 型や recovery directive の考え方だけを `NativeApiToolResult` へ移植してよい。
- legacy Supervisor loop は削除対象に含める。

`spec/native-api-lane-tool-runtime-plan.md`

- Superseded。
- provider-native tool runtime の incremental 改修は打ち切る。
- 実装計画としては使わない。

`spec/runtime-lane-domain-separation-plan.md`

- lane 分離の方針は維持する。
- `native-api-runner` はこの計画の native/API domain として追加する。
- Codex SDK domain には入れない。

## 9. 最初に実装するべき順番

優先度順:

1. Phase 0: delete legacy native/API execution core
2. Phase 1: canonical history / request adapter
3. Phase 2: DB-backed session/tool lifecycle
4. Phase 3: tool registry / dispatcher
5. Phase 4: runner loop
6. Phase 5: integration
7. Phase 6: live smoke

これを飛ばして prompt や current Todo message を直し続けると、また provider message 形式、停止、Todo、contextStill のいずれかで退行する。

## 10. 実装しない修正

以下はやらない。

- `context_compile` を prompt で「空で呼ぶな」とさらに強く書く。
- current Todo を毎 turn provider message に追加し続ける。
- provider 失敗時に SchemaFirstAgent へ fallback する。
- native/API lane 失敗時に Codex SDK lane へ fallback する。
- `todo_list list` を model-visible tool として残して、prompt で使うなと指示する。
- stop 後の挙動を prompt に任せる。
- worker tool 実行を provider adapter に混ぜる。
- 旧 `native-tool-runtime` を fallback として残す。
- `experimentalNativeToolRuntime` flag で新旧を併存させる。

## 11. 完了条件

`native-api-runner` を既定値にできる条件:

- unit tests:
  - request adapter
  - session projection
  - tool router
  - context_compile prerequisite
  - todo mutation/finalize guard
  - cancellation
  - provider failure no fallback
- integration tests:
- `NativeAgentRuntime` が API provider route で `NativeApiRunner` を選ぶ。
  - Codex route では `CodexAgentRuntime` が選ばれる。
  - Codex SDK import が native-api-runner 配下に存在しない。
- live smoke:
  - latest log / DB / trace で provider turn、tool calls、Todo、cancel が追える。
  - stop ボタンで cancelled になり、review / verify gate へ進まない。
  - `context_compile` が仕様読解後に具体 goal 付きで呼ばれる。
  - 実装 Todo が 1 行で終わらず、必要な read/edit/test を実行する。

## 12. 推奨判断

次の実装候補は、現行 `native-tool-turn-loop.ts` の追加修正ではなく、この `native-api-runner` の Phase 0-3。

まず作るべき PR 単位:

1. legacy native/API execution core の削除と `native-api-runner` skeleton
2. canonical history / provider request adapter
3. session/tool lifecycle store
4. tool registry / dispatcher with `context_compile` and Todo contracts

この 4 つが入るまで、live agent としての改善判定はしない。現行 loop にさらに prompt や 1 行 guard を積むのは、改善ではなく退行リスクの追加になる。
