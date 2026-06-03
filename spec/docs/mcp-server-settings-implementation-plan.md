# MCP Server Settings Implementation Plan

## Goal

Give the NightWorkers coding agent first-class MCP compatibility for
user-configured, non-authenticated MCP Servers.

Users should be able to add, edit, enable, disable, test, and remove individual
MCP Server entries from the Settings screen. Enabled servers should be available
to the coding agent at run time through an MCP-compatible tool bridge.

Authentication-backed MCP Servers are explicitly out of scope for the first
implementation. The first slice should reject or hide OAuth, bearer-token,
header-token, and secret-based server configurations rather than storing partial
credentials.

## Current State

NightWorkers already has partial MCP client code, but it is integration-specific:

- `api/services/mcp-client.ts` connects only to contextStill through environment
  variables.
- `api/services/context-still/client.ts` is another contextStill-specific MCP
  client wrapper.
- The coding agent's tool catalog is static in
  `api/services/supervisor/prompt.ts`.
- Worker tools are dispatched through
  `api/services/worker-tools/dispatcher.ts` and protected by
  `api/services/tool-policy/*`.
- The supervisor schema currently accepts only internal `WorkerToolName` values.
- `api/services/supervisor/TEMP_DISABLE_EXTERNAL_MCP_TOOLS.ts` blocks names like
  `mcp__*` and dotted tool names because external MCP namespaces are not yet
  supported.
- Runtime settings are stored in `api/.runtime/llm-settings.json` and exposed
  through `/api/settings/llm/*`.
- `src/modules/nightworkers/components/SettingsScreen.tsx` already contains the
  Settings UI for LLM providers and Session Queue controls.
- Codex SDK provider support exists, but `buildCodexSupervisorThreadOptions()`
  currently disables many external features and starts threads without
  user-configured MCP server definitions.

## Non-Goals

- Do not implement OAuth, bearer tokens, API-key headers, cookie auth, or secret
  storage for MCP Servers in the first slice.
- Do not expose user-configured MCP tools directly as unrestricted shell access.
- Do not replace existing internal worker tools.
- Do not move supervisor routing decisions into regex or keyword branches.
- Do not remove contextStill-specific integration until the generic bridge is
  proven and migration is deliberate.
- Do not allow server-provided tools to mutate the workspace unless policy has a
  deliberate allow path.

## Supported Server Types In First Slice

Support only configurations that do not require stored credentials:

```ts
type McpServerTransport = 'stdio' | 'sse' | 'streamable_http';

type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  toolPrefix?: string;
  createdAt: string;
  updatedAt: string;
  lastStatus?: {
    ok: boolean;
    checkedAt: string;
    message: string;
    toolCount?: number;
  };
};
```

Validation rules:

- `stdio` requires `command`; `args`, `cwd`, and non-secret `env` are optional.
- `sse` and `streamable_http` require `url`.
- `url` must be `http://` or `https://`.
- `env` keys or values that look like secrets are rejected for the first slice.
- Headers are not supported in the first slice.
- `toolPrefix` must be a stable identifier such as `context_still` or
  `github_docs`; it becomes part of the NightWorkers-visible tool namespace.
- Before implementation, confirm the exact streamable HTTP transport export name
  in the installed `@modelcontextprotocol/sdk` version. If unavailable, keep the
  schema slot but implement `stdio` and `sse` first.

## Persistence And API Plan

Keep MCP Server settings separate from LLM provider settings.

Add a new runtime settings file:

- `api/.runtime/mcp-servers.json`

Add a backend module:

- `api/services/mcp/mcp-settings.ts`
- `api/services/mcp/mcp-config-schema.ts`

Add API routes under `/api/settings/mcp`:

- `GET /api/settings/mcp/servers`
  - returns all configured server entries with secrets omitted. There should be
    no secrets in the first slice, but the response shape should stay defensive.
- `POST /api/settings/mcp/servers`
  - creates a server config after validation.
- `PUT /api/settings/mcp/servers/:id`
  - updates editable fields and `enabled`.
- `DELETE /api/settings/mcp/servers/:id`
  - removes a server config and clears cached status.
- `POST /api/settings/mcp/servers/:id/test`
  - connects, calls `listTools`, disconnects, and stores `lastStatus`.

The API should not mutate process-wide environment variables for these server
configs. The runtime should read the MCP settings service when starting or
refreshing an agent run.

## Runtime Bridge Plan

Add a generic MCP client manager:

- `api/services/mcp/mcp-client-manager.ts`
- owns connection lifecycle per enabled server
- supports stdio, SSE, and streamable HTTP transports
- provides `listAvailableTools()` and `callTool(namespacedName, args)`
- keeps lightweight status and tool-list cache
- disconnects failed or disabled servers

NightWorkers-visible MCP tool names should be namespaced:

```txt
mcp__<serverPrefix>__<toolName>
```

This avoids collisions with internal worker tools and keeps the origin visible
in run events.

Add one internal bridge tool:

```ts
type WorkerToolName = ... | 'mcp_call_tool';
```

`mcp_call_tool` arguments:

```ts
{
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
```

The supervisor prompt can show external tools as catalog entries, but execution
should still flow through the internal `mcp_call_tool` bridge. This keeps
policy, run events, and error handling in the existing worker-tool path.

## Supervisor And Policy Plan

Change the supervisor in a controlled way:

1. Replace the hard-coded tool catalog builder with a runtime catalog builder
   that combines internal tools and enabled MCP tools.
2. Keep Round 1 routing free of tool execution.
3. In Round 2, include MCP tools only when at least one enabled server passes
   validation or has a usable cached tool list.
4. Normalize model-emitted `mcp__server__tool` calls into internal
   `mcp_call_tool` requests before schema validation or dispatch.
5. Remove or narrow `TEMP_DISABLE_EXTERNAL_MCP_TOOLS.ts` only after the
   namespaced MCP path is supported by schema, dispatcher, policy, and tests.

Policy defaults:

- MCP tools are read-only by default from NightWorkers' perspective.
- MCP calls are blocked if the server is disabled or no longer configured.
- Unknown MCP tool names are blocked.
- Server-provided schemas are used for argument validation when available.
- Tool output is size-limited and compressed like other worker tool output.
- Workspace mutation through MCP remains blocked until a later explicit policy
  design adds per-server or per-tool trust settings.

## Codex SDK Provider Plan

Treat Codex SDK MCP support as a parallel runtime concern, not the only
compatibility path.

First implementation should make the native supervisor MCP-compatible through
the generic bridge above. Then evaluate whether user-configured MCP servers
should also be passed into Codex SDK thread options.

Reason:

- The native runtime already owns NightWorkers event logging, policy gates,
  tool execution, and review evidence.
- Passing MCP servers directly into Codex SDK without the same policy/event path
  would create a second, less observable execution surface.

If Codex SDK server injection is added later, it should mirror the same
validated non-auth server list and emit enough run events to preserve replay and
reviewability.

## Settings UI Plan

Extend `SettingsScreen` with a new `MCP Servers` section or tab.

Expected UI:

- Server list with name, transport, enabled state, last test status, and tool
  count.
- Add Server button.
- Edit form:
  - Name
  - Transport: `stdio`, `sse`, `streamable_http`
  - Command and args for `stdio`
  - URL for remote transports
  - Optional cwd
  - Optional non-secret env key/value rows
  - Tool prefix
  - Enabled toggle
- Test Connection button.
- Delete button.

Validation UX:

- Show unsupported auth fields as unavailable in this first version.
- Reject secret-looking env keys such as `TOKEN`, `API_KEY`, `SECRET`,
  `PASSWORD`, `AUTH`, and `BEARER`.
- Show connection/test failures without saving misleading success state.

## Implementation Phases

### Phase 1: Settings Contract

- Add MCP config schema and runtime persistence service.
- Add `/api/settings/mcp/*` routes.
- Add unit tests for validation, save/load, update, delete, and auth-field
  rejection.

Acceptance:

- Multiple non-auth server configs can be saved independently.
- Secret-looking configs are rejected.
- LLM settings remain unchanged.

### Phase 2: Settings UI

- Add MCP Servers section to `SettingsScreen`.
- Extend workspace hook types and API calls as needed.
- Add component tests for add/edit/enable/test/delete flows if the existing test
  setup supports this surface.

Acceptance:

- A user can configure individual non-auth MCP Servers from Settings.
- The UI clearly shows that authenticated servers are not supported yet.

### Phase 3: MCP Client Manager

- Implement generic connection manager for stdio, SSE, and streamable HTTP.
- Implement test connection and tool listing.
- Normalize tool metadata into a NightWorkers catalog shape.
- Add tests with a local fake MCP server.

Acceptance:

- Enabled test servers can be connected.
- Tool list is discoverable.
- Disabled or failing servers do not break app startup.

### Phase 4: Tool Bridge

- Add `mcp_call_tool` to worker tool types, dispatcher, policy manifest, and
  blocked-result handling.
- Add output compression and error normalization.
- Add policy checks for disabled server, unknown tool, unsupported auth, and
  output limits.

Acceptance:

- A fake MCP tool can be called through the worker-tool dispatcher.
- Failed calls produce normal tool failure events.
- Policy violations remain distinguishable from ordinary tool failures.

### Phase 5: Supervisor Catalog And Schema

- Build the Round 2 tool catalog from internal tools plus enabled MCP tools.
- Normalize namespaced MCP tool calls into `mcp_call_tool`.
- Narrow or remove the temporary external MCP blocker.
- Add tests for model output using `mcp__prefix__tool` names.

Acceptance:

- The supervisor can select a configured MCP tool.
- The tool call is executed through the bridge.
- The final run ledger shows the MCP server/tool origin.

### Phase 6: Documentation And Verification

- Update `README.md`, `spec/docs/configuration.md`, and
  `spec/docs/architecture.md`.
- Add notes explaining that authenticated MCP servers are deferred.
- Run targeted tests first, then `pnpm verify`.

Acceptance:

- Docs describe the current supported MCP configuration shape.
- Verification passes.

## Test Plan

Targeted tests:

- MCP config schema rejects auth/secrets.
- MCP settings routes persist independent server entries.
- MCP client manager can list tools from a fake stdio server.
- `mcp_call_tool` dispatches a fake tool and handles failures.
- Tool policy blocks unknown/disabled MCP tools.
- Supervisor parser normalizes `mcp__server__tool` into `mcp_call_tool`.

End-to-end or integration test:

- Configure a fake local MCP server.
- Start a coding-agent run using fixture/test provider.
- Ensure the run calls the MCP tool through the bridge.
- Assert run events include MCP origin and normal terminal handling.

Final gate:

```bash
pnpm verify
```

## Key Risks

- Tool schemas from external MCP servers can be large or unstable. The prompt
  catalog should summarize names/descriptions and avoid dumping huge schemas.
- Some non-auth servers may still perform side effects. Treat all MCP tools as
  untrusted until per-tool policy is added.
- Direct Codex SDK MCP injection could bypass NightWorkers policy and run
  ledger. Keep native bridge first.
- Process-wide env mutation is inappropriate for a list of user-configured
  servers. Use a settings service and runtime manager instead.
- Removing the temporary external MCP blocker too early will reintroduce schema
  failures and unsupported tool loops.

## Later Follow-Ups

- Authenticated MCP Servers with encrypted secret storage.
- Per-server and per-tool trust policies.
- Project-scoped MCP Server enablement.
- Tool allow/deny lists per Project Folder.
- Codex SDK direct MCP server injection with replayable event capture.
- Import/export from common MCP config files once schema mapping is explicit.
