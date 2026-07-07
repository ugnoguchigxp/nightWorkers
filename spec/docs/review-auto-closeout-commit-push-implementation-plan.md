# Review Auto Closeout Commit Push Implementation Plan

## Purpose

LLM が実装完了を報告した後、対象 run を自動で Review Mode に接続し、必須レビューを `受け入れ条件テスト証跡確認` だけに絞る。

必須レビューが完了したら、対象 run が所有する差分だけを commit できる UI と backend API を追加する。commit 成功後は、同じ UI から push できるようにする。

この計画で狙うこと:

- 実装完了報告後に、ユーザーが手動で Review Mode を開かなくても `review_status` が作られる。
- 必須 gate は `test_coverage` section の完了だけにする。
- `security_review`、`findings`、`prompt_suggestions` は optional とし、未実行でも commit を止めない。
- commit は `task_run_commit_records` が示す対象 run の owned diff だけに限定する。
- push は commit 済み状態からだけ実行できる明示操作にする。

## Current Baseline

現行実装には、今回使うべき土台がすでにある。

- `api/services/run-control/run-outcome-gate.ts`
  - runtime の `completed` は既定で `needs_review` に写像される。
- `api/modules/nightworkers/run-orchestration/runtime-execution.ts`
  - run 完了時に final report、diff、test results を保存する。
  - 完了後に `safelyCreateReviewRecommendation({ taskId, runId })` を呼ぶ。
  - ただし Review session / `review_status` artifact は自動生成しない。
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
  - `startReviewSessionForRun(runId)` が Review session と `review_status` artifact を作る。
  - `runReviewSection(reviewSessionId, 'test_coverage')` が受け入れ条件テスト証跡確認を実行する。
- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
  - Review section は `test_coverage`, `security_review`, `findings`, `prompt_suggestions`。
  - 現状は `security_review` や `findings` が required になり得る。
- `api/modules/nightworkers/run-orchestration/git-ownership.ts`
  - run 開始時の dirty paths と runtime diff から `stageableOwnedPaths` を作る。
  - commit 可能性は `task_run_commit_records.status` として保存される。
- `task_run_commit_records`
  - `baseline_head`, `pre_existing_dirty_paths_json`, `owned_candidate_paths_json`, `stageable_owned_paths_json`, `verification_status`, `commit_sha`, `commit_message` を持つ。
- frontend の `ReviewStatusViewer`
  - Review sections の表示と section 実行ボタンがある。
  - commit / push の明示操作はまだない。

現状の不足:

- run が `needs_review` になっても Review session は自動作成されない。
- Queue 側の `needs_review` / `awaiting_commit_decision` の接続が commit closeout まで完結していない。
- 必須レビューの範囲が「受け入れ条件テスト証跡確認だけ」に固定されていない。
- 対象 run の owned diff だけを commit する専用 API がない。
- push は worker command policy では危険コマンドとして扱われるため、明示 UI 専用 API として設計する必要がある。

## Review Findings Addressed In This Revision

この文書は、実装前レビューで見つけた次の曖昧さを潰すために改訂する。

1. **Review Mode 自動生成の成功/失敗 contract が弱い**
   - 修正: `needs_review` closeout で生成する保存先、run event、失敗時の degraded artifact を固定する。
2. **`test_coverage` の required が「合格必須」なのか「確認実行必須」なのか曖昧**
   - 修正: 初期実装では required gate は section 実行完了を意味する。`not_found` / `unclear` は warning と改善 prompt にし、commit を直接止めない。
3. **optional section 由来 finding が commit gate を止めるか曖昧**
   - 修正: 初期実装では optional section 由来 finding は commit gate 対象外。表示と follow-up prompt 生成だけに使う。
4. **push 結果の保存先が reload 後に不安定**
   - 修正: 初期実装から `task_run_commit_records` に push columns を追加し、UI は run event ではなく commit record を primary state とする。
5. **UI と API の state vocabulary がずれる余地がある**
   - 修正: `GitCloseoutState`、blocking reason code、commit / push result を計画内に固定する。
6. **検証が末尾に寄っており、phase ごとの完了条件が弱い**
   - 修正: 各 phase に implementation done、tests、evidence location を追加する。

## Locked Decisions For Initial Implementation

実装時に再判断しない決定事項:

- Review Mode 自動生成の対象は、runtime outcome が `needs_review` になった run に限定する。
- Review session は backend closeout 側で生成する。frontend の lazy create だけには依存しない。
- 必須 section は `test_coverage` のみ。
- `test_coverage` の表示名は既存の `テスト証跡確認` を維持する。
- `security_review`、`findings`、`prompt_suggestions` は optional または omitted にする。
- optional section の未実行は commit gate を止めない。
- optional section 由来の unresolved finding は、初期実装では commit gate を止めない。
- commit gate は `test_coverage` section の status と `task_run_commit_records` を見る。
- commit 対象は `stageable_owned_paths_json` の path だけ。
- pre-existing dirty path は自動 commit 対象にしない。
- path 単位で分離できない変更は `needs_human` とし、commit ボタンを無効化する。
- push は commit 成功後だけ有効化する。
- push state は `task_run_commit_records` に保存する。
- PR / branch 作成は今回の scope に含めない。
- auto commit はしない。commit / push は UI の明示ボタン操作に限定する。

## Terms And State Contracts

### Required Review

この計画の required review は `test_coverage` section の実行完了を指す。

```ts
type RequiredReviewState =
  | 'not_started'
  | 'running'
  | 'done'
  | 'blocked'
  | 'needs_human';
```

- `done`: `test_coverage` artifact が生成され、受け入れ条件ごとの確認結果が保存された。
- `needs_human`: 実装計画 artifact がない、受け入れ条件が抽出できない、LLM reviewer / tool loop が完了できない、などで確認結果を保存できなかった。
- `blocked`: service-level precondition が満たされず section を開始できなかった。

重要:

- `done` は「全受け入れ条件に対応テストが存在する」という意味ではない。
- `not_found` / `unclear` は warning finding と prompt suggestion に変換する。
- commit gate は `test_coverage.progress === 'done'` を見る。

### Commit Closeout State

UI と API は同じ state 名を使う。

```ts
type GitCloseoutBlockingCode =
  | 'RUN_NOT_FOUND'
  | 'REPOSITORY_NOT_FOUND'
  | 'REVIEW_SESSION_MISSING'
  | 'REQUIRED_REVIEW_NOT_DONE'
  | 'COMMIT_RECORD_MISSING'
  | 'COMMIT_RECORD_NOT_READY'
  | 'NO_STAGEABLE_PATHS'
  | 'HEAD_MOVED'
  | 'DIRTY_PATHS_MISSING'
  | 'STAGED_PATHS_OUTSIDE_OWNERSHIP'
  | 'COMMIT_ALREADY_CREATED'
  | 'UPSTREAM_MISSING'
  | 'PUSH_HEAD_MISMATCH'
  | 'PUSH_POLICY_BLOCKED'
  | 'GIT_COMMAND_FAILED';

type GitCloseoutUiState =
  | 'review_required'
  | 'commit_ready'
  | 'commit_running'
  | 'committed'
  | 'push_ready'
  | 'push_running'
  | 'pushed'
  | 'needs_human'
  | 'failed';
```

`GitCloseoutUiState` is derived, not stored. The stored source of truth is:

- `review_status.statusArtifact.sections`
- `task_run_commit_records`
- current git state from `GET /api/runs/:id/git/closeout`

## User-Visible Workflow

### 1. LLM 実装完了

LLM が final report を返し、runtime outcome が `needs_review` になる。

ユーザーに見える状態:

- Queue: review required / awaiting commit decision
- Workbench: Review Status artifact が開ける
- Review Status: `テスト証跡確認` が required として表示される

### 2. 必須レビュー

`テスト証跡確認` section を自動またはユーザー操作で実行する。

期待する section result:

- `done`: commit gate に進める
- `needs_human`: commit gate を止める
- `blocked`: commit gate を止める
- `not_started` / `running`: commit gate を止める

`not_found` / `unclear` の criteria がある場合でも、section 自体が `done` なら commit gate は開く。ただし改善 prompt suggestion は表示する。これは「受け入れ条件テスト証跡の確認を実行したか」を必須 gate にし、「追加テストを書くかどうか」を commit 前の強制条件にしないためである。

### 3. Commit Ready

必須レビューが完了し、`task_run_commit_records.status === 'ready'` なら commit ボタンを有効化する。

UI では次を表示する。

- commit 対象 path 数
- 除外 path 数
- verification status
- commit 不可理由
- commit message preview

### 4. Commit

ユーザーが `Commit` を押す。

backend は対象 run の commit record を読み、`stageable_owned_paths_json` だけを stage する。commit 成功後、`commit_sha` と `commit_message` を保存する。

### 5. Push

commit 成功後に `Push` ボタンを有効化する。

push は upstream が確認できる場合だけ実行する。upstream がない場合は `needs_human` として理由を表示し、自動で remote / branch を決めない。

## Backend Changes

### Phase 1: Review Mode Auto Start

Files:

- `api/modules/nightworkers/run-orchestration/runtime-execution.ts`
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `tests/services.run-control.test.ts`
- `tests/review-mode.test.ts`

Implementation:

1. `runtime-execution.ts` の successful closeout path で、`guardedStatus === 'needs_review'` の場合に Review session を作る。
2. 既存の `safelyCreateReviewRecommendation` と同じく、Review session 作成失敗は run outcome を壊さない。
3. session 作成後、初期実装では `test_coverage` section を自動実行する。
4. section 実行が失敗した場合は、Review session と `review_status` を残し、`test_coverage` artifact を `needs_human` として upsert する。
5. `review_status.finalActionGate.requiredSectionKindsRemaining` に `test_coverage` を残す。
6. run event を追加する。session 作成前に失敗した場合は artifact を作れないため、run event と log だけを残す。

Use these event types:

```ts
type ReviewAutoCloseoutEvent =
  | 'review.session_auto_started'
  | 'review.required_section_auto_started'
  | 'review.required_section_auto_failed';
```

Notes:

- `createRunEvent` の type が自由文字列である前提で、上記 event type をそのまま保存する。
- frontend lazy create は残す。すでに session がある場合は既存 session を使う。

Phase 1 done when:

- `needs_review` closeout creates exactly one Review session for the run.
- Re-running closeout or pressing the existing Review button reuses the same session.
- A failure in auto-running `test_coverage` leaves a visible `needs_human` section state instead of hiding the failure.
- Evidence is stored in `review_artifacts`, `review_sessions`, and run events.

Phase 1 tests:

```bash
bun run test run tests/review-mode.test.ts
bun run test run tests/services.run-control.test.ts
```

### Phase 2: Required Section Policy

Files:

- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
- `src/modules/nightworkers/types/review.ts`
- `tests/review-mode.test.ts`
- `tests/review-status-viewer.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`

Implementation:

1. `planSections(recommendation)` を変更する。

```ts
test_coverage:
  recommendation.level === 'none' ? 'omitted' : 'required'

security_review:
  recommendation.level === 'none' ? 'omitted' : 'optional'

findings:
  recommendation.level === 'none' ? 'omitted' : 'optional'

prompt_suggestions:
  recommendation.level === 'none' ? 'omitted' : 'optional'
```

2. `buildStatusArtifact` の final gate を `required` section に限定する。
3. unresolved blocking finding の扱いを source section で分ける。
   - `test_coverage` 由来かつ required section の unresolved blocking は gate 対象。
   - optional section 由来は gate 対象外。
4. UI copy は「Required review sections」ではなく「Required test evidence review」に寄せる。
5. `reviewStatusArtifactSchema.finalActionGate` の意味を更新し、`requiredSectionKindsRemaining` が `test_coverage` だけを返すことを test fixture で固定する。
6. `ReviewStatusViewer` は section group の `required` / `optional` 表示をそのまま使い、optional 未実行時の warning copy を commit block と誤読させない。

Phase 2 done when:

- `test_coverage` だけが required。
- optional section の `not_started` は `finalActionGate.canApprove` を false にしない。
- `test_coverage` が `needs_human` のときだけ required remaining に残る。
- Evidence is stored in `review_status` artifact JSON and covered by Review Mode tests.

Phase 2 tests:

```bash
bun run test run tests/review-mode.test.ts
bun run test run tests/review-status-viewer.test.tsx
bun run test run tests/nightworkers.workbench-selectors.test.ts
```

### Phase 3: Queue Status Closeout

Files:

- `api/modules/queue/queue.repository.ts`
- `api/modules/queue/queue-management.service.ts`
- `src/modules/queue/projectQueueModel.ts`
- `src/modules/queue/ProjectQueueTaskCard.tsx`
- `src/modules/queue/ProjectQueueTable.tsx`
- `tests/project-queue-model.test.ts`
- `tests/implementation-queue-resilience.test.ts`

Implementation:

1. `queueStatusForRunStatus('needs_review')` を `awaiting_commit_decision` にする。
2. `awaiting_commit_decision` は processor occupied のまま維持する。
3. Queue UI では `review_required` として表示する。
4. `execution_completed` は「review / commit closeout 後に archive 可能な terminal」として残す。
5. commit 成功時に queue entry を `execution_completed` へ進めるかは、commit API 側で明示する。

Initial rule:

- run `needs_review` -> queue `awaiting_commit_decision`
- commit success -> queue `execution_completed`
- push success -> queue status は変えない

理由:

- push は remote 同期であり、実装受け入れの必須条件ではない。
- commit が local closeout の区切り。

Phase 3 done when:

- queue reconciliation does not classify terminal `needs_review` runs as failed.
- `awaiting_commit_decision` continues to occupy a processor slot.
- Queue card/table opens `artifact=review_status` for closeout instead of running commit directly.
- Evidence is visible through queue state and run detail.

Phase 3 tests:

```bash
bun run test run tests/project-queue-model.test.ts
bun run test run tests/implementation-queue-resilience.test.ts
```

### Phase 4: Git Closeout Backend API

Files:

- `api/modules/nightworkers/nightworkers.git-closeout.service.ts` new
- `api/modules/nightworkers/routes/run-routes.ts`
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.runs.repository.ts`
- `shared/schemas/nightworkers/run.schema.ts`
- `api/db/bootstrap.ts`
- `api/db/schema.ts`
- `tests/nightworkers-git-closeout.test.ts` new

Routes:

```http
GET /api/runs/:id/git/closeout
POST /api/runs/:id/git/commit
POST /api/runs/:id/git/push
```

`GET /git/closeout` response:

```ts
type GitCloseoutState = {
  runId: string;
  repositoryId: string;
  canCommit: boolean;
  canPush: boolean;
  state: GitCloseoutUiState;
  blockingCode: GitCloseoutBlockingCode | null;
  blockingReason: string | null;
  commitRecord: TaskRunCommitRecord | null;
  requiredReview: {
    reviewSessionId: string | null;
    testCoverageStatus: 'not_started' | 'running' | 'done' | 'blocked' | 'needs_human' | null;
    complete: boolean;
  };
  git: {
    head: string | null;
    branch: string | null;
    upstream: string | null;
    dirtyPaths: string[];
    stagedPaths: string[];
  };
  counts: {
    stageablePaths: number;
    excludedPaths: number;
  };
};
```

`POST /git/commit` request:

```ts
type CommitRunRequest = {
  message?: string;
};
```

Commit default message:

```text
Implement <task title>
```

If the title is missing:

```text
Complete NightWorkers run <short run id>
```

Commit preconditions are checked in this order:

1. run exists.
2. repository exists and has `localPath`.
3. Review session exists for the run.
4. required `test_coverage` section is `done`.
5. `task_run_commit_records.status === 'ready'`.
6. `stageable_owned_paths_json.length > 0`.
7. current `HEAD` equals `baseline_head`, unless `baseline_head` is null for an unborn repository.
8. dirty paths include the stageable owned paths.
9. excluded paths remain excluded.
10. current staged paths are empty.

Commit execution:

1. `git reset` must not be used.
2. Use `execFile`, not shell strings.
3. Inspect current staged paths before staging:

```ts
execFile('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot })
```

4. Abort with `STAGED_PATHS_OUTSIDE_OWNERSHIP` if any path is already staged. Initial implementation does not try to preserve or merge pre-staged content.
5. Stage paths with:

```ts
execFile('git', ['add', '--', ...stageablePaths], { cwd: repoRoot })
```

6. Inspect staged paths after staging:

```ts
execFile('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot })
```

7. Abort with `STAGED_PATHS_OUTSIDE_OWNERSHIP` if staged paths include any path not in `stageable_owned_paths_json`.
8. Commit:

```ts
execFile('git', ['commit', '-m', message], { cwd: repoRoot })
```

9. Read commit SHA:

```ts
execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
```

10. Update `task_run_commit_records`:
   - `status = 'committed'`
   - `commit_sha`
   - `commit_message`
   - `status_reason = 'Committed runtime-owned paths.'`
   - `push_status = 'not_pushed'`

11. Create run event.
12. Move queue entry to `execution_completed`.

Failure behavior:

- Do not replace LLM output with a fixed success message.
- Save `status = 'failed'` only when commit execution failed after passing preconditions.
- Do not mutate `task_run_commit_records.status` for missing Review session or required review not done; return `REVIEW_SESSION_MISSING` or `REQUIRED_REVIEW_NOT_DONE` so the same record can become commit-ready after review work completes.
- Save `status = 'needs_human'` only when git ownership is unsafe or cannot be repaired by completing Review Mode: `HEAD_MOVED`, `NO_STAGEABLE_PATHS`, `DIRTY_PATHS_MISSING`, or pre-existing dirty path overlap.
- Return structured blocking reason to UI.

`POST /git/push` request has no body in the initial implementation.

Push preconditions:

1. commit record exists.
2. `commitRecord.status === 'committed'`.
3. `commit_sha` equals current `HEAD`.
4. upstream exists.
5. repository safety policy does not block push.

Initial push rule:

- Prefer existing upstream:

```ts
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git push
```

- If no upstream exists, return `UPSTREAM_MISSING` and keep button disabled.
- On success, update `task_run_commit_records`:
  - `push_status = 'pushed'`
  - `pushed_at`
  - `push_remote`
  - `push_branch`
  - `status_reason = 'Pushed committed run closeout.'`
- On failure, keep `status = 'committed'`, set `push_status = 'failed'`, and store the failure summary in `status_reason`.

Phase 4 done when:

- `GET /git/closeout` returns one deterministic state object for Review Status UI.
- `POST /git/commit` commits only owned stageable paths.
- `POST /git/push` only uses existing upstream.
- commit and push outcomes survive page reload through `task_run_commit_records`.
- Evidence is stored in `task_run_commit_records` and run events.

Phase 4 tests:

```bash
bun run test run tests/nightworkers-git-closeout.test.ts
```

## Frontend Changes

### Phase 5: Review Status Commit Panel

Files:

- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/modules/nightworkers/hooks/useNightWorkersMutations.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/types/review.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/review-status-viewer.test.tsx`

UI placement:

- Add a compact `Commit Closeout` panel near the Review Status header, below the recommendation badge.
- Do not put it inside another card if the surrounding section is already framed.
- Use icon buttons with text for clear commands:
  - `GitCommit` icon + `Commit`
  - `Upload` icon + `Push`
  - `RefreshCw` icon + refresh state

Panel states:

1. `Review required`
   - test evidence required section is not done.
   - Commit disabled.
2. `Commit ready`
   - required section done.
   - commit record ready.
   - Commit enabled.
3. `Committed`
   - commit SHA visible.
   - Push enabled if upstream exists.
4. `Push unavailable`
   - no upstream or policy block.
   - Push disabled with reason.
5. `Needs human`
   - owned paths overlap pre-existing dirty paths, HEAD moved, or no stageable paths.

Visible fields:

- Required review status
- Commit ownership status
- Stageable paths count
- Excluded paths count
- Verification status
- Commit SHA after commit
- Push status after push

Frontend command contract:

```ts
fetchGitCloseout(runId): Promise<GitCloseoutState>
commitRunCloseout(runId, { message?: string }): Promise<GitCloseoutState>
pushRunCloseout(runId): Promise<GitCloseoutState>
```

After each mutation, update the same query cache key:

```ts
['gitCloseout', runId]
```

Also invalidate:

- `['taskDetail', taskId]`
- `['reviewSession', taskId]`
- implementation queue query key

Phase 5 done when:

- Review Status renders the closeout panel from `GitCloseoutState`.
- Disabled buttons show the `blockingReason`.
- Commit mutation updates commit SHA without requiring a page reload.
- Push mutation updates push status without requiring a page reload.
- Evidence is visible in Review Status and reloads from API state.

Phase 5 tests:

```bash
bun run test run tests/review-status-viewer.test.tsx
```

### Phase 6: Queue Surface Shortcut

Files:

- `src/modules/queue/ProjectQueueTaskCard.tsx`
- `src/modules/queue/ProjectQueueTable.tsx`
- `src/modules/queue/projectQueueModel.ts`
- `tests/project-queue-model.test.ts`

Implementation:

- For `awaiting_commit_decision`, show `Review / Commit` action.
- The action opens the task workbench with `artifact=review_status`.
- The queue card should not run commit directly. Commit must happen inside Review Status where the required gate and owned paths are visible.

Phase 6 done when:

- Queue table and card expose the same `Review / Commit` navigation.
- No queue component directly calls commit or push APIs.
- Evidence is the route transition to `artifact=review_status`.

Phase 6 tests:

```bash
bun run test run tests/project-queue-model.test.ts
```

## Data Model Notes

Initial implementation reuses `task_run_commit_records` for commit result and extends it for push result.

Existing columns for commit:

- `commit_sha` already exists.
- `commit_message` already exists.
- `status_reason` already exists.

Required migration for push:

```sql
ALTER TABLE task_run_commit_records ADD COLUMN push_status text;
ALTER TABLE task_run_commit_records ADD COLUMN pushed_at integer;
ALTER TABLE task_run_commit_records ADD COLUMN push_remote text;
ALTER TABLE task_run_commit_records ADD COLUMN push_branch text;
```

Schema updates:

- `api/db/bootstrap.ts`
  - Use existing `ensureColumn(...)` pattern so existing SQLite databases receive the new columns at startup.
- `api/db/schema.ts`
- `shared/schemas/nightworkers/run.schema.ts`
- `src/modules/nightworkers/types/core.ts`

Push status values:

```ts
type CommitRecordPushStatus =
  | 'not_pushed'
  | 'pushing'
  | 'pushed'
  | 'failed'
  | 'blocked';
```

Migration compatibility:

- Existing rows with null `push_status` are treated as `not_pushed` when `status === 'committed'`.
- Existing rows with null `push_status` are treated as `blocked` when `status !== 'committed'`.

## Security And Safety Constraints

- Do not execute `git commit` or `git push` through generic worker `run_command`.
- Do not use shell strings for commit / push.
- Do not stage the full worktree.
- Do not use `git add -A` without pathspec.
- Do not use `git reset --hard`, `git checkout --`, or `git clean`.
- Do not auto-create remote branches in the initial implementation.
- Do not push before commit SHA is saved.
- Do not push if current `HEAD` no longer matches the saved commit SHA.
- Do not hide excluded paths; show them as the reason commit cannot include everything.

## Acceptance Criteria

1. When an implementation run finishes with runtime outcome `needs_review`, a Review session is automatically created for that run.
2. The Review Status artifact appears without requiring the user to manually start Review Mode.
3. `test_coverage` is the only required section for implementation closeout.
4. `security_review`, `findings`, and `prompt_suggestions` are optional or omitted and do not block commit when unrun.
5. The required `test_coverage` section is run automatically after Review session creation, or clearly shown as the single required action if auto-run fails.
6. Commit button is disabled until required test evidence review is complete.
7. Commit button is disabled when `task_run_commit_records.status` is not `ready`.
8. Commit stages only `stageable_owned_paths_json`.
9. Commit aborts if staged paths include paths outside `stageable_owned_paths_json`.
10. Commit success saves `commit_sha` and `commit_message`.
11. Commit success moves the queue entry from `awaiting_commit_decision` to `execution_completed`.
12. Push button is disabled until commit success.
13. Push succeeds only when current `HEAD` matches the saved `commit_sha`.
14. Push without upstream returns a clear `UPSTREAM_MISSING` blocking reason.
15. Queue card/table can open the Review Status closeout view for `awaiting_commit_decision` entries.
16. Push status survives page reload through `task_run_commit_records`.
17. Every commit / push API response returns a refreshed `GitCloseoutState`.

## Verification Plan

Each implementation phase must leave evidence in one of these places before moving to the next phase:

| Phase | Required evidence |
| --- | --- |
| Phase 1 | `review_sessions`, `review_artifacts`, run event |
| Phase 2 | `review_status` artifact JSON and Review Mode tests |
| Phase 3 | queue entry status and queue tests |
| Phase 4 | `task_run_commit_records`, run event, git closeout tests |
| Phase 5 | `ReviewStatusViewer` test and visible closeout state |
| Phase 6 | queue UI test and `artifact=review_status` route |

Targeted tests:

```bash
bun run test run tests/review-mode.test.ts
bun run test run tests/review-status-viewer.test.tsx
bun run test run tests/project-queue-model.test.ts
bun run test run tests/implementation-queue-resilience.test.ts
bun run test run tests/nightworkers-git-closeout.test.ts
```

Full gate:

```bash
bun run verify
```

Manual smoke:

1. Create an implementation queue task with acceptance criteria.
2. Let the run complete.
3. Confirm the task is in Review / Commit state.
4. Open Review Status.
5. Confirm `テスト証跡確認` is required and other sections are optional.
6. Confirm commit button is disabled until test evidence section is done.
7. Commit.
8. Confirm commit SHA appears.
9. Push in a repo with upstream.
10. Confirm push result is visible.
11. Reload the app.
12. Confirm commit SHA and push status still render.

## Rollback / Mitigation

If Review session auto-generation causes runtime closeout instability:

- Keep runtime outcome as `needs_review`.
- Disable auto-running `test_coverage`.
- Continue creating only the Review session and `review_status`.

If commit API is too strict:

- Keep commit button disabled with `needs_human`.
- Do not fall back to full-tree commit.
- Let the user use manual git outside the closeout UI.

If push behavior is ambiguous:

- Keep push disabled unless upstream is known.
- Commit remains the local closeout boundary.

## Non-Goals

- No automatic commit immediately after LLM final report.
- No full-worktree commit.
- No PR creation.
- No branch creation.
- No automatic remote selection.
- No mandatory security scan.
- No mandatory findings consolidation.
- No mandatory prompt suggestion execution.
- No broad rework of Review Mode UI.
- No replacement of existing `task_run_commit_records`.
