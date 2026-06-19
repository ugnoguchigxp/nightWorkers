# native/API レーン Plan Mode 誤誘導の調査結果と改修計画

## 目的

native/API レーンで、ユーザーが明示的に計画を依頼していない通常依頼まで Plan Mode 側へ誘導される問題を解消する。

目標は、ユーザーが「計画してください」「実装計画を作ってください」「設計方針を整理してください」のように計画を明示した場合だけ Plan Mode に入り、軽微な修正、調査、レビュー、検証、設定変更、リファクタなどは必要最小限の確認後に実行へ進める状態にすること。

## 現状

現行コードでは、通常の Workbench composer 送信は `intent='intake'` として扱われる。

その後、`handleWorkbenchIntakeMessage()` が Round 1 classifier を呼び、返された `jobType` に応じて以下のいずれかに分岐している。

- `planning`: Design Questionnaire を生成し、run は開始しない
- `blueprint` / `ui_ux`: Blueprint artifact を生成し、run は開始しない
- `minor_code_edit` / `major_code_edit` / `docs` / `runtime_debug`: 即時 run を開始する
- それ以外: intake メッセージだけを保存し、run は開始しない

問題は、即時 run の対象が狭すぎることと、未定義 jobType の routing fallback が planning 側に倒れていること。

## 確認した主なコード箇所

- `api/modules/nightworkers/nightworkers.workbench-routing.ts`
  - `shouldStartImmediateWorkbenchRun()`
  - `routingForWorkbenchJobType()`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
  - `handleWorkbenchIntakeMessage()`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
  - `resolveExecutionModeFromMessages()`
  - `startTaskRun()`
- `api/services/supervisor/prompt.ts`
  - `buildRound1PromptPacket()`
- `api/services/supervisor/prompt-tool-registry.ts`
  - `jobTypes`
  - `jobTypeDescriptions`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
  - `modeGuidance()`

## 原因

### 1. 即時 run 対象が狭い

`shouldStartImmediateWorkbenchRun()` は現在、次の jobType だけを即時 run 対象にしている。

- `minor_code_edit`
- `major_code_edit`
- `docs`
- `runtime_debug`

そのため、以下のような実行可能な依頼が即時 run に進まない。

- `review`
- `investigation`
- `test_and_verification`
- `config`
- `refactor`
- `test`
- `dependency`
- `data_migration`
- `code`
- `git_release`
- `git`
- `release`

特に `review` は native/API runtime に `executionMode='review'` が存在するにもかかわらず、Workbench intake から即時 run に入らない。

### 2. routing fallback が planning 側に倒れる

`routingForWorkbenchJobType()` の fallback は、`general_answer` 以外を `primaryMode='planning'` / `phase='plan'` として扱う。

このため、明示 branch がない jobType は、実行可能な作業であっても Plan 系の表示・処理に寄りやすい。

### 3. Round 1 classifier の jobType 説明が over-planning を誘発しやすい

Round 1 prompt では `planning` が「実装前の計画、分解、方針整理」と広く定義されている。

一方で、`config`、`refactor`、`test`、`dependency` などは「初期実装では直接実行しない」という説明になっている。

API provider はこの説明を読むため、通常の設定変更、検証、整理、レビュー再開のような依頼を非即実行 jobType に分類しやすい。

### 4. `startTaskRun()` 以降は主因ではない

`resolveExecutionModeFromMessages()` は、保存済み message metadata から次のように executionMode を決めている。

- `planning` / `blueprint` / `ui_ux`: `planning`
- `review`: `review`
- `runtime_debug`: `runtime_debug`
- `general_answer`: `general_answer`
- その他: `implementation`

ここは比較的妥当で、主な問題は `startTaskRun()` に到達する前の Workbench intake にある。

## 目標状態

- ユーザーが計画を明示した場合だけ Plan Mode / questionnaire / blueprint planning に進む。
- 軽微な修正、レビュー、調査、検証、設定変更、依存関係変更、リファクタは、intake 後に run を開始できる。
- `review` は native/API `executionMode='review'` として実行される。
- `runtime_debug` は従来通り `executionMode='runtime_debug'` として実行される。
- 実装作業系は `executionMode='implementation'` として実行される。
- Plan artifact / draft spec / blueprint から「今すぐ実装開始」した場合は、既存通り `executionMode='implementation'` で handoff を扱う。

## 改修方針

### 1. planning 判定を厳格化する

`buildRound1PromptPacket()` の base policy に、planning の選択条件を明記する。

追加する趣旨:

- `planning` はユーザーが計画、実装計画、設計方針、仕様策定、質問票化、事前整理を明示した場合だけ選ぶ。
- ユーザーが修正、実装、確認、調査、レビュー、テスト、設定変更、依存更新を依頼している場合は、planning にしない。
- 迷う場合は、実行可能な jobType を選ぶ。

ユーザー文言の正規表現判定は追加しない。分類は引き続き LLM classifier と prompt contract に持たせる。

### 2. 即時 run 対象を拡張する

`shouldStartImmediateWorkbenchRun()` を拡張し、次の jobType は `intent='intake'` から即時 run を開始できるようにする。

- `minor_code_edit`
- `major_code_edit`
- `docs`
- `runtime_debug`
- `review`
- `investigation`
- `test_and_verification`
- `config`
- `refactor`
- `test`
- `dependency`
- `data_migration`
- `code`
- `git_release`
- `git`
- `release`

ただし、次は即時 run 対象にしない。

- `planning`
- `blueprint`
- `ui_ux`
- `general_answer`
- `research`
- `script_code_edit`

`research` は外部情報や最新情報を伴うため、即時 run に含めるかは別途設計する。

### 3. jobType から executionMode への変換を明示する

Workbench intake で即時 run を開始する際、すべてを `implementation` に固定せず、jobType に応じて executionMode を決める helper を追加する。

想定:

- `review` -> `review`
- `runtime_debug` -> `runtime_debug`
- `general_answer` -> `general_answer`
- `planning` / `blueprint` / `ui_ux` -> `planning`
- その他 -> `implementation`

ただし Workbench intake の即時 run では、`planning` / `blueprint` / `ui_ux` は run を開始しないため、この helper は主に `review` と `runtime_debug` のために使う。

### 4. routingForWorkbenchJobType の fallback を planning にしない

明示 branch を追加する。

- `review`: `primaryMode='review'`, `phase='review'`
- `investigation`: `primaryMode='investigation'`, `phase='investigate'`, `overlays=['evidence']`
- `test_and_verification`: `primaryMode='test_and_verification'`, `phase='verify'`
- `docs`: `primaryMode='docs'`, `phase='execute'`
- `config`: `primaryMode='code_edit'`, `workKinds=['config']`, `phase='execute'`
- `refactor`: `primaryMode='code_edit'`, `workKinds=['refactor']`, `phase='execute'`
- `dependency`: `primaryMode='code_edit'`, `workKinds=['dependency']`, `phase='execute'`
- `data_migration`: `primaryMode='code_edit'`, `workKinds=['data_migration']`, `phase='execute'`
- `git_release` / `git` / `release`: release/git 系の phase に寄せる

fallback は planning ではなく、保守的に `general_answer` または `investigation` に倒す。

### 5. jobTypeDescriptions を現行実行能力に合わせる

`config`、`refactor`、`test`、`dependency`、`data_migration` などの説明から「初期実装では直接実行しない」という趣旨を外す。

代わりに、次のように書く。

- `config`: 設定ファイル、runtime settings、policy、manifest の確認または変更
- `refactor`: 既存挙動を維持した構造整理、重複削減、責務整理
- `test`: テスト追加、テスト修正、テスト失敗の修正
- `dependency`: package manager、lockfile、依存関係設定の確認または変更
- `data_migration`: schema、migration、backfill、データ変換に関わる変更

これにより classifier が「分類はできるが実行できない」と解釈する余地を減らす。

## 非目標

- ユーザー文言を正規表現や keyword 判定で分類する実装はしない。
- native/API runner の provider 呼び出し責務を llm-provider 側へ分散しない。
- Plan Mode artifact / Design Questionnaire / Blueprint の既存体験を廃止しない。
- `blueprint` / `ui_ux` を通常実装 run に混ぜない。
- Codex SDK lane への fallback は追加しない。
- 大規模な supervisor architecture refactor はしない。

## テスト計画

### Workbench route tests

`tests/nightworkers-workbench-routes/routes-workbench-01.test.ts` に追加する。

1. `review` intake は即時 run を開始する
   - Round 1 mock: `{ jobType: 'review' }`
   - 期待:
     - `body.run` が存在する
     - `run.contextSnapshot.executionMode` または runtimeOptions が `review`
     - assistant intake message は保存されない
     - system `run_started` message に `intakeJobSelection.jobType='review'`

2. `investigation` intake は即時 run を開始する
   - 期待:
     - `body.run` が存在する
     - executionMode は `implementation` または専用 mode がない場合の設計通り
     - routingHypothesis は `planning` ではない

3. `test_and_verification` intake は即時 run を開始する
   - 期待:
     - `body.run` が存在する
     - routingHypothesis phase は `verify`

4. `config` / `refactor` intake は implementation run を開始する
   - 期待:
     - `body.run` が存在する
     - `executionModeSource='workbench_intake'`
     - routingHypothesis は `planning` ではない

5. 明示 `planning` は従来通り questionnaire path
   - 期待:
     - `body.run` は null
     - `design_questionnaire_ready` message が保存される

6. `blueprint` / `ui_ux` は従来通り artifact path
   - 期待:
     - `body.run` は null
     - Blueprint artifact が生成される

### Runtime tests

`tests/services.native-api-request-adapter.test.ts` または既存 runtime orchestration tests に追加する。

- `executionMode='review'` は role `review` に routing される
- `executionMode='implementation'` は toolChoice `required`
- `executionMode='planning'` は toolChoice `auto` のまま

### Regression tests

既存の以下を維持する。

- code-change intake が即時 run を開始する
- runtime_debug intake が即時 run を開始する
- planning intake が questionnaire を生成する
- plan-complete artifact の「今すぐ実装開始」は direct run になる

## 手動確認

修正後、UI から次を確認する。

1. `コードレビューから再開できますか？`
   - run が開始される
   - Plan questionnaire に入らない
   - Review guidance で差分確認に進む

2. `設定ファイルの軽微な修正をしてください`
   - run が開始される
   - implementation mode で read/search/edit に進む
   - Plan artifact だけで止まらない

3. `まず実装計画を作ってください`
   - Plan questionnaire または plan artifact 側に入る
   - 実装 run は開始されない

4. `この Blueprint で画面案を作ってください`
   - Blueprint artifact 側に入る
   - 通常 implementation run には入らない

## リスク

- 即時 run 対象を広げることで、本当に相談だけしたい依頼が実行に進む可能性がある。
  - 緩和策: `general_answer` と `planning` の説明を明確化し、実行を伴わない軽い回答は `general_answer` に分類させる。

- `review` を即時 run にすると、レビュー中に明確な修正まで進む可能性がある。
  - 緩和策: native/API review guidance は「修正が必要で明確な場合は tool を使ってよい」としているため、必要なら review mode の mutation 条件を別途引き締める。

- `config` / `dependency` / `data_migration` を即時 run に含めると、危険変更に進む可能性がある。
  - 緩和策: destructive / production risk overlay は別途 routing で付与し、危険操作は tool policy と context_decision で止める。

## 最初に着手する実装順

1. `shouldStartImmediateWorkbenchRun()` の即時 run jobType を拡張する。
2. jobType から executionMode への helper を追加し、Workbench intake の `startTaskRun()` に渡す。
3. `routingForWorkbenchJobType()` に主要 jobType の明示 branch を追加する。
4. `buildRound1PromptPacket()` の base policy と `jobTypeDescriptions` を更新する。
5. Workbench route tests を追加する。
6. native/API request adapter または orchestration tests を追加する。
7. focused test を実行し、必要なら UI 手動確認を行う。

## 完了条件

- 明示 planning 依頼だけが Plan Mode に入る。
- `review`、`investigation`、`test_and_verification`、`config`、`refactor` などの通常依頼が intake 後に run を開始する。
- Plan Mode / Blueprint / Questionnaire の既存テストが壊れていない。
- run context と task messages から、実際の routing と visible state が一致していることを確認できる。
