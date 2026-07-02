# Data Migration Work Kind

## Use When

DB schema、migration、backfill、データ変換を扱うときに使う。

## Required Behavior

- 既存 migration flow と rollback / failure impact を確認する。
- destructive operation overlay を検討する。
- DB schema 変更を伴う場合は、TodoList に migration 作成、migration 実行、既存 migration を使う実 DB 統合テスト追加、migration 後検証を独立 Todo として含める。
- 固定 migration Todo を明示する場合は `procedureId` に `data_migration.create_migration`、`data_migration.apply_migration`、`data_migration.add_integration_test`、`data_migration.verify_migration` を使う。
- migration 由来の統合テストは一時 DB または隔離された test DB に既存 migration を適用し、作成・更新・SELECT・並び順などの実 DB 経路を確認する。テスト内で schema を手書き再現せず、既存 DB を汚さない。
- migration を作っただけで完了扱いにせず、対象 DB への適用と schema/API/test の検証 evidence を残す。

## Stop Conditions

- migration と検証が完了したら summarize へ進む。
- migration 適用または migration 後検証が未実施の場合は summarize へ進まず、Todo を block または fail にする。

## Report Contract

- schema 変更、migration、検証結果を報告する。
- migration を実行できなかった場合は、その理由と未検証リスクを報告する。
