# S11tnext LLM Fixture Catalog / E2E Mock Implementation Plan

## Status

- Plan status: `implementation-ready`
- Document created: 2026-07-29
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Primary scope: test専用S11tnext catalog、既存fixture provider接続、Mission Pilot / Coding Agentの決定的E2E mock
- Dependency policy: 現在固定済みの`s11tnext`と`s11tnext-cli`を使用し、新規npm packageを追加しない
- Runtime policy: 新規Simulator process、HTTP server、SQLite、認証、GUIを追加しない
- Working tree policy: 認証削除を含む既存のtracked / untracked変更をすべてユーザー所有として保持し、本計画の変更と混在させない
- Source guidance: `AGENTS.md`と`spec/s11t-coding-agent-guide.md`を実装時の上位規則とする

## 1. 目的

NightWorkersのE2Eで実LLMを呼ばずにMission PilotとCoding Agentの制御loopを再現するため、LLMの固定応答本文をTOMLで管理し、S11tnextで決定的な型付きcatalogへ生成する。

既存のfixture providerが所有しているturn順序、tool call、Task単位の登録、動的placeholderは維持する。S11tnextにはprovider、scenario engine、状態機械の責務を追加せず、TOML authoring、deterministic build、typed text catalogとしてのみ使用する。

完成状態は次の一文に集約する。

> E2Eで使用するLLM本文をtest専用S11tnext catalogから取得し、既存のMission Pilot / Coding Agent runtimeとfixture provider contractを維持したまま通し、実LLM、外部HTTP、認証情報、永続fixture stateなしで主要scenarioを決定的に再現できる。

## 2. Locked Decisions

### 2.1 新規Simulatorを作らない

次は追加しない。

- 別repositoryのLLM Simulator。
- 常駐HTTP mock server。
- OpenAI / Azure / Bedrock互換endpoint。
- 新規npm package。
- React管理画面。
- SQLiteによるscenario state保存。
- OAuth、ログイン、user table、Frontend / Backend間の追加認証。
- production trafficのrecord / replay。

Mockと実providerをHTTP wire levelで区別不能にすることは本計画の目的ではない。HTTP、SSE、provider retry、provider固有error envelopeはprovider contract testの責務とし、Mission Pilot / Coding AgentのE2EではNightWorkers内部のprovider portをfixture providerへ差し替える。

### 2.2 S11tnextの責務を拡張しない

S11tnextが所有するのは次だけである。

- TOML authoring。
- lint。
- deterministic build。
- catalog JSON生成。
- generated TypeScript factory / key / variable type生成。
- runtime artifact / digest検証。
- localeを固定したtext rendering。

S11tnextに次を持たせない。

- turn counter。
- scenario分岐。
- tool call schema。
- provider retry。
- Task ID。
- Run ID。
- Mission Pilot / Coding Agentのrole判定。
- E2E route。
- fixture登録・消費。

### 2.3 production SystemContext catalogへ混ぜない

`api/systemContexts/`はproduction SystemContextの正本であり、単一catalogを維持する。LLM fixture本文はSystemContextではなくtest dataであるため、別のtest専用S11tnext projectとして配置する。

test専用catalogを追加しても、production SystemContextをrole別catalogへ分割したことにはならない。

### 2.4 TOMLへ移すのはLLM本文

原則として「LLMの一回答本文 = 一つの`.context.toml`」とする。

TOMLへ移すもの:

- assistant本文。
- schema-first fixtureとして返すJSON本文。
- parse failureやschema failureを再現する意図的な不正本文。

TypeScriptへ残すもの:

- tool call ID。
- tool名。
- tool arguments。
- turn順序。
- `previous_tool_failed`等の構造的condition。
- `taskRevision`、`latestRunId`等の動的placeholder。
- scenario enum。
- E2E routeのauthorization / isolation guard。

tool call全体をJSON文字列としてTOMLへ埋め込み、実行時に汎用scenario schemaとして解釈する機能は作らない。

### 2.5 scenarioは明示指定する

ScenarioはE2E requestに保存された`scenario` enumまたはRunの構造的provenanceで選択する。Task本文、ユーザー文言、error message、prompt keyword、正規表現で選択しない。

### 2.6 fixture stateを永続化しない

Taskごとのfixture turn / structured output queueはprocess memoryだけに保持する。

- SQLiteへ保存しない。
- Authorization、API key、`.env`内容をfixtureへ渡さない。
- raw provider requestを記録しない。
- E2E process終了時に全stateを破棄する。
- Task cleanup時にfixture stateを明示解放できるAPIを用意する。

### 2.7 unit testの環境変数fixtureは維持する

`SUPERVISOR_FIXTURE_OUTPUT`、`SUPERVISOR_FIXTURE_ROUND1_OUTPUT`、`SUPERVISOR_FIXTURE_ROUND2_OUTPUT`は、個別のparse / schema / repair unit testで任意本文を注入する用途があるため削除しない。

優先順位は次とする。

1. `NIGHTWORKERS_E2E_ISOLATED=1`かつTask単位で登録済みのfixture。
2. unit testが明示設定した環境変数fixture。
3. 未設定error。

productionでは従来どおりfixture providerを使用不可とする。

## 3. 現状Baseline

### 3.1 S11tnext

- runtimeは`s11tnext`。
- authoring / build CLIは`s11tnext-cli`。
- 両packageは`package.json`と`bun.lock`で同じ公開versionへ固定されている。
- production SystemContextは`api/systemContexts/contexts/`から`api/systemContexts/generated/`へ生成される。
- runtimeは生成済みartifactとfactoryを使用し、TOML parserやCLIをimportしない。

### 3.2 structured fixture provider

`api/services/structured-llm/fixture-provider.ts`は、schema-first / text responseを固定本文として返す。現在の本文sourceは環境変数である。

このlaneは次を検証するために使用される。

- JSON extraction。
- schema validation。
- raw model body保持。
- repair。
- parse failure。
- usage estimate。

### 3.3 tool-turn fixture provider

`api/services/structured-llm/fixture-tool-provider.ts`はTask IDごとのturn配列をprocess memoryへ登録し、provider-native tool turnとして順に返す。

現在すでに存在する能力:

- Task単位のturn列。
- assistant本文。
- 複数tool call。
- `previous_tool_failed` condition。
- tool resultからの`taskRevision`解決。
- tool resultからの`latestRunId`解決。
- E2E isolated guard。

本計画ではこのprovider contractを維持する。

### 3.4 Mission Pilot E2E fixture

`api/modules/missionPilot/routes/mission-pilot-agent-fixture-routes.ts`は次のscenarioを持つ。

- Questionnaire。
- `autopilot`。
- `repair`。
- `restart`。
- `user-interruption`。

現在、LLM assistant本文は同ファイル内のstring literalである。tool call、arguments、condition、placeholderと本文が同じファイルに混在している。

### 3.5 Coding Agent native/API lane

Coding Agentの`native-api-runner`は`callProviderToolTurn`をprovider portとして使用する。したがって、Codex SDKを模倣せず、E2Eのruntime laneを`native-api-runner`へ固定すれば、同じfixture providerとfixture catalogを利用できる。

Codex SDK laneそのもののprovider動作は本計画のmock対象外とする。

## 4. Target Architecture

```text
TOML fixture source
        |
        v
  s11tnext-cli
  lint / build / check
        |
        +----------------------+
        |                      |
        v                      v
 catalog.json        catalog.generated.ts
        |                      |
        +----------+-----------+
                   |
                   v
         test-only catalog binding
         bindText(ja-JP, no fallback,
                  trailingNewline=false)
                   |
                   v
       role-owned E2E scenario builder
        content + typed tool calls
                   |
                   v
      existing fixture provider maps
                   |
                   v
   Mission Pilot / Coding Agent runtime
```

依存方向:

```text
role-owned E2E fixture route / builder
                    |
                    v
test-only fixture text catalog facade
                    |
                    v
generated S11tnext factory + artifact
                    |
                    v
               s11tnext
```

test-only fixture catalog facadeはroute、repository、tool contract、scenario分岐を持たない。role固有scenario builderから本文を取得するための純粋なtext catalogとして扱う。

## 5. Proposed File Layout

```text
api/
  e2eFixtures/
    llmCatalog/
      s11tnext.config.toml
      contexts/
        missionPilot/
          questionnaire/
          autopilot/
          repair/
          restart/
          userInterruption/
        codingAgent/
          directRun/
      generated/
        catalog.json
        catalog.generated.ts
      catalog.ts

  services/
    structured-llm/
      fixture-provider.ts
      fixture-tool-provider.ts
      fixture-text-provider.ts       # Task単位のstructured本文queue

tests/
  llm-fixture-catalog.test.ts
  fixture-text-provider.test.ts
  mission-pilot-agent-fixture-catalog.test.ts
  coding-agent-e2e-fixture-catalog.test.ts
```

`api/e2eFixtures/llmCatalog`にはtest fixtureのTOML、生成物、純粋bindingだけを置く。Agent固有のroute、tool call、workflowは置かない。

production codeから一般利用できるpublic indexは作らない。importを許可するのはisolated E2E fixture route / builderとfixture-focused testだけとし、architecture testで逆流を検出する。

## 6. S11tnext Authoring Contract

### 6.1 project config

test専用configは概ね次の契約を持つ。

```toml
source_dir = "contexts"
out_dir = "generated"

[authoring]
source_locale = "ja-JP"

[governance]
require_owner = true

[keyspaces."missionPilot"]
owner = "mission-pilot-e2e-fixture"

[keyspaces."codingAgent"]
owner = "coding-agent-e2e-fixture"

[release_profiles.e2e]
required_locales = ["ja-JP"]
```

初期fixtureは固定本文だけとし、variable profileを追加しない。本文の可変値はtool argumentsの既存placeholderで扱う。

変数が必要になった場合だけ、用途、型、trust、placement、encodingを明示したprofileを追加する。未trusted入力をraw inlineへ配置しない。

### 6.2 fixture key

keyはpath由来のcanonical dot keyを使用する。

例:

```text
missionPilot.questionnaire.read-current
missionPilot.questionnaire.save-draft
missionPilot.questionnaire.confirmed
missionPilot.autopilot.read-task
missionPilot.autopilot.start-run
missionPilot.autopilot.wait-run
missionPilot.autopilot.read-outcome
missionPilot.autopilot.complete
missionPilot.autopilot.complete-retry
missionPilot.repair.start-first-run
missionPilot.repair.start-first-repair
missionPilot.repair.start-second-repair
missionPilot.restart.restore-context
missionPilot.userInterruption.wait-user
codingAgent.directRun.create-todo
codingAgent.directRun.inspect-repository
codingAgent.directRun.verify
codingAgent.directRun.complete
```

同じ本文であっても意味の異なるturnを無理に共有しない。fixture keyはテストの意図を表し、文章の偶然の一致による共用を避ける。

### 6.3 TOML本文

通常本文:

```toml
text = '''Task Goalと現在のFactを確認します。'''
```

schema-first JSON本文:

```toml
text = '''
{
  "jobType": "implementation",
  "goal": "指定された変更を実装する"
}
'''
```

不正JSON、Markdown fence付きJSON、schema不適合JSONも、その失敗を検証するfixtureであることがkeyから明確な場合に限り格納できる。

### 6.4 trailing newline

S11tnext runtimeのdefault terminal newlineによって既存fixture本文が変化しないよう、test catalog bindingは`trailingNewline: false`を固定する。

既存inline literalとrender後本文のUTF-8 byte列が一致することをmigration testで確認する。

### 6.5 locale

E2E fixture catalogは`ja-JP`を明示し、`fallbackLocales = []`とする。

- General Settingsのlanguageへ連動しない。
- requestごとにlocaleを切り替えない。
- 未定義localeへ暗黙fallbackしない。
- 英語fixtureが必要になった場合は別localeを明示追加し、coverage requirementを同時更新する。

## 7. Runtime Binding Contract

`api/e2eFixtures/llmCatalog/catalog.ts`は次だけを所有する。

```ts
type LlmFixtureText = ReturnType<typeof fixtureCatalog.bindText>;

export type LlmFixtureKey = PromptKey;

export function renderLlmFixtureText<K extends PromptKey>(
  key: K,
  values: PromptValueMap[K],
): string;
```

実装規則:

1. artifact JSONはstatic importする。
2. runtime境界ではartifactを`unknown`としてgenerated factoryへ渡す。
3. `expectedCatalogDigest`検証を迂回しない。
4. generated TypeScriptを手編集しない。
5. `bindText()`を一度だけ作成し、固定bindingを再利用する。
6. `createTextRenderer()`を使用しない。
7. production SystemContextの`p()`、locale scope、auditへ接続しない。
8. fixture key不明、digest不一致、不正artifactはfail-closeする。

## 8. Fixture Provider Contract

### 8.1 tool turns

`FixtureTurn`の外部contractは維持する。

```ts
type FixtureTurn = {
  content: string;
  toolCalls: ProviderToolCall[];
  condition?: "previous_tool_failed";
};
```

role-owned scenario builderは、inline本文の代わりにfixture keyを受け取り、登録前に本文へrenderする。

```ts
function turn(
  id: string,
  contentKey: LlmFixtureKey,
  toolCalls: ProviderToolCall[],
  condition?: "previous_tool_failed",
): FixtureTurn;
```

providerはS11tnext keyを知らない。providerへ渡る時点では従来どおり`content: string`である。

### 8.2 structured text outputs

E2Eでschema-first artifact生成やreview本文を複数turn供給できるよう、Task単位のtext queueを追加する。

目標contract:

```ts
registerFixtureProviderTextOutputs(taskId: string, outputs: string[]): void;
hasFixtureProviderTextOutputs(taskId: string): boolean;
takeFixtureProviderTextOutput(taskId: string): string;
clearFixtureProviderTask(taskId: string): void;
```

規則:

- `NODE_ENV=production`では登録・消費不可。
- `NIGHTWORKERS_E2E_ISOLATED !== "1"`では登録・消費不可。
- queueはTask IDで分離する。
- 出力が尽きた場合は固定の成功本文へfallbackせず、明示errorにする。
- 環境変数fixtureはunit test互換経路として残す。
- providerへ渡す本文はcatalogでrender済みのstringとする。
- raw request、prompt、tool resultを保存しない。

### 8.3 cleanup

Fixture routeで同じTaskへscenarioを再登録するときは、既存queueをreplaceする。

Task削除またはE2E teardown時に`clearFixtureProviderTask(taskId)`を呼び、tool turnとstructured text queueの両方を解放する。

cleanup failureはTask本体の削除を妨げないが、test failure diagnosticへ残す。

## 9. Scenario Ownership

### 9.1 Mission Pilot

Mission Pilot moduleは次を維持する。

- Questionnaire fixtureのtool call。
- agent scenario enum。
- `autopilot`、`repair`、`restart`、`user-interruption`のturn順序。
- `read_task_workspace`等のtool選択。
- `run_implementation_start`のrepair request。
- wait event type。
- Task complete action。

変更するのは各`FixtureTurn.content`のsourceだけである。

### 9.2 Coding Agent

Coding Agent E2Eは`native-api-runner` laneを使用し、同じ`callProviderToolTurn`境界へfixture turnを登録する。

最初のCoding Agent fixture scenarioは次に限定する。

1. Todo plan作成。
2. current Todo開始。
3. repository調査。
4. 小さなfile変更。
5. commandによる検証。
6. Todo完了。
7. final report。

Taskの意味や次actionをhost keywordで決めるfixtureは作らない。scenarioはテストが明示登録するturn列であり、production Coding Agentへ固定workflowを追加するものではない。

Codex SDK laneはこのcatalogでmockしない。

### 9.3 agentsShare

fixture catalogやrole固有scenarioを`agentsShare`へ置かない。

両roleで同じ意味を持つfixture登録contractが必要になった場合だけ、role非依存の型またはportを`agentsShare`へ置ける。route、scenario、fixture本文、role判定は置かない。

## 10. Implementation Phases

### Phase 0: Baseline固定

変更:

1. `git status --short`を保存し、既存変更へ触れない。
2. `package.json`と`bun.lock`から`s11tnext` / `s11tnext-cli`の一致を確認する。
3. 現在のMission Pilot fixture turn列をscenario別にsnapshot化する。
4. 各turnについて次をbaselineとして記録する。
   - turn ID。
   - assistant本文。
   - tool call ID。
   - tool名。
   - arguments。
   - condition。
5. 現在のfocused unit / E2Eを実行する。

Exit criteria:

- 移行前のturn列を機械比較できる。
- baseline failureがあれば本計画の変更前に記録されている。
- 認証削除等の並行変更とfixture変更の所有範囲が分離されている。

### Phase 1: test専用S11tnext catalog scaffold

追加:

- `api/e2eFixtures/llmCatalog/s11tnext.config.toml`
- 最小のfixture TOML。
- catalog JSON。
- generated TypeScript。
- `catalog.ts` binding。
- fixture catalog focused test。
- `package.json`のfixture専用lint / build / check script。

script名:

```text
s11tnext:fixtures:lint
s11tnext:fixtures:build
s11tnext:fixtures:check
```

Exit criteria:

- lint、build、stale checkが成功する。
- generated key / valuesが型検査される。
- catalog digest不一致がfail-closeする。
- `ja-JP`、no fallback、no trailing newlineが固定される。
- production SystemContext catalogと生成物に差分がない。
- 新規dependencyがない。

### Phase 2: Mission Pilot tool-turn本文移行

対象:

- Questionnaire fixture。
- `autopilot`。
- `repair`。
- `restart`。
- `user-interruption`。
- completion / retry assistant本文。

手順:

1. 各assistant本文を意味単位のTOMLへ移す。
2. `buildAgentScenarioTurns()`とhelperの本文引数をfixture keyへ置き換える。
3. tool call、arguments、condition、順序を変更しない。
4. rendered本文とbaseline本文のbyte equalityを検証する。
5. target routeに`FixtureTurn.content`用の日本語inline literalが残っていないことを静的検査する。

次は本文移行対象外としてTypeScriptへ残す。

- `task_message_send.content`。
- `run_implementation_start.request`。
- `repairRequest`。
- Questionnaire answers / evidence。
- wait reason。
- fixture diagnostic。

これらはtool argumentsまたはhost diagnosticであり、assistant本文catalogへの移動を理由に構造を崩さない。

Exit criteria:

- 全既存Mission Pilot agent scenarioのturn構造がbaselineと一致する。
- assistant本文だけがTOML sourceへ移っている。
- E2E routeのrequest / response contractに変更がない。

### Phase 3: Task-scoped structured text fixture

追加:

- Task単位のstructured text queue。
- 登録、消費、exhaustion、clearのfocused test。
- `callFixtureProvider()`からTask-scoped queueを優先する接続。
- unit test用環境変数fallbackの互換test。

最初にTOML化するstructured fixture:

- 正常なschema-first JSON。
- plain text parse failure。
- malformed JSON。
- schema-invalid JSON。
- repair可能なtruncated JSON。

ただし、既存unit testが一回限りの任意入力を検証するために持つinline文字列まで機械的にTOMLへ移さない。catalog化するのは複数E2Eで再利用する応答だけとする。

Exit criteria:

- 同時に存在する複数Taskのqueueが混線しない。
- queue exhaustionが明示errorになる。
- unit test環境変数fixtureが従来どおり動く。
- productionではfixture登録・消費できない。

### Phase 4: Coding Agent native/API E2E fixture

手順:

1. E2E runtime laneを`native-api-runner`へ明示固定する。
2. Task / Runの構造的IDに対してfixture turnsを登録する。
3. Todo、repository read、file edit、command、verification、completionの最小scenarioを作る。
4. assistant本文をCoding Agent keyspaceのTOMLへ置く。
5. tool callとargumentsはCoding Agent moduleが所有するE2E builderへ置く。
6. 実LLM provider keyを設定しなくても完走することを確認する。

Exit criteria:

- Coding Agent direct Runがfixture providerだけで完了する。
- Mission Pilot未起動でもCoding Agent単体E2Eが成立する。
- Codex SDK、OpenAI、Azure、Bedrockへ通信しない。
- Todoの更新はLLM fixtureが明示したtool callだけで行われ、hostが観測結果から暗黙更新しない。

### Phase 5: Mission Pilot → Coding Agent統合E2E

最小scenario:

1. Mission PilotがTaskを読む。
2. Mission PilotがCoding Agent Runを開始する。
3. Coding Agentがnative/API fixtureでrepository作業と検証を行う。
4. Mission Pilotがterminal outcomeを読む。
5. Mission PilotがTask completeを実行する。

追加scenario:

- Coding Agent failure後のMission Pilot repair。
- user interruption / resume。
- runtime restart。
- structured artifact生成を含むPlan経路。

Exit criteria:

- 両roleがそれぞれのfixture turn列を消費する。
- 一方のrole moduleが他方のfixture builderをimportしない。
- 連携は既存application command、port、event、正本schemaを通る。
- Task completeはassistant本文ではなくapplication action成立でのみ確定する。

### Phase 6: Gate統合と旧inline本文整理

変更:

1. fixture catalog stale checkをE2E verificationへ追加する。
2. architecture testでfixture catalogのimport範囲を制限する。
3. target fixture routeにassistant本文inline literalが再導入されないよう検査する。
4. TOML source、catalog JSON、generated TypeScriptを同じ変更単位で管理する。
5. obsoleteなE2E用環境変数fixtureがあれば、利用箇所ゼロを確認してから削除する。
6. unit test用環境変数fixtureは維持する。

Exit criteria:

- fixture TOML変更時にgenerated artifactのstaleがCIで検出される。
- production SystemContext catalogとの混在が静的に検出される。
- E2E mock追加手順がREADMEまたはtest support文書へ記載される。

## 11. Verification Matrix

### 11.1 S11tnext authoring / artifact

| Case | Expected |
| --- | --- |
| 正常TOML | lint / build成功 |
| generated artifact未更新 | `build --check`失敗 |
| catalog digest不一致 | runtime load失敗 |
| 未定義key | TypeScript compile失敗 |
| 未宣言variable | lintまたはtypecheck失敗 |
| `ja-JP` key | fallbackなしでrender成功 |
| 未定義locale | fail-close |
| terminal newline | 既存inline本文とbyte一致 |

### 11.2 fixture runtime

| Case | Expected |
| --- | --- |
| Task A / Bへ別turn登録 | 相互に混線しない |
| 同じTaskへ再登録 | 新scenarioでreplace |
| tool turn消費 | 既存順序どおり |
| `previous_tool_failed` false | 条件turnをskip |
| `previous_tool_failed` true | 条件turnを返す |
| `taskRevision` | 最新tool resultから解決 |
| `latestRunId` | 最新tool resultから解決 |
| structured queue消費 | 登録順どおり |
| queue exhaustion | 明示error |
| cleanup | Task state消去 |
| production登録 | 拒否 |

### 11.3 provider result

| Case | Expected |
| --- | --- |
| 正常JSON | schema validation成功 |
| plain text | raw本文を保持したparse failure |
| malformed JSON | raw本文を保持し、許可済みrepairだけ実行 |
| schema-invalid JSON | schema issueとraw本文を保持 |
| tool call | 既存typed tool callへ変換 |
| tool failure | model-visibleなtool resultとして次turnへ渡る |
| usage | 従来どおりestimateされる |

### 11.4 E2E

| Scenario | Primary assertion |
| --- | --- |
| Mission Pilot Questionnaire | 回答案保存と確定 |
| Mission Pilot autopilot | Coding Agent handoffからTask complete |
| Mission Pilot repair | 失敗outcome読取後のrepair |
| Mission Pilot restart | conversation / Task Fact再取得 |
| Mission Pilot user interruption | wait後の追加指示反映 |
| Coding Agent direct Run | Mission PilotなしでTodoから完了 |
| Integrated handoff | role境界を越えずにend-to-end完了 |

## 12. Verification Commands

実装中のfocused verification:

```bash
bun run s11tnext:fixtures:lint
bun run s11tnext:fixtures:check
bun run test -- tests/llm-fixture-catalog.test.ts
bun run test -- tests/fixture-text-provider.test.ts
bun run test -- tests/mission-pilot-agent-fixture-catalog.test.ts
bun run typecheck
```

Mission Pilot E2E:

```bash
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-questionnaire.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-autopilot.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-repair.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-restart.spec.ts
node scripts/run-playwright.mjs test tests/e2e/mission-pilot-agent-user-interruption.spec.ts
```

統合gate:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run s11tnext:lint
bun run s11tnext:check
bun run s11tnext:fixtures:lint
bun run s11tnext:fixtures:check
bun run check:architecture
bun run check:docs
bun run typecheck
bun run build:backend
bun run verify:e2e
```

既存のdirty worktreeに起因する失敗と本計画の変更に起因する失敗を区別し、未確認の失敗を成功扱いしない。

## 13. Rollout Policy

### 13.1 scenario単位のatomic移行

一つのscenarioについて、TOML追加、artifact生成、generated TypeScript更新、builder参照変更、focused testを同じCheckpointで行う。

同じassistant本文についてinline literalとTOMLを長期併存させない。feature flagや二重readを追加せず、scenario単位でsource of truthを切り替える。

### 13.2 移行順

1. Questionnaire。
2. `autopilot`。
3. `repair`。
4. `restart`。
5. `user-interruption`。
6. structured text fixture。
7. Coding Agent direct Run。
8. Mission Pilot → Coding Agent統合scenario。

正常系を先に移し、catalog / provider接続を安定させてからfailure / restart系へ進む。

### 13.3 rollback

Rollbackはscenario単位で行う。

- TOML、generated artifact、builder変更を同時に戻す。
- provider contractやDB migrationを伴わないため、data rollbackは不要。
- unit test用環境変数fixtureは残るため、structured providerのfocused testは継続できる。

## 14. Risks and Mitigations

### Risk 1: S11tnextのterminal newlineで本文が変わる

Mitigation:

- `trailingNewline: false`をbindingで固定する。
- migration前後のUTF-8 byte equality testを持つ。

### Risk 2: test fixtureがproduction SystemContextへ混入する

Mitigation:

- 別config、別source directory、別generated artifactを使用する。
- `api/systemContexts`からfixture catalogをimportしない。
- architecture testで相互importを禁止する。

### Risk 3: generated artifactがstaleになる

Mitigation:

- TOML、catalog JSON、generated TypeScriptを同一変更単位にする。
- `s11tnext:fixtures:check`をCI gateへ追加する。
- generated TypeScriptを手編集しない。

### Risk 4: tool call構造までTOML化して型安全性を失う

Mitigation:

- TOMLは本文だけを所有する。
- tool call、arguments、conditionは既存TypeScript型へ残す。
- 汎用JSON scenario interpreterを追加しない。

### Risk 5: global fixture stateがTask間で混線する

Mitigation:

- Task IDをkeyにしたMapを維持する。
- structured textもTask-scoped queueとする。
- teardownで明示cleanupする。
- 複数Taskの分離testを追加する。

### Risk 6: E2Eがprovider transport品質まで保証したと誤解される

Mitigation:

- fixture E2Eの対象をagent / application control planeと明記する。
- OpenAI / Azure / Bedrock / Codex transportは既存contract testと任意live canaryで検証する。
- fixture E2E成功をprovider互換性の証拠として扱わない。

### Risk 7: test artifactがbackend bundleを増やす

Mitigation:

- fixture本文は合成test dataだけに限定する。
- `build:backend`を必須検証にする。
- 初期実装では既存E2E fixture routeと同じstatic bundle方針を維持し、専用lazy loading基盤は追加しない。
- bundle増加が実測上問題になった場合だけ、別計画でtest resource解決を検討する。

### Risk 8: 並行中の認証削除と変更が衝突する

Mitigation:

- 認証、listen security、runtime paths、E2E environmentの既存差分を上書きしない。
- fixture catalog追加と既存fixture routeの局所変更を中心にする。
- E2E environment変更が必要な場合は現行差分を読んで最小patchにする。

## 15. Definition of Done

次をすべて満たしたときだけ本計画を完了とする。

1. 新規Simulator project、HTTP server、npm package、SQLite、認証機構が追加されていない。
2. test専用S11tnext config、TOML、catalog JSON、generated TypeScript、bindingが存在する。
3. production SystemContext catalogがfixture dataを含まない。
4. Mission Pilot E2Eのassistant本文がTOMLをsource of truthとしている。
5. Coding Agent native/API E2Eのassistant本文がTOMLをsource of truthとしている。
6. tool call、arguments、condition、turn順序がrole-owned TypeScriptに残っている。
7. 既存Mission Pilot fixture turn構造が移行前baselineと一致する。
8. structured text fixtureがTask単位で分離され、unit test環境変数互換が維持される。
9. fixture stateがSQLite、file、Keychainへ保存されない。
10. fixture選択にprompt keyword、正規表現、error message分類を使用していない。
11. Mission Pilot / Coding Agentのmodule境界を迂回するimportがない。
12. S11tnext fixture lint / stale checkが成功する。
13. focused unit test、typecheck、architecture check、backend buildが成功する。
14. Mission Pilot主要E2EとCoding Agent direct Run E2Eが実LLMなしで成功する。
15. provider transport品質をfixture E2Eだけで保証した扱いにしていない。
16. 既存のユーザー所有変更を削除、上書き、巻き戻ししていない。

## 16. Implementation Handoff Checklist

実装担当は開始前に次を確認する。

- [ ] `AGENTS.md`を読んだ。
- [ ] `spec/s11t-coding-agent-guide.md`を読んだ。
- [ ] `git status --short`で既存差分を記録した。
- [ ] 現行`s11tnext` / `s11tnext-cli` versionとlock integrityを確認した。
- [ ] Mission Pilot fixture turn baselineを取得した。
- [ ] test専用catalogをproduction SystemContext catalogから分離した。
- [ ] `trailingNewline: false`を固定した。
- [ ] TOMLと生成物を同時更新した。
- [ ] generated TypeScriptを手編集していない。
- [ ] tool call構造をTOMLへ移していない。
- [ ] scenario選択にprompt keywordを追加していない。
- [ ] unit test環境変数fixtureを壊していない。
- [ ] Task-scoped fixture cleanupを確認した。
- [ ] focused testとE2Eを実行した。
- [ ] `build:backend`でartifact packagingを確認した。
- [ ] 失敗を未確認のまま完了扱いしていない。
