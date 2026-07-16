# Mission Pilot Autonomous Agent Hardening Execution Log

## Luna Handoff 2026-07-16 11:58 JST

- Plan: `spec/docs/mission-pilot-autonomous-agent-hardening-plan.md`
- Baseline commit: `4309d798` plus the pre-existing working tree listed below
- Worktree policy: pre-existing changes are preserved; only task-owned hunks will be staged if commits are requested later.
- Baseline Mission Pilot tests: `node scripts/run-vitest.mjs run tests/mission-pilot-*.test.ts tests/pilot-thought-dock.test.tsx` — 25 files, 141 tests passed.
- Baseline typecheck: `node node_modules/@typescript/native/bin/tsc --noEmit --singleThreaded` — passed.
- Baseline semantic-control check: `node scripts/check-coding-agent-semantic-control.mjs` — passed.
- Baseline failures: none in the commands above.
- Database migrations added: none yet.

### Pre-existing working-tree changes

- `AGENTS.md`
- `api/modules/missionPilot/agent/mission-pilot-agent-session.repository.ts`
- `api/modules/missionPilot/agent/mission-pilot-task-event.repository.ts`
- `api/modules/missionPilot/mission-pilot-questionnaire-projection.ts`
- `api/modules/missionPilot/mission-pilot-questionnaire.service.ts`
- `api/modules/missionPilot/mission-pilot.service.ts`
- `api/modules/nightworkers/nightworkers.workbench-message.service.ts`
- `api/services/agent-runtime/e2e-fixture-runtime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `spec/docs/mission-pilot-persistent-agent-refactor-plan.md`
- `tests/mission-pilot-agent-questionnaire.test.ts`
- `tests/nightworkers-workbench-routes/routes-workbench-04.test.ts`
- `tests/universal-task-creation.test.ts`
- `api/modules/missionPilot/agent/mission-pilot-agent-active-registry.ts` (untracked)
- `api/modules/nightworkers/nightworkers.task-message-events.ts` (untracked)
- `spec/docs/mission-pilot-autonomous-agent-hardening-plan.md` (untracked)

## Checkpoint ledger

| Checkpoint | Status | Commit | Verification | Notes |
| --- | --- | --- | --- | --- |
| H0 | passed | — | Baseline commands above | Existing working tree retained; fail-first characterization follows per work package. |
| H1 | passed | working tree | ownership firewall unit/regression suite | Agent session DB row is the common ownership source and legacy recovery entry points skip it. |
| H2 | passed | working tree | `mission-pilot-agent-run-provenance`, Task status sovereignty tests | Implementation, Test, Review, and Queue Run paths carry the same Agent provenance; terminal Task state and newer active Runs are protected by CAS. |
| H3 | passed | working tree | action idempotency crash/reconcile tests | Equivalent mutations share a receipt; Run, Queue, Task message, Questionnaire, Task state, and Git resources are reconciled after interruption. |
| H4 | passed | working tree | Agent runtime/hardening contract tests | Current-step context and action registry are rebuilt before each provider decision. |
| H5 | passed | working tree | completion/hardening/E2E tests | Visible assistant/wait/finish projection and explicit finish gate are active. |
| H6 | passed | working tree | provider retry + Questionnaire failure tests | Retry is persisted as a future event and resumed by a later wake; Stop consumes retry events; async Questionnaire failure remains Agent-owned. |
| H7 | passed | working tree | repeated-repair E2E | Two distinct failed attempts are read before a third successful repair; no fixed repair-count branch exists in production. |
| H8 | passed | working tree | completion race/user interruption tests | Explicit Task completion/archive and visible user wait contracts are preserved. |
| H9 | passed | working tree | 31 files/170 tests; 9 combined Mission Pilot E2Es; `verify:base`; architecture; docs | Autonomous, repeated repair, runtime reconstruction, user interruption, Questionnaire regression, and existing Mission Pilot gates pass. |
| H10 | pending | — | — | Observation window required after release gate. |

## Hardening completion verification 2026-07-16

- Mission Pilot regression: 31 files, 170 tests passed.
- Combined Mission Pilot E2E: 9 scenarios passed, including autopilot, Questionnaire submission failure, pre-queue handoff, archive flow, trace separation, repeated repair, expired-runtime reconstruction, and user interruption.
- A1: autopilot E2E passed.
- A2: shared provenance contract for Implementation/Test/Review/Queue passed; existing procedural transition regression tests remained green.
- A3/A4: repeated repair E2E created two failed Runs with distinct repair requests before successful completion.
- A5: Questionnaire submission failure stayed `playing` and preserved the failure body in `questionnaire.submission_failed`.
- A6: visible user question/wait/resume E2E passed.
- A7: crash-after-message-mutation reconciliation produced one resource and one canonical succeeded receipt; equivalent retry reused the receipt.
- A8: provider fallback, persisted retry event, third-attempt cap, and Stop cancellation passed.
- A9: E2E expired a synthetic in-flight runtime lease, ran startup reconciliation, resumed the same conversation, and completed without legacy phase work.
- A10: delayed terminal callbacks preserved explicit `completed` state and did not overwrite a newer active Run.
- A production bootstrap ordering defect found during Questionnaire E2E was fixed: `mission_pilot_action_key` is now ensured after the raw `design_questionnaire_sessions` table creation, so fresh databases and existing databases follow the same initialization path.
- The task-action unavailable metadata and review input contracts were extracted from oversized implementation files; `bun run check:architecture` passes with the resulting source-size and module-boundary limits.
- `bun run verify:base` passed: tracked-artifact check, architecture, typecheck, lint, and supervisor regression all passed.
- `bun run check:docs`, `node scripts/check-coding-agent-semantic-control.mjs`, and `git diff --check` passed.
- H10 remains intentionally deferred: the plan requires an observation window after the release gate and explicitly prohibits running that checkpoint on the same night.
- No commit was created by this implementation pass; checkpoint rows refer to the current working tree.

## Review remediation 2026-07-16

- Codex Mission Pilot tool turns now use a temporary isolated `CODEX_HOME`, copying only `auth.json` with mode `0600`. This prevents user MCP/plugin configuration from entering the Mission Pilot decision lane; the ineffective `features.mcp=false` assumption was removed.
- `questionnaire.submit` is unavailable to the Mission Pilot agent. Draft save starts the existing 20-second intervention UI, and submission remains on the timeout/user/resume application path.
- Exceptions after a mutation receipt is claimed are persisted as `outcome_unknown`, preventing an unverified retry from duplicating a possibly completed side effect.
- Immediate and future wake scheduling use per-session generation guards. Stop invalidates DB lookups and timer callbacks already in flight and consumes persisted provider-retry events.
- Stale Run recovery applies Mission Pilot Task-status projection only to Agent-owned sessions; normal Task recovery retains the pre-existing direct status update.
- Focused regression: 6 files, 39 tests passed.
- Full regression: 316 files, 1,959 tests passed.
- `bun run typecheck`, `bun run lint`, `bun run check:architecture`, and `git diff --check` passed.
- Development server ports remained closed during review.
