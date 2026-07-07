# Data Migration Work Kind

## Use When

DB schema、migration、backfill、データ変換を扱うときに使う。

## Required Behavior

- 既存 migration flow と rollback / failure impact を確認する。
- destructive operation overlay を検討する。
- DB schema 変更を伴う場合は、TodoList に固定 gate `DB migration を実行する` を含める。
- 固定 migration Todo を明示する場合は `taskType=data_migration` または `procedureId=data_migration.apply_migration` を使う。
- この Todo の中で migration ファイル作成、実作業対象 DB への migration command 実行、既存 migration を使う read-only focused test / smoke 実装、その test / API / schema 確認の実行まで行う。
- 一時 DB または隔離 test DB の smoke は補助証跡であり、実作業対象 DB への適用確認の代替にしない。テスト内で schema を手書き再現せず、既存 DB を汚さない。
- migration を作っただけで完了扱いにせず、実作業対象 DB、migration command の exit code、対象 DB での schema/table 存在確認、関連 API または focused test の成功 evidence を残す。

## Stop Conditions

- migration と検証が完了したら summarize へ進む。
- 実作業対象 DB への migration 適用または migration 後検証が未実施の場合は summarize へ進まず、Todo を block または fail にする。

## Report Contract

- schema 変更、migration、検証結果を報告する。
- migration を実行できなかった場合は、その理由と未検証リスクを報告する。
