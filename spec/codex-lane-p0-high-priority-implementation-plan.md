# Codex レーン P0 高優先実装計画

## 1. 目的

Codex レーンの現行 P0 実装を前提に、まだ実装基板として弱い箇所を高優先順に潰す。

この計画は、既存の `spec/codex-lane-p0-refactoring-plan.md` の続きとして扱う。初期 P0 で入った `runtime_warning`、`CodexContractWarning`、MCP config source snapshot、open Todo finalization guard、`import_project` failure hard gate は前提にし、残課題だけを実装対象にする。

## 2. 前提

- Codex レーンだけを対象にする。
- global Codex MCP 継承は維持する。
- `NIGHTWORKERS_CODEX_MCP_COMMAND` 未設定時に global MCP を無効化しない。
- P0 では新規 DB migration を追加しない。
- P0 では NightWorkers MCP tool を増やさない。
- 既存 event stream、run event、`task_runs.contextSnapshot`、Todo repository を使う。
- provider / llm-provider 側に Codex レーン固有の実行判断を移さない。

## 3. 現状の到達点

現行コードで既に入っているもの:

- `CodexContractWarning`
- `runtime_warning`
- `AgentRuntimeResult.contractWarnings`
- `runtime_finished.payload.contractWarnings`
- `contextSnapshot.codexContract.warnings`
- `codex_mcp_degraded`
- `codex_global_mcp_tool_observed`
- `codex_file_change_before_todo_replace`
- `codex_file_change_without_current_todo`
- `codex_import_project_verification_missing`
- `codex_open_todos_before_completion`
- `inline_configured | global_inherited | disabled` の MCP config source
- `import_project` failed / cancelled の hard gate

残る P0 は、主に「証跡の精度」と「warning の政策判断」である。

## 4. 実装順位

```text
P0-1 post-import verification evidence を時系列で正しく判定する
P0-2 file_change と current Todo の紐付けを DB 優先にする
P0-3 CodexContractWarning severity を ledger に反映する
P0-4 高リスク native import command を terminal policy に反映する
P0-5 MCP / prompt / expectedTools の単一 source of truth 化を強める
P0-6 contract warning の復元性と集約性を上げる
```

## 4.1 実装直前レビュー結果

この計画は、P0-1、P0-2、P0-5 はすぐ実装に移れる。

P0-3 と P0-4 は、実装責務を次のように固定してから着手する。

- warning の保存時 severity は `ledger-sink` が決める。
- warning による terminal state 変更は、原則として `CodexAgentRuntime` 内で決める。
- `nightworkers.run-orchestration.service.ts` は runtime result と `contractWarnings` を保存し、既存の open Todo guard だけを追加で見る。
- orchestration 側で Codex 固有 warning code を読み直して outcome を推測しない。

理由:

- Codex event の時系列、import 成功有無、native command 分類は `CodexAgentRuntime` が最も正確に持っている。
- orchestration 側に Codex 固有 policy を増やすと、provider / runtime lane の境界が崩れる。
- 既存の `import_project` failure / cancelled は runtime 内で即停止しており、同一 stream 内の「failure 後 fallback command」を後から観測する設計にはしない。

よって、実装可能性の判定は次の通り。

- PR A は即着手可能。
- PR B はこの文書の P0-3 / P0-4 の責務整理に従えば即着手可能。
- PR C は PR A / PR B 後に着手するのが安全。

## 5. P0-1 post-import verification evidence を時系列で正しく判定する

### 問題

現状は successful verification command を一度でも見たら `verificationEvidenceSeen = true` になる。

そのため、`nightworkers.import_project` 成功前に実行された test / build が成功していた場合でも、import 後の manifest-based verification が不要と誤判定される可能性がある。

### 方針

`verificationEvidenceSeen` を単一 boolean として扱わず、import 成功後の verification だけを evidence として扱う。

### 実装

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `CodexRuntimeAuditState` に次を追加する。
  - `eventSequence: number`
  - `importProjectSuccessSequence: number | null`
  - `postImportVerificationEvidenceSeen: boolean`
  - `verificationEvidence: Array<{ sequence: number; command: string | null; commandClass: string | null; exitCode: number | null }>`
- `auditMappedEvent(...)` の先頭で sequence を進める。
- `command_execution` 成功時は `verificationEvidence` に記録する。
- `postImportVerificationEvidenceSeen` は、次の条件を満たす場合だけ true にする。
  - `importProjectSuccessSequence !== null`
  - `command_event.sequence > importProjectSuccessSequence`
  - `commandClass === 'verification' || commandClass === 'broad_verification'`
  - `exitCode === 0`
- `emitMissingImportVerificationWarningIfNeeded(...)` は `postImportVerificationEvidenceSeen` を見る。
- import 成功時に過去の verification 成功は持ち越さない。

### テスト

追加:

- import 前 verification 成功、import 後 verification なしの場合、`codex_import_project_verification_missing` が出る。
- import 後 verification 成功の場合、`codex_import_project_verification_missing` が出ない。
- import 後 verification 失敗の場合、missing warning は出る。
- import payload に recommended commands がない場合、missing warning は出ない。

### 完了条件

- pre-import test 成功では post-import verification missing が抑制されない。
- post-import verification 成功だけが completion evidence になる。

## 6. P0-2 file_change と current Todo の紐付けを DB 優先にする

### 問題

`readCurrentTodoEvidence(...)` が `context.currentTodo` / `context.todoPlan` を DB より先に見ると、run 開始時点の stale Todo を file change に紐付ける可能性がある。

`nightworkers.todo_list operation=done` によって次 Todo が auto-start した後は、DB の running Todo が source of truth である。

### 方針

runtime 中の evidence は DB を優先する。`context.currentTodo` と `context.todoPlan` は DB 読み取りに失敗した場合の fallback に限定する。

### 実装

対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `readCurrentTodoEvidence(...)` の順序を変更する。
  1. `repo.listTaskRunTodosForRun(context.runId)`
  2. DB に running Todo があれば最小 seq を返す。
  3. DB 読み取りに失敗した場合だけ `context.currentTodo` を見る。
  4. それもなければ `context.todoPlan` を見る。
- DB が読めたが running Todo がない場合は null を返す。
  - この場合、古い context fallback は使わない。
  - 理由: DB が読めているなら DB が正。
- DB 読み取り失敗時は、将来 P1 で `codex_todo_evidence_db_read_failed` warning を検討する。P0 では fallback のみでよい。

### テスト

追加:

- context 上は Todo #1 running、DB 上は Todo #2 running の場合、file_change に Todo #2 が付く。
- DB 上に running Todo がない場合、context に古い running Todo があっても `codex_file_change_without_current_todo` が出る。
- DB 読み取りが throw した場合だけ context fallback が使われる。

### 完了条件

- file_change evidence が runtime 中の実 Todo 状態と一致する。
- stale context による誤った Todo 紐付けが起きない。

## 7. P0-3 CodexContractWarning severity を ledger に反映する

### 問題

`CodexContractWarning` は `info | warning | error` を持つが、ledger では `runtime_warning` が常に severity `warning` として保存される。

このままだと `severity: error` の warning が UI / 集計で弱く見える。

### 方針

event type は `runtime_warning` のままにし、payload severity を ledger severity に反映する。canonical type は P0 では `system.warning` のまま維持する。

terminal state の変更は P0-4 で扱う。P0-3 では保存時 severity だけを直す。

### 実装

対象:

- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.agent-runtime.test.ts`

変更案:

- `ledger-sink` に `resolveEventSeverity(event, mapped)` を追加する。
- `event.type === 'runtime_warning'` かつ payload severity が `info | warning | error` の場合、run event severity に反映する。
- `system.warning` canonical type は維持する。
- payload severity が不正な場合は既存 mapping の severity を使う。
- `runtime_warning` 以外の event は既存 mapping を変えない。

### テスト

追加:

- `runtime_warning` payload severity `error` が run event severity `error` で保存される。
- `runtime_warning` payload severity `info` が run event severity `info` で保存される。
- severity `warning` は従来通り warning。
- payload severity が不正な場合は warning で保存される。

### 完了条件

- warning の重大度が保存時に失われない。
- terminal state はこの PR では変わらない。

## 8. P0-4 高リスク native import command を terminal policy に反映する

### 問題

Codex native `command_execution` は観測できるが、`git clone` や starter import 代替のような高リスク command も基本は warning に留まる。

`nightworkers.import_project` が存在するタスクで shell fallback が走ると、NightWorkers 管理の import lifecycle、manifest、postImport context、verification recommendation が欠落する。

なお、現行 runtime は `nightworkers.import_project` failure / cancelled を検出した時点で即 `finishRun(...)` する。そのため、P0 では「failure 後の同一 stream 内 fallback command」を主経路として扱わない。

### 方針

高リスク native import command を warning として記録し、`nightworkers.import_project` 成功がないまま run が終わる場合は terminal state を `needs_human` に倒す。

`nightworkers.import_project` failure / cancelled は既存の即停止 hard gate を維持する。

### 実装

対象:

- `api/services/agent-runtime/codex-event-mapper.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `classifyCodexCommand(...)` の分類を維持しつつ、runtime audit 側で high risk 判定を追加する。
- 新 warning code を追加する。
  - `codex_high_risk_native_import_command`
  - `codex_native_import_without_import_project`
- `CodexRuntimeAuditState` に次を追加する。
  - `sawHighRiskNativeImportCommand: boolean`
  - `highRiskNativeImportCommand: string | null`
  - `highRiskNativeImportProviderItemId: string | null`
- `commandClass === 'git_clone_or_import'` の `command_execution` を見たら、`codex_high_risk_native_import_command` を `severity: error` で emit する。
- normal finish 前に `resolveCodexTerminalPolicy(auditState, terminalState, stoppedBy, riskLevel)` を通す。
- 次の条件を満たす場合、terminal state を上書きする。
  - `sawHighRiskNativeImportCommand === true`
  - `sawNightworkersImportProjectSuccess === false`
  - 現在の `terminalState === 'completed'`
- 上書き値:
  - `terminalState: 'needs_human'`
  - `stoppedBy: 'tool_failure'`
  - `riskLevel: 'high'`
  - final report に `codex_native_import_without_import_project` を追記する。
- P0 では `AgentRuntimeResult.stoppedBy` の union は増やさない。
- `nightworkers.import_project` success 後の native import command は P0 では hard gate しない。
  - 例: import 後に nested fixture を clone するようなケースを過剰に止めないため。
- Project root empty / near-empty 判定は P0 では実装しない。

### テスト

追加:

- import_project 未成功のまま `git clone` 相当 command が出て run が completed になりそうな場合、terminal state が `needs_human` になる。
- import_project 成功後の `git clone` 相当 command は `codex_high_risk_native_import_command` warning だけに留まり、terminal state は変えない。
- 通常 verification command は native import hard gate にならない。
- import_project failure / cancelled は既存通り、その場で `needs_human` または `cancelled` になる。

### 完了条件

- import_project を使わない native import が完了扱いにならない。
- import_project failure / cancelled の即停止挙動が維持される。
- 通常の test / build command は過剰に止めない。

## 9. P0-5 MCP / prompt / expectedTools の単一 source of truth 化を強める

### 問題

期待する NightWorkers MCP tool は manifest、prompt、runtime audit の複数箇所に現れる。

現状は揃っているが、今後 tool を追加または削除したときに prompt だけが drift する可能性がある。

### 方針

`nightWorkersCodexToolManifest` を source of truth とし、expected tools と prompt 表示をそこから生成する。

### 実装

対象:

- `api/mcp/nightworkers-tool-manifest.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-runtime-config.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `getNightWorkersCodexToolNames()` helper を manifest 側に追加する。
- `resolveCodexRuntimeMcpConfigState(...)` は helper を使う。
- `buildCodexRuntimePrompt(...)` も helper を使って tool list を作る。
- `NIGHTWORKERS_EXPECTED_CODEX_TOOLS` は runtime 側の固定 Set ではなく helper 由来にする。
- prompt test は tool list の literal 全体ではなく、helper と同じ内容であることを検証する。

### テスト

追加:

- manifest tool list と prompt tool list が一致する。
- manifest tool list と MCP config expectedTools が一致する。
- unexpected NightWorkers MCP tool warning は helper に含まれない tool で出る。

### 完了条件

- NightWorkers Codex MCP surface の drift が test で検出できる。

## 10. P0-6 contract warning の復元性と集約性を上げる

### 問題

`contractWarnings` は result と contextSnapshot に入るが、発生順、発生時刻、集約 count がない。

同じ code が繰り返し出た場合、dedupe によって run の荒れ方が見えにくくなる可能性がある。

### 方針

P0 では DB schema を変えず、warning payload を少し強くする。

### 実装

対象:

- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `tests/services.codex-agent-runtime.test.ts`

変更案:

- `CodexContractWarning` に optional field を追加する。
  - `sequence?: number`
  - `occurredAt?: string`
  - `count?: number`
- `toContractWarningEvent(...)` で sequence と occurredAt を付ける。
- dedupe 時に完全削除するのではなく、同一 key の `count` を増やす。
- `changedFiles` がある warning は file list が違えば別 warning として残す。
- `runtime_finished.payload.codexContract.warnings` は集約後 warning を入れる。

### テスト

追加:

- 同じ warning が複数回出た場合、contextSnapshot 側で `count` が増える。
- changedFiles が違う warning は別 warning として残る。
- warning に sequence が入り、発生順で sort できる。

### 完了条件

- run 後に warning の種類だけでなく頻度と順序を追える。

## 11. 推奨 PR 分割

### PR A: evidence 精度

含める:

- P0-1 post-import verification evidence
- P0-2 current Todo DB 優先

理由:

- どちらも「証跡の誤結合」を防ぐ変更で、リスクが近い。
- Codex runtime 内の変更と runtime test で閉じやすい。

検証:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts
```

### PR B: warning severity と terminal policy

含める:

- P0-3 severity 反映
- P0-4 high risk native import command

理由:

- warning の保存時 severity を正しくし、高リスク native import だけを terminal policy に使う変更。
- run outcome に触れるため PR A より慎重に分ける。

検証:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.agent-runtime.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### PR C: drift 防止と復元性

含める:

- P0-5 MCP / prompt / expectedTools source of truth
- P0-6 warning aggregation

理由:

- 今後の保守性と診断性を上げる変更。
- 直接 outcome を変える変更ではないため、PR B の後に回せる。

検証:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.agent-runtime.test.ts
```

## 12. 最短でやる場合の実装順

最短で効果を出すなら、次の 4 つだけ先に実装する。

1. import 後 verification の時系列判定
2. current Todo DB 優先
3. `runtime_warning` severity の ledger 反映
4. import_project 未成功 native import command の terminal policy

この 4 つが入ると、次の誤完了を防げる。

- import 前 test 成功を import 後 verification と誤認する。
- stale Todo に file change を紐付ける。
- error-level contract warning が warning として埋もれる。
- import_project を使わない shell import で完了扱いになる。

## 13. P0 完了条件

P0 高優先の完了条件:

- import_project 成功後の verification evidence は、import 成功後の command だけで判定される。
- file_change は DB 上の current Todo に紐付く。
- DB 上に current Todo がなければ、古い context に逃げず warning になる。
- `CodexContractWarning.severity` が run event severity に反映される。
- import_project 未成功の native import command は完了扱いにならない。
- prompt、expectedTools、MCP approval config の tool list が manifest と同期している。
- contract warning は run 後に発生順と頻度を追える。

## 14. 非 P0 へ送るもの

次は重要だが、P0 ではやらない。

- Project root empty / near-empty 判定による import_project 未使用 hard gate
- verification command と `recommendedVerificationCommands` の厳密一致
- warning code enum の全面整理
- UI 側での warning badge / warning timeline 表示
- contract warning 専用 DB table
- global MCP tool allowlist / denylist の管理 UI
- MCP preflight による tool availability の能動確認
