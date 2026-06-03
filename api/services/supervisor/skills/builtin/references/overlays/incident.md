# Incident Overlay

## Use When

failed run、regression、production impact、運用異常、緊急調査の可能性があるときに使う。

## Required Behavior

- 新鮮な logs、DB、runtime evidence から始める。
- 影響範囲と停止条件を明確にする。

## Stop Conditions

- 初動判断、原因候補、次の対応が明確になったら summarize または execute へ進む。

## Report Contract

- 影響、証拠、暫定判断、残作業を短く報告する。

