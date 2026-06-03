# Runtime Configuration Reference

## Core Variables
- `DATABASE_URL`: SQLite/libSQL target
- `AUTH_MODE`: `local`, `oauth`, `both`
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

## Agent Hooks
- Agent Hooks can be configured from the Settings screen.
- Runtime Agent Hook settings are stored separately from LLM and MCP settings in `api/.runtime/agent-hooks.json`.
- `NIGHTWORKERS_HOOKS_SETTINGS_PATH` can override that file path for tests or local experiments.
- Supported events in the first implementation slice are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, and `SessionEnd`.
- Supported handlers are local `command` hooks and `http` hooks. Command hooks receive JSON on stdin; HTTP hooks receive the same JSON as the POST body.
- Secret-like env values and HTTP headers are intentionally rejected in this slice.
- Hook commands use a dedicated hook runner, not the worker `run_command` tool, so hook execution does not recursively trigger tool hooks.
- Fixed tool policy still runs before configurable hooks. Post-tool hooks run only after fixed post-policy accepts the tool result.

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

## Local Startup Baseline
```bash
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```
