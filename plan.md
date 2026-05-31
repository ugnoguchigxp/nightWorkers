# NightWorkers Project Plan

## Concept

NightWorkers is a local-first autonomous development control plane for personal software work. The project goal is to evolve toward a personal Devin/Manus-style system without absorbing or forking OpenHands at the start. OpenHands remains an external execution engine. NightWorkers owns the layer around it: task intake, planning boundaries, execution supervision, retry policy, completion checks, memory handoff, and human review gates.

The core promise is simple: a developer can hand NightWorkers a scoped task before stepping away, and NightWorkers will keep moving the task forward through an OpenHands session, collect evidence, decide whether it is done, and return with a diff, logs, test results, and a clear status. It should work while the developer sleeps, but it must stay auditable, interruptible, and bounded.

NightWorkers is not intended to be another coding agent implementation. It is an agent operations layer. It should be able to run OpenHands first, then later support other runners such as Codex CLI, OpenCode, SWE-agent, or custom local tools through the same runner interface.

## Product Positioning

NightWorkers should sit between three systems:

- The user, who provides goals, constraints, repositories, credentials, and review decisions.
- OpenHands, which performs sandboxed coding work.
- contextStill, which provides durable project memory, task-specific context, and post-task learning.

This keeps responsibilities clean. OpenHands executes. contextStill remembers. NightWorkers coordinates.

The project should be described as:

> NightWorkers is a local-first agent control plane that runs development tasks through external coding agents, injects durable project memory, supervises progress, and produces reviewable outcomes.

## Why Not Fork OpenHands First

OpenHands already handles a difficult part of the problem: sandboxed autonomous coding. Forking it immediately would create ongoing cost around upstream changes, runtime security, model provider updates, UI changes, and sandbox behavior.

NightWorkers should avoid depending on OpenHands internals until there is a proven need. The first version should integrate with OpenHands from the outside through process execution, headless mode, SDK/API surfaces, configuration, plugins, hooks, and MCP where available.

Forking or deeper OpenHands customization can remain a later option if one of these becomes necessary:

- NightWorkers needs to alter the OpenHands agent loop itself.
- Completion policy cannot be enforced outside the runner.
- OpenHands plugin or SDK surfaces cannot expose required execution events.
- The UI needs deep session controls that cannot be built externally.
- Security or sandbox lifecycle requirements cannot be satisfied through supported interfaces.

Until then, NightWorkers should treat OpenHands as a replaceable runner backend.

## Relationship With OpenHands

OpenHands should be integrated as an external runner. NightWorkers should start by launching and supervising OpenHands sessions rather than embedding its internals.

The OpenHands adapter should eventually support:

- Creating a session for a repository and task.
- Passing a task prompt enriched with contextStill context.
- Supplying working-directory, branch, budget, timeout, and sandbox configuration.
- Streaming logs and notable events back into NightWorkers.
- Detecting terminal states such as completed, failed, blocked, timed out, or needs-human.
- Collecting diffs, changed files, command outputs, test results, and summary text.

OpenHands plugins should be used where they help, but the plugin should remain thin. A plugin can provide skills, commands, hooks, and MCP configuration that make OpenHands better behaved inside a NightWorkers-managed session. It should not become the state manager for the whole product.

## Relationship With contextStill

contextStill is the durable memory and context layer. NightWorkers should use it through MCP rather than importing its code.

Before execution, NightWorkers should call contextStill to compile task-specific context. That context should be transformed into a concise runner prompt, along with repository-specific constraints and completion criteria.

During execution, NightWorkers can record notable findings, blocked states, and checkpoints into contextStill when they are useful beyond a single run.

After execution, NightWorkers should evaluate whether the compiled context helped and register reusable lessons. This closes the loop:

```text
task -> context_compile -> runner execution -> result evaluation -> reusable memory
```

The initial contextStill integration should focus on:

- `context_compile` before each task.
- `compile_eval` after each task.
- `register_candidate` or `register_candidates` for reusable lessons.
- Goal Room / vibe memory for long-running tasks, decisions, and unresolved loops.

## Technical Stack

NightWorkers should be TypeScript-first.

The starting point is the existing `hono-standard` template. It gives the project a practical full-stack base:

- Hono API server.
- React frontend.
- TanStack Router and Query.
- Drizzle-based data layer.
- Biome formatting and linting.
- pnpm workspace layout.
- Existing test and build scripts.

This fits NightWorkers because most of its core responsibilities are application-layer orchestration rather than low-level agent execution.

Recommended initial stack:

- Runtime: Node.js / pnpm from `hono-standard`.
- Backend: TypeScript + Hono.
- Frontend: React + TanStack Router.
- Validation: Zod.
- Database: start with the template data layer; prefer SQLite for local-first MVP if migration cost is acceptable, otherwise keep Postgres first and add SQLite later.
- Formatting/linting: Biome.
- Runner integration: process/SDK adapters.
- Memory integration: MCP client for contextStill.
- License: MIT.

Rust should not be the initial core language. It can be introduced later for a local supervisor, process isolation, log streaming, patch handling, or runner daemon if TypeScript becomes insufficient.

Python should stay at the OpenHands boundary. NightWorkers should not become a Python application only because OpenHands is implemented in Python.

## Core Responsibilities

NightWorkers should own these responsibilities:

- Task intake: receive tasks from UI, CLI, GitHub issues, or local files.
- Task normalization: turn vague input into scoped execution instructions.
- Context injection: fetch and compress relevant context from contextStill.
- Runner selection: choose OpenHands initially, with a future interface for other runners.
- Execution supervision: start, monitor, pause, resume, retry, and stop sessions.
- Completion policy: decide whether the task is complete, blocked, failed, or needs review.
- Evidence collection: store diffs, logs, test output, changed files, and summaries.
- Human review gates: require user approval for risky actions and final merge-like steps.
- Learning loop: push useful outcomes and lessons back to contextStill.

NightWorkers should not own these responsibilities in the first phase:

- Reimplementing the OpenHands agent loop.
- Building a full sandbox system from scratch.
- Replacing contextStill memory or knowledge distillation.
- Automatically merging or deploying changes without explicit policy.
- Running unbounded autonomous work without budget, timeout, or stop conditions.

## Execution Model

Each task should move through an explicit lifecycle:

```text
draft
  -> ready
  -> compiling_context
  -> running
  -> verifying
  -> needs_review
  -> completed
```

Failure and interruption states should be first-class:

```text
blocked
failed
timed_out
cancelled
needs_human
```

Every run should have a durable event log. The event log should be useful for replay, debugging, and learning extraction. A run should never disappear into an opaque agent session.

## MVP Scope

The first useful version should be intentionally small:

1. Create a task in NightWorkers.
2. Select a local repository.
3. Fetch context from contextStill.
4. Generate an OpenHands prompt.
5. Start an OpenHands session through an external runner adapter.
6. Capture logs and terminal status.
7. Collect changed files and test/build results.
8. Mark the task as completed, failed, blocked, or needs review.
9. Save a post-run summary.
10. Send evaluation and reusable lessons back to contextStill.

The MVP does not need multi-agent scheduling, cloud hosting, browser automation, complex GitHub automation, or deep OpenHands UI integration.

## OpenHands Plugin Strategy

NightWorkers can provide an optional OpenHands plugin package, but the plugin should be an integration helper rather than the product core.

The plugin may include:

- Skills that tell OpenHands how to work inside a NightWorkers-managed task.
- Hooks that report key events back to NightWorkers.
- MCP configuration for contextStill.
- Slash commands for summarizing progress or registering lessons.
- Prompt conventions for completion reports.

The plugin should avoid:

- Owning the task state machine.
- Owning retries and budgets.
- Storing durable task state.
- Assuming OpenHands is the only runner NightWorkers will ever support.

## Safety Model

NightWorkers must be conservative by default. Autonomous development systems fail in expensive ways when they lack boundaries.

Initial safety controls should include:

- Per-task budget and timeout.
- Explicit repository allowlist.
- Command policy and destructive action detection.
- Secret redaction in logs.
- Network policy notes, even if enforcement starts manually.
- Human approval before PR creation, merge, deploy, or external side effects.
- Clear stopped and blocked states.

The product should prefer "needs review" over pretending a task is complete.

## Differentiation

NightWorkers should not compete by being another chat-based coding assistant. Its differentiation should be:

- Local-first operation.
- Durable memory through contextStill.
- Runner-agnostic execution control.
- Reviewable, replayable task histories.
- Clear budget, timeout, and stop policies.
- Personal automation rather than enterprise SaaS positioning.
- Learning from completed work and failed work.

This gives the project a different shape from OpenHands itself. OpenHands is an execution engine. NightWorkers is the long-running task operations layer around execution engines.

## Early Milestones

### Milestone 1: Project Skeleton

- Rename template metadata to NightWorkers.
- Keep Hono API and React UI running.
- Add a basic task model.
- Add a local task list page.
- Add a simple task detail page with lifecycle status.

### Milestone 2: contextStill Adapter

- Add configuration for contextStill MCP connection.
- Implement a context compile call for a task.
- Store the compiled context with the task run.
- Add post-run compile evaluation shape.

### Milestone 3: OpenHands Runner Adapter

- Add a runner interface.
- Implement an OpenHands process adapter.
- Generate a prompt from task, repository, constraints, and contextStill output.
- Capture logs and exit status.

### Milestone 4: Reviewable Output

- Collect changed files and diffs.
- Capture test and build command results.
- Add a run summary view.
- Add completion states and human review actions.

### Milestone 5: Learning Loop

- Register reusable lessons from successful or failed runs.
- Write decisions and blocked states to contextStill Goal Room memory.
- Add simple evaluation prompts for whether context helped.

### Milestone 6: Optional Plugin

- Create an OpenHands plugin for NightWorkers conventions.
- Add hooks for progress reporting.
- Add skills for completion report formatting and contextStill-aware work.

## Guiding Principle

NightWorkers should make autonomous development boring and inspectable. The system can run while the user is away, but every decision, file change, command, failure, and learned lesson should be visible when the user returns.
