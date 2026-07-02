# Verify Phase

## Use When

変更後の検証、テスト、ビルド、受け入れ条件確認を行うときに使う。

## Required Behavior

- package.json に verify script がある場合は、完了報告前の代表検証として verify command を最優先で実行する。
- typecheck / lint / test / build の個別実行は、修正途中の focused check、または verify script が存在しない・実行不能な場合の fallback とする。
- 調査中は対象テスト、対象 file、reporter、grep などで出力を絞った focused verification を使ってよい。ただし完了前の代表検証は必要な verify command を省略しない。
- `run_verification` の stdout/stderr は既定で compact される。圧縮後も失敗テスト名、assertion diff / error line、exit code、summary を evidence として読む。全文が必要な場合だけ `compressionMode=off` を使う。
- verify を実行しなかった場合は、理由と代替検証を証拠として残す。
- 検証できない場合は、できなかった理由を証拠として残す。
- command result、検証範囲、未検証リスクを、次 Role の working context に渡せる短い証拠として残す。

## Stop Conditions

- 検証結果が得られたら summarize へ進む。

## Report Contract

- 実行した検証コマンドと結果を finalize_answer.message に含める。
