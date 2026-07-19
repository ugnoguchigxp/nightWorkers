# Coding Agent Runtime Reliability Recovery Plan

## Status

- Plan status: `in_progress`
- Document created: 2026-07-18
- Guidance principle revised: 2026-07-19
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Incident repository: `/Users/y.noguchi/Code/todolist`
- Baseline HEAD: `5766a115774ceff64f1605c20bfe01eae47baaf6`
- Baseline worktree: dirty（既存の未コミット変更5件。本計画の実装では所有権を侵害しない）
- Primary scope: Coding Agent Todo identity、MCP request authority、Codex resume fallback、verification、closeout
- Related plan: `spec/docs/coding-agent-llm-owned-todo-refactor-plan.md`
- Trigger: Coding Agentが作成したtodolistについて、ユーザーがJSON parse error、SQLite table missing、API 404を複数回提示しても修正が完了しなかった

### Implementation progress（2026-07-19）

- Phase 0: 再現fixtureとtool capability baselineを追加済み。
- Phase 1: Run-local `todoKey`、canonical Todo ID、migration、依存解決を実装済み。
- Phase 2: request-scoped authority、差分付きrecovery guidance、訂正引数を主要scoped toolへ適用済み。MCP compositionのowned module移動は継続中。
- Phase 3: Codex State Card、resume失敗時の同一promptによるfresh fallback、raw resume error保持を実装済み。
- Phase 4: command evidence、`pipefail`、process cwd/repository rootを実装済み。todolist exact-path修正とfresh DB CRUD testは検証時点で`bun run verify`まで成功したが、その後incident repositoryはユーザー操作で削除されたため成果物は残っていない。
- Phase 5: Codex / Native共通のcompletion recovery packet、prior candidate保持、candidate revision eventを実装済み。
- Phase 6: targeted regressionは実行中。統合scenario 3回と最終rollout判定は未完了。

## 1. 目的

Coding Agentがユーザーから実行時エラーを受け取ったとき、既存の単一runtimeとLLM-owned Todo原則を維持したまま、次の状態を実現する。

1. 新しいRunでTodo planを確実に作成・開始できる。
2. request-scoped Task / Run / repositoryを、モデル入力で別対象へ差し替えられない。
3. provider threadのresumeに失敗しても、過去の判断、失敗、実行済み操作、現在のsource stateを失わない。
4. 実際には失敗した検証を成功扱いせず、ユーザーが提示した再現条件を解消したことを確認してから完了報告する。
5. Todo契約の修復turnが必要でも、元のTask結果、未解決事項、検証結果を最終回答から失わない。

本計画は、Coding Agentの行動を禁止事項で狭めるのではなく、正本、観測証拠、現在の差分、復旧参照、次に満たす条件を一貫した形式で渡し、LLM自身が合理的な次actionを選べる状態を作る。hostが強制するのはauthority、identity、revision、transaction、idempotencyなど副作用の安全性に必要な構造的不変条件に限定する。

## 2. インシデントで確認した事実

### 2.1 生成物の未解消不具合

`/Users/y.noguchi/Code/todolist`を新しいSQLite DBと別portで起動した結果、migration自体は成功したが、次の差が再現した。

| Request            | Result |
| ------------------ | ------ |
| `GET /api/todos`   | 200    |
| `GET /api/todos/`  | 404    |
| `POST /api/todos/` | 404    |

Frontendは`/api/todos/`を呼ぶため、現在の生成物は主要画面から利用できない。

加えて、port 5173で動いていたprocessのcwdは生成先ではなく`/Users/y.noguchi/Code/hono-standard`だった。実行対象processのidentity確認と、生成先を別portで起動する分離検証が不足していた。

### 2.2 Coding Agent Runの失敗傾向

エラー修正に使われた直近3 Runでは、tool failureとTodo contract warningが連続した。

| Run            | Failed tool results | Warning events | 主な症状                                                |
| -------------- | ------------------: | -------------: | ------------------------------------------------------- |
| `ffa331f6-...` |                   9 |             11 | Todo plan競合後にcurrent Todoなしで修正                 |
| `652827b0-...` |                  12 |             11 | 誤記runId、Todo mutation競合、closeout反復              |
| `93cc94e9-...` |                   8 |              9 | 404再現確認失敗を成功扱い、最終回答がTodo契約説明へ変化 |

3 RunすべてでCodex resumeが`no rollout found for thread id`により失敗し、新規threadへfallbackした。

### 2.3 検証誤判定

404対応Runでは次が記録されている。

1. `bun run start`は`EADDRINUSE`でexit 1。
2. 後続の`curl ... | head -20`は接続失敗を出力した。
3. pipeline末尾の`head`が0を返したため、command全体はexit 0になった。
4. Coding Agentはendpoint接続済みと報告した。
5. `bun run verify`にはTodo APIのexact-path testがなく、404を検出できなかった。

### 2.4 Todo mutationの構造的失敗

最初のRunは`inspect`、`db`、`api`、`ui`、`verify`というTodo IDを保存した。後続Runも同じ意味的IDを再利用したが、`task_run_todos.id`はDB全体のprimary keyであり、Run local identityではない。このため初回`replace_plan`が`TODO_MUTATION_CONFLICT`へ崩れた。

さらにMCPの`todo_list`は、request-scoped runIdよりモデルが渡したrunIdを優先する。実データでは1文字誤記したrunIdとtaskIdがrunIdとして渡され、foreign key errorと`RUN_NOT_FOUND`を発生させた。

## 3. Root Cause

```text
provider thread resume失敗
        |
        v
Codex laneではState Cardなしでfresh thread開始
        |
        v
最新ユーザーerror以外の失敗履歴・実行済み操作を喪失
        |
        v
Run間で意味的Todo IDがprimary key衝突
        |
        v
current Todoを開始できずworkspace作業
        |
        v
Todo contract violation feedbackが元Taskのcloseoutより優先
        |
        v
不具合解消ではなくTodo契約復旧を最終報告
```

単一要因ではない。Todo identity、request authority、context continuity、verification、closeout persistenceの5層が同時に破綻した結果である。

## 4. Target Invariants

### 4.0 合理的誘導の共通contract

MCP error、resume fallback、Todo reconciliation、closeoutの各箇所で個別の禁止文を増やさず、次の共通packetを定数または共通schemaとして再利用する。

```ts
type CodingAgentRecoveryGuidance = {
  authoritativeContext: {
    taskId: string;
    runId: string;
    repositoryRoot: string;
    planRevision?: number;
    currentTodoId?: string;
  };
  observations: Array<{
    kind: "command" | "tool" | "source" | "event" | "user_reproduction";
    summary: string;
    digest: string;
    rawRef?: string;
  }>;
  discrepancies: Array<{
    field: string;
    supplied?: string;
    authoritative?: string;
  }>;
  unresolvedItems: string[];
  recoveryRefs: Array<{
    kind: "history" | "error" | "source" | "todo" | "candidate";
    digest: string;
    cursor?: string;
    itemCount: number;
  }>;
  satisfactionConditions: string[];
};
```

- `authoritativeContext`は次のtool callで再利用できる正本値を返す。
- `observations`はraw resultまたはdigest付き参照を返し、成功・失敗の意味判断材料にする。
- `discrepancies`は入力と正本の差を示し、単なる拒否理由で終わらせない。
- `recoveryRefs`は省略された履歴、error、source stateを再取得可能にする。
- `satisfactionConditions`は次へ進むために観測可能な条件を示すが、実行順や次actionは固定しない。
- `satisfactionConditions`の意味条件はユーザー要求とLLM-owned Todoから引き継ぎ、hostが追加するのはauthority、revision、transactionなど構造条件だけとする。
- LLMはこのpacketとTaskを基にTodo、次action、検証、完了判断を行う。

### 4.1 Todo identity

- LLMが`replace_plan`で指定するTodo keyはRun local keyとして扱い、永続化IDと混同しない。
- 永続化するcanonical Todo IDは異なるRun間で必ず一意になる。
- 同じRun内の同じTodo keyは再計画時にも決定的に同じcanonical Todo IDへ解決できる。
- dependencyは同じreplace command内のTodo keyからcanonical Todo IDへserver側で解決する。
- modelは再計画ではTodo key、個別mutationでは返却されたcanonical Todo IDとrevisionを使用する。
- terminal Todoの状態不変性と同時running一件の制約は、transaction上の整合条件として維持する。

### 4.2 Request authority

- MCP request contextの`taskId`、`runId`、execution rootをauthorityとする。
- scoped toolでモデル入力のIDが省略された場合はrequest contextを使用する。
- モデル入力がrequest contextと異なる場合は`REQUEST_CONTEXT_MISMATCH`とともに、差分、正本値、再試行に使える引数を返す。
- mismatchが解消されるまでmutationは未実行のまま保持し、訂正後のcallを同じintentとして再試行できる。
- unscoped catalog操作には用途に合うread contractを提示し、scoped mutationと役割を混同させない。

### 4.3 Context continuity

- provider-native conversationは最適化であり、NightWorkers上の正本ではない。
- resume失敗時も、Task Goal、採用済み判断、未解決事項、実行済み操作、失敗、current Todo、source digestをfresh threadへ復元する。
- contextを省略する場合はdigest、件数、paging情報を残す。
- 直近ユーザー文を過去の判断、失敗、実行済み操作へ時系列で追加し、累積状態として提示する。
- resume errorのraw本文を監査可能な構造化eventへ保持する。

### 4.4 Verification

- commandのexit codeとraw stdout / stderrを両方保持する。
- pipelineを実行するmanaged checkは`pipefail`相当の失敗伝播を保証する。
- 起動確認ではPID、cwd、listening port、repository rootを対応付ける。
- ユーザーが提示したexact request pathを回帰testまたは構造化checkで再現する。
- 検証結果は`verify`、ユーザー再現条件、process identity、raw observationを一つのevidence bundleとして提示する。
- LLMが検証の十分性を判断する所有権は維持する。

### 4.5 Closeout

- assistant本文を候補revisionとしてappend-onlyに保持する。
- Todo reconciliation turnへ移る際、直前のfinal candidateと未解決Taskを次turnへ渡す。
- contract修復後の最終回答は、Todo状態だけでなく元Taskの結果と検証結果を含む。
- hostはLLM本文を保持し、構造的preconditionとの差をreconciliation packetとして追加する。
- completion controllerは引き続き構造的preconditionだけを確認する。

### 4.6 Role module境界

- Coding Agent固有のMCP、orchestration、runtime、System Contextは`api/modules/codingAgent`が所有する。
- Mission Pilotとの共通contract、port、event、純粋utilityだけを`api/modules/agentsShare`へ置く。
- 現在`api/mcp`や`api/modules/nightworkers`にあるCoding Agent固有処理を改修地点として固定せず、owned moduleへ移したうえで修正する。
- 旧entry pointを残す場合もAgent非依存のcomposition wiringだけにし、role固有実装をimport / re-exportしない。

## 5. 設計方針とスコープ境界

- Coding Agentは独立した単一runtimeとして、Todo作成、次action、検証、完了判断を一貫して所有する。
- 実装、検証、reviewはTaskの状況に応じてLLMが組み立て、固定modeではなく観測結果から更新する。
- error、Task、Todoの意味解釈はLLMがraw evidenceを読んで行い、hostはschemaと構造イベントを扱う。
- Todo更新はLLMまたは人間の明示commandを正本とし、hostはrevisionとtransactionを検証する。
- verification contractはframework非依存のprocess resultとevidence refを返し、個別frameworkの評価はCoding Agentが行う。
- Codex native commandを含む利用可能な手段は維持し、tool choiceはTaskと現在状態に応じてLLMが決める。
- provider本文はcandidate revisionとして保持し、closeoutでは正本状態と検証結果を追加contextとして渡す。
- 変更範囲は今回確認した5層の原因とrole module境界に集中し、他moduleの変更は依存解消に必要な最小範囲とする。

## 6. 実装フェーズ

各Phaseの順序は原因の依存関係を示す。Coding Agentは観測結果に応じてTodoと実行順を更新できるが、各Phaseの完了判断には記載したevidenceとsatisfaction conditionsを使用する。

### Phase 0: インシデントfixtureとbaseline固定

#### 目的

現在の失敗をproduction code変更前に再現testとして固定する。

#### 実装

1. Todo mutation fixtureで、別Runが同じTodo key `inspect`を使用するケースを追加する。
2. request-scoped runIdとモデル入力runIdが異なるMCP testを追加する。
3. Codex resumeが`no rollout found`で失敗し、fresh threadへ移るfixtureへ過去error historyを追加する。
4. reconciliation turn後に元のfinal candidateが失われるfixtureを追加する。
5. `/Users/y.noguchi/Code/todolist`では、Frontendと同じ`/api/todos/`に対するAPI testを追加する計画を確定する。
6. 現在のSystem Context digest、tool manifest、利用可能command一覧をbaselineとして保存し、誘導追加の前後で能力surfaceを比較できるようにする。

#### 主な対象

- `tests/services.todo-mutation.test.ts`
- `tests/codex-agent-runtime/llm-owned-contract.cases.ts`
- NightWorkers MCP integration test
- todolistのHono route test

#### 検証

- 新規testが現状codeに対して期待どおり失敗する。
- 失敗理由がTodo ID衝突、context mismatch、fallback context欠落、final candidate欠落の各原因に分離される。
- baselineから、既存toolとnative commandの利用可能範囲を確認できる。

#### 失敗時対応

fixtureが別原因で失敗する場合はproduction codeを変更せず、観測対象を分離してから再実行する。

### Phase 1: Todo identityのRun局所化

#### 採用方針

`replace_plan`でLLMが扱うRun-local `todoKey`と、DBおよび個別mutationが扱うglobal `id`を分離する。既存tableのprimary keyは維持し、`todo_key` columnと`(run_id, todo_key)` unique indexを加えるadditive migrationとする。

```ts
canonicalTodoId = stableDigest(runId, todoKey);
```

- canonical IDは既存のTodo ID文字数上限内に収める。
- `TodoDraft`には`todoKey`を追加し、既存の`id`入力は移行期間中だけRun-local keyとして互換正規化する。
- key省略時はUUIDをlocal keyとしてからcanonical化する。
- dependencyは`dependsOnKeys`を正本とし、既存の`dependsOn`入力は移行期間中だけkey参照として互換正規化する。
- tool resultはcanonical `id`とRun-local `todoKey`を両方返す。
- 同じRun、同じTodo keyは同じcanonical IDになり、異なるRun、同じkeyは異なるcanonical IDになる。
- 再計画では`todoKey`を使うため、tool resultのcanonical IDを再度hashする経路を作らない。
- 過去rowは`todo_key = id`でbackfillしてread可能性を維持する。backfill衝突を事前queryで検出し、衝突時はmigrationを停止する。

#### 実装

1. `todo_key` column、backfill、`(run_id, todo_key)` unique indexをbootstrapとDrizzle schemaへ追加する。
2. canonical ID builderをTodo mutation module内の純粋関数として追加する。
3. contract boundaryで`todoKey` / `dependsOnKeys`へ最小限の互換正規化を行う。
4. `replacePlan`のmaterialize前にTodo key mapを構築する。
5. dependencyをTodo keyからcanonical IDへ変換する。terminal Todo参照は同一Runの`todoKey` mapからだけ解決する。
6. duplicate、cycle、terminal reopen判定をcanonical IDに対して行う。
7. unique constraintを一律`TODO_MUTATION_CONFLICT`へ潰さず、可能な範囲でtyped failureに変換する。
8. 同じRun内のCAS、terminal preservation、replanを回帰確認する。

#### 主な対象

- `api/modules/codingAgent/todo/todo-mutation.service.ts`（現`api/services/todo-mutation`実装の移動先）
- `api/modules/codingAgent/todo/types.ts`
- `api/modules/codingAgent/todo/todo-mutation-contract.ts`
- `api/db/schema-task-execution.ts`
- `api/db/bootstrap-task-workflow-tables.ts`
- `tests/services.todo-mutation.test.ts`

#### 受け入れ条件

- 2つのRunがそれぞれ`inspect/api/verify`を使用しても両方成功する。
- tool resultのcanonical IDを個別mutationに使え、再計画は`todoKey`で同じTodoへ戻れる。
- 既存rowのreadと個別mutationがbackfill後も成功する。
- 同じRun内のdependency解決が維持される。
- stale plan revisionではlatest revisionと訂正用guidanceが返り、そのrevisionを使ったreplanが成功する。
- terminal Todoは保存され、replan resultへ現在状態と選択可能なpending Todoが示される。
- Todo ID衝突が`TODO_MUTATION_CONFLICT`として観測されなくなる。

#### 検証コマンド

```bash
bun run test -- tests/services.todo-mutation.test.ts
bun run typecheck
```

### Phase 2: MCP request authorityの固定

#### 実装

1. scoped identityの共通value objectと照合純粋関数だけを`agentsShare`へ置き、Coding Agent MCPへの適用は`codingAgent` moduleが所有する。
2. `todo_list`、`run_check`、`collect_test_inventory`等でrequest contextを先に解決する。
3. 入力IDがcontextと異なる場合は`REQUEST_CONTEXT_MISMATCH`と共通recovery guidance packetを返す。
4. packetへsupplied / authoritativeの差分、正しい再試行引数、元intentを関連付けるidempotency keyを含める。訂正callまではjournalとmutationを変更しない。
5. repository rootはrequest-scoped runから解決し、モデル入力pathとの差があれば正本rootを返す。
6. taskId、runIdを任意指定できるread-only toolは、cross-task参照権限を明示検証する。

#### 主な対象

- `api/modules/codingAgent/mcp/nightworkers-codex-mcp.ts`（現`api/mcp`実装の移動先）
- `api/modules/codingAgent/mcp/nightworkers-codex-mcp-support.ts`（現`api/mcp`実装の移動先）
- `api/modules/agentsShare`のscoped identity contract / 純粋utility
- `api/modules/codingAgent/application/action-execution-journal.ts`（現`api/services/run-control`実装の移動先）
- MCP integration tests

#### 受け入れ条件

- runId省略時はrequest-scoped runを使用する。
- 1文字違い、taskIdの誤指定、別Run IDに対して、差分と正本値を副作用前に返す。
- returned guidanceをそのまま使った訂正callが同じintentとして成功する。
- canonical contextでの正常tool callは従来どおり成功する。
- mismatchによるforeign key errorが発生しない。
- error resultにauthority source、不一致field、recovery引数、satisfaction conditionが構造化される。

#### 検証コマンド

```bash
bun run test -- tests/services.codex-agent-runtime.test.ts tests/services.mcp-tool-bridge.test.ts
bun run test -- tests/services.run-control.test.ts
bun run typecheck
```

### Phase 3: Resume fallback contextのlossless化

#### 実装

1. Codex laneでもconversation State Cardを生成する。
2. provider thread resume前に、NightWorkers正本から共通recovery guidanceを含むfallback context packを構築する。
3. fallback packへ次を含める。
   - Task Goalと現在のユーザー要求
   - 採用済み判断とスコープ境界
   - 直近のユーザーerror全文またはpaging可能な参照
   - 直近Runのfinal candidate、failed tool result、実行command
   - changed filesとsource / diff digest
   - Todo plan summary、current Todo、last failure
   - 正本との差分、未解決事項、次に観測すべきsatisfaction conditions
4. resume成功時はprovider threadへ最新入力だけを追加し、重複context注入を避ける。
5. resume失敗時は同じfallback packをfresh threadの初回入力へ含める。
6. resume errorのraw本文をruntime eventとsession metadataへ保持する。
7. compaction時は採用済み判断、未解決事項、実行済み操作を必須保持する。

#### 主な対象

- `api/modules/codingAgent/application/start-coding-agent-run.ts`（現`api/modules/nightworkers/run-orchestration/start-task-run.ts`内のCoding Agent責務の移動先）
- `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client.ts`
- `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/modules/codingAgent/context/*`
- Agent非依存部分だけを残したconversation context / runtime session port
- Codex resume contract tests

#### 受け入れ条件

- `no rollout found`を発生させてもfresh threadが過去3件のユーザーerrorを参照できる。
- previous final candidate、current Todo、last failureがfallback後も保持される。
- omitted sectionにはdigest、件数、再取得方法がある。
- resume成功時にState Cardが二重注入されない。
- raw resume errorを監査queryで確認できる。

#### 検証コマンド

```bash
bun run test -- tests/services.codex-agent-runtime.test.ts
bun run test -- tests/services.conversation-context.test.ts
bun run test -- tests/services.runtime-session-state.test.ts
```

### Phase 4: 検証結果の構造的正確性

#### NightWorkers側

1. managed command実行shellでpipeline failureを失わないよう`pipefail`を有効にする。
2. command resultへexit code、signal、timed out、stdout / stderr digestを明示する。
3. server起動checkではprocess PID、cwd、port、repository rootを返すread-only診断を利用する。
4. Coding Agent System Contextへ、期待観測、実観測、process identity、exit statusを並べたevidence bundleを基に検証の十分性を判断する手順を追記する。
5. user-reported reproductionをTodo acceptance criteriaへ保持し、再現commandと期待結果を同じTodo contextで参照できるようにする。
6. `run_check`や既存toolは構造化されたraw evidenceを返し、その意味評価と追加検証の選択はCoding Agentが行う。

#### Incident repository側

1. FrontendとAPIのpathを`/api/todos`へ統一するか、server側で末尾slashを明示的に許可する。
2. `GET /api/todos/`と`POST /api/todos/`の期待契約を一方に決め、Frontend、route、API contractを一致させる。
3. 新しい一時DBへmigrationを適用した状態でAPI integration testを実行する。
4. 一覧、作成、編集、完了切替、論理削除、復元をexact pathで確認する。
5. 既存portを使わず、test processが所有するportで検証する。

#### 主な対象

- `api/modules/codingAgent/tools/run-command.ts`（現worker tool実装の移動先）
- `api/modules/codingAgent/context/system-context.ts`
- verification tool contract / tests
- `/Users/y.noguchi/Code/todolist/web/src/views/home-view.tsx`
- `/Users/y.noguchi/Code/todolist/api/routes/todos.route.ts`
- todolist API tests

#### 受け入れ条件

- `false | true`のようなpipelineで各processのstatusがevidence bundleへ現れ、Coding Agentが先行failureを確認できる。
- `curl`の接続結果、HTTP status、response body、pipeline statusが別fieldで提示される。
- test対象processのcwdが登録repository rootと一致する。
- todolistのFrontendが使用するexact pathで全主要操作が成功する。
- 新しいSQLite DBで`no such table: todos`が発生しない。
- `bun run verify`とTodo API integration testの両方が成功する。

#### 検証コマンド

```bash
# NightWorkers
bun run test -- tests/worker-tools
bun run test -- tests/services.codex-agent-runtime.test.ts
bun run typecheck

# todolist
bun run test
bun run verify
```

### Phase 5: Final candidateとcloseoutの保持

#### 実装

1. Todoまたはcompletion preconditionが未充足の場合、共通recovery guidanceを使ったreconciliation packetへ次を含める。
   - precondition codeと現在値
   - latest Todo snapshot
   - prior final candidate
   - current user request digest
   - 未解決Taskを再取得するための参照
   - 完了へ必要なsatisfaction conditions
2. System Contextはpacketを判断材料として提示し、Todo更新、追加検証、回答再生成のどれを次actionにするかはLLMに委ねる。
3. model response candidateをRun eventへrevision付きappend-onlyで保存する。
4. `finalReport`はcompletion precondition通過時のcandidateだけを採用する。
5. reconciliation turnの出力と元candidateを両方保持し、次turnでTask結果とprecondition差分を同時に参照できるようにする。
6. completion controllerはTodo / revision / approvalの構造的不変条件だけを維持し、Task意味の完了を判定しない。

#### 主な対象

- `api/modules/codingAgent/runtime/CodexAgentRuntime.ts`
- Native API runnerのcompletion feedback生成箇所
- `api/modules/codingAgent/application/finalize-controller.ts`（現`api/services/run-control`実装の移動先）
- Task event persistence
- runtime contract tests

#### 受け入れ条件

- file change後に未充足preconditionが見つかっても、次turn入力に元final candidateとreconciliation packetが残る。
- reconciliation後のfinal reportに元Taskの変更、検証、未解決事項が含まれる。
- candidate履歴をevent sequenceで追跡できる。
- provider本文がcandidate revisionとしてそのまま保存される。
- Native API / Codex SDKの両laneで同じcloseout contractになる。

#### 検証コマンド

```bash
bun run test -- tests/services.codex-agent-runtime.test.ts
bun run test -- tests/services.native-api-runner.test.ts
bun run test -- tests/services.run-control.test.ts
```

### Phase 6: 統合回帰、計測、rollout

#### 統合scenario

一つのTaskで次を順に実行する。

1. 初回実装Runで`inspect/api/verify` Todoを使用する。
2. ユーザーがJSON parse errorを追加する。
3. Codex resumeを意図的に`no rollout found`へする。
4. fresh fallbackで過去contextを復元する。
5. 同じTodo keyを使う新Runを開始する。
6. 誤ったrunIdを一度送信し、差分、正本値、訂正callのguidanceを確認した後、訂正callを成功させる。
7. exact-path API checkを失敗させ、Todoへfailureを記録する。
8. sourceを修正し、focused testとfull verifyを実行する。
9. Todoまたはcompletion preconditionの未充足状態を一度作り、reconciliation packetからLLMが復旧する。
10. reconciliation後に元Taskを含むfinal reportを返す。

#### 観測指標

- 初回`replace_plan`成功率
- `TODO_MUTATION_CONFLICT`件数と原因別内訳
- `REQUEST_CONTEXT_MISMATCH`件数
- mismatch guidanceから訂正callが成功した率
- recovery guidance必須fieldの充足率
- Codex resume成功率 / fresh fallback率
- fallback後のState Card included率
- reconciliation packetから追加のhost介入なしで復旧した率
- file change時のcurrent Todo context付与率
- failed verification contextが次actionで参照された率
- final candidate revision数
- 同一ユーザーerrorの再発率

これらの指標からTaskの意味や成功可否を自動分類しない。構造イベントの集計に限定する。

#### Rollout条件

- 全Phaseのtargeted testがgreen。
- `bun run verify`がgreen。
- `bun run check:architecture`がgreen。
- Coding Agent固有実装が`api/mcp`、`api/modules/nightworkers`、他role moduleへ残っていない。
- System Contextとtool manifestの差分が、正本、証拠、差分、復旧参照、satisfaction conditionsの追加として説明できる。
- baselineに存在したtoolとnative commandが引き続き利用できる。
- integration scenarioが3回連続成功。
- 既存Native API / Codex SDKの正常Runに回帰がない。
- dirty worktreeのユーザー変更を上書きしていない。

#### Rollback条件

- Todo migrationまたはidentity変換で既存Runをreadできない。
- scoped MCP toolの正常callを誤ってmismatch扱いし、guidanceからも復旧できない。
- fallback contextがprovider limitを継続超過する。
- candidate保存が同じ本文の無制限重複を起こす。
- source mutationの二重実行またはjournal不整合を検出する。

rollback時もDBやeventを破棄しない。該当Phaseのproduction wiringだけを戻し、取得済みの監査情報を維持する。

## 7. Test Matrix

| Layer         | Scenario                      | Expected                        |
| ------------- | ----------------------------- | ------------------------------- |
| Todo service  | 別Runで同じTodo key           | 両方成功しcanonical IDは異なる  |
| Todo service  | 同じRun、同じTodo keyでreplan | 決定的ID、revision整合          |
| MCP           | runId省略                     | request-scoped runを使用        |
| MCP           | runId不一致                   | 差分、正本値、訂正引数を返す    |
| Journal       | 不一致runId                   | 未実行状態を保ち訂正callへ継続  |
| Codex resume  | rolloutあり                   | thread継続、context重複なし     |
| Codex resume  | rolloutなし                   | fresh threadへState Cardを注入  |
| Context       | token超過                     | digest / paging付きで省略       |
| Guidance      | 任意の復旧経路                | 共通packetの必須fieldを返す     |
| Command       | pipeline先頭失敗              | check失敗                       |
| Process check | 別repoの同一port              | identity mismatchを表示         |
| API           | Frontend exact path           | 全主要操作成功                  |
| Closeout      | precondition未充足            | guidanceとprior candidate保持   |
| Completion    | open Todoあり                 | reconciliation packet、本文保持 |
| Completion    | Todo terminal                 | LLM最終本文を採用               |

## 8. Implementation Todo案

Coding Agentへ実装をhandoffする際は、以下を初期Todoのたたき台とする。最終的なTodo分割、next action、検証方法はCoding Agentが本計画とrepository factを読んで決める。

1. インシデントfixtureと失敗baselineを追加する。
2. Todo keyとRun-scoped canonical IDを分離する。
3. MCP scoped identity authorityを固定する。
4. Codex resume fallback context packを実装する。
5. managed verificationの失敗伝播とprocess identityを補強する。
6. todolistのexact-path不具合とAPI testを修正する。
7. final candidate revisionとcontract feedback保持を実装する。
8. targeted test、full verify、architecture check、統合scenarioを実行する。
9. 差分をreviewし、回帰があれば修正・再検証する。
10. 実装結果、既知の制約、観測指標を報告する。

## 9. 完了条件

本計画は、次のすべてを満たした場合にのみ`completed`へ更新する。

- todolistの主要画面から一覧、追加、編集、完了切替、削除、復元が利用できる。
- 新しいSQLite DBでmigrationが完了し、Todo APIの主要操作が成功する。
- 別Runで同じTodo keyを使用できる。
- modelが別runIdを渡した場合、正本との差分から訂正callへ復旧し、正しいRunだけが更新される。
- Codex resume失敗後も過去errorと実行済み操作を参照できる。
- verification evidence bundleが期待観測、実観測、process identity、各process statusを含み、ユーザー再現条件との一致を説明できる。
- Todo reconciliation後も元Taskの最終報告が残る。
- targeted test、`bun run verify`、`bun run check:architecture`がすべて成功する。
- source、DB、event、Todo、final reportが同じ結果を示す。
