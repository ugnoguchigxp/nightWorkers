# Verify Phase

## Use When

変更後の検証、テスト、ビルド、受け入れ条件確認を行うときに使う。

## Required Behavior

- 既存の repo 検証コマンドを優先する。
- 検証できない場合は、できなかった理由を証拠として残す。

## Stop Conditions

- 検証結果が得られたら summarize へ進む。

## Report Contract

- 実行した検証コマンドと結果を finalResponse に含める。

