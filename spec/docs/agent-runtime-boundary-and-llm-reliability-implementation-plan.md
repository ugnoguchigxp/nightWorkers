# Agent Runtime Boundary / LLM Reliability 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-08-16
- Parent program: [Codebase Review Remediation Program](./codebase-review-remediation-program-index.md)
- Findings: `M1`, `M2`, `M3`, `M10`, `M14`, `m8`, `m10`
- Implementation authorization: not started

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

## 7. Architecture checks

次をstatic checkへ追加する。

1. `api/modules/codingAgent`からNightWorkers private repository/orchestration/serviceへのimport禁止。
2. `api/modules/missionPilot/persistence`からTask Operator runtime import禁止。
3. Coding Agent/Mission Pilot host adapterの許可root限定。
4. role module間のpublic index経由re-exportによる迂回禁止。
5. provider codecからTask/Queue repositoryへのimport禁止。

## 8. Verification commands

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

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Codex security enforcementがSDK version依存 | capability snapshotをversion固定し、upgrade時に再実測する |
| port抽出が巨大interfaceになる | use case単位のbounded command/projectionに分ける |
| raw argument保持がsecret persistenceを増やす | 既存redaction/firewallとbounded digestを使用する |
| malformed streamをretryしてprovider callが増える | retryable kindと回数上限を維持する |
| estimator統一でcontextを早く捨てる | 一律除数化せず、boundary dataで比較する |

## 10. Completion criteria

1. Native/Codex runtimeが同じsecurity fixture matrixを満たす。
2. Coding AgentからNightWorkers private importがなくなる。
3. Mission Pilot persistenceからTask Operator runtime importがなくなる。
4. malformed tool argumentがdispatchされず、raw diagnosticは保持される。
5. malformed OpenAI SSE recordがsuccessへ混入しない。
6. soft/hard budget不変条件と多言語boundary testがある。
7. abort後にprovider call/eventが増えない。
8. architecture、限定test、typecheck、lintが成功する。
