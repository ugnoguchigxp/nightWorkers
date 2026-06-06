# Design Questionnaire Concept

## 目的
Design Questionnaire は、Blueprint と DB Design の間、またはその後に残る仕様上の未決定事項を、ユーザーが回答しやすいフォームとして提示するための構想である。

Blueprint は画面構成、主要導線、サンプル表示内容、実装タスクの方向性を決める。DB Design は table、column、relation、binding、DDL につながる data contract を詰める。Design Questionnaire は、そのどちらにも直接属さないが、実装前に決めないと後工程で迷いやすい仕様判断を扱う。

この機能の成果物はアンケート回答そのものではない。回答をもとに、設計判断、理由、代替案、未解決事項を整理し、後続の設計文書や implementation plan に接続できる状態を作る。

Design Questionnaire は任意の補助レーンである。すべての Blueprint が必ず Questionnaire を通る必要はない。仕様の未決定事項が少ない場合、またはユーザーがすでに十分な設計判断を持っている場合は、Blueprint から DB Design または implementation planning へ進める。

## 解決したい問題
通常のチャットで仕様を詰めると、次の問題が起きやすい。

- 何が決定済みで、何が未決定かが会話の流れに埋もれる。
- LLM が一問ずつ質問すると、ユーザーの作業負荷が高い。
- 推奨案、代替案、不採用理由が構造化されず、設計文書に転記しにくい。
- Blueprint、DB Design、implementation planning の責務が混ざる。
- 後から「なぜこの仕様になったか」を追いにくい。

Design Questionnaire は、LLM を逐次質問者として使わない。LLM は、未決定事項を抽出し、複数の質問をカテゴリ別フォームに編集し、回答後に設計判断へ変換する役割を持つ。

## 将来の体験
目標とする体験は、次の流れである。

```text
Blueprint artifact
  -> unresolved spec gap extraction
  -> Design Questionnaire form
  -> user answers grouped questions
  -> conditional follow-up form when needed
  -> Decision Review
  -> Design Decisions / Open Questions
  -> implementation plan or design document
```

ユーザーは一問ずつチャットに返答しない。カテゴリごとにまとめられた質問フォームを見て、推奨回答、選択肢、トレードオフを確認しながら回答する。回答によって追加質問が必要な場合でも、即時に一問だけ聞くのではなく、次の質問セットとしてまとめて提示する。

最後に Decision Review を表示する。ここでは回答一覧をそのまま見せるだけでなく、NightWorkers が理解した決定事項、後回し項目、未解決事項を確認できるようにする。ユーザーはこの確認結果を採用、修正、保留できる。

## Blueprint Specification Workspace
ユーザー体験としては、Blueprint を仕様に関するサブ資料の入口として扱う。保存責務は分けたまま、上部の Blueprint ボタンから、その Session / Task に紐づく仕様資料をまとめて見返せるようにする。

この Workspace は、複数の Blueprint artifact と、そこから派生した DB Design、Design Questionnaire、Decision Review、Design Token adoption、implementation planning reference を並べて確認する場所である。Blueprint artifact 自体にすべての情報を埋め込むのではなく、source message ID、session ID、published message ID で関連資料を束ねる。

初期のタブ構成は次を想定する。

- Blueprints: 生成済み Blueprint を複数タブで比較、採用状態と生成日時を確認する。
- DB Design: Blueprint から派生した data contract revision と採用状態を見る。
- Questionnaire: Design Questionnaire の回答中 session、follow-up、Decision Review を見返す。
- Decisions: 採用済み Decision Review から抽出された設計判断と未解決事項を見る。
- Implementation: 後続の implementation plan または queue 候補への参照を見る。

この構成により、Blueprint ボタンは「最新 Blueprint を開くボタン」ではなく、「仕様策定資料のワークスペースを開くボタン」になる。

## 扱う仕様判断
Design Questionnaire が扱うのは、DB schema の具体化ではなく、実装前に明示しておくべき仕様判断である。

初期対象は次の領域を想定する。

- 主要ユーザーフローの分岐
- 権限、ロール、公開範囲
- エラー、空状態、例外ケース
- 通知、履歴、監査、復元
- MVP に含める範囲と後回しにする範囲
- 外部連携や非同期処理の失敗時ポリシー
- UI 上の優先順位、一覧、詳細、編集導線
- セキュリティ、データ保持、運用上の制約
- 実装開始前に決めないと手戻りになりやすい非機能要件

DB table、column、relation、binding、DDL の具体化は DB Design workflow に渡す。Design Questionnaire は、例えば「削除は復元可能にするか」「監査履歴は必要か」「誰が閲覧できるか」までは扱うが、具体的な column 名や index 設計は DB Design の責務にする。

## Blueprint / DB Design との境界
Design Questionnaire は、既存の Blueprint 境界を広げすぎないための補助レーンである。

| 領域 | 責務 | 責務外 |
| --- | --- | --- |
| Blueprint | 画面構成、主要導線、component choice、sample props、implementation task hints | DB table、column、relation、binding、DDL |
| DB Design | App Blueprint の data contract revision | 画面構成やユーザー体験全体の再設計 |
| Design Questionnaire | DB Design 以外の未決定仕様をフォーム化し、回答を設計判断へ変換する | schema 詳細、migration、物理 DB 変更 |
| Implementation Plan | 実装タスク、順序、検証、rollout、rollback を定義する | 仕様の未決定事項を暗黙に決めること |
| Blueprint Specification Workspace | 複数 Blueprint と派生サブ資料をタブで閲覧する | 各 artifact の保存責務を統合すること |

UI 上も別の意図として扱う。Blueprint Preview から DB Design と同じように Design Questionnaire を開始できても、backend intent と保存経路は分ける。

Design Questionnaire の採用状態も、Blueprint artifact の採用状態とは分ける。Questionnaire の回答を採用しても、source Blueprint が採用済みになるわけではない。Decision Review の採用は「この仕様判断の理解を後続計画に使ってよい」という意味に限定する。

## 主要概念
### Design Questionnaire
カテゴリ別にまとめられた質問フォーム。複数質問を一度に提示し、ユーザーがまとめて回答できる。

### Questionnaire Session
ひとつの Blueprint または task から生成された質問票と回答の単位。途中保存、再開、追加質問の生成を扱う。

### Question Set
同時に表示できる質問のまとまり。初期質問セットと、回答に応じて生成される follow-up question set がある。

### Decision Review
回答後に表示する確認画面。回答一覧、採用予定の設計判断、後回し項目、未解決事項を表示する。

### Design Decision
設計文書に反映できる決定単位。回答の raw data ではなく、決定、理由、代替案、トレードオフ、未解決事項を持つ。

### Open Question
実装前に残る未解決事項。隠さず設計文書に残し、implementation plan の前提または blocker として扱えるようにする。

### DB Design Handoff
Questionnaire の回答から DB Design に渡すべき論点。table、column、relation、binding、DDL を直接提案せず、「監査履歴が必要」「復元可能な削除が必要」「公開範囲に応じた access control が必要」のような設計制約として渡す。

### Blueprint Specification Workspace
上部の Blueprint ボタンから開く、仕様サブ資料の集約ビュー。複数 Blueprint、DB Design revision、Questionnaire Session、Decision Review、Design Token adoption、implementation planning reference をタブで見返す。

## 成功条件
- ユーザーがチャットで一問ずつ答えなくても、仕様上の未決定事項をまとめて処理できる。
- 質問には推奨回答とトレードオフがあり、ユーザーが選びやすい。
- 回答結果が Decision Review で確認でき、採用前に修正できる。
- 回答結果が Q&A のままではなく、設計判断として文書化できる。
- Blueprint、DB Design、Design Questionnaire、implementation planning の境界が崩れない。
- 未回答、保留、後回し、未解決が明示され、実装計画に暗黙混入しない。
- Questionnaire を使わない場合でも、既存の Blueprint / DB Design / implementation planning flow がそのまま使える。
- 上部の Blueprint ボタンから、複数 Blueprint と仕様サブ資料をまとめて見返せる。

## 初期リリースで目指す最小価値
最初の実装では、全仕様領域を網羅しようとしない。Blueprint artifact から上位 5 から 10 件の未決定事項を抽出し、カテゴリ別フォームとして提示し、回答後に Decision Review を生成できれば十分な価値がある。

初期リリースで必要な最小価値は次の通り。

- Blueprint を入力に質問セットを生成できる。
- Blueprint ボタンから仕様サブ資料 Workspace を開ける。
- 複数 Blueprint artifact をタブで切り替えて確認できる。
- 質問セットをフォームとして表示できる。
- ユーザー回答を保存、再表示できる。
- 回答に応じた follow-up question set を生成できる。
- Decision Review で決定済み、後回し、未解決を確認できる。
- 設計文書または implementation plan に使える decision draft を生成できる。

## 非目標
- LLM がユーザーに一問ずつ質問し続けるチャット体験。
- Blueprint の root schema に自由な questionnaire key を直接追加すること。
- DB Design workflow の代替。
- migration や物理 database 変更の実行。
- implementation queue への自動投入。
- 回答を無確認で正式な設計文書へ反映すること。

## 残すべき未解決事項
- Blueprint Specification Workspace の初期タブ順と、各タブに表示する採用状態の粒度。
- Questionnaire Session の編集中状態を専用 table に保存し、採用済み Review だけを artifact message として残すか。
- Decision Review の採用状態を、Blueprint / DB Design adoption と同じ粒度で扱うか。
- 回答結果を既存の `markdown_document` message として残すか、構造化 metadata を主にするか。
- 初期カテゴリを固定するか、LLM が blueprint に応じてカテゴリを生成するか。
