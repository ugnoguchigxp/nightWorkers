# App Blueprint and Design Governance Implementation Plan

## Goal

Build NightWorkers' App Blueprint and Design Governance foundation by extracting
the useful contracts from `../composia-ui` while keeping NightWorkers' internal
domains explicit and inspectable.

This plan does not propose a direct port of composia-ui. composia-ui is a
prototype with useful ideas, but NightWorkers needs smaller, domain-separated
contracts that can support impact analysis, agent execution planning, and future
ContextStill feedback.

## Source Review Summary

The composia-ui implementation has several strong contracts worth reusing:

- App UI Schema: high-level screen and section structure.
- Component catalog: allowed components, sources, props schemas, and prompt
  guidance as one source of truth.
- Catalog validation: generated UI must pass schema and catalog checks before
  it can be saved or rendered.
- DatabaseSchemaJson: normalized table, column, relation, UI hint definitions.
- DataBindingJson: explicit binding between UI sections and database tables.
- Cross-reference validation: screen sections must only reference existing
  bindings, and bindings must only reference existing schema fields.
- ScreenJSON replay: generated UI can be saved and replayed without another LLM
  call.
- Parity tests: docs, schema definitions, registry, fixtures, and Storybook are
  kept synchronized.

The risky parts should not be ported first:

- full PromptWorkspace UI
- full screen-history runtime
- `@json-render/*` renderer dependency
- Postgres SandboxDB migration and row runtime
- sources/media/cache/entities modules
- OAuth/auth surfaces
- arbitrary AI screen generation endpoint
- action-click child-screen navigation runtime

NightWorkers should first adopt the contracts and verification shape, then add
runtime and UI surfaces only after the contracts are stable.

## Domain Boundary

The implementation should be split into internal domains. Do not build a single
large `blueprint` module that owns everything.

## User-Facing Workflow

The Blueprint should be introduced as a Plan mode artifact, not as a separate
standalone app builder.

Recommended flow:

1. The user discusses an app idea in Plan mode.
2. The agent explains the proposed shape in chat and produces a structured
   `AppBlueprint` draft.
3. The chat timeline shows a concise Blueprint artifact card.
4. Opening the card shows the Blueprint in the existing right-side artifact
   pane.
5. The user refines the Blueprint through chat, for example by adding screens,
   removing sections, changing data entities, or adjusting design constraints.
6. The Blueprint is revalidated after edits and remains reviewable before it is
   converted into implementation tasks.

The right-side artifact pane should remain the shared inspection surface for
project files, diffs, specs, plans, Blueprint artifacts, and component-level
design artifacts. Project Tree should not remain visible for every artifact.
Instead, Project Tree is the outline for the `Files` artifact. When another
artifact is selected, the left column should switch to that artifact's outline:
Blueprint screens/sections, component variants/token changes, changed files, or
document headings. This keeps the core layout stable while making each artifact
a first-class review target.

Blueprint artifact display should prioritize:

- screen and section outline
- data model summary
- data binding coverage
- design preset summary
- validation issues with paths and messages
- derived implementation task preview when task planning exists

Blueprint artifact display should not become a freeform screen generator or a
runtime renderer in the first UI slice.

Component-level design changes should also be reviewable as artifacts. For
example, changing only button design should create a component design artifact
with:

- scope such as `designSystem.Button`
- variants and states
- token changes
- validation issues
- discussion prompts

Blueprint/design operations should not be limited to Plan mode. Plan mode is a
natural entry point for `blueprint.create`, but normal chat should also be able
to invoke focused tools such as `design.component.propose` and receive a
reviewable artifact as the result.

### 1. Design Governance Domain

Purpose: define visual choices and how they become stable implementation tokens.

Proposed files:

- `shared/schemas/design-governance.schema.ts`
- `api/services/design-governance/`
- `designSystem/src/governance/`
- `tests/schemas.design-governance.test.ts`
- `tests/services.design-governance.test.ts`

Responsibilities:

- define `DesignPreset`
- define fixed/configurable/hybrid operation mode
- define axes: theme, density, radius, shadow, font, contrast, motion
- map preset choices to semantic token names
- validate that presets use known design-system values
- expose design preset metadata for Blueprint use

Non-responsibilities:

- screen structure
- database schema
- generated UI rendering
- run execution

Initial contract sketch:

```ts
type DesignOperationMode = 'fixed' | 'configurable' | 'hybrid';

type DesignPreset = {
  id: string;
  name: string;
  mode: DesignOperationMode;
  theme: string;
  density: 'compact' | 'default' | 'comfortable';
  radius: 'sharp' | 'default' | 'rounded' | 'pill';
  shadow: 'none' | 'subtle' | 'medium' | 'strong';
  fontScale: 'small' | 'default' | 'large';
  contrast: 'standard' | 'high';
  motion: 'reduced' | 'standard';
};
```

### 2. Blueprint Catalog Domain

Purpose: define the high-level components an agent may use when describing an
application blueprint.

Proposed files:

- `shared/schemas/blueprint-catalog.schema.ts`
- `api/services/blueprint-catalog/`
- `src/modules/blueprints/catalog/` only when UI preview starts
- `tests/schemas.blueprint-catalog.test.ts`
- `tests/blueprint-catalog.parity.test.ts`

Responsibilities:

- define allowed blueprint component names
- define component placement: page, section, shell, primitive
- define allowed data sources per component
- define component props schema
- define prompt guidance for agent-facing generation later
- define variant names that are allowed under design governance
- provide validation for component/source/props mismatches

Non-responsibilities:

- concrete React component implementation
- Tailwind class policy
- database schema
- persistence

Port from composia-ui:

- `componentDefinitionSchema` idea
- `componentPropsSchemas` SSoT pattern
- `allowedSources`
- `placement`
- `promptProps` / `promptGuidance`
- parity test pattern

Adaptation:

- Start with a smaller catalog than composia-ui.
- Map only components we can implement with the current `designSystem`.
- Keep low-level components such as Button/Input/Card out of the agent-facing
  catalog. They remain internal implementation details.

Initial catalog candidates:

- `DashboardPage`
- `ListPage`
- `DetailPage`
- `FormPage`
- `KpiSummarySection`
- `DataTableSection`
- `FormSection`
- `CardGridSection`
- `StepperSection`
- `TimelineSection`
- `ComparisonSection`
- `EmptyState`
- `ErrorState`

### 3. Blueprint UI Schema Domain

Purpose: define screens, sections, actions, and visual intent at the blueprint
level.

Proposed files:

- `shared/schemas/app-blueprint-ui.schema.ts`
- `api/services/app-blueprint-ui/`
- `tests/schemas.app-blueprint-ui.test.ts`
- `tests/app-blueprint-ui-invariants.test.ts`

Responsibilities:

- define `BlueprintScreen`
- define `BlueprintSection`
- define app-relative navigation/action constraints
- support optional `dataBindingId` on sections
- connect visual intent to design preset axes
- validate sections against the Blueprint Catalog domain

Non-responsibilities:

- database schema validation
- persistence/versioning
- React rendering

Port from composia-ui:

- `AppUiSchema`
- `AppUiSchemaSection`
- app-relative href validation
- `dataBindingId` reference on sections
- action carry semantics only if needed later
- invariant tests against unsafe links and low-level components

Adaptation:

- Rename to Blueprint UI terminology so it does not imply a runtime renderer.
- Treat `intent` as internal metadata. Do not force it into visible copy.
- Keep screen JSON as a contract first, not a generated-screen runtime.

### 4. Blueprint Data Model Domain

Purpose: define application data shape without immediately creating runtime
tables or migrations.

Proposed files:

- `shared/schemas/app-blueprint-data.schema.ts`
- `api/services/app-blueprint-data/`
- `tests/schemas.app-blueprint-data.test.ts`
- `tests/services.app-blueprint-data-validator.test.ts`

Responsibilities:

- define `BlueprintDatabaseSchema`
- define table, column, relation, index, and UI hints
- normalize common AI/provider shapes into canonical identifiers
- validate duplicate tables/columns/relations
- reject reserved SQL identifiers
- validate relations and indexes

Non-responsibilities:

- migration generation
- SandboxDB introspection
- row runtime
- Drizzle schema generation

Port from composia-ui:

- identifier normalization
- scalar type normalization
- primary key/audit column strategy if still desired
- relation validation
- `uiHints`
- reserved SQL identifier checks

Adaptation:

- Keep this as a design contract. Do not create physical DB tables in the first
  slice.
- Keep SQLite/local-first portability in mind even though composia-ui is
  Postgres-first.
- Avoid Postgres-only concepts in v1 unless they are explicitly marked optional.

### 5. Blueprint Binding Domain

Purpose: connect UI sections to the blueprint data model explicitly.

Proposed files:

- `shared/schemas/app-blueprint-binding.schema.ts`
- `api/services/app-blueprint-binding/`
- `tests/schemas.app-blueprint-binding.test.ts`
- `tests/services.app-blueprint-binding-validator.test.ts`

Responsibilities:

- define `BlueprintDataBinding`
- validate binding ids
- validate binding table/field/relation references
- validate screen section `dataBindingId` references
- distinguish design-time binding from runtime data access

Non-responsibilities:

- row fetching
- form submit runtime
- migrations
- live database access

Port from composia-ui:

- `DataBindingDraft`
- `DataBinding`
- `validateDataBindingsForDatabaseSchema`
- `validateScreenDataBindingReferences`
- `resolveScreenRuntimeBindings` idea, but renamed as design-time reference
  resolution

Adaptation:

- Start with `list` and `create` operations only.
- Model `update`, `delete`, `attach`, and `detach` as future operations.
- Do not add SandboxDB applied-state gates in v1.

### 6. App Blueprint Aggregate Domain

Purpose: combine design, screens, data, bindings, implementation tasks, and
acceptance criteria into one reviewable handoff object.

Proposed files:

- `shared/schemas/app-blueprint.schema.ts`
- `api/modules/blueprints/blueprints.routes.ts`
- `api/modules/blueprints/blueprints.service.ts`
- `api/modules/blueprints/blueprints.repository.ts`
- `tests/routes.blueprints.test.ts`
- `tests/services.blueprints.test.ts`

Responsibilities:

- define the aggregate `AppBlueprint`
- validate cross-domain consistency
- persist blueprint drafts later
- expose blueprint preview/validation route later
- derive implementation task candidates later

Non-responsibilities:

- design token generation
- component implementation
- agent run execution
- ContextStill registration

Initial contract sketch:

```ts
type AppBlueprint = {
  version: 1;
  id?: string;
  title: string;
  objective: string;
  designPreset: DesignPreset;
  screens: BlueprintScreen[];
  databaseSchema?: BlueprintDatabaseSchema;
  dataBindings: BlueprintDataBinding[];
  implementationTasks: BlueprintImplementationTask[];
  acceptanceCriteria: string[];
  governanceRules: string[];
  learningHooks: BlueprintLearningHook[];
};
```

### 7. Composia Adapter Domain

Purpose: isolate any translation from composia-ui concepts into NightWorkers'
blueprint contracts.

Proposed files:

- `api/services/composia-adapter/`
- `tests/services.composia-adapter.test.ts`

Responsibilities:

- translate selected composia-ui fixtures or JSON contracts into NightWorkers
  blueprint shapes
- normalize old naming
- record explicit unsupported fields
- keep prototype import logic out of core blueprint validators

Non-responsibilities:

- runtime dependency on `../composia-ui`
- direct database migration from composia-ui
- copying the PromptWorkspace

This domain can start as documentation and fixture conversion tests. It does
not need routes in v1.

### 8. Blueprint Task Planning Domain

Purpose: convert a valid App Blueprint into bounded NightWorkers work items.

Proposed files:

- `api/services/blueprint-task-planning/`
- `tests/services.blueprint-task-planning.test.ts`

Responsibilities:

- derive implementation tasks from screens, data model, and bindings
- order work by dependency
- emit task-intake compatible todos later
- explain affected domains for each task

Non-responsibilities:

- running the supervisor
- creating code patches directly
- registering ContextStill candidates directly

This should connect to existing `task-intake` only after the contract and
validators are stable.

### 9. Experience Feedback Domain

Purpose: attach run evidence and ContextStill learning hooks to Blueprint work.

Existing related domain:

- `api/services/memory-feedback/`
- `api/services/context-still/`
- `api/services/run-events/`

Responsibilities:

- record which blueprint and design preset were used by a run
- record deviations from blueprint rules
- expose learning hooks for ContextStill candidate extraction
- track whether injected knowledge affected later blueprint work

Non-responsibilities:

- changing ContextStill persistence
- replacing MCP integration
- automatic candidate approval

This is later-phase work. It depends on actual blueprint execution events.

## Implementation Phases

### Phase 0: Planning Document

Status: this document.

Deliverables:

- document import decisions
- document domain boundaries
- document explicit non-goals
- document implementation order

Verification:

- docs can be reviewed without reading composia-ui source
- each planned domain has clear responsibilities and non-responsibilities

### Phase 1: Shared Schema Foundation

Implement:

- `design-governance.schema.ts`
- `blueprint-catalog.schema.ts`
- `app-blueprint-ui.schema.ts`
- `app-blueprint-data.schema.ts`
- `app-blueprint-binding.schema.ts`
- `app-blueprint.schema.ts`

Tests:

- schema accepts a representative valid blueprint
- schema rejects unsafe links
- schema rejects low-level component names
- schema rejects component/source mismatches
- schema rejects duplicate data bindings
- schema rejects missing table/field references
- schema rejects missing screen binding references

Verification gate:

```bash
pnpm typecheck
pnpm test run tests/schemas.app-blueprint*.test.ts tests/schemas.design-governance.test.ts
```

### Phase 2: Catalog and Design Governance Mapping

Implement:

- initial blueprint catalog definitions
- mapping from catalog components to existing `designSystem` capability
- design preset validator against `designSystem/src/lib/design-tokens.ts`
- docs section listing supported components and token axes

Tests:

- catalog definitions and props schemas have matching component names
- every catalog component is documented
- every component has prompt/use guidance
- every design preset references known token axes

Verification gate:

```bash
pnpm test run tests/blueprint-catalog.parity.test.ts tests/services.design-governance.test.ts
pnpm -C designSystem type-check
```

### Phase 3: Cross-Domain Blueprint Validation

Implement:

- aggregate blueprint validation service
- cross-reference validator for screens, data schema, and bindings
- validation issue format suitable for UI and run events

Tests:

- valid blueprint has no issues
- invalid component/source pair reports path and message
- invalid binding reports path and message
- invalid data relation reports path and message
- validation output is deterministic

Verification gate:

```bash
pnpm test run tests/services.blueprints.test.ts tests/services.app-blueprint-*.test.ts
```

### Phase 4: Composia Concept Import Fixtures

Implement:

- `api/services/composia-adapter/`
- fixture-based conversion tests using small extracted examples
- unsupported-field reporting

Do not implement:

- runtime import from `../composia-ui`
- full database migration from composia-ui
- PromptWorkspace copy

Tests:

- composia-like App UI Schema converts into Blueprint UI
- composia-like DatabaseSchemaJson converts into Blueprint Data Model
- composia-like DataBindingDraft converts into Blueprint Binding
- unsupported fields are explicitly listed instead of silently ignored

Verification gate:

```bash
pnpm test run tests/services.composia-adapter.test.ts
```

### Phase 5: Blueprint Persistence API

Implement:

- `api/modules/blueprints/`
- create/list/get/update draft endpoints
- validation-only endpoint
- repository persistence using Drizzle/SQLite
- migration for blueprint drafts

Tests:

- route validation rejects invalid blueprints
- repository stores and reads the aggregate JSON
- updates preserve version/history fields
- API response includes validation summary

Verification gate:

```bash
pnpm test run tests/routes.blueprints.test.ts tests/services.blueprints.test.ts
pnpm db:generate
pnpm typecheck
```

### Phase 6: Blueprint-To-Task Planning

Implement:

- `api/services/blueprint-task-planning/`
- deterministic task derivation from blueprint domains
- affected-domain output for each task
- optional integration point with existing `task-intake`

Tests:

- screens produce UI implementation tasks
- database schema produces data-model tasks
- bindings produce integration tasks
- design preset produces design-system/governance tasks
- affected-domain lists are deterministic

Verification gate:

```bash
pnpm test run tests/services.blueprint-task-planning.test.ts tests/services.task-intake.test.ts
```

### Phase 7: Plan-Mode Blueprint Artifact UX

Implement only after backend contracts are stable:

- Blueprint artifact references from Plan mode chat messages
- right-pane artifact switching between Project Tree, Blueprint, Diff, and
  document artifacts
- artifact-specific left-column outlines instead of a Project Tree that remains
  visible for every artifact
- Blueprint summary panel with screens, data model, bindings, design preset, and
  validation issues
- component design artifact panel for focused design-system changes
- chat-driven Blueprint revision flow that updates the current draft instead of
  creating an unrelated document
- validation status indicators suitable for the chat timeline and artifact pane
- no freeform app generation UI yet
- no generated-screen runtime renderer yet

Tests:

- Plan mode Blueprint message creates an artifact reference
- artifact switcher opens Blueprint without losing Project Tree access
- Blueprint artifact replaces Project Tree with screen/section outline while
  active
- component design artifact renders variants, token changes, and discussion
  prompts
- Blueprint summary renders screens, data model, bindings, design preset, and
  issues
- chat revision updates the active Blueprint draft and validation summary
- restored conversation can reopen the latest Blueprint artifact

Verification gate:

```bash
pnpm test run tests/routes.nightworkers-workbench.test.ts tests/nightworkers.workbench-selectors.test.ts
pnpm build:frontend
```

### Phase 8: Minimal Catalog and Validation UI

Implement after the Plan-mode artifact UX exists:

- catalog browser
- design preset summary
- blueprint issue list
- validation-only screen or panel for saved Blueprint drafts

Tests:

- saved blueprint validation renders issues
- catalog browser shows documented components
- design preset summary renders selected axes

Verification gate:

```bash
pnpm test run tests/routes.nightworkers-workbench.test.ts tests/nightworkers.workbench-selectors.test.ts
pnpm build:frontend
```

### Phase 9: Run Evidence and ContextStill Hooks

Implement:

- run event linking a run to a blueprint id/version
- run event for blueprint validation result
- run event for blueprint deviations
- memory feedback candidate extraction from blueprint-specific failures

Tests:

- run event JSONL includes blueprint metadata
- replay keeps blueprint metadata
- memory feedback extraction can see blueprint learning hooks

Verification gate:

```bash
pnpm test run tests/services.run-events*.test.ts tests/services.memory-feedback*.test.ts
pnpm verify
```

## Impact Analysis Shape

Each implementation task derived from a blueprint should carry affected domains.

Example:

```ts
type AffectedDomain =
  | 'design-governance'
  | 'blueprint-catalog'
  | 'blueprint-ui'
  | 'blueprint-data'
  | 'blueprint-binding'
  | 'blueprints'
  | 'blueprint-task-planning'
  | 'nightworkers-runtime'
  | 'contextstill-feedback'
  | 'designSystem';
```

This lets NightWorkers answer:

- Which schemas are touched?
- Which validators must run?
- Which UI previews may change?
- Which design-system tests are relevant?
- Which run-event/replay tests are relevant?
- Which ContextStill learning hooks should be inspected?

## Explicit Non-Goals For The First Implementation

- Do not port composia-ui wholesale.
- Do not add `@json-render/*` until a renderer is actually required.
- Do not copy PromptWorkspace.
- Do not add arbitrary screen generation endpoints.
- Do not implement SandboxDB migration or row runtime.
- Do not create physical application tables from blueprints.
- Do not let Blueprint replace implementation plans.
- Do not let Blueprint replace Project Tree; both should be selectable artifact
  views in the same inspection pane.
- Do not wire ContextStill writes directly into blueprint validation.
- Do not expose a large UI before schema and validation contracts are stable.

## First Vertical Slice

The first implementation slice should be:

1. shared schemas for design preset, catalog, UI screen, data model, bindings,
   and aggregate blueprint
2. validation service for cross-domain references
3. tests for valid/invalid representative blueprints
4. docs update with the initial contract

This slice gives NightWorkers a reviewable App Blueprint contract without
committing to a large UI, renderer, database runtime, or direct composia-ui
dependency.

## Success Criteria

This implementation plan is complete when:

- the first blueprint contract exists in `shared/schemas`
- each internal domain has clear tests
- composia-ui concepts are represented as adapted NightWorkers contracts
- rejected composia-ui features are explicitly documented
- a representative MVP blueprint validates end-to-end
- validation issues include paths and messages suitable for UI and run events
- later task planning can identify affected domains from the blueprint
