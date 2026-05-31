# Hono Standard テンプレート

Hono、Drizzle ORM、React、TanStack Router を活用した、モダンで堅牢、かつ型安全なフルスタック・モノリス ウェブアプリケーションのテンプレートです。

## 目次
- [技術スタック](#技術スタック)
- [クイックスタート](#クイックスタート)
- [主要コマンド](#主要コマンド)
- [主な機能](#主な機能)
- [アーキテクチャ・プロジェクト構成](#アーキテクチャプロジェクト構成)
- [セキュリティ](#セキュリティ)
- [ライセンス](#ライセンス)

---

## 技術スタック

### バックエンド
- **コア**: [Hono](https://hono.dev/) (Node.js adapter), TypeScript
- **API ドキュメント**: [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) (Swagger UI 同梱)
- **ミドルウェア**: CORS, Secure Headers, Timing, logger, rateLimiter, CSRF

### データベース
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
- **DB**: PostgreSQL (postgres.js)

### フロントエンド
- **フレームワーク**: React 19, Vite
- **ルーティング**: [TanStack Router](https://tanstack.com/router)
- **状態管理/データ取得**: [TanStack Query](https://tanstack.com/query)
- **UI/スタイリング**: Tailwind CSS + shadcn/ui (CSS変数を用いたテーミング) + Pencil (Design-to-Code)

### テスト・品質管理
- **ユニット/統合テスト**: [Vitest](https://vitest.dev/)
- **E2E テスト**: [Playwright](https://playwright.dev/)
- **静的解析・整形**: [Biome](https://biomejs.dev/)

---

## クイックスタート

### 前提条件
- Node.js (v20+)
- pnpm
- Docker / Docker Compose

### セットアップ手順

1. **依存関係のインストール**
   ```bash
   pnpm install
   ```

2. **環境変数の設定**
   ```bash
   cp .env.example .env
   # .env 内の変数を環境に合わせて更新
   ```
   `AUTH_MODE` ごとの必須設定:
   - `local`: OAuth設定は不要
   - `oauth`: `APP_URL` と、`GOOGLE_*` または `GITHUB_*` のどちらか1組が必須
   - `both`: `APP_URL` は必須（OAuthを使う場合は `GOOGLE_*` または `GITHUB_*` のどちらか1組を設定）
   - `COOKIE_SAME_SITE=none` を使う場合は HTTPS (`APP_URL` が `https://...`) であることが必須

   `VITE_ENABLE_MSW=true` を設定すると、開発時に MSW モックを有効化できます（デフォルトは `false`）。
   リバースプロキシ配下（Nginx / Cloudflare など）で動かす場合は `TRUST_PROXY=true` を設定してください。

3. **データベースの起動**
   ```bash
   docker-compose up -d
   ```

4. **データベースの初期化**
   ```bash
   pnpm db:migrate # 既存マイグレーションを適用
   pnpm db:seed   # テストデータの投入
   ```

5. **開発サーバーの起動**
   ```bash
   pnpm dev
   ```

アプリケーション、API、ドキュメントはすべて `http://localhost:5173` 経由でアクセス可能です。

---

## 主要コマンド

| コマンド | 説明 |
|---|---|
| `pnpm dev` | 開発サーバーの起動 |
| `pnpm build` | プロダクションビルド (FE & BE) |
| `pnpm start` | コンパイル済みバックエンドの実行 |
| `pnpm test` | Vitest によるテスト実行 |
| `pnpm test:e2e` | Playwright による E2E テスト実行 |
| `pnpm test:e2e:smoke` | `@smoke` タグ付きE2Eのみ実行 |
| `pnpm test:e2e:regression` | `@regression` タグ付きE2Eのみ実行 |
| `pnpm test:coverage` | Vitest カバレッジレポート生成 |
| `pnpm lint` | Biome によるコードチェック |
| `pnpm typecheck` | TypeScript 型チェック |
| `pnpm db:generate` | マイグレーションSQLを生成 |
| `pnpm db:migrate` | マイグレーションを DB に適用 |
| `pnpm db:push` | 開発用途でスキーマを直接反映（本番非推奨） |
| `pnpm db:studio` | Drizzle Studio の起動 |
| `pnpm db:seed` | シードデータの投入 |

### E2Eタグ運用
- `@smoke`: 主要導線の高速確認用（PRごとに実行推奨）
- `@regression`: 回帰確認用のフルスイート（定期実行/マージ前推奨）

### マイグレーション運用（推奨）
1. スキーマ変更後に `pnpm db:generate` で SQL を生成
2. 生成された `drizzle/migrations/*.sql` をレビューしてコミット
3. ローカル・CI・本番で `pnpm db:migrate` を実行して適用
4. `pnpm db:push` は試作や検証時のみ利用し、本番フローには使わない

---

## 主な機能

- **型安全な API (Hono RPC)**: バックエンドの型定義をフロントエンドで共有。
- **OpenAPI ドキュメント**: `/api/doc` (JSON) と `/api/ui` (Swagger UI) を自動生成。
- **認証システム**: JWT (Access/Refresh) と OAuth 2.0 (Google/GitHub) に対応。
  - `GET /api/auth/methods` で有効なログイン方式（local/OAuth provider）を取得可能。
- **BBS 機能**: スレッド作成、詳細閲覧、コメント投稿の実装サンプル。
- **死活監視の分離**: liveness (`/api/health/live`) と readiness (`/api/health/ready`) を提供。
- **パフォーマンスプロファイリング**: `Server-Timing` ヘッダーによる処理時間の可視化。

---

## アーキテクチャ・プロジェクト構成

本プロジェクトはフロントエンドとバックエンドを統合した「モジュラー・モノリス」構造を採用し、ドメインベースでコードを凝集させることでメンテナンス性を高めています。エンドツーエンドの型安全性を実現するため、Hono RPC と Zod スキーマを共有しています。

### ディレクトリ構成

- **`api/` (バックエンド)**
  - `modules/`: 機能ドメインごとのコード層。各ドメインは以下の3層アーキテクチャで構成。
    - `*.routes.ts`: ルーティング、リクエストバリデーション、レスポンスの返却。
    - `*.service.ts`: ビジネスロジック。
    - `*.repository.ts`: Drizzle ORM を用いたデータベースアクセス処理。
  - `db/`, `middleware/`: DB接続設定や、認証・セキュリティ・ロギング等の共通ミドルウェア。

- **`src/` (フロントエンド)**
  - `modules/`: 機能ドメインごとのコード層。UIとロジックを近接して管理します。
    - `components/`: ドメイン固有のUIコンポーネント。
    - `hooks/`: 状態管理やUIの副作用を切り出したカスタムフック。
    - `repositories/`: バックエンドAPIを呼び出すデータフェッチ層 (TanStack Query等の処理)。
    - `services/`: フロントエンド側の複雑なロジックやデータ加工処理。
  - `routes/`: TanStack Router によるファイルベースのルーティング。
  - `lib/api.ts`: Hono RPCによる型安全な API クライアント (`client`) を定義。Cookie セッションの自動リフレッシュをカプセル化。

- **`shared/` (共有コード)**
  - `schemas/`: Zod によるバリデーションスキーマ群。フロントエンドの入力検証と、バックエンドの引数検証で全く同じスキーマを再利用することで DRY な設計を実現。

- **`drizzle/`**
  - DBのマイグレーション設定およびシードデータ生成スクリプト。

---

## セキュリティ

### トークン管理
JWT (Access/Refresh) は `httpOnly Cookie` に保存されます。
- **メリット**: JavaScript から直接参照できないため、トークン窃取系XSSに強い構成です。
- **補足**: CSRF対策として `csrf()` ミドルウェアを併用し、`Origin/Referer` を検証します。

### セキュリティミドルウェア
- **CSRF**: Hono 標準の `csrf()` による Origin/Referer チェック。
- **セキュリティヘッダー**: `Secure Headers` による CSP、HSTS 等の設定（本番では `unsafe-inline` / `unsafe-eval` を無効化）。
- **レート制限**: ブルートフォース攻撃を防ぐための `rateLimiter` (メモリベース) を全 API に適用。
- **CORS**: ワイルドカード不許可の明示オリジン許可リスト方式を採用。

---

## ライセンス
MIT
