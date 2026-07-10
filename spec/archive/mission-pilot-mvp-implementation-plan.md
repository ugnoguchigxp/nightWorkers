# Mission Pilot MVP Implementation Plan

## Status

superseded-by-mission-pilot-mvp-remaining-work

## Purpose

Mission Pilot MVP を、既存の Mission Decomposition / TaskCandidate / Implementation Queue / Review / Test evidence の上に追加する。

この計画書は、`Mission Pilot` を「実装者」ではなく、Mission 全体を制御する Mission Control として実装するための作業単位、DB/API/UI 契約、検証条件を定義する。

MVP の目標は完全自律ではない。

MVP の目標は、次の一周を安全に通すことである。

```text
Human-set goal or Project Evaluation improvement
  -> Mission
  -> Objective / TaskCandidate
  -> Human approval
  -> MissionTask / NightWorkers Task
  -> Implementation Queue
  -> Worker Run
  -> Review / Test evidence
  -> MissionEvaluation
  -> Complete / Replan / Pause
```

## Locked Decisions

初期実装で再判断しない決定事項:

- ゴールを設定するのは人間である。
- Mission Pilot は Mission Control であり、Worker ではない。
- First-Step MVP は Level 1: Approved Execution に固定する。
- Mission Pilot は code change task を自動承認しない。
- Autopilot 起動は Mission 画面で行う。
- Mission Pilot の主経路は API-first / service-command-first にする。
- Playwright のような UI 操作代替は、Mission 進行の主経路にしない。
- 認証導入後も、Mission Pilot はユーザーの browser session / cookie を借りて background 実行しない。
- Autopilot 起動時は backend に明示的な grant を保存し、background action は grant と actor audit に紐づける。
- `candidate` と `proposal` は同義として扱う。
- ユーザー向け概念名は `TaskCandidate` に揃える。
- 既存 DB table 名 `mission_task_proposals` は互換保存先として残してよい。
- TaskCandidate は「案」、MissionTask は「承認済みの Mission 内 work item」として分ける。
- Queue は実行レーンであり、Mission Pilot は Queue の代替ではない。
- Mission completion は LLM の自己申告だけで判断しない。
- MissionEvaluation は run / review / test evidence を参照する。
- verification failure がある場合、Mission を `completed` にしない。
- replan は既存 TaskGraph に対する差分として保存する。

## Current Baseline

既存実装で使える土台:

- `api/db/mission-planner-schema.ts`
  - `missions`
  - `mission_decomposition_runs`
  - `mission_planning_results`
  - `mission_task_proposals`
- `shared/schemas/mission-planner.schema.ts`
  - Mission / planning result / task proposal の Zod schema
  - risk / approvalRequired / verificationGate / scheduling metadata
- `api/modules/mission-planner/mission-planner.routes.ts`
  - `POST /repositories/:repositoryId/missions`
  - `GET /repositories/:repositoryId/missions`
  - `POST /repositories/:repositoryId/missions/generate-candidates`
  - `GET /missions/:missionId`
  - `POST /missions/:missionId/decompose`
  - `GET /missions/:missionId/planning-results`
  - `POST /mission-planning-results/:resultId/evaluate`
  - `POST /mission-planning-results/:resultId/request-revision`
  - `GET /mission-planning-results/:resultId/task-proposals`
  - `GET /repositories/:repositoryId/mission-task-proposals`
  - `POST /mission-task-proposals/:proposalId/dismiss`
  - `POST /mission-task-proposals/create-tasks`
- `api/modules/mission-planner/mission-planner.service.ts`
  - Mission draft generation
  - Mission decomposition
  - task proposal generation
  - planning result evaluation
  - TaskCandidate to Task conversion
- `api/modules/queue/queue-management.service.ts`
  - Mission proposal metadata detection
  - `approvalRequired` proposal の queue admission guard
  - `approveMissionProposal` option による明示承認 message の追加
  - mission scheduling metadata の queue execution type 反映
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
  - Project Detail `Mission` tab
  - Mission / Goal / TaskCandidate tree
  - Mission decomposition action
  - TaskCandidate selection -> task creation
- `src/modules/nightworkers/components/project-detail/ProjectDetailMissionTree.tsx`
  - Mission / candidate tree UI
- `tests/project-detail-backend/mission-evidence.cases.ts`
  - Project Detail Mission evidence 周辺の backend test

Project Evaluation 側の既存入口:

- `api/db/project-evaluation-schema.ts`
  - `project_evaluation_runs`
  - `project_improvement_ideas`
  - `project_improvement_idea_score_impacts`
  - `project_evaluation_task_links`
- `api/modules/project-evaluation/project-evaluation.routes.ts`
  - `GET /repositories/:id/evaluations`
  - `GET /repositories/:id/evaluations/latest`
  - `POST /repositories/:id/evaluations`
  - `POST /repositories/:id/evaluations/start`
  - `GET /project-evaluations/:evaluationId`
  - `GET /project-evaluations/:evaluationId/improvements`
  - `POST /project-evaluations/:evaluationId/improvements`
  - `POST /project-evaluations/:evaluationId/tasks`

Queue 側の既存入口:

- `POST /implementation-queue/entries`
  - body は `taskId` と optional `approveMissionProposal` を受け取る。
  - Mission Pilot MVP では、この既存 admission route を通す。
  - Mission Pilot 専用の queue bypass route は作らない。

現状の不足:

- Mission Control cockpit としての Mission Detail が薄い。
- MissionEvent timeline が永続化されていない。
- MissionApproval が独立した approval record になっていない。
- Attention Inbox がない。
- MissionTask が TaskCandidate と NightWorkers Task の中間 work item として永続化されていない。
- Autopilot grant / actor audit がない。
- Queue / Run / Review / Test evidence から MissionEvaluation を作る流れがない。
- verification failure 時の ReplanSuggestion が Mission 状態に接続されていない。
- Project Evaluation improvement idea から Mission を作る導線が Mission Pilot の主入口として固まっていない。

## Review Findings Applied

この実装計画は、次のリスクを避ける形で進める。

1. 最初の PR で orchestration / approval / autopilot / evidence をまとめて入れない。
2. まず read-only Mission Detail を作り、既存 Mission Planner / Queue / Project Detail state を cockpit として見えるようにする。
3. TaskCandidate / proposal の用語差で UI と DB を二重実装しない。
4. Project Evaluation improvement から Mission を作る入口は、既存 `project_improvement_ideas` と `project_evaluation_runs` を source of truth にする。
5. Queue 投入は既存 `POST /implementation-queue/entries` と `approveMissionProposal` guard を通し、Mission Pilot 専用 bypass を作らない。
6. Autopilot は grant を持つ backend command として実装し、UI click automation や browser session 依存にしない。
7. MissionEvaluation は `task_runs`、`task_events`、Review Mode、Verification evidence の既存 record を読むところから始める。
8. 新規 DB table は phase ごとに追加し、read model が missing rows を許容するようにする。

## Target MVP Flow

MVP で成立させる主経路:

```text
1. User runs Project Evaluation.
2. User selects an improvement idea.
3. User clicks Create Mission.
4. Backend creates Mission with source = project_evaluation.
5. Mission Pilot decomposes Mission into objectives and TaskCandidates.
6. Mission Detail shows TaskCandidates, risk, approvalRequired, verificationGate.
7. User approves selected TaskCandidates.
8. Backend creates MissionApproval and MissionEvent.
9. Approved TaskCandidate becomes MissionTask / NightWorkers Task.
10. User or Level 1 Autopilot enqueues the approved MissionTask.
11. Queue creates worker run.
12. Mission Detail syncs queued / running / completed state.
13. Mission Pilot evaluates run / review / test evidence.
14. MissionEvaluation updates Objective progress.
15. If passed, Mission progresses or completes.
16. If failed, Mission Pilot creates ReplanSuggestion and AttentionItem.
```

Secondary paths allowed in MVP:

- user-set free-form Mission goal -> Mission -> decomposition
- existing Mission tab -> Mission Detail
- manual pause / resume / abandon

MVP で扱わない主経路:

- low-risk task の自動 queue admission
- human approval なしの code change 実行
- multiple Mission priority optimization
- UI 操作代替による Mission progress
- self-improvement の自動実行

## Architecture Boundaries

### Mission Pilot Service

新しい service layer を追加する。

候補:

```text
api/modules/mission-pilot/
  mission-pilot.routes.ts
  mission-pilot.service.ts
  mission-pilot.repository.ts
  mission-pilot-read-model.ts
  mission-pilot-evaluation.ts
  mission-pilot-replan.ts
  mission-pilot-autopilot.ts
```

責務:

- Mission Detail read model を組み立てる。
- MissionEvent を追記する。
- Approval / AttentionItem を作成、解決する。
- TaskCandidate approval snapshot を保存する。
- MissionTask を作成する。
- approved MissionTask を Queue に投入する。
- Queue / Run / Review / Test evidence を MissionEvaluation に接続する。
- ReplanSuggestion を作成する。
- Autopilot grant を検証する。

既存 `mission-planner` module の責務は維持する。

`mission-planner` は Mission decomposition / TaskCandidate generation の source として扱い、Mission Pilot はそれを Mission Control workflow に接続する。

### Vertical Slice Rule

MVP は、次の順で vertical slice を太くする。

```text
read-only state cockpit
  -> source-linked Mission creation
  -> approval and attention
  -> queue integration
  -> autopilot grant
  -> evidence evaluation
  -> replan
```

実装開始直後に background automation を入れない。
最初の PR は、既存 Mission / TaskCandidate / Queue 状態を Mission Detail で説明できる read-only surface までに絞る。

各 phase は、前 phase の read model と event log を壊さない additive change として実装する。

### UI Boundary

Mission Control UI は backend command を呼ぶだけにする。

UI が直接行ってはいけないこと:

- approvalRequired の bypass
- raw TaskCandidate から直接 queue admission
- run / review / test evidence の自己判定
- Autopilot の local-only state 保持
- browser session を使った background operation

UI が行うこと:

- Mission Detail read model の表示
- AttentionItem の action 実行
- approval / reject / request replan / pause / resume / abandon command の送信
- evidence drawer の参照表示
- Autopilot grant の開始 / pause / resume / revoke

### Queue Boundary

Queue 側には、Mission Pilot 用の bypass を作らない。

MissionTask enqueue は、既存 queue admission guard を利用し、追加で MissionApproval / snapshot / idempotency を検証する。

Queue entry には Mission 由来 metadata を残す。

```ts
type MissionQueueMetadata = {
	source: "mission_pilot";
	missionId: string;
	missionTaskId: string;
	taskCandidateId: string;
	approvalId: string;
	approvalSnapshotHash: string;
	autopilotGrantId?: string;
};
```

Initial implementation note:

- 既存 `POST /implementation-queue/entries` は request body として `taskId` と `approveMissionProposal` だけを受ける。
- Mission metadata を queue entry に直接保存する前に、既存 task message metadata の `missionProposal` / `missionProposalApproval` を source として read model を作る。
- queue entry への Mission Pilot metadata 拡張は Phase 4 の後半に分ける。

## Data Model Plan

### Existing Tables Kept

`missions` は既存のまま拡張する。

追加候補:

- `source`
- `source_ref_id`
- `autonomy_level`
- `paused_at`
- `abandoned_at`
- `completed_at`
- `latest_evaluation_id`

`mission_task_proposals` は TaskCandidate 保存先として使い続ける。

文書、UI、API response では `TaskCandidate` と呼ぶ。
DB table 名や既存 route 名に `proposal` が残ることは許容する。

### New Table: mission_objectives

Purpose:

Mission objective を structured state として保存する。

Columns:

```text
id
mission_id
repository_id
source_planning_result_id
external_objective_id
title
description
acceptance_criteria_json
verification_signals_json
status
evidence_refs_json
status_reason
created_at
updated_at
```

Initial statuses:

```text
pending
progressed
satisfied
blocked
failed
deferred
```

Creation:

- `MissionDecompositionPlanningResult.objectives` から upsert する。
- `external_objective_id` は LLM output の objective id を保存する。

### New Table: mission_tasks

Purpose:

承認済み TaskCandidate を Mission 内の実行対象として保存する。

Columns:

```text
id
mission_id
repository_id
objective_id
task_candidate_id
nightworkers_task_id
queue_entry_id
run_id
review_id
test_evidence_id
latest_evaluation_id
title
purpose
kind
status
risk_level
approval_required
approval_id
approval_snapshot_hash
depends_on_json
verification_gate_json
scheduling_json
created_at
updated_at
```

Statuses:

```text
approved
queued
running
completed
blocked
failed
deferred
cancelled
```

Rules:

- MissionTask は approved TaskCandidate からだけ作る。
- TaskCandidate が変更されたら既存 approval snapshot は stale になる。
- 同じ TaskCandidate から active MissionTask を重複作成しない。

### New Table: mission_approvals

Purpose:

Mission execution-bound decision を独立 record にする。

Columns:

```text
id
mission_id
repository_id
target_type
target_id
approval_type
status
risk_level
approval_required
requested_reason
requested_by_actor_json
decided_by_actor_json
decision_reason
snapshot_json
snapshot_hash
created_at
decided_at
updated_at
```

Target types:

```text
task_candidate
mission_task
replan_suggestion
scope_expansion
accepted_risk
autopilot_grant
```

Approval types:

```text
queue_admission
replan
scope_change
accepted_risk
autopilot_start
```

Statuses:

```text
requested
approved
rejected
stale
cancelled
expired
```

Snapshot requirements:

- target title
- target prompt / purpose
- acceptance criteria
- verification gate
- risk level
- approvalRequired
- scheduling
- target file/module hints
- relevant objective ids

### New Table: mission_events

Purpose:

Mission timeline の source of truth。

Columns:

```text
id
mission_id
repository_id
task_id
event_type
summary
actor_json
payload_json
evidence_refs_json
created_at
```

Event types:

```text
mission_created
mission_decomposed
objective_created
task_candidate_created
approval_requested
approval_granted
approval_rejected
mission_task_created
task_queued
run_started
run_completed
review_completed
test_evidence_added
mission_evaluated
replan_created
replan_approved
mission_paused
mission_resumed
mission_abandoned
mission_completed
mission_failed
autopilot_started
autopilot_paused
autopilot_revoked
```

### New Table: mission_attention_items

Purpose:

ユーザー判断が必要な状態を inbox として保存する。

Columns:

```text
id
mission_id
repository_id
task_id
type
status
title
summary
severity
action_schema_json
evidence_refs_json
source_event_id
created_at
resolved_at
updated_at
```

Types:

```text
approval_required
human_question
verification_failed
review_finding_requires_decision
replan_approval_required
task_blocked
scope_expansion_detected
grant_expired
```

Actions:

```text
approve
reject
request_replan
pause_mission
mark_accepted_risk
open_evidence
revoke_grant
```

### New Table: mission_autopilot_grants

Purpose:

Level 1 Autopilot の backend authorization。

Columns:

```text
id
mission_id
repository_id
user_id
autonomy_level
allowed_actions_json
approval_policy_id
status
expires_at
revoked_at
created_at
updated_at
```

Statuses:

```text
active
paused
revoked
expired
```

Level 1 allowed actions:

```text
decompose_goal
request_approval
enqueue_approved_task
sync_queue_status
evaluate_result
create_replan_suggestion
pause_mission
```

Level 1 disallowed actions:

```text
approve_code_change
approve_schema_change
approve_public_api_change
ignore_verification_failure
execute_destructive_operation
auto_accept_scope_expansion
```

### New Table: pilot_actions

Purpose:

Mission Pilot の現在行動と判断根拠を構造化する。

Columns:

```text
id
mission_id
repository_id
task_id
type
status
reason
actor_json
evidence_refs_json
next_if_succeeded
next_if_failed
requires_human_attention
started_at
completed_at
created_at
updated_at
```

Types:

```text
decompose_goal
ask_human
request_context_compile
request_feature_plan
request_approval
enqueue_task
sync_queue_status
evaluate_result
replan
register_learning
propose_self_improvement
pause_mission
```

### New Table: mission_evaluations

Purpose:

run / review / test evidence に基づく Mission progress 判断。

Columns:

```text
id
mission_id
repository_id
task_id
result
summary
objective_updates_json
evidence_refs_json
next_recommended_action
created_by_actor_json
created_at
```

Results:

```text
progressed
no_progress
regressed
blocked
completed
failed
```

Required evidence refs:

- `run`
- `review`
- `test_evidence`
- `artifact`
- `queue_entry`
- `diff`
- `command`

MVP rule:

- task evaluation では run evidence を必須にする。
- Mission completion では Objective evidence を必須にする。
- verification failure がある場合、result は `completed` にしない。

### New Table: mission_plan_revisions

Purpose:

TaskGraph の版管理。

Columns:

```text
id
mission_id
repository_id
base_revision_id
planning_result_id
revision_number
summary
diff_json
created_by_actor_json
created_at
```

### New Table: mission_replan_suggestions

Purpose:

失敗時に勝手に進まず、人間が承認できる再計画案を保存する。

Columns:

```text
id
mission_id
repository_id
base_revision_id
source_evaluation_id
status
reason
taskgraph_diff_json
approval_id
created_at
updated_at
```

Statuses:

```text
draft
awaiting_approval
approved
rejected
applied
cancelled
```

## EvidenceRef Contract

全 model で evidence reference の形を揃える。

```ts
type EvidenceRef =
	| { type: "run"; id: string; label?: string }
	| { type: "review"; id: string; label?: string }
	| { type: "test_evidence"; id: string; label?: string }
	| { type: "queue_entry"; id: string; label?: string }
	| { type: "task"; id: string; label?: string }
	| { type: "artifact"; id: string; label?: string }
	| { type: "diff"; id: string; label?: string }
	| { type: "event"; id: string; label?: string }
	| { type: "command"; id: string; label?: string };
```

Initial rule:

- JSON columns は `evidenceRefsJson` として保存する。
- API response は `evidenceRefs` に正規化する。
- UI は `EvidenceDrawer` で type ごとに表示先を分ける。

## API Plan

既存 `mission-planner` routes は維持する。
Mission Pilot 専用 command は、新規 `mission-pilot` routes として追加する。

### Mission Detail Read Model

```http
GET /api/missions/:missionId/pilot-detail
```

Returns:

```text
mission
objectives
taskCandidates
missionTasks
currentPilotAction
attentionItems
latestEvaluation
latestPlanRevision
autopilotGrant
events
executionSummary
```

### Create Mission from Project Evaluation Improvement

```http
POST /api/repositories/:repositoryId/missions/from-project-evaluation-improvement
```

Request:

```ts
type CreateMissionFromImprovementRequest = {
	evaluationId: string;
	improvementIdeaId: string;
	title?: string;
	goalText?: string;
	nonGoals?: string[];
};
```

Behavior:

- Project Evaluation improvement idea を取得する。
- Mission `source = "project_evaluation"` を保存する。
- `sourceRefId = improvementIdeaId` を保存する。
- `mission_created` event を作る。
- 初期 status は `draft`。

### Decompose Mission for Pilot

既存:

```http
POST /api/missions/:missionId/decompose
```

追加 behavior:

- planning result 作成後に `mission_objectives` を upsert する。
- TaskCandidate 作成後に `task_candidate_created` event を作る。
- approvalRequired TaskCandidate に `mission_attention_items` を作る。
- Mission status を `review_pending` または `awaiting_approval` 相当に更新する。

既存 status union との互換:

- 初期実装では existing `review_pending` を approval review state として使う。
- 追加の cockpit 表示では read model が `awaiting_attention` summary を算出する。
- status enum の大幅変更は後続 PR に分ける。

### Request Approval

```http
POST /api/missions/:missionId/approvals
```

Request:

```ts
type RequestMissionApprovalRequest = {
	targetType: "task_candidate" | "mission_task" | "replan_suggestion";
	targetId: string;
	approvalType: "queue_admission" | "replan" | "accepted_risk";
	reason: string;
};
```

Behavior:

- target snapshot を作る。
- snapshot hash を保存する。
- `mission_approvals` row を `requested` で作る。
- `mission_attention_items` を作る。
- `approval_requested` event を作る。

### Approve / Reject Approval

```http
POST /api/missions/:missionId/approvals/:approvalId/approve
POST /api/missions/:missionId/approvals/:approvalId/reject
```

Approve behavior:

- approval target の現 snapshot hash と approval snapshot hash を比較する。
- 不一致なら approval を `stale` にして enqueue させない。
- 一致なら approval を `approved` にする。
- TaskCandidate target なら MissionTask を作成または更新する。
- `approval_granted` event を作る。
- attention item を resolved にする。

Reject behavior:

- approval を `rejected` にする。
- target TaskCandidate / MissionTask を blocked or cancelled にする。
- `approval_rejected` event を作る。
- attention item を resolved にする。

### Create MissionTask from Approved TaskCandidate

```http
POST /api/missions/:missionId/task-candidates/:taskCandidateId/create-mission-task
```

Behavior:

- approved MissionApproval を要求する。
- TaskCandidate snapshot hash を検証する。
- `mission_tasks` を作る。
- 必要なら既存 `createTasksFromMissionTaskProposals` を呼んで NightWorkers Task を作る。
- NightWorkers Task message metadata に Mission Pilot metadata を保存する。
- `mission_task_created` event を作る。

MVP shortcut:

- 既存 `POST /mission-task-proposals/create-tasks` を内側で使ってよい。
- ただし UI は TaskCandidate と表示する。

### Enqueue Approved MissionTask

```http
POST /api/missions/:missionId/tasks/:missionTaskId/enqueue
```

Request:

```ts
type EnqueueMissionTaskRequest = {
	idempotencyKey: string;
	autopilotGrantId?: string;
};
```

Behavior:

- MissionTask が存在する。
- MissionTask status が `approved`。
- approvalRequired の場合、approved MissionApproval がある。
- approval snapshot hash が current target hash と一致する。
- MissionTask に NightWorkers Task がある。
- queue entry がまだない。
- Queue API に `approveMissionProposal: true` を渡す。
- Mission metadata は、まず NightWorkers Task message metadata と MissionTask row から追跡する。
- queueEntryId を MissionTask に保存する。
- MissionTask status を `queued` にする。
- `task_queued` event を作る。

Idempotency:

- 同じ MissionTask / idempotencyKey では同じ result を返す。
- queue entry を二重作成しない。

### Autopilot Grant

```http
POST /api/missions/:missionId/autopilot/start
POST /api/missions/:missionId/autopilot/pause
POST /api/missions/:missionId/autopilot/resume
POST /api/missions/:missionId/autopilot/revoke
```

Start request:

```ts
type StartMissionAutopilotRequest = {
	autonomyLevel: 1;
	allowedActions: PilotActionType[];
	expiresAt?: string;
};
```

Behavior:

- Level 1 以外は MVP で reject する。
- allowedActions を Level 1 allowlist に制限する。
- active grant を作る。
- `autopilot_started` event を作る。

Grant invariant:

- Grant は approvalRequired を override しない。
- Grant は approved MissionTask の enqueue を許可するだけ。
- Grant が revoked / expired / paused の場合、新規 PilotAction は作らない。

### Sync Mission Execution State

```http
POST /api/missions/:missionId/sync-execution
```

Behavior:

- MissionTask の queueEntryId / runId から queue / run state を読む。
- queued / running / completed / failed / blocked を同期する。
- state change があれば MissionEvent を作る。
- Run 完了後、evaluate candidate を AttentionItem または PilotAction にする。

### Evaluate Mission

```http
POST /api/missions/:missionId/evaluate
```

Request:

```ts
type EvaluateMissionRequest = {
	taskId?: string;
	evidenceRefs?: EvidenceRef[];
};
```

Behavior:

- taskId がある場合は task-level evaluation を作る。
- taskId がない場合は mission-level evaluation を作る。
- run / review / test evidence を集約する。
- objective status updates を算出する。
- MissionEvaluation を保存する。
- Objective status を更新する。
- `mission_evaluated` event を作る。
- failure の場合は ReplanSuggestion を作るか AttentionItem を作る。

### Replan

```http
POST /api/missions/:missionId/replan
POST /api/missions/:missionId/replan-suggestions/:suggestionId/approve
POST /api/missions/:missionId/replan-suggestions/:suggestionId/reject
```

Behavior:

- ReplanSuggestion は base revision に対する diff として作る。
- 承認されるまで TaskGraph を変更しない。
- 承認後に MissionPlanRevision を追加する。
- new / changed TaskCandidate を保存する。
- obsolete TaskCandidate を deferred / cancelled にする。
- `replan_created` / `replan_approved` event を作る。

### Pause / Resume / Abandon

```http
POST /api/missions/:missionId/pause
POST /api/missions/:missionId/resume
POST /api/missions/:missionId/abandon
```

Rules:

- pause は active grant も paused にする。
- resume は revoked grant を復活させない。
- abandon は new queue admission を禁止する。
- queued / running work の扱いは AttentionItem でユーザー確認する。

## UI Plan

### Entry Point

Project Detail の `Mission` tab を Mission Control cockpit に育てる。

優先入口:

1. Project Evaluation improvement idea の `Create Mission`
2. Project Detail Mission tab の Mission row open
3. Free-form Mission goal

### Mission List

既存 tree は残す。

追加表示:

- Mission status
- autonomy level
- objective progress
- TaskCandidate count
- approved / queued / running / completed / blocked count
- attention required count
- latest evaluation result
- autopilot grant status

### Mission Detail

MVP required components:

```text
MissionHeader
ObjectiveProgressPanel
CurrentPilotActionPanel
MissionTaskCandidatePanel
MissionTaskGraphPanel
AttentionInboxPanel
AutopilotControlPanel
MissionEvidenceDrawer
MissionTimelinePanel
MissionEvaluationPanel
ReplanSuggestionPanel
```

`MissionTaskCandidatePanel` 表示:

- title
- purpose
- related objective
- risk
- approvalRequired
- verificationGate
- scheduling
- status
- action: request approval / approve / reject / create task / open evidence

`AttentionInboxPanel` 表示:

- approval required
- verification failed
- replan approval required
- task blocked
- scope expansion detected
- grant expired

Attention item action:

- Approve
- Reject
- Ask to replan
- Pause mission
- Mark as accepted risk
- Open evidence

`AutopilotControlPanel` 表示:

- Level 1 固定
- grant status
- allowed actions
- next pilot action
- stop condition
- Start / Pause / Resume / Revoke

UI copy rule:

- ユーザー向けには `TaskCandidate` を使う。
- `proposal` は DB/API compatibility note や developer-only metadata に閉じ込める。

## Implementation Phases

### Phase 0: Baseline Characterization

Goal:

既存 Mission Decomposition / Queue admission guard を壊さずに、Mission Pilot 用の実装境界を固める。

Backend tasks:

- 既存 route / service / schema の characterization tests を追加する。
- `mission_task_proposals` を TaskCandidate として読む adapter を追加する。
- TaskCandidate snapshot hash helper を追加する。
- EvidenceRef schema を shared schema に追加する。

UI tasks:

- Project Detail Mission tab の既存 tree 表示を壊さない smoke test を追加する。
- UI label の新規追加箇所は `TaskCandidate` に寄せる。

Tests:

- `tests/project-detail-backend/mission-evidence.cases.ts`
- new `tests/mission-pilot-baseline.test.ts`
- existing queue approval guard tests

Done criteria:

- existing Mission -> decomposition -> TaskCandidate -> task creation path が通る。
- approvalRequired task は既存 queue guard で止まる。
- TaskCandidate snapshot hash が deterministic。

### Phase 1: Mission DB and Read Model

Goal:

Mission Detail cockpit の source of truth を保存できるようにする。
ただし、この phase では approval command と autopilot command は実装しない。

Backend tasks:

- Drizzle migration を追加する。
  - `mission_objectives`
  - `mission_events`
- repository functions を追加する。
- `GET /api/missions/:missionId/pilot-detail` を追加する。
- existing mission detail に TaskCandidates / events / attention summary を接続する。
- read model は `mission_task_proposals` を TaskCandidate として返す。
- read model は missing `mission_objectives` / `mission_events` を許容する。
- attention summary は、この phase では永続化せず、approvalRequired TaskCandidate と existing queue guard から算出してよい。

UI tasks:

- Mission Detail route or modal を read-only cockpit として追加する。
- `MissionHeader`
- `ObjectiveProgressPanel`
- `MissionTaskCandidatePanel`
- `MissionTimelinePanel`
- `AttentionInboxPanel` read-only

Tests:

- create MissionEvent
- read mission pilot detail
- objective upsert from planning result
- derived attention summary from approvalRequired TaskCandidates
- Mission Detail renders with empty optional sections

Done criteria:

- Mission Detail を開くと goal / objectives / TaskCandidates / attention / timeline が見える。
- MissionEvent が append-only に残る。
- 既存 Mission tab の tree が退行しない。
- approve / enqueue / autopilot buttons は disabled または not implemented として表示できる。

### Phase 2: Project Evaluation Improvement to Mission

Goal:

Project Evaluation improvement idea を Mission Pilot の優先入口にする。

Backend tasks:

- `project_evaluation_runs` から evaluation を取得する。
- `project_improvement_ideas` から improvement idea を取得する。
- `project_evaluation_task_links` に既存 task link がある idea は、Mission 作成時に warning として返す。
- `POST /api/repositories/:repositoryId/missions/from-project-evaluation-improvement` を追加する。
- Mission source metadata を保存する。
- sourceRefId を Mission detail read model に含める。
- Mission created event を保存する。
- Mission title / goalText の default は improvement idea の title / agentPrompt / expectedOutcome から作る。
- 既存 `POST /project-evaluations/:evaluationId/tasks` は残すが、Mission Pilot の主経路では直接 Task 作成に進めない。

UI tasks:

- Project Evaluation improvement card に `Create Mission` action を追加する。
- Mission 作成後に Mission Detail へ遷移または open する。
- improvement idea source を Mission Header に表示する。
- 既に task link がある idea では、Create Mission action に "existing task linked" state を表示する。

Tests:

- improvement idea から Mission を作成できる。
- source metadata が保存される。
- MissionEvent が作成される。
- UI action が Mission creation API を呼ぶ。
- existing task link がある idea でも、重複 Task 作成ではなく Mission source link として扱える。

Done criteria:

- Project Evaluation result から Mission を作れる。
- 作成された Mission に sourceRef が残る。
- Mission Detail で source と goal を確認できる。
- Project Evaluation の直接 task 作成 path は壊れない。

### Phase 3: TaskCandidate Approval Flow

Goal:

TaskCandidate を queue に流す前の human approval を構造化する。

Backend tasks:

- `mission_attention_items` migration を追加する。
- `mission_approvals` repository を実装する。
- `pilot_actions` migration を追加する。
- request approval API を追加する。
- approve / reject API を追加する。
- approval snapshot / hash / stale detection を実装する。
- approvalRequired TaskCandidate の AttentionItem を作る。
- approval event logging を追加する。

UI tasks:

- Attention Inbox に approval item を表示する。
- TaskCandidate card に Approve / Reject / Request replan を追加する。
- stale approval の表示を追加する。

Tests:

- approvalRequired TaskCandidate creates approval request.
- approve creates approved MissionApproval.
- reject blocks or cancels target.
- changed snapshot makes approval stale.
- attention item resolves on decision.

Done criteria:

- code change TaskCandidate は approval なしでは MissionTask / queue に進めない。
- approval / reject の判断履歴が Mission timeline に残る。
- stale approval で enqueue できない。

### Phase 4: MissionTask and Queue Integration

Goal:

承認済み TaskCandidate を MissionTask / NightWorkers Task / Queue に接続する。

Backend tasks:

- `mission_tasks` migration を追加する。
- approved TaskCandidate -> MissionTask conversion を追加する。
- existing `createTasksFromMissionTaskProposals` を MissionTask 作成 flow に接続する。
- NightWorkers Task message metadata に Mission Pilot metadata を保存する。
- `POST /api/missions/:missionId/tasks/:missionTaskId/enqueue` を追加する。
- queue admission 時に existing `approveMissionProposal` を使う。
- queueEntryId linkage を保存する。
- queue entry 自体への Mission metadata column 追加は、この phase の必須条件にしない。
- queue status sync を実装する。
- task queued / run started / run completed event logging を追加する。

UI tasks:

- MissionTaskGraphPanel を追加する。
- TaskCandidate -> approved -> MissionTask -> queued の状態遷移を表示する。
- Queue entry / Run への link を表示する。

Tests:

- approved TaskCandidate creates MissionTask.
- unapproved approvalRequired TaskCandidate cannot enqueue.
- approved MissionTask enqueues once.
- idempotent enqueue does not create duplicate queue entry.
- queue status sync updates MissionTask status.

Done criteria:

- 承認済み TaskCandidate だけが queue に入る。
- Mission Detail で queued / running / completed が見える。
- Queue 側の existing approval guard を迂回していない。

### Phase 5: Autopilot Control

Goal:

Mission 画面から Level 1 Autopilot を起動、停止、revoke できるようにする。
MVP では、常駐 daemon を必須にしない。

Backend tasks:

- `mission_autopilot_grants` migration を追加する。
- start / pause / resume / revoke API を追加する。
- grant actor model を PilotAction / MissionEvent に入れる。
- grant allowlist validator を追加する。
- grant が approvalRequired を override しない invariant test を追加する。
- pilot tick function を追加する。

Pilot tick trigger:

- `POST /api/missions/:missionId/autopilot/start`
- `POST /api/missions/:missionId/sync-execution`
- approved MissionTask enqueue 後
- run completion sync 後
- future scheduler hook

MVP rule:

- tick は idempotent にする。
- tick は 1 回の呼び出しで最大 1 つの state-changing action だけを実行する。
- tick は human attention が必要な item を見つけたら止まる。
- tick の結果は PilotAction と MissionEvent に残す。
- always-on background scheduler は MVP 完了条件に含めない。

Level 1 pilot tick behavior:

```text
if mission paused/abandoned/completed -> stop
if grant inactive/revoked/expired -> stop
if attention item requires human -> stop
if approved MissionTask is ready and not queued -> enqueue
if run completed and not evaluated -> evaluate
if failure detected -> create replan suggestion and attention item
```

UI tasks:

- AutopilotControlPanel を追加する。
- Start / Pause / Resume / Revoke controls を追加する。
- next pilot action と stop condition を表示する。

Tests:

- Level 1 grant can start.
- Level 2+ grant rejected in MVP.
- revoked grant prevents new PilotAction.
- expired grant creates AttentionItem.
- grant does not approve approvalRequired TaskCandidate.
- approved MissionTask can be enqueued by grant.

Done criteria:

- Mission Detail から Level 1 Autopilot を起動できる。
- Autopilot は承認済み作業だけ進める。
- 認証導入後に使える grant / actor audit の形が保存される。

### Phase 6: Evidence and MissionEvaluation

Goal:

Run / Review / Test evidence を Mission progress に接続する。

Backend tasks:

- run result fetcher を実装する。
- review finding fetcher を実装する。
- test evidence fetcher を実装する。
- evidence ref normalizer を実装する。
- MissionEvaluation generator を実装する。
- Objective status update を実装する。
- verification failure detection を実装する。
- EvidenceDrawer read model を追加する。

Initial evidence sources:

- `task_runs`
  - status
  - summary
  - final_report
  - final_judgment
  - diff_patch
  - test_results
- `task_events`
  - `verification.finished`
  - `run.outcome_decided`
  - `human.review_submitted`
- Review Mode tables
  - `review_sessions`
  - `review_artifacts`
  - `review_findings`
  - `review_recommendations`
- Verification tables
  - `verification_documents`
  - `verification_checklist_items`
  - `verification_evidence_runs`
  - `verification_evidence_cases`

Evaluation rule:

- `task_runs.status = completed` だけでは Objective を satisfied にしない。
- `verification.finished` の failed event がある場合、MissionEvaluation result は `blocked` or `failed` にする。
- blocking review finding がある場合、該当 Objective は `blocked` にする。
- test / verification evidence がない場合、Objective は `progressed` までに留める。
- Mission-level completion は、全 required Objective が `satisfied` か、明示的に `deferred` 承認されている場合だけにする。

UI tasks:

- MissionEvaluationPanel を追加する。
- EvidenceDrawer を追加する。
- ObjectiveProgressPanel に evidence refs を表示する。
- failed / blocked evaluation の AttentionItem を表示する。

Tests:

- run completion creates evaluatable evidence refs.
- successful evidence progresses Objective.
- review finding can block Objective.
- test evidence success can satisfy Objective.
- verification failure never completes Mission.

Done criteria:

- Run 完了後に MissionEvaluation を作れる。
- Objective が evidence に基づいて progressed / blocked / satisfied へ更新される。
- Mission Detail から evidence を追える。

### Phase 7: Replan Suggestion

Goal:

失敗時に勝手に続行せず、人間が承認できる再計画案を出す。

Backend tasks:

- `mission_plan_revisions` migration を追加する。
- `mission_replan_suggestions` migration を追加する。
- failed / blocked evaluation から ReplanSuggestion を作る。
- TaskGraph diff schema を追加する。
- replan approval flow を MissionApproval に接続する。
- approved replan を MissionPlanRevision と TaskCandidate updates に適用する。

UI tasks:

- ReplanSuggestionPanel を追加する。
- TaskGraph diff preview を表示する。
- Approve replan / Reject replan / Ask changes を追加する。

Tests:

- verification failure creates replan suggestion.
- replan suggestion creates attention item.
- rejected replan does not mutate TaskGraph.
- approved replan creates new revision.
- obsolete TaskCandidate is deferred or cancelled.

Done criteria:

- verification failure 時に Mission は completed にならない。
- ReplanSuggestion が Attention Inbox に出る。
- 承認後だけ TaskGraph が更新される。

## Safety Invariants

必ず test で固定する invariant:

1. `approvalRequired = true` の TaskCandidate は approved MissionApproval なしに MissionTask / Queue に進めない。
2. code / schema / public API / destructive / security-sensitive task は approvalRequired になる。
3. Autopilot grant は approvalRequired を override しない。
4. revoked / expired / paused grant では新規 PilotAction を作らない。
5. approval snapshot hash が current target hash と違う場合、enqueue しない。
6. enqueue idempotency により queue entry を二重作成しない。
7. verification failure がある MissionEvaluation は `completed` にならない。
8. Mission completion は Objective + evidence refs に基づく。
9. Replan は base revision に対する diff として保存する。
10. scope expansion は AttentionItem を作る。
11. abandoned Mission は新規 enqueue できない。
12. pause 中 Mission は Autopilot が新規 action を進めない。

## Test Plan

### Unit Tests

Add or extend:

```text
tests/mission-pilot-baseline.test.ts
tests/mission-pilot-approval.test.ts
tests/mission-pilot-autopilot.test.ts
tests/mission-pilot-evaluation.test.ts
tests/mission-pilot-replan.test.ts
```

Coverage:

- TaskCandidate snapshot hash
- approvalRequired classification
- approval stale detection
- MissionTask state transition
- grant allowlist
- stop condition detection
- evidence ref normalization
- MissionEvaluation result calculation
- replan diff validation

### API Tests

Coverage:

- create Mission from Project Evaluation improvement
- get pilot detail
- request approval
- approve / reject
- create MissionTask
- enqueue MissionTask
- start / pause / resume / revoke Autopilot
- sync execution
- evaluate Mission
- create / approve / reject ReplanSuggestion
- pause / resume / abandon Mission

### UI Tests

Coverage:

- Mission list renders execution summary
- Mission Detail renders
- CurrentPilotActionPanel renders
- AttentionInbox shows approval item
- Approve action updates state
- AutopilotControlPanel starts grant
- EvidenceDrawer opens evidence refs
- ReplanSuggestionPanel shows diff
- TaskGraph status changes are visible

### Integration Tests

Coverage:

- Project Evaluation improvement -> Mission
- Mission -> decomposition -> TaskCandidate
- TaskCandidate approval -> MissionTask
- MissionTask enqueue -> Queue
- Queue run completion -> MissionEvaluation
- Review finding -> Objective blocked
- Test evidence success -> Objective progressed
- verification failure -> ReplanSuggestion

### Verification Commands

Focused backend:

```bash
bun run test run tests/mission-pilot-baseline.test.ts tests/mission-pilot-approval.test.ts tests/mission-pilot-autopilot.test.ts tests/mission-pilot-evaluation.test.ts tests/mission-pilot-replan.test.ts
```

Existing Mission / Project Detail regression:

```bash
bun run test run tests/project-detail-backend/mission-evidence.cases.ts
```

Focused UI:

```bash
bun run test run tests/project-evaluation-improvement-card.test.tsx tests/queue-screens.test.tsx
```

Final gate:

```bash
bun run verify
```

If a phase only changes docs or isolated backend schema, a focused suite can be used for that phase, but the final MVP PR must run the repo-native verify gate.

## Implementation Order

Recommended issue order:

1. Add TaskCandidate adapter and snapshot hash helper.
2. Add Mission Pilot read model with existing Mission / TaskCandidate state.
3. Add `mission_objectives` and `mission_events`.
4. Add read-only Mission Detail cockpit.
5. Add Project Evaluation improvement -> Mission creation.
6. Add MissionObjective persistence from decomposition result.
7. Add MissionApproval, AttentionItem, and PilotAction persistence.
8. Add approval request / approve / reject APIs.
9. Add Attention Inbox UI.
10. Add approved TaskCandidate -> MissionTask conversion.
11. Add MissionTask -> Queue enqueue integration.
12. Add queue / run status sync into MissionTask.
13. Add Autopilot grant model and Level 1 controls.
14. Add idempotent pilot tick function.
15. Add MissionEvaluation from run / review / test evidence.
16. Add EvidenceDrawer and Objective evidence display.
17. Add ReplanSuggestion and plan revision diff.
18. Add final integration tests and verify gate cleanup.

Recommended first PR:

```text
TaskCandidate adapter
Mission Pilot read model
mission_objectives
mission_events
read-only Mission Detail cockpit
focused tests
```

First PR must not include:

- Autopilot grant
- background pilot tick
- queue enqueue command
- replan mutation
- Mission completion automation

## Migration Strategy

Keep compatibility first:

- Do not rename `mission_task_proposals` in the first MVP PR.
- Add adapter names so TypeScript/UI can use `MissionTaskCandidate`.
- Existing routes can keep `proposal` in path names initially.
- New Mission Pilot routes should use `task-candidates` in path names where possible.
- Add DB tables in additive migrations only.
- Backfill is optional for old Mission rows; read model should tolerate missing objectives/events.

Backfill behavior:

- Existing Mission with latest planning result can synthesize objectives into `mission_objectives` on first pilot detail read or via explicit migration utility.
- Existing `mission_task_proposals` without MissionApproval remain unapproved TaskCandidates.
- Existing tasks created from proposal metadata can be linked to MissionTask only if metadata is sufficient; otherwise show as legacy evidence.

## Completion Criteria

MVP is complete when all are true:

1. Project Evaluation improvement idea から Mission を作成できる。
2. Mission Detail が Objective / TaskCandidate / Attention / Timeline / Autopilot 状態を表示する。
3. TaskCandidate ごとに risk / approvalRequired / verificationGate が見える。
4. approvalRequired TaskCandidate は human approval なしに queue に入らない。
5. 承認済み TaskCandidate から MissionTask / NightWorkers Task を作れる。
6. 承認済み MissionTask を Implementation Queue に投入できる。
7. Queue / Run status が Mission Detail に反映される。
8. Mission 画面から Level 1 Autopilot を start / pause / resume / revoke できる。
9. Autopilot は承認済み作業だけ進める。
10. Run / Review / Test evidence を MissionEvaluation が参照できる。
11. MissionEvaluation が Objective progress を更新できる。
12. verification failure 時に Mission Pilot が stop / replan を提案できる。
13. ReplanSuggestion は承認後だけ TaskGraph に反映される。
14. ユーザーが Mission Detail を見れば、現在地、根拠、次の承認点を理解できる。
15. `bun run verify` が通る。

## Deferred Work

MVP では扱わない:

- Level 2 low-risk auto queue
- code change task の自動承認
- 複数 Mission の優先順位最適化
- 複数 Mission 間 dependency
- self-improvement の自動実行
- complex DAG editor
- すべての review finding の自動 task 化
- verification failure を無視した続行
- browser UI 操作による internal Mission progress
- full authentication / RBAC implementation
- multi-user approval policy

ただし、将来対応できるように、次は MVP から持つ:

- `riskLevel`
- `approvalRequired`
- `EvidenceRef`
- `MissionApproval`
- `MissionEvent`
- `PilotAction`
- `MissionAutopilotGrant`
- `MissionEvaluation`
- `MissionPlanRevision`
