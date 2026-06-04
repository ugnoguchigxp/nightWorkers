# Evidence Overlay

## Use When

repo evidence、logs、DB、run events、diff、file contents が判断に必要なときに使う。

## Required Behavior

- observations が空の場合、phase="stop" または phase="report" を返してはいけない。Tool catalog から適切な読み取り・検索ツールを1つ選び、toolCall を必ず返す。
- finalResponse には具体的な証拠参照を含める。
- phase="stop" の finalResponse は UI に表示されるレビュー結果本文である。

## Stop Conditions

- 必要な証拠を取得した後だけ decision phase="stop" へ進む。

## Report Contract

- ファイルパス、行、event id、コマンド、ログ識別子を含める。
