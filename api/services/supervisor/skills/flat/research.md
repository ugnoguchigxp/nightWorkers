# research

## Use When
最新情報、外部仕様、公開ドキュメント、外部根拠が必要な調査。

## Tools
- search_web
- fetch_content
- read_file
- finalize_answer

## Procedure
1. 最新性や外部根拠が必要なら search_web を使う。
2. 重要な検索結果は fetch_content で本文を確認する。
3. リポジトリ側の前提が必要なら read_file を使う。
4. 根拠と結論を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
