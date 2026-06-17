# NativeApiRunner Fixed Startup Flow 実装計画

## 1. 目的

`native-api-runner` の実装開始前フローを、provider の自律判断に任せず runtime 側で半固定化する。

固定したい順序:

1. 実装計画・仕様を読み込む
2. `context-still.initial_instructions` を実行する
3. `context-still.context_compile` を実行する
4. Todo を更新・開始状態に同期する
5. 実装 turn を開始する

この順序は prompt 指示ではなく `NativeApiRunner` の state machine と tool lifecycle で保証する。

## 2. 背景

現行の `native-api-runner` は provider-native tool calling の loop を持つが、起動直後の gate を provider に選ばせている。

そのため次の退行が起きやすい。

- `context_compile` を空 `{}` で呼ぶ。
- 仕様書を読む前に contextStill を呼ぶ。
- `initial_instructions` Todo があるのに runner が実行しない。
- Todo 更新前に実装や review に進む。
- fixed gate Todo の auto-close と runner state がずれる。

旧 `native-supervisor` には `initial_instructions` を runtime gate として実行する実装があった。これをそのまま戻すのではなく、`native-api-runner` の DB-backed turn/tool state に合わせて再設計する。

## 3. 非目標

- Codex SDK lane を変更しない。
- `NativeAgentRuntime` に旧 Supervisor loop を戻さない。
- `native-tool-runtime` を復活させない。
- `todo_list list` を model-visible tool に戻さない。
- `context_compile` の空呼び出しを prompt だけで抑止しない。

## 4. 目標状態

### 4.1 startup phase

`NativeApiRunner.run(...)` は provider turn を始める前に startup phase を実行する。

startup phase は次の gate を順に処理する。

1. `read_current_specification`
2. `context-still.initial_instructions`
3. `context-still.context_compile`
4. Todo alignment

各 gate は `native_api_tool_calls` に durable record として保存する。

### 4.2 implementation phase

startup phase が成功した後だけ provider-native tool turn に入る。

implementation phase では現行の provider tool loop を使う。ただし startup phase の結果を canonical history に入れる。

provider が startup gate を重複して呼んだ場合は、成功済みの gate を再実行せず、既に完了済みであることを tool result として返す。

## 5. 新しい runner state

追加候補:

```ts
type NativeApiPhase =
  | 'startup_specification'
  | 'startup_initial_instructions'
  | 'startup_context_compile'
  | 'startup_todo_alignment'
  | 'implementation'
  | 'closeout';

type NativeApiDispatchState = {
  readFiles: string[];
  specificationRead: boolean;
  initialInstructionsCompleted: boolean;
  contextCompiled: boolean;
  todoAligned: boolean;
  startupCompleted: boolean;
  postImport?: NativeApiPostImportState | null;
};
```

`NativeApiSessionStore` に phase を保存する方法は2案ある。

- A: `native_api_turns` に `phase` column を追加する。
- B: `native_api_tool_calls.source` と `arguments_json.phase` で表現する。

初期実装は B でよい。将来 resume を強くする時点で `phase` column を検討する。

## 6. startup gate 実装

### 6.1 `NativeApiStartupController`

新規ファイル候補:

```text
api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts
```

責務:

- startup phase の次 gate を決める。
- runtime-owned tool call を作る。
- `NativeApiSessionStore` に pending/running/completed/failed を記録する。
- `AgentRuntimeSink` に `tool_call_started` / `tool_call_finished` を emit する。
- gate 成功時に `NativeApiHistoryItem` を返す。

provider-native tool call と区別するため、tool call source は `runtime_gate` にする。

### 6.2 仕様読み込み gate

実行 tool:

- worker tool `read_current_specification`

成功条件:

- worker result `ok === true`
- `payload.found === true`
- `payload.content` が空でない

失敗時:

- `needs_human`
- `stoppedBy: 'tool_failure'`
- final report に draft spec が見つからないことを書く

履歴への投影:

```text
[Startup Specification]
title=...
digest=...
content excerpt or compressed summary
```

content 全文を毎 turn に入れるかは token budget 次第。初期は digest + 先頭数千文字 + payload reference でよい。

### 6.3 `initial_instructions` gate

実行 tool:

- worker tool `mcp_call_tool`
- server: contextStill
- MCP tool: `initial_instructions`
- arguments: `{}`

成功 event payload:

```ts
{
  toolName: 'context-still.initial_instructions',
  mcpTool: 'initial_instructions',
  mcpServer,
  serverId,
  status: 'completed',
  ok: true,
  result
}
```

この payload により既存 `ledger-sink` の auto-close が `contextstill.initial_instructions` Todo を完了できる。

失敗時:

- provider turn に進まない。
- `needs_human` または retryable failed gate として停止する。
- Codex lane / SchemaFirst fallback はしない。

履歴への投影:

```text
[Startup Initial Instructions]
contextStill initial_instructions completed.
Key instructions:
...
```

### 6.4 `context_compile` gate

実行 tool:

- worker tool `mcp_call_tool`
- server: contextStill
- MCP tool: `context_compile`

arguments は runtime が生成する。

```ts
{
  goal: deriveStartupContextGoal(context, specification),
  domains: deriveDomains(context, specification),
  technologies: deriveTechnologies(context, specification),
  changeTypes: deriveChangeTypes(context, specification)
}
```

`goal` は必須。空文字を許可しない。

goal 生成の初期ルール:

- `currentTodo` があれば `Todo #seq title` と user request を使う。
- 仕様書 title / digest を含める。
- 例: `NightWorkers native/API runner の fixed startup flow を実装するため、仕様・既存 runner・Todo runtime・contextStill gate の関連コードを確認する。`

成功 event payload:

```ts
{
  toolName: 'context-still.context_compile',
  mcpTool: 'context_compile',
  status: 'completed',
  ok: true,
  result
}
```

この payload により既存 `ledger-sink` の auto-close が `contextstill.context_compile` Todo を完了できる。

履歴への投影:

```text
[Startup Context Pack]
goal=...
summary=...
```

注意:

- provider が後から `context_compile {}` を返した場合は、現行通り failed tool result を返す。
- startup gate 済みなら、重複 `context_compile` は再実行せず `ALREADY_COMPLETED` の tool result を返す選択肢もある。

## 7. Todo 更新・同期

### 7.1 startup Todo alignment

contextStill gate の auto-close 後、runner は DB から Todo を reread する。

期待状態:

- `initial_instructions` Todo は `passed`
- `context_compile` Todo は `passed`
- 次の open Todo が `running`

もし running Todo が存在しない場合:

- 最初の open Todo を `todo_list operation=start` 相当で開始する。
- ただし final closeout Todo は auto-start しない。

もし複数 running Todo が存在する場合:

- provider turn に進まない。
- failed runtime gate として `needs_human`

### 7.2 provider-visible Todo update

provider には `todo_list` mutation だけを見せる。

startup phase の Todo alignment は provider-visible tool ではなく runtime-owned operation とする。

provider が実装開始直後に Todo を置き換えたい場合:

- `todo_list replace` は許可する。
- ただし fixed gates と final gates は `buildStandardImplementationTodoList(...)` が必ず再挿入する。
- `initial_instructions` / `context_compile` が既に `passed` の場合、replace で再 pending に戻さない。

この最後の要件は現行 `todoListTool` だけでは不十分な可能性があるため、native runner 側で replace 後に fixed gate status を確認する。

## 8. テンプレート適用

### 8.1 model-visible tool

`native-api-tool-registry.ts` に `import_project` を追加する。

初期 schema:

```ts
{
  source: { enum: ['starter', 'git'] },
  stack: { enum: ['hono', 'python'] },
  variant: { type: 'string' },
  repoUrl: { type: 'string' },
  ref: { type: 'string' },
  targetPath: { type: 'string' },
  overwrite: { type: 'boolean' },
  initialize: { type: 'boolean' }
}
```

`materialize_template` は model-visible にしない。入口は `import_project` に統一する。

### 8.2 postImport state

`import_project` 成功時、runner state に次を保存する。

```ts
type NativeApiPostImportState = {
  toolCallId: string;
  mode: 'template' | 'git';
  templateId?: string | null;
  variant?: string | null;
  manifest?: unknown;
  llmContext?: unknown;
  recommendedVerificationCommands: string[];
  verifiedCommand?: string | null;
};
```

次 turn には `postImport` summary を history に追加する。

provider には次を明示する。

- `postImport.manifest` がある場合、package manager / scripts を再読しない。
- recommended verification command がある場合、検証 Todo で優先する。
- import が失敗/cancel の場合、代替 shell clone や静的 fallback に逃げない。

### 8.3 finalize guard

`finalize_answer` 前に確認する。

- `import_project` または `copy_directory` 成功がある。
- その後 `package.json` または `pyproject.toml` を読んだ、または `postImport.manifest` が存在する。
- recommended verification command がある場合、そのうち少なくとも1つに対応する `run_verification` が成功している。

不足時は `finalize_answer` を failed tool result にする。

## 9. context_eval / compile_eval closeout

### 9.1 runtime-owned closeout gate

`compile_eval` は model-visible に常時出さない。

実行タイミング:

- implementation Todo が全て terminal
- verification gate が terminal
- open Todo が `knowledge_capture` / `completion_report` だけ
- `context_compile` が成功済み
- final report draft がある

実行 tool:

- worker tool `mcp_call_tool`
- server: contextStill
- MCP tool: `compile_eval`

arguments:

```ts
{
  title: 'native-api-runner fixed startup flow',
  outcome: 'useful' | 'partial' | 'unused',
  body: '実装内容、検証、残存リスクの要約',
  relevance: number,
  coverage: number,
  specificity: number,
  actionability: number,
  clarity: number
}
```

`compile_eval` 成功 event payload は `toolName: 'context-still.compile_eval'` にする。

### 9.2 register_candidates との関係

`register_candidates` は別問題として扱う。

今回の固定 startup flow では `compile_eval` だけを closeout gate に入れる。

再利用可能な知識が明確にある場合の `register_candidates` は、別 phase で追加する。

## 10. 実装フェーズ

### Phase 1: Startup Controller

変更ファイル:

- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/services.native-api-runner-startup.test.ts`

受け入れ条件:

- provider turn 前に `read_current_specification` が実行される。
- provider turn 前に `context-still.initial_instructions` が実行される。
- provider turn 前に `context-still.context_compile` が具体 `goal` 付きで実行される。
- 各 gate が `native_api_tool_calls` に `runtime_gate` として残る。
- gate 成功 event で fixed Todo が auto-close される。

### Phase 2: Todo Alignment

変更ファイル:

- `native-api-startup-controller.ts`
- `native-api-runner.ts`
- `tests/services.native-api-runner-todo-alignment.test.ts`

受け入れ条件:

- `initial_instructions` / `context_compile` Todo が `passed` になる。
- 次の implementation/scaffold/inspection Todo が running になる。
- 複数 running Todo では provider turn に進まない。
- startup Todo を provider が再実行しなくても実装開始できる。

### Phase 3: Template Import

変更ファイル:

- `native-api-tool-registry.ts`
- `native-api-tool-dispatcher.ts`
- `native-api-runner.ts`
- `native-api-finalization.ts` または dispatcher 内 finalize helper
- `tests/services.native-api-runner-import-project.test.ts`

受け入れ条件:

- `import_project` が model-visible tool として出る。
- `materialize_template` は model-visible にしない。
- `import_project` 成功後、postImport summary が次 turn に入る。
- recommended verification 未実行では `finalize_answer` が失敗する。

### Phase 4: compile_eval Closeout

変更ファイル:

- `native-api-closeout-controller.ts`
- `native-api-runner.ts`
- `tests/services.native-api-runner-closeout.test.ts`

受け入れ条件:

- closeout 条件を満たした時だけ `context-still.compile_eval` が実行される。
- planning/startup 中には `compile_eval` が実行されない。
- `compile_eval` failure は final report を固定文に差し替えず、tool result として記録する。

## 11. テスト計画

追加する unit / integration tests:

1. startup success path
   - specification read
   - initial_instructions
   - context_compile
   - Todo alignment
   - provider turn starts after all gates

2. startup failure path
   - spec missing
   - contextStill unavailable
   - context_compile failure
   - no provider call

3. duplicate provider call
   - provider が `context_compile {}` を返す
   - runtime は failed tool result を返す
   - startup completed state は壊れない

4. import_project path
   - import_project success
   - postImport state preserved
   - recommended verification missing blocks finalize
   - verification success allows finalize

5. compile_eval closeout
   - final gates complete
   - compile_eval called once
   - runtime_finished final report remains user-facing

既存確認:

```sh
bun run typecheck
bunx vitest run tests/services.native-api-runner*.test.ts
bunx vitest run tests/services.agent-runtime.test.ts tests/services.agent-runtime-registry.test.ts
```

## 12. リスクと対策

### リスク: startup phase が固定化されすぎる

対策:

- startup phase は fixed gate だけに限定する。
- 実装方針や tool 選択は implementation phase で provider に任せる。

### リスク: context_compile が重くなる

対策:

- context_compile result は全文を毎 turn に入れない。
- digest / title / selected body / source references に圧縮する。

### リスク: Todo auto-close と runner state がずれる

対策:

- gate 実行後は必ず DB reread する。
- `ledger-sink` に依存するだけでなく、runner 側でも expected procedure status を検査する。

### リスク: compile_eval が早すぎる

対策:

- closeout controller で open Todo / verification / final report draft を検査する。
- planning/startup/implementation phase では実行しない。

## 13. 完了条件

- native/API run は provider turn 前に必ず fixed startup flow を通る。
- `initial_instructions` と `context_compile` Todo が runtime-owned gate で完了する。
- `context_compile` は常に具体 `goal` 付きで実行される。
- Todo 更新後に runner history が最新 Todo snapshot を含む。
- template import 後、manifest/verification evidence なしに finalize できない。
- closeout 時に `compile_eval` が一度だけ記録される。
- Codex SDK lane には変更を入れない。
