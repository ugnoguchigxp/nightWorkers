# First Run Orientation

This walkthrough assumes you are trying NightWorkers against an existing local
repository. It does not require a sample Project Folder, fixed demo seed data,
or a provider-backed demo transcript.

## 1. Install and Start
```bash
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

Open `http://localhost:39174`.

## 2. Register Project Folder
Register a local repository that you are comfortable using for investigation.
For a first run, prefer a throwaway repository or a repository where all changes
can be reviewed before commit.

The Project Folder is the repo root that worker tools use for file and command
activity. It is not the NightWorkers checkout unless you intentionally register
this repository as the target project.

## 3. Create Session
Create or select a Workbench Session under the Project Folder. A Session is the
chat-first workspace for intake, planning, Blueprint generation, direct coding
requests, and run review.

## 4. Send a Workbench Message
Start with a read-only investigation request:

```text
Inspect the repository structure and summarize the available test commands. Do
not edit files.
```

This keeps the first experience focused on evidence and routing before asking
NightWorkers to change code.

## 5. Confirm Chat-Only vs Execution Run
A Workbench message may stay as normal chat/intake or start an execution run.
The distinction matters:

- Chat-only/intake messages update the conversation and may produce planning or
  Blueprint artifacts.
- Execution runs create task events, tool outcomes, todos, diffs, test results,
  and final reports.
- Implementation Queue entries are explicit user-approved automation items and
  are separate from normal Session chat.

If you expected a run but only see chat activity, check whether the Session has
an implementation-ready plan and whether you admitted it into the Queue or made
a direct execution request.

## 6. Inspect Run Timeline
When a run starts, inspect the timeline for:
- State changes.
- Tool calls and policy blocks.
- Todo updates.
- Diff/test/final-report events.
- LLM usage events when provider calls are made.

The timeline is persisted in SQLite and can be replayed after reconnect.

## 7. Inspect Artifact Pane
Open the Artifact Pane when artifacts exist. Depending on the Session, it can
show:
- Project tree and source previews.
- Diff artifacts.
- App Blueprint artifacts.
- Blueprint Preview, DB Design revisions, and Design Token adoption state.

If the pane is empty, the Session may not have produced an artifact yet.

## 8. Check LLM Usage and Settings
Open Settings before connecting real credentials. Confirm:
- Selected provider and model.
- Smoke-test result.
- Masked secret behavior.
- MCP servers are OFF unless you intentionally enable them.
- Agent Hooks are empty or disabled unless you intentionally configure them.
- TODO Workflow gates match how much review you want before completion.

## 9. Stop, Retry, or Review
Use the Workbench and Queue state to decide what happens next:
- Leave the Session in chat if you only needed investigation.
- Queue implementation only after you trust the plan.
- Review diffs and final reports before committing changes.
- Retry only after you understand the failed event or tool output.

## 10. Where to Look When Nothing Happens
- Overview: broad workspace status, warnings, queue state, and usage summary.
- Project Sidebar: Project Folder and Session selection.
- Workbench Timeline: chat messages, intake output, execution events, and
  artifacts.
- Implementation Queue: queued work, Processor lanes, and queue controls.
- Settings: provider, MCP, hooks, and TODO Workflow configuration.
- Logs: development logs under `logs`; desktop logs under the app data runtime
  `logs` directory.
- Startup diagnostics: `GET /api/settings/preflight/startup`.

For security and local execution boundaries, read
[Trust Model](./trust-model.md).
