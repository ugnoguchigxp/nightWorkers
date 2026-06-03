# Blueprint Work Kind

## Use When

ユーザーが実装前にアプリや画面の Blueprint、試作、プレビュー、完成イメージ、画面構成、情報設計を確認したいときに使う。DB/table/column/relation/binding/DDL の設計は通常 Blueprint では行わず、DB Design workflow に分離する。

## Required Behavior

- まずユーザーの目的、対象ユーザー、主要導線、必要な画面、サンプル表示内容、成功条件を Blueprint として整理する。
- 「試作して」「どんなイメージか見せて」「Blueprint を見たい」「プレビューを作って」「トップページ案を出して」のような依頼は、実装開始ではなく Blueprint 作成/更新の依頼として扱う。
- 通常 Blueprint は screen、section、props に入るサンプル表示、implementation task を一貫した単位として扱う。data model、binding、DDL は DB Design workflow で扱う。
- 既存の Blueprint artifact がある場合は、現在の user request を反映して更新・差分化する前提で考える。
- e-commerce、dashboard、admin、content、workflow などのドメインらしさを、generic overview ではなく実際の画面構成とコンポーネント選定に反映する。
- AppBlueprint JSON を作る場合は、下記の Schema Reference と JSON Contract に従う。schema にない自由なキーを主要構造へ追加せず、必要な補足は description、intent、visualIntent、props、implementationTasks、learningHooks の中に収める。

### Schema Reference

Blueprint JSON を生成・更新する前に、次の Zod schema を根拠として扱う。

- `shared/schemas/app-blueprint.schema.ts`: root AppBlueprint、implementationTasks、learningHooks。
- `shared/schemas/app-blueprint-ui.schema.ts`: screens、sections、actions。
- `shared/schemas/app-blueprint-data.schema.ts`: databaseSchema の空 contract。通常 Blueprint では `tables: []`、`relations: []` のままにする。
- `shared/schemas/app-blueprint-binding.schema.ts`: dataBindings の空 contract。通常 Blueprint では `[]` のままにする。
- `shared/schemas/blueprint-catalog.schema.ts`: 利用可能な page/section componentName と data source kind。
- `shared/schemas/design-governance.schema.ts`: designPreset。

### JSON Contract

AppBlueprint JSON は次の root 形にする。

```json
{
  "id": "shop-top-page",
  "name": "EC Site Top Page",
  "version": 1,
  "description": "Homepage blueprint for curated products and campaigns.",
  "designPreset": {
    "id": "retail-editorial",
    "name": "Retail Editorial",
    "mode": "hybrid",
    "theme": "light-commerce",
    "density": "default",
    "radius": "default",
    "shadow": "subtle",
    "fontScale": "default",
    "contrast": "standard",
    "motion": "standard"
  },
  "screens": [],
  "databaseSchema": {
    "tables": [],
    "relations": []
  },
  "dataBindings": [],
  "implementationTasks": [],
  "learningHooks": []
}
```

- `id`、screen/section/action/binding/task/hook の `id`、table/column/relation 名は `^[a-z][a-z0-9-]*$` に合わせる。日本語、空白、underscore、camelCase は使わない。
- `version` は positive integer。新規 Blueprint は原則 `1`。
- `screens` は最低1件。screen は `id`、`name`、`path`、`componentName`、`sections`、必要なら `actions` を持つ。
- `path` は `/` から始め、英数字、`/`、`_`、`-` だけを使う。例: `/`, `/products`, `/account/orders`。
- `componentName` は `blueprint-catalog.schema.ts` の enum から選ぶ。トップページなら `SidebarPage`、`ListPage`、`ArticleFeedPage`、`DashboardPage` などの汎用 page を、section には `SplitHeroSection`、`CarouselSection`、`CardGridSection`、`DataTableSection`、`CheckoutSummarySection` などを目的に応じて使う。
- section は `id`、`name`、`componentName`、`source`、`intent`、`visualIntent`、`props`、必要なら `actions` を持つ。通常 Blueprint では `dataBindingId` を使わない。
- `source` は `none`、`static`、`computed`、`app`、`summary`、`rss`、`markdown`、`navigation` を優先する。`table`、`record`、`postgres`、`api` は DB Design 後に binding が採用された Blueprint 更新で扱う。
- 通常 Blueprint では `databaseSchema.tables`、`databaseSchema.relations`、`dataBindings` を空にする。DB table/column/relation/binding/DDL の考案は DB Design button からの workflow だけで実行する。
- データ構造が必要そうな場合も、通常 Blueprint では DDL や table/column を書かず、`implementationTasks` に DB Design で検討する作業を残す。
- `implementationTasks[].affectedDomains` は schema の enum から選ぶ。Blueprint JSON の構造や生成なら `blueprint-ui`、`blueprint-data`、`blueprint-binding`、`blueprints`、`blueprint-task-planning` を優先する。
- `props` は component-specific な自由領域だが、画面の意味を埋めるために使い、schema root の代替として使わない。

### Blueprint Quality Bar

- EC サイトなら hero、campaign、category navigation、featured products、trust/support、cart/checkout への導線など、トップページらしい section を入れる。
- Dashboard なら KPI、trend、activity、table/action、alert/notification など、運用画面らしい section を入れる。
- Admin なら filters、bulk action、status、audit/history、detail/edit 導線など、管理作業に必要な section を入れる。
- どのドメインでも、section 名、componentName、props のサンプル表示内容が画面目的に対応していることを確認する。table/column の具体化は DB Design workflow に渡す。

## Stop Conditions

- Blueprint の目的、画面構成、主要コンポーネント、サンプル表示内容、次に実装できるタスクが揃ったら summarize へ進む。
- 必要なドメイン情報が不足していても、停止せず、仮定を明示した初期 Blueprint を作れる粒度まで整理する。

## Report Contract

- Blueprint として扱った理由、想定画面、主要セクション、DB Design に回すべき未確定事項を報告する。
- 実装に進める場合は、Blueprint から派生する implementation task を短く列挙する。

## Tool Guidance

- 既存コード、既存 Blueprint、または schema を確認する必要がある場合は、read_file または search_files で証拠を取得する。
- ユーザーが「見たい」「試作」「イメージ」と言っている場合は、いきなり編集完了扱いにせず、Blueprint artifact またはそのための具体的な設計出力に接続する。
- JSON を出す前に、必要なら `shared/schemas/app-blueprint*.schema.ts` と `shared/schemas/blueprint-catalog.schema.ts` を読む。

## Verification Guidance

- Blueprint が generic dashboard に偏っていないか確認する。
- ユーザーのドメイン語彙が screen/section/props のサンプル表示に反映されているか確認する。
- AppBlueprint JSON が schema の root keys、required fields、enum、ID regex に従っているか確認する。
- 通常 Blueprint で `databaseSchema.tables`、`databaseSchema.relations`、`dataBindings`、`section.dataBindingId` が空のままか確認する。DB Design workflow では相互参照の整合性を別途確認する。
- `componentName` と `source` が catalog schema の enum に存在するか確認する。

## Risk Notes

- 「試作」は実装開始の意味にも取れるが、完成イメージや Blueprint 文脈では、まず設計 artifact を出す方が安全。
- キーワード一致だけで完了扱いにせず、依頼の目的が「実装」か「イメージ確認」かを routing hypothesis で明示する。
- JSON の見た目だけを整えても、schema と binding が崩れていると Preview 生成や実装タスク化で失敗しやすい。
