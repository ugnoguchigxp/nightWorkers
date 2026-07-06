# NightWorkers 改善ロードマップ

評価日: 2026-07-06 | 対象バージョン: 0.1.0

本文書は多角的プロジェクト評価で洗い出された改善余地を整理したものである。
各項目は「現状の問題」「なぜ問題か」「取り掛かり方針」の順で記述する。

---

## 1. テスト・品質保証

### 1-1. Branches カバレッジが目標 80% を下回っている (現状: 67.8%)

**現状の問題**

`bun run test:coverage` が出力する `coverage-summary.json` では、
lines 83.8% / functions 88.2% / statements 81.1% は目標をクリアしているが、
branches だけが 67.8% にとどまる。
`vitest.config.ts` の exclude リストには `api/routes/*.ts`、
`api/services/mcp/**`、`api/services/realtime/nightworkers-ws.ts`、
`api/services/quality/**` など、条件分岐が多いパスが測定対象外になっており、
実質的に計測されているブランチよりカバー範囲は狭い。

**なぜ問題か**

branches カバレッジは「条件分岐の false 側が実際にテストされているか」を示す指標であり、
ここが低いと「happy path は通っているが error 系やエッジケースが未テスト」という
状態が隠れやすい。特に queue 関連・認証フロー・MCP ブリッジのような
状態遷移が多いコードでは、未カバー分岐が障害時の予期せぬ挙動として顕在化する。

**取り掛かり方針**

1. まず `bun run test:coverage` を走らせ、`coverage/` の HTML レポートで
   branches カバレッジが最も低いファイルを特定する
   (現在 `search-files.ts` が branches 30.4%、`source-symbols.ts` が 55.1% など)。
2. `vitest.config.ts` の exclude から、実際にロジックを持つ
   `api/services/mcp/**` と `api/services/realtime/nightworkers-ws.ts` を
   段階的に測定対象に戻す。ただし、計測を追加しても既存 exclude の理由
   (副作用ファイル / 自動生成ファイル) が依然有効なものは外さない。
3. 各ファイルのカバレッジ改善は「1 ファイルずつ、関連する既存テストに
   分岐パターンを追加する」形を優先し、新規テストファイルを大量に増やすより
   既存テストの質を高めることを意識する。
4. `services.coverage-gate.test.ts` が既にカバレッジ閾値をテストしているため、
   閾値定義をそちらに集約し、CI がカバレッジ低下を自動検知できるようにする。

---

### 1-2. Playwright E2E の CI 統合が明示されていない

**現状の問題**

README の Testing セクションには
`bun run test:e2e:smoke` を「local app/server prerequisites が明示的に
利用可能な場合に別途実行する」と記載されており、`verify` ゲートには含まれていない。
Playwright の設定 (`playwright.config.ts`) はポートや baseURL を持つが、
サーバーを自動起動する `webServer` ブロックが入っているかどうか未確認であり、
CI でどうトリガーするかが規定されていない。

**なぜ問題か**

E2E が CI の常時 gate に入っていないと、手元では通っていたが
master へのマージ後に E2E が赤くなるリグレッションが発生しやすい。

**取り掛かり方針**

1. `playwright.config.ts` に `webServer` ブロックを追加し、
   テスト実行前に `bun run dev` 相当を自動起動するオプションを評価する。
2. `@smoke` タグのみの E2E を `verify` ゲートに組み込む
   (フルの E2E は引き続き別ゲートでよい)。
3. GitHub Actions または CI ランナーで `bun run test:e2e:smoke` が
   通る最小構成を `docs/` か `.github/workflows/` に明示する。

---

### 1-3. CHANGELOG が変更履歴として機能していない

**現状の問題**

`CHANGELOG.md` には `[Unreleased]` エントリが 1 件だけ存在し、
内容は「OSS ドキュメントベースライン」の追加だけである。
バージョン 0.1.0 のエントリが存在せず、過去の変更を追跡する手段がない。

**なぜ問題か**

CHANGELOG が空だと、「どの変更がいつ入ったか」を git log で追う必要があり、
レビューやリグレッション調査のコストが上がる。
また OSS として外部貢献者が参照する際の信頼性にも影響する。

**取り掛かり方針**

1. [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式を採用する旨が
   既に記載されているので、`0.1.0` エントリを追記する。
   `Added` / `Changed` / `Fixed` / `Removed` の区分で現時点の主要機能を記録する。
2. `verify` ゲートに「`[Unreleased]` が空でないか」チェックを追加するか、
   PR テンプレートに「CHANGELOG 記入」を必須フィールドとして設ける。
3. 今後は機能追加や破壊的変更を `[Unreleased]` に都度追記し、
   タグ作成時に `[Unreleased]` → バージョン番号へ昇格させる運用を定着させる。

---

## 2. コード品質

### 2-1. カバレッジ対象外の重要パスが多い

**現状の問題**

`vitest.config.ts` の exclude に以下が含まれており、
コードが存在するにもかかわらず自動テストが計測されていない。

- `api/routes/*.ts` (auth, health, mcp-settings, hooks-settings, settings, oauth)
- `api/services/mcp/**` (MCP ブリッジ実装)
- `api/services/realtime/nightworkers-ws.ts` (WebSocket ハンドラ)
- `api/services/quality/**` (カバレッジゲート本体)
- `api/modules/blueprint/blueprint.service.ts`
- `api/modules/dataModel/data-model.service.ts`
- `api/modules/specification/specification.service.ts`

**なぜ問題か**

`api/routes/*.ts` は認証・OAuth・設定変更の HTTP エンドポイント実装そのものであり、
これらが計測外だと「ルート層の入力バリデーションや認証バイパスが
テストされていない」状態を数字から検知できない。
既に `tests/routes.auth.cookies.test.ts` や `tests/routes.oauth.test.ts` は
存在するが、カバレッジ計測に含まれていないため、カバー率の改善が見えない。

**取り掛かり方針**

1. まず `api/routes/*.ts` を exclude から外し、現在どの程度カバーされているかを
   確認する。routes は外部入力の入り口なので 80% 以上が望ましい。
2. `api/services/realtime/nightworkers-ws.ts` は副作用が強いため、
   MSW または `vi.mock` で WebSocket インフラをモックしたうえで
   計測対象に加える方法を検討する。
   `tests/nightworkers.realtime-events.test.ts` が既にあるので活用できる。
3. Blueprint/DataModel/Specification サービスは LLM 呼び出しを含むため、
   `test` プロバイダー経由でモックして計測対象に追加する。

---

### 2-2. 非 null アサーション (`!`) が許容されている

**現状の問題**

`biome.json` で `noNonNullAssertion: off` かつ
`noNonNullAssertedOptionalChain: off` が設定されており、
`!` 演算子や `?.!` チェーンが lint エラーにならない。

**なぜ問題か**

非 null アサーションは「開発者が null/undefined でないと確信している」という
宣言だが、その確信が後のリファクタリングで崩れた場合に
ランタイムで `TypeError: Cannot read properties of undefined` が発生する。
local-first のデスクトップアプリでは、クラッシュが即ユーザー体験の劣化につながる。

**取り掛かり方針**

1. 全廃は変更量が大きいため段階的に進める。まず
   `api/modules/nightworkers/` と `api/services/run-events/` など
   クリティカルなパスに限定して `!` の使用箇所をリストアップする
   (`grep -rn '!' api/modules/ --include="*.ts" | grep -v '!='`)。
2. 各箇所を「早期 return + Error throw」または「Zod parse」に置き換えていく。
3. 対象ファイルの修正が完了した単位で `noNonNullAssertion: error` を
   個別ファイルの biome ignore ではなく、allow-list 方式で段階適用する。
4. 長期的には `noNonNullAssertion: error` をデフォルトに戻すことを目標とする。

---

### 2-3. フロントエンドのユニットテストが薄い

**現状の問題**

`vitest.config.ts` のカバレッジ include には
`src/modules/nightworkers/workbenchSelectors.ts` と `src/lib/utils.ts` しかなく、
`src/components/` や `src/modules/` 配下の React コンポーネント・カスタムフックは
Playwright E2E か手動確認に頼っている。

**なぜ問題か**

E2E は重要だが、コンポーネントレベルのロジック変更 (条件表示・フォームバリデーション・
状態管理など) を素早くフィードバックするには unit/integration テストが必要である。
E2E だけでは「どのコンポーネントで何が壊れたか」の特定に時間がかかる。

**取り掛かり方針**

1. まず既存の `.test.tsx` ファイル (`project-detail-screen.test.tsx` など) を
   参考に、`jsdom` 環境で動作する React Testing Library 相当のセットアップが
   既に整っているか確認する。
2. `src/modules/nightworkers/` のカスタムフック・セレクター関数から始め、
   純粋なロジック部分を `vitest` のカバレッジ対象に加える。
3. UI コンポーネントは「描画テスト」より「インタラクションロジックテスト」を優先し、
   `userEvent` ベースのシナリオテストを段階的に追加する。
4. カバレッジ include を `src/modules/**/*.ts` と `src/hooks/**/*.ts` に
   段階的に拡大し、目標 60% から始めて 80% に向けて引き上げる。

---

## 3. セキュリティ

### 3-1. `API_AUTH_REQUIRED` デフォルト `false` の誤公開リスク

**現状の問題**

`API_AUTH_REQUIRED` は未設定の場合 `false` として扱われ、
全 API エンドポイントが認証なしでアクセス可能になる。
`spec/trust-model.md` には「localhost 以外へ露出しないこと」と注意書きがあるが、
ランタイム側での検知・警告機能は存在しない。
例えばリモート開発環境や Docker コンテナを外部ネットワークに公開した場合、
意図せず API が無認証で露出する。

**なぜ問題か**

NightWorkers はローカルリポジトリへのファイル書き込み権限を持つ worker を
動作させる。認証なしで外部から API にアクセスできる状態では、
`apply_patch` や `run_command` 相当の worker tool が悪用され、
ローカルファイルシステムが危険に晒される可能性がある。

**取り掛かり方針**

1. サーバー起動時 (`api/server.ts` または `api/index.ts`) に、
   `API_AUTH_REQUIRED=false` かつバインドアドレスが `0.0.0.0` (または非 localhost) の
   場合に、起動ログに **警告** を出力する処理を追加する。
   例: `⚠ API_AUTH_REQUIRED is false and the server is listening on a non-localhost interface.`
2. `/api/settings/preflight/startup` のレスポンスに
   `{ authRequired: false, listeningInterface: '0.0.0.0' }` 系のフィールドを追加し、
   フロントエンドの Overview 画面にセキュリティ警告バナーを表示する。
3. `.env.example` に `API_AUTH_REQUIRED=false  # ローカル個人用。外部公開時は true に変更` と
   コメントを充実させる。現状は短い説明のみ。
4. `spec/trust-model.md` の Operator Checklist を
   起動フロー説明と紐付け、チェック済みの旨を設定 UI で確認できる仕組みを検討する。

---

### 3-2. MCP SSE レガシー互換モードの境界があいまい

**現状の問題**

MCP Settings は `stdio` / `Streamable HTTP` に加え
`legacy SSE` 互換モードをサポートしている。
レガシー SSE は古い MCP サーバーとの互換性のために残されているが、
auth ヘッダー拒否ポリシーが SSE コネクション確立フェーズにも
適切に適用されているか、テストカバレッジが薄い。

**なぜ問題か**

SSE は長期間 keep-alive な接続であるため、
一度接続が確立された後のポリシー適用漏れは静かに継続する。
`tests/services.mcp-settings.test.ts` (13KB) には設定レベルのテストがあるが、
接続フローのセキュリティパスを直接確認するテストが不足している可能性がある。

**取り掛かり方針**

1. `api/services/mcp/` 内の SSE コネクション処理を読み、
   auth ヘッダー検査と secret-like 値のバリデーションが
   接続確立前に確実に実施されるパスを特定する。
2. `tests/services.mcp-settings.test.ts` に SSE 固有の拒否シナリオ
   (auth ヘッダー付き接続試行、secret-like な env 値を含む設定登録) を追加する。
3. レガシー SSE を長期的に deprecate する方針を `spec/` に記録し、
   設定 UI にも deprecation 表示を追加することを検討する。

---

## 4. 開発体験 (DX)

### 4-1. `bun.lock` と `pnpm-lock.yaml` の二重管理

**現状の問題**

リポジトリルートに `bun.lock` と `pnpm-lock.yaml` の両方が存在し、
`pnpm-workspace.yaml` も残っている。
README には「pnpm 10+ は Bun への移行中の fallback として一時サポート」と記載されているが、
`packageManager: bun@1.3.14` と明示しているにもかかわらず
pnpm 側のファイルが削除されていない。

**なぜ問題か**

新しい貢献者が `pnpm install` でセットアップを試みると、
`pnpm-lock.yaml` が古い状態のままの場合に依存関係のずれが生じる。
また CI が `bun install` と `pnpm install` のどちらを使うべきか不明確になる。
lockfile の二重管理はセキュリティアップデートの適用漏れも引き起こしやすい。

**取り掛かり方針**

1. まず移行判断を明確にする。「Bun へ完全移行済み」であれば、
   `pnpm-lock.yaml` と `pnpm-workspace.yaml` を削除し、
   `.gitignore` に `pnpm-lock.yaml` を追加する。
2. 削除前に `pnpm install` を使っている CI ワークフローや
   スクリプトがないか全文検索で確認する。
3. CONTRIBUTING.md に「`bun install` を使う。pnpm は不要」と明記する。
4. もし pnpm fallback が依然必要なユースケース (Node.js ツールチェーン連携など) が
   あるなら、その理由を `spec/docs/` に残し、どの状況でどちらを使うかを明確にする。

---

### 4-2. 初回セットアップのワンショットコマンドがない

**現状の問題**

Quick Start では 4 ステップ (install → cp .env → db:migrate → db:seed → dev) を
手動で実行する必要がある。
`package.json` にはデータベース操作コマンドが豊富にあるが、
「clone して最初に一度だけ実行する」セットアップコマンドがない。

**なぜ問題か**

ステップが多いと初回起動の失敗率が上がる。
特に `.env` のコピーを忘れた場合やマイグレーション未適用の場合は
エラーメッセージが暗号的になりやすく、新規参加者のオンボーディングコストが増える。

**取り掛かり方針**

1. `package.json` に `setup` スクリプトを追加する。内容は以下の順で実行する。
   ```json
   "setup": "bun install && cp -n .env.example .env && bun run db:migrate && bun run db:seed"
   ```
   `cp -n` は `.env` が既に存在する場合は上書きしないオプション。
2. README の Quick Start を「`bun run setup && bun run dev`」の 2 ステップに簡略化する。
3. `setup` スクリプトの実行前チェックとして、
   `.env` が既存の場合はスキップ、DB が既にマイグレーション済みの場合は
   `db:migrate` を冪等に扱うことを確認する (`drizzle-kit migrate` は冪等なはず)。

---

### 4-3. バージョン管理戦略が未定義

**現状の問題**

`package.json` のバージョンは `0.1.0` のまま変更されておらず、
CHANGELOG と同期していない。
タグ、リリースブランチ、バージョンバンプのルールが文書化されていない。

**なぜ問題か**

将来的に OSS として外部貢献者を受け入れる場合や、
デスクトップアプリの自動更新機能を追加する場合に、
バージョニング戦略がないと混乱が生じる。

**取り掛かり方針**

1. Semantic Versioning (SemVer) の採用を宣言する
   (README には「follows Semantic Versioning where practical」とあり、意志はある)。
2. CONTRIBUTING.md にバージョンバンプのルールを追記する。
   例: `BREAKING CHANGE → major`, `新機能 → minor`, `bugfix → patch`。
3. `bun run release` スクリプト (または `scripts/release.mjs`) を作成し、
   CHANGELOG の `[Unreleased]` → バージョン番号への昇格、
   `package.json` バージョンバンプ、git タグ作成をまとめる。
4. Desktop アプリの `tauri.conf.json` バージョンと `package.json` バージョンを
   同期させる仕組みを `verify` ゲートに含める。

---

## 5. ドキュメント

### 5-1. デモコンテンツ (GIF/スクリーンショット) がない

**現状の問題**

README には「No hosted demo GIF/video in the repository docs yet」と
自己申告しているとおり、視覚的なデモが一切存在しない。
Workbench の動作、Blueprint Preview、Implementation Queue の UI を
テキストだけで説明しており、初見のユーザーがアプリの価値を
理解するには実際に起動するしかない。

**なぜ問題か**

local-first アプリはクラウドデモ環境を用意しづらいため、
スクリーンショットや GIF が「採用判断のための最短の情報」になる。
デモなしでは潜在的なユーザーが README だけで判断を下し、
試す前に離脱する確率が高くなる。

**取り掛かり方針**

1. まず静止画スクリーンショットを `assets/screenshots/` に追加し、
   README の Architecture セクション付近に埋め込む。
   対象画面: Overview、Workbench タイムライン、Blueprint Preview、
   Implementation Queue の 4 画面を最低限とする。
2. 動画は `vhs` (Charm 製の CLI アニメーション録画ツール) または
   QuickTime/Kap でキャプチャし、Releases ページに添付する形を最初の目標にする。
   (リポジトリに動画バイナリを直接コミットするのは LFS が必要になるため避ける)
3. `spec/feature-tour.md` に各画面のスクリーンショットへのリンクを追加し、
   テキスト説明と視覚的な例を組み合わせる。

---

### 5-2. `spec/docs/` 内の計画文書の状態管理

**現状の問題**

`spec/docs/` には以下の実装計画文書が存在するが、
それぞれが「計画中」「実装済み」「廃止」のどの状態かが不明である。

- `review-agentic-test-evidence-implementation-plan.md`
- `plan-mode-artifact-chat-regeneration-implementation-plan.md`
- `review-additional-prompts-implementation-plan.md`
- `review-and-autonomous-goals-concept.md`
- `mission-pilot-concept.md`
- `vulnworkbench-cli-security-oracle-plan.md`

実装が完了した計画が削除もアーカイブもされずに残ると、
新規貢献者が「これは今も有効な設計か？」と混乱する。

**なぜ問題か**

設計文書が最新のコードと乖離していると、
実装者が古い計画を参照して方針をずらしてしまうリスクがある。
特に NightWorkers では AGENTS.md のルールが設計文書を「正本参照として扱う」と
明示しているため、古い計画文書が誤った参照先になりやすい。

**取り掛かり方針**

1. 各計画文書の冒頭に **Status ヘッダー** を追加するルールを設ける。
   ```markdown
   ## Status: planning | in-progress | implemented | superseded | archived
   ```
2. 実装済みまたは廃止になった文書は `spec/archive/` に移動する
   (既に `spec/archive/` は存在している)。
3. `spec/docs/` に残る文書は「現在アクティブな設計決定またはリファレンス」のみとし、
   本ロードマップ文書 (`improvement-roadmap.md`) のように進行中の課題を追跡する
   ドキュメントはその対象とする。
4. 新しい計画文書を作成する際は必ず Status を `planning` で始め、
   実装完了後に `implemented` へ更新してから `spec/archive/` へ移動することを
   CONTRIBUTING.md に追記する。

---

## 6. 機能完成度

### 6-1. 自動 PR / マージ / デプロイの欠如

**現状の問題**

NightWorkers は「自律開発コントロールプレーン」を標榜しているが、
run が完了した後の「コミット → PR 作成 → マージ」は
現在すべてユーザーの手動操作に依存している。
diff と final report は記録されるが、それをリポジトリへ反映する
自動化パスが存在しない。

**なぜ問題か**

自律実行の最終マイルが手動になっていると、
「夜間に実行して翌朝 PR が届いている」というユースケースが実現できず、
「監視付き自動化」より「AIアシスト」の位置づけにとどまる。

**取り掛かり方針**

これは設計上の意図的な制約でもあるため、将来方針として整理する。

1. **短期 (手動支援)**: run 完了後の Workbench に
   「この diff を git commit する」ボタンを追加し、
   コミットメッセージを final report から生成するフローを検討する。
   worker tool の `run_command` で `git commit` を実行するパスは
   既に存在するため、UI からトリガーするだけで実現できる。
2. **中期 (PR 作成)**: GitHub CLI (`gh pr create`) を Agent Hook の
   `Stop` イベントに紐付け、run 完了時に PR を自動作成するオプションを
   Hook 設定から指定できるようにする。
   これは既存の Agent Hooks 基盤を利用するため、
   新しい実行パスを追加せずに実現できる。
3. **長期 (自動マージ/デプロイ)**: 品質ゲートと組み合わせた
   自動マージは Safety/Reliability の設計が必要であり、
   `spec/docs/autonomous-release-design.md` として別途計画を作成する。

---

### 6-2. Windows / Linux 非対応

**現状の問題**

Desktop アプリは macOS 専用の Tauri ビルドのみ存在する。
Web アプリとしての動作は OS 非依存だが、Rust ツールチェーンを使う
デスクトップパッケージングは macOS のみを対象にしている。

**なぜ問題か**

OSS として公開した場合、Windows・Linux ユーザーが
デスクトップ版を使えない。Web アプリモードは全 OS で動作するが、
デスクトップとの機能差 (自動起動、ネイティブシステム統合など) がある場合に
格差が生まれる。

**取り掛かり方針**

1. まず「Web アプリモードで Windows/Linux ユーザーが
   どこまで使えるか」を README に明記する。
   現状では「Requirements」に macOS 前提の記載があるが、
   Web 専用利用者向けの前提条件を分けて記載する。
2. Tauri のクロスプラットフォームビルドは GitHub Actions の
   matrix build で実現できるが、テスト環境のコストが増える。
   まず Windows/Linux の CI ビルドが通るかを確認することを
   最初のマイルストーンとする。
3. Windows 向けには `NSIS` / `MSI`、Linux 向けには `AppImage` / `deb` の
   Tauri バンドル設定を追加する (`tauri.conf.json` の `bundle.targets`)。

---

## 7. スケーラビリティ・運用信頼性

### 7-1. Queue claim が単一 API プロセス前提に閉じている

**現状の問題**

`spec/architecture.md` では、Implementation Queue の drain は process-local であり、
queue claim は単一 desktop API プロセス前提であると明記されている。
現状の in-memory drain promise は同一プロセス内の二重 drain を避けるには有効だが、
API プロセス再起動、将来の複数プロセス起動、長時間 run 中の所有権喪失を
データベース上で表現できない。

**なぜ問題か**

Queue は NightWorkers の自律実行を支える中心機能である。
所有権がメモリ上の状態に依存していると、プロセス停止や再起動後に
「誰がこの queue entry を処理中か」「再実行してよいか」を判定しづらい。
将来的に worker executor を分離する場合も、DB lease なしでは安全な claim 境界を
作れない。

**取り掛かり方針**

1. `implementation_queue_entries` に `claimedBy`、`leaseExpiresAt`、
   `heartbeatAt`、`claimAttempt` 相当の列を追加する migration を設計する。
2. claim 処理を transaction + conditional update に寄せ、
   `status = queued` かつ lease が空または期限切れの entry だけを取得する。
3. production は引き続き単一プロセスでよいが、テストでは同時 claim を模擬し、
   片方だけが成功することを確認する。
4. 既存の process-local drain promise は短期の重複起動抑止として残し、
   DB lease を source of truth として扱う段階に移行する。

---

### 7-2. 長時間 run の heartbeat と stale recovery が弱い

**現状の問題**

run の lifecycle は `task_runs`、`task_events`、queue entry に保存されるが、
実行中 run が「生きているか」「停止した API プロセスに取り残されたか」を
定期的に判定する仕組みが明確ではない。
Queue / run の状態遷移は存在する一方で、stale な `running` / `finalizing` を
どの条件で `needs_human` や retry 候補へ移すかが運用ルールとして固定されていない。

**なぜ問題か**

LLM provider の timeout、Codex runtime の abort、desktop sidecar の再起動などで
run が中断した場合、UI 上は実行中に見えるが実際には進んでいない状態が起きる。
この状態を自動検出できないと、Queue が詰まったように見え、
ユーザーは DB やログを直接確認する必要が出てくる。

**取り掛かり方針**

1. run 開始後に定期的な heartbeat event または `task_runs.heartbeatAt` を更新する。
2. API 起動時と queue drain 前に stale run scan を行い、
   一定時間 heartbeat がない `running` / `finalizing` run を検出する。
3. 自動 retry する条件と `needs_human` に落とす条件を分ける。
   provider capacity のような既知の一時失敗は retry 対象、
   worktree 変更済みで final report なしの run は人間確認対象にする。
4. stale 判定の結果は `task_events` に記録し、Workbench timeline から
   「なぜ止まった扱いになったか」を追えるようにする。

---

### 7-3. Run event replay の上限と pagination が不足している

**現状の問題**

Run event は SQLite に永続化され、Workbench reattach は `runId` と `afterSeq` で
イベントを再取得できる。
ただし、run が長くなり `task_events` が数百から数千件に増えた場合に、
1 回の replay で返す件数・payload size・古い event の扱いをどう制限するかが
明確に文書化されていない。

**なぜ問題か**

Run evidence を多く保存するほど監査性は上がるが、同じ量を毎回 UI に投げると
Workbench の再接続やページ遷移が遅くなる。
特に tool output、diff、test result、LLM usage などを含む event は payload が
大きくなりやすく、local-first でも UI の体感速度を落とす。

**取り掛かり方針**

1. `/api/runs/:id/events` に `limit` と最大 payload size の上限を明示する。
   既存の `afterSeq` は維持し、cursor-based pagination として扱う。
2. 大きい event payload は event 一覧では summary だけを返し、
   詳細は artifact / run detail API で遅延取得する方針を決める。
3. `task_events` が 1,000 件以上ある fixture を作り、
   replay API が一定時間内に返ることを regression test にする。
4. Workbench 側は「最新 N 件 + 必要時に過去を読み込む」表示へ寄せ、
   初回 attach の payload を抑える。

---

### 7-4. Artifact / timeline の projection 再構築コストが増えやすい

**現状の問題**

Artifact Pane や Workbench timeline は、artifact rows、activity artifacts、
task messages、event projections など複数の source から表示用データを組み立てる。
`spec/architecture.md` では artifact row を優先し、legacy task message payload は
fallback とする projection rule が定義されているが、表示用 read model を
キャッシュまたは事前計算する方針はまだ薄い。

**なぜ問題か**

セッションが長くなるほど、表示のたびに複数テーブルを読み、
互換 projection を再構築するコストが増える。
機能追加で artifact source が増えると、同じ selection / normalization ロジックが
各画面に散り、表示差分や古い artifact の扱いでバグが出やすくなる。

**取り掛かり方針**

1. Workbench timeline と Artifact Pane が必要とする projection shape を棚卸しする。
2. `activity_artifacts` または dedicated read model table に、
   表示用 summary、source type、resolvable artifact id、updatedAt を保存する方針を検討する。
3. 書き込み時に projection を作る path と、古いデータを読み込み時に補完する
   compatibility path を分ける。
4. Artifact source 優先順位を unit test 化し、
   `artifact_row` が legacy task message より優先されることを固定する。

---

### 7-5. LLM usage / cost 集計が行単位参照に寄りやすい

**現状の問題**

LLM usage は `llm_usage_records` と pricing lookup を通じて Overview や
Project Detail に表示される。
現状のデータ量では問題になりにくいが、長期運用で provider call が増えると、
画面表示ごとに usage rows を集計する構造は重くなりやすい。

**なぜ問題か**

Cost / token usage は Overview で頻繁に見る指標であり、
毎回詳細行から再計算すると表示速度と DB I/O に影響する。
また pricing import や model-name normalization の修正が入った場合、
過去 usage の再集計方針がないと「表示されるコスト」と「元データ」の関係が
追いづらくなる。

**取り掛かり方針**

1. project / day / provider / model 単位の summary table を追加するか、
   SQLite view で十分かを比較する。
2. usage record 保存時に incremental summary を更新する path を追加し、
   Overview は summary を優先して読む。
3. pricing import 後に再計算が必要な場合の backfill command を用意する。
4. summary と raw rows の差分を検出する integrity check を追加し、
   cost 表示の信頼性を保つ。

---

### 7-6. Queue / run / event の負荷ベースラインがない

**現状の問題**

個別機能の unit/integration test は増えているが、
Queue entry 数、task event 数、artifact 数が増えた場合に
どの程度まで UI/API が実用的な速度で動くかを測る fixture がない。
現状のローカル DB には運用痕跡があるものの、再現可能な負荷条件としては扱えない。

**なぜ問題か**

スケーラビリティ改善は、変更前の baseline がないと効果を説明しづらい。
例えば event replay cap や projection cache を入れても、
「何件の event で何 ms 改善したか」が測れなければ、設計の妥当性を判断できない。

**取り掛かり方針**

1. `tests/fixtures` または dedicated test helper に、
   100 / 1,000 / 10,000 件の `task_events` を作る seed helper を追加する。
2. API レベルでは run detail、run events、implementation queue dashboard の
   response time と payload size を測る regression test を作る。
3. UI レベルでは Playwright smoke で大量 event の Workbench を開き、
   初回表示と scroll / reattach が破綻しないことを確認する。
4. 数値目標は最初から厳しくしすぎず、
   例として「1,000 event の replay がローカルで 500ms 未満」のような
   baseline から始める。

---

## 優先度まとめ

実装コストと改善効果を踏まえた優先度の目安。

| 項目 | 効果 | コスト | 優先度 |
|---|---|---|---|
| 1-3. CHANGELOG 整備 | 中 | 低 | **今すぐ** |
| 4-2. setup コマンド追加 | 中 | 低 | **今すぐ** |
| 5-2. spec/docs 状態管理 | 中 | 低 | **今すぐ** |
| 3-1. 誤公開リスクの警告 | 高 | 低 | **短期** |
| 7-1. Queue claim の DB lease 化 | 高 | 中 | **短期** |
| 7-2. run heartbeat / stale recovery | 高 | 中 | **短期** |
| 1-1. Branches カバレッジ向上 | 高 | 中 | **短期** |
| 2-2. 非 null アサーション段階廃止 | 中 | 中 | **短期** |
| 4-1. lockfile 二重管理解消 | 低 | 低 | **短期** |
| 5-1. デモスクリーンショット追加 | 高 | 中 | **短期** |
| 4-3. バージョン管理戦略定義 | 中 | 低 | **短期** |
| 7-3. Run event replay の上限と pagination | 高 | 中 | **短期** |
| 1-2. E2E CI 統合 | 高 | 中 | **中期** |
| 2-1. カバレッジ対象外パスの追加 | 中 | 高 | **中期** |
| 2-3. フロントエンドテスト拡充 | 中 | 高 | **中期** |
| 3-2. MCP SSE レガシー対応 | 中 | 中 | **中期** |
| 7-4. Artifact / timeline projection の read model 化 | 中 | 中 | **中期** |
| 7-5. LLM usage / cost の incremental summary | 中 | 中 | **中期** |
| 7-6. Queue / run / event 負荷ベースライン | 中 | 中 | **中期** |
| 6-1. PR/コミット自動化 | 高 | 高 | **長期** |
| 6-2. Windows/Linux 対応 | 中 | 高 | **長期** |
