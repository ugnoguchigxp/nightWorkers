# Mission Pilot LLM Autopilot Implementation Plan

## Status

- Concept status: `locked`
- Plan status: `implementation-ready`
- Implementation status: `not started; Luna handoff ready`
- Last updated: 2026-07-16
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target scope: Mission Pilot
- Role/module ownership override: Mission Pilot、Coding Agent、agentsShareの配置、依存方向、Questionnaire・Plan routing・Artifact所有権は`spec/docs/mission-pilot-coding-agent-module-separation-plan.md`を正本とする

この文書を、Mission PilotをLLMの柔軟性を活かした永続オートパイロットへ移行するための正本とする。

本計画の中心概念は次の一文に集約する。

> Mission Pilotは、Taskを完了するために必要な情報を自分で取得し、現在の状況から次の操作をLLMで判断し、失敗した場合はCoding Agentへ具体的な修正依頼を送り、その結果を再評価しながら完了まで継続するユーザー代替エージェントである。

現行UI、公開API、既存テスト、正常系の手続き型挙動は互換境界として維持する。ただし、それらをMission Pilotの意味判断を固定するworkflowとしては使用しない。

## 1. Product Concept

### 1.1 Mission Pilotの役割

Mission Pilotは固定手順を自動実行するworkflow engineではない。Taskを再生したユーザーの代わりに、現在のTaskを観測し、考え、操作し、結果を確認するAI agentである。

Mission Pilotは次を一つの継続した仕事として扱う。

1. TaskのGoal、完了条件、現在状態を読む。
2. 判断に必要なSpecification、Questionnaire、Artifact、Run outcome、repository情報を取得する。
3. 現在ユーザーが実行できる操作から次のactionを選ぶ。
4. Coding Agent、Test Agent、Review Agentへ必要な仕事を依頼する。
5. 実行結果、失敗、blocker、検証結果を読む。
6. 必要ならCoding Agentへ修正Promptを送り、結果を再評価する。
7. Taskの完了条件を満たすまで、同じ論理sessionで判断を継続する。
8. 完了条件を満たしたと判断した場合だけ、Taskの完了またはarchive actionを実行する。

### 1.2 正常系の手続き型挙動

現行の代表的な正常系は、新しいMission Pilotでも実行できなければならない。

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

ただし、この順序をhostの固定transitionとして強制しない。この並びは、現在のTaskに適切であればLLMが選べる一つのaction sequenceである。

Taskによっては、LLMが追加調査、Plan修正、Coding Agent再実行、Test再実行、Review省略、Test省略、ユーザーへの質問などを選べる。正常系を再現できることと、すべてのTaskを正常系へ押し込むことを混同しない。

### 1.3 ユーザー代替の意味

Mission PilotはNightWorkers内部の特権Supervisorではない。

- 現在ユーザーがTask上で見られる情報を上限として観測する。
- 現在ユーザーが実行できる操作を上限として行動する。
- UIと同じapplication command、authorization、preconditionを使う。
- Mission Pilot専用のDB直接更新、強制遷移、権限bypassを作らない。
- filesystem、repository、Git、network、外部serviceの権限を拡張しない。
- Playによって許可されていないpushを実行しない。

## 2. Locked Compatibility Boundary

このリファクタリングでは、内部の判断主体を置き換える。既存UIを新runtimeに合わせて作り替えない。

### 2.1 UI互換

次を変更しない。

- `MissionPilotControlPanel`の配置、表示、文言、Play/Stop操作。
- Playボタンをruntime status textへ置き換える挙動。
- Mission Pilot専用のconfirmation panelや確認ボタン。
- Questionnaireの既存UIと介入時間。
- Pilot ThoughtとCoding Agent chatの表示分離。
- 現在のTask画面、Plan Mode、証跡チェック、Review Modeの操作面。

内部runtimeが`running`、`waiting`、`attention`等の状態を持っても、既存UIへ新しい状態名として公開しない。

Mission Pilotがユーザー入力を必要とする場合は、既存Task messageと既存の待機・停止表現を使う。新しい確認UIを追加しない。

### 2.2 API互換

次を変更しない。

- Mission Pilotの既存route path。
- Play/Stop requestとresponseの公開shape。
- `missionPilotControlSummarySchema`の既存fieldと意味。
- Questionnaire draft API。
- Plan progress API。
- execution trace APIの既存consumer contract。

内部用のconversation、tool call、event、runtime stateは公開Control Summaryへ追加しない。内部情報を取得する必要がある場合も、既存UIに依存させない内部portまたは監査用queryとして分離する。

### 2.3 テスト互換

現行Mission Pilotテストは変更前baselineとして維持する。

- 現在成功しているMission Pilot unit test 21 files / 123 testsを継続して通す。
- 現行testのassertionを、新runtimeに合わせる目的で弱めない。
- 現行E2Eの正常系、pre-Queue handoff、archive、trace separationを維持する。
- UIのDOM、表示文言、スクリーンショットに意図しない差分を出さない。

固定phase helperやlegacy coordinatorを直接検証する既存testは、互換testとして当面残してよい。ただし、新agent runtimeがそれらをsemantic decisionにimportしていないことをarchitecture testで保証する。

### 2.4 Phaseの互換用途

既存の`phase`は、UIと既存testへ現在の進行を示す互換projectionとして残す。

- action開始・完了・待機eventから既存phaseへ投影する。
- 正常系では現在と同じphase列を観測できるようにする。
- phaseは次actionを決定する入力にしない。
- phaseから自動的にTest、Review、closeoutを開始しない。
- recovery時にphase名から次actionを推定しない。

互換projectionは表示と監査のためのread modelであり、Mission Pilot conversationとLLM判断が進行の正本である。

## 3. Decision Ownership

### 3.1 LLMが決めること

次はTaskの意味に関わるため、Mission PilotのLLMが決める。

- Taskを進めるために追加で読むべき情報。
- Questionnaireへの回答と回答理由。
- どのPlan Artifactを生成または修正するか。
- 現在のPlanでImplementationへ進めるか。
- Coding Agentへ何を依頼するか。
- Coding Agentの結果がTask Goalを満たしているか。
- TestまたはReviewが必要か。
- Test/Review失敗後に再実行、コード修正、Plan修正のどれを選ぶか。
- blockerやerrorが自己回復可能か。
- Coding Agentへ送る修正Promptの内容。
- 追加情報を取得するか、別actionを試すか、ユーザーへ質問するか。
- Taskを完了、commit、archiveするか。
- ユーザーへ報告する内容。

### 3.2 Hostが決めてよいこと

hostは構造的不変条件だけを強制する。

- tool inputのschema validation。
- user、Task、Project、repositoryのauthorization。
- revision、CAS、lease、idempotency、deduplication。
- transactionとside effectの成立確認。
- filesystem、Git、network、external actionのpermission。
- provider transport、timeout、rate limit等のtyped failure化。
- 明示的にretryableな一時障害の回数制限付きretry。
- token、tool call、elapsed time等のresource budget。
- process restart後の未完了tool call reconciliation。
- typed Task eventの永続化と重複排除。
- ユーザーのStop、Task削除、権限失効の反映。

hostはprecondition違反やerrorをtyped tool resultとしてLLMへ返す。host自身が別actionを選んだり、固定phaseへ遷移したりしない。

### 3.3 禁止する判断方法

- Task本文、ユーザー文言、LLM本文、error messageのkeyword分類。
- 正規表現によるTask種別、成功、失敗、next actionの分類。
- Todo名、Artifact名、phase名からのnext action決定。
- boolean質問へ常に`true`を返す等の固定Questionnaire回答。
- 推奨選択肢または先頭選択肢を常に採用する規則。
- Implementation完了後のTest自動開始。
- Test完了後のReview自動開始。
- Review完了後のcloseout自動開始。
- 固定correction回数に基づくsemantic completion。
- LLM本文をhostの固定診断文へ置き換える処理。

## 4. Target Architecture

```text
Existing UI / Existing API
          |
          v
Mission Pilot Compatibility Facade
  - existing Play / Stop contract
  - existing Control Summary
  - existing phase / activity projection
          |
          v
Persistent Mission Pilot Runtime
  - one logical session per Task
  - Mission Pilot conversation
  - LLM tool loop
  - typed event inbox
  - lease / cancellation / compaction
       |                  |
       v                  v
Task Read Port       Task Action Registry
       |                  |
       |                  v
       |          Shared Application Commands
       |                  |
       +---------> Task / Workers / Repository
                              |
                              v
                     Typed terminal outcomes
                              |
                              +----> same Mission Pilot session
```

Compatibility Facadeは既存consumerを守る。Persistent Runtimeは意味判断を担当する。この二つを同じstate machineにしない。

## 5. Persistent Agent Runtime

### 5.1 Session invariant

- 一つのTaskに一つのMission Pilot logical sessionを持つ。
- Play、Stop、resume、worker完了、再修正、context compactionでsession IDを作り直さない。
- provider conversationが失われても、NightWorkers上のconversationから同じlogical sessionを再構成する。
- process restart後も同じconversation revisionから再開する。
- ユーザーの追加messageを同じsessionの新しい入力として扱う。

### 5.2 Internal lifecycle

内部runtime stateはdomain phaseではなく、agentの実行状態だけを表す。

```text
stopped
running
waiting
attention
completed
```

- `running`: LLM turnまたはtool callを実行している。
- `waiting`: worker、user、timer、typed eventを待っている。
- `attention`: 権限不足、ユーザーだけが決められる情報不足、resource budget到達等。
- `stopped`: ユーザーが停止した。
- `completed`: Taskの完了actionが成立した。

これらの状態名は既存UIへ追加表示しない。

### 5.3 Tool loop

1. session leaseをclaimする。
2. 未読typed eventと新しいユーザー入力をconversationへ追加する。
3. Mission Pilot LLMへSystem Context、conversation tail、利用可能toolを渡す。
4. LLMがread toolを呼んだ場合は、結果をconversationへ追加して判断を続ける。
5. LLMがaction toolを呼んだ場合は、共通application commandで実行する。
6. tool resultを本文を改変せずconversationへ追加する。
7. 長時間Runを開始した場合は、pollingせずturnを終了して`waiting`へ移る。
8. terminal eventを受けたら、同じsessionをwakeする。
9. LLMがassistant messageだけを返した場合も正常なturn終了として扱う。
10. Task完了はassistant本文ではなく、Task complete/archive actionの成立で確定する。

### 5.4 Resource safety

無限loop対策はsemantic correction回数ではなく、構造的budgetとして実装する。

- provider calls per wake。
- tool calls per wake。
- token budget。
- elapsed time。
- concurrent lease count。
- provider retry count。

budget到達時は途中結果を保存し、固定の次工程へ進めない。再開、停止、ユーザーへの報告を可能にする。

## 6. Information Acquisition

Mission Pilotは必要な情報を自分で取得する。hostは最初から固定された巨大contextを組み立てず、正本への参照とread toolを提供する。

### 6.1 Required read capabilities

最低限、次の情報を取得できるようにする。

- Task Goal、description、acceptance criteria、status、revision。
- Project、repository、worktree、branchの状態。
- 現在のSpecificationとdigest。
- Questionnaire session、質問、回答、採用済みDecision。
- Plan Artifact一覧、種類、revision、source refs。
- Queue entryとactive Run。
- terminal Run一覧。
- Coding/Test/Review Runのユーザー向け最終報告。
- blocker、verification summary、Artifact refs。
- commit、working tree、owned changed pathsのユーザー可視summary。
- 現在ユーザーが実行可能なTask action。

### 6.2 Worker boundary

Mission Pilotが読むworker情報は、ユーザーがTask上で確認できるpersisted outcomeに限定する。

含めるもの:

- terminal status。
- final report。
- blocker report。
- verification summary。
- structured findings。
- diff/commit/Artifactへの参照。

含めないもの:

- workerのreasoning。
- workerの逐次assistant message。
- workerのtool call履歴。
- command stdout/stderr全文。
- token stream。
- Todoごとの実況。

Mission Pilotはworker streamをpollまたはsubscribeせず、typed terminal eventからpersisted outcomeを読む。

### 6.3 Context compaction

- compactionはtoken budgetだけを根拠に実行する。
- ユーザーの依頼、採用済み判断、実行済みaction、未解決事項を保持する。
- Specification、Artifact、Run outcomeは正本参照とdigestを保持する。
- worker transcriptをsummary sourceへ入れない。
- paging可能な情報はpaging cursorとdigestを残す。
- compaction後も同じlogical sessionを継続する。

## 7. Task Action Registry

### 7.1 Single source of truth

UIとMission Pilotは、同じapplication commandを使用する。

Task Action Registryは次を一箇所で定義する。

- action ID。
- user-facing description。
- input schema。
- authorization。
- precondition。
- expected revision。
- idempotency contract。
- application command handler。
- typed result/failure schema。

Mission Pilot専用にUI操作を再実装しない。Mission Pilot action adapterがDBを直接更新しない。

### 7.2 Action groups

最低限、次の操作を対象にする。

- Task情報更新とTask message送信。
- Questionnaire作成、回答案保存、確定。
- Plan routing、Artifact生成、Artifact再生成。
- Queue投入、停止、再開。
- repository準備またはimport。
- Coding Agent開始、停止、再依頼。
- Test開始、停止、再実行。
- Review開始、停止、再実行。
- commit。
- Task complete。
- archive。
- 現在許可されている場合だけpush。

### 7.3 Availability

- action catalogは現在ユーザーの権限とTask revisionから生成する。
- phase、Todo名、Task本文のkeywordでtoolを隠さない。
- 実行不能なactionも必要に応じてavailabilityと理由を返す。
- 実行時にもauthorizationとpreconditionを再検証する。
- stale revisionはtyped conflictとして返す。
- tool error後の別actionはLLMが決める。

## 8. Coding Agent Repair Loop

### 8.1 Goal

Mission Pilotはerrorや未達成条件に遭遇したとき、それを単に`attention`へ変換して停止するのではなく、必要な情報を読み、修正可能な問題ならCoding Agentへ具体的な修正依頼を送る。

### 8.2 Repair sequence

```text
Failure or incomplete result
        |
        v
Mission Pilot reads current Facts
  - Task / Specification
  - terminal Run outcome
  - verification / findings
  - current repository summary
        |
        v
LLM decides the next action
  - request Coding Agent repair
  - retry a transient action
  - run Test or Review
  - gather more information
  - ask the user
  - stop
        |
        v
Coding Agent repair Run
        |
        v
typed terminal outcome
        |
        v
Mission Pilot re-evaluates
```

この分岐をhostのerror code mapやkeyword ruleとして実装しない。LLMがtyped failureと現在Factを読んで判断する。

### 8.3 Repair Prompt contract

Coding Agentへ送るPromptはMission PilotのLLMが作成し、少なくとも次を含める。

```ts
type MissionPilotRepairRequest = {
  goal: string;
  observedProblem: string;
  failure: {
    kind: string | null;
    message: string;
    sourceRunId: string | null;
  };
  canonicalRefs: Array<{
    kind: string;
    id: string;
    revision?: number;
    digest?: string;
  }>;
  requestedOutcome: string;
  preserve: string[];
  verification: string[];
  priorAttemptRefs: string[];
};
```

- `observedProblem`は実際のfinal report、blocker、verification、findingに基づく。
- 正しい既存部分とユーザー変更を`preserve`で明示する。
- Coding AgentへTask全体のやり直しを無条件に依頼しない。
- 同じPromptを結果確認なしに再送しない。
- source revisionとdigestを保持し、古い仕様に対する修正を防ぐ。
- worker本文が存在する場合は固定診断文へ差し替えない。

### 8.4 Re-evaluation

Coding Agent終了後、Mission Pilotは次を再取得する。

- terminal final reportとblocker。
- changed paths、diff、commit summary。
- verification結果。
- current Task revision。
- current Specification/Artifact revision。
- 未達成のacceptance criteria。

その結果から、追加修正、Test、Review、完了、ユーザー確認のいずれかをLLMが選ぶ。固定回数で成功扱いまたは失敗扱いにしない。

## 9. Persistence and Events

### 9.1 Conversation store

Mission Pilot自身のconversationをworker messageから分離して保存する。

保存対象:

- versioned System Context。
- 初期Task依頼。
- Mission Pilot宛ての追加ユーザーmessage。
- assistant message。
- tool callとtool result。
- typed Task event。
- terminal Run outcome projection。
- compaction summaryとsource revision。

tool callとresultはcall IDで対応させ、crash後に実行済みside effectを重複実行しない。

### 9.2 Wake events

Mission Pilotをwakeするeventはtyped application eventとする。

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

event IDとTask revisionで重複を排除する。event本文をkeyword分類してwake理由やnext actionを変えない。

### 9.3 Stop and restart

- Stopはactive LLM turnをcancelし、必要ならactive Runの停止を既存commandへ依頼する。
- process restart時はleaseと未完了tool callをreconcileする。
- action実行済みでresult保存前にcrashした場合はidempotency keyから結果を復元する。
- restart後に旧phaseから次actionを生成せず、current FactsとconversationからLLMを再開する。

## 10. Compatibility Implementation

### 10.1 Existing sessions

- 既存sessionはTaskとsession IDを維持する。
- rollout中は既存の実行中sessionを現行runtimeで完走させてよい。
- 新runtimeへの移行はactive side effectがない安全な境界で行う。
- migrationのために旧phaseをdiagnosticとして読むことは許可するが、System Contextの命令やnext actionへ変換しない。
- rollbackしてもTask、Run、Artifact、commitを巻き戻さない。

### 10.2 New sessions

新runtimeを有効化した新規sessionでも、既存Control SummaryとUIだけを返す。runtime種別を公開しない。

段階展開用の内部rollout flagは許可するが、ユーザー向けmodeとして表示しない。turn途中でruntime ownershipを切り替えない。

### 10.3 Questionnaire compatibility

- 既存Questionnaire draft table、API、UI、deadlineを維持する。
- production agentではLLMが質問とTask contextを読んで回答案を作る。
- LLMが作った回答案を既存draftとして保存し、ユーザーが同じUIで修正できるようにする。
- deadline後は既存の提出commandを使用する。
- providerに到達できない場合、固定回答を自動生成して提出しない。
- 現行の固定回答helperは既存testまたは移行中のlegacy session向けに残してよいが、新runtimeから使用しない。

### 10.4 Normal-path projection

deterministic provider fixtureが正常系action sequenceを返す場合、新runtimeは既存と同じ外部結果を生成する。

- 同じQuestionnaire/Plan Artifact正本。
- 同じQueue/Run application commands。
- 同じTest/Review成果物。
- 同じcommit ownership検証。
- 同じTask complete/archive結果。
- 同じ既存phase projection。
- 同じPilot Thoughtとchat分離。

これにより、現行手続き型挙動を維持しながら、productionではLLMがTaskに応じて別sequenceを選べる。

## 11. Incremental Implementation Plan

大規模な一括置換を禁止する。各段階を独立してmerge、検証、rollbackできる単位にする。

### Stage 0: Baseline lock

目的:

- UI/API/testの互換境界をコードとtestで固定する。

実装:

- Mission Pilot unit test baselineを記録する。
- 既存E2E scenarioを整理する。
- Control Summary contract testを追加する。
- Mission Pilot Control PanelのDOM/表示contractを追加する。
- 現行正常系のaction/event trace fixtureを保存する。

完了条件:

- 現行21 files / 123 testsが変更なしで成功する。
- 既存Mission Pilot E2Eが成功する。
- UI/API互換の禁止変更がtestで検出できる。

### Stage 1: Internal persistence

目的:

- production挙動を変えず、永続conversationとevent inboxを追加する。

実装:

- Mission Pilot conversation table/repository。
- tool call/result tableまたは同等の永続構造。
- typed event inbox/checkpoint。
- lease、idempotency、crash reconciliation。
- compaction metadata。

完了条件:

- UI/API responseに差分がない。
- 現行runtimeのaction sequenceに差分がない。
- restart後にconversationと未完了callを復元できる。
- worker transcriptがconversationへ保存されない。

### Stage 2: Shared read/action ports

目的:

- Mission Pilotがユーザー相当の情報と操作を使えるようにする。

実装:

- Task Read Port。
- terminal Run Outcome Port。
- Task Action Registry。
- UI application commandへのadapter。
- typed action result/failure。
- authorization/revision/idempotency contract。

完了条件:

- Mission Pilot専用DB mutationがない。
- UIとMission Pilotが同じcommand handlerを呼ぶ。
- action availabilityがphase/keywordで制限されない。
- current userより強い権限を取得しない。

### Stage 3: Shadow agent

目的:

- side effectを実行せず、LLMが必要情報を取得して次actionを選べることを確認する。

実装:

- System Context。
- provider adapter。
- read tool loop。
- proposed action audit。
- current Task eventからのwake。

完了条件:

- LLMが不足情報をread toolで取得する。
- fixed phaseをpromptまたはruntime判断に使用しない。
- worker transcriptを読まない。
- 現行正常系と同じaction sequenceを提案できる。
- 非定型scenarioで現行workflowと異なる妥当なactionを提案できる。

### Stage 4: Agent action execution

目的:

- 新規sessionでLLMを実際の次action決定者にする。

実装:

- action tool execution。
- wait/wake loop。
- existing phase projection。
- Play/Stop compatibility facade。
- active Run terminal event連携。

完了条件:

- 既存UI/APIに差分がない。
- deterministic providerで現行正常系E2Eを再現できる。
- Test/Review不要Taskをhostが固定工程へ送らない。
- assistant text-only turnをfailureにしない。
- process restart後も同じsessionで継続する。

### Stage 5: Coding Agent repair loop

目的:

- error、Test失敗、Review finding、未達成条件から自律的に修正を継続する。

実装:

- repair request schemaと永続化。
- Coding Agent start actionへのPrompt連携。
- terminal outcome再評価。
- verification再取得。
- user messageによる途中指示反映。

完了条件:

- Coding Agent失敗後にMission Pilotが新しい修正Promptを生成する。
- 修正Run完了後に結果を読んで再判断する。
- 同じPromptを無条件に再送しない。
- 成功確認前にTaskを完了しない。
- permission/provider/revision errorをコード修正と決め打ちしない。

### Stage 6: Cutover and simplification

目的:

- 新runtimeを通常経路にし、固定workflowをsemantic controllerから外す。

実装:

- 新規sessionの段階的cutover。
- 既存sessionの安全な完走またはmigration。
- fixed coordinatorのproduction参照除去。
- unused legacy codeの参照調査。
- rollback期間終了後の段階的cleanup。

完了条件:

- production agent runtimeがfixed post-Queue transitionをimportしない。
- Questionnaire固定回答を使用しない。
- Implementation/Test/Review/closeoutをhostが自動選択しない。
- 現行testと新agent testがすべて成功する。
- UI/APIに意図しない差分がない。
- normal-pathとadaptive-pathの両方が成功する。

## 12. Verification Strategy

### 12.1 Existing regression gate

各Stageで最低限、次を実行する。

```bash
bunx vitest run tests/mission-pilot-*.test.ts
```

期待結果:

```text
Test Files  21 passed
Tests       123 passed
```

既存Mission Pilot E2Eも対象fileを明示して実行する。

- `tests/e2e/mission-pilot-entry.spec.ts`
- `tests/e2e/mission-pilot-pre-queue-handoff.spec.ts`
- `tests/e2e/mission-pilot-through-archive.spec.ts`
- `tests/e2e/mission-pilot-trace-separation.spec.ts`

baseline数が正当な追加testによって増えることは許可するが、既存testの削除、skip、assertion弱体化でgreenにしない。

### 12.2 Architecture tests

- agent runtimeがpost-Queue transition tableをimportしない。
- agent runtimeがTest/Review gateをnext action決定に使わない。
- agent runtimeがQuestionnaire固定回答helperを使わない。
- Mission Pilot moduleがworker transcript query/streamへ依存しない。
- Task/LLM/error本文をsemantic keyword分類しない。
- action adapterがTask/Run stateを直接DB mutationしない。
- public Mission Pilot schemaへ内部runtime fieldを追加しない。
- Mission Pilot Control Panelへ新status/confirmation UIを追加しない。

### 12.3 Deterministic parity scenario

fixture providerに正常系tool callsを返させ、次を検証する。

1. Questionnaireを作成・回答する。
2. Plan Artifactを作成する。
3. Coding Agentを開始する。
4. terminal outcomeを受け取る。
5. Testを開始する。
6. Reviewを開始する。
7. commitする。
8. complete/archiveする。
9. 既存phase、Task status、trace分離、archive結果が現在と同等である。

### 12.4 Adaptive scenarios

#### Scenario A: Information gathering

- 最初のcontextだけでは判断できないTaskを与える。
- Mission Pilotがread toolでSpecification、Artifact、repository状態を取得する。
- 情報取得前にImplementationを開始しない。

#### Scenario B: Coding repair

- Coding Agentが修正可能なerrorを返す。
- Mission Pilotがfailureとcurrent Factsを読む。
- 具体的なrepair Promptを生成してCoding Agentを再実行する。
- 修正結果と検証結果を再評価する。
- 成功確認後にのみ完了する。

#### Scenario C: Test failure

- Testが失敗する。
- Mission PilotがTest結果と関連Artifactを読む。
- Coding Agentへ対象を絞った修正を依頼する。
- Testを再実行し、成功を確認する。

#### Scenario D: Stale revision

- action実行前にTask revisionを変更する。
- stale conflictをLLMへ返す。
- Mission Pilotが最新状態を読み直す。
- hostが旧actionを自動再実行しない。

#### Scenario E: User override

- worker待機中にユーザーが追加messageを送る。
- 同じMission Pilot sessionをwakeする。
- 新しい指示を反映して次actionを変更する。

#### Scenario F: Restart and compaction

- tool call前後でprocess restartを発生させる。
- side effectを重複実行しない。
- 同じconversation revisionから判断を継続する。
- compaction後も採用済み判断と未解決事項が残る。

#### Scenario G: Optional Test/Review

- TestまたはReviewが不要なTaskを与える。
- LLMが完了条件と現在成果を読んで不要と判断できる。
- hostが固定工程として追加しない。

### 12.5 Security and permission scenarios

- 現在ユーザーにないactionを実行できない。
- Play authorizationにpushがない場合はpushできない。
- Task/repository scope外の操作を拒否する。
- stale approval/revisionを拒否する。
- idempotency keyが異なる重複side effectを防ぐ。
- UIにないMission Pilot専用bypassが存在しない。

## 13. Observability

記録するもの:

- Mission Pilot session IDとconversation revision。
- wake event IDと消費revision。
- LLM assistant message。
- read/action tool callとresult。
- action source revisionとidempotency key。
- Coding Agent repair Promptとsource refs。
- terminal Run outcome refs。
- compaction revision。
- waiting/attention理由。
- normal-pathとadaptive-pathのaction trace。

記録しないもの:

- worker reasoning。
- worker逐次tool logのMission Pilot conversationへの複製。
- command stdout/stderr全文のMission Pilot contextへの複製。

観測結果からhostがnext actionを補正しない。System Context、tool description、read model品質の改善材料として使う。

## 14. Prohibited Changes

- Mission Pilot UIの再設計。
- Playボタンをstatus textへ置き換える変更。
- Mission Pilot専用confirmation panelの追加。
- `runtimeKind`、`runtimeState`等の内部fieldを公開Control Summaryへ追加する変更。
- 現行testを削除、skip、弱体化して互換性を装う変更。
- 過去の大規模実装commitをそのまま復元する変更。
- Mission Pilot専用action registryとUI actionの二重実装。
- Mission Pilot action adapterからのTask/Run DB直接mutation。
- fixed phaseとagent runtimeの両方が同じsessionのnext actionを決める構成。
- provider共通層、Coding Agent runtime、Todo runtimeを同時に大規模変更すること。
- worker transcriptをMission Pilot promptへ投入すること。
- 同じ失敗Promptの無条件再送。
- 未検証の変更をTask完了の証拠にすること。
- LLMが返した本文をhost固定文へ置換すること。

## 15. Definition of Done

次をすべて満たしたとき、このリファクタリングを完了とする。

1. Mission Pilotが一つのlogical sessionでTask開始から完了まで継続する。
2. Mission Pilotが不足情報をread toolで自律的に取得できる。
3. 次action、Test/Review要否、修正、完了をLLMが判断する。
4. errorまたは未達成条件からCoding Agentへ具体的なrepair Promptを送れる。
5. Coding Agentの結果を再取得し、成功条件を再評価できる。
6. 成功確認前にTaskを完了しない。
7. 正常系では現在の手続き型action sequenceと外部結果を再現できる。
8. 非定型Taskでは固定sequenceから外れて妥当なactionを選べる。
9. UI、公開API、Control Summaryに意図しない変更がない。
10. 現行Mission Pilot unit testとE2Eがすべて成功する。
11. 新agent runtimeが固定phase/gateをsemantic decisionに使用しない。
12. Questionnaire回答を固定規則で決めない。
13. worker transcriptをMission Pilotが追跡しない。
14. process restartとcontext compaction後も同じconversationを継続する。
15. UIと同じauthorization、revision、idempotency、application commandを使用する。
16. Playで許可されていないpushやscope外操作を実行しない。
17. current userより強い権限をMission Pilotが持たない。
18. UIに新しいruntime statusやconfirmation表示を追加していない。
19. normal-path、repair-path、restart-path、user-override-pathのE2Eが成功する。
20. rollback期間終了後、固定workflowをproduction semantic controllerから除去できている。

## 16. First Implementation Slice

最初の実装ではproduction behaviorを切り替えない。次の小さな範囲に限定する。

1. 現行UI/API/test baselineを固定するcharacterization testを追加する。
2. 内部conversation storeとtyped event inboxを追加する。
3. worker transcriptを保存しないarchitecture testを追加する。
4. Task Read Portの最小contractを追加する。
5. LLMがread toolで情報を取得し、side effectなしで次actionを提案するshadow turnを追加する。
6. 現行21 files / 123 testsと既存E2Eが変わらず成功することを確認する。

このsliceでは次を行わない。

- UI変更。
- 公開schema変更。
- Play/Stop挙動の切替。
- fixed coordinatorの削除。
- Mission Pilotによるside effect実行。
- provider共通層の大規模変更。
- Coding Agent runtimeの変更。

最初のsliceがgreenになった後、Stage 2以降へ進む。

## 17. Luna Overnight Execution Contract

この節は、Lunaが夜間に本計画を継続実装する際の実行規約である。Concept、互換境界、禁止事項より優先される例外は設けない。

### 17.1 Start protocol

実装開始時に次を順番どおり行う。

1. repository rootで`AGENTS.md`と本計画書を読む。
2. `git status --short`を記録し、開始前から存在する変更をuser-owned changeとして扱う。
3. 開始前の変更をrevert、stash、format、stageしない。
4. baseline unit test、typecheck、architecture checkを実行する。
5. baselineが失敗した場合は、新実装を開始せず、失敗内容と開始前差分を記録する。
6. baselineがgreenの場合だけCheckpoint C1へ進む。

開始時点で本計画書と`AGENTS.md`にuser-owned changeが存在する可能性がある。Lunaは自分が変更した箇所以外を整理しない。

### 17.2 Work discipline

- Checkpointを飛ばさない。
- 一つのCheckpointをgreenにしてから次へ進む。
- 各Checkpointを独立commitにする。
- 前Checkpointのcommitをamendまたはsquashしない。
- unrelated refactor、rename、format-allを行わない。
- testを削除、skip、弱体化しない。
- UI差分を新runtimeの都合で正当化しない。
- provider共通層へ必要のない変更を広げない。
- 失敗したtestに合わせてproduction semantic ruleを追加しない。
- 既存のdirty changeと重なる場合は、最小差分で回避する。
- 未確認side effectを完了扱いにしない。

### 17.3 Continue / stop rule

Lunaは次の条件を満たす限り、自動的に次Checkpointへ進んでよい。

- current Checkpointのtargeted testがgreen。
- 既存Mission Pilot unit testがgreen。
- typecheckがgreen。
- `git diff --check`がgreen。
- UI/API禁止差分がない。
- current Checkpoint外のproduction fileを変更していない。

次の場合はcurrent Checkpoint内で修正を続け、次へ進まない。

- schema/bootstrapを二度実行すると失敗する。
- existing testが一件でも回帰する。
- Mission Pilotがworker transcriptへ依存する。
- Task Action AdapterがTask/Run tableを直接mutationする。
- public schemaまたはUI変更が必要に見える。
- actionのidempotencyまたはcrash recoveryが未定義。
- provider本文またはworker final reportを固定文へ置換している。
- fixed phase/gateがagentのnext actionを決めている。

### 17.4 Commit message sequence

commit messageは次のprefixを使用する。番号はCheckpointと一致させる。

```text
feat(mission-pilot): C1 add internal agent persistence
feat(mission-pilot): C2 add read model and run outcomes
feat(mission-pilot): C3 add shared task action registry
feat(mission-pilot): C4 add persistent llm tool runtime
feat(mission-pilot): C5 add typed wake events
feat(mission-pilot): C6 add llm questionnaire drafting
feat(mission-pilot): C7 add coding repair loop
feat(mission-pilot): C8 connect compatibility facade
test(mission-pilot): C9 add agent parity and recovery e2e
refactor(mission-pilot): C10 cut over new sessions
```

commitは各Checkpointの検証成功後に作成する。検証失敗状態をcheckpoint commitにしない。

## 18. Locked File Layout

新runtimeは`api/modules/missionPilot/agent/`へ閉じ込める。既存Mission Pilot rootにagent固有のprovider、conversation、tool executionを散在させない。

### 18.1 Add files

```text
api/db/mission-pilot-agent-schema.ts
api/db/mission-pilot-agent-schema-bootstrap.ts

api/modules/missionPilot/agent/
  mission-pilot-agent.constants.ts
  mission-pilot-agent.types.ts
  mission-pilot-agent.ports.ts
  mission-pilot-agent-session.repository.ts
  mission-pilot-agent-turn.repository.ts
  mission-pilot-conversation.repository.ts
  mission-pilot-tool-call.repository.ts
  mission-pilot-task-event.repository.ts
  mission-pilot-task-read-model.ts
  mission-pilot-task-read.adapter.ts
  mission-pilot-run-outcome.adapter.ts
  mission-pilot-task-action.registry.ts
  mission-pilot-task-action.adapter.ts
  mission-pilot-provider.adapter.ts
  mission-pilot-system-context.ts
  mission-pilot-context-compaction.ts
  mission-pilot-compatibility-projection.ts
  mission-pilot-questionnaire-draft.adapter.ts
  mission-pilot-repair-request.ts
  mission-pilot-agent-runtime.ts
  mission-pilot-agent-wake.service.ts
  mission-pilot-agent-startup.service.ts
```

各fileの責務は一つに限定する。

| File | Responsibility |
| --- | --- |
| `mission-pilot-agent.types.ts` | agent内部型。UI/shared public schemaをimportさせるための追加fieldを定義しない |
| `mission-pilot-agent.ports.ts` | read、action、provider、conversation、eventのinterface |
| `mission-pilot-agent-session.repository.ts` | engine ownership、runtime state、lease、revisionのCAS |
| `mission-pilot-agent-turn.repository.ts` | 一回のwake/turn claim、finish、crash reconciliation |
| `mission-pilot-conversation.repository.ts` | ordered conversation append、load、compaction |
| `mission-pilot-tool-call.repository.ts` | tool call claim、idempotency、result/failure保存 |
| `mission-pilot-task-event.repository.ts` | typed inbox append、dedupe、claim、consume |
| `mission-pilot-task-read-model.ts` | providerへ渡すbounded read modelのpure type/build helpers |
| `mission-pilot-task-read.adapter.ts` | existing query serviceからユーザー可視Factを読む |
| `mission-pilot-run-outcome.adapter.ts` | terminal Runをtranscriptなしのoutcomeへ投影する |
| `mission-pilot-task-action.registry.ts` | action ID、schema、scope、handler metadataの正本 |
| `mission-pilot-task-action.adapter.ts` | registry actionをexisting application commandへ渡す |
| `mission-pilot-provider.adapter.ts` | existing `callProviderToolTurn`境界だけを利用する |
| `mission-pilot-system-context.ts` | 日本語のrole/tool guidance。fixed workflowを書かない |
| `mission-pilot-context-compaction.ts` | token budget判定とsummary request |
| `mission-pilot-compatibility-projection.ts` | action/eventから既存phase/activity表示だけを更新する |
| `mission-pilot-questionnaire-draft.adapter.ts` | LLM回答を既存draft table/APIへ保存する |
| `mission-pilot-repair-request.ts` | repair request schemaとCoding Agent Prompt renderer |
| `mission-pilot-agent-runtime.ts` | lease付きprovider/tool loop。domain action handlerを持たない |
| `mission-pilot-agent-wake.service.ts` | event-driven schedulingとsingle-flight |
| `mission-pilot-agent-startup.service.ts` | restart reconciliationとsafe resume |

### 18.2 Existing files allowed to change

```text
api/db/client.ts
api/db/bootstrap.ts
api/modules/missionPilot/mission-pilot.service.ts
api/modules/missionPilot/mission-pilot-questionnaire.service.ts
api/modules/missionPilot/mission-pilot.repository.ts
api/modules/missionPilot/index.ts
api/modules/nightworkers/nightworkers.task-creation.service.ts
api/modules/nightworkers/nightworkers.workbench-message.service.ts
api/modules/nightworkers/nightworkers.repository.ts
api/modules/questionnaire/questionnaire-events.ts
```

変更理由:

- DB schema登録とidempotent bootstrap。
- Play/Stop/startup/run terminalのagent-owned branch。
- Questionnaire readyのtyped event化。
- 新規Taskのinternal engine ownership作成。
- user message/task updateのgeneric typed event publish。
- Coding Agent repair PromptをUIと同じRun開始commandへ渡す共有command抽出。

### 18.3 Files not allowed to change

原則として次を変更しない。

```text
src/modules/missionPilot/components/MissionPilotControlPanel.tsx
src/modules/missionPilot/missionPilotCommands.ts
src/modules/missionPilot/missionPilotPresentation.ts
shared/schemas/mission-pilot.schema.ts
api/modules/missionPilot/mission-pilot.routes.ts
```

conversationやagent内部debugを公開するためのroute追加も、この実装では行わない。既存execution traceへ監査eventを投影する場合も既存response consumerを壊さないappend-only fieldに限定し、UIからfetchさせない。

### 18.4 No deletion before cutover

C1からC9までは既存legacy fileを削除しない。C10でも既存testが直接参照するhelperは残す。

production importがなくなり、rollback期間が終了した後にだけ、別commitでunused code削除を検討する。夜間実装の完了条件にphysical deletionを含めない。

## 19. Agent Persistence Schema

既存`mission_pilot_sessions`をagent内部fieldで拡張しない。1:1のagent session tableとappend-only tableを追加する。

### 19.1 `mission_pilot_agent_sessions`

```ts
type MissionPilotAgentSessionRow = {
  sessionId: string; // PK, FK mission_pilot_sessions.id
  engineMode: "shadow" | "agent";
  runtimeState: "idle" | "running" | "waiting" | "attention" | "completed";
  systemContextVersion: number;
  conversationRevision: number;
  lastConsumedEventSequence: number;
  currentTurnId: string | null;
  providerEndpointId: string | null;
  model: string | null;
  thinkingDepth: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastFailureJson: MissionPilotActionFailure | null;
  createdAt: Date;
  updatedAt: Date;
};
```

constraints/indexes:

- `session_id` primary key。
- `session_id`は`mission_pilot_sessions.id`へ`ON DELETE CASCADE`。
- `(runtime_state, lease_expires_at)` index。
- `conversation_revision >= 0`はapplication validationで保証する。
- agent rowが存在しないsessionはlegacy-ownedとみなす。
- public Control Summaryへ`engineMode`または`runtimeState`を出さない。

### 19.2 `mission_pilot_agent_turns`

```ts
type MissionPilotAgentTurnRow = {
  id: string;
  sessionId: string;
  triggerEventId: string | null;
  status: "claimed" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  leaseOwner: string;
  leaseExpiresAt: Date;
  providerCallCount: number;
  toolCallCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  failureJson: MissionPilotActionFailure | null;
};
```

constraints/indexes:

- `id` primary key。
- `(session_id, status)` index。
- sessionあたりactive turnは一件。partial indexが使えない場合はagent session CASで保証する。
- trigger eventとturnの対応を保持し、同じeventから二重turnを作らない。

### 19.3 `mission_pilot_conversation_items`

```ts
type MissionPilotConversationItemRow = {
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
    | "run_outcome"
    | "compaction_summary"
    | "runtime_failure";
  bodyJson: Record<string, unknown>;
  sourceKind: string | null;
  sourceId: string | null;
  tokenEstimate: number;
  compactedByItemId: string | null;
  createdAt: Date;
};
```

constraints/indexes:

- `(session_id, sequence)` unique。
- `(session_id, source_kind, source_id, kind)` unique when source is present。SQLiteではnullable uniqueの挙動を考慮し、dedupe key columnを追加してもよい。
- append時にagent sessionの`conversationRevision`を同一transactionでincrementする。
- `bodyJson`は正本本文とdiagnosticを別fieldで保持する。

### 19.4 `mission_pilot_agent_tool_calls`

```ts
type MissionPilotAgentToolCallRow = {
  id: string;
  sessionId: string;
  turnId: string;
  providerCallId: string;
  toolName: string;
  actionId: string | null;
  argumentsJson: Record<string, unknown>;
  argumentsDigest: string;
  idempotencyKey: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  resultJson: Record<string, unknown> | null;
  failureJson: MissionPilotActionFailure | null;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};
```

constraints/indexes:

- `(session_id, provider_call_id)` unique。
- `(session_id, idempotency_key)` unique。
- same idempotency key + different arguments digestはconflict。
- completed callは再実行せずpersisted resultをconversationへ再投影する。

### 19.5 `mission_pilot_agent_events`

```ts
type MissionPilotAgentEventRow = {
  id: string;
  sessionId: string;
  taskId: string;
  sequence: number;
  eventType: MissionPilotAgentEventType;
  sourceEventId: string;
  taskRevision: number;
  payloadJson: Record<string, unknown>;
  status: "pending" | "claimed" | "consumed" | "failed";
  availableAt: Date;
  claimedAt: Date | null;
  consumedAt: Date | null;
  attempt: number;
  lastError: string | null;
  createdAt: Date;
};
```

constraints/indexes:

- `(session_id, sequence)` unique。
- `(session_id, source_event_id)` unique。
- `(status, available_at)` index。
- event claimとturn claimを同一transactionまたはCAS chainで結ぶ。

### 19.6 Bootstrap requirements

- `api/db/mission-pilot-agent-schema-bootstrap.ts`はすべて`CREATE TABLE IF NOT EXISTS`と`CREATE INDEX IF NOT EXISTS`で実装する。
- bootstrapを連続二回実行しても成功するtestを追加する。
- C1では既存table/columnをdrop、rename、backfillしない。
- `api/db/client.ts`へschemaをmergeする。
- `api/db/bootstrap.ts`から既存Mission Pilot bootstrapの後にagent bootstrapを呼ぶ。
- schema作成失敗時に既存Mission Pilot tableを変更しない。

## 20. Internal Contracts and Ports

### 20.1 Task read model

```ts
type MissionPilotTaskReadModel = {
  task: {
    id: string;
    repositoryId: string;
    title: string;
    objective: string | null;
    acceptanceCriteria: string | null;
    status: string;
    revision: number;
  };
  repository: {
    id: string;
    localPath: string;
    branch: string;
    allowed: boolean;
    worktreePath: string | null;
  };
  specification: {
    messageId: string;
    artifactKind: string;
    revision: number | null;
    digest: string;
  } | null;
  questionnaire: {
    sessionId: string;
    status: string;
    revision: number;
    unresolvedQuestionIds: string[];
    adoptedDecisionIds: string[];
  } | null;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    revision: number | null;
    digest: string;
    sourceMessageId: string | null;
  }>;
  queue: {
    entryId: string;
    status: string;
    activeRunId: string | null;
  } | null;
  activeRuns: MissionPilotRunSummary[];
  terminalRuns: MissionPilotRunSummary[];
  availableActions: MissionPilotTaskActionDescriptor[];
  observedAt: string;
};
```

`revision`は現在Task schemaに専用revisionがない場合、既存`updatedAt`のmillisecond値をCAS tokenとして使う。独自の擬似revisionを本文から生成しない。

### 20.2 Run outcome

```ts
type MissionPilotRunOutcome = {
  runId: string;
  taskId: string;
  executionMode: string | null;
  terminalState: string;
  summary: string | null;
  finalReport: string | null;
  blocker: {
    code: string | null;
    message: string;
  } | null;
  verificationSummary: string | null;
  structuredFindings: Array<{
    id: string;
    severity: string;
    title: string;
    body: string;
  }>;
  changedPaths: string[];
  commitRef: string | null;
  artifactRefs: Array<{ kind: string; id: string }>;
  completedAt: string | null;
};
```

禁止field:

- `logContent`
- command stdout/stderr全文
- Todo event stream
- assistant/tool transcript
- raw reasoning

`diffPatch`全文もdefault outcomeへ入れない。必要な場合はユーザー可視Artifact参照またはbounded diff summaryとして別read toolで取得する。

### 20.3 Typed action failure

```ts
type MissionPilotActionFailure = {
  kind:
    | "schema_validation"
    | "authorization"
    | "revision_conflict"
    | "domain_precondition"
    | "transport"
    | "timeout"
    | "rate_limit"
    | "provider_capacity"
    | "authentication"
    | "permission"
    | "invalid_request"
    | "resource_limit"
    | "unknown";
  message: string;
  retryable: boolean;
  code: string | null;
  httpStatus: number | null;
  retryAfterMs: number | null;
  actionId: string | null;
  idempotencyKey: string | null;
  currentTaskRevision: number | null;
  details: Record<string, unknown> | null;
};
```

既存`StructuredProviderError`はこの型へlosslessに変換する。provider error bodyのbounded raw textを保持する。

### 20.4 Ports

```ts
interface MissionPilotTaskReadPort {
  readWorkspace(taskId: string): Promise<MissionPilotTaskReadModel>;
  readArtifact(taskId: string, artifactId: string): Promise<unknown>;
  readRunOutcome(taskId: string, runId: string): Promise<MissionPilotRunOutcome>;
  listAvailableActions(taskId: string, sessionId: string): Promise<MissionPilotTaskActionDescriptor[]>;
}

interface MissionPilotTaskActionPort {
  execute(input: {
    sessionId: string;
    taskId: string;
    actionId: string;
    arguments: Record<string, unknown>;
    expectedTaskRevision: number;
    idempotencyKey: string;
  }): Promise<MissionPilotActionResult>;
}

interface MissionPilotProviderPort {
  nextTurn(input: {
    taskId: string;
    systemPrompt: string;
    messages: ProviderToolMessage[];
    tools: ProviderToolDefinition[];
    signal: AbortSignal;
    routeOverride: StructuredLlmModelTarget | null;
  }): Promise<ProviderToolTurnResult>;
}
```

provider portは`api/services/structured-llm/public.ts`の次だけを使用する。

- `buildNormalizedSupervisorLlmRequestCandidates`
- `callProviderToolTurn`
- `ProviderToolMessage`
- `ProviderToolDefinition`
- `ProviderToolTurnResult`
- `normalizeStructuredProviderError`

provider共通typeをMission Pilot用に複製しない。

## 21. Read and Action Catalog

### 21.1 Read tools

| Tool | Input | Source | Output rule |
| --- | --- | --- | --- |
| `read_task_workspace` | `{}` | `nightworkers.getTask/getRepository`, Plan workspace query, questionnaire query, Run query | bounded current Fact。worker transcriptなし |
| `read_current_specification` | `{}` | `getPlanModeWorkspace`とcurrent Artifact selection | source message ID、digest、revisionを返す |
| `read_artifact` | `{ artifactId }` | Artifact domain query | current Task ownershipを検証する |
| `read_run_outcome` | `{ runId }` | `getTaskRun`のterminal fieldsとcommit/review summary | `logContent`と逐次eventsを除外する |
| `list_available_task_actions` | `{}` | Task Action Registry | schema、availability、expected revisionを返す |

read toolはDB mutation、Task message作成、phase更新を行わない。

### 21.2 Action registry mapping

| Action ID | Existing application command | Scope | Required arguments |
| --- | --- | --- | --- |
| `task.message.send` | `appendTaskMessage` | `plan` | `content`、provenance metadata |
| `questionnaire.create` | `createDesignQuestionnaire` | `plan` | `prompt`、optional source Blueprint |
| `questionnaire.draft.save` | extracted existing draft save command | `plan` | questionnaire session、answers、answer evidence |
| `questionnaire.submit` | `saveDesignQuestionnaireAnswers` | `plan` | session ID、answers |
| `questionnaire.review.generate` | `generateDesignQuestionnaireReview` | `plan` | session ID |
| `questionnaire.review.accept` | `acceptDesignQuestionnaireReview` | `plan` | session ID |
| `plan.artifact.feature_plan.generate` | `generateFeaturePlanArtifact` | `plan` | prompt、source selection、questionnaire ref |
| `plan.artifact.blueprint.generate` | `generateBlueprintArtifact` | `plan` | prompt、source selection |
| `plan.artifact.data_model.generate` | `generateDataModelArtifact` | `plan` | prompt、source selection |
| `plan.artifact.view.generate` | `generatePlanViewArtifact` | `plan` | target kind、prompt、source selection |
| `plan.artifact.regenerate` | existing Plan Artifact correction command | `plan` | target Artifact、defect、preserve、source revisions |
| `task.queue.enqueue` | `queueTask` | `queue` | current task revision |
| `run.implementation.start` | shared Workbench run-from-prompt command | `implementation` | request、model selection、source refs |
| `review.session.start` | `startReviewSessionForRun` | `review` | source run ID |
| `review.run.start` | `startReviewRun` | `review` | review session ID、options |
| `run.stop` | `stopTaskRun` | matching run scope | run ID |
| `git.commit` | `commitRunGitCloseout` | `localCommit` | source run ID、existing closeout input |
| `git.push` | `pushRunGitCloseout` | `push` | source run ID |
| `task.complete` | `reviewTaskRun(..., action: "complete")` | `taskComplete` | source run ID、note、evidence refs |
| `task.archive` | `archiveCompletedTask` | `taskArchive` | existing completed Task evidence |

`task.delete`はTask完遂に不要であり、初版agent catalogへ含めない。Mission Pilotに削除能力を与えることは本計画の完了条件ではない。

### 21.3 Shared Coding Agent start command

repair Promptを確実にCoding Agentへ渡すため、`appendWorkbenchMessage(intent: "run_task")`内部の次処理をapplication commandとして抽出する。

```ts
startWorkbenchRunFromPrompt({
  taskId,
  prompt,
  source: "user" | "mission_pilot",
  sourceRef,
  idempotencyKey,
  routeOverride,
})
```

command requirements:

- UIの`run_task`も同じcommandを呼ぶ。
- prompt messageをTaskへ保存する。
- `source: "mission_pilot"`をmetadataへ記録し、user-message wake loopから除外する。
- idempotency keyでmessageとRunの重複作成を防ぐ。
- message保存後、Run作成前にcrashした場合は再実行で同じmessageを採用する。
- active equivalent Runが既にあれば新規作成せず、そのRunをresultとして返す。
- public UI request/response shapeを変更しない。

### 21.4 Action validation order

全actionは次の順序で検証する。

1. registry definition lookup。
2. JSON schema validation。
3. Mission Pilot session/task ownership。
4. Play authorization scope。
5. current Task revision。
6. domain precondition。
7. idempotency lookup。
8. application command execution。
9. persisted result verification。
10. tool result保存。

application commandが成功したか確認できない場合は`completed`にしない。

## 22. Provider and Tool Loop Algorithm

### 22.1 Provider selection

- roleは既存`mission_pilot`を使用する。
- `buildNormalizedSupervisorLlmRequestCandidates`でroute candidatesを取得する。
- candidateごとに`callProviderToolTurn`を呼ぶ。
- native tool unsupportedの場合だけ次candidateへ進む。
- typed retryable provider failureは既存retry-afterと上限に従う。
- authentication、permission、invalid requestを同じcandidateへ無条件retryしない。
- providerが返したassistant本文とtool callsを両方保存する。

Codex providerにnative tool turnが未対応の場合、本実装のためにCodex runtimeを改造しない。OpenAI/Azure/Bedrockまたはconfigured fallbackを使用し、全candidate unsupportedならtyped attentionとする。

### 22.2 Runtime constants

初期値を一箇所にまとめる。

```ts
export const MISSION_PILOT_AGENT_LIMITS = {
  leaseMs: 60_000,
  maxProviderCallsPerWake: 16,
  maxToolCallsPerWake: 32,
  maxProviderRetriesPerCandidate: 2,
  softContextTokens: 80_000,
  hardContextTokens: 120_000,
  maxToolResultBytes: 256_000,
} as const;
```

実際のconfigured model contextがこれより小さい場合はmodel capabilityのsafe budgetを優先する。resource limitは固定domain actionへ変換せず、conversationへfailureを保存してwaiting/attentionにする。

### 22.3 Wake pseudocode

```ts
async function runMissionPilotWake(sessionId: string) {
  const claim = await claimAgentTurn(sessionId);
  if (!claim) return "not_claimed";

  const controller = registerAbortController(sessionId);
  try {
    await appendClaimedEventsToConversation(claim);

    while (!controller.signal.aborted) {
      await renewTurnLease(claim);
      await compactIfNeeded(sessionId);

      const messages = await loadProviderMessages(sessionId);
      const tools = await buildToolsForCurrentAuthorization(sessionId);
      const response = await provider.nextTurn({ messages, tools });

      const persistedCalls = await persistAssistantAndToolCalls(response);
      if (persistedCalls.length === 0) {
        await finishTurnAsWaiting(claim);
        return "waiting";
      }

      for (const call of persistedCalls) {
        await renewTurnLease(claim);
        const result = await claimAndExecuteTool(call);
        await appendToolResult(sessionId, call, result);

        if (result.kind === "long_running_started") {
          await finishTurnAsWaiting(claim);
          return "waiting";
        }
        if (result.kind === "task_completed") {
          await finishTurnAsCompleted(claim);
          return "completed";
        }
      }
    }

    await finishTurnAsCancelled(claim);
    return "stopped";
  } catch (error) {
    const failure = normalizeFailure(error);
    await preserveFailureAndFinishTurn(claim, failure);
    return failure.retryable ? "waiting" : "attention";
  } finally {
    unregisterAbortController(sessionId);
  }
}
```

### 22.4 Tool execution ordering

- providerが複数tool callを返しても、side effect toolはprovider順に逐次実行する。
- read-only toolのみで依存がないことが明らかな場合でも、初版は逐次実行して監査順序を固定する。
- 一つのside effect toolがlong-running Runを開始したら、後続tool callをcancelし、terminal event後にLLMへ再判断させる。
- Task complete/archive後の後続tool callは実行しない。
- tool failure後も、providerへtool resultを返して同じwake内で再判断させてよい。ただしresource limitとretryable provider failure以外をhostが自動retryしない。

### 22.5 System Context requirements

System Contextは日本語で、次を含める。

- Mission Pilotの役割と権限上限。
- Goal達成のため必要情報をread toolで取得すること。
- fixed workflowを前提にしないこと。
- worker transcriptは利用できず、terminal outcomeを読むこと。
- error時にcurrent Factsを読み、修正、retry、別action、user questionを判断すること。
- code/test/reviewの問題は必要に応じてCoding Agentへ具体的なrepair requestを送れること。
- Task完了はactual actionで行うこと。
- UI互換phaseを判断に使わないこと。

System Contextへ個別Taskの答え、固定action sequence、error code mapを書かない。

## 23. Typed Event Integration

### 23.1 Event types and publishers

| Event | Publisher | Payload |
| --- | --- | --- |
| `mission_pilot.play_requested` | `mission-pilot.service.play` | session version、reason |
| `mission_pilot.resume_requested` | startup/resume service | restart reason |
| `mission_pilot.stop_requested` | `mission-pilot.service.stop` | session version |
| `task.user_message_added` | generic Task message event adapter | message ID、Task revision。本文はconversation seed時にsourceから読む |
| `task.state_changed` | generic Task update event adapter | previous/current status、revision |
| `questionnaire.ready` | questionnaire listener | questionnaire session ID、revision |
| `questionnaire.draft_changed` | existing draft update path | draft ID、version、source |
| `task_run.started` | Run listener | run ID、execution mode |
| `task_run.terminal` | Run listener | run ID、terminal status。outcome本文はadapterから読む |
| `task_action.failed` | action adapter | tool call ID、typed failure |
| `mission_pilot.retry_timer_elapsed` | wake scheduler | source failure ID |

event payloadへworker transcriptを入れない。

### 23.2 User message event

generic Task message publisherをNightWorkers側へ追加する場合、Mission Pilot moduleへ直接importさせない。

```ts
registerTaskMessageCreatedListener(listener)
publishTaskMessageCreated(message)
```

Mission Pilot adapterは次だけをwake対象にする。

- `role === "user"`。
- metadata sourceが`mission_pilot`ではない。
- message IDがconversationに未投影。
- agent sessionがplaying。

Mission Pilot自身がCoding Agentへ送ったrepair Promptで自己wakeしない。

### 23.3 Run event

既存`registerTaskRunUpdatedListener`を継続使用する。

- legacy-owned sessionは現行`syncCompletedRun`とrecoveryへ渡す。
- agent-owned sessionはterminal eventをagent inboxへ追加し、wakeをscheduleする。
- agent branchではpost-Queue coordinatorを呼ばない。
- started eventはactiveRun compatibility projectionに使用する。
- terminal eventはrun outcome adapterのsource refだけを保存する。

### 23.4 Questionnaire event

既存`registerQuestionnaireReadyListener`を継続使用する。

- legacy-owned sessionは現在の固定draft生成を維持する。
- agent-owned sessionは`questionnaire.ready`をappendしてwakeする。
- LLMが`questionnaire.draft.save`を呼ぶまで固定回答を保存しない。
- draft保存後に既存20秒deadlineとUI projectionを開始する。
- userがdraftを変更した場合はその回答を確定ユーザーFactとしてconversationへ投影する。

### 23.5 Startup recovery

startup時に次を行う。

1. expired running turnを`failed`または`cancelled`へreconcileする。
2. running tool callのidempotency resultを確認する。
3. completed side effectのresultをtool resultへ復元する。
4. unconsumed eventを持つplaying agent sessionをscheduleする。
5. active Runを持つagent sessionは新しいRunを開始せずwaitingにする。
6. terminal Runなのにeventがない場合はsource IDからeventを一度だけbackfillする。
7. legacy recoveryは既存処理をそのまま実行する。

## 24. Compatibility Facade Integration

### 24.1 Engine ownership

公開schemaへruntime kindを追加しない。内部判定は次の規則に固定する。

```text
mission_pilot_agent_sessions row absent  -> legacy-owned
engine_mode = shadow                     -> legacy executes, agent observes only
engine_mode = agent                      -> agent executes, legacy does not decide
```

一つのsessionでlegacyとagentが同時にside effectを決める状態を禁止する。

### 24.2 New Task ownership

- C1からC9では新規Taskのdefaultをlegacyのままにする。
- agent testはhelperで明示的にagent rowを作る。
- C10で新規Task creation transactionへagent row作成を追加し、defaultをagentに切り替える。
- 既存Taskはagent rowがないためlegacyのまま完走できる。
- existing session migrationは夜間実装の必須条件にしない。
- shadow/agent ownershipはUI/APIへ表示しない。

### 24.3 Play

public `play(taskId, expectedVersion)` signatureとresponseを維持する。

agent-owned branch:

1. existing `claimPlay`相当でauthorization、desiredState、versionを更新する。
2. initial Task promptを一度だけconversationへseedする。
3. `mission_pilot.play_requested`をappendする。
4. first wakeを開始する。
5. first wakeが`waiting`、`attention`、`completed`のstable boundaryへ到達するまでawaitする。
6. existing `missionPilot` summary、`run: null`、`messages: []` shapeを返す。

HTTP client disconnectでagent turnを自動停止しない。Stop actionまたはlease cancellationだけを停止根拠にする。

### 24.4 Stop

agent-owned branch:

1. existing expectedVersion CASでdesiredStateをstoppedへ更新する。
2. active provider AbortControllerをabortする。
3. pending tool callsをcancelする。ただしrunning side effectはresult reconcile対象にする。
4. active Task Runがあればexisting `stopTaskRun`を呼ぶ。
5. public response shapeを維持する。

### 24.5 Phase projection

compatibility projectionは次の情報だけを使用する。

- agent action ID。
- tool call status。
- Task Run started/terminal typed event。
- questionnaire draft state。
- Task status。

Task本文、LLM本文、error本文を読まない。

normal-path projection example:

| Observed action/event | Existing phase projection |
| --- | --- |
| Play claim | `starting` |
| Questionnaire ready/draft | `waiting_intervention`または既存intake phase |
| Plan Artifact action | `generating_artifacts` |
| Queue action completed | `queued` |
| Implementation Run started | `implementing` |
| Test Run started | `testing` |
| Review Run started | `reviewing` |
| commit action running | `committing` |
| Task complete action | `completed` |
| archive action | `archived` |

このtableはpresentation projectionであり、逆方向の`phase -> action`変換を実装しない。

### 24.6 Execution trace

既存`pilot_thought` channelへ次をappendする。

- assistant message。
- read/action tool開始と完了のbounded summary。
- repair Prompt summaryとsource refs。
- waiting reason。
- runtime failure。

worker chat、tool log、command outputをPilot Thoughtへcopyしない。既存trace separation E2Eを維持する。

## 25. Coding Agent Repair Implementation

### 25.1 Repair request construction

repair requestはhostがerror種別から自動生成しない。LLMがtool argumentsとして構造化する。

`run.implementation.start`は通常requestとrepair requestの両方を受ける。

```ts
type RunImplementationStartInput = {
  request: string;
  sourceRefs: Array<{ kind: string; id: string; digest?: string }>;
  repair?: MissionPilotRepairRequest | null;
  providerEndpointId?: string | null;
  model?: string | null;
  thinkingDepth?: string | null;
};
```

hostはschema、Task ownership、source ref存在、revisionだけを検証する。`observedProblem`本文の意味を再分類しない。

### 25.2 Prompt rendering

Coding Agentへ渡すPromptは次の順序でrenderする。

```text
[Mission Pilot Repair Request]

## Goal
...

## Observed Problem
...

## Current Canonical References
- kind / id / revision / digest

## Requested Outcome
...

## Preserve
- ...

## Verification
- ...

## Prior Attempts
- run refs only
```

Mission Pilotの推測とworker本文を区別する。worker final reportまたはblockerは引用用fieldとして保持し、host diagnosticに置き換えない。

### 25.3 Repair completion

repair Run terminal event後は自動的にTestやReviewを開始しない。

1. `read_run_outcome`をLLMへ提示する。
2. current Task workspaceを再取得可能にする。
3. LLMが追加read、別repair、Test、Review、completeを選ぶ。
4. previous repair requestとnew requestをconversationに残す。
5. same source revision + same request digestの再送はtool-level idempotencyで同じresultを返す。
6. 異なる修正を行う場合はnew requestとnew idempotency keyを必要とする。

### 25.4 Non-code failures

次は例示であり、host分岐ではない。System ContextでLLMへ判断材料として説明する。

- transport/rate limit/provider capacity: retryable metadataを見る。
- authentication/permission:同じactionを無条件retryしない。
- revision conflict:current Factsを読み直す。
- missing user preference:既存Task messageで質問する。
- code/test/review defect:Coding Agent repairを検討する。
- unavailable action:available actionを読み直す。

## 26. Checkpoint Implementation Matrix

### C0: Baseline evidence

Change:

- production code変更なし。
- baseline commandsと結果をimplementation logへ記録する。
- UI/API contract architecture testを必要に応じて追加する。

Gate:

- existing Mission Pilot unit test green。
- typecheck green。
- current E2E source assertionsを変更しない。

### C1: Add internal persistence

Add/modify:

- agent DB schema/bootstrap。
- repositoriesのCRUD/CAS unit test。
- DB client/bootstrap registration。

Do not:

- Mission Pilot serviceへ接続しない。
- agent rowを既存/new Taskへ自動作成しない。

Target tests:

- schema bootstrap twice。
- conversation sequence concurrency。
- event dedupe。
- tool idempotency conflict。
- turn lease single owner。

### C2: Add read model and Run outcome

Add/modify:

- read model、read adapter、Run outcome adapter。
- no-transcript architecture test。

Do not:

- providerを呼ばない。
- Task/Runをmutationしない。

Target tests:

- current Artifact selection。
- terminal outcome本文保持。
- `logContent`、raw tool events、command output不在。
- another TaskのArtifact/Run拒否。

### C3: Add Task Action Registry

Add/modify:

- registry、schema validation、action adapter。
- shared Workbench run-from-prompt command。
- existing UI pathをshared commandへ接続するがresponseを変えない。

Do not:

- Mission Pilot runtimeからactionを呼ばない。
- direct DB mutation handlerを追加しない。

Target tests:

- action/tool schema生成。
- authorization scope rejection。
- stale revision。
- idempotent Run start。
- UI `run_task` regression。

### C4: Add persistent provider/tool runtime

Add/modify:

- provider adapter、System Context、runtime、compaction。
- fixture providerを使うruntime unit test。

Do not:

- production Playへ接続しない。
- actual Task side effectをfixture test以外で実行しない。

Target tests:

- read -> action -> tool result loop。
- assistant text-only waiting。
- provider unsupported candidate fallback。
- retryable provider failure上限。
- Stop abort。
- context compaction/resume。

### C5: Add typed events and wake service

Add/modify:

- task message generic listener。
- Run/questionnaire event adapter。
- wake scheduler、startup reconciliation。

Do not:

- legacy-owned sessionのevent処理を変更しない。
- agent defaultを有効化しない。

Target tests:

- user message wake once。
- Mission Pilot self-message no wake。
- terminal Run event once。
- active Run waits without polling。
- restart recovers expired turn/tool call。

### C6: Add LLM Questionnaire draft

Add/modify:

- agent draft adapter。
- current questionnaire serviceにagent-owned event branch。
- existing deadline/submit path再利用。

Do not:

- legacy fixed draft helperを削除しない。
- UIを変更しない。

Target tests:

- LLM answer保存。
- user edit evidence優先。
- deadline submit。
- provider failure時にfixed answerをsubmitしない。
- current questionnaire tests green。

### C7: Add Coding Agent repair loop

Add/modify:

- repair schema/renderer。
- implementation action integration。
- terminal outcome re-evaluation fixture。

Target tests:

- failure -> repair Prompt -> new Run。
- Prompt source refs/digest。
- preserve/verification保持。
- same request idempotency。
- repair Run後にhostがTestを自動開始しない。

### C8: Connect compatibility facade

Add/modify:

- agent-owned Play/Stop branch。
- compatibility phase projection。
- trace projection。
- startup service integration。

Do not:

- public schema/route/UIを変更しない。
- new Task defaultをagentにしない。

Target tests:

- internal agent-owned session Play/Stop。
- public response exact match。
- existing Control Summary fields only。
- normal-path phase projection。
- legacy session unchanged。

### C9: Agent E2E and parity

Add:

- deterministic agent normal-path E2E。
- Coding repair E2E。
- restart/idempotency integration test。
- optional Test/Review scenario。
- UI no-change assertion。

Gate:

- all existing Mission Pilot unit/E2E green。
- all new agent unit/E2E green。
- typecheck、architecture、docs checks green。

### C10: Cut over new sessions

Change:

- new Task creation transactionでagent session rowを作る。
- default `engineMode = "agent"`。
- existing session row absenceはlegacyのまま。
- test helperでlegacy/agent ownershipを明示できるようにする。

Gate:

- existing Task continues legacy。
- new Task uses agent internally。
- public API/UIから差を観測できない。
- agent normal-path and repair E2E green。
- current legacy E2E green。

C10後もlegacy files/tablesをdropしない。

## 27. Verification Commands

### 27.1 Fast gate after every Checkpoint

```bash
git diff --check
bunx vitest run tests/mission-pilot-*.test.ts
bun run typecheck
```

既存baselineの21 files / 123 testsは少なくとも維持する。new test追加後は総数が増える。

### 27.2 Architecture gate after C2 and later

```bash
bun run check:architecture
bun run check:docs
```

Biomeは変更fileに限定して実行してよい。

```bash
bunx biome check api/modules/missionPilot/agent api/db/mission-pilot-agent-schema.ts api/db/mission-pilot-agent-schema-bootstrap.ts
```

### 27.3 Existing Mission Pilot E2E gate

```bash
bun run test:e2e \
  tests/e2e/mission-pilot-entry.spec.ts \
  tests/e2e/mission-pilot-pre-queue-handoff.spec.ts \
  tests/e2e/mission-pilot-through-archive.spec.ts \
  tests/e2e/mission-pilot-trace-separation.spec.ts
```

実行環境都合でE2E server起動に失敗した場合は、test failureとenvironment failureを区別して記録する。assertion failureをenvironment failure扱いしない。

### 27.4 Provider regression gate after C4

```bash
bun run test:supervisor-regression
bunx vitest run tests/structured-llm/services-structured-llm-02.test.ts
```

Mission Pilot implementationのためにprovider regression expectationを変更しない。

### 27.5 Final gate

```bash
bun run verify:fast
bun run typecheck
bun run check:architecture
bun run check:docs
bun run test:e2e \
  tests/e2e/mission-pilot-entry.spec.ts \
  tests/e2e/mission-pilot-pre-queue-handoff.spec.ts \
  tests/e2e/mission-pilot-through-archive.spec.ts \
  tests/e2e/mission-pilot-trace-separation.spec.ts \
  tests/e2e/mission-pilot-agent-autopilot.spec.ts \
  tests/e2e/mission-pilot-agent-repair.spec.ts
```

`verify:fast`がrepository-wide unrelated failureを含む場合も、Mission Pilot targeted gateは別に報告する。

## 28. Test File Plan

追加test fileは責務単位に分ける。

```text
tests/mission-pilot-agent-schema.test.ts
tests/mission-pilot-agent-session-repository.test.ts
tests/mission-pilot-conversation-repository.test.ts
tests/mission-pilot-task-event-inbox.test.ts
tests/mission-pilot-task-read-model.test.ts
tests/mission-pilot-run-outcome-adapter.test.ts
tests/mission-pilot-no-transcript-boundary.test.ts
tests/mission-pilot-task-action-registry.test.ts
tests/mission-pilot-agent-runtime.test.ts
tests/mission-pilot-agent-wake.test.ts
tests/mission-pilot-agent-questionnaire.test.ts
tests/mission-pilot-agent-repair.test.ts
tests/mission-pilot-agent-compatibility.test.ts
tests/mission-pilot-semantic-control-architecture.test.ts

tests/e2e/mission-pilot-agent-autopilot.spec.ts
tests/e2e/mission-pilot-agent-repair.spec.ts
```

### 28.1 Semantic-control architecture assertions

new agent directory全体に対して次のimport/identifierを禁止する。

- `MissionPilotPostQueuePhase`
- `evaluateImplementationCompletionGate`
- `evaluateTestCompletionGate`
- `evaluateReviewCompletionGate`
- `MISSION_PILOT_CORRECTION_LIMITS`
- `missionPilotPhaseRuns`
- `missionPilotReviewDecisions`
- `missionPilotCloseouts`
- `start_test`
- `start_review`
- `run_closeout`

compatibility projection fileだけはexisting phase stringを使用できる。projection fileからruntime/action adapterへのimportを禁止し、runtimeからprojection resultをnext actionへ戻せない依存方向にする。

### 28.2 No-transcript assertions

new agent directoryから次への依存を禁止する。

- `listTaskRunEvents`
- `listTaskRunActivityEvents`
- `logContent`
- worker assistant/tool message query。
- command output stream。

`getTaskRun`を使うadapterでは、返却objectから許可fieldを明示pickする。spreadでRun row全体を返さない。

### 28.3 UI compatibility assertions

- `MissionPilotControlPanel.tsx`にagent runtime importがない。
- public Control Summaryに`engineMode`、`runtimeState`がない。
- composer controlはbuttonのまま。
- `確認が必要です`等の新status labelを追加しない。
- Play/Stop aria-labelと既存iconを維持する。

## 29. Rollback Plan

### 29.1 Primary rollback switch

agent session rowがないsessionはlegacy-ownedである。この性質をprimary rollback boundaryとする。

- C1-C9ではdefault agent rowを作らないため、production behaviorは変わらない。
- C10のnew Task ownership作成をrevertすれば、新規Taskもlegacyへ戻る。
- 既にagent rowを持つTaskは、active turn/tool callをreconcileしてからrowの`engineMode`を`shadow`へ変更するか、safe boundaryでrowを削除する。
- running side effectがある間にownershipを切り替えない。

### 29.2 Commit rollback order

rollbackは逆順に行う。

```text
C10 ownership cutover
C9 agent E2E only
C8 compatibility facade
C7 repair loop
C6 questionnaire agent branch
C5 typed event integration
C4 provider/runtime
C3 action registry
C2 read model
C1 additive schema
```

C1 schema tableはcode rollback時にdropしなくてよい。未参照additive tableとして残し、別migrationで削除する。data lossを避けるため、夜間rollbackで`DROP TABLE`を実行しない。

### 29.3 Failed side effect rollback

Git commit、archive、Run start等の成立済みdomain actionは、runtime code rollbackを理由に自動的に巻き戻さない。

- persisted application command resultを正本とする。
- in-flight tool callを`completed`、`failed`、`unknown`へreconcileする。
- `unknown`のまま同じside effectを再実行しない。
- current Task/Run/repository stateをユーザーへ報告する。
- Git destructive recoveryを自動実行しない。

### 29.4 Revert-friendly design rules

- Checkpointごとにcommitを分ける。
- schemaはadditiveにする。
- UI/public schema変更を含めない。
- existing legacy runtimeをC10後も残す。
- agent ownershipをinternal rowだけで切り替える。
- common provider behaviorを変更しない。

## 30. Luna Execution Ledger

Lunaは各Checkpoint完了時に、このtableを更新してよい。commit hashと実行したgateを記録する。

| Checkpoint | Status | Commit | Targeted tests | Existing MP tests | Typecheck | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C0 Baseline | pending |  |  |  |  |  |
| C1 Persistence | pending |  |  |  |  |  |
| C2 Read model | pending |  |  |  |  |  |
| C3 Action registry | pending |  |  |  |  |  |
| C4 Tool runtime | pending |  |  |  |  |  |
| C5 Typed events | pending |  |  |  |  |  |
| C6 Questionnaire | pending |  |  |  |  |  |
| C7 Repair loop | pending |  |  |  |  |  |
| C8 Compatibility | pending |  |  |  |  |  |
| C9 E2E parity | pending |  |  |  |  |  |
| C10 Cutover | pending |  |  |  |  |  |

`Status`は`pending`、`in_progress`、`passed`、`blocked`のいずれかとする。`passed`はcommitとgate結果が揃った場合だけ使用する。

## 31. Locked Implementation Decisions

夜間実装中に再判断して設計を広げないため、次を固定する。

1. UIは変更しない。
2. public Mission Pilot schemaとrouteは変更しない。
3. agent persistenceは別tableに追加する。
4. agent row absenceをlegacy ownershipとする。
5. new Task default cutoverは最後のC10で行う。
6. existing sessionの一括migrationは行わない。
7. providerはexisting native tool turn境界を使う。
8. Codex provider tool対応を本作業へ含めない。
9. worker transcriptをMission Pilotへ渡さない。
10. read adapterは許可fieldをexplicit pickする。
11. action adapterはexisting application commandを呼び、Task/Run DBを直接mutationしない。
12. Coding Agent repair PromptはLLMが作る。
13. hostはrepair要否をerror keywordで決めない。
14. phaseはcompatibility projectionだけに使う。
15. normal-pathはdeterministic provider fixtureで再現する。
16. existing testsを維持し、新agent testsを追加する。
17. legacy codeのphysical deletionは夜間実装へ含めない。
18. rollbackで成立済みdomain side effectを巻き戻さない。

以上を変更する必要が生じた場合、Lunaは独断で変更せず、該当Checkpointを`blocked`として理由と代替案を記録する。
