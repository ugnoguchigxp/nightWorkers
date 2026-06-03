# Blueprint DB Design UI Implementation Plan

## Goal

Add a DB Design button beside the existing Design button in Blueprint Preview.
When pressed, it opens a DB Design workspace for the current Blueprint artifact.
The workspace lets the user inspect the tables required by the Blueprint, select
which table or binding needs more design work, and ask the coding agent to
reason about the data model.

This is a Blueprint design feature, not a physical database runtime. The first
slice updates the Blueprint's `databaseSchema` and `dataBindings` contract and
records the reasoning as reviewable workbench messages. DDL/table/column
reasoning belongs here, not in the normal visual Blueprint generation path.

## Investigation Summary

### Current NightWorkers State

- `ArtifactPane` already extracts `metadata.appBlueprint.screens`,
  `databaseSchema.tables`, and `dataBindings`, then passes them into
  `BlueprintPreview`.
- `BlueprintPreview` already has a top-row Design button and local design
  settings accordion.
- `shared/schemas/app-blueprint-data.schema.ts` defines the current
  `BlueprintDatabaseSchema` contract: tables, columns, relations, and indexes.
- `api/services/blueprints/validation.ts` already validates duplicate tables,
  duplicate columns, relation references, binding table references, and binding
  field references.
- Workbench messages already support `markdown_document` artifacts with
  `metadataJson.appBlueprint`.

The missing piece is not basic display. The missing piece is a DB Design action
surface that turns the current Blueprint data contract into a focused agent
request and receives a revised Blueprint artifact or DB design artifact.

### Relevant composia-ui Behavior

The closest composia-ui source is `../composia-ui/src/modules/database-design`.
Useful behavior to adapt:

- `/dbdesign` shows current SandboxDB state and a Draft list.
- `/dbdesign/drafts/:databaseSchemaJsonId` shows a Draft detail workspace.
- Draft detail renders table accordions with column tables, index badges, and
  binding summaries.
- Draft detail has an AI Draft re-proposal panel with conversation history and a
  focused prompt textarea.
- The provider receives current DB state, selected draft intent, current screen,
  and the latest user instruction, then returns a complete desired DB design
  object, not a diff.

Behavior to avoid in NightWorkers v1:

- Postgres SandboxDB introspection as source of truth.
- migration preview / apply.
- row viewer.
- DROP table controls.
- direct route copy of composia-ui `PromptWorkspace` or `@json-render/*`.
- composia-ui runtime dependency.

## Product Framing

Blueprint Preview is the discussion surface. DB Design should sit inside that
same artifact pane because the user is deciding whether the Blueprint is
implementable, not leaving the workbench to manage a real database.

The intended workflow is:

1. User creates or opens an App Blueprint.
2. User reviews the visual Preview with the existing Design button if needed.
3. User presses DB Design.
4. The DB Design panel shows the current tables, relations, and bindings
   inferred from the Blueprint.
5. User chooses a table, relation, binding, or screen context and asks the
   coding agent to improve it.
6. NightWorkers creates a new assistant message with a revised App Blueprint or
   a DB Design draft artifact.
7. The user reopens the revised Blueprint and sees the updated table design in
   the same Preview surface.
8. The user marks the DB Design as adopted or not adopted. The decision is
   stored separately from the visual Blueprint and Design Token decisions.

## UX Shape

The Blueprint Preview top row should become:

```txt
Design Preview
  Header row
    section count
    Design button
    DB Design button
  Design settings accordion
  DB Design panel
  Preview canvas
```

The DB Design button should:

- live beside the existing Design button.
- use a database/table icon from `lucide-react`, likely `Database` or `Table2`.
- expose `aria-expanded`.
- toggle a panel without navigating away from the artifact.
- be disabled only when there is no active Blueprint artifact context.

The DB Design panel should reuse the composia-ui layout shape:

```txt
DB Design panel
  Summary badges
    N tables / N relations / N bindings / validation status
  Table accordion
    table name
    column count / index count / binding count
    expanded column table
    relation badges
    related binding list
    Design this table button
  Binding summary
    section / binding / mode / table / fields
  Agent request panel
    selected target
    prompt textarea
    submit button
```

The first slice should not show DDL or SQL. If a SQL-looking preview is useful
later, label it as a design-time approximation.

## State Model

Introduce UI-only selection state near `BlueprintPreview`:

```ts
type BlueprintDbDesignTarget =
  | { kind: 'schema' }
  | { kind: 'table'; tableName: string }
  | { kind: 'relation'; relationId: string }
  | { kind: 'binding'; bindingId: string }
  | { kind: 'screen'; screenId: string; sectionId?: string };

type BlueprintDbDesignRequest = {
  blueprintId: string;
  target: BlueprintDbDesignTarget;
  prompt: string;
  currentBlueprint: AppBlueprint;
  validationIssues: BlueprintValidationIssue[];
};
```

The UI panel should not mutate the Blueprint locally. It should submit a
request to the workbench agent path and wait for a new artifact message. This
keeps agent reasoning, prompt diagnostics, and validation evidence in the same
message timeline as other Blueprint changes.

## Backend Contract

Add a new workbench intent:

```ts
type WorkbenchChatIntent =
  | ...
  | 'design_component'
  | 'design_blueprint_data';
```

The intent should route to a focused Blueprint data-design generator rather than
generic intake. This preserves the current architecture where the runtime does
not branch on arbitrary keywords.

Proposed service:

```txt
api/services/blueprints/data-design.ts
```

Responsibilities:

- accept the current `AppBlueprint`, selected target, validation issues, and
  latest user prompt.
- build a strict LLM prompt for "return complete revised AppBlueprint JSON".
- instruct the model to preserve existing screens and designPreset unless the
  data design requires a binding change.
- require `databaseSchema.tables`, `databaseSchema.relations`, and
  `dataBindings` to be internally consistent.
- validate with `appBlueprintSchema` and `validateAppBlueprint`.
- return a revised Blueprint plus diagnostics.

Non-responsibilities:

- creating physical tables.
- generating Drizzle schema files.
- applying migrations.
- opening a separate database route.
- replacing the existing Blueprint artifact message in place.

Adoption persistence:

- Blueprint artifact decisions live in `blueprint_artifact_adoptions`.
- DB Design decisions live in `blueprint_db_design_adoptions`.
- Design Token decisions live in `blueprint_design_token_adoptions`.
- Each row is keyed by the Workbench session `task_id` and source conversation
  `message_id`; later implementation-plan generation should consult these
  tables and prefer adopted rows only.

## Provider Prompt Shape

Adapt the useful composia-ui provider idea: pass complete current state plus the
latest instruction, and request a complete desired object rather than a diff.

Prompt payload:

```json
{
  "source": "blueprint-db-design",
  "target": { "kind": "table", "tableName": "orders" },
  "currentBlueprint": {},
  "validationIssues": [],
  "latestUserInstruction": "注文一覧に必要なステータス履歴も設計してください"
}
```

System rules:

- Return AppBlueprint JSON only.
- Preserve the Blueprint id/name/version unless the task explicitly asks to
  rename the product.
- Preserve `screens` and `designPreset` unless binding or section source must
  change to keep the data contract coherent.
- Use `^[a-z][a-z0-9-]*$` for Blueprint ids, table names, column names, binding
  ids, and relation ids.
- Include at least one primary key column for every table.
- When a section has `dataBindingId`, the binding must exist.
- When a binding references fields, each field must exist on the referenced
  table.
- Do not return SQL, migrations, Drizzle code, or runtime DB calls.
- Return the complete revised Blueprint, not a patch.

## Frontend Implementation Slices

### Slice 1: Extract DB Design Display Components

Add:

- `src/modules/nightworkers/components/blueprint-preview/BlueprintDbDesignPanel.tsx`
- `src/modules/nightworkers/components/blueprint-preview/dbDesignModel.ts`

Move no existing preview renderer code in this slice unless needed for typing.

Component responsibilities:

- render table accordions.
- render a column table similar to composia-ui `DraftColumnTable`.
- render relation badges.
- render binding summaries.
- maintain selected design target.
- call an `onSubmitDbDesignRequest` callback.

### Slice 2: Add the DB Design Button

Update `BlueprintPreview`:

- add `dbDesignOpen` state.
- add the DB Design button beside Design.
- pass `blueprint`, `screens`, `tables`, `bindings`, and validation issues into
  `BlueprintDbDesignPanel`.

Update `ArtifactPane`:

- pass validation issues into `BlueprintPreview`.
- pass a callback capable of submitting a workbench message.

This likely requires threading a submit callback from `NightWorkersShell` down
to `ArtifactPane`, because `BlueprintPreview` currently has no workspace
mutation access.

### Slice 3: Submit Agent Requests

Add a frontend helper that turns a panel request into a compact prompt:

```md
Blueprint DB Design request
Target: table orders
Instruction: ...
Current Blueprint JSON: ...
Validation issues: ...
```

Call:

```ts
sendWorkbenchMessage(sessionId, prompt, 'design_blueprint_data')
```

The server should receive both the textual prompt and a structured request if
possible. If structured request plumbing is too broad for the first slice, keep
the JSON request embedded in the prompt but validate the current artifact again
server-side before trusting it.

### Slice 4: Backend Generator

Implement `generateBlueprintDataDesignDraft` beside the current Blueprint draft
generator.

Server flow:

1. append the user's DB Design request message.
2. parse or receive the structured `BlueprintDbDesignRequest`.
3. call the focused generator.
4. validate the revised Blueprint.
5. create a new `markdown_document` assistant message with:
   - `intent: 'app_blueprint'`
   - `source: 'blueprint-db-design'`
   - `appBlueprint`
   - `validation`
   - `generation`
   - `parentBlueprintId`
   - `dbDesignTarget`

This keeps the existing artifact picker and timeline behavior working without a
new artifact kind in the first slice.

### Slice 5: Optional Dedicated Artifact Kind

Only after revised Blueprint messages are stable, consider adding a
`blueprint_data_design` artifact kind.

Use it if users need to compare multiple DB design drafts without replacing the
main Blueprint mental model. Do not add it in v1 unless the timeline becomes
ambiguous.

## Schema Follow-Ups

The current NightWorkers schema is intentionally smaller than composia-ui's
`DatabaseSchemaJson`. These additions are useful, but not required for the first
UI slice:

- table `description`.
- table `ui` hints such as `displayField` and default sort.
- column widget or `ui` hints beyond the current `uiHint`.
- relation `onDelete`.
- data binding operation names closer to composia-ui's `list` / `create`
  language.

Do not add all of these at once. Add only the fields the panel must display or
the generator must preserve.

## Tests

Focused tests:

- `tests/blueprint-db-design-panel.test.tsx`
  - renders DB Design button beside Design.
  - opens the DB Design panel.
  - renders table accordions and column details.
  - selects a table target.
  - submits a prompt with the selected target.
- `tests/services.blueprint-data-design.test.ts`
  - preserves screens/designPreset.
  - updates table columns and bindings.
  - rejects invalid table references.
  - records validation diagnostics.
- `tests/routes.nightworkers-workbench.test.ts`
  - `design_blueprint_data` creates a revised app_blueprint artifact message.

Verification:

```bash
pnpm test run tests/blueprint-db-design-panel.test.tsx
pnpm test run tests/services.blueprint-data-design.test.ts tests/routes.nightworkers-workbench.test.ts
pnpm typecheck
pnpm lint
pnpm verify
```

For UI verification, run the dev server and open a Blueprint artifact with a
database schema. Confirm the Design and DB Design panels can be opened
independently and that the artifact pane remains usable at narrow widths.

## Acceptance Criteria

- DB Design button appears beside the existing Design button in Blueprint
  Preview.
- Pressing DB Design opens a panel without leaving the artifact pane.
- The panel shows current Blueprint tables, columns, relations, bindings, and
  validation status.
- The user can select a schema/table/relation/binding/screen target.
- The user can submit a focused DB Design instruction to the coding agent.
- The agent response creates a revised `app_blueprint` artifact message.
- Revised Blueprint output passes `validateAppBlueprint` or records clear
  validation failure diagnostics.
- No physical DB tables, migrations, SandboxDB calls, or SQL apply actions are
  introduced in v1.

## Recommended Build Order

1. Panel-only UI with callback tests.
2. `design_blueprint_data` intent plumbing.
3. Focused backend generator and validation tests.
4. Wire panel submit to workbench message submission.
5. Manual artifact-pane verification with a representative Blueprint.
6. Consider schema follow-ups only after the first flow is reviewable end to
   end.
