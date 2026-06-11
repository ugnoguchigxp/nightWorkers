# Review Lane Implementation Plan

## 1. 目的
NightWorkers に review 専用レーンを追加する。

この計画でいう review 専用レーンは、ファイル変更、ファイル追加、まとまったタスク完了、またはユーザーの任意依頼をきっかけに、Project Folder 内の evidence を集め、レビュー結果の指摘を生成・保存・表示する仕組みである。

新しい巨大な review engine は作らない。既存の `review-rubrics`、`ReviewEvidencePack`、`ReviewResult`、run events、Workbench 表示を整理し、review という操作を独立したレーンとして扱えるようにする。

## 2. 用語
- 指摘
  - review 結果に含まれる具体的な問題、注意、参考情報。
  - 既存型では `ReviewFinding` に対応する。
- 重大指摘
  - このまま完了扱いにしてはいけない指摘。
  - 既存型では `severity: "blocking"` に対応する。
- 注意指摘
  - 完了扱いを必ず止めるほどではないが、修正または確認した方がよい指摘。
  - 既存型では `severity: "warning"` に対応する。
- 参考指摘
  - 記録しておく価値はあるが、完了判断を止めない指摘。
  - 既存型では `severity: "info"` に対応する。
- 確度低下レビュー
  - evidence 不足、権限不足、外部 folder 参照が必要、LLM reviewer degradation などにより、レビュー結果の確度が落ちた状態。
- 人間確認待ち
  - Project Folder 外の参照、危険な操作、または人間判断が必要で、review lane が自律的に続行しない状態。

## 3. 現状
既存実装には review lane の部品がすでにある。

- `api/services/review-rubrics/`
  - deterministic evaluator、LLM reviewer stub、firewall、merger、built-in rubric がある。
- `api/services/review-rubrics/evidence-pack.ts`
  - run、event、diff、verification、policy、final report から `ReviewEvidencePack` を作る。
- `api/modules/nightworkers/nightworkers.review-files.service.ts`
  - `/runs/:id/reviewer-evaluations` から reviewer evaluation を作れる。
- `api/modules/nightworkers/nightworkers.service.ts`
  - `/runs/:id/reviews` から human review を保存できる。
- `shared/schemas/nightworkers/review.schema.ts`
  - review result、review evidence pack、reviewer evaluation の schema がある。
- `src/modules/nightworkers/components/ThreadTimelineAgentCards.tsx`
  - review event と review result summary の表示がある。

不足している点は次である。

- LLM reviewer が provider に接続されていない。
- ReviewEvidencePack が、具体的な指摘を出すには薄い。
- agent reviewer と human review の入口・表示・状態が review lane として統一されていない。
- 指摘の evidence ref が実在 evidence に解決できるかを確認する層が弱い。
- ユーザーが任意に review を依頼する体験が、専用レーンとして整理されていない。
- Project Folder 内は full access、外部 folder は確認、という review 用権限モデルが明文化されていない。

## 4. スコープ
### In Scope
- review 専用レーンの入口を定義する。
- ファイル変更・追加、まとまったタスク完了、ユーザー任意依頼から review を開始できるようにする。
- Project Folder 配下は review 用 evidence collection の full access として扱う。
- Project Folder 外の参照が必要な場合は、人間確認待ちとして止める。
- ReviewEvidencePack を review 指摘に必要な範囲で拡張する。
- deterministic reviewer と LLM reviewer を同じ review result に統合する。
- LLM reviewer の出力は schema、firewall、evidence ref 検証に通す。
- 指摘の重大度を `重大指摘`、`注意指摘`、`参考指摘` として UI に出す。
- review result を run events / detail response / timeline で追跡できるようにする。
- focused tests と broad verification gate を定義する。

### Out Of Scope
- Goal DB、Goal UI、Goal approval。
- Implementation Queue 連携。
- Night Mode。
- contextStill 専用コード。
- review finding 専用 MCP tool。
- dependency update や TODO marker 由来の自律 discovery。
- Supervisor Round 1 schema の全面的な multi-axis routing 化。
- Project Folder 外への自動 read / search / edit。
- LLM reviewer の判断だけで deterministic な重大指摘を消すこと。

## 5. 設計方針
### 5.1 Review Lane は既存 review-rubrics の拡張にする
review lane は `review-rubrics` を中心にする。

新規の review engine や別テーブル中心の設計にはしない。まずは既存の `ReviewEvidencePack`、`ReviewerEvaluation`、`ReviewResult`、run events を使う。

### 5.2 Review Lane は source of truth を増やしすぎない
review result の source of truth は run event payload と run detail response に置く。

必要になるまで review 専用永続テーブルは追加しない。既存の event replay と detail query で不足が出た場合だけ、後続 PR で専用 read model を検討する。

### 5.3 Review は LLM 中心にしない
レビュー判断の中心は evidence と rubric である。

LLM reviewer は、deterministic checks では拾いにくい観点を補う。LLM が重大指摘を出すことは許すが、evidence ref が存在しない指摘や firewall に引っかかった指摘は、重大指摘として扱わない。

### 5.4 権限不足は指摘ではなくレビュー状態として扱う
Project Folder 外を読む必要がある場合、それは重大指摘ではない。

その場合は review lane を確度低下レビューまたは人間確認待ちにし、ユーザーに外部 folder 参照の確認を求める。Project Folder 内は full access として evidence collection を進める。

### 5.5 UI はレビュー結果の指摘を主語にする
UI は LLM の長文要約ではなく、重大指摘、注意指摘、参考指摘、evidence、確度低下理由を見せる。

既存 timeline summary は残しつつ、review lane の結果を確認しやすい専用 summary を追加する。

## 6. Review Lane の流れ
初期実装の流れは次の通り。

```text
review trigger
  -> identify target run / task / changed files
  -> collect Project Folder evidence
  -> build ReviewEvidencePack
  -> run deterministic rubric evaluation
  -> optionally run LLM reviewer
  -> apply reviewer firewall
  -> verify evidence refs
  -> merge review result
  -> persist review events
  -> show review result in Workbench
```

review trigger は初期では次を扱う。

- run が `needs_review` になった。
- run が `completed` になり、diff または changed files がある。
- ユーザーが run / task に対して review を明示依頼した。

ファイル変更直後の完全自動 review は、既存 runtime の task/run 終了イベントに合わせて実装する。tool call ごとの都度 review は初期には入れない。

## 7. PR 分割
### PR 1: Review Lane Contract And Naming
目的:
- review lane の契約、schema、用語、既存 API の位置づけを揃える。

作業:
- shared / frontend / backend の review 用語を、UI 表示上は `指摘`、`重大指摘`、`注意指摘`、`参考指摘` に寄せる。
- `ReviewFinding` 型名は維持し、表示文言だけを日本語化する。
- review status と reviewer evaluation status の表示規則を整理する。
- `/runs/:id/reviewer-evaluations` と `/runs/:id/reviews` の役割をドキュメント化する。
- review lane の trigger policy を spec に明記する。

検証:
- review schema の型互換性が壊れていない。
- 既存 review-rubrics tests が通る。
- timeline の review result summary が既存 review result を表示できる。
- `pnpm --silent typecheck` が通る。

完了条件:
- 既存 review API を壊さず、review lane としての用語と契約が読める。

### PR 2: Evidence Pack Expansion
目的:
- reviewer が具体的な指摘を出せるように、ReviewEvidencePack の情報量を増やす。

作業:
- changed file の path、diff summary、必要なら短い excerpt を pack に追加する。
- verification event の command、passed、summary を UI / reviewer が使いやすい形に整える。
- policy violation と tool failure の evidence を指摘に紐づけやすくする。
- secrets / token / credential らしき文字列の redaction を維持する。
- pack のサイズ上限と truncation diagnostics を明示する。

検証:
- `tests/services.review-rubrics.test.ts`
- `tests/services.review-rubrics-evaluator.test.ts`
- `tests/services.review-rubrics-firewall.test.ts`
- secret-like text が pack に混ざらない。
- 大きい diff でも pack が壊れず diagnostics を持つ。

完了条件:
- deterministic reviewer と LLM reviewer の両方が、changed files と verification evidence を参照できる。

### PR 3: Evidence Ref Verification
目的:
- LLM reviewer や agent reviewer が存在しない evidence を根拠に重大指摘を出せないようにする。

作業:
- ReviewEvidencePack から参照可能な evidence key set を作る。
- 指摘の `evidenceRefs` が存在するか確認する。
- 不明な evidence ref を持つ指摘は、重大指摘ではなく注意指摘または確度低下理由に落とす。
- filePath / line がある場合、Project Folder 内で解決可能か確認する。
- Project Folder 外の path が必要な場合、人間確認待ちにする。

検証:
- 存在しない event id / artifact id / changed file ref が重大指摘にならない。
- Project Folder 内の filePath は検証できる。
- Project Folder 外の filePath は自動で読まず、人間確認待ちになる。
- firewall tests と reviewer evaluation tests が通る。

完了条件:
- レビュー結果の指摘が、NightWorkers が確認可能な evidence に紐づく。

### PR 4: LLM Reviewer Provider Connection
目的:
- `llm-reviewer.ts` の degraded stub を、既存 provider 経由で実際に呼べるようにする。

作業:
- supervisor provider 側に用途別判断を分散させず、review-rubrics から既存 provider 呼び出しを使う薄い接続にする。
- prompt は日本語を維持する。
- LLM reviewer の JSON 出力を既存 reviewer draft schema に通す。
- parse/schema 失敗時は固定文でレビュー結果を差し替えず、degraded reason と raw failure evidence を残す。
- LLM reviewer は deterministic blocking を上書きできない。

検証:
- provider 未設定時は現在と同じく degraded で落ちる。
- mocked LLM output は firewall 経由で評価される。
- invalid JSON / schema mismatch は failed or degraded review として記録される。
- deterministic blocking があるとき、LLM approved でも final verdict は承認にならない。

完了条件:
- LLM reviewer が optional lane として動き、失敗しても deterministic review を壊さない。

### PR 5: Review Trigger Integration
目的:
- review を task/run の自然な節目とユーザー任意依頼から開始できるようにする。

作業:
- run が `needs_review` になったときに review lane を開始できる入口を整理する。
- run が `completed` かつ diff / changed files がある場合、手動または設定によって review lane を開始できるようにする。
- Workbench から任意 review 依頼を出す action を追加する。
- 初期設定では、tool call ごとの review は行わない。
- review 実行中、既存 run status を不用意に completed / failed へ変更しない。

検証:
- `needs_review` run から reviewer evaluation を作れる。
- `completed` run でも diff があれば review を依頼できる。
- diff がない completed run では、review result が evidence 不足を明示する。
- 任意 review 依頼が run events に残る。

完了条件:
- ユーザーは Workbench から review を明示実行でき、run completion 後の review 導線も壊れない。

### PR 6: Review Result UI
目的:
- review 結果を、指摘中心に確認できる UI にする。

作業:
- timeline の review card に重大指摘、注意指摘、参考指摘の件数を出す。
- review result detail に、指摘、evidence refs、確度低下理由、reviewer status を表示する。
- human review と agent review を区別して表示する。
- LLM の長文を主表示にせず、指摘と evidence を主表示にする。
- Project Folder 外確認が必要な場合は、人間確認待ちとして表示する。

検証:
- review result がない run で UI が壊れない。
- blocking / warning / info の表示が区別できる。
- degraded reason が表示される。
- existing timeline tests と workbench selector tests が通る。

完了条件:
- ユーザーが review 結果の指摘と根拠を Workbench から確認できる。

### PR 7: Review Lane Verification Gate
目的:
- review lane が regressions を起こさないように、テストと verification gate を整える。

作業:
- reviewer evaluation の focused tests を追加する。
- run event replay で review result が復元できることを確認する。
- route tests で create reviewer evaluation と manual review の両方を確認する。
- frontend tests で review result display を確認する。
- `pnpm verify:full` の対象に既存 review tests が含まれることを確認する。

検証:
- `pnpm --silent typecheck`
- review-rubrics tests
- nightworkers route tests
- workbench selector / timeline tests
- `pnpm verify:full`

完了条件:
- review lane の主要経路が focused tests と full verification で守られている。

## 8. 状態と重大度
### 指摘の重大度
- 重大指摘
  - 完了扱いまたは承認扱いを止める。
  - deterministic check または evidence ref 検証済み LLM 指摘のみが該当する。
- 注意指摘
  - 完了扱いは止めないが、修正または確認が望ましい。
  - unsupported evidence ref に降格された LLM 指摘もここに入る。
- 参考指摘
  - 操作を止めない補足。

### Review lane status
- completed
  - review が完了し、結果が保存された。
- degraded
  - review は返せるが、LLM failure、pack truncation、unsupported refs などで確度が落ちた。
- needs_human
  - Project Folder 外の参照や人間判断が必要。
- failed
  - review lane 自体が実行できなかった。

## 9. 権限モデル
Project Folder 配下:
- read / search / diff / test / typecheck の evidence collection は許可する。
- review のための file read と grep は通常操作として扱う。

Project Folder 外:
- 自動で読まない。
- review result には、人間確認待ちの理由として記録する。
- ユーザーが許可した場合だけ外部 path を review context に含める。

review lane は、Project Folder 外を読めないことを重大指摘として扱わない。これはレビュー結果の確度や状態の問題である。

## 10. UI 方針
初期 UI は、既存 Workbench と Timeline の拡張に留める。

追加する表示:
- review 実行ボタンまたは action。
- review result card。
- 指摘一覧。
- evidence refs。
- degraded / needs_human reason。

追加しない表示:
- Goal dashboard。
- Queue 操作。
- Night Mode。
- contextStill knowledge review UI。

## 11. 受け入れ基準
初期実装が完了したと言える条件は次である。

1. ユーザーが Workbench から任意に review を開始できる。
2. `needs_review` run に対して reviewer evaluation を作成・保存できる。
3. `completed` run でも diff / changed files があれば review を依頼できる。
4. ReviewEvidencePack に changed files と verification evidence が含まれる。
5. LLM reviewer は provider 未設定時に degraded として扱われる。
6. LLM reviewer が返す指摘は schema、firewall、evidence ref 検証を通る。
7. 存在しない evidence を根拠にした重大指摘はそのまま採用されない。
8. Project Folder 外が必要な review は人間確認待ちになる。
9. review result が timeline / Workbench で指摘中心に表示される。
10. focused tests と `pnpm verify:full` が通る。

## 12. リスク
### LLM reviewer が固定文で結果を潰す
LLM から本文や JSON が返った場合、schema/parse の成否にかかわらず実装側の固定成功文に差し替えない。失敗は degraded / failed として記録する。

### EvidencePack が大きくなりすぎる
diff excerpt と file excerpt は上限を持つ。truncation は diagnostics に残し、LLM reviewer に黙って完全 evidence であるかのように渡さない。

### UI が LLM 要約中心になる
UI は指摘、重大度、evidence、状態を中心にする。LLM summary は補助に留める。

### Review が Queue や Goal に広がる
今回の計画では Queue と Goal を扱わない。指摘から後続作業を提案する場合も、`suggestedNextTasks` の文字列に留める。

### Review が実行結果を勝手に承認する
agent reviewer は run status を勝手に completed へ変えない。human review の action だけが既存の approve / cancel 操作として status を動かす。

## 13. 実装開始順
最初に着手する順序は次にする。

1. PR 1: Review Lane Contract And Naming
2. PR 2: Evidence Pack Expansion
3. PR 3: Evidence Ref Verification
4. PR 4: LLM Reviewer Provider Connection
5. PR 5: Review Trigger Integration
6. PR 6: Review Result UI
7. PR 7: Review Lane Verification Gate

PR 2 と PR 3 は密接だが、先に pack を拡張し、その後に ref 検証を入れる。PR 4 は evidence と ref 検証が揃ってから入れる。

## 14. 実装前チェックリスト
- [ ] 既存 review-rubrics tests を把握する。
- [ ] `/runs/:id/reviewer-evaluations` と `/runs/:id/reviews` の現行挙動を確認する。
- [ ] ReviewEvidencePack の現在の shape を確認する。
- [ ] Workbench timeline の review 表示を確認する。
- [ ] Project Folder 外 path をどう検出するか決める。
- [ ] LLM provider 接続時に supervisor prompt 責務を増やさないことを確認する。
- [ ] 変更ごとに focused tests を先に通し、最後に `pnpm verify:full` を通す。
