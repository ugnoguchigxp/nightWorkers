# Mission Pilot Session・Plan Mode 自律進行 実装計画

## Status

- Plan status: `completed`
- Document review completed: 2026-07-10
- Implementation status: `completed` — Questionnaire確定後のArtifact順次生成、self-review、Queue admission、実provider E2E、API process restart recoveryまで確認済み
- Implementation update: 2026-07-11。`13b2e49b`のQuestionnaire自律化をaccepted baselineとして維持し、shared execution step planner、DB-wide pipeline lease、永続step/review evidence、restart可能なbackend coordinator、ArtifactごとのatomicなContext revision、review roleによる最大3回のself-review / 対象Artifact改訂、latest pass review gate、既存Implementation Queue委譲を追加した。実Codex providerでのlive E2Eと、同一SQLite上でArtifact生成済み・step `running`の状態から新API processがContext/evidenceを冪等採用して`queued`まで復元することを確認した
- MVP slice: `2/3` — Session / Context・Plan Mode・Questionnaire・Artifact・Queue admission
- Completed plan archive: this document
- Previous phase: `spec/docs/mission-pilot-task-entry-design.md`
- Completed follow-up: `spec/archive/mission-pilot-test-review-archive-implementation-plan.md`
- Baseline reviewed: 2026-07-11, `main` at `13b2e49b`
- Target domain: `src/modules/missionPilot` / `api/modules/missionPilot`
- Target runtime span: Mission Pilot Task作成後からImplementation Queue投入まで

この文書を、Mission Pilot Task の作成時にUIを持たない Mission Pilot Session と一貫Contextを生成し、Plan Mode開始、Questionnaire自動回答、20秒のユーザー介入窓、Plan Artifact順次生成、実装計画セルフレビュー、Implementation Queue投入までを自律進行させる実装正本とする。

Mission Pilot専用画面は作らない。Mission Pilotはbackend runtimeであり、既存Task、既存Chat、既存Questionnaire、既存Plan Mode、既存Queueの各surfaceへ状態と操作機会だけを投影する。

このphaseはQueue投入までを扱う。Queue投入後のImplementation、Test Mode、Review Mode、Git closeout、Task completion、真のTask Archiveは完了済み正本 `spec/archive/mission-pilot-test-review-archive-implementation-plan.md` が扱う。評価と新規Task生成loopはさらに後続の別計画で扱う。

本書は3文書で構成するMission Pilot MVPのslice 2/3である。本書単体のQueue投入成功をMVP完成としない。入口のPlayでactivationした同じMission Pilot Session / authorization / Context chainを引き継ぎ、後続sliceがTask `archived`まで完了して初めてMVP完成とする。

## 1. 目的

Role RouterによりPlan、Review、Implementation等で異なるLLMが選ばれても、Mission Pilot Taskについては同じMission Pilot Sessionが所有するcanonical Contextを基礎に判断させる。

利用者がMission Pilotを開始した後は、次の流れを自動で完了させる。

```text
Mission Pilot Task作成
  -> Mission Pilot Session作成
  -> Context revision 1作成
  -> 初期Prompt送信
  -> Plan Mode開始event
  -> Questionnaire JSON取得
  -> Plan-role LLMが回答案作成
  -> 迷う回答だけcontextStill context_decision
  -> 回答案を既存Questionnaire UIへ仮適用
  -> 20秒のユーザー介入窓
     -> 回答送信: 即確定して継続
     -> 一時停止: timer停止、編集継続
     -> 再生: 現在案を即確定して継続
     -> timeout: 現在案を自動確定
  -> 必要ArtifactをStatusの上から順に生成
  -> Feature Plan生成
  -> Review-role LLMが実装計画をセルフレビュー
  -> 指摘があれば自動改訂と再レビュー
  -> passしたContext revisionを固定
  -> 既存Implementation Queueへ追加
```

## 2. 成功条件

次をすべて満たしたとき、このphaseを完了とする。

1. Mission Pilot Task作成transaction内で、Taskと1対1のMission Pilot Sessionが作成される。
2. Session作成時にContext revision 1が作成される。
3. Sessionは独自画面やrouteを持たず、Task IDから取得できるbackend runtime entityである。
4. initial ContextにSystemContext、Goal、Tech Stack、Task初期Prompt、Task acceptance criteriaが入る。
5. Plan Modeで確定したQuestionnaire回答とArtifactが生成順にContextへ追加される。
6. Chat message本文、assistant本文、streaming response、Chat transcript全体がMission Pilot Contextへ入らない。
7. Chat由来の構造化signalはContextとは別のcursorで確認される。
8. Role Routerで別LLMが選ばれても、各callが同じSession ID、Context revision、digestを受け取る。
9. Plan Mode開始をChat本文検索で検出せず、構造化eventで検出する。
10. Questionnaire readyを`design_questionnaire_ready`の文字列検索で検出せず、Questionnaire serviceが発行するdomain eventで検出する。
11. Questionnaire JSONを既存schemaでparseし、Plan-role LLMが全必須質問の回答案を作る。
12. 回答に迷う場合はユーザーへ質問せず、contextStill `context_decision`へ問い合わせる。
13. contextStill `reject`はhard stopとして扱い、勝手に回答を確定しない。
14. AI回答案が既存Questionnaire UIへ仮適用される。
15. 仮適用完了後、server-authoritativeな20秒deadlineが作成される。
16. Composer上部の既存gapへ、countdown、一時停止、再生状態をoverlay表示する。
17. 20秒内は利用者がQuestionnaire UIを編集できる。
18. 一時停止でdeadlineが解除され、自動回答送信が止まる。
19. 一時停止後も回答案と利用者編集が失われない。
20. 利用者が既存回答ボタンを押した場合、最新draftが即確定される。
21. 回答ボタンを押さず再生した場合、最新draftを即確定してからPilotが継続する。
22. deadline到達時、最新draftが一度だけ確定される。
23. browser非表示、tab close、page reload、API process再起動後もdeadlineとcoordinatorが復元される。
24. Questionnaire確定後、必要ArtifactをStatus表示順で1件ずつ生成する。
25. 1つのArtifactが永続化されContextへ反映される前に次を生成しない。
26. omitted / disabled Artifactを生成しない。
27. すべての必要ArtifactとFeature Planが生成された後、Review-role LLMが実装計画をセルフレビューする。
28. blocking findingがあればQueueへ入れず、自動改訂と再レビューを行う。
29. 最新Context revisionに対する`pass` reviewだけがQueue admission evidenceになる。
30. Queue直前にContextが変わった場合、古いreviewを無効化して再レビューする。
31. Queue投入は既存`queueTask()` / Implementation Queue schedulerを通り、直接implementation runを開始しない。
32. Queue entry作成後にSessionが`queued`となる。
33. 通常Task、手動Questionnaire、手動Plan Mode、手動Queue操作に回帰がない。
34. focused tests、typecheck、repo verify、restartを含むE2Eが成功する。

## 3. Locked Decisions

以下はこのphaseで固定する。

1. Mission Pilotの正本は`api/modules/missionPilot`である。
2. frontend integrationの正本は`src/modules/missionPilot`である。
3. Mission Pilot SessionはTaskごとに最大1件とする。
4. SessionはUI entityではない。sidebar section、専用route、専用workspaceを作らない。
5. 前段計画のcontrol projection用に独立tableを作らない。`mission_pilot_sessions`がplay/stop、phase、context revision、deadlineを統合して所有する。
6. 前段計画のTask row variantとComposer controlsはSession summaryのprojectionとして維持する。
7. Task作成、Session作成、初期Context作成は同一transactionにする。
8. Mission Pilot Task生成時はSessionを`stopped`、authorization未activationで作成する。
9. 初回Playを、このTaskについてPlan、Queue、local implementation、Test Mode、Review Mode、local commit、Task complete、Task archiveまで進めるversion 2 authorizationとして保存する。Play単独ではGit pushを含めず、事前設定済みproject push policyだけをsnapshotする。
10. `approvalRequired`なMission proposalでも、Playでactivation済みのMission Pilot authorizationが同じsourceRefを指す場合だけ既存queue approval recordを作成できる。
11. Mission PilotはChat transcriptをContext sourceにしない。
12. Chat messageのcontent、metadata自由文、assistant response本文をContextへコピーしない。
13. Chat signalは別ledger / cursorで観測し、Context JSONやLLM promptへ混ぜない。
14. Plan Mode開始、Questionnaire ready、Artifact ready、Queue readyは明示的なdomain eventで接続する。
15. `task_messages`の表示用system messageはUI evidenceとして残せるが、coordinator triggerには使わない。
16. Contextはimmutable versioned snapshotとする。
17. 各LLM callは開始時のContext revisionとdigestを記録する。
18. Contextが変わった後に返ったstale LLM responseは採用しない。
19. Canonical Context全体と、LLMへ送るrole-specific projectionを分ける。
20. role-specific projectionは必ず同じcanonical revisionから決定的に生成する。
21. Role Routerはmodel/providerを選ぶだけで、Mission Pilot Contextを所有しない。
22. llm-providerへMission Pilot状態遷移や用途別SystemContextを埋め込まない。
23. Questionnaire回答案生成は`role: "plan"`を使う。
24. Queue直前セルフレビューは`role: "review"`を使う。
25. Artifact generatorの既存`role: "plan"` routingを維持する。
26. LLMが自力で回答できる質問はそのまま回答する。
27. user confirmationが必要そうだという理由だけで停止しない。まずcontextStill `context_decision`を使う。
28. contextStillは既存MCP client manager経由で呼び、新規engineや独自ContextStill DBをNightWorkers内に作らない。
29. `context_decision`の`reject`は停止条件とする。
30. `execute` / `revise_and_execute`は回答案へ反映し、自動進行を続ける。
31. AI回答案は即確定せず、必ず既存Questionnaire UIへ仮適用して20秒待つ。
32. 20秒はfrontend timerではなくserver deadlineを正本にする。
33. frontend intervalは残り秒数の表示だけを担当する。
34. user editで20秒を延長しない。長く考える場合は一時停止を使う。
35. 一時停止はMission Pilot Sessionをpausedにし、active countdownと次step開始を止める。
36. 回答送信、再生、timeoutは同じidempotent submit serviceを呼ぶ。
37. frontendの既存`PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY`は通常Plan ModeのUI preferenceとして残すが、Mission Pilot runtimeの正本にはしない。
38. Mission Pilot Artifact生成はbackend coordinatorが所有する。
39. 生成順はQuestionnaire、Blueprint、Data Model、included dedicated views、Feature Planとする。
40. Blueprint / Data Model / dedicated viewsはPlan Mode gateの`include|omit`とcapabilityを尊重する。
41. Feature Planは最後に生成する。
42. self-reviewはFeature Plan本文だけでなく、Goal、Questionnaire回答、全生成Artifact、acceptance criteria、verificationを同じContextから確認する。
43. review `pass`なしでQueueへ入れない。
44. blocking findingの自動改訂は最大2回とする。
45. 2回改訂後もpassしない場合はSessionを`attention`で停止し、Queueへ入れない。
46. Queue投入後の実行は既存Queueのcapacity、lock、sequence、priorityを尊重する。
47. Mission Pilot用の直接run開始shortcutを作らない。
48. prompt文言は日本語を維持する。
49. keyword / regexで質問の意味やworkflowを分類しない。

## 4. Scope

### 4.1 含む

- Mission Pilot Session persistence。
- versioned canonical Context。
- Task生成時のinitial Context assembly。
- Goal / Tech Stack / initial prompt / acceptance criteriaの収集。
- Role Routerを越えるContext envelope。
- structured domain eventとdurable coordinator。
- Plan Mode entry検出。
- Questionnaire JSON自動回答。
- contextStill decision fallback。
- AI回答draftの既存UI仮適用。
- 20秒intervention window。
- pause / resume / manual submit / timeout submit。
- backend Artifact順次生成。
- ArtifactごとのContext revision更新。
- Feature Planセルフレビュー、自動改訂、再レビュー。
- Queue admission gateと既存Queue投入。
- restart recovery、lease、idempotency、audit evidence。

### 4.2 含まない

- Mission Pilot専用画面。
- Chat transcript summarization。
- Chat本文からの指示抽出。
- Queue投入後のimplementation coordinator。
- Test Mode自動進行。
- Review Mode自動進行。
- 実装完了後のProject Evaluation再実行。
- 評価結果からの次Mission Pilot Task自動生成。
- Role Router設定UIの変更。
- Plan Mode Artifact schema自体の全面再設計。
- 通常Plan ModeのlocalStorage順次生成設定の削除。

## 5. 現在の実装状態

### 5.0 2026-07-11 accepted baselineと残存境界

この節を以後の実装判断の正本とする。既存実装を計画初版へ合わせて作り直さず、`13b2e49b`で成立しているQuestionnaire自律化をaccepted implementationとして維持する。

実装済みとして固定するもの:

- Mission Pilot Task / Session / initial Context snapshotのatomic作成。
- Play authorization、初期Prompt dispatch、Stop / retry。
- Questionnaire ready service boundaryからのMission Pilot起動。
- schema-validな回答draft作成、既存Questionnaire UIへの仮適用、user edit同期。
- server-authoritativeな20秒deadline。
- pause、manual submit、Play resume、timeoutが同じidempotent submit処理へ収束すること。
- API再起動後のdeadline scanと自動確定。

今回再実装しないもの:

- Questionnaire回答生成方式の再設計。
- Questionnaire dependency loop、contextStill fallback、回答evidence形式の全面変更。
- Task entry / Play / Stop UIの再設計。
- 初期Context schemaの全面移行。

残存実装はQuestionnaireが`review_ready|accepted`になった後だけを対象とし、次の順で進める。

1. frontend Statusとbackendが共有するPlan Mode execution step planner。
2. browser非依存で1 stepずつ進めるMission Pilot後段coordinatorと永続step evidence。
3. Artifact永続化確認後のContext revision更新。
4. latest Contextを入力にしたFeature Plan self-reviewと限定改訂。
5. latest pass reviewを必須にするQueue admissionと既存Queue serviceへの委譲。

初版が想定した汎用event outbox、Chat signal cursor、全role共通Context基盤は、上記後段の正しさに必要な範囲だけ実装する。今回のQueue投入までに使われない汎用化を先行させない。

### 5.1 Plan Mode entry

`api/modules/nightworkers/nightworkers.workbench.service.ts`はintake後にPlan Mode gateを実行し、Questionnaire capabilityが有効なら`createDesignQuestionnaire()`を呼ぶ。

現在はQuestionnaire作成後に`task_messages`へ`intent: "design_questionnaire_ready"`のsystem messageを保存する。Mission Pilotはこのmessage本文やChat timelineをpollせず、同じservice boundaryから直接domain eventを発行する。

### 5.2 Questionnaire

Questionnaire JSONの正本は`shared/schemas/design-questionnaire.schema.ts`である。

質問は次を持つ。

- `answerType`: single choice / multi choice / boolean / free text / ranked。
- `recommendedAnswerId`。
- `options`。
- `blocking` / `blockingReason`。
- `dependsOn`。
- `decisionKey`。
- `outputSection`。

回答の保存は`api/modules/questionnaire/questionnaire.service.ts`の`saveDesignQuestionnaireAnswers()`が行い、全answerable questionが完了すると`review_ready`へ進む。

Mission Pilotはこのschemaとserviceを再利用し、独自Questionnaire形式を作らない。

### 5.3 Questionnaire UI

`src/modules/planMode/PlanModeWorkspaceViewer.tsx`はQuestionnaire sessionと回答をlocal stateへ読み込み、`QuestionnaireForm`へ渡す。回答送信後はStatusへ戻る。

Mission Pilotではpersisted draftをこのinitial stateへmergeし、AI選択を画面へ仮適用する。Questionnaire form自体を複製しない。

### 5.4 Artifact生成順

`src/modules/planMode/workspace-panels/PlanWorkspaceStatusView.tsx`は現在、次の順でstepを描画する。

1. Questionnaire。
2. Blueprint。
3. Data Model。
4. included additional views。
5. Feature Plan。

現在の「順次自動生成」はfrontend `useEffect`とlocalStorage preferenceで動く。Mission Pilotでは同じ順序定義をshared pure plannerへ抽出し、backend coordinatorが実行する。

### 5.5 Queue admission

`api/modules/queue/queue-management.service.ts`の`createImplementationQueueEntry()`はTask draft completeness、implementation plan evidence、重複entry、Mission proposal approval、schedulingを検証する。

Mission Pilotはこのgateを迂回しない。Mission Pilot固有のplan review passを追加gateとして先に検証し、その後で既存`queueTask()`を呼ぶ。

### 5.6 Conversation Context

既存`conversation_context_snapshots`はlatest user messageとChat continuityを含むため、今回のMission Pilot Contextの正本には使わない。

Mission Pilot Contextは別schema / tableを持ち、Chat本文非包含を型とbuilderで保証する。既存Conversation Contextを削除・変更しない。

### 5.7 contextStill

NightWorkersには`mcpClientManager`とcontextStill tool解決処理がある。Mission Pilotは同じclient managerをportで再利用し、`context_decision`を直接呼ぶ。

## 6. Runtime architecture

```text
Task Generation UI
  -> MissionPilot API
    -> Taskization port
      -> Task
      -> MissionPilotSession
      -> ContextSnapshot v1

Workbench / Questionnaire / Artifact services
  -> typed domain event
    -> MissionPilot coordinator
      -> durable step claim
      -> latest Context revision load
      -> Role Router
      -> LLM / contextStill / generator port
      -> evidence persist
      -> Context revision append
      -> next step

Existing UI
  <- session summary / intervention draft / deadline
```

coordinatorはTask Chat component、browser DOM、localStorage、active tabに依存しない。

## 7. Persistence model

### 7.1 `mission_pilot_sessions`

前段計画のcontrol stateをこのtableへ統合する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | Mission Pilot Session ID |
| `task_id` | text unique FK tasks | Task削除でcascade |
| `repository_id` | text FK repositories | Project boundary |
| `source_kind` | text | candidate / proposal |
| `source_id` | text | sourceRef ID |
| `authorization_version` | integer nullable | Task生成時null、初回Playで2 |
| `authorization_json` | JSON nullable | PlayでactivationしたMVP local lifecycle authorization。pushは別policy |
| `desired_state` | text | playing / stopped |
| `phase` | text | state machine phase |
| `resume_phase` | text nullable | pause直前phase。Play reconcile後にclear |
| `current_step_key` | text nullable | claimed step |
| `active_questionnaire_session_id` | text nullable | Questionnaire ref |
| `active_draft_id` | text nullable | intervention draft ref |
| `active_run_id` | text nullable | current TaskRun ref |
| `context_revision` | integer | latest canonical revision |
| `context_digest` | text | latest digest |
| `next_wake_at` | timestamp nullable | durable timer / recovery |
| `last_observed_chat_signal_seq` | integer nullable | Context外signal cursor |
| `lease_owner` | text nullable | coordinator ownership |
| `lease_expires_at` | timestamp nullable | stale worker recovery |
| `version` | integer | compare-and-set |
| `last_error_code` | text nullable | stable code |
| `last_error_message` | text nullable | diagnostic |
| `created_at` / `updated_at` | timestamp | audit |

`phase`:

```text
created
initializing_context
initial_intake
waiting_plan_mode
answering_questionnaire
waiting_intervention
paused
submitting_questionnaire
generating_artifacts
reviewing_plan
revising_plan
queueing
queued
attention
cancelled
```

Task生成transactionでは`authorization_version` / `authorization_json`をnullのままにする。初回Playのcompare-and-set transactionが、sourceRefとTask IDを含むversion 2 authorizationを固定する。後続Playは新しい権限を追加せず、保存済みauthorizationを再利用する。

authorization payloadは前段`shared/schemas/mission-pilot.schema.ts`の`missionPilotAuthorizationV2Schema`を正本とする。本書やQueue domainで似たJSON schemaを再定義しない。

Stop / intervention pauseは`resume_phase=current phase`を保存してから`phase=paused`へ移る。Playは`resume_phase`を盲目的に再開せず、関連row / run / deadlineをreconcileしたうえで有効な次phaseへ戻し、成功後に`resume_phase=null`とする。

### 7.2 `mission_pilot_context_snapshots`

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | snapshot ID |
| `session_id` | text FK | Session削除でcascade |
| `revision` | integer | session内unique |
| `reason` | text | initial / questionnaire / artifact / review |
| `context_json` | JSON | canonical context |
| `digest` | text | canonical JSON sha256 |
| `token_estimate` | integer | projection planning |
| `created_at` | timestamp | immutable |

unique `(session_id, revision)`。

### 7.3 `mission_pilot_steps`

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | step execution ID |
| `session_id` | text FK | owner |
| `step_key` | text | questionnaire-answer / blueprint / review等 |
| `ordinal` | integer | ordered generation |
| `attempt` | integer | retry number |
| `status` | text | pending / running / completed / failed / skipped |
| `context_revision` | integer | input revision |
| `context_digest` | text | input digest |
| `role` | text nullable | Role Router role |
| `provider_endpoint_id` | text nullable | audit only |
| `model` | text nullable | audit only |
| `evidence_json` | JSON | output refs / decision refs |
| `started_at` / `finished_at` | timestamp | audit |

unique `(session_id, step_key, attempt)`。

### 7.4 `mission_pilot_events`

Mission Pilot全phaseのdurable event ledger / outboxを同じtableで所有する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | event ID |
| `session_id` | text FK | Mission owner |
| `task_id` | text FK | Task boundary |
| `sequence` | integer | session内monotonic sequence |
| `event_type` | text | typed event name |
| `dedupe_key` | text | producer operation単位のidempotency key |
| `context_revision` | integer nullable | event input / output revision |
| `context_digest` | text nullable | stale response audit |
| `payload_json` | JSON | schema-validated typed payload |
| `publish_status` | text | pending / published / failed |
| `process_status` | text | pending / processing / processed / failed |
| `lease_owner` | text nullable | publisher / coordinator claim owner |
| `lease_expires_at` | timestamp nullable | stale claim recovery |
| `available_at` | timestamp | retry / deadline delivery |
| `published_at` / `processed_at` | timestamp nullable | audit |
| `attempt_count` | integer | bounded delivery retry |
| `last_error_code` | text nullable | stable diagnostic |
| `created_at` / `updated_at` | timestamp | audit |

unique `(session_id, sequence)`、unique `(session_id, dedupe_key)`。

producerはdomain mutationとevent insertを同一DB transactionで行う。publisher / coordinatorはlease付きでpending eventをclaimし、process crash時はexpired processing rowを回収する。DB commit後に直接in-memory callbackだけを呼ぶ実装を正本にしない。

### 7.5 `mission_pilot_questionnaire_drafts`

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | draft ID |
| `session_id` | text FK | owner |
| `questionnaire_session_id` | text FK | target Questionnaire |
| `questionnaire_revision_digest` | text | stale JSON prevention |
| `answers_json` | JSON | latest AI/user draft |
| `answer_evidence_json` | JSON | rationale/confidence/decisionId |
| `state` | text | preparing / waiting_user / paused / submitting / submitted / invalid |
| `deadline_at` | timestamp nullable | 20秒deadline |
| `version` | integer | UI edit CAS |
| `created_at` / `updated_at` | timestamp | audit |

同一Questionnaireにactive draftは最大1件。

### 7.6 `mission_pilot_plan_reviews`

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | review ID |
| `session_id` | text FK | owner |
| `context_revision` | integer | reviewed revision |
| `context_digest` | text | reviewed digest |
| `feature_plan_message_id` | text FK | reviewed plan |
| `attempt` | integer | 1..3 |
| `verdict` | text | pass / revise / reject |
| `review_json` | JSON | structured review |
| `published_message_id` | text nullable | Task evidence |
| `created_at` | timestamp | audit |

Queue gateはlatest reviewのrevision/digest一致と`pass`を要求する。

## 8. Canonical Context contract

`shared/schemas/mission-pilot-context.schema.ts`を追加する。

```ts
type MissionPilotContext = {
  version: 1;
  session: {
    id: string;
    taskId: string;
    repositoryId: string;
    sourceRef: MissionPilotSourceRef;
  };
  systemContext: {
    language: "ja";
    runtimePolicyVersion: string;
    instructions: string[];
    safetyPolicy: ProjectSafetyPolicy | null;
    repositoryRoot: string;
    planModeCapabilities: PlanModeCapabilities;
  };
  goals: Array<{
    id: string;
    title: string;
    goalText: string;
  }>;
  techStack: ProjectStackProfile;
  task: {
    title: string;
    initialPrompt: string;
    description: string | null;
    acceptanceCriteria: string | null;
  };
  plan: {
    gateDecision: PlanModeGateDecision | null;
    questionnaire: QuestionnaireContext | null;
    artifacts: PlanArtifactContext[];
    featurePlanMessageId: string | null;
    latestReviewId: string | null;
  };
};
```

### 8.1 Contextへ入れるもの

- Mission Pilot Session / Task / Project identity。
- NightWorkers SystemContextのMission Pilot向け固定規則。
- repository rootとsafety policy。
- source Goal本文。
- persisted Tech Stack profile。
- Task title / initial prompt / description / acceptance criteria。
- Plan Mode gateの構造化decision。
- Questionnaire JSON。
- 確定済みQuestionnaire answers。
- 生成済みPlan Artifactの構造化payload、本文、source refs、digest。
- Feature Plan全文。
- Queue直前self-reviewの構造化結果。

### 8.2 Contextへ入れないもの

- Chat user message本文。
- Chat assistant message本文。
- Chat transcript summary。
- streaming response。
- Composer local draft。
- TaskMessageの表示用system content。
- raw provider response全文。
- debug log全文。
- API key、access token、provider secret。
- transient Role Router override。
- UI active tab / scroll / panel size。

### 8.3 Chat signal

Chat signalは次のenvelopeだけを観測する。

```ts
type MissionPilotChatSignal = {
  taskId: string;
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  sequence: number;
  createdAt: string;
};
```

`content`と自由form metadataを型に含めない。signal handlerはcursorを進め、human activity / response arrivalのtelemetryを記録するだけで、Context revisionを作らない。

Plan Mode / Questionnaire / Artifactの進行はChat signalではなくtyped domain eventを使う。

## 9. Context revision rules

revisionを作るevent:

1. `session.created`: initial Context。
2. `plan_mode.entered`: gate decision追加。
3. `questionnaire.ready`: Questionnaire JSON追加。
4. `questionnaire.submitted`: committed answers追加。
5. `artifact.completed`: Artifact追加または置換。
6. `plan.reviewed`: review結果追加。

revisionを作らないevent:

- Chat signal。
- countdown tick。
- UI focus。
- retry開始。
- Role Router model fallback。
- task list refresh。

各revisionはimmutableとし、session rowの`context_revision` / `context_digest`をtransactionで更新する。

## 10. Role Routerを越える一貫Context

`api/modules/missionPilot/mission-pilot-context-projection.ts`を唯一のprojection builderとする。

各LLM callへ次を渡す。

```ts
type MissionPilotContextEnvelope = {
  sessionId: string;
  taskId: string;
  revision: number;
  digest: string;
  role: LlmRole;
  projection: string;
  sourceRefs: Array<{ kind: string; id: string; digest: string }>;
};
```

projection rule:

- `plan`: Goal、Tech Stack、initial prompt、Questionnaire、Plan artifactsを含む。
- `review`: 上記に加えFeature Plan、acceptance criteria、verification、artifact digest一覧を含む。
- 後続`implementation`: review pass済みFeature Planと実装対象Contextを含む。

canonical Contextがtoken budgetを超える場合:

1. Feature Planとcurrent target Artifactはfull contentを維持する。
2. Goal / initial prompt / acceptance criteriaはfull contentを維持する。
3. 古いArtifact versionは最新だけを残す。
4. structured payloadは決定的summaryとdigestへcompactする。
5. Chat contentで穴埋めしない。

provider call logへsession ID、revision、digest、role、resolved modelを記録する。別LLMへ切り替わってもdigestの連続性を検証可能にする。

## 11. Typed domain events

`shared/schemas/mission-pilot-event.schema.ts`を追加する。

```text
mission_pilot.session_created
mission_pilot.play_requested
plan_mode.entered
questionnaire.ready
questionnaire.draft_ready
questionnaire.intervention_paused
questionnaire.answers_submitted
plan_artifact.started
plan_artifact.completed
plan_artifact.failed
plan_review.started
plan_review.completed
queue.admission_started
queue.admitted
mission_pilot.attention_required
```

eventは`sessionId`, `taskId`, `eventId`, `sequence`, `occurredAt`, typed payloadを持つ。

eventの永続正本は`mission_pilot_events`である。realtime publishはUI通知、coordinator consumeはworkflow進行という別consumerであり、どちらかの失敗でevent rowを失わない。

- Workbench serviceはPlan Mode gate確定後に`plan_mode.entered`を発行する。
- Questionnaire serviceはvalid JSONを永続化後に`questionnaire.ready`を発行する。
- 各Artifact generatorはTaskMessage / Artifact永続化後に`plan_artifact.completed`を発行する。
- Queue service成功後にMission Pilot portが`queue.admitted`を発行する。

downstream mutationとevent row insertを同一transactionにし、event publish前にdownstream rowがcommit済みであることを必須とする。

## 12. Durable coordinator

`api/modules/missionPilot/mission-pilot-coordinator.service.ts`がeventを受け、次stepを決める。

coordinator invariant:

1. Session leaseをclaimする。
2. `desired_state === playing`を確認する。
3. current phase / step / context revisionを確認する。
4. idempotency keyでstepをclaimする。
5. 外部LLM / MCP / generator call前にContextをfreezeする。
6. response後にlease、desired state、Context revisionを再確認する。
7. stale responseならdiscard evidenceを残し、current revisionで再実行する。
8. mutationとeventを永続化する。
9. 次stepをscheduleする。

`next_wake_at`を持つsessionをschedulerがscanする。process restart時はexpired leaseを回収し、期限到達済みinterventionを再開する。

frontend `useEffect`をcoordinatorとして使わない。

## 13. Questionnaire回答案生成

### 13.1 trigger

`questionnaire.ready`を受けたら、coordinatorはQuestionnaire sessionをIDで読み、保存済みparsed JSONを取得する。

Chat timelineやTaskMessage contentは読まない。

### 13.2 answer draft schema

```ts
type MissionPilotAnswerProposal = {
  questionId: string;
  answer: DesignQuestionnaireAnswer;
  rationale: string;
  confidence: number;
  needsDecision: boolean;
  decisionReason: string | null;
};
```

Plan-role LLMへ次を渡す。

- latest Mission Pilot Context envelope。
- Questionnaire JSON。
- current visible questions。
- option IDs / labels / description。
- recommended answer。
- blocking / dependency / output section。
- 既に提案済みのdependency answers。

自由文の質問にも具体的な回答を作る。安易に`deferred=true`へしない。

### 13.3 dependency loop

1. 現在visibleな未回答questionを抽出する。
2. 1 batchでLLM回答案を生成する。
3. schema / option / answerTypeを検証する。
4. draftへ適用する。
5. dependencyにより新しくvisibleになったquestionを抽出する。
6. 未回答がなくなるまで繰り返す。
7. 最大iterationをQuestion数+1に制限する。

### 13.4 contextStill decision trigger

次のいずれかで`context_decision`を呼ぶ。

- LLMが`needsDecision=true`を返した。
- blocking questionでconfidenceが`0.70`未満。
- valid optionを1つに絞れない。
- proposed answerがGoal / acceptance criteria /既存Artifactと矛盾する。
- LLM retry後もschema-valid answerを作れない。

request:

```ts
{
  sessionId: missionPilotSession.id,
  decisionPoint: `Questionnaire ${question.id} の回答を決定する`,
  metadata: {
    missionPilotSessionId,
    contextRevision,
    contextDigest,
    question,
    candidateAnswers,
    recommendedAnswerId,
    blocking,
    decisionReason
  },
  retrievalHints: {
    domains: ["nightworkers", "mission-pilot", "plan-mode"],
    changeTypes: ["planning", "decision"]
  }
}
```

result handling:

- `execute`: decisionをauthoritative guidanceとしてvalid answerへ変換する。
- `revise_and_execute`:指示に従い回答案を改訂する。
- `reject`: Sessionを`attention`へ停止し、draftをUI表示する。ユーザーへ追加質問を自動送信しない。
- malformed / unavailable: 1回retry後も失敗なら`attention`。

contextStill decision ID、result、answerへの反映を`answer_evidence_json`へ保存する。

## 14. AI回答のUI仮適用

AI回答案が全questionでvalidになったら`mission_pilot_questionnaire_drafts`へ保存する。

保存後:

```text
draft.state = waiting_user
deadlineAt = serverNow + 20 seconds
session.phase = waiting_intervention
session.nextWakeAt = deadlineAt
```

frontend:

- `PlanModeWorkspaceViewer`がfocused TaskのMission Pilot intervention summaryを取得する。
- draftの`answers_json`を既存`answers` stateへ初期適用する。
- `QuestionnaireForm`は既存のままeditableにする。
- user editごとにMission Pilot draft PATCHをserialized queueで即時保存する。deadline直前の入力を落とすため、timerのためだけのdebounceを置かない。
- server response version未満のdraftでlocal stateを巻き戻さない。
- 通常Questionnaire sessionでは既存local state behaviorを維持する。

AI answerとuser editを識別するため、各answer evidenceに`origin: ai | context_still | user`を持つ。確定Answer schema自体は既存形式を維持する。

## 15. 20秒 intervention overlay

Mission Pilot専用画面は作らず、既存Composer上部gapへ`MissionPilotInterventionOverlay`を配置する。

```text
┌──────────────────────────────────────────────────────┐
│ AIがQuestionnaire回答案を入力しました                │
│ 00:20で自動回答  [一時停止]                           │
├──────────────────────────────────────────────────────┤
│ Prompt                                               │
├──────────────────────────────────────────────────────┤
│ [Model] [Thinking]      [Play] [Stop]          [Send] │
└──────────────────────────────────────────────────────┘
```

overlay rule:

- focused Taskが`waiting_intervention`のときだけ表示する。
- deadlineはserver timestampを表示する。
- `remaining = max(0, deadlineAt - serverAdjustedNow)`。
- 1秒intervalは表示更新だけに使う。
- deadline到達時にfrontendがsubmit requestを乱発しない。backend schedulerが正本。
- accessibility用に10秒、5秒、0秒で`aria-live`更新する。
- `prefers-reduced-motion`ではcountdown pulseを使わない。

## 16. Pause / manual submit / Play / timeout

### 16.1 一時停止

一時停止は前段のMission Pilot Stop commandを使う。

```text
desiredState = stopped
phase = paused
nextWakeAt = null
draft.state = paused
draft.deadlineAt = null
```

回答案とuser editsは保持する。Questionnaireはeditableなままにする。

### 16.2 回答ボタン

Pilot Taskで既存回答ボタンを押した場合、frontendはMission Pilot submit endpointを呼ぶ。backendはlatest draftを読み、既存`saveDesignQuestionnaireAnswers()`へ渡す。

成功後:

- draftをsubmittedにする。
- Questionnaire sessionが`review_ready|accepted`であることを確認する。
- Context revisionへQuestionnaire answersを追加する。
- Session desired stateがplayingならArtifact generationへ進む。
- pausedから手動submitした場合も、明示的回答を継続意図とみなしplayingへ戻して進む。

### 16.3 再生ボタン

paused + active draftでPlayを押した場合:

1. latest draftを即submitする。
2. submit成功を確認する。
3. desired stateをplayingにする。
4. 次Artifactへ進む。

回答ボタンを疑似clickしない。同じbackend submit serviceを直接呼ぶ。

### 16.4 timeout

schedulerがdeadline到達sessionをclaimし、latest draftを同じsubmit serviceへ渡す。

- deadline時点のlatest versionを使う。
- schedulerはdeadline到達後500msのin-flight PATCH graceを置き、既にserverへ到達中のuser editをflushしてからclaimする。
- user PATCHと競合した場合はversion conflict後にlatestを再取得する。
- submit済みならno-op success。
- 1回だけQuestionnaire answer mutationを行う。

## 17. API contract

### 17.1 Session summary

```http
GET /api/mission-pilot/tasks/:taskId/session
```

response:

```json
{
  "id": "uuid",
  "taskId": "uuid",
  "desiredState": "playing",
  "phase": "waiting_intervention",
  "contextRevision": 3,
  "contextDigest": "sha256:...",
  "deadlineAt": "2026-07-10T...Z",
  "questionnaireDraft": {
    "id": "uuid",
    "questionnaireSessionId": "uuid",
    "answers": [],
    "state": "waiting_user",
    "version": 2
  }
}
```

### 17.2 Draft edit

```http
PATCH /api/mission-pilot/sessions/:sessionId/questionnaire-draft
```

```json
{
  "expectedVersion": 2,
  "answers": []
}
```

回答schema / option / dependency validationを行う。Chatへmessageを追加しない。

### 17.3 Draft submit

```http
POST /api/mission-pilot/sessions/:sessionId/questionnaire-draft/submit
```

```json
{
  "expectedVersion": 3,
  "trigger": "user_submit"
}
```

trigger:

- `user_submit`
- `play_resume`
- `countdown_expired`

3経路とも同じserviceを使う。

### 17.4 Pause / Play

前段のTask-based Play / Stop APIを維持し、Session commandへ解決する。

- Stop in intervention -> pause and clear deadline。
- Play with draft -> submit then resume。
- Play without draft -> current phaseからresume。

### 17.5 Context debug

通常UIには出さないが、test / diagnostics用read-only routeを用意する。

```http
GET /api/mission-pilot/sessions/:sessionId/context/:revision
```

secretを含めず、Chat contentが存在しないことを検証可能にする。production responseは明示的diagnostics settingで制限する。

## 18. Artifact execution plan

frontend `PlanWorkspaceStatusView`のstep計算をpure shared functionへ分離する。

```ts
buildPlanModeExecutionSteps({
  capabilities,
  viewDecisions,
  questionnaireState,
  existingArtifacts,
}): PlanModeExecutionStep[]
```

各step:

```ts
{
  key: string;
  kind: "questionnaire" | "blueprint" | "data_model" | "dedicated_view" | "feature_plan";
  ordinal: number;
  required: boolean;
  enabled: boolean;
  decision: "include" | "omit";
  status: "pending" | "completed" | "skipped";
}
```

Mission Pilot coordinatorとStatus UIは同じfunction結果を使う。

### 18.1 実行順

1. Questionnaire completion。
2. Blueprint if included and enabled。
3. Data Model if included and enabled。
4. additional viewsを`viewDecisions`の表示順で生成。
5. Feature Plan。

### 18.2 1 stepの完了条件

1. step rowをrunningでclaim。
2. latest Context revisionからprojection作成。
3. existing generator serviceを呼ぶ。
4. TaskMessage / Artifact rowがcommitされる。
5. artifact schema parseが成功する。
6. source message IDとdigestを取得する。
7. ContextへArtifactを追加しrevisionを進める。
8. stepをcompletedにする。
9. `plan_artifact.completed`を発行する。

HTTP 200だけでstep完了にしない。

### 18.3 omitted / disabled

- `omit`は既存Artifactがあっても新規生成しない。
- disabled capabilityはskipped reasonを保存する。
- skipped viewをQueue blockerにしない。
- required Feature Planがdisabledの場合はattentionで停止する。

## 19. Feature Plan self-review

### 19.1 trigger

execution stepsがすべてcompleted / skippedになり、Feature Plan messageとverification documentが存在した時点でreviewを開始する。

### 19.2 review schema

`shared/schemas/mission-pilot-plan-review.schema.ts`:

```ts
type MissionPilotPlanReview = {
  verdict: "pass" | "revise" | "reject";
  summary: string;
  reviewedContextRevision: number;
  reviewedContextDigest: string;
  coverage: {
    goal: "pass" | "fail";
    scope: "pass" | "fail";
    acceptanceCriteria: "pass" | "fail";
    implementationSteps: "pass" | "fail";
    verification: "pass" | "fail";
    artifactConsistency: "pass" | "fail";
    riskAndSafety: "pass" | "fail";
  };
  findings: Array<{
    severity: "blocking" | "warning";
    artifactKind: string;
    sourceId: string;
    issue: string;
    recommendation: string;
  }>;
  revisionTargets: Array<{
    artifactKind: string;
    sourceId: string;
    instruction: string;
  }>;
};
```

### 19.3 review prompt

Review-role LLMは同じcanonical Contextのreview projectionを受ける。

確認事項:

- GoalとFeature Planが一致する。
- initial promptの要求を落としていない。
- Questionnaire確定回答とArtifactが矛盾しない。
- Tech Stackと実装方針が矛盾しない。
- acceptance criteriaが実装stepへ対応する。
- verificationが各required conditionを検証できる。
- open questionがblockingのまま残っていない。
- omitted viewを暗黙前提にしていない。
- Queue workerが追加質問なしで実装できる。

### 19.4 verdict

- `pass`: review evidenceをContextへ追加しQueue gateへ進む。
- `revise`: revisionTargetsだけをPlan-role generatorで再生成し、Contextを更新して再レビューする。
- `reject`:明白な危険、Task目的との不一致、実装不能。Sessionをattentionへ停止する。

revision上限は2回、review attemptは初回を含め最大3回。

review responseが曖昧、findingsとverdictが矛盾、またはQueue可否判断に迷う場合は`context_decision`を使う。`reject`なら停止する。

## 20. Queue admission

`mission-pilot-queue-admission.service.ts`が次を検証する。

1. Session desired stateがplaying。
2. Session phaseがreviewing_planまたはqueueing。
3. pending / running / failed required stepがない。
4. Questionnaireがreview_readyまたはaccepted。
5. Feature Planが存在する。
6. verification documentが存在する。
7. latest reviewがpass。
8. review context revision / digestがSession latestと一致する。
9. review後にArtifact / Goal / Task objectiveが変わっていない。
10. active Queue entryがない。
11. stored authorizationがversion 2でactive、かつtask/sourceRefと一致する。

通過後:

```text
phase = queueing
  -> existing queueTask(taskId, authorized options)
  -> queue entry evidence確認
  -> phase = queued
```

Mission proposalのapprovalRequiredは、初回PlayでactivationしたMission Pilot authorizationが同じproposal IDを指す場合だけ`approveMissionProposal: true`へ変換する。authorizationが無い、未activation、古い、source不一致ならattentionで停止する。

Queue schedulerのauto-drain設定、capacity、repository lock、sequence schedulingを維持する。Mission Pilotは直接`startTaskRun()`を呼ばない。

## 21. Failure / recovery

| failure | state | recovery |
| --- | --- | --- |
| initial Context assembly失敗 | attention | Task/Session transaction rollback |
| Plan Mode event重複 | current phase維持 | event ID / step keyでdedupe |
| Questionnaire LLM schema失敗 | answering_questionnaire | 1回retry後context_decision |
| contextStill reject | attention | draft表示、Queue禁止 |
| draft UI PATCH競合 | waiting_intervention | latest version再取得 |
| process restart during countdown | waiting_intervention | nextWakeAt scanで再開 |
| timeout submit重複 | submitting/submitted | idempotent no-op |
| Artifact generator失敗 | generating_artifacts | bounded retry、以後attention |
| stale LLM response | current phase維持 | discardしてlatest revisionで再実行 |
| plan review revise | revising_plan | target artifactだけ再生成 |
| plan review limit超過 | attention | Queue禁止 |
| Queue gate失敗 | attention | error evidence保存、Task未投入 |
| Queue entry作成後response喪失 | queueing | active entryを照合してqueuedへ回復 |

## 22. Frontend integration

`src/modules/missionPilot`追加/変更:

- `missionPilotSessionCommands.ts`
- `missionPilotSessionQueries.ts`
- `useMissionPilotSession.ts`
- `useMissionPilotQuestionnaireDraft.ts`
- `components/MissionPilotInterventionOverlay.tsx`
- `components/MissionPilotCountdown.tsx`
- existing Task row / Composer control integration。

既存surface変更:

- `PlanModeWorkspaceViewer.tsx`: Pilot draftのinitial merge、Pilot submit adapter。
- `PlanModeQuestionnaire.tsx`: componentは維持。必要ならanswer origin表示だけslot化。
- `ThreadWorkspaceBody.tsx`: intervention overlay slot。
- `Composer.tsx`: generic top overlay slot。Mission Pilot domainをimportしない。
- `PlanWorkspaceStatusView.tsx`: shared execution stepsを表示に使用。Pilot coordinator logicは置かない。
- realtime hook: session summary / draft ready / phase updateをcacheへ反映。

Mission Pilot UI componentは既存surfaceへ埋め込まれるが、Mission Pilot専用pageは追加しない。

## 23. Backend implementation files

`api/modules/missionPilot`:

- `index.ts`
- `mission-pilot.routes.ts`
- `mission-pilot.service.ts`
- `mission-pilot.repository.ts`
- `mission-pilot-context.service.ts`
- `mission-pilot-context-projection.ts`
- `mission-pilot-coordinator.service.ts`
- `mission-pilot-scheduler.ts`
- `mission-pilot-events.ts`
- `mission-pilot-questionnaire.service.ts`
- `mission-pilot-context-still.port.ts`
- `mission-pilot-artifact.port.ts`
- `mission-pilot-plan-review.service.ts`
- `mission-pilot-queue-admission.service.ts`
- `mission-pilot-chat-signal.ts`
- `mission-pilot-taskization.port.ts`

shared:

- `shared/schemas/mission-pilot.schema.ts`
- `shared/schemas/mission-pilot-context.schema.ts`
- `shared/schemas/mission-pilot-event.schema.ts`
- `shared/schemas/mission-pilot-plan-review.schema.ts`
- shared Plan Mode execution step schema / planner。

DB:

- `api/db/mission-pilot-schema.ts`
- `api/db/mission-pilot-schema-bootstrap.ts`
- formal migration under `drizzle/migrations/`。

integration changes:

- Task Generation / Mission Planner taskization transaction hook。
- Workbench Plan Mode event emission。
- Questionnaire ready event emission。
- Artifact generator completion event emission / optional Context envelope input。
- structured LLM prompt buildersのContext envelope受け入れ。
- API router registration。
- app startup scheduler registration / graceful shutdown。

## 24. 実装フェーズ

### Phase 1: Session / Context foundation

Status: `accepted-baseline`。Task / Session / Context v1作成は実装済み。後段で必要になるContext appendとArtifact / review情報だけをPhase 4 / 5で追加する。初期Context全体の再構築は行わない。

accepted baseline:

1. Task / Session / Context v1のatomic作成。
2. sourceRef、Task initial prompt、acceptance criteriaのsnapshot。
3. Session summary APIとPlay / Stop projection。
4. Chat本文を初期Contextへ取り込まないbuilder。

初版にあった汎用Context schema、initial event row、Goal / Tech Stack collectorの追加は、Questionnaire後段の開始条件にしない。後続sliceで実装対象になる場合は、現在のContext revision chainから独立したmigrationとして計画する。

### Phase 2: coordinator / events / Role Context

Status: `superseded-by-minimal-downstream-coordinator`。汎用outbox一式を先に完成させるのではなく、Questionnaire確定後のstep claim、restart recovery、Context revision整合性に必要な永続状態だけをPhase 4で実装する。

今回必要な最小基盤:

1. `(session_id, step_key)` uniqueな永続step claim。
2. Artifact永続化後のimmutable Context revision append。
3. API process restart時のrunning step回収とpending pipeline再開。
4. review / Queue直前のlatest revision / digest照合。

汎用`mission_pilot_events` outbox、Chat signal cursor、全LLM call共通envelopeはこのsliceでは追加しない。Questionnaire readyは既存service listener、後段開始はQuestionnaire submit成功境界、restart recoveryはSession phaseとstep rowを正本にする。

### Phase 3: Questionnaire autonomy / intervention

Status: `accepted-baseline` at `13b2e49b`。既存focused testsを回帰gateとして維持し、このphaseの設計拡張は今回の残タスクに含めない。

accepted baseline:

1. schema-valid draft persistence。
2. 既存Questionnaire UIへの仮適用とedit sync。
3. server-authoritative deadlineとstartup scan。
4. pause / manual submit / Play / timeoutのidempotent submit統合。

初版にあったPlan-role LLM dependency loopとcontextStill fallbackは、現在のQuestionnaire実装を置換する残タスクとして扱わない。

### Phase 4: Artifact順次生成

Status: `implemented`。Status UIとbackend coordinatorは`shared/plan-mode-execution.ts`の同じstep plannerを使用する。stepは`mission_pilot_steps`へ永続化し、generatorが返したTaskMessageとContext revisionを確認してからcompletedにする。

1. shared execution step plannerを抽出し、frontend Statusとbackendで同じ順序・include / omit判定を使う。
2. Mission Pilot step rowと後段schedulerを追加し、Questionnaire確定済みSessionだけをclaimする。
3. backend coordinatorへ既存generator portsを接続する。
4. 1件ずつ生成し、TaskMessage / Artifact schema / source message IDを確認してからContext revisionとstep statusを更新する。
5. omitted / disabled / failed handlingを実装する。
6. frontend localStorage flowとの回帰testを追加する。

完了gate:

- Status上から順に生成される。
- Context revisionがArtifactごとに1つ進む。
- browserを閉じても継続する。

### Phase 5: self-review / Queue

Status: `implemented`。review evidenceは`mission_pilot_plan_reviews`へ保存し、latest Context revision / digestと一致するpassだけをQueue admissionへ使用する。Task Context変更、未完了step、authorization不一致、active Queue entryをgateで再確認する。

1. plan review schema / promptを実装する。
2. review role routingを接続する。
3. revise target generationと最大attemptを実装する。
4. latest Context pass gateを実装する。
5. stored authorizationとexisting queue approvalを接続する。
6. queueTask portを呼び、queue evidenceを確認する。

Phase 5はPhase 4で永続化したstep evidenceとContext revisionを入力にする。Queue admission専用に別のArtifact探索規則を作らず、同じexecution planとlatest Contextを使う。

完了gate:

- failing planがQueueへ入らない。
- revised planだけがQueueへ入る。
- review後のContext変更で再レビューされる。
- active Queue entryが1件だけ作られる。

### Phase 6: E2E / restart / cleanup

1. end-to-end fixtureを追加する。
2. 20秒実時間testとfake clock unit testを分ける。
3. process restart recovery testを追加する。
4. Role Router context continuity evidenceを採る。
5. Chat非包含auditを行う。
6. frontend coordinatorに残ったPilot自動進行logicを削除する。
7. internal import boundaryを検査する。

## 25. Test plan

### 25.1 Session / Context

- Task生成でSessionが1件作られる。
- duplicate createで2件目を作らない。
- Session/Context insert failureでTask/source statusをrollbackする。
- candidate GoalをContextへ入れる。
- proposal source Goal群をContextへ入れる。
- Tech Stack snapshotをContextへ入れる。
- initial promptがTask objectiveと一致する。
- safety policy / repository rootを含む。
- Chat user/assistant contentがContext JSONに存在しない。
- secret keysがContextに存在しない。

### 25.2 Context continuity / Role Router

- plan callがSession ID / revision / digestを受ける。
- review callが同じcanonical chainのlatest revisionを受ける。
- primary model failure -> fallback modelでもdigestが変わらない。
- model/provider metadataがContext本文に混ざらない。
- Context更新後のstale responseがdiscardされる。

### 25.3 Events / coordinator

- Plan Mode entry eventでQuestionnaire待機へ進む。
- duplicate eventが同じstepを再実行しない。
- out-of-order eventを拒否または保留する。
- expired leaseを別workerが回収する。
- paused Sessionはnext stepを開始しない。
- Chat signal cursorは進むがContext revisionは変わらない。

### 25.4 Questionnaire answer

- single choiceをvalid option IDで回答する。
- multi choiceを回答する。
- booleanを回答する。
- free textを回答する。
- rankedを回答する。
- recommended answerをContextと矛盾しない場合に使う。
- dependencyで後からvisibleになる質問も回答する。
- invalid optionをrejectする。
- blocking low-confidenceでcontextStillを呼ぶ。
- contextStill execute / revise_and_executeを反映する。
- contextStill rejectでattentionへ停止する。
- userへのChat質問を生成しない。

### 25.5 Intervention

- AI draftがQuestionnaire UIへ表示される。
- editがserver draftへ保存される。
- countdownはserver deadlineから計算される。
- pauseでdeadlineがnullになる。
- pause後reloadでもdraftが残る。
- manual submitがlatest editを確定する。
- Playがlatest editを確定して継続する。
- timeoutがlatest editを確定する。
- timeoutとmanual submitの競合で1回だけ保存される。
- process restart後に期限切れdraftがsubmitされる。

### 25.6 Artifact順序

- Questionnaire未完了ではArtifactを開始しない。
- Blueprint -> Data Model -> dedicated views -> Feature Planの順になる。
- omit viewを生成しない。
- disabled viewをskipする。
- Artifact DB evidence前に次stepへ進まない。
- ArtifactごとにContext revisionが増える。
- generator retryでduplicate TaskMessageを作らない。

### 25.7 Plan review

- Goal欠落をblocking findingにする。
- acceptance criteria未対応をblocking findingにする。
- verification不足をblocking findingにする。
- Questionnaire矛盾をblocking findingにする。
- pass reviewはrevision/digestを保存する。
- revise reviewは対象Artifactだけ再生成する。
- revision後に再レビューする。
- review上限超過でQueueを禁止する。
- review後Context変更でpassを無効化する。

### 25.8 Queue

- passなしでQueueへ入らない。
- stale reviewでQueueへ入らない。
- pending required stepでQueueへ入らない。
- stored authorizationがversion 2でactive、かつsource一致する。
- Mission proposal approval recordがauthorizationに基づく。
- existing queue admission gateが実行される。
- Queue entryを1件だけ作る。
- direct TaskRunを作らない。
- schedulerがcapacityに従って実行する。

## 26. E2E scenario

必須scenario:

1. Task Generation画面でMission Pilot Taskを作る。
2. DBでTask、Mission Pilot Session、Context revision 1を確認する。
3. ContextにSystemContext、Goal、Tech Stack、initial promptがあることを確認する。
4. Contextに既存Chat本文が無いことを確認する。
5. Playを押す。
6. Plan Mode entry eventを確認する。
7. Questionnaire JSONが生成される。
8. Mission PilotがAI回答draftを作る。
9. uncertain fixture questionだけcontextStill decision evidenceを持つ。
10. Questionnaire UIにAI回答が選択済みで表示される。
11. Composer overlayに20秒countdownと一時停止が表示される。
12. 1問をユーザーが変更する。
13. 一時停止を押す。
14. timerが停止し、reload後も編集済みdraftが残る。
15. 回答ボタンを押さずPlayを押す。
16. 最新draftが即submitされ、Questionnaireがreview_readyになる。
17. Blueprintが生成される。
18. Data Modelが生成される。
19. included dedicated viewsが上から順に生成される。
20. Feature Planが最後に生成される。
21. 各ArtifactごとにContext revisionが進む。
22. Review-role LLMがFeature Planをレビューする。
23. 1回目revise fixtureで自動改訂される。
24. 2回目passがlatest Context digestを持つ。
25. Queue entryが1件作られる。
26. Session phaseがqueuedになる。
27. Queue schedulerが通常lock/capacityでTaskを開始する。

別scenario:

- 20秒を操作せずtimeout submit。
- 回答ボタンを20秒内に押す。
- contextStill rejectで停止。
- process restart during countdown。
- process restart during Artifact generation。
- review fail limit超過でQueue禁止。
- 通常非Pilot Taskの手動Plan Mode回帰。

## 27. Verification evidence

2026-07-11 implementation evidence:

- `tests/mission-pilot-plan-coordinator.test.ts`: Questionnaire完了後のFeature Plan生成、Queue直前にTask Contextが変わった場合の自動再レビュー、既存Queue service委譲、Session `queued`を検証。
- `tests/mission-pilot-plan-pipeline.test.ts`: DB-wide leaseの排他・dead owner回収、Artifact evidence後のContext revision、digest divergence時のtransaction rollback、既存Artifactの冪等採用、review revision / digest保存を検証。
- `tests/plan-mode-execution.test.ts`: Status順序、include / omit、disabled、既存Artifact判定、additional view decisionの重複排除を検証。
- Mission Pilot / Plan Mode / Queue focused suite: 13 files、91 tests pass。
- `bun run typecheck`: pass。
- `bun run verify:base`: pass。
- `bun run verify`: pass。
- `bun run check:docs`: 11 documents consistent。
- fresh SQLite DBに`bun run db:migrate`: pass。`mission_pilot_steps` / `mission_pilot_plan_reviews`、Session lease columns / indexを確認。
- live structured-output provider smoke: pass (`plan` role, `{"status":"ok"}`)。
- `NIGHTWORKERS_LIVE_MISSION_PILOT=1` live E2E: pass。実Codex providerでFeature Plan生成、blocking finding改訂、warning-only reviewのpass正規化、active Queue entry、Session `queued`を確認（242.00秒）。
- live E2E内のAPI process restart: pass。同一SQLiteのArtifact生成済み・step `running`状態を新processが読み、ArtifactをContextとstep evidenceへ冪等採用し、重複Queue entryを作らず`queued`へ復元。
- `bun run test:e2e -- tests/e2e/mission-pilot-entry.spec.ts`: 1 passed。
- final focused Mission Pilot / Plan Mode / Queue suite: 13 files、92 tests pass。
- review hardening後のfocused regression suite: 8 files、65 tests pass。

deterministic gate、live provider gate、実process restart gateがすべて成功したため、このphaseをcompletedとし`spec/archive`へ移動した。

DB:

- `mission_pilot_sessions`。
- `mission_pilot_context_snapshots` revision / digest chain。
- `mission_pilot_steps` order / role / evidence。
- `mission_pilot_events` sequence / dedupe / publish / process status。
- `mission_pilot_questionnaire_drafts` versions / deadline / state。
- `mission_pilot_plan_reviews` verdict / reviewed digest。
- `design_questionnaire_answers` exactly-once rows。
- Plan Artifact TaskMessages。
- `implementation_queue_entries` exactly one active row。

logs / events:

- typed Mission Pilot event sequence。
- Role Router resolved model + shared Context digest。
- contextStill decision ID / outcome。
- pause / timeout / restart recovery evidence。
- Queue admission gate pass。

UI:

- Questionnaire AI draft applied。
- user edit retained。
- countdown / pause / Play controls。
- Artifact Status順序。
- Task row playing / stopped projection。

## 28. Verification commands

```bash
bun run test run <mission-pilot-session-context-tests>
bun run test run <mission-pilot-questionnaire-tests>
bun run test run <mission-pilot-coordinator-tests>
bun run test run <plan-mode-artifact-order-tests>
bun run test run <mission-pilot-plan-review-tests>
bun run test run <mission-pilot-queue-admission-tests>
bun run test run <plan-mode-regression-tests>
bun run typecheck
bun run verify:base
bun run test:e2e -- <mission-pilot-plan-mode-spec>
git diff --check
```

fake timer unit testと、実時間20秒E2Eを両方持つ。E2E全体をfake timerだけで済ませない。

DB migrationはfresh DBと既存DBで検証する。破壊的resetは隔離test DBでのみ行う。

## 29. Definition of Done

1. Task生成とSession/Context作成がatomic。
2. Mission Pilot専用UI pageが存在しない。
3. canonical Contextに指定情報が揃う。
4. Chat本文がContextに存在しないことをtestで保証。
5. 異なるRole Router LLMが同じContext chainを使う。
6. Questionnaireを構造化JSONから自動回答。
7. uncertain回答がcontextStill decisionへ行く。
8. AI回答を既存UIへ仮適用。
9. 20秒intervention、pause、manual submit、Play、timeoutが動く。
10. restart後もcoordinator / deadlineが復元。
11. Artifactが上から順に全自動生成。
12. ArtifactごとにContext更新。
13. Queue直前self-reviewと自動改訂が動く。
14. latest pass reviewなしではQueueへ入らない。
15. Queueは既存schedulerを通る。
16. 通常Task / Plan Mode / Queueに回帰がない。
17. focused tests、typecheck、verify、E2Eが成功。
18. 実装後に本書のstatusとevidenceを更新する。

これはslice 2/3のDefinition of Doneである。Queue entry作成だけでMission Pilot MVPを完成扱いせず、後続正本のImplementation / Test / Review / closeout / true Archiveが統合E2Eで完了することをMVP全体のgateとする。

## 30. 後続phaseへの接続

Queue投入後も同じMission Pilot Session / Context chainを引き継ぐ。

Queue投入後からTask Archiveまでの完了済み実装正本は `spec/archive/mission-pilot-test-review-archive-implementation-plan.md` とする。

後続LLMは新しいChat transcriptを丸ごと渡されるのではなく、Queue直前にpassしたContext revisionを起点にする。

```text
queued Context
  -> implementation role
  -> implementation evidenceをContextへ追加
  -> test role
  -> test evidenceをContextへ追加
  -> review role
  -> review evidenceをContextへ追加
  -> aggregate Git closeout
  -> Task completed
  -> Task archived
```

これにより、Role RouterでLLMが交代してもMission Pilot全体の判断根拠が断絶しない。
