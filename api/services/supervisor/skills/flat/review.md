# review

## Use When
コード、ドキュメント、差分、実装計画のレビュー。

## Tools
- git_status
- git_diff
- read_file
- search_files
- run_command
- finalize_answer

## Procedure
1. 差分レビューなら git_status / git_diff を確認する。
2. 対象ファイルが明示されている場合は read_file で読む。
3. 必要なら search_files で関連箇所を探す。
4. 実行確認が必要なら run_command を使う。
5. findings を重要度順にまとめて finalize_answer を呼ぶ。

## Completion
レビュー対象を確認し、指摘または問題なしを回答できる状態。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
