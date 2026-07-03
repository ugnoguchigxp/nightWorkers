# Plan Mode Phase 3: Dedicated View Generators

## Purpose

Feature Plan から必要時だけ生成される dedicated design view generator を実装する。

Phase 3 の主眼は、旧 `DB Design` generator を `data_model` view に置き換え、`blueprint`、`questionnaire`、`api_io_contract`、`state_model`、`activity_flow`、`sequence_flow`、`zod_schema_design` を新 Plan mode の view 責務で生成できる状態にすること。

このフェーズでは `v1` / `v2` の併存を作らない。旧 `dbDesign`、`DB Design`、`blueprint-db-design` は互換レイヤーとして残さず、新しい `data_model` / dedicated view 名へ置換する。

## Inputs

- [Plan Mode Concept](./plan-mode-concept.md)
- [Phase 1: Artifact Model Replacement](./plan-mode-phase-1-artifact-model-replacement.md)
- [Phase 2: Supervisor Flow Replacement](./plan-mode-phase-2-supervisor-flow-replacement.md)
- Existing questionnaire services
- Existing blueprint generation services
- Existing DB Design / blueprint data-design services
- Existing structured generation prompt helpers

## Phase Boundary

In scope:

- Dedicated view generator の入力、出力、保存 metadata を Plan mode artifact model に合わせる。
- `questionnaire` の review / handoff 表現を `Data Model` 前提に更新する。
- `blueprint` generator を UI 専用 view として維持し、data / DDL / API / Zod の正本を置かないようにする。
- 旧 `DB Design` generator を削除し、`data_model` generator に置換する。
- DB が主題の場合、`data_model` の canonical source を DDL にする。
- DB が主題ではない場合、`data_model` を JSON shape / TypeScript type / storage key / vector payload などのデータ構造 view として扱う。
- `api_io_contract`、`state_model`、`activity_flow`、`sequence_flow`、`zod_schema_design` の generic dedicated view generator を追加する。
- Mermaid を使う view では `stateDiagram`、`flowchart`、`sequenceDiagram` のみ許可する。
- Usecase 図の生成経路を作らない。
- 既存 tests / fixtures を新 view 名へ置換する。

Out of scope:

- Plan mode workspace UI の全面置換。Phase 4 で扱う。
- Dedicated view の高度な編集 UI。
- 旧 artifact の移行画面。
- Specification / Feature Plan 本文の再設計。Phase 1 / Phase 2 の成果を使う。
- AI Coding Rules。
- Usecase 図。

## Current Runtime Touchpoints

| Area | Current file | Current role | Phase 3 action |
| --- | --- | --- | --- |
| API route mount | `api/app.ts` | `dbDesignRouter` を mount する | `dataModelRouter` と dedicated view route に置換する |
| DB Design route | `api/modules/dbDesign/dbDesign-route-definitions.ts` | `/specification-workspace/db-design` と `blueprint-db-design-adoption` を定義する | `/plan-mode/data-model` または Phase 1 の Plan workspace route 名へ置換する |
| DB Design service | `api/modules/dbDesign/dbDesign-generation.service.ts` | AppBlueprint DB Design artifact を生成する | `api/modules/dataModel/dataModel-generation.service.ts` に置換する |
| DB Design barrel | `api/modules/dbDesign/dbDesign.service.ts` | DB Design service export | 削除し `dataModel.service.ts` を追加する |
| Workbench DB Design path | `api/modules/nightworkers/nightworkers.workbench.service.ts` | `blueprint-db-design` request / metadata を扱う | Data Model generation command に置換する |
| Blueprint generator | `api/modules/blueprint/blueprint-generation.service.ts` | Questionnaire から AppBlueprint を生成する | UI view 専用 wording にし、Data Model handoff に変更する |
| Blueprint prompt | `api/services/structured-generation/prompts/app-blueprint.ts` | DB/DDL は DB Design へ回すと指示する | DB Design wording を Data Model に置換する |
| Blueprint request contract | `api/services/blueprints/llm-draft.ts` | `dbDesignWorkflowOnly` で databaseSchema 空を強制する | `dataModelWorkflowOnly` へ rename し、DB 正本ではないことを明示する |
| Old data design helper | `api/services/blueprints/data-design.ts` | `blueprint-db-design-request` を parse し AppBlueprint を返す | 削除または `data-model` helper に置換する |
| Old data design prompt | `api/services/structured-generation/prompts/blueprint-data-design.ts` | AppBlueprint JSON として DB Design を生成する | 削除し Data Model prompt を追加する |
| Questionnaire schema | `shared/schemas/design-questionnaire.schema.ts` | `dbDesignHandoffNotes` を持つ | `dataModelHandoffNotes` に置換する |
| Questionnaire parser | `api/modules/questionnaire/questionnaire-parser.service.ts` | legacy DB Design note を normalize / render する | Data Model note として normalize / render する |
| Questionnaire prompt | `api/services/structured-generation/prompts/design-questionnaire.ts` | DB Design handoff / DDL reference を書かせる | Data Model handoff / DDL reference に置換する |
| Specification renderer | `api/modules/specification/specification-document-renderer.ts` | DB Design DDL を作る | Phase 1 の Feature Plan verification/data_model 参照に合わせる |
| Workspace service | `api/modules/specification/specification-workspace.service.ts` | `source === 'blueprint-db-design'` を DB Design artifact とみなす | `view === 'data_model'` または `source === 'data-model'` に置換する |
| Client command | `src/modules/dbDesign/dbDesignCommands.ts` | DB Design adoption API を呼ぶ | 最小限 rename。UI 再構成は Phase 4 |
| Plan workspace viewer | `src/modules/planMode/PlanModeWorkspaceViewer.tsx` | `generateDbDesignArtifact` を呼ぶ | compile 維持のため Data Model command に置換する |
| Plan workspace panels | `src/modules/planMode/PlanModeWorkspacePanels.tsx` | DB Design panel 表示 | Phase 3 では最低限 Data Model wording にし、詳細 UI は Phase 4 |

## Target Generator Contract

Phase 3 では generator ごとに独自 input を増やさず、Plan mode 共通 input を先に定義する。

```ts
type DedicatedViewGenerationInput = {
  taskId: string;
  view: DedicatedDesignView;
  prompt: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
  routing?: PlanModeRoutingDecision | null;
  reviewAfterGenerate?: boolean;
};
```

保存される message metadata は最低限この形に寄せる。

```ts
type DedicatedViewArtifactMetadata = {
  artifactKind: 'plan_mode_dedicated_view';
  view: DedicatedDesignView;
  source: 'questionnaire' | 'blueprint' | 'data-model' | 'dedicated-view-generator';
  title: string;
  featurePlanMessageId?: string | null;
  questionnaireSessionId?: string | null;
  sourceMessageIds: string[];
  generation: {
    provider?: string;
    model?: string;
    promptVersion: string;
  };
};
```

Data Model だけは DDL / derived summary を扱うため、専用 payload を持つ。

```ts
type DataModelArtifact = {
  artifactKind: 'plan_mode_dedicated_view';
  view: 'data_model';
  canonicalSource: 'ddl' | 'json_shape' | 'typescript_type' | 'zod_schema' | 'storage_contract';
  ddl?: string;
  derivedTables: Array<{
    name: string;
    purpose: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primaryKey?: boolean;
      unique?: boolean;
      defaultValue?: string | null;
    }>;
    indexes: string[];
  }>;
  relations: Array<{
    from: string;
    to: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
    reason: string;
  }>;
  constraints: string[];
  openQuestions: string[];
};
```

DB が主題の場合は `canonicalSource: 'ddl'` を必須にする。`derivedTables`、`relations`、`constraints` は DDL から読める説明であり、別正本にしない。

## Dedicated View Responsibilities

### `questionnaire`

Role:

- 実装判断を止める未確定事項を質問として整理する。
- `open_questions` と `assumptions` を扱う。
- Data Model、Blueprint、API / IO、Zod へ渡す論点を handoff note として残す。

Generator work:

- `dbDesignHandoffNotes` を `dataModelHandoffNotes` に rename する。
- 既存 review output の意味を維持しつつ、DB 固有ではなく Data Model 全般の handoff にする。
- 回答がなくても進められる項目は assumption に落とし、質問を増やしすぎない。

Do not:

- 実装計画の代替にしない。
- Data Model の DDL をここで作らない。

### `blueprint`

Role:

- UI specification を扱う dedicated view。
- 画面、レイアウト、状態別表示、主要操作、表示データのサンプルを扱う。
- `design_view_references` の中心 view になる。

Generator work:

- 通常 Blueprint では `databaseSchema.tables`、`databaseSchema.relations`、`dataBindings` を空にする方針を継続する。
- DB / DDL / data binding は `Data Model` へ渡すと書き換える。
- UI がない task では生成必須にしない。

Do not:

- DDL、API contract、Zod schema の正本を置かない。
- `databaseSchema` を Data Model の保存形式として使わない。

### `data_model`

Role:

- データ構造を見る dedicated view。
- DB が主題なら DDL を canonical source にする。
- DB が主題でなければ JSON shape、TypeScript type、storage key、provider payload、vector metadata などの構造 contract を扱う。

Generator work:

- 旧 `DB Design` generator をここに置換する。
- 出力は AppBlueprint JSON ではなく Data Model artifact にする。
- DDL 生成時は `CREATE TABLE`、PK、FK、index、unique、nullable、default を明示する。
- DDL を作らないケースでは `canonicalSource` を DDL 以外にし、なぜ DB 正本ではないかを artifact に残す。
- Blueprint から渡された UI サンプルは参照情報として使い、Data Model の正本は Data Model artifact 内に置く。

Do not:

- AppBlueprint `databaseSchema` を正本にしない。
- DDL と JSON summary の二重正本を作らない。
- SQL migration 実行や runtime DB 操作をしない。

### `api_io_contract`

Role:

- API route、worker tool、MCP tool、native bridge、provider adapter の境界契約を扱う。
- request / response / error / idempotency / pagination / streaming / timeout を必要な範囲で明示する。

Generator work:

- Feature Plan 本文に収まる軽い I/O は dedicated view にしない。
- 複数 endpoint、複数 actor、互換性制約がある場合だけ dedicated view として生成する。
- Error model / permission boundary が contract に強く関係する場合はこの view 内の section として扱う。

Do not:

- internal algorithm を API contract として書かない。
- 実装予定のない endpoint を足さない。

### `state_model`

Role:

- status / lifecycle / queue state / artifact state を表す。
- Mermaid `stateDiagram-v2` または表を使う。

Generator work:

- 実装対象の state と transition だけを生成する。
- transition の trigger、guard、side effect を表か note に残す。
- Error state と retry state が実装に影響する場合は明示する。

Do not:

- 将来構想の state を混ぜない。
- Activity flow と同じ内容を重複生成しない。

### `activity_flow`

Role:

- 条件分岐、fallback、retry、validation、error handling を表す。
- Mermaid `flowchart` または表を使う。

Generator work:

- Acceptance Criteria と実装 step に対応する branch だけを生成する。
- LLM failure、schema parse failure、missing source artifact など、実装で分岐する failure を表す。

Do not:

- 通常処理の説明を過剰に図化しない。
- UI navigation の詳細は Blueprint に寄せる。

### `sequence_flow`

Role:

- 複数主体の呼び出し順を表す。
- Mermaid `sequenceDiagram` を使う。

Generator work:

- User / UI / API / service / repository / LLM provider / worker など、実装に存在する actor だけを書く。
- async job、background worker、tool call、provider call が絡む場合に生成する。

Do not:

- 実装対象外の actor を足さない。
- 単一 service 内の処理順を無理に sequence にしない。

### `zod_schema_design`

Role:

- Zod schema、JSON schema、LLM response schema、tool input schema の validation design を扱う。
- default、strictness、compat normalization、refinement、migration の方針を明示する。

Generator work:

- 実装予定の schema 名、owner file、input source、output consumer を書く。
- 互換 normalize が必要な場合は、何を許容し、何を reject するかを具体化する。
- Data Model と重なる場合、DB DDL は Data Model、runtime validation は Zod と分ける。

Do not:

- DB DDL の代替にしない。
- 生成 code をそのまま最終実装と扱わない。

## Mermaid Policy

許可:

- `state_model`: `stateDiagram-v2`
- `activity_flow`: `flowchart TD` または `flowchart LR`
- `sequence_flow`: `sequenceDiagram`

禁止:

- `usecase`
- `journey`
- `gantt`
- 実装対象外の actor / state / lane

Mermaid を生成する場合、artifact は Markdown として保存し、metadata に `diagramKind` を入れる。

```ts
type PlanDiagramArtifact = {
  artifactKind: 'plan_mode_dedicated_view';
  view: 'state_model' | 'activity_flow' | 'sequence_flow';
  title: string;
  markdown: string;
  diagramKind: 'stateDiagram-v2' | 'flowchart' | 'sequenceDiagram';
};
```

## Implementation Steps

### Step 0. Baseline And Ownership Check

Before editing, confirm the current DB Design / Blueprint / Questionnaire paths.

Commands:

```bash
rg -n "dbDesign|DB Design|blueprint-db-design|db_design|data-design|dbDesignHandoffNotes" api src shared tests
rg -n "specification-workspace/db-design|blueprint-db-design-adoption" api src tests
```

Expected findings:

- `api/modules/dbDesign/*` owns the old DB Design route and generator.
- `api/services/blueprints/data-design.ts` and `api/services/structured-generation/prompts/blueprint-data-design.ts` still produce AppBlueprint-shaped DB Design output.
- `shared/schemas/design-questionnaire.schema.ts` still contains `dbDesignHandoffNotes`.
- Client compile currently depends on `src/modules/dbDesign/*` and `PlanModeWorkspaceViewer.tsx`.

### Step 1. Add Dedicated View Schemas

Create or extend Phase 1 schema files so Phase 3 generators have stable contracts.

Target files:

- `shared/schemas/plan-mode-artifact.schema.ts`
- `shared/schemas/design-questionnaire.schema.ts`
- New `shared/schemas/data-model-artifact.schema.ts` if the Data Model payload becomes large enough to keep separate.
- New `shared/schemas/dedicated-view-artifact.schema.ts` only if non-Data-Model view payloads need validation beyond metadata.

Required schemas:

- `dedicatedDesignViewSchema`
- `dedicatedViewArtifactMetadataSchema`
- `dataModelArtifactSchema`
- `planDiagramArtifactSchema`
- `zodSchemaDesignArtifactSchema`

Acceptance:

- `DedicatedDesignView` includes `questionnaire`, `blueprint`, `data_model`, `api_io_contract`, `state_model`, `activity_flow`, `sequence_flow`, `zod_schema_design`.
- No schema export uses `dbDesign` as the primary name.
- `data_model` can represent both DDL-backed and non-DB data structures.

### Step 2. Replace Questionnaire Handoff Names

Rename DB Design handoff to Data Model handoff.

Target files:

- `shared/schemas/design-questionnaire.schema.ts`
- `api/modules/questionnaire/questionnaire-parser.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- Tests that assert `dbDesignHandoffNotes`

Implementation details:

- Replace `dbDesignHandoffNoteSchema` with `dataModelHandoffNoteSchema`.
- Replace `dbDesignHandoffNotes` with `dataModelHandoffNotes`.
- Keep normalization behavior, but update labels:
  - `DB Design note` -> `Data Model note`
  - `## DB Design Handoff` -> `## Data Model Handoff`
- Do not keep a public `dbDesignHandoffNotes` field. If temporary parse tolerance is needed for old LLM output, normalize it internally and emit only `dataModelHandoffNotes`.

Acceptance:

- Generated questionnaire review can mention Data Model handoff.
- Output JSON no longer exposes `dbDesignHandoffNotes`.
- Existing questionnaire tests pass after assertion updates.

### Step 3. Replace Blueprint Generator Wording

Keep the Blueprint generator, but make it explicitly UI-owned.

Target files:

- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/services/structured-generation/prompts/app-blueprint.ts`
- `api/services/blueprints/llm-draft.ts`
- `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`
- `tests/services.blueprints.test.ts`
- `tests/services.blueprint-draft.test.ts`

Implementation details:

- Rename `dbDesignWorkflowOnly` to `dataModelWorkflowOnly` in the request contract.
- Replace `DB Design workflow` wording with `Data Model view`.
- Keep AppBlueprint `databaseSchema` and `dataBindings` empty for normal Blueprint generation.
- Keep `databaseSchema` in AppBlueprint schema only for compatibility / preview needs, not as Data Model正本.

Acceptance:

- Normal Blueprint generation still returns valid AppBlueprint.
- Blueprint prompt says Data Model owns data structure / DDL decisions.
- Tests no longer assert DB Design wording for the Blueprint boundary.

### Step 4. Replace DB Design Module With Data Model Module

Remove the old DB Design generator and route names.

Delete or replace:

- `api/modules/dbDesign/dbDesign-generation.service.ts`
- `api/modules/dbDesign/dbDesign-route-definitions.ts`
- `api/modules/dbDesign/dbDesign.routes.ts`
- `api/modules/dbDesign/dbDesign.service.ts`
- `api/services/blueprints/data-design.ts`
- `api/services/structured-generation/prompts/blueprint-data-design.ts`

Add:

- `api/modules/dataModel/dataModel-generation.service.ts`
- `api/modules/dataModel/dataModel-route-definitions.ts`
- `api/modules/dataModel/dataModel.routes.ts`
- `api/modules/dataModel/dataModel.service.ts`
- `api/services/structured-generation/prompts/data-model.ts`

Route target:

```txt
POST /api/tasks/:id/plan-mode/data-model
```

If Phase 1 introduces a different Plan workspace route prefix, use that prefix consistently. Do not keep `/specification-workspace/db-design`.

Implementation details:

- `generateDataModelArtifact(taskId, input)` should load task, questionnaire session, source Blueprint, and latest Feature Plan if available.
- Capability check should use `assertPlanModeCapabilityEnabled('data_model')`.
- Message metadata should use:
  - `artifactKind: 'plan_mode_dedicated_view'`
  - `view: 'data_model'`
  - `source: 'data-model'`
  - `sourceMessageIds`
  - `questionnaireSessionId`
  - `sourceBlueprintMessageId`
- The LLM prompt must return Data Model JSON or Markdown+JSON according to the schema, not AppBlueprint JSON.
- When `canonicalSource === 'ddl'`, generated DDL must be copied into the artifact payload and rendered in the message body.
- No runtime migration, DB write, or SQL execution happens in this generator.

Acceptance:

- `blueprint-db-design` no longer appears in new generation metadata.
- Data Model artifact can be generated without a Blueprint when UI is irrelevant.
- Data Model artifact can use Blueprint as context when UI exists.
- Tests prove DDL-backed output and non-DB data structure output.

### Step 5. Add Generic Dedicated View Generator

Add one service for non-Blueprint, non-Questionnaire, non-Data-Model views.

Target files:

- New `api/modules/planViews/planView-generation.service.ts`
- New `api/modules/planViews/planView-route-definitions.ts`
- New `api/modules/planViews/planView.routes.ts`
- New `api/services/structured-generation/prompts/plan-dedicated-view.ts`
- `api/app.ts`

Supported views:

- `api_io_contract`
- `state_model`
- `activity_flow`
- `sequence_flow`
- `zod_schema_design`

Route target:

```txt
POST /api/tasks/:id/plan-mode/views/:view/generate
```

Request body:

```ts
{
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
  reviewAfterGenerate?: boolean;
}
```

Implementation details:

- Reject unsupported view names with schema validation.
- Reject `questionnaire`, `blueprint`, `data_model` on this generic route; those have specialized flows.
- Build prompt from Feature Plan, questionnaire review, Blueprint summary, Data Model summary, and task objective.
- Use view-specific output instructions:
  - `api_io_contract`: Markdown with request / response / error / permission sections.
  - `state_model`: Markdown with `stateDiagram-v2` or table.
  - `activity_flow`: Markdown with `flowchart`.
  - `sequence_flow`: Markdown with `sequenceDiagram`.
  - `zod_schema_design`: Markdown with schema owner table and optional TypeScript code fence.
- Validate Mermaid diagram kind by string guard before saving.
- Reject or regenerate if output contains `usecaseDiagram` or `usecase`.

Acceptance:

- Each supported view can generate a message with `artifactKind: 'plan_mode_dedicated_view'`.
- Mermaid views use only allowed diagram kinds.
- Generic generator does not create Blueprint or Data Model artifacts.

### Step 6. Update Workspace Selection And Message Classification

Make generated dedicated view messages discoverable without old DB Design selectors.

Target files:

- `api/modules/specification/specification-workspace.service.ts`
- `src/modules/specification/specificationWorkspaceModel.ts`
- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/nightworkers/types/blueprint.ts` or Phase 1 replacement types
- Tests under `tests/nightworkers.workbench-selectors.test.ts`

Implementation details:

- Select by `metadata.artifactKind === 'plan_mode_dedicated_view'` and `metadata.view`.
- Replace `dbDesignArtifacts` with `dataModelArtifacts` if Phase 1 has not already done it.
- Add a generic `dedicatedViewArtifacts` collection only if the UI needs to list all non-core views before Phase 4.
- Keep normal Blueprint messages out of Data Model lists.

Acceptance:

- Data Model messages are not promoted into normal Blueprint refs.
- Blueprint messages are not treated as Data Model.
- Generic dedicated view messages can be retrieved by view.

### Step 7. Minimal Client Compile Update

Phase 4 owns the real UX, but Phase 3 must not leave broken imports.

Target files:

- `src/modules/dbDesign/*`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

Implementation details:

- Rename `src/modules/dbDesign` to `src/modules/dataModel`.
- Replace `generateDbDesignArtifact` with `generateDataModelArtifact`.
- Replace visible text `DB Design` with `Data Model`.
- Keep existing panel layout as a temporary Data Model panel. Do not redesign in this phase.

Acceptance:

- TypeScript imports resolve.
- UI copy no longer exposes DB Design as a dedicated artifact name.
- Detailed tab layout changes remain Phase 4 work.

### Step 8. Update Tests And Fixtures

Replace DB Design tests with Data Model / dedicated view tests.

Rename or replace:

- `tests/services.blueprint-data-design.test.ts` -> `tests/services.data-model-generation.test.ts`
- DB Design assertions in `tests/services.design-questionnaire-prompts.test.ts`
- DB Design assertions in `tests/services.blueprints.test.ts`
- DB Design route assertions in `tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts`
- DB Design workbench assertions in `tests/nightworkers-workbench-routes/routes-workbench-03.test.ts`
- DB Design selector assertions in `tests/nightworkers.workbench-selectors.test.ts`

Add:

- `tests/services.plan-view-generators.test.ts`
- Mermaid guard cases for `state_model`, `activity_flow`, `sequence_flow`
- Zod schema design output case
- Data Model DDL canonical case
- Data Model non-DB shape case

Acceptance:

- No test name or assertion treats DB Design as the current artifact.
- Tests cover omission: UI-less task can generate Data Model without Blueprint.
- Tests cover inclusion: UI task can generate Blueprint and Data Model separately.

## Data Model Prompt Requirements

The Data Model prompt must be explicit about canonical source.

Required system rules:

- `data_model` は data structure view であり、Blueprint の一部ではない。
- DB が実装対象なら DDL を正本として出力する。
- DDL は実行指示ではなく設計 artifact である。
- DDL から table / column / relation / index summary を派生させる。
- DB が実装対象でないなら、JSON shape、TypeScript type、Zod schema、storage contract など、最も近い正本を `canonicalSource` にする。
- AppBlueprint JSON を返さない。
- migration 実行、runtime DB call、seed data 作成はしない。

Required output cases:

- DDL-backed relational model
- Non-relational JSON / document shape
- Provider / tool payload model
- No persistent data model needed

## Dedicated View Prompt Requirements

Generic dedicated view prompt must include:

- Feature Plan summary
- Relevant acceptance criteria
- Relevant questionnaire decisions / assumptions
- Relevant Blueprint summary only when UI exists
- Relevant Data Model summary only when data structure affects the view
- Allowed output format for the selected view
- Explicit non-goals

The prompt must not ask for all views at once. It generates exactly one view.

## Legacy Removal Checklist

Remove as current runtime concepts:

- `DB Design` as artifact label
- `dbDesign` as capability name
- `dbDesignArtifacts`
- `dbDesignHandoffNotes`
- `blueprint-db-design`
- `blueprint-db-design-request`
- `/specification-workspace/db-design`
- `/blueprint-db-design-adoption`
- `BlueprintDbDesignPanel`
- `buildBlueprintDbDesignPrompt`
- `buildBlueprintDataDesignPrompt`

Allowed only in migration comments/tests:

- Short comments explaining why old DB Design fixtures were replaced.
- Text audit allowlist entries while actively deleting files in the same branch.

## Verification

Run focused tests first:

```bash
bunx vitest run \
  tests/services.data-model-generation.test.ts \
  tests/services.plan-view-generators.test.ts \
  tests/services.design-questionnaire-prompts.test.ts \
  tests/services.blueprints.test.ts \
  tests/schemas.app-blueprint.test.ts
```

Run route / selector tests that cover artifact discovery:

```bash
bunx vitest run \
  tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts \
  tests/nightworkers-workbench-routes/routes-workbench-03.test.ts \
  tests/nightworkers.workbench-selectors.test.ts
```

Run compile and formatting checks:

```bash
bun run typecheck
git diff --check
```

Run text audit:

```bash
rg -n "blueprint-db-design|blueprint-db-design-request|dbDesign|DB Design|db_design|specification-workspace/db-design|blueprint-db-design-adoption|Usecase|usecase" api src shared tests
```

Expected text audit result:

- No current runtime references to old DB Design names.
- No Usecase diagram generation path.
- Any remaining match is either an intentional migration note in documentation or a test fixture explicitly marked as legacy input normalization.

## Done Criteria

- Data Model generation replaces DB Design generation end to end.
- Data Model output is not AppBlueprint JSON.
- DB-backed Data Model uses DDL as canonical source.
- Blueprint generation remains UI-focused and does not own data model正本.
- Questionnaire handoff points to Data Model, not DB Design.
- Generic dedicated view generator can create `api_io_contract`, `state_model`, `activity_flow`, `sequence_flow`, and `zod_schema_design`.
- Mermaid generation is limited to state / activity / sequence diagrams.
- Client imports compile after minimal Data Model rename.
- Phase 4 can focus on UX without needing to redesign generator semantics.

## Stop Conditions

Stop and adjust the plan if any of these happen:

- Phase 1 artifact schema is still unsettled enough that message metadata names cannot be chosen.
- Data Model output cannot be represented without keeping AppBlueprint as the canonical DB structure.
- Existing tests require keeping public `dbDesign` fields for current runtime behavior.
- Mermaid validation requires a parser dependency decision that should be made with UI rendering in Phase 4.

In those cases, do not add `v2` names. Resolve the new canonical name first, then continue replacement.
