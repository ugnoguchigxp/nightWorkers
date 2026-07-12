# Review Closeout Evidence Gate Implementation Plan

## Status

planned

## 目的

Test Mode と Review Mode の責務分離を維持したまま、Review Status からの明示的な Git commit が、保存済み evidence の完了を確認した後だけ可能になるよう closeout 契約を是正する。

今回の修正対象は次の4点である。

1. `review_run` artifact の存在ではなく、Review Run の正常完了を commit 条件にする。
2. Test Mode が所有する完了条件別の test evidence を closeout から参照し、未実行・失敗・古い証跡を区別して止める。
3. unresolved blocking finding がある状態で commit できないようにし、明示的な disposition 後だけ解除する。
4. implementation finalization で確定した Security Oracle の pass または policy skip を closeout response に接続し、未確認の security state を commit 可能として扱わない。

この計画は、Review Mode に test evidence の責務を戻す計画ではない。Test Mode は verification document / checklist / managed evidence / `completion_check` を所有し、Review Mode は diff / code finding / finding disposition を所有する。

## 現行ベースライン

### Test Mode

- `api/modules/nightworkers/nightworkers.verification.service.ts`
  - verification document の required condition を読み、`completion_check` で complete / failed / unknown を返す。
- `api/services/verification/checklist-matcher.ts`
  - managed test case と command-level evidence を condition ID に対応付ける。
- `api/modules/missionPilot/mission-pilot-post-queue-coordinator.service.ts`
  - Mission Pilot 経路では、verification document、managed evidence、raw artifacts、completion check、required checklist、context digest を確認し、pass snapshot を保存してから Review へ進む。
- `shared/test-mode-workflow.ts`
  - visible workflow は test implementation、unit test、evidence check を持つ。

### Review Mode

- `api/modules/review/review-run.service.ts`
  - Review target を確定し、Review Run artifact を先に `running` で保存してから `executionMode: "review"` の run を開始する。
  - code review と任意の vulnWorkbench security review を扱う。
- `api/modules/review/review-run-finalize.service.ts`
  - runtime terminal status を `done` / `needs_human` / `failed` に写像し、Review Run artifact と findings を保存する。
- `api/modules/review/review-mode.model.ts`
  - `test_coverage` は `SECTION_ORDER` から除外済みであり、test evidence は Review Mode の責務ではない。

### Security Oracle

- `api/modules/review/security-gate.service.ts`
  - repository verify 成功後に vulnWorkbench CLI を実行する。
  - clean の場合だけ `allowFinalize=true` とし、blocking fingerprint、scanner failure、反復上限を fail-close で扱う。
- `api/modules/nightworkers/run-orchestration/runtime-security-closeout.ts`
  - Project の実効設定に応じて Security Oracle を実行または明示skipし、event / snapshot を残す。

### Git closeout

- `api/modules/nightworkers/nightworkers.git-closeout.service.ts`
  - `task_run_commit_records` と current git state から commit / push 可否を返す。
  - 現行の review 完了判定は次である。

```ts
const reviewComplete =
  input.testCoverageStatus === "done" || Boolean(input.reviewRunStatus);
```

- `review_run.status` が `running` / `blocked` / `needs_human` / `failed` でも truthy のため commit gate が開く。
- `tests/nightworkers-git-closeout.test.ts` は `review_run.status="running"` で `canCommit=true` を期待しており、現行挙動を固定している。
- `ReviewStatusViewer` の手動commitボタンは `gitCloseout.canCommit` を使い、Review Run の in-progress state を独立には確認しない。

### Legacy test evidence

- `api/modules/review/review-run-test-evidence.service.ts` の `runReviewRunUnitTestCoverageCheck` は現行production callerを持たない。
- これは Review Run 移行後、さらに test evidence を Test Mode に一本化した結果である。
- Review Mode へ再接続しない。既存DBの `test_coverage` artifactを読む互換経路だけを限定的に残し、未使用serviceは削除対象とする。

## 問題

### 1. Review Runの開始と完了が区別されない

Review Run開始直後に`running` artifactが作られ、その存在だけでcommit可能になる。Reviewが失敗、停止、または人間判断待ちになっても同じである。

### 2. Test Mode evidenceがGit closeoutへ明示接続されていない

Mission Pilotはtest snapshotを厳密に確認するが、通常のGit closeout responseはTest Modeのverification document/checklist/evidenceを表示・判定しない。`task_run_commit_records.status="ready"`はimplementation runのverificationを示すが、独立したTest Modeの完了条件別evidenceとは同じではない。

### 3. Blocking findingがcommit gateへ接続されない

Review Run findingは`sourceSection="review_run"`で保存される。一方、`review_status.finalActionGate`はrequired sectionに属するblocking findingだけを見る。現行sectionはoptionalであるため、unresolved blocking findingがあってもGit closeoutを止めない。

### 4. Security Oracleの結果がcommit判断から見えない

implementation finalizationではSecurity Oracleがfail-closeで動くが、Git closeout responseはpass / skipped / missing / blockedのどれであったかを返さない。最終commit判断の説明可能性が不足している。

### 5. 互換契約が暗黙的

旧`test_coverage` artifactと現行Review Run artifactが単純なOR条件で混在している。どの世代のsessionでどちらを正本にするかが明示されていない。

## Locked Decisions

1. Test evidence confirmationはTest Modeに残す。Review Modeへ`testEvidenceReview` optionや`review.test_evidence` Todoを戻さない。
2. 現行Review Runが存在するsessionでは、`review_run.status === "done"`だけをReview完了とする。
3. `running`、`not_started`、`blocked`、`needs_human`、`failed`はすべてcommitを止める。
4. Review Runが1件も存在しないlegacy sessionだけ、`test_coverage.status === "done"`を互換完了条件として認める。
5. legacy fallbackは新規sessionの通常経路として使用しない。responseに`source: "legacy_test_coverage"`を明示する。
6. Mission Pilot closeoutでは、freshなMission Pilot test snapshot `verdict="pass"`を必須にする。
7. 通常sessionでは、active verification documentのrequired checklistがcompleteで、対応するmanaged evidenceと成功した`completion_check`があることをtest evidence完了条件とする。
8. Test Modeを実行していない通常sessionは`TEST_EVIDENCE_MISSING`で止め、UIからTest Mode artifactへ誘導する。
9. Security Oracleが実効有効なrunでは`allowFinalize=true`を必須とする。実効無効の場合は、保存済みの明示skip reasonを成功条件とする。
10. scanner resultがmissing、inconclusive、runtime/config error、blockingの場合はcommitを止める。commit時に再scanはしない。
11. unresolved `blocking` findingはcommitを止める。`dispositionStatus`が`accepted` / `converted` / `dismissed`のいずれかになった場合だけ処置済みとする。`disposition="accepted_risk"`または`dispositionStatus="dismissed"`で解除する場合は人間のnoteを必須にする。
12. warning / info findingはcommitを止めない。
13. commit対象path、HEAD、staged path、upstream等の既存Git安全契約は変更しない。
14. auto commitは追加しない。commit / pushは引き続き明示操作とする。
15. DB migrationは原則追加しない。既存verification、review、security event、commit recordからread modelを構成する。

## 正本となるcloseout判定

新しい判定はartifactの存在ではなく、明示したevidence stateを使う。

```ts
type ReviewCloseoutEvidence = {
  review: {
    source: "review_run" | "legacy_test_coverage" | "missing";
    status: "not_started" | "running" | "done" | "blocked" | "needs_human" | "failed";
    reviewRunId: string | null;
    completedAt: string | null;
  };
  test: {
    source: "mission_pilot_snapshot" | "verification_checklist" | "missing";
    status: "passed" | "missing" | "incomplete" | "failed" | "stale";
    verificationDocumentId: string | null;
    evidenceRunIds: string[];
    completionCheckEventId: string | null;
  };
  security: {
    source: "security_oracle" | "policy_skip" | "missing";
    status: "passed" | "skipped" | "blocked" | "failed" | "missing";
    scanRunId: string | null;
    eventId: string | null;
    reason: string | null;
  };
  findings: {
    unresolvedBlockingIds: string[];
  };
};
```

```ts
const canCommit =
  review.status === "done" &&
  test.status === "passed" &&
  (security.status === "passed" || security.status === "skipped") &&
  findings.unresolvedBlockingIds.length === 0 &&
  commitRecord.status === "ready" &&
  gitStateIsSafe;
```

legacy fallbackは次に限定する。

```ts
const legacyReviewDone =
  latestReviewRun == null && latestTestCoverage?.status === "done";
```

Review Runが存在する場合、legacy `test_coverage`で失敗中のReview Runを迂回できない。

## Blocking code

既存codeを維持しつつ、UIが具体的な次操作を示せるcodeを追加する。

```ts
type ReviewCloseoutBlockingCode =
  | "REVIEW_RUN_NOT_STARTED"
  | "REVIEW_RUN_IN_PROGRESS"
  | "REVIEW_RUN_NOT_SUCCESSFUL"
  | "TEST_EVIDENCE_MISSING"
  | "TEST_EVIDENCE_INCOMPLETE"
  | "TEST_EVIDENCE_FAILED"
  | "TEST_EVIDENCE_STALE"
  | "SECURITY_EVIDENCE_MISSING"
  | "SECURITY_GATE_BLOCKED"
  | "BLOCKING_FINDINGS_UNRESOLVED";
```

`REQUIRED_REVIEW_NOT_DONE`は旧clientとの互換responseに残してもよいが、server内部では上記の具体codeへ正規化する。

## 実装計画

### Phase 1: Closeout evidence resolver

対象:

- `api/modules/review/review-closeout-evidence.service.ts`（新規）
- `api/modules/review/index.ts`
- 関連schema / type
- `tests/review-closeout-evidence.test.ts`（新規）

実施内容:

1. implementation run / task / review sessionから最新Review Runを取得する。
2. Review Runのrow statusとpayload statusを照合し、不一致は`failed`として扱う。
3. `done`時はruntime terminal eventと`review.run_completed` eventの存在を確認する。
4. Mission Pilot sessionがある場合はactive test snapshot、context digest、`verdict="pass"`を確認する。
5. 通常sessionではverification document、required checklist、managed evidence run、成功したcompletion check eventを確認する。
6. implementation runのSecurity Oracle eventまたはpolicy skip eventを読み、pass / skipped / missing / blockedを返す。
7. Review sessionの未処置blocking findingsを列挙する。
8. legacy sessionはReview Runが存在しない場合だけ`test_coverage=done`をreview完了sourceとして返す。

Phase 1完了条件:

- resolverがDB状態だけから決定的な`ReviewCloseoutEvidence`を返す。
- artifactのtruthinessを完了判定に使わない。
- Mission Pilotと通常sessionのtest evidence sourceが混同されない。
- Security Oracleの未実行とpolicy skipが区別される。

Phase 1 focused tests:

```bash
bun run test run tests/review-closeout-evidence.test.ts
bun run test run tests/mission-pilot-test-mode.test.ts tests/security-oracle-gate.test.ts
```

### Phase 2: Git closeout gateを明示evidenceへ切り替える

対象:

- `api/modules/nightworkers/nightworkers.git-closeout.service.ts`
- `shared/schemas/nightworkers/review.schema.ts`
- `src/modules/review/types/review.ts`
- `tests/nightworkers-git-closeout.test.ts`

実施内容:

1. `Boolean(reviewRunStatus)`を削除する。
2. Phase 1 resolverを`loadCloseoutContext`から呼び、review/test/security/findingsをresponseへ含める。
3. 判定順をreview → test → security → findings → commit ownership → git stateに固定する。
4. commit endpointでもlock取得後に同じresolverを再実行し、GET後の状態変化をfail-closeで検出する。
5. `review_run=done`とterminal eventが一致しない場合はcommitしない。
6. legacy fallbackの適用有無をresponseへ明示する。

Phase 2完了条件:

- `running` Review Runでは`canCommit=false`になる。
- `needs_human` / `blocked` / `failed` Review Runではcommitできない。
- `done`以外のstatusを文字列の存在だけで許可する経路がない。
- GET時に通ってもPOST直前にevidenceが変わればcommitしない。
- legacy sessionだけ互換closeoutできる。

Phase 2 table-driven tests:

| Review Run | Legacy test coverage | Expected |
| --- | --- | --- |
| none | none | block |
| none | done | allow legacy review only |
| not_started | done | block |
| running | done | block |
| blocked | done | block |
| needs_human | done | block |
| failed | done | block |
| done | none | continue to test/security/finding gates |

```bash
bun run test run tests/nightworkers-git-closeout.test.ts
```

### Phase 3: Test evidence freshnessと通常session導線

対象:

- closeout evidence resolver
- verification repository / query helper
- `src/modules/review/components/ReviewStatusViewer.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx` または既存Test Mode open callback
- 関連frontend tests

実施内容:

1. Mission Pilotは保存済みtest snapshotとcurrent context digestを照合する。
2. 通常sessionはlatest active verification documentのrequired checklist completionを確認する。
3. evidence runが別verification document、別task、またはsource変更前の古いrunなら`stale`にする。
4. Test Mode未実行時はcommitボタンをdisabledにし、既存のTest Mode artifactを開くactionを表示する。
5. Test Mode失敗 / incomplete / staleの違いと次操作を表示する。
6. Review Mode自身ではtest commandやsemantic test matchingを再実行しない。

Phase 3完了条件:

- Test Modeを通っていないsessionは理由付きでcommit不可になる。
- Test Mode pass後はReview artifactへ戻っても同じ保存済みevidenceを参照できる。
- Review eventによって完了済みTest Mode表示がrunningへ戻らない。

Focused tests:

```bash
bun run test run tests/test-mode-workflow-view.test.ts tests/test-mode-artifact-pane.test.tsx
bun run test run tests/nightworkers-git-closeout.test.ts
```

### Phase 4: Blocking finding disposition gate

対象:

- closeout evidence resolver
- `api/modules/review/review-mode.service.ts`
- finding disposition handler / schema
- `src/modules/review/components/ReviewStatusViewer.tsx`
- 関連review tests

実施内容:

1. `sourceSection="review_run"`を含む全blocking findingをcloseout対象にする。
2. `unresolved`はcommitを止める。
3. `dispositionStatus="accepted"` / `"converted"`は既存契約どおり処置済みとする。
4. `dispositionStatus="dismissed"`または`disposition="accepted_risk"`の処置は人間noteを必須にする。
5. blocking finding数と対象IDをcloseout responseへ返す。
6. UIからfindingへスクロールまたは該当sectionへ移動できる導線を付ける。

Phase 4完了条件:

- blocking findingが1件でも未処置ならcommitできない。
- warning / infoだけならcommitを止めない。
- disposition後のreloadでもgate解除状態が維持される。

Focused tests:

```bash
bun run test run tests/review-finding-actions.test.ts tests/review-status-viewer.test.tsx
bun run test run tests/nightworkers-git-closeout.test.ts
```

### Phase 5: Security evidenceの可視化とfail-close確認

対象:

- closeout evidence resolver
- `api/modules/nightworkers/run-orchestration/runtime-security-closeout.ts`
- `src/modules/review/components/ReviewStatusViewer.tsx`
- security / closeout tests

実施内容:

1. effective enable時のSecurity Oracle pass eventをcloseoutへ接続する。
2. ineligible / user disabled / measurement unavailable等の明示skip eventを区別して表示する。
3. skip eventがない単なるmissingはpassにしない。
4. blocking / scanner failure / inconclusiveをcommit不可として表示する。
5. Review Runの任意security reviewとimplementation finalization Security Oracleを別ラベルで表示する。
6. commit操作ではvulnWorkbenchを再実行せず、保存済み結果だけを再検証する。

Phase 5完了条件:

- `passed`、`policy skipped`、`missing`、`blocked`がUI/APIで区別される。
- Review security optionがOFFでも、implementation Security Oracle結果を確認できる。
- effective enableなのに結果がない状態をcommit可能にしない。

Focused tests:

```bash
bun run test run tests/security-oracle-gate.test.ts tests/review-vulnworkbench.test.ts
bun run test run tests/nightworkers-git-closeout.test.ts
```

### Phase 6: Legacy cleanupとE2E

対象:

- `api/modules/review/review-run-test-evidence.service.ts`
- `tests/review-run-test-evidence.test.ts`
- `api/modules/review/index.ts`
- `tests/e2e/git-closeout.spec.ts`
- `tests/e2e/scenario-catalog.json`
- docs / release notes as needed

実施内容:

1. production importがないことを再確認して旧`runReviewRunUnitTestCoverageCheck` serviceと専用unit testを削除する。
2. Test Modeのverification checklist / managed evidence testsが同等以上の責務を保証することを先に確認する。
3. legacy DB artifact読取はcloseout resolverに限定し、新規write pathを追加しない。
4. E2Eへ「Review Run実行中はcommit不可」「Test Mode evidenceなしはcommit不可」「Review done + test pass + security pass/skip + findings処置後だけcommit可」を追加する。
5. scenario catalogへ新しいP0 required scenarioを追加するか、既存`NW-E2E-GIT-001`を分割して証拠種別を明示する。
6. E2Eはisolated DB / fixture workspaceで実行し、既存開発DBを使わない。

推奨scenario:

```text
NW-E2E-GIT-004: Review/Test/Security evidenceが揃うまでcommit closeoutを開かない
priority: P0
suite: regression
requiredEvidence: ui, api, database, task-events, git
```

Phase 6完了条件:

- 旧semantic test evidence serviceがReview Modeへ復活していない。
- current sessionとlegacy sessionのcloseoutをE2Eで区別できる。
- running Review Runでcommitできた既存回帰テストが、commit拒否を期待する内容へ更新される。
- scenario coverage gateが新契約をrequiredとして数える。

## API / UI response

`GET /api/runs/:id/git/closeout`は既存fieldを維持しつつ次を追加する。

```ts
type GitCloseoutResponse = {
  canCommit: boolean;
  state: GitCloseoutUiState;
  blockingCode: string | null;
  blockingReason: string | null;
  evidence: ReviewCloseoutEvidence;
  nextAction:
    | "open_test_mode"
    | "wait_for_review"
    | "open_review_findings"
    | "inspect_security_gate"
    | "commit"
    | null;
};
```

Review Statusは次を表示する。

- Review Run: status、completedAt、reviewRunId
- Test evidence: source、verification document、required complete数、stale reason
- Security: pass / policy skip / blocked、scanRunIdまたはskip reason
- Findings: unresolved blocking count
- Git: stageable / excluded paths、HEAD / staged safety

commitボタンはserver responseだけを正本とし、client側で独自にgateを再計算しない。clientは`nextAction`を使って適切なartifact/sectionを開く。

## 検証計画

各Phaseのfocused testに加え、最終的に次を実行する。

```bash
bun run test run tests/review-closeout-evidence.test.ts tests/nightworkers-git-closeout.test.ts tests/security-oracle-gate.test.ts
bun run test run tests/test-mode-workflow-view.test.ts tests/review-status-viewer.test.tsx
bun run typecheck
bun run lint
bun run verify
bun run verify:e2e
git diff --check
```

`verify:live`は外部provider credentialを使う別gateであり、この決定的closeout修正の完了条件には含めない。vulnWorkbench CLI integrationはinjected runner / fixtureと既存scanner contract testsで決定的に検証する。

## 失敗時の扱い

- Test evidence resolverがDBを読めない場合は`missing`ではなく`failed`として記録し、commitを止める。
- Review Run rowとterminal eventが不一致なら`REVIEW_RUN_NOT_SUCCESSFUL`とする。
- Security skip reasonが見つからない場合は暗黙skipにせず`SECURITY_EVIDENCE_MISSING`とする。
- blocking finding dispositionの保存に失敗した場合はgateを解除しない。
- commit POST中にevidenceが変わった場合はstage前に停止する。
- stage後に安全確認が失敗した場合は既存のfail-close処理でcommitしない。

## Out of Scope

- Test ModeとReview Modeの再統合
- Review Modeでのtest command再実行
- vulnWorkbench CLI / fingerprint / scanner profileの変更
- Security findingの自動修正範囲拡大
- auto commit / auto push
- PR作成、merge、deploy
- Queue scheduler、Mission Pilot planning、provider routingの再設計
- Tauri packaging / signing / release workflowの変更

## 完了条件

- `Boolean(reviewRunStatus)`がproduction closeoutから除去されている。
- Review Runは`done`かつterminal evidence整合時だけ完了扱いになる。
- Review Runが`running` / `blocked` / `needs_human` / `failed`ではcommitできない。
- Mission Pilotはfreshなpass test snapshot、通常sessionはcomplete verification checklistを必要とする。
- Test evidenceの責務がReview Modeへ戻っていない。
- implementation Security Oracleのpassまたは明示policy skipがcloseoutから確認できる。
- unresolved blocking findingがcommitを止め、明示disposition後だけ解除される。
- legacy `test_coverage=done` fallbackはReview Runが存在しない既存sessionだけに適用される。
- GET後とcommit POST直前で同じevidence gateを再評価する。
- UIはblocking理由と次操作を表示し、server response以外からcommit可否を推測しない。
- focused tests、`bun run verify`、`bun run verify:e2e`、`git diff --check`が成功する。
- 実装完了後、本書を`spec/archive/`へ移動する。
