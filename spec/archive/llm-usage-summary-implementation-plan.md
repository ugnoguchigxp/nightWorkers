# LLM Usage Summary Implementation Plan

## Status

implemented

## Goal

Overview の LLM usage / cost 集計を、表示のたびに `llm_usage_records` 全行を読み込んでメモリ上で集計する構造から、保存時に更新される summary table を優先して読む構造へ移行する。

初期実装の対象は Overview の集計指標である。`recentExpensiveCalls` のような詳細行リストは、bounded query として raw row を読む余地を残すが、総量・日次推移・model breakdown・cost totals は summary 由来にする。

## Current Baseline

現状の Overview は `api/services/overview/index.ts` の `buildOverviewDashboard()` で以下を行っている。

- `llm_usage_records` と `tasks` を join し、range / repository filter を掛ける。
- 取得した usage rows を TypeScript の loop で集計する。
- 各 row ごとに `findPricingForUsage()` を呼び、`calculateUsageCost()` と FX conversion を実行する。
- 同じ loop で `usage`、`dailyUsage`、`modelBreakdown`、`cost`、`warnings`、`recentExpensiveCalls` を作る。

既存の DB 定義は以下。

- `api/db/schema.ts`
  - `llmUsageRecords`
  - `llmModelPricing`
- `api/db/bootstrap.ts`
  - `llm_usage_records`
  - `llm_model_pricing`
- `drizzle/migrations/0009_llm_usage_records.sql`
- `drizzle/migrations/0010_llm_model_pricing.sql`

usage 保存の入口は `api/services/llm-usage/repository.ts` の `recordLlmUsage()` に集約されているため、incremental summary 更新もここに寄せる。

## Design Decision

### Summary view ではなく summary table を採用する

SQLite view は raw rows の再集計を隠すだけで、今回の問題である表示時 I/O と pricing lookup 回数を減らせない。

初期実装では summary table を追加する。理由は以下。

- usage 保存時に token / duration / mode counts を増分更新できる。
- pricing import 後の backfill で cost summary だけを再計算できる。
- integrity check で raw rows と summary の差分を検出できる。
- Overview は summary table を読むだけで主要指標を組み立てられる。

### 集計粒度

Overview は `24h` では hour bucket、`7d` / `30d` では day bucket、`all` では month bucket を表示する。timezone も入力に含まれる。

そのため summary table は day 固定ではなく、UTC hour bucket を最小粒度にする。Overview 側で hour buckets を timezone に合わせて day / month へ rollup する。

summary key:

- `bucket_hour_utc`
- `repository_id`
- `provider`
- `model`
- `pricing_currency_code`
- `pricing_status`

`repository_id` は `llm_usage_records.task_id -> tasks.repository_id` を保存時に解決して denormalize する。task が後で別 repo に移動する設計ではないため、表示時 join を減らす目的を優先する。

## Data Model

### `llm_usage_summary_buckets`

次の Drizzle migration で追加する。

```sql
CREATE TABLE IF NOT EXISTS llm_usage_summary_buckets (
  id text PRIMARY KEY NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  bucket_hour_utc integer NOT NULL,
  repository_id text,
  provider text NOT NULL,
  model text,
  pricing_currency_code text,
  pricing_status text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  reasoning_output_tokens integer NOT NULL DEFAULT 0,
  system_prompt_tokens integer NOT NULL DEFAULT 0,
  user_prompt_tokens integer NOT NULL DEFAULT 0,
  state_card_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  total_duration_ms integer NOT NULL DEFAULT 0,
  output_duration_ms integer NOT NULL DEFAULT 0,
  call_count integer NOT NULL DEFAULT 0,
  measured_call_count integer NOT NULL DEFAULT 0,
  estimated_call_count integer NOT NULL DEFAULT 0,
  mixed_call_count integer NOT NULL DEFAULT 0,
  unavailable_call_count integer NOT NULL DEFAULT 0,
  priced_call_count integer NOT NULL DEFAULT 0,
  unpriced_call_count integer NOT NULL DEFAULT 0,
  manual_priced_call_count integer NOT NULL DEFAULT 0,
  estimated_cost real NOT NULL DEFAULT 0,
  input_cost real NOT NULL DEFAULT 0,
  cached_input_cost real NOT NULL DEFAULT 0,
  output_cost real NOT NULL DEFAULT 0,
  reasoning_output_cost real NOT NULL DEFAULT 0,
  pricing_updated_at integer
);
```

Indexes:

- unique: `(bucket_hour_utc, repository_id, provider, model, pricing_currency_code, pricing_status)`
- range filter: `(bucket_hour_utc)`
- repository range filter: `(repository_id, bucket_hour_utc)`
- model breakdown: `(provider, model, bucket_hour_utc)`

`model` と `repository_id` は nullable なので、unique key の扱いは SQLite の nullable unique 挙動に注意する。実装時は `coalesce(model, '')` / `coalesce(repository_id, '')` 相当の normalized key column を持たせるか、Drizzle で扱いやすい `repository_key` / `model_key` を追加する。

### `llm_usage_summary_warnings`

warning は cost summary と分離する。

```sql
CREATE TABLE IF NOT EXISTS llm_usage_summary_warnings (
  id text PRIMARY KEY NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  bucket_hour_utc integer NOT NULL,
  repository_id text,
  provider text NOT NULL,
  model text,
  code text NOT NULL,
  detail_key text NOT NULL,
  detail_json text,
  call_count integer NOT NULL DEFAULT 0
);
```

unique:

- `(bucket_hour_utc, repository_id, provider, model, code, detail_key)`

初期対象の warning:

- `pricing_missing`
- `usage_token_anomaly`
- `usage_estimated`

`fx_unavailable` は request currency と FX cache に依存するため、保存時 warning には入れない。Overview が summary の `pricing_currency_code` ごとに display currency へ変換する時点で従来通り算出する。

## Implementation Tasks

### Task 1: Baseline と schema 存在確認

Read first:

- `api/services/overview/index.ts`
- `api/services/llm-usage/repository.ts`
- `api/services/pricing/index.ts`
- `api/db/schema.ts`
- `api/db/bootstrap.ts`
- `tests/nightworkers-routes/routes-nightworkers-02.test.ts`
- `tests/nightworkers-routes/routes-nightworkers-05.test.ts`

Confirm:

- `sqlite_master` に `llm_usage_summary_%` table / view が存在しないこと。
- `buildOverviewDashboard()` が raw `llm_usage_records` query から主要集計を作っていること。
- `recordLlmUsage()` が usage 保存の単一入口として使えること。

Acceptance:

- 実装前の Overview response shape と主要値をテストで固定できる。
- 既存テストが summary 未導入状態の baseline として説明できる。

### Task 2: Summary schema / bootstrap / migration を追加する

Change:

- `api/db/schema.ts` に `llmUsageSummaryBuckets` と `llmUsageSummaryWarnings` を追加する。
- `api/db/bootstrap.ts` に `CREATE TABLE IF NOT EXISTS` と indexes を追加する。
- 次の Drizzle migration を追加する。

Acceptance:

- fresh DB bootstrap で summary tables が作成される。
- migration 適用済み DB でも同じ schema になる。
- nullable unique key 問題を避ける normalized key の扱いが明示されている。

Targeted verification:

```bash
bun run typecheck
```

### Task 3: Summary updater を `llm-usage` service に追加する

Change:

- `api/services/llm-usage/summary.ts` を追加する。
- `recordLlmUsage()` の insert 成功後に `upsertLlmUsageSummaryForRecord(record)` を呼ぶ。
- updater は同一 transaction または同等に失敗境界が分かる形にする。
- summary 更新失敗時に raw usage record だけ成功して終わる設計にしない。失敗時は呼び出し元に例外を返し、integrity が崩れたまま成功扱いにしない。

Updater responsibilities:

- `task_id` から `repository_id` を解決する。
- `created_at` を UTC hour bucket に丸める。
- usage tokens / duration / mode counts を加算する。
- `findPricingForUsage()` と `calculateUsageCost()` で cost を保存時点の pricing として加算する。
- pricing missing / token anomaly を `llm_usage_summary_warnings` に加算する。
- pricing row の `fetchedAt` 最大値を summary に保存する。

Acceptance:

- `recordLlmUsage()` を呼ぶ既存テストで summary row も作成される。
- 同一 bucket / repository / provider / model / currency / status の 2 件目は insert ではなく加算更新される。
- `call_id` unique failure など raw insert failure 時に summary は増えない。

Targeted tests:

- `tests/nightworkers-routes/routes-nightworkers-02.test.ts`
- `tests/nightworkers-routes/routes-nightworkers-05.test.ts`
- 新規 `tests/services.llm-usage-summary.test.ts`

### Task 4: Overview を summary 優先に切り替える

Change:

- `api/services/overview/index.ts` の主要集計 query を summary table 読みに置き換える。
- `usage`、`dailyUsage`、`modelBreakdown`、`cost`、`warnings` は summary table / warning table から組み立てる。
- `recentExpensiveCalls` は bounded detail list として raw `llm_usage_records` を読む。ただし range / repository filter / limit を DB query 側で適用し、主要集計 loop とは分離する。
- summary が空で raw rows が存在する既存 DB では、空表示にせず backfill required warning を返すか、起動時 / route 内で軽量 backfill へ誘導する。暗黙に raw full scan fallback しない。

Acceptance:

- Overview の totals / daily buckets / model breakdown は summary table の値だけで返る。
- `recentExpensiveCalls` は最大 12 件の詳細表示として raw rows を読む。
- 既存 response contract は維持される。
- summary が未作成の古い DB では、状態が検知可能で、raw full scan に戻って完了扱いにならない。

Targeted tests:

- route test で Overview response が既存期待値を維持する。
- summary table にだけ値を入れた fixture で Overview が usage / cost を返す。
- raw rows があって summary が空の fixture で `summary_backfill_required` warning が返る。

### Task 5: Backfill command を追加する

Change:

- `api/scripts/backfill-llm-usage-summary.ts` を追加する。
- package script は `llm-usage:backfill-summary` とする。
- option:
  - `--since <iso>`
  - `--repository-id <id>`
  - `--dry-run`
  - `--reset`
- backfill は raw rows を deterministic に読み、summary tables を再構築する。
- pricing import 後に cost を再計算したい場合は `--reset` 付き backfill を使う。

Acceptance:

- empty summary DB に対して backfill 後、Overview が summary 由来で既存値を返す。
- `--dry-run` は更新せず対象件数と想定 bucket 数を出す。
- `--reset` は対象範囲の summary を消してから再集計する。

### Task 6: Integrity check を追加する

Change:

- `api/scripts/check-llm-usage-summary-integrity.ts` を追加する。
- package script は `llm-usage:check-summary` とする。
- raw aggregate と summary aggregate を、repository / hour / provider / model 単位で比較する。
- 初期比較対象は tokens / duration / call counts / priced-unpriced counts とする。
- cost 差分は floating point tolerance を設定する。

Acceptance:

- 正常 DB では exit code 0。
- summary row を意図的に壊した fixture では exit code 1 と差分 details。
- integrity check の出力は raw rows 全文ではなく差分 summary に限定する。

### Task 7: Pricing import 後の再集計導線を接続する

Change:

- pricing import は summary を直接更新しない。
- import 成功 response に `llmUsageSummaryBackfillRecommended: true` と対象 effective range を返す、または Settings UI から backfill command を案内できる状態にする。
- 自動 backfill は初期実装では行わない。pricing import は外部 fetch を含むため、usage summary 再計算と失敗境界を分ける。

Acceptance:

- pricing import 後に summary cost が古い可能性を UI / API で検知できる。
- backfill 実行後に `pricingUpdatedAt` と estimated cost が更新される。

## Verification Plan

Focused commands:

```bash
bun run test run tests/nightworkers-routes/routes-nightworkers-02.test.ts tests/nightworkers-routes/routes-nightworkers-05.test.ts tests/services.llm-usage-summary.test.ts
bun run typecheck
bun run verify:base
```

Manual DB checks:

```sql
SELECT name, type FROM sqlite_master WHERE name LIKE 'llm_usage_summary_%';
SELECT count(*) FROM llm_usage_summary_buckets;
SELECT count(*) FROM llm_usage_summary_warnings;
```

Behavior checks:

- New `recordLlmUsage()` creates both raw record and summary bucket.
- Overview `usage.callCount` equals summary bucket call count, not raw row loop output.
- `dailyUsage` still fills empty buckets for `24h` / `7d` / `30d`.
- `modelBreakdown` ordering remains by `totalTokens`.
- Missing pricing still returns `pricing_missing`.
- FX unavailable still returns `fx_unavailable` from request-time currency conversion.
- `recentExpensiveCalls` remains populated and capped at 12 rows.
- Backfill produces the same Overview totals as the pre-summary raw aggregate baseline for the same fixture.
- Integrity check catches manual summary corruption.

## Completion Conditions

- `llm_usage_summary_buckets` and `llm_usage_summary_warnings` exist in Drizzle schema, bootstrap, and migration.
- `recordLlmUsage()` updates summary tables on every successful usage record insert.
- Overview major aggregates read summary tables first and do not full-scan raw usage rows for totals.
- Raw usage row reading remains only for bounded detail lists such as `recentExpensiveCalls`.
- A backfill command can rebuild summary tables from existing raw records.
- An integrity check can compare summary against raw records and fail on mismatch.
- Focused tests and `bun run verify:base` pass, or any unrelated failure is separated with concrete evidence.

## Out Of Scope

- Project Detail の task-level `summarizeLlmUsageForTask()` を summary table に移行すること。
- Overview UI の大きな redesign。
- pricing import 後の自動 backfill 実行。
- raw `llm_usage_records` の削除。
- provider pricing の意味変更、token 正規化ルールの変更、FX cache 実装の変更。

## Risks

- UTC hour bucket から user timezone day bucket へ rollup する際、DST 境界で bucket 表示がずれる可能性がある。既存 `getBucketKey()` 相当の表示ロジックを reuse して確認する。
- SQLite nullable unique key は重複 summary row を許す可能性がある。normalized key column を持たせて避ける。
- pricing が後から追加された場合、保存時 summary の cost は古くなる。backfill と stale warning を完了条件に含める。
- summary 更新を raw insert と別失敗境界にすると integrity が崩れる。transaction 化または失敗時の明確な rollback が必要。
