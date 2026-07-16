# Mission Pilot Autonomous Agent Hardening Implementation Plan

## Status

- Concept status: `locked`
- Plan status: `implementation-ready; Luna overnight handoff audited`
- Implementation status: `not started`
- Review baseline: 2026-07-16
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target implementation baseline: `4309d798` plus the pre-existing working tree recorded when Luna starts
- Related concept document: `spec/docs/mission-pilot-persistent-agent-refactor-plan.md`

この文書は、永続Agent Runtimeを一度実装した後のレビュー結果を反映したhardening計画である。元のコンセプト文書は「何を目指すか」の正本として残し、この文書を「現在の実装をどう直し、どの証拠をもって切り替えるか」の実装正本とする。

本計画の完成条件は次の一文に集約する。

> Mission Pilotは、Task Goalと現在のFactを自分で読み、必要な調査をCoding Agentへ依頼し、利用可能な操作を自分で選び、結果や失敗を再評価し、権限や不可逆な選択によって本当にユーザー判断が必要になるまで自律的に試行を続け、明示的な完了操作が成立した場合だけTaskを完了する。

UIを増やしたり、固定workflowを別の固定workflowへ置き換えたりすることは目的ではない。現在の手続き型正常系はLLMが選択できる行動列として維持し、hostはauthorization、revision、lease、idempotency、resource budget等の構造的不変条件だけを強制する。

## 1. Review Conclusion

### 1.1 現在できていること

現在の実装には、LLM主導Agentの土台がすでにある。

- Task単位の永続session、turn、conversation、tool call、event inboxがある。
- provider responseからnative toolを実行し、tool resultをconversationへ戻して再samplingするloopがある。
- Task read port、Task action registry、authorization、revision、lease、context compactionがある。
- Questionnaire回答案、Implementation/Test/Review/Git/complete/archiveをactionとして表現している。
- Coding Agentの逐次transcriptではなく、terminal outcomeを読む境界がある。
- Agent配下にTask本文やerror messageのkeyword分類によるnext-action決定は確認されていない。

したがって作り直すべき対象はAgent全体ではなく、LLM loopと既存Task lifecycleの間に残った競合、非同期失敗、観測、side effectの境界である。

### 1.2 現在の重大な弱点

| Priority | 弱点 | 現在起き得ること | 改修の中心 |
| --- | --- | --- | --- |
| P0 | Run終了とTask Goal完了が分離されていない | Implementation成功だけでTaskが`completed`になり、LLMがTest、Review、修正、完了を判断する前にsessionが閉じる。Run失敗でTaskが`failed`になり、修正Runを開始できない | Agent-owned RunではRun outcomeを保存してTaskを非terminalへ戻し、`task.complete`だけがGoal完了を確定する |
| P1 | Agent所有sessionへlegacy recoveryが侵入できる | restart後にlegacy coordinatorがphaseを進める、停止する、attentionにする | すべてのentry pointで一つのownership判定を通す |
| P1 | idempotencyがtool call内で閉じている | mutation成功後、result保存前にprocessが落ちると、別tool callから同じRun、Queue、Git操作を重複実行し得る | action intent、application command、作成resourceを同じdurable idempotency keyで結ぶ |
| P1 | assistant-only turnがユーザーから見えない | LLMが質問や報告を書いて`waiting`になっても、既存UIに内容が投影されない | 本文を改変せず既存Pilot Thought / Task messageへ投影する |
| P1 | 非同期失敗がLLMへ戻らない経路がある | Questionnaire submit失敗等でhostがsessionを停止し、LLMは別案、再試行、質問を選べない | typed eventとして同じconversationへ返し、recoverable failureではplayingを維持する |
| P1 | 修正loopのE2E証拠が不足している | 部品が存在しても、失敗→調査→修正依頼→再検証→完了を通しで保証できない | deterministic provider fixtureを使うnormal/repair/restart E2Eを切替gateにする |
| P2 | runtimeにaction名の固定配列が残る | action追加時に待機・完了挙動が複数箇所へ分散し、LLM loopとregistryがずれる | registryへ構造的なexecution metadataを集約する |
| P2 | Codex routeだけの環境ではprovider非対応になり得る | Mission Pilotが開始できず自立性を評価できない | candidate fallback契約を維持し、provider capabilityを起動前に検証する |

### 1.3 評価基準

「LLM側に主権がある」は、Promptにそう書いてあることではなく、次の状態遷移で評価する。

1. LLMがFactを読む。
2. LLMがactionを選ぶ。
3. hostが構造的に検証してactionを実行する。
4. 結果または失敗が同じLLM conversationへ戻る。
5. LLMが次のaction、待機、ユーザーへの質問、完了を選ぶ。

途中でhostがTaskの意味を解釈して別工程を開始したり、recoverable failureで停止したり、Run成功だけでTaskを完了した場合は主権が分断されている。

## 2. Locked Product and Compatibility Contract

### 2.1 自立性の定義

Mission Pilotは次の能力を一つの継続sessionとして持つ。

- Goal、acceptance criteria、user message、Questionnaire Decision、Artifact、Run outcomeを必要に応じて読む。
- repositoryの実情が必要なら、登録済みProjectのrepo rootを対象に同じCoding Agent runtimeへ調査依頼を送る。
- Implementation、Test、Review、Git、Task actionから現在必要なものを選ぶ。
- errorに遭遇したら、現在のFactを再取得し、同じCoding Agent runtimeへ具体的な修正依頼を送り、結果を再評価する。
- 前の試行が不十分なら、別のPrompt、追加調査、再Test、再Reviewを自分で選ぶ。
- Task Goalを満たした証拠を読んだ後だけ、明示的にTaskを完了する。
- ユーザーだけが決められる情報、追加権限、不可逆な選択が必要な場合だけ質問する。

### 2.2 手続き型正常系との両立

次の行動列は引き続き再現できなければならない。

```text
Questionnaire
  -> Plan
  -> Implementation
  -> Test
  -> Review
  -> Commit
  -> Complete
  -> Archive
```

ただしこれはhostの固定transitionではない。TaskによってLLMはQuestionnaire、Test、Review、Commitの要否や順序を判断できる。既存phaseは表示用projectionであり、次actionの入力正本にしない。

### 2.3 変更しないもの

- `MissionPilotControlPanel`の配置、Play/Stop操作、既存文言、既存状態表示。
- 既存route pathと公開request/response schema。
- Questionnaireの既存UIとユーザー介入時間。
- Pilot ThoughtとCoding Agent chatの表示分離。
- Task、Plan Mode、Test Mode、Review Modeの既存操作面。
- Coding Agentのruntime。repair専用mode、意味別mode、固定workflow、Mission Pilot専用tool allowlistを追加しない。
- 人間ユーザーに許可されていないfilesystem、Git、network、external service操作をMission Pilotへ追加しない。
- 現在成功しているtest assertionを新runtimeへ合わせるために弱めない。

### 2.4 非目標

- Mission Pilotへ直接shellまたはfile edit toolを与えること。
- Coding Agent内部の推論や逐次transcriptをSupervisor contextへ流すこと。
- error message、Task本文、assistant本文のkeywordや正規表現でrepair方針を決めること。
- Test、Review、Commitを常に必須にすること。
- UIへ新しい確認panel、承認button、runtime用語を追加すること。
- hardeningと同時にlegacy実装全体を削除すること。

## 3. Target Authority Model

### 3.1 Authorityの分離

| Authority | 所有者 | 内容 |
| --- | --- | --- |
| Goal authority | LLM | Taskを何をもって完了と判断するか、どの証拠を読むか |
| Planning authority | LLM | 次に読む情報、実行するaction、Coding Agentへ送るPrompt |
| Recovery authority | LLM | 失敗後の再試行、修正、代替手段、ユーザー質問 |
| Structural authority | host | schema、authorization、revision、lease、idempotency、transaction、budget |
| Side-effect authority | application command | userと同じ権限・preconditionでmutationを成立させる |
| Task completion authority | explicit command | LLMまたは人間が呼ぶ`task.complete`。Run terminal statusから暗黙に推定しない |
| Session completion authority | agent lifecycle | Task完了済み、副作用確認済み、待機eventなしを確認した`agent.finish` |

### 3.2 Run outcomeとTask Goal statusの分離

Agentが開始したRunについて、Run statusとTask statusを次のように扱う。

| 状況 | Run status | Task status | Agent runtime |
| --- | --- | --- | --- |
| Run開始 | `queued` / `running` | `queued` / `running` | `waiting` |
| Run成功 | `completed`等のterminal status | `needs_review` | terminal eventで再開 |
| Run失敗 | `failed` / `needs_human`等 | `needs_review` | terminal eventで再開 |
| LLMが追加Runを選択 | 新Runを作成 | `queued` / `running` | `waiting` |
| `task.complete`成功 | terminal source Runは保持 | `completed` | follow-up samplingを継続 |
| `task.archive`成功 | 変更なし | `archived` | follow-up samplingを継続 |
| `agent.finish`成功 | 変更なし | `completed`または`archived` | `completed` |

`failed` Runを成功に見せてはいけない。Taskを非terminalへ戻すのは失敗を隠すためではなく、LLMが失敗を読み修正Runを開始できるようにするためである。Run outcomeは正確なterminal status、final report、blocker、verification summaryを保持する。

### 3.3 Ownership firewall

`MissionPilotRuntimeOwnership`を唯一の判定serviceとして導入する。

```ts
type MissionPilotRuntimeOwnership =
  | { kind: "agent"; sessionId: string }
  | { kind: "legacy"; sessionId: string }
  | { kind: "none" };
```

次のすべてのentry pointは処理開始前にownershipを確認する。

- Play / Stop / resume。
- process startup reconciliation。
- pre-Queue recovery、post-Queue recovery、Plan coordinator、Review/Test continuation、closeout。
- Run terminal callback、Questionnaire event、Task message event。
- stale Run recovery、Queue activation failure、runtime preparation failure。

`agent`所有sessionをlegacy serviceが更新してはならない。`legacy`所有sessionをagent wakeがclaimしてはならない。ownership不明時に両方を試さず、typed diagnosticを記録して安全に停止する。

## 4. Target Runtime Loop

### 4.1 Current-step context

providerを呼ぶ直前に毎回`MissionPilotCurrentStepContext`を構築する。一度作ったPlay時contextを使い続けない。

```ts
type MissionPilotCurrentStepContext = {
  sessionRef: { id: string; revision: number };
  taskRef: { id: string; revision: number; status: string };
  authorizationRef: { version: number; digest: string };
  projectRef: { id: string | null; registeredRepoRoot: string | null };
  activeRunRefs: Array<{ id: string; kind: string; status: string }>;
  latestTerminalRunRefs: Array<{ id: string; status: string; outcomeDigest: string }>;
  unreadEventRange: { from: number | null; through: number | null };
  availableActionDigest: string;
};
```

このcontextは参照とrevisionを渡す。TaskやArtifact全文を無条件に詰め込まず、read toolでpagingして取得可能にする。要約・compaction後も採用済み判断、未解決事項、実行済み操作、source digest、paging情報を失わない。

### 4.2 One authoritative loop

```text
claim session lease
  -> consume typed events
  -> reconcile unfinished action receipts
  -> build current-step context and available tools
  -> call provider
  -> persist assistant body and tool calls
  -> no tool call: project assistant body, wait for event
  -> tool call: persist intent before mutation
  -> execute or reconcile through application command
  -> persist typed result
  -> feed result back to the same conversation
  -> resample, wait, or explicitly finish
```

loop内でTask phaseから次actionを選ばない。実行結果をLLMへ返さずに別serviceが次工程を開始しない。

### 4.3 Action metadataの集約

現在runtimeにあるaction名の固定配列を`MissionPilotActionDefinition`へ移す。

```ts
type MissionPilotActionExecutionMetadata = {
  effect: "read" | "mutation";
  completion: "immediate" | "wait_for_event" | "finish_candidate";
  expectedEventTypes?: MissionPilotTaskEventType[];
  authorizationScope: MissionPilotAuthorizationScope;
  reconciliation: "none" | "query_receipt" | "query_resource";
};
```

これは意味別workflowではない。副作用の成立確認方法と非同期結果の待ち方という構造的契約である。available tool definitionは毎sampling時にauthorizationとstructural preconditionから再生成する。実行不能なactionも`list_available_task_actions`では理由付きで見えるようにする。

### 4.4 Waitingとsession completion

assistant本文だけでTaskやsessionを完了扱いにしない。次の二つの構造toolを追加する。

```ts
agent.wait_for_event({
  eventTypes: string[],
  reason: string
})

agent.finish({
  summary: string
})
```

- `agent.wait_for_event`は待機対象を明示するだけで、意味判断をhostへ移さない。
- 質問が必要ならLLMは先に`task.message.send`を呼び、その後にuser message eventを待つ。
- `agent.finish`はTaskが`completed`または`archived`、active mutationなし、未確定receiptなし、未消費eventなしの場合だけ成功する。
- `task.complete`や`task.archive`成功後も結果をLLMへ返し、LLMが最終報告と`agent.finish`を行う。
- tool callのないassistant responseは本文を改変せず既存Pilot Thought / activity projectionへ表示し、sessionは`waiting`にする。

## 5. Information Acquisition and User Interruption Policy

### 5.1 Mission Pilotが自分で取得する情報

必要なread toolを次の観点で棚卸しする。

- Task Goal、acceptance criteria、user message、現在status、revision。
- Questionnaire session、questions、draft、confirmed decisions。
- Plan Artifactのindex、source revision、content page。
- active/terminal Run index、terminal outcome、verification、blocker、changed path summary。
- Test/Review sessionとresult summary。
- Queue、Git closeout、merge、archiveの現在状態。
- 利用可能actionとunavailable reason。
- 登録済みProjectとrepo rootの参照情報。

repositoryの内容そのものが必要な場合、Mission Pilotは直接filesystemを読まない。同じCoding Agent runtimeへ「調査してFactと参照を返す」Promptを送り、terminal outcomeを読む。調査、実装、repairでruntime modeを分けない。

### 5.2 ユーザーへ質問する閾値

System Contextに次の原則を日本語で記載する。ただしhostでチェックリストを強制したり、本文から質問判定をしない。

Mission Pilotは、次のいずれかに該当するまでユーザーへ判断を返さない。

- 現在の権限では実行できず、追加権限が必要。
- 不可逆または外部影響の大きい選択で、人間の明示確認が契約上必要。
- 複数の解釈が中核成果を変え、Task、Questionnaire、Artifact、repositoryから合理的に補完できない。
- 安全なread、状態再取得、限定retry、Coding Agentへの調査・repair依頼を行ってもblockerが残る。
- user secret、credential、外部coordination等、Agentが取得してはならない情報が必要。

命名、軽微な実装選択、後で安全に変更できるdetail、一般的なbest practiceは合理的に補完する。

### 5.3 観測結果とTodo

Task TodoはLLMまたは人間の明示commandだけで更新する。Run terminal eventやverification resultを受けたhostがTodoを暗黙更新してはならない。Mission PilotがTodo更新を必要と判断した場合は、既存の明示application commandを使用する。

## 6. Durable Side Effects and Idempotency

### 6.1 問題

現行の`mission_pilot_tool_calls.idempotency_key`はtool callの重複claimを防げるが、application commandが同じkeyを永続的に受け取らず、mutation後・tool result保存前のcrashを完全にはreconcileできない。

### 6.2 Action execution receipt

additive migrationで`mission_pilot_action_executions`を追加する。

```text
id
session_id
task_id
tool_call_id
action_id
idempotency_key
arguments_digest
expected_task_revision
status                  pending | executing | succeeded | failed | outcome_unknown
result_json
failure_json
source_resource_type
source_resource_id
created_at
started_at
finished_at
updated_at
```

制約:

- `unique(session_id, idempotency_key)`。
- `unique(tool_call_id)`。
- arguments digest不一致で同じkeyを再利用した場合は`invalid_request`。
- result本文、provider本文、failure本文は保持する。
- receiptを作成してからmutationを開始する。

### 6.3 Application command contract

すべてのMission Pilot mutationを次の共通contextで呼ぶ。

```ts
type MissionPilotCommandContext = {
  actor: { kind: "mission_pilot"; sessionId: string; taskId: string };
  idempotencyKey: string;
  sourceRef: { toolCallId: string; actionExecutionId: string };
  expectedTaskRevision: number;
};
```

各application commandは可能な限りdomain resourceにidempotency keyまたはsource referenceを保存し、同じkeyなら既存結果を返す。Run作成、Queue投入、Questionnaire mutation、Git closeoutは必須対象とする。

### 6.4 Crash reconciliation

1. wake開始時に`executing`または`outcome_unknown` receiptを読む。
2. application command receiptまたは作成resourceをidempotency keyで検索する。
3. 成立済みなら同じtyped resultを再構成してconversationへ投影する。
4. 未成立が確実な場合だけ同じkeyで再実行する。
5. 成立有無を判定できないmutationは自動再実行しない。`outcome_unknown`をLLMへ返し、read toolで現在状態を確認させる。
6. 新しいprovider tool callを、古い未確定mutationの再実行許可として扱わない。

副作用retryはtransport retryと分離する。LLM providerへのretryが許されても、Git push等のmutationを無条件に再送してはならない。

## 7. Run, Repair, and Verification Loop

### 7.1 Shared Run start command

`run.implementation.start`はMission Pilot専用DB更新ではなく、UIと共有するapplication commandを使用する。

```ts
startTaskRunFromPrompt({
  taskId,
  request,
  sourceRunId,
  commandContext,
  missionPilotAgent: {
    sessionId,
    toolCallId,
    idempotencyKey,
    completionOwner: "mission_pilot"
  }
})
```

要件:

- `ready` / `queued`だけでなく、active Runが存在しないAgent-owned Taskの`needs_review`からfollow-up Runを開始できる。Agent-owned terminal Run後のTask statusは成功・失敗とも`needs_review`に固定し、別statusを選ばない。
- 同じ権限・preconditionは人間の同等操作にも適用可能であり、Agentだけのbypassを作らない。
- `sourceRunId`によりrepairの対象を明示する。
- LLMが生成したrequestをhostの固定repair文へ置換しない。
- temporary directoryをworkspaceとして渡さず、登録済みProjectのrepo rootをworker tool境界で解決する。

### 7.2 Terminal outcome contract

Mission Pilotへ返すRun outcomeは次だけを正本とする。

```ts
type MissionPilotRunOutcome = {
  runId: string;
  status: string;
  finalReport: string | null;
  blocker: string | null;
  verificationSummary: unknown | null;
  changedPathSummary: string[];
  artifactRefs: Array<{ type: string; id: string; digest?: string }>;
  sourceRevision: number;
  sourceDigest: string;
};
```

raw reasoning、tool log、stdout/stderr全文を含めない。全文が必要ならTaskの権限内でpaging可能な既存artifactまたはdiagnostic参照を返す。

### 7.3 Repair loop

```text
terminal Run event
  -> LLM reads outcome and relevant Task/Artifact facts
  -> LLM decides whether repair is needed
  -> LLM writes a concrete Coding Agent request
  -> same Coding Agent runtime executes in registered repo root
  -> terminal outcome returns to the same Mission Pilot session
  -> LLM decides test, review, another repair, user question, or completion
```

`mission_pilot_repair_requests`は監査とsource linkageに使う。repair方針をhostが生成する正本にはしない。固定回数で諦めず、resource budget到達時は現在の成果、未解決事項、再開方法を保持して`attention`にする。

### 7.4 Run finalizationの修正範囲

少なくとも次の経路を一つのTask status projection policyへ統合する。

- `api/modules/nightworkers/run-orchestration/runtime-execution.ts`
- `api/modules/nightworkers/run-orchestration/runtime-execution-failure.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- `api/modules/nightworkers/run-orchestration/queues.ts`
- `api/modules/missionPilot/mission-pilot-post-queue-coordinator.service.ts`

各経路が個別に`Task=failed/completed`を決めない。Run ownershipを読み、通常Taskは現行挙動、Agent-owned Taskは`needs_review + terminal event`へ投影する。

## 8. Failure Recovery Contract

### 8.1 Failure分類

分類はhostがerror本文から意味推定して行わず、発生境界がtyped failureを生成する。

| Failure kind | Host behavior | LLMへ戻す内容 |
| --- | --- | --- |
| schema validation | 実行しない | field単位のvalidation resultと元のtool arguments参照 |
| permission | 実行しない | denied scope、resource ref、現在authorization revision |
| revision conflict | 実行しない | current revisionと再取得先 |
| domain precondition | 実行しない | application commandが返した本文を保持 |
| retryable transport | 上限付きbackoff、Stopでcancel可能 | attempt、next retry、最後のprovider本文 |
| provider unsupported | candidate fallbackを順に試す | tried candidatesとunsupported reason |
| outcome unknown | 自動mutation retryを止める | receipt、resource query結果、未確定事項 |
| resource limit | sessionを再開可能なattentionへ | 採用済み判断、未解決事項、実行済み操作、budget |
| async domain failure | eventを永続化してwake | source action、failure、current revision |

### 8.2 Provider retry

`llm-provider`の責務をprovider呼出し、JSON抽出、schema検証、typed failure、最小互換正規化に限定する。

- retry対象は明示的にretryableなtimeout、rate limit、一時transport障害だけ。
- provider candidateごと、wakeごと、sessionごとの上限を持つ。
- Stopで待機timerを解除する。
- LLMへ到達した場合は返された本文を固定診断文へ置き換えない。
- parse/schema failureでもraw response bodyとdigestを保持する。
- Codex-only endpointをnative tool-turn providerとして暗黙対応扱いしない。対応capabilityがない場合は起動前にunsupportedを検出し、設定済みcandidate fallbackを使う。

### 8.3 Questionnaire failure

Questionnaire draft確定、auto-submit、follow-up生成が失敗した場合、recoverable failureで`desiredState=stopped`へ直接遷移しない。

```text
questionnaire.submission_failed event
  -> same agent session wake
  -> LLM reads current questionnaire state
  -> retry / draft update / alternative action / task.message.send / wait
```

20秒の介入UIと既存APIは維持する。LLMは`questionnaire.submit`で介入時間を迂回しない。

### 8.4 User interruption

ユーザーが待機中またはRun実行中に新しい指示を送った場合、同じsessionへrevision付きeventとして入れる。

- 未開始actionは新しい指示を含む次samplingで再判断する。
- 実行中mutationを本文の意味で勝手にcancelしない。明示StopまたはLLMの`run.stop`を使う。
- compaction後も最新の明示指示が採用済み判断より優先されることを保持する。

## 9. Communication and Observability

### 9.1 Existing UIへの投影

新UIは追加しない。次を既存のPilot Thought / Task activity / Task message contractへ投影する。

- assistant-only response。
- ユーザーへ送った質問。
- wait reasonの短い状態説明。
- Run terminal summaryと次の判断へ進んだ事実。
- attention時のblockerと再開方法。
- 最終summary。

LLM本文は通信障害時を除き固定文へ置換しない。raw reasoningや内部conversation全体は表示しない。

### 9.2 Execution query

`mission-pilot-execution-query.service.ts`がAgent sessionについても、既存consumer contractを壊さないappend-only projectionを返すようにする。

- turn開始・終了。
- provider call metadata。
- tool actionとtyped result。
- event受信。
- assistant visible projection。
- wait、attention、finish。

秘密情報、reasoning、worker transcriptは除外する。既存legacy traceはlegacy ownership時だけ読む。

### 9.3 Metrics

最低限、次をsession/task/actionId/provider別に計測する。

- wake count、provider call count、tool call count。
- wait reasonと待機時間。
- action success/failure/reconciliation count。
- duplicate prevented count、outcome_unknown count。
- provider retry/fallback count。
- repair Run countとrepair後success率。
- user question countと、質問前に実施したread/action count。
- Task開始から明示completeまでの時間。
- Task complete前のterminal Run数。

成功率だけでなく、ユーザー介入回数と重複副作用ゼロをrelease判断に使う。

## 10. Implementation Checkpoints

各Checkpointは単独commitにし、gateを通してから次へ進む。既存の未コミット変更を混ぜず、開始時の`git status --short`を証拠として保存する。

### H0: Baseline and fail-first characterization

目的: 現在の欠陥を再現し、修正前にtestが正しい理由で失敗することを確認する。

実装:

- 現在のMission Pilot unit、architecture、typecheck、主要E2Eのbaselineを再採取する。
- 次のfail-first testを作業treeで追加して一度失敗を確認する。H0ではcommitせず、各testは対応するH1-H8のproduction fixと同じgreen commitへ含める。
  - Implementation成功だけではTaskが完了しない。
  - Implementation失敗後に同じsessionからrepair Runを開始できる。
  - agent ownership sessionへstartup legacy recoveryが触れない。
  - assistant-only responseが既存UI queryへ現れる。
  - Questionnaire非同期失敗がLLM eventへ戻る。
  - mutation後・result保存前のcrashで重複Runが作られない。

Gate:

- 追加testが現在の欠陥箇所で失敗し、failure locationとmessageをledgerへ記録する。
- 既存testのassertionを変更しない。
- baselineの失敗がworking tree由来なら先へ進まず、対象差分を分離する。

Commit: なし。red testだけのcommitを作らない。

### H1: Central ownership firewall

目的: 一つのsessionをAgentとlegacyが同時に動かさない。

実装:

- `mission-pilot-runtime-ownership.service.ts`を追加し、DB上の`mission_pilot_agent_sessions` rowを唯一のownership正本にする。in-memory active registryはwake最適化にだけ使い、ownership判定に使わない。
- Play、Stop、startup、legacy recovery、coordinator、terminal callbackに共通guardを入れる。
- legacy path一覧をarchitecture testのmanifestへ固定する。
- ownership不明時のtyped diagnosticとsafe stopを追加する。

Gate:

- restart中のagent sessionをlegacy phaseが変更しない。
- legacy sessionの既存testとE2Eは無変更でpassする。
- `rg`ベースarchitecture testで未guard entry pointを検出する。

Rollback: guard導入commitだけをrevertできる。schema変更なし。

Commit: `fix(mission-pilot): H1 isolate agent runtime ownership`

### H2: Task completion sovereignty

目的: Run terminal statusとTask Goal statusを分離する。

実装:

- `StartTaskRunOptions`へ内部用`missionPilotAgent` envelopeを追加し、Run作成時の`contextSnapshot.missionPilotAgent`へ`sessionId`、`toolCallId`、`idempotencyKey`、`completionOwner: "mission_pilot"`を保存する。別のRun ownership方式を追加しない。
- Run finalizationのTask status projectionを一つのserviceへ集約する。
- Agent-owned terminal RunはTaskを`needs_review`へ投影し、typed terminal eventを発行する。
- `assertRunnableWorkbenchTask`相当のpreconditionを共有commandへ移し、active Runがない`needs_review` Taskからfollow-up Runを許可する。
- `task.complete`以外からAgent-owned Taskを`completed`へ変更しない。
- runtimeの`task.complete`即session完了を削除し、tool resultをLLMへ返す。

Gate:

- success、failure、needs_human、preparation failure、Queue activation failureの全経路でLLMが再開する。
- 通常の非Mission-Pilot Runは現行status挙動を維持する。
- repair Runを同一sessionから開始できる。

Rollback: `contextSnapshot.missionPilotAgent`は監査metadataとして残し、projection policyとshared command接続だけをrevertできる。ただしactive Agent Runまたは未確定mutationがある間はrevertしない。

Commits: H2a-H2c。exact messageとscopeはsection 25を使う。

### H3: Durable action receipts

目的: process crashをまたいでmutationを重複実行しない。

実装:

- `mission_pilot_action_executions` migration、schema、repositoryを追加する。
- action adapterがintentを保存してからapplication commandを呼ぶ。
- Run、Queue、Questionnaire、Git、Task complete/archive commandへidempotency contextを通す。
- wake開始時reconciliationを実装する。
- outcome不明時は自動再実行せず、LLMへtyped resultを返す。

Gate:

- mutation直前、mutation直後、result保存直前の各crash injection testをpassする。
- 同じkeyでresourceが一つだけ作られる。
- arguments digestが違うkey再利用を拒否する。
- Git pushの自動二重実行が起きない。

Rollback: tableはdropせず未使用で残す。H3以降で作られたreceiptがあるsessionを旧runtimeでresumeしない。

Commits: H3a-H3d。exact messageとscopeはsection 25を使う。

### H4: Current-step context and registry-driven loop

目的: LLMが毎回最新Factと実行可能actionを見て判断する。

実装:

- `MissionPilotCurrentStepContext` builderを追加する。
- sampling直前にTask revision、authorization、Run refs、unread eventsを更新する。
- action registryへeffect、completion、expected events、reconciliation metadataを集約する。
- runtimeのaction ID固定配列を削除する。
- tool schema、JSON契約、failure schemaを共有定数または関数へまとめる。

Gate:

- tool実行後にTask revision/action availabilityが変わるtestをpassする。
- unavailable actionを実行toolから外しつつ、一覧readでは理由を取得できる。
- Agent配下にphase/keyword/error textのsemantic branchがないarchitecture testをpassする。

Commit: `refactor(mission-pilot): H4 refresh context before every decision`

### H5: Visible wait and explicit finish

目的: 質問・報告・待機・session完了をユーザーとLLMの双方から観測可能にする。

実装:

- `agent.wait_for_event`と`agent.finish`を追加する。
- assistant-only本文を既存Pilot Thought/activityへ改変せず投影する。
- `task.complete` / `task.archive`後にfollow-up samplingする。
- execution queryへAgent projectionを追加する。
- user message eventで同じsessionをwakeする。

Gate:

- visible messageなしに質問待機へ入らない。
- Task未完了、active Runあり、未確定receiptあり、未消費eventありの`agent.finish`を拒否する。
- 既存UI DOM、文言、Control Summary schemaが変わらない。

Commit: `feat(mission-pilot): H5 expose visible agent wait and finish`

### H6: Typed asynchronous recovery

目的: recoverable failureをLLMの次判断へ戻す。

実装:

- Questionnaire submit/follow-up、Run/Queue/Git非同期失敗をevent catalogへ追加する。
- recoverable failureで`desiredState=stopped`へ直接遷移する処理を除去する。
- provider retryは既存event inboxの`availableAt`へ`mission_pilot.retry_timer_elapsed`を保存し、次の未消費event時刻を読むwake timerで再開する。新しいtimer tableは作らず、process restart時は同じeventからtimerを再構成し、上限とStop cancellationを設ける。
- raw provider bodyとparse/schema failureを保持する。
- resource limit attentionに再開checkpointを保存する。

Gate:

- Questionnaire失敗後、LLMが状態再取得して別actionを選べる。
- retryable transportだけが上限内でretryされる。
- non-retryable provider/action failureが無限loopしない。
- Stop後にtimer/wakeが再起動しない。

Commit: `fix(mission-pilot): H6 return async failures to the agent loop`

### H7: Coding Agent repair loop

目的: errorを表示するだけでなく、実際に修正して再検証する。

実装:

- shared Run start commandへ`sourceRunId`とagent ownershipを接続する。
- repair requestのsource refs、preserve条件、verification requestを監査保存する。
- terminal outcomeから同じsessionを確実にwakeする。
- repository調査依頼も同じCoding Agent runtimeで実行できるようにする。
- repair専用runtime modeや固定Prompt templateによる意味判断を追加しない。

Gate:

- Implementation failure→repair Run→test→explicit completeを一つのsessionでpassする。
- 一度目のrepairが失敗した場合、LLMが二度目のPromptを変えられる。
- temporary directoryの変更を成功証拠にしない。
- worker transcriptなしでterminal outcomeだけから次判断できる。

Commit: `feat(mission-pilot): H7 complete the coding repair loop`

### H8: Completion, archive, and interruption contract

目的: 完了、archive、ユーザー追加指示を一貫したAgent lifecycleへ接続する。

実装:

- `task.complete` preconditionをterminal source Run、verification evidence、revisionで検証する。
- LLMの完了action、最終報告、`agent.finish`を分離する。
- archiveが許可・必要な場合だけ既存archive actionを使う。
- 待機中・Run中のuser messageを同じsessionへ取り込み、次turnの最新指示にする。
- Task削除、権限失効、明示Stopをterminal cancellation eventとして扱う。

Gate:

- assistant本文だけではTaskが完了しない。
- Task complete後に最終報告が見える。
- 追加指示が古いcompaction summaryに負けない。
- archive/restoreの既存testがpassする。

Commit: `feat(mission-pilot): H8 finalize explicit agent lifecycle`

### H9: Autonomous lifecycle E2E and release gate

目的: 部品のunit testではなくユーザー代替Agentとしての完遂を証明する。

実装:

- deterministic provider fixtureでsection 11のscenarioをE2E化する。
- parallel v1/v2 runtime、shadow runtime、runtime切替branchは追加しない。現在のagent runtimeをCheckpointごとにhardeningする。
- H1-H8の各commitはその時点でproduction-safeかつgreenにし、H9はrelease evidenceの確定だけを行う。
- rollbackはCheckpoint commitの逆順revertで行う。公開API/UIへ内部versionや切替switchを追加しない。

Gate:

- 全acceptance scenario、既存Mission Pilot E2E、architecture、typecheck、docs、full relevant testをpassする。
- duplicate side effectが0件。
- legacy coordinatorがagent sessionを更新した記録が0件。
- hidden assistant waitが0件。
- release evidenceを実行ledgerへ記録する。

Commit: `test(mission-pilot): H9 prove autonomous task completion`

### H10: Legacy cleanup after observation window

目的: 切替直後のrevert可能性を守りつつ、競合源を最終的に減らす。

H10はH9と同じ夜に行わない。少なくとも一つの実運用観測期間を置く。

- agent ownershipから到達不能になったlegacy pathを計測で確認する。
- legacy sessionのmigration方針を別途承認する。
- 参照ゼロのservice、schema、testだけを小さなcommitで削除する。
- UI互換projectionと公開contractは削除しない。

## 11. Acceptance Scenarios

### A1: Simple implementation

- LLMがTaskを読み、Coding Agentへ依頼する。
- Run成功後、Taskは`needs_review`でAgentが再開する。
- LLMがTaskに不要なTest/Reviewを省略すると判断できる。
- `task.complete`、最終報告、`agent.finish`で終了する。

### A2: Procedural parity

- Questionnaire→Plan→Implementation→Test→Review→Commit→Complete→Archiveを再現する。
- 既存phase projection、UI、介入時間、trace separationが同等である。
- 順序はfixtureのLLM判断で選び、hostのphase transitionで開始しない。

### A3: Implementation repair

- 最初のRunが失敗する。
- LLMがoutcomeと必要Factを読む。
- 修正Promptを作り同じCoding Agent runtimeへ依頼する。
- 修正Run成功後にTestを実行し、明示完了する。
- Taskが途中でterminal `failed`にならず、重複Runもない。

### A4: Repeated repair

- 一度目のrepairも失敗する。
- LLMが追加調査を依頼し、二度目の異なるrepair Promptを送る。
- 固定回数やerror keywordでhostがstop/completeしない。

### A5: Questionnaire asynchronous failure

- draft介入時間後のsubmitが一度失敗する。
- failure eventでLLMが再開し、現在状態を再取得する。
- 安全なretryまたはdraft修正を選び、sessionを維持する。

### A6: User correction while waiting

- Agentが質問を既存Task messageへ表示して待つ。
- ユーザーが追加指示を送る。
- 同じsessionがwakeし、最新指示を優先してactionを選び直す。

### A7: Crash after mutation

- Run作成成功後、tool result保存前にprocessを終了する。
- restart後にreceiptとRunをreconcileする。
- Runを二重作成せず、元のresultをconversationへ戻す。

### A8: Provider fallback and outage

- primary candidateがtool turn unsupportedでsecondaryへfallbackする。
- 全candidateが一時到達不能なら上限付きretry後に再開可能なattentionへ入る。
- provider本文とattempt情報を保持し、Stopでretryを中止する。

### A9: Restart ownership

- active Run待機中にserverを再起動する。
- Agent sessionだけがreconcileされ、legacy recoveryはphase/statusを変更しない。
- terminal event後に同じconversation revisionから続行する。

### A10: Completion race

- `task.complete`直後にuser messageまたはRun eventが到着する。
- 未消費eventがある間は`agent.finish`が失敗し、LLMがeventを読む。
- 副作用とeventを確認してから一度だけfinishする。

## 12. Test File Plan

追加候補:

```text
tests/mission-pilot-agent-task-status-sovereignty.test.ts
tests/mission-pilot-agent-legacy-ownership-firewall.test.ts
tests/mission-pilot-agent-action-idempotency.test.ts
tests/mission-pilot-agent-visible-wait.test.ts
tests/mission-pilot-agent-questionnaire-recovery.test.ts
tests/mission-pilot-agent-provider-retry.test.ts
tests/mission-pilot-agent-repair-loop.test.ts
tests/mission-pilot-agent-completion.test.ts
tests/e2e/mission-pilot-agent-autopilot.spec.ts
tests/e2e/mission-pilot-agent-repair.spec.ts
tests/e2e/mission-pilot-agent-restart.spec.ts
tests/e2e/mission-pilot-agent-user-interruption.spec.ts
```

Test原則:

- provider fixtureはtool callとassistant responseを決定論的に返す。
- LLMのreasoning本文や完全一致Promptをassertしない。tool contract、visible message、state、resource countをassertする。
- semantic-control testはphase、keyword、error regex、固定repair回数の導入を検出する。
- crash injection pointをapplication commandの前後へ明示する。
- DB直接操作testは他fileと並列干渉しないisolated databaseを使う。
- UI testは既存DOMと文言のsnapshot差分がないことを確認する。
- E2E fixture routeをproduction runtimeのshortcutとしてimportしない。

## 13. Verification Commands

### 13.1 Every Checkpoint

```bash
git diff --check
node scripts/run-vitest.mjs run tests/mission-pilot-agent-runtime.test.ts tests/mission-pilot-agent-questionnaire.test.ts tests/mission-pilot-provider-port.test.ts
bun run typecheck
bun run check:architecture
```

変更対象のtestを上記へ追加する。既存working treeに変更がある場合、Checkpoint開始前後の対象file一覧を記録する。

### 13.2 Mission Pilot regression

```bash
node scripts/run-vitest.mjs run tests/mission-pilot-*.test.ts
bun run check:docs
```

shellのglob展開差異がある場合は`rg --files tests | rg '/mission-pilot-|^tests/mission-pilot-'`から明示file listを生成してrunnerへ渡す。

### 13.3 E2E gate

```bash
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-entry.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-questionnaire.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-pre-queue-handoff.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-through-archive.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-trace-separation.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-autopilot.spec.ts tests/e2e/mission-pilot-agent-repair.spec.ts tests/e2e/mission-pilot-agent-restart.spec.ts tests/e2e/mission-pilot-agent-user-interruption.spec.ts
```

### 13.4 Final gate

```bash
bun run verify:base
bun run check:architecture
bun run check:docs
bun run typecheck
```

repository全体のfull E2Eまたはrelease verificationが環境依存で実行不能な場合、「未実行」を成功として扱わず、必要環境、未確認risk、再実行commandをledgerへ残す。

## 14. Database and Migration Plan

### 14.1 Additive changes only

- `mission_pilot_action_executions`を追加する。
- Run ownershipは新columnではなく、Run作成時から存在するtyped `contextSnapshot.missionPilotAgent` envelopeへ保存する。
- unique indexとreconciliation query用indexを追加する。
- H9以前に既存table/columnをdropしない。

### 14.2 Existing sessions

- legacy ownership sessionはそのままlegacyで続行する。
- agent sessionは同じruntimeを継続利用する。parallel runtimeへのmigrationは行わない。
- conversation、event、repair request、provider本文を移行時に削除しない。

### 14.3 New sessions

- session作成contractと`engineMode="agent"`は変更しない。
- hardening専用のruntime version、shadow session、公開feature flagを追加しない。
- rollbackはCheckpoint commitを逆順にrevertする。active mutationがある状態でrollbackしない。

## 15. Rollback and Stop Conditions

### 15.1 Rollback rules

- Checkpoint単位でrevertできるcommitにする。
- migrationはadditiveに保ち、rollbackでtable dropを要求しない。
- active mutation、active Run、未確定receiptがある状態でCheckpointをrevertしない。
- rollback後もconversation、LLM本文、action receipt、Run outcomeを保持する。
- side effectをgit revertで取り消せると仮定しない。成立済みmutationはdomain commandで明示的に補償する。

### 15.2 Immediate stop conditions

次のいずれかが発生したCheckpointは先へ進めない。

- Play button、表示文言、既存UI DOM、公開API schemaが意図せず変わる。
- 既存正常系testを弱めないとpassできない。
- Agent-owned Taskが`task.complete`なしに`completed`になる。
- legacyとAgentが同じsessionを更新する。
- crash testで同じside effectが二重実行される。
- failure本文またはprovider本文を固定文へ置き換える。
- phase、keyword、error regex、固定回数によるnext-action分岐が追加される。
- repair専用Coding Agent runtime/mode/tool allowlistが追加される。
- temporary directoryの編集をrepository作業完了の証拠にする。
- 未確認mutationがある状態で`agent.finish`が成功する。

## 16. Suggested File Layout

追加候補:

```text
api/modules/missionPilot/agent/mission-pilot-runtime-ownership.service.ts
api/modules/missionPilot/agent/mission-pilot-current-step-context.ts
api/modules/missionPilot/agent/mission-pilot-action-execution.repository.ts
api/modules/missionPilot/agent/mission-pilot-action-reconciliation.service.ts
api/modules/missionPilot/agent/mission-pilot-visible-message-projection.ts
api/modules/missionPilot/agent/mission-pilot-agent-control-tools.ts
api/modules/nightworkers/run-orchestration/task-status-projection-policy.ts
```

主な変更候補:

```text
api/db/mission-pilot-agent-schema.ts
shared/schemas/mission-pilot-agent.schema.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
api/modules/missionPilot/agent/mission-pilot-task-action.registry.ts
api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts
api/modules/missionPilot/agent/mission-pilot-task-event.repository.ts
api/modules/missionPilot/agent/mission-pilot-task-read.adapter.ts
api/modules/missionPilot/agent/mission-pilot-conversation.repository.ts
api/modules/missionPilot/mission-pilot.service.ts
api/modules/missionPilot/mission-pilot-questionnaire.service.ts
api/modules/missionPilot/mission-pilot-execution-query.service.ts
api/modules/nightworkers/run-orchestration/runtime-execution.ts
api/modules/nightworkers/run-orchestration/runtime-execution-failure.ts
api/modules/nightworkers/run-orchestration/start-task-run.ts
api/modules/nightworkers/run-orchestration/queues.ts
api/services/structured-generation/prompts/mission-pilot-system-context.ts
```

この一覧は変更許可ではなく探索順である。既存application commandを再利用できる場合は新serviceを増やさない。共通schema、JSON契約、failure変換、action metadataは重複実装せず一つの定数または関数へ集約する。

## 17. Implementation Ledger

実装担当はCheckpointごとに次を更新する。計画書が開始前changeとして未commitの場合はこのfileを直接編集せず、`spec/docs/mission-pilot-autonomous-agent-hardening-execution-log.md`をLuna-owned fileとして作成し、同じ列を記録する。

| Checkpoint | Status | Commit | Tests | Evidence / Remaining Risk |
| --- | --- | --- | --- | --- |
| H0 Baseline | pending |  |  |  |
| H1 Ownership firewall | pending |  |  |  |
| H2 Completion sovereignty | pending |  |  |  |
| H3 Action receipts | pending |  |  |  |
| H4 Current-step context | pending |  |  |  |
| H5 Visible wait/finish | pending |  |  |  |
| H6 Async recovery | pending |  |  |  |
| H7 Repair loop | pending |  |  |  |
| H8 Completion/interruption | pending |  |  |  |
| H9 E2E/release gate | pending |  |  |  |
| H10 Legacy cleanup | deferred |  |  | Observation window後 |

Statusは`pending`、`in_progress`、`blocked`、`passed`だけを使う。test未実行、環境不足、既知failureを`passed`にしない。

## 18. Definition of Done

次をすべて満たした場合だけ、本hardeningを完了とする。

- Mission Pilotの一つのlogical sessionが観測、判断、実行、待機、失敗回復、完了まで継続する。
- Run成功・失敗だけではAgent-owned Taskがterminalにならない。
- `task.complete`と`agent.finish`が分離され、未確認side effectや未消費eventがあるとfinishできない。
- legacy coordinatorがAgent-owned sessionを更新できない。
- mutation crash後も同じRun、Queue entry、Questionnaire mutation、Git actionを重複実行しない。
- assistant-only responseとユーザー質問が既存UI上で見える。
- Questionnaireやworkerの非同期失敗がLLMへ戻り、修正、再試行、代替actionを選べる。
- Coding Agentの失敗から、LLMが修正Promptを作り、同じruntimeでrepairし、再検証して完了できる。
- repository調査と修正は登録済みProjectのrepo rootで実行される。
- UI、公開API、既存正常系、既存testの互換が維持される。
- architecture testがkeyword/regex/phase/fixed-workflowによるsemantic controlの再導入を防ぐ。
- Acceptance Scenario A1-A10とfinal verification gateがpassする。
- Checkpoint別rollback procedure、migration条件、実行ledgerが更新されている。

このDefinition of Doneは「Agent loopが存在する」ことではなく、「Task lifecycle全体をLLMの判断が途切れず所有し、失敗しても安全に次の試行へ進める」ことを要求する。

## 19. Locked Implementation Decisions for Luna

この節はLunaが実装中に再設計しなくて済むよう、前節までに残り得る選択肢を解消する。ここに記載した判断を別方式へ変更する場合は夜間継続を止め、理由と代案をledgerへ残す。

| Topic | Locked decision |
| --- | --- |
| Runtime | 現在のPersistent Mission Pilot Agent Runtimeを一本だけhardeningする。v1/v2、shadow、semantic modeを追加しない |
| H0 red tests | redを確認して証拠を残すがcommitしない。該当production fixと同じgreen commitへ含める |
| Ownership source | `mission_pilot_agent_sessions` rowだけを正本にする。in-memory registry、phase、Task statusから推定しない |
| Run provenance | `StartTaskRunOptions.missionPilotAgent`からRun作成時の`contextSnapshot.missionPilotAgent`へ保存する |
| Agent terminal Task status | sessionがplayingである限り、Run成功・失敗・needs_human・timeout・cancelledをすべてTask `needs_review`へ投影する。Run status自体は変更しない |
| Explicit user stop | Mission Pilotがstoppedならterminal Run callbackはTask statusを`needs_review`へ戻さず、現在statusを保持する |
| Task completion | `task.complete`だけがTaskを`completed`にする。Run finalizer、legacy coordinator、assistant本文は完了させない |
| Session completion | `agent.finish`だけがAgent runtimeを`completed`にする。`task.complete` / `task.archive`後も一度LLMへresultを返す |
| Assistant-only body | `mission_pilot_conversation_items`のassistant itemをexecution queryへ投影する。Task message tableへ同じ本文を複製しない |
| User-directed question | LLMが`task.message.send`で既存Task messageへ表示し、`agent.wait_for_event`でuser message eventを待つ |
| Async wait | action registryの`completion="wait_for_event"`と`expectedEventTypes`を正本にする。runtimeにaction ID配列を残さない |
| Provider retry timer | `mission_pilot_task_event_inbox.availableAt`を再利用する。別timer tableを作らない |
| Mutation retry | action receiptとdomain resourceで成立確認できる場合だけ同じkeyをreconcileする。新しいkeyで自動再実行しない |
| Repair | LLMが作ったrequestを同じCoding Agent runtimeへ送る。repair mode、error keyword router、固定修正Promptを作らない |
| Repository access | Mission Pilotは直接filesystemを触らず、登録済みrepo rootで動くCoding Agentへ依頼する |
| UI/API | 新しい公開field、button、label、confirmation、runtime statusを追加しない |

### 19.1 Typed Run provenance

`shared/schemas/mission-pilot-agent.schema.ts`へ内部schemaを追加し、`StartTaskRunOptions`とRun contextの両方で再利用する。

```ts
const missionPilotAgentRunProvenanceSchema = z.object({
  kind: z.literal("agent"),
  sessionId: z.string().min(1),
  toolCallId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  completionOwner: z.literal("mission_pilot"),
  sourceRunId: z.string().min(1).nullable(),
});
```

保存時点は`createTaskRunInAgentModeSession`へ渡す`taskRun.contextSnapshot`の作成時であり、runtime launch後の追記ではない。`failPreparedRunBeforeLaunch`も同じprovenanceを引数で受け、Run準備中失敗をAgent-ownedとして投影する。

既存legacyの`contextSnapshot.missionPilot` envelopeは変更しない。Agent用は`contextSnapshot.missionPilotAgent`という別keyにし、legacy `cycle`や`phase`をAgentへ持ち込まない。

### 19.2 Parent Task status projection

新しいpure policyとapplication serviceを分ける。

```ts
resolveParentTaskStatusPolicy({
  currentTaskStatus,
  runStatus,
  missionPilotAgent,
  missionPilotDesiredState,
}): TaskStatus
```

規則:

1. `missionPilotAgent`がなければ現在の非Agent挙動をそのまま返す。
2. Agent-ownedでもsessionが`stopped`なら`currentTaskStatus`を保持する。
3. Taskが`completed`、`archived`、`cancelled`ならterminal Run eventでdowngradeしない。
4. sessionがplayingでRunがterminalなら`needs_review`を返す。
5. application serviceはTask revisionまたは現在statusを条件にCAS更新し、同時に新しいactive Runが生じた場合は上書きしない。
6. Run terminal eventはstatus projection後に一度だけpublishする。source idは`task-run:{runId}:{runStatus}`に固定する。

`resolveMissionPilotParentTaskStatus`はlegacy phase projection専用に残すか、この共通policyからlegacy branchを呼ぶ。Agent-owned Runでlegacy `missionPilotPhaseRuns`を作らない。

### 19.3 Control tool result

read/action/controlを同じnative tool loopで扱いつつ、control directiveだけruntimeへ明示的に返す。

```ts
type MissionPilotToolExecutionResult =
  | { ok: true; data: unknown; directive: "continue" }
  | {
      ok: true;
      data: unknown;
      directive: "wait";
      waitFor: MissionPilotTaskEventType[];
    }
  | { ok: true; data: unknown; directive: "finish" }
  | { ok: false; failure: MissionPilotActionFailure; directive: "continue" };
```

`agent.wait_for_event`と`agent.finish`はTask action registryへ混ぜない。authorization scopeを増やさず、Agent session lifecycleのstructural toolとして`mission-pilot-agent-control-tools.ts`に置く。

`agent.finish`のprecondition queryは次を一つのtransaction snapshotで確認する。

- Task statusが`completed`または`archived`。
- sessionがplayingでcurrent turn leaseを所有している。
- active Runが0。
- pending/running/outcome_unknown action receiptが0。
- `availableAt <= now`の未消費eventが0。
- 現在実行中の`agent.finish` call自身を除き、同じturn内に未完了tool callが0。
- future retry timerを含む未消費eventが0。Task complete/archive成立時に不要になったfuture retry eventは、cancellation reasonをconversationへ残してconsumeする。

### 19.4 Visible assistant projection

`mission-pilot-execution-query.service.ts`へAgent query branchを追加する。conversation itemのcanonical bodyは変更しない。

```text
assistant item       -> existing assistant.raw_output-compatible trace item
tool_call item       -> existing tool/action trace item
tool_result item     -> existing tool result/error trace item
task_event item      -> existing status trace item
runtime_failure item -> existing error trace item
```

projectionはread-onlyであり、Task messageやlegacy event tableへ複製writeしない。既存consumerが知らない公開kindを追加せず、既存schemaで表現できない内部fieldは返さない。

### 19.5 System Context delta

既存の日本語System Contextへ次の意味を追加する。文章は自然な日本語へ整えてよいが、固定工程やhost判断へ変えない。

```text
各判断の直前に現在のTask revision、未読event、active/terminal Run、利用可能actionを確認してください。
必要なFactが不足している場合はread toolを使い、repository調査が必要なら同じCoding Agent runtimeへ具体的な調査依頼を送ってください。
actionまたはworkerが失敗してもTaskを直ちに諦めず、返されたfailureと現在状態を読み、再試行、修正依頼、代替action、ユーザーへの質問のいずれが適切か自分で判断してください。
ユーザーへ質問する前に、権限内のread、状態再取得、安全なretry、Coding Agentへの調査・repairで補完できないか確認してください。
Runのterminal statusはTask Goalの完了ではありません。必要な検証を判断し、完了条件を満たした場合だけtask.completeを実行してください。
task.completeまたはtask.archiveの結果を確認し、最終報告を本文に含めたうえでagent.finishを実行してください。
待機が必要な場合は、ユーザーへ伝える内容があればtask.message.sendを先に実行し、agent.wait_for_eventで待つeventを明示してください。
```

System Contextは「必ずQuestionnaire→Plan→Implementation→Test→Review」の順に進めるとは書かない。Test/Review/Commitの要否はTask Goalと現在の証拠からLLMが判断する。

## 20. Action Receipt and Reconciliation Matrix

### 20.1 Receipt state machine

許可するtransitionを次に固定する。

```text
pending -> executing
executing -> succeeded | failed | outcome_unknown
outcome_unknown -> succeeded | failed
```

terminal receiptを`executing`へ戻さない。`failed`の再試行は元receiptを書き換えず、LLMが新しいactionを選んだ場合に新しいtool callとreceiptを作る。ただし元actionの成立有無が不明な間、同じresource種別の競合mutationはstructural preconditionで拒否する。

### 20.2 Transaction order

mutation actionは必ず次の順にする。

1. tool call、arguments digest、expected Task revisionを検証する。
2. receiptを`pending`でinsert、または同一keyの既存receiptを読む。
3. receiptをCASで`executing`へする。
4. application commandへ`MissionPilotCommandContext`を渡す。
5. commandが返したresource IDまたはdomain receiptを保存する。
6. receiptをterminalへ更新する。
7. tool resultをconversationへappendする。

3と4の間のcrashは「mutation未実行」が確実なので同じkeyで再開できる。4と6の間のcrashはdomain resourceを検索し、成立確認できない場合は`outcome_unknown`にする。

### 20.3 Action group policy

| Action group | Examples | Required reconciliation evidence |
| --- | --- | --- |
| Resource creation | Task message、Questionnaire、Artifact、Queue entry、Run、Review session/Run | resourceにsource idempotency keyを保存するか、一意association tableでresource IDを保持する |
| State transition | Task update/archive/restore/complete、Queue update/cancel/recover、Run stop、Review submit | current resource revisionと目標stateを再読し、同じtransitionが成立済みなら元resultを再構成する |
| Git/external effect | commit、push、merge execute | 既存commit/merge closeout record、target SHA、remote observationで成立を確認する。確認不能なら自動再送しない |
| Generated content | Questionnaire follow-up、Plan Artifact generation/regeneration | generation request IDと生成artifact/session IDの一意対応を保存する |

最低限H3でRun start、Queue enqueue、Task message、Questionnaire mutation、Task complete/archive、Git commit/pushを完成させる。他のmutation actionをreceiptなしで残したままH3を`passed`にしない。既存commandがすでにidempotency keyを持つ場合は新しい重複機構を追加せず、そのkeyへMission Pilot receiptを接続する。

### 20.4 Migration files

schema変更時は次を同じCheckpointに含める。

- `api/db/mission-pilot-agent-schema.ts`
- Mission Pilot Agentのidempotent bootstrap SQL
- `drizzle/migrations/`の次の未使用番号のSQL
- 必要なDrizzle metadata更新
- bootstrap二回実行test
- repository CRUD/CAS/reconciliation test

番号は計画書に固定しない。実装開始時に`drizzle/migrations`の最大番号を確認し、同時作業と衝突しない次番号を使う。

## 21. Checkpoint Work Packages

このmatrixのfileは探索上限である。別fileが必要になった場合は、同じdomain境界内である理由をledgerへ書いて続行できる。UI、route、公開schema、Coding Agent runtime本体へ変更が広がる場合はstop conditionとする。

### H1 work package

Primary files:

```text
api/modules/missionPilot/agent/mission-pilot-runtime-ownership.service.ts
api/modules/missionPilot/agent/mission-pilot-agent-session.repository.ts
api/modules/missionPilot/mission-pilot.service.ts
api/modules/missionPilot/mission-pilot-intake-recovery.repository.ts
api/modules/missionPilot/mission-pilot-pre-queue-recovery.service.ts
api/modules/missionPilot/mission-pilot-recovery.service.ts
```

Order:

1. DB-backed ownership queryを追加する。
2. unit testでrowあり=`agent`、rowなし=`legacy`を固定する。
3. startupのlegacy queryからagent rowを除外する。
4. pre/post Queue recoveryとintake recoveryを同じguardへ接続する。
5. current working treeにあるactive registryはcache用途だけであることをtestする。

Target tests:

```text
tests/mission-pilot-agent-legacy-ownership-firewall.test.ts
tests/mission-pilot-service.test.ts
tests/mission-pilot-pre-queue-recovery.test.ts
tests/mission-pilot-post-queue-recovery.test.ts
```

H1を完了してもRun statusやaction receiptは変更しない。

### H2 work package

Primary files:

```text
shared/schemas/mission-pilot-agent.schema.ts
api/modules/nightworkers/run-orchestration/start-task-run-types.ts
api/modules/nightworkers/run-orchestration/start-task-run.ts
api/modules/nightworkers/run-orchestration/start-task-run-entry.ts
api/modules/nightworkers/run-orchestration/runtime-execution.ts
api/modules/nightworkers/run-orchestration/runtime-execution-failure.ts
api/modules/nightworkers/run-orchestration/queues.ts
api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts
api/modules/missionPilot/mission-pilot-post-queue-coordinator.service.ts
```

Order:

1. typed provenanceとpure status policy testを追加してredを確認する。
2. `appendWorkbenchMessage(... intent="run_task")`の内部実装を、UI/Agentが共有できる`startTaskRunFromPrompt`へ抽出する。public input/responseは変更しない。
3. Agent actionからprovenanceを渡し、Run作成時snapshotへ保存する。
4. normal finalization、preparation failure、runtime failure、Queue failureを共通projectionへ接続する。
5. terminal eventでAgentをwakeし、LLMがoutcomeをreadできることを確認する。
6. `task.complete`成功後もruntime loopを継続する。

Target tests:

```text
tests/mission-pilot-agent-task-status-sovereignty.test.ts
tests/mission-pilot-agent-runtime.test.ts
tests/mission-pilot-post-queue-state.test.ts
tests/nightworkers-workbench-routes/routes-workbench-04.test.ts
```

H2ではaction receipt tableを先取りしない。provenance keyはH3でreceiptへ接続する。

### H3 work package

Primary files:

```text
api/db/mission-pilot-agent-schema.ts
api/db/mission-pilot-schema-bootstrap.ts
drizzle/migrations/*_mission_pilot_action_executions.sql
api/modules/missionPilot/agent/mission-pilot-action-execution.repository.ts
api/modules/missionPilot/agent/mission-pilot-action-reconciliation.service.ts
api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
```

Order:

1. table、bootstrap、repository CAS test。
2. adapterをreceiptで包むが、まず一つのstate-setting actionでloopをgreenにする。
3. resource creation、Run、Queue、Questionnaireへdomain evidenceを接続する。
4. Git/external effectを既存closeout recordへ接続する。
5. wake冒頭のreconciliationを追加する。
6. crash injection全点を通す。

Target tests:

```text
tests/mission-pilot-agent-action-idempotency.test.ts
tests/mission-pilot-agent-runtime.test.ts
tests/mission-pilot-repository.test.ts
tests/services.database-bootstrap.test.ts or current bootstrap coverage file
```

### H4 work package

Primary files:

```text
api/modules/missionPilot/agent/mission-pilot-current-step-context.ts
api/modules/missionPilot/agent/mission-pilot-task-action.registry.ts
api/modules/missionPilot/agent/mission-pilot-task-read.adapter.ts
api/modules/missionPilot/agent/mission-pilot-tools.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
api/services/structured-generation/prompts/mission-pilot-system-context.ts
```

Order:

1. registry metadata typeとvalidation test。
2. current-step builderをread-onlyで追加する。
3. provider call直前にcontext/action definitionsを再構築する。
4. runtimeのaction ID配列をregistry metadataへ置換する。
5. compaction後もrefs、digest、open issues、executed actionsが残るtest。

Target tests:

```text
tests/mission-pilot-agent-runtime.test.ts
tests/mission-pilot-agent-current-step-context.test.ts
tests/mission-pilot-agent-semantic-control.test.ts
```

### H5 work package

Primary files:

```text
api/modules/missionPilot/agent/mission-pilot-agent-control-tools.ts
api/modules/missionPilot/agent/mission-pilot-tools.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
api/modules/missionPilot/mission-pilot-execution-query.service.ts
```

Order:

1. control tool schemaとdirective result。
2. wait/finish precondition。
3. assistant conversation projection。
4. Task complete/archive後のfollow-up sampling。
5. visible question→user event→same session resume test。

Target tests:

```text
tests/mission-pilot-agent-visible-wait.test.ts
tests/mission-pilot-agent-completion.test.ts
tests/mission-pilot-execution-query.test.ts
tests/pilot-thought-dock.test.tsx
```

React/UI sourceは変更せず、既存query resultだけで現在のcomponentが表示できることをtestする。

### H6 work package

Primary files:

```text
shared/schemas/mission-pilot-agent.schema.ts
api/modules/missionPilot/agent/mission-pilot-task-event.repository.ts
api/modules/missionPilot/agent/mission-pilot-agent-wake.service.ts
api/modules/missionPilot/mission-pilot-questionnaire.service.ts
api/modules/missionPilot/agent/mission-pilot-provider.port.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
```

Order:

1. typed event追加とdedupe test。
2. Questionnaire failureをstop mutationからevent publishへ置換する。
3. retryable provider failureだけfuture eventを作る。
4. next available event timer、startup reconstruction、Stop cancellationを追加する。
5. retry上限とattention checkpointをtestする。

Target tests:

```text
tests/mission-pilot-agent-questionnaire-recovery.test.ts
tests/mission-pilot-agent-provider-retry.test.ts
tests/mission-pilot-agent-questionnaire.test.ts
tests/mission-pilot-provider-port.test.ts
```

### H7 work package

Primary files:

```text
api/modules/missionPilot/agent/mission-pilot-repair.ts
api/modules/missionPilot/agent/mission-pilot-repair.repository.ts
api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter.ts
api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts
api/services/agent-runtime/e2e-fixture-runtime.ts
```

Order:

1. failure outcomeをreadするfixture turn。
2. LLM生成requestを変更せずRun startへ渡す。
3. source Run、canonical refs、preserve、verificationの監査保存。
4. repair terminal eventから同じsessionをwakeする。
5. repair失敗後に二つ目の異なるrequestを送るfixture。

Target tests:

```text
tests/mission-pilot-agent-repair-loop.test.ts
tests/mission-pilot-agent-runtime.test.ts
tests/e2e/mission-pilot-agent-repair.spec.ts
```

fixture用`[fixture:*]` tagはtest runtimeにだけ許可する。productionのerror/Task分類に同じ方法を導入しない。

### H8 work package

Primary files:

```text
api/modules/missionPilot/agent/mission-pilot-agent-control-tools.ts
api/modules/missionPilot/agent/mission-pilot-task-event.repository.ts
api/modules/missionPilot/agent/mission-pilot-context-compaction.ts
api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts
api/modules/missionPilot/mission-pilot.service.ts
```

Order:

1. complete/archive/finish race test。
2. user message orderingとcompaction preservation。
3. Stop、Task delete、permission revokeのcancellation event。
4. final report visibilityとexactly-once finish。

Target tests:

```text
tests/mission-pilot-agent-completion.test.ts
tests/mission-pilot-agent-visible-wait.test.ts
tests/mission-pilot-agent-user-interruption.test.ts
tests/mission-pilot-closeout.test.ts
```

### H9 work package

production codeは原則変更しない。H9でproduction fixが必要になった場合、該当H1-H8 Checkpointへ戻して別commitで修正し、関連gateを再実行する。

Target E2E:

```text
tests/e2e/mission-pilot-agent-autopilot.spec.ts
tests/e2e/mission-pilot-agent-repair.spec.ts
tests/e2e/mission-pilot-agent-restart.spec.ts
tests/e2e/mission-pilot-agent-user-interruption.spec.ts
```

## 22. Luna Overnight Execution Contract

### 22.1 Start protocol

Lunaは最初に次を行う。

1. repository rootの`AGENTS.md`を読む。
2. 本文書を先頭から最後まで読む。
3. `git status --short`、`git diff --name-status`、`git log -8 --oneline`を記録する。
4. 開始前から存在する変更をpre-existing user changeとして一覧化する。
5. pre-existing changeをrevert、stash、stage、formatしない。
6. 本文書のH0 baselineを実行し、ledgerへ結果を記録する。
7. green baselineまたは原因を特定できた既知baseline failureだけを確認してH1へ進む。

現在のworking treeにはMission Pilot関連の変更が存在し得る。計画書のStatusにあるcommit hashだけへresetしてはいけない。

### 22.2 Overlap protocol

Checkpoint対象fileにpre-existing changeがある場合:

1. `git diff -- <file>`で既存hunkを読む。
2. 既存hunkがCheckpoint目標と一致していても、勝手に削除・書換え・commitしない。
3. 新しい変更は既存hunkを保持する最小patchで加える。
4. commit時はCheckpointで追加したhunkだけをstageする。
5. hunkを安全に分離できない、または既存変更の意図と衝突する場合はそのCheckpointで停止する。

unrelated fileをcleanにするための変更、format-all、import並べ替えの全体適用を行わない。

### 22.3 Checkpoint loop

各H1-H9で次を繰り返す。

```text
read checkpoint and locked decisions
  -> record pre-checkpoint status
  -> add fail-first test and confirm expected red
  -> implement the smallest production change
  -> run targeted tests until green
  -> run Mission Pilot regression + typecheck + architecture + diff check
  -> inspect changed files and public/UI diff
  -> update ledger
  -> stage only owned hunks
  -> commit
  -> record commit hash and proceed
```

red test確認前にproduction codeを書かない。green gate前にcommitしない。Checkpointを飛ばさない。H9以外で複数Checkpointを一commitへまとめない。

### 22.4 Commit sequence

```text
fix(mission-pilot): H1 isolate agent runtime ownership
feat(mission-pilot): H2a persist agent run provenance
fix(mission-pilot): H2b preserve task completion sovereignty
feat(mission-pilot): H2c allow agent follow-up runs
feat(mission-pilot): H3a add action receipt persistence
feat(mission-pilot): H3b reconcile created resources
feat(mission-pilot): H3c reconcile state transitions
feat(mission-pilot): H3d reconcile external effects
refactor(mission-pilot): H4 refresh context before every decision
feat(mission-pilot): H5 expose visible agent wait and finish
fix(mission-pilot): H6 return async failures to the agent loop
feat(mission-pilot): H7 complete the coding repair loop
feat(mission-pilot): H8 finalize explicit agent lifecycle
test(mission-pilot): H9 prove autonomous task completion
```

commit messageを変更する必要がある場合も`Hn`を残す。amend、squash、rebase、force pushを行わない。pushとPR作成はこの計画の権限に含めない。

### 22.5 Continue conditions

次をすべて満たした場合だけ次Checkpointへ進む。

- targeted testがgreen。
- 既存Mission Pilot regressionがgreen。
- typecheckがgreen。
- architecture checkがgreen。
- `git diff --check`がgreen。
- UI/public API diffがない。
- Checkpoint外のsemantic changeがない。
- 未確認mutation、未解決migration、未stageのowned hunkがない。
- ledgerへcommitとtest resultを記録した。

### 22.6 Stop conditions

次の場合は推測で進まず停止し、section 23のhandoffを残す。

- pre-existing user changeと安全にhunk分離できない。
- locked decisionを変更しないと実装できない。
- UI、route、公開schema、Coding Agent runtime modeの変更が必要。
- additiveでないmigrationが必要。
- targeted fix後も既存testが回帰し、原因をCheckpoint内へ限定できない。
- side effect成立有無を確認できないのに自動retryが必要になる。
- Task statusを`needs_review`以外にしないとrepair Runを開始できない。
- legacy/Agent ownershipをDB row以外から推定する必要が生じる。
- hidden assistant bodyを表示するためReact component変更が必要になる。
- test fixtureでないproduction codeにkeyword/regex分類が必要になる。
- external service、credential、ユーザー権限追加が必要。

単に実装量が多い、testに時間がかかる、最初の修正でgreenにならないことは停止理由ではない。同じCheckpoint内で安全な進展がある限り継続する。

## 23. Luna Handoff Record

Lunaは開始時に`spec/docs/mission-pilot-autonomous-agent-hardening-execution-log.md`を作成する。夜間作業終了時、完了・停止のどちらでも次をそのfileへ残す。計画書自体がpre-existing user changeならledger更新のためにstageしない。

```markdown
## Luna Handoff YYYY-MM-DD HH:mm JST

- Last completed Checkpoint:
- Current Checkpoint:
- Last green commit:
- Pre-existing changes preserved:
- Files changed by Luna:
- Tests passed with exact commands:
- Tests failed/not run:
- Database migrations added:
- Active/unknown side effects:
- Remaining work:
- Stop reason:
- Safe next command:
```

完了報告には「実装した」だけでなく、A1-A10のどこまで実証したかを記載する。test未実行をpass扱いにせず、active/unknown side effectが一つでもあれば明記する。

## 24. Deterministic Test Driver Contract

### 24.1 Provider fixture

Agent runtime unit/integration test用にscripted providerをtest supportへ追加する。production provider portへfixture分岐を入れない。

```ts
type ScriptedMissionPilotTurn = {
  expectLastMessageRole?: "user" | "tool";
  expectLastToolName?: string;
  response: {
    content: string;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  };
};
```

driverは配列順にresponseを返し、期待role/tool name不一致、余分なprovider call、未消費turnがあればtestをfailする。assistant本文やTask本文をkeyword分類してresponseを選ばない。

### 24.2 Required scripted sequences

| Scenario | Scripted turns | Final assertions |
| --- | --- | --- |
| A1 simple | read workspace → start Implementation → read terminal outcome → task.complete → assistant summaryとagent.finishを同じturnで返す | Run一つ、Task completed、session completed、visible summaryあり |
| A2 parity | Questionnaire draft/wait → Plan actions → Implementation → Test → Review → Git commit → complete → archive → finish | 既存phase projectionとUI contract同等、host auto-transitionなし |
| A3 repair | read failed outcome → start Implementation with `sourceRunId` and repair request → read repaired outcome → Test → complete → finish | Run二つ、修正Prompt保持、Task途中でfailedにならない |
| A4 repeated repair | failed outcome → repair 1 → failed outcome → investigation Run → repair 2 → verification → complete | request 1と2が異なる、固定回数branchなし |
| A5 Questionnaire failure | save draft → wait → submission_failed event → read questionnaire → retry/update → wait → success | desiredState playing維持、failure本文保持 |
| A6 user correction | task.message.send → wait for user event → read new message/workspace → alternate action | 同じsession、latest instruction優先 |
| A7 crash | start mutation、crash injection、restart/reconcile、read result | resource一つ、receipt terminal、tool result一つのcanonical outcome |
| A8 provider | primary unsupported → fallback success、次にretryable outage → future event → resume | retry上限、Stop cancellation、本文保持 |
| A9 restart | Run waiting中にscheduler/runtime再生成 → terminal event → continuation | legacy mutationなし、conversation revision継続 |
| A10 finish race | task.complete → event arrival → finish rejection → event read → finish success | completed downgradeなし、finish一回 |

各sequenceはLLMが選んだtool callを通して進める。test setupが直接Taskを次phaseへ更新して正常系を偽装しない。

### 24.3 Coding Agent E2E fixture

`api/services/agent-runtime/e2e-fixture-runtime.ts`へ追加するfixture behaviorは、明示的なtest tagにだけ反応してよい。

- success。
- first implementation failure。
- first repair failure then success。
- verification failure then success。
- hold until Stop。

fixtureは必ず`context.repoRoot`配下だけを変更し、temporary supervisor directoryを成功証拠にしない。failure fixtureはterminal statusとfinal reportを返し、Mission Pilot側の次actionを直接呼ばない。

### 24.4 Crash injection

productionに環境変数分岐を残さず、repository/application command dependencyへtest hookをinjectする。

```ts
type MissionPilotActionExecutionHooks = {
  afterReceiptExecuting?: () => Promise<void>;
  afterDomainMutation?: (resourceRef: unknown) => Promise<void>;
  beforeReceiptTerminal?: () => Promise<void>;
  beforeToolResultAppend?: () => Promise<void>;
};
```

defaultは空objectとし、testだけがthrowしてprocess interruptionを模擬する。各hook後のrestart testでresource数、receipt status、conversation item数をassertする。

## 25. Atomic Commit and Rollback Matrix

H2とH3は変更範囲が広いため、次のgreen subcommitへ分割してよい。それ以外は一Checkpoint一commitを維持する。subcommit途中でもtargeted test、typecheck、diff checkをpassさせる。

| Commit | Scope | Revert consequence |
| --- | --- | --- |
| H1 | DB-backed ownership firewall | Agent/legacy隔離だけを戻す。schemaなし |
| H2a | typed Run provenance + shared Run command | Agent startを旧Workbench pathへ戻す。Task projectionはまだ変更しない |
| H2b | all Run finalization paths use status policy | Agent terminal RunのTask statusだけを旧挙動へ戻す |
| H2c | follow-up Run + explicit complete continuation | repair再実行とcomplete後resampleを戻す |
| H3a | action receipt schema/repository | tableを残しruntime接続だけを戻せる |
| H3b | Run/Queue/Questionnaire/message reconciliation | resource creation系のreceipt接続を戻す |
| H3c | Task/state transition reconciliation | state-setting actionのreceipt接続を戻す |
| H3d | Git/external reconciliation + crash suite | external effect接続を戻す。成立済みeffectはrevertしない |
| H4 | current-step/registry loop | 旧runtime配列へ戻るためH5以降も同時revertが必要 |
| H5 | visible wait/finish | session completionは旧`task.complete`即完了へ戻るためH8より先に単独revertしない |
| H6 | async recovery/retry timer | future eventはDBに残して無視できる。削除しない |
| H7 | repair integration | 作成済みRun/repair requestは保持する |
| H8 | completion/interruption | H5との依存があるためH8→H5の順でrevertする |
| H9 | E2E evidence | testだけを戻しproductionには影響しない |

推奨subcommit message:

```text
feat(mission-pilot): H2a persist agent run provenance
fix(mission-pilot): H2b preserve task completion sovereignty
feat(mission-pilot): H2c allow agent follow-up runs
feat(mission-pilot): H3a add action receipt persistence
feat(mission-pilot): H3b reconcile created resources
feat(mission-pilot): H3c reconcile state transitions
feat(mission-pilot): H3d reconcile external effects
```

rollback時は常に新しいものから逆順にrevertする。DB migration fileやtableを削除するrevertを作らない。revert前にactive Run、playing session、pending/running/outcome_unknown receiptが0であることをqueryで確認する。
