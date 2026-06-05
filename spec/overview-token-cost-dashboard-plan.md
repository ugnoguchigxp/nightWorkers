# Overview Token / Cost Dashboard 実装計画

## 目的

NightWorkers の左上 `NightWorkers` ラベルを Overview Dashboard への入口にし、LLM token 使用量、利用 model、推定コスト、General settings を一画面で確認できるようにする。

この計画は既存の `spec/docs/project-intelligence-layer-concept.md` を置き換えない。Project Health / Decision Timeline / Drift Radar は Project Intelligence の read-only overview として残し、この計画では token / model / cost / settings / i18n の運用ダッシュボード機能を追加する。

## スコープ

### Compatibility constraints

- 既存の task / run / queue / settings API の response shape は変更しない。
- 既存の `GET /api/tasks/:id/llm-usage` は維持し、Overview 用 aggregate API は追加 API として実装する。
- 既存の LLM / MCP / Hooks / TODO settings の保存形式と意味を変えない。
- `llm_usage_records` の既存 column の意味を変えず、cost 計算に必要な情報は pricing 側または新規 read model 側で補う。
- migration は additive にし、既存 DB では missing pricing / missing FX の状態から起動できるようにする。

### 実装すること

- 左上 `NightWorkers` クリックで開く Overview Screen を追加する。
- `llm_usage_records` を集計する Overview read model API を追加する。
- input / output / cached input / reasoning output / StateCard token を表示する。
- measured / estimated / mixed / unavailable を分けて表示する。
- provider / model 別の利用量と推定コストを表示する。
- token pricing table を定義し、cost estimate に使う。
- General settings に timezone / language / currency / FX を追加する。
- Overview / General settings に限定して i18n と formatter を導入する。

### 実装しないこと

- LLM 内部 token を推測しない。
- provider の実請求額と完全一致すると断定しない。
- Overview から run / queue / adoption / settings mutation を直接実行しない。
- 初期実装で全画面を i18n 化しない。
- pricing / FX を dashboard render ごとに外部取得しない。
- Azure / Bedrock / Codex の料金を OpenAI public pricing と同一扱いしない。
- 過去ログから完全な cost backfill を行わない。

## 現状

### UI

- `src/modules/nightworkers/components/ProjectSidebar.tsx` の header に `NightWorkers` ラベルがある。
- 現在のラベルはクリック不可。
- `src/modules/nightworkers/components/NightWorkersShell.tsx` が `SettingsScreen` / `ImplementationQueueScreen` / `ThreadWorkspace` を state で切り替えている。
- Overview を足す場合は、既存の route を大きく変えず、Shell の screen state に追加するのが最小変更。

### Settings

- `src/modules/nightworkers/components/SettingsScreen.tsx` の section は `appearance / llm / hooks / mcp / todo`。
- General section は存在しない。
- LLM / MCP / Hooks settings は `api/routes/settings.ts` で file-backed runtime settings として扱われている。
- General settings も初期実装では同じ file-backed pattern に合わせる。

### Usage telemetry

- `llm_usage_records` は LLM call boundary の token 使用量を保持する。
- task 単位の aggregate API はあるが、global / repository overview 用の aggregate API はまだない。
- Overview では frontend が各 task API を N+1 で読むのではなく、backend read model を追加する。

## Design Decisions

### Overview scope

初期実装の Overview は global dashboard として開く。

- 左上 `NightWorkers` click: global Overview
- Project filter: `all repositories` を default にし、選択時だけ repository scope に絞る
- Workbench から task / run に戻る導線は link として持たせる

Project Folder 選択後の初期表示を Overview に変えるかどうかは別判断にする。今回の実装では既存 Workbench 初期表示を壊さない。

### Source of truth

- token 使用量の source of truth は `llm_usage_records`。
- cost の source of truth は `llm_usage_records` と `llm_model_pricing` と FX cache を合成した read model。
- frontend は token / cost を再計算しない。
- frontend は `Intl` による表示 format だけを担当する。

### Local / cloud semantics

Usage dashboard はすべての `llm_usage_records` を対象にする。

Cost dashboard は pricing が定義された provider/model だけを対象にする。

provider classification:

- `priced_cloud`: pricing table に有効な row がある
- `unpriced_cloud`: cloud provider だが pricing が未定義または曖昧
- `local_or_subscription`: local runtime または API billing に対応しない可能性がある provider
- `unknown`: provider/model が空または判定不能

`local_or_subscription` と `unknown` は token usage には含めるが、cost total には含めない。画面上は unpriced usage として件数と token を表示する。

### Privacy / trace constraints

- Overview には raw prompt、raw response、raw usage JSON の全文を表示しない。
- recent calls は task / run / provider / model / label / token / cost estimate に限定する。
- source URL、pricing fetchedAt、FX fetchedAt は表示してよい。
- `metadata_json` を UI にそのまま出さない。

## Dashboard 表示設計

### 1. Summary KPI

表示単位:

- range: `24h` / `7d` / `30d` / `all`
- scope: `all repositories` / `repositoryId`
- timezone: General settings の timezone
- currency: General settings の currency

表示内容:

- total tokens
- input tokens
- output tokens
- cached input tokens
- reasoning output tokens
- StateCard tokens
- call count
- measured call count
- estimated call count
- mixed call count
- unavailable call count
- estimated cost
- last updated

注意:

- usage chart は local / cloud が混在してもよい。
- cost chart は pricing が定義された cloud/provider usage だけを対象にする。
- `usage_mode` を潰して total だけにしない。

### 2. Daily Usage Chart

30日分の日次 bucket を表示する。

- day bucket は backend 側で timezone を反映して作る。
- default timezone は General settings を使う。
- frontend は timestamp を再集計しない。
- input / output / cached / reasoning / StateCard を切り替えられるようにする。
- range が `24h` の場合は hourly bucket、`7d` / `30d` は daily bucket、`all` は monthly bucket にする。
- bucket label と bucket boundary は API response に含める。

bucket point shape:

```ts
type OverviewUsageBucket = {
  key: string;
  startsAt: string;
  endsAt: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  stateCardTokens: number;
  totalTokens: number;
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
};
```

### 3. Model Mix

provider / model 単位で集計する。

表示内容:

- provider
- model
- call count
- input tokens
- output tokens
- total tokens
- measured ratio
- estimated cost
- pricing status

pricing status:

- `priced`: pricing table に一致
- `manual`: manual override
- `missing`: pricing 未定義
- `ambiguous`: Azure deployment / Bedrock region などで判定不能

### 4. Cost Summary

表示内容:

- base estimate in pricing currency
- converted estimate in selected currency
- input cost
- cached input cost
- output cost
- reasoning output cost
- FX rate
- FX source
- pricing source
- unpriced usage count

表示文言:

- すべて「推定」として扱う。
- provider billing dashboard と一致する保証は出さない。
- pricing / FX の取得日時を必ず表示する。

### 5. Recent Expensive Calls

高 token / 高 cost の LLM call を表示する。

表示内容:

- createdAt
- taskId
- runId
- provider
- model
- label
- input tokens
- output tokens
- StateCard tokens
- estimated cost
- usage mode

遷移:

- task / run に移動できる link を持たせる。
- 詳細 trace や raw prompt は表示しない。

### 6. Project Intelligence

既存構想の section は Overview 下段または別 tab として扱う。

- Project Health Snapshot
- Decision Timeline
- Drift Radar

今回の token / cost dashboard は Project Intelligence を置き換えず、運用観測 section として共存させる。

## Backend Read Model

### API

```text
GET /api/overview?range=30d
GET /api/overview?range=30d&repositoryId=...
GET /api/overview?range=30d&repositoryId=...&timezone=Asia/Tokyo&currency=JPY
```

初期実装では global dashboard を優先するため、`GET /api/overview` を追加し、optional `repositoryId` を受ける。

`GET /api/repositories/:id/overview` は初期実装では追加しない。repository scope は `GET /api/overview?repositoryId=...` に統一する。

Query validation:

- `range`: `24h` / `7d` / `30d` / `all`; default `30d`
- `repositoryId`: optional; unknown id は 404 ではなく空 dashboard ではなく、既存 repository lookup に合わせて 404 にする
- `timezone`: optional; default は General settings; invalid timezone は 400
- `currency`: optional; default は General settings; unsupported currency は 400

### Response shape

```ts
type OverviewDashboard = {
  generatedAt: string;
  scope: {
    repositoryId: string | null;
    range: '24h' | '7d' | '30d' | 'all';
    timezone: string;
    currency: string;
  };
  settings: {
    language: 'ja' | 'en';
    timezone: string;
    currency: string;
    activeProvider: string | null;
    activeModel: string | null;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningOutputTokens: number;
    stateCardTokens: number;
    totalTokens: number;
    callCount: number;
    measuredCallCount: number;
    estimatedCallCount: number;
    mixedCallCount: number;
    unavailableCallCount: number;
  };
  cost: {
    currency: string;
    estimatedTotal: number | null;
    inputCost: number | null;
    cachedInputCost: number | null;
    outputCost: number | null;
    reasoningOutputCost: number | null;
    unpricedCallCount: number;
    fxRate: number | null;
    fxBaseCurrency: string | null;
    fxUpdatedAt: string | null;
    pricingUpdatedAt: string | null;
    incompleteReasons: string[];
  };
  dailyUsage: OverviewDailyUsagePoint[];
  modelBreakdown: OverviewModelUsage[];
  recentExpensiveCalls: OverviewExpensiveCall[];
  warnings: OverviewDashboardWarning[];
};
```

Warnings:

```ts
type OverviewDashboardWarning =
  | { code: 'pricing_missing'; provider: string; model: string | null; callCount: number }
  | { code: 'fx_unavailable'; currency: string; baseCurrency: string }
  | { code: 'usage_estimated'; estimatedCallCount: number }
  | { code: 'timezone_fallback'; requestedTimezone: string | null; fallbackTimezone: string }
  | { code: 'usage_token_anomaly'; field: string; callCount: number };
```

### Backend module

```text
api/services/overview/
  overview-service.ts
  overview-repository.ts
  overview-cost.ts
  overview-types.ts
```

責務:

- repository: SQL aggregate と timezone bucket
- cost: pricing / FX を使った推定
- service: settings と usage aggregate の read model 組み立て

## Pricing Table

### DB table

```text
llm_model_pricing
- id text primary key
- created_at integer not null
- updated_at integer not null
- provider text not null
- model text not null
- currency_code text not null default 'USD'
- input_per_1m real null
- cached_input_per_1m real null
- output_per_1m real null
- reasoning_output_per_1m real null
- source_url text null
- source_label text null
- effective_from integer not null default 0
- fetched_at integer null
- manual_override integer not null default 0
- enabled integer not null default 1
```

Indexes:

```text
llm_model_pricing_provider_model_idx(provider, model)
llm_model_pricing_enabled_idx(enabled)
```

Unique rule:

```text
unique(provider, model, currency_code, effective_from)
```

Lookup rule:

1. `enabled = 1` の row だけを見る。
2. `provider` と `model` が一致する row を候補にする。
3. `effective_from <= usage.created_at` の row があれば最新を使う。
4. historical row がない場合は最新 enabled row を current pricing estimate として使う。
5. 複数一致する場合は `manual_override = 1` を優先する。

### Pricing source

初期 seed は少数 model だけに限定し、source URL と fetchedAt を保存する。seed は app 起動時に無条件 upsert せず、migration または明示 seed function で一度だけ投入する。

候補 source:

- OpenAI API Pricing: `https://openai.com/api/pricing/`
- Azure OpenAI Pricing: `https://azure.microsoft.com/en-us/pricing/details/azure-openai/`
- Amazon Bedrock Pricing: `https://aws.amazon.com/bedrock/pricing/`

注意:

- OpenAI pricing は model / input / cached input / output の table として扱える。
- Azure OpenAI は deployment / region / sku の差があるため、manual override を優先する。
- Bedrock は provider model と AWS region の差があるため、初期実装では manual override または missing にする。
- Codex provider は API billing と対応しない可能性があるため、pricing 未定義なら cost から除外する。

### Historical cost policy

初期実装では current pricing estimate として計算する。

将来、請求精度を上げる場合は `llm_usage_records` に pricing snapshot または calculated cost snapshot を追加する。

UI 表示は `current pricing estimate` と明記する。historical exact cost という表現は使わない。

## FX / Currency

### General settings

```ts
type GeneralSettings = {
  timezone: string;
  language: 'ja' | 'en';
  currency: 'JPY' | 'USD' | 'EUR';
  fx: {
    source: 'ecb' | 'manual';
    autoRefresh: boolean;
    lastRefreshedAt: string | null;
  };
};
```

### API

```text
GET /api/settings/general
POST /api/settings/general
POST /api/settings/fx/refresh
```

Validation:

- `timezone`: `Intl.DateTimeFormat` が受け付ける IANA timezone のみ保存する。
- `language`: 初期は `ja` / `en` のみ。
- `currency`: 初期は `JPY` / `USD` / `EUR` のみ。
- `fx.source`: 初期は `ecb` / `manual` のみ。
- invalid value は fallback 保存せず 400 を返す。

### Persistence

初期実装:

```text
api/.runtime/general-settings.json
api/.runtime/fx-rates.json
```

将来、user / workspace scope が必要になった場合は DB table 化する。

### FX source

初期 source は ECB の euro foreign exchange reference rates。

注意:

- ECB は EUR base なので USD -> JPY は EUR cross rate で計算する。
- FX が取れない場合は元通貨の金額を表示し、換算値は unavailable にする。
- dashboard render ごとの外部 fetch は避ける。
- refresh は daily cache と手動 refresh に限定する。

FX cache shape:

```ts
type FxRateCache = {
  source: 'ecb' | 'manual';
  baseCurrency: 'EUR';
  validOn: string;
  fetchedAt: string;
  rates: Record<string, number>;
};
```

Conversion rule:

- same currency は rate `1`。
- pricing currency と selected currency がどちらも EUR 以外の場合、EUR cross rate で計算する。
- 必要な rate が欠ける場合、converted cost は `null` にし、warning に `fx_unavailable` を入れる。

## i18n / Formatter

### 初期方針

全画面 i18n ではなく、Overview と General settings に限定して導入する。

追加 module:

```text
src/modules/nightworkers/i18n/
  dictionary.ts
  format.ts
  useNightWorkersI18n.ts
```

### 対象

- Overview labels
- General settings labels
- usage / cost / pricing status labels
- date / time formatting
- number / currency formatting

### 非対象

- LLM output
- repository / task / artifact の user content
- 既存 Settings 全 section の全面翻訳
- Supervisor prompt 文言

### Library decision

初期実装では typed dictionary + `Intl.DateTimeFormat` + `Intl.NumberFormat` を使う。

`i18next` / `react-i18next` は次の場合に検討する。

- 翻訳対象が全画面に広がる。
- plural / interpolation / namespace 管理が増える。
- 外部翻訳 file を運用する。

Dictionary rule:

- dictionary key は domain prefix を付ける。例: `overview.kpi.totalTokens`, `settings.general.currency`。
- fallback language は `ja`。
- missing key は key string を出さず、fallback language の文言を返す。
- Supervisor prompt や runtime instruction の日本語文言は i18n 対象にしない。

## Frontend 変更計画

### 追加 component

```text
src/modules/nightworkers/components/OverviewScreen.tsx
```

主要構成:

- header: range selector, repository filter, refresh state
- KPI band
- daily usage chart
- model mix table
- cost summary panel
- recent expensive calls table
- Project Intelligence entry section

### Shell wiring

`NightWorkersShell.tsx`:

- `showOverviewScreen` を追加する。
- `onOpenOverview` を `ProjectSidebar` に渡す。
- Overview 表示時は artifact pane と queue/settings selection を閉じる。

`ProjectSidebar.tsx`:

- 左上 `NightWorkers` を button にする。
- accessible label を付ける。
- active state を Overview 表示中に反映する。

### Layout rule

- dashboard は作業用画面として密度を高める。
- card inside card は避ける。
- repeated item / table / modal 以外を過剰な floating card にしない。
- cost と usage を同じ意味の chart に混ぜない。

## Backend 変更計画

### Schema / migration

追加:

- `llm_model_pricing`
- `fx_rates` table は初期実装では追加しない。FX は file-backed cache に固定する。

判断:

- pricing は cost semantics と結びつくため DB table が望ましい。
- FX は外部 source cache なので初期は runtime file で十分。

Migration order:

1. `api/db/schema.ts` に table を追加する。
2. `api/db/bootstrap.ts` に `CREATE TABLE IF NOT EXISTS` と index を追加する。
3. `drizzle/migrations/0010_llm_model_pricing.sql` を追加する。
4. migration meta journal を更新する。
5. fresh temp DB で bootstrap と migration の両方を確認する。

Backward compatibility:

- 既存 DB に pricing row がなくても app は起動する。
- pricing row がない状態の Overview は token usage を表示し、cost は unavailable とする。
- FX cache file がない状態の Overview は pricing currency の cost だけを表示する。

### Routes

追加:

```text
GET /api/overview
GET /api/settings/general
POST /api/settings/general
POST /api/settings/fx/refresh
GET /api/settings/pricing
POST /api/settings/pricing
```

`POST /api/settings/pricing` は manual override 用。

Route ownership:

- General / pricing / FX settings は `api/routes/settings.ts` に置く。
- Overview aggregate は NightWorkers domain API として existing app route registration に追加する。
- pricing calculation service は `api/services/pricing` に置き、settings route と overview route の両方から使う。

### Cost calculation

```text
billable_uncached_input_tokens = cached_input_tokens == null
  ? input_tokens
  : max(input_tokens - cached_input_tokens, 0)

billable_cached_input_tokens = cached_input_tokens == null
  ? 0
  : cached_input_tokens

billable_output_tokens = output_tokens

separately_billed_reasoning_tokens = provider_mapping.reasoning_is_separately_billed
  ? reasoning_output_tokens
  : 0

cost = billable_uncached_input_tokens / 1_000_000 * input_per_1m
     + billable_cached_input_tokens / 1_000_000 * cached_input_per_1m
     + billable_output_tokens / 1_000_000 * output_per_1m
     + separately_billed_reasoning_tokens / 1_000_000 * reasoning_output_per_1m
```

注意:

- `null` token は 0 と混同しない。
- price がない category は incomplete reason に入れる。
- cost chart は missing pricing の usage を除外する。
- table には unpriced usage を表示する。
- `cachedInputTokens` が null の場合は input tokens 全体を normal input として計算する。
- `cachedInputTokens` がある場合は `inputTokens - cachedInputTokens` を normal input とし、cached 分を別単価で計算する。
- `cachedInputTokens > inputTokens` の異常値は normal input を 0 に丸め、warning に入れる。
- `reasoningOutputTokens` は原則 output tokens の内訳として表示し、別課金 category として扱わない。
- `reasoning_output_per_1m` は provider mapping で reasoning が output とは別課金かつ output tokens に内包されないと確認できる場合だけ使う。

Provider cost mapping は `overview-cost.ts` に集約し、UI には mapping logic を置かない。

## Data Quality Rules

- `usage_mode = 'measured'`: provider usage を信頼して measured total に含める。
- `usage_mode = 'estimated'`: usage total には含めるが measured ratio では estimated として扱う。
- `usage_mode = 'mixed'`: provider total と system-estimated parts が混ざるため mixed として扱う。
- `usage_mode = 'unavailable'`: call count には含め、token total には null-safe に加算しない。
- `state_card_tokens` は input token の内訳として表示し、total token に二重加算しない。
- `total_tokens` が null で input/output がある場合は read model 側で `input + output` を display total として補完してよいが、warning には入れない。
- `raw_usage_json` は aggregate の根拠として保存されていても Overview API には返さない。

## 着手順

### Phase 1: General settings foundation

1. General settings type / default を追加する。
2. `GET /api/settings/general` / `POST /api/settings/general` を追加する。
3. `SettingsScreen` に General section を追加する。
4. timezone / language / currency を保存できるようにする。
5. formatter utility を追加する。

検証:

- settings が runtime file に保存される。
- missing runtime file でも default が返る。
- timezone / currency formatter が UI で使える。
- invalid timezone / language / currency が 400 になる。

Acceptance:

- 既存 Settings section の保存・表示に差分が出ない。
- General section を追加しても `appearance / llm / hooks / mcp / todo` が引き続き使える。

### Phase 2: Pricing / FX foundation

1. `llm_model_pricing` schema / migration / bootstrap を追加する。
2. pricing repository / service を追加する。
3. manual pricing settings API を追加する。
4. FX cache service を追加する。
5. FX refresh API を追加する。

検証:

- fresh DB migration が通る。
- pricing missing / priced / manual の状態が区別できる。
- FX unavailable 時に Overview が壊れない。
- pricing row が 0 件でも app が起動する。
- ECB fetch 失敗時に cache が壊れない。

Acceptance:

- manual pricing を保存・取得できる。
- pricing がない model は cost から除外され、warning として返せる。

### Phase 3: Overview read model

1. `api/services/overview` を追加する。
2. `llm_usage_records` aggregate query を追加する。
3. timezone aware daily bucket を backend で作る。
4. model breakdown を追加する。
5. cost estimate を追加する。
6. `GET /api/overview` を追加する。

検証:

- measured / estimated / mixed / unavailable count が分離される。
- 30日 bucket が configured timezone で作られる。
- pricing missing の usage が cost に混ざらない。
- repositoryId filter が効く。
- `24h` は hourly bucket、`7d` / `30d` は daily bucket、`all` は monthly bucket になる。
- empty usage でも zero dashboard が返る。

Acceptance:

- frontend が再集計せずに表示できる response shape になっている。
- warnings で missing pricing / FX unavailable / estimated usage を説明できる。

### Phase 4: Overview UI

1. `OverviewScreen` を追加する。
2. Shell に Overview state を追加する。
3. Sidebar の `NightWorkers` を Overview button にする。
4. KPI / chart / table / cost summary を表示する。
5. task / run link を付ける。

検証:

- 左上 `NightWorkers` クリックで Overview が開く。
- range 変更で API query が変わる。
- usage / cost / model table が空状態でも崩れない。
- token 表示が既存 Workbench header と矛盾しない。
- Overview から queue / run / settings mutation が発生しない。
- recent calls の task / run link が既存 Workbench に戻れる。

Acceptance:

- dashboard 初期表示は global Overview。
- repository filter を選ぶまで既存 Project selection の挙動を変えない。

### Phase 5: Scoped i18n

1. `dictionary.ts` に `ja` / `en` を追加する。
2. General settings の language を UI に反映する。
3. Overview と General settings の label を dictionary 化する。
4. number / currency / date は `Intl` formatter に寄せる。

検証:

- `ja` / `en` 切り替えで新規画面の label が切り替わる。
- currency 表示が selected currency に従う。
- timezone 表示が selected timezone に従う。
- 既存 Supervisor prompt 文言が変更されない。

Acceptance:

- Overview / General settings の文言だけが scoped i18n 対象になる。
- missing dictionary key が UI にそのまま露出しない。

## Test Plan

### Unit

- pricing cost calculation
- missing pricing incomplete reason
- FX cross-rate conversion
- General settings default / persistence
- timezone bucket calculation
- usage aggregate measured / estimated separation

### Route

- `GET /api/overview`
- `GET /api/overview?repositoryId=...`
- `GET /api/overview?range=24h`
- `GET /api/overview?timezone=Invalid`
- `GET /api/settings/general`
- `POST /api/settings/general`
- pricing settings routes
- FX refresh route with fetch mocked

### Frontend

- Settings General section render
- Overview empty state
- Overview populated state
- language switch
- currency formatter

### Smoke

- fresh DB migration
- existing DB bootstrap
- `pnpm typecheck`
- `pnpm lint`
- focused tests for overview/settings/pricing
- browser smoke for Overview and Settings General

### Manual verification

- 左上 `NightWorkers` click で Overview が開く。
- Settings > General で timezone / language / currency を変更し、Overview 表示に反映される。
- pricing 未定義 model がある場合、cost total に混ざらず warning として見える。
- FX cache がない状態で dashboard が落ちない。
- `ja` / `en` 切り替えで Overview / General settings の文言だけが変わる。

## リスク

- pricing は provider / region / deployment 依存が強く、実請求とずれる。
- Codex provider の token と billing の対応が不明な場合がある。
- FX source が落ちた場合に dashboard が壊れる可能性がある。
- Overview に情報を詰めすぎると Workbench / Settings の責務を侵食する。
- 全画面 i18n を同時に進めると差分が広がりすぎる。
- day bucket を frontend で作ると JST 期待とずれやすい。
- usage record の provider/model 名と pricing table の model 名が一致しないと cost が欠落する。
- `cachedInputTokens` / `reasoningOutputTokens` の provider semantics を誤ると二重計上になる。
- FX の外部 source 仕様変更で refresh が失敗する。

## Review Checklist

- 既存 API response shape を壊していない。
- migration は additive で、pricing/FX が空でも起動できる。
- token usage と cost estimate の source of truth が分かれている。
- local/subscription provider は usage には含め、cost には自動混入しない。
- `usage_mode` が Overview API と UI の両方で見える。
- timezone bucket は backend で作る。
- cost は `current pricing estimate` として表示される。
- raw prompt / raw response / raw usage JSON を Overview に出さない。
- i18n は Overview / General settings に限定されている。
- Phase ごとの Acceptance が実装前レビューに使える。

## 完了条件

- 左上 `NightWorkers` から Overview を開ける。
- Overview で token / model / cost / recent calls を確認できる。
- cost は pricing missing を明示し、推定として表示される。
- General settings で timezone / language / currency を保存できる。
- FX rate の取得状態と換算結果を確認できる。
- Overview / General settings は `ja` / `en` を切り替えられる。
- backend aggregate が source of truth になり、frontend が usage を再集計しない。
- fresh DB migration と focused tests が通る。
