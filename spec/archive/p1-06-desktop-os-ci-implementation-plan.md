# P1-06 OS 別 Desktop CI 実装計画

## 目的

macOS、Windows、Linux の desktop packaging と sidecar boundary を各 OS runner 上で検証し、設定ファイルだけでは検出できない platform 固有障害を防ぐ。

## 対応する改善項目

- 改善項目 11: Desktop の OS 別 CI を構築する。

## 依存関係

- 先行 Phase: P1-05、P0-01、P0-04。
- 後続 Phase: P1-07、P3-01。

## 実装範囲

1. macOS、Windows、Linux の workflow matrix を定義する。
2. platform target ごとの Node sidecar、libSQL native package、Codex package を準備する。
3. platform config と artifact filename を検証する。
4. macOS は packaged smoke、Windows / Linux は sidecar smoke を最低条件とする。
5. 可能な runner では package install / launch smoke を追加する。
6. build log、manifest、package artifact、failure diagnostic を保存する。

## 主な変更候補

- `.github/workflows/desktop-matrix.yml`
- `scripts/desktop/platform-targets.mjs`
- desktop build / prepare / smoke scripts
- Tauri platform config

## 対象外

- code signing credential の本番投入。
- Store submission。
- ARM / x64 の全組み合わせを初回から必須化すること。

## 検証計画

- 3 OS matrix が独立 job として実行される。
- native module と sidecar executable が target manifest と一致する。
- package artifact が CI から取得できる。
- 1 OS の失敗を他 OS の成功で隠さない。

## 完了条件

- release 対象 3 OS の必須 job が安定して成功する。
- platform 固有 failure が再現可能な log を持つ。
- macOS の既存 packaged smoke が維持される。
- Windows / Linux の少なくとも sidecar readiness が実 runner で確認される。
