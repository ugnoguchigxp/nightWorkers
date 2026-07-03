# TodoList Progress Contract Plan

## Purpose

NightWorkers の作業中に `nightworkers.todo_list` MCP tool を確実に使わせ、ユーザーが既存の TodoList UI で進捗を追える状態にする。

この計画は、作業品質ではなく「進捗が UI に出ないまま調査・レビュー・検証が進む」運用欠落を修正するためのもの。Timeline や追加バナーで警告を増やすのではなく、既存 TodoList pane に正しい状態遷移が出続けることを完了条件にする。

## Confirmed Baseline

- `nightworkers.todo_list` MCP tool は存在し、`replace/start/done/block/fail/list` を扱える。
- NightWorkers UI は `task_run_todos` を TodoList pane として表示できる。
- implementation run では標準 TodoList が事前作成されるが、Codex lane の実作業中に `todo_list` 更新が漏れると、ユーザーから見た進捗が止まる。
- Codex runtime prompt には `nightworkers.todo_list` の基本ルールがあるが、「作業開始前に UI 追跡可能な TodoList を作り、各段階で更新する」ことが十分に強制されていない。
- Codex audit には「file_change before todo_list replace」系の contract warning があるが、作業種別ごとの進捗更新 freshness までは見ていない。

Relevant files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-mcp-audit.ts`
- `api/services/agent-runtime/codex-contract-warning-catalog.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/worker-tools/todo-list.ts`
- `src/modules/todo/TodoListPane.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/read-current-specification-tool.test.ts`

## Scope

In scope:

- `todo_list` を UI 進捗契約として扱う prompt の明文化。
- Codex lane で、実作業前・検証前・完了前に TodoList が更新されているかを audit する。
- Native/API runner lane で、`todo_list` 更新を closeout 前提としてより明確にする。
- Contract warning は内部診断・run summary 用に残すが、Timeline に追加の警告 UI は出さない。
- TodoList pane の既存表示を前提に、必要なら小さな表示安定化だけを行う。
- Focused tests と repo-native verify gate。

Out of scope:

- Timeline に「Todo 未更新」「TodoList 未初期化」などの新しい可視警告を追加すること。
- 新しい進捗専用 UI、バナー、トースト、通知を作ること。
- TodoList tool のデータモデル再設計。
- Implementation Queue や Project Evaluation の大規模 UI 改修。
- `todo_list` の代替 tool を増やすこと。
- 既存の closeout gate 全体の再設計。

## Target Behavior

### User-visible behavior

- ユーザーは既存 TodoList UI だけを見れば、現在の作業段階が分かる。
- 実作業中は、少なくとも 1 件の Todo が `running` になる。
- 調査、実装、focused verification、review、quality gate の状態遷移が、作業の実態に沿って `done/block/fail` へ更新される。
- 完了報告前に open Todo が残る場合、run は完了扱いにしないか、既存の closeout policy に従って整理される。
- Timeline には新しい警告カードを出さない。Timeline は実際の tool call / result の表示に留める。

### Runtime behavior

- Codex lane は、作業開始後に `nightworkers.todo_list` mutation がないまま file change や broad verification へ進むと contract warning を記録する。
- Contract warning は `contractWarnings` / run metadata / tests で確認できるが、ユーザー向け Timeline noise にはしない。
- `todo_list operation=list` は進捗更新として扱わない。
- `todo_list operation=replace` は構造変更だけに使う。現在 Todo の完了は `done/block/fail` で表す。
- `done` は具体的 evidence がある場合だけ許可するという既存方針を維持する。

## Todo Contract

Runtime prompt に次の契約を追加する。

1. Multi-step work contract
   - 調査、レビュー、実装、検証のいずれかが 2 手以上必要な場合、最初の実質作業前に TodoList を UI 追跡可能な粒度にする。
   - 既存 TodoList が十分なら `start/done/block/fail` で進める。
   - 既存 TodoList が作業内容と合わない場合のみ `replace` を使う。

2. Progress update contract
   - tool 実行で作業段階が変わる前に、対応する Todo を `running` にする。
   - ファイル編集、DB mutation、長い検証、review 判定の後は、該当 Todo を閉じるか、block/fail にする。
   - `list` は診断専用であり、進捗更新として扱わない。

3. Closeout contract
   - final report 前に open Todo を確認する。
   - 未完了 Todo があるなら `done/block/fail` のいずれかに整理する。
   - 未確認 mutation や未実施 verification を `done` にしない。

4. User visibility contract
   - 進捗表示は TodoList pane が source of truth。
   - Timeline に内部契約違反を追加表示しない。

## Implementation Plan

### Phase 0. Baseline Tests

Add tests that capture current gaps before behavior changes.

Files:

- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/read-current-specification-tool.test.ts`

Codex test cases:

- A run that performs file changes without any `nightworkers.todo_list` mutation records a non-terminal contract warning.
- A run that calls `nightworkers.todo_list operation=list` only still records the warning.
- A run that calls `operation=replace` before file changes does not record the pre-work warning.
- A run that calls `operation=done` after focused verification does not record a closeout freshness warning.

Native/API test cases:

- `finalize_answer` with open Todos returns tool guidance requiring `todo_list done/block/fail`.
- `todo_list list` is not accepted as progress evidence.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/read-current-specification-tool.test.ts
```

### Phase 1. Prompt Contract Tightening

Update prompt text for both runtime lanes.

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/supervisor/skills/builtin/references/modes/code_edit.md`
- `api/services/supervisor/skills/builtin/references/overlays/evidence.md`

Required wording:

- TodoList pane is the user-visible progress source.
- Multi-step work must keep TodoList state current.
- `list` is not progress.
- final report requires no unhandled open Todos.
- Timeline warnings are not the mechanism for this contract.

Avoid:

- Adding broad English-only operational rules.
- Replacing existing Japanese prompt sections with less specific text.
- Making `replace` sound like the normal way to mark work complete.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
```

### Phase 2. Codex Todo Progress Audit

Extend Codex audit state to track TodoList progress freshness.

Files:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-mcp-audit.ts`
- `api/services/agent-runtime/codex-contract-warning-catalog.ts`

Track:

- First `nightworkers.todo_list` mutation event.
- Last `todo_list` mutation operation.
- Whether only `list` was called.
- Whether file changes happened before any TodoList mutation.
- Whether broad verification happened while no Todo was updated for the current work.

Add warning codes:

- `codex_todo_progress_missing`
- `codex_todo_progress_list_only`
- `codex_todo_progress_stale_before_verify`

Policy:

- Default severity: `warning`.
- Terminal policy: `none` for the first implementation slice.
- Do not emit a special Timeline card.
- Use existing contract warning persistence/reporting.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts
```

### Phase 3. Closeout Freshness Guard

Before final successful completion, confirm TodoList state is not stale.

Files:

- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/modules/nightworkers/nightworkers.run-orchestration.service.ts`

Rules:

- If runtime completed successfully but open Todos remain, preserve existing closeout blocking behavior.
- If runtime completed successfully and TodoList was never mutated in a multi-step Codex run, record a warning in `contractWarnings`.
- Do not convert this warning into a user-visible Timeline warning.
- Do not fail simple one-shot general answers.

Gate:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/nightworkers-service/services-nightworkers-02.test.ts
```

### Phase 4. Existing TodoList UI Stability Check

Verify the existing UI is enough.

Files:

- `src/modules/todo/TodoListPane.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `tests/thread-workspace-banner.test.tsx`
- `tests/thread-timeline-codex-tool-card.test.ts`

Expected:

- TodoList pane shows current `running` item and completed/skipped/failed states.
- Existing tool call cards can still show actual `nightworkers.todo_list` calls.
- No new Timeline warning card is introduced.

Only change UI if a focused test proves the current pane fails to reflect updated `task_run_todos`.

Gate:

```bash
bunx vitest run tests/thread-workspace-banner.test.tsx tests/thread-timeline-codex-tool-card.test.ts
```

### Phase 5. End-to-End Regression

Run the representative repo gate.

```bash
bun run verify
git diff --check
```

Expected:

- Typecheck, lint, supervisor regression tests, desktop runtime tests, desktop lint, and desktop build pass.
- No whitespace errors.
- Contract warnings are testable, but no new Timeline warning UI appears.

## Acceptance Criteria

- Multi-step Codex work has a clear prompt-level requirement to update `nightworkers.todo_list`.
- Codex audit can detect missing, list-only, and stale TodoList progress.
- Missing TodoList progress is recorded as contract warning, not as Timeline noise.
- Existing TodoList pane remains the user-facing progress surface.
- Native/API closeout guidance keeps requiring `todo_list done/block/fail` for open Todos.
- Focused tests and `bun run verify` pass.

## Stop Conditions

Stop and revise if:

- The implementation requires a new Timeline warning UI to pass tests.
- Contract warnings become terminal for normal simple answers.
- `todo_list operation=list` becomes treated as progress.
- The change requires reworking `task_run_todos` schema.
- TodoList UI cannot reflect updated DB state without broader workspace state refactoring.

## Residual Risk

This plan cannot force an external model to always choose the right Todo granularity. It makes missing progress updates detectable, testable, and visible through existing TodoList state when the tool is used. If warnings remain frequent after rollout, a later slice can promote selected contract warnings from non-terminal to `needs_human`, but that should be based on observed runs rather than added upfront.

## Completion Criteria

The work is complete when:

- Prompt contracts for Codex and native/API explicitly require TodoList progress updates.
- Codex runtime records non-terminal contract warnings for missing/list-only/stale TodoList progress.
- Existing TodoList pane shows progress for representative multi-step work.
- No Timeline warning UI is added.
- Focused tests and `bun run verify` pass.
