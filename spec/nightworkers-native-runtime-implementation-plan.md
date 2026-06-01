# NightWorkers Native Runtime 実装計画

作成日: 2026-05-31

## 目的

`plan.md` のコンセプトを、現行リポジトリに対して順に実装できる計画へ落とし込む。対象は「OpenHands を主経路にしない、local-first の supervisor-worker 実行基盤」であり、最初の成果は 1 つのローカルリポジトリの小さなコーディングタスクを、イベント台帳・差分・検証結果つきでレビューできる状態にすること。

この計画は実装順、変更ファイル、SQLite/libSQL schema、API/UI/テストの受け入れ条件を明示する。OpenHands は参照実装または将来の外部 runner adapter として扱い、MVP の実行経路から外す。

## 現状整理

現行コードから確認できる事実:

- バックエンドは Hono + Drizzle + SQLite/libSQL。`api/db/client.ts` は `@libsql/client`、`api/db/schema.ts` は `drizzle-orm/sqlite-core` を使う。MVP の DB 前提は SQLite/libSQL に固定する。
- NightWorkers ドメインは既に `api/modules/nightworkers/` にあり、Repository / Task / TaskRun / TaskEvent の CRUD と run 開始 API を持つ。
- 現在の run 実行は `api/services/runner/OpenHandsProcessRunner.ts` に依存している。これは `plan.md` の「native worker を主経路にする」方針と衝突する。
- UI は `src/routes/index.tsx`、`src/routes/repositories.tsx`、`src/routes/tasks.$id.tsx` にあり、タスク作成、実行、ログ、diff 表示の骨格はある。ただし表示文言と状態モデルは OpenHands runner 前提が残る。
- contextStill MCP client は `api/services/mcp-client.ts` にあるが、呼び出し引数と結果保存は薄い。実装前に NightWorkers 側の adapter contract とテスト用 mock を固める必要がある。
- 既存 SQLite schema には `task_runs` / `task_events` がある。`plan.md` の `runs` / `run_events` へ即リネームするより、MVP では物理テーブル名を維持しつつ Run / RunEvent として意味を拡張する方が安全。

## データベース前提

NightWorkers は local-first の単一ユーザー・単一マシン利用を先に成立させるため、MVP は SQLite/libSQL 前提で実装する。他 DB 互換性や移行経路は MVP の設計軸にしない。

SQLite 前提で守ること:

- run event は append-heavy なので、`task_events(task_run_id, seq)` の index と run 内の単調増加 `seq` を持つ。
- artifact 本体は DB に詰めず、ファイル保存 + `artifacts` の metadata/path で参照する。
- DB 固有処理は repository 層に閉じ込めるが、抽象化の目的は読みやすさとテスト容易性であり、別 DB への移行準備ではない。
- 複数 worker の高頻度並列書き込みは MVP の非目標とする。

## MVP の範囲

MVP で実現すること:

- ローカルリポジトリを登録できる。
- タスクに objective と acceptance criteria を設定できる。
- run 開始時に contextStill から context snapshot を取得し、run に保存できる。
- native local worker が `search_files`、`read_file`、`apply_patch`、`run_command`、`git_status`、`git_diff` を実行できる。
- すべての tool call、tool result、supervisor decision、状態遷移を run event として保存できる。
- supervisor が worker event を読んで少なくとも 1 回は次の指示を生成できる。
- 検証コマンド、diff、final report を UI でレビューできる。
- 人間が `completed` / `needs_follow_up` / `cancelled` を選べる。
- run 後に `compile_eval` を送り、必要に応じて reusable candidate を contextStill に登録できる。

MVP でやらないこと:

- OpenHands を主 runtime として使うこと。
- PR 作成、merge、deploy、publish など外部副作用。
- browser automation。
- multi-agent 並列実行。
- deep sandbox / container isolation。
- 汎用 chat UI framework の導入。
- contextStill の内部データモデルのコピー。

## 実装方針

既存の Hono module 構成は維持する。NightWorkers の中核は次の境界で分ける。

| 境界 | 追加または変更する場所 | 役割 |
|---|---|---|
| Domain API | `api/modules/nightworkers/` | repositories / tasks / runs / events / artifacts の API と業務ロジック |
| Worker tools | `api/services/worker-tools/` | workspace read/search/edit/command/git を安全に実行する native tools |
| Runner | `api/services/runner/` | worker tools を使って run を進め、event を emit する runtime |
| Supervisor | `api/services/supervisor/` | context、run state、events から次の worker instruction と terminal state を決める |
| contextStill adapter | `api/services/context-still/` | MCP tool contract を NightWorkers 内部 contract に閉じ込める |
| Ledger | `task_runs` / `task_events` / `artifacts` | 実行の信頼できる事実を保存する |
| UI | `src/routes/` + `src/modules/nightworkers/` | run ledger を conversation/timeline として表示する |

OpenHands 依存は削除ではなく退避から始める。`OpenHandsProcessRunner` は `api/services/runner/adapters/OpenHandsRunnerAdapter.ts` へ移動できる形にし、MVP の default runner は `NativeLocalRunner` にする。

## Phase 0: 方針と既存表現の整合

目的: 実行前提を OpenHands wrapper から native runtime に切り替える準備をする。

変更候補:

- `package.json`
  - description から `for OpenHands` 前提を外す。
  - 未使用の DB client 依存が残っていれば外す。
- `README.md`
  - DB 記述とセットアップ手順を SQLite/libSQL 前提に合わせる。
  - DB container 起動を前提にしない。
- `docker-compose.yml`
  - DB container は不要として扱う。
  - NightWorkers の位置付けを「OpenHands wrapper」ではなく「local-first supervisor-worker runtime」にする。
- `src/routes/tasks.$id.tsx`
  - `Headless OpenHands Process Runner Active` などの文言を `Native Local Worker` 前提へ変更する。
- `api/services/runner/OpenHandsProcessRunner.ts`
  - default import されない adapter へ移す準備をする。

受け入れ条件:

- OpenHands がプロダクト説明や primary runtime として出てこない。
- 既存 UI と API は壊さず起動できる。
- この phase では runtime 挙動を大きく変えない。

## Phase 1: Run Ledger の拡張

目的: worker tool と supervisor decision を保存できる台帳を先に作る。実行ロジックより台帳を優先する。

DB 変更:

- `repositories`
  - 既存: `name`, `localPath`, `branch`, `safetyPolicy`
  - 追加: `allowed` boolean、`defaultBranch` 互換フィールドまたは既存 `branch` の意味定義
  - `safetyPolicy` に `allowedPaths`, `deniedPaths`, `blockedCommands`, `maxCommandSeconds`, `requireReadBeforeEdit` を追加
- `tasks`
  - 既存 `title` は UI 表示用として維持
  - 追加: `objective`, `acceptanceCriteria`, `priority`, `createdBy`
  - status enum を `draft`, `ready`, `context_compiling`, `queued`, `running`, `verifying`, `needs_review`, `completed`, `blocked`, `failed`, `timed_out`, `cancelled`, `needs_human` に固定
- `task_runs`
  - 追加: `repositoryId`, `workerKind`, `baseRef`, `worktreePath`, `timeoutSeconds`, `contextSnapshot`, `summary`, `finalReport`, `finishedAt`
  - 既存 `endedAt` は `finishedAt` に寄せるか、互換 alias として扱う
  - status enum を task status と別に定義する
- `task_events`
  - 追加: `seq`, `actor`, `eventType`, `payloadJson`, `createdAt`
  - 既存 `type`, `message`, `timestamp` は互換表示用に残すか migration で `eventType`, `createdAt` に寄せる
- 新規 `artifacts`
  - `id`, `runId`, `kind`, `path`, `metadataJson`, `createdAt`

変更ファイル:

- `api/db/schema.ts`
- `shared/schemas/nightworkers.schema.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `drizzle/migrations/*`

API 方針:

- `POST /api/tasks` は `title` に加えて `objective` と `acceptanceCriteria` を受け取る。
- `POST /api/tasks/:id/run` は run を作るだけでなく、最初の `state_change` と `context_compile_requested` event を保存する。
- `GET /api/runs/:id` は run 本体、events、artifacts をまとめて返す。
- `GET /api/tasks/:id/runs` は新しい `startedAt` / `finishedAt` / `status` を返す。

テスト:

- repository/service の CRUD と status transition。
- run event の `seq` が run 内で単調増加すること。
- API response schema が shared schema と一致すること。
- migration 後に既存 seed / health test が壊れないこと。

受け入れ条件:

- run 開始直後に DB だけで「何が始まったか」を追える。
- event payload は JSON として保存され、UI が型ごとに分岐できる。
- OpenHands runner を起動しなくても run ledger の作成をテストできる。

## Phase 2: Native Worker Tool Layer

目的: worker hot path を MCP や OpenHands から切り離し、NightWorkers が境界・出力・台帳を制御する。

新規ディレクトリ:

- `api/services/worker-tools/`

追加する contract:

```ts
type WorkerToolResult<TPayload> = {
  ok: boolean;
  toolName: string;
  startedAt: string;
  finishedAt: string;
  payload: TPayload;
  error?: {
    code: string;
    message: string;
  };
  artifactIds?: string[];
};
```

実装する tools:

- `read_file`
  - absolute / repo-relative path を受ける。
  - workspace boundary を強制する。
  - line range をサポートする。
  - line-numbered text を返す。
  - 大きいファイルは truncation metadata を返す。
- `search_files`
  - `rg` を優先して呼ぶ。
  - query, glob, maxResults, caseSensitive を受ける。
  - path, line, excerpt を返す。
- `apply_patch`
  - unified patch を最初の入力形式にする。
  - workspace boundary と allowed paths を強制する。
  - target file が同一 run で read 済みでない場合は拒否する。
  - changed files と diff summary を返す。
- `run_command`
  - cwd を repository root または許可された subdir に固定する。
  - timeout と output truncation を持つ。
  - command を `read_only`, `build_test`, `write`, `destructive`, `networked` に分類する。
  - destructive / external side effect は拒否または `needs_human` にする。
- `git_status`
  - branch, upstream, short status, dirty, untracked を返す。
  - user-owned dirty file を編集前に検出する。
- `git_diff`
  - summary と file-level diff artifact を作る。
  - secret redaction hook を通す。
- `run_verification`
  - `run_command` の薄い wrapper として開始する。
  - command, reason, exitCode, classification を保存する。

変更ファイル:

- `api/services/worker-tools/path-policy.ts`
- `api/services/worker-tools/command-policy.ts`
- `api/services/worker-tools/read-file.ts`
- `api/services/worker-tools/search-files.ts`
- `api/services/worker-tools/apply-patch.ts`
- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/git.ts`
- `api/services/worker-tools/run-verification.ts`
- `api/services/worker-tools/index.ts`

テスト:

- path traversal を拒否する。
- symlink で workspace 外へ出るケースを拒否する。
- `rm -rf`, `git reset --hard`, `git checkout --`, `npm publish`, `gh pr merge` を destructive と判定する。
- read-before-edit が有効な時、未読ファイルへの patch を拒否する。
- `rg` が存在しない場合の fallback または明示 error が安定している。
- stdout/stderr が長い場合に preview と artifact に分離される。

受け入れ条件:

- Worker tools 単体で temp repository に対して read/search/patch/test/diff ができる。
- すべての tool 実行が run event と artifact に保存できる。
- shell write trick に依存せず、patch-first で編集できる。

## Phase 3: NativeLocalRunner

目的: OpenHands process の代わりに、NightWorkers 内の worker tools を呼ぶ runner を追加する。

変更方針:

- `api/services/runner/types.ts` を runner adapter 共通 contract に拡張する。
- `NativeLocalRunner` を追加する。
- `OpenHandsProcessRunner` は optional adapter として残すが default から外す。
- `nightworkers.service.ts` の `startTaskRun` は `workerKind` で runner を選ぶ。

runner interface:

```ts
interface Runner {
  start(run: RunContext): Promise<void>;
  sendInstruction(runId: string, instruction: WorkerInstruction): Promise<void>;
  observe(runId: string): Promise<RunObservation>;
  stop(runId: string, reason: string): Promise<void>;
  collectArtifacts(runId: string): Promise<Artifact[]>;
}
```

最初の `NativeLocalRunner` は LLM worker を直接賢くするより、明示 instruction を tool sequence に落とす実装から始める。

初期 instruction types:

- `inspect_repository`
- `read_targets`
- `apply_patch`
- `run_verification`
- `collect_diff`
- `write_final_report`
- `stop`

テスト:

- temp git repo で `inspect_repository` が status event を作る。
- `read_targets` が read events を作る。
- `apply_patch` が changed files と diff event を作る。
- timeout で run status が `timed_out` になる。
- stop で child process が残らない。

受け入れ条件:

- `POST /api/tasks/:id/run` が OpenHands なしで run を完了または `needs_review` に進められる。
- run の成否に関係なく final event と artifact collection が保存される。
- `git_diff` が UI で表示できる形式で返る。

## Phase 4: contextStill Adapter

目的: contextStill 依存を supervisor-only adapter に閉じ込め、runtime hot path と分離する。

新規ディレクトリ:

- `api/services/context-still/`

実装:

- `ContextStillClient`
  - transport config を env から読む。
  - connect / disconnect / callTool を管理する。
  - tool unavailable 時は typed degraded result を返す。
- `compileContext`
  - repository metadata、task objective、acceptance criteria を入力にする。
  - context snapshot と source metadata を run に保存する。
- `evaluateContext`
  - run final report、verification result、supervisor summary から `compile_eval` を送る。
- `writeCheckpoint`
  - blocked / risky / long-running run の checkpoint を Goal Room に保存する。
- `registerLessons`
  - human-approved candidate だけ登録する。

変更ファイル:

- `api/services/mcp-client.ts` は直接利用をやめ、compat wrapper か削除候補にする。
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/db/schema.ts`
- `shared/schemas/nightworkers.schema.ts`

テスト:

- MCP unavailable 時に task run が即失敗せず、context event が degraded になる。
- context result が空でも worker run は task objective を使って進められる。
- `compile_eval` の失敗は run completion を巻き戻さない。

受け入れ条件:

- contextStill が止まっていても NightWorkers の native worker は起動できる。
- contextStill の成功/失敗/空結果が event と run summary に残る。
- worker tool は contextStill tool を直接呼ばない。

## Phase 5: Supervisor Loop

目的: worker event を読んで、次の instruction と terminal state を決める supervisor を実装する。

新規ディレクトリ:

- `api/services/supervisor/`

構成:

- `supervisor-context.ts`
  - task objective、acceptance criteria、repo policy、context snapshot、current events を prompt/context に組み立てる。
- `supervisor-decision.ts`
  - decision schema を Zod で定義する。
- `supervisor-loop.ts`
  - phase: `observe`, `plan`, `act`, `verify`, `report`
  - max iterations、max tool calls、timeout を管理する。
- `llm-provider.ts`
  - supervisor LLM provider の薄い adapter。最初は 1 provider でよいが、返り値は typed decision に固定する。

decision schema:

```ts
type SupervisorDecision = {
  phase: 'observe' | 'plan' | 'act' | 'verify' | 'report' | 'stop';
  instruction: string;
  rationale: string;
  expectedEvidence: string[];
  terminalState?: 'needs_review' | 'completed' | 'blocked' | 'failed' | 'needs_human';
  riskLevel: 'low' | 'medium' | 'high';
};
```

停止条件:

- acceptance criteria を満たす verification がある。
- 同じ失敗が 2 回連続する。
- destructive action が必要になった。
- policy boundary に触れた。
- context / task requirement が曖昧で実装判断が危険。
- timeout または tool budget を超えた。

テスト:

- decision parser が不正 JSON を拒否し、safe fallback を返す。
- loop detection が同じ command failure を検出する。
- high risk decision が `needs_human` に遷移する。
- verification failure 後に supervisor が追加 inspection または blocked を選ぶ。

受け入れ条件:

- run event に `supervisor_decision` が保存される。
- worker に丸投げせず、supervisor が phase と次 instruction を制御する。
- terminal state の理由が final report に含まれる。

## Phase 6: Ledger-First UI

目的: 既存 dashboard を、run ledger を読む Codex-style session view に寄せる。

変更ファイル:

- `src/routes/index.tsx`
- `src/routes/repositories.tsx`
- `src/routes/tasks.$id.tsx`
- `src/modules/nightworkers/components/*`
- `src/modules/nightworkers/hooks/*`
- `src/modules/nightworkers/repositories/*`

UI 構成:

- 左ペイン
  - repository list
  - task list
  - latest run status
  - dirty / needs_review / blocked badges
- 右ペイン
  - task objective
  - acceptance criteria
  - event timeline
  - collapsible tool call blocks
  - command output preview
  - changed files
  - diff view
  - final report
  - review actions

event rendering:

- `human_message`
- `context_snapshot`
- `supervisor_decision`
- `worker_instruction`
- `tool_call`
- `tool_result`
- `verification_result`
- `diff_summary`
- `state_change`
- `final_report`
- `error`

review actions:

- `Mark completed`
- `Request follow-up`
- `Cancel run`
- `Accept risk`

テスト:

- task 作成フォームが objective / acceptance criteria を送る。
- run timeline が event type ごとに表示される。
- long command output が UI を壊さず折りたたまれる。
- diff がない run では明確に empty state を表示する。

受け入れ条件:

- UI は OpenHands console ではなく NightWorkers run ledger を表示する。
- run の失敗理由、実行コマンド、差分、検証結果、次の人間判断が 1 画面で分かる。
- UI state は event ledger から復元でき、frontend 独自の会話状態に依存しない。

## Phase 7: Review And Learning Loop

目的: 完了後に人間が判断し、学習候補だけを contextStill に戻す。

実装:

- `POST /api/runs/:id/review`
  - action: `complete`, `request_follow_up`, `cancel`, `accept_risk`
  - note
  - selected lesson candidate ids
- `POST /api/runs/:id/lessons`
  - final report と events から候補を作る。
  - human approval なしでは `register_candidate` しない。
- `compile_eval`
  - run 完了時に自動送信する。
  - context unavailable / failed の場合は event に degraded として残す。

テスト:

- review action が task/run status を正しく遷移する。
- selected candidate だけ contextStill に送られる。
- contextStill 送信失敗は review action を失敗させない。

受け入れ条件:

- run が `needs_review` で止まり、人間判断後に `completed` または follow-up へ進む。
- context usefulness と reusable lessons が run に紐づく。
- 学習登録は自動暴走せず、人間の選択を必要とする。

## 実装順序

1. Phase 0 で文言と metadata を native runtime 方針に合わせる。
2. Phase 1 で DB と API schema を拡張し、run ledger を OpenHands なしで作れるようにする。
3. Phase 2 で worker tools を単体テストつきで追加する。
4. Phase 3 で `NativeLocalRunner` を default にし、最小 run を完了できるようにする。
5. Phase 4 で contextStill adapter を supervisor-only に切り出す。
6. Phase 5 で supervisor loop を追加し、少なくとも 1 回の adaptive instruction を event 化する。
7. Phase 6 で UI を ledger-first に作り替える。
8. Phase 7 で review と learning loop を足す。
9. OpenHands adapter は native run が安定した後、同じ event contract を満たせる場合だけ追加する。

## 最初の vertical slice

最初に実装する最小 slice:

1. `task_runs` に `repositoryId`, `workerKind`, `contextSnapshot`, `summary`, `finalReport` を追加する。
2. `task_events` に `seq`, `actor`, `eventType`, `payloadJson` を追加する。
3. `artifacts` table を追加する。
4. `git_status`, `search_files`, `read_file`, `run_command`, `git_diff` を実装する。
5. `NativeLocalRunner` で次を固定順に実行する。
   - context compile
   - git status
   - repository search/read
   - verification command なしなら `git diff --stat` 相当まで
   - final report
6. UI で timeline と diff を表示する。

この slice では自動 patch はまだ必須にしない。まず「観測、台帳、表示」が end-to-end で成立することを確認してから、`apply_patch` と supervisor loop を加える。

## 検証コマンド

各 phase の最低検証:

```bash
pnpm typecheck
pnpm lint
pnpm test run
```

DB schema を変更した phase:

```bash
pnpm db:generate
pnpm db:migrate
```

UI を変更した phase:

```bash
pnpm test:e2e:smoke
```

Design System の新規 component を追加した場合:

```bash
pnpm -C designSystem test run
pnpm -C designSystem type-check
```

## リスクと対策

| リスク | 対策 |
|---|---|
| OpenHands 依存が service 層に残り続ける | runner selection を `workerKind` に集約し、default を `native-local-worker` に固定する |
| event ledger が後付けになり実行を説明できない | tool 実装より先に event schema と emitter を作る |
| contextStill の MCP contract 変更で run が止まる | adapter を typed degraded result にし、worker hot path から分離する |
| destructive command が実行される | command classifier と human gate を `run_command` の内側に置く |
| workspace 外編集 | path canonicalization と symlink 解決を全 tool の入口で共通化する |
| user-owned dirty worktree を上書きする | run 開始時と patch 前に `git_status` を保存し、未承認 dirty file への編集を拒否する |
| prompt injection | 外部 fetched text と file content を instruction として扱わない worker policy を system context に入れる |
| log に secret が残る | command output と diff artifact の保存前に redaction hook を通す |
| UI が frontend 独自状態に寄る | run event を唯一の表示 source にし、timeline を API から復元する |

## MVP 完了条件

MVP は次を満たした時点で完了とする。

- OpenHands を起動せずに `POST /api/tasks/:id/run` が native local worker run を作成する。
- run ledger に context snapshot、supervisor decision、worker tool events、verification result、diff summary、final report が保存される。
- UI で run timeline、command output、changed files、diff、final report を確認できる。
- destructive action は自動実行されず `needs_human` になる。
- dirty worktree に対して編集前 warning または block が発生する。
- `compile_eval` が成功または degraded event として記録される。
- `pnpm typecheck`, `pnpm lint`, `pnpm test run` が通る。

## 後続候補

MVP 後に検討する項目:

- OpenHands / Codex CLI / OpenCode adapter。
- browser tool。
- container sandbox。
- GitHub PR 作成。
- scheduled unattended runs。
- run artifact の全文検索。
- large timeline 向け virtualization。
- contextStill への reusable lesson 候補 UI。
