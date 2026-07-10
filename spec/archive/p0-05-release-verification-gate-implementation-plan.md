# P0-05 正式リリース検証 Gate 実装計画

## 目的

full test が成功していても desktop や dependency audit が失敗する状態を見逃さないよう、正式リリース判断を単一 command に集約する。

## 対応する改善項目

- 改善項目 5: 正式なリリース gate を一本化する。

## 依存関係

- 先行 Phase: P0-04。
- 後続 Phase: P1 全体、P3-01。

## 実装範囲

1. `scripts/verify.mjs` に release target を追加する。
2. static check は parallel、共有 SQLite と build/smoke は serial に配置する。
3. `verify:full`、E2E smoke、dependency policy、desktop verify を一つの入口から実行する。
4. Phase、command、duration、exit status の最終サマリーを出す。
5. live LLM test は `verify:live` のまま分離する。
6. CI も同じ release target または同じtask定義を利用する。

## 主な変更候補

- `scripts/verify.mjs`
- `package.json`
- verify script 関連テスト
- CI workflow
- README / CONTRIBUTING の verification command 記載

## 対象外

- release artifact の公開。
- version bump と Git tag。
- live provider の可用性保証。

## 検証計画

想定 command:

```bash
bun run verify:release
```

失敗注入検証:

- lint failure が static phase で停止する。
- E2E failure が desktop phase と混同されない。
- desktop failure が release success にならない。
- audit policy violation が明示される。

## 完了条件

- 1 command で P0 の全必須 gate を実行できる。
- local と CI が同じ task ordering を使用する。
- 失敗した最初の必須 Phase と証跡が確認できる。
- `verify:release` が成功しない限り release-ready と表示されない。

## ロールバック条件

- gate 所要時間だけを理由に検査を削除しない。parallel-safe な静的処理だけを並列化し、必要なら fast gate と release gate の役割を分離する。
