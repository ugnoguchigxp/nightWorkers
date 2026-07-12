# Mission Pilot Plan Artifact Agent Correction 実装計画

## Status

- Plan status: `implemented-pending-live-validation`
- Document created: 2026-07-12
- Implementation status: `implemented-deterministic-verified`
- Implementation completed: 2026-07-12
- Deterministic verification:
  - focused Mission Pilot / Plan Mode / WorkBench tests: passed
  - `bun run typecheck`: passed
  - changed-file Biome check: passed
  - `bun run check:docs`: passed
  - `bun run verify`: passed
- Broader verification note: `bun run verify:full` reached 1992/1999 passing tests before stopping on existing React Query test-harness failures, a source-regex expectation unrelated to this slice, and a shared Queue processor-setting isolation failure. The Mission Pilot contract regression found in that run was corrected and now passes independently.
- Remaining acceptance: live providerでblocking reviewからfocused correction、再レビュー、Queue admissionまでを実観測する
- Triggering observation: Plan Artifact生成は完了したが、self-reviewが同じ上流矛盾を解消できないまま3回の`revise`上限へ達し、Queue admission前の`attention`で停止した
- Prerequisite implementations:
  - `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`
  - `spec/archive/mission-pilot-plan-mode-progress-projection-implementation-plan.md`
  - `spec/archive/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`
- Target runtime span: Plan Artifact self-review開始から、対象Artifactの修正、再レビュー、Implementation Queue admissionまで
- Target domains:
  - `api/modules/missionPilot`
  - `api/modules/nightworkers`
  - `api/modules/blueprint`
  - `api/modules/planViews`
  - `api/modules/specification`
  - `src/modules/planMode`
  - `src/modules/missionPilot`

この文書を、Mission PilotがPlan Modeの各Artifactを自分で直接書き換えず、対象Artifactへフォーカスした追加PromptをPlan Mode correction agentへ渡し、変更適用を監視・検証・再レビューしてからImplementation Queueへ進めるための実装正本とする。

本計画はpre-Queue remediationである。ここで起動するagent turnはPlan Artifactだけを更新し、repository source codeを編集するImplementation runではない。Implementation Queue entryまたはTaskRunを先に作るshortcutは追加しない。

## 1. 問題

### 1.1 現在の失敗境界

現在のMission Pilot plan coordinatorは、self-reviewが`revise`を返すと`revisionTargets`を処理する。しかし、reviewerが矛盾元ではなくFeature Planだけを修正対象にした場合、Blueprintや個別Viewに残る上流矛盾を解消できない。

実観測では次の状態になった。

1. Questionnaire、Blueprint、Data Model、Feature Planの生成stepはすべて`completed`になった。
2. Questionnaireは「既存の主要画面に統合する」を選択した。
3. Blueprintは独立した`/todos`画面を生成した。
4. self-reviewはFeature Planの改訂を繰り返したが、Blueprint起因の画面配置矛盾を解消できなかった。
5. 3回目のreviewも`revise`となり、Sessionは`attention`、Queue entryとTaskRunは未作成のまま停止した。

Queue gate自体は正しく動いている。修正対象の選択、agentへの指示、変更結果の採用、進捗表示が不足していることが問題である。

### 1.2 現在の経路分断

通常Plan Modeでは、選択中のArtifact tabとComposer promptを結び付け、次のtargetへ再生成指示を送れる。

- `feature_plan`
- `blueprint`
- `data_model`
- `user_flow`
- `api_io_contract`
- `activity_flow`
- `sequence_flow`
- `zod_schema_design`

一方、Mission Pilotの`reviseArtifacts()`は独自switchでgeneratorを直接呼んでいる。このため、通常Plan Modeのフォーカス、source selection、追加Prompt、表示、agent executionの契約とMission Pilotの自動改訂が分離している。

また、現在の共有targetはArtifact単位までであり、Blueprint内の`screenId`または`sectionId`を明示する共通focus契約を持たない。

### 1.3 表示上の誤認

現在のStatusはArtifact生成stepがすべて`completed`なら全step完了に見える。self-review、Artifact correction、Queue admissionは番号付き進捗に含まれないため、runtimeが`attention`でも「Planが最後まで完了した」ように見える。

## 2. 目的

Mission Pilotのself-reviewでblocking findingが出た場合、次を自律的かつ観測可能に完了させる。

```text
self-review
  -> 矛盾を所有するArtifactとfocusを特定
  -> immutableなcorrection requestを保存
  -> Plan Mode correction agentへ追加Promptを送信
  -> 対象Artifact画面を観測用にfocus
  -> agent resultの永続化を待つ
  -> source / result / Context provenanceを検証
  -> 上流変更でstaleになった依存Artifactを順に修正
  -> 最新Contextを再レビュー
  -> passした場合だけQueue admission
```

Mission Pilotは修正内容の実行主体にならない。Mission Pilotの責務は、対象選択、指示作成、実行監視、結果採用、再レビュー、停止判断である。

## 3. 成功条件

次をすべて満たしたとき、この計画を完了とする。

1. review findingごとに、修正を所有するPlan Artifact targetがschema-validに決まる。
2. targetは任意文字列ではなく、共有`planModeRegenerationTargetSchema`に制約される。
3. review targetは修正対象の`sourceMessageId`を持ち、別versionのArtifactを誤って直さない。
4. BlueprintはArtifact全体、特定screen、特定sectionのfocusを表現できる。
5. Blueprint以外のArtifactも同じcorrection request契約を使う。
6. Mission Pilotはgeneratorを独自switchから直接呼ばず、通常Plan Modeと共有するcorrection agent execution serviceを使う。
7. correction agent turnはPlan Artifactだけを更新し、Implementation Queue entryまたはTaskRunを作らない。
8. correction request、開始、agent result、採用、失敗がDBへ永続化される。
9. API process再起動後、未完了correctionを再読込して安全に再開またはattentionへ収束できる。
10. 同じreview targetの重複配送が同じcorrection recordと結果へ収束する。
11. correction開始後にSession停止、Context変更、source変更があった場合、stale resultをcanonical Contextへ採用しない。
12. screen / section focus時、非対象部分を維持する指示と検証がagent contractへ入る。
13. 上流Artifact変更後、古いsourceを参照する下流Artifactをpass reviewの根拠に使わない。
14. staleな依存Artifactはsource provenanceに基づき、上流から下流の順で修正される。
15. すべてのcorrectionが`applied`になり、最新Context revisionへのreviewが`pass`するまでQueueへ入れない。
16. Statusにself-review、Artifact correction、Queue admissionの状態が表示される。
17. correction開始時、Plan Mode Workspaceは対象Artifact tabを一度focusし、Blueprintでは対象screen / sectionを選択できる。
18. 利用者が別tabを見てもbackendのcorrection targetは変わらず、表示操作をruntime判断の正本にしない。
19. Mission Pilotの判断と監視eventはPilot Thought、correction agentの生成本文はTask transcriptへ表示される。
20. retry上限到達時、未解消finding、対象Artifact、source ID、最後の失敗理由、Queue未追加が可視化される。
21. 通常Plan Modeの手動Artifact追加Prompt、Mission Pilot以外のTask、既存Queue handoffに回帰がない。
22. focused tests、typecheck、Biome、docs check、repo verifyが成功する。

## 4. Locked Decisions

1. Mission PilotはPlan Artifact本文を直接生成・編集しない。
2. Plan Mode correction agentがArtifact変更の実行主体になる。
3. pre-Queue correctionではImplementation TaskRunを作らない。
4. correction agentは既存Plan Mode generatorとprovider routingを使う。
5. 通常Plan Mode ComposerとMission Pilotは同じcorrection execution serviceを使う。
6. `shared/schemas/plan-mode-artifact.schema.ts`をArtifact target名の正本にする。
7. target分類にuser promptのkeyword / regex判定を使わない。review-role LLMのstructured outputとschema validationを使う。
8. QuestionnaireとTask acceptance criteriaはimmutable inputとして扱い、correction targetにしない。
9. Questionnaireとの矛盾は、矛盾を導入した生成Artifact側を修正する。
10. 1件のcorrection agent turnは1つのprimary targetだけを変更する。
11. 複数targetが必要な場合は、correction planへ分割して順に実行する。
12. 依存順は上流ArtifactからFeature Planへ向かう。
13. source provenanceで依存が確認できないArtifactを推測で再生成しない。
14. Blueprintのscreen / section correctionも、新しいBlueprint全体をimmutable versionとして保存する。既存JSONの部分上書きはしない。
15. `preserveUnfocusedContent`はPromptだけでなく、結果検証でも確認する。
16. agent response受信だけでは`applied`にしない。Task message、Activity Artifact、Context revisionの整合確認を必須にする。
17. correction中のfrontend tabは観測surfaceであり、backend stateの正本にしない。
18. Statusの「Plan完了」はArtifact生成完了ではなく、latest review passまでを意味する。
19. Queue追加済み表示はheld Queue rowの永続化とrelease確認後にだけ出す。
20. retry上限は無限loop防止のため維持する。上限値とcycle semanticsを一箇所に集約する。
21. `attention`からPlayした場合は回答済みQuestionnaireと最新Artifact checkpointから再開し、初期生成をやり直さない。
22. Plan Mode生成本文はTask transcriptへ残し、Pilot Thoughtへ重複表示しない。
23. Mission Pilotのcorrection dispatch、監視、停止理由だけをPilot Thoughtへ表示する。
24. prompt文言は日本語を維持する。

## 5. Scope

### 5.1 含む

- typed Artifact correction request / result schema。
- Artifact / screen / section focus schema。
- self-review revision targetの型強化。
- review findingからcorrection planを作るstructured contract。
- 通常Plan ModeとMission Pilotが共有するcorrection execution service。
- durable correction run persistence。
- idempotent dispatch、lease、restart recovery、stale result rejection。
- source provenanceに基づくdependency invalidationと順序付きcorrection。
- canonical Contextへのatomicなresult adoption。
- self-review再実行とQueue admission gate。
- Plan progressへのreview / correction / queue step追加。
- Workspace tab、Blueprint screen / sectionの観測用focus。
- Pilot Thought diagnosticsとTask transcript routing。
- focused backend、frontend、integration、E2E tests。

### 5.2 含まない

- repository source codeを編集するImplementation agentの開始。
- Queue投入後のImplementation / Test Mode / Review Mode変更。
- Questionnaire回答の再生成。
- Task acceptance criteriaの変更。
- Plan Artifact schema全体の再設計。
- Blueprint editorの汎用部分編集機能。
- 複数Artifactを1回のagent responseで同時更新する機能。
- user promptの意味をkeyword / regexで分類するfallback。
- Mission Pilot専用画面またはdashboard。
- 通常TaskをMission Pilotへ移行するuniversal task migration。
- review rubric全体の再設計。

## 6. Target Contract

### 6.1 Correction target

`shared/schemas/plan-mode-artifact-correction.schema.ts`を追加し、frontend、workbench、Mission Pilotで共有する。

```ts
type PlanModeArtifactFocus =
  | { kind: "artifact" }
  | { kind: "screen"; screenIds: string[] }
  | { kind: "section"; screenIds: string[]; sectionIds: string[] };

type PlanModeArtifactCorrectionTarget = {
  target: PlanModeRegenerationTarget;
  sourceMessageId: string;
  focus: PlanModeArtifactFocus;
  instruction: string;
  preserveUnfocusedContent: boolean;
};
```

Rules:

- `sourceMessageId`は対象Taskに属する生成済みArtifact messageでなければならない。
- `screen` / `section` focusは`target === "blueprint"`の場合だけ許可する。
- `screenIds` / `sectionIds`はsource Blueprint内に実在しなければならない。
- dedicated viewは`target`とmessage metadataの`view`が一致しなければならない。
- `instruction`はreview findingとrecommendationから生成するが、reviewer本文を未検証のまま実行しない。
- Questionnaire、acceptance criteria、存在しないArtifactはtargetにできない。

### 6.2 Review schema

`shared/schemas/mission-pilot-plan-review.schema.ts`の`revisionTargets`を、任意の`artifactKind`からtyped correction targetへ置き換える。

reviewerには次を要求する。

1. findingの表面上の記載先ではなく、矛盾を導入したsource Artifactをprimary targetにする。
2. QuestionnaireとBlueprintの矛盾はBlueprintへ戻す。
3. Blueprintとdedicated viewの矛盾は、矛盾を所有するより具体的なArtifactを選ぶ。
4. Artifactが正しくFeature Planだけ不足する場合だけFeature Planをprimary targetにする。
5. screenまたはsectionを特定できる場合はfocus IDを返す。
6. source messageを一意に特定できない場合は`revise`を実行せず`attention`へ止めるためのstructured reasonを返す。

review normalizationはwarning-only resultだけを`pass`へ正規化する既存挙動を維持する。blocking findingをtarget不明のまま`pass`にしない。

### 6.3 Durable correction run

`mission_pilot_artifact_correction_runs`を追加する。

```text
id
session_id
task_id
plan_review_id
ordinal
target
focus_json
instruction
source_message_id
source_context_revision
source_context_digest
status
dispatch_key
result_message_id
result_artifact_id
output_context_revision
attempt
last_error
started_at
finished_at
created_at
updated_at
```

Status:

```text
pending
dispatching
running
result_received
validating
applied
failed
superseded
cancelled
```

Constraints:

- `(session_id, plan_review_id, ordinal)`をuniqueにする。
- `dispatch_key`をuniqueにし、response loss後の再配送を同じrunへ収束させる。
- `result_message_id`はTask messageを参照する。
- `applied`は`output_context_revision`なしでは保存できないservice invariantにする。
- correction rowを削除してretryしない。新attemptまたは新reviewにappendする。

### 6.4 Correction agent execution service

`api/modules/nightworkers/nightworkers.workbench.service.ts`内のPlan Mode regeneration dispatchを、責務を限定した共有serviceへ抽出する。

候補:

```text
api/modules/planMode/plan-mode-artifact-correction.service.ts
```

公開する操作:

```ts
executePlanModeArtifactCorrection({
  taskId,
  prompt,
  target,
  sourceMessageId,
  focus,
  questionnaireSessionId,
  featurePlanMessageId,
  sourceBlueprintMessageId,
  sourceDataModelMessageId,
  routeOverride,
  correlationId,
})
```

通常Composerは現在の`artifactContext`からこのserviceを呼ぶ。Mission Pilotはcorrection runから同じserviceを呼ぶ。

serviceはtargetに応じて既存generatorへ委譲する。

- Blueprint: `generateBlueprintArtifact()`。
- Data Model: `generateDataModelArtifact()`。
- dedicated view: `generatePlanViewArtifact()`。
- Feature Plan: `generateFeaturePlanArtifact()`。

Mission Pilot固有のphase遷移、retry判断、Queue判断をこのserviceへ入れない。provider call、Artifact生成、result provenance返却だけを担当させる。

### 6.5 Agent Prompt

Mission Pilotがcorrection agentへ渡すPromptは日本語で、次の固定sectionを持つ。

```text
[対象Artifact]
[対象version]
[フォーカス]
[解消するblocking finding]
[変更要求]
[不変条件]
[完了条件]
```

必須ルール:

- 対象Artifactだけを変更する。
- QuestionnaireとTask acceptance criteriaを変更しない。
- 指定されたfocus以外を維持する。
- 不明点を新しい仕様として勝手に追加しない。
- 既存source Artifactとcanonical Contextを入力にする。
- 実装コードを編集せず、Plan Artifactだけを生成する。
- 対象外の改善、ついで対応、過剰拡張をしない。

### 6.6 Dependency invalidation

Artifact変更後、保存済みmetadataのsource message IDを比較して下流Artifactのstale状態を決める。

原則順序:

```text
Blueprint
  -> Data Model / dedicated views（source参照があるものだけ）
  -> Feature Plan

Data Model
  -> dedicated views（source参照があるものだけ）
  -> Feature Plan

dedicated view
  -> Feature Plan

Feature Plan
  -> self-review
```

依存関係をArtifact本文、画面label、keywordから推測しない。message metadataとassembled design contextのsource referenceを正本にする。

下流Artifactをstaleと判断した場合は、元reviewの指示をそのまま使い回さず、「上流Artifact versionが更新されたため、新sourceへ整合させる」という別correction runを作る。

### 6.7 Result validation and Context adoption

agent result受信後に次を確認する。

1. result messageが同じTaskに属する。
2. result metadataのtargetがcorrection targetと一致する。
3. resultがsource messageをprovenanceとして参照する。
4. expected Artifact schemaをparseできる。
5. Blueprint focusの場合、指定screen / sectionが存在する。
6. `preserveUnfocusedContent`の場合、非対象screen / sectionの安定IDと意味内容が維持される。
7. correction開始時のContext revision / digestがまだcurrentである。
8. Sessionが`playing`で、lease ownerが有効である。

検証成功後だけ、新Artifact evidenceを追加したContext snapshotをatomicにappendし、correction runを`applied`にする。

検証失敗時は既存ArtifactとContextを変更せず、runを`failed`へする。providerが本文を返した場合はTask transcriptへ残し、固定エラー文へ置換しない。

### 6.8 Coordinator state machine

pre-Queue phaseへ次を追加する。

```text
reviewing_plan
awaiting_artifact_correction
correcting_artifact
validating_artifact
revising_dependencies
queueing
attention
```

進行規則:

1. review `pass`ならcorrectionを作らずQueue gateへ進む。
2. review `reject`なら`attention`へ停止する。
3. review `revise`ならtyped correction planを保存する。
4. coordinatorはordinal順で1件ずつdispatchする。
5. `applied`になる前に次targetへ進まない。
6. 上流変更後にstale dependencyを追加し、依存順で処理する。
7. 全correction適用後にlatest Contextで再レビューする。
8. review / correction cycle上限へ達した場合は`attention`へ停止する。
9. latest pass reviewとcurrent Context digestが一致する場合だけQueue admissionへ進む。

### 6.9 Stop, restart, and stale response

- Stopは新規correction dispatchを止める。
- provider callを安全にcancelできない場合、返却結果は保存できるがcanonical Contextへ採用しない。
- restart時は`dispatching / running / result_received / validating`を監査する。
- result messageが確認できればvalidationから再開する。
- result不明でdispatch keyが同じならidempotent redispatchする。
- sourceまたはContextが変わっていればrunを`superseded`にし、latest reviewから新runを作る。
- `attention`からPlayした場合、回答済みQuestionnaireと最新Contextを再利用する。

### 6.10 Progress and UI projection

`MissionPilotPlanProgress`へ次を追加する。

```ts
review: {
  status: "pending" | "running" | "passed" | "revision_required" | "failed";
  attempt: number;
  reviewId: string | null;
};
activeCorrection: {
  id: string;
  target: PlanModeRegenerationTarget;
  focus: PlanModeArtifactFocus;
  status: string;
  instruction: string;
  sourceMessageId: string;
} | null;
queueAdmission: {
  status: "blocked" | "ready" | "admitting" | "admitted";
} | null;
```

Status表示は次を区別する。

- Artifact生成済み。
- self-review中。
- 指摘により対象Artifactを修正中。
- agent resultを検証中。
- 再レビュー待ち。
- review pass済み。
- Queue admission中。
- Queue追加済み。
- attentionで停止。

`allStepsDone`だけで実装開始・Queue追加可能に見せない。Mission Pilot Taskではreview passとQueue stateを含むruntime projectionを使う。

correction開始eventを受信したPlan Mode Workspaceは、対象Artifact tabへ一度だけ移動する。Blueprint focusの場合は対象screen / sectionを選択する。利用者がその後別tabを選ぶことは許可し、選択変更でbackend targetを変えない。

### 6.11 Event display

Pilot Thoughtへ表示するMission Pilot event:

- correction plan作成。
- 対象Artifact / screen / section。
- agentへ送った追加Promptの要約。
- correction dispatch / validation / adoption。
- dependency invalidation。
- self-review verdict。
- retry停止理由とQueue未追加。

Task transcriptへ表示するもの:

- correction agentの生成stream / usage / assistant result。
- 生成されたArtifact本文。
- providerが返したschema-invalid本文。

同じ生成本文をPilot Thoughtへ複製しない。

### 6.12 Queue gate

既存`admitToQueue()`へ、次のpreconditionを追加する。

1. latest plan reviewが`pass`。
2. review revision / digestがcurrent Sessionと一致。
3. latest reviewに属するcorrection runsがすべて`applied`または不要として`superseded`。
4. active correctionがない。
5. required Artifactがcurrent source chainを参照する。
6. Queue handoff evidenceがcurrent Feature Plan messageを参照する。

このgateを満たさない場合、held Queue rowを作らない。

## 7. Implementation Steps

### Phase 1: Shared contracts

対象:

- `shared/schemas/plan-mode-artifact.schema.ts`
- `shared/schemas/plan-mode-artifact-correction.schema.ts`
- `shared/schemas/mission-pilot-plan-review.schema.ts`
- `shared/schemas/mission-pilot-plan-progress.schema.ts`

作業:

1. correction target / focus / result schemaを追加する。
2. review `revisionTargets`をtyped targetへ移行する。
3. source / focusのcross-field validationを追加する。
4. progressへreview / activeCorrection / queueAdmissionを追加する。
5. frontend/backendのlocal target unionを増やさず共有schemaへ統一する。

### Phase 2: Persistence and repository

対象:

- `api/db/mission-pilot-schema.ts`
- `api/db/mission-pilot-schema-bootstrap.ts`
- `api/modules/missionPilot/mission-pilot-plan.repository.ts`

作業:

1. `mission_pilot_artifact_correction_runs`を追加する。
2. append、claim、status transition、result attach、apply、supersede queryを追加する。
3. dispatch keyとreview ordinalのunique constraintを追加する。
4. invalid status transitionをservice/repository境界で拒否する。
5. restart scanに未完了correctionを含める。

### Phase 3: Shared correction agent execution

対象:

- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.workbench-routing.ts`
- 新規`api/modules/planMode/plan-mode-artifact-correction.service.ts`
- 既存Blueprint / Data Model / Plan View / Feature Plan generators

作業:

1. workbench内のPlan Mode target dispatchを共有serviceへ抽出する。
2. 通常Composerの挙動を変更せず共有service経由へ切り替える。
3. sourceMessageId、focus、correlationIdをgenerator metadataへ通す。
4. result message / artifact / provenanceをtyped resultとして返す。
5. Mission PilotのphaseやQueue判断を共有serviceへ入れない。

### Phase 4: Review routing and correction coordinator

対象:

- `api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts`
- 新規`api/modules/missionPilot/mission-pilot-artifact-correction.service.ts`
- `api/modules/missionPilot/mission-pilot-plan.repository.ts`
- `api/modules/missionPilot/mission-pilot-recovery.service.ts`

作業:

1. reviewer promptをsource-owner routing契約へ更新する。
2. `reviseArtifacts()`の独自generator switchを削除する。
3. review resultからdurable correction planを作る。
4. 1件ずつcorrection agentへdispatchする。
5. result validationとContext adoptionを実装する。
6. provenanceからstale dependencyを検出する。
7. 全correction適用後に再レビューする。
8. retry上限、Stop、restart、stale responseを同じstate machineへ統合する。
9. Queue gateへactive correction / source chain確認を追加する。

### Phase 5: Progress and observation UI

対象:

- `api/modules/missionPilot/mission-pilot-plan-progress.service.ts`
- `api/modules/missionPilot/mission-pilot-realtime.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/workspace-panels/PlanWorkspaceStatusView.tsx`
- Blueprint previewのscreen / section selection境界
- `src/modules/missionPilot/components/PilotThoughtDock.tsx`

作業:

1. review / correction / queue projectionをRESTとrealtimeへ追加する。
2. Statusへ生成後phaseを表示する。
3. correction開始時に対象tabを一度focusする。
4. Blueprint screen / section focusをcontrolled inputとして渡す。
5. Pilot ThoughtへMission Pilot correction eventだけを表示する。
6. correction agent outputはTask transcriptに維持する。
7. attention時に未解消findingとQueue未追加を明示する。

### Phase 6: Recovery and E2E

作業:

1. dispatch直前、provider実行中、result保存後、Context adoption前のrestartを検証する。
2. Stop中に遅延responseが返るcaseを検証する。
3. Blueprint screen correctionからFeature Plan追随、review pass、Queue admissionまでを実providerなしのdeterministic E2Eで確認する。
4. explicit live suiteでは実providerによるcorrection収束を確認する。

## 8. Test Plan

### 8.1 Schema tests

- 全Artifact targetをacceptする。
- unknown targetをrejectする。
- Blueprint以外のscreen / section focusをrejectする。
- 空focus ID、重複ID、存在しないsourceをservice validationでrejectする。
- blocking findingをtargetなしでpassに正規化しない。

### 8.2 Correction repository tests

- 同じdispatch keyが1行へ収束する。
- ordinal順claimが成立する。
- invalid status transitionを拒否する。
- `applied`にoutput revisionを要求する。
- restart scanが未完了runだけを返す。
- old reviewのrunをsupersedeできる。

### 8.3 Shared agent execution tests

- 手動Composerの選択tabが従来と同じgeneratorを呼ぶ。
- Mission Pilot correctionも同じserviceを呼ぶ。
- source Blueprint message IDがFeature Planへ渡る。
- focusとcorrelation IDがresult metadataへ残る。
- provider本文があるschema failureで固定本文へ置換しない。

### 8.4 Coordinator tests

- Blueprint findingがBlueprint correctionを作り、Feature Planだけを先に直さない。
- screen targetをcorrection agent promptへ渡す。
- Data Model / dedicated view / Feature Plan findingを正しいtargetへ送る。
- 1回のagent turnで複数primary targetを変更しない。
- result受信前に次correctionへ進まない。
- stale Context resultを採用しない。
- Stop後のresultを採用しない。
- 上流変更後にsource参照のある下流だけをstaleにする。
- latest review pass前にQueue serviceを呼ばない。
- correction適用後のlatest review passで既存held Queue handoffへ進む。
- retry上限でattentionになり、Queue rowが0件のままになる。

### 8.5 Frontend tests

- active correction target tabへ一度focusする。
- user tab変更がbackend targetを書き換えない。
- Blueprint screen / section focusを表示する。
- Artifact完了とreview passを別状態で表示する。
- correction中、validation中、再レビュー中、attention、queuedを区別する。
- attentionにblocking findingとQueue未追加が表示される。
- correction agent本文をPilot Thoughtへ重複表示しない。
- 通常Plan Modeの手動Composer correctionに回帰がない。

### 8.6 E2E

最低1本のdeterministic E2Eで次を確認する。

1. QuestionnaireとBlueprintに意図的な不整合を作る。
2. reviewがBlueprint screen correctionを返す。
3. Statusが対象Blueprintをfocusする。
4. correction agentが新しいBlueprint messageを作る。
5. 非対象screenが維持される。
6. Feature Planが新しいBlueprint sourceへ追随する。
7. latest Context reviewがpassする。
8. held Queue rowがexactly-onceで作られ、releaseされる。
9. Queue前にTaskRunが存在しない。

restart variantではcorrection agent result保存後、Context adoption前にAPI processを再起動し、同じresultを一度だけ採用する。

## 9. Verification Commands

実装中のfocused gate:

```bash
bun test tests/mission-pilot-plan-pipeline.test.ts
bun test tests/mission-pilot-plan-coordinator.test.ts
bun test tests/mission-pilot-plan-progress.test.ts
bun test tests/mission-pilot-pre-queue-recovery.test.ts
bun test tests/artifact-workspace-viewer.test.ts
bun test tests/pilot-thought-dock.test.tsx
bun run typecheck
bunx biome check <changed-files>
git diff --check
```

統合後のdeterministic gate:

```bash
bun run check:docs
bun run verify
```

実provider確認はdeterministic gateへ混ぜず、明示的なlive suiteとして実行する。

```bash
bun run verify:live
```

期待結果:

- focused testsがすべてpassする。
- typecheck、Biome、docs check、diff checkがpassする。
- `bun run verify`が外部providerなしでpassする。
- live suiteを実行した場合、実provider correctionが同じdurable evidenceへ収束する。
- Queue row、review、correction run、Context revision、TaskRun countをDBで再現可能に確認できる。

## 10. Completion Evidence

完了時に次の証拠を残す。

1. schema / migration diff。
2. correction state transition test。
3. review target routing test。
4. 通常Composerとのshared execution test。
5. Blueprint screen focus test。
6. stale result / Stop / restart recovery test。
7. dependency invalidation test。
8. review pass前Queue拒否test。
9. deterministic pre-Queue E2E結果。
10. typecheck、Biome、docs check、`bun run verify`結果。
11. live suiteを実行した場合はprovider、model、task ID、correction ID、review ID、Queue entry IDを含む記録。

## 11. Implementation Order

実装順を次に固定する。

1. shared correction / review / progress schema。
2. correction persistenceとmigration。
3. 通常Composerからshared correction execution serviceへの移行。
4. Mission Pilot review routingとdurable correction coordinator。
5. result validation、Context adoption、dependency invalidation。
6. Queue gate hardening。
7. progress / realtime / tab・screen focus。
8. Pilot Thought diagnosticsとTask transcript routing。
9. restart recovery。
10. focused tests、deterministic E2E、full verify、明示的live verify。

shared serviceへ通常Composerを移した時点で既存手動再生成testsをpassさせてから、Mission Pilotを接続する。Mission Pilot独自の第二のgenerator dispatchを残したままUIへ進まない。

## 12. Non-Completion Conditions

次のいずれかが残る場合、この計画を完了扱いにしない。

- Mission Pilotが独自switchでgeneratorを直接呼んでいる。
- review targetが任意文字列のままである。
- source messageまたはfocus IDを検証していない。
- correction結果を確認せずContextへ採用している。
- Artifact生成完了だけでPlan完了表示になる。
- latest review pass前にQueue rowが作られる。
- correction中にImplementation TaskRunが作られる。
- Stopまたはstale Context後のresultが採用される。
- restart後に同じcorrectionが重複適用される。
- correction agent本文がPilot ThoughtとTask transcriptへ重複表示される。
- 通常Plan Mode ComposerのArtifact correctionが壊れている。
- deterministic gateが外部provider必須になっている。
- `bun run verify`が失敗している。
