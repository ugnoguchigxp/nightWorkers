# Mission Decomposition Concept

## 目的

NightWorkers の `Mission Planner` が、ユーザーの大きなゴールを実行可能な作業構造へ分解し、その分解結果を評価して、十分に質の高いものだけをユーザーのレビュー待ちにするための考え方を定義する。

この文書では、その分解機構を `Mission Decomposition` と呼ぶ。

Mission Decomposition は、PDCA 全体や自己改善ループ全体ではない。ここで扱うのは、ユーザーが掲げたゴールを、Mission、Objective、Work Package、Task、Verification Gate、Replanning Unit に落とし、評価を通過した planning result だけを `review_pending` にするところまでである。

この文書は実装計画ではない。次に Mission Planner、Mission data model、TaskGraph schema、decomposition prompt、PlanEvaluation、UI、approval flow を設計するためのコンセプト境界を固定する。

## 位置づけ

Mission Pilot は、NightWorkers 全体を操縦する上位レイヤーである。

Mission Planner は、Mission Pilot の下位で、Mission の分解、タスク候補生成、分解結果の評価、低品質案の除外、ユーザーへ提示する review-ready plan の作成を担当する。

Mission Decomposition は、Mission Planner の中核機能である。

```text
User Goal
  -> Mission Decomposition
  -> Mission
  -> Objectives
  -> Work Packages
  -> Tasks
  -> Verification Gates
  -> Replanning Units
  -> PlanEvaluation
  -> review_pending planning result
```

後続で、`review_pending` になった planning result は、ユーザー確認後に Plan mode、Implementation Queue、Worker、Review、Evaluation に接続される。

ただし、この文書では後続の PDCA や継続改善ループの詳細には踏み込まない。

## 背景

ユーザーが NightWorkers に渡したいゴールは、最初から実装 task になっているとは限らない。

例:

- NightWorkers をより良いコーディングエージェントにしてください。
- Plan mode を使いやすくしてください。
- このプロダクトを MVP まで持っていってください。
- レビュー品質を上げてください。
- queue 実行を安定させてください。

これらをそのまま Worker に渡すと、作業範囲が広すぎる。何をもって完了とするか、どこで止めるか、失敗時にどこへ戻るかが曖昧になる。

Mission Decomposition は、この曖昧な goal を、実装、評価、再計画が可能な構造へ変換し、評価に通ったものだけをユーザーがレビューできる状態にするためのレイヤーである。

## 基本方針

### 1. Goal と Task を直接つながない

ユーザーの goal を、いきなり task にしない。

悪い例:

```text
Goal: NightWorkers をより良いコーディングエージェントにする
Task: NightWorkers を改善する
```

この task は大きすぎて、実装範囲も検証方法も分からない。

良い分解:

```text
Goal
  -> Mission
  -> Objective
  -> Work Package
  -> Task
```

間に階層を置くことで、目的、完了条件、設計単位、実装単位を分離する。

### 2. 分解は作業を増やすためではない

Mission Decomposition の目的は、作業を大量に作ることではない。

目的は次の3つである。

1. 実行できる粒度にする。
2. 評価できる粒度にする。
3. 失敗時に再計画できる粒度にする。

作業が増えすぎる場合は、分解に失敗している可能性がある。

### 3. Objective は完了条件である

Objective は、作業カテゴリではない。

Objective は「何が満たされれば Mission が進んだと言えるか」を表す。

悪い Objective:

- UI。
- DB。
- API。
- テスト。

良い Objective:

- ユーザーが Mission の目的と非目標を確認できる。
- Mission を TaskGraph に分解できる。
- Task ごとに Plan mode が必要か判断できる。
- 承認済み task を queue に流せる。
- Run 結果から Mission progress を更新できる。

### 4. Work Package は Plan mode に渡せる単位

Work Package は、複数 task を束ねる設計単位である。

Work Package は Feature Plan を作れる程度にまとまっている必要がある。

例:

- Mission data model。
- Task decomposition engine。
- Mission UI。
- Queue integration。
- Evaluation summary。

Work Package は、まだ実装 task ではない。

### 5. Task は Worker が実行できる単位

Task は、変更対象、完了条件、検証方法が分かる粒度にする。

良い task:

- `Mission` schema を追加する。
- Mission 作成 API を追加する。
- TaskGraph draft 生成 prompt を追加する。
- Mission detail UI に Objective list を表示する。
- MissionTask と既存 Task を link する。

悪い task:

- Mission Pilot を作る。
- 自走できるようにする。
- 評価を改善する。
- UI を全部作る。

### 6. Verification Gate は分解の一部

Verification Gate は最後に付け足すものではない。

各階層に、次へ進める条件を持たせる。

- Mission gate: Objective が十分に定義されている。
- Objective gate: 完了条件が観測可能である。
- Work Package gate: Feature Plan にできる単位である。
- Task gate: Worker が実行でき、検証方法がある。
- Replanning gate: 失敗時に戻る範囲が分かる。

### 7. Replanning Unit を先に切る

再計画は、失敗してから慌てて考えない。

Mission Decomposition は、どこで失敗したらどこまで戻るかを先に切っておく。

例:

- data model の前提が崩れたら、Data Model work package に戻る。
- UI 前提が変わったら、Blueprint work package に戻る。
- queue 実行で詰まったら、Queue integration work package に戻る。
- evaluation が不正なら、Evaluation work package に戻る。

Replanning Unit がないと、失敗時に全体をやり直すか、場当たり修正になる。

### 8. 評価前の draft をユーザーに出さない

Mission Planner は、分解しただけの raw draft をそのままユーザーに見せない。

ユーザーに見せるのは、PlanEvaluation を通過した planning result だけである。

品質が不足している場合は、Mission Planner が次を行う。

- clarification question を作る。
- Work Package を分割し直す。
- Task を merge / split / reorder する。
- Verification Gate を追加する。
- approvalRequired 判定を付ける。
- blocked として理由を保存する。

ユーザーのレビュー待ちに置く条件:

- Mission と Objective が goal に合っている。
- Work Package と Task の粒度が妥当である。
- Task に Verification Gate がある。
- high-risk task が approval required になっている。
- Replanning Unit がある。
- Plan mode に渡すべき Work Package が識別されている。
- PlanEvaluation の verdict が `review_ready` またはそれに相当する状態である。

## 分解階層

### User Goal

ユーザーが自然言語で与える大きな目的。

Goal は曖昧でよい。曖昧さを解消するのは Mission Decomposition の仕事である。

例:

```text
NightWorkers をより良いコーディングエージェントにしてください。
```

### Mission

Mission は、Goal を NightWorkers が扱える目的単位にしたもの。

Mission は、成果の方向を一文で表す。

例:

```text
NightWorkers が、広いユーザーゴールを実行可能な task graph に分解できるようにする。
```

Mission には、実装手段を詰め込みすぎない。

### Objective

Objective は、Mission の達成条件である。

例:

- ユーザーゴールから Mission draft を生成できる。
- Mission に Objective と Non-goals を持たせられる。
- Mission を Work Package に分解できる。
- Work Package を Task に分解できる。
- Task に Verification Gate を紐づけられる。
- 失敗時に Replanning Unit を特定できる。

Objective は、pass / fail または satisfied / unsatisfied を判断できる必要がある。

### Work Package

Work Package は、Plan mode に渡せる設計単位である。

例:

- Mission schema。
- Decomposition prompt。
- TaskGraph storage。
- Mission UI。
- Queue linking。
- Replanning model。

Work Package は、複数 task を含んでよい。ただし、1つの Feature Plan に収まるまとまりにする。

### Task

Task は、Worker が実行できる単位である。

Task は次を持つ。

- title。
- purpose。
- scope。
- non-goals。
- target files or modules。
- acceptance criteria。
- verification gate。
- dependency。
- risk。

Task は、1 run で完了できる程度にする。ただし、細かすぎて queue 管理の負担が大きくなる場合は Work Package 内でまとめ直す。

### Verification Gate

Verification Gate は、次に進めるかを判断する確認条件である。

Gate は task にだけ付くものではない。Mission、Objective、Work Package にも gate がある。

例:

- typecheck が通る。
- route test が通る。
- UI render test が通る。
- prompt snapshot が期待語彙を含む。
- legacy text audit が通る。
- generated TaskGraph が cyclic ではない。

### Replanning Unit

Replanning Unit は、失敗時に組み直す範囲である。

Work Package と一致することが多いが、必ずしも同じではない。

例:

- Mission objective の再定義。
- Work Package の分割し直し。
- Task 順序の入れ替え。
- 特定 task の scope 縮小。
- 人間確認への戻し。

## 分解時に見る軸

Mission Decomposition は、次の軸で goal を分解する。

### Domain Axis

どの機能領域か。

例:

- Plan mode。
- Mission Pilot。
- Queue。
- Review。
- ContextStill integration。
- UI。
- Settings。

### Artifact Axis

どの成果物が必要か。

例:

- Concept document。
- Feature Plan。
- Data Model。
- API contract。
- UI Blueprint。
- Test suite。
- Runtime evidence。

### Risk Axis

どの作業が危険か。

例:

- schema / migration。
- public API。
- queue execution。
- provider routing。
- self-improvement。
- destructive operation。

### Dependency Axis

何が先に必要か。

例:

- schema がないと UI を作れない。
- route がないと UI action をつなげない。
- evaluation model がないと self-improvement を判断できない。

### Verification Axis

何で完了を確認するか。

例:

- unit test。
- route test。
- render test。
- typecheck。
- build。
- repo-native verify。
- manual confirmation。

### Human Decision Axis

人間承認が必要か。

例:

- scope change。
- high-risk implementation。
- self-improvement。
- destructive operation。
- large refactor。

## Task 粒度の判断

Task は次の条件を満たすと良い。

1. 変更または確認対象が明確。
2. 完了条件が観測可能。
3. 検証 gate がある。
4. 依存関係が説明できる。
5. 失敗時に戻る Replanning Unit がある。
6. 1 run で完了できる見込みがある。
7. Review が意味を持つ diff になる。

Task が大きすぎる兆候:

- title が抽象的。
- 複数の domain をまたぐ。
- verification が `bun run verify` だけ。
- 失敗時にどこへ戻るか分からない。
- Plan mode の Feature Plan が長くなりすぎる。

Task が細かすぎる兆候:

- 1行変更だけの task が大量にできる。
- dependency だけが増える。
- queue 管理の方が実装より重い。
- review しても意味のある判断ができない。

## Decomposition Output

Mission Decomposition の出力は、最低限この形にする。

```ts
type MissionDecomposition = {
  status:
    | 'draft'
    | 'evaluating'
    | 'needs_revision'
    | 'blocked'
    | 'review_pending';
  mission: {
    title: string;
    goal: string;
    nonGoals: string[];
  };
  objectives: Array<{
    title: string;
    completionCriteria: string[];
  }>;
  workPackages: Array<{
    title: string;
    purpose: string;
    relatedObjectives: string[];
    suggestedPlanMode: boolean;
    risk: 'low' | 'medium' | 'high';
  }>;
  tasks: Array<{
    title: string;
    purpose: string;
    workPackage: string;
    dependencies: string[];
    verificationGate: string[];
    approvalRequired: boolean;
  }>;
  replanningUnits: Array<{
    trigger: string;
    scope: string;
    action: 'split' | 'merge' | 'reorder' | 'ask_human' | 'pause';
  }>;
  evaluationSummary?: {
    verdict: 'review_ready' | 'needs_clarification' | 'needs_redecomposition' | 'blocked';
    confidence: 'low' | 'medium' | 'high';
  };
};
```

これは最終 schema ではない。Mission Decomposition が何を出すべきかを示す概念 contract である。

## 例

### User Goal

```text
NightWorkers をより良いコーディングエージェントにしてください。
```

### Mission

```text
NightWorkers が、広いユーザーゴールを実行可能な task graph に分解し、各 task を設計・実行・検証できる入口を作る。
```

### Objectives

- Mission draft を作れる。
- Objective と Non-goals を確認できる。
- Work Package を生成できる。
- TaskGraph を生成できる。
- Task に Verification Gate を紐づけられる。
- 高リスク task を approval 待ちにできる。

### Work Packages

- Mission data model。
- Mission decomposition prompt。
- TaskGraph generation。
- Mission UI。
- Approval policy。
- Queue linking。

### Tasks

- `Mission` / `MissionObjective` / `MissionTask` の型を追加する。
- Mission draft 生成 prompt を追加する。
- TaskGraph JSON schema を追加する。
- Mission detail UI に objective list を表示する。
- approval required task を queue 投入前に止める。

### Verification Gates

- schema tests。
- prompt tests。
- route tests。
- UI render tests。
- typecheck。
- focused decomposition fixture test。

### Replanning Units

- Objective が曖昧なら Mission draft に戻る。
- TaskGraph が循環したら decomposition prompt に戻る。
- Task が大きすぎたら Work Package を分割する。
- Verification Gate が作れない task は human question に戻す。

## Mission Planner の責務

Mission Planner は、Mission Decomposition を実行する主体である。

Mission Planner が担当すること:

- ユーザー goal から Mission draft を作る。
- Mission を Objectives に分ける。
- Objectives を Work Packages に分ける。
- Work Packages から Task candidates を作る。
- Task candidates に Verification Gate、risk、approvalRequired、Replanning Unit を付ける。
- Mission Decomposition Evaluation を実行する。
- 低品質な candidate をユーザーに出さず、修正または blocked にする。
- 十分に質の高い planning result だけを `review_pending` にする。

Mission Planner が担当しないこと:

- queue に流すこと。
- Worker を実行すること。
- 実装結果を review すること。
- Mission 全体の運航判断をすること。
- ユーザー承認なしに high-risk task を実行すること。

## Mission Pilot との関係

Mission Pilot は、Mission Planner が作成し評価した planning result を受け取る。

Mission Pilot が見るもの:

- `review_pending` の planning result。
- PlanEvaluation / Mission Decomposition Evaluation。
- approvalRequired task。
- blocked reason。
- suggested next action。

Mission Pilot が決めること:

- ユーザーにレビューを求める。
- Mission Planner に再分解を依頼する。
- Plan mode に Work Package を渡す。
- 承認済み task を queue に流す。
- Mission を pause する。

Mission Pilot は、task candidates を直接考案しない。Mission Pilot は、PlanEvaluation を自分で捏造して通過扱いにしない。

Mission Decomposition は queue に直接流さない。queue に流すかどうかは、Mission Pilot の approval / orchestration の責務である。

## ProjectEvaluation との関係

NightWorkers には既に ProjectEvaluation がある。

ProjectEvaluation は、repository 全体を対象に、concept value、architecture quality、extensibility、UI/UX、operability、security、maintainability、market competitiveness などの軸で評価する。

Mission Decomposition で必要になる評価は、ProjectEvaluation と似ているが、評価対象が違う。

```text
ProjectEvaluation
  -> repository / product 全体を評価する

Mission Decomposition Evaluation
  -> goal から作られた Mission / Objective / Work Package / TaskGraph の妥当性を評価する
```

ProjectEvaluation は、プロジェクト全体の健康診断である。

Mission Decomposition Evaluation は、これから走らせる計画の flight check である。

### 再利用できる考え方

ProjectEvaluation から再利用できるもの:

- evidence bundle を作ってから評価すること。
- 評価軸を固定し、LLM の自由採点にしないこと。
- score、confidence、concerns、next evidence を分けること。
- 改善候補を task 化できる粒度で出すこと。
- 評価 activity を保存し、途中経過を見えるようにすること。

そのまま再利用しないもの:

- project 全体向けの8軸評価。
- market competitiveness のような product-level 評価。
- repository bundle 全体を主入力にする評価方式。

Mission Decomposition では、評価対象を decomposition output に限定する。

## Mission Decomposition Evaluation

Mission Decomposition の出力は、すぐ実装や queue に流さず、まず評価できるようにする。

評価対象:

- Mission。
- Objectives。
- Work Packages。
- Tasks。
- Verification Gates。
- Replanning Units。
- approvalRequired 判定。

評価軸:

- `goal_alignment`: ユーザーの goal と Mission / Objective がずれていないか。
- `decomposition_quality`: Work Package と Task の粒度が適切か。
- `dependency_soundness`: 依存順が成立しているか。
- `verification_readiness`: 各 task に確認可能な gate があるか。
- `risk_control`: high-risk task が approval required になっているか。
- `replanning_readiness`: 失敗時に戻る範囲が決まっているか。
- `plan_mode_fit`: Plan mode に渡すべき Work Package が適切に選ばれているか。

概念 contract:

```ts
type MissionDecompositionEvaluation = {
  decompositionId: string;
  verdict:
    | 'review_ready'
    | 'needs_clarification'
    | 'needs_redecomposition'
    | 'needs_human_approval'
    | 'blocked';
  confidence: 'low' | 'medium' | 'high';
  dimensions: Array<{
    key:
      | 'goal_alignment'
      | 'decomposition_quality'
      | 'dependency_soundness'
      | 'verification_readiness'
      | 'risk_control'
      | 'replanning_readiness'
      | 'plan_mode_fit';
    status: 'pass' | 'warning' | 'fail';
    rationale: string;
    suggestedCorrection?: string;
  }>;
  courseCorrections: Array<{
    target:
      | 'mission'
      | 'objective'
      | 'work_package'
      | 'task'
      | 'verification_gate'
      | 'replanning_unit';
    action: 'clarify' | 'split' | 'merge' | 'reorder' | 'add_gate' | 'mark_approval_required' | 'pause';
    reason: string;
  }>;
};
```

この評価は、実装後の PDCA 評価ではない。実装前に、分解結果が実行可能かを確認するための評価である。

## 軌道修正

Mission Decomposition Evaluation の結果は、次の action に変換する。

### `review_ready`

分解結果を `review_pending` にし、ユーザーがレビューできる状態にする。

Mission Pilot は、この状態になった planning result だけを、ユーザー確認、Plan mode handoff、approval、queue orchestration の対象にする。

### `needs_clarification`

ユーザーに質問する。

例:

- 成功条件が曖昧。
- 非目標が不足している。
- risk policy が分からない。

### `needs_redecomposition`

Mission Decomposition をやり直す。

例:

- Task が大きすぎる。
- Task が細かすぎる。
- Work Package の境界が悪い。
- 依存順が成立していない。

### `needs_human_approval`

分解自体は成立しているが、実行には承認が必要。

例:

- schema / migration。
- destructive operation。
- self-improvement。
- public API change。

### `blocked`

現時点では分解または実行に進めない。

例:

- repository 状態が読めない。
- required context が不足している。
- goal が矛盾している。
- verification gate を定義できない。

軌道修正は「実装中に迷ったら考えるもの」ではなく、分解結果をユーザーに見せる前、または queue に流す前の gate として扱う。

## ContextStill との関係

Mission Decomposition は、必要に応じて ContextStill を使う。

使う場面:

- 分解前に repo convention や過去の failure pattern を確認する。
- high-risk domain の task を切る前に guardrail を取得する。
- task 粒度が妥当か decision input にする。
- 分解結果の compile usefulness を `compile_eval` で記録する。

ContextStill は、分解の source of truth ではない。source of truth は NightWorkers の Mission / TaskGraph / Task / Run / Artifact である。

## Non-goals

Mission Decomposition では、次を扱わない。

- PDCA サイクル全体。
- 改善案の実装前評価。
- 実装後評価。
- 自己改善候補の learning / registration。
- Mission Pilot に task generation / evaluation 責務を持たせること。
- 評価前の raw draft や低品質 plan をユーザーのレビュー待ちに出すこと。
- PlanEvaluation / Mission Decomposition Evaluation なしで `review_pending` にすること。
- Worker 実装の詳細。
- Queue processor の実行制御。
- Review rubrics の設計。
- Mission UI の詳細デザイン。
- 複数 mission の優先順位最適化。
- 人間承認なしの自動実装。

これらは後続の Agent Improvement Loop、Mission Pilot orchestration、Evaluation concept で扱う。

## 成功条件

Mission Decomposition concept が成立している状態:

1. ユーザーの曖昧な goal を Mission に変換できる。
2. Mission を Objective に分けられる。
3. Objective を Work Package に分けられる。
4. Work Package を Task に分けられる。
5. Task ごとに Verification Gate を持てる。
6. 失敗時の Replanning Unit を持てる。
7. high-risk task を approval required として分類できる。
8. Plan mode が必要な Work Package を判定できる。
9. Mission Decomposition Evaluation によって分解結果を評価できる。
10. 評価結果から review_ready / clarify / redecompose / approval / blocked を選べる。
11. Mission Planner が task candidate generation / evaluation / filtering の主体になっている。
12. Mission Pilot に task candidate generation / evaluation 責務が残っていない。
13. `review_pending` には評価を通過した planning result だけが入る。
14. 低品質 plan は `needs_revision` または `blocked` になり、ユーザーに提示されない。
15. task が大きすぎる / 細かすぎる兆候を検出できる。
16. PDCA 全体や自己改善ループに踏み込みすぎていない。

## Open Questions

- Mission Planner を独立 service にするか、Mission Pilot から呼び出す subordinate service にするか。
- `review_pending` planning result は JSON artifact として保存するか、DB rows に展開するか。
- TaskGraph は DAG として厳密に検証するか、初期は順序付き list で始めるか。
- Work Package と Feature Plan の関係を 1:1 にするか、1:N を許すか。
- human approval required の判定を deterministic rule と LLM decision のどちらで主導するか。
- ContextStill decision を分解前に必須にするか、高リスク時だけにするか。
- task 粒度の良し悪しをどう評価するか。
- Mission Decomposition Evaluation / PlanEvaluation は ProjectEvaluation の evaluator infrastructure を共用するか、Mission Planner 専用 evaluator にするか。
- Course correction はユーザー提示前に自動適用するか、`needs_revision` として保存して再生成 run に回すか。
- Mission Pilot へ渡す handoff contract に、どの評価 summary と blocked reason を含めるか。

## 次に作るべき設計

この concept の次は、次の順に設計する。

1. Mission Planner service boundary。
2. Mission Decomposition output schema。
3. Planning result lifecycle / status model。
4. TaskGraph data model。
5. Decomposition prompt。
6. Decomposition validation。
7. Mission Decomposition Evaluation / PlanEvaluation schema。
8. Quality gate and `review_pending` transition。
9. Course correction action schema。
10. Plan mode work package handoff。
11. Approval classification。
12. Mission Pilot handoff contract。
