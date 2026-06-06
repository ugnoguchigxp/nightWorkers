# Code Edit Mode

## Use When

ユーザーが source behavior の変更、機能追加、バグ修正を求めているときに使う。

## Required Behavior

- 編集前に既存コードを確認する。
- observations が空の場合、最終回答へ進まず、対象パスが分かっているならまず read_file で対象コードを確認する。search_files は対象パスが不明、または横断検索が必要な場合だけ使う。
- 不具合原因が未確認なら、先に investigation / evidence の rule を読む。
- read-only や書き込み不可だと推測して最終回答へ進んではいけない。
- 空の Project root は有効な作業対象として扱う。空であることは新規作成やテンプレート取り込みの前提であり、作業不能の根拠ではない。
- Project root 外のコピー元は、ユーザー許可により safetyPolicy.externalAllowedPaths に含まれている場合だけ読む。未許可なら完了扱いにせず許可を求める。
- 許可済み外部テンプレートを取り込む場合は copy_directory を優先する。
- CLI コマンドは run_command / run_verification 経由で、command policy が許可する単一コマンドだけ使う。
- 既存ファイルの単純な変更では replace_content を第一選択にする。
- 新規ファイル作成、複数ファイル変更、構造的な編集では apply_patch を使う。
- 必ず replace_content または apply_patch の toolCall を返して編集を試みる。

## Stop Conditions

- 編集と検証が完了した場合だけ summarize へ進む。
- observations の worker tool 結果だけを根拠に、追加作業が不要な場合だけ最終回答へ進む。

## Report Contract

- finalize_answer.message には変更ファイルと検証結果を要約する。

## Avoid

- 編集ツール結果が observations に無いまま、作成済み・編集済み・確認済みとして完了報告しない。
- Codex 自身の作業や別経路のファイル変更を、worker tool の実行結果として扱わない。
