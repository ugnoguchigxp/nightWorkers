# Native/API Plan Mode and StateCard Scope 実装計画

## 1. 目的

`native-api-runner` でも Plan mode を実行できるようにし、task routing ごとに model / role が変わる前提で StateCard の注入範囲を制御する。

現行の native/API lane は implementation lane として固定されている。provider request の role、model-visible tools、startup / closeout gate、Todo 初期化、StateCard 注入がすべて実装フェーズ前提になっているため、planning / review / runtime_debug に同じ文脈を流すと不要な情報や誤った行動指示が混ざる。

この計画では、次の2点を同じ境界で扱う。

1. Native/API lane の Plan mode 再現
2. task routing 単位の StateCard scope / projection

## 2. 背景

過去の native Supervisor には `planning` jobType に対する tool policy と planning reference があった。

参考にする実装:

- `45adea82:api/services/supervisor/prompt-tool-registry.ts`
- `45adea82:api/services/supervisor/skills/builtin/references/modes/planning.md`
- `45adea82:api/modules/nightworkers/nightworkers.workbench-routing.ts`
- `45adea82:api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

旧実装での planning tool surface:

```ts
planning: [
  'read_procedure',
  'search_procedure',
  'read_current_specification',
  'list_dir',
  'read_file',
  'search_files',
  'git_status',
  'finalize_answer',
]
```

一方、現行 `native-api-runner` は次の点で implementation 固定になっている。

- `buildNativeApiProviderRequest(...)` が `role: 'implementation'` を固定している。
- `getNativeApiToolDefinitions()` が write / import / verification tools を常時 model-visible にしている。
- `startTaskRun(...)` が標準実装 Todo を必ず作成し、`IMPLEMENTATION_PHASE_PREAMBLE` を必ず注入する。
- `NativeApiCloseoutController` が closeout で `context-still.compile_eval` を実行する。
- `buildInitialNativeApiHistory(...)` が routing role ごとの StateCard scope を持たない。

Plan mode は closeout ではない。実装・検証が終わっていない計画作成中に `compile_eval` を実行しない。

## 3. 非目標

- Codex SDK lane の挙動を変更しない。
- 旧 native Supervisor loop を復活させない。
- ユーザー文言の正規表現や keyword 判定で planning / review / implementation を分岐しない。
- llm-provider 層に jobType ごとの SystemContext や実行判断を分散させない。
- StateCard の永続 snapshot を削除しない。
- review / runtime_debug に coding 用 StateCard をそのまま流さない。
- planning run を implementation Todo の未完了 closeout として扱わない。

## 4. 目標状態

### 4.1 Native/API Plan mode

`native-api-runner` は `runtimeOptions.executionMode` を見て、少なくとも次の mode を扱う。

```ts
type NativeApiExecutionMode =
  | 'planning'
  | 'implementation'
  | 'review'
  | 'runtime_debug'
  | 'general_answer';
```

初期実装の必須対象は `planning` と `implementation` にする。`review` / `runtime_debug` は StateCard projection と将来拡張のために型と設計だけ先に矛盾なく置く。

planning mode の provider request:

- structured-LLM role は `plan`
- provider は `plan` route を優先する
- Codex provider は native/API lane では disallow する
- model-visible tool は read-only / finalize 中心に絞る
- implementation Todo は作らない
- implementation preamble は入れない
- finalize 後に implementation plan artifact を作れる
- `context-still.compile_eval` closeout は実行しない

implementation mode の provider request:

- structured-LLM role は `implementation`
- 現行 startup fixed gate を維持する
- 現行 import_project / postImport / verification guard を維持する
- implementation preamble と標準 Todo を維持する
- closeout `compile_eval` を維持する

### 4.2 StateCard scope

StateCard は「タスクごとに物理削除」ではなく「routing role ごとに投影を分ける」。

永続 snapshot は監査、UI、artifact 化、後続会話のために残す。ただし runtime に渡す StateCard は routing role に合う projection だけにする。

```ts
type StateCardScope = {
  role: 'plan' | 'implementation' | 'review' | 'runtime_debug' | 'general_answer';
  workKind?: string | null;
  taskId: string;
  sourceRunId?: string | null;
};
```

role 別の基本方針:

| role | 注入する情報 | 捨てる情報 |
| --- | --- | --- |
| `plan` | 要件、採用済み artifact、決定事項、未解決質問、制約 | 実装中 Todo の細部、途中の coding 仮説 |
| `implementation` | 実装対象、関係ファイル、現在 Todo、受け入れ条件、直近 verify | review 用評価観点だけの長文、過去 planning の冗長説明 |
| `review` | diff summary、変更ファイル、受け入れ条件、verify 結果、既知リスク | coding 中の途中方針、不要な Todo 履歴 |
| `runtime_debug` | runId、ログ、DB 状態、再現条件、失敗箇所、runtime settings | UI 計画、完成後の一般的説明 |
| `general_answer` | 原則なし。必要な短い会話要約だけ | coding / review / debug の詳細 StateCard |

## 5. 設計判断

### 5.1 mode は runtimeOptions に載せる

`AgentRunContext.runtimeOptions.executionMode` を source of truth にする。

理由:

- `AgentRunContext` は runtime lane 境界に既に存在する。
- `runtimeOptions` は lane ごとの追加設定を運ぶ既存の拡張点である。
- llm-provider や tool dispatcher に routing 判断を分散させずに済む。

代替案:

- user prompt を native-api-runner 内で分類する。
  - 却下。AGENTS.md の境界に反し、routing と runtime 実行判断が混ざる。
- `contextSnapshot` だけから読む。
  - 補助情報としては使えるが、runtime adapter の明示 input としては弱い。

### 5.2 tool registry は mode-aware にする

`getNativeApiToolDefinitions()` を mode-aware にする。

```ts
function getNativeApiToolDefinitions(input?: {
  executionMode?: NativeApiExecutionMode;
}): ProviderToolDefinition[];
```

planning mode の候補:

- `read_current_specification`
- `list_dir`
- `read_file`
- `search_files`
- `git_status`
- `context_compile`
- `new_context`
- `finalize_answer`

planning mode で出さない tool:

- `apply_patch`
- `replace_content`
- `import_project`
- `copy_directory`
- `materialize_template`
- `run_command`
- `run_background_command`
- `run_verification`
- `todo_list`

model-visible から隠すだけでは不十分なので、`dispatchNativeApiToolCall(...)` も mode allowlist を検証する。provider が非表示 tool を返した場合は実行せず、`TOOL_NOT_ALLOWED_FOR_MODE` を返す。

### 5.3 StateCard は role-specific projection にする

`maybeLoadConversationStateCard(...)` は生の latest snapshot を返すだけでなく、routing role に応じた projection を生成する責務へ分ける。

候補:

```text
api/services/conversation-context/state-card-projection.ts
```

責務:

- snapshot の永続データを削除しない。
- runtime role に不要な section を落とす。
- projection metadata を `contextSnapshot.conversationContext` に残す。
- projection が空なら `stateCardIncluded=false` にする。

contextSnapshot の追加候補:

```ts
conversationContext: {
  snapshotId?: string;
  version?: number;
  tokenEstimate?: number;
  stateCardIncluded: boolean;
  stateCardText?: string;
  projection?: {
    role: 'plan' | 'implementation' | 'review' | 'runtime_debug' | 'general_answer';
    workKind?: string | null;
    source: 'role_projection' | 'raw_snapshot' | 'omitted';
    omittedSections: string[];
  };
}
```

### 5.4 planning run は Todo 0 本を許容する

現行 `isPlanningOnlyRun(todos)` は Todo 0 本を planning-only とみなす。

この既存セマンティクスに合わせ、planning mode では `buildStandardImplementationTodoList(...)` を呼ばない。必要な runtime gate は `NativeApiStartupController` の runtime-owned tool calls と events で表現する。

planning mode で Todo tracking を model-visible にしない理由:

- 計画作成は implementation progress ではない。
- `todo_list replace` による implementation Todo 誤作成を避ける。
- 計画 artifact の完成を final report / artifact persistence で判定できる。

### 5.5 planning artifact は run metadata から作る

`createPlanningArtifactMessageIfNeeded(...)` は現在 `run_started` message metadata の `intakeJobSelection.jobType === 'planning'` を見ている。

native/API plan mode では次のどちらかを満たすようにする。

1. Workbench から planning run を起動する場合、`run_started` metadata に `intakeJobSelection.jobType='planning'` を保存する。
2. route 経由で直接 planning run を起動する場合、`contextSnapshot.executionMode='planning'` でも artifact 作成できるようにする。

## 6. 実装段階

### Phase 1: mode contract を通す

変更候補:

- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/registry.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`

作業:

1. `NativeApiExecutionMode` 型を追加する。
2. `RuntimeLaneSetupInput` に `executionMode` と route role を追加する。
3. `buildRuntimeLaneOptions(...)` が `executionMode` を返す。
4. `startTaskRun(...)` が routing / intake metadata から planning mode を受け取れるようにする。
5. provider request の role を mode から決める。

受け入れ条件:

- implementation 既定値は現行通り。
- planning mode では provider request role が `plan` になる。
- route policy は native/API lane で Codex provider を disallow する。

### Phase 2: planning tool surface を作る

変更候補:

- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/worker-tools/git.ts`

作業:

1. `git_status` を native-api-runner の worker tool registration に追加する。
2. `getNativeApiToolDefinitions({ executionMode })` を追加する。
3. planning allowlist を定義する。
4. dispatcher で mode allowlist を enforcement する。
5. `finalize_answer` の説明を mode ごとに変える。

受け入れ条件:

- planning tool definitions に mutating tools が含まれない。
- provider が planning mode で mutating tool call を返しても実行されない。
- implementation mode の tool definitions は既存 behavior を維持する。

### Phase 3: planning startup / closeout を分ける

変更候補:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-closeout-controller.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

作業:

1. planning mode では implementation preamble を注入しない。
2. planning mode では implementation Todo 初期化を skip する。
3. startup gate は planning でも実行するが、Todo alignment は Todo 0 本を成功扱いにする。
4. planning finalize では `compile_eval` closeout を skip する。
5. final report を implementation plan artifact として保存する。

受け入れ条件:

- planning run は Todo 0 本でも completed になれる。
- planning run は `context-still.compile_eval` を呼ばない。
- implementation run は startup gate / closeout gate を維持する。
- planning final report が markdown document artifact として残る。

### Phase 4: StateCard projection を入れる

変更候補:

- `api/services/conversation-context/state-card-projection.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- StateCard 関連 tests

作業:

1. role 別 projection 関数を追加する。
2. `maybeLoadConversationStateCard(...)` の呼び出し前後で role / workKind を渡す。
3. projection が空の場合は runtime prompt に StateCard を含めない。
4. `contextSnapshot.conversationContext.projection` に role と omitted sections を残す。
5. review / runtime_debug には coding 用 StateCard をそのまま入れない。

受け入れ条件:

- `plan` には要件 / artifact / open questions が優先される。
- `implementation` には実装対象 / Todo / verification context が優先される。
- `review` には diff / verification / risk が優先され、coding Todo の細部が落ちる。
- `general_answer` は原則 StateCard を含まない。

### Phase 5: UI / activity の truth を揃える

変更候補:

- `src/modules/nightworkers/components/ThreadTimeline*.tsx`
- run event rendering tests

作業:

1. run / turn の metadata に `executionMode` を表示できるようにする。
2. planning artifact と implementation result を UI 上で区別する。
3. StateCard projection の role を debug / transcript 側で確認できるようにする。

受け入れ条件:

- plan mode run が implementation completed と誤表示されない。
- review に coding StateCard が混ざったかどうかを trace で確認できる。
- native/API provider turn の model role が timeline / event payload で追える。

## 7. テスト計画

### Unit tests

- `getNativeApiToolDefinitions({ executionMode: 'planning' })` が mutating tools を含まない。
- `getNativeApiToolDefinitions({ executionMode: 'implementation' })` は既存 implementation tools を維持する。
- planning mode で disallowed tool call が `TOOL_NOT_ALLOWED_FOR_MODE` になる。
- `buildNativeApiProviderRequest(...)` が planning で `role: 'plan'` を使う。
- StateCard projection が role ごとに不要 section を落とす。

### Service tests

- Workbench planning route が API provider を使う場合、runtimeOptions に `executionMode='planning'` が入る。
- planning run は implementation Todo を作らない。
- planning run は implementation preamble を注入しない。
- planning run の final report が implementation plan artifact になる。
- implementation run は existing startup / import_project / verification guard を維持する。

### Regression tests

- API implementation route は引き続き `native-api-runner` を使う。
- Codex provider route は native/API planning に混ざらない。
- StateCard projection を入れても conversation snapshot の永続データは消えない。
- review run に implementation StateCard が raw のまま入らない。

### Manual verification

1. plan route model と implementation route model を別に設定する。
2. planning request を送り、provider request role / selected model / visible tools を確認する。
3. planning final report が markdown document artifact として保存されることを確認する。
4. implementation request に進み、planning artifact は参照されるが planning-only StateCard が raw で混ざらないことを確認する。
5. review request を送り、diff / verification / risk 中心の StateCard だけが入ることを確認する。

## 8. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| planning mode が implementation Todo を作る | 計画作成が未完了実装扱いになる | planning mode では Todo 初期化を skip し、Todo 0 本を許容する |
| tool を hidden にしただけで dispatcher が実行する | provider が mutating tool を実行できる | dispatcher allowlist を必ず入れる |
| StateCard を物理削除する | 監査、UI、後続文脈が欠落する | snapshot は残し、runtime projection だけを省く |
| review に coding StateCard が混ざる | review model が不要な実装方針に引っ張られる | role-specific projection で diff / verify / risk に絞る |
| plan route と implementation route が混ざる | ユーザーが設定した model routing と違う model が使われる | provider request role と event payload に role / model を残す |
| compile_eval が planning closeout で走る | ContextStill の評価が実装完了扱いになる | closeout controller に mode guard を入れる |

## 9. 実装順序

1. mode 型と runtimeOptions の wiring
2. provider request role 切り替え
3. mode-aware tool registry と dispatcher allowlist
4. planning Todo / preamble / closeout 分岐
5. planning artifact persistence
6. StateCard role-specific projection
7. UI / activity 表示の truth 修正
8. regression tests と manual verification

## 10. 完了条件

- Native/API lane で planning request が `role=plan` の API provider call として実行される。
- planning mode で write / import / verification tools が model-visible にならず、dispatcher でも拒否される。
- planning mode で implementation preamble と implementation Todo が作られない。
- planning final report が plan artifact として残る。
- implementation mode の既存 fixed startup flow と postImport verification guard が退行しない。
- StateCard が role-specific projection になり、coding StateCard が review / general_answer に raw 注入されない。
- routing role と selected model が event / trace から確認できる。
