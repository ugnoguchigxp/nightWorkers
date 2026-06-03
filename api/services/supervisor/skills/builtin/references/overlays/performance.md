# Performance Overlay

## Use When

latency、resource usage、token、query、runtime cost、timeout を扱うときに使う。

## Required Behavior

- 推測だけで原因を決めず、計測値、ログ、コードパスを確認する。
- 改善後は比較可能な検証を行う。

## Stop Conditions

- bottleneck、変更、検証結果が明確になったら summarize へ進む。

## Report Contract

- 何が遅く、何を確認し、どう改善したかを報告する。

