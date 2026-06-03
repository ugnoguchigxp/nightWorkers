# NightWorkers Concept

## Purpose

NightWorkers is evolving from a local-first coding-agent control plane into an
ecosystem for turning application ideas into governed implementation runs, then
feeding the resulting experience back into future work.

The core direction is:

```txt
Design governance
  -> App blueprint
  -> Agent execution
  -> Run evidence
  -> Experience knowledge
  -> Better next execution
```

NightWorkers owns the execution and evidence side of this loop. It should not
absorb every adjacent concern. Instead, it should integrate the right boundaries
so each layer can do one job well.

## Four Pillars

### NightWorkers: Execution Control

NightWorkers is the local execution control plane.

It manages project sessions, queues, supervisor-worker runs, tool policy,
verification, review results, run events, final judgments, and replayable run
evidence. Its value is not generic chat-based code generation. Its value is
controlling how coding-agent work is started, observed, bounded, reviewed, and
reused.

NightWorkers should continue to prioritize:

- project-scoped sessions and queues
- run lifecycle persistence
- explicit tool and path policy
- structured run events
- verification and review gates
- final outcome truth
- exportable run evidence

### ContextStill: Experience Knowledge

ContextStill remains an external memory and knowledge service, accessed through
MCP.

NightWorkers should treat ContextStill as the durable substrate for experience
distillation, not as code copied into this repository. The intended loop is:

1. NightWorkers produces structured run evidence.
2. ContextStill distills reusable rules, procedures, warnings, and context.
3. Approved knowledge is injected into later work.
4. NightWorkers records whether the injected knowledge helped.

This keeps NightWorkers focused on execution while ContextStill handles
knowledge lifecycle, retrieval, approval, and reuse.

### Design Governance: UI Quality Constraints

NightWorkers includes a local `designSystem` workspace and now uses governed
Blueprint Preview settings as an early design governance layer.

The goal is to allow design freedom at the selection level while keeping code
output constrained:

- theme
- density
- shape
- shadow
- font
- contrast
- motion
- component variants

These choices are represented as design presets, preview settings, and semantic
tokens. UI code should consume fixed tokens and variants instead of growing
one-off Tailwind class combinations or ad hoc CSS.

The design system should become the place where UI implementation rules are
owned, tested, previewed, and reused. New components can still be added, but
they should follow the same token, variant, accessibility, and visual-state
rules.

### Blueprint Layer: Structured MVP Definition

The existing `../composia-ui` project is a useful prototype for this layer. It
is not mature enough to be adopted as-is, but it contains the right idea:
define MVP applications through governed UI schema, component catalogs, database
design, and data bindings instead of relying only on prose specifications.

NightWorkers should absorb the useful concept, not blindly port the whole
prototype.

The Blueprint Layer defines or records:

- selected design preset
- allowed component catalog
- screen and section structure
- preview-only sample content for visual review
- DB Design revisions when the user explicitly requests data contract work
- adopted/not-adopted state for Blueprint, DB Design, and Design Token artifacts
- implementation scope
- non-goals
- validation and review expectations

The blueprint is not a replacement for implementation plans. It is the
structured input that makes implementation plans less ambiguous.

## App Blueprint Contract

An App Blueprint is the handoff object between design intent and coding-agent
execution.

Conceptually it contains:

```txt
AppBlueprint
  designPreset
  componentCatalogPolicy
  screens
  databaseSchema          # empty in normal visual Blueprint generation
  dataBindings            # empty in normal visual Blueprint generation
  implementationTasks
  acceptanceCriteria
  governanceRules
  learningHooks
```

The blueprint should answer questions that prose specs often leave vague:

- What screens exist?
- Which sections can appear on each screen?
- Which component variants are legal?
- Which sample content should appear in the review preview?
- Which DB Design questions need a focused follow-up?
- Which parts are fixed and which are configurable?
- What should the coding agent implement first?
- What must be verified before the run is accepted?
- Which design or implementation decisions should be preserved for reuse?

DB table, column, relation, binding, and DDL reasoning is intentionally split
out of normal Blueprint generation. It runs through the Blueprint Preview
DB Design action, which can return a revised App Blueprint data contract without
applying physical database changes.

## Fixed Versus Configurable Design

The design governance layer should support three operating modes.

### Fixed Mode

The design preset is chosen once and then compiled into the project as the
stable UI contract.

Use this for products where consistency and maintainability matter more than
end-user customization.

### Configurable Mode

The design preset remains a runtime setting. The UI can switch density, theme,
shape, font, or similar axes after deployment.

Use this for local tools, Tauri apps, internal dashboards, or products where
personalization is part of the value.

### Hybrid Mode

The design preset remains configurable only for privileged users or project
owners. Most users experience a fixed UI.

Use this for SaaS or team tools where brand control and controlled
customization both matter.

## One-Way Definition Flow

The system should avoid circular design/code drift.

The preferred flow is:

```txt
Design preset
  -> semantic tokens
  -> component variants
  -> blueprint screens
  -> optional DB Design revision
  -> user adoption decisions
  -> implementation tasks
  -> run evidence
  -> reusable knowledge
```

Code should not invent new visual primitives during implementation unless the
blueprint or design governance layer is explicitly updated. If an agent needs a
new component or variant, it should be treated as a governance change with its
own review and tests.

## Component Rules

Component governance should be stricter than general UI implementation.

Rules:

- Prefer semantic tokens over raw values.
- Keep component variants centralized.
- Use DOM state and accessibility attributes as the basis for visual states.
- Avoid one-off CSS for layout, color, radius, density, and shadow.
- Keep shadcn/ui-derived components project-owned, not black boxes.
- Add Storybook or equivalent preview coverage for new governed components.
- Add tests for variant behavior where the component is shared or agent-facing.

The purpose is not to reduce visual quality. The purpose is to keep visual
quality available without letting implementation style fragment.

## Composia UI Adoption Boundary

`../composia-ui` should be treated as a source of concepts and reusable
contracts, not as a direct dependency at first.

Useful ideas extracted or still useful as references:

- governed AI UI runtime
- App UI Schema
- component catalog validation
- ScreenJSON replay
- DBDesign draft model
- SandboxDB current-state thinking
- DataBinding JSON
- catalog parity tests
- provider output validation

Risks to avoid:

- importing prototype complexity before the target contract is clear
- letting arbitrary app generation become the product center
- mixing generated UI runtime concerns into NightWorkers execution control
- replacing implementation plans with screen JSON alone
- adding DB generation without an explicit DB Design action, migration boundary,
  and safety boundary

## Relationship To Implementation Plans

Traditional implementation plans remain necessary.

The intended split is:

- Blueprint defines the application shape.
- DB Design defines the optional data contract only when explicitly requested.
- Adoption decisions mark which generated artifacts should influence later work.
- Implementation plan defines how NightWorkers will build it.
- Run events prove what actually happened.
- ContextStill stores what should affect future runs.

Blueprints should make implementation plans more concrete. They should not
remove the need for acceptance criteria, risk assessment, verification commands,
or staged delivery.

## Near-Term Direction

The next large effort should be framed as:

**NightWorkers App Blueprint and Design Governance Foundation**

Initial scope:

1. Define the App Blueprint contract.
2. Define the design preset contract.
3. Map existing `designSystem` tokens and components into governance concepts.
4. Extract the useful Composia UI concepts into a NightWorkers-native design.
5. Decide which Composia UI code or schemas are worth porting later.
6. Create one representative blueprint-to-implementation flow.
7. Record run evidence and ContextStill learning hooks from that flow.

This is intentionally a large effort. Because NightWorkers is still young, it is
better to set the foundation now than to bolt it on after many incompatible UI
and specification patterns exist.

## Non-Goals

This concept does not require:

- copying all of `../composia-ui` into this repository
- turning NightWorkers into a no-code builder
- replacing ContextStill with local memory tables
- generating arbitrary React, SQL, or Tailwind code
- making every design choice runtime-configurable
- removing conventional implementation plans
- supporting every possible Web UI framework

## Success Criteria

This concept is working when:

- a project can choose a governed design preset
- an MVP can be described as a structured blueprint
- the blueprint can be reviewed before implementation
- NightWorkers can turn the blueprint into bounded execution tasks
- generated or implemented UI stays inside governed component rules
- run evidence records deviations, failures, and verification results
- ContextStill can distill reusable lessons from the run
- future runs can consume those lessons without duplicating the same mistakes
