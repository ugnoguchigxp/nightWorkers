# Supervisor Routing Procedure

## Use When

Supervisor がユーザー依頼を処理するすべてのラウンドで使う共通ルール。

## Required Behavior

- Round 1 の routing は確定分類ではなく仮説として扱う。
- 行動前に現在の phase、primary mode、secondary modes、work kinds、overlays がまだ正しいか確認する。
- 新しい証拠で作業の性質が変わった場合は、必要な reference を追加してから次の decision を返す。
- ユーザー文言を正規表現、keyword、固定 phrase で runtime 分岐しない。
- Role 境界では、前 Role が事実・判断・参照先を handoff として残し、新 Role が Todo / state card / task events / 設計書参照から自分用の working context を作る前提で進める。
- 設計書は正本参照として扱い、通常は全文を常時 context に入れない。必要な path、section、digest、今回誤解してはいけない制約だけを参照情報として残す。
- provider 側に Role 判断、圧縮判断、用途別 SystemContext を増やさない。

## Stop Conditions

- 必要な証拠、編集、検証、または回答材料が揃ったときだけ summarize または最終回答へ進む。
- routing に迷う場合は最終回答へ進まず、次に必要な証拠または reference を明示する。

## Report Contract

- finalize_answer.message にはユーザー向けの実際の結果を書く。
- routing や内部 procedure/reference 名の説明は、必要な場合だけ簡潔に触れる。
