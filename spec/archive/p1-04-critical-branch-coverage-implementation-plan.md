# P1-04 重要状態遷移 Branch Coverage 実装計画

## 目的

Queue、Run、Todo、Review、認証、tool policy の失敗側と競合側をテストし、重要領域の branch coverage を 80% 以上へ引き上げる。

## 対応する改善項目

- 改善項目 9: branch coverage を重要状態遷移から 80% 以上へ上げる。

## 依存関係

- 先行 Phase: P1-03。
- 後続 Phase: P1-05、P2-03。

## 実装順

1. Queue claim、priority、cancel、retry、lease conflict。
2. Run transition、finalization、failed、needs_human、timed_out。
3. Todo start、done、block、replace、open Todo closeout gate。
4. Review start、artifact persistence、security diagnostic degradation。
5. Auth、CORS、Cookie、rate limit。
6. command / path policy allow、deny、timeout、redaction。

## 実装範囲

- P1-03 の report から未カバー branch を file 単位で選ぶ。
- happy path の重複ではなく false branch、exception、競合、再実行を追加する。
- DB-backed test は serial isolation を維持する。
- failure の期待結果は status、DB row、event の 3 点で確認する。

## 対象外

- 重要度の低い formatter や表示 helper だけで全体率を上げること。
- production code をテスト都合で分岐追加すること。
- coverage 100% を目標にすること。

## 検証計画

```bash
bun run test:coverage:backend
bun run test:coverage:frontend
bun run verify:full
```

## 完了条件

- 指定した 6 領域の branch coverage が各 80% 以上になる。
- status transition と persisted evidence の両方を assertion する。
- flaky retry や時間依存 assertion がない。
- 全体 branch coverage が baseline より低下しない。
