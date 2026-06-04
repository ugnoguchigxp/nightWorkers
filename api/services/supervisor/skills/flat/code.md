# code

## Use When
コード関連の小さな作業。迷う場合は minor_code_edit に近い手順で進める。

## Tools
- list_dir
- read_file
- search_files
- apply_patch
- replace_content
- run_command
- finalize_answer

## Procedure
1. 対象コードを確認する。
2. 必要な変更を apply_patch または replace_content で行う。
3. 必要なら run_command で確認する。
4. finalize_answer を呼ぶ。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
