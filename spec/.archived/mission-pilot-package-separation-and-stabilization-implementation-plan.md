# Mission Pilot Pure TypeScript Boundary Separation and Stabilization Implementation Plan

## Status

- Plan status: `implemented`
- Implementation status: `completed`
- Baseline commit: `f11c83bf050b73640ac334c14ec7f38e0697252f`
- Last updated: 2026-07-31
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Package target: `packages/mission-pilot`
- TypeScript alias namespace: `@nightworkers/mission-pilot/*`
- Coding Agent location: unchanged
- Coding Agent production changes allowed by this plan: none

この文書は、Mission PilotをNightWorkers本体からPure TypeScript境界へ分離し、Coding AgentをMission Pilotなしで常に単体起動できる状態を維持したまま、Mission Pilotを人間ユーザーと同じ公開操作だけで動かし直すための実装正本である。`packages/mission-pilot`は独立npm projectではなく、root toolchainで型検査・buildされるsource boundaryである。

2026-07-31の設計修正により、Mission Pilot境界は独自の`package.json`、Drizzle instance、LibSQL clientを持たない。SQLite schema、bootstrap、transaction、repositoryはNightWorkers本体の`api/modules/missionPilot/persistence`が所有し、`api/composition/mission-pilot`だけが取得できる非HTTP capabilityをpackageへ注入する。本修正は、複数DB clientによる同時書込み競合と、汎用DB endpoint化による権限拡大を防ぐため、以降の旧workspace/package-owned persistence記述に優先する。

古い計画のうち、Mission Pilotを`api/modules/missionPilot`、`src/modules/missionPilot`、`shared/modules/missionPilot`へ置くという配置方針は、この文書で置き換える。責務境界、構造的provenance、Task Operatorの利用、Coding Agent単体動作、Plan ModeのAgent非依存性に関する既存ルールは維持し、より強く検査する。

## 1. Executive Decision

採用する構成は、NightWorkers本体を現在のrepository rootに残し、Mission Pilotのbehavior/UI/contractsを同一repository内のPure TypeScript source boundaryへ移す構成とする。SQLite persistenceだけはNightWorkers本体のrole moduleに残す。

```text
nightWorkers/
  api/
    modules/
      missionPilot/
        persistence/      # SQLite schema/bootstrap/repositoryと非HTTP capability
      codingAgent/        # 現状維持。Mission Pilot対応では変更しない
      planMode/           # Plan Modeの正本。Agentをimportしない
      taskOperator/       # ユーザーとMission Pilotが共有する公開resource/action
      nightworkers/       # Agent非依存のTask正本
    composition/
      mission-pilot/      # packageをhostへ接続する唯一のbackend composition

  src/
    modules/
      codingAgent/        # 現状維持。Mission Pilot対応では変更しない
      planMode/           # Agentをimportしない
      nightworkers/       # Agent非依存UI
    composition/
      mission-pilot/      # packageをhostへ接続する唯一のfrontend composition

  packages/
    mission-pilot/
      src/
        contracts/
        backend/
        frontend/
        testing/
```

repositoryを完全分離しない理由は、Task Operator、realtime、認証、DB、SystemContext、UI compositionを同一変更で検証しやすくするためである。ただし、単にディレクトリを`packages/`へ移すだけでは境界にならない。root TypeScript alias、依存方向、composition root、静的検査、runtime failure isolationを同時に導入する。

別repository化は、このpackage境界で次の条件が満たせなくなった場合だけ再検討する。

- 独立したrelease cadenceが必要になった。
- 独立したaccess controlまたは機密境界が必要になった。
- NightWorkersと別versionのMission Pilotを複数組み合わせる必要が生じた。
- package exportだけでは循環依存を防止できない外部consumerが生じた。

現時点では、別repository化による開発・schema migration・E2E coordinationの負担が利益を上回る。

## 2. Non-Negotiable Invariants

### 2.1 Coding Agent

- `api/modules/codingAgent/**`を変更しない。
- `src/modules/codingAgent/**`を変更しない。
- `shared/modules/codingAgent/**`を変更しない。
- Coding Agentのroute、service、repository、runtime、public indexをMission Pilot packageからimportしない。
- Coding Agentの起動をMission Pilot session、handoff、desired state、phase、routing revision、package bootstrap成功へ依存させない。
- ユーザー直結Coding Agentは、Mission Pilotが未起動、停止、DB初期化失敗、runtime停止のいずれでも、Task intake、Plan Mode判定、repository調査、実装、command実行、検証、完了報告まで単体で完結する。
- Coding AgentのPlan Mode起動、questionnaire生成、repository調査、技術選択をMission Pilotへ移さない。
- Coding Agentは単一runtimeを維持し、Mission Pilot対応用mode、tool allowlist、固定workflowを追加しない。

この計画の実装中にCoding Agent production codeの変更が必要に見えた場合、そのcheckpointを停止する。変更理由、Coding Agentを変更しない代替案、Task Operatorまたはcompositionで解決できない根拠を先に文書化し、ユーザーの明示承認なしには進めない。

### 2.2 Mission Pilot

- Mission Pilotは「人間ユーザーに許可された操作を代行するAI」であり、ユーザーより強い権限や専用能力を持たない。
- folder、filesystem、Git HEAD、worktree、repository内容を読まない。
- shell、filesystem、Git、Coding Agent repository toolに相当するportをpackageへ定義しない。
- Task Operatorの公開resourceを読み、公開actionを実行する。
- 専用のQuestionnaire API、Plan routing API、Artifact API、Coding Agent内部APIを作らない。
- ユーザー操作との差は、principalと構造的provenanceだけに限定する。
- ユーザー文言、error message、task titleをkeywordまたは正規表現で分類しない。
- Mission Pilotが稼働中でも、ユーザーのQuestionnaire回答、Artifact選択、停止操作を無効化しない。

### 2.3 Plan Mode

- 正本は`api/modules/planMode`が所有する。
- `api/modules/planMode/**`と`src/modules/planMode/**`はMission Pilot packageをimportしない。
- Mission Pilot packageはPlan Mode route、service、repository、reader/writer portを所有しない。
- Mission PilotはPlan Mode状態をTask Operator resourceから読み、Task Operator actionを通じてだけ更新する。
- Questionnaire回答後のArtifact推薦、include/omit、必要・不要の理由、task-keyed routing、`plan_mode.routing_changed`は、人間回答とMission Pilot代理回答で同一処理を通る。

### 2.4 Host and package

- packageには`package.json`と専用`tsconfig.json`を置かない。
- packageはNightWorkersのprivate moduleを相対importしない。
- NightWorkers本体はpackageの明示exportだけをimportする。
- backendでは`api/composition/mission-pilot/**`、frontendでは`src/composition/mission-pilot/**`だけがhost contractとpackageを同時に知る。
- old pathからpackageへのcompatibility re-exportを残さない。
- package停止または初期化失敗を、Coding AgentまたはTask APIの停止理由にしない。
- production listener、timer、reconciliation loopをold pathとpackageで二重起動しない。
- packageはDrizzle、LibSQL client、DB schema、DB handleをimportしない。
- SQLite操作は、compositionが注入した固定operation allowlistの非HTTP capabilityだけを使う。
- capabilityは任意SQL、table名、DB transaction objectを入力として受け取らない。
- capability factoryをimportできるproduction codeは`api/composition/mission-pilot/mission-pilot-runtime-bindings.ts`だけとする。

## 3. Current-State Findings

### 3.1 Coding Agent劣化を起こしうる構造

基準コミットでは、Coding Agent moduleがMission Pilotを直接importしていなくても、Coding Agentへ至る上流のTask作成・Task表現・server startupがMission Pilotと結合している。

- `api/modules/nightworkers/nightworkers.task-creation.service.ts`の`createTaskWithMissionPilot`が、全Task作成時にMission Pilot sessionを同一transactionで作る。
- `api/modules/nightworkers/nightworkers.basic.service.ts`がMission Pilot sessionを持たないTaskを異常として扱う。
- core Task routeが`taskWithMissionPilotSchema`を返す。
- `shared/schemas/mission-planner.schema.ts`、`task-generation.schema.ts`、`quality.schema.ts`もMission Pilot付きTaskを要求する。
- `api/db/client.ts`がMission Pilot schemaを常時importし、core `db` schemaへ混ぜる。
- `api/server.ts`がMission Pilot startup reconciliationとQuestionnaire timerを直接起動する。
- frontendのcore realtime hookが`mission_pilot.updated`を直接処理し、Task cache内の`missionPilot`を更新する。

この構造では、Mission Pilotのsession作成、schema、startup、realtime、Task projectionのどれかが壊れると、Mission Pilotを使っていないCoding Agent起動まで影響を受ける。問題はCoding Agent内部ロジックではなく、Coding Agentの外側にあるcore application経路がMission Pilotを必須構成にしていることである。

したがって、再実装で直すべき場所はCoding Agentではない。Task正本、host composition、Mission Pilot package、Task projection、DB ownership、frontend cacheの依存方向を直す。

### 3.2 package化を妨げる現在の依存

Mission Pilot production codeは現在、少なくとも次の場所に分散している。

- `api/modules/missionPilot/**`
- `src/modules/missionPilot/**`
- `shared/modules/missionPilot/**`
- `api/db/mission-pilot-schema.ts`
- `api/db/mission-pilot-agent-schema.ts`
- `api/db/mission-pilot-schema-bootstrap.ts`
- `api/app.ts`
- `api/server.ts`
- core Task route/schema/service
- generic realtime broker内のrole名付き登録
- frontend core realtime hook
- SystemContext catalog/binding
- architecture scripts、ontology、fixtures、live tests

そのため、package化はfile moveだけでは完了しない。特に次の3点を先に解消する。

1. core TaskがMission Pilot sessionを必須とする状態。
2. packageがNightWorkers private moduleを直接importしないためのhost port。
3. core DB clientとpackage DB schemaの分離。

### 3.3 基準線で先に修正するtest fixture

`tests/nightworkers-workbench-routes/routes-workbench-04.test.ts`の
`starts the standalone Plan Mode Artifact while Mission Pilot is stopped`
は、Questionnaire choiceのfixtureを次の旧形式で返している。

```ts
options: ["API", "UI"]
```

現在の正本schemaは、少なくとも`label`と`recommended`を持つobject形式を要求する。このためstructured output repairが1回増え、testは2回のLLM callを期待しながら実際には3回となる。

Phase 0でfixtureを現行schemaへ合わせる。この変更はCoding Agent production codeの修正ではなく、基準線testのcharacterization修正である。ここを曖昧にしたままpackage実装へ進むと、既存のfixture不整合と新しい回帰を区別できない。

## 4. Target Dependency Model

依存方向は次の一方向に固定する。

```text
NightWorkers composition root
  ├── imports NightWorkers public application contracts
  ├── imports @nightworkers/mission-pilot explicit exports
  ├── constructs MissionPilotHostPorts
  └── acquires the private Mission Pilot persistence capability
          │
          ▼
@nightworkers/mission-pilot
  ├── owns Mission Pilot behavior, contracts, and UI
  ├── calls injected user-equivalent host ports
  ├── requests named persistence operations through the injected capability
  └── never imports NightWorkers private modules

NightWorkers core Mission Pilot persistence
  ├── owns the single Drizzle/libSQL path and transactions
  ├── exposes no HTTP route
  ├── accepts named semantic operations only
  └── is injected only by the Mission Pilot composition root

Coding Agent ──X──> Mission Pilot package
Plan Mode    ──X──> Mission Pilot package
Mission Pilot package ──X──> Coding Agent
Mission Pilot package ──X──> Plan Mode internals
```

packageからhostへのcallbackは、packageが定義するcapability interfaceをcomposition rootが実装する依存性注入とする。packageから`api/**`または`src/**`へのsource importは許可しない。

これはTask Operator contractの複製を意味しない。package側のportは、公開resource queryと公開action commandをtransportする薄いinterfaceだけを定義し、action payloadの正本検証、権限、revision、idempotency、実行はNightWorkersのTask Operatorが所有する。

## 5. Pure TypeScript Boundary Design

### 5.1 Root TypeScript resolution

root `package.json`へworkspace設定や`@nightworkers/mission-pilot` dependencyを追加しない。root `tsconfig.json`は`packages/mission-pilot/src/**/*`を検査対象に含め、次の完全一致aliasだけを公開surfaceとして解決する。

### 5.2 Public alias surface

- `@nightworkers/mission-pilot/contracts`
- `@nightworkers/mission-pilot/backend`
- `@nightworkers/mission-pilot/frontend`
- `@nightworkers/mission-pilot/testing`
- `@nightworkers/mission-pilot/frontend.css`

禁止事項:

- `packages/mission-pilot/package.json`と`packages/mission-pilot/tsconfig.json`。
- `"."`のbroad export。
- internal directoryのwildcard export。
- repository、DB schema、prompt、service classの個別export。
- package内部fileへのdeep import。
- `api/**`、`src/**`、`shared/**`へのrelative import。
- Coding Agent SDKまたはfilesystem/Git libraryのdependency追加。

### 5.3 Package layout

```text
packages/mission-pilot/
  AGENTS.md
  src/
    contracts/
      principal.ts
      provenance.ts
      session.ts
      realtime.ts
      host-ports.ts
      index.ts

    backend/
      application/
        mission-pilot-runtime.ts
        mission-pilot-session.service.ts
        mission-pilot-initial-prompt.service.ts
        mission-pilot-questionnaire.service.ts
        mission-pilot-task-operator.service.ts
        mission-pilot-continuation.service.ts
      domain/
        session-state.ts
        decision.ts
        conversation.ts
      persistence-port.ts
      routes/
        mission-pilot.routes.ts
      prompts/
      index.ts

    frontend/
      client/
      components/
      hooks/
      i18n/
      styles.css
      index.ts

    testing/
      fixtures/
      fakes/
      index.ts
```

`AGENTS.md`には、少なくとも次をpackage-local ruleとして置く。

- repository、filesystem、Git、shellへアクセスしない。
- Coding Agent、Plan Mode、NightWorkers repositoryをimportしない。
- user-equivalent Task Operator action以外の業務副作用を作らない。
- prompt文言は日本語を維持する。
- keyword/error text分類を作らない。
- structured principal/provenanceを必須にする。
- package外importはthird-party dependencyに限定する。

## 6. Explicit Package Exports

### 6.1 `@nightworkers/mission-pilot/contracts`

公開してよいもの:

- `MissionPilotPrincipal`
- `MissionPilotProvenance`
- `MissionPilotControlSummary`
- `MissionPilotRealtimeEvent`
- `MissionPilotHostPorts`
- `MissionPilotFrontendClient`
- public route request/response schema

公開しないもの:

- repository interface
- DB row type
- domain aggregate
- LLM prompt
- continuation decision内部型
- lifecycle state machine内部event

### 6.2 `@nightworkers/mission-pilot/backend`

公開APIは少数のfactoryに限定する。

```ts
export function createMissionPilotRouter(
  dependencies: MissionPilotBackendDependencies,
): Hono;

export async function bootstrapMissionPilotStorage(
  dependencies: MissionPilotStorageDependencies,
): Promise<void>;

export async function startMissionPilotRuntime(
  dependencies: MissionPilotRuntimeDependencies,
): Promise<{ stop(): Promise<void> }>;
```

`startMissionPilotRuntime`はlistener、reconciliation、due-action timerを一度だけ登録し、返した`stop`ですべて解除できるようにする。module import時のside effectは禁止する。

### 6.3 `@nightworkers/mission-pilot/frontend`

公開APIは、host内部型を知らない自己完結したcomponent、hook、client factory、realtime handlerに限定する。

```ts
export function createMissionPilotClient(...): MissionPilotFrontendClient;
export function createMissionPilotRealtimeHandler(...): RealtimeExtensionHandler;
export function MissionPilotControl(props: { taskId: string; client: MissionPilotFrontendClient }): JSX.Element;
export function MissionPilotTimelineCard(...): JSX.Element;
```

package componentは`NightWorkersShell`、`ThreadMessage`、workbench route state、core Task型をimportしない。hostから渡す値は`taskId`、表示slot、callback等の最小view contractにする。

## 7. Host Ports

`MissionPilotHostPorts`は、Mission Pilotが人間ユーザー相当の操作をするために必要な能力だけを表す。

```ts
interface MissionPilotHostPorts {
  taskOperator: {
    query(input: PublicResourceQuery): Promise<PublicResourceResult>;
    execute(input: PublicActionCommand): Promise<PublicActionResult>;
  };
  taskIntake: {
    submitUserMessage(input: UserTaskIntakeCommand): Promise<UserTaskIntakeResult>;
  };
  events: {
    subscribe(listener: PublicApplicationEventListener): Unsubscribe;
  };
  realtime: {
    publish(event: MissionPilotRealtimeEvent): Promise<void>;
  };
  systemContext: {
    resolve(input: SystemContextResolveInput): Promise<ResolvedSystemContext>;
  };
  structuredLlm: {
    generate(input: StatelessStructuredGenerationInput): Promise<StructuredGenerationResult>;
  };
  authorization: {
    assertTaskAction(input: TaskActionAuthorizationInput): Promise<void>;
  };
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}
```

port名が同じでも、Mission Pilot専用の裏口を実装してはならない。

- `taskOperator.query`はTask Operator公開resource queryへそのまま接続する。
- `taskOperator.execute`はTask Operator公開action commandへそのまま接続する。
- `taskIntake.submitUserMessage`は人間UIが初期Promptを送るものと同じTask intake commandへ接続する。
- `events.subscribe`はtyped public application eventだけを配信する。
- `structuredLlm.generate`はstateless provider callに限定する。
- `authorization`は人間ユーザーと同じtask access policyを使う。

禁止するport例:

- `inspectRepository`
- `readWorktree`
- `getGitHead`
- `startCodingAgentPlanMode`
- `updatePlanModeRoutingDirectly`
- `writeArtifactRepository`
- `forceQuestionnaireAnswer`
- `getMissionPilotOnlyTaskState`

## 8. Core Task Decoupling

### 8.1 Neutral Task

core Task responseから必須の`missionPilot` fieldを外す。TaskはMission Pilot sessionが存在しなくても正当である。

廃止対象:

- `taskWithMissionPilotSchema`
- `createTaskWithMissionPilot`
- Task作成時のMission Pilot session同時作成
- Mission Pilot session不在をTask異常とするassertion

置換後:

- 全Task作成元はAgent非依存の`createTask`だけを使用する。
- `mission-planner`、`taskGeneration`、`project-evaluation`、`quality`もneutral Taskを返す。
- core Task list/get/update responseはneutral Task schemaを返す。
- Mission Pilot control stateはpackage routeから別queryで取得する。

### 8.2 Lazy session creation

Mission Pilot sessionは、ユーザーがPlayを実行した時にpackageが固定operationを要求し、NightWorkers core repositoryがidempotentに作る。

```text
POST Mission Pilot Play
  -> human authorization
  -> read Task through public resource
  -> get existing session by taskId
  -> if absent, create exactly one session
  -> transition stopped/idle -> playing
  -> submit initial prompt only when lifecycle requires it
```

要件:

- Taskごとにactive sessionは最大1つ。
- 同時Playはunique constraintとidempotency keyで同じsessionへ収束する。
- 既存sessionは移行後も同じIDと履歴を保持する。
- Task作成transactionとMission Pilot session transactionを分離する。
- session作成失敗はPlayだけを失敗させ、Task、Coding Agent、Plan Modeを失敗させない。
- Stop中またはsession未作成でも、Coding Agent直結Runを許可する。

### 8.3 Atomic API/UI cutover

core Taskから`missionPilot`を外す変更と、frontendがpackage control queryを使う変更は同一checkpointで切り替える。旧Task fieldと新queryをproductionで長期間dual-readしない。

既存client compatibilityが必要なら、versioned responseを1releaseだけ用意するのではなく、同じrepository内の全callerを同一commitで更新する。外部公開互換性が確認された場合のみ、削除期限付きのadapterを別途承認する。

## 9. Persistence Ownership and Migration

### 9.1 NightWorkers-owned persistence capability

Mission Pilot schema、agent schema、bootstrap、repositoryは`api/modules/missionPilot/persistence`が所有する。`api/db/client.ts`の単一Drizzle instanceへschemaを統合し、Mission Pilot packageに別clientを作らない。

packageが利用できるのは`executeMissionPilotPersistence({ operation, args })`のin-process callbackだけである。operationはcompile-time listとcore handler mapの両方で固定し、任意SQL、table名、DB client、transactionを受け付けない。このcallbackはHTTP、OpenAPI、router、public backend indexへ公開しない。

Mission Pilot tableは現在のphysical table名とdataを維持する。境界移動を理由に破壊的renameやdata copyを行わない。

### 9.2 Cross-domain references

package内のTask、Run、Questionnaire、Artifact IDはopaque identifierとして扱う。packageはcore tableをjoinまたは直接readしない。整合性に必要なjoin/read/writeはNightWorkers persistence operationの内部だけで実行する。

物理foreign keyが既に存在する場合、bootstrap SQLで既存constraintを維持してよい。ただし、業務判断のためのcross-domain queryはTask Operator resourceを使う。

### 9.3 Leaked role-named core columns

core側に残っているrole名付きphysical columnは、Agent非依存名へ段階移行する。

| Current physical column | Current application meaning | Target physical column |
| --- | --- | --- |
| `implementation_queue_entries.mission_pilot_admission_key` | source command identity | `source_command_key` |
| `implementation_queue_entries.mission_pilot_agent_json` | request provenance | `request_provenance_json` |
| `design_questionnaire_sessions.mission_pilot_action_key` | command idempotency | `command_idempotency_key` |

migration手順:

1. 新columnをadditiveに追加する。
2. 旧columnからbackfillする。
3. nullability、index、unique条件を検証する。
4. application read/writeを同一checkpointで新columnへ切り替える。
5. migration期間中もsemantic dual-writeは行わない。
6. 旧column削除は別releaseのcleanupへ送る。

property名が既に中立なら、それを維持する。

### 9.4 Provenance migration

role非依存のtrace provenance migrationとMission Pilot table固有のbackfillはNightWorkers coreに置く。package bootstrapは存在しない。

historical Plan Mode migrationが旧Mission Pilot tableの存在確認を行う場合は、runtime dependencyではなく過去data救済として例外を明示する。新しいruntime read/writeをそのmigrationへ追加しない。

### 9.5 Failure isolation

起動順は次とする。

1. core DB bootstrapを完了する。
2. core HTTP appとCoding Agentに必要なserviceを構成する。
3. NightWorkers coreのMission Pilot storageを初期化する。
4. 成功した場合だけMission Pilot router/runtimeをavailableにする。
5. package初期化に失敗した場合はMission Pilot controlをunavailableとして記録し、core TaskとCoding Agentは起動を続ける。

Mission Pilot storage failureをprocess全体のfatal errorへ昇格させない。ただしmigration corruptionやdata lossを黙って無視せず、Mission Pilot endpointはtyped `503`を返し、operator logへ構造化errorを残す。

## 10. Backend Composition

backendの接続は`api/composition/mission-pilot/**`だけで行う。

推奨構成:

```text
api/composition/mission-pilot/
  mission-pilot-host-ports.ts
  mission-pilot-runtime-composition.ts
  mission-pilot-router-composition.ts
  index.ts
```

このdirectoryの責務:

- NightWorkers公開application command/eventをpackage portへadaptする。
- DB client、logger、clock、ID generatorを注入する。
- package routerをHono appへmountする。
- package runtimeをstart/stopする。
- runtime unavailable状態をcoreから隔離する。

このdirectoryに置いてはいけないもの:

- Mission Pilotの意味判断。
- questionnaire選択。
- artifact routing判断。
- continuation判断。
- DB query。
- Coding Agent direct call。
- user/error keyword分岐。

`api/app.ts`と`api/server.ts`はcomposition entryを呼ぶだけに縮小し、Mission Pilot service、repository、timer関数を直接importしない。

## 11. Mission Pilot Runtime Flow

### 11.1 Play and initial prompt

Playは人間ユーザー操作であり、task authorizationを先に検証する。

初期Promptは、人間ユーザーがTaskへmessageを送るものと同じTask intake commandへ送る。Mission Pilot用Coding Agent start APIや専用handoff APIは作らない。

```text
User clicks Play
  -> package session becomes playing
  -> package submits the initial prompt through Task intake
  -> Coding Agent receives normal user intake
  -> Coding Agent owns Plan Mode gate/questionnaire generation
  -> Mission Pilot waits for a typed request for the next user operation
```

Mission Pilotは、初期Prompt送信直後にPlan Modeを直接起動しない。Coding AgentがPlan Modeに入ったかをfilesystem、run内部状態、error textから推測しない。

### 11.2 Waiting

Mission Pilotの標準状態は「次のユーザー操作要求を待つ」である。pollingでprivate repositoryを読むのではなく、typed public application eventをconsumeし、必要時にTask Operator resourceを再読する。

UIへ少なくとも次を区別して表示する。

- `waiting_for_coding_agent`
- `waiting_for_questionnaire`
- `waiting_for_user_override`
- `generating_artifacts`
- `waiting_for_run`
- `evaluating_outcome`
- `stopped`
- `unavailable`

長いLLM応答待ちを停止と誤認しないよう、last activityと次のeligible timeを表示する。過去の実providerではQuestionnaire応答に100秒超を要した例があるため、live canaryは短い固定timeoutで失敗扱いにしない。

### 11.3 Questionnaire

Questionnaireの質問、選択肢、Recommendedは、UIが読むものと同じTask Operator questionnaire resourceから取得する。

20秒の代理回答待機は、Questionnaireが構造的に`answering`となったeventを受けた時点から開始する。Task作成、Play、LLM generation開始から数えない。

```text
questionnaire status becomes answering
  -> save delayed user-operation event with eligibleAt = eventAt + 20 seconds
  -> show user that Mission Pilot will answer after eligibleAt
  -> if human submits first, mark delayed event superseded
  -> at eligibleAt, re-read the same questionnaire resource
  -> if still answerable, select from its current choices/recommendation
  -> execute the same questionnaire.submit action used by UI
```

必須precondition:

- task ID
- questionnaire ID
- questionnaire revision
- current status
- principal
- delegated-user provenance
- idempotency key
- consumed delayed event ID

20秒中に人間が回答した場合、人間回答が勝つ。timer callbackは再読後にno-opとする。raceで同時submitになってもserver側revision/idempotency検査で一方だけが成立する。

Mission Pilot専用draft submitやrepository writeを追加しない。

### 11.4 Artifact routing and generation

`questionnaire.submit`後は、人間回答と同じPlan Mode application処理がArtifact推薦を作る。

Mission PilotはTask Operatorからrouting/resourceを読み、公開actionを実行する。

現行actionを維持する場合:

- `plan.routing.update`
- `plan.artifact.feature_plan.generate`
- `plan.artifact.blueprint.generate`
- `plan.artifact.data_model.generate`
- `plan.artifact.view.generate`

複数Artifactの一括生成が必要なら、Mission Pilot専用actionではなくUIも利用できるAgent非依存actionとして設計・追加する。追加が不要なら現行type-specific actionを順番に使う。

include/omitと理由はtask-keyed routingへ保存し、`plan_mode.routing_changed`でUIへ通知する。Mission Pilotのlocal sessionだけへ保存しない。

Mission Pilot稼働中でもUIのArtifact selectionをdisabledにしない。ユーザー変更とMission Pilot actionが競合した場合はrouting revisionで検出し、最新resourceを再読してLLMに次actionを判断させる。

### 11.5 Implementation start

Artifact準備後の実装開始は、Task Operatorの`run.implementation.start`を使う。Coding Agent route/service/repositoryを直接呼ばない。

Mission Pilot handoffのprovenanceはRunへ構造的に保存するが、Coding Agentのruntime起動条件にはしない。ユーザー直結Runは同じCoding Agent runtimeへMission Pilotなしで入れる。

### 11.6 Stop, continuation, and completion

Coding Agentが停止または中断した場合、Mission Pilotは次の公開resourceを読む。

- current Todo
- run outcome
- task timeline/messages
- artifact index
- queue state

Goal未達で、追加のユーザー情報なしに継続可能とLLMが判断した場合だけ、公開actionからcontinueする。

- current Todoを再開できる場合: `run.todo.resume`
- 新しい実装Runが必要な場合: `run.implementation.start`

error messageの単語、exit code一覧、Task文言でcontinueを決めない。hostはrevision、権限、idempotency、terminal state等の構造的不変条件だけを強制する。

Task完了判断もLLMがTask goal、完了条件、run outcome、verificationを読んで行う。通信障害以外でLLM本文を固定文へ差し替えない。

## 12. Principal and Provenance

人間操作とMission Pilot代理操作は、同じapplication commandを使う。違いは次の構造だけに限定する。

```ts
type ActionPrincipal =
  | {
      kind: "human_user";
      userId: string;
    }
  | {
      kind: "delegated_user";
      userId: string;
      delegate: "mission_pilot";
      sessionId: string;
    };
```

provenanceには少なくとも次を保存する。

- invoking principal kind
- human user ID
- delegate role
- Mission Pilot session ID
- source Task ID
- source event/action ID
- idempotency key
- occurredAt

provenanceをmessage text、hidden prefix、error stringへ埋めて判定しない。

delegated principalの権限はhuman userの権限の部分集合とし、次を行わない。

- owner権限への昇格
- unauthorized projectへのアクセス
- userが実行できないactionの実行
- user confirmationを必要とする副作用の迂回

## 13. Realtime Separation

backend realtime brokerはrole固有payloadを解釈しない。replayable event registrationが必要なら、generic registrationまたはcomposition contributionとして受け取る。

frontendではcore `useNightWorkersRealtime`からMission Pilot importとTask cache mutationを外す。

```text
core realtime transport
  -> core handlers update core query cache
  -> extension handlers receive validated envelope
       -> Mission Pilot package handler validates mission_pilot.updated
       -> package handler updates Mission Pilot query cache
```

Mission Pilot control summaryはpackage query cacheが所有する。core Task cacheへ`missionPilot`を埋め戻さない。

event payloadを全面的な`unknown`へ弱めず、boundaryでpackage contract schemaにより検証する。unknown event typeはcore transportが安全に無視し、既知typeのinvalid payloadは構造化logへ出す。

## 14. Frontend Composition

frontend接続は`src/composition/mission-pilot/**`に限定する。

このcompositionは次を行う。

- package clientへ既存API transportとauth contextを注入する。
- package realtime handlerをcore realtime transportへ登録する。
- Task IDをpackage control componentへ渡す。
- shell/timelineの明示slotへpackage componentを配置する。
- package i18n dictionaryとCSSをroot compositionで結合する。

package側はNightWorkers internal componentをimportしない。見た目の統一が必要なら、CSS custom properties、primitive props、neutral UI tokenを利用する。

Mission PilotがunavailableでもTask画面、Plan Mode UI、Coding Agent操作は表示・操作できる。Mission Pilot controlだけがunavailable表示になる。

## 15. SystemContext and LLM Provider

SystemContext TOML、生成catalog、bindingは`api/systemContexts`に残す。これは既存AGENTSルールの明示例外であり、packageへ移動しない。

packageはSystemContext fileまたはcatalog内部実装をimportせず、host portでbindingをresolveする。

Mission Pilot安定化を理由にstructured LLM providerの共有実装を拡張しない。最初の実装ではprovider turnをstatelessに保ち、Mission Pilotの継続性はcore-owned conversation store、採用済み判断、未解決事項、実行済みaction、compaction digestで維持する。

provider retryは明示的retryableな一時障害だけに限定し、回数上限と停止手段を持つ。schema parse失敗時もprovider本文を保存する。

## 16. Architecture Enforcement

package移動と同時に、説明文ではなく検査で境界を固定する。

### 16.1 Root and ontology rules

更新対象:

- root `AGENTS.md`
- `.agent-ontology/boundary-policy.json`
- `.agent-ontology/modules/mission-pilot.yaml`
- `.agent-ontology/modules/plan-mode.yaml`
- module boundary scripts
- Coding Agent standalone boundary script
- Task Operator boundary script

root `AGENTS.md`のAgent固有production locationは次へ更新する。

- Coding Agentは現状の`api/modules/codingAgent`、`src/modules/codingAgent`、対応shared path。
- Mission Pilotは`packages/mission-pilot`。
- role固有SystemContextだけは`api/systemContexts`。
- compositionだけは指定されたroot composition path。

P1時点ではold Mission Pilot production pathがまだ存在するため、これらを恒久的な許可pathとして扱わない。既存file一覧をshrink-only migration ledgerとして固定し、新規file、新規role機能、file数増加を禁止する。P5でbackend/shared ledgerを0件、P6でfrontend ledgerを0件にし、その同じcheckpointでmigration例外を削除する。

### 16.2 Required static rules

1. `api/modules/codingAgent/**`、`src/modules/codingAgent/**`、`shared/modules/codingAgent/**`からpackage importを禁止する。
2. `api/modules/planMode/**`、`src/modules/planMode/**`からpackage importを禁止する。
3. packageから`api/**`、`src/**`、`shared/**`へのsource importを禁止する。
4. packageからCoding Agent、Plan Mode、NightWorkers repository、core DB schemaへのimportを禁止する。
5. package内のfilesystem、Git、shell、process execution library importを禁止する。
6. package deep importを禁止する。
7. old Mission Pilot pathsからのre-exportを禁止する。
8. Task Operator moduleからpackage importを禁止する。
9. Coding Agent standalone entrypointのtransitive graphにpackageとMission Pilot DB schemaがないことを検査する。
10. rootで`missionPilot` identifierを許す場所を、composition、SystemContext、historical migration、package integration testへ限定する。
11. architecture scan対象へ`packages/**`を含める。
12. dynamic import、type-only import、re-exportも同じ規則で検査する。

### 16.3 Exact composition allowlist

最終状態でNightWorkers本体からpackageをimportできるproduction pathは、原則として次だけとする。

- `api/composition/mission-pilot/**`
- `src/composition/mission-pilot/**`
- root app/serverのcomposition entry
- root CSS/i18n composition entry

business service、Task route、Plan Mode、Coding Agent、Task Operator repositoryからのimportは許可しない。

## 17. Implementation Checkpoints

各checkpointは独立commitとし、後続checkpointと混ぜずにrevert可能にする。各checkpoint終了時にrequired verificationを実行し、失敗した状態で次へ進まない。

### P0: Baseline characterization

目的:

- 基準コミットの動作と既知fixture不整合を分離する。
- Coding Agent standaloneの基準を固定する。

変更:

- `routes-workbench-04.test.ts`のQuestionnaire choice fixtureを現行object schemaへ修正する。
- direct Coding Agent normal start testを維持する。
- direct Coding Agent Plan Mode testを正常化する。
- Mission Pilot sessionがなくてもCoding Agentが開始できるcharacterization testを追加する。production codeは変更しない。

終了条件:

- normal startがMission Pilot envelopeなしで成功する。
- Plan Mode gate/questionnaire pathがMission Pilotなしで成功する。
- 不要なstructured-output repair callが発生しない。
- Coding Agent production diffが空。

### P1: Pure TypeScript scaffold and guardrails

目的:

- behaviorを変えずにpackage境界と違反検査を先に作る。

変更:

- root TypeScript alias設定。workspace設定と独自manifestは追加しない。
- empty source-boundary scaffold、explicit public indexes、package-local `AGENTS.md`。
- root `AGENTS.md`とontologyへ最終配置ルール、および期限付きshrink-only migration ledgerを追加する。
- architecture scriptsを`packages/**`対応にする。
- packageからroot private sourceへのimport禁止。
- Coding Agent/Plan Modeからpackageへのimport禁止。

終了条件:

- packageは空のfactory/contractだけでtypecheckできる。
- old pathのfile数とexport surfaceがbaselineから増えていない。
- runtime listener、route、DBはまだ切り替えない。
- existing behavior testは不変。

### P2: Host port seam and dependency inversion

目的:

- 現在のMission Pilotが直接参照するhost capabilityを棚卸しし、package public portへ収束させる。

変更:

- Task Operator query/action、Task intake、typed event、realtime、SystemContext、structured LLM、authorization、clock、ID、loggerのportを定義する。
- `api/composition/mission-pilot`へadapterを作る。
- Mission Pilotの意味判断をadapterへ移さず、adapterを単純pass-throughに保つcontract testを追加する。
- direct Coding Agent/Plan Mode importなしでhost port fakeを使えるpackage test harnessを作る。

終了条件:

- port一覧にfilesystem、Git、repository、Coding Agent direct start、Plan Mode writerがない。
- package contractがNightWorkers private typeをexportしない。
- composition以外にhost/package両方をimportするfileがない。

### P3: Neutral Task projection and lazy session

目的:

- core TaskとMission Pilot sessionの必須結合を切る。

変更はatomic cutoverとして行う:

- neutral Task schemaへ切り替える。
- `taskWithMissionPilotSchema`利用を除去する。
- `createTaskWithMissionPilot`をAgent非依存`createTask`へ置換する。
- Task作成時session作成を廃止する。
- Mission Pilot summary queryを独立させる。
- frontendはTask fieldではなくsummary queryを読む。
- Playでidempotentにsessionをlazy createする。
- core realtime Task cacheからMission Pilot mutationを外す。

終了条件:

- Mission Pilot tableが空または存在しなくてもTask CRUDが成功する。
- Coding Agent standalone normal/Plan Modeが成功する。
- Playでだけsessionが1件作られる。
- concurrent Playで重複sessionが作られない。
- existing sessionが再利用される。
- UIでMission Pilot unavailableでもTask/Coding Agent操作が有効。

### P4: Core persistence capability extraction

目的:

- Mission PilotのDB ownershipをNightWorkers coreのrole moduleへ集約し、packageのDB直参照をなくす。

変更:

- schema、agent schema、bootstrap、repositoryを`api/modules/missionPilot/persistence`へ移動する。
- coreの単一Drizzle/libSQL pathへschemaを統合する。
- packageへ固定operation allowlistの非HTTP capabilityを注入する。
- packageの`drizzle-orm`、`@libsql/client`、DB client/schema importを0件にする。
- Mission Pilot固有provenance backfillをcore bootstrapへ移す。
- role名付きcore physical columnsへ中立column migrationを追加する。
- existing data preservation testを追加する。

終了条件:

- core bootstrapが既存table/dataをそのまま認識する。
- packageがDB client/schemaをimportせず、core tableを直接join/read/writeしない。
- capabilityが任意SQLと未知operationを拒否する。
- capability factoryをcomposition以外のproduction codeが取得できない。
- migration前後でsession、conversation、event、idempotency dataが一致する。
- Mission Pilot storage bootstrap failure時もcore server/Coding Agentが利用可能。

### P5: Backend package cutover

目的:

- Mission Pilot backend/contractsをpackageへ移し、old backend pathをなくす。

変更:

- `api/modules/missionPilot/**`をpackage backendへ移す。
- `shared/modules/missionPilot/**`のrole固有contractをpackage contractsへ移す。
- package backendをhost portsだけで動かす。
- router/runtime/storageをexplicit factoryからcompositionする。
- `api/app.ts`と`api/server.ts`のdirect service import、timer、reconciliationをcompositionへ置換する。
- old backend/shared directoryとcompatibility re-exportを削除する。

cutover rule:

- old/new listenerを同時起動しない。
- old/new timerを同時起動しない。
- old/new persistence writeをdual-writeしない。
- package start成功を確認した同じcommitでold production registrationを削除する。

終了条件:

- old backend/shared pathが存在しない。
- packageにroot private source importがない。
- package runtimeをstart/stop/restartできる。
- restart後にpending questionnaire、session、idempotencyが復元される。
- package unavailableでもcore/Coding Agentが起動する。

### P6: Frontend package cutover

目的:

- Mission Pilot UIとrealtime stateをpackageへ移す。

変更:

- `src/modules/missionPilot/**`をpackage frontendへ移す。
- package client、components、hooks、i18n、CSSをexplicit exportする。
- `src/composition/mission-pilot`でshell slotとrealtime extensionへ接続する。
- core Task cacheからMission Pilot fieldを完全除去する。
- old frontend pathとcompatibility re-exportを削除する。

終了条件:

- package frontendがNightWorkers private component/typeをimportしない。
- realtime eventでpackage query cacheだけが更新される。
- Play/Stop/status/timelineが既存UIと同等に動く。
- waiting、answering delay、generating、unavailableが区別される。
- Mission Pilot稼働中もArtifact UIが操作可能。

### P7: User-equivalent runtime stabilization

目的:

- package移動後のruntimeを、現在確立された人間ユーザー同等flowへ限定する。

変更:

- initial promptを同じTask intakeへ送る。
- Coding Agentからのtyped next-user-operation eventを待つ。
- Questionnaire `answering`から20秒delayを開始する。
- human preemptionとrevision/idempotency raceを実装する。
- 同じ`questionnaire.submit`を使う。
- routing/ArtifactをTask Operator resource/actionだけで操作する。
- implementation/continueを公開actionだけで行う。
- LLM completion judgmentとconversation compactionを安定化する。

終了条件:

- packageにCoding Agent/Plan Mode direct importがない。
- private repository writeがない。
- user actionとdelegated actionがprincipal/provenance以外で分岐しない。
- error/task text keyword判定がない。
- 人間回答とMission Pilot回答が同じArtifact推薦処理へ入る。
- routing changed eventがUIへ反映される。

### P8: Residue removal and canary

目的:

- transitional residueを削除し、real providerとregistered repositoryで完了を確認する。

変更:

- old path、old schema、old query shape、temporary adaptersを削除する。
- architecture marker allowlistを最終状態へ絞る。
- testsをpackage unit、host integration、root E2Eへ整理する。
- live testの一時directoryを実workspaceとして扱うfixtureを廃止する。
- registered Projectのreal canary repo rootをworker経由で使う。

終了条件:

- old Mission Pilot production pathが0件。
- Coding Agent/Plan Modeのpackage transitive dependencyが0件。
- full verificationが成功。
- direct Coding Agent normal/Plan Mode canaryがMission Pilot停止・未作成で成功。
- Mission Pilot canaryがQuestionnaire、Artifact、implementation、continue、completionまで成功。

## 18. Verification Matrix

### 18.1 Every checkpoint

必ず次を実行する。

```sh
git diff -- api/modules/codingAgent src/modules/codingAgent shared/modules/codingAgent
bun run typecheck
bun run check:architecture
bun run check:docs
```

1行目に差分が出た場合、そのcheckpointを失敗とする。

さらに、そのcheckpointに関係するfocused unit/component/integration testを実行する。

### 18.2 Coding Agent independence tests

- Mission Pilot session未作成でnormal Coding Agentを開始できる。
- Mission Pilot停止中にnormal Coding Agentを開始できる。
- Mission Pilot storage bootstrap失敗中にnormal Coding Agentを開始できる。
- Mission Pilot session未作成でCoding Agent Plan Modeに入れる。
- Mission Pilot停止中にCoding Agent Plan Modeに入れる。
- package runtime restart中にCoding Agent direct Runが継続する。
- Coding Agent standalone entrypointのmodule graphにpackageがない。

### 18.3 Task and session tests

- Task create/list/get/updateがMission Pilotなしで成功する。
- Task creationがMission Pilot tableへwriteしない。
- first Playでsessionが作られる。
- repeated/concurrent Playが同じsessionへ収束する。
- existing session historyを再利用する。
- Stop後のPlayが正しいrevisionで再開する。
- unauthorized userのPlay/Stopを拒否する。

### 18.4 Questionnaire tests

- initial promptがhuman Task intakeと同じcommandへ入る。
- `answering`前には20秒timerが始まらない。
- 19.999秒ではsubmitしない。
- 20秒後に同じQuestionnaire resourceを再読する。
- humanが先に回答するとMission Pilotはsubmitしない。
- 同時raceはrevision/idempotencyで一方だけ成功する。
- Mission Pilot submitがUIと同じ`questionnaire.submit`を通る。
- Recommendedとchoiceをresource正本から読む。
- restart後もdue eventを一度だけ処理する。

### 18.5 Artifact and realtime tests

- human回答とdelegated回答で同じinclude/omit推薦になる。
- 必要・不要の理由がtask-keyed routingへ保存される。
- `plan_mode.routing_changed`が同じpayload contractで配信される。
- frontend package cacheが更新される。
- core Task cacheへMission Pilot fieldを追加しない。
- Mission Pilot稼働中もuser Artifact actionが成功する。
- stale routing revisionは再読とLLM再判断へ進む。

### 18.6 Implementation and continuation tests

- implementation startが`run.implementation.start`を通る。
- Coding Agent direct serviceを呼ばない。
- stopped/incomplete/no-new-inputでcontinue actionを選べる。
- user input待ちでは勝手にcontinueしない。
- complete outcomeを重複startしない。
- restart後もaction idempotencyを維持する。
- error stringを変更しても構造的に同じ判断になる。

### 18.7 Persistence tests

- existing schemaからcore Mission Pilot bootstrapできる。
- existing session/conversation/event dataを保持する。
- core bootstrapが既存Mission Pilot dataを破壊せず再実行できる。
- role-neutral column migrationがbackfillを保つ。
- application cutover後に旧columnへwriteしない。
- Mission Pilot storage failureがcore Task transactionをrollbackしない。
- package経由の全SQLite操作が単一core DB pathを使う。
- 任意SQLと未知operationがpersistence capabilityで拒否される。

### 18.8 E2E and live canary

root E2E:

- Mission PilotなしのTask作成からCoding Agent normal start。
- Mission PilotなしのTask作成からCoding Agent Plan Mode start。
- Playからlazy session、Questionnaire delay、Artifact、implementation。
- human override。
- browser reloadとserver restart。

live:

- real providerを使う。
- registered Projectのreal repository rootを使う。
- repository作業はCoding Agent worker経由だけで行う。
- `/tmp`や一時directoryへの編集を完了証拠にしない。
- long questionnaire latencyを許容し、activity heartbeatを観測する。

## 19. Rollback Strategy

rollbackはcheckpoint単位で行う。production中にold/new runtimeを並走させるfeature flagは作らない。

- P0/P1/P2はbehaviorを変えないため、commit revertで戻せる。
- P3のTask projection cutoverはAPI/UIを同一commitで戻す。
- P4のadditive DB columnはrevert時もdata保全のため残してよい。application read/writeだけ旧状態へ戻す。
- P5/P6はold path削除とnew registrationを同一commitで扱い、片側だけ戻さない。
- P7はpublic action contractを変えずpackage runtimeだけのrevertで戻せるようにする。
- migrationで旧columnを削除しないため、package cutover完了まではdown migrationを不要にする。

rollback後もCoding Agent independence testを最初に実行する。

## 20. Change Scope Ledger

### Must change

- root TypeScript alias/package resolution
- root and package `AGENTS.md`
- architecture/ontology checks
- Mission Pilot backend/frontend/shared production paths
- Mission Pilot DB ownership
- Mission Pilot host composition
- neutral Task projection
- lazy Mission Pilot session
- realtime extension composition
- related tests and fixtures

### May change

- `api/modules/nightworkers/**`のTask neutralization
- `shared/schemas/**`のTask shape neutralization
- `api/db/**`のschema separationとadditive migration
- `api/app.ts`、`api/server.ts`のcomposition
- root frontend shell/realtime/CSS/i18n composition
- `api/systemContexts`のpackage binding接続

### Must not change

- `api/modules/codingAgent/**`
- `src/modules/codingAgent/**`
- `shared/modules/codingAgent/**`
- Coding Agent runtime behavior
- Coding Agent Plan Mode ownership
- Plan Mode正本のownership
- user-facing action semantics
- Task OperatorをMission Pilot専用APIへ置き換えること

## 21. Definition of Done

次をすべて満たした時だけ完了とする。

1. Mission Pilot behavior/contracts/UIが`packages/mission-pilot`へ、SQLite persistenceが`api/modules/missionPilot/persistence`へ集約されている。
2. old backend/frontend/shared Mission Pilot pathとcompatibility re-exportがない。
3. NightWorkers本体はcomposition root以外からpackageをimportしない。
4. packageはNightWorkers private sourceをimportしない。
5. Coding AgentとPlan Modeからpackageへのdirect/transitive dependencyがない。
5a. `packages/mission-pilot/package.json`と専用`tsconfig.json`が存在しない。
5b. package内の`drizzle-orm`、`@libsql/client`、DB client/schema importが0件である。
5c. persistence capabilityは非HTTPで、任意SQLを受け付けず、compositionからpackageへだけ注入される。
6. Mission Pilot sessionなしでTaskとCoding Agentが正常動作する。
7. Mission Pilot packageがunavailableでもCoding Agent normal/Plan Modeが動く。
8. Mission Pilotはfilesystem、Git、repository、Coding Agent内部を確認しない。
9. initial promptがhuman Task intakeと同じ経路を通る。
10. Coding AgentがPlan Mode gateとquestionnaire生成を所有する。
11. Mission Pilotは次のuser operation requestまで待つ。
12. Questionnaireは同じresource、20秒delay、同じsubmit actionを使う。
13. human overrideが常に可能である。
14. human/delegated回答が同じArtifact推薦とrouting処理を通る。
15. Artifact include/omitと理由がtask-keyed Plan Mode routingへ保存される。
16. routing realtime eventがPlan Mode UIへ反映される。
17. Mission Pilot稼働中もArtifact UIが有効である。
18. implementationとcontinueがTask Operator公開actionを通る。
19. principal/provenance以外のuser/Mission Pilot意味分岐がない。
20. task/error keywordまたは正規表現による意味判定がない。
21. required static checks、focused tests、E2E、live canaryが成功する。
22. Coding Agent production diffが全checkpointで空である。

## 22. First Implementation Action

実装開始時はP0だけを行う。package file moveやTask shape変更を同時に始めない。

最初のcommitは、基準線test fixtureの現行schema化とCoding Agent standalone characterizationだけに限定する。これがgreenになった後、P1でworkspaceと境界検査を作る。

この順序により、以後の失敗を次の3種類へ分離できる。

- 基準線fixtureの不整合。
- package境界またはcompositionの回帰。
- Mission Pilot runtime behaviorの回帰。

Coding Agentの動作を直すためにCoding Agentを編集するのではなく、Coding Agentを巻き込んでいる外側のMission Pilot必須依存を除去することが、この計画の中心方針である。
