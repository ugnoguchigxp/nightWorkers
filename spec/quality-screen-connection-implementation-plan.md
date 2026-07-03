# Quality Screen Connection 実装計画

## 目的

Quality 画面を、保存済みの Quality Run、coverage summary、E2E 結果、capability 状態に正しく接続し、テスト結果や品質情報が空表示に見える状態を解消する。

この計画は Project Detail の Quality タブに限定する。Coverage Autonomy Gate の runtime 判定、Settings の `nightworkers-quality.json` 保存、Supervisor の品質ゲート Todo 生成は既存機能として扱い、今回の中心にはしない。

## レビュー結論

この計画は、下記の「採用する API contract」と「実装順序」に従えばすぐ実装に移れる。実装前に追加のプロダクト判断が必要な論点は残さない。

実装時に守る判断:

- DB schema は変更しない。既存 `project_quality_runs` の JSON columns と run metadata を使う。
- 既存 `latestUnitRun`, `latestE2eRun`, `runningRuns` は互換維持する。
- `all` run 由来の表示対象は既存 `latestE2eRun` に混ぜず、追加 field で扱う。
- UI は run 種別を推測しない。API が coverage 表示対象 run と E2E 表示対象 run を明示する。
- E2E artifact parser は追加するが、artifact が無い project でも run output と missing-artifact state を表示して情報ゼロにしない。

## 背景

現在の実装には次の接続点がある。

- `GET /api/repositories/:id/quality` が `capabilities`, `latestUnitRun`, `latestE2eRun`, `runningRuns` を返す。
- `POST /api/repositories/:id/quality/runs` が `unit`, `e2e`, `all` の Quality Run を作成し、実行結果を `project_quality_runs` に保存する。
- `project_quality_runs` には `coverage_summary_json`, `coverage_gate_json`, `e2e_summary_json`, `latest_output`, `error_message` が保存できる。
- `ProjectDetailScreen` の Quality タブは `latestUnitRun.coverageSummary` と `latestE2eRun.e2eSummary` だけを描画に使う。

現状の弱点:

- `all` run に保存された coverage / E2E 情報が Quality 画面の `latestUnitRun` / `latestE2eRun` に反映されない。
- E2E 結果は exit code から作る最小 summary で、suite、test 数、失敗内容、duration を取り込んでいない。
- coverage table は `coverage-summary.json` の `total` row だけを表示し、file rows を捨てている。
- capability 不足、coverage parse failure、artifact 未生成、command output が UI 上で見分けにくい。
- 既存テストは Quality 画面の実表示に接続されておらず、空表示の回帰を検知できない。

## 範囲

### 実装すること

1. Quality overview API が、表示に必要な最新 run を明示的に返す。
2. `all` run の coverage / E2E artifact を Quality 画面に表示できるようにする。
3. coverage summary から `total` と file rows を分けて表示する。
4. E2E 実行結果を構造化 artifact から読み取り、suite/test/failure/duration を表示する。
5. artifact が無い、parse に失敗した、capability が不足している、実行が失敗した、の状態を画面で区別する。
6. Backend と UI の focused tests を追加し、今回の接続不全を再発検知できるようにする。

### 実装しないこと

- Coverage Autonomy Gate の判定基準変更。
- `nightworkers-quality.json` の設定 UI 変更。
- Supervisor / provider prompt の品質ゲート方針変更。
- Queue / Worker execution lifecycle の変更。
- E2E runner 自体の導入。既存 project の `test:e2e` script が出せる artifact を取り込む。
- live LLM test や external service test の常時実行。

## ベースライン採取

実装前に次を確認する。

1. Focused test の現在値:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx
```

期待結果:

- 既存テストは通る。
- ただし Quality 画面の happy path 表示を検証していないことを確認する。

2. API contract の現在値:

- `GET /api/repositories/:id/quality` が `latestUnitRun`, `latestE2eRun`, `runningRuns` だけを返すこと。
- `GET /api/repositories/:id/quality/runs` が履歴一覧を返すが、Quality 画面では使われていないこと。

3. UI 変換の現在値:

- `coverageRowsFromSummary(...)` が `file === 'total'` に固定されていること。
- `e2eRowsFromSummary(...)` が suite なし summary を 1 行の synthetic row にしていること。

## 実装方針

### 1. Quality overview contract を表示単位へ寄せる

対象:

- `shared/schemas/project-detail.schema.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `api/modules/project-detail/project-detail.repository.ts`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`

変更内容:

- `ProjectQualityOverview` に次の field を追加する。

```ts
latestCoverageRun: ProjectQualityRun | null;
latestE2eResultRun: ProjectQualityRun | null;
latestAllRun: ProjectQualityRun | null;
recentRuns: ProjectQualityRun[];
```

既存 field は維持する。

```ts
latestUnitRun: ProjectQualityRun | null; // runType === 'unit'
latestE2eRun: ProjectQualityRun | null; // runType === 'e2e'
runningRuns: ProjectQualityRun[];
```

追加 field の意味:

- `latestCoverageRun`: `coverageSummary` または `coverageGate` を持つ最新 run。`runType` は `unit` または `all`。
- `latestE2eResultRun`: `e2eSummary` を持つ最新 run。`runType` は `e2e` または `all`。
- `latestAllRun`: 最新の `runType === 'all'` run。
- `recentRuns`: 最新 10 件程度の run。status area と regression test の根拠に使う。

Repository helper は次を追加するか、service 内の小さな helper として実装する。

```ts
selectLatestQualityRunWithArtifact(runs, 'coverage');
selectLatestQualityRunWithArtifact(runs, 'e2e');
```

DB query を増やしすぎないため、初期実装では `repo.listProjectQualityRuns(repositoryId)` の最新順結果から service 側で選ぶ。run 数が増えて performance 問題が見えた段階で SQL filter に移す。

完了条件:

- `all` run が最新で、coverage summary と E2E summary を持つ場合、Quality overview からその run を表示対象として選べる。
- `unit` run が最新 coverage、`e2e` run が最新 E2E の場合も既存通り表示できる。
- 既存 route response schema と TypeScript type が一致している。
- `latestE2eRun` は従来通り `runType === 'e2e'` の最新 run を表し、`all` run は `latestE2eResultRun` で拾う。

Focused tests:

```bash
bunx vitest run tests/project-detail-backend.test.ts
```

追加ケース:

- `all` run 完了後、overview が coverage 表示対象と E2E 表示対象の両方に同じ run を返す。
- `unit` run と `all` run が混在する場合、coverage artifact を持つ最新 run を選ぶ。
- `latestE2eRun` は `e2e` run、`latestE2eResultRun` は `all` run を返せることを別々に検証する。
- another repository の run が混ざらない。

### 2. Quality run artifact の読み取りを分離する

対象:

- `api/modules/project-detail/project-detail.service.ts`
- 必要なら `api/services/quality/` 配下に artifact parser を追加する。

変更内容:

- coverage artifact 読み取りは既存 `readCoverageArtifacts(...)` を維持しつつ、missing と parse failure を状態として区別できる戻り値にする。
- E2E artifact 読み取りを `minimalE2eSummary(exitCode)` だけにしない。
- 初期対応では Playwright JSON reporter 互換の artifact を優先する。
  - 候補 path: `test-results/e2e-results.json`, `playwright-report/results.json`, `playwright-report/test-results.json`。
  - repo 標準が未確定の場合は、既知 JSON artifact path を順に読むだけに留め、`test:e2e` script や Playwright config を自動変更しない。
- artifact が無い場合は `minimalE2eSummary` fallback を残すが、`state = 'missing_artifact'` として UI に明示する。
- artifact state は DB schema へ新規 column を足さず、run の `errorMessage` と overview projection で表現する。

E2E parser の最小 contract:

```ts
type E2EArtifactReadResult =
  | { state: 'ready'; summary: E2ESummary; message: null }
  | { state: 'missing_artifact'; summary: E2ESummary; message: string }
  | { state: 'parse_failed'; summary: E2ESummary; message: string };
```

`parse_failed` でも command の exit code は保持し、run 自体を消さない。

完了条件:

- E2E artifact がある場合、suite 名、test 数、duration、last failure を保存できる。
- Artifact が無い場合でも、単なる空 table ではなく「実行はされたが artifact が無い」状態を返せる。
- parse failure は run の `errorMessage` または structured state に残る。

Focused tests:

```bash
bunx vitest run tests/project-detail-backend.test.ts
```

追加ケース:

- Playwright JSON 風 artifact から `e2eSummary.suites` を作る。
- Artifact parse failure でも run は完了/失敗状態として保存され、UI が理由を表示できる payload を持つ。
- Artifact が無い successful E2E run は `total: 0` の fallback になるが、missing artifact message を保持する。
- Artifact path が存在しない場合に例外で request 全体を落とさない。

### 3. Quality 画面を overview contract に接続する

対象:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

変更内容:

- coverage rows は `quality.latestCoverageRun?.coverageSummary` だけを使う。
- E2E rows は `quality.latestE2eResultRun?.e2eSummary` だけを使う。
- coverage table は `total` と file rows を表示する。
  - `total` は summary row として先頭固定。
  - file rows は `total` 以外を path 順、または低 coverage 順で表示する。
- E2E table は `e2eSummary.suites` を表示する。
- `latestOutput`, `errorMessage`, `coverageGate`, capability missing を Quality 画面内の status area に出す。
- Run buttons の disabled reason を title だけに閉じず、画面上にも短く表示する。

完了条件:

- Quality 画面で、run 実行前、capability 不足、artifact 未生成、parse failure、成功、失敗を見分けられる。
- `all` 実行後に coverage と E2E の両方が同じ run から表示される。
- coverage file rows が表示され、`total` だけの table にならない。
- E2E suite rows が表示され、失敗時は last failure または output 参照が出る。
- `latestUnitRun` / `latestE2eRun` が null でも `latestCoverageRun` / `latestE2eResultRun` があれば空表示にならない。

Focused tests:

```bash
bunx vitest run tests/project-detail-screen.test.tsx
```

追加ケース:

- `QualityReportPanel` を export するか小コンポーネントへ分離し、fixture の overview から coverage rows が表示されること。
- `all` run fixture から coverage と E2E の両方が表示されること。
- capability 不足時にボタン disabled と理由表示が出ること。
- parse failure / missing artifact message が空 table より優先されること。
- `latestUnitRun: null`, `latestE2eRun: null`, `latestCoverageRun/latestE2eResultRun: all-run` の fixture で情報が表示されること。

### 4. coverage row 変換を file-level 表示へ直す

対象:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- 変換 helper を分離する場合は `src/modules/nightworkers/qualityRows.ts` など。

変更内容:

- `coverageRowsFromSummary(...)` の `file === 'total'` filter を撤去する。
- `total` row と file rows を明確に分ける。
- `uncoveredLines` が配列でない形式でも壊れないようにする。
- 不正 metric は `0` 固定で握りつぶすのではなく、行単位で unknown 表示にできるようにする。
- helper は UI component から切り出して unit test しやすくする。最小候補は `src/modules/nightworkers/qualityRows.ts`。

row type は number 固定をやめる。

```ts
type CoverageDisplayValue = number | null;
```

`CoverageCell` は `null` を `—` として表示し、色判定をしない。

完了条件:

- Vitest/V8 の `coverage-summary.json` 形式で `total` と file rows が表示できる。
- 不正な row が混ざっても画面全体を壊さない。
- file rows が無い summary の場合でも total row は表示される。

Focused tests:

```bash
bunx vitest run tests/project-detail-screen.test.tsx
```

追加ケース:

- `total` と 2 file rows を持つ coverage summary から 3 rows が描画される。
- `uncoveredLines` が空配列、未定義、文字列混入の場合でも fallback 表示になる。
- metric pct が欠落している row は `—` 表示になり、0% と誤表示しない。

### 5. API/UI のエラー表示を固定文だけにしない

対象:

- `api/modules/project-detail/project-detail.service.ts`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- i18n dictionaries

変更内容:

- API は `missing_artifact`, `parse_failed`, `missing_capability`, `not_run` を区別できる state/message を返す。
- UI は state ごとに短い説明を表示する。
- LLM/provider 由来ではない deterministic status message は許容するが、実行 output がある場合は `latestOutput` への導線を残す。
- 初期実装の status area は Quality panel 上部に 1 つ置き、coverage と E2E それぞれの最新 run status を 1 行ずつ表示する。
- raw output は常時全面表示しない。`latestOutput` は折りたたみ `<details>` または既存 drawer pattern があればそれに合わせる。

完了条件:

- 「一切の情報が出ない」状態を、少なくとも理由付き status として説明できる。
- 実行済み run の `command`, `exitCode`, `status`, `completedAt`, `errorMessage` が UI から確認できる。

Focused tests:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx
```

追加ケース:

- coverage parse failure が UI に表示される。
- missing capability が disabled reason として表示される。
- failed run の `exitCode`, `errorMessage`, command のいずれかが status area に出る。

### 6. 最終検証

実装後は次を実行する。

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx tests/services.coverage-gate.test.ts
bun run verify:fast
bun run verify
```

期待結果:

- 追加した focused tests が、Quality 画面の happy path と failure state を検証している。
- Coverage Gate 既存テストが regress していない。
- `bun run verify` が通る。

`bun run verify` が既存の無関係な失敗で止まる場合:

- 失敗テスト、失敗ファイル、今回変更との関連有無を記録する。
- 今回触った範囲は focused tests と `verify:fast` で確認する。
- 無関係な失敗を隠して完了扱いにしない。

## 実装順序

1. Backend baseline test を追加し、`all` run が overview の表示対象にならない現在の欠落を赤にする。
2. `ProjectQualityOverview` schema に `latestCoverageRun`, `latestE2eResultRun`, `latestAllRun`, `recentRuns` を追加する。
3. `getProjectQuality(...)` で最新 run list から coverage/E2E artifact を持つ run を選ぶ。
4. Backend focused test を通し、API contract の赤を緑にする。
5. E2E artifact parser を追加し、fallback summary と missing/parse state を分ける。
6. Backend focused test を再実行する。
7. coverage row helper を component から切り出し、`total` + file rows + unknown metric 表示を unit test で固める。
8. UI の Quality panel を `latestCoverageRun` / `latestE2eResultRun` contract に接続する。
9. UI tests を追加し、coverage/E2E/capability/error state を検証する。
10. Focused tests、`verify:fast`、`verify` を順に実行する。

## リスクと対策

- リスク: `all` run と `unit` / `e2e` run の優先順位が曖昧になる。
  - 対策: API 側で `latestCoverageRun` と `latestE2eResultRun` を決め、UI 側に推測させない。

- リスク: E2E artifact path が project ごとに違う。
  - 対策: 初期は Playwright JSON の既知 path と fallback を実装し、将来設定化できる parser 境界にする。

- リスク: coverage summary の file row が多く UI が重くなる。
  - 対策: 初期は上位 N 件または scroll table にし、summary row は常に表示する。

- リスク: 状態表示が増えすぎて Quality 画面がノイズ化する。
  - 対策: status area は最新 run の command/status/error を短く出し、raw output は折りたたみまたは drawer にする。

- リスク: 既存 Coverage Autonomy Gate と Project Detail Quality Run の意味が混ざる。
  - 対策: この計画では Project Detail の手動 Quality Run 表示に限定し、runtime finalize gate の判定基準は変更しない。

## 完了条件

- `all`, `unit`, `e2e` の各 run type が Quality 画面で期待どおり表示される。
- coverage table が `total` だけでなく file-level 情報を表示する。
- E2E table が suite/test/failure/duration を表示する。artifact が無い場合は理由を表示する。
- capability 不足、未実行、artifact missing、parse failure、command failure が区別できる。
- Backend と UI の focused tests が今回の接続不全を検知できる。
- `bun run verify` まで実行し、成功または無関係 blocker を明示できている。
