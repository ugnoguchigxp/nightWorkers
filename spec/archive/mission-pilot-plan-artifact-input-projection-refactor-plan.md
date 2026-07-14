# Mission Pilot Plan Artifact Input Projection Refactor Plan

## Status

- Plan status: `implemented`
- Document review: `implementation-ready` (2026-07-14)
- Document created: 2026-07-14
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target runtime span: Mission Pilot Plan routing確定後のArtifact生成、再生成、self-reviewまで
- Implementation completed and verified on 2026-07-14.

## 1. Purpose

Mission Pilot / Plan Mode の各Artifact生成へ渡す入力を、task全体のmessage全文やCodexの会話履歴ではなく、永続化済みの正本から作るArtifact別の最小projectionへ置き換える。

このリファクタは入力をゼロベースにしない。次は必須の設計情報として保持する。

- ユーザーが投入した初期prompt。
- 確定済みQuestionnaireの採用回答。
- 対象repositoryで検出した現在のstackと、Questionnaire / taskで確定した計画上の制約。
- 現在のrouting revisionで採用されているArtifact。
- ユーザーまたはreview correctionが与えた今回の再生成指示。

一方、次はArtifact生成入力から除外する。

- 同じ初期promptやArtifact summaryの重複。
- Questionnaireの全option、未採用option、raw question set全文。
- task全体から暗黙に選んだlatest message。
- omitted / stale revisionのArtifact。
- Codexの過去会話、tool call、MCP result、`initial_instructions`、`context_compile`などのcoding-agent実行履歴。

## 2. Confirmed Baseline

2026-07-14のMission Pilot session `18fc7544-407c-414c-840d-6f960e3babbe`、task `83a6920f-a8a9-471a-b236-cfb16fcbac31`で、次を確認した。

| Artifact | user prompt chars | Questionnaire answers | initial prompt occurrences | duration | provider input |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blueprint | 3,285 | 10 | 1 | 65.0s | 158,289 |
| Data Model | 4,641 | 10 | 2 | 46.3s | 114,657 |
| Feature Plan | 8,128 | 10 | 1 | 34.9s | 19,334 |
| Plan Review | 18,622 | canonical JSON内 | 2 | 25.5s | 25,162 |
| API Contract | 6,877 | 0。session IDのみ | 2 | 155.3s | 158,345 |

API Contractの158,345 input tokensのうち128,512はcached inputだったが、applicationが作ったuser promptは12,129 bytesにすぎない。したがって主因をArtifact本文だけに求めず、Codex structured-generation laneで発生した複数turn / instruction / tool履歴も分離して扱う。

現行コードの問題は次のとおり。

1. `planView-generation.service.ts`はQuestionnaire sessionをロードせず、session IDの文字列だけをAPI Contract / Zod / generic viewへ渡す。
2. Data ModelとPlan Viewは`task`内のobjectiveと`prompt` fallbackの両方へ初期promptを入れる。
3. Mission Pilotの`generateStepArtifact()`はsource message IDをgeneratorへ渡さず、generatorがtask messageの逆順検索でlatestを暗黙選択する。
4. Feature Planは専用のBlueprint / Data Model / Plan View summaryに加えて、`Plan Mode References`から同じArtifactを再投入する。
5. project stack detectorは未materialized repositoryを「未検出」とだけ表現し、確定済みの計画stackと区別しない。
6. Codex structured providerはMCPを無効設定にしているが、working directoryの既定値がNightWorkers process cwdであり、task / schema単位のCodex thread resumeも行う。structured artifact生成をcoding-agentのproject instructionや過去turnから独立させる契約が弱い。

### 2.1 Document review findings resolved by this revision

初版には、実装開始時に判断が必要になる次の曖昧さが残っていた。本改訂で以下を固定する。

1. 新規module名が「推奨」に留まっていたため、追加するfileと公開関数をSection 5で確定する。
2. source選択がdependency matrixだけで、step status / routing revision / correction時の優先順位を実装できなかったため、Section 6でselection algorithmとerrorを確定する。
3. prompt cache方針はあったがmodel-visible section順が未定だったため、Section 7で全targetの共通順序を確定する。
4. Codex隔離でisolated `CODEX_HOME`を前提にすると認証継承が未解決になるため、その案を撤回する。既存authを維持したまま、SDKのdocumented config overrideで`project_doc_max_bytes=0`、MCP無効、fresh thread、isolated cwdを適用する。
5. 段階移行に切替単位とrollback条件がなかったため、Section 8をreview可能なimplementation sliceへ分割する。
6. 新規test名と既存test名が混在していたため、Section 8 / 9で新規・更新を明記する。

## 3. Scope

### 3.1 In scope

- Plan Artifact生成用canonical inputとArtifact別projectionの型・builder。
- 初期prompt、Questionnaire decisions、project context、routing/source provenance、再生成指示の分離。
- Mission Pilot context snapshot / step evidenceからの明示的source選択。
- Blueprint、Data Model、Feature Plan、API Contract、Zod、generic Plan View、Plan Reviewの入力切替。
- Feature Planから広域な`Plan Mode References`再投入を外す。
- current detected stackとaccepted planning constraintsの別表示。
- NightWorkers structured Codex executionのstateless / tool-less / instruction-document-less isolation。
- prompt section size、source digest、重複、provider turn、tool call、token、durationの観測。
- focused tests、integration tests、trace regression fixture、live provider確認。

### 3.2 Out of scope

- ユーザーが通常のCodex coding taskで使うglobal `AGENTS.md`やcontextStill運用の変更。
- `initial_instructions` / `context_compile` tool自体の削除または仕様変更。
- Questionnaireの質問生成ロジックや選択肢の再設計。
- Plan Artifact本文schemaの全面変更。
- routing include / omit判断、review score、correction回数上限の変更。
- target repositoryのmaterialization / starter import処理の変更。
- provider共通層へのMission Pilot固有SystemContext追加。
- DB schema migration。既存context snapshotとmessage metadataを読み取る範囲で実装する。

## 4. Locked Decisions

### 4.1 Canonical facts and projections

1. canonical factsの正本はMission Pilot context snapshot、routing revision、step evidence、Questionnaire session、task row、repository rowとする。
2. LLM prompt文字列を正本にしない。文字列はtyped canonical factsから最後にrenderする。
3. Artifact generatorはtask全messageを検索しない。source selectionは呼び出し境界で確定し、source message IDとdigestを渡す。
4. 初期promptは`task.initialPrompt`として1回だけrenderする。追加promptと兼用しない。
5. 再生成指示は`regenerationRequest: string | null`として別fieldにし、存在するturnだけrenderする。
6. Questionnaireは確定したquestion、selected answer label、free text、deferred / unresolved状態、根拠だけをrenderする。全optionとtradeoffは渡さない。
7. Questionnaire回答をkeyword / regexでArtifact別分類しない。回答数が通常範囲なら採用回答を全件渡し、schema上の明示的なsection metadataがある場合だけそのmetadataでprojectionする。
8. current detected stackとaccepted planning constraintsを別sectionにする。未materializedをstack未決定と同義にしない。
9. omitted viewと異なるrouting revisionのArtifactはprojectionへ入れない。
10. source欠落時は別のlatest messageで補完せず、warningまたはgeneration前errorとして扱う。

### 4.2 Structured Codex isolation

1. structured artifact生成はcoding agentではなく、schema付きの単発generationとして扱う。
2. NightWorkers structured Codex callではMCP、network、shell、repository writeを利用しない。
3. structured artifact用に空のisolated working directoryを用意し、Codex SDKのper-call configへ`project_doc_max_bytes: 0`を設定する。これによりglobal / project `AGENTS.md`をmodel inputへ入れない。
4. `CODEX_HOME`は変更しない。既存authを維持し、temporary homeへのcredential copyやユーザーの再loginを要求しない。
5. structured artifact callは既定でfresh threadとする。同じtask / schemaの過去turnをresumeしない。
6. JSON repairは明示的な2回目の単発callとして許可するが、1つ目のCodex thread historyを引き継がない。
7. SDK resultにcommand execution、MCP call、web callなどのagentic itemがあった場合はinvariant violationとして記録し、そのcallを成功扱いにしない。
8. この隔離は`api/services/structured-llm/codex-provider.ts`のstructured laneだけに適用し、`api/services/agent-runtime/codex-sdk/`のcoding / review runtimeには適用しない。
9. `project_doc_max_bytes: 0`でもinstruction sourceまたはMCP activityがlive canaryで観測された場合、通常のCodex設定へfallbackしない。既存のstructured route fallbackへ失敗を返し、fallback providerが未設定ならgenerationを失敗させる。

### 4.3 Prompt budget policy

1. token削減のために必須設計判断をsilent truncationしない。
2. sectionごとに文字数、bytes、digest、source countを計測する。
3. budget超過時はraw全文を末尾切断せず、Artifact固有rendererでsummaryを再構築する。
4. それでも上限を超える場合は`PLAN_ARTIFACT_INPUT_BUDGET_EXCEEDED`として停止し、欠落した状態で生成しない。
5. prompt cache由来のcached tokensと、NightWorkersが毎回投入するnon-cached tokensを別指標として扱う。

### 4.4 Prompt cache semantics

1. prompt cacheは入力の正本または会話memoryとして扱わない。各generation requestは、そのArtifactを正しく生成するために必要なprojectionを単独で完結して送る。
2. cached inputであってもrequest上は同じprefixを再送する。cache hitはそのprefixの再計算と課金を減らす最適化であり、入力省略を許可する機能ではない。
3. cache miss、cache expiration、別workerへのroutingが起きても生成結果の意味が変わらないことを必須にする。
4. cache hit率を上げる最適化は、必須情報を削るのではなく、同一Artifact種別で共通するsystem instruction、schema guidance、安定したcanonical sectionを前方へ置き、再生成指示などturn固有差分を後方へ置くことで行う。
5. Artifactごとにoutput schemaやinstructionが異なるため、全Artifactを無理に一つの共通promptへ統合しない。共通prefix化はprompt clarityを維持でき、traceでcache改善を確認できる範囲だけに限定する。
6. fresh thread化とprompt cacheは両立する。過去の会話stateは再利用せず、同一prefixに対するprovider側のcacheだけを利用する。

## 5. Target Model

新規fileは既存のPlan Mode context assemblyがある`api/modules/specification/`へ置く。新しいtop-level moduleは作らない。

- `api/modules/specification/plan-artifact-input.types.ts`: 型とversion定数だけを持つ。
- `api/modules/specification/plan-artifact-input-context.service.ts`: task / Questionnaire / repository / messageを読み、canonical inputを作る。prompt文字列は作らない。
- `api/modules/specification/plan-artifact-source-selection.ts`: source IDの検証とmessage取得を行う。task全messageからlatestを選ばない。
- `api/modules/specification/plan-artifact-input-projection.ts`: target別のpure projectionとbudget diagnosticsを作る。
- `api/modules/specification/plan-artifact-input-renderer.ts`: projectionをmodel-visible textへrenderする。
- `tests/services.plan-artifact-input-projection.test.ts`: 上記4fileのfocused unit testをまとめる新規test。

公開型と関数名は次で固定する。

```ts
export const PLAN_ARTIFACT_INPUT_PROJECTION_VERSION = 1 as const;

export type PlanArtifactGenerationTarget =
  | PlanModeRegenerationTarget
  | "plan_review";

export type AcceptedQuestionnaireDecision = {
  questionId: string;
  question: string;
  answer: string;
  why: string | null;
  outputSection: string | null;
  deferred: boolean;
};

export type PlanArtifactSourceSelection = {
  previousTargetMessageId: string | null;
  featurePlanMessageId: string | null;
  blueprintMessageId: string | null;
  dataModelMessageId: string | null;
  dedicatedViewMessageIds: string[];
  policy: "mission_pilot_step" | "explicit_request";
};

export type PlanArtifactCanonicalInput = {
  target: PlanArtifactGenerationTarget;
  task: {
    id: string;
    title: string;
    description: string | null;
    initialPrompt: string;
    acceptanceCriteria: string | null;
  };
  questionnaire: {
    sessionId: string;
    digest: string;
    status: string;
    decisions: AcceptedQuestionnaireDecision[];
    unresolvedBlocking: BlockingQuestion[];
  } | null;
  project: {
    repositoryId: string;
    name: string;
    root: string;
    materializationState: "materialized" | "empty" | "missing";
    detectedStack: DetectedProjectStack | null;
    packageScripts: Array<{ name: string; command: string }>;
  };
  routing: {
    revision: number;
    includedViews: string[];
    omittedViews: Array<{ view: string; reason: string | null }>;
  };
  sources: Array<{
    kind: string;
    messageId: string;
    digest: string;
    routingRevision: number | null;
    renderedContent: string;
  }>;
  regenerationRequest: string | null;
  provenance: {
    missionPilotSessionId: string | null;
    contextRevision: number | null;
    contextDigest: string | null;
    routingRevision: number;
  };
};

export type PlanArtifactInputProjection = {
  version: typeof PLAN_ARTIFACT_INPUT_PROJECTION_VERSION;
  target: PlanArtifactGenerationTarget;
  task: PlanTaskProjection;
  questionnaireDecisions: AcceptedQuestionnaireDecision[];
  projectContext: PlanProjectContextProjection;
  sourceArtifacts: PlanSourceArtifactProjection[];
  regenerationRequest: string | null;
  provenance: {
    contextRevision: number | null;
    contextDigest: string | null;
    routingRevision: number;
    questionnaireDigest: string | null;
    sourceMessageIds: string[];
  };
  diagnostics: PlanArtifactInputDiagnostics;
};

export async function resolvePlanArtifactCanonicalInput(input: {
  taskId: string;
  target: PlanArtifactGenerationTarget;
  questionnaireSessionId: string | null;
  sourceSelection: PlanArtifactSourceSelection;
  regenerationRequest: string | null;
  expectedState?: {
    missionPilotSessionId: string;
    contextRevision: number;
    contextDigest: string;
    routingRevision: number;
  };
}): Promise<PlanArtifactCanonicalInput>;

export function projectPlanArtifactInput(
  canonical: PlanArtifactCanonicalInput,
): PlanArtifactInputProjection;

export function renderPlanArtifactInput(
  projection: PlanArtifactInputProjection,
): {
  task: string;
  questionnaire: string;
  projectContext: string;
  featurePlan: string;
  blueprint: string;
  dataModel: string;
  dedicatedViews: string;
  regenerationRequest: string | null;
  diagnostics: PlanArtifactInputDiagnostics;
};
```

`AcceptedQuestionnaireDecision`は既存`renderQuestionnaireAnswer()`と同じanswer解決を使う。`renderQuestionnaireAnswerMarkdown()`の出力を再parseしない。question setとanswer rowを直接joinし、selected option label / free text / boolean / deferredを1件1recordへ正規化する。

技術stack回答をkeywordや`q2`固定IDで抽出しない。採用回答は`Questionnaire Decisions`に全件残す。`Project Context`は検出済みcurrent stateとmaterialization stateだけを持ち、「計画上の制約はQuestionnaire Decisionsを正とする」と表示する。同じ回答を`project.acceptedPlanningConstraints`へ複製しない。

Artifact message metadataにはDB migrationなしで次を追加する。

```ts
generation: {
  // existing fields are preserved
  inputProjection: {
    version: 1;
    target: PlanArtifactGenerationTarget;
    digest: string;
    contextRevision: number | null;
    contextDigest: string | null;
    routingRevision: number;
    questionnaireSessionId: string | null;
    questionnaireDigest: string | null;
    sourceMessageIds: string[];
    sourceDigests: string[];
    sectionBytes: Record<string, number>;
  };
}
```

## 6. Source Selection Contract

### 6.1 Mission Pilot source resolver

`mission-pilot-plan-support.ts`へ次を追加する。

```ts
async function resolveMissionPilotPlanArtifactSources(input: {
  sessionId: string;
  stepId: string;
  target: PlanArtifactGenerationTarget;
}): Promise<{
  selection: PlanArtifactSourceSelection;
  expectedState: {
    missionPilotSessionId: string;
    contextRevision: number;
    contextDigest: string;
    routingRevision: number;
  };
}>;
```

selection algorithmは次の順序で固定する。

1. `mission_pilot_sessions`、latest `mission_pilot_context_snapshots`、`mission_pilot_steps`を同じresolver内で読む。
2. 対象stepがcurrent sessionに属し、`status=running`であることを確認する。
3. dependency候補は`status=completed`、`artifact_message_id IS NOT NULL`、`evidence_json.artifactRoutingRevision === session.planRoutingRevision`をすべて満たすstepだけとする。
4. `evidence_json.decision=omit`、`invalidatedByRoutingRevision`がcurrent revision、対象stepより後順位のstepを除外する。
5. step kind / viewからBlueprint、Data Model、Dedicated View、Feature Planへ分類し、message IDを`PlanArtifactSourceSelection`へ設定する。
6. current routingでincludeされ、対象stepより前に完了すべきdependencyがpending / failed / missingなら、別messageへfallbackせず`PLAN_ARTIFACT_DEPENDENCY_NOT_READY`で停止する。
7. resolver完了後、generator result永続化前に既存のsession / context / routing revision checkを再実行する。変化していればresultを採用しない。

### 6.2 Manual / correction source resolver

- HTTP / frontend commandで渡されたsource message IDを`policy=explicit_request`として使う。
- public route schemaの既存`featurePlanMessageId`、`sourceBlueprintMessageId`、`sourceDataModelMessageId`は後方互換のため維持し、route serviceで`PlanArtifactSourceSelection`へ変換する。新しいpublic request shapeは追加しない。
- IDがある場合はtask ID、artifact kind / view、message metadataを検証する。不一致は`PLAN_ARTIFACT_SOURCE_KIND_MISMATCH`とする。
- IDがないsourceは`null`のまま扱う。`listPlanModeTaskMessages().reverse().find(...)`へfallbackしない。
- correctionでは`claimed.sourceMessageId`を`previousTargetMessageId`へ必ず設定する。
- correctionの他dependencyは、既存rowの`sourceContextRevision` / `sourceContextDigest`に一致する`mission_pilot_context_snapshots`から解決する。新しいDB columnは追加しない。実行時の`workspace.*Artifacts.at(-1)`を新たに選ばない。
- `mission-pilot-plan-support.ts`の`latestContext()`を流用して過去revisionを推測せず、`mission-pilot-plan.repository.ts`へ`getPlanContextSnapshot(sessionId, revision)`を追加する。取得rowのdigestがcorrection runの`sourceContextDigest`と一致しなければ`PLAN_ARTIFACT_CONTEXT_STALE`とする。
- frontend / workbenchが現在選択中Artifactをsourceにしたい場合は、そのIDをcommand payloadへ明示的に追加する。backend generatorはUI selectionを推測しない。

### 6.3 Error contract

| Code | HTTP | Condition | Retry |
| --- | ---: | --- | --- |
| `PLAN_ARTIFACT_CONTEXT_STALE` | 409 | expected context / routing revisionがcurrentと不一致 | current stateを再読込してstepを再実行 |
| `PLAN_ARTIFACT_DEPENDENCY_NOT_READY` | 409 | includeされた先行dependencyが未完了 | dependency完了後に再実行 |
| `PLAN_ARTIFACT_SOURCE_NOT_FOUND` | 422 | 明示source IDのmessageが存在しない | source selectionを修正 |
| `PLAN_ARTIFACT_SOURCE_KIND_MISMATCH` | 422 | source messageのtask / kind / viewが不一致 | source selectionを修正 |
| `PLAN_ARTIFACT_INPUT_BUDGET_EXCEEDED` | 422 | 必須sectionを保持したprojectionがbudget超過 | renderer / budgetを見直す。欠落状態で生成しない |

既存のstop / lease loss errorはこのerror contractへ置換しない。先に発生した既存lifecycle errorをそのまま優先する。

### 6.4 Artifact Dependency Matrix

| Target | Required input | Explicit source input | Excluded input |
| --- | --- | --- | --- |
| Blueprint | task initial prompt、採用Questionnaire、project current state、再生成指示 | correction時のprevious Blueprint | latest Feature Plan、Data Model全文、全workspace references |
| Data Model | task initial prompt、採用Questionnaire、project current state | active Blueprintのroute/state要約 | task objectiveの重複、Feature Plan全文、omitted views |
| API Contract | task initial prompt、採用Questionnaire、project current state | current routing revisionで完了済みのData Model contractとBlueprint interaction要約。Feature Planは同revisionで既に完了済みの場合だけ | session IDだけのQuestionnaire、旧revision Feature Plan、Zod重複、全message |
| Zod Schema | task initial prompt、採用Questionnaire、project current state | OpenAPI外validationに必要なactive sourceだけ | API Contractで表現済みのHTTP validation再掲 |
| Generic flow view | task initial prompt、採用Questionnaire | routingでactiveな直接依存Artifactの要約 | unrelated Artifact全文 |
| Feature Plan | task、採用Questionnaire、project current state、active routing | active Artifactごとの短いcanonical reference | `Plan Mode References`全件、旧Feature Plan、自身の本文 |
| Plan Review | task、採用Questionnaire、project current state、routing/context revision | active Artifactのreview用projection | canonical context JSON全文、stale / omitted Artifact、taskの重複 |

Artifact routingがAPI Contractをomitしたtaskでは、API Contract projectionもLLM callも作らない。Feature PlanにAPI Contract sectionを強制追加しない。後続reviewが必要性を判断した場合は、既存routing mutationを使ってincludeした後に初めて生成する。

## 7. Model-visible Prompt Contract

全Artifactのuser promptは次の順序に固定する。該当sourceがないsectionは`未生成です`の定型文を入れず、section自体を省略する。routing上includeなのに必要なsourceがない場合はrender前にSection 6のerrorで停止する。

1. `## Generation Target`: target名と「このArtifactだけを生成する」という1文。
2. `## Task Baseline`: title、description、initial prompt、acceptance criteria。initial promptはここだけに置く。
3. `## Questionnaire Decisions`: 全accepted decisionsをpersisted順ではなくquestion set sequence / question orderで安定sortして置く。
4. `## Current Project State`: repository名、root、materialization state、detected stack、既存package scripts。「計画上の制約はQuestionnaire Decisionsを正とする」を付ける。
5. `## Source Artifacts`: Section 6で選択したsourceだけをdependency順に置く。順序はBlueprint、Data Model、API Contract、Zod、flow、Feature Plan、previous targetとする。
6. `## Regeneration Request`: 値がある場合だけ最後に置く。通常生成ではsectionを作らない。

source message ID、digest、context revision、routing revisionはmodel-visible promptへ入れず、generation metadataとtraceだけに保存する。

system promptはArtifactごとのoutput responsibility、禁止事項、JSON schemaだけを持つ。task、Questionnaire、project path、source Artifact本文、再生成指示をsystem promptへ入れない。

既存prompt builderは一括削除しない。Phase 2では`renderPlanArtifactInput()`の戻り値を既存builder引数へadapterし、出力差分testを作る。Phase 3で各builderを`PlanArtifactInputProjection`直接入力へ切り替え、adapterを削除する。

## 8. Implementation Phases

### Phase 0. Baseline fixtures and invariants

Purpose: 今回の問題を再現できるfixtureを固定し、リファクタ後の削減と欠落防止を同時に測れるようにする。

Changes:

- 最新sessionのtask、Questionnaire decisions、routing、Artifact source metadataを匿名化したfixtureとして追加する。
- 現行prompt builder出力について、section bytes、初期prompt出現数、Questionnaire answer数、source message IDsをsnapshotする。
- structured Codex providerの`itemCount`、provider thread resume、MCP / command item、input / cached / non-cached tokens、durationをbaseline化する。
- prompt内容そのものをproduction logへ追加で常時保存しない。既存traceのdigest / lengthとtest fixtureを使う。

Files:

- `tests/fixtures/plan-artifact-input/*`
- `tests/services.plan-artifact-input-projection.test.ts`（新規）
- `tests/services.plan-view-generators.test.ts`
- `tests/mission-pilot-plan-coordinator.test.ts`
- `tests/structured-llm/codex-provider-resume.test.ts`（既存。baseline assertionを追加）

Gate:

```bash
bun run test -- tests/services.plan-artifact-input-projection.test.ts tests/services.plan-view-generators.test.ts tests/mission-pilot-plan-coordinator.test.ts
```

### Phase 1. Canonical input and accepted decision renderer

Purpose: 各generatorが独自にDB / workspace / latest messageを読む状態を止めるための共通正本を作る。

Changes:

- Mission Pilot context snapshotからtask initial prompt、Questionnaire session ID / digest、context revision / digest、routing revisionを読むresolverを追加する。
- Questionnaire serviceから確定回答だけを`AcceptedQuestionnaireDecision[]`へ変換するrendererを追加する。
- raw question set全文、未採用options、tradeoff一覧をprojectionへ入れない。
- project contextをrepository identity、materialization state、detected stack、package scriptsへ構造化する。
- current stack未検出時は`materializationState=empty|missing`を返し、「計画stack未決定」と表現しない。
- canonical input自体にはactive source messageのID / digest / revisionだけを保持し、render前に必要な要約を解決する。
- `plan-artifact-input-context.service.ts`は`getPlanModeTask()`、Questionnaire service、`getRepository()`、`detectProjectStackProfile()`を呼ぶ唯一のassembly serviceとする。
- `plan-artifact-input-projection.ts`とrendererはDB / filesystemへアクセスしないpure functionとする。

Compatibility:

- 手動Plan Mode生成はMission Pilot snapshotを必須にしない。task / selected Questionnaire / explicit source IDsから同じcanonical typeを作る。workspace latest selectionをcanonical serviceへ持ち込まない。
- このphaseでは新builderをproduction callへ接続しない。旧generatorのlatest fallbackは既存runtimeに残るが、新builderのtestからは呼ばない。

Gate:

```bash
bun run test -- tests/services.plan-artifact-input-projection.test.ts tests/services.spec-document-renderer.test.ts tests/plan-mode-project-stack-context.test.ts
```

### Phase 2. Explicit source selection at Mission Pilot boundary

Purpose: current sessionで採用したArtifactだけを下流へ渡す。

Changes:

- `mission-pilot-plan-support.ts`の`generateStepArtifact()`で、current context snapshotとcompleted step evidenceから`PlanArtifactSourceSelection`を構築する。
- `questionnaireSessionId`だけでなく、context revision / digest、routing revision、dependency source message IDsをgeneratorへ渡す。
- source IDがcurrent routing / contextと一致しない場合はstepを失敗させる。
- generator inputへ`sourceSelection`と`expectedState`を追加する。既存の個別source ID fieldsはmanual API互換のためPhase 6まで残し、entry pointで`PlanArtifactSourceSelection`へ変換する。
- Mission Pilot pathでは個別source ID fieldsを使わず、resolver結果だけを渡す。
- manual regeneration pathは選択中Artifact IDを明示し、選択がないsourceは`null`とする。
- persisted generation metadataへprojection version、source IDs、source digests、routing / context revisionを保存する。

Gate:

```bash
bun run test -- tests/mission-pilot-plan-coordinator.test.ts tests/mission-pilot-plan-pipeline.test.ts tests/plan-mode-routing-service.test.ts tests/plan-mode-workspace-service.test.ts
```

### Phase 3A. Switch Plan View and Data Model generators

Purpose: 今回のincidentを起こしたPlan Viewと、同じprompt重複を持つData Modelを先に切り替える。

Changes:

- Data Model / Plan View service entryでcanonical inputを1回だけ構築する。
- `buildDataModelUserPrompt()`、`buildPlanApiContractUserPrompt()`、`buildPlanZodSchemaUserPrompt()`、`buildPlanDedicatedViewUserPrompt()`をprojection直接入力へ切り替える。
- `task.initialPrompt`と`regenerationRequest`を別sectionとしてrenderする。
- Plan ViewでQuestionnaire sessionを必ず解決し、accepted decisions本文を渡す。
- Data Model / Plan Viewの`prompt ?? task.objective` fallbackを削除する。
- `plan-view-generic-parser.ts`の`resolveMessage(... latest ...)`をPlan View production pathから外す。関数削除はPhase 6で行う。
- API Contract fixtureでaccepted decision 10件、initial prompt 1回、session ID only marker 0件をassertする。

Primary files:

- `api/modules/dataModel/dataModel-generation.service.ts`
- `api/modules/planViews/planView-generation.service.ts`
- `api/services/structured-generation/prompts/data-model.ts`
- `api/services/structured-generation/prompts/plan-api-contract.ts`
- `api/services/structured-generation/prompts/plan-zod-schema.ts`
- `api/services/structured-generation/prompts/plan-dedicated-view.ts`

Gate:

```bash
bun run test -- tests/services.plan-artifact-input-projection.test.ts tests/services.data-model-generation.test.ts tests/services.plan-view-generators.test.ts tests/mission-pilot-plan-coordinator.test.ts
```

Rollback condition:

- accepted decision count、source digest、initial prompt occurrenceのいずれかが期待と不一致なら、Blueprint / Feature Plan切替へ進まない。

### Phase 3B. Switch Blueprint, Feature Plan, review, and correction

Purpose: 残るgeneratorとreviewを同じcanonical resolverへ揃える。

Changes:

- Blueprint、Feature Plan、Plan Reviewでcanonical inputを1回だけ構築する。
- Blueprintの`resolveLatestSpecContext()`を削除し、correction時のprevious Blueprintだけを明示参照する。
- Feature Planの`planModeReferences`全件投入を削除し、active Artifact summary / source ID / digestだけを渡す。
- Plan Reviewの`canonicalContext` JSON全文をreview projectionへ置き換える。
- prompt rendererに同一source ID、同一digest、初期prompt複数出現のassertionを追加する。
- `executeMissionPilotArtifactCorrection()`はcorrection runの`sourceContextRevision` / `sourceContextDigest`に一致するsnapshotからdependency sourceを解決し、実行時の`workspace.*Artifacts.at(-1)`を使わない。

Primary files:

- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/missionPilot/mission-pilot-plan-review.service.ts`
- `api/modules/missionPilot/mission-pilot-artifact-correction.service.ts`
- `api/modules/planMode/plan-mode-artifact-correction.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `api/services/structured-generation/prompts/mock-blueprint.ts`

Gate:

```bash
bun run test -- tests/mock-blueprint.test.ts tests/specification-document-generation.test.ts tests/services.spec-document-renderer.test.ts tests/services.questionnaire-decision-layer.test.ts tests/mission-pilot-plan-pipeline.test.ts tests/mission-pilot-plan-coordinator.test.ts
```

### Phase 4. Isolate structured Codex execution

Purpose: NightWorkersの構造化Artifact生成でcoding-agentのinstruction / MCP / past threadを実行させない。

Changes:

- `codex-provider.ts`へ`structuredArtifact` execution profileを追加する。
- empty temporary working directoryをrun単位で用意し、cleanupは成功・失敗・abortの全経路で行う。`CODEX_HOME`は変更しない。
- `new Codex({ config })`へ`project_doc_max_bytes: 0`、`features.mcp: false`、`mcp_servers: {}`を明示する。network無効、approval never、read-onlyを維持する。
- structured laneの`RuntimeSessionStateStore` lookup / resumeを既定で無効化する。
- provider system promptとArtifact projectionをfresh threadの1 turnへ渡す。
- repairは別fresh threadで実行する。
- returned itemsを検査し、agentic itemを検出した場合は既存`rejectProviderActivity()` / `ProviderActivityRejectedError`を使う。新しい固定error本文へ置換しない。
- provider debugへ`executionProfile`、`freshThread`、`agenticItemCount`、`turnCount`、`isolatedWorkingDirectory`のbooleanだけを記録する。temp pathやsecretは記録しない。
- `codex-provider-resume.test.ts`の既存resume期待を変更し、structured artifactでは2回目も`startThread()`、`resumeThread()` 0回を期待する。
- live canaryでglobal / project `AGENTS.md`由来marker、MCP call、command executionが0件であることを確認する。失敗時は既存route fallbackへerrorを返し、Codex通常設定やdirect providerへ黙って切り替えない。

Gate:

```bash
bun run test -- tests/llm-semantic-boundary-architecture.test.ts tests/structured-llm/codex-provider-resume.test.ts tests/structured-llm/services-structured-llm-02.test.ts
```

Live gate:

```bash
bun run verify:live
```

live gateは明示的なexternal-provider検証として実行し、通常のdeterministic `verify`へ混ぜない。

### Phase 5. Budget diagnostics and regression guards

Purpose: 欠落を起こさず、再肥大化を検知できるようにする。

Changes:

- `StructuredLlmPromptBudgetMetadata`へoptional `artifactProjection` objectを追加し、target、projection version / digest、section chars / bytes、source count、deduplicated countを格納する。既存required fieldsを変更しない。
- generatorは既存`resolveStructuredLlmModelCapability({ role, routeOverride })`と`estimateTokens()`を使い、system + rendered projectionを`safePromptBudgetTokens`と比較する。新しいmodel別budget tableを作らない。
- budget超過時の圧縮順は、source Artifactのraw本文を既存canonical summary rendererへ置換、package scriptsをname-onlyへ縮小、previous targetをfocus対象周辺へ縮小、の順とする。Task Baseline、accepted Questionnaire Decisions、Regeneration Requestは削除しない。
- 上記圧縮後も`safePromptBudgetTokens`を超える場合だけ`PLAN_ARTIFACT_INPUT_BUDGET_EXCEEDED`を返す。
- LLM traceへ以下を追加する。
  - `projectionVersion`
  - `projectionDigest`
  - `questionnaireDecisionCount`
  - `initialPromptOccurrences`
  - `sourceMessageCount`
  - `staleSourceRejectedCount`
  - `agenticItemCount`
  - `providerTurnCount`
- raw Questionnaire回答やinitial prompt本文を新しいmetrics fieldへ保存しない。
- normal generationは1 provider turn、schema repair時だけ最大2 callというguardを設ける。
- Artifactごとのsection budgetをfixture実測から設定する。初期値をコードへ直書きせず、共通定数とdiagnostics reasonを持たせる。
- hard timeoutは一律155秒超を許容する設定にせず、deterministic test後のlive baselineから通常callとrepair callを分けて設定する。目標SLOはnormal generation p95 60秒未満、hard timeout 90秒以下とし、provider障害とbudget超過を別error codeにする。

Gate:

```bash
bun run test -- tests/services.plan-artifact-input-projection.test.ts tests/specification-generation-timeout.test.ts tests/services.llm-usage-summary.test.ts
```

### Phase 6. Remove compatibility fallbacks and close out

Purpose: 新旧経路の二重化を残さない。

Changes:

- Mission Pilot / manual generationの全call siteがtyped projectionを使うことをarchitecture testで固定する。
- generator内部のlatest message fallback、task objective prompt fallback、Plan Mode References全件投入を削除する。
- internal generator inputからPhase 2で残した個別source ID compatibility fieldsを削除し、route / frontend / workbench boundary adapterだけが既存public fieldsを`sourceSelection`へ変換する構造にする。public route schemaは変更しない。
- obsolete renderer / helperを削除する。
- plan artifact correctionがprevious sourceとregeneration requestを明示的に引き継ぐことを確認する。
- docsへcanonical facts / projection / structured isolationの責務境界を追記する。
- 本書のstatusを`implemented`へ更新するのはfocused gate、`bun run verify`、live Codex scenarioがすべて成功した後だけとする。

Final gate:

```bash
bun run verify
bun run verify:live
```

### 8.1 Reviewable implementation slices

| Slice | Runtime behavior change | Required gate | Do not proceed when |
| --- | --- | --- | --- |
| 1. Foundation | none。fixture、types、canonical resolver、pure projectionのみ追加 | Phase 0 / 1 gate | accepted decisionまたはinitial promptがcanonical inputで欠落する |
| 2. Mission Pilot sources | stepからexplicit source selectionを生成しmetadataへ記録 | Phase 2 gate | routing / context revision mismatchを検出できない |
| 3A. Plan View + Data Model | API / Zod / generic / Data Modelがnew projectionへ切替 | Phase 3A gate | API Contractが10 decisionsを受け取らない、またはinitial promptが2回入る |
| 3B. Remaining artifacts | Blueprint / Feature Plan / Review / correctionが切替 | Phase 3B gate | stale / omitted sourceがreviewへ混入する |
| 4. Codex isolation | structured Codexをfresh thread、document inputなしへ切替 | deterministic gate + live canary | AGENTS marker、MCP、command itemのいずれかを観測する |
| 5. Budget / trace | projection budgetとdiagnosticsを有効化 | Phase 5 gate | critical decision dropped countが1以上になる |
| 6. Cleanup | compatibility fieldsとlatest fallbackを削除 | `bun run verify` + `bun run verify:live` | legacy callerが残る、またはlive SLOを確認できない |

各sliceは前sliceのgate成功後にだけ開始する。途中rollbackは当該sliceのcall-site切替を戻し、既に追加したpure types / fixture / diagnosticsを削除しない。

## 9. Verification Matrix

### 9.1 Projection unit tests

- 初期promptが各promptへちょうど1回入る。
- accepted Questionnaire decision数がpersisted回答数と一致する。
- API Contractへsession IDだけでなくanswer本文が入る。
- unselected options / tradeoffs / raw questionSetsが入らない。
- regeneration requestが通常生成ではnull、再生成時だけ1回入る。
- current detected stackが空でもaccepted Questionnaire decisionsが消えない。
- 同一source message / digestが複数sectionへ重複しない。
- omitted / stale revision Artifactが入らない。

### 9.2 Source and lifecycle tests

- stop / resume後もcontext snapshotのQuestionnaire sessionとsource IDsを使う。
- taskに新しい孤立messageが追加されてもcurrent Mission Pilot stepのsourceが変わらない。
- routing revision変更後は旧projectionを採用しない。
- includeされたArtifact生成後にだけFeature Plan / review projectionへ現れる。
- correctionは対象previous Artifactだけを参照する。

### 9.3 Structured Codex tests

- user global Codex config / `AGENTS.md`にcontextStill指示があってもstructured generation inputへ混入しない。
- MCP tool call、command execution、web callが0件。
- fresh threadが使われ、過去Artifact turnがresumeされない。
- normal pathは1 turnで完了する。
- invalid JSON repairは別fresh callで最大1回だけ行う。
- abort / timeout時にtemp resourcesをcleanupする。

### 9.4 Prompt and usage regression

- baseline fixtureと比較し、必須decision欠落が0件。
- 重複section / duplicate initial promptが0件。
- non-cached input、total input、durationをArtifactごとにbefore / after表示できる。
- cached inputが大きい場合でも、provider turn数とその由来をtraceで説明できる。
- API Contractの正常系で155秒・158k input相当の再発がない。

## 10. Acceptance Criteria

1. 全Plan Artifact generatorがversion付きtyped projectionを経由する。
2. 初期prompt、確定Questionnaire、project current state、active source Artifact、再生成指示が欠落しない。
3. 初期promptは各生成promptに1回だけ現れる。
4. API Contract / Zod / generic Plan ViewがQuestionnaire session IDだけを受け取る経路がない。
5. Mission Pilot generationでtask全体のlatest message fallbackを使わない。
6. current detected stackとaccepted planning decisionsが区別される。
7. Feature Plan入力に全workspace message summaryを再投入しない。
8. omitted / stale ArtifactをFeature Planまたはreviewへ渡さない。
9. structured Codex generationがユーザーの通常Codex `AGENTS.md` / MCP behaviorから独立する。
10. structured Codex generationでagentic tool callが0件である。
11. normal generationが1 provider turn、repairを含めても2単発call以内である。
12. traceからprojection bytes、source IDs / digests、provider turns、cached / non-cached input、durationを説明できる。
13. focused tests、`bun run verify`、明示的な`bun run verify:live`が成功する。
14. 通常のCodex coding runtimeとglobal contextStill利用に回帰がない。

## 11. Risks and Mitigations

### 必要情報を削りすぎる

Mitigation: semantic keyword filterを作らず、採用Questionnaire回答は全件保持する。削減対象はunselected options、重複、stale source、agent historyに限定する。

### source ID固定でmanual generationが使いにくくなる

Mitigation: frontend command / route inputへ選択中source IDを明示的に渡す。sourceを選ばない初回生成は`null`で生成し、backendでworkspace latestを推測しない。

### `project_doc_max_bytes=0`でもinstructionが混入する

Mitigation: `CODEX_HOME`は変更せず認証を維持する。unit testでconstructor configを固定し、live canaryでglobal / project instruction markerとagentic itemが0件であることを確認する。失敗時は既存structured route fallbackへerrorを返し、通常Codex設定へ戻さない。

### prompt budgetが新しい大規模taskを止める

Mitigation: silent truncationせず、section diagnostics付きerrorにする。budget値は今回fixtureだけで固定せず、複数の既存Plan Mode fixtureで校正する。

### projectionとassembled design contextが二つの正本になる

Mitigation: どちらも同じcanonical fact resolverとArtifact rendererを使う。assembled design contextはruntime consumer向けprojection、Plan Artifact inputはgeneration consumer向けprojectionとし、raw factsの複製保存はしない。

## 12. Plan View Decisions

このリファクタ自体について新しいPlan Viewは生成しない。

| View | Decision | Reason |
| --- | --- | --- |
| Questionnaire | omit | ユーザーが保持対象と除外対象を既に明示しており、blocking decisionがないため |
| Blueprint | omit | UI変更を含まないため |
| Data Model | omit | DB schema migrationを含まないため |
| API Contract | omit | 外部HTTP API contractを追加・変更しないため |
| Zod Schema | omit | OpenAPI外の新しい公開tool / provider input contractではなく、内部TypeScript projectionを追加するため |
| User / Activity / Sequence Flow | omit | lifecycle変更ではなく、source resolutionとprompt assemblyの内部refactorであり本文のphase記述で十分なため |

API Contractをomitする判断は、Feature PlanからAPI関連の説明を禁止する意味ではない。外部contract変更がないため独立Artifactを増やさないという判断である。

## 13. Implementation Handoff

最初のimplementation sliceはPhase 0とPhase 1を同じ変更単位で行う。次の順に着手する。

1. `tests/fixtures/plan-artifact-input/todolist-session.ts`を新規追加し、初期prompt、10件のQuestionnaire回答、empty repository stack、Blueprint / Data Model / Feature Plan / API Contract message metadata、routing / context revisionを匿名fixtureとして固定する。
2. `plan-artifact-input.types.ts`へSection 5の型をそのまま追加する。
3. `plan-artifact-input-context.service.ts`へ`resolvePlanArtifactCanonicalInput()`を追加する。
4. `plan-artifact-source-selection.ts`へexplicit source validationを追加する。Mission Pilot step resolverの接続はPhase 2まで行わない。
5. `plan-artifact-input-projection.ts`とrendererをpure functionとして追加する。
6. 新規focused testでAPI Contract projectionに10 decisions、initial prompt 1回、source provenanceが入り、unselected optionsとraw questionSetsが入らないことを確認する。

最初の変更ではgeneratorの切替やCodex provider isolationまで行わない。現行出力と新projectionをtest内で並べ、必須情報の一致と除外対象の差分を確認してからPhase 2へ進む。

First slice files:

- new `api/modules/specification/plan-artifact-input.types.ts`
- new `api/modules/specification/plan-artifact-input-context.service.ts`
- new `api/modules/specification/plan-artifact-source-selection.ts`
- new `api/modules/specification/plan-artifact-input-projection.ts`
- new `api/modules/specification/plan-artifact-input-renderer.ts`
- new `tests/fixtures/plan-artifact-input/todolist-session.ts`
- new `tests/services.plan-artifact-input-projection.test.ts`
- update `tests/services.spec-document-renderer.test.ts`
- update `tests/plan-mode-project-stack-context.test.ts`

Blocking questionnaire items: none.

Required first gate:

```bash
bun run test -- tests/services.plan-artifact-input-projection.test.ts tests/services.spec-document-renderer.test.ts tests/plan-mode-project-stack-context.test.ts tests/mission-pilot-plan-coordinator.test.ts
```
