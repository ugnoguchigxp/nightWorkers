# Mission Pilot User-Equivalent Recovery Change Ledger

## Baseline

- Recorded at: `2026-07-29 22:54 JST`
- HEAD: `b7b1621a feat: enforce workspace authority and secret boundaries`
- Working tree at M0 start: clean
- Coding Agent tree digest:
  - `b746ed831f5ff1a96988c2da33d1b0d2a5b26b1f88e7f3732f1c39108a9f114f`
  - Source: `git ls-tree -r HEAD api/modules/codingAgent src/modules/codingAgent shared/modules/codingAgent | shasum -a 256`
- Implementation plan:
  - `spec/docs/mission-pilot-user-equivalent-recovery-implementation-plan.md`

## Baseline Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `bun run check:architecture` | passed | 1,346 files checked; module、SystemContext、Coding Agent semantic-control、standalone、Task Operator boundaries passed |
| `bun run typecheck` | passed | native TypeScript check exited 0 |
| Mission Pilot focused regression, 33 files / 186 tests | failed | 31 files passed、2 files failed、183 tests passed、3 failed |
| `tests/mission-pilot-agent-runtime.test.ts` standalone | failed | Task update action did not change title; expected `updated by persistent agent`, received `agent runtime` |
| `tests/mission-pilot-agent-action-idempotency.test.ts` | failed | one expected domain precondition became revision conflict; one message mutation returned failure |

Baseline failures are pre-existing at M0 and are not accepted as final-state exceptions.
They must be resolved by the canonical action / revision work before M2 is marked passed.

## Production Activation Graph

```text
POST /mission-pilot/tasks/:taskId/play
  -> api/modules/missionPilot/mission-pilot.routes.ts
  -> api/modules/missionPilot/mission-pilot.service.ts::play
  -> claimAgentPlay
  -> scheduleMissionPilotAgentWake
  -> mission-pilot-agent-runtime.ts
  -> mission-pilot-task-read.adapter.ts
  -> mission-pilot-task-action.adapter.ts
  -> mission-pilot-action-command-executor.ts
  -> Task Operator public command
```

Mission Pilot does not directly import the Coding Agent module in this path.
The remaining indirect dependencies are recorded below.

## Baseline Violations

| ID | Current path | Violation | Target checkpoint |
| --- | --- | --- | --- |
| V1 | `api/modules/missionPilot/agent/mission-pilot-task-action.registry.ts` | Mission Pilot duplicates 38 action contracts | M2 |
| V2 | `api/modules/taskOperator/policies/task-operator-command-catalog.ts` | Task Operator has 37 IDs; `plan.artifact.regenerate` is absent | M2 |
| V3 | `api/modules/missionPilot/agent/mission-pilot-task-action-unavailable.ts` | Questionnaire submit comment and empty unavailable map conflict | M2 |
| V4 | `api/modules/missionPilot/agent/mission-pilot-action-execution.repository.ts` | scans Run / Queue tables and parses `coding_agent.requested` | M4 |
| V5 | `api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter.ts` | reads Run、commit、action tables directly | M4 |
| V6 | `api/modules/missionPilot/agent/mission-pilot-conversation-query.repository.ts` | reads active Run / Queue tables to derive phase | M4 / M5 |
| V7 | `api/modules/missionPilot/mission-pilot.service.ts` | Run listener has unreachable terminal branches | M5 |
| V8 | `api/modules/missionPilot/agent/mission-pilot-conversation-query.repository.ts` | turn finish does not consistently version and publish Control Summary | M5 |
| V9 | `api/modules/queue/queue-repository-command.types.ts` | Queue imports Mission Pilot provenance type | M4 |
| V10 | `api/modules/taskOperator/application/task-operator.command.ts` | Task Operator emits `missionPilotAction` / `missionPilotActionKey` metadata | M4 |
| V11 | `api/modules/missionPilot/mission-pilot-plan-intake.service.ts` | dynamically imports legacy plan coordinator | M6 |
| V12 | `tests/live/mission-pilot-plan-pipeline-live.test.ts` | live test calls legacy coordinator and authorization V2 | M6 / M7 |
| V13 | Mission Pilot Task Operator contexts | use synthetic automation identity without structural user delegation | M3 |

## Resolution Summary

| ID | Resolution |
| --- | --- |
| V1 / V2 | Task Operatorのcanonical action registryを正本にし、Mission Pilot registryはそこから導出するよう変更した。 |
| V3 | `questionnaire.submit`をMission Pilot unavailable actionとして固定し、draft / intervention pathへ統一した。 |
| V4 / V5 / V6 | Mission PilotのRun / Queue正本scan、Coding Agent event本文parse、直接outcome queryを削除し、Task Operator receipt / resourceへ統一した。 |
| V7 / V8 | lifecycle listener、Control Summary version、transaction後realtime publishを一つのpersistent runtime経路へ整理した。 |
| V9 / V10 | Queue / Task OperatorからMission Pilot固有provenance fieldを除去し、role非依存command context / receiptへ置換した。 |
| V11 / V12 | 旧coordinatorと旧live testを削除し、公開Playとpersistent runtimeを通すlive canaryへ置換した。 |
| V13 | authorization V4へsubject user、delegation ref、capability digestを保存し、各commandでcurrent user capabilityとの積集合を検証するよう変更した。 |

## Additional Findings Resolved During E2E

| ID | Finding | Resolution |
| --- | --- | --- |
| E1 | provider tool fixtureの`implementation` scopeが未登録の場合、Mission Pilot用`default` scopeへfallbackしていた | scopeを完全一致にし、異なるroleのfixture turnを消費しないcontract testを追加 |
| E2 | Bun `bun:sqlite`の同期readとlibSQLの非同期writeが同一DBで競合し、Mission Pilot action receipt書込みがlockした | sync SQLite adapterをlibSQLへ統一 |
| E3 | Questionnaire draft取得直後のcanonical refreshが、未確定の回答案を空へ戻した | Mission Pilot frontend projectionをrole moduleへ置き、draft refをstate更新と同時に更新 |
| E4 | Task Goal表示が内部activation JSONへ依存していた | canonical Task objectiveのread-only projectionへ変更 |
| E5 | Mission Pilot thought read modelからactivity eventが欠落した | Agent非依存Task activity queryを追加し、Mission Pilot側でowner / channelを限定して投影 |
| E6 | 共通worker / Nightworkers consumerのCoding Agent public index静的importがruntime indexを循環初期化した | Coding Agent側を変更せず、consumer側のpublic API利用を必要時の遅延loadへ変更 |

## Legacy Runtime Consumers

`runMissionPilotPlanPipeline` has the following direct consumers at M0:

- `api/modules/missionPilot/mission-pilot-plan-intake.service.ts`
- `tests/live/mission-pilot-plan-pipeline-live.test.ts`
- self-retry inside `mission-pilot-plan-coordinator.service.ts`

The persistent runtime production entrypoints do not import the legacy coordinator directly.
The dynamic import in plan intake remains a production-reachable risk until M6.

## Change Ownership

| Path family | Ownership in this implementation |
| --- | --- |
| `api/modules/missionPilot/**` | task-owned |
| `api/modules/taskOperator/**` | task-owned only for role-neutral Task Operator contract |
| `api/modules/queue/**` | task-owned only for removal of Mission Pilot-specific coupling |
| `api/modules/agentsShare/**` | task-owned only for role-neutral event / receipt contracts |
| `shared/modules/missionPilot/**` | task-owned for Mission Pilot delegation / public schema |
| `shared/modules/taskOperator/**` | task-owned for role-neutral Task Operator schema |
| `api/modules/codingAgent/**` | read-only; never modify |
| `src/modules/codingAgent/**` | read-only; never modify |
| `shared/modules/codingAgent/**` | read-only; never modify |

## Checkpoint Ledger

| Checkpoint | Status | Verification | Notes |
| --- | --- | --- | --- |
| M0 Baseline / ledger | passed | baseline commands above | Existing three test failures recorded; Coding Agent digest fixed |
| M1 Boundary guardrails | passed | `check:architecture`、user-equivalent boundary | role import、canonical table read、forbidden toolを検査 |
| M2 Canonical action contract | passed | action catalog / Task Operator / fixture catalog tests | baseline 3 failuresも解消 |
| M3 Delegated user authorization | passed | delegated authorization tests、live permission revoke | authorization V4 |
| M4 Run receipt / outcome boundary | passed | Task Operator contract / regressions、repair E2E | receipt refだけで復旧 |
| M5 Runtime lifecycle / realtime | passed | runtime、completion、trace、E2E | publish / finish / waitを検証 |
| M6 Legacy isolation | passed | ownership firewall、source / activation tests | legacy production pathを削除 |
| M7 Integration / live | passed | E2E 7/7、Codex live 1/1 | production persistent loopを通過 |
| M8 Cleanup / canary | passed | `verify:base`、Coding Agent 131/131 | isolated canary。production deployは対象外 |

## Final Verification Evidence

| Command / suite | Result |
| --- | --- |
| `bun run check:architecture` | passed。module、SystemContext、Coding Agent standalone、Task Operator境界を検証 |
| `bun run typecheck` | passed |
| `bun run lint` | passed。1,754 files |
| Mission Pilot / Task Operator focused suite | 31 files passed、157 passed、1 skipped |
| Coding Agent regression suite | 20 files passed、131 passed |
| Mission Pilot deterministic Playwright | 7 passed |
| `bun run verify:base` | passed |
| persistent Mission Pilot real Codex provider | 1 passed、約55秒 |

## Coding Agent Untouched Result

次のproduction pathは、M0のHEADに対してtracked / untracked差分とも0件である。

```text
api/modules/codingAgent/**
src/modules/codingAgent/**
shared/modules/codingAgent/**
```

M0で記録したCoding Agent tree digestは変更されていない。

## Post-Implementation Code Review

実装完了後に、Mission Pilotを「ユーザーの代替作業者」に限定する観点で
production pathを再読し、次の追加問題を修正した。

| ID | Review finding | Resolution |
| --- | --- | --- |
| R1 | Task Operatorのdirect principalがcurrent user capabilityを読まず、全capabilityを得られた | direct / delegatedの両方でcurrent user capabilityを正本として読み、delegation時だけ委任capabilityとの積集合にした |
| R2 | action argumentsにも`expectedTaskRevision`が入り、command envelopeのrevisionと二重管理されていた | revisionをcommand envelopeだけへ集約し、action schemaを操作固有argumentだけにした |
| R3 | generic `execute_task_action`とaction別legacy tool名が併存していた | provider公開APIをread 4種、generic execute 1種、agent control 2種の計7 toolへ固定した |
| R4 | receipt readが`actorKind`を条件に含めず、同じactor IDの別principalと衝突し得た | receipt lookupをDB unique keyと同じ`actorKind + actorId + idempotencyKey`にした |
| R5 | failure復旧がerror messageのkeyword判定に依存していた | Task Operator failureのkind、retryable、revision、HTTP情報を構造化保存し、その値だけで復旧判断するよう変更した |
| R6 | event claim後にcurrent-step contextがunread eventを再読するため、trigger eventが空になる競合があった | claim結果へtrigger event rangeを保持してcontextへ渡し、retry attemptもevent payloadから構造的に復元した |
| R7 | bounded Task本文とtimeline本文だけで最終判断でき、切り詰められた正本を回収できなかった | `task_text` / `task_message` resourceとpagingを追加し、Play時のTask Goalも完全な正本を取得するよう変更した |
| R8 | Run outcomeがstatus中心で、Mission Pilotがverification、blocker、変更pathを再評価できなかった | Task Operatorのbounded `run_outcome`へ結果、検証、blocker、変更path、commit / artifact refを追加した |
| R9 | Questionnaire draft取得・poll・直列保存がPlanMode componentへ残っていた | Mission Pilot frontend hookへ移し、PlanModeはMission Pilot public APIだけを利用する構造にした |
| R10 | Mission Pilot traceとTask message event busがNightworkers内部へ置かれていた | role固有traceをMission Pilotへ、role非依存message eventをTask moduleへ移した |
| R11 | Questionnaire submitだけ回答配列のitem schemaが未指定だった | draftと同じcanonical answer schemaをTask Operator registryで再利用した |
| R12 | runtime、Task Operator command、PlanMode viewerが600行上限を超えた | failure変換、active Run policy、settings / Mission Pilot draft hookへ責務分割し、全fileを上限内へ戻した |
| R13 | generic execute toolが必須のTask revisionをnullableな`expectedResourceRevision`として公開し、fixtureだけ旧二重形式を模倣していた | `expectedTaskRevision: integer`へ統一し、resource kindもTask Operator正本のenumから公開した。旧conversationのread互換だけを維持した |

### Review Verification

| Command / suite | Result |
| --- | --- |
| `bun run verify:base` | passed。tracked artifact、architecture、S11t fixture、typecheck、lint、supervisor regressionを含む |
| 全Vitest初回 | 352 files passed、1 fileのMission Pilot SystemContext固定hashだけ不一致、2,206 tests passed、1 skipped |
| `tests/s11t-system-context.test.ts`（Mission Pilot hash更新後） | 14 passed。Coding Agent hashは不変 |
| 全Vitest再実行（hash更新後） | 353 files、2,207 passed、1 skipped |
| Mission Pilot deterministic Playwright | 7 passed |
| generic tool / Task Operator focused regression（最終API更新後） | 7 files、51 passed |
| persistent Mission Pilot real Codex provider（最終API更新後） | 1 passed、約54秒 |
| Coding Agent production diff | 0 files |

固定hashの更新は、`task_text` / `task_message`の完全取得を要求する日本語
SystemContext本文を照合した上でMission Pilotの2値だけを更新した。
Coding AgentのSystemContext本文とhashは変更していない。
