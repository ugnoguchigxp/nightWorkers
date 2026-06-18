# Testing Conventions

## Test File Splits

- Do not leave parent placeholder suites after splitting a large test file. The
  parent file should be deleted once the split files can run independently.
- Split files must be directly runnable with `bun run test run <file>`.
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

## Live LLM/API Tests

- Keep live provider tests out of the default Vitest include. Put them under
  `tests/live/**` and run them through `bun run test:live:llm`.
- Live tests must be opt-in. Set `NIGHTWORKERS_LIVE_LLM_VITEST=1` plus the
  provider credentials or local base URL before running them.
- Supported provider setup:
  - OpenAI: `OPENAI_API_KEY` and optionally `OPENAI_MODEL` / `OPENAI_BASE_URL`.
  - Azure OpenAI: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`,
    `AZURE_OPENAI_DEPLOYMENT_NAME`, and optionally `AZURE_OPENAI_API_VERSION`.
  - Local: `NIGHTWORKERS_LIVE_LLM_PROVIDER=local` with `LOCAL_OPENAI_BASE_URL`
    or `NIGHTWORKERS_LOCAL_LLM_BASE_URL`, and optionally `LOCAL_OPENAI_MODEL`.
  - Other OpenAI-compatible endpoints: `NIGHTWORKERS_LIVE_LLM_PROVIDER=openai-compatible`
    with `OPENAI_COMPATIBLE_BASE_URL` and optionally `OPENAI_COMPATIBLE_API_KEY`
    / `OPENAI_COMPATIBLE_MODEL`.
- Provider health probes are separate from JSON response smoke tests. Set
  `NIGHTWORKERS_LIVE_LLM_HEALTH=1` to run health probes for providers with a
  known health contract.
- `bun run verify:live` runs normal verification first, then the live LLM
  Vitest smoke, then the heavier Playwright `@agent-live` run.
