# Blueprint Work Kind

## Use When

ユーザーが実装前にアプリや画面の Blueprint、試作、プレビュー、完成イメージ、画面構成、情報設計を確認したいときに使う。DB/table/column/relation/binding/DDL の設計は通常 Blueprint では行わず、DB Design workflow に分離する。

## Required Behavior

- まずユーザーの目的、対象ユーザー、主要導線、必要な画面、サンプル表示内容、成功条件を Blueprint として整理する。
- 「試作して」「どんなイメージか見せて」「Blueprint を見たい」「プレビューを作って」「トップページ案を出して」のような依頼は、実装開始ではなく Blueprint 作成/更新の依頼として扱う。
- 通常 Blueprint は screen、section、props に入るサンプル表示、implementation task を一貫した単位として扱う。data model、binding、DDL は DB Design workflow で扱う。
- 既存の Blueprint artifact がある場合は、現在の user request を反映して更新・差分化する前提で考える。
- e-commerce、dashboard、admin、content、workflow などのドメインらしさを、generic overview ではなく実際の画面構成とコンポーネント選定に反映する。
- section は必要なものだけを選ぶ。見栄えのために hero、画像、KPI、chart、activity、marketing section を自動追加しない。
- workflow / CRUD / kanban / admin などの作業画面では、見た目の優先度だけでなく、実際の操作順序、使用感、作業前に必要な入力、画面上の視線移動を考えて section と props を決める。
- 一覧系 section は、見た目の好みで cards に寄せず、主操作に合わせて公平に選ぶ。複数件の比較、状態確認、一括操作、ソート、絞り込み、更新対象の見極めが主目的なら `table_workspace` または `DataTableSection` を第一候補にする。
- `CardGridSection` は、アイテムごとの要約、視覚的な分類、候補ブラウズ、テンプレート選択、リッチなカード単位アクションが主目的のときに使う。単なる task / todo / record 一覧を自動で card 化しない。
- TODO / task / issue / order / customer などの CRUD・運用一覧で、ユーザーが「一覧」「管理」「最小構成」「登録と一覧だけ」を求める場合は、検索 header と table workspace、または compact form と table workspace を基本形として考える。board/card/gallery を明示された場合だけ card や kanban を主役にする。
- Kanban なら KanbanSection を主役にし、検索・フィルタ・表示切替は KanbanSection.props.filters / views / segments としてボード上部の toolbar に出す。ボードを操作する前に使う controls をボード下に置かない。
- KanbanSection の props は Backlog / In Progress / Done 相当の3列 `columns: [{id,title,cards:[{id,title,description,assignee,priority,dueDate}]}]` を基本形にする。各 column には、画面イメージを確認できる sample card を最低1件入れる。`boardLabel`、`boardDescription`、`filters` を必要に応じて入れる。ボード、列、カード、検索、フィルタの確認が目的なら DataTableSection を使わない。
- Kanban では FormSection、DataTableSection を自動追加しない。ユーザーが明示的に「編集フォーム」「表形式一覧」を求めた場合だけ使う。
- SplitHeroSection / FullBleedHeroSection / ImageSection / CarouselSection は landing、marketing、media-heavy な画面、またはユーザーが明示的に hero / visual / campaign を求めた場合だけ使う。
- ChartSection / AnalyticsDashboardSection は、ユーザーが metrics / KPI / analytics / dashboard / trend / chart を明示した場合だけ使う。
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
  "screens": [
    {
      "id": "home",
      "name": "Home",
      "path": "/",
      "componentName": "DashboardPage",
      "sections": [
        {
          "kind": "component_section",
          "id": "featured-products",
          "name": "Featured Products",
          "componentName": "CardGridSection",
          "source": "static",
          "props": {
            "title": "Featured Products",
            "description": "Curated products shown before DB Design is defined.",
            "items": [
              {
                "title": "Starter Kit",
                "description": "Representative product card.",
                "badge": "New"
              }
            ]
          },
          "actions": []
        }
      ],
      "actions": []
    }
  ],
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
- `componentName` は `blueprint-catalog.schema.ts` の enum から選ぶ。トップページなら `SidebarPage`、`ListPage`、`ArticleFeedPage`、`DashboardPage` などの汎用 page を使う。
- catalog にある単体 section を使う場合は、必ず `kind: "component_section"` と `componentName` を指定する。ただし検索 header、table workspace、metrics overview、kanban board のように内部構成を調整したい領域は `kind: "preset_section"` を優先する。
- `preset_section` は `id`、必要なら `name`、`preset`、`props`、`overrides`、`actions` を持つ。`preset` は `search_header`、`table_workspace`、`metrics_overview`、`kanban_board` から選ぶ。
- `custom_section` は preset で表現できない時だけ使い、`root` の BlueprintNode tree は `Text`、`Button`、`Input`、`Card`、`DataTable`、`List`、`Alert` など既知 component と `stack` / `row` / `grid` / `split` layout token だけで構成する。任意 HTML、className、CSS は作らない。
- `component_section` は `kind: "component_section"`、`id`、`name`、`componentName`、`source`、`props`、必要なら `intent`、`visualIntent`、`actions` を持つ。通常 Blueprint では `dataBindingId` を使わない。
- `source` は選んだ `componentName` の catalog allowedSources から選ぶ。通常 Blueprint の `table`、`record`、`api`、`postgres` は接続先の想定カテゴリであり、実 table/column/binding の定義ではない。
- 通常 Blueprint では `databaseSchema.tables`、`databaseSchema.relations`、`dataBindings` を空にする。DB table/column/relation/binding/DDL の考案は DB Design workflow だけで実行する。
- データ構造が必要そうな場合も、通常 Blueprint では DDL や table/column を書かず、`implementationTasks` に DB Design で検討する作業を残す。
- `implementationTasks[].affectedDomains` は schema の enum から選ぶ。Blueprint JSON の構造や生成なら `blueprint-ui`、`blueprint-data`、`blueprint-binding`、`blueprints`、`blueprint-task-planning` を優先する。
- `props` は component-specific な自由領域だが、画面の意味を埋めるために使い、schema root の代替として使わない。
- ユーザーが「検索バーを半分にして右にボタン」など局所修正を求めた場合は、画面全体を書き直さず `BlueprintSectionPatch` 相当の `target` / `op` / `path` / `node` を考え、artifact には `overrides` または更新後の section として反映する。

### Blueprint Quality Bar

- EC サイトなら hero、campaign、category navigation、featured products、trust/support、cart/checkout への導線など、トップページらしい section を入れる。
- Dashboard なら、ユーザーが metrics や monitoring を求めた場合だけ KPI、trend、activity、alert/notification を入れる。通常の作業画面を dashboard っぽく盛らない。
- Admin なら filters、bulk action、status、audit/history、detail/edit 導線など、管理作業に直接必要な section だけを入れる。
- Kanban なら KanbanSection を中心にし、検索・フィルタ・表示切替は KanbanSection.props.filters / views / segments に入れる。FormSection、DataTableSection に逃がさない。SplitHeroSection、FullBleedHeroSection、画像、棒グラフ、analytics dashboard は通常不要。
- CRUD / task management / admin list では、主役が record collection なのに card grid を先に置いていないか確認する。比較や更新のしやすさが主目的なら table 系を優先する。
- 「最小構成」「シンプル」「基本操作」「画面だけ」の場合、screen あたり 1-3 section を基本にし、中心操作に直結しない section は削る。
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
- ユーザーが求めていない hero、画像、KPI、chart、activity が混ざっていないか確認する。
- Kanban / CRUD / form / list などの作業画面で、主役 section が最初に来ているか確認する。
- ユーザーのドメイン語彙が screen/section/props のサンプル表示に反映されているか確認する。
- AppBlueprint JSON が schema の root keys、required fields、enum、ID regex に従っているか確認する。
- 通常 Blueprint で `databaseSchema.tables`、`databaseSchema.relations`、`dataBindings`、`section.dataBindingId` が空のままか確認する。DB Design workflow では相互参照の整合性を別途確認する。
- `componentName` と `source` が catalog schema の enum に存在するか確認する。

## Risk Notes

- 「試作」は実装開始の意味にも取れるが、完成イメージや Blueprint 文脈では、まず設計 artifact を出す方が安全。
- キーワード一致だけで完了扱いにせず、依頼の目的が「実装」か「イメージ確認」かを routing hypothesis で明示する。
- JSON の見た目だけを整えても、schema と binding が崩れていると Preview 生成や実装タスク化で失敗しやすい。
