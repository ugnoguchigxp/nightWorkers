# Mission Decomposition Implementation Plan

## Purpose

Mission Decomposition を実装し、ユーザーの広い goal を Mission、Objective、Work Package、Task、Verification Gate、Replanning Unit に分解したうえで、評価を通過した planning result だけを `review_pending` にする。

この計画は `spec/docs/mission-decomposition-concept.md` の実装計画である。Mission Pilot 全体の orchestration、自己改善ループ、実装後評価、Review rubric の再設計は扱わない。

初期実装の目的は、次の3点に絞る。

- `mission_goals -> mission_task_candidates -> tasks` の中抜き構造を、Mission planning result を経由する形へ変える。
- 低品質な decomposition draft をユーザーの review 待ちへ出さない。
- 評価済み planning result の中に、ユーザーが選んで Task 化できる initial prompt 付き task proposal を作る。

## Confirmed Baseline

現状の実装には次の土台がある。

- `mission_goals` は repository ごとの goal text / preset を保持している。
- `mission_task_candidate_batches` は LLM 生成 batch、signal snapshot、raw output、selected model を保存している。
- `mission_task_candidates` は flat な task candidate を保存し、`goal_id`, `summary`, `rationale`, `evidence`, `importance`, `confidence`, `complexity`, `taskPrompt`, `acceptanceCriteria`, `verificationPlan` を持つ。
- `generateMissionTaskCandidates(...)` は active goal、ProjectEvaluation、Quality Run、recent runs、token usage を `ProjectSignalSnapshot` にまとめ、1回の structured LLM call で flat candidates を生成する。
- `createTasksFromMissionCandidates(...)` は candidate を `tasks` に変換する。
- `createTaskFromMissionCandidate(...)` は candidate の構造情報を `tasks.description`, `tasks.objective`, `tasks.acceptanceCriteria` の text に詰める。
- Implementation Queue にはすでに `executionType`, `executionLockKey`, `sequenceGroupId`, `sequenceOrder`, `sequenceDependsOnEntryId`, `schedulingReason` がある。
- Queue claim logic は `normal`, `exclusive`, `sequence` の scheduling lock と sequence predecessor 判定を持っている。
- Supervisor intake も `scheduling.executionType` を structured metadata として返せる。
- ProjectEvaluation は evidence bundle、structured JSON judge、stored report の実装パターンを持つ。

現状の弱点:

- `mission_goals` は Mission entity ではない。status、non-goals、decomposition lifecycle、planning result を持たない。
- Objective / Work Package / Replanning Unit が存在しない。
- candidate は flat list であり、Work Package 所属、dependencies、risk、approval required、Plan mode handoff が表現できない。
- candidate 生成は schema parse と重複 title check は行うが、Mission Decomposition Evaluation を持たない。
- `review_pending` 相当の planning lifecycle がなく、評価前 draft と review-ready result の境界がない。
- task 変換時に candidate の scheduling / decomposition / traceability information を task 側から追いにくくなる。
- Queue scheduling fields は存在するが、Mission Decomposition の risk / dependency / approval 判定を metadata hint として渡す contract がない。
- ProjectEvaluation は improvement idea と `agentPrompt` を生成し、ユーザーが選択した idea だけを Task 化する境界を持っている。Mission Decomposition もこの境界に合わせる。

## Design Direction

### ProjectEvaluation の improvement flow に合わせる

Mission Decomposition は ProjectEvaluation の improvement idea flow と同じ境界にする。

対応関係:

| ProjectEvaluation | Mission Decomposition |
| --- | --- |
| `project_evaluation_runs` | `mission_planning_results` |
| `project_improvement_ideas` | `mission_task_proposals` |
| `agentPrompt` | `initialPrompt` |
| `expectedOutcome` | `expectedOutcome` |
| `implementationFocus` | `implementationFocus` |
| `createTasksFromProjectImprovements(...)` | `createTasksFromMissionTaskProposals(...)` |
| `project_evaluation_task_links` | `mission_task_proposals.task_id` initially |

Mission Planner は Task を自動作成しない。評価済み proposal を保存し、ユーザーが選択した proposal だけを Task 化する。

### `mission_goals` は Mission に昇格しない

`mission_goals` は repository に紐づく継続的な goal seed として残す。Mission はユーザー goal、selected mission goals、signal snapshot、clarification、decomposition run から作られる個別 planning unit とする。

既存 `mission_goals` に `mission_id` を追加して Objective のように扱うことはしない。Goal seed と Mission Objective は寿命と意味が違うためである。

### 初期 planning result は JSON 正本にする

初期実装では Objective / Work Package / TaskGraph をすべて DB rows に展開しない。まず `mission_planning_results` の JSON を正本にし、deterministic validation、LLM evaluation、task proposal generation を安定させる。

Rows 化は、UI で partial approval、Work Package 単位の再生成、Mission progress 更新が必要になった段階で行う。ただし task proposal は ProjectEvaluation の improvement idea と同じく、選択・Task 化・重複防止のために初期から個別 row として保存してよい。

### Task 化はユーザー判断に委ねる

Mission Planner は Task を自動作成しない。Mission Decomposition の役割は、評価済みの task proposal と、そのまま Worker / Plan mode に渡せる initial prompt を作るところまでである。

Task creation、Queue admission、high-risk approval は、ユーザーが proposal を選んだ後の明示 action とする。

### Mission Planner は独立 module にする

Mission Planner は `api/modules/mission-planner/` に置く。Project detail の既存 Mission Task Candidate generator を直接肥大化させない。

既存 project-detail module は repository detail の UI / metrics / legacy candidate flow を担当し、Mission Planner は decomposition lifecycle、evaluation、task proposal lifecycle を担当する。

### 評価前 draft は `review_pending` にしない

Decomposition LLM が出しただけの result は `draft` または `evaluating` に留める。Deterministic checks と Mission Decomposition Evaluation を通過した result だけを `review_pending` にする。

## Terms

### Mission

ユーザー goal を NightWorkers が扱う planning unit にしたもの。Mission は selected goal seeds、non-goals、status、latest planning result を持つ。

### Mission Planning Result

Mission Decomposition の出力。Mission draft、Objectives、Work Packages、Task Proposals、Verification Gates、Replanning Units、evaluation summary を含む。

初期実装では JSON blob として保存する。

### Task Proposal

ユーザーが Task 化するか判断できる実行候補。ProjectEvaluation の improvement idea と同じく、title、summary、initialPrompt、expectedOutcome、implementationFocus、acceptanceCriteria、verificationGate、risk、approvalRequired、schedulingHint を持つ。

Task Proposal は Task ではない。Queue にも入らない。Task 化するかどうかはユーザーが選ぶ。

### Review Pending

ユーザーに提示してよい planning result。`review_pending` は raw draft ではなく、評価 gate を通り、task proposals が選択可能な状態を指す。

### Task Materialization

ユーザーが選択した task proposal から `tasks` を作る処理。

Task Materialization は proposal の initial prompt を `tasks.objective` に写し、expected outcome / verification gate / scheduling hint を task metadata として保持する。Queue には直接流さない。

## Scope

In scope:

- Mission Planner module を追加する。
- Mission / decomposition run / planning result の DB schema と bootstrap を追加する。
- Mission Decomposition output schema を shared schema として定義する。
- Goal / signal から Mission draft と planning result を生成する structured LLM flow を追加する。
- Deterministic validation を追加する。
- Mission Decomposition Evaluation を追加する。
- `review_pending`, `needs_revision`, `needs_clarification`, `blocked` の lifecycle を追加する。
- Review pending planning result から task proposals を表示・選択できるようにする。
- 選択された task proposal から Task を作成する明示 action を追加する。
- Task 化時に Mission / Work Package / dependency / approval / scheduling traceability を失わない。
- Existing Queue scheduling fields へ渡せる `normal` / `exclusive` / `sequence` hint を proposal / task metadata に保持する。
- Focused backend tests を追加する。

Out of scope:

- Mission Pilot の full orchestration。
- Worker execution の変更。
- Queue processor の scheduling lock 再実装。
- Review rubric の再設計。
- Mission progress の実装後評価。
- ContextStill integration の必須化。
- 初期実装で Objective / Work Package / TaskGraph をすべて正規化 rows にすること。
- Mission UI の詳細設計。
- 複数 Mission 間の優先順位最適化。
- Human approval 後の自動 queue orchestration。
- Evaluation 通過直後に Task や Queue entry を自動生成すること。

## Target Behavior

### Mission creation

- User goal と repository id から Mission を作成できる。
- Optional で既存 `mission_goals` を seed として参照できる。
- Mission は最初 `draft` になる。
- `mission_goals` は変更しない。

### Decomposition

- Mission Planner は `ProjectSignalSnapshot` を再利用し、Mission 用 input bundle を作る。
- Decomposition は1回の giant prompt ではなく、段階を分ける。
- 生成された planning result はまず `draft` として保存する。
- LLM raw output、selected model、input bundle summary を保存する。

### Evaluation gate

- Deterministic checks が先に走る。
- Deterministic checks が fail の場合、LLM evaluation へ進めず `needs_revision` または `blocked` にする。
- Deterministic checks が pass/warning の場合だけ LLM evaluation を実行する。
- Evaluation verdict が `review_ready` の場合だけ planning result を `review_pending` にする。

### Review and gated execution

- 初期実装では review_pending result を dismiss / request_revision できる backend contract と、proposal を選んで Task 化する backend contract を作る。
- `review_pending` は「Task 化可能な proposal をユーザーに提示できる状態」であり、Task 作成済みを意味しない。
- `approvalRequired: true` の proposal は Task 化しても Queue 投入前に明示承認が必要であることを metadata と UI で維持する。

### Task proposal to task materialization

- Task Proposal は initial prompt を持つ。
- ユーザーが proposal を選んだ場合だけ `tasks` を作る。
- 作成される Task の objective は proposal の initial prompt を基準にする。
- expected outcome、implementation focus、acceptance criteria、verification gate は Task の description / acceptance criteria / metadata に保持する。
- Task 作成 mode は ProjectEvaluation と合わせて `ready` を default にし、API request で `draft` も選べる。
- Work Package の `suggestedPlanMode` が true の proposal は、Task objective を plan-first wrapper にする。wrapper 内に proposal の `initialPrompt` を入れ、まず Feature Plan を作ることを明示する。
- `suggestedPlanMode` が false の proposal は、Task objective に `initialPrompt` をそのまま使う。
- Dependency がある proposal group は Queue の `sequenceGroupId` / `sequenceOrder` に変換できる scheduling hint を保持する。
- High-risk または approval required proposal は `exclusive` hint を保持する。
- Queue entry creation は既存 `createImplementationQueueEntry(...)` を使う。Mission Planner は queue processor を直接操作しない。

### Fixed initial implementation decisions

- Mission UI は Project Detail 内の Mission tab から始める。独立 Mission screen は後続。
- Task creation from proposals の default mode は `ready`。
- ContextStill guardrails は初期実装では必須にしない。Phase 2 の input bundle には `contextStillGuardrails: null` を置き、後続で optional data を入れられる形にする。
- Mission-derived scheduling metadata は初期実装では Task message metadata に保存する。専用 task metadata table は作らない。
- Plan mode handoff は proposal の `suggestedPlanMode` / Work Package context から plan-first objective を作る。
- `mission_task_candidates` は legacy flow として残し、Mission Decomposition の新規 flow からは書かない。

## Data Model

### `missions`

```ts
type MissionStatus =
  | 'draft'
  | 'decomposing'
  | 'evaluating'
  | 'needs_clarification'
  | 'review_pending'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'cancelled';

type Mission = {
  id: string;
  repositoryId: string;
  title: string;
  goalText: string;
  nonGoalsJson: string[];
  status: MissionStatus;
  sourceGoalIdsJson: string[];
  latestPlanningResultId: string | null;
  statusReason: string | null;
};
```

Column 方針:

- `repository_id text NOT NULL`
- `title text NOT NULL`
- `goal_text text NOT NULL`
- `non_goals_json text mode json NOT NULL DEFAULT []`
- `status text NOT NULL DEFAULT 'draft'`
- `source_goal_ids_json text mode json NOT NULL DEFAULT []`
- `latest_planning_result_id text`
- `status_reason text`

`latest_planning_result_id` is not a database foreign key in the initial implementation because it points to a table that also references `missions`. The service layer maintains the reference after creating a planning result.

Index:

- `(repository_id, status, created_at)`

### `mission_decomposition_runs`

```ts
type MissionDecompositionRunStatus = 'running' | 'completed' | 'failed';

type MissionDecompositionRun = {
  id: string;
  missionId: string;
  repositoryId: string;
  status: MissionDecompositionRunStatus;
  inputBundleJson: unknown;
  stageOutputsJson: {
    missionDraft: unknown | null;
    structure: unknown | null;
    taskProposals: unknown | null;
    evaluation: unknown | null;
  };
  selectedModelsJson: Array<{
    stage: 'mission_draft' | 'structure' | 'task_proposals' | 'evaluation';
    providerId: string;
    providerEndpointId: string | null;
    routeSource: string | null;
    modelOrDeployment: string | null;
    thinkingDepth: string | null;
  }>;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
};
```

Column 方針:

- `mission_id text NOT NULL`
- `repository_id text NOT NULL`
- `status text DEFAULT 'running' NOT NULL`
- `input_bundle_json text mode json NOT NULL`
- `stage_outputs_json text mode json NOT NULL`
- `selected_models_json text mode json NOT NULL`
- `error_message text`
- `started_at integer NOT NULL`
- `completed_at integer`

One decomposition attempt uses one run row. The staged LLM outputs are stored in `stage_outputs_json` instead of creating separate run rows per stage.

### `mission_planning_results`

```ts
type MissionPlanningResultStatus =
  | 'draft'
  | 'evaluating'
  | 'needs_revision'
  | 'needs_clarification'
  | 'blocked'
  | 'review_pending'
  | 'dismissed'
  | 'archived';

type MissionPlanningResult = {
  id: string;
  missionId: string;
  repositoryId: string;
  decompositionRunId: string;
  status: MissionPlanningResultStatus;
  planningResultJson: MissionDecompositionPlanningResult;
  deterministicChecksJson: MissionDeterministicCheckReport | null;
  evaluationJson: MissionDecompositionEvaluation | null;
  statusReason: string | null;
};
```

### Mission Decomposition Planning Result schema

```ts
type MissionDecompositionPlanningResult = {
  schemaVersion: 'nightworkers.mission-decomposition-result/v1';
  mission: {
    title: string;
    goal: string;
    nonGoals: string[];
  };
  objectives: Array<{
    id: string;
    title: string;
    completionCriteria: string[];
    verificationGate: string[];
  }>;
  workPackages: Array<{
    id: string;
    title: string;
    purpose: string;
    relatedObjectiveIds: string[];
    suggestedPlanMode: boolean;
    risk: 'low' | 'medium' | 'high';
    approvalRequired: boolean;
  }>;
  taskProposals: Array<{
    id: string;
    title: string;
    summary: string;
    purpose: string;
    workPackageId: string;
    dependencies: string[];
    targetFilesOrModules: string[];
    initialPrompt: string;
    expectedOutcome: string;
    implementationFocus: string[];
    acceptanceCriteria: string[];
    verificationGate: string[];
    risk: 'low' | 'medium' | 'high';
    approvalRequired: boolean;
    scheduling: {
      executionType: 'normal' | 'exclusive' | 'sequence';
      reason: string;
      sequenceGroupId: string | null;
      sequenceOrder: number | null;
      dependsOnTaskIds: string[];
    };
  }>;
  replanningUnits: Array<{
    id: string;
    trigger: string;
    scope: 'mission' | 'objective' | 'work_package' | 'task';
    targetId: string | null;
    action: 'split' | 'merge' | 'reorder' | 'ask_human' | 'pause';
  }>;
};
```

### `mission_task_proposals`

ProjectEvaluation の `project_improvement_ideas` と同じ位置づけの table として、Task 化前の実行候補を保存する。

```ts
type MissionTaskProposalStatus = 'proposed' | 'task_created' | 'dismissed';

type MissionTaskProposal = {
  id: string;
  missionId: string;
  planningResultId: string;
  repositoryId: string;
  workPackageId: string;
  decompositionTaskId: string;
  status: MissionTaskProposalStatus;
  title: string;
  summary: string;
  initialPrompt: string;
  expectedOutcome: string;
  implementationFocusJson: string[];
  acceptanceCriteriaJson: string[];
  verificationGateJson: string[];
  dependenciesJson: string[];
  targetFilesOrModulesJson: string[];
  risk: 'low' | 'medium' | 'high';
  approvalRequired: boolean;
  schedulingJson: {
    executionType: 'normal' | 'exclusive' | 'sequence';
    reason: string;
    sequenceGroupId: string | null;
    sequenceOrder: number | null;
    dependsOnTaskIds: string[];
  };
  taskId: string | null;
};
```

Column 方針:

- `mission_id text NOT NULL`
- `planning_result_id text NOT NULL`
- `repository_id text NOT NULL`
- `work_package_id text NOT NULL`
- `decomposition_task_id text NOT NULL`
- `status text DEFAULT 'proposed' NOT NULL`
- `title text NOT NULL`
- `summary text NOT NULL`
- `initial_prompt text NOT NULL`
- `expected_outcome text NOT NULL`
- `implementation_focus_json text mode json NOT NULL`
- `acceptance_criteria_json text mode json NOT NULL`
- `verification_gate_json text mode json NOT NULL`
- `dependencies_json text mode json NOT NULL`
- `target_files_or_modules_json text mode json NOT NULL`
- `risk text NOT NULL`
- `approval_required integer DEFAULT false NOT NULL`
- `scheduling_json text mode json NOT NULL`
- `task_id text`

Index:

- `(mission_id, status, created_at)`
- `(planning_result_id, status)`
- `(task_id)`

`mission_task_candidates` は legacy candidate flow として残す。Mission Decomposition の初期実装では、新しい proposal flow を正本にし、既存 candidate table へ無理に寄せない。

Unique constraints:

- `(planning_result_id, decomposition_task_id)` is unique.
- `task_id` is unique when not null.

Foreign keys:

- `mission_id` references `missions.id` with cascade delete.
- `planning_result_id` references `mission_planning_results.id` with cascade delete.
- `repository_id` references `repositories.id` with cascade delete.
- `task_id` references `tasks.id` with set null.

### Task materialization link

Task への traceability は `mission_task_proposals.task_id` から辿る。将来、Mission UI / progress update で Task 実行履歴を頻繁に query する必要が出たら dedicated link table を追加する。

```ts
type MissionTaskLink = {
  missionId: string;
  planningResultId: string;
  proposalId: string;
  taskId: string;
  workPackageId: string;
};
```

## Decomposition Flow

### Stage 1: Mission draft

Input:

- user goal
- selected `mission_goals`
- repository summary from `ProjectSignalSnapshot`
- latest ProjectEvaluation summary
- latest Quality Run summary

Output:

- Mission title
- normalized goal
- non-goals
- clarification questions if required
- initial risk notes

If required clarification is blocking, Mission becomes `needs_clarification` and no task decomposition runs.

### Stage 2: Structure decomposition

Input:

- Mission draft
- non-goals
- signal snapshot

Output:

- Objectives
- Work Packages
- Replanning Units
- Work Package risk and suggested Plan mode

This stage does not generate implementation tasks yet.

### Stage 3: Task decomposition

Input:

- Mission draft
- one Work Package or small batch of Work Packages
- related Objectives
- signal snapshot

Output:

- Task proposals
- initial prompts
- expected outcomes
- implementation focus
- dependencies
- verification gates
- approval required
- scheduling hints

Task decomposition can be retried per Work Package without regenerating the full Mission.

## Deterministic Checks

Run deterministic checks before LLM evaluation.

Checks:

- `objective_count_bounds`: 1-8 Objectives.
- `work_package_count_bounds`: 1-10 Work Packages.
- `task_proposal_count_bounds`: 1-20 Task Proposals per planning result, 1-8 Task Proposals per Work Package.
- `work_package_references`: every proposal references an existing Work Package.
- `objective_references`: every Work Package references at least one existing Objective.
- `initial_prompt_required`: every proposal has a non-empty initial prompt suitable for Task creation.
- `expected_outcome_required`: every proposal has an expected outcome.
- `verification_gate_required`: every Objective, Work Package, and Task Proposal has at least one gate or explicit manual confirmation.
- `dependency_references`: dependencies reference existing proposal ids.
- `dependency_cycle`: dependencies do not form a cycle.
- `sequence_consistency`: sequence proposals have group id and order; same group has no duplicate order.
- `approval_required_for_high_risk`: high-risk proposals and destructive/data-migration-like proposals are approval required.
- `scheduling_consistency`: approval-required high-risk proposals are not `normal`.
- `duplicate_titles`: Mission-level duplicate proposal titles are rejected or warninged.

Result:

```ts
type MissionDeterministicCheckReport = {
  status: 'pass' | 'warning' | 'fail';
  checks: Array<{
    key: string;
    status: 'pass' | 'warning' | 'fail';
    message: string;
    targetId: string | null;
  }>;
};
```

Failing structural checks produce `needs_revision`. Missing repository access or contradictory input produces `blocked`.

## Mission Decomposition Evaluation

LLM evaluation runs only after deterministic checks.

Evaluation input:

- Mission row.
- Full `MissionDecompositionPlanningResult`.
- Deterministic check report.
- Compact Project signal snapshot.
- Existing proposal/task title summary for duplicate awareness.

Evaluation rules:

- The evaluator judges the existing planning result. It must not invent replacement proposals.
- Structural failures already caught by deterministic checks stay deterministic; the evaluator only records qualitative concerns and course corrections.
- A result cannot become `review_pending` unless deterministic checks are `pass` or `warning` and the evaluation verdict is `review_ready` or `needs_human_approval`.
- `mission_task_proposals` rows are created only after this gate passes.

Evaluation dimensions:

- `goal_alignment`
- `decomposition_quality`
- `dependency_soundness`
- `verification_readiness`
- `risk_control`
- `replanning_readiness`
- `plan_mode_fit`

Schema:

```ts
type MissionDecompositionEvaluation = {
  schemaVersion: 'nightworkers.mission-decomposition-evaluation/v1';
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
    suggestedCorrection: string | null;
  }>;
  courseCorrections: Array<{
    target:
      | 'mission'
      | 'objective'
      | 'work_package'
      | 'task_proposal'
      | 'verification_gate'
      | 'replanning_unit';
    targetId: string | null;
    action:
      | 'clarify'
      | 'split'
      | 'merge'
      | 'reorder'
      | 'add_gate'
      | 'mark_approval_required'
      | 'pause';
    reason: string;
  }>;
};
```

Verdict mapping:

- `review_ready` -> planning result `review_pending`
- `needs_clarification` -> Mission `needs_clarification`, result `needs_clarification`
- `needs_redecomposition` -> result `needs_revision`
- `needs_human_approval` -> result `review_pending`, but approval-required proposals must remain visibly gated before queue admission
- `blocked` -> Mission and result `blocked`

## Task Proposal Flow

Task proposals are created in the same transaction that moves a planning result to `review_pending`.

### Proposal creation

For each decomposition task proposal:

- create or update `mission_task_proposals`
- preserve `mission_id`, `planning_result_id`, `work_package_id`, `decomposition_task_id`
- store `initialPrompt`, `expectedOutcome`, `implementationFocus`, `acceptanceCriteria`, `verificationGate`
- store dependencies, risk, approvalRequired, scheduling hint as structured JSON

Task proposal statuses:

- `proposed`: user can select it for Task creation.
- `task_created`: a Task has been created from this proposal.
- `dismissed`: user dismissed the proposal.

### Task materialization

When converting selected proposals to tasks:

- task title remains proposal title
- task objective uses proposal `initialPrompt`
- task description includes summary, source Mission, Work Package, expected outcome, implementation focus, risk, and dependencies
- task acceptance criteria includes proposal acceptance criteria and verification gate
- task message metadata stores Mission traceability, proposal id, approvalRequired, and scheduling hint
- proposal is marked `task_created` and linked to the created task

### Queue scheduling handoff

When the task is later queued, existing queue creation must prefer scheduling metadata in task messages.

Mapping:

- `risk: high` or `approvalRequired: true` -> `exclusive` unless a sequence dependency requires `sequence`
- dependency chain inside one Work Package -> `sequence`
- no special risk/dependency -> `normal`
- `sequenceGroupId` is stable per planning result + Work Package.
- `sequenceOrder` follows topological order within that group.

Mission Planner does not bypass queue approval. It only provides metadata that existing Queue code can consume.

## API Surface

Initial routes:

- `POST /api/repositories/:repositoryId/missions`
- `GET /api/repositories/:repositoryId/missions`
- `GET /api/missions/:missionId`
- `POST /api/missions/:missionId/decompose`
- `GET /api/missions/:missionId/planning-results`
- `POST /api/mission-planning-results/:resultId/evaluate`
- `POST /api/mission-planning-results/:resultId/request-revision`
- `GET /api/mission-planning-results/:resultId/task-proposals`
- `POST /api/mission-task-proposals/:proposalId/dismiss`
- `POST /api/mission-task-proposals/create-tasks`

Route responses must use shared schemas. Route handlers stay thin and delegate lifecycle logic to Mission Planner service.

Request / response contracts:

```ts
type CreateMissionRequest = {
  title?: string;
  goalText: string;
  nonGoals?: string[];
  sourceGoalIds?: string[];
};

type DecomposeMissionRequest = {
  force?: boolean;
};

type RequestMissionPlanningRevisionRequest = {
  reason: string;
};

type CreateTasksFromMissionTaskProposalsRequest = {
  proposalIds: string[];
  mode?: 'draft' | 'ready'; // default: ready
};

type CreateTasksFromMissionTaskProposalsResponse = {
  tasks: Task[];
  proposals: MissionTaskProposal[];
};
```

`POST /api/missions/:missionId/decompose` runs decomposition and evaluation in the same initial implementation path. A separate `evaluate` route exists for retrying evaluation after a stored draft, but the normal user action is one decompose action that either produces `review_pending`, `needs_revision`, `needs_clarification`, or `blocked`.

Task creation errors:

- 404 if any proposal does not exist.
- 400 if selected proposals belong to different repositories.
- 400 if a proposal is already `task_created`.
- 400 if a proposal status is `dismissed`.
- 409 if a proposal requires human approval and the request attempts future queue admission. Initial Task creation does not queue, so approval-required proposals may still create draft/ready Tasks with blocking metadata.

## Implementation File Map

Add these files:

- `shared/schemas/mission-planner.schema.ts`
- `api/db/mission-planner-schema.ts`
- `api/modules/mission-planner/mission-planner.repository.ts`
- `api/modules/mission-planner/mission-planner.service.ts`
- `api/modules/mission-planner/mission-planner.routes.ts`
- `api/modules/mission-planner/mission-planner.prompts.ts`
- `api/modules/mission-planner/mission-planner-validation.ts`
- `api/modules/mission-planner/mission-planner-evaluation.service.ts`
- `tests/mission-planner-schema.test.ts`
- `tests/mission-planner-validation.test.ts`
- `tests/mission-planner-service.test.ts`
- `tests/mission-planner-routes.test.ts`

Modify these files:

- `api/db/bootstrap.ts`: create/backfill new Mission Planner tables.
- `api/db/schema.ts` or the existing DB schema export surface: expose Mission Planner tables to the repository layer.
- API router registration file: mount `missionPlannerRouter`.
- `api/modules/project-detail/project-detail.service.ts`: replace the private signal builder with an import.
- `api/modules/project-detail/project-signal-snapshot.service.ts`: export `buildProjectSignalSnapshot(...)` for both project-detail and mission-planner.
- `api/modules/queue/queue-management.service.ts`: read Mission proposal scheduling metadata from Task messages before falling back to Supervisor intake metadata.
- `shared/schemas/nightworkers.schema.ts` only if Task message metadata needs a shared typed payload.

Do not modify these in the initial slice unless tests prove it is necessary:

- existing `mission_task_candidates` schema.
- existing ProjectEvaluation tables/routes.
- Queue claim logic.

## Service Boundary

Mission Planner service exposes these functions:

```ts
type MissionPlannerService = {
  createMission(input: CreateMissionInput): Promise<Mission>;
  listMissions(repositoryId: string): Promise<Mission[]>;
  getMissionDetail(missionId: string): Promise<MissionDetail>;
  decomposeMission(input: { missionId: string; force?: boolean }): Promise<MissionDetail>;
  requestPlanningRevision(input: {
    planningResultId: string;
    reason: string;
  }): Promise<MissionPlanningResult>;
  listTaskProposals(planningResultId: string): Promise<MissionTaskProposal[]>;
  dismissTaskProposal(proposalId: string): Promise<MissionTaskProposal>;
  createTasksFromMissionTaskProposals(input: {
    proposalIds: string[];
    mode: 'draft' | 'ready';
  }): Promise<{ tasks: Task[]; proposals: MissionTaskProposal[] }>;
};
```

Repository functions stay thin and map rows through shared schemas. Service functions own lifecycle decisions, validation, LLM calls, and transaction boundaries.

## Status Transitions

Mission status transitions:

```text
draft -> decomposing
decomposing -> evaluating
evaluating -> review_pending
evaluating -> needs_clarification
evaluating -> blocked
review_pending -> active
review_pending -> blocked
active -> completed
active -> blocked
blocked -> decomposing
```

Initial implementation only needs to drive through `draft`, `decomposing`, `evaluating`, `review_pending`, `needs_clarification`, and `blocked`. `active` is set when at least one proposal has produced a Task.

Planning result status transitions:

```text
draft -> evaluating
evaluating -> review_pending
evaluating -> needs_revision
evaluating -> needs_clarification
evaluating -> blocked
review_pending -> dismissed
review_pending -> archived
needs_revision -> archived
```

Task proposal status transitions:

```text
proposed -> task_created
proposed -> dismissed
```

No transition moves a `task_created` proposal back to `proposed`.

## Task Creation Contract

Task creation from a proposal uses this mapping:

```ts
type MissionProposalTaskMetadata = {
  source: 'mission_task_proposal';
  missionId: string;
  planningResultId: string;
  proposalId: string;
  workPackageId: string;
  decompositionTaskId: string;
  dependencies: string[];
  risk: 'low' | 'medium' | 'high';
  approvalRequired: boolean;
  scheduling: {
    executionType: 'normal' | 'exclusive' | 'sequence';
    reason: string;
    sequenceGroupId: string | null;
    sequenceOrder: number | null;
    dependsOnTaskIds: string[];
  };
};
```

Task fields:

- `tasks.title`: proposal title.
- `tasks.description`: proposal summary, Mission id, Work Package title/id, expected outcome, implementation focus, risk, dependency list.
- `tasks.objective`: plan-first wrapper if the Work Package has `suggestedPlanMode: true`; otherwise proposal `initialPrompt`.
- `tasks.acceptanceCriteria`: acceptance criteria followed by explicit verification gate.
- `tasks.status`: request `mode`, default `ready`.
- `tasks.createdBy`: `mission-task-proposal`.

Task message:

- Add one system message after task creation.
- `payloadJson.source` is `mission_task_proposal`.
- `payloadJson.missionProposal` contains `MissionProposalTaskMetadata`.

Queue metadata handoff reads this task message metadata before Supervisor intake metadata. If both exist, Mission proposal metadata wins because it is attached to the reviewed proposal selected by the user.

## Initial Prompt Shape

Each proposal `initialPrompt` must be a Japanese instruction that a Worker or Plan mode session can use directly.

Required sections in the prompt text:

- `目的`: what this proposal accomplishes.
- `対象範囲`: target files/modules or the discovery scope.
- `非目標`: what not to change.
- `実装方針`: concrete implementation guidance.
- `完了条件`: observable acceptance criteria.
- `検証`: focused verification commands or manual checks.
- `注意点`: risk, approval, dependency, or sequencing notes.

When `suggestedPlanMode` is true, Task materialization wraps the prompt:

```text
この Mission proposal は、まず実装計画を作成してください。
Plan 完了後に Implementation Queue へ入れて実装する前提で、Queue 実行者が迷わない粒度にしてください。

[Mission proposal initial prompt]
...
```

When `suggestedPlanMode` is false, the initial prompt is used directly.

## UI Surface

Initial UI is intentionally narrow.

Minimum initial UI:

- Mission list in project detail or a dedicated Mission tab.
- Mission detail showing status, goal, non-goals, latest planning result.
- Review pending planning result with Objectives, Work Packages, Task Proposals, initial prompts, gates, risk, approval flags.
- Proposal selection UI similar to ProjectEvaluation improvement ideas.
- Actions: decompose, request revision, dismiss proposal, create Tasks from selected proposals.

Out of initial UI:

- Drag-and-drop TaskGraph editing.
- Partial Work Package approval.
- Mission progress dashboard.
- Automatic queue orchestration controls.
- Automatic Task creation immediately after evaluation.

## Phases

### Phase 1: Data model and schemas

Deliverables:

- Add `missions`, `mission_decomposition_runs`, `mission_planning_results`, `mission_task_proposals`.
- Add bootstrap compatibility for new tables.
- Add shared schemas for Mission, planning result, deterministic check report, evaluation.
- Add repository functions and mapping tests.

Verification:

- focused schema/repository tests.
- `bunx vitest run` targeted tests.

### Phase 2: Decomposition service

Deliverables:

- Add `api/modules/mission-planner/`.
- Move `buildProjectSignalSnapshot(...)` to `api/modules/project-detail/project-signal-snapshot.service.ts` and reuse it from Project Detail and Mission Planner.
- Implement Mission draft / structure / task decomposition prompt builders.
- Store raw output, selected model, and planning result.
- Keep prompt text in Japanese.

Verification:

- prompt schema fixture tests.
- service tests with mocked structured LLM.

### Phase 3: Deterministic validation and evaluation

Deliverables:

- Implement deterministic checks.
- Implement Mission Decomposition Evaluation LLM call.
- Persist check/evaluation reports.
- Add status transitions to `review_pending`, `needs_revision`, `needs_clarification`, `blocked`.

Verification:

- cycle detection tests.
- missing gate tests.
- high-risk approval tests.
- mocked evaluation verdict transition tests.

### Phase 4: Task proposals and Task materialization

Deliverables:

- Persist proposals when planning result becomes `review_pending`.
- Add proposal list/dismiss APIs.
- Add explicit Task creation API from selected proposals.
- Preserve scheduling metadata through proposal -> task conversion using task message metadata.
- Keep legacy candidate flow working.

Verification:

- proposal persistence tests.
- proposal -> task traceability tests.
- legacy `generateMissionTaskCandidates` tests stay green.

### Phase 5: Queue metadata handoff

Deliverables:

- Make queue creation prefer Mission proposal scheduling metadata when present.
- Ensure sequence group/order from Mission proposals maps to existing queue fields after Task creation.
- Ensure approval-required tasks cannot be auto-queued without explicit approval metadata.
- Add health/evidence messages that explain Mission-derived scheduling.

Verification:

- queue creation tests for normal/exclusive/sequence.
- approval-required blocking tests.
- existing scheduling lock tests stay green.

### Phase 6: Minimal UI

Deliverables:

- Mission list/detail.
- Planning result review panel.
- Proposal cards with initial prompt preview and selection.
- Request revision/dismiss proposal/create selected Tasks actions.
- Link created tasks back to Mission proposals.

Verification:

- render tests for empty/draft/review_pending/blocked states.
- route integration tests.

## Migration Strategy

- Existing `mission_goals` rows are not migrated into Missions.
- Existing `mission_task_candidates` remain valid legacy candidates.
- New Mission Planner flow writes new Mission rows and planning results.
- New Mission Planner flow writes `mission_task_proposals`, not legacy candidates.
- Existing candidate routes continue to list old candidates.
- UI distinguishes legacy candidates from Mission-derived proposals.

## Testing Strategy

Focused tests:

- schema parse tests for planning result and evaluation.
- repository CRUD tests for Mission tables.
- deterministic validation tests.
- mocked LLM decomposition service tests.
- evaluation verdict transition tests.
- task proposal persistence tests.
- proposal -> task materialization tests.
- queue scheduling metadata handoff tests.

Regression tests:

- existing project detail backend tests.
- existing implementation queue scheduling lock tests.
- existing supervisor schema-first tests if scheduling metadata handling changes.

Final gate:

- targeted tests for changed modules first.
- `bun run verify:fast` or repo-native verify gate if the touched surface is broad.

## Risks and Mitigations

### Risk: JSON planning result becomes an unqueryable dumping ground

Mitigation: keep schema strict, add deterministic validation, and add rows only when a query/use case proves the need.

### Risk: LLM self-evaluation rubber-stamps its own decomposition

Mitigation: deterministic checks run first; LLM evaluation handles qualitative axes only. Structural correctness is not left to the judge model.

### Risk: `mission_goals` and Mission semantics blur

Mitigation: treat `mission_goals` only as source goal seeds. Do not add `mission_id` to `mission_goals` in the initial implementation.

### Risk: Queue scheduling is duplicated

Mitigation: Mission Planner only produces scheduling hints on proposals and task metadata. Existing Queue code remains the scheduling authority.

### Risk: Plan mode handoff is designed too early

Mitigation: initial implementation records `suggestedPlanMode` and Work Package context, but does not redesign Plan mode inputs until proposal review and Task creation flow is proven.

### Risk: Task proposals are mistaken for executable tasks

Mitigation: use separate `mission_task_proposals` naming, do not enqueue proposals, and require explicit user action before Task creation.

## Deferred Work

The initial implementation intentionally defers these items:

- Dedicated Mission screen outside Project Detail.
- Required ContextStill guardrails for every decomposition.
- Dedicated task metadata table for Mission-derived scheduling metadata.
- Partial Work Package approval.
- Work Package level regeneration UI.
- Mission progress calculation from completed runs.
- Automatic queue admission after Task creation.
- Multi-Mission priority scheduling.

## Acceptance Criteria

The implementation is complete for this plan when:

1. A repository can create a Mission from a broad goal.
2. Mission Planner can generate a structured planning result with Objectives, Work Packages, Task Proposals, Verification Gates, and Replanning Units.
3. Deterministic validation rejects structurally broken planning results.
4. Mission Decomposition Evaluation gates `review_pending`.
5. Raw draft decomposition is never marked `review_pending`.
6. Review pending planning result exposes task proposals with initial prompts.
7. User-selected proposals can create Tasks without losing Mission / Work Package traceability.
8. Mission-derived risk/dependency scheduling hints can be handed to existing Queue metadata after Task creation.
9. Legacy Mission Goal / Mission Task Candidate flow still works.
10. Focused tests cover schema, validation, evaluation transition, proposal persistence, Task materialization, and queue handoff.
