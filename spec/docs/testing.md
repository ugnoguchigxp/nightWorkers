# Testing Conventions

## Test File Splits

- Do not leave parent placeholder suites after splitting a large test file. The
  parent file should be deleted once the split files can run independently.
- Split files must be directly runnable with `pnpm test run <file>`.
- Shared setup belongs in a nearby `helpers.ts` or `tests/helpers/*` module, not
  in a parent test file that contains no suite.
- Avoid comments such as `Split into ...` or placeholder tests such as `No test
  suite found`; they hide broken or duplicate test execution.

## Fixtures

- Prefer typed fixture builders from `tests/helpers/nightworkers-fixtures.ts`
  for NightWorkers domain rows and frontend view models.
- Builders should provide schema-shaped defaults and accept narrow overrides.
- Keep `as any` fixture casts inside helpers only when a schema gap is
  unavoidable, and add the schema gap to the relevant checklist before relying
  on it broadly.

## SQLite/libSQL And Queue Tests

- Queue and run tests should avoid background drain races. Prefer service
  options such as `{ autoDrain: false }`; when a route-level env fallback is
  required, use `tests/helpers/nightworkers-test-controls.ts` so setup and
  cleanup stay paired.
- Tests that mutate queue/run state should verify both the durable DB row and
  the visible API/dashboard state.
- Do not hide lock failures with broad retries. If a lock appears, first remove
  unbounded background work or make the drain path explicit.

## Waiting And Async Work

- Do not use fixed `setTimeout` sleeps in unit or route tests. Prefer
  `vi.waitFor`, direct DB/API polling, broker replay checks, or
  `flushPendingWorkbenchTasks` for microtask-only cleanup.
- E2E tests may use Playwright waits when they reflect browser behavior, but
  route/service tests should wait for persisted state or emitted events.
