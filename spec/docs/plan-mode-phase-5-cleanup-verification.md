# Plan Mode Phase 5: Cleanup / Verification Hardening

## Purpose

Plan mode replacement の最後に、旧方式の残骸を削除し、新 Feature Plan + dedicated design view 方式だけが runtime に残っていることを repo-wide に確認する。

このフェーズは互換移行ではない。旧方式を動かし続けるための fallback、feature flag、`v1` / `v2` 命名、並行 artifact kind は作らない。

Phase 5 の完了判定は「実装できた気がする」ではなく、旧名監査、boundary test、focused tests、build / verify gate が通った状態で行う。

## Inputs

- [Plan Mode Concept](./plan-mode-concept.md)
- [Phase 1: Artifact Model Replacement](./plan-mode-phase-1-artifact-model-replacement.md)
- [Phase 2: Supervisor Flow Replacement](./plan-mode-phase-2-supervisor-flow-replacement.md)
- [Phase 3: Dedicated View Generators](./plan-mode-phase-3-dedicated-view-generators.md)
- [Phase 4: UI / Artifact UX Replacement](./plan-mode-phase-4-ui-artifact-ux-replacement.md)
- Existing `bun run verify` gate
- Existing Plan mode boundary tests
- Existing supervisor / route / UI tests

## Phase Boundary

In scope:

- Phase 1-4 で置換済みの legacy code、legacy type、legacy route、legacy prompt、legacy UI label、legacy fixture を削除する。
- Plan mode artifact model が `feature_plan` primary に統一されていることを repo-wide に検証する。
- `data_model` が旧 `DB Design` の代替ではなく、現在の canonical data structure view になっていることを検証する。
- `verification_matrix`、`ui_specification`、`design_view_references` が独立 artifact / view として残っていないことを検証する。
- `questionnaire`、`blueprint`、`data_model`、additional dedicated views の include / omit behavior をテストで固定する。
- Usecase 図と AI Coding Rules が Plan mode artifact / prompt / UI に出ないことを検証する。
- `bun run verify` まで通す。

Out of scope:

- 新しい dedicated view の追加。
- UI の追加改善。
- Prompt の品質改善。
- Data Model schema の拡張。
- Blueprint preview showcase の unrelated cleanup。
- contextStill ルールの変更。
- Desktop packaging 由来の unrelated failure 修正。ただし failure が Plan mode replacement 由来ならこのフェーズで修正する。

## Current Verification Surface

Repo scripts:

| Command | What it covers | Phase 5 use |
| --- | --- | --- |
| `bun run verify:base` | tracked artifact check, typecheck, lint, supervisor regression tests | 早い repo gate |
| `bun run verify` | `verify:base` + desktop runtime tests + desktop lint + desktop build | 最終 gate |
| `bun run verify:full` | `verify` + all Vitest tests | 必要に応じた最大 gate |
| `bun run typecheck` | TypeScript compile safety | rename / delete 後の最初の gate |
| `bun run build` | frontend + backend build | UI / API route 削除後の build gate |
| `git diff --check` | whitespace / conflict marker | 各 step 後と最後 |

Existing high-value tests:

| Test file | Current coverage | Phase 5 action |
| --- | --- | --- |
| `tests/plan-mode-domain-boundary.test.ts` | Plan mode ownership / old route markers | New model boundary test に更新し、legacy route / type を禁止する |
| `tests/services.supervisor.test.ts` | Supervisor behavior | Round 1 / Plan mode routing の旧 artifact 名禁止を固定する |
| `tests/services.supervisor-skills.test.ts` | Skill reference loading / routing references | Blueprint / Data Model reference 境界を固定する |
| `tests/services.supervisor-prompt-packet.test.ts` | Prompt packet rendering | Feature Plan wording / no AI Coding Rules を固定する |
| `tests/artifact-workspace-viewer.test.ts` | Plan workspace viewer / message classification | `plan_mode_workspace` / Feature Plan primary / Data Model classification に更新する |
| `tests/specification-status-view.test.tsx` | Status flow UI | `PlanWorkspaceStatusView` と include / omit flow に更新する |
| `tests/nightworkers.workbench-selectors.test.ts` | Artifact refs / workbench state | `plan_mode_workspace` と dedicated view refs を固定する |
| `tests/routes.settings-general.test.ts` | Settings API | Plan mode capability schema を固定する |
| `tests/services.general-settings.test.ts` | Settings normalization | legacy `dbDesign` fallback 削除を固定する |

## Legacy Inventory

Phase 5 の実装開始前に、次の legacy surface が残っていないか確認する。

### Runtime names

Must be removed from `api/`, `src/`, `shared/`, `tests/` current runtime:

- `dbDesign`
- `db-design`
- `DB Design`
- `db_design`
- `blueprint-db-design`
- `blueprint-db-design-request`
- `blueprint-db-design-adoption`
- `specification-workspace/db-design`
- `blueprint_workspace`
- `Specification Workspace`
- `WorkspaceDbDesignPanel`
- `SpecificationStatusView`
- `BlueprintDbDesignPanel` from Plan workspace path
- `dbDesignHandoffNotes`
- `dbDesignWorkflowOnly`

### Artifact / route / prompt names

Must not be emitted by current code:

- `intent: 'draft_spec'` as primary Plan artifact
- `intent: 'implementation_plan'` as Plan mode primary artifact
- `artifactType: 'blueprint_db_design'`
- `source: 'blueprint-db-design'`
- `metadata.dbDesignTarget`
- `/api/tasks/:id/specification-workspace/db-design`
- `/api/tasks/:id/blueprint-db-design-adoption`

### Concept names

Must not exist as current artifact/view:

- `verification_matrix`
- `ui_specification`
- `design_view_references`
- `open_questions` as Feature Plan top-level artifact
- `db_design`
- Usecase / usecase diagram
- AI Coding Rules

Allowed only in:

- This phase documentation while describing legacy deletion.
- Previous phase implementation plans where the text is clearly marked as old input or replacement target.
- A small legacy input normalization test, if and only if runtime still needs to read an old persisted value without emitting it again.

## Target Final Names

After cleanup, current runtime vocabulary is:

- Primary artifact: `feature_plan`
- Workspace artifact kind: `plan_mode_workspace`
- Core dedicated views:
  - `questionnaire`
  - `blueprint`
  - `data_model`
- Additional dedicated views:
  - `api_io_contract`
  - `state_model`
  - `activity_flow`
  - `sequence_flow`
  - `zod_schema_design`
- Feature Plan section:
  - `verification`
- Questionnaire-owned sections:
  - `open_questions`
  - `assumptions`
- Blueprint-owned section:
  - UI specification and design view references

## Implementation Steps

### Step 0. Capture Baseline

Before edits, capture the current legacy surface and failing / passing gates.

Commands:

```bash
rg -n "dbDesign|db-design|DB Design|db_design|blueprint-db-design|blueprint_workspace|Specification Workspace|specification-workspace/db-design|verification_matrix|ui_specification|design_view_references|Usecase|usecase|AI Coding Rules" api src shared tests spec/docs
bunx vitest run tests/plan-mode-domain-boundary.test.ts
bun run typecheck
git diff --check
```

Expected result:

- Search output is used as a deletion checklist.
- Boundary failures identify exactly which old concepts are still canonical.
- Existing unrelated dirty worktree is not reverted.

### Step 1. Delete Legacy API / Service Surface

Target files:

- `api/app.ts`
- `api/modules/dbDesign/*`
- `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/nightworkers.workbench-routing.ts`
- `api/modules/specification/specification-route-definitions.ts`
- `api/modules/specification/specification.routes.ts`
- `api/modules/specification/specification.service.ts`
- `api/modules/specification/specification-workspace.service.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/blueprint/blueprint-route-definitions.ts`
- `api/modules/blueprint/blueprint-generation.service.ts`

Required actions:

- Delete `api/modules/dbDesign/*` if Phase 3 replacement is complete.
- Remove `dbDesignRouter` mount.
- Remove `/specification-workspace/db-design`.
- Remove `/blueprint-db-design-adoption`.
- Remove current runtime usage of `getSpecificationWorkspace` if `getPlanModeWorkspace` replaces it.
- Ensure Feature Plan generation route emits new path / metadata only.
- Ensure Data Model generation route emits `view: 'data_model'` and `source: 'data-model'`.

Acceptance:

- `api/` does not emit DB Design route names.
- `api/` does not emit `draft_spec` as primary Plan mode artifact.
- Data Model API path and metadata are the only data-structure generation path.

### Step 2. Delete Legacy Schema / Settings Compatibility

Target files:

- `shared/schemas/design-questionnaire.schema.ts`
- `shared/schemas/plan-mode-artifact.schema.ts`
- `api/services/settings/general-settings.ts`
- `api/routes/settings-route-definitions.ts`
- `src/modules/nightworkers/types/overview.ts`
- `src/modules/nightworkers/types/blueprint.ts`

Required actions:

- Remove public `dbDesignHandoffNotes`; emit `dataModelHandoffNotes`.
- Remove public `dbDesign` capability fallback after migration tests are updated.
- Remove old `specification` capability fallback after `feature_plan` is canonical.
- Confirm `PlanModeCapability` equals the final capability list.
- Confirm workspace schema has:
  - `featurePlanArtifacts`
  - `blueprintArtifacts`
  - `dataModelArtifacts`
  - `dedicatedViewArtifacts`
  - `questionnaireSessions`
  - `decisionReviews`
  - `implementationReferences`
- Confirm workspace schema does not have:
  - `dbDesignArtifacts`
  - `specificationArtifacts`
  - `verificationMatrixArtifacts`

Acceptance:

- Settings normalization no longer silently reintroduces old names.
- Shared schemas expose only new Plan mode names.

### Step 3. Delete Legacy Prompt / Reference Wording

Target files:

- `api/services/supervisor/skills/builtin/references/modes/planning.md`
- `api/services/supervisor/skills/builtin/references/phases/plan.md`
- `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`
- `api/services/supervisor/prompt-tool-registry.ts`
- `api/services/structured-generation/prompts/app-blueprint.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `api/services/structured-generation/prompts/data-model.ts`
- `api/services/structured-generation/prompts/plan-dedicated-view.ts`

Required actions:

- Replace `Specification Artifact`, `draft_spec`, and `implementation_plan` primary wording with `Feature Plan`.
- Replace Blueprint reference wording that sends DB/table decisions to `DB Design` with `Data Model`.
- Ensure prompt explicitly excludes:
  - Usecase diagrams
  - AI Coding Rules
  - standalone `verification_matrix`
  - standalone `ui_specification`
- Ensure `read_current_specification` wording either:
  - is renamed in a later tool phase, or
  - clearly says it reads the latest Feature Plan Markdown despite the tool name.

Acceptance:

- Supervisor prompt path cannot ask for old artifact set.
- Blueprint prompt does not make AppBlueprint own data model正本.

### Step 4. Delete Legacy Frontend UI Surface

Target files:

- `src/modules/planMode/*`
- `src/modules/specification/*`
- `src/modules/dbDesign/*`
- `src/modules/blueprint-preview/BlueprintDbDesignPanel.tsx`
- `src/modules/blueprint-preview/dbDesignModel.ts`
- `src/modules/blueprint-preview/index.ts`
- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/nightworkers/types/workbench.ts`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersSessionPresentation.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/ja.ts`

Required actions:

- Remove `src/modules/dbDesign/*`.
- Remove Plan workspace dependency on `BlueprintDbDesignPanel`.
- Remove `blueprint_workspace` and emit `plan_mode_workspace`.
- Remove user-facing `Specification Workspace`.
- Remove `db-design` tab id as emitted state.
- Keep only legacy input normalization if needed:
  - `db-design` -> `data-model`
  - `design-doc` -> `feature-plan`
  - `specification-status` -> `status`
- Rename UI components:
  - `SpecificationStatusView` -> `PlanWorkspaceStatusView`
  - `WorkspaceDbDesignPanel` -> `WorkspaceDataModelPanel`

Acceptance:

- UI runtime does not expose old Plan mode names.
- Data Model panel does not require AppBlueprint.
- Feature Plan is primary workspace display.

### Step 5. Replace Tests And Fixtures

Target tests:

- `tests/plan-mode-domain-boundary.test.ts`
- `tests/services.supervisor.test.ts`
- `tests/services.supervisor-skills.test.ts`
- `tests/services.supervisor-prompt-packet.test.ts`
- `tests/services.blueprints.test.ts`
- `tests/services.design-questionnaire-prompts.test.ts`
- `tests/services.data-model-generation.test.ts`
- `tests/services.plan-view-generators.test.ts`
- `tests/artifact-workspace-viewer.test.ts`
- `tests/specification-status-view.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`
- `tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`
- `tests/nightworkers-workbench-routes/routes-workbench-03.test.ts`
- `tests/routes.settings-general.test.ts`
- `tests/services.general-settings.test.ts`

Required updates:

- Rename tests that say DB Design / Specification Workspace.
- Delete old `services.blueprint-data-design.test.ts` or replace it with Data Model tests.
- Add boundary assertions:
  - No `api/modules/dbDesign` directory.
  - No `src/modules/dbDesign` directory.
  - No `blueprint-db-design` route.
  - No `blueprint_workspace` artifact kind.
  - No public `dbDesignHandoffNotes`.
  - No prompt asks for Usecase.
- Add behavior assertions:
  - Feature Plan is primary artifact.
  - UI-less task can omit Blueprint.
  - Data Model can exist without Blueprint.
  - DB-backed Data Model uses DDL canonical.
  - Non-DB Data Model can render JSON / type / storage contract.
  - Additional dedicated views render as Markdown.
  - Omitted views do not create empty tabs or block implementation.

Acceptance:

- Test names and fixtures describe the new model.
- Legacy test fixtures are explicitly marked as legacy input normalization when retained.

### Step 6. Add Legacy Text Audit Test

Add a focused test or script so Phase 5 cleanup stays enforced.

Recommended file:

```txt
tests/plan-mode-legacy-text-audit.test.ts
```

Test behavior:

- Scan `api/`, `src/`, `shared/`, and `tests/`.
- Ignore:
  - generated snapshots if any
  - explicit legacy normalization test blocks
  - this test file's own forbidden terms table
- Fail on current runtime references to:
  - `blueprint-db-design`
  - `blueprint_workspace`
  - `dbDesign`
  - `DB Design`
  - `specification-workspace/db-design`
  - `verification_matrix`
  - `ui_specification`
  - `design_view_references`
  - `Usecase`
  - `AI Coding Rules`

Acceptance:

- Future regressions are caught by `bun run test`.
- The allowlist is explicit and small.
- The allowlist cannot hide entire directories like `api/` or `src/`.

### Step 7. Documentation Final Pass

Target docs:

- `spec/docs/plan-mode-concept.md`
- `spec/docs/plan-mode-phase-1-artifact-model-replacement.md`
- `spec/docs/plan-mode-phase-2-supervisor-flow-replacement.md`
- `spec/docs/plan-mode-phase-3-dedicated-view-generators.md`
- `spec/docs/plan-mode-phase-4-ui-artifact-ux-replacement.md`
- `spec/docs/plan-mode-phase-5-cleanup-verification.md`
- `spec/docs/first-run-orientation.md`
- Any README or operator docs that mention Plan mode artifacts.

Required actions:

- Concept doc must describe only the final model.
- Phase docs may mention old names only as replacement targets.
- Operator docs must not advertise old UI or old artifact names.
- No doc should imply `questionnaire + blueprint + db design + specification` is always generated.

Acceptance:

- Documentation communicates the final model without v1/v2 coexistence.
- Old names remain only where the text is explicitly about deletion or migration.

### Step 8. Run Focused Verification

Run focused checks in this order:

```bash
bunx vitest run \
  tests/plan-mode-domain-boundary.test.ts \
  tests/services.supervisor.test.ts \
  tests/services.supervisor-skills.test.ts \
  tests/services.supervisor-prompt-packet.test.ts
```

```bash
bunx vitest run \
  tests/services.blueprints.test.ts \
  tests/services.design-questionnaire-prompts.test.ts \
  tests/services.data-model-generation.test.ts \
  tests/services.plan-view-generators.test.ts
```

```bash
bunx vitest run \
  tests/artifact-workspace-viewer.test.ts \
  tests/specification-status-view.test.tsx \
  tests/nightworkers.workbench-selectors.test.ts \
  tests/plan-artifact-visibility.test.ts
```

```bash
bunx vitest run \
  tests/routes.settings-general.test.ts \
  tests/services.general-settings.test.ts \
  tests/plan-mode-legacy-text-audit.test.ts
```

Acceptance:

- Failures are fixed before moving to full gates.
- Any unrelated failure is recorded with exact failing test and reason.

### Step 9. Run Repo Gates

Run in order:

```bash
bun run typecheck
bun run build
git diff --check
bun run verify:base
bun run verify
```

If `bun run verify` fails in desktop-only infrastructure:

- Confirm whether `bun run verify:base` passed.
- Confirm whether the failing desktop task is unrelated to Plan mode.
- Do not mark Phase 5 complete if the failure is caused by Plan mode code, imports, routes, or UI.

Optional maximum gate when time allows:

```bash
bun run verify:full
```

## Text Audit Commands

Runtime audit:

```bash
rg -n "blueprint-db-design|blueprint-db-design-request|blueprint-db-design-adoption|dbDesign|db-design|DB Design|db_design|dbDesignHandoffNotes|dbDesignWorkflowOnly|blueprint_workspace|Specification Workspace|specification-workspace/db-design|verification_matrix|ui_specification|design_view_references|Usecase|usecase|AI Coding Rules" api src shared tests
```

Docs audit:

```bash
rg -n "questionnaire / blueprint / DB design / specification|DB Design|blueprint_workspace|verification_matrix|ui_specification|design_view_references|Usecase|usecase|AI Coding Rules|v1|v2|legacyPlan|newPlan" spec docs README.md
```

Route audit:

```bash
rg -n "specification-workspace|blueprint-specification-workspace|blueprint-db-design-adoption|plan-mode/data-model|plan-mode/views" api src tests
```

Expected result:

- Runtime audit has no unapproved legacy matches.
- Docs audit has matches only in migration/deletion context.
- Route audit shows only current Plan mode routes plus explicitly allowed legacy input normalization if still necessary.

## Completion Criteria

Phase 5 is complete only when all criteria are met:

1. Runtime primary Plan artifact is `feature_plan`.
2. Workbench workspace artifact kind is `plan_mode_workspace`.
3. Old all-artifacts flow is gone.
4. `db_design` / `DB Design` is integrated into `data_model` and not exposed as current runtime.
5. `verification_matrix` is integrated into Feature Plan `verification`.
6. `ui_specification` and `design_view_references` are integrated into `blueprint`.
7. `open_questions` and `assumptions` are owned by `questionnaire`.
8. Usecase diagrams are not generated, rendered, or offered.
9. AI Coding Rules are not generated by Plan mode.
10. UI-less tasks are not forced through Blueprint.
11. Data Model can be generated and displayed without Blueprint.
12. Legacy text audit is enforced by test or script.
13. Focused tests pass.
14. `bun run verify` passes, or a non-Plan-mode desktop-only failure is explicitly documented after `verify:base` passes.
15. `git diff --check` passes.

## Stop Conditions

Stop and fix the earlier phase instead of papering over if any of these happen:

- Phase 1 schema still requires old artifact fields.
- Phase 2 routing still selects old artifact names.
- Phase 3 generator still emits AppBlueprint-shaped Data Model as canonical output.
- Phase 4 UI still needs `blueprint_workspace` to open Plan mode.
- Removing a legacy route breaks an active current route because the replacement route was not implemented.
- Text audit requires a broad allowlist to pass.
- `verify` failure is caused by Plan mode imports, route definitions, schemas, or UI.

Do not add compatibility flags or `v2` suffixes to bypass these stop conditions. Fix the canonical model.
