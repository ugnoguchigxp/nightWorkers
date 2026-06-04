# release

## Use When
リリース準備、変更確認、バージョン/タグ/ビルド確認。

## Tools
- git_status
- git_diff
- run_command
- read_file
- finalize_answer

## Procedure
1. git_status / git_diff でリリース対象差分を確認する。
2. 必要な manifest や changelog を read_file で確認する。
3. ビルドや dry-run が必要なら run_command を使う。
4. 状態、未完了事項、次の操作を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
