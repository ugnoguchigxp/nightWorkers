# Mission Pilot Pre-Queue Handoff Remediation 実装計画

## Status

- Plan status: `reviewed-ready-for-implementation`
- Document created: 2026-07-11
- Implementation status: `not_started`
- Remediation target: completed MVP Slice 1/2 implementation
- Baseline reviewed: 2026-07-11, `main` at `c597bdd522ef7e4594157131c9d1865ce9ea148b`
- Input designs:
  - `spec/archive/mission-pilot-task-entry-design.md`
  - `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`
- Downstream plan: `spec/docs/mission-pilot-test-review-archive-implementation-plan.md`
- Target runtime span: initial PlayからPlan Mode、Questionnaire、Artifact、self-review、Implementation Queue admission完了まで

この文書は、実装済みMission Pilot MVP Slice 1/2に残るpre-Queue handoff不整合だけを修正するための独立した実装正本である。Task生成、Mission Pilot Session、Play / Stop、Questionnaire autonomy、Artifact生成、Plan self-review、Queue admissionの完成済み設計を作り直さない。

本書の完了条件は、Mission Pilotの初回PlayがQueue前にImplementation runを開始せず、最新Context revisionとVerification Documentを持つTaskをImplementation Queueへexactly-onceで引き渡せることである。Queue claim後のImplementation、Test Mode、Review Mode、Git closeout、Task completion、Task Archiveはdownstream planの責務であり、本書には含めない。

## 1. 現在確認できる不整合

### 1.1 Code path

現在の`api/modules/missionPilot/mission-pilot.service.ts`は初回Playでinitial promptを永続化した後、`resumeWorkbenchIntakeMessage()`を呼ぶ。

`resumeWorkbenchIntakeMessage()`は汎用WorkBench intakeであり、`decideWorkbenchPlanModeGate()`の結果がPlan Modeでなければ`executionModeSource: "workbench_intake"`のImplementation runを開始できる。Mission PilotのphaseとauthorizationはPlan -> Queue -> Implementationの順序を要求するため、この汎用routing結果をMission Pilotのphase遷移正本にしてはならない。

そのImplementation runがTaskをterminal statusへ進めると、後続のPlan Artifact generatorは`assertPlanModeMutable()`で拒否される。結果として、Session / Context / plan stepは残っていてもQueue admission前にTask lifecycleが閉じる可能性がある。

### 1.2 2026-07-11 local runtime evidence

local `sqlite.db`では次の状態を確認した。

```text
Mission Pilot Session: 1
Task status: completed
Session phase: attention
Session desired_state: stopped
Session error: MISSION_PILOT_PLAN_PIPELINE_FAILED
Session error message: Terminal sessions cannot modify Plan Mode artifacts.
TaskRun: completed / executionMode=implementation
TaskRun source: workbench_intake
TaskRun missionPilot envelope: absent
Implementation Queue entry: absent
mission_pilot_events table: absent
```

このrowを正常なQueue handoffとして扱わない。また、既存Implementation runが実repoを変更済みである可能性があるため、migrationやstartup reconcileでTaskを自動的に`ready`へ戻さない。

## 2. 目的

次のpre-Queue lifecycleを決定的に成立させる。

```text
Mission Pilot Task created / stopped
  -> first Play authorization v2 activation
  -> initial prompt message exactly-once
  -> Mission Pilot Plan intake
  -> Questionnaire autonomy / intervention
  -> ordered Plan Artifact generation
  -> Feature Plan + Verification Document
  -> structured Plan self-review pass
  -> latest Context revision / digest freeze
  -> Implementation Queue entry exactly-once
  -> Session phase queued
  -> downstream post-Queue coordinatorへ引き渡し可能
```

Queue admission前にはImplementation/Test/Review runを開始しない。初回PlayのLLM判断がImplementationを選んでも、Mission Pilot workflowのtyped phase契約を上書きさせない。

## 3. 成功条件

1. Mission Pilot初回Playが汎用`workbench_intake` Implementation runを開始しない。
2. initial prompt TaskMessageは既存unique境界でexactly-onceに保存される。
3. Mission Pilot Plan intakeはtyped command / portから開始される。
4. ユーザー文言のkeyword / regex分類を追加しない。
5. Plan intakeはQuestionnaire生成または既存Questionnaire再利用へ進む。
6. Questionnaire timeout / intervention / resumeの現行契約を維持する。
7. Artifact step order、step claim、Context append、self-reviewを再利用する。
8. Queue admission直前にTaskがnon-terminalであることを検証する。
9. Queue admission直前に最新Feature Planと対応Verification Documentを検証する。
10. Queue admission直前にlatest Context revision / digestとreview pass digestを検証する。
11. active Queue entryはTaskごとに最大1件である。
12. Queue entry作成成功後だけSession phaseを`queued`へ確定する。
13. Queue entry作成response loss時はDB rowを再読し、重複entryを作らない。
14. process restart後もcompleted plan stepsを再生成しない。
15. Queue admission済みSessionはpre-Queue coordinatorが再処理しない。
16. pre-existing terminal Taskを自動的に再開しない。
17. known handoff corruptionは構造化diagnostic付き`attention`へ分類する。
18. remediation後、新規Mission Pilotの最初のImplementation runはQueue claim後にだけ作られる。
19. 通常TaskのWorkBench intake routingに回帰がない。
20. downstream planが要求するQueue handoff contractをAPI / DB testで固定する。

## 4. Locked Decisions

1. この修正は完成済みSlice 1/2の再設計ではない。
2. `mission_pilot_sessions`を唯一のlong-lived control/state ownerとして維持する。
3. `mission_pilot_context_snapshots`のrevision / digest chainを維持する。
4. `mission_pilot_steps`と`mission_pilot_plan_reviews`をpre-Queue progress/evidence正本として維持する。
5. initial prompt TaskMessageの既存exactly-once境界を維持する。
6. Mission PilotのPlan開始判断を汎用WorkBench natural-language routingへ委譲しない。
7. Mission Pilot専用のtyped Plan intake portを追加する。
8. typed Plan intakeは既存Questionnaire / plan coordinator serviceを呼び、新しいPlan engineを作らない。
9. 通常Taskの`resumeWorkbenchIntakeMessage()` contractは変更しない。
10. ユーザー文言のkeyword / regexでMission Pilot判定を行わない。
11. llm-providerへMission Pilot workflow判断を追加しない。
12. prompt文言は日本語を維持する。
13. Queue admission前にImplementation runを作らない。
14. Queue scheduler / lease / capacity / claimは既存Queue domainを正本とする。
15. pre-Queue planはImplementation Queue entry作成までを所有し、claim後run associationはdownstream planへ委譲する。
16. terminal Taskの自動status rollbackは行わない。
17. 既存repo変更、commit record、run evidenceがあるcorrupt Sessionはoperator-visible `attention`に止める。
18. Restore / Reopen / Task Archive lifecycleはこの計画に追加しない。
19. 汎用`mission_pilot_events` ledgerはこのremediationの必須条件にしない。post-Queue exactly-once event基盤はdownstream planで追加する。
20. completed remediation planは検証後に`spec/archive`へ移す。

## 5. Scope

### 5.1 含む

- initial Playからtyped Plan intakeへの接続。
- generic WorkBench intakeからのMission Pilot分離。
- pre-Queue Task lifecycle guard。
- Questionnaire / Artifact / self-review / Queue admissionのhandoff再検証。
- Queue entry exactly-once確認。
- queued handoff projection。
- startup reconcileでのpre-Queue Session分類。
- known corrupt Sessionのattention diagnostic。
- pre-Queue focused / integration / restart / browser E2E。
- downstream handoff contract test。

### 5.2 含まない

- Task生成UIやMission Pilot buttonの再設計。
- authorization v2 schemaの再設計。
- Questionnaire UI / timeout policyの再設計。
- Plan Artifact内容やself-review rubricの刷新。
- Queue scheduler / lease algorithmの刷新。
- Queue claim後のImplementation run association。
- Test Mode / Review Mode / Git closeout / true Archive。
- 既存terminal Taskの自動再実行。
- 汎用WorkBench intakeのrouting policy変更。
- unrelated Mermaid render/typecheck修正。

## 6. Input / Output Contract

### 6.1 Input

pre-Queue coordinatorが受け付けるSessionは次を満たす。

- `desired_state === playing`
- authorization version 2がschema-valid
- Taskが`completed | cancelled | failed | timed_out | archived`ではない
- Session phaseが`created | starting | initial_intake | waiting_intervention | generating_artifacts | reviewing_plan | queueing`のいずれか
- post-Queue phase runが存在しない

### 6.2 Queue handoff output

handoff完了時は次をすべて満たす。

```ts
type MissionPilotQueueHandoff = {
  sessionId: string;
  taskId: string;
  queueEntryId: string;
  contextRevision: number;
  contextDigest: string;
  featurePlanMessageId: string;
  verificationDocumentId: string;
  planReviewId: string;
  planReviewVerdict: "pass";
  queuedAt: string;
};
```

このpayloadはSession/Context/plan review/Queue entryから再構築可能にする。Queue handoff専用の第二control rowは作らない。必要なrefはlatest Context snapshotまたはSession projectionへ保存する。

### 6.3 Invalid handoff

次は`queued`にしない。

- Task terminal。
- Feature Planなし。
- Verification Documentなし、inactive、またはFeature Planと不一致。
- Plan reviewがpassでない。
- reviewed Context digestとlatest digestが不一致。
- active Queue entryが複数存在する。
- pre-Queue段階でImplementation/Test/Review runが存在する。
- Session authorization / sourceRef不整合。

## 7. Architecture

```text
MissionPilotService.play
  -> authorization / initial prompt claim
  -> MissionPilotPlanIntakePort.startOrResume
       -> existing Questionnaire service
       -> existing questionnaire event/listener
       -> MissionPilotPlanCoordinator
            -> existing step repository
            -> existing Artifact generators
            -> existing Plan self-review
            -> QueueHandoffGate
                 -> existing Queue service
                 -> persist queued projection
  -> UI realtime projection
```

`MissionPilotPlanIntakePort`はMission Pilot workflowのtyped phase commandであり、ユーザー本文を分類しない。通常TaskのWorkBench intakeは引き続きSupervisor routingを使う。

## 8. 実装方針

### 8.1 Typed Plan intake

`mission-pilot.service.ts`から`resumeWorkbenchIntakeMessage()`呼び出しを除去し、Mission Pilot専用portへ置き換える。

portは次を行う。

1. Session / Task / authorizationを再読する。
2. initial prompt message IDを入力evidenceとして受け取る。
3. 既存Questionnaireがあれば再利用する。
4. Questionnaireがなければ既存Questionnaire serviceで作成する。
5. Questionnaire ready / acceptedならplan pipelineをscheduleする。
6. interventionが必要なら既存`waiting_intervention`へ遷移する。
7. TaskRunを作らない。

### 8.2 Task lifecycle guard

Plan coordinatorの各external mutation前にTask lifecycleを確認する。最低限、Questionnaire生成、Artifact生成、Plan review、Queue entry作成前にterminal Taskを拒否する。

拒否はgeneratorのgeneric `PLAN_MODE_READ_ONLY`をそのままSession errorへ保存するのではなく、Mission Pilot境界で次のstable codeへ正規化する。

```text
MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL
MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN
MISSION_PILOT_QUEUE_HANDOFF_STALE_CONTEXT
MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING
MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE
```

LLM本文がある場合に固定本文へ置換する用途では使わない。これはdeterministic domain diagnostic専用である。

### 8.3 Queue admission transaction boundary

Queue serviceの既存active-entry unique/reuse契約を利用する。

1. latest Session / Context / review / verification evidenceを読む。
2. handoff gateを評価する。
3. existing active Queue entryがあればそのrowを採用する。
4. なければ`createImplementationQueueEntry()`を呼ぶ。
5. returned rowとDB上active rowを照合する。
6. Queue entry IDとfrozen Context refsをContextへappendする。
7. Sessionを`queued`へ更新する。

Context append後・Session update前にprocessが落ちても、reconcileはQueue entry ID / Context reason / digestを読んで同じentryを採用する。重複Queue entryを作らない。

### 8.4 Existing corrupt Session classification

startup reconcileはpre-Queue Sessionを次に分類する。

| state | action |
| --- | --- |
| non-terminal Task、valid step、Queueなし | missing next stepから再開 |
| valid Queue entry、Session not queued | evidence照合後queuedへ補正 |
| terminal Task、pre-Queue runなし | attention。自動rollbackなし |
| terminal Task、`workbench_intake` implementation runあり | attention。run/commit/diff refsをdiagnosticへ保存 |
| Queue entry複数 | attention。自動削除なし |
| Context / review digest不一致 | stale stepを再評価し、Queue禁止 |

corrupt Sessionを再開する操作は将来の明示reopen/reconcile計画へ委ねる。本remediationのmigrationやstartup処理でrepo変更・Task status・run statusを巻き戻さない。

## 9. 実装ファイル計画

### 9.1 `api/modules/missionPilot`

- `mission-pilot.service.ts`
  - generic WorkBench intake依存をtyped Plan intakeへ置換。
- `mission-pilot-plan-intake.port.ts`（新規）
  - existing Questionnaire / coordinatorへの薄いport。
- `mission-pilot-plan-intake.service.ts`（新規）
  - start / resume / existing Questionnaire採用。
- `mission-pilot-plan-coordinator.service.ts`
  - Task lifecycle guardとQueue handoff gate接続。
- `mission-pilot-plan.repository.ts`
  - queued projection / frozen handoff refsのidempotent persistence。
- `mission-pilot-pre-queue-recovery.service.ts`（新規）
  - startup classificationとsafe recovery。
- `mission-pilot.errors.ts`
  - stable pre-Queue diagnostic code。
- `index.ts`
  - startup reconcile export。

### 9.2 Existing domain integration

- Questionnaire serviceは既存public serviceを再利用する。
- Queue serviceは`createImplementationQueueEntry()`とactive-entry queryを再利用する。
- WorkBench serviceの通常Task contractは変更しない。
- API startupへpre-Queue recovery scanを追加する。

### 9.3 Shared / DB

原則として新tableは追加しない。Queue handoff refsをContext snapshotへ追加するschemaが必要な場合だけshared schemaを拡張する。

Session column追加が必要な場合は、既存Contextから再構築できない最小refに限定し、bootstrapとformal Drizzle migrationを同時に追加する。

## 10. 実装フェーズ

### Phase 1: Typed Plan intake replacement

1. Mission Pilot専用Plan intake portを追加する。
2. initial Playからgeneric WorkBench intake呼び出しを除去する。
3. existing Questionnaire create/reuseへ接続する。
4. runを作成しないcontract testを追加する。

完了gate:

- first Play後のTaskRun countが0。
- Questionnaireまたはintervention stateが作られる。
- 通常TaskのWorkBench intake testが不変。

### Phase 2: Queue handoff gate

1. terminal Task / unexpected run guardを追加する。
2. Feature Plan / Verification / review / Context digestを検証する。
3. Queue entry exactly-onceを固定する。
4. queued projectionへhandoff refsを保存する。

完了gate:

- valid evidenceだけがQueueへ入る。
- response loss retryでentryが増えない。
- Session queuedとQueue rowが一致する。

### Phase 3: Recovery / diagnostics

1. startup pre-Queue scanを追加する。
2. known corrupt Sessionをattentionへ分類する。
3. terminal Taskを自動rollbackしないtestを追加する。
4. operator-visible diagnosticへrun/source/diff/commit refsを保存する。

完了gate:

- restart後にcompleted stepを再生成しない。
- corrupt Sessionが自動実装を再開しない。
- healthy Sessionはmissing next stepから再開する。

### Phase 4: Integration / E2E / archive

1. new Mission PilotをTask生成からQueue admissionまで通す。
2. API process restartをQuestionnaire、Artifact、Queue response-loss境界で実行する。
3. downstream handoff contractを検証する。
4. manual WorkBench / Plan Mode regressionを確認する。
5. verification evidenceを本書へ記録し、完了後`spec/archive`へ移す。

## 11. Test Plan

### 11.1 Unit / service

- first Playが`resumeWorkbenchIntakeMessage()`を呼ばない。
- first PlayがImplementation runを作らない。
- Questionnaireなしなら1件だけ作る。
- Questionnaireありなら再利用する。
- timeout / intervention中のPlayが既存countdown contractを維持する。
- terminal TaskをQueueへ入れない。
- unexpected pre-Queue runを検出する。
- stale Context reviewを再利用しない。
- Feature PlanとVerification Document不一致を拒否する。
- active Queue entryを再利用する。
- Queue entry response loss retryで重複しない。

### 11.2 Recovery

- Artifact生成前restart。
- Artifact保存後・Context append前restart。
- Context append後・step complete前restart。
- review pass後・Queue create前restart。
- Queue create後・Session queued前restart。
- terminal corrupt Session startup。
- dead lease recovery。

### 11.3 Regression

- 通常TaskのintakeがPlan / Implementationを従来どおりroutingする。
- manual Plan Modeがterminal Taskでread-onlyのまま。
- Mission Pilot Stopが新stepを開始させない。
- Play resumeがinitial promptを重複保存しない。
- Queue scheduler / lease / capacity contractを変更しない。

## 12. End-to-End Scenarios

### 12.1 Happy path

1. Mission candidateからMission Pilot Taskを作成する。
2. first Playする。
3. Implementation runがまだ存在しないことを確認する。
4. Questionnaireを自律回答またはinterventionで確定する。
5. required Artifactを順次生成する。
6. Plan self-reviewをpassさせる。
7. active Verification Documentを確認する。
8. Queue entryが1件作成される。
9. Sessionが`queued`になる。
10. frozen Context digestとQueue handoff refsを確認する。

### 12.2 Wrong routing prevention

Plan Modeを明示しない実装要求に見えるinitial promptでも、Mission Pilot first PlayはQueue前Implementation runを作らない。ユーザー文言判定ではなくMission Pilot typed workflowでPlan intakeを選ぶ。

### 12.3 Existing corruption

`completed Task + attention Session + workbench_intake implementation run + Queueなし` fixtureを起動する。startup reconcileはTask statusやrepoを変更せず、structured attention diagnosticを保存して停止する。

## 13. Verification Commands

実装時に実ファイル名を確定し、次の形で実行する。

```bash
bun run test run tests/mission-pilot-service.test.ts
bun run test run tests/mission-pilot-plan-coordinator.test.ts
bun run test run tests/mission-pilot-plan-pipeline.test.ts
bun run test run tests/mission-pilot-pre-queue-handoff.test.ts
bun run test run tests/mission-pilot-pre-queue-recovery.test.ts
bun run test run tests/nightworkers-workbench-intake.test.ts
bun run typecheck
bun run check:docs
bun run verify:base
bun run test:e2e -- tests/e2e/mission-pilot-entry.spec.ts
git diff --check
```

存在しないtest fileは実装phaseで計画どおり追加する。実際のWorkBench regression file名が異なる場合は既存suiteへ合わせ、本書のcommandも同じ変更で更新する。

変更前から存在するunrelated failureは、対象command、error、baseline SHA、対象外理由を記録する。remediationが触れたpathまたはcontractに関係するfailureは対象外扱いにしない。

## 14. Definition of Done

1. Mission Pilot first Playからgeneric WorkBench intake implementation routeが除去されている。
2. Queue前Implementation/Test/Review runが作られない。
3. initial prompt、Questionnaire、Artifact、review、Context chainが維持される。
4. Queue handoff gateがFeature Plan / Verification / review / Contextを検証する。
5. Queue entryがexactly-onceで作成・再利用される。
6. Session queued projectionがQueue rowと一致する。
7. process restartでArtifact / review / Queue entryを重複作成しない。
8. existing corrupt Sessionを自動rollback / rerunしない。
9. normal WorkBench intake / manual Plan Mode / Queue schedulerに回帰がない。
10. focused tests、typecheck、docs、verify、restart E2Eが成功する。
11. downstream planのprecondition contract testが成功する。
12. 実装commitとverification evidenceを本書へ記録する。
13. 完了後、本書を`spec/archive`へ移す。

## 15. Downstream Handoff

本書完了後、`spec/docs/mission-pilot-test-review-archive-implementation-plan.md`は次を入力前提として開始できる。

- Session desired state `playing`。
- Session phase `queued`。
- active Implementation Queue entryがexactly one。
- Queue pass済みlatest Context revision / digest。
- exact Feature Plan / Verification Document / Plan review refs。
- Queue前Implementation/Test/Review runなし。
- Task non-terminal。

downstream planはこの入力を再構築・修正せず、Queue claim後のrun associationから開始する。
