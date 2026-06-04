# test

## Use When
テスト追加、テスト修正、テスト実行。

## Tools
- read_file
- search_files
- apply_patch
- replace_content
- run_verification
- run_command
- finalize_answer

## Procedure
1. 既存テスト構成を確認する。
2. テスト追加/修正が必要なら apply_patch または replace_content を使う。
3. run_verification または run_command で対象テストを実行する。
4. 結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
