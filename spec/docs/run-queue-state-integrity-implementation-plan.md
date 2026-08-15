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
2. `runStatusTransitionTable`で遷移先が空の`completed`/`failed`は同一Runで再開しない。
   `cancelled`/`timed_out`/`blocked`/`needs_human`は既存tableどおり明示的な再開経路だけを許可し、
   「terminal」という曖昧な一括判定で既存domain semanticsを変えない。
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

## 8. Terra実行チケット台帳

Area Bでは、repository CAS、application transaction、Queue command、migrationを同じticketへ混ぜない。
各ticketのred testが想定競合を再現してからproduction codeを変更する。

### B-T0: stale writer/race characterization

- Findings: `C4`, `M5`, `m9`, `M13`
- Write set: 新規`tests/run-state-transition-races.test.ts`、新規
  `tests/implementation-queue-races.test.ts`
- Read-only参照: `stop-task-run.ts`、`run-review.command.ts`、`nightworkers.service.ts`、
  `nightworkers.run-query.service.ts`、`start-task-run-persistence.ts`、`queue-entry-commands.service.ts`、
  `nightworkers.runs.repository.ts`、`queue-repository-commands.ts`
- Run barrier cases: stop読込後のruntime completion、Review読込後の別Review/completion、stale recovery読込後の
  heartbeat/completion、prompt compile後のcancelをbarrier付きfakeまたは2 connectionで再現する。
- Queue cases: 同一Taskの並行admission、processing cancel対runtime completion、needs_human resume対worker claim、
  legacy先頭candidate CAS lossを再現する。
- Stop: DB-level invariantのtestを単一repository mockのcall countだけで代用しない。SQLiteの同一fileへ独立connectionを
  作れないtest harnessなら先にharness ticketを追加する。
- Done: 修正前にcompleted overwrite、partial projection、duplicate admission、claim slot放置のうち該当caseがredになる。

### B-T1: publishしないRun CAS primitiveを追加する

- Findings: `C4`
- Write set: `api/modules/nightworkers/nightworkers.runs.repository.ts`、
  `api/modules/nightworkers/run-orchestration/status.ts`、
  `tests/runtime-execution-extra-coverage.test.ts`、B-T0のRun test
- 新規symbol: `transitionTaskRunIfCurrent(input, database?)`。入力は`runId`、`expectedStatuses`、任意の
  `expectedUpdatedAt`、`targetStatus`、patchを持ち、結果は`applied | conflict | not_found`のtagged unionとする。
- Contract: `assertRunStatusTransition(current, target)`を唯一の遷移表として再利用し、SQL `where`へrun ID、
  expected status、指定時updatedAtを含める。repository内ではrealtime publishしない。CAS miss時は同じDB scopeで
  最新rowを読み、`conflict.current`へ返す。
- Scope: contextSnapshotだけを更新する`codex-repository-preflight.ts`はstatus writerではないため、このticketで
  terminal commandへ移さない。statusを更新する無条件callerだけをB-T2/B-T3で移す。
- Stop: `compiling_context`のようなschema外legacy値を観測した場合、勝手にtransition tableへ追加せずdata migrationを
  別ticketにする。
- Done: completed/failedからの不正遷移、expected status miss、updatedAt miss、not found、same-status replayをunit testする。

### B-T2: stop、stale recovery、prompt preparationをCASへ移す

- Findings: `C4`
- Depends on: `B-T1`
- Write set: `api/modules/nightworkers/run-orchestration/stop-task-run.ts`、
  `api/modules/nightworkers/nightworkers.run-query.service.ts`、
  `api/modules/nightworkers/run-orchestration/start-task-run-persistence.ts`、
  それぞれの近接suiteとB-T0のRun test
- Stop contract: runtime stopはDB commit前の外部side effectなので、実行後も読込済みstatusを無条件writeしない。
  `transitionTaskRunIfCurrent`へ読込status+updatedAtを渡し、CAS conflictなら最新Runを返してTask/Queueを変更しない。
- Recovery contract: runner status/heartbeat判定に使った`activeRun.updatedAt`をCASへ渡す。CAS winnerだけが
  `run.recovered` event、Task message、projectionを作る。
- Prompt contract: 初回は`context_compiling -> running`のみを許可し、compiled promptのTask保存とRun CASの
  順序をtransactionへ寄せる。cancel/complete後のCAS missは`RUN_PROMPT_PREPARATION_CONFLICT` 409とし、
  contextSnapshotを上書きしない。resume既存CASのerror contractは維持する。
- Done: 4つのbarrier caseでstale callerのRun/Task/Queue/event writeが0件になり、最新snapshotを返す/409にする。

### B-T3: ReviewをRun/Task/Queueの一transactionへ集約する

- Findings: `C4`, `M6`
- Depends on: `B-T1`, `B-T2`
- Write set: 新規`api/modules/run/application/run-outcome-transition.command.ts`、新規
  `api/modules/run/run-outcome-transition.repository.ts`、`api/modules/run/application/run-review.command.ts`、
  `api/modules/nightworkers/nightworkers.service.ts`、
  `api/modules/nightworkers/nightworkers.task-status-cas.repository.ts`、
  `api/modules/queue/queue-repository-commands.ts`、`tests/run-review-command-extra-coverage.test.ts`、B-T0
- Transaction contract: 1 transactionでRun expected status/updatedAt CAS、Task expected status/updatedAt projection、
  `activeRunId`一致Queue Entryのstatus/lease releaseを更新する。いずれかの必須CASがmissしたらrollbackし、
  `RUN_OUTCOME_CONFLICT`と最新Run/Task/Queue IDを返す。
- Task semantics: status変更でTaskの設計`revision`を増減させない。現在のstatus/updatedAtだけをprojection CAS条件とし、
  concurrentな人手更新を上書きしない。projection mappingは既存`projectTaskRunParentStatus`の結果を入力として受け、
  repository内で意味判断を複製しない。
- Review consolidation: `nightworkers.service.ts`の重複Review実装は新commandへdelegateし、Review result IDを
  idempotency keyにする。CAS winnerだけがmanual confirmationsと2つのRun eventを一度生成する。
- Post-commit: realtime publish、Area A cleanup、queue drainはcommit後に順序付きdispatcherから呼ぶ。
  汎用outbox subsystemは新設せず、cleanupはprocess row、queue drainは既存scheduler、realtimeは再queryで回復する。
- Stop: `recordManualConditionConfirmationsForReview`をtransactionへ参加させられずexactly-onceが崩れる場合は、
  confirmationの既存unique/idempotency contractを確認する別ticketを先に追加する。
- Done: transaction rollback時に3 rowの部分更新とReview eventがなく、winner時だけ3 rowとeventが一致する。

### B-T4: Queue cancelをlease/active Run別commandにする

- Findings: `M5`
- Depends on: `B-T3`
- Write set: `api/modules/queue/queue-entry-commands.service.ts`、
  `api/modules/queue/queue-repository-commands.ts`、
  `tests/queue-entry-commands-service-coverage.test.ts`、B-T0のQueue test
- `queued`/activeRunなし: status+leaseVersion CASで`cancelled`、lease/slotをclearし、Task `queued -> ready`を
  同一transactionでprojectionする。
- `claimed`/activeRunなし: callerがhumanのためlease ownerを偽装せず、status+leaseVersion CASでclaimを解放して
  `cancelled`にする。`leaseVersion`は必ず+1する。
- activeRunあり、または`processing`: B-T3のcanonical stop/outcome commandを呼び、Queueを先にcancelledへしない。
  Run CAS winnerのprojectionだけがQueue terminal statusを確定する。
- already terminal: 同じsnapshotをidempotent replayとして返す。CAS missは409 `QUEUE_ENTRY_CONFLICT`と最新entryを返す。
- Done: cancel後にruntimeが継続せず、stale cancelが新lease/新Runを解放しない。

### B-T5: Queue resumeをghost processingにしない

- Findings: `M5`
- Depends on: `B-T4`
- Write set: B-T4と同じproduction file、`tests/queue-entry-commands-service-coverage.test.ts`
- active Runが`needs_human`: 現在のPATCH contractにはhuman input、Todo revision、Run preconditionがないため状態を
  変えず、409 `QUEUE_RUN_REQUIRES_TASK_RESUME`と`activeRunId`を返す。Coding Agentの既存resume commandを正規経路にする。
- active Runがterminalまたはmissing: status+leaseVersion CASで`needs_human -> queued`、`activeRunId`、lease、slotを
  clearし、`claimReady=true`にする。`processing`へ直接変更しない。
- Runがactiveだが`needs_human`以外: 409 `QUEUE_ENTRY_CONFLICT`。新規Runを開始しない。
- Done: resume直後のEntryは`queued/no lease/no slot/no activeRun`か、変更なしの409だけであり、leaseなし
  `processing`が生成されない。

### B-T6: 同一Taskのnon-archive EntryをDBで一意にする

- Findings: `m9`
- Write set: `api/db/schema-task-execution.ts`、新規
  `drizzle/migrations/0066_implementation_queue_active_task_unique.sql`、
  `drizzle/migrations/meta/_journal.json`と生成snapshot、
  `api/modules/queue/queue-entry-commands.service.ts`、B-T0のadmission test
- Preflight: migration前に`status <> 'execution_archived'`でtask_id別count>1をread-only queryし、重複時は
  entry ID/status/task IDを報告して停止する。自動archive/deleteをしない。
- Schema: DrizzleとSQLの双方に`task_id WHERE status <> 'execution_archived'` partial unique indexを追加する。
  migration file名は実装開始時のjournal末尾が0065であることを再確認してから使用する。
- Admission: precheckはUX用に残すが正本にしない。SQLite unique violationを409 `QUEUE_ENTRY_EXISTS`へ変換し、
  失敗側はTask status/messageを変更しない。Task queued projection、Entry insert、system messageを1 transactionにする。
- Done: 2 connectionの並行insertで成功1件、失敗1件、Task/message副作用1組となり、archive後は再queueできる。

### B-T7: legacy Session QueueのCAS lossを最大3回再探索する

- Findings: `M13`
- Write set: `api/modules/nightworkers/nightworkers.runs.repository.ts`、
  `tests/queue-repository-branch-coverage.test.ts`、B-T0のlegacy claim test
- Contract: `claimNextQueuedTask`はcandidate SELECTとTask CASを最大3 iteration行う。CAS miss時はsleepせず次SELECTへ
  進み、候補なし/成功/3回missで終了する。winnerだけがrealtime eventをpublishする。
- Scope: Implementation Queueの既存candidate window/lease処理は変更しない。汎用retry helperや無限loopを追加しない。
- Done: 1件目CAS loss後に2件目をclaimし、全3回contention時はnull、query/update回数が上限を超えない。

## 9. Verification matrix

| Scenario | Run | Task | Queue | Expected |
| --- | --- | --- | --- | --- |
| runtime complete vs stop | completed | completed projection | execution_completed等 | stop側CAS conflict/replay |
| stale recovery vs heartbeat | active | active | processing | recoveryは更新しない |
| processing cancel | cancelled | ready/cancel projection | cancelled | active runtime停止済み |
| needs_human resume | needs_human -> active | active projection | claimed -> processing | valid leaseあり |
| duplicate admission | unchanged/one run only | queued | one nonarchive entry | one insertのみ |
| claim CAS loss | next task active | running | legacy queue対象外 | 次候補へ進む |

## 10. Verification commands

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

## 11. Rollout

1. 新CAS repository APIと観測eventを追加する。
2. terminal callerを一つずつ共通commandへ移す。
3. 全caller移行後に無条件terminal updateをarchitecture/static checkで禁止する。
4. Queue commandを状態別APIへ移す。
5. duplicate preflightを実データへread-only実行する。
6. 重複なしを確認してpartial unique migrationを適用する。
7. generic status updaterをrepository内部へ閉じる。

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| CAS導入で従来成功していた操作が409になる | conflict resultに最新snapshotを含め、clientが再取得できるようにする |
| DB commit後、side effect前にprocess crash | outbox/idempotent retryを使用する |
| Task projectionが人手変更を上書きする | expected Task versionを必須にし、conflict evidenceを残す |
| partial unique migrationが既存重複で失敗 | preflightし、自動削除せず手動解決する |
| resume設計でRunが二重起動する | worker lease取得とactiveRunId CASを同一transactionにする |

## 13. Completion criteria

1. `C4`の4競合経路すべてがCASで保護される。
2. Run、Task、Queueのterminal projectionがtransactionalに一致する。
3. Queue cancel/resumeがleaseとactive Runを検証する。
4. 同一Taskに非archive Queue Entryを複数insertできない。
5. CAS loss後のlegacy claimが次候補へ進む。
6. 無条件`updateTaskRun`/`updateTaskStatus`がterminal application pathに残っていない。
7. Area Aのbackground cleanup integrationを含むrace testと限定verificationが成功する。
