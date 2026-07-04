# Task Generation Refactor and Module Ontology Implementation Plan

## Purpose

タスク生成画面の Goal / Mission / TaskCandidate をリファクタリングし、直感的に分かりにくい TaskCandidate が生成される問題を解消する。

同時に、`coding-agent-module-ontology-implementation-plan.md` の module ontology と整合させ、候補生成時に `primaryModule` / `secondaryModules` / `confidence` / `reason` を扱えるようにする。

狙いは、`todolist を作る` のような機能本流 Goal から、分かりやすい本流 TaskCandidate を作り、カバレッジ・性能・i18n・design token のようなプロジェクト横断 Goal を、不要な独立タスクではなく制約・検証・優先度補正として扱えるようにすることである。

この計画は、タスク生成画面に DDD 用語を増やす計画ではない。ユーザーが覚える概念を増やさず、内部的に Goal interpretation と module routing を使って生成精度を上げる計画である。

## Review Summary

この計画は、次の問題を実装で解決するためのタスク生成リファクタリング計画である。

- 未実装の機能 Goal から、主作業だと分かりにくい候補が生成される。
- まだ本体機能がない段階で、品質改善・テスト追加・UI polish などの周辺候補が本流候補より目立つ。
- カバレッジや性能のような project-wide Goal が、機能本流候補と同じ種類の TaskCandidate として扱われる。
- Plan mode で決めるべき仕様・設計項目が、独立した細部タスクとして候補化される。

改善後は、未実装の `todolist を作る` Goal に対して、最初に次のような候補が出る状態を成功条件にする。

```text
todolist 機能の初期実装計画を作成する
```

この候補は直接実装命令ではなく、Plan mode で UI、データモデル、保存方式、完了状態、編集削除、検証方針を定義するための entrypoint である。

## Refactoring Scope

このリファクタリングの対象は、候補生成の意味論と表示・Task 化の接続である。

In scope:

- Goal interpretation の保存と表示。
- TaskCandidate kind の導入。
- project-wide Goal を制約として扱う生成 contract。
- module ontology index を候補生成入力へ渡す adapter。
- feature entrypoint を最優先にする選別・保存・表示。
- Plan mode handoff prompt の改善。
- todolist などの未実装 feature Goal を fixture 化した回帰テスト。

Out of scope:

- タスク生成画面全体の大規模 UI 再設計。
- Plan mode 自体の再設計。
- Agent runtime の boundary gate 強制実装。
- repository の module ディレクトリ再編成。
- Goal 登録時の LLM 呼び出し。

## User-Facing Success Criteria

ユーザー視点では、次を満たす必要がある。

1. `todolist を作る` のような Goal から、主作業だと一目で分かる候補が出る。
2. その候補は、細部を先に決め打ちせず、Plan mode で仕様を決める入口になっている。
3. 本体機能が存在しない間は、周辺の品質改善や UI polish が主候補より上に出ない。
4. カバレッジや性能 Goal は、本流候補の制約・検証条件として見える。
5. module ontology がない repository でも候補生成は止まらない。
6. module ontology がある repository では、候補詳細に primary / secondary module と confidence が見える。

## Candidate Quality Contract

TaskCandidate は、ユーザーが「これを Task 化すると何が始まるか」を一覧で判断できる名前と種類を持つ。

### Good examples

未実装 feature Goal:

```text
Goal: todolist を作る
Candidate kind: feature_entrypoint
Title: todolist 機能の初期実装計画を作成する
```

project-wide Goal を伴う feature Goal:

```text
Goal: todolist を作る
Project-wide Goal: カバレッジを80%以上に維持する
Candidate kind: feature_entrypoint
Title: todolist 機能の初期実装計画を作成する
Verification: todolist 実装後に coverage gate を維持することを含める
```

検証基盤が欠けている場合:

```text
Goal: カバレッジを80%以上に維持する
Candidate kind: constraint_enablement
Title: カバレッジ維持を確認できるテスト実行基盤を整備する
```

### Bad examples

未実装の `todolist` に対して、次は単独候補にしない。

```text
Todo一覧のフィルタ UI を改善する
Todo状態管理をリファクタリングする
Todo画面のE2Eテストを追加する
Todoの表示パフォーマンスを改善する
```

これらは、todolist 本体がまだ存在しない場合は Plan mode の設計項目、acceptance criteria、verification plan に押し戻す。

### Candidate title rule

`feature_entrypoint` の title は、次の形を基本にする。

```text
<機能ドメイン> 機能の初期実装計画を作成する
```

既存機能の follow-up の場合だけ、具体的な追加・改善候補名を許可する。

## Source Plan Alignment

`spec/docs/coding-agent-module-ontology-implementation-plan.md` から、次を前提として取り込む。

- `goal = module` と固定しない。
- 作業ごとに `primaryModule`, `secondaryModules`, `changeTypes`, `risk`, `confidence`, `reason` を明示する。
- module ontology は探索・編集・検証を制御する agent-facing contract である。
- keyword regex だけで goal classification を実装しない。
- low confidence は、強引な TaskCandidate 化ではなく調査・確認・Plan mode 側の未確定事項として扱う。
- project-wide な品質・性能 Goal は、機能本流を置き換えるのではなく検証計画・invariant・acceptance criteria に反映する。

Downstream bridge consideration:

- `spec/archive/task-generation-ontology-evidence-bridge-implementation-plan.md` は、この計画で保存した Task Generation metadata を coding-agent ontology context へ渡す後続計画である。
- この計画の Phase 3-5 を実装するときは、後続 bridge が読めるように `candidateKind`, `moduleRouting`, `constraintGoalIds`, `planModeOpenQuestions`, candidate id を欠落させない。
- ただし、この計画では evidence bridge や MCP context 連携を完了条件にしない。候補生成の意味論、保存、Task 化の metadata 維持までを責務とする。

## Current Problems

### Main Feature Build が分かりにくい

機能がまだ存在しない状態でも、`todolist を作る` という本流作業が、周辺改善のような曖昧な候補名や補助タスクとして出ることがある。

期待する候補は、まず次のような Plan mode entrypoint である。

```text
todolist 機能の初期実装計画を作成する
```

### 本流外の細部タスクが候補化される

UI の細かい操作、テスト追加、性能改善、状態管理改善などが、まだ本体機能が存在しない段階で独立候補として出ることがある。

これらは本来、TaskCandidate として並べるのではなく、Plan mode 内で決める仕様・検証・設計項目である。

### Goal の意味が単一すぎる

Goal を機能ドメインだけに固定すると、次のような Goal を表現できない。

- テストカバレッジを80%以上に維持する。
- 主要画面を0.2秒以内に表示する。
- i18n辞書の locale 間 key を一致させる。
- design token の逸脱を増やさない。

これらは特定ドメインに紐づかない場合があるため、Goal は複数種を持つ必要がある。

## Design Direction

### Goal は入力概念、Interpretation は内部概念

ユーザー向けの `Goal` は増やさない。登録画面では今のまま「Goal」を作る。

内部では Goal に interpretation を持たせる。

```ts
type GoalScope = 'feature_domain' | 'project_wide' | 'unknown';
type GoalIntent = 'build' | 'maintain_threshold' | 'improve_metric' | 'unknown';
type GoalClassificationSource = 'preset' | 'user_override' | 'heuristic' | 'llm' | 'unknown';

type GoalInterpretation = {
  scope: GoalScope;
  intent: GoalIntent;
  source: GoalClassificationSource;
  confidence: number;
  reason: string | null;
};
```

登録時に LLM は呼ばない。自由入力 Goal は `unknown` を許容する。プリセット Goal だけは `project_wide` として deterministic に初期値を付ける。

### Module Routing は生成時に行う

module ontology の `classify_goal` に相当する処理は、Goal 登録時ではなく、候補生成時に行う。

候補生成時は、次を LLM または deterministic candidate generation に渡す。

- active Goals
- GoalInterpretation の既存ヒント
- `.agent-ontology/modules.yaml` があれば module index
- module aliases / responsibilities / ownedPaths
- repository snapshot
- existing tasks / existing candidates
- project-wide Goals

生成時の LLM は、各 Goal を次のように再解釈する。

```ts
type GoalRouting = {
  goalId: string;
  scope: GoalScope;
  intent: GoalIntent;
  primaryModule: string | null;
  secondaryModules: string[];
  confidence: number;
  reason: string;
};
```

### TaskCandidate は候補の種類を持つ

TaskCandidate に、候補の役割を示す軽い属性を追加する。

```ts
type TaskCandidateKind =
  | 'feature_entrypoint'
  | 'feature_followup'
  | 'constraint_enablement'
  | 'constraint_verification'
  | 'investigation';

type ModuleRoutingMetadata = {
  primaryModule: string | null;
  secondaryModules: string[];
  boundaryNotes: string[];
  confidence: number;
  reason: string | null;
};
```

期待する扱い:

- `feature_entrypoint`: 未実装の機能ドメインを Plan mode に渡す本流候補。
- `feature_followup`: 本体が既に存在する場合の追加・改善候補。
- `constraint_enablement`: project-wide Goal を満たすための基盤が欠けている場合だけ出す候補。
- `constraint_verification`: 既に実装済みの本流に対する検証・測定候補。ただし単独候補化は慎重に扱う。
- `investigation`: module routing の confidence が低い場合の調査候補。

### Project-wide Goal は制約として効かせる

`project_wide` Goal は、原則として本流候補を押しのけて独立 TaskCandidate にならない。

例:

```text
Goal A: todolist を作る
Goal B: テストカバレッジを80%以上に維持する
```

この場合の候補は、まず次である。

```text
todolist 機能の初期実装計画を作成する
```

その候補の `acceptanceCriteria` / `verificationPlan` / `taskPrompt` に、Goal B を制約として含める。

ただし、coverage command が存在しない、性能計測ができない、i18n stack があるのに辞書検査がない、など本当に制約を確認できない場合だけ `constraint_enablement` 候補を出せる。

## Target Behavior

### Goal 登録

ユーザー自由入力では、追加分類を必須にしない。

登録時の挙動:

- title / goalText / active は現行通り保存する。
- preset 由来 Goal は `scope=project_wide`, `intent=maintain_threshold`, `source=preset` を付ける。
- user 由来 Goal は `scope=unknown`, `intent=unknown`, `source=unknown` で保存する。
- UI では必要なら小さな chip として `未判定` / `機能` / `品質基準` / `性能基準` を表示する。
- chip の手動変更は任意機能とし、初期実装では必須にしない。

### TaskCandidate 生成

生成時の挙動:

1. active Goals を `feature_domain` 候補、`project_wide` 制約、`unknown` に分ける。
2. `.agent-ontology/modules.yaml` があれば module index を読み、Goal routing 候補集合に使う。
3. LLM に、Goal ごとの scope / intent / primaryModule / secondaryModules / confidence を判定させる。
4. `feature_domain + build` の Goal が未実装なら、最優先で `feature_entrypoint` を1件出す。
5. 本流未実装の間は、supporting quality / refactor / UI polish を本流より上に出さない。
6. project-wide Goal は、本流候補の verification / acceptance criteria に反映する。
7. constraint を実行する基盤が欠ける場合だけ `constraint_enablement` を出す。
8. low confidence の module routing は、強引な実装候補ではなく `investigation` または Plan mode の未確定事項にする。

生成後の選別ルール:

1. `feature_entrypoint` は同じ feature Goal 内で最上位に並べる。
2. `feature_entrypoint` が存在する未実装 feature Goal では、`feature_followup` と `constraint_verification` を上位にしない。
3. `constraint_enablement` は project-wide Goal の確認基盤が欠ける場合だけ候補化する。
4. 同じ title の候補、既存 Task title と重なる候補、既存 uncreated candidate と重なる候補は保存しない。
5. LLM が bad examples 相当の候補を返した場合は、保存前に除外するか `planModeOpenQuestions` に退避する。

### Plan mode handoff

`feature_entrypoint` の `taskPrompt` は、直接実装命令ではなく Plan mode entrypoint にする。

必須内容:

- 機能ドメイン名。
- 現時点で未定義の仕様。
- Plan mode で決めるべき項目。
- project-wide Goal 由来の制約。
- module routing の primary / secondary modules。
- boundary crossing が予想される場合の注意。
- 検証方針。

例:

```text
todolist 機能をこのプロジェクトに追加するため、まず Plan mode で実装計画を作成してください。

この Goal は feature_domain build として扱います。
推定 primaryModule は todolist または emerging module です。既存 module ontology に対応する manifest がない場合は、実装計画内で module boundary を提案してください。

Plan mode では、UI、データモデル、永続化方式、完了状態、編集削除、検証方針を定義してください。
この段階では、本流外の品質改善や既存リファクタを主目的にしないでください。

Project-wide constraints:
- カバレッジを80%以上に維持する。
```

### Mission 生成

Mission は、feature_domain Goal の中間作業単位として扱う。

- Goal が `feature_domain + build` なら、Mission は本流実装を複数段階へ分けるために使う。
- Goal が `project_wide` なら、Mission 候補は原則作らない。
- project-wide Goal は、Mission decomposition の verificationGate / invariants / risk control に反映する。
- module ontology がある場合、Mission に primaryModule / secondaryModules を保存または planning result metadata に含める。

## Data Model Plan

### Phase 1 schema additions

`mission_goals` に interpretation を追加する。

```ts
goalScope: text('goal_scope').default('unknown').notNull()
goalIntent: text('goal_intent').default('unknown').notNull()
classificationSource: text('classification_source').default('unknown').notNull()
classificationConfidence: integer('classification_confidence').default(0).notNull()
classificationReason: text('classification_reason')
```

理由:

- 登録時に LLM を呼ばないため、未判定を安全に保存できる。
- preset Goal は deterministic に初期分類できる。
- 後続で user override や LLM 判定結果を保存できる。
- JSON blob だけにすると UI chip / query / test が曖昧になるため、最初の5項目は列として持つ。

`mission_task_candidates` には generation metadata を追加する。

```ts
candidateKind: text('candidate_kind').default('feature_followup').notNull()
moduleRoutingJson: text('module_routing_json', { mode: 'json' })
constraintGoalIdsJson: text('constraint_goal_ids_json', { mode: 'json' }).default('[]').notNull()
planModeOpenQuestionsJson: text('plan_mode_open_questions_json', { mode: 'json' }).default('[]').notNull()
```

理由:

- UI で本流候補と制約候補を区別できる。
- module routing を Task 化後の prompt / metadata に渡せる。
- project-wide Goal がどの候補に効いたか追跡できる。
- LLM が細部タスクとして出しがちな内容を、Plan mode の未確定事項として保持できる。

### Backward compatibility

既存 Goal:

- `goalScope=unknown`
- `goalIntent=unknown`
- `classificationSource=unknown`

既存 TaskCandidate:

- `candidateKind=feature_followup`
- `moduleRoutingJson=null`
- `constraintGoalIdsJson=[]`
- `planModeOpenQuestionsJson=[]`

既存候補の意味を migration で推測しない。過去データは互換表示に留める。

## Prompt Contract Changes

### Mission Task Candidate system prompt

追加するルール:

```text
Goal は必ずしも module ではありません。各 Goal を feature_domain / project_wide / unknown として解釈してください。
feature_domain + build の Goal が対象機能未実装の場合、最優先候補はその機能ドメインの初期実装計画を作成する feature_entrypoint にしてください。
対象機能が未実装の間は、品質改善、テスト追加、性能改善、リファクタ、UI polish を本流候補より優先しないでください。
project_wide Goal は、原則として独立 TaskCandidate ではなく、feature_entrypoint の acceptanceCriteria / verificationPlan / taskPrompt に反映してください。
project_wide Goal を確認する基盤が存在しない場合だけ constraint_enablement 候補を出せます。
module ontology が利用できる場合は、primaryModule / secondaryModules / confidence / reason を候補 metadata に含めてください。
low confidence の module routing は、断定的な実装候補にせず investigation または Plan mode の未確定事項として扱ってください。
本体機能が未実装の場合、UI詳細、データモデル詳細、永続化方式、完了状態、編集削除、検証方式は planModeOpenQuestions に入れ、独立 TaskCandidate にしないでください。
feature_entrypoint の title は `<機能ドメイン> 機能の初期実装計画を作成する` を基本形にしてください。
```

### Mission candidate prompt

追加するルール:

```text
Mission 候補は feature_domain Goal の中間目標です。
project_wide Goal だけを source にする Mission は原則作らないでください。
project_wide Goal は Mission の verificationGate、risk control、acceptance criteria の制約として扱ってください。
```

### Task creation prompt

Task 化時には、candidateKind と moduleRouting を prompt / task message metadata に含める。

`feature_entrypoint` は必ず Plan-first の文面にする。

## UI Plan

### Goal row

Goal 行に小さな chip を追加する。

- `未判定`
- `機能`
- `品質基準`
- `性能基準`
- `横断制約`

初期実装では chip は表示のみでよい。編集 UI は後続でよい。

### TaskCandidate row

候補行に kind chip を追加する。

- `本流`
- `追加`
- `制約整備`
- `検証`
- `調査`

本流候補は一覧上で分かりやすくする。

表示上の優先順:

1. `feature_entrypoint`
2. `investigation`
3. `feature_followup`
4. `constraint_enablement`
5. `constraint_verification`

### TaskCandidate detail

詳細 modal に次を追加する。

- Candidate kind。
- Primary module。
- Secondary modules。
- Routing confidence。
- Routing reason。
- Applied project-wide Goals。
- Plan mode で決めるべき未確定事項。

### Low confidence and missing ontology state

module ontology が存在しない、または routing confidence が低い場合:

- 候補生成を失敗扱いにしない。
- `primaryModule: emerging` または `null` として Plan mode に境界提案を任せる。
- UI では「未判定」や「調査」候補として表示する。

## Implementation Order Rationale

実装順は、先に保存 contract を作り、その後に生成 contract を変え、最後に UI と回帰テストを固める。

理由:

1. UI だけ先に変えると、候補の意味が旧 schema のまま残る。
2. prompt だけ先に変えると、LLM 出力を保存・表示できず検証できない。
3. module ontology adapter を必須にすると、ontology manifest がない repository の生成を壊す。
4. そのため、schema compatibility -> optional ontology adapter -> generation contract -> Plan mode handoff -> UI の順に進める。

## Implementation Phases

### Phase 0: Baseline

Goal:

現在のタスク生成画面と候補生成の挙動を固定する。

Tasks:

1. `todolist を作る` Goal の現行生成結果を fixture LLM output で再現できる形にする。
2. project-wide preset Goal を含む現行生成結果を fixture 化する。
3. 現行の候補生成 prompt / schema / UI tests を確認する。
4. 現在の悪い候補例を fixture に明示する。
5. 変更後の expected output を同じ fixture の別 expectation として書く。

Verification:

```bash
bunx vitest run tests/project-detail-screen.test.tsx tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts
```

Expected:

- 現行の Project Detail / TaskCandidate tests が通る。
- fixture に、現状の bad examples と改善後の expected examples が明示される。

Failure response:

- 既存 failure を先に切り分け、計画実装とは別 blocker として扱う。

### Phase 1: Schema and repository compatibility

Goal:

Goal interpretation と TaskCandidate kind / module routing metadata を保存できるようにする。

Likely files:

- `api/db/project-detail-schema.ts`
- `drizzle/migrations/*`
- `shared/schemas/project-detail.schema.ts`
- `api/modules/project-detail/project-detail.repository.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `shared/mission-goal-templates.ts`
- `tests/project-detail-backend.test.ts`

Tasks:

1. `mission_goals` に interpretation columns を追加する。
2. `mission_task_candidates` に candidate kind / module routing / constraint goal ids / Plan mode open questions を追加する。
3. schema parse / repository map を更新する。
4. preset Goal 作成時に project-wide 初期分類を入れる。
5. user Goal 作成時は unknown のまま保存する。

Verification:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/services.mission-task-candidates.test.ts
```

Expected:

- Goal CRUD が互換維持される。
- preset Goal だけ classification が入る。
- user Goal は unknown で保存される。
- 既存候補は互換 default で parse できる。
- `planModeOpenQuestions` が未指定でも空配列として扱われる。

Failure response:

- migration default と schema default の不一致を先に修正する。
- 過去データの推測 migration は入れない。

### Phase 2: Ontology adapter for task generation

Goal:

module ontology が存在する場合だけ、候補生成入力に module index を含める。

Likely files:

- `api/modules/project-detail/project-signal-snapshot.service.ts`
- `api/modules/project-detail/project-detail.service.ts`
- new `api/modules/project-detail/module-ontology-snapshot.ts`
- `tests/services.mission-task-candidates.test.ts`

Tasks:

1. repository root から `.agent-ontology/modules.yaml` を読み取る helper を追加する。
2. 存在しない場合は `moduleOntology: null` を返す。
3. 存在する場合は module id / label / aliases / manifest path digest 程度に絞って signal に含める。
4. helper は repository files を変更しない。
5. YAML parser を追加する場合は既存依存を確認し、なければ初期実装では JSON/YAML の最小 parser 方針を決める。

Verification:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts
```

Expected:

- `.agent-ontology/modules.yaml` が無い repo でも signal 生成が通る。
- fixture ontology がある repo では module index が signal に含まれる。
- signal が過大化しない。

Failure response:

- ontology 読み取りが不安定なら Phase 2 は null fallback に留め、生成 prompt 側だけ先に進める。

### Phase 3: Generation contract update

Goal:

TaskCandidate 生成が feature entrypoint / project-wide constraint / module routing を区別して返す。

Likely files:

- `shared/schemas/project-detail.schema.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `tests/services.mission-task-candidates.test.ts`
- `tests/project-detail-backend.test.ts`

Tasks:

1. `missionTaskCandidatesResultSchema` に `candidateKind`, `moduleRouting`, `constraintGoalIds`, `planModeOpenQuestions` を追加する。
2. structured output schema test を更新する。
3. system prompt / user prompt に Goal interpretation と module ontology rules を追加する。
4. candidate selection logic で本流候補を優先し、未実装 feature の周辺候補を上位にしない。
5. project-wide Goal がある場合は本流候補の acceptance / verification に反映する。
6. constraint_enablement 候補は、検証基盤が欠けている場合だけ許可する。
7. bad examples 相当の候補は保存前に除外し、必要なら `planModeOpenQuestions` に退避する。
8. `feature_entrypoint` title の基本形を fixture で固定する。

Verification:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts
```

Expected:

- structured output schema が新フィールドを要求する。
- `todolist を作る` fixture で `feature_entrypoint` 候補が生成・保存される。
- `feature_entrypoint` の title が `todolist 機能の初期実装計画を作成する` になる。
- coverage/performance preset がある場合、本流候補の verification に反映される。
- 本体未実装の fixture で quality/refactor/UI polish が本流より優先されない。
- bad examples が candidate list に保存されない。

Failure response:

- LLM 出力の互換が壊れる場合は、service 側で一時的に old schema normalization を入れる。ただし prompt contract は新形へ寄せる。

### Phase 4: Mission generation alignment

Goal:

Mission candidate generation が project-wide Goal だけから Mission を作らないようにする。

Likely files:

- `shared/schemas/mission-planner.schema.ts`
- `api/modules/mission-planner/mission-planner.prompts.ts`
- `api/modules/mission-planner/mission-planner.service.ts`
- `tests/mission-planner.test.ts`

Tasks:

1. Mission candidate prompt に Goal interpretation rules を追加する。
2. project-wide Goal は source constraint として扱う。
3. feature_domain Goal が無い場合は Mission 候補生成を validation error または no-op response にする方針を決める。
4. Mission decomposition planning result に module routing metadata を含めるか、planning result metadata として保存する。
5. verificationGate に project-wide constraints を反映する。

Verification:

```bash
bunx vitest run tests/mission-planner.test.ts
```

Expected:

- feature Goal から Mission 候補を作れる。
- project-wide Goal だけでは本流 Mission を捏造しない。
- review_pending proposal には verificationGate が残る。

Failure response:

- schema 拡張が大きすぎる場合は、Phase 4 では prompt と tests に限定し、metadata persistence は後続へ分ける。

### Phase 5: Plan mode handoff update

Goal:

`feature_entrypoint` を Task 化したとき、Plan mode が機能ドメインの仕様定義から開始できる。

Likely files:

- `api/modules/project-detail/project-detail.repository.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `api/modules/mission-planner/mission-planner.service.ts`
- `tests/project-detail-backend.test.ts`
- `tests/mission-planner.test.ts`

Tasks:

1. `createTaskFromMissionCandidate` の objective 生成に candidateKind を反映する。
2. `feature_entrypoint` は Plan-first prompt にする。
3. module routing と applied project-wide Goal を task message metadata に保存する。
4. `constraint_enablement` は通常の改善タスクとして扱うが、本流候補より優先されないことを保つ。
5. MissionTaskProposal 由来 Task 化にも module routing metadata を渡す。
6. `planModeOpenQuestions` を objective に含め、Plan mode 側で設計すべき項目として扱わせる。

Verification:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/mission-planner.test.ts
```

Expected:

- Task objective に feature domain / Plan mode open questions / constraints が入る。
- Task message metadata に module routing が保存される。
- 既存 Task 化フローが壊れない。
- bad examples 相当の内容が、Task title ではなく Plan mode open questions として渡る。

Failure response:

- metadata の downstream 消費が未整備でも、保存だけは先に行う。UI 利用は Phase 6 に回す。

### Phase 6: UI update

Goal:

ユーザーが分類を覚えなくても、本流候補・制約候補・module routing を判断できる。

Likely files:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/project-detail-screen.test.tsx`

Tasks:

1. Goal row に classification chip を表示する。
2. TaskCandidate row に candidate kind chip を表示する。
3. TaskCandidate detail modal に module routing と applied project-wide Goals を表示する。
4. `feature_entrypoint` を一覧上で最も分かりやすくする。
5. raw enum を表示しないよう辞書 key を追加する。
6. `planModeOpenQuestions` を詳細 modal に表示する。

Verification:

```bash
bunx vitest run tests/project-detail-screen.test.tsx
```

Expected:

- tree table が Goal / Mission / TaskCandidate 階層を維持する。
- 本流候補 chip が表示される。
- project-wide Goal が applied constraint として詳細に出る。
- Plan mode で決めるべき未確定事項が詳細に出る。
- 既存の proposal/candidate 統合表示が崩れない。

Failure response:

- 表示密度が上がりすぎる場合は row は chip だけにし、詳細 modal に情報を逃がす。

### Phase 7: Fixture and regression tests

Goal:

ユーザーが指摘した `todolist` 問題を回帰テスト化する。

Likely files:

- `tests/project-detail-backend.test.ts`
- `tests/services.mission-task-candidates.test.ts`
- `tests/project-detail-screen.test.tsx`
- `tests/mission-planner.test.ts`

Fixtures:

1. `todolist を作る` + empty/starter repo。
2. `todolist を作る` + coverage project-wide Goal。
3. project-wide Goal only。
4. module ontology present with matching module alias。
5. module ontology absent.

Verification:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx tests/mission-planner.test.ts
```

Expected:

- empty/starter repo では `feature_entrypoint` が最上位候補になる。
- `feature_entrypoint` の title が直感的な基本形になる。
- project-wide Goal は本流候補の constraints へ反映される。
- project-wide Goal only では本流機能 Mission を捏造しない。
- ontology present の場合 routing metadata が入る。
- ontology absent の場合でも生成は fallback する。
- bad examples は候補 list ではなく Plan mode open questions または除外として扱われる。

Failure response:

- 失敗が LLM 出力依存なら fixture LLM output を固定し、service 側の選別・保存・表示を先に検証する。

### Phase 8: Focused verification and full gate

Goal:

実装後の代表 verification を通す。

Commands:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx tests/mission-planner.test.ts
bun run build:web
bun run verify
```

Expected:

- focused tests が通る。
- web build が通る。
- repo verification が通る。

Failure response:

- focused tests failure は実装修正対象。
- `build:web` failure は UI/schema contract mismatch を優先確認する。
- `bun run verify` が既存 unrelated failure で止まる場合は、focused tests と build result を報告し、unrelated blocker を明記する。

## Non-Goals

- Goal 登録時に LLM を呼ぶこと。
- ユーザーに Goal type の必須選択を求めること。
- Goal を module と完全一致させること。
- project-wide Goal を常に独立 TaskCandidate にすること。
- ontology manifest が無い repository で生成を失敗させること。
- 初期実装で strict boundary gate をタスク生成画面に強制すること。
- source files を module ディレクトリへ移動すること。

## Completion Criteria

この実装は、次を満たしたら完了とする。

- Goal interpretation が保存・表示できる。
- preset Goal が project-wide constraint として扱われる。
- user Goal は登録時に unknown のまま保存できる。
- 候補生成時に Goal routing / module routing が行われる。
- `todolist を作る` のような未実装 feature Goal で、分かりやすい `feature_entrypoint` 候補が最優先される。
- `feature_entrypoint` の候補 title が `<機能ドメイン> 機能の初期実装計画を作成する` の基本形に揃う。
- project-wide Goal が本流候補の acceptance / verification / prompt に反映される。
- 本流未実装時に、本流外の quality/refactor/UI polish 候補が本流より優先されない。
- 本流未実装時の細部作業は、独立 TaskCandidate ではなく Plan mode open questions に退避される。
- Task 化後の Plan mode prompt に feature domain、未確定事項、constraints、module routing が含まれる。
- focused tests と web build が通る。
- 可能なら `bun run verify` が通る。
