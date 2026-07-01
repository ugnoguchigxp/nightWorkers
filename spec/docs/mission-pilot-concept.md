# Mission Pilot Concept

## 目的

NightWorkers に、広いゴールを受け取り、ミッション化、タスク分解、設計、実装、評価、再計画、自己改善候補化までを統括する上位制御レイヤーを追加する。

この文書では、その上位制御レイヤーを `Mission Pilot` と呼ぶ。

Mission Pilot は、実装者ではない。NightWorkers が既に持つ Plan mode、Implementation Queue、Review、ContextStill、Supervisor、Worker、verification を組み合わせ、ユーザーの大雑把な目的を、実行可能な連続作業へ変換する操縦席である。

この文書は実装計画ではない。次に task decomposition、mission state、orchestration API、UI、評価ループを設計するためのコンセプト境界を固定する。

## 比喩

ユーザーは管制室から「東京からパリに行ってくれ」と指示する。

Mission Pilot は、航路、経由地、燃料、天候、機体状態、乗員、着陸条件を見て、どの順で何をするかを決める。

NightWorkers の個別機能は、それぞれ機体の subsystem に相当する。

- Plan mode: 飛行計画を作る。
- Worker: 実際の作業を行う。
- Implementation Queue: 承認済み作業を順番に流す。
- Review / Evaluation: 到達状況と安全性を確認する。
- ContextStill: 過去の知識、ルール、判断材料を渡す。
- Human: 目的、制約、リスク許容、重大な方針転換を承認する。

Mission Pilot は、全 subsystem を直接置き換えない。各 subsystem を必要な順番で呼び出し、進行状況を見て、続行、停止、再計画、人間確認を判断する。

## 背景

NightWorkers は、実装オートメーションに必要な部品を持ち始めている。

- Supervisor は、ユーザー入力から実行方針を選ぶ。
- Plan mode は、機能単位の Feature Plan と dedicated design view を作る。
- Implementation Queue は、承認済み task を実行レーンに流す。
- Worker は、実装、検証、報告を行う。
- Review は、run evidence を見て結果を評価する。
- ContextStill は、`context_compile`、decision、candidate registration を通じて、今必要な知識と判断材料を提供する。
- 設定、provider routing、artifact、task message、run event は NightWorkers 内に保存される。

不足しているのは、これらを横断して「大きな目的に対して、次に何をすべきか」を判断する上位の操縦層である。

現状では、ユーザーが個別 task を切り、Plan mode を使い、queue に入れ、結果を見て、次の task をまた作る必要がある。Mission Pilot は、この一連の判断を NightWorkers 側に持たせるための概念である。

## 基本方針

### 1. Mission Pilot は実装者ではない

Mission Pilot はコード編集、ファイル操作、テスト実行を直接担当しない。

直接実装するのは Worker であり、Mission Pilot は Worker に渡す task、Plan mode に渡す work package、Queue に流す順序、Review 後の再計画を決める。

### 2. Mission は Task より大きい

Task は実装可能な作業単位である。

Mission は複数 task を束ねる目的単位である。

例:

- Mission: Plan mode を新方式へ移行する。
- Task: artifact schema を置換する。
- Task: Supervisor prompt を置換する。
- Task: dedicated view generator を実装する。
- Task: UI を置換する。
- Task: legacy cleanup と verification を行う。

Mission Pilot は、Mission を TaskGraph に分解し、各 task を既存 NightWorkers 機能へ渡す。

### 3. 自動化と対話を分ける

Mission Pilot は、Planning / Chat と Queue / 自動実行を同じ状態にしない。

- 対話状態では、ミッション整理、質問、分解、提案、承認を扱う。
- 自動実行状態では、承認済み task を queue に流し、実行状況を監視する。
- 評価状態では、run evidence と mission progress を比較する。
- 再計画状態では、失敗や前提変更を受けて task graph を更新する。

この分離がないと、LLM が会話で思いついた作業をそのまま実行へ流してしまう。

### 4. ContextStill は判断材料であり、司令塔ではない

ContextStill は Mission Pilot にとって重要な補助系である。

使い道:

- mission や task に関連する過去知識を compile する。
- 次へ進むか、人間確認するか、停止するかの decision input にする。
- 成功 / 失敗から再利用可能な学びを candidate 登録する。
- compile の有用性を `compile_eval` で評価する。

ただし、ContextStill が source of truth ではない。

- source of truth: NightWorkers の Mission、TaskGraph、Task、Run、Artifact、Review、Queue。
- durable knowledge: ContextStill の rule / procedure / failure pattern。
- advisory decision: ContextStill の decision。

### 5. 評価は test 成功だけでは足りない

Worker の task が成功しても、Mission が進んだとは限らない。

Mission Pilot は次を分けて評価する。

- task verification: focused test、typecheck、build、verify が通ったか。
- task outcome: task の acceptance criteria を満たしたか。
- mission progress: 大きな goal に近づいたか。
- regression risk: 他の task や mission の前提を壊していないか。
- learning value: 再利用すべき知見があるか。

Mission Pilot の評価軸は、単なる実装完了ではなく、目的地に近づいたかである。

## 用語

### Mission

ユーザーが達成したい大きな目的。

Mission は、複数 task、複数 run、複数 evaluation を持つ。

### Objective

Mission を達成したと判断するための観測可能な到達条件。

Objective は抽象的な願望ではなく、成果物、挙動、検証条件、運用状態として書く。

### TaskGraph

Mission を実行可能な task 群へ分解した DAG。

TaskGraph は、依存関係、優先順位、リスク、承認状態、実行状態を持つ。

### Work Package

Plan mode に渡せる単位。

Work Package は Feature Plan を作るための入力であり、まだ実装 task そのものではない。

### Pilot Action

Mission Pilot が選べる次の行動。

例:

- `decompose_goal`
- `request_questionnaire`
- `request_feature_plan`
- `enqueue_task`
- `evaluate_run`
- `replan`
- `ask_human`
- `pause_mission`
- `register_learning`
- `propose_self_improvement`

### Mission State

Mission の現在状態。

Mission Pilot は state を見て、次の action を決める。

## Mission Pilot の責務

### Goal Interpreter

ユーザーの広い入力を Mission に変換する。

入力例:

- NightWorkers をもっと自走できるようにしたい。
- Plan mode を作り直したい。
- この repo の品質を上げたい。
- あるプロダクトを MVP まで持っていきたい。

Goal Interpreter が整理するもの:

- 目的。
- 成功条件。
- 制約。
- 非目標。
- 人間確認が必要な判断。
- 最初に調査すべき不確実性。

Goal Interpreter は、曖昧なゴールを勝手に実装 task にしない。まず Mission と Objective に整える。

### Task Decomposer

Mission を task graph に分解する。

分解単位の条件:

- 1つの task がレビュー可能である。
- 1つの task が Plan mode で設計可能である。
- 1つの task が focused verification を持てる。
- 依存関係が説明できる。
- 完了条件が観測可能である。

Task Decomposer は、作業を増やすための機能ではない。大きすぎる仕事を、失敗時に戻れる単位へ分けるための機能である。

### Planner

各 task に対して、Plan mode が必要か、直接実装でよいか、調査が必要かを判断する。

判断例:

- UI / data / API / state など複数観点がある task は Plan mode へ渡す。
- 小さな typo や限定的な bug fix は Plan mode を使わず直接 task 化する。
- 前提が不明な task は investigation を先に作る。
- 高リスク task は human approval を要求する。

### Orchestrator

NightWorkers の subsystem を呼び出す順序を決める。

例:

```text
Mission
  -> ContextStill compile
  -> task decomposition
  -> Plan mode work package
  -> Feature Plan
  -> human approval
  -> Implementation Queue
  -> Worker run
  -> verification
  -> review
  -> mission evaluation
  -> replan or continue
```

Orchestrator は、queue に流すことだけが仕事ではない。止める、聞く、調べる、再計画する、学びを保存することも仕事である。

### Evaluator

Run と artifact を見て、task と mission の進捗を評価する。

Evaluator が見るもの:

- acceptance criteria。
- verification result。
- run event。
- diff。
- review finding。
- artifact。
- queue status。
- user feedback。
- ContextStill decision。

Evaluator は、LLM の自己申告だけで成功判断しない。

### Replanner

失敗、前提変更、追加発見を受けて TaskGraph を更新する。

Replanner が行うこと:

- failed task を修正 task に分ける。
- blocked task を human question に変える。
- 依存順を入れ替える。
- risk が高い task を後回しにする。
- task を削除する。
- mission の scope を縮小する。

Replanner は、無限に作業を増やさない。Mission Objective に対して必要な変更だけを行う。

### Self-Improvement Controller

NightWorkers 自身の改善候補を扱う。

自己改善は強力だが危険である。Mission Pilot は、改善候補を見つけても、すぐ実装しない。

自己改善候補に必要なもの:

- 発見根拠。
- 影響範囲。
- 期待効果。
- 失敗リスク。
- 検証方法。
- 人間承認の要否。

自己改善は、Mission の達成に必要な場合だけ扱う。一般的な「もっと良くできそう」は作業にしない。

## Mission State Model

初期状態は次のように考える。

```ts
type MissionStatus =
  | 'draft'
  | 'clarifying'
  | 'decomposing'
  | 'planning'
  | 'awaiting_approval'
  | 'queued'
  | 'executing'
  | 'evaluating'
  | 'replanning'
  | 'paused'
  | 'completed'
  | 'abandoned'
  | 'failed';
```

### draft

ユーザー入力を受け取った直後。

まだ Mission と Objective が固まっていない。

### clarifying

目的、制約、非目標、リスク許容を確認している状態。

Human に質問してもよい。

### decomposing

Mission を TaskGraph に分解している状態。

ContextStill compile を使い、過去の rule / procedure / failure pattern を参照してよい。

### planning

Task または Work Package に Plan mode を適用している状態。

Feature Plan と dedicated design view が生成される。

### awaiting_approval

実行前に人間承認を待つ状態。

初期実装では、code change、schema change、public API change、destructive operation、self-improvement はここを通す。

### queued

承認済み task が Implementation Queue に入っている状態。

Mission Pilot は queue の実行順やブロックを監視する。

### executing

Worker が task を実行している状態。

Mission Pilot は直接介入しない。必要なら pause / cancel / human intervention を要求する。

### evaluating

Run result、Review、verification、artifact を評価している状態。

Mission progress を更新する。

### replanning

失敗や前提変更により、TaskGraph を更新する状態。

### paused

Human approval、外部情報、危険な変更、リソース不足などで停止している状態。

### completed

Objective が満たされた状態。

### abandoned

人間判断または状況変化により、Mission を継続しない状態。

### failed

Mission が失敗し、現在の制約では回復不能と判断した状態。

## Mission Data Model

初期の概念モデルは次の程度でよい。

```ts
type Mission = {
  id: string;
  repositoryId: string;
  title: string;
  goal: string;
  objectives: MissionObjective[];
  status: MissionStatus;
  constraints: string[];
  nonGoals: string[];
  riskPolicy: MissionRiskPolicy;
  taskGraphId?: string;
  createdAt: string;
  updatedAt: string;
};
```

```ts
type MissionObjective = {
  id: string;
  description: string;
  acceptanceCriteria: string[];
  verificationSignals: string[];
  status: 'pending' | 'satisfied' | 'failed' | 'deferred';
};
```

```ts
type MissionTask = {
  id: string;
  missionId: string;
  title: string;
  purpose: string;
  kind:
    | 'investigation'
    | 'planning'
    | 'implementation'
    | 'verification'
    | 'review'
    | 'self_improvement';
  dependencies: string[];
  status:
    | 'proposed'
    | 'planned'
    | 'approved'
    | 'queued'
    | 'running'
    | 'completed'
    | 'blocked'
    | 'failed'
    | 'deferred'
    | 'cancelled';
  featurePlanMessageId?: string;
  taskId?: string;
  queueEntryId?: string;
  runId?: string;
  evaluationId?: string;
};
```

```ts
type MissionEvaluation = {
  id: string;
  missionId: string;
  taskId?: string;
  result: 'progressed' | 'no_progress' | 'regressed' | 'blocked' | 'completed';
  evidenceRefs: string[];
  nextRecommendedAction: PilotAction;
  notes: string;
};
```

これらは最終 DB schema ではない。Mission Pilot が何を source of truth として見るべきかを示す概念モデルである。

## Pilot Action

Mission Pilot が選べる action は明示的に列挙する。

### `decompose_goal`

Mission を task graph に分ける。

実行条件:

- Mission goal と objective が最低限ある。
- 人間確認が必要な不確実性が blocking ではない。

### `ask_human`

人間に質問する。

実行条件:

- 目的、制約、承認、リスク許容、外部判断が必要。
- LLM が推測して進むと危険。

### `request_context_compile`

ContextStill に関連知識を問い合わせる。

実行条件:

- 過去の失敗、repo convention、procedure、risk が判断に影響する。

### `request_feature_plan`

Plan mode に Work Package を渡し、Feature Plan を作らせる。

実行条件:

- task が複数観点を持つ。
- 設計なしで実装すると失敗しやすい。

### `enqueue_task`

承認済み task を Implementation Queue に流す。

実行条件:

- Feature Plan または十分な task definition がある。
- approval policy を満たす。
- stop condition が明確。

### `evaluate_result`

Run の結果を評価する。

実行条件:

- run が完了、失敗、needs review、blocked のいずれかになった。

### `replan`

TaskGraph を更新する。

実行条件:

- task failed。
- verification failed。
- objective に届いていない。
- 前提が崩れた。
- 人間が scope を変更した。

### `register_learning`

再利用可能な知見を ContextStill に candidate 登録する。

実行条件:

- 単発ではなく再利用可能な rule / procedure / failure pattern である。
- evidence がある。

### `propose_self_improvement`

NightWorkers 自身の改善 task を提案する。

実行条件:

- mission 遂行上の摩擦や失敗が evidence としてある。
- 改善効果と検証方法を説明できる。
- human approval が必要な場合は承認待ちにできる。

### `pause_mission`

Mission を停止する。

実行条件:

- 人間判断が必要。
- 外部状態待ち。
- 影響範囲が広がりすぎた。
- 検証不能。
- 自動実行のリスクが許容範囲を超えた。

## 既存機能との関係

### Plan mode

Plan mode は、Mission Pilot の下位にある設計生成レーンである。

Mission Pilot は Plan mode に対して、Work Package を渡す。

Plan mode は次を返す。

- Feature Plan。
- 必要な dedicated design view。
- verification。
- risk notes。
- implementation steps。

Mission Pilot は、Plan mode の出力を見て、queue に流すか、人間確認するか、再計画するかを決める。

### Implementation Queue

Queue は実行レーンである。

Mission Pilot は queue の代替ではない。

Mission Pilot は、承認済み task を queue に入れ、queue の状態から mission progress を読む。

Queue は processor claim、実行順、run lifecycle を扱う。

### Supervisor

Supervisor は個別 task / run の実行判断を担当する。

Mission Pilot は、Supervisor の上位で mission context を持つ。

Supervisor が「この task をどう実行するか」を判断するのに対し、Mission Pilot は「この mission で次にどの task を作るか、実行するか、止めるか」を判断する。

### ContextStill

ContextStill は知識と判断補助である。

Mission Pilot は、mission / task / evaluation の節目で ContextStill を使う。

使う場所:

- mission decomposition 前。
- high-risk task の approval 前。
- failure evaluation 後。
- self-improvement candidate 作成時。
- reusable lesson registration 時。

### Review / Evaluation

Review は run の evidence を評価する。

Mission Pilot は Review を読んで mission progress を評価する。

Review finding が Mission Task になることはあるが、すべての finding が Mission Task になるわけではない。

### Human

Human は Mission Pilot の上位にいる。

Human が担うもの:

- mission の目的。
- risk policy。
- destructive / high-risk action の承認。
- scope change。
- mission abandon / pause / completion の最終判断。

Mission Pilot は human を置き換えない。人間の意図を運航可能な状態に変換する。

## Autonomy Levels

Mission Pilot は段階的に自律性を上げる。

### Level 0: Advisory Pilot

Mission を整理し、task graph を提案する。

Queue には流さない。

### Level 1: Approved Execution

Mission Pilot が task graph と Feature Plan を作り、人間承認後に queue へ流す。

初期 MVP はこの level を目標にする。

### Level 2: Low-Risk Auto Queue

低リスク task だけ自動で queue に流す。

例:

- documentation update。
- test-only update。
- small internal refactor。
- focused bug fix with clear verification。

### Level 3: Mission Autopilot

Mission objective に向けて、低から中リスク task を自動で分解、実行、評価、再計画する。

high-risk action は人間承認を必要とする。

### Level 4: Self-Improving Mission System

Mission 遂行の摩擦から、NightWorkers 自身の改善を提案し、承認後に実行する。

初期から Level 4 を目指さない。自己改善は最後に広げる。

## Human Approval Policy

初期実装では、次は必ず人間承認を必要とする。

- code change。
- schema / migration change。
- public API change。
- destructive operation。
- security-sensitive change。
- provider / credential / secret handling change。
- long-running queue execution。
- Mission scope の拡張。
- self-improvement。
- verification failure を無視して進む判断。

自動承認してよい候補:

- read-only investigation。
- task graph draft。
- Feature Plan draft。
- low-risk documentation suggestion。
- evaluation summary。

## Stop Conditions

Mission Pilot は、次の場合に止まる。

- Objective が曖昧で、実行可能な task に分解できない。
- 人間の承認が必要。
- task graph が大きくなりすぎた。
- verification が失敗した。
- run evidence と完了主張が一致しない。
- ContextStill decision が高リスクまたは不明を示す。
- queue が詰まっている。
- provider / runtime / credentials の問題で実行できない。
- self-improvement が mission scope を超えている。
- 同じ blocking reason で再計画が繰り返されている。

止まることは失敗ではない。Mission Pilot にとって、危険な自動実行を止めることは重要な機能である。

## Non-goals

Mission Pilot の初期コンセプトでは、次を扱わない。

- 人間なしで全 code change を自動承認すること。
- Worker、Supervisor、Plan mode、Queue を置き換えること。
- ContextStill を project side effect の実行者にすること。
- LLM の自己申告だけで mission completion を判断すること。
- 汎用 AGI 的な長期目標管理。
- 複数 repo をまたぐ大規模 product management。
- 予算、契約、法務、採用など、コード実装以外の事業運営判断。
- すべての review finding を自動で task 化すること。
- 自己改善を自動で実行すること。

## 初期 MVP

最初の Mission Pilot MVP は、完全自律ではなく、承認付き副操縦士にする。

MVP が行うこと:

1. ユーザーの広い goal から Mission draft を作る。
2. Mission Objective と Non-goals を提案する。
3. TaskGraph draft を作る。
4. 各 task に Plan mode が必要かを判定する。
5. Plan mode が必要な task には Work Package を作る。
6. 人間が承認した task だけ queue に流す。
7. run result と review を読み、Mission progress を更新する。
8. 次にやるべき task、停止すべき理由、再計画案を提示する。

MVP がやらないこと:

- 自動で code change task を承認する。
- 自動で self-improvement を実装する。
- 複数 mission を横断して優先順位を最適化する。
- 失敗した verification を無視して先へ進む。

## UI コンセプト

Mission Pilot UI は chat だけにしない。

必要な表示:

- Mission goal。
- Objectives。
- TaskGraph。
- 現在の Mission state。
- 次の推奨 Pilot Action。
- Approval required items。
- Queue / Run status。
- Evaluation summary。
- Replan history。
- ContextStill evidence / decision summary。
- Stop conditions。

UI の主役は LLM の長文説明ではない。

主役は、現在どこに向かっていて、次に何をするべきで、何が止めているかである。

## Evaluation Concept

Mission evaluation は、task 単位と mission 単位を分ける。

### Task evaluation

見るもの:

- acceptance criteria。
- focused test。
- build / typecheck / verify。
- review finding。
- diff。
- artifact。

### Mission evaluation

見るもの:

- objective satisfaction。
- task graph progress。
- unresolved blockers。
- regression risk。
- remaining scope。
- user feedback。
- repeated failure pattern。

Mission Pilot は、task が成功しても mission objective が未達なら続行または再計画する。

task が失敗しても、mission objective を見直すことでより良い経路が見える場合がある。

## Self-Improvement Concept

Mission Pilot は、NightWorkers 自身の改善を扱える。

ただし、自己改善は常に evidence-based にする。

自己改善候補の source:

- repeated verification failure。
- repeated human correction。
- repeated queue blockage。
- Plan mode が毎回同じ不足を出す。
- ContextStill compile が毎回同じ不足を示す。
- Worker が同じ失敗を繰り返す。
- UI が mission progress を判断しにくい。

自己改善候補に必要な fields:

- problem。
- evidenceRefs。
- expected benefit。
- implementation risk。
- verification plan。
- required approval。
- rollback / stop condition。

自己改善は Mission Pilot の中で直接実行しない。self-improvement task として提案し、承認後に通常の Plan mode / Queue / Worker / Review を通す。

## 成功条件

Mission Pilot concept が成立している状態:

1. ユーザーの大雑把な goal を Mission と Objective に変換できる。
2. Mission を実行可能な TaskGraph に分解できる。
3. Task ごとに Plan mode、直接実装、調査、保留を選べる。
4. Queue 実行と対話 planning が状態として分離されている。
5. Run result から task outcome と mission progress を別々に評価できる。
6. 失敗時に replan / ask human / pause を選べる。
7. ContextStill を判断材料として使い、source of truth と混同しない。
8. 自己改善候補を evidence-based に提案できる。
9. Human approval policy に従って危険な自動実行を止められる。
10. Mission completion が evidence に基づいて判断される。

## Open Questions

- Mission を NightWorkers の既存 Task と同じ DB に置くか、別 aggregate にするか。
- TaskGraph は永続化するか、artifact として保存するか。
- Mission Pilot の action decision は Supervisor の一部にするか、別 service にするか。
- ContextStill decision をどの状態遷移で必須にするか。
- 初期 MVP で自動 queue 投入をどこまで許可するか。
- Mission evaluation を LLM reviewer、deterministic evaluator、human review のどれが主導するか。
- Mission Pilot UI は Workbench 内の pane として始めるか、独立 screen にするか。
- 複数 Mission の優先順位付けをいつ扱うか。
- 自己改善候補を既存 Autonomous Goals と統合するか、Mission の一種として扱うか。

## 次に作るべき設計

この concept の次は、次の順に設計する。

1. Mission data model。
2. Task decomposition flow。
3. Mission Pilot action schema。
4. Mission state transition。
5. Mission UI。
6. Plan mode / Queue / Review / ContextStill integration。
7. MVP implementation phases。
