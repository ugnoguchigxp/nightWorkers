# SQLite Runtime Settings Migration 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-07-12
- Implementation status: `not-started`
- Target: 通常運用における環境変数およびruntime JSONファイルを、SQLiteを正本とする設定管理へ移行する

## 1. 背景と問題

現在の設定経路は一つではない。

- `.env` / `process.env` が、HTTP、認証、OAuth、LLM、実行制御、外部CLIなどの設定値を持つ。
- `api/.runtime/llm-settings.json` がLLM endpoint、role route、APIキーを持つ。
- `general-settings.json` と `fx-rates.json` が一般設定と為替キャッシュを持つ。
- `mcp-servers.json` と `agent-hooks.json` がMCP serverとAgent Hookを持つ。
- desktopは `data/sqlite.db`、通常開発はrepo rootの `sqlite.db` を既定にし、保存先が二系統ある。

この状態では、どの値が実行時の正本なのかを利用者と実装の両方が追跡しなければならない。また、`.env` を読み込んだ直接 `bun test` が実運用DBへ到達できた。E2E/Vitestは既に専用DBを作るが、通常運用とテストの設定境界をプロセス環境の慣習に依存させ続けるべきではない。

## 2. 目的

1. 通常運用の設定値をSQLiteの単一正本へ保存する。
2. 通常運用では、設定値を環境変数またはJSONファイルから読まない。
3. 通常運用のSQLite保存先をプラットフォームごとに固定する。
4. E2E/Vitestだけは、明示的に注入した使い捨てSQLite DBを使い、通常運用DBへ絶対に到達させない。
5. 既存の環境変数およびJSON設定を一度だけSQLiteへ移行し、移行後に旧経路を削除する。

## 3. 成功条件

1. 通常のbrowser開発、desktop、production起動では`DATABASE_URL`、LLM、一般設定、MCP、Hook、認証、OAuth、実行制御の設定値を要求しない。
2. 通常運用のDBパスは`getRuntimePaths()`の固定ルールだけで決まり、`.env`の`DATABASE_URL`では変わらない。
3. SQLiteに`application_settings`、`application_setting_secrets`、`application_setting_migrations`が存在し、設定のscope・revision・更新日時を保持する。
4. LLM、一般、為替、MCP、Hook、認証/OAuth、実行制御、外部連携の全設定がSQLiteから読まれる。
5. APIは秘密値を保存できるが、読出しレスポンス・ログ・Activity event・エラーへ平文を出さない。
6. 既存のJSONと環境変数をSQLiteへ一回だけ移した後、通常運用のread fallbackは存在しない。
7. E2E、Vitest、直接`bun test`は専用のDBを使い、通常運用DBのハッシュが不変である。
8. migrationが途中で失敗しても、既存SQLite内の設定recordを部分状態にせず、次回起動で安全に再実行できる。
9. focused tests、typecheck、Biome、docs check、repo verifyが通る。

## 4. Locked Decisions

1. 通常運用の設定正本はSQLiteのみとする。環境変数・JSONは通常運用のfallbackにしない。
2. DBの通常保存先はplatform固定とする。
   - desktop: アプリケーションデータrootの`sqlite.db`。
   - browser開発 / packaged sidecar以外: repo内の`.nightworkers/sqlite.db`。
   - `.nightworkers/`はgitignore対象とし、repo rootの`sqlite.db`は新規に作らない。
3. `DATABASE_URL`は通常運用では廃止する。DBを開く前に必要なパスをSQLiteから読むことはできないため、DBパス自体は設定値ではなく固定bootstrap規約とする。
4. E2E/Vitest/直接`bun test`のDB上書きだけはテストランナーがプロセス環境へ注入する。これは通常運用の設定インターフェースではない。
5. `NODE_ENV`、desktop executableが与えるresource/app-data path、OSの`PATH`、テストランナーの隔離マーカーはプロセス状態であり、SQLiteへ移さない。
6. 現在`.env`に置くアプリ設定・資格情報はSQLiteへ移す。秘密値は一般値と別テーブルに保存し、DB/親directoryを所有者専用権限にする。SQLiteの暗号化はこの計画の範囲外であり、暗号化なしのローカルDBであることをUIと運用文書で明示する。
7. HTTP listener設定は固定DBを開いた後にSQLiteから読んで適用する。listener再bindが必要な変更は「再起動が必要」として保存し、保存要求の途中でlisten socketを変更しない。
8. 設定更新はZod schemaで検証し、設定documentとsecret documentを同一SQLite transactionでrevision更新する。
9. 旧`.env` / JSONからのimportは初回だけである。SQLiteにmigration markerがある場合、旧ファイルを再読込・再優先しない。
10. JSONファイルは自動削除しない。migration成功後に`*.migrated-<timestamp>.json`へリネームして退避し、明示的なcleanupコマンドでのみ削除する。

## 5. 対象範囲

### 5.1 含む

- 固定runtime rootと通常SQLite pathの定義。
- SQLite設定テーブル、repository/service、schema validation、revision管理。
- `.env`と4種のJSON設定の一回限りimport。
- LLM、General/FX、MCP、Hook、認証/OAuth、HTTP、runtime/execution、Supervisor、vulnWorkbenchの設定読出し切替。
- 設定API/UIの秘密値mask、restart-required表示。
- E2E/Vitest/direct Bun testの明示的DB注入と、通常DB不変の回帰試験。
- setup/README/configuration docs/.env.exampleの更新。

### 5.2 含まない

- SQLite暗号化、OS keychain連携、クラウドsecret manager。
- 複数ホスト間の設定同期。
- per-user settings、RBAC、設定履歴の復元UI。
- 任意の外部プロセスが環境変数を必要とすること自体の廃止（子プロセスにはSQLiteから解決した最小値を明示的に渡す）。
- projectごとの`repositories.feature_settings`の統合。これは既にproject scopeの正本であり、application global設定と混ぜない。

## 6. 設定モデル

### 6.1 テーブル

新しいDrizzle migrationで次を追加する。

```sql
CREATE TABLE application_settings (
  scope TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE application_setting_secrets (
  scope TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE application_setting_migrations (
  source TEXT PRIMARY KEY NOT NULL,
  source_fingerprint TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  result_json TEXT NOT NULL
);
```

- `scope`は固定enumとする。自由なkey/value storeにしない。
- `value_json`はscopeごとのZod schemaでparseしてから保存する。
- secret tableはAPIの通常select対象に含めない。read pathはscopeごとに必要なsecretだけを結合する。
- 設定documentとsecret documentのrevisionは同じtransactionで更新する。

### 6.2 Scopeと移行元

| SQLite scope | 移行元 | 含める値 |
| --- | --- | --- |
| `server` | `.env` | `HOST`, `PORT`, `APP_URL`, `CORS_ORIGIN`, `COOKIE_SAME_SITE`, `TRUST_PROXY`, `API_AUTH_REQUIRED`, `ALLOW_INSECURE_NON_LOOPBACK`, `LOG_LEVEL` |
| `auth` / `auth-secrets` | `.env` | `AUTH_MODE`, JWT expiry、Google/GitHub client IDとsecret、JWT secret |
| `llm` / `llm-secrets` | `.env`, `llm-settings.json` | provider enablement、endpoint、model、role route、queue concurrency、API keys、Codex token |
| `general` | `general-settings.json` | timezone、language、currency、FX refresh、Plan Mode capability、LLM usage observability |
| `fx-cache` | `fx-rates.json` | 為替取得結果 |
| `mcp` | `mcp-servers.json` | MCP server settings |
| `agent-hooks` | `agent-hooks.json` | Hook definitionsとlast run |
| `runtime` | `.env` | `ACTIVE_LLM_PROVIDER`, runtime lane、queue drain、run-control、evidence Todo、timeout、SQLite retry profile |
| `integrations` / `integration-secrets` | `.env` | vulnWorkbench enablement/cwd/timeout、security plugin integration、外部CLI設定、Supervisor fixture以外の通常運用値 |

`SUPERVISOR_FIXTURE_OUTPUT`、`NIGHTWORKERS_E2E_*`、`NIGHTWORKERS_VITEST_DB_PATH`、live-test opt-in、coverage retry profileはテスト専用であり、SQLiteへ移行しない。

## 7. 実装フェーズ

### Phase 1: 固定bootstrap pathと設定storeの基盤

対象:

- `api/runtime/paths.ts`
- `api/runtime/bootstrap.ts`
- `api/config.ts`
- `api/db/schema.ts`
- `drizzle/migrations/0036_application_settings.sql`
- `api/modules/settings/**`

作業:

1. `getRuntimePaths()`を通常運用用とisolated test用に分ける。通常は`.nightworkers/sqlite.db`またはdesktop app-dataの`sqlite.db`だけを返す。
2. `DATABASE_URL`をconfig schemaから外す。config import前にdotenvを読む処理も削除する。
3. `resolveDatabaseUrlForProcess()`を新設し、通常は固定path、E2E/Vitest/direct Bun testだけは検証済みの専用pathを返す。
4. DB directoryを作成し、directory `0700`、SQLite file `0600`をbest effortで設定する。
5. `applicationSettingsRepository`を追加し、scope schema、secret分離、revision compare-and-swap、transactional upsertを実装する。
6. `ensureNightWorkersSchema()`にtable bootstrapを加えるが、既存のad-hoc bootstrapを設定正本として増やさない。migration適用後の互換用だけに留める。

完了条件:

- 空の通常runtimeで固定SQLiteが作られ、DB pathを`.env`で変更できない。
- E2E/Vitestの専用DB指定がrun root外を指す場合はfail-closeする。

### Phase 2: 初回importと旧経路の退避

対象:

- `api/modules/settings/application-settings-migration.service.ts`
- `api/scripts/migrate-runtime-settings.ts`
- `api/runtime/bootstrap.ts`
- `api/routes/settings-runtime.ts`
- `api/services/settings/general-settings.ts`
- `api/services/mcp/mcp-settings.ts`
- `api/services/hooks/hooks-settings.ts`

作業:

1. 起動時、schema準備後かつアプリservice初期化前にmigration markerを確認する。
2. SQLiteに設定が存在しないscopeだけ、`.env`とJSONを読んでschema validationする。環境変数とJSONの競合は、現在の実効優先順（JSONの明示値、次に環境変数、最後にdefault）を再現する。
3. すべてのscopeを一transactionで保存し、markerにsource fingerprint、imported scopes、warningを記録する。
4. 失敗時はtransactionをrollbackし、markerもJSON退避も作らない。次回起動は同じimportを再試行できる。
5. 成功後、JSONを`*.migrated-<timestamp>.json`へatomic renameする。`.env`は読み取り専用の利用者ファイルなので自動変更しないが、起動時には再読込しない。
6. `bun run settings:migrate`、`settings:migrate --dry-run`、`settings:legacy-cleanup`を追加する。通常起動は自動migrationするが、dry-runで事前確認できるようにする。

完了条件:

- 既存runtimeの全設定とsecretがSQLiteへ一度だけ保存される。
- markerのあるruntimeで`.env`と旧JSONを変更しても実効設定は変化しない。

### Phase 3: 設定読出しをSQLiteへ切替

対象:

- `api/routes/settings-runtime.ts`
- `api/services/structured-llm/settings.ts`
- `api/services/settings/general-settings.ts`
- `api/services/mcp/mcp-settings.ts`
- `api/services/hooks/hooks-settings.ts`
- `api/services/runtime-env.ts`
- `api/services/run-control/settings.ts`
- `api/services/run-control/evidence.ts`
- `api/services/vulnworkbench-cli-runtime.ts`
- `api/services/supervisor/skills/registry.ts`
- それぞれのroute/serviceテスト

作業:

1. JSONの`fs.readFileSync`/`writeFileSync`をsettings repository呼出しへ置換する。
2. LLM設定から`applySettingsToProcessEnv()`を削除する。providerとworkerはtyped settings snapshotを受け取り、必要なcredentialだけをchild envへ組み立てる。
3. General/FX、MCP、Hookのread/writeをscope単位のrepositoryへ置換する。
4. runtime-env、run control、vulnWorkbench、Supervisor等は`process.env`ではなくtyped application settingsを読む。
5. server/auth設定は起動時に一度snapshotとして読み、動的更新ではなく`restartRequired`を返す。LLM/MCP/Hook/Generalの更新は次のrunから読む。
6. 既存のsettings routeはレスポンス契約を維持しつつ、secretを常にmaskする。保存時の`********`は現行どおり既存secretを保持する。

完了条件:

- `llm-settings.json`、`general-settings.json`、`fx-rates.json`、`mcp-servers.json`、`agent-hooks.json`を削除または退避しても通常運用がSQLiteだけで動く。
- 通常アプリの設定serviceに`process.env.<application setting>`参照が残らない。

### Phase 4: 環境変数契約の削除と設定UIの明確化

対象:

- `api/config.ts`
- `.env.example`
- `README.md`
- `spec/configuration.md`
- Settings UI/route definitions
- `package.json`

作業:

1. `.env.example`を廃止するか、test/desktop launcher専用の最小サンプルへ縮小する。アプリ設定値とcredentialは掲載しない。
2. config schemaをbootstrap-onlyへ縮小する。通常起動でdotenvをロード・検証するコードを削除する。
3. Settings UIへ「SQLiteに保存」「secretはローカルSQLiteに平文保存」「再起動が必要」の表示を追加する。
4. 初回起動時の設定未入力状態を明示する。LLM未構成は設定画面で入力を促すが、環境変数fallbackは行わない。
5. setup、desktop、migration、backup/restoreの文書を固定runtime rootに合わせて更新する。

完了条件:

- `.env`を削除した通常起動が設定画面・local auth・SQLite DBまで到達する。
- 通常設定の変更がSQLite rowとSettings UIの再読込で一致する。

### Phase 5: テスト隔離と回帰防止

対象:

- `scripts/e2e-environment.mjs`
- `scripts/run-playwright.mjs`
- `scripts/vitest-database.mjs`
- `tests/vitest-db-env.ts`
- `tests/setup-vitest-db.ts`
- `tests/e2e-environment.test.ts`
- 新規settings migration/runtime path tests

作業:

1. E2E run root内にDBと全設定scopeを作り、旧`NIGHTWORKERS_*_SETTINGS_PATH`注入を廃止する。
2. Vitestは`NIGHTWORKERS_VITEST_DB_PATH`だけをDB overrideとして使い、scope dataも同じ専用DBへ入れる。
3. 直接`bun test`は一時SQLiteを生成し、通常runtime DBのhashを前後比較するテストを常設する。
4. E2Eは`reuseExistingServer: false`を維持し、DB、runtime、workspace、Codex homeがrun root内にあることを検証する。
5. legacy JSONが存在してもmarker済み通常DBでは読まれず、テストDBの初期値へ混入しないことを確認する。

完了条件:

- Playwright、Vitest、直接Bun testのいずれも通常runtimeのDB/settingsを変更できない。

## 8. ロールバックと運用

1. 各runtime DBを変更前に`sqlite3 .backup`でsnapshotする。
2. migration前のJSONはrename退避し、`settings:legacy-cleanup`実行までは残す。
3. import失敗はSQLite transaction rollbackで終了する。部分scopeだけを「成功」と記録しない。
4. SQLite設定のアプリ利用で障害が出た場合は、DB snapshotを復元し、実装をrevertする。旧JSON fallbackを本番で再有効化する緊急分岐は作らない。
5. 復元後は`settings:migrate --dry-run`で入力とschemaを確認し、修正後にmigrationを再試行する。

## 9. 検証マトリクス

| ケース | 実行 | 期待結果 |
| --- | --- | --- |
| 新規通常起動 | 固定runtime rootで起動 | `.nightworkers/sqlite.db`にschema/default settingsが作られる |
| 既存設定移行 | `settings:migrate --dry-run`後に実行 | JSON/.env由来の全scopeが一回だけSQLiteへ保存される |
| marker再起動 | 旧JSON/.envを変更して再起動 | SQLite値が不変で旧経路を読まない |
| LLM secret | APIで保存・GET | DBには保存、GET/logにはmaskのみ |
| listener設定 | server scopeを更新 | 保存成功・`restartRequired: true`、現在のsocketは不変 |
| MCP/Hook/General | 更新後に再読込 | SQLiteの最新revisionが返る |
| E2E | `bun run test:e2e:smoke` | run root内の専用DBだけが変更される |
| Vitest | `bun run test run ...` | per-run temp DBだけが変更される |
| 直接Bun test | `bun test <mutating test>` | 通常DB SHA-256が実行前後で一致する |
| 回帰 | `bun run typecheck`, Biome, `bun run check:docs`, `bun run verify` | 成功 |

## 10. 実装順とコミット境界

1. Phase 1をmigrationとrepository/testだけでコミットする。既存read pathはまだ切替えない。
2. Phase 2をimport CLI、marker、backup検証でコミットする。
3. Phase 3を設定domainごとに小さく分ける（LLM、General/FX、MCP/Hook、runtime/auth/integrations）。各sliceは旧JSON fallbackを同時に削除する。
4. Phase 4でdotenv/.env.example/documentation/UI表示を更新する。
5. Phase 5でfull isolationと全体verifyを完了させる。

各commitはmigration適用済みDBと未適用DBの両方を対象に確認する。既存の無関係な作業ツリー変更はstageしない。
