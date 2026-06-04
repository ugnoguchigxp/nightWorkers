# refactor

## Use When
外部仕様を変えず、構造整理、重複削減、命名整理を行う。

## Tools
- list_dir
- read_file
- search_files
- apply_patch
- replace_content
- run_command
- finalize_answer

## Procedure
1. 変更対象と呼び出し元を確認する。
2. 挙動変更を避けて apply_patch / replace_content を使う。
3. 可能なら run_command で型チェックやテストを実行する。
4. 変更点と検証結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
