# Role-Owned Context Compaction 実装計画

## 1. 目的

Role Routing で担当 LLM が切り替わる境界に到達したとき、次の Role を担当する LLM が自分に必要な情報だけを圧縮して working context として残し、それ以外の会話履歴を捨てられるようにする。

この計画で扱う改善:

1. Role ごとに必要な context を LLM 自身が選び直す。
2. タスク境界では全文履歴を持ち越さず、Todo / state card / task events / 設計書参照から必要情報を再取得する。
3. 設計書全文は常時 context に入れず、参照可能な正本として扱う。
4. 圧縮の要否、実行タイミング、保存先は runtime が制御し、provider に判断を分散させない。
5. 境界到達側は「次 Role 用の構造化 handoff」を残し、次 Role 側が自分の working context を生成する。

目標は、Role が変わるたびに過去履歴をすべて継承するのではなく、次の Role が必要な証拠だけを再水和できる runtime contract を作ること。

## 2. 背景

現在の native/API lane には provider call 前の runtime-owned context budget guard と baseline compaction がある。

- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`

現状の baseline compaction は、履歴を `contextWindowBaselineHistory` に戻し、Todo snapshot / current Todo / post-import context を再注入する。これは context overflow 回避としては安全だが、Role Routing の境界で「次 Role に何を残すべきか」を Role ごとに判断する仕組みではない。

また、`api/services/conversation-context/state-card-projection.ts` には Role ごとの state card projection がある。これは Role ごとに必要な情報を薄くする方向性と一致しているが、Role handoff artifact として保存されるものではなく、Role 境界での LLM 圧縮責務もまだ明示していない。

Todo については `api/services/todo-context/build.ts` が current Todo と previous Todo summaries を構造化できる。したがって、次タスクの復元は会話履歴ではなく Todo / task events / run context から行う前提にできる。

既存の run orchestration では `NativeApiExecutionMode` から provider role を導出している。

- `planning` / `general_answer` -> `plan`
- `implementation` / `runtime_debug` -> `implementation`
- `review` -> `review`

この計画でいう Role 境界は、まず **run 開始時点で前回 snapshot / handoff と今回 executionMode から復元される境界** として扱う。1 つの native/API run の途中で provider role を動的に変える実装は初期対象にしない。

## 2.1 レビューで潰した実装判断

この計画は、次の判断を実装者に残さない。

- 保存先は新規テーブルではなく、初期実装では `createRunEvent(...)` 経由の `task_events.payload_json.runEvent.data` にする。
- Activity 表示は初期実装の成功条件にしない。ただし run event type / normalizer は追加し、後続で projection できる形にする。
- LLM による要約生成は初期 PR の必須にしない。まず deterministic handoff / working context renderer を実装する。
- Role change は初期実装では run start 境界で判定する。run 中 mid-turn の role switch は後続 phase とする。
- 設計書参照は path / section / digest のみを working context に入れる。全文が必要な例外は明示フラグで扱う。
- schema validation に失敗した artifact は保存しない。失敗内容は `context.handoff_failed` / `context.working_context_failed` event に残して fail-closed する。

## 3. 非目標

- 設計書全文を常時 provider history に入れない。
- provider / llm-provider 層に Role ごとの SystemContext や実行判断を追加しない。
- ユーザー文言の keyword / regex 分類で圧縮方針を分岐しない。
- Role Routing にない provider endpoint を context 圧縮用に暗黙 fallback しない。
- Codex lane / SchemaFirst lane へ context 圧縮だけを理由に逃げない。
- UI 表示改善、Settings 画面改善、Activity 投影改善はこの計画に含めない。
- 設計書そのものの編集・レビュー workflow はこの計画では扱わない。
- 初期実装では、1 run の途中で `executionMode` / Role を切り替えない。
- 初期実装では、Role handoff 用の専用 DB テーブルを追加しない。

## 4. 目標状態

### 4.1 Role が working context を所有する

各 Role は、起動時または Role 境界直後に、自分の作業に必要な情報だけを working context として生成する。

基本方針:

- 境界到達側の Role は、作業結果を構造化 handoff として残す。
- 新しく割り当てられた Role は、handoff / Todo / state card / task events / 設計書参照から自分用の working context を作る。
- 新 Role が不要と判断した会話履歴、tool result、探索過程は provider history から捨てる。
- runtime は budget と handoff の保存・読込を制御する。
- provider は与えられた request を実行するだけで、圧縮要否や Role 判断を持たない。

### 4.2 設計書は正本参照にする

設計書は context に全文を常駐させない。Role working context には次の情報だけを含める。

- 参照すべき設計書 path
- 関係する章・節・見出し
- 今回の Role が誤解してはいけない制約
- 設計書にまだ反映されていない今回固有の判断
- 設計書と runtime evidence の差分

全文投入を許可する例外:

- 設計書そのものを編集する。
- 設計書の整合性をレビューする。
- 設計書全文を対象に差分検出する。
- 参照先が利用できず、全文を context に入れないと作業不能になる。

### 4.3 Todo を context 復元の入口にする

次タスクは会話履歴から推測しない。Todo / task run state から再取得する。

Role working context に必ず含めるもの:

- current Todo
- previous Todo summaries
- Todo の done / blocked / pending 状態
- Todo に紐づく procedure digest
- 直近で完了した evidence
- 未完了 Todo が存在する場合の stop condition

これにより、長い探索履歴を捨てても次 Role は次にやるべき作業を Todo から再開できる。

### 4.4 Handoff artifact を保存する

Role 境界で保存する artifact は自然文の雑な要約ではなく、schema 化する。

初期 schema:

```ts
type RoleHandoffArtifactV1 = {
  version: 1;
  runId: string;
  taskId: string;
  fromExecutionMode: NativeApiExecutionMode | null;
  toExecutionMode: NativeApiExecutionMode;
  fromRole: StructuredLlmRole | null;
  toRole: StructuredLlmRole;
  createdAt: string;
  sourceTurnId?: string | null;
  sourceEventSeq?: number | null;
  contextSnapshotId?: string | null;
  stateCardDigest?: string | null;
  currentTodo: {
    id: string;
    seq: number;
    title: string;
    status: string;
  } | null;
  completedWork: Array<{
    todoId?: string | null;
    summary: string;
    evidenceRefs: string[];
  }>;
  decisions: Array<{
    summary: string;
    reason?: string | null;
    evidenceRefs: string[];
  }>;
  openQuestions: Array<{
    summary: string;
    blocking: boolean;
    evidenceRefs: string[];
  }>;
  designReferences: Array<{
    path: string;
    section?: string | null;
    digest?: string | null;
    reason: string;
  }>;
  runtimeFacts: Array<{
    summary: string;
    source: 'todo' | 'task_event' | 'tool_call' | 'state_card' | 'user_request';
    evidenceRefs: string[];
  }>;
  discardPolicy: {
    discardedHistoryBeforeTurnId?: string | null;
    reason: string;
  };
};
```

`evidenceRefs` は全文 payload ではなく、参照可能な ID / path / event sequence を入れる。

保存 event:

- 成功: `context.handoff_created`
- 失敗: `context.handoff_failed`

実装時は `api/services/run-events/types.ts` の `RUN_EVENT_TYPES` と `api/services/run-events/normalizer.ts` の mapping に上記 event type を追加する。初期実装では Activity projection は任意だが、`task_events` から run detail / JSONL export で追跡できる状態を成功条件にする。

### 4.5 Deterministic minimum context を定義する

LLM 圧縮に失敗しても作業再開できる最小 context を runtime が deterministic に生成する。

`RoleWorkingContextV1` の最小 schema:

```ts
type RoleWorkingContextV1 = {
  version: 1;
  runId: string;
  taskId: string;
  executionMode: NativeApiExecutionMode;
  role: StructuredLlmRole;
  createdAt: string;
  source: 'deterministic' | 'llm_compacted';
  currentTodo: RoleHandoffArtifactV1['currentTodo'];
  previousTodoSummaries: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary?: string | null;
  }>;
  stateCard: {
    snapshotId?: string | null;
    digest?: string | null;
    projectionSource: 'role_projection' | 'raw_snapshot' | 'omitted';
    text?: string | null;
  };
  designReferences: RoleHandoffArtifactV1['designReferences'];
  carryForwardFacts: RoleHandoffArtifactV1['runtimeFacts'];
  openQuestions: RoleHandoffArtifactV1['openQuestions'];
  budget: {
    estimatedPromptTokens?: number | null;
    modelContextWindowTokens?: number | null;
  };
};
```

この deterministic minimum context は、LLM による working context compression の前段に必ず存在させる。初期実装では `source: 'deterministic'` のみでよい。

### 4.6 Role working context を生成する

新 Role 側は handoff artifact を材料に、自分用の working context を生成する。

生成対象:

- Role の目的
- current Todo と次に必要な action
- 参照すべき設計書 path / section
- 今回固有の制約
- 必要な evidence refs
- 捨ててよい履歴の範囲
- provider call 前の context budget metadata

生成しないもの:

- 設計書全文
- raw tool result の全文
- 大きな diff 全文
- 前 Role の内部推論
- Todo から復元できる作業順序の重複説明

## 5. 対象ファイル

主対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `api/services/conversation-context/state-card-projection.ts`
- `api/services/conversation-context/types.ts`
- `api/services/todo-context/build.ts`
- `api/services/todo-context/types.ts`
- `api/services/run-events/types.ts`
- `api/services/run-events/normalizer.ts`
- `api/modules/nightworkers/nightworkers.runs.repository.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/prompt-packet.ts`
- `api/services/supervisor/skills/registry.ts`
- `api/services/supervisor/skills/builtin/SKILL.md`
- `api/services/supervisor/skills/builtin/references/router.md`
- `api/services/supervisor/skills/builtin/references/phases/*.md`

新規追加:

- `api/services/agent-runtime/native-api-runner/native-api-role-handoff.ts`
- `api/services/agent-runtime/native-api-runner/native-api-role-working-context.ts`
- `api/services/agent-runtime/native-api-runner/native-api-role-context-events.ts`

テスト対象:

- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-request-adapter.test.ts`
- `tests/services.conversation-context.test.ts`
- `tests/services.todo-context.test.ts`
- `tests/services.run-events.test.ts`
- `tests/services.supervisor-skills.test.ts`
- `tests/services.native-api-role-handoff.test.ts`

## 6. 実装計画

### Phase 1: event contract と schema を追加する

作業:

1. `RoleHandoffArtifactV1` の型を追加する。
2. `RoleWorkingContextV1` の型を追加する。
3. `RUN_EVENT_TYPES` に `context.handoff_created` / `context.handoff_failed` / `context.working_context_created` / `context.working_context_failed` を追加する。
4. `normalizeRunEventToLegacy(...)` に mapping を追加する。
5. event payload は `runEvent.data.artifact` に schema 済み object を入れる。
6. artifact には raw history を保存しない。
7. `evidenceRefs` は `task_events.seq`、`native_api_turns.id`、tool call id、file path など参照可能な値に限定する。
8. artifact の保存失敗時は provider fallback へ逃げず、runtime error として止める。

成功条件:

- Role 境界ごとに handoff artifact が 1 件以上保存できる。
- artifact だけを見て current Todo / decisions / open questions / design references が分かる。
- raw file content や secret が artifact に入らない。
- run JSONL export / run detail から context event を追跡できる。

### Phase 2: deterministic handoff / working context renderer を追加する

作業:

1. `native-api-role-handoff.ts` に deterministic handoff builder を追加する。
2. 入力は run context snapshot、latest conversation state card、Todo snapshot、直近 task events に限定する。
3. 前回 run の terminal state / final report / Todo summaries がある場合だけ `completedWork` に入れる。
4. 設計書本文は読まず、path / section / digest を `designReferences` に入れる。
5. `native-api-role-working-context.ts` に deterministic working context renderer を追加する。
6. renderer は `RoleWorkingContextV1` と provider history 用 text の両方を返す。
7. 生成後に `context.working_context_created` event を保存する。

成功条件:

- LLM を呼ばずに handoff と working context を生成できる。
- current Todo / previous Todo summaries / state card projection が working context に入る。
- 設計書全文、raw file content、raw tool result が入らない。
- schema validation 失敗時は `context.working_context_failed` event を保存して止める。

### Phase 3: run start 境界で history reset を接続する

作業:

1. `startTaskRun(...)` が作成した `runtimeContextSnapshot` に Role working context metadata を保存する。
2. `NativeApiRunner` の初期 history 構築で、latest user request と Role working context を baseline に含める。
3. Role working context を含めた provider request を構築する。
4. `estimateNativeApiContextBudget(...)` を実行し、既存 budget guard を通す。
5. budget 超過時は既存 baseline compaction に進むが、working context は baseline に残す。

成功条件:

- Role が変わった provider request には、前 Role の長い履歴ではなく Role working context が入る。
- Todo から current task を再取得できる。
- 設計書は path / section 参照として入る。
- budget 超過時は既存 runtime-owned compaction guard で止められる。

### Phase 4: LLM handoff / compression を opt-in で追加する

作業:

1. deterministic handoff を入力に、LLM に `RoleHandoffArtifactV1` の refinement を要求する。
2. 境界到達側には「次 Role 用の最終 working context を作る」のではなく、「事実と参照先を構造化して残す」と指示する。
3. 新 Role 側には `RoleWorkingContextV1` の compression を要求する。
4. prompt 文言は日本語を維持する。
5. 生成結果は schema validation し、失敗時は固定文で差し替えず、LLM 本文があれば failure event に残す。
6. provider 層には Role 判断や用途別 SystemContext を追加しない。

成功条件:

- LLM refinement が成功すれば `source: 'llm_compacted'` の working context が使われる。
- LLM refinement が失敗しても deterministic context で続行できる場合は続行する。
- deterministic context も作れない場合は provider call 前に止める。

### Phase 4.5: mid-run Role switch は後続実装として分離する

run 中に `executionMode` / Role が変わる設計が必要になった場合だけ、次を追加する。

1. provider turn 終了時に次 Role を runtime が決定する。
2. 未完了 tool call がないことを検証する。
3. handoff artifact を保存する。
4. provider history を baseline + working context に reset する。
5. turn index / sourceTurnId / sourceEventSeq を artifact に保存する。

この phase は初期 PR に含めない。初期実装では run start 境界だけを扱う。

### Phase 5: Supervisor reference に運用ルールを追加する

作業:

1. `api/services/supervisor/skills/builtin/SKILL.md` に Role handoff の基本ルールを追加する。
2. `references/router.md` に Role 境界では handoff を作り、新 Role が working context を作る方針を追加する。
3. phase reference に必要な観点を追加する。
   - plan: 設計書 path / 未解決判断 / acceptance criteria
   - execute: current Todo / changed files / implementation constraints
   - review: completed work / evidence refs / verification status
   - investigate: observed facts / failed hypotheses / next evidence
   - verify: command results / remaining risk
4. 参照文書全文を prompt に常時入れるのではなく、`resolveSupervisorReferenceDocuments(...)` の選択結果を正本参照として扱う。

成功条件:

- Round 2 以降でも Role handoff の考え方が prompt/reference から読める。
- provider 層に判断が増えない。
- prompt 文言が日本語の運用ルールを維持する。

### Phase 6: 回帰テストを追加する

最小 regression:

1. run start 境界で handoff artifact が作られる。
2. 新 Role の provider request が handoff + Todo + Role projection から作られる。
3. 設計書全文が provider request に入らない。
4. current Todo が provider request に入る。
5. previous Todo summaries が必要な範囲で入る。
6. raw tool result の全文が Role 境界後に落ちる。
7. context budget guard が Role working context 生成後にも再評価される。
8. provider route fallback は Role Routing の explicit candidates だけを使う。
9. `context.*` run event が legacy normalizer を通り、task_events に保存される。
10. schema validation 失敗時は provider call 前に fail-closed する。

検証コマンド:

```sh
bunx vitest run tests/services.run-events.test.ts tests/services.native-api-role-handoff.test.ts tests/services.native-api-runner.test.ts tests/services.conversation-context.test.ts tests/services.todo-context.test.ts tests/services.supervisor-skills.test.ts
```

変更範囲が広がった場合:

```sh
bun run verify:base
```

## 7. Runtime contract

Role 境界の runtime contract:

1. `startTaskRun(...)` が executionMode と Role を解決する。
2. runtime が previous snapshot / Todo / state card / task events を読み込む。
3. runtime が deterministic handoff artifact を生成する。
4. runtime が handoff artifact を schema validation して `context.handoff_created` として保存する。
5. runtime が deterministic working context を生成する。
6. runtime が working context を schema validation して `context.working_context_created` として保存する。
7. runtime が provider history を baseline + latest user request + current Todo + working context に reset する。
8. runtime が provider request を構築する。
9. runtime が context budget を再評価する。
10. budget 内なら provider call する。
11. budget 超過なら既存 compaction guard または needs_human で止める。

provider contract:

- provider は handoff / working context の保存判断を持たない。
- provider は Role Routing の候補生成を行わない。
- provider は schema validation 失敗時に固定エラー本文へ差し替えない。
- provider は与えられた messages / tools を実行し、結果を返す。

### 7.1 Provider history format

Role working context は provider history では `NativeApiHistoryItem` の user item として扱う。

初期実装では `NativeApiUserSource` を増やさず、`source: 'runtime'` を使う。内容は marker 付き text にする。

```text
<ROLE_WORKING_CONTEXT version="1" source="deterministic">
executionMode=implementation
role=implementation
currentTodo=...
designReferences=...
evidenceRefs=...
</ROLE_WORKING_CONTEXT>
```

追加位置:

1. system prompt
2. latest user request
3. current Todo
4. Role working context

禁止:

- Role working context を system prompt に混ぜない。
- raw tool result / raw diff / read_file 全文を入れない。
- 設計書全文を入れない。
- provider request adapter で Role working context を再解釈しない。

## 8. 失敗時の扱い

handoff 生成失敗:

- LLM に到達できない場合は runtime error として止める。
- LLM 本文が返ったが schema validation に失敗した場合は、本文と parse error を evidence として残し、固定文で成功扱いにしない。
- 別 provider へ暗黙 fallback しない。

working context 生成失敗:

- Todo / state card / handoff から deterministic minimum context を作れる場合だけ fallback する。
- deterministic minimum context でも budget 超過する場合は `needs_human` で止める。
- 設計書全文投入で無理に成功させない。

Role change 検出失敗:

- run context snapshot の `executionMode`、`effectiveLlmRouting.activeRole`、provider request の role が矛盾した場合は provider call 前に止める。
- 前 run / 前 Role の履歴をそのまま新 Role に渡して続行しない。
- mid-run Role switch が必要な状態を検出した場合、初期実装では `needs_human` または明示的な次 run 作成へ誘導する。

## 9. 実装順序

推奨順:

1. `context.*` run event type / normalizer / tests を追加する。
2. `RoleHandoffArtifactV1` / `RoleWorkingContextV1` と schema validation を追加する。
3. Todo / state card / design references を使った deterministic renderer を追加する。
4. run start 境界で history reset を追加する。
5. Supervisor reference を更新する。
6. budget / route fallback / no full design doc の regression を固める。
7. LLM handoff / working context compression を opt-in で追加する。
8. 必要になったら mid-run Role switch を別 PR で追加する。

最初の PR では 1 から 4 までに限定する。LLM による圧縮生成は schema と保存・reset の足場ができてから入れる。

## 9.1 最初の PR の実装チェックリスト

### 9.1.1 Run event contract

対象:

- `api/services/run-events/types.ts`
- `api/services/run-events/normalizer.ts`
- `tests/services.run-events.test.ts`

作業:

1. `RUN_EVENT_TYPES` に次を追加する。
   - `context.handoff_created`
   - `context.handoff_failed`
   - `context.working_context_created`
   - `context.working_context_failed`
2. `normalizeRunEventToLegacy(...)` に mapping を追加する。
   - created 系: `{ eventType: 'context', type: 'info' }`
   - failed 系: `{ eventType: 'context', type: 'error' }`
3. normalizer test で created / failed の legacy mapping を固定する。

この PR では Activity projection を追加しない。UI 表示が必要になったら `runEventToActivityKind(...)` と `shouldProjectRunEventToActivity(...)` を別 commit で拡張する。

### 9.1.2 Schema / renderer

対象:

- `api/services/agent-runtime/native-api-runner/native-api-role-handoff.ts`
- `api/services/agent-runtime/native-api-runner/native-api-role-working-context.ts`
- `tests/services.native-api-role-handoff.test.ts`

作業:

1. `RoleHandoffArtifactV1` / `RoleWorkingContextV1` の型と validator を追加する。
2. validator は unknown input を受け、成功時だけ typed value を返す。
3. 空文字の `runId` / `taskId` / `toExecutionMode` / `toRole` は invalid にする。
4. `designReferences[].path` は空文字不可。本文は持たせない。
5. `evidenceRefs[]` は string のみ許可し、大きな payload object は拒否する。
6. deterministic renderer は次の入力だけを受ける。
   - `AgentRunContext`
   - projected state card metadata
   - Todo context
   - previous run / task event refs

### 9.1.3 Orchestration 接続

対象:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/types.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`

作業:

1. `startTaskRun(...)` で `runtimeContextSnapshot.roleContext` を追加する。
2. `roleContext` には artifact 本体ではなく、artifact digest / event seq / source / omitted flags を入れる。
3. `createRunEvent(...)` で `context.handoff_created` と `context.working_context_created` を保存する。
4. 保存後の event seq を `runtimeContextSnapshot.roleContext` に反映する。
5. `AgentRunContext['contextSnapshot']` の index signature に依存しすぎないよう、型コメントまたは narrow helper を追加する。

失敗時:

- handoff / working context の schema validation に失敗したら、failed event を保存し、run を provider call 前に `needs_human` 相当で止める。
- failed event 保存自体に失敗したら、その error を既存 runtime error 経路で表に出す。

### 9.1.4 Native API Runner 接続

対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `tests/services.native-api-runner.test.ts`

作業:

1. `buildInitialNativeApiHistory(...)` が `context.contextSnapshot.roleContext.renderedText` を読む。
2. 読めた場合、latest user request と current Todo の後に `source: 'runtime'` の user item として追加する。
3. `compactNativeApiHistoryToBaseline(...)` に `roleWorkingContextItem` を渡せるようにする。
4. baseline compaction 後も current Todo と Role working context を保持する。
5. provider request 再構築後に `estimateNativeApiContextBudget(...)` を必ず再実行する。

テスト:

- initial history に Role working context が 1 回だけ入る。
- baseline compaction 後も Role working context が残る。
- Role working context に設計書全文 marker / raw tool payload が入らない。
- route fallback 候補は既存の explicit route guard を維持する。

### 9.1.5 Supervisor reference 更新

対象:

- `api/services/supervisor/skills/builtin/SKILL.md`
- `api/services/supervisor/skills/builtin/references/router.md`
- phase reference のうち必要な最小ファイル
- `tests/services.supervisor-skills.test.ts`

作業:

1. Role 境界では、前 Role が handoff を残し、新 Role が自分の working context を作ることを書く。
2. 設計書は正本参照であり、全文を常時 context に入れないことを書く。
3. Todo から次タスクを再取得する前提を書く。
4. provider 側に判断を増やさないことを書く。

### 9.1.6 最初の PR の検証コマンド

```sh
bunx vitest run tests/services.run-events.test.ts tests/services.native-api-role-handoff.test.ts tests/services.native-api-runner.test.ts tests/nightworkers-service/services-nightworkers-01.test.ts tests/services.supervisor-skills.test.ts
```

失敗した場合は、先に該当 unit を直す。`verify:base` は上記が通ってから実行する。

## 10. 受け入れ条件

- Role ごとの LLM が、自分に必要な working context を持ち、それ以外の履歴を捨てられる。
- 次タスクは Todo から再取得できる。
- 設計書全文は通常 provider request に入らない。
- 設計書 path / section / digest は context に入る。
- Role 境界で handoff artifact が保存される。
- provider 層に Role 判断や圧縮判断が追加されない。
- context budget guard が Role working context 生成後にも動く。
- Role Routing にない provider endpoint へ暗黙 fallback しない。
- 初期 PR では run start 境界だけを扱い、mid-run Role switch を未実装として明示的に残す。
- `context.*` event が task_events / JSONL export から追跡できる。
- baseline compaction 後も current Todo と Role working context が消えない。
