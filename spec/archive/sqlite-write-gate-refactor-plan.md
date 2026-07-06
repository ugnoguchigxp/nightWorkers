# SQLite Write Gate Refactor Implementation Plan

## Purpose

NightWorkers の SQLite 書き込み直列化を、現在の挙動を変えずに読みやすい責務へ分離する。

現状は `api/db/client.ts` が次の責務を同時に持っている。

- libSQL client の生成。
- Drizzle client の生成。
- `SQLITE_BUSY` retry wrapper。
- write / read 判定。
- process-local write serialization gate。
- transaction の commit / rollback / close までの lock 保持。

この計画の目的は、DB アクセスの全面抽象化ではない。既に動いている process-local write gate を小さな DB infrastructure module に切り出し、transaction / batch / write pragma の直列化をテストで固定する。

## Confirmed Baseline

現在の実装:

- `api/db/client.ts` の `createWriteSerialGate()` が Promise tail で同一 process 内の write を直列化している。
- `wrapClientWithBusyRetry(baseClient)` が `execute`, `batch`, `migrate`, `executeMultiple`, `transaction` を proxy している。
- `select`, read-only `pragma`, `explain` は直列化対象外である。
- `PRAGMA journal_mode = WAL` のような write pragma は直列化対象になる。
- `transaction` は gate を acquire し、wrapped transaction の `commit`, `rollback`, `close` で release する。
- `api/db/retry.ts` が `SQLITE_BUSY`, `database is locked`, `cannot commit transaction` を retry する。
- 起動時の `ensureNightWorkersSchema()` は `PRAGMA busy_timeout = 10000` と `PRAGMA journal_mode = WAL` を設定する。

既存の focused test:

```bash
bun run test run tests/db-client-retry.test.ts tests/implementation-queue-resilience.test.ts tests/implementation-queue-scheduling-lock.test.ts
```

2026-07-06 時点の確認では上記 3 files / 17 tests は通過している。

## Scope

In scope:

- `api/db/client.ts` から write gate と SQL read/write 判定を切り出す。
- `wrapClientWithBusyRetry` の公開 API 互換を維持する。
- transaction 中に後続 write が開始されないことをテストで固定する。
- rollback / close 時にも gate が release されることをテストで固定する。
- read-only pragma と write pragma の判定をテストで固定する。
- focused test と repo-native verify gate を明記する。

Out of scope:

- 全 repository を新しい domain-level DB handler に移すこと。
- Queue / activity ledger / runtime の domain model を変更すること。
- DB schema や migration を変更すること。
- 複数 OS process をまたぐ single writer daemon / IPC を作ること。
- provider / supervisor / worker runtime の実行判断を変更すること。
- SQLite 以外の DB backend 対応を広げること。

## Implementation Invariants

実装中に守る不変条件:

- 書き込み直列化の挙動は変えない。
- `wrapClientWithBusyRetry` は既存 import のために残す。
- `db` / `client` の export shape は変えない。
- read-only query は引き続き gate を待たない。
- unknown statement は conservative に write 扱いにする。
- transaction は commit / rollback / close のいずれかまで gate を保持する。
- transaction の開始に失敗した場合は acquire 済み gate を release する。
- `withSqliteBusyRetry` の retry 対象と delay policy はこの計画では変えない。

## Target File Layout

最終形:

```text
api/db/client.ts
api/db/retry.ts
api/db/sqlite-write-gate.ts
api/db/sqlite-client-wrapper.ts
tests/db-client-retry.test.ts
```

役割:

- `api/db/client.ts`
  - config から libSQL client を作る。
  - `wrapClientWithBusyRetry` を適用する。
  - Drizzle `db` を export する。
- `api/db/retry.ts`
  - busy retry policy のみを持つ。
- `api/db/sqlite-write-gate.ts`
  - `createWriteSerialGate`。
  - `statementSql`。
  - `isReadOnlyPragma`。
  - `isWriteStatement`。
  - `batchContainsWrite`。
- `api/db/sqlite-client-wrapper.ts`
  - `wrapTransactionWithBusyRetry`。
  - `wrapClientWithBusyRetry`。
  - 必要なら内部名として `wrapClientWithSqliteRetryAndWriteGate` を追加し、`wrapClientWithBusyRetry` は互換 alias として export する。
- `tests/db-client-retry.test.ts`
  - existing tests を維持する。
  - 追加の serialization tests を持つ。

## First Implementation Slice

最初の実装は、ファイル分割と test 追加だけで止める。

この slice でやること:

1. `api/db/sqlite-write-gate.ts` を追加する。
2. `api/db/sqlite-client-wrapper.ts` を追加する。
3. `api/db/client.ts` から helper 実装を削り、wrapper import に置き換える。
4. `wrapClientWithBusyRetry` の export 互換を残す。
5. `tests/db-client-retry.test.ts` に transaction gate の regression tests を追加する。
6. focused tests を通す。

この slice でやらないこと:

- repository call site の変更。
- Queue claim / lease logic の変更。
- schema bootstrap の変更。
- `api/db/retry.ts` の policy 変更。
- full tree の unrelated lint cleanup。

## Implementation Plan

### Phase 0. Baseline

目的:

変更前の DB serialization behavior を固定する。

Commands:

```bash
bun run test run tests/db-client-retry.test.ts
bun run test run tests/implementation-queue-resilience.test.ts tests/implementation-queue-scheduling-lock.test.ts
```

Expected result:

- 既存 test が通る。
- 失敗する場合は、リファクタリングに入る前に現状不具合として切り分ける。

### Phase 1. Extract Write Gate Helpers

目的:

SQL 判定と gate を `client.ts` から分離する。

Add:

- `api/db/sqlite-write-gate.ts`

Move from `api/db/client.ts`:

- `type StatementLike`
- `READ_ONLY_SQL_PREFIXES`
- `createWriteSerialGate`
- `statementSql`
- `isReadOnlyPragma`
- `isWriteStatement`
- `batchContainsWrite`

Export:

```ts
export type StatementLike = string | { sql?: string } | [string, unknown?];

export function createWriteSerialGate(): {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  acquire(): Promise<() => void>;
};

export function isWriteStatement(statement: StatementLike | undefined): boolean;
export function batchContainsWrite(statements: unknown[]): boolean;
```

Notes:

- `statementSql` と `isReadOnlyPragma` は test で直接使う必要がなければ non-export でよい。
- read-only pragma 判定は現状の正規表現を維持する。
- unknown / empty SQL は write 扱いを維持する。

### Phase 2. Extract Client Wrapper

目的:

retry + write gate proxy を `client.ts` から分離する。

Add:

- `api/db/sqlite-client-wrapper.ts`

Move from `api/db/client.ts`:

- `wrapTransactionWithBusyRetry`
- `wrapClientWithBusyRetry`

Import:

```ts
import { type Client, type Transaction } from '@libsql/client';
import { withSqliteBusyRetry } from './retry';
import { batchContainsWrite, createWriteSerialGate, isWriteStatement } from './sqlite-write-gate';
```

Compatibility:

```ts
export function wrapClientWithBusyRetry(baseClient: Client): Client {
  // Existing behavior.
}
```

Optional internal naming:

```ts
export const wrapClientWithSqliteRetryAndWriteGate = wrapClientWithBusyRetry;
```

Do not require call sites to migrate to the longer name in this slice.

### Phase 3. Slim Down `client.ts`

目的:

`api/db/client.ts` を DB composition file に戻す。

Update:

- Remove moved helper definitions.
- Import wrapper:

```ts
import { wrapClientWithBusyRetry } from './sqlite-client-wrapper';
```

Keep:

- `client` export.
- `db` export.
- `DbTransaction` type export.
- schema imports.
- `createClient` config URL logic.

Expected shape:

```ts
export const client = wrapClientWithBusyRetry(
  createClient({
    url: config.DATABASE_URL.startsWith('file:')
      ? config.DATABASE_URL
      : `file:${config.DATABASE_URL}`,
  })
);

export const db = drizzle(client, { schema: { ... } });
```

### Phase 4. Add Regression Tests

目的:

現状の一番重要な保証を test name から読めるようにする。

Update:

- `tests/db-client-retry.test.ts`

Keep existing tests:

- retries client execute on `SQLITE_BUSY`
- retries transaction execute and commit on `SQLITE_BUSY`
- serializes write executes while leaving read executes unconstrained

Add tests:

1. `holds the write gate for an open transaction until commit`
   - Start `client.transaction('write')`.
   - Keep the transaction open.
   - Start `client.execute('insert ...')`.
   - Assert the later write has not started while transaction is open.
   - Commit transaction.
   - Assert later write starts after commit.

2. `releases the write gate when a transaction rolls back`
   - Start transaction.
   - Start later write.
   - Rollback transaction.
   - Assert later write completes.

3. `releases the write gate when a transaction closes`
   - Start transaction.
   - Start later write.
   - Close transaction.
   - Assert later write completes.

4. `serializes write pragmas but not read-only pragmas`
   - Hold a long write.
   - Start `client.execute('PRAGMA table_info(tasks)')`.
   - Start `client.execute('PRAGMA journal_mode = WAL')`.
   - Assert read-only pragma can start before long write finishes.
   - Assert write pragma waits.

5. `serializes unknown statements conservatively`
   - Call `client.execute({ sql: undefined } as never)` or equivalent safe mock input.
   - Assert it behaves as write and waits behind an active write.

Test implementation notes:

- Use mock `Client` object as existing tests do.
- Use `started` / `finished` arrays and externally resolved promises.
- Avoid real SQLite files for these tests.
- Use `await Promise.resolve()` only for microtask progression; avoid arbitrary sleeps.

### Phase 5. Verify Queue-facing Behavior Still Holds

目的:

DB wrapper refactor が queue lease / scheduling lock に影響していないことを確認する。

Commands:

```bash
bun run test run tests/db-client-retry.test.ts tests/implementation-queue-resilience.test.ts tests/implementation-queue-scheduling-lock.test.ts
```

Expected result:

- All targeted tests pass.
- Queue tests に失敗が出る場合は、wrapper extraction で transaction semantics が変わった可能性を先に疑う。

### Phase 6. Final Gate

目的:

repo-native gate で計画 slice を閉じられる状態にする。

Commands:

```bash
bun run verify:fast
```

If this slice is being prepared for merge or broader cleanup:

```bash
bun run verify
```

Expected result:

- `verify:fast` が通る。
- `verify` を実行した場合は、既存の unrelated dirty-tree failure と今回変更の failure を分けて報告する。

## Failure Handling

`tests/db-client-retry.test.ts` が失敗した場合:

- `execute` write serialization だけが失敗するなら、`isWriteStatement` / `batchContainsWrite` の移植ミスを確認する。
- transaction serialization が失敗するなら、`wrapTransactionWithBusyRetry` が commit / rollback / close まで release を遅らせているか確認する。
- read-only pragma test が失敗するなら、`isReadOnlyPragma` の正規表現が変わっていないか確認する。
- retry test が失敗するなら、`withSqliteBusyRetry` の呼び出し位置を確認する。

Queue tests が失敗した場合:

- `db.transaction` の proxy が Drizzle/libSQL から見て同じ shape を保っているか確認する。
- transaction callback 内の `tx.insert/update/select` が wrapper 変更後も同じ transaction に乗っているか確認する。
- wrapper extraction 以外の queue code を変更していないか確認する。

`verify:fast` が失敗した場合:

- まず今回触った files 由来かを切り分ける。
- unrelated dirty-tree failure なら、今回の refactor の成否とは分けて報告する。
- formatter failure なら `bun run format` ではなく、差分範囲を確認して必要最小の formatting に留める。

## Completion Criteria

この計画は次を満たしたら完了とする。

- `api/db/client.ts` から write gate / SQL判定 / transaction wrapper が分離されている。
- `wrapClientWithBusyRetry` の既存 import が壊れていない。
- `db` / `client` / `DbTransaction` の export が変わっていない。
- `tests/db-client-retry.test.ts` が transaction gate を含む regression coverage を持っている。
- Targeted queue tests が通っている。
- `bun run verify:fast` が通る、または unrelated failure として根拠付きで分離できている。

## Follow-up Candidates

この計画の後に検討するが、同じ slice では実施しない。

- process-local gate ではなく app-level single writer が必要かを、packaged app / sidecar / worker process 構成から判断する。
- activity ledger の flush queue と DB write gate の関係を可視化する。
- DB write metrics を追加し、write queue wait time / retry count を観測する。
- `wrapClientWithBusyRetry` という名前が実態より狭いので、互換期間後に `wrapClientWithSqliteRetryAndWriteGate` へ移行する。
