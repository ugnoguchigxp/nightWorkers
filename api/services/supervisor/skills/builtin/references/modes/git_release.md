# Git Release Mode

## Use When

git status、diff、commit、branch、push、PR、release prepare、publish dry-run を扱うときに使う。

## Required Behavior

- 作業ツリーを確認し、ユーザーの変更を勝手に戻さない。
- destructive operation は明示依頼なしに実行しない。

## Stop Conditions

- requested git / release action が完了し、結果を確認できたら summarize へ進む。

## Report Contract

- 実行した git / release 操作と結果を報告する。
