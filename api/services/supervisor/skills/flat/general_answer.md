# general_answer

## Use When
実行やリポジトリ変更を伴わない軽い回答。

## Tools
- finalize_answer

## Procedure
1. 回答できる場合は finalize_answer を呼ぶ。

## Output
Always return only:
{ "toolCall": { "name": "finalize_answer", "arguments": { "message": "..." } } }
