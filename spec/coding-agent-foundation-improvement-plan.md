---
title: Coding Agent Foundation 改善計画
targetKind: wiki
priorityGroup: wiki
---

# Coding Agent Foundation 改善計画

作成日: 2026-06-01

## 目的

NightWorkers を「UI 付きの実行ログビューア」ではなく、コーディングエージェント基盤として信頼できる状態へ引き上げる。

この計画は、直近レビューで見つかった実行制御、状態管理、リアルタイム観測、安全ポリシー、E2E 検証の不足を、実装可能な単位に分解する。対象は既存の native supervisor-worker runtime であり、新しい外部エージェント基盤へ置き換えることは目的にしない。

## 現状の価値

既に価値がある部分:

- `task_runs` / `task_events` / `task_messages` に実行履歴を残せる。
- supervisor decision、tool call、tool result を UI に出せる。
- WebSocket で task 単位の更新を配信できる。
- `read_file` / `search_files` / `apply_patch` / `replace_content` / `run_command` / `git_status` / `git_diff` の最小 tool set がある。
- provider 切り替えと LLM 設定 UI がある。
- Playwright smoke test の足場がある。

現状の不足:

- supervisor の terminal state が runner/service 層で上書きされる。
- supervisor loop に最大ラウンド数と総時間制限がない。
- WebSocket event が race で欠落し、時系列表示が崩れる可能性がある。
- repository の `safetyPolicy` が worker tools に渡っていない。
- `run_command` の安全判定が shell 文字列に対して弱い。
- 新規ファイル作成と read-before-edit policy の扱いが曖昧。
- E2E が「LLM がタスクを完遂したか」ではなく UI 操作の一部だけを見ている。

## 非目標

- MCP 外部 namespace を今すぐ全面対応すること。
- multi-agent 並列実行。
- container sandbox の導入。
- PR 作成、push、publish など外部副作用。
- LSP 基盤の導入。
- UI の大規模再設計。

## 優先度

| Priority | 改善項目 | 理由 |
|---|---|---|
| P0 | terminal state の上書き防止 | 実行結果の成功/失敗判定そのものが信用できないため |
| P0 | supervisor loop budget | 無限探索・長時間実行を止める基礎制御のため |
| P1 | WebSocket event ordering | debug UI とリアルタイム観測の信頼性に直結するため |
| P1 | safetyPolicy の実行反映 | UI/API の安全設定を実行に効かせるため |
| P1 | command policy 強化 | local machine 上で shell を実行するため |
| P2 | edit tool contract 整理 | 新規ファイル作成や単純編集の成功率を上げるため |
| P2 | agent outcome E2E | 今後の改善が regress しない基盤にするため |
| P2 | temporary guard の出口設計 | `TEMP_DISABLE_EXTERNAL_MCP_TOOLS` を恒久化しないため |

## Phase 0: 実行状態 contract の固定

目的: supervisor が判断した terminal state を、runner/service が上書きしないようにする。

対象ファイル:

- `api/services/runner/NativeLocalRunner.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `tests/services.supervisor.test.ts`

実装方針:

- `runSupervisorLoop` の戻り値を文字列ではなく typed result にする。
- result には `finalReport`, `terminalState`, `summary`, `stoppedBy`, `riskLevel` を含める。
- `NativeLocalRunner` は supervisor result の `terminalState` を尊重する。
- `nightworkers.service.ts` は runner status だけで `needs_review` を決めない。
- `completed` と `needs_review` の意味を分ける。
- agent が編集を終えたが人間レビュー待ちなら task は `needs_review`。
- agent が schema/tool/safety で止まったなら task は `needs_human` または `failed`。

受け入れ条件:

- supervisor が `terminalState: "needs_human"` を返した run が、最終的に `completed` や `needs_review` に上書きされない。
- assistant message に supervisor の final report が入る。
- final report に停止理由が残る。
- `pnpm test run tests/services.supervisor.test.ts` が通る。

検証:

- unit test で `needs_human` / `failed` / `completed` の 3 ケースを作る。
- repository には `task_run_updated` event が terminal state と一致して保存されることを確認する。
- UI 上の latest run status が DB の run status と一致することを Playwright で確認する。

## Phase 1: Supervisor loop budget

目的: 同じ探索や不十分な tool call が続いた場合に、決められた回数で停止する。

対象ファイル:

- `api/services/supervisor/supervisor-loop.ts`
- `api/services/supervisor/llm-provider.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/runner/types.ts`
- `tests/services.supervisor.test.ts`

実装方針:

- `SupervisorLoopInput` に `maxIterations`, `maxToolCalls`, `maxRepeatedToolPattern`, `deadlineAt` を追加する。
- `timeoutSeconds` から `deadlineAt` を計算し、各ラウンド開始時に確認する。
- `list_dir` / `find_file` / `search_files` の同一引数連続実行を loop pattern として検出する。
- tool failure だけでなく、missing toolCall / schema fallback /同一探索も停止判定に含める。
- 3回同じ失敗または同じ探索が続いたら `needs_human` で停止する。

受け入れ条件:

- `timeoutSeconds` が supervisor loop に実際に効く。
- 同一 tool + 同一 arguments が 3 回続いたら停止する。
- missing toolCall が連続した場合も 3 回以内に停止する。
- 停止 event に `reason`, `lastToolName`, `pattern`, `iteration` が残る。

検証:

- mocked LLM で同じ `find_file` を返し続けるテストを追加する。
- mocked LLM で `phase=plan` かつ `toolCall=null` を返し続けるテストを追加する。
- `logs/supervisor-trace.log` に budget stop の event が残ることを確認する。

## Phase 2: リアルタイム event ordering と timeline

目的: Debug event が正しい session/run の時系列に表示され、run 完了前からリアルタイムに見える状態にする。

対象ファイル:

- `api/services/realtime/nightworkers-ws.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `tests/e2e/nightworkers-agent.spec.ts`

実装方針:

- WS message に `taskId`, `runId`, `seq`, `timestamp` を必ず含める。
- UI は `latestRun?.id` が未反映でも、`runId` ごとに realtime event を一時保持する。
- `latestRun` が後から届いたら、該当 run の buffered events を merge する。
- merge は `event.id` で dedupe し、`seq` 優先、なければ `timestamp` で sort する。
- `taskMessages` と `taskEvents` は単一 timeline に混ぜるが、event は該当 run の下に出るようにする。
- debug default hidden は維持する。

受け入れ条件:

- run 開始直後の `state_change` / `tool_call` event が落ちない。
- debug を表示した時、古い user message の下に新しい run event が混ざらない。
- LLM 最終回答を待たずに tool call / tool result が UI に出る。
- WS 再接続後も重複表示されない。

検証:

- Playwright で新規 session を作り、prompt 送信直後に debug を開いて `Task run started` または tool event が見えることを確認する。
- 同一 prompt を 1 回だけ送信し、user bubble が 1 件だけであることを継続確認する。
- `GET /api/runs/:id` の events と UI 表示順が一致することを確認する。

## Phase 3: safetyPolicy の worker tool 反映

目的: repository に設定した safety policy を、実際の tool execution に適用する。

対象ファイル:

- `api/db/schema.ts`
- `shared/schemas/nightworkers.schema.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/runner/types.ts`
- `api/services/runner/NativeLocalRunner.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `api/services/worker-tools/*`
- `tests/services.worker-tools.test.ts`

実装方針:

- `RunnerOptions` に `safetyPolicy` を追加する。
- `startTaskRun` で `repoInfo.safetyPolicy` を runner に渡す。
- runner から supervisor loop へ `safetyPolicy` を渡す。
- `read_file`, `list_dir`, `find_file`, `search_files`, `apply_patch`, `replace_content`, `run_command` に `allowedPaths`, `deniedPaths`, `blockedCommands`, `maxCommandSeconds`, `requireReadBeforeEdit` を渡す。
- tool result に policy violation の種類を明示する。

受け入れ条件:

- `deniedPaths` に含まれる path は read/search/edit/run cwd で拒否される。
- `blockedCommands` が `run_command` に効く。
- `maxCommandSeconds` が command timeout に反映される。
- policy violation は `needs_human` ではなく、まず tool_result error として event 化される。

検証:

- worker tool unit test に repository safety policy 経由のケースを追加する。
- integration test で repository を作り、denied path への read を拒否する。
- UI debug event に `ACCESS_DENIED` / `DESTRUCTIVE_COMMAND` が表示されることを確認する。

## Phase 4: `run_command` policy の強化

目的: shell 文字列を雑に許可する状態から、コーディング作業に必要な範囲だけを明示的に許可する。

対象ファイル:

- `api/services/worker-tools/command-policy.ts`
- `api/services/worker-tools/run-command.ts`
- `api/services/supervisor/prompt.ts`
- `tests/services.worker-tools.test.ts`

実装方針:

- MVP では shell 実行自体は維持する。
- ただし command classification を allowlist first に寄せる。
- 許可する基本カテゴリを `read_only`, `build_test`, `format`, `package_install_if_explicit` に分ける。
- `unknown` は default deny にする。
- `&&`, `;`, `|`, backtick, `$()` を含む command は high risk として拒否するか、明示 allowlist のみに限定する。
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git status`, `git diff`, `rg`, `ls`, `pwd` は許可する。
- `git commit`, `git push`, `rm`, `mv`, `cp`, `chmod`, `curl`, `wget` は当面拒否する。

受け入れ条件:

- 未知 command は実行されない。
- chained command は実行されない。
- 許可された verification command は実行できる。
- 失敗時に stdout/stderr と拒否理由が event に残る。

検証:

- `rm -rf *`, `git push`, `curl example.com`, `pnpm test && rm -rf .` が拒否される。
- `pnpm typecheck`, `pnpm lint`, `pnpm test run tests/services.worker-tools.test.ts` が許可される。
- `run_command` の snapshot 的な expected error code を固定する。

## Phase 5: edit tool contract の整理

目的: 新規ファイル作成、既存ファイル編集、単純置換を tool contract として明確に分ける。

対象ファイル:

- `api/services/worker-tools/apply-patch.ts`
- `api/services/worker-tools/replace-content.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/llm-provider.ts`
- `tests/services.worker-tools.test.ts`
- `tests/services.supervisor.test.ts`

実装方針:

- `apply_patch` は unified diff 専用にする。
- 新規ファイル作成は `create_file` tool を追加するか、`apply_patch` 内で `/dev/null` target を明示許可する。
- 既存ファイル編集は read-before-edit を維持する。
- 新規ファイルは parent directory が safe path 内であれば read-before-edit 不要にする。
- `replace_content` は単一一致の安全置換に限定する。
- LLM prompt には「新規ファイルは create_file または new file patch を使う」と明記する。

受け入れ条件:

- `fizzbuzz.ts` のような新規ファイル作成タスクが read-before-edit violation で止まらない。
- 既存ファイル編集は read-before-edit なしでは拒否される。
- `apply_patch` の `changedFiles` に新規ファイルが含まれる。
- tool schema と prompt の説明が一致する。

検証:

- worker tool unit test に new file patch を追加する。
- supervisor unit test で新規ファイル作成の toolCall を通す。
- E2E で新規 session に「プロジェクトルートに fizzbuzz.ts を作成」を投げ、diff に `fizzbuzz.ts` が出ることを確認する。

## Phase 6: Agent outcome E2E

目的: UI smoke ではなく、NightWorkers の内蔵コーディングエージェントが実際にタスクを完遂できるかを継続検証する。

対象ファイル:

- `tests/e2e/nightworkers-agent.spec.ts`
- `tests/e2e/helpers.ts`
- `playwright.config.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.service.ts`

実装方針:

- E2E は毎回新しい sessionId を作る。
- scratch workspace をテストごとに分離する。
- prompt 送信後、WS event を監視して tool call / tool result / final assistant message を確認する。
- 成功条件は UI 文言ではなく、実ファイルの存在、git diff、run status、task status で判定する。
- LLM provider が必要なテストは `@agent-live` に分ける。
- provider 不要のテストは mocked LLM provider で deterministic にする。

受け入れ条件:

- `@smoke` は provider 不要で安定する。
- `@agent-live` は実 LLM を使い、失敗時に runId と debug log path を出す。
- 「WS 表示を3色丸に変更」のような UIタスクを agent が完遂できたかを diff で判定できる。
- 失敗時に screenshot、trace、supervisor trace、run events を残す。

検証:

- `pnpm test:e2e:smoke`
- `pnpm test:e2e:regression`
- `pnpm test:e2e --grep @agent-live` は env が揃う時だけ実行する。

## Phase 7: temporary guard の出口設計

目的: `TEMP_DISABLE_EXTERNAL_MCP_TOOLS.ts` を恒久的な仕様にしない。

対象ファイル:

- `api/services/supervisor/TEMP_DISABLE_EXTERNAL_MCP_TOOLS.ts`
- `api/services/supervisor/llm-provider.ts`
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/supervisor-loop.ts`
- `tests/services.supervisor.test.ts`

実装方針:

- まずは一時 guard を維持する。
- `mcp__*`, `functions.*`, namespaced tool のブロック理由を task event に出す。
- SystemContext isolation が実装されたら guard を削除する。
- 外部 tool namespace を本当に使う場合は、NightWorkers tool registry に明示登録してから許可する。

受け入れ条件:

- 外部 namespace が混入しても schema loop にならない。
- ブロック理由が supervisor trace と UI debug に残る。
- guard 削除条件がコメントと spec の両方に残る。

検証:

- mocked LLM が `mcp__context_still.initial_instructions` を返しても 3 round 以内に停止する。
- blocked external tool name が `needs_human` で説明される。

## 実装順

1. Phase 0: terminal state contract を直す。
2. Phase 1: supervisor loop budget を入れる。
3. Phase 2: realtime event ordering を直す。
4. Phase 3: safetyPolicy を worker tools に通す。
5. Phase 4: command policy を default deny に近づける。
6. Phase 5: edit tool contract を整理する。
7. Phase 6: agent outcome E2E を追加する。
8. Phase 7: temporary guard の削除条件を固定する。

## 初日着手手順

1. `runSupervisorLoop` の戻り値型を作る。
2. `NativeLocalRunner` が supervisor result を尊重するように変更する。
3. `nightworkers.service.ts` の final task status 決定を runner status 依存から run terminal state 依存に変更する。
4. supervisor unit test に `needs_human` 上書き防止ケースを追加する。
5. 同一 tool call 3回で停止する loop budget test を追加する。
6. `pnpm typecheck && pnpm lint && pnpm test run tests/services.supervisor.test.ts` を通す。

## リスクと対策

| Risk | 対策 |
|---|---|
| terminal state 変更で既存 UI の status 表示が崩れる | `TaskRun.status` と `Task.status` の変換関数を 1 箇所に閉じ込める |
| loop budget が厳しすぎて正常タスクも止まる | default は `maxIterations=8` 程度から始め、event に budget 消費を出す |
| command policy 強化で検証コマンドまで止まる | allowlist を unit test で固定する |
| WS event buffer が重複表示を生む | `event.id` dedupe と `seq` sort を必須にする |
| live LLM E2E が不安定になる | `@smoke` と `@agent-live` を分け、CI 必須は deterministic test にする |

## 完了条件

- P0 の 2 項目が実装され、`needs_human` が成功扱いに上書きされない。
- supervisor loop が最大ラウンド数、総時間、同一探索パターンで停止できる。
- debug event が run 開始直後から UI に出る。
- repository safety policy が worker tools に反映される。
- 新規ファイル作成タスクが tool contract 上サポートされる。
- provider 不要の E2E と、任意実行の live agent E2E が分離されている。
- `pnpm typecheck`, `pnpm lint`, `pnpm test run tests/services.supervisor.test.ts tests/services.worker-tools.test.ts`, `pnpm test:e2e:smoke` が通る。
