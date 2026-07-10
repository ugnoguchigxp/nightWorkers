# P2-06 依存更新自動化 実装計画

## 目的

依存 advisory と更新可能 version を継続的に検出し、Critical / High が長期間放置されない運用を構築する。

## 対応する改善項目

- 改善項目 18: 依存更新を自動運用する。

## 依存関係

- 先行 Phase: P2-05、P0-03、P0-04。
- 後続 Phase: P3-01。

## 実装範囲

1. Renovate または Dependabot のどちらか一つを選ぶ。
2. runtime、development、Tauri/Rust、GitHub Actions の update group を分ける。
3. patch / minor と major で review policy を分ける。
4.週次 dependency audit と advisory issue / PR を自動化する。
5. lockfile integrity と SBOM を release artifact に含める。
6. allowlist entry に理由、owner、expiry、advisory ID を必須化する。

## 主な変更候補

- `.github/dependabot.yml` または `renovate.json`
- dependency audit workflow
- audit policy / allowlist schema
- SBOM generation script
- CONTRIBUTING / security policy

## 対象外

- major update の自動 merge。
- CI failure を無視する dependency PR。
- 複数 bot の併用。

## 検証計画

- test dependency を一時的に古い version へ固定し、update PR が作られることを確認する。
- Critical / High advisory が workflow failure または issue になる。
- allowlist expiry 後に再び failure になる。
- SBOM が package / version / license を含む。

## 完了条件

- patch update PR に必須 CI が付く。
- 新規 Critical / High が自動通知される。
- 期限切れ allowlist が黙って残らない。
- Bun lockfile と Rust lockfile の更新責務が明確である。
