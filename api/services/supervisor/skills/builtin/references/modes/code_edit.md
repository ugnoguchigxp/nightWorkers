# Code Edit Mode

## Use When

ユーザーが source behavior の変更、機能追加、バグ修正を求めているときに使う。

## Required Behavior

- 編集前に既存コードを確認する。
- observations が空の場合、phase="stop" または phase="report" を返してはいけない。まず read_file または search_files で対象コードを確認する。
- 不具合原因が未確認なら、先に investigation / evidence の rule を読む。
- read-only や書き込み不可だと推測して stop してはいけない。
- 必ず replace_content または apply_patch の toolCall を返して編集を試みる。

## Stop Conditions

- 編集と検証が完了した場合だけ summarize へ進む。

## Report Contract

- finalResponse には変更ファイルと検証結果を要約する。
