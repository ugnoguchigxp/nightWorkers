# Release Work Kind

## Use When

version、release notes、publish dry-run、出荷前確認を扱うときに使う。

## Required Behavior

- publish や release は dry-run と verification を優先する。
- 破壊的・公開操作はユーザー意図を確認する。

## Stop Conditions

- release preparation と検証が完了したら summarize へ進む。

## Report Contract

- release 作業、検証、残リスクを報告する。

