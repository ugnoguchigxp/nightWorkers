# Mission Pilot Persistent User-Equivalent Agent Refactor Plan

## Status

- Plan status: `implementation-ready`
- Document created: 2026-07-15
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target scope: Mission Pilotのみ
- Parallelization boundary: Native API runner、Codex runtime、Todo runtime、Supervisor全体のリファクタリングとは独立して進める
- Implementation status: not started

### Locked implementation decisions

2026-07-15時点で、実装開始に必要な選択は次のとおり確定済みである。

1. **操作権限:** delete、archive、commit、push、mergeを含め、Mission Pilotは人間ユーザーと同じUI操作を、同じauthorization、confirmation、approval、preconditionで実行できる。Mission Pilot専用の確認、allowlist、権限bypassは追加しない。
2. **既存session:** migration時点で存在するMission Pilot sessionは`legacy`に固定し、旧runtimeで完了または停止させる。新runtimeへmid-flight migrationしない。新runtimeはmigration後に作成されたsessionだけへ適用する。
3. **conversation正本:** `mission_pilot_sessions.id`とNightWorkers DB上のconversationを正本とする。provider conversation IDは任意のresume最適化であり、失われても同じ論理sessionを再構築できる設計にする。
4. **永続化:** 既存のphase前提event tableは拡張せず、conversation、agent turn、tool call、task event inboxを専用tableとして新設する。
5. **runtime選択:** `runtime_kind`はsession作成時に`legacy | agent`のどちらかへ固定する。設定変更は新規sessionにだけ適用し、実行途中の自動切替を行わない。根拠のない割合rolloutやtraffic splitは本計画に含めない。
6. **実装provider:** 既存の`callProviderToolTurn`境界を使い、provider固有sessionへ依存しないmessage/tool loopを実装する。Mission Pilot専用のprovider classifierやfallback本文は追加しない。
7. **削除方針:** Section 16のinventoryを初版の`delete`/`retain`判定正本とする。実装中に新たな対象を発見した場合も同じ判定条件へ追加し、未分類のまま残さない。

この文書を、Mission Pilotを固定workflowの実行器から、NightWorkers上でユーザーの代わりに判断・操作する永続セッション型エージェントへ移行するための実装計画正本とする。

本計画の原則は次の一文に集約する。

> Mission PilotはユーザーがTask上で見て選べる情報と操作をtoolとして受け取り、自身のLLM判断で次の操作を選ぶ。ホストは権限、安全、永続化、並行実行、入力schemaだけを保証し、Taskの意味や次工程を決めない。

実装戦略は`deletion-first`とする。現行のsemantic controlを別名のCoordinator、Decision Service、Gate、Policyへ移植しない。削除で成立する箇所は削除し、残置理由を説明できる最小限のdeterministic boundaryだけを残す。

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

### 2.3.1 Deletion-first残置判定

既存ロジックを残す場合は、次の条件をすべて満たさなければならない。

1. Taskの意味や次操作を決める処理ではなく、決定的な正しさの境界である。
2. schema、authorization、permission、安全、transaction、revision/CAS、lease、idempotency、resource上限、protocol互換のいずれかに分類できる。
3. user/Task/Artifact/LLM/error本文のkeywordや正規表現ではなく、typed fieldまたは構造化stateだけを使用する。
4. 人間ユーザーのUI操作とMission Pilot toolへ同じ条件で適用される。Mission Pilotだけを矯正する条件ではない。
5. 失敗時はtyped errorを返すだけで、別action、別mode、再生成、retry、完了を自動選択しない。
6. 単体testで成立条件と不成立条件を説明できる。
7. この処理を削除すると生じる具体的な権限、安全、整合性、重複実行、resource問題を説明できる。

一つでも満たさない既存分岐、gate、classifier、transition、fallback、recovery prompt、Todo projectionは原則削除する。「既存テストがある」「過去の不具合対策だった」「念のため」は残置理由にしない。

残してよい代表例:

- Zod/JSON schema validation。
- current userとTask authorizationの確認。
- filesystem/network/Git permissionとapproval。
- DB transaction、foreign key、unique constraint、optimistic lock。
- lease、action idempotency、event deduplication。
- timeout、token/context/output上限。
- provider SDKのtyped error、HTTP status、protocol codeのlossless projection。
- version付きかつ一対一で意味を変えないcompatibility migration。

削除する代表例:

- phase transition table。
- current mode/Todo/task typeに基づくnext action決定。
- implementation完了後のTest自動開始。
- Test後のReview自動開始。
- review scoreやfinding countによるArtifact再生成。
- error本文からのretry/recovery/mode分類。
- fixed correction cycleと上限到達後の固定遷移。
- repository bootstrap専用workflowと専用Todo。
- LLM本文を別の固定本文へ差し替える処理。
- Mission Pilotに正しい行動を強制するためだけのtool allowlist。

新runtime実装で、削除対象と同等の意味判断を別の抽象化へ再実装してはならない。必要な行動原則はSystem Contextとtool descriptionへ移し、tool実行結果はFactとしてLLMへ返す。

### 2.4 Plan Artifactの確認義務と再生成原則

Mission Pilotには、Plan ModeでAIが生成したQuestionnaire、Feature Plan、Blueprint、Data Model、API Contractその他の設計Artifactを閲覧し、Taskの実装を誤らせる明白な問題がないか確認する義務がある。

ただし、この確認はMission Pilotが自分の好みで設計を作り直すためのものではない。確定済みQuestionnaire Decisionsはユーザー判断と同等の拘束力を持つ正本であり、Mission Pilotは設計レビューや再生成指示によって次を行ってはならない。

- Questionnaireで採用された要件、制約、検証方針を弱める、狭める、別の選択肢へ置き換える。
- Questionnaireの決定を、実装容易性、Mission Pilot自身の好み、一般的なbest practiceだけを理由に変更する。
- 明示された中核要件を「より単純」「より安全」「より一般的」という理由だけで非対象へ移す。
- Questionnaireに存在しない決定を、確定済みユーザー判断として扱う。
- Plan Artifactの文章表現、粒度、並び順、追加できる詳細だけを理由に再生成する。

Plan Artifactは、明らかな間違いがない限りそのまま採用する。再生成を依頼してよいかはMission PilotのLLMがArtifact本文と確定Factを読んで判断し、実装側のscore、keyword、regex、固定thresholdで決めない。

再生成を依頼できる代表条件は次に限定する。

- Questionnaire DecisionsまたはTaskの明示要件と直接矛盾している。
- repository、使用技術、外部API等について明白な事実誤認があり、そのままでは中核実装を誤る。
- 中核機能を実装するために不可欠な契約が欠け、後続のcoding agentが合理的に実装を開始できない。
- 要件同士が同時に成立せず、現在のArtifactのままでは実装不能である。
- security、privacy、data loss、不可逆操作に具体的で重大な危険がある。
- Artifactが空、破損、schema不成立、参照先欠落等で利用できない。

次は原則としてwarningまたはMission Pilot内部の留意事項に留め、再生成理由にしない。

- より良い命名や文章表現がある。
- 追加できる補足説明がある。
- 実装者がrepositoryを読めば合理的に補える詳細が省略されている。
- Test種別、coverage、E2Eの厚さ、検証commandの細部に改善余地がある。
- 複数の妥当な設計案のうち、Mission Pilotが別案を好む。

再生成する場合も、Mission Pilotは確認した具体的な矛盾または欠落だけを指摘し、Questionnaire Decisionsと正しい既存Artifact部分を維持するよう依頼する。Artifact全文の別設計への置換、対象外の拡張、Questionnaireの再解釈を依頼しない。

### 2.5 Provider/API障害時の再試行原則

Plan Artifact生成、Questionnaire生成、worker起動その他の処理がprovider/API側の一時障害で停止し、Taskを次へ進められない場合、Mission Pilotが再試行を選ぶことを推奨する。

再試行判断はエラー本文のkeywordや正規表現では行わない。provider/transport境界が返す構造化されたfailureをFactとしてMission Pilotへ提示する。

```ts
type MissionPilotActionFailure = {
  kind:
    | "transport"
    | "timeout"
    | "rate_limit"
    | "provider_capacity"
    | "authentication"
    | "invalid_request"
    | "schema_validation"
    | "domain_precondition"
    | "permission"
    | "unknown";
  retryable: boolean | null;
  providerCode: string | null;
  httpStatus: number | null;
  message: string;
  retryAfterMs: number | null;
  attempt: number;
  actionId: string;
  idempotencyKey: string | null;
};
```

`kind`と`retryable`はprovider SDK、HTTP status、typed exception、protocol response等の構造化情報から作る。Task本文、Artifact本文、LLM本文、任意のerror messageをsemantic classifierへ通して決めない。

Mission PilotのSystem Contextには次を判断原則として与える。

- `transport`、`timeout`、`rate_limit`、`provider_capacity`等の一時障害でTaskが停止している場合、retry可能性、attempt、retry-after、idempotencyを確認し、合理的な範囲で再試行を優先する。
- `authentication`、`permission`、`invalid_request`、`domain_precondition`等、同じ入力の再送では改善しないfailureを無条件に繰り返さない。
- `schema_validation`はprovider到達失敗と区別し、raw responseとvalidation issueを確認して、同じ操作のrepair/retry、別action、ユーザー確認を判断する。
- retry上限へ達した場合の次操作をhostが固定せず、現在Factと利用可能actionをMission Pilotへ返す。

hostはretry回数、backoff、retry-after、idempotency、同時実行防止を安全境界として管理できる。ただし「このfailureなら次にどのTask操作をするか」はMission Pilotが決める。低レベルHTTP clientによる同一requestの透過的retryを行う場合も、provider共通のtransport policyに限定し、Mission Pilot固有workflowを開始しない。

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
6. `task.delete`は唯一の終端例外とする。UIと同じTask削除によりsessionがcascade削除され、その後に代替sessionや監査用Taskを作らない。Session ID invariantはTaskが存在する期間に適用する。

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

### 6.4 Provider and resume contract

Mission Pilot runtimeは`api/services/structured-llm/public.ts`の`callProviderToolTurn`を、次の薄い`MissionPilotProviderPort`で包む。

```ts
type MissionPilotProviderPort = {
  nextTurn(input: {
    systemContext: string;
    messages: ProviderToolMessage[];
    tools: ProviderToolDefinition[];
    providerEndpointId: string | null;
    model: string | null;
    thinkingDepth: string | null;
  }): Promise<MissionPilotProviderTurn>;
};
```

- `messages`はDBの最新`compaction_summary`と、それ以降のconversation itemから毎回再構築する。provider内部のthread/conversationが失われてもresumeできる。
- providerがresume referenceを返せる場合はsessionへ保存してよいが、正しさ、順序、dedupeの判定には使わない。
- `ProviderToolTurnResult.type === "unsupported"`はtyped `provider_capability` failureとしてLLM/ユーザーへ投影し、SchemaFirstや固定workflowへ暗黙fallbackしない。
- assistant本文が非空ならtool callの有無やparse結果にかかわらずconversationへ保存する。固定エラー本文へ差し替えない。
- Mission Pilot providerの選択は既存LLM settingsとplay時の明示optionを使う。Task本文、mode、Todo名によるprovider切替は行わない。

provider callの前にturnを`running`で永続化し、provider response受信後はassistant itemとtool call rowsを同一transactionで保存する。transaction commit後にprocessが停止しても、保存済みtool callを再発行せずreconcileできる。provider response受信後かつcommit前に停止した場合はprovider call自体を再実行し得るが、その時点ではTask mutationを開始していないためside effect重複は起こさない。

### 6.5 Retry and resource limits

retryを二層に分離する。

1. **transport retry:** 既存structured-LLM provider境界の共通policyだけを使う。同一HTTP requestのtimeout、connection reset、429/5xx等をtyped provider情報に基づいて透過retryできるが、Mission Pilotの別actionやmodeを開始しない。
2. **Mission action retry:** tool/provider/API failureをconversationへ返し、同じactionを再試行するかはMission Pilot LLMが判断する。hostはerror messageを分類せず、自動で別actionを呼ばない。

同一wakeでの暴走防止だけをresource boundaryとして設ける。初期値は`maxProviderCallsPerWake=16`、`maxToolCallsPerWake=32`とし、到達時はtyped `resource_limit` resultを保存して`attention`へ移る。これはTask意味判断ではなく費用・無限loop防止であり、次actionを選ばない。action mutationは最初の実行で発行したidempotency keyをretryでも再利用する。

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

#### `read_questionnaire_decisions`

現在の確定済みQuestionnaire Decisionsを、question、採用answer、free text、採用理由、source revisionとともに返す。未採用optionを現在の決定と混同しない。Plan Artifact reviewと再生成判断では、このtoolの結果を上位Factとして扱う。

#### `read_plan_artifact`

指定したcurrent ArtifactをIDで読む。Artifact種別をkeywordから推定しない。Mission PilotがArtifactの採用または再生成を判断するときは、Artifact本文だけでなく、対応するQuestionnaire Decisions、Task goal、source revisionを参照できるようにする。

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

UI相当actionは一つのTask Action RegistryからMission Pilot toolへ投影する。初版catalogを次で固定する。`UI/application seam`は現在のUIが呼ぶrouteまたはそのroute配下のapplication serviceであり、Mission Pilot adapterは同じserviceを呼ぶ。route handlerをHTTP loopbackで呼ばない。

| action ID | 入力の要点 | UI/application seam | 実行時の共通条件 |
| --- | --- | --- | --- |
| `task.update` | `expectedRevision`とUIで編集可能なTask field | `PATCH /api/tasks/:id`、`patchTask`配下のtask service | authorization、field schema、revision CAS |
| `task.message.send` | content、artifact context、model option | `POST /api/workbench/sessions/:id/messages`、`appendWorkbenchMessage`配下 | Task access、message schema |
| `task.delete` | UI delete commandと同じ入力 | `DELETE /api/tasks/:id`、`deleteTask`配下 | UIと同じconfirmation/authorization。成功時はTask/session cascade削除でruntime終端。Mission Pilot専用確認は追加しない |
| `task.archive` | UI archive commandと同じ入力 | `PATCH /api/workbench/sessions/:id/archive` | UIと同じarchive precondition |
| `task.archive.restore` | UI restore commandと同じ入力 | `POST /api/workbench/sessions/:id/archive/restore` | UIと同じrestore precondition |
| `questionnaire.create` | source Blueprint message ID | `POST /api/tasks/:id/design-questionnaire` | explicit source、Task access |
| `questionnaire.draft.update` | questionnaire session、answers、expected version | 既存Mission Pilot questionnaire draft serviceを共通application commandへ移す | option ID/schema、version CAS |
| `questionnaire.submit` | questionnaire session、answers、expected version | questionnaire submit service。既存Mission Pilot自動deadline処理は使用しない | 全必須回答、version CAS |
| `questionnaire.follow_up.generate` | questionnaire session ID | `POST /api/tasks/:id/design-questionnaire/:sessionId/follow-up` | current session、provider failure projection |
| `questionnaire.additional.generate` | UI追加質問schema | `POST /api/tasks/:id/design-questionnaire/additional` | current decisionsを保持、provider failure projection |
| `questionnaire.review.generate` | questionnaire session ID | 既存Design Questionnaire review route/service | current revision、provider failure projection |
| `questionnaire.review.accept` | questionnaire session ID | 既存review accept route/service | current review、version CAS |
| `questionnaire.review.leave_unadopted` | questionnaire session ID | 既存review unadopted route/service | current review、version CAS |
| `plan.routing.update` | routing entries、reason、expected revision | `updatePlanModeRoutingForUser`と共通化したcommand | routing schema、revision CAS |
| `plan.artifact.generate` | artifact kind、source IDs、prompt、questionnaire revision | specification/blueprint/data model/plan view generation service | explicit source selection、current revision |
| `plan.artifact.regenerate` | target artifact ID、defect、preserve指示、source revisions | generateと同じservice。Mission Pilot専用correction loopは使わない | target存在、Questionnaire revision一致 |
| `task.queue.enqueue` | Task revision、queue options | `POST /api/workbench/sessions/:id/queue`、`queueWorkbenchSession`配下 | UIと同じqueue admission/idempotency |
| `task.queue.update` | entry ID、position/priority | `PATCH /api/implementation-queue/entries/:id` | entry ownership、queue schema |
| `task.queue.cancel` | entry ID | 同routeの`action=cancel` | entry ownership、terminalでないこと |
| `task.queue.requeue` | entry ID、note | `POST /api/implementation-queue/entries/:id/requeue` | UIと同じrequeue precondition |
| `task.queue.recover` | entry ID、UI recovery action、note | `POST /api/implementation-queue/entries/:id/recover` | typed queue state、authorization |
| `task.queue.archive` | entry ID | `POST /api/implementation-queue/entries/:id/archive` | UIと同じarchive precondition |
| `run.implementation.start` | Task revision、実装依頼、runtime options | `POST /api/workbench/sessions/:id/run`、`startWorkbenchRun`配下 | active Runなし、authorization、run idempotency |
| `run.test.start` | project、spec artifact、verification document、test action | `POST /api/tasks/:id/test-mode-run`、`startTestModeRun`配下 | UIと同じTest Mode schema/precondition |
| `run.stop` | run ID | `POST /api/runs/:runId/stop`、`stopRun`配下 | run ownership、terminalでないこと |
| `background_process.stop` | process ID | `POST /api/background-processes/:id/stop` | Task/process ownership、terminalでないこと |
| `review.session.start` | source run ID | `POST /api/runs/:runId/review-sessions` | source run terminal、authorization |
| `review.run.start` | review session ID、UI options | `POST /api/review-sessions/:id/run`、`startReviewRun`配下 | review session state、option schema |
| `run.review.submit` | run ID、`complete`または`cancel`、note | `POST /api/runs/:runId/reviews`、`submitRunReview`配下 | terminal outcome存在、authorization |
| `git.commit` | source run ID | `POST /api/runs/:runId/git/commit` | UIと同じstage scope/approval |
| `git.push` | source run ID | `POST /api/runs/:runId/git/push` | UIと同じpush policy/approval |
| `git.merge.preview` | run ID、expected version | `POST /api/runs/:runId/git/merge/preview` | merge precondition、version CAS |
| `git.merge.defer` | run ID、expected version | `POST /api/runs/:runId/git/merge/defer` | merge precondition、version CAS |
| `git.merge.rework` | run ID、expected version | `POST /api/runs/:runId/git/merge/rework` | merge precondition、version CAS |
| `git.merge.target.update` | target branch、expected version | `PATCH /api/runs/:runId/git/merge/target` | branch schema、approval、version CAS |
| `git.merge.execute` | run ID、expected version | `POST /api/runs/:runId/git/merge` | preview/current HEAD/approval/version CAS |

`task.update`で公開するfieldはUI編集schemaから生成し、任意objectをDBへ渡さない。Task完了は現行UI契約に合わせ、`run.review.submit(action=complete)`またはUIが使用するTask status commandを使う。実装時にUI側に別commandが存在すると判明した場合はcatalogのseamをそのcommandへ合わせるが、Mission Pilot専用mutationは作らない。

`import_project`はcoding agentが使うworker toolであり、人間ユーザーがTask UIから直接実行するactionではないため、Mission PilotのTask Action Registryへ直接公開しない。Mission Pilotは`run.implementation.start`で同じcoding runを開始し、workerがimport後も同じ依頼を継続することを期待する。Mission Pilot側ではbootstrap専用session、bootstrap専用Todo、import完了を理由にした固定停止をすべて削除する。

ただし現行`api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`には、import後に通常実装へ進まずbootstrapだけで停止させる指示が存在する。これはMission Pilot外のworker runtime責務であり本計画では編集しない。Mission Pilot実装はport fakeでimport後継続scenarioを検証できるが、実runtimeを使うScenario Bの受入には、並列のworker runtimeリファクタリングで当該固定指示が撤去済みであることを外部契約として要求する。この依存をMission Pilot内の二度目のRunやTodoで補償してはならない。

Action Registryは`actionId`、日本語description、input schema、authorization、precondition、application command handlerを一箇所で定義する。`list_available_task_actions`と実action toolは同じregistry entryを参照し、説明と実装のdriftを防ぐ。

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

authoritative read seamを`api/services/agent-runtime/public-run-outcome.ts`へ新設し、Mission Pilotはこのserviceだけを`MissionPilotRunOutcomePort` adapterから呼ぶ。runtime内部型やturn一覧をMission Pilot moduleへimportしない。

source precedenceをtyped sourceで固定する。

1. Native API Runにterminal `native_api_turns.history_json`がある場合は、最後の非空assistant item本文を`finalReport`とする。
2. それ以外は`task_runs.final_report`の非空本文を使う。
3. `task_runs.final_judgment`等の構造化blocker/verification情報は別fieldへlossless projectionする。
4. runtime/systemが生成したdiagnosticは`diagnostic`へ分離し、非空のworker本文を上書きしない。

このprecedenceは`workerKind`、Run ID、terminal turnのtyped relationだけで選び、本文が特定文言に一致するかでは判断しない。現行Native API runnerのtext-only failureではprovider本文がturn historyに残り、`task_runs.final_report`が固定診断へ置換される場合があるため、このadapterでprovider本文を復元する。worker runtime側が将来public outcomeを直接保存するようになった後は、port contractを維持したままadapter内部だけを差し替える。

### 8.4 Event ordering and concurrent updates

event arrival orderとTask revisionを混同しない。処理順序を次で固定する。

1. application event adapterは`source_event_id`でdedupeし、session transaction内で`sequence`を採番してinboxへappendする。
2. idle/waiting sessionだけをlease claimしてturnを開始する。すでにrunningならeventはinboxへ蓄積し、実行中turnを中断しない。ただし`mission_pilot.stop_requested`とTask削除はcancellation signalを送る。
3. turn開始時点で存在する未消費eventをsequence順にsnapshotし、一つの`task_event` conversation itemへlossless projectionする。turn途中に到着したeventは次turnで読む。
4. action実行前にAction Registry handlerがcurrent Task revisionとpermissionを再取得する。古ければ`revision_conflict`を返し、LLMが再読込後の操作を決める。
5. tool result保存後に未消費eventがあってもhostは別actionを自動実行しない。同じwake budget内でLLMへeventを追加するか、次turnをscheduleする。
6. process restart時は`running` turnと`pending/running` tool callをreconcileする。idempotency resultがあれば再利用し、成立不明なmutationは`outcome_unknown`としてLLMへ返してblind retryしない。

この規則により、Task更新とworker terminal eventが並行しても、到着文字列やphase priorityで順序を作らない。

## 9. System Context Design

System ContextはMission Pilotの行動を説明する主要な制御面とする。ただし個別Taskの答えや固定workflowを書かない。

### 9.1 Required guidance

System Contextに次を明記する。

- Mission PilotはユーザーTaskを自動化するAIであり、人間ユーザー以上の権限を持たない。
- Task UIで利用可能な選択肢から、Goalと現在Factに最も合うものを選ぶ。
- 選択前に必要なSpecification、Artifact、Run outcomeをtoolで確認する。
- Plan、Implementation、Test、Reviewを固定順序で実行する必要はない。
- Plan Modeで生成されたArtifactは閲覧し、確定済みQuestionnaire Decisionsと明白に矛盾していないか、中核実装を妨げる事実誤認や欠落がないか確認する。
- Questionnaire Decisionsは確定済みユーザー判断として優先し、Mission Pilotの好みや設計都合で弱めたり別案へ置き換えたりしない。
- Plan Artifactは明白な欠陥がない限り採用し、文章表現、追加可能な詳細、別の妥当案があることだけを理由に再生成しない。
- 再生成が必要な場合は、確認した具体的な矛盾または欠落だけを示し、Questionnaire Decisionsと正しい既存部分の維持を求める。
- Test、Review、再実行、完了の必要性は現在のTaskと成果から判断する。
- workerの逐次チャットや内部tool履歴は利用できず、最終報告とblockerをFactとして扱う。
- tool error時は返されたpreconditionとcurrent stateを読み、別action、retry、wait、ユーザー確認を判断する。
- provider/APIの一時障害でTaskが停止した場合は、typed failureのretryable、attempt、retry-after、idempotencyを確認し、合理的な再試行を優先する。
- retryしても改善しないauthentication、permission、invalid request、domain preconditionを無条件に繰り返さない。
- 不可逆操作、権限外操作、ユーザーしか決められない欠落ではユーザー確認を求める。
- assistant本文だけでturnを終えてよい。Task完了はTask action toolで行う。

### 9.2 Forbidden guidance

- `implementationの次は必ずtest`のような固定順序。
- `この文言ならTest Mode`のようなkeyword rule。
- error codeまたはTodo名に対する固定next action。
- 特定Artifact名が存在したら自動採用する規則。
- Questionnaireの決定をscoreやreview都合で上書きする規則。
- Artifactのscore、文章品質、詳細量だけで再生成を強制する規則。
- 固定correction回数からsemantic verdictを決める規則。
- 任意のerror messageの文字列からretryableや次actionを決める規則。
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

既存`mission_pilot_events`は`phase`と`contextDigest`が必須のlegacy workflow tableなので、新runtimeのconversation/event inboxとして再利用しない。`api/db/mission-pilot-schema.ts`へ次を追加し、Drizzle生成migrationを`drizzle/migrations/0043_mission_pilot_agent_runtime.sql`として作成する。実際の連番が先行migrationにより変わった場合はDrizzleの生成番号を優先する。

#### `mission_pilot_sessions`追加column

| column | type/default | 用途 |
| --- | --- | --- |
| `runtime_kind` | text not null、既存rowは`legacy` | session作成時に`legacy`または`agent`へ固定 |
| `runtime_state` | text not null default `stopped` | Section 5.3のlifecycle state |
| `conversation_revision` | integer not null default 0 | conversation append transactionのCAS |
| `next_conversation_sequence` | integer not null default 1 | itemの単調増加sequence採番 |
| `next_event_sequence` | integer not null default 1 | event inboxの単調増加sequence採番 |
| `next_turn_index` | integer not null default 1 | agent turn採番 |
| `system_context_version` | integer not null default 1 | 使用した静的System Contextのversion |
| `compaction_revision` | integer not null default 0 | summary revision |
| `last_consumed_event_sequence` | integer not null default 0 | conversationへ投影済みevent checkpoint |
| `provider_conversation_ref` | text nullable | 任意のprovider resume最適化。正本にはしない |

既存の`phase`、`resumePhase`、cycle、active phase fieldsはlegacy sessionが存在する間だけ残す。agent runtimeはこれらをread/writeしてはならない。

#### `mission_pilot_conversation_items`

| column | contract |
| --- | --- |
| `id` | text PK |
| `session_id` | FK、cascade |
| `sequence` | integer not null、unique(`session_id`, `sequence`) |
| `kind` | `system_context`、`user`、`assistant`、`tool_call`、`tool_result`、`task_event`、`compaction_summary` |
| `turn_id` | nullable FK to agent turns |
| `tool_call_id` | nullable FK to tool calls |
| `body_json` | lossless typed payload。assistant本文を固定文へ置換しない |
| `source_kind`, `source_id` | nullable。Task event/Artifact/Run正本への参照 |
| `created_at` | timestamp |

#### `mission_pilot_agent_turns`

| column | contract |
| --- | --- |
| `id` | text PK |
| `session_id`, `turn_index` | unique pair |
| `trigger_event_from`, `trigger_event_to` | このturnへ投影したevent sequence範囲 |
| `status` | `running`、`waiting_tool`、`completed`、`failed`、`cancelled` |
| `provider`, `model`, `provider_conversation_ref` | 実際に使用したprovider情報 |
| `started_at`, `finished_at`, `error_json` | lifecycle/typed failure |

#### `mission_pilot_tool_calls`

| column | contract |
| --- | --- |
| `id` | text PK。NightWorkers側call ID |
| `session_id`, `turn_id` | FK |
| `provider_call_id` | providerが返したcall ID。unique(`session_id`, `provider_call_id`) |
| `action_id` | Action Registry ID |
| `arguments_json` | schema検証前のlossless arguments |
| `status` | `pending`、`running`、`succeeded`、`failed`、`cancelled` |
| `idempotency_key` | mutation retryで再利用。unique(`session_id`, `idempotency_key`) |
| `expected_task_revision` | call時点のrevision |
| `result_json`, `failure_json` | model-visibleなtyped結果。任意error本文を分類しない |
| `started_at`, `finished_at`, `created_at`, `updated_at` | lifecycle |

#### `mission_pilot_task_event_inbox`

| column | contract |
| --- | --- |
| `id` | text PK |
| `session_id`, `task_id` | FK |
| `sequence` | integer not null、unique(`session_id`, `sequence`) |
| `event_type` | Section 8.1のtyped event |
| `source_event_id` | application event ID、unique(`session_id`, `source_event_id`) |
| `task_revision` | event発生時revision |
| `payload_json` | transcriptを含まないtyped payload |
| `available_at`, `consumed_at`, `created_at` | wait/retry/checkpoint |

#### Transaction invariants

1. session rowをrevision CASでclaimし、counterをincrementしてからitem/event/turn sequenceを採番する。
2. provider responseのassistant item、tool calls、turn statusは同一transactionで保存する。
3. tool mutationの`running`化とidempotency claimを同一transactionで行う。duplicate callは保存済みresultを返す。
4. eventをconversationへ投影し、`last_consumed_event_sequence`を進める処理を同一transactionで行う。
5. 一つのsessionで同時に`running` turnを一件だけ許可するpartial相当のrepository invariantを、session leaseとtransaction testで保証する。
6. `task.delete`だけはtool callを`running`まで保存してから共通delete commandを呼び、成功後のresult保存を要求しない。Task/session不在を検知してterminal終了し、deleteを再試行しない。削除前の永続監査を別権限の保管先へ複製しない。

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

### 11.0 File-level implementation map

新設する主要file:

| path | 責務 |
| --- | --- |
| `shared/schemas/mission-pilot-agent.schema.ts` | runtime state、read model、action descriptor/result、typed failureの共有schema |
| `api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts` | lease claim、event snapshot、provider/tool loop、wait/attention lifecycle |
| `api/modules/missionPilot/agent/mission-pilot-provider.port.ts` | `callProviderToolTurn`への薄いprovider-independent adapter |
| `api/modules/missionPilot/agent/mission-pilot-conversation.repository.ts` | conversation/turn/tool callのtransactionとCAS |
| `api/modules/missionPilot/agent/mission-pilot-task-event.repository.ts` | inbox append、dedupe、checkpoint |
| `api/modules/missionPilot/agent/mission-pilot-task-read.adapter.ts` | Task/Specification/Questionnaire/Artifact/available actionsのread projection |
| `api/modules/missionPilot/agent/mission-pilot-task-action.registry.ts` | Section 7.3のaction定義正本 |
| `api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts` | 共通application commandの実行とtyped result変換 |
| `api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter.ts` | public run outcome portのMission Pilot projection |
| `api/services/structured-generation/prompts/mission-pilot-system-context.ts` | 既存draftを正本として、日本語の静的role/rule contextと再利用可能なtool guidanceを定義 |
| `api/services/agent-runtime/public-run-outcome.ts` | runtime内部からユーザー向けterminal outcomeだけを返す共有seam |

変更する主要file:

| path | 変更 |
| --- | --- |
| `api/db/mission-pilot-schema.ts` | Section 10.2のcolumn/table追加 |
| `api/modules/missionPilot/mission-pilot.repository.ts` | session作成時`runtimeKind`固定、legacy/agent repository分離 |
| `api/modules/missionPilot/mission-pilot.service.ts` | play/stopをruntime kindへdispatch。semantic phase分岐は持たない |
| `api/modules/missionPilot/mission-pilot.routes.ts` | conversation/audit read route追加。既存play/stop IDは維持 |
| `api/modules/missionPilot/mission-pilot-realtime.ts` | Mission Pilot自身のturn/tool resultだけ通知 |
| `api/modules/missionPilot/mission-pilot-execution-query.service.ts` | agent runtime projectionを追加し、legacy projectionはlegacy sessionだけに限定 |
| `api/services/settings/application-settings-store.ts` | `mission_pilot_runtime` scopeのdefault runtime kindをversion付きで保存 |
| `api/index.ts`およびworker startup wiring | typed event consumerとrestart recoveryを起動 |

Drizzle migrationとschema bootstrapの双方を更新する。このrepositoryはmigration以外に`api/db/base-schema-bootstrap.ts`と`api/db/bootstrap-runtime-tables.ts`でruntime tableを作る経路があるため、新tableの作成漏れをarchitecture testで防ぐ。

### Workstream A: Contract and Baseline

目的:

- 現行Mission Pilotの操作、UI選択肢、Run outcome、権限をinventory化する。
- 新旧比較用のcharacterization testとtrace fixtureを作る。
- Mission Pilotが使用してよいFactと禁止するworker transcriptを型で固定する。

成果物:

- `MissionPilotTaskReadModel`
- `MissionPilotRunOutcome`
- `MissionPilotActionFailure`
- `MissionPilotTaskActionDescriptor`
- `MissionPilotTaskReadPort`
- `MissionPilotTaskActionPort`
- no-transcript architecture test
- 現行代表scenario fixture

完了条件:

- UIで可能なTask操作がaction catalogに列挙されている。
- action catalogにMission Pilot専用の権限拡張がない。
- worker transcriptをMission Pilot inputへ入れる経路がtestで検出できる。
- Questionnaire Decisions、Plan Artifact、provider/API typed failureを文字列分類なしで読める。

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
- Plan Artifact確認と具体的な再生成依頼を行うaction adapter。
- Queue/Run/Test/Review action adapters。
- complete/archive/Git action adapters。
- typed precondition error contract。

完了条件:

- Mission Pilot toolとUIが同じapplication commandを呼ぶ。
- mode、phase、Todo名によるtool allowlistがない。
- action実行不能時に別actionをhostが自動選択しない。
- current userが実行できない操作をMission Pilotも実行できない。
- Artifact review scoreや固定thresholdが再生成actionを自動実行しない。
- 再生成actionはQuestionnaire Decisionsのrevisionと対象Artifact IDを明示的に受け取る。

### Workstream D: Event and Outcome Integration

目的:

- worker transcriptを追跡せず、Task eventとterminal outcomeだけでMission Pilotを再開する。

成果物:

- typed Task event consumer。
- event deduplication/checkpoint。
- Run outcome projector。
- provider/API typed failure projector。
- wait/wake runtime。
- worker transcript access禁止test。

完了条件:

- active Run中にMission Pilotがpollingを続けない。
- terminal Run後、final report/blockerが同じsessionへ一度だけ追加される。
- workerの途中message/tool/command outputがMission Pilot conversationに存在しない。
- provider/API failureのretryabilityを任意のerror messageから推定しない。

### Workstream E: Fixed Workflow Removal

目的:

- 新runtimeを進行の正本にし、固定phase machineを含むsemantic control codeを削除する。

実施順序:

1. 現行Mission Pilot production codeの分岐、gate、transition、classifier、recovery、Todo projectionをinventory化する。
2. 各項目へ`delete`または`retain`を付ける。`retain`にはSection 2.3.1の分類と具体的なfailure riskを必須とする。
3. 新runtime/tool portで置換済みのsemantic controlを先に削除する。
4. 削除後に参照されないschema、table projection、event、prompt、test fixtureを削除する。
5. 残したdeterministic boundaryをMission Pilot固有Coordinatorからapplication/domain boundaryへ寄せる。
6. architecture testでsemantic controlの再導入を禁止する。

原則として、旧Coordinatorを薄いwrapperとして温存しない。compatibility期間が必要なadapterはfeature flag期間だけ保持し、削除期限と参照元を明記する。

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
- semantic control inventoryの`retain`全項目がSection 2.3.1を満たしている。
- `delete`対象のproduction code、専用schema、専用testが削除されている。
- 新規runtime/adapterの追加行数を、削除した固定workflowの行数と別々に計測し、同等ロジックの横移動がないことをreviewできる。
- Mission Pilot領域全体で、固定workflow撤去後のproduction codeが純減している。

### Workstream F: UI, Migration, and Cutover

目的:

- 既存Task/sessionをlegacyのまま保持し、新規sessionだけを新runtimeで開始する。

成果物:

- runtime feature flag。
- 既存sessionの`runtime_kind=legacy` backfillと新規sessionの`agent`固定。
- conversation/audit UI projection。
- waiting/attention表示。
- rollback手順。
- obsolete table/code cleanup plan。

完了条件:

- 切替前後でTask IDとMission Pilot session IDが変わらない。
- 既存playing sessionは新runtimeへ移さず、同じlegacy sessionで完了または停止できる。
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
- FはB/C/Dのintegration検証後に行い、新規sessionのdefaultだけを切り替える。

### 12.3 Reviewable change slices

実装changeは次の大粒度に分ける。各sliceは単独でtypecheck/test可能にし、未完成のsemantic fallbackを挟まない。

1. **Contract + additive DB:** shared schema、session runtime columns、conversation/turn/tool/event tables、repository transaction test。defaultはlegacyのまま。
2. **Persistent runtime:** provider port、System Context、conversation resume、tool loop、wait/wake。side effectはfake Action Portで検証。
3. **UI-equivalent adapters:** Action Registry、Task read adapter、public Run outcome、typed event integration。全catalog handler identity testを含む。
4. **New-session enablement:** service/routes/realtime/UI projection、new session defaultをagentへ変更、legacy/agent coexistence test。
5. **Deletion-first cleanup:** legacy sessionが0件になったことを確認後、Section 16の`delete`対象とlegacy schema/testを削除。

Slice 2と3はSlice 1のport確定後に並列化できる。Slice 4は2/3のintegration完了後、Slice 5は既存legacy sessionの終了後でなければ開始しない。

## 13. Migration and Cutover

### 13.1 Runtime selection

runtime kindは二種類だけとする。

```text
legacy  現行phase workflow。migration前から存在するsession専用
agent   新しいpersistent Mission Pilot runtime。migration後の新規session専用
```

割合traffic split、`shadow` runtime kind、Task途中の自動切替は実装しない。application setting `missionPilotDefaultRuntimeKind`は**今後作成するsessionのdefault**だけを決める。session作成transactionで値をrowへcopyし、以後はrowの`runtime_kind`を正本にする。

### 13.2 Migration steps

1. Section 10.2のadditive migrationを適用する。
2. 既存`mission_pilot_sessions`全rowを`runtime_kind=legacy`へbackfillする。
3. default settingを初期状態では`legacy`にし、agent contract/integration test完了後に`agent`へ変更する。
4. default変更後の新規Task/sessionだけがagent runtimeを開始することをmigration testで確認する。
5. 既存legacy sessionにはconversation seedを作らず、旧phase/cycleをそのまま使用する。
6. legacy sessionが0件になるまで旧runtime code/tableを保持する。ただし新規session作成には使わない。
7. legacy sessionが0件であることをDB queryとbackupで確認した別changeで、Section 16のlegacy table/column/codeを削除する。

### 13.3 Pre-cutover verification

ここでいうcutoverはdeployment trafficの割合操作ではなく、新規sessionのdefaultを`legacy`から`agent`へ変更する一回のapplication設定変更だけを指す。変更前に次をすべて満たす。

- Section 14のunit/integration/architecture testsが通る。
- fake providerを使うScenario A〜Kがすべて通る。
- restart、duplicate event、duplicate tool call、revision conflictでmutation重複が0件。
- worker transcript fixtureを与えてもMission Pilot conversationへの混入が0件。
- UIとMission Pilotのaction handler identity testが全catalog entryで通る。
- 新規agent sessionと既存legacy sessionを同時に実行し、dispatchが交差しない。

live providerによる任意のmanual canaryは実施してよいが、件数や割合を実装開始条件・正しさの判定にしない。

### 13.4 Rollback

- default settingを`legacy`へ戻す操作は、その後に作成するsessionだけへ作用する。
- すでに作成済みのagent sessionをlegacyへ変換しない。問題があるagent sessionは同じIDのままstopし、conversation/tool resultを保持して診断する。
- agent runtimeが実行済みのTask/Artifact/Run/Git actionをrollback処理で巻き戻さない。
- in-flight tool callはidempotency recordからreconcileし、成立不明なら`outcome_unknown`で停止する。
- schema migrationはadditiveなので、legacy runtime継続中も新tableを残せる。

## 14. Verification Strategy

### 14.1 Architecture tests

- Mission Pilot production codeにTask内容を分類する正規表現・keyword mapが存在しない。
- fixed domain phase transition tableが存在しない。
- semantic control inventoryで残置理由のないgate、classifier、fallback、recovery、Todo projectionが存在しない。
- 削除したsemantic controlと同じ判断を行う新しいCoordinator/Policy/Decision Serviceが追加されていない。
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
2. Mission Pilotがcurrent Specificationを読み、`run.implementation.start`でcoding agentへimportと実装を一つの依頼として開始する。
3. coding agentは`import_project`後に同じRunで実装を継続し、terminal final reportを返す。
4. Mission Pilotがfinal report、current Specification、Task stateを同じsessionで読み直す。
5. Mission Pilot側にbootstrap専用session、bootstrap完了Todo、importだけを完了扱いにする固定workflowが存在しない。
6. worker runtimeがimport後停止を強制する旧contractのままなら、Mission Pilotが二度目のRunで補償せず、外部contract未達としてintegration testを失敗させる。

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

#### Scenario H: Plan Artifact acceptance

1. Mission Pilotが確定済みQuestionnaire Decisionsと生成済みPlan Artifactを読む。
2. Artifactに明白な矛盾、事実誤認、実装不能な欠落がないことを確認する。
3. 表現、詳細量、別設計案の好みだけでは再生成しない。
4. 現在Artifactを採用し、次のTask actionを判断する。

#### Scenario I: Questionnaire conflict

1. 生成Artifactが確定済みQuestionnaire Decisionの中核要件を弱めている。
2. Mission Pilotが具体的なdecision ID、Artifact ID、矛盾内容を示して再生成を依頼する。
3. 再生成指示はQuestionnaire Decisionsと正しい既存部分を維持する。
4. hostがkeyword、score、固定thresholdからrevision targetや修正文を生成しない。

#### Scenario J: Provider/API transient failure

1. Plan Artifact生成APIがtyped `provider_capacity`または`rate_limit` failureを返す。
2. Mission Pilotがretryable、attempt、retry-after、idempotencyを確認する。
3. 同じsessionで待機または再試行actionを選ぶ。
4. retry成功後、同じPlan判断へ復帰する。
5. error messageのkeywordからhostが固定phaseまたは別actionを開始しない。

#### Scenario K: Non-retryable failure

1. actionがtyped `authentication`、`permission`、`invalid_request`または`domain_precondition`を返す。
2. Mission Pilotは同じ入力の無条件retryを繰り返さない。
3. available action、入力修正、ユーザー確認のどれが適切かをLLMが判断する。
4. hostは次actionを固定しない。

### 14.3 Failure tests

- stale task revision。
- duplicate tool call。
- process crash between action claim and completion。
- permission revoked during session。
- provider transport failure。
- provider capacity/rate limitとretry-after。
- authentication/permission/invalid request。
- provider typed codeがないunknown failure。
- ArtifactとQuestionnaire Decisionsの矛盾。
- 明白な欠陥がないArtifactに対する不要な再生成提案。
- provider assistant text-only response。
- invalid tool arguments。
- unavailable UI action。
- worker final report欠落。
- terminal event重複delivery。
- active Run中のstop/resume。

すべてのfailureで、ホストはtyped resultを返し、次のsemantic actionを固定しない。

### 14.4 Test files and commands

新規または置換するtest fileを次で固定する。

| test file | 主な保証 |
| --- | --- |
| `tests/mission-pilot-agent-schema.test.ts` | table/schema enum、assistant本文保持、typed failure |
| `tests/mission-pilot-conversation-repository.test.ts` | sequence/CAS、turn/tool transaction、restart reconcile |
| `tests/mission-pilot-task-event-inbox.test.ts` | ordering、dedupe、checkpoint、concurrent append |
| `tests/mission-pilot-task-action-registry.test.ts` | Section 7.3全action、UI handler identity、権限同等性 |
| `tests/mission-pilot-agent-runtime.test.ts` | stable session、tool loop、text-only、wait/wake、resource limit |
| `tests/mission-pilot-run-outcome-adapter.test.ts` | terminal outcomeだけを返し、Native assistant本文を固定診断より優先 |
| `tests/mission-pilot-no-transcript-boundary.test.ts` | worker transcript import/query/prompt混入を禁止 |
| `tests/mission-pilot-legacy-agent-coexistence.test.ts` | 既存legacyと新規agentのdispatch分離 |
| `tests/mission-pilot-semantic-control-architecture.test.ts` | phase transition/gate/classifier/Todo projectionの再導入禁止 |
| `tests/e2e/mission-pilot-persistent-agent.spec.ts` | Scenario A〜KのUI/API integration |

実装着手前のbaseline:

```bash
bun run test -- run \
  tests/mission-pilot-service.test.ts \
  tests/mission-pilot-plan-pipeline.test.ts \
  tests/mission-pilot-pre-queue-handoff.test.ts \
  tests/mission-pilot-post-queue-state.test.ts \
  tests/mission-pilot-test-review-transition.test.ts
```

Workstream B/C/D integration時:

```bash
bun run test -- run \
  tests/mission-pilot-agent-schema.test.ts \
  tests/mission-pilot-conversation-repository.test.ts \
  tests/mission-pilot-task-event-inbox.test.ts \
  tests/mission-pilot-task-action-registry.test.ts \
  tests/mission-pilot-agent-runtime.test.ts \
  tests/mission-pilot-run-outcome-adapter.test.ts \
  tests/mission-pilot-no-transcript-boundary.test.ts \
  tests/mission-pilot-legacy-agent-coexistence.test.ts
```

fixed workflow削除後:

```bash
bun run test -- run tests/mission-pilot-semantic-control-architecture.test.ts
bun run typecheck
bun run lint
bun run check:architecture
bun run verify:base
bun run test:e2e -- tests/e2e/mission-pilot-persistent-agent.spec.ts
```

期待結果はすべてexit code 0、重複mutation 0、transcript混入0、Scenario A〜K成功である。失敗時は固定workflowをfallbackとして追加しない。失敗したcontract、Fact不足、tool description、application command seamを修正し、同じtestを再実行する。live provider依存testは`bun run test:live:llm`へ分離し、通常CIの正しさをlive availabilityへ依存させない。

## 15. Observability

計測する指標:

- Mission Pilot session継続時間とturn数。
- session ID再作成回数。目標はTaskあたり0回。
- Mission Pilot action成功/失敗/precondition rejection率。
- user intervention率。
- attention理由。
- terminal Run outcomeから次Mission Pilot turnまでの遅延。
- worker transcriptがMission Pilot contextへ混入した件数。目標は0件。
- fixed workflow fallback発生数。新規sessionのagent default切替後は0件。
- Mission Pilotが選択したmode/actionの分布。
- context compaction回数とresume成功率。
- Task完了率、平均Run数、不要なTest/Review起動率。
- Plan Artifact閲覧率と採用率。
- 再生成依頼率、再生成理由のDecision/Artifact参照率。
- Questionnaire Decisionsと再生成指示の矛盾検出数。目標は0件。
- provider/API typed failure別のretry選択率、retry成功率、retry exhausted率。
- non-retryable failureへの同一入力連続retry回数。目標は0件。
- semantic control production LOC、分岐数、固定transition数、Mission Pilot固有gate数。
- 削除LOCと新規runtime/adapter LOC。削除対象ロジックの横移動を区別して記録する。
- Section 2.3.1に基づく残置ロジック件数と残置理由。

観測値を使ってLLMの選択を実装側で矯正しない。System Context、tool description、Task read modelの改善材料として使用する。

## 16. Deletion and Simplification Targets

このinventoryを初版正本とする。`delete`はagent runtimeへ同等ロジックを移植しない。`retain/move`はSection 2.3.1のdeterministic boundaryだけを共通application/domain serviceへ移し、Mission Pilot固有wrapperは削除する。

### 16.1 Production code inventory

| file / symbol | 判定 | 処置 |
| --- | --- | --- |
| `mission-pilot-post-queue-state.ts` | delete | phase enum、transition表、cycle前提を全削除 |
| `mission-pilot-post-queue-coordinator.service.ts` | delete | `continueMissionPilotAfterRun`、parent status推定、固定event遷移を削除。Run terminal eventはagent event adapterへ |
| `mission-pilot-runtime-continuation.service.ts` | delete | `start_test`、`start_review`、`run_closeout`、rework dispatchを全削除 |
| `mission-pilot-post-queue-test.service.ts` | delete | structured Test decision、retry準備、Review継続判断を全削除。通常Test Run outcomeだけを読む |
| `mission-pilot-post-queue-review.service.ts` | delete | review score/findingからrework/closeoutを決める処理を全削除。通常Review Run outcomeとGit actionを使う |
| `mission-pilot-closeout.service.ts` / `mission-pilot-closeout-support.ts` | delete | Mission Pilot専用aggregate/automatic commit/push/archiveを削除。既存Run Git/UI commandをregistryから呼ぶ |
| `mission-pilot-repository-bootstrap.service.ts` | delete | bootstrap専用Run、claim、complete、branch alignment orchestrationを削除。importはcoding Run内で行う |
| `mission-pilot-implementation-todo-projection.service.ts` | delete | implementation開始Todo生成、import後Todo完遂、blocked Todo projectionを削除 |
| `mission-pilot-rework.ts` | delete | fixed rework Todo生成と文言を削除 |
| `mission-pilot-run-association.service.ts` | delete | child Runをphase/cycleへ関連付ける処理を削除。Run IDは通常Task event/source refで保持 |
| `mission-pilot-post-queue-resume.ts` | delete | phase別resume projectionを削除 |
| `mission-pilot-recovery.service.ts` | delete | phase/cycleから次処理を復元するrecoveryを削除。lease/tool-call reconcileはagent runtimeへ新規実装 |
| `mission-pilot-pre-queue-recovery.service.ts` | split then delete | phaseを復元する処理は削除。authorization/revision mutable checkだけを共通action preconditionへ移す |
| `mission-pilot-plan-coordinator.service.ts` | delete | fixed Plan pipeline、step sequencing、review/correction loop、Queue handoffを削除 |
| `mission-pilot-plan-review.service.ts` / selection / repository | delete | 別LLM reviewerとscore/verdictによる自動再生成を削除。persistent Mission Pilot自身がArtifactを読む |
| `mission-pilot-artifact-correction.service.ts` / repository | delete | fixed correction cycle/limitを削除。明示的`plan.artifact.regenerate` actionへ置換 |
| `mission-pilot-plan-tool.service.ts` | delete | Plan phase専用tool dispatcherを削除。共通Action Registryへ統合 |
| `mission-pilot-plan-intake.service.ts` / `.port.ts` | delete | fixed intake stepを削除。read/action toolでQuestionnaireとArtifactを扱う |
| `mission-pilot-plan.repository.ts` | split then delete | Artifact/Questionnaire正本参照は通常domain repositoryへ寄せ、phase step/review/correction persistenceを削除 |
| `mission-pilot-questionnaire.service.ts` | split then delete | answer schema/version/submit transactionは共通Questionnaire commandへ移す。deadline auto-submit、autonomy timer、phase resumeを削除 |
| `mission-pilot-queue-handoff.service.ts` | retain/move | queue admission key、transaction、idempotencyは通常Queue application commandへ移す。Mission Pilot専用handoff/next phaseは削除 |
| `mission-pilot-queue-resume.repository.ts` / intake recovery repository | delete | phase pipeline resume用repositoryを削除 |
| `mission-pilot-event.repository.ts` | legacy only then delete | legacy session処理中だけ維持。agent eventは新inbox repositoryを使用 |
| `mission-pilot-plan-artifact-source-resolver.ts` | retain/move | explicit Artifact/source IDの一対一解決だけを共通read adapterで再利用。本文意味分類は追加しない |
| `mission-pilot-test-evidence.ts` | retain/move | typed verification evidenceのlossless projectionだけをpublic Run outcomeへ移す |
| `mission-pilot.repository.ts` | retain/refactor | stable session identity、authorization、lease、version CASを残し、phase/cycle APIをlegacy側へ隔離 |
| `mission-pilot.service.ts` | retain/refactor | play/stopとruntime kind dispatchだけを残す。next phase判断は持たない |
| `mission-pilot.routes.ts` | retain/refactor | user-facing play/stop/read APIを維持し、agent conversation projectionを追加 |
| `mission-pilot-realtime.ts` | retain/refactor | Pilot自身のturn/action lifecycle通知だけを残し、worker transcriptを流さない |
| `mission-pilot-execution-query.service.ts` | retain/refactor | runtime kind別のread projection。legacy sessionが0になったらlegacy branchを削除 |

`retain/move`対象にTask意味判断が見つかった場合、その部分はretainせずdeleteへ変更する。逆に実装中にretainを追加する場合は、Section 2.3.1の分類、削除時の具体的failure、対応testをこの表へ追記してからcode reviewを通す。

### 16.2 Schema and test inventory

legacy sessionが0件になった後の別migrationで削除するtable/field:

- `mission_pilot_steps`
- `mission_pilot_plan_reviews`
- `mission_pilot_artifact_correction_runs`
- `mission_pilot_phase_runs`
- `mission_pilot_test_snapshots`
- `mission_pilot_review_decisions`
- `mission_pilot_closeouts`
- legacy `mission_pilot_events`
- sessionの`phase`、`resume_phase`、active phase/test/review/closeout IDs、implementation/test/review/correction cycle、queue handoff/pre-queue diagnostic fields

`mission_pilot_plan_routing_revisions`、Questionnaire正本、Task/Run/Artifact正本は、通常UI/domainが使用する限り削除しない。Mission Pilot専用利用しか残っていないことを参照検索で確認できた場合だけ別changeで削除する。

production codeと同時に削除または置換するlegacy test:

- `tests/mission-pilot-post-queue-state.test.ts`
- `tests/mission-pilot-post-queue-recovery.test.ts`
- `tests/mission-pilot-test-review-transition.test.ts`
- `tests/mission-pilot-review-gate.test.ts`
- `tests/mission-pilot-rework.test.ts`
- `tests/mission-pilot-implementation-todo-projection.test.ts`
- `tests/mission-pilot-todo-resume.test.ts`
- `tests/mission-pilot-closeout.test.ts`
- `tests/mission-pilot-artifact-correction.test.ts`のfixed cycle/limit cases
- `tests/mission-pilot-plan-coordinator.test.ts`と`mission-pilot-plan-pipeline.test.ts`のfixed step sequencing cases

legacyを削除しただけでcoverageを落とさず、Section 14.4のagent contract testへ置換する。旧挙動そのものを新testへコピーしない。

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
6. repository importをcoding Run内で継続し、Mission Pilot側に別bootstrap workflow、専用Todo、import単体完了処理がない。
7. coding/Test/Review agentの逐次チャット、tool log、command outputをMission Pilotが追跡しない。
8. workerの仕様、最終報告、blockerを改変せずMission Pilotが読める。
9. Task/LLM本文の正規表現・keyword分類でnext actionを決めるコードがない。
10. tool availabilityをphase、Todo名、job typeで制限しない。
11. assistant text-only responseをfailureにしない。
12. hostはschema、権限、安全、revision、lease、idempotencyに責務を限定している。
13. 代表integration scenarioとfailure testが通る。
14. architecture/integration testでworker transcript混入が0件である。
15. 既存sessionはlegacyで完了し、新規sessionだけagent runtimeへ固定され、legacy sessionが0件になった後に不要コード/tableを削除できている。
16. Mission PilotがPlan Artifactを確認しているが、Questionnaire Decisionsを変更・縮小・別案へ置換していない。
17. 明白な矛盾、事実誤認、実装不能な欠落、安全上の重大問題がないArtifactを再生成していない。
18. 再生成時は具体的なDecision/Artifact参照と欠陥だけを示し、正しい既存部分を維持している。
19. provider/APIの一時障害はtyped failureとしてMission Pilotへ渡され、合理的なretryを同じsessionで選べる。
20. retryable判断または次action判断に任意のerror messageのregex/keyword分類を使っていない。
21. 既存semantic control inventoryの各項目が削除済みか、Section 2.3.1を満たす残置理由付きである。
22. 固定workflow、gate、classifier、recovery、Todo projectionを別名のserviceへ移植していない。
23. Mission Pilot production codeが固定workflow撤去前より純減し、新規コードは永続conversation、tool adapter、typed event、安全境界に限定されている。

## 19. Implementation Start Gate

実装開始条件はすべて確定済みであり、ユーザー判断待ちのblockerはない。

| 項目 | 決定 | 正本section |
| --- | --- | --- |
| Task UI相当action catalog | delete/archive/Gitを含むUI完全同等。Mission Pilot専用確認なし | 2.1、7.3 |
| provider / resume | `callProviderToolTurn`を使用し、DB conversationから再構築 | 6.4 |
| conversation persistence | phase前提event tableを拡張せず専用4 tableを新設 | 10.2 |
| runtime選択単位 | session作成時に`legacy`または`agent`へ固定 | Status、13.1 |
| existing session | 全既存sessionをlegacyで完了/停止。mid-flight移行なし | Status、13.2 |
| rollback | defaultをlegacyへ戻すのは新規sessionだけ。実行済みactionは巻き戻さない | 13.4 |
| semantic control | Section 16のfile/symbol inventoryに従いdeletion-first | 16 |
| validation | fake providerのScenario A〜K、architecture test、既存legacyとのcoexistence | 14 |

実装順序は次で固定する。

1. Workstream Aでschema/port/action catalogとbaselineをcommitする。
2. Workstream B、C、Dを同じcontractに対して並列実装する。
3. integration test成立後に新規session defaultをagentへ変更する。
4. 既存legacy sessionが0件になった後、Workstream Eのdelete inventoryを別changeで完遂する。
5. 最後にWorkstream FのUI projectionとobsolete schema cleanupを確認する。

実装中に未決定事項が発生しても、schema、transaction、file分割等の技術選択は実装者が本計画の原則に従って決める。Mission Pilotの権限拡張、ユーザー決定の変更、外部副作用の追加、既存sessionのmid-flight移行が必要になった場合だけ、実装を止めてユーザー判断を求める。
