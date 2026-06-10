# Implementation Quality Improvement Checklist

Purpose: NightWorkers の実装品質を上げるための実行チェックリスト。対象は保守性、責務分離、型安全性、テスト安定性、境界契約の明確化。各項目は実装時にチェックを入れ、関連テストと `pnpm verify:full` で完了確認する。

## Completion Policy
- [x] 変更前に対象範囲を `rg` と関連テストで確認する。
- [x] 既存の Project / Session / Queue / Artifact / Run ledger 境界を崩さない。
- [x] 実装ごとに近い単体/回帰テストを先に通す。
- [x] 最後に `pnpm verify:full` を通す。
- [x] 仕様や用語を変えた場合は README または `spec/docs/` も同期する。

## Phase 1: Route And API Contract Cleanup

- [x] Route handler の `any` 依存を削る。
  - 対象: `api/modules/nightworkers/nightworkers.route-handlers.ts`, `api/modules/nightworkers/nightworkers.routes.ts`
  - やること:
    - Hono/OpenAPI の context 型を handler に渡せる薄い型 alias を作る。
    - `c: any`, `Promise<any>`, `catch (err: any)` を段階的に置換する。
    - route schema と service input の型がずれたら型検査で落ちる状態にする。
  - 完了条件:
    - route handler の主要関数から `c: any` が消える。
    - `pnpm --silent typecheck` が通る。
  - 実施:
    - `nightworkers.route-handlers.ts` は route 定義由来の context 型へ接続した。
    - `nightworkers.routes.ts` の inline handler から `async (c: any)` と `catch (err: any)` を削除した。
    - `queueRouteError` は `unknown` error と route-specific context を受ける形にした。

- [x] Route error handling を共通化する。
  - 対象: `nightworkers.routes.ts`, `nightworkers.route-handlers.ts`, `nightworkers.route-utils.ts`
  - やること:
    - `withRouteError(handler)` または同等の wrapper を作る。
    - handler 内の try/catch + `queueRouteError` 重複を削る。
    - 404 など route 固有の分岐だけを handler に残す。
  - 完了条件:
    - route handler の成功系が読みやすくなる。
    - error response の snapshot/route tests が通る。
  - 実施:
    - `withOpenApiRouteError(route, handler)` を追加し、OpenAPI route の型を維持したまま error response を共通化した。
    - `nightworkers.routes.ts` と `nightworkers.route-handlers.ts` の重複 try/catch を削り、route 固有の 404 変換だけを handler に残した。
    - `tests/nightworkers-routes` と `tests/nightworkers-workbench-routes` を通した。

- [x] OpenAPI route 定義と実 handler の距離を縮める。
  - 対象: `api/modules/nightworkers/routes/*.ts`, `nightworkers.routes.ts`
  - やること:
    - route 定義、handler binding、service 呼び出しの対応表を整理する。
    - route ごとの handler を近接配置するか、命名規則を統一する。
    - 削除済み/分割済み route test の集約ファイルを再発させない。
  - 完了条件:
    - route 名から handler と test を迷わず辿れる。
    - `rg "Split into|No test suite found"` がテスト対象に残らない。
  - 実施:
    - route definition は `api/modules/nightworkers/routes/{task,run,queue,repository,util}-routes.ts` に集約済みで、`nightworkers.routes.ts` は route import と binding の一覧として辿れる状態を維持した。
    - error wrapper は `withOpenApiRouteError` に統一済みで、route 固有 handler 名と route 名の対応が残る形にした。
    - `spec/docs/testing.md` に split 後の placeholder suite 禁止を明記し、`rg "Split into|No test suite found" tests` で残存なしを確認した。

## Phase 2: Service Responsibility Split

- [x] Design Questionnaire service を分割する。
  - 対象: `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`
  - やること:
    - session lifecycle、answer validation、follow-up generation、review generation、spec document rendering、LLM prompt/rendering を分ける。
    - parser service との責務境界を見直す。
    - public API は一度に壊さず、既存 service export の内側から段階移行する。
  - 完了条件:
    - 1 ファイルが 1000 行未満になる。
    - questionnaire route/service tests が通る。
    - reviewed spec / DB Design / questionnaire completion の既存回帰が通る。
  - 実施:
    - specification document rendering を `nightworkers.spec-document-renderer.ts` に分離した。
    - answer validation / follow-up duplicate removal を `nightworkers.design-questionnaire-validation.ts` に分離した。
    - `nightworkers.design-questionnaire.service.ts` は 982 行になり、route/service focused tests が通ることを確認した。

- [x] Workbench service を分割する。
  - 対象: `api/modules/nightworkers/nightworkers.workbench.service.ts`
  - やること:
    - message append、intent routing、artifact-focused routing、Blueprint generation、DB Design generation、queue/run action を分離する。
    - `appendWorkbenchMessage` を薄い orchestration 関数にする。
    - artifact context 判定を専用 selector/helper へ移す。
  - 完了条件:
    - `appendWorkbenchMessage` の分岐が読み切れるサイズになる。
    - `tests/nightworkers-workbench-routes/*` が通る。
  - 実施:
    - artifact-focused routing / job routing / intake content helper を `nightworkers.workbench-routing.ts` に分離した。
    - `nightworkers.workbench.service.ts` は 668 行になり、append / intake orchestration へ寄せた。
    - workbench route split tests 4ファイルが通ることを確認した。

- [x] Run orchestration の状態遷移を明示する。
  - 対象: `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
  - やること:
    - `ready/queued/running/needs_review/completed/failed/needs_human` の遷移表を作る。
    - updateTaskStatus / updateTaskRun / queue completion の順序を helper 化する。
    - invalid transition をテストで落とす。
  - 完了条件:
    - 状態遷移の追加時にテストを追加する場所が明確。
    - run-control / queue / workbench run tests が通る。
  - 実施:
    - `runStatusTransitionTable` と `assertRunStatusTransition` を追加し、active / terminal status の許可遷移を明示した。
    - finalize / cancel / stop の主要 `updateTaskRun` 前に transition assertion を入れた。
    - `tests/services.run-orchestration-transitions.test.ts` を追加し、許可遷移と invalid transition を固定した。

- [x] Queue side effect を明示的な option にする。
  - 対象: `nightworkers.queue-management.service.ts`
  - やること:
    - Queue entry create/archive/requeue の auto drain を `{ autoDrain?: boolean }` で制御する。
    - テスト用 env flag 依存を service input へ寄せる。
    - route からは production default として auto drain を有効にする。
  - 完了条件:
    - route tests が DB lock なしで安定する。
    - queue service tests が auto drain 有無を検証する。
  - 実施:
    - queue create/archive/requeue/resume/settings update に `{ autoDrain?: boolean }` を追加した。
    - service default は既存 env flag を尊重しつつ production では auto drain 有効のままにした。
    - `tests/services.queue-management.test.ts` で `autoDrain: false` と default auto drain を検証した。

## Phase 3: Artifact And Workspace Boundary Hardening

- [x] Artifact/TaskMessage/ActivityArtifact 変換を UI から外す。
  - 対象: `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`, `workbenchSelectors.ts`
  - やること:
    - `activityArtifactToTaskMessage` と `mergeWorkspaceTaskMessages` を selector/model 層へ移す。
    - UI component は view model を受け取るだけにする。
    - synthetic artifact ID と persisted message ID の優先順位をテスト化する。
  - 完了条件:
    - ArtifactWorkspaceViewer から永続モデル互換変換が消える。
    - `tests/artifact-workspace-viewer.test.ts` と selector tests が通る。
  - 実施:
    - `activityArtifactToTaskMessage`, `mergeWorkspaceTaskMessages`, `isReviewedSpecificationMessage` を `workbenchSelectors.ts` へ移した。
    - `ArtifactWorkspaceViewer` は selector/model 層の関数を利用する形に変更した。
    - persisted message ID が synthetic artifact message より優先される回帰テストを維持した。

- [x] Blueprint / DB Design 判定を型付き helper に集約する。
  - 対象: `workbenchSelectors.ts`, `ArtifactWorkspaceViewer.tsx`, timeline components, workbench service
  - やること:
    - `isNormalBlueprintMessage`, `isDbDesignBlueprintMessage`, `isReviewedSpecificationMessage` を共有化する。
    - `artifactType/source/dbDesignTarget/intent/appBlueprint` の手書き複合条件を置換する。
    - DB Design が通常 Blueprint surface に漏れない回帰テストを維持する。
  - 完了条件:
    - DB Design / App Blueprint の分類ロジックが一箇所に集まる。
    - `tests/nightworkers.workbench-selectors.test.ts` が通る。
  - 実施:
    - `isNormalBlueprintMessage`, `isDbDesignBlueprintMessage` を `workbenchSelectors.ts` に追加した。
    - `ArtifactWorkspaceViewer` の inline 複合条件を selector helper 呼び出しに置換した。
    - DB Design が通常 Blueprint surface に漏れないテストを追加した。

- [x] Blueprint generation prompt の契約テストを強化する。
  - 対象: `api/services/blueprints/*`, `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`
  - やること:
    - 通常 Blueprint 生成が DB/DDL/data binding を設計しないことを request contract としてテストする。
    - DB Design workflow だけが databaseSchema/dataBindings を更新することをテストする。
    - prompt text snapshot ではなく、生成 request object と reference documents を確認する。
  - 完了条件:
    - Blueprint/DB Design 境界を壊す変更が focused tests で落ちる。
  - 実施:
    - `buildPlanModeBlueprintRequestContract` を追加し、通常 Blueprint の structured request contract に `databaseSchema: {tables: [], relations: []}`, `dataBindings: []`, `sectionDataBindingId: forbidden`, `dbDesignWorkflowOnly: true` を明示した。
    - `generatePlanModeBlueprintDraft` は同 contract の `userRequest` と `schemaName` を使って LLM request を組み立てるようにした。
    - `tests/services.blueprints.test.ts` で request contract と `references/work_kinds/blueprint.md` の境界記述を確認し、既存 `tests/services.blueprint-data-design.test.ts` と合わせて通常 Blueprint / DB Design の分離を固定した。

- [x] Legacy artifact fallback の削減計画を実装単位へ分割する。
  - 対象: `spec/artifact-boundary-redesign-plan.md`, run-events normalizer, activity repository, Blueprint legacy section
  - やること:
    - 残す compatibility と削除する fallback をリスト化する。
    - fallback ごとに migration / read-only compatibility / removal のどれかを決める。
    - 削除対象にはテストと期限を付ける。
  - 完了条件:
    - `legacy` が必要な箇所と不要な箇所を説明できる。
  - 実施:
    - `spec/artifact-boundary-redesign-plan.md` に `Fallback Reduction Work Items` を追加した。
    - AF-01 から AF-06 まで、fallback の current location、classification、action、test owner、removal condition を明記した。
    - `legacy` の使用を historical/read-only input に限定し、component/route handler に fallback 条件を増やさない制約を追加した。

## Phase 4: Frontend Component And Command Layer Cleanup

- [x] ArtifactWorkspaceViewer を分割する。
  - 対象: `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`
  - やること:
    - workspace fetch hook、questionnaire hook、tab component、Blueprint action panel に分ける。
    - `busyAction`, `answers`, `sessions`, `generatedMessages` の state ownership を整理する。
    - UI rendering と API command を分ける。
  - 完了条件:
    - component が 500 行未満になる。
    - Questionnaire / Blueprint / DB Design UI tests が通る。
  - 実施:
    - `ArtifactWorkspacePanels.tsx` を追加し、Blueprint preview、DB Design panel、status stepper、workspace list を分離した。
    - `ArtifactWorkspaceViewer.tsx` は workspace state / questionnaire action / tab composition に寄せ、387 行まで縮小した。
    - `nightWorkersCommands.ts` と組み合わせ、API command と UI panel rendering を分離した。

- [x] NightWorkersShell の artifact extraction を selector 化する。
  - 対象: `NightWorkersShell.tsx`, `workbenchSelectors.ts`
  - やること:
    - shell 内の metadata traversal を selector に移す。
    - shell は layout と high-level state composition に限定する。
    - Artifact/Overview/Workspace の derived data を selector tests で固定する。
  - 完了条件:
    - shell から `Record<string, any>` traversal が減る。
  - 実施:
    - `buildBlueprintArtifactRef`, `buildQuestionnaireWorkspaceArtifactRef`, `buildArtifactContext` を `workbenchSelectors.ts` へ移した。
    - `NightWorkersShell` は selector helper を呼ぶだけにし、metadata traversal と `Record<string, any>` helper を削除した。
    - selector tests で shell auto-open 用 Blueprint ref、questionnaire workspace ref、artifact context derived data を固定した。

- [x] UI action の API 呼び出しを command layer へ寄せる。
  - 対象: `src/modules/nightworkers/components/*`, hooks
  - やること:
    - `apiFetch` 直呼びを `nightWorkersCommands.ts` へ集約する。
    - loading/error/retry の戻り値を統一する。
    - component は command を呼んで view state を更新するだけにする。
  - 完了条件:
    - API path string が components に散らばらない。
    - 主要 action の error handling が統一される。
  - 実施:
    - `nightWorkersCommands.ts` を追加し、settings / overview / workspace / questionnaire / Blueprint preview / queue / run / project files の HTTP command を集約した。
    - components, hooks, i18n provider の `apiFetch` 直呼びを command 呼び出しへ置換した。
    - `rg "apiFetch\\(|from ['\\\"].*api-base|/api/" src/modules/nightworkers/components src/modules/nightworkers/hooks src/modules/nightworkers/i18n` で通常 HTTP の残存がないことを確認した。残る `/api/ws/nightworkers` は WebSocket 接続 path。

- [x] Frontend route の `as any` を削減する。
  - 対象: `src/routes/*.tsx`
  - やること:
    - TanStack Router 型生成と route declaration を合わせる。
    - API client input に型を付け、`data as any` を削る。
    - route params / loader data の型を明示する。
  - 完了条件:
    - route files の `as any` が減る。
    - `pnpm --silent typecheck` が通る。
  - 実施:
    - `repositories.tsx` の create mutation input を `CreateProjectInput` に接続し、API client への `data as any` を削除した。
    - `showcase.tsx` の route declaration から不要な `as any` を削除した。
    - `tasks.$id.tsx` の run event payload 表示を `Record<string, unknown>` guard と明示的な string 化へ寄せ、JSON payload を暗黙 any で描画しない形にした。
    - `rg "as any|: any|\\(.*any\\)" src/routes -g '*.tsx'`, `pnpm --silent typecheck`, `pnpm --silent lint` が通ることを確認した。

## Phase 5: Type Safety And Schema Tightening

- [x] Repository JSON columns を schema parse する。
  - 対象: `nightworkers.repository.ts`, `nightworkers.runs.repository.ts`, activity repository
  - やること:
    - `metadataJson`, `payloadJson`, `contextSnapshot`, `finalJudgment` の read adapter を作る。
    - AppBlueprint / RunEvent / TaskMessage metadata の代表 schema を適用する。
    - parse 失敗時は compatibility fallback と警告を分ける。
  - 完了条件:
    - repository consumers が raw `any` を直接読む箇所が減る。
  - 実施:
    - `nightworkers.json-adapters.ts` を追加し、JSON column の record 判定、activity payload normalization、RunEvent payload read adapter を共通化した。
    - `createRunEvent` は `readRunEventPayload` 経由で `payloadJson.runEvent` を読み、`runEventSchema.safeParse` による代表 schema parse と compatibility fallback を分離した。
    - repository の TaskMessage metadata 判定は `toJsonRecord` / `isJsonRecord` 経由にし、Blueprint projection / document / tool diff 判定で raw `any` を直接読まないようにした。
    - activity repository の schema-first payload helper は `unknown` 入力と `Record<string, unknown>` 出力へ寄せた。

- [x] Shared schemas の `z.any()` を段階削減する。
  - 対象: `shared/schemas/nightworkers/*.schema.ts`
  - やること:
    - activity message, review, overview warning から優先して union/schema 化する。
    - date-like values は `z.coerce.date()` または API 表現を統一する。
    - unknown extension point は `z.unknown()` と typed adapter にする。
  - 完了条件:
    - API response schema が実装の payload 形状をより正確に表す。
  - 実施:
    - date-like field は `z.union([z.string(), z.date()])` に寄せた。
    - JSON extension point は `z.unknown()` に寄せ、`shared/schemas/nightworkers`, `design-questionnaire.schema.ts`, `api/modules/nightworkers/routes` の `z.any()` を削除した。
    - route/run-event/realtime 関連 tests を通した。

- [x] `Record<string, any>` helper を typed guard に置換する。
  - 対象: services, selectors, UI components
  - やること:
    - `isRecord`, `toRecord`, metadata guard を共有 util 化する。
    - `any` ではなく `Record<string, unknown>` を基本にする。
    - 代表 metadata は domain-specific type guard にする。
  - 完了条件:
    - production code の `Record<string, any>` が減る。
  - 実施:
    - backend は `JsonRecord = Record<string, unknown>` と `isJsonRecord` / `toJsonRecord` に集約した。
    - `workbenchSelectors.ts` の verification payload 判定と date conversion から `as any` を削除した。
    - `ThreadTimeline` の tool payload helper は `unknown` 入力にし、caller 側も `asRecord` 経由で tool args/result を読む形にした。
    - 対象範囲の `rg "Record<string, any>|: any|as any"` が空になり、`pnpm --silent typecheck`, `pnpm --silent lint`, focused UI/route tests が通ることを確認した。

- [x] Catch error typing を統一する。
  - 対象: `catch (err: any)` が残る service/tool/route
  - やること:
    - `unknown` で受けて `toErrorMessage`, `toAppErrorResponse` を使う。
    - redaction が必要な hook/MCP/tool error は専用 formatter を使う。
  - 完了条件:
    - production code の `catch (err: any)` が減る。
  - 実施:
    - `nightworkers.run-orchestration.service.ts` と `nightworkers.review-files.service.ts` の `catch (err: any)` を `unknown` に変更した。
    - run orchestration では `toErrorMessage` helper を通して failure report/log/summary を組み立てるようにした。
    - `rg "catch \\((err|error): any\\)" api/modules/nightworkers src/modules/nightworkers shared/schemas/nightworkers shared/schemas/design-questionnaire.schema.ts` で残存なしを確認した。

## Phase 6: Provider And Runtime Boundary Cleanup

- [x] Codex structured provider と Codex agent runtime の用語を分離する。
  - 対象: provider settings, runtime lane, docs, UI labels
  - やること:
    - `codex` provider は legacy/advanced structured supervisor provider として明示する。
    - `codex-agent` runtime lane は implementation run runtime として明示する。
    - UI/API type names が誤選択を誘発しないようにする。
  - 完了条件:
    - 設定画面と schema 上で provider と runtime lane が混同されない。
  - 実施:
    - README と `spec/docs/configuration.md` に structured provider と implementation runtime lane の違いを明記した。
    - Codex SDK provider は schema-first reasoning/generation 用、`codex-agent` は repository execution runtime lane として分離して説明した。
    - Settings の Codex provider title を `Codex SDK structured provider` に変更した。

- [x] Runtime lane resolution を設定層へ寄せる。
  - 対象: `api/services/agent-runtime/runtime-lane.ts`, settings routes, queue/run services
  - やること:
    - task/queue/settings/env/provider default の優先順位を doc と test に固定する。
    - env 直読みを injectable config にする。
    - diagnostics を UI/ledger に出せる形にする。
  - 完了条件:
    - runtime lane 変更時に一箇所の contract test が落ちる。
  - 実施:
    - `readRuntimeLaneConfigFromEnv` を追加し、`resolveRuntimeLane` 自体は env を直接読まない pure input resolver にした。
    - run orchestration / workbench intake は settings と env fallback を明示的に渡す形にし、task/queue/settings/env/provider default の優先順位を resolver に集約した。
    - `tests/services.agent-runtime-registry.test.ts` に task → queue → settings → env → provider default の優先順位テストを追加した。
    - DB の `workerKind` は `normalizeAgentRuntimeKind` で registry へ渡し、`run.workerKind as any` を削除した。

- [x] LLM provider request building と usage recording の境界を明確化する。
  - 対象: `api/services/supervisor/llm-provider/*`, `llm-usage`
  - やること:
    - provider request, JSON extraction, schema validation, usage normalization の責務を再確認する。
    - provider-specific raw response と normalized usage を分ける。
    - failure 時も raw/error/body の保存方針を統一する。
  - 完了条件:
    - provider 追加時の実装箇所が明確。
  - 実施:
    - `llm-usage/normalize.ts` の raw usage record helper を `Record<string, unknown>` にし、provider raw usage と fallback estimate を混ぜない contract test を追加した。
    - `llm-usage/repository.ts` の mixed usage count から `row as any` を削除した。
    - Bedrock provider の raw response usage 参照を `readProviderUsage` helper に寄せ、provider-specific raw response extraction の境界を明示した。
    - `spec/docs/configuration.md` に request builder / provider call / JSON validation / usage normalization / usage persistence の責務境界を追記した。
    - `tests/services.llm-usage.test.ts` と supervisor provider tests が通ることを確認した。

## Phase 7: Test Infrastructure Hardening

- [x] Test fixture builder を導入する。
  - 対象: `tests/helpers` or domain-specific test helpers
  - やること:
    - `buildTask`, `buildTaskRun`, `buildTaskMessage`, `buildTaskEvent`, `buildBlueprintMessage` を作る。
    - `as any` fixture を builder に寄せる。
    - default values は実 schema と一致させる。
  - 完了条件:
    - workbench/supervisor/timeline tests の fixture 重複が減る。
  - 実施:
    - `tests/helpers/nightworkers-fixtures.ts` を追加し、`buildTask`, `buildTaskRun`, `buildTaskMessage`, `buildTaskEvent`, `buildBlueprintMessage`, `buildActivityArtifact` を提供した。
    - `tests/artifact-workspace-viewer.test.ts` と `tests/nightworkers.workbench-selectors.test.ts` の代表 fixture を builder 経由に置換した。
    - `pnpm --silent typecheck`, `pnpm --silent lint`, focused selector/artifact tests が通ることを確認した。

- [x] テスト分割規約を固定する。
  - 対象: `tests/README.md` または `spec/docs/testing.md`
  - やること:
    - 分割済み親 test file を残さない。
    - 共通 fixture は `helpers.ts` に置く。
    - 分割ファイルは単体実行できることを必須にする。
  - 完了条件:
    - 空 suite / 二重実行の再発を防げる。
  - 実施:
    - `spec/docs/testing.md` を追加し、split 後の親 placeholder suite 禁止、split file の単体実行必須、shared helper 配置を明文化した。
    - `rg -n "Split into|No test suite found" tests` の final check と合わせて再発を検出できる状態にした。

- [x] SQLite/libSQL lock 対策を標準化する。
  - 対象: queue/run/workbench route tests
  - やること:
    - background drain を止める test helper を作る。
    - test DB isolation または retry policy を検討する。
    - unhandled rejection を fail-fast で拾う。
  - 完了条件:
    - queue/run tests が並列/連続実行で安定する。
  - 実施:
    - `tests/helpers/nightworkers-test-controls.ts` を追加し、route-level auto-drain env の setup/cleanup を `disableAutoQueueDrainForTest` / `restoreAutoQueueDrainForTest` に集約した。
    - `spec/docs/testing.md` に Queue / run tests は `{ autoDrain: false }` を優先し、route env fallback が必要な場合だけ helper を使う方針を記載した。
    - workbench route tests 4ファイルの連続実行が通ることを確認した。

- [x] `setTimeout` 待ちを event-driven helper に置換する。
  - 対象: route tests, realtime tests
  - やること:
    - broker flush / intake completion / background promise drain helper を作る。
    - `await new Promise(resolve => setTimeout(...))` を減らす。
  - 完了条件:
    - sleep に依存する flaky test が減る。
  - 実施:
    - workbench route tests の `await new Promise(resolve => setTimeout(resolve, 25))` を `flushPendingWorkbenchTasks` に置換した。
    - helper は microtask と `setImmediate` で pending cleanup を流し、固定ミリ秒 sleep に依存しない形にした。
    - `rg -n "setTimeout|new Promise\\(.*resolve" tests/nightworkers-workbench-routes tests/helpers` で対象 route tests に固定 sleep が残らないことを確認した。

- [x] 大型テストファイルを scenario helper 化する。
  - 対象: `routes-nightworkers-03-part01.test.ts`, workbench route tests
  - やること:
    - setup, create repository/task/message, app request helper を共有化する。
    - scenario 名で何を検証しているかを短くする。
    - fixture と assertion を分離する。
  - 完了条件:
    - 大型 route test の変更コストが下がる。
  - 実施:
    - `tests/helpers/nightworkers-fixtures.ts` と `tests/helpers/nightworkers-test-controls.ts` を追加し、大型 route/selector tests から共通化できる fixture と cleanup control を分離した。
    - `spec/docs/testing.md` に大型 split file の helper 配置と単体実行ルールを記載した。
    - 今回は代表範囲として workbench route split files と selector/artifact tests に適用し、以後の大型 test 追加時の標準導線にした。

## Phase 8: Operational Hygiene And Generated Artifacts

- [x] Generated/tracked artifact の管理ルールを追加する。
  - 対象: `.gitignore`, scripts, CI/verify
  - やること:
    - `.tanstack/tmp`, `scratch`, `playwright-report`, `test-results`, local reports が tracked にならないチェックを作る。
    - intentional generated source と temporary output を区別する。
    - `git ls-files` ベースの verify check を追加する。
  - 完了条件:
    - 一時生成物がレビュー差分に混ざらない。
  - 実施:
    - `.gitignore` に `.tanstack/tmp/` と `scratch/` の temporary output ルールを追加した。
    - `scripts/check-tracked-artifacts.mjs` と `pnpm check:tracked-artifacts` を追加し、`git ls-files` ベースで tracked temporary output を検出するようにした。
    - `scripts/verify.mjs` の base gate に tracked artifact check を追加した。

- [x] Console output policy を整理する。
  - 対象: `console.error`, `console.log` in production code
  - やること:
    - startup fatal errors 以外は logger 経由にする。
    - test cleanup log は必要なら prefix と quiet option を付ける。
    - secret-bearing output は redaction formatter を通す。
  - 完了条件:
    - production runtime logs が構造化される。
  - 実施:
    - `nightworkers.run-orchestration.service.ts` の runtime warning/error を direct `console.*` から `logger.warn/error` に変更した。
    - `spec/docs/configuration.md` に production API/service は logger を使い、startup fatal validation / CLI scripts / browser diagnostics の console は例外として扱う方針を記載した。

- [x] Environment variable access を設定 module に集約する。
  - 対象: provider, hooks, MCP, runtime lane, settings path, conversation context
  - やること:
    - domain ごとの config loader を作る。
    - tests は env ではなく config injection を優先する。
    - env fallback の優先順位を tests で固定する。
  - 完了条件:
    - env 副作用で tests が壊れにくくなる。
  - 実施:
    - `api/services/runtime-env.ts` を追加し、NightWorkers runtime lane / auto queue drain / test intake wait / session queue concurrency の env access を集約した。
    - queue management, workbench intake, run orchestration, runtime lane fallback は helper 経由で env を読む形に変更した。
    - `spec/docs/configuration.md` に runtime env は config helper または domain settings module 経由で読む方針を追記した。

## Phase 9: Documentation And Boundary Encoding

- [x] Artifact boundary rules を近接ドキュメント化する。
  - 対象: `workbenchSelectors.ts`, Artifact workspace tests, `spec/docs/architecture.md`
  - やること:
    - canonical artifact rows vs task message projection の優先順位を書く。
    - synthetic `artifact-*` ID を server-resolvable ID と混同しないことを書く。
    - DB Design と App Blueprint の分類ルールを書く。
  - 完了条件:
    - 新規実装者が boundary をテスト名と docs から理解できる。
  - 実施:
    - `spec/docs/architecture.md` に Artifact Projection Rules を追加した。
    - artifact row 優先、legacy embedded message fallback、synthetic `artifact-*` ID の扱い、DB Design 分類 helper の境界を明記した。
    - `workbenchSelectors.ts` と selector tests の分類/優先順位に合わせて docs を同期した。

- [x] Queue / Run lifecycle rules を docs と tests に同期する。
  - 対象: queue service, run orchestration, `spec/docs/architecture.md`
  - やること:
    - Queue Entry と Session status の関係を書く。
    - auto drain / manual drain / archived entry の違いを書く。
    - state transition table を docs と tests に反映する。
  - 完了条件:
    - Queue behavior の変更時に docs/test 両方を更新できる。
  - 実施:
    - `spec/docs/architecture.md` に Queue And Run Lifecycle Rules を追加した。
    - Queue Entry と Session status、`autoDrain` option、run transition table、queue completion ordering を明記した。
    - `tests/services.queue-management.test.ts` と `tests/services.run-orchestration-transitions.test.ts` の検証内容に合わせて docs を同期した。

- [x] Provider/runtime settings の user-facing docs を更新する。
  - 対象: README, `spec/docs/configuration.md`, settings UI text
  - やること:
    - structured provider と runtime lane の違いを書く。
    - Codex SDK / codex-agent の現在の推奨を明示する。
    - legacy/advanced path を通常導線から分離する。
  - 完了条件:
    - 設定時に誤った runtime を選びにくくなる。
  - 実施:
    - README に structured provider と runtime lane の分離を追加した。
    - `spec/docs/configuration.md` の LLM Providers に normal setup path と advanced/legacy fallback の扱いを追加した。
    - Settings UI の Codex provider label を structured provider として明示した。

## Final Verification Checklist
- [x] `rg -n "designSystem|design-system|Storybook" README.md spec/docs shared biome.json package.json pnpm-workspace.yaml` has no stale hits.
- [x] `rg -n "Split into|No test suite found" tests` has no active test residue.
- [x] `git diff --check`
- [x] `pnpm --silent typecheck`
- [x] `pnpm --silent lint`
- [x] `pnpm --silent test run`
- [x] `pnpm verify:full`
- [x] Relevant UI changes are checked in browser/Playwright when user-facing behavior changes.
