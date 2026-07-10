# Run Control Kernel 運用評価 残タスク

## Status

operational-validation

## 現在地

Run Control Kernelのschema、action ledger、dedupe、canonical projection、shared finalize guard、
recovery、context epoch、evidence-bound Todo、metrics、DB比較CLIは実装済みである。
実装詳細は `spec/archive/model-agnostic-run-control-kernel-implementation-plan.md` を参照する。

## 残タスク

1. 同一repository、同一acceptance、同一verification gateの新規実タスクを次のmodel laneで実行する。
   - strong hosted model
   - 5.4 mini相当
   - local Qwen
2. 各runで次を保存する。
   - terminal stateとfalse completionの有無
   - duplicate action数とaction reuse数
   - model-visible chars
   - input / cached / output token
   - closeout後の追加turn数
   - context epoch回数とrecovery結果
3. `bun run run-control:compare` で実装前DBと実装後DBを比較する。
4. 品質ゲート通過率とmodelごとの完遂率を分けて報告する。
5. 実測で過剰停止または反復継続が確認された場合だけ、no-progress閾値とcontext epoch条件を調整する。

## 完了条件

- 3 model laneへ同一acceptance / evidence gateを適用した結果が残る。
- duplicate action、closeout turn、model-visible payload、false completionをbaselineと比較できる。
- 弱いmodel向けに品質条件を下げていないことを確認できる。
- 調整が必要な場合、変更前後の測定値とrollback条件が記録される。
