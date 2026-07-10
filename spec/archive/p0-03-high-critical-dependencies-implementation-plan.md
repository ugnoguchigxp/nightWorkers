# P0-03 High / Critical 依存対応 実装計画

## 目的

`sanitize-html` 以外の High / Critical advisory を runtime、development、transitive に分類し、未評価の高重大度リスクをゼロにする。

## 対応する改善項目

- 改善項目 3: 直接依存の High / Critical advisory をゼロにする。

## 依存関係

- 先行 Phase: P0-02。
- 後続 Phase: P0-04、P2-06。

## 実装範囲

1. `bun audit --json` の結果を package、severity、dependency kind、到達経路で分類する。
2. `hono`、`@hono/node-server`、`vite` を優先して修正版へ更新する。
3. CORS、JWT、Cookie、body limit、static serving、Windows path の security regression test を追加する。
4. transitive advisory は親 package 更新を優先し、override は upstream 互換性が確認できる場合だけ使う。
5. 修正版が存在しない advisory は、非該当理由、緩和策、再確認期限を machine-readable allowlist に記録する。

## 主な変更候補

- `package.json`
- `bun.lock`
- `api/app.ts`
- security hardening 関連テスト
- audit policy / allowlist 用 script と設定

## 対象外

- 全依存の major version 一括更新。
- advisory 件数だけを減らすための package 削除。
- 根拠のない audit ignore。

## 検証計画

```bash
bun audit --json
bun run test:desktop-runtime
bun run test:e2e:smoke
bun run verify:full
bun run verify:desktop
```

## 完了条件

- 直接 runtime 依存に Critical / High advisory がない。
- 残存する高重大度 advisory はすべて到達性と緩和策が記録されている。
- CORS、認証、Cookie、static serving の既存契約が維持される。
- 更新による desktop build 回帰がない。

## ロールバック条件

- major update が複数領域を壊す場合は一括更新を戻し、package ごとの小さい更新へ分割する。未評価 advisory を残したまま Phase を閉じない。
