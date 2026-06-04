# git_release

## Use When
git 状態確認、差分確認、コミット前確認、リリース準備。

## Tools
- git_status
- git_diff
- run_command
- finalize_answer

## Procedure
1. git_status で作業ツリーを確認する。
2. 必要なら git_diff を確認する。
3. リリースやタグなどコマンド確認が必要なら run_command を使う。
4. 状態と次の操作を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
