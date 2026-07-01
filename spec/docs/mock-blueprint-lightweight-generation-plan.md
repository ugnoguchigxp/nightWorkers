# Mock Blueprint Lightweight Generation Plan

## Purpose

Blueprint 作成を、重い `AppBlueprint` 一括生成から、LLM が Section 選択と Mock 用データセットを JSON として構築する軽量な `MockBlueprint` 方式へ移行する。

この変更では LLM による JSON 構築を維持する。LLM は、依頼テーマに合った Section、見出し、説明、ラベル、サンプル行、カード、カラム、状態文言、空状態文言を生成する。軽量化は、巨大な AppBlueprint schema、Supervisor reference、database/data binding/implementation task を通常の Mock 表示経路から外すことで達成する。

## Non-Goals

- `AppBlueprint` の削除。
- Blueprint Preview renderer の見た目の全面再設計。
- LLM なしの template-only 生成を primary path にすること。
- DB / API / Zod / implementation task / learning hook を Mock Blueprint で生成すること。
- keyword / regex による user wording 分類。
- legacy artifact の一括 migration。

## Current Baseline

Current normal Blueprint generation:

1. `api/modules/blueprint/blueprint-generation.service.ts` の `generateBlueprintArtifact` が呼ばれる。
2. `api/services/blueprints/llm-draft.ts` の `generatePlanModeBlueprintDraft` が full AppBlueprint prompt を作る。
3. `api/services/structured-generation/prompts/app-blueprint.ts` が full AppBlueprint JSON schema、catalog、Supervisor reference を system prompt に入れる。
4. LLM は `app_blueprint` JSON を生成する。
5. `createBlueprintActivityArtifact` と `createPlanModeTaskMessage` が `intent: 'app_blueprint'` を保存する。

Observed production-like baseline:

- `app_blueprint` request input is roughly 95k tokens.
- Real provider latency is roughly 65-92 seconds.
- API duration closely matches LLM duration.

Before implementation, capture local baseline:

```bash
bunx vitest run tests/services.blueprints.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
sqlite3 sqlite.db "select created_at, task_id, provider, model, label, input_tokens, cached_input_tokens, output_tokens, total_tokens, duration_ms from llm_usage_records where label='app_blueprint' order by created_at desc limit 5;"
```

Expected result:

- Existing failures are known before editing.
- Current usage rows are available for before/after comparison.

Failure handling:

- If the focused baseline tests fail before edits, record the failure and continue only with tests that cover touched behavior.

## Target Runtime Shape

Keep the public route stable:

- Existing client command `generateBlueprintArtifact(sessionId, input)` continues to call `POST /api/tasks/:id/plan-mode/blueprint`.
- The route continues to return `{ message, workspace }`.
- The default implementation behind the route switches from full AppBlueprint generation to MockBlueprint generation.

New default generation path:

1. `generateBlueprintArtifact` loads task and optional questionnaire as it does today.
2. It builds a compact MockBlueprint user prompt from task, questionnaire, and latest Feature Plan summary when available.
3. `generatePlanModeMockBlueprintDraft` calls `callStructuredJsonLLM` with `schemaName: 'mock_blueprint'`, `role: 'plan'`, and a compact JSON schema.
4. The returned JSON is parsed and validated as `MockBlueprint`.
5. The server persists a `mock_blueprint` activity artifact and a `markdown_document` task message.
6. Workspace and artifact selectors treat `mock_blueprint` as a Blueprint artifact.
7. UI converts `MockBlueprint` into the existing `BlueprintPreview` screen/section shape through a deterministic adapter.

Do not add `mock_blueprint` to `CODEX_PROMPT_VALIDATED_SCHEMA_NAMES`. The compact schema should be small enough to use provider structured output.

## Target JSON Contract

Add `shared/schemas/mock-blueprint.schema.ts`.

Export:

```ts
export const renderableMockBlueprintSectionNameSchema = z.enum([...]);
export const mockBlueprintDatasetSchema = z.discriminatedUnion('kind', [...]);
export const mockBlueprintSectionSchema = z.object({ ... });
export const mockBlueprintScreenSchema = z.object({ ... });
export const mockBlueprintSchema = z.object({ ... });

export type RenderableMockBlueprintSectionName = z.infer<typeof renderableMockBlueprintSectionNameSchema>;
export type MockBlueprintDataset = z.infer<typeof mockBlueprintDatasetSchema>;
export type MockBlueprintSection = z.infer<typeof mockBlueprintSectionSchema>;
export type MockBlueprintScreen = z.infer<typeof mockBlueprintScreenSchema>;
export type MockBlueprint = z.infer<typeof mockBlueprintSchema>;
```

Root shape:

```ts
type MockBlueprint = {
  artifactKind: 'mock_blueprint';
  id: string;
  name: string;
  version: 1;
  summary: string;
  tone: string;
  screens: MockBlueprintScreen[];
  generationNotes: string[];
};
```

Screen shape:

```ts
type MockBlueprintScreen = {
  id: string;
  name: string;
  path: string;
  purpose: string;
  layout: {
    template:
      | 'single_column'
      | 'two_column'
      | 'three_column'
      | 'sidebar_left'
      | 'sidebar_right'
      | 'article_with_sidebar';
  };
  sections: MockBlueprintSection[];
};
```

Section shape:

```ts
type MockBlueprintSection = {
  id: string;
  name: string;
  componentName: RenderableMockBlueprintSectionName;
  region?: 'header' | 'main' | 'sidebar' | 'aside' | 'full_width' | 'footer';
  selectionReason: string;
  copy: {
    title: string;
    description?: string;
    primaryActionLabel?: string;
    secondaryActionLabel?: string;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
  };
  dataset: MockBlueprintDataset;
};
```

Validation rules:

- `id`, screen id, and section id follow `^[a-z][a-z0-9-]*$`.
- `screens` has 1-3 items unless a later implementation explicitly raises the cap.
- Each screen has 1-6 sections.
- `componentName` must be in `renderableMockBlueprintSectionNameSchema`.
- Dataset kind must be compatible with `componentName`.
- Unknown fields are rejected. Use strict zod objects.

## Section Allowlist

Create the allowlist once in `shared/schemas/mock-blueprint.schema.ts` and reuse it in the prompt builder. Do not hand-maintain separate server and client lists.

Initial allowlist must match currently renderable Blueprint Preview sections:

```ts
const renderableMockBlueprintSectionNames = [
  'AccordionSection',
  'AnalyticsDashboardSection',
  'BlogPostSection',
  'CalendarSection',
  'CardGridSection',
  'CarouselSection',
  'ChartSection',
  'ChatPanelSection',
  'CheckoutSummarySection',
  'CodeEditorSection',
  'ComparisonSection',
  'ControlPanelSection',
  'DataTableSection',
  'EmailInboxSection',
  'ExplorerSidebarSection',
  'FooterNavigationSection',
  'FormSection',
  'FullBleedHeroSection',
  'ImageSection',
  'KanbanSection',
  'LeftSidebarSection',
  'MapSection',
  'MediaTextSection',
  'NotificationCenterSection',
  'PaymentFormSection',
  'RightSidebarLinksSection',
  'ScheduleSection',
  'SidebarMenuSection',
  'SplitHeroSection',
  'TabNavigationSection',
  'TimelineSection',
  'TopMenuSection',
  'VideoSection',
] as const;
```

Prompt descriptions must be compact. Example:

```txt
DataTableSection: records, CRUD lists, sorting, comparison.
FormSection: create/edit input flow.
KanbanSection: board workflow and status columns.
CardGridSection: browseable cards, templates, rich summaries.
```

Do not include full renderer code or full prop schemas in the prompt.

## Dataset Contract

Dataset kinds:

```ts
type MockBlueprintDataset =
  | { kind: 'navigation'; items: Array<{ label: string; href?: string; active?: boolean }> }
  | { kind: 'table'; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string>> }
  | { kind: 'form'; fields: Array<{ name: string; label: string; type: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number'; placeholder?: string; options?: string[] }>; submitLabel: string }
  | { kind: 'cards'; cards: Array<{ title: string; description: string; meta?: string; actionLabel?: string }> }
  | { kind: 'kanban'; columns: Array<{ id: string; title: string; cards: Array<{ title: string; description: string; meta?: string }> }> }
  | { kind: 'timeline'; items: Array<{ title: string; description: string; timestamp?: string }> }
  | { kind: 'article'; title: string; body: string; meta?: Array<{ label: string; value: string }> }
  | { kind: 'metrics'; metrics: Array<{ label: string; value: string; trend?: string }> }
  | { kind: 'media'; items: Array<{ title: string; description: string; mediaLabel?: string }> }
  | { kind: 'map'; points: Array<{ label: string; description: string; region?: string }> }
  | { kind: 'code'; files: Array<{ path: string; language: string; excerpt: string }> }
  | { kind: 'chat'; messages: Array<{ author: string; body: string; state?: string }> }
  | { kind: 'generic'; items: Array<{ title: string; description: string }> };
```

Compatibility matrix:

| Component | Allowed dataset kinds |
| --- | --- |
| `TopMenuSection`, `TabNavigationSection`, `SidebarMenuSection`, `LeftSidebarSection`, `RightSidebarLinksSection`, `FooterNavigationSection`, `ExplorerSidebarSection` | `navigation`, `generic` |
| `DataTableSection`, `EmailInboxSection` | `table` |
| `FormSection`, `PaymentFormSection` | `form` |
| `CardGridSection`, `AccordionSection`, `ComparisonSection`, `ControlPanelSection`, `CheckoutSummarySection`, `NotificationCenterSection` | `cards`, `generic`, `metrics` |
| `KanbanSection` | `kanban` |
| `TimelineSection`, `ScheduleSection`, `CalendarSection` | `timeline`, `generic` |
| `BlogPostSection` | `article` |
| `MediaTextSection`, `ImageSection`, `VideoSection`, `CarouselSection`, `SplitHeroSection`, `FullBleedHeroSection` | `media`, `article`, `cards` |
| `ChartSection`, `AnalyticsDashboardSection` | `metrics`, `table` |
| `MapSection` | `map`, `generic` |
| `ChatPanelSection` | `chat` |
| `CodeEditorSection` | `code` |

Validation should enforce this matrix.

## Prompt Contract

Add `api/services/structured-generation/prompts/mock-blueprint.ts`.

Exports:

```ts
export const MOCK_BLUEPRINT_PROMPT_VERSION = 'mock-blueprint-v1';

export function buildMockBlueprintSystemPrompt(input: {
  sectionCatalog: Array<{ componentName: RenderableMockBlueprintSectionName; usage: string; datasetKinds: string[] }>;
  jsonSchema: unknown;
}): string;

export function buildMockBlueprintUserPrompt(input: {
  task: { id: string; title: string; description?: string | null; objective?: string | null };
  questionnaireMarkdown?: string | null;
  featurePlanSummary?: string | null;
}): string;
```

System prompt requirements:

- Japanese wording.
- JSON only.
- The model must select sections from the provided allowlist.
- The model must generate theme-matched copy and mock dataset values.
- The model should prefer operational sections for operational apps: forms, tables, kanban, timelines, navigation.
- Marketing/media sections are used only when the task explicitly needs landing, article, media, or campaign preview.
- 1-3 screens and 1-6 sections per screen.
- No database schema, data binding, implementation task, CSS, HTML, arbitrary component tree, API contract, or Zod schema.

User prompt requirements:

- Task title / description / objective.
- Questionnaire answers when available.
- Latest Feature Plan summary when available.
- No full task message history.
- No Supervisor reference documents.

Prompt budget guard:

- System prompt <= 18,000 bytes.
- User prompt <= 8,000 bytes for normal questionnaire input.
- Test must fail if prompt includes `AppBlueprint JSON Schema`, `implementationTasks`, `learningHooks`, or `databaseSchema`.

## Structured LLM Contract

Add `api/services/blueprints/mock-llm-draft.ts`.

Exports:

```ts
export type GeneratedMockBlueprintDraft = {
  mockBlueprint: MockBlueprint;
  generation: {
    source: 'llm';
    promptVersion: typeof MOCK_BLUEPRINT_PROMPT_VERSION;
    rawOutput?: string;
    jsonRepair?: { repaired: boolean; repairKind: JsonFixWrapperResult['repairKind'] };
    promptDiagnostics: {
      schemaName: 'mock_blueprint';
      systemPromptBytes: number;
      userPromptBytes: number;
      sectionAllowlistCount: number;
      schemaDigest: string;
    };
  };
};

export async function generatePlanModeMockBlueprintDraft(input: {
  taskId: string;
  title: string;
  prompt: string;
  featurePlanSummary?: string | null;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedMockBlueprintDraft>;
```

Implementation rules:

- Call `callStructuredJsonLLM` with `schemaName: 'mock_blueprint'`.
- Use `role: 'plan'`.
- Use structured output schema. Do not add `mock_blueprint` to `CODEX_PROMPT_VALIDATED_SCHEMA_NAMES`.
- Parse with existing JSON repair helpers, then validate with `mockBlueprintSchema`.
- On validation failure, throw `MockBlueprintDraftGenerationError` carrying `rawOutput` and `promptDiagnostics`.
- Do not normalize unknown section names into a fallback section.

Tests:

```bash
bunx vitest run tests/services.mock-blueprints.test.ts tests/services.mock-blueprint-prompt-budget.test.ts
```

Required test cases:

- CRUD fixture returns `FormSection` and `DataTableSection` with Japanese copy.
- Kanban fixture returns `KanbanSection` with columns and cards.
- Media/article fixture can return `BlogPostSection` or `MediaTextSection` only when task context supports it.
- Unknown section name fails validation.
- Incompatible dataset kind fails validation.
- Prompt budget test proves full AppBlueprint schema is not included.

## Preview Adapter Contract

Add `src/modules/blueprint-preview/mockBlueprintAdapter.ts`.

Exports:

```ts
export function mockBlueprintToPreviewBlueprint(mockBlueprint: MockBlueprint): {
  id: string;
  name: string;
  version: number;
  description: string;
  designPreset: ReturnType<typeof createBlueprintPreviewDesignSettings>;
  screens: Array<Record<string, unknown>>;
};
```

Mapping rules:

- Root `description` comes from `summary`.
- `designPreset` uses current default Blueprint Preview design settings.
- Screen `componentName` is deterministic:
  - `article_with_sidebar` -> `ArticleFeedPage`
  - `sidebar_left` / `sidebar_right` -> `SidebarPage`
  - otherwise -> `ListPage`
- Section `componentName` is copied from `MockBlueprintSection.componentName`.
- Section `source` is deterministic:
  - navigation dataset -> `navigation`
  - article dataset -> `markdown`
  - table/form/kanban/cards/metrics/timeline/etc. -> `static`
- Section `intent` is `selectionReason`.
- Section `visualIntent` is derived from `copy.description` or screen purpose.
- Section `props` comes from a component-specific mapper.
- Missing optional fields get local fallback values; missing required dataset fields remain validation errors.

Component-specific mapper examples:

| Dataset kind | Props output |
| --- | --- |
| `table` | `{ title, description, columns, rows, emptyState }` |
| `form` | `{ title, description, fields, submitLabel }` |
| `cards` | `{ title, description, items }` |
| `kanban` | `{ boardLabel, boardDescription, columns }` |
| `timeline` | `{ title, description, items }` |
| `article` | `{ title, subtitle, body, meta }` |
| `navigation` | `{ title, description, items, menuItems, links }` |
| `metrics` | `{ title, description, metrics, items }` |
| `code` | `{ title, description, files }` |
| `chat` | `{ title, description, messages }` |

Tests:

```bash
bunx vitest run tests/mock-blueprint-adapter.test.ts
```

Required test cases:

- `table` maps to renderable `DataTableSection` props.
- `form` maps to renderable `FormSection` props.
- `kanban` maps to renderable `KanbanSection` props.
- `navigation` maps to renderable `TopMenuSection` props.
- The adapter never mutates the input object.

## Server Markdown Contract

Add `api/services/blueprints/mock-draft.ts`.

Exports:

```ts
export function renderMockBlueprintMarkdown(mockBlueprint: MockBlueprint): string;
export function summarizeMockBlueprintForDataModel(mockBlueprint: MockBlueprint): string;
```

Markdown output:

- H1 is `mockBlueprint.name`.
- Include summary and tone.
- For each screen, list path, purpose, layout, selected sections.
- For each section, list component name, selection reason, copy title, and compact dataset sample.
- Do not render database schema, data bindings, implementation tasks, or learning hooks.

Data Model summary:

- Include only screen names, section names, component names, and dataset samples.
- Do not imply DB table ownership.

Tests:

```bash
bunx vitest run tests/services.mock-blueprint-draft.test.ts
```

## Persistence Contract

Update `api/modules/nightworkers/nightworkers.repository.ts`.

Add:

```ts
export async function createMockBlueprintActivityArtifact(data: {
  taskId: string;
  runId?: string | null;
  messageId?: string | null;
  title: string;
  mockBlueprint: unknown;
  generation?: unknown;
  source?: string | null;
  metadataJson?: Record<string, unknown>;
});
```

Artifact fields:

- `kind: 'app_blueprint'` for now, so existing artifact pane grouping still works.
- `metadataJson.intent: 'mock_blueprint'`.
- `metadataJson.artifactType: 'mock_blueprint'`.
- `metadataJson.schemaName: 'mock_blueprint'`.
- `metadataJson.schemaVersion: 1`.
- `metadataJson.mockBlueprint`.

Reason for keeping `kind: 'app_blueprint'`:

- `WorkbenchArtifactKind` already contains `app_blueprint`.
- The user-facing workspace concept is still Blueprint.
- This avoids broad artifact-pane kind migration in this phase.

Do not store `metadataJson.appBlueprint` for MockBlueprint messages. That field remains reserved for legacy full AppBlueprint artifacts.

## Route Service Contract

Update `api/modules/blueprint/blueprint-generation.service.ts`.

Implementation order inside `generateBlueprintArtifact`:

1. Load task.
2. Assert blueprint capability.
3. Assert Plan Mode mutability.
4. Resolve optional ready questionnaire session.
5. Build compact prompt from task and questionnaire.
6. Call `generatePlanModeMockBlueprintDraft`.
7. Persist `createMockBlueprintActivityArtifact`.
8. Render `renderMockBlueprintMarkdown`.
9. Create `markdown_document` message with metadata:

```ts
{
  intent: 'mock_blueprint',
  artifactType: 'mock_blueprint',
  title: mockBlueprint.name || task.title || 'Mock Blueprint',
  artifactRef: {
    artifactId: artifact.id,
    kind: 'app_blueprint',
    version: 1,
  },
  display: {
    title: mockBlueprint.name || task.title || 'Mock Blueprint',
    summary: mockBlueprint.summary || renderedBlueprint.slice(0, 160),
    cardKind: 'app_blueprint',
  },
  mockBlueprint,
  generation,
  source: 'status',
  questionnaireSessionId: session?.id ?? null,
}
```

10. Update Plan Mode task objective/status exactly as current code does.
11. Return `{ message, workspace: await getPlanModeWorkspace(taskId) }`.

Error handling:

- On `MockBlueprintDraftGenerationError` with non-empty raw output, create a raw output message:

```ts
{
  intent: 'mock_blueprint_raw_output',
  source: 'status',
  validationStatus: 'failed',
  error: message,
  questionnaireSessionId: session?.id ?? null,
  promptDiagnostics: error.promptDiagnostics,
}
```

- Throw `AppError(502, 'SPECIFICATION_BLUEPRINT_FAILED', message)` to keep route compatibility.
- Update `src/modules/nightworkers/messageVisibility.ts` so `mock_blueprint_raw_output` is hidden like `blueprint_raw_output`.

Tests:

```bash
bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/thread-timeline-streaming.test.ts
```

## Workspace And Selector Contract

Update these server-side files:

- `api/modules/specification/plan-mode-workspace.service.ts`
- `api/modules/nightworkers/nightworkers.planning-helpers.service.ts`
- `api/modules/dataModel/dataModel-generation.service.ts`
- `api/modules/planViews/planView-generation.service.ts`
- `api/modules/questionnaire/questionnaire.repository.ts`
- `api/modules/questionnaire/questionnaire.service.ts`

Required behavior:

- `getPlanModeWorkspace` adds both legacy `app_blueprint` and new `mock_blueprint` messages to `blueprintArtifacts`.
- `dedicatedViewArtifacts` also includes `mock_blueprint` as `kind: 'blueprint'`.
- Add `isBlueprintMessage` or extend `isAppBlueprintMessage` carefully:
  - legacy full blueprint: `intent === 'app_blueprint' && appBlueprint`.
  - mock blueprint: `intent === 'mock_blueprint' && mockBlueprint`.
- Any function that specifically requires full `AppBlueprint` must keep checking `appBlueprint`.
- Data Model generation may use MockBlueprint only through `summarizeMockBlueprintForDataModel`; it must not read it as `appBlueprint`.
- Questionnaire source validation accepts `mock_blueprint` for UI-question generation by reading screen/section/copy/dataset context. Code paths that require full `AppBlueprint` keep a separate full-blueprint assertion.

Update these client-side files:

- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/specification/planModeWorkspaceModel.ts`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/modules/blueprint-preview/ArtifactBlueprintViewers.tsx`
- `src/modules/nightworkers/components/ArtifactPaneVersions.ts`
- `src/modules/nightworkers/workbenchSessionSelectors.ts`

Required behavior:

- `isNormalBlueprintMessage` returns true for `mock_blueprint` with `mockBlueprint`.
- Artifact refs keep `kind: 'app_blueprint'` for display compatibility.
- Blueprint panel chooses:
  - if `metadata.appBlueprint` exists, render legacy `BlueprintPreview`.
  - if `metadata.mockBlueprint` exists, convert through `mockBlueprintToPreviewBlueprint` and render `BlueprintPreview`.
  - otherwise fall back to Markdown.
- Timeline / artifact viewers show MockBlueprint as Blueprint, not generic Markdown only.
- Existing AppBlueprint tests continue to pass.

Tests:

```bash
bunx vitest run tests/artifact-workspace-viewer.test.ts tests/nightworkers.workbench-selectors.test.ts tests/read-current-specification-tool.test.ts
```

## UI Contract

Update `WorkspaceBlueprintPreview` in `src/modules/planMode/PlanModeWorkspacePanels.tsx`.

Required logic:

```txt
metadata.appBlueprint -> render legacy BlueprintPreview
metadata.mockBlueprint -> adapter -> render BlueprintPreview
else -> MarkdownViewer
```

Update `BlueprintArtifactViewer` or its caller so artifact-pane previews follow the same logic.

Do not create a new visual component unless the adapter cannot express the needed preview through current `BlueprintPreview`.

Tests:

```bash
bunx vitest run tests/blueprint-preview-design-settings.test.ts tests/artifact-workspace-viewer.test.ts tests/thread-workspace-banner.test.tsx
```

## Implementation Steps

### Step 1. Schema And Prompt Budget

Change:

- Add `shared/schemas/mock-blueprint.schema.ts`.
- Add `api/services/structured-generation/prompts/mock-blueprint.ts`.
- Add prompt budget tests.

Verify:

```bash
bunx vitest run tests/mock-blueprint-schema.test.ts tests/services.mock-blueprint-prompt-budget.test.ts
```

Stop condition:

- Do not proceed if unknown sections are accepted or prompt budget fails.

### Step 2. LLM Draft Service

Change:

- Add `api/services/blueprints/mock-llm-draft.ts`.
- Add `MockBlueprintDraftGenerationError`.
- Add fixture-based service tests.

Verify:

```bash
bunx vitest run tests/services.mock-blueprints.test.ts
```

Stop condition:

- Do not proceed if invalid section names or incompatible datasets are normalized instead of rejected.

### Step 3. Preview Adapter

Change:

- Add `src/modules/blueprint-preview/mockBlueprintAdapter.ts`.
- Add adapter tests.

Verify:

```bash
bunx vitest run tests/mock-blueprint-adapter.test.ts
```

Stop condition:

- Do not proceed if the adapter needs LLM-generated renderer-specific prop blobs to render basic table/form/kanban/card examples.

### Step 4. Server Persistence And Route Wiring

Change:

- Add `createMockBlueprintActivityArtifact`.
- Add `renderMockBlueprintMarkdown`.
- Switch `generateBlueprintArtifact` default path to MockBlueprint.
- Add raw-output failure handling for `mock_blueprint_raw_output`.

Verify:

```bash
bunx vitest run tests/services.mock-blueprint-draft.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/thread-timeline-streaming.test.ts
```

Stop condition:

- Do not proceed if route response shape changes from `{ message, workspace }`.

### Step 5. Workspace, Selectors, And UI

Change:

- Teach workspace read model and selectors about `mock_blueprint`.
- Render MockBlueprint via adapter in Plan Mode workspace and artifact pane.
- Keep legacy AppBlueprint rendering unchanged.

Verify:

```bash
bunx vitest run tests/artifact-workspace-viewer.test.ts tests/nightworkers.workbench-selectors.test.ts tests/read-current-specification-tool.test.ts tests/blueprint-preview-design-settings.test.ts
```

Stop condition:

- Do not proceed if existing `app_blueprint` artifacts stop rendering.

### Step 6. Final Gate

Verify:

```bash
bunx vitest run \
  tests/mock-blueprint-schema.test.ts \
  tests/services.mock-blueprint-prompt-budget.test.ts \
  tests/services.mock-blueprints.test.ts \
  tests/mock-blueprint-adapter.test.ts \
  tests/services.mock-blueprint-draft.test.ts \
  tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts \
  tests/artifact-workspace-viewer.test.ts \
  tests/nightworkers.workbench-selectors.test.ts

bun run verify:base
```

If `verify:base` passes and the implementation is otherwise complete:

```bash
bun run verify
```

## Acceptance Criteria

- Normal Blueprint creation uses `mock_blueprint` generation by default.
- LLM chooses renderable Section names from a shared allowlist.
- LLM generates theme-matched copy and mock datasets in JSON.
- Unknown sections and incompatible datasets fail validation.
- MockBlueprint renders through existing Blueprint Preview components.
- Existing AppBlueprint artifacts remain readable.
- `getPlanModeWorkspace` counts MockBlueprint as a Blueprint artifact.
- Prompt budget tests prove the full AppBlueprint schema and Supervisor reference documents are absent from the MockBlueprint prompt.
- Usage records use `label: 'mock_blueprint'`, enabling before/after comparison against `app_blueprint`.
- Focused tests and `bun run verify:base` pass before implementation is considered complete.
