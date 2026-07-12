# Runtime Configuration Reference

## Bootstrap Variables

Server、認証、OAuth、LLM provider、runtime設定はSettings画面から変更し、
通常開発では`.nightworkers/sqlite.db`へ保存します。環境変数はdesktop packagingや
isolated testなど、SQLiteを開く前に必要なbootstrap値だけに限定します。

- `NIGHTWORKERS_DESKTOP`: set by the Tauri shell for desktop sidecar mode
- `NIGHTWORKERS_RUNTIME_DIR`: writable desktop runtime root for DB, settings,
  logs, secrets, and artifacts
- `NIGHTWORKERS_RESOURCE_DIR`: readonly bundled resource root for built assets
  and builtin supervisor/procedure documents
- `NIGHTWORKERS_API_ORIGIN`: selected loopback API origin passed from Tauri to
  the sidecar and frontend
- `NIGHTWORKERS_FRONTEND_DIST`: optional production static frontend path for the
  backend static server

## Desktop Runtime
通常のbrowser開発では、backendは固定パス`.nightworkers/sqlite.db`を使用します。
`DATABASE_URL`の指定は不要です。desktop modeではTauriが上記のdesktop変数を注入し、
backendは`${NIGHTWORKERS_RUNTIME_DIR}/sqlite.db`を使用します。
When `NIGHTWORKERS_RUNTIME_DIR` is not explicitly set, it defaults to
`${NIGHTWORKERS_RESOURCE_DIR}/.nightworkers`. If `JWT_SECRET` is not set, the backend
generates and stores one at `${NIGHTWORKERS_RUNTIME_DIR}/secrets/jwt-secret`.

Desktop settings are stored under `${NIGHTWORKERS_RUNTIME_DIR}/settings`.
Desktop logs are stored under `${NIGHTWORKERS_RUNTIME_DIR}/logs`.
Desktop shell startup diagnostics are written to `desktop.log`, bundled Node
sidecar stdout/stderr is written to `sidecar.log`, and API events are written to
`api.log`.
Development mode stores runtime state under `.nightworkers`; desktop sidecar mode stores state under
`${NIGHTWORKERS_RUNTIME_DIR}`, defaulting to `${NIGHTWORKERS_RESOURCE_DIR}/.nightworkers`
when no override is set.

Runtime hygiene:

- Production API/service code should use `api/lib/logger.ts` for warning/error
  output. Direct `console.*` is reserved for startup fatal validation, CLI
  scripts, and browser-only diagnostics where no server logger exists.
- Environment variables that affect NightWorkers runtime behavior should be
  read through focused config helpers such as `api/services/runtime-env.ts` or
  the domain settings modules. Service code should prefer injected options or
  settings objects over direct `process.env` reads.
- Generated/local artifacts must stay out of tracked source. `bun run
  check:tracked-artifacts` fails if known temporary output paths are tracked.

Startup diagnostics are exposed at:

```text
GET /api/settings/preflight/startup
```

This endpoint separates app startup problems from Project execution environment
problems.

## OAuth Settings

Google/GitHub OAuthのclient IDとsecretはSettings画面から登録し、SQLiteの公開設定と
秘密設定へ分離して保存します。

## Optional Integration

## LLM Providers
- Provider/model settings are managed from the Settings screen and exposed under
  `/api/settings/llm/*`.
- Structured providers are used for schema-first reasoning tasks such as
  Workbench intake classification, Blueprint JSON generation, Design
  Questionnaire decisions, reviews, and smoke tests. They are not the same as
  the implementation runtime.
- The implementation runtime lane decides how code-changing work runs after a
  Session is started or claimed by the Queue. It can use the native local
  runtime or the Codex agent lane depending on settings and availability.
- Codex SDK in provider settings means schema-first provider access for
  structured decisions. `codex-agent` is the runtime lane for repository work
  execution. Do not document or expose them as interchangeable choices.
- Runtime settings are persisted in SQLite and do not require `.env` edits.
- Secret fields are masked in `GET /api/settings/llm` responses. Saving a masked
  value keeps the existing secret instead of persisting the mask.
- LLM runtime settings are written with owner-only file permissions where the
  filesystem supports them. `NIGHTWORKERS_LLM_SETTINGS_PATH` can override the
  file path for tests or local experiments.
- The smoke-test API validates whether the selected provider configuration can
  complete a small model request before it is used by Workbench runs.
- Advanced or legacy runtime fallbacks should stay behind runtime settings and
  diagnostics. The normal setup path is: choose a structured provider, smoke
  test it, then choose the implementation runtime lane only when direct run
  execution behavior needs to change.
- Provider request boundaries are intentionally narrow:
  `api/services/structured-llm/request.ts` owns provider selection,
  normalized request diagnostics, capability policy, and schema/request
  classification; `providers.ts` owns provider calls and raw response
  extraction; `index.ts` owns JSON extraction, schema-first validation, tracing,
  and passing normalized usage to `llm-usage`.
- Usage recording is separate from provider calls:
  `api/services/llm-usage/normalize.ts` converts provider raw usage shapes into
  `NormalizedLlmUsage`, while `repository.ts` persists usage records and
  projects them into the activity ledger. Fallback prompt text is used only when
  provider usage is missing and should not be mixed into provider raw usage
  metadata.

## MCP Servers
- Non-authenticated MCP Servers can be configured from the Settings screen.
- Supported transports are `stdio`, `streamable_http`, and legacy-compatible `sse`.
- Settings can be entered one server at a time or imported from a large JSON textarea. The import path accepts common pasted shapes such as `{ "mcpServers": { "name": { ... } } }`, `{ "servers": [ ... ] }`, `{ "server": { ... } }`, or a single server object.
- Import runs an immediate connection test by default. Saving or switching a server ON also runs `listTools` through the MCP client manager so the UI can report whether the server is usable.
- Each server has an ON/OFF switch. OFF keeps the config stored but excludes the server from runtime tool discovery and skips connection tests until it is turned ON again.
- Runtime MCP Server settings are stored separately from LLM settings. In development this is `api/.runtime/mcp-servers.json`; in desktop mode it is `${NIGHTWORKERS_RUNTIME_DIR}/settings/mcp-servers.json`.
- `NIGHTWORKERS_MCP_SETTINGS_PATH` can override that file path for tests or local experiments.
- OAuth, bearer-token, API-key header, cookie auth, and secret-like env values are intentionally rejected in the first implementation slice.
- Enabled MCP tools execute through the internal `mcp_call_tool` bridge so policy checks, run events, and review evidence remain in the NightWorkers runtime path.
- MCP tool calls stay inside the worker-tool bridge. They are recorded as runtime evidence rather than bypassing the NightWorkers run ledger.

## Agent Hooks
- Agent Hooks can be configured from the Settings screen.
- Runtime Agent Hook settings are stored separately from LLM and MCP settings. In development this is `api/.runtime/agent-hooks.json`; in desktop mode it is `${NIGHTWORKERS_RUNTIME_DIR}/settings/agent-hooks.json`.
- `NIGHTWORKERS_HOOKS_SETTINGS_PATH` can override that file path for tests or local experiments.
- Supported events in the first implementation slice are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, and `SessionEnd`.
- Supported handlers are local `command` hooks and `http` hooks. Command hooks receive JSON on stdin; HTTP hooks receive the same JSON as the POST body.
- Secret-like env values and HTTP headers are intentionally rejected in this slice.
- Hook commands use a dedicated hook runner, not the worker `run_command` tool, so hook execution does not recursively trigger tool hooks.
- Fixed tool policy still runs before configurable hooks. Post-tool hooks run only after fixed post-policy accepts the tool result.

### Failure Recovery Demo Inputs
Use these inputs to demonstrate rejected or recoverable extension paths without adding new capabilities.

- Disabled MCP server: save a valid server with `enabled=false`; it remains stored but does not participate in tool discovery or connection tests.
- Rejected auth config: paste an MCP config with `headers.Authorization`, `apiKey`, `token`, or secret-like `env` keys and confirm it is rejected with a user-readable auth/secret message.
- Hook command failure: create a command hook that exits non-zero and confirm the hook runner stores a redacted failure summary in `lastRun`.
- Hook HTTP failure: point an HTTP hook at an endpoint that returns a non-2xx response and confirm the failure summary is actionable and does not include secret-like response text.

## Blueprint Preview
- Blueprint Preview design settings are session-scoped and stored in SQLite in
  `blueprint_design_settings`.
- The Preview Design panel controls governed visual axes only: theme, density,
  shape, shadow, font, contrast, motion, and component variants.
- DB/table/column/relation/binding design is not part of normal visual
  Blueprint generation. Use the Plan Mode Data Model view for canonical data
  structure design.
- Adoption decisions are stored separately from generated artifacts:
  - `blueprint_artifact_adoptions`
  - `blueprint_design_token_adoptions`
- Each adoption row is tied to the Workbench session `task_id` and source
  conversation `message_id`, so later planning can prefer explicitly adopted
  artifacts instead of the newest generated artifact.

## Implementation Queue
- Processor capacity is stored in `implementation_queue_settings.processor_count`
  and clamped to `1..3`.
- Queue execution uses explicit `implementation_queue_entries`; `tasks.status`
  is not the Queue claim source of truth.
- A Session enters the Queue only after a user explicitly queues an
  implementation-plan-ready task.
- Todo Workflow gates are stored in `todo_workflow_settings` and control
  per-Todo review/fix, final verification, and completion commit confirmation.
- Legacy `SESSION_QUEUE_MAX_CONCURRENCY`, `queueEnabled`, and
  `maxConcurrentSessions` may exist for migration compatibility, but they are
  no longer the visible Implementation Queue control surface.

## Closeout Evidence and Security Oracle
- Closeout has no environment-variable bypass. It reads persisted Test Mode,
  Review Run, Security Oracle, finding, ownership, and Git evidence.
- Security Intelligence settings are Project-scoped at
  `/api/repositories/:id/settings/security-intelligence`.
- Missing Security Oracle evidence is not a policy skip. Optional Review Run
  Security Review does not replace the implementation Oracle.
- Commit and push are explicit and commit does not start a new security scan.

## Run Event Reattach
- Workbench WebSocket `subscribe_task` accepts optional `runId` and `afterSeq`
  fields. When present, the API verifies the run belongs to the task and
  replays persisted events after the cursor before normal live updates.
- `GET /api/runs/:id/events?afterSeq=<seq>` exposes the same cursor model for
  HTTP clients and future CLI/TUI attach flows.
- `GET /api/runs/:id` remains a full run-detail endpoint and should not be used
  as a partial event cursor API.
- In-memory WebSocket replay is a fast path only; persisted `task_events`
  remain the durable recovery source.

## Local Startup Baseline
```bash
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

## Desktop Build Baseline
```bash
bun run desktop:prepare-sidecar
bun run desktop:smoke-sidecar
bun run desktop:lint
bun run desktop:build
bun run desktop:smoke
```

On macOS, `bun run desktop:build` produces a `.app`. `bun run desktop:smoke`
launches that app and checks the sidecar health endpoint, overview endpoint,
implementation queue endpoint, WebSocket startup, desktop/sidecar log output,
and shutdown. `bun run verify` is the lightweight base gate and does not run
desktop build or smoke. It runs tracked-artifact check, TypeScript, and Biome in
parallel first, then runs supervisor regression tests serially. Use
`bun run verify:desktop` when rechecking desktop runtime tests, Linux/Windows
packaging readiness checks, Rust lint, desktop build, staged sidecar smoke, and
packaged app smoke. `bun run verify:full` is the explicit slow gate: it adds the
full non-live Vitest suite, E2E/accessibility, dependency audit, desktop
build/smoke, and never calls an external LLM. External-provider canaries are
isolated to `bun run verify:live` and skip unless their enable flags and
credentials are configured.
`bun run verify:audit` applies the machine-readable High/Critical dependency
policy in `config/dependency-audit-allowlist.json`, and `bun run verify:e2e`
runs the credential-free Playwright smoke tests. `bun run verify:release`
combines the full Vitest, E2E, dependency policy, and desktop gates in one
ordered command and prints `release-ready` only after all required phases pass.

All `test:e2e:*` package commands run through the isolated Playwright wrapper.
Each invocation uses `.nightworkers-e2e/<run-id>/` for its SQLite database,
runtime files, settings, Codex home, and fixture repositories. Direct Playwright
execution without this isolation metadata is rejected, existing dev servers are
not reused, and the dedicated database and run root are reset when the command
finishes. `.nightworkers-e2e/` is ignored by Git.

Linux and Windows packaging is configured through platform-specific Tauri
config files:

```bash
bun run desktop:check:cross-platform
bun run desktop:build:linux
bun run desktop:build:windows
```

Run `desktop:build:linux` on a Linux build host to produce `.deb`, `.rpm`, and
AppImage artifacts. Run `desktop:build:windows` on an x64 Windows build host to
produce NSIS and MSI installers. `desktop:check:cross-platform` is safe to run
on macOS because it only validates config, scripts, and sidecar target metadata.
`bun run desktop:build:dmg` is kept as a separate release gate because DMG
creation can fail on local mount/Finder state. `bun run desktop:sign` requires
`NIGHTWORKERS_DESKTOP_APP_PATH` and `APPLE_DEVELOPER_ID_APPLICATION`.
