# Review Additional Prompts Implementation Plan

## Purpose

Review Mode の「提案ゴール」を廃止し、同じ Workbench Session に追加投入できる「追加プロンプトカード」に置き換える。

現在の提案ゴールは、review finding を別の Goal / Task 候補へ変換する流れになっている。しかし実際の用途は、新しい goal を立てることではなく、「この task / session でまだやるべきことを、もう数ラウンド agent に続けさせる」ことである。

この計画の目的は次の3点に絞る。

- Review finding 由来の follow-up を、Goal や別 Task ではなく追加プロンプトとして扱う。
- ユーザーが任意のタイミングで、そのプロンプトを同一 session に投入できるようにする。
- Review Status 画面を単純化し、最大5件程度のおすすめプロンプトカードを表示する。

## Confirmed Baseline

現状の Review Mode には次の実装がある。

- `review_status` artifact が Review Mode の primary artifact である。
- `ReviewStatusViewer` は section、findings、proposed goals、knowledge candidates、final action を表示する。
- finding disposition には `proposed_goal` がある。
- `proposed_goal` disposition を保存すると `review_proposed_goals` に draft 候補が作られる。
- proposed goal は `approved` / `rejected` / `deferred` / `materialized` の状態を持つ。
- `approved` の proposed goal は draft Task に materialize できる。
- materialized Task は `createdBy: 'review-mode'` で作られ、元 review session / finding / evidence refs を task message に持つ。

Relevant files:

- `api/db/review-mode-schema.ts`
- `api/db/review-mode-schema-bootstrap.ts`
- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
- `api/modules/nightworkers/nightworkers.review-mode.repository.ts`
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
- `api/modules/nightworkers/routes/run-routes.ts`
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
- `src/modules/nightworkers/types/review.ts`
- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/modules/nightworkers/hooks/useNightWorkersMutations.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/i18n/dictionaries/ja.ts`
- `tests/review-mode.test.ts`
- `tests/review-status-viewer.test.tsx`

## Problem

「提案ゴール」は実態より概念が大きい。

Review finding でよく出る内容は、例えば「保存済みの検証記録が足りない」「final report の完了主張と Run 記録が一致していない」「self-review follow-up が残っている」のような未完了事項である。これは新しい Goal でも、別 Task / Session として切り出す仕事でもない。現在の task をそのまま続けさせる追加指示の粒度である。

そのため、現状の flow には次の違和感がある。

- 「Goal」と呼ぶことで Mission Goal / Project Detail のタスク生成ゴールと混同する。
- `approve -> task materialize` が重く、同じ session に少し追加で投げるだけの用途に合わない。
- Draft Task を作ると、ユーザーが本来期待する「この agent にもう少し続けさせる」体験から外れる。
- Review Status に「提案ゴール」が出ても、何をいつ実行すればよいかが分かりにくい。

## Design Direction

### Goal ではなく追加プロンプトにする

User-visible concept:

- `提案ゴール` を削除する。
- 代わりに `追加プロンプト` を表示する。
- カードは「この session に次に投げるとよい prompt」を表す。

Internal concept:

- `review_proposed_goals` を `review_prompt_suggestions` に置き換える。
- `proposed_goal` disposition を `prompt_suggestion` に置き換える。
- section kind は `proposed_goals` ではなく `prompt_suggestions` にする。

Recommended naming:

- UI section label: `追加プロンプト`
- internal table: `review_prompt_suggestions`
- type: `ReviewPromptSuggestion`
- finding disposition: `prompt_suggestion`
- section kind: `prompt_suggestions`

### 同じ session に投入する

追加プロンプトは別 Task を作らない。Queue に入れない。Mission Goal に接続しない。

カードの action は同じ Workbench Session への continuation に限定する。

- `入力に入れる`
  - chat input に prompt を挿入する。
  - LLM call はまだ発生しない。
  - ユーザーが編集して送信できる。
- `このプロンプトで続ける`
  - 同じ session に user message として送信し、通常の agent continuation を開始する。
  - ボタン押下が明示的な実行タイミングであり、自動実行ではない。

初期実装では両方を入れる。もし UI の接続コストが大きい場合は、先に `入力に入れる` を必須、`このプロンプトで続ける` を後続にしてよい。

### 最大5件を目安にする

追加プロンプトカードは Review Status 上で最大5件を目安に表示する。

生成ルール:

- unresolved / blocking / warning finding を優先する。
- required section 由来の finding を優先する。
- 同じ原因の finding は1枚にまとめる。
- `accepted_risk` / `ignored` / `dismissed` の finding からは作らない。
- evidence refs がない finding からは原則作らない。
- すでに used / dismissed の prompt は再生成しない。

上限:

- default limit: 5
- API 内部でも5件を上限にする。
- UI は5件を超える古い saved records があっても、active なおすすめとしては上位5件だけを出す。

### LLM 生成ではなくまず deterministic で作る

初期実装では、追加プロンプト本文は deterministic template で作る。

理由:

- Review Mode の初期方針は deterministic evidence / recommendation を中心にしている。
- LLM にカード生成を任せると、review finding の evidence 境界が曖昧になる。
- 今回の目的は「次に投げる prompt を表示する」ことであり、自然文の洗練ではない。

将来拡張:

- optional LLM polish lane を追加して、deterministic draft を短く整えることは許容する。
- ただし LLM は evidence-less prompt を追加できない。
- deterministic blocking finding を LLM が消すことは禁止する。

## Target Behavior

### Review Status

Review Status に `追加プロンプト` section を表示する。

カード表示内容:

- title
- prompt body
- source finding title
- severity
- expected outcome
- evidence summary
- status
- actions

Actions:

- `入力に入れる`
- `このプロンプトで続ける`
- `破棄`

Optional action:

- `コピー`

### Finding disposition

Finding の disposition selector から `提案ゴール` を消し、`追加プロンプト` を追加する。

When saved:

- finding に `disposition: 'prompt_suggestion'` を保存する。
- disposition status は `converted` にする。
- 対応する `review_prompt_suggestions` row を作る。
- row 作成が失敗した場合、finding disposition は保存しない。

### Prompt suggestion generation

`追加プロンプト` section の実行、または finding disposition の保存で prompt suggestion を作る。

Prompt template:

```text
次のレビュー指摘を解消するため、この session の作業を続けてください。

指摘:
{finding.title}

背景:
{finding.body}

やること:
- 関連する証跡と差分を確認する
- 必要な追加実装または追加修正を行う
- focused verification を実行する
- 結果をこの session に報告する

完了条件:
{acceptanceCriteria}

検証:
{verificationHint}
```

The exact wording can be adjusted, but it must remain an actionable prompt for the current session, not a goal definition.

### Using a prompt card

`入力に入れる`:

- Review Status viewer calls a workspace callback with the prompt text.
- Shell sets the active chat input value.
- No task message is created.
- Prompt suggestion status remains `draft`.

`このプロンプトで続ける`:

- Review Status viewer calls a workspace callback with the prompt suggestion id.
- Backend records the prompt suggestion as `used`.
- Existing session message submission path sends the prompt as a new user message for the same task/session.
- A normal run can start from that message according to existing Workbench behavior.
- No draft Task is created.

`破棄`:

- status becomes `dismissed`.
- The card is hidden from active recommendations but remains persisted.

## Data Model

Replace `review_proposed_goals` with `review_prompt_suggestions`.

```ts
type ReviewPromptSuggestionStatus =
  | 'draft'
  | 'used'
  | 'dismissed';

type ReviewPromptSuggestion = {
  id: string;
  reviewSessionId: string;
  findingId: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  title: string;
  prompt: string;
  expectedOutcome: string;
  acceptanceCriteria: string;
  verificationHint: string;
  evidenceRefs: ReviewEvidenceRef[];
  status: ReviewPromptSuggestionStatus;
  useCount: number;
  lastUsedAt: string | null;
  dismissedAt: string | null;
  createdMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Schema notes:

- `finding_id` should remain unique.
- `status` default is `draft`.
- `use_count` default is `0`.
- `created_message_id` is nullable and only filled when the direct submit path creates a user message.
- Keep `review_session_id, status` index.

Migration:

- Add new table `review_prompt_suggestions`.
- Migrate existing `review_proposed_goals` rows where possible:
  - `title` -> `title`
  - `expected_outcome` -> `expectedOutcome`
  - generated prompt from title / expected outcome / acceptance criteria / verification gate
  - `draft`, `approved`, `deferred` -> `draft`
  - `rejected` -> `dismissed`
  - `materialized` -> `used`
- After migration, code should stop reading `review_proposed_goals`.
- A later cleanup migration can drop `review_proposed_goals` after compatibility confidence is high.

## API Changes

Remove or deprecate:

- `POST /api/review-sessions/:id/proposed-goals`
- `PATCH /api/review-sessions/:id/proposed-goals/:goalId`
- `POST /api/review-sessions/:id/proposed-goals/:goalId/materialize`

Add:

- `POST /api/review-sessions/:id/prompt-suggestions`
  - creates / syncs prompt suggestions for eligible findings.
  - returns `ReviewSessionDetail`.
- `PATCH /api/review-sessions/:id/prompt-suggestions/:suggestionId`
  - supports `{ status: 'dismissed' }`.
  - returns `ReviewSessionDetail`.
- `POST /api/review-sessions/:id/prompt-suggestions/:suggestionId/use`
  - marks suggestion used.
  - optionally creates or references a user message if direct submit is implemented backend-first.
  - returns `ReviewSessionDetail` plus prompt payload if needed by the client.

Preferred UI flow:

- For `入力に入れる`, no backend mutation is required.
- For `このプロンプトで続ける`, use the existing chat submit path and then mark the suggestion as used.

## UI Changes

### ReviewStatusViewer

Replace proposed goal UI with prompt suggestion UI.

Remove:

- `onCreateProposedGoals`
- `onUpdateProposedGoal`
- `onMaterializeProposedGoal`
- approve / reject / defer / task buttons
- materialized task id display

Add:

- `onCreatePromptSuggestions`
- `onDismissPromptSuggestion`
- `onInsertPromptSuggestion`
- `onUsePromptSuggestion`

Cards:

- Show up to 5 active draft suggestions.
- Show used / dismissed suggestions in a collapsed or secondary area only if needed.
- Do not show `Goal` or `Task` wording in this section.

### Workbench Shell

Add a callback path from `ReviewStatusViewer` to the active chat composer.

Required behavior:

- `onInsertPromptSuggestion(prompt)` sets chat input to prompt.
- If there is existing unsent input, ask for confirmation or append below a separator.
- Keep the active artifact pane open.
- Do not switch to Project Detail or create a new Task.

Direct send behavior:

- `onUsePromptSuggestion(suggestion)` submits the prompt to the current session using the same path as manual user input.
- It must be explicit from the button label that this starts a continuation.
- The review artifact should remain available after the run starts.

## Status Artifact Changes

Change `ReviewStatusArtifact` counts:

From:

```ts
proposedGoalCount: number;
```

To:

```ts
promptSuggestionCount: number;
```

Change section kind:

From:

```ts
'proposed_goals'
```

To:

```ts
'prompt_suggestions'
```

Section reason:

- Current: `Create follow-up Goal candidates only when findings need follow-up work.`
- New: `Create additional prompts when findings should be handled by continuing this session.`

## Implementation Plan

### Phase 0. Baseline and Test Rename

Capture current behavior before changing it.

Tests:

- Existing proposed goal flow creates draft Task after approval/materialization.
- Evidence-less finding cannot become proposed goal.
- ReviewStatusViewer shows proposed goal controls.

Then update tests to express the new desired behavior:

- Finding disposition `prompt_suggestion` creates a draft prompt suggestion.
- Evidence-less finding cannot become prompt suggestion.
- Prompt suggestion does not create a Task.
- Prompt suggestion can be inserted into the composer.
- Prompt suggestion can be marked used after explicit continuation.
- ReviewStatusViewer shows at most 5 active cards.

Gate:

```bash
bunx vitest run tests/review-mode.test.ts tests/review-status-viewer.test.tsx
```

### Phase 1. Types and Schema

Files:

- `api/db/review-mode-schema.ts`
- `api/db/review-mode-schema-bootstrap.ts`
- `src/modules/nightworkers/types/review.ts`
- `api/modules/nightworkers/nightworkers.review-mode.model.ts`

Changes:

- Add `reviewPromptSuggestions` table.
- Add `ReviewPromptSuggestion` type.
- Replace `ReviewProposedGoal` fields in `ReviewSessionDetail`.
- Replace `proposed_goals` section kind with `prompt_suggestions`.
- Replace counts in `ReviewStatusArtifact`.
- Keep compatibility parsing only where needed for migration.

Gate:

```bash
bun run typecheck
```

### Phase 2. Backend Service and Repository

Files:

- `api/modules/nightworkers/nightworkers.review-mode.repository.ts`
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
- `api/modules/nightworkers/routes/run-routes.ts`
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.service.ts`

Changes:

- Replace proposed goal repository helpers with prompt suggestion helpers.
- Add `ensureReviewPromptSuggestion`.
- Update finding disposition handling from `proposed_goal` to `prompt_suggestion`.
- Generate prompt suggestion rows before updating finding disposition.
- Add sync / dismiss / use service functions.
- Remove draft Task materialization path from Review Mode.
- Update OpenAPI schemas and handlers.

Important rule:

- Do not update finding disposition until downstream prompt suggestion row creation succeeds.

Gate:

```bash
bunx vitest run tests/review-mode.test.ts
```

### Phase 3. Frontend Commands and Workspace State

Files:

- `src/modules/nightworkers/nightWorkersCommands.ts`
- `src/modules/nightworkers/hooks/useNightWorkersMutations.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/nightworkers/hooks/nightWorkersWorkspaceState.ts`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`

Changes:

- Add client commands for prompt suggestions.
- Remove proposed goal commands from ReviewStatusViewer props.
- Add callback for inserting prompt into chat input.
- Add callback for direct continuation with prompt.
- Ensure direct continuation uses the existing session message submit path.
- Invalidate `reviewSession` query after used / dismissed mutations.

Risk:

- The existing composer state may not be controlled from this callback today. If so, add a narrow setter at the shell/composer boundary instead of creating a global event bus.

Gate:

```bash
bunx vitest run tests/review-status-viewer.test.tsx
```

### Phase 4. ReviewStatusViewer UI

Files:

- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
- `src/i18n/dictionaries/ja.ts`

Changes:

- Rename visible section from `提案ゴール` to `追加プロンプト`.
- Replace approve / reject / defer / task controls with prompt actions.
- Show at most 5 active suggestions.
- Show source finding / severity / expected outcome.
- Use Japanese labels:
  - `追加プロンプト`
  - `入力に入れる`
  - `このプロンプトで続ける`
  - `破棄`
  - `使用済み`
- Remove `Goal` wording from the Review Status surface.

Gate:

```bash
bunx vitest run tests/review-status-viewer.test.tsx
```

### Phase 5. Migration and Compatibility Cleanup

Files:

- `drizzle/migrations/*`
- `api/db/review-mode-schema-bootstrap.ts`

Changes:

- Add migration for `review_prompt_suggestions`.
- Migrate existing `review_proposed_goals` data best-effort.
- Keep old table untouched initially unless project convention requires dropping.
- Update bootstrap so fresh DBs create only the new prompt suggestion table.
- Remove old API handlers after tests confirm no call sites remain.

Search checks:

```bash
rg -n "proposedGoal|proposed_goals|proposed_goal|ProposedGoal|review_proposed_goals" src api tests
```

Expected:

- No active code references except migration compatibility comments or archived specs.

### Phase 6. Full Verification

Run focused gates first:

```bash
bunx vitest run tests/review-mode.test.ts tests/review-status-viewer.test.tsx
bun run typecheck
```

Then repo gate:

```bash
bun run verify
```

Manual UI check:

1. Open a task with review session.
2. Run review sections until findings exist.
3. Mark a finding as `追加プロンプト`.
4. Confirm a prompt card appears.
5. Confirm there are no Goal / Task materialization controls.
6. Click `入力に入れる`.
7. Confirm chat input is populated and no run starts.
8. Click `このプロンプトで続ける`.
9. Confirm the same session receives a continuation and the card becomes used.

## Acceptance Criteria

- Review Status no longer exposes `提案ゴール`.
- Review finding disposition no longer exposes `proposed_goal` / `提案ゴール`.
- Review findings can create additional prompt cards.
- Active prompt cards are capped at 5.
- Prompt cards do not create draft Tasks.
- A prompt can be inserted into the current session composer without starting a run.
- A prompt can be explicitly used to continue the same session.
- Used / dismissed prompt cards are persisted.
- Existing Review Mode final action gating still works.
- Knowledge candidate and security handoff flows are unchanged.
- Focused tests and `bun run verify` pass.

## Out of Scope

- Mission Goal integration.
- Project Detail task generation changes.
- Automatic execution of prompt suggestions.
- LLM-generated review verdicts.
- LLM-only prompt suggestion generation.
- New Queue states.
- New Kanban columns.
- Creating new Tasks from Review Mode prompt suggestions.
- Reworking ReviewRecommendation rules beyond renaming the prompt suggestion section.

## Notes for Implementation

- Treat this as a simplification, not a new automation feature.
- Preserve Review Mode as an overlay on completed execution; do not rewind run status.
- Keep prompt Japanese where user-visible.
- Avoid broad refactors of Plan Mode, Mission Planner, or Project Detail.
- If migration complexity is high, keep read-only compatibility for old proposed goal rows but hide them from the new UI unless converted.
