# P2-03 Queue DB Lease 完成 実装計画

## 目的

Queue item の claim、heartbeat、lease expiry、recovery を DB の atomic contract として完成させ、process crash や複数 processor でも二重実行を防ぐ。

## 対応する改善項目

- 改善項目 16: Queue 所有権を完全に DB lease 化する。

元の優先リストでは Worker process 分離が先だが、process 分離の安全な前提になるため本 Phase を先行させる。

## 依存関係

- 先行 Phase: P2-02、P1-04。
- 後続 Phase: P2-04。

## 実装範囲

1. queue entry に owner ID、lease acquired/expiry、heartbeat、attempt、last recovery reason を持たせる。
2. SQLite transaction で atomic claim を実装する。
3. owner 一致と lease validity を mutation の前提にする。
4. lease expiry 後の再取得、max attempt、needs_human 遷移を定義する。
5. stale owner による finalize / heartbeat / cancel を拒否する。
6. startup reconcile が live lease と stale lease を区別する。

## 主な変更候補

- queue schema / migration
- `api/modules/queue/queue.repository.ts`
- queue management / scheduling service
- startup reconciliation
- queue concurrency / recovery test

## 対象外

- Worker subprocess の追加。
- distributed consensus。
- remote queue service の導入。
- parallel agent proposal model。

## 検証計画

- 2 processor の同時 claim で 1 owner だけが成功する。
- heartbeat 中の lease は再取得されない。
- lease expiry 後は新 owner が attempt を増やして取得できる。
- stale owner の finalize が DB と event の両方で拒否される。
- process crash fixture から startup reconcile で復旧できる。
- `bun run verify:full` を実行する。

## 完了条件

- 同一 queue entry / run が二重実行されない。
- owner と lease の正本が DB row になる。
- crash recovery の結果と理由が event ledger に残る。
- process-local drain guard は補助最適化であり、正当性の前提ではなくなる。

## ロールバック条件

- migration 後に旧 queue row を解釈できない場合は roll-forward migration で補正する。DB を destructive reset して完了扱いにしない。
