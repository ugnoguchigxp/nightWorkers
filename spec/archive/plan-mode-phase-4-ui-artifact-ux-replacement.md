# Plan Mode Phase 4: UI / Artifact UX Replacement

## Purpose

Plan mode の UI と artifact workspace を、Feature Plan と dedicated design view の表示へ置き換える。

Phase 4 は、Phase 1 から Phase 3 で置換した artifact model / routing / generator を、ユーザーが触る workspace UI に反映するフェーズ。旧 `Specification Workspace`、旧 `DB Design` tab、旧 `blueprint_workspace` artifact kind を保険として残さず、Plan mode workspace と dedicated view UX に寄せる。

このフェーズで実装コードに入る時点では、生成器の意味を再設計しない。UI は Phase 3 の canonical artifact を受けて表示するだけにする。

## Inputs

- [Plan Mode Concept](./plan-mode-concept.md)
- [Phase 1: Artifact Model Replacement](./plan-mode-phase-1-artifact-model-replacement.md)
- [Phase 2: Supervisor Flow Replacement](./plan-mode-phase-2-supervisor-flow-replacement.md)
- [Phase 3: Dedicated View Generators](./plan-mode-phase-3-dedicated-view-generators.md)
- Existing `PlanModeWorkspaceViewer`
- Existing `PlanModeWorkspacePanels`
- Existing workbench artifact selectors
- Existing settings Plan mode capability UI
- Existing Blueprint preview primitives
- Existing Markdown artifact viewer

## Phase Boundary

In scope:

- `feature_plan` を Plan workspace の primary tab / primary display にする。
- `questionnaire`、`blueprint`、`data_model`、`api_io_contract`、`state_model`、`activity_flow`、`sequence_flow`、`zod_schema_design` を dedicated view として表示する。
- dedicated view の include / omit 理由を表示する。
- `data_model` では DDL canonical / non-DB canonical source が分かる表示にする。
- Mermaid view は Markdown viewer 経由で表示する。
- `blueprint_workspace` artifact kind を `plan_mode_workspace` に置換する。
- `db-design` tab id を `data-model` に置換する。
- `Specification Workspace` のユーザー向け文言を `Plan Mode Workspace` に置換する。
- `DB Design` のユーザー向け文言を `Data Model` に置換する。
- Plan mode settings の capability 表示を new view 名に合わせる。
- UI tests / selector tests / i18n text audit を更新する。

Out of scope:

- 新しい巨大な planning dashboard。
- Timeline への warning UI 追加。
- Feature Plan / dedicated view generator の prompt 再設計。
- Data Model generator の schema 再設計。
- Blueprint preview primitive の全面再設計。
- Mermaid renderer の専用実装。Phase 4 では Markdown viewer 表示でよい。
- AI Coding Rules UI。
- Usecase 図 UI。

## Target UX

Plan workspace は次を一画面の作業面として見せる。

1. Feature Plan 本文。
2. 採用された dedicated design view。
3. 省略された dedicated design view と理由。
4. 実装開始前に残る questionnaire 項目。
5. 必須 verification gate。
6. 実装開始 / キュー追加 action。

UI 方針:

- 最初の focus は `Feature Plan`。まだ Feature Plan がない場合だけ `Status` を見せる。
- すべての tab を常時並べない。生成済み、または routing decision で include された view を中心に表示する。
- Omitted view は小さな summary と理由だけを表示し、空の tab を増やさない。
- UI がない task では Blueprint を必須表示しない。
- DB がない task でも Data Model が必要な場合は JSON shape / TypeScript type / storage contract として表示できる。
- Mermaid view は dedicated view の Markdown artifact として表示する。

## Current Runtime Touchpoints

| Area | Current file | Current behavior | Phase 4 action |
| --- | --- | --- | --- |
| Main workspace viewer | `src/modules/planMode/PlanModeWorkspaceViewer.tsx` | `status/questionnaire/blueprints/db-design/specification` 固定 tabs | `feature-plan/status/questionnaire/blueprint/data-model/views` へ置換し、必要 view 中心にする |
| Workspace panels | `src/modules/planMode/PlanModeWorkspacePanels.tsx` | `WorkspaceDbDesignPanel` が AppBlueprint `databaseSchema` を読む | `WorkspaceDataModelPanel` を Data Model artifact payload / Markdown 表示に置換する |
| Workspace model | `src/modules/specification/specificationWorkspaceModel.ts` | `WorkspaceTab` に `db-design` が残る | `data-model` と dedicated view tab model に置換する |
| Workbench selectors | `src/modules/nightworkers/workbenchArtifactSelectors.ts` | `blueprint_workspace` と DB Design metadata を artifact ref にする | `plan_mode_workspace` と dedicated view metadata で判定する |
| Workbench artifact kind | `src/modules/nightworkers/types/workbench.ts` | `WorkbenchArtifactKind` に `blueprint_workspace` がある | `plan_mode_workspace` に置換する |
| Artifact pane | `src/modules/nightworkers/components/ArtifactPane.tsx` | `blueprint_workspace` なら `PlanModeWorkspaceViewer` を開く | `plan_mode_workspace` に置換し、legacy `initialTab` mapping を削る |
| Thread workspace button | `src/modules/nightworkers/components/ThreadWorkspace.tsx` | `blueprint_workspace` を優先して開く | Plan mode workspace artifact を優先して開く |
| Shell focus | `src/modules/nightworkers/components/NightWorkersShell.tsx` | `blueprint_workspace` を artifact open 判定に使う | `plan_mode_workspace` に置換する |
| Presentation hooks | `src/modules/nightworkers/hooks/useNightWorkersSessionPresentation.ts` | Plan workspace evidence から `blueprint_workspace` ref を補う | `plan_mode_workspace` ref を補う |
| Workspace hook | `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` | helper 名が specification workspace のまま | Plan workspace naming に置換する |
| Blueprint DB panel | `src/modules/blueprint-preview/BlueprintDbDesignPanel.tsx` | DB Design table view | Phase 4 では Data Model panel へ移動または削除する |
| Blueprint preview index | `src/modules/blueprint-preview/index.ts` | DB Design panel / model を export | Data Model UI から参照しないようにする |
| Data design model | `src/modules/blueprint-preview/dbDesignModel.ts` | `blueprint-db-design-request` prompt builder | Phase 3 後に残っていれば Phase 4 で UI export から削除する |
| Settings UI | `src/modules/settings/SettingsPlanModePanel.tsx` | capability toggle を表示 | user_flow の扱い、dedicated view labels、description を Phase 1-3 と同期する |
| i18n | `src/i18n/dictionaries/en.ts`, `src/i18n/dictionaries/ja.ts` | `Specification Workspace`, `DB Design`, `blueprint.db.*` が残る | Plan Mode Workspace / Data Model wording に置換する |

## Target Component Shape

Phase 4 の UI は、この最小構造に寄せる。

```txt
PlanModeWorkspaceViewer
  PlanWorkspaceHeader
  PlanWorkspaceNav
  PlanWorkspaceStatusPanel
  FeaturePlanPanel
  QuestionnairePanel
  BlueprintPanel
  DataModelPanel
  DedicatedViewPanel
  ViewDecisionSummary
```

責務:

- `PlanModeWorkspaceViewer`: state、refresh、active tab、action dispatch を持つ。
- `PlanWorkspaceNav`: 表示する tab の決定と tab button。
- `PlanWorkspaceStatusPanel`: artifact 作成順と実装開始 action。
- `FeaturePlanPanel`: latest reviewed Feature Plan を primary 表示。
- `QuestionnairePanel`: 既存 Questionnaire form primitive を使う。
- `BlueprintPanel`: 既存 Blueprint preview primitive を使う。
- `DataModelPanel`: Data Model artifact payload / DDL / summary / fallback Markdown を表示する。
- `DedicatedViewPanel`: API / IO、state、activity、sequence、Zod schema design の Markdown を表示する。
- `ViewDecisionSummary`: include / omit 理由を小さく表示する。

## Workspace Tab Model

旧 model:

```ts
type WorkspaceTab =
  | 'blueprints'
  | 'db-design'
  | 'questionnaire'
  | 'status'
  | 'specification';
```

新 model:

```ts
type PlanWorkspaceTab =
  | 'feature-plan'
  | 'status'
  | 'questionnaire'
  | 'blueprint'
  | 'data-model'
  | 'api-io-contract'
  | 'state-model'
  | 'activity-flow'
  | 'sequence-flow'
  | 'zod-schema-design';
```

Mapping:

| Legacy tab | New tab | Notes |
| --- | --- | --- |
| `specification` | `feature-plan` | Feature Plan が primary |
| `design-doc` | `feature-plan` | ArtifactPane の legacy input だけで normalize |
| `blueprints` | `blueprint` | plural をやめる |
| `db-design` | `data-model` | DB Design 名は残さない |
| `specification-status` | `status` | legacy input だけで normalize |

Phase 4 完了時点では、runtime state に legacy tab id を保存しない。

## Artifact Kind Model

旧 model:

```ts
type WorkbenchArtifactKind = 'blueprint_workspace' | 'app_blueprint' | ...
```

新 model:

```ts
type WorkbenchArtifactKind = 'plan_mode_workspace' | 'app_blueprint' | ...
```

Selector rule:

- Plan mode workspace ref は `feature_plan`、`questionnaire`、`blueprint`、`data_model`、dedicated view のいずれかが存在するときに作る。
- Title は `Plan Mode Workspace`。
- Summary は `Feature Plan / Questionnaire / Blueprint / Data Model / Dedicated Views` の count を表示する。
- `metadata.initialTab` は新 tab id だけを持つ。
- Dedicated view message は個別 artifact ref としても出せるが、workspace ref の中にも集約される。

## Dedicated View Display

Dedicated view 表示は `PlanModeWorkspace.dedicatedViewArtifacts` を中心に組み立てる。

View grouping:

- Core:
  - `feature_plan`
  - `questionnaire`
  - `blueprint`
  - `data_model`
- Additional:
  - `api_io_contract`
  - `state_model`
  - `activity_flow`
  - `sequence_flow`
  - `zod_schema_design`

Additional view の表示:

- 生成済み artifact があれば tab を出す。
- routing decision で include だが未生成なら status panel に action / missing indicator を出す。
- routing decision で omit なら `ViewDecisionSummary` に理由だけ出す。
- routing decision がない場合は空 tab を作らない。

## Data Model Panel Requirements

`DataModelPanel` は AppBlueprint `databaseSchema` に依存しない。

Input priority:

1. `message.metadataJson.dataModel`
2. `message.metadataJson.artifactPayload`
3. `message.content` Markdown
4. empty state

Required display:

- Title
- canonical source:
  - `DDL`
  - `JSON shape`
  - `TypeScript type`
  - `Zod schema`
  - `Storage contract`
- DDL code block when present
- derived table summary when present
- relation summary when present
- constraints / open questions
- source artifact links / message id summary

Do not:

- Read `metadata.appBlueprint.databaseSchema` as Data Model正本.
- Reuse `BlueprintDbDesignPanel` as the final Data Model panel.
- Show `DB Design` as user-facing label.

## Feature Plan Panel Requirements

Feature Plan is primary.

Display order:

1. Reviewed Feature Plan message.
2. Unreviewed Feature Plan draft.
3. Empty state with Status action.

Metadata detection:

- Prefer `metadata.intent === 'feature_plan'`.
- Keep `draft_spec` only as Phase 1 migration fallback if still needed during implementation.
- Reviewed source detection should use `source === 'status_document_review'` or Phase 1 equivalent.

Do not:

- Call it Specification in UI.
- Treat `implementation_plan` as the primary artifact.

## Status Panel Requirements

Status panel should guide artifact creation without implying every view is mandatory.

Required steps:

1. Questionnaire if included or already started.
2. Blueprint only if UI is included.
3. Data Model only if included.
4. Additional dedicated views if included.
5. Feature Plan.
6. Start implementation / add to queue.

Rules:

- If a view is omitted, show a compact omit reason and do not disable progress.
- If capability is disabled, keep read-only status visible and disable only the generation action.
- If implementation is locked, disable generation and queue actions but keep artifacts readable.
- `busyAction` values use new names: `blueprint`, `data-model`, `feature-plan`, and `view:<view>`.

## Implementation Steps

### Step 0. Baseline UI And Selector Audit

Run before edits:

```bash
rg -n "blueprint_workspace|Specification Workspace|DB Design|db-design|dbDesign|BlueprintDbDesignPanel|blueprint.db|specificationWorkspace" src tests
rg -n "WorkspaceTab|PlanModeWorkspaceViewer|WorkspaceDbDesignPanel|SpecificationStatusView" src tests
```

Expected findings:

- `PlanModeWorkspaceViewer.tsx` still uses fixed tabs and `db-design`.
- `PlanModeWorkspacePanels.tsx` still exports `WorkspaceDbDesignPanel`.
- `WorkbenchArtifactKind` still contains `blueprint_workspace`.
- ArtifactPane / ThreadWorkspace / NightWorkersShell still open `blueprint_workspace`.
- i18n still has `Specification Workspace` and `blueprint.db.*`.

### Step 1. Rename Artifact Kind To `plan_mode_workspace`

Target files:

- `src/modules/nightworkers/types/workbench.ts`
- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersSessionPresentation.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `tests/nightworkers.workbench-selectors.test.ts`
- `tests/nightworkers-workbench-routes/routes-workbench-02.test.ts`

Implementation details:

- Replace `blueprint_workspace` with `plan_mode_workspace`.
- Replace titles:
  - `Specification Workspace` -> `Plan Mode Workspace`
  - `No Specification Workspace` -> `No Plan Mode Workspace`
- `buildQuestionnaireWorkspaceArtifactRef` should become `buildPlanModeWorkspaceArtifactRef`.
- Workspace summary should count:
  - Feature Plan
  - Questionnaire
  - Blueprint
  - Data Model
  - Dedicated Views
- ArtifactPane should render `PlanModeWorkspaceViewer` for `plan_mode_workspace`.

Acceptance:

- Workbench opens Plan mode workspace with new kind.
- Old kind is not emitted by selectors.
- Tests assert `plan_mode_workspace`.

### Step 2. Replace Workspace Tab IDs

Target files:

- `src/modules/specification/specificationWorkspaceModel.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- Selector tests that assert `initialTab`

Implementation details:

- Rename `WorkspaceTab` to `PlanWorkspaceTab`.
- Replace:
  - `specification` -> `feature-plan`
  - `blueprints` -> `blueprint`
  - `db-design` -> `data-model`
- Keep `workspaceInitialTab` as a parser for incoming legacy values only.
- Do not write legacy tab ids into new artifact metadata.

Acceptance:

- Plan workspace nav uses new tab ids.
- Deep links / artifact metadata point to new tab ids.
- Legacy `design-doc` and `specification-status` can still open to the right tab during transition, but are not emitted.

### Step 3. Make Feature Plan Primary

Target files:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/specification/specificationWorkspaceModel.ts`
- `tests/artifact-workspace-viewer.test.ts`

Implementation details:

- Default active tab:
  - `feature-plan` when reviewed or draft Feature Plan exists.
  - `status` when no Feature Plan exists.
  - `questionnaire` only when explicitly selected or answering is active.
- `feature-plan` tab is visible first.
- `Feature Plan` button is not disabled just because questionnaire is incomplete; if no content exists, panel shows empty state and action guidance.
- `isReviewedSpecificationMessage` should be renamed in UI-facing code if Phase 1 has not already done it.

Acceptance:

- Rendering empty workspace shows Status, not old Blueprint-first flow.
- Rendering workspace with Feature Plan opens Feature Plan by default.
- UI text says Feature Plan, not Specification.

### Step 4. Split Status Panel From Fixed Four-Step Flow

Target files:

- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `tests/specification-status-view.test.tsx`

Implementation details:

- Rename `SpecificationStatusView` to `PlanWorkspaceStatusView`.
- Replace props:
  - `canGenerateDbDesign` -> `canGenerateDataModel`
  - `hasSpecification` -> `hasFeaturePlan`
  - `onGenerateDbDesign` -> `onGenerateDataModel`
  - `onGenerateSpecification` -> `onGenerateFeaturePlan`
- Steps are built from included capabilities / included dedicated views, not hard-coded all artifacts.
- Keep read-only completed state and lock behavior.
- Use new busy action names:
  - `data-model`
  - `feature-plan`
  - `view:api_io_contract`
  - `view:state_model`
  - `view:activity_flow`
  - `view:sequence_flow`
  - `view:zod_schema_design`

Acceptance:

- Status panel does not require Blueprint for UI-less tasks.
- Data Model action can be available without Blueprint when Phase 3 generator supports it.
- Omitted views do not block Start implementation.

### Step 5. Replace Data Model Panel

Target files:

- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- New `src/modules/planMode/PlanModeDataModelPanel.tsx` if extraction keeps the file smaller.
- `src/modules/blueprint-preview/BlueprintDbDesignPanel.tsx`
- `src/modules/blueprint-preview/index.ts`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/ja.ts`

Implementation details:

- Add `WorkspaceDataModelPanel`.
- Read Data Model artifact payload from message metadata/content.
- Show DDL code block when available.
- Show non-DB canonical source when DDL is absent.
- Remove final dependency on `BlueprintDbDesignPanel` from Plan workspace.
- Remove `blueprint.db.*` strings from Plan workspace path.

Acceptance:

- Data Model artifact can render without `appBlueprint`.
- AppBlueprint databaseSchema is not needed for Data Model display.
- UI label is Data Model everywhere.

### Step 6. Add Dedicated View Panel

Target files:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/modules/specification/specificationWorkspaceModel.ts`
- `tests/artifact-workspace-viewer.test.ts`

Implementation details:

- Select latest artifact per dedicated view from `workspace.dedicatedViewArtifacts`.
- Resolve source message by `sourceMessageId`.
- Render Markdown content via `MarkdownViewer`.
- For Mermaid Markdown, no custom renderer is required in Phase 4; ensure code fences are visible.
- Tab labels:
  - API / I/O
  - State
  - Activity
  - Sequence
  - Zod

Acceptance:

- Generated additional views are visible.
- Missing but included views are shown as pending in Status.
- Omitted views are only summarized, not empty tabs.

### Step 7. Add Include / Omit Decision Summary

Target files:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/modules/nightworkers/types/blueprint.ts` or Phase 1 Plan workspace types
- Tests for workspace rendering

Implementation details:

- Use Phase 2 routing metadata if present:
  - included view
  - omitted view
  - reason
  - confidence / source if available
- If routing metadata is absent, infer only from generated artifacts and do not invent omit reasons.
- Show summary near Status or nav, not inside every panel.

Acceptance:

- User can tell why a view exists or is absent.
- No empty tabs are created for omitted views.

### Step 8. Settings And I18n Cleanup

Target files:

- `src/modules/settings/SettingsPlanModePanel.tsx`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/ja.ts`
- `api/routes/settings-route-definitions.ts`
- `api/services/settings/general-settings.ts`
- `tests/routes.settings-general.test.ts`
- `tests/services.general-settings.test.ts`

Implementation details:

- Confirm `PlanModeCapability` list matches Phase 1 schema.
- If `user_flow` has no dedicated generator in Phase 3, either:
  - keep it only if Phase 1-3 still define it as a first-class view, or
  - remove it from UI capability toggles in this phase.
- Remove legacy fallback from `dbDesign` capability once API no longer emits it.
- Replace i18n keys:
  - `thread.specificationWorkspace`
  - `thread.noSpecificationWorkspace`
  - `blueprint.db.*` if no longer used outside legacy preview.

Acceptance:

- Settings panel lists only current Plan mode capabilities.
- User-facing dictionaries do not expose DB Design / Specification Workspace for Plan mode.

### Step 9. Tests And Text Audit

Update tests after each step rather than at the end.

Primary tests:

- `tests/plan-artifact-visibility.test.ts`
- `tests/artifact-workspace-viewer.test.ts`
- `tests/specification-status-view.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`
- `tests/blueprint-preview-design-settings.test.ts`
- `tests/routes.settings-general.test.ts`
- `tests/services.general-settings.test.ts`

Add tests:

- `PlanModeWorkspaceViewer` opens `feature-plan` by default when Feature Plan exists.
- UI-less task does not require Blueprint.
- Data Model panel renders DDL-backed artifact.
- Data Model panel renders non-DB canonical source artifact.
- Dedicated view Markdown panel renders API / state / activity / sequence / Zod artifacts.
- Omitted view reason appears without creating a tab.
- Workbench selector emits `plan_mode_workspace`.

## Legacy Removal Checklist

Remove as current UI concepts:

- `blueprint_workspace`
- `Specification Workspace`
- `No Specification Workspace`
- `db-design` tab id
- `DB Design` tab / title / panel
- `WorkspaceDbDesignPanel`
- `SpecificationStatusView`
- `canGenerateDbDesign`
- `onGenerateDbDesign`
- `blueprint.db.*` in Plan mode display path
- `BlueprintDbDesignPanel` from Plan workspace

Allowed only as temporary input normalization:

- `workspaceInitialTab('db-design') -> 'data-model'`
- `workspaceInitialTab('design-doc') -> 'feature-plan'`
- A short test fixture marked as legacy input, if needed.

Do not leave legacy names as parallel runtime concepts.

## Verification

Focused UI / selector checks:

```bash
bunx vitest run \
  tests/plan-artifact-visibility.test.ts \
  tests/artifact-workspace-viewer.test.ts \
  tests/specification-status-view.test.tsx \
  tests/nightworkers.workbench-selectors.test.ts \
  tests/blueprint-preview-design-settings.test.ts
```

Settings checks:

```bash
bunx vitest run \
  tests/routes.settings-general.test.ts \
  tests/services.general-settings.test.ts
```

Compile / build:

```bash
bun run typecheck
bun run build
git diff --check
```

Text audit:

```bash
rg -n "blueprint_workspace|Specification Workspace|No Specification Workspace|db-design|DB Design|dbDesign|WorkspaceDbDesignPanel|SpecificationStatusView|blueprint\\.db|ui specification|verification matrix|design view reference|Usecase|usecase" src tests
```

Expected text audit result:

- No current UI runtime reference to old DB Design names.
- No current UI runtime reference to `blueprint_workspace`.
- No Plan mode user-facing label says Specification Workspace.
- Any remaining legacy match is an input-normalization test or a migration note with an explicit comment.

## Done Criteria

- Workbench opens `plan_mode_workspace`, not `blueprint_workspace`.
- Plan workspace defaults to Feature Plan when available.
- Status panel no longer forces Blueprint / Data Model / Feature Plan as a fixed linear four-step flow for every task.
- UI-less task can proceed without Blueprint.
- Data Model panel renders DDL-backed and non-DB artifacts without AppBlueprint dependency.
- Dedicated view artifacts render from `dedicatedViewArtifacts`.
- Include / omit reasons are visible without creating empty tabs.
- Settings and dictionaries use current Plan mode view names.
- Phase 5 can focus on cleanup / verification instead of fixing UX semantics.

## Stop Conditions

Stop and adjust before coding further if any of these happen:

- Phase 1 workspace schema still emits `dbDesignArtifacts` or `blueprint_workspace` as canonical fields.
- Phase 3 generator still emits AppBlueprint-shaped Data Model as canonical output.
- Dedicated view include / omit metadata is not available and cannot be inferred safely.
- Replacing `WorkbenchArtifactKind` causes broad unrelated artifact pane breakage.

In those cases, do not introduce `v2` or duplicate kinds. Fix the canonical model first, then update UI.
