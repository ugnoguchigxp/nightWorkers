# Refactor Work Kind

## Use When

外部挙動を保った責務分離、重複削減、構造改善を行うときに使う。

## Required Behavior

- 仕様変更を混ぜない。
- 既存テストや型検査で振る舞い維持を確認する。

## Stop Conditions

- refactor と検証が完了したら summarize へ進む。

## Report Contract

- 構造変更と検証結果を分けて報告する。

