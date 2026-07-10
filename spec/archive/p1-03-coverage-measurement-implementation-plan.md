# P1-03 カバレッジ計測対象正常化 実装計画

## 目的

高い coverage 数値を維持するための広い exclude をやめ、実際に重要な production code を計測する backend / frontend coverage 基盤へ移行する。

## 対応する改善項目

- 改善項目 8: カバレッジ計測対象を正常化する。

## 依存関係

- 先行 Phase: P1-02。
- 後続 Phase: P1-04。

## 実装範囲

1. 現在の exclude を generated、entrypoint、副作用境界、未計測ロジックに分類する。
2. routes、repositories、MCP、WebSocket、DB、主要 TSX を段階的に include へ戻す。
3. backend / frontend の独立 report と統合 summary を生成する。
4. report に対象 file 数、対象 line 数、除外理由を出す。
5. coverage threshold を config と quality gate で重複定義しない。
6. 計測対象追加による一時的な率低下を失敗ではなく baseline 更新として扱う移行期間を設ける。

## 主な変更候補

- `vitest.config.ts`
- `vitest.backend.config.ts`
- `vitest.frontend.config.ts`
- coverage summary / quality gate service
- coverage gate 関連テスト

## 対象外

- coverage 数字だけを上げる新規テスト追加。これは P1-04 で扱う。
- generated route tree や型宣言の計測。
- live provider call の coverage 化。

## 検証計画

```bash
bun run test:coverage:backend
bun run test:coverage:frontend
bun run test:coverage
bun run verify:full
```

確認事項:

- frontend summary が必ず生成される。
- critical path が理由なく exclude されていない。
- 同じ source が backend / frontend 集計で二重加算されない。

## 完了条件

- 計測対象と除外理由を第三者が説明できる。
- routes、repositories、主要 UI logic が report に現れる。
- 統合 summary が backend / frontend の内訳を持つ。
- threshold が計測対象変更を隠すために下げられていない。
