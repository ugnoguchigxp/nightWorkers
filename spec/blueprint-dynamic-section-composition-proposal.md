# Blueprint Dynamic Section Composition Proposal

## 1. Summary
目的: 現行 Blueprint Preview の固定 Section catalog 依存を緩め、既存 `designSystem` コンポーネントを自由に組み合わせて画面イメージを伝えられる Blueprint contract へ拡張する。

期待結果: ユーザーは「検索バーを半分にして、右側にボタンを追加して」のような自然な修正依頼をできる。システムは Section バリエーションを増やすのではなく、既存 `designSystem` コンポーネントの配置・props・slot 差分として Blueprint を局所更新できる。

重要な前提: 新しいコンポーネントや CSS を作る必要はない。`designSystem` には Tailwind + shadcn/ui design token を採用したコンポーネントがあり、Blueprint Preview はそれらを使って構成を表現する。Section は廃止しない。Section は JSON 記述量を節約するための高レベル preset として残し、必要な時だけ内部 slot / node を上書きできるようにする。

Preview の責務: Blueprint Preview は完全に mock 表示へ振り切る。現行 Preview に含まれる中途半端な data binding 仕組みは削除対象とし、binding を残したまま component composition へ移行しない。Preview は「実データにつながる途中段階」ではなく、ユーザーに画面イメージを伝えるための mock surface として扱う。

## 2. Problem
現行 Blueprint は `section.componentName` を選び、Section ごとの preview renderer が固定 UI を描く構造になっている。

```text
screen
  sections[]
    componentName: MainSearchNavigationSection
    props: ...
```

この構造は初期案を素早く作るには有効だが、Section が「構成可能な画面領域」ではなく「完成済みテンプレート名」になっている。そのため、ユーザーが Section 内の細かな構成変更を求めた場合に対応しづらい。

例:

```text
検索バーを半分にして、右側にボタンを追加してほしい。
```

現行構造では、これを表現するには `MainSearchNavigationSectionWithButton` や `CompactSearchNavigationSection` のような追加 Section を作る発想になりやすい。ユーザーの修正要求は無限にあるため、この方向はすぐに限界に達する。

## 3. Design Goals
- 既存 `designSystem` コンポーネントを Blueprint Preview の構成要素として使う。
- Section は JSON 節約のための preset として維持する。
- preset を選ぶだけで一般的な画面領域を表現できる状態を維持する。
- 必要な場合だけ preset 内部の slot / node を override できる。
- preset で表現できない場合だけ fully custom section として component tree を直接書く。
- CSS や新規 UI component の生成ではなく、既存 component の組み合わせと props / layout の変更で表現する。
- LLM が任意 HTML / className を生成する方向にはしない。
- Blueprint Preview から data binding の仕組みと痕跡を削除する。
- 後続の実装計画で schema、renderer、prompt、migration を分割検討できる粒度にする。

## 4. Non-goals
- `designSystem` の新規コンポーネント追加。
- Blueprint Preview 専用 CSS の増設。
- OpenGenerativeUI のような HTML / CSS / JS sandbox 生成。
- Section preset の完全廃止。
- ユーザーに JSON を直接編集させる UI。
- DB schema / dataBindings を Preview 内で扱う設計。
- Blueprint Preview 内の data binding 維持。
- mock rows と binding rows の併用。
- production screen components の完全生成。

## 5. Current Model
現行の概念はおおよそ次の形。

```ts
type BlueprintSection = {
  id: string;
  name?: string;
  componentName: string;
  source: string;
  props?: Record<string, unknown>;
  actions?: unknown[];
};
```

この model では `componentName` が Section の構造と表示責務をまとめて背負っている。`props` は Section 専用で、Section 内部の特定部品を安定して指す仕組みがない。

問題は `props` の柔軟性ではなく、内部構造に addressable な node / slot がないこと。

加えて、現行 Preview には `dataBindings` や table context を参照してサンプル表示を補う仕組みが混ざっている。これは DB Design や実装時の data contract と責務が近く、mock Preview としては中途半端になる。改善後は、Preview 表示に binding を使わない。必要な表示データは preset props / node props / mock data として持つ。

## 6. Proposed Model
Section を 3 段階で表現する。

```text
1. Preset Section
   よくある構成を短い JSON で表現する。

2. Preset Section + Overrides
   preset の内部 slot / node に対して局所差分を入れる。

3. Custom Section
   preset で表現できない場合だけ component tree を直接書く。
```

### 6.1 Preset Section
通常は短く書ける。

```ts
{
  kind: "preset_section",
  id: "customers-search",
  preset: "search_header",
  props: {
    title: "Customers",
    placeholder: "Search customers..."
  }
}
```

この段階では中身を詳しく知らなくてもよい。`search_header` preset が、内部的に `Input`、`Button`、`Filter` などをどう組むかを持つ。

### 6.2 Preset Section + Overrides
ユーザーが局所修正を求めた場合だけ差分を持つ。

```ts
{
  kind: "preset_section",
  id: "customers-search",
  preset: "search_header",
  props: {
    title: "Customers",
    placeholder: "Search customers..."
  },
  overrides: [
    {
      target: "searchInput",
      set: {
        layout: { width: "1/2" }
      }
    },
    {
      target: "actions",
      insert: {
        id: "add-customer",
        component: "Button",
        props: {
          label: "Add customer",
          variant: "default"
        }
      }
    }
  ]
}
```

ここで重要なのは、preset が内部 node / slot に安定した target name を持つこと。

```text
search_header preset
  title
  searchInput
  filters
  actions
```

LLM は Section 全体を書き直さず、`searchInput` の layout を変え、`actions` slot に `Button` を追加するだけでよい。JSON 量は小さいまま、ユーザーの具体的な調整に対応できる。

### 6.3 Custom Section
preset では表現しにくい場合だけ component tree を直接持つ。

```ts
{
  kind: "custom_section",
  id: "operations-overview",
  title: "Operations Overview",
  root: {
    kind: "layout",
    layout: "grid",
    props: { columns: 12, gap: "md" },
    children: [
      {
        kind: "component",
        id: "open-incidents",
        component: "Card",
        props: {
          title: "Open incidents",
          description: "Needs attention"
        },
        layout: { colSpan: 4 }
      },
      {
        kind: "component",
        id: "incident-table",
        component: "DataTable",
        props: {
          title: "Latest incidents"
        },
        layout: { colSpan: 8 }
      }
    ]
  }
}
```

Custom Section は逃げ道であり、通常の第一候補ではない。JSON 節約と LLM 安定性のため、まず preset を選び、必要時だけ overrides を使う。

### 6.4 Mock Data Only
Preview に必要なデータは、binding ではなく mock として明示する。

```ts
{
  kind: "component",
  id: "customer-table",
  component: "DataTable",
  props: {
    columns: [
      { key: "name", label: "Name" },
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" }
    ],
    rows: [
      { name: "Acme Inc.", status: "Active", owner: "Yuki" },
      { name: "Northwind", status: "Review", owner: "Aiko" }
    ]
  }
}
```

`DataTable` や `List` のようなデータ表示 component は使ってよい。ただし Preview では `table`、`dataBindingId`、`binding.fields` のような実データ接続を参照しない。表示に必要な列、行、ラベル、状態は mock props として持つ。

## 7. Component Catalog
Blueprint Preview が参照する component は、`designSystem` の実コンポーネントを registry 化して扱う。

```ts
type BlueprintComponentDefinition = {
  name: string;
  category: "layout" | "display" | "input" | "action" | "navigation" | "feedback";
  description: string;
  propsSchema: unknown;
  allowedChildren?: string[];
  defaultProps?: Record<string, unknown>;
  previewHints?: {
    minWidth?: string;
    preferredSlot?: string;
  };
};
```

`propsSchema` には Preview 用 mock props を定義する。実データ binding 用 props は含めない。たとえば `DataTable` は `columns` と `rows` を持てるが、`bindingId` や `sourceTable` を持たない。

候補例:

```text
Button
IconButton
Input
InputGroup
Select
Checkbox
Switch
Card
Badge
Avatar
DataTable
Table
List
Tabs
Accordion
Alert
Progress
Tooltip
Dialog
Sidebar
Breadcrumb
Pagination
Separator
```

この catalog は「自由に低レベル部品を無制限投入する」ためではなく、Blueprint が安全に参照できる部品と props を定義するためのもの。

## 8. Preset Catalog
Section preset は、component tree の短縮表現として定義する。

```ts
type BlueprintSectionPreset = {
  name: string;
  description: string;
  slots: Array<{
    name: string;
    accepts: string[];
    cardinality: "one" | "many" | "optional";
  }>;
  defaults: BlueprintNode;
  propsSchema: unknown;
};
```

例:

```text
search_header
  slots:
    title: one Text-like
    searchInput: one Input-like
    filters: many input/navigation
    actions: many action

table_workspace
  slots:
    toolbar: optional layout
    filters: many input
    table: one DataTable
    emptyState: optional feedback

metrics_overview
  slots:
    metrics: many Card/Badge/Progress
    insight: optional Alert/Card
```

現行の Section は、可能な範囲でこの preset catalog に移す。`ChartSection` や `KanbanSection` のようなものは完全廃止ではなく、`chart_insight` preset、`kanban_board` preset のように扱う。

## 9. Rendering Model
Preview renderer は次の順で解決する。

```text
BlueprintSection
  if kind = preset_section
    preset defaults を展開
    props を適用
    overrides を適用
    BlueprintNode tree を描画

  if kind = custom_section
    root BlueprintNode tree を描画
```

Rendering input は Blueprint の mock props のみとする。Preview renderer は `dataBindings`、`databaseSchema.tables`、`bindingForSection`、`tableForSection` のような外部文脈を受け取らない。mock に必要な値は section / node の props に正規化してから renderer に渡す。

Node renderer は component registry を使う。

```text
BlueprintNode
  kind = layout
    -> Stack / Row / Grid / Split / Tabs wrapper

  kind = component
    -> designSystem component registry から実 component を解決
```

CSS class の自由入力は基本的に許可しない。layout / spacing / width / align は token enum として表現する。

```ts
type LayoutProps = {
  width?: "auto" | "full" | "1/2" | "1/3" | "2/3";
  colSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  align?: "start" | "center" | "end" | "stretch";
  gap?: "none" | "xs" | "sm" | "md" | "lg";
};
```

## 10. Editing Model
ユーザー修正は、Section 全体の再生成ではなく patch として扱う。

```text
User: 検索バーを半分にして、右にボタンを追加して

Patch:
  target section: customers-search
  override searchInput.layout.width = 1/2
  insert Button into actions
```

期待する patch contract:

```ts
type BlueprintSectionPatch =
  | {
      op: "set";
      target: string;
      path: string;
      value: unknown;
    }
  | {
      op: "insert";
      target: string;
      position?: "start" | "end" | "before" | "after";
      node: BlueprintNode;
    }
  | {
      op: "remove";
      target: string;
    }
  | {
      op: "replace";
      target: string;
      node: BlueprintNode;
    };
```

LLM に求めるのは「画面全体を再生成すること」ではなく「既存 Blueprint に対する局所 patch を作ること」。これにより、ユーザーの細かい修正要求に追従しやすくなる。

## 11. User-facing Behavior
ユーザーは Section や component の内部 JSON を意識しない。

### Initial generation
ユーザーの要望から、まず preset section を中心に短い Blueprint を作る。

```text
顧客一覧画面を作って
  -> search_header preset
  -> table_workspace preset
  -> metrics_overview preset
```

### Refinement
ユーザーの調整依頼は patch / overrides に変換する。

```text
検索バーを半分にして、右に新規顧客ボタンを追加
  -> searchInput width override
  -> actions slot insert Button
```

### Escape hatch
preset で表現できない複雑な UI だけ custom section にする。

```text
左にタブ、中央にタイムライン、右に詳細パネルを同時に出したい
  -> custom_section
```

## 12. Relationship To CopilotKit / A2UI
参考になるのは CopilotKit の通常 tool rendering ではなく、A2UI 的な「component catalog + declarative tree + renderer」の考え方。

ただし NightWorkers では runtime event として UI を描くのではなく、`appBlueprint` の中に保存される design artifact として扱う。

```text
A2UI:
  runtime activity message
  operations
  renderer

NightWorkers target:
  persisted appBlueprint
  preset / node tree / overrides
  Blueprint Preview renderer
```

OpenGenerativeUI 的な HTML / CSS / JS sandbox は採用しない。既存 `designSystem` を使うので、必要なのはコード生成ではなく、構造化された composition contract。

## 13. Migration Direction
実装計画ではなく、移行方針として次を想定する。

### Phase 0: Remove Preview Data Binding
dynamic section composition へ入る前に、Blueprint Preview から data binding を削除する。

削除対象:

```text
Preview renderer への bindings 引数
Preview renderer への tables 引数
section.dataBindingId を使った表示補完
binding.mode / binding.fields を使った columns 補完
databaseSchema.tables を使った preview rows / columns 補完
bindingForSection / tableForSection の Preview 依存
```

残すもの:

```text
mock columns
mock rows
mock cards
mock metrics
mock timeline entries
mock action labels
```

方針: data binding は「後でまた使うかもしれない」痕跡として残さない。Preview は完全 mock surface として扱い、DB Design や implementation data contract は別 workflow に分離する。

### Phase A: Compatibility
現行 `componentName` section を維持しつつ、新しい `kind` を追加する。

```ts
type AppBlueprintSection =
  | LegacyBlueprintSection
  | PresetBlueprintSection
  | CustomBlueprintSection;
```

既存 Blueprint の legacy Section 形状は壊さない。ただし Preview の data binding 互換は維持しない。legacy Section も表示時には props 内の mock data だけを使う。

### Phase B: Preset Adapter
現行 Section を preset に変換できる adapter を用意する。

```text
MainSearchNavigationSection -> preset_section(search_header)
DataTableSection -> preset_section(table_workspace)
StatsTrendCardsSection -> preset_section(metrics_overview)
```

### Phase C: Dynamic Preview Renderer
`BlueprintNode` tree を `designSystem` registry から描く renderer を追加する。

### Phase D: Patch-based Refinement
ユーザーの修正要求を `overrides` / patch に変換する LLM output contract を追加する。

## 14. Risks
### Risk: JSON が肥大化する
対策: preset section を第一候補にし、custom section は例外にする。preset props と overrides で表現できる限り node tree を直接書かない。

### Risk: LLM が低レベル部品を雑に並べる
対策: component catalog、slot accepts、layout token enum、props schema で制約する。任意 HTML / arbitrary className を許さない。

### Risk: preset 内部 target が不安定になる
対策: preset 定義に stable slot / node id を必須にする。ユーザー修正はこの target に対する patch として扱う。

### Risk: Preview と実装の乖離が増える
対策: Preview は `designSystem` component registry を使う。見た目用に別 CSS / 別 component を増やさない。

### Risk: mock 化で data contract が見えなくなる
対策: それは意図した分離とする。Blueprint Preview は画面イメージの mock に専念し、DB Design / data contract は別 artifact で扱う。Preview 内に binding の痕跡を残して中間形にしない。

### Risk: 既存 Blueprint flow が壊れる
対策: legacy section を union として維持し、adapter / renderer を段階導入する。

## 15. Open Questions
- `designSystem` component catalog は手書き manifest にするか、Storybook / package export から生成するか。
- `propsSchema` は Zod で定義するか、既存 TypeScript props から生成するか。
- `overrides.target` は slot name だけにするか、node id と slot name の両方を許すか。
- patch を task message として履歴化するか、Blueprint artifact の新 revision として保存するか。
- custom section をどこまで許すか。layout nesting depth や children count の上限を設けるか。
- 現行 `designPreset` / preview design settings と dynamic node layout token をどう接続するか。
- data binding 削除後、既存 Blueprint で表示に必要な mock props が不足する場合に、LLM 再生成で補うか、deterministic fallback mock を renderer 側で作るか。

## 16. Decision Recommendation
推奨方針:

```text
Section preset を維持する。
Section を構造の最小単位にしない。
Preset の内部を stable slot / node として addressable にする。
必要時だけ overrides で差分編集する。
さらに必要な場合だけ custom section の component tree を許す。
Component は既存 designSystem registry から解決する。
Preview は完全 mock 表示に振り切り、data binding 仕組みは削除する。
任意 HTML / CSS / JS 生成は採用しない。
```

この方針なら、JSON 記述量を節約しつつ、固定 Section catalog の限界を超えられる。ユーザーにとっては「よくある画面はすぐ出る」「細かい指示にも追従できる」という結果になり、実装側は既存 `designSystem` 資産をそのまま使える。
