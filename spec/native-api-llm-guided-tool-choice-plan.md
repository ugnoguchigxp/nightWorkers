# Native/API LLM-Guided Tool Choice 実装計画

## 1. 目的

`native-api-runner` の startup / plan / closeout に入っている runtime 強制を減らし、MCP / worker tools を LLM が必要と思ったタイミングで選択できる形へ移行する。

ただし、完全に自由放任にはしない。実行品質を保つため、SystemContext、tool description、Todo description、runtime contract warning によってかなり強い誘導を行う。

この計画で目指す状態:

1. runtime は LLM に代わって `initial_instructions` / `context_compile` / `compile_eval` を勝手に実行しない。
2. LLM には必要な MCP / worker tools が model-visible に提供される。
3. 「いつ使うべきか」は SystemContext と tool description で強く誘導する。
4. safety policy、workspace boundary、Todo completion gate、import_project 後の検証 gate など、実害を防ぐ guard は runtime 側に残す。
5. Codex lane と同じく、実行判断は provider turn 内の LLM に寄せる。

## 2. 背景

`13098d2c` 以降の native/API runner は、Codex 型の provider-native tool loop に近づいた。一方で、その後の Plan Mode / fixed startup flow で runtime が先回りして処理を強制する実装が増えた。

代表例:

- `NativeApiStartupController` が provider turn 前に `read_current_specification`、`context-still.initial_instructions`、`context-still.context_compile`、Todo alignment を実行する。
- planning mode では `apply_patch` / `replace_content` / `import_project` / `run_verification` / `todo_list` を tool surface から消す。
- dispatcher が mode によって provider tool call を拒否する。
- closeout 時に `context-still.compile_eval` を runtime gate として自動実行する。
- provider が本文だけを返し tool call しない場合、本文を固定エラーに差し替える。

これらは安定性を狙った変更だが、コーディングエージェントの自律性を落としている。NightWorkers としては「実行判断を LLM に委ねるが、正しい行動を強く促す」構造に戻す。

## 3. 設計原則

### 3.1 強制しない

次の処理を runtime が provider turn 前後で勝手に実行しない。

- `initial_instructions`
- `context_compile`
- `context_decision`
- `compile_eval`
- `register_candidates`
- `read_current_specification`
- Todo replace / start / done

これらは tool として提供し、LLM が選択する。

### 3.2 強く誘導する

強制は避けるが、SystemContext ではかなり明確に推奨する。

例:

- 「この作業で `initial_instructions` が未実行なら、最初の実作業前に呼ぶことを強く推奨する」
- 「実装・修正・調査では、十分な文脈がない場合 `context_compile` を使う」
- 「仕様や計画が source of truth の場合は `read_current_specification` を優先する」
- 「multi-step implementation では早い段階で `todo_list operation=replace` を使う」
- 「closeout では、再利用可能な知識があれば `register_candidates`、context_compile を使った場合は `compile_eval` を検討する」

ただし SystemContext は「必ず失敗扱いにする」とは書かない。強い推奨と、使わない場合に最終報告で根拠を説明する要求に留める。

### 3.3 guard は残す

自律性を戻しても、危険な状態遷移や workspace 破壊は防ぐ。

残す guard:

- repo root 外の読み書き制御
- denied paths / blocked commands
- edit 前 read evidence
- `finalize_answer` 前の open Todo check
- `import_project` 失敗後の fallback 実装禁止
- `import_project` 成功後の manifest / recommended verification guard
- provider-native tool call の durable logging
- cancellation / timeout

外す guard:

- mode 別の model-visible tool 削除
- startup MCP gate 失敗による provider turn 前停止
- planning mode での mutation tool hard deny
- `read_current_specification` 未実行による `context_compile` hard block
- closeout の `compile_eval` 自動実行

### 3.4 runtime lane 境界を守る

この変更は `native-api-runner` の runtime lane 内で行う。Supervisor decision provider や structured-LLM provider 層へ jobType ごとの実行判断を移さない。

llm-provider の責務は次に限定する。

- provider 呼び出し
- native tool call の正規化
- JSON / schema の最小限の互換処理
- usage / provider debug

## 4. 対象ファイル

主対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-closeout-controller.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/todo-runtime/todo-list-builder.ts`
- `api/services/worker-tools/mcp-call-tool.ts`
- `api/services/mcp/mcp-client-manager.ts`

テスト対象:

- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-runner-startup.test.ts`
- `tests/services.native-api-runner-closeout.test.ts`
- `tests/services.native-api-request-adapter.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`
- `tests/services.todo-list-builder.test.ts`

## 5. 目標状態

### 5.1 tool surface

native/API runner は mode によって tool を大きく消さない。

基本 tool surface:

- `read_current_specification`
- `list_dir`
- `read_file`
- `search_files`
- `git_status`
- `git_diff`
- `apply_patch`
- `replace_content`
- `import_project`
- `run_verification`
- `todo_list`
- `list_mcp_tools`
- `mcp_call_tool`
- `context_initial_instructions`
- `context_compile`
- `context_decision`
- `compile_eval`
- `register_candidates`
- `new_context`
- `finalize_answer`

第一段階では contextStill wrappers だけでもよい。

- `context_initial_instructions`
- `context_compile`
- `compile_eval`
- `register_candidates`

`context_decision` はブロッカー処理の設計がやや広いため、第二段階でもよい。

### 5.2 SystemContext

`buildNativeApiSystemPrompt(...)` を runner の中核誘導文にする。

SystemContext は mode を表示するが、mode によって tool を消すのではなく、期待行動を強く説明する。

例:

```text
executionMode: planning

Plan mode guidance:
- 原則として実装・ファイル変更・project import は避ける。
- ただし、ユーザーが実装開始を明示した場合、または計画作成中に実装へ進む合意が明確になった場合は、todo_list で実行方針を更新して implementation work に入ってよい。
- mutation tool を使う場合は、finalReport で理由と根拠を説明する。
```

implementation の例:

```text
Implementation guidance:
- 実装前に十分な文脈がない場合は context_compile を使うことを強く推奨する。
- multi-step work では todo_list operation=replace を早い段階で使うことを強く推奨する。
- 実装 Todo が running になった後は、plan-only answer で停止しない。
- closeout は実装と検証が終わった後だけ行う。
```

closeout の例:

```text
Closeout guidance:
- context_compile を使った場合は compile_eval を検討する。
- 他の文脈でも再利用可能な知識がある場合は register_candidates を検討する。
- 使わない場合は、finalReport で使わなかった理由を短く説明する。
```

### 5.3 tool description

tool description も強い誘導に使う。

例:

- `context_initial_instructions`: `Strongly recommended before substantive work when it has not run in this run.`
- `context_compile`: `Strongly recommended when the task needs repo-specific context, prior decisions, or implementation guidance.`
- `todo_list`: `Strongly recommended for multi-step implementation. Use replace once near the start.`
- `compile_eval`: `Recommended during closeout when context_compile was used.`
- `register_candidates`: `Recommended during closeout when reusable project-independent lessons were learned.`

重要なのは description に「must succeed before continuing」と書かないこと。失敗時も LLM は別の根拠で継続判断できる。

### 5.4 Todo

標準 Todo は完全に消さない。ただし startup gates を runtime が自動実行するための Todo ではなく、LLM への行動誘導として扱う。

候補:

1. 初期 Todo に `initial_instructions` / `context_compile` を残すが、runner は自動実行しない。
2. 初期 Todo から first gates を外し、SystemContext で強く誘導する。

推奨は 1。

理由:

- UI 上で「やるべきこと」が見える。
- `ledger-sink` の tool 成功による auto-close を活かせる。
- LLM が自分で tool を選ぶ構造にできる。

ただし、Todo があるからといって runtime が provider turn 前に実行してはいけない。

### 5.5 planning / implementation handoff

planning run から implementation へ進む場合は、最後の user message ではなく implementation plan artifact 本文を runtime input に含める。

望ましい入力:

- latest user request
- selected implementation plan / draft spec artifact
- run_started metadata
- current executionMode
- handoff reason

`IMPLEMENTATION_PHASE_PREAMBLE` は残してよいが、内容を強制調にしすぎない。

変更候補:

```text
実装フェーズに移行しました。
直近の Implementation Plan / Draft Spec を主な作業入力として扱ってください。
計画に不足や矛盾がある場合は、必要な確認・調査 tool を使ってから実装してください。
```

## 6. 実装ステップ

### Step 1: SystemContext を強化する

対象:

- `native-api-tool-history.ts`

内容:

- `buildNativeApiSystemPrompt(...)` に mode 別 guidance を追加する。
- startup / closeout / planning の「強い推奨」をここへ集約する。
- provider が tool を選ぶ前提を明記する。
- `Plan mode では実装 tool を呼べない` という趣旨の文言を削る。

検証:

- system prompt に tool 選択 guidance が含まれる。
- planning mode でも hard deny を示す文言がない。

### Step 2: MCP tool bridge を model-visible にする

対象:

- `native-api-tool-registry.ts`
- `native-api-tool-dispatcher.ts`
- `mcp-client-manager.ts`
- `mcp-call-tool.ts`

内容:

- `list_mcp_tools` を追加し、有効 MCP tool の `serverId/name/namespacedName/description/inputSchema` を返す。
- `mcp_call_tool` を native/API model-visible tool に追加する。
- contextStill wrapper tools を追加する。
- wrapper は内部で `mcp_call_tool` を使う。

wrapper 候補:

```ts
context_initial_instructions(args: {})
context_compile(args: { goal: string; domains?: string[]; technologies?: string[]; changeTypes?: string[] })
compile_eval(args: { title?: string; outcome?: string; body: string; relevance?: number; coverage?: number; specificity?: number; actionability?: number; clarity?: number })
register_candidates(args: { items: Array<...> })
```

検証:

- `getNativeApiToolDefinitions()` に MCP wrapper tools が含まれる。
- LLM が呼んだ時だけ MCP が実行される。
- MCP unavailable は tool result として返り、runner 自体は即失敗しない。

### Step 3: startup runtime gate を opt-in 化または削除する

対象:

- `native-api-runner.ts`
- `native-api-startup-controller.ts`
- `services.native-api-runner-startup.test.ts`

内容:

- デフォルトでは `startupController.runStartup(...)` を呼ばない。
- 互換用に `runtimeOptions.forceStartupGates === true` の時だけ呼ぶ案は許容する。
- ただし通常 path は provider turn 1 から始める。
- startup controller は残す場合でも legacy / opt-in 扱いにする。

推奨:

- 第一段階では opt-in にしてテストと UI 影響を抑える。
- 第二段階で不要なら削除する。

検証:

- run 開始直後に runtime-owned `context-still.initial_instructions` / `context-still.context_compile` が発生しない。
- provider が wrapper tool を呼んだ場合だけ tool event が残る。

### Step 4: mode 別 allowlist を撤廃する

対象:

- `native-api-tool-registry.ts`
- `native-api-tool-dispatcher.ts`
- `services.native-api-runner.test.ts`

内容:

- `nativeApiToolNamesByMode` を削除または advisory metadata に変える。
- `isNativeApiToolAllowedForMode(...)` による hard reject を削除する。
- planning / review / runtime_debug でも同じ tool surface を渡す。
- mutation 実行可否は safety policy と SystemContext に寄せる。

検証:

- planning mode でも `apply_patch` / `todo_list` / `run_verification` が visible。
- planning mode で mutation tool call が dispatcher に拒否されない。
- denied path などの safety policy は引き続き拒否される。

### Step 5: context_compile の仕様書 hard dependency を外す

対象:

- `native-api-tool-dispatcher.ts`

内容:

- `context_compile is blocked until read_current_specification has succeeded` を削除する。
- `read_current_specification` が未実行なら tool result warning または SystemContext の推奨に留める。
- `goal` 必須は維持する。

検証:

- `context_compile` は仕様書未読でも実行できる。
- 空 goal は引き続き拒否される。

### Step 6: closeout compile_eval 自動実行を任意化する

対象:

- `native-api-runner.ts`
- `native-api-closeout-controller.ts`
- `services.native-api-runner-closeout.test.ts`

内容:

- `dispatch.kind === 'final'` 時に runtime が `compile_eval` を自動実行しない。
- `compile_eval` wrapper tool 成功時に `compileEvalCompleted` を state に記録する。
- finalReport には `compile_eval` 未実行なら warning を載せる案もあるが、run failure にはしない。

検証:

- finalize 時に runtime-owned `context-still.compile_eval` が発生しない。
- LLM が `compile_eval` を呼べば通常 tool call として記録される。

### Step 7: provider 本文のみ応答を固定エラーにしない

対象:

- `native-api-runner.ts`

内容:

- `providerResult.toolCalls.length === 0` の場合、content が空でなければ assistant final text として扱う。
- ただし open Todo が残る場合は `needs_human` または finalize guidance を返す。
- content が空で tool call もない場合だけ `missing_tool_call` とする。

検証:

- general answer / planning answer が tool call なしでも保存される。
- implementation Todo が open の場合は completed にならない。

### Step 8: implementation handoff 入力を修正する

対象:

- `nightworkers.run-orchestration.service.ts`
- `nightworkers.workbench.service.ts`
- `services-nightworkers-02.test.ts`

内容:

- implementation handoff message を検出した場合、artifact 本文を runtime input に含める。
- `compiledPromptText` を最後の user message だけにしない。
- `latestUserMessage` は user request + selected plan artifact + handoff context を組み合わせる。

検証:

- 「計画してください」だけが implementation runtime に渡らない。
- implementation plan の本文が runtime prompt に入る。

## 7. テスト計画

### Unit

- `getNativeApiToolDefinitions()` が mode によらず主要 tool を返す。
- `dispatchNativeApiToolCall()` が planning mode で mutation tool を mode 理由では拒否しない。
- `context_compile` が specification 未読でも実行される。
- `mcp_call_tool` / contextStill wrapper が MCP unavailable を tool result として返す。
- `finalize_answer` が open Todo gate を維持する。
- tool call なし本文応答が固定エラーに置換されない。

### Service

- `startTaskRun()` 後に runtime gate tool calls が自動発生しない。
- LLM mock が `context_initial_instructions` / `context_compile` を呼んだ時だけ event が作成される。
- planning run でも implementation tool が visible。
- implementation handoff で plan artifact が runtime input に含まれる。

### Regression

- `import_project` 失敗後の fallback 禁止は維持される。
- `import_project` 成功後の recommended verification guard は維持される。
- denied path / blocked command は維持される。
- open Todo がある completed run は `needs_human` に落ちる。

## 8. 非目標

- Codex SDK lane の prompt / MCP contract を変更しない。
- 旧 native Supervisor loop を戻さない。
- llm-provider に jobType ごとの SystemContext を分散させない。
- contextStill 専用 client / repository / schema / fallback を NightWorkers 側に新設しない。
- MCP を必須 dependency にしない。
- Plan Mode UI の見た目刷新はしない。
- tool activity card の大規模 redesign はしない。

## 9. リスクと対策

### 9.1 LLM が推奨 tool を呼ばない

対策:

- SystemContext と tool description を強くする。
- finalReport に「使わなかった理由」を求める。
- runtime warning として可視化する。
- ただし run failure にはしない。

### 9.2 planning で mutation tool を使う

対策:

- planning guidance で原則避けるよう明記する。
- mutation tool 使用時は理由説明を要求する。
- safety policy は維持する。
- 必要なら `runtime_warning` を出すが、hard deny にはしない。

### 9.3 closeout 品質が落ちる

対策:

- closeout guidance で `compile_eval` / `register_candidates` を強く推奨する。
- open Todo gate は維持する。
- knowledge capture Todo の auto-close は tool 成功時に維持する。

### 9.4 MCP unavailable で混乱する

対策:

- `list_mcp_tools` で利用可能性を確認できるようにする。
- wrapper tool は unavailable を明確な tool result にする。
- unavailable は原則 run failure にしない。

## 10. 移行順序

推奨順:

1. SystemContext / tool description を強化する。
2. MCP wrapper tools を model-visible にする。
3. startup runtime gate を opt-in 化する。
4. mode allowlist を撤廃する。
5. `context_compile` の仕様書 hard dependency を外す。
6. closeout compile_eval 自動実行を任意化する。
7. tool call なし本文応答を保存できるようにする。
8. implementation handoff 入力を artifact 本文中心に直す。

この順序なら、まず LLM が選べる tool surface を作り、その後で強制 gate を外せる。tool surface がない状態で gate だけ外すと、品質低下が大きくなるため避ける。

## 11. 完了条件

- native/API runner が通常 path で startup MCP gate を自動実行しない。
- contextStill / MCP は model-visible tool として提供される。
- SystemContext に強い誘導が入っている。
- planning mode でも tool surface が狭められない。
- 実害を防ぐ guard は残っている。
- implementation handoff では plan artifact 本文が runtime input に入る。
- 関連 unit / service tests が更新され、既存の import / Todo / safety guard が維持されている。
