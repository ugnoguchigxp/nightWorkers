# Review Agentic Test Evidence Implementation Plan

## Purpose

Review Mode の `受け入れ条件テストの存在確認` を、単純なテスト名一致チェックから **agentic なテスト証跡確認** に拡張する。

現在のテスト名近似チェックは、受け入れ条件に対応するテストが「なさそう」な箇所を絞り込むには使える。しかし、それ単体で「対応テストがない」と断定したり、blocking として承認を止めたりするには弱い。

この計画では、テスト名近似チェックを agentic review の precheck tool として残し、LLM が CLI / ファイル閲覧ツールでテスト証跡を確認したうえで、必要な場合だけ改善依頼 Prompt を生成する形へ整理する。

狙いは次の4点に絞る。

- 受け入れ条件ごとに、対応するテスト証跡があるかを LLM が確認できるようにする。
- 名前一致ロジックは「最終判定」ではなく「調査対象の絞り込み」として使う。
- テスト証跡が確認できない場合だけ、同じ session に投入できる改善依頼 Prompt を生成する。
- 途中で増えた `最終報告` / `検証記録` / `Run 記録チェック` 系の不要ロジックと古い計画文書を cleanup する。

## Current Baseline

現状の Review Mode 周辺には、二転三転した設計の残骸が混ざりやすい。

確認済みの現行/直近実装:

- Review Status の primary artifact は `review_status`。
- section kind は最終的に `test_coverage`, `security_review`, `findings`, `prompt_suggestions` へ寄せる方針。
- `nightworkers.review-mode.test-coverage.ts` に、受け入れ条件と `describe / it / test` 名の近似照合ロジックがある。
- UI では `受け入れ条件テストの存在確認` として、受け入れ条件数、近似一致数、確認対象のテストファイル数/テスト名数を表示できる。
- `prompt_suggestions` は、Review finding から同じ session へ追加投入できる Prompt を作るための既存基盤として使える。

古い方針として残り得るもの:

- `acceptance_evidence`
- `verification_evidence`
- `acceptance_evidence_missing`
- `final_report_evidence_mismatch`
- `verification_missing`
- `verification_failed`
- `reviewStatus.result.recordOnly`
- `reviewStatus.section.acceptance_evidence`
- `reviewStatus.section.verification_evidence`
- `最終報告`
- `検証記録`
- `Run 記録チェック`
- `spec/docs/review-run-record-check-implementation-plan.md`

これらは今回の agentic test evidence 方針では primary concept ではない。互換が必要な保存済み artifact を読む場合だけ migration / compatibility layer で扱い、user-visible concept と新規 section plan からは外す。

## Review Findings Addressed In This Revision

この文書は、次の曖昧さを実装前に潰すために改訂する。

1. **LLM reviewer の接続点が曖昧**
   - 修正: `callProviderToolTurn` と worker-tools dispatcher を使う bounded tool loop として実装方針を固定する。
2. **`test_coverage` を rename するかが未決定**
   - 修正: 初期実装では internal key は `test_coverage` のまま維持する。UI label と artifact payload で意味を更新する。
3. **CLI をどこまで許可するかが曖昧**
   - 修正: 初期 allowlist を `search_files`, `read_file`, `run_command` の限定用途に固定する。`run_command` は `rg` と focused test command だけ許可する。
4. **precheck の finding が blocking になる危険が残る**
   - 修正: precheck-only finding は作らない。agentic review 後の `not_found` / `unclear` だけ warning finding にする。
5. **cleanup が後回しに見える**
   - 修正: Phase 1 を cleanup / concept lock とし、agentic reviewer 実装前に旧 section / reason / UI copy を消す。

## Locked Decisions For Initial Implementation

実装時に再判断しない決定事項:

- Internal section key は `test_coverage` を維持する。
- UI label は `テスト証跡確認` に変更する。
- `nightworkers.review-mode.test-coverage.ts` は Phase 1 で `nightworkers.review-mode.test-evidence-precheck.ts` に rename する。
- LLM reviewer は新規 service `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.ts` に実装する。
- LLM reviewer の provider 呼び出しは `api/services/structured-llm` の `callProviderToolTurn` を使う。
- Tool 実行は worker-tools dispatcher 経由に限定する。
- 初期 tool allowlist は `search_files`, `read_file`, `run_command`。
- `run_command` は次だけ許可する。
  - `rg ...`
  - `bun run test run <single test file>`
  - `bun test <single test file>` は repo のテスト慣習に合わないため初期 allowlist には入れない。
- broad verify (`bun run verify`, `bun run verify:fast`, `bun run test` without file) は agentic section 内では実行しない。
- LLM reviewer が失敗した場合、section は `done` ではなく `needs_human` にする。ただし precheck result は artifact に保存する。
- `not_found` / `unclear` は `warning` finding にする。初期実装では `blocking` にしない。
- LLM reviewer が `not_found` / `unclear` を返した場合、section 実行内で Prompt suggestion record を自動生成して保存する。
- Prompt suggestion は自動で session に投入しない。投入はユーザー操作に限定する。
- 旧 artifact kind が DB に残っていても、新しい `review_status.sections` には出さない。

## User-Visible Concept

表示名:

```text
テスト証跡確認
```

section 内の主要な確認単位:

```text
受け入れ条件ごとのテスト確認
```

結果分類:

| Status | Meaning | Gate |
| --- | --- | --- |
| `confirmed` | 対応するテスト証跡を確認できた | 問題なし |
| `not_found` | LLM が確認した範囲では対応テストが見当たらない | 改善 Prompt 候補 |
| `unclear` | 情報不足、命名不一致、動的生成などで判断不能 | 人の確認または改善 Prompt 候補 |
| `not_applicable` | 受け入れ条件がテスト名で確認する性質ではない | gate しない |

重要:

- 名前一致だけで `not_found` にしない。
- 名前一致だけで `blocking` にしない。
- LLM が tool evidence を見て `not_found` と判断した場合も、表示は「確認範囲では見当たりません」に留める。
- 自動で queue 実行や修正実装はしない。改善依頼 Prompt を作り、ユーザーが投入する。

## Agentic Flow

### 1. Precheck

既存の名前一致ロジックを precheck として使う。

入力:

- 実装計画 artifact の受け入れ条件
- repo 内の test files
- `describe / it / test` 名

出力:

- 受け入れ条件一覧
- strong match / weak match / no name match
- 近いテスト名候補
- 該当 test file path
- test block 周辺抜粋を取るための location hint

precheck の責務:

- LLM に渡す調査対象を絞る。
- obvious confirmed candidate を提示する。
- no name match を warning candidate として列挙する。

precheck がしてはいけないこと:

- 対応テストなしと断定する。
- Review final action を単独で block する。
- 修正 Prompt を単独で生成する。

### 2. LLM Test Evidence Review

LLM に次の tool を許可する。

- file listing / file read
- `rg`
- 必要に応じた限定的な CLI
- 既存テスト名と test body の閲覧

初期実装では、LLM が必要と判断した場合だけ focused test command を実行できる。section 実行時に必ずテストを走らせるわけではない。

許可する CLI の初期範囲:

- `rg`
- `bun run test run <focused test file>` または repo が持つ focused test command
- `bun run verify:fast` は broad すぎるため、agentic test evidence section の自動実行対象にしない

LLM に渡す入力:

- 受け入れ条件
- precheck の一致候補
- no name match / weak match の候補
- test file path
- test block 抜粋
- CLI 実行結果があれば command / exit code / short output

LLM の出力 contract:

```ts
type TestEvidenceReviewResult = {
  version: 1;
  summary: string;
  criteria: Array<{
    criterion: string;
    status: 'confirmed' | 'not_found' | 'unclear' | 'not_applicable';
    confidence: 'high' | 'medium' | 'low';
    evidence: Array<{
      kind: 'test_name' | 'test_body' | 'cli' | 'file_path' | 'reasoning';
      filePath?: string;
      testName?: string;
      command?: string;
      excerpt?: string;
      note: string;
    }>;
    improvementPrompt?: string;
  }>;
  commandsRun: Array<{
    command: string;
    exitCode: number | null;
    summary: string;
  }>;
};
```

### 3. Prompt Suggestion Generation

`not_found` / `unclear` の項目だけ改善依頼 Prompt 候補を作る。

Prompt は断定しすぎない。

Prompt template:

```text
次の受け入れ条件に対応するテスト証跡を確認できませんでした。

受け入れ条件:
- ...

確認した範囲:
- ...

既存テストがある場合は test / it / describe 名や test body から対応関係を分かるようにしてください。
対応テストがない場合は、該当条件を検証する focused test を追加してください。
```

生成先:

- 既存の `review_prompt_suggestions`
- disposition は `prompt_suggestion`
- 同じ Workbench Session に投入する前提

自動投入はしない。

## Backend Design

### Section Kind

Internal key は `test_coverage` を維持する。

理由:

- `review_status.sections[].kind`、route param、frontend type、既存 test fixture を同時に migration しなくてよい。
- user-visible label は i18n で `テスト証跡確認` に変えられる。
- 保存済み artifact 互換は payload version で扱える。

Artifact payload は version 2 にする。

```ts
type TestCoverageArtifact = {
  version: 2;
  kind: 'test_coverage';
  mode: 'precheck_only' | 'agentic_review';
  precheck: AcceptanceTestCoverageResult;
  agenticReview: TestEvidenceReviewResult | null;
  degradedReason?: string;
};
```

`version: 1` の既存 artifact は UI で precheck-only として読めるようにする。新規保存は `version: 2` のみ。

### New / Updated Files

Phase 1 で触るファイル:

- `api/modules/nightworkers/nightworkers.review-mode.test-coverage.ts`
  - rename to `nightworkers.review-mode.test-evidence-precheck.ts`
  - `findings` 生成責務を削除する。
  - `AcceptanceTestCoverageResult` は precheck result のみにする。
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
  - `buildAcceptanceTestCoverage` import を rename 後に更新する。
  - `test_coverage` section で precheck-only finding を作らない。
  - artifact payload を `version: 2` にする。
- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
  - section reason を `Run 記録` ではなく `test evidence` へ寄せる。
  - `test_coverage` の requirement は初期実装では `recommended` にする。security / schema reason がある場合でも `test_coverage` 自体は approval gate を止めない。
- `api/modules/nightworkers/nightworkers.review-mode.evidence.ts`
  - old final-report / saved-verification recommendation reason が残っていないか削除する。
- `shared/schemas/nightworkers/review.schema.ts`
  - old reason / section enum が残っていないか確認する。
- `src/modules/nightworkers/types/review.ts`
  - frontend type を schema に合わせる。
- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
  - precheck-only と agentic review の表示を分ける。
  - `blocking` count を test evidence の primary signal として強調しない。
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/review-mode.test.ts`
- `tests/review-status-viewer.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`

Phase 2 で追加するファイル:

- `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.ts`
  - bounded LLM tool loop と result parser。
- `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.schema.ts`
  - `TestEvidenceReviewResult` の zod schema。
- `tests/review-mode-test-evidence-agent.test.ts`
  - tool loop / schema / degraded fallback の unit tests。

### Service Flow

`runReviewSection(reviewSessionId, 'test_coverage')` の流れ:

1. `buildTestEvidencePrecheck({ taskId, repositoryId })` を実行する。
2. precheck result を artifact payload に入れる。
3. precheck で `criteria.length === 0` または `planFound === false` の場合:
   - LLM reviewer は起動しない。
   - warning finding を1件作る。
   - artifact `mode` は `precheck_only`。
4. criteria がある場合:
   - `runAgenticTestEvidenceReview` を起動する。
   - LLM reviewer は tool loop で必要な file / CLI 証跡を集める。
   - `TestEvidenceReviewResult` を schema validate する。
5. agentic result の各 criterion を finding 化する。
   - `not_found`: warning finding
   - `unclear`: warning finding
   - `confirmed`: finding なし
   - `not_applicable`: finding なし
6. `not_found` / `unclear` の finding は `sourceSection: 'test_coverage'` とする。
7. `not_found` / `unclear` finding から prompt suggestion を自動作成する。
8. prompt suggestion は保存するだけで、session には投入しない。

LLM reviewer が失敗した場合:

- artifact は `mode: 'precheck_only'`, `agenticReview: null`, `degradedReason` 付きで保存する。
- section artifact status は `needs_human`。
- finding は `Agentic test evidence review could not complete` の warning を1件だけ作る。
- UI は `Agentic 確認に失敗しました。precheck 結果のみ表示しています。` と出す。

### Bounded Tool Loop

`runAgenticTestEvidenceReview` は最大 4 turn に制限する。

1 turn の処理:

1. `callProviderToolTurn` に system prompt、会話履歴、tool definitions を渡す。
2. provider が tool call を返したら、tool name / args を validate する。
3. `executeWorkerTool` で tool を実行する。
4. tool result を model-visible compression 済み text にして次 turn に渡す。
5. provider が final JSON を返したら schema validate して終了する。

Tool definitions:

```ts
const TEST_EVIDENCE_TOOLS = [
  'search_files',
  'read_file',
  'run_command',
] as const;
```

Tool restrictions:

- `search_files`
  - `glob` default: `**/*.{test,spec,cases}.{ts,tsx,js,jsx}`
  - `maxResults`: 50
- `read_file`
  - repo root 内のみ
  - `endLine - startLine <= 120`
  - test files と implementation-plan artifact source だけ許可
- `run_command`
  - command regex allowlist:
    - `^rg\\b`
    - `^bun run test run [^;&|]+\\.(test|spec|cases)\\.[cm]?[jt]sx?$`
  - timeout: 30 seconds
  - output: compressed
  - cwd: repository root

Provider does not support native tool calls:

- `callProviderToolTurn` が unsupported を返した場合、agentic review は degraded にする。
- fallback として LLM に tool-free 判断をさせない。
- precheck-only result を表示する。

### Finding Severity

初期実装の severity:

- `not_found`: `warning`
- `unclear`: `info` or `warning`
- `confirmed`: finding なし
- `not_applicable`: finding なし

`blocking` は初期実装では使わない。

理由:

- 対応テストがない可能性は重要だが、Review Mode が受け入れ可否を機械的に決める根拠としてはまだ弱い。
- LLM の tool-based 判断でも false negative があり得る。
- まずは改善 Prompt の生成に価値を寄せる。

### Prompt Suggestion Mapping

`ensureReviewPromptSuggestion` は test evidence finding 用に本文を分岐する。

対象 finding:

- title: `Test evidence not confirmed for acceptance criterion`
- title: `Test evidence review is unclear for acceptance criterion`
- title: `Agentic test evidence review could not complete`

生成する prompt:

- 対象の受け入れ条件
- LLM が確認した file path / test name / command summary
- 既存テストがある場合は対応関係が分かるように test name/body を調整する依頼
- なければ focused test を追加する依頼

Evidence refs:

- plan artifact ref
- test file artifact-like ref は既存 `ReviewEvidenceRef` にないため、初期実装では `{ kind: 'changed_file', path }` を流用しない。
- 代わりに finding body / artifact payload に `filePath` を保持する。
- `ReviewEvidenceRef` 拡張が必要になったら Phase 4 以降で `test_file` ref を追加する。

## UI Design

### Section Card

表示:

```text
テスト証跡確認
実装計画の受け入れ条件ごとに、対応するテストが確認できるかを調査します。
```

実装ファイル:

- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

表示条件:

- `section.kind === 'test_coverage'` のときだけ agentic test evidence result を表示する。
- `artifact.artifact.version === 1` は legacy precheck-only として読む。
- `artifact.artifact.version === 2` は `precheck` と `agenticReview` を読む。
- `mode === 'precheck_only'` の場合、UI は `名前一致による事前確認のみ` と表示する。
- `mode === 'agentic_review'` の場合、UI は `LLM がファイル/CLIで確認` と表示する。

状態 chips:

- `確認済み N 件`
- `未確認 N 件`
- `判断不能 N 件`
- `実行したコマンド N 件`

counts:

- `confirmedCount`: `agenticReview.criteria.status === 'confirmed'`
- `notFoundCount`: `status === 'not_found'`
- `unclearCount`: `status === 'unclear'`
- `notApplicableCount`: `status === 'not_applicable'`
- `precheckMissingCount`: `precheck.matches.filter(!matched).length`

結果表示:

| 受け入れ条件 | 状態 | 根拠 | 次の操作 |
| --- | --- | --- | --- |
| `/threads` で一覧が表示される | confirmed | `tests/...: it("lists threads")` | - |
| `/threads/new` で投稿できる | not_found | 近い test name なし、rg でも未確認 | Prompt 作成 |

Row details:

- 受け入れ条件本文
- status label
- confidence
- evidence summary
- file path / test name / command
- improvement prompt がある場合は折りたたみ表示

表示しないもの:

- `blocking` badge を test evidence section の primary header として強調しない。
- 旧 label `最終報告`, `検証記録`, `Run 記録チェック` は表示しない。
- `テストなし` と断定しない。

### Prompt Suggestions

`not_found` / `unclear` の条件がある場合:

- `入力欄に入れる`
- `この Prompt で続ける`

Prompt は既存の追加プロンプトカードを使う。

実装方針:

- section card 内には直接 `改善依頼 Prompt を作成` ボタンを増やさない。
- `runReviewSection('test_coverage')` が test evidence 用 prompt suggestion record を作る。
- 既存の `追加プロンプト` section は保存済み prompt suggestion を表示する。
- `createReviewPromptSuggestions` API は手動再同期用として残す。
- `not_found` / `unclear` finding がある場合、section 実行後に `追加プロンプト` section に test evidence 用 prompt が出る。
- これにより ReviewStatusViewer の action surface を増やしすぎない。

### Copy Constraints

避ける文言:

- `証跡あり`
- `テストなし`
- `検証済み`
- `受け入れ不可`

使う文言:

- `対応テストを確認できました`
- `対応テストを確認できませんでした`
- `判断不能`
- `確認した範囲`
- `改善依頼 Prompt`

## Cleanup Plan

今回の実装前に、または同じ PR 内で、不要になった概念を整理する。

Cleanup は Phase 1 の一部として必ず先に行う。Agentic reviewer の実装後に cleanup すると、旧 section と新 section が UI / tests に同時に残りやすい。

### 1. Old section / reason cleanup

削除対象:

- `acceptance_evidence`
- `verification_evidence`
- `acceptance_evidence_missing`
- `final_report_evidence_mismatch`
- `verification_missing`
- `verification_failed`

確認箇所:

- `api/modules/nightworkers/nightworkers.review-mode.model.ts`
- `api/modules/nightworkers/nightworkers.review-mode.evidence.ts`
- `api/modules/nightworkers/nightworkers.review-mode.service.ts`
- `shared/schemas/nightworkers/review.schema.ts`
- `src/modules/nightworkers/types/review.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/review-mode.test.ts`
- `tests/review-status-viewer.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`

互換対応:

- 既存 DB に古い `review_artifacts.kind` が残っている場合、UI では表示しない。
- detail API に `legacyArtifacts` は追加しない。旧 artifact は `artifacts` には残っても、新しい `statusArtifact.sections` には出さない。
- 新しい `review_status.sections` には旧 section を再生成しない。

残存確認コマンド:

```bash
rg -n "acceptance_evidence|verification_evidence|acceptance_evidence_missing|final_report_evidence_mismatch|verification_missing|verification_failed|Run 記録チェック|最終報告|検証記録" \
  api/modules/nightworkers \
  shared/schemas/nightworkers \
  src/modules/nightworkers \
  src/i18n/dictionaries \
  tests/review-mode.test.ts \
  tests/review-status-viewer.test.tsx \
  tests/nightworkers.workbench-selectors.test.ts
```

期待:

- active implementation からはヒットしない。
- 否定アサーションや archive docs だけに残る場合は許容する。

### 2. Run record check plan cleanup

`spec/docs/review-run-record-check-implementation-plan.md` は現在の方針と矛盾する。

対応:

- 新計画実装開始時に `spec/archive/review-run-record-check-implementation-plan.md` へ移動する。
- active docs から `Run 記録チェック` を Review Mode の現行方針として参照しない。
- もし履歴として残す場合は、冒頭に `Superseded by review-agentic-test-evidence-implementation-plan.md` を明記する。

実装時の対応:

- Phase 1 で archive へ移動する。
- active docs にはこの文書だけを残す。

### 3. UI copy cleanup

削除対象 key:

- `reviewStatus.result.recordOnly`
- `reviewStatus.section.acceptance_evidence`
- `reviewStatus.section.verification_evidence`
- `reviewStatus.reason.acceptance_evidence_missing`
- `reviewStatus.reason.final_report_evidence_mismatch`
- `reviewStatus.reason.verification_missing`
- `reviewStatus.reason.verification_failed`
- `reviewStatus.sectionReason.noFinalReportRecordNeeded`
- `reviewStatus.sectionReason.checkFinalReport`
- `reviewStatus.sectionReason.noVerificationRecordNeeded`
- `reviewStatus.sectionReason.checkVerificationRecord`

残す key:

- `reviewStatus.section.test_coverage`
- `reviewStatus.result.testCoverageOnly`
- agentic review 用の新規 key

### 4. Test coverage precheck cleanup

`nightworkers.review-mode.test-coverage.ts` は Phase 1 で rename し、責務を precheck に限定する。

rename 先:

- `nightworkers.review-mode.test-evidence-precheck.ts`

この rename は Phase 1 で実施する。

責務:

- markdown から受け入れ条件を抽出
- test file / test name を抽出
- 類似候補を出す

責務外:

- LLM 判断
- prompt suggestion 生成
- finding severity 決定

### 5. Blocking gate cleanup

precheck だけで `blocking` finding を作る実装が残っていないか確認する。

期待:

- precheck only: warning candidate
- agentic `not_found`: warning
- final action approval gate は unresolved blocking finding だけを見るため、test evidence review は初期実装では承認を止めない。

実装上の注意:

- `countFindings` は既存の severity count をそのまま使ってよい。
- test evidence の warning は `canApprove` を false にしない。
- `requiredSectionKindsRemaining` で gate されないよう、`test_coverage` は required ではなく recommended にする。

## Implementation Phases

### Phase 1: Cleanup and concept lock

実装手順:

1. `spec/docs/review-run-record-check-implementation-plan.md` を `spec/archive/` へ移動する。
2. `api/modules/nightworkers/nightworkers.review-mode.model.ts`
   - `SECTION_ORDER` が `test_coverage`, `security_review`, `findings`, `prompt_suggestions` だけであることを確認する。
   - `test_coverage` requirement を `recommended` にする。
   - reason を `Check test evidence for implementation-plan acceptance criteria.` に寄せる。
3. `api/modules/nightworkers/nightworkers.review-mode.evidence.ts`
   - final report / saved verification 由来の reason/finding を削除する。
   - security/schema/public-contract finding は残す。
4. `api/modules/nightworkers/nightworkers.review-mode.test-coverage.ts`
   - `nightworkers.review-mode.test-evidence-precheck.ts` に rename する。
   - `findingsFor` を削除する。
   - `AcceptanceTestCoverageResult` から `findings` を削除する。
5. `api/modules/nightworkers/nightworkers.review-mode.service.ts`
   - rename 後の import に更新する。
   - `test_coverage` section では precheck-only finding を作らない。
   - artifact payload を `version: 2`, `mode: 'precheck_only'`, `precheck`, `agenticReview: null` にする。
6. `src/i18n/dictionaries/ja.ts` / `en.ts`
   - label を `テスト証跡確認` / `Test Evidence Review` に変更する。
   - old key を削除する。
7. `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
   - version 1 / version 2 artifact を読めるようにする。
   - precheck-only 表示を `名前一致による事前確認のみ` と明示する。
8. tests を更新する。
   - `tests/review-mode.test.ts`
   - `tests/review-status-viewer.test.tsx`
   - `tests/nightworkers.workbench-selectors.test.ts`

Exit criteria:

- Review Status に `最終報告` / `検証記録` / `Run 記録チェック` が出ない。
- `test_coverage` が単一の recommended section として表示される。
- 名前一致だけで approval gate が止まらない。
- precheck result は artifact に保存されるが、warning finding はまだ作らない。

Phase 1 verification:

```bash
bun run test run tests/review-mode.test.ts tests/review-status-viewer.test.tsx tests/nightworkers.workbench-selectors.test.ts
bun run verify:fast
```

### Phase 2: Agentic reviewer backend

実装手順:

1. `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.schema.ts` を追加する。
   - `testEvidenceReviewResultSchema`
   - `testEvidenceCriterionResultSchema`
   - `testEvidenceToolEvidenceSchema`
2. `api/modules/nightworkers/nightworkers.review-mode.test-evidence-agent.ts` を追加する。
   - `runAgenticTestEvidenceReview(input)` を export する。
   - 入力は `{ taskId, repositoryId, precheck }`。
   - repository は `repo.getRepository(repositoryId)` で解決する。
   - LLM route は default structured LLM route を使う。route override は初期実装では受け取らない。
3. tool definitions を実装する。
   - `search_files`
   - `read_file`
   - `run_command`
4. tool args validator を実装する。
   - repo root 外の path を拒否する。
   - `read_file` は 120 行以内。
   - `run_command` は allowlist regex 以外拒否する。
5. bounded loop を実装する。
   - max turns: 4
   - max tool calls total: 8
   - max model-visible chars per tool result: 6000
   - timeout: provider call timeout + tool timeout 30 sec
6. `nightworkers.review-mode.service.ts` の `test_coverage` section に組み込む。
   - precheck 成功後に agentic reviewer を呼ぶ。
   - 成功時 artifact `mode: 'agentic_review'`。
   - 失敗時 artifact `mode: 'precheck_only'`, status `needs_human`。
7. findings を生成する。
   - `not_found`: warning
   - `unclear`: warning
   - degraded: warning
   - `confirmed` / `not_applicable`: none
8. Phase 2 では prompt suggestion はまだ作らない。finding 生成までで止める。
9. tests を追加する。
   - schema validation
   - unsupported provider-native tools -> degraded
   - invalid tool command rejected
   - not_found -> warning finding

Exit criteria:

- no name match の受け入れ条件に対して、LLM が test file / test body を確認して status を返す。
- LLM が tool evidence なしに `confirmed` を返せない。
- failure 時も固定の誤情報を出さず、precheck only として表示する。
- unsupported native tool provider では degraded になり、tool-free 判定へ fallback しない。

Phase 2 verification:

```bash
bun run test run tests/review-mode-test-evidence-agent.test.ts tests/review-mode.test.ts
bun run verify:fast
```

### Phase 3: Prompt suggestions integration

実装手順:

1. `ensureReviewPromptSuggestion` に test evidence finding branch を追加する。
2. finding title/body から対象 criterion と evidence summary を取り出す。
3. prompt template を追加する。
4. `runReviewSection('test_coverage')` の agentic review 成功後に、test evidence warning finding から prompt suggestion を作る。
5. `createReviewPromptSuggestions` は手動再同期用として、同じ template を使う。
6. UI は既存の prompt suggestion cards を使う。新しい card UI は作らない。
7. tests を更新する。
   - test evidence warning finding から prompt suggestion が作られる。
   - used / dismissed prompt は再生成されない。

Exit criteria:

- 対応テスト未確認の受け入れ条件ごと、または類似条件 group ごとに Prompt が自動保存される。
- Prompt は断定しすぎず、確認範囲と依頼内容を含む。
- 自動実装や自動 queue 投入はしない。

Phase 3 verification:

```bash
bun run test run tests/review-mode.test.ts tests/review-status-viewer.test.tsx
bun run verify:fast
```

### Phase 4: UI refinement

実装手順:

1. `ReviewStatusViewer.tsx` に `TestEvidenceResultPanel` helper component を切り出す。
2. version 1 artifact は legacy precheck-only として表示する。
3. version 2 artifact は criteria table を表示する。
4. command results は command / exit code / summary だけ表示する。
5. tool output の全文は表示しない。
6. missing/unclear criteria は最大5件だけ初期表示し、残りは折りたたむ。
7. tests を更新する。
   - precheck-only 表示
   - agentic confirmed/not_found/unclear 表示
   - degraded 表示
   - 旧 labels が出ないこと

Exit criteria:

- ユーザーが「なぜ未確認なのか」を UI 上で追える。
- LLM が見た file path / test name / command が表示される。
- 近似一致だけの結果と agentic 判断が混同されない。

Phase 4 verification:

```bash
bun run test run tests/review-status-viewer.test.tsx
bun run verify:fast
```

## Verification Plan

Targeted tests:

- `tests/review-mode.test.ts`
- `tests/review-status-viewer.test.tsx`
- `tests/nightworkers.workbench-selectors.test.ts`
- `tests/review-mode-test-evidence-agent.test.ts`
- `tests/review-mode-test-evidence-precheck.test.ts`

Scenarios:

1. 受け入れ条件と test name が明確に一致する。
2. test name は一致しないが test body が対応している。
3. test file はあるが該当条件を検証していない。
4. 実装計画がない。
5. 受け入れ条件 section がない。
6. LLM reviewer が timeout / provider failure になる。
7. focused test command が失敗する。
8. 旧 artifact が DB に残っていても UI に旧 section が出ない。
9. provider native tool call が unsupported の場合、tool-free 判断に fallback せず degraded になる。
10. LLM が evidence なしに `confirmed` を返した場合、schema/post-validation で `unclear` または degraded に落ちる。
11. `not_found` / `unclear` finding から改善依頼 Prompt が生成される。
12. `not_found` / `unclear` が approval gate を止めない。

Repo gate:

- `bun run test run tests/review-mode.test.ts tests/review-status-viewer.test.tsx tests/nightworkers.workbench-selectors.test.ts`
- `bun run test run tests/review-mode-test-evidence-agent.test.ts tests/review-mode-test-evidence-precheck.test.ts`
- `bun run verify:fast`

Failure triage:

1. schema/type failure
   - `shared/schemas/nightworkers/review.schema.ts`
   - `src/modules/nightworkers/types/review.ts`
   - agent schema file
2. Review Status still shows old section
   - `planSections`
   - persisted `review_status` artifact rebuild path
   - `ReviewStatusViewer` legacy artifact handling
3. approval gate blocks on test evidence warning
   - finding severity
   - `finalActionGate.requiredSectionKindsRemaining`
   - unresolved blocking finding filter
4. LLM reviewer returns unsupported tool failure
   - provider route class
   - `callProviderToolTurn` result mode
   - degraded artifact path
5. prompt suggestion missing
   - finding has evidence refs or artifact payload reference
   - `createReviewPromptSuggestions` target filter
   - `ensureReviewPromptSuggestion` test evidence branch

## Acceptance Criteria

- Review Status の該当 section は `テスト証跡確認` として表示される。
- `最終報告` / `検証記録` / `Run 記録チェック` は user-visible Review Status から消える。
- 名前一致ロジックは precheck として残り、最終判定には使われない。
- LLM は tool evidence に基づいて `confirmed` / `not_found` / `unclear` / `not_applicable` を返す。
- `not_found` / `unclear` の場合、改善依頼 Prompt を生成できる。
- precheck だけでは blocking finding を作らない。
- LLM reviewer failure 時に誤った確認済み表示をしない。
- 古い Run 記録チェック計画書は active docs から外れる。
- `test_coverage` は initial implementation で approval gate を止めない。
- agentic reviewer が tool evidence を使ったことを artifact から追える。
- 改善依頼 Prompt は user action なしに session へ投入されない。

## Non-Goals

- Review Mode が broad verify を自動実行すること。
- Review Mode が受け入れ可否を完全自動判定すること。
- テスト証跡確認から自動で修正実装を開始すること。
- Mission / Goal / Task を自動生成すること。
- セキュリティレビューや脆弱性診断をこの機能に統合すること。
- Review Mode 用の新しい task status / kanban column を作ること。
- `ReviewEvidenceRef` に新しい kind を追加すること。

## Deferred Questions

初期実装を止めない後続検討:

- `test_coverage` を将来 `test_evidence_review` に rename するか。
- `not_found` をユーザー設定で blocking に昇格できるようにするか。
- `ReviewEvidenceRef` に `test_file` / `test_case` kind を追加するか。
- Playwright / E2E の test step 名や `expect` body まで深く解析するか。
- LLM reviewer の provider route を Review Mode 専用に設定できるようにするか。

これらは Phase 1-4 の実装には不要。初期実装ではこの文書の Locked Decisions を優先する。
