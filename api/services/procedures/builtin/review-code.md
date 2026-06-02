---
id: review-code
taskTypes: [review]
priority: 70
---

# Code Review

## Use When

Use for code review, spec review, risk review, or regression analysis.

## Workflow

- Read the changed code and relevant surrounding context.
- Prioritize bugs, regressions, missing tests, and contract breaks.
- Ground every finding in a file, line, event, or command output.
- Put findings before summary.

## Completion Gate

- Findings are ordered by severity.
- Each finding has concrete evidence.
- Missing tests are called out when they materially affect risk.
- A no-finding review still states residual risk.

## Verification Strategy

- Run focused tests only when they clarify a finding.
- Use existing test output when available.
- Avoid broad verification that does not affect the review.

## Report Contract

- Lead with findings.
- Include open questions or assumptions after findings.
- Keep summary secondary and brief.
