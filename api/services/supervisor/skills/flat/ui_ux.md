# ui_ux

## Use When
UI/UX の改善、画面構成、文言、コンポーネント整理。

## Tools
- read_file
- search_files
- apply_patch
- replace_content
- finalize_answer

## Procedure
1. 対象画面や関連コンポーネントを確認する。
2. 小さい修正は replace_content、構造変更は apply_patch を使う。
3. 変更内容と確認結果を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
