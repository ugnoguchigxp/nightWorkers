# Support Ops Mini CRM Demo Implementation Plan

## Status: planning

## 目的

NightWorkers の採用しやすさを上げるため、`hono-standard` をベースにした
実行可能な demo フォルダを追加する。

この demo は、単純な Todo では見えにくい NightWorkers の価値を見せるためのもの:

- Plan Mode で UI / Data Model / implementation plan の分離が自然に発生する。
- Implementation Queue に入れる価値がある程度の実装量がある。
- Run Evidence に migration、seed、API、UI、test、final report が出る。
- 初見ユーザーが「AI が何を作ったか」を画面で確認できる。
- `hono-standard` の `bootstrap` / `verify` / `verify:e2e` をそのまま demo の検証導線に使える。

## Demo 題材

題材は **Support Ops Mini CRM** とする。

顧客サポートチームが問い合わせ ticket を triage する小型業務アプリで、
業務ドメイン、関連データ、状態遷移、集計、複数画面を含む。

## なぜこの粒度か

小さすぎる demo は NightWorkers の設計価値が出ない。
大きすぎる demo は初回評価の摩擦になる。

Support Ops Mini CRM は次の理由で適切な中間粒度になる。

- 単純 CRUD ではなく、ticket status、assignee、tag、SLA、note の状態変化がある。
- Data Model と UI Blueprint を分ける意味がある。
- Dashboard 集計と Detail 操作があり、API / DB / UI の縦断実装になる。
- 外部 API、決済、通知、複雑な認可は不要なので demo が壊れにくい。
- `hono-standard` の auth / protected route / SQLite / Drizzle / React / Playwright を自然に使える。

## 非目標

この demo では次をやらない。

- 外部メール、Slack、CRM、LLM API 連携。
- 本番品質の RBAC、監査ログ、複数 tenant。
- payment、billing、通知 queue。
- hosted demo 環境。
- NightWorkers 本体の runtime 実装変更。
- `hono-standard` 自体の upstream 変更。
- demo 成功例を手作業で完成アプリとして実装してから見せること。

## 推奨フォルダ構成

```text
demo/
  support-ops-crm/
    README.md
    prompt.md
    expected-outcome.md
    seed-scenario.md
    verification.md
    starter/
      ...hono-standard based starter...
    reference/
      screenshots/
        README.md
```

### `README.md`

demo の概要、NightWorkers での使い方、推奨評価手順を置く。

含める内容:

- この demo が見せる NightWorkers の価値。
- `starter/` を Project Folder として登録する手順。
- 最初に read-only 調査を実行する手順。
- その後 `prompt.md` を Workbench に投入する手順。
- Run Evidence の確認観点。
- 現時点で reference screenshots が未生成なら、その旨。

### `prompt.md`

NightWorkers に投入する実装依頼の正本。

prompt は日本語で、次を含める。

- Support Ops Mini CRM の MVP 実装依頼。
- Dashboard / Ticket Inbox / Ticket Detail / Customer Profile の画面要求。
- SQLite schema / seed / API / UI / test / verify の要求。
- 完了条件。
- 非目標。
- `bun run verify` と `bun run verify:e2e` を代表検証として扱う指示。

### `expected-outcome.md`

成功時に何ができているべきかを、初見ユーザー向けに短く説明する。

含める内容:

- 期待される画面。
- 期待される操作。
- 期待される seed data。
- 期待される run evidence。
- final report が触れるべき内容。

### `seed-scenario.md`

demo data の業務シナリオを固定する。

含める seed:

- Customers: 6 件程度。
- Agents: 4 件程度。
- Tickets: 18-24 件程度。
- Ticket notes: 30-40 件程度。
- Tags: 8 件程度。
- Ticket tags: 30 件程度。

seed には SLA breach、high priority、unassigned、VIP customer、recently updated、
agent overload が分かるデータを入れる。

### `verification.md`

demo 評価用の検証手順。

含める内容:

- baseline:
  - `bun run bootstrap`
  - `bun run verify`
  - `bun run verify:e2e`
- after implementation:
  - `bun run db:migrate`
  - `bun run seed:dev` または demo seed command
  - `bun run verify`
  - `bun run verify:e2e`
- UI 確認:
  - Dashboard metrics。
  - Ticket Inbox filter/sort/search。
  - Ticket Detail status / assignee / tag / note。
  - Customer Profile ticket history。

### `starter/`

`hono-standard` をベースにした実装前 Project Folder。

starter の初期状態:

- `bun run bootstrap` が fresh checkout で通る。
- `bun run verify` が通る。
- `bun run verify:e2e` が通る。
- auth / login / protected route は残す。
- showcase は残してよいが、demo prompt では削除対象にしない。
- README は demo starter 用に最小更新する。

starter は「空に近いが verify 可能な業務アプリ土台」として扱う。
Support Ops CRM 機能は starter には入れない。

### `reference/screenshots/`

初回計画ではフォルダと README だけ置く。
実装成功後に NightWorkers 実行結果からスクリーンショットを追加する。

## Demo App 要件

### 画面

1. Dashboard
   - Open tickets。
   - SLA breach count。
   - Unassigned count。
   - Agent load summary。
   - Priority breakdown。

2. Ticket Inbox
   - ticket list。
   - status filter。
   - priority filter。
   - tag filter。
   - text search。
   - sort by updated time / priority / SLA due。

3. Ticket Detail
   - subject、customer、status、priority、assignee、SLA due。
   - status change。
   - assignee change。
   - tag add/remove。
   - internal note add。
   - note timeline。

4. Customer Profile
   - customer name、company、tier。
   - open ticket count。
   - ticket history。
   - last contact timestamp。

### Data Model

最低限の entity:

- `customers`
- `agents`
- `tickets`
- `ticket_notes`
- `tags`
- `ticket_tags`

推奨 enum / union:

- ticket status: `new`, `triaged`, `in_progress`, `waiting_customer`, `resolved`
- priority: `low`, `normal`, `high`, `urgent`
- customer tier: `standard`, `priority`, `vip`

### API

Hono route は `hono-standard` の既存構成に合わせる。

候補:

- `GET /api/support/dashboard`
- `GET /api/support/tickets`
- `GET /api/support/tickets/:id`
- `PATCH /api/support/tickets/:id`
- `POST /api/support/tickets/:id/notes`
- `GET /api/support/customers/:id`
- `GET /api/support/tags`
- `GET /api/support/agents`

共有 schema は `shared/schemas/` に置く。
route 入力は Zod schema で validate する。

### Frontend

`web/src/` の既存 route/view 構成に合わせる。

候補:

- `/support`
- `/support/tickets`
- `/support/tickets/:ticketId`
- `/support/customers/:customerId`

UI は SaaS operational tool として、密度高め・読み取りやすさ優先にする。
marketing hero は作らない。

## NightWorkers で見せたい Evidence

demo run では次の evidence が出ることを期待する。

- Project Folder が `demo/support-ops-crm/starter` であること。
- Data Model / schema 設計の discussion または artifact。
- DB schema migration。
- seed data 実装。
- API route 追加。
- frontend route / view 追加。
- focused tests。
- `bun run verify`。
- 可能なら `bun run verify:e2e`。
- final report に変更概要、検証結果、残リスクが残ること。

## 実装フェーズ

### Phase 1: demo plan と starter 準備

目的:
NightWorkers に登録できる demo Project Folder を作る。

作業:

- `demo/support-ops-crm/` を作成する。
- `README.md`、`prompt.md`、`expected-outcome.md`、`seed-scenario.md`、`verification.md` を追加する。
- `hono-standard` を `starter/` にコピーする。
- starter の project metadata を demo 用に最小更新する。
- starter が `bun run bootstrap` / `bun run verify` / `bun run verify:e2e` を通ることを確認する。

完了条件:

- starter を NightWorkers の Project Folder として登録できる。
- starter の baseline verification が green。
- Support Ops CRM 機能はまだ未実装。

### Phase 2: prompt 正本のレビュー

目的:
NightWorkers に投げる prompt が、過小でも過大でもないことを確認する。

作業:

- `prompt.md` に実装要求、完了条件、非目標、検証を明記する。
- `seed-scenario.md` と矛盾しないようにする。
- `expected-outcome.md` に成功例を文章で定義する。

完了条件:

- prompt だけを読んで実装範囲が分かる。
- DB / API / UI / test / verification の要求が含まれる。
- 外部連携や本番運用機能に広がらない。

### Phase 3: NightWorkers 実行で demo app を作らせる

目的:
実際に NightWorkers の Workbench / Queue / Run Evidence を使って demo app を実装させる。

作業:

- starter を Project Folder として登録する。
- 最初に read-only investigation を実行する。
- `prompt.md` を Workbench に投入する。
- 必要なら Plan Mode artifact を確認する。
- 実装作業を Implementation Queue に入れる。
- Run Evidence、diff、verification、final report を確認する。

完了条件:

- Support Ops CRM の MVP が starter 上に実装される。
- `bun run verify` が通る。
- `bun run verify:e2e` が通るか、失敗する場合は失敗理由と次対応が final report に残る。
- Run Evidence を demo documentation に転記できる。

### Phase 4: reference outcome 作成

目的:
初見ユーザーが、実行前に成功像を理解できるようにする。

作業:

- 実装後画面の screenshots を `reference/screenshots/` に追加する。
- `expected-outcome.md` を実際の outcome に合わせて更新する。
- README に screenshot と run evidence の読み方を追記する。
- 必要なら GitHub Pages / root README から demo へのリンクを追加する。

完了条件:

- demo を起動しなくても、何ができる demo か分かる。
- demo を起動すると、documented outcome と一致する。
- NightWorkers の採用判断に使える evidence が残る。

## `prompt.md` 草案

```text
Support Ops Mini CRM の MVP を実装してください。

この repository は hono-standard をベースにした starter です。
顧客サポートチームが問い合わせ ticket を triage する業務アプリを追加します。

実装範囲:
- Dashboard: open tickets、SLA breach、unassigned、agent load、priority breakdown
- Ticket Inbox: filter、sort、search、tag 表示
- Ticket Detail: status / assignee / tag / internal note の操作
- Customer Profile: customer info と ticket history
- SQLite / Drizzle schema と migration
- demo seed data
- Hono API route と shared Zod schema
- React route / view
- unit/integration test と必要最小限の E2E

完了条件:
- seeded demo data で各画面が確認できる
- ticket の status / assignee / tag / note を操作できる
- SLA breach と agent load が Dashboard に出る
- `bun run verify` が通る
- 可能なら `bun run verify:e2e` が通る
- final report に変更概要、検証結果、残リスクを書く

非目標:
- 外部 API、メール、Slack、通知 queue、payment、複雑な RBAC は実装しない
- hono-standard の template 基盤を大きく作り替えない
- 認証を削除しない
```

## 検証方針

### Baseline

starter 作成直後:

```bash
bun run bootstrap
bun run verify
bun run verify:e2e
```

期待結果:

- bootstrap が `.env`、dependency、migration を整える。
- verify が typecheck、lint、format、test、coverage、build を通す。
- verify:e2e が login / protected route smoke を通す。

失敗時:

- `hono-standard` コピーまたは starter 最小更新の問題として扱い、Support Ops CRM 実装には進まない。

### After Demo Implementation

```bash
bun run db:migrate
bun run seed:dev
bun run verify
bun run verify:e2e
```

期待結果:

- migration が Support Ops schema を適用する。
- seed が demo data を投入する。
- verify が green。
- verify:e2e が主要 user journey を確認する。

失敗時:

- Run Evidence と final report に、失敗した command、原因、次の修正対象を残す。
- green な narrower gate だけで完了扱いにしない。

## 採用しやすさへの効果

この demo が入ると、初見ユーザーの導線は次のように変わる。

現状:

1. README / LP を読む。
2. 自分で repository を選ぶ。
3. 何を依頼すべきか考える。
4. 結果が良い demo だったのか判断しにくい。

demo 追加後:

1. README / LP を読む。
2. `demo/support-ops-crm/starter` を登録する。
3. `prompt.md` を投げる。
4. documented expected outcome と Run Evidence を比較する。
5. NightWorkers の価値を確認してから、自分の repository に進む。

## 後続タスク

実装計画の次にやるべきこと:

1. Phase 1 の starter 作成。
2. `prompt.md` / `seed-scenario.md` / `verification.md` の初版作成。
3. starter baseline verification。
4. NightWorkers を使った demo 実装 run。
5. reference screenshots と README / GitHub Pages 導線追加。
