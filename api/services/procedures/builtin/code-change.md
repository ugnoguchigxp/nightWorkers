---
id: code-change
taskTypes: [code_change]
priority: 80
---

# Code Change

## Use When

Use for implementation or bug-fix work that changes repository files.

## Workflow

- Inspect the target files before editing.
- Prefer narrow changes that match existing patterns.
- Edit with a structured patch or a scoped replacement.
- Collect the resulting diff.
- Run the closest useful verification.

## Completion Gate

- A relevant repository diff exists.
- Edited files were read before modification.
- The implementation reason is grounded in file or tool evidence.
- Verification was attempted when available.
- Failed verification is reported instead of hidden.

## Verification Strategy

- Start with the closest targeted test or typecheck.
- Expand to broader checks when shared behavior changed.
- Record commands and outcomes for final reporting.

## Report Contract

- List changed files.
- Summarize the behavior change.
- Include verification commands and results.
- Note remaining risks or skipped checks.
