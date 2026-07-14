# LLM Semantic Freedom Boundary Refactor 実装計画

## Status

- Plan status: `completed-archived`
- Document created: 2026-07-14
- Implementation completed: 2026-07-14
- Archived: 2026-07-14
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Primary target span:
  - Mission Pilot Plan Artifact generation / self-review
  - Mock Blueprint generation
  - `structured-llm` provider boundary
  - LLM raw response persistence / display
- 実装開始前から存在した次の dirty changes は破棄せず、意図を保持したまま Fact validation / repair workflow へ移行した。
  - `api/modules/missionPilot/mission-pilot-plan-review.service.ts`
  - `shared/schemas/mission-pilot-plan-review.schema.ts`
  - `tests/mission-pilot-plan-coordinator.test.ts`
  - `tests/mission-pilot-plan-pipeline.test.ts`

この文書を、特定の要件や過去の失敗例に寄った補正ロジックを排除し、LLM の semantic decision を実装側が上書きしないための実装正本とする。

本計画の原則は次の一文に集約する。

> LLM は意味を決める。実装は envelope、Fact、state transition、side effect の成立性だけを検証し、LLM の意味を推測・補完・置換しない。

## 1. Triggering Incident と確認済み Fact

### 1.1 Mock Blueprint JSON failure

2026-07-14 の Mission Pilot 実行で、Mock Blueprint LLM は約 3,110 文字の本文を返した。本文は空ではなく、ほぼ完全な Mock Blueprint JSON だったが、次の一箇所で引用符が欠けていた。

```text
"required:false
```

結果:

- `JSON.parse()` は失敗した。
- 共通 `jsonrepair` でも修復できなかった。
- `mission_pilot_steps.blueprint` は `failed / attempt=1` になった。
- `mission_pilot_sessions` は `attention / stopped` になった。
- 利用者には LLM 本文ではなく、実装固定文 `Mock Blueprint LLM output did not contain valid JSON.` が主な停止理由として表示された。
- raw 本文は `task_messages` に保存されたが、`mock_blueprint_raw_output` intent により通常表示から除外された。

### 1.2 Plan review source ID failure

Mission Pilot plan review では、LLM が返した `sourceMessageId` の一文字違いにより review が停止した。直前の修正では、Artifact kind が一意なら実装側が current Artifact ID へ置き換える補正を追加した。

この補正は停止回避には有効だが、次の問題を持つ。

- LLM が実際に返した参照を別の参照へ書き換える。
- Artifact kind が一意であることを、LLM の意図が一意であることと同一視する。
- stale ID、転記ミス、別Artifact参照の区別を実装側が推測する。
- raw response、validation failure、adopted response の関係が利用者から見えにくい。

### 1.3 Existing semantic mutation

`normalizeMissionPilotPlanReview()` は schema compatibility normalization を越えて、現在次の意味変更を行う。

- `sourceMessageId` / `sourceId` の推測置換。
- concept Artifact の `blocking` finding を `warning` へ変更。
- `revisionTargets` の削除・重複排除。
- LLM の `verdict` を `pass` または `revise` へ再計算。

Mock Blueprint normalizer は現在次の意味内容を生成・変更する。

- 欠けた `meta.intent`、`selectionReason`、section type の生成。
- dataset kind の別 kind への変更。
- table row を 5 件まで生成。
- form field、cards、timeline、chat、metrics 等の件数補完。
- article body を 180 文字以上へ水増し。
- LLM が選んでいない `CardGridSection` fallback の生成。
- title、description、action label、sample value の固定文補完。

これらは構文修復ではなく、生成物の意味内容を実装側が作っている。

### 1.4 Provider-specific product knowledge

Codex provider は `schemaName` が次の値かどうかで `outputSchema` を外す。

- `app_blueprint`
- `app_blueprint_data_design`
- `mock_blueprint`

このため provider 層が product artifact 名を知っている。今回の実行も native structured output ではなく `prompt_validated_json` で実行された。

schema を外したことだけを JSON typo の直接原因とは断定しない。ただし product 名で transport behavior を変える構造は provider の責務境界に反する。

## 2. Problem Statement

現在の実装は、LLM failure を安全に扱うための validation と、LLM の判断を実装側で変更する semantic mutation が混在している。

その結果、次の問題が起きる。

1. LLM が何を返したかと、保存・実行された内容が一致しない。
2. 過去の一事例を直すための補正が、別domain・別Artifactにも適用される。
3. prompt と実装ロジックの両方に同じpolicyが書かれ、どちらが正本か分からない。
4. provider が product schema 名を知り、用途別の挙動を持つ。
5. parse/schema failure 時に raw response が固定エラーへ置換され、利用者が事実を確認できない。
6. retry limit が存在しても、一回目の parse failure で `stopped` になり、修復機会が workflow として表現されない。
7. LLM 出力の品質問題と、NightWorkers の state / Queue safety 問題が同じ例外文字列で扱われる。

## 3. Design Principle

### 3.1 LLM に残す判断

次は semantic decision であり、実装側で上書きしない。

- Plan review の `verdict`。
- finding の `severity`。
- どの Artifact を修正対象にするか。
- correction instruction の意味内容。
- Mock Blueprint の screen、section、layout、dataset kind。
- Mock Blueprint に表示する title、copy、row、field、article body。
- Artifact の品質評価、設計上の優先順位、warning の内容。
- user request、Questionnaire、Project Context の意味解釈。

### 3.2 実装側で厳格にする境界

次は deterministic boundary であり、実装側で検証する。

- JSON としてparseできるか。
- runtime schemaを満たすか。
- required field、enum、array/object shapeが正しいか。
- `sourceMessageId` が対象Taskに実在するか。
- `artifactKind` と参照先message metadataが一致するか。
- 同じArtifactを重複採点していないか。
- review response内部の参照関係が自己矛盾していないか。
- session version、context revision/digest、routing revisionがcurrentか。
- Queue admission、lease、CAS、idempotency、freeze boundaryが成立するか。
- retry上限、停止、再開、side effect完了が永続化されているか。

### 3.3 許可する compatibility normalization

許可するのは、意味内容を増減しない変換だけとする。

- surrounding code fenceからJSON candidateを抽出する。
- object/arrayの前後にある説明文からbalanced JSONを抽出する。
- `jsonrepair`による引用符、comma、brace等の構文修復。
- providerが返した標準wrapperから本文を取り出す。
- version付きlegacy contractで明文化された、一対一かつlosslessなfield alias移行。

すべての修復で raw text を保持し、`repairKind` と修復後textを記録する。

### 3.4 禁止する normalization

- 欠けた意味内容を固定文で生成する。
- 配列件数を満たすためにrow、card、field、message等を生成する。
- LLMが返したIDを別IDへ推測置換する。
- severity、verdict、targetを実装側で変更する。
- invalid targetを黙って削除する。
- Artifact kindやuser keywordからdomain semanticsを決める。
- parse/schema failureを固定エラー本文へ置換する。
- raw responseを保存しながら利用者表示から完全に隠す。

## 4. Goals

1. LLM raw response、修復response、採用responseを区別して永続化・表示する。
2. parse/schema/Fact validation failureをtyped resultとして返し、固定エラーへの置換をなくす。
3. semantic mutationを行うnormalizerを削除し、validatorへ置き換える。
4. invalid responseは実装側で意味補完せず、workflow-managed LLM repairへ戻す。
5. repair LLMにはraw response、validation issue、同じcontractを渡し、意味を維持したcontract修復だけを依頼する。
6. Mission Pilot plan reviewのverdict、severity、targetsをLLM responseどおり保持する。
7. Mock Blueprintのscreen、section、copy、datasetをLLM responseどおり保持する。
8. provider adapterからproduct schema名と用途別判断を除去する。
9. runtime schema、provider schema、prompt output requirementを一つのcontract factoryから供給する。
10. user文言のkeyword/regex分類を追加しない。
11. parse failureで即時停止せず、共通のbounded repair attemptを実行する。
12. repair失敗後のattentionでも、raw本文と各validation issueを利用者が確認できる。
13. Queue、Context、revision、lease、idempotencyの既存安全性を弱めない。
14. 既存21箇所の`callStructuredJsonLLM()`利用を監査し、同じ境界へ段階移行する。

## 5. Non-goals

- LLM出力を無条件に受理すること。
- invalid JSONや存在しない参照でside effectを実行すること。
- Queue admission条件をLLM判断だけにすること。
- Mission PilotのPlay/Stop境界を撤廃すること。
- retryを無制限にすること。
- provider fallbackをschema failureの意味修正として使うこと。
- user promptからdomainを判定するclassifierを追加すること。
- Blueprint rendererの全面再設計。
- Questionnaire、Feature Plan、Plan Artifactのproduct ontology全面変更。
- repository sourceをPlan pipelineから直接編集すること。
- LLM本文とsystem diagnosticを同じmessageとして混ぜること。

## 6. Locked Decisions

### 6.1 Raw response is immutable evidence

1. providerから受け取ったraw textはimmutable evidenceとして保持する。
2. parse/schema failureでもraw textを捨てない。
3. repaired textはraw textを上書きせず、別attemptとして保持する。
4. adopted resultはどのraw/repaired attemptから採用されたかを参照する。
5. fixed diagnosticはraw本文とは別eventとして表示できる。
6. fixed diagnosticをLLM本文の代替にはしない。

### 6.2 Validation never mutates semantics

1. validatorは`success`またはtyped issuesを返す。
2. validatorは入力objectを書き換えない。
3. unknown field削除、default挿入、target filteringをvalidation成功条件に使わない。
4. Zod `.default()`で意味fieldを自動挿入しない。互換上必要なdefaultはcontract version migrationとして分離する。
5. invalid responseはrepair workflowまたはattentionへ進める。

### 6.3 Repair is a workflow decision

1. parse/schema/Fact validation failureはtransport failureと区別する。
2. transport failureだけがprovider route fallback候補になる。
3. validation failureは同じworkflow内のstructured-output repair stepへ渡す。
4. repair promptは日本語で、共通builderから生成する。
5. repair promptにdomain-specific fallback contentを入れない。
6. repairは元のsemantic decisionを維持し、contract違反だけを直すよう要求する。
7. initial responseとrepair responseを合わせた上限を共通定数で管理する。
8. 上限到達後だけMission Pilotを`attention / stopped`へ遷移させる。

### 6.4 Provider is product-agnostic

1. provider adapterはprovider API call、response extraction、usage、provider session、transport diagnosticsを担当する。
2. structured-llm boundaryはJSON extraction、schema validation、最小限のsyntax repairを担当する。
3. provider adapterは`mock_blueprint`、`feature_plan`等のproduct schema名で分岐しない。
4. native structured output可否はprovider capabilityとschema featureから判断する。
5. schema feature判定はsize、unsupported keyword、root type等のgeneric diagnosticsを返す。
6. prompt-only JSON modeでも受信後runtime validationを必須にする。

### 6.5 Prompt gives workflow, not a hidden domain template

1. promptは役割、利用可能なFact、出力contract、禁止side effectを説明する。
2. user domainを特定製品へ誘導するscreen planやsample contentを埋め込まない。
3. BBS、thread、Todo、CRM等の個別domain例を一般promptの判断規則にしない。
4. section catalogとdataset contractは利用可能な選択肢として渡し、選択はLLMに任せる。
5. renderer safetyに必要なshapeと、品質の好みをschemaで混同しない。

## 7. Target Architecture

```text
Workflow / Artifact generator
  -> StructuredOutputContract<T>
  -> Provider-agnostic request
  -> Provider adapter
  -> immutable rawText
  -> syntax extraction / syntax repair
  -> runtime schema validation
  -> workflow Fact validation
       -> success: persist exact validated value and continue
       -> failure: persist raw + issues
                   -> bounded LLM repair step
                        -> success: persist repaired attempt and continue
                        -> exhausted: attention with raw evidence reference
```

責務境界:

```text
Provider adapter
  API call / transport / raw response / usage / provider diagnostics

Structured LLM boundary
  JSON extraction / syntax repair / runtime schema validation

Workflow
  prompt / available actions / Fact validation / retry policy / state transition

Domain service
  validated commandの実行 / CAS / lease / idempotency / side effect確認

UI
  raw response / validation diagnostic / adopted result / current stateの区別表示
```

## 8. Shared Contract Design

### 8.1 `StructuredOutputContract<T>`

候補配置:

- `api/services/structured-llm/contract.ts`

```ts
type StructuredOutputContract<T> = {
  name: string;
  runtimeSchema: z.ZodType<T>;
  providerJsonSchema: Record<string, unknown>;
  renderOutputRequirements: () => string;
};
```

Rules:

- `providerJsonSchema`は原則として`runtimeSchema`から生成する。
- provider互換のnormalizationは`normalizeStructuredOutputJsonSchema()`へ集約する。
- compact projectionが不可避な場合も、別の独立手書きcontractにはしない。
- compact projectionにはruntime schemaとのparity testを必須にする。
- prompt、provider call、runtime validation、repair promptは同じcontract instanceを使う。

### 8.2 `StructuredLlmResult<T>`

候補配置:

- `api/services/structured-llm/result.ts`

```ts
type StructuredLlmAttempt = {
  attempt: number;
  rawText: string;
  extractedText: string | null;
  repairedText: string | null;
  repairKind: JsonFixWrapperResult["repairKind"] | null;
  providerDebug: Record<string, unknown> | null;
};

type StructuredLlmIssue = {
  stage: "parse" | "schema" | "fact";
  path: Array<string | number>;
  code: string;
  message: string;
};

type StructuredLlmResult<T> =
  | {
      ok: true;
      value: T;
      attempt: StructuredLlmAttempt;
      issues: [];
    }
  | {
      ok: false;
      value: null;
      attempt: StructuredLlmAttempt;
      issues: StructuredLlmIssue[];
    };
```

Rules:

- failureでもraw textを必ず返す。
- parse failureをthrow-only contractにしない。
- transport failureはraw responseがないため例外または別resultとする。
- callerが固定messageだけを受け取るAPIを廃止する。

### 8.3 Workflow Fact validation

runtime schema validationとFact validationを分離する。

例:

- runtime schema: `sourceMessageId`はstring。
- Fact validation: そのIDがcurrent taskのcurrent Artifact messageとして存在する。

Fact validatorは次の形に統一する。

```ts
type FactValidationResult =
  | { ok: true }
  | { ok: false; issues: StructuredLlmIssue[] };
```

Fact validatorはcorrected valueを返さない。

## 9. Implementation Phases

### Phase 0: Baseline and semantic-mutation inventory

#### 0.1 Preserve current worktree

実装開始前に次を記録する。

```bash
git status --short
git diff -- api/modules/missionPilot/mission-pilot-plan-review.service.ts \
  shared/schemas/mission-pilot-plan-review.schema.ts \
  tests/mission-pilot-plan-coordinator.test.ts \
  tests/mission-pilot-plan-pipeline.test.ts
git log --oneline -5
```

現在のdirty changesを一括破棄しない。`sourceMessageId`補正部分は新しいFact validation / repair workflowへ置き換え、同時に追加された有効なvalidation testは意図を保って移植する。

#### 0.2 Capture runtime baseline

今回の失敗runについて次を保存・再現fixture化する。

- raw Mock Blueprint response。
- JSON parse position。
- `jsonrepair` failure。
- `mission_pilot_steps` attempt/status。
- `mission_pilot_sessions` desired_state/phase/error。
- raw output task messageとvisibility判定。

fixtureには実データのsecretを含めず、構文欠落を再現する最小化済みJSONを使う。

#### 0.3 Repository-wide audit

全`callStructuredJsonLLM()` callsiteを次の観点で分類する。

- raw textを保持しているか。
- parse/schema failureを固定文へ置換しているか。
- semantic normalizerがあるか。
- user keyword/regex classificationがあるか。
- provider schemaがruntime schemaと同じ正本か。
- repairをworkflowで行うか、実装側でcontent生成するか。

成果物として本書の実装notesにcallsite migration checklistを追記する。未監査callsiteを残したまま完了扱いにしない。

#### 0.4 Baseline tests

```bash
bunx vitest run \
  tests/structured-llm/services-structured-llm-01.test.ts \
  tests/structured-llm/services-structured-llm-03.test.ts \
  tests/structured-llm/codex-output-schema.test.ts \
  tests/mock-blueprint.test.ts \
  tests/mission-pilot-plan-pipeline.test.ts \
  tests/mission-pilot-plan-coordinator.test.ts \
  tests/pilot-thought-dock.test.tsx
```

既存failureがあれば変更前baselineとして記録し、対象外failureと対象failureを分離する。

### Phase 1: Introduce the non-mutating structured result boundary

対象:

- `api/services/structured-llm/types.ts`
- `api/services/structured-llm/index.ts`
- `api/services/structured-llm/json.ts`
- new `api/services/structured-llm/contract.ts`
- new `api/services/structured-llm/result.ts`

実装:

1. `StructuredOutputContract<T>`を追加する。
2. raw textとtyped validation resultを返す新APIを追加する。
3. JSON extraction / `jsonrepair`結果をattempt metadataへ残す。
4. Zod runtime schema validationを共通境界で実行する。
5. parse/schema failureをraw付きfailure resultとして返す。
6. transport failureとvalidation failureを別typeにする。
7. 既存`callStructuredJsonLLM()`はmigration中だけcompat wrapperとして残す。
8. `allowRawOutputOnJsonParseFailure`をdeprecatedにし、全callsite移行後に削除する。

完了条件:

- raw textなしのparse/schema errorが存在しない。
- validation failureでsemantic fieldが変更されない。
- direct JSON、fenced JSON、balanced JSON、jsonrepair、unrepairable JSONの全caseをtyped resultで表せる。
- provider adaptersは変更前と同じraw contentを返す。

### Phase 2: Remove product knowledge from provider adapters

対象:

- `api/services/structured-llm/codex-output-schema.ts`
- `api/services/structured-llm/codex-provider.ts`
- `api/services/structured-llm/model-capability.ts`
- `api/services/structured-llm/request.ts`
- relevant provider tests

実装:

1. `CODEX_PROMPT_VALIDATED_SCHEMA_NAMES`を削除する。
2. `schemaName`によるoutputSchema omitを削除する。
3. provider capabilityをproduct非依存のstructured output capabilityとして表現する。
4. schema feature inspectorを追加し、native structured output可否をgeneric reasonで返す。
5. native schemaを使わない場合も、reasonをtraceへ保存する。
6. prompt-only modeでもruntime schema validationを省略しない。
7. provider-specific fallbackはtransport/capability failureだけに限定する。

generic reason例:

- `schema_too_large`
- `unsupported_keyword`
- `unsupported_recursive_reference`
- `provider_native_schema_disabled`

禁止:

- `if (schemaName === "mock_blueprint")`
- Artifact名allowlist。
- user prompt内容によるprovider mode変更。

完了条件:

- provider testにproduct artifact名が登場しない。
- 同じschema featureはschema名が違っても同じtransport modeになる。
- actual provider debugにgeneric selection reasonが残る。

### Phase 3: Add workflow-managed structured-output repair

対象候補:

- new `api/services/structured-generation/structured-output-repair.service.ts`
- new `api/services/structured-generation/prompts/structured-output-repair.ts`
- `api/services/structured-llm/types.ts`
- Mission Pilot coordinator integration

共通repair input:

```ts
type StructuredOutputRepairInput<T> = {
  contract: StructuredOutputContract<T>;
  originalRawText: string;
  issues: StructuredLlmIssue[];
  role: StructuredLlmRole;
  taskId: string;
  trace: TraceProvenance;
};
```

repair prompt要件:

1. 元の回答の意味判断を維持する。
2. 指摘された構文・schema・Fact参照違反だけを修正する。
3. 新しいfeature、finding、screen、section、datasetを勝手に追加しない。
4. JSON objectだけを返す。
5. 元のraw text、validation issue、output contractを明示する。
6. domain-specific fallback例を含めない。

retry policy:

- initial responseとrepair responseを別attemptとして保存する。
- defaultはinitial 1回 + repair 1回とする。
- 上限は共通定数`STRUCTURED_OUTPUT_REPAIR_MAX_ATTEMPTS`で管理する。
- workflowがplayingで、Contextがcurrentの場合だけrepairする。
- Stop、Context revision change、lease loss時はrepair resultを採用しない。
- repair failure後だけ既存attention transitionへ進む。

完了条件:

- 今回の`"required:false` fixtureが、実装側のfixed substitutionではなくLLM repair attemptへ渡る。
- repair成功時はBlueprint step attemptを失敗終了させず続行する。
- repair失敗時はoriginal/repaired rawとissuesが両方残る。
- transport retryとvalidation repairがevent上で区別できる。

### Phase 4: Refactor Mission Pilot plan review to validation-only

対象:

- `api/modules/missionPilot/mission-pilot-plan-review.service.ts`
- `shared/schemas/mission-pilot-plan-review.schema.ts`
- new `api/modules/missionPilot/mission-pilot-plan-review-validation.ts`
- `api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts`
- `api/modules/missionPilot/mission-pilot-plan-progress.service.ts`
- relevant tests

実装:

1. `normalizeMissionPilotPlanReview()`からsemantic mutationを除去する。
2. `reconcileArtifactSourceMessageId()`を削除する。
3. concept Artifact findingのseverity書換えを削除する。
4. `revisionTargets` filteringを削除する。
5. verdict再計算を削除する。
6. schema parse後のvalueをLLM responseどおり保持する。
7. current Artifact inventoryからdynamic review contractを構築する。
8. `artifactKind + sourceMessageId`の組をFact validatorで検証する。
9. duplicate score、missing current score、unknown target、stale ID、cross-task IDをtyped issueにする。
10. response内部矛盾はinvalid responseとしてrepair workflowへ返す。

dynamic contractで制約してよいもの:

- current Artifact kind。
- current source message ID。
- correction可能なtarget。
- current routing revision。
- tool callのexpected revision。

dynamic contractで決めてはいけないもの:

- verdict。
- severity。
- score。
- correctionが必要かどうか。
- どのcurrent Artifactをtargetにするか。

prompt refactor:

- inline長文をprompt builderへ抽出する。
- common output requirementsはcontractからrenderする。
- Artifact typeごとの固定評価結果をpromptに埋め込まない。
- 各Artifactのpurpose、capability、current evidenceを入力Factとして渡す。
- LLMがそのFactからreview judgmentを返す。
- user文言のkeyword/regex分類を追加しない。

acceptance examples:

- LLMがconcept Artifactをblockingと判断した場合、実装側でwarningへ変更しない。
- LLMが`revise`を返し、targetがvalidならそのままcorrectionへ進む。
- LLMが存在しないIDを返した場合、current IDへ置換せずrepairへ進む。
- LLMが`pass`を返した場合、Queue gateはFact/revision条件を別途検証するがverdictを書き換えない。

### Phase 5: Remove semantic fabrication from Mock Blueprint

対象:

- `api/modules/blueprint/mock-blueprint-generation.service.ts`
- `api/modules/blueprint/mock-blueprint-parser.ts`
- `api/modules/blueprint/mock-blueprint-normalizer.ts`
- `api/modules/blueprint/mock-blueprint-dataset-normalizer.ts`
- `api/services/structured-generation/prompts/mock-blueprint.ts`
- `shared/schemas/mock-blueprint.schema.ts`
- `api/modules/blueprint/blueprint-generation.service.ts`
- renderer tests

#### 5.1 Replace normalizer with parser + validator

削除対象:

- missing metaの意味補完。
- fallback `CardGridSection`。
- dataset kindの推測変更。
- minimum row/card/field/message生成。
- article本文の水増し。
- 固定title、description、label、sample data生成。
- screen/sectionを別階層へ推測移動する処理。

残せる処理:

- JSON candidate extraction。
- syntax-only `jsonrepair`。
- documented legacy contractのlossless alias migration。
- rendererが受理するID character setのvalidation。

IDが不正な場合も別IDへ生成し直さず、validation issueとしてrepairへ返す。

#### 5.2 Simplify Mock Blueprint prompt

promptに残す:

- Mock Blueprintの目的。
- 利用可能なsection catalog。
- sectionごとに利用可能なdataset shape。
- runtime output contract。
- Task、Questionnaire、Project Context、Spec Context。
- product UIを生成し、NightWorkers内部画面を生成しないというproduct boundary。

削除・再評価する:

- thread / 投稿 / 掲示板のscreen構成例。
- CRUDならDataTable + Formという固定誘導。
- 特定sectionを使わないための長いdomain例。
- article 180文字以上。
- table 5 rows固定。
- sidebar名称や文字列によるlayout制御。
- ads/newsletter等、個別過去事例の列挙。

section選択品質はLLM review対象であり、application normalizerの補完対象にしない。

#### 5.3 Align runtime and provider schema

- `mockBlueprintSchema`を正本にする。
- provider schemaをruntime schemaから生成する。
- renderer safetyに不要なminimum countをschemaから除去する。
- rendererはempty arrayを安全に表示できるようにする。
- content quality minimumはschemaではなく、必要な場合にLLM reviewへ委ねる。
- schema parity testを追加する。

#### 5.4 Failure behavior

- `MockBlueprintDraftGenerationError`の固定本文依存を廃止する。
- typed structured resultを上位へ返す。
- raw responseをTask transcriptへvisibleなcollapsed evidenceとして保存する。
- Mission Pilot Thoughtにはorchestration diagnosticとraw message referenceを保存する。
- raw本文をPilot Thoughtへ重複コピーしない。
- successful repair後はadopted Blueprintとattempt provenanceを保存する。

完了条件:

- LLMが返していないrow/copy/sectionが保存結果へ追加されない。
- schema validな0件/少数datasetを実装側が増やさない。
- invalid contentはfixed fallbackで成功扱いにせずrepairへ進む。
- raw responseとdiagnosticをUIで別々に確認できる。

### Phase 6: Raw response visibility and Fact-based history

対象:

- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/modules/missionPilot/mission-pilot-plan-support.ts`
- `api/modules/missionPilot/mission-pilot-execution-query.service.ts`
- `src/modules/nightworkers/messageVisibility.ts`
- `src/modules/missionPilot/components/PilotThoughtDock.tsx`
- transcript/activity model

表示契約:

1. LLM raw responseは`LLM response`として表示する。
2. parse/schema/Fact issueは`System diagnostic`として表示する。
3. repaired responseは別attemptとして表示する。
4. adopted resultにはsource attemptを表示する。
5. current SQLite stop stateは従来どおり履歴外current stateとして表示する。
6. persisted historyとcurrent stateを混ぜない。
7. raw response intentだけを理由に完全非表示にしない。
8. 大きいraw responseはcollapsed detailsにして、本文の存在と先頭previewを常時確認できるようにする。

既存tableを再利用する。

- `task_messages`: raw/repaired/adopted LLM text。
- `activity_events`: validation diagnostic、repair scheduled/started/completed/failed。
- `mission_pilot_steps`: workflow status/attempt/last error。
- `mission_pilot_sessions`: current state。

DB migrationは原則不要とする。既存metadata JSONでsource attempt、validation status、repair kind、related message IDを保持する。実装時にindex不足がruntime計測で確認された場合だけmigrationを別レビューする。

### Phase 7: Migrate all structured LLM callsites

対象は現在の全21 callsiteとする。

優先順:

1. Mission Pilot plan review。
2. Mock Blueprint。
3. Data Model / Plan Views。
4. Questionnaire。
5. Task Generation / Mission Planner。
6. Project Evaluation / Review Rubrics。
7. Specification / Git closeout等の残りcallsite。

各callsiteで確認する:

- common `StructuredOutputContract<T>`を使う。
- raw responseを保持する。
- semantic normalizerを持たない。
- validation failureをtyped issuesとして扱う。
- repairが必要ならcommon workflowを使う。
- provider product-name branchを追加しない。
- user keyword/regex fallbackを追加しない。
- fixed errorがraw responseを置換しない。

全移行後:

- `allowRawOutputOnJsonParseFailure`を削除する。
- legacy string-only `callStructuredJsonLLM()`を削除またはprivate compatibility wrapperへ縮退する。
- callsite固有のJSON extractionを共通境界へ統合する。
- callsite固有のsemantic fallbackは削除するか、明示的なversion migrationとして隔離する。

### Phase 8: Documentation and architecture enforcement

対象:

- `AGENTS.md`またはproject instruction source
- relevant `spec/docs/`
- tests / architecture audit scripts
- READMEは利用者挙動に変更がある場合だけ更新

追加するarchitecture assertions:

- provider directoryにproduct schema名allowlistを置かない。
- user prompt regex/keyword classifierをstructured generationへ追加しない。
- structured resultを受けるcallsiteでraw textをdropしない。
- `normalize*`関数がverdict/severity/target/contentを変更しない。
- prompt文言は日本語を維持する。

既存Supervisor skill architectureは維持する。

- workflow/routing hypothesisはprompt側で決める。
- providerへ用途別SystemContextを追加しない。
- tool description、JSON contract、回答要件は再利用可能なconstant/functionへ集約する。

## 10. File-level Change Map

| Area | Primary files | Intended change |
| --- | --- | --- |
| Shared structured contract | `api/services/structured-llm/contract.ts`, `result.ts`, `types.ts` | raw-preserving typed result |
| JSON boundary | `api/services/structured-llm/json.ts`, `index.ts` | syntax repair + runtime validation only |
| Provider capability | `codex-output-schema.ts`, `codex-provider.ts`, `model-capability.ts` | remove product-name branching |
| Repair workflow | `structured-output-repair.service.ts`, repair prompt builder | LLM-based bounded repair |
| Plan review | `mission-pilot-plan-review.service.ts`, shared review schema, new validator | remove verdict/severity/ID mutation |
| Mock Blueprint | generation/parser/normalizer/dataset normalizer/prompt/schema | remove semantic fabrication |
| Persistence | Blueprint generation, task message/activity writers | raw/repaired/adopted provenance |
| UI | message visibility, Pilot Thought, transcript raw output viewer | raw + diagnostic separate display |
| Migration | all `callStructuredJsonLLM()` callsites | common result boundary |
| Tests | structured LLM, plan pipeline, mock blueprint, UI/E2E/live | semantic preservation and failure recovery |

## 11. Test Plan

### 11.1 Structured boundary unit tests

- valid direct JSON returns exact semantic value。
- fenced JSON extraction preserves value。
- syntax repair records raw/repaired texts。
- unrepairable JSON returns raw + parse issue。
- schema failure returns raw + exact issue paths。
- validator does not add/remove/change fields。
- transport failure contains no fabricated LLM body。
- same schema features choose same provider mode regardless of schema name。

### 11.2 Semantic preservation tests

- `blocking` remains `blocking`。
- `warning` remains `warning`。
- `pass/revise/reroute/reject` remains unchanged after validation。
- revision target order/content remains unchanged。
- source ID typo is not mapped to another ID。
- invalid source ID produces Fact issue and repair request。
- repair response is a new attempt, not mutation of original response。

### 11.3 Mock Blueprint tests

- output rows are not padded。
- output fields/cards/messages are not padded。
- article text is not expanded。
- missing meta is validation failure, not generated fallback。
- invalid dataset kind is validation failure, not another kind。
- prompt contains no BBS/thread/Todo/CRM-specific screen plan。
- prompt and runtime use the same contract。
- renderer safely handles schema-valid small/empty datasets。
- exact malformed-quote fixture enters repair workflow。

### 11.4 Mission Pilot integration tests

- initial parse failure + repair success continues to next Plan step。
- repair failure reaches attention only after configured limit。
- Questionnaire is not regenerated during repair。
- Stop during repair rejects stale result。
- Context/routing revision change rejects stale repair result。
- successful review retains exact LLM verdict/findings/targets。
- Queue admission still requires current passing review and current Context。
- raw response, repair diagnostic, adopted result are persisted once each。

### 11.5 UI tests

- raw failed response is discoverable and collapsed by default。
- fixed diagnostic is shown separately from LLM response。
- persisted history does not synthesize missing attempts。
- current SQLite state remains labeled as history-external current state。
- polling merge remains ID-based and deterministic for new live records。
- new repair attempt appended during polling does not reorder or duplicate history。

### 11.6 E2E tests

Scenario A: repair succeeds

1. Start Mission Pilot Plan Mode。
2. Questionnaire completes once。
3. Mock Blueprint provider returns malformed JSON。
4. repair provider returns valid JSON preserving semantic content。
5. pipeline continues through remaining Artifacts and review。
6. original raw and repair attempt are visible。

Scenario B: repair exhausts

1. initial and repair responses are invalid。
2. Mission Pilot stops at attention after limit。
3. no Queue row or TaskRun is created。
4. raw responses and validation issues are visible。
5. Play resumes from failed Plan step without regenerating Questionnaire。

Scenario C: invalid review reference

1. plan reviewer returns an unknown source ID。
2. implementation does not replace it。
3. repair step receives current Artifact inventory and issue。
4. corrected response is revalidated and only then adopted。

## 12. Verification Commands

### 12.1 Focused tests

```bash
bunx vitest run \
  tests/structured-llm/services-structured-llm-01.test.ts \
  tests/structured-llm/services-structured-llm-03.test.ts \
  tests/structured-llm/codex-output-schema.test.ts \
  tests/mock-blueprint.test.ts \
  tests/mission-pilot-plan-pipeline.test.ts \
  tests/mission-pilot-plan-coordinator.test.ts \
  tests/pilot-thought-dock.test.tsx \
  tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
```

### 12.2 Static checks

```bash
bun run lint
bun run typecheck
git diff --check
```

### 12.3 Repository gate

```bash
bun run verify
```

### 12.4 Architecture searches

```bash
rg -n "CODEX_PROMPT_VALIDATED_SCHEMA_NAMES|allowRawOutputOnJsonParseFailure|reconcileArtifactSourceMessageId" api shared src tests
rg -n "ensureMinRecords|ensureArticleBodyLength|Selected for the product mockup|Mock blueprint preview" api/modules/blueprint
rg -n "Mock Blueprint LLM output did not contain valid JSON" api src shared tests
rg -n "callStructuredJsonLLM\(" api
```

Expected final state:

- prohibited semantic mutation symbols are 0 件。
- string-only legacy callsites are 0 件、または明示されたtemporary compatibility wrapper内だけ。
- fixed error textがLLM response代替経路に存在しない。
- remaining regexはJSON extraction、transport diagnostics等であり、user semantic classificationではない。

### 12.5 Live provider verification

provider behaviorを変更するため、fixture testだけで完了しない。明示的なlive verificationとして次を行う。

```bash
bun run verify:live
```

Live acceptance:

- Codex routeでschema capability selection reasonがgenericに記録される。
- Mock Blueprintがnativeまたはprompt-onlyのどちらでもruntime validationされる。
- malformed response時にrawが失われない。
- provider-specific product name branchがなくても正常生成またはbounded repairへ進む。

外部provider credentialが利用できない場合、`verify:live`未実施を通常verify成功で代替しない。blockerとして明記する。

## 13. Rollout Order

変更は次の順でレビュー可能な単位に分ける。

1. Shared typed result / contract。behavior changeなし。
2. Product-agnostic provider capability。fixture/provider tests付き。
3. Common repair workflow。まだcallsite接続なし。
4. Mission Pilot plan review migration。semantic mutation削除。
5. Mock Blueprint migration。semantic fabrication削除。
6. Raw response visibility / Pilot Thought linkage。
7. Remaining structured LLM callsite migration。
8. Architecture assertions / docs。
9. focused tests、repo verify、live verify。

各段階でtestsを通し、複数段階を一つの巨大diffへまとめない。

## 14. Compatibility and Data Migration

### 14.1 Existing persisted artifacts

- 既存Mock Blueprint artifactを再書換えしない。
- 既存normalizerで生成されたfallback contentをmigrationで削除しない。
- 新規generation attemptから新contractを適用する。
- provenanceがない既存contentを推測でrawへ戻さない。

### 14.2 Existing failed steps

- `failed / attempt=1`のPlan stepはPlay時に新repair-capable workflowから再開できる。
- retry counterの意味をmigration前後で混同しない。
- 必要ならstep evidence metadataへ`structuredOutputAttempt`を追加するが、DB column追加は避ける。

### 14.3 API compatibility

- frontend API responseの既存fieldは維持する。
- raw/repair provenanceはoptional additive metadataとして追加する。
- legacy clientはdiagnosticを無視してもcurrent stateを読める。
- legacy string-only internal APIは全callsite移行後に削除する。

## 15. Risks and Mitigations

### Risk 1: Removing fallback makes invalid output more visible

Mitigation:

- common LLM repair stepを先に実装する。
- invalid outputを成功Artifactとして採用しない。
- rawとissueを表示し、failure原因を隠さない。

### Risk 2: LLM review loops increase

Mitigation:

- semantic decisionは上書きしないが、retry/correction/routing上限は維持する。
- Context/routing revision、idempotency、same-finding dedupeはFact/state boundaryとして維持する。
- 上限到達時はexact responseとattempt evidenceを表示する。

### Risk 3: Provider native schema compatibility differs

Mitigation:

- product名allowlistではなくschema feature diagnosticsを使う。
- prompt-only modeをgeneric fallbackとして維持する。
- どちらのmodeでも同じruntime contractで検証する。
- live provider verificationを必須にする。

### Risk 4: Schema strictness constrains semantic freedom

Mitigation:

- schemaはrenderer/command実行に必要なshapeだけを表す。
- quality preferenceや過去事例のminimum countをschemaに入れない。
- semantic qualityはLLM reviewと利用者判断へ残す。

### Risk 5: Raw output display becomes noisy

Mitigation:

- rawはcollapsed detailsで表示する。
- summaryにはprovider、attempt、validation status、size、timestampを表示する。
- fixed diagnosticとraw本文を別recordにする。
- record自体は非表示にしない。

## 16. Superseded Decisions

本計画は、次の既存決定を新規generationについて置き換える。

### `spec/archive/mock-blueprint-recovery-implementation-plan.md`

Superseded:

- missing `meta`を実装側で生成する。
- table rowsを最低5件へ補完する。
- form/cards/timeline/chat/metrics等を最低件数まで補完する。
- article bodyを180文字まで実装側で増やす。
- domain別のsection選択heuristicを長いpromptへ固定する。
- fallback dataを生成してschema successへ変換する。

Still valid:

- LLMがsectionを選ぶ。
- BBS等をapplication codeへhardcodeしない。
- Mock previewをprimary artifactとして表示する。
- raw generation provenanceとusageを保持する。

### Mission Pilot plan review normalization

Superseded:

- concept Artifact findingを常にwarningへ変更する。
- revision targetを実装側で削除する。
- revision target有無からverdictを再計算する。
- Artifact kindが一意ならsource IDを推測置換する。

Still valid:

- current Artifact参照の存在検証。
- duplicate/missing scoreの検出。
- current Context/routing revisionの検証。
- Queue admission前のpassing review要求。
- correction/routing loop上限。

## 17. Definition of Done

次をすべて満たしたときだけ完了とする。

1. LLM raw responseがparse/schema成否にかかわらず保持される。
2. raw responseを固定エラーが置換しない。
3. fixed diagnosticとLLM本文が別recordとして表示される。
4. `normalizeMissionPilotPlanReview()`によるID、severity、verdict、target mutationがない。
5. invalid source IDは推測置換されず、Fact issueとしてrepairへ渡る。
6. Mock Blueprint normalizerがrow、field、card、copy、article body、sectionを生成しない。
7. promptから特定domainのscreen planと過去事例heuristicが除去される。
8. runtime schemaとprovider schemaが同じcontract sourceから生成される。
9. provider adapterにproduct schema名分岐がない。
10. validation failureはbounded LLM repair workflowへ進む。
11. repair成功時、Mission Pilot pipelineが同じcheckpointから継続する。
12. repair失敗時、attempt上限後にだけattentionへ停止する。
13. Stop、Context change、lease loss後のstale repair resultを採用しない。
14. Queue admission、CAS、revision、idempotency safetyが維持される。
15. user文言のkeyword/regex分類が追加されていない。
16. 全structured LLM callsiteのmigration checklistが完了している。
17. focused tests、lint、typecheck、`bun run verify`が成功する。
18. `bun run verify:live`が成功する。実行不能なら完了ではなくblockerとして残す。
19. code reviewでsemantic mutation、provider product knowledge、raw replacementの残存が0件である。
20. 実装結果と本計画の差分がdocumentへ反映される。

## 18. Implementation Result

### 18.1 Shared boundary and provider

- `StructuredOutputContract<T>`、raw-preserving `StructuredLlmResult<T>`、attempt/issue metadata を共通境界へ追加した。
- JSON candidate extraction、balanced JSON、`jsonrepair`、runtime schema validationを共通化した。
- validation failureは initial 1回 + repair 1回のbounded workflowへ統一した。
- repair promptは日本語の共通builderとし、元回答の意味を維持して契約違反だけを修正するよう限定した。
- Codex providerのproduct artifact名allowlistを削除し、schema featureだけでnative structured output可否を決めるよう変更した。
- `allowRawOutputOnJsonParseFailure`を削除した。
- string-only `callStructuredJsonLLM()`はprovider-level test / external caller用のdeprecated compatibility seamだけに縮退し、product service callsiteは0件にした。

### 18.2 Workflow and semantic preservation

- Mission Pilot plan reviewのID置換、severity変更、target filtering、verdict再計算を削除した。
- current Artifact、score、routing revision、revision targetはnon-mutating Fact validatorで検証する。
- initial / repairの各LLM本文とvalidation issueをattempt別に永続化する。
- repair前と採用前にMission Pilotのdesired state、Context revision/digest、routing revisionを再検証し、停止後またはstaleなrepair resultを採用しない。
- schema-validなrevision targetはconcept Artifactを含め、実装側で黙って削除せずそのままcorrection workflowへ渡す。
- Mock Blueprintのparser/normalizer/dataset normalizerを削除し、row、card、field、copy、ID、meta、section、dataset kindを実装側で生成・変更しないようにした。
- App Blueprint、Task candidate、Mission planner、Project evaluationのsemantic rewrite / reorder / keyword classificationを削除した。
- legacy flat Design Questionnaireを固定文でcanonical化するnormalizerを削除した。不正なlegacy contractはrawを保持した`invalid / needs_edit`として扱う。現行choice-formの明示的な保存モデルadapterはQuestionnaire ontology変更を避けるため維持した。

### 18.3 Raw evidence and live history

- Mock Blueprintのinitial / repair失敗本文をattempt別Task messageとして保存し、validation issueをmetadataへ保持する。
- `mock_blueprint_raw_output`を通常表示から除外しない。
- LLM本文が存在するparse/schema/Fact failureでは、application固定文をresponse textへ差し替えない。
- Pilot ThoughtはSQLiteの`mission_pilot_events`、`activity_events`、`task_messages`をIDでmergeし、2秒pollingで新規recordを追記する。current stop stateは履歴外のSQLite current stateとして分離表示する既存契約を維持した。

### 18.4 Structured LLM callsite migration checklist

- [x] Mission Pilot plan review
- [x] Mock Blueprint / App Blueprint
- [x] Data Model
- [x] Plan dedicated views / API contract / Zod schema design
- [x] Questionnaire initial / follow-up / additional questions / review
- [x] Task generation / task candidate generation
- [x] Mission planner evaluation
- [x] Project evaluation
- [x] Review rubrics
- [x] Specification / Feature Plan
- [x] Workbench Plan gate / questionnaire / estimate
- [x] Git closeout

### 18.5 Architecture enforcement

- provider product-name分岐、legacy product callsite、削除済みsemantic normalizer、domain-specific repair promptの再導入を検知するarchitecture testを追加した。
- user textのregex/keyword分類は追加していない。残るregexはfile path、JSON extraction、timestamp、transport diagnostic等の構文・運用判定だけである。
- Codex SDKをlive provider smokeで選択できるようにし、provider timeoutより短いtest runner timeoutも解消した。

### 18.6 Verification record

2026-07-14に次を実行し、すべて成功した。

- focused structured / Mission Pilot / Mock Blueprint tests: 67 tests
- Questionnaire legacy raw-preservation route test: 1 test
- Blueprint / Task generation / Workbench / Review / Specification focused tests: 135 tests
- repair state guard / Mission Pilot / Mock Blueprint regression tests: 53 tests
- `bun run typecheck`
- `bun run lint` (`1518 files`)
- `git diff --check`
- `bun run verify`
- `NIGHTWORKERS_LIVE_LLM_VITEST=1 NIGHTWORKERS_LIVE_LLM_PROVIDER=codex CODEX_MODEL=gpt-5.6-luna bun run verify:live`

Live verificationではCodex SDKのstructured JSON responseとrequest/response eventを確認し、live provider testsとlive agent E2E gateがともにPASSした。

### 18.7 Post-archive code review

アーカイブ後の最終コードレビューで、次の残存問題を修正した。

- provider境界ではschema validationによるdefault挿入、unknown field削除、transformをlosslessでない応答として拒否する。一方、workflowが明示的に所有するlegacy draft adapterとcompatibility defaultはprovider責務へ逆流させず維持した。
- Supervisor schema-first応答、Data Model、Plan dedicated view、API Contract、Zod Schemaのpost-validation failureでも、LLM本文が存在する場合は固定エラー文へ置換しない共通error mappingへ統一した。
- extraction candidateとsyntax repair後JSONをattempt metadataで分離し、repair成功時を含めて`validationByAttempt`を保持した。
- `structured-llm/request.ts`からQuestionnaire等のproduct用途名によるcall kind分類を削除し、schema-first workflow contractとprovider classだけからrequest policyを構成するようにした。
- Questionnaire contextのauth / permission keyword正規表現分類を削除し、直近Task messageのmetadataと本文抜粋をFactとしてpromptへ渡してLLMに判断させるようにした。
- Mission Pilot plan reviewの採用は、`desired_state=playing`、current lease owner / expiry、Context revision / digest、routing revisionを同一transactionで照合してからINSERTするようにした。StopまたはContext更新後のstale reviewは保存しない。
- review/correction loopは履歴を削除せず、current Context revision / digest / routing revisionに一致するreviewだけを補正判断とattempt上限の対象にした。過去Contextの`revise`を現在の補正へ流用しない。
- 追加実装で大規模化したcoordinator、repository、structured LLM entrypointを責務別moduleへ分割し、large-source baseline exceptionを追加せずarchitecture gateを回復した。

最終レビュー後に次を再実行し、すべて成功した。

- 関連focused regression: 210 tests
- module分割後のfocused regression: 71 tests
- `bun run check:architecture`
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- `bun run verify`
- `bun run check:docs`
- `NIGHTWORKERS_LIVE_LLM_VITEST=1 NIGHTWORKERS_LIVE_LLM_PROVIDER=codex CODEX_MODEL=gpt-5.6-luna bun run verify:live`
