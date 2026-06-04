# dependency

## Use When
依存関係、package 設定、lockfile、ライブラリ利用箇所の確認や変更。

## Tools
- read_file
- search_files
- run_command
- apply_patch
- replace_content
- finalize_answer

## Procedure
1. package / lockfile / 利用箇所を確認する。
2. 必要な変更を apply_patch / replace_content で行う。
3. インストールや検証が必要なら run_command を使う。
4. 変更と検証結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
