# Dependency Work Kind

## Use When

package、library、framework、lockfile、SDK の更新を扱うときに使う。

## Required Behavior

- 互換性、lockfile 差分、関連テストを確認する。
- 最新情報が必要なら research overlay を追加する。

## Stop Conditions

- dependency change と検証が完了したら summarize へ進む。

## Report Contract

- 更新対象、理由、検証結果を報告する。

