# E2E 専用 DB 完全隔離 実装計画

## 目的

Playwright E2E が開発用 `.env` の `DATABASE_URL` や起動済み dev server を再利用せず、実行単位の専用 SQLite DB、runtime、settings、fixture repository だけを使用するようにする。E2E 終了時は成功・失敗を問わず専用 DB と関連一時領域を初期化し、作業 DB を不変に保つ。

## 現状の問題

- `playwright.config.ts` の web server は `DATABASE_URL` を指定しておらず、`.env` の作業 DB を継承する。
- ローカルでは `reuseExistingServer` が有効なため、作業 DB を使う既存 dev server に E2E が接続できる。
- test ごとの DELETE は途中失敗や process 強制終了で実行されない。
- fixture repository が OS の一時領域へ分散し、run 全体として cleanup できない。

## 実装範囲

1. `scripts/run-playwright.mjs` を追加し、E2E 実行ごとに `.nightworkers-e2e/<run-id>/` を作成する。
2. run root 配下へ専用 DB、runtime、LLM/general/MCP/hooks settings、Codex home、fixture repository を割り当てる。
3. Web/API port は実行ごとに空き port を割り当てる。
4. `playwright.config.ts` は隔離環境変数がない起動と run root 外の DB を拒否し、既存 server を再利用しない。
5. すべての `test:e2e:*` script を隔離 wrapper 経由へ変更する。
6. 正常終了、test failure、SIGINT、SIGTERM の finally で専用 DB の main/WAL/SHM と run root を削除する。
7. E2E fixture repository を run root 配下へ集約する。
8. `.nightworkers-e2e/` を `.gitignore` へ追加する。

## 非対象

- E2E を transaction rollback だけで隔離すること。
- 開発用 DB の test data cleanup を安全性の前提にすること。
- Vitest 用 DB 隔離の再設計。

## 検証計画

- E2E environment helper が DB/runtime/settings/workspace を run root 配下へ生成する。
- run root 外の DB を Playwright config が拒否する。
- cleanup 後に専用 DB、`-wal`、`-shm`、run root が存在しない。
- regular E2E では provider credential が子 process に渡らない。
- `reuseExistingServer` が無効である。
- smoke E2E の前後で作業 DB の checksum と mtime が変化しない。
- `bun run verify` と E2E isolation の unit test が成功する。

## 完了条件

- E2E が `.env` の `sqlite.db` を開かない。
- E2E の失敗時にも作業 DB に repository、task、run、event が残らない。
- E2E 終了後に専用 DB と run root が初期化される。
- すべての package E2E command が隔離 wrapper を経由する。
- 計画完了後、この文書を `spec/archive/` へ移動する。
