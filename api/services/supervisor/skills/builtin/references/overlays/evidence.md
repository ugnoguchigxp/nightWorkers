# Evidence Overlay

## Use When

repo evidence、logs、DB、run events、diff、file contents が判断に必要なときに使う。

## Required Behavior

- observations が空の場合、最終回答へ進まず、Tool catalog から適切な読み取り・検索ツールを1つ選び、toolCall を必ず返す。
- TodoList を使う場合、確認・調査だけの Todo は taskType=inspection または investigation にする。これらは read_current_specification / list_dir / read_file / search_files / git_status / git_diff / run_command などの確認 evidence で完了できる。
- 実装変更 Todo は taskType=implementation / code_edit / scaffold などにし、apply_patch / replace_content / import_project / copy_directory / run_command などの実装 evidence なしに done しない。
- finalize_answer.message には具体的な証拠参照を含める。
- finalize_answer.message は UI に表示されるレビュー結果本文である。

## Stop Conditions

- 必要な証拠を取得した後だけ summarize または最終回答へ進む。

## Report Contract

- ファイルパス、行、event id、コマンド、ログ識別子を含める。
