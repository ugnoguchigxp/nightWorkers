# P2-02 巨大 Backend 分割 実装計画

## 目的

巨大 service / controller を domain orchestration、repository、provider adapter、normalizer へ分離し、provider/runtime責務と永続化境界を明確にする。

## 対応する改善項目

- 改善項目 14: 巨大 Backend service を分割する。

## 依存関係

- 先行 Phase: P2-01、P1-04。
- 後続 Phase: P2-03、P2-04。

## 実装順

1. structured LLM provider dispatch。
2. Workbench orchestration service。
3. Queue service / repository。
4. Native API startup controller。
5. DB bootstrap。

## 実装範囲

1. 既存 route、schema、event、DB row 契約を characterization test で固定する。
2. provider call、JSON extraction、schema validation、compatibility normalization を provider 層に限定する。
3. workflow 判断は Supervisor prompt / skill / orchestration 層へ維持する。
4. repository は persistence だけを所有し、status transition 判断を持たせない。
5. bootstrap migration と runtime reconciliation を別責務に分ける。

## 対象外

- provider contract の機能追加。
- DB schema redesign。
- Queue lease implementation。P2-03 で扱う。
- Worker process 分離。P2-04 で扱う。

## 検証計画

- provider、Workbench、Queue、startup、bootstrap の既存 regression suite を対象ごとに実行する。
- API response、event type、status transition、DB row の互換性を確認する。
- import cycle 検査を行う。
- `bun run test:supervisor-regression` と `bun run verify:full` を実行する。

## 完了条件

- provider 層へ用途別 workflow 判断が流入していない。
- route handler が業務判断を持っていない。
- repository と orchestration の責務が区別できる。
- public schema と persisted event に意図しない変更がない。

## ロールバック条件

- 互換 adapter が増え続ける場合は一括分割を止め、1 service 単位へ戻す。移動だけで依存方向が改善しない変更は採用しない。
