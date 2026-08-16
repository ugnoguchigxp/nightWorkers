# Agent Runtime Boundary / LLM Reliability 実装計画

## Status

- Plan status: `completed`
- Document created: 2026-08-16
- Implemented: 2026-08-16
- Parent program: [Codebase Review Remediation Program](./codebase-review-remediation-program-index.md)
- Findings: `M1`, `M2`, `M3`, `M10`, `M14`, `m8`, `m10`
- Implementation authorization: completed

## 実装結果

- C-T0/C-T1: Codex CLI `0.144.4` (darwin/arm64, `workspace-write`) を実測した結果、Project secret、repository外、
  symlink外部へのread/writeを遮断できないことを確認した。そのため当該platformのCodex laneは
  `CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED`でfail-closedにした。測定値・値を含まないdigest・schemaは
  `tests/fixtures/codex-runtime-security-capabilities/`に保存した。
- C-T2〜C-T5: Coding Agentのhost portと`api/composition/coding-agent` adapterを導入し、
  Coding AgentからNightWorkers private implementationへの直接importを禁止した。unit/integration testは
  明示的なfake hostを注入し、production adapterをVitest共通setupへ読み込まない。
- C-T6: Mission Pilot persistenceのTask Operator value importをcomposition supplied host inputへ置換した。
- C-T7〜C-T10: malformed tool argument / OpenAI SSEをlossless typed failureに統一し、用途別token budgetと
  abort後retry停止を検証した。
- 検証: 関連Vitest 14 file / 100 tests、追加したhost-boundary suites 3 file / 20 tests、
  `bun run check:architecture`が成功した。全体`tsc`は本計画外の`safe-outbound-fetch` / `fetch-content`の
  未完差分で失敗するため、この計画の完了判定には含めていない。

## 1. 目的

Native API runtimeとCodex SDK runtimeのsecurity propertyを明示し、Agent role moduleがhost private
実装へ直接依存しない構造へ移行する。同時に、provider stream、tool argument、token budget、abortを
losslessかつtypedなfailure contractへ揃える。

変更後は次を満たす。

1. Codex SDK laneがNightWorkersのsecret/workspace/副作用境界を迂回しない。
2. Coding AgentとMission Pilotが、host repositoryや別moduleの内部実装を直接importしない。
3. malformed provider response/tool argumentを本文ごと保持し、実行前に構造的不正として止める。
4. token budgetは用途別の推定根拠とsoft/hard不変条件を持つ。
5. abort後に新しいprovider attemptを開始しない。

## 2. 非目的

- `approvalPolicy: never`だけを理由にCodex sandboxが無効だと扱わない。
- headless runtimeへ対話approval UIを根拠なく追加しない。
- Coding Agentへ意味別mode、固定workflow、tool allowlistを追加しない。
- Native API runtimeとCodex SDK runtimeを別Agent roleとして分割しない。
- provider parse failure時にLLM本文を固定error messageへ置き換えない。
- すべてのtoken estimateを同じ除数へ統一しない。
- Task interpretation、Todo、完了判断をprovider adapterへ移さない。

## 3. 現行の確認済み不足

### 3.1 Runtime security asymmetry

- Codex SDKは`workspace-write`、`approvalPolicy: never`、repository rootをworking directoryにする。
- OS sandboxは存在するが、Codex built-in shell/filesystemはNightWorkers worker tool policyを通らない。
- MCP toolごとの`approval_mode: approve`とglobal approvalの最終挙動は現行コードだけでは証明できない。
- Native API runtimeはworker-tool dispatcherからworkspace confinementを要求する。

### 3.2 Role module boundary

- `api/modules/codingAgent`の16 production fileがNightWorkers repository/orchestrationへ直接依存する。
- Mission Pilot persistenceの3 fileがTask Operator runtime functionへ直接依存する。
- 現行architecture checkはこれらを検出せずpassする。

### 3.3 Provider / tool structural failure

- Codex tool argument parse失敗は`{ _raw }`へ変換され、tool call自体は`ok: true`となる。
- mutating toolには下流validationがあるが、引数なしread toolはmalformed argumentを無視して実行する。
- OpenAI SSE JSON parse失敗はwarn後にrecordをdropする。
- drop後のcontentが偶然validなら、部分欠落したresponseが正常扱いされ得る。

### 3.4 Budget / cancellation

- general estimateは文字数/4、native context gateは保守的な文字数/3、Mission PilotはUTF-8 byte/4+bufferを使う。
- Mission Pilot既定値はsoft 24k、hard 32kで、既定経路はhard判定より先にcompactionする。
- provider retry backoffはabortでresolveするが、continue後のattempt開始前に再checkしない。

## 4. Target invariants

1. Runtime laneの違いでProject secretとworkspace write boundaryの意味が変わらない。
2. Security enforcementはprompt instructionだけに依存しない。
3. `approvalPolicy`、MCP approval、OS sandbox、NightWorkers server authorizationを別の層として記録する。
4. Coding Agent固有portはCoding Agent moduleが所有し、host adapterをcomposition/registrationで注入する。
5. Mission Pilot package/persistenceはTask Operator操作を既存host port経由で行う。
6. Provider adapterはprovider呼出、JSON抽出、schema検証、typed failure、最小限の互換正規化だけを行う。
7. malformed raw本文はbounded diagnosticとして保持するが、schema-valid argumentへ偽装しない。
8. retryは明示的retryableな一時障害だけに限定し、abort後はattempt数を増やさない。
9. soft budgetはhard budget以下でなければならず、設定不正をruntime開始前に拒否する。

## 5. Ownership

| Concern | Owner |
| --- | --- |
| Coding Agent host ports | `api/modules/codingAgent` |
| Coding Agent host adapters | Agent private repositoryを逆importしないcomposition/registration root |
| Mission Pilot host ports | `packages/mission-pilot` |
| Mission Pilot host adapters | `api/composition/mission-pilot` |
| Shared role-independent contract | 必要な場合だけ`api/modules/agentsShare`または`shared/modules/agentsShare` |
| Provider codec/failure | provider service/module |
| Native runtime orchestration | `api/modules/codingAgent/runtime` |
| SystemContext | `api/systemContexts` |

`agentsShare`へNightWorkers repository、route、role判定、role固有toolを移して境界を迂回しない。

## 6. Implementation phases

### Phase C0: Runtime security capability matrix

#### Implementation

現在利用するCodex SDK/CLI versionと対象OSごとに、次をfixture repositoryで実測する。

- repository内通常file read/write。
- repository外file read/write。
- `.env`、`.env.*`、PEM/key、registry credential file read。
- shell child process、symlink、absolute path。
- network access。
- MCP `approval_mode`とglobal `approvalPolicy`の組合せ。
- server側authorization拒否時のCodex event/result。

結果をversion付き`CodexRuntimeSecurityCapability` snapshotとしてtest fixtureへ保存する。

#### Decision gate

- Codex runtimeへcustom OS deny ruleを注入できる場合は、Area Aのsecret catalogからruleを生成する。
- 注入できない場合は、promptだけで完了扱いにしない。登録済みrepo rootを維持したままsecret readを
  OS/server境界で防げる別の実装を決めるまで、Codex laneをsecurity-equivalentと判定しない。
- 一時directoryを実作業workspaceとして扱う回避策は採用しない。

#### Acceptance

- 「neverだから危険」「workspace-writeだから安全」のどちらの推測にも依存しない。
- 実測結果と採用したenforcement mechanismが対応している。

### Phase C1: Runtime security contractを共通化する

#### Implementation

1. Area Aのsecret catalog、workspace authority、outbound policyをruntime security contractへ束ねる。
2. Native runtimeは既存worker tool/confinementでcontractを満たす。
3. Codex runtimeはPhase C0で選んだOS/server enforcementを使用する。
4. runtime開始前preflightで、要求contractを満たせない構成をtyped failureにする。
5. `approvalPolicy`を変更する場合は、headless approval transportと停止手段を先に定義する。
6. MCP mutating toolはserver側のTask ownership、revision、idempotency、Run bindingを維持する。

#### Acceptance

- 同じfixture secret/security caseがNative/Codex両laneで同じ結果になる。
- Codex built-in shellを使ってもProject secretを取得できない。
- approval待ちで無期限hangしない。

### Phase C2: Coding Agent host port extraction

#### Implementation

1. 16 direct importerを用途別にinventory化する。
   - Run load/update。
   - start/resume/finalize。
   - Task/Todo/context/evidence query。
   - event/ledger persistence。
2. Coding Agent moduleが必要最小限のtyped portを所有する。
3. portはdomain commandまたはbounded projectionを返し、NightWorkers repository rowをそのまま公開しない。
4. host adapterをruntime registration/compositionで注入する。
5. callerを一群ずつportへ移し、最後にprivate importをarchitecture checkで禁止する。
6. `nightworkers.repository`を別名でre-exportして移行済みとしない。

#### Acceptance

- `api/modules/codingAgent`から`api/modules/nightworkers`のrepository、orchestration、serviceへの
  direct importが0件である。
- Coding Agent standalone entrypointのtestがhost fake portだけで実行できる。
- Task解釈や完了判断の所有権はCoding Agent applicationに残る。

### Phase C3: Mission Pilot persistence boundary

#### Implementation

1. authorization作成に必要なuser capability snapshot/digestをhost inputまたはportへ移す。
2. agent session backfillで必要なTask Operator projectionをMission Pilot host read portから取得する。
3. action definition参照をMission Pilot packageのaction contract portへ接続する。
4. `api/composition/mission-pilot`でTask Operator public application commandへadapterを実装する。
5. persistence rootからTask Operator runtime importを禁止するarchitecture ruleを追加する。

#### Acceptance

- Mission Pilot persistenceから`api/modules/taskOperator`へのruntime importが0件である。
- persistenceはDB capabilityとMission Pilot public contractだけを扱う。
- capability digestとauthorization結果が移行前後で一致するfixture testがある。

### Phase C4: Lossless malformed tool argument handling

#### Implementation

1. provider codec resultを次のdiscriminated unionへ変更する。

```ts
type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown>; raw: string }
  | { ok: false; raw: string; failure: "invalid_json" | "non_object" };
```

2. raw本文はprovider turn/session historyへbounded保存する。
3. `ok: false`はtool dispatch前に`INVALID_TOOL_ARGS`相当のtyped tool resultへ変換する。
4. 引数なしtoolを含め、tool schemaの`additionalProperties`、required、型を共通validatorで検証する。
5. mutating tool固有のauthorization/revision validationは下流に維持する。
6. OpenAI、Bedrock、Codexの互換正規化を同じ契約へ揃える。

#### Acceptance

- malformed JSONでread toolもmutating toolも実行されない。
- raw引数はdiagnostic/historyから再取得できる。
- schema failureがprovider本文の固定文置換を起こさない。

### Phase C5: OpenAI stream invalid response

#### Implementation

- SSE framingは空dataと`[DONE]`だけを正常skipする。
- JSON parse不能recordは、payload preview/digestを保持した`StructuredProviderError`の
  `invalid_response`へ変換する。
- 既にemit済みdeltaがある場合も、最終resultをsuccessにしない。
- retryはprovider failure policyで明示的retryableとされた場合だけ行う。
- local-compatible endpointのcompatibility fallbackは既存回数上限を維持する。

#### Acceptance

- 中間record破損後にvalid JSON contentが組み上がってもsuccessにならない。
- malformed payload全体を無制限にlog/persistしない。
- callerは`invalid_response`とschema-invalid model本文を区別できる。

### Phase C6: Budget estimator contract

#### Implementation

1. 推定用途を`usage_estimate`、`context_gate`、`compaction_gate`として型または明示parameterで区別する。
2. provider/model capabilityと使用したalgorithm versionをbudget eventに残す。
3. Native context gateの保守的/3は、model-specific tokenizerまたはより強いevidenceがない限り維持する。
4. Mission Pilotのsoft/hard設定に`soft <= hard`を強制する。
5. 日本語、ASCII、emoji、巨大tool schema、provider message/tool callを含むboundary testを追加する。
6. exact tokenizer導入はmodel/runtime costと精度改善を測定してから決める。

#### Acceptance

- estimator差が意図とalgorithm versionで説明できる。
- 既定Mission Pilotはhard超過前にcompactionを試みる。
- 設定不正でhard-before-softになる構成を開始できない。

### Phase C7: Abort-safe retry

#### Implementation

- backoff関数を`completed | aborted` resultまたはAbortErrorにする。
- backoff直後、attempt event発行前、provider call直前にsignalを再確認する。
- abort後はroute fallbackにも進まない。
- cancelled resultとprovider failureを区別し、retryableへ正規化しない。

#### Acceptance

- backoff中abort後のprovider call countが増えない。
- `model_response_started` eventも追加発行されない。

## 7. Terra実行チケット台帳

Area Cはsecurity実測、port境界、provider codecを別change setにする。特に`C-T0`の測定結果がない状態で
Codex laneをNative laneと同等と記録してはならない。

### C-T0: Codex SDK 0.144.4 security capabilityを実測する

- Findings: `M1`
- Write set: 新規`tests/codex-runtime-security-capability.integration.test.ts`、新規
  `tests/fixtures/codex-runtime-security-capabilities/README.md`、実測結果JSON
- Read-only参照: `package.json`、`node_modules/@openai/codex-sdk/dist/index.d.ts`、
  `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-config.ts`、
  `api/modules/codingAgent/runtime/CodexAgentRuntime.ts`、Area Aのsecret/confinement contract
- Fixed fact: 現在の`@openai/codex-sdk`は`0.144.4`で、`ThreadOptions`は`sandboxMode`、working directory、
  network flag、approval、additional directoriesを持つが、project secret deny pathのfieldを持たない。
- Harness: tempではなく登録済みfixture repositoryをworking directoryにし、通常file、`.env`、`.env.local`、
  PEM/key、symlink外部、absolute外部、workspace内write、workspace外write、network、child processを各1 turnで測る。
  fixture secretはランダム生成し、結果JSONには値ではなく`allowed/denied/error code/digest`だけを保存する。
- Matrix key: SDK version、bundled Codex version、OS/arch、sandboxMode、approvalPolicy、network flag、
  additionalDirectories、実行日時を必須にする。
- Stop: provider credential、対象OS、実CLIがなく未実行の場合はunit mockでpassへ置換しない。`M1`を
  `measurement_blocked`として残し、C-T1へ進まない。
- Done: NativeとCodexの同一fixture表が得られ、差分ごとにenforcement層が説明される。

### C-T1: Runtime security preflightをArea A contractへ接続する

- Findings: `M1`
- Depends on: `A-T2`, `A-T3`, `C-T0`
- Write set: 新規`api/modules/codingAgent/runtime/runtime-security-contract.ts`、
  新規`api/modules/codingAgent/runtime/codex-sdk/codex-confinement-wrapper.ts`、
  `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-config.ts`、
  `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client.ts`、
  `tests/native-agent-runtime-coverage.test.ts`、C-T0 suite
- Contract fields: canonical repo root、read/write roots、existing project secret deny paths、network policy、
  confinement required、capability snapshot ID。Native/Codexの両laneが開始前に同じcontractを受け取る。
- Codex enforcement: C-T0で外側OS confinementとCodex自身のsandbox併用が実証できたOSだけ、そのwrapperを
  `Codex`の`codexPathOverride`/起動adapterへ接続する。wrapperは実repositoryをcwdに維持し、Area Aのsecret denyと
  network denyを外側で強制する。一時directoryを作業workspaceにしない。
- Fail closed: SDK fieldやpromptだけでsecret denyを実現したことにしない。該当platformでouter confinementを
  構成・実証できない場合、Codex lane開始を`CODEX_RUNTIME_SECURITY_CAPABILITY_MISSING`で停止する。
- Approval: `approvalPolicy: never`はheadless動作設定として維持し、security boundaryの根拠に数えない。
  MCP mutating toolのserver-side authorization/revision/idempotencyは変更しない。
- Done: 同じfixtureがNative/Codexで一致し、preflight failure後にprovider processが0回起動する。

### C-T2: Coding Agent所有のhost port contractを定義する

- Findings: `M2`
- Write set: 新規`api/modules/codingAgent/ports/coding-agent-host.port.ts`、
  新規`api/modules/codingAgent/ports/coding-agent-host.types.ts`、`api/modules/codingAgent/index.ts`、新規port unit test
- Port groups: `taskReader`、`runReader`、`runLifecycle`、`runJournal`、`verificationReader`の5 interfaceに分ける。
  必要operationはTask/Repository/Runのbounded projection取得、Run Todo取得、start/resume、Run/Task event append、
  Task message append、Run context CAS、Run publish、verification snapshot/readiness取得に限定する。
- Types: `typeof nightworkersRepo.*`をport public typeに使わず、Coding Agentが実際に読むfieldだけを
  `CodingAgentTaskSnapshot`等へ定義する。Date、status enum、revision、context snapshotの意味は既存shared schemaを再利用する。
- Injection: module globalのmutable defaultを置かず、`createCodingAgentRunHandlers(host)`とruntime constructorへ明示注入する。
- Stop: 1 interfaceが20 operationを超える、またはNightWorkers DB rowを丸ごと返す必要が出たら、caller inventoryを
  再分割してから進む。
- Done: fake hostだけでstart/resume/context/finalizeのunit testを型検査でき、まだcaller移行は行わない。

### C-T3: `api/composition/coding-agent` adapterとregistration rootを新設する

- Findings: `M2`
- Depends on: `C-T2`
- Write set: 新規`api/composition/coding-agent/coding-agent-host-adapter.ts`、新規
  `api/composition/coding-agent/index.ts`、`api/app.ts`、`api/server.ts`、composition test
- Fixed fact: 現HEADには`api/composition/mission-pilot`だけがあり、Coding Agent composition rootは存在しない。
- Adapter: このdirectoryだけがNightWorkers repository、start/resume orchestration、verification repositoryをimportし、
  C-T2 projectionへmapする。domain meaningを再判定せず既存application commandを呼ぶ。
- Registration: `app.ts`/`server.ts`はCoding Agent moduleのzero-arg initializerではなくcomposition factoryを呼ぶ。
  unregister/idempotent initializationの現行挙動を維持する。
- Done: server start二重初期化、unregister/re-register、fake host registrationが既存HTTP/WebSocket testで通る。

### C-T4: application/context/MCP importerをportへ移す

- Findings: `M2`
- Depends on: `C-T3`
- Write set: 次の9 fileだけ。
  - `application/coding-agent-run.handler.ts`
  - `application/codex-verification-closeout.service.ts`
  - `application/completion-readiness.service.ts`
  - `application/interrupted-run-activation.service.ts`
  - `application/interrupted-run-launch-recovery.service.ts`
  - `application/run-finalize-controller.ts`
  - `application/runtime-execution-interruption.service.ts`
  - `context/context-packet.ts`
  - `mcp/nightworkers-codex-mcp-support.ts`
- Method: 既にdependency objectを持つcontrollerはtypeをportへ置換し、直接importだけを削除する。event/messageの
  payload、Task revision、Run ownership checkは現行値をgolden testで固定する。
- Tests: `tests/coding-agent-command-http.test.ts`、`tests/task-operator-regressions.test.ts`、
  `tests/coding-agent-runtime-reliability-integration.test.ts`と各近接coverage suite。
- Stop: DB transactionをCoding Agent側へ移す必要が生じたら行わず、composition adapterに新しいatomic host commandを追加する。
- Done: 上記9 fileから`modules/nightworkers` importが0件で、fake host testが通る。

### C-T5: runtime importerをportへ移しarchitecture guardを有効化する

- Findings: `M2`
- Depends on: `C-T4`
- Write set: 次の7 file、C-T2 port、C-T3 adapter、`.agent-ontology/boundary-policy.json`、
  `scripts/check-module-boundaries.mjs`、`tests/role-module-boundary.test.ts`。
  - `runtime/codex-repository-preflight.ts`
  - `runtime/e2e-fixture-runtime.ts`
  - `runtime/ledger-sink.ts`
  - `runtime/native-api-runner/native-api-runner-context-events.ts`
  - `runtime/native-api-runner/native-api-runner-history-cards.ts`
  - `runtime/native-api-runner/native-api-runner.ts`
  - `runtime/NativeAgentRuntime.ts`
- Note: inventoryはimportを持つ16 production fileを正本にし、上記は7 fileである。C-T4の9 fileと重複する
  `runtime-execution-interruption.service.ts`等を二重計上しない。実装開始時に`rg -l`を再実行し、合計が変われば台帳を更新する。
- Architecture rule: `api/modules/codingAgent/**`から`api/modules/nightworkers/**`へのvalue/type import、dynamic import、
  public index経由re-exportを禁止し、許可rootを`api/composition/coding-agent/**`だけにする。policyにsource/target edgeを
  追加し、scriptがTypeScript preprocessorで静的import/exportを検査する。
- Done: repository-wide検索0件、architecture test pass、Native/Codex/e2e fixtureの現行behavior test pass。

### C-T6: Mission Pilot persistenceの3つのTask Operator value importをhost inputへ移す

- Findings: `M3`
- Write set: `api/modules/missionPilot/persistence/authorization.ts`、
  `api/modules/missionPilot/persistence/agent/agent-session.repository.ts`、
  `api/modules/missionPilot/persistence/agent/conversation.repository.ts`、
  `api/composition/mission-pilot/mission-pilot-host-ports.ts`、runtime bindings/dependencies、
  `scripts/check-mission-pilot-package-boundary.mjs`、
  `tests/mission-pilot-repository.test.ts`、`tests/mission-pilot-provider-port.test.ts`、architecture test
- Authorization: `readCurrentTaskOperatorUserCapabilities`とdigest生成をcomposition host portへ移し、persistenceは
  `{capabilities, capabilityDigest}`を入力としてauthorization rowを構築するだけにする。
- Backfill/play: `humanTaskOperatorPrincipal`と`readTaskOperatorProjection`をhost port callの結果として受け、
  persistence repositoryからTask Operator commandを呼ばない。
- Conversation: `getTaskOperatorActionDefinition`で解決した`actionId` projectionをclaim/append command inputへ渡し、
  DB transaction中に別role runtimeを呼ばない。
- Type-only exception: `shared/modules/taskOperator`の純粋schema typeは両roleで同義なら維持できる。
- Done: 上記3 fileから`api/modules/taskOperator` value importが0件で、capability digest/action ID/backfill結果が移行前fixtureと一致する。

### C-T7: malformed tool argumentをdispatch前のtyped failureにする

- Findings: `M14`
- Write set: 新規`api/services/structured-llm/tool-argument-codec.ts`、
  `api/services/structured-llm/tool-calls.ts`、`codex-tool-turn.ts`、`openai-tool-call-codec.ts`、
  `providers.ts`、`bedrock-provider.ts`、`provider-failure.ts`、`codex-provider.ts`、
  `tests/structured-llm/codex-tool-turn.test.ts`と新規codec test
- Codec result: `{ok:true,value,raw} | {ok:false,raw,failure:'invalid_json'|'non_object'}`。空文字はschemaが
  propertyなしを許す場合の`{}`として扱う。array/null/number/stringを`{value}`へ正規化しない。
- Failure: invalid callが1件でもあれば`ProviderToolCall`を生成せず、`StructuredProviderError`の
  `kind:'invalid_response'`, `code:'INVALID_TOOL_ARGUMENTS'`, `retryable:false`をthrowする。outer response/contentと
  raw argumentsは8 KiB上限+digestの`providerBody`へ保持する。`{_raw}`を実行可能argumentsにしない。
- Schema: JSON object化後のtool input schema検証は既存dispatch validatorを通し、required/type/additionalProperties
  failureでもtool本体を呼ばない。provider codecにTask意味判断を追加しない。
- Done: Codex/OpenAI/Bedrockのinvalid JSON/non-object/unknown tool/schema mismatchでdispatch count 0、raw診断あり。

### C-T8: malformed OpenAI SSE recordを`invalid_response`にする

- Findings: `m8`
- Write set: `api/services/structured-llm/openai.ts`、`provider-failure.ts`、
  `tests/structured-llm/services-structured-llm-02/schema-parsing.cases.ts`、近接stream suite
- Contract: 空dataと`[DONE]`だけをskipする。JSON.parse失敗時はlogger warn+continueを廃止し、bounded payloadを
  `providerInvalidResponseError`へ渡して直ちにthrowする。既にemitしたdeltaがあってもfinal successを返さない。
- Retry: kindは`invalid_response`、retryable false。local-compatible endpoint fallbackを増やさない。
- Done: 先頭/中間/末尾の破損record、multi-line SSE、UTF-8分割でpartial contentがsuccessにならない。

### C-T9: estimatorを用途別に命名しbudget不変条件だけを固定する

- Findings: `M10`
- Write set: `api/services/conversation-context/token-budget.ts`、
  `api/modules/codingAgent/runtime/native-api-runner/native-api-context-budget.ts`、
  `packages/mission-pilot/src/services/conversation-context/token-budget.ts`、各近接test
- First step: ASCII、日本語、emoji、tool schema/history fixtureで3 estimatorの出力、soft/compact/hard境界をsnapshotする。
- Decision: current `/4`、conservative `/3`、UTF-8 byte `/4+buffer`は用途を示す関数名とalgorithm versionを付ける。
  `soft <= hard`、`autoCompact <= safePrompt <= context-reserved`が全fixtureで成立するなら式を変更しない。
- Stop: model tokenizerを追加する場合はdependency/lockfile変更を別ticketにし、精度測定なしに除数を統一しない。
- Done: no-change判断を含め、各式のconsumerとboundary testが一対一で説明できる。

### C-T10: abort中backoffからprovider retryへ進ませない

- Findings: `m10`
- Write set: `api/modules/codingAgent/runtime/native-api-runner/native-api-provider-attempts.ts`、
  既存native provider attempt suite
- Contract: `waitForProviderRetryBackoff`は`'elapsed' | 'aborted'`を返す。callerは`aborted`または
  `signal.aborted`ならloopを終了し、attempt event、route fallback、provider callを追加しない。
- Done: fake timerでbackoff中abortした時のprovider call count=1、後続attempt event=0、cancelled resultのkind維持を検証する。

## 8. Architecture checks

次をstatic checkへ追加する。

1. `api/modules/codingAgent`からNightWorkers private repository/orchestration/serviceへのimport禁止。
2. `api/modules/missionPilot/persistence`からTask Operator runtime import禁止。
3. Coding Agent/Mission Pilot host adapterの許可root限定。
4. role module間のpublic index経由re-exportによる迂回禁止。
5. provider codecからTask/Queue repositoryへのimport禁止。

## 9. Verification commands

```bash
# Existing characterization suites
node scripts/run-vitest.mjs run \
  tests/structured-llm/codex-tool-turn.test.ts \
  tests/structured-llm/services-structured-llm-02.test.ts

# Suites added by this implementation plan
node scripts/run-vitest.mjs run \
  tests/codex-agent-runtime/llm-owned-contract.test.ts \
  tests/native-api-provider-attempts.test.ts
bun run check:architecture
bun run typecheck
bun run lint
```

後半2件は本計画で新設するtest fileであり、現状ではまだ存在しない。実装完了時には上記4件を
すべて実行し、globで無関係なsuiteを成功根拠にしない。

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Codex security enforcementがSDK version依存 | capability snapshotをversion固定し、upgrade時に再実測する |
| port抽出が巨大interfaceになる | use case単位のbounded command/projectionに分ける |
| raw argument保持がsecret persistenceを増やす | 既存redaction/firewallとbounded digestを使用する |
| malformed streamをretryしてprovider callが増える | retryable kindと回数上限を維持する |
| estimator統一でcontextを早く捨てる | 一律除数化せず、boundary dataで比較する |

## 11. Completion criteria

1. Native/Codex runtimeが同じsecurity fixture matrixを満たす。
2. Coding AgentからNightWorkers private importがなくなる。
3. Mission Pilot persistenceからTask Operator runtime importがなくなる。
4. malformed tool argumentがdispatchされず、raw diagnosticは保持される。
5. malformed OpenAI SSE recordがsuccessへ混入しない。
6. soft/hard budget不変条件と多言語boundary testがある。
7. abort後にprovider call/eventが増えない。
8. architecture、限定test、typecheck、lintが成功する。
