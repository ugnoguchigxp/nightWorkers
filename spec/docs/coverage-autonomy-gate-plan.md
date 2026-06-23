# Coverage Autonomy Gate 実装計画

## 実装済み接続点

この計画の初回実装では、Coverage Autonomy Gate を次の runtime boundary に接続した。

- Settings の Test section で Project-scoped `nightworkers-quality.json` を保存する。
- `GET /repositories/:id/settings/test-quality` / `PUT /repositories/:id/settings/test-quality` で登録済み Project repo root にだけ読み書きする。
- native/API runner では `finalize_answer` の直前に deterministic coverage gate を実行する。
- coverage 未達、coverage command failure、summary 不正は `finalize_answer` tool failure として model に返し、同じ run 内で test-focused iteration を継続させる。
- `coverageMaxIterations`、停滞、wall-clock stop、source guard block、prerequisite missing の場合は finalize を許可するが、run outcome は `needs_human` に落とす。
- native/API runner 以外の runtime では run finalization fallback として coverage gate を実行し、未達を completion success にしない。
- `evaluateTodoCompletionGate` は `testResults.coverageAutonomy` を evidence に含め、coverage 未達時は Todo completion を pass にしない。
- Timeline には既存 `verification.finished` event として coverage gate payload を残し、final report には coverage result summary を追記する。
- source guard は deterministic に `NODE_ENV === 'test'`、`process.env.VITEST`、coverage ignore directive、test selector 追加を production source diff から検出する。
- token / cost は provider usage 確定前の gate では未取得のため、初回実装では payload に unavailable として明示し、wall-clock と iteration を hard stop とする。

今後の拡張候補:

- provider usage DB と連携した token / cost hard stop。
- 専用 Timeline coverage card。
- testability exception の approval UI。
- file-level target candidate を UI に出す詳細 ranking。

## 目的
NightWorkers に、Settings で設定した unit test coverage 目標を品質ゲートとして扱い、目標到達まで agent がテスト追加、再検証、再計画を自走できる仕組みを追加する。

この計画の中心は「coverage 目標を prompt 上の努力目標ではなく、runtime が判定する完了条件にする」ことである。LLM には狭い実装作業を任せ、目標判定、停滞検出、コスト警告、Role 切り替え、source 変更の制御は NightWorkers 側で deterministic に扱う。

## レビュー観点
他の LLM または人間 reviewer には、特に次を確認してほしい。

1. Settings の単一 threshold を全 coverage metric に適用する判断が、運用上過剰または不足になっていないか。
2. File 単位 LowCoverage を hard gate にせず soft signal にする判断が、品質保証として弱すぎないか。
3. 停滞時の micro `context_compile` と `context_decision` escalation の境界が、token cost と解決可能性のバランスを取れているか。
4. Test role の source change policy が、behavior-changing change を十分に抑制しつつ、testability exception を詰まらせない形になっているか。
5. Coverage gate を template project の `verify` に統合せず、初期は別 step とする判断が、既存 verification workflow と矛盾しないか。
6. 初期実装で provisional completion を除外する判断が妥当か。将来 deferred coverage debt を許す場合、approval flow が品質ゲートの意味を壊さないか。
7. Local LLM 前提で、runtime deterministic control と LLM 自律判断の分担が妥当か。

## 範囲

### 実装すること
1. Settings に Test セクションを追加し、coverage gate の有効化と単一の最低 coverage percent を設定できるようにする。
2. 単一の最低 coverage percent を `statements` / `branches` / `functions` / `lines` の全指標へ同じ基準で適用する。
3. Vitest coverage summary を構造化して読み取り、品質ゲートで `actual` / `target` / `delta` / `passed` を判定する。
4. 目標未達時に、coverage 改善ループを継続するための runtime decision を追加する。
5. 停滞時に、より細かい goal で `context_compile` を呼ぶ micro replan path を追加する。
6. token / cost / iteration / coverage delta を見て、警告、方針変更、停止、`context_decision` への escalation を行う。
7. Test role が coverage 達成目的で production behavior を壊すことを防ぐため、source diff policy と testability exception flow を追加する。
8. coverage 未達、停滞、例外、警告、次アクション候補を user-visible evidence として保存・表示する。

### 実装しないこと
- metric ごとに別々の閾値を設定する UI は初期実装に含めない。
- file 単位 coverage を hard gate にしない。
- test role に production code の自由編集権限を与えない。
- provider / llm-provider 層に coverage 判定、Role 切り替え、SystemContext 分岐を追加しない。
- ユーザー文言の keyword / regex 判定で coverage loop を起動しない。
- `context_decision` を毎 iteration 呼ぶ設計にしない。
- coverage 目標を agent が黙って下げる自動妥協はしない。
- live LLM test や E2E coverage を初期 gate に含めない。

## 背景と現状

現状の NightWorkers には次の土台がある。

- `vitest.config.ts`
  - coverage provider は `v8`。
  - coverage 対象 include / exclude が定義済み。
- `package.json`
  - `test:coverage` は `vitest run --coverage`。
  - 初期対象の template project には原則 `verify` があるが、`verify:base` はない。代表 verification gate は `verify` として扱う。
  - template variant に `verify` がない場合は、fallback quality gate で済ませず、その template に `verify` script を作成する。
- `src/modules/nightworkers/types/provider-settings.ts`
  - `LlmRole` に `test` と `quality_gate` が既に存在する。
- `src/modules/nightworkers/components/SettingsForms.ts`
  - Settings sections は General / Appearance / LLM Providers / Role Routing / Hooks / MCP。
  - Test section はまだない。
- `api/services/todo-runtime/todo-list-builder.ts`
  - final gate に「品質ゲート verify コマンドを通す」がある。
  - 現在は prompt / Todo 文言として「失敗したら修正して再実行する」を要求している。
- `api/services/todo-runtime/gate.ts`
  - runtime result の terminal state、outcome、stop reason を見る completion gate がある。
  - coverage 指標の構造化判定はまだない。

このため、最初の実装は既存 Role Routing を増やすより、Settings の Test section と runtime quality gate の接続を増やす方が自然である。

## 目標状態
Settings で `Coverage gate` を有効にし、最低 coverage を `80%` に設定した場合、NightWorkers は次を満たす。

1. `statements` / `branches` / `functions` / `lines` のすべてが 80% 以上なら coverage gate は pass する。
2. 1つでも 80% 未満なら gate は fail し、未達指標、現在値、不足分を保存する。
3. 未達時は test role に狭い改善 target を渡し、coverage を再計測する。
4. 改善が続いている間は自動継続できる。
5. 改善が止まった場合は micro `context_compile`、target file 切り替え、implementation role への昇格、`context_decision`、または警告付き停止へ分岐する。
6. Test role が behavior-changing source change を行った場合は、その iteration を成功扱いにしない。
7. Testability のために `data-testid`、accessibility label、pure helper export、dependency injection などが必要な場合は、明示的な exception request と review gate を通す。
8. user は coverage gate の結果、反復回数、token / cost、停滞理由、次アクション候補を確認できる。

## 設計判断

### 1. 設定は単一 percent にする
ユーザー設定は `coverageMinimumPercent` の単一値にする。

```ts
type TestQualitySettings = {
  coverageGateEnabled: boolean;
  coverageMinimumPercent: number;
  coverageMaxIterations: number;
};
```

判定時だけ内部で全 metric に展開する。

```ts
statements >= minimum &&
branches >= minimum &&
functions >= minimum &&
lines >= minimum
```

metric 別の閾値は、初期実装では複雑さと逃げ道を増やす割に利用頻度が低い。特に `branches` だけを低くする設定は、coverage gate の品質保証として弱くなりやすい。

ただし `branches` は switch、三項演算子、null 合体、短絡評価で他 metric より低くなりやすい。初期実装では `branches` だけ warning-only にする設定は入れないが、次を必須にする。

- `branches` だけ未達の場合は、report で他 metric と分けて表示する。
- `branches` だけ未達で、1 iteration 後の branch delta が +0.1 percentage point 未満の場合は、通常の 2回連続 no-improvement を待たず micro `context_compile` または target 切り替えへ進める。
- `/* istanbul ignore */`、`/* c8 ignore */`、test-only branch など、coverage 回避のための source change は behavior-changing / policy violation として扱う。

### 2. File 単位 LowCoverage は soft signal にする
Repo 全体の coverage gate は hard gate とする。一方で、file 単位の LowCoverage は次に狙う target candidate であり、原則として hard block しない。

例外として、今回変更した file が低すぎる場合は警告または追加 Todo にする。今回触っていない legacy file が低い場合は、全体 gate が pass していれば完了可能とする。

### 3. Local LLM に柔軟判断を任せない
Local LLM には「どこで取り返すか」を自由に考えさせない。NightWorkers が coverage summary から候補を作り、次の狭い target を渡す。

```ts
type CoverageTargetCandidate = {
  filePath: string;
  reason:
    | 'changed_file_low'
    | 'large_uncovered_lines'
    | 'branch_gap'
    | 'easy_total_gain'
    | 'previous_target_stalled';
  statementsPct: number;
  branchesPct: number;
  functionsPct: number;
  linesPct: number;
  uncoveredLines: number;
  uncoveredBranches: number;
  staticOpportunityScore: number;
  previousAttempts: number;
};
```

`staticOpportunityScore` は「改善見込み percent」ではない。LLM が実際にどのテストを書くかは予測できないため、初期実装では uncovered lines、uncovered branches、changed file かどうか、既存 test file の有無などから作る静的な ranking score に限定する。UI や report では「推定 gain」と表示しない。

### 4. 停滞時だけ micro context_compile を使う
`context_compile` は毎 iteration 呼ばない。使うのは停滞時の再計画である。

有効な場面:

- どの file を狙うべきか分からなくなった。
- coverage が伸びない理由が構造的に見えていない。
- test 追加ではなく implementation change が必要そう。
- 既存 test pattern、mock 方針、責務境界を見失っている。
- 同じ失敗を繰り返している。

micro goal は repo 全体ではなく、対象 file、metric、直近失敗、試した変更に絞る。payload は次を必須フィールドにする。

- target file。
- metric gap。
- current coverage と previous coverage。
- 直近 iteration で試した diff summary。
- 失敗した test output の短い抜粋。
- 既に試した target と失敗理由。
- source change policy の現在状態。

含めないもの:

- raw secret。
- 長大な test log。
- coverage HTML / lcov 全文。
- repo 全体の無関係な diff。

例:

```text
api/services/foo.ts の branch coverage が 74% から伸びない原因を、
既存テスト方針と責務境界に基づいて特定し、次に試す最小変更を決める。
```

### 5. cost / progress gate を deterministic に挟む
`context_decision` は escalation 先であり、通常ループのたびに呼ぶものではない。まず NightWorkers が token / cost / iteration / coverage delta を見て機械判定する。

```ts
type CoverageLoopAction =
  | 'continue_same_strategy'
  | 'switch_target_file'
  | 'switch_to_implementation'
  | 'run_micro_context_compile'
  | 'ask_context_decision'
  | 'stop_with_warning';
```

初期方針:

- 1回目の未達は自動継続。
- 2回連続で改善なしなら micro `context_compile`。
- `branches` だけ未達で branch delta が +0.1 percentage point 未満なら、1回の停滞で micro `context_compile` または target 切り替えへ進む。
- micro compile 後も改善なしなら target 切り替えまたは `context_decision`。
- 3回以上改善なし、iteration 上限到達、または cost 上限超過なら warning / stop。
- 初期 `maxIterations` は 5 とする。Settings UI には advanced control として表示し、通常は 5 のまま使う。
- 初期 token / cost 閾値は、coverage loop 単位で warning: 50,000 total tokens または $0.50、stop: 200,000 total tokens または $2.00 とする。Provider pricing が不明な local endpoint では token 閾値と iteration 上限だけを使う。Phase 0 で repo と provider の実測に基づき調整してよいが、閾値未定義のまま Phase 6 に入らない。
- Local LLM や pricing 不明 endpoint では wall-clock も hard stop 条件にする。初期値は warning: 20 minutes、stop: 45 minutes とし、Phase 0 の full coverage baseline と provider speed に基づいて調整してよい。

### 6. Test role は source を勝手に変えない
Test role に「source 変更禁止」とだけ書くと、`data-testid` や testability 用 helper の追加ができずに詰まる。正しい制約は「Test role が production behavior を勝手に変えてはいけない」である。

変更を次の 3 種類に分ける。

1. 許可: test-only change
   - `tests/**`
   - fixtures
   - mocks
   - test utilities
2. 条件付き許可: testability-only source change
   - `data-testid` / `aria-label` 追加
   - semantic に自然な label / role の追加
   - pure helper の export
   - dependency injection の受け口追加
   - 非破壊 logging / trace / inspection metadata
3. 禁止: behavior-changing source change
   - 分岐条件の変更
   - fallback の追加
   - error の握りつぶし
   - `NODE_ENV === 'test'` や `process.env.VITEST` による test-only branch
   - 期待値に合わせた固定値
   - validation / schema / API contract の緩和

Test role が source change を必要と判断した場合は、直接編集ではなく exception request を出す。runtime は diff classifier と review gate を通し、必要なら small implementation Todo に昇格する。

この policy は coverage autonomy loop より先に最小実装する。loop を先に作って source guard を後付けすると、coverage 達成目的の behavior-changing source change が成功扱いになる抜け穴が残るためである。

Classifier は whitelist-first とする。初期実装では production source diff が 1 行でも存在する場合、明示的に許可した testability-only pattern に一致しない限り `source_change_requires_review` とする。Whitelist に一致した場合も、その iteration を自動成功扱いにはせず、`testability_exception_requested` として review / implementation 昇格の対象にする。許可 pattern は限定的に扱い、正規表現だけで完結させず、可能な範囲で AST または structured diff check を併用する。

### 7. `quality_gate` role は判定役に限定する
Coverage autonomy loop では `test` role がテスト追加や testability exception request を担当する。`quality_gate` role は次に限定する。

- coverage summary、verify result、diff policy result を読む。
- coverage gate の pass / fail を説明する。
- 未達時の次 action 候補を整理する。
- 必要なら `context_decision` escalation のための短い判断材料を作る。

`quality_gate` role は production code や tests を編集しない。coverage 改善の実作業は `test` role、behavior-changing または testability source change が必要な場合は `implementation` role に昇格する。

呼び出しタイミングは次に限定する。

1. Coverage command と deterministic gate evaluator の後、単純に次の `test` target へ進めない fail が発生したとき。
2. Test role iteration 後、minimal source guard、focused test、coverage 再測定を終えても改善がない、または branches-only stagnation に入ったとき。
3. `run_micro_context_compile` の前後で、deterministic action selector が `switch_to_implementation`、`ask_context_decision`、`stop_with_warning` を候補にしたとき。
4. `context_decision` へ escalation する直前に、coverage gap、試行履歴、source policy、token / cost を短い判断材料へまとめるとき。
5. 最終 warning / stop report を作るとき。

呼ばない場面:

- Coverage gate が pass したとき。
- 初回 fail で、deterministic selector が次の `test` target を明確に選べるとき。
- source guard が deterministic に block できる禁止 pattern を検出しただけのとき。

基本順序は次の通り。

```text
coverage command
  -> deterministic coverage gate
  -> simple target があれば test role
  -> minimal source guard
  -> focused tests
  -> coverage command
  -> deterministic action selector
  -> 必要時だけ quality_gate role
  -> micro context_compile / context_decision / stop / next role
```

## データモデル

### TestQualitySettings

```ts
type TestQualitySettings = {
  coverageGateEnabled: boolean;
  coverageMinimumPercent: number;
  coverageMaxIterations: number;
  coveragePreset?: '70' | '80' | '85' | '90' | '95' | 'custom';
  updatedAt?: string;
};
```

初期 default:

- `coverageGateEnabled: false`
- `coverageMinimumPercent: 80`
- `coverageMaxIterations: 5`

Feature introduction 直後に既存 repo が fail し続けることを避けるため、最初は disabled default にする。ユーザーが有効化した場合に hard gate として扱う。

### CoverageMetricResult

```ts
type CoverageMetricName = 'statements' | 'branches' | 'functions' | 'lines';

type CoverageMetricResult = {
  metric: CoverageMetricName;
  actualPercent: number;
  targetPercent: number;
  deltaPercent: number;
  passed: boolean;
};

type CoverageGateResult = {
  enabled: boolean;
  passed: boolean;
  targetPercent: number;
  metrics: CoverageMetricResult[];
  summaryPath: string;
  measuredAt: string;
  command: string;
};
```

### CoverageAutonomyState

```ts
type CoverageAutonomyState = {
  iteration: number;
  maxIterations: number;
  previousResults: CoverageGateResult[];
  previousResultsRetention: {
    recentLimit: number;
    olderSummary?: string;
  };
  currentTarget?: CoverageTargetCandidate;
  consecutiveNoImprovement: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  };
  sourcePolicy: TestLoopSourcePolicy;
};
```

`maxIterations` は Settings の `coverageMaxIterations` を使い、未設定時は 5 とする。上限に到達した場合は自動継続せず、coverage 未達、直近 delta、token / cost、次 action 候補を warning として出す。

`previousResults` は直近 3 件だけを保持する。古い iteration は `olderSummary` に、最小値、最大値、最後に改善した metric、試した target count を要約する。全 iteration の巨大な coverage result を run state に積み続けない。

### CoverageAutonomyBudget

```ts
type CoverageAutonomyBudget = {
  warningTotalTokens: number;
  stopTotalTokens: number;
  warningEstimatedCostUsd: number;
  stopEstimatedCostUsd: number;
  warningWallClockMinutes: number;
  stopWallClockMinutes: number;
};
```

初期 default:

- `warningTotalTokens: 50_000`
- `stopTotalTokens: 200_000`
- `warningEstimatedCostUsd: 0.5`
- `stopEstimatedCostUsd: 2.0`
- `warningWallClockMinutes: 20`
- `stopWallClockMinutes: 45`

Provider pricing が取れない場合は cost threshold を使わず、token threshold、wall-clock threshold、`maxIterations` で判定する。

### TestLoopSourcePolicy

```ts
type TestLoopSourcePolicy =
  | { mode: 'test_only' }
  | {
      mode: 'testability_exception_requested';
      reason: string;
      files: string[];
      allowedChangeKinds: Array<
        'test_id' | 'accessibility_label' | 'export_helper' | 'dependency_injection' | 'trace_metadata'
      >;
    }
  | {
      mode: 'implementation_required';
      reason: string;
      files: string[];
    };
```

## API、インターフェース、契約変更

### Settings API
Test settings は既存 LLM settings とは分離する。Coverage gate は LLM provider credential ではなく、プロジェクトの品質方針であるため、`llm-settings.json` に混ぜない。

保存先は Project repo root 基準の quality settings file を第一候補にする。例:

- `nightworkers-quality.json`

この file は API key や credential を含まないため、チーム開発では commit 可能な project 設定として扱える。Project 固有に commit しない運用が必要な場合は、同じ schema を runtime settings directory に保存する override path を後続で追加できるようにする。

候補:

- `api/services/settings/test-quality-settings.ts`
- `api/modules/nightworkers/routes/repository-routes.ts`
- `GET /repositories/:id/settings/test-quality`
- `PUT /repositories/:id/settings/test-quality`

既存 Settings screen からは、Project を選択した状態で、他 section と同じ保存 UX で扱う。Test settings は global user setting ではなく Project-scoped setting である。API は既存 repository id から登録済み Project repo root を解決し、repo root 外の path を読み書きしない。

### Coverage runner
Vitest の text output を parse しない。`coverage/coverage-summary.json` を source of truth にする。

必要に応じて coverage command を次に寄せる。

```text
bun run test:coverage -- --coverage.reporter=json-summary --coverage.reporter=text
```

Template project / variant は `test:coverage` script を持つ必要がある。存在しない場合は、coverage autonomy の前提整備として追加する。初期実装では Vitest を前提にし、別 test runner の variant は対象外または別 ticket に分離する。

既存 HTML / lcov report は開発者向けに残してよいが、gate 判定は JSON summary に限定する。

Parser は `total.statements.pct` / `total.branches.pct` / `total.functions.pct` / `total.lines.pct` を必須 schema として assert する。unknown field は無視してよいが、必須 field 欠落、非数値、schema shape 不一致は warning 付き failure とし、silent pass にしない。

Coverage command は高コストな full measurement として扱う。初期実装では partial coverage を pass 判定に使わない。代わりに次の cadence にする。

1. loop 開始時に full coverage を 1 回測定する。
2. test role iteration 後、まず focused tests を実行する。
3. focused tests が失敗した場合は full coverage を再実行せず、test failure として loop action を決める。
4. minimal source guard が block した場合も full coverage を再実行しない。
5. focused tests が pass した場合だけ full coverage を再測定する。
6. `maxIterations`、token / cost warning、または stop threshold 到達時は full coverage を追加実行しない。

Phase 0 では `bun run test:coverage -- --coverage.reporter=json-summary` の wall-clock と token/cost estimate を baseline として記録し、必要なら warning / stop 閾値を調整する。閾値を決めずに Phase 6 へ進まない。

Coverage command は completion gate 側で別実行する。`verify` には初期実装では含めない。Focused tests が pass した場合だけ full coverage を再測定し、source guard block や focused test failure の場合は full coverage をスキップする。

### Todo / runtime gate
既存 `quality_gate_verify` Todo は維持する。Coverage gate が enabled のときは、既存 quality gate とは別の completion gate activity として coverage 判定を接続する。

完了条件は次の両方:

1. template project の `verify` が pass する。
2. enabled の coverage gate が pass する。

### Verify command requirements
Template project に `verify` がない場合は、coverage autonomy の前提整備として `verify` を追加する。要件は NightWorkers 本体の `scripts/verify.mjs` をモデルにする。

- `package.json` に `verify` script が存在する。
- `verify` は coverage gate を含めない。Coverage command は completion gate 側の別 activity として実行する。
- `verify` は project に存在する通常品質ゲートを順序付きで実行する。
  - 代表例: tracked artifact check、typecheck、lint、unit / regression tests、build。
  - template に存在しない script を無理に呼ばない。
- 各 step は label を持ち、duration を記録する。
- 失敗時は fail-fast し、失敗 step の stdout / stderr を report できる形にする。
- 複数 template / variant 間で task 名や有無が違う場合でも、`verify` の外部契約は `bun run verify` に統一する。
- `verify:base` は作らない。必要な target 分岐は `verify` 内部実装または将来対応に分離する。

初期リリースでは provisional completion を実装しない。coverage gate が enabled かつ未達の場合は完了扱いにせず、warning / follow-up / `context_decision` escalation のいずれかに進める。Deferred coverage debt を許す approval flow は後続計画に分離する。

## 実装段階

## Phase 0: Baseline と接続点確認

### 目的
現在の coverage 値、Settings 保存経路、runtime gate 接続点を確認し、実装中の判断を固定する。

### 作業
1. `bun run test:coverage -- --coverage.reporter=json-summary` が `coverage/coverage-summary.json` を生成できるか確認する。
2. `coverage-summary.json` の schema を fixture 化する。
3. Template project / variant ごとに `verify` と `test:coverage` の script inventory を採る。
4. `verify` または `test:coverage` がない variant は、coverage autonomy 本体より先に script 作成 task を切る。
5. Project repo root の `nightworkers-quality.json` を Test settings 保存先として使えるか確認する。
6. Project-scoped settings API が、登録済み Project repo root だけを読み書きする境界を確認する。
7. `evaluateTodoCompletionGate`、verification command 実行、task event 保存の接続点を確認する。
8. Role Routing の `test` / `quality_gate` が providerEndpoints に基づく実 target を表示していることを確認する。
9. Full coverage command の wall-clock baseline を採取する。
10. Provider pricing が取れるか確認し、取れない場合の token + wall-clock budget 判定を固定する。
11. token / cost / wall-clock warning threshold の初期値を採用するか、Phase 0 の実測で調整する。

### 成果物
- 現在 coverage baseline。
- coverage summary fixture。
- Template / variant ごとの `verify` と `test:coverage` inventory。
- Test settings storage は `nightworkers-quality.json` を第一候補とする方針。
- Project-scoped settings API の repo root 解決方針。
- coverage gate を接続する runtime boundary の決定。
- Full coverage command の実行時間 baseline。
- token / cost / wall-clock warning / stop threshold の初期値。

## Phase 1: Settings Test セクション

### 目的
ユーザーが coverage gate を有効化し、単一 minimum percent を選べるようにする。

### 作業
1. `TestQualitySettings` type を frontend / backend の共有可能な場所に追加する。
2. Test quality settings service を追加し、Project repo root の `nightworkers-quality.json` を読み書きする。
3. Settings route を追加する。
4. Settings section に `Test` を追加する。
5. Settings screen に `Coverage gate` toggle と `Minimum coverage` control を追加する。
6. UI preset は `70 / 80 / 85 / 90 / 95` を基本にする。
7. Advanced control として `Max iterations` を追加し、default は 5 とする。
8. 可能なら現在 baseline を表示し、「今の状態で通るか」を示す。ただし baseline 測定の実行は初期では手動 refresh でよい。

### 受け入れ基準
- Test section が Settings に表示される。
- coverage gate enabled / minimum percent が保存・再読込できる。
- max iterations が保存・再読込でき、未設定時は 5 になる。
- `nightworkers-quality.json` に credential が含まれない。
- Test settings API は Project-scoped であり、global settings として保存されない。
- 未登録 path や repo root 外 path への読み書きは拒否される。
- invalid percent は保存できない。
- invalid max iterations は保存できない。
- default は disabled + 80%。
- 既存 LLM provider / Role Routing settings が壊れない。

## Phase 2: Coverage summary parser と gate evaluator

### 目的
Vitest coverage summary を構造化し、全 metric に同じ threshold を適用する。

### 作業
1. `coverage-summary.json` parser を pure function として追加する。
2. `total.statements.pct` / `total.branches.pct` / `total.functions.pct` / `total.lines.pct` を読み取る。
3. missing / NaN / unexpected schema を failure として扱う。
4. `CoverageGateResult` を生成する。
5. fail 時は metric ごとの不足分を持つ。
6. file 単位 summary から target candidate を作る helper を追加する。
7. unknown field は許容するが、必須 field 欠落は warning 付き failure にする。

### 受け入れ基準
- all metrics 80% 以上なら pass。
- 1 metric でも 80% 未満なら fail。
- metric ごとの `actual`, `target`, `delta`, `passed` が保存可能。
- malformed summary は gate pass にならない。
- 必須 field 欠落や非数値 pct は silent pass にならない。
- LowCoverage file は soft candidate として生成されるが、単体では gate fail にしない。

## Phase 3: Quality gate 接続

### 目的
Coverage gate を Todo / run completion の実際の完了条件に接続する。

### 作業
1. Coverage gate enabled のとき、coverage command を実行する verification step を追加する。
2. 既存 quality gate との関係を定義する。
   - 初期対象の template project では `verify` script を既存 quality gate とする。
   - template variant に `verify` がない場合は、NightWorkers 本体の `scripts/verify.mjs` をモデルに `verify` を作成する。
   - 実装初期は既存 quality gate と coverage gate を別 step にし、coverage command は completion gate 側で実行する。
   - 将来 `verify` script 側へ統合するかは運用実績後に決める。
3. `evaluateTodoCompletionGate` の evidence に coverage gate result を追加する。
4. Timeline / final report に coverage result を表示できる形で task event を残す。
5. Gate fail 時に completion を pass させない。
6. `quality_gate` role の呼び出し trigger を deterministic gate evaluator の後に接続する。ただし単純な次 test target がある初回 fail では呼ばない。

### 受け入れ基準
- coverage gate disabled のとき既存 behavior が変わらない。
- enabled のとき coverage 未達は completion gate fail になる。
- fail report に未達 metric と不足分が出る。
- coverage command 失敗は「測定不能」として pass しない。
- `quality_gate` role は pass 時や単純継続時に呼ばれない。
- `verify` がない template variant では、coverage autonomy の前に `verify` 作成 task が必要になる。

## Phase 4: Minimal source guard

### 目的
Coverage autonomy loop を動かす前に、Test role iteration が behavior-changing source change を成功扱いにできない最低限の guard を入れる。

### 作業
1. Coverage loop で使う diff target classifier の最小版を追加する。
2. `tests/**`、fixtures、mocks、test utilities を test-only change として許可する。
3. Production source diff が出た場合は、明示 whitelist に一致しない限り coverage 達成扱いにせず `source_change_requires_review` として止める。
4. `NODE_ENV === 'test'`、`process.env.VITEST`、coverage ignore comment、validation 緩和、catch の握りつぶしを禁止 pattern として検出する。
5. Testability-only source change は、この段階では自動成功扱いにせず `testability_exception_requested` として記録する。
6. Release 4 の autonomy loop と同じ release train / feature flag で出す。Release 3 だけを user-facing に長期間残さない。

### 受け入れ基準
- Test role iteration で production source diff が出た場合、coverage loop は成功扱いにならない。
- 明示 whitelist にない production source diff は review required になる。
- 明示 whitelist に一致する production source diff も、coverage 達成ではなく testability exception request になる。
- 禁止 pattern は deterministic に検出される。
- Testability exception は理由と file を持つ pending 状態になる。
- Coverage autonomy loop はこの guard なしに有効化できない。
- Release 4 へ進む前提として、この guard が runtime で有効になっている。

## Phase 5: Coverage autonomy loop

### 目的
Coverage 未達時に、target 選択、test role への handoff、再測定、継続判定を runtime が制御する。

### 作業
1. `CoverageAutonomyState` を run state または task event から復元できる形にする。
2. Coverage target candidate を rank する。
   - changed file low coverage
   - large uncovered lines
   - branch gap
   - easy total gain
   - previous target stalled
3. test role へ渡す handoff を狭くする。
   - 対象 file
   - 未達 metric
   - current / target / delta
   - 既存 test file 候補
   - source change policy
4. Iteration 後に coverage を再測定する。
5. Coverage delta と test result を比較し、次 action を決める。
6. `iteration >= maxIterations` の場合は自動継続せず warning stop にする。
7. `previousResults` は直近 3 件だけを保持し、古い結果は summary に畳む。
8. focused tests が fail した iteration では full coverage を再実行しない。

### 受け入れ基準
- 未達時に次の test improvement target が生成される。
- 改善がある場合は loop 継続可能。
- 目標達成時だけ completion へ進む。
- test failure が増えた場合は coverage 改善だけで pass しない。
- max iterations に到達したら loop は止まる。
- Ticket / Phase 4 の minimal source guard が無効な場合、loop は開始しない。

## Phase 6: 停滞検出、micro context_compile、cost warning

### 目的
LLM が同じ問題で前進しない場合、無制限に token を使わせず、再計画または停止できるようにする。

### 作業
1. 停滞条件を実装する。
   - 2回連続で coverage 改善なし。
   - 同じ test failure が継続。
   - branches-only 未達で、1 iteration 後の branch delta が +0.1 percentage point 未満。
   - 変更量に対して gain が小さい。
   - token / cost が warning threshold を超える。
   - token / cost が stop threshold を超える。
   - wall-clock が warning / stop threshold を超える。
2. `CoverageLoopAction` を実装する。
3. `run_micro_context_compile` の payload を最小化する。
   - target file
   - metric gap
   - current / previous coverage
   - tried actions
   - latest failure excerpt
   - current diff summary
   - source change policy state
4. cost warning を user-visible event にする。
5. `ask_context_decision` は micro compile 後も前進しない場合、または停止・別 Role 昇格・後続 ticket 化の判断が必要な場合に限定する。

### 受け入れ基準
- 停滞時に micro `context_compile` が狭い goal で呼ばれる。
- token / cost warning が保存・表示される。
- warning: 50,000 total tokens または $0.50、stop: 200,000 total tokens または $2.00 の default が使われる。
- Local LLM / pricing 不明 endpoint では warning: 20 minutes、stop: 45 minutes の wall-clock threshold が hard stop に使われる。
- 無限 loop しない。
- `context_decision` は毎 iteration 呼ばれない。
- 目標値を黙って下げない。

## Phase 7: Source change policy と testability exception

### 目的
Phase 4 の最小 guard を拡張し、testability のための最小 source change を扱えるようにする。

### 作業
1. Phase 4 の classifier に testability-only classification を追加する。
2. `data-testid`、`aria-label`、semantic label、pure helper export、dependency injection、trace metadata を条件付き許可に分類する。
3. testability-only らしい diff は `pending_testability_review` にする。
4. behavior-changing diff は gate fail にし、成功扱いにしない。
5. Testability exception が必要な場合は small implementation Todo へ昇格する。
6. Review gate で禁止 pattern を検出する。
   - `NODE_ENV === 'test'`
   - `process.env.VITEST`
   - test-only fallback
   - validation 緩和
   - catch の握りつぶし

### 受け入れ基準
- Test role が production behavior を変えた iteration は pass しない。
- `data-testid` や `aria-label` 追加は exception として扱える。
- exception は理由、file、change kind が保存される。
- source change を含む iteration は review + verify まで coverage 達成扱いにしない。

## Phase 8: UI / Timeline / Report

### 目的
ユーザーが coverage autonomy の状態、停滞、コスト、警告、次アクション候補を理解できるようにする。

### 作業
1. Timeline に coverage gate result card を追加する。
2. Coverage loop iteration の event を表示する。
3. Warning 表示を追加する。
   - no improvement
   - high cost
   - source change blocked
   - testability exception requested
4. Final report に coverage result を含める。
5. Provisional completion / deferred coverage debt は初期実装では表示だけに留め、完了扱いにはしない。後続で許可する場合は、明示的な user decision または `context_decision` の結果を evidence として残す。

### 受け入れ基準
- coverage gate pass/fail が UI で分かる。
- 未達 metric と不足分が見える。
- 停滞理由と次 action が見える。
- 妥協が発生した場合、黙って成功扱いにならない。

## テスト方針

### Unit tests
- `TestQualitySettings` validation。
- coverage summary parser。
- gate evaluator。
- target candidate ranking。
- stagnation detector。
- cost/progress action selector。
- source diff classifier。
- max iteration stop。
- required coverage summary field validation。

### Service / route tests
- Test settings GET / PUT。
- Settings default migration。
- `nightworkers-quality.json` read / write。
- Credential-like keys are rejected from Test settings。
- Test settings route requires `projectId` and resolves a registered Project repo root。
- Test settings route rejects unregistered paths and repo root escapes。
- Coverage gate disabled の既存 behavior 維持。
- Coverage gate enabled の completion fail。
- malformed coverage summary の fail。

### Runtime integration tests
- Template variant missing `verify` creates or requires a verify setup task before coverage autonomy starts。
- Template variant missing `test:coverage` creates or requires a coverage setup task before coverage autonomy starts。
- Minimal source guard がない状態で autonomy loop を有効化できない。
- coverage 未達から test target が生成される。
- 2回停滞で micro `context_compile` action が選ばれる。
- branches-only 未達で branch delta が +0.1 percentage point 未満なら、1回の停滞で micro `context_compile` または target 切り替えに進む。
- max iterations 到達で warning stop になる。
- warning / stop token threshold 到達で適切に警告または停止する。
- wall-clock threshold 到達で local LLM loop が停止する。
- focused tests が失敗した場合は full coverage を再実行しない。
- `quality_gate` role は単純継続時に呼ばれず、stop / escalation 前に呼ばれる。
- micro compile 後も停滞したら `context_decision` または warning stop へ進む。
- behavior-changing source diff が gate fail になる。
- whitelist にない production source diff が `source_change_requires_review` になる。
- testability exception が implementation Todo に昇格する。

### UI tests
- Settings に Test section が表示される。
- coverage minimum を保存できる。
- max iterations を保存できる。
- coverage result card が pass/fail を表示する。
- warning card が no improvement / high cost / source change blocked を表示する。

### Manual verification
- `bun run test:coverage -- --coverage.reporter=json-summary`
- `bun run verify`
- coverage gate enabled で 80% 未達 fixture を使い fail を確認。
- coverage gate disabled で既存 verify flow が変わらないことを確認。

## 観測性と運用

### 保存する event
- `coverage_gate.started`
- `coverage_gate.completed`
- `coverage_loop.target_selected`
- `coverage_loop.iteration_completed`
- `coverage_loop.stalled`
- `coverage_loop.micro_context_compile_requested`
- `coverage_loop.cost_warning`
- `coverage_loop.source_change_blocked`
- `coverage_loop.testability_exception_requested`
- `coverage_loop.context_decision_requested`

### 保存する evidence
- coverage command
- summary path
- target percent
- metric results
- target file candidate
- previous / current delta
- token usage / estimated cost
- source diff classification
- loop action

## セキュリティ、プライバシー、コンプライアンス
- Coverage summary と diff metadata は local project evidence として扱う。
- Provider prompt に送る情報は target file、coverage gap、直近 failure、必要な抜粋に絞る。
- micro `context_compile` に raw secret、large logs、credential settings を入れない。
- Test settings に credential は含めない。
- Source change classifier は security-sensitive file の contract 緩和を pass させない。
- `nightworkers-quality.json` は project quality settings として扱い、LLM credential や personal runtime secrets を保存しない。

## 段階リリース計画

### Release 1: Manual gate
- Settings Test section。
- coverage parser。
- gate evaluator。
- Manual coverage command result の表示。

### Release 2: Completion gate
- Coverage gate enabled 時に completion gate へ接続。
- fail report と final report 連携。

### Release 3: Minimal source guard
- source diff classifier の最小版。
- behavior-changing source change の成功扱い禁止。
- testability exception request の pending 記録。
- Release 4 と同じ feature flag / release train で出し、guard-only の user-facing 期間を長くしない。

### Release 4: Autonomous loop
- target candidate。
- test role handoff。
- iteration / delta tracking。
- Release 3 の minimal source guard が有効であることを起動条件にする。

### Release 5: Stagnation and cost control
- micro `context_compile`。
- cost warning。
- `context_decision` escalation。

### Release 6: Source policy hardening
- source diff classifier の拡張。
- testability exception。
- review gate integration。

## 切り戻しと緩和策
- Settings の `coverageGateEnabled` を false にすれば gate は無効化できる。
- Coverage parser / UI は残しても、completion gate から外せるようにする。
- Autonomous loop は feature flag または settings flag で無効化する。
- Source policy が誤検出する場合は、warning-only mode に落として event 収集を続ける。
- `context_compile` / `context_decision` が unavailable の場合は、micro replan を skipped として記録し、deterministic stop に進む。

## リスク、前提、未解決事項

### リスク
1. Branch coverage が 80% に届かず、既存 repo で大きな test debt が露出する。
2. Coverage 改善のために LLM が behavior-changing source change を入れる。
3. Local LLM が target instruction を守れず、同じ file に無効な test を追加し続ける。
4. `context_compile` を使いすぎると token / latency が増える。
5. Coverage summary schema や Vitest reporter option の変更で parser が壊れる。
6. Static opportunity score を改善見込み percent と誤解し、target ranking が過信される。
7. Full coverage command を iteration ごとに実行し、実行時間とCIコストが膨らむ。
8. `quality_gate` role を呼びすぎて、coverage loop 自体の token cost が増える。
9. Project repo root の quality settings に credential や個人設定が混入する。

### 緩和策
1. Default は disabled + 80%。有効化時に現在 baseline を表示する。
2. Minimal source guard を autonomy loop より前に入れ、Test role iteration の source diff classifier と review gate を必須にする。
3. Stagnation detector と max iteration を入れる。
4. micro `context_compile` は停滞時だけ、payload を最小化する。
5. Parser は fixture と malformed schema test を持つ。
6. `staticOpportunityScore` は静的 ranking score として扱い、改善見込み percent として表示しない。
7. focused tests が pass した場合だけ full coverage を再測定する。
8. `quality_gate` role は単純継続時に呼ばず、stop / escalation / ambiguous fail に限定する。
9. Test settings schema は credential-like keys を拒否し、`nightworkers-quality.json` を project quality settings に限定する。

### 前提
- 初期 gate 対象は default Vitest unit tests。
- Coverage 判定は repo total metrics を hard gate とする。
- 初期実装では `branches` も hard gate に含める。ただし branches-only stagnation は warning / replan を早める。
- File 単位 LowCoverage は soft signal とする。
- Role Routing は model target 選択に限定し、coverage 判定責務を持たない。
- Provisional completion は初期実装に含めない。
- Test settings は LLM settings から分離し、Project repo root の `nightworkers-quality.json` を第一候補にする。
- Template project の代表 quality gate は `verify` に統一する。variant に `verify` がなければ作成する。
- Coverage command は completion gate 側で別実行し、初期実装では `verify` に含めない。
- Source diff classifier は whitelist-first とし、明示 whitelist にない production source diff は review required とする。Whitelist に一致する diff も自動成功ではなく testability exception request とする。

### 未解決事項
1. Phase 0 の実測後も default token / cost / wall-clock threshold を調整する必要があるか。
2. Source diff classifier の完全版を deterministic pattern 中心にするか、review rubric と併用するか。
3. Provisional completion を将来許す場合の UI と approval flow。
4. Partial coverage を将来採用できるか。初期実装では pass 判定に使わない。
5. Project quality settings を commit しない運用向けに runtime override path をいつ追加するか。

## マイルストーン

1. Settings + parser
   - Test section と coverage summary parser が動く。
2. Gate
   - coverage gate enabled 時に completion が coverage 未達で fail する。
3. Guard
   - Minimal source guard が behavior-changing source change を成功扱いにしない。
4. Loop
   - target candidate から test role へ handoff し、再測定できる。
5. Recovery
   - 停滞時に micro `context_compile` と cost warning が動く。
6. Hardened guard
   - Test role の behavior-changing source change が成功扱いにならない。
7. UX
   - Timeline / final report で coverage autonomy の状態が分かる。

## 着手前チェックリスト
- [ ] 現在 coverage baseline を採取した。
- [ ] `coverage-summary.json` fixture を確認した。
- [ ] Test settings の保存先を `nightworkers-quality.json` 第一候補として確認した。
- [ ] Coverage gate を接続する runtime boundary を決めた。
- [ ] Coverage gate disabled 時の既存 behavior 維持を確認するテストを用意した。
- [ ] Full coverage command の wall-clock baseline を採取した。
- [ ] token / cost / wall-clock warning / stop threshold を Phase 0 成果物として固定した。
- [ ] Source change policy の allowed / conditional / forbidden path を定義した。
- [ ] Source diff classifier が whitelist-first で、未許可 production source diff を review required、許可 production source diff を testability exception request にすることを確認した。
- [ ] `quality_gate` role の呼び出し trigger が deterministic selector と接続されている。
- [ ] `context_compile` と `context_decision` の呼び出し条件を deterministic action selector に閉じ込めた。
- [ ] UI で coverage 未達、停滞、cost warning、testability exception を表示する場所を決めた。

## 最初に切る実装 ticket

### Ticket 1: Test quality settings と UI
- Add `TestQualitySettings` type。
- Add settings storage / route using project `nightworkers-quality.json` as the primary storage。
- Reject credential-like keys from Test settings。
- Make Test settings route Project-scoped and reject repo root escapes。
- Add Settings Test section。
- Add unit / route / UI tests。

### Ticket 2: Coverage summary parser と gate evaluator
- Add parser for `coverage/coverage-summary.json`。
- Add all-metrics threshold evaluator。
- Add malformed summary tests。

### Ticket 3: Completion gate integration
- Connect coverage gate to runtime completion evidence。
- Keep disabled behavior unchanged。
- Add fail report tests。
- Ensure template variants expose `bun run verify`; add a NightWorkers-style fail-fast `verify` script when missing。
- Ensure template variants expose `bun run test:coverage`; add a Vitest coverage script when missing。

### Ticket 4: Minimal source guard
- Add test-only / production-source diff target classification。
- Block behavior-changing source changes from being treated as successful coverage iterations。
- Use whitelist-first policy: production source diff requires review unless explicitly allowed as testability-only。
- Detect `NODE_ENV === 'test'`, `process.env.VITEST`, coverage ignore comments, validation loosening, and swallowed errors。
- Add tests that the autonomy loop cannot run without this guard。
- Ticket 5 and later must not enable the loop unless this guard is active。

### Ticket 5: Coverage target candidates
- Build file-level soft candidates。
- Rank changed files and high-gain files。
- Use `staticOpportunityScore`, not predicted percent gain。
- Add unit tests for ranking。
- Depends on Ticket 4 guard being active in runtime configuration。

### Ticket 6: Autonomous loop action selector
- Add iteration state。
- Add stagnation detection。
- Add max iteration stop。
- Add branch-only early stagnation at +0.1 percentage point delta。
- Add token / cost warning and stop defaults。
- Add wall-clock warning and stop defaults for local LLM / pricing unknown endpoints。
- Keep only the latest 3 `CoverageGateResult` entries in loop state。
- Add cost/progress warning action。
- Add micro `context_compile` action without executing it every loop。
- Add `quality_gate` trigger rules before stop / escalation, not on simple continuation。

### Ticket 7: Source policy and testability exception
- Classify diff after test role iteration。
- Block behavior-changing source changes。
- Add testability exception request path。
- Add review / verify requirement before success.
