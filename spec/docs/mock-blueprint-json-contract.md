# Mock Blueprint JSON Contract

## Ownership

This contract belongs in `shared/schemas/mock-blueprint.schema.ts` and must be reused by server prompt generation, LLM output validation, tests, and preview conversion.

Do not maintain separate section allowlists in server and client code.

## Root Contract

```ts
type MockBlueprint = {
  artifactKind: 'mock_blueprint';
  id: MockBlueprintId;
  name: string;
  version: 1;
  summary: string;
  tone: string;
  meta: MockBlueprintMeta;
  screens: MockBlueprintScreen[];
  generationNotes: string[];
};

type MockBlueprintMeta = {
  intent: string;
  selectedSections: Array<{
    sectionType: RenderableMockBlueprintSectionName;
    selectionReason: string;
  }>;
};
```

Rules:

- `meta` is required.
- `meta.intent` states what product mockup the LLM intended to create.
- `meta.selectedSections` is debug evidence for section choice.
- `generationNotes` may exist for diagnostics, but it is not primary UI.
- The normal UI must not render `summary`, `generationNotes`, or `meta` as a Markdown page.

## ID Rules

Use the existing ID schema unless intentionally changed:

```ts
type MockBlueprintId = string; // /^[A-Za-z][A-Za-z0-9_-]*$/
```

The current schema accepts uppercase and underscore. Do not silently change this unless all fixtures and prompt examples are updated.

## Screen Contract

```ts
type MockBlueprintScreen = {
  id: MockBlueprintId;
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

Validation:

- `screens`: min 1, max 3.
- `sections`: min 1, max 6.
- Prompt guidance should prefer 2-4 sections for the primary screen, but schema should not force every screen to have 2+ sections.

## Section Contract

```ts
type MockBlueprintSection = {
  id: MockBlueprintId;
  name: string;
  componentName: RenderableMockBlueprintSectionName;
  region?: 'header' | 'main' | 'sidebar' | 'aside' | 'full_width' | 'footer' | null;
  selectionReason: string;
  copy: {
    title: string;
    description: string | null;
    primaryActionLabel: string | null;
    secondaryActionLabel: string | null;
    emptyStateTitle: string | null;
    emptyStateDescription: string | null;
  };
  dataset: MockBlueprintDataset;
};
```

Runtime schema may use `.nullish()` for backward compatibility, but the provider structured output schema must include these keys in `required` and use `string | null` values for strict compatibility.

Rules:

- `componentName` must be from `renderableMockBlueprintSectionNames`.
- `dataset.kind` must be compatible with `componentName`.
- `selectionReason` must explain product fit, not implementation convenience.
- `copy` must be theme-aware and visible-user-facing.
- Placeholder copy such as ads, sponsored, newsletter, sample item, or generic implementation notes is invalid unless requested.

## Dataset Contract

```ts
type MockBlueprintDataset =
  | { kind: 'navigation'; items: Array<{ label: string; href?: string; active?: boolean }> }
  | { kind: 'table'; columns: Array<{ key: MockBlueprintId; label: string }>; rows: Array<Record<string, string | number | boolean>> }
  | { kind: 'form'; fields: Array<{ name: MockBlueprintId; label: string; type: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number'; placeholder?: string; options?: string[] }>; submitLabel: string }
  | { kind: 'cards'; cards: Array<{ title: string; description: string; meta?: string; actionLabel?: string }> }
  | { kind: 'kanban'; columns: Array<{ id: MockBlueprintId; title: string; cards: Array<{ title: string; description: string; meta?: string }> }> }
  | { kind: 'timeline'; items: Array<{ title: string; description: string; timestamp?: string }> }
  | { kind: 'article'; title: string; body: string; meta?: Array<{ label: string; value: string }> }
  | { kind: 'metrics'; metrics: Array<{ label: string; value: string | number | boolean; trend?: string }> }
  | { kind: 'media'; items: Array<{ title: string; description: string; mediaLabel?: string }> }
  | { kind: 'map'; points: Array<{ label: string; description: string; region?: string }> }
  | { kind: 'code'; files: Array<{ path: string; language: string; excerpt: string }> }
  | { kind: 'chat'; messages: Array<{ author: string; body: string; state?: string }> }
  | { kind: 'generic'; items: Array<{ title: string; description: string }> };
```

Minimum dataset sizes:

| Dataset kind | Minimum |
| --- | ---: |
| `navigation.items` | 2 |
| `table.columns` | 2 |
| `table.rows` | 5 |
| `form.fields` | 2 |
| `cards.cards` | 2 |
| `kanban.columns` | 1 |
| `timeline.items` | 2 |
| `metrics.metrics` | 2 |
| `media.items` | 1 |
| `map.points` | 1 |
| `code.files` | 1 |
| `chat.messages` | 2 |
| `generic.items` | 2 |

Reasoning:

- Mockup review needs enough repeated data to see the finished state.
- Two table rows are not enough for a table mockup.
- Empty arrays should be repaired before final schema validation when possible.

## Component / Dataset Compatibility

Keep this matrix in `datasetKindsBySection` and enforce it in `mockBlueprintSectionSchema.superRefine`.

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

## Provider Structured Output Schema

`buildMockBlueprintStructuredOutputJsonSchema` must be provider-compatible and compact.

Root required keys:

```ts
[
  'artifactKind',
  'id',
  'name',
  'version',
  'summary',
  'tone',
  'meta',
  'screens',
  'generationNotes',
]
```

Meta schema:

```ts
meta: {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'selectedSections'],
  properties: {
    intent: { type: 'string' },
    selectedSections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sectionType', 'selectionReason'],
        properties: {
          sectionType: { type: 'string', enum: [...renderableMockBlueprintSectionNames] },
          selectionReason: { type: 'string' },
        },
      },
    },
  },
}
```

Do not put the full discriminated dataset schema into the provider schema unless size stays safely below the prompt budget. The runtime schema remains authoritative for final validation.

## Normalization Requirements

`normalizeMockBlueprintCandidate` in `api/services/blueprints/mock-llm-draft.ts` must run before final schema validation and must handle:

- top-level arrays by selecting the `artifactKind: 'mock_blueprint'` object,
- section objects accidentally returned at screen level,
- nullable copy fields,
- dataset aliases such as `items` for cards/chat/media,
- missing `generationNotes`,
- missing `meta`,
- empty dataset arrays.

Dataset fallback must be generic:

- It may use section copy and screen purpose.
- It must not hardcode BBS rows or any other domain.
- It must not invent implementation tasks as product data.

## Preview Adapter Contract

`src/modules/blueprint-preview/mockBlueprintAdapter.ts` must:

- Parse with `mockBlueprintSchema`.
- Return null for invalid input.
- Preserve `meta` in the preview blueprint object.
- Convert only renderable sections.
- Coerce invalid sidebar/aside placement back to `main` unless the section is actually sidebar-capable.

`BlueprintPreview` should receive a shape equivalent to:

```ts
{
  id,
  name,
  version,
  description: summary,
  meta,
  designPreset,
  screens: [...]
}
```

## Persistence Contract

When generation succeeds:

- task message:
  - `messageType: 'markdown_document'`
  - `metadataJson.intent: 'mock_blueprint'`
  - `metadataJson.mockBlueprint`
  - `metadataJson.generation`
  - `metadataJson.artifactRef`
- activity artifact:
  - `kind: 'app_blueprint'`
  - `metadataJson.intent: 'mock_blueprint'`
  - `metadataJson.schemaName: 'mock_blueprint'`
  - `metadataJson.mockBlueprint`
  - `metadataJson.generation`
  - `contentText`: parseable JSON preferred for recovery

Markdown content may remain for export/history, but it is not the primary display source.
