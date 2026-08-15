# NightWorkers

<img src="assets/brand/nightworkers-logo-icon-64.png" alt="NightWorkers logo" width="64" height="64" />

[English](./README.md) | [日本語](./README.ja.md)

NightWorkers is a local-first control plane for running coding-agent work as an
inspectable development lifecycle. It keeps the target repository, planning
artifacts, execution authorization, isolated Git workspace, queue state, tool
activity, verification, review, and closeout decisions in durable local state.

It is designed for a human who wants an agent to keep moving without turning
the repository into an untraceable background job. A task starts stopped. The
user explicitly starts its Mission Pilot, can stop it again, and can inspect the
persisted evidence used at each gate.

## Contents

- [The Product in One Flow](#the-product-in-one-flow)
- [Why NightWorkers Exists](#why-nightworkers-exists)
- [Who It Is For](#who-it-is-for)
- [What Is Implemented](#what-is-implemented)
- [Local State and Trust Boundary](#local-state-and-trust-boundary)
- [Runtime Configuration](#runtime-configuration)
- [Quick Start](#quick-start)
- [Credential-Free Demo](#credential-free-demo)
- [Desktop Application](#desktop-application)
- [Verification](#verification)
- [Operations and Development Commands](#operations-and-development-commands)
- [Architecture](#architecture)
- [Current Limits](#current-limits)
- [Documentation](#documentation)
- [Source-of-Truth Map](#source-of-truth-map)

## The Product in One Flow

```text
Project Folder
  -> Goal / Evaluation / Quality finding / direct Task
  -> Mission Pilot (stopped by default)
  -> Play authorization
  -> Questionnaire and selected Plan artifacts
  -> Artifact review and focused correction
  -> reviewed Queue handoff
  -> task-owned branch and worktree
  -> implementation
  -> Test Mode evidence
  -> Review decision and possible rework
  -> Security Oracle evidence or policy skip
  -> commit / merge / push according to the saved Git policy
  -> completion and archive
```

This is not a promise that every task reaches the last step. Missing evidence,
stale context, failed verification, blocking review findings, Git conflicts, or
an explicit Stop move the task to a visible waiting or attention state.

## Why NightWorkers Exists

Coding agents are useful at producing changes, but a long-running development
workflow needs more than a final chat message. NightWorkers makes the operating
state explicit:

- which local Project Folder is in scope;
- which Task and context revision authorized the work;
- which plan artifacts were generated and reviewed;
- which branch and worktree own the implementation;
- which tools, commands, todos, diffs, and tests were recorded;
- whether Test, Review, security, and Git integration gates passed;
- what stopped, failed, changed, or still needs a human decision;
- how many provider calls, tokens, time, and estimated cost were recorded.

The differentiator is not autonomous code generation by itself. It is
human-governed autonomy backed by a local execution ledger.

## Who It Is For

NightWorkers is a good fit when you want to:

- run coding-agent work against local repositories;
- keep planning, authorization, implementation, verification, and review as
  separate persisted states;
- let work continue after an intervention window while retaining a real Stop
  boundary;
- isolate reviewed implementation work in Task-owned Git worktrees;
- inspect evidence before commit, merge, push, completion, or archive;
- compare Project evaluation, quality, usage, duration, and estimated cost over
  time;
- operate provider routing, MCP servers, hooks, and security tooling from one
  local control plane.

It is not a good fit when you need a hosted team SaaS, browser-only onboarding,
distributed multi-host scheduling, automatic pull-request creation or deploys,
or several agents racing in the same repository workspace.

## What Is Implemented

### Mission Pilot

Every Task created through the shared task-creation path receives a Mission
Pilot session in the same database transaction. Its desired state is initially
`stopped`.

Pressing Play creates a versioned authorization snapshot for the current Task
context. The saved authorization covers planning, Queue admission,
implementation, test mutation, review, local commit, task completion, and task
archive. Push behavior remains controlled by the saved push policy.

Mission Pilot currently provides:

- explicit Play and Stop controls with optimistic version checks;
- a visible intervention countdown before an unattended continuation;
- persisted context revisions and digests;
- editable Questionnaire drafts with answer provenance;
- resumable Plan progress rather than regenerating accepted checkpoints;
- routing-selected Plan artifacts;
- structured review of the current artifact set;
- focused correction of the artifact that caused a review problem;
- a reviewed, idempotent handoff into the Implementation Queue;
- post-Queue implementation, Test, Review, rework, closeout, and recovery;
- Pilot Thought, which reads persisted Mission Pilot and owned run events.

Mission Pilot does not treat a fluent model response as completion. Queue
admission requires current reviewed context and the required artifacts. Test and
Review use their own persisted records, and later changes can invalidate older
evidence.

### Task-Owned Git Workspaces

NightWorkers manages Git worktrees as a product surface and as an execution
boundary.

The Project Worktrees view can:

- list the base worktree and linked worktrees;
- show branch, HEAD, latest commit, upstream, ahead/behind state, and file-state
  counts;
- show active Task and Run usage;
- create a worktree from a new or existing branch;
- display its diff;
- remove eligible worktrees with explicit discard confirmation when supported;
- preview and execute `git worktree prune`;
- prevent deletion of the base worktree and worktrees with non-discardable
  blockers.

For the reviewed Mission Pilot path, NightWorkers records a Task-owned Git
workspace with its source branch, merge target, base SHA, expected HEAD,
worktree identity, materialization source, and policy snapshot. Existing Git
repositories, starter templates, and Git imports have explicit materialization
contracts; an empty project can run a separate repository-bootstrap phase
before implementation.

Review exposes the integration decision instead of silently merging. The
current Git integration contract supports:

- merge preview;
- defer and rework decisions;
- merge commit, squash, and fast-forward-only strategies;
- optional source-push requirements;
- manual or after-merge target-push policy;
- an optional external-CI gate;
- merge-target changes that invalidate stale preview evidence;
- conflict and already-integrated states recorded in a merge record.

Direct and legacy execution paths can exist without the same Task workspace
record. The Task-owned workspace statements above describe the reviewed
Mission Pilot / Queue path.

### Project Intelligence

Project Detail is more than a repository picker. It has six current views:

| View | Current behavior |
| --- | --- |
| Overview | Project metadata, repository snapshot, recent Task state, and navigation into the project-specific tools. |
| Mission | Mission / Task Generation: Goal, Mission, proposal, and Task-candidate management; selected candidates can become executable Tasks. |
| Evaluation | LLM-backed evaluation across fixed product and engineering dimensions, history comparison, evidence/confidence, improvement generation, and Task creation. |
| Quality | Unit/coverage and E2E capability detection, managed runs, coverage file inspection, and coverage-improvement Task creation. |
| Tech Stack | Detected stack profile used by Project and Task-planning surfaces. |
| Worktrees | Git integration policy plus worktree creation, status, diff, removal, and prune operations. |

The global Overview can be scoped by Project and time range. It reports run
counts, warnings, provider/model usage, token categories, cache rate, duration,
throughput, estimated cost or credits, model breakdown, expensive calls, and a
Project snapshot containing evaluation and coverage data.

### Planning and Reviewable Artifacts

Plan Mode does not force every design document into every task. A routing
decision selects the applicable views from the capabilities enabled in
Settings.

Implemented Plan surfaces include:

- Questionnaire;
- Feature Plan;
- App Blueprint and Blueprint Preview;
- Data Model;
- User Flow;
- API I/O Contract;
- Activity Flow;
- Sequence Flow;
- Zod Schema Design.

Questionnaire is always part of the Mission Pilot Plan sequence. Other views
can be included or omitted by the saved routing decision. Existing artifacts
and accepted Questionnaire state are resumable checkpoints.

Blueprint Preview keeps visual application structure separate from canonical
data modeling. Preview controls cover theme, density, shape, shadow, font,
contrast, motion, and component variants. Blueprint and design-token adoption
are stored as explicit decisions tied to the Task and source message; adoption
metadata does not rewrite the artifact.

Artifacts can be inspected alongside the Project tree, source previews, and
diffs. Supported artifact exports include source-oriented output and rendered
image export where the artifact surface supports it.

### Workbench and Prompt Input

The Workbench is the Task-scoped operating surface for chat, planning,
execution, artifacts, and review.

It currently supports:

- normal Workbench messages and explicit intents;
- initial Task prompts and later messages;
- PNG, JPEG, WebP, and GIF prompt-image attachments with count, size, MIME, and
  file-signature validation;
- persisted task messages and artifact references;
- an Activity Transcript that keeps chat/intake separate from run events;
- replayable run events using `runId` and `afterSeq` cursors;
- Todo state, tool outcomes, policy blocks, diffs, tests, usage, and final
  reports;
- URL-addressable Overview, Queue, Project Detail, Session, Task, and Settings
  routes.

Repository writes are performed through registered worker-tool boundaries
relative to the registered Project or its assigned Task worktree. Provider or
Supervisor decision scratch directories are not accepted as evidence that the
Project repository was changed.

### Context Continuity and External Evidence

NightWorkers has two distinct continuity paths:

- the built-in StateCard cache derives compact conversation context and can
  inject the latest card into a runtime request without rewriting the stored
  user prompt;
- when a contextStill MCP server is configured, the native runtime recognizes
  `initial_instructions`, `context_compile`, `context_decision`, `compile_eval`,
  and candidate-registration procedures and records their outcomes in the run
  ledger and transcript.

contextStill is an external MCP capability, not hidden storage inside
NightWorkers. Availability and task-specific procedure requirements determine
whether a missing call is advisory or blocking. The credential-free demo does
not require an external memory service.

### Implementation Queue

Normal Workbench conversation and queued automation are separate states. The
Implementation Queue provides:

- explicit admission of implementation-ready work;
- global and Project-scoped Queue views;
- bounded Processor lanes and capacity settings;
- TODO Workflow claim gates;
- claim readiness separate from row creation;
- persisted queued, active, attention, completed, and archived state;
- recovery and reconciliation paths for interrupted Mission Pilot work.

Mission Pilot can create a held Queue row while a repository or workspace is
being prepared. A row is not claimable merely because it exists.

### Test, Review, Security, and Closeout

NightWorkers separates these responsibilities:

| Boundary | Owns |
| --- | --- |
| Implementation | Repository changes and implementation evidence. |
| Test Mode | Verification document, required checklist items, managed evidence, and `completion_check`. |
| Review Mode | Review Run, structured findings, dispositions, and rework decisions. |
| Security Oracle | Scanner-backed security evidence or a saved policy skip. |
| Git closeout | Evidence revalidation, commit, merge decision, and push-policy handling. |

A final report is useful evidence, but it is not the closeout gate. Closeout
also checks the active Test snapshot, matching Review decision, Security Oracle
state, unresolved blocking findings, ownership, and Git state. Review-applied
fixes make earlier Test evidence stale and require new verification.

The optional vulnWorkbench integration invokes a separately configured local
vulnWorkbench checkout for scanner-backed security diagnostics. When it is not
configured or is ineligible, NightWorkers records the unavailable or
policy-skip state instead of presenting an LLM-only concern as a confirmed
vulnerability.

The Project-detail vulnerability scan uses the local CLI connection by default.
NightWorkers passes the registered `localPath` directly to the vulnWorkbench
CLI, so no vulnWorkbench HTTP server or service token is required. The screen
discovers the `quick`, `standard`, and `deep` presets, working-tree/full targets,
and allowlisted source, dependency-manifest, artifact, and detailed profiles
from that CLI. Select the HTTP provider connection in Settings only when using
a separate process or host. Before the first local scan, run `bun install` and
`bun run db:migrate` once in the vulnWorkbench checkout.

### Providers, Routing, MCP, and Hooks

Structured reasoning and repository execution are separate runtime concerns.

The Settings UI currently manages:

- Azure OpenAI, OpenAI-compatible, AWS Bedrock, Codex SDK, and local provider
  endpoints;
- enabled models and per-role provider/model routing;
- native API runner or Codex SDK implementation runtime lanes;
- provider smoke tests and normalized usage recording;
- General settings, language, timezone, currency, FX source, and retention;
- Plan Mode capabilities and appearance;
- Project Security Intelligence, ontology-tool eligibility, and the
  vulnWorkbench project-exploration pilot;
- MCP servers;
- Agent Hooks.

MCP settings support stdio, Streamable HTTP, and legacy SSE-compatible
connections, paste import, tool discovery, connection tests, and ON/OFF state.
The current settings contract rejects authentication headers, API keys, bearer
tokens, cookies, and secret-like environment entries. MCP tool execution stays
inside the worker-tool evidence path.

The project-exploration pilot requires an app-managed MCP server entry for
vulnWorkbench whose discovered tools include
`vuln_prepare_project_intelligence`, `vuln_get_project_intelligence_status`,
and `vuln_get_project_exploration_catalog`. Configure the MCP process with an
explicit `STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS` allowlist; an empty value
is fail-closed. The pilot remains off by default and can be configured per
Project in the Security / Ontology settings screen. Its persisted sibling
setting is:

```json
{
  "projectExplorationCatalog": {
    "enabled": false,
    "mcpServerId": null
  }
}
```

Set `enabled` to `true` and `mcpServerId` to the app-managed vulnWorkbench
server ID only for a controlled pilot. NightWorkers prepares intelligence by
the registered repository path, stores no vulnWorkbench internal IDs as run
keys, and gives the coding agent a focus-only `project_exploration_catalog`
contract. The native/API tool catalog remains stable; a typed system context
tells the agent whether the catalog is available and, when useful, to call it
before broad directory/search exploration. Assigned Git worktrees may reuse
registered-root intelligence only while both roots are clean at the same HEAD;
MCP calls always use the registered root, and catalog use is rejected after the
execution worktree changes. The pilot supports the native/API
implementation lane only; Codex SDK, planning, test, review, and general-answer
lanes remain unchanged. Preparation, freshness, or MCP failures are fail-open and preserve
the default exploration behavior.

Agent Hooks support command or HTTP actions around tool and session lifecycle
events, including `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`.
Hook execution uses its own runner, stores status, and redacts failure summaries;
it does not recursively call the worker command tool.

## Local State and Trust Boundary

The default development runtime root is:

```text
<nightWorkers checkout>/.nightworkers/
```

Runtime paths are allocated under that root as needed. Desktop bootstrap creates
the managed subdirectories; development services create the paths they use:

```text
.nightworkers/
  sqlite.db
  settings/    # integration settings and compatibility files when used
  logs/        # managed runtime logs
  artifacts/   # persisted attachment files and runtime artifacts when used
```

`DATABASE_URL` is normally generated for `.nightworkers/sqlite.db`; it does not
need to be set for the standard development or desktop flow. Tests use isolated
databases. Application settings are persisted in SQLite; some integration
services retain compatibility files below `settings/`. Desktop builds resolve a
runtime data root and can override it with `NIGHTWORKERS_RUNTIME_DIR`.

Registered Project work remains rooted in the Project repository or its Task
worktree. NightWorkers runtime files are not a substitute for repository
changes, commits, or verification performed in that execution root.

Provider requests can contain the user request, Supervisor instructions,
derived StateCard context, artifact or Task context, and summarized tool
results. Raw LLM traces can therefore contain sensitive repository material.
Read the [Trust Model](./spec/trust-model.md) before connecting production
credentials or a sensitive repository.

The default retention settings are:

| Data | Default retention / limit |
| --- | --- |
| API logs | 7 days |
| Raw LLM traces and parse previews | 3 days |
| Usage data | 30 days |
| Retention audit events | 90 days |
| Managed runtime log directory | 80 MiB total |

Closed log segments can be deleted before their time limit when the configured
capacity limit is reached.

The server is local-only and accepts loopback listen addresses only. NightWorkers
does not maintain product accounts, user profiles, login sessions, or product
OAuth. Credentials for external LLM and integration providers remain separate
local settings and are sent only to those providers.

## Runtime Configuration

Server, provider, routing, integration, and general application settings are
managed from the Settings UI and persisted locally. Environment variables
remain available for bootstrap and explicit runtime overrides.

| Variable | Current role |
| --- | --- |
| `NIGHTWORKERS_RUNTIME_DIR` | Override the managed runtime root. |
| `HOST` / `PORT` | API listen address and port. `HOST` must be loopback; the default bind is `127.0.0.1:39173`. |
| `CONVERSATION_CONTEXT_ENABLED` | Master switch for derived conversation context; enabled by default. |
| `CONVERSATION_CONTEXT_STATE_CARD_ENABLED` | Inject the latest compact StateCard into the runtime request. |
| `CONVERSATION_CONTEXT_BUILD_ON_IDLE` | Refresh derived context after intake and run completion. |
| `NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN` | Disable automatic Queue drain for deterministic maintenance and tests. |
| `NIGHTWORKERS_VULNWORKBENCH_CWD` | Point the optional security integration at a local vulnWorkbench checkout. |

Liveness is exposed at `/api/health/live`, readiness at
`/api/health/ready`, the OpenAPI document at `/api/doc`, and the Swagger UI at
`/api/ui`.

See [Runtime Configuration](./spec/configuration.md) for the broader reference.

## Quick Start

### Requirements

- Bun 1.3.x (CI currently uses Bun 1.3.14)
- Git
- Node.js 20-compatible tooling for the bundled backend/desktop sidecar
- Rust 1.77.2 or newer plus target-OS build dependencies for Tauri packaging

### Browser development

```bash
bun run setup
bun run dev
```

`setup` installs dependencies, creates `.env` only when it does not exist, and
applies migrations. Open:

```text
http://localhost:39174
```

Before using a live provider:

1. Open Settings.
2. Configure and enable a provider endpoint and model.
3. Configure Role Routing.
4. Select the implementation runtime lane.
5. Run the provider smoke test.

### First real workflow

Use a disposable Git repository first.

1. Register its root as a Project Folder.
2. Inspect Overview and the Project Detail tabs.
3. Create a Task with a read-only initial request.
4. Confirm that Mission Pilot is stopped.
5. Press Play and inspect the intervention countdown.
6. Review or edit Questionnaire answers and generated Plan artifacts.
7. Watch Plan review, focused correction, workspace preparation, and Queue
   admission.
8. Inspect Pilot Thought, the Activity Transcript, the assigned worktree, and
   the Run evidence.
9. Do not integrate the change until Test, Review, security, and Git evidence
   agree.

Stopping Mission Pilot is a real lifecycle action. It does not erase already
persisted context, artifacts, or evidence.

## Credential-Free Demo

The deterministic [Support Ops CRM demo](./demo/support-ops-crm/README.md)
creates a disposable Git Project, records Plan and Queue state, applies a fixed
change, runs real tests, and writes Review evidence without provider credentials:

```bash
bun run demo:setup
bun run demo:run
```

Inspect `.nightworkers-demo/evidence/review.json`, then remove generated demo
state:

```bash
bun run demo:reset
```

`bun run demo:smoke` runs the complete setup, execution, assertion, and reset
lifecycle used by CI.

The deterministic demo proves the local state and evidence path. It does not
exercise a live provider or prove that every Mission Pilot branch is healthy.

## Desktop Application

NightWorkers includes a Tauri shell that starts the frontend and manages the
bundled Node backend sidecar.

```bash
bun run desktop:dev
bun run desktop:build
bun run desktop:smoke
```

The current macOS build target is an `.app`; DMG creation is a separate command:

```bash
bun run desktop:build:dmg
```

Linux and Windows bundle commands are defined for native build hosts:

```bash
bun run desktop:build:linux
bun run desktop:build:windows
```

Linux targets `.deb`, `.rpm`, and AppImage. Windows targets x64 NSIS and MSI.
The current limited-beta support target is macOS ARM64; Linux and Windows are
not declared supported until their native installer and clean-environment
launch/shutdown smoke gates pass.
Cross-platform configuration can be checked without producing those native
artifacts:

```bash
bun run desktop:check:cross-platform
```

Signing and notarization require real platform credentials and are not
simulated by the normal build.

## Verification

NightWorkers separates deterministic local gates from optional live-provider
checks.

| Command | Scope |
| --- | --- |
| `bun run verify:base` | Named entry point for the lightweight base gate. |
| `bun run verify` | Lightweight base gate: tracked artifacts, TypeScript, Biome, then Supervisor regressions. |
| `bun run verify:fast` | Alias for the base gate. |
| `bun run verify:e2e` | Credential-free Playwright smoke gate. |
| `bun run verify:audit` | High/Critical dependency policy. |
| `bun run verify:desktop` | Desktop runtime tests, Rust checks, build, sidecar smoke, and packaged-app smoke. |
| `bun run verify:full` | Complete deterministic suite, including tests, E2E/accessibility, demo, audit, and desktop gates. |
| `bun run verify:live` | Explicit external-provider canaries; skipped unless enabled and configured. |
| `bun run verify:release` | Release metadata, deterministic verification, demo, dependency, and desktop release gates. |

Useful focused commands:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:coverage
bun run test:e2e
bun run test:e2e:smoke
bun run test:e2e:agent-outcome
bun run test:e2e:agent-live
bun run check:architecture
bun run check:docs
```

`check:docs` verifies registered document existence, local links and anchors,
documented `bun run` commands, and selected completed-plan archive rules. It does
not prove that prose still matches the implementation; semantic documentation
review is still required.

Live-provider tests are intentionally outside the normal deterministic gates.
`verify:live` only runs them when the corresponding enable flags and credentials
are present.

## Operations and Development Commands

| Command | Purpose |
| --- | --- |
| `bun run build` | Build the frontend and backend bundles. |
| `bun run start` | Start the production backend bundle after `build`. |
| `bun run db:generate` | Generate Drizzle migration files after a schema change. |
| `bun run db:migrate` | Apply Drizzle migrations to the active runtime database. |
| `bun run db:studio` | Open Drizzle Studio. |
| `bun run cleanup:test-data:dry-run` | Preview deletion of local TEST-prefixed data. |
| `bun run cleanup:test-data` | Execute the scoped TEST-data cleanup. |
| `bun run release:check` | Validate package, Tauri, changelog, release-note, tag, and optional manifest metadata. |
| `bun run release:manifest` | Generate artifact checksum and signing/notarization metadata after verification. |
| `bun run release:create` | Run release checks before a dry run or explicit annotated tag creation. |
| `bun run desktop:prepare-sidecar` | Build and stage the packaged backend sidecar. |
| `bun run desktop:smoke-sidecar` | Smoke-test the staged sidecar. |
| `bun run desktop:lint` | Check cross-platform metadata, Rust formatting, and Clippy. |
| `bun run desktop:sign` | Sign and verify a desktop artifact when platform credentials are available. |

## Architecture

| Layer | Current implementation |
| --- | --- |
| API | Hono + TypeScript under `api/` |
| Web UI | React, Vite, and TanStack Router under `src/` |
| Desktop | Tauri shell under `src-tauri/` with a bundled Node backend sidecar |
| Persistence | Drizzle ORM with SQLite/libSQL schemas and migrations |
| Shared contracts | Zod schemas under `shared/schemas/` |
| Runtime evidence | Task, Mission Pilot, Queue, event, Todo, artifact, verification, review, usage, and Git records |
| Repository mutation | Worker-tool boundary operating on a registered Project root or Task worktree |

High-level module families include Mission Pilot, NightWorkers Task/Run
orchestration, Queue, Git worktree, Review, Project Evaluation, Quality, Task
Generation, Plan Mode, Blueprint, Data Model, Overview, Settings, Ontology, MCP,
and Agent Hooks.

See [Architecture and Module Boundaries](./spec/architecture.md) for lower-level
boundaries. When that document and executable contracts disagree, treat the
schemas, route definitions, migrations, and tested service paths as current
runtime truth and update the document.

## Current Limits

- NightWorkers is a local, primarily single-user control plane, not a hosted
  collaboration service.
- It does not create pull requests, deploy applications, publish releases, or
  submit desktop packages automatically.
- Git merge is implemented as an explicit, evidence-backed Review action; it is
  not an unconditional background side effect.
- Parallel Processor work does not mean multiple agents may race in the same
  worktree. Isolation depends on Task workspace ownership and claim gates.
- The queue and local runtime are not a distributed multi-host scheduler.
- Live provider behavior depends on the configured service, credentials, model,
  network, and provider policy.
- MCP authentication secrets are not supported by the current MCP settings
  contract.
- The optional Security Oracle and ontology extension require an eligible and
  separately configured local vulnWorkbench integration.
- contextStill procedures require a configured contextStill MCP server; the
  deterministic product/demo baseline does not require one.
- Estimated cost is incomplete when pricing, usage, or FX data is unavailable.
- A successful final report, successful model response, or existing Queue row
  alone does not prove completion.
- Documentation plans in `spec/.archived/` are historical evidence, not current
  user contracts. The hidden directory is excluded from ordinary LLM file
  discovery and is read only for an explicitly requested historical review.

## Documentation

- [Feature Tour](./spec/feature-tour.md)
- [First Run Orientation](./spec/first-run-orientation.md)
- [Architecture and Module Boundaries](./spec/architecture.md)
- [Runtime Configuration](./spec/configuration.md)
- [Trust Model](./spec/trust-model.md)
- [Adoption Checklist](./spec/adoption-checklist.md)
- [E2E Testing Policy](./spec/e2e-testing-policy.md)
- [S11t Guide for Coding Agents](./spec/s11t-coding-agent-guide.md)
- [Release Notes](./spec/release-notes/0.1.0.md)
- [Changelog](./CHANGELOG.md)
- [Security Policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

Active specifications live under `spec/docs/` or directly under `spec/` when
they are still being worked. Completed implementation plans move to
`spec/.archived/`. Neither location automatically makes a document a current
product guarantee.

## Source-of-Truth Map

These are useful starting points when validating README claims:

| Claim area | Executable source |
| --- | --- |
| Task lifecycle and lazy Mission Pilot activation | `api/modules/nightworkers/nightworkers.basic.service.ts`, `packages/mission-pilot/src/backend/runtime/mission-pilot.service.ts` |
| Mission Pilot state and authorization | `packages/mission-pilot/src/contracts/mission-pilot.schema.ts`, `packages/mission-pilot/src/backend/runtime/mission-pilot-delegation.ts` |
| Mission Pilot SQLite ownership and package-only persistence capability | `api/modules/missionPilot/persistence/`, `api/composition/mission-pilot/mission-pilot-runtime-bindings.ts`, `packages/mission-pilot/src/backend/persistence-port.ts` |
| Plan steps and review progress | `shared/plan-mode-execution.ts`, `packages/mission-pilot/src/contracts/mission-pilot-plan-progress.schema.ts` |
| Queue handoff and claim readiness | `api/modules/taskOperator/`, `api/modules/queue/` |
| Task Git workspace and merge policy | `shared/schemas/git-integration.schema.ts`, `api/modules/gitworktree/`, `api/modules/nightworkers/nightworkers.git-merge.service.ts` |
| Test, Review, and closeout evidence | `api/modules/review/`, `api/modules/taskOperator/`, `api/modules/gitCloseout/` |
| Project Evaluation and Quality | `api/modules/project-evaluation/`, `api/modules/quality/` |
| Overview usage and cost | `shared/schemas/overview.schema.ts`, `api/modules/overview/` |
| Runtime storage paths | `api/runtime/paths.ts` |
| Available commands | `package.json`, `scripts/verify.mjs` |

## Contributing, Security, and License

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change. Report
security issues through [SECURITY.md](./SECURITY.md), not a public issue.

NightWorkers is distributed under the [MIT License](./LICENSE.md).
