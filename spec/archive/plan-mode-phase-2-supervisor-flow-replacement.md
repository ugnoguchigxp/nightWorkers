# Plan Mode Phase 2: Supervisor Flow Replacement

## Purpose

Supervisor の Plan mode flow を、旧来の questionnaire / blueprint / DB design / specification 一律生成から、Feature Plan と必要な dedicated design view を選択する flow へ置き換える。

Phase 2 は prompt / schema-first output / routing hypothesis / skill reference / tool wording の置換フェーズである。Dedicated view generator や UI は作らない。旧 planning prompt を残さず、feature flag、`v1` / `v2`、`new plan` / `legacy plan` のような併存命名も作らない。

## Inputs

- [Plan Mode Concept](./plan-mode-concept.md)
- [Phase 1: Artifact Model Replacement](./plan-mode-phase-1-artifact-model-replacement.md)
- `shared/schemas/plan-mode-artifact.schema.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/schema-first.ts`
- `api/services/supervisor/prompt-tool-registry.ts`
- `api/services/supervisor/skills/types.ts`
- `api/services/supervisor/skills/registry.ts`
- `api/services/supervisor/skills/builtin/references/modes/planning.md`
- `api/services/supervisor/skills/builtin/references/phases/plan.md`
- `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`
- supervisor prompt / skill tests

## Phase Boundary

In scope:

- Round 1 output schema を、planning の場合だけ Feature Plan routing hint を返せる形にする。
- `SupervisorRoutingHypothesis` に Plan mode artifact decision を持てる field を追加する。
- `normalizeSupervisorRoutingHypothesis` が dedicated view decision を安全に正規化する。
- `planning.md` を Feature Plan 中心の procedure に置き換える。
- `plan.md` を Feature Plan の stop/report contract に置き換える。
- `blueprint.md` から DB design 正本化や UI-only 前提を外し、Blueprint を UI specification / related design view hub に限定する。
- `read_current_specification` の説明を `feature_plan` 用語へ更新する。
- Supervisor tests を新 flow に合わせる。

Out of scope:

- dedicated view artifact の生成実装。Phase 3 で扱う。
- Plan mode workspace UI の表示置換。Phase 4 で扱う。
- `dbDesign` route / generator の削除。Phase 3 で扱う。
- repo 全体の旧名掃除。Phase 5 で扱う。
- keyword / regex による user wording 分類の追加。

## Current Runtime Touchpoints

| Area | Current file | Current coupling | Phase 2 action |
|---|---|---|---|
| Round 1 prompt | `api/services/supervisor/prompt.ts` | jobType / goal だけを要求 | planning の場合だけ Plan mode routing hints を要求 |
| Round 1 schema | `api/services/supervisor/schema-first.ts` | `{ jobType, goal }` strict schema | optional `planMode` object を追加 |
| Routing type | `api/services/supervisor/skills/types.ts` | phase / mode / workKinds / overlays | `planMode` decision を追加 |
| Reference resolver | `api/services/supervisor/skills/registry.ts` | phase / mode / workKind / overlay のみ正規化 | `planMode` decision を normalize する |
| Planning reference | `references/modes/planning.md` | 固定テンプレート、網羅計画寄り | Feature Plan + dedicated view selection に置換 |
| Plan phase reference | `references/phases/plan.md` | spec / design memo / work breakdown | Feature Plan artifact completion contract に置換 |
| Blueprint reference | `references/work_kinds/blueprint.md` | AppBlueprint + DB Design workflow 分離 | Blueprint を UI / related view hub に限定 |
| Tool wording | `prompt-tool-registry.ts` | latest `draft_spec` / DB Design を返さない | latest Feature Plan を読む説明へ置換 |
| Tests | supervisor tests | old reference text expectations | new routing / reference expectations へ置換 |

## Target Round 1 Output

Round 1 remains the job type selector. It should not generate artifacts. It only decides whether the request is planning and, if so, returns the initial Plan mode routing hints.

Schema shape:

```ts
type Round1Output = {
  jobType: JobType;
  goal: string;
  planMode?: {
    primaryArtifact: 'feature_plan';
    dedicatedViews: Array<{
      view: DedicatedDesignView;
      decision: 'include' | 'omit';
      reason: string;
    }>;
    specificationLenses: SpecificationLens[];
  };
};
```

Rules:

- `planMode` is allowed only when `jobType === 'planning'`.
- If `jobType !== 'planning'`, `planMode` must be absent.
- `primaryArtifact` is always `feature_plan`.
- `dedicatedViews` must include both `include` and meaningful `omit` decisions when the user request makes the omission relevant.
- `questionnaire` is used for blocking open questions / assumptions.
- `blueprint` is used for UI specification and related design view hub.
- `data_model` replaces DB Design.
- `zod_schema_design` is used for validation / JSON / tool input contracts.
- Usecase diagrams are not allowed.
- AI Coding Rules are not part of Feature Plan.

## Target SupervisorRoutingHypothesis

Add a Plan mode-specific optional field to the routing hypothesis.

```ts
type PlanModeViewDecision = {
  view: DedicatedDesignView;
  decision: 'include' | 'omit';
  reason: string;
};

type PlanModeRoutingDecision = {
  primaryArtifact: 'feature_plan';
  dedicatedViews: PlanModeViewDecision[];
  specificationLenses: SpecificationLens[];
};

type SupervisorRoutingHypothesis = {
  primaryMode: SupervisorMode;
  secondaryModes: SupervisorMode[];
  phase: SupervisorPhase;
  workKinds: SupervisorWorkKind[];
  overlays: SupervisorOverlay[];
  subtype?: string;
  requiredEvidence: string[];
  nextReferenceFiles: string[];
  confidence: number;
  planMode?: PlanModeRoutingDecision;
};
```

Normalization rules:

- Unknown dedicated view names are dropped.
- Unknown specification lens names are dropped.
- Empty or non-string reasons become a deterministic short reason such as `not specified by routing`.
- `planMode` is kept only when `primaryMode === 'planning'` or `phase === 'plan'`.
- No v1/v2 wrapper is introduced.

## Reference Selection

Do not create one work_kind per dedicated view in Phase 2. That would force a large registry expansion before generator behavior exists.

Phase 2 uses:

- `references/modes/planning.md` for Feature Plan structure and dedicated view selection rules.
- `references/phases/plan.md` for stop/report/verification contract.
- `references/work_kinds/blueprint.md` only when `blueprint` view is included or user explicitly asks for Blueprint.
- Existing overlays such as `security`, `production_risk`, `user_facing_change`, `evidence` when the request warrants them.

Phase 3 may add dedicated view references if generator-specific procedure text becomes necessary.

## Implementation Steps

### Step 0. Baseline

Run focused tests before editing.

```bash
bunx vitest run tests/services.supervisor.test.ts tests/services.supervisor-skills.test.ts tests/services.supervisor-prompt-packet.test.ts tests/plan-mode-domain-boundary.test.ts
```

Expected result:

- Current baseline is known.
- Any pre-existing failure is recorded before changes.

Failure handling:

- If a baseline test fails before changes, record the failure and keep Phase 2 verification focused on tests that prove the touched Supervisor surface.

### Step 1. Import Plan Mode Artifact Vocabulary

Update Supervisor code to import Phase 1 types/schemas from `shared/schemas/plan-mode-artifact.schema.ts`.

Files:

- `api/services/supervisor/schema-first.ts`
- `api/services/supervisor/skills/types.ts`
- `api/services/supervisor/skills/registry.ts`

Expected result:

- Supervisor does not duplicate dedicated view / specification lens string unions.
- Unknown values are rejected or normalized through one vocabulary.

### Step 2. Extend Round 1 Schema And Parser

Update `schema-first.ts`.

Changes:

- `jobTypeSelectionSchema` accepts optional `planMode`.
- `buildResponseJsonSchema(1)` exposes the optional `planMode` object.
- `parseSupervisorOutput(raw, 1)` rejects `planMode` when `jobType !== 'planning'`.
- `planMode.primaryArtifact` must be `feature_plan`.

Expected result:

- Planning requests can carry view selection hints.
- Non-planning requests cannot smuggle Plan mode routing data.

### Step 3. Update Round 1 Prompt Packet

Update `buildRound1PromptPacket` in `prompt.ts`.

Add Round 1 instructions:

- Return `planMode` only for `jobType: "planning"`.
- Use `feature_plan` as the only primary artifact.
- Choose dedicated views by need, not by fixed template.
- Include omit reasons for UI-less, DB-less, contract-light, or diagram-unnecessary cases.
- Do not include AI Coding Rules.
- Do not select Usecase diagrams.
- Do not classify user wording with keyword lists; infer from requested work.

Expected result:

- Round 1 tells the model how to produce Feature Plan routing hints.
- Existing jobType selection behavior remains intact.

### Step 4. Extend Supervisor Routing Types

Update `api/services/supervisor/skills/types.ts`.

Add:

- `PlanModeViewDecision`
- `PlanModeRoutingDecision`
- optional `planMode` on `SupervisorRoutingHypothesis`

Expected result:

- Routing hypothesis can carry Feature Plan view decisions without overloading `workKinds`.
- `workKinds` remains for existing reference axes.

### Step 5. Normalize Plan Mode Routing

Update `normalizeSupervisorRoutingHypothesis` in `registry.ts`.

Rules:

- If `routing.planMode` is missing, leave it undefined.
- If normalized route is not planning/plan, drop `planMode`.
- Normalize `dedicatedViews` by valid dedicated view names.
- Preserve include / omit decisions.
- Deduplicate by view, keeping the first valid decision.
- Normalize `specificationLenses` by valid lens names.

Expected result:

- Reference resolution remains stable with malformed or partial planMode data.
- Unknown future strings do not break routing.

### Step 6. Replace Planning Mode Reference

Replace `api/services/supervisor/skills/builtin/references/modes/planning.md`.

Required content:

- Plan mode creates one Feature Plan.
- Feature Plan body contains goal, scope/non-goals, current/desired behavior, acceptance criteria, constraints, implementation steps, verification, risk notes.
- Dedicated views are selected only when useful.
- `verification` stays in Feature Plan body.
- `questionnaire` owns open questions / assumptions.
- `blueprint` owns UI specification and related view hub.
- `data_model` owns DB/data structure view and DDL canonical rule.
- `api_io_contract`, `state_model`, `activity_flow`, `sequence_flow`, `zod_schema_design` are optional views.
- Usecase diagrams are excluded.
- AI Coding Rules are excluded.

Remove:

- The fixed long template that requires every broad planning section.
- Wording that implies all UI / DB / API / migration sections must be produced for every task.
- `open question` as a required Feature Plan body section; use `questionnaire`.

Expected result:

- Planning reference is short enough to be followed, but complete enough for implementation handoff.

### Step 7. Replace Plan Phase Reference

Replace `api/services/supervisor/skills/builtin/references/phases/plan.md`.

Required content:

- Stop when Feature Plan body is complete and dedicated view decisions are explicit.
- Report created/updated Feature Plan, included views, omitted views with reasons, first implementation step, blocking questionnaire items, required verification gate.
- Verification checks the selected view decisions and Feature Plan body.

Expected result:

- Phase stop/report contract matches the new artifact model.

### Step 8. Adjust Blueprint Work Kind Reference

Update `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`.

Phase 2 changes only the procedure wording:

- Blueprint is not required for UI-less tasks.
- Blueprint is UI specification and related design view hub.
- Blueprint must not own DB DDL, API contract, or Zod schema canonical source.
- Existing AppBlueprint schema reference may remain for current Blueprint generation.
- Existing note that DB/table/DDL design is separated should be updated to say Data Model owns that role.

Expected result:

- Blueprint reference no longer reinforces old DB Design wording.

### Step 9. Update Tool Wording

Update `read_current_specification` description in `prompt-tool-registry.ts`.

Replace:

- `Specification Artifact`
- latest `draft_spec`
- `Questionnaire / Blueprint / DB Design`

With:

- latest `Feature Plan`
- Plan mode artifacts
- dedicated views such as Questionnaire / Blueprint / Data Model are not returned directly

Expected result:

- Worker tool description matches new terminology.

### Step 10. Update Supervisor Tests

Update or add tests:

- `tests/services.supervisor-prompt-packet.test.ts`
  - Round 1 output schema mentions `planMode`.
  - Prompt says `feature_plan`.
  - Prompt excludes Usecase and AI Coding Rules.
- `tests/services.supervisor-skills.test.ts`
  - planning references render Feature Plan wording.
  - blueprint reference says Data Model, not DB Design canonical source.
  - routing normalization preserves valid planMode decisions and drops invalid ones.
- `tests/services.supervisor.test.ts`
  - parser accepts planning output with planMode.
  - parser rejects non-planning output with planMode.
- `tests/plan-mode-domain-boundary.test.ts`
  - no new keyword/regex user wording classifier is introduced.
  - no v1/v2 naming appears in Supervisor flow code.

Expected result:

- Prompt, schema, reference, and routing behavior are covered before implementation proceeds to generators.

## Legacy Removal

Delete or replace in Phase 2:

- Fixed planning reference template that forces broad sections for all tasks.
- Plan phase report contract that assumes separate specification / DB design / blueprint artifacts.
- DB Design canonical wording inside Blueprint reference.
- `read_current_specification` wording that says latest `draft_spec`.
- Supervisor tests expecting old planning text.

Do not delete in Phase 2:

- `planning` job type.
- `plan` phase.
- `blueprint` work kind.
- `read_current_specification` tool itself.
- DB Design generator/routes. Phase 3 owns this.
- UI labels. Phase 4 owns this.

## Verification

Run focused checks after implementation:

```bash
bunx vitest run tests/services.supervisor.test.ts tests/services.supervisor-skills.test.ts tests/services.supervisor-prompt-packet.test.ts tests/plan-mode-domain-boundary.test.ts
```

Run typecheck:

```bash
bun run typecheck
```

Run repo hygiene:

```bash
git diff --check
```

Text audit:

```bash
rg -n "verification_matrix|ui_specification|design_view_references|db_design|DB Design|AI Coding Rules|Usecase|draft_spec|Specification Artifact" api/services/supervisor tests/services.supervisor* tests/plan-mode-domain-boundary.test.ts
```

Expected result:

- Round 1 planning output can include Feature Plan routing hints.
- Non-planning Round 1 output cannot include Plan mode routing.
- Supervisor references no longer instruct the model to generate the old fixed artifact set.
- Blueprint reference does not treat DB design as Blueprint-owned.
- `read_current_specification` description points to Feature Plan terminology.
- No v1/v2/new/legacy Plan naming is introduced.

Failure handling:

- If schema-first output becomes too large or brittle, keep `planMode` optional and minimal, but do not fall back to old artifact set.
- If reference tests fail because old wording is still needed for current generator behavior, move generator-specific wording to Phase 3 notes and keep Phase 2 reference aligned with Feature Plan.
- If typecheck fails in generator or UI code, only adjust imports/types needed by Supervisor changes; do not implement generator/UI replacement in Phase 2.

## Completion Criteria

Phase 2 is complete when:

1. Round 1 schema and parser support planning-only `planMode` routing hints.
2. `SupervisorRoutingHypothesis` can carry normalized Plan mode view decisions.
3. Planning mode reference describes Feature Plan and dedicated view selection.
4. Plan phase reference has Feature Plan stop/report/verification contracts.
5. Blueprint reference no longer owns DB design canonical behavior.
6. Supervisor tests cover prompt, schema, routing normalization, and reference rendering.
7. Focused tests and `git diff --check` pass.

