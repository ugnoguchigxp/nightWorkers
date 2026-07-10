# P2-04 Worker Process 分離 実装計画

## 目的

repository execution を API process から別 worker process へ分離し、重い command、runtime crash、memory leak が HTTP / WebSocket control plane を停止させない構造にする。

## 対応する改善項目

- 改善項目 15: API process と worker execution を分離する。

## 依存関係

- 先行 Phase: P2-03。
- 後続 Phase: P2-05、P3-01。

## 実装範囲

1. API 側から executor interface を切り出す。
2. worker process が DB lease を claim して run を開始する。
3. run event、Todo、artifact、usage は既存 ledger へ保存する。
4. heartbeat、graceful shutdown、forced termination、restart を実装する。
5. API restart と worker restart の組み合わせを定義する。
6. desktop sidecar が API と worker の lifecycle を安全に管理する。
7. in-process mode を残す場合は test/dev 用の明示設定に限定する。

## 主な変更候補

- executor interface / registry
- worker process entrypoint
- API startup / shutdown
- Tauri sidecar process management
- run control / heartbeat service
- worker isolation integration test

## 対象外

- 複数 host に跨る distributed worker。
- multi-agent proposal execution。
- hosted control plane。

## 検証計画

- worker を強制終了しても API health が成功する。
- lease expiry 後に別 worker が安全に復旧する。
- API restart 後も live worker または stale lease を正しく判定する。
- SIGTERM で open command と artifact flush を処理する。
- desktop packaged smoke と主要 E2E を実行する。
- `bun run verify:release` を実行する。

## 完了条件

- worker crash で API process が終了しない。
- run ownership と progress が DB / ledger から復元できる。
- registered Project repo root 以外を workspace にしない。
- desktop app の start / stop で orphan worker が残らない。

## ロールバック条件

- process 分離で evidence が欠落する場合は transport を増やす前に ledger write ownership を見直す。in-memory event だけで補完しない。
