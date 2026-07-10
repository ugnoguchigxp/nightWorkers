# E2E シナリオ網羅性基盤 実装計画

## 目的

独立 E2E DB を前提に、NightWorkers 自身の Playwright E2E をシナリオ単位で管理し、P0 100% と重み付き網羅率 80% を `verify:e2e` で機械的に検証できるようにする。

## 対象

- 恒久方針 `spec/e2e-testing-policy.md`
- 機械可読な `tests/e2e/scenario-catalog.json`
- 既存 Playwright test と scenario tag の対応付け
- Playwright JSON からの coverage 集計
- package scripts と `scripts/verify.mjs` の E2E gate
- 集計ロジックと verify task graph の回帰テスト

## 対象外

- AGENTS.md
- コーディングエージェント向け E2E 規約
- Supervisor skill、LLM prompt、Test Mode の agent contract
- live LLM E2E の通常ゲート化
- frontend / backend の E2E 実行コードカバレッジ

## 実装手順

1. 現在の deterministic E2E 8件を required baseline として catalog へ登録する。
2. live LLM E2E 1件は observational として登録する。
3. retry、cancel、timeout、needs_review、Test Mode から Review Mode、commit closeout は planned として不足を可視化する。
4. 既存 test へ `@scenario:<ID>`、priority、execution class tag を追加する。
5. Playwright JSON と catalog を照合する集計モジュールを追加する。
6. full deterministic E2E を実行して、Playwright と coverage の JSON artifact を残す runner を追加する。
7. `test:e2e:coverage` と `verify:e2e` を正式ゲートへ接続する。
8. `verify:full` では full deterministic E2E に含まれる accessibility を重複実行しない。
9. 集計モジュール、catalog、verify task graph の回帰テストを追加する。

## 完了条件

- catalog の required scenario がすべて既存 test へ対応している。
- P0 coverage が 100% である。
- weighted coverage が 80% 以上である。
- required scenario の full deterministic pass rate が 100% である。
- P0 flaky が0件である。
- 未登録 scenario、priority 不一致、skip、failure、閾値未達で非0終了する。
- `bun run verify:e2e` が独立 DB 上で full deterministic suite と coverage gate を通す。
- 開発用 DB が E2E 実行で変更されない。

完了後、この文書は `spec/archive/` へ移動する。
