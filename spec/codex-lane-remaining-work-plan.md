# Codex レーン残課題 実装計画

## 1. 目的

Codex レーン P0 完了後に残っている課題を、既存ロジックを壊しにくい順に整理する。

この計画では、P0 で入った runtime contract audit、Todo evidence、MCP surface drift 防止、contract warning aggregation は完了済みとして扱う。

中リスク以上になりやすい項目は、低リスク化した実装形に限定して戻す。

- Minimal Implementation Run は codex-agent lane 限定、既存 gate 維持、native lane 非変更にする。
- warning code catalog は参照専用から始め、runtime behavior を切り替えない。
- MCP diagnostics は non-blocking の記録・表示に限定し、preflight で run 開始を止めない。

引き続き、Project root empty / near-empty 判定による terminal policy 補強、contract warning 専用 table、global MCP allowlist / denylist、blocking MCP preflight は対象外にする。

## 2. 現状

完了済み:

- import_project 成功後 verification evidence の時系列判定
- file_change と DB current Todo の紐付け
- `CodexContractWarning.severity` の ledger 反映
- import_project 未成功 native import command の terminal policy
- NightWorkers MCP tool list の manifest source of truth 化
- contract warning の `sequence` / `occurredAt` / `count` 集約

この計画で扱うもの:

- Minimal Implementation Run の低リスク安定化
- `recommendedVerificationCommands` の warning-only 照合
- Todo evidence DB read failure の warning-only 記録
- contract warning の UI 表示
- Live LLM E2E の evidence contract 分離
- warning code catalog の参照専用導入
- MCP diagnostics の non-blocking 表示・記録

この計画から外すもの:

- Project root empty / near-empty 判定による native import terminal policy 補強
- contract warning 専用 table
- global MCP tool allowlist / denylist
- MCP availability preflight による run 開始ブロック

## 3. 実装順

```text
R1 Minimal Implementation Run を低リスクに安定化する
R2 recommendedVerificationCommands の照合を warning-only で強める
R3 Todo evidence DB read failure を warning-only で記録する
R4 contract warning を UI で見える化する
R5 Live LLM E2E を evidence contract として分離する
R6 warning code catalog を参照専用で導入する
R7 MCP diagnostics を non-blocking で表示・記録する
```

## 4. R1 Minimal Implementation Run を低リスクに安定化する

### 目的

Codex レーンで、小さい修正が不要に plan-only / heavy Todo へ寄る問題を抑える。

### 低リスク化方針

次を守る。

- codex-agent lane のみに限定する。
- native Supervisor lane の初期 Todo は変えない。
- `buildStandardImplementationTodoList(...)` の first gates / review / quality gate / knowledge / final report は維持する。
- `IMPLEMENTATION_PHASE_PREAMBLE` のような native lane と共有される文言は変えない。
- 明示的な planning / specification / implementation-plan 要求は引き続き尊重する。
- terminal policy、contract warning policy、MCP surface は変えない。
- DB schema / migration は追加しない。

### 実装

対象:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/nightworkers-service/services-nightworkers-01.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`
- `spec/codex-lane-minimal-implementation-run-plan.md`

作業:

- codex-agent lane 用の軽量初期 Todo builder を使う。
- native lane は既存 `buildInitialRunTodos(...)` のままにする。
- Codex runtime contract に minimal implementation behavior を追加する。
- `nightworkers.read_current_specification` は、明示 planning/spec work または既存仕様が source of truth の場合に使う文言へ狭める。
- `spec/codex-lane-minimal-implementation-run-plan.md` のチェックリストを実装済み状態に更新する。

### テスト

- codex-agent lane では軽量 Todo が作られる。
- native lane では従来 Todo が維持される。
- codex-agent lane でも review / quality gate / knowledge / final report gate が残る。
- prompt に minimal implementation behavior が入る。
- prompt が 明示 planning / specification 要求を否定しない。

### 完了条件

- 小さい Codex 実装で plan-only に寄りにくい。
- native lane の Todo と実行契約は変わらない。
- Codex lane の review / verify / closeout gate が残る。

## 5. R2 recommendedVerificationCommands の照合を warning-only で強める

### 目的

import_project 後の verification evidence を「何か成功した」から「推奨 verification に対応する成功がある」へ近づける。

### 現状

`recommendedVerificationCommands` がある場合でも、import 後に `verification` または `broad_verification` classified command が exit code 0 なら missing warning は消える。

### 低リスク化方針

P1 では hard gate にしない。warning precision を上げるだけに留める。

次は変更しない。

- `terminalState`
- `stoppedBy`
- `riskLevel`
- Todo closeout guard
- import_project failure / cancelled hard gate

### 実装

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `CodexRuntimeAuditState.verificationEvidence` に `normalizedCommand` を追加する。
- `recommendedVerificationCommands` も normalization する。
- まずは exact normalized match を優先する。
- 次に package-manager equivalent を許容する。
  - `npm run test` / `pnpm test` / `bun test` は同一扱いにしない。
  - `bun run verify:base` と `bun verify:base` のような同一 runner 内 shorthand だけ許容する。
- import 後 verification 成功があるが recommended command と対応しない場合、次を warning する。
  - `codex_import_project_recommended_verification_mismatch`
  - severity: `warning`
  - terminal state は変えない。

### テスト

- recommended `bun run verify:base` と同じ command 成功で warning なし。
- import 後 `bun run typecheck` 成功だけでは mismatch warning が出る。
- recommended command が複数ある場合、少なくとも 1 つ成功すれば P1 では warning なし。
- recommended command が空の場合は従来通り warning なし。

### 完了条件

- post-import verification が recommended verification と対応しているか判定できる。
- 誤検出時も run completion は止めない。

## 6. R3 Todo evidence DB read failure を warning-only で記録する

### 目的

file_change と Todo evidence の紐付けで DB read に失敗した場合を観測可能にする。

### 現状

DB read に失敗した場合、runtime context fallback を使う。fallback 自体は安全だが、DB read failure は記録されない。

### 低リスク化方針

この変更は warning-only とし、fallback behavior は維持する。

次は変更しない。

- DB read 成功時の Todo evidence
- DB read 成功かつ running Todo なしの場合に stale context へ fallback しない挙動
- terminal policy

### 実装

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `readCurrentTodoEvidence(...)` を result object にする。
  - `{ todo: RuntimeTodoEvidence | null; source: 'db' | 'context' | 'none'; dbReadFailed: boolean }`
- DB read failure かつ file_change が発生した場合:
  - `codex_todo_evidence_db_read_failed`
  - severity: `warning`
  - terminal state は変えない。
- context fallback を使った場合は warning payload に fallback source を入れる。

### テスト

- DB read throw で context fallback した場合、warning が出る。
- DB read 成功時は warning が出ない。
- DB read 成功かつ running Todo なしの場合は stale context に fallback しない。

### 完了条件

- Todo evidence が DB 由来か fallback 由来か追える。

## 7. R4 contract warning を UI で見える化する

### 目的

`contextSnapshot.codexContract.warnings` と run event `system.warning` を UI で確認しやすくする。

### 低リスク化方針

- runtime / DB / terminal policy は変えない。
- selector で read-only に集計する。
- UI 表示は badge / list に留め、操作によって run 状態を変えない。

### 実装

対象候補:

- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/components/ThreadWorkspaceBanner.tsx`
- `src/modules/nightworkers/components/ThreadTimeline*.tsx`
- `src/modules/nightworkers/workbenchSelectors.ts`
- i18n dictionaries

表示案:

- active run / latest run に contract warning badge を出す。
- warning count と error count を表示する。
- click で timeline 内の `system.warning` に移動、または artifact pane で warning list を表示する。
- warning item には以下を表示する。
  - code
  - severity
  - count
  - changedFiles
  - command
  - occurredAt

### テスト

- selector が `contextSnapshot.codexContract.warnings` から count を作る。
- UI が warning badge を出す。
- count aggregation が UI に反映される。

### 完了条件

- run 完了後に、Codex contract warning を DB / log を見ずに UI から確認できる。

## 8. R5 Live LLM E2E を evidence contract として分離する

### 目的

Live LLM E2E を通常 verify と混ぜず、Codex lane の実挙動証跡として扱う。

### 低リスク化方針

- 通常 `bun run verify` には混ぜない。
- live test は opt-in にする。
- 判定は DB / event / log evidence を読むだけにする。
- production runtime policy は変えない。

### 実装

既存 `spec/live-llm-e2e-verification-plan.md` を更新または追記する。

確認する evidence:

- `nightworkers.todo_list operation=replace` が行われた。
- file_change が current Todo に紐付いた。
- import_project が必要なタスクでは import_project が使われた。
- import_project 後に recommended verification が実行された。
- contract warning が期待通り出る、または出ない。
- final status が Todo state と一致する。

### 検証

Live LLM E2E は通常の `bun run verify` には混ぜない。

専用 command または手順で実行する。

```bash
bunx vitest run <live llm e2e test file>
```

または、手動 run の DB / event / log evidence を読む。

### 完了条件

- Codex lane の実 LLM run を、通常 unit/integration verify とは別の証跡で評価できる。

## 9. R6 warning code catalog を参照専用で導入する

### 目的

warning code が増えてきたため、code、default severity、説明、将来の terminal policy を一箇所で見られるようにする。

### 低リスク化方針

初回 PR では参照専用にする。

次は変更しない。

- warning 生成箇所
- default severity の適用ロジック
- `resolveCodexTerminalPolicy(...)`
- ledger severity
- terminal state

### 実装

対象:

- `api/services/agent-runtime/codex-contract-warning-catalog.ts` 新規
- `tests/services.codex-agent-runtime.test.ts`

内容:

```ts
export const CODEX_CONTRACT_WARNING_CATALOG = {
  codex_import_project_verification_missing: {
    defaultSeverity: 'warning',
    terminalPolicy: 'none',
    description: '...',
  },
  codex_native_import_without_import_project: {
    defaultSeverity: 'error',
    terminalPolicy: 'needs_human',
    description: '...',
  },
} as const;
```

runtime はこの catalog を参照しない。まずは catalog と test のみを追加する。

### テスト

- runtime test で現在発生する warning code が catalog に存在することを検証する。
- catalog 側に存在しない warning code が増えた場合、テストで検出する。
- catalog の terminal policy は informational とし、runtime policy と接続しない。

### 完了条件

- warning code の一覧性が上がる。
- runtime behavior は変更されない。

## 10. R7 MCP diagnostics を non-blocking で表示・記録する

### 目的

NightWorkers MCP の inline/global/observed/degraded 状態を、DB や raw event を読まずに確認しやすくする。

### 低リスク化方針

- MCP preflight はしない。
- run 開始を止めない。
- global MCP 継承を禁止しない。
- allowlist / denylist は導入しない。
- 既存の `codexContract.mcp` snapshot と run events から read-only に表示する。

### 実装

対象候補:

- `src/modules/nightworkers/workbenchSelectors.ts`
- `src/modules/nightworkers/components/ThreadWorkspaceBanner.tsx`
- `src/modules/nightworkers/components/ThreadTimeline*.tsx`
- i18n dictionaries

表示案:

- latest run に MCP diagnostics summary を出す。
  - `inline_configured`
  - `global_inherited`
  - `disabled`
  - `observedNightWorkersTools`
  - `degraded`
- degraded の場合だけ warning tone で表示する。
- global inherited は warning ではなく info として表示する。

### テスト

- selector が `contextSnapshot.codexContract.mcp` から summary を作る。
- `global_inherited` は error / warning 扱いにしない。
- `degraded: true` の場合だけ warning tone になる。

### 完了条件

- MCP の状態を UI から確認できる。
- run 開始条件や MCP surface は変わらない。

## 11. 計画から外した項目

中リスク以上として、この計画から外す。

### 11.1 Project root empty / near-empty と native import policy 補強

理由:

- terminal policy に触る。
- repo root 判定を誤ると正当な補助 clone / fixture 取得を `needs_human` に倒す可能性がある。

### 11.2 contract warning 専用 table

理由:

- DB migration を伴う。
- JSON / run event で足りる段階では不要。

### 11.3 global MCP tool allowlist / denylist

理由:

- global MCP 継承前提に影響する。
- 現状は warning 観測と diagnostics 表示で十分。

### 11.4 blocking MCP availability preflight

理由:

- runtime 起動条件を変え得る。
- global inherited 環境で誤停止する可能性がある。

## 12. 推奨 PR 分割

### PR 1: Minimal Implementation Run 安定化

含める:

- R1 Minimal Implementation Run
- `spec/codex-lane-minimal-implementation-run-plan.md` のチェックリスト更新

理由:

- codex-agent lane の体感品質に直結する。
- native lane 非変更をテストで固定する。

### PR 2: Verification warning precision

含める:

- R2 recommendedVerificationCommands 照合
- R3 Todo evidence DB read failure warning

理由:

- どちらも evidence の精度改善で、terminal policy を変えない。

### PR 3: Warning visibility

含める:

- R4 warning UI
- R6 warning catalog 参照専用
- R7 MCP diagnostics

理由:

- いずれも read-only visibility の改善で、runtime behavior を変えない。

### PR 4: Live LLM E2E

含める:

- R5 evidence contract
- 専用 live verification 手順

## 13. 検証の基本セット

各 PR の最小検証:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.agent-runtime.test.ts tests/nightworkers-service/services-nightworkers-01.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
bun run typecheck
bun run lint
```

UI を触る PR:

```bash
bunx vitest run tests/nightworkers.workbench-selectors.test.ts tests/thread-workspace-header.test.ts tests/thread-workspace-pending-indicator.test.tsx
bun run build:frontend
```

API / runtime を触る PR:

```bash
bun run build:backend
```

広域確認が必要な場合:

```bash
bun run verify:base
```

## 14. 非目標

- P1 で DB migration を追加しない。
- P1 で NightWorkers MCP tool を増やさない。
- P1 で global MCP 継承を禁止しない。
- P1 で native Supervisor Round 1 / Round 2 を作り替えない。
- P1 で terminal policy を変更しない。
- Project root empty / near-empty 判定で hard gate を追加しない。
- warning catalog を runtime behavior の source of truth にしない。
- MCP diagnostics を run 開始条件にしない。
- Live LLM E2E を通常 verify に混ぜない。
