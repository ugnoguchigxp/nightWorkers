# P1-01 価格表ページング 実装計画

## 目的

Settings General の価格表を全件一括描画から段階取得・段階表示へ変更し、保存件数が増えても初期描画と操作性能を維持する。

## 対応する改善項目

- 改善項目 6: 価格表 2,177 行を仮想化またはページングする。

## 依存関係

- 先行 Phase: P0-05。
- 後続 Phase: P1-02。

## 現状

価格行を全件取得し、`visiblePricingRows.map(...)` で全行を DOM へ載せる。評価時点では 2,177 行、約 17,656 DOM node を生成した。

## 実装範囲

1. pricing read API に provider、model query、limit、cursor または offset を追加する。
2. 安定した sort key と `totalCount` / `nextCursor` を返す。
3. UI に provider filter、model search、50〜100 行単位のページ操作を追加する。
4. import / refresh 後も filter と page state を可能な範囲で維持する。
5. 空、loading、error、最終 page の表示契約を揃える。

## 主な変更候補

- `src/modules/settings/SettingsGeneralPanel.tsx`
- pricing API route / service / repository
- pricing schema
- Settings General / pricing 関連テスト

## 対象外

- 価格 import source の変更。
- cost calculation 式の変更。
- 全 Settings table の共通 table framework 化。

## 検証計画

- 0、1、50、2,177、10,000 行 fixture で pagination を確認する。
- sort key が同値でも重複・欠落しない。
- 初期 DOM node 数を現状から 80% 以上削減する。
- model/provider filter と page 遷移を component/API test で確認する。
- `bun run verify:full` と `bun run test:e2e:smoke` を実行する。

## 完了条件

- 初期表示で全 pricing row を DOM に載せない。
- 2,000 行以上でも検索、page 遷移、refresh が実用的に動く。
- Overview の cost calculation に回帰がない。
- API の旧利用箇所がある場合は互換性が維持されるか同時に移行される。
