# Feature Tour

This tour describes NightWorkers surfaces from an adoption perspective: what
they do, where to find them, why they matter, the evidence they create, and the
current limits.

## Thirty-Second Value Tour
NightWorkers is easiest to evaluate as an evidence system:

1. A Project Folder fixes the target repository.
2. A Workbench Session keeps chat, planning, artifacts, and run review together.
3. The Implementation Queue separates approved automation from ordinary chat.
4. A run records tool calls, policy blocks, todos, diffs, tests, usage events,
   and final reports.
5. Artifacts such as Blueprint Preview and Data Model give the user something to
   inspect before adopting generated work.

If you only want a transient chat assistant, NightWorkers is heavier than you
need. If you want autonomous coding work to leave local, reviewable evidence,
these are the surfaces to inspect first.

## Workbench
What it does:
- Provides the chat-first workspace for a Project Folder Session.
- Handles intake, planning, Blueprint generation, direct execution requests,
  artifact review, and timeline inspection.

Where to find it:
- Open the app, select a Project Folder, then select or create a Session.

Why it matters:
- Keeps conversation, execution evidence, artifacts, and decisions in one
  project-scoped workspace.

Evidence it creates:
- Task messages, routing output, run events, artifact references, and adoption
  decisions.

Current limits:
- It is not a hosted collaboration workspace.
- It does not automatically create PRs, merge changes, or deploy code.

## Implementation Queue
What it does:
- Holds explicit user-approved implementation work.
- Separates normal Session chat from queued automation.
- Shows Processor lanes, queued entries, completed archives, and TODO Workflow
  gates.

Where to find it:
- Open the Implementation Queue surface from the main NightWorkers shell.

Why it matters:
- Makes automation admission visible instead of treating every chat message as
  a background run.

Evidence it creates:
- Queue entries, run claims, processor state, todo-gate decisions, and archived
  queue execution records.

Current limits:
- Queue execution is not parallel multi-agent orchestration.
- Processor capacity is intentionally bounded.

## Run Evidence
What it does:
- Records execution lifecycle events for supervisor-worker runs.
- Captures tool outcomes, policy blocks, todos, diffs, test results, usage
  events, and final reports.

Where to find it:
- In the Workbench timeline for a Session.
- Through run APIs such as `/api/runs/:id` and
  `/api/runs/:id/events?afterSeq=...`.

Why it matters:
- Run outcomes remain inspectable after navigation, refresh, or WebSocket
  reconnect.

Evidence it creates:
- Persisted `task_events`, run detail rows, diff/test/final-report event
  metadata, and usage records.

Current limits:
- Evidence describes what NightWorkers recorded locally; external provider or
  tool systems still have their own logs and policies.

Example first-run evidence to look for:

| Evidence | What it proves |
| --- | --- |
| `state_change` event | The run lifecycle advanced through a known state. |
| `tool_call` / `tool_result` | The worker used a concrete tool and recorded the result. |
| Todo update | Progress was tracked as structured work, not just prose. |
| Diff metadata | File changes can be reviewed before commit. |
| Test or check result | Verification was attempted and its result is visible. |
| Final report | The run ended with a reviewable conclusion. |

## Activity Transcript
What it does:
- Presents chat and run activity as a readable timeline inside the Workbench.
- Keeps chat/intake messages distinct from execution events.

Where to find it:
- The central Workbench timeline.

Why it matters:
- Makes it easier to see whether a request stayed as intake/chat or actually
  started a run.

Evidence it creates:
- Transcript-visible task messages, event projections, artifact cards, and run
  status updates.

Current limits:
- It is a projection of local state, not a replacement for inspecting raw logs
  or database rows during deep debugging.

## Blueprint Preview
What it does:
- Renders App Blueprint artifacts as reviewable application previews.
- Supports governed preview settings for theme, density, shape, shadow, font,
  contrast, motion, and component variants.

Where to find it:
- Open an App Blueprint artifact from the Workbench Artifact Pane or timeline.

Why it matters:
- Lets users review generated product structure before treating it as adopted
  planning input.

Evidence it creates:
- Blueprint artifact messages, preview settings rows, and Blueprint adoption
  decisions tied to the source message.

Current limits:
- Visual preview settings do not apply physical database migrations.
- Normal App Blueprint generation should not invent DB tables or DDL.

Example adoption question:
- Does the Blueprint describe screens, sections, states, and visual intent well
  enough to guide implementation?
- Are data model decisions kept in the Data Model view instead of being hidden
  inside visual UI copy?
- Is the artifact worth adopting as planning input, or should it remain a draft?

## Data Model
What it does:
- Captures canonical data structures, storage contracts, and API-facing data
  assumptions for Plan mode without applying migrations.

Where to find it:
- The Data Model tab in Plan Mode Workspace.

Why it matters:
- Keeps visual application structure separate from data modeling while allowing
  UI-less tasks to proceed without forcing Blueprint generation.

Evidence it creates:
- Data Model artifact messages tied to the source Feature Plan, Questionnaire,
  or Blueprint context.

Current limits:
- It does not create physical tables, columns, relations, or migrations by
  itself.

Example adoption question:
- Does the Data Model capture canonical entities and API-facing assumptions?
- Is it specific enough to guide an implementation plan?
- Does it avoid applying physical database changes before review?

## Design Token Adoption
What it does:
- Stores explicit adopted/not-adopted decisions for Blueprint design token
  settings.

Where to find it:
- Blueprint Preview design/adoption controls.

Why it matters:
- Later planning can prefer explicitly adopted design choices instead of
  assuming the newest artifact is authoritative.

Evidence it creates:
- `blueprint_design_token_adoptions` rows tied to Session and message IDs.

Current limits:
- Adoption state is persistence metadata. It does not rewrite artifact content.

## LLM Provider Settings
What it does:
- Manages OpenAI, Azure OpenAI, Bedrock, and Codex SDK provider/model settings.
- Provides smoke tests and masked secret handling.

Where to find it:
- Settings, LLM section.

Why it matters:
- Lets local users validate provider connectivity before running Workbench
  tasks.

Evidence it creates:
- Settings files, smoke-test responses, provider usage records, and
  `llm.usage` events.

Current limits:
- Provider credentials remain user-managed.
- Live provider E2E is optional and skipped unless credentials are configured.

## MCP Server Settings
What it does:
- Configures non-authenticated stdio, Streamable HTTP, and legacy-compatible SSE
  MCP servers.
- Supports paste import, connection tests, ON/OFF controls, and tool discovery.

Where to find it:
- Settings, MCP section.

Why it matters:
- Extends worker capabilities while keeping calls inside the worker-tool
  evidence path.

Evidence it creates:
- MCP settings files, connection test results, tool discovery output, and
  `mcp_call_tool` run evidence.

Current limits:
- Auth headers, API keys, bearer tokens, cookies, and secret-like env values are
  intentionally rejected in the current implementation.

## Agent Hooks
What it does:
- Runs local command or HTTP hooks for supported lifecycle events.
- Keeps hook execution separate from worker `run_command`.

Where to find it:
- Settings, Agent Hooks section.

Why it matters:
- Adds local automation around tool/session lifecycle events without making
  hooks invisible to NightWorkers.

Evidence it creates:
- Hook settings files, last-run status, redacted failure summaries, and run
  evidence around tool lifecycle events.

Current limits:
- Hook commands and HTTP endpoints are user-managed.
- Secret-like env values and headers are rejected in the current implementation.

## Desktop Packaging
What it does:
- Builds a macOS Tauri app that launches the frontend in a WebView and manages
  the Node backend as a sidecar.

Where to find it:
- Use `bun run desktop:build` and `bun run desktop:smoke`.

Why it matters:
- Lets NightWorkers run as a local desktop app while preserving the backend
  boundary and local runtime storage model.

Evidence it creates:
- Desktop runtime logs, sidecar logs, API logs, packaged app smoke-test output,
  and app data runtime files.

Current limits:
- DMG creation and signing are separate release gates.
- Desktop state is local to the resolved runtime directory; set
  `NIGHTWORKERS_RUNTIME_DIR` to override it.

## Sample Final Report Shape
A useful NightWorkers run should leave a final report that lets you review the
work without reconstructing the whole transcript. A good report usually answers:

- What changed or was investigated.
- Which files or artifacts matter.
- Which checks ran and whether they passed.
- Which risks, failures, or manual follow-ups remain.
- Whether the target repository should be committed, retried, or left for human
  review.

Treat the final report as one piece of evidence, not the only one. It should be
read together with the recorded diff, tool results, and verification events.
