# major_code_edit

## Use When
複数ステップに分けるべきコード変更。外部ディレクトリテンプレートのコピー、外部リポジトリーの clone や fork、migration、command、documentation、verification が混ざる可能性がある作業。

## Tools
- read_procedure
- search_procedure
- todo_list
- list_dir
- read_file
- search_files
- import_project
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
1. repository edit や command 実行の前に todo_list operation=replace を呼び、Run 内部 TodoList を作成する。
2. TodoList は Workbench Task や Queue item ではない。Run 内部の進行マイルストーンとして扱う。
3. todo_list operation=replace は全更新で使う。通常は startFirst=true または省略にし、最初の Todo を running にする。
4. Todo は成果物または gate 単位で分ける。例: investigation / migration / code_edit / documentation / verification。
5. 現在の Todo に必要な list_dir / read_file / search_files / import_project / copy_directory / apply_patch / replace_content / run_command / run_verification を実行する。
6. 空の Project root は有効な作業対象として扱う。空であることを理由に作業不能と判断しない。新規プロジェクト / 新規ファイル作成依頼では、指定がない限り標準テンプレート適用を優先し、blank 指定や小さい単体ファイル作成だけ apply_patch で作成する。
7. `../template` や絶対パスなど Project root 外のコピー元は、ユーザー許可により safetyPolicy.externalAllowedPaths に含まれている場合だけ読む。未許可なら needs_human として許可を求める。
8. 指定がない新規 Web / API / Hono アプリは import_project で source=starter, stack=hono の既定 SQLite variant を使う。DB 指定がある場合は postgres / pgvector / turso / cloudflare など該当 variant を選ぶ。RAG、ナレッジベース検索、embedding を使う文書検索、agentic search が主要要件なら hono stack で variant=rag を選ぶ。SSR / SSG 指定があり DB/RAG variant がない場合は該当 overlay を指定する。DB/RAG variant と overlay を1回の import_project で合成しない。
9. stack=python は、ユーザーが Python / FastAPI を明示した場合、または ML 活用や大きな数学的・科学技術計算が主要要件に含まれる場合に使う。
10. import_project を Project import の単一入口として使う。新規雛形は source=starter と stack/variant、任意の外部 Git repository は source=git と repoUrl を渡す。
11. import_project で扱える取り込みは run_command git clone で代替しない。
12. 外部ディレクトリテンプレートを取り込む場合は、許可後に copy_directory を優先する。shell の cp で代替しない。
13. テンプレートを取り込む TodoList には、import_project / copy_directory だけでなく manifest inspection と manifest-based verification を必ず含める。
14. import_project 後は postImport.gitInitialization、postImport.llmContext があればそれ、あわせて postImport.manifest、postImport.initialization の実出力を先に使う。payload が欠落している、または修復対象の失敗がある場合を除き、LLM_CONTEXT.md や package.json の再読込、install 再実行をしない。
15. copy_directory 後は read_file で package.json や pyproject.toml を読み、scripts / tool config から build / lint / typecheck / test / verify / pytest / ruff / pyright など利用可能な検証を選ぶ。
16. 選んだ検証は run_verification で実行する。依存関係が未導入で検証不能な場合は、理由と次アクションを Todo / final report に残す。
17. CLI コマンドは run_command / run_verification 経由で、command policy が許可する単一コマンドだけ使う。`&&`、`;`、pipe、command substitution を含む chained shell は使わない。
18. 実行順序は specification 確認 -> Todo 実行 -> verification -> closeout とする。planning は closeout ではない。
19. Todo が完了したら、tool evidence に基づいて todo_list operation=done を呼ぶ。実行中というだけで passed にしない。
20. todo_list operation=done は既定で次の pending Todo を running にする。順序を変える必要がある場合だけ operation=start を使う。
21. 外部承認や追加情報待ちでは todo_list operation=block、実装や verification の確定失敗では operation=fail を使う。どちらも次 Todo を自動開始しない。
22. Todo tracking failure は task completion ではない。tracking に失敗しても次アクションが明確なら実装を継続し、closeout へ逃げない。
23. compile_eval は planning や Todo 登録直後ではなく、implementation と verification が終わり、実装 Todo が pending/running で残っていない closeout でのみ扱う。
24. すべての Todo が passed/skipped/needs_human/failed のいずれかになり、必要な最終確認が終わったら finalize_answer を呼ぶ。

## TodoList Shape
TodoList には少なくとも次の種類を必要に応じて含める。

- investigation: 対象範囲や既存構造の確認。
- migration: DB schema や migration file の追加・更新。
- code_edit: runtime、backend、frontend などの実装変更。
- documentation: README、spec、運用 docs の更新。
- verification: typecheck、test、lint、smoke などの検証。

外部テンプレート取り込みでは少なくとも次を含める。

- import: import_project で登録済み標準テンプレートまたは任意 Git repository を Project root に取り込む。
- copy: 許可済み外部ディレクトリテンプレートを copy_directory で Project root にコピーする。
- inspection: 取り込み後の package.json / pyproject.toml と主要構成を確認する。
- verification: manifest に基づき build / lint / typecheck / test / verify / pytest / ruff / pyright などを run_verification で実行する。
- finalize: Todo と検証結果を確認し、残リスクをまとめる。

## Completion
- Todo の status は pending / running / passed / failed / skipped / needs_human。
- UI のチェック済み表示は passed のみ。running は現在作業中を示す。
- finalize_answer.message には、完了した Todo、未完了 Todo、検証結果、残リスクを簡潔に書く。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
