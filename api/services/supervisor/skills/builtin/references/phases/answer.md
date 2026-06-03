# Answer Phase

## Use When

証拠取得、編集、検証なしでユーザーに直接回答できるときに使う。

## Required Behavior

- リポジトリ証拠や外部情報が必要なら answer から別 phase へ移る。
- 不確実な事実を断定しない。

## Stop Conditions

- finalResponse に回答を直接書ける場合だけ stop する。

## Report Contract

- 短く、ユーザーの質問に直接答える。

