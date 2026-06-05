# Supervisor Routing Skill

## Use When

Supervisor がユーザー依頼を処理するすべてのラウンドで使う共通ルール。

## Required Behavior

- Round 1 の routing は確定分類ではなく仮説として扱う。
- 行動前に現在の phase、primary mode、secondary modes、work kinds、overlays がまだ正しいか確認する。
- 新しい証拠で作業の性質が変わった場合は、必要な reference を追加してから次の decision を返す。
- ユーザー文言を正規表現、keyword、固定 phrase で runtime 分岐しない。

## Stop Conditions

- 必要な証拠、編集、検証、または回答材料が揃ったときだけ summarize または最終回答へ進む。
- routing に迷う場合は最終回答へ進まず、次に必要な証拠または reference を明示する。

## Report Contract

- finalize_answer.message にはユーザー向けの実際の結果を書く。
- routing や内部 skill 名の説明は、必要な場合だけ簡潔に触れる。
