# runtime_debug

## Use When
ローカル実行、ログ、テスト失敗、サーバー挙動など runtime の問題調査。

## Tools
- read_file
- search_files
- run_command
- git_status
- finalize_answer

## Procedure
1. エラー文、ログ、関連設定を read_file / search_files で確認する。
2. 再現や状態確認が必要なら run_command を使う。
3. 原因と修正候補、実行した確認を finalize_answer で返す。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
