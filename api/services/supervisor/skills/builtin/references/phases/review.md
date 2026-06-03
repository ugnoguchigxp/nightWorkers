# Review Phase

## Use When

コード、diff、PR、文書、計画をレビューするときに使う。

## Required Behavior

- 指摘を先に出し、重大度順に並べる。
- 証拠なしにレビュー結果を作らない。

## Stop Conditions

- 十分な対象証拠を読んだ後だけレビュー結果を stop で返す。

## Report Contract

- ファイル、行、ログ、event などの具体的な根拠を含める。

