# Run / Queue State Integrity 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-08-16
- Parent program: [Codebase Review Remediation Program](./codebase-review-remediation-program-index.md)
- Findings: `C4`, `M5`, `M6`, `M13`, `m9`
- Related active plan: [Evidence・Review・Closeout整合性と記録保持](./evidence-review-closeout-retention-implementation-plan.md)
- Implementation authorization: not started

## 1. 目的

Run、Task、Implementation Queueの状態を、事前に読んだ古いrowへ無条件に書き戻す実装から、
expected state/revision/leaseを持つapplication commandとtransactional projectionへ移行する。

変更後は次を満たす。

1. completed Runをcancel/recovery/prompt preparationが上書きしない。
2. Run terminal state、Task status、Queue Entry statusが同じ結果を表す。
3. Queue cancel/resumeがleaseとactive Runを無視しない。
4. 同一Taskに非archive Queue Entryが複数作成されない。
5. CAS競合に負けたqueue drainerが、空きslotを不必要に放置しない。

## 2. 非目的

- LLM本文やerror messageから状態遷移を決めない。
- Hostが観測結果からTodoを暗黙更新しない。
- Evidence、Review、Git closeoutの完了意味を新しいstate machineへ複製しない。
- Implementation Queueとlegacy Session Queueを本計画だけで全面統合しない。
- Task statusをRun statusと完全に同一のenumへ変更しない。
- Runtime stop、background process kill、provider cancelをdatabase transaction内で実行しない。

## 3. 現行の確認済み不足

### 3.1 Run terminal overwrite

- `stopTaskRun`はruntime stop後、読込時のstatusを根拠に無条件`updateTaskRun(cancelled)`する。
- `reviewTaskRunCommand`はReview計算後に無条件でRunとTaskを更新する。
- stale recoveryはrunner status確認後に無条件`failed`へ更新する。
- 初回prompt preparationはcancelled Runを`running`へ戻し得る。
- `updateTaskRunIfStatus`とresume専用CASは既に存在するが、一貫して使われていない。

### 3.2 Queue lifecycle

- cancelはprocessing Runを停止せず、leaseだけを消してEntryをcancelledにする。
- resumeは`needs_human`からlease ownerなしの`processing`へ直接変更する。
- generic `updateImplementationQueueEntry`がapplication commandから広く利用される。

### 3.3 Task projection

- `updateTaskStatus`はidだけで更新する。
- `updateTaskStatusIfUnchanged`は存在するが本番で利用されない。
- Run、Queue、Review、recoveryが個別にTask statusを書き換える。

### 3.4 Admission / claim race

- `hasActiveImplementationQueueEntry`とinsertは別transactionである。
- DBには`task_id`に対する非archive partial unique indexがない。
- legacy `claimNextQueuedTask`はSELECT後のCASに負けると、次候補を試さずnullを返す。

## 4. Target invariants

1. Run status変更は必ず`expectedStatus`を持ち、必要な経路は`expectedUpdatedAt`またはrevisionも持つ。
2. terminal Runから別statusへの遷移を許可しない。
3. terminal transitionのDB更新は、Run、Queue Entry、Task projectionを同一transactionで確定する。
4. realtime publish、runtime stop、background cleanup、次queue drainはcommit後のside effectとして行う。
5. side effect失敗で確定済みterminal stateを巻き戻さない。再試行可能なoutbox/evidenceを残す。
6. Task statusはRun/Queueの正本ではなくprojectionであり、projection元とexpected Task versionを記録する。
7. Queue leaseを持たないhuman/API commandが`processing`を直接作らない。
8. `implementation_queue_entries`は同一Taskにつき`execution_archived`以外を最大1件とする。
9. idempotency key replayは既存Entryを返し、別Entryを作成しない。
10. claim retryは上限付きで、無限loopやbusy spinを作らない。

## 5. Ownership

| Concern | Owner |
| --- | --- |
| Run transition command | `api/modules/run/application` |
| Run persistence CAS | Run repository。Coding Agent private repositoryへ置かない |
| Task status projection | agent非依存Task application command / projection port |
| Implementation Queue lifecycle | `api/modules/queue` |
| Runtime start/stop | Coding Agent runtime port。DB遷移の意味判断を持たない |
| Background cleanup | Area Aのrun-scoped cleanup port |
| Review verdict | 既存`api/modules/review` |
| Evidence / closeout | 既存の関連active planを正本とする |

## 6. Canonical transition contract

Run terminal更新は、少なくとも次の入力を持つ一つのapplication commandへ集約する。

```ts
type CompleteRunTransition = {
  runId: string;
  expectedStatuses: readonly TaskRunStatus[];
  expectedUpdatedAt?: string;
  targetStatus: TerminalTaskRunStatus;
  actor: "human" | "runtime" | "recovery" | "system";
  reasonCode: string;
  summary?: string | null;
  finalReport?: string | null;
  idempotencyKey: string;
};
```

`reasonCode`は列挙済みの構造値であり、error messageのkeyword分類で生成しない。command resultは
`applied | replayed | conflict | not_found`を区別する。

## 7. Implementation phases

### Phase B0: Transition race tests

#### Implementation

- barrier付きrepository/runtime fakeを使い、次の競合を再現する。
  - stop read後にruntime completion。
  - stale recovery read後にheartbeat/completion。
  - prompt preparation中のcancel。
  - Review evidence収集中の別terminal transition。
  - Queue cancelとruntime completion。
  - needs_human resumeと別worker claim。
- 同一Taskへの並行Queue admissionを複数connection/process相当で実行する。
- legacy Session Queueで、先頭候補CAS loss後に次候補を取得するtestを追加する。

#### Acceptance

- 修正前に、少なくともterminal overwrite、ghost processing、重複Entryを再現できる。
- testが単一process mutexだけに依存せず、DB-level競合を検証する。

### Phase B1: Run terminal CAS command

#### Implementation

1. `stopTaskRun`、runtime completion/failure、Review、stale recoveryが使用する共通terminal commandを追加する。
2. sourceごとに許可するexpected statusを明示する。
3. stale recoveryはstatusに加え、読込時`updatedAt`またはheartbeat revisionをCAS条件にする。
4. prompt preparationは`context_compiling -> running`等の明示CASにする。
5. CAS miss時は最新Runを再取得し、terminalならreplay/conflictとして副作用を止める。
6. final report evidence appendもtransition transaction内で一度だけ行う。

#### Acceptance

- terminal Runが別statusに変わらない。
- 同一idempotency keyの再実行でevent/evidenceが重複しない。
- CAS missを成功またはnot-foundへ曖昧化しない。

### Phase B2: Task / Queue projectionをtransactionへ統合する

#### Implementation

1. Run terminal command transaction内で関連Queue Entryを`activeRunId`とsource statusで更新する。
2. 既存`projectTaskRunParentStatus`を利用してTask projectionを計算する。
3. Task updateはexpected status/updatedAtまたはrevisionを持つCASにする。
4. Run結果より新しいTask人手操作がある場合、Taskを上書きせずprojection conflictを記録する。
5. transaction commit後にrealtime event、background cleanup、queue drainをdispatchする。
6. side effect用outboxまたは同等の再実行recordを用意し、process crash後に再送できるようにする。

#### Acceptance

- Run、Task、Queueの3 rowが部分更新状態にならない。
- realtime subscriberがDBに存在しない中間状態を受け取らない。
- background cleanup失敗でもterminal DB stateは保持される。

### Phase B3: Queue cancel / resume command

#### Cancel

- `queued`でactiveRunなし: status/leaseVersion CASでcancelledへ遷移する。
- `claimed`でactiveRunなし: lease owner/versionを検証してclaimを解放し、cancelledへ遷移する。
- `processing`またはactiveRunあり: cancellation requestを構造的に記録し、Run stop commandを呼ぶ。
- Queue terminal projectionはRun terminal commandから確定し、APIが先にcancelledを確定しない。
- 既にterminalの場合はidempotent replayとする。

#### Resume

- `needs_human` Entryをleaseなし`processing`へ直接変更しない。
- active Runが`needs_human`なら、resume intentを保存し、queue workerがleaseを再取得して既存Runの
  resume commandを呼ぶ。
- active Runがterminal/missingなら、manual retry/requeue commandと区別する。
- human input、Todo、Task revisionの事前条件は既存Task Operator/Coding Agent commandを使用する。

#### Acceptance

- processor slotを占有するEntryは有効leaseを持つ。
- cancel後にactive Runが実行継続しない。
- resumeで新規Runと既存Runが二重起動しない。

### Phase B4: Queue admission DB invariant

#### Implementation

1. migration前にTaskごとの非archive重複Entryを診断するpreflightを追加する。
2. 重複が存在する場合は自動削除せず、移行をfail-closeして対象IDを報告する。
3. SQLite partial unique indexを追加する。

```sql
create unique index ... on implementation_queue_entries(task_id)
where status <> 'execution_archived';
```

4. insertはunique conflictを`QUEUE_ENTRY_EXISTS`または既存idempotent resultへ変換する。
5. `sourceCommandKey` uniqueはcommand replay用として維持し、Task invariantの代替にしない。
6. admissionとTask `queued` projection、system message作成を可能な範囲で同一transactionにする。

#### Acceptance

- 並行admissionでinsert成功は1件だけである。
- 失敗側がTask statusやmessageを余分に変更しない。
- requeueは旧Entryのarchive確定後にだけ新Entryを作る。

### Phase B5: Legacy claim bounded retry

#### Implementation

- `claimNextQueuedTask`でcandidateを上限件数取得するか、CAS loss時にSELECTを再実行する。
- retry上限、観測したcandidate ID、CAS loss回数をdebug evidenceとして残す。
- 空きslotがなくなった場合や候補が尽きた場合は直ちに停止する。
- Implementation Queueへの全面統合は別計画とし、本Phaseではthroughput bugだけを直す。

#### Acceptance

- 先頭candidateのCAS loss後に次candidateをclaimできる。
- retry上限を超えてqueryを続けない。

## 8. Verification matrix

| Scenario | Run | Task | Queue | Expected |
| --- | --- | --- | --- | --- |
| runtime complete vs stop | completed | completed projection | execution_completed等 | stop側CAS conflict/replay |
| stale recovery vs heartbeat | active | active | processing | recoveryは更新しない |
| processing cancel | cancelled | ready/cancel projection | cancelled | active runtime停止済み |
| needs_human resume | needs_human -> active | active projection | claimed -> processing | valid leaseあり |
| duplicate admission | unchanged/one run only | queued | one nonarchive entry | one insertのみ |
| claim CAS loss | next task active | running | legacy queue対象外 | 次候補へ進む |

## 9. Verification commands

```bash
node scripts/run-vitest.mjs run \
  tests/queue-entry-commands-service-coverage.test.ts \
  tests/run-orchestration-queues-extra-coverage.test.ts \
  tests/run-review-command-extra-coverage.test.ts \
  tests/runtime-execution-extra-coverage.test.ts
bun run typecheck
bun run check:architecture
bun run lint
```

新規race testはisolated DBで複数connectionを使用する。単なるmock call countだけでCASを証明しない。

## 10. Rollout

1. 新CAS repository APIと観測eventを追加する。
2. terminal callerを一つずつ共通commandへ移す。
3. 全caller移行後に無条件terminal updateをarchitecture/static checkで禁止する。
4. Queue commandを状態別APIへ移す。
5. duplicate preflightを実データへread-only実行する。
6. 重複なしを確認してpartial unique migrationを適用する。
7. generic status updaterをrepository内部へ閉じる。

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| CAS導入で従来成功していた操作が409になる | conflict resultに最新snapshotを含め、clientが再取得できるようにする |
| DB commit後、side effect前にprocess crash | outbox/idempotent retryを使用する |
| Task projectionが人手変更を上書きする | expected Task versionを必須にし、conflict evidenceを残す |
| partial unique migrationが既存重複で失敗 | preflightし、自動削除せず手動解決する |
| resume設計でRunが二重起動する | worker lease取得とactiveRunId CASを同一transactionにする |

## 12. Completion criteria

1. `C4`の4競合経路すべてがCASで保護される。
2. Run、Task、Queueのterminal projectionがtransactionalに一致する。
3. Queue cancel/resumeがleaseとactive Runを検証する。
4. 同一Taskに非archive Queue Entryを複数insertできない。
5. CAS loss後のlegacy claimが次候補へ進む。
6. 無条件`updateTaskRun`/`updateTaskStatus`がterminal application pathに残っていない。
7. Area Aのbackground cleanup integrationを含むrace testと限定verificationが成功する。
