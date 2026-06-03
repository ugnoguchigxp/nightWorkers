# Data Migration Work Kind

## Use When

DB schema、migration、backfill、データ変換を扱うときに使う。

## Required Behavior

- 既存 migration flow と rollback / failure impact を確認する。
- destructive operation overlay を検討する。

## Stop Conditions

- migration と検証が完了したら summarize へ進む。

## Report Contract

- schema 変更、migration、検証結果を報告する。

