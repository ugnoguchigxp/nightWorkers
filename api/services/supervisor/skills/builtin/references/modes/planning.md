# 計画モード

## Use When

実装前に Feature Plan を作成または更新し、必要な dedicated design view を選ぶときに使う。

## Required Behavior

- Plan mode の主 artifact は常に Feature Plan とする。Feature Plan は、実装者が次の作業へ進める判断材料を一つに集約する。
- Feature Plan body には、目的、scope / non-goals、現状と目標状態、acceptance criteria、制約、implementation steps、verification、risk notes を含める。
- dedicated design view は固定テンプレートとして全部作らず、今回の依頼に必要なものだけ選ぶ。不要な view は、実装判断に意味がある場合だけ omit reason を残す。
- verification は Feature Plan body に残す。検証だけを別 artifact に逃がさない。
- questionnaire は blocking open questions と assumptions を扱う。Feature Plan body に open question section を必須化しない。
- blueprint は UI specification と related design view hub を扱う。UI のない task では必須にしない。
- data_model は DB、data structure、DDL の正本を扱う。blueprint に DDL や table/column の正本を持たせない。
- api_io_contract、state_model、activity_flow、sequence_flow、zod_schema_design は必要な場合だけ選ぶ。zod_schema_design は validation、JSON、tool input contract の設計に使う。
- ユースケース図は dedicated design view として選ばない。
- AI coding rules は Feature Plan の一部にしない。
- ユーザー文言の keyword list や正規表現分類ではなく、依頼内容、既存 artifact、runtime evidence、routing hypothesis から必要な view を判断する。

## Stop Conditions

- Feature Plan body が実装に渡せる粒度で揃い、included views と omitted views の判断理由が明示されたら summarize へ進む。
- 実装判断を止める質問が残る場合は questionnaire に分離し、Feature Plan には前提と影響範囲だけを残す。

## Report Contract

- 作成または更新した Feature Plan を報告する。
- include した dedicated view と理由、omit した dedicated view と理由を短く報告する。
- 最初に着手すべき implementation step、blocking questionnaire items、必要な verification gate を報告する。

## Verification Guidance

- Feature Plan body に goal、scope / non-goals、current / desired behavior、acceptance criteria、constraints、implementation steps、verification、risk notes があるか確認する。
- dedicated view decisions が依頼内容に対応しており、不要な view を固定テンプレートで追加していないか確認する。
- UI 仕様は blueprint、DB / data structure は data_model、API contract は api_io_contract、validation / JSON / tool input contract は zod_schema_design に分離されているか確認する。
- ユースケース図や AI coding rules を artifact として選んでいないか確認する。

## Risk Notes

- Feature Plan が大きくなりすぎる場合でも、artifact を旧来の一律セットへ戻さない。必要な dedicated view を選び、Feature Plan は実装判断に必要な本文へ絞る。
- 旧 artifact 名や generator の都合を理由に、Feature Plan の主導線を崩さない。
