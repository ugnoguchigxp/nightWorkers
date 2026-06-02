---
title: Agent Outcome E2E Harness 実装計画
targetKind: wiki
priorityGroup: wiki
priority: 5
status: draft
sourceConcept: spec/autonomous-coding-agent-foundation-concept.md
dependsOn:
  - spec/agent-runtime-interface-implementation-plan.md
  - spec/run-event-taxonomy-jsonl-export-implementation-plan.md
  - spec/tool-policy-gate-implementation-plan.md
  - spec/review-result-schema-implementation-plan.md
---

# Agent Outcome E2E Harness 実装計画

## 目的

NightWorkers の内蔵コーディングエージェントが、UI 操作ではなく outcome evidence によって検証できる状態を作る。

この計画のゴールは、Playwright の happy path を増やすことではない。agent run が、実 workspace、API、DB、run ledger、RunEvent、ToolPolicyGate、ReviewResult を通って、期待した final outcome に到達したかを継続検証できる harness を作ること。

## 優先順位 5 位にする理由

ここまでの優先計画で、以下の control plane 境界を固定している。

- `AgentRuntime`: 実行境界
- `RunEvent`: 証跡境界
- `ToolPolicyGate`: 安全境界
- `ReviewResult`: human outcome 境界

次に必要なのは、これらが単体で存在するだけでなく、1 つの run として破綻なくつながることを検証する E2E harness である。

現状の e2e は、run が作られたこと、event が保存されたこと、debug panel が開くことを確認している。しかし以下はまだ薄い。

- 実 workspace のファイル変更が期待通りか。
- diff が task の要求と対応しているか。
- verification event が outcome に反映されているか。
- policy block と tool failure が区別されているか。
- review result が最終 status を確定しているか。
- JSONL export で run evidence を復元できるか。
- 失敗時に runId、events、diff、trace を取り出せるか。

## 現状の前提

### 既存コード / テスト

- `tests/e2e/nightworkers-agent.spec.ts` は debug panel、single prompt、run outcome/events persistence を確認している。
- `tests/e2e/nightworkers-agent.spec.ts` の `@agent-live` は provider credential がある場合だけ実行する。
- `tests/e2e/helpers.ts` には `pollUntil` と `getJson` がある。
- `playwright.config.ts` は `pnpm dev` を起動し、`http://localhost:39174` を baseURL にする。
- `tests/services.run-control.test.ts` は outcome gate の基本挙動を unit test している。
- `tests/services.supervisor.test.ts` は LLM provider を mock して supervisor loop の基本停止を確認している。
- `tests/services.worker-tools.test.ts` は path / command policy と各 worker tool を unit test している。
- `tests/services.agent-runtime.test.ts` は runtime event mapping と runtime crash normalization を検証し始めている。

### 既存計画との関係

この harness は、以下の計画が一部未実装でも段階導入できるようにする。

- `AgentRuntime` 未完了なら、legacy run flow の outcome を検証する。
- `RunEvent` 未完了なら、legacy `eventType` で fallback する。
- `ToolPolicyGate` 未完了なら、worker tool 内 policy と `tool_result` error を検証する。
- `ReviewResult` 未完了なら、legacy review action と `run_outcome_decided` event を検証する。

ただし最終形では、canonical `RunEvent` と `ReviewResult` を assertion の中心にする。

## 非ゴール

- live LLM の品質評価を CI 必須にしない。
- Playwright で API を mock して「見た目だけ通る」テストにしない。
- すべての provider を E2E で網羅しない。
- browser/computer-use task はこの harness の初回対象にしない。
- PR 作成、git commit、git push はしない。
- flaky な長時間 agent benchmark は作らない。

## テストレーン設計

### Lane 1: Provider-Free Outcome E2E

通常の `@smoke` / `@regression` に入れる安定レーン。

外部 LLM API は使わない。ただし、UI、API、DB、workspace、run ledger は実経路を通す。

方針:

- Playwright の route mock は使わない。
- API process は実際に起動する。
- DB は test 用 SQLite を使うか、test run ごとに repository/task を分離する。
- LLM provider だけ deterministic test provider に差し替える。
- scratch workspace は test ごとに作成する。

### Lane 2: Live Agent E2E

`@agent-live` tag の任意実行レーン。

方針:

- credential がある時だけ実行する。
- provider/model routing が実際に動くことを確認する。
- 成功条件は UI 文言ではなく run outcome / diff / verification / review で見る。
- 失敗しても CI 必須にはしない。

### Lane 3: JSONL Replay / Fixture Regression

将来の replay レーン。

方針:

- JSONL export された run evidence を fixture として読み込む。
- run outcome、policy decision、review result を再評価できるようにする。
- 初回は plan only。JSONL export 実装後に追加する。

## Harness Components

### Scenario Definition

```ts
export type AgentOutcomeScenario = {
  id: string;
  title: string;
  prompt: string;
  workspaceSeed: Array<{
    path: string;
    content: string;
  }>;
  expected: {
    runStatus: string;
    taskStatus: string;
    changedFiles?: string[];
    fileAssertions?: Array<{
      path: string;
      includes?: string[];
      excludes?: string[];
    }>;
    requiredEventTypes?: string[];
    requiredRunEventTypes?: string[];
    review?: {
      action: 'complete' | 'request_follow_up' | 'cancel' | 'accept_risk';
      finalStatus: string;
    };
  };
};
```

Scenario は UI 文章ではなく outcome evidence を期待値にする。

### Scratch Workspace Factory

対象:

- `tests/e2e/agent-outcome/workspace.ts`

責務:

- temp directory を作る。
- `git init` する。
- seed files を書く。
- initial commit を作るか、少なくとも baseline diff を明確にする。
- test 後に削除する。

受け入れ条件:

- repo ごとに独立した localPath を持つ。
- テストが `/Users/y.noguchi/Code/nightWorkers` 本体の git state を汚さない。
- failure 時は `KEEP_E2E_WORKSPACE=1` で残せる。

### Test Repository / Task Factory

対象:

- `tests/e2e/agent-outcome/api-fixtures.ts`

責務:

- API 経由で repository を作る。
- API 経由で task/session を作る。
- run を開始する。
- run details を polling する。
- review を submit する。

受け入れ条件:

- UI 作成と API 作成を scenario ごとに選べる。
- runId / taskId / repositoryId を failure log に出せる。

### Deterministic Supervisor Provider

対象:

- `api/services/supervisor/test-provider.ts`
- `api/services/supervisor/llm-provider.ts`
- `tests/e2e/agent-outcome/scenarios/*.ts`

方針:

- `ACTIVE_LLM_PROVIDER=test` または `NIGHTWORKERS_TEST_AGENT_SCENARIO=<id>` で有効化する。
- test provider は provider-free E2E 専用にする。
- production build では無効化または明示 env がないと使えないようにする。
- scenario に応じて supervisor decision sequence を返す。

例:

- `create_file_basic`: `apply_patch` -> `run_verification` -> `stop completed`
- `policy_block_denied_path`: dangerous `read_file` or `run_command` -> policy block
- `verification_failure`: edit -> failing verification -> needs_human
- `missing_tool_call_budget`: repeated no tool call -> needs_human

受け入れ条件:

- 外部 LLM credential なしで安定実行できる。
- LLM provider 以外は実 runtime path を通る。
- scenario decision は run ledger に supervisor decision として残る。

### Outcome Assertion Library

対象:

- `tests/e2e/agent-outcome/assertions.ts`

責務:

- `assertRunOutcome`
- `assertRunLedger`
- `assertWorkspaceState`
- `assertDiffEvidence`
- `assertReviewResult`
- `assertJsonlExport`

受け入れ条件:

- 失敗時に期待値と実際の run status / event types / changed files を出す。
- canonical `RunEvent` がある場合は `payloadJson.runEvent.type` を優先する。
- canonical がない場合は legacy `eventType` へ fallback する。

### Failure Artifact Collector

対象:

- `tests/e2e/agent-outcome/artifacts.ts`

責務:

- run details JSON を保存する。
- run events JSONL を保存する。
- screenshot / Playwright trace と runId を紐付ける。
- `logs/supervisor-trace.log` の関連範囲を保存する。
- workspace diff を保存する。

受け入れ条件:

- failure 時に `test-results/nightworkers-agent-outcome/<scenario-id>/` に成果物が残る。
- final error message に artifact path が出る。

## 初期シナリオ

### Scenario 1: Basic File Create

目的:

- agent が新規ファイルを作り、verification を通し、`needs_review` で止まることを確認する。

期待:

- file exists: `src/fizzbuzz.ts` または scratch の指定ファイル
- diff includes expected content
- events include tool call / tool result / final report / outcome
- final run status is `needs_review`
- human review `complete` 後に task status is `completed`

### Scenario 2: Existing File Edit Requires Read

目的:

- read-before-edit contract が実行されることを確認する。

期待:

- first decision reads file
- second decision edits file
- edit succeeds
- changed file matches expected content
- review can complete

### Scenario 3: Policy Blocked Command

目的:

- dangerous command が actual execution 前に止まることを確認する。

期待:

- command not executed
- event includes `tool.policy_blocked` or legacy error tool result
- outcome is `needs_human`
- reason is `policy_violation` after ToolPolicyGate integration

### Scenario 4: Verification Failure

目的:

- verification failure が completed に上書きされないことを確認する。

期待:

- verification event exists
- run status is `needs_human` or `needs_review` depending current gate policy
- final assistant message does not claim unqualified success
- ReviewResult can request follow-up

### Scenario 5: JSONL Export Contains Evidence

目的:

- run ledger が JSONL export として復元可能なことを確認する。

期待:

- export has header
- export has seq-ordered events
- export has summary
- review result is included after review

この scenario は JSONL export 実装後に有効化する。

## 実装ステップ

### Step 1: Outcome E2E directory を追加する

対象:

- `tests/e2e/agent-outcome/`

追加:

- `scenarios.ts`
- `workspace.ts`
- `api-fixtures.ts`
- `assertions.ts`
- `artifacts.ts`

受け入れ条件:

- 既存 `tests/e2e/helpers.ts` と重複しすぎない。
- helper は Playwright test から直接使える。
- workspace cleanup が実装される。

### Step 2: deterministic test provider を追加する

対象:

- `api/services/supervisor/llm-provider.ts`
- `api/services/supervisor/test-provider.ts`
- `tests/e2e/agent-outcome/scenarios.ts`

変更:

- `ACTIVE_LLM_PROVIDER=test` を test env 限定で受ける。
- scenario id から decision sequence を返す。
- production / normal dev で accidental use しない guard を入れる。

受け入れ条件:

- provider credential なしで supervisor decision を返せる。
- unknown scenario は明示 error。
- test provider decision は ledger に残る。

### Step 3: scratch workspace factory を追加する

対象:

- `tests/e2e/agent-outcome/workspace.ts`

実装:

- `fs.mkdtemp`
- seed files write
- `git init`
- optional initial commit
- cleanup / keep mode

受け入れ条件:

- test run が本体 repo を変更しない。
- cleanup failure は test failure にしないが warning として出す。

### Step 4: API fixtures を追加する

対象:

- `tests/e2e/agent-outcome/api-fixtures.ts`

実装:

- `createRepositoryForWorkspace`
- `createTaskForScenario`
- `startRun`
- `pollRunUntilTerminal`
- `submitReview`
- `fetchRunDetails`
- `fetchJsonlExport`

受け入れ条件:

- runId / taskId / repositoryId を返す。
- terminal polling は timeout 時に last run details を返す。
- API failure message に response body を含める。

### Step 5: outcome assertions を追加する

対象:

- `tests/e2e/agent-outcome/assertions.ts`

実装:

- run status assertion
- event assertion
- diff assertion
- file content assertion
- review result assertion
- JSONL assertion

受け入れ条件:

- legacy event と canonical RunEvent の両方を読める。
- expected changed file がない場合は明確に失敗する。
- terminal quality decision と retryable recovery を混ぜない。

### Step 6: provider-free E2E spec を追加する

対象:

- `tests/e2e/nightworkers-agent-outcome.spec.ts`

初期 test:

- `basic file create reaches needs_review and completes after review @smoke`
- `policy blocked command records needs_human @regression`
- `verification failure is not auto-completed @regression`

受け入れ条件:

- `pnpm test:e2e:smoke` が provider credential なしで通る。
- test は UI submit と API verification の両方を含む。
- screenshot/trace だけでなく run events と workspace diff を failure artifact に残す。

### Step 7: live agent lane を整理する

対象:

- `tests/e2e/nightworkers-agent.spec.ts`
- `tests/e2e/nightworkers-agent-outcome-live.spec.ts`

方針:

- `@agent-live` は credentials がある時だけ実行する。
- provider smoke と agent outcome live を分ける。
- live lane でも success criteria は UI 文言ではなく outcome evidence にする。

受け入れ条件:

- credentials がない環境では skip 理由が明確。
- live failure 時に runId と artifact path が出る。

### Step 8: ReviewResult / JSONL 接続を assertion に足す

対象:

- `tests/e2e/agent-outcome/assertions.ts`
- `tests/e2e/nightworkers-agent-outcome.spec.ts`

変更:

- review result が実装済みなら `reviews` を assert する。
- JSONL export が実装済みなら export content を assert する。
- 未実装の場合は legacy fallback で test を維持する。

受け入れ条件:

- ReviewResult 実装後、review assertion を required にできる。
- JSONL export 実装後、JSONL assertion を required にできる。

### Step 9: scripts / docs を更新する

対象:

- `package.json`
- `README.md`
- `spec/docs/testing.md` または既存 docs

追加 script 案:

```json
{
  "test:e2e:agent-outcome": "playwright test tests/e2e/nightworkers-agent-outcome.spec.ts",
  "test:e2e:agent-live": "playwright test --grep @agent-live"
}
```

受け入れ条件:

- provider-free harness の実行方法が README か docs から辿れる。
- live lane は optional であることが明記される。

## 受け入れ条件

- provider credential なしで動く deterministic outcome E2E がある。
- E2E は UI 操作だけでなく API run details と workspace state を検証する。
- test ごとに scratch workspace と repository/task/run が分離される。
- run ledger の event sequence が検証される。
- policy block と normal tool failure が区別される。
- review result または legacy review event による final outcome が検証される。
- JSONL export が実装済みなら evidence export も検証される。
- failure artifact に runId、taskId、events、diff、screenshot、trace が残る。
- `@smoke` は provider credential なしで安定する。
- `@agent-live` は credentials がある時だけ任意実行される。

## 検証コマンド

```bash
pnpm typecheck
pnpm test run tests/services.run-control.test.ts
pnpm test run tests/services.agent-runtime.test.ts
pnpm test:e2e:smoke
pnpm test:e2e:regression
```

live credential がある時だけ:

```bash
pnpm test:e2e --grep @agent-live
```

## リスクと対策

| リスク | 対策 |
| --- | --- |
| provider-free E2E が実 runtime を通らず mock UI になる | route mock を禁止し、UI/API/DB/workspace は実経路を通す |
| deterministic provider が production で誤使用される | `NODE_ENV === 'test'` または明示 env guard を必須にする |
| scratch workspace が本体 repo を汚す | test ごとに temp repo を作り、repository localPath も temp にする |
| live agent lane が flaky になる | `@agent-live` を optional にし、CI 必須にしない |
| outcome と retryable recovery が混ざる | terminal status assertion と retry/requeue assertion を別 helper にする |
| JSONL / ReviewResult 未実装で harness が詰まる | legacy event fallback で先に harness を導入し、実装後に required assertion へ昇格する |

## 後続タスクへの接続

この計画が完了すると、次の task が実装しやすくなる。

1. JSONL replay / import regression。
2. browser / computer-use outcome harness。
3. sandbox runtime E2E。
4. LLM reviewer / rubric plugin の評価 harness。
5. memory feedback が次 run に効いたかを検証する long-run scenario。

## 完了判定

この task は、provider credential なしの deterministic E2E が実 UI/API/DB/workspace/run ledger を通り、agent outcome、policy decision、review finalization、failure artifacts を検証できる状態になったら完了とする。
