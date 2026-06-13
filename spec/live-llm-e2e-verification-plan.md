# Live LLM E2E Verification 計画

Status: evidence-contract-split

## 目的

LLM を使った実装で、過去に成立していた実行ロジックが新機能実装によって壊れる問題を抑制する。

この計画では、LLM の応答を実際に待ち、NightWorkers が登録済み Project の repo root を基準に worker tool 経由で実装し、run / task / file / activity evidence が整った場合だけ「実装できた」と判定する E2E を追加する。

通常の `pnpm verify` は高速で安定した deterministic gate として維持し、外部 LLM・認証情報・長時間実行に依存する live E2E は明示的な full/live gate として段階導入する。

## 現状

`package.json` には以下がある。

- `test:e2e`: Playwright 全体。
- `test:e2e:smoke`: `@smoke` のみ。
- `test:e2e:regression`: `@regression` のみ。
- `test:e2e:agent-outcome`: `tests/e2e/nightworkers-agent.spec.ts`。
- `test:e2e:agent-live`: `@agent-live` のみ。
- `verify`: `verify:base` と `verify:desktop`。
- `verify:full`: `verify` と `pnpm test run`。

`tests/e2e/nightworkers-agent.spec.ts` の `@agent-live` は、`NIGHTWORKERS_LIVE_LLM_E2E=1` と provider credentials がある場合だけ disposable workspace で real run を開始し、run / workspace / Todo / verification evidence を確認する。通常 verify には含めない。

`playwright.config.ts` は `NIGHTWORKERS_E2E=1 pnpm dev` で API / web を起動し、`x-nightworkers-e2e: 1` header を付ける。E2E 専用の非 production bypass は既に使える。

## 方針

### 1. 成功定義を UI 表示ではなく evidence に置く

Live E2E の合格条件は、LLM の最終テキストではなく以下を満たすことにする。

- task に `task_runs` が 1 件以上作られる。
- run が `running` から terminal state へ進む。
- terminal state が `completed` または設計上許容する `needs_review` である。
- disposable git workspace 内の期待ファイルが実際に変更される。
- 変更は登録済み repository の `localPath` 配下にだけ発生する。
- `task_events` / activity に `run_started`、LLM request / response、tool execution、verification 相当の evidence が残る。
- `llm-trace.jsonl` または API evidence から、固定エラー文への差し替えではなく provider response が処理されたことを確認できる。

`task_messages` だけを合格条件にしない。`task_messages` だけで `task_runs` が無い場合は intake/chat 止まりとして失敗にする。

### 2. テストを 3 層に分ける

`verify` に何でも入れない。壊れやすさ、実行時間、外部依存で分ける。

| 層 | コマンド | 中身 | 位置づけ |
| --- | --- | --- | --- |
| Deterministic regression | `pnpm verify` | typecheck / lint / supervisor regression / desktop build | 毎回実行する実装完了 gate |
| E2E regression | `pnpm verify:e2e` | fixture provider または mockable path で Playwright が run evidence を確認 | 新機能で UI/API/run 境界を触った時の必須 gate |
| Live LLM E2E | `pnpm verify:live` | real provider credentials がある時だけ LLM 実装を待つ | release 前、provider/runtime 変更時、手動 nightly |

初期実装では `pnpm verify` に live LLM E2E は入れない。外部 provider の速度、quota、network、認証状態で通常実装 gate が不安定になるため。

ただし `verify:full` には deterministic E2E まで入れる候補にする。Live LLM は `verify:live` として別名にし、明示的に実行する。

### 3. Live E2E の fixture project を固定する

Live E2E はテストごとに disposable git workspace を作る。

初期 fixture:

```text
README.md
package.json
src/greeting.ts
tests/greeting.test.ts
```

`package.json` には短い deterministic scripts を置く。

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

LLM への依頼は曖昧にしない。

```text
src/greeting.ts の greet(name) を実装し、tests/greeting.test.ts が通るようにしてください。
既存の export 名は変えないでください。
完了前に package.json の test script を実行してください。
```

期待する evidence:

- `src/greeting.ts` が `TODO` から実装済みに変わる。
- `pnpm test` または該当 verification command が run event / tool result に残る。
- git diff が期待ファイルだけに収まる。

### 4. 既存ロジック破壊を検出する baseline suite を先に固定する

Live E2E は費用がかかるので、過去に壊れたロジックは deterministic regression にも落とす。

初期 baseline:

- intake/chat と execution run の境界: `task_messages` だけで完了扱いしない。
- `shouldStartImmediateWorkbenchRun(...)` の code / docs / planning 判定。
- `startTaskRun(...)` が repository root を実作業 workspace として渡す。
- provider adapter は provider 呼び出し、JSON 抽出、schema 検証、互換正規化だけを担当する。
- supervisor prompt / skill reference が verify phase で repo scripts を選ぶ。
- provider-side activity は worker tool 実行の証拠として扱わない。

この層は `tests/supervisor-*` または route/service tests に入れ、`test:supervisor-regression` へ追加する。

### 5. Playwright helper を outcome-oriented にする

`tests/e2e/helpers.ts` に以下の helper を追加する。

- `createDisposableCodingWorkspace()`
- `registerE2eRepository(request, workspaceDir)`
- `createImplementationTask(request, repositoryId, prompt)`
- `startOrSubmitWorkbenchRun(page, prompt)`
- `waitForRunTerminal(request, taskId, timeoutMs)`
- `readTaskRunEvidence(request, taskId)`
- `expectWorkspaceDiff(workspaceDir, expectedFiles)`
- `cleanupE2eTaskAndRepository(request, ids, workspaceDir)`

待機は UI の sleep ではなく API polling にする。

terminal state の timeout は初期 5-8 分にする。timeout 時は以下を failure message に含める。

- task id
- latest task status
- latest run status
- last 20 activity events
- workspace git diff
- provider credential mode

### 6. `@agent-live` を本物の live run に置き換える

`tests/e2e/nightworkers-agent.spec.ts` の `@agent-live` を以下に変える。

1. provider credentials が無ければ skip。
2. disposable workspace を作る。
3. repository を登録する。
4. implementation task を作る、または Workbench submit から immediate run を起こす。
5. run が作られるまで待つ。
6. run terminal state まで待つ。
7. workspace diff、run evidence、verification evidence を assert する。
8. cleanup する。

UI 経由だけにこだわらない。初期は API で repository/task/run を作り、run outcome contract を確実に固定する。UI submit 経路は第 2 ケースとして追加する。

### 7. verify scripts を段階追加する

初期 scripts 案:

```json
{
  "scripts": {
    "test:e2e:agent-outcome": "playwright test tests/e2e/nightworkers-agent.spec.ts --grep @agent-outcome",
    "test:e2e:agent-live": "playwright test tests/e2e/nightworkers-agent.spec.ts --grep @agent-live",
    "verify:e2e": "pnpm test:e2e:agent-outcome",
    "verify:live": "pnpm verify && pnpm test:e2e:agent-live",
    "verify:full": "pnpm verify && pnpm test run && pnpm verify:e2e"
  }
}
```

`verify` へ `verify:live` は入れない。入れるなら、local config で opt-in できる `VERIFY_LIVE_LLM=1` のような gate を追加してからにする。

現在の repository scripts では bun を使うため、実行名は次の通り。

```bash
bun run test:e2e:agent-live
bun run verify:live
```

`verify:live` は明示実行用であり、`verify` / `verify:base` には含めない。

### 8. 実装完了時の運用定義

通常の実装完了:

```text
pnpm verify
```

UI/API/run 境界を触った実装完了:

```text
pnpm verify
pnpm verify:e2e
```

Supervisor / provider / worker tool / prompt / skill reference を触った実装完了:

```text
pnpm verify
pnpm verify:e2e
pnpm verify:live
```

Release 前:

```text
pnpm verify:full
pnpm verify:live
```

「実行されエラーがなければ実装できた」の定義は、live LLM については `verify:live` が通ることではなく、`verify:live` が run evidence と workspace evidence を確認して通ること、とする。

## 実装フェーズ

### Phase 0: baseline assertion の棚卸し

- 既存の `test:supervisor-regression` に含めるべき壊れやすい contract を列挙する。
- intake/chat と execution run の混同を検出する service / route test を追加する。
- provider / supervisor 境界の regression を追加する。

完了条件:

- `pnpm test:supervisor-regression` が、過去に起きた「実装したつもりで実行されない」系の破壊を検出できる。

### Phase 1: deterministic agent outcome E2E

- `@agent-outcome` を追加する。
- fixture provider または test runtime で、run 作成、terminal state、workspace diff、activity evidence を確認する。
- `verify:e2e` を追加する。

完了条件:

- 外部 LLM credentials が無くても `pnpm verify:e2e` が実行できる。

### Phase 2: live LLM E2E

- [x] `@agent-live` を real provider run に置き換える。
- [x] provider credentials が無い場合は skip し、skip 理由を明確にする。
- [x] credentials と `NIGHTWORKERS_LIVE_LLM_E2E=1` がある場合は disposable workspace で実装依頼を出し、run terminal evidence と file diff を確認する。

完了条件:

- `bun run test:e2e:agent-live` が、LLM 応答待ちを含む実経路で合否を出す。

### Phase 3: verify integration

- [ ] `verify:e2e` を追加する。
- [x] `verify:live` を追加する。
- [ ] `verify:full` に deterministic E2E を入れるか決める。
- [x] `verify` 本体には live LLM を入れない。ただし provider/runtime 境界の変更では `verify:live` を必須運用にする。

完了条件:

- 通常の `verify` は安定性を維持する。
- live LLM が必要な変更では、明示的な command で evidence 付き合否が出る。

### Phase 4: evidence reporting

- timeout / failure 時に task id、run id、last events、git diff、trace path を出す。
- Playwright trace と API evidence を失敗時に残す。
- 必要なら `test-results/agent-live/<taskId>/` に evidence JSON を保存する。

完了条件:

- 失敗時に「LLM が悪いのか」「intake 止まりか」「run は動いたが verification が無いのか」「ファイルが違う場所に書かれたのか」を判別できる。

## 採用しないこと

- `pnpm verify` に live LLM E2E を無条件で入れない。
- LLM の最終文だけを成功条件にしない。
- 一時ディレクトリへの作成やコピーを実装完了 evidence にしない。
- provider 側 tool activity を NightWorkers worker tool execution の代わりにしない。
- ユーザー文言の keyword / regex 判定で E2E の成否や routing を固定しない。

## 未決事項

- `verify:full` に `verify:e2e` を初期から入れるか、最初は別 command のままにするか。
- live provider はまず Codex / OpenAI / Azure OpenAI のどれを primary として CI/manual 運用するか。
- `needs_review` を live E2E の合格 terminal state に含めるか。初期は実装 diff と verification evidence がある場合だけ許容する。
- live E2E を nightly automation にするか、provider/runtime 変更時の手動 gate に留めるか。
