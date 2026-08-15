# Coding Agent API Lane Reliability Implementation Plan

## Status

- Plan status: `implemented-and-reviewed / credentialed-canary-pending`
- Document created: 2026-08-09
- Implementation updated: 2026-08-09
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Primary scope: Structured LLM endpoint正規化、Coding Agent API laneのrole routing、Plan Mode契約、Run route snapshot、provider failure、observability、回帰検証
- Baseline worktree: dirty（既存の未コミット変更と未追跡testが多数存在する。本計画の実装では所有権を侵害しない）
- Related documents:
  - `spec/s11t-coding-agent-guide.md`
  - `spec/docs/coding-agent-runtime-reliability-recovery-plan.md`
  - `spec/docs/coding-agent-balanced-execution-plan.md`
  - `spec/docs/coding-agent-process-restart-continuation-implementation-plan.md`

## 1. 結論

API laneがPlan Modeや思考を開始しないように見える直接原因は、Settingsの接続確認と実際のprovider requestが異なる接続先を使用していることにある。現在のlocal endpointには、UIで表示される`baseUrl`と非表示になった旧`endpoint`が異なる値で共存しており、接続確認は`baseUrl`で成功する一方、実行は旧`endpoint`を優先して接続失敗している。

これに加えて、Native API runnerがroleを`implementation`へ固定し、Run開始時に確定したactive roleを実行時に失っている。Plan、Evaluation、Implementationを同じproviderへ向けた場合は見えにくいが、roleごとにproviderを分けると、Plan RunがImplementation routeを選ぶ、またはAPI lane候補なしで停止する。

本計画では新しい意味別runtimeや固定workflowを追加しない。Coding Agentは単一runtimeのまま、次の正本を一貫させる。

1. endpoint kindから一意に導出したprovider接続先
2. intakeまたはRun開始時に確定したactive role
3. Run開始時のactive role固有route snapshot
4. Plan Modeの入口、生成物、完了条件
5. provider requestの開始、失敗、終了を追跡できる構造event

Hostが強制するのはendpoint kind、role、route revision、Run identity、retryable failureなどの構造的不変条件に限定する。Task解釈、Todo、次action、検証、完了判断はLLMが所有する。

## 2. Baselineと確認済み事実

### 2.1 現在の再現結果

2026-08-09の評価時点で、次を確認した。

| 観測 | 結果 |
| --- | --- |
| Settingsのprovider health check | HTTP 200、reachable、約217ms |
| 同じendpoint設定を使う最小provider-native request | `ConnectionRefused` |
| Workbench Plan Mode gate | `role=evaluation`、約59msでprovider error |
| API laneのTask Run | 作成されない |
| LLM trace | `workbench_plan_mode_gate`のprovider errorを記録 |

Runが存在しないのは、Coding Agent runtime開始後に停止したためではない。Workbench intakeのPlan Mode gateがRun作成前に失敗しているためである。

### 2.2 接続先の不一致

- `api/services/structured-llm/provider-health.ts`は、Azure以外で`baseUrl`を接続確認対象にする。
- `api/services/structured-llm/request.ts`は、実行時に`endpoint.endpoint`を`endpoint.baseUrl`より先に選ぶ。
- `src/modules/settings/SettingsLlmProviderEndpoints.tsx`は、local / OpenAI compatibleで`baseUrl`だけを表示する。
- `api/modules/settings/domain/llm-settings-normalization.ts`は、kind変更後も`baseUrl`と`endpoint`を両方保持、mergeする。

このためSettings画面から確認、修正できない値が実行時の正本になる。

### 2.3 roleの喪失

- `api/modules/nightworkers/run-orchestration/start-task-run-runtime-context.ts`は、`planModeRequested`から`plan`または`implementation`を解決する。
- runtime registryへ渡す`llmRouting`にもactive roleとrouteが存在する。
- `api/modules/codingAgent/runtime/native-api-runner/native-api-request-adapter.ts`は、provider request生成時に`role = "implementation"`を固定する。
- `api/modules/codingAgent/runtime/native-api-runner/native-api-runner-routing.ts`は、active roleだけでなく全roleのroute keyを許可するため、取り違えを検出しない。

### 2.4 Plan Mode契約の分裂

- WorkbenchのPlan Mode gateはEvaluation roleを使用する。これはTaskをPlanへ送るかを分類する呼び出しであり、Plan生成そのものではない。
- `plan_mode`選択後はDesign QuestionnaireをPlan roleで生成し、Task Runは作成しない。
- Coding Agentのdirect Plan Run用System Contextと`planModeRequested`は存在するが、新規Runを開始するproduction callerが明確でない。
- runtime user promptにはImplementation用preambleが常に入り、direct Plan System Contextの「repositoryを変更せず計画を報告する」と矛盾する。

### 2.5 観測性の不足

- Workbench intakeは非同期で開始する。
- structured LLMは`model.request_started`を生成するが、Workbenchのrealtime emitterは主に`model.response_delta`だけを公開する。
- 非stream providerや接続直後の失敗ではdeltaが発生しないため、UI上は無反応に見える。
- provider failure時のユーザー向け情報から、role、endpoint ID、model、route source、failure kindが失われる。

### 2.6 検証baseline

- 対象test 5ファイル、90件: 成功
- `bun run typecheck`: 成功
- `bun run s11tnext:check`: 成功
- `bun run check:architecture`: 既存の未追跡testによる本件外の境界違反で失敗

実装開始時に同じbaselineを再取得し、本件変更と既存worktreeの差を分離する。

## 3. Root Cause

```text
endpoint kind変更または旧設定migration
        |
        v
baseUrlと旧endpointが異なる値で共存
        |
        +--> Health checkはbaseUrlを使用して成功
        |
        +--> provider requestは旧endpointを優先
                         |
                         v
               Plan Mode gateが即時接続失敗
                         |
                         v
              Run未作成・delta未発生・UIは無反応
```

roleを分けた構成では、さらに次が重なる。

```text
Run開始時 activeRole=plan
        |
        v
Native API request adapterでimplementationへ固定
        |
        v
Implementation routeを再解決
        |
        +--> 異なるproviderへ送信
        |
        +--> Codex routeならAPI lane候補なし
```

根本原因は単一の接続障害ではない。endpoint正本、role正本、Run snapshot、Plan Modeのpublic contract、provider eventの5層が分断されている。

## 4. Scope

### 4.1 In scope

- provider endpointをkind別にcanonicalizeする保存・読込migration
- Settings UIのkind変更時に非互換フィールドを残さない更新contract
- Health、readiness、structured generation、Native API runnerが共有する接続先resolver
- active roleをRun開始からNative API requestまで維持するrouting contract
- active role固有のroute snapshotとsettings revision検証
- Workbench Plan Mode gate、Questionnaire、direct Plan Runのpublic contract整理
- direct Plan RunとImplementation Runに対応したprompt構築
- provider transport / HTTP / timeout / auth / rate limit / parse failureのtyped failure化
- request開始、route、retry、失敗、終了の永続eventとrealtime表示
- unit、integration、deterministic canary、credentialed local/OpenAI-compatible canary

### 4.2 Out of scope

- Mission PilotのTask解釈、Questionnaire、Artifact操作、完了判断の所有権変更
- Coding Agentへの新しい意味別runtime、固定workflow、tool allowlistの追加
- ユーザー文言やerror messageのregex / keyword分類
- providerが返した本文の固定文への差し替え
- Todoのhostによる暗黙更新
- unrelatedなSettings全体またはstructured LLM全体の大規模再設計
- S11t runtime / CLI versionの更新
- 現在のdirty worktreeに含まれるSecurity Scan、Task Generation、追加coverage testの修正

## 5. Target Invariants

### 5.1 Canonical endpoint

- endpoint kindごとに実行用接続フィールドは一つだけを正本とする。
- `azure`は`endpoint`、`openai` / `openai-compatible` / `local`は`baseUrl`、`bedrock`は`region`、`codex`はCodex runtime設定を使用する。
- 非canonicalフィールドをfallbackとして読まない。
- Health、readiness、structured output、Native tool callingは同じpure resolverからtargetを取得する。
- URL join、末尾slash、API version、deployment / model pathの構築をprovider adapterごとに重複させない。
- API key、credential、URL queryをevent、digest、UI errorへ出さない。

### 5.2 Settings migration

- migrationはidempotentで、複数回の読込・保存で値が変化しない。
- canonicalフィールドが空で旧フィールドだけに値がある場合は、同じkindのcanonicalフィールドへ一度だけ移す。
- canonicalフィールドと旧フィールドが異なる場合は、現在のkindでUI表示されるcanonicalフィールドを採用する。
- conflictはsecretを含まないdiagnostic codeとendpoint IDで記録する。
- kind変更時は、遷移先kindと互換性のない接続フィールドを保存前に空にする。
- role routeが参照するendpoint IDとmodelはmigration後も維持する。

### 5.3 Role routing

- Plan Mode gateは`evaluation`、Questionnaireとdirect Plan Runは`plan`、実装Runは`implementation`を使用する。
- route overrideがある場合も、呼び出しのsemantic roleを失わない。
- Native API runnerはactive roleを引数として受け取り、内部でroleを再推測または固定しない。
- active roleがCodex laneだけを指す場合、Native API runnerへ暗黙fallbackせず、構造化されたlane/route conflictを返す。
- role route変更は次の新規Runから適用し、進行中Runへ暗黙反映しない。

### 5.4 Run route snapshot

- Run開始時にactive role、primary/fallback target、endpoint ID、model、thinking depth、settings revision、endpoint revision、route digestを保存する。
- snapshotはactive role固有の候補だけを含む。全roleのrouteを許可集合にしない。
- provider credentialはsnapshotへ平文保存せず、server-side credential refとrevisionを検証して取得する。
- resumeと各turnは同じroute snapshotを使用する。
- endpointが削除、無効化、credential失効した場合は別roleへ漂流せず、typed failureとrecovery evidenceを返す。

### 5.5 Plan Mode

- Workbench Plan Modeは次の二段階として表示する。
  1. Evaluation roleによるPlan Mode gate
  2. Plan roleによるDesign Questionnaire生成
- Workbench Plan ModeではQuestionnaireが正本であり、Questionnaire生成前にCoding Agent Task Runを作成しない。
- direct Plan Runは明示commandだけから開始し、`planModeRequested=true`、active role=`plan`を保存する。
- direct Plan Runは単一Coding Agent runtimeを使用し、新しいruntime kindを作らない。
- direct Plan promptにはImplementation用preambleを入れず、変更前Fact、対象・非対象、実装順、検証、完了条件を含むImplementation Planを成果物とする。
- Questionnaire完了後またはdirect Plan完了後のImplementation Runは、人間またはMission Pilotの明示actionから開始する。

### 5.6 Provider failure

- provider adapterはgeneric messageではなくtyped failureを返す。
- 最低限、`connection`、`timeout`、`authentication`、`authorization`、`rate_limited`、`http_status`、`invalid_response`、`schema_invalid`、`cancelled`を区別する。
- failureは`retryable`、provider ID、endpoint ID、model、HTTP status、raw provider body refを保持する。
- retryは`retryable=true`の一時障害だけを対象にし、回数上限、timeout、AbortSignalを維持する。
- error messageのregex / keywordによるretry判定を削除する。
- parseまたはschema検証に失敗してもprovider本文を保持し、固定文へ差し替えない。

### 5.7 Observability

- UIと永続eventから少なくとも`request_started`、`route_selected`、`retry_scheduled`、`response_started`、`response_finished`、`request_failed`を追跡できる。
- Workbench Plan Modeでは現在のphaseを`evaluation`または`plan_generation`として表示する。
- request failureにはsemantic role、route source、endpoint ID、model、failure kind、retryable、durationを含める。
- provider URL、API key、authorization header、raw secretを含めない。
- 非stream providerでも開始と失敗が表示され、deltaの有無を進行開始の判定に使わない。
- Native API runnerはterminal turn eventを必ず一度記録する。

### 5.8 Role module境界

- Coding Agent固有のruntime、route snapshot、provider request adapterは`api/modules/codingAgent`が所有する。
- WorkbenchはCoding Agentの公開application commandとevent contractだけを利用する。
- Settingsは保存・正規化を所有し、Coding Agentのrole判断を持たない。
- `api/services/structured-llm`にはprovider呼び出し、target解決、JSON抽出、schema検証、typed failure、最小互換正規化だけを置く。
- System Context source、binding、生成catalogは`api/systemContexts`へ一元化する。
- Mission PilotとCoding Agentのroute、service、repository、内部実装を相互importまたはre-exportしない。

## 6. 採用設計

### 6.1 Provider target resolver

接続先解決を一つのpure contractへ集約する。

```ts
type ResolvedStructuredProviderTarget = {
	providerEndpointId: string;
	kind: "azure" | "openai" | "openai-compatible" | "local" | "bedrock" | "codex";
	providerId: string;
	modelOrDeployment: string | null;
	requestTarget: string | null;
	region: string | null;
	apiVersion: string | null;
	configurationRevision: string;
	targetDigest: string;
};
```

- resolverはcanonical field以外を読まない。
- `requestTarget`はprovider requestが使う最終targetを返すが、credential queryは含めない。
- traceとsnapshotでは`requestTarget`そのものではなく、redacted originまたは`targetDigest`を使用する。
- Healthと実行経路はresolverの結果を受け取り、独自に`endpoint || baseUrl`を行わない。

### 6.2 接続確認と実行readinessの分離

Settingsの確認結果を次の二種類に分ける。

1. `connectivity`: canonical targetへ到達できるか。local providerの`/health`などは補助情報として扱う。
2. `execution_readiness`: 選択model、同じprovider adapter、structured responseまたはtool schemaを使った最小requestが成功するか。

`execution_readiness`はprovider利用料が発生し得るため、Settings上の明示操作からだけ実行する。Run開始時に暗黙のprobeを追加しない。Run開始時は保存済みreadinessのtarget digestとrevisionが一致する場合だけ参考にし、不一致なら通常requestの開始・失敗を即座に可視化する。

### 6.3 Active route snapshot

```ts
type CodingAgentActiveRouteSnapshot = {
	version: 1;
	role: "plan" | "evaluation" | "implementation";
	lane: "native-api-runner" | "codex-sdk";
	settingsRevision: string;
	primary: ResolvedRouteCandidate;
	fallbacks: ResolvedRouteCandidate[];
	createdAt: string;
	digest: string;
};
```

- Evaluation gateはRun前のintake snapshotとして、Task messageまたはintake decision recordへ保存する。
- Coding Agent RunはRun context snapshotへ保存する。
- runtime registryはsnapshot全体ではなくactive roleとactive candidatesをNative API runnerへ渡す。
- request adapterは渡されたcandidateを実行し、global role settingsを再解決しない。
- credential取得時だけendpoint IDとrevisionをserver-side settingsへ照合する。

### 6.4 Plan Mode public contract

名称と成果物を次に固定する。

| Entry | LLM role | Run作成 | 成果物 |
| --- | --- | --- | --- |
| Workbench Plan gate | Evaluation | なし | `plan_mode` / `coding_agent` decision |
| Workbench Plan generation | Plan | なし | Design Questionnaire |
| Direct Plan Run | Plan | あり | Implementation Plan |
| Implementation Run | Implementation | あり | repository変更と検証結果 |

Workbenchのsystem message、activity event、UI labelもこの名称へ揃える。Evaluation gateを「Plan providerによる思考」と誤表示しない。

### 6.5 Typed provider failure

既存のNative tool requestで利用しているtyped failureの考え方をstructured generationへも適用し、providerごとのSDK errorを境界で正規化する。

```ts
type StructuredProviderFailure = {
	kind:
		| "connection"
		| "timeout"
		| "authentication"
		| "authorization"
		| "rate_limited"
		| "http_status"
		| "invalid_response"
		| "schema_invalid"
		| "cancelled";
	retryable: boolean;
	providerId: string;
	providerEndpointId: string | null;
	model: string | null;
	status: number | null;
	message: string;
	rawBodyRef: string | null;
	causeCode: string | null;
};
```

SDKのclass、status、error code、AbortSignalなどの構造情報だけで分類する。未知のerrorは`retryable=false`とし、本文を保持したまま上位へ返す。

## 7. 実装フェーズ

各Phaseは依存関係順である。production変更前に失敗fixtureを固定し、Phaseごとに対象testをgreenへ戻してから次へ進む。

### Phase 0: Baselineと失敗fixtureの固定

#### 実装

1. local endpointに異なる`baseUrl`と`endpoint`を持たせるfixtureを追加する。
2. Healthは成功するがprovider requestが別targetへ向かう現状を失敗testとして固定する。
3. Plan roleをAPI、Implementation roleをCodexにしたroute fixtureを追加する。
4. `planModeRequested=true`でもNative requestがImplementation routeを読む現状を固定する。
5. direct Plan Runのuser promptにImplementation preambleが混入するfixtureを追加する。
6. Workbench providerがrequest開始直後に失敗し、UI activityへ開始・失敗が届かないfixtureを追加する。
7. current settings、route digest、trace、targeted test、typecheck、architecture checkのbaselineをsecretなしで記録する。

#### 主な対象

- `tests/structured-llm/role-routing.test.ts`
- `tests/native-api-runner-routing-coverage.test.ts`
- `tests/runtime-routing-extra-coverage.test.ts`
- `tests/nightworkers-workbench-message-service-extra-coverage.test.ts`
- 新規endpoint normalization / readiness test

#### 受け入れ条件

- 各fixtureが接続先不一致、role喪失、prompt矛盾、event欠落の別原因として失敗する。
- 実provider credentialを使わずdeterministicに再現できる。
- 既存dirty worktree由来の失敗と本計画fixtureの失敗を区別できる。

### Phase 1: Endpoint正規化とSettings migration

#### 実装

1. `llmProviderEndpointSchema`の互換入力を維持しつつ、保存前にkind別canonical endpointへ正規化する。
2. `normalizeProviderEndpoints`とduplicate merge後に、非canonicalフィールドを除去する。
3. 旧値だけが存在する場合の一方向migrationを追加する。
4. canonical / legacy conflictではcanonical値を採用し、redacted diagnosticを残す。
5. Settings UIのkind変更をfield単位patchではなく、serverと共有するcanonical update関数へ接続する。
6. Azure、OpenAI compatible、local、Bedrock、Codex間の往復変更testを追加する。
7. role route、model list、capability metadataがmigrationで失われないことを検証する。

#### 主な対象

- `api/modules/settings/domain/llm-settings-contract.ts`
- `api/modules/settings/domain/llm-settings-normalization.ts`
- `api/services/structured-llm/endpoint-id-migration.ts`
- `src/modules/settings/SettingsLlmProviderEndpoints.tsx`
- Settings API contract tests

#### 受け入れ条件

- local / OpenAI compatibleの実行時に旧`endpoint`が参照されない。
- 現在再現しているconflict設定は`baseUrl`を正本として一度だけmigrationされる。
- kind変更後、UIに見えない接続先がruntimeで使用されない。
- migrationを二回実行してもsettings digestが変わらない。
- API keyと既存role routeを失わない。

### Phase 2: 共通target resolverとreadiness

#### 実装

1. kind別の`ResolvedStructuredProviderTarget`を生成するpure resolverを追加する。
2. structured request、provider health、Native API requestをresolverへ接続する。
3. providerごとのURL joinを一箇所へ集約し、Azure deployment / api-versionとOpenAI-compatible `/chat/completions`をtestする。
4. connectivityとexecution readinessを別resultとして返す。
5. execution readinessをSettingsの明示操作へ接続し、選択modelと最低限のstructured/tool capabilityを確認する。
6. readiness resultにtarget digest、endpoint revision、checkedAtを保存する。
7. URLとcredentialをredactしたfailure detailを返す。

#### 主な対象

- `api/services/structured-llm/request.ts`
- `api/services/structured-llm/provider-health.ts`
- `api/services/structured-llm/providers.ts`
- `api/services/structured-llm/openai-provider.ts`
- `api/services/structured-llm/azure-provider.ts`
- 新規pure target resolver
- Settings health/readiness routes and UI

#### 受け入れ条件

- Healthとprovider requestが同じtarget digestを報告する。
- `/health`成功だけで`execution_readiness=true`にならない。
- Settingsで成功したexecution readinessと同じ設定による最小runtime requestが成功する。
- targetが異なる場合はRun開始前または最初のrequestで明示的にstaleと分かる。

### Phase 3: Active roleとRun route snapshot

#### 実装

1. Native API request builderの`implementation`固定を削除する。
2. Run runtime contextで解決したactive roleをregistry、runner、request adapterまで必須引数として渡す。
3. Run開始時にactive role固有のprimary / fallback candidateをsnapshot化する。
4. route guardを全role集合からactive snapshotだけの照合へ変更する。
5. 各turnのglobal settings再解決を廃止し、snapshot candidateを使用する。
6. credential取得時にendpoint IDとrevisionを照合し、不一致をtyped conflictにする。
7. resume時に同じsnapshot digestが維持されることを検証する。
8. Plan=API、Implementation=Codexとその逆のmatrix testを追加する。

#### 主な対象

- `api/modules/nightworkers/run-orchestration/start-task-run-runtime-context.ts`
- `api/modules/codingAgent/runtime/registry.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-request-adapter.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-runner-routing.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-run-coordinator.ts`
- Run context / routing schema and tests

#### 受け入れ条件

- `planModeRequested=true`のNative API requestはPlan routeだけを使用する。
- Implementation RunはImplementation routeだけを使用する。
- active roleのlaneとrunnerが不一致ならprovider call前にtyped conflictとなる。
- Run中にSettingsを変更しても、別roleまたは別endpointへroute driftしない。
- resume前後でrole、candidate、settings revision、route digestが一致する。

### Phase 4: Plan Mode契約とprompt整合

#### 実装

1. Workbench Plan gate、Questionnaire、direct Plan Run、Implementation Runの名称とevent payloadを表6.4へ揃える。
2. Evaluation gateのrequest開始をUIに表示し、Plan role requestと区別する。
3. `plan_mode`選択後のQuestionnaire生成がPlan roleを使用していることをroute snapshotで記録する。
4. direct Plan Runの明示application commandとcallerを確定し、`planModeRequested=true`をproduction経路から到達可能にする。
5. `buildLatestRuntimeUserMessage`をPlan / Implementationで分岐し、Plan RunからImplementation preambleを除く。
6. direct Plan System ContextとImplementation Plan成果物schema / message contractを整合させる。
7. Plan Run完了後にrepository source hashが開始時から変わっていないことをevidenceとして表示する。HostはTask意味から変更可否を推測せず、Plan Runの明示contractとの構造差として扱う。
8. Implementation開始は明示actionを要求し、Plan完了から暗黙遷移しない。

#### 主な対象

- `api/modules/codingAgent/intake/plan-mode-gate.ts`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.workbench-plan-intake.service.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run-entry.ts`
- `api/modules/nightworkers/run-orchestration/runtime-routing.ts`
- `api/systemContexts/contexts/codingAgent/direct-plan-mode.context.toml`
- Plan Mode UI and integration tests

#### 受け入れ条件

- Workbench Plan ModeでEvaluation request開始、Plan request開始、Questionnaire readyを順に追跡できる。
- Evaluation routeだけを変更した場合はgate、Plan routeだけを変更した場合はQuestionnaire / direct Plan Runへ反映される。
- direct Plan Runがproduction entryから開始でき、Run snapshotはactive role=`plan`となる。
- direct Plan promptに「Plan Modeは終了した」という文言が含まれない。
- Plan完了後にImplementation Runが自動開始されない。

### Phase 5: Typed failureとretry/fallback

#### 実装

1. provider共通の`StructuredProviderFailure`とconstructor / type guardを追加する。
2. OpenAI、Azure、Bedrock、Codex adapterでSDK class、HTTP status、AbortSignalからtyped failureへ変換する。
3. generic HTTP `Error`とmessage regexによるtransient判定を削除する。
4. route fallbackはtyped failureと明示policyだけを判断材料にする。
5. retryable failureだけを既存上限内でretryし、AbortSignalで停止できることを検証する。
6. raw provider bodyを本文とは別のbounded evidence refとして保持する。
7. JSON抽出、schema validation failureでもprovider本文をresult / traceへ保持する。

#### 主な対象

- `api/services/structured-llm/route-fallback.ts`
- `api/services/structured-llm/openai-provider.ts`
- `api/services/structured-llm/azure-provider.ts`
- `api/services/structured-llm/providers.ts`
- provider failure contract and tests

#### 受け入れ条件

- connection、timeout、401/403、429、5xx、invalid JSON、schema failureを型で識別できる。
- error messageの文言変更でretry可否が変わらない。
- retry不能failureを再試行しない。
- provider本文とraw evidence refがparse failure後も取得できる。
- retry回数と停止手段がtestで確認できる。

### Phase 6: Realtime observabilityとユーザー表示

#### 実装

1. Workbench emitterがrequest開始、route選択、response開始、失敗、終了をactivityへ変換する。
2. `request_failed`をstructured LLM debug eventとCoding Agent ledgerの共通contractへ追加する。
3. Native API runnerの各provider attemptとterminal turnを必ずevent化する。
4. UIにphase、role、endpoint display name、model、経過時間、failure kindを表示する。
5. 非stream responseではdeltaがなくてもpending / running状態を維持する。
6. user-facing failureから復旧可能な次の確認対象を示すが、固定された次actionやprovider切替を強制しない。
7. log / event redaction testを追加する。

#### 主な対象

- `api/services/structured-llm/types.ts`
- `api/services/structured-llm/index.ts`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.activity.repository.ts`
- `api/modules/codingAgent/runtime/ledger-sink.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-provider-attempts.ts`
- Workbench timeline / activity UI

#### 受け入れ条件

- 接続拒否でもrequest開始からfailureまでがUIへ表示される。
- Run作成前のEvaluation gate failureとRun内provider failureを区別できる。
- 非stream local providerでも無反応表示にならない。
- endpoint URL、API key、authorization情報がevent payloadとsnapshotへ出ない。
- terminal turn eventが重複せず一度だけ保存される。

### Phase 7: 統合回帰とcanary

#### Deterministic integration scenarios

1. Azureからlocalへkind変更し、旧Azure endpointが非表示・非実行になる。
2. local endpointで`baseUrl`と旧`endpoint`が競合し、canonical migration後にHealthとrequestのtarget digestが一致する。
3. Evaluation=API、Plan=別API、Implementation=Codexとして、Workbench Plan gateとQuestionnaireが各role routeを使用する。
4. Plan=API、Implementation=Codexとしてdirect Plan Runを開始し、Plan routeだけが使用される。
5. Run開始後にrole settingsを変更し、進行中Runがsnapshot routeを維持する。
6. connection failure、429、401、invalid JSON、schema mismatchでtyped failure、retry、本文保持を検証する。
7. request直後に失敗する非stream providerで、UIがstarted / failedを表示する。

#### Credentialed canary

1. localまたはOpenAI-compatible providerをEvaluation / Planへ設定する。
2. Codexまたは別API providerをImplementationへ設定し、roleを意図的に分離する。
3. Settingsのexecution readinessを実行し、target digestとmodelを記録する。
4. WorkbenchからPlan Mode gateとQuestionnaire生成を3回連続で成功させる。
5. direct Plan Runを3回連続で成功させ、repository source hash不変とImplementation Plan生成を確認する。
6. Implementation Runを3回連続で成功させ、Plan routeへdriftしないことを確認する。
7. 一度だけ到達不能targetを使い、started / failedの表示とnon-retryableまたはbounded retryを確認する。

#### Rollout gate

- deterministic integrationが全件greenである。
- credentialed canaryの各scenarioが3回連続で成功する。
- route snapshot、event、traceにsecretが含まれない。
- provider error rate、route fallback count、Plan gate durationをcanary前後で比較できる。
- regression時は新しいRun開始を止め、進行中Runのsnapshotを保持したまま旧実装へ戻せる。

## 8. Test Matrix

| Layer | Case | Expected |
| --- | --- | --- |
| Settings unit | Azure → local | `endpoint`を実行に使わず`baseUrl`だけを保存 |
| Settings unit | local conflict | visible canonical fieldを採用、diagnosticを記録 |
| Resolver unit | base URL末尾slash | chat completions targetを一意に生成 |
| Resolver unit | Azure deployment | endpoint、deployment、api-versionを一意に生成 |
| Readiness integration | `/health`のみ成功 | connectivity=true、execution readiness=false |
| Routing unit | activeRole=plan | Plan candidateだけを返す |
| Routing unit | Plan=API / Implementation=Codex | Native Plan request成功、Implementation candidateを読まない |
| Snapshot integration | settings変更 | active Runのroute digest不変 |
| Resume integration | process restart | 同じrole / route snapshotで再開 |
| Plan integration | Workbench Plan | Evaluation → Plan → Questionnaire ready |
| Plan integration | direct Plan | Plan role、Implementation preambleなし |
| Failure unit | 429 | typed、retryable、bounded retry |
| Failure unit | 401 | typed、non-retryable、本文保持 |
| Failure unit | schema invalid | returned body保持、fixed bodyへ差し替えない |
| Realtime integration | immediate connection failure | startedとfailedが順番に表示 |
| Redaction | trace / event / snapshot | credentialとraw URL queryを含まない |

## 9. Verification Commands

実装中はPhaseごとのtargeted testを先に実行し、最終的に次を実行する。

```bash
bun run typecheck
bun run check:architecture
bun run test
bun run verify
```

System Context TOMLを変更した場合は、`spec/s11t-coding-agent-guide.md`に従い、sourceと生成物を同じ変更で扱う。

```bash
bun run s11tnext:lint
bun run s11tnext:build
bun run s11tnext:check
```

生成済み`api/systemContexts/generated/catalog.json`と`catalog.generated.ts`を手編集しない。production codeから`s11tnext-cli`をimportしない。runtime / CLI dependency versionは本計画では変更しない。

既存dirty worktreeにより全体checkが失敗する場合は、失敗file、command、exit codeを記録し、本計画の変更によるfailureかを分離する。既存変更を削除、reset、上書きしてgreenにしない。

## 10. Definition of Done

次の全条件を満たした時だけ本計画を`implemented`へ更新する。

1. current conflict設定がcanonical migrationされ、Healthと実行のtarget digestが一致する。
2. provider / roleを変更しても、Evaluation、Plan、Implementationが各role routeを使用する。
3. Native API request adapterにImplementation roleの固定値が残っていない。
4. active Runがglobal settings変更で別routeへ漂流しない。
5. Workbench Plan ModeでEvaluation開始とPlan生成開始がUIから確認できる。
6. direct Plan Runがproduction entryから到達可能で、Implementation promptと矛盾しない。
7. provider failureのretry可否がtyped propertyだけで決まる。
8. provider本文がparse / schema failure後も保持される。
9. immediate provider failureが無反応にならず、role、endpoint ID、model、failure kindを確認できる。
10. endpoint、role、Plan、snapshot、failure、observabilityの回帰testがgreenである。
11. `typecheck`、`check:architecture`、全test、`verify`が成功するか、既存dirty worktree由来のfailureが本件外として証拠化されている。
12. S11t TOML変更時はlint、build、stale checkが成功し、生成catalogがsourceと一致する。
13. role分離したcredentialed canaryが各scenarioで3回連続成功する。
14. 実装結果、未解決事項、検証結果、canary結果を本書のStatusへ追記する。

## 11. 実装時の禁止事項

- `endpoint || baseUrl`または`baseUrl || endpoint`という互換fallbackを別箇所へ移して残さない。
- providerやroleの意味をuser message、error message、model名のkeywordで判定しない。
- Native API runner専用の固定workflow、Plan runtime、tool allowlistを新設しない。
- Run開始後にglobal role routeを再解決しない。
- Health 200を実行可能性の証拠にしない。
- provider failure本文を「接続に失敗しました」などの固定本文だけへ置換しない。
- parse failureを理由にprovider raw bodyを破棄しない。
- observabilityのためにcredential、raw authorization、secret付きURLを保存しない。
- HostがPlan完了、Todo、次action、実装完了を暗黙更新しない。
- Mission PilotとCoding Agentのrole module境界を迂回しない。
- 既存dirty worktreeをreset、削除、上書きして検証環境を作らない。

## 12. Implementation Record

2026-08-09にPhase 0からPhase 6のcore implementationとdeterministic regressionを実施した。

- kind別endpoint canonicalizationを追加し、local / OpenAI-compatibleは`baseUrl`、Azureは`endpoint`を実行時の正本へ統一した。
- Settingsの明示確認をChat Completions実行readinessへ変更し、tool schema、JSON response、message choiceまで検証してmodelとsecret-free target digestを返すようにした。Run開始時の暗黙probeと旧環境フラグ経路は削除した。
- Native API runnerの`implementation` role固定を削除し、Runへ保存したactive roleとsettings revisionでprovider call前にrouteをfail-close検証するようにした。保存role planまたは現在revisionが欠落した場合もprovider callを開始しない。
- 同じRunの再開時は保存済みrole、route、settings revision、runtime laneを現在の解決結果と照合し、不一致なら新規Runを要求する。再開用contextで保存済みroute snapshotを上書きしない。
- Workbench commandとCoding Agent application commandからdirect Plan Runを明示開始できるようにし、Plan promptからImplementation preambleを除外した。
- HTTP、transport、timeout、authentication、permission、invalid responseをtyped failureへ正規化し、retry / fallbackを`retryable`だけで判断するようにした。
- provider HTTP / invalid JSON本文はbounded `providerBody`として保持し、log/event messageへ混入させないようにした。
- WorkbenchとNative API ledgerへ`model.request_failed`を追加し、phase、role、endpoint、model、target digest、failure kindを追跡可能にした。観測eventの永続化はprovider requestをblockしないqueueへ送り、Native turnは`turn_finished`を一度だけ記録する。
- Structured / Nativeの空provider応答はnon-retryable failureとして終了し、完了turn扱いや無制限の次turn生成を行わない。
- deterministic targeted regression、typecheck、lint、architecture check、S11t stale check、base verification、および全524 test file・4,143 testは成功した。

未完了は実credentialを用いるcanaryだけである。Evaluation、Plan、Implementationを別routeへ割り当てた3回連続実行は、利用可能なcredentialと対象endpointを持つ環境でPhase 7の手順に従って行う。
