# Mock Blueprint Verification Checklist

## Required Test Files

Update or add tests in these files first:

- `tests/mock-blueprint.test.ts`
- `tests/artifact-workspace-viewer.test.ts`
- `tests/nightworkers.workbench-selectors.test.ts`
- `tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`

Only add a new test file if these cannot express the behavior cleanly.

## Focused Test Matrix

### Schema And Contract

In `tests/mock-blueprint.test.ts`:

- Representative fixture validates with `mockBlueprintSchema`.
- `mockBlueprintSchema` requires root `meta`.
- `meta.selectedSections` contains section types and reasons.
- Component/dataset mismatch fails validation.
- Dataset minimums are enforced:
  - table has 2+ columns and 5+ rows,
  - form has 2+ fields,
  - navigation has 2+ items,
  - cards/timeline/chat/generic have 2+ items,
  - metrics has 2+ metrics.
- Provider JSON schema root `required` includes `meta`.
- Provider meta schema nested `required` includes every nested property.
- Provider schema remains compact.

Suggested command:

```bash
bunx vitest run tests/mock-blueprint.test.ts
```

### Normalization And Repair

In `tests/mock-blueprint.test.ts`:

- LLM fixture missing `meta` is normalized to valid output.
- LLM fixture with empty dataset arrays is normalized before final schema validation.
- DataTable empty rows are repaired to at least 5 rows.
- Repaired data uses generic mock content or section copy, not hardcoded BBS data.
- Raw JSON with trailing malformed fragments is repaired only when a balanced JSON object exists.
- Invalid unrecoverable JSON still returns `SPECIFICATION_BLUEPRINT_FAILED` with useful raw output metadata.

### Prompt Budget And Prompt Content

In `tests/mock-blueprint.test.ts`:

- `buildMockBlueprintSystemPrompt` byte length stays under the agreed limit.
- `buildMockBlueprintStructuredOutputJsonSchema` byte length stays under the agreed limit.
- `mockBlueprintPromptDiagnostics` includes:
  - `systemPromptBytes`
  - `userPromptBytes`
  - `systemPromptEstimatedTokens`
  - `userPromptEstimatedTokens`
  - `totalPromptEstimatedTokens`
  - `sectionAllowlistCount`
  - `schemaDigest`
- Prompt does not contain BBS-specific fixed section plans.
- Prompt does contain general analytics gating guidance.
- Prompt contains sidebar placeholder prohibition.
- Prompt uses `Spec` / `仕様書` in user-facing wording, not `Feature Plan`.

### Preview Rendering

In `tests/artifact-workspace-viewer.test.ts`:

- `WorkspaceBlueprintPreview` renders `data-blueprint-preview="true"` when `message.metadataJson.mockBlueprint` exists.
- `WorkspaceBlueprintPreview` renders preview when message only has `artifactRef` and linked activity artifact has Mock Blueprint JSON.
- `WorkspaceBlueprintPreview` renders preview when message is missing but latest activity artifact has Mock Blueprint JSON.
- Successful Mock Blueprint render does not include `No Blueprint artifact.`.
- Successful Mock Blueprint render does not include `Mock Blueprint Summary`.
- Numeric SQLite timestamps select the latest Mock Blueprint correctly.

Suggested server-render assertion:

```ts
expect(markup).toContain('data-blueprint-preview="true"');
expect(markup).not.toContain('No Blueprint artifact.');
expect(markup).not.toContain('Mock Blueprint Summary');
```

### Artifact Selection

In `tests/nightworkers.workbench-selectors.test.ts`:

- Activity artifact with `metadataJson.intent === 'mock_blueprint'` is included as `kind: 'app_blueprint'`.
- Message covered by activity artifact is not duplicated.
- Artifact ref preserves `metadata.mockBlueprint`.
- Latest artifact sorting works with ISO strings, numeric seconds, and numeric millisecond values.

### Route Behavior

In `tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`:

- `POST /api/tasks/:id/plan-mode/blueprint` returns a message with:
  - `metadataJson.intent === 'mock_blueprint'`
  - `metadataJson.mockBlueprint`
  - `metadataJson.generation.llmUsage` when usage exists
  - `metadataJson.artifactRef`
- The route persists an activity artifact with:
  - `metadataJson.schemaName === 'mock_blueprint'`
  - `metadataJson.mockBlueprint`
  - parseable JSON `contentText`
- Schema/parse failure stores raw output metadata when raw output exists.

## Runtime SQL Checks

After generating a real Mock Blueprint locally, inspect persisted data.

Messages:

```bash
sqlite3 -json sqlite.db "
select
  id,
  task_id as taskId,
  json_extract(metadata_json,'$.intent') as intent,
  json_type(metadata_json,'$.mockBlueprint') as mockBlueprintType,
  json_extract(metadata_json,'$.artifactRef.artifactId') as artifactId,
  json_type(metadata_json,'$.generation.llmUsage') as usageType,
  substr(content,1,120) as contentStart,
  created_at as createdAt
from task_messages
where json_extract(metadata_json,'$.intent')='mock_blueprint'
order by created_at desc
limit 5;
"
```

Activity artifacts:

```bash
sqlite3 -json sqlite.db "
select
  id,
  task_id as taskId,
  kind,
  json_extract(metadata_json,'$.intent') as intent,
  json_extract(metadata_json,'$.schemaName') as schemaName,
  json_type(metadata_json,'$.mockBlueprint') as mockBlueprintType,
  json_type(metadata_json,'$.generation.llmUsage') as usageType,
  substr(content_text,1,120) as contentStart,
  created_at as createdAt
from activity_artifacts
where json_extract(metadata_json,'$.intent')='mock_blueprint'
order by created_at desc
limit 5;
"
```

Expected:

- `mockBlueprintType` is `object`.
- `usageType` is `object` or null only if no usage record was available.
- `contentStart` begins with JSON for activity artifacts.
- `createdAt` sorts to the newest generated artifact.

## Manual UI Smoke Check

Run a local app session and generate a BBS Mock Blueprint.

The first Blueprint tab view must show:

- actual mockup UI,
- realistic BBS-like labels and dummy data,
- table rows if a table was chosen,
- no `No Blueprint artifact.`,
- no Markdown summary as the main surface.

The first Blueprint tab view must not show:

- Analytics dashboard unless the user asked for analytics/reporting,
- placeholder sidebars,
- ads/sponsored/newsletter placeholders,
- Spec/review/progress notes as product UI.

Meta/usage:

- Meta is closed by default.
- Opening Meta shows only `intent` and `selectedSections`.
- Token usage is visible as secondary information and does not replace preview.

## Final Commands

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

## Completion Gate

Do not call the implementation done until all are true:

- Focused tests pass.
- `bun run lint` passes.
- `bun run typecheck` passes.
- `bun run verify` passes.
- Manual BBS smoke check shows Blueprint Mockup UI first.
- Runtime SQL confirms Mock Blueprint JSON and usage metadata are persisted.
- Prompt diagnostics show compact input size, not a 60k-token request.
