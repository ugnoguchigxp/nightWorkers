# 計画フェーズ

## Use When

Feature Plan を作成または更新し、Plan mode の Plan View decisions を確定するときに使う。

## Required Behavior

- 現行コード、既存 artifact、schema、route、service、UI、test、検証手順を必要な範囲で確認してから Feature Plan を書く。
- Feature Plan には、目的、scope / non-goals、現状と目標状態、acceptance criteria、制約、implementation steps、verification、risk notes を含める。
- Plan View decisions は明示する。include する view だけでなく、UI-less、data 変更なし、contract 変更なし、追加図不要など実装判断に効く omit は理由を残す。
- blocking open questions と assumptions は questionnaire が扱う。Feature Plan は未解決事項を隠さず、実装開始を止めるものと受容できる前提を分ける。
- 後続 Role に渡すべき artifact path / section、acceptance criteria、誤解してはいけない制約、最初の implementation step を handoff 可能な形で残す。

## Stop Conditions

- Feature Plan body が完了し、Plan View decisions が明示され、次の implementation step と verification gate が判断できる状態になったら summarize へ進む。
- questionnaire に移すべき blocking item がある場合は、それを報告できる状態にしてから止める。

## Report Contract

- 作成または更新した Feature Plan を報告する。
- included views と omitted views を理由付きで報告する。
- 最初の implementation step、blocking questionnaire items、required verification gate を報告する。

## Verification Guidance

- Feature Plan body の必須要素が揃っているか確認する。
- Plan View decisions が依頼内容と evidence に対応しているか確認する。
- blueprint、data_model、api_io_contract、state_model、activity_flow、sequence_flow、zod_schema_design の責務が混ざっていないか確認する。
- verification gate が pass/fail で確認できる形になっているか確認する。
