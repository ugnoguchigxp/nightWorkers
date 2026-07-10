# P3-02 再現可能デモと文書同期 実装計画

## 目的

新規利用者が実 provider credential や本番 repository を使わずに NightWorkers の主要価値を確認できる demo を用意し、README、spec、command の drift を継続検出する。

## 対応する改善項目

- 改善項目 20: 再現可能な demo と documentation 同期検査を用意する。

## 依存関係

- 先行 Phase: P3-01、P1-05、P2-05。
- 後続 Phase: なし。

## 実装範囲

1. disposable な sample Project repository を用意する。
2. fixed seed と deterministic provider fixture で成功 run を再現する。
3. Project 登録、Plan、Queue、実装、Review、evidence 確認を 5〜10 分の導線にする。
4. demo reset command と cleanup contract を追加する。
5. screenshot または短い動画を生成・更新する手順を固定する。
6. README、Feature Tour、First Run、Roadmap、CHANGELOG の command / path link を検査する。
7. 完了済み plan を `spec/archive/` へ移し、参照 link を更新する check を追加する。

## 主な変更候補

- `demo/` 配下の sample Project / fixture
- demo setup / reset / smoke script
- README / Feature Tour / First Run Orientation
- GitHub Pages assets
- docs link / command consistency check
- demo E2E test

## 対象外

- hosted SaaS demo。
- 実 provider credential の同梱。
- 固定 transcript だけを見せる非実行 demo。

## 検証計画

- clean checkout から demo setup、run、reset を実行する。
- credential なしで主要 evidence が生成される。
- demo 後に target repository と runtime data を初期状態へ戻せる。
- docs 内の存在しない command、path、anchor、archive link を検出する。
- `bun run verify:release` と demo smoke を実行する。

## 完了条件

- 新規利用者が本番 repository なしで主要価値を確認できる。
- demo が CI または専用 smoke で再現される。
- README と package script が一致する。
- 解消済み項目が現行 Roadmap に残らない。
- この索引の完了済み Phase が archive policy に従って移動できる。
