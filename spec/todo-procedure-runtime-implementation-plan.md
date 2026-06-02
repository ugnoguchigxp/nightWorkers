---
title: Todo Procedure Runtime 実装計画
targetKind: wiki
priorityGroup: implementation-plan
status: implemented
---

# Todo Procedure Runtime 実装計画

作成日: 2026-06-02

## 実装状況

2026-06-02 時点で、Phase 1 から Phase 7 までの初期実装を完了した。

- `task_run_todos` の永続化、migration、bootstrap fallback、`GET /runs/:id` の read path を追加した。
- ThreadTimeline に compact Todo progress UI を追加し、run detail refetch で status 変更を反映する。
- Task intake planner、built-in procedure registry、Todo-scoped context snapshot を追加した。
- single-agent runtime のまま Todo を `seq` 順に 1 件ずつ Supervisor に渡し、Todo ごとの `turn.started` / `turn.finished` / `run.runtime_finished` に `todoId` / `todoSeq` / `procedureId` を残す。
- Todo completion gate result を `completion_gate_result` に保存し、失敗時は後続 Todo を `skipped` にする。
- final report に Todo summary を追加し、JSONL summary に Todo terminal status / gate result を含める。

残る作業は Phase 8 の E2E scenario 拡充と、将来候補である Todo 単位 retry / detail UI / sub-agent 化である。これらは初期 runtime 契約の実装後に進める別 slice とする。

## 目的

NightWorkers の単タスク成功率を高めるため、1 つのユーザー依頼を run-scoped な TodoList に分解し、Todo ごとに適切な procedure を選択し、必要な context を注入し、completion gate を通してから次 Todo へ進む実行基盤を作る。

この計画は sub-agent 化を目的にしない。まずは single-agent runtime の内側で、複数オーダーを安全に順次処理できる状態を作る。単タスクの成功率、報告品質、検証品質が十分に安定した後に、Personal Devin 化に向けた sub-agent、parallel execution、再実行 orchestration を検討する。

## 背景

現状の初期ラウンドでは、Supervisor がタスク種別や進め方を判断する。しかしユーザー依頼に複数のオーダーが含まれる場合、1 つの大きな prompt として扱うと次の問題が起きる。

- 複数オーダーの一部だけを完了して final report してしまう。
- どの作業にどの procedure が使われたか追えない。
- context が全体向けに膨らみ、個別 Todo に必要な情報が薄まる。
- 検証が Todo ごとではなく run 全体の曖昧な確認になる。
- 途中で失敗した時、どこまで完了したか ledger から判断しにくい。

この計画では、初期ラウンドで TodoList を作り、各 Todo を小さな実行単位として扱う。Todo は SQLite に保存し、run ledger と JSONL export/replay に接続できる形にする。

## 非目標

- sub-agent / multi-agent の導入。
- Todo の並列実行。
- Follow-up run generation。
- Outcome Dashboard の実装。
- 外部 plugin / external MCP tool の拡張。
- container sandbox の導入。
- UI の大規模再設計。

## Workbench 構想との接続前提

`spec/chat_first_agent_workbench_concept.md` は、この計画の後に進める上位構想である。Todo Procedure Runtime は Personal Devin 型 Workbench の中核実行基盤になるが、Workbench の Task / Session / Queue / Artifact を置き換えない。

Workbench の Task は、仕様書・実装計画・Issue・改善依頼のような、ユーザーが Queue で追跡したい作業単位である。今この文書自体が Workbench Task に相当する。TodoList はその Task を 1 回の NightWorkers run で実行するための短期的な実装マイルストーンであり、調査、実装、テスト、ドキュメント、検証、報告などを Todo として扱う。

境界:

- Workbench の `Task` / `Session` / `Queue` はユーザー体験と運用単位であり、Queue の一覧・優先度・件数・Archive はこの粒度で管理する。
- Todo は 1 つの Workbench Task / NightWorkers run の内部実装マイルストーンである。
- TodoList は `task_runs` に従属し、Queue item や Chat Session の代替テーブルにしない。
- Todo は短時間で消化される前提でよい。Queue の可視性、未着手件数、優先度管理を Todo に担わせない。
- Todo progress UI は ThreadTimeline へ最初に実装するが、後で Session item や Artifact Pane へ移せる小さな表示単位として作る。
- Completion gate は Todo 単位の実行品質チェックであり、Conductor Agent の最終 Done 判断を置き換えない。後続の Conductor は Todo gate result / final judgment / ledger を読んで追加レビューや follow-up task を判断する。
- Procedure registry は NightWorkers 組み込み safe data から始めるが、将来 contextStill 側の手続き・ルールを参照できるよう、snapshot には `source` / `id` / `digest` / `version` を残す。
- JSONL export / replay は run の監査単位を維持しつつ、Workbench の Artifact Pane で Todo plan / status / gate result を復元できる形にする。

このため、実装では `runId` を主キーにした内部制御を維持しつつ、外側の `taskId` / `repositoryId` / 将来の Project Session から参照しやすい API response と JSONL summary を残す。

階層イメージ:

```text
Workbench Project
  -> Workbench Task / Session
       -> NightWorkers Run
            -> TodoList
                 -> Todo: investigate
                 -> Todo: implement
                 -> Todo: test
                 -> Todo: document
                 -> Todo: verify/report
```

## レビューで見つかった改善点と反映方針

この計画は runtime、DB、LLM intake、procedure、context、completion gate、UI、JSONL/replay がまたがるため、1 PR で実装するとレビュー不能になりやすい。実装は後述の phase 単位ではなく、さらに PR review 可能な slice に分ける。

反映した主な改善点:

- Todo を単一タスクでも常に作る方針を、UI と E2E の受け入れ条件まで明示する。
- Todo status 更新が UI に反映される realtime / query invalidation 経路を明示する。
- LLM intake の malformed response / 過剰分割 / 曖昧依頼を、単一 Todo fallback または `needs_human` に寄せる。
- Procedure は executable plugin ではなく safe data として扱い、selector と gate で共通利用する。
- JSONL export/replay は Todo metadata を含めるだけでなく、replay evidence と diagnostics の対象にする。
- 実装後に `pnpm verify` だけでなく、段階ごとの targeted test と E2E を明示する。

## 到達目標

この計画の完了時点で、NightWorkers は次の状態になる。

- 初期ラウンドで Workbench Task / Run を実装マイルストーンとして単一 Todo / 複数 Todo に分解できる。
- 複数オーダーは `task_run_todos` に保存される。
- Todo ごとに `taskType` と `procedureId` が選ばれる。
- Todo ごとに必要な context を構成し、Supervisor に渡せる。
- Todo ごとに completion gate を評価できる。
- Todo の状態が `pending` / `running` / `passed` / `failed` / `skipped` / `needs_human` として残る。
- 単一タスクでも TodoList は 1 件作成され、通常 UI に進捗として表示される。
- Todo が完了すると UI 上でチェック状態に変わり、未完了 / 実行中 / 要人間判断が区別できる。
- `task_events` の canonical run event に `todoId` / `todoSeq` / `procedureId` が入る。
- final report に Todo ごとの完了状態、検証、残リスクが含まれる。
- TodoRuntime は single-agent のまま動作し、将来 sub-agent へ差し替え可能な境界を持つ。

## 全体設計

### 実行フロー

1. `startTaskRun` で run を作成する。
2. `TaskIntakePlanner` がユーザー依頼を TodoList に分解する。
3. TodoList を SQLite の `task_run_todos` に保存する。
4. 各 Todo に `taskType` を付与する。
5. `ProcedureSelector` が Todo に対応する procedure を選ぶ。
6. Todo 単位で context construction / context injection を行う。
7. `TodoExecutor` が先頭の `pending` Todo を `running` にして Supervisor に渡す。
8. Supervisor は Todo の procedure と context に従って tool を使う。
9. `TodoCompletionGate` が Todo の完了条件を評価する。
10. gate に pass した Todo は `passed`、不足があれば追加実行または `needs_human` にする。
11. 全 Todo が terminal status になったら run finalization へ進む。

### PR review 可能な slice

| Slice | 範囲 | 完了条件 |
| --- | --- | --- |
| A | Todo persistence + API read path | `GET /runs/:id` が todos を返し、既存 run detail が壊れない |
| B | Todo progress UI | 単一 Todo / 複数 Todo が通常 UI に表示され、status 変更で表示が更新される |
| C | Procedure registry | built-in procedure を safe data として parse / select できる |
| D | Task intake planner | prompt から TodoList を作り、malformed response は fallback する |
| E | Todo-scoped context | Todo ごとの context snapshot と selected procedure を runtime に渡せる |
| F | Sequential Todo executor | Todo を seq 順に実行し、event に Todo metadata を残す |
| G | Completion gate | taskType ごとの gate を評価し、fail / needs_more_evidence を保存する |
| H | Final report + JSONL/replay + E2E | Todo summary と Todo metadata を export/replay/E2E で確認できる |

原則として Slice A/B/C は runtime 挙動を変えずに先に実装する。LLM intake と runtime 実行に入る前に、永続化・表示・procedure parsing の境界を固める。

### sub-agent を見送る理由

この段階で必要なのは複数 agent ではなく、複数オーダーを順番に壊さず処理する制御である。sub-agent 化すると、agent ごとの context、ledger、status、error handling、UI、review 粒度が増え、1 run の真実性が固まる前に orchestration が複雑化する。

そのため最初は同じ `runId` の中に複数 Todo を持つ。将来 sub-agent 化する場合も、TodoRuntime の executor を差し替えるだけで済むようにする。

## DB スキーマ

### `task_run_todos`

新規テーブルを追加する。

| Column | Type | 意味 |
| --- | --- | --- |
| `id` | text primary key | Todo ID |
| `run_id` | text not null | `task_runs.id` |
| `seq` | integer not null | run 内の順序 |
| `title` | text not null | Todo の短い名前 |
| `description` | text | Todo の詳細 |
| `task_type` | text not null | `code_change` / `test_change` / `documentation` / `review` / `investigation` / `verification` |
| `status` | text not null | `pending` / `running` / `passed` / `failed` / `skipped` / `needs_human` |
| `procedure_id` | text | 選択された procedure |
| `procedure_snapshot` | json | 実行時に使った procedure の digest / title / sections |
| `context_snapshot` | json | Todo 用に構成した context |
| `completion_gate_result` | json | gate 評価結果 |
| `depends_on` | json | 依存する Todo seq / id。初期は空配列でよい |
| `status_reason` | text | `failed` / `skipped` / `needs_human` の短い理由 |
| `started_at` | timestamp | Todo 開始時刻 |
| `completed_at` | timestamp | Todo 完了時刻 |
| `created_at` | timestamp | 作成時刻 |
| `updated_at` | timestamp | 更新時刻 |

制約:

- `(run_id, seq)` を unique にする。
- `run_id` は `task_runs.id` に cascade delete する。
- `status` は schema / service 層で union として扱う。
- migration は `drizzle/migrations/` に追加し、既存 SQLite/libSQL の migration flow を使う。
- `procedure_snapshot` / `context_snapshot` / `completion_gate_result` は JSON だが、API response では schema を持つ typed object として返す。
- `depends_on` は Phase 2 までは空配列でもよい。ただし Todo failure 時に後続 Todo を `skipped` にする根拠として必要になるため、schema には最初から含める。
- `status_reason` は Workbench / Artifact 側で failure や needs human の理由を短く表示するために使う。詳細な gate result は `completion_gate_result` に残す。

### `task_events` との関係

既存の `task_events` テーブル自体には最初から `todo_id` カラムを追加しない。初期実装では canonical run event の `data` に以下を含める。

```ts
{
  todoId,
  todoSeq,
  procedureId
}
```

理由:

- 既存 event schema と realtime delivery への影響を最小化する。
- JSONL export/replay は canonical `runEvent.data` から Todo 関連情報を復元できる。
- UI や query で Todo filtering が必要になった時点で `task_events.todo_id` の追加を検討する。

### Realtime contract

Todo status 更新は `task_run_updated` だけに依存しない。Todo 更新時は最低限 `task_event_created` に Todo metadata を含め、frontend は event 受信後に run detail query を invalidation して最新 TodoList を取得する。

初期方針:

- Todo 作成 / 更新は DB source of truth。
- realtime message は軽量な通知であり、TodoList 全体の source of truth にはしない。
- optimistic merge は UI の応答性が必要になった時だけ追加する。
- status 更新と event append の順序は、DB 更新後に event append とする。UI は event 受信後に refetch すれば checked state を取得できる。

## 型と schema

### TaskType

初期対象:

```ts
type TaskType =
  | 'code_change'
  | 'test_change'
  | 'documentation'
  | 'review'
  | 'investigation'
  | 'verification';
```

用途:

- procedure selection
- context injection
- completion gate
- verification strategy
- final report contract

### TodoStatus

```ts
type TodoStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'needs_human';
```

`passed` は Todo 単位の completion gate を満たしたことを意味する。run 全体の `completed` とは別物として扱う。

## Procedure 形式

Procedure は実行可能コードではなく safe data として扱う。最初は repository-local な任意ファイル読み込みではなく、NightWorkers 組み込み registry から始める。

配置案:

```text
api/services/procedures/builtin/
  code-change.md
  test-change.md
  documentation-spec.md
  documentation-readme.md
  review-code.md
  investigation.md
  verification.md
```

形式:

```md
---
id: code-change
taskTypes: [code_change]
priority: 80
---

## Use When

...

## Workflow

...

## Completion Gate

- ...

## Verification Strategy

- ...

## Report Contract

- ...
```

読み込む section:

- `Use When`
- `Workflow`
- `Completion Gate`
- `Verification Strategy`
- `Report Contract`

禁止:

- shell script
- executable hook
- arbitrary plugin instruction
- credential / secret
- destructive command recommendation

## 各 procedure の初期内容

### `code-change`

目的:

- コード変更タスクを、探索、編集、検証、報告まで完了させる。

Completion Gate:

- 依頼対象に対応する diff がある。
- 変更対象ファイルを編集前に読んでいる。
- 変更理由が tool observation / file evidence に基づいている。
- `git diff` が収集されている。
- 適切な verification を実行している。
- 失敗した verification を隠していない。
- final report に変更内容、検証結果、残リスクがある。

### `test-change`

目的:

- テスト追加・修正が、特定条件だけを通す実装になっていないか確認する。

Completion Gate:

- テストが仕様・回帰条件を表している。
- production code が test fixture にだけ合わせて退化していない。
- 必要なら negative case / boundary case がある。
- 既存テストを壊していない。
- mock / stub が過剰に実装の欠陥を隠していない。

### `documentation-spec`

目的:

- 実装可能な設計書・計画書を作る。

Completion Gate:

- 目的が明確。
- 対象範囲と非目標がある。
- 現行実装の入口ファイルがある。
- DB / API / UI / test などの変更面が分かれている。
- phase と acceptance criteria がある。
- 検証コマンドがある。
- 既存 spec / backlog と重複していない。

### `review-code`

目的:

- コードレビューを findings first で行う。

Completion Gate:

- findings が severity 順になっている。
- file / line 根拠がある。
- bug / regression / missing test を優先している。
- summary が findings より前に出ていない。
- 問題なしの場合も residual risk が書かれている。

## 実装フェーズ

### Phase 1: Todo persistence

対象:

- `api/db/schema.ts`
- `drizzle/` migration
- `shared/schemas/nightworkers.schema.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `tests/routes.nightworkers.test.ts`

実装:

- `taskRunTodos` table を追加する。
- Todo row の create / update / list repository functions を追加する。
- `taskRunDetailSchema` に `todos` を追加する。
- `GET /runs/:id` が todos を返すようにする。
- Todo status 更新時に run detail の refetch で最新状態が取れるようにする。

受け入れ条件:

- run に紐づく TodoList を保存・取得できる。
- `runId + seq` が unique である。
- run 削除時に Todo も削除される。
- 既存の `GET /runs/:id` response に `todos: []` が追加されても既存 UI / tests が壊れない。

検証:

- `pnpm test run tests/routes.nightworkers.test.ts`
- `pnpm typecheck`

### Phase 1.5: Todo progress UI read path

対象:

- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `tests/e2e/nightworkers-agent.spec.ts`

実装:

- frontend type に `TaskRunTodo` を追加する。
- run detail の `todos` を `ThreadTimeline` に渡す。
- Todo が 1 件でも compact progress UI を表示する。
- `task_event_created` / `task_run_updated` 受信時に run detail query を invalidation する。

受け入れ条件:

- 単一 Todo run で Todo progress が表示される。
- `pending` / `running` / `passed` / `failed` / `skipped` / `needs_human` が別表示になる。
- Todo status refetch 後、`passed` は checked 状態になる。
- Debug を開かなくても Todo progress が見える。

検証:

- mocked API response で Todo progress component を確認する。
- `pnpm test:e2e:smoke`

### Phase 2: Task intake planner

対象:

- `api/services/task-intake/`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/supervisor/prompt.ts`
- `tests/services.task-intake.test.ts`

実装:

- `TaskIntakePlanner` を追加する。
- 入力 prompt から TodoList を JSON schema で返す。
- 単一タスクも 1 Todo として保存する。
- Todo は最大 8 件に制限する。
- Todo title は短く、UI 表示に耐える長さにする。
- `procedureId` は intake の責務にしない。intake は `taskType`、title、description、dependency hint までを返す。
- 曖昧な Todo、依存関係が不明な Todo、危険な Todo は `needs_human` へ誘導する。
- LLM が壊れた JSON を返した場合は fallback として単一 Todo を作る。
- LLM が過剰分割した場合は、最大 8 件までに圧縮し、圧縮理由を run event に残す。

受け入れ条件:

- 複数オーダーが TodoList に分解される。
- 単一オーダーは単一 Todo になる。
- Todo が多すぎる場合は summary と `needs_human` reason が残る。
- intake output は schema validation され、invalid item は保存前に fallback または `needs_human` へ寄せる。

検証:

- mocked LLM で単一 Todo / 複数 Todo / malformed response をテストする。
- `pnpm test run tests/services.task-intake.test.ts`

### Phase 3: Procedure registry and selector

対象:

- `api/services/procedures/`
- `api/services/procedures/builtin/*.md`
- `api/services/supervisor/prompt.ts`
- `tests/services.procedures.test.ts`

実装:

- built-in procedure markdown を読み込む registry を作る。
- frontmatter と allowed sections を parse する。
- `taskType` に応じて procedure を選ぶ。
- 1 Todo に注入する procedure は原則 1 個、補助 procedure は最大 2 個までに制限する。
- procedure digest を `procedure_snapshot` に保存する。

受け入れ条件:

- `code_change` Todo に `code-change` procedure が選ばれる。
- `test_change` Todo に `test-change` procedure が選ばれる。
- procedure は executable instruction としてではなく safe data として扱われる。
- unknown task type は `investigation` に fallback する。

検証:

- `pnpm test run tests/services.procedures.test.ts`

### Phase 4: Todo-scoped context injection

対象:

- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/context-still/`
- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/NativeAgentRuntime.ts`
- `tests/services.agent-runtime.test.ts`

実装:

- run 全体の context compile 後、Todo 用 context を構成する。
- Todo context には次を含める。
  - Todo title / description
  - taskType
  - selected procedure
  - run-level compiled context digest
  - included memory refs
  - previous Todo summaries
- Supervisor に渡す prompt は「現在 Todo の context」を主にする。
- 前 Todo の結果は summary と changed files のみ渡し、全 transcript を渡さない。
- 初期実装では Todo ごとに contextStill `context_compile` を再実行しない。run-level compile を source of truth とし、Todo-scoped context はその digest と Todo 情報から構成する。後続で contextStill が Todo 単位 compile を安定提供できる場合だけ差し替える。

受け入れ条件:

- Todo ごとに contextSnapshot が保存される。
- Todo 2 以降に previous Todo summary が入る。
- prompt が全 Todo を一度に処理しようとしない。
- selected procedure の digest と Todo context の digest が保存される。
- contextSnapshot から、Workbench の Artifact Pane で「この Todo に何の procedure / context が使われたか」を復元できる。

検証:

- mocked runtime で Todo context の構造を確認する。
- `pnpm test run tests/services.agent-runtime.test.ts`

### Phase 5: Sequential Todo executor

対象:

- `api/services/todo-runtime/`
- `api/services/agent-runtime/NativeAgentRuntime.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `tests/services.todo-runtime.test.ts`

実装:

- `TodoRuntime` を追加する。
- `pending` Todo を seq 順に実行する。
- Todo 開始時に `todo.started` 相当の run event を記録する。
- Supervisor loop input に `todoContext` を追加する。
- tool call / tool result / supervisor decision の canonical run event に Todo metadata を含める。
- Todo が `needs_human` / `failed` になったら run 全体の継続可否を判断する。

受け入れ条件:

- Todo は seq 順に実行される。
- Todo 1 が pass するまで Todo 2 は実行されない。
- Todo metadata が run events に残る。
- Todo failure で曖昧に completed にならない。
- run cancellation / stale active run recovery 時に、`running` Todo は `failed` または `needs_human` に確定する。

検証:

- mocked Supervisor で Todo 3 件の順次実行をテストする。
- Todo 2 failure 時の run status をテストする。
- `pnpm test run tests/services.todo-runtime.test.ts`

### Phase 6: Completion gate

対象:

- `api/services/completion-gates/`
- `api/services/todo-runtime/`
- `api/services/run-control/run-outcome-gate.ts`
- `tests/services.completion-gates.test.ts`

実装:

- taskType ごとの gate evaluator を追加する。
- gate result は `pass` / `warning` / `needs_more_evidence` / `needs_human` に分ける。
- `needs_more_evidence` の場合、Supervisor に追加 verification / evidence collection を促す。
- gate retry は最大 2 回までにする。
- gate result を `completion_gate_result` に保存する。

受け入れ条件:

- code_change で diff なし final は pass しない。
- test_change で verification なし final は pass しない。
- documentation で acceptance criteria なし spec は warning または needs_more_evidence になる。
- gate failure が run ledger に残る。
- gate retry 回数と最後の gate result が `completion_gate_result` に残る。

検証:

- `pnpm test run tests/services.completion-gates.test.ts`

### Phase 7: Final report contract

対象:

- `api/services/final-judgment/`
- `api/services/todo-runtime/`
- `api/modules/nightworkers/nightworkers.service.ts`
- `tests/services.final-judgment.test.ts`

実装:

- final report に Todo summary を含める。
- 各 Todo について以下を出す。
  - status
  - procedureId
  - changed files
  - verification result
  - completion gate result
  - residual risk
- run 全体の conclusion は Todo statuses から作る。
- final judgment には Todo gate result を evidence として含める。ただし最終 Done 可否は後続の Conductor review が上書き・追加判断できる境界を残す。

受け入れ条件:

- 全 Todo pass なら run outcome は completed / needs_review の候補になる。
- Todo に `needs_human` が残る場合、run outcome は completed にならない。
- final report からどの Todo が何をしたか分かる。

検証:

- `pnpm test run tests/services.final-judgment.test.ts`

### Phase 8: E2E regression

対象:

- `tests/e2e/nightworkers-agent-outcome.spec.ts`
- `tests/e2e/agent-outcome/scenarios.ts`

実装:

- 複数 Todo の deterministic scenario を追加する。
- 例:
  - README 更新 + test 追加。
  - コード修正 + regression test。
  - spec 作成 + no duplicate check。
- TodoList、procedure selection、completion gate、final report を E2E で確認する。

受け入れ条件:

- provider credential なしで Todo sequential run を検証できる。
- Todo metadata が API response / JSONL export に残る。
- 単一 Todo run でも Todo progress UI が表示される。
- Todo completion event 後、該当 Todo が checked 状態になる。
- final report が Todo 別に読める。
- JSONL replay で Todo plan / Todo status / gate result の evidence が復元される。
- JSONL summary から TodoList の terminal status 一覧を復元できる。

検証:

- `pnpm test:e2e:agent-outcome`
- `pnpm verify`

## RunEvent taxonomy への追加候補

既存 taxonomy に以下を追加する。

- `todo.plan_created`
- `todo.started`
- `todo.procedure_selected`
- `todo.context_injected`
- `todo.gate_started`
- `todo.gate_finished`
- `todo.finished`

初期実装では既存 `system.warning` / `supervisor.decision` / `verification.*` に `data.todoId` を入れるだけでも動く。ただし JSONL replay と UI の読みやすさを考えると、上記 taxonomy は Phase 5 までに追加する。

taxonomy 追加時の検証:

- `shared/schemas/nightworkers.schema.ts` の `runEventTypeSchema` と `api/services/run-events/types.ts` の `RUN_EVENT_TYPES` を同期する。
- JSONL parser が新しい event type を invalid schema として落とさない。
- replay evidence に Todo 関連 event count と terminal Todo status を含める。

## API 変更

### `GET /runs/:id`

`todos` を含める。

```ts
{
  ...run,
  events,
  reviews,
  todos: TaskRunTodo[]
}
```

`todos` は run detail に含めるが、Workbench の Task / Session 一覧では必要な場合だけ集約値を使う。Session item の主状態は Task / Run status のままとし、Todo status は内部進捗として扱う。

Queue / Session list で表示する場合も、Todo の各行を Queue item として展開しない。表示するなら `3/5 milestones passed`、`needs_human milestoneあり` のような集約に留める。

### 将来候補

初期実装では追加しない。

- `GET /runs/:id/todos`
- `PATCH /runs/:id/todos/:todoId`
- `POST /runs/:id/todos/:todoId/retry`

これらは Todo 単位の詳細 UI / retry / sub-agent 化が必要になった時点で追加する。

## UI 方針

Outcome Dashboard は作らない。ただし TodoList は debug 専用にしない。Claude Code などの agent UI と同様に、run 中の通常表示として Todo progress を出す。

初期 UI の目的:

- ユーザーが「今どの Todo を処理しているか」を timeline を掘らずに確認できる。
- 単一タスクでも内部 Todo が 1 件作成されたら表示する。
- Todo は Queue item ではなく、その Task の実装マイルストーンとして表示する。
- Todo が完了したらチェックが入り、実行中 Todo は spinner / active state で分かる。
- `needs_human` / `failed` / `skipped` はチェックではなく warning / error state として表示する。
- Todo title は短く、詳細や procedureId は必要なら tooltip / debug details に寄せる。
- Debug 表示時は Todo start / finish / gate result / procedure selection event も表示する。
- final report にも Todo summary を含め、UI progress と報告内容が矛盾しないようにする。

表示状態:

| Todo status | UI |
| --- | --- |
| `pending` | 未チェックの待機行 |
| `running` | active indicator |
| `passed` | checked |
| `failed` | error icon |
| `skipped` | muted / skipped |
| `needs_human` | warning icon |

実装対象:

- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`

実装:

- `GET /runs/:id` の `todos` を frontend type に追加する。
- `ThreadWorkspace` から `latestRun.todos` または run detail の todos を `ThreadTimeline` に渡す。
- `ThreadTimeline` の上部、最初の assistant streaming preview より前に compact Todo progress を表示する。
- realtime `task_run_updated` または `task_event_created` で Todo state が変わった時、query invalidation または optimistic merge で表示を更新する。
- Todo が 1 件だけでも表示する。これにより、単一タスクでも procedure / gate が効いていることをユーザーが確認できる。
- Todo progress component は props で TodoList を受け取る表示専用 component として切り出す。後続の Workbench で Artifact Pane や Session item detail に再利用できるよう、ThreadTimeline 固有の state へ密結合しない。

後続 UI:

- Todo ごとの event filter。
- Todo retry。

これらの詳細 UI はこの計画の範囲外にする。初期実装で作るのは、通常 timeline 上の compact Todo progress UI までとする。

## 失敗時の扱い

### Intake failure

- malformed response は単一 Todo fallback。
- 依頼が曖昧すぎる場合は Todo を `needs_human` にし、run も `needs_human` にする。
- fallback 単一 Todo を作る場合も、fallback reason を `todo.plan_created` または `system.warning` に残す。

### Procedure selection failure

- unknown type は `investigation` procedure に fallback。
- procedure parse failure は `system.error` を残して fallback procedure を使う。

### Todo execution failure

- Todo を `failed` または `needs_human` にする。
- 後続 Todo が `depends_on` で失敗 Todo に依存している場合は `skipped` にし、`status_reason` に依存元を残す。
- 独立 Todo の継続可否は Phase 5 では conservative に扱い、1 件 failure で run 全体を `needs_human` にする。

### Completion gate failure

- `needs_more_evidence` は最大 2 回まで追加実行する。
- それでも満たせなければ Todo を `needs_human` にする。

### Realtime / UI failure

- Todo persistence と runtime は UI 更新に依存しない。
- realtime message が落ちた場合でも、再取得した `GET /runs/:id` の `todos` で正しい checked state を復元できる。
- UI が Todo status を楽観更新した場合でも、DB の Todo status を最終状態として上書きする。

## 実装順の推奨

1. Phase 1: Todo persistence
2. Phase 1.5: Todo progress UI read path
3. Phase 3: Procedure registry and selector
4. Phase 2: Task intake planner
5. Phase 4: Todo-scoped context injection
6. Phase 5: Sequential Todo executor
7. Phase 6: Completion gate
8. Phase 7: Final report contract
9. Phase 8: E2E regression

Phase 1.5 を早める理由は、Todo を runtime 内部だけに閉じず、単一タスクでも通常 UI に進捗表示する価値を先に確認するためである。Phase 3 を Phase 2 より先に置く理由は、TaskIntakePlanner の出力に `procedureId` を早く固定しすぎないためである。先に procedure registry の安全な形を作り、intake は `taskType` と Todo 分解を主責務にする。

## 成功指標

定性的:

- 複数オーダーの一部だけを完了して報告するケースが減る。
- code / test / docs / review で final report の品質が安定する。
- Todo ごとに何を根拠に完了したか ledger で追える。
- ユーザーが「単発タスクならかなり任せられる」と感じる。

定量的:

- deterministic agent outcome E2E に複数 Todo scenario が 3 件以上ある。
- Todo completion gate の unit test が taskType ごとに最低 2 件ある。
- 単一 Todo run の UI progress E2E が 1 件以上ある。
- `pnpm verify` が通る。
- JSONL export に Todo metadata が含まれる。

## Personal Devin 化への接続

この計画が安定した後、次の機能に進む。

- Todo 単位の retry。
- Todo 単位の詳細 UI。
- Todo 単位の reviewer evaluation。
- Todo executor の sub-agent 化。
- 独立 Todo の並列実行。
- follow-up run generation。
- sandbox runtime。

sub-agent 化は、TodoRuntime が安定し、Todo 単位の ledger / gate / report / retry が成立してから検討する。
