# Code Edit Mode

## Use When

ユーザーが source behavior の変更、機能追加、バグ修正を求めているときに使う。

## Required Behavior

- 編集前に既存コードを確認する。
- observations が空の場合、phase="stop" または phase="report" を返してはいけない。まず read_file または search_files で対象コードを確認する。
- 不具合原因が未確認なら、先に investigation / evidence の rule を読む。
- read-only や書き込み不可だと推測して stop してはいけない。
- 既存ファイルの単純な変更では replace_content を第一選択にする。
- 新規ファイル作成、複数ファイル変更、構造的な編集では apply_patch を使う。
- 必ず replace_content または apply_patch の toolCall を返して編集を試みる。

## Stop Conditions

- 編集と検証が完了した場合だけ summarize へ進む。
- observations の worker tool 結果だけを根拠に、追加作業が不要な場合だけ phase="stop" に進む。
- phase="stop" を返す場合は terminalState を必ず指定する。完了なら terminalState="completed" を返す。
- phase="stop" 以外では terminalState を返さない。

## Report Contract

- finalResponse には変更ファイルと検証結果を要約する。

## Avoid

- phase="stop" で terminalState を省略しない。
- 編集ツール結果が observations に無いまま、作成済み・編集済み・確認済みとして完了報告しない。
- Codex 自身の作業や別経路のファイル変更を、worker tool の実行結果として扱わない。
