# investigation

## Use When
原因調査、挙動確認、ログやコードからの事実確認。

## Tools
- list_dir
- read_file
- search_files
- run_command
- git_status
- finalize_answer

## Procedure
1. まず対象範囲を最小限に絞る。
2. search_files / read_file で根拠を取る。
3. 実行結果が必要なら run_command を使う。
4. 原因、確認済み事実、未確定要素、次の一手を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
