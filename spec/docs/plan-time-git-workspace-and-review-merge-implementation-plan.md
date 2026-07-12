# Plan 時 Git Workspace 割当・Review Merge 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-07-12
- Last reviewed: 2026-07-12
- Implementation status: `not-started`
- Parent concepts:
  - `spec/archive/plan-mode-concept.md`
  - `spec/archive/worktree-management-implementation-plan.md`
  - `spec/archive/review-auto-closeout-commit-push-implementation-plan.md`
  - `spec/archive/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`
- Target runtime span: Plan review pass から専用 branch / worktree の確保、Implementation Queue release、Review Mode commit、明示的な merge 判断まで
- Target domains:
  - `api/modules/missionPilot`
  - `api/modules/queue`
  - `api/modules/gitworktree`
  - `api/modules/nightworkers`
  - `api/services/worker-tools`
  - `src/modules/gitworktree`
  - `src/modules/nightworkers`
  - `shared/schemas`

この文書を、NightWorkers の実装 Task を Plan 確定時に専用 Git branch / worktree へ割り当て、Review Mode でその branch に commit し、Plan 時に固定した target branch への merge を明示判断するための実装正本とする。

既存 Git Project と、starter / template import 後に Git 初期化される Project は、実装開始前に最終的に同じ Git workspace 契約へ収束させる。ExecutionQueue の並列数だけ Task を動かしても、同じ作業 directory、index、HEAD を共有させない。

## 1. 問題

### 1.1 Queue の並列性と作業 root が一致していない

NightWorkers は `implementation_queue_settings.processor_count` に従って複数 Task を並列実行できる。一方、Task に `worktreePath` がない場合、Run は `repositories.localPath` を実行 root にする。

同一 Project の複数実装 Task がベース worktree を共有すると、次が混線する。

- file edit と未追跡ファイル。
- Git index、HEAD、branch、diff、status。
- Test / verify の生成物。
- Review Mode の ownership 判定と commit 対象。
- 片方の Task が観測する baseline と、もう片方の Task が変更した状態。

Queue の processor slot が分離されていても、Git workspace が分離されていなければ安全な並列実装にはならない。

### 1.2 現在の worktree は任意選択である

現行実装には次の基盤がある。

- Project Detail の Worktree tab。
- new branch / existing branch からの worktree 作成。
- `tasks.worktree_path` と `task_runs.worktree_path`。
- Run 開始時の worktree 再検証。
- dirty / conflicted / in-use / pending closeout を考慮した削除 blocker。
- Review Mode で実行 root に対する commit / push。

ただし、Worktree tab から選択した worktree に Task を結び付ける任意導線であり、Plan 完了時に必ず専用 workspace を割り当てる契約ではない。ベース worktree の Task 実行も残っている。

### 1.3 merge target が Task に固定されていない

`repositories.branch` は既定値 `main` を持つが、現在の repository update API は branch を更新できず、Review closeout も target branch を扱わない。

Review Mode で毎回その場の branch 名から merge target を推測すると、Project の通常運用と異なる branch へ統合する事故が起きる。Project の既定 target が後から変わった場合、既に Plan 済みの Task の統合先まで暗黙に変化する危険もある。

### 1.4 commit / push と merge 判断が分離されていない

現行 `nightworkers.git-closeout.service.ts` は Review evidence を確認した後、run-owned paths を commit し、upstream があれば push できる。target branch との差分、mergeability、target HEAD の更新、merge strategy、統合結果は永続化しない。

また、commit 成功時点で Queue entry を完了させるため、Git closeout の「実装 branch を確定した」と「target branch へ統合した」が同じ完了概念に見えやすい。

### 1.5 template import は Git 初期化前に branch を作れない

`import_project` の starter/template 経路は materialize 後に `inspectAndInitializeImportedProject()` を呼び、Git init と baseline commit を作成する。空 Project では Plan 確定時点にまだ `HEAD` が存在しない場合があるため、既存 Git Project と同じタイミングで直ちに `git worktree add -b` は実行できない。

この差は例外的にベース worktree で実装を続ける理由にはしない。template materialization / Git baseline 作成を pre-implementation bootstrap として分離し、baseline commit 作成直後に専用 branch / worktree を確保してから通常 Implementation Run を開始する必要がある。

## 2. 目的

次の lifecycle を canonical flow とする。

```text
Plan Mode
  -> latest plan review pass
  -> Project の既定 merge target を Task snapshot へ固定
  -> held Queue entry を作成 (claim_ready=false)
  -> Git workspace allocation を永続化
  -> [既存 Git] target HEAD から専用 branch / worktree を作成
  -> [未 materialized template] bootstrap -> baseline commit -> 専用 branch / worktree を作成
  -> branch / path / base SHA を再検証
  -> Queue entry を release (claim_ready=true)
  -> Implementation Run
  -> Test Mode
  -> Review Mode
  -> run-owned paths を専用 branch に commit
  -> target branch / target HEAD / mergeability を再評価
  -> 利用者が merge / defer / rework を明示判断
  -> merge 成功時だけ統合済みとして記録
```

## 3. 成功条件

1. 新規の実装 Task は、Plan review pass 後かつ Queue claim 前に専用 branch / worktree を持つ。
2. Plan Mode を開いただけ、Questionnaire が未完了、plan review が未通過の状態では branch / worktree を作らない。
3. 同じ Task への重複 handoff は同じ Git workspace allocation へ収束する。
4. 同一 repository 内の2つの Task が同じ source branch または worktree path を予約できない。
5. `claim_ready=true` になる前に、Git worktree、Task projection、allocation record、handoff evidence が一致する。
6. Run 開始時に allocation の branch / path / base SHA を再検証し、不一致なら実装を開始しない。
7. worker には専用 worktree root だけを渡し、decision 用 temporary directory やベース worktree を実装成功の証拠にしない。
8. Project Detail > Worktree で既定 merge target を表示・変更できる。
9. 既定 merge target の保存前に local branch の実在と Git ref format を server-side で検証する。
10. Task は Plan 確定時の target branch と base SHA を snapshot として保持する。
11. Project の既定 target を変更しても、既存 Task の target は暗黙に変わらない。
12. Review Mode は source branch、固定 target branch、Plan 時 base SHA、現在の target HEAD を常時表示する。
13. Review Mode の commit は専用 source branch にだけ作成される。
14. merge source は branch 名の可変 HEAD ではなく、Review 済み `commitSha` に固定する。
15. merge 実行直前に target HEAD を比較し、preview 後に進んでいれば mergeability を再評価する。
16. target worktree が dirty、conflicted、in-use、status unavailable の場合は merge mutation を行わない。
17. merge conflict は target worktree を clean な開始状態へ戻し、`merge_conflicted` として可視化する。
18. `merge_commit`、`squash`、`fast_forward_only` の3 strategy を同じ typed contract で扱う。
19. merge は自動実行せず、Review Mode の明示判断を必須にする。
20. `defer` は source commit / worktree を保持し、統合待ちとして再開可能にする。
21. template import は baseline commit 作成後、通常実装を始める前に専用 workspace へ切り替わる。
22. API process 再起動後、held handoff と provisioning record を再検証して release または attention へ収束できる。
23. migration 前から running の Task は現在の root で完走でき、新規契約へ途中移動しない。
24. Project Detail、Plan Status、Queue、Review Mode に同じ workspace / target 状態が表示される。
25. focused tests、migration test、typecheck、Biome、docs check、repo verify が成功する。

## 4. Locked Decisions

1. branch / worktree 作成境界は「Plan review pass と Queue admission evidence の確定後、Queue release 前」とする。
2. Plan Mode を開いた時点や初回 Artifact 生成時点では Git mutation を行わない。
3. `implementation_queue_entries.claim_ready=false` を Git workspace provisioning の hold gate として再利用する。
4. `repositories.branch` を Project の canonical な既定 merge target として再定義する。DB column の rename は行わない。
5. UI と API の表示名は「既定のマージ先」とし、曖昧な「Branch」表記を残さない。
6. Task の target branch は Plan 確定時に snapshot し、Project 設定への参照のまま保持しない。
7. source branch 名は deterministic に `nightworkers/<task-id先頭8文字>-<task-title-slug>` とする。
8. slug は表示用文字列の機械的正規化に限定し、Task の分類や実行判断に keyword / regex を使わない。
9. branch collision 時は同じ allocation id から導出した短い suffix を付ける。ランダム再試行で別 branch を増やさない。
10. worktree path は既存既定 root 配下の `<repo>-worktrees/<branch-slug>` とし、allocation record に canonical path を保存する。
11. Git の状態を worktree 実在性の正本、DB を Task ownership / lifecycle / provenance の正本とする。
12. 外部 Git mutation と DB transaction を atomic と見なさない。durable provisioning state と再照合による saga として実装する。
13. source branch / worktree の作成、merge、cleanup は repository 単位の共通 Git mutation lock を通す。
14. 現行の process-local `withRepositoryCloseoutLock` は共通 lock service に移し、provision / commit / merge が同じ durable DB leaseとrepository lock keyを使う。
15. Queue の通常 Task 同士の並列性は維持する。repository 全体を実装中ずっと exclusive lock にはしない。
16. lock は Git metadata mutation の短い critical section にだけ使う。
17. Task から選択中 worktree を直接指定して作る既存 CTA は削除する。Plan 前に実装 workspace を固定する別導線は追加しない。
18. Worktree tab の手動 worktree 作成機能は保守・調査用途として残すが、自動 Task allocation の正本にはしない。
19. template import は pre-implementation bootstrap として扱い、通常 Implementation Run と同じ Run 内で cwd を途中変更しない。
20. bootstrap は typed materialization intent を使う。ユーザー文言の keyword / regex から template import を判定しない。
21. starter/template bootstrap は既存 `importProjectTool()` と post-import 初期化を再利用し、Git init を別実装しない。
22. arbitrary Git import で clone 済み repository に HEAD がある場合は、その local target branch から通常 allocation へ進む。
23. Review Mode commit と merge は別 mutation、別永続状態とする。
24. commit 成功後も merge decision が未確定なら Git lifecycle は未完了とする。
25. merge target は Plan snapshot を既定表示し、Review Mode で dropdown の初期選択をやり直さない。
26. target 変更は独立した明示操作とし、変更後に merge preview / CI evidence をすべて stale にする。
27. merge source は `task_run_commit_records.commit_sha` を使う。source branch の現在 HEAD が異なる場合は block する。
28. merge target は local branch に限定する。remote ref を直接 target にしない。
29. merge 前に automatic fetch / pull は行わない。local target と upstream の差は警告として表示する。
30. 初期実装では hosted PR / MR API を呼ばない。source push と external CI は観測可能な handoff として保持し、provider integration は拡張 seam にする。
31. CI 必須 Project では `external_ci_required` policy を設定できるが、verified CI result がない限り NightWorkers の local merge を許可しない。
32. CI provider integration 未設定時、`external_ci_required` は `merge_blocked` を返し、成功を推測しない。
33. merge は利用者の明示操作だけで開始する。条件付き auto-merge は本計画に含めない。
34. merge conflict を agent に自動修正させない。source workspace を保持し、rework Task / Run へ戻せる状態にする。
35. merge 後の source branch 削除、worktree 削除は別 cleanup action とし、自動実行しない。
36. prompt 文言とユーザー向け運用説明は日本語を維持する。

## 5. Scope

### 5.1 含む

- Project 既定 merge target の設定・検証・表示。
- Project merge policy の typed persistence。
- Plan review pass 後の Git workspace allocation。
- held Queue row と workspace provisioning の連携。
- 既存 Git repository の branch / worktree 自動作成。
- starter/template import の pre-implementation bootstrap 分離。
- Task / Queue / Run への workspace provenance 投影。
- restart recovery と partial Git mutation の診断。
- Review Mode commit 後の integration decision。
- merge preview、target drift 検出、merge 実行、conflict rollback。
- `merge_commit` / `squash` / `fast_forward_only`。
- source / target push policy と external CI block state。
- Project Detail Worktree、Plan Status、Queue、Review Mode の表示。
- backend / frontend / temporary Git repository integration tests。

### 5.2 含まない

- GitHub / GitLab / Bitbucket の PR / MR 作成 API。
- hosted branch protection の自動変更。
- CI workflow file の自動生成・変更。
- automatic fetch / pull / rebase。
- auto-merge。
- conflict の自動解消。
- source branch の自動削除。
- worktree の無確認自動削除。
- commit graph / branch graph の描画。
- Git 以外の VCS。
- Plan Artifact schema 全体の再設計。
- Queue processor 数や通常 scheduling policy の再設計。

## 6. Canonical Data Model

### 6.1 Project Git integration policy

`repositories.branch` を既定 merge target として使用する。追加 migration では `git_integration_policy_json` を `repositories` に追加する。

同時に`git_integration_version integer not null default 0`を追加し、Worktree画面からの設定保存をoptimistic concurrency controlする。

```ts
type ProjectGitIntegrationPolicy = {
  version: 1;
  remoteName: string | null;
  defaultMergeStrategy: "merge_commit" | "squash" | "fast_forward_only";
  sourcePushPolicy: "optional" | "required_before_merge";
  targetPushPolicy: "manual" | "after_merge";
  ciGate: "none" | "external_ci_required";
};
```

Default:

```json
{
  "version": 1,
  "remoteName": null,
  "defaultMergeStrategy": "merge_commit",
  "sourcePushPolicy": "optional",
  "targetPushPolicy": "manual",
  "ciGate": "none"
}
```

Rules:

- `repositories.branch` は local branch 名であり、`refs/heads/` prefix は保存しない。
- 既存 Git Project 登録で branch が未指定なら、`symbolic-ref --short HEAD` の現在branchを初期値にする。Git repositoryではない空rootだけ`main`を初期候補にする。
- 明示branchを伴う既存 Git Project登録はcreate時にも実在local branchを検証する。
- 設定保存時に `git check-ref-format --branch` と `git show-ref --verify refs/heads/<branch>` を実行する。
- target branch が別 worktree で checked out されていても設定可能。
- detached HEAD、tag、remote-only ref、存在しない branch は設定不可。
- upstream 未設定は保存 blocker にしないが、Worktree tab に warning を出す。
- `gitIntegrationPolicyJson` が null の legacy row は上記 default として読む。
- effective policy の `remoteName` は、保存値が null かつ `origin` が実在する場合だけ `origin` を候補表示する。暗黙に保存・pushはしない。
- non-null `remoteName` は `git remote` の完全一致で検証し、URLはpolicyへ保存しない。
- settings read responseは`gitIntegrationVersion`を返す。保存は`expectedGitIntegrationVersion`一致時だけ行い、競合時は409 `GIT_INTEGRATION_SETTINGS_CHANGED`を返して再読込を要求する。

### 6.2 Task Git workspace allocation

`task_git_workspaces` table を追加する。Task と1対1で、Plan 時に固定した source / target / base provenance と provisioning lifecycle を保持する。

```text
task_git_workspaces
  id text primary key
  task_id text not null unique -> tasks.id
  repository_id text not null -> repositories.id
  plan_review_id text null
  admission_key text null
  status text not null
  materialization_kind text not null
  materialization_intent_json text null
  bootstrap_evidence_json text null
  integration_policy_snapshot_json text not null
  source_branch text not null
  target_branch text not null
  target_base_sha text null
  worktree_path text null
  worktree_id text null
  allocation_version integer not null default 1
  provision_attempt integer not null default 0
  lease_owner text null
  lease_expires_at integer null
  last_verified_head text null
  last_error_code text null
  last_error_message text null
  provisioned_at integer null
  released_at integer null
  retired_at integer null
  created_at integer not null
  updated_at integer not null
```

Status:

```text
planned
waiting_for_repository_initialization
provisioning
ready
active
reviewing
committed
integration_pending
merged
provision_failed
attention
retired
```

`materialization_kind`:

```text
existing_git
starter_template
git_import
legacy_adopted
```

Indexes / constraints:

- unique `task_id`。
- partial-equivalent application constraint: non-retired rowsで `(repository_id, source_branch)` を一意にする。
- non-null `worktree_path` は canonicalize 後に repository 内で一意。
- Queue row から `workspace_id` を参照する一方向 FK とし、workspace tableからQueueへの循環FKは作らない。
- `ready` 以降は `target_base_sha`、`worktree_path`、`worktree_id` が必須。

SQLite の partial unique index を migration に直接定義する。

```sql
CREATE UNIQUE INDEX task_git_workspaces_active_branch_uidx
ON task_git_workspaces(repository_id, source_branch)
WHERE retired_at IS NULL;

CREATE UNIQUE INDEX task_git_workspaces_active_path_uidx
ON task_git_workspaces(worktree_path)
WHERE worktree_path IS NOT NULL AND retired_at IS NULL;
```

`tasks.worktree_path` は既存 runtime 互換の projection として維持する。canonical ownership は `task_git_workspaces` とし、workspace `ready` transaction でのみ `tasks.worktree_path` を更新する。

`integration_policy_snapshot_json`はPlan確定時のtarget branch、remote、merge strategy、push policy、CI gateを保存する。Project設定変更は既存workspace snapshotへ反映しない。

Workspace status transition:

| From | To | 条件 |
|---|---|---|
| `planned` | `waiting_for_repository_initialization` | valid materialization intent、HEADなし |
| `planned` | `provisioning` | target local branch / HEAD確認済み |
| `waiting_for_repository_initialization` | `provisioning` | bootstrap baseline commit確認済み |
| `waiting_for_repository_initialization` | `provision_failed` / `attention` | bounded retry失敗 / conflicting evidence |
| `provisioning` | `ready` | Git / DB / Task projectionの一致確認済み |
| `provisioning` | `provision_failed` / `attention` | Git command failure / partial mutation |
| `ready` | `active` | workspace-required Run作成と同一transaction |
| `active` | `reviewing` | Implementation / Test完了後にReview開始 |
| `reviewing` | `committed` | owned-path commit SHA確認済み |
| `committed` | `integration_pending` | decision requiredまたはdefer |
| `integration_pending` | `active` | rework cycle開始 |
| `integration_pending` | `merged` | merge recordとtarget HEAD確認済み |
| non-terminal | `attention` | ownership / Git state不整合 |
| `merged` | `retired` | 明示cleanup完了 |

merge conflict / CI block / target driftの詳細状態は`task_run_merge_records`だけが所有する。workspaceへ同じ詳細状態を複製しない。

### 6.3 Repository Git mutation lease

process-local lockだけではAPI process / queue worker間の同時Git mutationを防げないため、`repository_git_mutation_leases`を追加する。

```text
repository_git_mutation_leases
  repository_id text primary key -> repositories.id
  owner_id text not null
  operation text not null
  lease_version integer not null default 0
  acquired_at integer not null
  expires_at integer not null
  updated_at integer not null
```

Rules:

- operationは`workspace_provision` / `commit` / `merge` / `cleanup`。
- acquireはexpired rowのCAS更新または新規insertで行う。
- command実行中はbounded heartbeatでleaseを更新する。
- releaseは`repository_id + owner_id + lease_version`一致時だけ行う。
- 同じprocess内の待ち行列最適化は残してよいが、正本はDB leaseとする。
- lease喪失後に次のGit mutationへ進まず、現在のGit stateを再読込してattentionまたはidempotent recoveryへ収束する。

### 6.4 Queue workspace gate

`implementation_queue_entries` に次を追加する。

```text
workspace_id text null -> task_git_workspaces.id
workspace_required integer not null default false
```

Rules:

- 新規 Implementation handoff は `workspace_required=true`、`claim_ready=false` で作る。
- claim predicate は `claim_ready=true` に加え、`workspace_required=true` の場合 `workspace_id` があり、workspace status が `ready` または `active` であることを要求する。
- migration 前の row は `workspace_required=false` で互換維持する。
- migration 後に作る Plan-based Implementation row は workspace なしで claim できない。
- Test / Review の別 Run を同じ implementation entry として再 claim する既存経路には workspace path を引き継ぎ、新規 workspace を作らない。

### 6.5 Template materialization intent

Plan pipeline が repository 初期化要否を typed evidence として保存するため、`task_git_workspaces` の作成 input に次の union を使う。

```ts
type RepositoryMaterializationIntent =
  | { kind: "existing_git" }
  | {
      kind: "starter_template";
      source: "starter";
      stack: "hono" | "python";
      variant?: string;
      overlays?: string[];
      initialize: true;
    }
  | {
      kind: "git_import";
      source: "git";
      repoUrl: string;
      ref?: string;
      depth?: number;
      stripGitDir?: boolean;
      initialize: true;
    };
```

Intent の決定は Plan workflow / routing hypothesis と structured Plan context から行う。raw user text の keyword / regex 判定は追加しない。

既存 Git probe が成功する場合、intent は常に `existing_git` を優先する。空 root かつ materialization intent がない場合は attention へ止め、暗黙の starter import を pre-Queue service が選ばない。

### 6.6 Merge decision record

`task_run_merge_records` table を追加する。commit ownership と merge ownership を分離し、1つの reviewed implementation Run に1行を持つ。

```text
task_run_merge_records
  id text primary key
  run_id text not null unique -> task_runs.id
  task_id text not null -> tasks.id
  repository_id text not null -> repositories.id
  workspace_id text not null -> task_git_workspaces.id
  source_branch text not null
  source_commit_sha text not null
  plan_target_branch text not null
  plan_target_base_sha text not null
  target_branch text not null
  target_selected_sha text not null
  observed_target_sha text null
  strategy text not null
  decision text not null
  status text not null
  record_version integer not null default 0
  ci_status text not null
  ci_evidence_json text null
  preview_evidence_json text null
  conflict_paths_json text null
  merge_commit_sha text null
  target_head_after text null
  target_push_status text null
  target_pushed_at integer null
  decided_at integer null
  merged_at integer null
  last_error_code text null
  last_error_message text null
  created_at integer not null
  updated_at integer not null
```

Decision:

```text
undecided
merge
defer
rework
```

Status:

```text
decision_required
previewing
merge_ready
merging
merged
deferred
rework_requested
merge_blocked
merge_conflicted
failed
```

CI status:

```text
not_required
pending
passed
failed
unavailable
```

`ci_evidence_json` は将来の provider adapter 用 envelope とし、初期 local 実装で成功を捏造しない。

`plan_target_branch` / `plan_target_base_sha`はworkspace snapshotからコピーしたimmutable provenanceである。`target_branch` / `target_selected_sha`はReview時のeffective targetであり、初期値はPlan snapshotと同じにする。明示overrideはeffective fieldsだけを更新し、Plan provenanceを書き換えない。

Merge record transition:

| From | To | 条件 |
|---|---|---|
| rowなし | `decision_required` | source commit作成・SHA再検証済み |
| `decision_required` / `merge_blocked` / `merge_conflicted` | `previewing` | expected record version一致 |
| `previewing` | `merge_ready` | source / target / CI / worktree gate通過 |
| `previewing` | `merge_blocked` / `merge_conflicted` | typed blockerまたはpreview conflict |
| `merge_ready` | `merging` | expected record / source / target SHA一致 |
| `merging` | `merged` | target HEADとDB result確認済み |
| `merging` | `merge_conflicted` / `merge_blocked` / `failed` | rollback結果を含むtyped failure |
| `decision_required` / `merge_ready` / `merge_blocked` / `merge_conflicted` | `deferred` | 明示defer、expected version一致 |
| `decision_required` / `merge_ready` / `merge_blocked` / `merge_conflicted` | `rework_requested` | 明示rework、expected version一致 |

すべてのwrite endpointは`record_version`をCAS条件にし、成功時にincrementする。同じrequestの再送は、同じfinal stateとSHAが確認できる場合だけidempotent successを返し、異なるmutationへ進めない。

## 7. Plan-to-Queue Provisioning Contract

### 7.1 Admission sequence

現行 `admitMissionPilotQueueHandoff()` は、passing plan review と Context digest を検証し、`claim_ready=false` の Queue row を transaction で作る。この durable hold を維持し、直後の release を次へ置き換える。

```text
admitMissionPilotQueueHandoff()
  -> workspace allocation + held Queue row + handoff v2 planned を同一transactionでcommit
  -> provisionTaskGitWorkspace(taskId, queueEntryId)
  -> workspace ready + handoff v2 ready + Task projectionを同一transactionでcommit
  -> persisted Git / DB state を再読込
  -> releaseMissionPilotQueueHandoff()
```

`releaseMissionPilotQueueHandoff()` は次の全条件が一致した場合だけ `claim_ready=true` にする。

- Queue row が `queued`、activeRunIdなし。
- Queue row の `workspace_required=true`。
- Queue row の `workspace_id` と Task workspace id が一致。
- workspace status が `ready`。
- handoff v2 のworkspace stateが`ready`。
- workspace branch / path / target / base SHA がhandoff v2 readyと一致。
- `tasks.worktree_path` が workspace canonical path と一致。
- Git worktree list に path と branch が存在。
- worktree HEAD が `target_base_sha` と一致。
- worktree が clean、non-bare、non-prunable、non-detached。
- passing plan review / Context digest が handoff 作成時から変化していない。

### 7.2 Handoff schema v2

既存 persisted JSON 互換のため、`missionPilotQueueHandoffSchema` は v1 / v2 union にする。新規 write はv2のみとし、v2はprovision前後をdiscriminated unionで表す。

```ts
type MissionPilotQueueHandoffV2Base = MissionPilotQueueHandoffV1 & {
  version: 2;
  workspaceId: string;
  workspaceRequired: true;
  sourceBranch: string;
  targetBranch: string;
};

type MissionPilotQueueHandoffV2Planned = MissionPilotQueueHandoffV2Base & {
  workspaceState: "planned";
};

type MissionPilotQueueHandoffV2Ready = MissionPilotQueueHandoffV2Base & {
  workspaceState: "ready";
  targetBaseSha: string;
  worktreePath: string;
  worktreeId: string;
};

type MissionPilotQueueHandoffV2 =
  | MissionPilotQueueHandoffV2Planned
  | MissionPilotQueueHandoffV2Ready;
```

`admitMissionPilotQueueHandoff()`のtransactionではallocation id、deterministic source branch、Project target snapshotを確定できるため`planned`を保存する。template bootstrapではbase SHA / path / worktree idがまだ存在しないため、これらをnullable fieldにせず`ready` variantだけに持たせる。

provision完了transactionは、Session version、Context digest、planReviewId、Queue row status、workspace allocation versionをCAS条件にし、`planned -> ready`だけを許可する。release処理は`ready`以外をclaimableにしない。

v1 / interrupted v2 handoff の recovery:

- TaskRun が未作成なら workspace を provision して v2 へ upgrade。
- v2 plannedとGit exact workspaceが存在する場合は検証後にv2 readyへ収束する。
- v2 plannedでpartial branch / pathしかない場合はattentionへ止める。
- TaskRun が存在するなら既存 root を維持し、途中で移動しない。
- conflicting workspace / branch / path がある場合は attention。

### 7.3 Branch name and path

Branch name builder を `api/modules/gitworktree/task-workspace-naming.ts` に置く。

```text
nightworkers/<taskId[0..7]>-<normalized-title>
```

Rules:

- full name は240文字以下。
- `git check-ref-format --branch` を必ず通す。
- title が空または正規化後空なら `task` を使う。
- collision 時 suffix は workspace id の先頭6文字。
- LLM に branch 名生成を依頼しない。

Path は既存 `branchSlug()` と同じ canonicalization を使い、別実装を作らない。

### 7.4 Existing Git provisioning

`provisionExistingGitWorkspace()` の手順:

1. repository `localPath` から common dir と top-level を解決。
2. `repositories.branch` を `refs/heads/<target>` として検証。
3. `target_base_sha = rev-parse <target>^{commit}` を取得。
4. allocation row を `planned -> provisioning` へ CAS 更新。
5. repository Git mutation lock を取得。
6. branch / path の既存状態を再読込。
7. 完全一致する既存 worktree があれば idempotent success とする。
8. 存在しなければ既存 `createRepositoryWorktree()` の内部 typed primitive を呼ぶ。
9. `git worktree list --porcelain -z`、status、HEAD を再検証。
10. DB transaction で workspace `ready`、Queue `workspace_id`、Task `worktree_path` を更新。
11. transaction commit 後にもう一度再読込し、一致した場合だけ release 可能とする。

generic shell string や worker `run_command` は使わない。Git CLI adapter に検証済み args array を渡す。

### 7.5 Template bootstrap provisioning

空 Project の starter/template flow:

```text
held Queue row
  -> workspace status=waiting_for_repository_initialization
  -> bootstrap leaseを取得
  -> registered Project rootで importProjectTool(materializationIntent)
  -> postImport.gitInitialization / baseline commit / manifestを検証
  -> repository target branchを解決
  -> workspace status=provisioning
  -> baseline commitから専用 branch/worktree作成
  -> workspace ready
  -> Queue release
```

Rules:

- bootstrap は source implementation Run ではなく、pre-Queue provisioning operation として event / attempt を永続化する。
- bootstrap 中は `executionLockKey=repository:<id>` の exclusive preparation lease を使い、同じ空 Project に複数 import を実行しない。
- `importProjectTool` の `postImport.gitInitialization.status` が passed でなければ release しない。
- baseline commit がない場合は `rev-parse HEAD` を成功とみなさない。
- starter/templateのGit初期化では`inspectAndInitializeImportedProject()`へ`initialBranch=workspace.targetBranch`を追加し、`git init -b <targetBranch>`でbaseline branchを最初から一致させる。初期化後のrenameで合わせない。
- import先が既にGit初期化済みでtarget branchと異なる場合、target branchが実在すれば使用し、存在しなければattentionとする。暗黙にbranchをrenameしない。
- bootstrap 完了後の通常 Implementation Run の cwd は最初から専用 worktree とする。
- 既存 coding Todo から starter/template import を重複実行しないよう、Run context に verified materialization evidence を渡し、`import_project` を済みとして扱う。
- arbitrary Git import で remote branch しかない場合、明示された `ref` から local target branch を作る処理は import contract 側で完了させる。workspace provisioner は remote-only ref を推測しない。

### 7.6 Recovery and partial failure

`resumeTaskGitWorkspaceProvisioning()` を API bootstrap から呼ぶ。

Recovery matrix:

| DB state | Git state | Result |
|---|---|---|
| `planned/provisioning` | exact branch + path + base SHA | DB を `ready` へ収束 |
| `planned/provisioning` | branch exists, worktreeなし | `attention`; branchを自動削除しない |
| `planned/provisioning` | path exists, branch不一致 | `attention` |
| `ready` | worktree missing / prunable | Queue release禁止、`attention` |
| `ready` | HEAD moved before first Run | `attention` |
| `waiting_for_repository_initialization` | valid HEADあり | existing Git provisioningへ再開 |
| `waiting_for_repository_initialization` | import evidenceなし | bootstrap retry上限内で再試行 |
| held Queue | workspaceなし | allocationをidempotent作成してprovision |
| active Runあり | workspace不一致 | Runを移動せずdiagnosticのみ |

retry は bounded にし、同じ failure を無限再実行しない。last error、attempt、Git probe evidence を activity / Mission Pilot event に残す。

## 8. Run Start Contract

`start-task-run-preparation.ts` の `resolveTaskExecutionRoot()` 前後に workspace verification を追加する。

新規 workspace-required Task の開始条件:

- workspace status が `ready`。
- Queue row workspace id と一致。
- canonical path が `tasks.worktree_path` と一致。
- Git worktree branch が `source_branch` と一致。
- HEAD が `target_base_sha` と一致するか、同じ Task の prior implementation commit と一致。
- first implementation Run では clean。
- active Task / Run ownership が同じ Task 以外にない。

Run 作成時:

- `task_runs.worktree_path = workspace.worktree_path`。
- `task_runs.base_ref = current HEAD`。
- `contextSnapshot.gitWorkspace` に workspace id、source branch、target branch、Plan base SHA、allocation version を保存。
- workspace status を `active` にする。

Test Mode / Review Mode は同じ workspace を引き継ぎ、新しい branch / worktree を作らない。

## 9. Project Detail Worktree UX

### 9.1 Git integration settings

Worktree tab 上部に `Git integration` panel を追加する。

表示項目:

- 既定のマージ先 branch。
- 現在の local HEAD SHA / subject。
- upstream。
- ahead / behind。
- 既定 merge strategy。
- source push policy。
- target push policy。
- CI gate。
- 保存状態 / validation error。

既定 target は free text + local branch候補 datalist とする。UI 候補だけを信用せず server validation を必須にする。

Save API:

```http
PATCH /api/repositories/:id
Content-Type: application/json

{
  "branch": "main",
  "expectedGitIntegrationVersion": 3,
  "gitIntegrationPolicy": {
    "version": 1,
    "remoteName": "origin",
    "defaultMergeStrategy": "merge_commit",
    "sourcePushPolicy": "optional",
    "targetPushPolicy": "manual",
    "ciGate": "none"
  }
}
```

Response は更新後 repository、increment後の`gitIntegrationVersion`、target validation summary を返す。別 route を増やさず既存 repository update route を拡張する。version不一致では保存せず最新settingsを含む409を返す。

### 9.2 Worktree list additions

各 Task-owned worktree に次を表示する。

- `Task workspace` badge。
- Task id / title。
- source branch。
- merge target。
- Plan base SHA。
- lifecycle status。
- integration pending / merged。

既定 target branch の worktree には `Merge target` badge を表示する。base worktree と merge target は同義と仮定しない。

### 9.3 Existing CTA cleanup

`この worktree で Task を作成` は削除する。Task は通常の作成・Plan flowへ入り、Plan pass後に専用 workspaceを割り当てる。

手動 Create Worktree は残すが、作成 form に「Task の自動割当には使用されない」旨を短く表示する。

## 10. Plan Mode / Queue UX

### 10.1 Plan Status

Plan Status に次の step を追加する。

```text
Plan review
Git workspace preparation
Implementation Queue admission
```

Git workspace preparation の表示:

- target branch snapshot。
- source branch。
- provisioning status。
- template bootstrap status。
- worktree path。
- failure code / recovery action。

表示の正本は backend workspace record とし、frontend local state から完了推測しない。

### 10.2 Queue row

Queue row は `claim_ready=false` の理由を次で区別する。

- `plan_handoff_pending`
- `repository_initialization_pending`
- `git_workspace_provisioning`
- `git_workspace_attention`

processor slot は `claim_ready=true` になるまで消費しない。

## 11. Review Mode Integration Contract

### 11.1 Commit phase

既存 Review evidence gate と owned-path commit を維持する。追加条件:

- workspace id / source branch が Run snapshot と一致。
- current branch が source branch。
- commit 後 `commitSha` と source branch HEAD が一致。
- commit 成功後、workspace status を `committed` にする。
- merge record を `decision_required` で作成する。
- Queue processor lifecycle 完了と Git integration lifecycle 完了を別に表示する。
- auto-created source branchにupstreamがなく、pushが要求された場合は、保存済み`remoteName`を検証して`git push --set-upstream <remote> <sourceBranch>`を使う。remote未設定時はpushをblockする。

commit button 文言は `この branch にコミット` とし、source branch 名を近接表示する。

### 11.2 Review summary

commit 後に常時表示する。

```text
実装 branch: nightworkers/abcd1234-login
Review済み commit: 0123abcd
マージ先: main
Plan時の基点: main @ 1111aaaa
現在のマージ先: main @ 2222bbbb (Plan後に3 commits進行)
Merge strategy: merge commit
CI gate: none / pending / passed / blocked
```

target branch は read-only 表示を既定とする。変更 action は secondary danger-aware flow に置く。

### 11.3 Explicit decisions

commit 後の action:

1. `マージ可能性を確認`
2. preview成功後 `main にマージ`
3. `統合を保留`
4. `実装へ戻す`

target を変更する場合:

1. `統合先を変更` を押す。
2. confirmation dialog で現在値と新値を表示。
3. local branch validation。
4. current target SHAを`target_selected_sha`として取得し、merge recordのeffective target / observed SHA / CI evidence / previewをCAS更新してstale化。
5. 再preview成功まで merge buttonをdisabledにする。

Project default とworkspaceのPlan target snapshotは変更しない。merge recordのeffective targetだけをTask例外として記録し、Review summaryでは「Plan時target」と「今回の統合先」を別行で表示する。

### 11.4 Merge preview

`previewRunMerge(runId, expectedRecordVersion)`:

1. repository mutation lock を取得しない read phase で snapshotを取得。
2. source commit が保存 commit SHA と一致することを確認。
3. target local ref と current SHA を取得。
4. `git merge-base --is-ancestor` で relation を確認。
5. `git merge-tree --write-tree <targetSha> <sourceSha>` を実行し、exit status と conflict pathsを取得。
6. strategy-specific eligibility を判定。
7. target worktree の clean / blocker / usage を取得。
8. expected record versionをCAS条件に、merge recordへ`observed_target_sha`とpreview evidenceを保存してversionをincrement。

`git merge-tree --write-tree` が利用できない Git version は capability unavailable として merge を block する。文字列 output の曖昧な parse fallback は追加しない。

### 11.5 Merge execution

`mergeRunGitCloseout(runId, expectedRecordVersion, expectedSourceSha, expectedTargetSha)`:

1. repository Git mutation lock を取得。
2. merge record を CAS で `merge_ready -> merging`。
3. source commit、target branch、target SHA、CI gate、target worktree blockers を再検証。
4. `expectedTargetSha` と current target SHA が異なれば mutationせず `TARGET_MOVED`。
5. target branch を checkout 中の worktree を `git worktree list` から解決。
6. target worktree がなければ mutationせず `TARGET_WORKTREE_MISSING` を返す。Worktree tabでexisting branch worktreeを作成してから再実行する。
7. strategy に応じて source commit SHA を merge。
8. target HEAD と clean status を再検証。
9. merge record と workspace を transaction で `merged` に更新。
10. target push policy が `after_merge` の場合だけ、safety policyとupstreamを確認してpush。
11. event を保存し、frontend queryをinvalidate。

Commands:

```text
merge_commit:
  git merge --no-ff <sourceCommitSha> -m <message>

squash:
  git merge --squash <sourceCommitSha>
  git commit -m <message>

fast_forward_only:
  git merge --ff-only <sourceCommitSha>
```

branch 名ではなく SHA を command 引数に渡す。

### 11.6 Conflict rollback

merge 開始前に target worktree が clean であることを必須にする。

Conflict時:

- merge commit / ff flow: `git merge --abort` が可能なら実行。
- squash flow: pre-merge target SHA と clean status を検証後、index / working treeをその SHAへ戻す専用 rollback primitiveを使う。
- rollback 後に `status --porcelain` が空、HEADが pre-merge target SHA と一致することを確認。
- rollback検証に失敗した場合は `failed` / `needs_human` とし、成功を返さない。
- source worktree と source commit は保持。
- conflict paths を merge record / Review Mode に表示。

rollback primitive は merge service 内に閉じ、generic destructive command tool として公開しない。

### 11.7 CI gate

初期実装の `ciGate`:

- `none`: local preview とReview evidenceでmerge可能。
- `external_ci_required`: verified provider evidenceが `passed` の場合だけmerge可能。

本計画では provider adapter を実装しないため、`external_ci_required` を選んだ Project は source branch commit / push まで進め、CI evidence unavailableとしてmergeをblockする。将来の GitHub / GitLab adapter は `ci_evidence_json` と `ci_status` を更新するだけで core merge gateへ接続できる。

CI/CD が target branch の push を trigger にする Project では、target push policyを `after_merge` に設定する。push failureはlocal mergeを巻き戻さず、`merged + target_push_failed` として再試行可能にする。

`sourcePushPolicy=required_before_merge` の場合、保存済み source commit SHA が設定済みremote/upstreamへpush済みであることを merge gateで要求する。単に`pushStatus=pushed`を見るだけでなく、`pushBranch == sourceBranch`とremote tracking refのSHA一致を再検証する。

### 11.8 Task / Queue completion semantics

processor slotとTask lifecycleを分離する。

- Implementation / Test / Review Runとsource commitが完了した時点で、Implementation Queue entryはcompletedにしてprocessor slotを解放する。
- merge decision未確定のTaskは`needs_review`を維持する。
- `defer`したTaskは新しいTask status `integration_pending`にする。
- merge成功時だけTaskを`completed`にし、Mission Pilot closeoutを完了できる。
- `rework`は同じworkspace / target snapshotを維持して次のImplementation cycleへ戻す。新workspaceを作らない。
- `integration_pending`はProject task listとReview surfaceに表示し、通常のImplementation Queue claim対象にはしない。
- archiveは`completed`後だけ許可し、未統合Taskをarchiveで隠さない。

`integration_pending`追加時は`TaskStatus`、route validator、Queue mapper、Project list、archive gate、Mission Pilot post-Queue stateを同じsliceで更新する。

## 12. API Contract

### 12.1 Repository settings

- `PATCH /api/repositories/:id`
  - `branch?: string`
  - `gitIntegrationPolicy?: ProjectGitIntegrationPolicy`
- responseに `gitIntegration` validation summaryを追加。

### 12.2 Task workspace

- `GET /api/tasks/:id/git-workspace`
- `POST /api/tasks/:id/git-workspace/retry`
  - attention / failed provisioning の明示再試行。
- internal-only service:
  - `ensureTaskGitWorkspaceForQueueHandoff()`
  - `releaseQueueEntryAfterWorkspaceReady()`

通常利用者が arbitrary branch / path をこの Task APIへ直接渡す create endpointは追加しない。

### 12.3 Review integration

- `GET /api/runs/:id/git-closeout`
  - commit stateに `integration` objectを追加。
- `POST /api/runs/:id/git-closeout/commit`
- `POST /api/runs/:id/git-closeout/push`
- `POST /api/runs/:id/git-closeout/merge-preview`
- `POST /api/runs/:id/git-closeout/merge`
  - body: `expectedSourceSha`, `expectedTargetSha`。
- `POST /api/runs/:id/git-closeout/defer`
- `POST /api/runs/:id/git-closeout/rework`
- `PATCH /api/runs/:id/git-closeout/target`
  - body: `targetBranch`, `expectedCurrentTargetBranch`。

すべて route schema を `shared/schemas/nightworkers/run.schema.ts` に集約する。

### 12.4 Git closeout state extension

`GitCloseoutUiState` に追加する。

```text
integration_decision_required
merge_preview_running
merge_ready
merge_running
merged
integration_deferred
rework_requested
merge_blocked
merge_conflicted
```

`GitCloseoutState` に追加する。

```ts
integration: {
  workspaceId: string;
  sourceBranch: string;
  sourceCommitSha: string | null;
  targetBranch: string;
  planTargetBaseSha: string;
  observedTargetSha: string | null;
  targetAdvanced: boolean;
  strategy: MergeStrategy;
  decision: MergeDecision;
  status: MergeStatus;
  canPreview: boolean;
  canMerge: boolean;
  ciStatus: CiStatus;
  conflictPaths: string[];
  mergeCommitSha: string | null;
  targetPushStatus: string | null;
}
```

Blocking codes:

```text
GIT_WORKSPACE_MISSING
GIT_WORKSPACE_NOT_READY
SOURCE_BRANCH_MISMATCH
SOURCE_COMMIT_MISMATCH
TARGET_BRANCH_INVALID
TARGET_WORKTREE_MISSING
TARGET_WORKTREE_DIRTY
TARGET_WORKTREE_IN_USE
TARGET_STATUS_UNAVAILABLE
TARGET_MOVED
MERGE_PREVIEW_REQUIRED
MERGE_CONFLICT
MERGE_STRATEGY_BLOCKED
CI_EVIDENCE_REQUIRED
CI_EVIDENCE_FAILED
TARGET_PUSH_POLICY_BLOCKED
```

## 13. Service Boundaries

### 13.1 New files

- `shared/schemas/git-integration.schema.ts`
- `api/modules/gitworktree/task-git-workspace.repository.ts`
- `api/modules/gitworktree/task-git-workspace.service.ts`
- `api/modules/gitworktree/task-workspace-naming.ts`
- `api/modules/gitworktree/repository-git-mutation-lock.ts`
- `api/modules/gitworktree/repository-materialization.service.ts`
- `api/modules/nightworkers/nightworkers.git-merge.service.ts`
- `api/modules/nightworkers/nightworkers.git-merge.repository.ts`
- `src/modules/gitworktree/components/GitIntegrationSettings.tsx`
- `src/modules/nightworkers/components/review/ReviewGitIntegrationPanel.tsx`

### 13.2 Existing files to change

- `api/db/schema-base.ts`
- `api/db/schema-task-execution.ts`
- `api/db/schema.ts`
- `api/db/bootstrap-task-workflow-tables.ts`
- new Drizzle migration and journal metadata。
- `shared/schemas/nightworkers/repository-task.schema.ts`
- `shared/schemas/nightworkers/run.schema.ts`
- `shared/schemas/mission-pilot.schema.ts`
- `shared/schemas/gitworktree.schema.ts`
- `api/modules/missionPilot/mission-pilot-queue-handoff.service.ts`
- `api/modules/missionPilot/mission-pilot-post-queue-coordinator.service.ts`
- `api/modules/missionPilot/mission-pilot-pre-queue-recovery.service.ts`
- `api/modules/queue/queue-repository-commands.ts`
- `api/modules/queue/queue-repository-row-mapper.ts`
- `api/modules/gitworktree/gitworktree.service.ts`
- `api/modules/gitworktree/gitworktree.repository.ts`
- `api/modules/nightworkers/nightworkers.basic.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `api/modules/nightworkers/nightworkers.git-closeout.service.ts`
- `api/modules/nightworkers/git-closeout-support.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run-preparation.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- `api/modules/nightworkers/routes/repository-routes.ts`
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `src/modules/gitworktree/components/ProjectDetailWorktrees.tsx`
- `src/modules/gitworktree/components/GitworktreeDetail.tsx`
- `src/modules/gitworktree/hooks/useGitworktreeController.ts`
- `src/modules/gitworktree/api/gitworktreeCommands.ts`
- `src/modules/nightworkers/components/ReviewStatusViewer.tsx` または現在の Review status component split先。
- `src/modules/nightworkers/hooks/useNightWorkersMutations.ts`
- `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`
- `src/modules/nightworkers/types/core.ts`
- `src/i18n/dictionaries/ja-projectDetail.ts`
- `src/i18n/dictionaries/en-projectDetail.ts`
- Review Mode用 i18n dictionary。

既存の unrelated large-file refactor と競合する場合は、現行 split 後の component ownership を再確認し、古い monolith へ機能を戻さない。

## 14. Implementation Phases

### Phase 0: Baseline and contract tests

目的: 現行 behavior を固定し、後続変更の誤回帰を検出する。

実装:

- temporary Git repository fixtureで、base worktree Task、selected worktree Task、commit / push closeoutを記録。
- held Mission Pilot handoff が `claim_ready=false` であることを固定。
- template import が baseline commitを作る既存結果を固定。
- Project repository `branch` の現行 API / UI exposureを固定。

完了条件:

- baseline focused testsが変更前に通る。
- migration前 rowのcompatibility expectationsが明文化される。

### Phase 1: Shared schemas and persistence

実装:

- `git-integration.schema.ts`。
- `git_integration_policy_json`。
- `task_git_workspaces`。
- `repository_git_mutation_leases`。
- Queue workspace fields。
- `task_run_merge_records`。
- bootstrap schema mirror / migration。
- repository / workspace / merge repositories。
- v1 / v2 handoff schema。

完了条件:

- migration apply / fresh bootstrap / existing DB upgradeが通る。
- legacy repository / Queue / handoff rowがparseできる。
- unique branch / path constraintがraceを拒否する。

### Phase 2: Project default merge target

実装:

- repository PATCHにbranch / policyを追加。
- server-side Git ref validation。
- Worktree tab settings panel。
- default target badge / upstream warning。
- selected worktree Task CTA削除。

完了条件:

- valid local branchだけ保存できる。
- invalid / remote-only / missing branchは400で拒否。
- Project default変更が既存 Task workspace snapshotを変えない。

### Phase 3: Existing Git Plan-time provisioning

実装:

- naming helper。
- common repository Git mutation lock。
- workspace allocation saga。
- Mission Pilot held handoffとの接続。
- claim predicate workspace gate。
- Task projection / Run snapshot。
- recovery。

完了条件:

- Plan review pass後に1回だけbranch/worktree作成。
- Queue release前にworkspace evidenceが一致。
- 2 Taskを並行admitして異なるworkspaceへ収束。
- process restart後もduplicate branchを作らない。

### Phase 4: Template bootstrap split

実装:

- typed materialization intent。
- pre-Queue bootstrap lease / durable attempt。
- `importProjectTool`再利用。
- postImport baseline verification。
- bootstrap後のworkspace provisioning。
- Implementation runtimeへmaterialized evidenceを渡し、duplicate importを防止。

完了条件:

- empty Projectがbase rootでsource implementationを始めない。
- Git init / baseline commit後に専用worktreeが作られる。
- 通常 Implementation Run の最初のcwdが専用worktree。
- failed bootstrapはQueueをclaimableにしない。

### Phase 5: Run start and lifecycle projection

実装:

- Run start workspace guard。
- Test / Reviewへのworkspace継承。
- workspace status transition。
- Worktree usage / Queue / Plan Status表示。

完了条件:

- base worktreeで新規implementationを開始できない。
- branch / HEAD driftがRun開始前にblockされる。
- active usageがworktree削除をblockする。

### Phase 6: Review commit integration state

実装:

- commit後merge record作成。
- closeout state extension。
- source / target / base / current HEAD表示。
- defer / rework action。
- target overrideとstale invalidation。
- `integration_pending` Task statusとarchive gate。

完了条件:

- commit成功がmerge成功として表示されない。
- fixed targetがReview Modeで明示される。
- target overrideはconfirmationとrepreviewを要求する。

### Phase 7: Merge preview and execution

実装:

- merge-tree capability probe / preview。
- target worktree resolution / blocker。
- three strategies。
- expected SHA guards。
- conflict rollback。
- merge events / realtime invalidation。
- target push policy。

完了条件:

- clean mergeがtargetへ入り、source SHA / target before / target afterが保存される。
- target driftはmutationなしでblock。
- conflict後target worktreeが開始時のclean stateへ戻る。
- CI required / unavailableはmergeをblock。

### Phase 8: Recovery, compatibility, and whole-flow verification

実装:

- startup reconciler。
- legacy Task / Queue / handoff compatibility。
- Project Detail / Plan / Queue / Review E2E。
- docs更新。

完了条件:

- running legacy Taskを移動しない。
- held legacy Taskは安全にprovision / attentionへ収束。
- whole repo verifyが通る。

## 15. Test Plan

### 15.1 Schema and migration

- policy defaults / invalid enum / legacy null。
- workspace status invariants。
- unique Task / branch / path。
- merge record one-per-run。
- fresh DB bootstrapとexisting migration。
- handoff v1 / v2 parse。

Candidate tests:

- `tests/setup-vitest-db.ts`
- new `tests/task-git-workspace-schema.test.ts`
- new `tests/git-merge-record-schema.test.ts`

### 15.2 Worktree service

- deterministic branch name。
- collision suffix convergence。
- target branch missing。
- duplicate admission idempotency。
- exact existing worktree adoption。
- partial branch-only failure。
- path mismatch / symlink / overlap。
- concurrent two-Task provisioning。
- restart recovery。

Extend:

- `tests/gitworktree/gitworktree-service.test.ts`
- `tests/gitworktree/gitworktree-boundary.test.ts`
- new `tests/gitworktree/task-git-workspace.test.ts`

### 15.3 Queue / Mission Pilot

- workspace-required rowはworkspace readyまでclaim不可。
- held handoff -> provision -> release順序。
- plan Context drift中はrelease不可。
- duplicate handoffは同じworkspace id。
- provisioning失敗はattention。
- legacy workspaceRequired=false rowは互換維持。

Candidate tests:

- `tests/mission-pilot-plan-pipeline.test.ts`
- `tests/mission-pilot-pre-queue-handoff.test.ts`
- Queue repository focused tests。

### 15.4 Template bootstrap

- starter materialize -> Git init -> baseline commit -> worktree。
- bootstrap failure / missing baseline / init failure。
- retry after process restart。
- same empty Projectへの二重bootstrap防止。
- Implementation Runでimport_projectを再実行しない。
- arbitrary Git import with valid local target。

Extend:

- `tests/worker-tools/services-worker-tools-01.test.ts`
- `tests/services.native-api-runner-import-project.test.ts`
- new `tests/task-git-workspace-template-bootstrap.test.ts`

### 15.5 Run start

- workspace path / branch / HEAD一致。
- base worktree fallback拒否 for workspace-required Task。
- target base drift before first Run。
- prior same-Task implementation commitの継続。
- another Task ownership conflict。

### 15.6 Review / merge

- commit creates decision-required record。
- source branch mismatch / source SHA mismatch。
- target advanced preview。
- target moved between preview and merge。
- dirty / in-use target worktree。
- merge commit success。
- squash success and target-only commit SHA。
- ff-only success / non-ff block。
- conflict rollback and conflict paths。
- defer / rework。
- target override invalidates preview / CI evidence。
- external CI required / unavailable / failed / passed。
- target push success / failure / policy block。

Candidate tests:

- existing git closeout service tests。
- new `tests/services.git-merge-closeout.test.ts`
- `tests/review-status-viewer.test.tsx`

### 15.7 Frontend

- settings load / save / validation。
- default target badge。
- selected-worktree Task CTA absent。
- Plan Status provisioning states。
- Queue held reason。
- Review source / target / SHA display。
- merge button only after preview。
- target override confirmation。
- merge conflict / blocked / deferred display。
- realtime invalidation after commit / merge / push。

### 15.8 E2E

Temporary repositoryで次を通す。

1. Project default targetを`main`へ保存。
2. 2 TaskをPlan passさせる。
3. 2専用branch / worktreeが作られる。
4. processorCount=2で並行実装し、pathが異なる。
5. 片方をReview commit / merge。
6. もう片方のReviewでtarget advanceを表示。
7. repreview後にmerge。
8. source worktreeが保持される。

Template E2E:

1. empty Project root。
2. Plan materialization intentをstarterにする。
3. baseline initを確認。
4. dedicated worktreeからImplementation Run開始。
5. Review commit / target merge。

## 16. Verification Commands

各 Phase で focused test と touched-file Biome を先に実行する。最終 gate:

```bash
bun run db:migrate
bun run typecheck
bun run check:docs
bun run verify
```

必要に応じて:

```bash
bun run verify:full
bun run verify:e2e
```

`verify:live` は hosted CI provider integration を実装する将来 slice だけで使う。本計画の local Git core 完了条件には含めない。

Migration verification:

- fresh empty DB。
- current schema snapshotからのupgrade。
- legacy repository / task / queue / handoff row read。
- live DBに対する row count / orphan check。

最低限の live DB query evidence:

```text
workspace_required_queue_without_workspace = 0
ready_workspace_without_worktree_path = 0
ready_workspace_task_path_mismatch = 0
merge_record_without_commit_sha = 0
active_workspace_duplicate_branch = 0
active_workspace_duplicate_path = 0
```

## 17. Failure Handling

### Provisioning

- `TARGET_BRANCH_NOT_FOUND`: Project設定修正待ち。
- `TARGET_HEAD_UNAVAILABLE`: Git repository / initial commit確認待ち。
- `BRANCH_RESERVED`: deterministic allocation conflictを表示。
- `WORKTREE_PATH_CONFLICT`: pathとownerを表示。
- `WORKTREE_CREATED_BUT_UNVERIFIED`: Queue holdを維持しattention。
- `TEMPLATE_BOOTSTRAP_FAILED`: postImport evidenceを表示しretry可能。
- `WORKSPACE_DRIFTED`: 自動でbranch/pathを置換しない。

### Review / merge

- `SOURCE_COMMIT_MISMATCH`: Review後のsource変更としてre-review要求。
- `TARGET_MOVED`: repreview要求。
- `TARGET_WORKTREE_DIRTY`: user cleanup待ち。
- `TARGET_WORKTREE_IN_USE`: active Task / Run完了待ち。
- `CI_EVIDENCE_REQUIRED`: provider evidence待ち。
- `MERGE_CONFLICT`: source workspace保持、reworkへ戻す。
- `TARGET_PUSH_FAILED`: local merge済みとしてpushだけ再試行。

固定エラー本文にLLM応答を差し替える処理は追加しない。Git / schema / lifecycle errorはtyped codeと具体的 evidenceを返す。

## 18. Observability

Task / Mission Pilot events:

```text
git.workspace_planned
git.repository_bootstrap_started
git.repository_bootstrap_completed
git.workspace_provisioning_started
git.workspace_ready
git.workspace_provisioning_failed
queue.handoff_released
git.closeout_committed
git.integration_previewed
git.integration_deferred
git.integration_rework_requested
git.integration_merge_started
git.integration_merged
git.integration_conflicted
git.integration_failed
git.integration_target_push_failed
```

各 event は taskId、runId nullable、workspaceId、sourceBranch、targetBranch、relevant SHA、queueEntryId、error code を持つ。

API logには command文字列全体ではなく subcommand、repository id、workspace id、duration、exit classificationを記録する。credentialを含むremote URLや環境変数を出さない。

## 19. Rollout and Compatibility

1. schema / migrationを先にdeploy。
2. read pathをlegacy-compatibleにする。
3. Project settings UIを有効化し、既存 `repositories.branch` をdefault targetとして表示。
4. workspace provisioningをfeature flag下で有効化。
5. held Queue handoffだけに適用。
6. running / claimed legacy entriesは旧rootで完走。
7. unclaimed new entriesからworkspace requiredを強制。
8. deterministic / E2E確認後にfeature flagを既定on。

Feature flagは一時的 rollout control とし、最終実装では削除する。永続的にbase-worktree fallbackを残さない。

既存 Task compatibility:

- active Runあり: 移行しない。
- completed / archived: workspace recordを作らない。
- queued / unclaimed / no Run: held化してprovision可能。
- non-base `tasks.worktree_path`あり / no Run: Git stateがclean、unique branch、Task専有なら `legacy_adopted`。条件不一致はattention。
- base pathまたはnull: fresh dedicated workspaceをprovision。

## 20. Definition of Done

本計画は次をすべて満たした時だけ完了とする。

1. 既存 Git と template bootstrap の両方が専用 workspaceへ収束する。
2. Plan pass前にbranch/worktree mutationが起きない。
3. Queue claim前にworkspace evidenceが確定する。
4. processorCount並列で同一Projectの実装rootが分離される。
5. Project Detail Worktreeで既定merge targetを安全に設定できる。
6. Task target snapshotがProject設定変更から独立する。
7. Review Mode commitがsource branchに限定される。
8. Review Modeでfixed targetとtarget driftが明示される。
9. merge / defer / reworkが明示判断として永続化される。
10. three merge strategiesがexpected SHA guard付きで動く。
11. conflict / dirty target / target drift / CI blockで誤mergeしない。
12. restart recoveryがduplicate branch/worktreeを作らない。
13. legacy in-flight taskに回帰がない。
14. migration / focused / typecheck / docs / verifyが成功する。
15. 実装完了後、この文書を evidence reviewして `spec/archive/` へ移す。
