# P1-02 Timeline 仮想化 実装計画

## 目的

長時間 run の Timeline を event 件数に比例して全件 mount する構造から、cursor 取得・表示 window・遅延展開を使う構造へ変更する。

## 対応する改善項目

- 改善項目 7: Workbench Timeline を仮想化する。

## 依存関係

- 先行 Phase: P1-01。
- 後続 Phase: P1-03、P2-01。

## 現状

長い run では通常表示でも約 23,465 DOM node、193 button を保持する。debug event と大きな tool result が React tree に残り、履歴量に比例して描画負荷が増える。

## 実装範囲

1. chat message、run event、streaming item の canonical ordering key を固定する。
2. 既存の run event cursor API を使って過去履歴を段階取得する。
3. viewport 周辺だけを mount する windowing を導入する。
4. tool result、raw JSON、長い code block は展開時に初めて重い DOM を生成する。
5. streaming 末尾追従と、ユーザーが過去を読んでいる場合の scroll 固定を分離する。
6. reconnect replay の重複排除と seq 欠落検出を維持する。

## 主な変更候補

- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `ThreadTimeline*` renderer 群
- realtime event selector / hook
- run event read API client
- Timeline / reconnect 関連テスト

## 対象外

- event schema の全面変更。
- debug evidence の削除。
- Artifact Pane の仮想化。

## 検証計画

- 500、2,000、10,000 event fixture を作る。
- event 件数が 10 倍でも mounted DOM が同程度の上限に収まることを測る。
- 最新 event 追従、過去 scroll、debug toggle、artifact open、copy を確認する。
- reconnect 後に event の重複・欠落・順序逆転がないことを確認する。
- E2E で長い Timeline の操作を確認する。

## 完了条件

- event 件数と mounted DOM node 数が比例しない。
- collapsed item は大きな payload DOM を持たない。
- streaming と過去閲覧が互いに scroll を奪わない。
- persisted ledger と画面表示の seq が一致する。
