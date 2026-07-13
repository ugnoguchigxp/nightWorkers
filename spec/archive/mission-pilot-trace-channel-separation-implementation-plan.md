# Mission Pilot / Coding Agent Trace Channel Separation Implementation Plan

Status: Completed and archived

Date: 2026-07-13

Target repository: `/Users/y.noguchi/Code/nightWorkers`

## 1. 目的

Mission Pilotの判断、状態遷移、LLM利用、復旧・停止理由を`Pilot thought`へ集約し、従来のchat欄にはユーザーとコーディングエージェントの会話、reasoning、tool、command、diff、verification、final responseだけを表示する。

Mission Pilotがコーディングエージェントを起動した場合も、orchestration ownershipと表示上のproducer ownershipを混同しない。Mission Pilotとの相関関係は保存するが、コーディングエージェントが生成した実行証跡はchatへ表示する。

本計画は表示フィルターだけの修正ではない。永続化時点でproducerと表示channelをtyped provenanceとして保存し、API、realtime、frontendが同じ契約を利用することで、後から生成主体と表示先を追跡できる状態を完成条件とする。

## 2. 現状と問題

2026-07-13の稼働DBと現行コードから、次を確認した。

1. `ThreadWorkspace`は`showDebugEvents=true`で開始する。
2. `ThreadTimeline`はTask全体の`activity_events`を受け取り、debug表示時はsourceを分けずに組み立てる。
3. Mission PilotのQuestionnaire、artifact correction、coordinatorイベントは`source=mission_pilot`で`activity_events`へ保存されるため、通常chatにも表示される。
4. Mission Pilotのinitial promptは`task_messages.role=user`として保存され、activity projectionでは`source=user`へ変換される。
5. Mission PilotはPlan Artifact生成時にstructured LLMへ`role=mission_pilot`を渡すが、生成された`task_messages`は`role=assistant`、activity projectionは`source=assistant`になる。生成主体の情報がmessage/activityの正規列に残らない。
6. `llm_usage_records.metadata_json.role`にはroleがあるが、対応する`activity_events.payload_json`へroleが投影されない。
7. `PilotThoughtDock`は`activity_events.source=mission_pilot`と`task_events.actor=mission_pilot`を直接拾う一方、Mission Pilot execution APIが返したowned runの`task_events`はactorに関係なく全件追加する。
8. したがって、Mission Pilot logがchatへ漏れ、Mission Pilot生成物がcoding agentのassistant出力に見え、Mission Pilot配下のcoding agent reasoning/tool eventがPilot thoughtにも入る。

稼働DBの代表Taskでは、観測時点で`activity_events=30`、`source=mission_pilot`が7件、`run_id is null`の`assistant.message`が9件、`task_messages=11`、Mission Pilot initial promptが1件、`run_id is null`のassistant messageが9件だった。これはUIだけでは生成主体を完全に復元できないことを示すbaselineであり、実装開始時に同じqueryを再実行して最新値を記録する。

## 3. Locked Decisions

以下を本実装の固定契約とする。

1. Mission Pilotのsource of truthはchat transcriptではなく、Mission Pilot Session、Context、Step、Review、Event、Phase Runである。
2. 通常chatの表示対象は`traceChannel=chat`だけとする。
3. Pilot thoughtの表示対象は`traceOwner=mission_pilot`かつ`traceChannel=pilot_thought`だけとする。
4. `showDebugEvents`は同じchannel内のdetail levelだけを切り替える。別channelを表示対象へ追加してはならない。
5. Mission Pilotが起動・所有するTaskRunでも、そのrun内のworker/tool/verifier eventは`traceOwner=coding_agent`、`traceChannel=chat`とする。
6. Mission Pilotとの関係は`orchestrationRef`で保持し、`traceOwner`へ上書きしない。
7. Mission Pilotが生成したBlueprint、Data Model、dedicated view、Feature Plan、Verification JSONは`traceChannel=artifact`とし、本文をchatにもPilot thoughtにも重複表示しない。
8. Artifact生成開始、採用、review、correction、失敗などの要約イベントはMission Pilotが発生させた場合に`pilot_thought`へ表示し、artifact ID / message IDへの相関を保存する。
9. Mission Pilot initial prompt、Questionnaire draft/finalize、Queue handoff、attention、recoveryは`pilot_thought`へ表示し、通常chatのuser messageとして扱わない。
10. 人間がchat composerから送信したmessageだけを`traceOwner=user`、`traceChannel=chat`とする。
11. actor、role、source、run ownership、display channelを同じ概念として扱わない。
12. ユーザー本文、LLM本文、event textのkeyword / regexからownerやchannelを決めない。
13. provider層はtrace routingを判断しない。呼び出し元が渡したtyped trace contextを透過的にusage/event persistenceへ引き渡すだけとする。
14. owner/channelが不明なlegacy rowはchatやPilot thoughtへ推測表示せず、`system/internal`へ閉じる。migration reportで未分類件数を可視化する。
15. 同一event rowを複数channelへ投影しない。別surfaceへ要約が必要な場合は別eventを作成し、`parentEventId`またはtyped source refで関連付ける。
16. manual WorkBench、manual Plan Mode、Test Mode、Review Modeの既存実行判断やphase contractは変更しない。
17. prompt文言は日本語を維持する。
18. 本契約を変更する場合は実装より先に本書を更新する。

## 4. Target Display Contract

| 生成物・イベント | traceOwner | traceChannel | 表示先 |
| --- | --- | --- | --- |
| 人間がcomposerから送信したmessage | `user` | `chat` | chat |
| coding agentのassistant text / reasoning | `coding_agent` | `chat` | chat |
| coding agentのtool / command / diff / verification / run status | `coding_agent` | `chat` | chat |
| Mission Pilot coordinator decision / state / attention / recovery | `mission_pilot` | `pilot_thought` | Pilot thought |
| Mission Pilot structured LLM request / usage / review summary | `mission_pilot` | `pilot_thought` | Pilot thought |
| Mission Pilot initial prompt / Questionnaire lifecycle | `mission_pilot` | `pilot_thought` | Pilot thought |
| Mission Pilotが生成したPlan Artifact本文 | `mission_pilot` | `artifact` | Plan Mode / Artifact pane |
| Plan Artifact生成・採用・修正の要約 | `mission_pilot` | `pilot_thought` | Pilot thought |
| Mission Pilotが起動したimplementation/test/review runのagent event | `coding_agent` | `chat` | chat |
| 上記runとMission Pilot Sessionの所有関係 | `coding_agent` | `chat` + `orchestrationRef` | chat、詳細JSONでPilot相関を確認可能 |
| owner不明のlegacy/system event | `system` | `internal` | 通常非表示、diagnostic APIのみ |

## 5. Typed Provenance Contract

shared schemaへ次を追加する。

```ts
type TraceOwner =
  | "user"
  | "mission_pilot"
  | "coding_agent"
  | "system";

type TraceChannel =
  | "chat"
  | "pilot_thought"
  | "artifact"
  | "internal";

type TraceProvenance = {
  owner: TraceOwner;
  channel: TraceChannel;
  producer: {
    kind: "user" | "structured_llm" | "agent_runtime" | "runtime" | "system";
    role?: LlmRole | null;
    runId?: string | null;
    callId?: string | null;
  };
  orchestrationRef?: {
    kind: "mission_pilot";
    sessionId: string;
    phaseRunId?: string | null;
    phase?: string | null;
    cycle?: number | null;
    attempt?: number | null;
  } | null;
};
```

`source`と`actor`は既存の詳細主体として維持する。たとえばcoding agent run内のtool eventは`source=tool`または`actor=tool`のまま、`traceOwner=coding_agent`とする。

DBには最低限、queryとindexに必要な正規列を保存する。

- `task_messages.trace_owner text not null`
- `task_messages.trace_channel text not null`
- `activity_events.trace_owner text not null`
- `activity_events.trace_channel text not null`
- `llm_usage_records.trace_owner text not null`
- `llm_usage_records.trace_channel text not null`

SQLite migrationでは各列を安全側の`system` / `internal` default付きで追加し、同一migration内でdurable relationによるbackfillを行う。application writerはdefaultへ依存せずtrace inputを必須とし、直接insertや未更新call siteが残った場合でもMission Pilotまたはcoding agentの情報が誤ったsurfaceへ漏れないようにする。

詳細な`producer`と`orchestrationRef`は既存の`metadata_json` / `payload_json`へstrict schemaで保存する。`run_id`、`call_id`、Mission Pilot tableのforeign key関係を重複する汎用JSONだけに依存させない。

追加index:

- `activity_events_task_channel_seq_idx (task_id, trace_channel, seq)`
- `activity_events_task_owner_channel_created_idx (task_id, trace_owner, trace_channel, created_at)`
- `task_messages_task_channel_created_idx (task_id, trace_channel, created_at)`
- `llm_usage_records_task_owner_created_idx (task_id, trace_owner, created_at)`

## 6. Write-path Design

### 6.1 Central trace constructors

`api/modules/nightworkers`にtyped helperを置き、call siteが文字列を個別生成しないようにする。

- `userChatTrace()`
- `codingAgentChatTrace({ runId, orchestrationRef? })`
- `missionPilotThoughtTrace({ sessionId, phase, cycle?, attempt?, callId? })`
- `missionPilotArtifactTrace({ sessionId, stepId?, correctionRunId? })`
- `systemInternalTrace({ reason })`

`createTaskMessage`、`appendActivityEvent`、`recordLlmUsage`のinputで`trace`を必須にする。低レベルrepositoryでrole/sourceから暗黙決定するfallbackは設けない。compile errorをcall-site inventoryとして利用し、全writerを明示的に更新する。

### 6.2 TaskMessage projection

`createTaskMessage`が作る`activity_events`は、message roleからsourceを決める現行処理を残しつつ、owner/channelはinput traceをそのまま継承する。

- `role`はchat protocol上のuser/assistant/system/toolを表す。
- `traceOwner`は生成責任主体を表す。
- `traceChannel`は表示先を表す。
- artifact projection eventも元messageのtraceを継承する。

Mission Pilot Plan Artifact generatorは`role=mission_pilot`をLLM routingだけに使用せず、`missionPilotArtifactTrace`をmessage/artifact persistenceへ渡す。

### 6.3 Structured LLM / usage

`CallSupervisorOptions` / `StructuredJsonLlmOptions`へ`traceContext`を追加する。roleからownerを推測する互換処理はservice境界の一か所に限定し、Mission Pilot call siteはSession IDを含む明示contextを渡す。

`recordLlmUsage`は`llm_usage_records`と`activity_events`へ同じowner/channelを保存し、activity payloadにもrole、callId、Mission Pilot orchestration refを含める。provider実装はこの分類に関与しない。

### 6.4 Run event projection

TaskRunのruntime eventをactivity ledgerへ投影する際は、TaskRun自身をproducer boundaryとする。

- 通常run: `coding_agent/chat`
- Mission Pilot phase run: `coding_agent/chat` + Mission Pilot `orchestrationRef`
- coordinatorがTaskRun外で発生させたevent: `mission_pilot/pilot_thought`

`mission_pilot_phase_runs`へのjoinはorchestration ref追加のために使い、channelをPilot thoughtへ変更するために使わない。

## 7. Read / Projection Design

### 7.1 Chat API

Task activity APIは`channel` queryをstrict enumで受け取れるようにし、Workbench chatは`channel=chat`だけを取得する。server-side filterを正本とし、frontendでも`traceChannel === "chat"`をassertする。

Task message APIもchat用途では`trace_channel=chat`へ限定する。Plan Modeやartifact組み立てで全messageが必要な既存serviceは、UI chat endpointとは別のinternal repository queryを利用し続ける。

realtimeの`activity_event_created`にもowner/channelを含め、chat query cacheは`chat`以外を追加しない。Pilot thoughtはchat cacheをfallback sourceとして使わない。

### 7.2 Pilot thought API

Mission Pilot execution trace endpointは、次だけを返す。

- `mission_pilot_events`
- `activity_events`の`mission_pilot/pilot_thought`
- attention diagnostic
- Questionnaire state summary
- artifact lifecycle summaryとartifact/message ref

現行の「Mission Pilot Sessionに属するphase runの`task_events`を全件返す」contractは廃止する。phase runは一覧・状態・run IDをorchestration summaryとして返せるが、coding agentのreasoning/tool payloadをPilot thought itemsへ変換しない。

### 7.3 Artifact read path

Plan Mode workspaceとArtifact paneは`artifact` channelのmessageを従来どおりsource message IDから取得する。chatから除外してもartifact採用、Context組み立て、Verification Document、Queue handoffが壊れないことをservice testで固定する。

## 8. Frontend Plan

### 8.1 `ThreadTimeline`

- input名を`chatActivityEvents` / `chatTaskMessages`へ変更し、channel境界をcomponent contractで明示する。
- defensive assertion/filterを追加し、Mission Pilot eventが渡されても描画しない。
- `showDebugEvents`はcoding agent channel内のdebug detailsだけを切り替える。
- Mission Pilot initial promptをunprojected user messageとしてmergeする既存testを置換し、人間のuser messageだけをchronological merge対象にする。
- coding agent runのreasoning、tool、command、diff、verification、final reportの時系列・windowingは維持する。

### 8.2 `PilotThoughtDock`

- `activityEvents`と`runEvents` propsを削除し、専用trace endpointだけを読む。
- `missionPilotTraceItems`からowned run eventの無条件展開を削除する。
- coordinator / LLM / state / diagnostic / artifact summaryだけを表示する。
- coding agent runは`runId`を持つphase summaryとして参照可能にするが、agent event本文は表示しない。
- artifact summaryから既存Plan Mode / Artifact paneを開ける場合は、既存callbackを再利用し新しい専用画面を作らない。

### 8.3 Workspace / realtime

- `useNightWorkersWorkspace`はchat用queryをchannel限定で取得する。
- realtime reducerはchannel違反eventをchat stateへ入れない。
- task切替、再読込、restart後も同じserver projectionを使う。
- Pilot thoughtを閉じている間もchatへPilot eventをfallback表示しない。

## 9. Existing Data Migration / Backfill

formal migrationは`0038_trace_provenance.sql`として追加し、Drizzle schemaとruntime bootstrapを同時に更新する。

backfillは本文・タイトル・日本語文言を解析せず、次のdurable relationを優先順に使う。

1. `activity_events.run_id is not null`
   - `coding_agent/chat`。
   - `mission_pilot_phase_runs.run_id`に一致する場合はowner/channelを変えず、orchestration refをpayloadへ追加する。
2. `activity_events.source = mission_pilot`
   - `mission_pilot/pilot_thought`。
3. TaskMessage由来activity (`external_id` / `turn_id`がmessage ID)
   - 対応するTaskMessageのowner/channelを継承する。
4. Mission Pilot artifact relation
   - `mission_pilot_steps.artifact_message_id`
   - `mission_pilot_artifact_correction_runs.result_message_id`
   - `mission_pilot_plan_reviews.feature_plan_message_id`
   - Queue handoff / Contextのtyped source message refs
   - 一致messageを`mission_pilot/artifact`とする。
5. `task_messages.message_type = mission_pilot_initial_prompt`またはtyped metadata sourceがMission Pilot
   - `mission_pilot/pilot_thought`。
6. `llm_usage_records.metadata_json.role = mission_pilot`
   - `mission_pilot/pilot_thought`。
7. 非Mission Pilotのrun-associated usage/message/event
   - `coding_agent/chat`。
8. 人間が作成したことをtyped metadataまたは既存submit pathで証明できるuser message
   - `user/chat`。
9. どの規則でも証明できないrow
   - `system/internal`。

migration前後に件数reportを出すread-only scriptを追加する。

- owner/channel別件数
- Mission Pilot Session別のPilot thought件数
- Mission Pilot artifact relationに紐づくmessageの未分類件数
- `chat`に残った`source=mission_pilot`件数
- `pilot_thought`に入ったrun-associated coding agent event件数
- `internal`へ退避したlegacy row件数とID一覧

完了条件は、Mission Pilot関係の未分類が0、chat内Mission Pilot eventが0、Pilot thought内coding agent run eventが0である。一般legacyの`internal`件数は0を強制しないが、reportを保存して意図しない欠落がないことをreviewする。

## 10. Implementation File Plan

### Shared / DB

- `shared/schemas/trace-provenance.schema.ts`（新規）
- `api/db/schema-activity.ts`
- `api/db/schema-llm-usage.ts`
- `api/db/bootstrap-runtime-tables.ts`
- `api/db/bootstrap-task-workflow-tables.ts`
- `drizzle/migrations/0038_trace_provenance.sql`（新規）
- `api/scripts/report-trace-provenance.ts`（新規、既定read-only）

### Persistence / projection

- `api/modules/nightworkers/nightworkers.trace-provenance.ts`（新規）
- `api/modules/nightworkers/nightworkers.repository.ts`
- `api/modules/nightworkers/nightworkers.activity-persistence.repository.ts`
- `api/modules/nightworkers/nightworkers.activity.repository.ts`
- TaskRun eventからactivity ledgerへのprojection箇所
- `api/services/structured-llm/types.ts`
- `api/services/structured-llm/index.ts`
- `api/services/llm-usage/repository.ts`

### Mission Pilot

- `api/modules/missionPilot/mission-pilot-event.repository.ts`
- `api/modules/missionPilot/mission-pilot-execution-query.service.ts`
- `api/modules/missionPilot/mission-pilot-plan-support.ts`
- `api/modules/missionPilot/mission-pilot-artifact-correction.service.ts`
- `api/modules/missionPilot/mission-pilot-questionnaire.service.ts`
- `api/modules/missionPilot/mission-pilot.repository.ts`
- Mission Pilot Plan intake / coordinator / reviewのstructured LLM call sites

### Frontend

- `src/modules/nightworkers/types/activity.ts`
- `src/modules/nightworkers/types/blueprint.ts`
- `src/modules/nightworkers/messageVisibility.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `src/modules/nightworkers/components/ThreadTimelineNormalTranscript.tsx`
- `src/modules/missionPilot/components/PilotThoughtDock.tsx`
- `src/modules/missionPilot/missionPilotCommands.ts`
- `src/modules/nightworkers/components/NightWorkersShellLayout.tsx`

## 11. Implementation Phases

### Phase 0: Contract tests and baseline

1. live DBのowner不明状態と表示混在をsnapshotする。
2. target display matrixをtable-driven unit testにする。
3. chatへMission Pilot eventが入る現行ケース、Pilot thoughtへcoding agent run eventが入る現行ケースをred testとして追加する。
4. manual WorkBench / Plan Modeのbaseline testを固定する。

Gate:

- 現行不具合がtestで再現する。
- Task/message/event IDで混在経路を説明できる。

### Phase 1: Provenance schema and migration

1. shared schemaとcentral trace constructorを追加する。
2. DB列・index・bootstrap・formal migrationを追加する。
3. deterministic backfillとreport scriptを追加する。
4. repository writerのtrace inputを必須化する。

Gate:

- fresh DBと既存DBの両方でmigration成功。
- Mission Pilot関係の未分類0。
- backfill再実行で結果が変わらない。
- user text / event textを分類に使っていない。

### Phase 2: Producer propagation

1. Mission Pilot coordinator/questionnaire/recovery eventを`pilot_thought`で保存する。
2. Mission Pilot Plan Artifact messageを`artifact`で保存する。
3. structured LLM usage/debug eventへtrace contextを通す。
4. TaskRun eventを常にcoding agent producerとして投影し、Mission Pilot associationはorchestration refへ保存する。
5. messageからactivityへのprojectionでprovenanceを継承する。

Gate:

- 新規writerがowner/channelなしではcompileしない。
- `role=mission_pilot` callのusage eventがPilot thoughtへ入る。
- Mission Pilot phase runのtool/reasoning eventがchatへ入る。
- Artifact本文がchat/Pilot thoughtへ重複しない。

### Phase 3: Server-side channel projection

1. chat activity/message endpointをchannel限定にする。
2. Pilot thought endpointをMission Pilot trace専用projectionへ変更する。
3. owned run event全件返却を廃止し、phase summaryと相関refだけを残す。
4. realtime event/cache更新をchannel-awareにする。

Gate:

- API単体でchatとPilot thoughtのintersectionが空集合。
- channel queryなしのUI-facing endpointが混在streamを返さない。
- internal repository queryを使うPlan Context / artifact生成は回帰しない。

### Phase 4: Frontend separation

1. `ThreadTimeline`をchat-only inputへ変更する。
2. Mission Pilot promptのchat mergeを除去する。
3. `PilotThoughtDock`のactivity/run props fallbackを除去する。
4. debug toggleがchannel境界を越えないことを固定する。
5. artifact summaryと既存Plan Mode paneの接続を維持する。

Gate:

- debug ON/OFFの両方でchatにMission Pilot logが0件。
- Pilot thoughtにcoding agent reasoning/tool/command/diffが0件。
- coding agentのchat履歴、chronology、100件window、streaming、final reportが維持される。
- Questionnaire / Plan Artifactは既存workspaceから利用できる。

### Phase 5: E2E, migration verification, archive

1. scenario catalogへP0分離scenarioを追加する。
2. first Play、Questionnaire、Artifact、Queue、Implementation、Test、Review、attention、restartを通す。
3. DB/API/UIの3層でowner/channelを照合する。
4. `verify`を実行し、evidenceを本書へ追記する。
5. 全gate成功後に本書を`spec/archive`へ移す。

Gate:

- required E2Eが100% pass、P0 flake 0。
- migration reportの禁止件数がすべて0。
- manual non-Pilot workflowに回帰がない。

## 12. Test Plan

### Unit / schema

- TraceOwner / TraceChannel schemaのvalid/invalid cases。
- owner/channel/actor/source/orchestrationRefを独立して保持する。
- trace constructorが許可されない組み合わせを拒否する。
- owner不明fallbackが`system/internal`以外にならない。

### Persistence

- `createTaskMessage`からactivityへprovenanceが同値継承される。
- Mission Pilot initial promptがuser/chatにならない。
- Mission Pilot artifact messageがassistant/chatにならない。
- structured LLM usage activityへroleとtrace contextが残る。
- Mission Pilot phase runのtask eventがcoding_agent/chatになる。
- dedupe時に異なるchannelのrowへ誤収束しない。

### Projection / frontend

- `ThreadTimeline`が`pilot_thought` / `artifact` / `internal`を描画しない。
- `PilotThoughtDock`が`coding_agent/chat`を描画しない。
- `showDebugEvents=true`でもchannel違反が起きない。
- userとcoding agentのchronologyが維持される。
- streaming response、persisted response、tool card、diff、final reportがchatに残る。
- artifact本文はPlan Mode / Artifact paneで開ける。

### Migration

- recent live shapeをfixture化してbackfill結果を検証する。
- Mission Pilot step/correction/review refからartifact ownerを復元する。
- `metadata_json.role=mission_pilot`からusage ownerを復元する。
- phase run associationがcoding agent eventをPilot ownerへ変えない。
- unresolved legacyがinternalへ退避される。
- migrationの二重実行・restartで結果が変わらない。

### E2E

新規scenario:

`NW-E2E-MISSION-PILOT-TRACE-001`（P0 / regression）

1. Mission PilotをPlayする。
2. Questionnaire draft/wait/finalizeがPilot thoughtだけに出る。
3. Blueprint/Data Model/Feature Plan本文がchatに出ず、Plan Mode workspaceで開ける。
4. Queue handoff後にcoding agent implementation runを開始する。
5. coding agent reasoning/tool/command/diff/final responseがchatだけに出る。
6. Pilot thoughtにはphase開始・完了・attentionなどMission Pilot要約だけが出る。
7. debug ON/OFF、reload、API restart後も分離が維持される。
8. DBのowner/channel、chat API、Pilot trace API、画面表示が一致する。

既存`mission-pilot-through-archive` scenarioにも、implementation/test/reviewのagent eventがPilot thoughtへ混入しないassertionを追加する。

## 13. Verification Commands

Focused:

```bash
bun run test -- tests/pilot-thought-dock.test.tsx tests/thread-timeline-window.test.ts tests/thread-timeline-streaming.test.ts tests/mission-pilot-contract.test.ts tests/mission-pilot-plan-pipeline.test.ts tests/nightworkers-routes/routes-nightworkers-02.test.ts
```

Migration / schema:

```bash
bun run db:migrate
bun api/scripts/report-trace-provenance.ts
bun run typecheck
```

E2E:

```bash
bun run test:e2e -- tests/e2e/mission-pilot-trace-separation.spec.ts
bun run test:e2e -- tests/e2e/mission-pilot-through-archive.spec.ts
```

Repository gates:

```bash
bun run check:docs
bun run check:architecture
bun run verify
```

`verify:live`は本変更の決定的gateに含めない。外部providerでの観測が必要な場合だけ別途実行し、deterministic passと混同しない。

## 14. Completion Criteria

次をすべて満たした場合だけ完了とする。

1. 新規event/message/usageの100%にvalidなowner/channelが保存される。
2. chat APIがMission Pilot / artifact / internal rowを返さない。
3. Pilot thought APIがcoding agent chat rowとowned run event本文を返さない。
4. Mission Pilot配下のcoding agent runにMission Pilot correlationが残る。
5. chatとPilot thoughtのevent ID intersectionが空である。
6. debug toggleでchannel境界が変わらない。
7. Mission Pilot Artifact本文がchatから消えてもPlan pipelineとArtifact paneが機能する。
8. migration後の禁止件数がすべて0。
9. reload / restart / realtime replay後も同じ分離結果になる。
10. manual WorkBench / Plan / Test / Review flowに回帰がない。
11. focused test、migration check、E2E、`bun run verify`が成功する。
12. verification evidenceを本書へ追記し、完了後にarchiveする。

## 15. Verification Evidence (2026-07-13)

実装完了時の決定的証跡:

- `bun run db:migrate`: `0038_trace_provenance`を正式適用し成功。
- live DB migration: `.nightworkers/sqlite.db`へ同一migrationを適用し、事前backupを`/tmp/nightworkers-pre-trace-provenance.sqlite`へ保存。
- `DATABASE_URL=.nightworkers/sqlite.db JWT_SECRET=trace-report-local-only-secret bun api/scripts/report-trace-provenance.ts`: `ok=true`。禁止件数は10項目すべて0。
- live distribution: activity=`coding_agent/chat:3`, `mission_pilot/artifact:7`, `mission_pilot/pilot_thought:19`。message=`coding_agent/chat:3`, `mission_pilot/artifact:6`, `mission_pilot/pilot_thought:2`。usage=`mission_pilot/pilot_thought:11`。
- focused Vitest: provenance repository、Pilot thought、chat timeline、realtime、Mission Pilot plan coordinator、LLM usageを含む対象suiteがpass。
- `NW-E2E-MISSION-PILOT-TRACE-001`: API、DB、chat UI、Pilot thought UI、event ID intersectionを照合しpass。
- `NW-E2E-MISSION-PILOT-003`: archive完了後のphase-run activityが`coding_agent/chat`だけであることを追加確認しpass。
- `bun run check:docs`: pass。
- `bun run check:architecture`: pass。
- `bun run verify`: tracked artifacts、architecture、typecheck、lint、supervisor regressionがすべてpass。

追加で`bun run verify:full`を実行した。今回追加したtrace mock / realtime fixtureの2件は修正後pass。残存失敗は、同時進行中の別差分に属するartifact theme、Quality、Codex warning catalog、Plan Mode source-string contractなど11 test fileであり、本変更の対象外として変更していない。full-suite cleanup後にlive DBが空になったことを検出したため、migration前backupから即時復元し、`0038`と当時の最新migrationを再適用した。復元後はTask 1、activity 29、message 11、usage 11を確認し、禁止件数は再度すべて0となった。

この証跡により、本計画のowner/channel分離、migration、API/realtime/UI防御、P0 E2E、通常verifyの完了条件を満たした。本書をarchiveへ移す。

### 15.1 Post-implementation review

完了後レビューで、payload内の自己申告`traceProvenance`を新規rowの分類根拠にできる信頼境界上の問題を修正した。owner/channelは明示された内部trace、run、role/source contractだけから決定し、payloadのtraceは保存後の監査情報として扱う。また、Artifact message用の`mission_pilot/artifact`と、その生成LLM usage用の`mission_pilot/pilot_thought`を別引数へ分け、同じMission Pilot sessionへ相関させた。非object payloadは`rawPayload`として保持し、trace付与による情報欠落を防止した。

レビュー後検証は、型検査、生成系5 suite 37件、trace/UI/realtime 5 suite 22件、provenance/usage 2 suite 6件がpass。監査はowner/channel違反に加え、payloadと列の不一致を含む10項目すべて0。現在のworktree全体のarchitecture checkは、同時進行中のPlan routing差分にある既存のoversized file 3件で失敗するため、本変更ではそれらを編集・分割していない。

## 16. Non-goals

- Mission Pilot state machine、Play/Stop、Questionnaire 20秒intervention contractの変更。
- Plan Artifact内容や生成promptの再設計。
- coding agentのreasoning内容そのものの変更。
- chat UIまたはPilot thought UIの全面デザイン変更。
- provider別のtrace routing判断。
- chat本文の要約・分類・keyword判定。
- unrelatedなTaskRun、Queue、Git、Review、Test lifecycleの変更。
- user所有のdirty worktree変更の整理。

## 17. Risks and Controls

| Risk | Control |
| --- | --- |
| chatからartifactを除外した結果、Plan Contextが欠落する | UI chat queryとinternal repository queryを分離し、artifact serviceは全message queryを維持する |
| Mission Pilot owned runをPilot thoughtから除外して相関を失う | phase summaryと`orchestrationRef`を残し、run IDからchat traceへ追跡可能にする |
| legacy backfillが誤分類する | durable FK/source refだけを使い、不明rowはinternalへ退避する |
| realtimeだけchannel filterをすり抜ける | server projection、realtime reducer、component assertionの3層で同じenumを検証する |
| role/sourceの既存意味を壊す | 新しいowner/channelを追加し、actor/role/sourceは変更しない |
| providerへworkflow責務が漏れる | trace contextはcallerで決定し、providerは透過転送だけにする |
| eventを両surfaceへ重複表示する | 1 row = 1 channel invariantとintersection testを追加する |
