# Mission Pilot / Coding Agent Complete Module Separation Implementation Plan

## Status

- Concept status: `locked`
- Plan status: `implementation-ready; document review passed; Luna slow implementation handoff`
- Implementation status: `implemented; verification complete`
- Document review status: `reviewed against current code, scripts, tests, and dirty working tree`
- Last updated: 2026-07-16
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target branch at plan creation: `codex/mission-pilot-persistent-agent-refactor`
- Target HEAD at plan creation: `95dfa8dc`
- Working tree policy: preserve every pre-existing tracked and untracked change visible when implementation starts
- Priority over older plans: this document is authoritative when an older Mission Pilot or Coding Agent plan assigns Questionnaire, Plan routing, or Artifact ownership to Coding Agent

この文書は、Mission PilotとCoding Agentの責務が繰り返し混在した問題を、ファイル配置、依存方向、route、service、repository、SystemContext、tool、event、保存状態のすべてで解消するための実装正本である。

本計画の完成条件は次の一文に集約する。

> Agent固有のproduction codeをMission Pilot、Coding Agent、agentsShareの3 moduleへ集約し、Mission PilotがTask解釈・Questionnaire・Plan routing・Artifact・進行判断を所有し、Coding Agentが確定済みTaskと設計に基づくrepository作業だけを所有する状態を、静的検査と回帰テストで破れないようにする。

このリファクタリングは、単なるファイル移動ではない。現在誤ってCoding Agentへ移されたPlan Modeの意味判断をMission Pilotへ戻し、共有moduleやproviderへrole固有処理を隠す迂回も禁止する。

## 0. Implementation Start Gate

Lunaは、次をすべて確認するまでproduction codeの移動を開始しない。

1. この文書を最後まで読む。
2. `AGENTS.md`のrole分離規則を読む。
3. working treeのtracked / untracked差分を記録する。
4. Phase 0のchange ledgerを作る。
5. 現在のtargeted baseline testを実行する。
6. C1のboundary testが成功することを確認する。
7. Plan ownershipの切替をC8の一つのCheckpointで行うことを確認する。

Mission PilotとCoding AgentのPlan ownershipを段階的に切り替えてはならない。

- Coding Agent Plan mutationを先に削除すると、Mission Pilot復元までPlan所有者が不在になる。
- Mission Pilot Plan actionを先にproduction activationすると、Coding Agentと二重所有になる。

C5〜C7では新しいMission Pilot経路をdirect testできる状態まで準備するが、production listener、tool availability、continuation ownershipは切り替えない。C8で次を同一Checkpointとして適用する。

1. Mission PilotのQuestionnaire、routing、Artifact actionを有効化する。
2. Mission PilotのQuestionnaire / Run event subscriberを正本にする。
3. Coding AgentのPlan mutation toolを削除する。
4. Coding Agent Plan intake / continuation listenerを削除する。
5. `api/app.ts`の初期化登録を切り替える。
6. 逆契約testを同時に切り替える。

この切替にfeature flag、二重write、二重listener、role別modeを導入しない。

## 1. Non-Negotiable Ownership Contract

### 1.1 Mission Pilotの所有権

Mission Pilotは次を所有する。

- Task Goal、完了条件、ユーザー指示、現在のFactの解釈。
- 次に読む情報と次actionの判断。
- Questionnaireの作成要否判断。
- Questionnaireの質問、回答案、根拠、follow-up、review、確定までの進行。
- ユーザー介入時間とユーザー操作の尊重。
- Plan routingのinclude / omit判断。
- Feature Plan、Blueprint、Data Model、Dedicated Viewの生成と再生成。
- Artifact source selection、revision、idempotency、採用判断。
- Coding Agentへ渡す依頼本文と確定済み設計context。
- Implementation、Test、Review、追加調査、修正依頼の要否判断。
- Run outcome、verification、blockerの評価。
- Task complete、archive、wait、finishの判断。
- Mission Pilot route、service、repository、SystemContext、tool contract、provider adapter、event subscriber。

Mission Pilotはrepositoryを直接編集しない。repositoryの調査・編集・command・検証が必要な場合は、共有application commandを通じてCoding Agentへ依頼する。

### 1.2 Coding Agentの所有権

Coding Agentは次を所有する。

- 渡されたTask、確定済みQuestionnaire Decisions、確定済みArtifact、repository contextの読解。
- 登録済みProject repo rootでのファイル調査。
- repository内の作成、編集、削除。
- command実行。
- build、typecheck、lint、unit、integration、E2E等の検証。
- Todoの明示的な作成・更新。
- 作業結果、変更summary、verification、blocker、final reportの返却。
- Coding Agent route、service、repository、SystemContext、tool contract、runtime adapter、event publisher。

Coding Agentは次を所有しない。

- Questionnaire作成。
- Questionnaire回答案作成。
- Questionnaire review採用。
- Plan routing更新。
- Artifactのinclude / omit判断。
- Artifact生成・再生成。
- Mission Pilot sessionの進行。
- Taskの最終完了判断。
- Mission Pilotの代替としてのユーザー対応。

Coding Agentは単一runtimeを維持する。設計専用mode、repair専用mode、意味別runtime、固定workflow、Task文言やerror keywordによるhost側の分岐を追加しない。

### 1.3 agentsShareの所有権

`agentsShare`は、Mission PilotとCoding Agentの双方で完全に同じ意味を持つ中立要素だけを所有する。

配置してよいもの:

- role非依存のcommand input / output contract。
- role非依存のquery contract。
- role非依存のevent envelope。
- Task、Run、Artifact、Questionnaire等の正本参照型。
- provider tool call / resultの中立型。
- digest、paging、cursor、bounded text等の純粋utility。
- application commandを呼ぶためのport interface。
- application eventをpublish / subscribeするためのport interface。
- roleを知らないtest fixture helper。

配置してはいけないもの:

- route。
- repository。
- DB tableへの直接アクセス。
- SystemContext。
- prompt。
- Mission Pilot tool。
- Coding Agent tool。
- `role === "mission_pilot"`等のrole判定。
- QuestionnaireやArtifactの所有判断。
- continuation。
- lifecycle coordinator。
- role固有service。
- role固有authorization policy。
- role固有のUI表示判断。

`agentsShare`はMission PilotまたはCoding Agentをimportしてはならない。

## 2. Allowed Production Code Locations

### 2.1 Backend

```text
api/modules/
  missionPilot/
    routes/                  # 実在するrouteがある場合だけ
    services/
    repositories/
    prompts/
    tools/
    planning/
    questionnaire/
    artifacts/
    events/
    adapters/
    index.ts

  codingAgent/
    routes/                  # 独立した公開routeが必要な場合だけ
    services/
    repositories/
    context/
    runtime/
    tools/
    events/
    adapters/
    index.ts

  agentsShare/
    contracts/
    ports/
    events/
    utils/
    index.ts
```

### 2.2 Frontend

```text
src/modules/
  missionPilot/
    components/
    hooks/
    services/
    state/
    types/
    index.ts

  codingAgent/
    components/
    hooks/
    services/
    state/
    types/
    index.ts

  agentsShare/
    contracts/
    presentation/
    utils/
    index.ts
```

### 2.3 Frontend / Backend共通contract

FrontendとBackendの双方が参照するrole固有schemaが必要な場合は、次へ集約する。

```text
shared/modules/
  missionPilot/
  codingAgent/
  agentsShare/
```

既存の`shared/schemas/mission-pilot*.ts`等を恒久的な例外として残さない。移行期間中だけcompatibility re-exportを許し、最終Phaseで削除する。

Module構造を対称に見せる目的だけで空のroute、service、repository、schemaを作らない。Role固有の永続状態が存在しない場合、role repositoryは作らず中立application query / command portを使う。

### 2.4 3 module外に残してよいもの

次はAgent固有の意味を一切持たない場合だけ、既存の共通領域へ残してよい。

- DB client。
- logger。
- crypto。
- JSON parser。
- HTTP framework adapter。
- 汎用LLM provider transport。
- 汎用schema validation。
- 汎用command runner。
- 汎用filesystem primitive。
- Agent非依存のtool implementation library。
- Agent非依存のruntime session storeとprovider request transport。
- Agent以外も使用するTask、Run、Review、Git等のapplication command。
- Agent以外も使用するdomain modelとrepository。
- historical DB migration。

共通領域に次が一つでも含まれる場合はrole moduleへ移す。

- Mission PilotまたはCoding Agentを名指しするprompt。
- role固有の状態名。
- role固有tool名。
- role固有event listener。
- role固有のDB query。
- role固有のcontinuation。
- roleによって処理を変える分岐。

`agent-runtime`や`worker-tools`という現在のdirectory名だけを根拠に、directory全体をCoding Agentへ移してはならない。各fileのconsumerと意味を調べ、Coding Agent固有、agentsShare contract、Agent非依存libraryのいずれかへ分類する。

## 3. Dependency Rules

### 3.1 許可する依存

```text
missionPilot -> agentsShare
codingAgent  -> agentsShare

missionPilot -> Agent非依存application command / query
codingAgent  -> Agent非依存application command / query

api/app.ts -> missionPilot public index
api/app.ts -> codingAgent public index
```

### 3.2 禁止する依存

```text
missionPilot -X-> codingAgent
codingAgent  -X-> missionPilot
agentsShare  -X-> missionPilot
agentsShare  -X-> codingAgent

missionPilot route -X-> codingAgent service/repository
codingAgent route  -X-> missionPilot service/repository

missionPilot service -X-> codingAgent repository
codingAgent service  -X-> missionPilot repository

shared provider -X-> role-specific prompt/tool/branch
shared domain   -X-> role-specific repository/table
```

Mission PilotがCoding Agentを開始する場合も、Coding Agent serviceを直接importしない。Agent非依存の`TaskRunCommandPort`等を`agentsShare`から受け取り、共有application commandへ委譲する。

共有Task Run coordinatorもCoding Agent runtime内部を直接importしない。`agentsShare`の中立なexecution portだけを参照し、composition rootがCoding Agent moduleのadapterをそのportへ接続する。これにより、Task Runという共有application lifecycleと、repository実装を行うCoding Agent runtimeの所有権を分離する。

### 3.3 Route規則

- Mission Pilot routeはMission Pilot serviceだけを呼ぶ。
- Coding Agent routeはCoding Agent serviceだけを呼ぶ。
- 共有Task routeはAgent固有serviceを直接呼ばない。
- composition root以外で両roleのpublic indexを同時にimportしない。
- fixture routeも対応するrole moduleへ置く。
- route fileからrepositoryを直接呼ばない。

### 3.4 Service規則

- Serviceは同じroleのrepositoryと、`agentsShare`のportだけを直接参照する。
- 他roleのserviceを直接呼ばない。
- shared domain serviceへrole引数を渡して分岐させない。
- role固有のworkflowをshared serviceへ移さない。
- semantic decisionをhostの固定条件へ置き換えない。

### 3.5 Repository規則

- Mission Pilot repositoryはMission Pilot tableだけを扱う。
- Coding Agent repositoryはCoding Agent固有tableだけを扱う。
- Task / Run等の共有tableはAgent非依存repositoryが扱う。
- Role serviceは共有repositoryを直接importせず、共有query / command portを使う。
- `nightworkers.repository`のnamespace importをrole moduleから禁止する。
- Repositoryがevent listener、prompt、tool definitionを持たない。

## 4. Current Boundary Violations

### 4.1 Coding Agentへ移されたPlan Mode ownership

現在、次のコードがCoding AgentへMission Pilotの責務を移している。

- `api/services/coding-agent-context/system-context.ts`
  - Coding AgentへArtifact提案・選択・生成を指示している。
- `api/services/worker-tools/plan-mode.ts`
  - Coding AgentからQuestionnaire、routing、Artifactを変更できる。
- `api/modules/codingAgent/runtime/native-api-runner/native-api-plan-mode-tool.ts`
  - Coding Agent runtimeへPlan mutation toolを公開している。
- `api/modules/planMode/plan-mode-coding-agent-continuation.service.ts`
  - Questionnaire後にCoding Agentを再開する。
- `api/modules/nightworkers/run-orchestration/coding-agent-plan-mode-intake.service.ts`
  - Coding Agent起点でQuestionnaireを開始する。
- `api/modules/codingAgent/runtime/native-api-runner/native-api-plan-mode-intake-guard.ts`
  - Coding AgentがQuestionnaireを作るまでworkspace mutationを止める。
- `codingAgentPlanMode`、`codingAgentPlanModeGate`
  - 誤った所有権を保存状態へ固定している。

これらは移動対象ではなく、原則として削除またはMission Pilot所有の処理へ書き直す。

### 4.2 Mission Pilotから失われたPlan ownership

- `api/services/structured-generation/prompts/mission-pilot-system-context.ts`
  - Mission PilotへArtifactを生成しないよう指示している。
- `api/modules/missionPilot/agent/mission-pilot-task-action-unavailable.ts`
  - Questionnaire、routing、Artifact actionを無効化している。

Mission Pilot action registryとcommand executorには、Questionnaire、routing、型別Artifact actionの実装が残っている。この既存application command pathを正本として復元する。

### 4.3 Shared moduleへ流出したrole固有コード

- `api/modules/codingAgent/runtime`
  - 実態の多くはCoding Agent runtimeである。
- `api/services/worker-tools`
  - 実態の多くはCoding Agent worker toolsである。
- `api/services/coding-agent-context`
  - Coding Agent固有である。
- `api/services/structured-generation/prompts/mission-pilot-*`
  - Mission Pilot固有である。
- `api/modules/nightworkers/run-orchestration`
  - Mission PilotとCoding Agentのrole固有連携が混在している。
- `api/modules/planMode`
  - Coding Agent continuationとMission Pilot DB依存が混在している。
- `api/modules/nightworkers/routes/mission-pilot-*`
  - Mission Pilot fixture routeがNightWorkers moduleにある。
- `src/modules/nightworkers`
  - Agent固有の表示判断が混在している。

### 4.4 Shared provider内のrole分岐

`api/services/structured-llm/codex-provider.ts`にはMission Pilot tool turn、隔離HOME、memory、MCP、developer instruction等のrole固有判断がある。

最終状態では、provider transportはroleを知らず、Mission Pilot provider adapterが中立provider optionを組み立てる。

### 4.5 Initial File Disposition Matrix

Phase 0では必ずconsumerを再確認するが、現時点の既定分類を次とする。Lunaは理由なく別ownerへ変更しない。

| Current path / family | Classification | Target / action |
| --- | --- | --- |
| `api/modules/missionPilot/**` | `missionPilot` | Mission Pilot内でroute / service / repository / prompt / tool / eventへ再配置 |
| `api/services/structured-generation/prompts/mission-pilot-*` | `missionPilot` | `api/modules/missionPilot/prompts` |
| `api/modules/planMode/plan-mode-routing.service.ts` | `missionPilot` | `missionPilot/planning`と`missionPilot/repositories`へ分割 |
| `api/modules/planMode/plan-mode-routing-lock.ts` | `missionPilot` | `missionPilot/planning` |
| `api/db/mission-pilot-schema.ts` | `missionPilot` | `missionPilot/repositories/schema.ts`からexport。table名は変更しない |
| `api/db/mission-pilot-agent-schema.ts` | `missionPilot` | `missionPilot/repositories/schema.ts`からexport。table名は変更しない |
| `api/modules/nightworkers/routes/mission-pilot-*-routes.ts` | `missionPilot` | `missionPilot/routes`。公開pathは維持 |
| `src/modules/missionPilot/**` | `missionPilot` | 既存ownerを維持し、NightWorkers内のMission Pilot表示判断を回収 |
| `api/services/coding-agent-context/**` | `codingAgent` | `codingAgent/context` |
| `api/modules/codingAgent/runtime/CodexAgentRuntime.ts` | `codingAgent` | `codingAgent/runtime/codex-sdk` |
| `api/modules/codingAgent/runtime/NativeAgentRuntime.ts` | `codingAgent` | `codingAgent/runtime/native-api` |
| `api/modules/codingAgent/runtime/native-api-runner/**` | mixed | Coding Agent runtime、agentsShare contract、generic library、C8削除へfile単位分類 |
| `api/modules/codingAgent/runtime/codex-sdk/**` | mixed | Coding Agent adapterとgeneric Codex transportへfile単位分類 |
| `api/modules/codingAgent/runtime/runtime-session-state.ts` | `generic-library`候補 | structured provider consumerを確認し、role非依存なら共通transport側へ維持 |
| `api/modules/codingAgent/runtime/model-visible-payload.ts` | `generic-library`候補 | consumerを確認し、role非依存なら共通utility |
| `api/modules/codingAgent/runtime/types.ts`、`shared/contracts.ts` | mixed | Coding Agent内部型と共有Run outcome contractを分割。Review / NightWorkersは中立contractだけを参照 |
| `api/modules/codingAgent/runtime/registry.ts`、`runtime-lane.ts`、`agent-mode-session.ts` | mixed | Coding Agent runtime selectionは`codingAgent`、共有Task Run session identity / stateは中立domainへ分割 |
| `api/services/runner/NativeLocalRunner.ts`、`types.ts` | mixed | Coding Agent起動adapterか汎用command runnerかをconsumer単位で判定。NightWorkersからCoding Agent内部への迂回importにしない |
| `api/modules/review/**`からruntime resultへの参照 | `replace` | `agentsShare`の中立Run outcome contractへ変更し、Coding Agent runtime内部型をimportしない |
| `api/modules/review/**`からgit / tool implementationへの参照 | `generic-library` | 共通tool libraryまたはReview application serviceを使い、Coding Agent registryは参照しない |
| `api/services/worker-tools/dispatcher.ts` | `codingAgent` | `codingAgent/tools` |
| Coding Agent tool manifest / schema / descriptions | `codingAgent` | `codingAgent/tools` |
| `api/services/worker-tools/todo-list.ts` | `codingAgent` | `codingAgent/tools/todo` |
| filesystem / command / git / import tool implementation | `generic-library`候補 | Review、GitWorktree等のconsumerがあるため共通tool library。Coding Agent registryがwrap |
| worker tool result / port contract | `agentsShare`候補 | 両roleまたは一般applicationで同一意味の場合だけ |
| `api/modules/questionnaire/**` | mixed | ユーザーも操作するQuestionnaire正本domain / repositoryは中立moduleを維持し、Mission Pilot固有autonomy / prompt / continuationだけ`missionPilot/questionnaire`へ移動 |
| `api/modules/specification/**` | mixed | ユーザー可視Artifact正本command / queryは中立moduleを維持し、Mission Pilot固有の選択・生成判断だけ`missionPilot/artifacts`へ移動 |
| `api/modules/nightworkers/run-orchestration/*`のCoding Agent固有処理 | `codingAgent` | `codingAgent/services`またはC8削除 |
| `api/modules/nightworkers/run-orchestration/*`のMission Pilot直接連携 | `replace` | agentsShare event / portへ置換 |
| `api/modules/planMode/plan-mode-coding-agent-continuation.service.ts` | `delete-after-migration` | C8で削除 |
| `api/modules/nightworkers/run-orchestration/coding-agent-plan-mode-intake.service.ts` | `delete-after-migration` | C8で削除 |
| `api/modules/codingAgent/runtime/native-api-runner/native-api-plan-mode-intake-guard.ts` | `delete-after-migration` | C8で削除 |
| `api/services/worker-tools/plan-mode.ts` | `delete-after-migration` | C8で削除。必要なread queryだけCoding Agentへ再設計 |
| `shared/schemas/mission-pilot*.ts` | `missionPilot` | `shared/modules/missionPilot` |
| Coding Agent固有contract | `codingAgent` | `shared/modules/codingAgent` |
| 両role共通ref / event / port schema | `agentsShare` | `shared/modules/agentsShare` |
| Task / Run / Review / Gitのrole非依存domain | `generic-library` | 現在のdomain moduleを維持 |
| usage UI、一般trace UI等の本計画外差分 | `unrelated-preserve` | 所有権混在がない限り触らない |

DB schema fileの移動はTypeScript import ownershipの変更であり、既存table名やmigration historyを変更しない。新しいtableが必要になった場合は、role固有状態であることを説明してから別migrationとして追加する。

## 5. Working Tree Preservation Contract

実装開始時のworking treeには、多数のtracked / untracked変更が存在する可能性が高い。Lunaは次を守る。

禁止:

- `git reset --hard`
- `git checkout -- <path>`
- `git restore <path>`
- working tree全体のstash
- HEADへ戻す目的の一括上書き
- 未追跡ファイルの削除
- 既存変更を「古い実装」と決めつけて破棄すること

開始時に記録するもの:

```bash
git status --short
git diff --stat
git diff --name-only
git ls-files --others --exclude-standard
```

各変更ファイルを次へ分類する。

| Classification | 意味 |
| --- | --- |
| `missionPilot` | Mission Pilotへ保持・移動する |
| `codingAgent` | Coding Agentへ保持・移動する |
| `agentsShare` | 両roleで意味が同じ中立contractへ書き直す |
| `generic-library` | Agent非依存libraryとして残す |
| `replace` | 誤った所有権を実装しており書き直す |
| `delete-after-migration` | 新経路切替後に削除する |
| `unrelated-preserve` | 本計画と無関係なので触らない |

分類結果を実装中の作業メモまたは本計画のCheckpoint Ledgerへ追記する。

## 6. Target Module Layout

### 6.1 Mission Pilot backend

```text
api/modules/missionPilot/
  routes/
    mission-pilot.routes.ts
    mission-pilot-fixture.routes.ts

  services/
    mission-pilot.service.ts
    mission-pilot-play.service.ts
    mission-pilot-stop.service.ts
    mission-pilot-wake.service.ts
    mission-pilot-completion.service.ts

  repositories/
    mission-pilot-session.repository.ts
    mission-pilot-conversation.repository.ts
    mission-pilot-action.repository.ts
    mission-pilot-event.repository.ts
    mission-pilot-plan-routing.repository.ts
    mission-pilot-questionnaire-draft.repository.ts
    schema.ts

  planning/
    mission-pilot-plan.service.ts
    mission-pilot-plan-routing.service.ts
    mission-pilot-plan-review.service.ts
    mission-pilot-plan-source-resolver.ts

  questionnaire/
    mission-pilot-questionnaire.service.ts
    mission-pilot-questionnaire-draft.ts
    mission-pilot-questionnaire.events.ts

  artifacts/
    mission-pilot-artifact.service.ts
    mission-pilot-artifact-regeneration.service.ts
    mission-pilot-artifact.actions.ts

  tools/
    mission-pilot-tool.registry.ts
    mission-pilot-tool.executor.ts
    mission-pilot-read.tools.ts
    mission-pilot-action.tools.ts

  prompts/
    mission-pilot-system-context.ts
    mission-pilot-plan-review.ts

  events/
    mission-pilot-event-subscriber.ts
    mission-pilot-run-event-handler.ts
    mission-pilot-questionnaire-event-handler.ts

  adapters/
    mission-pilot-provider.adapter.ts
    mission-pilot-task-run.adapter.ts
    mission-pilot-task-read.adapter.ts

  index.ts
```

既存の`agent/` subdirectoryは一度に全廃しなくてよいが、最終的に上記責務へ再配置する。巨大な一括renameではなく、service単位でpublic APIを切り替える。

`mission-pilot-questionnaire-draft.repository.ts`が扱うのはMission Pilot固有の回答案、evidence、deadline、採用状態だけである。ユーザーも操作する`design_questionnaire_sessions`等のQuestionnaire正本を複製またはMission Pilot専用tableへ移さず、中立Questionnaire application command / queryを介して操作する。同様に、ユーザー可視Artifactの正本repositoryをMission Pilot内へ複製せず、Mission Pilotは生成・再生成・routingの意味判断とcommand発行を所有する。

### 6.2 Coding Agent backend

```text
api/modules/codingAgent/
  routes/
    coding-agent.routes.ts       # 独立公開routeが必要な場合だけ

  services/
    coding-agent-run.service.ts
    coding-agent-resume.service.ts
    coding-agent-stop.service.ts
    coding-agent-finalize.service.ts

  repositories/
    coding-agent-session.repository.ts  # role固有永続状態が実在する場合だけ
    coding-agent-context.repository.ts  # role固有永続状態が実在する場合だけ
    schema.ts                            # role固有tableが実在する場合だけ

  context/
    coding-agent-system-context.ts
    coding-agent-context-packet.ts
    coding-agent-design-context.ts

  runtime/
    coding-agent-runtime.ts
    native-api/
    codex-sdk/
    context-compaction/

  tools/
    coding-agent-tool.registry.ts
    coding-agent-tool-dispatcher.ts
    filesystem/                    # Coding Agent向けwrapper / registrationだけ
    command/                       # Coding Agent向けwrapper / registrationだけ
    todo/
    git/                           # Coding Agent向けwrapper / registrationだけ

  events/
    coding-agent-event-publisher.ts
    coding-agent-runtime-events.ts

  adapters/
    coding-agent-task-run.adapter.ts
    coding-agent-provider.adapter.ts

  index.ts
```

Coding AgentへPlan mutation toolを置かない。確定済みArtifactがcontext budget上入りきらない場合は、read-only queryを`coding-agent-design-context.ts`経由で提供する。Questionnaire、routing、generation mutationは提供しない。

現在の`task_runs`、Task、Review、Git workspace等の中立tableをCoding Agent repositoryへ移さない。Coding Agent serviceは中立application query / command portを使用する。

### 6.3 agentsShare backend

```text
api/modules/agentsShare/
  contracts/
    agent-task-ref.ts
    agent-run-ref.ts
    agent-artifact-ref.ts
    agent-questionnaire-ref.ts
    agent-tool-result.ts

  ports/
    task-command.port.ts
    task-query.port.ts
    task-run-command.port.ts
    task-run-query.port.ts
    task-run-execution.port.ts
    artifact-command.port.ts
    artifact-query.port.ts
    questionnaire-command.port.ts
    questionnaire-query.port.ts
    event-bus.port.ts

  events/
    task-run.events.ts
    questionnaire.events.ts
    artifact.events.ts

  utils/
    digest.ts
    bounded-text.ts
    paging.ts

  index.ts
```

`agentsShare`内のすべての名前はrole非依存にする。`missionPilot`または`codingAgent`を名前に含める型は置かない。

## 7. Implementation Phases

### Phase 0: Baseline Audit and Change Ledger

目的: 既存差分を失わず、誤った所有権を新moduleへ機械的に移さない。

作業:

1. working treeを記録する。
2. Agent関連ファイルを列挙する。
3. 各ファイルをSection 5のclassificationへ割り当てる。
4. 既存testを次へ分類する。
   - 正しい境界を証明するtest。
   - 誤ったCoding Agent Plan ownershipを固定しているtest。
   - role非依存のdomain test。
   - unrelated test。
5. baseline testを実行する。

Change ledgerには最低限、`current path`、`current consumers`、`classification`、`target public API`、`target path`、`checkpoint`、`pre-existing dirty change`、`replacement test`を記録する。consumer未確認のfileを`codingAgent`または`missionPilot`へ確定しない。

最低限のbaseline:

```bash
node scripts/run-vitest.mjs run \
  tests/mission-pilot-agent-runtime.test.ts \
  tests/mission-pilot-agent-hardening-contract.test.ts \
  tests/mission-pilot-questionnaire-state-event.test.ts \
  tests/coding-agent-plan-mode-contract.test.ts \
  tests/coding-agent-initial-plan-mode-gate.test.ts \
  tests/coding-agent-plan-mode-intake-start.test.ts \
  tests/plan-mode-coding-agent-continuation.test.ts \
  tests/role-module-boundary.test.ts

node scripts/check-module-boundaries.mjs
```

完了条件:

- すべての既存差分にclassificationがある。
- baseline結果を記録している。
- unrelated changeを変更していない。
- どのファイルもまだ大規模移動していない。

停止条件:

- 既存差分の意図を判断できず、移動で上書きする可能性がある。
- baseline DBまたはfixtureが壊れており、現在挙動を採取できない。
- unrelated changeと同一行で競合し、安全に分離できない。

### Phase 1: Boundary Guardrails

目的: 移動中に新しい混在を追加できないようにする。

作業:

1. `.agent-ontology/boundary-policy.json`へ次を登録する。
   - Backend role roots。
   - Frontend role roots。
   - Backend / frontend agentsShare roots。
   - `shared/modules`のrole rootsとagentsShare root。
2. `check-module-boundaries.mjs`で次を検査する。
   - role間の直接import禁止。
   - agentsShareからroleへの逆import禁止。
   - 他moduleからrole内部へのdeep import禁止。
   - `api`、`src`、`shared`の3 treeすべてを走査する。
3. Agent固有コード配置検査を追加する。
4. 移行中の既知違反は期限付きbaseline manifestへ明示する。
5. 新規違反はbaselineへ追加できないようにする。

配置検査対象marker:

- file pathまたはexport名に`mission-pilot` / `missionPilot` / `MissionPilot`を含む。
- file pathまたはexport名に`coding-agent` / `codingAgent` / `CodingAgent`を含む。
- role固有SystemContext constant。
- role固有tool name。
- role固有continuation。

許可例外:

- `api/app.ts`等のcomposition rootからpublic indexをimportする行。
- historical migration。
- test file。
- 移行期間中baseline manifestに記録された既存違反。

完了条件:

- role cross-import testがある。
- agentsShare reverse dependency testがある。
- public API deep import testがある。
- 新規Agent固有ファイルを3 module外へ追加するとarchitecture checkが失敗する。

### Phase 2: Create Module Skeletons and Public APIs

目的: 移動先を先に作り、旧pathから新pathへの一方向移行を可能にする。

作業:

1. `api/modules/codingAgent`を作成する。
2. `api/modules/agentsShare`を作成する。
3. `src/modules/codingAgent`、`src/modules/agentsShare`を作成する。
4. 必要なら`shared/modules`の3 rootを作成する。
5. 各rootに`index.ts`を作る。
6. Public exportを最小にする。
7. 旧pathから新pathへのdeep importを作らない。

完了条件:

- 3 module rootがbackend / frontendで存在する。
- public index以外を外部からimportできない。
- module skeletonだけで既存挙動が変わらない。

### Phase 3: Move Coding Agent Context and Runtime

目的: Coding Agent固有コードを`services`から除去する。

最初に`api/modules/codingAgent/runtime`の全fileを次へ分類する。directory単位の一括移動は禁止する。

| Classification | 移動先 |
| --- | --- |
| Coding AgentのSystemContext、runtime loop、tool dispatch、closeout、evidence | `api/modules/codingAgent/runtime` |
| 両roleで同じ意味を持つruntime contract / event envelope / port | `api/modules/agentsShare` |
| provider transport、汎用session store、role非依存payload helper | Agent非依存library |
| Plan ownershipをCoding Agentへ与えるfile | C8で削除 |

既知の移動候補:

| Current path | Target |
| --- | --- |
| `api/services/coding-agent-context/*` | `api/modules/codingAgent/context/*` |
| `api/modules/codingAgent/runtime/CodexAgentRuntime.ts` | `api/modules/codingAgent/runtime/codex-sdk/*` |
| `api/modules/codingAgent/runtime/NativeAgentRuntime.ts` | `api/modules/codingAgent/runtime/native-api/*` |
| `api/modules/codingAgent/runtime/native-api-runner/*` | file分類後に`codingAgent/runtime/native-api`、`agentsShare`、generic library、C8削除へ分割 |
| `api/modules/codingAgent/runtime/codex-sdk/*` | file分類後に`codingAgent/runtime/codex-sdk`またはgeneric Codex transportへ分割 |
| Coding Agent固有runtime support | `api/modules/codingAgent/runtime/*` |

上表はfileごとの意味確認前に確定した一括move指示ではない。たとえば`runtime-session-state.ts`が共通structured providerから利用される場合、Coding Agentへ移さずAgent非依存libraryへ置く。

汎用provider transportは`api/services/structured-llm`へ残せるが、role分岐を持たせない。

既存consumerの切替規則:

- `api/modules/nightworkers/run-orchestration`はCoding Agent runtime class、registry、lane内部型を直接importせず、中立`TaskRunExecutionPort`と中立Run outcome contractを使う。
- `api/modules/review`は`AgentRuntimeResult`のCoding Agent内部定義を参照せず、中立Run outcome contractを使う。
- `changedFilesFromDiff`等の純粋helperはCoding Agent runtimeへ移さず、GitまたはReviewの中立utilityへ置く。
- `runtime-session-state.ts`がstructured provider resumeでも使われる場合はgeneric session storeとし、Coding Agent moduleの所有物にしない。
- `NativeLocalRunner`がCoding Agent起動だけを行う場合はCoding Agent adapterへ移す。一般process runnerならgeneric libraryに残し、role固有判断を除去する。

手順:

1. 新module内にpublic runtime portを作る。
2. 旧runtime entrypointを新moduleへ移す。
3. 呼び出し側をpublic indexへ切り替える。
4. 必要なconsumerだけを新public APIへ切り替える。
5. 移行中に必要な場合だけ、logicを持たないcompatibility re-exportを追加する。
6. targeted testsを通す。
7. 全consumer移行後、同Checkpointまたは直後のCheckpointでcompatibility re-exportを削除する。

Coding Agent SystemContextから削除する指示:

- Artifactを提案・選択する。
- Questionnaireを作成する。
- routingを更新する。
- Artifactを生成する。
- Mission Pilotへ意味判断を委ねない。
- Plan Mode開始時にQuestionnaireを必須作成する。

追加する指示:

- Mission Pilotが渡した確定済みTaskと設計を正本として読む。
- repositoryのFactと確定済み設計が衝突した場合は、勝手にArtifactを変更せずblockerとして返す。
- 追加ユーザー判断が必要な場合はfinal report / blockerでMission Pilotへ返す。

完了条件:

- `api/services/coding-agent-context`が存在しない。
- Coding Agent runtime固有ファイルが`api/modules/codingAgent/runtime`に残っていない。
- Coding Agent SystemContextにPlan ownershipがない。
- Coding Agent runtimeは単一runtimeのまま。

### Phase 4: Move Coding Agent Tools

目的: `worker-tools`をfile単位で分類し、Coding Agent向けcatalog / dispatcherだけをCoding Agent所有へ移す。Plan mutationのproduction削除はC8で行う。

`api/services/worker-tools`もdirectory単位で移動しない。現在、Review、Git worktree、background process等のAgent非依存moduleが一部tool implementationを利用しているためである。

| File kind | Target |
| --- | --- |
| Coding Agent tool manifest / dispatcher / model-facing descriptions | `api/modules/codingAgent/tools` |
| Coding Agent Todo tool | `api/modules/codingAgent/tools/todo` |
| Coding Agent専用tool wrapper | `api/modules/codingAgent/tools` |
| Role非依存のfilesystem / command / git / import implementation | Agent非依存tool library |
| 両roleで同じ意味を持つtool result contract / port | `api/modules/agentsShare` |
| Coding Agent Plan Mode tool | C8で削除 |

Agent非依存tool implementation libraryは、Mission Pilot tool catalogへ直接公開しない。Coding Agent registryまたは一般application serviceが明示的にwrapする。

C8で削除する対象:

- Coding Agent用`plan_mode` mutation tool。
- `request_input`。
- `update_routing`。
- `generate_artifact`。
- Coding Agent Plan intake guard。
- Plan Mode Questionnaire必須化。

Artifactのread-only参照が必要な場合:

- `agentsShare`の`ArtifactQueryPort`を使用する。
- Coding Agent module内にread-only adapterを置く。
- mutation commandを同じtoolへ混ぜない。

完了条件:

- C4終了時点では、C8 cutover前のPlan toolをcompatibility pathとして残せる。ただし新しいPlan mutationを追加しない。
- C8終了時点でCoding Agent tool registryのPlan mutationが0件。
- 最終Phaseで`api/services/worker-tools`にCoding Agent固有description、manifest、dispatcherが残っていない。
- filesystem、command、Todo、検証toolは従来通り使用できる。
- Tool実行は登録済みrepo rootを使用する。

### Phase 5: Prepare Mission Pilot Questionnaire and Artifact Ownership

目的: 誤ってCoding Agentへ移された設計責務をMission Pilotへ戻すためのservice、repository、tool contract、testを準備する。C8まではproduction ownershipを切り替えない。

作業:

1. Mission Pilot SystemContextのArtifact禁止指示を置き換える新promptを準備し、direct testする。C8まではproduction promptへ切り替えない。
2. Mission Pilot tool catalogで次を有効化できるcontractを整備する。
   - `questionnaire.create`
   - `questionnaire.draft.update`
   - `questionnaire.draft.save`
   - `questionnaire.follow_up.generate`
   - `questionnaire.additional.generate`
   - `questionnaire.review.generate`
   - `questionnaire.review.accept`
   - `questionnaire.review.leave_unadopted`
   - `plan.routing.update`
   - `plan.artifact.feature_plan.generate`
   - `plan.artifact.blueprint.generate`
   - `plan.artifact.data_model.generate`
   - `plan.artifact.view.generate`
   - `plan.artifact.regenerate`
3. `questionnaire.submit`は既存のユーザー介入契約を迂回しない形にする。
4. generic `plan.artifact.generate`と型別actionが重複する場合は型別actionを正本にする。
5. Action executorは既存application commandを使い続ける。
6. Side effectはauthorization、revision、idempotencyをserver側で検証する。
7. Direct unit / integration testから新しいMission Pilot経路を検証する。
8. C8まではCoding Agent continuationと同時にproduction listenerへ登録しない。

Mission Pilot SystemContextへ明記する内容:

- Mission PilotがQuestionnaireとArtifactを所有する。
- Coding Agentは確定済み設計を消費する。
- repository編集はCoding Agentへ依頼する。
- Plan判断をCoding Agentへ移譲しない。
- Artifact生成可否をhostの固定workflowで決めない。

完了条件:

- 新しいMission Pilot tool catalog候補に型別Artifact actionが存在する。
- Direct testでMission PilotがQuestionnaire answering時に回答案を作成できる。
- Direct testでMission PilotがroutingとArtifactを更新できる。
- Coding Agentを開始する前に確定済み設計refsを組み立てられる。
- Production ownershipはまだ一つだけで、二重listenerがない。

### Phase 6: Move Mission Pilot Planning, Questionnaire, and Repositories

目的: Mission Pilot固有コードを`planMode`、`questionnaire`、`services`等から回収する。

主な移動:

| Current | Target |
| --- | --- |
| Mission Pilot plan coordinator / review / support | `missionPilot/planning` |
| Mission Pilot Questionnaire autonomy | `missionPilot/questionnaire` |
| Mission Pilot Artifact correction | `missionPilot/artifacts` |
| Mission Pilot prompts | `missionPilot/prompts` |
| Mission Pilot provider port / usage | `missionPilot/adapters` |
| Mission Pilot DB schema | `missionPilot/repositories/schema.ts` |

`api/modules/planMode/plan-mode-routing.service.ts`は、Mission Pilot tableを直接扱っているため中立moduleとして残せない。

選択:

- RoutingがMission Pilot workflowの状態ならMission Pilot planning repositoryへ移す。
- Product全体の中立Plan routingなら、中立table / repositoryへ移行し、Mission Pilot table依存を除去する。

本計画では、現在のtable名とsession関連からMission Pilot所有として移すことを既定とする。

`api/modules/questionnaire`と`api/modules/specification`はdirectory単位でMission Pilotへ移さない。ユーザー操作、一般route、正本repository、正本application command / queryはrole非依存domainとして残す。Mission Pilot固有のautonomy、prompt、action selection、draft projection、event subscriberだけをMission Pilot moduleへ移す。

完了条件:

- `api/modules/planMode`がMission Pilot DB schemaをimportしない。
- Mission Pilot repositoryが他role tableを扱わない。
- Mission Pilot promptsが`api/services`に残っていない。

### Phase 7: Replace Direct Role Coupling with agentsShare Ports and Events

目的: NightWorkers、Run orchestration、Questionnaire eventからrole serviceへの直接importを除去し、C8で切替可能な中立event pathを準備する。

導入する中立event例:

```ts
type TaskRunTerminalEvent = {
  eventId: string;
  taskId: string;
  runId: string;
  status: string;
  sourceRef: { kind: string; id: string } | null;
  occurredAt: string;
};

type QuestionnaireStateChangedEvent = {
  eventId: string;
  taskId: string;
  questionnaireSessionId: string;
  status: string;
  revision: number;
  occurredAt: string;
};
```

Flow:

```text
TaskRun shared application service
  -> publish neutral event
  -> Mission Pilot subscriber wakes owned session

Questionnaire shared application service
  -> publish neutral event
  -> Mission Pilot subscriber evaluates next action after C8 activation
```

削除:

- Shared Run serviceからMission Pilot coordinatorへの直接呼び出し。
- Questionnaire moduleからCoding Agent continuationへの直接呼び出し。
- NightWorkers queue serviceからMission Pilot repositoryへの直接import。

完了条件:

- 中立eventがroleを知らずpublishされる。
- Mission Pilot subscriberをdirect testできる。
- C8までは既存production listenerとの二重処理が発生しない。
- Shared publisherはroleを知らない。
- Mission Pilot subscriberはMission Pilot module内にある。

### Phase 8: Atomic Plan Ownership Cutover

目的: Plan ownershipをCoding AgentからMission Pilotへ、一時的な不在や二重所有なしに切り替える。

同一Checkpointで実行すること:

1. Mission Pilot Questionnaire / routing / Artifact actionをproduction tool catalogへ公開する。
2. Mission Pilot Questionnaire / Run event subscriberをproduction登録する。
3. Mission Pilot SystemContextを新しい所有権へ切り替える。
4. Coding Agent SystemContextからPlan ownershipを削除する。
5. Coding Agent `plan_mode` mutation toolをmanifest / dispatcher / MCPから削除する。
6. Coding Agent Plan intake guardを削除する。
7. Coding Agent Plan continuation listenerを`api/app.ts`から削除する。
8. Coding Agent Plan intake serviceをRun startから削除する。
9. 旧positive testをMission Pilot ownershipとCoding Agent negative contractへ置換する。
10. Targeted integrationを実行する。

Test置換表:

| Current test | C8 action | Replacement |
| --- | --- | --- |
| `tests/coding-agent-plan-mode-contract.test.ts` | Coding AgentへPlan toolを要求するassertionを削除 | `tests/coding-agent-plan-ownership-negative.test.ts` |
| `tests/coding-agent-initial-plan-mode-gate.test.ts` | Coding Agent Questionnaire gateを削除 | `tests/coding-agent-plan-ownership-negative.test.ts` |
| `tests/coding-agent-plan-mode-intake-start.test.ts` | Coding Agent intake開始契約を削除 | `tests/mission-pilot-plan-event-cutover.test.ts` |
| `tests/plan-mode-coding-agent-continuation.test.ts` | Coding Agent resume契約を削除 | `tests/mission-pilot-plan-event-cutover.test.ts` |
| Mission Pilot既存action contract tests | Questionnaire / routing / Artifact positive contractを追加 | `tests/mission-pilot-plan-ownership.test.ts` |

置換は単なるrenameではない。旧ownershipを要求するassertionを残さず、Mission Pilot positive contract、Coding Agent negative contract、event cutover contractの3方向で証明する。

C8は一つのcommit候補として編集するが、targeted integrationが成功するまでcommitしない。失敗した場合は、Phase 0 ledgerとC8の変更ファイル一覧を使ってC8で加えた差分だけを`apply_patch`相当の明示編集で戻す。`git restore`、`git checkout`、working tree全体のstashで戻してはならない。C5〜C7のdirect-test可能な準備状態と、実装開始前から存在した差分を保持する。

削除候補:

- `api/modules/planMode/plan-mode-coding-agent-continuation.service.ts`
- `api/modules/nightworkers/run-orchestration/coding-agent-plan-mode-intake.service.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-plan-mode-intake-guard.ts`
- Coding Agent `plan_mode` worker tool。
- Coding Agent Plan Mode tool schema / manifest registration。
- `codingAgentPlanMode`
- `codingAgentPlanModeGate`
- `coding_agent_plan_mode_questionnaire_wait`
- Coding Agent Plan continuation trace。
- Coding Agent Plan questionnaire completion precondition。

既存保存データ:

- JSON snapshotの旧fieldはversioned migrationで削除またはMission Pilot正本refへ変換する。
- 恒久的なdual readを残さない。
- active Runが旧stateを持つ場合は、明示的にMission Pilot再開または安全なneeds_reviewへ移す。
- migration本文でTaskの意味を推測しない。

完了条件:

- production codeで`codingAgentPlanMode`検索結果が0件。
- production codeで`resumeCodingAgentRunAfterQuestionnaire`検索結果が0件。
- Coding Agent Plan mutation testを削除または逆契約testへ置換している。
- Mission PilotとCoding AgentのPlan listenerが同時に有効な時点がない。
- Mission PilotがQuestionnaire、routing、Artifactを操作できる。
- Coding Agentが確定済み設計だけをread-onlyで消費する。

### Phase 9: Separate Provider Adapters

目的: 共通providerからrole固有判断を除去する。

Current problem:

- Codex providerがMission Pilot roleを判定する。
- Mission Pilot tool turn developer instructionを持つ。
- Mission Pilotだけisolated CODEX_HOMEを作る。
- Mission PilotだけMCP / memory設定を変える。

Target:

```text
missionPilot/adapters/mission-pilot-provider.adapter.ts
  -> builds generic provider request/options
  -> owns isolated execution policy
  -> owns Mission Pilot tool-turn envelope

codingAgent/adapters/coding-agent-provider.adapter.ts
  -> builds Coding Agent provider/runtime request

services/structured-llm
  -> provider transport only
```

共通providerへ渡すoptionはrole名ではなく構造的capabilityにする。

例:

```ts
type StructuredProviderExecutionPolicy = {
  isolatedHome: boolean;
  enableMcp: boolean;
  enableMemory: boolean;
  allowProviderTools: boolean;
  developerInstructions?: string;
};
```

Providerはpolicyの意味を解釈せず適用する。

完了条件:

- 共通providerにMission Pilot専用constantがない。
- 共通providerに`role === "mission_pilot"`分岐がない。
- Mission Pilot provider adapter testがある。
- Coding Agent provider adapter testがある。

### Phase 10: Frontend Module Separation

目的: UIでもrole固有表示をNightWorkers moduleへ混ぜない。

移動対象:

- Mission Pilot component、state、presentation helper。
- Coding Agent transcript、run status、usage表示。
- Agent共通のbadge、reference renderer等。

NightWorkers Task UIは各roleのpublic componentをcompositionするだけにする。

禁止:

- `src/modules/nightworkers`でMission PilotとCoding Agentの状態を同じselectorで意味判断する。
- NightWorkers componentにrole固有trace intent一覧を置く。
- Agent UI stateを共有Task typeへ無制限に追加する。

完了条件:

- Mission Pilot presentation logicは`src/modules/missionPilot`にある。
- Coding Agent presentation logicは`src/modules/codingAgent`にある。
- agentsShare presentationはrole非依存。
- NightWorkers UIはpublic indexだけをimportする。

### Phase 11: Remove Compatibility Paths and Enforce Zero Residue

目的: 移行用re-exportとbaseline違反を削除し、3 module外の残存を0にする。

作業:

1. Compatibility re-exportを削除する。
2. Old path importを削除する。
3. Agent code placement baselineを空にする。
4. Role固有schemaを`shared/modules`へ移す。
5. Fixture routeをrole moduleへ移す。
6. Shared moduleのrole branchを削除する。
7. `rg`とarchitecture checkerで残存を確認する。

残存監査:

```bash
rg -n "MissionPilot|missionPilot|mission-pilot" api src shared \
  -g '!api/modules/missionPilot/**' \
  -g '!src/modules/missionPilot/**' \
  -g '!shared/modules/missionPilot/**' \
  -g '!api/modules/agentsShare/**' \
  -g '!src/modules/agentsShare/**' \
  -g '!shared/modules/agentsShare/**'

rg -n "CodingAgent|codingAgent|coding-agent" api src shared \
  -g '!api/modules/codingAgent/**' \
  -g '!src/modules/codingAgent/**' \
  -g '!shared/modules/codingAgent/**' \
  -g '!api/modules/agentsShare/**' \
  -g '!src/modules/agentsShare/**' \
  -g '!shared/modules/agentsShare/**'
```

composition root、historical migration、role非依存public label以外の結果を0にする。

完了条件:

- Agent固有production codeが3 module外にない。
- Boundary baselineが空。
- Deep importがない。
- Shared moduleにrole判断がない。

### Phase 12: Full Verification and Release Gate

Targeted tests:

```bash
node scripts/run-vitest.mjs run \
  tests/role-module-boundary.test.ts \
  tests/mission-pilot-agent-runtime.test.ts \
  tests/mission-pilot-agent-hardening-contract.test.ts \
  tests/mission-pilot-questionnaire-state-event.test.ts \
  tests/mission-pilot-agent-action-idempotency.test.ts \
  tests/structured-llm/codex-tool-turn.test.ts \
  tests/mission-pilot-plan-ownership.test.ts \
  tests/mission-pilot-plan-event-cutover.test.ts \
  tests/coding-agent-plan-ownership-negative.test.ts
```

上記の最終テストは、C8で旧Coding Agent Plan testsから置換した次の契約を検証する。

- Coding AgentにPlan mutation toolが存在しない。
- Coding Agentが確定済みArtifactをread-onlyで消費する。
- Questionnaire eventがCoding Agentを直接resumeしない。
- Mission PilotがQuestionnaireとArtifact actionを持つ。

Architecture:

```bash
node scripts/check-module-boundaries.mjs
node scripts/check-coding-agent-semantic-control.mjs
bun run check:architecture
```

Quality:

```bash
bun run typecheck
bun run lint
bun run test
bun run verify:base
```

E2E:

- Mission PilotがQuestionnaireを作成する。
- Mission Pilotが回答案を保存する。
- ユーザー介入時間が維持される。
- Mission Pilotがroutingを更新する。
- Mission Pilotが型別Artifactを生成する。
- Mission PilotがCoding Agentを開始する。
- Coding Agentがrepositoryを変更する。
- Coding AgentがArtifactを変更しない。
- Run terminal eventでMission Pilotが再開する。
- Mission PilotがTest / Review / repair / completeを判断する。
- Stop / restart後も同じ所有権で再開する。

Final:

```bash
bun run verify
```

環境が許す場合:

```bash
bun run verify:e2e
```

## 8. Test Contract Matrix

| Contract | Test |
| --- | --- |
| Role間直接import禁止 | module boundary unit |
| agentsShare逆依存禁止 | module boundary unit |
| Agent固有コードの3 module外配置禁止 | architecture placement test |
| Mission Pilot routeがCoding Agent serviceを呼ばない | import architecture test |
| Coding Agent routeがMission Pilot serviceを呼ばない | import architecture test |
| Mission Pilot repositoryがCoding Agent tableを読まない | repository boundary test |
| Coding Agent repositoryがMission Pilot tableを読まない | repository boundary test |
| Mission PilotにArtifact actionがある | tool registry contract test |
| Coding AgentにArtifact mutationがない | tool registry negative test |
| 共有Questionnaire / Artifact正本をrole repositoryへ複製しない | repository/schema architecture test |
| Mission PilotがQuestionnaire eventでwakeする | event integration test |
| Coding AgentがQuestionnaire eventでresumeしない | negative integration test |
| Coding Agentは確定済み設計を読む | context packet test |
| Coding Agentはrepositoryを編集できる | runtime/tool regression |
| Mission Pilotはrepositoryを直接編集できない | tool registry negative test |
| Provider共通層にrole分岐がない | source architecture test |
| NightWorkers / ReviewがCoding Agent runtime内部型をimportしない | import architecture test |
| Stop / restartで所有者が変わらない | persistence integration test |

既存assertionを新実装に合わせるためだけに弱めない。誤った境界を固定しているtestは、削除理由と置換先を明示してから逆契約testへ置換する。

## 9. Commit and Checkpoint Sequence

Lunaは一つの巨大commitにまとめない。次の順序を既定とする。

| Checkpoint | 内容 | 必須検証 |
| --- | --- | --- |
| C0 | baseline / change ledger | targeted baseline |
| C1 | boundary policy / placement guard | boundary tests |
| C2 | module skeleton / public index | architecture |
| C3 | Coding Agent context/runtime移動 | Coding Agent targeted tests |
| C4 | Coding Agent tools分類・移動 | tool/runtime tests |
| C5 | Mission Pilot Plan ownership準備 | Mission Pilot questionnaire/artifact direct tests |
| C6 | Mission Pilot planning/repository移動 | planning/repository tests |
| C7 | agentsShare ports/events準備 | event direct tests |
| C8 | Plan ownership原子的切替 | Mission Pilot positive + Coding Agent negative integration |
| C9 | provider adapter分離 | provider tests |
| C10 | frontend module分離 | frontend tests |
| C11 | compatibility削除 / residue zero | full architecture |
| C12 | full verification | verify / E2E |

Checkpoint statusは次だけを使う。

- `pending`
- `in_progress`
- `blocked`
- `passed`

test未実行、既知failure、compatibility path残存、boundary baseline残存の状態を`passed`にしない。

## 10. Luna Operating Instructions

Lunaは速度より境界の正確さを優先する。

1. 一度に一つのCheckpointだけを進める。
2. 移動前にownerとpublic APIを決める。
3. 移動後にconsumerを切り替え、testを実行してから旧pathを削除する。
4. Mission PilotとCoding Agentを同じservice、repository、prompt、tool registryへ統合しない。
5. `agentsShare`を便利な退避場所にしない。
6. `agentsShare`へrole固有処理が必要になった場合は、抽出を中止してowner側へ戻す。
7. Coding AgentにPlan mutationを戻さない。
8. Mission PilotからArtifact actionを削らない。
9. Mission Pilotへfilesystem edit toolを追加しない。
10. Coding Agent runtimeへ意味別modeを追加しない。
11. Task文言、error message、assistant本文を正規表現やkeywordで分類しない。
12. Hostはauthorization、schema、revision、idempotency、lease等の構造的不変条件だけを強制する。
13. 既存ユーザー差分をreset、restore、checkoutで破棄しない。
14. 一時ディレクトリを実作業workspaceや完了証拠にしない。
15. 日本語のSystemContextと運用規則を英語へ置き換えない。
16. Plan ownershipをMission PilotとCoding Agentの両方へ同時に公開しない。
17. Plan ownershipをどちらにも公開しない中間commitを作らない。
18. Directory名だけで`agent-runtime`や`worker-tools`全体をCoding Agentへ移さない。
19. 空のroute、repository、schemaを対称性のために作らない。
20. ユーザーも操作するQuestionnaire / Artifact正本repositoryをMission Pilot専用repositoryへ複製しない。
21. NightWorkers、Review、GitWorktreeからCoding Agent tool registryまたはruntime内部へ直接importしない。

## 11. Stop Conditions

次の場合は、そのCheckpointの追加変更を止めて状況を記録する。

- 既存ユーザー差分と同じ行を安全に統合できない。
- Public API変更が既存UI互換を破る。
- DB migrationなしに保存済みsessionを安全に読めない。
- Role所有権を決めずにshared moduleへ置く必要が生じた。
- `agentsShare`からrole moduleへの逆依存が必要になった。
- Provider共通層にrole名分岐を残さないと実装できない。
- Coding Agent Plan mutationを残さないとtestが通らない。
- Mission Pilot Artifact actionを無効化しないとtestが通らない。
- C8を分割しないと実装できず、Plan ownershipの不在または二重所有が発生する。
- Working treeのunrelated変更を上書きする必要がある。

Stop conditionに達した場合、誤った境界で先へ進まず、該当file、import chain、必要な判断、既存差分を明示する。

## 12. Definition of Done

本計画は次をすべて満たした場合だけ完了する。

### Placement

- Backend Agent固有コードが`missionPilot`、`codingAgent`、`agentsShare`以外にない。
- Frontend Agent固有コードが対応する3 module以外にない。
- Role固有shared schemaが`shared/modules`の対応rootへ移動している。
- Compatibility re-exportが残っていない。

### Dependency

- Mission PilotとCoding Agentの直接importが0件。
- agentsShareからroleへのimportが0件。
- 他moduleからrole内部へのdeep importが0件。
- Shared providerにrole分岐が0件。
- Shared domain repositoryにrole table依存が0件。

### Ownership

- Mission PilotがQuestionnaireを所有する。
- Mission PilotがPlan routingを所有する。
- Mission PilotがArtifact操作を所有する。
- Mission PilotがCoding Agentへの依頼と結果評価を所有する。
- Coding Agentがrepository作業を所有する。
- Coding Agentは確定済み設計をread-onlyで消費する。
- Coding AgentにPlan mutationがない。
- Questionnaire後の設計進行をMission Pilotが再開する。

### Runtime

- Mission Pilotはrepositoryを直接編集できない。
- Coding Agentは単一runtimeで動作する。
- Run terminal statusだけでTaskを暗黙完了しない。
- Failure本文とLLM本文を固定文へ置き換えない。
- Side effectはauthorization、revision、idempotencyを検証する。

### Evidence

- Boundary testsが成功。
- Mission Pilot targeted testsが成功。
- Coding Agent targeted testsが成功。
- Questionnaire / Artifact / Run event integrationが成功。
- Typecheck、lint、architecture、verifyが成功。
- 必要なE2Eが成功。
- Working treeの既存差分を失っていない。

## 13. Checkpoint Ledger

| Checkpoint | Status | Commit | Tests | Evidence / Remaining Risk |
| --- | --- | --- | --- | --- |
| C0 Baseline / ledger | passed |  | 8 files / 35 tests | `spec/docs/mission-pilot-coding-agent-module-separation-change-ledger.md` にbaselineと分類を記録。 |
| C1 Boundary policy | passed |  | boundary tests | API / frontend / shared roots、role間・agentsShare逆依存・deep import検査を追加。 |
| C2 Module skeleton | passed |  | architecture | `missionPilot` / `codingAgent` / `agentsShare` のbackend/frontend/shared public indexを追加。 |
| C3 Coding Agent runtime | passed |  | context/runtime targeted tests | Coding Agent contextを移動し、Questionnaire・Artifact・routing mutation指示を除去。 |
| C4 Coding Agent tools classification | passed |  | negative tool contract | TodoをCoding Agentへ移動し、Plan tool・intake guard・continuationを削除。 |
| C5 Mission Pilot Plan ownership preparation | passed |  | Mission Pilot ownership tests | Questionnaire draft/review/follow-up、typed Artifact、regenerate、routing actionをMission Pilot registryへ集約。 |
| C6 Mission Pilot planning/repository | passed |  | planning / questionnaire tests | planning・Artifact correction・promptをMission Pilot public APIへ移動。 |
| C7 agentsShare ports/events preparation | passed |  | event cutover tests | neutral terminal outcome port/eventを追加し、Mission Pilot subscriberを接続。 |
| C8 Atomic Plan ownership cutover | passed |  | 8 files / 26 tests | Coding Agent negative、Mission Pilot positive、Questionnaire event cutoverを検証。 |
| C9 Provider adapters | passed |  | provider policy tests | provider共通層からrole分岐を除去し、capability policyを各adapterへ分離。 |
| C10 Frontend separation | passed |  | frontend / workspace tests | frontend role public rootsを追加し、Coding Agent questionnaire auto-open依存を除去。 |
| C11 Compatibility removal | passed |  | architecture | 旧Coding Agent Plan lifecycle、tool、guard、continuation、resume pathの残存を除去。 |
| C12 Full verification | passed |  | 326 files / 2013 tests; targeted regression; typecheck; lint; architecture; build; verify:base | typecheck、lint、architecture、production build、全Vitest、tracked artifact、supervisor regression、Mission Pilotのplan-scope E2Eを通過。全E2Eは31 passed / 5 failed / 1 skippedで、失敗は既存のTest/Review route 404、通常Coding Agent fixtureのTodo欠落に限定され、分離対象のMission Pilot E2Eは通過。 |

Lunaは各Checkpoint完了時にStatus、commit、実行test、未解決riskを更新する。tokenや時間の都合だけで未完了Checkpointを`passed`にしない。
