# NightWorkers Domain Separation Plan

## Purpose

`src/modules/nightworkers` と `api/modules/nightworkers` を、純粋な coding agent / workbench session 実行に近づける。

初期分離対象は次の5ドメインに固定する。

1. `settings`
2. `mcp`
3. `hooks`
4. `todo`
5. `queue/scheduler`

この計画の目的は、NightWorkers core を「Project、Session、Run、runtime event、coding agent UI」に寄せ、それ以外の設定、連携、キュー制御、Todo workflow を別ドメインとして扱える境界へ移すことである。

## Scope

対象:

- `SettingsScreen` から settings / mcp / hooks / test quality / plan mode の責務を分ける。
- `nightWorkersCommands.ts` の settings / mcp / hooks / queue / todo workflow command を domain command へ分ける。
- `useNightWorkersWorkspace` から settings / mcp / hooks / queue / todo workflow の state と mutation を段階的に外す。
- `ImplementationQueueScreen` と queue scheduler API / service を `queue` domain に寄せる。
- `TodoListPane` と Todo Workflow settings を `todo` domain に寄せる。
- API aggregator と route wiring で、NightWorkers core が各 domain service を再 export し続ける状態を解消する。

対象外:

- coding agent runtime の挙動変更。
- provider / llm-provider 層への用途別 SystemContext 追加。
- Plan Mode / Blueprint / Questionnaire / Specification の分離。
- Queue processor の claim / drain アルゴリズム変更。
- MCP / Hooks の設定 schema 変更。
- Todo runtime gate の仕様変更。
- UI redesign。
- DB migration。既存 table / storage を維持する。

## Implementation Readiness Review

この計画は実装に移れる状態に近いが、初版のままだと次の点で作業開始時に迷いが出る。

1. `useNightWorkersSettings.ts` がすでに LLM settings、MCP、Hooks の state/mutation をまとめているため、最初に動かすべき単位は `SettingsScreen` ではなく `useNightWorkersSettings` の分割である。
2. `src/modules/queue` は既に存在するため、新規作成ではなく既存 queue domain へ `ImplementationQueueScreen` と queue commands を合流させる。
3. Queue / Scheduler backend を分けるとき、scheduler から `startTaskRun()` を直接 import すると循環依存になりやすい。先に run-start port を定義してから移動する。
4. Test Quality settings は user が指定した5ドメインには含まれていないが、Settings 画面内に残る Project-scoped settings である。Coverage autonomy の既存 strict schema / `nightworkers-quality.json` 方針を変えない。
5. `rg` gate の一部は「match が残らないこと」を期待するため、script 化する場合は exit code 1 を成功扱いにするか、手動確認として扱う。

この版では上記を前提として、Phase 0 と最初の実装 slice を追加し、Queue / Scheduler の依存境界を明記する。

## Current State

### Frontend

- `NightWorkersShell.tsx` は Settings、Overview、Project Queue、Project Evaluation、Implementation Queue、ThreadWorkspace、ArtifactPane、FolderBrowser を同時に切り替えている。
- `useNightWorkersWorkspace.ts` は Project / Session / Run だけでなく、Implementation Queue、Todo Workflow settings、Specification Workspace、Background Process、Project files、Realtime、Settings state をまとめて返している。
- `SettingsScreen.tsx` は General、Plan Mode、Appearance、LLM Providers、LLM Routing、Test Quality、Hooks、MCP を1つの screen state で扱っている。
- `useNightWorkersSettings.ts` は LLM settings、provider model options、MCP servers、Agent Hooks と、それらの mutation / query invalidation をまとめて返している。
- `nightWorkersCommands.ts` は NightWorkers session command と settings / mcp / hooks / queue command を同居させている。
- `TodoListPane.tsx` と `ImplementationQueueScreen.tsx` は `src/modules/nightworkers/components` 配下に残っている。
- Project Queue はすでに `src/modules/queue` 配下にあるが、Shell / workspace state との結合は `nightworkers` 側に残っている。

### Backend

- `api/modules/nightworkers/nightworkers.service.ts` は NightWorkers core だけでなく queue management、run orchestration、background process、review、questionnaire、blueprint、dbDesign、specification を集約している。
- `api/modules/nightworkers/nightworkers.routes.ts` は repository / task / run / queue / todo workflow / test quality / design status routes を同じ router に束ねている。
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts` は run start/stop と queue drain / queue completion bookkeeping を同居させている。
- MCP は `api/services/mcp/*` に service が分かれているが、route は `api/routes/settings.ts`、frontend は `nightworkers` settings UI に同居している。
- Hooks は `api/services/hooks/*` に service が分かれているが、route は `api/routes/settings.ts`、frontend は `nightworkers` settings UI に同居している。
- Todo runtime は `api/services/todo-runtime/*` にあるが、Todo Workflow settings API と UI は NightWorkers route / queue screen 側に混ざっている。

## Target Boundaries

### NightWorkers Core

残すもの:

- Project registration and selection
- Session CRUD
- Workbench chat submission
- Run start / stop
- Run timeline and event replay
- Artifact / diff / project file viewing needed by coding work
- Runtime lane selection visibility
- coding agent final report / review handoff

NightWorkers core may depend on the other domains through explicit adapters, but it should not own their storage, forms, route definitions, or screen state.

### Settings Domain

Owns:

- General settings
- LLM provider settings
- Role routing settings
- Plan Mode settings UI shell
- Test Quality settings UI shell and Project-scoped quality settings bridge
- settings navigation layout

Does not own:

- MCP server lifecycle
- Agent Hook lifecycle
- Queue processor settings
- Todo Workflow gate settings
- MCP or Hooks query invalidation

Initial paths:

- `src/modules/settings`
- `api/routes/settings.ts`
- `api/routes/settings-route-definitions.ts`
- `api/services/settings/*`

### MCP Domain

Owns:

- MCP settings forms and panels
- MCP server CRUD command wrappers
- MCP import / test UI state
- MCP settings route definitions if split from `api/routes/settings.ts`
- MCP effective settings read path

Initial paths:

- `src/modules/mcp`
- `api/services/mcp/*`
- optional route split: `api/routes/mcp-settings.ts`

### Hooks Domain

Owns:

- Agent Hooks forms and panels
- Agent Hook CRUD command wrappers
- Agent Hook test UI state
- Hook execution settings route definitions if split from `api/routes/settings.ts`
- Hook runner remains in backend service domain, not NightWorkers UI.

Initial paths:

- `src/modules/hooks`
- `api/services/hooks/*`
- optional route split: `api/routes/hooks-settings.ts`

### Todo Domain

Owns:

- `TodoListPane`
- Todo Workflow settings UI and command wrappers
- Todo runtime view types shared by run timeline
- Todo Workflow route / service adapter

Does not own:

- Runtime implementation of task execution
- Generic run finalization
- Queue processor scheduling

Initial paths:

- `src/modules/todo`
- `api/services/todo-runtime/*`
- optional API module: `api/modules/todo-workflow`

### Queue / Scheduler Domain

Owns:

- Project Queue UI
- Implementation Queue screen
- queue dashboard query / mutations
- queue processor count settings
- queue entry lifecycle commands
- scheduler drain entrypoints
- queue repository and queue management service

Does not own:

- `startTaskRun()` internals
- runtime lane selection
- coding agent prompt construction
- final report generation

Initial paths:

- existing `src/modules/queue`
- `api/modules/queue`
- `api/modules/scheduler` only if drain/session scheduling is separated from queue entry CRUD

## Design Rules

1. Keep compatibility exports during migration.
   - A phase may re-export from the old NightWorkers path to avoid changing every caller at once.
   - The final cleanup phase removes compatibility exports after all imports have moved.

2. Move UI and command wrappers before changing backend route ownership.
   - Frontend dependency direction should become visible before API route movement.
   - This reduces route churn while component imports are still changing.

3. Preserve behavior first.
   - Each phase is a module boundary move, not a product behavior change.
   - Existing tests should pass with the same user-visible behavior.

4. Do not split one file into a dumping ground.
   - New domain entrypoints should expose narrow functions and typed state.
   - Avoid creating `src/modules/settings/index.ts` that simply re-exports everything unrelated.

5. NightWorkers core should consume domain capabilities through explicit props or hooks.
   - `NightWorkersShell` should not reach into MCP / Hooks form state.
   - `useNightWorkersWorkspace` should not return every settings mutation after domains own their own hooks.

6. Use ports before moving scheduler logic.
   - Define a small run-start interface before queue/scheduler imports `startTaskRun()`.
   - Scheduler may call `startTaskRun` through this port, but NightWorkers run orchestration must not import queue scheduler implementation.
   - Queue completion bookkeeping may be called from run finalization, but it should be exposed as a narrow queue lifecycle function.

7. Keep project-scoped quality settings strict.
   - Test Quality settings stay under Settings domain unless a later plan splits a Quality domain.
   - Unknown keys and malformed quality config must keep existing strict behavior.
   - Do not move `nightworkers-quality.json` into global runtime settings.

## Baseline Checklist

Record this before implementation starts.

Commands:

```sh
rg -n "SettingsScreen|SettingsMcpPanel|SettingsHooksPanel|ImplementationQueueScreen|TodoListPane" src/modules/nightworkers
rg -n "fetchMcpServers|createMcpServer|fetchAgentHooks|createAgentHook|fetchImplementationQueue|fetchTodoWorkflowSettings" src/modules/nightworkers/nightWorkersCommands.ts src/modules/nightworkers/hooks
rg -n "runImplementationQueue|runSessionQueueForRepository|updateTodoWorkflowSettings|getTodoWorkflowSettings" api/modules/nightworkers
rg -n "mcp|hooks" api/routes/settings.ts api/services/mcp api/services/hooks
wc -l src/modules/nightworkers/components/SettingsScreen.tsx src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts src/modules/nightworkers/components/NightWorkersShell.tsx
```

Expected baseline:

- `SettingsScreen` owns MCP and Hooks save/test state.
- `useNightWorkersSettings` owns LLM, MCP, and Hooks query state.
- `nightWorkersCommands.ts` contains MCP, Hooks, Queue, and Todo Workflow command wrappers.
- `useNightWorkersWorkspace` exposes Queue and Todo Workflow state/mutations.
- `NightWorkersShell` imports `ProjectQueueScreen` from `src/modules/queue` but still wires it from NightWorkers state.
- backend queue/scheduler entrypoints are under `api/modules/nightworkers`.

Do not start Phase 0 until these facts are confirmed against the current tree.

## Implementation Phases

### Phase 0: First Slice Readiness

Goal:

- Make the first implementation branch mechanical and low-risk.

Tasks:

1. Confirm `bun run typecheck`, `bunx biome check`, and `bun run verify` scripts exist in `package.json`.
2. Confirm current queue UI already lives partly in `src/modules/queue`.
3. Confirm `useNightWorkersSettings` is the current state owner for LLM / MCP / Hooks.
4. Decide first PR scope:
   - PR 1: frontend settings/mcp/hooks state split only.
   - No backend route movement.
   - No queue movement.
   - No Todo movement.
5. Record the baseline commands from the checklist.

Gate:

```sh
node -e "const p=require('./package.json'); console.log(p.scripts.typecheck, p.scripts.verify)"
rg -n "export function useNightWorkersSettings|fetchMcpServers|fetchAgentHooks" src/modules/nightworkers/hooks/useNightWorkersSettings.ts
find src/modules/queue -maxdepth 1 -type f | sort
```

Expected:

- The first implementation can start by moving frontend settings hooks and panels only.
- Backend routes remain untouched in the first PR.
- Reviewers can verify the first slice with typecheck, focused settings tests, and unchanged UI behavior.

Stop if:

- `useNightWorkersSettings` has already been split in the current tree.
- `src/modules/queue` has been removed or renamed.
- package scripts differ from the expected repo-native verify flow.

### Phase 1: Domain Inventory And Import Map

Goal:

- Produce a source-truth import map before moving files.

Tasks:

1. Create a temporary tracking note in the PR description or implementation log listing current owners for settings, mcp, hooks, todo, queue/scheduler.
2. Identify all imports from:
   - `src/modules/nightworkers/components/SettingsScreen`
   - `src/modules/nightworkers/components/SettingsMcpPanel`
   - `src/modules/nightworkers/components/SettingsHooksPanel`
   - `src/modules/nightworkers/hooks/useNightWorkersSettings`
   - `src/modules/nightworkers/components/ImplementationQueueScreen`
   - `src/modules/nightworkers/components/TodoListPane`
   - `src/modules/nightworkers/nightWorkersCommands`
   - `api/modules/nightworkers/nightworkers.queue-management.service`
   - `api/modules/nightworkers/nightworkers.queue.repository`
3. Decide compatibility export names before moving files.
4. Do not edit behavior in this phase.

Gate:

```sh
rg -n "SettingsMcpPanel|SettingsHooksPanel|ImplementationQueueScreen|TodoListPane|nightWorkersCommands" src api tests
rg -n "useNightWorkersSettings|mcpServers|agentHooks|llmSettings" src/modules/nightworkers
```

Expected:

- Import map is complete enough that Phase 2 can be reviewed as mechanical movement.
- No source files changed except the plan implementation log if one is used.

### Phase 2: Split Settings Shell From MCP And Hooks Panels

Goal:

- Make Settings a shell that hosts domain panels instead of owning MCP / Hooks state.

Tasks:

1. Create `src/modules/settings`.
2. Move `useNightWorkersSettings.ts` to a settings-domain hook or split it into:
   - `src/modules/settings/useLlmSettings.ts`
   - `src/modules/mcp/useMcpSettings.ts`
   - `src/modules/hooks/useAgentHooks.ts`
3. Create `src/modules/mcp` and move `SettingsMcpPanel` plus MCP form helpers out of `SettingsForms.ts`.
4. Create `src/modules/hooks` and move `SettingsHooksPanel` plus Hook form helpers out of `SettingsForms.ts`.
5. Move MCP command wrappers from `nightWorkersCommands.ts` into `src/modules/mcp/mcpCommands.ts`.
6. Move Hook command wrappers from `nightWorkersCommands.ts` into `src/modules/hooks/hooksCommands.ts`.
7. Move generic settings shell code from `SettingsScreen.tsx` into `src/modules/settings`.
8. Keep `SettingsScreen` compatibility export from `src/modules/nightworkers/components/SettingsScreen.tsx`.
9. `SettingsScreen` may still render MCP / Hooks panels, but it should consume domain hooks/commands from their domains.
10. Leave Test Quality settings in the Settings domain and keep its Project-scoped storage contract unchanged.

Gate:

```sh
rg -n "createMcpServer|updateMcpServer|testMcpServer|importMcpServers" src/modules/nightworkers
rg -n "createAgentHook|updateAgentHook|testAgentHook|deleteAgentHook" src/modules/nightworkers
rg -n "mcpServers|agentHooks" src/modules/nightworkers/hooks/useNightWorkersSettings.ts src/modules/nightworkers/hooks/nightWorkersWorkspaceState.ts
bunx biome check src/modules/settings src/modules/mcp src/modules/hooks src/modules/nightworkers/components/SettingsScreen.tsx
bun run typecheck
```

Expected:

- MCP / Hooks form logic no longer lives in NightWorkers components.
- Remaining NightWorkers references are compatibility imports, settings shell wiring, or temporary type exports only.
- MCP / Hooks behavior is unchanged.
- LLM settings behavior is unchanged.
- Test Quality settings still read and write project `nightworkers-quality.json`.

Stop if:

- Settings save starts mixing MCP / Hooks payloads.
- Secret masking or effective settings behavior changes.
- `useNightWorkersWorkspace` still exposes MCP / Hooks after this phase's intended call sites have moved.
- Quality settings strict schema behavior changes.

### Phase 3: Move MCP And Hooks API Routes Out Of Settings Router

Goal:

- Backend routes reflect MCP and Hooks as separate domains.

Tasks:

1. Extract MCP route definitions from `api/routes/settings-route-definitions.ts` only if needed for clarity; otherwise keep schemas but move route registration.
2. Create `api/routes/mcp-settings.ts` for:
   - list MCP servers
   - create MCP server
   - import MCP servers
   - update MCP server
   - delete MCP server
   - test MCP server
3. Create `api/routes/hooks-settings.ts` for:
   - list Agent Hooks
   - create Agent Hook
   - update Agent Hook
   - delete Agent Hook
   - test Agent Hook
4. Keep existing public URL paths stable.
5. Update route registration where application routers are composed.
6. Leave `api/services/mcp/*` and `api/services/hooks/*` behavior unchanged.

Gate:

```sh
bunx vitest run tests/services.mcp-settings.test.ts tests/services.agent-hooks.test.ts tests/services.mcp-tool-bridge.test.ts tests/lib.validation-hook.test.ts
rg -n "createMcpServer|createAgentHook" api/routes/settings.ts
```

Expected:

- Tests for MCP and Hooks still pass.
- `api/routes/settings.ts` no longer directly owns MCP / Hooks lifecycle handlers.
- Public endpoint behavior remains compatible.

Stop if:

- Existing settings routes lose OpenAPI registration.
- MCP imported settings no longer merge Codex global config correctly.
- Hook test execution uses worker `run_command` instead of the hook runner.

### Phase 4: Extract Todo Domain

Goal:

- Todo UI and Todo Workflow settings stop living inside NightWorkers / Queue screens.

Tasks:

1. Create `src/modules/todo`.
2. Move `TodoListPane.tsx` into `src/modules/todo`.
3. Move Todo Workflow settings UI out of `ImplementationQueueScreen` into a Todo domain component.
4. Move Todo Workflow command wrappers from `nightWorkersCommands.ts` into `src/modules/todo/todoCommands.ts`.
5. Add a small Todo domain hook for reading/updating Todo Workflow settings.
6. Keep runtime Todo closeout logic in backend orchestration until a later phase; do not change gate semantics.
7. Optionally create `api/modules/todo-workflow` to wrap `getTodoWorkflowSettings` and `updateTodoWorkflowSettings`; keep table and schema unchanged.

Gate:

```sh
rg -n "TodoListPane|TodoWorkflow|todoWorkflowSettings|fetchTodoWorkflowSettings|updateTodoWorkflowSettings" src/modules/nightworkers
bunx vitest run tests/services.todo-runtime.test.ts tests/services.todo-list-builder.test.ts tests/services.todo-context.test.ts
```

Expected:

- NightWorkers may render Todo components through imports, but it does not own Todo Workflow form state.
- Todo runtime tests are unchanged.
- Todo Workflow settings still affect run finalization as before.

Stop if:

- Open Todo finalization guard changes.
- Todo Workflow settings become project-scoped accidentally.
- `ImplementationQueueScreen` still owns Todo Workflow form state after the phase.

### Phase 5: Extract Queue UI And Commands

Goal:

- Queue UI, dashboard queries, and queue entry mutations are owned by `src/modules/queue`.

Tasks:

1. Move `ImplementationQueueScreen.tsx` into the existing `src/modules/queue`.
2. Move queue command wrappers from `nightWorkersCommands.ts` into `src/modules/queue/queueCommands.ts`.
3. Move queue mutation hooks from `useNightWorkersMutations` into a Queue domain hook.
4. Make `ProjectQueueScreen` and `ImplementationQueueScreen` consume the same queue command layer.
5. Keep `NightWorkersShell` as the composition point, but pass only narrow queue props.
6. Remove queue-specific methods from `NightWorkersWorkspaceState` once all call sites use Queue domain hooks.

Gate:

```sh
rg -n "fetchImplementationQueue|createImplementationQueueEntry|archiveImplementationQueueEntry|requeueImplementationQueueEntry|updateImplementationQueueEntry|updateImplementationQueueSettings" src/modules/nightworkers
bunx vitest run tests/project-queue-model.test.ts tests/services.queue-management.test.ts
bunx biome check src/modules/queue src/modules/nightworkers/components/NightWorkersShell.tsx
```

Expected:

- Queue commands are no longer declared in `nightWorkersCommands.ts`.
- Queue UI code lives under `src/modules/queue`.
- Project Queue behavior remains unchanged.

Stop if:

- Project Queue starts using `Task.priority` for queue position.
- Queue mutations stop invalidating queue dashboard data.
- Queue UI synthesizes rows not backed by Session / queue entry truth.

### Phase 6: Extract Backend Queue / Scheduler Module

Goal:

- Queue entry CRUD and scheduler drain logic no longer live under `api/modules/nightworkers`.

Tasks:

1. Create `api/modules/queue`.
2. Move `nightworkers.queue.repository.ts` to queue repository with compatibility export.
3. Move `nightworkers.queue-management.service.ts` to queue management service with compatibility export.
4. Move `api/modules/nightworkers/routes/queue-routes.ts` to queue route module while preserving public URL paths.
5. Add a run-start port before moving scheduler logic. Suggested shape:

```ts
export type QueueRunStarter = (
  taskId: string,
  options: { executionMode: 'implementation'; executionModeSource: 'implementation_queue' | 'session_queue' }
) => Promise<{ id: string; taskId: string }>;
```

6. Move `runImplementationQueue`, `completeImplementationQueueEntryForRun`, `archiveImplementationQueueEntryForRun`, `runSessionQueueForRepository`, and session queue drain helpers out of `nightworkers.run-orchestration.service.ts` only after the port is in place.
7. If needed, create `api/modules/scheduler` for drain/session scheduling and keep queue entry CRUD in `api/modules/queue`.
8. `startTaskRun()` should remain in NightWorkers run orchestration; scheduler calls it through the run-start port.
9. Run finalization may call queue lifecycle functions, but it must not import scheduler drain internals.

Gate:

```sh
rg -n "runImplementationQueue|runSessionQueueForRepository|completeImplementationQueueEntryForRun|archiveImplementationQueueEntryForRun" api/modules/nightworkers
bunx vitest run tests/services.queue-management.test.ts tests/nightworkers-workbench-routes/routes-workbench-02.test.ts tests/nightworkers-workbench-routes/routes-workbench-03.test.ts
```

Expected:

- `api/modules/nightworkers` no longer owns queue drain implementation.
- NightWorkers run orchestration owns run lifecycle only.
- Queue service can start runs through an imported runner adapter.
- Import graph has no cycle between NightWorkers run orchestration and queue/scheduler modules.

Stop if:

- Scheduler cannot update queue entry status after run completion.
- `stopTaskRun()` no longer completes/cancels associated queue entry.
- Queue drain starts before run row is durably created.
- Queue/scheduler imports `nightworkers.run-orchestration.service.ts` while run orchestration also imports queue/scheduler implementation.

### Phase 7: Slim NightWorkers Workspace State

Goal:

- `useNightWorkersWorkspace` returns NightWorkers core state only.

Tasks:

1. Move settings state to `src/modules/settings/useSettingsWorkspace` or equivalent.
2. Move MCP state to `src/modules/mcp/useMcpSettings`.
3. Move Hooks state to `src/modules/hooks/useAgentHooks`.
4. Move Queue state to `src/modules/queue/useQueueWorkspace`.
5. Move Todo Workflow state to `src/modules/todo/useTodoWorkflowSettings`.
6. Update `NightWorkersShell` to compose these hooks at the screen boundary.
7. Remove domain methods from `NightWorkersWorkspaceState` after callers are migrated.

Gate:

```sh
rg -n "mcpServers|agentHooks|implementationQueue|todoWorkflowSettings|createMcpServer|createAgentHook|updateImplementationQueue" src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts src/modules/nightworkers/hooks/nightWorkersWorkspaceState.ts
bunx biome check src/modules/nightworkers src/modules/settings src/modules/mcp src/modules/hooks src/modules/todo src/modules/queue
```

Expected:

- `useNightWorkersWorkspace` still handles projects, sessions, runs, messages, realtime, activity replay, and project files.
- Settings / MCP / Hooks / Queue / Todo are composed outside the NightWorkers workspace state.
- `NightWorkersShell` is smaller and easier to read.

Stop if:

- Realtime run updates stop merging into the active timeline.
- Chat submit lock behavior changes.
- Project/session selection behavior changes.

### Phase 8: Remove Compatibility Exports And Close Out

Goal:

- Finish the migration by removing old import paths and documenting the final boundary.

Tasks:

1. Remove compatibility exports from NightWorkers component files.
2. Remove moved commands from `nightWorkersCommands.ts`.
3. Remove queue/todo/settings/mcp/hooks entries from `NightWorkersWorkspaceState`.
4. Update `spec/docs/architecture.md` to reflect final domain boundaries.
5. Update `spec/docs/configuration.md` only if route ownership wording changed.
6. Run final verification.

Gate:

```sh
rg -n "SettingsMcpPanel|SettingsHooksPanel|ImplementationQueueScreen|TodoListPane" src/modules/nightworkers
rg -n "createMcpServer|createAgentHook|fetchImplementationQueue|fetchTodoWorkflowSettings" src/modules/nightworkers/nightWorkersCommands.ts src/modules/nightworkers/hooks
bun run typecheck
git diff --check
bun run verify
```

Expected:

- NightWorkers imports other domains intentionally.
- Other domains do not import NightWorkers UI internals.
- Full repo verification passes.

## Validation Plan

Run focused checks after each phase:

```sh
bunx biome check <touched paths>
bun run typecheck
```

Domain-specific checks:

```sh
bunx vitest run tests/services.mcp-settings.test.ts tests/services.mcp-tool-bridge.test.ts
bunx vitest run tests/services.agent-hooks.test.ts tests/lib.validation-hook.test.ts
bunx vitest run tests/services.todo-runtime.test.ts tests/services.todo-list-builder.test.ts tests/services.todo-context.test.ts
bunx vitest run tests/services.queue-management.test.ts tests/project-queue-model.test.ts
```

Route / integration checks after API route movement:

```sh
bunx vitest run tests/nightworkers-routes/routes-nightworkers-01.test.ts tests/nightworkers-routes/routes-nightworkers-02.test.ts
bunx vitest run tests/nightworkers-workbench-routes/routes-workbench-02.test.ts tests/nightworkers-workbench-routes/routes-workbench-03.test.ts
```

Final closeout:

```sh
bun run verify
```

Manual checks:

- Settings opens and saves General / LLM / Plan Mode / Test Quality.
- MCP server create, import, toggle, and test still work.
- Agent Hook create, edit, delete, and test still work.
- Implementation Queue screen loads processors, queued items, completed items, and Todo Workflow settings.
- Project Queue opens from sidebar and uses the same queue dashboard truth.
- Active coding session can start, stream events, show Todo pane, show diff/project files, and stop cleanly.

## Stop Conditions

Stop and fix before continuing if:

- Any phase requires behavior changes outside its domain boundary.
- A compatibility export hides a circular dependency.
- Settings screen starts owning MCP / Hooks state after Phase 2.
- MCP or Hooks routes change public URL shape.
- Todo Workflow settings stop affecting run finalization.
- Queue drain logic can no longer update queue entry status.
- `useNightWorkersWorkspace` loses realtime timeline behavior.
- `NightWorkersShell` becomes the place where domain-specific form state is reintroduced.
- Full verify fails for a reason introduced by the migration.

## Final Acceptance Criteria

- `settings`, `mcp`, `hooks`, `todo`, and `queue/scheduler` have explicit frontend domain modules.
- Queue backend ownership is outside `api/modules/nightworkers`, or the remaining compatibility exports are documented and temporary.
- NightWorkers core owns Project / Session / Run / coding workbench behavior only.
- `nightWorkersCommands.ts` no longer contains MCP, Hooks, Queue, or Todo Workflow command wrappers.
- `useNightWorkersWorkspace` no longer exposes MCP, Hooks, Queue, Todo Workflow, or Settings mutation APIs.
- Existing public API behavior is preserved.
- Focused domain tests and `bun run verify` pass.
