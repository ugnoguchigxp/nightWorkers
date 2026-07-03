# Implementation Queue Scheduling Lock and Commit Ownership Plan

## Purpose

Implementation Queue に、runtime lane とは独立した task scheduling type / 排他 lock と、Execution ごとの commit ownership 契約を追加する。

この計画の目的は、`codex-sdk` / `native-api-runner` の実行基盤を増やさずに、次の実行方針を Queue scheduler と closeout で扱えるようにすることである。

- `normal` task は原則並列実行できる。
- `exclusive` task は同一 repository 内で単独実行する。
- `sequence` task は `A -> B -> C` の順序を守り、同一 repository 内では排他扱いにする。
- `normal` 以外の task が ready になったら、同じ lock key の新規 `normal` claim を止め、既存 running task の drain 後に実行する。
- commit は各 Execution が自分の編集差分だけを対象にし、検証済みの owned diff だけを stage する。
- commit できない場合は、固定メッセージで成功扱いにせず、未 commit 理由と証跡を run に残す。
- PR / branch 作成は標準フローにしない。

`taskExecutionType` は task の scheduling 属性であり、runtime lane ではない。runtime lane は引き続き `api/services/agent-runtime/runtime-lane.ts` の `native-api-runner` / `codex-sdk` で決まる。

`commitOwnership` は closeout 属性であり、task scheduling type とは独立する。`normal` でも `exclusive` でも、commit 対象は自分の編集差分に限定する。

## Confirmed Baseline

現状の実装には次の土台がある。

- Runtime lane は `native-api-runner` / `codex-sdk` として解決され、`workerKind` は `native-local` / `codex-agent` に写像される。
- `implementation_queue_entries` は `task_id`, `repository_id`, `status`, `priority`, `queue_position`, `processor_slot`, `active_run_id`, lease fields を持つ。
- `claimNextImplementationQueueEntry(...)` は queue entry を `queued` から `claimed` にし、processor slot と lease を付与する。
- Queue dashboard schema は `api/modules/queue/queue-route-definitions.ts` の `implementationQueueEntrySchema` が入口である。
- `task_run_todos` には `depends_on` があるが、これは run 内 Todo の順序・依存を表すものであり、Implementation Queue task 間の scheduling 制約ではない。
- `jobType === 'data_migration'` の場合、run 内 Todo に migration gate を追加する処理は既にある。ただし Queue scheduling 上で migration を単独実行する制御はない。
- Runtime closeout は final report / diff / test results を run に残せるが、run 開始時の git baseline、owned path、commit result を独立した契約として永続化する仕組みはまだない。
- `todo_workflow_settings.ask_commit_on_completion` はあるが、「自分の編集だけを stage する」「pre-existing dirty file をどう扱うか」「unrelated failure 時に commit してよいか」の判定は実行時 prompt と人間判断に寄っている。

現状の弱点:

- migration / destructive change / large refactor が、通常 implementation task と同じ claim ルールで並列実行され得る。
- `A -> B -> C` のような task 間順序は、Queue scheduler の claim 条件として表現できない。
- runtime lane と排他制御を混ぜると、`codex-sdk exclusive lane` / `native-api exclusive lane` のような重複概念が発生する。
- `exclusive` が ready になっても `normal` が次々 claim されると、exclusive が starvation する。
- dirty worktree に対して複数 Execution が動く場合、commit 対象を path 単位で誤ると、他 Execution やユーザーの差分を混ぜた commit になる。
- pre-existing dirty file を Execution が編集した場合、path 単位 staging だけでは「元からあった変更」と「Execution が追加した変更」を分離できない。
- global verify が unrelated failure で落ちた場合、commit すべきか止めるべきかを run evidence から説明しづらい。

## Terms

### Runtime Lane

どの実行基盤で task run を動かすか。

```ts
type RuntimeLane = 'native-api-runner' | 'codex-sdk';
```

これは既存概念であり、この計画では増やさない。

### Task Execution Type

Queue scheduler が task をいつ claim してよいかを決める scheduling 属性。

```ts
type TaskExecutionType = 'normal' | 'exclusive' | 'sequence';
```

- `normal`: 同じ repository の他 `normal` と並列実行できる。
- `exclusive`: task 単体が危険なので、同じ lock key では単独実行する。
- `sequence`: 順序付き group の一部。個々の作業が常に危険とは限らないが、順序保証のため `normal` ではない task として排他扱いにする。

### Execution Lock

同時に claim してよい task を判定するための key。

初期実装では `executionLockKey` の default を `repository:${repositoryId}` にする。細かい `db_schema` / `shared_contract` などの scope enum は導入しない。必要になった場合だけ、後続で lock key の生成ルールを増やす。

### Queue Lock State Terms

Scheduling lock の判定では、queue status を次の意味で扱う。

```ts
type LockActiveStatus = 'claimed' | 'processing';
type ProcessorOccupiedStatus =
  | 'claimed'
  | 'processing'
  | 'needs_human'
  | 'awaiting_commit_decision';
type SequenceTerminalStatus =
  | 'execution_completed'
  | 'failed'
  | 'cancelled'
  | 'needs_human';
```

- `active`: runtime が起動前または実行中で、同じ lock key の non-`normal` claim を妨げる状態。初期実装では `claimed` / `processing` のみ。
- `processor occupied`: processor slot を空けない状態。既存の `OCCUPIED_PROCESSOR_STATUSES` と同じく `needs_human` / `awaiting_commit_decision` も含む。
- `ready non-normal`: `queued` かつ sequence predecessor 条件を満たしている `exclusive` / `sequence`。
- `blocked non-normal`: `queued` だが predecessor pending / failed などにより claim できない `sequence`。

`needs_human` と `awaiting_commit_decision` は人間の判断待ちであり、新規 processor capacity を占有するが、scheduling lock 上の active task には含めない。これらを lock active に含めると、human 待ちの normal entry が残っただけで `exclusive` / `sequence` の drain が永久に完了しないためである。ただし同一 entry の retry / recover / cancel は Queue health の操作で明示的に整理する。

`failed` / `cancelled` / `execution_completed` は lock active ではない。`sequence` predecessor 判定では `execution_completed` のみ成功、`failed` / `cancelled` / `needs_human` は後段を claim しない terminal blocker として扱う。

### Commit Ownership

Execution が commit してよい差分の範囲。

```ts
type CommitOwnershipStatus =
  | 'not_requested'
  | 'pending'
  | 'ready'
  | 'committed'
  | 'needs_human'
  | 'failed';
```

Commit ownership は次の情報で判断する。

- run 開始時の `HEAD`
- run 開始時の dirty status
- runtime が編集した path / tool event
- closeout 前の dirty status
- staged diff
- verification evidence
- commit result

path 単位で ownership が証明できない場合は commit しない。特に pre-existing dirty file を同じ Execution が編集した場合は、patch 単位で安全に分離できる仕組みがない限り `needs_human` に寄せる。

## Scope

In scope:

- `implementation_queue_entries` に scheduling fields を追加する。
- Supervisor / intake の job selection から scheduling type を永続化する。
- Queue claim 条件に `normal` / non-`normal` の排他制御を追加する。
- `sequence` の ready 判定を追加する。
- exclusive / sequence が ready のとき、新規 conflicting `normal` claim を止める。
- Dashboard / health に scheduling type と lock state を表示する。
- run 開始時 git baseline と closeout commit record を保存する。
- runtime prompt / audit / closeout に owned diff only commit を組み込む。
- pre-existing dirty diff と Execution diff が混ざる場合の stop condition を明文化する。
- commit status を Queue / run detail から確認できるようにする。
- focused tests と repo-native verify gate。

Out of scope:

- Runtime lane を増やすこと。
- 標準フローとして branch / PR を作ること。
- 外部 distributed lock service を導入すること。
- 初期実装で lock key scope enum を細分化すること。
- run 内 Todo の `depends_on` を task 間 dependency として流用すること。
- keyword / regex だけで destructive / migration task を分類すること。
- diff hunk 単位の自動 merge / patch splitting を初期実装で行うこと。
- PR / branch 作成を標準 closeout にすること。
- unrelated dirty diff を自動で stash / reset すること。
- verify 未実施の diff を機械的に commit すること。

## Target Behavior

### Normal task

- 同じ repository で他の `normal` task が running でも claim できる。
- 同じ `executionLockKey` の non-`normal` task が ready/pending の場合は、新規 claim しない。
- 既に running の `normal` は原則完走させる。

### Exclusive task

- 同じ `executionLockKey` に active task がない場合だけ claim できる。
- claim 後は同じ `executionLockKey` の他 task を claim しない。
- `exclusive` が ready になった時点で、同じ lock key の新規 `normal` claim は止める。

### Sequence task

- `sequenceGroupId` と `sequenceOrder` を持つ。
- 同じ group の前段 task が `execution_completed` 相当になった場合だけ ready とみなす。
- 前段 task が `failed`, `cancelled`, `needs_human` の場合、後段は claim しない。
- 実行中は `exclusive` と同じく同一 `executionLockKey` で排他扱いにする。

### Commit behavior

- Execution は自分の編集差分だけを commit 対象にする。
- commit 前には repo-native verify、または対象範囲の focused verification を実行する。
- unrelated failure で global verify が落ちる場合は、対象範囲の検証結果と unrelated blocker を run evidence に残す。
- run 開始時に dirty だった path は `preExistingDirtyPaths` として記録する。
- runtime が編集した path は `ownedCandidatePaths` として記録する。
- `ownedCandidatePaths` のうち、run 開始時に clean だった path だけを自動 stage 対象にする。
- run 開始時に dirty だった path を編集した場合は、patch ownership を証明できない限り自動 commit しない。
- commit 前に `git diff --cached --check` 相当を実行し、staged diff が owned path のみであることを確認する。
- commit が成功したら `commitSha`, `stagedPaths`, `verificationEvidence` を run に保存する。
- commit しなかった場合は `needs_human` または `failed` とし、理由を保存する。
- PR / branch 作成は標準では行わない。破壊的変更や大規模変更で人間が明示した場合だけ別フローにする。

## Data Model

`implementation_queue_entries` に次の column を追加する。

```ts
type ImplementationQueueSchedulingFields = {
  executionType: 'normal' | 'exclusive' | 'sequence';
  executionLockKey: string;
  sequenceGroupId: string | null;
  sequenceOrder: number | null;
  sequenceDependsOnEntryId: string | null;
  schedulingReason: string | null;
};
```

Column 方針:

- `execution_type text DEFAULT 'normal' NOT NULL`
- `execution_lock_key text`
- `sequence_group_id text`
- `sequence_order integer`
- `sequence_depends_on_entry_id text`
- `scheduling_reason text`

`execution_lock_key` は migration 後に既存 row へ `repository:${repository_id}` を backfill し、fresh insert では必ず設定する。SQLite の既存 DB 互換を優先し、初期 migration では nullable 追加 + backfill + repository code 上の必須扱いにする。

既存 DB 互換は repository の bootstrap pattern に合わせる。

- `api/db/bootstrap.ts` の `ensureColumn` で column 追加を保証する。
- bootstrap 後に `execution_lock_key IS NULL` の row を `repository:${repository_id}` で backfill する。
- migration file でも同じ backfill SQL を持つが、runtime 起動時の `ensureColumn` + backfill を正本の互換 path とする。
- `executionLockKey` の生成は `resolveImplementationQueueExecutionLockKey(entry)` のような helper に閉じ込め、将来 repository 以外の key を追加しても claim / health / enqueue が同じ関数を使うようにする。

追加 index:

```sql
CREATE INDEX IF NOT EXISTS implementation_queue_entries_scheduling_idx
  ON implementation_queue_entries (repository_id, execution_lock_key, execution_type, status);

CREATE INDEX IF NOT EXISTS implementation_queue_entries_sequence_idx
  ON implementation_queue_entries (sequence_group_id, sequence_order);
```

`tasks` table に同じ column を追加するかは Phase 2 で判断する。初期実装では Queue entry の scheduling を正本にする。理由は、排他制御が必要になるのは Implementation Queue に入った task であり、draft task の段階で DB migration の blast radius を広げないため。

### Commit ownership record

Execution ごとの commit 判定を run から説明できるように、`task_run_commit_records` を追加する。

```ts
type TaskRunCommitRecord = {
  runId: string;
  repositoryId: string;
  status: CommitOwnershipStatus;
  baselineHead: string | null;
  baselineStatusJson: unknown;
  preExistingDirtyPaths: string[];
  ownedCandidatePaths: string[];
  stageableOwnedPaths: string[];
  excludedPaths: Array<{ path: string; reason: string }>;
  verificationStatus: 'not_run' | 'passed' | 'failed' | 'partial';
  verificationEvidenceJson: unknown;
  commitSha: string | null;
  commitMessage: string | null;
  statusReason: string | null;
};
```

Column 方針:

- `run_id text NOT NULL UNIQUE`
- `repository_id text NOT NULL`
- `status text DEFAULT 'pending' NOT NULL`
- `baseline_head text`
- `baseline_status_json text`
- `pre_existing_dirty_paths_json text`
- `owned_candidate_paths_json text`
- `stageable_owned_paths_json text`
- `excluded_paths_json text`
- `verification_status text DEFAULT 'not_run' NOT NULL`
- `verification_evidence_json text`
- `commit_sha text`
- `commit_message text`
- `status_reason text`

Notes:

- `task_runs.context_snapshot` に詰め込まず、commit closeout 専用 record として分離する。
- 既存 `task_runs.base_ref` は互換 field として残す。新規 run では baseline `HEAD` を `task_runs.base_ref` と `task_run_commit_records.baseline_head` の両方へ保存し、commit ownership の正本は `task_run_commit_records.baseline_head` とする。
- 既存 `base_ref` だけがある run は read path で `baselineHead` fallback として表示できるが、過去 run に commit record を後付け作成しない。
- path list は git pathspec として使うため、保存時に repository root 相対 path に正規化する。
- `baseline_status_json` は `git status --porcelain=v1 -z` 相当の machine-readable parse result を保存する。表示用 text だけを正本にしない。
- `ownedCandidatePaths` は runtime tool event、file diff event、runtime adapter の changed file set から作る。
- `stageableOwnedPaths` は `ownedCandidatePaths - unsafeDirtyOverlapPaths` とする。
- `excludedPaths` は commit から外した path と理由を保存する。

## Scheduling Classification

分類は Supervisor / prompt 側で構造化して出す。provider / llm-provider 側に実行判断を分散させない。

Round 1 の job selection か、Implementation Queue への enqueue 前の planning output に次を追加する。

```ts
type TaskSchedulingDecision = {
  executionType: 'normal' | 'exclusive' | 'sequence';
  reason: string;
  sequenceGroupId?: string;
  sequenceOrder?: number;
  dependsOnTaskIds?: string[];
};
```

分類方針:

- `normal`
  - 小さな bug fix
  - docs / tests / localized UI copy
  - 共有 contract に触らない scoped implementation
- `exclusive`
  - destructive operation
  - large refactor
  - database schema migration
  - broad rename / file move
  - shared API / tool / prompt contract の破壊的変更
  - lockfile / generated artifact の広範囲 rewrite
- `sequence`
  - `A -> B -> C` のように順序が成果物の正しさに直結する task group
  - 前段の schema / contract / generated output が後段の入力になる task group

`data_migration` jobType は default で `exclusive` にする。ただし「migration 計画だけ」の planning task は `normal` または Queue 対象外にできる。

既存 `SupervisorRoutingHypothesis.overlays` との関係:

- `destructive_operation` overlay は scheduling decision の input evidence として扱う。
- overlay だけで機械的に `exclusive` に固定しない。Supervisor prompt が `scheduling.executionType` と `reason` を構造化して返す。
- `destructive_operation` overlay があり scheduling が欠落した場合の fallback は `exclusive` とする。
- overlay と scheduling が矛盾する場合は、enqueue 時に `schedulingReason` へ矛盾を保存し、保守的に `exclusive` を採用する。
- registry 関数参照は現行コードの `resolveSupervisorReferenceDocuments` を使う。AGENTS.md にある古い `resolveSupervisorSkillDocuments` 名へ戻さない。

## Claim Algorithm

`claimNextImplementationQueueEntry` は、最優先 candidate 1 件だけを見て終わらせない。priority / queue position / createdAt 順に候補 window を取得し、lock 制約で skip した場合は次候補を試す。

初期実装は `LIMIT N` + in-process iterate を採用する。`N` は `Math.max(processorCount * 4, 20)` 程度から開始し、health 上の skip reason を返せるようにする。候補 window 内に claim 可能 entry がない場合のみ `blocked_by_lock` または `empty` を返す。将来必要になった場合だけ CTE / subquery による single statement candidate selection へ寄せる。

戻り値は null だけにしない。

```ts
type ClaimImplementationQueueResult =
  | { kind: 'claimed'; entry: ImplementationQueueEntry }
  | {
      kind: 'not_claimed';
      reason: 'empty' | 'processor_full' | 'blocked_by_lock' | 'cas_lost';
      skipped: ClaimSkipEvidence[];
    };
```

`drainImplementationQueue` は `reason` を見て挙動を分ける。

- `empty`: queue が本当に空なので drain loop を終了する。
- `processor_full`: capacity が埋まっているので終了する。
- `blocked_by_lock`: queue には候補があるが scheduling lock 待ちなので、新規 run は開始せず終了する。health には skip reason を表示する。
- `cas_lost`: 競合で claim に失敗しただけなので、短い retry loop で次候補を再評価する。

候補選択は次の順で行う。

1. processor capacity を既存 `OCCUPIED_PROCESSOR_STATUSES` で確認する。
2. `queued` または recoverable expired `claimed` の candidate window を優先度順に取得する。
3. 各 candidate の `executionLockKey` を解決する。null なら `repository:${repositoryId}` を fallback とする。
4. candidate と同じ lock key の lock state を計算する。
5. candidate が `sequence` の場合、前段が完了しているか確認する。未完了または failed terminal なら skip する。
6. candidate が `normal` で、同じ lock key に ready non-`normal` entry がある場合は skip する。
7. candidate が non-`normal` で、同じ lock key に active entry がある場合は skip する。
8. candidate が `normal` で、active entry が `normal` のみなら claim できる。
9. compare-and-set で `queued -> claimed` に更新する。CAS に失敗した場合は次 candidate へ進むか、`cas_lost` として短く retry する。

Lock state は candidate ごとに次の情報を持つ。

```ts
type QueueSchedulingLockState = {
  activeCount: number;
  activeNonNormalCount: number;
  readyNonNormalCount: number;
  activeEntryIds: string[];
  readyNonNormalEntryIds: string[];
};
```

SQLite 一貫性方針:

- Phase 3 の初期実装は transaction 内の read-then-CAS とする。
- lock state read と claim update は同じ transaction で実行し、`BEGIN IMMEDIATE` 相当の writer lock を使う。
- claim update の WHERE には `id`, source `status`, `leaseVersion` か `updatedAt` 相当を含め、candidate 自体の二重 claim を防ぐ。
- lock state の read は health helper と共有するが、claim path では stale cache を使わない。
- Drizzle helper だけで `BEGIN IMMEDIATE` が表現しづらい場合は、repository 内に SQLite transaction helper を追加する。transaction を使わずに別 query + CAS だけで lock state を守る実装にはしない。

Pseudo code:

```ts
async function claimNextImplementationQueueEntry(input) {
  if (await isProcessorFull(input.processorCount)) {
    return { kind: 'not_claimed', reason: 'processor_full', skipped: [] };
  }

  return db.transaction(async (tx) => {
    await beginImmediateIfNeeded(tx);
    const candidates = await listClaimCandidates(tx, input.candidateLimit);
    const skipped = [];

    for (const candidate of candidates) {
      const lockKey = resolveExecutionLockKey(candidate);
      const sequenceState = await resolveSequenceReadiness(tx, candidate);
      const lockState = await resolveSchedulingLockState(tx, lockKey, candidate.id);
      const decision = canClaim(candidate, sequenceState, lockState);

      if (!decision.claimable) {
        skipped.push({ entryId: candidate.id, reason: decision.reason, lockKey });
        continue;
      }

      const claimed = await casClaimCandidate(tx, candidate, input);
      if (claimed) return { kind: 'claimed', entry: claimed };

      skipped.push({ entryId: candidate.id, reason: 'cas_lost', lockKey });
    }

    return {
      kind: 'not_claimed',
      reason: candidates.length === 0 ? 'empty' : 'blocked_by_lock',
      skipped,
    };
  });
}

function canClaim(candidate, sequenceState, lockState) {
  if (!sequenceState.ready) {
    return { claimable: false, reason: sequenceState.reason };
  }

  if (candidate.executionType !== 'normal' && lockState.activeCount > 0) {
    return { claimable: false, reason: 'non_normal_waiting_for_active_tasks' };
  }

  if (candidate.executionType === 'normal' && lockState.readyNonNormalCount > 0) {
    return { claimable: false, reason: 'normal_blocked_by_ready_non_normal' };
  }

  if (candidate.executionType === 'normal' && lockState.activeNonNormalCount > 0) {
    return { claimable: false, reason: 'normal_blocked_by_active_non_normal' };
  }

  return { claimable: true };
}
```

重要な点:

- `exclusive` / `sequence` は running 中だけでなく ready/pending 時点でも `normal` の新規 claim を止める。
- 既に running の `normal` は中断しない。drain してから non-`normal` を claim する。
- `processorCount` は global capacity として維持する。ただし lock 制約で claim できる entry がなければ slot は空いたままにする。
- `LIMIT 1` の candidate query は使わない。skip 可能性があるため、候補 window の走査を acceptance criteria に含める。

## Sequence Semantics

初期実装では sequence dependency は同じ `sequenceGroupId` 内の `sequenceOrder` で判定する。

Rules:

- `sequenceOrder = 1` は前段なしで ready。
- `sequenceOrder > 1` は、同じ group の `sequenceOrder - 1` が `execution_completed` の場合だけ ready。
- 前段が `failed`, `cancelled`, `needs_human` の場合、後段は `blocked` 相当として health に出す。ただし自動で status を変えるかは Phase 3 で判断する。
- 同じ group に同じ `sequenceOrder` が複数ある場合は health error にする。

`sequenceDependsOnEntryId` は将来の explicit DAG 用に nullable で持つが、初期 claim 条件は `sequenceGroupId` + `sequenceOrder` を正本にする。

初期実装では `sequenceDependsOnEntryId` は enqueue 時も自動設定せず、常に optional metadata として扱う。API / DB column は将来互換のために追加してよいが、Phase 1-4 の claim 判定・health 判定・acceptance criteria には含めない。将来 explicit DAG を実装するまでは NOT NULL 化しない。

## Queue Health

`implementationQueueHealthSchema` に scheduling 情報を追加する。

```ts
type QueueSchedulingHealth = {
  executionType: 'normal' | 'exclusive' | 'sequence';
  executionLockKey: string;
  lockState: 'free' | 'active_normal' | 'active_exclusive' | 'draining_for_non_normal';
  sequenceGroupId: string | null;
  sequenceOrder: number | null;
  schedulingBlockedReason:
    | 'none'
    | 'exclusive_waiting_for_active_tasks'
    | 'normal_blocked_by_ready_non_normal'
    | 'normal_blocked_by_active_non_normal'
    | 'sequence_predecessor_pending'
    | 'sequence_predecessor_failed'
    | 'sequence_order_conflict'
    | 'candidate_window_exhausted';
};
```

既存 resilience health の `classification: 'normal'` は「queue entry が異常ではない」という意味で、`executionType: 'normal'` とは別概念である。API 互換のため既存 field は急に削除しないが、新規 scheduling 表示では次の名前を使い分ける。

- resilience 側: `healthClassification` または UI label `healthy`
- scheduling 側: `executionType`

新規 UI copy では `classification normal` という表示を避け、正常状態は `healthy` / `問題なし`、execution type は `normal task` / `通常タスク` と表記する。

User-visible 表示は最小でよい。

- Queue row に `normal` / `exclusive` / `sequence` badge を出す。
- `exclusive` / `sequence` が待っている場合は、何の active task を drain 待ちしているかを表示する。
- lock key の raw 値は debug 表示に留め、通常 UI では repository 単位の排他として見せる。

## Commit Closeout Algorithm

Commit closeout は runtime lane に依存しない共通処理として扱う。

1. run 作成直後に repository root で git baseline を保存する。
   - `HEAD`
   - dirty status
   - untracked paths
2. runtime 実行中に changed file evidence を集める。
   - Codex lane: file change events / final diff
   - Native API lane: worker tool write/edit events / final diff
3. runtime が terminal closeout に入る前に verification evidence を保存する。
4. commit 対象 path を計算する。
   - `ownedCandidatePaths`: runtime が触った path
   - `preExistingDirtyPaths`: run 開始時 dirty だった path
   - `stageableOwnedPaths`: run 開始時 clean で、runtime が変更した path
   - `excludedPaths`: ownership が不明な path
5. `stageableOwnedPaths` が空なら commit しない。
6. `excludedPaths` がある場合でも、stageable path があり、検証が対象範囲に十分なら stageable path だけ commit できる。
7. pathspec 指定で `git add -- <stageableOwnedPaths>` を実行する。
8. staged diff に stageable path 以外が混ざっていないことを確認する。
9. `git diff --cached --check` を実行する。
10. commit message を task/run 由来で生成して commit する。
11. commit 後に `commitSha` と staged stat を保存する。

Baseline `HEAD` の競合検出は closeout 直前に必ず行う。

- run 開始時に `baselineHead` を保存する。
- closeout 直前に現在の `HEAD` を読み、`baselineHead` と違う場合は stop condition とする。
- `exclusive` / `sequence` でもこの検出は省略しない。排他 lock は Queue 実行同士の衝突を減らすだけで、ユーザー手動 commit や外部 process の commit までは防がないため。
- `normal` 並列実行では、他 run が先に commit して `HEAD` が進む可能性がある。その場合、後続 run は自動 commit せず、owned diff / verification evidence / blocker を commit record に残して `needs_human` に寄せる。

Git commit 操作は repository ごとに serialized にする。

- 同一 Node.js process 内では repository-level async mutex を使う。
- 将来 multi-process API server を想定する場合は SQLite lock または file lock を追加するが、初期実装では single API process 前提を明記する。
- mutex は `git add`, staged ownership check, `git diff --cached --check`, `git commit`, commit record update の範囲を覆う。
- mutex 内でも baseline `HEAD` 再確認を行い、待機中に別 commit が入った場合は stop する。

Stop conditions:

- repository が git repo ではない。
- baseline `HEAD` が run 中に別 actor の commit で進んでいる。
- `stageableOwnedPaths` が空。
- pre-existing dirty path と runtime edit が重なり、patch ownership を証明できない。
- verification が未実施。
- staged diff に owned path 以外が混ざっている。
- migration / destructive task で required evidence が不足している。

`exclusive` / `sequence` であっても、commit closeout は同じ ownership ルールを使う。排他実行は衝突確率を下げるが、owned diff の証明を省略する理由にはしない。

## Implementation Plan

### Phase 0. Baseline tests

Files:

- `tests/implementation-queue-scheduling-lock.test.ts` を新規追加する。
- 既存 queue lease tests がある場合は、claim behavior の fixture を共有する。

Phase 0 の目的は、scheduling lock の期待挙動を red test として固定することである。Phase 1 の schema 追加前に main verify へ組み込まない。テスト file は Phase 0 時点では `describe.skip` または helper-only で作成し、Phase 1 の schema 完了後に compile 可能にし、Phase 3 で pass させる。

Test cases:

- 複数 `normal` は processor capacity の範囲で同じ repository から claim できる。
- `exclusive` が queued の場合、同じ lock key の新規 `normal` は claim されない。
- running `normal` がある場合、`exclusive` は claim されない。
- running `normal` が完了した後、ready `exclusive` が claim される。
- priority 順の先頭 candidate が lock 制約で skip されても、後続の claim 可能 candidate が claim される。
- claim できない理由が `empty` / `processor_full` / `blocked_by_lock` / `cas_lost` として区別される。
- `sequenceOrder=2` は `sequenceOrder=1` 完了前に claim されない。
- `sequenceOrder=1` failed 後、`sequenceOrder=2` は claim されない。

Gate:

```bash
bunx vitest run tests/implementation-queue-scheduling-lock.test.ts
```

Phase 1 では schema / route 型と skipped test file の compile を確認する。lock behavior test は Phase 3 で unskip して pass させる。

Phase 0 単独ではこの gate は failing または skipped でよい。Phase 3 の完了条件では pass 必須にする。

### Phase 1. Data model and API schema

Files:

- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- `drizzle/migrations/*_implementation_queue_scheduling.sql`
- `api/modules/queue/queue-route-definitions.ts`

Tasks:

1. `implementation_queue_entries` に scheduling fields を追加する。
2. fresh DB bootstrap と既存 DB `ensureColumn` を揃える。
3. 既存 row の `execution_lock_key` を `repository:${repository_id}` で backfill する。
4. route schema に fields を optional 互換で追加する。
5. index を追加する。
6. `resolveImplementationQueueExecutionLockKey` helper を追加し、enqueue / claim / health が同じ fallback を使うようにする。

Gate:

```bash
bunx vitest run tests/implementation-queue-scheduling-lock.test.ts
```

### Phase 2. Enqueue-time scheduling decision

Files:

- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/skills/types.ts`
- `api/services/supervisor/skills/builtin/SKILL.md`
- `api/services/supervisor/skills/builtin/references/`
- `api/modules/queue/queue.repository.ts`
- enqueue route / service call sites

Tasks:

1. Supervisor output contract に `scheduling` object を追加する。
2. `data_migration`, `destructive_operation`, `large refactor`, `shared contract` の分類方針を prompt reference に書く。
3. `createImplementationQueueEntry(...)` が scheduling decision を受け取れるようにする。
4. scheduling がない既存 call site は `normal` + `repository:${repositoryId}` を default にする。
5. `data_migration` jobType は fallback として `exclusive` にする。ただし prompt が明示的に `sequence` を返した場合は sequence を優先する。

Avoid:

- ユーザー文言を keyword / regex だけで分類する実装。
- llm-provider 側に scheduling 判断を置くこと。

### Phase 3. Claim-time lock enforcement

Files:

- `api/modules/queue/queue.repository.ts`
- `api/modules/queue/queue-management.service.ts`
- `tests/implementation-queue-scheduling-lock.test.ts`

Tasks:

1. `claimNextImplementationQueueEntry(...)` の candidate query に scheduling fields を含める。
2. `LIMIT 1` をやめ、candidate window を priority 順に走査する。
3. lock state resolver を追加し、claim path では transaction 内で stale cache なしに読む。
4. ready non-`normal` が存在する lock key では、新規 `normal` claim を止める。
5. non-`normal` candidate は active entry がない場合だけ claim する。
6. sequence predecessor check を claim 前に行う。
7. claim skip reason を health 用に計算できる helper に分離する。
8. claim result を `claimed` / `empty` / `processor_full` / `blocked_by_lock` / `cas_lost` に分ける。
9. `drainImplementationQueue` が claim result reason を見て早期終了理由を区別する。

Gate:

```bash
bunx vitest run tests/implementation-queue-scheduling-lock.test.ts tests/implementation-queue-resilience.test.ts
```

### Phase 4. Health and UI

Files:

- `api/modules/queue/queue-route-definitions.ts`
- `api/modules/queue/queue-management.service.ts`
- `src/modules/queue/queueCommands.ts`
- `src/modules/queue/useImplementationQueue.ts`
- `src/modules/queue/ImplementationQueueScreen.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

Tasks:

1. Health API に scheduling lock state を追加する。
2. Queue screen に task execution type badge を表示する。
3. non-`normal` が drain 待ちの場合、待機理由を短く表示する。
4. `sequence` が predecessor 待ち / predecessor failure の場合、claim されない理由を表示する。
5. resilience health の `classification: normal` 表示は `healthy` / `問題なし` に寄せ、execution type の `normal` と混同しない copy にする。

UI は debug 情報を増やしすぎない。通常表示では「排他タスク待機中」「順序待ち」程度に留め、詳細は health detail で見る。

### Phase 5. Commit ownership data model

Files:

- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- `drizzle/migrations/*_task_run_commit_records.sql`
- relevant route schemas

Tasks:

1. `task_run_commit_records` を追加する。
2. run 作成時に baseline record を作る repository helper を追加する。
3. `task_runs` から commit record を取得できる read path を追加する。
4. Queue / run API response に commit status を optional で追加する。
5. 新規 run では `task_runs.base_ref` にも baseline `HEAD` を保存し、commit ownership の正本は `task_run_commit_records.baseline_head` と明記する。

Gate:

```bash
bunx vitest run tests/implementation-queue-scheduling-lock.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### Phase 6. Commit ownership runtime contract

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/supervisor/skills/builtin/references/modes/code_edit.md`
- `api/services/supervisor/skills/builtin/references/modes/git_release.md`
- relevant runtime tests

Tasks:

1. Execution closeout contract に「自分の編集差分だけを commit 対象にする」を明文化する。
2. commit 前の status / diff inspection を prompt に入れる。
3. `normal` 以外の task でも PR / branch は標準化しないことを明記する。
4. migration / destructive task は verify evidence と migration evidence を closeout に要求する。
5. commit できない場合は固定成功文にせず、`needs_human` / `failed` と理由を返すようにする。

### Phase 7. Commit closeout enforcement

Files:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/modules/nightworkers/nightworkers.runs.repository.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- native API runner closeout boundary
- focused runtime tests

Tasks:

1. run 作成直後に git baseline を保存する。
2. runtime result から changed file set を抽出して `ownedCandidatePaths` に保存する。
3. closeout 前に verification evidence を commit record に保存する。
4. `stageableOwnedPaths` を計算する。
5. owned path だけを pathspec staging する。
6. staged diff ownership check と `git diff --cached --check` を実行する。
7. commit 成功時に `commitSha` を保存する。
8. commit 不可時に `needs_human` / `failed` と理由を保存する。
9. repository-level async mutex で `git add` から commit record update までを serialize する。
10. mutex 内で current `HEAD` を再確認し、baseline から進んでいた場合は自動 commit を止める。

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
bunx vitest run tests/nightworkers-service/services-nightworkers-02.test.ts
```

Phase 5-7 は scheduling lock と同じ大きさの実装単位として扱う。DB claim 制御だけを先に入れる場合でも、commit ownership は同じ Feature の未完了 Phase として残す。

## Migration and Compatibility

- 既存 queue entry はすべて `normal` として扱う。
- 既存 queue entry の `executionLockKey` は `repository:${repositoryId}` に backfill する。
- scheduling fields が null の row は read path で default 補完する。
- `sequenceDependsOnEntryId` は初期実装では optional metadata のまま維持し、claim 判定に使わない。
- commit record がない既存 run は `not_requested` として表示する。
- commit record がない active run は、次の runtime start から baseline を作る。過去 run に後付け baseline は作らない。
- 既存 `task_runs.base_ref` は削除しない。新規 run では baseline `HEAD` を保存し、commit record がない read path の fallback にだけ使う。
- API response は optional fields として追加し、古い UI が壊れないようにする。
- `processorCount` の意味は変えない。lock により claim できない場合だけ slot が空く。

## Priority Policy

non-`normal` task を常に先にするわけではない。

Rules:

- downstream blocker の `exclusive` / `sequence` は優先する。
- blocker ではない large refactor は、ready `normal` の小タスクが詰まっていなければ後回しでもよい。
- 初期実装では aging threshold を導入しない。ready non-`normal` がある時点で、同じ lock key の新規 `normal` claim を止める。
- priority の値は既存値を尊重する。non-`normal` の priority を自動で上げるのではなく、claim policy で starvation を避ける。

この単純ルールは保守的だが、migration / destructive task の starvation を避けるには妥当である。過剰排他が目立つ場合だけ、後続で `nonNormalDrainPolicy` や aging threshold を設定化する。

## Acceptance Criteria

- `normal` task は同じ repository 内で並列 claim できる。
- `exclusive` task は同じ repository lock key 内で単独 claim される。
- `sequence` task は順序が満たされるまで claim されない。
- ready non-`normal` task がある lock key では、新規 `normal` claim が止まる。
- priority 先頭 candidate が lock 制約で skip されても、同じ candidate window 内の claim 可能 task が claim される。
- claim がない場合でも `empty` / `processor_full` / `blocked_by_lock` / `cas_lost` が区別され、drain loop は queue 空と lock 待ちを混同しない。
- lock state read と claim update は同一 transaction 内で行われ、candidate 自体は CAS で二重 claim されない。
- `needs_human` / `awaiting_commit_decision` は processor occupied だが lock active ではないため、human 待ち entry だけで non-`normal` drain が永久停止しない。
- runtime lane は増えない。`codex-sdk` / `native-api-runner` はそのまま使われる。
- Queue dashboard / health で、なぜ task が待機しているか説明できる。
- Health UI は resilience の healthy/normal と execution type の normal を混同しない。
- 既存 queue entry は migration 後も `normal` として動く。
- run 開始時に git baseline が保存される。
- 新規 run の baseline `HEAD` は `task_runs.base_ref` と `task_run_commit_records.baseline_head` に保存され、commit ownership の正本は commit record になる。
- commit は `stageableOwnedPaths` のみを pathspec staging して作成される。
- commit closeout 直前と mutex 内で current `HEAD` を再確認し、baseline から進んでいる場合は自動 commit しない。
- pre-existing dirty path と runtime edit が重なる場合、自動 commit せず理由が保存される。
- commit 成功時に `commitSha`, staged path, verification evidence が保存される。
- commit しない場合も `needs_human` / `failed` と理由が run から説明できる。
- focused tests と repo-native verify が通る。

## Verification

Focused:

```bash
bunx vitest run tests/implementation-queue-scheduling-lock.test.ts
bunx vitest run tests/implementation-queue-resilience.test.ts
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
```

Broader:

```bash
bun run verify:fast
bun run verify
git diff --check
```

`bun run verify` が unrelated failure で落ちる場合は、focused tests と `verify:fast` の結果、unrelated blocker の file / error を closeout に残す。

## Open Questions

- sequence group を誰が作るか。Plan Mode の Feature Plan から作るか、Implementation Queue enqueue UI で作るか。
- `exclusive` の default priority を上げるか。初期案では priority は既存値を尊重し、claim policy だけで starvation を防ぐ。
- failed predecessor の後段を自動で `blocked` に更新するか。初期実装では health 表示に留め、明示操作で整理する方が安全。
- `executionLockKey` を repository 以外に細分化する必要があるか。初期実装では不要。
- pre-existing dirty file に対する patch ownership を将来サポートするか。初期実装では path overlap を自動 commit 不可にする。
- commit message の canonical format をどこまで固定するか。初期案では task title + run id + concise summary とする。
