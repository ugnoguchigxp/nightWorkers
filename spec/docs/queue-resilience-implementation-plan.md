# Implementation Queue Resilience 実装計画

## Purpose

NightWorkers の Implementation Queue を、単一 API process 前提の process-local drain から、SQLite 台帳を正本にした復旧可能な実行レーンへ強化する。

この計画の中心は「Queue の状態を信用できるようにする」ことである。Review UI や PR 連携を改善する前に、queue entry、run、task status、processor slot、heartbeat、完了処理の対応関係を台帳から説明できる状態にする。

## Review Findings

このドキュメントは方向性として実装に進める。ただし、元のままだと次の点で実装者の判断に委ねる余地が残っていたため、この版で補強する。

- `tests/nightworkers-queue` や `src/modules/nightworkers/nightWorkersCommands.ts` など、現行コードとずれているパスがあった。新規 test file を作る場合は `tests/implementation-queue-resilience.test.ts`、既存 route/service 回帰は `tests/nightworkers-workbench-routes/routes-workbench-03.test.ts` と `tests/nightworkers-service/services-nightworkers-02.test.ts` を使う。
- 既存 Queue status には `awaiting_commit_decision` と `execution_archived` があるため、status model と terminal / occupied 判定に明示する必要がある。
- DB lease の compare-and-set 条件、`claimed -> processing` の更新条件、completion reconciliation の no-op 条件が不足していた。
- `api/db/schema.ts` だけでなく、runtime bootstrap の `api/db/bootstrap.ts` と Drizzle migration の両方を更新する必要がある。
- Queue Health API を追加するだけでは UI が更新されないため、`src/modules/queue/queueCommands.ts`, `src/modules/queue/useImplementationQueue.ts`, `src/modules/queue/ImplementationQueueScreen.tsx` まで接続する。
- 復旧の evidence は抽象的にせず、最低限 `task_messages.payload_json` と `task_events` または `activity_events` のどちらに残すかを実装 phase で決める。

## Confirmed Baseline

現状の実装には次の土台がある。

- `implementation_queue_entries` は `status`, `processor_slot`, `active_run_id`, `claimed_at`, `last_heartbeat_at`, `archived_at`, `status_reason` を持つ。定義は `api/db/schema.ts` と `api/db/bootstrap.ts` の両方にある。
- `claimNextImplementationQueueEntry(processorCount)` は、現在の occupied entries を見て processor slot を選び、`queued` の entry を `claimed` に更新する。
- `runImplementationQueue()` は process-local な `implementationQueueDrainPromise` で同一 API process 内の二重 drain を避ける。
- `drainImplementationQueue()` は claim 後に `startTaskRun(...)` を呼び、成功したら entry を `processing` にして `activeRunId` を保存する。
- `completeImplementationQueueEntryForRun(runId, status)` は run 完了後に queue entry を `execution_completed`, `cancelled`, `needs_human`, `failed` へ更新する。
- Queue route は `api/modules/queue/queue.routes.ts` と `api/modules/queue/queue-route-definitions.ts` にあり、互換 export として `api/modules/nightworkers/nightworkers.queue-management.service.ts` / `nightworkers.queue.repository.ts` が残っている。
- UI は `src/modules/queue/ImplementationQueueScreen.tsx`、API client は `src/modules/queue/queueCommands.ts`、query hook は `src/modules/queue/useImplementationQueue.ts` が入口である。

現状の弱点:

- `claimed_at` / `last_heartbeat_at` はあるが、lease owner、lease expiry、recovery attempt、recovered reason がない。
- API process が `claimed` または `processing` の途中で落ちた場合、どの条件で再キューするかが明確ではない。
- run が terminal になった後の queue bookkeeping は best-effort で、失敗しても run outcome を変えない。そのため queue entry 側に不整合が残り得る。
- Queue Health を運用目線で見る dedicated surface がない。

## Implementation Invariants

実装中に守る不変条件:

- Queue 実行権の正本は DB lease とし、process-local drain promise は同一 process 内の重複起動抑制にだけ使う。
- `claimed -> processing` は `entry.id`, `status = 'claimed'`, `lease_version`, `lease_owner_id` が一致した場合だけ成功する。
- `processing -> terminal queue status` は `active_run_id = runId` かつ queue entry が terminal でない場合だけ成功する。
- terminal queue status は `execution_completed`, `failed`, `cancelled`, `needs_human`, `execution_archived` として扱う。ただし `execution_archived` は active list から外す。
- `awaiting_commit_decision` は processor slot を占有する active status として維持する。初期実装では自動 recovery の対象にしない。
- downstream mutation のうち、run terminal update、task status update、queue entry terminal update の成功/失敗を health から説明できるようにする。未確認 mutation が残る場合は completed 扱いにしない。
- 自動 retry は「active run が存在しない」または「active run が terminal」のときだけ許可する。running か不明な run は `needs_human` に寄せる。
- Queue bookkeeping failure は run outcome を巻き戻さない。ただし `terminal_run_missing_queue_completion` として検出可能にする。

## Scope

In scope:

- Queue lease の durable 化。
- stale claim / stale processing の検出と復旧。
- queue entry 完了処理の idempotent 化。
- queue / run / task status の reconciliation。
- Queue Health API と最小 UI。
- 復旧・不整合・手動操作の run evidence 化。
- focused tests と repo-native verify gate。

Out of scope:

- 初期実装で別 OS process の worker daemon を作ること。
- parallel multi-agent proposal workflow。
- PR 作成、merge、deploy。
- Review UI の全面改修。
- provider failure classification 全体の再設計。
- distributed lock 用の外部 service 導入。

## Target Behavior

### Queue runtime behavior

- queue entry の実行権は DB lease が正本になる。
- 同じ queue entry を複数 processor が同時に `processing` にできない。
- API process が落ちても、期限切れ lease は startup / interval reconciler が検出できる。
- stale entry は、条件に応じて `queued` に戻すか `needs_human` に落とす。
- run が terminal なら、queue entry は再実行されず、terminal run status に合わせて idempotent に完了処理される。
- downstream mutation が確認できない状態では、queue entry を completed 扱いにしない。

### User-visible behavior

- Implementation Queue で、normal / stale / retryable / needs_human / orphaned の件数が分かる。
- stale entry には、最後の heartbeat、lease owner、active run、推奨 action が表示される。
- 手動操作は最小限にする。
  - `retry`
  - `mark needs_human`
  - `cancel`
  - `archive`
- 復旧操作は task message / run event / queue event 相当の evidence に残る。

## Data Model

既存列を活かしつつ、次の列を `implementation_queue_entries` に追加する。

```ts
type ImplementationQueueLeaseFields = {
  leaseOwnerId: string | null;
  leaseAcquiredAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  attemptCount: number;
  recoveredAt: Date | null;
  recoveryReason: string | null;
  lastFailureKind: string | null;
};
```

Notes:

- `claimed_at` は互換表示用に残す。新しい lease 判定は `lease_acquired_at` / `lease_expires_at` を正本にする。
- `last_heartbeat_at` は維持し、processing 中の liveness 判定に使う。
- `processor_slot` は UI 表示と capacity 計算に残す。
- `lease_version` は compare-and-set 更新と idempotent completion の衝突検出に使う。
- `attempt_count` は retry 上限と user-visible history に使う。
- 新規 column は `api/db/schema.ts`, `api/db/bootstrap.ts`, Drizzle migration の 3 箇所で揃える。
- 既存 DB には `ALTER TABLE` で追加する。`lease_version` と `attempt_count` は `DEFAULT 0 NOT NULL`、その他は nullable にする。
- `api/db/bootstrap.ts` は fresh DB 作成だけでなく既存 DB の column 追加も担うため、`PRAGMA table_info(implementation_queue_entries)` で不足 column を検出して追加する。
- date column は既存の `claimed_at` / `last_heartbeat_at` と同じ `integer(..., { mode: 'timestamp' })` / millisecond timestamp 方針に合わせる。

追加 index:

```sql
CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_expiry_idx
  ON implementation_queue_entries (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS implementation_queue_entries_active_run_idx
  ON implementation_queue_entries (active_run_id);

CREATE INDEX IF NOT EXISTS implementation_queue_entries_lease_owner_idx
  ON implementation_queue_entries (lease_owner_id, lease_expires_at);
```

## Status Model

既存 status を基本維持する。

```text
queued
  -> claimed
  -> processing
  -> execution_completed
  -> awaiting_commit_decision
  -> execution_archived

queued / claimed / processing
  -> needs_human
  -> failed
  -> cancelled
```

追加する分類は status ではなく、`status_reason`, `last_failure_kind`, `recovery_reason` に寄せる。

Status groups:

- Active for list / duplicate prevention: `queued`, `claimed`, `processing`, `needs_human`, `awaiting_commit_decision`, `execution_completed`, `failed`, `cancelled`
- Occupies processor slot: `claimed`, `processing`, `needs_human`, `awaiting_commit_decision`
- Terminal for run completion reconciliation: `execution_completed`, `failed`, `cancelled`, `needs_human`
- Archived / inactive: `execution_archived`

`needs_human` は run completion reconciliation 上は terminal だが、Queue 上は人手対応まで processor slot を占有する active entry として扱う。`execution_completed`, `failed`, `cancelled` も archive までは dashboard の completed list に残るため、duplicate prevention の対象に含める。

Completion status mapping:

| run status | queue status |
| --- | --- |
| `completed` | `execution_completed` |
| `cancelled` | `cancelled` |
| `needs_human` | `needs_human` |
| otherwise terminal failure | `failed` |

例:

- `lease_expired_before_run_start`
- `heartbeat_stale_processing`
- `terminal_run_missing_queue_completion`
- `active_run_not_found`
- `start_task_run_failed`
- `manual_retry`
- `manual_needs_human`

Status を増やしすぎると既存 UI と routes の互換影響が大きいため、初期実装では health classification を read model で計算する。

## Implementation Plan

### First Implementation Slice

最初の実装単位は Phase 0 + Phase 1 までに絞る。ここまでで behavior change は claim の lease 化だけに限定し、reconciler / UI は入れない。

実装順:

1. `tests/implementation-queue-resilience.test.ts` を作り、現行 `claimNextImplementationQueueEntry` の二重 claim 防止と occupied capacity を固定する。
2. `api/db/schema.ts`, `api/db/bootstrap.ts`, `drizzle/migrations/*_implementation_queue_lease.sql` に lease fields を追加する。
3. `api/modules/queue/queue-route-definitions.ts` の `implementationQueueEntrySchema` に lease fields を optional で追加し、既存 dashboard response の互換を保つ。
4. `api/modules/queue/queue.repository.ts` の `updateImplementationQueueEntry` input と `claimNextImplementationQueueEntry(input)` を更新する。
5. `api/modules/nightworkers/nightworkers.run-orchestration.service.ts` の call site を `leaseOwnerId` / `leaseTtlMs` 付きに変える。`leaseOwnerId` は初期実装では `api-process:${process.pid}` 相当の process-local owner でよい。
6. focused tests を通してから Phase 2 に進む。

この slice でやらないこと:

- startup reconciler の自動起動。
- Health UI。
- manual recover endpoint。
- `awaiting_commit_decision` の自動復旧。

### Phase 0. Baseline and Fixtures

目的:

変更前の Queue 状態を比較可能にする。

Files:

- `api/modules/queue/queue.repository.ts`
- `api/modules/queue/queue-management.service.ts`
- `tests/implementation-queue-resilience.test.ts` を新規追加
- 既存 service side-effect 回帰は `tests/services.queue-management.test.ts`

実装:

1. Queue health snapshot helper を追加する。
   - total queued
   - claimed
   - processing
   - awaiting commit decision
   - stale claimed
   - stale processing
   - active run missing
   - terminal run with active queue entry
2. SQLite fixture で次の状態を作れるようにする。
   - normal queued
   - claimed but expired
   - processing but heartbeat stale
   - processing with terminal run
   - activeRunId が存在しない orphaned entry
3. この phase では read model だけを追加し、既存 route response は変更しない。
4. helper は `now`, `leaseTtlMs`, `staleProcessingMs`, `maxAttempts` を引数に取り、test で時刻を固定できるようにする。

Gate:

```bash
bunx vitest run tests/implementation-queue-resilience.test.ts tests/services.queue-management.test.ts
```

この phase では挙動を変えない。観測 helper と fixture だけを入れる。

### Phase 1. Durable Lease Claim

目的:

`queued -> claimed` を DB lease 取得として扱い、同一 queue entry の二重 claim を防ぐ。

Files:

- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- `drizzle/migrations/*_implementation_queue_lease.sql`
- `api/modules/queue/queue.repository.ts`

実装:

1. lease columns と indexes を追加する。
2. `claimNextImplementationQueueEntry(...)` を `claimNextImplementationQueueEntry(input)` に拡張する。
   - `processorCount`
   - `leaseOwnerId`
   - `leaseTtlMs`
   - `now`
   - `allowExpiredClaimRecovery`
3. claim update は次の条件を満たす場合だけ成功させる。
   - `status = 'queued'`
   - または recovery が許可された stale `claimed`
   - selected candidate の id と現在 status が一致する
   - candidate が stale `claimed` の場合は `lease_expires_at < now` かつ `active_run_id is null`
4. claim 成功時に次を更新する。
   - `status = 'claimed'`
   - `lease_owner_id`
   - `lease_acquired_at`
   - `lease_expires_at`
   - `lease_version = lease_version + 1`
   - `attempt_count = attempt_count + 1`
   - `claimed_at`
   - `last_heartbeat_at`
   - `processor_slot`
   - stale recovery claim の場合は `recovered_at`, `recovery_reason = 'lease_expired_before_run_start'`
5. processor slot は occupied entries から選ぶが、expired `claimed` を recovery 対象にする場合は occupied から除外する。
6. repository 関数は update 後の row count / returned row を確認し、CAS に負けた場合は `null` を返す。

Tests:

- 2 つの claim attempt が同じ entry を同時に取れない。
- processor capacity を超えて claim しない。
- lease が有効な `claimed` entry は再 claim しない。
- expired lease は recovery policy が許可した場合だけ再 claim できる。
- `attempt_count` と `lease_version` が claim ごとに増える。

Gate:

```bash
bunx vitest run tests/implementation-queue-resilience.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### Phase 2. Processing Heartbeat and Startup Recovery

目的:

API process crash / worker interruption 後に stale entry を検出し、明示的に復旧する。

Files:

- `api/modules/queue/queue.repository.ts`
- `api/modules/queue/queue-management.service.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/runtime/bootstrap.ts` または現在 queue drain runner を登録している bootstrap boundary

実装:

1. `refreshImplementationQueueLease(entryId, leaseVersion, ttl)` を追加する。
   - update 条件は `id`, `lease_version`, `lease_owner_id`, active status。
   - `last_heartbeat_at` と `lease_expires_at` を同時に延長する。
2. `startTaskRun` 成功後、`claimed -> processing` 更新時に `lease_version` と `lease_owner_id` を条件に含める。
   - 更新に失敗した場合は queue entry を成功扱いにせず、作成済み run は `needs_human` または diagnostic event へ寄せる。
3. processing 中の heartbeat 更新を run lifecycle event に合わせて行う。
   - run start
   - major runtime event
   - run finalization
   - long-running worker でイベント間隔が長い場合は interval heartbeat も許可する
4. `reconcileImplementationQueue(options)` を追加する。
   - startup 時に 1 回実行
   - interval で任意実行できる service にする
   - tests では auto run を無効化できる
   - `dryRun` / `apply` を分け、Health API は dry-run snapshot を使えるようにする
5. stale 判定:
   - `claimed` かつ `lease_expires_at < now` で `active_run_id is null`
     - retryable なら `queued`
     - retry 上限なら `needs_human`
   - `processing` かつ `last_heartbeat_at < now - staleProcessingMs`
     - active run が terminal なら Phase 3 の completion reconciliation へ渡す
     - active run が running のままなら `needs_human`
     - active run が存在しなければ `queued` または `needs_human`
   - `awaiting_commit_decision` は自動 recovery しない
6. recovery は必ず evidence を残す。
   - queue entry に紐づく `task_messages.payload_json.source = 'implementation_queue'`
   - run が存在する場合は `task_events` または `activity_events` に recovery event
   - queue entry の `recovered_at`, `recovery_reason`, `last_failure_kind`, `status_reason`

Tests:

- expired `claimed` entry が `queued` に戻る。
- retry 上限を超えた stale entry は `needs_human` になる。
- missing active run は recovery reason 付きで分類される。
- startup reconciler は正常な queued / processing entry を壊さない。
- `awaiting_commit_decision` は reconciler で変更されない。

Gate:

```bash
bunx vitest run tests/implementation-queue-resilience.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### Phase 3. Idempotent Completion Reconciliation

目的:

run terminal state と queue entry state の不整合を再実行安全に閉じる。

Files:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/modules/queue/queue.repository.ts`
- `api/modules/queue/queue-management.service.ts`

実装:

1. `completeImplementationQueueEntryForRun(runId, status)` を idempotent service に寄せ、repository に CAS 更新関数を追加する。
2. 更新条件に `active_run_id = runId` と terminal でない queue status を含める。
   - non-terminal 対象: `claimed`, `processing`, `awaiting_commit_decision`
   - `queued` に active run がある場合は anomalous として health に出し、completion 対象にはしない
3. 既に terminal queue status の場合は no-op とし、必要なら diagnostic event だけ残す。
   - `execution_completed`, `failed`, `cancelled`, `needs_human`, `execution_archived` は terminal / no-op
4. run が terminal なのに queue entry が `claimed` / `processing` の場合、reconciler が completion service を呼べるようにする。
5. completion の順序を明文化する。
   - run terminal update
   - task status update
   - queue entry terminal update
   - next queue drain trigger
6. queue entry terminal update 後、`processor_slot`, `lease_owner_id`, `lease_expires_at` を clear する。`lease_version` は increment して衝突を可視化する。
7. queue bookkeeping failure は run outcome を巻き戻さない。ただし health snapshot で `terminal_run_missing_queue_completion` として検出できるようにする。

Tests:

- `completeImplementationQueueEntryForRun` を 2 回呼んでも重複副作用が起きない。
- completed run に紐づく processing entry が `execution_completed` になる。
- failed run に紐づく processing entry が `failed` になる。
- cancelled / needs_human が適切に保存される。
- queue entry が terminal 済みなら no-op。
- terminal update 後に processor slot と lease fields が解放される。

Gate:

```bash
bunx vitest run tests/implementation-queue-resilience.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### Phase 4. Queue Health API

目的:

運用判断に必要な Queue 状態を UI と tests から読めるようにする。

Files:

- `api/modules/queue/queue-route-definitions.ts`
- `api/modules/queue/queue.routes.ts`
- `api/modules/queue/queue-management.service.ts`
- `api/modules/queue/queue.repository.ts`
- `shared/schemas/nightworkers.schema.ts` または queue 専用 schema

API:

```text
GET /api/implementation-queue/health
POST /api/implementation-queue/entries/:id/recover
```

既存の `POST /api/implementation-queue/entries/:id/requeue` は残す。新しい `recover` は stale / orphaned entry への domain action を集約し、既存 `requeue` は completed / stopped entry の再投入互換 API として扱う。

Health response:

```ts
type ImplementationQueueHealth = {
  generatedAt: string;
  counts: {
    queued: number;
    claimed: number;
    processing: number;
    stale: number;
    retryable: number;
    needsHuman: number;
    orphaned: number;
    pendingCompletion: number;
  };
  items: Array<{
    entryId: string;
    taskId: string;
    runId: string | null;
    status: string;
    classification:
      | 'normal'
      | 'stale_claim'
      | 'stale_processing'
      | 'terminal_run_pending_completion'
      | 'orphaned_active_run'
      | 'needs_human'
      | 'failed';
    processorSlot: number | null;
    leaseOwnerId: string | null;
    leaseExpiresAt: string | null;
    lastHeartbeatAt: string | null;
    attemptCount: number;
    recoveryReason: string | null;
    statusReason: string | null;
    recommendedAction: 'none' | 'retry' | 'complete' | 'mark_needs_human' | 'archive';
  }>;
};
```

Manual recover actions:

- `retry`
- `mark_needs_human`
- `cancel`
- `archive`
- `complete`

Rules:

- Manual `retry` は active run が terminal または存在しない場合だけ許可する。
- running の可能性がある entry は自動 retry しない。
- manual action は task message と queue evidence に残す。
- `complete` は terminal run が確認でき、queue entry が non-terminal の場合だけ許可する。
- `archive` は terminal queue status の場合だけ許可する。
- unsafe action は `AppError(409, ...)` で返す。

Tests:

- health API が fixture state を正しく分類する。
- unsafe retry は 409 または domain error になる。
- manual action が status と evidence を更新する。
- route schema が lease fields / health counts を返す。

Gate:

```bash
bunx vitest run tests/nightworkers-workbench-routes/routes-workbench-03.test.ts tests/implementation-queue-resilience.test.ts
```

### Phase 5. Queue Health UI

目的:

Implementation Queue 画面で、異常検知と手動復旧に必要な最小情報を出す。

Files:

- `src/modules/queue/ImplementationQueueScreen.tsx`
- `src/modules/queue/queueCommands.ts`
- `src/modules/queue/useImplementationQueue.ts`
- `src/modules/nightworkers/types.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

UI:

- Queue Health summary band
  - stale
  - retryable
  - needs human
  - orphaned
- Problem entries table
  - task title
  - status
  - classification
  - last heartbeat
  - recommended action
  - action buttons
- Empty state
  - 問題がない場合は compact に表示し、通常 Queue 操作の邪魔をしない。

Constraints:

- 新しい大型 dashboard は作らない。
- Queue 操作と Review 操作を混ぜない。
- button action は confirmation を挟む。
- action 成功後は `implementationQueue` と新規 `implementationQueueHealth` query を invalidate する。
- `ProjectQueueScreen` など Queue dashboard を読む既存画面の型互換を壊さない。health はまず `ImplementationQueueScreen` だけで使う。
- 通常状態では summary band を 1 行に抑え、3 カラム Queue layout のスクロール領域を狭めすぎない。

Tests:

- stale item が表示される。
- normal state では summary が邪魔にならない。
- unsafe action は disabled または error 表示になる。
- action 成功後に refetch される。
- i18n key が ja/en の両方にある。

Gate:

```bash
bunx vitest run tests/implementation-queue-resilience.test.ts tests/project-queue-model.test.ts tests/nightworkers-workbench-routes/routes-workbench-03.test.ts
```

### Phase 6. Final Verification and Operational Drill

目的:

実装後に、実運用で起きる failure mode を通して検証する。

Drills:

1. Normal run
   - queue entry を作成し、通常完了まで進める。
   - health が normal / zero problem になる。
2. Stale claim
   - `claimed` かつ expired lease の fixture を作る。
   - reconciler で `queued` または `needs_human` になる。
3. Stale processing
   - `processing` かつ heartbeat stale の fixture を作る。
   - active run の状態に応じて completion または `needs_human` になる。
4. Idempotent completion
   - completion service を複数回呼ぶ。
   - queue entry と task message が重複しない。
5. Manual recovery
   - UI または API から retry / needs_human を実行する。
   - evidence が残る。

Final gate:

```bash
bun run verify:fast
bun run verify
git diff --check
```

## Acceptance Criteria

- DB lease が queue execution の正本になっている。
- 同一 queue entry の二重 processing を防ぐ focused test がある。
- expired claim と stale processing を分類できる。
- startup reconciler が stale entry を安全に復旧または `needs_human` に送れる。
- run terminal state と queue entry terminal state の reconciliation が idempotent である。
- Queue Health API が normal / stale / retryable / orphaned を返す。
- Implementation Queue UI で stale / retryable / needs_human / orphaned を確認できる。
- manual recovery action が evidence を残す。
- repo-native verify が通る。

## Risks

### Lease TTL が短すぎる

長い LLM call や slow test 中に false stale になる可能性がある。

Mitigation:

- 初期 TTL は十分長くする。
- processing stale 判定は `lease_expires_at` だけでなく `last_heartbeat_at` と run status を見る。
- running run が存在する場合は自動 retry せず `needs_human` に寄せる。

### Completion bookkeeping failure が隠れる

現在は queue bookkeeping failure が run outcome を変えない。これは維持するが、検出不能だと運用上危険になる。

Mitigation:

- health snapshot で terminal run / non-terminal queue entry を検出する。
- final report または queue health に degraded reason を出す。

### Status proliferation

status を増やしすぎると UI、API、tests の互換影響が大きい。

Mitigation:

- 初期実装では status を増やさず、classification read model と reason fields に寄せる。

### Manual retry の危険

実際には worker が生きている entry を user が retry すると二重実行になる。

Mitigation:

- active run が non-terminal の場合は retry を許可しない。
- running の可能性がある場合は `mark_needs_human` を推奨する。

## Review Checklist

- Queue の source of truth が process-local state ではなく DB lease になっているか。
- stale 判定が aggressive すぎないか。
- terminal run と queue entry の reconciliation が再実行安全か。
- manual recovery が evidence を残しているか。
- Queue Health UI が Review UI の責務を先取りしていないか。
- 既存 Queue の正常系 UX を重くしていないか。
