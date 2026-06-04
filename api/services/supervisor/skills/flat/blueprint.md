# blueprint

## Use When
画面案、構成案、Blueprint artifact、UI 構造の文書化や修正。

## Tools
- read_file
- search_files
- apply_patch
- replace_content
- finalize_answer

## Procedure
1. 既存 Blueprint schema / spec / 関連文書を確認する。
2. 必要な文書や artifact 変更を apply_patch / replace_content で行う。
3. 変更が不要なら構成案を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
