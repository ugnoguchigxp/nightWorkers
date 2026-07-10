# P0-02 sanitize-html Critical 対応 実装計画

## 目的

直接 runtime 依存の `sanitize-html` Critical advisory を解消し、悪意ある HTML が認証入力、外部取得コンテンツ、共通 sanitizer を通過しないことを証明する。

## 対応する改善項目

- 改善項目 2: `sanitize-html@2.17.3` の Critical 脆弱性を解消する。

## 依存関係

- 先行 Phase: P0-01。
- 後続 Phase: P0-03。

## 実装範囲

1. `sanitize-html` を advisory 非該当 version へ更新する。
2. `shared/schemas/auth.schema.ts`、`api/lib/sanitizer.ts`、`api/services/worker-tools/fetch-content.ts` の利用条件を確認する。
3. `xmp`、raw-text element、壊れた閉じタグ、入れ子 script、encoded payload の fixture を追加する。
4. サニタイズ後の文字列が React、Markdown、log、DB で再解釈されないことを確認する。
5. 日本語、絵文字、記号、通常のプレーンテキストを壊さない回帰テストを追加する。

## 主な変更候補

- `package.json`
- `bun.lock`
- `shared/schemas/auth.schema.ts`
- `api/lib/sanitizer.ts`
- `api/services/worker-tools/fetch-content.ts`
- sanitizer / auth schema 関連テスト

## 対象外

- Markdown renderer 全体の置換。
- HTML を許可する新しい rich text 機能。
- 他の依存 advisory の一括更新。

## 検証計画

```bash
bun run test run tests/shared.auth.schema.test.ts tests/schemas.auth.test.ts
bun run verify:full
bun audit --json
```

## 完了条件

- `sanitize-html` の Critical advisory が audit から消える。
- adversarial fixture がタグや実行可能 markup として残らない。
- 正常な登録名と取得テキストの既存挙動が維持される。
- 新しい sanitizer 設定が利用箇所ごとに重複していない。

## ロールバック条件

- 更新版で互換性問題が発生した場合も、脆弱 version へ戻して完了扱いにしない。利用範囲をプレーンテキスト処理へ置換する案を同じ Phase 内で評価する。
