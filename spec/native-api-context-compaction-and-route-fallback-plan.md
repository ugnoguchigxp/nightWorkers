# Native/API Context Compaction And Route Fallback 実装計画

## 1. 目的

`native-api-runner` が context window 超過の直前まで進んだあとに provider error で止まる問題と、Role Routing に明示されていない enabled endpoint へ fallback する問題を修正する。

この計画で扱う改善:

1. provider call 前に context 使用量を見積もり、しきい値を超えた場合は runtime 側で context 圧縮または新しい context window を開始する。
2. context 圧縮を provider の自律 tool choice 任せにしない。
3. Role Routing に明示されていない provider endpoint を native/API route fallback として合成しない。
4. Azure / Codex / SchemaFirst など、ユーザーが選んでいない実行経路へ暗黙に逃げない。

目標は、Qwen local LLM を主経路にした native/API lane のまま、context overflow と未設定 fallback の両方を runtime で制御すること。

## 2. 背景

最新 run `fccb6719-8d7c-4b7b-a785-6341e217f900` では、turn 49 で次の route attempts が記録された。

1. `bedrock-default` / `Qwen 3.6 27B`: `request (177722 tokens) exceeds the available context size (176128 tokens)`
2. `openai-default` / `gemma-4-12b-it-4bit`: timeout
3. `endpoint-1781587673584` / `Qwen 3.6 27B`: 同じ context 超過
4. `azure-default` / `gpt-5-4-mini`: Azure OpenAI 429

同じ run には `new_context` tool call も `context_window_started` event も存在しなかった。つまり、現在の native/API context compression 実装はこの run では発火していない。

現在の NightWorkers 実装では、`new_context` は model-visible tool として存在するが、provider がそれを返した場合だけ次 turn から履歴を baseline に戻す。

- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`

一方、`../codex` 側には token accounting に基づく pre-turn / mid-turn auto compact がある。`auto_compact_token_limit` は未指定なら context window の 90% で導出され、limit 到達時に `run_auto_compact` が実行される。25 / 50 / 75% は remaining context を会話に記録するしきい値であり、圧縮そのものではない。

NightWorkers native/API lane にはこの provider call 前の自動判定がないため、context overflow が provider から返るまで runtime が止められない。

また、Native API Runner は route policy に `synthesizeFallbacksFromEnabledEndpoints: true` を渡している。

```ts
basePolicy: {
  disallowedProviderIds: ['codex'],
  synthesizeFallbacksFromEnabledEndpoints: true,
}
```

そのため Role Routing の explicit primary / fallback だけでなく、enabled な endpoint が fallback 候補として末尾に追加される。Azure endpoint は Role Routing に含まれていなくても `providerEndpoints[].enabled=true` なら候補化される。

## 3. 非目標

- Codex SDK lane へ fallback しない。
- SchemaFirst supervisor loop へ fallback しない。
- provider / llm-provider 層に jobType ごとの SystemContext や実行判断を分散させない。
- ユーザー文言を keyword / regex で分類して route を変えない。
- Azure を fallback として暗黙利用しない。
- UI の Activity 投影や settings 画面表示の改善をこの計画に混ぜない。
- local-llm provider の API contract 自体はこの計画では変更しない。

## 4. 目標状態

### 4.1 context 使用量の runtime-owned 判定

Native API Runner は provider call の直前に、次の情報から prompt/context 使用量を判定する。

- provider request の messages
- tool definitions
- model capability
- endpoint の context window
- reserved output tokens
- safe prompt budget
- 直近の provider usage / estimated usage

しきい値:

- hard limit: `estimatedPromptTokens >= modelContextWindowTokens`
- compact limit: `estimatedPromptTokens >= autoCompactTokenLimit`
- warning/context hint: 使用率 75% 以上、つまり残り 25% 未満

初期値:

```text
autoCompactTokenLimit = floor(modelContextWindowTokens * 0.9)
remainingContextHintThreshold = floor(modelContextWindowTokens * 0.75)
```

`safePromptBudgetTokens` が endpoint capability に設定されている場合は、`autoCompactTokenLimit` と `safePromptBudgetTokens` の小さい方を採用する。

### 4.2 provider call 前の context compaction

context 使用量が `autoCompactTokenLimit` を超えた場合、provider call を続行しない。

代わりに runtime 側で次の順に処理する。

1. まだ圧縮していない場合は context compaction を実行する。
2. 圧縮後の history で provider request を再構築する。
3. 再構築後も hard limit を超える場合は `needs_human` で止める。
4. provider error の fallback route へ進まない。

圧縮は provider が `new_context` tool を返すことに依存しない。

### 4.3 compaction の種類

初期実装は 2 段階に分ける。

#### Stage A: baseline reset

現在の `new_context` と同じく、history を `contextWindowBaselineHistory` に戻す。

この方式は要約を作らないため安全だが、長い作業履歴の一部は provider prompt から消える。消した情報は DB の `native_api_turns` / `native_api_tool_calls` / `task_events` に残す。

Stage A は次の場合に使う。

- provider call 前に hard limit を超えそうな場合
- model が LLM 要約 compaction に失敗した場合
- local provider が compaction 用 structured output を安定して返せない場合

#### Stage B: LLM summary compaction

残り context が 25% 未満になった段階で、provider call 前に LLM に要約を作らせる。

要約対象:

- 完了済み tool calls の結果
- 変更済みファイルと diff summary
- Todo 状態
- 失敗した tool calls と未解決事項
- 現在の仕様書 title / digest / acceptance criteria
- 最新の user request

要約に含めないもの:

- API key / secret
- 大きな raw diff 全文
- `read_file` の全文 payload
- 重複した provider history

LLM summary compaction は専用の runtime-owned provider call として扱う。通常の implementation route fallback とは分離し、失敗しても Azure / Codex / SchemaFirst へ逃げない。

### 4.4 remaining context hint

Codex 側の 25 / 50 / 75% usage threshold と同等に、NightWorkers でも context 使用率が 75% を超えた時点で model-visible history に short hint を追加する。

例:

```text
[Runtime Context Budget]
Estimated context usage is above 75%. Prefer finishing the current Todo, compacting context, or calling new_context before reading more large files.
```

ただし、この hint は補助であり、圧縮の実行判断は runtime が持つ。provider が hint を無視しても provider call 前 guard で止める。

### 4.5 Role Routing 外 fallback の禁止

Native API Runner は Role Routing に明示された primary / fallback だけを route candidates とする。

禁止:

- `synthesizeFallbacksFromEnabledEndpoints` による enabled endpoint の自動追加
- Role Routing にない Azure fallback
- active provider / legacy env 由来の暗黙 fallback
- readiness unknown を理由にした別 endpoint 補完

許可:

- Role Routing に明示された fallback
- user / runtime が明示した `routeOverride`
- explicit fallback の readiness skip
- explicit fallback の dedupe

## 5. 対象ファイル

主対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/structured-llm/role-routing.ts`
- `api/services/structured-llm/request.ts`
- `api/services/structured-llm/model-capability.ts`
- `api/services/structured-llm/types.ts`
- `api/services/llm-usage/normalize.ts`

必要なら追加:

- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-route-policy.ts`

テスト対象:

- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-request-adapter.test.ts`
- `tests/structured-llm/services-structured-llm-02.test.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`

## 6. 実装方針

### Phase 1: explicit route candidates だけにする

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/structured-llm/role-routing.ts`
- `tests/structured-llm/services-structured-llm-02.test.ts`
- `tests/services.native-api-request-adapter.test.ts`

実装:

1. Native API Runner の basePolicy から `synthesizeFallbacksFromEnabledEndpoints: true` を外す。
2. `resolveStructuredLlmRoleRouteCandidates(...)` は explicit primary / fallback のみ返すことを native/API policy の標準とする。
3. `synthesizeFallbacksFromEnabledEndpoints` が必要な別用途がある場合は、native/API runner 以外の明示 opt-in に限定する。
4. tests の「Codex route を除外したら enabled local endpoint を合成する」期待を更新する。
5. explicit route がすべて disallowed / unreachable の場合は、別 endpoint へ逃げず `no_native_api_provider_route_candidates` で止める。

検証:

- implementation route が Qwen / Gemma / Qwen の場合、Azure は候補に入らない。
- Azure endpoint が `enabled=true` でも Role Routing にない限り候補に入らない。
- Codex が disallowed の場合、自動で local endpoint を合成しない。
- routeOverride は引き続き動作する。

### Phase 2: context budget estimator を追加する

対象:

- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/structured-llm/model-capability.ts`
- `tests/services.native-api-request-adapter.test.ts`

実装:

1. `NativeApiProviderRequest` から token estimate input を作る helper を追加する。
2. 最初は文字数ベースの保守的 estimate でよい。
   - `Math.ceil(charCount / 3)` を初期係数にする。
   - tools schema は JSON stringify 後に estimate する。
3. endpoint/model capability から `modelContextWindowTokens`, `safePromptBudgetTokens`, `reservedOutputTokens` を解決する。
4. `estimatedPromptTokens`, `contextUsageRatio`, `remainingTokens`, `autoCompactTokenLimit`, `hardLimitExceeded` を返す。
5. providerDebug と task_events に budget summary を残す。

検証:

- Qwen 176k context で 177k 相当の prompt は hard limit exceeded になる。
- 75% 超過は warning/hint 対象になる。
- 90% 超過は compaction 対象になる。
- small model に route が切り替わる場合、切り替え後の context window で判定される。

### Phase 3: provider call 前 guard を runner loop に入れる

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-budget.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. `providerRequests` を作った直後、attempt loop の前に primary request の budget を評価する。
2. warning threshold を超えたら history に context budget hint を追加する。
3. autoCompact threshold を超えたら provider call をせず compaction path へ進む。
4. compaction 後に `providerRequests` を再構築する。
5. 再構築後も hard limit を超える場合は `needs_human` で止める。
6. hard limit exceeded は route fallback の理由にしない。

検証:

- context overflow が provider 400 として発生する前に runtime が compaction を試す。
- compaction が成功すれば同じ route のまま provider call へ進む。
- compaction 失敗時に Azure fallback へ進まない。
- task_events に `context_budget_warning`, `context_compaction_started`, `context_compaction_finished` が残る。

### Phase 4: Stage A baseline reset compaction を runtime 化する

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. `new_context` tool call なしでも、runtime が `contextWindowBaselineHistory` へ戻せる helper を追加する。
2. baseline reset を実行した理由を `task_events` と `native_api_turns.provider_debug_json` に残す。
3. reset 後に Todo snapshot / postImport / latest spec summary を再注入する。
4. reset が連続しすぎる場合は loop guard で止める。

検証:

- `new_context` tool call がなくても context window reset が実行される。
- reset 後の retained history item count が記録される。
- Todo と仕様書の最低限の作業文脈が失われない。

### Phase 5: Stage B LLM summary compaction を追加する

対象:

- `api/services/agent-runtime/native-api-runner/native-api-context-compaction.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/structured-llm/request.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. compaction 専用 prompt を追加する。
2. compaction 専用 schema を定義する。
3. compaction provider は現在の primary route を使う。
4. route fallback は使わない。
5. compaction summary を history に入れる。
6. summary には traceability と未完了 Todo を必ず含める。
7. summary 生成に失敗した場合は Stage A baseline reset に fallback する。

検証:

- 75% 超過後、provider call 前に summary compaction が実行される。
- summary には current Todo、変更ファイル、検証状態が含まれる。
- summary compaction 失敗時も Azure / Codex / SchemaFirst へ逃げない。

### Phase 6: UI/API に出る最終 error を正直にする

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/run-events/normalizer.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. `Native API provider turn failed without Codex/SchemaFirst fallback` に route attempts の最後だけを出さない。
2. 最終 report には primary failure と fallback sequence を要約する。
3. synthesized fallback が禁止された後は、Role Routing にない route が試行されていないことを report に含める。

検証:

- Qwen context overflow の場合、Azure 429 のような最後の fallback error だけが原因に見えない。
- route attempts の順序が DB と UI で一致する。

## 7. データ設計

DB migration は初期段階では必須にしない。

既存の格納先:

- `native_api_turns.provider_debug_json`
- `native_api_turns.error_json`
- `native_api_tool_calls.result_json`
- `task_events.payload_json`
- `llm_usage_records.metadata_json`

必要なら後続で追加する column:

```sql
ALTER TABLE native_api_turns ADD COLUMN context_budget_json TEXT;
ALTER TABLE native_api_turns ADD COLUMN compaction_json TEXT;
```

ただし最初は `provider_debug_json` に入れて検証し、UI / analytics が必要になった時点で column 化する。

## 8. 受け入れ条件

### Context compaction

- provider call 前に 75% / 90% / hard limit の判定が行われる。
- 90% 超過時に provider call へ進む前に compaction が実行される。
- hard limit 超過時に provider 400 を待たず runtime が止めるか compaction する。
- `new_context` tool call がなくても runtime-owned baseline reset が可能。
- LLM summary compaction は primary route だけを使い、fallback route を使わない。
- compaction 失敗時に Azure / Codex / SchemaFirst へ逃げない。

### Route fallback

- Role Routing に明示されていない endpoint は fallback 候補にならない。
- `providerEndpoints[].enabled=true` だけでは native/API route candidate にならない。
- Azure endpoint が enabled でも Role Routing にない場合は呼ばれない。
- routeOverride は明示 route として維持される。
- explicit fallback がすべて失敗した場合は、その範囲の失敗として報告する。

### Observability

- task_events に context budget warning / compaction start / compaction finish / compaction failure が残る。
- native_api_turns の provider_debug_json に context budget と compaction decision が残る。
- final_report は最後の provider error だけを原因にしない。

## 9. 実装順序

推奨順:

1. Phase 1: explicit route candidates だけにする
2. Phase 2: context budget estimator
3. Phase 3: provider call 前 guard
4. Phase 4: runtime-owned baseline reset
5. Phase 5: LLM summary compaction
6. Phase 6: final report 改善

最小修正として先に入れるなら、Phase 1 と Phase 3 / 4 を優先する。Phase 5 は summary 品質と token estimate の検証が必要なため、別 PR に分けてよい。

## 10. リスク

- token estimate が粗いと不要な compaction が増える。
- baseline reset は安全だが、provider が過去の詳細を失いやすい。
- summary compaction は summary の品質が悪いと作業文脈を失う。
- route fallback 合成を止めると、設定ミス時に「勝手に進む」挙動はなくなる。これは意図した変更だが、既存テスト更新が必要。
- Azure を fallback に期待していた過去のテストや運用が壊れる可能性がある。今後は Role Routing に明示する。

## 11. 検証コマンド

候補:

```bash
bunx vitest run tests/structured-llm/services-structured-llm-02.test.ts
bunx vitest run tests/services.native-api-request-adapter.test.ts
bunx vitest run tests/services.native-api-runner.test.ts
```

必要に応じて:

```bash
bunx vitest run tests/nightworkers-service/services-nightworkers-01.test.ts
```

実 run 検証では、`native_api_turns.provider_debug_json` と `task_events.payload_json` を確認する。

確認観点:

- routeCandidateCount に Azure が含まれない。
- Qwen context overflow 相当の履歴量で provider 400 が発生する前に compaction event が出る。
- compaction 後も Todo / spec / changed files の最低限の文脈が provider history に残る。
