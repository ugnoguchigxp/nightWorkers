# Plan Mode Phase 1: Artifact Model Replacement

## Purpose

Plan mode の artifact model を、旧来の questionnaire / blueprint / DB Design / specification 一律構成から、`feature_plan` と必要時だけ生成する dedicated design view の構成へ置き換える。

このフェーズは「型、schema、read model、test expectation」を置き換えるフェーズである。Supervisor prompt、generator、UI の見た目は後続フェーズで扱うが、Phase 1 の型変更で壊れる参照はこのフェーズ内で最小限追従させる。

新旧を併存させない。`v1` / `v2` / `legacy` / `new` のような恒久的な二重命名を作らず、旧概念は置換または削除する。

## Inputs

- [Plan Mode Concept](./plan-mode-concept.md)
- Existing Plan mode capability settings
- Existing specification workspace schema
- Existing blueprint / questionnaire / DB Design metadata conventions
- Existing artifact visibility and workspace tests

## Phase Boundary

In scope:

- Plan mode の canonical artifact vocabulary を定義する。
- `feature_plan` を primary artifact として schema/type に追加する。
- `DedicatedDesignView` と `SpecificationLens` を schema/type に追加する。
- Settings / runtime snapshot の Plan mode capability を旧4項目から `feature_plan` + dedicated views へ置換する。
- Workspace read model を `BlueprintSpecificationWorkspace` から Plan mode workspace model へ置換する。
- 旧 `dbDesignArtifacts` を `dataModelArtifacts` へ置換する。
- 旧 `draft_spec` / `specification` の primary artifact 表現を `feature_plan` へ置換する。
- Phase 1 の変更で TypeScript / focused tests が通るように、参照元を最小限追従する。

Out of scope:

- Supervisor prompt / routing の本格置換。Phase 2 で扱う。
- dedicated view generator の生成内容変更。Phase 3 で扱う。
- Plan mode UI の見た目や画面構成の全面置換。Phase 4 で扱う。
- `dbDesign` route / generator の完全削除。Phase 3 で `data_model` へ吸収して削除する。
- repo 全体の旧名最終掃除。Phase 5 で扱う。

## Current Runtime Touchpoints

Phase 1 の実装前に確認済みの主要接点:

| Area | Current file | Current coupling | Phase 1 action |
|---|---|---|---|
| Settings capability | `api/services/settings/general-settings.ts` | `questionnaire / blueprint / dbDesign / specification` | `feature_plan` + dedicated views へ置換 |
| Runtime prompt snapshot | `api/services/todo-context/types.ts` | `PlanModeSettingsSnapshot` が旧 capability を保持 | Settings と同じ型へ置換 |
| Workspace schema | `shared/schemas/design-questionnaire.schema.ts` | `BlueprintSpecificationWorkspace`, `dbDesignArtifacts`, `kind: db-design` | Plan mode workspace schema へ置換 |
| Workspace service | `api/modules/specification/specification-workspace.service.ts` | DB Design message を別配列に分類 | Data Model artifact と Feature Plan reference へ置換 |
| Spec document context | `api/modules/specification/specification-document-renderer.ts` | `dbDesignDdl`, `draft_spec`, DB Design traceability | naming を Feature Plan / Data Model へ置換 |
| UI model | `src/modules/nightworkers/types/blueprint.ts` | `BlueprintSpecificationWorkspace`, `dbDesignArtifacts` | shared schema と同じ read model へ置換 |
| Workspace selector | `src/modules/specification/specificationWorkspaceModel.ts` | `WorkspaceTab: db-design / specification` | Phase 1 では型名と returned fields を追従 |
| Workspace viewer | `src/modules/planMode/PlanModeWorkspaceViewer.tsx` | `DB Design`, `Specification` labels and actions | compile 維持に必要な最小追従のみ |
| Status summaries | `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`, `useNightWorkersSessionPresentation.ts` | DB Design count | Data Model count へ置換 |
| Tests | `tests/artifact-workspace-viewer.test.ts`, `tests/services.spec-document-renderer.test.ts`, `tests/specification-status-view.test.tsx` | DB Design / draft_spec expectations | 新 artifact model expectations へ置換 |

## Target Artifact Vocabulary

Create or update a shared schema module so both API and UI import the same artifact vocabulary.

Create this file:

```text
shared/schemas/plan-mode-artifact.schema.ts
```

Canonical types:

```ts
export const featurePlanBodySectionSchema = z.enum([
  'goal',
  'scope_non_goals',
  'current_and_desired_behavior',
  'acceptance_criteria',
  'constraints',
  'implementation_steps',
  'verification',
  'risk_notes',
]);

export const dedicatedDesignViewSchema = z.enum([
  'questionnaire',
  'user_flow',
  'blueprint',
  'data_model',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
]);

export const specificationLensSchema = z.enum([
  'target_users_or_actors',
  'functional_requirements',
  'business_rules',
  'input_output',
  'interface_contract',
  'data_requirements',
  'state_behavior',
  'workflow_behavior',
  'error_behavior',
  'permission_boundary',
  'compatibility',
  'observability',
]);
```

Plan mode artifact kind:

```ts
export const planModeArtifactKindSchema = z.enum([
  'feature_plan',
  'questionnaire',
  'blueprint',
  'data_model',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
  'decision_review',
  'implementation_reference',
]);
```

`decision_review` and `implementation_reference` are not dedicated design views. They remain workspace artifacts because existing Plan mode uses them to show review output and queue / implementation handoff references.

## Target Workspace Read Model

Replace `BlueprintSpecificationWorkspace` with a Plan mode workspace read model.

Export this name:

```ts
export const planModeWorkspaceSchema = z.object({
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  generatedAt: z.string(),
  featurePlanArtifacts: z.array(planModeWorkspaceArtifactSchema),
  dedicatedViewArtifacts: z.array(planModeWorkspaceArtifactSchema),
  questionnaireSessions: z.array(planModeWorkspaceQuestionnaireSchema),
  decisionReviews: z.array(planModeWorkspaceArtifactSchema),
  implementationReferences: z.array(planModeWorkspaceReferenceSchema),
});

export type PlanModeWorkspace = z.infer<typeof planModeWorkspaceSchema>;
```

Artifact summary:

```ts
export const planModeWorkspaceArtifactSchema = z.object({
  id: z.string(),
  kind: planModeArtifactKindSchema,
  title: z.string(),
  sourceMessageId: z.string().uuid(),
  createdAt: dateLikeSchema,
  adoptionState: z.enum(['adopted', 'not_adopted', 'unknown']).optional(),
  sourceArtifactMessageId: z.string().uuid().optional(),
});
```

Compatibility aliases are not allowed as a permanent API. During the same patch, update callers from:

- `BlueprintSpecificationWorkspace` -> `PlanModeWorkspace`
- `blueprintArtifacts` -> filter `dedicatedViewArtifacts` by `kind === 'blueprint'`, or provide a narrow selector
- `dbDesignArtifacts` -> filter `dedicatedViewArtifacts` by `kind === 'data_model'`
- `implementationReferences` remains, but its `kind` should be represented by `implementation_reference`

If keeping derived arrays is materially simpler for UI compile stability, use new names only:

```ts
featurePlanArtifacts: PlanModeWorkspaceArtifact[];
blueprintArtifacts: PlanModeWorkspaceArtifact[];
dataModelArtifacts: PlanModeWorkspaceArtifact[];
questionnaireSessions: PlanModeWorkspaceQuestionnaire[];
decisionReviews: PlanModeWorkspaceArtifact[];
implementationReferences: PlanModeWorkspaceReference[];
```

Do not keep `dbDesignArtifacts`.

## Naming Replacement Table

| Old name | New name | Phase 1 handling |
|---|---|---|
| `BlueprintSpecificationWorkspace` | `PlanModeWorkspace` | Replace exported type and API/UI references |
| `blueprintSpecificationWorkspaceSchema` | `planModeWorkspaceSchema` | Replace schema export; route response uses new schema |
| `getBlueprintSpecificationWorkspace` | `getPlanModeWorkspace` | Rename service function; route URL rename is Phase 4 |
| `dbDesignArtifacts` | `dataModelArtifacts` | Replace field |
| `kind: 'db-design'` | `kind: 'data_model'` | Replace workspace artifact kind |
| `dbDesignHandoffNotes` | `dataModelHandoffNotes` | Replace schema field if used in Phase 1 touched schemas |
| `suggestedOwner: 'db-design'` | `suggestedOwner: 'data_model'` | Replace enum value |
| `draft_spec` primary artifact | `feature_plan` | Replace metadata expectation for newly generated plan artifacts |
| `specification` capability | `feature_plan` capability | Replace settings capability |
| `dbDesign` capability | `data_model` capability | Replace settings capability |

Historical persisted rows may still contain old metadata. Phase 1 may read old metadata only to classify existing artifacts, but new outputs and current types must use the new names.

## Implementation Steps

### Step 0. Baseline

Run focused tests before editing.

```bash
bunx vitest run tests/routes.settings-general.test.ts tests/plan-artifact-visibility.test.ts tests/artifact-workspace-viewer.test.ts tests/services.spec-document-renderer.test.ts tests/specification-status-view.test.tsx
```

Expected result:

- Current baseline is known.
- Any pre-existing failure is recorded before changes.

Failure handling:

- If a baseline test fails before changes, record the failure and keep Phase 1 verification focused on tests that can prove the touched surface.

### Step 1. Add Canonical Plan Mode Artifact Schema

Add `shared/schemas/plan-mode-artifact.schema.ts`.

Include:

- `featurePlanBodySectionSchema`
- `dedicatedDesignViewSchema`
- `specificationLensSchema`
- `planModeArtifactKindSchema`
- `planModeWorkspaceArtifactSchema`
- `planModeWorkspaceQuestionnaireSchema`
- `planModeWorkspaceReferenceSchema`
- `planModeWorkspaceSchema`
- corresponding TypeScript exports

Expected result:

- API and UI can import Plan mode artifact vocabulary from one module.
- `design-questionnaire.schema.ts` no longer owns the Plan workspace read model.

### Step 2. Replace Settings Capability Model

Update:

- `api/services/settings/general-settings.ts`
- `api/routes/settings-route-definitions.ts`
- `src/modules/nightworkers/types/overview.ts`
- `src/modules/settings/SettingsPlanModePanel.tsx`
- `src/modules/settings/SettingsForms.ts`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/ja.ts`
- `tests/routes.settings-general.test.ts`

New capability set:

```ts
type PlanModeCapability =
  | 'feature_plan'
  | 'questionnaire'
  | 'user_flow'
  | 'blueprint'
  | 'data_model'
  | 'api_io_contract'
  | 'state_model'
  | 'activity_flow'
  | 'sequence_flow'
  | 'zod_schema_design';
```

Default rule:

- `feature_plan: true`
- dedicated view capabilities default to true as permission vocabulary
- Phase 1 must not expose working generate buttons for view generators that Phase 3 has not implemented yet

Phase 1 default:

```ts
feature_plan: true
questionnaire: true
blueprint: true
data_model: true
api_io_contract: true
state_model: true
activity_flow: true
sequence_flow: true
zod_schema_design: true
user_flow: true
```

Phase 3 will decide generation support. Phase 1 only defines permission vocabulary and removes old capability names.

Expected result:

- `dbDesign` and `specification` are not Plan mode capabilities.
- Runtime snapshot and settings UI use the same capability keys.

### Step 3. Replace Runtime Snapshot Types

Update:

- `api/services/todo-context/types.ts`
- any snapshot builders using `buildPlanModeSettingsSnapshot`

Expected result:

- `PlanModeSettingsSnapshot.capabilities` and `disabledCapabilities` use the new `PlanModeCapability`.
- No local duplicate union of old capabilities remains.

### Step 4. Move Workspace Schema To Plan Mode Vocabulary

Update:

- `shared/schemas/design-questionnaire.schema.ts`
- new `shared/schemas/plan-mode-artifact.schema.ts`
- imports in API / UI

Remove from `design-questionnaire.schema.ts`:

- `blueprintWorkspaceArtifactSchema`
- `blueprintWorkspaceQuestionnaireSchema`
- `blueprintWorkspaceReferenceSchema`
- `blueprintSpecificationWorkspaceSchema`
- `BlueprintSpecificationWorkspace` export

Replace with imports or exports from `plan-mode-artifact.schema.ts` where needed.

Expected result:

- questionnaire schema remains about questionnaire and decisions.
- Plan mode workspace schema lives in the Plan mode artifact schema file.

### Step 5. Replace Workspace Service Read Model

Update:

- `api/modules/specification/specification-workspace.service.ts`
- `api/modules/specification/specification-route-definitions.ts`
- `api/modules/specification/specification.service.ts`

Rename:

- `getBlueprintSpecificationWorkspace` -> `getPlanModeWorkspace`
- `getSpecificationWorkspace` should be renamed at call sites in the same patch unless doing so would force Phase 2 or Phase 3 behavior changes. If it remains temporarily, it must delegate to `getPlanModeWorkspace`, use `PlanModeWorkspace`, and be listed as a Phase 5 cleanup target.

Classification rules:

- metadata `intent === 'feature_plan'` -> `featurePlanArtifacts`
- metadata `intent === 'app_blueprint'` and not data model -> `blueprintArtifacts`
- old metadata `source === 'blueprint-db-design'` or `dbDesignTarget` -> classify as `dataModelArtifacts` with `kind: 'data_model'`
- metadata `intent === 'design_decision_review'` -> `decisionReviews`
- metadata `intent === 'implementation_plan'` -> `implementationReferences`

Phase 1 may continue to read old DB Design metadata to avoid losing existing artifacts, but the read model must expose them as Data Model artifacts.

Expected result:

- API response has no `dbDesignArtifacts`.
- Existing old DB Design messages show up as `dataModelArtifacts`.

### Step 6. Replace Specification Document Context Names

Update:

- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `tests/services.spec-document-renderer.test.ts`

Replace:

- `dbDesignDdl` -> `dataModelDdl`
- `renderDbDesignDdlReference` -> `renderDataModelDdlReference`
- `DB Design は未生成です。` -> `Data Model は未生成です。`
- traceability `DB Design message` -> `Data Model message`
- workspace count `dbDesign` -> `dataModel`

Expected result:

- DDL remains available to feature plan / design document generation.
- User-facing and test-facing naming is Data Model.

### Step 7. Replace UI Types And Minimal References

Update:

- `src/modules/nightworkers/types/blueprint.ts`
- `src/modules/specification/specificationWorkspaceModel.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/hooks/useNightWorkersSessionPresentation.ts`

Phase 1 UI rule:

- Keep layout mostly as-is.
- Rename data model fields and types so TypeScript compiles.
- Do not redesign tab structure beyond replacing invalid old names.

Expected result:

- UI code no longer imports or mentions `BlueprintSpecificationWorkspace`.
- `dbDesignArtifacts` field is gone.
- Any visible `DB Design` label touched by Phase 1 becomes `Data Model`; full UX cleanup remains Phase 4.

### Step 8. Update Tests

Update focused tests to new model:

- `tests/routes.settings-general.test.ts`
- `tests/artifact-workspace-viewer.test.ts`
- `tests/services.spec-document-renderer.test.ts`
- `tests/specification-status-view.test.tsx`
- route tests that assert `dbDesignArtifacts` or `dbDesign` capability if touched by compile errors

Expected result:

- Tests assert Data Model read model, not DB Design read model.
- Tests assert `feature_plan` where Phase 1 changes newly generated primary plan metadata.

## Legacy Removal

Delete or replace in Phase 1:

- `PlanModeCapability` members `dbDesign` and `specification`.
- `PlanModeSettingsSnapshot` local old capability union.
- `BlueprintSpecificationWorkspace` exported type.
- `blueprintSpecificationWorkspaceSchema` as Plan mode workspace schema.
- `dbDesignArtifacts` read model field.
- `kind: 'db-design'` in workspace artifact schema.
- `suggestedOwner: 'db-design'` if the enum is touched by the schema split.
- `dbDesignDdl` naming in specification document context.

Do not delete in Phase 1:

- `api/modules/dbDesign/*` generator and routes. Phase 3 owns this.
- `src/modules/blueprint-preview/BlueprintDbDesignPanel.tsx`. Phase 4 owns UI replacement.
- `blueprint-db-design` persisted metadata read support. Phase 1 must map it to Data Model.
- old route paths if deleting them would force Phase 3/4 implementation before the model is stable.

## Verification

Run focused checks after implementation:

```bash
bunx vitest run tests/routes.settings-general.test.ts tests/plan-artifact-visibility.test.ts tests/artifact-workspace-viewer.test.ts tests/services.spec-document-renderer.test.ts tests/specification-status-view.test.tsx
```

Run a type/build gate appropriate to the touched surface:

```bash
bun run typecheck
```

If the repo does not have `typecheck`, use the repo-native verify gate:

```bash
bun run verify
```

Always run:

```bash
git diff --check
```

Text audit:

```bash
rg -n "BlueprintSpecificationWorkspace|blueprintSpecificationWorkspaceSchema|dbDesignArtifacts|kind: 'db-design'|dbDesignDdl|DB Design" api src shared tests
```

Expected result:

- No canonical type or read model uses `BlueprintSpecificationWorkspace`.
- No API/UI read model field is named `dbDesignArtifacts`.
- Old persisted metadata support is isolated to classification code with a comment or narrow helper.
- Focused tests pass.
- `git diff --check` passes.

Failure handling:

- If a generator or UI route blocks compilation, apply the smallest naming/type update needed and leave behavior changes to Phase 3 or Phase 4.
- If text audit finds old names in persisted metadata compatibility code, keep only if the code maps old metadata into new `data_model` output.
- If a test failure reveals hidden old behavior, decide whether it is artifact model scope. If yes, fix in Phase 1. If it is generator/UI behavior, add a note to the relevant phase and keep Phase 1 focused.

## Completion Criteria

Phase 1 is complete when:

1. Plan mode artifact vocabulary is defined in shared schema/type code.
2. Settings capability no longer contains `dbDesign` or `specification`.
3. Runtime snapshot uses the new capability vocabulary.
4. Workspace read model exposes Feature Plan and Data Model using new names.
5. Old DB Design persisted messages are read as Data Model artifacts.
6. Focused tests pass or any pre-existing unrelated failure is documented.
7. `git diff --check` passes.
