# S11t OSS Project Proposal

## Status

- Publication status: the runtime and CLI were published as `s11tnext@0.1.0` and `s11tnext-cli@0.1.0`
- Historical note: this document retains the original design scope, while package and CLI examples use the published names. Current NightWorkers usage is governed by `spec/s11t-coding-agent-guide.md`.
- Document status: project name approved; design draft
- Created: 2026-07-21
- Project name: `S11t`
- Name origin: `SystemContext`の先頭`S`、中間11文字、末尾`t`
- Tagline: `System Context as Code`
- Naming convention: brandと文書では`S11t`、repository・runtime package・CLIでは`s11tnext`
- Published packages: runtimeは`s11tnext`、authoring/build CLIは`s11tnext-cli`
- Planned repository form: independent OSS in a dedicated Git repository, internally maintained as a monorepo
- Distribution: public npm packages; NightWorkers consumes released or canary packages as an external dependency
- Proposed license: Apache License 2.0
- Reference implementation language: TypeScript

この文書は、多言語System prompt、runtime facts、Role規則、tool/output contract等をSystemContextとしてTOMLで管理し、アプリケーションコードから短い`p()` APIで利用できる独立OSS `S11t`のプロジェクト素案である。S11tはNightWorkers repositoryの一部として作らず、専用repositoryで開始する。NightWorkersは最初の利用者・検証先として、公開npm packageまたはcanary packageを依存関係に追加する。

S11t本体はSystemContextのauthoring、compile、評価、実験、promotionを扱う。LLM provider呼び出し、Agent固有runtime、権限判断、Task解釈は所有しない。NightWorkersは最初の利用者・検証先になり得るが、S11tのcontractをNightWorkers固有のRoleやworkflowへ固定しない。

## 1. 要約

S11tは、SystemContextを散在したprompt文字列やruntime objectではなく、次の性質を持つversion付きContext Programとして扱う。

- TOMLによる読みやすい複数行authoring。
- `namespace:key`形式の安定したSystemContext ID。
- `p("codingAgent:identity", values)`だけで型付きSystemContext Invocationを生成できる短いruntime API。
- contextの目的、利用場面、非適用場面、owner、入力、変更可能範囲の明示。
- locale、model profile、runtime factsに基づく決定的compile。
- section、SystemContext、最終request assembly、Agent trajectoryの評価。
- controlとcandidateを比較するoffline benchmarkとonline A/B test。
- 評価済みcandidateだけをstableへ昇格するpromotion gate。
- 実行時に使われたrelease、locale、model profile、artifact hash、experiment assignmentの追跡。
- optimizerによる変更をcandidate生成に限定し、productionを直接書き換えない継続改善loop。

利用者が触る表面は小さく保つ。

```ts
const p = catalog.bind({
	instructionLocale: run.instructionLocale,
	responseLocale: run.responseLocale,
	modelProfile: run.modelProfile,
	usageCollector: run.systemContextUsageCollector,
});

const systemContext = p("codingAgent:identity", {
	taskGoal,
});

await s11tAwareLlm.generate({
	system: systemContext,
});
```

一方、内部では必ずCompiled SystemContextを生成し、再現と評価に必要なmanifestを残す。

```text
TOML Source
  -> Validate
  -> Resolve release / locale / model profile
  -> Compile sections
  -> Render runtime values
  -> Emit SystemContext Invocation + Artifact Manifest
  -> LLM application
  -> Commit actual exposure
  -> Trace / Evaluation / Experiment Outcome
  -> Candidate / Promotion / Rollback
```

## 2. 背景と問題

LLMを利用するsystemでは、promptが次の形で増殖しやすい。

- TypeScript、Python、JSON、環境変数、管理画面へ直接記述される。
- 同じ規則が複数のpromptへcopyされる。
- 日本語版と英語版が独立して変更され、意味がずれる。
- どのTask、Role、状況で使用するpromptなのか、本文を読まないと分からない。
- promptを変更しても、どのversionが実際に使われたか追跡できない。
- 改善が体感で判断され、既存ケースの回帰を検出できない。
- 短文化や自動最適化が、権限、禁止事項、output contractまで変更してしまう。
- A/B testの割当、exposure、metric、判定が分離し、勝者の根拠を再現できない。

通常のi18n libraryはkey lookup、locale fallback、interpolationには優れるが、promptの行動contract、評価、model差、experiment、promotionを所有しない。一方、prompt management platformはversionやtraceを提供しても、TOMLによるlocal-first authoring、rule単位の多言語対応、短い`p()` APIを同時には提供しない。

S11tは、この間を埋める小さなOSSを目指す。

### 2.1 S11tにおけるSystemContext

S11tではSystemContextを「あるLLM invocationのsystem-level behaviorを決める、version付きの構造化入力program」と定義する。

SystemContext Definitionに含めるもの:

- system/developer instruction。
- Role、Task Goal、Project rules等のruntime fact schema。
- tool contractとoutput contractの説明または参照。
- locale、model profile、message placement。
- Run、Task、Todo等の局所overlay。
- section priority、保護属性、入力のtrustとencoding。

Compiled SystemContextに含めるもの:

- 選択されたlocaleとmodel profileに対応するtextまたはmessage列。
- runtime valuesを展開したsystem-level content。
- 使用したrelease、artifact、section、fallbackのmanifest。

SystemContext本体に含めないもの:

- user conversationと未投影のchat history。
- LLM outputとtool resultそのもの。
- application databaseのうち、runtime factとして投影されていない状態。
- authorization、revision、transaction、idempotency等のhost enforcement。
- provider通信、retry、stream処理。
- eval dataset、experiment outcome、Promotion Policy等のcontrol-plane record。

評価、A/B、promotion、rollbackはSystemContextのcontentではないが、S11tがSystemContext lifecycleとして管理する。application固有の意味判断と実行責務はS11tへ移さない。

## 3. Goals

### 3.1 Authoring

- SystemContextを人間が読みやすいTOMLで記述できる。
- 改行、コード、箇条書き、長文を自然な形で保持できる。
- SystemContext ID、version、owner、purpose、use cases、inputsを同じ定義から確認できる。
- 短いcontextは単一text、重要なcontextは安定したsection IDへ分割できる。
- source localeと各translationを同じSystemContext IDへ対応付けられる。
- instruction、runtime fact、tool contract、output contract、局所overlayをsection kindとして区別できる。

### 3.2 Runtime

- 通常利用を`p()`一つにできる。
- SystemContext keyと入力をTypeScriptで型検査できる。
- text contextとmessage contextを型で区別し、untrusted値のmessage境界を保持できる。
- global mutable localeを使用せず、requestまたはrunへbindできる。
- 同じsource、入力、locale、profileから同じCompiled SystemContextを生成できる。
- filesystemやremote registryを毎request読み直さない。

### 3.3 Reliability

- 実行に使われたSystemContext ID、version、release digest、locale、model profile、artifact hashを保存できる。
- release digestに含まれないlocale、model profile、compilerの組合せを誤って昇格できない。
- locale fallback、model override、experiment assignmentを監査できる。
- 変更禁止sectionをcompiler、lint、optimizerで保護できる。
- untrusted runtime valuesと固定policyの境界を検証できる。

### 3.4 Evaluation and Improvement

- 各SystemContextが参照するeval suiteを宣言できる。
- locale、model、provider、candidate releaseを同じcaseで比較できる。
- static、unit、assembly、trajectoryの異なる評価levelを扱える。
- offline benchmarkを通過したcandidateだけをonline A/B testへ送れる。
- A/B testのcontrol、candidate、割当、exposure、outcome、判定を再現できる。
- 明確なguardrailとpromotion条件を満たした改善版だけをstableへ昇格できる。
- 不合格candidateをproductionへ反映せず、stableへ即時rollbackできる。

### 3.5 Portability

- 特定のLLM provider、Agent framework、observability platformへ依存しない。
- provider adapter、storage adapter、metric collectorを差し替えられる。
- compiled artifactをJSON等の機械可読形式へexportできる。
- authoring formatとruntime executionを分離する。

## 4. Non-goals

初期scopeでは次を実装しない。

- LLM provider APIを統一するgateway。
- Agent orchestration framework。
- Task、Role、Todo、workflowの意味判断。
- ユーザー文言のkeywordや正規表現によるprompt自動分類。
- 権限、revision、idempotencyなどapplication固有のserver-side enforcement。
- hosted prompt management SaaS。
- production promptの無審査な自動書き換え。
- LLMの自由記述だけを根拠にしたwinner判定。
- 翻訳文が意味的に同一であるという無検証の仮定。
- 単一の総合scoreだけによる安全規則とcostの交換。

## 5. Design Principles

### 5.1 `p()`はfacadeであり、SystemContextが正本である

アプリケーションコードは短い`p()`を使える。`p`はprompt-orientedなdeveloper experienceを表すが、正本はTOML sourceとcompilerが生成したCompiled SystemContextである。

`p()`が短いことを理由に、version、locale、hash、fallback、experiment情報を失ってはならない。`p()`はprimitiveなstringではなく、本文またはmessage列とimmutableなmanifest、usage tokenを持つ`SystemContextInvocation`を返す。

S11t-aware provider adapterは`SystemContextInvocation`を受け取り、実際のLLM requestがproviderに受理された時点でusage tokenをcommitする。raw provider SDKを直接使う場合は、呼び出し側がcontentを取り出し、送信成功後に同じcommit APIを呼ぶ。compileまたはassignmentだけではexposureに数えない。

単なる文字列が必要な利用者は`content.kind`を確認して`content.text`を取り出す。message promptをtextとして取得するAPIは提供しない。自動的なstring coercionは、provenanceとmessage境界を失うため提供しない。

### 5.2 Promptとhost enforcementを分ける

Promptは行動原則、判断材料、output guidanceを表現する。次の不変条件は利用applicationがserver側で強制する。

- authorization
- revision
- transaction
- idempotency
- resource scope
- destructive operation preconditions
- output schema validation

S11tは各sectionに`enforcement = "prompt" | "schema" | "host"`を記録できるが、host enforcement自体を実装しない。

### 5.3 意味判断をhostの文字列分類へ移さない

`purpose`、`use_when`、`avoid_when`は、人間、LLM、評価系がpromptの用途を理解するための説明である。hostがユーザー文言をkeywordや正規表現で分類し、暗黙にpromptを選ぶためには使わない。

自動選択が必要なapplicationは、候補SystemContextのdescriptionをLLMへ渡すか、Roleやcapabilityなどの構造化されたruntime factから候補を限定する。

### 5.4 改善はcandidateとして行う

人間またはoptimizerが生成した変更は、必ずimmutableなcandidate versionになる。offline eval、必要に応じたA/B test、promotion gateを経ずにstableを置き換えない。

### 5.5 評価はSystemContext本文の完全一致ではなく行動を測る

snapshotはcompileの再現性を検証するために使う。品質評価ではTask成功、constraint違反、tool trajectory、schema、cost、latency等を測る。

## 6. Consumer Experience

### 6.1 推奨directory

```text
contexts/
  codingAgent/
    identity.context.toml
    todo-planning.context.toml
  missionPilot/
    identity.context.toml
    plan-review.context.toml
  evals/
    codingAgent.identity.eval.toml
    codingAgent.role-boundary.eval.toml
  s11t.lock.toml
```

1 SystemContext IDを1 fileにすることを既定とする。全localeを同じfileに置くことで、翻訳差分とsection対応をreviewしやすくする。大規模な翻訳組織向けにlocale分割loaderを将来追加できるが、正本schemaは同じにする。

### 6.2 Simple SystemContext

短いSystemContextは単一textで記述できる。

```toml
schema_version = 1

[context]
id = "structuredOutput:repair"
version = "1.0.0"
owner = "structured-output"
source_locale = "ja-JP"
required_locales = ["ja-JP", "en-US"]
authoring_status = "ready"
output = "text"
promotion_policy = "standard"
eval_suites = ["structuredOutput.repair"]

[variables.rawText]
required = true
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"

[locales."ja-JP"]
purpose = "構造化応答の意味を維持したまま、構文とschema違反を修復する。"
use_when = ["LLM本文がJSONまたはschema検証に失敗したとき"]
avoid_when = ["元の回答内容そのものを再判断するとき"]
text = '''
元の回答の意味、判断、主張を維持し、構文と契約違反だけを修復してください。

<ORIGINAL_RESPONSE_JSON_STRING>
[[rawText]]
</ORIGINAL_RESPONSE_JSON_STRING>
'''

[locales."en-US"]
purpose = "Repairs syntax and schema violations while preserving response meaning."
use_when = ["An LLM response fails JSON parsing or schema validation"]
avoid_when = ["The original decision itself must be reconsidered"]
text = '''
Preserve the original meaning, decisions, and claims. Repair only syntax and contract violations.

<ORIGINAL_RESPONSE_JSON_STRING>
[[rawText]]
</ORIGINAL_RESPONSE_JSON_STRING>
'''
```

### 6.3 Sectioned SystemContext

Role、権限、tool contract、完了判断などの重要SystemContextはsectionへ分割する。

```toml
schema_version = 1

[context]
id = "codingAgent:identity"
version = "1.0.0"
owner = "codingAgent"
source_locale = "ja-JP"
required_locales = ["ja-JP", "en-US"]
authoring_status = "ready"
output = "text"
promotion_policy = "high-risk-agent"
applies_to = ["coding_agent"]
required_facts = ["task_goal"]
eval_suites = [
  "codingAgent.identity.behavior",
  "codingAgent.role-boundary",
]

[variables.taskGoal]
required = true
trust = "untrusted"
placement = "delimited-context"
encoding = "json-string"

[[sections]]
id = "role.identity"
kind = "instruction"
severity = "must"
enforcement = "prompt"
optimizable = false

[sections.locales."ja-JP"]
text = '''
あなたはユーザーTaskを自動化するCoding Agentです。
'''

[sections.locales."en-US"]
text = '''
You are a Coding Agent that automates user tasks.
'''

[[sections]]
id = "task.decision-ownership"
kind = "instruction"
severity = "must"
enforcement = "prompt"
optimizable = false

[sections.locales."ja-JP"]
text = '''
Taskの意味、Todoの分割、次の行動、検証方法、完了可否はあなたが判断します。
'''

[sections.locales."en-US"]
text = '''
Determine task meaning, Todo decomposition, next actions, verification, and completion readiness.
'''

[[sections]]
id = "task.goal-context"
kind = "runtime-fact"
severity = "should"
enforcement = "prompt"
optimizable = true

[sections.locales."ja-JP"]
text = '''
<TASK_GOAL_JSON_STRING>
[[taskGoal]]
</TASK_GOAL_JSON_STRING>
'''

[sections.locales."en-US"]
text = '''
<TASK_GOAL_JSON_STRING>
[[taskGoal]]
</TASK_GOAL_JSON_STRING>
'''
```

section配列の順序をcompile順とし、object keyの暗黙順序へ依存しない。

### 6.4 Runtime API

```ts
type SystemContextMessage = {
	role: "system" | "developer" | "user" | "assistant";
	content: string;
};

type SystemContextUsageToken = {
	invocationId: string;
	releaseDigest: string;
	artifactHash: string;
	state: "uncommitted";
};

type SystemContextInvocation<K extends SystemContextKey> = {
	key: K;
	content: SystemContextOutputMap[K] extends "text"
		? { kind: "text"; text: string }
		: { kind: "messages"; messages: SystemContextMessage[] };
	manifest: SystemContextManifest;
	usageToken: SystemContextUsageToken;
};

type SystemContextArguments<K extends SystemContextKey> = keyof SystemContextValueMap[K] extends never
	? [values?: undefined]
	: [values: SystemContextValueMap[K]];

type BoundSystemContextFunction = <K extends SystemContextKey>(
	key: K,
	...args: SystemContextArguments<K>
) => SystemContextInvocation<K>;

const p = catalog.bind({
	instructionLocale: "ja-JP",
	responseLocale: "ja-JP",
	modelProfile: "openai-primary",
	usageCollector,
});

const systemContext = p("codingAgent:identity", { taskGoal });

await s11tAwareLlm.generate({ system: systemContext });
```

入力がないSystemContextは第2引数を省略できる。

```ts
const repairPolicy = p("structuredOutput:repairPolicy");
```

通常のapplication codeでは`p()`以外のSystemContext lookup APIを必要としない。S11t-aware provider adapterはInvocationからtextまたはmessagesを取得し、送信が受理された後にexposureをcommitする。

raw provider SDKへ渡す場合は明示的にcontentを取り出す。この経路では送信成功後のcommitが必須である。

```ts
const invocation = p("codingAgent:identity", { taskGoal });

const response = await rawProvider.generate({
	system: invocation.content.kind === "text"
		? invocation.content.text
		: invocation.content.messages,
});

await usageCollector.commit(invocation.usageToken, {
	providerRequestId: response.requestId,
});
```

Usage tokenはopaqueかつsingle-useとする。同じtokenのcommitはidempotentに同じExposureを返し、異なるprovider request IDでの再commitを拒否する。

tooling、evaluation、adapter実装向けには`catalog.compile()`、`catalog.describe()`、`catalog.list()`を別途提供する。

### 6.5 型生成

CLIはTOMLからSystemContext keyと入力型を生成する。

```ts
export type SystemContextKey =
	| "codingAgent:identity"
	| "codingAgent:todoPlanning"
	| "missionPilot:identity"
	| "structuredOutput:repair"
	| "structuredOutput:repairPolicy";

export type SystemContextValueMap = {
	"codingAgent:identity": {
		taskGoal: string;
	};
	"codingAgent:todoPlanning": Record<never, never>;
	"missionPilot:identity": Record<never, never>;
	"structuredOutput:repair": {
		rawText: string;
	};
	"structuredOutput:repairPolicy": Record<never, never>;
};

export type SystemContextOutputMap = {
	"codingAgent:identity": "text";
	"codingAgent:todoPlanning": "text";
	"missionPilot:identity": "text";
	"structuredOutput:repair": "text";
	"structuredOutput:repairPolicy": "text";
};
```

存在しないSystemContext key、必須値の欠落、余分な値はTypeScript errorにする。

## 7. Core Contracts

### 7.1 SystemContext Definition

```ts
type SystemContextDefinition = {
	schemaVersion: 1;
	context: {
		id: string;
		version: string;
		owner: string;
		sourceLocale: string;
		requiredLocales: string[];
		authoringStatus: "draft" | "ready" | "retired";
		output: "text" | "messages";
		promotionPolicy: string;
		appliesTo: string[];
		requiredFacts: string[];
		evalSuites: string[];
	};
	variables: Record<string, SystemContextVariable>;
	locales?: Record<string, LocalizedSystemContext>;
	sections?: SystemContextSection[];
};
```

`locales`と`sections`は同時に本文正本として使わない。simple SystemContextは`locales`、sectioned SystemContextは`sections`を使用する。

`appliesTo`、`requiredFacts`、`evalSuites`はTOMLで省略可能とし、loaderが空配列へ正規化する。`requiredLocales`の省略時は`[sourceLocale]`とする。`authoringStatus`はsource fileの編集可否を表すだけで、productionのstable状態を表さない。stableは後述するPromotion Manifestだけが所有する。

SystemContext sectionのkindは最低限`instruction`、`runtime-fact`、`tool-contract`、`output-contract`、`overlay`を扱う。Role固有の意味判断やtool実装をS11tへ持ち込まず、sectionの配置、locale、入力、保護属性だけを共通contractにする。

### 7.2 SystemContext Variable

```ts
type SystemContextVariable = {
	required: boolean;
	trust: "trusted" | "untrusted";
	placement:
		| "inline"
		| "delimited-context"
		| "separate-message"
		| "schema-only";
	encoding: "raw" | "json-string" | "json-value";
	description?: string;
};
```

`untrusted`値を`severity = "must"`かつ`optimizable = false`のinstruction sectionへinline展開する定義、および`untrusted`と`encoding = "raw"`の組合せはlint errorにする。`json-string`はJSON文字列としてquoteし、`<`、`>`、`&`もUnicode escapeしてdelimiterの構文的breakoutを防ぐ。

encodingはprompt injectionそのものを無効化するsecurity boundaryではない。強い分離が必要な値は`placement = "separate-message"`と`output = "messages"`を使用する。text outputに`separate-message`変数を含める定義はcompile errorにする。

### 7.3 Compiled SystemContext

```ts
type CompiledSystemContext = {
	content:
		| { kind: "text"; text: string }
		| { kind: "messages"; messages: Array<{
		role: "system" | "developer" | "user" | "assistant";
		content: string;
	}> };
	manifest: SystemContextManifest;
};

type SystemContextManifest = {
	id: string;
	version: string;
	schemaVersion: number;
	releaseDigest: string;
	definitionHash: string;
	artifactHash: string;
	requestedLocale: string;
	resolvedLocale: string;
	sourceLocale: string;
	responseLocale: string;
	modelProfile: string;
	sectionIds: string[];
	renderedHash: string;
	fallbackUsed: boolean;
	fallbackFromLocale: string | null;
	sourceFiles: string[];
	evalSuiteIds: string[];
	compilerVersion: string;
};
```

`definitionHash`は全localeを含むcanonical SystemContext Definition、`artifactHash`は特定のlocale、model profile、compiler versionから生成した動的値を含まないcontent、`renderedHash`は展開後contentを対象とする。privacy上の理由から、通常のtraceには動的値とrendered contentを保存せず、manifestと必要なdigestだけを保存できるようにする。

### 7.4 SystemContext Release

SystemContext version単体をproduction identityにしない。評価とpromotionの単位は、compile可能なartifact matrixを固定したimmutableなSystemContext Releaseとする。

```ts
type SystemContextRelease = {
	releaseId: string;
	releaseDigest: string;
	systemContextId: string;
	systemContextVersion: string;
	definitionHash: string;
	schemaVersion: number;
	compilerVersion: string;
	artifacts: Array<{
		locale: string;
		modelProfile: string;
		artifactHash: string;
	}>;
	createdAt: string;
};
```

`releaseDigest`は、上記fieldとartifact matrixをcanonicalizeして生成する。同じSystemContext versionでもdefinition、compiler、locale、model profileのいずれかが変われば別releaseになる。release作成後はsourceを変更せず、変更時は新しいSystemContext versionとreleaseを作る。

### 7.5 Compile Context

```ts
type SystemContextCompileContext = {
	releaseDigest: string;
	instructionLocale: string;
	responseLocale: string;
	modelProfile: string;
	runtimeFacts?: Record<string, boolean | string | number>;
};
```

条件分岐に使用できるのは構造化されたruntime factに限定する。ユーザー文章に対するregexやkeyword conditionはS11t schemaへ導入しない。

Experimentのarmはsource内の暗黙variantではなく、必ずSystemContextの`releaseDigest`で指定する。Assignment resolverはcompile前にstable releaseまたはexperiment releaseを選び、compilerへ明示的なrelease digestを渡す。

## 8. Deterministic Compilation

Compilerは次の順で処理する。

1. SystemContext IDを解決する。
2. TOMLをschema検証する。
3. stable mappingまたはexperiment assignmentからexact `releaseDigest`を解決する。
4. releaseに含まれるdefinition、compiler version、artifact matrixを検証する。
5. instruction localeを解決する。
6. fallback policyを検証する。
7. model profile overrideを適用する。
8. sectionをsource orderで結合する。
9. variable declarationと利用箇所を検証する。
10. runtime valuesを展開する。
11. newlineをLFへ正規化する。
12. artifactとmanifestを生成する。
13. usage collectorへ未確定usage tokenを登録する。

同じrelease digest、compile context、valuesから同じartifactを生成する。usage tokenはこの時点ではexposureではなく、provider requestへの採用と送信受理後にだけcommitできる。

### 8.1 Locale fallback

fallbackは便利だが、translation欠落を隠すため環境別policyを持つ。

| Environment | Policy |
| --- | --- |
| development | 欠落localeをerrorにする |
| CI | 必須localeと全`must` sectionの欠落をerrorにする |
| production | applicationが明示許可したlocaleだけfallback可能 |
| trace | fallback利用をmanifestへ必ず記録する |

`must`または`host` sectionについて、locale fallback自体を禁止するstrict modeを提供する。

### 8.2 Model profile

model profileはPrompt本文からprovider credentialやendpointを分離し、表現上の差分だけを扱う。

```toml
[profiles.openai-primary]
supports_system_role = true
supports_native_schema = true

[profiles.local-small]
supports_system_role = false
supports_native_schema = false
max_input_tokens = 16000
```

model profile overrideで`must` sectionを削除できない。完全置換より、prefix、suffix、section substitution等の限定操作を優先する。

## 9. Repository, Monorepo, and Distribution Strategy

### 9.1 Dedicated repository

S11tはNightWorkers repository内のworkspace packageとして開始せず、最初から専用Git repositoryを作る。その専用repositoryの内部をmonorepoにし、core、TOML loader、Node runtime、eval、experiments、CLI等を独立packageとして管理する。

推奨する理由:

- NightWorkers固有のRole、workflow、内部contractがS11t coreへ混入しにくい。
- Apache-2.0のlicense boundaryをrepository rootで明確にできる。
- issue、release、security advisory、contribution processをOSS単独で運用できる。
- NightWorkers以外のconsumerをfirst-classとして検証できる。
- npm packageのpublic APIとsemver compatibilityを強制できる。

NightWorkers側にはS11tのproduction codeをcopyしない。NightWorkers固有のSystemContext Definition、eval dataset、provider integrationだけをNightWorkers repositoryに置き、公開packageを通常のdependencyとして利用する。

```text
s11t repository (Apache-2.0)
  -> npm public packages / canary packages
  -> NightWorkers repository (consumer)
       contexts/*.context.toml
       private eval datasets
       NightWorkers-specific provider and outcome adapters
```

初期dogfoodingでは、`latest`へ未検証versionを公開しない。専用repositoryのCIがcommit単位のcanary packageを生成し、NightWorkersはexact versionまたはdigest付きpackageを検証する。安定後に正式versionをnpmへ公開する。

- local開発: `pnpm pack`で生成したtarball、または一時的なlinkを使用する。machine固有の`file:../...` dependencyはcommitしない。
- CI統合: immutableなcanary versionを使用し、NightWorkersのlockfileへexact versionを記録する。
- stable利用: semver versionを指定し、意図しないmajor/minor updateを自動適用しない。
- release: Changesets等でpackage別versionとchangelogを生成し、npm provenance付きで公開する。

NightWorkersの現在のlicenseとS11tのApache-2.0は依存関係として併用できる。S11tのpackage metadataへ`license: "Apache-2.0"`を設定し、repository rootに`LICENSE`と必要な`NOTICE`を置く。

### 9.2 Internal monorepo structure

正式名は`S11t`とする。npm distributionは`s11tnext`と`s11tnext-cli`に確定している。project名とdomain terminologyは変更しない。

```text
s11t/
  packages/
    core/
      SystemContext schema、compiler、p() facade、manifest
    toml/
      TOML loader、source mapping、diagnostics
    node/
      filesystem loader、cache、watch、build integration
    eval/
      eval suite、runner、metric contract、comparison
    experiments/
      deterministic assignment、exposure、outcome、decision
    optimizer/
      candidate generation contract、protected section enforcement
    cli/
      lint、typegen、compile、eval、experiment、promote
    adapters/
      provider、storage、observability用の薄いadapter contract
  examples/
    typescript-basic/
    multilingual-agent/
    ab-experiment/
  fixtures/
    contexts/
    evals/
  docs/
    specification/
    guides/
    governance/
  schemas/
    system-context.schema.json
    eval.schema.json
    experiment.schema.json
  LICENSE
  NOTICE
  CONTRIBUTING.md
  GOVERNANCE.md
  SECURITY.md
```

初期の公開packageはruntimeの`s11tnext`とauthoring/build用の`s11tnext-cli`である。CLI binaryは`s11tnext`とする。

### 9.3 Package boundaries

- `core`はNode filesystem、provider SDK、databaseへ依存しない。
- `toml`はsourceをcanonical SystemContext Definitionへ変換する。
- `node`はfilesystem I/Oとbuild-time cacheだけを所有する。
- `eval`は評価contractを所有し、特定providerのjudgeへ固定しない。
- `experiments`は割当と結果contractを所有し、applicationのユーザーDBを所有しない。
- `optimizer`はcandidate生成だけを所有し、promotionを実行しない。
- `cli`は各packageをcompositionするが、独自の意味contractを重複定義しない。
- `adapters`には薄いportだけを置き、外部platformの内部modelをcoreへ漏らさない。

## 10. Evaluation Architecture

### 10.1 評価level

| Level | 対象 | 主な検証 |
| --- | --- | --- |
| Static | TOMLと定義 | schema、locale、変数、rule、token、重複 |
| Section Unit | 個別section | 行動、format、constraint、locale差 |
| SystemContext Integration | Compiled SystemContext | section競合、優先順位、message境界、token budget |
| Agent Trajectory | Agent実行 | tool選択、順序、権限、完了判断、実成果 |

各SystemContextは最低1つのeval suiteを参照する。単独でLLM callできないsectionはStaticとSystemContext Integrationによってcoverageを得る。

### 10.2 Eval suite example

```toml
schema_version = 1

[suite]
id = "codingAgent.identity.behavior"
version = "1.0.0"
target = "codingAgent:identity"
level = "system-context"
locales = ["ja-JP", "en-US"]
model_profiles = ["openai-primary", "anthropic-primary"]
samples_per_case = 5

[[metrics]]
id = "required-action"
kind = "trajectory-assertion"
weight = 1.0
hard_gate = true

[[metrics]]
id = "system-context-tokens"
kind = "numeric"
direction = "minimize"
hard_gate = false

[[cases]]
id = "plan-before-editing"
description = "仕様と完了条件が未確定の実装Taskでは、編集前に計画を作る。"

[cases.input]
task = "認証機能を追加してください"
specification_complete = false

[cases.expected]
required_actions = ["todo.create"]
forbidden_actions = ["workspace.edit"]
```

大規模datasetはTOMLへ全件を埋め込まず、suite TOMLからversion付きJSONL、Parquet、database dataset等を参照できるようにする。TOMLは人間が読むconfiguration、datasetは交換可能なrecord集合として分ける。

Datasetは目的別に分離する。

| Partition | 用途 | Optimizer access |
| --- | --- | --- |
| discovery | 本番failureの調査とcase候補作成 | 可 |
| train | candidate生成、few-shot探索 | 可 |
| development | 人間による反復評価 | scoreのみ可 |
| locked holdout | 最終offline promotion gate | input、labelとも原則不可 |
| online | A/Bの実運用outcome | aggregateのみ可 |

locked holdoutのcaseとlabelはoptimizerへ渡さず、candidate作成者が繰り返し閲覧できないようにする。同じholdoutを長期間使い続けず、漏洩または過適合が疑われる場合は新versionへ更新する。

### 10.3 Metric categories

#### Hard gates

- authorization violation
- forbidden tool usage
- required tool前提条件の欠落
- output schema invalid
- role boundary violation
- destructive action without precondition
- must sectionの欠落

Hard gateはcostやlatency改善と相殺しない。

#### Quality

- task success
- factual correctness
- required action completion
- unnecessary question rate
- correction cycle rate
- human review score
- user acceptanceまたは明示feedback

#### Efficiency

- input/output token
- provider cost
- latency
- tool call count
- retry count

#### Stability

- repeated sample pass rate
- locale間behavior差
- model間behavior差
- variance
- schema first-pass rate

### 10.4 Baseline

改善を主張する前に、stable versionを同じdataset、model、locale、provider configurationで実行してbaselineを採取する。

Eval resultには最低限次を保存する。

```ts
type SystemContextEvaluationResult = {
	systemContextId: string;
	systemContextVersion: string;
	releaseDigest: string;
	artifactHash: string;
	compilerVersion: string;
	suiteId: string;
	suiteVersion: string;
	datasetVersion: string;
	datasetPartition: "train" | "development" | "locked-holdout";
	locale: string;
	provider: string;
	model: string;
	modelParameters: Record<string, unknown>;
	judgeVersion: string | null;
	samples: number;
	metrics: Record<string, number | boolean>;
	hardGateViolations: string[];
	tokenAverage: number;
	latencyP95: number;
	costAverage: number;
	createdAt: string;
};
```

model名だけでなく、provider、parameter、judge version、dataset version、partition、release digestを保存する。controlとcandidateは可能な範囲で同じ時間帯にinterleaveし、judgeにはarm名を隠す。seedだけでLLM出力の完全再現性を保証しない。

## 11. A/B Experiment Design

### 11.1 位置づけ

A/B testはoffline evalの代替ではない。

```text
Static / Offline Eval
  -> Shadow or Replay
  -> Online A/B
  -> Promotion Gate
```

Hard gate違反、安全性回帰、schema回帰があるcandidateを実ユーザーtrafficへ流さない。online A/Bはofflineでは測れない実Task成功、継続利用、correction、cost等を比較するために使う。

### 11.2 Experiment Definition

```ts
type SystemContextExperiment = {
	id: string;
	revision: number;
	status: "draft" | "scheduled" | "running" | "paused" | "completed";
	targetSystemContextId: string;
	control: ExperimentArmRef;
	candidates: ExperimentArmRef[];
	allocation: Record<string, number>;
	randomizationUnit: "user" | "session" | "task" | "run" | "project";
	assignmentSeed: string;
	eligibility: StructuredEligibility;
	analysisPlan: ExperimentAnalysisPlan;
	maximumDurationMs: number;
	attributionWindowMs: number;
	createdAt: string;
};

type ExperimentArmRef = {
	name: string;
	systemContextId: string;
	releaseDigest: string;
	allowedArtifacts: Array<{
		locale: string;
		modelProfile: string;
		artifactHash: string;
	}>;
};

type ExperimentAnalysisPlan = {
	version: string;
	primaryMetric: MetricRef;
	guardrailMetrics: MetricRef[];
	minimumUniqueUnitsPerArm: number;
	plannedUniqueUnitsPerArm: number;
	minimumDetectableEffect: number;
	power: number;
	alpha: number;
	multipleComparisonCorrection: "none" | "holm";
	hardSafetyEvents: string[];
};

type MetricRef = {
	id: string;
	direction: "increase" | "decrease";
	valueType: "boolean" | "numeric";
	unitAggregation: "first" | "last" | "mean" | "sum" | "any";
	missingOutcomePolicy: "fail" | "exclude" | "zero";
	minimumCoverageRatio: number;
};

type MetricComparison = {
	metricId: string;
	candidateArm: string;
	controlUniqueUnits: number;
	candidateUniqueUnits: number;
	controlValue: number;
	candidateValue: number;
	absoluteEffect: number;
	relativeEffect: number | null;
	uncertaintyInterval: [number, number];
	pValue: number | null;
	passesDecisionThreshold: boolean;
};
```

Experiment開始後にcontrol、candidate、artifact matrix、analysis planを変更しない。変更する場合は新しいexperiment revisionを作り、旧revisionの結果と混ぜない。各armはSystemContext versionではなくimmutableなrelease digestを参照する。

### 11.3 Assignment

割当は決定的かつstickyにする。

```text
bucket = hash(algorithmVersion + experimentId + revision + assignmentSeed + randomizationUnitId)
arm = allocation[bucket]
```

同じrandomization unitはexperiment中に同じarmを受け取る。会話途中でSystem promptが切り替わるcarryoverを避けるため、chatやAgent sessionでは`session`または`task`を既定候補とする。

hash algorithm、canonical input encoding、bucket range、allocation境界をversion付きcontractとして固定する。分析はexposure行ではなくrandomization unitを独立標本として行い、unit内の複数outcomeは各MetricRefで事前指定した`unitAggregation`で1値へ集約する。`project`等のcluster数が少ない単位では必要unit数を満たせないため、winnerを出さない。

unit IDはapplicationが提供する。S11tは個人情報を直接保存せず、必要ならapplication側でHMAC等により不可逆なassignment keyへ変換する。

### 11.4 Eligibility

eligibilityは構造化されたfieldだけで定義する。

```ts
type StructuredEligibility = {
	locales?: string[];
	modelProfiles?: string[];
	applicationEnvironments?: string[];
	requiredFacts?: Record<string, boolean | string | number>;
};
```

ユーザーprompt本文のkeywordやregexで実験対象を分類しない。Taskの意味によるeligibilityが必要な場合は、applicationまたはLLMが構造化されたexperiment eligibilityを決定し、そのprovenanceを保存する。

### 11.5 Exposure

assignmentしただけではexposureに数えない。対象Compiled SystemContextが実際に生成され、LLM requestへ採用された時点でexposureを記録する。

```ts
type SystemContextExposure = {
	id: string;
	experimentId: string;
	experimentRevision: number;
	randomizationUnitKeyHash: string;
	arm: string;
	systemContextId: string;
	releaseDigest: string;
	artifactHash: string;
	resolvedLocale: string;
	modelProfile: string;
	invocationId: string;
	providerRequestId: string;
	runId?: string;
	occurredAt: string;
	idempotencyKey: string;
};
```

同じLLM requestのretryを重複exposureとして数えないよう、applicationはidempotency keyを渡す。`p()`によるcompile時は未確定usageとして記録し、S11t-aware provider adapterまたは明示commit APIが実際に送信したInvocationとprovider request IDを確認して初めてExposureへ変換する。送信されなかったInvocationはexposureにしない。

分析reportはarmごとにassignment数、unique exposed unit数、exposure数を別々に表示する。割当比率が計画から不自然にずれるSample Ratio Mismatchを検査し、SRMが解消されないexperimentからwinnerを出さない。

### 11.6 Outcome attribution

OutcomeはLLMの最終本文だけでなく、applicationの永続化された観測事実から作る。

```ts
type ExperimentOutcome = {
	id: string;
	idempotencyKey: string;
	exposureId: string;
	randomizationUnitKeyHash: string;
	metricId: string;
	value: number | boolean;
	source: "application" | "user" | "human-review" | "judge" | "system";
	observedAt: string;
	sourceRevision: string;
	revision: number;
	status: "final" | "retracted";
	supersedesOutcomeId?: string;
};
```

候補例:

- Task terminal success。
- schema validation first-pass。
- required verification pass。
- correctionまたは再実行の有無。
- user feedback。
- human review。
- token、cost、latency。
- forbidden actionまたはsecurity guardrail violation。

Outcome attribution windowを事前に定義し、experiment結果を見た後で都合よく変更しない。同じ`idempotencyKey`はexactly-onceで保存する。同じsource factが訂正された場合は既存recordを上書きせず、revisionを増やして`supersedesOutcomeId`を指定する。分析時はdata cutoff以前の最新`final` revisionだけを採用し、retracted recordを除外する。

### 11.7 Decision rule

初期versionでは理解しやすいfixed-horizon判定を既定とする。

1. primary metricをexperiment開始前に1つ指定する。
2. hard safety eventと集計型guardrail metricを分ける。
3. MDE、power、alphaからplanned unique unit数を事前に固定する。
4. minimum unique unit数に達するまでwinnerを確定しない。
5. randomization unitごとにmetricを集約してからarmを比較する。
6. maximum durationまたはplanned unit数到達時のdata cutoffで分析する。
7. controlとの差、effect size、uncertainty intervalを報告する。
8. SRM、重大なmissing outcome、artifact不一致がある場合は`invalid_experiment`とする。
9. guardrailが悪化したcandidateはprimary metricが良くてもrejectする。
10. 有意な差がない場合は`no_winner`とする。

途中結果を繰り返し見て都合の良い時点でwinnerを決めるoptional stoppingを既定運用にしない。authorization violation等の単発hard safety eventはいつでもexperimentを停止できるが、これはwinner判定ではない。schema success rate等の集計型guardrailを途中判定する場合は、事前定義したsequential boundaryを持つ別analysis adapterを要求する。Sequential testやBayesian decisionは、判定contractとsimulation testを追加した後のadapterとして扱う。

複数candidate、複数primary metric、segmentの後付け比較を行う場合はmultiple comparisonとselection biasを結果へ明記する。

candidateが複数あるexperimentで`multipleComparisonCorrection = "none"`を指定することはvalidation errorにする。missing outcomeの扱いと最低coverageをmetricごとに事前登録し、armごとの欠測率に大きな差がある場合はwinnerを出さない。

### 11.8 Experiment result

```ts
type ExperimentDecision = {
	experimentId: string;
	decision:
		| "promote_candidate"
		| "keep_control"
		| "no_winner"
		| "stop_guardrail_violation"
		| "invalid_experiment"
		| "insufficient_data";
	winnerArm: string | null;
	primaryMetric: MetricComparison;
	guardrails: MetricComparison[];
	assignmentCounts: Record<string, number>;
	uniqueExposedUnitCounts: Record<string, number>;
	exposureCounts: Record<string, number>;
	sampleRatioMismatch: boolean;
	segmentDiagnostics: Record<string, unknown>;
	analysisPlanHash: string;
	analysisVersion: string;
	dataCutoffAt: string;
	decidedAt: string;
};
```

結果はcandidate本文を上書きする命令ではなく、promotion commandへ渡すevidenceである。

## 12. Promotion and Rollback

### 12.1 Lifecycle

```text
editable source draft
  -> immutable candidate release
  -> offline_validated
  -> canary_or_ab
  -> stable
  -> retired
```

TOMLの`authoring_status`はsource fileの編集状態だけを表す。`candidate`以降はSystemContext Release registryの状態であり、source TOMLのfieldではない。runtimeのstable解決は、immutable release digestとartifact matrixを指すPromotion Manifestを唯一の正本にする。

```toml
schema_version = 1

[stable."codingAgent:identity"]
version = "1.3.0"
release_digest = "sha256:..."
promoted_from_experiment = "exp-coding-agent-identity-013"
promoted_at = 2026-07-21T12:00:00Z

[[stable."codingAgent:identity".artifacts]]
locale = "ja-JP"
model_profile = "openai-primary"
artifact_hash = "sha256:..."

[[stable."codingAgent:identity".artifacts]]
locale = "en-US"
model_profile = "openai-primary"
artifact_hash = "sha256:..."
```

### 12.2 Promotion Policy

Promotion gateをproseだけにせず、version付きPolicyとして機械可読にする。

```toml
schema_version = 1

[policy]
id = "high-risk-agent"
version = "1.0.0"
risk_class = "high"
required_locales = ["ja-JP", "en-US"]
required_model_profiles = ["openai-primary"]
required_eval_levels = ["static", "section-unit", "system-context", "trajectory"]
online_experiment = "required"
minimum_human_approvals = 1

[policy.budgets]
max_system_context_tokens = 12000
max_cost_regression_ratio = 1.05
max_latency_regression_ratio = 1.10

[policy.regression]
minimum_primary_effect = 0.0
maximum_quality_regression = 0.0
hard_gate_tolerance = 0
```

SystemContext Definitionの`promotion_policy`はexact policy IDを参照し、evidenceにはpolicy versionとhashを保存する。Policy変更後に過去evidenceを流用せず、新Policyで再検証する。

Promotion commandは次のimmutableなEvidence Bundleを検証する。

```ts
type PromotionEvidenceBundle = {
	id: string;
	bundleHash: string;
	releaseDigest: string;
	promotionScope: Array<{
		locale: string;
		modelProfile: string;
		artifactHash: string;
	}>;
	policy: {
		id: string;
		version: string;
		hash: string;
	};
	offlineEvaluationResultIds: string[];
	lockedHoldoutResultIds: string[];
	assemblyResultIds: string[];
	trajectoryResultIds: string[];
	experimentDecisionIds: string[];
	approvalIds: string[];
	createdAt: string;
};
```

Bundle作成後に参照evidenceを差し替えない。Promotion時にはbundle hash、release digest、Policy hash、各resultのartifact hashを再検証する。

### 12.3 Promotion gate

candidateは次をすべて満たした場合だけstableへ昇格できる。

- SystemContext Definitionとcompileがvalid。
- Policyが要求する全localeとmodel profileのartifactがreleaseに存在する。
- 全hard gateがpass。
- stable baselineに対するoffline regressionが許容範囲内。
- SystemContext Integrationがpass。
- 対象がAgent SystemContextの場合、必要なTrajectory evalがpass。
- Policyがonline A/Bを要求する場合、同じrelease digestと対象artifact matrixについてexperiment decisionが`promote_candidate`。
- token、cost、latencyの設定済みbudgetを満たす。
- exact release digest、compiler version、artifact hashが全evidenceと一致する。
- approval policyを設定したprojectでは必要な人間approvalがある。

一部localeまたはmodel profileだけが評価済みの場合、未評価cellを含むglobal promotionを禁止する。Policyが許可する場合のみ、明示的なscope付きpromotionとして別stable mappingを作る。Promotion commandは単一experiment IDではなく、offline eval、holdout、assembly、trajectory、online experiment、approvalを含むimmutableなEvidence Bundleを要求する。

### 12.4 Rollback

stable mappingを以前のimmutable release digestへ戻すことでrollbackする。過去release、artifact、eval result、experiment resultを削除しない。

rollback trigger例:

- production guardrail violation。
- schema success rateの急落。
- correction cycleの増加。
- model update後のbehavior regression。
- locale固有の重大回帰。

## 13. Continuous Improvement Loop

```text
Production trace / user feedback / human review
  -> failure case候補
  -> dataset curatorが採否を判断
  -> version付きeval datasetへ追加
  -> humanまたはoptimizerがcandidate生成
  -> static + offline eval
  -> replay / shadow
  -> A/B experiment
  -> promotion decision
  -> stable or reject
  -> production monitoring
```

### 13.1 Dataset curation

本番失敗を自動的に正解ラベルとして採用しない。次を区別する。

- user input。
- 実際のLLM output。
- tool trajectory。
- persisted application outcome。
- human annotation。
- judge score。
- expected behavior。

failure caseをdatasetへ入れる際は、privacy、再配布権、PII、retentionを確認する。公開benchmarkとprivate application datasetを分離する。

Optimizerが参照できるのはdiscovery、train、およびdevelopmentの限定feedbackまでとする。locked holdoutのinput、label、case単位scoreをoptimizerとcandidate作成者へ公開しない。Promotion evaluatorはholdoutを隔離環境で実行し、aggregate resultとhard gate違反だけをEvidence Bundleへ記録する。

同じholdoutに対する反復回数を監査し、一定回数を超えた場合やcase漏洩が疑われる場合はdataset versionを更新する。A/B winnerをholdoutへ追加するだけで正解ラベルにせず、人間reviewまたは永続化されたapplication outcomeで妥当性を確認する。

### 13.2 Optimizer boundary

optimizerは次だけを行う。

- editable sectionのcandidate textを提案する。
- few-shot example候補を提案する。
- section順または表現のcandidateを提案する。
- datasetとmetricに基づく予測scoreを添付する。

optimizerは次を行わない。

- `optimizable = false` sectionの変更。
- host/schema enforcementのprompt化。
- stable mappingの更新。
- production experimentの開始。
- evaluation resultの上書き。
- hard gateを総合scoreで相殺すること。

```toml
[optimization]
mode = "candidate_only"
objectives = ["task_success", "schema_success", "system_context_tokens"]
protected_section_kinds = ["tool-contract", "output-contract"]
editable_section_kinds = ["instruction", "runtime-fact", "overlay"]
```

## 14. Observability and Privacy

### 14.1 Default trace

既定では次だけを保存する。

- SystemContext ID、version、release digest、artifact hash。
- locale、fallback、model profile。
- section ID。
- compiler version。
- eval suite ID。
- experiment ID、revision、arm。
- token、latency、cost等のusage。

### 14.2 Sensitive data

動的values、rendered SystemContext、user messageは既定で保存しない。applicationが明示的に許可した場合のみ、redaction、encryption、retentionを設定して保存する。

Experiment assignment keyには生のuser IDやemailを保存しない。storage adapterはtenant境界、revision、idempotency、retentionを検証する。

## 15. CLI Proposal

CLI名は正式名と揃えて`s11t`とする。

```text
s11tnext lint
s11tnext typegen
s11tnext compile --locale ja-JP --profile openai-primary
s11tnext diff codingAgent:identity --from 1.2.0 --to 1.3.0
s11tnext eval codingAgent:identity
s11tnext eval --suite codingAgent.role-boundary
s11tnext experiment validate experiment.toml
s11tnext experiment report exp-001
s11tnext evidence build codingAgent:identity --release sha256:...
s11tnext promote codingAgent:identity --release sha256:... --evidence-bundle evidence.json
s11tnext rollback codingAgent:identity --to-release sha256:...
```

### 15.1 Lint requirements

- schema versionがsupported。
- SystemContext IDが重複しない。
- SemVerがvalid。
- source localeが存在する。
- 必須localeと全must section translationが存在する。
- section IDがSystemContext内で一意。
- variable参照が宣言と一致する。
- required variableが未使用でない。
- untrusted variableが禁止placementにない。
- untrusted variableに安全でないraw encodingが指定されていない。
- text outputにseparate-message variableが含まれていない。
- model overrideがprotected sectionを削除しない。
- eval suite参照が解決可能。
- stable manifestのrelease digestとartifact matrixが保存済みreleaseに一致する。
- releaseの全artifact cellがdefinition、compiler version、locale、model profileから再生成可能。
- promotion policy、required locale、required model profileが解決可能。

## 16. Storage and Adapter Contracts

OSS coreは特定databaseを要求しない。

```ts
interface SystemContextArtifactStore {
	put(artifact: CompiledSystemContext): Promise<void>;
	get(ref: SystemContextArtifactRef): Promise<CompiledSystemContext | null>;
}

interface EvaluationStore {
	append(result: SystemContextEvaluationResult): Promise<void>;
	query(input: EvaluationQuery): Promise<SystemContextEvaluationResult[]>;
}

interface ExperimentStore {
	readExperiment(id: string): Promise<SystemContextExperiment | null>;
	recordExposureOnce(exposure: SystemContextExposure): Promise<"created" | "duplicate">;
	recordOutcomeOnce(outcome: ExperimentOutcome): Promise<"created" | "duplicate">;
	readAnalysisSnapshot(input: {
		experimentId: string;
		revision: number;
		dataCutoffAt: string;
	}): Promise<ExperimentAnalysisSnapshot>;
	compareAndUpdate(
		id: string,
		expectedRevision: number,
		update: SystemContextExperiment,
	): Promise<void>;
}
```

filesystem、SQLite、PostgreSQL、外部observability platform等はadapterとして提供できる。副作用を伴うexperiment開始、停止、promotionはrevisionとidempotencyを検証する。ExposureとOutcomeのidempotency keyにはunique constraintを要求し、分析はdata cutoff付きのimmutable snapshotを対象にする。

## 17. Versioning

次のversionを分離する。

- SystemContext schema version。
- Compiler version。
- SystemContext semantic version。
- SystemContext Release digest。
- Artifact hash。
- Eval suite version。
- Dataset version。
- Experiment revision。
- Promotion Policy version。
- Evidence Bundle hash。
- Analysis implementation version。

SystemContextのsection変更はdefinition hashを必ず変える。semantic versionのbump漏れはlintで検出する。compiler、locale、model profileの差はartifact hashとrelease digestへ反映する。source Git commitはprovenanceとして記録できるが、SystemContext versionまたはrelease digestの代替にはしない。

破壊的schema変更はmigration commandまたは互換loaderを提供する。runtimeが未知schemaを黙って解釈しない。

## 18. OSS License and Governance

### 18.1 License

独立OSSはApache License 2.0を推奨する。

対象:

- compiler、runtime、CLI。
- SystemContext JSON SchemaとTOML schema。
- bundled templateとexample。
- adapter contract。
- test fixture。

理由:

- 商用、社内、SaaS利用を妨げない。
- 利用者のSystemContext公開を要求しない。
- 明示的な特許許諾を含む。
- MIT、BSD、Apache-2.0 dependencyと組み合わせやすい。
- 企業での導入とforkを許容する。

ユーザーが作成したSystemContext、prompt section、locale、private dataset、generated outputについて、S11t projectは所有権を主張しない。READMEと利用規約相当の文書に明記する。

公開datasetを同梱する場合は、record単位のprovenanceとlicenseを管理する。外部datasetをApache-2.0へ一括変更しない。

### 18.2 Contribution

初期はDCO方式を候補とし、重いCLAを必須にしない。Contributorが第三者の非公開System promptや利用許諾のないeval dataを持ち込まないことをCONTRIBUTINGへ明記する。

### 18.3 Governance

少なくとも次の変更にはRFCを要求する。

- SystemContext schemaの破壊的変更。
- compile semanticsの変更。
- experiment decision ruleの追加または既定変更。
- promotion safety gateの緩和。
- license変更。

## 19. Implementation Phases

### Phase 0: Contract and Fixtures

成果物:

- NightWorkersとは分離したOSS repositoryとApache-2.0 license boundary。
- SystemContext TOML schema draft。
- Core TypeScript typeとZod schema。
- SystemContext Release、Artifact Identity、Promotion Policy、Evidence Bundle schema。
- simple、sectioned、multi-locale fixture。
- API IO contract。
- compile canonicalization rule。
- license、governance、security文書。

検証:

- fixtureをparseして期待するcanonical definitionになる。
- invalid fixtureが明確なpath付きdiagnosticで失敗する。
- 同じfixtureから同じhashが生成される。
- localeまたはmodel profileが異なるartifactを同一release内で一意に識別できる。
- packageをpackし、fixture consumer repositoryからinstallできる。

次段階条件:

- schemaと`p()` contractのreviewが完了している。

### Phase 1: Core Catalog and `p()`

成果物:

- TOML loader。
- Catalog registry。
- locale resolution。
- deterministic compiler。
- request-scoped `bind()`と`p()`。
- SystemContext Invocation、manifest、usage token、exposure commit。
- in-memory、filesystem loader。

検証:

- simpleとsectioned SystemContextをcompileできる。
- 同時request間でlocaleが混ざらない。
- fallbackがpolicyどおりに動作する。
- protected sectionが欠落しない。
- message SystemContextをtextへ暗黙変換できない。
- compileしただけのInvocationがexposureにならない。

### Phase 2: CLI and Type Generation

成果物:

- `lint`、`typegen`、`compile`、`diff`。
- generated SystemContextKeyとvalues型。
- build-time compiled artifact。
- s11t.lock.toml。

検証:

- typo、欠落値、余分な値がTypeScript errorになる。
- semantic versionとdefinition hashの不一致を検出する。
- runtimeがsource filesystemを毎回読まない。

### Phase 3: Offline Evaluation

成果物:

- eval suite schema。
- metric、runner、provider adapter contract。
- static、unit、assembly runner。
- baseline comparison report。
- discovery、train、development、locked holdoutのpartition contract。
- result storage adapter。

検証:

- controlとcandidateを同じdatasetで比較できる。
- localeとmodel matrixを実行できる。
- hard gate違反が総合scoreによりpassにならない。
- optimizerからlocked holdoutのcaseとlabelを取得できない。

### Phase 4: Experiment and A/B Test

成果物:

- experiment schema。
- deterministic sticky assignment。
- exposure、outcome、decision contract。
- fixed-horizon analyzer。
- randomization unit集約、power/MDE、SRM検査。
- pause、stop、report。
- promotion evidence連携。

検証:

- 同じunitが同じarmへ割り当たる。
- allocationが統計的に設定比率へ近づく。
- retryでexposureが重複しない。
- Outcomeのretryとrevision訂正が重複集計されない。
- exposureのないoutcomeをwinner判定へ混ぜない。
- 同一unitの複数exposureを独立標本として数えない。
- SRMがあるexperimentをinvalidにする。
- guardrail悪化candidateがpromoteされない。
- insufficient dataをwinnerにしない。

### Phase 5: Promotion and Rollback

成果物:

- stable manifest更新command。
- evidence validation。
- Promotion PolicyとEvidence Bundle validation。
- atomic promotion。
- rollback。
- audit log。

検証:

- experiment対象と異なるrelease digestまたはartifact hashをpromoteできない。
- 未評価のlocaleまたはmodel profileをglobal promotionできない。
- revision conflictで同時promotionを拒否する。
- 過去stableへ戻して同じartifactを再取得できる。

### Phase 6: Optimizer Adapters

成果物:

- candidate generator contract。
- protected section enforcement。
- objective、budget、dataset参照。
- external optimizer adapter examples。

検証:

- optimizerがstableを直接変更できない。
- protected sectionの変更candidateをrejectする。
- 生成candidateが通常のevalとpromotionを迂回できない。

## 20. Initial Release Scope

`v0.1`はPhase 0からPhase 2、および最小のStatic Evalを対象とする。

含める:

- NightWorkersと分離したpublic OSS repository。
- TOML authoring。
- simpleとsectioned SystemContext。
- multi-locale。
- `p()` facade。
- SystemContext Invocation、deterministic compile、Release、manifest。
- Zod validation。
- lintとtypegen。
- npm canary publishとpackされたpackageによるconsumer integration test。
- Apache-2.0 OSS release。

含めない:

- hosted UI。
- online A/B runtime。
- automatic optimizer。
- provider固有の多数のadapter。

`v0.2`でoffline eval、`v0.3`でexperimentとpromotionを候補とする。version番号は実装後の互換性判断で変更できる。

## 21. Acceptance Criteria

プロジェクトの中核設計が成立したと判断する条件:

1. 利用者がTOMLを追加し、型付き`p()`でSystemContext Invocationを取得できる。
2. 日本語と英語が同じSystemContext IDとsection IDへ対応する。
3. 実行SystemContextのversion、release digest、locale、artifact hash、compiler versionを追跡できる。
4. 同じ入力条件で同じcompiled artifactを生成できる。
5. 欠落locale、未宣言変数、protected section変更をCIで検出できる。
6. 各SystemContextのeval coverageを一覧できる。
7. controlとcandidateを同じdatasetで比較できる。
8. A/B testが決定的割当、送信確定exposure、冪等なoutcome、randomization unit、guardrailを保持する。
9. 改善が確認できない場合は`no_winner`または`keep_control`になる。
10. promotion後も以前のimmutable releaseへrollbackできる。
11. optimizerがproduction stableを直接変更できない。
12. libraryが特定provider、Agent runtime、hosted serviceを必須にしない。
13. 未評価のlocaleまたはmodel profileをglobal promotionできない。
14. Optimizerがlocked holdoutのcaseとlabelへaccessできない。
15. NightWorkersが公開またはcanary npm packageだけを通じて利用できる。

## 22. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `p()`がversionを隠す | SystemContext Invocationへmanifestとusage tokenを保持 |
| string化でmessage境界を失う | 自動coercionを禁止し、output kindを型で区別 |
| global localeの競合 | request/run scoped `bind()` |
| fallbackがtranslation欠落を隠す | CI strict modeとfallback trace |
| 長文全体の翻訳・最適化drift | 重要SystemContextをstable section IDへ分割 |
| TOML schemaが複雑化する | simple modeを保ち、advanced fieldを任意化 |
| untrusted値がSystem policyへ混入 | raw encoding禁止、構文escape、message分離。ただしencodingをsecurity boundaryとみなさない |
| 個別sectionだけの評価で安心する | SystemContext IntegrationとTrajectory evalを別levelで要求 |
| A/Bの途中停止で偽陽性 | fixed horizonを既定にしdecision ruleをversion化 |
| 同じunitの複数利用を独立標本とみなす | randomization unit単位に事前指定方法で集約 |
| 割当実装不具合でarm比率が偏る | SRM検査でexperimentをinvalid化 |
| arm割当後に本文が変わる | immutable release digestとartifact matrixをexperimentへ固定 |
| compileだけでexposureが増える | provider送信受理後のcommitを必須化 |
| Outcome retryや訂正を重複集計する | unique idempotency keyとappend-only revision |
| 失敗outcomeが記録されないsurvivorship bias | terminal failureもapplication outcomeとして記録 |
| localeやmodelのsegment差を見落とす | matrix評価とsegment diagnostics |
| primary metric改善が安全性を悪化させる | hard guardrailは相殺不可 |
| optimizerが必須規則を短縮する | optimizable flagとprotected kind |
| optimizerがbenchmarkへ過適合する | locked holdoutを隔離し、閲覧・反復回数を監査 |
| 実験データにPIIが残る | HMAC assignment key、redaction、retention |
| package境界がplatform化する | CoreをI/O・provider非依存に維持 |

## 23. Open Questions

公開後も継続して判断する事項:

1. TOMLでsimpleとsectioned SystemContextを同一fileに許可する最終schema。
2. localeを同一fileに置く方式を既定としつつ、分割fileをいつ対応するか。
3. interpolation記法を`[[name]]`に固定するか、設定可能にするか。
4. TypeScript型生成を必須にするか、runtime-only利用もfirst-classにするか。
5. fixed-horizon analyzerで最初に提供する統計手法。
6. public benchmarkに含められるlicense済みdatasetの範囲。
7. Stable manifestをGitのみで運用するか、registry adapterも初期提供するか。
8. DCO、maintainer権限、RFC acceptance process。

## 24. Recommended First Decisions

初期実装を始める前の推奨判断:

- OSS licenseはApache-2.0。
- 正式なproject名は`S11t`、repository名とCLI名は`s11tnext`とする。
- NightWorkersとは別のpublic Git repositoryで開始し、S11t内部はmonorepoにする。
- NightWorkersはcopyや内部workspace importではなく、exact versionのnpm packageを利用する。
- TypeScriptをreference implementationにする。
- TOML parser、schema validator、i18n engineは交換可能な内部依存として包む。
- `p()`を通常利用の唯一のlookup facadeにし、primitive stringではなくSystemContext Invocationを返す。
- `p()`はrun/requestへbindし、global mutable localeを持たない。
- 1 SystemContext IDを1 TOML fileとする。
- source localeとtranslationを同一fileに置く。
- simple textとsectioned SystemContextの両方を許可する。
- Production stableはimmutable release digestとartifact matrixへpinする。
- `v0.1`はauthoring、compile、manifest、lint、typegenまでに限定する。
- Eval、A/B、optimizerのschemaは早期に定義するが、runtime実装は段階導入する。
- A/Bの既定判定はrandomization unit単位のfixed horizonとし、単発hard safety eventだけを即時停止条件にする。
- Outcomeはidempotentなappend-only revisionとして保存する。
- Optimizerからlocked holdoutを隔離する。
- optimizerはcandidate-onlyとし、promotion権限を持たせない。

この形であれば、`p()`とTOMLによる小さなdeveloper experienceから開始しつつ、多言語の挙動安定性、benchmark、A/B test、継続改善、rollbackまで同じcontractの上に成長させられる。
