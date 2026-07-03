# Mock Blueprint Recovery Implementation Plan

## Goal

Mock Blueprint generation must produce LLM-built JSON and show the resulting Blueprint Mockup UI as the primary artifact. The normal path must not show the Markdown summary, Spec prose, or `No Blueprint artifact.` in place of the mockup.

This document is the executable implementation plan. Use it together with:

- [Mock Blueprint JSON Contract](./mock-blueprint-json-contract.md)
- [Mock Blueprint Verification Checklist](./mock-blueprint-verification-checklist.md)

## Current Starting Point

Relevant implementation already exists but is incomplete:

- `api/modules/blueprint/blueprint-generation.service.ts`
  - `generateBlueprintArtifact` calls `generatePlanModeMockBlueprintDraft`.
  - It still uses `featurePlanSummary` naming and passes up to 4,000 chars of prior spec content.
- `api/services/blueprints/mock-llm-draft.ts`
  - Parses and normalizes LLM JSON.
  - Does not yet guarantee root `meta`.
  - Does not yet guarantee minimum dataset sizes.
- `api/services/structured-generation/prompts/mock-blueprint.ts`
  - Builds prompt and provider schema.
  - Provider schema does not include `meta`.
  - Prompt still contains too much steering and some BBS-specific language.
- `shared/schemas/mock-blueprint.schema.ts`
  - Runtime schema exists.
  - It does not yet include root `meta`.
  - Dataset minimums are too weak for mockup review.
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
  - `WorkspaceBlueprintPreview` only reads message metadata and falls back to Markdown.
- `src/modules/nightworkers/components/ArtifactPane.tsx`
  - Artifact row versions can lose message metadata.
- `src/modules/nightworkers/components/ArtifactPaneContentViewers.tsx`
  - Mock preview conversion failure falls back to Markdown.
- `src/modules/blueprint-preview/ArtifactBlueprintViewers.tsx`
  - Token usage display exists.
  - Meta debug UI is not present.
- `src/modules/blueprint-preview/mockBlueprintAdapter.ts`
  - Converts Mock Blueprint to `BlueprintPreview` shape.
  - It does not carry root `meta`.

## Hard Requirements

- Keep LLM JSON generation. Do not replace it with Markdown-only generation or template-only generation.
- The first displayed artifact for a successful Mock Blueprint must be the mockup UI.
- Meta is debug-only. It must not become a Markdown document or primary content.
- LLM chooses sections. Do not hardcode BBS or other domains in application code.
- General prompt guidance may discourage analytics/dashboard sections unless the request is actually analytical.
- Table-like mock data must be realistic enough for review. `DataTableSection` requires at least 5 rows.
- Placeholder sidebars are forbidden. Sidebar regions only appear when a real sidebar section was selected.
- UI text must use `Spec` / `仕様書`, not user-visible `Feature Plan`.

## Phase 0: Pre-Implementation Baseline

Do this before editing.

```bash
git status --short
git log --oneline -3
bunx vitest run tests/mock-blueprint.test.ts tests/artifact-workspace-viewer.test.ts
```

Also inspect the latest runtime rows when reproducing a UI issue:

```bash
sqlite3 -json sqlite.db "
select
  id,
  task_id as taskId,
  json_extract(metadata_json,'$.intent') as intent,
  json_type(metadata_json,'$.mockBlueprint') as mockBlueprintType,
  json_extract(metadata_json,'$.artifactRef.artifactId') as artifactId,
  substr(content,1,120) as contentStart,
  created_at as createdAt
from task_messages
where json_extract(metadata_json,'$.intent')='mock_blueprint'
order by created_at desc
limit 5;
"
```

Stop condition:

- If focused tests fail before edits, record the failure in the implementation notes and only continue if the failure is unrelated to Mock Blueprint.

## Phase 1: Restore Preview-First Rendering

This phase comes before prompt/schema quality work. The UI must correctly render already persisted Mock Blueprint JSON.

### 1.1 `WorkspaceBlueprintPreview`

File:

- `src/modules/planMode/PlanModeWorkspacePanels.tsx`

Change:

- Extend `WorkspaceBlueprintPreview` to accept `activityArtifacts?: ActivityArtifact[]`.
- Resolve the preview payload in this order:
  1. `message.metadataJson.mockBlueprint`
  2. linked activity artifact `metadataJson.mockBlueprint`
  3. linked activity artifact `contentText` parsed as JSON
  4. latest `app_blueprint` activity artifact for the task if `message` is null
  5. `message.metadataJson.appBlueprint` for legacy AppBlueprint
- Add small helpers:
  - `previewBlueprintFromSources`
  - `findMessageActivityArtifact`
  - `latestBlueprintActivityArtifact`
  - `parseJsonRecord`
  - `isMockBlueprintCandidate`
- For Mock Blueprint candidates, do not fall back to rendering `message.content` as Markdown when preview conversion fails. Show a minimal preview-unavailable state so the failure is visible.

Update caller:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
  - Pass `activityArtifacts={activityArtifacts}` to `WorkspaceBlueprintPreview`.

Tests:

- `tests/artifact-workspace-viewer.test.ts`
  - Mock Blueprint with `metadata.mockBlueprint` renders `data-blueprint-preview="true"`.
  - Mock Blueprint with only `artifactRef` renders from linked activity artifact.
  - `message=null` with an activity artifact still renders preview.
  - Rendered output does not contain `No Blueprint artifact.`.
  - Rendered output does not contain `Mock Blueprint Summary`.

### 1.2 Artifact Pane Metadata Preservation

Files:

- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/ArtifactPaneContentViewers.tsx`

Change:

- In `ArtifactPane`, when the selected version is an activity artifact row, merge metadata sources in this order:
  1. `displayArtifact.metadata`
  2. `selectedArtifact.metadata`
  3. `selectedActivityArtifact.metadataJson`
  4. parsed `selectedActivityArtifact.contentText`
- Pass `mockBlueprint` to `BlueprintViewer` if any source identifies the artifact as `mock_blueprint`.
- In `BlueprintViewer`, if `mockBlueprint` exists but `mockBlueprintToPreviewBlueprintSafely` returns null, do not render Markdown content as if it were the artifact. Show a clear conversion failure state.

Tests:

- Add an artifact-pane focused test if a harness exists.
- Otherwise extend `tests/artifact-workspace-viewer.test.ts` to cover selector + viewer behavior.

### 1.3 Latest Selection With Numeric Timestamps

Files:

- `src/modules/nightworkers/workbenchSelectorUtils.ts`
- `src/modules/specification/planModeWorkspaceModel.ts`

Change:

- Update `toMs` so numeric seconds and numeric strings are treated as Unix seconds when below millisecond range.
- Select active blueprint/data model messages by latest `createdAt`, not array tail.

Tests:

- `tests/artifact-workspace-viewer.test.ts`
  - Newer Mock Blueprint with numeric `createdAt` is selected even if array order is older/newer mixed.

Stop condition:

- Do not proceed to prompt/schema edits until an existing persisted Mock Blueprint can render as `data-blueprint-preview="true"` in a server-rendered test.

## Phase 2: Add Root Meta Without Making It Primary UI

### 2.1 Runtime Schema

File:

- `shared/schemas/mock-blueprint.schema.ts`

Change:

- Add `mockBlueprintMetaSchema`.
- Add required root `meta` to `mockBlueprintSchema`.
- `meta.selectedSections[].sectionType` must use `renderableMockBlueprintSectionNameSchema`.
- Keep `generationNotes` as non-primary auxiliary data.

Implementation detail:

```ts
export const mockBlueprintMetaSchema = z.object({
  intent: z.string().min(1),
  selectedSections: z.array(
    z.object({
      sectionType: renderableMockBlueprintSectionNameSchema,
      selectionReason: z.string().min(1),
    }).strict()
  ).min(1),
}).strict();
```

Tests:

- `tests/mock-blueprint.test.ts`
  - Representative fixture includes `meta`.
  - Runtime schema rejects missing `meta`.
  - `selectedSections` contains the same section types generated in screens.

### 2.2 Provider Schema

File:

- `api/services/structured-generation/prompts/mock-blueprint.ts`

Change:

- Add `meta` to `buildMockBlueprintStructuredOutputJsonSchema`.
- Include `meta` in root `required`.
- Include all nested `properties` keys in nested `required` arrays for strict response format compatibility.
- Keep provider schema compact. Do not add full renderer props.

Tests:

- `tests/mock-blueprint.test.ts`
  - Provider schema root required includes `meta`.
  - Nested `meta.selectedSections.items.required` includes `sectionType` and `selectionReason`.
  - Schema byte size remains under the agreed threshold.

### 2.3 Normalizer

File:

- `api/services/blueprints/mock-llm-draft.ts`

Change:

- Add `normalizeMockBlueprintMeta`.
- If LLM omits `meta`, derive it from selected sections:
  - `intent`: from `summary`, `name`, or task title fallback.
  - `selectedSections`: flatten all `screens[].sections[]` and map `componentName` + `selectionReason`.
- Run this before final `mockBlueprintSchema.safeParse`.

Tests:

- Fixture output without `meta` is repaired into valid Mock Blueprint.
- Repaired `meta.selectedSections` mirrors selected sections.

### 2.4 Debug UI

File:

- `src/modules/blueprint-preview/mockBlueprintAdapter.ts`
- `src/modules/blueprint-preview/ArtifactBlueprintViewers.tsx`

Change:

- Carry `meta` from Mock Blueprint into preview blueprint.
- Add a small `Meta` button/details in `BlueprintArtifactViewer`.
- Default state closed.
- When open, show only:
  - `intent`
  - `selectedSections[].sectionType`
  - `selectedSections[].selectionReason`
- Do not add generated explanatory prose.

Tests:

- Server-rendered artifact viewer does not show meta text by default.
- The data object passed to the meta view contains only the defined meta fields.

## Phase 3: Prompt And Input Budget Reduction

### 3.1 Rename Spec Context Internally

File:

- `api/modules/blueprint/blueprint-generation.service.ts`

Change:

- Rename `featurePlanSummary` to `specContext`.
- Rename `resolveLatestFeaturePlanSummary` to `resolveLatestSpecContext`.
- Keep metadata intent lookup as needed for current DB compatibility, but do not expose `Feature Plan` wording in user-facing UI/prompt.

`resolveLatestSpecContext` must:

- Read latest markdown document with spec intent.
- Return a compact excerpt only.
- Avoid keyword-based domain classification.
- Cap size to a small fixed limit, for example 1,200-1,800 chars.

Do not pass entire Spec content to Mock Blueprint generation.

### 3.2 Prompt Inputs

Files:

- `api/services/blueprints/mock-llm-draft.ts`
- `api/services/structured-generation/prompts/mock-blueprint.ts`

Change:

- Rename input field from `featurePlanSummary` to `specContext`.
- `buildMockBlueprintUserPrompt` should include only:
  - task id/title/description/objective
  - compact questionnaire answer text
  - compact Spec constraints
  - direct user prompt / output focus
- Keep prompt instructions Japanese.
- Remove BBS-specific prompt lines.
- Replace domain-specific examples with general rules:
  - Analytics/chart sections only for analysis/KPI/reporting/monitoring requests.
  - CRUD/list workflows usually need list + create/edit.
  - Conversation/post workflows often need list/detail/compose, but this is guidance, not hardcoding.

### 3.3 Diagnostics

File:

- `api/services/structured-generation/prompts/mock-blueprint.ts`

Change:

- Add estimated token diagnostics if not already present:
  - `systemPromptEstimatedTokens`
  - `userPromptEstimatedTokens`
  - `totalPromptEstimatedTokens`
- Keep `systemPromptBytes`, `userPromptBytes`, `schemaDigest`.

Tests:

- Prompt byte size below threshold.
- Prompt does not contain BBS-specific terms.
- Prompt contains general analytics gating guidance.
- Prompt diagnostics include token estimates.

Stop condition:

- Do not continue if normal prompt construction still approaches tens of thousands of tokens.

## Phase 4: Dataset Quality Normalization

Files:

- `shared/schemas/mock-blueprint.schema.ts`
- `api/services/blueprints/mock-llm-draft.ts`

Change runtime minimums:

- `table.columns`: min 2
- `table.rows`: min 5
- `form.fields`: min 2
- `navigation.items`: min 2
- `cards.cards`: min 2
- `timeline.items`: min 2
- `chat.messages`: min 2
- `metrics.metrics`: min 2

Change normalizer:

- After `normalizeMockBlueprintDataset`, ensure each dataset kind meets minimums before final schema validation.
- Fallback data must be generic and derived from section/copy when possible.
- Do not hardcode BBS rows.
- For tables, create columns and rows that use stable keys and theme-neutral labels if the LLM returned nothing.

Tests:

- Fixture with empty arrays is repaired and validates.
- `DataTableSection` returns exactly or at least 5 rows after repair.
- Empty navigation/form/cards/timeline/chat datasets are repaired.

## Phase 5: Section Selection Guardrails

Files:

- `api/services/structured-generation/prompts/mock-blueprint.ts`
- `tests/mock-blueprint.test.ts`

Change:

- Keep the section catalog compact.
- Keep LLM as the decision maker.
- Add general prompt rules:
  - Select sections by product fit.
  - Do not add dashboard/analytics just to fill space.
  - Do not use sidebars unless persistent navigation or related links are genuinely needed.
  - Do not use ads/sponsored/newsletter placeholders unless requested.
  - Do not render Spec, review notes, implementation tasks, or progress logs as product UI.

Tests:

- Prompt does not contain hardcoded BBS screen plans.
- Prompt does contain general analytics gating guidance.
- Prompt contains sidebar placeholder prohibition.

## Phase 6: Usage Display

Files:

- `api/modules/blueprint/blueprint-generation.service.ts`
- `src/modules/blueprint-preview/ArtifactBlueprintViewers.tsx`

Change:

- Preserve `generation.llmUsage`.
- Continue displaying input/output/total tokens.
- Keep usage display secondary to preview.

Tests:

- Artifact viewer renders token usage when generation metadata includes usage.
- No usage block is rendered when usage is absent.

## Final Verification

Run focused tests:

```bash
bunx vitest run tests/mock-blueprint.test.ts tests/artifact-workspace-viewer.test.ts tests/nightworkers.workbench-selectors.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
```

Run repo gates:

```bash
bun run lint
bun run typecheck
bun run verify
```

Manual smoke check:

1. Generate a Mock Blueprint for a simple BBS request.
2. Open the Blueprint tab.
3. Confirm the mockup UI is first.
4. Confirm Markdown summary is not the primary display.
5. Confirm DataTable rows are sufficient if a table is selected.
6. Confirm AnalyticsDashboardSection is not selected unless the prompt asks for analytics/reporting.
7. Confirm Meta is closed by default and usage is visible as secondary info.

## Definition Of Done

- All acceptance criteria in the verification checklist pass.
- The implementation does not introduce user-visible `Feature Plan` wording in this workflow.
- The implementation does not add keyword/regex routing for user domains.
- The implementation keeps provider calls, JSON extraction, schema validation, and minimal normalization in provider/blueprint services.
- `bun run verify` passes.
