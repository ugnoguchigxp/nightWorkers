# Tauri Desktop Packaging Implementation Plan

## 目的

NightWorkers を macOS 向け Tauri デスクトップアプリとして配布できる状態にする。利用者に Node.js / pnpm / `.env` / DB migration / API と Web の 2 プロセス起動を要求せず、通常の `.app` / `.dmg` から Workbench UI まで到達できる導入体験にする。

初期実装では既存の Hono + Node backend を Rust に移植しない。Tauri は window、packaging、Node sidecar lifecycle、app data path、first-run bootstrap、diagnostics を担当し、supervisor / worker tools / MCP / hooks / Codex SDK / SQLite DB は既存 Node backend 境界に残す。

## 現状確認

- `src-tauri/` はまだ存在しない。
- Frontend は React + Vite + TanStack Router。`vite.config.ts` の dev server は `39174`、`/api` と WebSocket proxy は `localhost:39173` を向く。
- Backend entry は `api/index.ts`。top-level await で `ensureNightWorkersSchema()`、`serve()`、WebSocket injection、signal handler、`process.exit()` まで持っている。
- `package.json` の `build:backend` は `esbuild api/index.ts --bundle --packages=external --platform=node --target=node20 --format=esm --outfile=dist-api/index.js`。配布には Node runtime と external production dependencies の同梱戦略が必要。
- `api/config.ts` は `DATABASE_URL` と `JWT_SECRET` を必須としている。`.env` なしの first-run には bootstrap layer が必要。
- Runtime state は複数箇所で `process.cwd()` 前提になっている。確認済みの主な対象は `api/.runtime`、`logs`、builtin skill / procedure path、settings JSON、hook settings、MCP settings。
- Frontend は `/api` 相対 fetch が多く、WebSocket は `window.location.host` と `localhost:39173` fallback を使っている。

## 成功条件

- `pnpm tauri dev` で Tauri WebView、Node sidecar、REST API、WebSocket が同時に起動する。
- clean runtime dir で `.env` なしに DB、JWT secret、settings dir、logs dir が作成され、`/api/health/ready` と Workbench 初期画面まで到達する。
- repo checkout 外の packaged `.app` から起動しても、状態は app data 配下に保存され、checkout 配下の `api/.runtime` / `logs` へ配布版状態が漏れない。
- app 終了後に sidecar process が残らない。
- 既存の browser dev flow (`pnpm dev`、`pnpm dev:api`、`pnpm dev:web`) は壊れない。
- 未署名 dev artifact と署名 / notarization 付き release artifact の手順が分かれている。

## 実装状況

- backend lifecycle は `api/server.ts` に分離済み。`api/index.ts` は CLI entry と signal handling を担当する。
- desktop runtime path は `api/runtime/paths.ts`、first-run bootstrap は `api/runtime/bootstrap.ts` に実装済み。
- frontend REST / WebSocket URL は `src/lib/api-base.ts` に集約済み。Tauri WebView は `get_desktop_config` command から API origin を受け取る。
- Tauri v2 shell は `src-tauri/` に追加済み。Rust shell が動的 port を選び、Node sidecar を起動し、health ready を待ち、終了時に sidecar を止める。
- desktop backend は `scripts/desktop/build-backend.mjs` で CJS bundle を作り、native packages だけを `scripts/desktop/prepare-sidecar.mjs` で staging する。
- `pnpm desktop:build` は macOS `.app` artifact を生成する。DMG は `pnpm desktop:build:dmg` の別 gate に分離済み。
- 実起動 smoke は `pnpm desktop:smoke` に組み込み済み。packaged `.app` から sidecar が起動し、`/api/health/ready`、`/api/overview`、`/api/implementation-queue` が 200、Workbench WebSocket open、desktop/sidecar logs、shutdown complete まで確認する。
- `pnpm verify` は base gate に加えて `desktop:lint`、`desktop:build`、`desktop:smoke` を実行する。
- 署名 / notarization は Developer ID credentials が必要なため未実行。`pnpm desktop:sign` に credential gate を実装済み。

## 非目標

- 初期実装では backend を Rust に全面移植しない。
- 初期実装では Mac App Store 配布を前提にしない。Developer ID 署名 + notarization の App Store 外配布を優先する。
- 対象 Project 側の `git`、package manager、test runner、MCP server、hook command、LLM credential 不足までは Tauri 化だけで解決しない。これは preflight / degraded state の対象にする。
- AGENTS.md / AGENT.md を app runtime に読み込ませない。人間向け作業ルールとして維持する。
- ユーザー文言の keyword / regex 分類で desktop-only routing を追加しない。実行判断は既存 supervisor workflow / prompt 指示の境界に従う。

## 採用アーキテクチャ

```text
NightWorkers.app
  src-tauri Rust shell
    - window lifecycle
    - app data path resolution
    - free port allocation
    - Node sidecar lifecycle
    - startup diagnostics
    - future signing / updater hooks

  WebView
    - built Vite frontend from dist/
    - REST fetch to sidecar API origin
    - WebSocket connect to sidecar API origin

  Node sidecar
    - bundled backend entry
    - production dependencies
    - Hono REST API
    - Hono WebSocket endpoint
    - SQLite/libSQL file DB in app data
    - supervisor-worker runtime
    - MCP / hooks / worker tools
```

標準は動的 port。明示 env がある dev / debug のみ固定 `39173` を許可する。Tauri shell が API origin を決め、sidecar env と frontend runtime config の両方へ渡す。

## 実装順序

### Phase 0: 事前棚卸し

目的: Tauri skeleton を入れる前に、現在の runtime path、API base、native dependency、entrypoint の変更対象を固定する。

変更対象:

- `package.json`
- `api/config.ts`
- `api/index.ts`
- `api/app.ts`
- `api/lib/logger.ts`
- `api/routes/settings.ts`
- `api/services/mcp/mcp-settings.ts`
- `api/services/hooks/hooks-settings.ts`
- `api/services/settings/general-settings.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/skills/registry.ts`
- `api/services/procedures/registry.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/lib/api.ts`

作業:

1. `rg -n "process\\.cwd\\(|api/\\.runtime|logs|localhost:39173|/api/ws|DATABASE_URL|JWT_SECRET" api src shared tests` の結果をこの Phase の issue list として整理する。
2. 配布で writable にする path と readonly resource にする path を分ける。
3. native dependency を `pnpm why argon2 better-sqlite3 @libsql/client` で確認し、sidecar packaging の署名対象候補に入れる。
4. `api/index.ts` を分離する前の shutdown 挙動を `SIGTERM` smoke で確認する。

Exit:

- `runtime state`、`readonly bundled resource`、`registered Project repo root` の 3 分類が実装メモに残っている。
- `src-tauri` 追加前に触るべき Node / frontend ファイルが確定している。

検証:

```bash
pnpm typecheck
pnpm lint
pnpm test:supervisor-regression
```

### Phase 1: Backend 起動制御を reusable にする

目的: CLI 起動と Tauri sidecar 起動で同じ backend 起動処理を使えるようにする。

変更対象:

- `api/index.ts`
- `api/server.ts` 新規
- `api/app.ts`
- `tests/api-server-lifecycle.test.ts` 新規または既存 server lifecycle test へ追加

実装:

1. `api/server.ts` を追加し、`createNightWorkersServer(options)` を実装する。
2. `options` は最低限 `port`、`host`、`shutdownTimeoutMs`、`signalHandling`、`exitProcess` を受ける。
3. `createNightWorkersServer` 内で `ensureNightWorkersSchema()`、`serve()`、`nodeWebSocket.injectWebSocket(server)` を行う。
4. 戻り値は `{ port, origin, close, server }` にする。`close()` は `nightWorkersRealtimeBroker.closeAll()`、WebSocket close、HTTP close、DB client close を順に実行する。
5. `api/index.ts` は config を読み、`createNightWorkersServer()` を呼び、`SIGTERM` / `SIGINT` handler と `process.exit()` だけを担当する CLI entry にする。
6. shutdown timeout と log event の文言は既存挙動を維持する。

Exit:

- `pnpm dev:api` が従来通り `39173` で起動する。
- `pnpm start` が `dist-api/index.js` から起動する。
- テストから server を起動し、`close()` で process exit せず終了できる。

検証:

```bash
pnpm typecheck
pnpm vitest run tests/api-server-lifecycle.test.ts tests/health.test.ts
pnpm build:backend
```

失敗時の切り分け:

- schema bootstrap 前に落ちる場合は `DATABASE_URL` / app data bootstrap を Phase 2 へ先送りせず、現行 `.env` dev path で再現確認する。
- WebSocket close が hang する場合は broker close と `nodeWebSocket.wss.close()` の順序を確認する。

### Phase 2: Runtime path と first-run bootstrap

目的: 配布版では runtime state を app data 配下に置き、`.env` なしで起動できるようにする。

変更対象:

- `api/config.ts`
- `api/runtime/paths.ts` 新規
- `api/runtime/bootstrap.ts` 新規
- `api/db/client.ts`
- `api/lib/logger.ts`
- `api/routes/settings.ts`
- `api/services/mcp/mcp-settings.ts`
- `api/services/hooks/hooks-settings.ts`
- `api/services/settings/general-settings.ts`
- `.env.example`
- `tests/runtime-paths.test.ts` 新規
- `tests/runtime-bootstrap.test.ts` 新規

実装:

1. `NIGHTWORKERS_RUNTIME_DIR` を追加する。未指定なら既存互換として `process.cwd()` を runtime root にする。
2. `api/runtime/paths.ts` で以下を返す。
   - `runtimeRoot`
   - `databasePath`
   - `settingsDir`
   - `logsDir`
   - `secretsDir`
   - `artifactsDir`
3. 既存の `api/.runtime` は dev 互換 path として残す。配布版では `NIGHTWORKERS_RUNTIME_DIR/settings` へ向ける。
4. `DATABASE_URL` 未指定かつ `NIGHTWORKERS_DESKTOP=1` の場合、`file:${runtimeRoot}/sqlite.db` を既定にする。
5. `JWT_SECRET` 未指定かつ `NIGHTWORKERS_DESKTOP=1` の場合、`secrets/jwt-secret` に 32 bytes 以上の secret を生成して保存する。既存ファイルがあれば再利用する。
6. `AUTH_MODE` は desktop default を `local` にする。OAuth は明示設定時だけ有効にする。
7. `APP_URL`、`CORS_ORIGIN` は sidecar env の `NIGHTWORKERS_API_ORIGIN` を優先して生成する。
8. `api/lib/logger.ts` の `logs` は `runtimePaths.logsDir` に移す。
9. settings 系 JSON は `runtimePaths.settingsDir` 配下に移す。
10. builtin skill / procedure は writable runtime state ではないため、`process.cwd()` ではなく bundle された repo resource / app resource を読む方針に分ける。ただしこの Phase では dev 互換 path を維持し、Tauri resource path 注入は Phase 4 で接続する。

Exit:

- `NIGHTWORKERS_DESKTOP=1 NIGHTWORKERS_RUNTIME_DIR=$(mktemp -d) pnpm dev:api` で `.env` なしに起動できる。
- runtime dir 内に `sqlite.db`、settings、logs、secret が作成される。
- 既存 `.env` dev mode は従来通り動く。

検証:

```bash
pnpm typecheck
pnpm vitest run tests/runtime-paths.test.ts tests/runtime-bootstrap.test.ts tests/services.mcp-settings.test.ts tests/services.agent-hooks.test.ts
tmpdir="$(mktemp -d)" && NIGHTWORKERS_DESKTOP=1 NIGHTWORKERS_RUNTIME_DIR="$tmpdir" pnpm dev:api
```

手動 smoke:

- `curl http://localhost:39173/api/health/ready` が 200 を返す。
- `ls "$tmpdir"` で DB、settings、logs、secrets が確認できる。
- repo checkout の `api/.runtime` / `logs` が配布モードで更新されていない。

### Phase 3: Frontend API / WebSocket base を統一する

目的: Tauri WebView、Vite dev、production browser serving で REST / WS 接続契約を一箇所に集める。

変更対象:

- `src/lib/api-base.ts` 新規
- `src/lib/api.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/routes/login.tsx`
- `src/routes/tasks.$id.tsx`
- `src/modules/nightworkers/components/SettingsScreen.tsx`
- `src/modules/nightworkers/components/OverviewScreen.tsx`
- `src/modules/nightworkers/components/blueprint-preview/BlueprintPreview.tsx`
- fetch を直接呼んでいる周辺コンポーネント
- `tests/api-base.test.ts` 新規

実装:

1. `getApiOrigin()` を追加する。優先順位は `window.__NIGHTWORKERS_DESKTOP_CONFIG__.apiOrigin`、`import.meta.env.VITE_NIGHTWORKERS_API_ORIGIN`、browser dev の相対 origin。
2. `apiPath(path)` は REST 用に、Tauri mode では absolute URL、browser dev では `/api/...` 相対 URL を返す。
3. `wsPath(path)` は WebSocket 用に、Tauri mode では sidecar origin を `ws:` / `wss:` に変換し、browser dev では `window.location` と Vite proxy を使う。
4. `localhost:39173` fallback は `import.meta.env.DEV` のみに閉じ込め、production build では使わない。
5. 既存 fetch を段階的に `apiPath()` へ寄せる。まず Workbench 起動、settings、auth methods、WebSocket subscribe に必要な path を優先する。
6. `src/lib/api.ts` の client があれば `apiPath()` を使う。

Exit:

- `pnpm dev` の browser flow で REST / WS が通る。
- `VITE_NIGHTWORKERS_API_ORIGIN=http://127.0.0.1:39173 pnpm dev:web` で proxy なし absolute origin 接続が通る。
- production build 内に unconditional `localhost:39173` が残らない。

検証:

```bash
pnpm typecheck
pnpm vitest run tests/api-base.test.ts
pnpm build:frontend
rg -n "localhost:39173" dist src
```

### Phase 4: Tauri shell と sidecar dev flow

目的: Tauri WebView と Node sidecar を `pnpm tauri dev` で起動できるようにする。

変更対象:

- `src-tauri/Cargo.toml` 新規
- `src-tauri/tauri.conf.json` 新規
- `src-tauri/src/main.rs` 新規
- `src-tauri/src/sidecar.rs` 新規
- `src-tauri/src/config.rs` 新規
- `package.json`
- `scripts/desktop/prepare-sidecar.mjs` 新規
- `scripts/desktop/dev-sidecar.mjs` 新規または Rust 側 dev sidecar 起動で代替

実装:

1. Tauri v2 skeleton を追加する。
2. `package.json` に以下の scripts を追加する。
   - `tauri`
   - `desktop:dev`
   - `desktop:build`
   - `desktop:prepare-sidecar`
   - `desktop:smoke`
3. `beforeDevCommand` は frontend dev server と backend sidecar 準備だけを行い、既存 `pnpm dev` と衝突させない。
4. `beforeBuildCommand` は `pnpm build:frontend && pnpm build:backend && pnpm desktop:prepare-sidecar` にする。
5. Rust shell は app data path を解決し、空き port を選び、sidecar env に渡す。
6. sidecar env は最低限以下を渡す。
   - `NIGHTWORKERS_DESKTOP=1`
   - `NIGHTWORKERS_RUNTIME_DIR=<app data>/runtime`
   - `PORT=<selected port>`
   - `NIGHTWORKERS_API_ORIGIN=http://127.0.0.1:<selected port>`
   - `APP_URL=http://127.0.0.1:<selected port>`
   - `CORS_ORIGIN=http://127.0.0.1:<selected port>,tauri://localhost,http://tauri.localhost`
   - `API_AUTH_REQUIRED=false`
7. WebView へ API origin を渡す。まずは preload script で `window.__NIGHTWORKERS_DESKTOP_CONFIG__` を注入する。より良い Tauri command 方式は Phase 6 で評価する。
8. health endpoint が ready になるまで loading view を出す。失敗時は error、logs path、runtime dir、port を表示する。
9. app 終了時に sidecar へ `SIGTERM` を送り、timeout 後に kill する。

Exit:

- `pnpm desktop:dev` で WebView が開き、Workbench UI が API / WS に接続する。
- `pnpm dev` は従来通り browser dev として動く。
- app を閉じた後に Node sidecar が残らない。

検証:

```bash
pnpm desktop:dev
lsof -nP -iTCP:<selected-port> -sTCP:LISTEN
```

手動 smoke:

- WebView で settings と Workbench list が読める。
- WebSocket が connected event を受け取る。
- app 終了後に `lsof` で port listener が消える。

### Phase 5: Backend artifact と production dependency 同梱

目的: repo checkout 外の packaged app で Node backend を実行できるようにする。

変更対象:

- `scripts/desktop/prepare-sidecar.mjs`
- `package.json`
- `src-tauri/tauri.conf.json`
- `.gitignore`
- `README.md`

実装:

1. `dist-api/index.js`、production `node_modules`、必要な package metadata、Node runtime を `src-tauri/binaries` または Tauri resources staging dir に配置する。
2. 初期実装は Node runtime + JS bundle + production dependencies 同梱を採用する。`pkg` / `nexe` / Node SEA は後続評価に残す。
3. staging dir は git 管理しない。生成物は `.gitignore` に追加する。
4. `better-sqlite3` / `argon2` のような native module が実際に runtime import されるかを確認し、必要なら arch 別 rebuild を staging に組み込む。
5. Tauri config の `bundle.resources` / sidecar 設定へ staging artifact を追加する。
6. app resource 内の readonly path を backend へ `NIGHTWORKERS_RESOURCE_DIR` として渡す。builtin skill / procedure registry はこの env を優先して読む。

Exit:

- repo root に依存せず、Tauri dev / build artifact から backend entry が起動する。
- `pnpm install` 済み checkout がなくても packaged sidecar が production dependencies を解決できる。

検証:

```bash
pnpm desktop:prepare-sidecar
node scripts/desktop/smoke-sidecar.mjs
pnpm desktop:build
```

失敗時の切り分け:

- `ERR_MODULE_NOT_FOUND` は staging dependency 漏れ。
- native module load error は arch / platform rebuild 漏れ。
- builtin skill / procedure missing は `NIGHTWORKERS_RESOURCE_DIR` 接続漏れ。

### Phase 6: CORS / CSRF / secure headers

目的: Tauri WebView からの REST / WS を許可しつつ、意図しない外部公開を避ける。

変更対象:

- `api/config.ts`
- `api/app.ts`
- `api/lib/auth-cookies.ts`
- `tests/cors-desktop.test.ts` 新規
- `tests/security-headers-desktop.test.ts` 新規

実装:

1. `NIGHTWORKERS_DESKTOP=1` のときだけ desktop origin set を有効にする。
2. `CORS_ORIGIN` は wildcard を引き続き禁止し、Tauri shell が具体 origin を渡す。
3. `secureHeaders.connectSrc` に selected API origin と WS origin を含める。
4. CSRF origin check が Tauri WebView の normal fetch を落とさないことを test で固定する。
5. `API_AUTH_REQUIRED=false` は local-first desktop default とし、remote browser serving の default とは混ぜない。
6. Cookies が必要な auth flow は local desktop default では必須にしない。OAuth は明示設定時だけ検証対象にする。

Exit:

- Tauri WebView から REST POST と WebSocket が成功する。
- `CORS_ORIGIN=*` は引き続き拒否される。
- desktop mode 以外の production security header が弱くならない。

検証:

```bash
pnpm vitest run tests/cors-desktop.test.ts tests/security-headers-desktop.test.ts tests/middleware.auth.test.ts
pnpm desktop:dev
```

### Phase 7: Packaged app smoke

目的: 実際の `.app` / `.dmg` で、配布版固有の path、sidecar、resource、shutdown 問題を潰す。

変更対象:

- `scripts/desktop/smoke-packaged-app.mjs` 新規
- `package.json`
- `README.md`
- `spec/docs/architecture.md` 新規または既存 docs
- `spec/docs/configuration.md` 新規または既存 docs

実装:

1. `pnpm desktop:build` で macOS `.app` と `.dmg` を作る。
2. smoke script は app を起動し、health ready、Workbench static load、WebSocket connected、runtime dir 作成を確認する。
3. app close 後、sidecar process と selected port listener が残っていないことを確認する。
4. app data を削除した clean first-run と、既存 app data を残した second-run の両方を確認する。
5. README に dev flow、packaged smoke、既知制約を書く。

Exit:

- repo checkout 外から `.app` を起動できる。
- app data clean / existing の両方で起動できる。
- close 後に process が残らない。

検証:

```bash
pnpm desktop:build
pnpm desktop:smoke
```

### Phase 8: Signing / notarization

目的: Gatekeeper の通常フローで開ける release artifact を作る。

変更対象:

- `src-tauri/tauri.conf.json`
- `scripts/release/desktop-sign-notarize.mjs` 新規
- `.github/workflows/desktop-release.yml` 任意
- `README.md`
- release docs

実装:

1. Developer ID Application 証明書で `.app`、sidecar、Node runtime、native modules を署名する。
2. notarization と stapling を release script へ入れる。
3. Apple Silicon / Intel は最初に arch 別 artifact を優先する。Universal は native module と Node runtime の安定後に評価する。
4. secrets は local keychain / CI secret のどちらで使うかを docs に分ける。
5. unsigned dev build と signed release build の scripts を分ける。

Exit:

- 署名済み `.dmg` を別マシン相当で開ける。
- notarization failure 時にどの binary が原因か分かる log が残る。

検証:

```bash
codesign --verify --deep --strict path/to/NightWorkers.app
spctl --assess --type execute --verbose path/to/NightWorkers.app
xcrun stapler validate path/to/NightWorkers.app
```

### Phase 9: Preflight と onboarding polish

目的: NightWorkers 本体の起動問題と Project 実行環境不足を UI 上で分離する。

変更対象:

- `api/services/preflight/*` 新規
- `api/routes/settings.ts` または専用 preflight route
- `src/modules/nightworkers/components/SettingsScreen.tsx`
- Project registration / Workbench 周辺 UI
- `tests/preflight.test.ts` 新規

チェック対象:

- `git`
- shell
- Project ごとの Node / pnpm / npm / bun
- LLM credential
- Codex token
- MCP server command / URL
- Agent Hook command
- registered Project repo permission
- app data DB write permission

実装:

1. app startup preflight と Project preflight を別 API にする。
2. startup preflight は app data DB、logs、sidecar health、resource path を確認する。
3. Project preflight は登録済み repo root を基準に worker tool 経由で確認する。一時ディレクトリを実作業 workspace として扱わない。
4. 実行不能でも chat / planning / settings は使える degraded state を残す。
5. UI 文言は「アプリは起動したが、この Project は pnpm がないので実行できない」のように原因を分ける。

Exit:

- 本体導入失敗、Project 環境不足、credential 不足が別々に表示される。
- Project 実行不能でも ordinary chat / intake が不必要にブロックされない。

検証:

```bash
pnpm vitest run tests/preflight.test.ts
pnpm typecheck
pnpm lint
```

## 実装時のファイル別チェックリスト

| File | 変更内容 | 完了確認 |
| --- | --- | --- |
| `package.json` | Tauri / desktop scripts、build scripts、smoke scripts を追加 | `pnpm desktop:dev` / `pnpm desktop:build` が存在する |
| `api/server.ts` | reusable server lifecycle | test から `close()` できる |
| `api/index.ts` | CLI entry のみに縮小 | `pnpm dev:api` が従来通り起動する |
| `api/config.ts` | desktop env、runtime defaults、origin defaults | `.env` なし desktop mode が通る |
| `api/runtime/paths.ts` | runtime path 集約 | `process.cwd()` state が残らない |
| `api/runtime/bootstrap.ts` | DB / JWT / dirs first-run | clean runtime dir smoke が通る |
| `api/lib/logger.ts` | logs dir を runtime path 化 | desktop mode で app data に出る |
| settings services | JSON 保存先を runtime path 化 | old dev path と desktop path の test が通る |
| skill / procedure registry | readonly resource path を env 注入可能にする | packaged app で builtin docs が読める |
| `src/lib/api-base.ts` | REST / WS URL builder | dev / desktop / production test が通る |
| direct fetch callers | `apiPath()` へ移行 | production build に固定 localhost が残らない |
| `src-tauri/*` | Tauri v2 shell、sidecar lifecycle、config injection | WebView + API + WS が起動する |
| desktop scripts | sidecar staging、smoke、packaging | repo checkout 外 app が起動する |
| docs | README / architecture / configuration | dev と release flow が分かる |

## リスクと対策

### Node sidecar packaging

`--packages=external` のままでは production dependencies の staging 漏れが起きやすい。初期実装では Node runtime + JS bundle + production dependencies 同梱を採用し、`ERR_MODULE_NOT_FOUND` と native module load error を smoke で早期検出する。

### Native modules

`argon2`、`better-sqlite3`、libSQL 周辺は platform / arch の影響を受ける可能性がある。実際の import path を確認し、不要なら dependency cleanup は別タスクにする。必要なら `desktop:prepare-sidecar` で arch 別 rebuild を行う。

### cwd 前提

配布版では `process.cwd()` が app bundle や起動元に依存する。runtime state は `NIGHTWORKERS_RUNTIME_DIR`、readonly resource は `NIGHTWORKERS_RESOURCE_DIR`、対象 Project 作業は登録済み Project repo root に分ける。

### port / origin / CSRF

REST は通っても WebSocket や CSRF が落ちる可能性がある。API base helper と desktop origin tests を先に入れ、Tauri shell は具体 origin だけを渡す。wildcard CORS は引き続き禁止する。

### sidecar shutdown

sidecar が残ると port、DB lock、queue active state が壊れる。Rust shell は graceful shutdown、timeout kill、startup stale recovery log を持つ。backend `close()` は test 可能にする。

### 署名 / notarization

sidecar、Node runtime、native modules の署名漏れが notarization failure になりやすい。release script は codesign 対象を列挙し、failure log を保存する。

### ユーザー環境依存

Tauri 化で NightWorkers 本体の導入は簡単になるが、対象 Project の tools は残る。preflight と degraded state で「app 起動」と「Project 実行可能」を分ける。

## 最小実装の推奨 PR 分割

1. Backend lifecycle split
   - `api/server.ts`
   - `api/index.ts`
   - lifecycle tests
2. Runtime path + first-run bootstrap
   - `api/runtime/*`
   - config / logger / settings path
   - runtime tests
3. Frontend API base
   - `src/lib/api-base.ts`
   - WebSocket builder
   - direct fetch migration for Workbench / settings
4. Tauri dev shell
   - `src-tauri/*`
   - desktop scripts
   - sidecar dev lifecycle
5. Packaged sidecar resources
   - staging scripts
   - resource path injection
   - packaged smoke
6. Security / release polish
   - CORS / CSRF tests
   - signing / notarization scripts
   - docs
7. Preflight UI
   - startup / Project preflight
   - degraded state

## 全体検証コマンド

各 PR で最低限:

```bash
pnpm typecheck
pnpm lint
pnpm test:supervisor-regression
```

desktop 機能が入った後:

```bash
pnpm verify
```

`pnpm verify` は TypeScript、Biome、supervisor regression、Rust format /
Clippy、Tauri `.app` build、packaged app smoke を含む。`pnpm verify:fast` は
base gate のみを実行する。

release 前:

```bash
codesign --verify --deep --strict path/to/NightWorkers.app
spctl --assess --type execute --verbose path/to/NightWorkers.app
xcrun stapler validate path/to/NightWorkers.app
```

## ドキュメント更新

実装時に以下を更新する。

- `README.md`: desktop install、developer flow、packaged smoke、current capability、known limitations
- `spec/docs/architecture.md`: Tauri shell、Node sidecar、runtime state、resource boundary
- `spec/docs/configuration.md`: app data path、desktop env、first-run bootstrap、credential 設定
- `.env.example`: dev only と desktop default の区別
- release docs or scripts: signing、notarization、artifact smoke

## 実装開始時の最初のタスク

まず Phase 1 の backend lifecycle split から始める。Tauri skeleton を先に入れると sidecar 起動失敗と backend shutdown 問題が混ざるため、先に `api/server.ts` で test 可能な `createNightWorkersServer()` を作る。その後 Phase 2 の runtime path / bootstrap を入れて、`.env` なし desktop mode の土台を作ってから Tauri shell に接続する。
