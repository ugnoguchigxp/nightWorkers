# Unified Overview Dashboard / Overview Domain Refactor 実装記録

## Status

- Plan status: `completed`
- Implementation status: `completed`
- Archive status: `archived`
- Completed: 2026-07-10
- Canonical plan: this document
- Baseline reviewed: 2026-07-10, `main` at `d4352ae9e80e283aa91cccb9d44f775a1be8162a`
- Target surfaces: NightWorkers Overview、Project Detail の「概要」導線
- Target functional domain: `src/modules/overview`、`api/modules/overview`

### Completion evidence

- focused suite: 16 files / 105 tests passed。
- formatter、view model、coverage fallback、module boundary、API、route、Project Detail regression、ontology を確認済み。
- `bun run typecheck`: passed。
- `bun run build:frontend`: passed。
- `bun run verify:base`: tracked artifact、typecheck、lint、Supervisor regression の全 phase passed。
- 実ブラウザで all/project Select、7日 range 維持、URL 復元、legacy URL canonicalization、compact/exact 表示、Project latest snapshot、console error なしを確認済み。

### Post-implementation review

- `OverviewScreen.tsx` を 1122 行から 216 行へ分割し、取得 hook、header、context/snapshot、KPI、usage/cost、table、primitives、styles に責務分離した。
- `overview.service.ts` を 617 行から 346 行へ分割し、usage aggregation、recent-call pricing、repository query を独立させた。
- Overview domain の全 TypeScript file が 600 行以下であることを module boundary test で継続検証する。
- credits 建て価格を設定通貨へ誤加算・誤表示しないよう、currency cost と credits を API/UI の双方で分離した。
- scope/range 切替時の stale response、Project list 読込前の Select 表示、欠損 bucket、期間境界日、全期間の月欠損と月末日を修正した。
- runtime response schema parse、通貨 enum、空 table、loading/error、warning key、exact tooltip を強化した。

この文書を、NightWorkers 全体 Overview と Project 概要を単一の Overview Dashboard へ統合する実装正本とする。

実装中に scope、期間、指標定義、通貨、数値省略、Project 固有セクション、URL 正規化の判断が曖昧になった場合は、この文書を優先する。実装と本文の契約が変わる場合は、先に本文を更新してからコードを変更する。

実装・受け入れ・再レビュー・検証が完了したため、この文書は `spec/archive/` に保管する。

## 目的

NightWorkers 全体と特定 Project の概要を、上部 Select で対象だけ切り替えられる単一の Overview Dashboard として提供する。

利用者は、少なくとも次を同じレイアウトと同じ指標定義で確認できる。

1. NightWorkers 全体または選択 Project の対象 scope。
2. 24時間、7日、30日、全期間の共通期間。
3. LLM 呼び出し、トークン、出力速度、推定コスト。
4. 日別使用量、モデル構成、直近の高コスト呼び出し。
5. Project 選択時の Git、規模、技術スタック、評価、カバレッジ。
6. `K`, `M`, `G`, `T`, `P` を使った読みやすい数値。
7. 省略表示から失われた正確な値を tooltip または accessible name で確認できること。

この変更の中心は「見た目を似せること」ではなく、同じコンポーネント、同じ集計契約、同じ表示規則から両 scope を表現し、その実装を `overview` 機能ドメインへ集中させることである。

## 成功条件

次をすべて満たしたときだけ実装完了とする。

1. `/overview` と `/overview?projectId=<id>` が同じ `OverviewDashboard` component tree を描画する。
2. 上部 Select の「すべてのプロジェクト」で NightWorkers 全体、「特定 Project」で Project 概要へ切り替わる。
3. scope 変更後も選択中の期間を維持する。
4. URL が scope と期間を復元でき、再読込と戻る・進む操作で表示が一致する。
5. Project サイドバーの概要導線と Project タブの「概要」が共通 Overview URL へ到達する。
6. 旧 `/projects/:id/detail/overview` は共通 Overview URL へ canonicalize される。
7. Project の概要以外のタブは現在の URL と責務を維持する。
8. LLM 使用量とコストは全体・Project の双方で `buildOverviewDashboard()` を唯一の正本として集計する。
9. 同名指標の期間、分子、分母、通貨、空状態が scope によって変わらない。
10. `総入力` は provider 報告の input total、`入力` は `max(inputTokens - cachedInputTokens, 0)` として表示される。
11. Project のコストだけ `$` 固定にならず、General Settings の通貨と同じ規則で表示される。
12. Project 固有の評価とカバレッジは期間集計と混同せず、「最新スナップショット」として表示される。
13. 1,000 以上の大きい表示値は共通 formatter で `K/M/G/T/P` 表現になる。
14. compact number は小数最大2桁で、不要な末尾ゼロを表示しない。
15. 正確な元値が tooltip または accessible name から確認できる。
16. Project 固有セクションを追加するために全体用／Project用の別 dashboard component を作らない。
17. `ProjectDetailOverview.tsx` と Project 側の重複した LLM 使用量／コスト表示経路が削除される。
18. backend、schema、routing、component、formatting の focused tests が成功する。
19. typecheck と repo-native verify gate が成功する。
20. frontend の Overview 実装本体が `src/modules/overview` に集約される。
21. backend の Overview route、service、repository が `api/modules/overview` に集約される。
22. `src/modules/nightworkers` と `api/modules/nightworkers` には Overview の実装本体を残さず、shell/router の利用境界だけを残す。
23. `api/services/overview` と `shared/schemas/nightworkers/overview.schema.ts` の旧配置が解消される。
24. `src/modules/overview/index.ts` が frontend の唯一の公開 import boundary になる。
25. Overview module ownership が agent ontology に登録され、境界テストで再分散を検出できる。

## Locked Decisions

以下は初期実装で再オープンしない。

1. Top-level dashboard component は `OverviewDashboard` 1つだけとする。
2. `scope` は `all` または `project` の discriminated union とする。
3. canonical URL は `/overview` とし、Project 選択は `projectId` query で表す。
4. `range` query は現在の `24h | 7d | 30d | all` を維持する。
5. Select は filter ではなく dashboard scope selector として扱う。
6. Project 固有表示は別画面ではなく、共通 dashboard の nullable data section として表現する。
7. Project 選択時だけ Project navigation と Project context を表示する。
8. LLM 使用量、モデル構成、コスト、日別 bucket、直近呼び出しは `api/modules/overview/overview.service.ts` を集計正本にする。
9. Project 固有の Git、規模、stack、評価、coverage は usage/cost と混ぜず `projectContext` に分離する。
10. Project 固有 context の取得は polling ごとに実ファイル全走査を発生させない。保存済みまたは cache 済み snapshot を優先する。
11. Project Detail の非概要タブは今回統合しない。
12. `ProjectDetailScreen` の `activeTab === "overview"` render branch は残さない。
13. 旧 Project Overview URL は同じ component を別経路で描画せず canonical Overview URL へ移す。
14. startup preflight warning は NightWorkers 環境に属するため両 scope で表示可能とし、Project 指標と誤認しない見出しを付ける。
15. 評価と coverage は期間 button の影響を受けない最新 snapshot とし、取得日時を併記する。
16. 初期実装では Project 同士の比較、ランキング、benchmark は追加しない。
17. 初期実装では `平均トークン / 実行` と `平均コスト / 実行` を共通 KPI にしない。usage record の期間と run の分母を同一集合として帰属できない値は表示しない。
18. 実行数と LLM 呼び出し数は別指標として扱う。
19. compact suffix は locale に依存する `万/億` ではなく、常に `K/M/G/T/P` を使用する。
20. compact 表示は整数へ固定せず、小数最大2桁を許可する。
21. 省略表示は UI 表現だけに適用し、API response、DB、計算精度を丸めない。
22. currency と percent は専用 formatter を使い、token formatter を文字列連結して作らない。
23. 既存の関連しない dirty-tree 変更には触れない。
24. frontend 実装は `src/modules/overview`、backend 実装は `api/modules/overview` を canonical owner とする。
25. NightWorkers shell は `@/modules/overview` の public export だけを import し、Overview 内部ファイルを直接参照しない。
26. API app は `overviewRouter` を独立 router として登録し、`nightworkersRouter` へ Overview route を残さない。
27. `buildOverviewDashboard()` は `api/modules/overview/overview.service.ts` へ移し、`api/services/overview/index.ts` は削除する。
28. Overview API query/response schema は `shared/schemas/overview.schema.ts` を canonical owner とする。
29. frontend の API command は `src/modules/overview/overviewCommands.ts` へ移し、`nightWorkersCommands.ts` から `fetchOverview()` を削除する。
30. compact formatter は Overview 固有要件として `src/modules/overview/overviewFormat.ts` が所有する。別ドメインで再利用が必要になるまで global formatter へ昇格させない。
31. `src/i18n/format.ts` は locale-aware exact currency/date formatting の共有依存として維持する。
32. module 間連携は public `index.ts` または明示した backend port/service を通し、相互の内部ファイルを横断 import しない。

## 現在の実装状態

### NightWorkers Overview

正本:

- `src/modules/nightworkers/components/OverviewScreen.tsx`
- `src/modules/nightworkers/types/overview.ts`
- `shared/schemas/nightworkers/overview.schema.ts`
- `api/services/overview/index.ts`
- `api/modules/nightworkers/nightworkers.basic.service.ts`
- `api/modules/nightworkers/routes/run-routes.ts`

現在の Overview はすでに次を持つ。

- Project Select。
- 24時間、7日、30日、全期間。
- `/api/overview?range=...&repositoryId=...` による Project filter。
- LLM call、input、cached input、output、output speed、estimated cost。
- 日別使用量、コスト内訳、モデル構成、直近の高コスト呼び出し。
- 15秒 polling と手動更新。

不足:

- Select で Project を選んでも Project 固有の概要にはならず、LLM dashboard が filter されるだけである。
- Project 固有の Git、規模、stack、評価、coverage を同じ dashboard で表示できない。
- `formatTokenCount()` が桁区切りのみで、大きい値が card と table を圧迫する。
- 全体と Project の概要導線が別 route、別 component、別集計である。

### Project Detail Overview

正本:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx`
- `src/modules/nightworkers/components/project-detail/ProjectDetailCommon.tsx`
- `api/modules/project-detail/project-detail.service.ts`
- `shared/schemas/project-detail.schema.ts`

現在の Project Overview は次を表示する。

- ProjectMeta、stack summary。
- 総入力、非 cached 入力、output、cached input、reasoning output、state card、prompt parts。
- 実行数、cost、平均 token / run、output speed、平均 cost / run。
- model mix、top token tasks、latest evaluation、coverage axes。

不足:

- Overview と別 component tree である。
- Project metrics service が LLM usage と cost を再集計している。
- Project 側の usage は期間 filter を持たず、全体 Overview と比較条件が揃わない。
- cost 表示が `$` 固定で General Settings の通貨と一致しない。
- cost が存在しても補助文言が「未接続」になる。
- average per run の分母と usage 集計期間が UI 上で説明されない。
- Project 固有の最新 snapshot と期間集計 KPI が同列に並び、時間軸が読み取りにくい。

### Routing

正本:

- `src/routes/overview.tsx`
- `src/modules/nightworkers/routing/workbench-route-state.ts`
- `src/modules/nightworkers/routing/WorkbenchRoutePage.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/components/ProjectSidebar.tsx`

`WorkbenchRouteState` はすでに `overview` に `range` と `projectId` を持つ。この既存 state を canonical scope state として利用する。

### Number formatting

正本:

- `src/i18n/format.ts`
- `src/modules/nightworkers/components/project-detail/ProjectDetailCommon.tsx`

現在は桁区切りを行う `formatTokenCount()` と、Project Overview 内の限定的な `formatCompactTokens()` が分かれている。統合後は dashboard 向け formatter を1つの共有 seam に集約する。

### 機能ドメインの分散

現在の Overview ownership は次のように分散している。

```text
frontend screen       src/modules/nightworkers/components/OverviewScreen.tsx
frontend command      src/modules/nightworkers/nightWorkersCommands.ts
frontend response     src/modules/nightworkers/types/overview.ts
API route             api/modules/nightworkers/routes/run-routes.ts
API handler           api/modules/nightworkers/nightworkers.routes.ts
API facade            api/modules/nightworkers/nightworkers.basic.service.ts
aggregation           api/services/overview/index.ts
shared schema         shared/schemas/nightworkers/overview.schema.ts
```

この配置では Overview の変更に NightWorkers general module、service layer、shared schema の複数所有境界をまたぐ必要がある。今回の UI 統合と同時に canonical owner を `overview` 機能ドメインへ移す。

## Overview Functional Domain Boundary

### Canonical directories

```text
src/modules/overview/
  index.ts
  OverviewScreen.tsx
  overviewCommands.ts
  overviewTypes.ts
  overviewViewModel.ts
  overviewFormat.ts
  components/
  hooks/

api/modules/overview/
  overview.routes.ts
  overview.service.ts
  overview.repository.ts
  overview-project-context.service.ts
  overview-coverage.ts

shared/schemas/
  overview.schema.ts
```

`modules/overview` は frontend と backend で同じ機能名を使い、実装探索時に ownership が一意になる構成とする。

### Frontend ownership

`src/modules/overview` が所有する。

- Overview screen controller。
- all/project 共通 dashboard component tree。
- scope Select、range control、Project navigation integration。
- Overview API command。
- API response からの view model 生成。
- Overview 固有 compact number/currency/percent 表示。
- Overview 固有 loading/error/empty state。
- Overview module public exports。

`src/modules/nightworkers` に残すもの:

- `NightWorkersShell` から `OverviewScreen` を配置する integration。
- `WorkbenchRouteState` から scope/range props を渡す routing adapter。
- Project/session navigation callback。

`src/modules/nightworkers` に残してはならないもの:

- Overview JSX section。
- Overview API response type。
- `fetchOverview()`。
- compact number formatter。
- Overview KPI mapping。
- all/project scope 判定ロジック。

### Backend ownership

`api/modules/overview` が所有する。

- `GET /overview` OpenAPI route definition と handler。
- Overview query validation。
- usage/cost/run aggregation orchestration。
- Overview 専用 DB query。
- Project context projection。
- coverage axes projection。
- Overview response schema validation boundary。

`api/modules/nightworkers` に残すもの:

- task/run/session 等の NightWorkers general routes。
- Overview と無関係な repository lifecycle。

`api/modules/nightworkers` と `api/services` に残してはならないもの:

- `getOverviewDashboardRoute`。
- `getOverviewDashboard()` facade。
- `buildOverviewDashboard()` implementation。
- Overview 専用 response type。

### Allowed dependencies

frontend Overview module から許可する依存:

- `src/components/ui`。
- `src/i18n` の language、date、exact locale helper。
- shared schema/type。
- workbench route serializer の public API。
- Project Detail tab への navigation contract。

backend Overview module から許可する依存:

- `api/db` schema/client。
- pricing、General Settings、FX の共有 service。
- repository lookup。
- ProjectMeta、stack、latest evaluation、quality の read-only projection port。

禁止する依存:

- Overview module から `NightWorkersShell` への import。
- NightWorkers module から Overview internal file への deep import。
- Project Detail module から Overview internal formatter/view model への deep import。
- `api/modules/overview` と `api/modules/nightworkers` の相互 facade 呼び出し。
- Overview service から Project Detail screen-oriented response を呼び出すこと。

### Public boundaries

frontend public boundary:

```ts
// src/modules/overview/index.ts
export { OverviewScreen } from "./OverviewScreen";
export { ProjectScopeNavigation } from "./components/ProjectScopeNavigation";
export type { OverviewScope } from "./overviewTypes";
```

backend public boundary:

```ts
// api/app.ts
import { overviewRouter } from "./modules/overview/overview.routes";
```

shared schema:

```ts
// shared/schemas/overview.schema.ts
export const overviewDashboardSchema = ...;
export type OverviewDashboard = z.infer<typeof overviewDashboardSchema>;
```

frontend で response type を手書き複製せず、shared schema から export した type を使用する。

### Agent ontology

実装時に Overview ownership を次へ登録する。

- `.agent-ontology/modules/overview.yaml`
- `.agent-ontology/modules.yaml` の `overview` entry

manifest には frontend、backend、shared schema、routing integration、主要 tests を列挙する。既存 `.agent-ontology` に並行変更がある場合は上書きせず、最新内容へ additive に統合する。

## Scope

### 対象

- Overview scope model。
- Overview shared schema と frontend type。
- 全体・Project 共通の usage/cost aggregation。
- Project 固有 context の additive response。
- 共通 Overview component tree。
- Project scope navigation。
- Project Overview route canonicalization。
- compact number、currency、percent、exact-value tooltip。
- 日英 i18n。
- API、service、routing、component、formatting、E2E の回帰テスト。
- 旧 Project overview component と重複 usage/cost mapping の削除。
- `src/modules/nightworkers` から `src/modules/overview` への frontend ownership 移行。
- `api/modules/nightworkers` と `api/services/overview` から `api/modules/overview` への backend ownership 移行。
- shared Overview schema の domain-level path への移動。
- Overview module public barrel と module boundary test。
- agent ontology への Overview domain 登録。

### 対象外

- Project のタスク生成、評価、品質、技術スタック、Worktree 各画面の再設計。
- Project 一覧や Queue の scope Select 統合。
- Project 間比較。
- 組織、team、tag 等の追加 scope。
- custom date range picker。
- 新しい pricing source、為替 source、課金方式。
- DB schema migration。
- 履歴 snapshot の新規保存。
- coverage の再計算や quality runner の変更。
- ProjectMeta の scan 定義変更。
- chart library の導入。
- dashboard layout editor。
- compact suffix のユーザー設定。
- `K/M/G/T/P` より大きい値の専用単位追加。
- NightWorkers module 全体の分割。
- Project Detail の非概要機能を `src/modules/project-detail` へ移す作業。
- pricing、settings、quality、routing の共有ドメインを Overview 配下へ取り込むこと。

## 用語と不変条件

### Overview scope

```ts
type OverviewScope =
  | { kind: "all" }
  | { kind: "project"; projectId: string };
```

URL state との対応:

```text
/overview                         -> { kind: "all" }
/overview?projectId=<id>          -> { kind: "project", projectId: <id> }
/overview?range=7d                -> all, 7d
/overview?projectId=<id>&range=7d -> project, 7d
```

`projectId` が存在しない Project を指す場合は全体へ黙って fallback せず、既存の not-found surface を表示する。

### 時間軸

Dashboard 内のデータを次の2種に分ける。

1. `period aggregate`
   - usage、cost、model breakdown、daily usage、recent calls、run summary。
   - scope と `range` の両方に従う。
2. `latest snapshot`
   - ProjectMeta、stack、latest evaluation、latest coverage。
   - `range` の影響を受けない。
   - UI に「最新スナップショット」と日時を表示する。

両者を同じ KPI row に混在させない。

### Token semantics

```text
totalInput = inputTokens
uncachedInput = max(inputTokens - cachedInputTokens, 0)
cachedInput = cachedInputTokens
output = outputTokens
reasoningOutput = reasoningOutputTokens
```

日本語ラベル:

- `総入力`: `totalInput`
- `入力`: `uncachedInput`
- `キャッシュ入力`: `cachedInput`
- `出力`: `output`
- `推論出力`: `reasoningOutput`

### Cost semantics

- currency は Overview response の `scope.currency` を使用する。
- `estimatedTotal` は priced usage の推定値であり、請求確定額と表現しない。
- priced/unpriced call count を必ず補足表示する。
- unpriced call が1件以上あれば、値を隠さず「一部未算定」と表示する。
- priced call が0件なら `—` とし、「未接続」ではなく「価格未取得」と表示する。
- Project scope でも `$` を直接文字列連結しない。

### Run and call semantics

- `実行数` は `task_runs` の件数。
- `LLM 呼び出し` は usage summary の `callCount`。
- run summary の期間基準は `task_runs.startedAt` とする。
- `completed` は status `completed`。
- `failed` は `failed` と `timed_out`。
- `active` は `running`, `context_compiling`, `finalizing`。
- その他の terminal/attention status は total に含めるが completed/failed/active に偽装しない。
- average per run は初期実装では表示しない。

## Compact Number Contract

### 公開 helper

`src/modules/overview/overviewFormat.ts` に、少なくとも次を追加する。

```ts
formatCompactNumber(value: number, options?: {
  maximumFractionDigits?: number;
}): string

formatExactNumber(value: number, language: AppLanguage): string

formatCompactCurrency(
  value: number | null,
  currency: AppCurrency,
  language: AppLanguage,
): string
```

`formatTokenCount()` を Overview で使い続けず、compact 表示箇所は Overview domain の `formatCompactNumber()` へ移行する。transcript 等、正確な桁区切りが必要な既存 surface の `formatTokenCount()` は変更しない。

`overviewFormat.ts` は `src/i18n/format.ts` の exact locale helper と language/currency type を利用してよいが、`src/i18n/format.ts` へ Overview 固有 suffix policy を逆流させない。

### Suffix

```text
1K = 10^3
1M = 10^6
1G = 10^9
1T = 10^12
1P = 10^15
```

変換例:

```text
0             -> 0
999           -> 999
1,000         -> 1K
1,500         -> 1.5K
1,750         -> 1.75K
8,382,845     -> 8.38M
1,000,000,000 -> 1G
1,250,000,000 -> 1.25G
```

規則:

1. 小数は最大2桁。
2. `1.50M` は `1.5M`、`1.00M` は `1M` とする。
3. 999 未満の integer は suffix を付けない。
4. rounding 後に mantissa が `1000` になる場合は次 suffix へ繰り上げる。
5. `NaN` と infinite value は `—` とする。
6. `-0` は `0` とする。
7. API/DB の数値は変更せず render 時だけ compact にする。
8. `P` を超える専用 suffix は初期実装の対象外とする。

### Currency and percent

- 1,000 未満の currency は現在の locale-aware 表示を維持する。
- 1,000 以上の currency は symbol と compact number を組み合わせる。例: `¥1.75K`, `$2.08M`。
- JPY でも compact 表示では最大2桁を許可する。
- percent は suffix 変換せず最大2桁とする。例: `93.57%`, `100%`。
- output speed は最大2桁と unit を分離する。例: `36.8 tok/s`。

### Exact value accessibility

compact 表示する要素は正確な値を失わない。

- visual value: `8.38M`
- `title`: `8,382,845`
- `aria-label`: ラベルと正確な値を含む。例: `総入力 8,382,845 tokens`

table cell、KPI card、ranking value、chart tooltip に同じ helper を使う。DOM に同じ正確値を重複表示して視覚ノイズを増やさない。

## Shared API Contract

### Overview response

`shared/schemas/overview.schema.ts` へ移した `overviewDashboardSchema` を additive に拡張する。

```ts
scope: {
  repositoryId: string | null;
  range: "24h" | "7d" | "30d" | "all";
  timezone: string;
  currency: string;
}

runs: {
  total: number;
  completed: number;
  failed: number;
  active: number;
}

projectContext: null | {
  repository: {
    id: string;
    name: string;
    branch: string;
  };
  projectMeta: ProjectMeta | null;
  stackProfile: ProjectStackProfile;
  latestSnapshot: {
    evaluationScore: number | null;
    evaluationAt: string | null;
    coverageRunId: string | null;
    coverageAt: string | null;
    coverageAxes: Array<{
      key: "statements" | "branches" | "functions" | "lines";
      actualPercent: number;
    }>;
  };
}
```

規則:

- `repositoryId === null` では `projectContext === null`。
- `repositoryId !== null` では存在する Project の context を返す。
- Project not found は現在どおり 404。
- coverage axes は gate metrics を優先し、空なら `coverageSummary.total` へ fallback する既存規則を維持する。
- `projectContext` の構築は usage/cost の aggregation math を再実装しない。
- ProjectMeta の cache が有効な場合は cache を返し、15秒 polling ごとに全ファイル scan を行わない。

### Frontend view model

API response をそのまま JSX 条件分岐へ散らさず、`src/modules/overview/overviewViewModel.ts` の純粋関数で view model に変換する。

```ts
type OverviewViewModel = {
  scope: OverviewScope;
  title: string;
  subtitle: string;
  context: OverviewContextViewModel;
  tokenMetrics: OverviewMetricViewModel[];
  primaryMetrics: OverviewMetricViewModel[];
  usageTrend: OverviewUsageBucket[];
  costSummary: OverviewCostViewModel;
  models: OverviewModelRowViewModel[];
  recentCalls: OverviewCallRowViewModel[];
  projectSnapshot: ProjectSnapshotViewModel | null;
  warnings: OverviewWarningViewModel[];
};
```

`buildOverviewViewModel()` は次を担当する。

- scope 名と subtitle。
- KPI order。
- compact value と exact value。
- empty state。
- pricing coverage の補足文。
- Project snapshot の有無。

React component 内で raw number の割り算、currency 文字列連結、scope ごとの独自 label を作らない。

## Component Architecture

### Top-level

```text
OverviewScreen
└─ OverviewDashboard
   ├─ OverviewHeader
   │  ├─ OverviewScopeSelect
   │  ├─ OverviewRangeControl
   │  └─ RefreshAction
   ├─ ProjectScopeNavigation?       project scope only
   ├─ OverviewContextBar
   ├─ OverviewEnvironmentWarnings?
   ├─ OverviewTokenBand
   ├─ OverviewKpiGrid
   ├─ OverviewUsageTrendPanel
   ├─ OverviewCostSummaryPanel
   ├─ OverviewModelTable
   ├─ OverviewRecentCallsTable
   └─ ProjectSnapshotPanel?         project scope only
```

### Ownership rules

- `OverviewScreen` は fetch、polling、URL callbacks、error/loading state を所有する。
- `OverviewDashboard` は全体レイアウトを所有し、scope 別の top-level component switch を持たない。
- child components は `OverviewViewModel` の該当部分だけを受け取る。
- `ProjectSnapshotPanel` は project-only data を表示するが、Project Overview page にはしない。
- `ProjectScopeNavigation` は Project Detail の非概要タブと共有する。
- `KpiCard`, `SectionTitle`, empty state、table wrapper は overview folder に共通化する。
- `ProjectDetailCommon.tsx` から Overview 専用 helper を残さない。

### Proposed files

追加:

- `src/modules/overview/index.ts`
- `src/modules/overview/OverviewScreen.tsx`
- `src/modules/overview/overviewCommands.ts`
- `src/modules/overview/overviewTypes.ts`
- `src/modules/overview/overviewViewModel.ts`
- `src/modules/overview/overviewFormat.ts`
- `src/modules/overview/hooks/useOverviewDashboard.ts`
- `src/modules/overview/components/OverviewDashboard.tsx`
- `src/modules/overview/components/OverviewHeader.tsx`
- `src/modules/overview/components/OverviewMetrics.tsx`
- `src/modules/overview/components/OverviewUsagePanels.tsx`
- `src/modules/overview/components/ProjectSnapshotPanel.tsx`
- `src/modules/overview/components/ProjectScopeNavigation.tsx`
- `api/modules/overview/overview.routes.ts`
- `api/modules/overview/overview.service.ts`
- `api/modules/overview/overview.repository.ts`
- `api/modules/overview/overview-project-context.service.ts`
- `api/modules/overview/overview-coverage.ts`
- `shared/schemas/overview.schema.ts`
- `.agent-ontology/modules/overview.yaml`
- `tests/overview-view-model.test.ts`
- `tests/overview-number-format.test.ts`
- `tests/overview-module-boundary.test.ts`

変更:

- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`
- `src/modules/nightworkers/components/ProjectSidebar.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/components/project-detail/types.ts`
- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/routing/workbench-route-state.ts`
- `src/modules/nightworkers/routing/WorkbenchRoutePage.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `api/app.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/routes/run-routes.ts`
- `.agent-ontology/modules.yaml`
- related route/component tests

削除:

- `src/modules/nightworkers/components/OverviewScreen.tsx`
- `src/modules/nightworkers/types/overview.ts`
- `src/modules/nightworkers/nightWorkersCommands.ts` 内の `fetchOverview()` export
- `src/modules/nightworkers/components/project-detail/ProjectDetailOverview.tsx`
- `shared/schemas/nightworkers/overview.schema.ts`
- `api/services/overview/index.ts`
- `api/modules/nightworkers/nightworkers.basic.service.ts` 内の `getOverviewDashboard()` facade
- `api/modules/nightworkers/routes/run-routes.ts` 内の `getOverviewDashboardRoute`
- `api/modules/nightworkers/nightworkers.routes.ts` 内の Overview handler
- `ProjectDetailCommon.tsx` 内の移行後未使用な Overview 専用 component/formatter

削除は参照がゼロであることを `rg` と typecheck で確認してから行う。

## Layout Contract

### Header

左:

- title: 全体では「概要」、Project では「<Project名> の概要」。
- subtitle: scope と期間を自然文で表示する。

右:

- scope Select。
- range control。
- refresh action。

Select option:

- `all`: 「すべてのプロジェクト」。
- Project: `Repository.name`。

Project を切り替えたとき range は維持する。Project から all へ戻したときも range は維持する。

### Context bar

全体 scope:

- NightWorkers 全体であること。
- 対象期間。
- active provider/model は取得済みの場合だけ表示。

Project scope:

- Project 名。
- branch。
- Git short HEAD と commit date。
- file scale。
- stack summary。

context bar は KPI と見分けられる低い強調度にし、数値成果として誤認させない。

### Common token band

全体・Project とも同じ順序にする。

1. 総入力。
2. 入力。
3. キャッシュ入力。
4. 出力。
5. 推論出力。
6. 状態カード。
7. プロンプト推定。

0 は `—` にせず `0` と表示する。

### Primary KPI grid

全体・Project とも同じ順序にする。

1. 実行数。
2. LLM 呼び出し。
3. 出力速度。
4. 推定コスト。
5. キャッシュ率。

補足:

- 実行数: completed / failed / active。
- LLM 呼び出し: measured / estimated / unavailable。
- 出力速度: measured duration call count。
- 推定コスト: priced / unpriced call count。
- キャッシュ率: `cachedInput / totalInput * 100`。total input が0なら `—`。

KPI 数は scope で変えない。

### Common panels

- 日別使用量。
- コスト内訳。
- モデル構成。
- 直近の高コスト呼び出し。

全体 scope の recent call row には Project 名を表示可能にする。Project scope では Project 列を省略してよいが、同じ row component と data shape を使用する。

### Project snapshot

Project scope でだけ表示する。

- 最新評価 score。
- coverage statements / branches / functions / lines。
- evaluation timestamp。
- coverage run timestamp。

「選択期間とは独立した最新結果」であることを section description に明示する。

## Routing Migration

### Canonical navigation

1. `ProjectSidebar` の Project detail overview action を `buildOverviewRoute(currentRange, projectId)` へ変更する。
2. Project scope navigation の「概要」を `/overview?projectId=<id>&range=<range>` へ向ける。
3. Project の非概要タブは `/projects/:id/detail/:tab` を維持する。
4. `/projects/:id/detail/overview` を受けた場合は `/overview?projectId=<id>` へ replace navigation する。
5. old URL canonicalization で history に重複 entry を作らない。

### Type handling

`ProjectDetailTab` の `overview` は legacy URL normalization のため一時的に残してよいが、`ProjectDetailScreen` が overview content を render してはならない。移行完了後、route parser と tests を更新できる場合は非概要 tab union と legacy tab を分離する。

## Implementation Phases

### Phase 1: Baseline and shared definitions

#### 変更

1. 現在の全体 Overview と Project Overview の fixture response、URL、主要ラベルを tests に固定する。
2. `OverviewScope` と `OverviewViewModel` を定義する。
3. metric dictionary に label、unit、time basis、empty behavior を定義する。
4. `formatCompactNumber`, `formatExactNumber`, `formatCompactCurrency` を追加する。
5. formatter tests を先に追加する。
6. `src/modules/overview`, `api/modules/overview` の skeleton と public boundary を追加する。
7. 現在の分散 path を固定する module boundary test を追加する。
8. agent ontology に Overview module ownership を additive に登録する。

#### 完了条件

- compact number examples がすべて test で固定される。
- `999_999` 等の suffix rollover が test される。
- NaN、Infinity、0、末尾ゼロ除去が test される。
- existing `formatTokenCount()` の exact behavior に回帰がない。
- frontend/backend の Overview public boundary が定義される。
- boundary test が移行前の許可 path と移行後の禁止 path を明示する。

### Phase 2: Overview backend domain extraction and contract

#### 変更

1. `shared/schemas/nightworkers/overview.schema.ts` を `shared/schemas/overview.schema.ts` へ移す。
2. `api/services/overview/index.ts` を `api/modules/overview/overview.service.ts` と repository/context helper へ責務分割して移す。
3. Overview route definition と handler を `api/modules/overview/overview.routes.ts` へ移す。
4. `api/app.ts` に `overviewRouter` を独立登録する。
5. `nightworkers.routes.ts`, `run-routes.ts`, `nightworkers.basic.service.ts`, `nightworkers.service.ts` から Overview facade/export を削除する。
6. `overviewDashboardSchema` に `runs` と `projectContext` を追加する。
7. `buildOverviewDashboard()` に scope/range 対応 run summary を追加する。
8. Project scope でだけ Project context builder を呼ぶ。
9. ProjectMeta、stack、latest evaluation、latest coverage を context に正規化する。
10. coverage fallback は `api/modules/overview/overview-coverage.ts` の pure helper に集約する。
11. usage/cost aggregation は Overview module 内で維持し、Project Detail service の計算をコピーしない。

#### 完了条件

- all scope で `projectContext === null`。
- project scope で repository、meta、stack、health snapshot が返る。
- range と repository filter が usage、cost、runs に適用される。
- latest snapshot は range によって変化しない。
- Project not found は404。
- polling response が実ファイル全走査を毎回行わない。
- `/api/overview` の URL と response compatibility が維持される。
- `api/modules/nightworkers` と `api/services/overview` に Overview route/service implementation が残らない。
- `api/modules/overview` が backend implementation の唯一の owner になる。

### Phase 3: Frontend overview domain extraction and shared components

#### 変更

1. `src/modules/overview/index.ts` と public exports を追加する。
2. `OverviewScreen.tsx` を `src/modules/overview` へ移す。
3. `fetchOverview()` を `overviewCommands.ts` へ移す。
4. API response type は shared schema export を使用し、`src/modules/nightworkers/types/overview.ts` の手書き複製と `src/modules/nightworkers/types.ts` の re-export を削除する。
5. `overviewFormat.ts` に compact/exact formatter を実装する。
6. `buildOverviewViewModel()` を実装する。
7. raw response から common token band と common KPI grid を生成する。
8. compact/exact representation を view model で作る。
9. common dashboard child components を追加する。
10. 現在の Overview layout を新 component tree へ移す。
11. Project snapshot panel と Project scope navigation を optional section として追加する。
12. `NightWorkersShell` の import を `@/modules/overview` public boundary へ切り替える。

#### 完了条件

- `OverviewDashboard` は scope switch で component 自体を差し替えない。
- common KPI の数と順序が両 scope で同じ。
- project-only data がない全体 scope で空の card を残さない。
- Project 固有 context が期間 aggregate と視覚的に区別される。
- compact value と exact accessible value が両方存在する。
- `src/modules/nightworkers` に Overview screen、command、response type、formatter が残らない。
- NightWorkers shell は Overview internal path を deep import しない。
- `src/modules/overview` が frontend implementation の唯一の owner になる。

### Phase 4: Routing and Project Detail migration

#### 変更

1. Project sidebar の概要導線を canonical Overview route へ変更する。
2. Project detail navigation を shared `ProjectScopeNavigation` へ移す。
3. legacy Project overview route を canonicalize する。
4. `ProjectDetailScreen` から overview render branch と overview-only mapping を削除する。
5. `ProjectDetailOverview.tsx` を削除する。
6. `ProjectDetailCommon.tsx` の overview-only helper を削除または overview folder へ移動する。

#### 完了条件

- Project Overview を描画する top-level component が1つだけ。
- sidebar、Select、Project tab、direct URL が同じ canonical URL へ到達する。
- 戻る・進むで scope と range が復元される。
- mission/evaluation/quality/stack/worktrees に回帰がない。

### Phase 5: Duplicate aggregation cleanup

#### 変更

1. `getProjectDetailMetrics()` の `llmUsage` と overview-only health consumers を再確認する。
2. consumer がゼロなら Project Detail metrics schema から overview-only fields を削除する。
3. stack tab が必要とする `stackProfile` の取得経路だけを維持する。
4. Project Detail frontend の `modelUsageRows`, `topTokenTasks`, `totalRuns`, `completedCount` mapping を削除する。
5. `$${...}` 形式の手動 currency formatting を削除する。
6. old Overview frontend/backend/schema path が存在しないことを確認する。
7. Overview module boundary test を移行後の strict assertion へ切り替える。

#### 完了条件

- LLM usage/cost aggregation math が overview service に1つだけ存在する。
- Project Detail service に同じ reduction/map が残らない。
- deleted schema fields の参照が0件。
- focused backend/type tests が成功する。
- `rg` で旧 Overview path と facade export が0件になる。
- agent ontology の Overview ownership と実ファイル配置が一致する。

### Phase 6: Verification and closeout

#### 変更

1. unit、service、component、routing、E2E を実行する。
2. 実データの全体 scope と Project scope をブラウザで比較する。
3. large number、zero data、unpriced calls、missing quality、missing Project を確認する。
4. Japanese/English と JPY/USD/EUR を確認する。
5. repo-native verify gate を実行する。
6. 実装と本文が一致するよう plan status を更新する。

#### 完了条件

- この文書の成功条件がすべて evidence 付きで確認される。
- unrelated dirty-tree changes を巻き込んでいない。
- 完了後に本書を `spec/archive/` へ移動できる。

## Test Plan

### Formatter unit tests

対象:

- `tests/overview-number-format.test.ts`
- `tests/frontend-small-hooks-and-auth.test.tsx` の既存 exact formatter regression

cases:

```text
0 -> 0
999 -> 999
1000 -> 1K
1500 -> 1.5K
1750 -> 1.75K
1_000_000 -> 1M
8_382_845 -> 8.38M
999_999 -> 1M
1_250_000_000 -> 1.25G
1_000_000_000_000 -> 1T
1_000_000_000_000_000 -> 1P
NaN -> —
Infinity -> —
-0 -> 0
```

currency:

```text
JPY 337 -> ¥337
USD 2.08 -> $2.08
JPY 1750 -> ¥1.75K
USD 1_250_000 -> $1.25M
null -> —
```

### Module boundary tests

対象:

- `tests/overview-module-boundary.test.ts`

assertions:

1. `src/modules/overview/index.ts` が `OverviewScreen` を公開する。
2. `NightWorkersShell` が `@/modules/overview` から import する。
3. `src/modules/nightworkers/components/OverviewScreen.tsx` が存在しない。
4. `nightWorkersCommands.ts` が `fetchOverview()` を所有しない。
5. `api/modules/overview/overview.routes.ts` が `/overview` route を所有する。
6. `nightworkers.routes.ts` と `run-routes.ts` が Overview route を所有しない。
7. `buildOverviewDashboard()` が `api/modules/overview` 外に存在しない。
8. `api/services/overview` が存在しない。
9. `shared/schemas/nightworkers/overview.schema.ts` が存在しない。
10. `.agent-ontology/modules/overview.yaml` の ownership path が実在する。

### Backend tests

対象:

- `tests/nightworkers-routes/routes-nightworkers-02.test.ts`
- overview service focused tests
- Project Detail backend tests affected by schema cleanup

assertions:

1. all/project scope の usage totals。
2. range cutoff。
3. run summary の repository/range filter。
4. General Settings currency conversion。
5. priced/unpriced call counts。
6. Project context nullability。
7. evaluation/coverage snapshot provenance。
8. missing Project 404。
9. coverage gate metrics fallback to summary totals。

### View model tests

対象:

- `tests/overview-view-model.test.ts`

assertions:

1. all/project で common KPI order が同じ。
2. token semantics。
3. compact/exact values。
4. cache rate denominator zero。
5. pricing partial state。
6. Project snapshot の有無。
7. latest snapshot が period KPI に混ざらない。

### Component tests

対象:

- `tests/project-detail-screen.test.tsx`
- 新規または既存 Overview component tests
- `tests/frontend-project-detail-actions.test.tsx`

assertions:

1. scope Select options。
2. all/project switch callbacks。
3. same dashboard component tree。
4. Project navigation visibility。
5. compact visible values と exact title/aria-label。
6. loading/error/empty states。
7. warning placement。
8. Project Detail overview branch の不在。

### Routing tests

対象:

- `tests/workbench-route-state.test.ts`
- `tests/frontend-workbench-route-page.test.tsx`
- `tests/workbench-route-outlet-contract.test.ts`
- `tests/nightworkers-workbench-routes/*`

assertions:

1. `/overview` serialize/parse。
2. projectId と range の同時保持。
3. Select 変更後の canonical URL。
4. old Project overview URL canonicalization。
5. back/forward state restoration。
6. missing Project route。

### E2E

少なくとも次を確認する。

1. `/overview` を開く。
2. 30日から7日へ変更する。
3. Project を選択する。
4. URL に `projectId` と `range=7d` が残る。
5. Project context と snapshot が表示される。
6. KPI layout が全体と同じである。
7. Project navigation の品質へ移動する。
8. 概要へ戻ると canonical Overview URL になる。
9. Select を全体へ戻すと Project-only section が消える。
10. large token value が compact で、exact value が確認できる。

## Verification Commands

実装時は repository scripts の最新定義を確認してから実行する。現時点の代表候補:

```bash
bunx vitest run \
  tests/overview-number-format.test.ts \
  tests/overview-view-model.test.ts \
  tests/overview-module-boundary.test.ts \
  tests/project-detail-screen.test.tsx \
  tests/frontend-project-detail-actions.test.tsx \
  tests/workbench-route-state.test.ts \
  tests/frontend-workbench-route-page.test.tsx \
  tests/workbench-route-outlet-contract.test.ts \
  tests/nightworkers-routes/routes-nightworkers-02.test.ts

bun run typecheck
bun run verify:base
```

route/backend test の DB fixture が同一 process で干渉する場合は、repo-native test runner の既存分割単位を維持し、無理に1 command へ結合しない。

最終 gate は実装時点の `scripts/verify.mjs` を確認し、対象 surface に対応する repo-native command を選ぶ。

## Acceptance Checklist

### Architecture

- [x] Overview top-level component が1つ。
- [x] all/project の別 page component がない。
- [x] usage/cost aggregation が1つ。
- [x] Project-specific data は optional section。
- [x] old Project overview component が削除済み。
- [x] frontend implementation が `src/modules/overview` に集中している。
- [x] backend implementation が `api/modules/overview` に集中している。
- [x] NightWorkers module には routing/integration boundary だけが残る。
- [x] Overview public barrel 以外への deep import がない。
- [x] old service/schema/command path が削除済み。
- [x] agent ontology に Overview ownership が登録済み。

### Navigation

- [x] Select で all/project が切り替わる。
- [x] range が維持される。
- [x] URL 再読込で復元される。
- [x] sidebar と Project tab が canonical route を使う。
- [x] legacy URL が canonicalize される。

### Metric semantics

- [x] 総入力と非 cached 入力が区別される。
- [x] run と call が区別される。
- [x] currency が scope で変わらない。
- [x] priced/unpriced 状態が明確。
- [x] latest snapshot が期間 KPI と区別される。
- [x] average per run の曖昧な値が表示されない。

### Number display

- [x] `K/M/G/T/P` が使われる。
- [x] 小数最大2桁。
- [x] 不要な末尾ゼロがない。
- [x] rollover が正しい。
- [x] exact value を確認できる。
- [x] currency と percent の専用規則が守られる。

### Regression

- [x] Project Detail の非概要タブに回帰がない。
- [x] startup warnings に回帰がない。
- [x] Overview polling と手動更新が動く。
- [x] Project not found が明示される。
- [x] focused tests が成功する。
- [x] typecheck が成功する。
- [x] repo-native verify gate が成功する。

## Risks and Mitigations

### Domain move と feature change の混在

リスク:

- path 移動、API contract 追加、UI 変更を一度に行うと回帰原因を特定しづらい。

対策:

- Phase 1 で baseline と boundary test を固定する。
- backend move、frontend move、consumer 切替、old path 削除の順に進める。
- 各 phase で endpoint URL と visible baseline を比較する。
- move と behavior change を同じ commit に混ぜる場合も、test evidence を責務ごとに分ける。

### Project context の polling cost

リスク:

- Project scope の15秒 polling で ProjectMeta scan や stack detection が毎回走る。

対策:

- context builder は保存済み/cache 済み値を優先する。
- expensive refresh と usage polling を分離する必要がある場合は、同じ Dashboard component の controller 内で cadence を分ける。
- UI component を分ける理由にはしない。

### Route compatibility

リスク:

- bookmark、E2E、sidebar が旧 Project overview URL を参照する。

対策:

- legacy route を即404にせず replace canonicalization を入れる。
- route tests と source-level href audit を同じ変更で更新する。

### Schema cleanup の波及

リスク:

- `projectDetailMetricsSchema.llmUsage` を tests や非概要 tab が暗黙に参照する。

対策:

- additive Overview contract を先に導入する。
- frontend consumer を移行してから schema を削る。
- `rg`、typecheck、focused tests で参照ゼロを確認する。

### Compact display の精度誤認

リスク:

- `8.38M` だけでは exact 値が分からない。

対策:

- title/aria-label に exact 値を保持する。
- API と計算値を丸めない。
- table sort は raw number で行う。

### Latest snapshot と range の混同

リスク:

- 7日を選んだとき評価や coverage も7日集計だと誤解される。

対策:

- section を分離し「最新スナップショット」と timestamp を表示する。
- range-dependent view model に snapshot を混ぜない。

## Rollback Strategy

実装途中で問題が出た場合も、別 Overview component を復活させて二重運用しない。

rollback 単位:

1. backend module move は `/api/overview` contract test を維持したまま import/registration 単位で戻す。
2. frontend module move は `src/modules/overview/index.ts` の public import 境界を維持し、NightWorkers internal へ新実装をコピーしない。
3. route canonicalization を戻し、既存 Project overview route を一時維持する。
4. additive Overview schema fields は consumer 未接続なら残してよい。
5. new shared dashboard を feature branch 内で無効化しても、usage/cost aggregation を再コピーしない。
6. `ProjectDetailOverview.tsx` を削除した後の rollback が必要な場合は Git history から戻し、手書きで類似 component を新設しない。
7. formatter は Overview 呼び出し箇所だけ戻し、既存 exact formatter の挙動を変えない。
8. agent ontology の entry は実ファイル ownership と同じ phase で戻し、stale manifest を残さない。

## Definition of Done

次の状態をもって完了とする。

1. 単一 Overview Dashboard が all/project を表現する。
2. Select、range、URL、sidebar、Project navigation が同じ scope state を使う。
3. usage/cost の backend aggregation と frontend mapping が重複していない。
4. common KPI の意味、期間、通貨が揃っている。
5. Project snapshot の時間軸が明示されている。
6. 大きい数値が `K/M/G/T/P` と小数最大2桁で読みやすい。
7. exact 値と accessibility が失われていない。
8. focused tests、typecheck、repo-native verify gate が成功する。
9. unrelated dirty-tree changes を含まない。
10. 本文の acceptance checklist がすべて完了し、archive 可能である。
11. frontend、backend、shared schema、commands、view model、formatting の canonical owner が Overview domain に統一されている。
12. NightWorkers と Project Detail には Overview の routing/integration boundary 以外が残っていない。
13. module boundary test と agent ontology がこの ownership を継続的に検証する。
