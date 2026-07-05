# URL Routable Screens Implementation Plan

## Purpose

NightWorkers の主要画面を URL から直接開ける構造にする。ユーザーがブラウザ更新、戻る/進む、アプリ停止後の再起動をしても、最後に見ていた画面・対象 Project・対象 Session・主要タブへ戻れるようにする。

この計画は画面遷移の source of truth を React component local state から URL route state へ段階的に移す。UI の見た目や各画面の業務ロジックは変更対象にしない。

## Confirmed Baseline

現状の NightWorkers home は `src/routes/index.tsx` の `/` route で `NightWorkersShell` を描画している。

`NightWorkersShell` は次の local state の組み合わせで表示画面を決めている。

- `showSettings`
- `showOverviewScreen`
- `showQueueScreen`
- `projectQueueProjectId`
- `projectDetailProjectId`
- `artifactFocus`
- `workspace.activeSessionId`

関連ファイル:

- `src/routes/index.tsx`
- `src/App.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/hooks/nightWorkersWorkspaceState.ts`

既存 route:

- `/`: NightWorkers home
- `/login`
- `/oauth/callback`
- `/repositories`
- `/tasks/$id`
- `/showcase`
- `/blueprint-showcase`

既存の画面別 local state:

- Overview: `OverviewScreen` が `range` と `projectFilterId` を local state に持つ。
- Settings: `SettingsScreen` が `activeSettingsSection` を local state に持つ。
- Global Implementation Queue: `NightWorkersShell` が `queueProjectFilterId` を local state に持つ。
- Project Queue: `ProjectQueueScreen` が `viewMode` を local state に持つ。
- Project Detail: `ProjectDetailScreen` が `activeTab` を local state に持つ。
- Thread Workspace: `workspace.activeSessionId` が active Session を決める。
- Artifact pane: `artifactFocus`, `selectedProjectFilePath`, `projectArtifactMode`, `PlanModeWorkspaceViewer.initialTab` などが local state に分散している。

Tauri desktop:

- `src-tauri/tauri.conf.json` は `devUrl: http://127.0.0.1:39174`、`frontendDist: ../dist` を使う。
- `App.tsx` は desktop 時に `DesktopNavigationBar` を表示する。
- direct path reload が packaged app で index fallback されるかは未確認なので、Phase 0 で検証する。

## Scope

In scope:

- 主要画面を direct URL から復元する。
- URL 変更を browser history に反映し、戻る/進むで画面を戻せるようにする。
- 最後に見ていた route を保存し、`/` 起動時に復元する。
- 既存 sidebar / header / tab 操作から URL を更新する。
- Project / Session / Artifact が存在しない URL では壊れず、明示的な fallback を出す。
- URL state の parse / serialize helper と focused regression tests を追加する。

Out of scope:

- UI リデザイン。
- Project / Session / Artifact の DB schema 変更。
- 認証、アカウント、クラウド同期。
- Composer 入力途中の本文、未保存フォーム、ドラッグ中状態など transient state の URL 化。
- 既存 `/repositories`, `/showcase`, `/blueprint-showcase` の画面内容変更。
- `/tasks/$id` の standalone detail route 廃止。初期実装では互換維持する。

## URL Contract

Canonical workbench routes:

```text
/overview
/overview?range=30d&projectId=<repositoryId>

/settings
/settings/:section

/queue
/queue?projectId=<repositoryId>

/projects/:projectId/queue
/projects/:projectId/queue?view=board
/projects/:projectId/queue?view=table

/projects/:projectId/detail
/projects/:projectId/detail/:tab

/sessions/:sessionId
/sessions/:sessionId?artifact=todo
/sessions/:sessionId?artifact=project_tree
/sessions/:sessionId?artifact=project_tree&mode=diff
/sessions/:sessionId?artifact=project_tree&file=<encoded-relative-path>
/sessions/:sessionId?artifact=plan_mode_workspace&tab=status
/sessions/:sessionId?artifact=review_status
/sessions/:sessionId?artifactId=<artifactRefId>
```

Route meanings:

- `/overview`: Overview screen. Default `range=30d`, `projectId=all`.
- `/settings/:section`: Settings screen. `section` is one of `general`, `llm`, `plan-mode`, `test`, `appearance`, `mcp`, `hooks`.
- `/queue`: global Implementation Queue. Optional `projectId` filters the queue.
- `/projects/:projectId/queue`: Project Queue for one repository. Optional `view` controls board/table.
- `/projects/:projectId/detail/:tab`: Project Detail. `tab` is one of `overview`, `mission`, `evaluation`, `quality`, `stack`.
- `/sessions/:sessionId`: Thread Workspace for one task/session.
- `/sessions/:sessionId?artifact=...`: Thread Workspace plus right artifact pane focus.
- `/sessions/:sessionId?artifactId=...`: open a specific `WorkbenchArtifactRef` when it can be resolved from the active session evidence.

Compatibility:

- `/` remains a lightweight entrypoint. If no explicit target is present, it redirects/replaces to the last saved workbench route. If no saved route exists, it replaces to `/overview`.
- Existing `/tasks/$id` stays valid. It should either keep its current standalone detail behavior or redirect to `/sessions/$id` only after a separate compatibility review.

## Route State Model

Add a small route-state module instead of spreading route parsing across components.

Recommended file:

- `src/modules/nightworkers/routing/workbench-route-state.ts`

Types:

```ts
type WorkbenchRouteState =
  | { kind: 'overview'; range: OverviewRange; projectId: string | null }
  | { kind: 'settings'; section: SettingsSectionId }
  | { kind: 'global_queue'; projectId: string | null }
  | { kind: 'project_queue'; projectId: string; view: ProjectQueueViewMode }
  | { kind: 'project_detail'; projectId: string; tab: ProjectDetailTab }
  | { kind: 'session'; sessionId: string; artifact: WorkbenchArtifactRouteState | null };
```

Rules:

- Route params and search params are parsed by one helper and normalized to known union values.
- Invalid enum values fall back to the route default, not to arbitrary component state.
- Unknown Project / Session ids are not silently replaced with the first item. The visible screen should show a not-found state with a way back to Overview.
- Component event handlers navigate by producing a `WorkbenchRouteState`, not by directly toggling local screen booleans.
- Local state remains allowed for transient UI only.

## Implementation Plan

### Phase 0. Baseline and Route Feasibility

Goal: prove the current router and Tauri packaging can support direct workbench paths.

Tasks:

- Confirm TanStack Router path routing works for dev direct paths such as `/overview`.
- Build the frontend and confirm packaged/static fallback behavior for direct paths.
- If packaged Tauri cannot load direct path routes from `frontendDist`, decide one of:
  - configure Tauri/static fallback to serve `index.html`, preferred if straightforward;
  - use hash routes for desktop only, with path routes kept for browser;
  - use hash routes globally if fallback cannot be made reliable.
- Add a short note in the implementation PR explaining the chosen fallback.

Verification:

```bash
bun run build:frontend
bun run typecheck
```

Manual checks:

- Dev browser can open `/overview` directly.
- Dev browser can open `/projects/<projectId>/detail/mission` directly after replacing `<projectId>`.
- Desktop dev can reload a non-root workbench URL without a blank screen.

Stop condition:

- Do not implement child state routing until the direct-path/hash decision is proven.

### Phase 1. Introduce URL-Owned Shell State

Goal: make the top-level screen choice URL-owned while preserving existing screen components.

Files:

- `src/routes/index.tsx`
- new route files under `src/routes/`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- new `src/modules/nightworkers/routing/workbench-route-state.ts`
- focused tests under `tests/`

Tasks:

- Add file routes for:
  - `/overview`
  - `/settings/$section`
  - `/queue`
  - `/projects/$projectId/queue`
  - `/projects/$projectId/detail/$tab`
  - `/sessions/$sessionId`
- Pass parsed route state into `NightWorkersShell`.
- Replace `showOverviewScreen`, `showQueueScreen`, `projectQueueProjectId`, `projectDetailProjectId`, and `showSettings` as primary display inputs with the route state.
- Keep `artifactFocus` local in this phase except for closing it when route state changes to a non-session screen.
- Update sidebar actions:
  - Overview button navigates to `/overview`.
  - Project Queue button navigates to `/projects/:projectId/queue`.
  - Project Detail button navigates to `/projects/:projectId/detail`.
  - Session selection navigates to `/sessions/:sessionId`.
  - Settings button navigates to `/settings/general` or the last settings section when Phase 2 lands.

Verification:

```bash
bunx vitest run tests/workbench-route-state.test.ts tests/thread-workspace-header.test.ts
bun run typecheck
```

Manual checks:

- Direct `/overview` opens Overview.
- Direct `/queue` opens global Implementation Queue.
- Direct `/projects/<id>/queue` opens Project Queue for that Project.
- Direct `/projects/<id>/detail` opens Project Detail overview tab.
- Direct `/sessions/<id>` opens the session workspace.
- Browser back/forward moves between these screens.

### Phase 2. Route Child Screen State

Goal: URL に載せるべき画面内 state を controlled props にする。

Files:

- `src/modules/nightworkers/components/OverviewScreen.tsx`
- `src/modules/settings/SettingsScreen.tsx`
- `src/modules/queue/ImplementationQueueScreen.tsx`
- `src/modules/queue/ProjectQueueScreen.tsx`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/types.ts`
- `src/modules/nightworkers/routing/workbench-route-state.ts`

Tasks:

- Overview:
  - `range` and `projectFilterId` become controlled by URL search params.
  - Change handlers navigate to the same route with updated search.
- Settings:
  - `activeSettingsSection` becomes controlled by route param.
  - Section clicks navigate to `/settings/:section`.
- Global Queue:
  - `activeProjectFilterId` becomes controlled by `?projectId=`.
  - Filter changes update search params.
- Project Queue:
  - `viewMode` becomes controlled by `?view=board|table`.
  - Toggle updates search params.
- Project Detail:
  - `activeTab` becomes controlled by `:tab`.
  - Tab clicks navigate to `/projects/:projectId/detail/:tab`.

Verification:

```bash
bunx vitest run tests/project-detail-screen.test.tsx tests/artifact-workspace-viewer.test.ts tests/workbench-route-state.test.ts
bun run typecheck
```

Manual checks:

- `/overview?range=7d&projectId=<id>` shows the same filter after reload.
- `/settings/llm` opens LLM settings after reload.
- `/queue?projectId=<id>` preserves the filter after reload.
- `/projects/<id>/queue?view=table` opens table view after reload.
- `/projects/<id>/detail/mission` opens Mission tab after reload.

### Phase 3. Route Session Artifact Focus

Goal: Thread Workspace の右ペインも URL で復元する。

Files:

- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/nightworkers/workbenchSelectors.ts`
- `src/modules/nightworkers/routing/workbench-route-state.ts`

Tasks:

- Add route search parsing for:
  - `artifact=todo`
  - `artifact=project_tree`
  - `artifact=project_tree&mode=diff`
  - `artifact=project_tree&file=<path>`
  - `artifact=plan_mode_workspace&tab=<PlanWorkspaceTab>`
  - `artifact=review_status`
  - `artifactId=<WorkbenchArtifactRef.id>`
- Convert artifact open/close handlers to navigation:
  - Todo button updates route to `/sessions/:id?artifact=todo`.
  - Project tree button updates route to `/sessions/:id?artifact=project_tree`.
  - Blueprint/Plan Mode button updates route to `/sessions/:id?artifact=plan_mode_workspace&tab=status`.
  - Review button updates route to `/sessions/:id?artifact=review_status`.
  - Timeline artifact click updates route with `artifactId`.
- Keep artifact version selector and fullscreen state local.
- `PlanModeWorkspaceViewer` should accept `activeTab` / `onTabChange` or a route callback so tab changes update `tab=` after initial render.
- Project file path should use URL-safe encoding and should never accept absolute paths from the URL. It must remain relative to the active Project root.

Verification:

```bash
bunx vitest run tests/artifact-workspace-viewer.test.ts tests/workbench-route-state.test.ts
bun run typecheck
```

Manual checks:

- `/sessions/<id>?artifact=todo` opens Todo pane after reload.
- `/sessions/<id>?artifact=project_tree&mode=diff` opens Project diff after reload.
- `/sessions/<id>?artifact=plan_mode_workspace&tab=status` opens Plan Mode Status after reload.
- Changing Plan Mode tab changes the URL.
- Direct artifact URL with a stale `artifactId` shows the session without crashing and can clear the artifact param.

### Phase 4. Last Screen Restore

Goal: app 起動時に最後に見ていた screen route へ戻る。

Files:

- `src/routes/index.tsx`
- new `src/modules/nightworkers/routing/last-workbench-route.ts`
- `src/modules/nightworkers/routing/workbench-route-state.ts`

Tasks:

- Store the current canonical workbench route in `localStorage`.
- Storage key: `nightworkers:last-workbench-route:v1`.
- Store only relative route + search, never origin and never arbitrary external URL.
- Write only known workbench routes:
  - `/overview`
  - `/settings/...`
  - `/queue`
  - `/projects/...`
  - `/sessions/...`
- `/` route behavior:
  - if a valid saved route exists, `replace` to it;
  - otherwise `replace` to `/overview`.
- Do not restore over explicit routes. If the user opens `/projects/<id>/detail/quality`, that URL wins.
- When saved Project / Session no longer exists, render the not-found state and allow user to go to Overview. Do not mutate the saved route until the user navigates elsewhere.

Verification:

```bash
bunx vitest run tests/workbench-route-state.test.ts
bun run typecheck
```

Manual checks:

- Navigate to `/projects/<id>/detail/quality`, close/restart app, open root, return to that route.
- Navigate to `/sessions/<id>?artifact=todo`, close/restart app, open root, return to that session and pane.
- Open explicit `/overview` after a saved session route; app stays on `/overview`.
- Corrupt the localStorage value; app falls back to `/overview`.

### Phase 5. End-to-End Route Regression

Goal: route contract is protected by automated and manual coverage.

Tests:

- `tests/workbench-route-state.test.ts`
  - parse/serialize canonical routes.
  - reject invalid enum values.
  - reject absolute file paths.
  - sanitize last-route storage values.
- Component tests:
  - Project Detail tab controlled by route prop.
  - Project Queue view controlled by route prop.
  - Settings section controlled by route prop.
  - Plan Mode tab callback updates route.
- E2E smoke where practical:
  - direct `/overview`
  - direct `/projects/<id>/detail/mission`
  - direct `/sessions/<id>?artifact=todo`

Gate:

```bash
bun run test run tests/workbench-route-state.test.ts tests/project-detail-screen.test.tsx tests/artifact-workspace-viewer.test.ts
bun run typecheck
bun run build:frontend
```

If desktop route fallback was changed:

```bash
bun run desktop:prepare-sidecar
bun run desktop:smoke-sidecar
```

## Not Found and Recovery Behavior

Project not found:

- Route stays visible.
- Main pane shows a compact not-found state: target Project id, likely deleted/unavailable, action to Overview.
- Sidebar should not silently select the first Project as if the route succeeded.

Session not found:

- Route stays visible.
- Main pane shows a compact not-found state: target Session id, action to Overview.
- Do not create a new Session automatically from a missing direct URL.

Artifact not found:

- Session still opens.
- Artifact pane is closed or shows a recoverable empty state.
- Provide an action that navigates to the same session without artifact params.

Invalid tab/section/search value:

- Normalize to route default with `replace`, so the URL becomes canonical.

## Acceptance Criteria

- Every primary sidebar action has a canonical URL.
- Browser back/forward moves between primary screens without stale state.
- Reloading a direct URL restores the same screen and controlled child state.
- Starting the app at `/` restores the last known workbench route, unless the user opened an explicit route.
- Invalid Project / Session / Artifact references do not crash and do not silently select unrelated data.
- Existing data-fetching APIs and business logic remain unchanged.
- Existing `/tasks/$id` remains compatible.

## Risks

- Tauri packaged direct path fallback may not work with Browser history mode.
  - Mitigation: Phase 0 proves path routing or selects hash fallback before implementation.
- `NightWorkersShell` currently mixes screen selection and side effects.
  - Mitigation: introduce a typed route state and migrate handlers one group at a time.
- Artifact refs are derived from task messages/activity artifacts and may be unavailable on first render.
  - Mitigation: treat artifact route restoration as pending until session evidence loads, then resolve or show recoverable empty state.
- URL file path params could accidentally bypass project root rules.
  - Mitigation: only allow relative project paths and keep actual file access inside existing worker/API paths.
- Last-route restore can fight explicit user navigation.
  - Mitigation: restore only from `/`, and use `replace`.

## Deferred Work

- Deep-linking individual modals inside Project Detail.
- Persisting selected artifact version index.
- Persisting fullscreen state.
- Persisting in-progress composer text via URL.
- Route-level telemetry for frequently used screens.
- Sharing links across machines where Project / Session ids may not exist.
