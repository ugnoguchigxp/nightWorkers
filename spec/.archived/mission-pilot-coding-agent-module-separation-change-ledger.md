# Mission Pilot / Coding Agent 分離 Change Ledger

実装開始時点の既存差分を保持するためのC0台帳。既存差分は本計画の実装開始前から存在していたため、実装対象ではなく保全対象として扱う。

| current path / group | current consumers | classification | target public API | target path | checkpoint | pre-existing dirty change | replacement test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `api/modules/missionPilot/**` | Mission Pilot route、session、agent runtime | missionPilot | `api/modules/missionPilot/index.ts` | 同module内のpublic index配下 | C5-C8 | あり | Mission Pilot action / event tests |
| `api/modules/planMode/**` | NightWorkers、Mission Pilot、Plan UI、Coding Agent continuation | split then delete | Mission Pilot planning API、neutral Questionnaire/Artifact command | `api/modules/missionPilot/planning` と既存中立module | C6-C8 | あり | `mission-pilot-plan-ownership` |
| `api/services/coding-agent-context/**` | Coding Agent runtime、run orchestration、MCP | codingAgent | Coding Agent context public API | `api/modules/codingAgent/context` | C3 | あり | Coding Agent context packet tests |
| `api/modules/codingAgent/runtime/**` | run orchestration、Review、provider transport | mixed | Coding Agent runtime public API、neutral outcome/session contract | `api/modules/codingAgent/runtime` と既存generic service | C3/C7 | あり | runtime / boundary tests |
| `api/services/worker-tools/**` | Coding Agent、Review、GitWorktree、MCP | mixed | Coding Agent catalog とgeneric tool library | `api/modules/codingAgent/tools` と既存generic service | C4/C8 | あり | tool registry tests |
| `api/services/structured-generation/prompts/mission-pilot-*` | Mission Pilot runtime、Questionnaire | missionPilot | Mission Pilot prompt API | `api/modules/missionPilot/prompts` | C6/C9 | あり | prompt contract tests |
| `api/modules/questionnaire/**` | UI、route、Task application、Mission Pilot | neutral domain + missionPilot autonomy | 中立Questionnaire command/query、Mission Pilot action adapter | 既存module + `missionPilot/questionnaire` | C5-C8 | あり | Questionnaire event tests |
| `api/modules/specification/**` | UI、artifact generators、Mission Pilot | neutral domain + missionPilot planning | 中立Artifact command/query、Mission Pilot selection | 既存module + `missionPilot/artifacts` | C5-C8 | あり | artifact ownership tests |
| `src/modules/missionPilot/**` | Mission Pilot UI | missionPilot | Mission Pilot public UI API | 同module | C10 | あり | Pilot UI tests |
| `src/modules/nightworkers/**` | Task shell composition | neutral composition | role public index only | `src/modules/agentsShare` を介したcomposition | C10 | あり | workspace boundary tests |
| `tests/**` | 契約・回帰検証 | test-only | replacement contract tests | `tests/` | 全checkpoint | あり | baseline and final matrix |
| `.agent-ontology/boundary-policy.json`, `scripts/check-module-boundaries.mjs` | architecture check | guardrail | public module roots / dependency check | 同path | C1/C11 | あり | `role-module-boundary` |

## C0 evidence

- Baseline: `node scripts/run-vitest.mjs run ...`（8 files / 35 tests passed）
- Boundary: `node scripts/check-module-boundaries.mjs`（1139 files checked）
- 作業開始時のtracked / untracked差分は `git status --short` の結果として保持した。

## Review remediation evidence

- Coding Agent runtime本体とNative Local Runnerを`api/modules/codingAgent/runtime`へ移動し、旧`api/services/agent-runtime`をretired pathとして境界検査で禁止した。
- Mission Pilot固有route、Questionnaire intake、Artifact input解決、shared schema、frontend focus/i18nを対応するrole moduleへ移動した。
- Mission Pilotのtool turn policyとArtifact policyを分離し、Coding Agent provider policyをNative API request adapterへ明示的に適用した。
- terminal eventはcloseout write完了後にpublishし、同期・非同期subscriber failureを`Promise.allSettled`で隔離した。
- 最終検証: typecheck、lint、architecture、production build、326 test files / 2013 tests passed。
