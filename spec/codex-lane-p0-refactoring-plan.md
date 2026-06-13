# Codex レーン P0 リファクタリング計画

## 1. 目的

NightWorkers の Codex レーンで、global Codex MCP 設定を継承する前提を維持しつつ、NightWorkers の実行契約から外れた挙動を検出・記録・必要に応じて停止できるようにする。

この計画は、Codex レーンだけを対象にする。native-local supervisor loop の Todo 実装や worker tool registry 全体の整理は対象外にする。

## 2. 前提

- Codex レーンは `CodexAgentRuntime` を使う。
- Codex の作業ディレクトリは Project repo root である。
- Codex runtime は `workspace-write`、`approvalPolicy=never`、network disabled で動く。
- `NIGHTWORKERS_CODEX_MCP_COMMAND` がある場合は inline NightWorkers MCP config を渡す。
- `NIGHTWORKERS_CODEX_MCP_COMMAND` がない場合、global Codex MCP 設定の継承は許容する。
- global MCP 継承を止める方針は、この計画では採らない。
- Codex レーンで NightWorkers が期待する MCP tool は、現時点では次の4つである。
  - `nightworkers.read_current_specification`
  - `nightworkers.list_recent_specifications`
  - `nightworkers.todo_list`
  - `nightworkers.import_project`
- `run_command` / `run_verification` は Codex レーンの NightWorkers MCP tool ではない。Codex native `command_execution` として観測される可能性を扱う。

## 3. 現状

### 3.1 すでに良い状態

- `api/services/agent-runtime/codex-runtime-config.ts`
  - Codex runtime は repo root を `workingDirectory` にする。
  - network と web search を無効にしている。
  - inline NightWorkers MCP command がある場合、NightWorkers MCP server と tool approval config を渡す。
- `api/mcp/nightworkers-tool-manifest.ts`
  - Codex 向け NightWorkers MCP surface は4 tool に絞られている。
- `api/services/agent-runtime/CodexAgentRuntime.ts`
  - `buildCodexRuntimePrompt(...)` に NightWorkers runtime contract がある。
  - `nightworkers.import_project` の failed / cancelled を特別扱いし、失敗後に fallback 実装へ進まず停止する経路がある。
- `api/services/todo-runtime/todo-list-builder.ts`
  - TodoList は first gates、implementation todos、final gates に分かれる。
  - final gates は `review`、`quality_gate_verify`、`contextstill.register_candidates`、`final_completion_report` に分かれている。
- `api/services/agent-runtime/ledger-sink.ts`
  - `context-still.initial_instructions`、`context-still.context_compile`、`context-still.register_candidates` を gate Todo に反映できる。
  - broad verify command を quality gate Todo に反映する入口がある。
  - 最終 assistant message で `final_completion_report` を自動完了できる。
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
  - runtime 終了後に DB の open Todo を再確認し、open Todo が残る completed run を `needs_human` に落とす guard がある。

### 3.2 残っている問題

- Codex runtime prompt に `run_command` / `run_verification` 風の表現が残っており、Codex レーンの MCP surface と文言が一致していない。
- Codex native `file_change` が Todo 計画前に発生した場合の contract warning がない。
- `file_change` や `command_execution` が現在の Todo と紐づかず、後続 review / closeout の evidence として弱い。
- Codex native `command_execution` の分類がない。
- `import_project` 成功後に manifest-based verification evidence が十分かどうかを、Codex レーンの event から判断する gate が弱い。
- NightWorkers MCP が inline configured なのか global inherited なのか、実行中に観測されたのか、degraded なのかを run event として追いにくい。
- contract warning を run outcome や context snapshot に残す統一形式がない。

## 4. 非目標

- global Codex MCP 継承を禁止しない。
- Codex 標準 tool を NightWorkers MCP で再エクスポートしない。
- `run_command` / `run_verification` を P0 で NightWorkers MCP に追加しない。
- native-local supervisor loop の Todo 実装をこの計画では直さない。
- contextStill 専用 client / repository / schema / fallback を NightWorkers 側に追加しない。
- Codex native command / file change を全面禁止しない。

## 5. 設計方針

### 5.1 閉じるのではなく、観測して gate する

global MCP 継承を残すため、Codex に見える tool surface を完全には NightWorkers 側で固定できない。

そのため、Codex レーンの品質は次で守る。

- runtime prompt の tool 契約を正確にする。
- event stream から NightWorkers MCP、global MCP、Codex native activity を区別する。
- 契約違反や危険な代替実装を contract warning として記録する。
- import failure 後 fallback や open Todo completion など、危険度が高いものは hard gate にする。

### 5.2 P0 は runtime event 監査を中心にする

P0 では MCP tool を増やさない。まずは既存 event stream から判断できることを増やす。

主な入力は `CodexAgentRuntime` が受け取る mapped event である。

- `tool_call_finished`
- `tool_call_progress`
- `diff_collected`
- `model_response_finished`
- `runtime_error`

### 5.3 warning と hard gate を分ける

初期から何でも停止すると、Codex レーンが過剰に止まる。

次は warning から始める。

- Todo replace 前の file change
- NightWorkers 以外の MCP tool call
- Codex native command execution
- verification evidence が弱い run

次は hard gate にする。

- `nightworkers.import_project` failed / cancelled 後の fallback 実装
- completed 扱いの runtime result に open Todo が残る
- NightWorkers MCP degraded 中の repository write 相当 activity

## 6. 実装順位

前回の P0 実装順位に合わせ、次の順で進める。

```text
1. prompt / tool surface drift 修正
2. Todo 未使用 file_change warning と Todo evidence 紐づけ
3. import_project failure 後 fallback hard gate の明文化と補強
4. open Todo finalization guard と Codex warning の連動
5. native command 分類と manifest-based verification gate
6. MCP configured / inherited / observed / degraded の記録
```

## 6.1 実装可否レビュー

現行コードから P0 実装はすぐ着手可能である。ただし、PR 2 の warning event と永続化の受け口は曖昧に残すと手戻りになるため、次の方針で固定する。

- `AgentRuntimeEvent` に `runtime_warning` を追加する。
- `runtime_warning` は `ledger-sink` で canonical `system.warning`、actor `system`、severity `warning` に map する。
- warning payload は `CodexContractWarning` に寄せる。
- `AgentRuntimeResult` に `contractWarnings?: CodexContractWarning[]` を追加する。
- `CodexAgentRuntime.finishRun(...)` は accumulated warnings を `AgentRuntimeResult.contractWarnings` と `runtime_finished` payload に含める。
- `nightworkers.run-orchestration.service.ts` は finalizing 時に `runtimeResult.contractWarnings` を `task_runs.contextSnapshot.codexContract.warnings` へ merge する。
- run event が source of truth であり、context snapshot は一覧性のための cache とする。

この方針なら新規 migration は不要で、既存 `system.warning` run event と `contextSnapshot` JSON に収まる。

## 7. PR 分割

### PR 1: Codex Runtime Contract を実 tool surface に合わせる

目的:

- Codex runtime prompt の tool 契約を現実の MCP surface と一致させる。

作業:

- `buildCodexRuntimePrompt(...)` から、NightWorkers MCP tool として `run_command` / `run_verification` が存在するように読める文言を削る。
- Codex レーンで使える NightWorkers MCP tool を明示する。
- CLI 検証は Codex native `command_execution` として観測されることを明記する。
- `command_execution` の stdout/stderr や exit code は final report と event evidence に残す、という表現に寄せる。
- `context-still.initial_instructions` は「この run で未実行なら実行」と読める表現にするか、現行 Todo gate との整合を明記する。
- closeout は `contextstill.register_candidates` と `final_completion_report` の2 gate に分かれている前提で文言をそろえる。

主な対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`

検証:

- Codex runtime prompt test が、NightWorkers MCP の4 tool を含む。
- Codex runtime prompt test が、`nightworkers.run_command` / `nightworkers.run_verification` を含まない。
- prompt に `run_command and run_verification keep full stdout/stderr` のような native-local 前提の文言が残らない。
- `nightworkers.materialize_template` / `nightworkers.clone_git_repo` が引き続き出ない。

完了条件:

- Codex レーンの prompt だけを読んだとき、モデルが存在しない NightWorkers MCP tool を期待しない。

### PR 2: Codex Contract Warning の型とイベントを追加する

目的:

- Codex レーンの契約逸脱を統一形式で記録する。

作業:

- `api/services/agent-runtime/types.ts` に `CodexContractWarning` を追加する。
  - `code: string`
  - `severity: 'info' | 'warning' | 'error'`
  - `message: string`
  - `providerItemId?: string | null`
  - `toolName?: string | null`
  - `todoId?: string | null`
  - `todoSeq?: number | null`
  - `changedFiles?: string[]`
  - `command?: string | null`
- `AgentRuntimeEvent` に `{ type: 'runtime_warning'; message: string; payload?: CodexContractWarning }` を追加する。
- `AgentRuntimeResult` に `contractWarnings?: CodexContractWarning[]` を追加する。
- `ledger-sink` の `EVENT_MAPPING` に `runtime_warning -> system.warning` を追加する。
- `CodexAgentRuntime` 内に runtime-local state を追加する。
  - `sawNightworkersTodoReplace`
  - `sawAnyNightworkersTodo`
  - `sawNightworkersImportProjectSuccess`
  - `sawNightworkersImportProjectFailure`
  - `contractWarnings`
- contract warning payload の最小型を定義する。
  - `code`
  - `severity`
  - `message`
  - `providerItemId`
  - `toolName`
  - `todoSeq`
  - `changedFiles`
- Todo replace 前に `file_change` が来た場合、warning を emit する。
- warning は `runtime_error` ではなく `runtime_warning` として emit する。
- `finishRun(...)` の result と `runtime_finished` payload に `contractWarnings` を含める。
- run orchestration finalizing 時に `contextSnapshot.codexContract.warnings` へ warnings を merge する。

主な対象:

- `api/services/agent-runtime/types.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.agent-runtime.test.ts`

検証:

- Todo replace 前 file_change で `codex_contract_warning` が出る。
- Todo replace 後 file_change では同じ warning が出ない。
- warning payload に changed files と provider item id が入る。
- warning が `system.warning` run event として保存される。
- runtime result の `contractWarnings` が finalizing 後の `contextSnapshot.codexContract.warnings` に残る。

完了条件:

- Codex レーンの逸脱を hard failure と混ぜず、後から検索可能な warning として追える。

### PR 3: file_change を current Todo evidence に紐づける

目的:

- Codex native file change を、現在の Todo の成果物 evidence として扱えるようにする。

作業:

- `file_change` event 受信時に DB の current running Todo を読む。
- current Todo がある場合、event payload に次を付ける。
  - `todoId`
  - `todoSeq`
  - `todoTitle`
  - `todoProcedureId`
- current Todo がない場合は `file_change_without_current_todo` warning を出す。
- Todo replace 前 file_change warning と current Todo missing warning は別 code にする。
- post-run git diff collection でも、可能なら最後に観測した current Todo を補助情報として付ける。ただし DB の真実と混同しない。

主な対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.codex-agent-runtime.test.ts`
- 必要なら `api/modules/nightworkers/nightworkers.repository.ts`

実装メモ:

- `CodexAgentRuntime` から `repo.listTaskRunTodosForRun(context.runId)` を読む。
- `file_change` は mapper 上では `diff_collected` に変換されるため、`mapped.type === 'diff_collected'` かつ `payload.provider === 'codex'` かつ `payload.providerEventType` が item event の場合を対象にする。
- current Todo の取得に失敗しても file_change 自体は捨てない。warning を追加し、元の event は sink へ流す。

検証:

- current Todo が running のとき、file_change event に Todo metadata が付く。
- current Todo がないとき、warning が出る。
- changed files が event payload に残る。
- secret redaction と file_change normalization が壊れない。

完了条件:

- Timeline / review / closeout が、Codex native file change と Todo の関係を追える。

### PR 4: import_project failure 後 fallback hard gate を補強する

目的:

- `nightworkers.import_project` failed / cancelled 後に Codex が代替実装を作って完了する事故を防ぐ。

現状:

- `CodexAgentRuntime` は `nightworkers.import_project` の failed / cancelled を検出し、即 runtime finish する経路を持つ。
- transport cancel 系は `needs_human`、explicit cancelled は `cancelled` として扱われる。
- 既存 test は import failure 後の `file_change` が diff event として流れないことを確認している。

残作業:

- hard gate としての設計を明文化し、warning / error code を統一する。
- `nightworkers.materialize_template` 互換の扱いを残すか、Codex レーンでは `import_project` のみに縮退するか決める。
- failed import の payload に partial postImport がある場合の扱いを整理する。
  - `ok=false` なら fallback 実装禁止。
  - repair のために編集してよいケースは P0 では作らない。
- final report に、fallback rejected の理由と provider item id を含める。

主な対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `src/modules/nightworkers/components/ThreadTimelineImportProjectCard.tsx` は必要に応じて後続。

検証:

- `nightworkers.import_project` failed 後、後続 file_change event があっても処理されない。
- failed result は `needs_human` になる。
- cancelled result は `cancelled` になる。
- final report が fallback 禁止を明示する。
- provider item id が runtime_error payload に残る。

完了条件:

- import failure 後の代替 scaffold / static app fallback が runtime level で拒否される。

### PR 5: open Todo finalization guard と Codex warning を連動する

目的:

- DB の Todo 状態を最終判断に使い、Codex の最終文だけで completed にしない。

現状:

- run finalizing 時に open Todo を読み、completed outcome かつ open Todo があれば `needs_human` に落としている。
- `final_completion_report` gate は assistant final message で auto close される。

作業:

- open Todo guard の run event payload に Codex contract warning code を追加する。
  - 例: `codex_open_todos_before_completion`
- open Todo guard が発動した場合、`contractWarnings` にも同じ情報を残す。
- final report に open Todo 一覧だけでなく、Codex contract warning としての意味を短く追記する。
- `final_completion_report` auto close 後に open Todo 判定されていることを test で固定する。
- planning-only run の除外条件を Codex レーンでも明文化する。

主な対象:

- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.agent-runtime.test.ts`
- `tests/nightworkers-service/services-nightworkers-02.test.ts`

検証:

- open Todo が残る completed runtime result は `needs_human` になる。
- final completion report Todo だけが適切に auto close される。
- open Todo guard event に warning code が入る。
- existing closeout split tests が通る。

完了条件:

- Codex final text と DB Todo 状態が矛盾する run を completed にしない。

### PR 6: Codex native command を分類する

目的:

- global MCP 継承を残す前提で、Codex native command の意味を event と evidence に残す。

作業:

- command classifier を追加する。
  - `verification`
  - `broad_verification`
  - `git_clone_or_import`
  - `install`
  - `inspection`
  - `other`
- 分類は event 監査用途に限定し、ユーザー依頼の routing には使わない。
- `command_execution` event payload に `commandClass` を追加する。
- `git_clone_or_import` は `import_project` 代替疑いとして contract warning を出す。
- `install` は `postImport.initialization` との重複検出の材料にする。ただし P0 では warning までにする。
- `verification` / `broad_verification` は verification evidence 候補にする。

主な対象:

- `api/services/agent-runtime/codex-event-mapper.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/thread-timeline-edit-summary/*` は必要に応じて更新。

検証:

- `pnpm test` / `bun run verify` / `npm run typecheck` が verification 系に分類される。
- `git clone ...` が import 代替疑いに分類される。
- `ls` / `git status` が inspection に分類される。
- command output と exit code が引き続き残る。

完了条件:

- Codex native command が「何をしたか不明な command_execution」ではなく、監査可能な activity として扱える。

### PR 7: import_project 後の manifest-based verification gate を作る

目的:

- `nightworkers.import_project` 成功後、manifest 推奨検証または同等の検証 evidence がないまま完了することを検出する。

作業:

- `nightworkers.import_project` 成功 event から次を保存する。
  - `postImport.manifest.recommendedVerificationCommands`
  - `postImport.initialization`
  - `postImport.llmContext` の有無
- recommended verification が空の場合は gate 対象外にする。
- Codex native command classifier の `verification` / `broad_verification` を evidence として認める。
- 将来 `nightworkers.run_verification` を追加した場合に備え、toolName 判定は拡張しやすくする。
- finalization 時に import success かつ verification evidence なしなら、初期は warning、運用後に `needs_human` へ昇格できる feature flag を置く。

主な対象:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.codex-agent-runtime.test.ts`

実装メモ:

- `CodexAgentRuntime` 内で import success と recommended verification commands を runtime-local state に保持する。
- verification evidence は PR 6 の `commandClass === 'verification' | 'broad_verification'` と exit code 0 を初期条件にする。
- PR 7 を PR 6 より先に実装しない。分類がない状態で gate を作ると、command 判定が重複する。

検証:

- import_project success 後、recommended command があり、verification command がない場合 warning が出る。
- verification command が exit 0 なら warning が出ない。
- verification command が exit non-zero なら warning または needs_human 候補になる。
- recommended commands が空なら gate 対象外。

完了条件:

- Codex レーンで template import 直後の未検証完了を検出できる。

### PR 8: MCP configured / inherited / observed / degraded を記録する

目的:

- NightWorkers MCP がどう見えていたかを、run 後に診断できるようにする。

作業:

- `buildCodexRuntimeSdkOptions(...)` の結果から config source を判定できる helper を追加する。
  - helper 名案: `resolveCodexRuntimeMcpConfigState(...)`
  - 戻り値: `{ source, expectedTools, hasInlineNightWorkersMcp }`
- Codex runtime start 時に MCP config source を event に残す。
  - `inline_configured`
  - `global_inherited`
  - `disabled`
- inline configured の場合は server name と expected tool names を payload に残す。
- global inherited の場合は、preflight `tools/list` は要求しない。
- 実行中に `nightworkers.*` MCP tool call を観測したら observed event を残す。
- `nightworkers.*` MCP tool が failed / cancelled / unavailable らしい場合、`codex_mcp_degraded` warning を残す。
- degraded 中に file change が出た場合は hard gate 候補にする。P0 では warning から始め、import_project failure は既存 hard gate に委ねる。

主な対象:

- `api/services/agent-runtime/codex-runtime-config.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/ledger-sink.ts`
- `tests/services.codex-agent-runtime.test.ts`

実装メモ:

- global inherited の場合に Codex SDK の `tools/list` preflight は行わない。
- `buildCodexRuntimeSdkOptions(...)` の public behavior は維持する。command 未設定時に `options.config` を undefined にする既存 test は維持する。
- config source event は runtime start 直後の `runtime_warning` ではなく `runtime_started` 追加 payload、または `runtime_warning` ではない `system.info` 相当 event として扱う。P0 では `runtime_started` payload への追加を優先する。

検証:

- inline configured の run で `codex_mcp_configured` event が出る。
- command 未設定の run で `global_inherited` が記録される。
- `nightworkers.todo_list` event を観測すると observed event が出る。
- failed NightWorkers MCP call で degraded warning が出る。
- preflight tools/list に依存しない。

完了条件:

- MCP が無かったのか、global inherited だったのか、あったが使われなかったのかをログから切り分けられる。

## 8. データ設計

P0 では新規テーブルは追加しない。

contract warning は run event payload と task run context snapshot のどちらか、または両方に保存する。

推奨:

```ts
type CodexContractWarning = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  providerItemId?: string | null;
  toolName?: string | null;
  todoId?: string | null;
  todoSeq?: number | null;
  changedFiles?: string[];
  command?: string | null;
};
```

run context snapshot に入れる場合:

```json
{
  "codexContract": {
    "warnings": [],
    "mcp": {
      "configSource": "inline_configured | global_inherited | disabled",
      "observedNightWorkersTools": [],
      "degraded": false
    }
  }
}
```

注意:

- warning は final report のための補助情報であり、source of truth は run events と DB Todo 状態である。
- context snapshot だけに保存しない。

## 9. Testing Strategy

### Unit tests

- `tests/services.codex-agent-runtime.test.ts`
  - prompt drift
  - contract warning
  - import failure hard gate
  - command classification
  - MCP configured / inherited / observed / degraded
- `tests/services.todo-list-builder.test.ts`
  - closeout split の regression
- `tests/services.agent-runtime.test.ts`
  - open Todo finalization guard
- `tests/nightworkers-service/services-nightworkers-02.test.ts`
  - run finalization status transition

### Integration-ish tests

- fake Codex event replay で次を確認する。
  - `nightworkers.todo_list replace` before file_change
  - file_change before Todo replace
  - `nightworkers.import_project` failed then file_change
  - `nightworkers.import_project` success without verification
  - verification command with exit 0
  - verification command with non-zero exit

### Manual checks

- Codex レーンで空 Project に starter import する。
- import success 後の postImport payload が transcript に出る。
- verification command の event が Timeline に出る。
- open Todo が残る run が completed にならない。

## 10. Rollout

### Phase 1

- PR 1 から PR 3 までを入れる。
- warning は run outcome を止めない。
- UI には既存 timeline event として出る範囲に留める。

### Phase 2

- PR 4 と PR 5 を入れる。
- import failure と open Todo は hard gate として扱う。
- 既存 test で regression を固定する。

### Phase 3

- PR 6 から PR 8 を入れる。
- command classification と verification evidence を warning として運用する。
- false positive を見た後、manifest-based verification gate を needs_human へ昇格するか判断する。

## 11. 判定待ち項目

### `run_verification` MCP を追加するか

現時点の判定:

- P0 では追加しない。

理由:

- MCP surface が増える。
- global MCP 継承前提では、tool selection がさらに複雑になる。
- Codex native `command_execution` でも検証 evidence は取れる。

再検討条件:

- native command classification で verification evidence の取りこぼしが多い。
- stdout/stderr や timeout policy を NightWorkers 側で強く統制する必要が出る。
- manifest-based verification gate を hard gate 化する。

### NightWorkers 以外の MCP tool call を止めるか

現時点の判定:

- P0 では止めない。warning にする。

理由:

- global MCP 継承を残す以上、存在自体は許容する。
- 全停止は false positive が大きい。

hard gate 候補:

- NightWorkers 以外の MCP tool が repository write 相当の activity を行ったと判断できる場合。
- import_project failure 後の fallback 実装に関係する場合。

### Todo replace 前 file_change を止めるか

現時点の判定:

- P0 では warning にする。

理由:

- 小さい修正や継続 run では、Todo replace 前に Codex native file_change が出る可能性がある。
- まず発生頻度と false positive を観測する。

hard gate 候補:

- major implementation run で、Todo が一度も作られずに複数 file_change が出る場合。
- import_project の代替 scaffold と判断できる場合。

## 12. 完了条件

P0 全体の完了条件:

- Codex runtime prompt が実 MCP surface と一致している。
- Todo 前 file change、current Todo なし file change、NightWorkers 以外 MCP、native command が warning として追える。
- import_project failure 後 fallback は hard gate で止まる。
- open Todo が残る completed run は `needs_human` になる。
- Codex native command が verification / import代替 / install / inspection / other に分類される。
- import_project success 後の manifest-based verification 不足が warning として追える。
- MCP config source と NightWorkers MCP observation / degraded が run event から分かる。
- P0 の各項目に regression test がある。
