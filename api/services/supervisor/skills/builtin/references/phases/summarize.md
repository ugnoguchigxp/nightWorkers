# Summarize Phase

## Use When

作業結果、検証結果、残リスクをユーザー向けにまとめるときに使う。

## Required Behavior

- instruction や rationale だけで結果を説明しない。
- finalize_answer.message にユーザーが読む本文を書く。

## Stop Conditions

- 変更、証拠、検証、未解決事項を説明できる場合だけ最終回答へ進む。

## Report Contract

- 変更点、検証結果、できなかったことがあれば短く報告する。
