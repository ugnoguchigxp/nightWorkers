---
id: investigation
taskTypes: [investigation]
priority: 60
---

# Investigation

## Use When

Use when the task is to understand behavior, locate a cause, inspect logs, or map implementation.

## Workflow

- Start from the user-visible symptom or requested question.
- Identify the smallest relevant files, logs, commands, or events.
- Gather evidence before proposing changes.
- Separate confirmed facts from hypotheses.

## Completion Gate

- The answer is grounded in inspected evidence.
- Important uncertainty is explicit.
- Next implementation or verification step is clear.
- No unsupported root cause is claimed.

## Verification Strategy

- Reproduce or inspect the failing path when possible.
- Use targeted commands that expose the suspected behavior.
- Preserve command output or file references needed for follow-up.

## Report Contract

- State the finding or current best explanation.
- Reference the evidence used.
- List the next concrete step if implementation is still needed.
