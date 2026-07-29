# Mission Pilot User-Equivalent Recovery Implementation Plan

## Status

- Concept status: `locked`
- Plan status: `completed`
- Implementation status: `completed`
- Review baseline: `2026-07-29`
- Implementation verified: `2026-07-30`
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Primary scope: Mission Pilot、Task Operator、Mission Pilotが利用するAgent非依存application boundary
- Explicitly excluded scope: Coding Agent production implementation
- Authority:
  - Role/module境界は`spec/docs/mission-pilot-coding-agent-module-separation-plan.md`を継承する。
  - S11t runtime、CLI、生成物、canary、検証規則は`spec/s11t-coding-agent-guide.md`を継承する。
  - 本計画は、現在のMission Pilotを復旧するための修正順序と完了条件を定める。

この計画の完成条件は、次の一文に集約する。

> Mission Pilotを、人間ユーザーがNightWorkers上で読めるFactと実行できるapplication commandだけを、委任された範囲内で代行する作業者として復旧し、Coding Agentの実装、保存形式、event本文、runtime、tool、repositoryへ直接・間接に依存しない状態を、静的検査、integration test、実provider live testで証明する。

Mission Pilotは管理者、特権Supervisor、Coding Agentの内部coordinatorではない。
Mission Pilotに許される能力の上限は、現在の人間ユーザーに許された能力である。
Play時の委任はユーザー権限を拡張せず、必ずその部分集合として扱う。

### Implementation result

本計画はM0からM8まで完了した。実装結果は次のとおり。

- Mission PilotのmutationはTask Operatorの公開commandへ統一した。
- Action definition、input schema、completion metadataはTask Operatorの正本registryから生成する。
- Mission PilotはDelegated User Principalを使い、各commandでcurrent user capabilityを再評価する。
- Run、Queue、Questionnaire、Artifactの正本tableをMission Pilot repositoryから直接読まない。
- Runの関連付けと復旧はTask Operator receipt / resource refを正本にした。
- `questionnaire.submit`はMission Pilotへ公開せず、20秒のユーザー介入契約を維持した。
- `plan.artifact.regenerate`はorphan actionとして残さず、型別の共通Artifact commandへ統一した。
- 旧plan coordinator、phase continuation、queue handoff、post-queue review、closeout経路をproductionから削除した。
- Mission Pilot thoughtとCoding Agent chatはowner / channel別のread modelで分離した。
- Coding Agent production implementationは変更していない。
- 決定論E2E 7件、Mission Pilot / Task Operator契約157件、Coding Agent回帰131件、実Codex provider canaryが成功した。

実装中に、provider fixtureが`implementation` scope未登録時にMission Pilot用`default`
scopeへfallbackする問題を検出した。scopeは完全一致へ変更し、異なるroleのturnを消費しない。
また、Bun SQLiteとlibSQLの同一DB併用によるwrite lockを検出し、同期queryもlibSQLへ統一した。

---

## 0. Non-Negotiable Constraints

### 0.1 Mission Pilotはユーザーの代替作業者である

Mission Pilotは次の原則に従う。

1. ユーザーがTask画面または対応する公開application APIから読めるFactだけを読む。
2. ユーザーが同じTask上で実行できるapplication commandだけを実行する。
3. ユーザーと同じauthorization、precondition、revision、idempotency、confirmation、resource ownership検証を通る。
4. Playで与えられた委任範囲がユーザー権限より狭い場合は、狭い方を採用する。
5. ユーザーが介入できるQuestionnaire、不可逆操作、追加権限確認を迂回しない。
6. Taskの意味、次action、Questionnaire回答案、Plan、Artifact、Run結果、完了判断はLLMが行う。
7. hostはschema、authorization、revision、lease、idempotency、resource budget、event delivery等の構造的不変条件だけを強制する。

有効権限は、次の積集合として扱う。

```text
effective capability
  = current user capability
  ∩ Play delegation
  ∩ current Task Operator action availability
```

Mission Pilot専用scope、内部route、DB更新、service methodによって、この積集合を超える能力を追加してはならない。

### 0.2 Coding Agent側は一行も変更しない

本計画では、次のproduction implementationを変更しない。

```text
api/modules/codingAgent/**
src/modules/codingAgent/**
shared/modules/codingAgent/**
```

加えて、次を禁止する。

- Coding AgentのSystemContext、runtime、tool、Todo、repository、handler、routeを変更する。
- Mission Pilotの都合でCoding Agentへ新しいmode、workflow、event、status、provenance fieldを要求する。
- Coding Agentの既存start、resume、stop、terminal outcomeの意味を変更する。
- Coding Agentのtest assertionをMission Pilotの都合で弱める。
- Coding Agentの保存データをMission Pilotが直接更新する。

既存Coding Agent実装の読み取りと既存回帰testの実行は許可する。
Mission Pilot側の修正だけで成立しない要求が見つかった場合は、Coding Agentへ変更を加えず、そのCheckpointを停止する。

### 0.3 直接依存だけでなく隠れた依存も禁止する

次をすべて依存違反として扱う。

- Mission PilotからCoding Agent moduleへのimport。
- Mission PilotからCoding Agent public indexへのimport。
- Mission Pilotから`agentsShare`のCoding Agent固有portまたはrole名付きcontractへのimport。
- Mission PilotからCoding Agent routeをHTTP経由で呼ぶ実装。
- Mission PilotがCoding AgentのDB table、context snapshot、ledger、Todo tableを直接読む実装。
- Mission PilotがCoding Agent固有event名、message本文、payload内の文字列をparseしてRunを関連付ける実装。
- Mission PilotがCoding Agentのstatus文字列を独自解釈して次actionを固定する実装。
- Coding AgentからMission Pilot module、route、repository、prompt、event subscriberへ到達する実装。
- Queue、Task Operator、provider等の中立moduleへMission Pilot固有fieldやrole分岐を置き、そこを介して結合する実装。
- `agentsShare`へrole固有repository、route、continuation、semantic decisionを移して境界を迂回する実装。

### 0.4 許可する依存

Mission Pilotから許可するproduction依存は、次に限定する。

```text
Mission Pilot
  -> Mission Pilot自身のsession / conversation / receipt repository
  -> Task Operatorの公開query / command contract
  -> Agent非依存event envelope
  -> Mission Pilot provider adapter
  -> 汎用provider transport
```

Task、Questionnaire、Artifact、Queue、Runの正本は、それぞれのAgent非依存application query / commandを通じて扱う。
Mission Pilot repositoryはMission Pilot固有tableだけを扱う。

### 0.5 Mission Pilotに追加してはならない能力

- filesystem read / write tool。
- shell / command tool。
- Git primitiveへの直接アクセス。
- repository pathへの直接アクセス。
- Coding Agent runtime control API。
- provider内部管理API。
- Task、Run、Queue、Questionnaire、Artifact tableへの直接mutation。
- ユーザーにないpush、merge、archive、complete権限。
- confirmationや介入時間を迂回する専用command。
- error messageやTask文言のkeyword分類による固定workflow。

---

## 1. Current Findings to Correct

| ID | 現状 | リスク | 本計画の修正先 |
| --- | --- | --- | --- |
| F1 | productionはpersistent Agent Runtimeだが、実provider live testは旧`runMissionPilotPlanPipeline`を直接実行する | green testがproduction動作を証明しない | R6、R7 |
| F2 | Mission Pilot action registryが38件、Task Operator catalogが37件で二重管理される | schema、availability、待機規則がdriftする | R2 |
| F3 | `plan.artifact.regenerate`がMission Pilot registryにだけ存在する | Artifact再生成責務を実行できない | R2 |
| F4 | `questionnaire.submit`がcomment、test、実行ログで異なる扱いになっている | ユーザー介入を迂回する、またはMission Pilotが停止する | R2、R3 |
| F5 | `task.queue.enqueue`と`run.implementation.start`が異なるprovenanceと結果契約を持つ | 同じ実装依頼に二つの不整合な経路がある | R4 |
| F6 | Mission Pilot action復旧がRun DBと`coding_agent.requested` payloadを探索する | Coding Agent保存形式への隠れた依存 | R4 |
| F7 | Run update listenerのterminal分岐がearly return後にあり到達不能 | event源が分裂し、復旧経路が一貫しない | R5 |
| F8 | Agent turn終了時にControl Summary version更新とrealtime publishが一貫しない | UI上、開始後に停止または固まったように見える | R5 |
| F9 | provider tool turn非対応をPlay前に検証しない | Play成功後、非同期にattentionへ落ちる | R5、R7 |
| F10 | QueueとTask OperatorにMission Pilot固有provenanceやmetadata名が漏れている | 中立moduleを介したrole依存が残る | R1、R4 |
| F11 | 旧coordinator、旧phase service、現行persistent runtimeが同じmodule内に併存する | 修正対象、所有者、test対象を取り違える | R6 |

---

## 2. Target Responsibility Model

### 2.1 Mission Pilotが所有するもの

- Task Goal、完了条件、ユーザー指示、現在Factの解釈。
- 次に読むresourceの選択。
- Questionnaireの要否、回答案、根拠、follow-up、review結果の評価。
- ユーザー介入後のQuestionnaire Factの再評価。
- Plan routingのinclude / omit判断。
- Feature Plan、Blueprint、Data Model、Dedicated Viewの生成・再生成判断。
- Artifact defectと維持事項の記述。
- ユーザーと同じTask actionから次の一件を選ぶ判断。
- repository作業が必要かどうかの判断。
- Run開始時にユーザーとして渡す依頼本文。
- Run terminal outcome、verification、blocker、changed path summaryの評価。
- 追加調査、修正依頼、再検証、ユーザー質問、Task complete、wait、finishの判断。
- Mission Pilot自身のsession、conversation、turn、tool call、delegation ref、action receipt。

### 2.2 Mission Pilotが所有しないもの

- repositoryの内容とfilesystem操作。
- Coding Agent runtime。
- Coding Agent Todo。
- Coding Agent tool catalog。
- command実行、build、test、lint、E2E。
- Run内部transcript。
- Coding Agentの最終報告生成。
- Run statusの生成。
- Task Run worker、Queue worker。
- Task、Run、Questionnaire、Artifact、Queueの正本repository。
- ユーザー権限を超える管理操作。

### 2.3 Coding Agentが所有するもの

本計画はCoding Agentを変更しない。既存責務を外部契約として扱う。

- 登録済みProject repo rootでの調査。
- repository編集。
- command実行。
- Todoによる作業計画。
- build、typecheck、lint、test、検証。
- changed files、verification、blocker、final reportの生成。
- ユーザー直結Runの単体完結。

Mission Pilotが停止中または存在しない場合のCoding Agent単体動作を、Mission Pilot側の修正で妨げてはならない。

### 2.4 Task Operatorが所有するもの

- ユーザーとMission Pilotが共通で利用するTask projection。
- 利用可能actionの正本。
- action schema、説明、availability、expected revision。
- principal、delegation、authorization、resource ownership、preconditionの検証。
- command idempotency。
- command receipt。
- Task、Questionnaire、Artifact、Queue、Run application commandへのrouting。
- bounded resource query。
- role非依存failureへの変換。

Task OperatorはTaskの意味や次actionを判断しない。
Task Operator内に`missionPilotAction`、`missionPilotActionKey`等のrole固有fieldや分岐を置かない。

### 2.5 Hostが所有するもの

- schema validation。
- lease。
- revision。
- idempotency。
- deadline。
- resource budget。
- provider capability preflight。
- event persistenceとdelivery。
- realtime publish。
- process restart recovery。

HostはQuestionnaire内容、Plan要否、Artifact要否、修正回数、Run成功の十分性を判断しない。

---

## 3. Target Decision Loop

Mission Pilotは一つの永続LLM loopとして動作する。

```text
PlayまたはTask event
  -> Task Operator projectionを読む
  -> 必要なbounded resourceだけを読む
  -> LLMが次actionを一件選ぶ
  -> action contractを読む
  -> Task Operator commandを実行する
  -> receiptを保存する
  -> 即時結果を再評価する、またはeventを待つ
  -> terminal outcomeをTask Operatorから読む
  -> Goalと完了条件を満たすかLLMが判断する
  -> 次action、質問、wait、complete、finishのいずれかを選ぶ
```

### 3.1 Runtime state

Runtime stateはlifecycleだけを表す。

```text
stopped
running
waiting
attention
completed
```

`questionnaire`、`planning`、`queued`、`implementation`、`review`等のphaseを、次actionの決定に使わない。
既存UI互換のphaseが必要な場合は、観測済みFactから作る表示projectionに限定する。

### 3.2 Questionnaire

Mission Pilotは回答案と根拠を作成し、ユーザーと同じdraft save commandを実行する。

```text
Questionnaireを読む
  -> 回答案と根拠を判断
  -> questionnaire.draft.save
  -> 既存のユーザー介入時間
  -> user / timeout application pathによる確定
  -> state changed event
  -> Mission Pilotが確定後Factを再取得
```

Mission Pilotは介入時間を短縮せず、専用submit routeで迂回しない。
`questionnaire.submit`をMission Pilotへ公開する場合は、通常ユーザーと同じpreconditionとconfirmationを持つことを別途証明しなければならない。
本計画の既定は、Mission Pilotへ直接公開しない。

### 3.3 Artifact

Mission PilotはArtifactの必要性、型、source selection、defect、維持事項を決める。
Artifact正本の生成・再生成は、ユーザーと共通のTask Operator commandを使用する。

`plan.artifact.regenerate`は次のどちらかをR2で確定する。

1. Agent非依存Artifact application commandとして実装し、Task Operatorの正本catalogへ追加する。
2. 実行可能になるまでMission Pilot action definitionから削除し、型別generate actionによる明示的再生成へ統一する。

registryにだけ存在する状態は禁止する。

### 3.4 Repository作業

Mission Pilotはrepositoryを見ない。
repository Factが必要な場合も、ユーザーがCoding Agentへ依頼するのと同じTask actionを選ぶ。

依頼本文には最低限、次を含める。

- Task Goal。
- 今回確認または実施してほしい範囲。
- 採用済みArtifact refs。
- 変更してはいけない範囲。
- 期待する検証。
- 前Runがある場合の不足、blocker、維持事項。

Mission PilotはCoding Agent内部のtool、mode、Todo、実行順を指定しない。

### 3.5 Run評価とTask完了

Run成功はTask完了ではない。

Mission PilotはTask Operatorの`run_outcome` resourceから次を読む。

- terminal status。
- final report。
- verification summary。
- blocker。
- changed path summary。
- artifact refs。
- source revision / digest。

その後、LLMがTask Goalと完了条件を満たすか判断する。
Taskを完了できるのは、ユーザーと同じ`task.complete` commandがpreconditionを満たした場合だけである。

`agent.finish`はMission Pilot runtimeを終了するだけであり、Taskを暗黙完了しない。

---

## 4. Canonical User-Equivalent Task Operator Contract

### 4.1 Action definitionの正本を一つにする

Action definitionはTask Operator側の一つのcatalogを正本とする。

```ts
type TaskOperatorActionDefinition = {
  id: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  effect: "read" | "mutation";
  completion:
    | { kind: "immediate" }
    | { kind: "event"; eventTypes: string[] }
    | { kind: "finish_candidate" };
};
```

Mission Pilotは次だけを行う。

1. `list_available_task_actions`
2. `read_task_action_contract`
3. `execute_task_action`

Mission Pilot moduleに個別action schema、説明、availability、wait listを複製しない。
Mission Pilot固有なのは、generic tool contractと、LLMがどのactionを選ぶかという判断だけである。

### 4.2 Availability

Task Operator projectionは、すべてのactionについて次を返す。

```ts
type TaskOperatorAvailableAction = {
  id: string;
  availability: "available" | "unavailable";
  unavailableReasonCode: string | null;
  expectedRevision: number;
};
```

Mission Pilotは`available`のactionだけを実行できる。
availabilityをMission Pilot側のscope mapや固定phaseで上書きしない。

### 4.3 Delegated user principal

Mission Pilot commandは、session IDだけをactorとする特権automationではなく、ユーザー委任を構造的に保持する。

```ts
type DelegatedTaskOperatorPrincipal = {
  kind: "delegated_user";
  subjectUserId: string;
  delegationRef: {
    sessionId: string;
    taskId: string;
    grantedAt: string;
    capabilityDigest: string;
  };
};
```

実装時に既存principal schemaとの互換が必要な場合も、次を満たす。

- 元のユーザーidentityを失わない。
- delegationのTaskとsessionを検証する。
- delegation単独で新しい権限を作らない。
- current user capabilityの変更を毎commandで反映する。
- Stop後、失効後、Task移動後のdelegationを拒否する。

### 4.4 Command result

Task Operator commandはraw domain objectやrole固有resultを返さない。

```ts
type TaskOperatorCommandResult<T> =
  | {
      ok: true;
      receipt: {
        commandId: string;
        idempotencyKey: string;
        actionId: string;
        operationRef: { kind: string; id: string } | null;
        resourceRefs: Array<{ kind: string; id: string }>;
        replayed: boolean;
      };
      data: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        kind:
          | "invalid_request"
          | "permission"
          | "revision_conflict"
          | "domain_precondition"
          | "outcome_unknown"
          | "temporarily_unavailable";
        message: string;
        retryable: boolean;
        currentRevision: number | null;
      };
    };
```

Mission Pilotはこのresultだけをconversationへ戻す。
Coding Agentやdomain serviceの例外型を直接扱わない。
LLMから返された本文とapplication error本文を固定文へ差し替えない。

### 4.5 Action catalogで解消する重複

R2で次を明示的に解消する。

| 現状 | 目標 |
| --- | --- |
| `questionnaire.draft.update`と`questionnaire.draft.save`が同じ処理 | 一つを正本にし、必要なら他方を期限付きcompatibility aliasとする |
| `plan.artifact.regenerate`がMission Pilotだけに存在 | Task Operator正本へ追加、または完全削除 |
| `questionnaire.submit`の公開方針が不一致 | ユーザー介入契約を正本とし、Mission Pilotから非公開を既定にする |
| Queueとdirect Runの説明が曖昧 | schedulingとimmediate executionを別のユーザー操作として明記する |

### 4.6 Queueとdirect Run

両方を残す場合、意味を次に固定する。

- `task.queue.enqueue`
  - 現在のTaskを通常ユーザーと同じQueue policyでscheduleする。
  - Mission Pilot固有の依頼本文を隠して渡さない。
  - Queue entry refをreceiptで返す。
- `run.implementation.start`
  - 明示した依頼本文で現在のTask Runを即時開始する。
  - Run refをreceiptで返す。

Mission Pilotは通常、具体的な依頼や修正が必要な場合に`run.implementation.start`を選ぶ。
hostがTask文言からどちらかへ自動分類しない。

---

## 5. Run Boundary Without Mission Pilot / Coding Agent Dependency

### 5.1 Mission Pilotから見える境界

Mission Pilotから見えるものは、次だけとする。

```text
Task Operator action:
  run.implementation.start
  run.todo.resume
  run.stop

Task Operator resource:
  run_outcome
  current_todo

Agent非依存event:
  task_run.started
  task_run.terminal
  task_run.failed
```

Mission Pilotは`startCodingAgentRun`、`resumeCodingAgentRunTodo`、Coding Agent handler、Coding Agent eventを知らない。

### 5.2 Task Operator内部adapter

Task Operatorは、既存のRun開始結果をTask Operator receiptへ正規化する。
このadapterは既存Coding Agent handlerの変更を要求しない。

```text
Mission Pilot
  -> Task Operator command
  -> existing Task Run application bridge
  -> existing Coding Agent execution registration
```

Mission Pilotからこのbridgeの型、保存形式、登録方法は見えない。
本計画中、既存Coding Agent側のregistration contractを変更しない。

### 5.3 Receiptによる関連付け

Run開始commandが成功した時点で、Task Operator receiptへRun refを保存する。

```ts
resourceRefs: [
  { kind: "task_run", id: runId }
]
```

Mission Pilotは自分のaction receiptへTask Operator receipt refだけを保存する。
復旧時はTask Operator command receiptをqueryする。

次を廃止する。

- `taskRuns`全件走査。
- `contextSnapshot.missionPilotAgent`探索。
- Task event payload内の`coding_agent.requested`探索。
- `requestedBy.actorId`とMission Pilot session IDの文字列比較。
- Queue内部の`missionPilotAgentJson`探索。

### 5.4 Terminal event

Terminal eventはAgent非依存のRun application eventとする。

```ts
type TaskRunTerminalEvent = {
  eventId: string;
  taskRef: { id: string; revision: number };
  runRef: { id: string };
  status: string;
  outcomeRef: { kind: "run_outcome"; id: string };
  occurredAt: string;
};
```

Mission Pilot subscriberは、Task IDに対応するplaying sessionがある場合だけ、自身のinboxへeventを写し、wakeする。
publisherはMission Pilotの存在を知らない。

同じterminal eventを複数listener経路で生成しない。
event IDでidempotentに保存する。

### 5.5 Outcome

Mission PilotはRun DBを直接読まず、Task Operatorのbounded `run_outcome` queryを使う。
reportが大きい場合はdigestとpagingを返し、正本を改変しない。

---

## 6. Data and Module Placement Rules

### 6.1 Mission Pilot repositoryで許可するtable

- Mission Pilot session。
- Mission Pilot Agent session。
- Mission Pilot turn。
- Mission Pilot conversation item。
- Mission Pilot tool call。
- Mission Pilot task event inbox。
- Mission Pilot action execution receipt。
- Mission Pilot context snapshot。

### 6.2 Mission Pilot repositoryから禁止するtable

- Task。
- Task Run。
- Task Run commit record。
- Task Run action record。
- Coding Agent ledger。
- Coding Agent Todo。
- Implementation Queue entry。
- Questionnaire正本。
- Artifact正本。

これらはTask Operator query / commandからのみ扱う。

### 6.3 中立moduleから除去するrole固有情報

次のようなfield、型、optionを中立名へ置換する。

- `missionPilotAction`
- `missionPilotActionKey`
- `missionPilotAdmissionKey`
- `missionPilotAgent`
- `MissionPilotAgentRunProvenance`

置換先は、role非依存の次の概念とする。

- command provenance。
- delegated principal。
- orchestration ref。
- command receipt ref。
- request trace。

中立moduleで`role === "mission_pilot"`分岐を作らない。

### 6.4 Coding Agent固有port

既存`agentsShare/contracts/coding-agent-run.ts`と`ports/coding-agent-run.ts`は、Mission Pilotからimportしない。
本計画ではCoding Agent実装を変更しないため、既存Task Run application bridgeの内部互換境界として扱う。

Mission Pilotが利用する正本contractはTask Operatorだけである。
この既存portのrename、削除、handler変更は本計画に含めない。

---

## 7. Implementation Work Packages

## R0: Baseline and Change Ledger

### 目的

既存差分を保護し、production経路、旧経路、境界違反を実装前に固定する。

### 作業

1. working treeを記録する。
2. Mission Pilot、Task Operator、Queue、agentsShareの関連fileを分類する。
3. production `/play`からpersistent runtimeまでのimport graphを記録する。
4. 旧coordinatorの全consumerを記録する。
5. action registryとTask Operator catalogの差分を機械的に記録する。
6. Mission Pilot moduleから共有DB tableへのimportを列挙する。
7. 中立moduleに残るMission Pilot固有symbolを列挙する。
8. provider route capabilityとlive test有効条件を記録する。

### Coding Agent不変更gate

```bash
git diff --name-only -- \
  api/modules/codingAgent \
  src/modules/codingAgent \
  shared/modules/codingAgent
```

結果が実装開始前から存在する差分を除いて増えていないことを確認する。

### 完了条件

- change ledgerがある。
- current failure pathを観測する手順がある。
- productionとlegacy testの対応表がある。
- Coding Agent側の変更を計画に含めていない。

### 停止条件

- 既存dirty changeと同じ行を安全に分離できない。
- productionでどのruntimeが起動するか一意に確認できない。

---

## R1: Boundary Guardrails

### 目的

直接import以外の依存を、実装前にfail-first testで検出する。

### 追加する検査

1. Mission Pilotから`api/modules/codingAgent`へのimport禁止。
2. Mission Pilotからrole名付きCoding Agent contractへのimport禁止。
3. Mission Pilot repositoryから共有Task / Run / Queue / Questionnaire / Artifact tableへのimport禁止。
4. Mission Pilotで`coding_agent.requested`等のCoding Agent event文字列をparseする実装禁止。
5. Task Operator、Queue、provider共通層のMission Pilot固有field、type、branch禁止。
6. Mission Pilot tool catalogへのfilesystem、shell、Git primitive登録禁止。
7. Coding AgentからMission Pilotへのimportが0件である既存contractを維持。
8. Agent固有production code配置検査のbaselineを更新し、新規違反追加を禁止。

### Test名候補

- `tests/mission-pilot-user-equivalent-boundary.test.ts`
- `tests/mission-pilot-shared-storage-boundary.test.ts`
- `tests/task-operator-role-neutrality.test.ts`
- `tests/mission-pilot-coding-agent-independence.test.ts`

### 完了条件

- 現在の隠れた依存をfail-firstで検出できる。
- 新規Coding Agent変更がなくてもtestを追加できる。
- architecture checkが新規違反を拒否する。

---

## R2: Single Canonical Action Contract

### 目的

Mission Pilot action registryとTask Operator command catalogの二重管理を解消する。

### 作業

1. Task Operator action definitionを一つの正本へ集約する。
2. schema、title、description、availability、completion metadataを同じ定義から生成する。
3. Mission Pilot registryから個別action schemaとwait listを削除する。
4. Mission Pilotのprovider toolはgenericな7 toolだけを維持する。
5. `plan.artifact.regenerate`を実行可能な正本commandへ追加するか、Mission Pilot definitionから削除する。
6. `questionnaire.submit`をMission Pilot delegated catalogから除外する。
7. `questionnaire.draft.update`と`questionnaire.draft.save`の正本を一つにする。
8. action catalogとcommand switchの集合一致testを追加する。
9. すべてのevent completion actionに、実在するterminal event contractがあることを検証する。

### 完了条件

- Action ID集合が一つのsourceから生成される。
- registry-only、catalog-only、switch-only actionが0件。
- Mission Pilot独自schemaが0件。
- Artifact再生成方針が一意。
- Questionnaire介入契約が一意。

### ロールバック

正本切替前に新definitionをdirect testする。
切替はcatalog reader、contract reader、executorを同一Checkpointで行い、二重正本状態をcommitしない。

---

## R3: Delegated User Authorization

### 目的

Mission Pilotの権限を、現在ユーザーの権限以下に構造的に固定する。

### 作業

1. Play時にユーザーidentity、Task、session、委任capability digestを保存する。
2. Task Operator commandごとにcurrent user capabilityを再評価する。
3. Play delegationとの積集合を計算する。
4. Stop、session失効、Task archive、user permission変更後のdelegationを拒否する。
5. Mission Pilot専用authorization scopeが権限を追加しないことをtestする。
6. push、merge、archive、complete等は既存ユーザーpreconditionをそのまま使う。
7. UI confirmationが必要な操作は、Mission Pilot専用bypassを作らない。
8. permission failure本文をLLM conversationへ保持し、LLMが質問、別action、finishを判断できるようにする。

### User parity tests

- ユーザーが実行不可のactionはMission Pilotも実行不可。
- ユーザー権限を失うと次commandからMission Pilotも実行不可。
- Play delegationで許可されていないactionは、ユーザーに権限があってもMission Pilotは実行不可。
- Mission Pilotだけが実行できるactionが0件。
- Mission Pilot専用DB updateでTask状態を変更できない。

### 完了条件

- すべてのMission Pilot mutationがDelegated User Principalを持つ。
- effective capabilityがserver側で検証される。
- Mission Pilotにuser capabilityを超える経路がない。

---

## R4: Run Receipt and Outcome Boundary

### 目的

Mission PilotからCoding Agentの保存形式、event本文、runtime registrationへの間接依存を除去する。

### 作業

1. `run.implementation.start`のraw resultをTask Operator receiptへ正規化する。
2. Run refをreceiptの`resourceRefs`へ保存する。
3. `run.todo.resume`と`run.stop`も同じreceipt / failure shapeへ統一する。
4. Queue commandはQueue entry refを返す。
5. Mission Pilot action receiptはTask Operator receipt refだけを保存する。
6. `mission-pilot-action-execution.repository.ts`からRun table scanとevent payload解析を削除する。
7. `mission-pilot-run-outcome.adapter.ts`等の直接DB queryを削除し、Task Operator resource queryへ統一する。
8. Terminal eventはAgent非依存event IDでidempotentにinboxへ保存する。
9. Run statusはTask Operator resource schemaでtyped normalizationし、Mission Pilot側にstatus集合を複製しない。

### Coding Agent不変更方法

- 既存Coding Agent start / resume handlerはそのまま使う。
- Task Operator command層で既存resultをreceiptへwrapする。
- Coding Agentへ新しい引数、event、status、provenanceを要求しない。
- Mission Pilotは既存Coding Agent portをimportしない。

### 完了条件

- Mission Pilot production codeに`taskRuns`、`taskRunCommitRecords`、`taskRunActionRecords`のimportがない。
- Mission Pilot production codeに`coding_agent.requested`のparseがない。
- crash後に同一Task Operator receiptからRun refを復元できる。
- Start、resume、stop、outcome、terminal eventが同じRun refで結ばれる。
- QueueのMission Pilot固有provenance fieldへ依存しない。

---

## R5: Persistent Runtime Lifecycle and Realtime

### 目的

現行persistent runtimeの状態遷移、event、UI projectionを一つの正本にする。

### 作業

1. Run update listenerの到達不能terminal分岐を削除する。
2. Run startedとterminal eventのsourceを一つずつにする。
3. event IDによる重複排除を行う。
4. `finishMissionPilotAgentTurn`でControl Summary projectionを更新する。
5. 公開状態が変わる場合はversionを増やす。
6. transaction完了後に`mission_pilot.updated`をpublishする。
7. waiting、attention、completed、stoppedのすべてでUIが最新状態を受け取るtestを追加する。
8. Play前にprovider tool-turn capabilityをpreflightする。
9. provider非対応時はPlayを開始済みにせず、typed failureを返す。
10. retryable provider failureだけを上限付きretry対象にする。
11. provider本文、tool result、failure本文を固定文へ置換しない。

### 完了条件

- Play後の全terminal runtime stateがrealtimeで観測できる。
- UI summary versionが単調増加する。
- terminal Run eventの二重生成がない。
- provider非対応をPlay前に検出できる。
- Stop後に遅延wakeやretry callbackが再開しない。

---

## R6: Legacy Runtime Isolation and Removal

### 目的

旧coordinatorと現行persistent runtimeを同じMission Pilot production経路に残さない。

### 作業

1. `runMissionPilotPlanPipeline`の全consumerを再確認する。
2. `mission-pilot-plan-intake.service.ts`からのdynamic importがproduction到達不能であることをtestするか、削除する。
3. 旧plan coordinator、queue handoff、post-queue review、closeout、phase continuationをlegacy分類する。
4. 現行persistent runtimeが旧serviceをimportしないことを全entrypointで検査する。
5. 旧serviceを直接呼ぶtestは`legacy characterization`として明示する。
6. 現行runtimeで同じproduct contractを証明した後に旧testを削除する。
7. 旧runtime用authorization V2 fixtureを現行live testで使用しない。
8. docsのImplementation statusとCheckpoint ledgerを現在実装に合わせて更新する。

### 禁止

- feature flagで旧runtimeと新runtimeを同時稼働する。
- 二重listener、二重write、dual completionを残す。
- 旧phaseから現行Agentの次actionを推測する。
- 旧serviceを「念のため」のfallbackとして呼ぶ。

### 完了条件

- production activation graphから旧coordinatorへの経路が0件。
- 現行runtimeのintegration / live testが旧testの必要contractを代替する。
- 旧runtimeの状態やphaseがsemantic decisionに使われない。

---

## R7: Production-Path Integration and Live Verification

### 目的

fixtureだけでなく、実際の`/play`、persistent runtime、provider、Task Operator、Run eventを通して動作を証明する。

### Integration scenarios

1. Play → Fact read → assistant response → wait。
2. Questionnaire draft save → intervention → state changed →再評価。
3. Artifact生成 →不備評価 →再生成。
4. `run.implementation.start` → Run ref receipt → terminal event → outcome read。
5. Run failure →具体的な修正依頼 →別Run →再評価。
6. Run success → verification評価 → `task.complete` → `agent.finish`。
7. user message割り込み →同じconversationで再評価。
8. Stop → in-flight provider/tool停止 →再起動しない。
9. process restart → receipt/eventから同じsessionを復元。
10. provider unsupported → Play前typed failure。
11. user permission変更 →次actionを拒否。
12. Coding Agent単体Run → Mission Pilotなしで従来通り完結。

### Live testの修正

既存`tests/live/mission-pilot-plan-pipeline-live.test.ts`をproduction証拠として扱わない。
新しいlive testは次を満たす。

- 公開`/mission-pilot/tasks/:taskId/play`を呼ぶ。
- 現行delegation contractを使う。
- persistent Agent session / turn / conversationを生成する。
- 実provider tool turnを使う。
- Task Operatorのgeneric toolだけを通る。
- 旧`runMissionPilotPlanPipeline`をimportしない。
- Coding Agent実装を変更しない。
- provider call、selected action、receipt、event、outcome、finishを監査できる。

### Release gate

fixture E2E成功だけでrelease可能としない。
少なくとも一つの実provider routeで、normal pathと一回のfailure/re-evaluation pathを通す。

---

## R8: Cleanup, Canary, and Final Gate

### 目的

compatibility、role漏れ、未使用経路を除去し、canary後に切替を完了する。

### Cleanup

1. Mission Pilot個別action registryを削除する。
2. Mission Pilot独自wait listを削除する。
3. 直接Run DB query adapterを削除する。
4. Coding Agent event payload reconciliationを削除する。
5. Queue / Task OperatorのMission Pilot固有field名を中立provenanceへ置換する。
6. 旧runtime activation pathを削除する。
7. 期限付きcompatibility aliasを削除する。
8. architecture baseline例外を0にする。

### Canary

canaryは現行persistent runtimeだけを対象にする。
旧runtimeとのtraffic splitは行わない。

観測項目:

- Play成功率。
- provider preflight failure率。
- first tool turn到達率。
- Task Operator command成功／typed failure率。
- receiptからresource refを復元できた割合。
- terminal event重複数。
- waiting / attention滞留時間。
- realtime version gap。
- user permission拒否数。
- action `outcome_unknown`数。
- Stop後wake発生数。

### Canary停止条件

- Mission Pilotだけが実行できるactionが見つかる。
- Coding Agent側の変更が必要になる。
- Run refをCoding Agent event本文から復元する必要が生じる。
- Task Operator以外のmutation経路が使われる。
- terminal eventが重複する。
- provider failure後にUI状態が更新されない。
- Stop後にmutationが実行される。

---

## 8. File Disposition

| Current file / family | Planned action |
| --- | --- |
| `api/modules/missionPilot/agent/mission-pilot-task-action.registry.ts` | 個別action正本を削除し、generic toolからTask Operator contractを読む |
| `api/modules/missionPilot/agent/mission-pilot-action-execution-metadata.ts` | completion metadataをTask Operator action正本へ移し、Mission Pilot複製を削除 |
| `api/modules/missionPilot/agent/mission-pilot-task-read.adapter.ts` | Task Operator action definitionをそのまま返す |
| `api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts` | Delegated User PrincipalとTask Operator receiptだけを扱う |
| `api/modules/missionPilot/agent/mission-pilot-action-command-executor.ts` | Task Operator public command以外の依存を禁止 |
| `api/modules/missionPilot/agent/mission-pilot-action-execution.repository.ts` | Run / Queue DB探索とCoding Agent event payload解析を削除 |
| `api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter.ts` | 削除し、Task Operator `run_outcome` queryへ統一 |
| `api/modules/missionPilot/agent/mission-pilot-conversation-query.repository.ts` | runtime state更新とControl Summary version / realtime連携を分離・明示 |
| `api/modules/missionPilot/mission-pilot.service.ts` | terminal event source、provider preflight、realtime publishを整理 |
| `api/modules/missionPilot/mission-pilot-plan-intake.service.ts` | 旧coordinator dynamic importを削除またはproduction到達不能化 |
| `api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts`等 | legacy隔離後に削除 |
| `api/modules/taskOperator/policies/task-operator-command-catalog.ts` | action definitionの唯一の正本へ拡張 |
| `api/modules/taskOperator/application/task-operator.command.ts` | typed result / receipt、role非依存execution contextへ整理 |
| `api/modules/taskOperator/application/task-operator.detail-query.ts` | Run outcomeを含むbounded resource queryの正本を維持 |
| `api/modules/queue/queue-admission.service.ts` | Mission Pilot固有optionをrole非依存command provenanceへ置換 |
| `api/modules/queue/queue-repository-command.types.ts` | Mission Pilot固有型importを削除 |
| `api/modules/agentsShare/events/task-run-events.ts` | Agent非依存terminal eventとして維持し、event identityを強化 |
| `api/modules/agentsShare/contracts/coding-agent-run.ts` | 本計画では変更せず、Mission Pilotから参照しない |
| `api/modules/agentsShare/ports/coding-agent-run.ts` | 本計画では変更せず、Task Run application bridge内部に隔離 |
| `tests/live/mission-pilot-plan-pipeline-live.test.ts` | legacy characterizationへ降格または削除 |
| 新規persistent runtime live test | 公開Play routeと実providerを通すproduction証拠として追加 |

`api/modules/codingAgent/**`はDisposition対象に含めない。

---

## 9. Verification Matrix

| Contract | Required evidence |
| --- | --- |
| Mission Pilotはユーザー以下の権限 | delegated-user parity integration |
| Mission Pilot専用の追加能力がない | available action差分test |
| Mission PilotはCoding Agentをimportしない | module boundary |
| Mission PilotはCoding Agent固有contractをimportしない | source architecture test |
| Coding AgentはMission Pilotをimportしない | existing boundary regression |
| Mission PilotはRun / Queue DBを直接読まない | repository boundary test |
| Coding Agent event本文をparseしない | forbidden marker test |
| Action definitionが一つ | catalog / executor set equality |
| orphan actionがない | every advertised action executable test |
| Questionnaire介入を迂回しない | draft / intervention / submit integration |
| Artifact再生成contractが一意 | artifact action contract test |
| Run start receiptにRun refがある | command receipt integration |
| resume / stop / outcomeが同じRun refを使う | Run lifecycle integration |
| terminal eventが一度だけ届く | event idempotency test |
| Run成功でTaskを暗黙完了しない | completion negative test |
| `task.complete`だけがTask完了を確定 | explicit completion integration |
| waiting / attentionがrealtime更新される | websocket projection test |
| provider unsupportedをPlay前に検出 | capability preflight test |
| 旧runtimeがproduction到達不能 | activation graph test |
| 実providerでpersistent runtimeが動く | live test |
| Coding Agent単体動作が維持される | existing standalone regression |
| Coding Agent file差分がない | path diff gate |

---

## 10. Verification Commands

### Focused

```bash
node scripts/run-vitest.mjs run \
  tests/mission-pilot-user-equivalent-boundary.test.ts \
  tests/mission-pilot-shared-storage-boundary.test.ts \
  tests/task-operator-role-neutrality.test.ts \
  tests/mission-pilot-coding-agent-independence.test.ts \
  tests/mission-pilot-agent-runtime.test.ts \
  tests/mission-pilot-agent-action-idempotency.test.ts \
  tests/mission-pilot-agent-questionnaire.test.ts \
  tests/task-operator-contract.test.ts \
  tests/role-module-boundary.test.ts
```

### Architecture

```bash
node scripts/check-module-boundaries.mjs
node scripts/check-task-operator-boundary.mjs
node scripts/check-coding-agent-semantic-control.mjs
bun run check:architecture
```

### Quality

```bash
bun run typecheck
bun run lint
bun run verify:base
```

### Coding Agent untouched gate

実装開始前のdirty差分をledgerへ記録した上で、Checkpointごとに次を確認する。

```bash
git diff --name-only -- \
  api/modules/codingAgent \
  src/modules/codingAgent \
  shared/modules/codingAgent
```

本計画による追加差分が一件でもあればCheckpointを失敗とする。

### Live

release用の明示環境でのみ実行する。

```bash
NIGHTWORKERS_LIVE_MISSION_PILOT=1 \
NIGHTWORKERS_LIVE_MISSION_PILOT_PROVIDER=codex \
NIGHTWORKERS_LIVE_MISSION_PILOT_MODEL=gpt-5.6-sol \
  node scripts/run-vitest.mjs run \
  --config vitest.live.config.ts \
  tests/live/mission-pilot-persistent-agent-live.test.ts
```

live testが実行できない環境では、release gateをpassedにしない。

---

## 11. Checkpoint Sequence

| Checkpoint | Work package | Required evidence |
| --- | --- | --- |
| M0 | R0 baseline / ledger | baseline、production graph、dirty change record |
| M1 | R1 boundary guardrails | fail-first boundary tests |
| M2 | R2 canonical action contract | action set equality、Questionnaire / Artifact contract |
| M3 | R3 delegated user authorization | user parity tests |
| M4 | R4 Run receipt / outcome boundary | receipt recovery、DB / event payload dependency zero |
| M5 | R5 runtime lifecycle / realtime | event idempotency、version、provider preflight |
| M6 | R6 legacy isolation | production activation residue zero |
| M7 | R7 integration / live | persistent runtime normal + repair live |
| M8 | R8 cleanup / canary | architecture baseline zero、canary exit criteria |

Checkpoint statusは次だけを使用する。

- `pending`
- `in_progress`
- `blocked`
- `passed`

Coding Agent側の追加差分、未実行live test、legacy production経路、境界baseline例外が残る状態を`passed`にしない。

---

## 12. Rollback Rules

- 一つのCheckpointだけを進める。
- Checkpoint開始時に対象fileと既存dirty hunksを記録する。
- `git reset --hard`、`git checkout --`、`git restore`、working tree全体のstashを使用しない。
- rollbackはそのCheckpointで追加したhunkだけを明示的に戻す。
- canonical action contract切替はreader、contract、executorを同じCheckpointで扱う。
- terminal event source切替は旧listenerと新listenerを同時にproduction登録しない。
- legacy runtimeをfallbackとして再有効化しない。
- provider live failure時に未確認mutationがある場合は、receiptとTask Operator resourceを確認してから再試行する。
- rollbackのためにCoding Agentへ互換処理を追加しない。

---

## 13. Stop Conditions

次の場合は実装を停止する。

1. Coding Agent production implementationの変更が必要になった。
2. Mission PilotからCoding Agent固有portを直接呼ばないと成立しない。
3. Coding AgentのDB、event本文、context snapshotを読まないとRunを関連付けられない。
4. ユーザーより強い権限をMission Pilotへ与えないと既存動作を再現できない。
5. Task OperatorへMission Pilot固有branchを追加しないとcommandを実行できない。
6. Questionnaire介入を迂回しないと自動化できない。
7. Artifact再生成をCoding Agentへ移さないと実装できない。
8. 旧runtimeとpersistent runtimeの同時稼働が必要になった。
9. provider実経路を検証できない。
10. 既存dirty changeを安全に保持できない。

停止時は、該当file、import chain、必要とされた権限、ユーザー共通APIに不足しているcontractを記録する。
境界を破って先へ進まない。

---

## 14. Definition of Done

### User equivalence

- Mission Pilotが読めるFactはユーザー共通Task Operator projection / resourceだけ。
- Mission Pilotが実行できるactionはユーザー共通Task Operator commandだけ。
- 有効権限がuser capability、Play delegation、action availabilityの積集合。
- Mission Pilot専用の特権route、DB mutation、confirmation bypassが0件。
- Mission Pilotのfilesystem、shell、Git primitiveが0件。

### Responsibility

- Mission PilotがTask解釈、Questionnaire回答案、Plan routing、Artifact判断、Run依頼、結果評価、次action、完了判断を所有する。
- Coding Agentがrepository調査、編集、command、Todo、検証、結果生成を所有する。
- Run成功だけでTaskが完了しない。
- `task.complete`と`agent.finish`が分離される。
- hostが意味判断や固定workflowを所有しない。

### Dependency

- Mission PilotからCoding Agentへの直接importが0件。
- Mission PilotからCoding Agent固有contractへのimportが0件。
- Coding AgentからMission Pilotへのimportが0件。
- Mission PilotからCoding Agent DB / event本文 / context snapshotへの依存が0件。
- Task Operator、Queue、provider共通層のMission Pilot固有branchが0件。
- agentsShareにrole固有semantic decisionが0件。

### Contract

- Action definitionの正本が一つ。
- orphan actionが0件。
- `plan.artifact.regenerate`の扱いが一意。
- Questionnaire submit / intervention contractが一意。
- Start、resume、stop、outcome、terminal eventが同じRun refで結ばれる。
- crash recoveryがTask Operator receiptだけで成立する。

### Runtime

- persistent Agent Runtimeだけがproduction activationされる。
- 旧coordinatorへのproduction経路が0件。
- waiting、attention、completed、stoppedがrealtimeで反映される。
- provider capabilityをPlay前に検証する。
- Stop後に遅延mutationがない。
- LLM本文とfailure本文を固定文へ差し替えない。

### Evidence

- focused testが成功。
- architecture checkが成功。
- typecheck、lint、verify:baseが成功。
- persistent runtimeの実provider live testが成功。
- normal pathとfailure / re-evaluation pathが成功。
- Coding Agent単体回帰が成功。
- Coding Agent production implementationに本計画由来の差分が0件。
- canary停止条件に該当しない。

---

## 15. Checkpoint Ledger

| Checkpoint | Status | Commit | Verification | Evidence / Remaining risk |
| --- | --- | --- | --- | --- |
| M0 Baseline / ledger | passed | uncommitted | baseline、activation graph、Coding Agent digestを記録 | baseline failureをM2からM5で解消 |
| M1 Boundary guardrails | passed | uncommitted | architecture、user-equivalent boundary test | 新規role境界違反0件 |
| M2 Canonical action contract | passed | uncommitted | catalog / executor / fixture catalog test | orphan action 0件、submit非公開 |
| M3 Delegated user authorization | passed | uncommitted | delegated authorization test、live permission revocation | user capabilityとの積集合をcommandごとに検証 |
| M4 Run receipt / outcome boundary | passed | uncommitted | Task Operator contract / regression、repair E2E | Run / Queue scanとCoding Agent event本文parseを除去 |
| M5 Runtime lifecycle / realtime | passed | uncommitted | runtime / completion / action trace、全E2E | provider preflight、version publish、finish retryを検証 |
| M6 Legacy isolation | passed | uncommitted | legacy ownership firewall、activation graph、source boundary | 旧coordinator production consumer 0件 |
| M7 Integration / live | passed | uncommitted | Mission Pilot E2E 7/7、実Codex provider 1/1 | normal、repair、restart、interrupt、permission failureを通過 |
| M8 Cleanup / canary | passed | uncommitted | `verify:base`、Coding Agent 20 files / 131 tests | production deployは未実施。隔離canaryとrelease gateは通過 |

各Checkpointで、Coding Agent untouched gate、変更file、実行test、未解決riskを必ず更新する。
時間やtokenの都合だけで、未検証のCheckpointを`passed`にしない。
