# Test Mode Verification Checklist Implementation Plan

## Status

implemented

## Purpose

NightWorkers に、実装 run とは分離した **Test Mode** と **Verification Checklist 自動照合**を追加する。

この計画の狙いは、実装中に LLM がついでにテストまで広げる挙動を抑え、仕様書の完了条件を source of truth とした独立した検証 run を成立させることである。Test Mode は実装 run の continuation ではない。仕様書の完了条件、変更済みファイル、既存 test pattern、検証 wrapper の結果だけを入力にし、fresh context でテストを作成・実行・修正する。

主な狙い:

- implementation run ではテスト実装を原則抑制し、最小限の局所確認だけに寄せる。
- test run は implementation の Codex thread / native history を resume しない。
- 仕様書 Markdown 作成時に、同じ構造データから `verification JSON` を sidecar として生成する。
- 完了条件を Verification Checklist として表示・保存し、LLM の Todo 操作ではなく deterministic な照合で状態更新する。
- `lint` / `format:check` / `typecheck` / `test` / `coverage` / `build` / `verify` など check 指向コマンドを NightWorkers wrapper で記録・要約する。
- Codex native `command_execution` は止めきれない前提で、正式完了には NightWorkers-managed completion check evidence を要求する。
- Test Mode LLM は checklist の失敗結果を受け取り、verification が完了するまで必要なテスト修正を続ける。

## Current Baseline

現行実装には使える土台があるが、Test Mode としてはまだ分離されていない。

既存の土台:

- `api/modules/specification/specification-document-renderer.ts`
  - Plan Mode workspace から仕様書 Markdown を生成する。
  - Feature Plan は実装順序、検証条件、完了条件の正本として扱われる。
- `api/services/worker-tools/run-verification.ts`
  - `runCommandTool` を薄く包んで verification command を実行する。
- `api/services/worker-tools/run-command.ts`
  - stdout / stderr / exitCode を保存し、大きい出力は compact する。
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
  - Native/API lane には `run_verification` tool がある。
- `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts`
  - Codex native `command_execution` event を事後に捕捉できる。
- `api/services/agent-runtime/codex-sdk/codex-sdk-client.ts`
  - Codex implementation run は resume state がある場合に `resumeThread()` を使える。
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
  - review run では Codex resume を disabled にして fresh context にしている。

現状の不足:

- 仕様書生成時に verification checklist JSON が同時生成されない。
- 完了条件が機械照合可能な stable ID 付き条件として保存されない。
- Test Mode という実行 mode / run option / queue state がない。
- implementation run の runtime prompt が「テスト実装は test mode へ分離する」方針を持っていない。
- Codex lane で check 系コマンドを NightWorkers wrapper に必ず通す強制力がない。
- Codex native check command を正式 evidence から降格する gate がない。
- check result を language / runner 非依存の `NormalizedVerificationEvidence` に変換する層がない。
- Verification Checklist の状態を自動更新する read model / persistence がない。
- Test Mode LLM へ checklist failure を返し、修正 loop を続ける controller がない。

## Locked Decisions

初期実装で再判断しない決定事項:

- Test Mode は implementation run の continuation ではなく、独立した run として扱う。
- Test Mode は Codex thread / native API history を resume しない。
- Test Mode の source of truth は仕様書の完了条件と verification JSON。
- implementation run では、ユーザーが明示した場合や既存 test の小修正が必要な場合を除き、テスト実装を主目的にしない。
- implementation run の局所確認は許可するが、正式な完了証跡にはしない。
- Verification Checklist の更新は LLM Todo 操作では行わない。
- Checklist の `passed` / `failed` / `covered` / `verified_by_gate` / `unknown` / `manual` は backend が deterministic に更新する。
- 仕様書 Markdown と verification JSON は別々の LLM 出力にしない。同一の構造データから派生させる。
- `*.verification.json` は仕様書と同じ lifecycle で保存する。
- `run_check` は check 指向コマンドの汎用 primitive とする。
- `run_verification` / `completion_check` は `run_check` の上位用途として扱う。
- project 側の check command は生出力を出してよい。LLM への出力圧縮と artifact 保存は NightWorkers wrapper が担う。
- Codex native `command_execution` は途中確認として観測するが、正式 checklist evidence にはしない。
- Codex lane の closeout では NightWorkers-managed completion check evidence を要求する。
- Rust / Python / TypeScript など各言語の差分は parser / adapter で吸収し、Checklist は runner 固有形式を知らない。
- JUnit XML と command-level evidence を初期共通口にする。
- Rust の標準 `cargo test` は初期実装では command-level evidence までとし、case-level evidence は `cargo nextest` adapter を追加した段階で扱う。

## Implementation Readiness Review

この計画は、以下の前提を固定すれば実装に移れる。

- 仕様書 Markdown、verification JSON、checklist state、evidence は別々の責務として保存する。
- checklist state の正本は TodoList や task message metadata ではなく DB row とする。
- task message metadata は関連 artifact / verification document への参照 ID だけを持つ。
- Codex native `command_execution` は audit / debug evidence として扱い、正式 evidence は `run_check` / `completion_check` に限定する。
- Phase 0 の failing test は、同一実装 slice 内で green に戻す前提の characterization test として扱い、失敗状態を残して closeout しない。

実装開始時に未決定へ戻さない項目:

- verification schema file は `api/db/verification-schema.ts` を新設する。
- migration は次の Drizzle migration として `verification_documents` / `verification_checklist_items` / `verification_evidence_runs` / `verification_evidence_cases` を追加する。
- 初期 parser は JUnit XML、Vitest/JUnit、pytest/JUnit、command-level unknown runner を対象にする。
- UI は TodoList を更新せず、verification read model から checklist 表示を組み立てる。

## Out Of Scope

初期実装に含めないもの:

- Codex SDK native command execution 自体のブロック。
- Codex native shell を NightWorkers wrapper に技術的に横取りする機構。
- 全テストランナーの完全 parser 対応。
- UI 全面リデザイン。
- Review Mode の全面置換。
- 既存仕様書 Markdown の過去データ migration。
- すべての完了条件の自動判定化。自動化できない項目は `manual` / `unknown` として残す。

## Terminology

### Completion Condition

仕様書上の完了条件。ユーザー価値または受け入れ条件として読める自然文を持つ。

### Verification Checklist Item

Completion Condition から派生した検証単位。stable ID、期待結果、照合方法、現在の検証状態を持つ。

### Test Mode

仕様書の completion conditions を検証観点として読み、必要な test / fixture / test helper を追加・修正する実行 mode。production code 修正は、テスト作成中に明確な defect が見つかった場合だけ許可する。

### Run Check

NightWorkers-managed check command wrapper。raw stdout/stderr/exitCode を保存し、LLM には summary だけを返す。

### Completion Check

closeout 前に必須となる final gate。Verification Checklist の required items が完了状態か確認し、不足があれば Test Mode LLM に修正入力として返す。

## Persistence Boundaries

正本と参照先を分ける。

Canonical DB state:

- `verification_documents`
  - task / run / spec artifact と verification JSON の対応を持つ。
  - JSON content、schema version、source spec path、status、生成時刻を保存する。
- `verification_checklist_items`
  - condition ごとの現在 status、required flag、reason、lastCheckedAt を保存する。
  - LLM Todo とは別物として扱う。
- `verification_evidence_runs`
  - `run_check` / `completion_check` の command、cwd、exitCode、runner、artifact refs、summary を保存する。
- `verification_evidence_cases`
  - parser が抽出できた case-level evidence を保存する。
  - case-level evidence がない runner は evidence run の command-level result だけを使う。

Artifacts:

- 仕様書 Markdown は従来の specification artifact として保存する。
- `*.verification.json` は specification artifact と同じ lifecycle の artifact として保存し、`verification_documents` から参照する。
- raw stdout / stderr / parsed reporter output は artifact として保存し、LLM-visible payload には全文を入れない。

Non-canonical references:

- task message metadata は `verificationDocumentId`、artifact id、latest checklist summary id などの参照だけを持つ。
- TodoList は作業進行表示には使えるが、Verification Checklist の状態正本にはしない。
- Codex native `command_execution` event は audit record として残せるが、checklist status を `passed` にする入力にはしない。

## Data Contracts

### Specification Verification Sidecar

推奨保存名:

```text
spec/<slug>.verification.json
```

初期 schema:

```ts
type SpecificationVerificationDocument = {
	version: 1;
	specId: string;
	specPath: string;
	generatedAt: string;
	source: {
		taskId: string;
		sourceMessageIds: string[];
		workspaceArtifactIds: string[];
	};
	conditions: VerificationCondition[];
	commands: VerificationCommandPlan[];
	nonGoals: string[];
};

type VerificationCondition = {
	id: string; // AC-001, AC-002...
	text: string;
	category:
		| "api"
		| "ui"
		| "db"
		| "validation"
		| "auth"
		| "workflow"
		| "migration"
		| "quality"
		| "other";
	verificationKind:
		| "automated_test"
		| "command_gate"
		| "manual"
		| "not_applicable";
	expectedEvidence: Array<
		| "unit_test"
		| "integration_test"
		| "e2e_test"
		| "typecheck"
		| "lint"
		| "format_check"
		| "build"
		| "migration_check"
		| "manual_evidence"
	>;
	expectedResult: string;
	failureMeaning: string;
	required: boolean;
	status: "pending";
};

type VerificationCommandPlan = {
	id: string;
	label: string;
	command: string;
	cwd?: string;
	conditionIds: string[];
	scope: "focused" | "full_gate" | "manual";
	runnerHint?:
		| "vitest"
		| "jest"
		| "pytest"
		| "cargo-test"
		| "cargo-nextest"
		| "go-test"
		| "junit"
		| "playwright"
		| "unknown";
};
```

### Normalized Verification Evidence

Runner adapters はすべてこの形式へ変換する。

```ts
type NormalizedVerificationEvidence = {
	id: string;
	runId: string;
	taskId: string;
	command: string;
	cwd: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	exitCode: number;
	runner:
		| "vitest"
		| "jest"
		| "pytest"
		| "cargo-test"
		| "cargo-nextest"
		| "go-test"
		| "playwright"
		| "junit"
		| "unknown";
	rawStdoutArtifactId: string;
	rawStderrArtifactId: string;
	parsedArtifactId?: string;
	summary: {
		passed: number | null;
		failed: number | null;
		skipped: number | null;
		total: number | null;
	};
	cases: NormalizedTestCaseEvidence[];
	commandLevelConditionIds: string[];
};

type NormalizedTestCaseEvidence = {
	id: string;
	name: string;
	filePath?: string;
	status: "passed" | "failed" | "skipped" | "unknown";
	durationMs?: number;
	conditionIds: string[];
	failureMessage?: string;
};
```

### Verification Checklist State

```ts
type VerificationChecklistItemStatus =
	| "pending"
	| "covered"
	| "passed"
	| "failed"
	| "verified_by_gate"
	| "manual"
	| "unknown"
	| "not_applicable";

type VerificationChecklistItem = {
	id: string;
	conditionId: string;
	text: string;
	required: boolean;
	status: VerificationChecklistItemStatus;
	evidenceIds: string[];
	lastCheckedAt?: string;
	reason?: string;
};
```

Status rules:

- `passed`: conditionId と test case evidence が明確に対応し、対象 test が pass。
- `failed`: conditionId 対応 test case または command が fail。
- `covered`: conditionId に紐づく command は成功したが、case-level evidence はない。
- `verified_by_gate`: full gate は成功したが、condition 単位の対応はない。
- `manual`: 自動判定対象外。
- `unknown`: 対応証跡なし、または parser が扱えない。
- `not_applicable`: 条件が対象外と明示された。

## User-Visible Workflow

### 1. Specification Generation

Plan Mode で仕様書を生成する。

出力:

- `spec/<slug>.md`
- `spec/<slug>.verification.json`

ユーザーに見える状態:

- 仕様書本文に完了条件が表示される。
- Verification Checklist は Todo 風に表示できるが、内部的には Todo ではない。
- 仕様書 artifact に `Test Artifact` ボタンを表示し、その artifact に紐づく verification JSON から Test Mode run を開始できる。

### 2. Implementation Run

Implementation LLM は production change を作る。

実装中のテスト方針:

- テスト新規作成は原則 Test Mode に回す。
- 既存テストの軽微な修正、局所 regression reproduction、失敗原因切り分けは許可する。
- final quality gate は wrapper evidence がない限り完了扱いにしない。

### 3. Test Mode Run

Implementation 完了後、Test Mode run を開始する。

起動経路:

- 仕様書 artifact の `Test Artifact` ボタン。
- run detail / artifact view からの再実行。
- backend API からの explicit Test Mode enqueue。

入力:

- verification JSON
- 仕様書 Markdown の compact view
- implementation run が編集した主要ファイル
- existing test pattern candidates
- non-goals
- allowed edit scope

明示的に渡さないもの:

- implementation Codex thread
- native API previous history
- implementation LLM の長い試行錯誤ログ

Test Mode LLM の許可範囲:

- test files
- fixtures
- minimal test helpers
- 明確な defect が見つかった場合の最小 production fix

### 4. Completion Check

Test Mode LLM が `run_check` / `run_verification` を使って検証する。closeout 前に `completion_check` を通す。

Completion check が失敗した場合:

- failed / unknown required condition を LLM に返す。
- LLM は対象テストまたは明確な defect を修正する。
- completion check が完了になるまで loop を続ける。

### 5. Result Display

ユーザーに見える状態:

- Completion Condition ごとの status。
- evidence command。
- failed / unknown の理由。
- manual 項目。
- raw output artifact への参照。

LLM に見える状態:

- `OK completion_check` または `ERROR completion_check`。
- 失敗項目の短い summary。
- raw artifact id。

### 6. Test Artifact Button

仕様書 artifact には `Test Artifact` ボタンを追加する。

Button behavior:

- 対象 artifact の `verificationDocumentId` を解決する。
- verification JSON が存在しない場合は disabled にし、missing sidecar reason を表示する。
- verification JSON が存在する場合は Test Mode run 作成 API を呼ぶ。
- 既存の Test Mode run が active の場合は新規作成せず、その run detail へ遷移する。
- 完了済み Test Mode run がある場合は latest result summary と `Run again` action を表示する。

API contract:

```ts
type CreateTestModeRunFromArtifactInput = {
	projectId: string;
	taskId: string;
	specArtifactId: string;
	verificationDocumentId: string;
	mode: "test";
	rerun?: boolean;
};
```

Completion conditions:

- `Test Artifact` ボタンから作成された run は implementation thread を resume しない。
- ボタンは TodoList ではなく verification document / checklist read model を参照する。
- missing verification JSON の場合、Test Mode run を silent failure させず UI 上で理由を示す。

## First Implementation Slice

最初の実装は、backend の正本と gate を先に成立させ、最後に薄い UI 導線を足す。

Slice 0A: contracts and persistence

- `shared/schemas/verification-checklist.schema.ts` に schema を追加する。
- `api/db/verification-schema.ts` と次の Drizzle migration を追加する。
- `verification_documents` / `verification_checklist_items` / `verification_evidence_runs` / `verification_evidence_cases` を作る。
- schema test と migration shape test を追加する。

Slice 0B: specification sidecar

- 仕様書生成の中間構造から Markdown と verification JSON を派生させる。
- `AC-001` 形式の stable ID を Markdown と JSON の両方へ出す。
- JSON artifact と `verification_documents` row を同時に作る。

Slice 0C: managed evidence path

- `run_check` を追加し、raw stdout / stderr artifact と compact LLM summary を保存する。
- JUnit XML と command-level unknown runner の adapter を追加する。
- checklist matcher と `completion_check` service の最小版を追加する。

Slice 0D: Test Mode routing

- execution mode `test` を追加する。
- Test Mode は Codex resume を disabled にする。
- implementation prompt と Test Mode prompt に最小の mode 方針を追加する。
- closeout 前に `completion_check` を要求する。

Slice 0E: read-only display

- checklist summary と evidence refs を read model から表示する。
- specification artifact に `Test Artifact` ボタンを追加する。
- ボタンから Test Mode run 作成 API を呼び、active run があれば既存 run へ遷移する。
- TodoList mutation で checklist status を表現しない。

この順序なら、最初の PR で「仕様書から機械判定可能な completion conditions が作れる」ことを確認し、次の PR で「check command の生出力を保存しつつ LLM には compact に返す」ことを確認できる。

## Backend Changes

### Phase 0: Baseline And Contracts

Files:

- `shared/schemas/verification-checklist.schema.ts`
- `tests/verification-checklist/schema.test.ts`
- `tests/specification-document-generation.test.ts`

Implementation:

1. `SpecificationVerificationDocument` schema を追加する。
2. `NormalizedVerificationEvidence` schema を追加する。
3. `VerificationChecklistItem` schema を追加する。
4. status transition helper を追加する。
5. 既存仕様書生成テストに、verification JSON 生成が必要であることを示す characterization test を追加する。
6. 同一 slice 内で実装を入れ、closeout 時点では test を green にする。

Gate:

```bash
bunx vitest run tests/verification-checklist/schema.test.ts tests/specification-document-generation.test.ts
```

Completion conditions:

- schema が strict に unknown field を拒否する。
- condition id が stable で重複不可。
- `required: true` condition は `verificationKind` を持つ。

### Phase 1: Specification Sidecar Generation

Files:

- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/specification/specification.service.ts`
- `api/modules/specification/specification.routes.ts`
- `api/modules/specification/specification-traceability.ts`
- `tests/specification-document-generation.test.ts`
- `tests/plan-mode-legacy-text-audit.test.ts`

Implementation:

1. 仕様書生成内部で `SpecificationPlanModel` のような中間構造を作る。
2. Markdown renderer と verification JSON renderer を同じ中間構造から呼ぶ。
3. 完了条件に `AC-001` 形式の stable ID を付ける。
4. Markdown には完了条件 ID を表示する。
5. JSON sidecar は specification artifact として保存し、`verification_documents` row から参照する。
6. task message metadata には `verificationDocumentId` と artifact id だけを参照として持たせる。
7. 仕様書の archive / adoption lifecycle と JSON sidecar の lifecycle を揃える。

Completion conditions:

- 仕様書 Markdown の完了条件と JSON の `conditions[].id` が一致する。
- JSON は仕様書作成時に必ず保存される。
- Markdown だけ生成され、JSON が欠けた状態は degraded として run event に残る。

### Phase 2: Test Mode Runtime Routing

Files:

- `api/services/agent-runtime/native-api-runner/native-api-mode.ts`
- `api/services/agent-runtime/registry.ts`
- `api/modules/nightworkers/run-orchestration/runtime-routing.ts`
- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `tests/services.agent-runtime-registry.test.ts`
- `tests/codex-agent-runtime/config-prompt.cases.ts`
- `tests/nightworkers-service/services-nightworkers-02/runtime-lanes.cases.ts`

Implementation:

1. execution mode に `test` を追加する。
2. Test Mode run は runtime resume を disabled にする。
3. Test Mode initial Todo は少数にする:
   - verification checklist を読む
   - 対象テストを実装/修正する
   - run_check / completion_check を通す
   - 結果を報告する
4. Implementation prompt に「テスト実装は原則 Test Mode へ分離する」を追加する。
5. Test Mode prompt に「完了条件観点を中心に test を実装する」「implementation context を引き継がない」を追加する。
6. review mode と同様、Codex resume state は Test Mode で disabled にする。

Completion conditions:

- Test Mode Codex run が `resumeThread()` を呼ばない。
- Implementation prompt が新規 test 実装を主目的化しない。
- Test Mode prompt が verification JSON を source of truth とする。

### Phase 3: Run Check Wrapper

Files:

- `api/services/worker-tools/run-check.ts`
- `api/services/worker-tools/run-verification.ts`
- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/dispatcher.ts`
- `api/services/tool-policy/tool-manifest.ts`
- `api/services/supervisor/prompt-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/mcp/nightworkers-tool-manifest.ts`
- `tests/worker-tools/services-worker-tools-*.test.ts`
- `tests/nightworkers-mcp-manifest.test.ts`

Implementation:

1. `run_check` worker tool を追加する。
2. 入力:

```ts
type RunCheckInput = {
	repoRoot: string;
	command: string;
	cwd?: string;
	checkKind:
		| "lint"
		| "format_check"
		| "typecheck"
		| "test"
		| "coverage"
		| "build"
		| "verify"
		| "completion_check"
		| "other";
	conditionIds?: string[];
	displayMode?: "summary" | "error_excerpt" | "full";
	captureMode?: "full";
	timeoutSeconds?: number;
};
```

3. raw stdout / stderr は常に artifact 保存する。
4. LLM-visible output は success 時に `OK <checkKind>`、failure 時に error excerpt に圧縮する。
5. `run_verification` は `run_check({ checkKind: "verify" })` に寄せる。
6. Native/API tool registry には `run_check` を追加する。
7. Codex MCP tool manifest にも `run_check` を追加する。

Completion conditions:

- 成功時も raw stdout/stderr artifact が残る。
- LLM-visible result が raw output 全文を含まない。
- 失敗時は exitCode、top failure、artifact ref を返す。
- `run_verification` 既存互換が壊れない。

### Phase 4: Language And Runner Adapters

Files:

- `api/services/verification/normalized-evidence.ts`
- `api/services/verification/adapters/junit.ts`
- `api/services/verification/adapters/vitest.ts`
- `api/services/verification/adapters/pytest.ts`
- `api/services/verification/adapters/playwright.ts`
- `api/services/verification/adapters/cargo.ts`
- `api/services/verification/adapters/go-test.ts`
- `tests/verification-adapters/*.test.ts`

Implementation:

1. JUnit XML parser を first-class adapter にする。
2. Vitest は JSON reporter または JUnit XML を優先する。
3. Pytest は JUnit XML または pytest-json-report を対応する。
4. Playwright は JSON reporter を対応する。
5. Go は `go test -json` を対応する。
6. Rust standard `cargo test` は command-level evidence として扱う。
7. Rust case-level evidence は `cargo nextest --message-format json` adapter で扱う。
8. adapter がない場合は `runner: "unknown"` として command-level evidence を返す。

Completion conditions:

- JUnit XML fixture から cases が抽出できる。
- pytest fixture が common evidence に変換できる。
- Vitest fixture が common evidence に変換できる。
- Rust `cargo test` fixture は case-level に無理に変換せず command-level になる。
- Unknown runner でも raw artifact と exitCode は保存される。

### Phase 5: Verification Checklist Matching

Files:

- `api/services/verification/checklist-matcher.ts`
- `api/modules/nightworkers/nightworkers.verification.repository.ts`
- `api/modules/nightworkers/nightworkers.verification.service.ts`
- `api/db/verification-schema.ts`
- next Drizzle migration for verification checklist tables
- `tests/services.verification-checklist.test.ts`

Implementation:

1. verification JSON から checklist rows を作る。
2. `conditionId` と test case name marker を照合する。
   - `[AC-001] creates todo`
   - `AC-001 creates todo`
3. command-level `conditionIds` も照合する。
4. full gate success は未照合 required item を `verified_by_gate` にできるが、`passed` にはしない。
5. failed evidence は対象 condition を `failed` にする。
6. 自動化対象外は `manual` のまま残す。
7. required item が `failed` / `pending` / `unknown` の場合、completion check は失敗する。

Completion conditions:

- 同じ evidence を再投入しても idempotent。
- passed と verified_by_gate が区別される。
- failed が passed に上書きされるのは、後続の成功 evidence が同じ condition に対応する場合だけ。
- unknown が残る場合は completion check が理由を返す。

### Phase 6: Completion Check Gate

Files:

- `api/services/verification/completion-check.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-mcp-audit.ts`
- `api/services/agent-runtime/codex-runtime-audit.ts`
- `api/services/agent-runtime/CodexAgentRuntime.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `tests/codex-agent-runtime/contract-read-verify.cases.ts`
- `tests/native-api-runner/dispatcher-gates.cases.ts`

Implementation:

1. `completion_check` worker / MCP tool を追加する。
2. required checklist status を読み、完了可否を返す。
3. wrapper evidence が不足している場合は `missing_managed_check_evidence` を返す。
4. Codex native `command_execution` で check 系 command が観測された場合は `unwrapped_check_observed` warning を出す。
5. quality gate closeout では managed wrapper evidence を必須にする。
6. strict mode では unwrapped check のみで完了しようとした run を `needs_human` にする。
7. non-strict mode では `completion_check` で managed rerun を要求する。

Completion conditions:

- Codex が `bun run test` を native に叩いても、それだけでは checklist が complete にならない。
- `completion_check` が成功するまで final closeout が完了扱いにならない。
- native/API lane は `run_check` 経由の evidence を正式 evidence にできる。
- Codex lane は unwrapped check を audit warning として表示できる。

### Phase 7: Test Mode Feedback Loop

Files:

- `api/modules/nightworkers/run-orchestration/runtime-execution.ts`
- `api/modules/nightworkers/run-orchestration/todo-closeout.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/nightworkers-service/services-nightworkers-02/test-mode.cases.ts`

Implementation:

1. completion check failure payload を LLM-visible summary に変換する。
2. summary には failed / unknown required conditions を含める。
3. raw output artifact id を含める。
4. Test Mode LLM は failure summary を受け取り、テスト修正または明確な defect 修正を行う。
5. max loop / timeout に達した場合は `needs_human` にする。
6. 完了時は checklist status summary を final report と artifact に保存する。

Completion conditions:

- failed condition が次 turn の入力に入る。
- LLM が修正後に再度 `run_check` / `completion_check` を実行する。
- 完了不能時は未確認項目を done にしない。

### Phase 8: UI And Read Models

Files:

- `src/modules/specification/planModeWorkspaceModel.ts`
- `src/modules/specification/components/*` or existing artifact view components
- `src/modules/nightworkers/components/*` or existing workspace panels
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `api/modules/nightworkers/nightworkers.route-handlers.ts`
- `api/modules/nightworkers/routes/run-routes.ts`
- `tests/project-detail-screen.test.tsx`
- `tests/thread-timeline-context-still-cards.test.ts`

Implementation:

1. Specification artifact view に Verification Checklist summary を表示する。
2. Run detail / timeline に Test Mode result summary を表示する。
3. raw evidence artifact への参照を表示する。
4. status は Todo ではなく checklist read model から表示する。
5. `passed` / `failed` / `verified_by_gate` / `manual` / `unknown` を区別する。
6. Specification artifact view に `Test Artifact` ボタンを追加する。
7. ボタンは `verificationDocumentId` を持つ artifact で enabled にし、存在しない場合は disabled reason を表示する。
8. ボタン押下で `CreateTestModeRunFromArtifactInput` を送信し、active run があれば既存 run detail へ遷移する。

Completion conditions:

- Checklist は TodoList と混同されない。
- LLM の Todo 操作なしで UI status が更新される。
- failed / unknown item がユーザーに見える。
- `Test Artifact` ボタンから fresh Test Mode run を開始できる。
- verification JSON が欠けている artifact では、ボタンが silent failure せず欠落理由を表示する。

## Runtime Prompt Changes

### Implementation Mode

追加する短い方針:

```text
テスト実装は原則 Test Mode の担当です。Implementation Mode では production change と必要最小限の局所確認に集中してください。既存テストの軽微な修正や失敗原因切り分けを除き、新規 test file / broad test coverage の追加を主成果物にしないでください。
```

### Test Mode

追加する方針:

```text
この run は Test Mode です。Implementation run の thread/history を前提にせず、仕様書の completion conditions と verification JSON を source of truth にしてください。テストは完了条件観点を中心に追加・修正し、production code の変更は明確な defect を証明できる場合の最小修正に限ります。completion_check が完了するまで、failed / unknown required conditions を修正して再検証してください。
```

### Codex Lane Check Guidance

追加する方針:

```text
lint / format:check / typecheck / test / coverage / build / verify / completion_check は NightWorkers の run_check / run_verification / completion_check が正式 evidence 経路です。native command_execution で途中確認しても、closeout 前には managed check を実行してください。
```

重要:

- MCP 誘導だけでは強制力が弱い。
- closeout gate 側で managed evidence を必須にする。
- native command は参考ログ、managed wrapper は正式証跡として扱う。

## Formal Evidence Precedence

Checklist status の更新では、証跡の優先順位を固定する。

1. `completion_check` success
   - closeout 可否の最終判定。
   - required item が `passed` / `covered` / `verified_by_gate` / `manual` / `not_applicable` の許容状態にあることを確認する。
2. `run_check` / `run_verification` managed evidence
   - checklist status を更新できる正式 evidence。
   - parser が case-level condition 対応を取れた場合だけ `passed` にできる。
3. managed full gate success
   - 未照合 required item を `verified_by_gate` にできる。
   - condition 単位の test 対応がないため `passed` にはしない。
4. Codex native `command_execution`
   - `unwrapped_check_observed` warning と raw audit record だけを作る。
   - checklist status を `passed` / `covered` / `verified_by_gate` に更新しない。
5. Manual evidence
   - `verificationKind: "manual"` の項目だけに使う。
   - required automated item の代替にはしない。

## Verification Strategy

### Unit Tests

```bash
bunx vitest run \
  tests/verification-checklist/schema.test.ts \
  tests/verification-adapters/*.test.ts \
  tests/services.verification-checklist.test.ts
```

Expected:

- schemas validate strict contracts.
- adapters normalize multiple runner fixtures.
- matcher updates status deterministically.

### Runtime Prompt Tests

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/codex-agent-runtime/config-prompt.cases.ts
```

Expected:

- implementation prompt discourages test implementation.
- test mode prompt uses verification JSON.
- Codex test mode disables resume.
- Codex check guidance mentions managed evidence.

### Worker Tool Tests

```bash
bunx vitest run tests/worker-tools/services-worker-tools-*.test.ts tests/nightworkers-mcp-manifest.test.ts
```

Expected:

- run_check stores raw artifacts.
- run_check returns compact LLM summary.
- run_verification compatibility remains.
- Codex MCP manifest exposes run_check where allowed.

### Orchestration Tests

```bash
bunx vitest run tests/nightworkers-service/services-nightworkers-02/test-mode.cases.ts tests/native-api-runner/dispatcher-gates.cases.ts
```

Expected:

- test mode is a fresh run.
- completion_check failure loops back to LLM.
- completion_check success allows closeout.
- unwrapped Codex check is warning, not formal evidence.

### Full Gate

```bash
bun run verify
```

Expected:

- typecheck, lint, format, tests, coverage, build pass.
- no unrelated prompt snapshots drift.

## Rollout Plan

### Slice 1: Contracts And Sidecar

Deliver:

- schemas
- specification verification JSON generation
- tests for Markdown/JSON alignment

Exit criteria:

- new specs produce `*.verification.json`
- old specs degrade gracefully

### Slice 2: Wrapper And Evidence

Deliver:

- `run_check`
- raw artifact capture
- normalized evidence base schema
- JUnit + command-level adapters

Exit criteria:

- check commands produce raw artifacts and compact LLM summaries

### Slice 3: Checklist Matching

Deliver:

- checklist persistence
- matcher
- completion_check service

Exit criteria:

- condition statuses update without LLM Todo operations

### Slice 4: Test Mode Runtime

Deliver:

- executionMode `test`
- fresh context / no resume
- prompt updates
- Test Mode feedback loop

Exit criteria:

- failed checklist conditions are fed back to LLM
- completion_check success is required for closeout

### Slice 5: UI And Audit

Deliver:

- checklist status display
- raw evidence links
- Codex native unwrapped check warnings

Exit criteria:

- users can see condition-level verification status
- unwrapped Codex checks are visible and not treated as formal completion evidence

## Risks And Mitigations

### Risk: Test Mode Adds Too Much Time

Mitigation:

- Use risk-based Test Mode auto-start.
- Small implementation-only changes can keep local focused checks.
- Full Test Mode is required when a spec has required completion conditions or changed API/DB/stateful behavior.

### Risk: Token Use Increases

Mitigation:

- Do not resume implementation context.
- Feed only verification JSON, compact spec, changed files, and failure summary.
- Raw logs stay in artifacts, not model-visible context.

### Risk: Codex Ignores run_check

Mitigation:

- Treat native check as reference only.
- Audit `unwrapped_check_observed`.
- Require managed completion_check before closeout.

### Risk: Polyglot Parsers Are Incomplete

Mitigation:

- Use command-level evidence fallback.
- Treat unsupported parser output as `verified_by_gate` or `unknown`, not `passed`.
- Add adapters incrementally by runner.

### Risk: Checklist Status Looks More Certain Than It Is

Mitigation:

- Keep `passed`, `covered`, `verified_by_gate`, `manual`, and `unknown` distinct.
- Never mark unknown as passed because the full gate succeeded.

## Implementation Completion Conditions

The feature is complete when all of the following are true:

1. New specification generation creates aligned Markdown completion conditions and verification JSON.
2. Test Mode runs with fresh context and does not resume implementation history.
3. Implementation prompt discourages new test implementation except focused local checks or explicit user request.
4. `run_check` captures raw outputs and returns compact LLM summaries.
5. At least JUnit XML, Vitest/JUnit, pytest/JUnit, and command-level unknown runner evidence are supported.
6. Verification Checklist status updates deterministically from evidence.
7. `completion_check` blocks closeout while required items are failed, pending, or unknown.
8. LLM receives failed/unknown condition summaries and can continue fixing tests until completion_check passes or the run needs human help.
9. Codex native check commands are detected as unwrapped and do not satisfy formal completion evidence by themselves.
10. UI displays checklist statuses and evidence references without using TodoList mutations for each condition.
11. `bun run verify` passes.
