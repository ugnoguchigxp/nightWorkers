---
id: test-change
taskTypes: [test_change]
priority: 75
---

# Test Change

## Use When

Use when the main task is adding, updating, or repairing tests.

## Workflow

- Identify the behavior or regression the test must represent.
- Keep fixtures focused on user-visible behavior or stable contracts.
- Avoid making production code pass only the new fixture.
- Run the targeted test file first.

## Completion Gate

- The test expresses a real requirement or regression.
- Negative or boundary cases are included when risk requires them.
- Production code was not weakened to satisfy a fixture only.
- Existing nearby tests still pass.

## Verification Strategy

- Run the exact changed test file.
- Run related tests when shared helpers or contracts changed.
- Use typecheck when test types or shared schemas changed.

## Report Contract

- Describe what behavior the test now covers.
- Include the test command and result.
- Call out any intentionally untested edge cases.
