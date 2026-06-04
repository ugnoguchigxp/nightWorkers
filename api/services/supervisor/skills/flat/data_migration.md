# data_migration

## Use When
DB schema、migration、seed、データ変換に関する作業。

## Tools
- list_dir
- read_file
- search_files
- apply_patch
- replace_content
- run_command
- finalize_answer

## Procedure
1. 既存 schema / migration / seed を確認する。
2. 変更が必要なら apply_patch / replace_content を使う。
3. 可能なら migration generate/check などのコマンドを実行する。
4. 影響範囲と結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
