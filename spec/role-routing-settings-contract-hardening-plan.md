# Role Routing Settings Contract Hardening Plan

## 1. 目的

Settings の Role Routing で指定した primary / fallback だけが、現在タスク、担当 LLM、fallback LLM の全経路で実際に使われる状態にする。

今回の目的は、場当たり的に `gemma-4` や Azure への fallback を止めることではない。Role Routing を single source of truth に戻し、設定に存在しない経路、設定と違うモデル、UI 上の kind と矛盾する実行ログを発生させない。

対象にする問題:

1. Role Routing の `fallbacks: []` でも enabled endpoint から fallback 候補が合成されうる。
2. endpoint id `bedrock-default` が legacy id として残り、UI では local LLM なのにログ上 Bedrock に見える。
3. Role Routing に指定した model が endpoint models に存在しない場合、先頭 model に暗黙置換される。
4. runtimeOptions / Native API Runner / structured-LLM の route policy が完全に一致していない。
5. 現在タスク、担当 LLM、fallback LLM の実効ルートが UI / DB / ログで同じ粒度で確認できない。
6. queue-supervisor など長寿命 process が古い route 実装を掴んだまま動く可能性がある。

## 2. 目標状態

### 2.1 Role Routing は明示設定だけを使う

各 role の route candidates は次の順だけで構成する。

1. 明示 override
2. `roleRoutes[].primary`
3. `roleRoutes[].fallbacks[]`

禁止するもの:

- enabled endpoint からの自動 fallback 合成
- ACTIVE_LLM_PROVIDER / legacy env 由来の実行時 fallback
- provider health / readiness unknown を理由にした別 endpoint 補完
- model 不一致時の `endpoint.models[0]` への暗黙置換
- Codex / SchemaFirst / Azure / Gemma への暗黙退避

primary が失敗し、`fallbacks` が空なら、その role はそこで失敗する。別の enabled endpoint へ逃げない。

### 2.2 endpoint id はユーザー設定値ではなく内部 immutable id にする

ユーザーは endpoint id を編集しない。UI は id を見せず、表示名、kind、base URL、models、Role Routing target だけを扱う。

endpoint id は次の形式にする。

```text
ep_<sha256(seed).slice(0, 16)>
```

seed の条件:

- secret を含めない。
- 表示名を含めない。
- API key を含めない。
- endpoint 作成時に固定し、設定編集で再計算しない。
- 既存 endpoint の migration 時は deterministic に生成し、roleRoutes を同じ migration で張り替える。

候補:

```text
seed = legacy:<oldId>:<kind>:<baseUrl-or-endpoint>:<firstModel>
```

新規作成時:

```text
seed = created:<crypto.randomUUID()>
```

重要なのは「hash だから設定内容から毎回再計算する」ではない。baseUrl や model を編集するたびに id が変わると Role Routing が壊れるため、hash は内部識別子の生成形式に限定する。

### 2.3 provider kind と provider adapter を混同しない

`providerEndpointId` は識別子であり、provider kind ではない。

ログ、DB、UI は最低限この 4 つを分けて出す。

- `providerEndpointId`: 例 `ep_...`
- `endpointName`: 例 `Qwen 3.6 27B`
- `endpointKind`: 例 `local`
- `providerAdapter`: 例 `openai`

`kind: local` の endpoint は OpenAI-compatible adapter を使ってよい。ただし、その場合も `bedrock-default` のような legacy id が残って Bedrock provider に見える状態は解消する。

### 2.4 実効ルートを保存値として追跡する

task run 開始時点で、active role だけでなく全 role の route plan を snapshot に保存する。

保存対象:

- active role
- execution mode
- runtime lane
- current task route
- role ごとの primary
- role ごとの explicit fallback list
- 各 target の validation 結果
- route policy digest
- settings revision

provider turn ごとの route attempts は、この snapshot 内の候補だけを参照する。turn 中に settings が変わっても、その run の route plan は変えない。

## 3. 修正対象

主対象:

- `api/services/structured-llm/role-routing.ts`
- `api/services/structured-llm/request.ts`
- `api/services/structured-llm/settings.ts`
- `api/routes/settings-runtime.ts`
- `api/services/agent-runtime/registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx`

テスト対象:

- `tests/structured-llm/services-structured-llm-02.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`
- `tests/routes.settings-general.test.ts`
- 必要なら settings migration 専用 test を追加する。

## 4. 実装前レビュー結果

この計画は方向性としては実行可能だが、初版のままだと次の点が実装者依存になる。

1. 最初の PR で入れる変更単位が曖昧。
2. settings migration の書き込み安全性と dry-run が不足。
3. route snapshot guard をどこで強制するかが曖昧。
4. hash id の collision / duplicate endpoint の扱いが未定義。
5. 実行後にどの test command を通せばよいかが不足。

そのため、以下の実装計画では Phase をそのまま作業 ticket にできる粒度まで落とす。

## 5. 実装計画

### Phase 1: route policy の一本化

`synthesizeFallbacksFromEnabledEndpoints` を native/API route から完全に外す。

作業:

1. `api/services/agent-runtime/registry.ts`
   - `buildRuntimeLaneOptions(...)` から `synthesizeFallbacksFromEnabledEndpoints: true` を削除する。
   - runtimeOptions に残す route policy は `disallowedProviderIds: ['codex']` だけにする。
2. `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
   - Runner 内で生成する native/API policy も `disallowedProviderIds: ['codex']` だけにする。
   - runtimeOptions と Runner 内 policy が分岐しないよう、helper を 1 つに寄せる。
3. `api/services/structured-llm/role-routing.ts`
   - `synthesizeFallbacksFromEnabledEndpoints` の native/API 呼び出し経路をなくす。
   - この option を残す場合は test-only / explicit caller only と分かる名前に変更する。
4. `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
   - `buildNativeApiProviderRequests(...)` が受け取った explicit policy だけを使うことを test で固定する。
5. fallback 候補の diagnostics に `routeSource=primary|fallback|override` と `fallbackIndex` を必ず残す。

成功条件:

- Role Routing の `fallbacks: []` なら provider request candidates は 1 件だけ。
- enabled な Gemma / Azure / 2 個目の Qwen があっても、Role Routing にない限り候補に入らない。
- primary が Codex で native/API disallowed の場合、自動 local fallback せず `no_native_api_provider_route_candidates` で止まる。

最初に追加する regression:

- `tests/services.native-api-runner.test.ts`
  - local Qwen primary、Gemma / Azure enabled、fallback 空の設定で provider call が Qwen 1 回だけになること。
- `tests/nightworkers-service/services-nightworkers-01.test.ts`
  - runtimeOptions に synthesized fallback policy が入らないこと。

### Phase 2: model 不一致の暗黙置換を禁止する

現在の `resolveRouteTarget(...)` は指定 model が endpoint models にない場合、`endpoint.models[0]` に置換する。この挙動は「設定どおり」と矛盾するため廃止する。

作業:

1. `api/services/structured-llm/role-routing.ts`
   - `endpoint.models.includes(target.model)` が false の場合は route candidate を返さない。
   - invalid 理由を呼び出し側が表示できるよう、validation helper を追加する。
2. `api/routes/settings-runtime.ts`
   - settings 保存時に roleRoutes の target が providerEndpoints 内の enabled endpoint / model と一致するか検証する。
   - invalid な場合は 400 と structured error を返す。
3. `src/modules/nightworkers/components/SettingsLlmPanel.tsx`
   - 保存前に invalid target を表示し、保存ボタンまたは該当 route をエラー状態にする。
4. 既存設定読み込み時は、自動置換せず UI に修正要求を表示する。

成功条件:

- `roleRoutes[].primary.model = A` のとき、実行 model が勝手に `B` にならない。
- model 名変更や endpoint models 編集後、壊れた Role Routing は明示エラーになる。

### Phase 3: endpoint id migration

legacy id を内部 hash id に移行する。`bedrock-default` という id が local endpoint に残る状態をなくす。

作業:

1. settings schema に `settingsRevision` と `endpointIdSchemaVersion` を追加する。
2. migration helper を追加する。
   - 入力: parsed settings object
   - 出力: migrated settings object, id mapping, warnings
   - 書き込みは helper 外で行う。
3. legacy id を検出する。
   - `azure-default`
   - `openai-default`
   - `bedrock-default`
   - `codex-default`
   - その他 `endpoint-*`
4. legacy endpoint ごとに新 id を生成する。
5. collision が出た場合は `ep_<hash>_<n>` ではなく、seed に `:<ordinal>` を追加して再 hash する。
6. `providerEndpoints[].id` と全 `roleRoutes[].primary.providerEndpointId` / `fallbacks[].providerEndpointId` を同じ migration result で張り替える。
7. 書き込みは `llm-settings.json.tmp` へ出してから rename する。
8. 初回は dry-run API または script で mapping だけ確認できるようにする。
9. migration 前後の mapping を diagnostics へ残す。ただし API key / secret は出さない。
10. UI の endpoint card には id ではなく name / kind / URL / model を表示する。

移行例:

```json
{
  "oldId": "bedrock-default",
  "newId": "ep_5c3a8f0e91b2d4aa",
  "kind": "local",
  "name": "Qwen 3.6 27B(1)"
}
```

成功条件:

- local endpoint の providerEndpointId が `bedrock-default` にならない。
- Route logs で Bedrock と誤読される id が残らない。
- migration 後も各 role の primary / fallback は同じ endpoint を指す。
- migration は secret をログ出力しない。
- 同一 baseUrl / model の endpoint が複数あっても id collision しない。
- migration dry-run で roleRoutes の張り替え結果を確認できる。

### Phase 4: run 開始時の route snapshot を強化する

現在タスク、担当 LLM、fallback LLM が設定どおりかを、run 開始時の snapshot で証明できるようにする。

作業:

1. `nightworkers.run-orchestration.service.ts` で全 role の resolved route candidates を作る。
2. `task_runs.context_snapshot.effectiveLlmRouting` に active route だけでなく all roles を保存する。
3. snapshot に settings revision / endpoint id schema version / route policy digest を含める。
4. `native-api-request-adapter.ts` が作った candidates を snapshot の allowed route keys と照合する。
5. snapshot 外の endpoint が出た場合は provider call 前に `route_candidate_outside_snapshot` で止める。
6. provider turn の `provider_debug_json.routeAttempts[]` は snapshot に存在する route key だけ許可する。

成功条件:

- run の DB を見れば、current task route、担当 LLM、fallback LLM がすべて確認できる。
- turn で試行された route が run 開始時 snapshot にない場合、provider call されない。
- settings 変更後の run と変更前の run を区別できる。

snapshot の最小 schema:

```json
{
  "activeRole": "implementation",
  "settingsRevision": "2026-06-19T00:00:00.000Z",
  "endpointIdSchemaVersion": 2,
  "routePolicyDigest": "native-api:no-codex:explicit-only",
  "roles": {
    "implementation": {
      "primary": {
        "providerEndpointId": "ep_...",
        "endpointName": "Qwen 3.6 27B(1)",
        "endpointKind": "local",
        "providerAdapter": "openai",
        "model": "Qwen 3.6 27B",
        "routeKey": "ep_...::Qwen 3.6 27B::openai"
      },
      "fallbacks": []
    }
  }
}
```

### Phase 5: UI とログの真実性を揃える

Settings / task detail / activity log が同じ route plan を見せるようにする。

作業:

1. Settings 画面に role ごとの primary / fallback 数と invalid 状態を表示する。
2. Task run の activity に `endpointName`, `endpointKind`, `providerAdapter`, `model`, `routeSource` を出す。
3. `providerEndpointId` は詳細表示に限定し、表示名や kind の代わりに使わない。
4. fallback 発生時は「どの explicit fallback index に進んだか」を表示する。
5. fallback が存在しない場合は「fallback なしで停止」と明示する。

成功条件:

- UI で local LLM と表示されている endpoint がログで Bedrock に見えない。
- fallback が起きた場合、Role Routing に同じ fallback が見える。
- fallback がない場合、Gemma / Azure / 別 Qwen へ試行されない。

### Phase 6: 長寿命 process と設定反映の検証

source を直しても、queue-supervisor が古い process のままだと実行結果は変わらない。修正後は runtime process の再起動と実効検証まで含める。

作業:

1. 修正前後で `queue-supervisor` / dev server の PID と起動時刻を記録する。
2. code/settings migration 後に対象 process を再起動する。
3. 再起動後の PID / 起動時刻を確認する。
4. smoke task を 1 件流し、`native_api_turns.provider_debug_json.routeAttempts` を確認する。

成功条件:

- 実行中 process が修正後の source を読んでいる。
- smoke run の route attempts が Role Routing snapshot の範囲内に収まる。

## 6. 最小実装チケット

すぐ実行する場合は、次の順で PR を切る。

### Ticket A: 暗黙 fallback と model 置換を止める

変更:

- `api/services/agent-runtime/registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/structured-llm/role-routing.ts`
- `api/services/structured-llm/types.ts`
- 関連 tests

完了条件:

- fallback 空で candidates が primary だけ。
- model 不一致で別 model に置換されない。
- target tests が通る。

### Ticket B: route snapshot guard を追加する

変更:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- 関連 tests

完了条件:

- run snapshot に all roles の primary / fallback が入る。
- provider request candidate が snapshot 外なら provider call 前に止まる。
- DB query で snapshot と routeAttempts の一致を確認できる。

### Ticket C: endpoint id migration を追加する

変更:

- `api/services/structured-llm/settings.ts`
- `api/routes/settings-runtime.ts`
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx`
- settings migration tests

完了条件:

- legacy id が `ep_...` に移行される。
- roleRoutes が同時に張り替わる。
- dry-run で mapping を確認できる。
- secrets がログやレスポンスに出ない。

### Ticket D: UI / activity 表示を route truth に揃える

変更:

- Settings LLM panel
- task run activity / timeline components
- API response projection

完了条件:

- endpoint id ではなく endpointName / endpointKind / providerAdapter / model が見える。
- fallback がない停止と explicit fallback がある試行を UI で区別できる。

### Ticket E: live smoke と process restart 手順を固定する

変更:

- 必要なら scripts または docs

完了条件:

- 修正後 PID で queue-supervisor が動いている。
- smoke run の `routeAttempts` が snapshot 内だけ。

## 7. 回帰テスト計画

### 7.1 structured-LLM route resolver

追加するケース:

1. fallback 空 + enabled endpoint 複数でも primary だけ返る。
2. explicit fallback がある場合だけ fallback が返る。
3. primary model が endpoint models に存在しない場合は候補なし、または invalid diagnostic。
4. disabled endpoint は別 endpoint に置換されない。
5. `kind: local` endpoint は provider adapter `openai` になるが endpoint id は provider kind と無関係。

### 7.2 Native API Runner

追加するケース:

1. implementation role の fallback 空では Gemma / Azure が呼ばれない。
2. primary timeout 後、fallback 空なら run は provider failure で止まり、別 endpoint を試さない。
3. explicit fallback がある場合だけ同じ turn 内で fallback を試す。
4. routeAttempts の各 item が run snapshot の route plan に存在する。
5. runtimeOptions と Runner 内 route policy が食い違わない。

### 7.3 settings runtime / UI

追加するケース:

1. legacy id migration が roleRoutes を同時に更新する。
2. migration は secret を保持し、ログやレスポンスに secret を出さない。
3. UI で endpoint を編集しても id は変わらない。
4. endpoint 削除時は参照中 roleRoutes を空にするか、明示 warning を出す。
5. model list 変更で Role Routing が invalid になった場合、保存時または画面上で検知できる。

### 7.4 runtime verification

実装後に DB で確認する query:

```sql
select
  id,
  json_extract(context_snapshot, '$.effectiveLlmRouting.activeRole') as active_role,
  json_extract(context_snapshot, '$.effectiveLlmRouting.routePolicyDigest') as route_policy,
  json_extract(context_snapshot, '$.effectiveLlmRouting.roles.implementation.primary.providerEndpointId') as impl_primary,
  json_extract(context_snapshot, '$.effectiveLlmRouting.roles.implementation.fallbacks') as impl_fallbacks
from task_runs
order by created_at desc
limit 5;
```

```sql
select
  turn_index,
  json_extract(provider_debug_json, '$.routeAttempts') as attempts
from native_api_turns
where run_id = '<run-id>'
order by turn_index;
```

期待:

- `attempts[*].route.providerEndpointId` は snapshot の primary / fallback に含まれる。
- `fallbacks` が `[]` の role では attempts が primary だけ。

### 7.5 実行するコマンド

Ticket A / B の最低限:

```sh
bunx vitest run tests/structured-llm/services-structured-llm-02.test.ts tests/services.native-api-runner.test.ts tests/nightworkers-service/services-nightworkers-01.test.ts
bun run typecheck
```

Ticket C / D を含む場合:

```sh
bunx vitest run tests/routes.settings-general.test.ts tests/structured-llm/services-structured-llm-02.test.ts
bun run typecheck
```

全体確認:

```sh
bun run verify:base
```

live smoke は provider / local LLM の起動状態に依存するため、通常 test とは分ける。実行する場合は修正後 process の PID と settings revision を記録してから行う。

## 8. 実装時チェックリスト

Ticket A:

- [ ] `synthesizeFallbacksFromEnabledEndpoints` が native/API 経路から消えている。
- [ ] `endpoint.models[0]` への暗黙置換が route resolution から消えている。
- [ ] fallback 空の role で provider request candidates が 1 件だけ。
- [ ] explicit fallback がある role では順序が保存される。

Ticket B:

- [ ] `effectiveLlmRouting.roles` に all roles が保存される。
- [ ] `routePolicyDigest` が保存される。
- [ ] provider call 前に snapshot guard が走る。
- [ ] `route_candidate_outside_snapshot` の test がある。

Ticket C:

- [ ] migration helper は pure function として test できる。
- [ ] dry-run で mapping を返せる。
- [ ] tmp write + rename で settings を保存する。
- [ ] secret を console / log / response に出さない。
- [ ] duplicate endpoint でも id が衝突しない。

Ticket D / E:

- [ ] UI は endpoint id を provider kind として表示しない。
- [ ] fallback なし停止が UI で分かる。
- [ ] process restart 後の PID / 起動時刻を記録する。
- [ ] smoke run の routeAttempts が snapshot 内だけ。

## 9. 受け入れ条件

この計画の完了条件:

1. Role Routing に未設定の LLM へ fallback しない。
2. `fallbacks: []` の role で fallback attempt が記録されない。
3. local LLM endpoint が `bedrock-default` のような legacy provider id を持たない。
4. endpoint id は UI でユーザーが設定しない immutable hash id になる。
5. model 不一致時に別 model へ暗黙置換されない。
6. run 開始時 snapshot で、現在タスク、担当 LLM、fallback LLM が全 role について確認できる。
7. provider turn の routeAttempts が snapshot 外の route を含まない。
8. 修正後の queue-supervisor / dev server が再起動され、実 run で検証されている。

## 10. 実装順序

推奨順:

1. Phase 1 と Phase 2 を先に入れ、暗黙 fallback と model 置換を止める。
2. Phase 4 を入れ、route snapshot と provider attempt guard を追加する。
3. Phase 3 で endpoint id migration を入れる。
4. Phase 5 で UI / ログ表示を揃える。
5. Phase 6 で process 再起動と smoke run を実施する。

理由:

- まず実行経路の安全性を直す。
- その後に id migration を入れることで、migration 中の実効ルート差分を snapshot で検証できる。
- UI は最後に route truth を投影する。frontend-only の推測表示は作らない。

## 11. 注意点

- hash id の seed に API key / access token / secret を含めない。
- id を設定内容から毎回再計算しない。
- legacy id migration は roleRoutes と同時に行う。
- 既存 run の古い snapshot は書き換えない。
- 修正後に process を再起動しないまま「直った」と判断しない。
- provider health が成功しても、その endpoint が Role Routing fallback として許可されたことにはならない。
- context overflow や provider timeout は別問題として扱うが、別 LLM への暗黙 fallback で隠さない。
