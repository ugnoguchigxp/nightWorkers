# Investigate Phase

## Use When

不具合、失敗 run、ログ異常、原因不明の挙動を調査するときに使う。

## Required Behavior

- いきなり code edit に進まず、症状、再現条件、ログ、関連コードを確認する。
- 仮説は証拠で検証する。
- observed facts、棄却した仮説、次に必要な evidence を、次 Role が再探索せず読める参照として残す。

## Stop Conditions

- 原因が特定できたら execute、verify、または summarize へ進む。

## Report Contract

- 症状、確認した証拠、最も可能性の高い原因、次の対応を示す。
