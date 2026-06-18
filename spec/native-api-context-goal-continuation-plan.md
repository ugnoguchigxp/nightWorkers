# Native/API Context Goal And Continuation 実装計画

## 1. 目的

native/API レーンで、startup は始まるがその後の実作業が続かない問題と、`context_compile` に渡す GOAL が実タスクから外れる問題を修正する。

この計画で目指す状態:

1. `read_current_specification` の結果を、`context_compile` の入力に実タスクの文脈として反映する。
2. `context_compile` の GOAL から native/API runner 固有の fixed startup flow 文言を排除する。
3. startup gate の Todo ではなく、実作業 Todo またはユーザー依頼を `context_compile` の作業単位にする。
4. startup 後の provider turn が、最新 Todo と最新作業文脈を見て実装・検証へ進める。
5. 弱い tool-choice モデルでも、Todo 継続と finalize gate の関係で止まりにくくする。

## 2. 背景

現在の native/API レーンは、弱いモデル向けに `read_current_specification -> initial_instructions -> context_compile -> Todo alignment` を startup gate として固定実行する方向へ戻している。

出だしは改善しているが、次の問題が残っている。

- `context_compile` の GOAL が常に `NightWorkers native/API runner の fixed startup flow を実装する。` から始まる。
- `context_compile` の GOAL に `Todo #1「initial_instructions を実行する」` が入る。
- 仕様書の title / digest だけが GOAL に入り、仕様本文やユーザー要求が `context_compile` の引数に入らない。
- startup gate が Todo を進めた後も、provider turn に渡された `context.currentTodo` は起動時の stale な Todo のまま。
- startup 後の Todo 継続は provider が `todo_list` を正しく呼ぶことに依存し、弱いモデルでは実装・検証・closeout まで進まない。

## 3. 非目標

- Codex SDK lane の挙動は変更しない。
- Supervisor decision provider に用途別の細かい実行判断を追加しない。
- provider / llm-provider 層に jobType ごとの SystemContext や実行判断を分散させない。
- ユーザー文言を keyword / regex で分類して実行分岐しない。
- `contextStill` 側の API や schema を変更しない。
- startup gate 自体を撤去しない。弱いモデル向けの最低限の強制は維持する。

## 4. 原因整理

### 4.1 GOAL 生成が runner 実装固定になっている

`buildContextCompileArguments(...)` が task 内容ではなく native/API runner の fixed startup flow 実装を固定文として使っている。

修正方針:

- GOAL は runtime 実装ではなく、ユーザー依頼・仕様書・実作業 Todo から生成する。
- `domains` / `technologies` / `changeTypes` も固定値ではなく、仕様書と executionMode から安全に推定する。
- 推定できない場合は広げすぎず、`nightWorkers` / `implementation` など最小の汎用値に留める。

### 4.2 仕様書本文が context_compile 入力に入っていない

startup で仕様書を読んでも、`context_compile` に渡す引数は GOAL と固定 metadata だけになっている。

修正方針:

- `read_current_specification` の payload から title / digest / content preview / sources を抽出する。
- GOAL には本文全体を詰め込まず、仕様書 title とユーザー依頼、実作業 Todo を短く入れる。
- `domains` / `technologies` / `changeTypes` は本文から直接 keyword 判定しすぎない。仕様書の metadata がある場合のみ使い、なければ executionMode 由来の最小値にする。
- contextStill に仕様本文を渡したい場合は、`metadata` のような未定義引数を勝手に追加しない。現行 `context_compile` schema の `goal` / `domains` / `technologies` / `changeTypes` に収める。

### 4.3 startup gate Todo が実作業 Todo として扱われている

runtime 起動時点の current Todo は標準 first gate の `initial_instructions` であり、startup controller が Todo を進めた後も `context.currentTodo` は更新されない。

修正方針:

- `buildContextCompileArguments(...)` は `context.currentTodo` をそのまま使わない。
- startup gate Todo を除外し、DB 上の最新 Todos から次の実作業 Todo を解決する。
- 実作業 Todo がない場合は、ユーザー依頼または仕様書 title を作業単位にする。

### 4.4 startup 後の provider turn が最新 Todo を持っていない

runner は turn ごとに Todo snapshot を history に追加するが、tool call record の `todoSeq` などは起動時の `context.currentTodo` に依存している。

修正方針:

- provider turn 開始前に DB から最新 running Todo を読む。
- `recordToolCallPending` の `todoSeq` には最新 running Todo を使う。
- history の `[Current Native API Runner Todo]` も startup 後の実 Todo に差し替える、または Todo snapshot を primary にする。

### 4.5 後続作業の継続が provider 任せになっている

`finalize_answer` は open Todo があると拒否する一方、Todo を進めるのは provider の `todo_list` 呼び出しに依存している。

修正方針:

- startup 後に実作業 Todo が running であることを runtime 側で保証する。
- tool 実行成功後に Todo 状態を history へ再注入するだけでなく、model-visible result に次の Todo 操作を明示する。
- `finalize_answer` が `OPEN_TODOS_REMAIN` を返す場合、単に拒否するだけでなく、次に必要な `todo_list done/block/fail` の対象 seq を model-visible error に含める。
- 自動で実作業 Todo を done にするのは避ける。実装完了判断は provider が tool evidence と検証結果を見て行う。

## 5. 実装方針

### Phase 1: context_compile GOAL 生成を置き換える

対象:

- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `tests/services.native-api-runner-startup.test.ts`

実装:

1. `buildContextCompileArguments(...)` から fixed startup flow 文言を削除する。
2. 引数に `todos` または解決済み `workTodo` を渡せる形へ変更する。
3. GOAL の構成を次にする。
   - ユーザー依頼の要約
   - 仕様書 title / digest
   - 実作業 Todo の seq / title / taskType
   - executionMode に応じた作業姿勢
4. startup gate Todo は GOAL の作業単位から除外する。
5. テストは `NativeApiRunner Fixed Startup Flow` を期待しない。任意仕様名と任意ユーザー依頼で、GOAL がそれらを反映することを確認する。

検証:

- `Todo List Specification` のような仕様書 title が GOAL に入る。
- `NightWorkers native/API runner の fixed startup flow` が GOAL に入らない。
- `initial_instructions を実行する` が実作業 Todo として GOAL に入らない。

### Phase 2: 仕様書と実作業 Todo の解決を明示する

対象:

- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/todo-runtime/todo-list-builder.ts`
- `tests/services.native-api-runner-startup.test.ts`
- `tests/services.todo-list-builder.test.ts`

実装:

1. startup controller 内で `repo.listTaskRunTodosForRun(runId)` を読み、startup gate 以外の最初の open Todo を解決する。
2. `contextstill.initial_instructions` と `contextstill.context_compile` は startup gate として扱い、GOAL の current work から除外する。
3. 実作業 Todo がない場合は、仕様書 title とユーザー依頼を work target にする。
4. `FIRST_GATES` の description を更新し、`context_compile` は仕様書と実作業 Todo を踏まえることを明記する。

検証:

- startup gate #1/#2 が running/pending でも、GOAL は #3 以降の実作業 Todo を参照する。
- 実作業 Todo が存在しない場合でも GOAL が runner 固定文に戻らない。

### Phase 3: provider turn の Todo 鮮度を直す

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. 各 provider turn の先頭で最新 running Todo を DB から読む helper を追加する。
2. `recordToolCallPending(... todoSeq ...)` に `context.currentTodo?.seq` ではなく最新 running Todo の seq を渡す。
3. history の current Todo 表示も最新 running Todo を優先する。
4. Todo snapshot は維持するが、実作業 Todo が明確に見えるように `[Current Native API Runner Todo]` を更新する。

検証:

- startup 後に Todo #3 が running なら、次の tool call record の `todoSeq` が 3 になる。
- stale な #1 が provider turn の current Todo として残らない。

### Phase 4: OPEN_TODOS_REMAIN の復旧性を上げる

対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. `finalize_answer` が open Todo で拒否される場合、open Todo の seq/title/status/taskType を payload に含める。
2. model-visible content に、次に必要な `todo_list` 操作例を入れる。
3. running Todo がある場合は `todo_list operation=done seq=<running>` を第一候補として提示する。
4. pending Todo だけの場合は `todo_list operation=start seq=<next>` を提示する。
5. block/fail が妥当な場合は provider が選べるよう、`block` / `fail` の用途も短く示す。

検証:

- open Todo がある finalize 失敗 result に seq/title と next action hint が含まれる。
- 既存の open Todo guard は緩めない。

### Phase 5: テストの固定前提を外す

対象:

- `tests/services.native-api-runner-startup.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/services.todo-list-builder.test.ts`
- 必要なら `tests/nightworkers-service/services-nightworkers-02.test.ts`

実装:

1. `NativeApiRunner Fixed Startup Flow` を正とする期待値を削除する。
2. 任意の仕様書 title/content と任意の実作業 Todo で GOAL が正しく生成されるテストを追加する。
3. startup 後に provider turn が最新 Todo で進むことを runner test で確認する。
4. `finalize_answer` の open Todo rejection が復旧ヒントを返すことを確認する。

検証:

- focused tests:
  - `bunx vitest run tests/services.native-api-runner-startup.test.ts`
  - `bunx vitest run tests/services.native-api-runner.test.ts`
  - `bunx vitest run tests/services.todo-list-builder.test.ts`
- related tests:
  - `bunx vitest run tests/services.native-api-runner-closeout.test.ts tests/services.native-api-runner-import-project.test.ts`
  - `bunx vitest run tests/services.agent-runtime-registry.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts`
- typecheck:
  - `bun run typecheck`

## 6. 受け入れ条件

1. `context_compile` の GOAL がユーザー依頼、仕様書、実作業 Todo を反映する。
2. GOAL に native/API runner fixed startup flow の固定文が混入しない。
3. GOAL に startup gate Todo #1/#2 が current work として混入しない。
4. startup 後の tool call record が最新 running Todo に紐づく。
5. open Todo があるため finalize できない場合、provider が次に取る Todo 操作を判断できる model-visible error が返る。
6. startup gate、contextStill gate、open Todo finalize guard は維持される。

## 7. 実装時の注意

- 仕様書本文を GOAL に長文で詰め込みすぎない。GOAL は短く、作業対象を正確にする。
- `context_compile` の schema 外引数を増やさない。
- stale な `context.currentTodo` を便利に流用しない。startup 後は DB の Todo 状態を正とする。
- auto-close / auto-advance の ledger 処理と startup controller の Todo 操作が二重に Todo を進めないよう、テストで順序を固定する。
- 弱いモデル向けの強制は startup と guard に限定し、実装完了判断までは runtime が勝手に代行しない。

