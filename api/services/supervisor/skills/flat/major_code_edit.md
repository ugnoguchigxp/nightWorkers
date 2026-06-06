# major_code_edit

## Use When
複数ステップに分けるべきコード変更。migration、command、documentation、verification が混ざる可能性がある作業。

## Tools
- read_skill
- search_skill
- replace_todo_list
- start_todo
- complete_todo
- list_dir
- read_file
- search_files
- copy_directory
- apply_patch
- replace_content
- run_command
- run_verification
- git_status
- git_diff
- select_job_type
- finalize_answer

## Procedure
1. repository edit や command 実行の前に replace_todo_list を呼び、Run 内部 TodoList を作成する。
2. TodoList は Workbench Task や Queue item ではない。Run 内部の進行マイルストーンとして扱う。
3. replace_todo_list は全更新で使う。通常は startFirst=true または省略にし、最初の Todo を running にする。
4. Todo は成果物または gate 単位で分ける。例: investigation / migration / code_edit / documentation / verification。
5. 現在の Todo に必要な list_dir / read_file / search_files / copy_directory / apply_patch / replace_content / run_command / run_verification を実行する。
6. 空の Project root は有効な作業対象として扱う。空であることを理由に作業不能と判断しない。
7. `../template` や絶対パスなど Project root 外のコピー元は、ユーザー許可により safetyPolicy.externalAllowedPaths に含まれている場合だけ読む。未許可なら needs_human として許可を求める。
8. 外部テンプレートを取り込む場合は、許可後に copy_directory を優先する。shell の cp で代替しない。
9. CLI コマンドは run_command / run_verification 経由で、command policy が許可する単一コマンドだけ使う。`&&`、`;`、pipe、command substitution を含む chained shell は使わない。
10. Todo が完了したら、tool evidence に基づいて complete_todo を呼ぶ。実行中というだけで passed にしない。
11. complete_todo は既定で次の pending Todo を running にする。順序を変える必要がある場合だけ start_todo を使う。
12. すべての Todo が passed/skipped/needs_human/failed のいずれかになり、必要な最終確認が終わったら finalize_answer を呼ぶ。

## TodoList Shape
TodoList には少なくとも次の種類を必要に応じて含める。

- investigation: 対象範囲や既存構造の確認。
- migration: DB schema や migration file の追加・更新。
- code_edit: runtime、backend、frontend などの実装変更。
- documentation: README、spec、運用 docs の更新。
- verification: typecheck、test、lint、smoke などの検証。

## Completion
- Todo の status は pending / running / passed / failed / skipped / needs_human。
- UI のチェック済み表示は passed のみ。running は現在作業中を示す。
- finalize_answer.message には、完了した Todo、未完了 Todo、検証結果、残リスクを簡潔に書く。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
