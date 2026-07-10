# Quality Feature Domain / Coverage Task Generation 実装計画

## Status

implemented

## 実装結果

- Frontend Quality 実装を `src/modules/quality/**`、backend Quality 実装を `api/modules/quality/**`、共有契約を `shared/schemas/quality.schema.ts` へ集約した。
- Coverage file row の選択、20件上限、最新 Run / raw file key のサーバー再検証、`createdBy = 'quality-coverage'` の Draft Task 作成を実装した。
- stale Run の再読込、成功時の選択解除、通常エラー時の選択維持、二重送信防止を実装した。
- 2026-07-10 に focused regression 7 files / 52 tests、`bun run typecheck`、`bun run verify`、`git diff --check`、旧配置と依存方向の構造検査が成功した。

## 目的

Project Detail の品質画面にあるカバレッジレポートへ選択列を追加し、選択したファイルの実測カバレッジ情報を根拠に、カバレッジ改善用の Draft Task を生成できるようにする。

同時に、現在 `src/modules/nightworkers` と `api/modules/project-detail` に分散している Quality 画面固有の UI、状態管理、データ変換、API command、Quality Run service / repository / routes を Quality 機能ドメインへ移し、今後の Quality 画面変更が主として `src/modules/quality` と `api/modules/quality` の中で完結する状態へリファクタリングする。

この計画は、既存の Quality Run、`coverageSummary`、通常の Task 保存経路を接続する変更に限定する。Coverage Gate の判定基準、Quality Run の実行方法、Supervisor の実行方針は変更しない。

## レビュー結論

追加のプロダクト判断を残さず、次の方針で実装する。

- 1回の作成操作につき、選択ファイルをまとめた Draft Task を1件生成する。
- 選択できるのは `total` 以外の file row とし、1回の上限は20ファイルとする。
- UI は表示用相対パスとは別に、coverage summary 上の元 file key を保持する。
- Task 生成は専用 API を通し、Repository、Quality Run、coverage summary、選択 file key をサーバー側で再検証する。
- UI が表示している Run より新しい coverage-bearing Run が存在する場合は stale request として拒否し、再読み込みを促す。
- Task の title、description、objective、acceptance criteria は coverage summary から決定的に生成し、この操作のための LLM 呼び出しは追加しない。
- 生成 Task は既存 `tasks` table に `status = 'draft'`、`createdBy = 'quality-coverage'` で保存する。
- 新しい DB table、column、Task link table は追加しない。
- 初期実装では一括選択 checkbox を追加しない。各 file row を明示的に選択させる。
- 同じ Run と file set からの再作成は許可する。二重クリックだけ UI の busy state で防ぐ。
- Frontend の最終配置は `src/modules/quality`、backend の最終配置は `api/modules/quality`、共有契約は `shared/schemas/quality.schema.ts` とする。
- `ProjectDetailScreen` には Quality tab の配置、Project identity の受け渡し、Overview へ渡す coverage axes の参照だけを残す。
- `src/modules/quality` から `src/modules/nightworkers/components/project-detail/**` への deep import は残さない。
- `api/modules/project-detail` から Quality route、Quality Run lifecycle、artifact parser、Quality repository CRUD を除去する。
- `api/services/quality/**` にある Coverage Autonomy Gate などの runtime 共通 service は移動しない。画面/API domain の `api/modules/quality` から必要な pure service を利用する。
- URL、JSON response、DB table 名はリファクタリング前後で維持する。

## 背景と現状

現在の接続点は次の通りである。

- `GET /api/repositories/:id/quality` は `latestCoverageRun` を含む `ProjectQualityOverview` を返す。
- `ProjectQualityRun.coverageSummary` には `total` と file ごとの `statements` / `branches` / `functions` / `lines` / `uncoveredLines` が保存される。
- `coverageRowsFromSummary(...)` は coverage summary を表示行へ変換し、project root 配下の path を相対表示する。
- `QualityReportPanel` は file row を表形式で描画するが、選択状態と Task 作成 action は持っていない。
- `ProjectDetailScreen` は Quality overview の取得、Quality Run の起動、共通 busy/error state、Task 作成後の callback 接続を既に持つ。
- 通常 Task は既存 `tasks` table に Draft として保存でき、Project Detail から作成された Task の一覧更新には `onMissionTaskCandidatesCreated` を再利用できる。

Quality 機能の配置は現在、次のように分散している。

- Frontend API command: `src/modules/nightworkers/nightWorkersCommands.ts`。
- Coverage row 変換: `src/modules/nightworkers/qualityRows.ts`。
- Quality 画面 UI と coverage / E2E view model: `src/modules/nightworkers/components/project-detail/ProjectDetailQuality.tsx`。
- Quality の取得状態、run action、Overview への coverage axes 接続: `src/modules/nightworkers/components/ProjectDetailScreen.tsx`。
- Quality schemas: `shared/schemas/project-detail.schema.ts`。
- Quality routes / service / repository: `api/modules/project-detail/project-detail.routes.ts`、`project-detail.service.ts`、`project-detail.repository.ts`。
- Capability 判定: `api/modules/project-detail/project-signal-snapshot.service.ts`。
- Quality tests: Project Detail の backend / screen / action tests の中に混在している。

この分散により、Quality 画面へ機能を追加するたびに Project Detail の巨大 component、汎用 command file、Project Detail backend service を同時に変更する必要がある。Coverage Task 生成をそのまま追加すると分散をさらに固定するため、先に Quality 機能ドメインを作り、既存挙動を移した後で新機能をそのドメイン内へ実装する。

現状のまま汎用 `POST /api/tasks` を UI から直接呼ぶと、次の問題が残る。

- 表示中の Quality Run が対象 Repository に属することを Task 作成時に再検証できない。
- UI の相対表示 path と coverage summary の元 key が混同される。
- 新しい Coverage Run が完了した後でも、古い表示結果から Task を作成できてしまう。
- coverage metrics や uncovered lines をクライアントが Task 本文へ自由に組み立てるため、保存内容と実測値の一致をサーバーが保証できない。

このため、Quality Run を source of truth とする専用 API を追加する。

## スコープ

### 実装すること

1. Coverage file row に元 file key を保持する。
2. Coverage table に file row の選択列を追加する。
3. 選択件数付きの Draft Task 作成ボタンを追加する。
4. 選択状態、上限、Run 更新時のリセット、busy state、成功通知を実装する。
5. Coverage Task 作成用の共有 request / response schema を追加する。
6. Quality Run と file key を検証し、Draft Task を作成する専用 API を追加する。
7. 選択した実測値から Task 本文を決定的に生成する。
8. Backend、command contract、UI render、action integration の focused tests を追加する。
9. Frontend Quality 実装を `src/modules/quality` へ移す。
10. Backend Quality 実装を `api/modules/quality` へ移す。
11. Quality schema を `shared/schemas/quality.schema.ts` へ移す。
12. Project Detail には Quality module の public API を利用する integration seam だけを残す。

### 実装しないこと

- Coverage Gate の閾値や pass/fail 判定の変更。
- Quality Run、coverage artifact、E2E artifact の生成方法変更。
- coverage が低い file の自動選択や自動 ranking。
- Task 作成時の LLM 呼び出し、Mission 分解、Task Candidate 生成。
- Task の Implementation Queue への自動投入。
- 1 file ごとの複数 Task 自動生成。
- 一括選択、フィルター、ソート、ページネーションの追加。
- 同一 Run / file set に対する永続的な重複防止。
- `project_quality_runs` または `tasks` の DB schema 変更。
- Coverage 数値を上げるための production behavior の変更。
- Project Detail の Mission、Evaluation、Stack、Worktree 各 tab の再設計。
- `api/services/quality` にある Coverage Autonomy Gate / source guard / prerequisite の再設計。
- TanStack Query、Redux、Context Provider など新しい状態管理方式の導入。
- Project Detail 全体の loading / error contract の統一リファクタリング。
- 汎用 UI component のついで抽出。Quality module は既存の `@/components/ui` と CSS variables を使い、Project Detail 内部 component へ依存しない。

## Quality 機能ドメインの目標構成

### Frontend

```text
src/modules/quality/
├── api/
│   └── qualityCommands.ts
├── components/
│   ├── CoverageBreakdown.tsx
│   ├── QualityReportPanel.tsx
│   └── QualityScreen.tsx
├── hooks/
│   └── useProjectQualityController.ts
├── model/
│   ├── qualityRows.ts
│   └── qualityTypes.ts
└── index.ts
```

責務:

- `api/qualityCommands.ts`: Quality overview、run 作成、run detail / cancel、Coverage Task 作成の HTTP command。
- `model/qualityRows.ts`: coverage summary、coverage axes、E2E summary から表示 model への pure 変換。
- `model/qualityTypes.ts`: `CoverageFileRow`、`CoverageAxis`、`E2EResultRow`、controller public type。
- `hooks/useProjectQualityController.ts`: load、run action、selection、busy、error、notice、stale Run 処理、Task 作成後 callback。
- `components/QualityReportPanel.tsx`: Quality report の presentational UI。
- `components/QualityScreen.tsx`: controller と panel を接続する Quality tab の public screen。
- `components/CoverageBreakdown.tsx`: Project Overview が利用する coverage 表示。Quality 固有表示なので同じ module に置く。
- `index.ts`: Project Detail が利用してよい public exports のみを公開する。

`ProjectDetailScreen` の最終接続は次の程度に限定する。

```tsx
const qualityController = useProjectQualityController({
  repositoryId: project.id,
  projectRoot: project.localPath,
  onTasksCreated: onMissionTaskCandidatesCreated,
});

<ProjectDetailOverview coverageAxes={qualityController.coverageAxes} />

{activeTab === "quality" ? (
  <QualityScreen controller={qualityController} />
) : null}
```

Quality data は Overview でも必要なため、controller は Quality tab の表示有無にかかわらず Project 変更時に overview を取得する。`ProjectDetailScreen.loadProjectDetail()` の `Promise.all` から Quality fetch を外し、Quality 側の load failure が Mission / Stack 等の load 全体を失敗させないようにする。

### Backend

```text
api/modules/quality/
├── quality-artifacts.ts
├── quality-capabilities.ts
├── quality.repository.ts
├── quality.routes.ts
└── quality.service.ts
```

責務:

- `quality-artifacts.ts`: coverage / Playwright artifact の検出、parse、summary normalization。
- `quality-capabilities.ts`: Quality command capability と run command の決定。
- `quality.repository.ts`: `project_quality_runs` の map / create / complete / list / get / latest / running CRUD。
- `quality.service.ts`: Repository ownership、overview projection、Quality Run lifecycle、cancel、Coverage Task validation / creation。
- `quality.routes.ts`: 既存 Quality routes と新しい Coverage Task route の OpenAPI 接続。

`api/app.ts` は `qualityRouter` を root に mount する。既存 URL は変えない。

```text
GET  /api/repositories/:id/quality
GET  /api/repositories/:id/quality/runs
POST /api/repositories/:id/quality/runs
GET  /api/repositories/:id/quality/runs/:runId
POST /api/repositories/:id/quality/runs/:runId/cancel
POST /api/repositories/:id/quality/runs/:runId/coverage-task
```

`api/modules/project-detail` が Overview metrics / project signal snapshot のために最新 Quality Run を必要とする場合は、`api/modules/quality/quality.repository.ts` または小さな public selector を参照する。Quality module から Project Detail service / repository を逆参照しない。

### Shared contract

Quality 固有 schema は `shared/schemas/quality.schema.ts` へ移す。

- `projectQualityRunTypeSchema`
- `projectQualityRunStatusSchema`
- `coverageMetricResultSchema`
- `coverageGateResultSchema`
- `qualityCapabilitySchema`
- `projectQualityCapabilitiesSchema`
- `e2eSummarySchema`
- `projectQualityRunSchema`
- `projectQualityOverviewSchema`
- `createProjectQualityRunRequestSchema`
- Coverage Task request / response schema

移行中だけ `shared/schemas/project-detail.schema.ts` から compatibility re-export してよいが、全 consumer の import を更新した後に re-export も削除する。最終状態で Quality schema definition を Project Detail schema に残さない。

### 許可する依存方向

```text
Project Detail frontend ──> src/modules/quality/index.ts
Project Detail backend  ──> api/modules/quality public selector/repository
src/modules/quality     ──> shared/schemas/quality.schema.ts
api/modules/quality     ──> shared schema + DB + nightworkers repository
api/modules/quality     ──> api/services/quality pure/runtime-shared services
```

禁止する依存方向:

```text
src/modules/quality ──X──> src/modules/nightworkers/components/project-detail/**
api/modules/quality ──X──> api/modules/project-detail/project-detail.service.ts
api/modules/quality ──X──> api/modules/project-detail/project-detail.repository.ts
shared quality schema ──X──> frontend/backend implementation
```

### ドメイン集約の完了判定

- Quality 画面の変更が原則 `src/modules/quality/**` で完結する。
- Quality API / Run lifecycle / artifact ingestion / Coverage Task の変更が原則 `api/modules/quality/**` で完結する。
- `ProjectDetailScreen.tsx` に Quality の fetch、selection、run action、Task payload 構築が残っていない。
- `nightWorkersCommands.ts` に Quality command が残っていない。
- `ProjectDetailQuality.tsx` と `nightworkers/qualityRows.ts` が削除されている。
- Project Detail backend routes / service / repository に Quality route と lifecycle implementation が残っていない。
- Project Detail から Quality module への public import だけが残り、逆方向 import がない。

## UX 契約

### 表示

Coverage table の先頭に「選択」列を追加する。

- `total` row: checkbox を表示せず、集計行として維持する。
- file row: checkbox を表示する。
- checkbox の accessible name には表示 file path を含める。
- coverage row が0件の場合は、既存 empty row の `colSpan` を新しい列数へ合わせる。

Coverage report header の右側に次のボタンを追加する。

```text
選択ファイルからTask作成（3）
```

状態ごとの挙動:

- 選択0件: disabled。
- 1〜19件: 未選択 row を追加選択できる。
- 20件: 未選択 row の checkbox を disabled にし、上限理由を title または補助文で示す。
- 作成中: 全 checkbox と作成ボタンを disabled にし、button label を「Task作成中」にする。
- 成功: 選択を解除し、`Draft Taskを作成しました` を `aria-live` 領域へ表示する。
- 失敗: 選択を維持し、既存 Project Detail error surface へ理由を表示する。
- stale request: Quality overview を再取得し、選択を解除したうえで「カバレッジレポートが更新されました。対象を選び直してください」と表示する。

### 選択状態の所有

`src/modules/quality/hooks/useProjectQualityController.ts` に次の state を置く。

```ts
const [selectedCoverageFileKeys, setSelectedCoverageFileKeys] = useState<string[]>([]);
const [coverageTaskNotice, setCoverageTaskNotice] = useState<string>("");
```

`QualityReportPanel` には選択値と callback を props で渡す。HTTP action と Quality overview の再取得は controller に集約し、`ProjectDetailScreen` の汎用 `runAction(...)` へ戻さない。

選択状態は次の場合に破棄する。

- `project.id` が変わった。
- `quality.latestCoverageRun.id` が変わった。
- 最新 coverage rows から選択中 file key が消えた。
- Task 作成が成功した。

## 共有データ契約

### Coverage row

`src/modules/quality/model/qualityRows.ts` の `CoverageFileRow` を次の形で定義する。

```ts
export type CoverageFileRow = {
  key: string;
  file: string;
  statements: number | null;
  branches: number | null;
  functions: number | null;
  lines: number | null;
  uncovered: string;
  summary?: boolean;
};
```

- `key`: coverage summary の `Object.entries(...)` から得た元 key。API request に使う。
- `file`: project root 相対の表示 path。UI と Task title に使う。
- `summary`: `key === 'total'` のときだけ `true`。

React の row key と選択値には `row.key` を使い、表示用 `row.file` を identity として扱わない。

### API

Request / response schema は `shared/schemas/quality.schema.ts` に置く。

追加 route:

```text
POST /api/repositories/:repositoryId/quality/runs/:runId/coverage-task
```

Request:

```ts
const createCoverageImprovementTaskRequestSchema = z.object({
  fileKeys: z.array(z.string().min(1)).min(1).max(20),
});
```

Response:

```ts
const createCoverageImprovementTaskResponseSchema = z.object({
  task: taskSchema,
});
```

`fileKeys` は request 順を保存せず、coverage table の安定した file path 順へサーバー側で並べ直して Task 本文へ出力する。Request schema は送信配列を20件以下に制限し、service はその範囲内で重複 key を一意化してから file entry を検証する。

エラー契約:

- Repository または Run が存在しない、または Run が別 Repository に属する: 404。
- Run に coverage summary がない: 400 `VALIDATION_ERROR`。
- `total`、存在しない key、object でない coverage entry が含まれる: 400 `VALIDATION_ERROR`。
- requested Run より新しい coverage-bearing Run がある: 409 `STALE_COVERAGE_RUN`。既存 `AppError` を使い、汎用 error class は追加しない。

## Task 生成契約

### 保存値

```ts
{
  repositoryId,
  title,
  description,
  objective,
  acceptanceCriteria,
  status: "draft",
  createdBy: "quality-coverage",
}
```

### Title

1 file の場合:

```text
カバレッジ改善: src/example.ts
```

複数 file の場合:

```text
カバレッジ改善: 3ファイル
```

### Description

次を含める。

- Source Quality Run ID。
- Run type、実行日時、coverage gate target が存在する場合は target percent。
- 選択 file ごとの表示 path。
- `statements` / `branches` / `functions` / `lines` の現在値。
- `uncoveredLines`。値がない場合は `—` とする。

例:

```text
Quality Run: 11111111-1111-4111-8111-111111111111
Run type: unit
Coverage target: 80%

対象ファイル:
- src/example.ts
  - statements: 72.0%
  - branches: 55.0%
  - functions: 80.0%
  - lines: 70.0%
  - uncovered lines: 12, 18-22
```

### Objective

次の意図を日本語の固定 template で構築する。

```text
選択したファイルの未検証挙動を特定し、意味のあるテストを追加してカバレッジを改善してください。

まず対象 source、既存 test、coverage gap を確認し、未カバー行や低い branch / function coverage の原因を整理してください。数値だけを上げるために production behavior を変更したり、coverage ignore directive や test-only branch を追加したりしないでください。

対象はこのTaskに記録されたファイルへ限定し、関連しないリファクタリングを行わないでください。
```

ユーザー文言の keyword / regex 分類は追加しない。Task 実行時の workflow / routing 判断は既存 Supervisor prompt と skill 解決へ委ねる。

### Acceptance criteria

次を固定 template として保存する。

1. 選択 file の未カバー挙動に対応する、意味のある regression test が追加または改善されている。
2. 選択 file の coverage が baseline より改善する。改善できない項目がある場合は、理由と残課題が記録されている。
3. Repository の coverage summary を再生成し、全体 coverage を悪化させていない。
4. 対象に関連する focused test が成功する。
5. Repository の代表 verification gate が成功する、または今回の変更と無関係な失敗が明確に切り分けられている。
6. Coverage 回避のための production source change、ignore directive、test-only behavior が追加されていない。

## 実装手順

### Phase 0: ベースラインを固定する

対象:

- `tests/project-detail-screen.test.tsx`
- `tests/project-detail-backend.test.ts`
- `tests/nightworkers-commands-contract.test.ts`
- `tests/frontend-project-detail-actions.test.tsx`

実行:

```bash
bunx vitest run \
  tests/project-detail-screen.test.tsx \
  tests/project-detail-backend.test.ts \
  tests/nightworkers-commands-contract.test.ts \
  tests/frontend-project-detail-actions.test.tsx
```

期待結果:

- 現在の focused tests が成功する。
- Coverage table には選択列がなく、coverage task API も未接続であることを確認する。

失敗時:

- 今回の実装前から存在する失敗として記録し、対象 test と無関係な dirty-tree failure を混ぜない。
- 既存失敗を直すためのスコープ外変更は、この計画へ含めない。

### Phase 1: Quality shared schema と module skeleton を作る

対象:

- `shared/schemas/quality.schema.ts`
- `shared/schemas/project-detail.schema.ts`
- `src/modules/quality/index.ts`
- `api/modules/quality/`

変更:

1. Quality 固有 schema / type を `shared/schemas/quality.schema.ts` へ移す。
2. 既存 consumer を一度に壊さないため、移行中だけ Project Detail schema から compatibility re-export する。
3. `src/modules/quality` と `api/modules/quality` の directory / public entrypoint を作る。
4. この Phase では route、UI、runtime behavior を変更しない。

Phase 完了条件:

- Quality schema definition の owner が `quality.schema.ts` になる。
- 既存 JSON contract と OpenAPI schema name が変わらない。
- 既存 focused tests と typecheck が移動前と同じ assertion で成功する。

Focused verification:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx
bun run typecheck
```

失敗時:

- Compatibility re-export を維持した状態へ戻し、consumer import の一括変更へ進まない。

### Phase 2: Quality persistence を backend domain へ移す

対象:

- `api/modules/quality/quality.repository.ts`
- `api/modules/project-detail/project-detail.repository.ts`
- `api/db/project-detail-schema.ts`（table declaration の参照のみ。変更しない）
- Quality repository tests

変更:

1. `mapQualityRun` と Quality Run CRUD を `quality.repository.ts` へ移す。
2. `projectQualityRuns` table declaration は DB infrastructure として現配置を維持し、migration は作らない。
3. Project Detail metrics / signal snapshot の既存 consumer は Quality repository の public selector を参照する。
4. Project Detail repository から Quality Run CRUD exports を削除する。

Phase 完了条件:

- DB table 名、column、index、保存値が変わらない。
- Quality Run CRUD が `api/modules/quality` にだけ実装される。
- Project Detail repository から Quality repository への逆向き依存がない。

Focused verification:

```bash
bunx vitest run tests/project-detail-backend.test.ts
bun run typecheck
```

失敗時:

- Repository import の差し替えだけを戻し、service / route の移動へ進まない。

### Phase 3: Quality service、artifact、capability、routes を backend domain へ移す

対象:

- `api/modules/quality/quality-artifacts.ts`
- `api/modules/quality/quality-capabilities.ts`
- `api/modules/quality/quality.service.ts`
- `api/modules/quality/quality.routes.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `api/modules/project-detail/project-detail.routes.ts`
- `api/modules/project-detail/project-signal-snapshot.service.ts`
- `api/app.ts`
- `tests/quality-backend.test.ts`
- `tests/quality-backend/quality.cases.ts`

変更:

1. Coverage / E2E artifact parser と command construction を `quality-artifacts.ts` へ移す。
2. `detectQualityCapabilities` と Quality command 選択を `quality-capabilities.ts` へ移す。
3. Quality overview、run list / detail / create / cancel lifecycle を `quality.service.ts` へ移す。
4. 既存5 route を URL / method / response shape を変えず `quality.routes.ts` へ移す。
5. `api/app.ts` に `qualityRouter` を mount し、Project Detail router から Quality route を削除する。
6. 既存 backend Quality cases を `tests/quality-backend/**` へ移し、Project Detail backend test には Project Detail と Quality の integration assertion だけを残す。

Phase 完了条件:

- 既存 Quality API の URL、status、payload が移動前と同じである。
- active Quality process map と cancel 処理が Quality service に閉じる。
- Project Detail service / routes に Quality Run lifecycle 実装が残らない。
- Project signal snapshot は Quality capability / latest run を public Quality seam から取得する。

Focused verification:

```bash
bunx vitest run tests/quality-backend.test.ts tests/project-detail-backend.test.ts
bun run typecheck
```

失敗時:

- Router mount と service import をその Phase 内で戻し、Frontend 移動へ進まない。

### Phase 4: Quality の frontend model、API、UI を移す

対象:

- `src/modules/quality/api/qualityCommands.ts`
- `src/modules/quality/model/qualityRows.ts`
- `src/modules/quality/model/qualityTypes.ts`
- `src/modules/quality/components/QualityReportPanel.tsx`
- `src/modules/quality/components/CoverageBreakdown.tsx`
- `src/modules/quality/index.ts`
- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/modules/nightworkers/qualityRows.ts`
- `src/modules/nightworkers/components/project-detail/ProjectDetailQuality.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailCommon.tsx`
- `tests/quality-screen.test.tsx`
- `tests/quality-commands-contract.test.ts`

変更:

1. Quality HTTP commands を `qualityCommands.ts` へ移す。
2. Coverage / E2E / axes の pure transformation と types を `model/` へ移す。
3. `QualityReportPanel` を Quality components へ移す。
4. Overview の `CoverageBreakdown` も Quality 固有 component として移す。
5. Quality UI は generic `@/components/ui`、Tailwind class、NightWorkers CSS variables を使い、Project Detail internal component / styles を deep import しない。
6. Tests の import を `@/modules/quality` public entrypoint または Quality test 対象へ更新する。
7. 旧 command、row helper、Quality component を削除する。

この Phase は配置だけを変え、selection と Coverage Task button はまだ追加しない。

Phase 完了条件:

- Quality UI / model / API command の実装が `src/modules/quality` にある。
- `nightWorkersCommands.ts` に Quality command がない。
- `ProjectDetailQuality.tsx` と `nightworkers/qualityRows.ts` が削除される。
- 既存 Quality markup、labels、coverage / E2E rows、button behavior が変わらない。

Focused verification:

```bash
bunx vitest run tests/quality-screen.test.tsx tests/quality-commands-contract.test.ts
bun run typecheck
```

失敗時:

- Public export と import の差し替えを戻し、controller state の移動へ進まない。

### Phase 5: Quality controller と Project Detail integration seam を作る

対象:

- `src/modules/quality/hooks/useProjectQualityController.ts`
- `src/modules/quality/components/QualityScreen.tsx`
- `src/modules/quality/index.ts`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx`
- `src/modules/nightworkers/components/project-detail/types.ts`
- `tests/frontend-quality-actions.test.tsx`
- `tests/frontend-project-detail-actions.test.tsx`

変更:

1. Quality overview load、run action、busy / error、derived rows / axes を controller へ移す。
2. `QualityScreen` を controller の presentational entrypoint とする。
3. `ProjectDetailScreen.loadProjectDetail()` から `fetchProjectQuality` と `setQuality` を除去する。
4. Project Detail は controller の作成、Overview への `coverageAxes`、Quality tab への `QualityScreen` の受け渡しだけを行う。
5. Quality failure を Project Detail の Mission / Stack 等の load failure から分離する。
6. `ProjectDetailScreen` から Quality helper の test 用 re-export を削除する。

Phase 完了条件:

- Quality の load / run state が `useProjectQualityController` に閉じる。
- `ProjectDetailScreen` に Quality HTTP command と Quality local state が残らない。
- Overview coverage 表示と Quality tab 表示が移動前と同じである。
- Quality API failure でも他の Project Detail data が表示できる。

Focused verification:

```bash
bunx vitest run \
  tests/frontend-quality-actions.test.tsx \
  tests/frontend-project-detail-actions.test.tsx \
  tests/quality-screen.test.tsx
bun run typecheck
```

失敗時:

- `QualityScreen` の public props と controller ownership を見直し、Project Detail へ個別 Quality handler を戻さない。

### Phase 6: Coverage Task の共有 schema と command contract を追加する

対象:

- `shared/schemas/quality.schema.ts`
- `api/modules/quality/quality.routes.ts`
- `src/modules/quality/api/qualityCommands.ts`
- `tests/quality-commands-contract.test.ts`

変更:

1. Request / response schema を追加する。
2. `POST /repositories/:id/quality/runs/:runId/coverage-task` を OpenAPI route として定義する。
3. Frontend command `createCoverageImprovementTask(repositoryId, runId, input)` を追加する。
4. Command test で method、URL、JSON body を固定する。

Phase 完了条件:

- Frontend と backend が同じ request / response schema を参照する。
- `fileKeys` の min/max が schema で保証される。
- URL と payload の contract test が成功する。

Focused verification:

```bash
bunx vitest run tests/quality-commands-contract.test.ts
```

### Phase 7: Backend validation と Draft Task 生成を実装する

対象:

- `api/modules/quality/quality.service.ts`
- `api/modules/quality/quality.routes.ts`
- `tests/quality-backend/quality.cases.ts`
- `tests/quality-backend.test.ts`

変更:

1. Repository と Run の ownership を検証する。
2. Run の `coverageSummary` が object であることを検証する。
3. 最新 coverage-bearing Run ID と requested Run ID を比較する。
4. `fileKeys` を一意化し、`total` と不正 key を拒否する。
5. coverage entry から表示 path、metrics、uncovered lines をサーバー側で読み取る。
6. title / description / objective / acceptance criteria を固定 template で構築する。
7. `nightworkersRepo.createTask(...)` で Draft Task を1件保存する。
8. `{ task }` を 201 で返す。

DB schema は変更しない。Task 作成前に全 validation を完了させ、validation error で Task が部分作成されない順序にする。

Phase 完了条件:

- 正常な最新 Run と1〜20 file keys から Draft Task が1件作成される。
- 保存 Task の `repositoryId`, `status`, `createdBy` が契約通りである。
- Task 本文の metrics は request 値ではなく保存済み coverage summary から取得される。
- 別 Repository の Run、coverage summary がない Run、stale Run、`total`、不明 key は Task を作成しない。

Focused verification:

```bash
bunx vitest run tests/quality-backend.test.ts
```

追加 test cases:

- 1 file の title と本文。
- 複数 file の集約 title と安定した並び順。
- coverage target がある場合とない場合。
- null / invalid metric を `—` として扱う。
- duplicated file keys を一意化する。
- 21 file keys を schema が拒否する。
- another repository の Run を404にする。
- stale Run を409にする。
- `total` と unknown key を400 `VALIDATION_ERROR` にする。
- validation failure 後に Task row が増えていない。

### Phase 8: Coverage row identity と選択 UI を実装する

対象:

- `src/modules/quality/model/qualityRows.ts`
- `src/modules/quality/components/QualityReportPanel.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/quality-screen.test.tsx`

変更:

1. `CoverageFileRow.key` に summary の元 file key を保持する。
2. Coverage table 先頭へ選択列を追加する。
3. `total` row には checkbox を描画しない。
4. checkbox の checked / disabled / accessible name を controlled props から決める。
5. Coverage report header 右側へ件数付き作成ボタンを追加する。
6. busy、上限、成功通知を表示する。
7. empty row の `colSpan` を7へ更新する。
8. 日本語と英語の辞書 key を追加する。

Phase 完了条件:

- 表示 path と選択 identity が分離される。
- `total` は選択できない。
- 選択0件では作成ボタンが disabled になる。
- 20件選択時は未選択 checkbox が disabled になる。
- 作成中は重複操作できない。
- keyboard / screen reader から対象 file と操作状態を識別できる。

Focused verification:

```bash
bunx vitest run tests/quality-screen.test.tsx
```

追加 test cases:

- `coverageRowsFromSummary` が `key` と相対表示 `file` の両方を返す。
- `total` row に checkbox がない。
- file row に accessible name 付き checkbox がある。
- 0件、選択あり、20件、busy の button / checkbox state。
- empty coverage table の column count。
- 成功通知が `aria-live` で描画される。

### Phase 9: Quality controller に Task action と更新処理を接続する

対象:

- `src/modules/quality/hooks/useProjectQualityController.ts`
- `src/modules/quality/components/QualityScreen.tsx`
- `tests/frontend-quality-actions.test.tsx`
- `tests/frontend-project-detail-actions.test.tsx`

変更:

1. Quality controller に `selectedCoverageFileKeys` と `coverageTaskNotice` を追加する。
2. latest Coverage Run と rows に合わせて選択を prune / reset する。
3. `QualityReportPanel` へ controlled props と callbacks を渡す。
4. 作成ボタンから専用 command を呼ぶ。
5. 成功時に選択を解除し、作成 Task を `onMissionTaskCandidatesCreated?.([task])` へ渡す。
6. Quality controller の専用 busy/error/reload 経路へ接続し、Project Detail の `runAction(...)` へ Quality logic を戻さない。
7. Command の `Response.status` を `readJsonResponse(...)` の前に確認する。409 の場合は最新 Quality overview を再取得した後、選択を解除して stale notice を出し、それ以外は既存の response reader へ渡す。

Phase 完了条件:

- 選択した元 file keys と表示中 Run ID だけが API へ渡る。
- 成功後に Task 一覧が更新される。
- 新しい Coverage Run へ切り替わった後、古い選択が残らない。
- API failure では選択が維持され、再試行できる。
- 作成中の二重 request が発生しない。

Focused verification:

```bash
bunx vitest run \
  tests/frontend-quality-actions.test.tsx \
  tests/frontend-project-detail-actions.test.tsx
```

追加 test cases:

- checkbox toggle から command payload までを確認する。
- success response の Task が callback へ1件渡る。
- success 後に選択が空になる。
- failure 後に選択が維持される。
- latest Coverage Run ID 変更時に選択が破棄される。

### Phase 10: 旧配置を除去し、統合回帰と closeout を行う

Focused regression:

```bash
bunx vitest run \
  tests/quality-screen.test.tsx \
  tests/quality-backend.test.ts \
  tests/quality-commands-contract.test.ts \
  tests/frontend-quality-actions.test.tsx \
  tests/project-detail-screen.test.tsx \
  tests/project-detail-backend.test.ts \
  tests/frontend-project-detail-actions.test.tsx
```

型検証:

```bash
bun run typecheck
```

Repository の代表 gate:

```bash
bun run verify
```

差分健全性:

```bash
git diff --check
```

旧配置と依存方向の確認:

```bash
test ! -e src/modules/nightworkers/qualityRows.ts
test ! -e src/modules/nightworkers/components/project-detail/ProjectDetailQuality.tsx
rg -n "modules/quality" src/modules/nightworkers/components/ProjectDetailScreen.tsx
! rg -n "ProjectDetailQuality|nightworkers/qualityRows|fetchProjectQuality|createProjectQualityRun" src/modules/nightworkers
! rg -n "getProjectQuality|createProjectQualityRun|cancelProjectQualityRun|projectQualityRuns" api/modules/project-detail
! rg -n "projectQualityRunSchema|projectQualityOverviewSchema|e2eSummarySchema" shared/schemas/project-detail.schema.ts
```

期待値:

- 最初の2件は file が存在しないため成功する。
- `ProjectDetailScreen.tsx` は `@/modules/quality` の public API だけを import する。
- `src/modules/nightworkers` の旧 Quality implementation 名は0件になる。Project Detail の public Quality import は許可する。
- `api/modules/project-detail` の Quality lifecycle / table CRUD 実装は0件になる。Quality public selector の import は許可する。
- Project Detail schema の Quality schema definition は0件になる。

期待結果:

- Focused tests がすべて成功する。
- Shared schema、route、service、command、UI の型が一致する。
- 既存 Quality Run 実行、coverage 表示、E2E 表示、Mission Task 作成に回帰がない。
- `verify` が成功する。
- unrelated dirty-tree changes を今回の差分へ混ぜていない。

失敗時の切り分け:

- Schema / route failure: request / response schema と OpenAPI route の不一致を確認する。
- Backend failure: Run ownership、latest Run 判定、coverage entry normalization、Task insert の順で確認する。
- UI failure: row identity、selection state、run-change reset、busy state の順で確認する。
- Repo-wide failure: focused tests と typecheck が成功しているかを先に確認し、今回の変更由来か既存 dirty-tree 由来かを分けて記録する。

## 受け入れ条件

1. Quality 画面の coverage file row に選択 checkbox が表示される。
2. `total` row は選択できない。
3. 選択0件では Task 作成ボタンが実行できない。
4. 最大20 file を選択でき、21件目は UI と schema の両方で防止される。
5. 最新 Coverage Run と選択 file keys から Draft Task が1件作成される。
6. Task は `createdBy = 'quality-coverage'` で、選択 file、現在の4 metrics、uncovered lines、Run ID、coverage target を保持する。
7. Task objective と acceptance criteria に、意味のある test、非回帰、coverage 再計測、coverage 回避禁止が含まれる。
8. 別 Repository の Run、coverage summary がない Run、stale Run、不明 key、`total` から Task は作成されない。
9. 作成成功後に選択が解除され、Task 一覧が更新される。
10. API failure では選択が維持され、ユーザーが修正または再試行できる。
11. Coverage Run が更新された場合、古い選択が新しい report へ持ち越されない。
12. 既存の Quality Run 実行、coverage report、E2E result、Task Candidate 作成を壊していない。
13. Focused tests、typecheck、代表 verification gate、`git diff --check` が成功する。
14. Frontend Quality の UI、controller、API command、view model が `src/modules/quality/**` に配置されている。
15. Backend Quality の routes、service、repository、artifact、capability が `api/modules/quality/**` に配置されている。
16. Quality 固有 schema が `shared/schemas/quality.schema.ts` に配置され、Project Detail schema に定義が残っていない。
17. `ProjectDetailScreen` に Quality の fetch、run action、selection、Task payload 構築が残っていない。
18. `src/modules/quality` から Project Detail internal component / styles への deep import がない。
19. Project Detail backend に Quality routes、Run lifecycle、artifact parser、Quality CRUD が残っていない。
20. Quality API の既存 URL、status、payload と `project_quality_runs` の DB contract が維持されている。
21. Overview の coverage 表示は Quality controller / component の public API 経由で維持されている。
22. Quality load failure が Mission、Stack、Worktree 等の Project Detail load 全体を失敗させない。

## 変更対象一覧

主対象:

- `shared/schemas/quality.schema.ts`
- `shared/schemas/project-detail.schema.ts`
- `api/app.ts`
- `api/modules/quality/quality-artifacts.ts`
- `api/modules/quality/quality-capabilities.ts`
- `api/modules/quality/quality.repository.ts`
- `api/modules/quality/quality.routes.ts`
- `api/modules/quality/quality.service.ts`
- `api/modules/project-detail/project-detail.repository.ts`
- `api/modules/project-detail/project-detail.routes.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `api/modules/project-detail/project-signal-snapshot.service.ts`
- `src/modules/quality/api/qualityCommands.ts`
- `src/modules/quality/components/CoverageBreakdown.tsx`
- `src/modules/quality/components/QualityReportPanel.tsx`
- `src/modules/quality/components/QualityScreen.tsx`
- `src/modules/quality/hooks/useProjectQualityController.ts`
- `src/modules/quality/model/qualityRows.ts`
- `src/modules/quality/model/qualityTypes.ts`
- `src/modules/quality/index.ts`
- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/modules/nightworkers/qualityRows.ts`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailQuality.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailCommon.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx`
- `src/modules/nightworkers/components/project-detail/types.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/quality-backend.test.ts`
- `tests/quality-backend/quality.cases.ts`
- `tests/quality-screen.test.tsx`
- `tests/quality-commands-contract.test.ts`
- `tests/frontend-quality-actions.test.tsx`
- `tests/project-detail-backend/quality.cases.ts`
- `tests/project-detail-backend.test.ts`
- `tests/project-detail-screen.test.tsx`
- `tests/nightworkers-commands-contract.test.ts`
- `tests/frontend-project-detail-actions.test.tsx`

変更しない対象:

- `api/services/llm-provider*`
- `api/services/supervisor/skills/**`
- Coverage Autonomy Gate runtime。
- `api/db/project-detail-schema.ts`
- `api/db/schema.ts`
- Quality settings。
- Implementation Queue。

## 実装時の注意

- 実装開始時に `git status --short` を再確認し、worktree にある別作業の変更を上書き、整形、stage しない。
- 計画作成時点で確認できる Mission Pilot / VulnWorkbench 関連文書、Mission Pilot の module / schema / test、`ProjectDetailDialogs.tsx` の変更はこの計画の変更対象外とする。
- coverage summary は `unknown` から安全に読み取り、型 assertion だけで file entry を信用しない。
- 表示用 path を API identity に使わない。
- Prompt 文言は日本語で維持する。
- provider 層へ用途別 SystemContext や coverage Task 判定を追加しない。
- validation が終わる前に Task row を作成しない。
- 実装途中で DB link や自動 Queue 投入が必要に見えても、この計画へ無断で追加しない。

## Rollback

問題が発生した場合は、次の単位で切り戻せるように実装する。

1. Shared Quality schema の import 差し替え。
2. Quality repository の移動。
3. Backend service / route の移動と `api/app.ts` mount。
4. Frontend model / command / UI の移動。
5. Quality controller と Project Detail integration seam。
6. Coverage Task API、選択列、作成ボタン。

各 Phase の focused verification が成功するまで次の Phase へ進まない。問題が出た場合はその Phase の import / route 差し替えだけを戻し、確認済みの前 Phase までを維持する。

DB schema を変更しないため、rollback migration は不要である。既に作成された Draft Task は通常 Task として残るため、自動削除しない。

## 完了後の文書処理

すべての受け入れ条件と検証が完了した後、この文書を次へ移動する。

```text
spec/archive/quality-coverage-task-generation-implementation-plan.md
```

検証未完了、既知回帰あり、または実装が部分的な状態では `spec/docs/` に残す。
