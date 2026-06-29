# Plan Mode Domain Separation Plan

## Purpose

Plan Mode の `Questionnaire`、`Blueprint`、`DB Design`、`Specification` を `nightworkers` core から分離する。

前回の `NightWorkers Domain Separation Plan` は Settings / MCP / Hooks / Todo / Queue を主対象にしており、Plan Mode 系は明示的に対象外だった。この計画はその後続として、Plan Mode 系の route、service、repository、frontend workspace UI の所有権を実際に移す。

最終状態では `api/modules/nightworkers` と `src/modules/nightworkers` は coding agent / workbench session / run lifecycle を所有し、Plan Mode artifact の生成、保存、表示、adoption、read model は専用 domain が所有する。

## Current Findings

現状は domain 名の入口だけがあり、実装所有権はまだ `nightworkers` に残っている。

- `api/modules/questionnaire/questionnaire.service.ts` は `nightworkers.design-questionnaire.service` の re-export だけである。
- `api/modules/blueprint/blueprint.service.ts` は `nightworkers.basic.service`、`nightworkers.blueprint-adoption.service`、`nightworkers.design-questionnaire.service` の re-export だけである。
- `api/modules/dbDesign/dbDesign.service.ts` は `nightworkers.blueprint-adoption.service` と `nightworkers.design-questionnaire.service` の re-export だけである。
- `api/modules/specification/specification.service.ts` は `nightworkers.design-questionnaire.service` の re-export だけである。
- `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts` が questionnaire、follow-up、review、blueprint generation、DB design generation、specification generation、workspace read model をまとめて所有している。
- Plan Mode routes は `api/modules/nightworkers/routes/task-routes.ts` と `api/modules/nightworkers/nightworkers.routes.ts` に残っている。
- `src/modules/questionnaire`、`src/modules/blueprint`、`src/modules/dbDesign`、`src/modules/specification` は command wrapper だけで、workspace UI は `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`、`ArtifactQuestionnaire.tsx`、`ArtifactWorkspacePanels.tsx` に残っている。

## Target Boundaries

### NightWorkers Core

Owns:

- Project / Session / Task CRUD
- Workbench chat submission
- Run start / stop / replay
- Runtime events, activity transcript, project files, diff viewing
- Artifact pane shell and generic artifact selection

Does not own:

- Plan Mode artifact generation
- Questionnaire session lifecycle
- Blueprint adoption / design settings storage
- DB Design artifact adoption
- Specification workspace read model
- Plan Mode workspace tabs and form state

NightWorkers core may import Plan Mode UI or service ports, but it must not own Plan Mode route definitions, persistence functions, or workflow state.

### Questionnaire Domain

Owns:

- Questionnaire session CRUD
- Question set parsing and validation
- Answer validation and progress helpers
- Follow-up generation
- Decision review generation and adoption
- Questionnaire route definitions and handlers
- Questionnaire frontend form components and commands

Initial target paths:

- `api/modules/questionnaire/questionnaire.repository.ts`
- `api/modules/questionnaire/questionnaire-parser.service.ts`
- `api/modules/questionnaire/questionnaire-validation.ts`
- `api/modules/questionnaire/questionnaire.service.ts`
- `api/modules/questionnaire/questionnaire.routes.ts`
- `src/modules/questionnaire/*`

Allowed dependencies:

- Core task/message port for task lookup and assistant message publishing
- Structured LLM service
- Shared questionnaire schemas

Forbidden dependencies:

- Importing `api/modules/nightworkers/nightworkers.service`
- Importing `api/modules/nightworkers/nightworkers.repository` as an aggregate repository
- Owning Blueprint / DB Design generation

### Blueprint Domain

Owns:

- Blueprint generation from a ready questionnaire
- Blueprint design settings
- Blueprint artifact adoption
- Blueprint artifact metadata helpers
- Blueprint frontend viewer orchestration that is not generic artifact shell
- Blueprint route definitions and handlers

Initial target paths:

- `api/modules/blueprint/blueprint.repository.ts`
- `api/modules/blueprint/blueprint-adoption.service.ts`
- `api/modules/blueprint/blueprint-design-settings.service.ts`
- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/modules/blueprint/blueprint.routes.ts`
- `src/modules/blueprint/*`

Allowed dependencies:

- Questionnaire read port for ready questionnaire data
- Core task/message port for task lookup and message publishing
- Activity artifact port for artifact persistence
- Shared app blueprint schemas

Forbidden dependencies:

- Owning DB Design generation
- Owning Specification document generation
- Reading questionnaire tables through NightWorkers aggregate repository

### DB Design Domain

Owns:

- DB Design generation from a ready questionnaire and source Blueprint
- DB Design artifact adoption
- DB Design prompt construction and target selection
- DB Design frontend panel orchestration
- DB Design route definitions and handlers

Initial target paths:

- `api/modules/dbDesign/dbDesign.repository.ts`
- `api/modules/dbDesign/dbDesign-generation.service.ts`
- `api/modules/dbDesign/dbDesign-adoption.service.ts`
- `api/modules/dbDesign/dbDesign.routes.ts`
- `src/modules/dbDesign/*`

Allowed dependencies:

- Questionnaire read port
- Blueprint read port for source blueprint resolution
- Core task/message port
- Shared app blueprint schemas

Forbidden dependencies:

- Reusing `BlueprintAdoptionKind` with DB Design hidden as a branch inside Blueprint service
- Depending on `nightworkers.design-questionnaire.service`

### Specification Domain

Owns:

- Specification workspace read model
- Specification markdown generation
- Specification review/improvement generation
- Specification document renderer
- `read_current_specification` read model integration if it depends on Plan Mode artifacts
- Specification route definitions and handlers
- Specification frontend status/document commands

Initial target paths:

- `api/modules/specification/specification-workspace.service.ts`
- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/modules/specification/specification.routes.ts`
- `src/modules/specification/*`

Allowed dependencies:

- Questionnaire read port
- Blueprint read port
- DB Design read port
- Core task/message port

Forbidden dependencies:

- Implementing workspace read model inside Questionnaire service
- Calling `getBlueprintSpecificationWorkspace` through NightWorkers service

### Plan Mode Frontend Workspace

Owns:

- Workspace tabs: status, questionnaire, blueprints, db-design, specification
- Questionnaire form state
- Plan Mode capability gate display
- Generation action orchestration
- Blueprint / DB Design / Specification workspace panels

Target path:

- `src/modules/planMode`

NightWorkers may render a `PlanModeWorkspaceViewer` from `src/modules/planMode`, but NightWorkers components should not own Plan Mode form state.

## Design Rules

1. Move ownership, not just files.
   - A new domain module that only re-exports `nightworkers.*` is not considered separated.

2. Use explicit ports for cross-domain access.
   - Plan Mode domains can read tasks and publish messages through a small core port.
   - They should not import the aggregate `nightworkers.repository`.

3. Preserve public API paths during migration.
   - `/api/tasks/:id/design-questionnaire`
   - `/api/tasks/:id/specification-workspace`
   - `/api/tasks/:id/specification-workspace/blueprint`
   - `/api/tasks/:id/specification-workspace/db-design`
   - `/api/tasks/:id/specification-workspace/design-doc`
   - `/api/tasks/:id/blueprint-*`

4. Compatibility exports are temporary only.
   - Each phase may keep compatibility exports.
   - Each phase must also include a gate proving no new implementation was added behind compatibility paths.

5. Keep behavior stable.
   - No prompt semantics change.
   - No schema migration unless a later phase explicitly needs it.
   - No UI redesign.
   - No provider routing change.

6. Keep prompt Japanese where Japanese operational guidance already exists.

## Baseline Commands

Run before implementation starts and paste results into the implementation PR or task note.

```sh
wc -l \
  api/modules/nightworkers/nightworkers.design-questionnaire.service.ts \
  api/modules/nightworkers/routes/task-routes.ts \
  src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx \
  src/modules/nightworkers/components/ArtifactQuestionnaire.tsx \
  src/modules/nightworkers/components/ArtifactWorkspacePanels.tsx \
  api/modules/questionnaire/questionnaire.service.ts \
  api/modules/blueprint/blueprint.service.ts \
  api/modules/dbDesign/dbDesign.service.ts \
  api/modules/specification/specification.service.ts

rg -n "design-questionnaire|specification-workspace|blueprint-design-settings|blueprint-adoption|blueprint-db-design-adoption|blueprint-design-token-adoption" \
  api/modules/nightworkers api/modules/questionnaire api/modules/blueprint api/modules/dbDesign api/modules/specification

rg -n "ArtifactWorkspaceViewer|ArtifactQuestionnaire|ArtifactWorkspacePanels|generateBlueprintArtifact|generateDbDesignArtifact|fetchSpecificationWorkspace|fetchDesignQuestionnaire" \
  src/modules/nightworkers src/modules/questionnaire src/modules/blueprint src/modules/dbDesign src/modules/specification src/modules/planMode
```

Expected baseline:

- Plan Mode backend implementation is mostly in `api/modules/nightworkers/nightworkers.design-questionnaire.service.ts`.
- Plan Mode route definitions are mostly in `api/modules/nightworkers/routes/task-routes.ts`.
- Plan Mode frontend workflow is mostly in `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`.
- New domain modules are thin facades or command-only modules.

## Implementation Phases

### Phase 0: Import Map And Port Design

Goal:

- Freeze the intended dependency direction before moving implementation.

Tasks:

1. List every import of:
   - `nightworkers.design-questionnaire.service`
   - `nightworkers.design-questionnaire-parser.service`
   - `nightworkers.design-questionnaire-validation`
   - `nightworkers.blueprint-adoption.service`
   - `nightworkers.blueprint-adoption.repository`
   - `nightworkers.spec-document-renderer`
   - `ArtifactWorkspaceViewer`
   - `ArtifactQuestionnaire`
   - `ArtifactWorkspacePanels`
2. Define backend ports:
   - `PlanModeTaskPort`: get task, update task status/objective when required.
   - `PlanModeMessagePort`: list task messages, get message, create assistant message.
   - `PlanModeArtifactPort`: create/read activity artifacts where Blueprint generation persists artifact rows.
3. Decide whether ports live in:
   - `api/modules/nightworkers/nightworkers.plan-mode-port.ts`, or
   - `api/modules/planMode/ports.ts`.
4. Do not move code in this phase.

Gate:

```sh
rg -n "nightworkers\\.design-questionnaire|nightworkers\\.blueprint-adoption|nightworkers\\.spec-document-renderer|ArtifactWorkspaceViewer|ArtifactQuestionnaire|ArtifactWorkspacePanels" api src tests
```

Stop if:

- Port design requires changing task/message schema.
- A domain would need to import `nightworkers.service`.

### Phase 1: Extract Questionnaire Backend

Goal:

- Questionnaire lifecycle stops living in `nightworkers.design-questionnaire.service`.

Tasks:

1. Move questionnaire repository functions from `nightworkers.design-questionnaire.repository.ts` to `api/modules/questionnaire/questionnaire.repository.ts`.
2. Move parser functions from `nightworkers.design-questionnaire-parser.service.ts` to `api/modules/questionnaire/questionnaire-parser.service.ts`.
3. Move validation functions from `nightworkers.design-questionnaire-validation.ts` to `api/modules/questionnaire/questionnaire-validation.ts`.
4. Move these service functions to `api/modules/questionnaire/questionnaire.service.ts`:
   - `createDesignQuestionnaire`
   - `listDesignQuestionnaires`
   - `getDesignQuestionnaireSession`
   - `saveDesignQuestionnaireAnswers`
   - `generateDesignQuestionnaireFollowUp`
   - `generateDesignQuestionnaireReview`
   - `acceptDesignQuestionnaireReview`
   - `leaveDesignQuestionnaireReviewUnadopted`
5. Replace direct aggregate repository usage with the task/message ports and questionnaire repository.
6. Keep old `nightworkers.*` files as compatibility exports only.

Gate:

```sh
rg -n "createDesignQuestionnaire|generateDesignQuestionnaireFollowUp|generateDesignQuestionnaireReview|saveDesignQuestionnaireAnswers" api/modules/nightworkers/nightworkers.design-questionnaire.service.ts
rg -n "from '../nightworkers|from './nightworkers|nightworkers\\.repository" api/modules/questionnaire
bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/nightworkers-routes/routes-nightworkers-03-part02.test.ts
bun run typecheck
```

Expected:

- Questionnaire behavior and API responses stay unchanged.
- `api/modules/questionnaire` has real implementation, not re-export only.

Stop if:

- Questionnaire review adoption no longer publishes the expected task message.
- Terminal task status mutability checks change.
- Plan Mode capability gate is bypassed.

### Phase 2: Extract Blueprint Backend

Goal:

- Blueprint design settings, adoption, and generation are owned by `api/modules/blueprint`.

Tasks:

1. Move blueprint design settings functions from `nightworkers.basic.service.ts` into `api/modules/blueprint/blueprint-design-settings.service.ts`.
2. Move blueprint adoption repository/service functions from `nightworkers.blueprint-adoption.*` into `api/modules/blueprint`.
3. Move `generateSpecificationStatusBlueprint` into `api/modules/blueprint/blueprint-generation.service.ts`.
4. Use questionnaire read port for ready questionnaire lookup.
5. Use task/message/artifact ports for persistence.
6. Keep old NightWorkers paths as compatibility exports only.

Gate:

```sh
rg -n "getBlueprintDesignSettings|saveBlueprintDesignSettings|generateSpecificationStatusBlueprint|getBlueprintArtifactAdoption|saveBlueprintArtifactAdoption" api/modules/nightworkers
rg -n "from '../nightworkers|from './nightworkers|nightworkers\\.repository" api/modules/blueprint
bunx vitest run tests/services.blueprints.test.ts tests/services.blueprint-draft.test.ts tests/blueprint-preview-design-settings.test.ts
bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
```

Expected:

- Blueprint domain owns settings/adoption/generation.
- DB Design adoption is not hidden inside Blueprint service unless explicitly exposed through a shared adoption repository.

Stop if:

- Generated Blueprint messages lose `artifactRef`, `appBlueprint`, or validation metadata.
- Blueprint design settings stop applying in preview.

### Phase 3: Extract DB Design Backend

Goal:

- DB Design is a first-class domain, not a branch inside Blueprint or Questionnaire services.

Tasks:

1. Move DB Design adoption functions to `api/modules/dbDesign/dbDesign-adoption.service.ts`.
2. Move `generateSpecificationStatusDbDesign` to `api/modules/dbDesign/dbDesign-generation.service.ts`.
3. Extract source Blueprint resolution into a Blueprint read port.
4. Keep DB Design prompt construction in DB Design domain.
5. Preserve public endpoint and message metadata.

Gate:

```sh
rg -n "generateSpecificationStatusDbDesign|getBlueprintDbDesignAdoption|saveBlueprintDbDesignAdoption|blueprint-db-design" api/modules/nightworkers
rg -n "from '../nightworkers|from './nightworkers|nightworkers\\.repository" api/modules/dbDesign
bunx vitest run tests/services.blueprint-data-design.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
```

Expected:

- DB Design domain owns generation and adoption.
- Source Blueprint lookup does not require importing NightWorkers aggregate repository.

Stop if:

- DB Design generation accepts a missing source Blueprint.
- DB Design messages lose `sourceBlueprintMessageId`, `dbDesignTarget`, or `questionnaireSessionId`.

### Phase 4: Extract Specification Backend

Goal:

- Specification workspace and design document generation are owned by `api/modules/specification`.

Tasks:

1. Move `getBlueprintSpecificationWorkspace` and `getSpecificationWorkspace` into `api/modules/specification/specification-workspace.service.ts`.
2. Move `nightworkers.spec-document-renderer.ts` into `api/modules/specification/specification-document-renderer.ts`.
3. Move `generateSpecificationStatusDesignDocument` and review helper into `api/modules/specification/specification-generation.service.ts`.
4. Use questionnaire, blueprint, DB Design, task/message ports for read model assembly.
5. Update `api/services/worker-tools/read-current-specification.ts` only if it imports old ownership paths.

Gate:

```sh
rg -n "getBlueprintSpecificationWorkspace|getSpecificationWorkspace|generateSpecificationStatusDesignDocument|buildSpecificationDocumentContext|renderQuestionnaireAnswerMarkdown" api/modules/nightworkers api/services/worker-tools
rg -n "from '../nightworkers|from './nightworkers|nightworkers\\.repository" api/modules/specification
bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/routes.nightworkers-export.test.ts
```

Expected:

- Specification domain owns workspace read model and document generation.
- `nightworkers.design-questionnaire.service.ts` no longer owns cross-artifact workspace assembly.

Stop if:

- `read_current_specification` stops returning questionnaire / blueprint / DB Design references.
- Specification markdown loses DDL section behavior.

### Phase 5: Move Plan Mode Routes Out Of NightWorkers Router

Goal:

- Plan Mode API routes are mounted from their owning domains while public URLs remain stable.

Tasks:

1. Create route modules:
   - `api/modules/questionnaire/questionnaire.routes.ts`
   - `api/modules/blueprint/blueprint.routes.ts`
   - `api/modules/dbDesign/dbDesign.routes.ts`
   - `api/modules/specification/specification.routes.ts`
2. Move route definitions and handlers out of:
   - `api/modules/nightworkers/routes/task-routes.ts`
   - `api/modules/nightworkers/nightworkers.route-handlers.ts`
   - `api/modules/nightworkers/nightworkers.routes.ts`
3. Register the new routers in `api/app.ts` before `nightworkersRouter`.
4. Keep public paths stable.
5. Keep OpenAPI schemas stable.

Gate:

```sh
rg -n "design-questionnaire|specification-workspace|blueprint-design-settings|blueprint-adoption|blueprint-db-design-adoption|blueprint-design-token-adoption" api/modules/nightworkers
bunx vitest run tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/nightworkers-routes/routes-nightworkers-03-part02.test.ts
bun run typecheck
```

Expected:

- `api/modules/nightworkers` no longer registers Plan Mode artifact routes.
- Route behavior is unchanged.

Stop if:

- Any public URL changes.
- OpenAPI route validation stops accepting existing request bodies.

### Phase 6: Extract Plan Mode Frontend Workspace

Goal:

- Plan Mode workspace UI state stops living in NightWorkers components.

Tasks:

1. Create `src/modules/planMode`.
2. Move `ArtifactWorkspaceViewer.tsx` to `src/modules/planMode/PlanModeWorkspaceViewer.tsx`.
3. Move `ArtifactQuestionnaire.tsx` to `src/modules/questionnaire/QuestionnaireForm.tsx` or `src/modules/planMode/questionnaire`.
4. Move `ArtifactWorkspacePanels.tsx` into `src/modules/planMode` and split if needed:
   - `PlanModeStatusView`
   - `PlanModeBlueprintPanel`
   - `PlanModeDbDesignPanel`
   - `PlanModeSpecificationPanel`
5. Move Plan Mode workspace state/action orchestration into `src/modules/planMode/usePlanModeWorkspace.ts`.
6. Keep `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx` as a compatibility export during the phase.
7. `NightWorkersShell` and `ArtifactPane` may render Plan Mode components, but should not own Plan Mode form state.

Gate:

```sh
rg -n "QuestionnaireForm|SpecificationStatusView|WorkspaceBlueprintPreview|WorkspaceDbDesignPanel|generateSpecificationArtifact" src/modules/nightworkers/components
rg -n "from '../nightworkers|from '../../nightworkers" src/modules/planMode src/modules/questionnaire src/modules/blueprint src/modules/dbDesign src/modules/specification
bunx biome check src/modules/planMode src/modules/questionnaire src/modules/blueprint src/modules/dbDesign src/modules/specification src/modules/nightworkers
bun run typecheck
```

Expected:

- Plan Mode UI state lives outside NightWorkers components.
- NightWorkers retains only shell/composition responsibility.

Stop if:

- Artifact pane selection changes.
- Questionnaire answers stop preserving local state during refresh.
- Plan Mode capability settings are ignored by UI controls.

### Phase 7: Remove NightWorkers Aggregator Re-exports

Goal:

- Old NightWorkers paths stop hiding domain ownership.

Tasks:

1. Remove Plan Mode re-exports from `api/modules/nightworkers/nightworkers.service.ts`.
2. Remove questionnaire / blueprint adoption re-exports from `api/modules/nightworkers/nightworkers.repository.ts`.
3. Remove compatibility exports from old Plan Mode service/repository files after imports are moved.
4. Remove frontend compatibility exports for Plan Mode workspace components after imports are moved.
5. Update tests to import domain services directly where appropriate.

Gate:

```sh
rg -n "questionnaire|Questionnaire|blueprint|Blueprint|dbDesign|DbDesign|SpecificationWorkspace|specification-workspace" \
  api/modules/nightworkers src/modules/nightworkers \
  -g '!**/i18n/**' -g '!**/types/**'

rg -n "from '../nightworkers|from './nightworkers|nightworkers\\.service|nightworkers\\.repository" \
  api/modules/questionnaire api/modules/blueprint api/modules/dbDesign api/modules/specification

git diff --check
bun run typecheck
bun run verify
```

Expected:

- Remaining NightWorkers references are generic artifact shell, shared types, i18n, or explicit composition.
- Domain modules do not import NightWorkers internals except through defined ports.

Stop if:

- Removing compatibility exports forces behavior changes.
- Verify fails for a migration-introduced reason.

## Validation Matrix

Focused backend tests:

```sh
bunx vitest run \
  tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts \
  tests/nightworkers-routes/routes-nightworkers-03-part02.test.ts \
  tests/services.blueprints.test.ts \
  tests/services.blueprint-draft.test.ts \
  tests/services.blueprint-data-design.test.ts \
  tests/blueprint-preview-design-settings.test.ts \
  tests/routes.nightworkers-export.test.ts
```

Focused frontend/model tests:

```sh
bunx vitest run \
  tests/artifact-questionnaire.test.ts \
  tests/plan-artifact-visibility.test.ts \
  tests/nightworkers.workbench-selectors.test.ts \
  tests/nightworkers-active-session.test.ts
```

Static checks:

```sh
bunx biome check api/modules/questionnaire api/modules/blueprint api/modules/dbDesign api/modules/specification src/modules/planMode src/modules/questionnaire src/modules/blueprint src/modules/dbDesign src/modules/specification
bun run typecheck
git diff --check
```

Final closeout:

```sh
bun run verify
```

Manual checks:

- Start a Plan Mode session.
- Generate or open a Questionnaire.
- Submit answers until ready.
- Generate Blueprint.
- Generate DB Design from the generated Blueprint.
- Generate Specification.
- Confirm reviewed Specification appears in workspace.
- Confirm Implementation queue action remains locked/unlocked as before.
- Confirm existing coding session run/timeline behavior is unchanged.

## Stop Conditions

Stop and fix before continuing if:

- A new domain module is only a re-export of `nightworkers.*`.
- A domain imports `api/modules/nightworkers/nightworkers.service.ts`.
- A domain imports aggregate `api/modules/nightworkers/nightworkers.repository.ts`.
- Public API paths change.
- Prompt behavior changes without an explicit product decision.
- Plan Mode capability gates are bypassed.
- Terminal task mutability checks change.
- Artifact metadata shape changes unexpectedly.
- `NightWorkersShell` or `ArtifactPane` starts owning Plan Mode form state again.

## Final Acceptance Criteria

- `api/modules/questionnaire` owns Questionnaire lifecycle implementation.
- `api/modules/blueprint` owns Blueprint settings, adoption, and generation.
- `api/modules/dbDesign` owns DB Design adoption and generation.
- `api/modules/specification` owns Specification workspace and document generation.
- `src/modules/planMode` owns Plan Mode workspace UI state.
- `src/modules/questionnaire`, `src/modules/blueprint`, `src/modules/dbDesign`, and `src/modules/specification` contain more than command wrappers where frontend behavior exists.
- `api/modules/nightworkers` no longer registers Plan Mode artifact routes.
- `nightworkers.service.ts` no longer re-exports Plan Mode domain services.
- `nightworkers.repository.ts` no longer re-exports Plan Mode repositories.
- Public API behavior is preserved.
- Focused tests and `bun run verify` pass.
