# Tauri Desktop Packaging Plan

## 目的

NightWorkers を Tauri デスクトップアプリとして配布できる形にし、利用者が Node.js / pnpm / `.env` / DB migration / API と Web の 2 プロセス起動でつまずく導入問題を減らす。

この計画は、NightWorkers を Tauri アプリとして配布することを前提にした実装計画である。方式は Tauri shell に Vite frontend を載せ、既存 Hono + Node backend bundle を Node sidecar として同梱する。現在の runtime は `child_process`、MCP stdio、Agent Hooks、Codex SDK、repo root ファイル操作、SQLite file DB に依存しているため、Tauri 化の初期実装では backend 境界を維持し、Rust 側は window、packaging、sidecar lifecycle、app data path、配布 UX を担当する。

## 現状

- Frontend は React + Vite + TanStack Router。開発時は `vite.config.ts` の proxy で `/api` と WebSocket を `localhost:39173` の API に転送している。
- Backend は `api/index.ts` が `ensureNightWorkersSchema()` を実行してから Hono server を起動し、`api/app.ts` が REST API、WebSocket、production static serving をまとめて持っている。
- DB は `@libsql/client` + Drizzle で、`DATABASE_URL` が `file:` でなければ `file:${DATABASE_URL}` として扱う。Tauri の app data 配下に SQLite file を置く設計と相性がよい。
- Runtime settings は `api/.runtime` 配下、logs は `logs` 配下など、現状は `process.cwd()` 前提の保存先がある。
- LLM provider、Codex SDK、worker tools、MCP、Agent Hooks は Node runtime と OS process 実行に依存している。

## 期待する改善

- インストール後の起動に Node.js 20+、pnpm、`pnpm install`、`pnpm db:migrate`、`.env` 手作業を要求しない。
- API server と Web server を利用者が別々に起動しなくてよい。
- 初回起動時に DB、JWT secret、runtime settings、logs 保存先を自動初期化する。
- localhost の Web アプリではなく、通常の macOS app として起動できる。
- 将来の署名、notarization、auto update、クラッシュログ、環境 preflight に進める配布基盤を持つ。

## 非目標

- Tauri 化の初期実装では backend を Rust に全面移植しない。既存 backend を Node sidecar として同梱し、配布後に Rust へ移す価値がある小さな native 機能だけを個別に評価する。
- 初期段階では Mac App Store 配布を前提にしない。Developer ID 署名 + notarization による App Store 外配布を優先する。
- 対象 Project 側の依存導入失敗までは Tauri 化だけで解決しない。`git`、package manager、test runner、外部 MCP server、hook command、LLM credential は Project / ユーザー環境の preflight 対象として扱う。
- AGENTS.md / AGENT.md を app runtime に読み込ませる変更はしない。これらは人間向け作業ルールとして維持する。

## Tauri アーキテクチャ

### 全体構成

```text
NightWorkers.app
  Tauri Rust shell
    - window lifecycle
    - sidecar lifecycle
    - app data path resolution
    - optional native file/folder picker
    - future auto update / signing support

  WebView
    - built Vite frontend from dist/
    - REST fetch to local API base
    - WebSocket connect to local API base

  Node sidecar
    - bundled dist-api/index.js
    - Hono REST API
    - Hono WebSocket endpoint
    - SQLite/libSQL file DB
    - supervisor-worker runtime
    - MCP / hooks / worker tools
```

### API 接続方式

Tauri アプリ内の WebView は、同梱 Node sidecar が起動する `localhost` loopback API に接続する。Tauri shell は app 起動時に API origin を確定し、frontend に渡す。REST と WebSocket は同じ API origin を使う。

実装方針:

- Tauri 側で空き port を選び、sidecar env と frontend config に渡す。
- 開発互換のため、明示 env がある場合のみ固定 port `39173` を許可する。
- frontend は Tauri から渡された API origin を最優先し、通常 browser dev では既存 Vite proxy の `/api` を使う。

動的 port を標準にする。port 衝突を利用者に解決させる設計にはしない。

### Backend 同梱方式

`pnpm build:backend` の成果物を sidecar 用 entry として使う。ただし現在の bundle は `--packages=external` なので、配布時に Node runtime と `node_modules` 相当をどう含めるかを決める必要がある。

実装方針:

- Node runtime + backend bundle + production dependencies を resource / sidecar として同梱する。
- `pkg` / `nexe` / SEA などで Node backend を単一実行ファイル化する。
- 将来的に backend の一部だけ Rust command に移す。

Tauri 化の初期実装では、最もデバッグしやすい Node runtime + backend bundle + production dependencies 同梱を採用する。単一実行ファイル化は packaging が安定してから、artifact サイズ、native module 互換性、署名 / notarization への影響を見て評価する。

## 実装すべき点

### 1. Tauri project skeleton

- `src-tauri/` を追加する。
- Tauri v2 を前提にする。
- `beforeDevCommand` は既存 `pnpm dev:web` / `pnpm dev:api` と衝突しないように分ける。
- `beforeBuildCommand` は frontend build と backend build の両方を実行する。
- `frontendDist` は Vite の `dist` を指す。
- sidecar binary / backend resource の配置規約を決める。

完了条件:

- `pnpm tauri dev` 相当で WebView が起動する。
- 開発時は既存 `pnpm dev` も壊さない。

### 2. Backend startup を reusable にする

現在の `api/index.ts` は top-level で server 起動、signal handler、`process.exit()` を持つ。Tauri sidecar でも使えるが、テストや将来の埋め込みには起動制御を分離した方がよい。

実装方針:

- `createNightWorkersServer(options)` のような起動関数を追加する。
- `api/index.ts` はその関数を呼ぶ CLI entry にする。
- shutdown は `close()` を返す形にし、signal handler は CLI entry 側に限定する。
- `ensureNightWorkersSchema()` と WebSocket injection は起動関数に含める。

完了条件:

- 既存 `pnpm dev:api` / `pnpm start` が同じ挙動を維持する。
- sidecar entry から port / path / env を渡せる。

### 3. App data path へ runtime state を移す

現状の `process.cwd()` 前提を、Tauri 配布時は app data 配下へ逃がす。

対象:

- `DATABASE_URL`
- `JWT_SECRET`
- LLM settings JSON
- MCP settings JSON
- Agent Hooks settings JSON
- logs
- command output artifacts
- optional seed / first-run marker

実装方針:

- Tauri 側が app data root を解決する。
- sidecar 起動時に env を渡す。
- backend は `NIGHTWORKERS_RUNTIME_DIR` のような単一 root を受け取り、未指定なら現行 `process.cwd()` ベースを維持する。
- 個別 override env は既存互換として残す。

完了条件:

- インストール済み app をどこから起動しても同じ DB / settings を読む。
- repo checkout 配下の `api/.runtime` や `logs` に配布版の状態が漏れない。
- 既存開発モードは現行パスで動く。

### 4. First-run bootstrap

利用者が `.env` を作らなくても起動できるようにする。

実装方針:

- `DATABASE_URL` が未指定なら app data 配下の `sqlite.db` を使う。
- `JWT_SECRET` が未指定なら app data 配下に生成して保存する。
- `AUTH_MODE` は local-first の既定として `local` または既存仕様に沿う値を明示する。
- OAuth はデスクトップ配布の初期範囲から外し、必要な場合だけ設定可能にする。
- `CORS_ORIGIN` と `APP_URL` は sidecar API origin / Tauri origin に合わせて生成する。

完了条件:

- 新規ユーザーが app を起動するだけで health endpoint と Workbench UI まで到達する。
- credential 未設定時は LLM smoke / 実行だけが明示的に未設定表示になる。

### 5. Frontend API base / WebSocket base の抽象化

現状は `/api` 相対 fetch が多く、WebSocket は `window.location.host` と `localhost:39173` fallback を使う。

実装方針:

- `src/lib/api-base.ts` のような小さな helper を追加する。
- REST fetch wrapper と WebSocket URL builder を統一する。
- Tauri 環境では Tauri shell から渡された API origin を使う。
- ブラウザ開発環境では現行の `/api` と Vite proxy を維持する。

完了条件:

- Tauri WebView、Vite dev、production browser serving の 3 パターンで API / WS が同じ契約で動く。
- hardcoded `localhost:39173` fallback は dev 専用として閉じ込める。

### 6. CORS / CSRF / secure headers 調整

Tauri WebView の origin と localhost API の関係を明示する。

実装方針:

- Tauri mode を env で backend に伝える。
- Tauri mode の許可 origin を明示する。
- `connectSrc` に sidecar API / WS origin を含める。
- CSRF が Tauri WebView の通常操作を誤って落とさないことを確認する。
- `API_AUTH_REQUIRED=false` の local-first 既定と、署名済み配布後の保護方針を分ける。

完了条件:

- Tauri WebView から REST / WS が成功する。
- ブラウザから意図せず外部公開される構成にならない。

### 7. Sidecar lifecycle

Tauri shell が Node sidecar を管理する。

実装方針:

- app 起動時に sidecar を起動する。
- health endpoint が通るまで WebView に ready を出さない。
- 起動失敗時はエラー画面に原因と logs path を出す。
- app 終了時に sidecar を graceful shutdown する。
- sidecar が落ちた場合は再起動または明示的な degraded state にする。

完了条件:

- app を閉じた後に sidecar process が残らない。
- port 衝突、DB permission、invalid config を区別して表示できる。

### 8. Packaging and distribution

macOS 配布の摩擦を減らす。

実装方針:

- `.app` / `.dmg` の生成を Tauri build に載せる。
- Developer ID Application 証明書で署名する。
- notarization を CI または release script に組み込む。
- sidecar binary / Node runtime / native modules を署名対象に含める。
- Apple Silicon / Intel の arch を明示する。Universal build にするか、arch 別 artifact にするかを決める。

完了条件:

- ダウンロードした app が Gatekeeper の通常フローで開ける。
- 署名なし開発 build と署名済み release build の手順が分かれている。

### 9. Environment preflight

Tauri 化で NightWorkers 本体の導入は簡単になるが、対象 Project の実行環境依存は残る。

チェック対象:

- `git`
- shell
- Node / pnpm / npm / bun など対象 Project が必要とする package manager
- LLM credential
- Codex token
- MCP server command / URL
- Agent Hook command
- repository permission
- app data DB write permission

実装方針:

- Settings または Project registration 時に preflight を実行する。
- NightWorkers 本体の起動問題と Project 実行環境問題を UI 上で分離する。
- 実行不能でも chat / planning / settings は使える degraded state を残す。

完了条件:

- 「アプリは起動したが、この Project は pnpm がないので実行できない」のように原因が分かる。
- 導入失敗と実行環境不足を混同しない。

## 段階的な移行順序

### Phase 0: Tauri shell foundation

- Tauri skeleton を追加する。
- 既存 Vite UI を WebView に表示する。
- Tauri dev flow から WebView を起動できるようにする。
- 一時的に手動起動の既存 API へ接続し、Tauri WebView から `/api` と WebSocket が通ることを初期 smoke として確認する。

Exit:

- UI が表示され、health / settings / Workbench list が読める。
- Tauri 化を前提にした frontend 起動導線ができている。

### Phase 1: sidecar 起動

- backend bundle を Tauri sidecar として起動する。
- Tauri shell が空き port を選び、sidecar env と frontend config に渡す。
- health check と shutdown を通す。
- frontend が sidecar API origin を使えるようにする。

Exit:

- `pnpm tauri dev` だけで UI + API + WS が動く。

### Phase 2: app data runtime

- DB、settings、logs、secret を app data 配下へ移す。
- first-run bootstrap を実装する。
- `.env` なしで起動する配布モードを作る。

Exit:

- clean machine 相当の runtime dir で初回起動できる。

### Phase 3: packaging

- macOS app / dmg を生成する。
- sidecar / Node runtime / native modules を artifact に含める。
- local install smoke を行う。

Exit:

- repo checkout 外の app artifact から起動できる。

### Phase 4: signing and notarization

- Developer ID 証明書を使った署名を設定する。
- notarization と stapling を release script / CI に入れる。
- Gatekeeper 通過を実機で確認する。

Exit:

- 署名済み dmg をダウンロードして通常起動できる。

### Phase 5: preflight and onboarding polish

- Project 実行環境の preflight を UI に出す。
- LLM / MCP / hooks / package manager の不足を明示する。
- 起動失敗 diagnostics を整える。

Exit:

- 本体導入失敗、Project 環境不足、credential 不足を別々に案内できる。

## 主なリスク

### Node sidecar packaging

Node runtime、native modules、production dependencies、arch 別 binary の扱いが最大の packaging リスク。`better-sqlite3` は dependency にあるが現状 DB client は libSQL を使っているため、配布に本当に必要な native dependency を棚卸しする。

### port / origin / CSRF

Tauri WebView と localhost sidecar の origin がずれる。REST は通っても WebSocket や CSRF で落ちる可能性がある。API base と WS base を一箇所に集約してから進める。

### cwd 前提

`process.cwd()` 前提の paths が配布版では app bundle 内や起動元 shell に依存して壊れる。runtime state は app data、readonly resource は app resource、対象 repo の作業は登録済み Project root に分ける。

### sidecar shutdown

app 終了時に backend が残ると port、DB lock、queue active state が壊れる。graceful shutdown と stale active run recovery を組み合わせる。

### 署名 / notarization

Developer ID と notarization は導入摩擦を減らすために重要。未署名配布は検証用途に限定する。sidecar binary や native modules が署名漏れすると notarization で失敗する。

### ユーザー環境依存

NightWorkers 本体は簡単に入っても、対象 Project の `git`、package manager、test runner、外部 command は残る。preflight と degraded state が必要。

## 検証計画

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:supervisor-regression`
- `pnpm build`
- Tauri dev 起動 smoke
- Tauri packaged app 起動 smoke
- WebSocket reattach smoke
- first-run clean app data smoke
- existing `.env` based dev mode smoke
- app close 後の sidecar process 残存チェック
- SQLite integrity check for generated app data DB
- macOS Gatekeeper / notarization smoke for release artifact

## ドキュメント更新対象

実装時には、この計画書だけでなく以下も更新する。

- `README.md`: インストール方法、desktop app の current capability、developer flow
- `spec/docs/architecture.md`: Tauri shell、Node sidecar、runtime state boundary
- `spec/docs/configuration.md`: app data path、desktop env、first-run bootstrap、credential 設定
- `.env.example`: desktop 配布では不要なものと dev only の区別
- release docs or scripts: signing / notarization / artifact smoke

## 実装方針の確定

NightWorkers は Tauri デスクトップアプリとして配布する。これにより、NightWorkers 本体の導入失敗を減らす。特に Node/pnpm/migration/env/2-process 起動を利用者から隠せるため、配布体験は大きく改善する。

ただし、NightWorkers の価値の中心は Project repo を読み書きし、worker tools、hooks、MCP、LLM provider を動かすことにある。したがって初期移行では既存 Node backend を sidecar として維持し、Tauri は packaging、lifecycle、path、onboarding、preflight を担当する境界が最も安全である。
