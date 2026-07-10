# P0-01 Desktop Sidecar 起動障害 実装計画

## 目的

Desktop backend bundle の ESM import 衝突を解消し、sidecar readiness と packaged app smoke が成功する状態へ戻す。

## 対応する改善項目

- 改善項目 1: Desktop sidecar の起動障害を修正する。

## 依存関係

- 先行 Phase: なし。
- 後続 Phase: P0-02 以降すべて。

## 現状

`scripts/desktop/build-backend.mjs` の banner が `fileURLToPath` を宣言し、bundle 内に残る `api/modules/nightworkers/run-orchestration/runtime-execution.ts` の同名 ESM import と衝突する。Tauri build は成功するが、sidecar は readiness 前に構文エラーで終了する。

## 実装範囲

1. Desktop backend bundle の再現テストを固定する。
2. banner 内の識別子を衝突しない private alias に変更するか、banner shim を別 module boundary へ移す。
3. bundle 生成直後に Node ESM 構文検査を追加する。
4. prepare-sidecar が検査済み bundle だけを staging するようにする。
5. sidecar readiness、graceful shutdown、packaged smoke を順番に確認する。

## 主な変更候補

- `scripts/desktop/build-backend.mjs`
- `scripts/desktop/prepare-sidecar.mjs`
- `scripts/desktop/smoke-sidecar.mjs`
- `scripts/desktop/smoke-packaged-app.mjs`
- desktop build/runtime 関連テスト

## 対象外

- Tauri UI の再設計。
- Node sidecar architecture の process 分離。
- Linux / Windows CI matrix の追加。
- 通常 web build の bundle 方針変更。

## 検証計画

```bash
bun run build:backend:desktop
bun run desktop:prepare-sidecar
bun run desktop:smoke-sidecar
bun run verify:desktop
```

追加検証:

- 生成 bundle に同一 top-level import binding が重複しない。
- staging に必要な native package が欠落しない。
- readiness 成功後に sidecar を終了でき、port が閉じる。

## 完了条件

- `bun run verify:desktop` が最後まで成功する。
- sidecar が readiness 前に終了しない。
- packaged app smoke が成功する。
- 通常 backend build と既存 desktop runtime test に回帰がない。

## ロールバック条件

- banner 修正によって CommonJS package の runtime resolution が壊れる場合は、識別子変更だけを残さず変更を戻し、shim の module 分離案へ切り替える。
