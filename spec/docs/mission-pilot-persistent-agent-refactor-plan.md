# Mission Pilot Persistent User-Equivalent Agent Refactor Plan

## Status

- Plan status: `proposed`
- Document created: 2026-07-15
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target scope: Mission Pilotのみ
- Parallelization boundary: Native API runner、Codex runtime、Todo runtime、Supervisor全体のリファクタリングとは独立して進める
- Implementation status: not started

この文書を、Mission Pilotを固定workflowの実行器から、NightWorkers上でユーザーの代わりに判断・操作する永続セッション型エージェントへ移行するための実装計画正本とする。

本計画の原則は次の一文に集約する。

> Mission PilotはユーザーがTask上で見て選べる情報と操作をtoolとして受け取り、自身のLLM判断で次の操作を選ぶ。ホストは権限、安全、永続化、並行実行、入力schemaだけを保証し、Taskの意味や次工程を決めない。

## 1. Purpose

現在のMission Pilotは、Plan、Queue、repository bootstrap、Implementation、Test、Review、closeoutを固定phaseと条件分岐で接続している。そのため、LLMが現在のTaskと成果を読んで次の操作を決める前に、実装側が次工程、再実行、Todo、Test、Review、commitを決めている。

本リファクタリングでは、Mission Pilotを次のエージェントへ置き換える。

1. Mission PilotはTask作成から完了まで一つの論理sessionを維持する。
2. Mission Pilotは、そのTaskで人間のユーザーがUIから実行できる操作を、同じ権限・同じpreconditionで実行できる。
3. Plan Mode、Questionnaire、Artifact選択、Implementation、Test、Review、再実行、完了、archiveなどの選択はMission PilotのLLMが行う。
4. Mission Pilotはcoding agent、Test agent、Review agentの逐次チャットやtool logを追跡しない。
5. Mission Pilotが観測するworker情報は、ユーザーがTask上で確認できる仕様、Artifact、最終報告、terminal status、blocker、検証結果への参照に限定する。
6. 正規表現、keyword、Todo名、phase名、エラー本文の文字列からTaskの意味や次操作を決定しない。
7. System Contextとtool descriptionで判断原則を説明し、意味判断はLLMに残す。

## 2. Locked Product Definition

### 2.1 Mission Pilotの役割

Mission PilotはNightWorkers内部の特権Supervisorではない。Mission Pilotを再生したユーザーの代理として、対象Task上の操作を自動化するAIである。

- Mission Pilotが使える権限は、現在のユーザーが対象Taskで使える権限を上限とする。
- Mission Pilot専用の裏口操作、DB直接更新、UIに存在しない強制遷移を作らない。
- UI操作とMission Pilot toolは同じapplication commandまたは同じdomain serviceを呼び出す。
- UIでconfirmation、scope、push policy、permissionが必要な操作は、Mission Pilotでも同じ条件を満たす。
- Mission Pilotの判断を理由に、filesystem、network、repository、Git、外部serviceの権限を拡張しない。

### 2.2 Mission Pilotが決めること

次はsemantic decisionであり、実装側で決めない。

- Questionnaireの回答。
- Plan Modeで提示された選択肢の採用・不採用。
- どのPlan Artifactを生成・再生成するか。
- 現在のPlanでImplementationへ進めるか。
- repository import/bootstrapが必要か。
- Implementation、Test、Reviewのどれを次に開始するか。
- TestまたはReviewが今回のTaskに必要か。
- workerの最終報告を受けて、再実行、修正、別mode、完了のどれを選ぶか。
- blockerが自己回復可能か、別操作が必要か、ユーザー確認が必要か。
- Taskを完了・archiveするか。
- push policyの範囲内でcommit/pushを実行するか。
- Mission Pilot自身がユーザーへ報告する内容。

### 2.3 ホストが決めてよいこと

次はdeterministic boundaryであり、実装側が強制する。

- tool argumentのschema validation。
- Task、Project、repository、user authorizationの確認。
- optimistic lock、expected revision、lease、idempotency、重複実行防止。
- filesystem、network、Git、external actionのpermissionとapproval。
- timeout、token budget、context compaction、出力上限。
- provider transport failureのretryとfallback。
- session停止、ユーザー停止、Task削除、権限失効の反映。
- action実行前後のFact整合性とtransaction。
- worker Runのterminal status、final report、blockerをtyped read modelへ投影する処理。

ホストはprecondition違反をtool errorとしてMission Pilotへ返す。別の操作を自動選択したり、エラー文から次のphaseへ遷移したりしない。

## 3. Current Architecture Problems

### 3.1 固定phaseがMission Pilotの判断を代行している

現行の`mission-pilot-post-queue-state.ts`は、次のような固定遷移を持つ。

```text
queued
  -> repository_bootstrapping
  -> implementation_starting
  -> implementing
  -> test_preparing
  -> testing
  -> review_preparing
  -> reviewing
  -> closeout_preparing
  -> committing
  -> completing
  -> archived
```

Implementation完了後にTestを開始するか、Test後にReviewを開始するかをLLMは判断していない。これは本計画で廃止する。

### 3.2 repository bootstrapが独立workflowになっている

現行実装はrepository bootstrap専用RunとTodoを作り、そのRunではTodo再計画を拒否する。このためimport完了後に同じMission Pilot会話で現在状態を読み直し、本来のTaskへ続行できない。

repository importは他のUI操作と同じ一つのactionに戻す。import結果を受け取ったMission Pilotが、同じsession内の次turnで次操作を判断する。

### 3.3 workerの状態をMission Pilot固有gateへ変換している

現行実装はopen Todo、diff、ownership、test evidence、review verdict等をMission Pilot固有gateへ変換し、次phaseを決める。

新設計では、これらはTask read modelまたはRun outcomeのFactとしてMission Pilotへ渡す。どのFactをどう評価するかはLLMが決める。ただし権限、revision、side effect成立性はホストが検証する。

### 3.4 Mission Pilotの会話よりworkflow stateが正本になっている

現在はphase、cycle、phase run、correction limitが進行の正本であり、LLM callはphaseごとの部分判断に分断される。

新設計では一つのMission Pilot sessionと、そのsessionに属するMission Pilot自身のconversation/tool historyを正本とする。Taskの進行はMission Pilotが実行したapplication actionの結果として変化する。

## 4. Scope

### 4.1 In scope

- Mission Pilotの永続LLM sessionとconversation管理。
- Mission Pilot専用System Context。
- Task UI相当のread modelとaction tool surface。
- Questionnaire、Plan Mode、Artifact、Queue、Run、Test、Review、closeout、complete、archive操作のMission Pilot tool化。
- coding/Test/Review agentのterminal outcome projection。
- typed Task eventによるMission Pilot wake-up。
- 固定post-Queue phase machineの撤去。
- repository bootstrap専用workflowの撤去。
- Mission Pilot固有Todo projection、Test gate、Review gate、correction transitionの撤去。
- Mission Pilot sessionを維持したrestart/resume/context compaction。
- 既存sessionを同じsession IDのまま新runtimeへ移行するmigration。
- Mission Pilotの判断、tool call、tool result、ユーザー向け報告の監査表示。

### 4.2 Out of scope

- Native API runner自体のtool loopリファクタリング。
- Codex SDK runtime自体のtool loopリファクタリング。
- coding agent内部Todo runtimeの全面変更。
- coding/Test/Review agentの逐次チャット形式変更。
- Plan Artifact generator全体の再設計。
- Questionnaire、Plan Artifact、Review結果のdomain schema全面変更。
- Task UIの全面再設計。
- ユーザーの権限モデル、sandbox、Git approval policyの緩和。
- Mission Pilotが人間ユーザーより強い権限を得る機能。

他領域のリファクタリングが未完了でも、Mission Pilotは既存application serviceと既存persisted Run outcomeをadapter経由で利用して完成できることを必須とする。

## 5. Target Runtime Model

### 5.1 High-level architecture

```text
User plays Mission Pilot
        |
        v
Persistent Mission Pilot Session
  - stable NightWorkers session ID
  - persistent model conversation
  - versioned System Context
  - Mission Pilot tool call history
        |
        +--> Task Read Model Port
        |      - Task / Project state
        |      - current Specification
        |      - Plan artifacts / Questionnaire
        |      - available UI-equivalent actions
        |      - terminal Run outcomes
        |
        +--> Task Action Port
        |      - same application commands as UI
        |      - same authorization / revision / confirmation
        |
        +--> Worker Outcome Port
               - final report
               - blocker / terminal error
               - verification summary / artifact references
               - no worker transcript
```

### 5.2 Agent loop

Mission Pilot runtimeはCodex型の単純なtool loopにする。

1. stable sessionをloadする。
2. 未読のtyped Task eventと現在のTask read modelをconversationへ追加する。
3. Mission Pilot LLMを同じ論理conversationで呼ぶ。
4. LLMがtool callを返したら、Task Action PortまたはRead Portで実行する。
5. tool resultをconversationへ追加し、同じturnを継続する。
6. LLMがassistant messageだけを返したら、そのturnを完了する。
7. Taskがterminalでなければ次のtyped eventまでwaitingにする。
8. 新しいTask eventまたはユーザー入力を受けたら、同じsessionで再開する。

`finalize_answer`を必須にしない。assistant messageのみを返したことをfailureにしない。Taskを完了する場合は、Mission PilotがTaskの実action toolを呼ぶ。

### 5.3 Minimal runtime states

Mission Pilot runtimeが持つ状態は次に限定する。

```text
stopped
playing.idle
playing.running
playing.waiting
playing.attention
completed
```

これらはruntime lifecycleであり、Plan、Implementation、Test、Review等のdomain phaseではない。

- `idle`: play済みだが実行turnをclaimしていない。
- `running`: Mission Pilot LLM turnまたはtool callを実行中。
- `waiting`: worker、user、timer、Task eventを待っている。
- `attention`: 権限不足、ユーザーしか解決できない入力不足、retry exhausted等。
- `stopped`: ユーザーが停止した。
- `completed`: 対象Taskがterminalになった。

現在のTaskがPlan ModeかTest ModeかはTask read modelのFactであり、Mission Pilot runtime stateにしない。

## 6. Stable Session and Conversation Contract

### 6.1 Session ID invariant

1. 一つのTaskには一つのMission Pilot sessionだけを持つ。
2. Task開始から完了まで`mission_pilot_sessions.id`を変更しない。
3. play、stop、resume、worker Run完了、Plan Mode遷移、context compactionで新sessionを作らない。
4. process restart、provider retry、lease recoveryでも同じsessionを再開する。
5. 既存DBの`task_id` unique制約を維持する。

provider側conversation IDはprovider capabilityに応じて更新される可能性があるが、NightWorkers上は同じ論理sessionとして扱う。provider conversationを再作成する場合も、永続化したMission Pilot conversation summaryと未圧縮tailを再投入し、会話上の連続性を維持する。

### 6.2 Conversation ownership

Mission Pilot conversationに保存するもの:

- versioned System Context。
- ユーザーの初期Task依頼と、その後のMission Pilot宛てユーザー入力。
- Task read modelのversioned snapshotまたは差分。
- Mission Pilot自身のassistant message。
- Mission Pilotが呼んだtool callとtool result。
- coding/Test/Review agentのterminal outcome projection。
- context compaction summaryと、そのsource revision。

Mission Pilot conversationに保存しないもの:

- coding agentの逐次assistant message。
- coding agentのreasoning。
- coding agentのtool callとtool result。
- command stdout/stderr全文。
- Test agentの途中経過チャット。
- Review agentの途中経過チャット。
- Todoごとの実況、token stream、progress message。

NightWorkers本体がユーザー表示や監査のためにworker transcriptを保持していても、Mission Pilotはそれをquery、copy、subscribe、summarizeしない。

### 6.3 Context compaction

- compactionは同じMission Pilot session内で行う。
- summaryはMission Pilot自身のconversation、採用済みユーザー判断、実行済みaction、未解決事項を対象にする。
- worker transcriptをsummary sourceへ入れない。
- current Specification、Artifact、Run outcomeは正本への参照とdigestを保持し、古い全文をsummaryへ複製しない。
- compaction開始をdomain phaseやkeywordで判断せず、token budgetだけで判断する。

## 7. Mission Pilot Tool Surface

### 7.1 Tool exposure principle

Mission Pilotへ見せるtoolは、現在のphaseやTodo名で絞らない。

1. 現在のユーザー権限で利用可能なTask操作toolを原則すべて公開する。
2. tool数が多い場合はdeferred tool discoveryを使用する。
3. actionが現在実行可能かはtool非表示ではなく、`list_available_task_actions`と実行時preconditionで表す。
4. 実行不能なactionはtyped errorとcurrent revisionを返す。
5. tool errorを受けた後の次操作はMission Pilotが決める。
6. tool availabilityをユーザー文言、Artifact本文、error messageのkeywordで判定しない。

### 7.2 Read tools

Mission Pilotに少なくとも次のread capabilityを提供する。

#### `read_task_workspace`

ユーザーがTask画面で確認できる現在状態を返す。

- Task goal、acceptance criteria、status。
- Projectとrepository状態。
- current UI mode/view。
- current Questionnaire state。
- current Plan Artifact一覧とrevision。
- Queue/active Run/terminal Runのsummary。
- Task revision。
- ユーザーが現在実行可能なaction IDs。

worker transcriptは含めない。

#### `read_current_specification`

現在の生成済み仕様、revision、digest、source Artifact refsを返す。Mission Pilotとcoding agentが同じ仕様正本を参照できるようにする。

#### `read_plan_artifact`

指定したcurrent ArtifactをIDで読む。Artifact種別をkeywordから推定しない。

#### `read_run_outcome`

指定Runのユーザー向け終端結果だけを返す。

```ts
type MissionPilotRunOutcome = {
  runId: string;
  executionMode: string | null;
  terminalState: string;
  finalReport: string | null;
  blocker: {
    code: string | null;
    message: string;
  } | null;
  verificationSummary: string | null;
  artifactRefs: Array<{ kind: string; id: string }>;
  completedAt: string | null;
};
```

`finalReport`と`blocker.message`はworkerが最終的にユーザーへ報告した本文を保持する。実装側のkeyword分類で要約、severity変更、別本文への置換をしない。

#### `list_available_task_actions`

現在のユーザーがUIで実行可能または選択可能なactionを返す。

```ts
type MissionPilotTaskActionDescriptor = {
  actionId: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  availability: "available" | "unavailable" | "confirmation_required";
  unavailableReason: string | null;
  expectedTaskRevision: number;
};
```

`unavailableReason`はdomain preconditionから構造的に生成し、Task本文やerror本文の意味分類には使わない。

### 7.3 Action tools

UI相当actionは一つのTask Action RegistryからMission Pilot toolへ投影する。最低限、次の操作群を対象にする。

- Questionnaire回答の保存・提出。
- Plan Mode routing/選択肢の決定。
- Plan Artifact生成・再生成。
- Plan reviewまたはユーザー相当の採用操作。
- repository import/bootstrapの開始。
- Queue投入、Queue解除、再開。
- Implementation Runの開始・停止・再実行。
- Test Modeの選択肢設定とRun開始。
- Review Modeの選択肢設定とRun開始。
- blocker後のretry/resume/別mode開始。
- commit/push。既存push policyとapprovalに従う。
- Task完了、archive。
- Mission PilotからユーザーへのTask message送信。

Action Registryは`actionId`、description、input schema、authorization、precondition、application command handlerを一箇所で定義する。Mission Pilot固有の別実装でUI操作を再現しない。

### 7.4 Wait behavior

長時間worker実行中にMission Pilot LLMをpollし続けない。

- active Run開始後、Mission Pilotはassistant messageでturnを終了できる。
- runtimeはtyped eventを待つ`waiting`へ移る。
- worker terminal eventを受けたら、`read_run_outcome`相当のprojectionを追加して同じsessionをwakeする。
- 固定時間ごとの意味判断pollingを行わない。
- lease recoveryとprovider retryのためのtechnical timerだけを許可する。

## 8. Task Event and Worker Outcome Boundary

### 8.1 Wake-up events

Mission Pilotをwakeしてよいeventは、内容文字列ではなくapplicationのtyped eventとする。

- `task.user_message_added`
- `task.state_changed`
- `questionnaire.ready`
- `plan_artifact.ready`
- `plan_artifact.failed`
- `task_run.started`
- `task_run.terminal`
- `task_action.failed`
- `permission.changed`
- `mission_pilot.resume_requested`
- `mission_pilot.retry_timer_elapsed`

同じTask revision/event IDは一度だけconversationへ投影する。

### 8.2 No transcript tracking invariant

次をarchitecture testで禁止する。

- Mission Pilot moduleがworker stream eventを購読すること。
- Mission Pilot moduleがworker assistant/tool/command message一覧をqueryすること。
- worker transcript本文をMission Pilot promptへ結合すること。
- worker transcriptからregex/keywordでsuccess、failure、mode、next actionを推定すること。
- Pilot用contextへworker logを要約すること。

Mission Pilotは`task_run.terminal`を受け、永続化済みのtyped Run outcomeだけを読む。

### 8.3 Outcome preservation

- worker final reportが非空ならその本文を保持する。
- blocker reportが非空ならその本文を保持する。
- schema/parse failureでもworker本文を固定診断へ置換しない。
- system diagnosticは別field/eventとして保持する。
- Mission Pilotはfinal reportとdiagnosticの両方を見て判断できる。

## 9. System Context Design

System ContextはMission Pilotの行動を説明する主要な制御面とする。ただし個別Taskの答えや固定workflowを書かない。

### 9.1 Required guidance

System Contextに次を明記する。

- Mission PilotはユーザーTaskを自動化するAIであり、人間ユーザー以上の権限を持たない。
- Task UIで利用可能な選択肢から、Goalと現在Factに最も合うものを選ぶ。
- 選択前に必要なSpecification、Artifact、Run outcomeをtoolで確認する。
- Plan、Implementation、Test、Reviewを固定順序で実行する必要はない。
- Test、Review、再実行、完了の必要性は現在のTaskと成果から判断する。
- workerの逐次チャットや内部tool履歴は利用できず、最終報告とblockerをFactとして扱う。
- tool error時は返されたpreconditionとcurrent stateを読み、別action、retry、wait、ユーザー確認を判断する。
- 不可逆操作、権限外操作、ユーザーしか決められない欠落ではユーザー確認を求める。
- assistant本文だけでturnを終えてよい。Task完了はTask action toolで行う。

### 9.2 Forbidden guidance

- `implementationの次は必ずtest`のような固定順序。
- `この文言ならTest Mode`のようなkeyword rule。
- error codeまたはTodo名に対する固定next action。
- 特定Artifact名が存在したら自動採用する規則。
- 固定correction回数からsemantic verdictを決める規則。
- worker final reportを無視してhost diagnosticを優先する規則。

### 9.3 System Context updates

System Contextはversion管理し、更新時も同じsessionへ適用する。

- static role context。
- current authorization/push policy。
- Task action tool contract。
- current Task Fact projection。

static role contextとcurrent Factを混ぜない。current Fact更新のたびにsystem prompt全文を再生成して過去判断を書き換えない。

## 10. Data and Persistence Model

### 10.1 Keep

- `mission_pilot_sessions`のstable task/session identity。
- desired state、version、lease、authorization、started/stopped timestamps。
- context revision/digestのCAS用途。
- Mission Pilot event audit。
- Questionnaire、Artifact等のdomain正本への参照。

### 10.2 Add or reshape

#### Mission Pilot conversation

Mission Pilot自身のconversationをworker messageから分離して永続化する。

```ts
type MissionPilotConversationItem = {
  id: string;
  sessionId: string;
  sequence: number;
  kind:
    | "system_context"
    | "user"
    | "assistant"
    | "tool_call"
    | "tool_result"
    | "task_event"
    | "compaction_summary";
  bodyJson: Record<string, unknown>;
  sourceRef: { kind: string; id: string } | null;
  createdAt: Date;
};
```

Mission Pilot tool callとresultはcall IDで対応させ、process restart後も未完了callをreconcileできるようにする。

#### Session runtime fields

- logical conversation revision。
- provider conversation reference。
- System Context version。
- last consumed Task event ID/revision。
- context compaction revision。
- current runtime state。

### 10.3 Remove after cutover

- domain進行を表す`MissionPilotPostQueuePhase`。
- `implementationCycle`、`testCycle`、`reviewCycle`をnext action決定に使う処理。
- `missionPilotPhaseRuns`を固定phaseの正本として使う処理。
- Mission Pilot専用Test snapshotからnext phaseを決める処理。
- Mission Pilot専用Review decisionからnext phaseを決める処理。
- fixed correction transitionと固定correction limit。
- repository bootstrap専用phaseと専用Todo制約。

既存のTest/Review結果をユーザー向けArtifactとして保持する必要がある場合は、Mission Pilot phase tableではなく通常Task/Run Artifactとして残す。

## 11. Implementation Workstreams

本リファクタリングはMission Pilotの外側に対してportを固定し、NightWorkers全体の他リファクタリングと並列に進める。内部実装は次の大粒度workstreamに分ける。

### Workstream A: Contract and Baseline

目的:

- 現行Mission Pilotの操作、UI選択肢、Run outcome、権限をinventory化する。
- 新旧比較用のcharacterization testとtrace fixtureを作る。
- Mission Pilotが使用してよいFactと禁止するworker transcriptを型で固定する。

成果物:

- `MissionPilotTaskReadModel`
- `MissionPilotRunOutcome`
- `MissionPilotTaskActionDescriptor`
- `MissionPilotTaskReadPort`
- `MissionPilotTaskActionPort`
- no-transcript architecture test
- 現行代表scenario fixture

完了条件:

- UIで可能なTask操作がaction catalogに列挙されている。
- action catalogにMission Pilot専用の権限拡張がない。
- worker transcriptをMission Pilot inputへ入れる経路がtestで検出できる。

### Workstream B: Persistent Mission Pilot Runtime

目的:

- 一つのstable sessionで継続するmodel/tool loopを実装する。

成果物:

- Mission Pilot conversation store。
- Mission Pilot provider runtime adapter。
- versioned System Context builder。
- tool-call loop。
- context compaction/resume。
- lease、idempotency、cancellation。

完了条件:

- PlanからImplementation、Test、Reviewへ移動してもsession IDが変わらない。
- process restart後も同じconversation revisionから再開する。
- assistant text-only turnを正常完了として扱う。
- Mission Pilot自身のtool call履歴は保持し、worker transcriptは保持しない。

### Workstream C: User-equivalent Task Tool Adapter

目的:

- UI相当操作をMission Pilot toolとして公開する。

成果物:

- Task Action Registry。
- read tools。
- Questionnaire/Plan/Artifact action adapters。
- Queue/Run/Test/Review action adapters。
- complete/archive/Git action adapters。
- typed precondition error contract。

完了条件:

- Mission Pilot toolとUIが同じapplication commandを呼ぶ。
- mode、phase、Todo名によるtool allowlistがない。
- action実行不能時に別actionをhostが自動選択しない。
- current userが実行できない操作をMission Pilotも実行できない。

### Workstream D: Event and Outcome Integration

目的:

- worker transcriptを追跡せず、Task eventとterminal outcomeだけでMission Pilotを再開する。

成果物:

- typed Task event consumer。
- event deduplication/checkpoint。
- Run outcome projector。
- wait/wake runtime。
- worker transcript access禁止test。

完了条件:

- active Run中にMission Pilotがpollingを続けない。
- terminal Run後、final report/blockerが同じsessionへ一度だけ追加される。
- workerの途中message/tool/command outputがMission Pilot conversationに存在しない。

### Workstream E: Fixed Workflow Removal

目的:

- 新runtimeを進行の正本にし、固定phase machineを撤去する。

撤去対象:

- post-Queue deterministic transition。
- implementation completionからのautomatic Test start。
- Test completionからのautomatic Review start。
- Review completionからのautomatic closeout。
- repository bootstrap専用Run完遂workflow。
- Mission Pilot専用Todo projection/rework Todo。
- fixed review/test/correction cycle。
- phaseに基づくresume/recovery。

置換方針:

- Run完了はtyped eventとして同じMission Pilot sessionをwakeする。
- 次のmode/actionはMission Pilotがtoolで選ぶ。
- recoveryはcurrent Task read modelと未完了tool callを再取得してLLMへ返す。
- hostは失敗から特定phaseを推定しない。

完了条件:

- `implementing -> test_preparing`のようなdomain transition tableが存在しない。
- Test/Reviewを実行しないTaskを正常に完了できる。
- import後に別Mission Pilot sessionまたはbootstrap完了workflowを作らず続行できる。

### Workstream F: UI, Migration, and Cutover

目的:

- 既存Taskとsessionを保持したまま新runtimeへ切り替える。

成果物:

- runtime feature flag。
- existing session migration。
- conversation/audit UI projection。
- waiting/attention表示。
- rollback手順。
- obsolete table/code cleanup plan。

完了条件:

- 切替前後でTask IDとMission Pilot session IDが変わらない。
- 既存playing sessionは安全な境界で新runtimeへresumeできる。
- rollbackしてもTask/Run/Artifact正本を失わない。
- UIはMission Pilot自身の判断とtool操作を表示できるが、worker transcriptをPilot履歴として混ぜない。

## 12. Dependency and Parallelization Strategy

### 12.1 Mission Pilot外部との固定port

Mission Pilotは次のportだけに依存する。

```text
MissionPilotTaskReadPort
MissionPilotTaskActionPort
MissionPilotRunOutcomePort
MissionPilotTaskEventPort
MissionPilotConversationStore
MissionPilotProviderPort
```

Native API runner、Codex runtime、Todo runtime、Review runtimeの内部型をMission Pilotへimportしない。既存実装との接続はadapterへ閉じ込める。

このため、他チームがworker runtimeをリファクタリングしていても、次の安定contractだけ維持すればMission Pilot作業を継続できる。

- Task/Artifact read model。
- Run terminal state。
- non-empty final report/blockerの保持。
- application commandの入力schemaと結果。
- typed Task event。

### 12.2 Internal dependency order

```text
Workstream A
   |\
   | +--> Workstream C
   | +--> Workstream D
   v
Workstream B
   \      /
    v    v
 Workstream E
       |
       v
 Workstream F
```

- A完了後、B/C/Dは並列実装できる。
- EはB/C/Dのintegration contractが成立してから行う。
- Fはshadow実行とmigration検証後に行う。

## 13. Migration and Cutover

### 13.1 Feature flags

段階移行用にMission Pilot runtimeだけを切り替えるfeature flagを設ける。

```text
legacy      現行phase workflow
shadow      新runtimeは判断を記録するがside effectを実行しない
agent       新runtimeがTask actionを実行する
```

flagはTaskまたはMission Pilot session単位で固定し、turn途中で切り替えない。

### 13.2 Shadow comparison

shadowでは旧workflowのnext actionと新Mission Pilotの提案を比較する。ただし新LLMの判断を旧phaseへ変換して採点しない。

記録するもの:

- 新Mission Pilotが選んだaction ID。
- 選択に使用したTask revisionとsource refs。
- 旧workflowが自動実行したaction。
- 新runtimeに存在しなかったtool/precondition。
- ユーザー介入の有無。

worker transcriptはshadow比較にも使用しない。

### 13.3 Existing session migration

1. 同じ`mission_pilot_sessions.id`を維持する。
2. current Task、Specification、Artifact、active Run、terminal Run outcomeからinitial read modelを作る。
3. 既存phaseはmigration diagnosticとして一度だけ保存し、System Contextの命令にはしない。
4. active Runがある場合は`waiting`へ移行し、そのterminal eventを待つ。
5. active Runがない場合はcurrent Task read modelでMission Pilotをwakeする。
6. 旧phaseから次actionを自動生成しない。
7. 旧Mission Pilot messageのうち、ユーザー入力、採用済み判断、Artifact refsだけをconversation seedへ投影する。
8. worker transcriptと旧fixed recovery promptはseedへ入れない。

### 13.4 Rollback

- shadow段階ではside effectがないためflagをlegacyへ戻せる。
- agent段階でrollbackする場合、新runtimeが実行したapplication actionは通常Task eventとして残す。
- rollbackでTask/Artifact/Runを巻き戻さない。
- in-flight tool callをreconcileしてからruntime ownershipを切り替える。
- 新conversation dataは監査証跡として保持する。

## 14. Verification Strategy

### 14.1 Architecture tests

- Mission Pilot production codeにTask内容を分類する正規表現・keyword mapが存在しない。
- fixed domain phase transition tableが存在しない。
- Mission Pilotからworker transcript query/stream dependencyが存在しない。
- Mission Pilot tool availabilityがTodo title/task type/current modeの文字列比較に依存しない。
- Mission Pilotはapplication command以外からTask状態を直接mutationしない。
- provider本文を固定診断で置換しない。

正規表現そのものを全面禁止するのではなく、UUID、digest、JSON、protocol、path等の構文検証用途は許可する。禁止対象はTaskやLLM本文の意味分類である。

### 14.2 Core integration scenarios

#### Scenario A: New Task and Plan choices

1. ユーザーがTaskを作成しMission Pilotをplayする。
2. Mission PilotがTaskと利用可能actionを読む。
3. Questionnaireの選択肢をLLMが回答する。
4. Plan Artifactを読み、必要な選択を行う。
5. session IDが一度も変わらない。

#### Scenario B: Import then implementation

1. empty repositoryでTaskを開始する。
2. Mission Pilotがimport actionを選ぶ。
3. import Runのfinal reportを同じsessionで受け取る。
4. Mission Pilotがcurrent SpecificationとTask stateを読み直す。
5. 別bootstrap sessionやbootstrap完了Todoを作らず、Implementation開始を判断する。

#### Scenario C: Implementation without Test/Review

1. 小さいTaskのImplementation final reportを受け取る。
2. Mission PilotがTaskの完了条件を評価する。
3. Test/Reviewを開始せずTask完了を選べる。
4. hostがTest/Reviewを自動追加しない。

#### Scenario D: Test required

1. Implementation final reportと仕様を読む。
2. Mission PilotがTest Modeの選択肢を決める。
3. Test Runを開始する。
4. Test terminal outcomeだけを受け取る。
5. 必要なら修正または完了をMission Pilotが選ぶ。

#### Scenario E: Blocker recovery

1. coding agentが非空のblocker reportを返す。
2. Mission Pilotはその本文を改変せず受け取る。
3. available actionsとcurrent stateを読み、retry、別action、ユーザー確認を判断する。
4. error keywordからhostが固定recoveryを開始しない。

#### Scenario F: Restart and compaction

1. Plan完了後にprocessをrestartする。
2. 同じsession IDとconversation revisionで再開する。
3. 長いTaskでcontext compactionを実行する。
4. compaction後も採用済み判断と未解決事項が保持される。
5. worker transcriptがsummaryへ混入しない。

#### Scenario G: User override

1. Mission Pilot waiting中にユーザーがUI操作または追加messageを行う。
2. typed Task eventとして同じsessionをwakeする。
3. Mission Pilotが新しいFactを優先して判断を更新する。
4. 旧phaseへの巻き戻しや新session作成を行わない。

### 14.3 Failure tests

- stale task revision。
- duplicate tool call。
- process crash between action claim and completion。
- permission revoked during session。
- provider transport failure。
- provider assistant text-only response。
- invalid tool arguments。
- unavailable UI action。
- worker final report欠落。
- terminal event重複delivery。
- active Run中のstop/resume。

すべてのfailureで、ホストはtyped resultを返し、次のsemantic actionを固定しない。

## 15. Observability

計測する指標:

- Mission Pilot session継続時間とturn数。
- session ID再作成回数。目標はTaskあたり0回。
- Mission Pilot action成功/失敗/precondition rejection率。
- user intervention率。
- attention理由。
- terminal Run outcomeから次Mission Pilot turnまでの遅延。
- worker transcriptがMission Pilot contextへ混入した件数。目標は0件。
- fixed workflow fallback発生数。cutover後は0件。
- Mission Pilotが選択したmode/actionの分布。
- context compaction回数とresume成功率。
- Task完了率、平均Run数、不要なTest/Review起動率。

観測値を使ってLLMの選択を実装側で矯正しない。System Context、tool description、Task read modelの改善材料として使用する。

## 16. Deletion and Simplification Targets

新runtime cutover後、参照がなくなったことを確認して段階的に削除する。

- `mission-pilot-post-queue-state.ts`
- `mission-pilot-post-queue-coordinator.service.ts`の固定transition部分
- `mission-pilot-runtime-continuation.service.ts`の`start_test`、`start_review`、`run_closeout`分岐
- `mission-pilot-post-queue-test.service.ts`のnext phase決定部分
- `mission-pilot-post-queue-review.service.ts`のnext phase決定部分
- `mission-pilot-repository-bootstrap.service.ts`の専用Run orchestration
- `mission-pilot-implementation-todo-projection.service.ts`
- `mission-pilot-rework.ts`の固定Todo生成
- `MISSION_PILOT_CORRECTION_LIMITS`と固定cycle遷移
- `MissionPilotPostQueuePhase` schema
- phase別resume/recovery code
- phase別UI文言とphase-specific tests

DB table/column削除は、新runtimeのmigrationとrollback期間終了後に別migrationで行う。

## 17. Risks and Mitigations

### 17.1 LLMが操作を選べず停止する

対策:

- UI actionと同じ説明、schema、availability reasonをtoolへ提供する。
- current Task read modelを簡潔かつ完全にする。
- System Contextで判断原則を説明する。
- tool errorをmodel-visibleにして再判断させる。

固定fallback actionは追加しない。

### 17.2 Tool数が多すぎる

対策:

- Task Action Registryをdomain別namespaceに分ける。
- deferred tool discoveryを使う。
- `list_available_task_actions`で現在の選択肢を提示する。

current phaseやTask keywordでtoolを隠さない。

### 17.3 会話が長期化する

対策:

- token budgetベースのcompaction。
- Task正本は参照/digestで保持する。
- worker transcriptを取り込まない。
- terminal outcomeをユーザー向けfinal report中心に限定する。

### 17.4 他runtimeのリファクタリングと衝突する

対策:

- Mission Pilot portとadapterを分離する。
- worker内部型をimportしない。
- Run outcome contractを小さく保つ。
- application commandをintegration seamとする。

### 17.5 自律操作の権限が広すぎる

対策:

- play時authorizationを上限とする。
- UIと同じpermission/preconditionを通す。
- irreversible/external actionは既存approvalを維持する。
- Mission Pilot専用の権限bypassを禁止するarchitecture testを置く。

## 18. Definition of Done

次をすべて満たしたとき、Mission Pilotリファクタリングを完了とする。

1. 一つのTaskでMission Pilot session IDが開始から完了まで変わらない。
2. Mission Pilot自身のconversationがrestart/context compaction後も継続する。
3. Mission Pilotがユーザーと同じTask操作を同じ権限・preconditionでtool実行できる。
4. Plan Modeと各modeの選択肢をLLMが判断する。
5. Implementation、Test、Review、closeoutの固定遷移がない。
6. repository import後に別bootstrap workflowを完遂せず、同じsessionで次操作を判断する。
7. coding/Test/Review agentの逐次チャット、tool log、command outputをMission Pilotが追跡しない。
8. workerの仕様、最終報告、blockerを改変せずMission Pilotが読める。
9. Task/LLM本文の正規表現・keyword分類でnext actionを決めるコードがない。
10. tool availabilityをphase、Todo名、job typeで制限しない。
11. assistant text-only responseをfailureにしない。
12. hostはschema、権限、安全、revision、lease、idempotencyに責務を限定している。
13. 代表integration scenarioとfailure testが通る。
14. shadow期間の観測でworker transcript混入が0件である。
15. 旧fixed workflowを無効化し、rollback期間終了後に不要コードを削除できている。

## 19. Implementation Start Gate

実装開始前に次だけを確定する。Taskの意味判断を追加ロジックへ戻す選択肢は設けない。

1. Task UI相当action catalogの初版。
2. Mission Pilot providerとconversation resume方式。
3. conversation保存tableを新設するか、既存event tableを拡張するか。
4. runtime feature flagの保存単位。
5. existing session migrationの対象範囲とrollback期間。

これらを確定後、Workstream Aを開始し、B/C/Dを並列化する。
