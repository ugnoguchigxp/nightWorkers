# Runtime Log Retention・容量制御 実装計画

## Status

- Plan status: `completed`
- Document created: 2026-07-12
- Last reviewed: 2026-07-12
- Implementation status: `completed`
- Target runtime span: API 起動、通常ログ追記、LLM request / response trace、SQLite usage 集計、保持期限 cleanup
- Target domains:
  - `api/lib/logger.ts`
  - `api/runtime`
  - `api/server.ts`
  - `api/services/settings/general-settings.ts`
  - `api/services/llm-usage`
  - `api/db`
  - `api/modules/overview`
  - `src/modules/settings`
  - `src/modules/overview`
  - `tests`

この文書を、`.nightworkers/logs` と関連する SQLite 観測データを無期限に増加させず、短期障害調査と有限期間の傾向確認を両立させる実装正本とする。

実装済み: 2026-07-12。保持処理は起動時と定期実行で動作し、設定は General Settings API の `dataRetention` として保存される。

## 1. 確定した保持契約

保持期間は次で固定する。

| データ区分 | 対象 | 保持期間 |
| --- | --- | ---: |
| API 運用ログ | `api.log` | 7日 |
| LLM 生ログ | `llm-trace.jsonl` の system prompt、user prompt、raw response、provider debug | 3日 |
| LLM 解析失敗 preview | `supervisor-trace.log` の raw response preview | 3日 |
| 利用量・性能・障害集計 | `llm_usage_records` と usage summary buckets / warnings | 30日 |
| 保持処理の監査イベント | rotation、cleanup、容量超過、cleanup failure、設定変更 | 90日 |

保持期限と容量上限が競合した場合は、先に到達した条件を採用する。保持期間内であっても容量上限を超える古い世代は削除できる。

## 2. 現状と問題

### 2.1 ファイルログが追記専用である

`api/lib/logger.ts` は runtime root の `logs` directory に次の3ファイルを作り、すべて `appendFile` で追記している。

- `api.log`
- `llm-trace.jsonl`
- `supervisor-trace.log`

日次切替、size rotation、圧縮、期限削除、総容量判定がない。API process を再起動しても同じファイルへの追記を再開する。

### 2.2 LLM trace が本文を重複保存する

`llm-trace.jsonl` は request に system prompt / user prompt、response に raw response と provider debug を保存する。task message、activity event、LLM usage record に残る正本・観測値とは別に、生本文が filesystem へ重複して蓄積する。

LLM trace は provider failure や Workbench intake failure の短期調査には有用だが、長期保存するデータではない。

### 2.3 SQLite 集計にも期限削除がない

`llm_usage_records`、`llm_usage_summary_buckets`、`llm_usage_summary_task_buckets`、`llm_usage_summary_warnings` は追加・upsert されるが、通常運用の期限削除がない。Overview の `all` range は無期限保存を前提に見えるため、30日保持後の意味も明示する必要がある。

### 2.4 cleanup 自体の監査先がない

削除結果を通常の `api.log` だけへ記録すると、その記録も7日で消える。保持処理がいつ、何を、どれだけ削除したかを90日間確認するための bounded な監査台帳が必要である。

## 3. 目的

- 通常運用中の `.nightworkers/logs` を有限容量に保つ。
- LLM 生本文は3日を超えて保持しない。
- プロセス停止期間を挟んでも、次回起動時に期限切れデータを確実に回収する。
- 突発的な大量 LLM 出力に対して、日数だけでなく record / segment / directory の容量で抑止する。
- cleanup failure によって API 起動やログ書込みを停止させず、次回周期で再試行する。
- task message、artifact、run outcome、Review evidence、archive record などの product 正本を保持処理の対象にしない。
- 保持処理の結果を90日間追跡できるようにする。

## 4. 対象外

- task、task message、artifact、run、Review / Test evidence の lifecycle 再設計。
- provider 呼出し契約や Supervisor prompt の変更。
- 外部 log service、object storage、クラウド監視基盤の導入。
- compliance archive や legal hold。
- `.nightworkers-e2e`、demo runtime、登録 Project 配下の application log の cleanup。
- event 本文を文字列内容、正規表現、keyword で分類する実装。

## 5. 不変条件

- log category は writer が渡す明示 descriptor で決める。本文解析で分類しない。
- active file の安定名は維持し、既存の運用コマンドや packaged desktop smoke を壊さない。
- 1 category 内の append、rotation、compression、deletion は同一の直列 queue で実行する。
- rotation 中に成功確認前の active file を削除しない。
- cleanup 対象は runtime root 配下の管理対象 filename pattern と DB table allowlist に限定する。
- path traversal、symlink、未知のファイルは削除しない。
- cleanup failure は fail-open とし、ログ本体・API・LLM response を固定エラーへ置換しない。
- 期限境界は UTC timestamp で判定し、`age > retention` のデータだけを削除する。
- 容量超過時は closed segment の古い順に削除する。最新の active record を優先して残す。
- task との参照関係を持つ正本データを、容量確保だけを理由に cascade delete しない。

## 6. 設定契約

`GeneralSettings` に `dataRetention` を追加する。

```ts
type DataRetentionSettings = {
  apiLogDays: 7;
  llmRawLogDays: 3;
  usageDataDays: 30;
  auditEventDays: 90;
  apiLogMaxBytes: number;
  llmRawLogsMaxBytes: number;
  runtimeLogsMaxBytes: number;
  apiSegmentMaxBytes: number;
  llmSegmentMaxBytes: number;
  sweepIntervalMinutes: number;
};
```

初期既定値:

```ts
{
  apiLogDays: 7,
  llmRawLogDays: 3,
  usageDataDays: 30,
  auditEventDays: 90,
  apiLogMaxBytes: 16 * 1024 * 1024,
  llmRawLogsMaxBytes: 64 * 1024 * 1024,
  runtimeLogsMaxBytes: 80 * 1024 * 1024,
  apiSegmentMaxBytes: 4 * 1024 * 1024,
  llmSegmentMaxBytes: 8 * 1024 * 1024,
  sweepIntervalMinutes: 60
}
```

設定 validation:

- 保持日数は上記の確定値を default とする。
- 数値は有限の正整数だけを受理する。
- `apiLogMaxBytes <= runtimeLogsMaxBytes` と `llmRawLogsMaxBytes <= runtimeLogsMaxBytes` を必須にする。
- segment 上限は category 上限より小さくする。
- 不正値を黙って危険な値へ丸めない。Settings API は validation error を返し、既存値を維持する。
- 初期実装では保持日数を短くする変更のみ許可し、確定値より長い設定は受理しない。容量上限にも実装定数の安全な最大値を置く。
- writer は毎回 DB を読まず、起動時と Settings 保存成功時に validation 済み snapshot を更新する。

Settings General に「データ保持」section を追加し、日数と容量上限、現在の使用量、次回 cleanup 時刻を表示する。UI を追加する場合も、manual cleanup button は初期 scope に含めない。

## 7. ファイルログ設計

### 7.1 管理対象

```text
api.log
llm-trace.jsonl
supervisor-trace.log
api.<UTC timestamp>.<sequence>.log.gz
llm-trace.<UTC timestamp>.<sequence>.jsonl.gz
supervisor-trace.<UTC timestamp>.<sequence>.log.gz
```

active filename は現状を維持する。closed segment だけ timestamp 付きへ rename し、gzip 完了後に `.gz` とする。起動時 sweeper は crash 後に残った未圧縮 closed segment も再処理する。

### 7.2 rotation 条件

次のいずれかで rotation する。

- UTC 日付が active segment の開始日から変わった。
- 次の append を加えると segment 上限を超える。
- category / directory 容量上限を維持するため active file を閉じる必要がある。

日付だけに依存せず size rotation を必須にする。これにより、1日以内の大量 LLM traffic でも単一ファイルが増え続けない。

### 7.3 単一 record 上限

1件の巨大 prompt / response が segment 上限を無効化しないよう、LLM trace の serialized record を最大2 MiBに制限する。

- `systemPrompt`、`userPrompt`、`rawContent`、`providerDebug` の順序と category を明示して、合計上限内に収める。
- 切詰め時も元の byte length、SHA-256、`truncated: true`、保存 byte 数を残す。
- 生本文の切詰めは head / tail preview とし、中間を省略したことを明示する。
- API log の1行上限は64 KiBとし、巨大 meta は同様に length / hash / truncated marker へ置換する。
- 切詰め判断は logger helper 内の構造化 field 単位で行い、ユーザー文言の内容分類はしない。

### 7.4 append の直列化

現在の fire-and-forget `mkdir -> appendFile` を、category ごとの promise chain を持つ `RuntimeLogWriter` へ置き換える。

```text
append request
  -> serialize / bound record
  -> current segment state read
  -> rotate if date or size threshold reached
  -> enforce category and global capacity
  -> append active file
  -> update in-memory size state
```

同時 append が同じ active file を二重 rotate しないこと、process shutdown 時に queue を flush できることを契約にする。

### 7.5 期限削除と容量削除

削除順序:

1. retention cutoff を超えた closed segment を削除する。
2. category 上限超過時、当該 category の closed segment を古い順に削除する。
3. global 80 MiB 超過時、期限が短い LLM raw closed segment、API closed segment の順で、各 category 内は古い順に削除する。
4. active file だけで上限を超える場合は即時 rotate し、closed segment として同じ順序で再評価する。

`supervisor-trace` は raw response preview を含むため、`llm-trace` と同じ3日 category / 64 MiB 合算上限へ入れる。

## 8. SQLite 保持設計

### 8.1 30日対象

次を UTC cutoff より古い行から bounded batch で削除する。

- `llm_usage_records.created_at`
- `llm_usage_summary_buckets.bucket_hour_utc`
- `llm_usage_summary_task_buckets.bucket_hour_utc`
- `llm_usage_summary_warnings.bucket_hour_utc`

1 transaction で全件削除せず、1 batch 1,000行を上限にする。summary は raw record の削除後も再生成しないため、同じ cleanup run 内で4 table の cutoff を揃える。

`activity_events` にある `llm.usage` event や、task / run timeline 全体はこの30日 cleanup に含めない。これらを一律削除すると task history と Review evidence の意味が変わるため、別 lifecycle が合意されるまで正本側として扱う。

### 8.2 90日監査台帳

専用の `runtime_retention_audit_events` table を追加する。

```text
id
event_type
status
started_at
finished_at
settings_snapshot_json
files_scanned
files_rotated
files_deleted
bytes_before
bytes_deleted
bytes_after
rows_deleted_json
error_summary
created_at
```

保存する event type は explicit enum とする。

- `retention.sweep_started`
- `retention.sweep_completed`
- `retention.sweep_failed`
- `retention.capacity_eviction`
- `retention.settings_changed`

prompt、response、task message、API request body、削除ファイル本文は監査台帳へ入れない。監査台帳自身は90日 cutoff で削除する。

### 8.3 SQLite file size

row delete 後の free page は SQLite が後続 write で再利用するため、最初の完了条件は「期限切れ row が消え、複数 cleanup cycle 後に page count の増加が収束すること」とする。

初期実装では通常処理中の自動 `VACUUM` は行わない。物理ファイル縮小のために DB 全体を lock したり、一時的に同等サイズの空き容量を要求したりしない。`page_count` / `freelist_count` を監査値として残し、将来、idle 時限定の maintenance が必要か判断できるようにする。

## 9. Scheduler と lifecycle

### 起動時

`ensureNightWorkersSchema()` 完了後、server listen 前に1回 cleanup を実行する。

- active file の状態を復元する。
- crash 後の closed segment を圧縮する。
- file retention / capacity sweep を実行する。
- SQLite retention を bounded batch で実行する。
- startup cleanup が失敗しても server 起動は継続し、failure audit と `api.log` warning を残す。

### 通常運用

- file rotation / capacity check: append path で実行。
- full file sweep: 60分ごと。
- SQLite cleanup: startup と、前回成功から24時間以上経過した最初の sweep。
- 同時 sweep は process-local mutex で1つに限定する。
- timer は `unref()` し、shutdown を妨げない。

### shutdown

- retention timer を停止する。
- 新規 append を閉じる前に runtime log writer queue を flush する。
- 実行中 sweep は timeout 付きで待つ。
- DB client close より前に audit write を完了する。

## 10. Overview と利用者表示

30日より古い usage data が存在しなくなるため、Overview の `all` を無期限履歴として表示しない。

採用方針:

- API の `all` range は互換のため受理するが、`effectiveRange: "30d"` と `retentionCutoff` を返す。
- UI の `all` label は「保存期間内（30日）」へ変更するか、range selector から除外する。
- recent call と usage summary が retention cutoff より前の完全性を示さないことを response metadata で明示する。
- cleanup 後の overview が raw record fallback で期限切れ data を再作成しないようにする。

## 11. 実装タスク

### Task 1: 設定契約と validation を追加する

主な変更候補:

- `api/services/settings/general-settings.ts`
- `src/modules/settings/settingsTypes.ts`
- `src/modules/settings/SettingsGeneralPanel.tsx`
- settings route / command tests

作業:

- `dataRetention` default と strict normalization を追加する。
- backend / frontend type と Settings save payload を一致させる。
- 設定 snapshot を runtime retention service へ反映する。
- 長すぎる保持期間、0、負数、NaN、category / global cap 矛盾を reject する。

### Task 2: bounded RuntimeLogWriter を実装する

主な変更候補:

- `api/lib/logger.ts`
- 新規 `api/runtime/runtime-log-writer.ts`
- 新規 `api/runtime/runtime-log-retention.ts`

作業:

- log descriptor、active segment state、append queue を実装する。
- date / size rotation、gzip、retention sweep、capacity eviction を実装する。
- record 単位の byte 上限と truncation metadata を実装する。
- `logHttpEvent`、`logEvent`、`appendSupervisorTrace`、`appendLlmTrace` の公開契約を維持する。
- managed filename allowlist、symlink rejection、atomic rename を実装する。

### Task 3: DB cleanup と監査台帳を追加する

主な変更候補:

- `api/db/bootstrap-runtime-tables.ts`
- `api/db/schema*.ts`
- 新規 `api/services/runtime-retention/runtime-retention.repository.ts`
- 新規 `api/services/runtime-retention/runtime-retention.service.ts`

作業:

- `runtime_retention_audit_events` schema、index、bootstrap を追加する。
- usage tables の30日 batch delete を実装する。
- audit table の90日 batch delete を実装する。
- file cleanup と DB cleanup の結果を本文なしの集計値で記録する。
- cleanup の部分成功、再試行可能 failure、last successful run を区別する。

### Task 4: server lifecycle へ接続する

主な変更候補:

- `api/server.ts`
- `api/index.ts`

作業:

- startup sweep、hourly timer、daily DB cleanup gate を接続する。
- timer / writer / sweep の shutdown 順序を明示する。
- startup / shutdown の既存 queue・Mission Pilot 処理を阻害しない timeout と fail-open を追加する。

### Task 5: Overview の30日境界を明示する

主な変更候補:

- `api/modules/overview/overview.routes.ts`
- `api/modules/overview/overview.service.ts`
- `shared/schemas/overview.schema.ts`
- `src/modules/overview`

作業:

- response に retention cutoff / effective range を追加する。
- `all` の無期限表現を除去する。
- 30日 cleanup 後も totals、daily buckets、recent calls が同じ cutoff で整合することを保証する。

### Task 6: 運用説明を更新する

主な変更候補:

- `README.md`
- `README.ja.md`
- `.env.example` または Settings documentation

作業:

- runtime root と active / rotated filename を説明する。
- 7日 / 3日 / 30日 / 90日の default を明記する。
- 容量上限により期間内ログも古い順に削除され得ることを明記する。
- raw LLM log に機微情報が含まれ得ることを明記する。

## 12. 検証計画

### 12.1 Unit tests

fake clock と一時 runtime root を使い、少なくとも次を検証する。

- UTC 日付変更で active file が1回だけ rotate する。
- size threshold 直前は同一 segment、超過する append の前に rotate する。
- concurrent append でも欠落、重複、二重 rotation がない。
- LLM trace JSONL が各行 parse 可能である。
- 2 MiB 超 record が bounded になり、元 length / hash / truncation marker が残る。
- 7日境界の API segment は残り、7日超だけが消える。
- 3日境界の LLM / supervisor segment は残り、3日超だけが消える。
- category cap と80 MiB global cap の両方で古い closed segment から消える。
- symlink と未知 filename を削除しない。
- rename / gzip / unlink failure 後に次回 sweep で再試行できる。
- invalid settings が既存設定を上書きしない。

### 12.2 DB tests

- cutoff ちょうどの usage row は残り、30日超の row だけが削除される。
- 4つの usage table が同じ cutoff へ収束する。
- 1,000行を超える場合に複数 batch で完了する。
- unrelated task / message / artifact / activity event は削除されない。
- cleanup audit に本文が入らず、件数・byte・settings snapshot だけが入る。
- 90日超の audit event だけが削除される。
- transaction failure で部分完了を成功扱いしない。

### 12.3 Lifecycle tests

- startup 時に期限切れ segment と row が回収されてから通常書込みが続く。
- startup cleanup failure でも API が起動する。
- hourly timer が重複 sweep を開始しない。
- Settings 保存後の次 append / sweep が新 snapshot を使う。
- shutdown が timer を止め、pending append と audit を flush してから DB を閉じる。

### 12.4 Overview tests

- `24h`、`7d`、`30d` が retention data と一致する。
- `all` request が30日より前の完全履歴を示さない。
- response の `retentionCutoff` と `effectiveRange` が UI 表示に反映される。

### 12.5 Repo gate

実装時の順序:

```bash
bun run test -- tests/runtime-log-retention.test.ts
bun run test -- tests/llm-usage-retention.test.ts
bun run test -- tests/runtime-bootstrap.test.ts tests/runtime-paths.test.ts
bun run test -- tests/services.overview.test.ts
bun run check:docs
bun run verify
```

実際の test filename は既存 suite の分割規則に合わせて調整するが、保持境界、容量境界、失敗再試行、shutdown flush を省略しない。

## 13. Rollout

1. 設定 default と DB table を追加する。既存ログはまだ削除しない。
2. RuntimeLogWriter を shadow mode で動かし、rotation candidate と容量計測だけを test / development で確認する。
3. file rotation と retention deletion を有効化する。
4. DB cleanup を有効化し、30日 cutoff 後の Overview 表示を確認する。
5. packaged desktop smoke で app data root 側の `logs` に同じ挙動が適用されることを確認する。

初回 cleanup 前に対象 file 一覧・総 byte・最古 timestamp を集計し、監査台帳へ baseline として保存する。未知ファイルがある場合は削除せず warning にする。

## 14. 完了条件

- `api.log` の7日、LLM / supervisor 生ログの3日、usage data の30日、retention audit の90日が自動検証される。
- `.nightworkers/logs` が通常時80 MiB以下へ収束する。
- 1件の巨大 prompt / response で segment / directory cap が無効化されない。
- restart、concurrent append、rotation failure を挟んでも最新ログが継続して書かれる。
- cleanup が task message、artifact、run evidence、archive record を削除しない。
- Overview が30日より前の完全履歴を誤表示しない。
- cleanup failure が API / LLM response を失敗させず、90日監査と次回再試行へ残る。
- deterministic な focused tests と `bun run verify` が成功する。
