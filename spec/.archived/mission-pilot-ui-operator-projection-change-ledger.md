# Mission Pilot UI Operator Projection Change Ledger

## Baseline

- Baseline HEAD: `f21999f7`
- Captured: 2026-07-17
- Working-tree policy: implementation開始前から存在する変更を保持し、このrefactorの差分へ混在させない。
- Pre-existing/concurrent dirty paths: このrefactorが追加したpathを除いて45件。作業中にも別scopeの変更が増えているため、各Checkpointで`git status --short`とpath限定diffを再確認する。

このrefactorが最初のCheckpointで所有するpath:

- `.agent-ontology/boundary-policy.json`
- `shared/modules/taskOperator/**`
- `tests/task-operator-contract.test.ts`
- `spec/docs/mission-pilot-ui-operator-projection-refactor-plan.md`
- `spec/docs/mission-pilot-ui-operator-projection-change-ledger.md`

## Legacy provider input baseline

現行の`missionPilotToolDefinitions()`を全action利用可能としてserializeしたbaseline:

| Metric | Baseline |
| --- | ---: |
| 常時送信tool数 | 50 |
| action tool数 | 39 |
| serialized bytes | 20,215 |
| approximate tokens (`length / 4`) | 4,737 |

この値はtool definitionだけのbaselineであり、System Context、Task read model、conversation replay、tool resultを含まない。Phase 5でsection別計測へ置き換え、選択したaction contract一件以外がprovider入力へ入らないことをfixtureで比較する。

## Boundary inventory

### Coding Agent内のMission Pilot semantic reference

- `api/modules/codingAgent/context/context-packet.ts`
- `api/modules/codingAgent/context/system-context.ts`
- `api/modules/codingAgent/runtime/task-status-projection.ts`
- `api/modules/codingAgent/index.ts`

### Mission Pilotのdomain/runtime直接依存

- `api/modules/missionPilot/agent/mission-pilot-task-read.adapter.ts`がTask、Task Message、Queue、Run tableを直接読む。
- `api/modules/missionPilot/agent/mission-pilot-task-action.adapter.ts`がTask、Run tableを直接読む。
- `api/modules/missionPilot/agent/mission-pilot-action-command-executor.ts`が`startTaskRun`をdynamic importして直接開始する。

### Domain public API inventory

- `review`はpublic `index.ts`を持つ。
- `task`、`run`は独立moduleが未作成で、正本query/commandは主に`nightworkers`配下にある。
- `queue`、`questionnaire`、`specification`はmoduleが存在するがpublic `index.ts`がない。
- `gitCloseout`は独立moduleが未作成で、正本処理は主に`nightworkers`配下にある。
- `taskOperator` moduleとshared contractは実装開始時点で存在しない。

## Initial command parity gaps

| Operation | UI path / canonical candidate | Mission Pilot current path | Gap |
| --- | --- | --- | --- |
| Task update/message/archive | Task routes/services | action executorの個別service呼び出し | 共通command facadeがない |
| Questionnaire submit | Questionnaire route | registryで利用不能 | actor roleによる不一致 |
| Start Coding Agent Run | `/tasks/:id/run` | internal `startTaskRun` dynamic import | entry pointとrequest contractが異なる |
| Test/review/rework | 専用互換route/service | `run.test.start`、`review.*` | 通常runとは別の意味的開始経路 |
| needs_human resume | Run resume route/service | action catalogになし | Mission Pilot parityがない |
| Task complete | Task/run closeout | Mission Pilot-owned Runを要求 | requester provenanceによる不一致 |

## Checkpoints

| Phase | Status | Evidence / next gate |
| --- | --- | --- |
| Phase 0 | complete | dirty tree、tool schema baseline、boundary/parity inventoryを採取 |
| Phase 1 | complete | domain public query/command wrapper、strict Task Operator contract、neutral Coding Agent portを追加 |
| Phase 2 | complete | canonical head/detail projection、digest、cursor、paging、UI/MP read adapterを実装 |
| Phase 3 | complete | UI routeとMission Pilot actionをTask Operator command facadeへ統一。Questionnaire submit、Todo resume、Task completeを同契約化 |
| Phase 4 | complete | Coding Agentのrequester mode、Mission Pilot prompt/runtime dependency、Queue handoff dependencyを除去 |
| Phase 5 | complete | generic 7-tool surface、bounded conversation/tool receipt/current-step/compactionを実装 |
| Phase 6 | complete | pseudo initial promptを削除し、Task Operator headとtimeline pagingへ切替 |
| Phase 7 | complete | missing agent rowのadditive stopped migrationを追加し、legacy production activationとownership resultを削除 |
| Phase 8 | complete | source scan、boundary test、token regression、typecheck/lint/docs/full testを実行 |

## Implemented token result

| Metric | Baseline | Implemented |
| --- | ---: | ---: |
| 常時送信tool数 | 50 | 7 |
| serialized tool bytes | 20,215 | 2,732 |
| approximate tool tokens | 4,737 | 683 |
| head projection budget | 未設定 | 3,000 tokens以下 |
| provider conversation budget | unbounded risk | 48,000 bytes以下 |
| compaction input budget | unbounded risk | 64,000 bytes以下 |

大量履歴fixtureはTask message 1,000件、Artifact 100件、terminal Run 100件、Questionnaire 20 revision、tool result 1,000件、unread event 1,000件で検証した。headへ本文全件を入れず、detailを12,000 bytes page、digest、cursorで再取得できる。

## Migration and rollback

- startup migrationはagent rowがないMission Pilot sessionだけを停止状態へ移し、agent rowを追加する。
- migration中にPlay、wake、provider call、Task mutation、Coding Agent Run stopを実行しない。
- existing Task message、Run、Artifact、Questionnaire、tool receipt、usage rowを削除しない。
- rollbackは旧application versionへ戻す。schema破壊がないため追加agent rowは保持可能で、厳密な移行前状態が必要な場合だけ事前DB backupを復元する。

## Verification log

- `npm run typecheck`: pass
- `npm run lint`: pass (1,681 files)
- `npm run check:docs`: pass (12 documents)
- Task Operator contract/token regression、Mission Pilot runtime/migration、Coding Agent negative boundary targeted tests: pass
- full test（直列、除外なし）: 329 files / 2,050 tests pass。reviewで検出したRun association、Task本文paging、idempotency、resource ownership、revision、migration raceの回帰を追加検証済み。
- `node scripts/check-module-boundaries.mjs`: pass (1,274 files)
- `node scripts/check-coding-agent-semantic-control.mjs`: pass
- `node scripts/check-coding-agent-standalone-boundary.mjs`: pass
- `node scripts/check-task-operator-boundary.mjs`: pass
- `node scripts/agent-ontology/validate-manifests.mjs`: pass
- `npm run check:architecture`: Task Operator/module/Coding Agent/ontology/large-source baselineを含む全gateがpass。
