# Provider Neutral Supervisor 実装計画

Status: implemented

実装済み範囲:

- Phase 0: provider / supervisor / run-event / conversation-context の baseline regression を追加。
- Phase 1: provider request normalization と runtime settings 優先の provider 解決を追加。
- Phase 2: provider-side activity guard を追加。
- Phase 3: artifact / source ref contract を追加。
- Phase 4: prompt packet を追加し、既存 public prompt API は維持。
- Phase 5: Round 2 user context renderer を追加。
- Phase 6: provider activity の canonical event / activity semantics を追加。
- Phase 7: StateCard baseline metadata と unchanged compact rendering を追加。
- Phase 8: execution review checklist metadata を run event に保存。

## 目的

`spec/provider-neutral-supervisor-refactor-plan.md` を、実装に移せる段階計画へ落とし込む。

この計画の目的は、Supervisor のプロンプト、Round 2 のユーザー文脈、provider adapter、provider activity、StateCard continuity を、Azure OpenAI、OpenAI API、Bedrock Claude、agent runtime provider、fixture provider のどれでも破綻しない境界へ寄せること。

ただし、NightWorkers は Codex 的な単一実行ループだけで成立していない。Blueprint、Blueprint DB Design、仕様アンケート、Decision Review、contextStill 由来の context pack は、それぞれ独立した設計思想と成果物境界を持つ。provider-neutral 化はこれらを Supervisor の汎用文脈へ吸収する作業ではなく、各成果物の契約を保ったまま LLM 呼び出し境界を揃える作業として扱う。

## ユーザー確認が必要なブロッカー

現時点で、実装計画を作るためにユーザー回答が必須のブロッカーはない。

以下は確認済みの判断である。初期実装ではこの方針を前提にする。

| 判断対象 | 初期実装での仮置き | 今すぐ確認が必要か |
| --- | --- | --- |
| Provider の優先順位 | 初期は現行互換を保つが、最終的には UI / DB-backed settings から provider を解決する | No |
| OpenAI と Azure OpenAI | 別 provider id として扱う | No |
| Bedrock Claude | Bedrock API の message / tool_use 形式を adapter で扱う。初期は Claude 対応でよい | No |
| Agent runtime provider | Supervisor decision call では provider-side tool / file / command / network を禁止する | No |
| Provider-side tools | NightWorkers worker tool へ bridge しない。provider 側の実行機能には依存しない | No |
| Provider activity UI | まず意味を定義する。初期 UI 必須かどうかはこの説明を確認してから決める | Pending |
| StateCard diff | 初期は full context fallback を許し、baseline diff は段階導入する | No |
| 実行レビュー checklist | metadata として追加し、Design Questionnaire の Decision Review とは混ぜない | No |
| Blueprint / DB Design / 仕様アンケート | 既存の成果物境界を維持し、provider refactor の baseline test に含める | No |
| contextStill | MCP 経由の optional context source として扱う。NightWorkers 側に contextStill 専用依存コードは書かず、無くても稼働できる | No |
| Provider 設定 | `.env` 依存を最終的に 0 に近づける。Tauri 配布を前提に UI / DB-backed settings へ移す | No |
| Azure OpenAI round-robin | 想定しない。context 量や deployment pressure の差は初期計画では扱わない | No |

この計画で明示的に採用しないものは以下。

- Provider-side tool calls を NightWorkers worker tool に bridge して実行しない。
- Provider 側の file write、command execution、network access に依存しない。
- Azure OpenAI deployment の round-robin や provider pressure persistence は入れない。
- contextStill の context pack を成果物本文や採用済み仕様そのものとして保存しない。

Bedrock Claude の `tool_use` は例外的に「provider が実行する tool」ではなく「Supervisor decision を表す構造化出力」として扱える。ただし初期実装では provider tool 定義を送らない方針を優先し、`tool_use` が返った場合は原則 reject / audit する。将来使う場合も、実際のファイル操作、コマンド実行、MCP 呼び出し、worker tool 実行は NightWorkers 側の ledger を通す。

## 実装方針

実装順は「既存成果物契約の固定」から始め、その後に provider 境界の安全性へ進む。

プロンプトの自然言語品質を先に変えると、挙動差が追いづらい。まず Blueprint、DB Design、仕様アンケート、Decision Review、Supervisor decision call の現行契約を baseline test として固定する。そのうえで provider request と capability policy を型として追加し、provider-side activity を検知できるようにする。その後で prompt packet と user context renderer を導入する。

```text
Phase 0: Baseline tests
Phase 1: Provider settings and request normalization
Phase 2: Provider capability guard
Phase 3: Workflow and artifact contract guards
Phase 4: Prompt packet
Phase 5: Round 2 user context renderer
Phase 6: Provider activity definition and event persistence
Phase 7: StateCard source refs and diff
Phase 8: 実行レビュー checklist persistence
```

## Phase 0: Baseline Tests

### 目的

既存挙動を固定する。以降の refactor が prompt、provider behavior、structured artifact generation を意図せず変えた場合に検知できるようにする。

### 変更内容

以下のテストを追加または拡張する。

```text
tests/services.supervisor.test.ts
tests/routes.nightworkers.test.ts
tests/services.supervisor-provider-request.test.ts
tests/services.supervisor-provider-capability.test.ts
tests/services.blueprint-llm-contract.test.ts
tests/services.blueprint-data-design-contract.test.ts
tests/services.design-questionnaire-contract.test.ts
```

固定する挙動は以下。

- Round 1 prompt に job type、project root、tool overview、output schema が含まれる。
- Round 2 prompt に job type、project root、allowed tools、minimum execution contract が含まれる。
- Round 2 loop が latest user message、goal、current job type、safety policy、todo state、tool results、loaded skill summaries を送る。
- StateCard を加えた runtime prompt が raw `compiledPrompt` として保存されない。
- task id がある場合、LLM usage record に prompt part estimate が含まれる。
- 既存 provider が normalized usage または estimated usage を返す。
- 通常の Blueprint draft generation は、DB table、column、relation、DDL、data binding、runtime DB call を設計しない。
- Blueprint DB Design generation は、data schema と binding を DB Design workflow 側で扱う。
- 仕様アンケート generation は、不正な model output を固定文に差し替えず、検査可能な raw output として保持する。
- Design Questionnaire Review は、source Blueprint や DB Design adoption state を変更せずに decision review を publish できる。
- Structured JSON caller は、schema validation result と raw output diagnostics を受け取り続ける。
- contextStill 由来の context は、MCP が設定されている場合だけ optional evidence / context input として扱い、それ自体を adopted artifact にしない。
- contextStill MCP が未設定でも、Blueprint、DB Design、仕様アンケート、Supervisor execution は稼働する。
- NightWorkers 側に contextStill 専用 client、専用 repository、専用 schema、専用 fallback は追加しない。利用する場合は MCP tool の入出力として扱う。

### 完了条件

- refactor 前に baseline test が通る。
- snapshot または targeted assertion により、prompt drift が見える。
- artifact contract test により、Blueprint、DB Design、仕様アンケート、Decision Review の drift が見える。
- baseline が worker evidence、model text、structured artifact JSON、retrieval / context evidence を区別している。

## Phase 1: Provider Settings and Request Normalization

### 目的

Provider adapter の直前で、provider id、provider class、model / deployment、capability policy、diagnostics を正規化する。同時に、Tauri 配布を前提として `.env` 依存を減らし、UI / DB-backed settings から provider を解決できる土台を作る。

対象は Supervisor decision call だけではない。Blueprint draft、Blueprint DB Design、仕様アンケート、Decision Review の structured JSON call も同じ provider 境界を通るため、正規化レイヤーは LLM 呼び出し種別を持つ。

### 追加するもの

```text
api/services/supervisor/llm-provider/request.ts
api/services/supervisor/llm-provider/settings.ts
tests/services.supervisor-provider-request.test.ts
```

### 型の案

```ts
export type SupervisorProviderId =
  | 'openai'
  | 'azure-openai'
  | 'azure'
  | 'bedrock'
  | 'codex'
  | 'fixture'
  | 'test';

export type SupervisorProviderClass =
  | 'chat_completion'
  | 'converse_message'
  | 'agent_runtime'
  | 'fixture';

export type ProviderCapabilityPolicy = {
  allowProviderToolCalls: boolean;
  allowProviderFileWrites: boolean;
  allowProviderCommandExecution: boolean;
  allowProviderNetwork: boolean;
  requireStructuredOutput: boolean;
  rejectUnobservedProviderActivity: boolean;
};

export type NormalizedSupervisorLlmRequest = {
  callKind:
    | 'supervisor_decision'
    | 'structured_artifact'
    | 'design_questionnaire'
    | 'design_decision_review'
    | 'fixture';
  providerId: SupervisorProviderId;
  providerClass: SupervisorProviderClass;
  modelOrDeployment: string | null;
  endpoint: string | null;
  region: string | null;
  apiVersion: string | null;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: { name: string; schema: unknown };
  capabilityPolicy: ProviderCapabilityPolicy;
  diagnostics: {
    label: string;
    round: 1 | 2 | null;
    artifactSchemaName?: string | null;
    sourceArtifactRef?: string | null;
    systemPromptLength: number;
    userPromptLength: number;
  };
};
```

`azure` は互換 alias として残してよい。ただし diagnostics 上の正規 provider id は `azure-openai` として見えるようにする。既存の env 名は変更しない。

Provider settings は最初から完全移行しなくてよいが、設計上は `.env` を唯一の source of truth にしない。初期実装では以下の順で解決する。

1. DB-backed settings に保存された workspace / app 設定。
2. 未設定時だけ development fallback として `.env`。
3. Test / fixture provider は test helper で明示する。

Tauri 配布時は 2 を使わずに済む状態を目標にする。

### 変更対象

```text
api/services/supervisor/llm-provider/index.ts
api/services/supervisor/llm-provider/providers.ts
api/services/supervisor/llm-provider/types.ts
api/modules/nightworkers/nightworkers.service.ts
```

### 挙動

- `ACTIVE_LLM_PROVIDER=azure` は alias `azure` を保持しつつ、provider id `azure-openai` として解決する。
- `ACTIVE_LLM_PROVIDER=openai` は provider id `openai` として解決する。
- `ACTIVE_LLM_PROVIDER=bedrock` は provider class `converse_message` として解決する。
- `ACTIVE_LLM_PROVIDER=codex` は provider class `agent_runtime` として解決する。
- `fixture` と `test` は provider class `fixture` として解決する。
- Provider settings が DB に存在する場合は `.env` より優先する。
- `.env` は local development fallback として残すが、Tauri 配布時の必須条件にしない。
- Supervisor decision call は strict capability policy を初期値にする。
- Structured artifact call は structured-output-required policy を初期値にする。ただし Supervisor worker-tool 前提は継承しない。
- Blueprint、DB Design、仕様アンケート、Decision Review の diagnostics には、可能な範囲で schema name と source artifact reference を含める。
- `jsonSchema.name` は diagnostics と usage logs に残すが、diagnostics を model-facing prompt に描画しない。

### 検証

- OpenAI と Azure OpenAI が diagnostics 上で潰れない。
- Azure OpenAI は deployment と API version を記録する。
- Bedrock は region と model id を記録する。
- Agent runtime provider は strict capability policy を記録する。
- DB-backed settings がある場合に provider 解決へ反映される。
- `.env` がなくても DB-backed settings だけで fixture / test 以外の provider request を構築できる。
- 既存 provider call に渡る prompt text は変わらない。
- Structured artifact call に渡る system prompt、user prompt、schema は変わらない。
- Blueprint、DB Design、仕様アンケート、Decision Review のテストが、特定の hosted provider に依存せず provider id / class / diagnostics を検証できる。

## Phase 2: Provider Capability Guard

### 目的

Provider-side tool calls や副作用を持ちうる activity を、黙って無視しない。NightWorkers は provider 側の tool 実行機能に依存しないため、file write、command execution、network access、外部 tool execution は provider ではなく NightWorkers worker ledger を通す。

一方で、Bedrock Claude の `tool_use` のように、API が構造化された選択結果として返す形式は存在する。これは provider が tool を実行するという意味ではなく、model が「この tool を使いたい」と返す signal である。NightWorkers の初期実装では provider tool 定義を送らず、`tool_use` が返った場合は想定外 activity として reject / audit する。

将来 Bedrock Claude の `tool_use` を使う場合でも、使い道は Supervisor decision schema の代替表現に限定する。つまり `tool_use` を受けて即座に tool を実行するのではなく、allowlist された tool name と input schema を検証し、NightWorkers の通常の worker tool selection / ledger に変換する。

### 追加するもの

```text
tests/services.supervisor-provider-capability.test.ts
```

### 変更対象

```text
api/services/supervisor/llm-provider/types.ts
api/services/supervisor/llm-provider/events.ts
api/services/supervisor/llm-provider/openai.ts
api/services/supervisor/llm-provider/providers.ts
api/services/supervisor/llm-provider/codex.ts
```

### Event type

`SupervisorLlmDebugEvent.type` を拡張する。

```text
model.provider_activity_detected
model.provider_tool_call_detected
model.provider_activity_rejected
```

### 挙動

- OpenAI non-stream response で `choices[0].message.tool_calls` があり、policy が provider tool call を禁止している場合は call を失敗させる。
- OpenAI stream response の delta に `tool_calls` が含まれる場合は call を失敗させる。
- 初期実装では Bedrock Claude に provider tool 定義を送らない。
- 初期実装で Bedrock Claude response に `tool_use` block が来た場合、想定外 provider activity として reject / audit する。
- 後段で Bedrock Claude tool schema を明示的に有効化した場合だけ、許可された schema の Supervisor decision として解釈できるなら受け入れる。
- Bedrock Claude response の `tool_use` が実行済み結果、外部 side effect、未知 tool、または worker ledger 外の実行を示す場合は call を失敗させる。
- Bedrock Claude 以外の Bedrock model は、API 形状を確認するまでは Claude と同じ扱いにしない。
- Codex SDK stream で agent message ではない tool / activity item らしき event が来た場合、strict policy では call を失敗させる。
- Fixture / test provider は、テスト用に provider activity を合成できる。

### エラー

専用 error class または tagged error shape を使う。

```ts
ProviderActivityRejectedError
```

含める情報は以下。

- provider id
- provider class
- activity type
- tool name if available
- redacted preview
- policy snapshot

### 検証

- Synthetic OpenAI tool call が reject される。
- Synthetic OpenAI streaming tool call が reject される。
- 初期設定では Synthetic Bedrock Claude `tool_use` が reject / audit される。
- 後段で Bedrock Claude tool schema を明示的に有効化した場合だけ、許可 schema の decision として parse できるケースが成功する。
- Synthetic Bedrock Claude `tool_use` が未知 tool や side effect を示す場合は reject される。
- Synthetic agent runtime non-message / tool item が reject される。
- Provider activity を含まない assistant text / JSON は成功する。
- failure の前に debug event が emit される。

## Phase 3: Workflow and Artifact Contract Guards

### 目的

Provider-neutral 化によって、NightWorkers 固有の成果物境界が Supervisor の汎用文脈へ吸収されないようにする。

Blueprint、Blueprint DB Design、仕様アンケート、Decision Review、contextStill は、単なる追加コンテキストではない。どの成果物が source of truth で、どの成果物が提案で、どの情報が retrieval evidence なのかを明示してから prompt packet や user context renderer に渡す。

### 追加するもの

```text
api/services/supervisor/artifact-contract.ts
tests/services.supervisor-artifact-contract.test.ts
```

### 契約カテゴリ

```ts
export type SupervisorArtifactContextRef = {
  kind:
    | 'blueprint'
    | 'blueprint_db_design'
    | 'design_questionnaire'
    | 'design_decision_review'
    | 'contextstill_context_pack'
    | 'worker_evidence'
    | 'model_text';
  refId: string;
  status:
    | 'draft'
    | 'adopted'
    | 'published'
    | 'answering'
    | 'needs_edit'
    | 'evidence_only';
  digest?: string | null;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
};
```

### 挙動

- 通常の Blueprint context は、画面、操作、コンテンツ、コンポーネント構造、UX intent を記述できる。
- 通常の Blueprint context を DB table / column / relation / DDL / data binding の authority として扱わない。
- Blueprint DB Design context は `databaseSchema` と `dataBindings` を記述できるが、repository mutation evidence にはならない。
- 仕様アンケート context は、未決定事項、選択済み回答、tradeoff、handoff note を記述できる。
- Decision Review context は、既存の accept / publish path によって publish 済みと扱われた後にだけ specification evidence になる。
- contextStill context pack は、MCP が設定されている場合だけ利用する。別の NightWorkers artifact が派生成果を明示的に採用しない限り、常に retrieval / evidence input として扱う。
- contextStill 用の専用コードパスは作らず、他の MCP server と同じ tool result として受け取る。
- Repository の read / write / command / test を証明できるのは worker tool evidence だけにする。

### 検証

- 通常の Blueprint prompt は DB schema と binding design を引き続き除外する。
- DB Design prompt は visual Blueprint ownership を変えずに schema / binding を修正できる。
- 仕様アンケート publish flow は source Blueprint や DB Design adoption state を変更しない。
- contextStill reference は MCP が利用可能な場合だけ diagnostics / source refs に含められるが、adopted artifact にはならない。
- contextStill MCP が未設定の状態でも、artifact contract guard の基本テストは通る。
- contextStill 専用の repository / schema / provider fallback を追加していないことを確認する。
- Prompt packet と Round 2 user context のテストは、単なる文字列 inclusion ではなく category label を検証する。

## Phase 4: Prompt Packet

### 目的

プロンプト構築を、描画前に検査できる構造へ分ける。初期実装ではプロンプト品質そのものの変更を狙わない。

### 追加するもの

```text
api/services/supervisor/prompt-packet.ts
tests/services.supervisor-prompt-packet.test.ts
```

### 変更対象

```text
api/services/supervisor/prompt.ts
```

### 型の案

```ts
export type SupervisorPromptPacket = {
  basePolicy: string[];
  roundPolicy: string[];
  projectContext: string[];
  runtimeContext: string[];
  userRequest: string[];
  executionEvidence: string[];
  outputContract: string[];
  diagnostics: {
    round: 1 | 2;
    projectRoot: string;
    jobType?: JobType;
    allowedToolNames?: string[];
  };
};
```

### 挙動

- `buildRound1JobTypePrompt` は public API として残し、string を返す。
- 内部では `buildRound1PromptPacket` と `renderSupervisorSystemPrompt` を呼ぶ。
- `buildRound2ToolCallPrompt` は public API として残し、string を返す。
- 内部では `buildRound2PromptPacket` と `renderSupervisorSystemPrompt` を呼ぶ。
- Rendered prompt は現在の出力に近い状態を保つ。

### 検証

- 既存 prompt test が通る。
- Packet test が section membership を検証する。
- Diagnostics は model-facing prompt に描画されない。

## Phase 5: Round 2 User Context Renderer

### 目的

Round 2 user prompt で、latest user request、continuity、execution state、evidence、skill memory、safety context を区別する。

### 追加するもの

```text
api/services/supervisor/user-context.ts
tests/services.supervisor-user-context.test.ts
```

### 変更対象

```text
api/services/supervisor/supervisor-loop.ts
```

### 型の案

```ts
export type Round2UserContextInput = {
  latestUserMessage: string;
  goal: string;
  currentJobType: JobType;
  workflow: string | null;
  safetyPolicy: unknown | null;
  todoPlan: unknown[];
  currentTodo: unknown | null;
  toolResults: unknown[];
  loadedSkillSummaries: unknown[];
  artifactContextRefs: SupervisorArtifactContextRef[];
};
```

### 描画形式

```text
[Latest User Request]
...

[Goal]
...

[Continuity Context]
...

[Current Execution State]
...

[Recent Tool Evidence]
...

[Loaded Skill Summaries]
...

[Artifact and Source References]
...

[Safety Context]
...
```

初期実装では、各 section の中に既存 JSON payload を残してよい。重要なのは、意味の違う文脈を混ぜずに label で分離すること。

### 検証

- 既存 JSON に含まれていた情報が失われない。
- Latest user request が tool results と分離される。
- Tool results が evidence として label される。
- Blueprint、DB Design、仕様アンケート、Decision Review、contextStill refs が source category と status 付きで label される。
- Workflow intent がユーザー文言の keyword から推測されず、明示的な値として保持される。
- Safety policy が constraint として label される。
- Token usage estimate が rendered Round 2 user context を使う。

## Phase 6: Provider Activity Definition and Event Persistence

### 目的

Provider activity とは、LLM provider が通常の assistant text / JSON 以外の activity らしき event を返した事実を指す。例は OpenAI の tool call、Bedrock Claude の `tool_use`、agent runtime provider の non-message item など。

これは「NightWorkers が tool を実行した」という意味ではない。むしろ、provider から tool 的な event が返ったときに、それを worker tool evidence と混同しないための監査情報である。

Debug event は開発者向けには有用だが、provider activity は user-visible な誤解にもつながりうる。そのため backend では記録し、UI 表示は「provider が何かを実行した」ように見えない文言に限定する。

### 追加または拡張

現在の activity ledger の状態に応じて、以下のどちらかを採用する。

- 既存 run event type に `type='provider_activity'` として emit する。
- 既存 LLM debug event の metadata として provider activity を追加する。

Activity ledger migration が既に有効でない限り、新しい table は導入しない。

### 変更対象

```text
api/services/supervisor/llm-provider/events.ts
api/services/supervisor/supervisor-loop.ts
api/modules/nightworkers/nightworkers.service.ts
src/modules/nightworkers/components/ThreadTimeline.tsx
```

### 挙動

- Provider activity を worker tool event と分離する。
- Provider activity は prompt / tool evidence check を満たせない。
- UI に出す場合は「provider response に tool-like item を検出」「Bedrock tool_use を Supervisor decision として解釈」など、実行済み action と誤読されない表示にする。
- UI を初期段階で必須にするかは別判断だが、backend event semantics は先に固定する。

### 検証

- Provider tool call が reject されたとき、provider activity event が残る。
- Repository mutation claim を証明できるのは worker tool observation だけである。
- 既存 timeline が provider activity を特別表示しなくても壊れない。

## Phase 7: StateCard Source Refs and Diff

### 目的

StateCard は derived continuity text のままにする。ただし、複数 turn にまたがるとき、変化が小さい場合まで毎回 full continuity context を送らなくてよい形にする。

Baseline は prose summary だけでなく source reference を保持する必要がある。NightWorkers では、Blueprint、DB Design、仕様アンケート、Decision Review、contextStill、worker evidence の参照を失った短い StateCard より、少し長くても根拠を追える StateCard の方が正しい。

### 変更対象

```text
api/services/conversation-context/types.ts
api/services/conversation-context/render.ts
api/services/conversation-context/build.ts
api/services/conversation-context/repository.ts
tests/services.conversation-context.test.ts
```

### データ形状

まず snapshot JSON の optional metadata として追加する。必要になるまで schema migration は避ける。

```ts
contextBaseline?: {
  repoRoot: string;
  jobType: string | null;
  workflow: string | null;
  safetyPolicyDigest: string | null;
  stateCardDigest: string;
  relevantFilesDigest: string | null;
  adoptedArtifactDigest: string | null;
  blueprintRefsDigest: string | null;
  blueprintDbDesignRefsDigest: string | null;
  designQuestionnaireRefsDigest: string | null;
  decisionReviewRefsDigest: string | null;
  contextStillRefsDigest: string | null;
  workerEvidenceRefsDigest: string | null;
  lastRunId: string | null;
};
```

### 挙動

- Baseline がない場合は full StateCard を描画する。
- Baseline があり、意味のある field が変わっていない場合は短い continuity text を描画する。
- Job type、workflow、relevant files、artifact adoption、source refs、safety policy が変わった場合は明示的な diff を描画する。
- Supervisor にはこれまで通り text だけを渡す。
- Compact rendering でも、source label と id / digest は安定して残す。

### 検証

- StateCard build が DB / events / git / source truth を読み続ける。
- Snapshot JSON に baseline metadata が含まれる。
- Baseline が変わっていない場合、rendered text が短くなる。
- Baseline がない、または互換性がない場合は full fallback する。
- Source ref category が変わったが renderer が安全に説明できない場合は full fallback する。

## Phase 8: Execution Review Checklist Persistence

### 目的

実行レビューと検証結果を、自然文として読めるまま、構造化 evidence としても query できるようにする。

これは Design Questionnaire の Decision Review とは別物である。Decision Review は product / specification decision を扱い、仕様 artifact として publish されうる。この phase で扱うのは、worker run や Supervisor run の後に残す execution verification である。

### 変更対象

```text
api/services/supervisor/schema-first.ts
api/services/supervisor/supervisor-loop.ts
api/modules/nightworkers/nightworkers.service.ts
tests/services.supervisor.test.ts
```

### 形状

まずは run context または event metadata として持つ。

```ts
reviewChecklist?: Array<{
  item: string;
  status: 'passed' | 'failed' | 'not_checked' | 'blocked';
  evidenceRef?: string | null;
  source:
    | 'worker_tool'
    | 'file'
    | 'test_command'
    | 'provider_activity'
    | 'model'
    | 'structured_artifact'
    | 'contextstill_context_pack';
}>;
```

### 挙動

- Final answer prose は変えない。
- Checklist は optional にする。
- Checklist source は、evidence ref が worker tool result を指していない限り worker evidence を主張できない。
- Checklist は Design Questionnaire Decision Review を置き換えない。
- Checklist は Blueprint、DB Design、Decision Review、contextStill refs を context として指せる。ただし、それらの ref は repository mutation を証明しない。

### 検証

- Checklist がなくても既存 final answer path が動く。
- Checklist metadata が存在する場合は保存される。
- Provider activity source が worker evidence requirement を満たさないことをテストする。
- Design Questionnaire Decision Review publish path が execution checklist metadata とは別に保たれることをテストする。

## 推奨する最初の実装単位

最初は、prompt behavior を変えずに安全性が高い範囲から着手する。

```text
1. Phase 0 expanded baseline tests
2. Phase 1 provider settings and request normalization
3. Phase 2 provider capability guard
4. Minimal tests for OpenAI tool_calls rejection, Bedrock Claude tool_use rejection by default, Codex non-message item rejection
5. Minimal structured artifact tests for Blueprint, DB Design, 仕様アンケート, Decision Review
```

この単位で扱う最大の correctness risk は以下。

- Provider activity が worker execution と誤認される、または無視される。
- Structured artifact LLM call が壊れても、Supervisor-only test だけでは検知できない。
- Blueprint、DB Design、仕様アンケート、Decision Review、contextStill の境界が generic prompt context に潰される。
- `.env` が provider 設定の必須条件として残り、Tauri 配布の障害になる。

その後に進める。

```text
6. Phase 3 workflow and artifact contract guards
7. Phase 4 prompt packet
8. Phase 5 Round 2 user context renderer
```

ここから prompt clarity を改善する。ただし、挙動と source-category boundary は前段のテストで守る。

## 成功条件

- Provider diagnostics が OpenAI API、Azure OpenAI、Bedrock、agent runtime、fixture を区別する。
- Provider settings は DB-backed settings を優先し、`.env` は local development fallback に下がる。
- Supervisor decision call が strict provider capability policy を持つ。
- Structured artifact call が、system prompt、user prompt、schema、raw output handling を変えずに provider diagnostics を持つ。
- 禁止された provider tool / activity が検出され、reject される。
- Bedrock Claude の `tool_use` は初期状態では reject / audit される。後段で明示的に有効化した場合だけ、許可された Supervisor decision schema として受け入れられ、provider 側の tool 実行としては扱われない。
- 通常の Blueprint generation が DB Design と分離されたままになる。
- 仕様アンケートと Decision Review flow が execution review checklist metadata と分離されたままになる。
- contextStill context は optional MCP input であり、未設定でも NightWorkers は稼働する。
- NightWorkers は contextStill 専用依存コードを持たず、利用する場合も MCP server として扱う。
- contextStill context は、NightWorkers artifact が派生成果を明示的に採用しない限り retrieval / evidence input のままになる。
- Prompt builder は render 前の packet として検査できる。
- Round 2 user context が latest request と execution evidence を分離する。
- Round 2 user context が artifact / source refs を category と status 付きで label する。
- StateCard は derived continuity text のまま、source refs を保持する。
- Provider activity は worker tool evidence を満たせない。

## 後で再検討する論点

以下は初期実装のブロッカーではない。

1. Provider settings の UI をどの画面に置くか。
2. Provider credentials を OS keychain、Tauri secure storage、DB 暗号化のどれで扱うか。
3. Bedrock Claude の `tool_use` を後段で Supervisor decision schema として有効化するか。
4. Agent runtime provider を non-Supervisor execution mode で許可するか。
5. Provider activity を Workbench timeline に初期段階から表示するか、まず backend metadata に留めるか。
6. Activity ledger redesign 後、provider activity を first-class `activity_events` table entry にするか。
7. contextStill run id や context pack digest を後で first-class column にするか、metadata-only のままにするか。
8. 実行レビュー checklist に専用 UI を用意するか、activity ledger redesign までは run metadata に留めるか。

## 注意

現在の worktree には、この計画とは無関係の modified files が既にある。実装時は対象 phase に変更を絞り、phase が明示していない限り既存 prompt 文言を書き換えない。
