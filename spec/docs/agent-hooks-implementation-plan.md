# Agent Hooks Implementation Plan

## Goal

Give the NightWorkers coding agent user-configurable lifecycle hooks that behave
like common coding-agent hooks: registered from Settings, matched by event and
tool name, executed with structured JSON input, and able to block or annotate
selected lifecycle points.

The first implementation should make hooks useful for policy, verification,
logging, and reminders without creating a second unobservable runtime path. Hook
execution must stay inside NightWorkers' native run ledger, tool policy, and
review evidence model.

## Research Summary

The strongest public references are Claude Code Hooks and GitHub Copilot / VS
Code agent hooks.

- Claude Code defines hooks as user-defined command, HTTP, MCP-tool, prompt, or
  agent handlers that run at lifecycle points. Events are grouped by cadence:
  once per session, once per user turn, and on every tool call inside the
  agentic loop.
- The common minimum event set is:
  - `SessionStart`
  - `UserPromptSubmit`
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `Stop`
  - `SessionEnd`
- `PreToolUse` fires after the model has produced tool arguments and before the
  tool executes. It can deny or modify execution.
- `PostToolUse` fires after a successful tool call. It cannot undo the action,
  but it can append context, warn, or replace/augment the tool result in systems
  that support result modification.
- `PostToolUseFailure` separates failed tool calls from successful calls.
- `Stop` fires when the agent is about to stop. It can block stopping and force
  another model turn with a reason.
- Tool-event matchers usually match `tool_name`. Exact strings, alternation
  such as `Edit|Write`, wildcard all, and regex-like matchers are common.
- Command hooks receive JSON on stdin. HTTP hooks receive the same JSON as the
  POST body.
- Command and HTTP hooks should have explicit timeout behavior.
- Exit-code and JSON-output behavior differs by product, but the common control
  vocabulary is:
  - allow/no decision
  - deny/block with reason
  - ask/defer in interactive systems
  - add context for the next model turn
  - modify args/result in systems that support it
- Security guidance is consistent: hooks execute arbitrary user commands or
  call arbitrary HTTP endpoints, so settings should be explicit, visible,
  scoped, logged, timeout-limited, and fail behavior should be deliberate.

References:

- Claude Code Hooks reference:
  `https://code.claude.com/docs/en/hooks`
- GitHub Copilot Hooks reference:
  `https://docs.github.com/en/copilot/reference/hooks-reference`
- VS Code Agent Hooks preview:
  `https://code.visualstudio.com/docs/agent-customization/hooks`

## Current NightWorkers State

Relevant existing paths:

- Settings UI:
  - `src/modules/nightworkers/components/SettingsScreen.tsx`
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
  - `src/modules/nightworkers/types.ts`
- Settings API:
  - `api/routes/settings.ts`
  - current runtime-backed settings files under `api/.runtime/*`
- Native runtime:
  - `api/services/agent-runtime/NativeAgentRuntime.ts`
  - `api/services/supervisor/supervisor-loop.ts`
- Worker tool boundary:
  - `api/services/worker-tools/dispatcher.ts`
  - `api/services/worker-tools/types.ts`
- Fixed policy gate:
  - `api/services/tool-policy/tool-policy-gate.ts`
  - `api/services/tool-policy/types.ts`
  - `api/services/tool-policy/blocked-result.ts`
  - `api/services/tool-policy/tool-manifest.ts`
- Run ledger:
  - `shared/schemas/nightworkers.schema.ts`
  - `api/modules/nightworkers/nightworkers.repository.ts`
  - `api/services/run-events/*`

The clean insertion point is already present:

```txt
supervisor-loop decision.toolCall
  -> toolPolicyGate.beforeToolCall()
  -> executeWorkerTool()
  -> toolPolicyGate.afterToolCall()
  -> run event append
```

Hooks should sit beside policy, not replace it. The fixed policy gate remains
the safety boundary and hook execution sees only policy-normalized tool inputs
and policy-accepted tool results:

```txt
toolPolicyGate.beforeToolCall()
  -> hookRunner.run("PreToolUse")
  -> executeWorkerTool()
  -> toolPolicyGate.afterToolCall()
  -> hookRunner.run("PostToolUse" or "PostToolUseFailure")
```

`toolPolicyGate` remains the static safety layer. Hooks become the
user-configurable automation layer.

## Non-Goals

- Do not implement prompt-based or agent-based hooks in the first slice.
- Do not pass hooks directly into Codex SDK threads before the native runtime
  path has equivalent ledger and policy evidence.
- Do not allow hooks to silently bypass fixed tool policy.
- Do not make hook matching a supervisor prompt/routing concern.
- Do not add regex or keyword workflow branching to the supervisor.
- Do not execute hook commands through the worker `run_command` tool. Hook
  execution needs a separate runner to avoid recursive hook invocation and to
  keep hook process policy separate from worker-tool policy.
- Do not store secret HTTP headers or secret env values in the first slice.
- Do not support organization-managed policy hooks yet.
- Do not add project-committed hook config files yet; start with local runtime
  settings.

## First Slice

Support local runtime settings only:

- Storage: `api/.runtime/agent-hooks.json`
- Override env for tests/local experiments:
  - `NIGHTWORKERS_HOOKS_SETTINGS_PATH`
- API namespace:
  - `/api/settings/hooks/*`
- UI section:
  - Settings screen, below `MCP Servers` and above `Session Queue`

Supported events:

```ts
type AgentHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'SessionEnd';
```

Supported hook types:

```ts
type AgentHookHandlerType = 'command' | 'http';
```

First-slice event cadence:

- `SessionStart` fires once per task run, after `runtime_started`.
- `UserPromptSubmit` fires once per task run, immediately before the supervisor
  receives the compiled prompt and latest user message. It does not fire for
  every Workbench draft/chat message in the first slice.
- `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` fire inside the
  supervisor loop around worker-tool execution.
- `Stop` fires when the supervisor returns a stop/final decision, before the
  loop accepts that decision.
- `SessionEnd` fires once per task run before the runtime returns, including
  completed, blocked, cancelled, and failed exits when possible.

Supported decisions:

```ts
type AgentHookDecision =
  | { decision: 'allow'; additionalContext?: string }
  | { decision: 'deny'; reason: string; additionalContext?: string }
  | { decision: 'block'; reason: string; additionalContext?: string }
  | { decision: 'continue'; additionalContext?: string }
  | { decision: 'no_decision'; additionalContext?: string };
```

Interpretation:

- `allow` and `no_decision` continue normal flow.
- `deny` blocks `PreToolUse`.
- `block` blocks `UserPromptSubmit` and `Stop`.
- `additionalContext` is appended to the next supervisor observation/context
  bucket and logged in the run ledger.
- `PostToolUse` can add context and warnings in the first slice, but should not
  modify the tool result yet.
- `PostToolUseFailure` can add context and warnings, but should not convert a
  failed tool into success.

## Config Shape

Use a list form in storage, because it is easier for Settings UI CRUD than a
nested event map.

```ts
type AgentHookConfig = {
  id: string;
  name: string;
  enabled: boolean;
  event: AgentHookEvent;
  matcher?: string;
  handler:
    | {
        type: 'command';
        command: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        timeoutSeconds?: number;
        failClosed?: boolean;
      }
    | {
        type: 'http';
        url: string;
        headers?: Record<string, string>;
        allowedEnvVars?: string[];
        timeoutSeconds?: number;
        failClosed?: boolean;
      };
  createdAt: string;
  updatedAt: string;
  lastRun?: {
    ok: boolean;
    checkedAt: string;
    message: string;
    durationMs?: number;
  };
};
```

Validation:

- `name` is required.
- `event` must be one of the first-slice events.
- `matcher` is allowed only for tool events:
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
- Empty matcher or `*` means all tools.
- Exact match and `|` alternation should be supported first.
- Matchers use NightWorkers worker tool names in the first slice:
  - `run_command`
  - `run_verification`
  - `read_file`
  - `search_files`
  - `apply_patch`
  - `replace_content`
  - `git_status`
  - `git_diff`
  - `mcp_call_tool`
  - other names from `WorkerToolName`
- The UI can show common aliases such as `Bash`, `Edit`, and `Write` as helper
  labels, but saved configs should use the internal tool names unless an alias
  mapper is explicitly implemented and tested.
- Regex match can be added in the same matcher helper, but malformed regex must
  be rejected on save.
- `command` hook requires `command`.
- `http` hook requires `http://` or `https://` URL.
- Secret-like env keys/values and secret-like headers are rejected in the first
  slice.
- Default timeout should be short:
  - command/http default: 30 seconds
  - maximum: 120 seconds
- `failClosed` default:
  - command `PreToolUse`: true
  - HTTP `PreToolUse`: false
  - all other events: false

## Hook Input Shape

Use Claude-compatible field names for interoperability:

```ts
type BaseHookInput = {
  hook_event_name: AgentHookEvent;
  session_id: string;
  run_id: string;
  task_id: string;
  repository_id: string;
  cwd: string;
  timestamp: string;
  transcript_path?: string;
};
```

Tool events:

```ts
type ToolHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  tool_result?: unknown;
  error?: string;
};
```

User prompt:

```ts
type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
};
```

Stop:

```ts
type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop';
  stop_reason: 'end_turn' | 'completed' | 'needs_review' | 'needs_human' | 'failed';
  last_assistant_message?: string;
};
```

Session lifecycle:

```ts
type SessionLifecycleHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart' | 'SessionEnd';
  source: 'run_start' | 'run_end';
};
```

## Hook Output Shape

Accept both top-level simple output and Claude-like nested output.

```ts
type AgentHookOutput = {
  decision?: 'allow' | 'deny' | 'block' | 'continue';
  reason?: string;
  additionalContext?: string;
  modifiedArgs?: Record<string, unknown>;
  hookSpecificOutput?: {
    hookEventName?: AgentHookEvent;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    additionalContext?: string;
    modifiedArgs?: Record<string, unknown>;
  };
};
```

First-slice handling:

- `permissionDecision: "deny"` maps to `deny`.
- `decision: "block"` maps to block for blockable turn events.
- `modifiedArgs` is accepted for `PreToolUse` but should be disabled by default
  in execution until tests prove it cannot bypass policy. If enabled, policy
  must run again on the modified args.
- Plain stdout from command hooks is logged as hook output, not automatically
  injected as model context unless it is valid JSON with `additionalContext`.

## Runtime Plan

Add hook modules:

- `api/services/hooks/hooks-config-schema.ts`
- `api/services/hooks/hooks-settings.ts`
- `api/services/hooks/hooks-matcher.ts`
- `api/services/hooks/hooks-runner.ts`
- `api/services/hooks/hooks-output.ts`
- `api/services/hooks/types.ts`

`hooks-settings.ts` responsibilities:

- read/write `agent-hooks.json`
- validate configs
- create/update/delete configs
- store `lastRun`

`hooks-matcher.ts` responsibilities:

- decide if a hook applies to an event
- exact tool-name match
- `|` alternation
- `*` / empty match-all
- optional regex only after validation

`hooks-runner.ts` responsibilities:

- build event input
- run matching hooks in stable config order
- enforce timeout
- execute command hooks through a dedicated process runner, not worker
  `run_command`
- parse stdout/HTTP response JSON
- record hook run summaries
- combine decisions and contexts
- expose fail-open/fail-closed behavior per hook

Command runner requirements:

- Use `child_process.spawn` or equivalent exec-form process creation when `args`
  are provided.
- Use shell form only when `args` is omitted.
- Default `cwd` to the repository root for run-scoped hooks.
- Pass hook input JSON on stdin.
- Capture stdout and stderr separately with bounded byte limits.
- Do not run hooks recursively for hook-runner commands.
- Do not apply worker command policy directly to hook commands. Hook commands are
  user-configured local automation and are governed by hook validation,
  visibility, timeout, fail-open/fail-closed behavior, and audit events.

Decision aggregation:

- For `PreToolUse`, any deny blocks the tool.
- For `UserPromptSubmit`, any block prevents run start or task execution.
- For `Stop`, any block causes another supervisor turn with the block reason as
  an observation.
- Multiple `additionalContext` strings are joined with two newlines and capped
  at 10 KB.
- Hook execution errors are ledger events. They block only when `failClosed` is
  true for that event/handler.

## Integration Points

### Settings API

Extend `api/routes/settings.ts` with routes:

- `GET /api/settings/hooks`
  - returns `{ hooks: AgentHookConfig[] }`
- `POST /api/settings/hooks`
  - creates a hook
- `PUT /api/settings/hooks/:id`
  - updates a hook
- `DELETE /api/settings/hooks/:id`
  - removes a hook
- `POST /api/settings/hooks/:id/test`
  - runs hook with sample input and stores `lastRun`

Keep this separate from `/api/settings/llm` and `/api/settings/mcp`.

### Settings UI

Extend:

- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/SettingsScreen.tsx`

Expected controls:

- hook list with name, event, matcher, enabled state, handler type, last result
- Add Hook button
- event select
- matcher input, disabled for non-tool events
- handler type segmented control: Command / HTTP
- command, args, cwd fields for command hooks
- URL, headers, allowed env vars for HTTP hooks
- timeout number input
- fail-closed checkbox
- enable/pause checkbox
- test, save, delete actions

Do not hide risk. Command/HTTP hooks should display a short local-only warning
near the form because they can execute arbitrary commands or call arbitrary
endpoints.

### Native Runtime

In `NativeAgentRuntime.start()`:

- run `SessionStart` after `runtime_started`
- run `UserPromptSubmit` before handing control to supervisor
- run `SessionEnd` before returning, including cancelled/error paths where
  feasible

For `UserPromptSubmit`, if blocked:

- append a `hook.blocked` run event
- return `blocked`
- do not start the supervisor loop

### Supervisor Tool Loop

In `api/services/supervisor/supervisor-loop.ts`:

- after fixed `toolPolicyGate.beforeToolCall`, run `PreToolUse`
- if `PreToolUse` returns `modifiedArgs`, record it as ignored in the first
  slice unless a later implementation explicitly enables modified arguments and
  re-runs `toolPolicyGate.beforeToolCall` on the modified input
- if denied:
  - build a blocked tool result with a hook-specific code
  - append `hook.blocked`
  - feed the hook reason back as a tool observation so the supervisor can choose
    a different allowed action
  - count repeated hook blocks against the existing budget controller
  - move the run to `needs_human` only when the budget detects repeated blocking
    or the hook uses a fail-closed execution error
- after `executeWorkerTool`:
  - run `toolPolicyGate.afterToolCall` first
  - if post-policy reports a violation, handle that violation before running
    post hooks
  - run `PostToolUse` on policy-accepted success
  - run `PostToolUseFailure` on policy-accepted failed tool results
  - append hook additional context to `toolObservations`
- before accepting a stop/final response:
  - run `Stop`
  - if blocked, append the reason to observations and continue the loop
  - count repeated Stop blocks against the existing budget controller and add a
    small explicit cap, such as 2 Stop-hook blocks per run, to avoid infinite
    loops

### Run Events

Extend run event types with:

```txt
hook.started
hook.finished
hook.blocked
hook.failed
```

Use `actor: "system"` for hook events in the first slice. Add a dedicated
`"hook"` actor only if the run-event actor schema, timeline UI, replay, JSONL
export/import, and review evidence code are updated together.

If schema churn should be minimized, use `system.warning` and `tool.policy_blocked`
for the very first prototype, but the implementation should prefer dedicated
events because hooks are user-visible automation.

Payload should include:

- hook id/name/event
- matcher
- handler type
- tool name when applicable
- decision
- reason
- durationMs
- failClosed
- stdout/stderr preview or HTTP status

Never log full secret-like env/header values.

Legacy evidence compatibility:

- Existing review and memory-feedback code already keys on `tool.policy_blocked`
  and `safety.policy_violation`.
- Hook denials should emit `hook.blocked` as the primary event and may include a
  compatibility `system.warning` payload in the first slice.
- Do not emit `tool.policy_blocked` for hook denials unless review/replay code is
  intentionally updated to distinguish fixed policy blocks from user hook
  blocks.

### Outcome Types

Hook-blocked runs need explicit type support:

- `AgentRuntimeResult.terminalState` already supports `blocked`.
- Add `stoppedBy: "hook"` to `api/services/agent-runtime/types.ts`, or map hook
  stops to an existing value only as a temporary compatibility step with a clear
  `payloadJson.reason`.
- Add a review outcome reason such as `hook_blocked` if final review/result
  builders need to distinguish hook blocks from fixed policy violations.
- Ensure `run.outcome_decided` can represent hook-blocked runs without
  collapsing them into `policy_violation`.

## Security And Policy

Hooks are intentionally powerful. The first slice should apply these defaults:

- local runtime settings only
- no secret storage
- timeout enforced
- output size capped
- command hooks run with `cwd` defaulting to repo root
- command args use exec form when provided
- shell form is allowed only when `args` is empty
- hook env is explicit and non-secret
- HTTP headers cannot contain secrets in first slice
- hook command errors do not block unless `failClosed` applies
- fixed `toolPolicyGate` still runs before user hooks
- post-tool hooks run only after fixed post-policy accepts the result
- if `modifiedArgs` support is enabled later, fixed policy must be re-run on the
  modified args

## Testing Plan

Add focused unit tests:

- `tests/services.agent-hooks-settings.test.ts`
  - CRUD validation
  - secret rejection
  - runtime path override
- `tests/services.agent-hooks-matcher.test.ts`
  - empty/wildcard
  - exact
  - alternation
  - regex validation if implemented
- `tests/services.agent-hooks-runner.test.ts`
  - command JSON stdin
  - command hooks do not recurse through worker `run_command`
  - HTTP POST body
  - timeout
  - fail-open / fail-closed
  - JSON output parsing
  - additional context aggregation
- `tests/services.supervisor-hooks.test.ts`
  - `PreToolUse` deny blocks tool execution
  - `PreToolUse` denial is distinguishable from fixed policy blocks
  - `PostToolUse` context reaches next observation
  - `PostToolUse` runs after fixed post-policy, not before it
  - `PostToolUseFailure` runs after failed tool result
  - `Stop` block forces another iteration and budget prevents infinite loops
  - hook-blocked terminal results preserve `terminalState="blocked"` and
    `stoppedBy="hook"`
- `tests/routes.settings-hooks.test.ts`
  - API route CRUD and test endpoint
- UI test if the existing setup supports it:
  - `SettingsScreen` renders hooks list/form
  - add/update/delete calls correct endpoints

Regression gates:

```bash
pnpm test run tests/services.agent-hooks-settings.test.ts
pnpm test run tests/services.agent-hooks-matcher.test.ts
pnpm test run tests/services.agent-hooks-runner.test.ts
pnpm test run tests/services.supervisor-hooks.test.ts
pnpm test run tests/routes.settings-hooks.test.ts
pnpm verify
```

## Implementation Order

1. Add shared hook schemas and backend settings persistence.
2. Add hook matcher and output parser.
3. Add hook runner for command and HTTP handlers.
4. Add `/api/settings/hooks/*` routes.
5. Add workspace client state and Settings UI section.
6. Add run event types and normalizer/canonicalizer updates.
7. Add hook outcome type support for `stoppedBy="hook"` and review/result
   reason mapping.
8. Integrate `SessionStart`, `UserPromptSubmit`, and `SessionEnd` in
   `NativeAgentRuntime`.
9. Integrate `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` in
   `supervisor-loop.ts`.
10. Integrate `Stop` with repeated-block budget handling.
11. Update `README.md`, `spec/docs/configuration.md`, and
    `spec/docs/architecture.md`.
12. Run targeted tests and `pnpm verify`.

## Open Decisions

- Whether `PreToolUse` hook denial should be retryable for every tool or only
  for tools where the supervisor can reasonably choose an alternative action.
  The planned default is retryable observation first, then budgeted
  `blocked`/`needs_human` after repeated hook blocks.
- Whether to support `modifiedArgs` in the first slice. The safer default is to
  parse and log it but ignore it until policy re-check tests are in place.
- Whether settings should eventually support project-scoped hooks in addition
  to global hooks. The first slice should stay global to match existing Settings
  structure.
- Whether project-local hook files should be supported later. If added, they
  need a trust model and visible activation state.
- Whether HTTP hook errors should ever fail closed by default. First slice should
  default HTTP to fail-open except when the user explicitly enables fail-closed.

## Acceptance Criteria

- Users can add, edit, enable, disable, test, and delete hooks from Settings.
- Enabled command hooks receive structured JSON on stdin.
- Enabled HTTP hooks receive structured JSON as request body.
- `PreToolUse` hooks can block a worker tool before it executes.
- `PostToolUse` and `PostToolUseFailure` hooks can add context/warnings that are
  visible in the run ledger and next supervisor observations.
- `Stop` hooks can prevent stopping without causing unbounded loops.
- Hook execution is visible in run events.
- Existing fixed tool policy behavior remains intact.
- Existing LLM, MCP Server, and Session Queue settings are unaffected.
