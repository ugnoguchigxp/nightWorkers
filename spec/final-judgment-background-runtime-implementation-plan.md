# Final Judgment / Background Runtime 強化 実装計画

## 目的

NightWorkers を、UI 接続に依存せず「一度プロンプトを送信したらバックグラウンドでタスク完了まで処理し、画面を閉じていても最終判断が保存される」挙動に寄せる。

あわせて、Debug モードでは LLM 呼び出し、リトライ、schema 修復、逐次出力を run event として追跡できるようにする。

## 現状の問題

1. 最終回答生成が `runtimeResult.finalReport` に寄っている
   - `Supervisor` が正常な `finalResponse` を返せば表示できる。
   - LLM 呼び出し失敗、JSON/schema 不一致、stop 品質不足の場合は、ユーザー向けの最終判断ではなく内部エラー要約に近い文面になりやすい。

2. `running` から終了状態へ直接落ちる
   - 実行結果を確定する専用フェーズがない。
   - `finalReport`、`summary`、`assistant message`、`run.runtime_finished` の整合性が崩れやすい。

3. WebSocket がライブ表示の中心になっている
   - 重要イベントは DB に保存されているが、UI はリアルタイム受信と履歴取得の責務が混ざっている。
   - 画面を閉じていた場合の「最終判断の復元」を明示的なプロダクト要件として扱っていない。

4. LLM 逐次出力が未整備
   - `callSupervisorLLM` は完了応答を待って JSON decision を返す一発方式。
   - Debug モードでリトライ中の中間状態や raw delta を追跡する event sink がない。

## 基本方針

### 1. UI は購読者にする

UI は run の進行を開始・購読するだけにする。タスク完了、最終判断生成、assistant message 作成はサーバ側で完結させる。

### 2. Final Judgment を第一級の成果物にする

`SupervisorDecision.finalResponse` を直接 UI 表示に使うのではなく、最後に必ず `FinalJudgment` を作成する。

```ts
type FinalJudgment = {
  version: 1;
  runId: string;
  taskId: string;
  status: 'completed' | 'needs_review' | 'needs_human' | 'failed' | 'blocked' | 'timed_out' | 'cancelled';
  title: string;
  conclusion: string;
  evidenceSummary: string[];
  actionsTaken: string[];
  issues: string[];
  residualRisk: string[];
  debugReason?: string;
  source: 'supervisor_final_response' | 'llm_repair_finalizer' | 'deterministic_fallback';
  createdAt: string;
};
```

### 3. `finalizing` フェーズを追加する

状態遷移を以下にする。

```txt
draft
 -> context_compiling
 -> queued
 -> running
 -> finalizing
 -> needs_review | completed | needs_human | failed | blocked | timed_out | cancelled
```

`running` 中に Supervisor が失敗しても、すぐ UI へ終了通知するのではなく、`finalizing` で最終判断を作成してから完了する。

### 4. Debug stream は run event として永続化する

WebSocket は DB event のライブ配送に限定する。Debug UI は DB に保存された `model.*` event を表示し、再接続後も復元できるようにする。

## 実装フェーズ

## Phase 1: FinalJudgment の型と保存経路

### 対象ファイル

- `shared/schemas/nightworkers.schema.ts`
- `src/modules/nightworkers/types.ts`
- `api/db/schema.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `api/services/run-events/types.ts`
- `api/services/run-events/normalizer.ts`
- `api/services/run-events/jsonl-export.ts`

### 実装内容

1. `FinalJudgment` 型を shared schema に追加する。
2. `task_runs` に `final_judgment` JSON カラムを追加する。
3. `taskRunSchema` / `taskRunDetailSchema` に `finalJudgment` を追加する。
4. run event type に `run.finalizing_started` と `run.final_judgment_created` を追加する。
5. JSONL export に final judgment を含める。

### 受け入れ条件

- `/api/runs/:id` で `finalJudgment` が返る。
- run event に `run.final_judgment_created` が保存される。
- JSONL export で最終判断が追跡可能。

## Phase 2: Final Judgment Builder

### 対象ファイル

- `api/services/final-judgment/types.ts`
- `api/services/final-judgment/build-final-judgment.ts`
- `api/services/final-judgment/render-final-message.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/services/agent-runtime/NativeAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.service.ts`

### 実装内容

`buildFinalJudgment` を追加する。

```ts
type BuildFinalJudgmentInput = {
  run: TaskRun;
  task: Task;
  supervisorResult: AgentRuntimeResult;
  events: TaskEvent[];
  diffPatch?: string | null;
};
```

Finalizer は3段階で動く。

1. Primary
   - `supervisorResult.finalReport` が十分なら `source: 'supervisor_final_response'` として採用する。

2. Repair
   - `finalReport` が空、不十分、内部エラーのみの場合、events / diff / status を材料に LLM で最終判断だけ生成する。
   - この LLM 呼び出しも run event に記録する。

3. Deterministic fallback
   - LLM が使えない場合、events / status / error からテンプレートで最終判断を作る。
   - 少なくとも「結論」「停止理由」「次に必要な対応」は必ず入れる。

### 受け入れ条件

- LLM 呼び出し失敗時も assistant message が空にならない。
- `finalReport` と `finalJudgment.conclusion` が矛盾しない。
- `needs_human` でもユーザーが次に何をすべきか読める。

## Phase 3: `finalizing` フェーズ

### 対象ファイル

- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `api/services/run-control/types.ts`
- `api/services/run-control/run-outcome-gate.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`

### 実装内容

1. Runtime 完了後、まず task/run status を `finalizing` にする。
2. `buildFinalJudgment` を実行する。
3. `finalJudgment` を run に保存する。
4. `renderFinalMessage(finalJudgment)` で assistant message を作成する。
5. `decideRunOutcome` の結果で最終 status に更新する。

推奨順序:

```txt
runtime.start finished
 -> update run/task status: finalizing
 -> create run.finalizing_started
 -> buildFinalJudgment
 -> save finalJudgment + finalReport
 -> create assistant message
 -> create run.final_judgment_created
 -> update final task/run status
 -> create run.runtime_finished / run.outcome_decided
```

### 受け入れ条件

- UI を閉じていても、サーバ側で assistant message が作成される。
- 再表示時に `/api/tasks/:id/messages` と `/api/runs/:id` だけで最終判断を復元できる。
- `finalizing` が残留した場合、stale recovery 対象になる。

## Phase 4: LLM Debug Event Sink

### 対象ファイル

- `api/services/supervisor/llm-provider.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `api/services/run-events/types.ts`
- `api/services/run-events/normalizer.ts`

### 実装内容

`callSupervisorLLM` に event sink を渡せるようにする。

```ts
type SupervisorLlmEventSink = (event: {
  type:
    | 'model.request_started'
    | 'model.retry_scheduled'
    | 'model.retry_started'
    | 'model.response_delta'
    | 'model.response_finished'
    | 'model.response_parse_failed'
    | 'model.response_repaired';
  message: string;
  data?: Record<string, unknown>;
}) => Promise<void>;
```

まず Phase 4 では token stream 未対応でもよい。以下を必ず出す。

- `model.request_started`
- `model.response_finished`
- `model.response_parse_failed`
- `model.retry_scheduled`
- `model.retry_started`

### 受け入れ条件

- Debug UI で「何回目の LLM 呼び出しか」「なぜ再試行したか」が見える。
- schema 失敗や JSON 修復が event として残る。
- 通常チャットには未確定の中間テキストを出さない。

## Phase 5: Provider Streaming 対応

### 対象ファイル

- `api/services/supervisor/llm-provider.ts`
- `api/services/run-events/types.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`

### 実装内容

対応 provider だけ `model.response_delta` を emit する。

注意点:

- Supervisor の通常出力は JSON decision なので、delta は Debug モード限定で表示する。
- delta は長大化しやすいため、DB 保存時に chunk size と最大保存量を制限する。
- JSON decision として確定した内容だけを通常 UI の assistant message に使う。

### 受け入れ条件

- Debug ON の場合のみ delta が見える。
- Debug OFF では通常の最終判断だけが表示される。
- delta 保存量の上限で DB が肥大化しない。

## Phase 6: UI 復元と Debug 表示

### 対象ファイル

- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `src/modules/nightworkers/components/ThreadMessage.tsx`

### 実装内容

1. UI 初期表示時は `/api/tasks/:id/messages` と `/api/runs/:id` を正とする。
2. WS は差分追加だけに使う。
3. `finalJudgment` が存在し、assistant message が欠落している場合は、UI 上で run detail から最終判断を表示する。
4. Debug mode では `model.*` event をグルーピング表示する。

Debug 表示案:

```txt
LLM request #1
  provider: codex
  model: gpt-5.3-codex-spark
  status: parse_failed
  retry: scheduled

LLM request #2
  status: response_finished
  parsed: true
```

### 受け入れ条件

- 画面を閉じて戻っても最終判断が表示される。
- WebSocket 切断中に完了した run も履歴取得で復元される。
- Debug mode で retry / parse / finalizer の流れが追える。

## Phase 7: Recovery

### 対象ファイル

- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/runner/NativeLocalRunner.ts`
- `api/services/run-control/run-outcome-gate.ts`

### 実装内容

stale active recovery に `finalizing` を含める。

1. `running` / `context_compiling` / `finalizing` の古い run を検出する。
2. Runtime が実行中でなければ `FinalJudgment` fallback を作る。
3. assistant message を作る。
4. status を `failed` または `needs_human` に確定する。

### 受け入れ条件

- サーバ再起動後に `finalizing` のまま残らない。
- 回復された run でもユーザー向け説明が残る。

## テスト計画

### Unit

- `buildFinalJudgment`
  - normal finalResponse
  - empty finalResponse
  - llm_error
  - schema failure
  - policy stop
  - timed out

- `renderFinalMessage`
  - completed
  - needs_review
  - needs_human
  - failed

- `run-outcome-gate`
  - finalizing 経由の status 確定

### Integration

- LLM provider fixture で `finalResponse` 空を返す。
- LLM provider fixture で schema 不一致を返す。
- LLM provider fixture で provider error を投げる。
- いずれも assistant message と final judgment が作られることを確認する。

### UI

- WS 接続中に完了した run の表示。
- WS 切断中に完了した run の復元。
- Debug ON で `model.*` event が表示される。
- Debug OFF で中間 delta が通常メッセージに混ざらない。

## 実装順序

1. Phase 1: 型、schema、event type を追加する。
2. Phase 2: deterministic fallback だけで `FinalJudgment` を作る。
3. Phase 3: runtime 終了経路に `finalizing` を入れる。
4. Phase 4: LLM debug event sink を追加する。
5. Phase 5: provider streaming を対応 provider から追加する。
6. Phase 6: UI の復元と Debug 表示を強化する。
7. Phase 7: stale recovery を拡張する。

最初の実装 slice は Phase 1 から Phase 3 までに絞る。これで「画面を閉じても最終判断が残る」中核が成立する。Streaming はその後に追加する。

## リスク

1. Finalizer が Supervisor と責務重複する
   - Finalizer は実行判断をしない。既存イベントから最終説明を作るだけに限定する。

2. Debug delta が通常回答に混ざる
   - `model.response_delta` は Debug event としてのみ扱い、assistant message には使わない。

3. DB event が肥大化する
   - delta chunk size、最大 chunk 数、保存対象 provider を制限する。

4. `finalizing` が残留する
   - stale recovery に `finalizing` を含める。

5. LLM repair finalizer が誤った結論を作る
   - repair finalizer の入力は run events / diff / status に限定する。
   - evidence がない場合は「確認できなかった」と明示する。

## 完了条件

- プロンプト送信後、UI を閉じてもバックグラウンドで run が完了する。
- run 完了後、`finalJudgment` と assistant message が必ず保存される。
- LLM エラー時も、ユーザーが読める最終判断が残る。
- Debug mode で LLM request / retry / parse failure / finalizer の流れが追跡できる。
- Streaming 対応 provider では `model.response_delta` を Debug 限定で表示できる。
