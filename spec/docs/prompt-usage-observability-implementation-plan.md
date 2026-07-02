# Prompt Usage Observability Implementation Plan

## Goal

LLM usage の provider 実測値と NightWorkers が組み立てた prompt 部品の推定値を分けて保存し、Project Detail / Overview で `system_prompt_tokens`、`user_prompt_tokens`、`state_card_tokens` を 0 欠落ではなく観測できるようにする。

設定で ON/OFF 可能にし、デフォルトは ON とする。OFF の場合でも provider 実測 usage は保存し、prompt 部品推定だけを止める。

## Current Problem

`recordLlmUsage()` は `provider === 'codex' && usage.mode === 'measured'` の場合に `promptPartTokenEstimates` を破棄している。そのため Codex runtime が `stateCardTokens` や `userPromptTokens` を渡していても DB には保存されない。

Codex runtime は `stateCardTokens` と `userPromptTokens` は渡しているが、runtime contract 相当の `systemPromptTokens` を渡していない。

結果として、実際には State Card や runtime contract が prompt に含まれていても、`llm_usage_records.system_prompt_tokens` / `user_prompt_tokens` / `state_card_tokens` が 0 または null になり、prompt 消費要因の分析ができない。

## Non-Goals

- provider の `input_tokens` / `output_tokens` の意味を変えない。
- tokenizer 精度を provider 完全一致にするための重い tokenizer 導入はしない。
- 新しい usage record テーブルは作らない。
- prompt 本文全文を DB に保存しない。
- Project Detail / Overview の大きな UI 再設計はしない。

## Data Contract

既存の `llm_usage_records` カラムを使う。

- `input_tokens`: provider 実測
- `output_tokens`: provider 実測
- `cached_input_tokens`: provider 実測
- `reasoning_output_tokens`: provider 実測
- `total_tokens`: provider 実測から算出または provider 値
- `system_prompt_tokens`: NightWorkers 推定。Codex runtime では runtime contract 相当。
- `user_prompt_tokens`: NightWorkers 推定。Codex runtime では latest user request + state card を含む runtime user prompt 相当。
- `state_card_tokens`: NightWorkers 推定。State Card が prompt に含まれた場合のみ 0 より大きい。

`metadata_json` に観測の出自を残す。

```json
{
  "providerUsageSource": "codex_sdk_measured",
  "promptPartSource": "nightworkers_estimate",
  "runtimePromptShape": "request_plus_runtime_contract",
  "systemPromptMeaning": "runtime_contract_tokens",
  "promptPartObservabilityEnabled": true
}
```

## Setting Contract

設定キー案:

```ts
llmUsage: {
  promptPartObservabilityEnabled: boolean
}
```

デフォルト:

```ts
promptPartObservabilityEnabled: true
```

ON:

- prompt 部品推定を計算する。
- `recordLlmUsage()` に `promptPartTokenEstimates` を渡す。
- DB に `system_prompt_tokens` / `user_prompt_tokens` / `state_card_tokens` を保存する。

OFF:

- provider 実測 usage は保存する。
- prompt 部品推定は計算しない、または保存前に破棄する。
- DB の prompt 部品カラムは null のままにする。
- Project Detail / Overview では null を 0 として集計してよい。

## Performance Policy

- `estimateTokens()` は既存の軽量推定を使う。
- prompt 全文を追加保存しない。
- 既存の `llm_usage_records` に値を追加するだけで、record 数を増やさない。
- OFF 時は Codex runtime の prompt 部品 estimate をスキップする。
- Settings の読み取りは runtime 開始時または usage 記録時に 1 回へ寄せ、turn 内で繰り返し DB read しない。

## Implementation Tasks

### Task 1: Settings の保存モデルを確認して設定キーを追加する

Read first:

- `api/services/settings/general-settings.ts`
- `api/routes/settings-runtime.ts`
- `src/modules/settings/SettingsScreen.tsx`
- `src/modules/settings/SettingsGeneralPanel.tsx`
- `src/modules/settings/settingsCommands.ts`
- `src/modules/nightworkers/components/SettingsScreen.tsx`
- `src/modules/nightworkers/components/SettingsGeneralPanel.tsx`
- `tests/services.general-settings.test.ts`
- `tests/routes.settings-general.test.ts`

Change:

- general settings か runtime settings の既存パターンに合わせて `llmUsage.promptPartObservabilityEnabled` を追加する。
- 未設定時は `true` を返す default resolver を用意する。
- API response / update request の schema に追加する。
- `src/modules/settings/SettingsGeneralPanel.tsx` に toggle を追加する。
- `src/modules/nightworkers/components/SettingsGeneralPanel.tsx` が現行互換として残っている場合は同じ toggle を追加するか、実際に使われていないことを確認して変更対象から外す。

Acceptance:

- Settings 未保存でも API は `promptPartObservabilityEnabled: true` を返す。
- UI で ON/OFF を変更できる。
- 保存後に reload しても値が維持される。

Targeted tests:

- settings service の default test
- settings route の update/read test

### Task 2: `recordLlmUsage()` が Codex measured の prompt estimates を破棄しないようにする

Read first:

- `api/services/llm-usage/repository.ts`
- `api/services/llm-usage/types.ts`
- `tests/nightworkers-routes/routes-nightworkers-05.test.ts`
- `tests/services.codex-agent-runtime.test.ts`

Change:

- `resolveStoredPromptPartTokenEstimates()` の Codex measured 破棄ロジックを削除または設定 OFF 時だけ破棄する形に変更する。
- `recordLlmUsage()` input に `promptPartObservabilityEnabled?: boolean` を追加するか、呼び出し側で estimates を渡さない形にする。
- `usageMode` は provider measured + prompt estimate が混在する場合に `mixed` になる既存挙動を維持する。
- `llm.usage` activity payload に `systemPromptTokens` / `userPromptTokens` / `stateCardTokens` / `promptPartObservabilityEnabled` を含める。

Acceptance:

- Codex measured usage でも estimates が渡された場合は DB に保存される。
- OFF 相当の呼び出しでは prompt 部品カラムが null になる。
- provider 実測の `inputTokens` / `outputTokens` は変わらない。

Targeted tests:

- `recordLlmUsage()` unit test を追加する。
- Codex measured + estimates 保存ケース。
- Codex measured + observability disabled ケース。

### Task 3: Codex runtime prompt を部品化して system 相当 token を計測できるようにする

Read first:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/conversation-context/render.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `tests/services.codex-agent-runtime.test.ts`

Change:

- `buildCodexRuntimePrompt(context)` は互換維持のため残す。
- 新 helper `buildCodexRuntimePromptParts(context)` を追加する。
- return shape:

```ts
type CodexRuntimePromptParts = {
  prompt: string;
  request: string;
  runtimeContract: string;
  estimates: {
    requestTokens: number;
    runtimeContractTokens: number;
    fullPromptTokens: number;
  };
};
```

- `buildCodexRuntimePrompt(context)` は `buildCodexRuntimePromptParts(context).prompt` を返す。
- `runtimeContractTokens` を `systemPromptTokens` として使えるようにする。

Acceptance:

- 既存 prompt 文字列は変わらない。
- `runtimeContractTokens > 0` になる。
- request が空でも contract 分の token は計測される。

Targeted tests:

- prompt parts helper の unit test。
- old `buildCodexRuntimePrompt()` と new parts `.prompt` が一致すること。
- implementation / planning / general_answer の代表ケース。

### Task 4: Codex runtime usage recorder に prompt parts と設定を接続する

Read first:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-usage.ts`
- `api/services/agent-runtime/types.ts`
- runtime context を組み立てている orchestration service

Change:

- runtime 開始時に settings の `promptPartObservabilityEnabled` を context または runtime options に載せる。
- `CodexAgentRuntime` が `buildCodexRuntimePromptParts(context)` を使って prompt を実行する。
- `recordCodexRuntimeUsageIfPresent()` に `systemPromptTokens` を渡す。
- observability ON のときだけ estimates を作って `recordLlmUsage()` に渡す。
- observability OFF のときは estimates を渡さない。
- metadata に setting state と prompt part source を残す。

Acceptance:

- Codex runtime usage record に `systemPromptTokens` / `userPromptTokens` / `stateCardTokens` が入る。
- OFF の場合は provider usage だけが保存される。
- runtime prompt の中身は既存と同一。

Targeted tests:

- `tests/services.codex-agent-runtime.test.ts`
- ON: `usageRecorder` が `systemPromptTokens`, `userPromptTokens`, `stateCardTokens` を受け取る。
- OFF: `usageRecorder` に `promptPartTokenEstimates` が渡らない。
- prompt string は既存期待と一致する。

### Task 5: Native API runner との整合を確認する

Read first:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `tests/services.native-api-role-handoff.test.ts`
- Native API runner の usage tests

Change:

- Native API runner は既に `systemPromptTokens` / `userPromptTokens` / `stateCardTokens` を渡している。
- Settings OFF を Native API runner にも適用する。
- ON の既存挙動は維持する。

Acceptance:

- Native API runner でも ON/OFF が同じ意味になる。
- ON で既存 prompt estimates が保存される。
- OFF で prompt estimates が保存されない。

Targeted tests:

- Native API runner usage recorder test に ON/OFF ケースを追加する。

### Task 6: Overview / Project Detail の集計表示を確認する

Read first:

- `api/services/overview/index.ts`
- `api/modules/project-detail/project-detail.service.ts`
- `src/modules/nightworkers/components/OverviewScreen.tsx`
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`

Change:

- 既にカラムを集計している場合は最小変更に留める。
- null は 0 として集計する。
- Settings OFF の場合も UI が壊れないことを確認する。

Acceptance:

- ON の新規 usage record が Overview / Project Detail に反映される。
- OFF の record は prompt parts 0 として表示される。
- provider measured totals は常に表示される。

Targeted tests:

- Project Detail backend metrics test。
- Overview aggregation test があれば追加。

### Task 7: Migration 判断

Expected:

- 既存 DB に必要カラムがあるため migration は不要。

Verify:

- `api/db/schema.ts` に以下が存在する。
  - `systemPromptTokens`
  - `userPromptTokens`
  - `stateCardTokens`
- `api/db/bootstrap.ts` に対応カラムが存在する。

If missing:

- migration を追加する。
- migration 適用 test を追加する。

### Task 8: End-to-End Observation Smoke

Procedure:

1. Settings 未設定状態で API から default ON を確認する。
2. Codex runtime の fake turn completed usage で usage record を作る。
3. DB の `llm_usage_records` を確認する。
4. Settings OFF にする。
5. 同じ fake usage をもう一度記録する。
6. DB の prompt part columns が null または 0 集計になることを確認する。

Expected SQL checks:

```sql
select
  provider,
  label,
  input_tokens,
  output_tokens,
  system_prompt_tokens,
  user_prompt_tokens,
  state_card_tokens,
  json_extract(metadata_json, '$.promptPartObservabilityEnabled') as enabled
from llm_usage_records
where label = 'codex-runtime'
order by created_at desc
limit 5;
```

Acceptance:

- ON record: `system_prompt_tokens > 0`, `user_prompt_tokens > 0`, `state_card_tokens >= 0`
- State Card included case: `state_card_tokens > 0`
- OFF record: prompt part columns are null, provider measured tokens are present

## Verification Commands

Run targeted tests first:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts
bunx vitest run tests/nightworkers-routes/routes-nightworkers-05.test.ts
bunx vitest run tests/project-detail-backend.test.ts
```

Then full gate:

```bash
bun run verify
```

## Stop Conditions

- Settings の default ON が確認できない。
- OFF でも prompt estimates が保存される。
- ON でも Codex runtime の `system_prompt_tokens` が 0/null のまま。
- provider measured `input_tokens` / `output_tokens` が欠落する。
- runtime prompt 文字列が既存から意図せず変わる。
- `bun run verify` が今回変更起因で失敗する。

## Done Definition

- Settings で prompt usage observability を ON/OFF できる。
- 未設定時は ON。
- Codex runtime measured usage でも `system_prompt_tokens` / `user_prompt_tokens` / `state_card_tokens` が保存される。
- OFF では prompt part estimates が保存されない。
- Provider measured usage は ON/OFF に関係なく保存される。
- Project Detail / Overview で prompt parts が集計できる。
- Targeted tests と `bun run verify` が通る。
