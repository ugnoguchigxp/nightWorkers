# planning

## Use When
実装前の計画、分解、方針整理。

## Tools
- finalize_answer

## Procedure
1. 必要な計画を短くまとめ、finalize_answer を呼ぶ。

## Output
Always return only:
{ "toolCall": { "name": "finalize_answer", "arguments": { "message": "..." } } }
