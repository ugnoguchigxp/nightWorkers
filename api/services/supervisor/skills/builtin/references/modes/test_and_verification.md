# Test And Verification Mode

## Use When

テスト追加、既存テスト更新、変更後の検証を行うときに使う。

## Required Behavior

- 変更内容に最も近いテストから実行する。
- 広い変更では repo の verify gate まで進む。

## Stop Conditions

- 検証結果が得られ、失敗時の扱いが明確になったら summarize へ進む。

## Report Contract

- 実行した検証と結果を明記する。

