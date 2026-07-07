# ContextStill Token Optimization Refactor Plan

## Purpose

NightWorkers の runtime prompt / SystemContext / Todo gate から、`contextStill.initial_instructions` で得られる tool 情報の再掲を減らし、model-visible token 使用量を下げる。

この計画の中心は、contextStill tool の意味や詳細な運用ルールを NightWorkers 側で説明し直さないことにある。contextStill tool の source truth は `initial_instructions` の結果に寄せ、NightWorkers 側には NightWorkers 固有の実行順序、Todo gate、closeout 条件だけを残す。

あわせて、`register_candidates` は標準導線から外す。`compile_eval` は `context_compile` を使った run の評価として必須 closeout action にし、final assistant report 直前の runtime closeout gate として維持する。

## Confirmed Baseline

現状の主な重複と固定 gate は次の通り。

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
  - `NightWorkers MCP:` で contextStill 初期化に触れている。
  - `Minimal implementation behavior:` 内で `compile_eval`、managed gate、`register_candidates` 由来の知識登録 gate を説明している。
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
  - provider-visible tool guidance として contextStill gate、Todo gate、closeout guidance を再掲している。
- `api/services/todo-runtime/todo-list-builder.ts`
  - `initial_instructions` と `context_compile` を first gates として追加している。
  - `knowledge_capture` を `contextstill.register_candidates` 固定 gate として追加している。
  - `completion_report` を final assistant report 用 gate として追加している。
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
  - `context_initial_instructions`、`context_compile`、`context_decision`、`compile_eval`、`register_candidates` の model-visible tool descriptions を持つ。
  - implementation lane では one-shot tool を current Todo / procedure に応じて露出する。
- `api/services/agent-runtime/native-api-runner/native-api-closeout-controller.ts`
  - `compile_eval` を runtime closeout gate として実行する。

## Non-goals

- contextStill MCP server の tool schema や `initial_instructions` 本体は変更しない。
- `context_compile` 自体を削らない。
- `context_decision` を削らない。
- `compile_eval` を任意化または削除しない。`context_compile` を使った run の必須 closeout action として扱う。
- TodoList 全体の設計や Review / Verification gate の再設計はしない。
- `register_candidates` tool 本体の廃止判断はしない。今回は NightWorkers の標準導線、固定 Todo、model-visible closeout 手順から外す。

## Target Behavior

### Runtime Contract

NightWorkers runtime contract は、contextStill tool の詳細説明を再掲しない。

残す文意:

```text
ContextStill:
- contextStill tool の詳細な使い方は initial_instructions の結果を source truth とする。
- NightWorkers は initial_instructions / context_compile の実行順序と Todo gate だけを管理する。
- context_compile を使った run では final assistant report 直前に compile_eval を必ず実行する。
```

削る文意:

- `context_compile` の `goal` の書き方。
- `context_decision` の pre-question gate / reject / feedback の詳細。
- `register_candidates` の日本語 body、procedure format、candidate 登録作法。
- `compile_eval` の評価項目や `No Content` 例外の詳細。

### Todo Gates

標準 implementation TodoList は次の固定 gate にする。

```text
1. initial_instructions
2. context_compile
... implementation / review / verification ...
N. completion_report
```

`knowledge_capture` は標準固定 gate から外す。

`completion_report` は contextStill tool ではなく、NightWorkers 側の final assistant report sentinel として残す。

### Compile Eval

`compile_eval` は Todo の `knowledge_capture` には紐づけない。

Native API runner では、既存の closeout controller が final report 直前に `compile_eval` を必須 action として実行する責務を維持する。

Codex SDK lane では、runtime contract に最小限の実行タイミングだけを残す。

```text
- context_compile を使った run では、final assistant report 直前に compile_eval を必ず実行する。
- Todo 作成直後、context_compile 直後、未完了 Todo が残る間は compile_eval を実行しない。
```

### Register Candidates

`register_candidates` は標準 Todo / closeout gate / model-visible closeout 導線から外す。

初期実装では代替 gate を作らない。NightWorkers は `register_candidates` を毎 run の固定 Todo、標準 closeout 手順、または通常の provider-visible 導線として要求しない。

## Implementation Plan

### Phase 0. Baseline Snapshot

Purpose:

変更前の token 削減対象と fixed gate behavior をテストで固定する。

Files:

- `tests/codex-agent-runtime/config-prompt.cases.ts`
- `tests/native-api-runner/dispatcher-gates.cases.ts`
- `tests/services.todo-list-builder.test.ts`
- `tests/services.native-api-runner-closeout.test.ts`

Checks:

- runtime contract に `context-still.initial_instructions`、`context-still.compile_eval`、`register_candidates` 関連文言がどれだけ含まれるかを snapshot 的に確認する。
- standard TodoList に `knowledge_capture` が含まれている現状を確認する。
- closeout controller の `compile_eval` 実行テストが既にあることを確認する。

Expected before refactor:

- runtime contract に contextStill tool guidance の再掲が複数ある。
- standard TodoList に `knowledge_capture` が含まれる。
- `compile_eval` closeout test は通る。

Gate:

```bash
bun run test run tests/codex-agent-runtime/config-prompt.cases.ts tests/services.todo-list-builder.test.ts tests/services.native-api-runner-closeout.test.ts
```

### Phase 1. Runtime Contract を短縮する

Purpose:

contextStill tool の意味説明を NightWorkers runtime contract から削り、source truth を `initial_instructions` に寄せる。

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/codex-agent-runtime/config-prompt.cases.ts`

Edits:

- `NightWorkers MCP:` section を短くする。
- `Minimal implementation behavior:` から contextStill tool 詳細の再掲を削る。
- `compile_eval` の必須タイミングだけを残す。
- managed gate の説明は `initial_instructions / context_compile / completion_report` の最小説明にする。
- `knowledge_capture` と `register_candidates` を closeout 必須文脈から削る。

Post-change wording target:

```text
ContextStill:
- contextStill tool の詳細な使い方は initial_instructions の結果を source truth とする。
- initial_instructions / context_compile は NightWorkers-managed startup gates です。
- completion_report は NightWorkers-managed final report gate です。
- context_compile を使った run では、final assistant report 直前に compile_eval を必ず実行する。
```

Verification:

- prompt tests が新しい短縮文言を期待する。
- prompt tests は削除した詳細文言を `not.toContain` で確認する。
- `compile_eval` の final report 直前必須ルールは残る。

### Phase 2. `knowledge_capture` 固定 Todo を外す

Purpose:

`register_candidates` を標準 closeout gate から外し、TodoList の固定 gate を軽くする。

Files:

- `api/services/todo-runtime/todo-list-builder.ts`
- `api/services/todo-runtime/task-types.ts`
- `api/services/worker-tools/todo-list.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/modules/nightworkers/nightworkers.runs.repository.ts`
- `tests/services.todo-list-builder.test.ts`
- `tests/native-api-runner/window-and-todo.cases.ts`

Edits:

- `FINAL_GATES` から `knowledge_capture` を削除する。
- `buildStandardImplementationTodoList` の default gate sequence を `review -> verification -> completion_report` にする。
- `includeKnowledgeCapture` option は削除または互換 shim として無視する。初期実装では API 影響を抑えるため、引数は残して使わない方が安全。
- `isReservedCloseoutTodo` から `knowledge_capture` / `contextstill.register_candidates` を外すか、後方互換の duplicate guard としてだけ残すかを決める。
  - 推奨: 既存 provider echo による重複防止のため、duplicate guard には残す。ただし標準生成はしない。
- closeout / open Todo 判定で `knowledge_capture` を特別扱いしている箇所を削る。

Verification:

- standard TodoList の期待 sequence から `knowledge_capture` が消える。
- SystemContext-echoed `knowledge_capture` を replace input に含めても重複固定 gate として復活しない。
- `completion_report` は残る。

Gate:

```bash
bun run test run tests/services.todo-list-builder.test.ts tests/native-api-runner/window-and-todo.cases.ts
```

### Phase 3. `register_candidates` の標準導線を閉じる

Purpose:

標準 closeout から外した `register_candidates` を、current Todo による one-shot tool や通常 closeout guidance として出ないようにする。

Files:

- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `tests/native-api-runner/dispatcher-gates.cases.ts`

Edits:

- `oneShotToolNamesForTodo` から `knowledge_capture` / `contextstill.register_candidates` による `register_candidates` 露出を削る。
- `register_candidates` registration 自体を削るかは別判断にする。
  - 推奨: 初期実装では registration は残し、標準導線と model-visible exposure だけ閉じる。既存保存データや明示 procedure 互換の影響を小さくする。
- provider-visible tool set の tests を更新し、closeoutTools が `register_candidates` を含まないことを確認する。

Verification:

- implementation lane の通常 Todo で `register_candidates` が出ない。
- planning / review lane の tool set に意図せず残っていないか確認する。
- `compile_eval` は runtime closeout controller の必須 action として引き続き実行される。

Gate:

```bash
bun run test run tests/native-api-runner/dispatcher-gates.cases.ts
```

### Phase 4. `compile_eval` 必須 closeout action を明示的に守る

Purpose:

`knowledge_capture` を削っても `compile_eval` が必須 closeout action として失われないことを保証する。

Files:

- `api/services/agent-runtime/native-api-runner/native-api-closeout-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `tests/services.native-api-runner-closeout.test.ts`
- `tests/native-api-runner/dispatcher-gates.cases.ts`

Edits:

- closeout controller の `compile_eval` 実行条件を `knowledge_capture` に依存しない必須 action として確認する。
- `compile_eval` tool schema は維持する。
- `compile_eval` failure は現在と同じ扱いにする。token 最適化リファクタで failure policy は変えない。
- Codex SDK prompt では `compile_eval` の詳細説明ではなく、必須タイミングだけを残す。

Verification:

- `records compile_eval as a runtime gate during closeout` が通る。
- `context_compile` を使った closeout で `compile_eval` が optional 扱いになっていないことを確認する。
- planning mode では `compile_eval` が skip される既存期待を維持する。
- standard TodoList から `knowledge_capture` が消えても closeout controller test が通る。

Gate:

```bash
bun run test run tests/services.native-api-runner-closeout.test.ts tests/native-api-runner/dispatcher-gates.cases.ts
```

### Phase 5. Token Impact Check

Purpose:

削減が実際に prompt token に効いていることを確認する。

Files:

- `tests/codex-agent-runtime/config-prompt.cases.ts`
- Optional: `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`

Checks:

- `buildCodexRuntimePromptParts(...).estimates.runtimeContractTokens` を変更前後で比較する。
- テストでは絶対値を固定しすぎず、削除対象文言が消え、runtimeContractTokens が現行 fixture より小さくなることだけを見る。
- implementation / planning / review / general_answer の各 lane で不要な contextStill tool 詳細が出ないことを確認する。

Suggested test shape:

```ts
expect(parts.runtimeContract).not.toContain("register_candidates");
expect(parts.runtimeContract).not.toContain("candidate 登録");
expect(parts.runtimeContract).toContain("compile_eval");
expect(parts.estimates.runtimeContractTokens).toBeLessThan(previousImplementationTokenCeiling);
```

The ceiling should be a conservative number derived from the current fixture, not a fragile exact token count.

## Acceptance Criteria

- Runtime contract no longer repeats contextStill tool details that `initial_instructions` already provides.
- Standard implementation TodoList no longer includes `knowledge_capture`.
- `register_candidates` is not exposed through the standard NightWorkers closeout path.
- `compile_eval` is a required closeout action for runs that used `context_compile`.
- `completion_report` remains as the NightWorkers final assistant report gate.
- Tests cover prompt wording, Todo gate sequence, one-shot tool exposure, and compile_eval closeout.
- `bun run verify:fast` passes after targeted tests.

## Recommended Implementation Order

1. Phase 1 prompt shortening.
2. Phase 2 Todo gate removal.
3. Phase 3 `register_candidates` standard path closure.
4. Phase 4 `compile_eval` required-action protection.
5. Phase 5 token impact assertion.

Do not combine this with broader Todo lifecycle, review, verification, or contextStill MCP schema redesign. The value of this refactor is the small scope: remove repeated guidance, remove a non-essential register-candidate path, and preserve `compile_eval` as the required feedback loop.
