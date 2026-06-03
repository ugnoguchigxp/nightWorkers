# Runtime Debug Mode

## Use When

dev server、build、test、CLI、worker process、runtime logs の問題を調べるときに使う。

## Required Behavior

- 実行コマンド、終了コード、ログ、環境差を確認する。
- コマンド出力だけで原因が不明なら関連コードを読む。

## Stop Conditions

- 再現条件または失敗原因が分かったら execute、verify、summarize のいずれかへ進む。

## Report Contract

- コマンド名、失敗箇所、根拠ログを含める。

