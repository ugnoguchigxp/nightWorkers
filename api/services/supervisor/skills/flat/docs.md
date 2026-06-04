# docs

## Use When
README、spec、設計書、運用ドキュメントの作成や修正。

## Tools
- list_dir
- read_file
- search_files
- apply_patch
- replace_content
- finalize_answer

## Procedure
1. 対象ドキュメントまたは近い文書を確認する。
2. 小さい修正は replace_content、新規や構造変更は apply_patch を使う。
3. 必要なら read_file で確認する。
4. 変更点を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
