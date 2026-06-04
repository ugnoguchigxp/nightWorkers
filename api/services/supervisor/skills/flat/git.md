# git

## Use When
git status、diff、履歴確認に近い作業。

## Tools
- git_status
- git_diff
- run_command
- finalize_answer

## Procedure
1. git_status で状態を確認する。
2. 差分が必要なら git_diff を使う。
3. 追加の git command が必要なら run_command を使う。
4. 結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
