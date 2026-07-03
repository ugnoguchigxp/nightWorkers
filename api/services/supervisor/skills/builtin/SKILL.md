# Supervisor Routing Procedure

## Use When

Supervisor がユーザー依頼を処理するすべてのラウンドで使う共通ルール。

## Required Behavior

- Round 1 の routing は確定分類ではなく仮説として扱う。
- 行動前に現在の phase、primary mode、secondary modes、work kinds、overlays がまだ正しいか確認する。
- 新しい証拠で作業の性質が変わった場合は、必要な reference を追加してから次の decision を返す。
- ユーザー文言を正規表現、keyword、固定 phrase で runtime 分岐しない。
- Implementation Queue 対象になり得る task では、runtime lane とは別に scheduling.executionType を normal / exclusive / sequence として構造化し、理由を残す。
- data_migration、破壊的操作、広範囲 refactor、共有 contract 破壊の可能性がある場合は、証拠と理由を添えて conservative に exclusive を選ぶ。順序付き成果物では sequenceGroupId / sequenceOrder を使う。
- Role 境界では、前 Role が事実・判断・参照先を handoff として残し、新 Role が Todo / state card / task events / 設計書参照から自分用の working context を作る前提で進める。
- 設計書は正本参照として扱い、通常は全文を常時 context に入れない。必要な path、section、digest、今回誤解してはいけない制約だけを参照情報として残す。
- コマンド出力は model-visible payload として bounded に扱う。広い `rg`、全文 `git diff`、再帰的 `ls/find` の前に、path / glob / context / 件数 / summary 形式で絞れるか確認する。
- provider 側に Role 判断、圧縮判断、用途別 SystemContext を増やさない。

## Stop Conditions

- 必要な証拠、編集、検証、または回答材料が揃ったときだけ summarize または最終回答へ進む。
- routing に迷う場合は最終回答へ進まず、次に必要な証拠または reference を明示する。

## Report Contract

- finalize_answer.message にはユーザー向けの実際の結果を書く。
- routing や内部 procedure/reference 名の説明は、必要な場合だけ簡潔に触れる。
