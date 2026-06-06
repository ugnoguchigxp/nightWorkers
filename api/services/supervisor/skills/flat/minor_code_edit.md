# minor_code_edit

## Use When
小さい変更タスク、ちょっとした修正、小さい新規作成、単一ファイルまたは少数ファイルの明確な変更。

## Tools
- read_file
- search_files
- apply_patch
- replace_content
- run_command
- select_job_type
- finalize_answer

## Procedure
1. 対象パスが分かっている場合は read_file で確認し、周辺ディレクトリ一覧は取らない。
2. search_files は対象パスが不明な場合や、横断検索が必要な場合だけ使う。
3. 新規作成なら apply_patch を使う。
4. 既存ファイルの単純置換なら replace_content を使う。
5. apply_patch が成功したら changedFiles の対象を read_file する。
6. 完了したら finalize_answer を呼ぶ。

## Completion
LLM が依頼内容を満たしたと判断したら finalize_answer を呼ぶ。runtime は完了可否を判定しない。
finalize_answer.message でプロジェクト内のファイルに触れる場合は、プロジェクトルートからの相対パスで書く。

## Switch Job Type
外部ディレクトリテンプレートのコピー、外部リポジトリーの clone や fork、または複数ステップの検証を伴う作業だと分かった場合は select_job_type で major_code_edit に切り替える。

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
