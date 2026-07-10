# P1-05 主要導線 E2E 実装計画

## 目的

外部 LLM credential を使わずに、Project 登録から Queue、実装、Review、archive までの主要価値を CI で再現する。

## 対応する改善項目

- 改善項目 10: 主要ユーザー導線の E2E を追加する。

## 依存関係

- 先行 Phase: P1-04。
- 後続 Phase: P1-06、P3-02。

## 実装範囲

1. deterministic な structured provider / runtime fixture を追加する。
2. test ごとに disposable Git repository と isolated DB を作る。
3. Project 登録、Session 作成、Plan artifact、Queue admission、run start を通す。
4. diff、Todo、verification、Review artifact、archive を画面と API の両方で確認する。
5. failure または policy block から needs_human / retry へ進む scenario を追加する。
6. test cleanup で repository、task、runtime process、temporary file を削除する。

## 主な変更候補

- `tests/e2e/nightworkers-agent.spec.ts`
- `tests/e2e/helpers.ts`
- deterministic provider fixture
- Playwright config
- E2E 専用 seed / cleanup helper

## 対象外

- 実 OpenAI / Azure / Bedrock の可用性確認。
- UI 全画面の exhaustive E2E。
- performance load test。

## 検証計画

```bash
bun run test:e2e:smoke
bun run test:e2e:regression
bun run verify:full
```

## 完了条件

- credential なしで主要 happy path が完了する。
- failure path が期待する persisted status と evidence を残す。
- test 後に temporary repository と process が残らない。
- CI で再実行しても task title や port が衝突しない。
