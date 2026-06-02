---
title: Chat-first Agent Workbench 実装計画
targetKind: wiki
priorityGroup: implementation-plan
status: draft
---

# Chat-first Agent Workbench 実装計画

作成日: 2026-06-02

## 目的

`spec/chat_first_agent_workbench_concept.md` のコンセプトを、NightWorkers の現在の実装へ接続できる実装計画に落とし込む。

この計画は、Personal Autonomous Development Workbench の UI と運用単位を作るための計画である。対象は、Project / Session / Queue / Chat / Artifact / Run linkage / contextStill linkage / review linkage であり、agent runtime そのものや Todo Procedure Runtime を置き換えない。

完了時点の状態:

- Project Folder ごとに Session / Task を Processing / Queue / Archive に分類して確認できる。
- Chat は選択中 Project Folder / Session に紐づき、仕様検討、Task Draft、Queue 追加、実行指示、レビュー後の追加依頼を受けられる。
- Session item から、Chat messages、latest Run、Run events、Todo summary、ReviewResult、Artifact refs、contextStill compile snapshot を復元できる。
- 右側 Artifact Pane で Spec / Plan / Diff / Test Result / Review Result / Run Ledger / Context Pack を切り替えて確認できる。
- 進捗率は LLM の自己申告ではなく、Task status、Run status、Todo status、RunEvent、ReviewResult、contextStill eval/candidate status から算出する。
- 初期段階では GitHub PR 投稿、coverage dashboard、画像生成 API、theme editor、browser/computer-use/sandbox/external MCP 拡張は扱わない。

## 現状の実装前提

2026-06-02 時点で、Workbench の一部はすでに存在する。

- `repositories` は既存テーブル名として残っているが、Workbench 上の意味は Git repository ではなく Project Folder である。`localPath` が primary identity であり、Git metadata は任意の付加情報として扱う。
- `tasks` は Session / Task の初期実体として使える。
- `task_runs` は NightWorkers Run の実体であり、`contextSnapshot`、`finalReport`、`finalJudgment`、`diffPatch`、`testResults`、`contextEval` を持つ。Git diff が取れない folder でも、run ledger、test result、file artifact、final report は成立する。
- `task_run_todos` は Run 内部の短期 Todo / milestone を表す。Workbench Queue item の代替にはしない。
- `task_messages` は Task-scoped Chat message の実体である。
- `task_events` は canonical run event を `payloadJson.runEvent` に保存できる。
- `artifacts` は Run-scoped artifact ref の初期実体である。
- frontend には `NightWorkersShell`、`ProjectSidebar`、`ThreadWorkspace`、`ThreadTimeline`、`Composer`、`useNightWorkersWorkspace` がある。

このため、実装は「ゼロから新しい Workbench を作る」のではなく、既存の NightWorkers shell を Chat-first Workbench として締め直す。

## 非目標

- Kanban board の実装。
- Slack 風の汎用 3 カラム shell への作り替え。
- Todo を Queue item として展開すること。
- Conductor Agent に大きなコード変更を直接実行させること。
- external MCP、browser/computer-use、container sandbox、remote runtime の拡張。
- GitHub の issue / PR / review UI を Workbench 内で再実装すること。
- Git repository の存在を Project 作成条件にすること。
- PR への自動投稿。初期は export / artifact 表示まで。
- coverage dashboard、theme editor、画像生成 API、landing page、marketing UI。
- contextStill の知識管理 UI を NightWorkers に複製すること。

## 用語と境界

| Workbench 用語 | 現行実体 | 役割 | 注意 |
| --- | --- | --- | --- |
| Project Folder | `repositories` | local folder / workspace root | Project は UI grouping と safety policy の単位。Git repo でなくてもよい |
| Session / Task | `tasks` | ユーザーが Queue / Archive で追跡する作業単位 | Chat と Run を束ねる外側の単位 |
| Chat | `task_messages` | 仕様検討、指示、レビュー依頼、追加要件の履歴 | message は Task-scoped。Run-scoped message は `runId` を持つ |
| Queue | `tasks.status` + `priority` | 実行待ちの Session / Task | Todo を Queue として扱わない |
| Processing | `tasks.status` / latest `task_runs.status` | 実行中、検証中、レビュー待ちの作業 | Run status と Task status の整合を取る |
| Archive | `tasks.status` or archive marker | 完了/取消/古い Session の折りたたみ領域 | 物理削除ではなく archive を優先する |
| Run | `task_runs` | agent runtime の実行単位 | ledger / replay / review の監査単位 |
| Todo | `task_run_todos` | Run 内部の手順/マイルストーン | Workbench Task の代替にしない |
| Artifact | `artifacts` + Run fields | Spec / Plan / Diff / Test / Review / Ledger / Context の参照 | 初期は Run-scoped、後で Task-scoped summary を足す |
| Review | `review_results` / `TaskRun.reviews` | human/system/agent review | Task status を変える場合も evidence refs を残す |

## 状態モデル

### Session / Task status

Workbench で見せる大分類は、現行 `tasks.status` を正規化して作る。

| UI group | 対応する status | 表示方針 |
| --- | --- | --- |
| Processing | `context_compiling`, `running`, `verifying`, `needs_review`, `needs_human`, `blocked`, `timed_out` | 常時展開し、phase、progress、latest event、review need を表示 |
| Queue | `draft`, `ready`, `queued` | priority 降順。同一 priority なら updated/created 時刻で安定ソート |
| Archive | `completed`, `cancelled`, `failed`, archived marker | 初期は折りたたみ。failed は archived でも原因 badge を残す |

`failed` は Archive に入るが、直近 failure や unresolved review finding がある場合は Processing の下に `Needs attention` として短期表示してもよい。ただし二重所属は API ではなく selector で作る。

### Phase

Session item の phase は raw status 文字列をそのまま出さず、latest Run / Todo / Event / Review から算出する。

| Phase | 主な根拠 |
| --- | --- |
| Analyzing | Task draft 作成中、Run 未作成、最新 user message に対する assistant response 待ち |
| Context Compiling | Task or Run status が `context_compiling`、または contextStill call event が未完了 |
| Queued | Task status が `ready` / `queued` で active Run がない |
| Implementing | latest Run が `running` で Todo type が `code_change` / `documentation` / `investigation` |
| Verifying | Run status が `verifying`、または latest event が `verification.*` |
| Reviewing | Run status が `needs_review`、または ReviewResult 未確定 |
| Improving | ReviewResult が changes requested / follow-up 生成済み |
| Learning | contextStill eval/candidate capture が pending/running |
| Needs Human | Task/Run status が `needs_human` / `blocked` / `timed_out` |

Phase は selector で一元化する。UI component ごとに ad hoc な if 文を増やさない。

### Progress

進捗率は `WorkbenchProgressSnapshot` として API response または frontend selector で計算する。

初期計算:

| Progress | 条件 |
| --- | --- |
| 0 | raw new session / empty prompt |
| 10 | user message persisted |
| 20 | objective / acceptance criteria / task draft が存在 |
| 30 | context snapshot or compiled prompt が存在 |
| 50 | Run started and first meaningful event persisted |
| 65 | TodoList created or implementation event observed |
| 75 | verification event or test result exists |
| 85 | ReviewResult approved or needs_review resolved |
| 95 | contextEval / learning candidate / compile_eval evidence exists |
| 100 | Task completed and archived/done |

実装上は単純な数値だけでなく、次を一緒に返す。

```ts
type WorkbenchProgressSnapshot = {
  percent: number;
  phase: WorkbenchPhase;
  basis: Array<{
    kind:
      | 'task_status'
      | 'run_status'
      | 'todo_status'
      | 'run_event'
      | 'review_result'
      | 'context_eval'
      | 'artifact';
    refId?: string;
    label: string;
  }>;
  blockers: Array<{
    kind: 'needs_human' | 'policy' | 'verification' | 'timeout' | 'review' | 'runtime';
    message: string;
    evidenceRef?: string;
  }>;
};
```

## Artifact model

初期 Artifact Pane は、`artifacts` table と `task_runs` の既存 fields から view model を組み立てる。

```ts
type WorkbenchArtifactKind =
  | 'spec'
  | 'implementation_plan'
  | 'context_pack'
  | 'diff'
  | 'source_preview'
  | 'test_result'
  | 'review_result'
  | 'run_ledger'
  | 'todo_plan'
  | 'final_report'
  | 'pr_reference'
  | 'learning_candidate';

type WorkbenchArtifactRef = {
  id: string;
  taskId: string;
  runId?: string;
  kind: WorkbenchArtifactKind;
  title: string;
  summary?: string;
  source:
    | { type: 'artifact_row'; artifactId: string }
    | { type: 'run_field'; runId: string; field: string }
    | { type: 'task_message'; messageId: string }
    | { type: 'run_event'; eventId: string }
    | { type: 'review_result'; reviewId: string };
  createdAt: string;
  metadata?: Record<string, unknown>;
};
```

初期表示対象:

- Spec Artifact: chat で生成された markdown document message、または `artifacts.kind = spec`。
- Implementation Plan: spec と同じ storage で `kind = implementation_plan`。
- Context Pack: `task_runs.contextSnapshot` と contextStill compile output。
- Code Diff: `task_runs.diffPatch`。
- Test Result: `task_runs.testResults` と verification events。
- Review Result: `reviews` と review evidence refs。
- Run Ledger: `task_events.payloadJson.runEvent` の時系列。
- Todo Plan: `task_run_todos` の seq/status/gate summary。
- Final Report: `task_runs.finalReport`。

Pane は常時表示しない。選択 artifact がある時だけ右 Pane を開き、shell は `sidebar / chat / artifact` の resizable group に切り替える。Artifact が閉じられたら `sidebar / chat` に戻す。

## Chat model

Chat は補助欄ではなく Workbench の主要入力である。初期実装では、既存 `Composer` と `task_messages` を活かして次の intent を扱う。

| Intent | 入力例 | 保存/動作 |
| --- | --- | --- |
| discuss | 改善点を洗い出したい | `task_messages` に user/assistant を保存。Run は作らない |
| draft_spec | このうち A と C を仕様書に落として | assistant markdown artifact を生成。Task status は draft/ready |
| create_task | タスク化して Queue に入れて | title/objective/acceptanceCriteria/priority を更新し `queued` へ |
| run_task | 実行して | `task_runs` を作成し context compile -> runtime へ |
| adjust_running | 実行中タスクに追加要件 | message を保存し、active Run へ event / human note として渡す |
| review_followup | レビュー結果を見て追加修正 | ReviewResult evidence refs を付けた follow-up message / task draft |
| learning_capture | 登録すべき学びを整理して | contextStill candidate draft / compile_eval artifact |

最初から LLM intent classifier を前提にしない。まずは explicit command buttons / slash-like intent / server-side conservative parser で十分にする。

## API 設計

既存 API を壊さず、Workbench 用 read model を足す。

### GET /api/workbench

Project Folder / Session list の初期表示用。

返すもの:

- projects: folder summary。既存 API/type 名に `repository` が残る場合も、表示と仕様上は Project Folder として扱う。
- sessionsByProject: Task summary list。
- each session の `group`、`phase`、`progress`、`latestRunId`、`latestEventSummary`、`reviewNeed`、`artifactCounts`。
- archive count は初期表示で展開しない。

### GET /api/workbench/sessions/:taskId

Session 復元用。

返すもの:

- task。
- messages。
- runs summary。
- latest run detail。
- todos。
- events。
- reviews。
- artifact refs。
- progress snapshot。

`GET /tasks/:id/runs`、`GET /runs/:id`、`GET /tasks/:id/messages` を寄せ集めるだけでも初期実装は可能だが、UI が複雑化する場合はこの read model API を足す。

### POST /api/workbench/sessions

Project Folder-targeted New Session 用。既存 task creation を使いつつ、初期 status は `draft` とする。

### POST /api/workbench/projects

Project Folder 登録用。入力の必須項目は `localPath` と表示名だけにする。Git repository かどうかはサーバー側で検出し、検出できた場合だけ branch / remote / base ref 候補を metadata として返す。

既存 `CreateProjectInput` や API type に `branch` が残っている場合は、Workbench の外部 contract では optional に寄せる。互換性のため DB の `repositories.branch` に default `main` が残っていても、UI はそれを Git 検出済み branch として表示しない。

### POST /api/workbench/sessions/:taskId/messages

Chat message 投稿用。intent が `run_task` でない限り Run は作らない。既存の「prompt submit で即 run」挙動とは分ける。

### POST /api/workbench/sessions/:taskId/queue

Task Draft を Queue に入れる。最低限 `title`、`objective`、`acceptanceCriteria` が空でないことを検証する。

### POST /api/workbench/sessions/:taskId/run

Queued / ready Task を実行する。contextStill compile、TaskRun 作成、runtime start を行う。実行開始前に risk preview / policy check の hook point を残す。Git metadata がない Project Folder では、branch / base ref / PR reference を optional とし、folder path と file evidence を主な作業境界にする。

### PATCH /api/workbench/sessions/:taskId/archive

物理削除ではなく archive marker を付ける。初期 DB に archive field がなければ、まず status `completed/cancelled/failed` の folded view で代用し、後続 migration で `archivedAt` を足す。

## DB / migration 方針

初期 slice では、既存 table だけで実装する。

追加 migration が必要になる条件:

- Archive が物理削除ではなく明示状態として必要になった場合: `tasks.archived_at`。
- Project Folder と Git metadata を明確に分けたい場合: `repositories.git_metadata` nullable 追加、または `project_git_metadata` table。
- Artifact を Task-scoped にしたい場合: `artifacts.task_id` nullable 追加、または `task_artifacts` table。
- Session title / objective の draft version を履歴化したい場合: `task_drafts` table。
- Chat intent を structured に検索したい場合: `task_messages.intent`。
- PR metadata を保存したい場合: `tasks.external_refs` or `task_external_refs`。

追加する場合も、まず read model と UI の痛みを確認してから行う。DB schema を先に広げすぎない。

## UI 設計

### Shell

`NightWorkersShell` は 2 pane から始め、Artifact 選択時だけ 3 pane になる。

- Sidebar: 18-42%。Project / Processing / Queue / Archive。
- Chat: Artifact 非表示時は残り全幅。Artifact 表示時は中央 pane。
- Artifact: 28-36%。最小幅を決め、狭い viewport では drawer に落とす。

既存 `WorkspaceLayoutContext` に `artifactPaneOpen`、`selectedArtifactRef`、3 pane sizes を追加する。

### ProjectSidebar

現在の `ProjectSidebar` は Project Folder の下に Session を単純列挙している。次の順に拡張する。

1. Project Folder ごとに `Processing`、`Queue`、`Archive` の section を出す。
2. Session item は 1 行表示を維持する。
3. item に phase、progress、status dot、badge を追加する。
4. Archive は count だけ表示し、クリック時に展開する。
5. `+ New Session` は Project Folder-targeted draft Session を作るだけで、即 Run しない。

Session item の情報:

- title。
- phase。
- progress percent。
- latest blocker badge。
- context score / test status / PR status / token anomaly は存在するものだけ小さく出す。
- createdAt より updatedAt / latest activity を優先表示する。

### ThreadWorkspace

`ThreadWorkspace` は active Session の Chat を主役にする。

- Header は title、Project Folder、phase、progress、review need を表示。
- Timeline は `task_messages` と important Run events を混ぜて表示する。
- Composer は draft discussion と run command を分ける。初期は button または mode selector で `Discuss` / `Queue` / `Run` を明示する。
- `isAgentWorking` は pending chat submit だけでなく active run status も見る。
- Thinking indicator は latest run event と pending assistant message の両方から判断する。

### ArtifactPane

Artifact Pane は read-only から始める。

Tabs:

- Spec
- Plan
- Diff
- Tests
- Review
- Ledger
- Context
- Todos
- Report

初期実装では、存在しない tab は非表示にする。空 tab を説明文で埋めない。

表示方針:

- Diff は `diffPatch` を monospace で表示。巨大 diff は file summary と lazy render。
- Tests は passed/failed/command/tail を優先。
- Review は verdict、findings、evidence refs、suggested next tasks。
- Ledger は canonical `runEvent` を type / actor / severity / message で dense list。
- Context は contextStill source refs / compile snapshot / eval。
- Todos は seq、status、procedureId、gate result。

## Runtime / event / review 接続

Workbench は runtime の primary truth にならない。primary truth は引き続き `task_runs`、`task_events`、`review_results`、JSONL export/replay である。

必要な event:

- `workbench.session.created`
- `workbench.session.queued`
- `workbench.session.run_requested`
- `workbench.artifact.created`
- `workbench.artifact.selected` は UI-only でよい。DB 保存しない。
- `workbench.review.followup_requested`
- `workbench.learning.capture_requested`

これらは UI 操作 audit が必要なものだけ `task_events` に残す。hover、pane open、tab switch のような UI 操作は ledger に入れない。

ReviewResult 接続:

- ReviewResult は Task status を直接変更しうるが、必ず evidence refs を持つ。
- `suggestedNextTasks` は自動で Queue に入れない。Task Draft として提示し、明示操作で Queue に入れる。
- `agentFollowUps` は Chat に assistant/system message として表示するが、Run は自動開始しない。

contextStill 接続:

- Run 開始時の compile snapshot は Context artifact として参照できる。
- compile_eval は Learning artifact として参照できる。
- learning candidate は自動登録ではなく、draft / explicit approval の流れを維持する。

## 実装フェーズ

### Phase 1: Workbench read model と分類 selector

目的:

- 既存 Project Folder / Task / Run / Todo / Review / Message を Workbench 用 view model に変換する。
- UI component に散らばる status 判定を減らす。

実装:

- `src/modules/nightworkers/workbenchSelectors.ts` を追加。
- `getSessionGroup(task, latestRun)`、`getSessionPhase(...)`、`getSessionProgress(...)`、`getSessionBadges(...)` を作る。
- frontend の `useNightWorkersWorkspace` で sessions に view model を付与するか、`ProjectSidebar` に渡す直前で group 化する。
- test は pure selector unit test を追加する。

受け入れ条件:

- Processing / Queue / Archive の分類が既存 status に対して deterministic。
- progress basis が最低 1 件返る。
- failed / needs_human / blocked / timed_out が見落とされない。

検証:

- `pnpm vitest run tests/<new-selector-test>.test.ts`
- `pnpm typecheck`

### Phase 2: Project Folder / Session / Queue Navigator

目的:

- Sidebar を concept の 1 行 Session list に近づける。
- Project 作成を Git repository 選択ではなく folder 選択として成立させる。

実装:

- `ProjectSidebar` を grouped sections に変更。
- Folder browser の confirm flow は `localPath` と display name で Project を作る。branch 入力や Git remote 入力を必須にしない。
- Git metadata が検出できた Project Folder だけ branch / PR / diff badge を表示する。
- `+ New Session` は draft task 作成だけにする。
- Archive は folded count を標準にする。
- Session item に phase / progress / latest activity / blocker badge を追加。
- 既存 delete action は `Archive session` 表現に寄せる。物理削除のままなら UI 文言で archive と言わない。

受け入れ条件:

- Project Folder ごとに Processing / Queue / Archive が分かれて表示される。
- Git repository ではない folder を登録できる。
- Git metadata がない Project Folder で branch / PR badge が空欄や `main` の偽表示にならない。
- Queue は priority 順。
- Archive が多くても通常表示が重くならない。
- Session item の高さは安定し、title が長くても layout が崩れない。

検証:

- `pnpm test -- ProjectSidebar` がなければ component test を追加。
- Playwright で desktop / narrow viewport の screenshot を確認。

### Phase 3: Chat intent と Task Draft / Queue 導線

目的:

- Chat を「submit = 即 run」だけでなく、discussion / draft / queue / run の入口にする。

実装:

- Composer に mode selector または explicit action buttons を追加する。
- `Discuss` は message 保存のみ。
- `Draft Spec` は assistant markdown artifact / message を作る。
- `Queue` は title/objective/acceptanceCriteria を検証して `queued` にする。
- `Run` は queued/ready task だけ実行する。
- 既存 `submitPrompt` の「active session がなければ作成して即 run」挙動を、mode に応じて分岐する。

受け入れ条件:

- Project Folder-targeted new Session で会話だけを開始できる。
- Queue に入れるまで Run が作られない経路がある。
- Run 開始時は contextStill compile と existing runtime path を使う。
- malformed draft は `needs_human` ではなく user-visible validation error にする。

検証:

- API route test: message only / queue / run の分岐。
- E2E: 新規 Project Folder Session -> discuss -> queue -> run。Git repository ではない temporary folder fixture でも通す。

### Phase 4: Session restore と Chat timeline

目的:

- Session item クリック時に、過去 chat、latest run、events、todos、review、artifact refs を復元する。

実装:

- `GET /api/workbench/sessions/:taskId` を追加するか、既存 queries を hook 内で安定合成する。
- `ThreadTimeline` の mixed timeline を整理し、message と important event の順序を安定化する。
- run terminal event 後も final assistant message / final report が消えないようにする。
- latestRun 依存の WS buffering が Session switch で欠落しないようにする。

受け入れ条件:

- 別 Session へ移動して戻っても messages / run events / todos / review が復元される。
- active run 中の event が duplicate せず、missing もしない。
- final report と ReviewResult が timeline 上で確認できる。

検証:

- realtime merge selector test。
- E2E: active run event -> session switch -> restore。

### Phase 5: Artifact Pane

目的:

- 右 Pane で run evidence と生成物を確認できるようにする。

実装:

- `ArtifactPane`、`ArtifactTabs`、`ArtifactRefList` を追加。
- `WorkbenchArtifactRef` view model を作る。
- `ThreadWorkspace` から artifact を開ける。
- `NightWorkersShell` を Artifact 表示時だけ 3 pane にする。
- 初期 tab は Diff / Tests / Review / Ledger / Context / Todos / Report を優先する。

受け入れ条件:

- Artifact を開くと Chat は中央に残り、右 Pane に evidence が表示される。
- Artifact を閉じると Chat が広がる。
- Run Ledger は canonical runEvent を優先表示する。
- 大きな diff / log で UI が固まらない。

検証:

- component test。
- Playwright screenshot: artifact closed / open / narrow viewport。

### Phase 6: Progress, token KPI, and status evidence

目的:

- Session item と header に、自己申告ではない progress と token KPI を出す。

実装:

- `WorkbenchProgressSnapshot` を API or selector で返す。
- token input/output/total は既存 token telemetry があれば接続し、なければ RunEvent / contextEval に保存されている値だけ表示する。
- `wasted tokens ratio` のような推定値は後続に回す。
- progress hover / detail で basis を表示する。

受け入れ条件:

- progress percent の根拠が表示できる。
- token KPI は missing value を 0 扱いしない。
- contextStill compile の存在が progress / artifact に反映される。

検証:

- selector test。
- Run with missing token telemetry fixture。

### Phase 7: Review / Conductor handoff

目的:

- 完了後の Done 判断、追加タスク、学習登録を Chat-first flow に接続する。

実装:

- ReviewResult Summary を Artifact Pane と Timeline の両方に表示。
- `suggestedNextTasks` から Task Draft を作る明示 action を追加。
- `agentFollowUps` を Chat に表示する。
- Conductor Agent は直接大きな code change をしない前提で、state transition / next action proposal として表示する。
- contextStill learning candidate / compile_eval は Learning artifact として扱う。

受け入れ条件:

- ReviewResult から evidence refs を辿れる。
- suggested next task は自動 Queue されない。
- human が Queue / discard / edit を選べる。
- learning candidate は明示承認なしに登録されない。

検証:

- review result route test。
- E2E: review changes requested -> follow-up draft。

### Phase 8: Persistence hardening and replay readiness

目的:

- Workbench view が live DB だけでなく JSONL export/replay の考え方と矛盾しないようにする。

実装:

- Artifact refs が RunEvent / Run field / ReviewResult / TaskMessage のどれ由来かを明示する。
- Workbench-specific audit events を必要最小限だけ canonical event にする。
- support bundle / imported ledger viewer はまだ作らないが、ArtifactRef source type を import snapshot に拡張できる形にする。
- Archive / artifact task scope / chat intent の migration 必要性を再評価する。

受け入れ条件:

- Run Ledger artifact から progress / review / final report の根拠を説明できる。
- UI-only state が ledger を汚していない。
- replay/import の後続実装に必要な missing contract が文書化されている。

検証:

- `pnpm vitest run tests/services.run-events-jsonl.test.ts tests/services.run-events-replay.test.ts`
- `pnpm verify`

## 実装順の推奨

最初の PR は Phase 1 だけにする。理由は、分類 selector がないまま Sidebar / Chat / Artifact を広げると status 判定が component に散らばるため。

推奨 slice:

1. Phase 1: read model / selector。
2. Phase 2: Sidebar grouping。
3. Phase 3: Chat intent / draft / queue / run split。
4. Phase 4: Session restore。
5. Phase 5: Artifact Pane。
6. Phase 6: progress / token KPI。
7. Phase 7: review / conductor handoff。
8. Phase 8: persistence / replay readiness。

Phase 2 と Phase 3 は UI 変更が大きいため、別 PR にする。Phase 5 は visual regression を必須にする。

## リスクと対策

| リスク | 起きること | 対策 |
| --- | --- | --- |
| Task と Todo の境界が崩れる | Todo が Queue item になり、運用単位が細かくなりすぎる | Queue は Task のみ。Todo は Artifact / detail で表示 |
| submit = run のまま残る | Chat-first ではなく run-first UI になる | Composer mode / explicit action を導入 |
| Artifact が DB schema 先行で肥大化する | migration が増え、replay とズレる | 初期は Run fields + existing artifacts から view model |
| status 判定が散らばる | UI ごとに矛盾した phase/progress になる | selector / read model に集約 |
| Review follow-up が自動実行される | agent が勝手に scope を広げる | follow-up は draft まで。Queue/Run は明示操作 |
| contextStill learning が自動登録される | memory 汚染が起きる | candidate draft + approval gate |
| 3 pane が狭い viewport で壊れる | Chat / Artifact が読めない | narrow viewport は Artifact drawer |
| token KPI が推測値になる | 数値への信頼が落ちる | missing は missing と表示し、実測のみ使う |

## 完了条件

- `spec/chat_first_agent_workbench_concept.md` の MVP 12 項目のうち、GitHub PR 連携以外の初期導線が NightWorkers shell 上で操作できる。
- Project Folder-targeted New Session から、discussion -> draft -> queue -> run -> review -> follow-up draft までの一連の流れが E2E で通る。
- Git repository ではない folder を Project として登録し、少なくとも discuss / draft / queue / run ledger / final report が成立する。
- Session item から latest Run / Todo / Review / Artifact / Context を復元できる。
- Processing / Queue / Archive が Task 単位で表示され、Todo が Queue に混ざらない。
- Progress は evidence basis を持ち、LLM 自己申告値だけに依存しない。
- Artifact Pane は Diff / Tests / Review / Ledger / Context / Todos / Report を表示できる。
- ReviewResult と contextStill learning candidate は自動実行/自動登録ではなく、明示操作で次に進む。
- `pnpm verify` が通る。

## 後続候補へ回すもの

以下は `spec/future-implementation-candidates.md` の領域であり、この計画では実装しない。

- Browser / Computer-Use Outcome Harness。
- Sandbox Runtime E2E。
- Imported Run Ledger Viewer / Support Bundle Import。
- Capability-Based External MCP Tool Model。
- Scheduled / Long-Running Agent Runs。
- Multi-Run Campaign / Task Graph。
- Remote / Headless Runtime Adapter。
- Golden Task Suite。
- Local Model / Offline Fallback Lane。

ただし、Artifact source、RunEvent taxonomy、ReviewResult evidence refs、contextStill snapshot は、これらの後続候補が後から接続できるように contract を壊さない。
