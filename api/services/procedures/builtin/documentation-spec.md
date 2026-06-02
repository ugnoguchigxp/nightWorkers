---
id: documentation-spec
taskTypes: [documentation]
priority: 70
---

# Documentation Spec

## Use When

Use for implementation plans, specs, README updates, and user-facing documentation changes.

## Workflow

- Ground the document in current repository files.
- Separate goals, non-goals, design, phases, and verification.
- Keep active plan, backlog, and future candidates distinct.
- Avoid duplicating an existing spec when updating it is enough.

## Completion Gate

- Scope and non-goals are explicit.
- Current implementation entry points are named.
- DB, API, UI, runtime, and test surfaces are separated when relevant.
- Acceptance criteria and verification commands are present.

## Verification Strategy

- Check referenced paths and commands against the repository.
- Run documentation lint or formatting when configured.
- Re-read the changed section for stale or duplicated claims.

## Report Contract

- State which document changed.
- Summarize major decisions or plan changes.
- Mention repository checks used to validate accuracy.
