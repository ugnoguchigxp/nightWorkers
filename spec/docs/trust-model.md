# Trust Model

NightWorkers is designed as a local-first control plane. It can call external
LLM providers, MCP servers, and hook endpoints when you configure them, but its
primary runtime ledger is local.

## Local-First Storage
- Development mode uses the repo-local defaults, including SQLite/libSQL at
  `DATABASE_URL` or `sqlite.db`, runtime settings under `api/.runtime`, and
  logs under `logs`.
- Desktop mode writes runtime state under the repo-local `data` directory by default.
- Desktop settings are stored under `${NIGHTWORKERS_RUNTIME_DIR}/settings`.
- Desktop logs are stored under `${NIGHTWORKERS_RUNTIME_DIR}/logs`.
- The desktop shell and sidecar use `NIGHTWORKERS_RUNTIME_DIR` for NightWorkers
  state, defaulting to repo-local `data`, while registered Project work still
  uses the Project repo root.

## Provider Data Flow
LLM provider calls can include:
- The current user request.
- Supervisor prompt instructions and workflow context.
- StateCard continuity context when conversation context injection is enabled.
- Tool summaries, run context, artifact context, and relevant task metadata.

NightWorkers stores LLM usage records locally in `llm_usage_records`, including
provider/model identifiers, measured or estimated token usage, and normalized
usage metadata. Secret fields in LLM settings are masked when read back through
the API. Saving a masked value keeps the existing secret instead of persisting
the mask.

NightWorkers does not send the entire registered Project repository to a
provider by default. Provider requests are assembled by the runtime path for the
specific Workbench message or run.

## Worker Tool Boundary
- Worker tools receive a registered Project repo root and operate relative to
  that root.
- Path policy rejects access outside the repo root. `allowedPaths` can narrow
  permitted paths inside that root, and `deniedPaths` can block sensitive paths
  inside that root.
- Project safety policy can define `allowedPaths`, `deniedPaths`, and
  `blockedCommands`.
- `run_command` applies command policy before execution. Destructive commands,
  mutating git commands, chained or expanded shell syntax, unknown commands, and
  configured blocked command fragments can be denied.
- Worker command output and tool outcomes are recorded as run evidence.

Do not treat a temporary provider directory, desktop resource directory, or
sidecar runtime directory as the working repository. Project read/write work is
based on the registered Project Folder.

## MCP Server Boundary
- MCP Server settings support `stdio`, `streamable_http`, and legacy-compatible
  `sse` transports.
- The current implementation slice is for non-authenticated MCP servers.
- OAuth, bearer-token, API-key headers, cookie auth, and secret-like env values
  are rejected.
- Saving or enabling a server runs connection/tool discovery checks.
- Enabled MCP tools execute through the internal `mcp_call_tool` bridge.
- MCP tool calls are recorded in the runtime evidence path instead of bypassing
  the NightWorkers run ledger.

## Agent Hooks Boundary
- Agent Hooks are configured from Settings and stored separately from LLM and
  MCP settings.
- Supported handlers are local `command` hooks and `http` hooks.
- Hook commands receive JSON on stdin. HTTP hooks receive the same JSON as a
  POST body.
- Secret-like env values and HTTP headers are rejected in this implementation
  slice.
- Hook commands use the hook runner, not recursive worker `run_command`.
- Fixed tool policy still runs before configurable hooks.
- Failure summaries are redacted before they are stored for display.

## Desktop Boundary
- The Tauri shell owns window lifecycle, runtime path resolution, loopback API
  port allocation, Node sidecar startup, readiness, and shutdown.
- The Node sidecar owns the same backend boundary as development mode: Hono
  routes, SQLite/libSQL, supervisor/worker execution, MCP, hooks, and provider
  integrations.
- Bundled resources are readonly. Writable runtime state belongs under
  `NIGHTWORKERS_RUNTIME_DIR`.

## Known Trust Limits
- Commands in a registered Project repository run locally on your machine.
- Provider credentials are user-managed and should be scoped for local
  evaluation before use with sensitive repositories.
- External MCP servers are user-managed. Only connect servers you trust.
- Agent Hook commands and HTTP endpoints are user-managed automation surfaces.
- NightWorkers does not automatically create PRs, merge changes, deploy code,
  or run parallel multi-agent orchestration in the current implementation.
