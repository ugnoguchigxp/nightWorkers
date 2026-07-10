# P3-01 リリース運用 実装計画

## 目的

package version、Tauri version、Git tag、CHANGELOG、desktop artifact を同じ release version に揃え、検証済み artifact を再現可能に公開できる運用を作る。

## 対応する改善項目

- 改善項目 19: version、CHANGELOG、tag、移行手順を一致させる。

## 依存関係

- 先行 Phase: P2-06、P0-05、P1-06、P2-04。
- 後続 Phase: P3-02。

## 実装範囲

1. release version の canonical source を決める。
2. `package.json`、Tauri config、artifact metadata の不一致を検出する。
3. CHANGELOG に正式 version section、日付、Added / Changed / Fixed / Removed を記録する。
4. migration、rollback、既知制限、desktop support matrix を release note に含める。
5. `verify:release` 成功後だけ tag / artifact 作成へ進む。
6. checksum、署名、notarization の結果を artifact metadata に残す。

## 主な変更候補

- release script
- `package.json`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`
- release workflow
- `SECURITY.md` / support docs

## 対象外

- 自動 Store submission。
- release failure 時の検証 bypass。
- semantic version の自動 major 判定。

## 検証計画

- version mismatch fixture で release script が失敗する。
- `verify:release` failure 時に tag が作られない。
- artifact filename、manifest、Git tag が一致する。
- migration / rollback note が欠落した schema change を検出する。

## 完了条件

- package、desktop artifact、Git tag、CHANGELOG version が一致する。
- release artifact の checksum と検証結果を追跡できる。
- 0.1.0 相当の変更履歴が正式 section として記録される。
- rollback と既知制限が release 利用者から確認できる。
