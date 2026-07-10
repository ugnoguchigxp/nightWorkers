# P0-04 CI 基盤 実装計画

## 目的

ローカルでのみ実行されている品質 gate を PR 必須 CI として再現し、mainline に検証されていない変更が入ることを防ぐ。

## 対応する改善項目

- 改善項目 4: CI を導入する。

## 依存関係

- 先行 Phase: P0-03。
- 後続 Phase: P0-05、P1-06、P2-05、P2-06。

## 実装範囲

1. GitHub Actions に Bun setup と lockfile cache を追加する。
2. static check、Supervisor regression、全 Vitest を base workflow として実行する。
3. Playwright browser を準備し、E2E smoke を独立 job で実行する。
4. dependency audit と desktop static/runtime check を別 job にする。
5. concurrency cancellation、job timeout、artifact retention を設定する。
6. secrets を必要とする live LLM test は必須 job に含めない。

## 主な変更候補

- `.github/workflows/verify.yml`
- `.github/workflows/e2e-smoke.yml`
- `.github/workflows/desktop-check.yml`
- CI 用 setup script
- `CONTRIBUTING.md`

## 対象外

- 自動 release。
- 自動 merge。
- provider credential を用いた live test。
- 3 OS packaged build matrix。これは P1-06 で扱う。

## 検証計画

- PR で全 job が起動する。
- 意図的な lint、type、test failure を一時 branch で検出できる。
- 同一 branch の古い workflow がキャンセルされる。
- CI artifact に failure report と Playwright trace が残る。

## 完了条件

- base、E2E smoke、dependency audit、desktop check が PR から確認できる。
- job 名と branch protection の required check が安定している。
- credential なしの fork 相当環境でも必須 job が実行できる。
- local command と CI command が乖離していない。

## ロールバック条件

- flaky job を required から外して放置しない。原因をfixture、port、DB isolation、timeoutに切り分け、安定するまで Phase を完了しない。
