# P2-05 Accessibility 自動検査 実装計画

## 目的

ARIA 属性の存在確認だけでなく、主要画面の semantic violation、keyboard flow、focus management、contrast を CI で継続検証する。

## 対応する改善項目

- 改善項目 17: 自動 accessibility 検査を追加する。

## 依存関係

- 先行 Phase: P2-04、P2-01、P0-04。
- 後続 Phase: P2-06、P3-02。

## 実装範囲

1. Playwright に axe 系 accessibility scan を統合する。
2. Overview、Workbench、Queue、Settings、Review artifact を対象にする。
3. keyboard-only で主要 navigation と操作を通す。
4. dialog の focus trap、close 後の focus return、Escape を検証する。
5. live status、alert、streaming region の読み上げ契約を確認する。
6. light / dark theme の contrast と reduced motion を確認する。

## 主な変更候補

- Playwright dependency / config
- accessibility E2E suite
- focus/dialog primitive
- status / alert / aria label を持つ各 UI
- CI accessibility job

## 対象外

- WCAG 全項目の第三者認証。
- visual redesign。
- screen reader 製品ごとの完全互換保証。

## 検証計画

- 主要 5 画面で critical / serious violation が 0。
- keyboard だけで Project、Session、Settings、Review に移動できる。
- modal open / close 前後の active element を assertion する。
- motion preference により不要な animation が抑制される。
- CI job と `verify:release` の関係を明示する。

## 完了条件

- 重大 accessibility violation が必須 CI を失敗させる。
- icon-only button が安定した accessible name を持つ。
- focus が hidden element や背景へ抜けない。
- 日本語と英語の両方で主要 accessible name を確認できる。
