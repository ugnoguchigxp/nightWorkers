# Destructive Operation Overlay

## Use When

delete、reset、force push、migration、データ消去など戻しにくい操作が関係するときに使う。

## Required Behavior

- 明示依頼なしに destructive operation を実行しない。
- 代替手段、dry-run、backup、影響範囲を確認する。

## Stop Conditions

- 安全な非破壊手順が実行できるか、ユーザー承認が必要な状態になったら summarize へ進む。

## Report Contract

- 危険操作の有無と、実行した安全策を報告する。

