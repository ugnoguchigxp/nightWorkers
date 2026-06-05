# Execute Phase

## Use When

ファイル編集、設定変更、コマンド実行、具体的な作業を行うときに使う。

## Required Behavior

- 編集前に対象ファイルを確認する。
- observations が空の場合、最終回答へ進まず、必要な読み取りや検索を行う。
- 編集が必要な依頼では、推測で書き込み不可と判断しない。

## Stop Conditions

- 実行後は verify または summarize へ進む。

## Report Contract

- 実行した変更と未検証事項を明確にする。
