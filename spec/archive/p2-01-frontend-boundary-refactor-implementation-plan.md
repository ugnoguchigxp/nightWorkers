# P2-01 巨大 Frontend 分割 実装計画

## 目的

巨大 React component を変更理由ごとの境界へ分離し、画面挙動を変えずに保守性、テスト容易性、再利用性を改善する。

## 対応する改善項目

- 改善項目 13: 巨大 Frontend component を分割する。

## 依存関係

- 先行 Phase: P1-07、P1-02、P1-05。
- 後続 Phase: P2-02、P2-05。

## 実装順

1. `ArtifactPane`
2. `PlanModeWorkspaceViewer`
3. `ThreadTimeline`
4. `NightWorkersShell`

各対象は独立 commit または独立 PR とし、4 対象を一度に移動しない。

## 実装範囲

1. 現在の public props、URL state、callback flow を characterization test で固定する。
2. server data selector、local state、command handler、presentational panel を分離する。
3. mode 固有 view は mode module に置き、Shell に条件分岐を戻さない。
4. shared component 化は 2 箇所以上の実利用がある場合だけ行う。
5. accessibility name と test id を維持する。

## 対象外

- visual redesign。
- state management library の追加。
- API contract の変更。
- P1-02 で実装した Timeline windowing の再設計。

## 検証計画

- 既存 component/selector test を移動前後で同じ assertion のまま通す。
- Artifact open、Plan Mode view、Timeline、route restoration を確認する。
- P1-05 の主要 E2E を実行する。
- `bun run verify:full` と `bun run test:e2e:smoke` を実行する。

## 完了条件

- 各 component の変更理由が限定されている。
- public props と route behavior に互換性がある。
- 新しい循環 import がない。
- 単なる JSX の別 file 移動ではなく、state / command / view boundary が明確である。

## ロールバック条件

- 分割によって props drilling や context coupling が増える場合は、その対象だけを戻し、必要な state ownership を先に決め直す。
