# Domain-Oriented Large File Refactoring 実装計画

## Status

- Plan status: `active-draft`
- Document created: 2026-07-12
- Implementation status: `not-started`
- Baseline: 物理行数600行超の実装ソース56ファイル
- Baseline refreshed: 2026-07-12 at `a98cd8cb`（計画作成後に追加されたMission Pilot repositoryを反映）。NW-LF-15はBiome import整形に伴い944行へ、NW-LF-35/36は現行辞書差分を反映して1087/1093行へ再記録。
- Primary objective: 巨大ファイルの責務分割と、`api/modules` / `src/modules` を中心としたドメイン指向実装への段階的移行
- Compatibility policy: HTTP path、DB table、イベント、Task/Run状態、ユーザー向け挙動は維持する
- Current implementation gate: この計画のレビューとPhase 0開始判断が完了するまで、対象ソースの移動・分割を開始しない

この文書を、600行超の実装ソース56ファイルを追跡し、単なるファイル分割ではなく、NightWorkersのドメイン境界と依存方向を明確にしながら段階的に再編するための実装正本とする。

## 1. 背景

現在のリポジトリには、`api/modules`、`src/modules`、`.agent-ontology` によるモジュール境界の基礎が存在する。一方で、次の問題が残っている。

1. 600行を超える実装ソースが56ファイルある。
2. `nightworkers`、`api/services`、`api/db` が複数ドメインの責務を受け持つ横断的な配置になっている。
3. すでに補助ファイルへ分割されていても、親serviceや親componentが判断、状態管理、変換、I/Oを集約している。
4. frontendとbackendで同じ業務概念の所有モジュールが一致していない箇所がある。
5. `api/db/schema.ts` と `api/db/bootstrap.ts` は参照元が多く、先に物理移動すると変更範囲が全域へ広がる。
6. `api/services/structured-llm/providers.ts` やAgent Runtimeには、transport、互換変換、session、retry、event projectionが近接している。
7. 辞書、CSS、route entrypointが、ドメイン固有実装と全体合成の両方を持っている。

巨大ファイルを機械的に複数ファイルへ切るだけでは、責務の所在が曖昧なままファイル数だけが増える。本計画では、先にbounded contextと公開契約を固定し、その後に内側の責務を移す。

## 2. 目的

### 2.1 構造上の目的

- ドメイン固有の業務判断を`api/modules/<domain>`へ集約する。
- frontendの機能状態、API、hooks、componentsを`src/modules/<domain>`へ集約する。
- 同じ業務概念にfrontend/backendで同じdomain名を使用する。
- module外からは各moduleのpublic APIだけを参照する。
- domain logicをReact、Hono、Drizzle、LLM SDK、Git、MCP transportから分離する。
- `nightworkers`を万能モジュールとして拡張せず、Workbench、Artifact、Task Executionなどの所有権を分離する。

### 2.2 サイズ上の目的

- 対象56ファイルをすべて600行以下にするか、公開契約だけを残す薄い互換ファサードにする。
- 新規の600行超実装ファイルを禁止する。
- 主要なapplication service、domain service、React componentは300〜450行程度を努力目標とする。
- 行数を減らすためだけの無名な`utils.ts`、`helpers.ts`、`common.ts`を増やさない。

### 2.3 品質上の目的

- 既存挙動を維持したまま構造を変更する。
- module間の循環依存を作らない。
- domain層を決定論的にテストできるようにする。
- 各Phaseを独立してレビュー、検証、巻き戻しできるようにする。
- `.agent-ontology`のownershipと実際のsource ownershipを一致させる。

## 3. Non-Goals

- 機能追加、画面再設計、API path変更を同時に行わない。
- DB table名、column名、イベント種別をDDD用語へ一括改名しない。
- `missionPilot`、`taskGeneration`など既存ディレクトリの全体的な命名変更を本計画へ混ぜない。
- framework、state library、ORM、test frameworkを置換しない。
- すべてのファイルを機械的に`modules`配下へ移動しない。
- DB client、共通schema helper、UI tokenなどの純粋な基盤を偽の業務ドメインとして扱わない。
- 本計画のためにprovider層へworkflow判断や用途別SystemContextを追加しない。
- deterministic gateと実providerを使うlive verificationを混同しない。

## 4. Locked Decisions

### 4.1 Module root

backendとfrontendの既存rootを維持する。

```text
api/modules/<domain>/
src/modules/<domain>/
```

新しい第三のroot `modules/` は作らない。shared DTOやschemaは当面`shared/`に維持し、業務判断を置かない。

### 4.2 Backend layer

新規分割では、必要な層だけを次の名前で使用する。

```text
api/modules/<domain>/
  domain/          entity、value、state transition、policy、不変条件
  application/     use case、port、transaction boundary
  infrastructure/  repository、provider、filesystem、Git、MCP adapter
  presentation/    Hono route、request/response mapper
  index.ts          module外へ公開するAPI
```

空の層や1ファイルだけの形式的なディレクトリは作らない。層名は依存方向を表す必要がある場合だけ導入する。

### 4.3 Frontend layer

```text
src/modules/<domain>/
  model/       UI state、selector、view model
  api/         command、query client
  hooks/       user interaction use case
  components/  presentation
  index.ts     module外へ公開するAPI
```

routeはmoduleを合成する薄いentrypointとし、業務状態や複雑なeffectを持たせない。

### 4.4 Dependency direction

```text
presentation -> application -> domain
infrastructure -> application port
bootstrap/route composition -> module public API
module A -> module B public API or explicit port
```

禁止する依存:

- domainからReact、Hono、Drizzle、SDK、filesystemへの依存。
- module外から他module内部ファイルへのdeep import。
- repositoryからpresentationへの依存。
- provider transportからSupervisorのworkflow判断への逆流。
- module間の双方向import。

### 4.5 Compatibility facade

参照元が多いファイルは先に移動しない。先に新しい公開契約と実装を追加し、既存ファイルをre-exportまたはdelegationだけの互換ファサードへ縮小する。

特に次は最後まで既存import pathを維持する。

- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- route entrypoint
- root i18n dictionary
- root stylesheet
- MCP transport entrypoint

### 4.6 File size rule

- 判定は物理行数で`> 600`とする。
- docs、generated assets、seed SQL、testsは今回の56ファイル追跡対象から除外する。
- Phase 0で既存56ファイルのallowlistを固定する。
- allowlist対象の行数増加と、新規600行超ファイルを禁止する。
- 各対象の完了時にallowlistから1件ずつ削除する。
- 最終完了時にallowlistを空にする。

## 5. Bounded Context Map

| Context | 所有する概念 | 主な現在位置 | 目標 |
| --- | --- | --- | --- |
| Workbench | Session、会話、message、timeline、intake | `api/modules/nightworkers`、`src/modules/nightworkers` | 会話とWorkbench操作を所有し、Run、Artifact、Planを直接実装しない |
| Artifact | Artifact、version、projection、viewer selection | `nightworkers` components/repositories | Artifactの選択・投影・表示を独立させる |
| Task Execution | TaskRun、runtime state、Todo、tool execution | `nightworkers/run-orchestration`、`api/services/agent-runtime` | Runの状態遷移と実行portを所有する |
| Implementation Queue | QueueEntry、claim、drain、archive | `api/modules/queue` | Queue状態遷移と永続化を所有する |
| Plan Mode | Specification、Plan View、Questionnaire、design artifact | `specification`、`planViews`、`questionnaire`、`src/modules/planMode` | 設計成果物の生成、修正、表示を所有する |
| Mission Planner | Mission、PlanningResult、TaskProposal | `api/modules/mission-planner` | 分解と提案のdomain ruleを所有する |
| Mission Pilot | PilotSession、phase、authorization、resume | `api/modules/missionPilot` | 長期進行制御を所有し、他contextはportで操作する |
| Review | ReviewRun、finding、evidence、closeout decision | `api/modules/review`、git closeout | Review判定とcloseout条件を所有する |
| Blueprint | Blueprint draft、preview model | `api/services/blueprints`、`src/modules/blueprint-preview` | Blueprint生成と表示契約を所有する |
| Settings | Runtime/Provider/MCP設定 | `api/routes/settings*`、`src/modules/settings` | 設定の保存・検証・表示だけを所有する |
| Quality | QualityRun、coverage/e2e projection | `api/modules/quality` | 品質計測と結果投影を所有する |
| LLM Gateway | provider transport、JSON抽出、最小互換正規化 | `api/services/structured-llm` | workflow判断を持たないprovider adapter群にする |
| Project Registry | repository登録、post-import処理 | `api/services/worker-tools/project-post-import.ts` | Project登録後のapplication use caseを所有する |

## 6. 共通Definition of Done

各`NW-LF-*`項目は、次をすべて満たした場合だけ完了にする。

- [ ] 元ファイルが600行以下、または600行以下の薄い互換ファサードになった。
- [ ] 抽出先の責務が単一のbounded contextへ説明可能である。
- [ ] domain層にframework、DB、provider、filesystem依存がない。
- [ ] module外からのdeep importがない。
- [ ] 新しい循環依存がない。
- [ ] HTTP path、DB schema、event、Task/Run状態の互換性が維持されている。
- [ ] 対象のfocused testがpassする。
- [ ] `bun run typecheck`とchanged-file Biomeがpassする。
- [ ] `.agent-ontology`のowned paths、invariants、verificationが実配置と一致する。
- [ ] 巨大ファイルallowlistから対象IDを削除した。
- [ ] 完了証拠へ変更前後の行数、抽出先、検証結果を記録した。

## 7. 56ファイル追跡チェックリスト

### Phase 1: Leaf and supporting contexts — 8 files

- [x] NW-LF-01 `api/modules/quality/quality.service.ts` (618 -> 432): Coverage report取得を`quality-coverage-report.service.ts`へ分離し、Quality public APIを追加した。
- [x] NW-LF-02 `api/services/blueprints/mock-llm-draft.ts` (883 -> 8): generation、JSON parse、domain normalization、dataset normalizationをBlueprint moduleへ分離し、旧pathを互換ファサード化した。
- [x] NW-LF-03 `src/modules/blueprint-preview/BlueprintPreview.tsx` (888 -> 236): meta、layout、adoption、design settingsを独立componentへ分離し、frontend public APIへ統一した。
- [x] NW-LF-04 `api/routes/settings-route-definitions.ts` (666 -> 412): MCP・Agent Hook route定義をSettings presentationへ移し、旧pathを互換ファサード化した。
- [x] NW-LF-05 `api/routes/settings-runtime.ts` (853 -> 247): LLM settings contractとnormalizationをSettings domainへ移し、旧pathを永続化・環境適用ファサードへ縮小した。
- [x] NW-LF-06 `api/services/pricing/index.ts` (752 -> 401): 公開価格のprovider/model正規化、可視行選択、lookup key生成をSettings application policyへ移した。
- [x] NW-LF-07 `api/services/llm-usage/summary.ts` (829 -> 600): summary delta/model、scope key、repository解決をLLM Gatewayへ分離した。
- [x] NW-LF-08 `src/modules/settings/SettingsLlmPanel.tsx` (902 -> 558): Provider Endpoint UIとrouting modelを分離し、Settings public API経由へ統一した。

### Phase 2: Plan Mode — 5 files

- [x] NW-LF-09 `api/modules/specification/specification-document-renderer.ts` (1428 -> 407): Blueprint、Plan/Data Model参照、API/Zod・message解決rendererへ分離した。
- [x] NW-LF-10 `api/modules/planViews/planView-generation.service.ts` (1427 -> 438): 汎用View parser、API契約/Zod parser、Mermaid validatorを分離した。
- [x] NW-LF-11 `src/modules/planMode/PlanModeWorkspaceViewer.tsx` (1613 -> 594): view、model、questionnaire panel/actions、artifact generation、workspace outputsへ分離した。
- [x] NW-LF-12 `api/modules/questionnaire/questionnaire-parser.service.ts` (697 -> 598): JSON schema定義を`questionnaire-json-schemas.ts`へ移し、parser本体を縮小した。
- [x] NW-LF-13 `api/modules/questionnaire/questionnaire.service.ts` (615 -> 554): Questionnaire context assemblyを`questionnaire-context.ts`へ分離した。

### Phase 3: Mission contexts — 5 files

- [x] NW-LF-14 `api/modules/mission-planner/mission-planner.service.ts` (1320 -> 549): candidate generationを`mission-planner-generation.service.ts`、review proposal永続化を`mission-planner-persistence.service.ts`、task materializationを`mission-planner-proposal-materialization.service.ts`へ分離した。
- [x] NW-LF-15 `api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts` (943 -> 594): pipeline共通処理・artifact生成・questionnaire/context adapterを`mission-pilot-plan-support.ts`へ分離した。
- [x] NW-LF-16 `api/modules/missionPilot/mission-pilot-post-queue-coordinator.service.ts` (1056 -> 297): Review/Test post-Queue continuationとrework/attention transitionを`mission-pilot-post-queue-review.service.ts`、`mission-pilot-post-queue-test.service.ts`へ分離した。
- [x] NW-LF-17 `api/modules/missionPilot/mission-pilot-closeout.service.ts` (745 -> 564): closeout context更新、evidence recovery、Git helperを`mission-pilot-closeout-support.ts`へ分離し、既存archive/recovery APIを維持した。
- [x] NW-LF-56 `api/modules/missionPilot/mission-pilot-plan.repository.ts` (708 -> 535): artifact correction persistenceを`mission-pilot-artifact-correction.repository.ts`へ分離した。

### Phase 4: Queue and Review — 4 files

- [x] NW-LF-18 `api/modules/queue/queue-management.service.ts` (1077 -> 103): admissionを`queue-admission.service.ts`、health/recoveryを`queue-health.service.ts`、entry command/drainを`queue-entry-commands.service.ts`へ分離した。
- [x] NW-LF-19 `api/modules/queue/queue.repository.ts` (964 -> 4): command/query repositoryを`queue-repository-commands.ts`、`queue-repository-query.ts`へ、共有状態・row mappingを`queue-repository-row-mapper.ts`へ分離した。
- [x] NW-LF-20 `api/modules/review/review-run.service.ts` (633 -> 591): Review target helper群を`review-run-target-helpers.ts`へ分離した。
- [x] NW-LF-21 `api/modules/nightworkers/nightworkers.git-closeout.service.ts` (757 -> 598): Git support adapterを`git-closeout-support.ts`へ分離した。

### Phase 5: Workbench frontend — 15 files

- [x] NW-LF-22 `src/modules/nightworkers/components/ArtifactPane.tsx` (1962 → 600): ArtifactPaneをselection、Test Mode表示、export actions、header actionsへ分割し、Artifact module内の責務境界を明確化。
- [x] NW-LF-23 `src/modules/nightworkers/components/ThreadTimeline.tsx` (1230 → 548): event model/parsingを`ThreadTimelineEventModel.tsx`へ分離し、timeline presentationと公開exportを維持した。
- [ ] NW-LF-24 `src/modules/nightworkers/components/NightWorkersShell.tsx` (1141): route composition、project/session selection、layoutを薄いshellへ分ける。
- [x] NW-LF-25 `src/modules/nightworkers/components/ThreadTimelineActivityTranscript.tsx` (760 -> 362): activity projection/formatting helperを`ThreadTimelineActivityModel.ts`へ分離し、rendererと公開helperを維持した。
- [x] NW-LF-26 `src/modules/nightworkers/components/ThreadWorkspace.tsx` (693 -> 475): header/pending presentationを`ThreadWorkspaceHeader.tsx`へ分離し、workspace本体を合成層へ縮小した。
- [x] NW-LF-27 `src/modules/nightworkers/components/ThreadTimelineCodexToolCard.tsx` (641 -> 128): tool result model/parserを`ThreadTimelineCodexToolCardModel.tsx`へ分離し、既存Card rendererとpublic helper exportを維持した。
- [x] NW-LF-28 `src/modules/nightworkers/components/ThreadTimelineNormalTranscript.tsx` (626 -> 221): normal transcript projection/summaryを`ThreadTimelineNormalTranscriptModel.tsx`へ分離し、既存renderer exportを互換維持した。
- [x] NW-LF-29 `src/modules/nightworkers/workbenchArtifactSelectors.ts` (691 -> 452): Artifact selection policy/helper群を`workbenchArtifactSelectionPolicy.ts`へ分離し、selector公開APIを維持した。
- [x] NW-LF-30 `src/modules/nightworkers/workbenchSessionSelectors.ts` (636 -> 408): Session/Run diagnostics・projection補助を`workbenchSessionDiagnostics.ts`へ分離し、selector公開APIを維持した。
- [x] NW-LF-31 `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` (679 -> 589): session/replay/status projection helpersを`useNightWorkersWorkspaceModel.ts`へ分離し、workspace hookを合成層へ縮小した。
- [x] NW-LF-32 `src/routes/tasks.$id.tsx` (619 -> 11): TaskConsole presentation/query compositionを`TaskConsolePage.tsx`へ移し、routeはparam受け渡しだけの薄いFacadeにした。
- [x] NW-LF-33 `src/styles/nightworkers-shell.css` (758 -> 447): Workbench shell layoutをrootに残し、Todo rail/domain component styleを`nightworkers-todo.css`へ分離した。
- [x] NW-LF-34 `src/styles/nightworkers-utility-overrides.css` (1095 -> 572): Artifact/code/diff component style群を`nightworkers-utility-artifact.css`へ分離し、root utility overrideを縮小した。
- [x] NW-LF-35 `src/i18n/dictionaries/ja.ts` (1074 → 38): 17 domainの日本語辞書ファイルを分離し、root dictionaryはspread合成へ縮小した。
- [x] NW-LF-36 `src/i18n/dictionaries/en.ts` (1082 → 38): 日本語辞書と同一key構造で英語辞書を分離し、root dictionaryの公開importを維持した。

### Phase 6: Workbench backend — 3 files

- [x] NW-LF-37 `api/modules/nightworkers/nightworkers.workbench.service.ts` (1073 → 600): message command、Plan intake/handoff、gate/supportを分離し、既存service exportを互換維持した。
- [x] NW-LF-38 `api/modules/nightworkers/nightworkers.activity.repository.ts` (748 → 371): persistence queue/append/queryを`nightworkers.activity-persistence.repository.ts`へ分離し、既存exportをfacadeで維持した。
- [x] NW-LF-39 `api/modules/nightworkers/nightworkers.runs.repository.ts` (864 → 561): event replay/artifactを`nightworkers.runs-event.repository.ts`、todo/state supportを`nightworkers.runs-support.ts`へ分離し、既存repository exportを維持した。

### Phase 7: Task Execution, LLM and MCP — 14 files

- [x] NW-LF-40 `api/services/structured-llm/providers.ts` (596): fixture、Codex、Azure、OpenAI、Bedrock adapterを分離し、provider dispatch/retry/互換正規化をfacadeに維持した。
- [x] NW-LF-41 `api/services/agent-runtime/CodexAgentRuntime.ts` (584): session lifecycleのfacadeを維持し、closeout/retry/terminal policyとrun-loop supportを分離した。
- [x] NW-LF-42 `api/services/agent-runtime/codex-runtime-support.ts` (455): config、prompt support、failure mapping、environment supportとread evidenceを分ける。`codex-runtime-evidence.ts`へ監査・読取証跡を抽出。
- [ ] NW-LF-43 `api/services/agent-runtime/native-api-runner/native-api-runner.ts` (211 facade + 761 coordinator): runtime loopをuse case coordinatorへ抽出済み。coordinator本体のturn/tool loop分割を継続する。
- [x] NW-LF-44 `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts` (565): startup履歴/仕様補助、Todo alignment、failure/route resolutionをsupport moduleへ分離し、startup gate契約を維持した。
- [x] NW-LF-45 `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts` (677 → 208): tool manifestを`native-api-tool-manifest.ts`へ分離し、policy/handler binding facadeと公開契約を維持した。
- [x] NW-LF-46 `api/services/worker-tools/todo-list.ts` (862 → 515): Todo context/repository境界を`todo-list-context.ts`、response mappingを`todo-list-response.ts`へ分離し、schema/state/DB契約を維持した。
- [x] NW-LF-47 `api/services/worker-tools/project-post-import.ts` (737 → 588): import manifest/LLM context検証を`project-post-import-inspection.ts`へ分離し、Project登録・workflow契約を維持した。
- [x] NW-LF-48 `api/mcp/nightworkers-codex-mcp.ts` (786 → 471): MCP transport/context/response adapterを`nightworkers-codex-mcp-support.ts`へ分離し、既存path/tool/payload/auth契約を維持した。
- [x] NW-LF-49 `api/mcp/nightworkers-tool-manifest.ts` (665 → 275): schema群を`nightworkers-tool-schemas.ts`へ分離し、manifest/availability公開APIを維持した。
- [x] NW-LF-50 `api/modules/nightworkers/run-orchestration/start-task-run.ts` (647 → 599): start entry / startable-task preparationを`start-task-run-entry.ts`へ分離し、既存startTaskRun APIと状態遷移を維持した。
- [x] NW-LF-51 `api/modules/nightworkers/run-orchestration/runtime-execution.ts` (642 → 563): runtime execution failure/closeoutを`runtime-execution-failure.ts`へ分離し、runtime/ledger/closeout契約を維持した。
- [x] NW-LF-52 `api/modules/nightworkers/routes/run-routes.ts` (769 → 2): task route definitionsとreview route definitionsを分離し、既存route export/path/status/schema契約をfacadeで維持した。
- [x] NW-LF-53 `scripts/agent-ontology/core.mjs` (1028 → 596): manifest validation、goal routing、boundary matching、verification helperを`core-support.mjs`へ分離し、CLI/API結果を維持した。

### Phase 8: Persistence compatibility facade — 2 files

- [x] NW-LF-54 `api/db/schema.ts` (8 facade): base/task-execution/activity/llm-usage/blueprint persistence schemaへ分割し、既存pathをre-export facadeにした。
- [x] NW-LF-55 `api/db/bootstrap.ts` (311): runtime/usage、task workflow、blueprint bootstrapを専用moduleへ分割し、startup orderをfacadeで維持した。

## 8. Implementation Phases

### Phase 0: Baseline and guardrails

#### Tasks

1. 現在の56ファイルと物理行数を機械可読なbaselineとして固定する。
2. file path、line count、target context、phase、statusを持つallowlistを追加する。
3. 新規600行超、対象ファイルの行数増加、allowlist外の巨大ファイルを検出するtestを追加する。
4. import graphを採取し、fan-in、fan-out、循環依存を保存する。
5. `.agent-ontology/modules.yaml`とmodule manifestへ新しいcontext ownershipを追加する。
6. module public APIと禁止deep importを検査するboundary testを追加する。
7. focused test baseline、`bun run typecheck`、`bun run verify`の開始時結果を記録する。
8. 実装開始時のworktreeがdirtyなら、ユーザー承認済みcheckpointまたは専用worktreeを用意する。

#### Exit criteria

- 初期baselineは56件で記録し、完了した対象はallowlistから除去して現在の未完了baselineを縮小できる。
- 既存56件を直ちに失敗させず、新規悪化だけを防ぐgateがpassする。
- 各ファイルのtarget contextが一意である。
- Phase 1の対象以外へ実装差分がない。

### Phase 1: Leaf and supporting contexts

対象: `NW-LF-01`〜`NW-LF-08`。

依存元が比較的限定されたQuality、Blueprint、Settings、Pricing、Usageから公開APIパターンを確立する。Settingsは値の保存・検証・表示だけを持ち、Task Execution policyを所有しない。Pricing/UsageはOverviewやSettingsから利用できるquery portを公開する。

Focused verification:

```bash
bun test tests/quality-backend.test.ts tests/quality-screen.test.tsx
bun test tests/services.blueprints.test.ts tests/mock-blueprint.test.ts tests/blueprint-preview-model.test.ts
bun test tests/routes.settings-general.test.ts tests/settings-llm-panel.test.tsx
bun test tests/services.pricing.test.ts tests/services.llm-usage-summary.test.ts
```

### Phase 2: Plan Mode

対象: `NW-LF-09`〜`NW-LF-13`。

進捗: NW-LF-09〜NW-LF-13完了。Phase 2のPlan Mode分割を完了した。

Plan ModeのArtifact生成・修正・表示契約を維持し、renderer、generation、Questionnaire lifecycleを別use caseへ分ける。Mission PilotからはPlan Mode application portだけを呼ぶ。

Focused verification:

```bash
bun test tests/specification-document-generation.test.ts tests/services.plan-view-generators.test.ts
bun test tests/plan-mode-questionnaire.test.tsx tests/services.questionnaire-decision-layer.test.ts
bun test tests/artifact-workspace-viewer.test.ts
```

### Phase 3: Mission contexts

対象: `NW-LF-14`〜`NW-LF-17`、`NW-LF-56`。

Mission PlannerとMission Pilotを別bounded contextとして維持する。Mission PilotはMission、Questionnaire、Plan Mode、Queue、Reviewを直接永続化せず、それぞれのapplication portへ命令する。

進捗: NW-LF-14〜NW-LF-17、NW-LF-56完了。Phase 3のMission context分割を完了した。

Focused verification:

```bash
bun test tests/mission-planner.test.ts
bun test tests/mission-pilot-plan-coordinator.test.ts tests/mission-pilot-plan-pipeline.test.ts
bun test tests/mission-pilot-post-queue-state.test.ts tests/mission-pilot-closeout.test.ts
```

### Phase 4: Queue and Review

対象: `NW-LF-18`〜`NW-LF-21`。

Queue state transitionをdomain ruleへ、SQLをrepository adapterへ分ける。Reviewは証跡とcloseout可否を所有し、Git commandの実行はGitworktree adapterへ委譲する。

進捗: NW-LF-18〜NW-LF-21完了。Phase 4のQueue/Review分割を完了した。

Focused verification:

```bash
bun test tests/services.queue-management.test.ts tests/queue-repository-branch-coverage.test.ts
bun test tests/review-mode.test.ts tests/nightworkers-git-closeout.test.ts
```

### Phase 5: Workbench frontend

対象: `NW-LF-22`〜`NW-LF-36`。

Artifact、timeline、Task Execution projection、Workbench shellを分離する。既存の小さいcontroller、renderer、panelを再利用し、同じ役割の第二実装を作らない。route、root CSS、root dictionaryは合成だけを行う。

進捗: NW-LF-22〜NW-LF-23、NW-LF-25〜NW-LF-36完了。NW-LF-24が未完了。

Focused verification:

```bash
bun test tests/artifact-workspace-viewer.test.ts tests/nightworkers.workbench-selectors.test.ts
bun test tests/thread-timeline-window.test.ts tests/thread-timeline-streaming.test.ts
bun test tests/nightworkers-shell-smoke.test.tsx tests/frontend-workbench-route-page.test.tsx
```

### Phase 6: Workbench backend

対象: `NW-LF-37`〜`NW-LF-39`。

進捗: NW-LF-37〜NW-LF-39完了。Workbench message/Plan intake、activity persistence、Run event/todo supportを分離済み。

Workbench intake、会話、Artifact activity、Run queryを分ける。Plan cue判断はcurrent message、Task context、recent conversation、既存Plan Artifactをまとめて扱う現在契約を維持し、文字列keyword分類へ退行しない。

Focused verification:

```bash
bun test tests/nightworkers-workbench-routes/routes-workbench-01.test.ts
bun test tests/nightworkers-workbench-routes/routes-workbench-02.test.ts
bun test tests/nightworkers-workbench-routes/routes-workbench-03.test.ts
bun test tests/nightworkers-workbench-routes/routes-workbench-04.test.ts
```

### Phase 7: Task Execution, LLM and MCP

対象: `NW-LF-40`〜`NW-LF-53`。

進捗: NW-LF-40〜NW-LF-42、NW-LF-44〜NW-LF-53（NW-LF-50〜NW-LF-53を含む）完了。NW-LF-43が継続中。

最も高リスクのPhaseとする。Run state、runtime loop、provider transport、tool、Todo、MCPを個別port/adapterへ分ける。Supervisorのworkflow判断はpromptとskill routing側に維持する。LLM本文が返った場合にprovider側の固定文へ差し替える挙動は導入しない。

Focused verification:

```bash
bun test tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
bun test tests/services.native-api-runner-startup.test.ts tests/services.native-api-runner-closeout.test.ts
bun test tests/structured-llm/services-structured-llm-01.test.ts
bun test tests/structured-llm/services-structured-llm-02.test.ts
bun test tests/structured-llm/services-structured-llm-03.test.ts
bun test tests/agent-ontology.test.ts
bun run test:supervisor-regression
```

### Phase 8: Persistence compatibility facade

対象: `NW-LF-54`〜`NW-LF-55`。

ドメイン固有table/bootstrapを所有moduleへ寄せる。ただし既存import pathは互換ファサードとして残す。Drizzle relation、foreign key、bootstrap order、migration ledgerの互換性を確認してから直接importの縮小を始める。

Focused verification:

```bash
bun run db:migrate
bun test tests/runtime-bootstrap.test.ts
bun run typecheck
```

fresh DBと既存DBの両方でbootstrapを確認する。bootstrap成功とmigration ledgerの整合は別々に検証する。

## 9. Phase Execution Protocol

各Phaseは次の順序で実施する。

1. 対象テストを変更前に実行し、baselineを記録する。
2. 対象contextのpublic API、domain type、application portを先に定義する。
3. 既存ファイルから純粋なrule/mapperを抽出する。
4. I/Oをrepository/provider/transport adapterへ抽出する。
5. 既存entrypointを新しいapplication serviceへのdelegationへ置き換える。
6. 参照元をpublic APIへ段階的に切り替える。
7. dead codeと一時adapterを削除する。
8. line count、boundary test、focused test、typecheck、Biomeを実行する。
9. `bun run verify`を実行する。
10. 完了証拠を記録し、該当`NW-LF-*`をチェックしてallowlistから削除する。

1回の変更単位は1つのcontextまたは密接な1 use caseに限定する。Phase内でも8ファイルすべてを一括変更しない。

## 10. Verification Strategy

### 10.1 Every change unit

```bash
bun test <focused-test-files>
bun run typecheck
bunx biome check <changed-files>
git diff --check
```

### 10.2 Every phase

```bash
bun run check:docs
bun run verify
```

### 10.3 Final deterministic gate

```bash
bun run verify:full
git diff --check
```

### 10.4 Explicit live gate

provider transportまたは実provider session behaviorを変更したPhase 7だけ、deterministic gate完了後に明示的に実行する。

```bash
bun run verify:live
```

live failureをdeterministic failureと混同しない。provider、model、Task ID、Run ID、失敗phaseを記録する。

### 10.5 Structural checks

最終的に次を自動検査する。

- production implementationに600行超ファイルがない。
- allowlistが空である。
- `domain/`から禁止依存をimportしていない。
- module外からdeep importしていない。
- module graphに循環がない。
- root route、root dictionary、root stylesheet、DB facadeが合成責務だけになっている。
- `.agent-ontology`のowned pathsが実ファイルと一致する。

## 11. Completion Evidence

各Phaseで次を記録する。

1. 完了した`NW-LF-*` ID。
2. 変更前後の行数。
3. 抽出したファイルと所有context。
4. public APIの変更点。
5. boundary crossingとその理由。
6. focused test結果。
7. typecheck、Biome、docs check、verify結果。
8. 互換ファサードまたは一時adapterの残存一覧。
9. 次Phaseへ持ち越した項目。

全体完了時には次を残す。

- 対象56件がすべてcheckedであること。
- 巨大ファイルallowlistが空であること。
- 最終module mapと依存graph。
- 全module manifestの検証結果。
- `bun run verify:full`結果。
- 実行した場合のみ`bun run verify:live`の記録。

## 12. Stop Conditions

次のいずれかが発生したら、次のPhaseへ進まず現在の変更単位で停止する。

- HTTP、DB、event、Task/Run状態の互換性変更が必要になった。
- 1 contextの変更が未計画の複数contextへ広がった。
- module間循環をportで解消できない。
- focused testまたはtypecheckが失敗したままである。
- 既存挙動変更と構造変更を分離できない。
- provider層へworkflow判断を移す必要が生じた。
- root facadeを削除しないと進められず、大量の参照元を同時変更する必要が生じた。
- dirty worktree上の既存変更と対象ファイルの責務が衝突した。
- Phase完了証拠を作れない。

仕様変更が必要と判明した場合は、この計画へ暗黙に混ぜず、別の実装計画または明示的な追加Phaseとして承認を取る。

## 13. Non-Completion Conditions

次のいずれかが残る場合、この計画を完了扱いにしない。

- 56件の未完了チェックが残っている。
- production implementationに600行超ファイルが残っている。
- allowlistが残っている。
- `nightworkers`が移動前と同じ横断責務を持ち続けている。
- 新しい巨大な`application.service.ts`や`utils.ts`へ責務を移しただけである。
- domain層がReact、Hono、Drizzle、SDK、filesystemへ依存している。
- 他module内部へのdeep importが残っている。
- module graphに循環がある。
- DB schema/bootstrapの互換性がfresh DBと既存DBの両方で確認されていない。
- frontend/backendの同一概念が異なるcontext ownershipのままである。
- `.agent-ontology`とsource ownershipが一致していない。
- deterministic verificationがpassしていない。

## 14. Recommended First Implementation Slice

最初の実装はPhase 0だけに限定する。

1. 56件baseline/allowlistを機械可読に保存する。
2. 新規巨大ファイルと行数増加を拒否するtestを追加する。
3. target bounded contextを`.agent-ontology`へ登録する。
4. module public API/deep import検査の最小基盤を追加する。
5. focused baseline、typecheck、`bun run verify`を記録する。

Phase 0では56ファイルの内容を分割しない。ガードレールの検証完了後、Phase 1をQuality、Blueprint、Settings/Usageの3つの変更単位へさらに分けて開始する。
