# major_code_edit

## Use When
複数ステップに分けるべきコード変更。初期実装では実行対象外。

## Tools
- finalize_answer

## Procedure
1. 初期実装では major_code_edit を実行しない旨を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "finalize_answer", "arguments": { "message": "..." } } }
