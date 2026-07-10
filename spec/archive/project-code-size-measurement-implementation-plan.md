# Project Code Size Measurement 実装計画

## Status

- Plan status: `completed`
- Implementation status: `completed`
- Completed: 2026-07-10
- Validation: focused Vitest 9 files / 39 tests, deterministic E2E 1 scenario, typecheck passed
- Repo gate: `bun run verify` passed at implementation completion
- Canonical plan: this document
- Baseline reviewed: 2026-07-10, `main` at `d4352ae9e80e283aa91cccb9d44f775a1be8162a`
- Target surface: Project Detail の「技術スタック」タブ
- Target feature domain: frontend/backend の `modules/techStack`

この文書を、技術スタック画面へ追加する Project Code Size Measurement の実装正本とする。

実装中に計測定義、分類優先順位、保存境界、API response、UI の合算式が曖昧になった場合は、この文書を優先する。実装と本文の契約が変わる場合は、先にこの文書を更新してからコードを変更する。

実装・受け入れ・検証が完了した後、この文書は `spec/archive/` へ移動する。

## 目的

Project Detail の技術スタック画面で、登録済み Project の実コード量を明示的に計測し、保存済みの最新結果を再表示できるようにする。

利用者は、少なくとも次を同じ画面で確認できる。

1. Project 全体の実ステップ数。
2. 通常ソースとテストの合算関係。
3. Frontend、Backend、Batch、Script、Shared 等のジャンル別内訳。
4. Unit テストと E2E テストの別々の内訳。
5. 各分類に含まれた実在フォルダー、ファイル数、実ステップ数。
6. 計測日時、計測時 Git HEAD、計測時間、除外情報。
7. 再起動・画面再読込後も残る保存済み結果。

この機能の中心は「決定的に計測した事実を保存して表示すること」である。LLM にコード量、分類、完了判定を推測させない。

同時に、既存の技術スタック検出・表示責務を `modules/techStack` 機能ドメインへ移す。Project Detail は Tech Stack feature を配置し、Project 全体の metrics と接続する薄い integration boundary にする。コードサイズ機能だけを新しい domain に置き、既存 stack detector や stack UI を旧位置へ残す中途半端な分割を完了状態にしない。

## 成功条件

次をすべて満たしたときだけ実装完了とする。

1. 技術スタック画面に「プロジェクトサイズ」セクションが表示される。
2. 未計測 Project では空状態と「計測して保存」操作が表示される。
3. 計測操作が、登録済み `repository.localPath` を基準に実ファイルを走査する。
4. 空行とコメントだけの行を除いた物理コード行を実ステップとして数える。
5. 通常ソースはジャンル別、テストは Unit / E2E / その他テスト別に一度だけ分類される。
6. `totalEffectiveLines === sourceEffectiveLines + testEffectiveLines` が常に成立する。
7. `sourceEffectiveLines` が全 source bucket の合計、`testEffectiveLines` が全 test bucket の合計と一致する。
8. 計測成功時だけ SQLite の最新保存値が置き換わる。
9. 計測失敗時は以前の保存値を失わない。
10. 画面再読込後、保存済み結果が同じ値で復元される。
11. Project A の結果が Project B に混入しない。
12. Project 削除時、保存済みコードサイズも cascade delete される。
13. 既存の技術スタック検出、ProjectMeta、Overview、Quality、Mission 表示に回帰がない。
14. focused tests、型検査、repo-native verify gate が成功する。
15. backend の技術スタック検出、context rendering、コードサイズ計測、保存、route、repository が `api/modules/techStack` を正本としている。
16. frontend の技術スタック表示、コードサイズ表示、計測 command が `src/modules/techStack` を正本としている。
17. Project Detail 配下に技術スタック固有の判定・集計・描画ロジックが残っていない。
18. 旧 `api/services/project-stack-context.ts` と旧 `ProjectDetailStack.tsx` が削除され、永続的な forwarding shim が残っていない。

## Locked Decisions

以下は初期実装で再オープンしない。

1. 実ステップは論理文数ではなく、コメントと空行を除いた物理コード行数とする。
2. 通常ソースとテストは排他的に分類し、二重計上しない。
3. 通常ソースの canonical category は `frontend`, `backend`, `batch`, `script`, `shared`, `database`, `desktop`, `other` とする。
4. テストの canonical kind は `unit`, `e2e`, `other` とする。
5. 分類不能な対象を捨てず、`other` に計上する。
6. 分類は exact path segment、所有ルート、manifest evidence の決定的ルールで行う。ユーザー入力文言、LLM、自由文 keyword 分類は使わない。
7. テスト分類を通常ソース分類より先に行う。
8. 明示的な下位フォルダー分類は、上位所有ルート分類より優先する。
9. 計測はユーザーの明示操作でだけ開始する。タブ表示、window focus、`visibilitychange` では開始しない。
10. 計測と保存は1つの操作にする。別の「保存」ボタンは設けない。
11. 初期実装は Project ごとの最新保存値1件だけを保持する。履歴・トレンド表示は行わない。
12. `repositories.project_meta` には保存しない。コードサイズ専用 table を追加する。
13. 既存 `ProjectMeta.files.sourceLoc` の意味、file scale score、Git HEAD cache 条件を変更しない。
14. 対象 Project の package script、test、build、任意コードは実行しない。
15. 外部 `cloc`, `tokei`, `scc` binary へ依存しない。
16. 保存するのは集計値と分類ルートであり、全ファイルパス一覧やファイル本文は保存しない。
17. 初期実装では分類ルール編集 UI を追加しない。分類根拠を表示可能な contract にし、将来の override 対応余地を残す。
18. 既存 Project Detail metrics response に最新保存値を追加し、表示時の追加 GET は増やさない。
19. 再計測中も以前の保存値を表示し続ける。
20. 不完全な走査を完全な計測として保存しない。hard limit 超過では保存せず失敗させる。
21. feature domain directory は user 指定どおり camelCase の `techStack` とする。URL path と i18n key は kebab-case / camelCase の各既存規約に合わせる。
22. backend の正本は `api/modules/techStack`、frontend の正本は `src/modules/techStack` とする。
23. 共有 Zod schema は runtime-neutral であるため `shared/schemas/tech-stack.schema.ts` に置く。`project-detail.schema.ts` は metrics composition のための import/re-export だけを許容する。
24. Drizzle table 定義と bootstrap は DB 基盤責務であるため `api/db/tech-stack-schema.ts` と `api/db/tech-stack-schema-bootstrap.ts` に置き、正式な SQL migration も追加する。業務 repository / service は `api/modules/techStack` に置く。
25. `api/modules/project-detail` は Tech Stack の filesystem、分類、保存、route を所有しない。metrics response の合成だけを行う。
26. `src/modules/nightworkers/components/project-detail` は Tech Stack の table、KPI、format helper、計測 command を所有しない。tab placement と parent state 接続だけを行う。
27. 移行中の compatibility re-export は許容するが、最終 Phase で旧実装 file と内部 import を削除する。永続的な二重実装は認めない。

## 現在の実装状態

### 技術スタック画面

正本:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailStack.tsx`
- `src/modules/nightworkers/components/project-detail/data.ts`
- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

現在の `StackProfilePanel` は次を表示する。

- 主要スタック summary。
- package manager。
- manifest status。
- 検出技術一覧。

`ProjectDetailScreen` は Project Detail の初期 load で `fetchProjectDetailMetrics(project.id)` を呼び、技術スタック未検出時だけ focus / visibility 回復で metrics を再取得する。コードサイズ計測をこの focus refresh に混ぜてはならない。

### 既存 ProjectMeta

正本:

- `api/modules/project-detail/project-meta.service.ts`
- `shared/schemas/project-detail.schema.ts` の `projectMetaSchema`
- `api/db/schema.ts` の `repositories.projectMeta`
- `api/modules/nightworkers/nightworkers.repository.ts` の `updateRepositoryProjectMeta`

現在の ProjectMeta は次を行う。

- Git が利用可能なら `git ls-files -z` でファイルを列挙する。
- Git HEAD が保存値と同じなら cache を返す。
- source extension に該当する全ファイルの物理行数を `sourceLoc` として数える。
- source/test ファイル数と file scale score を作る。
- `repositories.project_meta` JSON に保存する。

今回の要件に対する不足:

- `sourceLoc` は空行とコメントを含む。
- 通常ソースとテストを分離していない。
- Frontend / Backend / Batch / Shared 等の分類がない。
- Unit / E2E の分類がない。
- dirty worktree の未追跡ファイルを含まない。
- 計測が明示操作ではなく metrics GET の副作用である。
- Git HEAD が変わらない dirty change は cache refresh 条件にならない。

したがって、ProjectMeta の `sourceLoc` を UI 上で名称変更するだけでは要件を満たさない。

### Project Detail metrics API

正本:

- `shared/schemas/project-detail.schema.ts` の `projectDetailMetricsSchema`
- `api/modules/project-detail/project-detail.routes.ts`
- `api/modules/project-detail/project-detail.service.ts` の `getProjectDetailMetrics`

現在の response は `stackProfile`, `projectMeta`, `runs`, `llmUsage`, `health` を返す。今回ここへ nullable な最新保存値 `codeSizeSnapshot` を additive に追加する。

### DB bootstrap

正本:

- `api/db/project-detail-schema.ts`
- `api/db/project-detail-schema-bootstrap.ts`
- `api/db/bootstrap.ts`

Project Detail 所有 table は Drizzle schema と `ensureProjectDetailTables()` の双方を同じ変更で更新する。片方だけを更新してはならない。

### 現在の技術スタック責務の分散

現在は次のように分散している。

| Responsibility | Current owner |
| --- | --- |
| package.json / lockfile / file からの stack 検出 | `api/services/project-stack-context.ts` |
| Plan Mode 用 stack context rendering | `api/services/project-stack-context.ts` と `api/modules/specification` |
| stack profile schema | `shared/schemas/project-detail.schema.ts` |
| stack profile の metrics 合成 | `api/modules/project-detail/project-detail.service.ts` |
| stack UI | `src/modules/nightworkers/components/project-detail/ProjectDetailStack.tsx` |
| stack summary badge | 同上。ただし Overview からも利用 |
| stack command | Project Detail metrics command に内包 |
| stack tests | backend/frontend の複数 generic test file |

この分散状態へコードサイズ機能を追加すると、stack detection、measurement、persistence、UI の owner がさらに曖昧になる。そのため、コードサイズ追加と同じ計画内で Tech Stack feature domain を作り、既存責務も段階的に移す。

## Tech Stack Feature Domain Refactoring Contract

### Target directory tree

最終形は次を正本とする。

この repository は frontend が `src/modules`、backend が `api/modules` に分かれているため、root直下に新しい `modules/techStack` を作るのではなく、両 runtime に同名の `modules/techStack` feature domain を置く。共有可能な runtime-neutral contract だけを `shared/schemas` に置く。

```text
api/modules/techStack/
  index.ts
  tech-stack.routes.ts
  tech-stack.service.ts
  tech-stack.repository.ts
  project-stack-detector.ts
  project-stack-context.ts
  project-file-inventory.ts
  effective-line-counter.ts
  project-code-size-classifier.ts
  project-code-size.service.ts

src/modules/techStack/
  index.ts
  api/
    techStackCommands.ts
  components/
    StackSummaryBadge.tsx
    TechStackPanel.tsx
    ProjectCodeSizePanel.tsx
  model/
    codeSizePresentation.ts

shared/schemas/
  tech-stack.schema.ts

api/db/
  tech-stack-schema.ts
  tech-stack-schema-bootstrap.ts

drizzle/migrations/
  <next>_tech_stack_code_size.sql
```

必要になるまで空の file や不要な layer を先に作らない。ただし最終的な import ownership は上記境界に合わせる。

### Backend ownership

`api/modules/techStack` が所有する。

- Project stack profile の検出。
- stack profile の prompt/context rendering。
- repository file inventory。
- effective line counting。
- source/test classification。
- code size aggregation と invariant validation。
- code size latest snapshot repository。
- measure-and-save orchestration。
- Tech Stack 固有 route。
- 同一 repository measurement の single-flight。

`api/modules/project-detail` に残すもの:

- Project Detail metrics response 全体の合成。
- `techStackService.getRepositoryTechStackOverview(repositoryId)` を呼び、`stackProfile` と `codeSizeSnapshot` を response へ載せる処理。
- Overview、Mission、Quality、LLM usage 等の非 Tech Stack metrics。

`api/modules/specification` に残すもの:

- Plan Mode context 全体の組み立て。
- Tech Stack context を `api/modules/techStack` の public API から取得して挿入する薄い adapter。

`api/services/project-stack-context.ts` は最終的に削除する。新規実装を旧 service から re-export するだけの fileを恒久的に残さない。

### Frontend ownership

`src/modules/techStack` が所有する。

- 技術スタック heading 以下の stack-specific UI。
- Stack summary badge。
- 検出技術 table。
- Project Code Size panel。
- source/test breakdown presentation helper。
- percentage、formatting、stale HEAD 表示判定。
- measure command。
- Tech Stack component の props/type。

`src/modules/nightworkers/components/ProjectDetailScreen.tsx` に残すもの:

- active tab が `stack` かの判定。
- Project 全体の metrics load。
- `metrics.stackProfile`, `metrics.codeSizeSnapshot`, `metrics.projectMeta.git.head` を Tech Stack component へ渡すこと。
- measure success を parent metrics state へ反映する薄い callback。
- Project Detail 共通 busy/message surface との接続。

`src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx` に残すもの:

- Overview layout。
- `StackSummaryBadge` を `@/modules/techStack` public entrypoint から配置すること。

旧 `src/modules/nightworkers/components/project-detail/ProjectDetailStack.tsx` は最終的に削除する。Project Detail 内に wrapper component を残す必要はない。

### Shared schema ownership

`shared/schemas/tech-stack.schema.ts` が次の正本になる。

- `projectStackTechnologySchema` / `ProjectStackTechnology`。
- `projectStackProfileSchema` / `ProjectStackProfile`。
- code size category / test kind / root / bucket / snapshot schema。
- Tech Stack feature の request / response schema。

`shared/schemas/project-detail.schema.ts` は次だけを行う。

- `projectDetailMetricsSchema` を作るために Tech Stack schema を import する。
- 移行互換のため既存 `ProjectStackProfile` type/schema を re-export する。

新規 Tech Stack code は必ず `shared/schemas/tech-stack.schema.ts` から import する。互換 re-export は既存非 Tech Stack consumer を一括変更しなくても安全に移行するための seam であり、schema の二重定義ではない。

### DB infrastructure exceptions

DB table 定義と bootstrap は repository 全体の schema 初期化規約に従い `api/db` に置く。これらは domain 外への実装分散ではなく infrastructure adapter とみなす。

- `api/db/tech-stack-schema.ts`: Drizzle table definition。
- `api/db/tech-stack-schema-bootstrap.ts`: idempotent `CREATE TABLE` / index。
- `api/db/bootstrap.ts`: `ensureTechStackTables()` の呼び出しだけ。
- `drizzle/migrations/<next>_tech_stack_code_size.sql`: 正式な additive migration。番号は実装開始時の最新 journal を確認して採番する。
- `drizzle/migrations/meta/_journal.json` と生成 snapshot: repo-native migration 手順が要求する metadata を同じ変更で更新する。

`ensureProjectDetailTables()` に Tech Stack table 作成を追加しない。Project Detail table ownership と Tech Stack table ownershipを分ける。

### Route ownership and URL

measure route は Tech Stack router が所有する。

```text
api/modules/techStack/tech-stack.routes.ts
api/app.ts -> .route("/", techStackRouter)
```

URL は未実装のため、domain に合わせて次を正本とする。

```http
POST /api/repositories/:id/tech-stack/code-size/measure
```

旧計画の `/project-detail/code-size/measure` は採用しない。実装途中でも両 URL を並存させない。

既存の Project Detail metrics GET URL は互換維持する。

```http
GET /api/repositories/:id/project-detail/metrics
```

この GET の Tech Stack field は backend Tech Stack service から合成する。初期実装では追加の Tech Stack GET route を増やさない。

### Public entrypoints

frontend/backend とも、他 domain は feature 内部 file を深い相対 path で import しない。

```ts
// frontend
import {
  StackSummaryBadge,
  TechStackPanel,
  measureProjectCodeSize,
} from "@/modules/techStack";

// backend
import {
  detectProjectStackProfile,
  getRepositoryTechStackOverview,
  renderProjectStackContext,
} from "../techStack";
```

`index.ts` は安定した feature public API だけを export する。repository internals、DB row mapper、lexer internal state は export しない。

### Dependency direction

許可:

```text
Project Detail -> Tech Stack public API
Specification / Plan Mode -> Tech Stack public API
Tech Stack backend -> shared tech-stack schema + api/db adapters + NightWorkers repository lookup
Tech Stack frontend -> shared tech-stack schema + common visual tokens
```

禁止:

```text
Tech Stack backend -> Project Detail service/repository
Tech Stack frontend -> ProjectDetailStack or ProjectDetailScreen internal helpers
shared tech-stack schema -> api/src runtime code
Project Detail -> Tech Stack repository/internal scanner direct import
```

repository lookup は既存 `nightworkers.repository` の `getRepository()` を利用してよい。Tech Stack から Project Detail の `requireRepository()` private helper は利用しない。

### i18n ownership

dictionary file 自体は global infrastructure のため `src/i18n/dictionaries/*.ts` に残す。ただし key namespace は `projectDetail.stack.*` から `techStack.*` へ移す。

- `techStack.profile.*`
- `techStack.codeSize.*`

移行後、旧 key を duplicate alias として残さない。dictionary parity test と visible markup test を同じ Phase で更新する。

### Test ownership

新規・移行後の中心 test:

```text
tests/tech-stack-context.test.ts
tests/tech-stack-code-size.test.ts
tests/tech-stack-backend.test.ts
tests/tech-stack-frontend.test.tsx
tests/e2e/project-code-size.spec.ts
```

Project Detail tests は integration seam だけを検証する。

- metrics response に Tech Stack overview が合成される。
- stack tab が `TechStackPanel` を正しい props で表示する。
- focus refresh の既存 guard が壊れない。

scannerの詳細、分類 table、UI内訳 markup を Project Detail generic test へ増やし続けない。

## Scope

### 対象

- 実ファイル inventory の共通 helper。
- 既存 stack detector / context renderer の `api/modules/techStack` への移動。
- 既存 stack UI / summary badge の `src/modules/techStack` への移動。
- Tech Stack shared schema の `shared/schemas/tech-stack.schema.ts` への分離。
- Tech Stack router / repository / service の feature domain 化。
- 言語・拡張子ごとの実ステップ計測。
- 通常ソースとテストの排他的分類。
- source genre と test kind の集計。
- 最新結果の SQLite 永続化。
- OpenAPI route と shared schema。
- Project Detail metrics response への保存値追加。
- 技術スタック画面の計測操作、合算 UI、内訳 UI、空状態、進行状態、失敗表示。
- 日英 i18n。
- 旧 Tech Stack 実装 file と deep import の削除。
- scanner、repository、API、UI、E2E の回帰テスト。

### 対象外

- コードサイズ履歴、推移グラフ、前回差分。
- 複数 Project の横断ランキング。
- ユーザーが分類を編集する設定 UI。
- Project 内設定ファイルによる custom mapping。
- Git ignored ファイルの強制計測。
- submodule 内部の再帰走査。
- generated code と handwritten code の自動推定。
- function 数、class 数、complexity、token 数、byte 数による代替 sizing。
- Unit test coverage、E2E result、test 実行時間との統合。
- `ProjectMeta.fileScale` threshold の変更。
- Mission Goal、Project Evaluation、Queue、Supervisor prompt へのコードサイズ signal 追加。
- 自動定期計測、background scheduler、batch queue。
- LLM によるフォルダー分類。
- 対象 Project の `package.json` script または任意実行ファイルの起動。

## 用語と不変条件

### 実ステップ

この機能の UI 上の日本語ラベルは「実ステップ」、補助説明は「空行・コメントのみの行を除いた実コード行」とする。

内部名は `effectiveLines` を使う。`loc`, `sloc`, `logicalLines`, `statements` を混在させない。

1行は次の条件で1 effective line とする。

- コメント部分を取り除いた後、空白以外の code token が1つ以上残る。
- 1行に複数 statement があっても1。
- code の後ろに inline comment があっても1。
- import、型定義、interface、declaration、SQL DDL、CSS rule、template markup は code として1。
- Python 等の docstring は実行時文字列であるため code として数える。

### 合算不変条件

保存前に次を必ず検証する。

```text
totalFiles = sourceFiles + testFiles
totalEffectiveLines = sourceEffectiveLines + testEffectiveLines
sourceFiles = sum(sourceBuckets[*].files)
sourceEffectiveLines = sum(sourceBuckets[*].effectiveLines)
testFiles = sum(testBuckets[*].files)
testEffectiveLines = sum(testBuckets[*].effectiveLines)
```

不変条件を満たさない結果は schema validation error とし、DB に保存しない。

### 分類の排他性

対象ファイルは次のいずれか1つにだけ入る。

```text
source/frontend
source/backend
source/batch
source/script
source/shared
source/database
source/desktop
source/other
test/unit
test/e2e
test/other
```

同じファイルを source bucket と test bucket の両方へ入れない。

## File Inventory Contract

### Repository root

計測 root は DB に登録済みの `repository.localPath` を `path.resolve()` した値だけを使う。

- request body から path を受け取らない。
- temporary directory を workspace として扱わない。
- symlink 経由で repository root 外へ出ない。
- `lstat()` で symlink を検出し、対象外として記録する。
- 各候補の resolved path が repository root 配下にあることを再検証する。

### Git inventory

Git が利用可能な場合は次を使用する。

```bash
git -C <repoRoot> ls-files -co --exclude-standard -z
```

意味:

- `-c`: tracked files。
- `-o`: untracked files。
- `--exclude-standard`: `.gitignore`, `.git/info/exclude`, global exclude を尊重する。
- `-z`: 空白や改行を含む path を安全に分割する。

これにより、未コミットの新規ソースも計測する一方、ignored build output は原則含めない。

Git command の条件:

- shell を使わず `execFile` で実行する。
- timeout は 5 秒。
- max buffer は 32 MiB。
- exit failure、timeout、Git unavailable は filesystem fallback へ切り替える。

### Filesystem fallback

Git inventory を使えない場合だけ再帰走査する。

必須除外 segment:

```text
.git
node_modules
coverage
coverage-backend
dist
dist-web
dist-api
dist-api-desktop
build
out
.next
.nuxt
.svelte-kit
.turbo
.cache
playwright-report
test-results
vendor
target
DerivedData
```

fallback は symlink を追跡しない。permission error は `unreadable` として集計する。

### Hard limits

初期値:

- inventory candidate 上限: 50,000 files。
- 1ファイル上限: 2 MiB。
- 同時 read 上限: 16 files。
- Git inventory timeout: 5 seconds。

50,000 files を超えた場合は `ValidationError` を返し、保存済み結果を更新しない。先頭50,000件だけを「完全な結果」として保存してはならない。

2 MiB を超える個別ファイルは `too_large` として除外し、計測全体は継続する。binary、symlink、missing、unreadable も理由別に記録する。

### 対象 source extension

初期実装では次を対象にする。

```text
TypeScript / JavaScript:
.ts .tsx .js .jsx .mjs .cjs .mts .cts

Backend / systems:
.py .rs .go .java .kt .kts .swift .php .rb .cs
.c .cc .cpp .h .hh .hpp

Frontend / template / style:
.css .scss .sass .less .html .htm .vue .svelte .astro

Data / interface / infrastructure code:
.sql .prisma .graphql .gql .proto .tf .hcl

Script:
.sh .bash .zsh .fish .ps1
```

拡張子なしの `Dockerfile`, `Makefile`, `Rakefile`, `Procfile` も script として対象にする。

次は初期実装では実ステップ対象外とする。

```text
.md .mdx .txt .json .jsonc .yaml .yml .toml .ini
lockfiles, images, fonts, archives, database files
```

対象外 extension は全件 path 保存せず、`unsupported_extension` 件数だけを保存する。

### Binary detection

対象 extension でも、先頭8 KiB以内に NUL byte がある場合は binary と判定する。binary は読めるテキストとして行数計測しない。

## Effective Line Counter Contract

### 実装位置

新規 service を次の責務に分ける。

```text
api/modules/techStack/project-file-inventory.ts
  - Git / filesystem inventory
  - path boundary check
  - stat, size, binary, skip reason

api/modules/techStack/effective-line-counter.ts
  - extension / basename -> comment syntax
  - 1ファイルの effective lines 計測

api/modules/techStack/project-code-size-classifier.ts
  - test/source classification
  - ownership root / manifest evidence

api/modules/techStack/project-code-size.service.ts
  - inventory / counter / classifier orchestration
  - bucket aggregation
  - invariants
  - persistence orchestration
```

既存 `project-meta.service.ts` は、挙動を変えない範囲で inventory helper を再利用してよい。ただし今回の完了条件に ProjectMeta の scanner rewrite を含めない。共通化によって既存 `sourceLoc` の値が変わる場合は共通化を見送り、コードサイズ専用 inventory として追加する。

### Comment syntax

最低限、次をサポートする。

| Language family | line comment | block comment |
| --- | --- | --- |
| TS/JS/C/C++/Java/Kotlin/Swift/Go/Rust/C#/PHP | `//` | `/* ... */` |
| Python/Ruby/Shell/PowerShell/Terraform | `#` | なし |
| SQL | `--` | `/* ... */` |
| CSS/SCSS/Less | なし | `/* ... */` |
| HTML/Vue/Svelte/Astro | なし | `<!-- ... -->` |

Vue/Svelte/Astro は mixed file として HTML comment と C-style comment の双方を認識してよい。

counter は次の lexical state を持つ。

- block comment 内か。
- single quote 内か。
- double quote 内か。
- backtick 内か。
- escape 中か。

文字列内の `//`, `#`, `/*`, `<!--` を comment 開始として扱わない。inline comment より前に code token があれば、その行は1と数える。

完全な parser や AST は使わない。言語ごとの logical statement 数を作ろうとしない。

### Newline handling

- LF と CRLF を同じ結果にする。
- UTF-8 BOM を先頭から除く。
- 空ファイルは0。
- 最終改行の有無で結果を変えない。

## Classification Contract

### 判定順序

1ファイルごとに次の順で判定する。

1. 対象 source file か。
2. E2E test か。
3. その他 test kind の明示 marker があるか。
4. Unit test か。
5. 明示的な下位 source category segment があるか。
6. top-level / workspace ownership root を分類できるか。
7. manifest evidence で `src` 等を分類できるか。
8. どれにも該当しなければ `source/other`。

### Test classification

E2E を最優先する。

E2E marker:

- exact path segment: `e2e`, `playwright`, `cypress`。
- filename marker: `.e2e.`, `.pw.`。
- `tests/e2e/**`, `e2e/**`, `cypress/e2e/**`。

その他 test marker:

- exact path segment または filename marker: `integration`, `contract`, `performance`, `load`, `benchmark`。
- E2E より後、Unit より前に判定する。

Unit marker:

- exact path segment: `test`, `tests`, `__tests__`, `spec`, `specs`, `unit`。
- filename marker: `.test.`, `.spec.`, `.unit.`。
- E2E / その他 test marker に該当したものは Unit に入れない。

test directory 配下の helper、fixture、case module は、対象 source extension なら同じ test kind に含める。実際の test suite を構成するコード量だからである。

Project の config file を import / execute して test path を取得しない。初期実装は上記の決定的 path rule に限定する。

### Explicit source category segment

segment は path component の完全一致だけを見る。substring は見ない。

| Category | exact segment |
| --- | --- |
| `batch` | `batch`, `batches`, `jobs`, `cron`, `crons`, `workers` |
| `script` | `script`, `scripts`, `bin` |
| `shared` | `share`, `shared`, `common` |
| `database` | `db`, `database`, `drizzle`, `migrations` |
| `desktop` | `desktop`, `electron`, `src-tauri` |

具体例:

- `api/workers/runner.ts` は `batch`。
- `api/services/worker-tools/run.ts` は `workers` segment ではないため `batch` にしない。
- `api/db/schema.ts` は `database`。
- `src/shared/types.ts` は `shared`。
- `scripts/release.ts` は `script`。

複数の explicit category segment がある場合は、ファイルに最も近い deepest segment を採用する。同じ深さで競合する path は `other` とし、classification warning を1件追加する。

### Ownership root

通常は top-level directory を ownership root とする。

monorepo container が次の場合は、その直下1階層を ownership root とする。

```text
apps/*
packages/*
services/*
libs/*
```

例:

- `apps/web/src/App.tsx` の ownership root は `apps/web`。
- `services/api/src/index.ts` は `services/api`。
- `packages/shared/src/types.ts` は `packages/shared`。

ownership root 自体の exact name rule:

| Category | root name |
| --- | --- |
| `frontend` | `frontend`, `front`, `web`, `client`, `ui` |
| `backend` | `backend`, `server`, `api` |
| `batch` | `batch`, `batches`, `jobs`, `workers`, `cron` |
| `script` | `script`, `scripts`, `bin` |
| `shared` | `share`, `shared`, `common` |
| `database` | `db`, `database`, `drizzle`, `migrations` |
| `desktop` | `desktop`, `electron`, `src-tauri` |

### Manifest evidence

`src` や `app` のように名前だけで分類できない ownership root にだけ使用する。

manifest は root package または workspace package の `package.json` を JSON として読む。package script は実行しない。

Frontend evidence:

```text
react, react-dom, next, vue, svelte, @angular/core, vite
```

Backend evidence:

```text
hono, express, fastify, koa, nestjs, @nestjs/core
```

判定:

- frontend evidence だけなら `frontend`。
- backend evidence だけなら `backend`。
- 両方あり、同階層に `api` / `backend` / `server` ownership root がある場合、root `src` は `frontend`。
- 両方あり、分離 root の根拠がなければ `other`。
- package.json が無い、parse failure、evidence なしなら `other`。

既存 `detectProjectStackProfile()` の判定 helper を共通化できる場合は再利用する。ただし stack profile の表示結果を変更する大規模 refactor は行わない。

### NightWorkers で期待する分類

少なくとも fixture で次を固定する。

| Path | Expected |
| --- | --- |
| `src/modules/nightworkers/App.tsx` | `source/frontend` |
| `api/modules/project-detail/project-detail.service.ts` | `source/backend` |
| `api/workers/queue-worker.ts` | `source/batch` |
| `api/scripts/cleanup.ts` | `source/script` |
| `scripts/verify.mjs` | `source/script` |
| `shared/schemas/project-detail.schema.ts` | `source/shared` |
| `api/db/schema.ts` | `source/database` |
| `drizzle/migrations/001.sql` | `source/database` |
| `src-tauri/src/lib.rs` | `source/desktop` |
| `tests/project-detail-screen.test.tsx` | `test/unit` |
| `tests/project-detail-backend/helpers.ts` | `test/unit` |
| `tests/e2e/project-quality.spec.ts` | `test/e2e` |
| `tests/nightworkers-codex-mcp-integration.test.ts` | `test/other` |

### Classification source

root summary には次のいずれかを保存する。

```ts
type ProjectCodeSizeClassificationSource =
  | "test_path_rule"
  | "explicit_path_rule"
  | "ownership_root_rule"
  | "manifest_evidence"
  | "fallback";
```

UI 初期実装は詳細 source を常時表示しなくてよいが、対象フォルダーの `title` または将来の詳細表示に利用できる contract にする。

## Shared Data Contract

### Enums

`shared/schemas/tech-stack.schema.ts` に次を追加する。

```ts
export const projectCodeSizeSourceCategorySchema = z.enum([
  "frontend",
  "backend",
  "batch",
  "script",
  "shared",
  "database",
  "desktop",
  "other",
]);

export const projectCodeSizeTestKindSchema = z.enum([
  "unit",
  "e2e",
  "other",
]);
```

### Root summary

```ts
const projectCodeSizeRootSummarySchema = z.object({
  path: z.string().min(1),
  files: z.number().int().nonnegative(),
  effectiveLines: z.number().int().nonnegative(),
  classificationSource: z.enum([
    "test_path_rule",
    "explicit_path_rule",
    "ownership_root_rule",
    "manifest_evidence",
    "fallback",
  ]),
});
```

`path` は repository-relative POSIX path とする。absolute path は保存しない。

### Buckets

```ts
const projectCodeSizeSourceBucketSchema = z.object({
  category: projectCodeSizeSourceCategorySchema,
  files: z.number().int().nonnegative(),
  effectiveLines: z.number().int().nonnegative(),
  roots: z.array(projectCodeSizeRootSummarySchema),
});

const projectCodeSizeTestBucketSchema = z.object({
  kind: projectCodeSizeTestKindSchema,
  files: z.number().int().nonnegative(),
  effectiveLines: z.number().int().nonnegative(),
  roots: z.array(projectCodeSizeRootSummarySchema),
});
```

source bucket は8 category、test bucket は3 kind を canonical order で必ず全件返す。0件 category も省略しない。これにより UI が欠落を0と誤認する問題を避ける。

### Skip summary

```ts
const projectCodeSizeSkipSummarySchema = z.object({
  unsupportedExtension: z.number().int().nonnegative(),
  generatedPath: z.number().int().nonnegative(),
  tooLarge: z.number().int().nonnegative(),
  binary: z.number().int().nonnegative(),
  symlink: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
});
```

個別 path は保存しない。API error の diagnostic details にも全 path を露出しない。

### Snapshot

```ts
export const projectCodeSizeSnapshotSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  schemaVersion: z.literal(1),
  algorithmVersion: z.literal("effective-lines-v1"),
  measuredAt: dateLikeSchema,
  scanDurationMs: z.number().int().nonnegative(),
  inventory: z.object({
    source: z.enum(["git", "filesystem"]),
    listedFiles: z.number().int().nonnegative(),
    skipped: projectCodeSizeSkipSummarySchema,
  }),
  git: z.object({
    status: z.enum(["available", "unavailable"]),
    head: z.string().nullable(),
    shortHead: z.string().nullable(),
    dirty: z.boolean().nullable(),
  }),
  totals: z.object({
    totalFiles: z.number().int().nonnegative(),
    sourceFiles: z.number().int().nonnegative(),
    testFiles: z.number().int().nonnegative(),
    totalEffectiveLines: z.number().int().nonnegative(),
    sourceEffectiveLines: z.number().int().nonnegative(),
    testEffectiveLines: z.number().int().nonnegative(),
  }),
  sourceBuckets: z.array(projectCodeSizeSourceBucketSchema).length(8),
  testBuckets: z.array(projectCodeSizeTestBucketSchema).length(3),
  warnings: z.array(z.object({
    code: z.enum(["classification_conflict"]),
    count: z.number().int().positive(),
  })),
  createdAt: dateLikeSchema,
  updatedAt: dateLikeSchema,
});
```

`shared/schemas/project-detail.schema.ts` は Tech Stack schema を importし、`projectDetailMetricsSchema` へ次を追加する。

```ts
codeSizeSnapshot: projectCodeSizeSnapshotSchema.nullable();
```

既存 field は削除・rename しない。

## Persistence Contract

### Table

`api/db/tech-stack-schema.ts` に `projectCodeSizeSnapshots` を追加する。

```ts
export const projectCodeSizeSnapshots = sqliteTable(
  "project_code_size_snapshots",
  {
    ...commonColumns,
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").default(1).notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    measuredAt: integer("measured_at", { mode: "timestamp" }).notNull(),
    scanDurationMs: integer("scan_duration_ms").notNull(),
    gitHead: text("git_head"),
    gitDirty: integer("git_dirty", { mode: "boolean" }),
    totalFiles: integer("total_files").notNull(),
    sourceFiles: integer("source_files").notNull(),
    testFiles: integer("test_files").notNull(),
    totalEffectiveLines: integer("total_effective_lines").notNull(),
    sourceEffectiveLines: integer("source_effective_lines").notNull(),
    testEffectiveLines: integer("test_effective_lines").notNull(),
    resultJson: text("result_json", { mode: "json" }).notNull(),
  },
  (table) => ({
    repositoryUniqueIdx: uniqueIndex(
      "project_code_size_snapshots_repository_uidx",
    ).on(table.repositoryId),
  }),
);
```

`result_json` には `id`, `repositoryId`, `createdAt`, `updatedAt` を除く structured payload を保存してよい。repository mapper が DB columns と JSON を統合し、最終 shared schema で parse する。

denormalized total columns は次のために保持する。

- JSON 全体を読まず Project-level summary を query できる。
- 将来履歴 table へ移行するときの index / trend query に備える。
- JSON payload と total columns の不整合を repository test で検出する。

### Bootstrap

新規 `ensureTechStackTables()` に `CREATE TABLE IF NOT EXISTS` と unique index を追加し、`api/db/bootstrap.ts` から呼ぶ。

- additive create のみ。
- 既存 table の rebuild はしない。
- backfill はしない。
- 既存 Project は row が無いため `codeSizeSnapshot = null` になる。
- bootstrap を複数回実行しても安全であること。

同じ schema を正式な Drizzle migration に追加する。

- migration file 名は実装時点の次番号を使う。計画時点で番号を予約しない。
- migration は table と unique index の additive create だけにする。
- SQL migration、Drizzle table definition、runtime bootstrap の column、nullability、FK、index 名を一致させる。
- migration metadata は手書きで不整合を作らず、repo-native generate / journal 手順に従う。
- fresh DB、既存 DB upgrade、bootstrap 再実行の3経路をテストする。

### Upsert

repository API:

```ts
getProjectCodeSizeSnapshot(repositoryId: string): Promise<ProjectCodeSizeSnapshot | null>

upsertProjectCodeSizeSnapshot(input: {
  repositoryId: string;
  measured: MeasuredProjectCodeSize;
}): Promise<ProjectCodeSizeSnapshot>
```

保存順序:

1. 全 inventory と line count を完了する。
2. bucket と total の不変条件を検証する。
3. shared schema 相当の service validation を通す。
4. 1つの `INSERT ... ON CONFLICT(repository_id) DO UPDATE` で置き換える。
5. DB から mapper 済み snapshot を返す。

計測途中で既存 row を削除しない。失敗時に `null` や部分結果で上書きしない。

### Latest-only semantics

初期実装の unique index により、Project ごとに保存値は1件である。

- 再計測成功: 同じ row id を維持して update しても、新しい row id へ置換してもよいが、API 上は最新1件だけ返す。
- 推奨: upsert で既存 `id`, `createdAt` を維持し、`updatedAt`, `measuredAt`, payload を更新する。
- 履歴が必要になった時点で別 plan を作り、unique index、retention、trend UI を設計する。

## API Contract

### Read

既存 route:

```http
GET /api/repositories/:id/project-detail/metrics
```

response へ additive に追加する。

```json
{
  "stackProfile": {},
  "projectMeta": {},
  "codeSizeSnapshot": null,
  "runs": {},
  "llmUsage": {},
  "health": {}
}
```

`getProjectDetailMetrics()` の既存 parallel query に `techStackService.getRepositoryTechStackOverview(repositoryId)` を追加する。Tech Stack service が `stackProfile` と nullable `codeSizeSnapshot` を返し、Project Detail service は response へ合成するだけにする。

GET は計測を開始しない。filesystem mutation も行わない。ただし既存 ProjectMeta refresh の現行挙動は今回変更しない。

### Measure and save

新規 route は `api/modules/techStack/tech-stack.routes.ts` が所有し、`api/app.ts` から mount する。

```http
POST /api/repositories/:id/tech-stack/code-size/measure
Content-Type: application/json

{}
```

request body は empty object schema とするか body 自体を省略可能にする。path、分類 rule、limit をクライアント入力にしない。

成功:

```http
200 OK
```

body は `projectCodeSizeSnapshotSchema`。

処理:

1. `nightworkers.repository.getRepository(id)` で repository を取得し、未検出なら `NotFoundError`。
2. `repository.localPath` の存在と directory を確認。
3. 同じ process 内で同一 repository の scan が進行中なら、single-flight Promise を共有する。
4. inventory、count、classification、aggregation。
5. validation。
6. upsert。
7. 保存済み snapshot を返す。

error:

| Status | Code | Condition |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | repository root が directory でない、file limit 超過、invariant failure |
| 404 | `NOT_FOUND` | repository が存在しない |
| 500 | default | 予期しない I/O または DB failure |

エラー本文は既存 `withOpenApiRouteError` を使用する。固定成功文へ置換せず、actionable な message と safe details を返す。

### Single-flight

module-local に次を持つ。

```ts
const measurementsInFlight = new Map<
  string,
  Promise<ProjectCodeSizeSnapshot>
>();
```

同じ repository への重複 POST は同じ Promise を await し、同じ保存結果を返す。完了・失敗の双方で `finally` から Map entry を削除する。

異なる repository は並行計測できる。

## Backend Implementation Design

### 変更対象

新規:

- `api/modules/techStack/index.ts`
- `api/modules/techStack/tech-stack.routes.ts`
- `api/modules/techStack/tech-stack.service.ts`
- `api/modules/techStack/tech-stack.repository.ts`
- `api/modules/techStack/project-stack-detector.ts`
- `api/modules/techStack/project-stack-context.ts`
- `api/modules/techStack/project-file-inventory.ts`
- `api/modules/techStack/effective-line-counter.ts`
- `api/modules/techStack/project-code-size-classifier.ts`
- `api/modules/techStack/project-code-size.service.ts`
- `shared/schemas/tech-stack.schema.ts`
- `api/db/tech-stack-schema.ts`
- `api/db/tech-stack-schema-bootstrap.ts`
- `tests/tech-stack-context.test.ts`
- `tests/tech-stack-code-size.test.ts`
- `tests/tech-stack-backend.test.ts`

変更:

- `shared/schemas/project-detail.schema.ts`
- `api/db/bootstrap.ts`
- `api/app.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `tests/project-detail-backend.test.ts`
- `tests/project-detail-backend/mission-core.cases.ts` の既存 metrics expectation
- `api/modules/specification/plan-mode-project-stack-context.ts`

移動後に削除:

- `api/services/project-stack-context.ts`
- `tests/project-stack-context.test.ts`

`api/modules/project-detail/project-detail.repository.ts` と `project-detail.routes.ts` に code size 固有実装を追加しない。

### Service result before persistence

DB fieldsを含まない内部型を使う。

```ts
type MeasuredProjectCodeSize = {
  schemaVersion: 1;
  algorithmVersion: "effective-lines-v1";
  measuredAt: Date;
  scanDurationMs: number;
  inventory: ProjectCodeSizeInventorySummary;
  git: ProjectCodeSizeGitSnapshot;
  totals: ProjectCodeSizeTotals;
  sourceBuckets: ProjectCodeSizeSourceBucket[];
  testBuckets: ProjectCodeSizeTestBucket[];
  warnings: ProjectCodeSizeWarning[];
};
```

file-level intermediate は service 実行中だけ保持し、DB / API へ返さない。

```ts
type ClassifiedFileMeasurement = {
  relativePath: string;
  ownershipRoot: string;
  files: 1;
  effectiveLines: number;
  target:
    | { type: "source"; category: ProjectCodeSizeSourceCategory }
    | { type: "test"; kind: ProjectCodeSizeTestKind };
  classificationSource: ProjectCodeSizeClassificationSource;
};
```

### Git snapshot

計測開始時に次を読む。

```bash
git -C <repoRoot> rev-parse HEAD
git -C <repoRoot> status --porcelain --untracked-files=normal
```

- HEAD が読めれば `status = available`。
- dirty は status output が空でないこと。
- Git unavailable では `head = null`, `shortHead = null`, `dirty = null`。
- Git snapshot failure は filesystem measurement 自体の失敗理由にしない。

### Aggregation order

bucket は固定順で初期化する。

```ts
const SOURCE_CATEGORY_ORDER = [
  "frontend",
  "backend",
  "batch",
  "script",
  "shared",
  "database",
  "desktop",
  "other",
] as const;

const TEST_KIND_ORDER = ["unit", "e2e", "other"] as const;
```

Map の insertion order や filesystem 順序を API contract にしない。roots は path の locale-independent lexical order で返す。

## Frontend Contract

### Command

`src/modules/techStack/api/techStackCommands.ts` に追加し、`src/modules/techStack/index.ts` から公開する。

```ts
export function measureProjectCodeSize(repositoryId: string) {
  return apiFetch(
    `/api/repositories/${repositoryId}/tech-stack/code-size/measure`,
    jsonRequest("POST", {}),
  );
}
```

`tests/tech-stack-frontend.test.tsx` または command contract test で URL、method、body を固定する。`nightWorkersCommands.ts` へ forwarding function を残さない。

### ProjectDetailScreen state

既存 `metrics` state を正本にする。コードサイズ専用 duplicate state は作らない。

```ts
async function handleMeasureCodeSize() {
  await runAction("code-size:measure", async () => {
    const snapshot = await readJsonResponse<ProjectCodeSizeSnapshot>(
      await measureProjectCodeSize(project.id),
    );
    setMetrics((current) => ({
      ...current,
      codeSizeSnapshot: snapshot,
    }));
  });
}
```

`src/modules/techStack` の `TechStackPanel` へ次を渡す。

```ts
codeSizeSnapshot: ProjectCodeSizeSnapshot | null;
currentGitHead: string | null;
measurementBusy: boolean;
onMeasureCodeSize: () => void;
```

既存 stack focus refresh が新しい metrics response を取得した場合、保存済み `codeSizeSnapshot` も response から復元される。

### Project Detail metrics compatibility

`src/modules/nightworkers/components/project-detail/data.ts` に追加する。

```ts
codeSizeSnapshot: null,
```

既存テスト fixture の metrics object も additive field に追従させる。任意 field にして型エラーを回避するのではなく、response contract 上は required nullable とする。

Project Detail は `TechStackPanel` と `measureProjectCodeSize` を `@/modules/techStack` からだけ importする。Tech Stack component 内部 file への deep import は行わない。

## UI Blueprint

### 配置

`src/modules/techStack/components/TechStackPanel.tsx` 内を次の順にする。

```text
技術スタック heading
  -> 既存 stack KPI 3枚
  -> 新規 ProjectCodeSizePanel
  -> 既存「検出された技術」table
```

コードサイズを技術一覧より上に置く理由:

- Project 全体の規模を先に把握できる。
- stack summary と source reality を同じ上段で比較できる。
- 技術一覧 table の横幅やスクロール挙動を変更しない。

### Component

Tech Stack feature 内で次の2 component に分ける。

```text
src/modules/techStack/components/TechStackPanel.tsx
src/modules/techStack/components/ProjectCodeSizePanel.tsx
```

既存 `StackSummaryBadge` も `src/modules/techStack/components/StackSummaryBadge.tsx` へ移す。`src/modules/nightworkers/components/project-detail/ProjectDetailStack.tsx` は移行完了時に削除する。

推奨 props:

```ts
type ProjectCodeSizePanelProps = {
  snapshot: ProjectCodeSizeSnapshot | null;
  currentGitHead: string | null;
  busy: boolean;
  onMeasure: () => void;
};
```

### Header

左:

- icon。
- title: 「プロジェクトサイズ」。
- description: 「空行・コメントのみの行を除いた実コード行を、用途別に集計します。」

右:

- 未計測: 「計測して保存」。
- 計測済み: 「再計測して保存」。
- busy: spinner + 「計測中…」、button disabled。

既存 primary action の style token を再利用する。新しい独自色を追加しない。

### Empty state

snapshot が `null` の場合:

- 合算 KPI や0件 tableを「保存値」として表示しない。
- dashed empty block を表示する。
- 文言: 「コードサイズはまだ計測されていません。登録済みProjectの実ファイルを計測して保存できます。」
- 計測 button を header に表示する。

### Summary KPI

計測済みの場合、4枚表示する。

1. 合算実ステップ。
2. 通常ソース。
3. テスト。
4. 計測ファイル数。

値は `toLocaleString()` で表示する。`KpiTile` の truncate により数値が見えなくならないことを確認し、必要ならコードサイズ専用 tile で `title` を付ける。

合算の下に式を表示する。

```text
合計 123,456 = 通常ソース 100,000 + テスト 23,456
```

この式は API 値から再計算せず、snapshot totals を表示しつつ component helper で invariant を assertion/test する。

### Stacked overview bar

外部 chart library を追加せず、CSS flex または grid で horizontal stacked bar を作る。

- source category と test kind を区別できる既存 theme color の濃淡を使う。
- 0 line segment は描画しない。
- visual bar のみで情報を伝えず、必ず table/rows を併設する。
- `role="img"` と合算内訳の `aria-label` を付ける。
- color contrast に依存しない label と数値を置く。

### Source genre panel

見出し: 「通常ソース内訳」。

全8 category を固定順で表示する。

各行:

- category label。
- effective lines。
- source total に対する割合。
- file count。
- roots。0件なら `—`。

割合は表示時に計算する。

```ts
sourceTotal === 0 ? 0 : (bucket.effectiveLines / sourceTotal) * 100
```

小数1桁表示。保存 payload には percentage を持たない。

### Test panel

見出し: 「テスト内訳」。

3行を固定順で表示する。

- Unit テスト。
- E2E テスト。
- その他テスト。

各行の項目は source genre と同じ。割合の分母は `testEffectiveLines`。

### Measurement metadata

panel footer に表示する。

- 保存日時。
- scan duration。
- Git short HEAD または「Git未検出」。
- 計測時 dirty なら「未コミット変更を含む」。
- inventory source: Git / filesystem。
- skip count 合計。0より大きい場合だけ理由別 summary を表示する。

保存時 `git.head` と `metrics.projectMeta.git.head` が両方あり不一致なら「保存後にHEADが更新されています」を warning badge で表示する。dirty state の現在値は metrics GET から得られないため、「現在dirtyである」と推測表示しない。

### Running state

- 以前の snapshot を表示したままにする。
- button を disabled にする。
- heading 付近に進行中表示を出す。
- table を skeleton へ置き換えない。
- 二重 click を防ぐ。

### Error state

既存 `ProjectDetailScreen` の message surface を使う。以前の snapshot は保持する。

- API の message を表示する。
- 固定の「計測に失敗しました」だけへ置換しない。
- retry は同じ button から行う。
- error で snapshot を `null` にしない。

### Responsive layout

- summary KPI: small 1列、medium 2列、large 4列。
- breakdown: small 1列、large 2列。
- roots は wrap または横スクロール可能な compact text。
- 既存 Project Detail shell の横スクロールを増やさない。

### i18n

最低限、次の namespace を追加する。

```text
techStack.codeSize.*
```

必要 key:

- title / description。
- measure / remeasure / measuring。
- empty。
- total / source / tests / files。
- equation。
- source breakdown / test breakdown。
- category 8種。
- test kind 3種。
- effective lines / percentage / roots。
- measuredAt / scanDuration / gitUnavailable / dirtyAtMeasurement。
- inventory source。
- savedHeadOutdated。
- skipped summary と skip reason。

日本語・英語 dictionary parity test を通す。

## Migration and Compatibility

### Additive migration

- 新規 tableだけを追加する。
- 実装時点の次番号で `drizzle/migrations/<next>_tech_stack_code_size.sql` を追加する。
- migration metadata と runtime bootstrap を同じ schema に揃える。
- 既存 column を変更しない。
- 既存 response field を削除しない。
- metrics response の新規 field は required nullable。
- 未計測 Project は `null` で互換表示する。

### Existing ProjectMeta

`ProjectMeta` は Overview badge、ontology enablement、file scale 判定に使われる。今回その source of truth を置き換えない。

将来 ProjectMeta とコードサイズ scanner を統合する場合も、別 plan で次を扱う。

- dirty worktree cache invalidation。
- file scale threshold 再計算。
- sourceLoc の意味変更による downstream 影響。
- existing `project_meta` JSON version migration。

### Algorithm version

初期値は `effective-lines-v1`。

対象 extension、comment lexer、分類 rule の意味を変えて既存値との比較可能性が失われる場合は、algorithm version を上げる。単なる bug fix で上げるかは、保存値が大きく変わるかを fixture で判断し、計画書または release note に記録する。

## Security and Safety Invariants

1. repository root は DB 登録値だけを使う。
2. request から任意 path を受け取らない。
3. symlink を追わない。
4. resolved path boundary を毎回確認する。
5. shell を使用しない。
6. Project の package script、config module、source module を実行しない。
7. 全ファイル本文、absolute path、secret-like content を DB / response / log に保存しない。
8. error response へ大量の file path を含めない。
9. hard limit 超過を部分成功にしない。
10. repository delete の cascade を維持する。

## Implementation Phases

### Phase 0: Baseline Characterization

目的:

- 既存 contract、責務の分散、回帰範囲を固定する。

作業:

1. `getProjectDetailMetrics` の現行 response fixture を確認する。
2. `ProjectDetailStack` と `StackSummaryBadge` の現行 markup test を確認する。
3. `detectProjectStackProfile` と `renderProjectStackContext` の現行 fixture を固定する。
4. `plan-mode-project-stack-context.ts` の出力が現行 stack context を含むことを固定する。
5. `project-meta.service.ts` の tracked-only、physical LOC semantics を characterization test または調査記録で固定する。
6. current focused tests を実行する。

コマンド:

```bash
bunx vitest run \
  tests/project-stack-context.test.ts \
  tests/plan-mode-project-stack-context.test.ts \
  tests/project-detail-backend.test.ts \
  tests/project-detail-screen.test.tsx \
  tests/frontend-utility-components.test.tsx \
  tests/frontend-project-detail-actions.test.tsx \
  tests/nightworkers-commands-contract.test.ts
```

停止条件:

- 今回と無関係な baseline failure がある場合、既存 failure と新規 failure を分離して記録する。
- user-owned dirty files を plan scope に取り込まない。

### Phase 1: Tech Stack Domain Foundation and Backend Migration

対象:

- `shared/schemas/tech-stack.schema.ts`
- `shared/schemas/project-detail.schema.ts`
- `api/modules/techStack/index.ts`
- `api/modules/techStack/project-stack-detector.ts`
- `api/modules/techStack/project-stack-context.ts`
- `api/modules/techStack/tech-stack.service.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `api/modules/specification/plan-mode-project-stack-context.ts`
- `tests/tech-stack-context.test.ts`
- `tests/plan-mode-project-stack-context.test.ts`

作業:

1. `ProjectStackTechnology` / `ProjectStackProfile` schema を `tech-stack.schema.ts` へ移す。
2. `project-detail.schema.ts` から import/re-export し、metrics schema の互換性を維持する。
3. stack detector と context renderer を `api/modules/techStack` へ移す。
4. `getRepositoryTechStackOverview()` の profile-only 版を作る。code size はこの Phase では `null` placeholder でよい。
5. Project Detail service と Plan Mode adapter を Tech Stack public API importへ切り替える。
6. 既存 test を新 owner の `tests/tech-stack-context.test.ts` へ移す。
7. import 検索で旧 service の consumer が0になったら `api/services/project-stack-context.ts` と旧 test file を削除する。

完了条件:

- stack profile response が移行前と一致する。
- Plan Mode stack context が移行前と一致する。
- `api/modules/project-detail` が detector/context implementation を持たない。
- `api/services/project-stack-context.ts` への import が0で、file 自体も削除される。
- Tech Stack backend public API 以外の deep import が他 domain にない。

focused test:

```bash
bunx vitest run \
  tests/tech-stack-context.test.ts \
  tests/plan-mode-project-stack-context.test.ts \
  tests/project-detail-backend.test.ts
```

### Phase 2: Frontend Tech Stack Domain Migration

対象:

- `src/modules/techStack/index.ts`
- `src/modules/techStack/components/StackSummaryBadge.tsx`
- `src/modules/techStack/components/TechStackPanel.tsx`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/tech-stack-frontend.test.tsx`
- `tests/project-detail-screen.test.tsx`

作業:

1. `StackSummaryBadge` と stack profile table を `src/modules/techStack` へ移す。
2. `TechStackPanel` を feature public component として export する。
3. Project Detail screen と Overview を `@/modules/techStack` importへ切り替える。
4. 既存 `projectDetail.stack.*` i18n key を `techStack.profile.*` へ移す。
5. stack-specific markup test を `tests/tech-stack-frontend.test.tsx` へ移す。
6. Project Detail test は tab placement と props integration だけに縮小する。
7. consumer が0になったら旧 `ProjectDetailStack.tsx` を削除する。

完了条件:

- visible stack profile が移行前と同じである。
- Overview の stack badge が維持される。
- `ProjectDetailStack.tsx` が削除される。
- Project Detail 配下に stack table/formatting implementation が残らない。
- `src/modules/techStack` の public entrypoint だけが外部 consumer に使われる。
- 日英 dictionary parity が成功する。

focused test:

```bash
bunx vitest run \
  tests/tech-stack-frontend.test.tsx \
  tests/project-detail-screen.test.tsx \
  tests/frontend-utility-components.test.tsx
```

### Phase 3: Deterministic Code Size Scanner in Tech Stack Domain

対象:

- `shared/schemas/tech-stack.schema.ts`
- `api/modules/techStack/project-file-inventory.ts`
- `api/modules/techStack/effective-line-counter.ts`
- `api/modules/techStack/project-code-size-classifier.ts`
- `api/modules/techStack/project-code-size.service.ts`
- `tests/tech-stack-code-size.test.ts`

作業:

1. code size enum、bucket、snapshot schema を追加する。
2. Git / filesystem inventory を実装する。
3. size、binary、symlink、path boundary filter を実装する。
4. comment-aware effective line counter を実装する。
5. test/source classifier と aggregation を実装する。
6. invariant validator を実装する。
7. multi-language、classification、limit fixture を追加する。

完了条件:

- DB なしで temporary repository fixture を計測できる。
- LF / CRLF、comment-only、inline comment、string 中 comment marker が期待値になる。
- NightWorkers path fixture が分類表どおりになる。
- すべての file が高々1 bucket に入る。
- total invariant が成立する。
- scanner/classifier が `api/modules/techStack` 外へ分散していない。

focused test:

```bash
bunx vitest run tests/tech-stack-code-size.test.ts
```

### Phase 4: Tech Stack Persistence, Route, and Project Detail Composition

対象:

- `api/db/tech-stack-schema.ts`
- `api/db/tech-stack-schema-bootstrap.ts`
- `api/db/bootstrap.ts`
- `drizzle/migrations/<next>_tech_stack_code_size.sql`
- `drizzle/migrations/meta/_journal.json` と必要な snapshot metadata
- `api/modules/techStack/tech-stack.repository.ts`
- `api/modules/techStack/tech-stack.service.ts`
- `api/modules/techStack/tech-stack.routes.ts`
- `api/modules/techStack/index.ts`
- `api/app.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `shared/schemas/project-detail.schema.ts`
- `tests/tech-stack-backend.test.ts`
- `tests/tech-stack-service.test.ts`
- `tests/project-detail-backend.test.ts`

作業:

1. Tech Stack table、正式 migration、idempotent bootstrap を追加する。
2. mapper、get、upsert を Tech Stack repository に追加する。
3. measure route と single-flight を Tech Stack router/service に追加する。
4. `api/app.ts` に router を mount する。
5. `getRepositoryTechStackOverview()` が profile + latest snapshot を返すようにする。
6. Project Detail metrics GET に nullable latest snapshot を合成する。
7. success、reload、overwrite、failure preservation、isolation、cascade をテストする。

完了条件:

- migration upgrade、bootstrap fresh DB、bootstrap再実行のすべてが成功する。
- Tech Stack POST 成功直後と Project Detail metrics GET の snapshot が一致する。
- 2回目成功で最新値に置き換わる。
- 2回目失敗で1回目の保存値が残る。
- repository delete 後に row が残らない。
- code size route/repository が `api/modules/project-detail` に存在しない。

focused test:

```bash
bunx vitest run \
  tests/tech-stack-code-size.test.ts \
  tests/tech-stack-service.test.ts \
  tests/tech-stack-backend.test.ts \
  tests/project-detail-backend.test.ts
```

### Phase 5: Code Size Frontend in Tech Stack Domain

対象:

- `src/modules/techStack/api/techStackCommands.ts`
- `src/modules/techStack/components/ProjectCodeSizePanel.tsx`
- `src/modules/techStack/components/TechStackPanel.tsx`
- `src/modules/techStack/model/codeSizePresentation.ts`
- `src/modules/techStack/index.ts`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/data.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/tech-stack-frontend.test.tsx`
- `tests/frontend-project-detail-actions.test.tsx`

作業:

1. Tech Stack feature command を追加する。
2. empty、saved、busy、stale HEAD、skip summary を描画する。
3. KPI、合算式、stacked bar、source/test breakdown を追加する。
4. Project Detail は measure callback と metrics state 更新だけを接続する。
5. responsive、keyboard、ARIA、theme token を確認する。
6. `techStack.codeSize.*` の日英 dictionary を追加する。

完了条件:

- button click 1回につき Tech Stack POST 1回。
- busy 中は二重 POST しない。
- success response が即時表示 state に入る。
- error で以前の snapshot が消えない。
- focus refresh が自動 measure POST を起こさない。
- 未計測時に0を保存値のように見せない。
- 合算式、source 8 category、test 3 kind、roots が表示される。
- Project Detail 配下に code size presentation helper が残らない。

focused test:

```bash
bunx vitest run \
  tests/tech-stack-frontend.test.tsx \
  tests/project-detail-screen.test.tsx \
  tests/frontend-project-detail-actions.test.tsx
```

### Phase 6: E2E Acceptance

対象:

- `tests/e2e/project-code-size.spec.ts` または既存 Project Detail E2E suite。

scenario:

1. source、unit test、e2e test を持つ deterministic fixture Project を登録する。
2. Project Detail の技術スタック tab を開く。
3. 未計測 empty state を確認する。
4. 「計測して保存」を押す。
5. 合計、通常ソース、テスト、ジャンル、Unit、E2E を確認する。
6. 画面再読込または tab 再入場を行う。
7. 同じ保存値が復元されることを確認する。

fixture の期待値はテスト内で明示し、現在の NightWorkers repository 全体の変動値を snapshot assertion に使わない。

focused test:

```bash
bun run test:e2e -- tests/e2e/project-code-size.spec.ts
```

### Phase 7: Dependency Audit and Integrated Closeout

移行残存確認:

```bash
rg -n "api/services/project-stack-context|ProjectDetailStack" api src shared tests
rg -n "modules/techStack/.+/.+" api/modules/project-detail api/modules/specification src/modules/nightworkers
rg -n "projectDetail\.stack\.|projectDetail\.codeSize\." src tests
```

期待:

- 旧 implementation path の import は0。
- 他 domain は Tech Stack public entrypoint または shared schema だけを使う。
- 旧 i18n key は0。
- plan/archive文書など歴史的参照だけが必要なら、実装 import audit と分けて扱う。

順序:

```bash
bunx vitest run \
  tests/tech-stack-context.test.ts \
  tests/tech-stack-code-size.test.ts \
  tests/tech-stack-backend.test.ts \
  tests/tech-stack-frontend.test.tsx \
  tests/plan-mode-project-stack-context.test.ts \
  tests/project-detail-backend.test.ts \
  tests/project-detail-screen.test.tsx \
  tests/frontend-utility-components.test.tsx \
  tests/frontend-project-detail-actions.test.tsx \
  tests/nightworkers-commands-contract.test.ts

bun run typecheck
bun run verify:base
bun run test:e2e -- tests/e2e/project-code-size.spec.ts
```

repo-wide acceptance:

```bash
bun run verify
```

`verify` が repo policy 上 base checks のみであることを踏まえ、focused backend/UI/E2E を省略しない。release closeout や broader regression が要求された場合は `bun run verify:full` を追加する。

すべての acceptance を満たした後だけ、この文書を `spec/archive/project-code-size-measurement-implementation-plan.md` へ移す。

## Test Matrix

### Effective line counter

- empty file = 0。
- whitespace only = 0。
- line comment only = 0。
- multi-line block comment only = 0。
- code + inline comment = 1。
- comment terminator + code = 1。
- string literal containing comment marker = 1。
- CRLF / LF parity。
- BOM handling。
- final newline parity。
- Python docstring を code として数える。
- HTML comment と markup の混在。
- SQL `--` / block comment。

### Inventory

- tracked file を含む。
- untracked non-ignored file を含む。
- gitignored file を含まない。
- generated segment を含まない。
- symlink を追わない。
- binary を除外する。
- 2 MiB 超を理由付きで除外する。
- missing/unreadable が全体 crash にならない。
- Git unavailable で filesystem fallback。
- 50,000超は保存可能な partial result にしない。

### Classification

- test precedence over source category。
- E2E precedence over generic `.spec`。
- integration precedence over generic test path。
- exact segment only。
- deepest explicit segment wins。
- ownership root rule。
- monorepo root rule。
- frontend-only manifest。
- backend-only manifest。
- mixed manifest + sibling backend root。
- ambiguous mixed manifest -> other。
- fallback -> other。
- canonical bucket order と0件 bucket。

### Persistence/API

- no snapshot -> null。
- first measure -> saved response。
- metrics reload -> same response。
- second measure -> overwrite latest。
- failed remeasure -> old response remains。
- concurrent same repository -> one scan / same result。
- concurrent different repositories -> isolated。
- repository delete -> cascade。
- bootstrap idempotency。
- JSON totals と columns の一致。

### UI

- empty state。
- saved state。
- combined equation。
- source rows 8種。
- test rows 3種。
- zero denominator percentage。
- root labels。
- busy retains old data。
- error retains old data。
- stale HEAD badge。
- dirty-at-measurement badge。
- skipped files summary。
- button accessible name / disabled state。
- stacked bar aria label。
- i18n parity。

### Feature domain boundary

- existing stack detector output parity after move。
- existing Plan Mode stack context parity after move。
- existing Stack summary/profile markup parity after move。
- `api/services/project-stack-context.ts` が削除済み。
- `ProjectDetailStack.tsx` が削除済み。
- `projectDetail.stack.*` / `projectDetail.codeSize.*` key が残っていない。
- Project Detail backend が Tech Stack public service だけを利用する。
- Project Detail frontend が `@/modules/techStack` public entrypoint だけを利用する。
- Tech Stack backend が Project Detail service/repository を import しない。
- Tech Stack frontend が Project Detail internal component/helper を import しない。
- shared schema が runtime module を import しない。

## Observability

計測開始・成功・失敗を server log に出す場合、次の集計情報だけを含める。

```text
repositoryId
inventorySource
listedFiles
measuredFiles
totalEffectiveLines
scanDurationMs
skip counts
error code
```

absolute repository path、個別 file path、file content は通常 log に出さない。

初期実装では新しい task event、artifact、background process record を作らない。これは user-triggered synchronous filesystem measurement であり、Task Run lifecycle とは別である。

## Risks and Mitigations

### High: 「実ステップ」の意味が言語ごとにずれる

対策:

- logical statement ではなく physical effective line と明記する。
- `algorithmVersion` を保存する。
- multi-language fixture を正本にする。
- UI の補助説明を常時表示する。

### High: テストが通常ソースにも二重計上される

対策:

- test classification を最優先する。
- union type で target を source/test の排他にする。
- 保存前 invariant validation。
- test path と source genre が競合する fixture。

### High: path 名の誤分類

対策:

- substring ではなく exact segment。
- deepest explicit segment と ownership root を分ける。
- `worker-tools` と `workers` の回帰 fixture。
- 不明は other へ入れ、捨てない。
- roots と classification source を保存する。

### High: 巨大 Project で UI request が長時間化する

対策:

- file count / size hard limit。
- bounded concurrency。
- single-flight。
- old snapshot を表示したまま busy にする。
- 初期実装で arbitrary background queue を増やさない。
- 実測で同期 request が許容不能と判明した場合だけ、別 plan で durable run 化する。

### Medium: `ProjectMeta` とコードサイズ値が違って見える

対策:

- UI 上で `sourceLoc` と新値を同じ名称にしない。
- 新値は「空行・コメントのみ除外」と明記する。
- ProjectMeta の既存 semantics を変更しない。

### Medium: Git HEAD は同じでも dirty 内容が変わる

対策:

- 自動 cache 判定にしない。
- 毎回の明示操作で worktree を読み直す。
- 保存時 dirty flag を表示する。
- 現在 dirty かどうかを古い snapshot から推測しない。

### Medium: tracked generated source が計測される

対策:

- known generated directory を明示除外する。
- 自動生成判定を過剰に推測しない。
- 除外ルール変更は algorithm version と fixture で管理する。

### Medium: JSON payload と denormalized columns がずれる

対策:

- 1つの measured object から両方を生成する。
- repository mapper で schema parse。
- DB test で一致を検証する。

### High: リファクタリング後も旧責務が残り二重実装になる

対策:

- Phase 1 / 2 で既存 stack detector と UI を先に移す。
- code size を旧 Project Detail 配下へ一度も実装しない。
- 最終 Phase で旧 file path と i18n key を `rg` 監査する。
- compatibility re-export は shared schema に限定し、runtime forwarding shim は削除する。

### Medium: feature domain 化で Project Detail metrics contract が壊れる

対策:

- response field と URL は additive compatibility を維持する。
- Project Detail service は Tech Stack overview の合成だけにする。
- backend parity test を移行前に採取し、移行直後に実行する。
- detector移動、scanner追加、DB追加、UI追加を別 Phase に分ける。

## Suggested Review / Commit Boundaries

実装を分ける場合は次の境界を推奨する。

1. `refactor(tech-stack): establish feature domain`
   - shared stack schema、backend detector/context、frontend stack components、public entrypoints、旧file削除。
2. `feat(tech-stack): add deterministic code size scanner`
   - code size contract、inventory、counter、classifier、unit tests。
3. `feat(tech-stack): persist and expose code size snapshot`
   - DB adapters、Tech Stack repository/service/route、Project Detail metrics composition、backend tests。
4. `feat(tech-stack): show saved project code size`
   - feature command、component、presentation model、i18n、frontend tests。
5. `test(tech-stack): cover measurement persistence flow`
   - E2E、dependency audit、closeout fixes。

同じ commit にまとめる場合も、この順序で実装・検証する。

## Completion Checklist

- [x] `api/modules/techStack` が backend Tech Stack実装の正本である。
- [x] `src/modules/techStack` が frontend Tech Stack実装の正本である。
- [x] `shared/schemas/tech-stack.schema.ts` が Tech Stack schemaの正本である。
- [x] `api/db/tech-stack-schema*.ts` が DB infrastructure adapter である。
- [x] 正式 SQL migration と migration metadata が追加されている。
- [x] SQL migration、Drizzle schema、runtime bootstrap が一致している。
- [x] `api/services/project-stack-context.ts` が削除されている。
- [x] `ProjectDetailStack.tsx` が削除されている。
- [x] Project Detail は Tech Stack public API だけを利用している。
- [x] Specification / Plan Mode は Tech Stack public API だけを利用している。
- [x] 旧 Tech Stack i18n key が残っていない。
- [x] runtime forwarding shim や二重実装が残っていない。
- [x] Shared enums と snapshot schema が追加されている。
- [x] `ProjectDetailMetrics.codeSizeSnapshot` が required nullable である。
- [x] Git inventory が tracked + untracked non-ignored を取得する。
- [x] filesystem fallback が symlink を追わない。
- [x] line counter が comments / strings / CRLF を fixture で固定している。
- [x] test/source classification が排他的である。
- [x] source 8 category が canonical order で返る。
- [x] test 3 kind が canonical order で返る。
- [x] total invariants を保存前に検証している。
- [x] DB schema と bootstrap が一致している。
- [x] Project ごとの latest row unique がある。
- [x] measure POST が single-flight である。
- [x] GET metrics が計測を副作用として起動しない。
- [x] failed remeasure が old snapshot を壊さない。
- [x] empty / saved / busy / error UI がある。
- [x] 合算式が表示される。
- [x] source genre と test kind が別 panel で表示される。
- [x] root、files、effective lines が確認できる。
- [x] skip summary と計測 metadata が確認できる。
- [x] stale HEAD を過不足なく表示する。
- [x] 日本語・英語 i18n が揃っている。
- [x] focused backend tests が成功している。
- [x] focused frontend tests が成功している。
- [x] typecheck が成功している。
- [x] deterministic E2E が成功している。
- [x] repo-native verify gate が成功している。
- [x] 実装完了後、この文書が `spec/archive/` へ移動されている。

## Implementation Handoff

実装開始時は Phase 0 から進める。最初にコードサイズだけを旧 Project Detail 配下へ追加しない。Phase 1 で backend Tech Stack domain、Phase 2 で frontend Tech Stack domain を確立し、既存 stack detector / UI を移してから、Phase 3 以降で計測・保存・表示を追加する。

実装中の判断基準:

- 表示値を作るために UI が file path を再分類し始めたら、API contract に戻す。
- 保存のために全 file path や content を DB に入れ始めたら、集計 contract に戻す。
- ProjectMeta の意味を変えたくなったら、今回の scope から分離する。
- Tech Stack 固有ロジックを Project Detail 側へ追加したくなったら、Tech Stack public API または props contract に戻す。
- Tech Stack domain が Project Detail internals を import し始めたら、dependency direction 違反として止める。
- custom mapping UI が必要になったら、まず `other` と roots で誤分類を観測し、別 plan にする。
- 同期計測が実測で成立しない場合、推測で background queue を追加せず、計測時間と file count evidence を取って durable run 化を別途設計する。

この計画の初期実装完了点は、技術スタック検出・表示・コードサイズ計測が frontend/backend の `modules/techStack` に集約され、Project Detail が薄い統合境界になったうえで、利用者が明示的に計測し、保存された合算サイズ・ジャンル別サイズ・Unit/E2E別サイズを再読込後も確認できる状態である。
