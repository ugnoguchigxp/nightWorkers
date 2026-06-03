# Blueprint Design Settings UI Implementation Plan

## Goal

Add a Design button at the top of the Blueprint artifact view. When pressed, it
opens an accordion with governed design settings for the Blueprint Preview.

The settings should cover:

- theme
- density
- shape
- shadow
- font
- contrast
- motion
- component variants

Users should choose from constrained options, not author raw CSS. Every change
must immediately update the Blueprint Preview. The surrounding NightWorkers app
can remain dark, but Blueprint Preview should default to a light theme.

## Current State

Blueprint artifacts are rendered in
`src/modules/nightworkers/components/ArtifactPane.tsx`.

Current relevant behavior:

- `BlueprintViewer` extracts `screens`, `databaseSchema.tables`,
  `dataBindings`, and validation issues from `metadata.appBlueprint`.
- `BlueprintScreenPreview` renders the first screen directly with hard-coded
  dark Tailwind classes.
- `BlueprintPreviewSection` and `renderPreviewSectionBody` render section
  previews with raw `slate` / `cyan` classes.
- `shared/schemas/design-governance.schema.ts` already defines
  `DesignPreset`.
- `api/services/design-governance/index.ts` already provides
  `defaultDesignPreset`, currently set to `nightworkers-dark`.
- `designSystem/src/styles/index.css` registers Tailwind CSS v4 theme tokens
  backed by CSS variables.
- `designSystem/src/styles/themes.css` already uses `:root` as light defaults
  and `:root[data-theme="dark"]` for dark mode.
- `designSystem/src/styles/variables.css` already uses DOM attributes such as
  `data-density`.

The implementation should therefore avoid introducing a separate theme system.
It should connect Blueprint Preview to the existing shadcn/ui + Tailwind v4
token model.

## Non-Goals

- Do not add persistence in the first implementation slice.
- Do not change the global NightWorkers app theme.
- Do not let users type arbitrary token values or Tailwind class names.
- Do not rewrite the Blueprint schema generator unless validation requires it.
- Do not convert Blueprint Preview into a full runtime renderer.

## UX Shape

The Blueprint artifact top section should become:

```txt
Blueprint artifact pane
  Design Preview
    Header row
      Screen title / section count
      Design button
    Design settings accordion
      Theme
      Density
      Shape
      Shadow
      Font
      Contrast
      Motion
      Component variants
    Preview canvas
      First Blueprint screen rendered with selected settings
```

The Design button should:

- live at the top of the Blueprint Preview section
- use an icon plus short text label
- expose `aria-expanded`
- toggle the accordion without navigating away from the artifact
- keep selected settings visible through concise option labels

The accordion should:

- be compact enough for the right-side artifact pane
- use segmented controls or select-like option groups
- keep each setting constrained to known values
- update local preview state synchronously on selection

## State Model

Introduce a UI-side settings type that mirrors `DesignPreset` but can map old
or backend-specific values into preview-safe values.

```ts
type BlueprintPreviewDesignSettings = {
  theme: 'light' | 'dark' | 'tokyonight' | 'eclipse' | 'macosclassic' | 'fire';
  density: 'compact' | 'default' | 'comfortable';
  shape: 'sharp' | 'default' | 'rounded' | 'pill';
  shadow: 'none' | 'subtle' | 'medium' | 'strong';
  font: 'system' | 'geist' | 'serif' | 'mono';
  contrast: 'standard' | 'high';
  motion: 'reduced' | 'standard';
  componentVariants: {
    button: 'solid' | 'soft' | 'outline';
    card: 'plain' | 'outlined' | 'elevated';
    table: 'plain' | 'striped' | 'dense-grid';
    input: 'outline' | 'filled' | 'underline';
  };
};
```

Initialization rules:

1. Start from the artifact `blueprint.designPreset` when present.
2. Normalize unknown or legacy theme values:
   - `nightworkers-light` -> `light`
   - `nightworkers-dark` -> `light` for Preview default only
   - unknown values -> `light`
3. Keep the app shell dark; only the preview canvas receives design attributes.
4. Store settings in `BlueprintViewer` local state for the first slice.

Persistence can be added later by writing the selected settings back into the
Blueprint artifact metadata or a project-scoped preference.

## Token Mapping

The preview canvas should be a scoped DOM island:

```tsx
<div
  data-blueprint-preview
  data-theme={settings.theme}
  data-density={settings.density}
  data-shape={settings.shape}
  data-shadow={settings.shadow}
  data-font={settings.font}
  data-contrast={settings.contrast}
  data-motion={settings.motion}
  data-button-variant={settings.componentVariants.button}
  data-card-variant={settings.componentVariants.card}
  data-table-variant={settings.componentVariants.table}
  data-input-variant={settings.componentVariants.input}
>
  ...
</div>
```

Tailwind classes inside the preview should use semantic tokens:

- `bg-background`
- `text-foreground`
- `bg-card`
- `text-card-foreground`
- `border-border`
- `bg-primary`
- `text-primary-foreground`
- `text-muted-foreground`
- `ring-ring`
- `shadow-[var(--blueprint-preview-shadow)]`

Avoid raw app colors such as `slate-*` and `cyan-*` inside the preview renderer
once the adapter exists.

### Axis Mapping

| Axis | DOM attribute | Token behavior |
| --- | --- | --- |
| theme | `data-theme` | Reuse existing theme CSS variables. `light` is the preview default. |
| density | `data-density` | Reuse existing density variables. Map `comfortable` to the existing spacious scale or add alias CSS. |
| shape | `data-shape` | Set scoped `--radius` and derived shadcn radius tokens. |
| shadow | `data-shadow` | Set `--blueprint-preview-shadow`. |
| font | `data-font` | Set scoped `--font-sans` and preview text family. |
| contrast | `data-contrast` | Adjust foreground, muted foreground, border, and ring emphasis. |
| motion | `data-motion` | Disable preview transitions/animations when reduced. |
| component variants | per-component `data-*` | Select variant class recipes for button, card, table, input, and section chrome. |

## Implementation Slices

### Slice 1: Component Extraction

Create small Blueprint Preview UI modules so the settings work does not expand
`ArtifactPane.tsx` further.

Proposed files:

- `src/modules/nightworkers/components/blueprint-preview/BlueprintPreview.tsx`
- `src/modules/nightworkers/components/blueprint-preview/BlueprintPreviewSettings.tsx`
- `src/modules/nightworkers/components/blueprint-preview/designSettings.ts`
- `src/modules/nightworkers/components/blueprint-preview/renderPreviewSectionBody.tsx`
- `src/modules/nightworkers/components/blueprint-preview/previewData.ts`
- `src/modules/nightworkers/components/blueprint-preview/index.ts`

Move existing preview-only helpers from `ArtifactPane.tsx` into these files:

- `BlueprintScreenPreview`
- `BlueprintPreviewSection`
- `renderPreviewSectionBody`
- `previewColumns`
- `previewRows`
- `chartPreviewItems`
- `previewGenericItems`
- `tableForSection`
- `bindingForSection`

`ArtifactPane.tsx` should keep artifact selection, markdown/code rendering, and
high-level Blueprint artifact layout.

### Slice 2: Settings Accordion

Implement the Design button and accordion inside `BlueprintPreview`.

Use project-owned shadcn/ui components from `@repo/design-system` where
available:

- `Button` or `IconButton`
- `Accordion`
- `Select` or option button groups
- `Badge` for compact current-value summaries

Use `lucide-react` for the Design button icon, likely `Palette` or `SlidersHorizontal`.

The settings component should receive:

```ts
type BlueprintPreviewSettingsProps = {
  value: BlueprintPreviewDesignSettings;
  onChange: (next: BlueprintPreviewDesignSettings) => void;
};
```

Every option click should call `onChange` immediately. No Apply button is
needed in the first slice.

### Slice 3: Scoped Token Adapter

Add a preview-scoped CSS adapter. Prefer placing it near app-specific CSS unless
the same adapter is intended for designSystem reuse.

Proposed first location:

- `src/modules/nightworkers/components/blueprint-preview/blueprintPreview.css`

Import it from the preview module or from `src/index.css`.

The CSS adapter should:

- define `data-blueprint-preview` defaults as light
- map `data-shape` to `--radius`
- map `data-shadow` to `--blueprint-preview-shadow`
- map `data-font` to `font-family`
- map `data-contrast` to scoped semantic variables
- map `data-motion="reduced"` to low/no transition behavior
- support `data-density="comfortable"` even though the current CSS uses
  `data-density="spacious"` elsewhere

This adapter is the boundary between selectable UI settings and Tailwind CSS v4
tokens.

### Slice 4: Preview Class Migration

Replace hard-coded dark preview classes with token-based classes.

Examples:

- preview shell: `bg-background text-foreground`
- section card: `border-border bg-card text-card-foreground`
- muted helper text: `text-muted-foreground`
- active bars/buttons: `bg-primary text-primary-foreground`
- tables: `border-border bg-card`

Component variants should be implemented through small class recipe helpers,
not inline branching across the preview body.

Proposed helper:

```ts
function previewVariantClass(
  component: 'button' | 'card' | 'table' | 'input',
  variant: string
): string
```

### Slice 5: Default Light Preview

Ensure Blueprint Preview initializes as light even when generated Blueprints
contain `nightworkers-dark`.

The user-visible behavior should be:

- app shell remains dark
- opening a Blueprint artifact shows a light preview by default
- selecting dark immediately switches only the preview canvas
- closing and reopening the artifact resets to the artifact-derived default
  unless persistence is added later

### Slice 6: Tests and Verification

Add focused tests before broad verification.

Proposed tests:

- `tests/blueprint-preview-design-settings.test.tsx`
  - renders the Preview with light defaults
  - toggles the Design accordion
  - changes each axis and asserts the relevant `data-*` attribute updates
  - verifies `nightworkers-dark` normalizes to light for Preview default
- Existing blueprint service tests remain backend-focused.

Verification commands:

```bash
pnpm test run tests/blueprint-preview-design-settings.test.tsx
pnpm typecheck
pnpm lint
pnpm verify
```

If frontend visual risk is high, also run the dev server and verify the
Blueprint artifact pane manually or with Playwright:

```bash
pnpm dev
pnpm test:e2e:smoke
```

## Persistence Follow-Up

Do not include persistence in the first slice. After the local preview behavior
is stable, choose one of these intentionally:

- artifact-local: write settings into `metadata.appBlueprint.designPreset`
- project-local: save a project-scoped Blueprint Preview preference
- global default: save a user-level default for future Blueprints

The likely second slice is artifact-local because it keeps the selected design
attached to the reviewable Blueprint contract.

## Risks

- `ArtifactPane.tsx` already has broad responsibilities. Implementing settings
  there directly will make future Blueprint work harder to review.
- Current preview markup uses many hard-coded dark classes. Partial migration
  can create mixed light/dark surfaces.
- Current schema calls the axis `radius`, while the requested UI calls it
  `shape`. The UI can show "Shape" while storing `radius` until a schema rename
  is explicitly planned.
- Current density CSS uses `spacious`, while the schema uses `comfortable`.
  The adapter should bridge this instead of changing schema and CSS together in
  the first slice.
- Generated Blueprint artifacts may keep `nightworkers-dark`. Preview should
  normalize safely without changing backend generation in this first UI slice.

## Acceptance Criteria

- A Design button appears at the top of the Blueprint Preview.
- Pressing it opens an accordion containing all eight governed axes.
- Every axis is selectable from fixed options only.
- Changing any option immediately updates the preview canvas.
- Blueprint Preview defaults to a light theme even when the app shell is dark.
- Preview styling uses shadcn/ui + Tailwind CSS v4 semantic tokens, not raw
  one-off preview colors.
- The implementation keeps Design Governance settings as one source of truth
  for the preview.
- Tests cover default normalization, accordion interaction, and data attribute
  updates.
