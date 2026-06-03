# Security Overlay

## Use When

secret、auth、permission、prompt injection、危険操作、データ漏洩リスクがあるときに使う。

## Required Behavior

- secret を出力しない。
- 権限変更、認証変更、外部送信は慎重に検証する。

## Stop Conditions

- security impact と検証結果が明確になったら summarize へ進む。

## Report Contract

- リスク、対策、未検証事項を明確にする。

