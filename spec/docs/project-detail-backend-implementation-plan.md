# Project Detail Backend Implementation Plan

## 目的

Project Detail 画面の固定サンプルを外した状態から、実データで以下を動かすためのバックエンド実装計画を定義する。

- Overview の Project Metrics。
- Goal Definitions の Mission Goal 登録、編集、有効化。
- Mission & Generate Tasks の LLM ベース task candidate 生成、候補一覧、詳細 Drawer、Task 化。
- Quality の unit / coverage / E2E 実行、結果保存、結果表示。

この計画では、UI の見た目変更ではなく、DB、API、サービス境界、LLM 呼び出し位置、検証順序を固定する。

## 結論

LLM を使う場所は限定する。

1. Mission Goal と現在の project signal から task candidate を生成する。
2. 生成された candidate に、評価貢献、重要度、信頼度、複雑度、推奨理由、Task 化用 prompt を付ける。
3. Quality や Evaluation の結果が悪化したとき、それを signal として candidate 生成に渡す。

LLM を使わない場所も明確にする。

1. Mission Goal の保存、更新、有効化は deterministic な CRUD。
2. test / coverage / E2E の実行はローカル command 実行。
3. coverage-summary.json と E2E 結果のパース、pass/fail 判定は deterministic。
4. candidate の保存、選択、Task 化、Queue 投入は API 側の状態遷移。

理由は、LLM に実行結果や完了判定を任せると Quality 画面の信頼性が落ちるためである。LLM は「何をやるべきか」を提案する役割に閉じ、「何が起きたか」「成功したか」はコードが判定する。

## 既存資産

### 利用する既存パターン

- Project Evaluation:
  - `api/modules/project-evaluation/project-evaluation.routes.ts`
  - `api/modules/project-evaluation/project-evaluation.service.ts`
  - `api/modules/project-evaluation/project-evaluation.repository.ts`
  - `shared/schemas/project-evaluation.schema.ts`
- OpenAPI route:
  - `@hono/zod-openapi`
  - `createOpenApiRouter`
  - `withOpenApiRouteError`
- DB:
  - `api/db/schema.ts`
  - Drizzle sqlite schema。
- Quality gate:
  - `api/services/quality/coverage-gate.ts`
  - `api/services/quality/project-quality-prerequisites.ts`
  - `api/services/settings/test-quality-settings.ts`
- Long running command の参考:
  - `api/services/background-processes/index.ts`

### 再利用するが、混ぜないもの

Project Evaluation の improvement idea 生成は近いが、Mission task candidate 生成とは別物として扱う。

- Project Evaluation は、評価結果の改善案を作る。
- Mission & Generate Tasks は、Mission Goal と現在 signal から実装候補を作る。

両者は UI 上で近いが、source / schema / task createdBy を分ける。

## データモデル

### mission_goals

ユーザーが自然言語で作る「維持したい状態」または「目指したい状態」を保存する。

```ts
missionGoals = {
  id: string;
  repositoryId: string;
  title: string;
  goalText: string;
  active: boolean;
  source: 'user' | 'preset';
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
```

補足:

- `goalText` は LLM が読む主入力なので、ユーザー入力の自然言語を保持する。
- `title` は一覧表示用。空なら API 側で goalText から短縮生成せず、ユーザー入力を要求する。
- `source='preset'` は将来のテンプレート goal 用。初期実装では user のみでもよい。

### mission_task_candidate_batches

Generate 実行単位を保存する。

```ts
missionTaskCandidateBatches = {
  id: string;
  repositoryId: string;
  status: 'running' | 'completed' | 'failed';
  requestedGoalIdsJson: string[];
  signalSnapshotJson: ProjectSignalSnapshot;
  selectedModel: string | null;
  rawOutput: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### mission_task_candidates

LLM が生成し、ユーザーが Task 化候補として選ぶ行。

```ts
missionTaskCandidates = {
  id: string;
  batchId: string;
  repositoryId: string;
  goalId: string | null;
  title: string;
  summary: string;
  rationale: string;
  evidenceJson: CandidateEvidence[];
  evaluationContribution: number | null;
  importancePercent: number;
  confidencePercent: number;
  tokenSize: 'huge' | 'big' | 'medium' | 'small' | 'tiny';
  complexity: 'very_complex' | 'complex' | 'moderate' | 'simple' | 'trivial';
  taskPrompt: string;
  acceptanceCriteria: string;
  verificationPlan: string;
  status: 'candidate' | 'selected' | 'task_created' | 'dismissed';
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

補足:

- UI 表示の `very complex` は i18n 表示ラベル。DB は `very_complex` のような enum-safe な値にする。
- token estimate は実トークン数ではなく sizing label として保存する。
- `taskPrompt` は Task 化するときの `objective` に使う。

### project_quality_runs

Quality 画面の実行履歴。

```ts
projectQualityRuns = {
  id: string;
  repositoryId: string;
  runType: 'unit' | 'e2e' | 'all';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  command: string;
  exitCode: number | null;
  startedAt: Date;
  completedAt: Date | null;
  outputArtifactId: string | null;
  coverageSummaryJson: CoverageSummary | null;
  coverageGateJson: CoverageGateResult | null;
  e2eSummaryJson: E2ESummary | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

補足:

- stdout/stderr の長文は artifact に逃がす。
- 一覧 API は summary だけ返す。
- 詳細 API は必要なら artifact 参照を返す。

## Project Signal Snapshot

LLM に渡す signal は API 側で組み立てる。LLM が直接 DB を読む設計にしない。

```ts
type ProjectSignalSnapshot = {
  repository: {
    id: string;
    name: string;
    localPath: string;
    branch: string;
  };
  activeGoals: Array<{
    id: string;
    title: string;
    goalText: string;
  }>;
  latestEvaluation: {
    id: string;
    overallScore: number;
    dimensions: Array<{ key: string; score: number; label: string }>;
    summary: string;
  } | null;
  latestQuality: {
    coverage: CoverageGateResult | null;
    e2e: E2ESummary | null;
  };
  qualityCapabilities: {
    projectType: 'typescript';
    commands: Array<{
      kind: 'unit' | 'coverage' | 'e2e' | 'verify';
      source: 'package_json' | 'configured';
      command: string;
      runnable: boolean;
      reason?: string;
    }>;
    missingCapabilities: Array<'unit' | 'coverage' | 'e2e'>;
  };
  recentTokenSpendTasks: Array<{
    taskId: string;
    title: string;
    totalTokens: number;
    callCount: number;
  }>;
  recentRuns: {
    completed: number;
    failed: number;
    running: number;
  };
};
```

初期実装で必須にする signal:

1. activeGoals。
2. latestProjectEvaluation。
3. latestQualityRun。
4. qualityCapabilities。
5. llm usage 由来の top token spend task。

## API 設計

### Overview / Metrics

```http
GET /api/repositories/:id/project-detail/metrics
```

返却:

```ts
{
  runs: {
    total: number;
    completed: number;
    failed: number;
  };
  llmUsage: {
    totalTokens: number;
    totalCost: number | null;
    averageTokensPerRun: number | null;
    averageCostPerRun: number | null;
    modelMix: Array<{ provider: string; model: string | null; calls: number; tokens: number; cost: number | null }>;
    topTokenTasks: Array<{ taskId: string; title: string; tokens: number; cost: number | null }>;
  };
  health: {
    latestEvaluationScore: number | null;
    coverageAverage: number | null;
  };
}
```

実装:

- `llm_usage_records` と `tasks` を repositoryId で集計する。
- Project Evaluation は latest completed run の score を読む。
- Coverage は latest completed `project_quality_runs.coverageGateJson` の 4 指標平均を読む。

### Mission Goal

```http
GET /api/repositories/:id/mission-goals
POST /api/repositories/:id/mission-goals
PATCH /api/repositories/:id/mission-goals/:goalId
DELETE /api/repositories/:id/mission-goals/:goalId
```

POST body:

```ts
{
  title: string;
  goalText: string;
  active: boolean;
}
```

UI:

- Add Goal は modal form を開く。
- form は `title`, `goalText`, `active` のみで開始する。
- 既存 goal の編集も同じ modal を使う。
- active toggle は一覧から即時 PATCH できる。

プリセット goal:

```http
GET /api/mission-goal-presets
POST /api/repositories/:id/mission-goals/from-preset
```

初期実装では presets は DB ではなく定数でもよい。例:

- Keep unit coverage above configured threshold.
- Keep planning quality above threshold.
- Control recurring LLM token spend.
- Keep queue execution reliability healthy.

ただし、preset も repository に追加された時点で `mission_goals` にコピーする。preset を参照し続ける設計にしない。

### Mission & Generate Tasks

```http
GET /api/repositories/:id/mission-task-candidates?status=candidate
POST /api/repositories/:id/mission-task-candidates/generate
GET /api/mission-task-candidates/:candidateId
PATCH /api/mission-task-candidates/:candidateId
POST /api/repositories/:id/mission-task-candidates/create-tasks
```

Generate body:

```ts
{
  goalIds?: string[];
  includeInactiveGoals?: boolean;
}
```

Generate response:

```ts
{
  batchId: string;
  status: 'completed' | 'failed';
  candidates: MissionTaskCandidate[];
}
```

初期実装では同期実行でよい。LLM 実行が重くなったら Project Evaluation と同じように `start` API と activity polling に分ける。

Task 化 body:

```ts
{
  candidateIds: string[];
  mode: 'draft' | 'ready';
}
```

Task 作成:

- `tasks.title` = candidate.title
- `tasks.description` = candidate.summary + evidence + rationale
- `tasks.objective` = candidate.taskPrompt
- `tasks.acceptanceCriteria` = candidate.acceptanceCriteria + verificationPlan
- `tasks.createdBy` = `mission-task-candidate`
- candidate.status = `task_created`
- candidate.taskId = created task id

### Candidate Drawer

Drawer は一覧行クリックで開く。初期実装では一覧 API に詳細を全部含めてもよいが、将来の payload 肥大を避けるなら detail API に分ける。

Drawer に表示する項目:

- title
- summary
- linked goal
- rationale
- evidence
- evaluationContribution
- importance
- confidence
- tokenSize
- complexity
- taskPrompt
- acceptanceCriteria
- verificationPlan
- linked task id
- batch metadata

Drawer actions:

- Select / unselect
- Dismiss
- Create Task
- Open linked Task

Drawer では candidate の再評価や LLM 再生成はしない。再生成は一覧上部の Generate のみ。

### Quality

```http
GET /api/repositories/:id/quality
GET /api/repositories/:id/quality/runs
POST /api/repositories/:id/quality/runs
GET /api/repositories/:id/quality/runs/:runId
POST /api/repositories/:id/quality/runs/:runId/cancel
```

POST body:

```ts
{
  runType: 'unit' | 'e2e' | 'all';
}
```

初期実装の対象は TypeScript project に限定する。Command mapping は対象 project の `package.json` scripts と project-specific quality settings から test command capability を出力する。

初期 capability source:

- Configured:
  - project-specific quality settings に明示 command がある場合、それを最優先する。
- `package.json`:
  - `test` を unit test capability として扱う。
  - `test:coverage` を coverage capability として扱う。
  - `test:e2e` を E2E capability として扱う。
  - `verify` は Overview / Mission signal では参照するが、Quality 画面の Run Unit / Run E2E の代替にはしない。

NightWorkers 側で `package.json` に存在しない test command を推測・合成しない。

Rust / Java / Python など TypeScript 以外の project type adapter は初期実装の非目標とする。

- `unit` は unit capability が runnable の場合だけ実行可能。coverage capability も runnable なら coverage report を保存し、無ければ unit test result のみ保存する。
- `e2e` は e2e capability が runnable の場合だけ実行可能。
- `all` は unit capability と e2e capability が runnable の場合だけ実行可能。coverage capability があれば coverage report も保存する。
- 必要 capability が存在しない場合、Quality run API は `missing_quality_capability` として 400 を返し、run record は作成しない。
- capability が存在しない状態を Quality 画面内で代替実行しない。

Quality API は実行可否を返す。

```ts
{
  capabilities: {
    projectType: 'typescript';
    unit: { runnable: boolean; missingCapabilities: string[]; command?: string };
    coverage: { runnable: boolean; missingCapabilities: string[]; command?: string };
    e2e: { runnable: boolean; missingCapabilities: string[]; command?: string };
    all: { runnable: boolean; missingCapabilities: string[] };
  };
}
```

Quality run は LLM を使わない。

結果パース:

- coverage:
  - `coverage/coverage-summary.json` を `parseCoverageSummaryJson` で読む。
  - `nightworkers-quality.json` の threshold で `evaluateCoverageGate` を実行する。
- E2E:
  - Playwright JSON reporter を使えるなら、専用 output path を指定して JSON を保存する。
  - 初期実装で JSON reporter が難しい場合は exitCode と output artifact のみ保存し、E2E table は suite breakdown 未取得として扱う。

Quality screen の表示:

- latest completed unit run と coverage report。
- latest completed E2E run。
- running run があれば status と latestOutput。
- coverage table は Jest HTML 風ではなく、coverage-summary の total と file rows が取れるなら file rows を表示する。json-summary は total 中心なので、file rows が必要なら `coverage-final.json` か lcov parser が必要。

## LLM 設計

### LLM role

新しい structured LLM task route を追加する。

候補:

- `mission_task_generation`

理由:

- Project Evaluation の `evaluation` route と混ぜない。
- Quality gate の `quality_gate` route と混ぜない。
- Supervisor 実行判断とは別の「候補生成」用途である。

### 入力

LLM に渡す prompt は以下を含む。

- Mission Goal 一覧。
- ProjectSignalSnapshot。
- 既存の未 Task 化 candidate。
- 既存 task title の重複回避用リスト。
- qualityCapabilities。unit / coverage / e2e capability が欠けている場合は、TypeScript project の `package.json` scripts または project quality settings を整備する candidate を最優先にする。
- 出力 schema。

LLM に渡さないもの:

- full repository source。
- 生ログ全文。
- secret / env。
- test output 全文。

### 出力 schema

```ts
{
  schemaVersion: 'nightworkers.mission-task-candidates/v1';
  candidates: Array<{
    title: string;
    summary: string;
    rationale: string;
    goalId?: string;
    evidence: Array<{
      source: 'mission_goal' | 'project_evaluation' | 'quality' | 'llm_usage' | 'recent_runs';
      label: string;
      value: string;
    }>;
    evaluationContribution?: number;
    importancePercent: number;
    confidencePercent: number;
    tokenSize: 'huge' | 'big' | 'medium' | 'small' | 'tiny';
    complexity: 'very_complex' | 'complex' | 'moderate' | 'simple' | 'trivial';
    taskPrompt: string;
    acceptanceCriteria: string;
    verificationPlan: string;
  }>;
}
```

API 側 validation:

- candidates は 1-10 件。
- title / taskPrompt / acceptanceCriteria / verificationPlan は必須。
- importance / confidence は 0-100。
- 同一 batch 内 title 重複を reject または merge。
- 既存未完了 task と title が近すぎる場合は `dismissed` ではなく `candidate` 保存時に `duplicateWarning` を evidence に入れる。
- qualityCapabilities に missing capability がある場合、少なくとも 1 件は TypeScript project の unit test / coverage / E2E command 整備 candidate を返す。importancePercent は 95 以上を期待し、返ってこない場合は API 側で generation result を invalid とする。

## UI 連携方針

### Goal Definitions

追加する UI:

- Add Goal button -> modal。
- row click or edit icon -> edit modal。
- active toggle。
- preset dropdown または modal 内の "Use preset" セクション。

Modal fields:

- Title。
- Goal definition。
- Active。

初期実装で不要:

- taskization rule。
- current signal。
- numeric target。
- execution policy。

### Mission & Generate Tasks

追加する UI:

- Generate button。
- candidate table fetch。
- row click -> Drawer。
- checkbox or select action。
- selected candidates -> Create Tasks。
- dismiss action。

この画面では候補の採用選定だけを行う。候補の評価編集や採点調整はやらない。

### Quality

追加する UI:

- Run Unit。
- Run E2E。
- Run All。
- running status。
- latest output summary。
- coverage table。
- E2E result table。

Quality 実行結果から自動で task candidate を生成しない。ユーザーが Mission & Generate Tasks で Generate を押した時に、latest quality signal として LLM に渡す。

unit / coverage / E2E capability が無い場合:

- 対応する Run button は disabled にする。
- 欠落 capability を Quality 画面に表示する。
- 自動で Task は作らない。
- Mission & Generate Tasks の Generate では、欠落 capability の整備を最優先 candidate として出す。

## 実装フェーズ

### Phase 1: Schema and repository

変更:

- `shared/schemas/project-detail.schema.ts` を追加。
- `api/db/schema.ts` に以下を追加。
  - `missionGoals`
  - `missionTaskCandidateBatches`
  - `missionTaskCandidates`
  - `projectQualityRuns`
- repository service を追加。
  - `api/modules/project-detail/project-detail.repository.ts`

検証:

- schema unit test。
- DB insert/list/update/delete test。
- `bun run db:generate`。

### Phase 2: Goal API

変更:

- `api/modules/project-detail/project-detail.routes.ts`
- `api/modules/project-detail/project-detail.service.ts`
- app router 登録。
- frontend commands 追加。

検証:

- GET empty。
- POST goal。
- PATCH active。
- DELETE goal。
- repository mismatch を 404/400 にする。

### Phase 3: Metrics API

変更:

- Project Detail metrics aggregation。
- latest evaluation score 取得。
- latest quality run 取得。
- top token spend tasks 集計。

検証:

- llm_usage_records fixture で集計。
- latest evaluation なしなら null。
- quality run なしなら null。

### Phase 4: Mission task candidate generation

変更:

- `shared/schemas/mission-task-candidates.schema.ts` 追加でもよい。
- `api/modules/project-detail/mission-task-generation.service.ts`
- structured LLM prompt / route `mission_task_generation`。
- candidate batch / candidate 保存。

検証:

- LLM stub で candidate 保存。
- invalid LLM output reject。
- goal inactive handling。
- duplicate candidate handling。
- missing unit / coverage / e2e capability signal がある場合、TypeScript project の品質 command 整備 candidate が最優先で保存される。

### Phase 5: Candidate Drawer and Task creation API

変更:

- detail API。
- candidate status PATCH。
- create tasks API。
- frontend Drawer。
- Task 作成後に linked task へ遷移できるようにする。

検証:

- selected candidate だけ Task 化。
- same candidate の二重 Task 化 reject。
- createdBy が `mission-task-candidate`。

### Phase 6: Quality run backend

変更:

- Quality run API。
- command runner service。
- coverage-summary parser 連携。
- output artifact 保存。
- E2E result parser の最小実装。

検証:

- quality capability missing。
- missing capability では run record を作らず 400 を返す。
- coverage-summary parse success/failure。
- command exitCode 0/1。
- running -> completed/failed。
- cancel。

### Phase 7: Quality UI integration

変更:

- ProjectDetailScreen の空配列を API data に差し替え。
- run buttons を API に接続。
- polling。
- i18n 追加。

検証:

- no data empty state。
- running state。
- missing capability disabled state。
- completed coverage display。
- failed E2E display。

## 非目標

- Mission Pilot 全体の自律実行。
- Goal 達成度の常時自動監視。
- Quality 低下時の自動 Task 作成。
- `package.json` または project quality settings に存在しない test command の推測実行。
- Rust / Java / Python など TypeScript 以外の project adapter。
- LLM による test result 判定。
- Project Evaluation 画面の改修。
- Kanban との統合。
- ExecutionPolicy の詳細設定 UI。

## 失敗時の扱い

### LLM generation failed

- batch.status = `failed`
- errorMessage を保存。
- 既存 candidates は消さない。
- UI は前回候補を表示したまま、最新 batch failure を通知する。

### Quality command failed

- projectQualityRuns.status = `failed`
- exitCode と output artifact を保存。
- coverage/E2E parse ができた場合は partial summary を保存する。
- LLM による説明文へ差し替えない。

### Required quality capability missing

- Quality run API は 400 を返す。
- projectQualityRuns record は作成しない。
- response に missing capability を含める。
- ProjectSignalSnapshot.qualityCapabilities に欠落を含める。
- Mission candidate generation は、欠落 capability を満たす test command / coverage command / E2E command の追加を最優先 candidate として扱う。

### Coverage summary missing

- run は command exitCode に従って completed/failed。
- coverageGateJson は null。
- errorMessage に `coverage-summary.json not found` を保存。

### Task creation failed

- candidate.status は変更しない。
- 作成済み task がある場合は transaction で rollback する。

## 推奨する最初の実装順

最初の PR / commit では Phase 1-2 だけにする。

理由:

- Goal 登録 modal と一覧の実データ化が最も依存が少ない。
- LLM と Quality 実行を同時に入れると失敗原因が分かりにくい。
- Goal が実データ化されると、Mission candidate generation の入力が確定する。

次に Phase 3-5、最後に Phase 6-7 を実装する。

Quality は command execution と artifact 保存を含むため、Mission LLM より後に分ける。

## 検証コマンド

各 phase 共通:

```bash
bunx tsc --noEmit --pretty false
bun run build:frontend
bun run build:backend
bun run verify
```

追加予定:

```bash
bunx vitest run tests/project-detail-*.test.ts
bunx vitest run tests/services.project-quality-runs.test.ts
bunx vitest run tests/routes.project-detail.test.ts
```

Quality phase では fixture repository を使い、実 repository の test command を直接叩かない unit test を先に作る。

## 受け入れ条件

- Project Detail Overview が実データまたは null/empty state のみを表示する。
- Mission Goal を modal から作成、編集、有効化できる。
- Generate Tasks が active goal と project signal を使って candidate を保存できる。
- Candidate Drawer で LLM 出力の根拠と Task 化用 prompt を確認できる。
- 選択 candidate から draft/ready task を作成できる。
- Quality 画面から unit / E2E / all を実行し、結果が保存・再表示される。
- 対象 TypeScript project で必要な quality capability が検出・設定できない場合、Quality 実行は不可になり、Mission & Generate Tasks で `package.json` scripts または project quality settings の整備 candidate が最優先表示される。
- LLM は candidate 生成以外の判定に使われていない。
