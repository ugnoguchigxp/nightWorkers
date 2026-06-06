# planning

## Use When
実装前の計画、設計から実装への分解、移行計画、段階リリース計画、レビュー観点、方針整理。

## Tools
- read_file
- search_files
- git_status
- git_diff
- run_command
- finalize_answer

## Procedure
1. 現行コード、既存 spec、schema、route、service、UI、test、runtime evidence を必要な範囲で確認する。
2. 目的、ユーザーに見える成果、対象範囲、対象外、非目標を明確にする。
3. 現状と目標状態を観測可能な挙動で整理する。
4. 実装に影響する設計判断だけを列挙し、理由、代替案、トレードオフ、後から戻せるかを書く。
5. 段階に分け、各段階に目的、作業、担当者または担当者 TBD、依存関係、受け入れ基準、検証、リスクを付ける。
6. データ移行、API / contract、security / privacy、観測性と運用、段階リリース、切り戻しまたは緩和策が関係する場合は個別 section を作る。
7. 情報不足は前提と未解決事項に分ける。実装判断を変える未解決事項は明示する。
8. 着手前チェックリスト、上位リスク、実行可否 gate、最初の実装 ticket をまとめる。
9. finalize_answer を呼ぶ。

## Quality Bar
- 作業一覧だけで終えない。
- 受け入れ基準は pass/fail で確認できる形にする。
- 切り戻し不能ならそう明記し、緩和策または forward-fix path を書く。
- 観測性は metrics / logs / traces / alerts の具体名で書く。
- security / privacy は理由なしに「影響なし」と書かない。
- 担当者が不明な場合も担当者 TBD として見えるようにする。
- 曖昧な作業名を避け、変更箇所、入力、出力、テスト要件を含める。

## Output Guidance
- ユーザーが template を指定しない場合は、概要、範囲、背景、目標状態、設計判断、実装段階、詳細作業、検証、段階リリース、切り戻しまたは緩和策、リスク、前提、未解決事項、着手前チェックリストの順を基本にする。
- 小さい計画では該当しない section を短く畳んでよいが、範囲、受け入れ基準、検証、リスク、切り戻しまたは緩和策は落とさない。

## Output
Always return only:
{ "toolCall": { "name": "finalize_answer", "arguments": { "message": "..." } } }
