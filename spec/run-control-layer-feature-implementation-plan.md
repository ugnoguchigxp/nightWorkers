---
title: Run Control Layer 新機能実装計画
targetKind: wiki
priorityGroup: wiki
---

# Run Control Layer 新機能実装計画

作成日: 2026-06-01

## 目的

自律コーディングエージェント基盤として不足している制御面を、新機能単位で実装する。

この計画は `spec/coding-agent-foundation-improvement-plan.md` の改善項目を、より明確な feature boundary に分ける。中心は `Run Outcome Gate` と `Run Budget Controller` であり、この2つを合わせて `Run Control Layer` と呼ぶ。

対象機能:

- Run Outcome Gate
- Run Budget Controller
- Realtime Event Reconciler
- Tool Policy Enforcer
- Agent Outcome E2E Harness

## 前提

- NightWorkers の主 runtime は `NativeLocalRunner`。
- 実行の事実源は `task_runs`, `task_events`, `task_messages`, `artifacts`。
- UI は ledger を表示する投影であり、最終状態の真実を作らない。
- LLM の final response は参考情報であり、基盤の成功判定そのものではない。
- 既存の temporary external tool guard は残しつつ、今回の feature で loop と停止理由を扱えるようにする。

## Feature 1: Run Outcome Gate

### 責務

Run Outcome Gate は、run の最終状態を一箇所で確定する。

LLM、supervisor、runner、service がそれぞれ status を書き換える状態をやめ、次の情報から最終 outcome を決める。

- supervisor terminal state
- final report
- tool result summary
- diff presence
- verification result
- safety violation
- timeout / budget stop
- human review action

### 追加する概念

```ts
type RunOutcomeStatus =
  | 'needs_review'
  | 'completed'
  | 'needs_human'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancelled';

type RunOutcomeReason =
  | 'supervisor_completed'
  | 'supervisor_needs_human'
  | 'budget_exceeded'
  | 'tool_failure_limit'
  | 'policy_violation'
  | 'verification_failed'
  | 'runner_crashed'
  | 'human_review';
```

### 対象ファイル

- `api/services/run-control/run-outcome-gate.ts`
- `api/services/run-control/types.ts`
- `api/services/runner/NativeLocalRunner.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `shared/schemas/nightworkers.schema.ts`
- `tests/services.run-control.test.ts`
- `tests/services.supervisor.test.ts`

### 実装方針

- `runSupervisorLoop` は `string` ではなく `SupervisorLoopResult` を返す。
- `SupervisorLoopResult` に `terminalState`, `finalReport`, `summary`, `reason`, `riskLevel` を含める。
- `NativeLocalRunner` は supervisor result を `RunOutcomeGate` に渡す。
- `nightworkers.service.ts` は runner raw status ではなく `RunOutcomeGate` の結果で task status を更新する。
- `reviewTaskRun` も `RunOutcomeGate` 経由で human review outcome を作る。
- run finalization event を `task_events` に保存する。

### 受け入れ条件

- supervisor が `needs_human` を返した run は、runner が正常終了しても `completed` にならない。
- `completed` は human review または明示的な auto-complete policy を通った時だけ使う。
- 通常の agent 成功はまず `needs_review` になる。
- final assistant message は gate が確定した outcome と矛盾しない。
- run event に `run_outcome_decided` が保存される。

### 検証

- `pnpm test run tests/services.run-control.test.ts`
- `pnpm test run tests/services.supervisor.test.ts`
- `pnpm typecheck`
- `pnpm lint`

## Feature 2: Run Budget Controller

### 責務

Run Budget Controller は、run がどこまで自律実行してよいかを管理する。

止める対象:

- 最大 iteration 超過
- 最大 tool call 超過
- deadline 超過
- 同一 tool + 同一 arguments の繰り返し
- missing toolCall の繰り返し
- schema fallback の繰り返し
- 同一 tool failure の繰り返し

### 追加する概念

```ts
type RunBudgetConfig = {
  maxIterations: number;
  maxToolCalls: number;
  maxRepeatedAction: number;
  maxMissingToolCalls: number;
  timeoutSeconds: number;
};

type BudgetDecision = {
  allowed: boolean;
  reason?: 'iteration_limit' | 'tool_limit' | 'deadline' | 'repeat_action' | 'missing_tool_call' | 'tool_failure';
  detail?: Record<string, unknown>;
};
```

### 対象ファイル

- `api/services/run-control/run-budget-controller.ts`
- `api/services/run-control/types.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/services/supervisor/llm-provider.ts`
- `api/services/runner/types.ts`
- `api/db/schema.ts`
- `shared/schemas/nightworkers.schema.ts`
- `tests/services.run-control.test.ts`
- `tests/services.supervisor.test.ts`

### 実装方針

- `RunBudgetController` を run ごとに生成する。
- loop 開始時、LLM response 後、tool result 後に budget を評価する。
- tool call は normalized signature を作る。
- signature は `toolName + stableJson(arguments)`。
- budget stop は `RunOutcomeGate` へ `budget_exceeded` として渡す。
- budget 消費状況を `task_events` の payload に残す。

### 受け入れ条件

- 同一 `find_file` が3回続くと停止する。
- missing toolCall が3回続くと停止する。
- `timeoutSeconds` が supervisor loop に効く。
- budget stop は `needs_human` または `blocked` として確定する。
- UI debug に budget stop reason が出る。

### 検証

- `pnpm test run tests/services.run-control.test.ts`
- mocked supervisor で repeat action を再現する。
- mocked supervisor で missing toolCall を再現する。
- `pnpm typecheck`
- `pnpm lint`

## Feature 3: Realtime Event Reconciler

### 責務

Realtime Event Reconciler は、WebSocket で届く event と REST で取得する ledger を矛盾なく統合する。

目的:

- run 開始直後の event を落とさない。
- runId 未反映 race に耐える。
- event の重複を消す。
- seq 順で timeline を安定させる。
- debug UI を「現在の実行状態」の表示にする。

### 追加する概念

```ts
type RealtimeEventBuffer = {
  byRunId: Record<string, TaskEvent[]>;
};

type ReconciledRunEvents = {
  runId: string;
  events: TaskEvent[];
  source: 'rest' | 'ws' | 'merged';
};
```

### 対象ファイル

- `api/services/realtime/nightworkers-ws.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `src/modules/nightworkers/types.ts`
- `tests/e2e/nightworkers-agent.spec.ts`
- `tests/e2e/helpers.ts`

### 実装方針

- WS payload に `taskId`, `runId`, `event.id`, `event.seq`, `timestamp` を必須として扱う。
- UI 側で `runId` ごとの buffer を持つ。
- `latestRun` 未取得でも WS event は保存する。
- REST の run details が届いたら `event.id` で dedupe し、`seq` で sort する。
- `task_message_created` と `task_event_created` は同一 timeline へ入れるが、runId で関連付ける。
- debug default hidden は維持する。

### 受け入れ条件

- prompt 送信直後の `Task run started` が debug UI に出る。
- LLM final response 前に tool call / tool result が表示される。
- refresh 後も同じ event 順で表示される。
- WS reconnect 後に event が二重表示されない。
- 2つの session を連続実行しても、event が別 session に混ざらない。

### 検証

- `pnpm test:e2e:smoke`
- `pnpm test:e2e:regression`
- Playwright で debug toggle を開き、run start event と tool event の表示を確認する。
- 大きめ変更時は `verify -> 必要なら修正 -> 再verify -> ローカル表示確認` の順で確認する。

## Feature 4: Tool Policy Enforcer

### 責務

Tool Policy Enforcer は、repository の `safetyPolicy` を全 worker tool の実行直前に適用する。

policy を UI/API の設定値ではなく、実行契約にする。

### 追加する概念

```ts
type ToolPolicyContext = {
  repoRoot: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  blockedCommands?: string[];
  maxCommandSeconds?: number;
  requireReadBeforeEdit?: boolean;
};

type PolicyDecision = {
  allowed: boolean;
  code?: 'ACCESS_DENIED' | 'COMMAND_BLOCKED' | 'TIMEOUT_EXCEEDED' | 'READ_BEFORE_EDIT_REQUIRED';
  message?: string;
};
```

### 対象ファイル

- `api/services/worker-tools/tool-policy-enforcer.ts`
- `api/services/worker-tools/path-policy.ts`
- `api/services/worker-tools/command-policy.ts`
- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/read-file.ts`
- `api/services/worker-tools/search-files.ts`
- `api/services/worker-tools/list-dir.ts`
- `api/services/worker-tools/apply-patch.ts`
- `api/services/worker-tools/replace-content.ts`
- `api/services/runner/NativeLocalRunner.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `tests/services.worker-tools.test.ts`

### 実装方針

- `safetyPolicy` を `startTaskRun -> NativeLocalRunner -> runSupervisorLoop -> worker tools` に通す。
- 各 tool は個別に path/command を判定しない。共通 enforcer を使う。
- command は allowlist first に寄せる。
- unknown command は default deny にする。
- chained command は default deny にする。
- policy violation は tool result として ledger に残す。

### 受け入れ条件

- `deniedPaths` は read/search/list/edit/run cwd に効く。
- `blockedCommands` は `run_command` に効く。
- `maxCommandSeconds` は command timeout に効く。
- unknown command は拒否される。
- policy violation は `tool_result` event に error code として残る。

### 検証

- `pnpm test run tests/services.worker-tools.test.ts`
- denied path の read/list/search/edit を unit test で確認する。
- `git push`, `curl`, `pnpm test && rm -rf .` が拒否されることを確認する。
- `pnpm typecheck`
- `pnpm lint`

## Feature 5: Agent Outcome E2E Harness

### 責務

Agent Outcome E2E Harness は、NightWorkers の内蔵コーディングエージェントがタスクを完遂できたかを、UI 操作ではなく outcome で検証する。

見るもの:

- 新規 session が作られる。
- prompt が1回だけ保存される。
- run が作られる。
- WS event が流れる。
- tool call / tool result が記録される。
- diff が発生する。
- verification が記録される。
- run outcome が期待値になる。

### 対象ファイル

- `tests/e2e/nightworkers-agent.spec.ts`
- `tests/e2e/helpers.ts`
- `playwright.config.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/supervisor/llm-provider.ts`
- `api/services/run-control/*`

### 実装方針

- test ごとに scratch workspace を作る。
- test ごとに repository と session を作る。
- deterministic test は mocked LLM provider を使う。
- live LLM test は `@agent-live` tag を付け、通常 smoke から外す。
- Playwright は UI だけでなく API で run details を取得して検証する。
- 失敗時に runId、taskId、screenshot、trace、run events、supervisor trace path を出す。

### 受け入れ条件

- `@smoke` は provider credentials なしで通る。
- `@agent-live` は credentials がある時だけ実行する。
- 「fizzbuzz.ts を作成」のような基本タスクを outcome で検証できる。
- 「WS badge を3色丸にする」のようなUI変更タスクを diff で検証できる。
- 同一 prompt の多重投稿が起きない。

### 検証

- `pnpm test:e2e:smoke`
- `pnpm test:e2e:regression`
- `pnpm test:e2e --grep @agent-live`
- 大きめ変更時は `verify -> 必要なら修正 -> 再verify -> ローカル表示確認` の順で確認する。

## 導入順

1. Run Outcome Gate
2. Run Budget Controller
3. Realtime Event Reconciler
4. Tool Policy Enforcer
5. Agent Outcome E2E Harness

この順にする理由:

- Outcome Gate がないと、どの run が成功/失敗なのかを信用できない。
- Budget Controller がないと、run が止まる条件を outcome として扱えない。
- Event Reconciler は正しい outcome と budget event を UI に出すために必要。
- Policy Enforcer は tool execution の安全性を上げるが、policy violation の outcome を先に確定できる必要がある。
- E2E Harness は上記4つを回帰させないため最後に厚くする。

## 最初の実装単位

最初の PR 相当でやる範囲:

- `api/services/run-control/types.ts`
- `api/services/run-control/run-outcome-gate.ts`
- `api/services/run-control/run-budget-controller.ts`
- `runSupervisorLoop` の戻り値を `SupervisorLoopResult` に変更
- `NativeLocalRunner` が result を尊重
- `nightworkers.service.ts` の final status 決定を gate 経由に変更
- supervisor unit test に `needs_human` 上書き防止と repeat action stop を追加

この単位の完了条件:

- `needs_human` が `completed` に上書きされない。
- 同一 tool action 3回で停止する。
- run finalization event が残る。
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test run tests/services.run-control.test.ts tests/services.supervisor.test.ts`

## 全体の完了条件

- Run Outcome Gate が全 run の最終状態を決める。
- Run Budget Controller が iteration/tool/deadline/repeat を止める。
- Realtime Event Reconciler が WS と REST ledger を merge する。
- Tool Policy Enforcer が repository safetyPolicy を全 tool に適用する。
- Agent Outcome E2E Harness が provider 不要 smoke と live agent test を分離する。
- `pnpm typecheck`, `pnpm lint`, unit tests, `pnpm test:e2e:smoke` が通る。

