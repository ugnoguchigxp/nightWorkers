# Mission Pilot Test gate・Review Run 再開 remediation 実装計画

## Status

- Plan status: `completed-archived`
- Investigation completed: 2026-07-13
- Implementation status: `completed` (2026-07-13)
- Runtime recovery status: canonical Review Run started and completed
- Final closeout status: `completed` (2026-07-13)
- Target incident: Task `7cf7ce13-338f-41b8-80eb-7776dbaa6ef3`
- Target Test run: `4bef8ad0-63e3-4095-bf2c-04d0fcf37ff5`
- Target Mission Pilot session: `d0c0c2cf-45f7-4a4c-bbbc-0b1327c011c9`
- Target domain: `api/modules/missionPilot` / `api/modules/review`
- Baseline reviewed: 2026-07-13 local source、SQLite、API log、LLM trace、browser UI
- Parent implementation: `spec/archive/mission-pilot-test-review-archive-implementation-plan.md` (`completed-archived`)

本書は、完了済みの post-Queue Mission Pilot 実装を再設計する計画ではない。Test run 内で失敗した managed check を再実行して最終的に成功した場合でも、過去の失敗行を理由に Test completion gate が永久に失敗し、その後の Review Run を開始できない不具合を修正する独立 remediation plan である。

実装、対象incidentのservice経由回復、最終closeoutは完了した。scope外の同時進行UI/CSS変更で発生したlarge-file gateは、既存theme変更の内容を変えずCSS moduleを分割して解消し、repository-native `bun run verify` は成功した。対象worktreeはReview Run後に残っていた差分へ再度 `bun run verify` を実行して成功し、専用branchへcommitした。対象Taskは回復確認後にユーザー操作で削除されたため、live SQLiteにはTask / Mission Pilot Session行が残っていないが、削除前のTest snapshot、canonical Review Run、Review attentionまでの証跡は本節のIDとruntime logに固定した。

### 0.1 Implementation evidence

- Test decisionの `evidenceRunIds` をDB ID契約に合わせ、UUID限定ではなくnon-empty stringとして検証するよう修正した。
- accepted evidence resolverがID存在、Task/run/document scope、exit code、stdout/stderr artifactを検証する。
- 対象Test snapshot `d4c65261-c151-4100-9601-119464318223` はaccepted 4件だけを固定し、同じrunの13件中8件の失敗をhistorical failureとして保持した。
- Test phase run `7eeb2482-a6a3-4a80-b35b-2aa28ec54c4f` は `completed/pass` へ回復した。
- canonical Review Session `ee63df79-0ea9-40c1-9300-dad0d2b55497` はImplementation runをanchorに作成され、Review TaskRun `2cd27c6e-fb57-49e9-a54c-2ce3cd1af9aa` が `executionMode=review` で開始・完了した。
- runを持たない旧手動Review Sessionは削除せず、service経由で `cancelled/superseded` にした。
- Review attention時のSessionを `needs_human` で閉じ、post-Queue error codeを `MISSION_PILOT_REVIEW_GATE_REJECTED` として保存した。
- focused tests: 9 files / 67 tests pass。typecheck、docs check、module boundary、ontology validation、今回変更ファイルのformat checkはpass。
- closeout再確認のfocused tests: 6 files / 38 tests pass。
- `tests/e2e/mission-pilot-through-archive.spec.ts` はisolated runtime / SQLiteでpass。同一Test phase内の同一 `git diff --check` が一度非0で終了した後に成功し、失敗evidence rowを保持しながらsnapshotが成功evidence IDだけを採用して、Review、closeout、true Archiveまで完走した。
- repository-wide `bun run verify` はtracked artifact、architecture boundary、typecheck、lint、Supervisor regressionを含め全pass。`git diff --check`、docs check、large-source-file gateもpass。
- 対象todolist worktreeは `bun run verify` がtypecheck、lint、format、test、coverage、buildを含め全passし、branch `nightworkers/7cf7ce13-todolist` へcommit `ea62dc0d42386b4e9d993e6c89bb6afa3a8dc92f` (`Implement authenticated todo list`) を作成した。worktreeはclean。
- 対象Taskは2026-07-13 22:26:42 JSTに `DELETE /api/tasks/7cf7ce13-338f-41b8-80eb-7776dbaa6ef3` がstatus 200で完了した。closeout時点のlive SQLiteでは対象Task / Mission Pilot Sessionは各0件であり、削除後の404もruntime logで確認した。

## 1. 調査で確認した実行時事実

対象Taskでは次の順序で処理された。

1. Implementation run `c4e378ad-c073-48ab-ab94-ee2ffc287027` は `completed`。
2. Test run `4bef8ad0-63e3-4095-bf2c-04d0fcf37ff5` は `executionMode=test` で `completed`。
3. Test の構造化最終判定は `verdict=pass`、`completion_check.ok=true`、required condition は `10/10 covered`。
4. 同じTest run / Verification Documentに managed evidence row が13件あり、5件は `exit_code=0`、8件は途中の再試行による `exit_code=1`。
5. 8件の失敗後、同じ対象checkと全体gateは成功している。失敗行は削除されず監査履歴として残る。
6. 現在のTest gateは同じrun / documentの全 evidence rowを集め、1件でも非0なら `managed_evidence_failed` とする。
7. 実データを `evaluateTestCompletionGate()` へ再入力した結果、唯一の不合格理由は `managed_evidence_failed`。
8. Test phase runは `failed / attention` となり、`mission_pilot_test_snapshots` は作成されず、Review cycleは0のまま。
9. その後StopによりSessionは `paused`、`resume_phase=attention`、`active_run_id=null` となった。`active_phase_run_id` には失敗したTest phase runが残っている。
10. Playは `attention` を復元できるが、post-Queue recoveryは `activeRunId` がnullなら処理をskipするため、同じ完了済みTest runを再評価できない。
11. 手動で作成されたReview Sessionは `in_progress` だが、`review_status` artifactしかなく、`review_run` artifactもReview用TaskRunもない。画面上のRunボタンは有効であり、frontend disabled判定が主原因ではない。
12. 手動Review SessionはTest runをanchorにしており、Mission Pilotが自動作成するcanonical Reviewの「latest accepted Implementation runをanchorにし、Mission全phase runをtargetにする」契約とは異なる。
13. 実際のmanaged evidence IDは64桁のdeterministic hashだが、Mission Pilot Test decision schemaはUUIDだけを許可していた。このため最初の再評価は `structured_test_decision_invalid` になった。
14. startup pre-Queue reconcilerは `phase=attention` を一律に走査し、既にImplementation/Test phase runを持つpost-Queue Sessionまで `MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN` と誤分類していた。

したがって根本原因は、「Review Runボタンが押せない」ことではなく、Test gateが途中の失敗履歴と最終採用証跡を区別できず、canonicalな `test snapshot -> start_review` 遷移が作られなかったことである。さらに、一度 `attention` でStopした後にその判定を再評価するdurable recovery経路が不足している。

## 2. 目的

次の状態遷移を、履歴を消さず、重複runを作らずに成立させる。

```text
Test run 内の managed check
  -> 途中の失敗 evidence はimmutable audit historyとして保存
  -> Test roleの構造化最終判定が採用した evidenceRunIds をDBと照合
  -> 採用証跡、completion_check、required checklist、Contextをgate評価
  -> Test snapshotをexactly onceでfreeze
  -> accepted Implementation runをanchorにcanonical Review Sessionを作成
  -> Mission全phase runをtargetにReview Runを開始

既に attention / paused のSession
  -> Play
  -> activePhaseRunIdから完了済みTest runを特定
  -> 同じgateを再評価
  -> 上記のsnapshot / Review遷移へ合流
```

## 3. Scope

### 3.1 実装対象

- Test最終判定とmanaged evidenceの照合。
- Test completion gateを「同一runの全履歴」ではなく「検証済み採用証跡」に対して評価するよう変更。
- 過去の失敗証跡をsnapshot diagnosticとphase evidenceへ残す。
- Test `attention` 後に `activeRunId=null` でも `activePhaseRunId` から再評価できるpost-Queue recovery。
- snapshot作成とReview開始のidempotency。
- Review Sessionの「作成済み」と「Review Run開始済み」の状態分離。
- 対象incidentをPlayからcanonical Reviewへ進める回復確認。
- focused test、integration test、restart recovery test、browser E2E。

### 3.2 対象外

- Test ModeとReview Modeの責務統合。
- raw command executionのformal evidenceへの昇格。
- evidence rowの削除、上書き、成功行だけを残すcleanup。
- command文字列、ファイル名、ユーザー文言のregex / keyword分類。
- llm-providerへのworkflow判断追加。
- Review UIの再設計。
- 手動Review Runをcanonical Mission Pilot Reviewの代替にすること。
- pre-Queue Queue handoff、Plan Mode、Questionnaire、Git closeout、Archive契約の変更。
- provider live callを通常のdeterministic verificationへ混ぜること。

## 4. Locked Decisions

### 4.1 Test decisionを先に確定する

`continueAfterTestRun()` は、gate計算より先に `parseStructuredTestDecision()` で最終回答をschema検証し、次の順で処理する。

1. parse/schema失敗: `attention` (`structured_test_decision_invalid`)。
2. `verdict=rework`, `defectOwner=test`: 既存のTest retryへ戻す。
3. `verdict=rework`, `defectOwner=implementation`: 既存のImplementation reworkへ戻す。
4. `verdict=attention`: `attention` として停止する。
5. `verdict=pass`: `evidenceRunIds` をDB照合し、Test completion gateを評価する。

これにより、infra gateが偶然passしていても、Test role自身が `rework` / `attention` と判定したrunをpassへ昇格させない。

### 4.2 採用証跡は構造化最終判定の `evidenceRunIds`

`verdict=pass` の `evidenceRunIds` をaccepted evidence setとする。ただしLLM出力をそのまま信頼せず、各IDについて次をDBで検証する。

- ID配列が空でなく、重複がない。
- `verification_evidence_runs` に存在する。
- 対象Task、対象Test run、対象Verification Documentと一致する。
- `exit_code === 0`。
- stdout / stderr raw artifact IDが両方存在する。

一つでも不正ならsnapshotを作らず、stable reason codeで `attention` にする。

- `selected_evidence_missing`
- `selected_evidence_duplicate`
- `selected_evidence_not_found`
- `selected_evidence_scope_mismatch`
- `selected_evidence_failed`
- `selected_evidence_raw_artifact_missing`

command文字列の一致や「同じcheckの最新行」といった推測は使わない。どの成功証跡を最終判定に採用したかをtyped IDで固定する。

### 4.3 過去の失敗は監査履歴であり、採用passの自動否定ではない

同一Test run / document内でaccepted setに含まれないevidence rowは、成功・失敗を問わずhistorical evidenceとする。特に過去の `exit_code != 0` は削除せず、次へ保存する。

- `mission_pilot_phase_runs.evidence_json.testEvidenceHistorySummary`
- `mission_pilot_test_snapshots.snapshot_json.testEvidenceHistorySummary`
- `test_mode.snapshot_frozen` event payloadの件数summary

`mission_pilot_test_snapshots.evidence_run_ids_json` とcanonical Contextの `execution.test.evidenceRunIds` には、DB照合済みaccepted evidence IDsだけを保存する。既存columnを使うためDB migrationは行わない。

summaryには少なくとも `totalCount`、`acceptedCount`、`historicalFailureCount` を持たせる。失敗の詳細は既存evidence rowを参照し、snapshot JSONへraw outputを複製しない。

### 4.4 Test completion gateの他条件は弱めない

accepted evidenceが成功していても、次の既存条件はすべて必要とする。

- TaskRun `status=completed`。
- completion_checkが同じVerification Documentを参照し `ok=true`。
- required conditionが1件以上ある。
- required conditionが全件completeで、failed / unknownが0。
- phase input Context digestとSession Context digestが一致する。
- Test後にsource mutationがない。
- 構造化Test decisionが `verdict=pass`。

`TestGateInput` は `managedEvidenceCount / failedManagedEvidenceCount / rawArtifactsComplete` を全履歴の意味で受け取る形を廃止し、検証済みaccepted setの件数とvalidation結果を受け取る。historical failure countはgate入力にせずdiagnosticとして分離する。

### 4.5 attention理由をphase runへdurableに保存する

`setMissionPilotAttention()` はSessionの一時的な `lastError*` だけでなく、対象phase runの `evidenceJson` へ次をmergeする。

- `attentionReasonCodes: string[]`
- `attentionAt: string`
- Testの場合はevidence history summary

phaseに応じたerror codeを使い、Test gate failureを `MISSION_PILOT_IMPLEMENTATION_GATE_REJECTED` として保存しない。最低限 `MISSION_PILOT_TEST_GATE_REJECTED` と既存Implementation codeを分離する。

### 4.6 post-Queue recoveryはactive phase runを正本にする

`recoverMissionPilotPostQueueSessions()` に、次の全条件を満たすSessionの再評価経路を追加する。

- `desiredState=playing`。
- Session phaseが `attention` またはTest評価再開を表すphase。
- `activeRunId=null`。
- `activePhaseRunId` が存在する。
- active phase runが同じSession / Taskの `phase=test`。
- phase runのTaskRunがterminalかつ `finishedAt` 非null。
- active Test snapshotがまだない、または同じphase runの既存snapshotを再利用できる。

recoveryは `activePhaseRunId -> phaseRun.runId` から既存 `continueAfterTestRun()` / coordinatorへ合流し、別のTest runを作らない。任意の `attention` を一般的に再実行するfallbackにはしない。

Playの分岐は、Queue handoff JSONが存在するだけでpost-Queue attentionをpre-Queue recoveryへ送らないようにする。post-Queue phase run / phaseを確認し、該当時は `claimPostQueueResume()` とpost-Queue recoveryを優先する。

### 4.7 snapshotとReview開始はexactly once

同じphase runのrecoveryが複数回走っても、次を満たす。

- `mission_pilot_test_snapshots_phase_run_uidx` をidempotency boundaryとして使う。
- insert前に同じphase runのsnapshotを検索する。
- 競合insert時は既存rowを再取得し、同じsnapshotからcontinuationを再構築する。
- Context revisionを重複追加しない。
- Review cycleを重複加算しない。
- canonical Review Sessionはanchor Implementation runのunique sessionを再利用する。
- `review_run` artifactに既存 `reviewRunId` があれば新しいReview TaskRunを開始しない。
- process response-loss時もDB row / artifact / phase runを照合して継続する。

### 4.8 Review Session作成とReview Run開始を分ける

`createOrStartReviewSession()` はSession作成時に `status=not_started`、`startedAt=null` とする。`startReviewRunForSession()` が実際に開始要求を受理した時点で `in_progress` / `startedAt` へ遷移する。

- target blocking warningによりworkerを開始できない場合、`review_run.status=needs_human` とSessionの終端/表示を一致させる。
- worker起動成功時だけ `review_run.reviewRunId` を保存し、`review.run_started` をinfoで記録する。
- 「Sessionがin_progressだがReview Run artifactがない」状態を正常な開始済み状態として扱わない。
- frontendのRunボタンは `review_run` artifactを正本とする既存方針を維持し、状態ラベルだけ新しいbackend契約に合わせる。

手動Review Runの通常経路は維持する。Mission Pilot continuationだけが `targetRunIds` とMission Pilot Contextを渡す。

## 5. 実装フェーズ

### Phase 1: accepted evidence resolverとTest gate修正

対象:

- `api/modules/missionPilot/mission-pilot-post-queue-test.service.ts`
- `api/modules/missionPilot/mission-pilot-post-queue-state.ts`
- 新規 `api/modules/missionPilot/mission-pilot-test-evidence.ts`
- `shared/schemas/mission-pilot-test.schema.ts`（必要なsemantic refinementのみ）

手順:

1. Test decision parse/routingをgateより前へ移す。
2. pureなaccepted evidence resolverを追加する。
3. IDの存在、scope、exit code、raw artifactを検証する。
4. accepted setとhistory summaryを返す。
5. Test gate inputをaccepted evidence semanticsへ変更する。
6. snapshot / Contextにはaccepted IDsだけを保存する。
7. phase evidence / event payloadへhistory summaryを保存する。

`missionPilotTestDecisionSchema` の互換性は維持する。空配列をschemaだけで拒否するかservice semantic validationで拒否するかは、既存のrework/attention payload互換を確認して決める。`pass` のときだけnon-emptyを強制する。

### Phase 2: durable attentionとpost-Queue recovery

対象:

- `api/modules/missionPilot/mission-pilot-post-queue-review.service.ts`
- `api/modules/missionPilot/mission-pilot-recovery.service.ts`
- `api/modules/missionPilot/mission-pilot.service.ts`
- `api/modules/missionPilot/mission-pilot-post-queue-test.service.ts`

手順:

1. attention reason codeをphase evidenceへmergeする。
2. Test用error codeを分離する。
3. `activeRunId=null / activePhaseRunId!=null` のTest terminal run resolverを追加する。
4. Play時のpre/post-Queue recovery判定をphase/run evidenceで分ける。
5. recoveryを既存Test continuationへ合流させる。
6. snapshot/context/review continuationのresponse-loss reconciliationを追加する。
7. recovery成功時に `mission_pilot.test_gate_recovered` eventをdedupe key付きで記録する。

### Phase 3: Review Session lifecycleとReview Run idempotency

対象:

- `api/modules/review/review-mode.repository.ts`
- `api/modules/review/review-mode.service.ts`
- `api/modules/review/review-run.service.ts`
- `api/modules/missionPilot/mission-pilot-runtime-continuation.service.ts`
- 必要なReview Status表示component

手順:

1. Session作成を `not_started` に変更する。
2. Review Run開始claimをrepository/serviceへ追加する。
3. `review_run` artifactの既存run IDを確認して重複開始を防ぐ。
4. blocking target時のSession/artifact状態を統一する。
5. Mission Pilot auto-startがcanonical Implementation anchorと全target run IDsを維持することを確認する。

### Phase 4: 対象incidentのservice経由回復

実装配備後、対象Sessionをraw SQLで直接書き換えず、次を確認する。

1. UIまたは既存APIからPlayする。
2. `resume_phase=attention` がpost-Queue recoveryへ渡る。
3. phase runが参照する既存Test runを再評価する。
4. 8件の失敗evidence rowが残っていることを確認する。
5. 最終判定が採用した成功evidence IDsだけでTest snapshotがfreezeされる。
6. Test phase runが `completed/pass`、Sessionが `review_preparing -> reviewing`、review cycleが1になる。
7. latest accepted Implementation runをanchorにcanonical Review Sessionが作成される。
8. `review_run` artifactにnon-null `reviewRunId` が入り、対応TaskRunが `executionMode=review` で開始する。

既存の手動Review Sessionは削除しない。canonical Session開始後に、実runを持たないことを確認した上でservice経由で `cancelled` / `superseded` とし、`finalNote` にcanonical Session IDを残す。既にReview Runが存在する場合は自動cancelせず `attention` として人手確認へ送る。

## 6. Test plan

### 6.1 Pure / unit tests

`tests/mission-pilot-test-mode.test.ts` を拡張する。

- historical failure 8件 + selected success 5件でpass。
- selected IDが空、重複、存在しない、別run、別document、exit nonzero、raw artifact欠落ならblock。
- historical failureだけを理由にblockしない。
- completion_check失敗、required incomplete、stale contextは引き続きblock。
- structured decisionがinvalid / rework / attentionならpassへ進まない。
- command文字列が同じでもID指定なしで自動選択しない。

### 6.2 Service integration tests

`tests/mission-pilot-test-review-transition.test.ts` を拡張する。

- 対象incident相当の「同じcheckが複数回失敗後に成功、全体gate成功」をfixture化する。
- snapshotの `evidenceRunIdsJson` がaccepted IDsだけである。
- snapshot JSON / phase evidenceにhistorical failure countが残る。
- phase `completed/pass`、review cycle 1、continuation `start_review`。
- 同じ `continueAfterTestRun()` を再実行してもsnapshot、Context revision、review cycleが増えない。

### 6.3 Restart / Play recovery tests

`tests/mission-pilot-post-queue-recovery.test.ts` を拡張する。

- Session `paused -> Play -> attention`、`activeRunId=null`、`activePhaseRunId=failed Test phase run` を再評価する。
- terminal Test runからcontinuationがexactly onceで実行される。
- recoveryを2回実行してもTest/Review runが重複しない。
- unrelated implementation/review attentionはTest recoveryに入らない。
- post-Queue attentionがpre-Queue Queue handoff recoveryへ誤配送されない。

### 6.4 Review lifecycle tests

- `tests/review-mode.test.ts`: create時 `not_started / startedAt=null`。
- Review Run開始成功時だけ `in_progress / startedAt!=null`。
- blocking targetはworkerなし、artifactとSessionがneeds-human相当で一致。
- 既存 `reviewRunId` がある再要求は同じrunを返す。
- 手動Review SessionはMission Pilot target情報を持たない従来経路を維持する。

### 6.5 E2E

`tests/e2e/mission-pilot-through-archive.spec.ts` にtransient Test failureケースを追加または独立scenarioとして追加する。

- managed checkが一度失敗してから同じTest runで成功するfixtureを使う。
- Test snapshot作成、Review TaskRun開始、Review pass、closeout、Archiveまで進む。
- 失敗evidence rowが最後まで残る。
- browser clickをphase遷移triggerにせず、backend durable coordinatorだけでReviewが始まる。

## 7. Verification gates

実装時は少なくとも次を実行する。

```bash
bun test tests/mission-pilot-test-mode.test.ts
bun test tests/mission-pilot-test-review-transition.test.ts
bun test tests/mission-pilot-post-queue-recovery.test.ts
bun test tests/review-mode.test.ts tests/review-status-viewer.test.tsx
bun run typecheck
bun run check:docs
bun run verify
git diff --check
```

E2Eはdisposable runtime root / isolated DBで実行する。通常の `verify` から外部providerを呼ばず、live-provider確認が必要な場合だけ明示的に `verify:live` を使う。

## 8. Acceptance Criteria

1. 対象incident相当のTest runが、途中の失敗evidenceを残したままTest gateをpassできる。
2. passに使った全evidence IDがDB scope、exit code、raw artifactで検証される。
3. 構造化Test decisionがinvalid / rework / attentionならReviewへ進まない。
4. completion_check、required checklist、Context freshnessの既存gateが弱まらない。
5. snapshot / canonical Contextはaccepted evidence IDsだけを参照する。
6. historical failure countと元evidence rowから失敗履歴を監査できる。
7. attention理由がphase runへdurableに残る。
8. Stop後に `activeRunId=null` でもPlayから同じTest phase runを再評価できる。
9. 同じrecoveryを反復してもsnapshot、Context revision、Review Session、Review TaskRunが重複しない。
10. Review Session作成だけでは `in_progress` と表示しない。
11. Review Run開始時に `review_run.reviewRunId` と `review.run_started` eventが一致する。
12. Mission Pilot Reviewはaccepted Implementation runをanchorにし、Mission全run IDsとMission Pilot Contextを受け取る。
13. 手動Test / Review経路に回帰がない。
14. focused tests、typecheck、docs check、`bun run verify`、isolated E2E、`git diff --check` が成功する。

### 8.1 対象incidentのDB / event確認

回復成功時、対象Taskについて次を確認する。

- `mission_pilot_phase_runs`: Test phaseが `completed/pass`。
- `mission_pilot_test_snapshots`: 同じphase runにexactly one。
- `mission_pilot_sessions`: `active_test_snapshot_id`あり、review cycle 1以上。
- `review_sessions`: canonical Implementation anchorのSessionあり。
- `review_artifacts`: `kind=review_run`、non-null `reviewRunId`。
- `task_runs`: 対応runが `context_snapshot.executionMode=review`。
- `mission_pilot_events`: snapshot freeze / recovered / Review continuationのdedupe済みevent。
- `verification_evidence_runs`: 元の成功5件・失敗8件を改変していない。

## 9. Implementation order

1. Phase 1のpure resolverとunit test。
2. Test decision routingとgate integration。
3. snapshot / phase evidenceのidempotency test。
4. Phase 2のPlay/restart recoveryとtest。
5. Phase 3のReview Session lifecycle / Review Run idempotency。
6. focused testsとtypecheck。
7. isolated E2Eで新規fixtureを通す。
8. 対象incidentをservice経由で回復する。
9. runtime DB / log / eventを再確認する。
10. `bun run verify` とdocs gateを通す。
11. 本書へimplementation evidenceを追記し、`spec/archive/` へ移動する。

## 10. Rollback / failure handling

- DB migrationを行わないため、rollbackはservice/gate変更のrevertで可能にする。
- accepted evidence validationが不正IDを通した場合はsnapshotを作らず `attention` に倒す。
- snapshot作成後にReview開始が失敗した場合、Test passを取り消さず `review_preparing` からidempotentに再開する。
- canonical Review TaskRunが既に存在するか不明な場合、新規runを作らずartifact / runtime associationを照合する。
- 対象incidentの既存手動Review Sessionに実runが見つかった場合、自動cancelを中止して `attention` にする。
- historical evidence rowをrollbackやrecoveryで削除しない。

## 11. Traceability

| Runtime symptom | Root cause | Planned change | Primary verification |
| --- | --- | --- | --- |
| 最終Testはpassだがsnapshotがない | 全履歴の失敗を一件でもfatalにする | accepted evidence resolver | transient failure integration test |
| Review cycleが0のまま | Test gateが `start_review` を返さない | Test decision先行 + accepted gate | Test-to-Review transition test |
| Stop後のPlayで進まない | `activeRunId=null` をrecoveryがskip | `activePhaseRunId` recovery | restart / Play recovery test |
| attention理由が再開時に消える | Session `lastError` だけに保存 | phase evidenceへreason code保存 | persistence assertion |
| Review Sessionはin_progressだがrunなし | 作成と実行開始が同じstatus | `not_started -> in_progress` 分離 | Review lifecycle test |
| 手動ReviewがMission全体を対象にしない | Test run anchorのstandalone session | canonical continuationを回復 | anchor / target IDs assertion |
| 再評価で重複Reviewが起き得る | response-loss/idempotency不足 | snapshot/artifact/run照合 | repeated recovery test |
