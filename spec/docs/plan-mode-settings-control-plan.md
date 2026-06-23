# Plan Mode Settings Control Implementation Plan

## Purpose

NightWorkers の Settings に Plan Mode 利用設定を追加し、Plan Mode の4種類の生成経路を個別に on/off できるようにする。

この計画では、コード上で確認できる4種類を次の Status flow capabilities と定義する。

1. `questionnaire`: Design Questionnaire の作成と回答
2. `blueprint`: Blueprint / instant mockup の生成
3. `dbDesign`: DB Design の生成
4. `specification`: Specification / design-doc の生成

この設定は UI の表示だけではなく、Workbench intake、Status flow API、Codex lane、native/API lane の実行境界に効かせる。特に Plan Mode を無効化した生成経路が prompt だけで回避される状態を避け、service / runtime boundary で deterministic に止める。

## Implementation Readiness Review

現行方針は実装に進めるが、初版の計画には次の不足があった。

- `questionnaire=false` の対象が作成 endpoint に寄っており、回答、follow-up、review accept など既存 Questionnaire mutation が残る可能性があった。
- Settings UI の nested merge が `planMode.capabilities` まで補完する必要を明記していなかった。
- disabled capability を UI で隠すのか、read-only 履歴は表示するのかが曖昧だった。
- Codex lane で `executionMode` を MCP server に渡す実装点が曖昧で、prompt 表示だけで終わる余地があった。
- routing 改善の検証が「PlanMode ではない」ではなく、最終 `executionMode` まで見るべきことは書いていたが、変更前 baseline の採取手順がなかった。

この版では上記を implementation contract と baseline checklist に落とし、Review Questions は初期実装の決定として閉じる。

## Non-Goals

- Plan Mode の4種類を増やさない。
- provider / llm-provider 層に用途別 SystemContext を追加しない。
- ユーザー文言の keyword / regex 判定で Plan Mode を分岐しない。
- 完了済み Plan Mode artifact の read-only 境界は変更しない。
- Settings 追加に便乗して Blueprint / DB Design / Specification の生成品質改善はしない。
- Project-scoped override は初期実装に入れない。Settings は global のみとする。
- 新しい `verification` executionMode は初期実装に入れない。

## Closed Decisions For Initial Implementation

1. `questionnaire=false` かつ explicit planning request は reject せず、runtime `executionMode='planning'` の plan-only run に fallback する。
2. `specification=true` が `blueprint=false` または `dbDesign=false` と同時に保存されても許可する。生成時の prerequisite error で止める。
3. verification / test request は初期実装では `runtime_debug` に寄せる。専用 `verification` mode は後続検討にする。
4. 4 toggles は global settings のみとし、Project-scoped override は後続検討にする。
5. disabled capability は過去 artifact の read-only 表示を止めない。新規生成・更新 mutation だけを止める。

## Current State

### Settings

- General Settings は `api/services/settings/general-settings.ts` で `general-settings.json` に保存される。
- API schema は `api/routes/settings-route-definitions.ts` の `generalSettingsSchema`。
- UI は `src/modules/nightworkers/components/SettingsScreen.tsx` から `SettingsGeneralPanel` を表示する。
- frontend 型は `src/modules/nightworkers/types/overview.ts` と `src/modules/nightworkers/components/SettingsForms.ts` に重複している。

Plan Mode 利用設定は秘密情報でも provider 設定でもないため、保存先は General Settings が自然である。ただし UI は General に詰め込まず、Settings section に `plan-mode` を追加して独立表示する。

### Plan Mode Routing

- Workbench intake は `api/modules/nightworkers/nightworkers.workbench.service.ts` の `decideWorkbenchPlanModeGate()` で `plan_mode | general_answer | implementation` を判定する。
- `plan_mode` の場合は `createDesignQuestionnaire()` を呼び、run は開始しない。
- `general_answer` と `implementation` は `startTaskRun()` に `executionMode` を渡す。
- 現状は review / runtime_debug / verification が implementation に畳まれやすい。

### Status Flow Capabilities

- Status UI の4ステップは `src/modules/nightworkers/components/ArtifactWorkspacePanels.tsx` にある。
- `Questionnaire` は `POST /tasks/:id/design-questionnaire`。
- `Blueprint` は `POST /tasks/:id/specification-workspace/blueprint`。
- `DB Design` は `POST /tasks/:id/specification-workspace/db-design`。
- `Specification` は `POST /tasks/:id/specification-workspace/design-doc`。
- service 実体は `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts` の `createDesignQuestionnaire()`、`generateSpecificationStatusBlueprint()`、`generateSpecificationStatusDbDesign()`、`generateSpecificationStatusDesignDocument()`。

### Runtime Lanes

- native/API planning は `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts` で read-only tool allowlist になっており、dispatcher でも mode 不一致 tool を拒否する。
- Codex lane は `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts` の prompt contract と post-run audit に寄っている。
- Codex MCP server `api/mcp/nightworkers-codex-mcp.ts` は現状、executionMode を見ずに `todo_list` / `import_project` を登録する。

## Target Settings Shape

`GeneralSettings` に次を追加する。

```ts
export type PlanModeCapability = 'questionnaire' | 'blueprint' | 'dbDesign' | 'specification';

type PlanModeSettings = {
  capabilities: Record<PlanModeCapability, boolean>;
};
```

default はすべて `true` にする。既存ユーザーの挙動を変えないためである。

保存 JSON 例:

```json
{
  "timezone": "Asia/Tokyo",
  "language": "ja",
  "currency": "JPY",
  "fx": {
    "source": "ecb",
    "autoRefresh": true,
    "lastRefreshedAt": null
  },
  "planMode": {
    "capabilities": {
      "questionnaire": true,
      "blueprint": true,
      "dbDesign": true,
      "specification": true
    }
  }
}
```

Normalization rule:

- missing `planMode` は default に補完する。
- capability value が boolean でなければ default に戻す。
- `specification=true` かつ `questionnaire=false` のような組み合わせは保存自体は許可する。実行時に prerequisite 不足として止める。

Implementation details:

- `PLAN_MODE_CAPABILITIES` を backend / frontend の重複定義で持つ場合も、順序と key はこの4つに固定する。
- backend は `normalizePlanModeSettings(input: unknown): PlanModeSettings` を `normalizeGeneralSettings()` から呼ぶ。
- frontend は `mergeGeneralSettings(input)` helper を作り、`fx` と同じく `planMode.capabilities` を nested default merge する。
- `saveGeneralSettings()` は保存後に backend normalized payload を返すため、frontend state は response body で置き換える。
- JSON に未知 key が含まれても保存時には既存の `normalizeGeneralSettings()` 方針に合わせて落としてよい。

## Design Decisions

### 1. Settings UI は専用 section にする

`SettingsForms.ts` に `plan-mode` section を追加する。

理由:

- General Settings は timezone / language / currency であり、Plan Mode 利用設定とは操作頻度もリスクも違う。
- 4 toggles を General panel に入れると見通しが悪い。
- Test section と同様、実行挙動に影響する設定として独立させる方がレビューしやすい。

追加 UI:

- `SettingsPlanModePanel.tsx`
- 4つの checkbox / toggle
- Save button は General Settings の save endpoint を使う
- 各 toggle の説明は「UI 表示」ではなく「該当生成 API も止める」ことを明記する
- 過去 artifact / session は read-only で表示し続けることを明記する

Status UI behavior:

- disabled capability の action button は hidden ではなく disabled にする。
- disabled reason は `Plan Mode capability is disabled in Settings.` のように短く表示する。
- `getSpecificationWorkspace()` / `listDesignQuestionnaires()` / `getDesignQuestionnaireSession()` は read-only なので disabled にしない。
- API が `PLAN_MODE_CAPABILITY_DISABLED` を返した場合は toast / inline error に出し、workspace state を破棄しない。

### 2. Service-level gate を追加する

Plan Mode capability は UI 非表示だけでは不十分である。各 service entrypoint の先頭で設定を読み、無効なら `AppError(409, 'PLAN_MODE_CAPABILITY_DISABLED', ...)` を返す。

対象:

- `createDesignQuestionnaire()` -> `questionnaire`
- `saveDesignQuestionnaireAnswers()` -> `questionnaire`
- `generateDesignQuestionnaireFollowUp()` -> `questionnaire`
- `generateDesignQuestionnaireReview()` -> `questionnaire`
- `acceptDesignQuestionnaireReview()` -> `questionnaire`
- `leaveDesignQuestionnaireReviewUnadopted()` -> `questionnaire`
- `generateSpecificationStatusBlueprint()` -> `blueprint`
- `generateSpecificationStatusDbDesign()` -> `dbDesign`
- `generateSpecificationStatusDesignDocument()` -> `specification`

helper を追加する。

```ts
function assertPlanModeCapabilityEnabled(capability: PlanModeCapability) {
  const settings = readGeneralSettings();
  if (settings.planMode.capabilities[capability]) return;
  throw new AppError(
    409,
    'PLAN_MODE_CAPABILITY_DISABLED',
    `Plan Mode capability is disabled: ${capability}`
  );
}
```

`assertPlanModeMutable()` とは責務を分ける。mutable check は task status、capability check は global settings である。

Read-only functions stay open:

- `listDesignQuestionnaires()`
- `getDesignQuestionnaireSession()`
- `getBlueprintSpecificationWorkspace()`
- `getSpecificationWorkspace()`

API contract:

- disabled mutation は HTTP 409。
- error code は `PLAN_MODE_CAPABILITY_DISABLED`。
- error details には `{ capability }` を入れる。既存 `AppError` が details を持てない場合は message に capability を含め、テストは code と status を主に見る。

### 3. Workbench intake は questionnaire setting を見る

`decideWorkbenchPlanModeGate()` が `plan_mode` を返しても、`questionnaire=false` の場合は questionnaire を作成しない。

初期方針:

- `questionnaire=true`: 現状どおり questionnaire を作成する。
- `questionnaire=false`: `executionMode='planning'` の runtime planning run を開始し、plain implementation-plan artifact を生成させる。
- `questionnaire=false` かつ explicit planning でない場合: 既存どおり `general_answer` または `implementation`。

理由:

- 「Plan Mode を完全に禁止」ではなく「Questionnaire 型 Plan Mode を使わない」設定として扱う。
- explicit planning request を implementation に落とすと、ユーザーの「実装に移らないで計画だけ」という意図を壊す。
- runtime planning run は Codex/native 両 lane の PlanMode safety gate の対象にできる。

### 4. Routing action を増やす

Workbench gate の action を次へ拡張する。

```ts
type WorkbenchPlanModeGateAction =
  | 'plan_mode'
  | 'general_answer'
  | 'implementation'
  | 'review'
  | 'runtime_debug';
```

対応:

- review request -> `executionMode='review'`
- 原因調査 / logs / runtime state -> `executionMode='runtime_debug'`
- test 実行や検証は初期実装では `runtime_debug` に寄せる。専用 `verification` executionMode は既存 union にないため追加しない。

これにより「PlanMode に入らない」だけでなく「正しい非 PlanMode mode に入る」ことを検証できる。

### 5. Codex lane は planning MCP allowlist と hard gate を持つ

Codex lane でも PlanMode safety を prompt 依存にしない。

実装方針:

- `getNightWorkersCodexToolNames()` に executionMode-aware variant を追加する。
- `executionMode='planning'` の Codex prompt では read-only tools だけを表示する。
- `createCodexRuntimeThread()` が Codex SDK env に `NIGHTWORKERS_EXECUTION_MODE` を追加する。既存の `NIGHTWORKERS_TASK_ID` / `NIGHTWORKERS_RUN_ID` と同じ場所で渡す。
- Codex MCP server 側でも `NIGHTWORKERS_EXECUTION_MODE` から planning を読み、`todo_list` / `import_project` を disabled error にする。
- planning run で file change、import、Todo mutation が観測された場合、warning ではなく terminal policy で `needs_human` に落とす。
- `buildNightWorkersCodexToolApprovalConfig()` も executionMode-aware にし、planning では mutating tools を inline MCP config に載せない。

read-only tools:

- `nightworkers.read_current_specification`
- `nightworkers.list_recent_specifications`

Terminal policy details:

- planning で `diff_collected` に変更ファイルがあれば `codex_plan_mode_file_change` error warning を追加し、terminal `needs_human` にする。
- planning で `nightworkers.todo_list` または `nightworkers.import_project` が観測されたら `codex_plan_mode_mutating_tool` error warning を追加し、terminal `needs_human` にする。
- planning で shell command が read-only かどうかまでは初期実装で判定しない。file diff と mutating NightWorkers MCP tool を hard gate にする。

### 6. native/API lane は existing allowlist を維持しつつ settings context を渡す

native/API planning mode はすでに mutation tool を出していない。追加するのは capability settings の可視化と service-level gate である。

実装方針:

- `startTaskRun()` の `contextSnapshot` / `runtimeOptions` に `planModeSettingsSnapshot` を入れる。
- native/API system prompt には disabled capabilities を短く記載する。
- provider が disabled capability に相当する artifact 作成を求めても、実際の service endpoint で止める。
- native/API の planning tool allowlist は広げない。`apply_patch` など planning で許可されている説明文は既存挙動として扱い、この計画では変更しない。

Snapshot shape:

```ts
type PlanModeSettingsSnapshot = {
  capabilities: Record<PlanModeCapability, boolean>;
  disabledCapabilities: PlanModeCapability[];
  source: 'general-settings';
};
```

Snapshot は run 作成時点の値を固定する。run 途中で Settings が変わっても、その run の runtime prompt / audit は snapshot に基づく。

## Baseline Checklist

実装前に次を確認して、PR description または作業ログに残す。

1. `GET /api/settings/general` が現状 `planMode` を返していないこと。
2. `POST /tasks/:id/design-questionnaire` と `POST /tasks/:id/specification-workspace/*` が Settings を見ずに生成すること。
3. Workbench gate が `plan_mode | general_answer | implementation` の3値だけを返すこと。
4. Codex planning prompt に `nightworkers.todo_list` / `nightworkers.import_project` が表示されること。
5. native/API planning tool allowlist が read-only 中心で、dispatcher が mode 不一致 tool を拒否すること。

## Implementation Phases

### Phase 1: Settings schema and persistence

Files:

- `api/services/settings/general-settings.ts`
- `api/routes/settings-route-definitions.ts`
- `src/modules/nightworkers/types/overview.ts`
- `src/modules/nightworkers/components/SettingsForms.ts`

Tasks:

1. `PlanModeSettings` type を追加する。
2. `DEFAULT_GENERAL_SETTINGS.planMode` を追加する。
3. `normalizeGeneralSettings()` で missing / invalid を default 補完する。
4. OpenAPI `generalSettingsSchema` に `planMode.capabilities` を追加する。
5. frontend `GeneralSettings` type と `defaultGeneralSettings` を同期する。
6. `mergeGeneralSettings()` frontend helper を追加し、load 時の shallow merge を nested merge に変える。

Verification:

- `bunx vitest run tests/services.general-settings.test.ts tests/routes.settings-general.test.ts`
- 既存 settings file に `planMode` がなくても default all true で返ること。
- invalid JSON / partial JSON で fallback が効くこと。
- POST で `planMode.capabilities.blueprint=false` を保存し、GET で false のまま返ること。
- 失敗した場合は Phase 2 へ進まず、schema / normalize / frontend type の不一致を先に直す。

### Phase 2: Settings UI

Files:

- `src/modules/nightworkers/components/SettingsForms.ts`
- `src/modules/nightworkers/components/SettingsScreen.tsx`
- `src/modules/nightworkers/components/SettingsPlanModePanel.tsx`
- `src/modules/nightworkers/i18n/dictionaries/ja.ts`
- `src/modules/nightworkers/i18n/dictionaries/en.ts`

Tasks:

1. Settings section に `plan-mode` を追加する。
2. `SettingsPlanModePanel` を作成する。
3. 4 toggles を `generalSettings.planMode.capabilities` に bind する。
4. Save は既存 `saveGeneralSettingsCommand()` を再利用する。
5. 日本語文言を主にし、英語辞書も同時更新する。
6. Status flow 側はこの Phase ではまだ disabled にしない。service gate 実装後に Phase 3 で UI 反映する。

Verification:

- frontend render test を追加するか、既存 settings test に Plan Mode section の source-level assertion を追加する。
- `bunx vitest run tests/routes.settings-general.test.ts`
- 可能なら targeted frontend build / typecheck を実行する。
- 失敗した場合は UI section だけを戻すのではなく、Phase 1 の default merge と型同期を確認する。

### Phase 3: Service-level capability gate

Files:

- `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`
- new helper candidate: `api/modules/nightworkers/nightworkers.plan-mode-settings.service.ts`
- `tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`
- `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`
- `src/modules/nightworkers/components/ArtifactWorkspacePanels.tsx`
- `src/modules/nightworkers/nightWorkersCommands.ts`

Tasks:

1. `assertPlanModeCapabilityEnabled()` を追加する。
2. Questionnaire mutation と 3 generation entrypoints に gate を追加する。
3. disabled 時は `PLAN_MODE_CAPABILITY_DISABLED` を返す。
4. route tests で各 endpoint が disabled capability で 409 になることを確認する。
5. Status flow UI の action button を capability に応じて disabled にする。
6. command wrapper は 409 を握りつぶさず、UI に error を返せるようにする。

Verification:

- `bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`
- `questionnaire=false` のとき `POST /design-questionnaire` が 409。
- `questionnaire=false` のとき answers / follow-up / review / accept / leave-unadopted が 409。
- `blueprint=false` のとき `POST /specification-workspace/blueprint` が 409。
- `dbDesign=false` のとき `POST /specification-workspace/db-design` が 409。
- `specification=false` のとき `POST /specification-workspace/design-doc` が 409。
- `tests/specification-status-view.test.tsx` で disabled button と read-only artifact 表示を確認する。
- 失敗した場合は helper の読み込み先、Settings test isolation、既存 route mock の順に切り分ける。

### Phase 4: Workbench routing and fallback

Files:

- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `tests/nightworkers-workbench-routes/routes-workbench-01.test.ts`

Tasks:

1. `WorkbenchPlanModeGate` action enum に `review` / `runtime_debug` を追加する。
2. prompt から「レビュー・原因調査も implementation」をやめ、各 action へ分ける。
3. `plan_mode` かつ `questionnaire=false` の場合は questionnaire を作らず `executionMode='planning'` run を開始する。
4. `executionModeSource` は `workbench_intake` のまま維持する。
5. system message に `planModeGate` と `planModeSettingsSnapshot` を残す。
6. fallback planning run で `createPlanningArtifactMessageIfNeeded()` が implementation-plan markdown を publish することを確認する。
7. Round 1 前の schema-first intake を Codex runtime lane に通さない既存前提を変えない。

Verification:

- `bunx vitest run tests/nightworkers-workbench-routes/routes-workbench-01.test.ts`
- explicit planning + questionnaire=true -> questionnaire ready, run null。
- explicit planning + questionnaire=false -> planning run started, questionnaire sessionなし。
- review request -> `executionMode='review'`。
- latest log investigation -> `executionMode='runtime_debug'`。
- minor implementation -> `executionMode='implementation'`。
- question -> `executionMode='general_answer'`。
- tests は `shouldStartPlanMode=false` だけでなく、created run の `contextSnapshot.executionMode` を assert する。
- 失敗した場合は LLM mock の gate action、Workbench response shape、run creation の順に切り分ける。

### Phase 5: Codex lane hardening

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/mcp/nightworkers-tool-manifest.ts`
- `api/mcp/nightworkers-codex-mcp.ts`
- `tests/services.codex-agent-runtime.test.ts`

Tasks:

1. Codex prompt の available tool list を executionMode-aware にする。
2. planning prompt から `nightworkers.todo_list` / `nightworkers.import_project` を外す。
3. MCP server handler で planning mode の mutating tool を fail closed する。
4. planning run の file_change / import / Todo mutation warning を terminal `needs_human` に昇格する。
5. `planModeSettingsSnapshot` を prompt contract に短く表示する。
6. `createCodexRuntimeThread()` の env に `NIGHTWORKERS_EXECUTION_MODE` を追加する。
7. `buildNightWorkersCodexToolApprovalConfig()` と MCP inline config を planning aware にする。

Verification:

- `bunx vitest run tests/services.codex-agent-runtime.test.ts`
- `bunx vitest run tests/codex-nightworkers-mcp-setup.test.ts tests/nightworkers-codex-mcp-integration.test.ts`
- planning prompt に mutating NightWorkers tools が出ない。
- planning MCP inline config に mutating tools が出ない。
- planning MCP handler で mutating tools が error になる。
- planning run で file_change が観測されたら `needs_human`。
- planning run で `nightworkers.todo_list` / `nightworkers.import_project` が観測されたら `needs_human`。
- implementation run の既存 Codex audit warning は壊れない。
- 失敗した場合は prompt list、SDK inline config、MCP handler、post-run audit の4層を分けて直す。

### Phase 6: native/API runtime context

Files:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`

Tasks:

1. `startTaskRun()` で `readGeneralSettings().planMode` を snapshot する。
2. `contextSnapshot` と `runtimeOptions` に `planModeSettingsSnapshot` を入れる。
3. native/API system prompt に disabled capabilities を入れる。
4. planning allowlist は現状維持する。
5. disabled artifact generation は service-level gate に任せる。
6. Role handoff / working context に snapshot を含める場合は、巨大化させず disabled capability list だけにする。

Verification:

- `bunx vitest run tests/nightworkers-service/services-nightworkers-02.test.ts`
- `bunx vitest run tests/services.native-api-runner.test.ts`
- `bunx vitest run tests/services.native-api-request-adapter.test.ts tests/services.native-api-role-handoff.test.ts`
- planning mode の tool allowlist が変わらない。
- runtime context に planMode settings が残る。
- disabled capabilities が native/API history または system prompt のどちらかで確認できる。
- 失敗した場合は runtimeOptions、contextSnapshot、provider history rendering の順に切り分ける。

## Test Matrix

| Case | Settings | Expected |
| --- | --- | --- |
| explicit planning | all true | questionnaire is created, no run |
| explicit planning | questionnaire false | planning run starts, no questionnaire |
| status blueprint | blueprint false | 409 `PLAN_MODE_CAPABILITY_DISABLED` |
| status db design | dbDesign false | 409 `PLAN_MODE_CAPABILITY_DISABLED` |
| status specification | specification false | 409 `PLAN_MODE_CAPABILITY_DISABLED` |
| questionnaire answer | questionnaire false | 409 `PLAN_MODE_CAPABILITY_DISABLED` |
| questionnaire read | questionnaire false | existing sessions remain readable |
| Codex planning | any | mutating NightWorkers MCP tools hidden / blocked |
| Codex planning violation | any | terminal `needs_human` |
| native/API planning | any | read-only allowlist remains enforced |
| review request | any | `executionMode='review'` |
| runtime investigation | any | `executionMode='runtime_debug'` |

## Rollout Order

1. Settings schema / persistence
2. Settings UI
3. service-level gates
4. Workbench routing fallback and action expansion
5. Codex lane hardening
6. native/API snapshot visibility
7. focused tests
8. broader `bun run verify` only after focused tests pass

## Stop Conditions

- Existing settings cannot be read after schema addition.
- Disabled capability only hides UI but API still generates artifacts.
- explicit planning with `questionnaire=false` falls into implementation.
- Codex planning can still mutate without `needs_human`.
- native/API planning loses its read-only tool allowlist.
- routing tests only assert `shouldStartPlanMode=false` and do not assert final `executionMode`.
- disabled capability の read-only artifact まで非表示になる。
- Settings save で partial `planMode.capabilities` が default merge されず capability が落ちる。
- Codex MCP handler が `NIGHTWORKERS_EXECUTION_MODE` 不明時に implementation と誤認して planning run の mutating tool を許可する。

## Implementation Ready Checklist

実装に移る前に、このチェックリストを満たすこと。

- 4 capabilities の key と default all true が backend / frontend / tests で一致している。
- `questionnaire=false` の対象が作成だけでなく全 Questionnaire mutation を含む。
- disabled capability は UI disabled、API 409、runtime prompt snapshot の3面で確認できる。
- Workbench fallback は explicit planning を implementation に落とさず、planning run にする。
- routing test は final `executionMode` を assert する。
- Codex lane は prompt list、inline MCP config、MCP handler、post-run audit の4層で planning mutation を止める。
- native/API lane は既存 allowlist を広げず、settings snapshot の可視化だけを足す。
- `bun run verify` は focused tests が通った後にだけ実行する。

## Deferred Questions

次は初期実装から外す。

1. Project-scoped Plan Mode capability override。
2. dedicated `executionMode='verification'`。
3. capability 間の保存時 dependency enforcement。
4. disabled capability ごとの granular audit dashboard。
