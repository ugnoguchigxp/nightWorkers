# Codex レーン Minimal Implementation Run 実装計画

## 1. 目的

Codex レーンで、ユーザーが実装計画化を明示していない小さい修正まで Plan mode 的な進行に寄ってしまう問題を抑える。

この計画では、Todo、LLM コードレビュー、品質ゲート verify は維持する。変えるのは、codex-agent runtime に渡す実行契約と初期 Todo の粒度であり、native Supervisor の Round 1 / jobType 分類は扱わない。

## 2. 背景

codex-agent lane は Supervisor の `minor_code_edit` / `major_code_edit` 分類を通らない。

実行経路は次の通り。

1. `nightworkers.run-orchestration.service.ts` が run を作成する。
2. `resolveAgentRuntime(...)` が `codex-agent` runtime を返す。
3. `CodexAgentRuntime.start(...)` が `buildCodexRuntimePrompt(context)` を `thread.runStreamed(...)` に渡す。

そのため、小さい修正を軽量実行に寄せるには Supervisor classifier ではなく、codex-agent runtime 向けの prompt contract と run 初期 Todo を調整する必要がある。

## 3. 対象範囲

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`

対象外:

- native Supervisor の Round 1 / Round 2 分類
- `prompt-tool-registry.ts` の jobType 定義
- Plan mode questionnaire / Blueprint / DB Design の routing
- NightWorkers MCP tool の追加
- DB schema / migration
- queue 管理 UI の変更

## 4. 現状の問題

### 4.1 初期 Todo が常に重い

`startTaskRun(...)` は runtime lane に関係なく `buildInitialRunTodos(compiledPromptText)` を使う。

現行の初期 Todo は、画面実装や仕様ベースの新規構築を想定している。

- 仕様と既存構成を確認する
- 対象画面の実装準備を行う
- 対象画面を仕様に沿って実装する
- 受け入れ条件を検証する

小さい修正でもこの Todo が入るため、Codex は「まず実装計画を組み立てる」方向へ寄りやすい。

### 4.2 runtime contract が計画優先に読める

`buildCodexRuntimePrompt(...)` には次の契約がある。

- `Execution order: specification -> Todo execution -> verification -> closeout.`
- `For multi-step work, call nightworkers.todo_list operation=replace once near the start.`
- `For planning, implementation-plan, specification, design-doc, or requirement-check work, call nightworkers.read_current_specification first.`

これらは大きい実装や仕様ベース実装では有効だが、小さい修正では「仕様確認、Todo 分解、計画作成」を強く誘導しすぎる。

## 5. 目標状態

codex-agent lane で、ユーザーが計画文書化を明示していない場合:

- 計画文書や詳細な実装計画を作らず、最小限の確認から実装へ進む。
- Todo は維持する。
- LLM コードレビュー Todo は維持する。
- 品質ゲート verify Todo は維持する。
- closeout 前に open Todo が残っている場合の guard は維持する。
- 明示的な planning / spec / implementation-plan 要求では、仕様確認や計画作成を引き続き許可する。

## 6. 設計方針

### 6.1 codex-agent lane 用の初期 Todo を分ける

`buildInitialRunTodos(...)` は native Supervisor lane 向けのまま維持する。

codex-agent lane では、新しい軽量 Todo builder を使う。

候補名:

- `buildCodexInitialRunTodos(compiledPromptText: string): ImplementationTodoInput[]`

初期 Todo の例:

1. 対象変更を確認して実装する
   - taskType: `implementation`
   - description: ユーザーが計画文書化を明示していない場合は、必要最小限の確認後に対象変更を実装する。
2. 必要最小限の動作確認を行う
   - taskType: `focused_verification`
   - description: 変更範囲に応じた focused check を行う。広域 verify は追加される品質ゲート Todo で扱う。

`buildStandardImplementationTodoList(...)` は引き続き使う。これにより、先頭 gate と末尾 gate は維持される。

維持される gate:

- `initial_instructions を実行する`
- `context_compile を実行する`
- `LLM コードレビューを実施する`
- `品質ゲート verify を実施する`
- `知識登録を行う`
- `完了報告を行う`

### 6.2 runtime contract に minimal implementation rule を追加する

`buildCodexRuntimePrompt(...)` に codex-agent lane 用の実行ルールを追加する。

追加する内容:

- ユーザーが実装計画、仕様化、設計整理、Plan mode を明示していない場合は、計画文書を作らず実装へ進む。
- 小さい修正では Todo を細かく分解しすぎない。
- Todo、コードレビュー、verify、closeout は省略しない。
- `nightworkers.read_current_specification` は、planning / implementation-plan / specification / design-doc / requirement-check が明示されている場合、または既存仕様に基づく実装で必要な場合に使う。
- 仕様が存在しない小さい修正では、仕様がないことを理由に止まらない。

既存の import_project / MCP / Todo closeout / warning contract は維持する。

### 6.3 IMPLEMENTATION_PHASE_PREAMBLE を補強する

`IMPLEMENTATION_PHASE_PREAMBLE` は実装フェーズ移行を明示しているため維持する。

追加候補:

```text
ユーザーが実装計画化を明示していない場合は、計画文書を作らず実装に進んでください。
```

この文は codex-agent lane だけでなく native runtime にも渡るため、追加する場合は副作用を確認する。

副作用が気になる場合は、preamble ではなく `buildCodexRuntimePrompt(...)` の contract に限定して追加する。

## 7. 実装手順

### Step 1: codex-agent lane 用 Todo builder を追加する

`api/modules/nightworkers/nightworkers.run-orchestration.service.ts` に `buildCodexInitialRunTodos(...)` を追加する。

`startTaskRun(...)` の Todo 作成箇所を次のように分岐する。

```ts
const initialTodos =
  runtimeLaneResolution.workerKind === 'codex-agent'
    ? buildCodexInitialRunTodos(compiledPromptText)
    : buildInitialRunTodos(compiledPromptText);
```

そのうえで、既存どおり `buildStandardImplementationTodoList({ todos: initialTodos, startFirst: true })` を呼ぶ。

### Step 2: Codex runtime contract を調整する

`api/services/agent-runtime/CodexAgentRuntime.ts` の `buildCodexRuntimePrompt(...)` に `Minimal implementation behavior` セクションを追加する。

配置は `[NightWorkers Runtime Contract]` 内の Todo 指示より前にする。

文言案:

```text
Minimal implementation behavior:
- If the user did not explicitly ask for an implementation plan, specification, design document, Plan mode, or requirements planning, do not stop with a plan document. Perform the smallest necessary inspection and proceed to implementation.
- For small, clear code changes, keep Todo decomposition compact. Do not create a detailed implementation-plan artifact just to start work.
- Preserve Todo tracking, LLM code review, quality-gate verify, and closeout even for small changes.
- Use nightworkers.read_current_specification when the user asks for planning/specification work or when an existing specification is clearly the source of truth. Do not block a small code change solely because no specification artifact exists.
```

日本語文言にする場合は、既存の日本語運用文脈に合わせて次のようにする。

```text
Minimal implementation behavior:
- ユーザーが実装計画、仕様化、設計文書、Plan mode、要件整理を明示していない場合は、計画文書で止まらず、必要最小限の確認後に実装へ進む。
- 小さく明確なコード変更では Todo 分解をコンパクトに保つ。着手のためだけに詳細な implementation-plan artifact を作らない。
- 小さい変更でも Todo tracking、LLM コードレビュー、品質ゲート verify、closeout は省略しない。
- nightworkers.read_current_specification は、ユーザーが planning/specification work を求めた場合、または既存仕様が明確な source of truth の場合に使う。小さいコード変更で仕様 artifact がないことだけを理由に停止しない。
```

### Step 3: 既存 contract の read_current_specification 文言を狭める

現在の文:

```text
For planning, implementation-plan, specification, design-doc, or requirement-check work, call nightworkers.read_current_specification first. If missing, use nightworkers.list_recent_specifications and then read by taskId.
```

変更案:

```text
For explicit planning, implementation-plan, specification, design-doc, requirement-check work, or implementation work grounded in an existing specification, call nightworkers.read_current_specification first. If missing and the task depends on a specification artifact, use nightworkers.list_recent_specifications and then read by taskId.
```

これにより、小さい修正で常に specification lookup を要求する解釈を避ける。

### Step 4: テストを追加・更新する

`tests/services.codex-agent-runtime.test.ts`

- `buildCodexRuntimePrompt(...)` に minimal implementation behavior が含まれること。
- prompt が Todo、review、verify、closeout の維持を含むこと。
- `read_current_specification` が「明示 planning / 既存仕様に基づく場合」に限定される文言になっていること。

`tests/nightworkers-service/services-nightworkers-02.test.ts`

- `NIGHTWORKERS_RUNTIME_LANE=codex-agent` の run で、初期 implementation Todo が軽量版になること。
- `LLM コードレビューを実施する` が残ること。
- `品質ゲート verify を実施する` が残ること。
- `initial_instructions` と `context_compile` が残ること。

native lane の既存テストは、従来の `buildInitialRunTodos(...)` が維持されることを確認する。

## 8. 受け入れ基準

- codex-agent lane の小さい修正で、初期 Todo が画面実装・仕様実装前提の重い Todo にならない。
- codex-agent lane の prompt が、明示 planning なしでは plan-only answer で止まらないよう指示している。
- Todo tracking は維持される。
- `LLM コードレビューを実施する` gate は維持される。
- `品質ゲート verify を実施する` gate は維持される。
- `codex_open_todos_before_completion` guard は維持される。
- 明示的な実装計画要求では、計画・仕様参照の挙動が壊れない。
- native Supervisor lane の Round 1 / jobType 分類には差分が出ない。

## 9. 検証計画

まず対象テストを実行する。

```bash
pnpm vitest run tests/services.codex-agent-runtime.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

関連回帰として、runtime lane と Todo builder 周辺を確認する。

```bash
pnpm vitest run tests/services.agent-runtime-registry.test.ts tests/services.todo-list-builder.test.ts
```

最後に、時間が許せば標準 verify を実行する。

```bash
pnpm verify
```

## 10. リスクと緩和策

### リスク: 小さい修正で verify が軽くなりすぎる

緩和策:

- focused check は軽量 Todo 内で許可する。
- 広域 verify は既存の `品質ゲート verify を実施する` gate で維持する。

### リスク: 明示的な planning 要求まで実装へ走る

緩和策:

- prompt 文言で「ユーザーが実装計画、仕様化、設計文書、Plan mode、要件整理を明示していない場合」に限定する。
- Plan mode questionnaire / Blueprint / DB Design routing には触らない。

### リスク: native lane の挙動が変わる

緩和策:

- 初期 Todo 分岐は `runtimeLaneResolution.workerKind === 'codex-agent'` に限定する。
- native lane は既存の `buildInitialRunTodos(...)` を使い続ける。

### リスク: Codex が Todo を省略する

緩和策:

- runtime contract で Todo、レビュー、verify、closeout の維持を明示する。
- 既存の open Todo finalization guard を維持する。

## 11. ロールバック

この変更は DB migration を伴わない。

問題が出た場合は、次を戻せば従来挙動に戻る。

- codex-agent lane 用 Todo builder の分岐
- `buildCodexRuntimePrompt(...)` の minimal implementation behavior 文言
- `read_current_specification` の条件を狭めた文言

## 12. 実装開始前チェックリスト

- [ ] codex-agent lane が Supervisor Round 1 / jobType 分類を通らないことを前提にしている。
- [ ] Todo、LLM コードレビュー、品質ゲート verify を削らない。
- [ ] Plan mode questionnaire / Blueprint / DB Design routing に触らない。
- [ ] native lane の初期 Todo を変えない。
- [ ] 小さい修正で仕様 artifact がないことだけを理由に停止しない文言になっている。
- [ ] 明示的な planning / spec / implementation-plan 要求は引き続き尊重する。
