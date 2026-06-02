---
id: verification
taskTypes: [verification]
priority: 60
---

# Verification

## Use When

Use when the main task is proving that behavior works or a previous change is safe.

## Workflow

- Identify the expected behavior and the cheapest meaningful check.
- Run the closest targeted verification first.
- Escalate to broader checks only when risk justifies it.
- Preserve failures and explain their relevance.

## Completion Gate

- A concrete command, browser check, or inspection was performed.
- The result directly maps to the expected behavior.
- Failures are not hidden.
- Remaining verification gaps are explicit.

## Verification Strategy

- Prefer existing project scripts.
- For UI behavior, use browser/runtime checks when static checks are insufficient.
- For data contracts, inspect API responses or persisted state.

## Report Contract

- Include each verification action and result.
- Explain what each result proves.
- Note residual risk if a check could not run.
