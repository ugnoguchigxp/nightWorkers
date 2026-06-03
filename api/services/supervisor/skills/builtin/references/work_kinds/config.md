# Config Work Kind

## Use When

env、settings、policy、manifest、runtime configuration を扱うときに使う。

## Required Behavior

- runtime-backed settings がある場合は直接 .env 編集より優先する。
- 設定変更の影響範囲を確認する。

## Stop Conditions

- 設定変更と検証が完了したら summarize へ進む。

## Report Contract

- 変更した設定と確認結果を報告する。

