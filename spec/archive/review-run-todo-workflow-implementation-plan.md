# Review Run TODO Workflow Implementation Plan

## Purpose

Review Mode を、現行の section / precheck 中心の仕組みから、**Plan 仕様書**と**この run でエージェントが編集したファイル**を入力にした TODO ベースのレビュー実行モデルへ置き換える。

この計画での Review Mode は、単独の「テスト証跡確認」機能ではない。実装 run の closeout 後に、実装時と同じ runtime / tool 能力を使って、コードレビュー、テスト証跡確認、セキュリティレビュー、必要な修正、必要な commit までを TODO として実行する review run である。

主な狙い:

- Plan Mode の仕様書をレビュー時の source of truth にする。
- レビュー対象を `git diff 全体` ではなく、この run の編集シグナルから抽出したファイルに限定する。
- `git diff` は対象選定の主役ではなく、対象ファイルの差分本文と整合性確認に使う。
- LLM reviewer は provider-native tool turn 専用経路ではなく、実装時と同じ Codex / native API runtime と worker tools を使う。
- Review Mode の永続化・findings・prompt suggestions・final action の外枠は可能な限り残す。
- 現行の `test_coverage` precheck / agentic split は置換対象にする。

## Current Baseline

現行 Review Mode には、残せる外枠と、今回の方針では置換すべき実行ロジックが混在している。

残せる外枠:

- `review_sessions`
- `review_recommendations`
- `review_artifacts`
- `review_findings`
- `review_prompt_suggestions`
- `review_security_handoffs`
- review session route 群
- finding disposition
- prompt suggestion の draft / used / dismissed
- final action
- `ReviewStatusViewer` の大枠

置換対象:

- `ReviewSectionKind` を中心にした固定 section model
- `test_coverage` section の必須実行
- `buildTestEvidencePrecheck`
- `runAgenticTestEvidenceReview`
- provider-native tool turn 前提の agentic test evidence reviewer
- `precheck_only` / `agentic_review` artifact payload
- `planSections()` の現行固定 section 構成
- `autoStartReviewSessionForRun` が required `test_coverage` を自動実行する流れ

現行実装の問題:

- `codex` provider は `callProviderToolTurn` の native tool turn runtime をサポートしていない。
- Review Mode の実行単位が runtime TODO ではなく section handler なので、実装時と同じ tool 履歴・チャット履歴・修正実行モデルに乗らない。
- `git diff` 全体を使うと、この run でエージェントが編集していない dirty file が混ざる。
- precheck はテスト名一致の補助情報としては使えるが、Review Mode の主実行モデルとしては弱い。

## Locked Decisions

初期実装で再判断しない決定事項:

- Review Mode は `Review Run` として扱う。
- Review Run は options から TODO を生成して実行する。
- Plan 仕様書をレビュー時の source of truth にする。
- レビュー対象ファイルは、この run の編集シグナルから抽出する。
- `git diff` は対象ファイルの差分本文取得と整合性確認に使う。
- edit signal のない dirty file は初期状態ではレビュー対象外にし、artifact / chat に warning として出す。
- LLM によるコードレビュー、テスト証跡確認、セキュリティレビューは独立した TODO として実行する。
- セキュリティレビューは NightWorkers 内の ad hoc 解析ではなく、CLI で `vulnWorkbench` を呼び、scanner-backed evidence と scan review output を取り込む。
- `発見した指摘点を即座に修正する` が ON の場合だけ、review findings から修正 TODO を生成する。
- `git commit も行う` が ON の場合だけ、修正後の verify と diff 確認を通して commit TODO を実行する。
- commit は `applyFixes` の有無に関係なく、Review Run の対象差分に対して明示 option が ON の場合だけ実行する。
- 現行 DB tables は初期実装では削除しない。
- 現行 `test_coverage` precheck / agentic reviewer は新 Review Run の主経路から外す。

## User Visible Workflow

Review Mode の起動場所は artifact 画面のまま維持する。

起動 UI は checkbox options を持つ。

```ts
type ReviewRunOptions = {
	codeReview: boolean;
	testEvidenceReview: boolean;
	securityReview: boolean;
	applyFixes: boolean;
	commitChanges: boolean;
};
```

初期 default:

```ts
{
	codeReview: true,
	testEvidenceReview: true,
	securityReview: false,
	applyFixes: false,
	commitChanges: false,
}
```

UI 方針:

- artifact 画面では Review Run の起動、option 選択、最新状態、findings summary を表示する。
- 実行中の tool 履歴、LLM の進行、最終報告はチャット欄 / timeline に流す。
- Review Run の結果 artifact には、対象ファイル、除外 dirty files、TODO summary、findings、修正/commit 結果を保存する。
- in-app text で「使い方説明」を増やさず、状態と結果を簡潔に表示する。

## Review Target Extraction

新規 service を追加する。

```text
api/modules/nightworkers/nightworkers.review-targets.service.ts
```

責務:

- run に紐づく `task_events` を読む。
- `git.diff_collected` events から edit signal を抽出する。
- Codex `file_change` 由来と post-run git diff 由来を区別する。
- この run が編集したファイル候補を正規化する。
- repository の現在 diff と突き合わせる。
- Review Run に渡す target files / warnings を返す。

入力:

```ts
type BuildReviewTargetInput = {
	runId: string;
};
```

出力:

```ts
type ReviewTarget = {
	runId: string;
	taskId: string;
	repositoryId: string;
	repoRoot: string;
	planArtifact: {
		messageId: string | null;
		title: string | null;
		source: "plan_artifact" | "missing";
	};
	targetFiles: ReviewTargetFile[];
	excludedDirtyFiles: string[];
	signalOnlyFiles: string[];
	diffOnlyFiles: string[];
	warnings: ReviewTargetWarning[];
};

type ReviewTargetFile = {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "unknown";
	sources: Array<
		| "codex_file_change"
		| "post_run_git_diff"
		| "native_tool_edit"
		| "run_diff_patch"
		| "current_git_diff"
	>;
	eventIds: string[];
	diff: string;
	diffBytes: number;
};

type ReviewTargetWarning = {
	code:
		| "plan_artifact_missing"
		| "no_edit_signals"
		| "edit_signal_without_current_diff"
		| "current_diff_without_edit_signal"
		| "diff_read_failed"
		| "target_file_limit_exceeded";
	severity: "info" | "warning" | "blocking";
	message: string;
	paths?: string[];
};
```

Extraction rules:

1. Canonicalize run events with `canonicalizeTaskEvent`.
2. Read events where `type === "git.diff_collected"`.
3. Extract file paths from:
   - `data.changedFiles`
   - `data.changes[].path`
   - `data.diff` diff headers
   - `run.diffPatch` diff headers as fallback
4. Normalize paths to repository-relative POSIX paths.
5. Reject paths outside repository root.
6. Read current diff only for target paths.
7. Compare target paths with full current dirty files.
8. Store dirty files not supported by edit signal in `excludedDirtyFiles`.

Important:

- `sessionId` is not the primary boundary. Use `runId`.
- If only `sessionId` is available from UI, resolve latest completed run for that task first.
- `git diff` must not expand review scope by default.
- If current diff contains files with no edit signal, surface warning rather than silently reviewing them.

## Plan Specification Source

Review Run must read the Plan Mode specification artifact before reviewing code.

Preferred source:

- latest accepted / active implementation plan artifact associated with the task.

Fallback:

- latest task message artifact that is recognized as Feature Plan / Plan Mode implementation plan.

Failure behavior:

- If no plan artifact is found, Review Run may still run code review only if `codeReview` is selected, but must emit a warning finding:
  - title: `Plan specification was not found for review`
  - severity: `warning`
  - source: `review_target`
- `testEvidenceReview` should become `needs_human` if acceptance criteria cannot be read from the plan.

Plan extraction output:

```ts
type ReviewPlanSpec = {
	sourceMessageId: string | null;
	title: string | null;
	body: string;
	acceptanceCriteria: string[];
	verificationHints: string[];
	securityNotes: string[];
	implementationScopeHints: string[];
};
```

Do not infer acceptance criteria primarily from task title or final report when a Plan artifact exists.

## Review Run TODO Model

Introduce a new runtime path for Review Run.

Option A, preferred:

- Start a normal NightWorkers run with a review execution mode.
- Build initial TODOs from `ReviewRunOptions`.
- Use existing Codex / native API runtime adapter.
- Persist runtime events through existing ledger sink.

Option B, fallback:

- Implement a service-level Review Run executor that creates review artifacts and findings directly.
- This should only be used if the normal run orchestration cannot be reused safely.

Preferred new execution mode:

```ts
type NativeApiExecutionMode = ... | "review";
```

Review TODO generation:

```ts
function buildReviewRunTodos(input: {
	options: ReviewRunOptions;
	target: ReviewTarget;
	planSpec: ReviewPlanSpec;
}): ImplementationTodoInput[] {
	// 1. Read plan spec
	// 2. Read review target summary
	// 3. Code review
	// 4. Test evidence review
	// 5. Security review
	// 6. Consolidate findings
	// 7. Apply fixes
	// 8. Verify
	// 9. Commit
}
```

Initial TODO set:

| Option | TODO | Required tools |
| --- | --- | --- |
| always | Review Plan 仕様書を読む | read artifact / read file |
| always | この run の編集対象と diff を確認する | run event read / git diff |
| `codeReview` | Plan 仕様と対象 diff を照合し、コードレビュー findings を作る | read/search/CLI as needed |
| `testEvidenceReview` | 受け入れ条件ごとのテスト証跡を確認する | read/search/focused test command |
| `securityReview` | 対象 diff を `vulnWorkbench` CLI でセキュリティ診断し、scan review findings を取り込む | vulnWorkbench CLI |
| always | findings を統合して artifact に保存する | review artifact write |
| `applyFixes` | accepted findings を修正する | edit tools / CLI |
| `applyFixes` | 修正後に verify を実行する | verify command |
| `commitChanges` | review 対象差分を commit する | git status/diff/commit |

Rules:

- Review Run must not start with the old `test_coverage` section runner.
- Each selected option becomes visible TODO work.
- Tool history must be emitted to chat/timeline via existing runtime events.
- Findings must be persisted after review TODOs complete.
- Security review findings must come from `vulnWorkbench` CLI output or explicitly state that the CLI was unavailable.
- Fix TODOs must not run unless `applyFixes` is selected.
- Commit TODO must not run unless `commitChanges` is selected.

## vulnWorkbench Security Diagnostic

When `securityReview` is selected, Review Run must call `vulnWorkbench` through CLI commands.

Default command root:

```text
/Users/y.noguchi/Code/vulnWorkbench
```

This path must be configurable. Suggested settings:

```ts
type VulnWorkbenchCliSettings = {
	enabled: boolean;
	cwd: string;
	projectIdByRepositoryId: Record<string, string>;
	defaultProfile: "baseline" | "detailed-security";
	timeoutSeconds: number;
};
```

Initial default:

```ts
{
	enabled: true,
	cwd: "/Users/y.noguchi/Code/vulnWorkbench",
	projectIdByRepositoryId: {},
	defaultProfile: "baseline",
	timeoutSeconds: 600,
}
```

NightWorkers must not invent vulnerability findings from LLM review alone when `securityReview` is selected. The security TODO should:

1. Resolve the NightWorkers repository to a configured `vulnWorkbench` project id.
2. Run a bounded static scan profile.
3. Run scan review / handoff generation for the scan run.
4. Optionally export Static Intelligence evidence for the scan run.
5. Convert scanner-backed findings and scan review output into `review_findings`.
6. Persist the raw command summaries and output metadata in the Review Run artifact.

Required CLI flow:

```bash
cd /Users/y.noguchi/Code/vulnWorkbench

bun run scan:profile -- \
  --project-id <vulnWorkbench-project-id> \
  --profile baseline \
  --timeout-sec 600 \
  --report-output <nightWorkers-review-artifacts-dir>/vulnworkbench-report.md

bun run review:scan -- \
  --scan-run-id <scan-run-id> \
  --task scan_review
```

Optional CLI flow for richer agent-facing evidence:

```bash
bun run intelligence:export -- --scan-run-id <scan-run-id>
bun run intelligence:guardrail-material -- --scan-run-id <scan-run-id>
```

`detailed-security` may be used when `securityReview` is selected and the Review Run recommendation is required or the changed files include security-sensitive paths:

```bash
bun run scan:profile -- \
  --project-id <vulnWorkbench-project-id> \
  --profile detailed-security \
  --timeout-sec 1200 \
  --report-output <nightWorkers-review-artifacts-dir>/vulnworkbench-detailed-report.md
```

Command result contract:

```ts
type VulnWorkbenchSecurityResult = {
	ok: boolean;
	projectId: string | null;
	scanRunId: string | null;
	profile: "baseline" | "detailed-security";
	commandsRun: Array<{
		command: string;
		exitCode: number | null;
		summary: string;
	}>;
	reportPath: string | null;
	findingCount: number;
	highOrCriticalCount: number;
	improvementRequest: string | null;
	error: string | null;
};
```

Failure handling:

- If `vulnWorkbench` is disabled or no project id is configured, create a `warning` finding:
  - title: `vulnWorkbench security diagnostic was not configured`
  - category: `security`
  - recommendedAction: `follow_up`
- If the CLI exits non-zero, create a `warning` finding with command summary and mark the security TODO `needs_human`.
- If the CLI succeeds with zero findings, persist an informational security finding or artifact summary that states the scan profile and scan run id.
- Do not pass LLM provider credentials to scanner containers or target project environments.
- Do not treat Static Intelligence candidate material as confirmed vulnerability evidence without scanner-backed finding/evidence.

## LLM Reviewer Prompt Contract

The review runtime prompt should include:

- Plan specification summary.
- Acceptance criteria.
- Review target files.
- Diff snippets for target files.
- Excluded dirty files warning.
- Selected options.
- Required output contract.

The reviewer must:

- Review only target files unless it needs context reads.
- Use repository reads/searches to verify assumptions.
- Cite file paths and line numbers where possible.
- Distinguish defects from questions and low-confidence notes.
- Not claim test evidence from logs alone.
- For test evidence, report command/file/test-name/body evidence separately.
- For security review, use `vulnWorkbench` CLI output as the primary evidence and map scanner-backed findings to Review Mode findings.
- For security review, focus on changed attack surface, auth, data exposure, secrets, injection, dependency/config risk, but do not present LLM-only concerns as confirmed vulnerabilities.
- If `applyFixes` is disabled, do not modify files.
- If `commitChanges` is disabled, do not commit.

Finding output:

```ts
type ReviewRunFinding = {
	severity: "blocking" | "warning" | "info";
	category: "code_review" | "test_evidence" | "security" | "process";
	title: string;
	body: string;
	path?: string;
	line?: number;
	evidenceRefs: ReviewEvidenceRef[];
	recommendedAction: "fix_now" | "follow_up" | "accept_risk" | "dismiss";
	confidence: "high" | "medium" | "low";
};
```

## Persistence Changes

Keep existing tables for the initial implementation.

Use `review_artifacts` for new artifact kinds:

```ts
type ReviewArtifactKind =
	| "review_status"
	| "review_run"
	| "review_targets"
	| "review_findings_summary";
```

Initial DB migration is not required if `kind` remains free-form text.

Store Review Run artifact:

```ts
type ReviewRunArtifact = {
	version: 1;
	kind: "review_run";
	runId: string;
	taskId: string;
	repositoryId: string;
	options: ReviewRunOptions;
	status: "not_started" | "running" | "needs_human" | "done" | "failed";
	target: ReviewTargetSummary;
	todos: ReviewRunTodoSummary[];
	findings: ReviewRunFinding[];
	fixesApplied: boolean;
	commit: {
		requested: boolean;
		created: boolean;
		sha: string | null;
		message: string | null;
		error: string | null;
	};
	warnings: ReviewTargetWarning[];
};
```

Existing `review_findings` rows remain the primary query surface for actionable findings.

## API Changes

Add or replace Review Run start endpoint.

Preferred:

```http
POST /api/review-sessions/:id/run
```

Body:

```json
{
  "options": {
    "codeReview": true,
    "testEvidenceReview": true,
    "securityReview": false,
    "applyFixes": false,
    "commitChanges": false
  }
}
```

Response:

```ts
type ReviewSessionDetail = {
	session: ...;
	recommendation: ...;
	statusArtifact: ...;
	artifacts: ...;
	findings: ...;
	promptSuggestions: ...;
	securityHandoffs: ...;
};
```

Deprecate:

```http
POST /api/review-sessions/:id/sections/:section/run
```

Initial compatibility:

- Keep the old route for one release if UI/tests still call it.
- Route calls for old sections to a clear error once new UI no longer depends on them:
  - code: `REVIEW_SECTIONS_DEPRECATED`
  - message: `Review sections were replaced by Review Run.`

## UI Changes

Update artifact-pane Review Mode entry point:

- Replace section buttons with Review Run options.
- Show checkbox controls:
  - LLM によるコードレビュー
  - テスト証跡確認
  - セキュリティレビュー
  - 発見した指摘点を即座に修正する
  - git commit も行う
- Disable `git commit も行う` until target extraction succeeds.
- If `発見した指摘点を即座に修正する` is off, show findings only.
- If dirty files outside target are detected, show warning summary.

Keep:

- findings list
- prompt suggestion list
- final action controls

Remove from primary UI:

- `precheck_only`
- `agentic_review`
- section progress for `test_coverage`, `security_review`, `findings`, `prompt_suggestions`

## File-Level Implementation Plan

### Add

- `api/modules/nightworkers/nightworkers.review-targets.service.ts`
  - extracts run edit signals and target diffs.
- `api/modules/nightworkers/nightworkers.review-run.service.ts`
  - creates Review Run artifacts, starts runtime run, maps results to findings.
- `api/modules/nightworkers/nightworkers.review-vulnworkbench.service.ts`
  - resolves configured `vulnWorkbench` project ids, runs security CLI commands, parses scan/review output summaries, and maps scanner-backed results to Review Mode findings.
- `tests/review-targets.test.ts`
  - covers target extraction from `git.diff_collected`.
- `tests/review-run-workflow.test.ts`
  - covers options to TODO generation and artifact persistence.
- `tests/review-vulnworkbench.test.ts`
  - covers CLI command construction, disabled/unconfigured behavior, non-zero exits, and scanner-backed finding mapping.

### Modify

- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
  - keep session detail/status/finding helpers.
  - replace `runReviewSection` primary path with Review Run start path.
  - stop auto-running `test_coverage`.
- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
  - add Review Run artifact types.
  - deprecate fixed section planning.
- `api/modules/nightworkers/routes/run-routes.ts`
  - add `POST /review-sessions/:id/run`.
  - mark section run route deprecated.
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
  - wire new handler.
- `src/modules/nightworkers/nightWorkersCommands.ts`
  - add `startReviewRun`.
  - stop using `runReviewSection` from the main Review UI.
- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
  - replace section controls with options + Review Run status.
  - keep findings/prompt suggestions/final action rendering.
- `src/modules/nightworkers/types/review.ts`
  - add Review Run artifact and options types.

### Remove From Main Path

- `api/modules/nightworkers/nightworkers.review-mode.test-evidence-precheck.ts`
- `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.ts`
- `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.schema.ts`
- old `test_coverage` specific artifact parsing in `ReviewStatusViewer`

Initial implementation may leave files in place if tests still need compatibility, but they must not be called by the new Review Run path.

## Phased Rollout

### Phase 1: Target Extraction

Implement `nightworkers.review-targets.service.ts`.

Tasks:

- Read run, task, repository.
- Read task events.
- Extract changed files from `git.diff_collected`.
- Parse current git diff for target files.
- Produce `ReviewTarget`.
- Add warnings for diff/edit-signal mismatch.

Tests:

```bash
bun run test run tests/review-targets.test.ts
```

Acceptance criteria:

- Codex `file_change` event with `changedFiles` produces target files.
- post-run `git.diff_collected` with `changedFiles` produces target files.
- current dirty file without edit signal is excluded and warned.
- edit signal without current diff is reported as `signalOnlyFiles`.

### Phase 2: Review Run Artifact And TODO Generation

Implement Review Run options and TODO generation.

Tasks:

- Add Review Run artifact shape.
- Add option parsing and defaults.
- Generate TODOs from selected options.
- Persist `review_targets` and initial `review_run` artifacts.

Tests:

```bash
bun run test run tests/review-run-workflow.test.ts
```

Acceptance criteria:

- selected options create expected TODOs.
- unselected options do not create TODOs.
- apply fixes and commit TODOs are gated by options.
- missing plan artifact creates warning but does not crash code review path.

### Phase 3: Runtime Execution Integration

Wire Review Run into existing runtime.

Tasks:

- Add review execution mode or review-specific runtime lane setup.
- Build runtime prompt from plan spec, target diff, options.
- Use existing Codex / native API adapters.
- Emit runtime tool history to chat/timeline.
- Persist final findings into `review_findings`.

Tests:

```bash
bun run test run tests/services.agent-runtime-registry.test.ts tests/review-run-workflow.test.ts
```

Acceptance criteria:

- Review Run uses existing runtime event ledger.
- Review tool activity appears as normal task activity.
- findings are persisted with category and evidence refs.
- no provider-native tool turn path is used for Review Run.

### Phase 4: vulnWorkbench Security Diagnostic

Wire `securityReview` to `vulnWorkbench` CLI.

Tasks:

- Add `nightworkers.review-vulnworkbench.service.ts`.
- Add configurable `vulnWorkbench` cwd and repository-to-project mapping.
- Build bounded CLI commands for `scan:profile` and `review:scan`.
- Capture command summaries in Review Run artifact.
- Convert scanner-backed findings and scan review `improvementRequest` into Review Mode findings.
- Mark security TODO `needs_human` when CLI is unavailable, unconfigured, or fails.

Tests:

```bash
bun run test run tests/review-vulnworkbench.test.ts
```

Acceptance criteria:

- `securityReview=false` does not call `vulnWorkbench`.
- `securityReview=true` calls `vulnWorkbench` CLI when configured.
- missing project mapping creates a warning finding and does not invent vulnerabilities.
- non-zero CLI exit creates a warning finding with command summary.
- successful scan/review output creates scanner-backed security findings.
- Static Intelligence candidate material is not treated as confirmed vulnerability evidence by itself.

### Phase 5: UI Replacement

Replace section runner UI with Review Run options.

Tasks:

- Add checkbox options.
- Add start Review Run action.
- Render target summary and warnings.
- Keep findings and prompt suggestions.
- Remove precheck/agentic specific display from primary path.

Tests:

```bash
bun run test run tests/review-status-viewer.test.tsx
```

Acceptance criteria:

- UI starts Review Run with selected options.
- UI no longer shows section run controls as the main action.
- target warnings are visible.
- findings/prompt suggestions remain usable.

### Phase 6: Cleanup Old Section Path

Remove or quarantine old test evidence implementation.

Tasks:

- Stop auto-starting required `test_coverage`.
- Deprecate `runReviewSection`.
- Delete old test evidence files if no compatibility path needs them.
- Remove old tests or rewrite them for Review Run.
- Update i18n strings.

Tests:

```bash
bun run test run tests/review-mode.test.ts tests/review-status-viewer.test.tsx
```

Acceptance criteria:

- no new Review Mode path calls `buildTestEvidencePrecheck`.
- no new Review Mode path calls `runAgenticTestEvidenceReview`.
- old section route is unused by UI.
- saved old artifacts do not break rendering.

### Phase 7: Commit Option

Implement `commitChanges`.

Tasks:

- Re-read target files after fixes.
- Run configured verify gate before commit.
- Ensure excluded dirty files are not staged.
- Stage only target files unless fix phase explicitly added files.
- Commit with Review Run message.
- Persist commit result.

Tests:

```bash
bun run test run tests/nightworkers-git-closeout.test.ts tests/review-run-workflow.test.ts
```

Acceptance criteria:

- commit is never created when option is false.
- commit is blocked when verify fails.
- commit stages only Review Run target/fix files.
- excluded dirty files remain unstaged.

## Verification Gates

Focused gates during implementation:

```bash
bun run test run tests/review-targets.test.ts
bun run test run tests/review-run-workflow.test.ts
bun run test run tests/review-vulnworkbench.test.ts
bun run test run tests/review-mode.test.ts tests/review-status-viewer.test.tsx
```

Representative gate:

```bash
bun run verify:base
```

Full gate before commit:

```bash
bun run verify
```

## Completion Conditions

The implementation is complete when:

- Review Mode can start a Review Run from the artifact screen.
- Review Run options are checkbox-driven.
- Review target files come from this run's edit signals.
- dirty files outside the run are excluded and shown as warnings.
- Plan specification is read before review.
- selected review options become TODOs.
- runtime tool history appears in chat/timeline.
- LLM code review can produce persisted findings.
- test evidence review can inspect acceptance criteria and focused test evidence without using provider-native tool turn runtime.
- security review uses `vulnWorkbench` CLI and can produce persisted scanner-backed security findings.
- security review does not create confirmed vulnerability findings when `vulnWorkbench` is unavailable or unconfigured.
- apply fixes runs only when selected.
- commit runs only when selected and after verification.
- old `test_coverage` precheck/agentic path is no longer the primary Review Mode path.
- `bun run verify:base` passes.

## Non-Goals

- Do not build a new separate LLM provider loop for Review Mode.
- Do not make `git diff` the primary target selector.
- Do not review unrelated dirty files by default.
- Do not auto-fix findings unless selected.
- Do not auto-commit unless selected.
- Do not remove Review Mode persistence tables in the first implementation.
- Do not redesign general run orchestration outside what Review Run needs.
