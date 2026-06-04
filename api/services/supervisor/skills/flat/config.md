# config

## Use When
設定ファイル、環境設定例、ビルド/ツール設定の確認や修正。

## Tools
- list_dir
- read_file
- search_files
- apply_patch
- replace_content
- run_command
- finalize_answer

## Procedure
1. 対象設定と参照箇所を確認する。
2. 必要な変更を apply_patch / replace_content で行う。
3. 可能なら関連コマンドで確認する。
4. finalize_answer を呼ぶ。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
