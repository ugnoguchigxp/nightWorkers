# Project Evaluation 実ロジック実装計画

## 目的

Project Evaluation の mock 画面を、NightWorkers の Project、LLM 設定、実行証跡、Implementation Queue と接続した実機能へ置き換える。

`../projectEvaluator` は評価軸、bundle、focused improvement、NightWorkers task export の考え方を参照する。ただし、そのまま API/CLI/Drizzle 構成を取り込まない。NightWorkers は既に local-first SQLite、既存 Project repo root、structured LLM route、Workbench Session、Implementation Queue を持つため、配布形式としては NightWorkers 内の専用 domain として実装する。

## 設計判断

1. CLI 連携ではなく NightWorkers 内部 domain として実装する。

理由:

- packaged app で `../projectEvaluator` の別 runtime、別 DB、別設定を持つと配布とサポートが重くなる。
- NightWorkers の LLM provider / role routing / usage logging を迂回すると、ユーザーが Settings で選んだ provider と評価実行が一致しなくなる。
- 改善案は最終的に NightWorkers Task / Queue に入るため、中間 export JSON より内部 service で Task draft を作る方が自然。

2. `projectEvaluator` から採用するもの。

- 評価を `bundle -> judge -> persisted evaluation -> focused improvements -> task conversion` に分ける構造。
- 10-15 個程度の評価軸と、軸ごとの score / confidence / rationale を返す契約。
- Round 1 を評価実行、Round 2 を選択軸に基づく focused improvement 生成とする考え方。
- 改善案を agent prompt、acceptance criteria、verification command を持つ Task 候補に変換する考え方。

3. `projectEvaluator` から採用しないもの。

- 独立 Hono server。
- 独立 Drizzle schema / auth / project profile。
- `@openai/codex-sdk` 直結の judge client。
- CLI を本番連携の primary path にする設計。
- `projectRoot` override を任意に受ける設計。

4. NightWorkers 側で合理化するもの。

- Project は `repositories` を唯一の source of truth にする。
- repo root は登録済み `repositories.localPath` だけを使う。
- LLM は `api/services/structured-llm` の structured JSON route を使う。
- 評価結果と改善案は NightWorkers DB に保存する。
- Task 化は `tasks` に draft/ready session を作り、既存 `implementation_queue_entries` は明示操作で作る。
- Prompt 文言は日本語で保持する。

5. 評価実行は専用 LLM role を持つ。

理由:

- Project Evaluation は planning でも implementation でもなく、長い repo evidence を読み、構造化 JSON で評価と改善案を返す独立用途である。
- Settings の Role Routing で `evaluation` を選べないと、ユーザーが評価専用に高精度 model / 高 thinking depth / fallback を割り当てられない。
- 実行時に `role: "evaluation"` を明示すれば、評価実行の provider 選択、usage logging、debug event が他用途と混ざらない。

## 非目標

- この計画段階で実ロジックを実装しない。
- Project Queue の実行 processor、claim、drain 仕様を変更しない。
- Supervisor/provider 層へ評価専用の実行判断を分散させない。
- ユーザー文言の regex / keyword 判定で評価 workflow を起動しない。
- `projectEvaluator` の DB migration や auth を移植しない。
- 評価実行で対象 repository へ file write しない。
- 初期実装で source inspection 全量監査や app launch verification まで含めない。

## 現状

実装済み mock:

- `src/modules/project-evaluation/components/ProjectEvaluationMockScreen.tsx`
- Project sidebar から Project Evaluation 画面へ遷移できる。
- LLM 総評、Overall score、History、Round 1 軸選択、Round 2 改善案生成、改善案選択、Task 化ボタンの UX は検討済み。

問題:

- mock data が component 内に同居している。
- `ProjectEvaluationMockScreen.tsx` は 650 行で、今後の実装では 600 行制約を超える。
- 評価実行、履歴、改善案生成、Task 化は未接続。

既存 NightWorkers の接続点:

- Project: `repositories`
- Task: `tasks`
- Queue: `implementation_queue_entries`
- Workbench Session 作成: `POST /api/workbench/sessions`
- Queue 追加: `POST /api/implementation-queue/entries`
- Structured LLM: `api/services/structured-llm`
- LLM usage / debug event: `llm_usage_records`, activity event 系

参考にする `projectEvaluator` の接続点:

- `shared/schemas/evaluation.schema.ts`
- `shared/schemas/project.schema.ts`
- `api/modules/evaluations/bundle-builder.ts`
- `api/modules/evaluations/evaluation.service.ts`
- `api/modules/evaluations/nightworkers-task-exporter.ts`
- `api/modules/llm/judge-client.ts`

## 目標状態

1. Project Evaluation 画面を開くと、対象 Project の最新評価履歴を DB から表示する。
2. `評価を実行` で repository bundle を作り、structured LLM に評価 JSON を生成させ、DB に保存する。
3. History から過去評価を選べる。
4. Round 1 で選んだ評価軸だけを入力に Round 2 の改善案を生成する。
5. 改善案は DB に保存され、再表示できる。
6. 選択した改善案だけを NightWorkers Task draft/ready に変換する。
7. Task 化後、Project Queue 側で Queue 追加できる。初期実装では Task 作成と Queue 追加を分ける。
8. どの評価からどの Task が作られたか追跡できる。

## データ設計

### 追加テーブル

`api/db/schema.ts` が既に 600 行を超えているため、実装時は評価用 schema を別 file に分離する。

候補:

- `api/db/project-evaluation-schema.ts`
- `api/db/schema.ts` は既存 export の互換を保ちながら、新規 table export を再 export するだけにする。

追加 table:

```ts
projectEvaluationRuns
projectEvaluationDimensions
projectEvaluationActivityEvents
projectImprovementIdeas
projectImprovementIdeaScoreImpacts
projectEvaluationTaskLinks
```

最小カラム:

- `projectEvaluationRuns`
  - `id`
  - `repositoryId`
  - `bundleJson`
  - `rawOutputJson`
  - `summary`
  - `overallScore`
  - `overallConfidence`
  - `evidenceLevel`
  - `selectedModelJson`
  - `previousEvaluationId`
  - `createdAt`
  - `updatedAt`
- `projectEvaluationDimensions`
  - `id`
  - `evaluationId`
  - `dimensionKey`
  - `label`
  - `score`
  - `confidence`
  - `rationale`
  - `evidenceJson`
  - `concernsJson`
- `projectImprovementIdeas`
  - `id`
  - `evaluationId`
  - `title`
  - `summary`
  - `agentPrompt`
  - `expectedOutcome`
  - `implementationFocusJson`
  - `targetDimensionsJson`
  - `createdAt`
- `projectEvaluationTaskLinks`
  - `id`
  - `evaluationId`
  - `ideaId`
  - `taskId`
  - `createdAt`

### 型と schema

Shared schema は frontend と API の両方で使う。

候補:

- `shared/schemas/project-evaluation.schema.ts`

含める型:

- `ProjectEvaluationDimensionKey`
- `ProjectEvaluationRun`
- `ProjectEvaluationDimensionScore`
- `ProjectEvaluationBundle`
- `ProjectEvaluationReport`
- `ProjectImprovementIdea`
- `CreateProjectEvaluationRequest`
- `GenerateProjectImprovementsRequest`
- `CreateTasksFromProjectImprovementsRequest`

評価軸:

- 初期 default は `projectEvaluator` と同じ 10 軸にする。
- 追加候補の `documentation`, `agentUsability`, `reliability` は schema には含めるが、UI 初期 default には出さない。
- 日本語 label は NightWorkers domain 側に持つ。LLM prompt では key と日本語 label の両方を渡す。

## Bundle 設計

`projectEvaluator` の bundle-builder を参考にするが、NightWorkers では次を入力にする。

必須:

- `repositories.name`
- `repositories.localPath`
- `repositories.branch`
- `README.md`
- `AGENTS.md`
- `package.json`
- repo tree
- package scripts
- 最新の Project Queue / Task 概要
- 直近の run evidence summary
- 前回評価の score / dimension score / weakness

任意:

- `LLM_CONTEXT.md`
- `nightworkers-quality.json`
- 最新 Task の final report
- verification script の存在

制限:

- `.env`, secret, sqlite, node_modules, dist, coverage は tree / content 収集から除外する。
- source file content の sampling は Phase 4 以降。初期 bundle は README/AGENTS/package/tree/run evidence summary まで。
- bundle は保存するが、過度に大きい raw content は digest と truncated content を併用する。

実装候補:

- `api/modules/project-evaluation/project-evaluation-bundle.service.ts`
- `api/modules/project-evaluation/project-evaluation-redaction.ts`

## LLM 設計

`projectEvaluator` の Codex SDK 直結ではなく、NightWorkers の `callStructuredJsonLLM` を使う。

実装候補:

- `api/modules/project-evaluation/project-evaluation-prompts.ts`
- `api/modules/project-evaluation/project-evaluation-judge.service.ts`

評価 prompt:

- System prompt は日本語。
- ファイル変更、コマンド実行、外部アクセスを要求しない。
- bundle だけを評価し、JSON だけを返す。
- 評価できない点は score を盛らず `concerns` / `notVerified` に残す。
- 100 点へ近づくための不足を、抽象論でなく NightWorkers Task に落とせる粒度で書く。

出力 schema:

- `schemaVersion: "nightworkers.project-evaluation-report/v1"`
- `overallScore`
- `confidence`
- `summary`
- `dimensions[]`
  - `key`
  - `label`
  - `score`
  - `confidence`
  - `rationale`
  - `evidence`
  - `concerns`
- `strengths[]`
- `weaknesses[]`
- `nextEvidenceToCollect[]`

改善案 prompt:

- 入力は保存済み evaluation、選択 dimension keys、bundle の要約、前回評価差分。
- 選択されていない軸の改善案を主目的にしない。
- 1 round で全部を埋めず、選択軸ごとに 100 点へ近づく複数候補を出す。
- 各 idea は `agentPrompt`, `expectedOutcome`, `implementationFocus`, `scoreImpacts` を持つ。

LLM route:

- 初期実装で structured LLM の `role: "evaluation"` を追加する。
- 評価実行と改善案生成はどちらも `role: "evaluation"` を使う。
- `evaluation` route が未設定の場合は既存 role routing と同じ default endpoint 正規化に従う。
- provider 失敗時は固定の偽評価に差し替えない。失敗を activity event と UI error に出す。

## Role Router 設計

Settings の Role Routing に `evaluation` を追加する。

対象 file:

- `api/routes/settings-runtime.ts`
  - `llmRoleSchema` に `evaluation` を追加する。
  - `LLM_ROLE_ORDER` は `plan`, `evaluation`, `implementation`, `test`, `review`, `quality_gate`, `completion` の順にする。
  - `normalizeRoleRoutes` で既存設定に `evaluation` が無い場合も default target が補完されることを確認する。
- `api/services/structured-llm/types.ts`
  - `StructuredLlmRole` に `evaluation` を追加する。
- `api/services/structured-llm/settings.ts`
  - `StructuredLlmRole` に `evaluation` を追加する。
- `src/modules/nightworkers/types/provider-settings.ts`
  - `LlmRole` に `evaluation` を追加する。
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx`
  - `roleLabels.evaluation = "Evaluation"` を追加する。
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
  - `STRUCTURED_LLM_ROLES` に `evaluation` を追加し、routing snapshot に表示できるようにする。
- tests:
  - `tests/structured-llm/services-structured-llm-02.test.ts`
  - settings runtime route tests
  - `SettingsLlmPanel` が type error なく `evaluation` を表示できること。

`evaluation` role は provider tool call、file write、command execution、network を許可しない。既存 `buildCapabilityPolicy` の structured artifact と同じ制約を維持する。

## API 設計

専用 route group:

- `GET /api/repositories/:id/evaluations`
- `GET /api/repositories/:id/evaluations/latest`
- `POST /api/repositories/:id/evaluations`
- `GET /api/project-evaluations/:evaluationId`
- `POST /api/project-evaluations/:evaluationId/improvements`
- `GET /api/project-evaluations/:evaluationId/improvements`
- `POST /api/project-evaluations/:evaluationId/tasks`

Task 化 request:

```ts
{
  ideaIds: string[];
  mode: "draft" | "ready";
}
```

初期 default:

- `mode: "ready"`
- Queue には自動投入しない。

Task 作成内容:

- `repositoryId`: evaluation の repository
- `title`: improvement title
- `description`: summary + target dimensions + expected score gain
- `objective`: `agentPrompt`
- `acceptanceCriteria`: `expectedOutcome` と implementation focus を改行結合
- `status`: `ready`
- `priority`: score impact と UI 選択順から決める
- `createdBy`: `project-evaluation`

Queue 追加:

- 初期は既存 `POST /api/implementation-queue/entries` を UI から使う。
- 選択 Task を即 Queue へ入れる一括 API は Phase 6 以降の追加検討にする。

## Frontend 設計

現在の mock component は、components ベースの分割を基本にして、各 file を 600 行未満に保つ。

分割の主単位は UI component とする。hook / model / api は補助層であり、巨大 component を避けるための責務分離に使う。最初から controller や model を厚くしすぎず、表示上の境界に沿って分ける。

候補構成:

```text
src/modules/project-evaluation/
  api/projectEvaluationCommands.ts
  components/ProjectEvaluationScreen.tsx
  components/ProjectEvaluationToolbar.tsx
  components/EvaluationSummaryPanel.tsx
  components/EvaluationHistorySidebar.tsx
  components/DimensionSelector.tsx
  components/DimensionScoreRow.tsx
  components/ImprovementIdeaGrid.tsx
  components/ImprovementIdeaCard.tsx
  components/ProjectEvaluationTaskLinks.tsx
  components/ProjectEvaluationEmptyState.tsx
  hooks/useProjectEvaluationController.ts
  model/projectEvaluationViewModel.ts
  model/projectEvaluationTypes.ts
  index.ts
```

責務:

- `ProjectEvaluationScreen.tsx`: layout only
- `ProjectEvaluationToolbar.tsx`: evaluate button、実行中表示、judge route 表示
- `useProjectEvaluationController.ts`: fetch/mutation state、選択状態
- `EvaluationSummaryPanel.tsx`: LLM 総評と overall score
- `EvaluationHistorySidebar.tsx`: 1 行 1 履歴
- `DimensionSelector.tsx`: Round 1 軸選択
- `DimensionScoreRow.tsx`: 1 評価軸行。左 check / 中央 rationale / 右 score。
- `ImprovementIdeaGrid.tsx`: Round 2 改善案選択、Task 化ボタン
- `ImprovementIdeaCard.tsx`: 1 改善案 card。カード全体 click と selected 表示。
- `ProjectEvaluationTaskLinks.tsx`: Task 化後の Task link / Queue CTA。
- `projectEvaluationViewModel.ts`: API response から UI 表示への変換

分割時の順序:

1. `ProjectEvaluationMockScreen.tsx` から `EvaluationSummaryPanel`、`EvaluationHistorySidebar`、`DimensionSelector`、`ImprovementIdeaGrid` を先に切り出す。
2. `DimensionScoreRow` と `ImprovementIdeaCard` を次に切り出し、選択 UI を component boundary に閉じる。
3. mock data は `model/projectEvaluationMockData.ts` に一時退避する。
4. real API 接続後、mock data は tests / fixture 以外から削除する。
5. 各 step で `ProjectEvaluationMockScreen.tsx` と新規 component の行数を確認し、600 行を超えた状態で次 Phase へ進まない。

UI behavior:

- 初回評価がなければ、空 state と `評価を実行` を出す。
- 評価中は activity / phase を表示する。
- 最新評価があれば現在の mock と同じ情報密度で表示する。
- History は Round 1 までの高さにする。
- Round 2 は History に横幅を奪われない。
- 改善案は広い画面では 3 列、狭い画面では 2 列または 1 列へ落とす。
- Task 化ボタンは改善案選択時だけ活性化する。
- Task 化後は作成 Task のリンクまたは Queue 追加 CTA を表示する。

## 実装順

### Phase 0: 計画確認とベースライン

作業:

- この計画を確認する。
- 現行 mock のスクリーンショットを保存する。
- `ProjectEvaluationMockScreen.tsx` の分割先を確定する。

検証:

- `bunx biome check src/modules/project-evaluation`
- `bun run typecheck`
- Playwright で現行 mock の主要 UI が壊れていないこと。

停止条件:

- 既存 Project Queue / NightWorkersShell の差分と衝突する場合は先に解消する。

### Phase 1: Components ベースの mock 分割

作業:

- `ProjectEvaluationMockScreen.tsx` から表示 component を切り出す。
- 切り出し対象は `EvaluationSummaryPanel`、`EvaluationHistorySidebar`、`DimensionSelector`、`DimensionScoreRow`、`ImprovementIdeaGrid`、`ImprovementIdeaCard`、`ProjectEvaluationToolbar`。
- mock data は `model/projectEvaluationMockData.ts` に移す。
- `ProjectEvaluationMockScreen.tsx` は layout と state wiring だけに近づける。

検証:

- `wc -l src/modules/project-evaluation/**/*.tsx src/modules/project-evaluation/**/*.ts`
- `bunx biome check src/modules/project-evaluation`
- `bun run typecheck`
- Playwright で現行 mock UX が維持されていること。

停止条件:

- component 切り出し後にいずれかの project-evaluation file が 600 行を超える場合は先へ進まない。
- 表示差分が意図しない layout 変更を含む場合は real data 接続へ進まない。

### Phase 2: Evaluation role routing

作業:

- `api/routes/settings-runtime.ts` の `llmRoleSchema` と `LLM_ROLE_ORDER` に `evaluation` を追加する。
- `api/services/structured-llm/types.ts` と `api/services/structured-llm/settings.ts` の `StructuredLlmRole` に `evaluation` を追加する。
- `src/modules/nightworkers/types/provider-settings.ts` の `LlmRole` に `evaluation` を追加する。
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx` の `roleLabels` に `Evaluation` を追加する。
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts` の routing snapshot role list に `evaluation` を追加する。

検証:

- settings runtime tests で `evaluation` が normalize されること。
- structured LLM role routing tests で `evaluation` の primary/fallback が解決されること。
- `bun run typecheck`
- Settings Role Routing に Evaluation 行が出ることを Playwright または component smoke で確認する。

停止条件:

- 既存 persisted settings に `evaluation` が無くても Settings 保存で route が欠落しないことを確認するまで、評価 service から `role: "evaluation"` を使わない。

### Phase 3: Schema / DB / repository

作業:

- `shared/schemas/project-evaluation.schema.ts` を追加する。
- `api/db/project-evaluation-schema.ts` を追加する。
- migration を追加する。
- repository layer を `api/modules/project-evaluation/project-evaluation.repository.ts` に実装する。

検証:

- schema parse unit tests。
- repository unit tests。
- migration reset / migrate。
- `bun run typecheck`

停止条件:

- evaluation と improvement の保存・再読込で JSON shape が壊れる場合は API 実装へ進まない。

### Phase 4: Bundle / judge / improvement generator

作業:

- bundle builder を実装する。
- redaction と ignored path を実装する。
- structured LLM 用 prompt と JSON schema を実装する。
- evaluation judge と focused improvement generator を実装する。
- provider 失敗時は固定評価に差し替えず、失敗を返す。

検証:

- bundle builder unit tests。
- secret-like path / env 除外 tests。
- fixture provider で evaluation JSON parse tests。
- fixture provider で improvement JSON parse tests。
- LLM raw output が schema validation 失敗した場合の error tests。

停止条件:

- registered repository root 以外を読める設計になっている場合は修正する。
- prompt が英語運用ルールへ置き換わる場合は修正する。
- `callStructuredJsonLLM` に `role: "evaluation"` が渡っていない場合は修正する。

### Phase 5: API route

作業:

- route schema を追加する。
- service を `api/modules/project-evaluation/project-evaluation.service.ts` に実装する。
- `api/modules/nightworkers/nightworkers.routes.ts` か新規 route module に mount する。
- activity events を保存・返却する。

検証:

- route tests。
- latest/list/get/evaluate/improvements/tasks の happy path。
- not found / invalid dimension / empty selected idea / provider failure。
- `bun run typecheck`

停止条件:

- API が mock data を返している場合は UI 接続へ進まない。

### Phase 6: Task 化

作業:

- improvement idea -> NightWorkers Task 変換を実装する。
- `projectEvaluationTaskLinks` に評価と Task の関係を保存する。
- Task 作成時に system message で評価由来の evidence を残す。
- Queue 追加は既存 API を使い、Task 化とは分ける。

検証:

- Task 作成 unit tests。
- created task が `ready` になり、Project Queue の notQueued/planned 対象になること。
- Queue 追加 guard と整合すること。

停止条件:

- Task が Queue に入れられない acceptanceCriteria / message shape になる場合は修正する。

### Phase 7: Frontend real data 接続

作業:

- Phase 1 で分割済みの components に real data を接続する。
- API command と React controller hook を追加する。
- History / Summary / Dimension / Improvement / Task 化の表示を real data に接続する。
- mock data は story/test fixture にだけ残す。

検証:

- component unit tests。
- controller hook tests。
- Playwright smoke:
  - 評価なし empty state
  - 評価実行
  - History 選択
  - 軸選択
  - 改善案生成
  - 改善案選択
  - Task 化 button disabled/enabled
  - Task 作成後のリンク/CTA

停止条件:

- `src/modules/project-evaluation` 内の単一 file が 600 行を超える場合は分割してから完了扱いにする。

### Phase 8: Re-evaluation loop

作業:

- 作成 Task の完了後、同じ評価軸で再評価できる CTA を出す。
- 前回評価との score delta / dimension delta を表示する。
- History の比較表示を追加する。

検証:

- completed Task から re-evaluate できること。
- delta が保存・表示されること。

停止条件:

- Task 完了との関連が曖昧なまま自動再評価しない。

## ファイルサイズ方針

- 新規 frontend component は原則 300 行以下、上限 600 行。
- mock 分割は components ベースを基本にし、hook / model は UI component の責務を支える補助に留める。
- `ProjectEvaluationScreen.tsx` は layout coordinator として 250 行程度を目標にする。
- `DimensionSelector.tsx` と `ImprovementIdeaGrid.tsx` は row/card 子 component を持ち、1 file に list + card details を詰め込まない。
- API service は責務ごとに分け、上限 600 行。
- `api/db/schema.ts` はこれ以上増やさず、評価 schema は別 file にする。
- prompt は `project-evaluation-prompts.ts` に分離する。
- JSON schema と zod schema は shared schema に寄せる。
- test fixture は `tests/fixtures/project-evaluation` などに分ける。

## テスト計画

最低限:

- `bun run typecheck`
- `bunx biome check shared api src/modules/project-evaluation`
- role routing tests for `evaluation`
- project evaluation schema tests
- repository tests
- bundle builder tests
- prompt output parse tests with fixture provider
- API route tests
- frontend component/controller tests
- Playwright smoke

実装完了ゲート:

- `bun run verify`

ただし既存 unrelated failure がある場合:

- 失敗箇所を明記する。
- project-evaluation 関連の focused tests と `typecheck` は必ず通す。

## リスクと対策

### Evaluation role の追加漏れで provider route が planning に流れる

対策:

- `callStructuredJsonLLM` 呼び出し時に `role: "evaluation"` を必須にする。
- evaluation run に selected route / provider endpoint / model を保存する。
- Settings Role Routing の normalized response に `evaluation` が必ず含まれる test を追加する。

### LLM が評価を盛りすぎる

対策:

- evidence level と notVerified を必須にする。
- source inspection 未実施の項目は confidence を上げすぎない prompt にする。
- score だけでなく rationale と concerns を UI で強く表示する。

### provider 設定と評価実行がズレる

対策:

- structured LLM route を使う。
- selected model / provider endpoint を evaluation に保存する。
- UI に judge runtime を小さく表示する。

### Task 化した改善案が Queue guard で詰まる

対策:

- Task 作成時に objective / acceptanceCriteria / system message を十分に入れる。
- 初期は自動 Queue 投入しない。
- Queue 追加 CTA は既存 API の error をそのまま表示する。

### bundle が大きくなりすぎる

対策:

- content limit と tree limit を固定する。
- source sampling は Phase 4 以降の明示導入にする。
- raw content は必要箇所だけ保存し、digest を併用する。

### UI が再び巨大化する

対策:

- Phase 1 で mock component を分割する。
- controller hook と view components を分ける。
- 600 行超過を完了条件で禁止する。

## 完了条件

- Settings Role Routing に Evaluation role が表示され、保存・再読込できる。
- Project Evaluation は mock data なしで最新評価を表示できる。
- 評価実行が DB に保存され、History に出る。
- 選択軸から改善案を生成できる。
- 選択改善案から NightWorkers Task を作成できる。
- 作成 Task と評価/改善案の link が保存される。
- Task は Project Queue から扱える。
- 新規/変更 file が 600 行制約を満たす。
- focused tests、typecheck、UI smoke が通る。

## 実装可能性レビュー

現時点の計画は、以下を反映した後で実装着手可能と判断する。

改善済みの不足:

1. mock 分割の前提が曖昧だった。
   - 対応: Phase 1 を Components ベースの mock 分割に変更し、具体 component 名と順序を明記した。
2. 評価用途の role routing が未定義だった。
   - 対応: Phase 2 に `evaluation` role 追加を独立項目として追加した。
3. LLM route が planning へ流れる可能性があった。
   - 対応: 評価実行と改善案生成は `role: "evaluation"` 必須とした。
4. 実装開始直後の file size risk が残っていた。
   - 対応: real data 接続前に mock component を分割する停止条件を追加した。

残る注意点:

- DB migration 名と順序は実装開始時に `drizzle` の現行 latest を確認して決める。
- `api/db/schema.ts` は既に 600 行を超えているため、新規 table は必ず別 schema file に置く。
- Role Routing の persisted settings migration は破壊的変更にしない。既存 settings に `evaluation` が無い場合だけ default target を補完する。
- 初期実装では自動 Queue 投入をしない。Task 作成後の Queue CTA までに留める。
