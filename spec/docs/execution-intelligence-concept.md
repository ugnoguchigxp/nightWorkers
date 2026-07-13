# Execution Intelligence Concept

## Status

Discussion draft. Future feature concept only.

この文書は実装計画ではない。NightWorkers に実行履歴が十分に蓄積された将来、統計・機械学習を使って新しい価値を作るためのコンセプト、現在の合意、未決事項を残し、次回以降の議論の起点にする。

現時点では、database、API、UI、学習 pipeline、ContextStill 連携、model training の実装を開始しない。

## 目的

NightWorkers が持つ Questionnaire、Role Routing、LLM usage、Task / Run、Mission Pilot、Test、Review、correction、closeout の履歴を、単なるログではなく、将来の実行をより予測可能で効率的にする `Execution Intelligence` の材料として扱う。

中心とする価値は次の2点である。

1. Questionnaire の選択肢に応じて、想定される token、時間、費用、手戻りを動的に見積もる。
2. タスクの複雑さと最終結果から、プロジェクトごとに品質と効率のバランスが良い Role Routing を提案する。

この2点を最初の具体的な入口とするが、同じ実行結果の蓄積から派生し得る追加候補も、この文書に将来論点として残す。

## 背景

NightWorkers には、予測の入力と結果を結び付けられる既存の構造がある。

- Questionnaire
  - 質問、選択肢、tradeoff、回答、session を持つ。
  - 主な契約は `shared/schemas/design-questionnaire.schema.ts` と `api/db/design-questionnaire-schema.ts` にある。
- Role Routing
  - canonical role、primary、fallback、provider endpoint、model、thinking depth を持つ。
  - 主な契約は `shared/llm-role.ts` と `api/services/structured-llm/role-routing.ts` にある。
- LLM usage
  - task / run、provider、model、role、route source、token、duration を保存する。
  - 主な契約は `api/db/schema-llm-usage.ts` と `api/services/llm-usage/` にある。
- 実行結果
  - Task / Run status、Verification、Review finding / decision、Mission Pilot correction cycle、closeout を持つ。
  - 最終レポート本文だけではなく、永続化された実行事実から結果を評価できる。

一方、現在はこれらを「選択時点の状態・選択可能だった候補・実際の選択・最終結果」という学習単位へ固定する契約はない。また、学習に十分な量・多様性・品質のデータが蓄積したことも確認できていない。

## 中核コンセプト

Execution Intelligence は、過去の事例を検索して提示する機能ではない。

```text
Current state
  + Candidate choices or routes
  + Historical outcomes
  -> Expected cost / quality / risk for each candidate
```

NightWorkers がすでに持つ実行事実から、まだ実行していない選択肢の結果を範囲と信頼度付きで予測し、ユーザーまたは Supervisor の判断材料として提示する。

初期段階では推薦に留める。予測がユーザーの明示設定、one-shot override、既存の必須品質ゲートを黙って上書きしてはならない。

## 現時点の境界判断

### 最初は NightWorkers 内で完結する

最初の学習、集計、評価、推論、UI は NightWorkers 内で完結させる方向を現在の作業仮説とする。

理由:

- Questionnaire と Role Routing は NightWorkers 固有のプロダクト機能である。
- token 合算だけでなく、Plan、Implementation、Test、Review、correction、closeout をどこまで結果に含めるかは NightWorkers の lifecycle semantics である。
- 入力、正解ラベル、推論結果の利用者が、現時点ではすべて NightWorkers 内にある。
- ContextStill を必須にすると、独立アプリ間の同期、schema 互換、privacy、障害時 fallback が先に必要になる。
- 実際に予測を回す前に外部 export 契約を固定すると、必要項目を推測で決めることになる。

したがって、現時点では ContextStill 連携用 JSONL、共有 directory、同期 cursor、外部 training pipeline を作らない。

### ContextStill の既存責務とは分ける

次は ContextStill が現在扱う知識・context 領域として考え、このコンセプトの新規機能には数えない。

- 類似タスク、過去事例、Episode の検索。
- rule、procedure、failure pattern、negative knowledge の取得。
- context 候補の検索、選択、圧縮、評価。
- decision feedback、compile evaluation、knowledge quality 改善。

Execution Intelligence は、検索結果を返すのではなく、候補ごとの将来結果を予測する点を境界とする。

## Feature 1: Questionnaire Dynamic Cost Forecast

### 価値

Questionnaire の選択肢を変えたとき、その選択が実装範囲と後続工程へ与える影響を、その場で確認できるようにする。

表示候補:

- 推定 total token の範囲。
- 現在の回答セットからの増減範囲。
- 推定実行時間、利用料金。
- Test / Review まで含む想定工程。
- correction cycle または手戻り risk。
- 予測 confidence と、confidence が低い理由。
- 主な cost driver。

例:

```text
メール・パスワード認証
  現在の回答セットから +18k〜31k tokens
  推定総量 66k〜91k tokens
  主な増加要因: DB、session、認可テスト
  confidence: medium
```

### 動的であること

選択肢ごとの固定 cost table にはしない。

- 複数の選択肢が同じ実装基盤を共有する場合、単純加算は過大評価になる。
- 2つの選択が組み合わさることで、権限、migration、外部 service、E2E が増える場合、単純加算は過小評価になる。
- project scale、stack、既存 capability、quality requirement、他の Questionnaire 回答によって結果が変わる。

UI では、各選択肢の現在状態に対する限界増分と、回答セット全体の総見積もりを分けて扱う。

### 学習時に必要になり得る入力

- project の規模、stack、既存 capability。
- Questionnaire session と decision snapshot。
- 提示された選択肢と選択された回答。
- blocking decision、依存関係、対象となる artifact / layer。
- 選択時点で利用可能だった情報。
- 後続で利用された role、model、thinking depth。

### 結果候補

- Role別・全体の input / output / total token。
- duration、推定費用。
- Verification の required / failed / unknown。
- Review の blocking / warning。
- correction cycle。
- terminal status と closeout。

Questionnaire cost の正解を単なる LLM token 合計にするか、Test / Review / correction を含む end-to-end cost にするかは未決事項とする。

### UX原則

- 一点の数字ではなく予測区間を表示する。
- 実績が少ない場合は false precision を避ける。
- 低 confidence を隠さない。
- cost が低い選択肢を自動的な推奨にしない。product value と必要要件は cost より上位にある。
- 推定値のために Questionnaire の純粋な仕様選択体験を壊さない。

## Feature 2: Project-aware Role Routing Intelligence

### 価値

タスクの複雑さ、project 特性、過去の token / duration、Test / Review、correction 結果から、Role ごとの provider、model、thinking depth の候補を比較し、品質条件を満たす中で効率の良い Routing を提案する。

対象 role は canonical role を基準にする。

```text
plan
evaluation
implementation
test
review
mission_pilot
mission_task_generation
```

### 最適化目標

「最も token が少ない route」を選ぶ機能にはしない。

概念上の目的は次である。

```text
Minimize expected token / cost / duration
subject to required quality and reliability constraints.
```

比較候補として、少なくとも次のような複数案を提示できる形を検討する。

- 節約。
- バランス。
- 品質優先。

各案には、token / duration / cost だけでなく、Test 一発通過、blocking finding、correction cycle、予測 confidence を併記する。

### プロジェクト別設定

Role Routing は project ごとに最適解が異なる可能性が高いため、グローバル既定値と project 別設定の階層を将来候補とする。

作業仮説:

```text
Global provider endpoints and default Role Routing
  -> Project role policy
     - inherit
     - fixed override
     - optimize
  -> One-shot explicit override
```

provider endpoint、credential、利用可能 model の登録はグローバルに残す。project 側はグローバルに登録された endpoint / model を参照し、Role 単位の方針だけを持つ。

優先順位の作業仮説:

1. ユーザーが送信時に明示した one-shot override。
2. project の固定 override。
3. project で明示的に有効化した optimization recommendation。
4. グローバル Role Routing。
5. 解決された route 内の fallback。

ML recommendation は、明示的な固定 override を黙って上書きしない。

### Project Detail UI

Project Detail に将来 `実行設定` のような設定面を設け、次を確認・変更できる案を残す。

- Role ごとの現在の effective route。
- 適用元が global / project / recommendation / one-shot / fallback のどれか。
- global を継承するか、project 固定にするか、最適化を使うか。
- 現在設定と推薦案の token / quality / risk 比較。
- 推薦を採用または却下した履歴。

表示中の effective route と、実際に送信する override payload は分離する。ユーザーが操作していない表示値を、そのまま強制 override として送らない。

### 学習時に必要になり得る入力

- task / project complexity snapshot。
- project scale、stack、変更 layer、verification requirement。
- Role ごとに利用可能だった route 候補。
- 選択 route、selection source、fallback attempt、manual override。
- provider、model、thinking depth、call count。
- 選択時点の設定 revision と policy。

### 結果候補

- Role別・全体の token、duration、cost。
- provider / transport failure。
- Test pass / failure。
- Review finding。
- correction cycle。
- closeout / archive と、将来扱う場合の reopen / revert。

選択された route だけを保存すると、他候補との比較や selection bias の補正が困難になる。将来学習を始める場合、選択時点で利用可能だった候補を残す必要がある。

## 共通の Learning Boundary

### 学習sampleは最終レポートではない

学習の正解は final report の自己申告から作らない。

優先する実行事実:

- persisted Task / Run status。
- LLM usage record。
- Verification document / evidence / completion result。
- Review session / finding / decision。
- Mission Pilot phase、test snapshot、correction、closeout。
- commit / archive。

### 判断時点と結果時点を分ける

予測入力には、Questionnaire または Routing を選択した時点で利用可能だった情報だけを使う。後から確定した Test / Review 結果が入力へ混入すると、実運用では再現できない予測になる。

概念上、次を分離する。

```text
Decision-time snapshot
  state + candidates + selected action + policy version

Outcome snapshot
  usage + verification + review + correction + closeout
```

### 成功ラベルは単純な completed ではない

`completed` だけで品質を判断しない。予測用途ごとに、次を組み合わせた outcome definition を将来決める。

- required verification。
- blocking finding。
- correction cycle。
- closeout。
- 必要なら一定期間後の reopen / revert。

label definition は model と同様に version 管理できる必要があるが、具体的なschemaはこのConceptでは固定しない。

## 導入成熟度の考え方

具体的な実装phaseや件数thresholdは、このConceptでは確定しない。将来実装を検討する場合は、少なくとも次の成熟順を守る。

### Observation

- 必要な入力と結果がNightWorkers内で結合可能か確認する。
- 欠損、偏り、route選択の偏りを測る。
- 現行の単純な集計・heuristicをbaselineにする。

### Offline Evaluation

- 過去データで予測精度とcalibrationを評価する。
- 時系列またはproject単位のholdoutを使い、同じTaskの情報漏洩を避ける。
- modelがheuristic baselineを上回るか確認する。

### Shadow Mode

- UIやRoutingを変えず、予測だけを保存する。
- 予測区間、confidence、実績との差を確認する。
- 現行routeと推薦routeの比較を蓄積する。

### Recommendation

- 予測が一定の品質を満たした後、ユーザーへ比較候補として提示する。
- 採用・却下・manual overrideを記録する。
- 必須gateや固定設定は維持する。

### Controlled Optimization

- project が明示的に有効化した場合だけ、制約内で推薦routeを選択可能にする。
- 低confidence、model unavailable、設定不整合ではglobal / fixed routeへ戻る。
- 自動化の採否は将来の別判断とする。

## 追加の将来候補

次は、このConceptの中心2機能と同じ実行結果を利用できる将来候補である。採用や優先順位は未決定とし、中心2機能の価値実証を先行させる。

### Adaptive Verification / Review

変更内容と過去の失敗から、必要なunit、E2E、migration、security、Review深度を提案する。既存の必須gateを黙って省略する用途には使わない。

### Mission Pilot Risk Forecast

Plan Review revise、required Test failure、blocking finding、複数correction cycle、closeout未達のriskをphase開始前に予測する。

### Queue Duration And Resource Forecast

Task完了時刻、processor slot占有時間、repository lock待ち、timeout、同時実行競合を予測し、Queue表示や将来の配分判断を補助する。

### Runtime Anomaly And Recovery Recommendation

イベント列と状態遷移から、進捗のないtoken消費、同一処理の反復、heartbeatだけ進むstall、provider劣化、通常と異なるphase遷移を検出し、停止、再試行、別route、人間確認を提案する。

### Defect Hotspot Forecast

module、変更境界、過去のTest failure、Review finding、correction、reopenから、まだ問題が起きていない変更のriskを予測する。

### Cost / Time Budget Forecast

Queue投入前やMission開始前に、Role別・phase別のtoken、時間、費用の範囲を示し、予算超過riskを警告する。

### Improvement Candidate Ranking

Project EvaluationやReviewから生まれた改善候補について、実装後の品質向上、費用、手戻りの実績から優先順位を提案する。

## ContextStillとの将来連携

### 現在の判断

今すぐContextStillへ学習データを送らない。NightWorkersとContextStillは独立した製品であり、お互いのSQLiteへ直接queryしない。ContextStillを中心とした学習基盤も、現時点では作らない。

### 再検討する条件

少なくとも次が成立した後に、連携案を考案し直す。

- NightWorkers内で予測が実際に回っている。
- heuristicまたはmodelの価値がoffline / shadow evaluationで確認されている。
- 学習に本当に必要な中間処理データが実績から判明している。
- 内部learning sampleの意味とlabel definitionが安定している。
- ContextStillで長期保持・横断分析する明確なsecondary useがある。
- NightWorkers以外のproducerまたはconsumerが現れる、あるいは共通Outcome Modelの具体的価値がある。
- privacy、retention、削除、project間利用の方針が決まっている。

### 連携する場合の方向性

連携を再検討する場合、学習済みnetworkだけを渡す案に限定しない。ContextStillで再学習・別目的への再加工が必要なら、NightWorkersで価値が確認された中間処理データ、dataset snapshot、provenanceを候補にする。

ただし、具体的なファイル名、directory、JSONL schema、pull頻度、cursor、model artifact形式は、現在は固定しない。実績がない段階で外部契約を先に作らない。

連携時にも次の境界を維持する。

- NightWorkersは実行事実とproduct semanticsのsource of truth。
- ContextStillはNightWorkersの内部SQLiteを直接読まない。
- 独立製品間の連携は明示的なread-only exportを候補にする。
- NightWorkersがContextStillの利用を必須としない。
- ContextStill停止時もNightWorkersの通常実行と既存設定は継続する。

## Model候補について

このConceptはneural networkの採用を前提にしない。

データ量と問題に応じて、次を比較する可能性がある。

- 集計とheuristic。
- 線形・一般化線形model。
- Gradient Boosted Trees。
- ranking / learning-to-rank。
- calibration model。
- anomaly detection / survival analysis。
- 十分な比較データがある場合のcontextual bandit / offline policy evaluation。

最も複雑なmodelではなく、baselineを安定して上回り、説明とrollbackが可能な最小の方法を選ぶ。

## 評価指標候補

### Questionnaire Forecast

- token / duration / cost のprediction error。
- prediction interval coverage。
- confidence別のcalibration。
- 選択変更時の増減予測と実績の差。
- 見積もり表示が仕様選択を不必要に歪めていないか。

### Role Routing

- 同等以上のqualityにおけるtoken / duration / cost削減。
- required Test一発通過率。
- blocking finding率。
- correction cycle。
- fallback / provider failure率。
- 推薦採用率、却下率、manual override率。
- project別・stack別のcalibration。

modelのaccuracyだけで採否を決めない。NightWorkersの実行品質、ユーザーの判断可能性、運用負荷、予測不能時のfallbackを含めて評価する。

## 非目標

- 今すぐML実装を開始すること。
- 現時点でdatabase schemaやJSONL契約を固定すること。
- ContextStillをNightWorkersの必須依存にすること。
- ContextStillまたはNightWorkersのSQLiteを相互参照すること。
- 生chat、prompt、diff、stdout、source codeを学習目的で無条件に長期保存すること。
- ユーザー文言のregex / keyword分類で複雑度やRoutingを決めること。
- llm-providerへ用途別の実行判断を分散すること。
- cost最小だけを成功とすること。
- 推薦が明示設定やone-shot overrideを黙って上書きすること。
- 低confidenceの予測を確定値として表示すること。

## 将来の議論で決めること

1. Questionnaire costは、どの終端までを含むか。
   - Planのみ。
   - Implementationまで。
   - Test / Review / correction / closeoutを含むend-to-end。
2. 同じTaskで複数cycleがある場合、選択肢とcostをどう帰属させるか。
3. Role Routingのquality constraintを何で定義するか。
4. project別modelにするか、共通modelとproject calibrationにするか。
5. projectごとの`inherit / fixed / optimize`をどの粒度で持つか。
6. route候補のselection biasをどう評価するか。
7. 遅れて判明するreopen / revertをlabelに含めるか。
8. 学習readyを件数ではなく、どのcoverage / diversity / calibration条件で判定するか。
9. prediction unavailable時のUIとfallbackをどうするか。
10. ContextStill連携を再検討する具体的なsecondary useは何か。
11. 中間処理データのprivacy、retention、削除、project間利用をどう制御するか。
12. このConceptから最初のimplementation planへ進むためのGO条件は何か。

## 現在のDecision Log

### 2026-07-13

- 最初の中心featureは、Questionnaire Dynamic Cost ForecastとProject-aware Role Routing Intelligenceの2点とする。
- 初期はNightWorkers内で集計、学習、推論、UIを完結させる方向で再議論する。
- 今すぐ実装しない。
- 今すぐContextStill連携、JSONL export、共有directory、同期pipelineを作らない。
- NightWorkers内で予測が回り、価値と必要データが確認された後、中間処理データをContextStillへ連携する案を考案し直す。
- Adaptive Verification、Mission Pilot risk、Queue予測、Runtime anomaly、Defect hotspot、Cost / Time budget、Improvement rankingは将来候補として残す。
