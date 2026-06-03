# Runtime Configuration Reference

## Core Variables
- `DATABASE_URL`: SQLite/libSQL target
- `AUTH_MODE`: `local`, `oauth`, `both`
- `API_AUTH_REQUIRED`: protect product APIs and the NightWorkers WebSocket with
  `authMiddleware`. Defaults to `true` outside tests; set `false` only for
  explicitly local unauthenticated development.
- `APP_URL`: base URL for auth callbacks and cookie behavior
- `TRUST_PROXY`: set `true` when proxy headers should be trusted

## OAuth Variables
Enable as needed:
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`

## Optional Integration
- `CONTEXT_STILL_ENABLED=true` to enable contextStill-dependent features.

## LLM Providers
- Provider/model settings are managed from the Settings screen and exposed under
  `/api/settings/llm/*`.
- Runtime settings can override environment defaults for local development
  without requiring `.env` edits.
- Secret fields are masked in `GET /api/settings/llm` responses. Saving a masked
  value keeps the existing secret instead of persisting the mask.
- LLM runtime settings are written with owner-only file permissions where the
  filesystem supports them. `NIGHTWORKERS_LLM_SETTINGS_PATH` can override the
  file path for tests or local experiments.
- The smoke-test API validates whether the selected provider configuration can
  complete a small model request before it is used by Workbench runs.

## MCP Servers
- Non-authenticated MCP Servers can be configured from the Settings screen.
- Supported transports are `stdio`, `streamable_http`, and legacy-compatible `sse`.
- Settings can be entered one server at a time or imported from a large JSON textarea. The import path accepts common pasted shapes such as `{ "mcpServers": { "name": { ... } } }`, `{ "servers": [ ... ] }`, `{ "server": { ... } }`, or a single server object.
- Import runs an immediate connection test by default. Saving or switching a server ON also runs `listTools` through the MCP client manager so the UI can report whether the server is usable.
- Each server has an ON/OFF switch. OFF keeps the config stored but excludes the server from runtime tool discovery and skips connection tests until it is turned ON again.
- Runtime MCP Server settings are stored separately from LLM settings in `api/.runtime/mcp-servers.json`.
- `NIGHTWORKERS_MCP_SETTINGS_PATH` can override that file path for tests or local experiments.
- OAuth, bearer-token, API-key header, cookie auth, and secret-like env values are intentionally rejected in the first implementation slice.
- Enabled MCP tools execute through the internal `mcp_call_tool` bridge so policy checks, run events, and review evidence remain in the NightWorkers runtime path.
- MCP tool calls stay inside the worker-tool bridge. They are recorded as runtime evidence rather than bypassing the NightWorkers run ledger.

## Agent Hooks
- Agent Hooks can be configured from the Settings screen.
- Runtime Agent Hook settings are stored separately from LLM and MCP settings in `api/.runtime/agent-hooks.json`.
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
  Blueprint generation. Use the DB Design panel to request a revised
  App Blueprint data contract.
- Adoption decisions are stored separately from generated artifacts:
  - `blueprint_artifact_adoptions`
  - `blueprint_db_design_adoptions`
  - `blueprint_design_token_adoptions`
- Each adoption row is tied to the Workbench session `task_id` and source
  conversation `message_id`, so later planning can prefer explicitly adopted
  artifacts instead of the newest generated artifact.

## Session Queue
- `SESSION_QUEUE_MAX_CONCURRENCY`: global maximum number of active Session queue runs across all Project Folders. Runtime settings can override the environment default.
- Project Folder queue controls are stored per project: `queueEnabled` controls Play/Pause, and `maxConcurrentSessions` controls how many Sessions that project may process at once.
- Queue draining only starts Sessions that are already in Queue. Suggested follow-up tasks remain drafts until a user explicitly queues them.

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
pnpm db:migrate
pnpm db:seed
pnpm dev
```
