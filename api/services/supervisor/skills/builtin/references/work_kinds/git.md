# Git Work Kind

## Use When

git status、diff、stage、commit、branch、push、PR を扱うときに使う。

## Required Behavior

- ユーザー変更を勝手に戻さない。
- stage、commit、push は成功後に trace できる形で報告する。

## Stop Conditions

- requested git operation が完了したら summarize へ進む。

## Report Contract

- branch、commit、push、PR の結果を明記する。

