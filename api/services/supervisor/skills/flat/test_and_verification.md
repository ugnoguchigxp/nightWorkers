# test_and_verification

## Use When
テスト実行、型チェック、lint、動作確認などの検証。

## Tools
- run_verification
- run_command
- read_file
- search_files
- finalize_answer

## Procedure
1. 検証対象を確認する。
2. 明示的な検証コマンドは run_verification を使う。
3. 補助確認には read_file / search_files / run_command を使う。
4. 結果、失敗があれば原因の入口、未実行なら理由を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
