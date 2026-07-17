# Mission Pilot UI Operator Projection Refactor Implementation Plan

## Status

- Concept status: `locked`
- Plan status: `implemented`
- Implementation status: `complete` (Phase 0-8 cutover and verification complete)
- Document created: 2026-07-17
- Last updated: 2026-07-17 (Phase 0-8 implementation and acceptance verification completed)
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Baseline HEAD: `f21999f7` plus the pre-existing tracked and untracked working-tree changes present when implementation starts
- Working-tree policy: preserve all pre-existing changes and do not fold unrelated edits into this refactor
- Priority: this document supersedes every older plan statement that gives Mission Pilot semantic control over Coding Agent runtime behavior, requires Coding Agent to wait for Mission Pilot, reserves ordinary UI operations to a human solely because the requester is Mission Pilot, or treats raw DB records as provider context
- Related plans:
  - `spec/docs/mission-pilot-coding-agent-module-separation-plan.md`
  - `spec/docs/mission-pilot-autonomous-agent-hardening-plan.md`
  - `spec/docs/mission-pilot-persistent-agent-refactor-plan.md`
  - `spec/docs/coding-agent-llm-owned-todo-refactor-plan.md`

この文書を、Mission Pilotを「ユーザーのUI操作を代行するAI」として再構築し、Coding Agentとの境界、UIとの操作同値性、DB正本とLLM入力の分離、token消費の上限を同時に確立するための実装正本とする。

完成条件は次の一文に集約する。

> 人間ユーザーとMission Pilotは、同じTask Operator Viewを読み、同じapplication commandをそれぞれUI adapterとtool adapterから実行する。DBの完全な履歴は正本として保持するが、Mission Pilotのprovider入力には厳密に型付けされた最小projection、参照、digest、差分だけを渡す。Coding Agentは依頼元を意味上のmodeとして認識せず、Mission Pilotの起動、停止、handoff、返答を待たずに単体で完結する。

### Implementation result

- strict `TaskOperatorProjectionV1`、paged detail query、canonical command facadeを実装し、UI routeとMission Pilot tool adapterを同じhandlerへ接続した。
- Coding Agent start/resumeを`agentsShare`のrequester-neutral portへ統一し、request provenanceをaudit associationだけへ保存した。
- Mission Pilot provider tool surfaceを7個のgeneric toolへ縮小し、conversation、tool result、compaction、current-step envelopeをboundedにした。
- 疑似initial prompt、legacy production activation、Mission Pilot停止とCoding Agent lifecycleの結合、意味別Test/Review start actionを削除した。
- additive migrationはmissing agent rowを停止状態へ移行し、Coding Agent Run、Task history、Artifact、Questionnaire、usage rowを破壊しない。
- rollbackはapplicationを切替前versionへ戻し、必要なら移行前DB backupを復元する。migrationはcolumn/dropや履歴削除を行わないため、通常は新規agent rowを保持したまま旧versionへ戻せる。自動Playやprovider callはmigration中に発生しない。

## 1. Problem Statement

### 1.1 現在の構造上の問題

現行実装にはMission Pilot用のread tool、action registry、authorization、revision、idempotency、event inboxがあり、永続Agentの基礎は存在する。しかし、次の境界違反が残っている。

1. `MissionPilotTaskReadModel`がUIの正本queryを共有せず、Mission Pilot adapterがTask、Message、Queue、Run等のDB rowから独自に再構成されている。
2. Questionnaire、Queue、Run、repository等の重要fieldに`unknown`やraw objectが入り、不要なcolumn、履歴、metadataのprovider入力への混入を構造的に防げない。
3. Artifact revisionを配列順から生成する等、正本に存在しない派生値がMission Pilot viewへ混入する。
4. `availableActions`がTask、Run、Queue、Questionnaire、Todoの実際のpreconditionを投影せず、authorizationとMission Pilot runtime stateを中心に静的生成される。
5. UIが呼ぶapplication commandとMission Pilot toolが呼ぶserviceまたはruntime entryが一致しない操作がある。
6. Mission PilotがCoding Agent Runを内部`startTaskRun`から直接開始し、`codingAgentInvocationSource`、`missionPilotAgent`、Mission Pilot専用runtime optionを注入する。
7. Coding Agent System Contextが`user`と`mission_pilot`で分岐し、Mission Pilotへの返却、判断待ち、handoff正本化を指示する。
8. Implementation QueueとRun associationがMission Pilotの現在の`playing`状態をCoding Agent開始条件として扱う。
9. UIに存在する`needs_human` Todoのresume操作がMission Pilot action catalogにない。
10. `questionnaire.submit`がMission Pilotというroleを理由に静的禁止されている。
11. Task完了がMission Pilot-owned Runに限定され、ユーザー操作と意味が異なる。
12. Play時に既存のユーザー可視timelineを読む代わりに、疑似的な`mission_pilot_initial_prompt` user messageを作る。
13. 新旧sessionで`agent`と`legacy`の二経路が残り、すべてのMission Pilotがread toolとaction toolだけで動く保証がない。
14. providerへ渡すtool schema、過去conversation、tool result、terminal Run群が増え続け、DB履歴量に比例してinput tokenが増える余地がある。
15. Agent非依存のTask、Run、Queue、Questionnaire、Artifact、Review、Git操作が`nightworkers`等の広いserviceへ混在し、正本domain、application facade、compatibility adapterの境界が判別しにくい。

### 1.2 根本原因

次の三つが分離されていない。

- 永続化の正本: 復旧、監査、再投影に必要な完全なDB state。
- ユーザー操作の正本: UIとautomationが共有するquery、command、precondition。
- LLM context: 現在の判断に必要な最小情報だけを含むbounded projection。

DBが正本であることは、DB rowや履歴全体をproviderへ渡すことを意味しない。provider入力は必ず専用projectorを通し、正本への再取得可能性を参照、revision、digest、pagingで維持する。

## 2. Non-Negotiable Product Contract

### 2.1 Mission Pilotの位置づけ

Mission PilotはユーザーのUI操作を自動化するactorである。

- 人間ユーザーはUIに表示されたFactを読み、ボタン、フォーム、Composer等からapplication commandを実行する。
- Mission PilotはDOMや画面を見ない。UIと同じ正本から生成されたJSON viewまたは用途別の専用viewをread toolで読み、tool adapterから同じapplication commandを実行する。
- Mission Pilotに人間ユーザーを超えるTask、Run、Queue、Artifact、Git権限を与えない。
- Mission Pilotというroleだけを理由に通常のUI操作を禁止または特別扱いしない。
- 本当に明示確認が必要な操作は、actor種別ではなくcommand policyとauthorization grantで`confirmation_required`にする。
- Mission Pilot固有のsession、lease、conversation、tool receipt、event inbox、wait、finishはAgent runtime内部状態として保持できる。
- Mission Pilotからユーザーへ質問や報告を表示するpresentation actionは許可するが、Task domain mutationの裏口として使わない。

### 2.2 Coding Agentの独立性

Coding AgentはMission Pilotを知らない。

- Coding Agent production code、System Context、tool contract、Todo Context、completion ruleに`mission_pilot`、Mission Pilot handoff、Mission Pilotへの返却先を含めない。
- 人間ユーザーとMission Pilotは同じ`StartCodingAgentRun` application commandを呼ぶ。
- requester provenanceは監査と外側のevent associationにだけ保存し、Coding Agentのprompt、tool、Todo、status、continuation、完了判断を変えない。
- Coding AgentはTask、依頼本文、確定済み参照、repository Factを読み、Todo作成、調査、実装、検証、完了報告または`needs_human`まで単体で進める。
- 調査、実装、検証、review、reworkは同じCoding Agent runtimeへ通常の依頼として渡す。`StartVerification`、`StartReview`等の意味別Coding Agent開始commandを新設または維持しない。
- Coding Agentの開始、継続、resume、closeoutはMission Pilot sessionの存在、`playing`状態、phase、context revisionに依存しない。
- Mission Pilot停止後も、受理済みCoding Agent Runは継続する。停止対象はユーザーまたは許可されたactorが明示的にRun Stop commandを実行したRunだけである。
- Coding Agentのterminal eventはrole非依存にpublishする。Mission Pilotは必要なら外側から購読するが、Coding Agentは購読者を知らない。

### 2.3 DB正本とprovider入力

- DBには完全な履歴と証跡を保持する。
- providerへraw DB row、`metadataJson`全体、`contextSnapshot`全体、conversation全履歴、worker transcript、stdout/stderr全文を渡さない。
- provider入力に入るJSONはversion付きstrict schemaで検証する。
- 各fieldには具体的なconsumerと利用目的がなければならない。
- 詳細本文はon-demand read toolへ分離する。
- 省略した情報は`sourceRef`、`sourceRevision`、`digest`、`cursor`、`hasMore`を使って再取得可能にする。
- compactionは採用済み判断、未解決事項、実行済み操作、失敗、source refsを保持する。

### 2.4 HostとLLMの責務

LLMが判断するもの:

- Taskの意味。
- どのviewまたはdetailを次に読むか。
- どのavailable commandを実行するか。
- Test、Review、修正、追加質問の要否。
- 結果を受けた次action、wait、finish。

Hostが強制するもの:

- schema validation。
- Taskおよびresource ownership。
- authorization、confirmation、revision、idempotency。
- lease、timeout、resource budget。
- command precondition。
- provider call authorization。
- projectionのtoken budgetとpaging。
- immutable audit provenance。

HostはTask本文、error message、Todo名、phase名をkeywordまたは正規表現で分類して次actionを決めない。

## 3. Target Architecture

```text
                       canonical query
DB source of truth --------------------------> Task Operator Projection
      ^                                                |
      |                                                +--> UI adapter --> React UI
      |                                                |
      |                                                +--> MP read adapter --> read tools
      |
      |                 application command
      +----------- Task Operator Command Handler <-----+-- UI route adapter
                                                       |
                                                       +-- MP tool adapter

Human or Mission Pilot
      |
      +-- StartCodingAgentRunCommand --> Coding Agent Run
                                            |
                                            +-- role-neutral terminal event
                                                       |
                                                       +-- UI refresh
                                                       +-- optional MP wake
```

### 3.1 `modules/[domain]` target placement

正本repository、domain policy、application commandは、意味を所有する`modules/[domain]`へ配置する。`taskOperator`へ正本やbusiness ruleを集約しない。

```text
api/modules/
  task/
    application/
    domain/
    repositories/
    index.ts
  run/
    application/
    domain/
    repositories/
    index.ts
  queue/
    application/
    domain/
    repositories/
    index.ts
  questionnaire/
    application/
    domain/
    repositories/
    index.ts
  specification/
  blueprint/
  dataModel/
  planViews/
  review/
  gitCloseout/
  backgroundProcess/

  taskOperator/
    application/       # cross-domain use case composition only
    projections/       # UI/automation共通のbounded read model
    policies/          # command catalog composition。domain ruleは置かない
    ports/
    index.ts

  missionPilot/
    adapters/
    agent/
    repositories/      # Mission Pilot内部stateだけ
    index.ts

  codingAgent/
    application/
    runtime/
    repositories/
    index.ts

  agentsShare/
    contracts/
    events/
    ports/
    index.ts

shared/modules/
  task/
  run/
  queue/
  questionnaire/
  specification/
  taskOperator/
  missionPilot/
  codingAgent/
  agentsShare/

src/modules/
  task/
  run/
  queue/
  questionnaire/
  specification/
  review/
  taskOperator/        # Task Operator API client、query、presentation adapter
  missionPilot/
  codingAgent/
  agentsShare/
```

既存の`specification`、`blueprint`、`dataModel`、`planViews`を無理に一つの巨大`artifact` moduleへ統合しない。それぞれが所有する正本生成と検証を維持し、Task Operatorは共通Artifact refへ投影するだけとする。

Coding Agent TodoはCoding Agent固有のproduction modelであるため、Agent非依存の`todo` domain moduleへ移さない。UIまたはTask OperatorがTodoを読む・resumeする場合は`agentsShare`の中立contract／portを介し、実装と正本mutationは`codingAgent` moduleが所有する。

### 3.2 Domain ownership and public API

| Module | Owns | Public API | Must not own |
| --- | --- | --- | --- |
| `task` | Task lifecycle、Task messageの正本、Task revision | Task query、update、complete、archive、message command | Mission Pilot session、Coding Agent runtime |
| `run` | Agent非依存のTask Run lifecycle、terminal event、Run query | Run query、stop、parent status projection | Coding Agent prompt、Mission Pilot continuation |
| `queue` | Queue entry、lease、priority、recovery | enqueue、patch、requeue、recover、archive | Mission Pilot handoff semantics |
| `questionnaire` | Questionnaire session、question、answer、review | query、draft、submit、follow-up | Mission Pilot専用confirm rule |
| `specification`系 | Plan Artifact正本、revision、digest、生成・再生成 | Artifact query、generation command | Task Operator projection、Mission Pilot session |
| `review` | terminal outcomeに対するユーザー可視review decision | review query、submit decision | 意味別Coding Agent runtime |
| `gitCloseout` | commit、push、mergeのpreconditionと結果 | Git closeout commands | Mission Pilot authorization state |
| `codingAgent` | Coding Agent System Context、Todo、runtime、repository作業 | `StartCodingAgentRunPort`と`ResumeCodingAgentRunPort`のhandler | Mission Pilot role分岐 |
| `missionPilot` | session、conversation、lease、tool receipt、event inbox、prompt | Play/Stop、read/action adapters | Task domain正本、Coding Agent runtime |
| `taskOperator` | cross-domain projectionとuse case composition | head/detail query、command catalog、operator facade | DB repository、domain rule、Agent runtime |
| `agentsShare` | 両Agentで同じ意味のref、event、port | Coding Agent request/resume port、terminal event | route、repository、prompt、role判定 |

各module外からは`index.ts`のpublic APIだけをimportする。route adapter、Task Operator、他domainが内部repository、内部service、深いfile pathをimportしない。循環依存を解消するためにpublic indexへ内部実装を再exportして境界を迂回してはならない。

### 3.3 Task Operatorの制限

`taskOperator`はdomainではなくapplication facadeである。

- 正本tableとrepositoryを所有しない。
- Task、Run、Queue、Questionnaire、Artifact、Review、Gitのbusiness ruleを複製しない。
- 単一domainで完結するcommandは、そのdomainのapplication commandを正本とする。
- cross-domain use caseだけを順序付ける。各stepの成功値を確認せずに次のmutationへ進まない。
- command availabilityは各domain policyの結果を合成し、独自にTask本文やstatus名を解釈しない。
- UI用の表示文言、Mission Pilot prompt、Coding Agent promptを持たない。

### 3.4 許可する依存

```text
UI route adapter       -> taskOperator public query / command facade
missionPilot adapter   -> taskOperator public query / command facade
taskOperator           -> domain module public application API
taskOperator           -> agentsShare ports
missionPilot           -> agentsShare contracts / events
codingAgent            -> agentsShare contracts / events
```

### 3.5 禁止する依存

```text
missionPilot -X-> codingAgent route/service/repository/runtime/internal index
codingAgent  -X-> missionPilot
missionPilot -X-> task/run/todo/queue DB table for domain read or mutation
missionPilot -X-> internal startTaskRun entry
UI adapter   -X-> Mission Pilot command implementation
taskOperator -X-> domain repository or internal service
taskOperator -X-> Mission Pilot or Coding Agent role module
domain module -X-> taskOperator
domain module -X-> Mission Pilot
domain module -X-> Coding Agent internal implementation
```

Mission Pilot自身のsession、conversation、lease、tool call、receipt、event inbox tableへのアクセスはMission Pilot repository内に限り許可する。

## 4. Canonical Task Operator Projection

### 4.1 Head projection

最初に返すviewは「一覧と現在状態」だけを持つ。

```ts
type BoundedTextRef = {
  text: string;
  truncated: boolean;
  sourceRevision: number;
  sourceDigest: string;
};

type TaskOperatorProjectionV1 = {
  version: 1;
  sourceRevision: number;
  sourceDigest: string;
  task: {
    id: string;
    revision: number;
    status: TaskStatus;
    title: string;
    objective: BoundedTextRef | null;
    acceptanceCriteria: BoundedTextRef | null;
  };
  project: {
    id: string;
    repositoryState: "registered" | "missing" | "unavailable";
  };
  questionnaire: null | {
    id: string;
    revision: number;
    status: string;
    decisionDigest: string | null;
    blockingQuestionCount: number;
  };
  artifactIndex: {
    revision: number;
    totalCount: number;
    nextCursor: number | null;
    latestByKind: Array<{
      id: string;
      kind: string;
      revision: number;
      digest: string;
      status: string;
    }>;
  };
  queue: null | {
    id: string;
    revision: number;
    status: string;
    activeRunId: string | null;
  };
  activeRun: null | {
    id: string;
    revision: number;
    status: string;
    currentTodoRef: null | {
      id: string;
      revision: number;
      status: string;
      blockerDigest: string | null;
    };
  };
  latestTerminalRun: null | {
    id: string;
    revision: number;
    status: string;
    outcomeDigest: string;
  };
  commandCatalog: {
    revision: number;
    availableIds: string[];
    confirmationRequiredIds: string[];
    unavailableCount: number;
  };
  unreadEvents: {
    from: number | null;
    through: number | null;
    types: string[];
  };
};
```

すべてのobject schemaは`.strict()`とする。`unknown`、open record、raw table rowを含めない。`BoundedTextRef.truncated=true`の場合、全文は同じrevisionとdigestを指定してdetail queryから取得する。Task Goalを無言で切り捨ててはならない。

`artifactIndex.latestByKind`はArtifact kindごとの最新一件だけを返し、件数に上限を設ける。全Artifact indexはpaged detail queryで取得する。head projectionへ全Artifactを列挙して履歴量に比例させない。

`commandCatalog`は実行可能IDと明示確認が必要なIDだけをheadへ含める。利用不能commandの一覧、理由、input contractはon-demand queryで取得し、全command schemaをheadへ埋め込まない。

### 4.2 Head projectionへ常時含める情報

- Task Goalと完了条件。
- Task、Questionnaire、Queue、Run、Todoの現在statusとrevision。
- Artifact kindごとの最新ref、index revision、total count、next cursor。
- 最新のactive Runとlatest terminal Runへの参照。
- 現在実行可能なcommand IDとconfirmation required command ID。
- 未処理event rangeとtype。

### 4.3 Head projectionへ含めない情報

- Task message本文一覧。
- Questionnaire question、option、answer本文。
- Artifact本文とmetadata全体。
- 全Artifact index。
- 過去Run一覧とfinal report本文。
- verification log、stdout、stderr。
- Git diff本文。
- Queue raw row。
- Run `contextSnapshot`。
- provider routing、trace、usageの内部metadata。
- Mission Pilot session、authorization本文、lease、receipt、conversation内部状態。
- 表示または判断に不要なtimestamp。

### 4.4 Detail query contract

詳細は用途別queryへ分ける。

```ts
type ContentPage<T> = {
  sourceRef: { kind: string; id: string };
  sourceRevision: number;
  sourceDigest: string;
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
  tokenEstimate: number;
  content: T;
};
```

必要なquery:

- `readTaskTimelinePage`
- `readQuestionnaireDecisions`
- `readQuestionnaireDraft`
- `readArtifactIndex`
- `readArtifactPage`
- `readRunOutcome`
- `readRunVerificationPage`
- `readCurrentTodo`
- `readQueueDetail`
- `readGitCloseoutSummary`
- `readAvailableCommandContract`

各queryはTask ownershipを検証し、pagingと上限をserver側で強制する。

### 4.5 Projection cache

最初の実装はcanonical queryから同期生成し、DB tableを増やさない。profilingで必要性が確認された場合だけ、再生成可能なcacheを追加する。

```text
task_operator_projections
  task_id
  projection_version
  source_revision
  source_digest
  projection_json
  token_estimate
  generated_at
```

cacheは正本ではない。digest不一致、schema version不一致、decode失敗時は破棄して再生成する。

## 5. Application Command Unification

### 5.1 Principal、query context、command context

```ts
type TaskOperatorPrincipal = {
  kind: "human" | "automation";
  actorId: string;
  authorizationRef: string;
};

type TaskOperatorQueryContext = {
  principal: TaskOperatorPrincipal;
};

type TaskOperatorCommandContext = {
  principal: TaskOperatorPrincipal;
  requestId: string;
  idempotencyKey: string;
};
```

actor identityとmutation delivery metadataを同じ型へ混在させない。queryはidempotency keyを要求しない。mutationだけがrequest IDとidempotency keyを持つ。

`principal.kind`は監査と明示grantの解決に使用する。Taskの意味、Coding Agentのmode、command結果の意味を分岐させない。idempotencyはactorの能力ではなくcommand deliveryの性質として扱う。

- Human UI adapterは一回のユーザー操作ごとにrequest IDとidempotency keyを生成し、通信retryでは同じ値を再利用する。
- Mission Pilot tool adapterは永続tool callに保存したidempotency keyを再利用する。
- domain commandはactor種別からidempotency keyを生成しない。
- compatibility routeがidempotency keyを受け取れない期間はserver生成値と制限事項を記録し、移行完了まで暗黙retryを行わない。

### 5.2 Canonical domain commands

command handlerの正本は、意味を所有するdomain moduleに一つだけ置く。

| Owner | Canonical commands |
| --- | --- |
| `task` | `UpdateTask`、`PostTaskInstruction`、`CompleteTask`、`ArchiveTask`、`RestoreTaskArchive` |
| `questionnaire` | `CreateQuestionnaire`、`SaveQuestionnaireDraft`、`SubmitQuestionnaire`、`GenerateQuestionnaireFollowUp` |
| `specification`系 | `UpdatePlanRouting`、`GeneratePlanArtifact`、`RegeneratePlanArtifact` |
| `queue` | `QueueTask`、`UpdateQueueEntry`、`RequeueTask`、`RecoverQueueEntry`、`ArchiveQueueEntry` |
| `run` | `StopRun` |
| `backgroundProcess` | `StopBackgroundProcess` |
| `review` | `SubmitRunReview` |
| `gitCloseout` | `CommitRunChanges`、`PushRunChanges`、`PreviewRunMerge`、`DeferRunMerge`、`RequestRunMergeRework`、`UpdateRunMergeTarget`、`ExecuteRunMerge` |
| `codingAgent` via `agentsShare` port | `StartCodingAgentRun`、`ResumeCodingAgentRunTodo` |

`taskOperator`はこれらを再実装しない。queryからcommand availabilityを合成し、UI routeまたはMission Pilot toolから受けた入力を正本commandへdispatchする。複数domainを更新するuse caseだけ、明示的なapplication orchestrationとして所有する。

各commandは一つのschema、authorization policy、precondition、revision contract、idempotency contractを持つ。UI routeとMission Pilot toolは同じhandlerへ入力を変換するだけにする。

`StartVerification`、`StartReview`、`StartReworkRun`等の意味別Coding Agent commandはtarget architectureに含めない。検証、review、reworkが必要なら、目的、参照、完了条件を通常の`StartCodingAgentRun`へ渡す。既存のTest／Review開始routeを互換維持する期間は、同じrequest contractへ変換する薄いadapterとし、専用runtime mode、専用System Context、専用tool setを選ばない。

### 5.3 Mission Pilot固有control action

次はTask Operator commandではなくMission Pilot runtime内部actionとして残せる。

- `agent.wait_for_event`
- `agent.finish`
- provider retry scheduling。
- tool receipt reconciliation。
- Mission Pilot conversation compaction。

ユーザーへの質問や報告をTask UIへ表示するactionはpresentation commandとして分離し、Task status、Run、Todo、Queue、Artifact等を変更しない。

### 5.4 Available command projection

command availabilityは静的scope一覧ではなく、正本commandを所有する各domain policyが現在のresource state、authorization grant、revisionから生成する。Task Operatorは結果を合成するだけで、同じpreconditionを再実装しない。

```ts
type AvailableCommand = {
  id: string;
  availability: "available" | "unavailable" | "confirmation_required";
  unavailableReasonCode: string | null;
  expectedRevision: number | null;
};
```

同じactor grantと同じresource stateなら、UIとMission Pilotへ同じavailabilityを返す。

この詳細型は`readAvailableCommandContract`等のon-demand responseで使用する。head projectionには`commandCatalog.availableIds`、`confirmationRequiredIds`、`unavailableCount`だけを入れ、利用不能command全件を毎turnへ送らない。

### 5.5 Questionnaire confirmation

`questionnaire.submit`のMission Pilot role固定禁止を削除する。人間だけの確認が本当に必要な将来commandは、次の構造で表現する。

- command policyが`confirmation_required`を返す。
- UIまたはMission Pilotが明示confirmation grantを取得する。
- grantはresource、revision、command、期限へbindingする。
- Mission Pilotというrole名を判定条件にしない。

## 6. Mission Pilot Tool Surface and Token Budget

### 6.1 常設tool

providerへ常時渡すtoolを小さく固定する。

- `read_task_operator_view`
- `read_task_resource`
- `list_available_task_actions`
- `read_task_action_contract`
- `execute_task_action`
- `agent.wait_for_event`
- `agent.finish`

現在の全action schemaを毎samplingへ展開する方式は廃止する。

### 6.2 Action contractの遅延取得

`list_available_task_actions`はID、短い説明、availability、revisionだけを返す。LLMが候補を選んだ後、`read_task_action_contract(actionId)`でその一件のschemaを取得する。

`execute_task_action`は小さな共通schemaを持ち、server側で選択されたcommandの正本schemaを再検証する。

```ts
type ExecuteTaskActionInput = {
  actionId: string;
  expectedResourceRevision: number | null;
  idempotencyKey: string;
  arguments: JsonObject;
};
```

openな`arguments`をそのままdomainへ渡してはならない。正本schemaでparseした成功値だけをcommand handlerへ渡す。

### 6.3 Current-step envelope

providerを呼ぶ直前に、head projectionからさらに差分を抽出する。

```ts
type MissionPilotStepEnvelopeV1 = {
  version: 1;
  taskRef: { id: string; revision: number; status: string };
  sourceDigest: string;
  changedSincePreviousTurn: {
    eventTypes: string[];
    resourceRefs: Array<{ kind: string; id: string; revision: number }>;
  };
  activeRunRef: { id: string; status: string } | null;
  currentTodoRef: {
    id: string;
    revision: number;
    status: string;
    blockerDigest: string | null;
  } | null;
  availableActionIds: string[];
  unreadEventRange: { from: number | null; through: number | null };
};
```

初回turnではTask Goalを含むhead projectionを渡す。以後はrevision差分を渡し、digest不一致時だけfull head projectionへrebaseする。

### 6.4 Provider conversation projection

DB conversationは完全に保持するが、providerへは次だけを投影する。

- 固定System Context。
- 構造化State Card。
- 採用済み判断。
- 未解決事項。
- 実行済みaction receipt。
- 未処理event。
- 直近4〜6 turnを初期目標とするbounded conversation。

古いtool result、Artifact本文、Run report、verification logはprovider projectionから外し、次のreceiptへ置換する。

```ts
type ConsumedResourceReceipt = {
  toolCallId: string;
  resourceRef: { kind: string; id: string };
  sourceRevision: number;
  sourceDigest: string;
  consumedRange: { from: number; through: number } | null;
};
```

DB本文は変更しない。必要なら同じdigestとpaging contractで再取得する。

### 6.5 初期token budget

次を実装開始時の目標値とし、fixture計測に基づいて調整する。

| Section | Initial target |
| --- | ---: |
| Current-step envelope | 1,000 tokens以下 |
| Initial Task Operator head projection | 3,000 tokens以下 |
| On-demand content page | 4,000 tokens以下 |
| One turnのtool result合計 | 8,000 tokens以下 |
| Replayed recent conversation | 4〜6 turn |
| Action contract | 選択した1件だけ |

budget超過時は文字列を無差別に切らない。次の優先順位で本文を参照へ降格する。

1. Task Goal、完了条件。
2. current blocker、current Todo。
3. active Run。
4. 未処理event。
5. available command IDs。
6. Artifact refs。
7. history refs。

各provider callにsection別token estimateを記録する。token budgetはTask意味判断には使用せず、context transportの上限だけを強制する。

### 6.6 Prompt caching

providerがprompt cachingを持つ場合、次をstable prefixに固定する。

- Mission Pilot System Context。
- 常設tool definitions。
- 共通failure contract。

current-step envelope、event、detail resultはsuffixへ置く。cache非対応providerでも正しく動作し、cache hitを正しさの前提にしない。

## 7. Coding Agent Boundary Refactor

### 7.1 削除対象

Coding Agentから次を削除する。

- `CodingAgentInvocationSource`。
- `CODING_AGENT_USER_INVOCATION_JA`。
- `CODING_AGENT_MISSION_PILOT_HANDOFF_JA`。
- `resolveCodingAgentInvocationSource`。
- `invocationSource`によるSystem Context分岐。
- Mission Pilotへblockerまたはfinal reportを返す指示。
- Mission Pilot handoffの有無をruntime reminderへ含める処理。
- Coding Agent context、Todo System Context snapshot、task status projectionにあるMission Pilot source分岐。

`api/modules/codingAgent`内の`mission_pilot`と`Mission Pilot`参照を0件にする。

### 7.2 StartCodingAgentRun command

人間ユーザーとMission Pilotは同じcommandを使う。

```ts
type StartCodingAgentRunCommand = {
  taskId: string;
  instruction: string;
  artifactRefs: Array<{
    kind: string;
    id: string;
    revision: number;
    digest: string;
  }>;
  repositoryRef: { id: string; revision: number };
  requestProvenance: {
    requestedBy: { kind: "human" | "automation"; actorId: string };
    orchestrationRef: { kind: string; id: string } | null;
  };
};
```

`requestProvenance`はRun associationまたはauditへ保存し、Coding Agent System Contextへ渡さない。

Mission PilotはCoding AgentのTodoを注入または更新しない。`initialTodos`、Mission Pilot固有rework Todo、Mission Pilot runtime envelopeをCoding Agent requestから除去する。

### 7.3 Queueとassociation

- `ImplementationQueueHandoff`の`blocked`、`hold()`、`codingAgentInvocationSource`を削除する。
- Mission Pilotがcommandを発行するtransaction内でartifact revision、digest、authorizationを検証する。
- Queueへ受理されたrequestはimmutableにする。
- dequeue、Run作成、Run association時にMission Pilotの`playing`状態を再検査しない。
- association失敗をCoding Agent開始失敗にしない。監査associationは再試行可能にする。

### 7.4 needs_human resume

Mission Pilotに`ResumeCodingAgentRunTodo` commandを公開する。

- Human UIと同じRun、Todo、provider sessionをresumeする。
- `runId`、`todoId`、`expectedTodoRevision`、`userContext`を使用する。
- Mission Pilot専用resume prompt、別Run、別runtime modeを作らない。
- userContextの意味はCoding Agentが解釈する。

### 7.5 Closeout

- Coding Agentは常に自身のRunをterminalへ遷移させる。
- `task_run.terminal`をrole非依存eventとしてpublishする。
- parent Task statusはRun outcomeと共通application policyで決め、requester roleで分岐しない。
- Mission Pilot subscriberは外側でeventを観測し、activeなら次actionを選べる。
- Mission PilotがOffならsubscriberはproviderを呼ばず、eventとRun outcomeをDBに保持する。

## 8. Mission Pilot Runtime Cleanup

### 8.1 Play時の初期化

- `mission_pilot_initial_prompt`という疑似user message作成を削除する。
- Task objectiveだけをMission Pilot conversationへseedしない。
- Play時はTask Operator head projectionとtimeline cursorを取得する。
- 必要な過去messageはMission Pilotが`readTaskTimelinePage`で読む。
- provider conversation内のuser itemは実在するuser messageまたは明示Task Goal projectionだけにする。

### 8.2 Domain DB accessの除去

Mission Pilotのread/action adapterから次のtableへの直接accessを除去する。

- `tasks`
- `taskMessages`
- `taskRuns`
- `taskRunTodos`
- `implementationQueueEntries`
- Questionnaire、Artifact、Review、Git等のAgent非依存domain table

readはTask Operator query、mutationはTask Operator commandを使用する。Mission Pilot repositoryはMission Pilot内部tableだけを扱う。

### 8.3 Legacy runtimeの廃止

- 新規Task、既存Task、backfill Taskをすべてagent runtimeへ統一する。
- legacy sessionにはagent session rowをadditive migrationで作成する。
- 移行時はMission Pilotを`stopped`にし、ユーザーの明示Playなしにprovider callまたはmutationを開始しない。
- legacy phase、continuation、recovery、queue handoffはhistorical readに必要なfieldだけ残し、production entryから削除する。
- `MissionPilotRuntimeOwnership`の`legacy`分岐を最終Phaseで削除する。

### 8.4 Off invariant

Mission Pilot Offでは次をすべて0にする。

- Mission Pilot provider call。
- Mission Pilot compaction provider call。
- Mission Pilot Artifact／Questionnaire provider call。
- Mission Pilot read tool execution。
- Mission Pilot action tool execution。
- Mission Pilot wakeによるsampling。

Task、Run、Coding Agent、UI queryはMission Pilot Offと独立して動作する。

Provider adapterのpreflight authorizationはdefense in depthとして維持するが、Off callが発生してから拒否する設計を正常経路としない。

## 9. Implementation Phases

各Phaseは単独でreview、test、rollbackできる単位にする。productionで旧経路と新経路の両方にmutationさせる二重writeは行わない。

### Phase 0: Baseline and Change Ledger

作業:

1. working treeのtracked/untracked差分と所有者不明の変更を記録する。
2. Mission Pilot provider usage、input section、tool schema、conversation replayのbaseline tokenをfixtureで測る。
3. UI routeからapplication serviceまでのcommand mapを作る。
4. Mission Pilot actionから実装先までのcommand mapを作る。
5. UIとMission Pilotで異なるprecondition、result、errorを一覧化する。
6. Coding Agent内のMission Pilot参照とMission Pilot内のCoding Agent runtime直接参照を一覧化する。
7. legacy session件数とmigration対象を確認する。
8. `nightworkers`、`services`、各既存moduleに散在するTask、Run、Queue、Questionnaire、Artifact、Review、Git command/query/repositoryをownership matrixへ分類する。
9. 各importをpublic API、deep import、cross-domain repository accessに分類する。

成果物:

- change ledger。
- command parity matrix。
- token baseline report。
- boundary reference inventory。
- domain ownership and public API inventory。

Gate:

- 既存挙動を比較できるtestまたはfixtureがなければPhase 1へ進まない。

### Phase 1: Domain Public APIs and Task Operator Contracts

作業:

1. 今回触るTask、Run、Queue、Questionnaire、Specification、Review、Git Closeoutの正本public APIを各`modules/[domain]/index.ts`へ定義する。
2. Coding Agent start/resumeの中立contractとportを`agentsShare`へ定義し、handler ownershipを`codingAgent`へ固定する。
3. `shared/modules/taskOperator`へstrict schemaを追加する。
4. head projection、content page、available command、principal、query context、command context、command result、typed failureを定義する。
5. `unknown`、open DB row、role fieldを契約へ入れない。
6. schema fixture、public API import test、round-trip testを追加する。

Gate:

- unknown fieldがrejectされる。
- worst-case fixtureのtoken estimateが初期budget内に収まる。
- contractがMission PilotまたはCoding Agent moduleをimportしない。
- domain外からdeep importせず、public indexだけで必要なquery/commandを利用できる。
- Task Operator contractにidempotency keyを持つquery contextや、actor identityに埋め込まれたdelivery metadataがない。

### Phase 2: Canonical Query and UI/MP Read Parity

作業:

1. 今回のprojectionに必要な既存query/repositoryを、意味を所有する`modules/[domain]`のpublic APIへ移動または薄いpublic wrapperで公開する。
2. `api/modules/taskOperator/projections`を実装し、domain public queryの結果だけを合成する。
3. current Mission Pilot DB aggregationをTask Operator queryへ置換する。
4. UI query adapterも同じprojection/detail queryを使用する。
5. Artifact revision、Questionnaire revision、Queue revision、Run revisionを正本domainから読む。
6. `currentView`のようなfrontend local stateをdomain authorityから除外する。
7. head Artifactをlatest-by-kindへ限定し、全indexをpagingする。
8. Task Goalのbounded textと再取得refを実装する。
9. paging、digest、token estimateを追加する。

Gate:

- 同一Task revisionでUI queryとMission Pilot queryのsource digestが一致する。
- provider入力にraw row、`metadataJson`、`contextSnapshot`が含まれない。
- 省略した情報をsource refから再取得できる。
- Task Operatorがdomain repositoryまたはdeep internal pathをimportしていない。
- Artifact履歴件数を増やしてもhead projectionが線形増加しない。

### Phase 3: Canonical Commands and Action Parity

作業:

1. 各command handlerとbusiness policyの正本を、意味を所有する`modules/[domain]/application`へ移動または確定する。
2. Task Operatorはdomain command catalogとcross-domain orchestrationだけを実装する。
3. UI routeをTask Operator facade経由の同じdomain handlerへ接続する。
4. Mission Pilot tool adapterをTask Operator facade経由の同じdomain handlerへ接続する。
5. available commandを各domain policyから合成する。
6. `questionnaire.submit`のrole固定禁止を削除する。
7. `ResumeCodingAgentRunTodo`を`agentsShare` port経由でMission Pilotへ公開する。
8. Task completeのMission Pilot-owned Run限定を削除する。
9. direct service、dynamic import、internal runtime entry呼び出しをMission Pilot action executorから除去する。
10. `StartVerification`、`StartReview`等の意味別開始を通常の`StartCodingAgentRun` requestへ変換し、専用runtime選択を削除する。

Gate:

- Human actorとAutomation actorで、同じgrantとresource stateなら同じsuccessまたはtyped errorになるparameterized testが通る。
- UIとMission Pilotが異なるcommand実装へ到達する経路がない。
- Task Operatorとdomain moduleに同じcommandのbusiness ruleが重複していない。
- 既存互換routeから開始した検証／reviewも通常Coding Agentと同じSystem Context、tool set、Todo contractを使う。

### Phase 4: Coding Agent Independence Cutover

このPhaseは一つのCheckpointとして切り替える。prompt分岐だけ、queue条件だけ等を部分適用して中間状態を長期間残さない。

作業:

1. `CodingAgentInvocationSource`とSystem Context分岐を削除する。
2. Coding AgentのMission Pilot参照を削除する。
3. `StartCodingAgentRun`を人間とMission Pilotの単一entryにする。
4. Mission Pilot固有Run option、initial Todo、runtime envelopeを削除する。
5. Queue holdとMission Pilot live-state preconditionを削除する。
6. requester provenanceをaudit associationへ移す。
7. role非依存terminal eventとcloseout policyへ切り替える。

Gate:

- `api/modules/codingAgent`のMission Pilot参照が0件。
- Mission Pilot sessionなし、stopped、playingのいずれでもCoding AgentのSystem Contextとtool setが同一。
- Mission Pilot停止後も開始済みCoding Agent Runが継続する。
- `needs_human`を同じRun/Todo/provider sessionで人間またはMission Pilotからresumeできる。

### Phase 5: Tool Surface and Provider Context Optimization

作業:

1. 全action schemaの常時送信を廃止する。
2. action list、action contract、generic executionの三段階へ切り替える。
3. current-step envelopeを差分化する。
4. detail resultを次turn以降receiptへ縮約する。
5. provider conversation projectorを実装する。
6. section別token accountingを追加する。
7. stable prefixをprompt cache可能な順序へ固定する。

Gate:

- 同じTaskで履歴件数を増やしてもcurrent-step envelopeのsizeが線形増加しない。
- 既読Artifact本文、Run report、tool result本文が次turn以降に再送されない。
- action数を増やしても未選択action schemaがprovider inputへ入らない。

### Phase 6: Play Initialization and Event Delta

作業:

1. 疑似initial prompt messageを削除する。
2. PlayをTask Operator head projectionから開始する。
3. user-visible timelineをpaging queryで取得可能にする。
4. event payloadを小さいrefとrevisionに限定する。
5. wake時にevent deltaを読み、必要なdetailだけをLLMがtool取得する。

Gate:

- PlayがTask timelineを変更しない。
- Play直後のprovider inputに同じTask Goalが重複しない。
- Play前に存在したuser messageをpagingで取得できる。

### Phase 7: Legacy Migration and Removal

作業:

1. legacy sessionを停止状態のagent sessionへ移行するmigrationを追加する。
2. legacy coordinator、recovery、continuation、ownership分岐をproductionから削除する。
3. historical legacy fieldsはread-only compatibilityとして必要な期間だけ残す。
4. migration rollback手順を記載する。

Gate:

- 全Taskに単一Mission Pilot agent runtimeがある。
- restart時にlegacy pathが起動しない。
- migrationによって自動Play、provider call、Task mutationが発生しない。

### Phase 8: Cleanup, Architecture Gates, Full Verification

作業:

1. compatibility re-export、dead prompt、dead tool、dead route、dead schemaを削除する。
2. 今回移行した責務の旧`nightworkers`／`services`実装を削除し、必要な公開route adapterだけを薄く残す。
3. source scan、public-index import check、cycle check、dependency architecture checkを追加する。
4. targeted test、integration、E2E、typecheck、lint、architecture checkを実行する。
5. token baselineと実装後結果を比較する。
6. change ledgerを完了状態へ更新する。

Gate:

- Section 11の全acceptance criteriaが通る。
- unrelated dirty changesを変更またはstageしていない。

## 10. Data Migration and Compatibility

### 10.1 DB history

- 既存Task message、Run、Artifact、Questionnaire、tool call、usage rowを削除しない。
- historical `codingAgentInvocation`、`missionPilotAgent`等はread-only auditとして残せる。
- 新規Runではrole-specific behavior fieldを書かない。
- destructive migrationは別承認がない限り行わない。

### 10.2 API compatibility

- UIが使用する公開route pathは必要に応じてcompatibility adapterとして維持できる。
- route内部はTask Operator query/commandへ切り替える。
- compatibility adapterに意味分岐、独自precondition、独自mutationを残さない。

### 10.3 Rollout

- read projectionはtest-only shadow comparisonを許可するが、production providerへ旧新両方のcontextを送らない。
- mutationの二重writeを行わない。
- command単位でadapterを切り替え、切替後は旧mutation pathを同じPhaseで削除する。
- Coding Agent IndependenceはPhase 4の単一Checkpointで切り替える。
- module移動では、先に新domain public APIを用意し、consumerを切り替え、同じCheckpoint内で旧deep importと重複実装を削除する。
- compatibility re-exportは期限と削除Phaseをchange ledgerへ記録し、恒久的なpublic APIにしない。

## 11. Verification and Acceptance Criteria

### 11.1 Projection tests

- `TaskOperatorProjectionV1`がstrict schemaである。
- raw DB fieldを追加したfixtureがparse失敗する。
- `metadataJson`、`contextSnapshot`、raw Queue row、raw Questionnaire rowがprovider projectionに存在しない。
- Artifact、Questionnaire、Run、Todoのrevisionとdigestが正本と一致する。
- detail pageがcursor、digest、hasMore、nextCursor、tokenEstimateを返す。
- omitted detailを再取得できる。
- worst-case head projectionがtoken budget内である。

### 11.2 UI/tool command parity tests

- UI routeとMission Pilot toolが同じhandlerを呼ぶ。
- 同じactor grantとrevisionで同じresultを返す。
- revision conflict、permission、confirmation、resource ownership、domain preconditionが同じtyped errorになる。
- `questionnaire.submit`をMission Pilotが通常のauthorization内で実行できる。
- `ResumeCodingAgentRunTodo`をUIとMission Pilotが同じcontractで実行できる。
- Task completeがrequester provenanceで拒否されない。

### 11.3 Coding Agent boundary tests

- Coding Agent moduleにMission Pilot参照がない。
- Mission Pilot moduleがCoding Agent route、service、repository、runtimeをimportしない。
- user requestとautomation requestでCoding Agent System Context、tool definitions、Todo behavior、completion behaviorが同一。
- Mission PilotなしでCoding Agentが開始、調査、実装、検証、完了できる。
- Mission Pilot停止中でもCoding Agentをユーザーが開始できる。
- Mission Pilot停止後も受理済みCoding Agent Runが継続する。
- Coding Agent blockerはTask Runの`needs_human`として終端し、Mission Pilot wait状態を作らない。

### 11.4 Mission Pilot runtime tests

- Mission PilotはTask Operator viewをread toolで取得する。
- Task domain DBをMission Pilot adapterが直接readまたはmutationしない。
- action resultとtyped failureが同じconversationへ戻る。
- full tool resultは次turn以降receiptへ縮約される。
- event deltaだけでwakeし、detail本文を自動注入しない。
- Playは疑似user messageを作らない。
- Off中のprovider、compaction、read tool、action tool、wake samplingが0件。

### 11.5 Token regression tests

最低限、次のfixtureを用意する。

- Task message 1,000件。
- Artifact 100件、各長文。
- terminal Run 100件。
- Questionnaire multiple revisions。
- tool call/result 1,000件。
- unread eventなし／多数の両ケース。

期待結果:

- head projection sizeが履歴本文量に比例しない。
- current-step envelopeが上限内に収まる。
- 未選択action schemaがprovider inputへ入らない。
- provider conversation projectionがboundedである。
- 必要な詳細はpagingで取得可能である。

### 11.6 Architecture checks

静的検査で次を禁止する。

- `api/modules/codingAgent`内の`mission_pilot`または`Mission Pilot`。
- Mission PilotからCoding Agent internal moduleへのimport。
- Mission Pilot Task read/action adapterからdomain DB schemaへのimport。
- Mission Pilotからinternal `startTaskRun`へのimport。
- Task Operator contract内のrole判定。
- Task Operator projection schema内の`z.unknown()`。
- Task Operatorによるdomain repository、deep internal service、DB schemaの直接import。
- domain moduleからTask Operatorへの逆依存。
- module外からのdeep importまたは内部実装のpublic index経由re-export。
- Task Operatorとdomain moduleに重複したcommand handlerまたはbusiness precondition。
- Agent非依存`todo` moduleへのCoding Agent Todo正本の移動。
- `CodingAgentInvocationSource`または`codingAgentInvocationSource`のproduction use。
- `StartVerification`、`StartReview`等による意味別Coding Agent runtime選択。
- `questionnaire.submit`のMission Pilot role固定禁止。
- legacy runtimeのproduction activation。

### 11.7 Verification commands

実装時に現在の`package.json` scriptsを再確認したうえで、少なくとも次を実行する。

```bash
bun run typecheck
bun run lint
bun run test
bun run check:architecture
bun run check:docs
```

大規模な既存failureがある場合、今回変更との因果を切り分ける。targeted testを先に通し、unrelated baseline failureは証跡付きで報告するが、今回変更が原因のfailureを既存問題として扱わない。

## 12. Non-Goals

- DB正本を削減または短期保持へ変更すること。
- UIをMission Pilot専用UIへ置き換えること。
- Mission Pilotにbrowser DOM操作を追加すること。
- Mission Pilotにrepository filesystem、shell、Gitの直接toolを与えること。
- Coding AgentへMission Pilot専用mode、repair mode、test mode、review modeを追加すること。
- hostがTask文言からworkflowを固定すること。
- provider cachingを正しさの前提にすること。
- 既存Artifact、Questionnaire、Run historyを破壊的に変換すること。
- `nightworkers`等に残る全機能を今回一括で移動すること。今回のprojection、command parity、Agent境界で触る責務だけを正本domainへ移し、残りは別計画で扱う。
- 既存の`specification`、`blueprint`、`dataModel`、`planViews`を巨大な汎用Artifact moduleへ統合すること。
- unrelated frontend表示、デザイン、設定画面を同時に改修すること。
- token削減のために正本または監査証跡を失うこと。

## 13. Implementation Review Checklist

各PRまたはCheckpointで次を確認する。

- [ ] Mission PilotはユーザーのUI操作代替に留まっている。
- [ ] UIとMission Pilotが同じqueryまたはcommandを利用している。
- [ ] 正本query、repository、business ruleが意味を所有する`modules/[domain]`にある。
- [ ] Task Operatorはpublic APIだけを利用し、repositoryやdomain ruleを所有していない。
- [ ] domain moduleからTask Operatorへの逆依存やmodule外からのdeep importがない。
- [ ] Coding Agent TodoをAgent非依存domainへ移していない。
- [ ] Mission Pilot固有の裏口mutationを追加していない。
- [ ] Coding AgentがMission Pilotを認識していない。
- [ ] requester provenanceをsemantic modeに使用していない。
- [ ] provider入力がstrict projectionだけで構成されている。
- [ ] raw DB row、metadata、履歴本文を無条件に渡していない。
- [ ] 省略情報をdigestとpagingで再取得できる。
- [ ] tool result全文を永続的にreplayしていない。
- [ ] action schemaを必要な分だけ渡している。
- [ ] Artifact全件や利用不能command全件をhead projectionへ入れていない。
- [ ] actor identity、query context、command idempotencyの責務が分離されている。
- [ ] 検証、review、reworkを意味別Coding Agent runtimeにしていない。
- [ ] Off時provider call 0を維持している。
- [ ] pre-existing working-tree changeを壊していない。
- [ ] targeted testとarchitecture gateを更新している。

## 14. Definition of Done

次をすべて満たした場合だけ実装完了とする。

1. UIとMission Pilotが同じTask Operator projectionを読む。
2. UIとMission PilotのTask domain mutationが同じapplication commandへ到達する。
3. Mission Pilot provider入力にraw DB rowまたはunbounded historyが含まれない。
4. detailはon-demand、paged、digest付きで再取得できる。
5. provider conversationとtool schemaがboundedである。
6. Coding AgentからMission Pilot依存が完全に除去されている。
7. Mission Pilot停止状態がCoding Agentの開始、継続、resume、完了へ影響しない。
8. Questionnaire submit、needs_human resume、Task completeがユーザー操作と同じcommand contractでMission Pilotから実行できる。
9. Mission Pilot legacy runtimeがproduction pathからなくなる。
10. Mission Pilot Off中の全Mission Pilot provider usageが0である。
11. token regression fixtureがbudgetを満たす。
12. 今回触った正本query、command、repository、policyが`modules/[domain]`へ配置され、Task Operatorはcross-domain facadeに限定される。
13. domain外consumerがpublic indexだけを使い、deep import、循環依存、command rule重複がない。
14. Artifact履歴、利用不能command、長いTask Goalがhead projectionを無制限に増大させない。
15. query principalとmutation delivery/idempotency contextが分離されている。
16. 検証、review、reworkが通常の`StartCodingAgentRun`を使用し、意味別runtimeを作らない。
17. typecheck、lint、targeted test、full test、architecture check、docs checkの結果が記録される。
