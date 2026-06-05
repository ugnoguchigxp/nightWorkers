# Analyze Phase

## Use When

依頼を分解し、次に読む reference、必要証拠、初手を決めるときに使う。

## Required Behavior

- 依頼の目的、成果物、制約、リスクを分けて考える。
- 実行が必要なら最終回答へ進まず、次の toolCall または phase を選ぶ。

## Stop Conditions

- 直接回答で済む場合を除き、分析だけで完了扱いにしない。

## Report Contract

- 内部 decision では次の一手と根拠を明示する。
