# Mission Pilot Concept and First-Step MVP Plan

## Status

superseded-by-mission-pilot-mvp-remaining-work

## 目的

NightWorkers に、広いゴールを受け取り、ミッション化、タスク分解、計画、承認、実行キュー投入、レビュー、評価、再計画までを統括する上位制御レイヤーを追加する。

この上位制御レイヤーを `Mission Pilot` と呼ぶ。

Mission Pilot は、実装者ではない。
Mission Pilot は、NightWorkers が既に持つ subsystem を目的駆動で組み合わせる。

```text
- Project Evaluation
- Mission Goal
- Mission Decomposition
- Plan mode
- Implementation Queue
- Worker
- Review Mode
- Test / verification evidence
- ContextStill
- Supervisor
- Human approval
```

Mission Pilot の役割は、ユーザーが設定したゴールを、観測可能な Objective と実行可能な TaskGraph に変換し、承認済みの作業だけを安全に進め、結果を evidence に基づいて評価し、必要なら再計画することである。

この文書は、Mission Pilot のコンセプト再整理と、最初に作るべき First-Step MVP の実装計画を定義する。

## 固定する前提

Mission Pilot は、ゴールを勝手に決めない。

ゴールを設定するのは人間である。
Mission Pilot は、そのゴールを実行可能な Mission / Objective / TaskGraph / Task / Approval / Queue / Evaluation に変換する。

```text
Human sets a goal.
Mission Pilot decomposes the goal into a Mission route.
Human approves risky or execution-bound steps.
NightWorkers executes approved work.
Mission Pilot evaluates progress from evidence.
Human returns when attention is needed.
```

First-Step MVP は、完全自律ではなく Level 1: Approved Execution に固定する。

MVP では、Mission Pilot が code change task を自動承認しない。
MVP では、承認済み task の queue 投入、実行状況の追跡、evidence に基づく MissionEvaluation、replan suggestion までを扱う。

## プロダクト方針

Mission Pilot は、単なる「自動実装ボタン」ではない。

Mission Pilot は、ユーザーが常時監視しなくても進められるが、ユーザーが見に来た瞬間に、現在地、判断理由、証拠、次の承認点が分かる目的駆動の開発管制室である。

最適な体験は、background で進み、必要なときだけ attention を要求し、開けば判断過程を追える状態である。

### Mission Control としての UI

Autopilot の起動は、Mission 画面で行う。

Mission 画面は、Mission の現在地、TaskGraph、承認待ち、実行状況、evidence、replan suggestion を確認し、その場で `Start Autopilot`、`Pause`、`Resume`、`Approve`、`Request replan` を実行する cockpit とする。

UI は Mission Pilot の本体ではない。
UI は Human-facing control surface であり、実行制御の source of truth は API と永続化された Mission state である。

### UX の基本姿勢

Mission Pilot の UX は、次の3つのモードを持つ。

```text
1. Watch Mode
   ユーザーが Pilot の判断と進行を見守るモード。
   初回利用、高リスク作業、デバッグ、信頼構築に使う。

2. Background Mode
   ユーザーが他の作業をしていても Mission が進むモード。
   通常時は細かいログではなく、進捗と attention item だけを示す。

3. Attention Mode
   承認、失敗、曖昧さ、scope expansion、verification failure など、
   ユーザー判断が必要なときだけ前面に出るモード。
```

Mission Pilot は、ユーザーにずっと眺めてもらうための UI ではない。
一方で、完全なブラックボックスでもない。

## 実行制御の方針

Mission Pilot の実行制御は API-first / service-command-first にする。

Mission Pilot が Playwright のように NightWorkers の UI をクリックして作業を進める形を、主経路にしない。

主経路は次の形にする。

```text
Human
  -> Mission Control UI
  -> Mission Pilot API
  -> Mission Pilot service
  -> Mission / PilotAction / Approval / Queue / Review / Evaluation DB
  -> Worker / Queue / Review subsystems
```

UI 操作の代替実行は、次の場合だけ補助用途として扱う。

- 外部サービスが API を持たず、UI 操作しか実行手段がない場合
- E2E で実ユーザー操作を検証する場合
- Mission Pilot の UI 自体をテストする場合

NightWorkers 内部の Mission 進行、Task 作成、Queue 投入、Approval、Pause、Replan、Evaluation は、UI クリック代替ではなく明示的な backend command として実装する。

理由:

- API は権限、監査、再試行、idempotency を扱いやすい。
- UI 操作代替は画面変更に弱く、失敗時の原因境界が曖昧になる。
- 認証が入った後に、ユーザーの browser session を借りて background 実行する設計は危険である。
- Mission state の source of truth を DB に置ける。

## 将来の認証と権限

今は認証がなくても、Mission Pilot は将来の認証を前提に設計する。

認証導入後も、Mission Pilot はユーザーの cookie や browser session を借りて裏で UI 操作を行わない。

Autopilot 起動時に、backend 側へ明示的な grant を保存する。

```ts
type MissionAutopilotGrant = {
  id: string;
  missionId: string;
  userId: string;
  autonomyLevel: 0 | 1 | 2 | 3 | 4;
  allowedActions: PilotActionType[];
  approvalPolicyId?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
};
```

background job は `mission_pilot` actor として動く。
ただし、各 action には次を残す。

```ts
type PilotActionActor = {
  actorType: "human" | "mission_pilot" | "worker" | "system";
  actorId?: string;
  initiatedByUserId?: string;
  authorizedByGrantId?: string;
};
```

これにより、認証導入後も次を判定できる。

- 誰が Autopilot を起動したか
- どの Mission に対して許可したか
- どの action が許可範囲に含まれるか
- 承認が必要な action を勝手に進めていないか
- どの evidence に基づいて進行したか
- いつ grant が失効または revoke されたか

## 中核コンセプト

### Mission Pilot は Mission Control である

Mission Pilot は、個別 task の実装者ではなく、Mission 全体の進行を制御する。

```text
Mission Pilot:
  何を達成するべきか
  どの順で進めるべきか
  どこで承認が必要か
  実行結果は目的に近づいたか
  失敗時に続行、停止、再計画のどれを選ぶか

Worker:
  個別 task を実装する

Review / Test:
  実行結果を検証する

Human:
  目的、制約、リスク許容、scope change、高リスク判断を承認する
```

### Mission は Task より大きい

Task は実装可能な作業単位である。
Mission は、複数の task、run、review、evaluation を束ねる目的単位である。

```text
Goal:
  Project Detail で evidence を追いやすくしたい

Mission:
  Project Detail の evidence tracking を改善する

Objectives:
  - Project Detail で run evidence が追える
  - Review / Test 結果が task progress に接続されている
  - ユーザーが次に何を見るべきか分かる

Mission Tasks:
  - evidence panel の現状調査
  - UI 改善 plan 作成
  - Project Detail の表示改善
  - Review / Test evidence の接続
  - focused test 追加
  - mission progress evaluation
```

### Source of Truth を分ける

Mission Pilot の source of truth は、chat transcript ではない。

```text
Source of truth:
  NightWorkers DB
  Mission
  Objective
  Planning Result
  MissionTaskCandidate
  MissionTask
  Queue entry
  Run
  Review
  Test evidence
  MissionEvaluation
  MissionEvent
  PilotAction
  AutopilotGrant

Advisory / knowledge:
  ContextStill compile
  ContextStill decision
  reusable rule / procedure / failure pattern

Human-facing explanation:
  Mission event
  Pilot action card
  progress summary
  attention item
```

Chat は goal intake や説明には使ってよい。
しかし Mission の状態、承認、実行、評価、再計画は構造化されたデータとして保存する。

## 既存機能との関係

NightWorkers には、Mission Pilot の土台になる既存実装がある。

### Mission Goal / Mission Decomposition

既存の Mission Decomposition は、Mission Pilot の TaskGraph draft 作成レーンとして扱う。

現状の境界:

- `mission_planning_results` は planning / evaluation run
- TaskCandidate はユーザーが review できる Task 候補
- `candidate` と `proposal` は同義として扱う
- 既存実装では TaskCandidate の保存先として `mission_task_proposals` table を使う
- Task 作成は raw draft から直接ではなく TaskCandidate selection の後に行う
- `approvalRequired`、`risk`、`verificationGate`、`scheduling` は TaskCandidate metadata として持つ

Mission Pilot MVP は、この既存線を置き換えず、Mission Control から見える形へ昇格する。

### Project Evaluation

First-Step MVP の優先入口は、Project Evaluation improvement idea から Mission を作る流れにする。

既存の `Project Evaluation -> Task` 直接作成は残してよい。
ただし、Mission Pilot の主経路では、improvement idea を Mission source として残し、Objective / Non-goals / TaskGraph draft を作ってから Task 作成へ進める。

```text
Project Evaluation
  -> Improvement Idea
  -> Create Mission
  -> Mission Decomposition
  -> Task Proposals
  -> Human approval
  -> Task creation
  -> Queue admission
  -> Worker Run
  -> Review / Test evidence
  -> MissionEvaluation
```

### Plan mode

Plan mode は、Mission Pilot の下位にある設計生成レーンである。

Mission Pilot は、必要な MissionTask に対して Work Package を作る。
Plan mode は Feature Plan、dedicated design view、verification、risk notes、implementation steps を返す。

Mission Pilot は、Plan mode の出力を見て、queue に流すか、人間確認するか、再計画するかを決める。

### Implementation Queue

Queue は実行レーンである。

Mission Pilot は queue の代替ではない。
Mission Pilot は、承認済み task を queue に入れ、queue の状態から mission progress を読む。

Queue は processor claim、実行順、run lifecycle を扱う。

### Review / Test Evidence

Review / Test は run の evidence を評価する。

Mission Pilot は Review / Test evidence を読んで MissionEvaluation を作る。
Review finding が MissionTask になることはあるが、すべての finding が MissionTask になるわけではない。

### ContextStill

ContextStill は知識と判断補助である。
ContextStill は source of truth ではない。

Mission Pilot は、次の節目で ContextStill を使う。

- mission decomposition 前
- high-risk task の approval 前
- failure evaluation 後
- self-improvement candidate 作成時
- reusable lesson registration 時

## Pilot Action Card

Mission Pilot の作業は、LLM の長文ログとして見せない。
中心に置くべきは、構造化された `PilotAction` と `MissionEvent` である。

UI 上では、Pilot の現在行動を次のような card として見せる。

```text
Current Pilot Action:
  evaluate_result

Target:
  Task #18 - Review Mode の test evidence 表示改善

Why:
  Worker run が完了したため、acceptance criteria と review finding を照合している

Evidence:
  - Run #42
  - Review #17
  - Test Evidence #9

Next if passed:
  Objective "テスト証跡が Project Detail から追える" を progressed に更新する

Next if failed:
  Replan suggestion を作り、Attention Inbox に出す
```

この表示により、ユーザーは Pilot が勝手にタスクを操作しているのではなく、定義された action schema に従って mission を進めていると理解できる。

## Mission UI Concept

Project Detail の `Mission` tab を、Mission Control cockpit として育てる。

既存の Mission Goal / Mission / TaskCandidate tree は残す。
その上に、Mission Detail と Autopilot control surface を追加する。

### Mission List

Project Detail 内で、その project に紐づく Mission を一覧する。

表示項目:

- Mission title
- goal
- status
- autonomy level
- objective progress
- completed / running / blocked task count
- attention required count
- latest evaluation result
- autopilot status

### Mission Detail

Mission Detail は MVP の中心画面とする。

必須 component:

1. MissionHeader
2. ObjectiveProgressPanel
3. CurrentPilotActionPanel
4. MissionTaskGraphPanel
5. AttentionInboxPanel
6. MissionEvidenceDrawer
7. MissionTimelinePanel
8. AutopilotControlPanel

### Autopilot Control Panel

Autopilot 起動は、この panel から行う。

表示するもの:

- current autonomy level
- grant status
- allowed actions
- next proposed pilot action
- approval policy
- stop conditions
- last evaluation

操作:

- Start Autopilot
- Pause
- Resume
- Revoke grant
- Approve next action
- Request replan
- Open evidence

MVP では `Start Autopilot` は Level 1 に固定する。
Level 1 では、Mission Pilot は draft / TaskCandidate / evaluation / replan suggestion を自動生成できるが、code change task の queue admission には human approval を必要とする。

### Attention Inbox

Attention Inbox は最重要 UI とする。

表示する item:

- approval required
- human question
- verification failed
- review finding requires decision
- replan approval required
- task blocked
- queue blocked
- scope expansion detected
- grant expired or revoked

Attention item には必ず action を付ける。

- Approve
- Reject
- Ask to replan
- Pause mission
- Mark as accepted risk
- Open evidence
- Revoke Autopilot grant

### 離席後サマリ

Background Mode では、ユーザーが戻ってきたときに差分サマリを出す。

```text
While you were away:
  - Task #12 completed
  - Review found 2 minor issues
  - Objective "Project Detail で evidence を追える" progressed
  - Task #13 is awaiting approval because it may affect public API
  - Mission Pilot recommends replanning Task #14
```

## Autonomy Levels

Mission Pilot は段階的に自律性を上げる。

### Level 0: Advisory Pilot

Mission を整理し、Objective と TaskGraph を提案する。
Queue には流さない。

### Level 1: Approved Execution

Mission Pilot が Mission、Objective、TaskGraph、Feature Plan / Work Package を作る。
人間が承認した task だけ Implementation Queue に流す。

First-Step MVP は Level 1 に固定する。

### Level 2: Low-Risk Auto Queue

低リスク task だけ自動で queue に流す。

候補:

- documentation update
- test-only update
- small internal refactor
- focused bug fix with clear verification

Level 2 は MVP では実装しない。
ただし、将来拡張できるように `riskLevel` と `approvalRequired` は最初から model に持たせる。

### Level 3: Mission Autopilot

低から中リスク task を自動で分解、実行、評価、再計画する。
高リスク action は人間承認を必要とする。

### Level 4: Self-Improving Mission System

Mission 遂行中に見つかった NightWorkers 自身の摩擦や失敗を、自己改善 candidate として提案する。
自己改善は必ず evidence-based にし、初期段階では自動実行しない。

## Human Approval Policy

First-Step MVP では、次は必ず人間承認を必要とする。

- code change
- schema / migration change
- public API change
- destructive operation
- security-sensitive change
- provider / credential / secret handling change
- long-running queue execution
- Mission scope expansion
- self-improvement
- verification failure を無視して進む判断
- Autopilot grant の作成または権限拡張

自動生成してよいが、自動実行しないもの:

- Mission draft
- Objective draft
- Non-goals draft
- TaskGraph draft
- Work Package draft
- Feature Plan draft
- Evaluation summary
- Replan suggestion

自動承認候補は、First-Step MVP では扱わない。
Level 2 以降で別途定義する。

## Stop Conditions

Mission Pilot は、危険または不明確な状況では止まる。

- Objective が曖昧
- task に分解できない
- human approval が必要
- task graph が大きくなりすぎた
- verification が失敗した
- run evidence と完了主張が一致しない
- queue が詰まっている
- provider / runtime / credentials 問題で実行不能
- scope が拡大している
- Autopilot grant が失効または revoke された
- actor permission が不足している
- self-improvement が mission scope を超えている
- 同じ blocking reason で replan が繰り返されている

止まることは失敗ではない。
Mission Pilot にとって、危険な自動実行を止めることは重要な機能である。

# First-Step MVP Plan

## MVP の目的

First-Step MVP の目的は、完全自律実行ではない。

目的は、以下の一連の流れを成立させることである。

```text
Human-defined Goal / Project Evaluation improvement
  -> Mission Draft
  -> Objectives / Non-goals
  -> TaskGraph Draft
  -> Human Approval
  -> Task creation
  -> Queue Enqueue
  -> Worker Run
  -> Review / Test Evidence
  -> Mission Evaluation
  -> Continue / Replan / Pause
```

First-Step MVP では、Mission Pilot が自動で code change task を承認することはしない。
承認済み task の queue 投入と、結果評価までを範囲にする。

## Existing Baseline

実装はゼロから始めない。

既存 baseline:

- `missions` table
- `mission_decomposition_runs` table
- `mission_planning_results` table
- `mission_task_proposals` table
- Mission candidate generation API
- Mission decomposition API
- Mission TaskCandidate to Task conversion API
- `approvalRequired` metadata
- queue admission の `approveMissionProposal`
- Project Detail の `Mission` tab
- Project Evaluation improvement idea
- Review Mode evidence tables

First-Step MVP は、この baseline を Mission Pilot として再編する。

## MVP Scope

First-Step MVP は、ひとまとめの大きな実装にしない。
Mission Pilot の価値を薄い縦切りで証明し、その後に evidence / evaluation / replan を足す。

### MVP-0: Read-only Mission Cockpit

目的:

既存 Mission Decomposition を Mission Control として見えるようにする。

作るもの:

- Mission Detail route
- Mission header
- Objective / latest planning result display
- TaskCandidate list
- `approvalRequired` の attention 表示
- MissionEvent timeline の最小版

作らないもの:

- 本格 Autopilot
- queue enqueue
- MissionEvaluation
- Replan

完了条件:

```text
ユーザーが Mission Detail を開けば、
Mission の goal、draft objectives、TaskCandidate、approvalRequired を確認できる。
```

### MVP-1: Project Evaluation -> Mission -> TaskCandidate -> Approval

目的:

Project Evaluation improvement idea を Mission 化し、TaskCandidate を承認または reject できるようにする。

作るもの:

- Create Mission from improvement idea
- sourceRefId + immutable sourceSnapshot
- Objective / Non-goals / TaskGraph draft
- MissionApproval
- Approve / Reject UI
- AttentionItem for approval-required TaskCandidate

完了条件:

```text
Project Evaluation の improvement idea から Mission を作成し、
TaskCandidate を承認または reject できる。
```

### MVP-2: Approved TaskCandidate -> Queue

目的:

承認済み TaskCandidate だけを実行対象に変換し、Implementation Queue に流せるようにする。

作るもの:

- approved TaskCandidate -> MissionTask conversion
- MissionTask -> NightWorkers Task mapping
- Queue enqueue command
- queueEntryId linkage
- run status sync
- idempotency guard
- approval snapshot hash validation

完了条件:

```text
未承認 TaskCandidate は queue に入らない。
承認済み TaskCandidate は MissionTask / NightWorkers Task に変換され、
queue に入り、Mission Detail に queued / running / completed が反映される。
```

### MVP-3: Autopilot Control

目的:

Mission 画面から Level 1 Autopilot を起動、停止、revoke できるようにする。

作るもの:

- AutopilotControlPanel
- MissionAutopilotGrant
- Start / Pause / Resume / Revoke API
- allowedActions validation
- grant invariant validation

完了条件:

```text
Mission Detail から Level 1 Autopilot を起動できる。
Grant は approvalRequired を上書きせず、revoke 後は新規 Pilot action が開始されない。
```

### MVP-4: Evidence -> MissionEvaluation

目的:

実行結果を Mission 進捗に接続する。

作るもの:

- run result fetch
- review finding fetch
- test evidence fetch
- typed EvidenceRef
- MissionEvaluation
- Objective status update

完了条件:

```text
Run 完了後、MissionEvaluation が evidence を参照し、
Objective を progressed / blocked / satisfied に更新できる。
```

### MVP-5: Replan Suggestion

目的:

失敗時に勝手に進まず、再計画案を出す。

作るもの:

- verification failure detection
- blocked task detection
- MissionPlanRevision
- Replan suggestion
- TaskGraph diff preview
- replan approval

完了条件:

```text
verification failure 時に Mission は completed にならず、
Attention Inbox に replan suggestion が出る。
```

### MVP 横断で作る安全基盤

- PilotAction model
- MissionEvent timeline
- MissionAttentionItem model
- MissionApproval model
- typed EvidenceRef
- minimal AutopilotGrant
- grant invariant validation
- queue enqueue idempotency

### MVP で作らないもの

- code change task の自動承認
- Level 2 low-risk auto queue
- 複数 Mission の優先順位最適化
- 自己改善の自動実行
- 複雑な graph scheduling
- Playwright による NightWorkers UI 操作代替を主経路にすること
- すべての review finding の自動 task 化
- verification failure を無視した続行
- 完全な長期プロダクトマネジメント

## 推奨する MVP の入口

First-Step MVP は、汎用 goal input だけから始めるより、既存の Project Evaluation と接続するのがよい。

理由は、Project Evaluation にはすでに改善候補と評価軸があり、Mission 化する材料が揃っているからである。

```text
Project Evaluation 実行
  -> Improvement Ideas 生成
  -> ユーザーが "Create Mission" を押す
  -> Mission Pilot が Objective / Non-goals / TaskGraph を提案
  -> ユーザーが承認
  -> Task を作成
  -> Queue に流す
  -> Review / Test evidence で進捗評価
```

Priority:

1. Project Evaluation improvement idea から Mission 作成
2. ユーザーが設定した Mission Goal から Mission 作成
3. Review finding / Test evidence failure から Mission 作成

First-Step MVP では Priority 1 と Priority 2 を中心に実装する。

## Data Model Draft

### EvidenceRef

Mission Pilot は evidence-based を中核価値にする。
そのため、evidence は `string[]` ではなく型付き参照として扱う。

```ts
type EvidenceRef =
  | {
      type: "run";
      id: string;
      summary?: string;
    }
  | {
      type: "review";
      id: string;
      summary?: string;
    }
  | {
      type: "test_evidence";
      id: string;
      summary?: string;
    }
  | {
      type: "queue_entry";
      id: string;
      summary?: string;
    }
  | {
      type: "artifact";
      id: string;
      summary?: string;
    }
  | {
      type: "commit";
      id: string;
      summary?: string;
    }
  | {
      type: "mission_event";
      id: string;
      summary?: string;
    };
```

### Mission

```ts
type MissionLifecycleStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "abandoned"
  | "failed";

type MissionExecutionSummary = {
  proposedCount: number;
  awaitingApprovalCount: number;
  approvedCount: number;
  queuedCount: number;
  runningCount: number;
  blockedCount: number;
  completedCount: number;
  attentionRequiredCount: number;
  latestEvaluationResult?: MissionEvaluationResult;
};

type Mission = {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  source:
    | "project_evaluation"
    | "mission_goal"
    | "user_goal"
    | "review_finding"
    | "test_evidence"
    | "manual";
  sourceRefId?: string;
  sourceSnapshot?: unknown;
  status: MissionLifecycleStatus;
  autonomyLevel: 0 | 1 | 2 | 3 | 4;
  riskPolicyId?: string;
  activeAutopilotGrantId?: string;
  currentPlanRevisionId?: string;
  createdAt: string;
  updatedAt: string;
};
```

Mission は大きな lifecycle status だけを持つ。
複数 task の現在地は `MissionExecutionSummary` として read model で算出する。
UI では `Active · 1 running · 2 awaiting approval · 1 blocked` のように表示する。

### MissionObjective

```ts
type MissionObjectiveStatus =
  | "pending"
  | "progressed"
  | "satisfied"
  | "blocked"
  | "failed"
  | "deferred";

type MissionObjective = {
  id: string;
  missionId: string;
  description: string;
  acceptanceCriteria: string[];
  verificationSignals: string[];
  status: MissionObjectiveStatus;
  evidenceRefs: EvidenceRef[];
  createdAt: string;
  updatedAt: string;
};
```

### MissionTaskCandidate

`candidate` と `proposal` は同義として扱う。
文書上の概念名は `MissionTaskCandidate` に揃える。

既存実装では、保存先 table 名として `mission_task_proposals` が残る。
これは storage naming であり、ユーザー向けにも設計概念としても `candidate` と `proposal` を別物にしない。

```ts
type MissionTaskCandidateStatus =
  | "candidate"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "dismissed"
  | "mission_task_created"
  | "superseded";

type MissionTaskCandidate = {
  id: string;
  missionId: string;
  objectiveId?: string;
  planningResultId?: string;
  title: string;
  purpose: string;
  initialPrompt: string;
  expectedOutcome: string;
  acceptanceCriteria: string[];
  verificationGate: string[];
  targetFilesOrModules: string[];
  dependsOn: string[];
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  approvalRequiredReason?: string;
  status: MissionTaskCandidateStatus;
  snapshotHash: string;
  createdAt: string;
  updatedAt: string;
};
```

### MissionTask

MissionTask は、承認済み TaskCandidate から作られる Mission 内の実行対象である。

```text
TaskCandidate -> Approval -> MissionTask -> NightWorkers Task -> QueueEntry -> Run -> Evidence
```

TaskCandidate は「案」であり、MissionTask は「Mission 内で実行してよい work item」である。
NightWorkers Task は Worker が実行する具体 task である。

```ts
type MissionTaskKind =
  | "investigation"
  | "planning"
  | "implementation"
  | "verification"
  | "review"
  | "documentation"
  | "self_improvement";

type MissionTaskStatus =
  | "approved"
  | "task_created"
  | "queued"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "deferred"
  | "cancelled";

type MissionTask = {
  id: string;
  missionId: string;
  objectiveId?: string;
  sourceCandidateId: string;
  title: string;
  purpose: string;
  kind: MissionTaskKind;
  status: MissionTaskStatus;
  dependsOn: string[];
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  approvalId: string;
  approvedSnapshotHash: string;
  workPackageArtifactId?: string;
  featurePlanArtifactId?: string;
  nightWorkersTaskId?: string;
  queueEntryId?: string;
  runId?: string;
  reviewId?: string;
  testEvidenceId?: string;
  evaluationId?: string;
  createdAt: string;
  updatedAt: string;
};
```

### MissionApproval

Level 1 の安全境界は approval である。
Approval は、何を、どの snapshot に対して、誰が承認したかを保存する。

```ts
type ApprovalSubjectType =
  | "mission_task_candidate"
  | "mission_task"
  | "queue_admission"
  | "replan"
  | "autopilot_grant"
  | "scope_expansion";

type ApprovalStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "revoked"
  | "expired"
  | "superseded";

type MissionApproval = {
  id: string;
  missionId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  requestedAction: PilotActionType;
  status: ApprovalStatus;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  snapshotHash: string;
  snapshotPayload: unknown;
  requestedBy: PilotActionActor;
  decidedBy?: PilotActionActor;
  decidedAt?: string;
  expiresAt?: string;
  createdAt: string;
};
```

承認後に TaskCandidate / MissionTask の内容が変わった場合、古い approval で queue に入れてはいけない。
enqueue 時は approval の `snapshotHash` と現在の target snapshot を照合する。

### MissionAttentionItem

Attention Inbox は UX の中心であり、単なる表示テキストではない。
承認、質問、blocked decision、verification failure、grant expiration など、ユーザー判断が必要な状態を表す。

MVP-0 では read model でもよい。
MVP-1 以降では、ユーザー action と解決状態を持つ item として保存する。

```ts
type MissionAttentionItemType =
  | "approval_required"
  | "human_question"
  | "verification_failed"
  | "review_finding_decision"
  | "replan_approval_required"
  | "task_blocked"
  | "queue_blocked"
  | "scope_expansion_detected"
  | "grant_expired"
  | "grant_revoked";

type MissionAttentionItemStatus =
  | "open"
  | "resolved"
  | "dismissed"
  | "superseded";

type MissionAttentionItem = {
  id: string;
  missionId: string;
  taskId?: string;
  type: MissionAttentionItemType;
  status: MissionAttentionItemStatus;
  title: string;
  reason: string;
  evidenceRefs: EvidenceRef[];
  availableActions: string[];
  priority: "low" | "medium" | "high" | "blocking";
  createdAt: string;
  resolvedAt?: string;
};
```

### PilotAction

```ts
type PilotActionType =
  | "decompose_goal"
  | "ask_human"
  | "request_context_compile"
  | "request_feature_plan"
  | "request_approval"
  | "enqueue_task"
  | "evaluate_result"
  | "replan"
  | "register_learning"
  | "propose_self_improvement"
  | "pause_mission";

type PilotActionStatus =
  | "proposed"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

type PilotAction = {
  id: string;
  missionId: string;
  taskId?: string;
  type: PilotActionType;
  status: PilotActionStatus;
  reason: string;
  evidenceRefs: EvidenceRef[];
  nextIfSucceeded?: string;
  nextIfFailed?: string;
  requiresHumanAttention: boolean;
  actor: PilotActionActor;
  createdAt: string;
  completedAt?: string;
};
```

### MissionEvaluation

```ts
type MissionEvaluationResult =
  | "progressed"
  | "no_progress"
  | "regressed"
  | "blocked"
  | "completed"
  | "failed";

type MissionEvaluation = {
  id: string;
  missionId: string;
  taskId?: string;
  result: MissionEvaluationResult;
  objectiveUpdates: {
    objectiveId: string;
    previousStatus: MissionObjectiveStatus;
    nextStatus: MissionObjectiveStatus;
    reason: string;
  }[];
  evidenceRefs: EvidenceRef[];
  nextRecommendedAction: PilotActionType;
  summary: string;
  createdAt: string;
};
```

### MissionPlanRevision / ReplanSuggestion

Replan は TaskGraph の差分として扱う。
古い plan に対する replan を、最新 plan に誤適用しないよう `baseRevisionId` を持つ。

```ts
type MissionPlanRevision = {
  id: string;
  missionId: string;
  revisionNumber: number;
  parentRevisionId?: string;
  reason: string;
  evidenceRefs: EvidenceRef[];
  objectiveSnapshot: unknown;
  taskGraphSnapshot: unknown;
  createdBy: PilotActionActor;
  createdAt: string;
};

type MissionReplanSuggestion = {
  id: string;
  missionId: string;
  baseRevisionId: string;
  status:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "applied"
    | "superseded";
  reason: string;
  diff: {
    addedTaskCandidateIds: string[];
    removedTaskCandidateIds: string[];
    changedTaskCandidateIds: string[];
    dependencyChanges: unknown[];
  };
  evidenceRefs: EvidenceRef[];
  createdAt: string;
};
```

### MissionEvent

```ts
type MissionEvent = {
  id: string;
  missionId: string;
  taskId?: string;
  eventType:
    | "mission_created"
    | "objective_created"
    | "taskgraph_created"
    | "autopilot_started"
    | "autopilot_paused"
    | "autopilot_revoked"
    | "approval_requested"
    | "approval_granted"
    | "task_created"
    | "task_queued"
    | "run_started"
    | "run_completed"
    | "review_completed"
    | "test_evidence_added"
    | "mission_evaluated"
    | "replan_created"
    | "mission_paused"
    | "mission_resumed"
    | "mission_completed"
    | "mission_failed";
  summary: string;
  payload?: unknown;
  createdAt: string;
};
```

## API Draft

Mission Pilot の UI は、すべて backend API の command を呼ぶ。
UI 操作代替は主経路にしない。

### Mission 作成

```http
POST /api/projects/:projectId/missions
```

用途:

- user goal から Mission draft を作る
- Mission Goal から Mission draft を作る
- Project Evaluation improvement idea から Mission draft を作る

### Mission 詳細取得

```http
GET /api/projects/:projectId/missions/:missionId
```

返すもの:

- mission
- objectives
- MissionTaskCandidates
- MissionTasks
- current pilot action
- attention items
- latest evaluation
- event timeline
- autopilot grant status

### Autopilot 起動

```http
POST /api/projects/:projectId/missions/:missionId/autopilot/start
```

MVP では `autonomyLevel: 1` のみ許可する。

### Autopilot 停止 / 再開 / revoke

```http
POST /api/projects/:projectId/missions/:missionId/autopilot/pause
POST /api/projects/:projectId/missions/:missionId/autopilot/resume
POST /api/projects/:projectId/missions/:missionId/autopilot/revoke
```

### TaskGraph draft 生成

```http
POST /api/projects/:projectId/missions/:missionId/decompose
```

### 承認要求

```http
POST /api/projects/:projectId/missions/:missionId/approvals
POST /api/projects/:projectId/missions/:missionId/approvals/:approvalId/approve
POST /api/projects/:projectId/missions/:missionId/approvals/:approvalId/reject
```

### 承認済み task を queue に投入

```http
POST /api/projects/:projectId/missions/:missionId/tasks/:missionTaskId/enqueue
Idempotency-Key: <uuid>
```

body:

```ts
type EnqueueMissionTaskRequest = {
  approvalId: string;
  expectedTaskSnapshotHash: string;
};
```

server は次を検証する。

- MissionTask が存在する
- approval が存在する
- approval.status が `approved`
- approval.subjectId が MissionTask を指す
- approval snapshot hash が現在の MissionTask snapshot と一致する
- actor が `mission_pilot` の場合は grant が valid
- MissionTask がまだ queue 済みではない
- idempotency key が過去の conflicting request と衝突していない

MVP では、既存の TaskCandidate to Task conversion と queue admission approval を使う。

### Mission 評価

```http
POST /api/projects/:projectId/missions/:missionId/evaluate
```

### 再計画

```http
POST /api/projects/:projectId/missions/:missionId/replan
```

### Pause / Resume / Abandon

```http
POST /api/projects/:projectId/missions/:missionId/pause
POST /api/projects/:projectId/missions/:missionId/resume
POST /api/projects/:projectId/missions/:missionId/abandon
```

## State Transition

First-Step MVP では、Mission 本体の lifecycle と task-level execution summary を分ける。

Mission 本体の lifecycle は単純に保つ。

```text
draft
  -> active
  -> completed

or

active
  -> paused
  -> active

or

any active state
  -> abandoned / failed
```

`decomposing`、`awaiting_approval`、`queued`、`running`、`blocked` などは、MissionTaskCandidate / MissionTask / Queue / Run / AttentionItem から算出する summary として扱う。

例:

```text
Mission: active
Summary: 1 running · 2 awaiting approval · 1 blocked
```

基本ルール:

- draft では queue に入れない
- approval を通らず code change task を queue に入れない
- executing 中は Mission Pilot が直接 code を変更しない
- evaluating では run / review / test evidence を必ず参照する
- verification failure がある場合は completed にしない
- replan は base plan revision に対する TaskGraph 差分として記録する
- Autopilot grant がない、または revoke 済みの場合は background action を進めない

## Safety Invariants

Mission Pilot の安全性は、次の不変条件として固定する。

```text
1. approvalRequired = true の TaskCandidate / MissionTask は、approval なしに queue に入らない。

2. code change / schema change / public API change / destructive operation は、
   常に approvalRequired = true になる。

3. AutopilotGrant は approvalRequired を上書きしない。

4. Grant が revoked / expired の場合、
   background pilot action は新規に開始されない。

5. Approval の snapshot と現在の TaskCandidate / MissionTask snapshot が一致しない場合、
   enqueue できない。

6. 同じ MissionTask は idempotency key なしに二重 enqueue されない。

7. verification failure がある場合、
   MissionEvaluation は completed を返さない。

8. Mission completion は LLM summary だけでは成立しない。
   objective acceptance criteria と evidence の対応が必要である。

9. Replan は base plan revision に対する diff として保存する。

10. Scope expansion detected の場合、
    Mission Pilot は自動続行せず Attention item を作る。
```

## 1st Step Implementation Phases

### MVP-0: Read-only Mission Cockpit

目的:

既存 Mission Decomposition の状態を Mission Control として読めるようにする。

実装:

- Mission Pilot invariants の文書化
- typed EvidenceRef model
- MissionEvent minimal timeline
- Mission list / detail read API の拡張
- latest planning result / TaskCandidate の cockpit 表示
- `approvalRequired` TaskCandidate の AttentionItem read model
- Mission Detail route

完了条件:

- Project Detail の Mission 画面から Mission の現在地を読める
- latest planning result と TaskCandidate を Mission Detail で確認できる
- `approvalRequired` TaskCandidate が attention item として見える

### MVP-1: Project Evaluation -> Mission -> TaskCandidate -> Approval

目的:

既存の Project Evaluation improvement idea を Mission の入口にし、TaskCandidate を承認または reject できるようにする。

実装:

- improvement idea から Create Mission action
- Mission sourceRef 保存
- immutable sourceSnapshot 保存
- Mission draft generation
- Objective / Non-goals draft generation
- TaskGraph draft generation
- draft result preview
- MissionApproval model
- approval snapshot hash
- Approve / Reject UI
- approvalRequired TaskCandidate の approval UI

完了条件:

- Project Evaluation 画面から Mission を作れる
- improvement idea が Mission sourceRef / sourceSnapshot として残る
- Mission Objective が生成される
- TaskGraph draft が生成される
- TaskCandidate を承認または reject できる

### MVP-2: Approved TaskCandidate -> Queue

目的:

承認済み TaskCandidate だけを実行対象に変換し、既存 Implementation Queue に流す。

実装:

- approved TaskCandidate -> MissionTask conversion
- MissionTask -> NightWorkers Task mapping
- queue enqueue command
- queueEntryId linkage
- runId linkage
- queue status sync
- idempotency guard
- approval snapshot hash validation
- MissionEvent logging for task_created / task_queued

完了条件:

- 未承認 TaskCandidate は queue に入らない
- 承認済み TaskCandidate だけ MissionTask / NightWorkers Task に変換できる
- 承認済み MissionTask から queue entry を作れる
- queue / run status が Mission Detail に表示される
- 同じ MissionTask の二重 enqueue が idempotency で防がれる

### MVP-3: Autopilot Control

目的:

Mission 画面から Level 1 Autopilot を起動、停止、revoke できるようにする。

実装:

- AutopilotControlPanel
- MissionAutopilotGrant
- Start / Pause / Resume / Revoke API
- allowedActions validation
- grant invariant validation
- MissionEvent logging

完了条件:

- Mission Detail から Level 1 Autopilot を起動できる
- grant が保存される
- grant は `approvalRequired` を上書きしない
- grant なしでは background pilot action が進まない
- revoke 後は pilot action が停止する

### MVP-4: Evidence -> MissionEvaluation

目的:

Run 完了後に Review Mode / Test evidence を MissionEvaluation に接続する。

実装:

- run result fetch
- review finding fetch
- test evidence fetch
- typed EvidenceRef
- MissionEvaluation generation
- objective status update

完了条件:

- run 完了後に MissionEvaluation を作れる
- Objective が progressed / blocked / satisfied に更新される
- evidence drawer から根拠を追える
- verification failure 時に completed にならない

### MVP-5: Replan Suggestion

目的:

失敗時に勝手に進まず、再計画案を出す。

実装:

- failed / blocked task detection
- verification failure detection
- MissionPlanRevision
- replan suggestion generation
- TaskGraph diff preview
- baseRevisionId validation
- human approval for replan
- replan event logging

完了条件:

- verification failure 時に completed にならない
- replan suggestion が Attention Inbox に出る
- 承認後に TaskGraph が plan revision diff として更新される
- stale replan は最新 revision に適用されない

## MVP Acceptance Criteria

First-Step MVP が成立したと言える条件:

1. 人間が設定した goal または Project Evaluation improvement idea から Mission を作成できる
2. Mission が Objective / Non-goals / TaskGraph draft を持つ
3. TaskCandidate ごとに riskLevel と approvalRequired がある
4. Attention Inbox が approvalRequired TaskCandidate を表示できる
5. MissionApproval が snapshotHash を持ち、Approve / Reject を記録できる
6. code change task は human approval なしに queue に入らない
7. approval snapshot と current snapshot が一致しない場合は enqueue できない
8. 承認済み TaskCandidate を MissionTask / NightWorkers Task に変換できる
9. 承認済み MissionTask を Implementation Queue に投入できる
10. Queue / Run status が Mission Detail に反映される
11. 同じ MissionTask の二重 enqueue が idempotency で防がれる
12. Mission 画面から Level 1 Autopilot を起動できる
13. Autopilot grant が保存され、revoke できる
14. Autopilot grant は approvalRequired を上書きしない
15. Run / Review / Test evidence を MissionEvaluation が typed EvidenceRef として参照できる
16. MissionEvaluation が Objective progress を更新できる
17. verification failure 時に Mission Pilot が completed にせず stop / replan を提案できる
18. replan は baseRevisionId を持つ plan revision diff として保存される
19. ユーザーが Mission Detail を見れば、現在地、根拠、次の承認点を理解できる

## Testing Plan

### Unit Tests

- Mission status transition
- Autopilot grant validation
- allowedActions validation
- grant does not override approvalRequired
- approvalRequired 判定
- approval snapshot hash calculation
- TaskCandidate -> MissionTask mapping
- MissionTask -> queue task mapping
- MissionEvaluation result calculation
- stop condition detection
- baseRevisionId validation
- replan suggestion creation

### API Tests

- create mission
- create mission from project evaluation improvement
- start / pause / resume / revoke autopilot
- decompose mission
- request approval
- approve TaskCandidate
- reject TaskCandidate
- enqueue approved task
- block enqueue without approval
- block enqueue with stale approval snapshot
- idempotent enqueue returns the same queueEntryId
- evaluate mission
- replan mission
- pause / resume / abandon

### UI Tests

- Mission list renders
- Mission detail renders
- AutopilotControlPanel renders
- Start Autopilot creates grant
- CurrentPilotActionPanel renders
- AttentionInbox shows approval item
- approve action updates state
- rejected candidate is no longer queueable
- EvidenceDrawer opens evidence refs
- TaskGraph status changes are visible

### Integration Tests

- Project Evaluation improvement -> Mission
- Project Evaluation improvement -> Mission -> TaskCandidate
- TaskCandidate approval -> MissionTask -> Queue
- Mission Autopilot start -> grant -> decompose without bypassing approval
- Queue run completion -> MissionEvaluation
- Review finding -> Objective blocked
- Test evidence success -> Objective progressed
- Grant revoke -> Pilot action stops
- stale replan cannot be applied to newer plan revision

### Safety Regression Tests

- code change TaskCandidate cannot be enqueued without approval
- approvalRequired cannot be downgraded by LLM output
- revoked grant prevents new pilot action
- expired grant prevents enqueue
- grant does not override approvalRequired
- approval snapshot mismatch blocks enqueue
- rejected TaskCandidate cannot be converted to MissionTask
- stale replan cannot be applied to newer plan revision
- verification failure prevents mission completion

### Queue Idempotency Tests

- enqueue same MissionTask twice returns same queueEntryId
- concurrent enqueue requests create only one queue entry
- failed enqueue can be retried safely
- queueEntryId remains linked after retry

### Evidence Integrity Tests

- MissionEvaluation with missing evidence returns blocked or no_progress
- review finding with high severity blocks objective satisfaction
- test failure prevents objective satisfied
- test success alone does not satisfy unrelated objective

## Product Success Criteria

MVP の成功は、完全自律性では測らない。

成功指標は次で測る。

- ユーザーが大きな改善目的を Mission として開始できる
- Mission が実行可能な task 群に分解される
- Mission 画面で Autopilot を起動、停止、再開できる
- 危険な task が勝手に実行されない
- 承認済み task が queue に流れる
- 実行結果が evidence に基づいて評価される
- Mission が進んだか、止まったか、再計画すべきか分かる
- ユーザーが常時監視しなくても状況を把握できる
- 将来の認証導入後も、権限と監査の境界を崩さずに拡張できる

## Deferred Questions

First-Step MVP では、次は決めすぎない。

- Level 2 の low-risk auto queue 条件
- 複数 Mission の優先順位付け
- Mission 間の依存関係
- 自己改善 candidate と Autonomous Goals の統合
- ContextStill decision を必須にする状態遷移
- MissionEvaluation を LLM / deterministic / human のどれが主導するか
- 複雑な DAG editor UI
- 認証導入時の具体的な RBAC policy
- grant expiration の既定値

ただし、将来対応できるよう、`riskLevel`、`approvalRequired`、`evidenceRefs`、`PilotAction`、`MissionEvent`、`AutopilotGrant` は MVP から持つ。

## Non-goals

First-Step MVP では、次を扱わない。

- 人間なしで code change を自動承認する
- Worker / Supervisor / Plan mode / Queue を置き換える
- ContextStill を project side effect の実行者にする
- Mission Pilot が NightWorkers UI を Playwright 的に操作して内部進行する
- ユーザーの cookie / browser session を background job が借りる
- LLM の自己申告だけで mission completion を判断する
- 汎用 AGI 的な長期目標管理
- 複数 repo をまたぐ product management
- すべての review finding を task 化する
- 自己改善を自動実行する

## 最初に作るべき Issue / Task

実装を始めるなら、最初の task は次の順がよい。

1. Define Mission Pilot invariants
2. Add typed EvidenceRef model
3. Add MissionEvent minimal timeline
4. Extend Mission detail read model for cockpit
5. Add Mission Detail route under Project Detail
6. Render existing planning results and TaskCandidates in Mission Detail
7. Add MissionAttentionItem read model for approvalRequired TaskCandidates
8. Add Create Mission from Project Evaluation improvement
9. Persist mission sourceRef and immutable sourceSnapshot
10. Generate Objective / Non-goals / TaskGraph draft
11. Add MissionApproval model
12. Wire approvalRequired TaskCandidate into approval UI
13. Add approval snapshot hash validation
14. Convert approved TaskCandidate to MissionTask
15. Map MissionTask to NightWorkers Task
16. Enqueue approved MissionTask with idempotency key
17. Sync queue / run status into Mission Detail
18. Add minimal AutopilotGrant
19. Add Start / Pause / Revoke Level 1 control
20. Generate MissionEvaluation from run / review / test evidence
21. Update Objective status from MissionEvaluation
22. Add Replan suggestion for failed / blocked task

## この更新で固定する判断

この更新では、次を固定する。

1. Goal を設定するのは人間である
2. Mission Pilot は Mission Control であり、実装者ではない
3. First-Step MVP は Level 1 Approved Execution に固定する
4. Autopilot 起動は Mission 画面で行う
5. 実行制御は API-first / service-command-first にする
6. NightWorkers 内部進行を Playwright 的 UI 操作代替にしない
7. 認証導入後は Autopilot grant と actor audit で権限を扱う
8. Autopilot grant は approvalRequired を上書きしない
9. Project Evaluation improvement から Mission を作る入口を優先する
10. `candidate` と `proposal` は同義として扱い、文書上は TaskCandidate に揃える
11. TaskCandidate は承認前の候補、MissionTask は承認後の Mission work item とする
12. TaskGraph は artifact だけでなく TaskCandidate / MissionTask として永続化する
13. UI は chat-first ではなく structured mission cockpit にする
14. Attention Inbox を UX の中心に置く
15. Approval は snapshotHash を持ち、古い承認で新しい内容を実行しない
16. Queue enqueue は idempotency key を持つ
17. Review / Test evidence を typed EvidenceRef として MissionEvaluation に接続する
18. verification failure 時は stop / replan に戻す
19. Replan は base plan revision に対する diff として保存する
20. ユーザーは常時監視しなくてよいが、いつでも現在地と根拠を理解できる
