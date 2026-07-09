# First Run Orientation

This walkthrough assumes you are trying NightWorkers against an existing local
repository. It does not require a sample Project Folder, fixed demo seed data,
or a provider-backed demo transcript.

## 1. Install and Start
```bash
bun run setup
bun run dev
```

Open `http://localhost:39174`.

Expected result:
- The Overview route loads.
- The local SQLite database has been migrated and seeded.
- Settings, Project Folder registration, and Workbench navigation are available.

If setup fails, check the failing phase first: dependency install, `.env`
creation, migration, seed, API startup, or Vite startup.

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

This first request should prove three things before you trust write automation:
- NightWorkers is using the Project Folder you intended.
- The Workbench can separate normal chat/intake from execution runs.
- Any execution evidence is visible in the timeline instead of disappearing into
  a transient chat response.

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

For a successful first execution run, you should be able to answer:
- Which Project Folder and Session were used?
- Which tools were called?
- Were any commands blocked by policy?
- Was a diff created?
- Which verification command or test result was recorded?
- What did the final report conclude?

## 7. Inspect Artifact Pane
Open the Artifact Pane when artifacts exist. Depending on the Session, it can
show:
- Project tree and source previews.
- Diff artifacts.
- App Blueprint artifacts.
- Plan Mode Workspace artifacts, including Feature Plan, Blueprint, Data Model,
  and additional dedicated design views.

If the pane is empty, the Session may not have produced an artifact yet.

## 8. Check LLM Usage and Settings
Open Settings before connecting real credentials. Confirm:
- Selected provider and model.
- Smoke-test result.
- Masked secret behavior.
- MCP servers are OFF unless you intentionally enable them.
- Agent Hooks are empty or disabled unless you intentionally configure them.

## 9. Stop, Retry, or Review
Use the Workbench and Queue state to decide what happens next:
- Leave the Session in chat if you only needed investigation.
- Queue implementation only after you trust the plan.
- Review diffs and final reports before committing changes.
- Retry only after you understand the failed event or tool output.

Do not treat a run as adoption-ready just because the final response sounds
confident. Adoption should be based on the recorded diff, verification evidence,
and final report together.

## 10. Where to Look When Nothing Happens
- Overview: broad workspace status, warnings, queue state, and usage summary.
- Project Sidebar: Project Folder and Session selection.
- Workbench Timeline: chat messages, intake output, execution events, and
  artifacts.
- Implementation Queue: queued work, Processor lanes, and queue controls.
- Settings: provider, MCP, hooks, and appearance configuration.
- Logs: development logs under `logs`; desktop logs under the app data runtime
  `logs` directory.
- Startup diagnostics: `GET /api/settings/preflight/startup`.

For security and local execution boundaries, read
[Trust Model](./trust-model.md).

For a broader adoption view, read:
- [Feature Tour](./feature-tour.md)
- [Adoption Checklist](./adoption-checklist.md)
