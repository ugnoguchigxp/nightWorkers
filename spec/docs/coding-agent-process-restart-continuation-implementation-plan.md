# Coding Agent Process Restart Continuation Implementation Plan

## Status

- Plan status: `implemented`
- Implementation verified: 2026-08-03
- Release canary status: deterministic 3-run canary completed; live Codex process-restart canary is reserved for a credentialed release-candidate environment
- Document created: 2026-08-03
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Primary scope: Coding Agent process ownership、startup reconciliation、同一Run resume、Workbench intake routing、in-flight tool recovery、Queue整合性
- Related plans:
  - `spec/docs/coding-agent-llm-owned-todo-refactor-plan.md`
  - `spec/docs/coding-agent-runtime-reliability-recovery-plan.md`
- Trigger incident:
  - Task: `6d37323c-e169-4c7f-8331-cb5ce998f65a`
  - Run: `9db202ee-4e6f-47e6-b11a-81dce341925d`
  - Codex thread: `019fc5e7-9ea3-7a70-b241-87c33743744b`
  - 2026-08-03 13:45 JSTの開発サーバー停止・再起動後、ユーザーの「再開してください。」がfresh Run開始へ誤routingされ、`RUN_ALREADY_ACTIVE`で停止した。

## 1. 目的

Coding Agent実行中にAPI processまたはworker processが停止しても、保存済みの正本を失わず、ユーザーの次の依頼から安全に同じ実装作業を継続できるようにする。

実現する状態は次のとおり。

1. process停止を、ユーザーcancelやTask失敗と混同せず、構造的な`process_interrupted` pauseとして保存する。
2. Run、Agent Mode Session、Todo、workspaceのidentityを維持し、provider threadはproviderが再開を許可する限り同じidentityを再利用する。
3. 通常chatの意味解釈はLLMへ委ね、hostはLLMの構造化された`start` / `resume`判断と保存状態の整合性だけを検証する。
4. resume時にfresh Runを作成せず、同じRunへ新しいruntime execution ownerをCASで割り当てる。
5. crash時に結果未保存だったtool callは成功・失敗を推定せず、`unknown_outcome`としてLLMへ返す。
6. provider threadのresumeが失敗しても、同じRun、Todo、workspaceを維持したままlossless State Card付きfresh provider threadへfallbackする。
7. Task、Run、Queue、runtime ownershipの各projectionが常に同じ状態を示す。

本計画はCoding Agentへ意味別mode、固定workflow、tool allowlistを追加しない。Taskの意味、次action、Todo、再検証、完了判断はLLMが所有し、hostはidentity、authority、revision、lease、idempotency、workspace attestationだけを強制する。

## 2. インシデントで確認した事実

### 2.1 停止直前

- Runは`running`だった。
- Todo `step-1`から`step-4`は`passed`、`step-5`は`running`だった。
- 最終Run eventは`bun run test:coverage`の`tool.call_started`で、対応する`tool.call_finished`は存在しなかった。
- Codex rollout JSONLも同じtool callで終了していた。
- workspaceの未commit差分は残っていた。

### 2.2 再起動直後

- Queue entryは`processing`のまま、ownerは終了済みの`api-process:3991`だった。
- Runは`running`、runtime session stateは`active`、provider thread IDも保存済みだった。
- 新しいAPI processは別PIDで起動したが、旧ownerを即時に失効させなかった。
- startup Queue reconciliationは30分のstale threshold内としてentryを`normal`扱いした。

### 2.3 ユーザー依頼後

- Composerはメッセージ内容に関係なく`intent=intake`を送った。
- Plan Mode gateのLLMは、既存Feature Planを再利用して実装を継続できると判断した。
- hostは`action=coding_agent`をfresh Run開始として扱った。
- fresh Run preconditionが既存`running` Runを検出し、`RUN_ALREADY_ACTIVE`を返した。
- fresh start前にTask statusを`ready`へ更新したため、Task=`ready`、Run=`running`、Queue=`processing`という不整合が残った。

### 2.4 既存recoveryの不足

- `resumeTaskRunTodo`は、Todoが`needs_human`、またはRunに明示的な`runtimePause`がある場合だけ利用できる。
- abrupt process lossは`runtimePause`を作成しない。
- Queue stale recoveryはQueue entryだけを`needs_human`へ移し得るが、Run、Task、runtime ownerを同じtransactionで遷移させない。
- graceful shutdownはin-process Coding Agent runtimeをcancelと区別したpauseへ移さない。
- provider thread resumeのunit testはあるが、process restartをまたぐ同一Run end-to-end testがない。

## 3. Root Cause

```text
API process停止
    |
    v
in-memory runtime executionだけが消失
    |
    v
Run=running / Queue=processing / provider session=active が永続化されたまま残る
    |
    v
startup recoveryは旧process ownershipを即時判定できない
    |
    v
通常chatは intake -> coding_agent -> fresh start と解釈される
    |
    v
active Run guardがfresh startを拒否
    |
    v
同一Run resume commandへ到達しない
```

根本原因はprovider threadの欠落ではない。process-bound runtime ownershipが正本化されていないことと、LLMの`coding_agent`判断をhostが`start new Run`へ一意に写像していることの組み合わせである。

## 4. Scope

### 4.1 In scope

- Coding Agent runtime execution ownershipの永続化
- graceful shutdownとabrupt restartのinterruption reconciliation
- 同一Run / Todo / Agent Mode Session / workspace / provider sessionのresume
- Workbench intake decisionの`start` / `resume`構造化
- in-flight tool callの`unknown_outcome` recovery evidence
- Queue lease、Task status、Run statusの原子的projection
- direct user RunとMission Pilot handoff Runのprovenance維持
- deterministic restart integration testとCodex canary

### 4.2 Out of scope

- Mission Pilot runtimeのrestart設計変更
- Coding Agentの新しい意味別mode
- user messageのregex / keyword分類
- crashしたtool callのhostによる意味的な成功・失敗判定
- workspace差分の自動rollback
- 別Taskとしての自動再作成
- providerの内部rollout formatの独自解析・改変

## 5. Target Invariants

### 5.1 Identity

- resume前後で`task_run.id`は変わらない。
- resume前後で`agent_mode_session_id`は変わらない。
- current Todoのcanonical ID、`todoKey`、revision、statusは、人間またはLLMの明示commandなしに変更しない。
- `workspace_id`、allocation version、repository identity revision、attestation digestが一致しない場合はresumeをfail-closeする。
- provider threadが利用可能なら同じ`provider_session_id`を使用する。
- provider resume失敗時だけ、同じRunとAgent Mode Sessionの下に新しいprovider session stateを作る。

### 5.2 Ownership

- `task_runs.status=running`だけをruntime生存の証拠にしない。
- 各実行中Runは、durableなexecution owner、owner instance、lease version、heartbeatを一つだけ持つ。
- 同じRunを二つのprocessが同時にresumeできない。
- `api_process` ownerは単一API boot identityに結び付け、別bootによるstartup時に旧ownerを即時reconcileできる。
- isolated worker ownerはworker managerの構造的なprocess/IPC stateを確認し、確認不能な場合だけlease expiryを使用する。

### 5.3 Interruption

- process interruptionは`cancelled`、`failed`、`timed_out`へ自動変換しない。
- canonicalなinterruptible Run statusを`running`、`context_compiling`、`finalizing`に固定し、各statusから`needs_human`への遷移を共通status contractで明示する。
- interruption後はRun=`needs_human`、Task=`needs_human`、Queue=`needs_human`、execution owner=`interrupted`を同じtransactionで確定する。
- running Todoはrunningのまま保持し、hostが暗黙に`needs_human`や`failed`へ変えない。
- `contextSnapshot.runtimePause`にはinterruption revision、reason、owner、workspace binding、current Todo ref、unresolved tool call refsを保存する。

### 5.4 Resume

- resumeはexpected interruption revision、Run status、Todo revision、workspace attestation、execution owner lease versionをCASで検証する。
- CAS成功後だけRunとTaskを`running`、Queueを`processing`へ戻す。
- 二重resumeの二つ目はtyped conflictを返し、新しいruntimeを起動しない。
- launch前失敗はRunを再び`needs_human`へ戻し、ユーザー文と失敗本文を保持する。
- provider本文を固定host messageへ差し替えない。

### 5.5 Chat routing

- user textをkeywordで分類しない。
- LLM decisionは`plan_mode` / `coding_agent`に加え、Coding Agent command dispositionとして`start_new_run` / `resume_existing_run`を返す。
- LLMへ渡すresume candidateはhostが構造的に検証した一件だけとし、LLMにrunIdを生成させない。
- hostはdecisionとcandidate snapshot digestの一致を検証する。
- active resumable Runがある状態で`start_new_run`が選ばれても、既存Runを暗黙cancelしない。typed conflictまたは明示的なRun解決操作へ進む。

### 5.6 In-flight tool call

- `started`があり`finished`がないtool callをhostが成功または失敗へ分類しない。
- tool call ID、tool名、normalized arguments digest、event sequence、workspace/source digestを`unknown_outcome` evidenceとして保持する。
- idempotencyを持つserver-side toolは既存journalとserver-side preconditionで再試行可否を検証する。
- native command / Codex execは自動再実行せず、LLMがworkspace Factとevidenceを読み、再検証または別actionを選ぶ。

### 5.7 Provenance and role boundary

- user-direct RunとMission Pilot handoff Runは、保存済み`requestProvenance`で区別する。
- process interruptionとresumeは元provenanceを変更しない。
- resume request自体のprovenanceは追加監査eventとして保存する。
- Coding Agent固有application、repository、runtime、schemaは`api/modules/codingAgent`が所有する。
- Queue、server、Workbenchは公開application commandまたはAgent非依存portだけを利用し、Coding Agent内部repository/runtimeをimportしない。
- Mission Pilot package/moduleからCoding Agent内部実装をimportしない。

## 6. 採用設計

### 6.1 Durable execution ownership

Coding Agent moduleに`coding_agent_run_executions`を追加する。Queue leaseはscheduling ownership、当該tableはruntime execution ownershipとして責務を分ける。

```ts
type CodingAgentRunExecution = {
  runId: string;
  agentModeSessionId: string;
  status: "active" | "interrupted" | "released";
  ownerKind: "api_process" | "worker_process";
  ownerInstanceId: string;
  ownerPid: number | null; // diagnostics only
  leaseVersion: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
  interruptionRevision: number;
  interruptionReason: "graceful_shutdown" | "process_restarted" | "worker_lost" | null;
  interruptionSnapshot: CodingAgentProcessInterruptionSnapshot | null;
};
```

- `ownerInstanceId`はAPI/worker bootごとのUUIDとし、PIDをauthorityにしない。
- unique keyは`run_id`とし、claim / heartbeat / interrupt / releaseをCAS updateで行う。
- schema、bootstrap、repositoryは`api/modules/codingAgent/persistence`へ置く。
- Drizzle clientがschemaを束ねるためのimportだけを`api/db/client.ts`へ追加する。
- migrationはadditiveとし、既存active Runをstartup reconciliationで安全にbackfillする。

### 6.2 Process interruption snapshot

```ts
type CodingAgentProcessInterruptionSnapshot = {
  version: 1;
  kind: "process_interrupted";
  revision: number;
  interruptedAt: string;
  reason: "graceful_shutdown" | "process_restarted" | "worker_lost";
  previousOwner: {
    kind: "api_process" | "worker_process";
    instanceId: string;
    leaseVersion: number;
  };
  run: {
    id: string;
    agentModeSessionId: string;
    status: "running" | "context_compiling" | "finalizing";
  };
  currentTodo: {
    id: string;
    todoKey: string;
    revision: number;
    status: "running";
  } | null;
  workspace: {
    id: string;
    allocationVersion: number;
    repositoryIdentityRevision: number;
    attestationId: string;
    attestationDigest: string;
  };
  providerSession: {
    stateId: string;
    providerThreadId: string;
    model: string | null;
  } | null;
  unresolvedToolCalls: Array<{
    callId: string;
    toolName: string;
    argumentsDigest: string;
    startedEventSeq: number;
    evidenceRef: string;
    outcome: "unknown";
  }>;
};
```

snapshotは正本rowへの参照とdigestを保持し、大きいraw payloadはevent pagingで再取得できるようにする。

### 6.3 Startup reconciliation

startup順序を次に固定する。

1. DB bootstrap / migrationを完了する。
2. current API boot identityを生成する。
3. Coding Agent execution ownershipをreadする。
4. 旧`api_process` boot ownerのactive executionをCASで`interrupted`へ移す。
5. Run、Task、Queue、runtimePauseを同じDB transactionで`needs_human`へprojectする。
6. `run.process_interrupted` eventとsystem messageを一度だけ保存する。
7. generic Queue reconciliationを実行する。
8. HTTP / WebSocketで新規requestを受け付ける。

`api_process`は同一NightWorkers server boot内だけ有効というhost invariantを採用する。isolated workerはworker managerがlive ownershipを返す場合はinterruptせず、owner不在またはIPC切断を確認した場合だけ`worker_lost`へ移す。

startup reconciliationは同じinterruption revisionに対してidempotentでなければならない。

### 6.4 Graceful shutdown

- userのStopは従来どおり`cancelled`であり、process shutdownと分離する。
- Agent runtimeへ`stop`とは別の`suspendForHostShutdown` signalを追加する。
- shutdown signalでは、current ownerのRunだけをinterruptedへCASし、provider streamをabortする。
- interruption確定後にWebSocket、MCP、DBをcloseする。
- runtime closeoutはhost interruptionをterminal outcomeとして処理せず、final reportやTodo statusを上書きしない。
- shutdown timeoutで完全pauseできなかったRunは、次startupのabrupt reconciliationが回収する。

### 6.5 Same-Run resume application command

`agentsShare`にはrole横断で同じ意味を持つcommand contract / portだけを置き、実装はCoding Agent moduleが所有する。

```ts
type ResumeInterruptedCodingAgentRunCommand = {
  runId: string;
  expectedInterruptionRevision: number;
  todoId: string | null;
  expectedTodoRevision: number | null;
  userContext: string;
  requestProvenance: CodingAgentRequestProvenance;
};
```

Coding Agent application serviceは次をtransaction/CASで検証する。

- Runが`needs_human`
- runtimePause.kindが`process_interrupted`
- expected interruption revision一致
- execution ownershipが`interrupted`
- Agent Mode SessionがactiveでRunと一致
- current Todo ID / revision / running status一致
- workspace bindingと最新attestation一致
- Queue entryのactiveRunId一致
- 同じTaskに別active Runがない

成功時はnew execution ownerをclaimし、Run / Task / Queueをrunning projectionへ戻す。同じRunの`startTaskRun` preparationを再利用するが、fresh Run作成とAgent Mode Session作成は実行しない。

### 6.6 Workbench intake decision

既存Plan Mode gateの日本語System ContextとJSON contractを拡張する。

```ts
type CodingAgentIntakeDecision = {
  shouldStartPlanMode: boolean;
  action: "plan_mode" | "coding_agent";
  runDisposition: "start_new_run" | "resume_existing_run" | null;
  reason: string;
};
```

- `action=plan_mode`では`runDisposition=null`。
- `action=coding_agent`ではrun dispositionを必須とする。
- hostはresumable candidateのRun IDをpromptへauthority付きFactとして渡すが、outputにIDを生成させない。
- persisted gate resultにはprompt digestだけでなく、Task revision、candidate Run ID、interruption revision、Todo revision、workspace attestation digestから作る`routingSnapshotDigest`を保存する。
- snapshotが変わったdecisionは再利用しない。
- `resume_existing_run`ではsame-Run resume commandを呼ぶ。
- `start_new_run`ではfresh start preconditionを先に検証し、成功するtransaction内でだけTask projectionを変更する。
- catch pathはTask statusを変更しない。
- `adjust_running`の文字列intentは意味判断の正本にせず、互換surfaceとして残す場合も同じLLM decisionへ正規化する。

System Context source、生成catalog JSON、generated TypeScriptを同じ変更単位で更新し、S11t runtime/CLI境界を維持する。

### 6.7 Provider thread continuation

- same-Run resume preparationは`agent_mode_session_id`で`runtime_session_states`をlookupする。
- provider sessionがactiveなら`resumeThread(providerThreadId)`を使用する。
- 最新user contextとprocess interruption State Cardを新しいturnへ渡す。
- unresolved tool callは`unknown_outcome` evidenceとして渡し、自動再実行しない。
- resume成功時は同じprovider session stateの`lastSeenAt`を更新する。
- resume失敗時はraw errorをeventへ保存し、旧stateを`resume_failed`へ変更する。
- fallbackは同じRun、Todo、workspace、Agent Mode Sessionを維持し、新しいprovider session stateだけを作る。
- provider response本文とfallback後の本文を固定文へ差し替えない。

### 6.8 Queue integration

- Queueはruntime生存判定をRun statusだけで行わず、Coding Agentの公開recovery portを呼ぶ。
- Queue-only `needs_human` mutationを廃止し、Run / Task / execution ownerを含むatomic interruption transitionへ委譲する。
- 30分stale thresholdは未知ownerや外部workerのfallback watchdogとして残す。
- process boot交代が確認できる`api_process` ownerはstale thresholdを待たない。
- resume claim成功時にQueue lease owner、version、heartbeatをnew execution ownerへ同期する。
- terminal closeoutは既存Queue completionを使用する。

## 7. 実装フェーズ

### Phase 0: Incident fixtureとbaseline固定

#### 実装

1. Run / Todo / Queue / runtime session / workspaceをincidentと同じ状態へ作るfixtureを追加する。
2. `tool.call_started`だけを保存し、result未保存でprocess消失した状態を作る。
3. Workbenchへ任意のresume意味を持つmessageを送り、現状でfresh startと`RUN_ALREADY_ACTIVE`になるtestを追加する。
4. Task statusが`ready`へ壊れる現状もfailure evidenceとして固定する。
5. baseline schema、Run event sequence、System Context digestを記録する。

#### 主な対象

- `tests/services.coding-agent-process-restart.test.ts`
- `tests/nightworkers-workbench-routes/*`
- `tests/implementation-queue-resilience.test.ts`
- `tests/codex-agent-runtime/llm-owned-contract.cases.ts`

#### 完了条件

- production変更前に、restart後のfresh start衝突を一つのdeterministic scenarioとして再現できる。
- failureがprovider thread欠落ではなくrouting / ownership不整合であることをassertできる。

### Phase 1: Runtime execution ownership persistence

#### 実装

1. Coding Agent-owned schema、bootstrap、migrationを追加する。
2. claim、heartbeat、interrupt、resume claim、releaseのrepository methodをCASで実装する。
3. runtime launch時にowner rowを作成し、heartbeatをRun / Queueと同時更新する。
4. terminal closeout時にownerをreleasedへ移す。
5. migration前active Runはowner unknownとしてbackfillし、startupで安全にinterruptedへ移す。

#### 主な対象

- `api/modules/codingAgent/persistence/runtime-execution-schema.ts`
- `api/modules/codingAgent/persistence/runtime-execution.repository.ts`
- `api/modules/codingAgent/application/runtime-execution-ownership.service.ts`
- `api/db/client.ts`
- `drizzle/migrations/<next>_coding_agent_run_executions.sql`

#### 完了条件

- 同じRunへの二重claimは一件だけ成功する。
- stale revision、別owner、terminal Runはmutationされない。
- existing Run / runtime sessionをreadできる。

### Phase 2: Process interruptionとstartup/shutdown reconciliation

#### 実装

1. interruption snapshot builderとunresolved tool call projectorを追加する。
2. startupで旧API boot ownerをreconcileするapplication serviceを追加する。
3. interruptible statusの共通定義を追加し、Run status transition tableとactive Run queryを同じ定義へ揃える。
4. Run / Task / Queue / execution owner / runtimePauseをatomicに更新する。
5. graceful shutdown用suspend signalをAgent runtimeへ追加する。
6. `server.ts`はCoding Agent公開lifecycle commandをstartup / shutdown順序へ接続する。
7. generic Queue reconcileがQueueだけを変更しないようrecovery portへ委譲する。

#### 主な対象

- `api/modules/codingAgent/application/process-interruption.service.ts`
- `api/modules/codingAgent/context/process-interruption-snapshot.ts`
- `api/modules/codingAgent/runtime/CodexAgentRuntime.ts`
- `api/modules/codingAgent/runtime/NativeAgentRuntime.ts`
- `api/modules/codingAgent/index.ts`
- `api/server.ts`
- `api/modules/queue/queue-health.service.ts`
- `api/modules/nightworkers/run-orchestration/status.ts`
- `shared/schemas/nightworkers/run.schema.ts`
- Agent非依存のlifecycle contract / portだけを置く`api/modules/agentsShare`

#### 完了条件

- abrupt restart直後、30分待たずにRunがresumable pauseへ移る。
- graceful shutdownとabrupt restartが同じcanonical snapshotを作る。
- running Todo、provider session、workspace bindingが変化しない。
- reconciliationを複数回実行してもeventとrevisionが重複しない。

### Phase 3: Same-Run resume command

#### 実装

1. shared command contract / portへinterrupted Run resumeを追加する。
2. Coding Agent handlerからNightWorkers internal resume importを除去し、Coding Agent application serviceがresume ownershipを持つ。
3. resume preconditionとworkspace attestationをtransactionで検証する。
4. new execution owner claimとRun / Task / Queue projectionを一つのtransactionで更新する。
5. same Run preparation / launchを呼び、新しいTaskRunやAgent Mode Sessionを作成しない。
6. launch失敗時はsame Runを再びresumable pauseへ戻す。

#### 主な対象

- `api/modules/agentsShare/contracts/coding-agent-run.ts`
- `api/modules/agentsShare/ports/coding-agent-run.ts`
- `api/modules/codingAgent/application/coding-agent-run.handler.ts`
- `api/modules/codingAgent/application/resume-interrupted-run.service.ts`
- `api/modules/codingAgent/application/start-coding-agent-run.service.ts`
- 既存`api/modules/nightworkers/run-orchestration/resume-task-run*.ts`のCoding Agent固有責務を移動または薄いhost adapter化

#### 完了条件

- resume結果のRun ID、Agent Mode Session ID、Todo ID、workspace IDが停止前と一致する。
- concurrent resumeでruntimeが二重起動しない。
- direct / Mission Pilot provenanceが保持される。

### Phase 4: Workbench semantic routingとmutation atomicity

#### 実装

1. intake gate JSON schemaへ`runDisposition`を追加する。
2. structurally resumableなcandidate snapshotをpromptへ追加する。
3. `routingSnapshotDigest`をpersist / reload contractへ追加する。
4. `resume_existing_run`をsame-Run resume commandへdispatchする。
5. fresh start前のTask=`ready` mutationを削除し、成功後projectionへ移す。
6. failure catchでTask / Run / Queue stateを変更しない。
7. prompt文言は日本語を維持し、regex / keyword branchを追加しない。
8. TOML、catalog JSON、generated TypeScriptを同時更新する。

#### 主な対象

- `api/modules/codingAgent/intake/plan-mode-gate.ts`
- `api/systemContexts/contexts/codingAgent/plan-mode-gate.context.toml`
- `api/systemContexts/generated/catalog.json`
- `api/systemContexts/generated/catalog.generated.ts`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- Workbench route / gate tests

#### 完了条件

- LLM fixtureがresumeを選ぶとfresh Runが作られない。
- textのkeywordを変更してもfixtureの構造化decisionどおりにrouteされる。
- stale routing snapshotは拒否され、最新stateの再取得へ進む。
- start失敗後もTask statusが元のprojectionから変わらない。

### Phase 5: Provider continuationとunknown-outcome recovery

#### 実装

1. process interruption State CardをCodex runtime promptへ追加する。
2. same provider thread resume成功caseを実装・検証する。
3. incomplete provider turnのresume挙動をfixture化する。
4. resume不可の場合はsame Run内fresh provider thread fallbackを使用する。
5. unresolved tool call evidenceをLLMへ渡し、host自動再実行を禁止する。
6. server-side idempotent toolとnative execのrecovery表示を分ける。
7. provider stateのlastSeenAt、resume success / failure eventを更新する。

#### 主な対象

- `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client.ts`
- `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/modules/codingAgent/runtime/codex-runtime-closeout.ts`
- `api/modules/codingAgent/context/context-packet.ts`
- `api/services/runtime-session-state.ts`からCoding Agent固有責務をmodule内repositoryへ移す範囲
- Codex resume contract tests

#### 完了条件

- providerが許可する場合は同じthread IDで次turnが開始する。
- providerが拒否してもRun / Todo / workspaceは同じで、過去eventとunknown outcomeを参照できる。
- tool callが暗黙に成功、失敗、再実行へ分類されない。
- raw resume errorとprovider本文が保持される。

### Phase 6: Integration、canary、rollout

#### Deterministic E2E

登録済みtest Project rootを使い、次を一つのscenarioで実行する。

1. server boot AでCoding Agent Runを開始する。
2. Todoを作成し、current Todoをrunningにする。
3. provider thread IDとworkspace attestationを保存する。
4. fixture runtimeがside-effectまたはverification toolの`started` eventを保存した直後で停止する。
5. server boot AをSIGKILL相当で終了する。
6. 同じDBと登録済みProjectでserver boot Bを起動する。
7. startup reconciliationがRunを`process_interrupted`へ移すことを確認する。
8. Workbenchへuser messageを送る。
9. LLM fixtureが`resume_existing_run`を返す。
10. 同じRun / Todo / Agent Mode Session / workspaceでruntimeを開始する。
11. provider resumeまたはsame-Run fallback後、workspaceを再観測して検証を続ける。
12. TodoをLLM commandでterminalへ移し、Runを完了する。

#### Canary

- deterministic E2Eを3回連続で成功させる。
- live Codex canaryで、verification command中にdev serverを一度停止・再起動する。
- user resume後に同じRun IDとthread IDで継続することを確認する。
- providerがincomplete turn resumeを拒否する場合はsame-Run fallback evidenceを確認し、thread変更を明示記録する。
- canaryは登録済みProjectの専用worktreeで実行し、provider用一時directoryを作業成果の証拠にしない。

#### Rollout

1. ownership persistenceを先に有効化し、既存runtimeの動作を変えず観測する。
2. startup reconciliationをfixture / test環境で有効化する。
3. same-Run resumeとWorkbench routingを同じreleaseで有効化する。
4. Queue-only stale mutationを削除する。
5. canary成功後にdefault wiringとする。

user-visibleな別runtime modeやkeyword fallbackは追加しない。rollbackは新application wiringを戻すことで行い、追加したownership row、events、runtimePauseは監査情報として保持する。

## 8. Test Matrix

| Layer | Scenario | Expected |
| --- | --- | --- |
| Ownership | 同じRunを二processがclaim | 一件だけ成功、他方はtyped conflict |
| Ownership | old API boot owner | startup直後にinterrupted |
| Ownership | live isolated worker | interruptしない |
| Shutdown | graceful server stop | cancelledではなくprocess_interrupted |
| Restart | SIGKILL後startup | 30分待たずresumable pause |
| State | interruption transaction | Task / Run / Queue / ownerがneeds_human整合 |
| Todo | interruption時running Todo | ID / revision / statusを保持 |
| Workspace | attestation一致 | same workspace resume |
| Workspace | attestation不一致 | fail-close、mutationなし |
| Intake | LLM=`resume_existing_run` | same Run resume |
| Intake | LLM=`start_new_run` + active pause | implicit cancelせずtyped conflict |
| Intake | stale routing digest | decisionを再利用しない |
| Mutation | fresh start失敗 | Task status不変 |
| Resume | 二重submit | runtime一件、二件目revision conflict |
| Codex | provider thread resume成功 | same thread ID |
| Codex | provider thread resume失敗 | same Run内fresh thread + State Card |
| Tool | started without finished | unknown_outcome evidence、auto rerunなし |
| Tool | idempotent server mutation | idempotency / revisionで安全に再試行 |
| Provenance | direct Run resume | orchestrationRef=nullを維持 |
| Provenance | Mission Pilot handoff resume | 元orchestrationRefを維持 |
| Reconciliation | startupを二回実行 | event / revision重複なし |
| Closeout | resume後完了 | TodoとRunがLLM command後にterminal |

## 9. Verification Commands

### Focused

```bash
bun run test -- tests/services.coding-agent-process-restart.test.ts
bun run test -- tests/services.resume-task-run.test.ts
bun run test -- tests/implementation-queue-resilience.test.ts
bun run test -- tests/coding-agent-run-handler.test.ts
bun run test -- tests/coding-agent-plan-mode-thread-handoff.test.ts
bun run test -- tests/services.runtime-session-state.test.ts
bun run test -- tests/services.codex-agent-runtime.test.ts
```

### System Context / S11t

```bash
bun run s11tnext:lint
bun run s11tnext:build
bun run s11tnext:check
```

### Repository gates

```bash
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run lint
bun run check:architecture
bun run check:docs
bun run build:backend
bun run verify
```

### E2E / canary

```bash
bun run test -- tests/services.coding-agent-process-restart.test.ts \
  tests/nightworkers-workbench-routes/routes-workbench-02.test.ts \
  -t "reconciles an old boot owner|routes a continuation request"
```

live Codex canaryは通常gateと分離し、credentialと専用registered Projectを用意したrelease候補で明示実行する。

## 10. Observability

次の構造eventを追加する。

- `run.execution_owner_claimed`
- `run.execution_owner_heartbeat`
- `run.process_interrupted`
- `run.resume_requested`
- `run.resume_claimed`
- `run.provider_thread_resumed`
- `run.provider_thread_resume_failed`
- `run.provider_thread_fallback_started`
- `run.unresolved_tool_call_detected`

heartbeat eventはDB更新ごとにtimelineへ大量追加せず、ownership rowの時刻を正本とする。timeline eventはowner claim、interruption、resume、releaseなど状態遷移に限定する。

計測する値は次のとおり。

- process interruption件数とreason
- startupからinterruption確定までの時間
- user resumeからruntime開始までの時間
- same-Run resume成功率
- same provider thread resume成功率
- same-Run fresh provider fallback率
- unresolved tool call件数
- 二重resume conflict件数
- Task / Run / Queue projection不整合件数
- restart後に新規Run衝突した件数（目標0）

これらの値からTaskの意味や完了可否を自動判定しない。

## 11. Rollback Conditions

次のいずれかを検出した場合はdefault wiringを戻す。

- live ownerを誤ってinterruptedへ移した。
- 同じRunでruntimeが二重起動した。
- workspace attestation不一致を通過した。
- process interruptionによりrunning Todoが暗黙変更された。
- direct / Mission Pilot provenanceが変化した。
- provider本文またはraw resume errorが失われた。
- QueueとRunが異なるactiveRunIdを示した。
- fresh start正常系がresume candidate誤検出で停止した。

rollback時は新table、events、runtimePauseを削除しない。新しいstartup / resume dispatcher wiringだけを無効化し、保存済み監査情報をread可能に保つ。

## 12. 完了条件

本計画は次のすべてを満たした場合にのみ`completed`へ更新する。

- abrupt / gracefulの両方でprocess interruptionがcanonical pauseとして保存される。
- restart直後に旧API ownerを検出し、stale thresholdを待たない。
- Run、Task、Queue、execution ownerが同じ状態を示す。
- running Todoをhostが暗黙変更しない。
- WorkbenchのLLM decisionがsame-Run resumeを選択できる。
- user resumeで新しいTaskRunを作らない。
- Run、Agent Mode Session、Todo、workspace identityが停止前後で一致する。
- providerが許可する場合は同じCodex thread IDを再利用する。
- provider resume失敗時もsame-Run fallbackで過去context、unresolved tool call、workspace Factを参照できる。
- in-flight tool callをhostが自動成功・失敗・再実行へ分類しない。
- 二重resume、stale revision、workspace mismatchがfail-closeする。
- fresh start失敗でTask statusが壊れない。
- user-direct / Mission Pilot handoff provenanceが保持される。
- focused tests、S11t checks、typecheck、architecture check、docs check、backend build、full verifyがgreenになる。
- deterministic restart E2Eが3回連続成功する。
- live Codex canaryが成功するか、provider拒否時のsame-Run fallbackが仕様どおり観測される。

## 13. Implementation Closeout

2026-08-03にPhase 1〜6のproduction wiringとdeterministic verificationを完了した。

- durable execution owner table、boot identity、claim / heartbeat / interrupt / release CASを追加した。
- graceful shutdown、旧API boot、worker exit、Queue stale recoveryをcanonical `process_interrupted` pauseへ統合した。
- Task、Run、Queue、execution ownerを同一transactionで遷移させ、running Todoを維持した。
- Workbench intakeのLLM contractへ`runDisposition`を追加し、構造検証済みcandidateとrouting snapshot digestからsame-Run resume commandへdispatchした。
- provider thread resume成功、raw resume failure、same-Run fresh-thread fallbackを構造eventへ記録した。
- started-without-finished tool callを`unknown`としてState Cardへ投影し、hostによる自動再実行を追加しなかった。
- deterministic restart / Workbench resume scenarioは3回連続成功した。
- focused 69 tests、全Vitest 2,418 tests、S11t lint/build/check、typecheck、lint、architecture、docs、frontend/backend build、`bun run verify`がgreenになった。
- follow-up reviewで800行超の手書きtest 2件をfixture / deadline / route supportへ分割し、worker exitのowner PID照合、Queue recoveryのexecution lease失効条件、same-Run prepareのstatus / context CAS、二重再開時のterminal化防止、resume errorのsecret redaction、監査event失敗時の正本遷移維持を追加した。

live Codex process-restart canaryは、通常のlocal gateから分離するという本計画の方針に従い、この実装Runでは実行していない。credential、専用registered Project、release-candidate buildを用意した環境でのみ実施し、providerがincomplete turnを拒否した場合は今回追加したsame-Run fallback eventを確認する。したがってproduction implementationは完了しているが、本書のstatusはrelease canary完了まで`completed`ではなく`implemented`とする。
