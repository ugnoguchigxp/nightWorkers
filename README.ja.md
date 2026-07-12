# NightWorkers

<img src="assets/brand/nightworkers-logo-icon-64.png" alt="NightWorkers ロゴ" width="64" height="64" />

[English](./README.md) | [日本語](./README.ja.md)

NightWorkersは、ローカルファーストの自律開発コントロールプレーンです。Project単位のWorkbench Sessionを調整し、supervisor-worker実行を管理し、event、log、diff、Todo、test result、final reportなどの検証可能な証跡を保存します。

![NightWorkers Workbench](assets/screenshot.webp)

## NightWorkersとは

NightWorkersはTask一覧付きの単なるチャットUIではありません。Project Folderを登録し、Workbench Sessionで相談・計画し、Implementation Queueへの投入を人が決め、実行後の証跡を確認するためのローカルな制御面です。

初めて評価する場合は、次の順で確認してください。

1. [Feature Tour](./spec/feature-tour.md)
2. [First Run Orientation](./spec/first-run-orientation.md)
3. [Adoption Checklist](./spec/adoption-checklist.md)

## 主な価値

- SQLite/libSQLを標準とするローカルファースト運用
- 接続が切れても失われない、永続化されたrun lifecycleとevent ledger
- OpenAI、Azure OpenAI、Bedrock、Codex SDKに対応したprovider設定
- structured providerとimplementation runtime laneの分離
- 明示的なImplementation Queue投入
- diff、Todo、test、usage、artifact、final reportの記録
- Test Mode、Review Mode、Security Oracle、blocking findingを分けて評価するGit closeout
- Tauri shellとNode sidecarによるdesktop distribution

## 適している用途

- 自律的なコーディングrunをローカルで運用したい。
- Queueへ入れる前に明示的に承認したい。
- tool call、policy block、diff、test、final reportを証跡として残したい。
- 単一ユーザー向けのdesktop／local control planeが必要。

次の用途には適していません。

- hosted team collaborationやbrowser-only SaaS onboarding
- PR作成、merge、release、deployの標準自動化
- 同じrepository上での並列multi-agent orchestration

## 現在の機能

- Project FolderとSession／Task管理
- Processor laneを持つImplementation Queue
- TODO Workflow gateとrun timeline
- Test ModeとReview Modeの分離
- evidence-gated Git commit／push closeout
- Project tree、source、diff、Blueprintを表示するArtifact Pane
- Blueprint Preview、Plan Mode Workspace、Data Model
- LLM provider、MCP Server、Agent Hooks、Security Intelligence設定
- health／readiness endpointとAPI docs

## クイックスタート

```bash
bun run setup
bun run dev
```

標準URLは`http://localhost:39174`です。最初はthrowaway repositoryを登録し、次のようなread-only requestから始めてください。

```text
リポジトリ構造を調査し、利用可能なテストコマンドをまとめてください。ファイルは変更しないでください。
```

## 認証情報不要のデモ

[Support Ops CRM demo](./demo/support-ops-crm/README.md)は、使い捨てのGit ProjectでPlan、Queue、固定実装、test、Review evidenceを再現します。

```bash
bun run demo:setup
bun run demo:run
bun run demo:reset
```

CI向けの一括確認は`bun run demo:smoke`です。

## 実装からGit closeoutまで

NightWorkersはchat、Queue、Implementation、Test、Review、Git closeoutを別の状態として扱います。

1. Project FolderとWorkbench Sessionを選びます。
2. implementation-readyな作業だけをQueueへ投入します。
3. Run Timelineでtool call、policy block、Todo、diff、final reportを確認します。
4. Test Modeを実行し、active verification checklist、managed evidence、成功した`completion_check`を確認します。
5. Review Runを完了し、blocking findingを解消または明示的にdispositionします。
6. Reviewが修正を適用した場合、修正後にTest Modeを再実行します。
7. implementation Security Oracleがpassしたか、effective Project policyによる理由付きskipが保存されたことを確認します。
8. server-side closeoutが全gate完了を返した後に、Review Statusから明示的にcommit／pushします。

`running`、`needs_human`、`failed`のReview Runは完了証跡ではありません。Review Run内の任意Security Reviewはimplementation Security Oracleとは別です。Commit時にSecurity Oracleを再実行することはありません。

## アーキテクチャ

- Backend: Hono + TypeScript (`api/`)
- Frontend: React + Vite + TanStack Router (`src/`)
- Database: Drizzle ORM + SQLite/libSQL (`drizzle/`, `sqlite.db`)
- Shared schema: Zod (`shared/schemas`)
- Desktop: Tauri shell + Node sidecar (`src-tauri/`)

詳細は[Architecture and Module Boundaries](./spec/architecture.md)を参照してください。

## 必要環境

- Bun 1.3+
- Node.js 20+（desktop sidecarとNode tooling用）
- Rust toolchainと対象OSのdesktop build tool

## デスクトップアプリ

```bash
bun run desktop:build
bun run desktop:smoke
```

macOSの標準artifact:

```text
src-tauri/target/release/bundle/macos/NightWorkers.app
```

Linux／Windowsは対応するOS build hostで実行します。

```bash
bun run desktop:build:linux
bun run desktop:build:windows
```

Linuxは`.deb`、`.rpm`、AppImage、Windowsはx64 NSISとMSIを対象にします。DMGは`bun run desktop:build:dmg`、Developer ID signingは`bun run desktop:sign`という別gateです。

Desktop runtime stateとdiagnosticsは`NIGHTWORKERS_RUNTIME_DIR`配下に保存されます。主なlogは`desktop.log`、`sidecar.log`、`api.log`です。

## 設定

主な環境変数:

- `DATABASE_URL`: SQLite/libSQL接続先
- `AUTH_MODE`: `local` / `oauth` / `both`
- `API_AUTH_REQUIRED`: product APIとWebSocketの保護
- `APP_URL`: OAuthとsecure cookie用
- `TRUST_PROXY`: reverse proxy配下で`true`
- `NIGHTWORKERS_RUNTIME_DIR`: desktop runtime root
- `NIGHTWORKERS_MCP_SETTINGS_PATH`: MCP設定path override
- `NIGHTWORKERS_HOOKS_SETTINGS_PATH`: Hooks設定path override
- `NIGHTWORKERS_LLM_SETTINGS_PATH`: LLM設定path override

詳細は[Runtime Configuration Reference](./spec/configuration.md)を参照してください。

## 開発コマンド

| コマンド | 説明 |
| --- | --- |
| `bun run dev` | APIとwebをwatch modeで起動 |
| `bun run build` | frontendとbackendをbuild |
| `bun run start` | production backend bundleを起動 |
| `bun run desktop:dev` | desktop appをdevelopment modeで起動 |
| `bun run desktop:build` | 現在のOS向けdesktop artifactをbuild |
| `bun run desktop:smoke` | packaged appのAPI、WebSocket、log、shutdownを確認 |
| `bun run demo:smoke` | credential-free demoを実行してreset |
| `bun run check:docs` | command、link、anchor、archive整合を確認 |
| `bun run lint` | Biome check |
| `bun run typecheck` | TypeScript check |
| `bun run test` | Vitest |
| `bun run test:e2e` | Playwright E2E |
| `bun run db:migrate` | migrationを適用 |
| `bun run db:seed` | development dataをseed |
| `bun run verify` | lightweight base gate |
| `bun run verify:full` | full deterministic test、E2E、audit、desktop gate |
| `bun run verify:e2e` | credential-free Playwright smoke |
| `bun run verify:desktop` | desktop runtime、lint、build、smoke |
| `bun run verify:audit` | High／Critical dependency policy |
| `bun run verify:live` | external-provider canaryを明示実行 |
| `bun run verify:release` | release-ready gate |

## テストと検証

- `bun run verify`: tracked artifact、TypeScript、Biome、Supervisor regression test
- `bun run verify:full`: full Vitest、Playwright、accessibility、demo、dependency audit、desktop build／smoke
- `bun run verify:live`: external LLMを呼び得る唯一のgate。credentialsがない場合はskip
- `bun run test:coverage`: V8 coverageを`coverage/coverage-summary.json`へ出力
- `test:e2e:*`: `.nightworkers-e2e/<run-id>/`の専用DB／runtime／fixture repositoryを使用し、終了後にreset
- `pre-commit`／`pre-push`: fastな`bun run verify`のみを実行

推奨するpre-PR検証:

```bash
bun run verify
```

Release candidateは`bun run verify:release`を通す必要があります。

## 信頼モデル

Primary runtime stateはローカルに保存されます。Projectの実作業はtemporary directoryではなく登録済みProject repo rootを基準にします。Provider callにはuser request、Supervisor context、StateCard、tool/result summary、artifact/task contextが含まれる場合があります。

機密repository、provider credentials、MCP、Hooksを接続する前に[Trust Model](./spec/trust-model.md)を読んでください。

## ドキュメント

- [Feature Tour](./spec/feature-tour.md)
- [First Run Orientation](./spec/first-run-orientation.md)
- [Adoption Checklist](./spec/adoption-checklist.md)
- [Architecture](./spec/architecture.md)
- [Runtime Configuration](./spec/configuration.md)
- [Credential-Free Demo](./demo/support-ops-crm/README.md)
- [0.1.0 Release Notes](./spec/release-notes/0.1.0.md)

Active specificationは`spec/docs/`、完了済みimplementation planは`spec/archive/`に置きます。

## コントリビューション

[CONTRIBUTING.md](./CONTRIBUTING.md)を参照してください。

## セキュリティ

脆弱性は[SECURITY.md](./SECURITY.md)に記載された方法で報告してください。

## ライセンス

MIT
