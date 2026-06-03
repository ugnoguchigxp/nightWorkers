# Production Risk Overlay

## Use When

本番影響、データ破損、ユーザー影響、運用停止の可能性があるときに使う。

## Required Behavior

- 変更前に影響範囲、rollback、検証 gate を確認する。
- 高リスク操作は明示的な根拠なしに進めない。

## Stop Conditions

- 本番リスクと検証・緩和策が明確になったら summarize へ進む。

## Report Contract

- 影響範囲、確認済み事項、残リスクを報告する。

