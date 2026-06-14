# hono-standard 標準テンプレート採用 実装計画

## 概要

NightWorkers が新規 Web アプリを作るとき、技術スタックや既存リポジトリが指定されていない場合に、まっさらなディレクトリへゼロから scaffold するのではなく、`ugnoguchigxp/hono-standard` の固定 tag を標準テンプレートとして取得してから作業を開始する。

初期 default は SQLite / local-first baseline とする。現時点の標準 ref は `sqlite-v1.1.0` であり、`baseline-v1.1.0` も SQLite baseline を指す前提で扱う。NightWorkers 側では `main` branch を直接使わず、再現性のため tag を使う。

期待する成果:

- 新規 Web アプリ作成時の token 消費と scaffolding 失敗を減らす。
- React + Vite + Tailwind CSS + shadcn/ui + Hono + Drizzle + 一般的な security middleware を、未指定時の default として安定適用する。
- PostgreSQL、pgvector、RAG、Cloudflare、Turso、SSR、SSG などは要件がある場合だけ variant / overlay として選ぶ。
- Supervisor の判断は prompt / skill reference 側に置き、llm-provider へ用途別 SystemContext や正規表現分類を増やさない。

主要関係者:

- Product owner: TBD
- Backend / Supervisor owner: TBD
- Worker tools / security policy owner: TBD
- Frontend / Workbench owner: TBD

目標リリース時期:

- TBD。まず hidden / internal default として導入し、実 task で検証後に UI 設定を追加する。

現在の状態:

- `hono-standard` remote には `variant/sqlite`、`variant/postgres`、`variant/pgvector`、`variant/rag`、`variant/cloudflare`、`variant/turso`、`overlay/ssr`、`overlay/ssg` と対応 tag が存在する。
- `designSystem/` は template に同梱されているが、`bun run design-system:sync -- <repo-url> [ref]` により外部 design system repo から同期できる運用が追加されている。NightWorkers 側では clone 一発の再現性を優先し、materialize 時点では同梱 snapshot を使う。
- NightWorkers には template import 後に `package.json` 読み取りと package script verification を要求するガードがある。
- 現在の `run_command` command policy は `git clone` を許可しないため、remote template 取得を shell command に任せる設計はそのままでは成立しない。

## 範囲

### 対象範囲

- `ugnoguchigxp/hono-standard` を NightWorkers の標準 Web app template registry に登録する。
- 技術スタック未指定の新規 Web アプリ作成で、SQLite baseline tag を default として選ぶ Supervisor reference を追加する。
- remote GitHub template を安全に取得する worker tool または service を追加する。
- clone / materialize 後の必須 post-processing と verification gate を定義・実装する。
- SSR / SSG は DB/RAG variant と同時合成せず、必要時だけ単一 overlay tag を standalone snapshot として materialize する。
- Workbench / task context から、どの template ref を使ったかを evidence として追えるようにする。

### 対象外

- `hono-standard` repo 本体の branch / tag / snapshot 管理の実装。
- FastAPI template の導入。
- 既存 Project の stack を強制的に `hono-standard` へ移行すること。
- `hono-standard` の全 variant を NightWorkers repo 内に vendoring すること。
- LLM provider 層に stack 選択ロジックを追加すること。
- ユーザー文言を正規表現や keyword だけで分類して処理分岐すること。

### 非目標

- 「新規 Web アプリなら常に Hono」と固定すること。ユーザー指定、既存 repo、Python 指定、Next.js 指定、静的サイト要件などがある場合はそれを優先する。
- clone した template の既定値をプロダクト要件として無批判に採用すること。DB、auth、CORS、CSRF、CSP、rate limit、deploy runtime は task 要件ごとに確認する。
- `run_command` の unknown command 許可を広げて、汎用 shell で remote clone を許可すること。

## 背景と現状

### 関連ファイル

- `api/services/supervisor/prompt.ts`
  - 空の project root と template import の minimum execution contract を持つ。
  - 外部ディレクトリ template では `copy_directory`、`package.json` 読み取り、verification が要求される。
- `api/services/supervisor/skills/builtin/SKILL.md`
  - Round 1 routing を仮説として扱い、keyword 固定分岐を避ける。
- `api/services/supervisor/skills/builtin/references/*`
  - Supervisor Round 2 で phase / mode / work_kind / overlay に応じて読む reference。
- `api/services/supervisor/skills/registry.ts`
  - 許可された reference path だけを読み込む。新規 reference 種別を追加する場合は `types.ts` と `expectedReferencePaths()` の更新が必要。
- `api/services/worker-tools/dispatcher.ts`
  - worker tool の実行境界。
- `api/services/worker-tools/run-command.ts`
  - command policy に通った単一 command だけ実行する。
- `api/services/worker-tools/command-policy.ts`
  - 現状 `git clone` は read_only / build_test / format / install に該当せず、unknown として拒否される。
- `api/services/supervisor/supervisor-loop.ts`
  - finalize 前に template import verification gap を検出する。
- `tests/supervisor/services-supervisor-01-part01.test.ts`
  - template copy 後に `package.json` 読み取りと verification を要求する regression がある。

### `hono-standard` remote の確認済み ref

2026-06-12 時点で確認した remote ref:

| 用途 | ref |
| --- | --- |
| default baseline | `sqlite-v1.1.0` または `baseline-v1.1.0` |
| SQLite local-first | `variant/sqlite`, `sqlite-v1.1.0` |
| PostgreSQL | `variant/postgres`, `postgres-v1.0.0` |
| pgvector | `variant/pgvector`, `pgvector-v1.0.0` |
| RAG / agentic search | `variant/rag`, `rag-v1.0.0` |
| Cloudflare | `variant/cloudflare`, `cloudflare-v1.0.0` |
| Turso | `variant/turso`, `turso-v1.0.0` |
| SSR overlay | `overlay/ssr`, `overlay-ssr-v1.0.0` |
| SSG overlay | `overlay/ssg`, `overlay-ssg-v1.0.0` |

NightWorkers 側では mutable branch より tag を優先する。branch は調査や明示指定時の fallback に限定する。

## 目標状態

### ユーザーに見える挙動

- ユーザーが空の Project で「Web アプリを作って」「管理画面を作って」などと依頼し、技術スタックを指定していない場合、NightWorkers は `hono-standard` SQLite baseline を取得してから実装する。
- ユーザーが「PostgreSQL で」「Cloudflare Workers で」「Turso で」と指定した場合、対応 variant を選ぶ。
- ユーザーが「RAG が必要」「ナレッジベース検索」「embedding を使う文書検索」「agentic search」と指定した場合、`rag-v1.0.0` を選ぶ。
- ユーザーが「SSR」「SSG」と指定し、DB/RAG variant を同時に指定していない場合、対応 overlay ref を選ぶ。DB/RAG variant と overlay の合成は単一 materialize では行わない。
- ユーザーが別 stack を指定した場合、`hono-standard` は使わないか、参考候補として扱う。
- 完了報告には、使用した template repo、ref、post-processing、verification 結果が含まれる。

### System behavior

```text
Round 1 routing hypothesis
  -> new Web app / empty project / stack unspecified を planning/code work として把握
  -> Round 2 reference に hono_standard_template を追加
  -> template resolver が baseline/variant/overlay を決定
  -> clone_template worker tool が tag を一時領域へ取得
  -> materialize_template が project root に展開
  -> package.json を read_file
  -> post-processing Todo を実行
  -> package script verification
  -> finalize_answer
```

### Success criteria

- 空 project root の新規 Web app 依頼で、LLM が `apply_patch` で Vite/Hono scaffold をゼロから作らない。
- default 選択が SQLite baseline tag であることが run evidence から追える。
- `git clone` を `run_command` の unknown shell command として許可しない。
- template materialize 後に `package.json` inspection と verification が必須のまま維持される。
- `hono-standard` が利用できない場合は、固定エラー文で成功扱いせず、fallback 判断とユーザーへの報告が行われる。

## 設計判断

### Decision 1: default は SQLite baseline tag

判断:

- 技術スタック未指定の Web app では `ugnoguchigxp/hono-standard` の SQLite baseline tag を選ぶ。
- 初期 registry では `baseline` を `sqlite-v1.1.0` に解決する。

理由:

- local-first / Docker 不要 / prototype に強く、未指定時の摩擦が低い。
- `main` branch は変化しうるため、NightWorkers の再現性には tag が適している。

代替案:

- `main` を clone する。
- `variant/postgres` を default にする。

トレードオフ:

- SQLite default は本番 multi-user Web app では不十分な場合がある。その場合は task 要件で PostgreSQL variant へ切り替える。
- tag 固定は最新 template 改善を自動取得しない。registry 更新 PR が必要になる。

戻せるか:

- registry の `baselineRef` を更新すれば戻せる。既存生成済み project への影響はない。

### Decision 2: remote clone は専用 worker tool にする

判断:

- `run_command` で `git clone` を許可するのではなく、`clone_template` または `materialize_template` worker tool を追加する。

理由:

- command policy の unknown command 許可を広げると安全境界が崩れる。
- template repo allowlist、ref allowlist、target path、exclude、provenance 記録を tool schema で制御できる。

代替案:

- `run_command` に `git clone` だけを許可する。
- `fetch_content` で GitHub tarball を落とす。

トレードオフ:

- 専用 tool は実装量が増える。
- ただし clone / archive 展開 / provenance / cleanup を安定して扱える。

戻せるか:

- tool を disabled にして既存 `copy_directory` import に戻せる。

### Decision 3: Supervisor reference に判断を書き、provider には入れない

判断:

- template 選択の方針は `api/services/supervisor/skills/builtin/references/` に追加する。
- llm-provider は provider 呼び出し、JSON 抽出、schema 検証、最小限の互換正規化に留める。

理由:

- 既存 AGENTS.md の責務分離と一致する。
- Round 1 / Round 2 の routing hypothesis に沿って reference を読む構造を維持できる。

代替案:

- provider SystemContext に default stack を埋め込む。
- Workbench intake で keyword 判定して template を選ぶ。

トレードオフ:

- reference selection の実装が必要。
- ただし prompt と tool の境界が明確になる。

戻せるか:

- reference を外し、registry から選択しないようにすれば戻せる。

### Decision 4: SSR / SSG は単一 overlay snapshot として扱う

判断:

- SSR / SSG は DB/RAG variant とは別の単一 overlay tag として materialize する。
- DB/RAG variant と overlay を1回の `materialize_template` で合成しない。
- `variant/sqlite-ssr` のような掛け算 branch は NightWorkers 側では前提にしない。

理由:

- DB と render mode は直交する。
- branch の組み合わせ爆発を避ける。
- 現在の `overlay-ssr-v1.0.0` / `overlay-ssg-v1.0.0` は tag として取得できるため、初期実装では patch 合成より単一 ref materialize を優先する。

代替案:

- SSR 用完成 variant を clone する。
- DB/RAG variant に overlay diff を patch 適用する。
- SSR / SSG は初期実装対象外にする。

トレードオフ:

- DB/RAG variant と SSR/SSG の組み合わせが必要な場合は、別の組み合わせ tag を用意するか、ユーザー確認に回す必要がある。
- 初期実装では overlay を「計画・明示指定時のみ」にして、default path の複雑さを抑える。

戻せるか:

- overlay ref 選択を無効化し、baseline/DB/RAG variant のみに戻せる。

## 実装段階

### Phase 1: Template registry と Supervisor reference

目的:

- LLM がまっさら scaffold ではなく `hono-standard` baseline を選ぶ判断材料を持つ。

作業:

| 作業 | 担当者 | 依存 | 受け入れ基準 |
| --- | --- | --- | --- |
| `hono-standard` registry 定数を追加 | TBD | なし | baseline/variant/overlay の repo/ref/description が型付きで参照できる |
| Supervisor reference `references/work_kinds/template.md` または allowed extra reference を追加 | TBD | registry 方針 | 未指定 Web app では SQLite baseline を選ぶ指示がある |
| `supervisorWorkKinds` または `nextReferenceFiles` allowlist を更新 | TBD | reference 追加 | `resolveSupervisorReferenceDocuments` が新 reference を拒否しない |
| Round 1 / Workbench routing が新規 Web app で reference を読ませる | TBD | reference 追加 | test で `nextReferenceFiles` に template reference が入る |

検証:

- `bunx vitest run tests/services.supervisor-skills.test.ts tests/structured-llm/services-structured-llm-02.test.ts`
- routing prompt snapshot / parsed user context に template reference が含まれること。

### Phase 2: Template materializer worker tool

目的:

- remote `hono-standard` tag を安全に取得し、Project root に展開する。

作業:

| 作業 | 担当者 | 依存 | 受け入れ基準 |
| --- | --- | --- | --- |
| worker tool schema `materialize_template` を追加 | TBD | registry | repoId/ref/targetPath/overlays/overwrite/exclude を受け取れる |
| allowlist enforcement を実装 | TBD | tool schema | 未登録 repo/ref は拒否される |
| GitHub archive または `git clone --depth 1 --branch` の内部実行を実装 | TBD | allowlist | shell command policy を迂回せず service 内で制御される |
| temp dir cleanup と provenance payload を実装 | TBD | clone 実装 | result に repoUrl/ref/commit/treeFiles/excluded が残る |
| dispatcher と prompt-tool-registry に追加 | TBD | tool 実装 | major_code_edit で tool が利用可能 |

推奨実装:

- tool 名は `materialize_template`。
- 入力:

```json
{
  "templateId": "hono-standard",
  "variant": "baseline",
  "targetPath": ".",
  "overlays": [],
  "overwrite": false,
  "projectName": "my-app"
}
```

- registry 例:

```ts
export const webTemplateRegistry = {
  'hono-standard': {
    repoUrl: 'https://github.com/ugnoguchigxp/hono-standard.git',
    defaultVariant: 'baseline',
    variants: {
      baseline: { ref: 'sqlite-v1.1.0', description: 'SQLite local-first baseline' },
      sqlite: { ref: 'sqlite-v1.1.0', description: 'SQLite local-first' },
      postgres: { ref: 'postgres-v1.0.0', description: 'PostgreSQL' },
      pgvector: { ref: 'pgvector-v1.0.0', description: 'PostgreSQL + pgvector' },
      rag: { ref: 'rag-v1.0.0', description: 'RAG / hybrid search / agentic search' },
      cloudflare: { ref: 'cloudflare-v1.0.0', description: 'Cloudflare Workers' },
      turso: { ref: 'turso-v1.0.0', description: 'Turso/libSQL' }
    },
    overlays: {
      ssr: { ref: 'overlay-ssr-v1.0.0' },
      ssg: { ref: 'overlay-ssg-v1.0.0' }
    }
  }
} as const;
```

検証:

- temp repo へ baseline を materialize できる。
- 未登録 URL / ref は拒否される。
- `node_modules`、`.env`、test artifacts は展開されない。
- existing non-empty target で `overwrite=false` の場合は拒否される。
- provenance payload が run event に残る。

### Phase 3: Post-processing と verification gate

目的:

- clone しただけで完了せず、利用先 project として整える。

作業:

| 作業 | 担当者 | 依存 | 受け入れ基準 |
| --- | --- | --- | --- |
| template materialize 後の required Todo を prompt に追加 | TBD | Phase 2 | package.json inspection、rename、env review、verification が Todo 化される |
| `getTemplateImportVerificationGap` を materialize_template に対応 | TBD | Phase 2 | read package.json 前 finalize が拒否される |
| package script selection helper を追加 | TBD | Phase 2 | `verify` があれば優先、なければ typecheck/lint/test/build を選ぶ |
| post-processing evidence を final report に含める | TBD | Phase 2 | 使用 ref と検証コマンドが報告される |

post-processing の最低作業:

- `package.json` の `name` / `description` を task に合わせて更新する。
- README の project name と起動手順を必要に応じて更新する。
- `.env.example` を確認し、secret を生成・埋め込みしない。
- DB variant と user requirement の一致を確認する。
- サンプル機能を残すか削るか判断する。
- `pnpm install` が必要なら explicit install として Todo に含める。
- `pnpm verify` または相当コマンドを実行する。

検証:

- 既存 template copy regression に加え、`materialize_template` 後も同じ gap が働く。
- finalize_answer が package.json read と verification 前に拒否される。

### Phase 4: Overlay snapshot 適用

目的:

- SSR / SSG が必要な時だけ単一 overlay tag を materialize できるようにする。

作業:

| 作業 | 担当者 | 依存 | 受け入れ基準 |
| --- | --- | --- | --- |
| overlay ref 取得を materializer に追加 | TBD | Phase 2 | `overlays: ["ssr"]` を指定できる |
| DB/RAG variant と overlay の同時指定を拒否 | TBD | overlay 取得 | 合成したように見せず明示エラーになる |
| overlay materialize 後 verification を追加 | TBD | manifest inspection | SSR/SSG 用 script があれば実行される |

初期制約:

- overlay は明示要件がある場合だけ使う。
- 複数 overlay や DB/RAG variant との自動合成は初期対象外。
- overlay の source は allowlist tag のみ。

検証:

- baseline + no overlay が従来 path で動く。
- invalid overlay は拒否される。
- variant/overlay conflict が evidence として残る。

### Phase 5: Workbench UX と設定

目的:

- ユーザーと運用者が template default を理解・調整できる。

作業:

| 作業 | 担当者 | 依存 | 受け入れ基準 |
| --- | --- | --- | --- |
| General settings に default web template 表示を追加 | TBD | Phase 1 | baseline が SQLite であることが表示される |
| task/run detail に template provenance を表示 | TBD | Phase 2 | repo/ref/variant/overlays が確認できる |
| template disable flag を追加 | TBD | Phase 1 | 環境変数または設定で無効化できる |

初期では UI は必須ではない。まず backend / Supervisor の evidence と final report で運用可能にする。

## 詳細作業分解

### Task 1: registry を追加

- 変更箇所:
  - `api/services/templates/registry.ts` または `api/services/supervisor/templates/registry.ts`
  - 必要なら shared schema
- 入力:
  - template id、repo URL、variant、tag、overlay tag。
- 出力:
  - 型付き registry。
- 受け入れ基準:
  - unknown template / variant / overlay を判定できる。
  - default variant が `baseline` で、ref が `sqlite-v1.1.0`。
- テスト:
  - registry unit test。
- 切り戻し:
  - registry import を外す。

### Task 2: Supervisor reference を追加

- 変更箇所:
  - `api/services/supervisor/skills/builtin/references/work_kinds/template.md` または `references/overlays/template_import.md`
  - `api/services/supervisor/skills/types.ts`
  - `api/services/supervisor/skills/registry.ts`
  - `api/modules/nightworkers/nightworkers.workbench-routing.ts`
- 入力:
  - routing hypothesis。
- 出力:
  - Round 2 prompt に template guidance。
- 受け入れ基準:
  - 空 project root + new Web app + stack unspecified で `hono-standard` baseline を第一候補にする。
  - 既存 repo / stack specified では既存 stack を優先する。
- テスト:
  - `tests/services.supervisor-skills.test.ts`
  - routing helper tests。
- 切り戻し:
  - reference selection を外す。

### Task 3: materialize_template worker tool を追加

- 変更箇所:
  - `api/services/worker-tools/materialize-template.ts`
  - `api/services/worker-tools/dispatcher.ts`
  - `api/services/supervisor/prompt-tool-registry.ts`
  - `api/services/tool-policy/types.ts`
  - tool-policy manifest / tests。
- 入力:
  - `templateId`, `variant`, `targetPath`, `overlays`, `overwrite`, `projectName`。
- 出力:
  - 展開済み files と provenance。
- 受け入れ基準:
  - allowlist された template tag だけ取得できる。
  - Project root 外へ書けない。
  - generated / secret / dependency artifacts を除外する。
- テスト:
  - local fake git repo または fixture archive で unit / integration test。
- 切り戻し:
  - tool を prompt-tool-registry から外す。

### Task 4: template verification gap を拡張

- 変更箇所:
  - `api/services/supervisor/supervisor-loop.ts`
  - gap helper 定義箇所。
  - `tests/supervisor/services-supervisor-01-part01.test.ts`
- 入力:
  - `materialize_template` tool result。
- 出力:
  - finalize guard。
- 受け入れ基準:
  - materialize 後、`read_file package.json` と verification 前の finalize が拒否される。
- テスト:
  - 既存 template copy test と同等の materialize test。
- 切り戻し:
  - materialize_template を template import gap 対象から外す。

### Task 5: post-processing guidance を追加

- 変更箇所:
  - Supervisor reference。
  - Prompt minimum execution contract。
- 入力:
  - template provenance と user request。
- 出力:
  - TodoList と final report guidance。
- 受け入れ基準:
  - package name / env / DB / auth / security / sample cleanup の確認が Todo または report に含まれる。
- テスト:
  - prompt text tests。
- 切り戻し:
  - guidance を削除。

### Task 6: overlay 適用を追加

- 変更箇所:
  - materializer。
  - registry。
  - tests。
- 入力:
  - `overlays: ["ssr"]` または `["ssg"]`。
- 出力:
  - overlay 適用済み project。
- 受け入れ基準:
  - invalid overlay は拒否。
  - conflict は成功扱いしない。
- テスト:
  - fixture patch 適用成功 / conflict。
- 切り戻し:
  - overlay option を無効化。

## データと移行計画

DB migration は初期不要。

必要になりうる永続データ:

- run event payload に template provenance を保存する。
- task/run context snapshot に template selection を保存する。
- 将来、Project settings に default template を持つ場合は settings table または既存 general settings に追加する。

データ互換性:

- 既存 run には template provenance がない。UI は absent を許容する。
- 新 field は optional として扱う。

再実行安全性:

- `materialize_template` は `overwrite=false` を default にする。
- target が空でない場合は拒否し、明示 `overwrite=true` でも `.git`, `.env`, local DB などの扱いを確認する。

## API、インターフェース、契約変更

### Worker tool contract

新規 tool: `materialize_template`

Request:

```json
{
  "templateId": "hono-standard",
  "variant": "baseline",
  "targetPath": ".",
  "overlays": [],
  "overwrite": false,
  "projectName": "my-app"
}
```

Response payload:

```json
{
  "templateId": "hono-standard",
  "repoUrl": "https://github.com/ugnoguchigxp/hono-standard.git",
  "variant": "baseline",
  "ref": "sqlite-v1.1.0",
  "commit": "sha-or-null-if-archive-only",
  "targetPath": ".",
  "overlays": [],
  "filesWritten": 123,
  "excluded": ["node_modules", ".env", "dist", "dist-api"],
  "postInstallRequired": true
}
```

Error behavior:

- `UNKNOWN_TEMPLATE`
- `UNKNOWN_VARIANT`
- `UNKNOWN_OVERLAY`
- `TARGET_NOT_EMPTY`
- `ACCESS_DENIED`
- `TEMPLATE_FETCH_FAILED`
- `OVERLAY_CONFLICT`

### Supervisor prompt contract

- New Web app + stack unspecified + empty project root では `materialize_template` を第一候補にする。
- 既存 repo がある場合は、既存 stack inspection を先に行う。
- template materialize 後は `package.json` read と verification 前に finalize しない。

## セキュリティ、プライバシー、コンプライアンス

- remote repo は allowlist された `https://github.com/ugnoguchigxp/hono-standard.git` のみ初期許可する。
- ref は registry に登録された tag のみ初期許可する。
- `main` や arbitrary branch は通常 path では使わない。
- `materialize_template` は `.env`、secret、local DB、dependency cache、build artifact を展開しない。
- clone / archive 取得時の network error は成功扱いしない。
- template の package scripts は自動実行しない。`pnpm install` と verification は Todo/evidence 経由で明示的に実行する。
- post-processing で auth、cookie、CORS、CSRF、CSP、rate limit、secure headers の確認を要求する。
- provenance に secret を含めない。
- supply-chain risk は tag pinning と allowlist で低減する。将来は commit SHA pinning と signed tag 検証を検討する。

## テスト方針

### Unit tests

- registry resolver:
  - baseline -> `sqlite-v1.1.0`
  - postgres / pgvector / rag / cloudflare / turso mapping
  - unknown variant rejection
- materializer:
  - allowlist enforcement
  - target empty check
  - exclude patterns
  - provenance payload
  - overlay invalid / conflict
- supervisor skills:
  - template reference parsing
  - `nextReferenceFiles` allowlist

### Integration tests

- fake template git repo を使い、`materialize_template` が Project root に展開できる。
- materialize 後に package.json read 前 finalize が拒否される。
- materialize 後に verification 前 finalize が拒否される。
- verification 後 finalize できる。

### Prompt / routing tests

- 空 Project + new Web app + stack unspecified で template guidance が Round 2 prompt に入る。
- Python 指定では hono-standard guidance を使わない。
- 既存 package.json がある repo では既存 stack inspection を優先する。

### Manual verification

- 実 `ugnoguchigxp/hono-standard` の `sqlite-v1.1.0` を一時 Project に materialize。
- `pnpm install`
- `pnpm verify`
- 必要に応じて `pnpm dev` を background tool で起動し、health / UI を確認。

## 観測性と運用

Run evidence:

- `materialize_template` tool result に repo/ref/variant/overlays/filesWritten/excluded を保存する。
- final report に template provenance と verification command を含める。

Logs:

- template fetch start / finish / failure。
- target path rejection。
- overlay conflict。

Metrics:

- template materialize success count。
- template materialize failure count by error code。
- default baseline usage count。
- fallback-to-from-scratch count。

Alert:

- 初期は dashboard なし。failure count が増えた場合は logs / run events から追跡する。
- 将来、template fetch failure が連続した場合に設定画面へ degraded 表示を出す。

Runbook:

- tag が壊れている場合は registry を前回 tag に戻す。
- GitHub が一時的に落ちている場合は needs_human または retryable failed として報告し、ゼロ scaffold に自動 fallback しない。

## 段階リリース計画

1. Phase 1 を merge し、Supervisor が template を選ぶ guidance だけを持つ。
2. Phase 2 を hidden tool として追加し、test task でのみ使う。
3. Phase 3 の verification guard を有効化し、default path に入れる。
4. 実 task で SQLite baseline の生成結果を確認する。
5. Phase 4 overlay は明示指定時のみ有効化する。
6. Phase 5 UI / setting は運用上必要になった時点で追加する。

Go / no-go:

- Go: baseline materialize + package inspection + verification が test と manual で通る。
- No-go: unknown shell command の許可、package verification bypass、template fetch failure の成功扱いが残る。

## 切り戻しと緩和策

切り戻し:

- `materialize_template` を allowed tools から外す。
- Supervisor reference selection から template reference を外す。
- registry default を disabled にする。

緩和策:

- template fetch が失敗した場合、ユーザーに GitHub template 取得失敗として報告し、明示許可なしにゼロ scaffold へ切り替えない。
- `hono-standard` tag に問題がある場合、registry を前 tag へ戻す。
- overlay conflict が発生した場合、baseline だけで続行するかユーザー確認に回す。

不可逆変更:

- 初期実装では DB migration なし。生成先 Project の file write は不可逆になりうるため、空 target / overwrite policy で制御する。

## リスク、前提、未解決事項

### リスク

| リスク | 影響度 | 発生可能性 | 緩和策 | 担当者 |
| --- | --- | --- | --- | --- |
| SQLite default が本番 Web app 要件に合わない | 中 | 中 | 要件に PostgreSQL/team/deploy が出た場合は postgres variant を選ぶ reference を明記 | TBD |
| `hono-standard` tag が壊れる | 高 | 低 | tag pinning、manual verification、registry rollback | TBD |
| `git clone` 許可で command policy が広がる | 高 | 中 | 専用 materialize_template tool を使い、run_command は広げない | TBD |
| overlay patch conflict | 中 | 中 | overlay は明示指定時のみ、conflict は成功扱いしない | TBD |
| LLM が既存 repo に template を上書きする | 高 | 中 | target empty check、overwrite=false default、既存 stack inspection | TBD |
| template の sample 機能が残りすぎる | 中 | 中 | post-processing Todo と final report で sample cleanup 判断を要求 | TBD |

### 前提

- `baseline-v1.1.0` / `sqlite-v1.1.0` は SQLite baseline として扱う。
- NightWorkers から GitHub へ network access できる環境がある。
- 新規 Web app 依頼の Project root は NightWorkers の登録済み Project root である。
- ユーザー指定 stack と既存 repo stack は template default より優先する。

### 未解決事項

- `materialize_template` は Git clone を内部実行するか、GitHub archive download を使うか。
- tag の commit SHA pinning を registry に持つか。
- Project settings UI で default template を変更可能にするか。
- overlay 適用を初期 release に含めるか、Phase 4 として後回しにするか。
- generated app の `.git` 初期化や upstream template 履歴保持を NightWorkers が支援するか。

## マイルストーン

| 節目 | 終了条件 | 目標日 | 担当者 |
| --- | --- | --- | --- |
| M1: 設計確定 | この計画の open question が実装可能な粒度に整理される | TBD | TBD |
| M2: Registry + Reference | baseline 選択 guidance の tests が通る | TBD | TBD |
| M3: Materializer | fake repo から安全に template 展開できる | TBD | TBD |
| M4: Verification guard | materialize 後 finalize bypass ができない | TBD | TBD |
| M5: Real template smoke | `sqlite-v1.1.0` から生成し verify できる | TBD | TBD |
| M6: Overlay optional | SSR/SSG overlay が明示指定時だけ適用できる | TBD | TBD |

## 着手前チェックリスト

### 実装開始前

- [ ] `hono-standard` の default baseline tag を `sqlite-v1.1.0` として固定する合意がある。
- [ ] registry に入れる variant / overlay ref が確定している。
- [ ] `materialize_template` の取得方式を Git clone か archive download かで決める。
- [ ] `run_command` の command policy を広げない方針が確認済み。
- [ ] target non-empty / overwrite の扱いが確認済み。
- [ ] package verification の最低 gate が決まっている。
- [ ] overlay を初期 release に含めるか決まっている。

### 本番リリース前

- [ ] registry resolver tests が通っている。
- [ ] Supervisor reference / routing tests が通っている。
- [ ] materialize_template unit / integration tests が通っている。
- [ ] template verification gap tests が通っている。
- [ ] 実 `ugnoguchigxp/hono-standard` tag の manual smoke が通っている。
- [ ] failure path が fixed success message にならず、evidence として残る。
- [ ] final report に template provenance と verification 結果が出る。
- [ ] rollback 手順が確認済み。
