# Native Supervisor Evidence Runtime Hardening 実装計画

## 1. 目的

`native-supervisor` lane で、読み取り系 tool の反復、失敗 tool からの復旧不足、`apply_patch` / `replace_content` 失敗後の停滞を減らす。

この計画では、NightWorkers の外枠である Task / Run / Todo / run event ledger / worker tools / runtime lane registry は維持する。先に `native-supervisor` の evidence と recovery contract を強くし、後続で Codex 型の履歴ベース runtime loop を experimental lane として導入できる状態にする。

## 2. 背景

現状の `native-supervisor` は、Round 1 で jobType / goal を選び、Round 2 以降で LLM に次の `toolCall` を1つ選ばせる。

実行経路は次の通り。

1. `startTaskRun(...)` が run / Todo / runtime context を作る。
2. `NativeAgentRuntime.start(...)` が `runSupervisorLoop(...)` に制御を渡す。
3. `runSupervisorLoop(...)` が `toolResults`、Todo、Progress Context、Workspace Snapshot を Round 2 prompt に再構成する。
4. LLM が `toolCall` を返し、`executeWorkerTool(...)` が実行する。
5. tool result が `toolResults` と run event ledger に入る。

この構造では、失敗 tool result が「次に何をすべきか」まで十分に runtime 側で固定されていない場合、LLM が同じ読み取りや同じ失敗 patch を繰り返しやすい。

## 3. 対象範囲

対象:

- `api/services/supervisor/supervisor-loop.ts`
- `api/services/supervisor/supervisor-loop-helpers.ts`
- `api/services/supervisor/supervisor-loop-types.ts`
- `api/services/supervisor/prompt-budget-manager.ts`
- `api/services/supervisor/user-context.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/worker-tools/*`
- `api/services/conversation-context/*`
- `api/services/agent-runtime/registry.ts`
- `api/services/agent-runtime/runtime-lane.ts`
- `tests/*supervisor*`
- `tests/*worker-tools*`
- `tests/*conversation-context*`
- `tests/services.agent-runtime-registry.test.ts`

対象外:

- Codex SDK lane の挙動変更
- Workbench intake / Plan mode / Blueprint / DB Design の workflow 変更
- 既存 DB schema の大規模変更
- UI redesign
- worker tool を Codex tool spec 互換に全面移植すること

## 4. 目標状態

### 4.1 小中規模改修後

- `list_dir` が存在しない path を返した場合、失敗 evidence に path / reason / next action が残る。
- `read_file` が 0 行または無効 range を返した場合、次の復旧候補が Progress Context に入る。
- `apply_patch` / `replace_content` が失敗した場合、同じ patch / needle を繰り返さず、対象ファイルを一度だけ読み直して修正 patch を作る方向へ誘導される。
- `todo_list operation=list` や `read_file` / `list_dir` の反復は、tool を禁止するのではなく、runtime が do-not-repeat evidence と nextConcreteAction で抑制する。
- PromptBudget / StateCard の圧縮後も、直近の失敗 evidence と recovery directive は落ちない。

### 4.2 抜本改修後

- `native-supervisor-v2` または experimental flag 付き lane が、tool call / tool output を履歴の一級要素として扱う。
- 既存 `native-supervisor` は fallback として残す。
- Todo / run event ledger / closeout gate / worker tools は既存 contract を再利用する。
- experimental lane は behavior parity を確認してから既定値候補にする。

## 5. 設計方針

### 5.1 既存外枠は維持する

`TaskRun`、`task_run_todos`、`task_events`、`WorkerToolResult`、`AgentRuntime` interface は維持する。

短期の目的は agent runtime 全体の置き換えではなく、現行 loop の evidence と recovery を強化することに置く。

### 5.2 SystemContext だけで解決しない

prompt 文言は補助として使うが、主要な改善は runtime が生成する structured evidence / recovery directive / do-not-repeat に置く。

LLM に「ちゃんと考えて」と指示するのではなく、次 prompt に入る状態を、LLM が同じ失敗へ戻りにくい形にする。

### 5.3 1・2 は 3 の土台として作る

typed evidence、critical evidence protection、recovery directive は、後続の履歴型 runtime loop でもそのまま使う。

そのため、Phase 1 / Phase 2 では temporary prompt hack を避け、型と helper を分離して実装する。

## 6. Phase 1: Tool Failure Evidence と Recovery Directive

目的:

- 失敗 tool result を、単なる summary ではなく「復旧可能な実行状態」として扱う。
- read-only tool を block せず、反復だけを抑える。

### 6.1 型を追加する

候補:

- `NativeToolEvidence`
- `NativeToolFailureKind`
- `RecoveryDirective`
- `DoNotRepeatDirective`
- `CriticalEvidenceKind`

例:

```ts
type NativeToolFailureKind =
  | 'path_not_found'
  | 'not_a_directory'
  | 'file_not_found'
  | 'empty_read'
  | 'invalid_line_range'
  | 'patch_mismatch'
  | 'needle_not_found'
  | 'access_denied'
  | 'todo_tracking_noop'
  | 'unknown_tool_failure';

type RecoveryDirective = {
  kind: 'read_target_once' | 'edit_with_corrected_patch' | 'choose_existing_path' | 'advance_current_todo' | 'ask_user';
  targetPath?: string;
  reason: string;
  maxRepeats?: number;
};
```

実装候補:

- `api/services/supervisor/supervisor-loop-types.ts`
- `api/services/supervisor/supervisor-loop-helpers.ts`

### 6.2 worker tool result から evidence を生成する

対象 tool:

- `list_dir`
- `read_file`
- `apply_patch`
- `replace_content`
- `search_files`
- `todo_list`
- `run_command`
- `run_verification`

実装方針:

- `WorkerToolResult` の `ok`, `error.code`, `error.message`, `payload`, `arguments` から `NativeToolEvidence` を生成する。
- `formatToolObservation(...)` は表示用 summary のまま残す。
- `toolResults` には既存 shape を保ちつつ、`evidence` field を追加する。
- DB event payload にも evidence を入れる。

### 6.3 Progress Context に recovery directive を反映する

`buildProgressContext(...)` が次を返せるようにする。

- `nextConcreteAction`
- `doNotRepeat`
- `recoveryDirective`
- `criticalEvidence`

例:

- `list_dir path_not_found`: 存在する親 directory を確認するか、target path を修正して進む。
- `read_file empty_read`: range を外して対象ファイル全体または近傍を読む。既に十分な context があるなら edit へ進む。
- `apply_patch patch_mismatch`: 同じ patch を繰り返さず、対象ファイルを一度だけ読んで corrected patch を作る。
- `todo_list list noop`: Todo 状態確認を進捗扱いせず、current Todo に対応する worker tool を実行する。

### 6.4 prompt 文言を evidence 前提へ寄せる

`prompt.ts` の Minimum Execution Contract は残すが、重複文言を増やさず、`Progress Context.recoveryDirective` と `Progress Context.doNotRepeat` を最優先する旨に寄せる。

確認観点:

- read-only tool を全面禁止しない。
- implementation Todo で十分な context がある場合は write tool へ進ませる。
- patch failure 後だけ target read を許可する。

## 7. Phase 2: Critical Evidence Protection と StateCard 改修

目的:

- 重要な失敗 evidence が PromptBudget / StateCard 圧縮で消えないようにする。
- continuation run でも、前回の失敗と復旧方針を保つ。

### 7.1 PromptBudget の保護ルールを追加する

対象:

- `api/services/supervisor/prompt-budget-manager.ts`

方針:

- `Recent Tool Evidence` 圧縮時、失敗 item と recovery directive を優先保持する。
- 成功した古い `list_dir` / `read_file` より、直近の failed `apply_patch` / `replace_content` / `path_not_found` を優先する。
- `context-still.context_compile` の巨大 result は落としてよいが、失敗 / run blocking / recommended action は落とさない。
- `read_file` payload は本文を持たなくてよいが、`filePath`, `totalLines`, `linesReturned`, `startLine`, `endLine`, `contentHash`, `error`, `recoveryDirective` は残す。

### 7.2 StateCard に worker evidence refs を入れる

対象:

- `api/services/conversation-context/build.ts`
- `api/services/conversation-context/render.ts`
- `api/services/conversation-context/types.ts`

方針:

- 前回 run の最後の tool failure と recovery directive を snapshot に保存する。
- unchanged baseline でも `Last problem` だけでなく `Recovery` と `Targets` を残す。
- code snippets より critical evidence を優先する。
- StateCard は「続きをやる」ための最小状態にし、再計画を誘導しない。

### 7.3 prompt budget metadata を検証可能にする

`promptBudget.metadata` に次を追加する。

- `criticalEvidencePreserved`
- `criticalEvidenceDropped`
- `recoveryDirectiveCount`

これにより、run event から StateCard / PromptBudget が足を引っ張ったかを調査できる。

## 8. Phase 3: Native History Runtime Experimental Lane

目的:

- Codex core 型の「tool call / tool output を履歴の一級要素として扱う」runtime を NightWorkers native lane に段階導入する。
- Phase 1 / Phase 2 の部品を流用し、全面置換ではなく experimental lane として検証する。

### 8.1 lane 名と導入方法

候補:

- internal: `native-history`
- external setting alias: まだ公開しない
- env flag: `NIGHTWORKERS_EXPERIMENTAL_NATIVE_HISTORY_RUNTIME=true`

初期は Settings UI に出さない。テストとローカル検証だけで使う。

### 8.2 新 runtime の責務

候補ファイル:

- `api/services/agent-runtime/native-history/NativeHistoryRuntime.ts`
- `api/services/agent-runtime/native-history/native-history-loop.ts`
- `api/services/agent-runtime/native-history/native-transcript.ts`
- `api/services/agent-runtime/native-history/native-tool-router.ts`

責務:

- model input を `NativeTranscriptItem[]` から構築する。
- tool call と tool output を transcript item として記録する。
- worker tool 実行は既存 `executeWorkerTool(...)` を使う。
- Todo / closeout / run event ledger は既存 shared contract を使う。
- compaction は `NativeTranscriptCompactor` で行い、critical evidence を落とさない。

### 8.3 既存 Supervisor loop との関係

初期は `runSupervisorLoop(...)` を置き換えない。

導入案:

1. `NativeHistoryRuntime` を別 adapter として追加する。
2. `native-supervisor` と同じ worker tool registry を使う。
3. `runtimeOptions.experimentalNativeHistory` が true の場合だけ registry から選べる。
4. run event ledger の payload shape は既存に合わせる。
5. Todo gate / final gate の挙動は既存 tests を流用して比較する。

### 8.4 transcript item の候補

```ts
type NativeTranscriptItem =
  | { type: 'user_request'; text: string }
  | { type: 'system_contract'; text: string; digest: string }
  | { type: 'todo_state'; todos: unknown[]; currentTodo: unknown | null }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_output'; id: string; ok: boolean; summary: string; evidence?: NativeToolEvidence }
  | { type: 'assistant_final'; text: string };
```

### 8.5 compaction 方針

Codex の完全移植ではなく、NightWorkers 向けに次だけ固定する。

- 最新 user request は保持する。
- current Todo は保持する。
- 未解決 failure evidence は保持する。
- 直近の write tool と verification result は保持する。
- 古い成功 read-only evidence は削れる。
- StateCard と transcript compaction が同じ情報を二重に持たないようにする。

## 9. 実装順序

### Step 1: Baseline と観測固定

- 対象症状を fixture 化する。
- `list_dir` path not found
- `read_file` 0 lines / invalid range
- `apply_patch` mismatch
- `replace_content` needle not found
- `todo_list list` noop repeat

検証:

- 既存挙動を壊さず、失敗 tool result が再現できる。

### Step 2: Typed evidence を追加する

- `NativeToolEvidence` と helper を追加する。
- worker tool result から evidence を作る。
- `toolResults` と run event payload に追加する。

検証:

- unit tests で failure kind / recovery directive が期待通りになる。

### Step 3: Progress Context を強化する

- `buildProgressContext(...)` が critical evidence を読んで `nextConcreteAction` / `doNotRepeat` を生成する。
- 同じ failed patch / failed list_dir を繰り返す場合は validation failed として扱う。

検証:

- Supervisor loop helper tests を追加する。
- read-only tool 自体は block されないことを確認する。

### Step 4: PromptBudget を修正する

- `Recent Tool Evidence` の critical item priority を追加する。
- metadata に preserved / dropped を出す。

検証:

- compressed prompt に failure evidence が残る。
- 巨大 success payload は落ちる。

### Step 5: StateCard を修正する

- previous run failure / recovery directive を snapshot に保存する。
- unchanged baseline でも critical recovery を残す。

検証:

- continuation prompt に recovery directive が含まれる。
- code snippet より critical evidence が優先される。

### Step 6: native-history experimental lane の設計 skeleton

- runtime lane registry に公開しない internal adapter skeleton を置く。
- transcript 型、tool router adapter、compaction interface だけ作る。
- 実行はまだ既定化しない。

検証:

- typecheck。
- unit tests で transcript append / compaction priority を確認する。

### Step 7: native-history experimental execution

- feature flag で local test run だけ可能にする。
- worker tool execution と Todo closeout を既存 ledger に投影する。
- native-supervisor と同じ fixture task で結果を比較する。

検証:

- failed tool recovery fixture。
- Todo gate fixture。
- finalize guard fixture。
- run event replay fixture。

## 10. テスト計画

優先 tests:

- `tests/services.worker-tools*.test.ts`
- `tests/services.supervisor*.test.ts`
- `tests/services.conversation-context*.test.ts`
- `tests/services.agent-runtime-registry.test.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`

追加したい fixture:

- path not found 後に同じ `list_dir` を繰り返さない。
- `read_file` 0 lines 後に valid range または edit へ進む。
- `apply_patch` mismatch 後に同じ patch を繰り返さない。
- PromptBudget aggressive compression 後も latest failure evidence が残る。
- StateCard unchanged baseline でも last recovery directive が残る。
- native-history experimental lane が既存 ledger / Todo gate を壊さない。

## 11. リスクと対策

### 11.1 read-only tool を強く止めすぎる

リスク:

- 必要な調査まで止まり、agent が実装前に十分な context を得られない。

対策:

- tool 自体は block しない。
- 同じ失敗条件の反復だけを do-not-repeat にする。
- `RecoveryDirective.maxRepeats` を持たせる。

### 11.2 PromptBudget が重要証拠を落とす

リスク:

- LLM が失敗状態を忘れ、同じ tool call に戻る。

対策:

- critical evidence priority を導入する。
- metadata に dropped critical evidence を出し、dropped があれば needs_human か budget warning にする。

### 11.3 native-history lane が既存 closeout を壊す

リスク:

- Codex 型 loop へ寄せる途中で Todo / review / verify / knowledge / final report gate が欠落する。

対策:

- experimental lane は既定化しない。
- shared closeout gate を先に使う。
- native-supervisor と同じ fixture で behavior parity を見る。

### 11.4 SystemContext がさらに肥大化する

リスク:

- Qwen / local model で instruction following が悪化する。

対策:

- prompt 文言の追加ではなく structured context を使う。
- 重複したルールは `Progress Context` と recovery directive への参照に寄せる。

## 12. 完了条件

Phase 1 / 2 完了条件:

- 代表的な失敗 tool result が typed evidence と recovery directive を持つ。
- Progress Context が次 action と do-not-repeat を出す。
- PromptBudget / StateCard 圧縮後も critical evidence が残る。
- read-only tool を全面禁止せず、反復だけを抑制できる。
- targeted tests と typecheck が通る。

Phase 3 完了条件:

- native-history experimental lane が feature flag で起動できる。
- tool call / tool output transcript が残る。
- existing worker tools / Todo / ledger / closeout gate を再利用できる。
- 既存 native-supervisor の既定挙動を壊さない。
- fixture task で native-supervisor と native-history の差分を観測できる。

## 13. 推奨マイルストーン

Milestone A:

- Phase 1 / Step 1-3。
- 失敗 evidence と Progress Context 強化。
- 体感改善を最短で出す。

Milestone B:

- Phase 2 / Step 4-5。
- PromptBudget / StateCard の critical evidence protection。
- continuation run の失敗反復を抑える。

Milestone C:

- Phase 3 / Step 6。
- native-history の skeleton と transcript / compaction tests。
- まだ実行既定値にはしない。

Milestone D:

- Phase 3 / Step 7。
- feature flag 付き experimental execution。
- parity fixture と実 run 観測。

この順序なら、短期の症状改善を先に取りつつ、後続の抜本改修に使える部品を増やせる。
