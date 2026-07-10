# Mission Pilot MVP Implementation Plan

## Status

- Plan status: `completed`
- Implementation status: `mvp-phases-0-8-complete`
- Canonical plan: this document
- Baseline reviewed: 2026-07-10, `main` at `d4352ae9e80e`

この文書を Mission Pilot MVP 実装の正本とする。

次の archive 文書は背景、設計意図、過去案の参照に限る。実装順、現在のパス、API、DB、検証条件がこの文書と異なる場合は、この文書を優先する。

- `spec/archive/mission-pilot-concept.md`
- `spec/archive/mission-pilot-mvp-implementation-plan.md`

## 目的

Mission Pilot MVP を、既存の Mission Planner、Project Detail、Project Evaluation、Implementation Queue、Run、Review Mode、Test Mode evidence の上に Mission Control として追加する。

MVP は Mission Pilot 自身がコードを変更する機能ではない。人間が設定した Mission を分解し、承認済みの作業だけを既存 Queue へ渡し、実行後の evidence を読んで続行、停止、再計画を判断できる制御層を作る。

MVP の主経路は次の一周である。

```text
Project Evaluation improvement
  -> Mission
  -> Mission Planner decomposition
  -> MissionObjective / TaskCandidate
  -> human approval
  -> MissionTask / NightWorkers Task
  -> Implementation Queue
  -> Run
  -> Review / Test evidence
  -> MissionEvaluation
  -> complete または stop / replan
```

## 成功条件

MVP は、次をすべて満たしたときだけ完了とする。

1. Project Evaluation improvement から重複せず Mission を作成できる。
2. Mission Detail で goal、Objective、TaskCandidate、Attention、timeline、execution summary を確認できる。
3. Mission Pilot 対象 TaskCandidate の risk、approvalRequired、verificationGate、scheduling が表示される。
4. Mission Pilot 経路では、承認済み snapshot と一致する TaskCandidate だけを MissionTask にできる。
5. `approvalRequired = true` の作業は、承認済み MissionApproval なしに Queue へ入らない。
6. Level 1 Autopilot は承認を作成せず、承認済み MissionTask だけを進める。
7. Queue / Run / Review / Verification の現在状態と根拠を Mission Detail から追跡できる。
8. verification failure または blocking review finding がある Mission を completed にしない。
9. replan は base revision に対する差分として保存され、人間の承認後だけ適用される。
10. command、enqueue、sync、evaluation、replan apply は再送しても重複 mutation を起こさない。
11. 各 Phase の focused test、`bun run verify`、最終 `bun run verify:full` が成功する。

## Scope

### 対象

- 既存 Mission Planner の planning result と task proposal を Mission Control に接続する。
- Project Evaluation improvement を Mission の主要 source にする。
- Mission Objective、Approval、MissionTask、Attention、Event、Autopilot grant、PilotAction、MissionEvaluation、PlanRevision、ReplanSuggestion を永続化する。
- Project Detail の Mission tab を Mission List / Mission Detail cockpit の入口として使う。
- 既存 Queue admission guard を迂回せず、MissionApproval と接続する。
- Run、Review Mode、Verification evidence を正規化して MissionEvaluation に渡す。
- Level 1 Approved Execution を command-driven / event-hook-driven に実装する。

### 対象外

- Level 2 以上の自動承認または low-risk code change の自動承認
- 複数 Mission 間の優先順位最適化、dependency scheduling
- full authentication / RBAC / multi-user approval policy
- browser UI 操作による内部進行
- Mission Pilot 自身による code edit
- self-improvement の自動実行
- complex DAG editor
- 全 review finding の自動 Task 化
- 既存 `mission_task_candidates` と `mission_task_proposals` の物理統合や table rename
- 既存 Queue、Review Mode、Test Mode の大規模再設計

## Plan View Decisions

この文書内に次の view を含める。

- Data model: 新規 table、既存 table 拡張、index、source of truth を定義するため必要。
- API I/O contract: Hono / OpenAPI route、request、response、error を定義するため必要。
- Activity / sequence flow: approval、enqueue、sync、evaluation、replan の mutation 順序を固定するため必要。
- UI blueprint: Project Detail / Project Evaluation 内の入口と情報配置を固定するため必要。
- Verification: 各 Phase の本文に command、期待結果、失敗時の停止条件を含める。

次は独立 artifact として作成しない。

- 独立 Zod schema design: HTTP schema は API contract と同じ shared schema を正本にする。LLM output 用 schema だけ該当 Phase に明記する。
- 独立 use-case diagram: target flow と Phase sequence で実装判断に十分。
- 独立 data binding artifact: 既存 React query / command patternを使用し、UI Phaseで具体化する。

## 現在の実装状態

### 計画刷新時点の runtime data

`sqlite.db` の確認結果は次の通り。

```text
missions                       0
mission_planning_results       0
mission_task_proposals         0
mission_task_candidates        4
project_evaluation_runs        1
project_improvement_ideas      0
implementation_queue_entries   1
task_runs                      3
review_sessions                1
verification_documents         1
```

table が存在することと、Mission Pilot の実データが存在することを混同しない。Phase 0 では test fixture で既存契約を固定し、live DB の空状態を成功 evidence に使わない。

### 既存 Mission Planner

正本:

- `api/db/mission-planner-schema.ts`
- `shared/schemas/mission-planner.schema.ts`
- `api/modules/mission-planner/mission-planner.repository.ts`
- `api/modules/mission-planner/mission-planner.service.ts`
- `api/modules/mission-planner/mission-planner.routes.ts`
- `tests/mission-planner.test.ts`

既存 table:

- `missions`
- `mission_decomposition_runs`
- `mission_planning_results`
- `mission_task_proposals`

既存挙動:

- Mission は `draft -> decomposing -> evaluating -> review_pending` 等の lifecycle を持つ。
- planning result は deterministic check と Mission Decomposition Evaluation を通過した場合だけ `review_pending` になる。
- `review_pending` になったとき `mission_task_proposals` が保存される。
- proposal は risk、approvalRequired、verificationGate、scheduling を持つ。
- `POST /api/mission-task-proposals/create-tasks` は最新 `review_pending` result の proposal を NightWorkers Task に変換する。
- 現行の Task 作成は MissionApproval を要求しない。Queue admission 時の approval guard が実行境界である。

### TaskCandidate は2系統ある

#### Goal generation candidate

- 保存先: `mission_task_candidates`
- schema: `shared/schemas/project-detail.schema.ts` の `missionTaskCandidateSchema`
- owner: `project-detail`
- Mission との直接 FK を持たない。
- risk、approvalRequired、Mission scheduling を持たない。
- Project Detail から直接 Task 化できる。

#### Mission decomposition candidate

- 保存先: `mission_task_proposals`
- schema: `shared/schemas/mission-planner.schema.ts` の `missionTaskProposalSchema`
- owner: `mission-planner`
- Mission / planning result に属する。
- risk、approvalRequired、verificationGate、scheduling を持つ。

#### MVP の用語固定

- Mission Pilot の `TaskCandidate` は `mission_task_proposals` だけを指す。
- API / UI は Mission Pilot 文脈では `TaskCandidate` と表示する。
- DB table 名と既存 compatibility route では `proposal` を維持する。
- `mission_task_candidates` は MVP の approval / MissionTask / Autopilot 対象外とする。
- Project Detail の既存 unified table は両方を表示してよいが、source badge と利用可能 action を分ける。

### 既存 Project Detail UI

正本:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailMissionTree.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailDialogs.tsx`
- `src/modules/nightworkers/components/project-detail/mission-model.ts`
- `src/modules/nightworkers/components/project-detail/types.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

現在は Goal -> Mission -> TaskCandidate/Proposal を一つの tree table へ統合している。Mission row click は Mission modal を開き、candidate row click は candidate detail modal を開く。

計画刷新時点で `ProjectDetailDialogs.tsx` に既存の未コミット UI 差分がある。実装時はこの差分をユーザー所有変更として保全し、無関係な書き換えをしない。

### 既存 Project Evaluation

正本:

- `api/db/project-evaluation-schema.ts`
- `shared/schemas/project-evaluation.schema.ts`
- `api/modules/project-evaluation/project-evaluation.repository.ts`
- `api/modules/project-evaluation/project-evaluation.service.ts`
- `api/modules/project-evaluation/project-evaluation.routes.ts`
- `src/modules/project-evaluation/`

既存 source data:

- `project_evaluation_runs`
- `project_improvement_ideas`
- `project_improvement_idea_score_impacts`
- `project_evaluation_task_links`

現在の UI は複数 improvement idea を選択して直接 Task 化する。Mission 作成 action は存在しない。既存の直接 Task 化は互換経路として残す。

### 既存 Queue approval

正本:

- `api/modules/queue/queue-route-definitions.ts`
- `api/modules/queue/queue-management.service.ts`
- `api/modules/queue/queue.routes.ts`
- `src/modules/queue/queueCommands.ts`
- `src/modules/queue/useImplementationQueue.ts`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`

現在の契約:

- `POST /api/implementation-queue/entries` は `taskId` と optional `approveMissionProposal` を受ける。
- task message の `missionProposal.approvalRequired = true` を検出すると、承認 metadata がなければ `MISSION_PROPOSAL_APPROVAL_REQUIRED` を返す。
- UI は confirm 後に `approveMissionProposal: true` を再送する。
- Queue service は `mission_proposal_approval` task message を作成してから Queue entry を作る。
- active Queue entry の重複は `QUEUE_ENTRY_EXISTS` で拒否する。

この boolean approval は legacy compatibility として残すが、Mission Pilot metadata を持つ Task では使用しない。

### 既存 evidence source

Mission Pilot は次を新しい source of truth へコピーしない。元 table を正本として参照する。

- Queue: `implementation_queue_entries`
- Run: `task_runs`
- Run events: `task_events`
- canonical event types: `run.outcome_decided`, `verification.finished`, `human.review_submitted`
- Review: `review_sessions`, `review_artifacts`, `review_findings`, `review_recommendations`
- Verification: `verification_documents`, `verification_checklist_items`, `verification_evidence_runs`, `verification_evidence_cases`

`mission_events` は timeline projection、`mission_evaluations` は判断 record であり、upstream evidence の代替正本ではない。

### DB作成経路

この repository は Drizzle schema / migration だけでなく、起動時の `ensureNightWorkersSchema()` と各 `*-schema-bootstrap.ts` でも table を作る。

Mission Pilot の DB 変更では必ず次を同期する。

1. Drizzle table definitions
2. `api/db/client.ts` の schema registration
3. `api/db/schema.ts` の必要な re-export
4. runtime bootstrap DDL
5. `drizzle/migrations/` の additive migration
6. fresh DB test と既存 DB migration test

`db:push` を実装完了条件に使わない。

## Locked Decisions

次は実装中に再判断しない。

1. Goal を設定し、approval を決定する主体は人間である。
2. Mission Pilot は Mission Control であり Worker ではない。
3. MVP autonomy level は Level 1 Approved Execution に固定する。
4. Mission Pilot は approvalRequired を override しない。
5. Mission Pilot 経路で MissionTask を作るには、TaskCandidate snapshot と一致する approved `queue_admission` MissionApproval が必要である。同じ approval が MissionTask 作成と初回 Queue admission を許可する。
6. `approvalRequired = false` でも Level 1 の Mission Pilot 経路では人間の明示選択を MissionApproval として保存する。Autopilot は approval を作れない。
7. Mission Pilot 対象 TaskCandidate は `mission_task_proposals` に限定する。
8. `mission_task_candidates` の既存 Task 化は互換経路として維持する。
9. `POST /api/mission-task-proposals/create-tasks` は legacy route として維持するが、Mission Pilot UI は呼ばない。
10. Mission Pilot 専用 Queue bypass を作らない。
11. Mission Pilot enqueue service は既存 `queue-management.service.ts` を呼ぶ。
12. Mission Pilot metadata を持つ Task の Queue admission は MissionApproval row と snapshot hash を再検証する。legacy boolean だけでは通さない。
13. GET route は mutation を行わない。sync、evaluate、tick は明示 POST command にする。
14. `mission_events` は append-only とし、更新・削除しない。
15. upstream Queue / Run / Review / Verification row が state の正本であり、Mission Detail はそれを read model で統合する。
16. Mission completion は deterministic safety rule を先に適用し、LLM 本文だけで completed にしない。
17. verification failure、未解決 blocking finding、required evidence 不足のいずれかがあれば completed にしない。
18. replan は base revision に対する typed diff として保存し、承認前に TaskGraph を変更しない。
19. Autopilot tick は1回につき最大1つの state-changing actionだけ実行する。
20. always-on scheduler は MVP completion に含めない。明示 command と既存 lifecycle hook で進行する。
21. UI は backend command を呼ぶだけで、approval、evaluation、grant state を local-only で確定しない。
22. 実装は日本語 prompt を維持し、provider layer に Mission Pilot 固有の実行判断を追加しない。

## Architecture

### Backend module

新規 module:

```text
api/modules/mission-pilot/
  mission-pilot.routes.ts
  mission-pilot.service.ts
  mission-pilot.repository.ts
  mission-pilot-read-model.ts
  mission-pilot-approval.ts
  mission-pilot-queue.ts
  mission-pilot-autopilot.ts
  mission-pilot-evaluation.ts
  mission-pilot-replan.ts
```

責務:

- routes: OpenAPI route と request / response validation
- service: transaction boundary と command orchestration
- repository: Mission Pilot table の永続化
- read-model: 既存 Mission Planner / Queue / evidence の統合
- approval: canonical snapshot、hash、stale 判定
- queue: MissionApproval と既存 Queue service の橋渡し
- autopilot: grant 検証、next action、1-action tick
- evaluation: evidence normalization と deterministic verdict
- replan: typed diff validation、suggestion、apply transaction

既存 module の責務は移動しない。

- mission-planner: Mission decomposition、planning result evaluation、TaskCandidate generation
- project-detail: Goal generation candidates と Project Detail data
- project-evaluation: evaluation / improvement source
- queue: Queue admission、scheduling、execution lifecycle
- review / verification: review / test evidence の正本
- llm-provider: provider call、JSON extraction、schema validation、最小互換 normalization

### DB module

```text
api/db/mission-pilot-schema.ts
api/db/mission-pilot-schema-bootstrap.ts
shared/schemas/mission-pilot.schema.ts
```

`api/db/client.ts` に `missionPilotSchema` を登録し、`ensureNightWorkersSchema()` から `ensureMissionPilotTables()` を呼ぶ。

### Frontend module

```text
src/modules/nightworkers/missionPilotCommands.ts
src/modules/nightworkers/components/project-detail/mission-pilot/
  MissionPilotDetailModal.tsx
  MissionPilotHeader.tsx
  ObjectiveProgressPanel.tsx
  MissionTaskCandidatePanel.tsx
  MissionTaskGraphPanel.tsx
  AttentionInboxPanel.tsx
  MissionTimelinePanel.tsx
  AutopilotControlPanel.tsx
  MissionEvaluationPanel.tsx
  EvidenceDrawer.tsx
  ReplanSuggestionPanel.tsx
```

既存 Project Detail tree と modal の layout / style token を再利用する。

## Data Model

### Existing table: missions

Phase 2 で additive column を追加する。

```text
source                    text not null default 'user'
source_ref_id             text null
source_evaluation_id      text null
paused_at                 integer null
abandoned_at              integer null
completed_at              integer null
```

`source`:

```text
user
mission_goal
project_evaluation
```

Rules:

- Project Evaluation source では `source_ref_id = project_improvement_ideas.id`。
- `source_evaluation_id = project_evaluation_runs.id`。
- unique index `(repository_id, source, source_ref_id)` により同じ improvement からの重複 Mission を防ぐ。
- SQLite の NULL uniqueness を利用し、user source は複数作成可能とする。
- `source_ref_id` は polymorphic なため FK にしない。service で source table の所属を検証する。
- `source_evaluation_id` は Project Evaluation row への nullable FK とする。

Mission status は Phase 5 で `paused`, `abandoned` を shared union に追加する。既存 `cancelled` は互換のため維持する。

### New table: mission_objectives

Purpose: planning result の Objective を Mission progress の単位として保存する。

```text
id                         text primary key
mission_id                 text not null FK missions cascade
repository_id              text not null FK repositories cascade
planning_result_id         text not null FK mission_planning_results cascade
external_objective_id      text not null
title                      text not null
completion_criteria_json   text not null
verification_gate_json     text not null
status                     text not null default 'pending'
evidence_refs_json         text not null default '[]'
status_reason              text null
created_at                 integer not null
updated_at                 integer not null
```

Statuses:

```text
pending
progressed
satisfied
blocked
failed
deferred
```

Indexes:

- unique `(planning_result_id, external_objective_id)`
- index `(mission_id, status, created_at)`
- index `(repository_id, status)`

Rules:

- `MissionDecompositionPlanningResult.objectives` から transaction 内で upsert する。
- `completionCriteria` と `verificationGate` をそのまま保存し、存在しない description を捏造しない。
- latest planning result の Objective を current view とし、古い result の Objective は revision history として保持する。

### New table: mission_events

Purpose: Mission timeline の append-only projection。

```text
id                    text primary key
mission_id            text not null FK missions cascade
repository_id         text not null FK repositories cascade
mission_task_id       text null
event_type            text not null
summary               text not null
actor_json            text not null
payload_json          text null
evidence_refs_json    text not null default '[]'
source_kind           text not null
source_id             text not null
source_version        text not null default '1'
occurred_at           integer not null
created_at            integer not null
```

Indexes:

- unique `(mission_id, event_type, source_kind, source_id, source_version)`
- index `(mission_id, occurred_at, created_at)`
- index `(mission_task_id, occurred_at)`

Rules:

- application event は source_kind=`mission_command`、source_id=`pilot_actions.id`。
- task event は source_kind=`task_event`、source_id=`task_events.id`。
- Queue milestone は source_kind=`queue_entry`、source_id=`entry id`、source_version=`attemptCount:status`。
- Run milestone は source_kind=`run`、source_id=`run id`、source_version=`status`。
- 同じ sync を再実行しても unique key により timeline を重複させない。
- upstream row の削除を timeline row の削除へ伝播させない。EvidenceDrawer は missing source を unavailable と表示する。

### New table: mission_approvals

Purpose: 実行境界の人間判断を snapshot-bound record として保存する。

```text
id                         text primary key
mission_id                 text not null FK missions cascade
repository_id              text not null FK repositories cascade
target_type                text not null
target_id                  text not null
approval_type              text not null
status                     text not null default 'requested'
risk_level                 text not null
approval_required          integer not null
requested_reason           text not null
requested_by_actor_json    text not null
decided_by_actor_json      text null
decision_reason            text null
snapshot_json              text not null
snapshot_hash              text not null
requested_at               integer not null
decided_at                 integer null
expires_at                 integer null
created_at                 integer not null
updated_at                 integer not null
```

Target types:

```text
task_candidate
mission_task
replan_suggestion
mission
scope_expansion
accepted_risk
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

Indexes:

- index `(mission_id, status, created_at)`
- index `(target_type, target_id, approval_type, status)`
- index `(snapshot_hash, status)`

### Canonical TaskCandidate snapshot

snapshot は次の field だけから作る。

```ts
type MissionTaskCandidateSnapshot = {
  schemaVersion: "nightworkers.mission-task-candidate-snapshot/v1";
  missionId: string;
  planningResultId: string;
  taskCandidateId: string;
  workPackageId: string;
  decompositionTaskId: string;
  title: string;
  summary: string;
  initialPrompt: string;
  expectedOutcome: string;
  implementationFocus: string[];
  acceptanceCriteria: string[];
  verificationGate: string[];
  dependencies: string[];
  targetFilesOrModules: string[];
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  scheduling: MissionScheduling;
};
```

Hash algorithm:

1. Zod parse で field を限定する。
2. object key を再帰的に lexical sort する。
3. array order は意味を持つため維持する。
4. canonical JSON を UTF-8 encode する。
5. SHA-256 lowercase hex を保存する。

UI から送られた snapshot を信用せず、server が DB row から生成する。

`autopilot_start` approval は Mission ID、autonomyLevel=`1`、sorted allowedActions、expiresAt を snapshot に含める。`replan` approval は suggestion ID、baseRevisionId、diffHash、affected IDs を snapshot に含める。いずれも同じ canonical JSON / SHA-256 helper を使い、approve / start / apply の直前に再生成して stale 判定する。

### New table: mission_attention_items

Purpose: 人間判断が必要な項目を inbox として保存する。

```text
id                    text primary key
mission_id            text not null FK missions cascade
repository_id         text not null FK repositories cascade
target_type           text not null
target_id             text not null
type                  text not null
status                text not null default 'open'
severity              text not null
title                 text not null
summary               text not null
action_schema_json    text not null
evidence_refs_json    text not null default '[]'
source_event_id       text null FK mission_events set null
source_ref_json       text null
resolved_by_actor_json text null
resolved_at           integer null
created_at            integer not null
updated_at            integer not null
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

Statuses: `open | resolved | dismissed`。

unique open item は service transaction で `(mission_id, type, target_type, target_id, source_ref_json digest)` を dedupe する。

### New table: mission_tasks

Purpose: approved TaskCandidate を Mission 内の実行 work item として保存する。

```text
id                         text primary key
mission_id                 text not null FK missions cascade
repository_id              text not null FK repositories cascade
planning_result_id         text not null FK mission_planning_results restrict
task_candidate_id          text not null FK mission_task_proposals restrict
objective_ids_json         text not null
nightworkers_task_id       text null FK tasks set null
queue_entry_id             text null FK implementation_queue_entries set null
active_run_id              text null FK task_runs set null
approval_id                text not null FK mission_approvals restrict
approval_snapshot_hash     text not null
title                      text not null
purpose                    text not null
status                     text not null default 'approved'
risk_level                 text not null
approval_required          integer not null
dependencies_json          text not null
verification_gate_json     text not null
scheduling_json            text not null
last_synced_at             integer null
created_at                 integer not null
updated_at                 integer not null
```

Statuses:

```text
approved
task_created
queued
running
awaiting_evaluation
satisfied
blocked
failed
deferred
cancelled
```

Indexes:

- unique `(task_candidate_id)`
- unique `(nightworkers_task_id)` where not null
- index `(mission_id, status, created_at)`
- index `(queue_entry_id)`
- index `(active_run_id)`

Rules:

- approved MissionApproval と current snapshot hash が一致する場合だけ作る。
- TaskCandidate の workPackage が参照する `relatedObjectiveIds` を MissionObjective ID へ解決し `objective_ids_json` に保存する。
- one TaskCandidate -> one MissionTask。replan で置き換える場合は新しい planning result / candidate ID を使う。
- MissionTask 作成と NightWorkers Task 作成は同一 service command で行い、部分成功を残さない。

### New table: mission_autopilot_grants

Purpose: Level 1 Autopilot の backend authorization。

```text
id                    text primary key
mission_id            text not null FK missions cascade
repository_id         text not null FK repositories cascade
autonomy_level        integer not null
allowed_actions_json  text not null
status                text not null default 'active'
granted_by_actor_json text not null
expires_at            integer null
paused_at             integer null
revoked_at            integer null
created_at            integer not null
updated_at            integer not null
```

Statuses: `active | paused | revoked | expired`。

Level 1 allowlist:

```text
sync_execution
enqueue_approved_task
evaluate_completed_run
create_replan_suggestion
pause_mission
```

Level 1 denylist:

```text
approve_task_candidate
approve_code_change
approve_schema_change
approve_public_api_change
ignore_verification_failure
execute_destructive_operation
accept_scope_expansion
apply_replan_without_approval
```

active grant は Mission ごとに1件だけにする。

### New table: pilot_actions

Purpose: command idempotency、Autopilot action、判断根拠、結果の audit record。

```text
id                       text primary key
mission_id               text not null FK missions cascade
repository_id            text not null FK repositories cascade
target_type              text null
target_id                text null
type                     text not null
status                   text not null default 'started'
idempotency_key          text not null
request_hash             text not null
reason                   text not null
actor_json               text not null
evidence_refs_json       text not null default '[]'
result_ref_json          text null
next_if_succeeded        text null
next_if_failed           text null
requires_human_attention integer not null default false
error_code               text null
error_message            text null
started_at               integer not null
completed_at             integer null
created_at               integer not null
updated_at               integer not null
```

Indexes:

- unique `(mission_id, type, idempotency_key)`
- index `(mission_id, status, created_at)`
- index `(target_type, target_id, created_at)`

Idempotency behavior:

- same key + same request hash: stored result を返し、mutation を再実行しない。
- same key + different request hash: `409 MISSION_COMMAND_IDEMPOTENCY_CONFLICT`。
- failed action の再試行は新しい idempotency key を要求する。

### New table: mission_evaluations

Purpose: normalized evidence に基づく Mission progress judgment。

```text
id                       text primary key
mission_id               text not null FK missions cascade
repository_id            text not null FK repositories cascade
scope_type               text not null
scope_id                 text not null
mission_task_id          text null FK mission_tasks set null
run_id                   text null FK task_runs set null
result                   text not null
summary                  text not null
objective_updates_json   text not null
evidence_refs_json       text not null
input_digest             text not null
next_recommended_action  text not null
created_by_actor_json    text not null
created_at               integer not null
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

Scope types:

```text
mission
mission_task
```

`scope_id` は mission scope では Mission ID、mission_task scope では MissionTask ID を入れ、NULL uniqueness に依存しない。

Indexes:

- unique `(mission_id, scope_type, scope_id, input_digest)`
- index `(mission_id, created_at)`
- index `(run_id)`

同じ evidence set の再評価は既存 row を返す。

### New table: mission_plan_revisions

Purpose: Mission TaskGraph の applied revision history。

```text
id                    text primary key
mission_id            text not null FK missions cascade
repository_id         text not null FK repositories cascade
base_revision_id      text null FK mission_plan_revisions restrict
planning_result_id    text not null FK mission_planning_results restrict
revision_number       integer not null
summary               text not null
task_graph_json       text not null
applied_diff_json     text null
created_by_actor_json text not null
created_at            integer not null
```

Indexes:

- unique `(mission_id, revision_number)`
- unique `(mission_id, planning_result_id)`

### New table: mission_replan_suggestions

Purpose: failure 時の未適用 TaskGraph diff を保存する。

```text
id                    text primary key
mission_id            text not null FK missions cascade
repository_id         text not null FK repositories cascade
base_revision_id      text not null FK mission_plan_revisions restrict
source_evaluation_id  text not null FK mission_evaluations restrict
status                text not null default 'draft'
reason                text not null
task_graph_diff_json  text not null
diff_hash             text not null
approval_id           text null FK mission_approvals set null
created_at            integer not null
updated_at            integer not null
```

Statuses: `draft | awaiting_approval | approved | rejected | applied | cancelled | stale`。

Indexes:

- unique `(mission_id, source_evaluation_id, diff_hash)`
- index `(mission_id, status, created_at)`

## Shared Contracts

### EvidenceRef

曖昧な `test_evidence` や自由文字列を使わず、現在の table に対応する discriminated union とする。

```ts
type MissionEvidenceRef =
  | { type: "task"; id: string; label?: string }
  | { type: "queue_entry"; id: string; label?: string }
  | { type: "run"; id: string; label?: string }
  | { type: "task_event"; id: string; label?: string }
  | { type: "review_session"; id: string; label?: string }
  | { type: "review_artifact"; id: string; label?: string }
  | { type: "review_finding"; id: string; label?: string }
  | { type: "verification_document"; id: string; label?: string }
  | { type: "verification_evidence_run"; id: string; label?: string }
  | { type: "verification_evidence_case"; id: string; label?: string }
  | { type: "artifact"; id: string; label?: string }
  | { type: "diff"; id: string; label?: string }
  | { type: "command"; id: string; label?: string };
```

ID が見つからない場合でも ref を削除せず、read model が `available: false` を返す。

### Actor

```ts
type MissionActor = {
  type: "human" | "system" | "autopilot";
  id: string | null;
  displayName: string;
};
```

full authentication は対象外のため human id は nullable を許容する。ただし actor type と display name は必須にし、background action は grant ID と PilotAction に紐づける。

### Mission Pilot task metadata

Mission Pilot が作る NightWorkers Task message に次を保存する。

```ts
type MissionPilotTaskMetadata = {
  source: "mission_pilot";
  missionId: string;
  planningResultId: string;
  taskCandidateId: string;
  missionTaskId: string;
  approvalId: string;
  approvalSnapshotHash: string;
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  scheduling: MissionScheduling;
};
```

既存 `missionProposal` metadata も Queue scheduling compatibility のため同じ Task に残す。

### Mission Detail read model

```ts
type MissionPilotDetail = {
  mission: Mission;
  source: {
    type: "user" | "mission_goal" | "project_evaluation";
    refId: string | null;
    evaluationId: string | null;
    label: string | null;
  };
  objectives: MissionObjective[];
  taskCandidates: MissionTaskCandidateView[];
  missionTasks: MissionTaskView[];
  currentPilotAction: PilotAction | null;
  attentionItems: MissionAttentionItem[];
  latestEvaluation: MissionEvaluation | null;
  latestPlanRevision: MissionPlanRevision | null;
  activeAutopilotGrant: MissionAutopilotGrant | null;
  events: MissionEvent[];
  executionSummary: {
    approved: number;
    queued: number;
    running: number;
    awaitingEvaluation: number;
    satisfied: number;
    blocked: number;
    failed: number;
  };
  nextRecommendedAction: {
    type: string;
    reason: string;
    requiresHuman: boolean;
  };
};
```

GET は upstream state を読み、persisted MissionTask status と差があっても mutation しない。差分は `sync-execution` command の対象として `syncRequired: true` 相当の表示にする。

## Approval and Queue Contract

### Approval request

1. server が current TaskCandidate を取得する。
2. candidate が latest planning result に属し、status=`proposed` であることを確認する。
3. canonical snapshot と hash を生成する。
4. MissionApproval `requested`、AttentionItem、MissionEvent を同一 transaction で作る。
5. 同じ target / approval type / snapshot hash の open request があれば既存 row を返す。

### Approval decision

1. approval status が `requested` であることを確認する。
2. current candidate snapshot を server で再生成する。
3. hash が異なる場合、approval を `stale`、AttentionItem を resolved、stale event を追加し `409 MISSION_APPROVAL_STALE` を返す。
4. approve は approval row、AttentionItem、event を同一 transaction で更新する。
5. reject は TaskCandidate 自体を削除せず、approval を rejected にする。proposal の dismiss は既存 command を明示的に呼んだ場合だけ行う。

### Materialize MissionTask

1. approved `queue_admission` approval を取得する。この一つの approval が TaskCandidate snapshot に対する MissionTask 作成と初回 Queue admission を許可する。
2. snapshot hash を再検証する。
3. MissionTask を作る。
4. 既存 Mission Planner の Task description / objective builder を shared helper として再利用し NightWorkers Task を作る。
5. `missionProposal` と `missionPilot` metadata message を保存する。
6. proposal を `task_created` に更新する。
7. MissionTask に NightWorkers Task ID を保存する。
8. MissionEvent と PilotAction result を保存する。
9. すべてを単一 DB transaction に含める。

既存 `createTasksFromMissionTaskProposals` の大きな service をそのまま内側から呼び、外側で MissionTask を作る二重 transaction にはしない。Task builder / metadata helper を shared seam に抽出し、legacy route と Mission Pilot command が同じ helper を使う。

### Queue admission bridge

Mission Pilot Task を Queue へ入れるときは次を満たす。

1. MissionTask status が `task_created` または再投入可能な明示状態である。
2. Mission が paused / abandoned / completed ではない。
3. MissionApproval が approved である。
4. approval snapshot hash と current candidate hash が一致する。
5. NightWorkers Task の `missionPilot` metadata が MissionTask と一致する。
6. Autopilot 呼び出しの場合は active Level 1 grant と allowlist を検証する。
7. PilotAction idempotency receipt を開始する。
8. Queue service の共通 admission function を呼ぶ。
9. Queue entry ID を MissionTask に保存し、event / action を完了する。

Queue service の変更:

- Mission Pilot metadata がある Task は `approveMissionProposal: true` boolean だけで承認済みにしない。
- repository callback または approval verifier interface を通して MissionApproval / snapshot を検証する。
- 検証成功後、legacy `mission_proposal_approval` message に `missionApprovalId` と `snapshotHash` を追加する。
- Mission Pilot metadata がない legacy proposal Task は現行 boolean flow を維持する。
- user text や Task title の keyword 判定で経路を分けず、structured metadata の `source` で分ける。

## Evidence Sync and Evaluation Contract

### Source of truth

- Queue current state: `implementation_queue_entries`
- Run current state: `task_runs`
- Run milestone / verification: `task_events`
- Review state: Review Mode tables
- Test state: Verification tables
- MissionTask status: Mission Control cache / workflow state
- Mission timeline: deduplicated `mission_events`

### sync-execution

`POST /api/missions/:missionId/sync-execution` は次を行う。

1. MissionTask に紐づく Task / Queue / Run を取得する。
2. Queue entry の activeRunId と MissionTask linkage を照合する。
3. canonical task events を `task_run_id, seq` 順で読む。
4. Review / Verification row を Run / Task で取得する。
5. upstream state から MissionTask status を決定する。
6. status update と MissionEvent insert を transaction で保存する。
7. unique source key 競合は既処理として扱う。
8. 未知の upstream status は勝手に terminal へ正規化せず、AttentionItem を作り MissionTask を blocked にする。

Status precedence:

```text
verification failure / blocking finding
  > run failed / blocked / timed_out / needs_human
  > run completed awaiting evaluation
  > run active
  > queue active
  > task created
```

Queue status名と Run status名を同じ union に広げない。adapter で `MissionTaskStatus` に変換する。

### Evidence normalization

evaluation input は raw JSON を直接 LLM に渡さず、typed evidence pack にする。

```ts
type MissionEvaluationEvidencePack = {
  missionId: string;
  missionTaskId: string;
  objectiveIds: string[];
  run: {
    id: string;
    status: string;
    summary: string | null;
    finalJudgment: unknown;
  } | null;
  outcomeEvent: MissionEvidenceRef | null;
  verificationEvents: MissionEvidenceRef[];
  reviewSessions: MissionEvidenceRef[];
  blockingFindings: MissionEvidenceRef[];
  verificationEvidenceRuns: MissionEvidenceRef[];
  failedVerificationCases: MissionEvidenceRef[];
  missingRequiredEvidence: string[];
  inputDigest: string;
};
```

### Deterministic evaluation rules

次を LLM より先に適用する。

1. failed `verification.finished` または failed required verification case があれば `failed`。
2. unresolved blocking review finding があれば `blocked`。
3. Run status が failed / blocked / timed_out / needs_human なら completed にしない。
4. Run completed だけでは Objective を satisfied にしない。
5. required verification evidence が不足する場合は `progressed` 以下。
6. Objective satisfied は、その Objective の verification gate に対応する成功 evidence がある場合だけ。
7. Mission completed は全 required Objective が satisfied、または human-approved deferred の場合だけ。

LLM を使う場合は summary と next recommended action の候補生成に限定する。deterministic veto を上書きできない。prompt は日本語で module側に置き、provider側に Mission Pilot 固有 SystemContext を増やさない。

## Replan Contract

### TaskGraph

TaskGraph の正本表現は current planning result から構築する。

```ts
type MissionTaskGraph = {
  schemaVersion: "nightworkers.mission-task-graph/v1";
  planningResultId: string;
  objectives: Array<{ id: string; title: string }>;
  workPackages: Array<{
    id: string;
    title: string;
    relatedObjectiveIds: string[];
  }>;
  taskCandidates: Array<{
    id: string;
    workPackageId: string;
    title: string;
    dependencies: string[];
    status: "proposed" | "task_created" | "dismissed";
  }>;
};
```

### Typed diff

```ts
type MissionTaskGraphDiffOperation =
  | { op: "add_candidate"; candidate: NewCandidate }
  | { op: "update_candidate"; candidateId: string; patch: CandidatePatch }
  | { op: "defer_candidate"; candidateId: string; reason: string }
  | { op: "add_dependency"; candidateId: string; dependsOnCandidateId: string }
  | { op: "remove_dependency"; candidateId: string; dependsOnCandidateId: string }
  | { op: "add_objective"; objective: NewObjective }
  | { op: "defer_objective"; objectiveId: string; reason: string };
```

MVP では既に queued / running / satisfied の MissionTask を削除・書き換える operation を許可しない。必要な場合は新しい follow-up candidate を追加する。

### Replan generation and apply

1. failed / blocked MissionEvaluation を source に suggestion を作る。
2. Mission Planner owner の structured LLM call で typed diff candidate を生成する。
3. deterministic validator が base revision、ID、dependency cycle、scope expansion、active task mutation を検証する。
4. valid diff を `awaiting_approval` で保存し AttentionItem を作る。
5. approval snapshot は base revision ID、diff hash、affected IDs を含む。
6. apply 時に base revision が current か再検証する。異なれば suggestion / approval を stale にする。
7. approved diff を transaction 内で新 planning result / Objective / TaskCandidate / revision に反映する。
8. apply 後だけ previous candidate を deferred / dismissed 相当に更新する。

## API I/O Contract

すべて `shared/schemas/mission-pilot.schema.ts` を OpenAPI と runtime validation の正本にする。

### Read model

```http
GET /api/missions/:missionId/pilot-detail
```

- `200`: `MissionPilotDetail`
- `404 MISSION_NOT_FOUND`
- mutation なし

### Create Mission from improvement

```http
POST /api/repositories/:repositoryId/missions/from-project-evaluation-improvement
```

Request:

```ts
{
  evaluationId: string;
  improvementIdeaId: string;
  title?: string;
  goalText?: string;
  nonGoals?: string[];
  idempotencyKey: string;
}
```

Behavior:

- repository / evaluation / idea ownership を検証する。
- title default は idea.title。
- goalText default は idea.agentPrompt と expectedOutcome を実行目標として整形する。
- source metadata と `mission_created` event を保存する。
- 同じ source improvement の再送は既存 Mission を返す。
- direct Task link が存在する場合は response warning に含めるが Mission 作成を禁止しない。

Responses:

- `201`: created
- `200`: idempotent existing result
- `404 PROJECT_EVALUATION_NOT_FOUND | IMPROVEMENT_IDEA_NOT_FOUND`
- `409 MISSION_COMMAND_IDEMPOTENCY_CONFLICT`
- `422 IMPROVEMENT_REPOSITORY_MISMATCH`

### Approval request

```http
POST /api/missions/:missionId/approvals
```

```ts
{
  targetType: "task_candidate" | "replan_suggestion" | "mission";
  targetId: string;
  approvalType: "queue_admission" | "replan" | "autopilot_start";
  reason: string;
  idempotencyKey: string;
}
```

shared schema の refinement で許可する組み合わせを次に限定する。

```text
task_candidate    + queue_admission
replan_suggestion + replan
mission           + autopilot_start
```

### Approval decision

```http
POST /api/missions/:missionId/approvals/:approvalId/approve
POST /api/missions/:missionId/approvals/:approvalId/reject
```

Request:

```ts
{ reason: string; idempotencyKey: string }
```

Errors:

- `409 MISSION_APPROVAL_STALE`
- `409 MISSION_APPROVAL_ALREADY_DECIDED`
- `422 MISSION_APPROVAL_TARGET_MISMATCH`

### Materialize TaskCandidate

```http
POST /api/missions/:missionId/task-candidates/:taskCandidateId/materialize
```

```ts
{ approvalId: string; mode: "draft" | "ready"; idempotencyKey: string }
```

Returns MissionTask と NightWorkers Task。

### Enqueue MissionTask

```http
POST /api/missions/:missionId/tasks/:missionTaskId/enqueue
```

```ts
{ idempotencyKey: string; autopilotGrantId?: string }
```

Errors:

- `409 MISSION_TASK_NOT_APPROVED`
- `409 MISSION_APPROVAL_STALE`
- `409 MISSION_PAUSED`
- `409 MISSION_TERMINAL`
- `409 MISSION_TASK_ALREADY_QUEUED`
- existing Queue admission errors

### Sync execution

```http
POST /api/missions/:missionId/sync-execution
```

```ts
{ idempotencyKey: string; missionTaskId?: string }
```

### Evaluate

```http
POST /api/missions/:missionId/evaluate
```

```ts
{ idempotencyKey: string; missionTaskId?: string }
```

sync 済みでない場合は内部で read-only evidence collection を行ってよいが、unknown linkage は推測しない。

### Autopilot

```http
POST /api/missions/:missionId/autopilot/start
POST /api/missions/:missionId/autopilot/pause
POST /api/missions/:missionId/autopilot/resume
POST /api/missions/:missionId/autopilot/revoke
POST /api/missions/:missionId/autopilot/tick
```

start:

```ts
{
  autonomyLevel: 1;
  allowedActions: Level1AllowedAction[];
  expiresAt?: string;
  approvalId: string;
  idempotencyKey: string;
}
```

start 自体も human-approved `autopilot_start` approval を要求する。

### Replan

```http
POST /api/missions/:missionId/replan-suggestions
POST /api/missions/:missionId/replan-suggestions/:suggestionId/request-approval
POST /api/missions/:missionId/replan-suggestions/:suggestionId/apply
```

apply は approved approval ID と idempotency key を要求する。

### Mission lifecycle

```http
POST /api/missions/:missionId/pause
POST /api/missions/:missionId/resume
POST /api/missions/:missionId/abandon
```

completed Mission の resume、abandoned Mission の enqueue は拒否する。

## UI Blueprint

### Mission List

既存 Project Detail `Mission` tab の Goal -> Mission -> TaskCandidate tree を Mission List として再利用する。

Mission row に追加する情報:

- source badge
- Mission status
- open Attention count
- queued / running / blocked summary
- Autopilot active / paused indicator

Mission row click は既存 simple modal ではなく `MissionPilotDetailModal` を開く。Phase 1 では read-only。mutation button は該当 Phase が入るまで表示しない。

### Mission Detail layout

単一 column、上から次の順にする。

1. `MissionPilotHeader`
   - title、goal、source、status、next recommended action
2. `AttentionInboxPanel`
   - open item がある場合だけ上部に表示
3. `ObjectiveProgressPanel`
4. `MissionTaskCandidatePanel`
5. `MissionTaskGraphPanel`
6. `AutopilotControlPanel`
7. `MissionEvaluationPanel`
8. `MissionTimelinePanel`
9. `EvidenceDrawer` は選択時の overlay
10. `ReplanSuggestionPanel` は suggestion がある場合だけ表示

generic KPI dashboard や chart は追加しない。主目的は状態、根拠、次の承認点を順に確認することである。

### Project Evaluation entry

`ImprovementIdeaGrid` の selected ideas 一括 Task 化は残す。

各 `ImprovementIdeaCard` または選択 action area に `Missionを作成` を追加する。1回の action は1 improvement -> 1 Mission とし、複数 improvement を一つの Mission に暗黙統合しない。

作成成功後:

- Task session へ自動遷移しない。
- Project Detail Mission tab を再取得する。
- 作成した Mission Detail を開く。
- idempotent existing result の場合も同じ Mission を開く。

### TaskCandidate actions

source が `mission_task_proposal` の row:

- risk、approvalRequired、verificationGate、scheduling を表示する。
- Phase 3 以降は Request approval / Approve / Reject。
- Phase 4 以降は approved 状態で Materialize。

source が `mission_task_candidate` の row:

- 既存 Create Task / Dismiss を維持する。
- Mission Pilot approval action を表示しない。

### i18n

新規 user-facing copy は `src/i18n/dictionaries/ja.ts` と `en.ts` に同じ key を追加する。日本語 UI copy を正として維持し、raw status や `proposal` をユーザーへ露出しない。

## Implementation Phases

各 Phase は独立して review / rollback できる単位とする。focused verification が失敗した場合は次 Phase に進まない。

### Phase 0: Baseline Characterization

Phase status: `complete` (2026-07-10)

Goal: mutation を増やす前に既存境界を test で固定する。

Changes:

- `tests/mission-pilot-baseline.test.ts` を追加する。
- Mission proposal -> Task metadata の characterization test。
- approvalRequired proposal の現行 Queue guard を baseline test で明示的に固定する。
- `mission_task_candidates` と `mission_task_proposals` が別 source である adapter test。
- canonical TaskCandidate snapshot helper / schema / hash test。
- EvidenceRef schema test。
- Project Detail の unified TaskCandidate model smoke test を追加する。
- 現行 Mission-related table の bootstrap idempotency / table一覧 test を追加する。
- Agent Ontology に `mission-pilot` ownership と cross-module boundary を登録する。

Must not change:

- DB table
- API route
- Queue behavior
- Project Detail behavior
- approval behavior

Verification:

```bash
bun run test run tests/mission-pilot-baseline.test.ts tests/mission-planner.test.ts tests/project-detail-backend.test.ts tests/agent-ontology.test.ts
bun run verify
```

Expected:

- existing Mission decomposition -> review_pending -> proposal -> Task path が成功する。
- approvalRequired proposal は legacy approval metadata なしで Queue に入らない。
- two candidate sources が別 contract として判別される。
- same snapshot は同じ SHA-256、意味のある field 変更は異なる hash になる。

Failure handling:

- test が current behavior と違う場合、計画を current code に合わせて再評価し、test を理想状態へ書き換えて通さない。
- unrelated `bun run verify` failure は command、failure名、baseline再現性を記録し、明示的な受容なしに Phase 1 へ進まない。

Done gate:

- characterization が green。
- first schema PR の変更範囲が確定。

Completion evidence:

- focused suite: 4 files / 53 tests passed。
- TaskCandidate adapter、snapshot/hash helper、EvidenceRef schema は既存 runtime path に未接続。
- DB table、API route、Queue service、Project Detail component の挙動変更なし。
- repository representative gate: `bun run verify` passed。

### Phase 1: Read-only Mission Cockpit

Phase status: `complete` (2026-07-10)

Goal: 既存 Mission / planning result / TaskCandidate を mutation なしで Mission Control として読めるようにする。

DB:

- `mission_objectives`
- `mission_events`
- `mission-pilot-schema.ts`
- `mission-pilot-schema-bootstrap.ts`
- Drizzle migration
- client registration / bootstrap registration

Backend:

- planning result -> MissionObjective upsert helper。
- decompositionが `review_pending` になる transaction に Objective upsert と initial events を追加する。
- `GET /api/missions/:missionId/pilot-detail`。
- TaskCandidate adapter は `mission_task_proposals` のみを返す。
- Attention summary はこの Phase では approvalRequired TaskCandidate から read-time derivationする。
- Queue / Run summary は read-only join で算出する。

Frontend:

- `MissionPilotDetailModal`
- Header / Objective / TaskCandidate / derived Attention / Timeline panel
- button は追加しない。
- existing Mission tree / simple modal のユーザー所有差分を保全する。

Verification:

```bash
bun run test run tests/mission-pilot-baseline.test.ts tests/mission-pilot-read-model.test.ts tests/project-detail-backend.test.ts tests/project-detail-mission-pilot.test.tsx
bun run verify
```

Expected:

- fresh DB と既存 DB の両方で schema 初期化できる。
- missing objective/event rows を許容する。
- review_pending Mission で Objective / TaskCandidate / derived attention が読める。
- GET で DB updated_at や event件数が変化しない。
- 既存 Project Detail tree が退行しない。

Failure handling:

- bootstrap / migration DDL差分が出たら次 Phaseへ進まず両方を同期する。
- read model のために GET mutation を入れない。

Done gate:

- read-only cockpit が既存 state を説明できる。
- approval / enqueue / autopilot mutation は未実装。

### Phase 2: Project Evaluation Improvement -> Mission

Phase status: `complete` (2026-07-10)

Goal: Project Evaluation improvement を Mission Pilot の優先入口にする。

DB:

- `missions` source columns。
- `pilot_actions` command receipt table。
- source unique index。
- migration / bootstrap / shared Mission schema を同期。

Backend:

- Project Evaluation repository に evaluation + idea ownership read helper。
- create Mission command と idempotency。
- source event。
- existing `project_evaluation_task_links` warning。
- direct Task creation route は変更しない。

Frontend:

- `Missionを作成` action。
- Mission tab refresh。
- created / existing Mission Detail open。
- duplicate click guard と idempotency key。

Verification:

```bash
bun run test run tests/mission-pilot-source.test.ts tests/project-evaluation-real-logic.test.ts tests/project-evaluation-improvement-card.test.tsx tests/frontend-controller-hooks-coverage.test.ts
bun run verify
```

Expected:

- repository mismatch は拒否される。
- same improvement の再送は同じ Mission を返す。
- existing direct Task link は warning になり Mission 作成はできる。
- existing direct Task 化が退行しない。

Failure handling:

- source重複が発生した場合、UI disableだけで対処せず DB unique / transaction を修正する。

Done gate:

- Project Evaluation から source-linked Mission を作成し cockpit を開ける。

### Phase 3: Approval and Attention

Phase status: `complete` (2026-07-10)

Goal: TaskCandidate の human decision を snapshot-bound record にする。

DB:

- `mission_approvals`
- `mission_attention_items`

Backend:

- snapshot / hash / stale validator。
- request / approve / reject commands。
- open approval dedupe。
- Attention create / resolve。
- MissionEvent / PilotAction audit。

Frontend:

- risk / approvalRequired / verificationGate / scheduling表示。
- Request approval / Approve / Reject。
- stale状態。
- Attention Inbox。

Verification:

```bash
bun run test run tests/mission-pilot-approval.test.ts tests/mission-pilot-read-model.test.ts tests/mission-planner.test.ts tests/project-detail-mission-pilot.test.tsx
bun run verify
```

Expected:

- changed candidate は approval stale。
- stale / rejected approval で materializeできない。
- decision により Attention が resolved。
- action / event / approval が transaction 単位で一致する。

Failure handling:

- snapshot field不足をUI確認で補わない。canonical snapshot contractを修正して再試験する。

Done gate:

- human decision が audit可能で、候補変更を検出できる。

### Phase 4: MissionTask and Queue Bridge

Phase status: `complete` (2026-07-10)

Goal: approved TaskCandidate を既存 Queue へ安全に接続する。

DB:

- `mission_tasks`
- Queue linkage index / migration / bootstrap parity。

Backend:

- legacy Task builder helper抽出。
- materialize command。
- Mission Pilot metadata。
- Queue approval verifier interface。
- enqueue command / idempotency。
- MissionTask current state adapter。
- legacy boolean compatibility branch。

Frontend:

- approved -> task_created -> queued state表示。
- MissionTask / Queue / Run link。
- Mission Pilot pathの Materialize / Enqueue action。

Verification:

```bash
bun run test run tests/mission-pilot-queue.test.ts tests/mission-pilot-approval.test.ts tests/mission-planner.test.ts tests/implementation-queue-resilience.test.ts tests/project-queue-model.test.ts
bun run verify
```

Expected:

- unapproved / stale candidate は MissionTask にできない。
- same materialize key は同じ MissionTask / Task を返す。
- Mission Pilot metadata Task は legacy boolean だけでは Queue に入らない。
- approved MissionTask は Queue に一度だけ入る。
- legacy proposal Task の現行 Queue approval flow は維持される。
- scheduling metadata が existing Queue executionTypeへ反映される。

Failure handling:

- Queue側に Mission Pilot専用 bypassを作らない。
- transaction partial failureで orphan Task / MissionTask が残る場合、次Phaseへ進まない。

Done gate:

- approved execution の縦切りが Queue entry 作成まで通る。

### Phase 5: Level 1 Autopilot

Goal: Mission画面から、承認済み作業だけを1 actionずつ進める。

DB:

- `mission_autopilot_grants`
- Mission status `paused`, `abandoned`

Backend:

- start / pause / resume / revoke。
- grant allowlist / expiry。
- deterministic next action resolver。
- one-action tick。
- lifecycle hookからの best-effort tick request。

Tick order:

```text
mission terminal / paused -> stop
grant missing / paused / revoked / expired -> stop
open human attention -> stop
approved MissionTask not queued -> enqueue one
completed Run not evaluated -> evaluate one
failed evaluation without suggestion -> create one suggestion
otherwise -> no_op
```

Lifecycle hook:

- Queue / Run finalize 自体を Mission Pilot failureで失敗させない。
- hook は mission metadata がある場合だけ Mission sync/tickをrequestする。
- hook failure は task event / log と Attention に残し、manual syncで再実行可能にする。

Frontend:

- Start / Pause / Resume / Revoke。
- active grant、expiresAt、allowed actions。
- next action / stop condition。

Verification:

```bash
bun run test run tests/mission-pilot-autopilot.test.ts tests/mission-pilot-queue.test.ts tests/implementation-queue-resilience.test.ts
bun run verify
```

Expected:

- Level 2+はschemaで拒否。
- grantはapprovalを作らない。
- revoked / expired / pausedで新 actionなし。
- 1 tickで複数 mutationを実行しない。
- same tick idempotency keyで重複 enqueueなし。

Failure handling:

- schedulerを追加して解決しない。
- stop condition不明は no_opではなく Attention + blocked とする。

Done gate:

- command-driven Level 1 Approved Execution が監査可能。

### Phase 6: Evidence Sync and MissionEvaluation

Goal: execution evidence を Mission progress に接続する。

DB:

- `mission_evaluations`

Backend:

- Queue / Run / task event adapter。
- Review / Verification evidence adapter。
- sync-execution。
- evidence pack / digest。
- deterministic evaluator。
- Objective update transaction。
- Mission completion guard。

Frontend:

- MissionEvaluation panel。
- Objective evidence refs。
- EvidenceDrawer。
- sync required / evaluation required表示。
- failure Attention。

Verification:

```bash
bun run test run tests/mission-pilot-evaluation.test.ts tests/services.run-events-replay.test.ts tests/services.review-results.test.ts tests/review-status-viewer.test.tsx tests/project-detail-mission-pilot.test.tsx
bun run verify
```

Expected:

- same upstream evidenceのsync/event/evaluationは重複しない。
- failed verificationでMission completedなし。
- blocking findingでObjective blocked。
- Run completedだけではObjective satisfiedなし。
- required success evidenceでObjective satisfied。
- 全required Objective satisfiedでのみMission completed。

Failure handling:

- evidence link不明をtitle / message keywordで推測しない。
- missing evidenceはsuccess扱いせず progressed / blockedに留める。

Done gate:

- Queue投入からevidence-based evaluationまで一周できる。

### Phase 7: Replan Suggestion and Revision

Goal: failure時に勝手に続行せず、承認可能なTaskGraph差分を作る。

DB:

- `mission_plan_revisions`
- `mission_replan_suggestions`

Backend:

- current TaskGraph snapshot / revision。
- latest planning result から initial revision を一度だけ作る backfill command。
- typed diff schema。
- suggestion generator。
- cycle / active-task / scope validator。
- approval connection。
- stale base detection。
- apply transaction。

Frontend:

- ReplanSuggestion panel。
- diff preview。
- Request approval / Approve / Reject / Apply。
- affected Objective / candidate / dependency表示。

Verification:

```bash
bun run test run tests/mission-pilot-replan.test.ts tests/mission-pilot-evaluation.test.ts tests/mission-planner.test.ts tests/project-detail-mission-pilot.test.tsx
bun run verify
```

Expected:

- failureからsuggestion + Attention。
- unapproved / stale suggestionはTaskGraphを変更しない。
- dependency cycleを拒否。
- running / satisfied task mutationを拒否。
- approved applyでrevision numberが1だけ増える。
- same apply keyで二重revisionなし。

Failure handling:

- invalid LLM diffを固定fallback mutationに置き換えない。
- validation failureはsuggestionをblockedにし、人間へ根拠を表示する。

Done gate:

- failure -> suggestion -> human approval -> revision apply が通る。

### Phase 8: Integrated MVP Closeout

Goal: 全Phaseを一つのcredential-free fixtureで通し、運用可能なMVPとして閉じる。

Changes:

- integration fixture / test。
- Mission List summary / Attention count最終統合。
- error copy / empty state / accessibility。
- migration / bootstrap parity最終確認。
- archive文書の参照整理。ただしこのactive planは実装完了までarchiveしない。

Verification:

```bash
bun run test run \
  tests/mission-pilot-baseline.test.ts \
  tests/mission-pilot-read-model.test.ts \
  tests/mission-pilot-source.test.ts \
  tests/mission-pilot-approval.test.ts \
  tests/mission-pilot-queue.test.ts \
  tests/mission-pilot-autopilot.test.ts \
  tests/mission-pilot-evaluation.test.ts \
  tests/mission-pilot-replan.test.ts \
  tests/mission-pilot-integration.test.ts \
  tests/project-detail-backend.test.ts \
  tests/mission-planner.test.ts
bun run verify
bun run verify:full
```

Expected integration flow:

1. fixture Project Evaluation improvementを作る。
2. Mission作成。
3. decomposition -> review_pending。
4. Objective / TaskCandidate表示。
5. approval request / approve。
6. MissionTask / NightWorkers Task作成。
7. Queue投入。
8. completed Run / Review / Verification evidence投入。
9. sync / evaluate。
10. success fixtureはMission completed。
11. failure fixtureはcompletedにならずReplanSuggestion。
12. approve / applyでnew revision。

Failure handling:

- final gate failure時はplanをcompletedへ変更しない。
- broad gateの既知不安定性を理由にfocused testだけでMVP完了扱いしない。ユーザーが明示的にgateを上書きした場合だけ、その受容範囲を文書化する。

Done gate:

- Success Conditionsをすべてevidence付きで確認。

## Safety Invariants

必ずtestで固定する。

1. raw draft planning result は TaskCandidate approval対象にならない。
2. stale planning result のTaskCandidateはapproval / materializeできない。
3. Mission Pilot TaskCandidateは`mission_task_proposals`だけである。
4. Goal generation candidateをMissionApproval対象として誤認しない。
5. server-generated snapshot以外をhash対象にしない。
6. changed snapshotはapproval stale。
7. Mission Pilot pathはapproved MissionApprovalなしにMissionTaskを作らない。
8. approvalRequired TaskはMissionApprovalなしにQueueへ入らない。
9. legacy booleanはMission Pilot metadata Taskを承認済みにしない。
10. Queue bypass routeを作らない。
11. command idempotency conflictは409。
12. same commandを再送して重複row / Queue entry / eventを作らない。
13. paused / abandoned / completed Missionは新enqueueしない。
14. revoked / expired / paused grantはactionを作らない。
15. Autopilotはapprovalを作成・承認しない。
16. 1 tickは最大1 mutation。
17. GETはmutationしない。
18. verification failureはMission completedにならない。
19. blocking findingは該当Objectiveをsatisfiedにしない。
20. missing required evidenceはsuccessにならない。
21. replan approval前にTaskGraphを変更しない。
22. stale base revisionのreplanをapplyしない。
23. queued / running / satisfied taskをreplanで破壊しない。
24. upstream evidenceをMissionEvent JSONだけで代替しない。
25. lifecycle hook failureで元のQueue / Run finalizeをrollbackしない。

## Migration and Compatibility Strategy

### Additive first

- existing table / route renameをしない。
- Phaseごとに必要tableだけ追加する。
- column追加はnullableまたは安全defaultから始める。
- destructive backfillをしない。
- current Mission rowにMission Pilot rowがなくてもread modelは動作する。

### Bootstrap parity

各DB Phaseで次を確認する。

```text
Drizzle table definition
  == runtime bootstrap DDL
  == migration SQL result
  == shared schema mapper expectation
```

fresh DB と既存 DB copy の両方で `ensureNightWorkersSchema()` を2回実行し、2回目がno-opであることをtestする。

### Backfill

- 既存 Mission に latest planning result がある場合、明示 commandまたはPhase1 utilityでObjectiveをupsertできる。
- GETでlazy backfillしない。
- 既存 proposal Task はMission Pilot metadataがないためlegacy evidenceとして表示する。
- metadataからMission / proposal / Task linkageが一意に確認できる場合だけmanual migration utilityでMissionTaskへlinkする。
- live DBは計画刷新時点でMission系rowが0件のため、MVP実装の必須backfillはない。ただしtestは既存rowありを含める。

### Legacy paths

維持する:

- goal generation `mission_task_candidates`
- `POST /api/mission-task-proposals/create-tasks`
- `approveMissionProposal` boolean for non-Mission-Pilot legacy Task
- Project Evaluation direct Task creation

Mission Pilot UIからは使用しない。

## Error and Observability Contract

Mission Pilot domain errorは固定 codeとstructured detailsを持つ。LLM本文が返った場合に固定本文へ差し替える用途には使わない。

最低限のcode:

```text
MISSION_NOT_FOUND
MISSION_SOURCE_NOT_FOUND
MISSION_SOURCE_MISMATCH
MISSION_TASK_CANDIDATE_NOT_FOUND
MISSION_TASK_CANDIDATE_STALE
MISSION_APPROVAL_REQUIRED
MISSION_APPROVAL_STALE
MISSION_APPROVAL_ALREADY_DECIDED
MISSION_TASK_ALREADY_MATERIALIZED
MISSION_TASK_NOT_APPROVED
MISSION_TASK_ALREADY_QUEUED
MISSION_COMMAND_IDEMPOTENCY_CONFLICT
MISSION_AUTOPILOT_GRANT_REQUIRED
MISSION_AUTOPILOT_ACTION_FORBIDDEN
MISSION_PAUSED
MISSION_TERMINAL
MISSION_EVIDENCE_INCOMPLETE
MISSION_REPLAN_STALE
MISSION_REPLAN_INVALID
```

記録先:

- user-visible current state: Mission Detail read model
- audit: PilotAction / MissionEvent / MissionApproval
- source evidence: existing Queue / Run / Review / Verification rows
- operational failure: existing app log / task event。Mission Pilot failureでLLM本文を固定エラーへ置換しない。

## PR / Commit Boundaries

推奨PR順:

1. Phase 0 only
2. Phase 1 DB + read model + read-only UI
3. Phase 2 Project Evaluation source
4. Phase 3 approval / attention
5. Phase 4 MissionTask / Queue bridge
6. Phase 5 Autopilot
7. Phase 6 evidence / evaluation
8. Phase 7 replan
9. Phase 8 integration closeout

各PRは前Phaseのgreenを前提とする。複数Phaseを同じPRにまとめない。

最初のPRに含める:

- characterization tests
- TaskCandidate source adapter
- snapshot/hash helper
- EvidenceRef schema

最初のPRに含めない:

- DB migration
- Mission Detail UI
- approval command
- Queue mutation
- Autopilot
- MissionEvaluation
- replan

## Risks

### High: legacy approval bypass

`approveMissionProposal: true` がpublic requestで指定可能。Mission Pilot metadata Taskに同じbranchを適用するとsnapshot approvalを迂回する。

Mitigation: structured metadataでMission Pilot Taskを識別し、MissionApproval verifierを必須にする。

### High: dual TaskCandidate confusion

UIが2 sourceを一つに表示しているため、Goal generation candidateをMission Pilot candidateとして扱う恐れがある。

Mitigation: canonical sourceをproposalに限定し、source badge / action分岐をtestする。

### High: DB definition drift

Drizzle migrationとruntime bootstrapが別経路で、片方だけ更新するとfresh DBと既存DBで差が出る。

Mitigation: Phaseごとのparity testとschema registration確認。

### High: evidence false completion

Run completedだけをMission completedへ昇格するとReview/Test failureを見落とす。

Mitigation: deterministic veto、required evidence、blocking finding test。

### Medium: sync duplication

focus refresh、manual sync、lifecycle hookが同じeventを複数回処理し得る。

Mitigation: source-based unique key、input digest、command receipt。

### Medium: transaction boundary

MissionTask、NightWorkers Task、metadata、proposal statusが別transactionだとorphanが残る。

Mitigation: shared helperとsingle transaction。

### Medium: user-owned UI diff

ProjectDetailDialogsに未コミット変更がある。

Mitigation: Phase 0/1開始前にdiffを再確認し、対象hunkを保全する。

### Medium: replan scope expansion

LLM-generated diffが元Missionを越える可能性がある。

Mitigation: typed operation allowlist、scope validator、Attention、human approval。

## Completion Checklist

- [x] Phase 0 characterization green
- [x] Phase 0 `bun run verify` green
- [x] DB bootstrap / migration parity green through Phase 8
- [x] read-only Mission cockpit
- [x] Project Evaluation improvement source
- [x] snapshot-bound approval / Attention
- [x] approved MissionTask materialization
- [x] existing Queue guard bridge
- [x] idempotent Level 1 Autopilot
- [x] evidence sync / MissionEvaluation
- [x] verification failure completion veto
- [x] approved replan apply
- [x] Mission List / Detail / Attention / timeline / evidence UI
- [x] accessibility / empty / stale / error states
- [x] focused Mission Pilot integration suite green
- [x] `bun run verify` green for every implemented Phase
- [x] final `bun run verify:full` green
- [x] archive documents are only informational references

## Implementation Closeout

Phase 0-8 は完了した。今後この文書は Mission Pilot MVP の実装契約、safety invariant、検証記録の正本として維持する。MVP後の拡張では Level 1 approval boundary、既存 Queue guard、evidence-based completion、typed replan revision を後退させない。

### Phase 1-4 implementation record (2026-07-10)

- Phase 1: `mission_objectives` / `mission_events`、read-only detail API、Project Detail cockpit、GET no-mutation testを実装。
- Phase 2: Project Evaluation improvement source、source uniqueness、PilotAction receipt、作成後のMission cockpit遷移を実装。
- Phase 3: canonical snapshot hash、request / approve / reject / stale、persisted Attentionとaudit eventを実装。
- Phase 4: MissionTask materialize、Mission Pilot metadata、Queue approval verifier、legacy boolean bypass防止、idempotent enqueueを実装。
- focused verification: Phase 1 `31 tests`、Phase 2 `11 tests`、Phase 3 `21 tests`、Phase 4 `37 tests` の各実行がgreen。
- representative verification: Phase 2後とPhase 4後の `bun run verify` がgreen。
- user-owned `ProjectDetailDialogs.tsx` の既存差分は変更していない。

### Phase 5-8 implementation record (2026-07-10)

- Phase 5: human-approved Level 1 grant、allowlist、start / pause / resume / revoke、one-action tick、Mission lifecycle guard、Run finalizeからのbest-effort sync / tick hookを実装。
- Phase 6: Queue / Run / task event / blocking review finding / verification evidenceの同期、MissionEvaluation、Objective更新、completion veto、証拠表示を実装。
- Phase 7: TaskGraph snapshot、typed diff、cycle / active-task / scope validator、replan approval、stale-base検出、revision applyを実装。
- Phase 8: Project Evaluation improvementからMission completionまでのcredential-free integration fixtureと、failureからapproved replan applyまでの統合経路を固定。
- focused verification: Mission Pilot 12 test files、68 tests green。
- representative verification: `bun run verify` green。
- final verification: `bun run verify:full` green。Vitest 260 files / 1822 tests、Playwright deterministic E2E、demo smoke、dependency audit、desktop tests / lint / build / sidecar / packaged smokeを含む。
