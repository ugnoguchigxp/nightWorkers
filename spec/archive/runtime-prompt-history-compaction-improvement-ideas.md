# Runtime Prompt History Compaction Improvement Ideas

## Purpose

BBS 実装 task の LLM usage をもとに、NightWorkers runtime の token 効率を改善できそうな領域を整理する。

この文書は実装計画ではなく、レビュー用の改善案メモである。実装前に、どの改善を優先するか、どこまで LLM-visible payload を圧縮してよいかを合意するために使う。

## Observation From BBS Task

BBS task の usage は total 約 8.47M tokens だった。

内訳:

- calls: 8
- input: 8,422,135 tokens
- output: 46,542 tokens
- cached input: 8,019,968 tokens
- reasoning output: 10,907 tokens
- input 比率: 99.45%
- cached / input 比率: 95.22%

支配要因:

- `codex-runtime` 1 call が 8,146,849 tokens で全体の 96.2%
- 事前の questionnaire / blueprint / data model / specification 生成 7 call 合計は 321,828 tokens

つまり、消費の主因は「出力が長い」ことではなく、Codex runtime に載る入力履歴が大きくなったことにある。

## Likely Large Contributors

activity payload から見えた主な肥大化要因:

- `command_execution`: 54件、payload 約1.16MB
- file read 系 command: 32件、payload 約632KB
- `nightworkers.import_project`: 1件、payload 約384KB
- `nightworkers.todo_list`: 6件、payload 約332KB
- `nightworkers.read_current_specification`: 1件、payload 約136KB
- final `file.diff`: 17ファイル、payload 約128KB

検証失敗ログ:

- `bun run verify`: 6回、5回 failed、payload 約198KB
- `bun run test`: 3回、全て failed、payload 約103KB
- targeted BBS test: 6回、4回 failed、payload 約57KB
- `bun run typecheck`: 2回、1回 failed、payload 約37KB

## Core Hypothesis

NightWorkers runtime は、実装に必要な証跡を正しく収集している一方で、LLM に再投入する履歴としては情報量が過剰になっている。

特に、以下の情報は DB / artifact / timeline には残すべきだが、毎回 LLM-visible prompt に全文で残す必要は薄い。

- 長い command output
- 長い test / coverage report
- starter import の full result
- full specification
- todo_list mutation の full result
- full diff

改善の方向性は、証跡保存と LLM-visible context を分離すること。

## Improvement Ideas

### 1. Tool Result の LLM-visible 圧縮

最も効果が大きそうな領域。

現状では `sed`, `nl`, `cat`, `bun run verify`, `bun run test` などの結果が大きいまま履歴に残りやすい。

改善案:

- full output は DB / artifact に保存する。
- LLM-visible payload は command, exit code, status, summary, relevant excerpt, artifact ref に圧縮する。
- file read 系は先頭から数百行をそのまま返すのではなく、必要範囲だけを返す。
- `sed` / `nl` / `cat` の結果は最大文字数を設ける。
- 長い stdout / stderr は truncation reason と full-output ref を返す。

レビュー観点:

- LLM が修正に必要なエラー行や対象コードを失わないか。
- full output への再取得手段が十分か。
- timeline の可読性と証跡性を落とさないか。

### 2. Verify / Test 失敗ログの差分化

同一 task 内で verify/test が複数回失敗すると、類似ログが履歴に積み上がる。

改善案:

- 同一 command の失敗ログは latest 1件だけを LLM-visible にする。
- 連続失敗時は previous failure との差分だけ返す。
- coverage report は full table ではなく failed gate と不足 metric だけ返す。
- test failure は failed test names, assertion diff, stack top, command, exit code に絞る。
- 成功した verify は短い pass summary だけ返す。

レビュー観点:

- 失敗原因の調査に必要な情報が削られすぎないか。
- coverage / build / lint / typecheck で必要な要約形式が違うため、command class ごとの設計が必要か。
- full report が必要な場合の escape hatch をどうするか。

### 3. `import_project` Result の Summary 化

BBS task では `nightworkers.import_project` の payload が約384KBあった。

starter import 後に LLM が必要とするのは、多くの場合 full result ではなく、manifest, generated files summary, recommended verification commands, postImport notes である。

改善案:

- `import_project` の default LLM-visible response を compact summary にする。
- full import result は artifact に保存する。
- `postImport.llmContext` が大きい場合は、digest + selected highlights にする。
- import 後に同じ情報を再度 `package.json` / README / LLM_CONTEXT から読み直さないよう、response summary に必要情報を含める。

レビュー観点:

- starter variant 選択や初期化結果の診断に必要な情報が残るか。
- import failure 時は full error をどこまで LLM-visible にするべきか。
- `postImport` 情報の schema を compact view と full view に分けるべきか。

### 4. `read_current_specification` の Section View 化

BBS task では specification 読み込み payload が約136KBだった。

実装には仕様が重要だが、すべての turn で全文が必要とは限らない。

改善案:

- default は compact view を返す。
- compact view は goal, scope, acceptance criteria, routes, data model, migration, verification を中心にする。
- full spec は明示 request のときだけ返す。
- `view=implementation`, `view=migration`, `view=ui`, `view=verification`, `view=full` のような section selector を追加する。
- task type / Todo type に応じて default view を切り替える。

レビュー観点:

- 仕様に基づく実装判断が弱くならないか。
- section 抽出が誤ると仕様漏れが起きないか。
- full spec を読むべきタイミングをどう決めるか。

### 5. `todo_list` Mutation Result の Compact 化

BBS task では `todo_list` 6件で payload 約332KBだった。

進捗管理は重要だが、mutation のたびに full Todo context を返す必要は薄い。

改善案:

- `start` / `done` / `block` / `fail` の result は changed todo, next todo, open count, terminal count だけ返す。
- full list は `operation=list` 専用にする。
- Todo context は必要時に ref で読む。
- done evidence は短い summary にする。
- repeated mutation では前回からの差分だけ返す。

レビュー観点:

- TodoList pane の表示に必要なデータと LLM-visible response を分離できるか。
- LLM が次に何をすべきか判断する情報が不足しないか。
- Todo context を ref 化した場合、必要時の取得導線が明確か。

### 6. `file.diff` の Prompt-visible 抑制

final diff はレビューや closeout に必要だが、毎回 full diff を prompt に残す必要は薄い。

改善案:

- LLM-visible には changed files, insert/delete counts, risk labels, hunk summary を返す。
- full diff は artifact に保存する。
- review 時だけ対象ファイルごとの compact diff を読む。
- generated / lock / large file は summary のみにする。

レビュー観点:

- LLM review の品質が下がらないか。
- full diff が必要なときの再取得が簡単か。
- closeout report に必要な変更概要を失わないか。

### 7. Cached Input を KPI 上で分離する

BBS task は cached input 比率が高かった。provider cache が効いていても、token usage 指標としては巨大に見える。

改善案:

- Project Detail / Overview で `input`, `cached input`, `non-cached input`, `output` を分ける。
- token 効率改善 KPI は `nonCachedInput` と `totalInputHistorySize` を別に見る。
- runtime turn ごとの履歴増加量を保存する。
- cached input を「安いから無視」ではなく、prompt 設計改善の対象として扱う。

レビュー観点:

- コスト最適化と prompt 効率最適化を混同しない表示になっているか。
- cached input が多い task をどう評価するか。
- non-cached input だけを見て履歴肥大を見落とさないか。

## Suggested Priority

優先順位は以下。

1. Tool result の LLM-visible 圧縮
2. Verify / test 失敗ログの差分化
3. `todo_list` mutation result の compact 化
4. `import_project` result の summary 化
5. `read_current_specification` の section view 化
6. `file.diff` の prompt-visible 抑制
7. cached input / non-cached input KPI 分離

理由:

- BBS task の最大 payload は command/tool result 由来。
- verify/test の反復は実装タスクで頻出し、失敗時ほど肥大化する。
- Todo / import / spec は NightWorkers 固有の MCP response なので、比較的制御しやすい。
- diff と KPI は重要だが、まず runtime 中の入力肥大を抑える方が直接効果が大きい。

## Proposed Next Planning Step

Implementation plan:

- `spec/docs/runtime-model-visible-payload-boundary-implementation-plan.md`

この改善案をレビューした後、次の実装計画を作るなら、最初の計画は以下に絞る。

Title:

```text
Runtime Tool Result Compaction Implementation Plan
```

Scope:

- command_execution result compaction
- verify/test failure summary
- full output artifact ref
- LLM-visible payload size cap
- tests for failure output preservation

Out of scope for first implementation plan:

- specification section view
- import_project schema redesign
- TodoList response redesign
- diff artifact redesign
- KPI redesign

この順に分けると、最初の実装で一番大きい payload source に集中できる。

## Open Questions

- LLM-visible payload の default 上限を何文字にするか。
- command class ごとに上限を変えるか。
- full output artifact を既存 activity artifact に保存するか、新しい artifact kind を作るか。
- user-facing timeline には full output と compact output のどちらを表示するか。
- LLM が full output を必要としたとき、どの tool で再取得させるか。
- compaction を Settings で ON/OFF 可能にするか、常時有効にするか。
