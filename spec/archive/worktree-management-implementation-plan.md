# Project Detail Worktree Management Implementation Plan

## Status

Proposed

## 目的

NightWorkers の Project Detail に `Worktree` タブを追加し、登録済み Project と同じ Git repository に属する worktree を、状態を確認しながら安全に管理できるようにする。

この画面が提供する中心価値は、次の3点である。

1. どの worktree が存在し、どの branch / HEAD / path を指しているかを把握できる。
2. NightWorkers の Task / Run がどの worktree を使用しているかを確認できる。
3. 作成・削除の前に、未コミット変更、実行中 Task、未退避 commit などの危険条件を明示できる。

Git 操作は、ユーザー環境にインストール済みの `git` CLI を唯一の実行手段とする。Git が利用できない場合、Worktree タブは説明だけを表示し、一覧取得を含む管理機能と操作導線を提供しない。

## 結論

初期実装は「Git の状態を正本とする一覧・詳細画面」と「確認済み条件に基づく作成・削除」に限定する。

- `repositories.localPath` から解決した Git top-level を、その Project で保護するベース worktree とする。
- worktree 選択によって `repositories.localPath` を書き換えない。
- Git repository 内に「現在の worktree」というグローバル状態を作らない。
- Task が特定 worktree を使う場合だけ、Task に実行先を保存する。
- Run 開始時に実行先を再検証し、確定した path を `task_runs.worktree_path` に保存する。
- worktree 一覧を保存する専用 DB table は作らず、`git worktree list --porcelain -z` を正本とする。
- LLM は状況要約、branch 名、起点 ref、保存先の提案だけを行う。
- LLM の回答から Git CLI を直接実行しない。
- `--force`、branch 削除、自動 cleanup は初期実装に含めない。

## Locked Decisions

実装時に再判断しない決定事項:

- Git 操作はローカル `git` CLI だけを使用する。
- `libgit2`、`simple-git`、同梱 Git、JavaScript による Git 再実装を fallback にしない。
- Git が存在しない場合、Worktree タブ内の button、link、refresh、LLM 補助をすべて無効化する。
- Git の自動 install、install UI、package manager 呼び出しは行わない。
- Git 未導入状態は Worktree タブだけに影響し、Project Detail の他タブや既存 Task 実行を停止しない。
- Git CLI は shell command 文字列ではなく、`execFile` または `spawn` に引数配列を渡して実行する。
- `repositories.localPath` を起点に `git rev-parse --show-toplevel` で解決した worktree root をベースと呼ぶ。Git が認識する primary worktree と同じ path である必要はない。
- ベース worktree は画面から削除できない。
- worktree の選択は詳細表示用であり、Project 全体の作業先変更ではない。
- Task に worktree が指定されていない場合、従来どおり `repositories.localPath` を実行先にする。
- 新しく開始する Run は、ベース利用時を含め、実際に使った path を `task_runs.worktree_path` に保存する。
- worktree の削除と branch の削除を分離する。worktree 削除時に branch は削除しない。
- remote fetch は一覧更新に含めない。ahead / behind は現在のローカル ref だけから計算する。
- LLM 用の用途別 SystemContext を llm-provider に追加しない。
- LLM 補助は既存 Supervisor の workflow / skill routing を通し、prompt 文言は日本語で維持する。

## スコープ

### 初期実装に含める

- Project Detail の `Worktree` タブと URL route。
- Git 利用可否と Git repository 利用可否の表示。
- worktree 一覧と選択中 worktree の詳細。
- branch、HEAD、path、locked、prunable、dirty、staged、untracked、ahead / behind の表示。
- ベース worktree と NightWorkers 利用中 worktree の表示。
- 新規 branch 用 worktree の作成。
- 既存 local branch 用 worktree の作成。
- 選択中 worktree の変更内容表示。
- 選択中 worktree を対象にした Task 作成導線。
- Task / Run の worktree path 永続化と実行 root の切替。
- server-side safety check を通過した worktree 削除。
- stale worktree metadata の dry-run 確認と prune。
- worktree 状況の LLM 要約と作成候補提案。
- 日本語・英語の i18n。
- backend、frontend、route、temporary Git repository を使う integration test。

### 初期実装に含めない

- commit graph。
- branch graph の描画。
- commit、amend、push、pull、merge、rebase、cherry-pick、stash。
- conflict resolution UI。
- remote branch の作成や削除。
- worktree 削除と同時の branch 削除。
- `git worktree remove --force`。
- 自動 fetch、定期 fetch、background fetch。
- unused worktree の自動削除。
- LLM による無確認の作成、削除、prune。
- Git 以外の VCS。
- Project 一覧や Project Sidebar の広範な再設計。
- 既存 Git worker tool 全体の refactor。

## 現在の実装基準

### Project と Project Detail

- `repositories.localPath` が Project のローカル root を保持している。
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx` が Project Detail の親画面である。
- `src/modules/nightworkers/components/project-detail/types.ts` が Project Detail tab 型と表示順を持つ。
- `src/modules/nightworkers/routing/workbench-route-state.ts` が `projects/:id/detail/:tab` の許可値、parse、serialize を持つ。
- `src/modules/nightworkers/nightWorkersCommands.ts` が frontend の repository API 呼び出しをまとめている。
- `src/i18n/dictionaries/ja.ts` と `src/i18n/dictionaries/en.ts` が表示文言の正本である。

### Git と repository API

- `api/services/worker-tools/git.ts` に `gitStatusTool` と `gitDiffTool` がある。
- 現在の `gitStatusTool` / `gitDiffTool` は worktree 管理用の capability、porcelain parser、mutation safety contract を持たない。
- `api/modules/nightworkers/routes/repository-routes.ts` に repository 単位の OpenAPI route がある。
- `api/modules/nightworkers/nightworkers.routes.ts` が route と service を接続する。
- `api/modules/nightworkers/nightworkers.review-files.service.ts` の repository diff は `repository.localPath` 固定である。

### Task と Run

- `tasks` は `repository_id` を持つが、worktree path を持たない。
- `task_runs` は nullable な `worktree_path` を持つ。
- `shared/schemas/nightworkers/run.schema.ts` は `worktreePath` を公開している。
- 現在の run orchestration は `repoInfo.localPath` を runtime、git baseline、review、diff の root として繰り返し使用している。
- 現在の通常実行では `task_runs.worktree_path` を保存する経路がない。

このため、画面だけを追加しても、NightWorkers がどの worktree を使用中かを正確に表示できない。Task の target と Run の確定 root を同じ vertical slice で接続する必要がある。

## UX 契約

### タブ配置

Project Detail の既存 tab 列に `Worktree` を追加する。

```text
概要 / タスク生成 / 評価 / 品質 / 技術スタック / Worktree
```

canonical route:

```text
/projects/:projectId/detail/worktrees
```

内部 ID は `worktrees` に統一し、表示ラベルだけを `Worktree` とする。

### 通常状態

desktop 幅では、一覧と詳細の2領域を表示する。

```text
┌──────────────────────────────────────────────────────────────┐
│ 3 worktrees  1 running  1 attention        Refresh  Create  │
├───────────────────────────────────┬──────────────────────────┤
│ Branch / State / HEAD / Path      │ Selected worktree        │
│ main                  [Base]      │ status / task / sync     │
│ feat/worktree-ui      [Running]   │ path / remove blockers   │
│ fix/queue-recovery    [Clean]     │ actions                  │
└───────────────────────────────────┴──────────────────────────┘
```

狭い幅では、一覧の下に選択中詳細を積む。横スクロールを前提にしない。狭い幅で省略する情報は `path`、次に `HEAD message` とし、branch 名と状態は残す。

### 一覧に表示する情報

各行の必須情報:

- branch 名。detached の場合は `Detached HEAD`。
- ベースかどうか。
- clean / changed / locked / prunable / unavailable。
- modified、staged、untracked の件数。
- short HEAD。
- canonical path。
- upstream 名。
- ahead / behind。
- NightWorkers が使用中か。
- 削除可否。削除不可の場合は blocker reason。

色だけで状態を表さない。badge、icon、文言を組み合わせる。

### 選択中詳細

- branch / detached state。
- full path。
- full HEAD と最新 commit subject。
- upstream / ahead / behind。
- modified / staged / untracked count。
- linked Task / Run。
- removal blockers / warnings。
- `変更を見る`。
- `Finder / Explorer で開く`。
- `ターミナルで開く`。
- `この worktree で Task を作成`。
- `状況を要約`。
- `削除`。

open action は desktop capability が存在するときだけ表示する。Git mutation とは分離し、Tauri / OS integration の既存方針に従う。

### Git 未導入状態

`git --version` が `ENOENT` または同等の executable-not-found で失敗した場合:

- 一覧を表示しない。
- cached worktree 一覧を表示しない。
- create、refresh、diff、Task 作成、要約、remove、prune を表示しないか disabled にする。
- install button、download link、package manager command を表示しない。
- 次の短い状態説明だけを表示する。

```text
Git コマンドが見つかりません
この画面を利用するには、ローカル環境で git コマンドを利用できる必要があります。
```

タブを開き直した場合は capability を再確認してよいが、この empty state 内に再確認操作は置かない。

### Git repository ではない状態

Git executable が存在しても、`repositories.localPath` が Git repository に属さない場合:

- `gitAvailable=true`、`repositoryAvailable=false` として区別する。
- Worktree 操作をすべて無効化する。
- Project の再登録や path 自動変更は行わない。
- `登録された Project path は Git repository ではありません` と表示する。

## Git CLI 契約

### 実行境界

新しい worktree 専用 CLI adapter を追加する。

候補:

```text
api/services/git-worktree/
  git-worktree-cli.ts
  git-worktree-parser.ts
  git-worktree-safety.ts
  types.ts
```

adapter の責務:

- `execFile` / `spawn` に executable と args を分けて渡す。
- `cwd` を明示する。
- stdout / stderr の最大 byte 数を制限する。
- timeout を持つ。
- exit code、signal、ENOENT、stderr を stable error code に正規化する。
- `-z` output を文字列の行分割だけで処理しない。
- Windows path、space、Unicode、改行を含む path を shell escaping に依存せず扱う。

worktree 専用 API から generic `run_command` を呼ばない。許可コマンド文字列の組み立てではなく、固定された Git subcommand と検証済み args を直接実行する。

### Capability probe

```text
git --version
```

成功条件:

- exit code が0。
- version text が空でない。

失敗分類:

- executable not found: `git_not_found`。
- timeout: `git_probe_timed_out`。
- その他: `git_probe_failed`。

`git_not_found` の結果は短時間 cache してよい。ただし app 再起動なしで Git が導入される可能性があるため、永続化しない。

### Repository identity

```text
git -C <repository.localPath> rev-parse --show-toplevel
git -C <repository.localPath> rev-parse --path-format=absolute --git-common-dir
```

取得結果を path resolve / realpath 相当で正規化し、Project の Git common directory identity とする。
`repositories.localPath` が repository のサブディレクトリを指す場合も、`--show-toplevel` の結果をベース worktree path として保護する。

すべての list / create / remove / diff request は、処理直前に次を満たすことを確認する。

1. Project がまだ存在する。
2. `repositories.localPath` が Git repository に属する。
3. 対象 path が同じ Git common directory に属する。
4. client が送った path を正本にせず、再取得した worktree list に含まれることを確認する。

### Worktree list

```text
git -C <repository.localPath> worktree list --porcelain -z
```

parser は最低限、次の field を扱う。

- `worktree`
- `HEAD`
- `branch`
- `detached`
- `bare`
- `locked` と optional reason
- `prunable` と optional reason

一覧取得後、存在する各 worktree に対して bounded concurrency で status を取得する。

```text
git -C <worktreePath> status --porcelain=v2 --branch -z
git -C <worktreePath> log -1 --format=%s
```

status parser は次を算出する。

- staged count。
- modified count。
- untracked count。
- conflicted count。
- upstream。
- ahead / behind。

detached HEAD の commit が ref に保護されているかを確認する場合は、現在の HEAD を検証した上で次を使う。

```text
git -C <repository.localPath> for-each-ref --contains <head> --format=%(refname) refs/heads refs/remotes refs/tags
```

返却 ref が0件なら、初期実装では `detached_commits_unprotected` として削除 blocker にする。到達可能性を LLM の説明から推測しない。

一覧 refresh は fetch を実行しない。remote ref の鮮度を UI で保証しない。

### Branch / start point validation

新規 branch:

```text
git check-ref-format --branch <branchName>
```

start point:

```text
git -C <repository.localPath> rev-parse --verify <startPoint>^{commit}
```

既存 branch は local branch ref として存在することを確認し、他 worktree で checkout 済みなら作成を拒否する。初期実装では `--force` で重複 checkout しない。

### Worktree create

新規 branch:

```text
git -C <repository.localPath> worktree add -b <branchName> -- <path> <startPoint>
```

既存 branch:

```text
git -C <repository.localPath> worktree add -- <path> <branchName>
```

実行前条件:

- Git / repository capability が利用可能。
- branch / start point が検証済み。
- path が base worktree 内でも既存 worktree 内でもない。
- path が既存の非空 directory ではない。
- 同一 canonical path が worktree list にない。
- branch が他 worktree で使用されていない。

default path:

```text
<dirname(repository.localPath)>/<basename(repository.localPath)>-worktrees/<branch-slug>
```

UI は default path を表示し、advanced option で変更を許可する。collision 時は server が黙って別 path に変更せず、候補と conflict を返す。

成功条件:

- Git command が exit code 0。
- 再取得した worktree list に canonical path が存在する。
- branch と HEAD が request / resolved start point と一致する。

command 成功後の再取得に失敗した場合は、作成成功と断定せず `created_but_unverified` として recoverable warning を返す。

### Worktree diff

選択中 worktree の変更確認は、既存 `gitDiffTool` と同じ表示契約を利用してよいが、対象 root は server が検証した worktree path にする。

初期実装では次を返す。

- hasChanges。
- diffStat。
- redacted diff。
- truncated。

client が送った任意 path を直接 `gitDiffTool` に渡さない。

### Worktree remove

```text
git -C <repository.localPath> worktree remove -- <path>
```

削除前に必ず list / status / DB usage を取り直す。GET 時点の `canRemove` だけを信頼しない。

request は最低限、次を含む。

```ts
type RemoveWorktreeRequest = {
  worktreeId: string;
  expectedHead: string;
};
```

`expectedHead` が現在値と異なる場合は `worktree_changed` で拒否する。

client は absolute path ではなく、一覧 response に含まれる opaque な `worktreeId` を mutation request に使う。server は fresh worktree list から ID を再計算して path を解決する。ID が解決できない場合、client path へ fallback しない。

削除成功条件:

- Git command が exit code 0。
- 再取得した worktree list に対象 path が存在しない。
- branch ref は残っている。

directory の手動削除や `fs.rm` を Git command 成功の代替にしない。

### Prune

preview:

```text
git -C <repository.localPath> worktree prune --dry-run --verbose
```

execute:

```text
git -C <repository.localPath> worktree prune --verbose
```

prune button は、dry-run が1件以上の対象を返した場合だけ有効にする。execute 前に preview を再取得し、確認 modal に対象を表示する。

## Shared Schema

新規 `shared/schemas/git-worktree.schema.ts` を追加し、API と frontend が同じ schema を利用する。

```ts
type GitCapability = {
  available: boolean;
  version: string | null;
  reason: "git_not_found" | "git_probe_timed_out" | "git_probe_failed" | null;
};

type GitRepositoryCapability = {
  available: boolean;
  commonDir: string | null;
  reason: "not_git_repository" | "repository_probe_failed" | null;
};

type WorktreeUsage = {
  taskIds: string[];
  runIds: string[];
  activeTaskCount: number;
  activeRunCount: number;
  pendingCloseoutCount: number;
};

type WorktreeSummary = {
  id: string;
  path: string;
  canonicalPath: string;
  isBase: boolean;
  head: string | null;
  headSubject: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  usage: WorktreeUsage;
  canRemove: boolean;
  removeBlockers: WorktreeRemoveBlocker[];
  removeWarnings: WorktreeRemoveWarning[];
};

type WorktreeListResponse = {
  git: GitCapability;
  repository: GitRepositoryCapability;
  worktrees: WorktreeSummary[];
  refreshedAt: string;
};
```

`WorktreeSummary.id` は Git common directory identity と canonical path から生成する opaque digest とする。DB identity ではなく、request ごとに current list から再計算できる識別子として扱う。

absolute path はローカル desktop app の管理画面に必要なため返却する。ただし LLM input、ログ、persisted final report、外部 link へそのまま転送しない。

## DB と実行 root

### tasks.worktree_path

`tasks` に nullable な `worktree_path` を追加する。

```ts
worktreePath: text("worktree_path")
```

意味:

- `null`: Project のベース `repositories.localPath` を使う。
- non-null: Task 作成時に選択した worktree path を使う。

既存 Task は migration 後も `null` のままとし、挙動を変えない。

変更対象:

- `api/db/schema.ts`
- `api/db/base-schema-bootstrap.ts`
- generated Drizzle migration。
- `shared/schemas/nightworkers/repository-task.schema.ts`
- `src/modules/nightworkers/types/core.ts`
- task repository / service / route。
- Task 作成 callsites。

Task 作成 API の optional input:

```ts
worktreeId?: string;
```

server は同じ Project の fresh worktree list から `worktreeId` を canonical path に解決し、DB の `tasks.worktree_path` に保存する。client が送った path を Task target として保存しない。

### Run 開始時の確定

run orchestration の入口で一度だけ `executionRepoRoot` を解決する。

```ts
const executionRepoRoot = await resolveTaskExecutionRoot({ task, repository });
```

解決規則:

1. `task.worktreePath` が null なら `repository.localPath`。
2. non-null なら Git capability と repository identity を確認する。
3. target が current worktree list に含まれることを確認する。
4. target が missing / prunable / common-dir mismatch なら Run を開始しない。
5. 確定 path を新規 `task_runs.worktree_path` に保存する。

target 不正時は Task / Queue を曖昧に base へ fallback しない。`needs_human` と stable reason を保存し、ユーザーに worktree の再作成または Task target の変更を求める。

### Run-scoped path の統一

Run 開始後は、次の処理が同じ `executionRepoRoot` または保存済み `run.worktreePath` を使う。

- git baseline。
- agent runtime `repoRoot`。
- worker tool root。
- command cwd。
- diff collection。
- Review target collection。
- Review Run source root。
- git closeout / commit / push 対象。
- final report local-link sanitization root。
- background process の repository path。

`repoInfo.localPath` の一部だけを置き換える実装は禁止する。run-scoped な `repoInfo.localPath` 利用を監査し、Project metadata 読み取りと execution root を分離する。

既存 `task_runs.worktree_path = null` の historical Run は base と断定せず、UI では `実行先記録なし` と表示する。

## API 契約

### 一覧

```http
GET /api/repositories/:id/worktrees
```

Git 未導入時も HTTP 200 で capability と空配列を返す。

```json
{
  "git": { "available": false, "version": null, "reason": "git_not_found" },
  "repository": { "available": false, "commonDir": null, "reason": null },
  "worktrees": [],
  "refreshedAt": "2026-07-10T00:00:00.000Z"
}
```

### 作成

```http
POST /api/repositories/:id/worktrees
```

```ts
type CreateWorktreeRequest =
  | {
      mode: "new_branch";
      branchName: string;
      startPoint: string;
      path?: string;
    }
  | {
      mode: "existing_branch";
      branchName: string;
      path?: string;
    };
```

### Diff

```http
POST /api/repositories/:id/worktrees/diff
```

body:

```json
{
  "worktreeId": "opaque-worktree-id"
}
```

### 削除

```http
DELETE /api/repositories/:id/worktrees
```

body:

```json
{
  "worktreeId": "opaque-worktree-id",
  "expectedHead": "0123456789abcdef"
}
```

### Prune

```http
GET  /api/repositories/:id/worktrees/prune-preview
POST /api/repositories/:id/worktrees/prune
```

### LLM 補助

```http
POST /api/repositories/:id/worktrees/advice
```

request は selected worktree identifier と依頼種別だけを受ける。client が任意の Git state や shell command を prompt として注入しない。

```ts
type WorktreeAdviceRequest = {
  kind: "summarize" | "suggest_create" | "suggest_cleanup";
  selectedWorktreeId?: string;
  taskIntent?: string;
};
```

backend が fresh `WorktreeListResponse` から LLM 用 snapshot を組み立てる。

### Error codes

mutation API は次の stable code を返す。

- `git_not_found`
- `not_git_repository`
- `repository_not_found`
- `worktree_not_found`
- `worktree_common_dir_mismatch`
- `base_worktree_protected`
- `worktree_in_use`
- `worktree_dirty`
- `worktree_conflicted`
- `worktree_locked`
- `worktree_prunable`
- `worktree_changed`
- `detached_commits_unprotected`
- `branch_already_checked_out`
- `branch_invalid`
- `start_point_invalid`
- `path_not_empty`
- `path_conflict`
- `git_command_timed_out`
- `git_command_failed`
- `created_but_unverified`

LLM の本文が返っている場合、schema parse failure を理由に固定エラーメッセージへ置換しない。Git mutation failure と LLM response failure は別状態として表示する。

## 削除安全条件

### Hard blocker

次のいずれかが成立する場合、server は削除を拒否する。

1. 対象 canonical path が `repositories.localPath` から解決した Git top-level と一致する。
2. 対象が current worktree list に存在しない。
3. 対象が別 Git common directory に属する。
4. locked である。
5. modified / staged / untracked / conflicted が1件以上ある。
6. non-terminal Task が対象を `worktreePath` に持つ。
7. active / pending-closeout Run が対象を `worktreePath` に持つ。
8. active implementation queue entry が対象 Task に紐づく。
9. active background process が対象 Run / path に紐づく。
10. detached HEAD の commit が branch / tag / reachable ref に保護されていない。
11. request の `expectedHead` と current HEAD が異なる。

`needs_review`、`needs_human`、`awaiting_commit_decision` は作業完了とは扱わず、使用中 blocker に含める。

### Warning

次は warning とするが、branch ref が残るため単独では削除 blocker にしない。

- upstream がない。
- upstream より ahead である。
- latest run が failed / cancelled である。

確認 modal は「worktree directory を削除するが branch は残る」ことを明記する。

### Safety result の正本

`canRemove` は UI 表示補助である。mutation API は必ず fresh state で同じ safety evaluator を再実行する。

```ts
evaluateWorktreeRemoval({
  repository,
  worktree,
  gitStatus,
  taskUsage,
  runUsage,
  queueUsage,
  backgroundProcessUsage,
  expectedHead,
})
```

UI と mutation API が別々の条件を実装しない。

## LLM 境界

### LLM が行うこと

- worktree 状況を短く要約する。
- cleanup candidate を理由付きで並べる。
- Task intent から branch 名、start point、path slug を提案する。
- detached HEAD の commit を保護する branch 名を提案する。
- 複数 worktree の役割が重複している可能性を説明する。

### LLM が行わないこと

- Git 利用可否の判定。
- dirty / clean の判定。
- active Task / Run の判定。
- `canRemove` の最終判定。
- shell command の生成と直接実行。
- `--force` の追加。
- worktree / branch の自動削除。
- mutation 成功の判定。

### 入力 snapshot

LLM へ raw stdout / stderr をそのまま渡さない。API が次の bounded snapshot を作る。

```ts
type WorktreeAdviceSnapshot = {
  repositoryName: string;
  baseBranch: string | null;
  worktrees: Array<{
    branch: string | null;
    detached: boolean;
    isBase: boolean;
    head: string | null;
    status: "clean" | "changed" | "conflicted" | "unavailable";
    ahead: number;
    behind: number;
    inUse: boolean;
    canRemove: boolean;
    blockerCodes: string[];
    warningCodes: string[];
  }>;
  taskIntent?: string;
};
```

absolute path、username を含む home path、長い diff、commit body は既定で LLM input に含めない。

### Supervisor routing

- 既存 Supervisor workflow / routing hypothesis に worktree advice の read-only intent を渡す。
- `api/services/supervisor/skills/builtin/SKILL.md` と Git work kind reference の構造を維持する。
- phase / mode / work_kind / overlay の document 解決は `resolveSupervisorSkillDocuments` を使用する。
- ユーザー文言の正規表現や keyword 判定で advice kind を分類しない。request schema の明示 `kind` と workflow で判断する。
- llm-provider は provider 呼び出し、JSON 抽出、schema 検証、最小互換正規化に限定する。

LLM が提案した create input は form へ反映するだけにし、ユーザーが preview を確認して `作成` を押した後に deterministic API を呼ぶ。

## Backend 構成

### 新規候補

```text
shared/schemas/git-worktree.schema.ts
api/services/git-worktree/git-worktree-cli.ts
api/services/git-worktree/git-worktree-parser.ts
api/services/git-worktree/git-worktree-safety.ts
api/services/git-worktree/types.ts
api/modules/nightworkers/routes/worktree-routes.ts
api/modules/nightworkers/nightworkers.worktrees.service.ts
src/modules/nightworkers/components/project-detail/ProjectDetailWorktrees.tsx
tests/services.git-worktree.test.ts
tests/worktree-routes.test.ts
tests/project-detail-worktrees.test.tsx
```

### 変更候補

```text
api/db/schema.ts
api/db/base-schema-bootstrap.ts
drizzle/migrations/*
shared/schemas/nightworkers/repository-task.schema.ts
shared/schemas/nightworkers/run.schema.ts
api/modules/nightworkers/nightworkers.repository.ts
api/modules/nightworkers/nightworkers.basic.service.ts
api/modules/nightworkers/nightworkers.service.ts
api/modules/nightworkers/nightworkers.routes.ts
api/modules/nightworkers/routes/repository-routes.ts
api/modules/nightworkers/run-orchestration/start-task-run.ts
api/modules/nightworkers/run-orchestration/runtime-execution.ts
api/modules/nightworkers/nightworkers.review-files.service.ts
api/modules/nightworkers/nightworkers.review-targets.service.ts
api/modules/nightworkers/nightworkers.git-closeout.service.ts
src/modules/nightworkers/nightWorkersCommands.ts
src/modules/nightworkers/types/core.ts
src/modules/nightworkers/components/ProjectDetailScreen.tsx
src/modules/nightworkers/components/project-detail/types.ts
src/modules/nightworkers/routing/workbench-route-state.ts
src/i18n/dictionaries/ja.ts
src/i18n/dictionaries/en.ts
tests/workbench-route-state.test.ts
tests/workbench-route-outlet-contract.test.ts
```

実装時に実際の依存を再確認し、未使用 file を計画だけを理由に変更しない。

## Frontend 状態管理

`ProjectDetailWorktrees` は Project Detail 全体の metrics load に混ぜず、tab が active なときだけ worktree API を取得する。

```ts
type WorktreeViewState =
  | { kind: "loading" }
  | { kind: "git_unavailable"; reason: string }
  | { kind: "repository_unavailable"; reason: string }
  | { kind: "ready"; data: WorktreeListResponse; selectedWorktreeId: string | null }
  | { kind: "error"; message: string };
```

rules:

- 初回選択はベース worktree。ベースが取得できなければ先頭。
- refresh 後も canonical path が残っていれば選択を維持する。
- 選択対象が消えたらベースへ戻す。
- create / remove / prune 成功後に一覧を再取得する。
- mutation 中は対象 action だけを busy にし、画面全体を不必要に止めない。
- Git 未導入 state ではすべての action handler を呼ばない。
- error message は backend stable code を i18n label に変換する。
- raw stderr は通常画面へ全面表示しない。必要なら詳細 disclosure に bounded 表示する。

## 実装フェーズ

### Phase 0: 契約と Git fixture

目的:

- Git CLI、schema、safety rule を UI 実装前に固定する。

実装:

- shared schema を追加する。
- temporary Git repository / worktree fixture helper を追加する。
- `git --version`、repository identity、worktree list parser を実装する。
- path normalization と common-dir membership helper を実装する。
- Git 未導入を注入可能な executable resolver / runner interface にする。

検証:

- path に space / Unicode を含む fixture。
- detached、locked、prunable porcelain fixture。
- `ENOENT` で `git_not_found`。
- non-Git directory で `not_git_repository`。
- shell metacharacter を含む input が command として解釈されない。

完了条件:

- fixture test で capability と parser の契約が確定している。
- mutation はまだ公開しない。

### Phase 1: Read-only API と Worktree タブ

目的:

- Git の実状態と NightWorkers usage を1画面で把握できるようにする。

実装:

- `GET /api/repositories/:id/worktrees`。
- worktree status collector。
- Task / Run / Queue / background process usage join。
- Project Detail `worktrees` route / tab。
- list + selected detail UI。
- Git 未導入 / non-Git repository empty state。
- i18n。

検証:

- base が必ず `isBase=true`。
- linked worktree が一覧に出る。
- dirty count と active Run が表示される。
- Git 未導入時に action が1つも実行可能でない。
- `/projects/:id/detail/worktrees` の reload が同じ tab を開く。

完了条件:

- read-only 状態把握だけで安全条件を説明できる。

### Phase 2: Worktree 作成

目的:

- preview と検証を伴う worktree 作成を提供する。

実装:

- create dialog。
- branch / start point / path validation。
- `POST /api/repositories/:id/worktrees`。
- new branch / existing branch の2 mode。
- command 後の再取得検証。
- collision / branch-in-use error UI。

検証:

- new branch worktree を作成できる。
- existing local branch worktree を作成できる。
- invalid branch / start point / non-empty path を拒否する。
- 他 worktree で checkout 中の branch を拒否する。
- branch / path に shell metacharacter があっても追加 command を実行しない。

完了条件:

- create 成功を再取得結果で確認できる。

### Phase 3: Task target と Run execution root

目的:

- Worktree 画面の対象を NightWorkers の実作業 root として安全に利用する。

実装:

- `tasks.worktree_path` migration。
- Task schema / type / create service の optional `worktreePath`。
- `この worktree で Task を作成` 導線。
- `resolveTaskExecutionRoot`。
- Run 作成時の `task_runs.worktree_path` 保存。
- run-scoped `repoInfo.localPath` を `executionRepoRoot` へ統一。
- diff / review / closeout の run path 対応。

検証:

- worktree target の Task がその path で file read / edit / test を行う。
- base target の既存 Task は従来どおり動く。
- Run record に base / linked worktree の実 path が保存される。
- queue 待機中に worktree が消えた場合、base fallback せず `needs_human` になる。
- Review / commit closeout が同じ worktree を参照する。

完了条件:

- Task、Run、worker、Review、closeout の root が一致する。

### Phase 4: Diff、削除、Prune

目的:

- 状態確認後の cleanup を、force なしで完結させる。

実装:

- worktree-aware diff endpoint。
- shared removal safety evaluator。
- remove confirmation modal。
- `DELETE /api/repositories/:id/worktrees`。
- prune preview / execute。
- optimistic `expectedHead` check。

検証:

- base、dirty、locked、in-use、conflicted を削除できない。
- detached unprotected commit を削除できない。
- clean / unused worktree を削除できる。
- branch は削除されない。
- GET 後に HEAD / status が変われば mutation を拒否する。
- prune は dry-run 対象だけを確認後に処理する。

完了条件:

- destructive action が fresh server-side evidence なしに進まない。

### Phase 5: LLM 補助

目的:

- Git state を変えずに、複数 worktree の状況理解と作成入力を補助する。

実装:

- bounded `WorktreeAdviceSnapshot`。
- Supervisor skill routing を通る advice request。
- `状況を要約`。
- `作成候補を提案`。
- `整理候補を提案`。
- suggestion を create form に反映するが自動 submit しない。

検証:

- LLM 無効 / provider unavailable でも deterministic UI と Git 操作が動く。
- LLM failure が Git state を変更しない。
- absolute path と raw diff が model input に入らない。
- suggestion 後も user confirmation なしに mutation API が呼ばれない。
- LLM 本文が返った parse failure で固定文へ置換しない。

完了条件:

- LLM を外しても全基本機能が成立し、追加時だけ理解速度が向上する。

### Phase 6: Regression と closeout

目的:

- route、Project Detail、queue、Review、Git closeout の回帰を防ぐ。

実装:

- focused test を整理する。
- i18n key parity を確認する。
- stale type / temporary compatibility code を削除する。
- plan 完了後にこの file を `spec/archive/` へ移す。

完了条件:

- verification gate が成功する。
- worktree 管理のために unrelated UI / provider logic を変更していない。
- completed plan が active `spec/docs` に残っていない。

## テスト計画

### Unit: Git CLI / parser

- Git executable あり / なし。
- Git repository / non-Git directory。
- `worktree list --porcelain -z` parser。
- space / Unicode / newline を含む path。
- branch / detached / bare / locked / prunable。
- porcelain v2 status の staged / modified / untracked / conflicted。
- upstream ahead / behind。
- command timeout / non-zero exit / bounded output。
- branch name / start point validation。
- common-dir mismatch。

### Unit: safety evaluator

- base blocker。
- dirty blocker。
- conflict blocker。
- locked blocker。
- active Task / Run / Queue / background process blocker。
- pending Review / closeout blocker。
- detached unprotected commit blocker。
- upstream missing / ahead warning。
- expected HEAD mismatch。

### Backend API

- list response schema。
- Git missing response is 200 + unavailable capability。
- mutation API rejects Git missing。
- repository not found / non-Git repository。
- create new / existing branch。
- diff membership validation。
- remove re-checks state。
- prune preview / execute。
- arbitrary outside path rejection。
- symlink / case normalization where supported。

### Run integration

- Task target persistence。
- base fallback only for null target。
- target worktree removal before queue execution。
- Run worktree path persistence。
- agent runtime receives target repoRoot。
- Review / diff / closeout use target path。
- historical null Run remains readable。

### Frontend

- route tab parse / serialize。
- loading / Git unavailable / repository unavailable / ready / error state。
- list selection and refresh retention。
- responsive stacking。
- create validation / busy / success refresh。
- removal blockers and confirmation。
- Git unavailable state exposes no usable actions。
- Japanese / English labels。
- keyboard navigation and focus return after dialog close。

### Integration fixture

temporary repository に次を作る。

```text
base main
├── feat/clean          clean linked worktree
├── feat/dirty          modified + untracked
├── feat/locked         locked
└── detached            detached HEAD with protected/unprotected variants
```

test cleanup は作成した temporary directory だけを削除する。ユーザーの repository や global Git config を変更しない。commit 作成時の user.name / user.email は command-local `-c` で指定する。

## 検証コマンド

実装時に追加した test file 名へ合わせて調整する。

```bash
bun run test run \
  tests/services.git-worktree.test.ts \
  tests/worktree-routes.test.ts \
  tests/project-detail-worktrees.test.tsx \
  tests/workbench-route-state.test.ts \
  tests/workbench-route-outlet-contract.test.ts
```

run root 変更後の focused regression:

```bash
bun run test run \
  tests/services.agent-runtime.test.ts \
  tests/services.review-files.test.ts \
  tests/frontend-project-detail-actions.test.tsx
```

共通 gate:

```bash
bun run typecheck
bun run check:docs
bun run verify:base
```

desktop open action や Tauri capability を変更した場合:

```bash
bun run desktop:verify-target
bun run verify:desktop
```

失敗時は Worktree 実装由来か既存 dirty-tree 由来かを path-scoped diff と focused test で分ける。既存の無関係な変更を修正対象へ含めない。

## 手動確認

### Git あり

1. Project Detail の Worktree tab を直接 URL で開く。
2. ベースと linked worktree が表示される。
3. dirty / staged / untracked count が CLI と一致する。
4. new branch worktree を作成する。
5. 作成した worktree から Task を作る。
6. Run の terminal / diff / Review が同じ path を参照する。
7. 実行中は削除が blocked になる。
8. clean / unused になった後だけ削除できる。
9. branch が残る。
10. stale metadata を preview 後に prune できる。

### Git なし

Git executable を PATH から除外した test environment で確認する。

1. Worktree tab が crash しない。
2. Git unavailable message だけが表示される。
3. create / refresh / diff / Task / advice / remove / prune を実行できない。
4. 他の Project Detail tab は表示できる。
5. Worktree mutation API が Git command を実行せず拒否する。

### Race condition

1. remove modal を開く。
2. 別 terminal で commit または file change を作る。
3. remove を確定する。
4. `worktree_changed` または `worktree_dirty` で拒否される。

## Acceptance Criteria

- Project Detail に routable な `Worktree` tab がある。
- Git executable がない場合、Worktree tab の全機能が利用不能である。
- Git executable がない状態で fallback implementation を使用しない。
- Git repository でない Project path を誤って worktree 管理しない。
- Git の実行は executable + args 配列で行われ、shell interpolation を使わない。
- worktree 一覧が `git worktree list --porcelain -z` と一致する。
- ベース worktree を削除できない。
- dirty、locked、conflicted、in-use worktree を削除できない。
- worktree 削除時に branch を削除しない。
- worktree 作成後、再取得結果で成功を確認する。
- Task は optional worktree target を保持できる。
- Run は実際の execution root を `task_runs.worktree_path` に保存する。
- worker、Review、diff、git closeout が同じ execution root を使用する。
- missing target に対して base へ黙って fallback しない。
- LLM がなくても一覧、作成、Task target、diff、削除、prune が動く。
- LLM は提案だけを行い、確認なしに Git mutation を実行しない。
- absolute local path や raw diff が不要に LLM input / persisted report へ漏れない。
- focused test、typecheck、docs check、`verify:base` が成功する。

## トレーサビリティ

| Requirement | Primary implementation | Verification |
| --- | --- | --- |
| Git CLI only | `git-worktree-cli.ts` | executable / args / ENOENT unit test |
| Git unavailable disables screen | list capability + `ProjectDetailWorktrees` | unavailable frontend/API test |
| Git state is source of truth | porcelain list/status parser | temporary repo integration |
| Base is protected | shared safety evaluator | base remove rejection |
| Safe create | create service + post-command re-list | new/existing branch tests |
| Task targets worktree | `tasks.worktree_path` + task schema | task persistence test |
| Run uses target root | `resolveTaskExecutionRoot` | runtime/review/closeout regression |
| Safe remove | shared safety evaluator + expected HEAD | blocker/race tests |
| Prune is previewed | prune preview/execute API | stale metadata fixture |
| LLM is advisory | bounded snapshot + Supervisor routing | no-mutation / provider-failure tests |
| URL restoration | route tab contract | route parse/serialize/reload test |
| i18n parity | `ja.ts` / `en.ts` | key parity/component tests |

## Risks and Mitigations

### Run root の部分置換

Risk:

- worker は worktree を使うが、Review / diff / closeout が base を使い、異なる変更を表示・commit する。

Mitigation:

- Run 開始時に `executionRepoRoot` を一度だけ解決する。
- run-scoped `repoInfo.localPath` 利用を検索し、保存済み `run.worktreePath` へ統一する。
- runtime / Review / closeout を同じ integration test で確認する。

### Path trust

Risk:

- client が任意の absolute path を送り、Project 外の Git repository を操作する。

Mitigation:

- request path を正本にしない。
- current worktree list と Git common directory identity を毎回再検証する。
- canonical path / realpath 比較を使う。

### Status と削除の race

Risk:

- 画面表示後に変更や Run が開始し、古い `canRemove=true` で削除する。

Mitigation:

- mutation 直前に safety evaluator を再実行する。
- `expectedHead` を照合する。
- dirty / usage を fresh read する。

### Git output の巨大化

Risk:

- 大規模 repository や大量 untracked file で API response / memory 使用量が増える。

Mitigation:

- status は count 中心にする。
- path 一覧と diff は別 endpoint にする。
- stdout / stderr / diff に byte 上限と truncated flag を持たせる。
- worktree status の concurrency を制限する。

### Git version 差

Risk:

- 古い Git が `--porcelain -z`、`--path-format`、一部 worktree field を十分に返さない。

Mitigation:

- capability probe で version を表示する。
- parser は optional field を許容する。
- 必須 command が unsupported の場合は `repository_probe_failed` とし、推測で補わない。

### Historical null worktree path

Risk:

- 過去 Run の null を base と誤認し、使用中判定や証跡を誤る。

Mitigation:

- historical null は unknown と表示する。
- 新規 Run から必ず path を保存する。
- migration で過去値を推測 backfill しない。

## 完了後の扱い

この計画の Acceptance Criteria と verification gate が満たされたら、次へ移動する。

```text
spec/archive/worktree-management-implementation-plan.md
```

実装途中の未完了 phase が残る場合は active plan のまま `spec/docs/` に置き、完了済みと記載しない。
