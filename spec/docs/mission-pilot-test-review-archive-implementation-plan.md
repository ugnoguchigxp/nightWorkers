# Mission Pilot Test Mode・Review Mode・Task Archive 自律進行 実装計画

## Status

- Plan status: `reviewed-blocked-by-pre-queue-remediation`
- Document review completed: 2026-07-11
- Implementation status: `not_started`
- MVP slice: `3/3` — Implementation・Test Mode・Review Mode・Git closeout・true Task Archive
- Canonical plan for post-Queue remaining work: this document
- Required prerequisite: `spec/docs/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`
- Previous phase: `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md` (completed)
- Entry design: `spec/archive/mission-pilot-task-entry-design.md` (completed)
- Baseline reviewed: 2026-07-11, `main` at `c597bdd522ef7e4594157131c9d1865ce9ea148b`
- Current working tree reviewed: 2026-07-11。既存の未commit test変更は本計画の変更対象・baseline evidenceへ含めない
- Runtime evidence reviewed: 2026-07-11 local `sqlite.db`
- Target domain: `api/modules/missionPilot` / `src/modules/missionPilot`
- Target runtime span: Implementation Queue claim後から、Implementation、Test Mode、Review Mode、Git closeout、Task completion、真のTask Archiveまで

この文書を、Mission PilotがImplementation Queueへ正常に引き渡された後も同じMission Pilot Sessionとcanonical Context chainを維持し、実装、独立Test Mode、独立Review Mode、修正loop、Git closeout、Task完了、Task Archiveまで自律進行するための実装正本とする。

Mission Pilot専用画面は作らない。既存Task Chat、Test Mode artifact、Review Status artifact、Task rowへ進捗と停止機会を投影する。ただし、自動進行の正本はbrowser UI、Chat本文、リンククリック、React stateではなく、`api/modules/missionPilot`のdurable coordinatorと永続state machineである。

本書の「Archive」はQueue entryの`execution_archived`だけでも、Taskの`cancelled`流用でもない。Taskが完了条件、Test evidence、Review pass、Git closeoutを満たした後に、Task自身を明示的な`archived`終端状態へ移すことを指す。

本書は3文書で構成するMission Pilot MVPの最終sliceである。前2文書のTask生成、Play、Session / Context、Plan Mode、Questionnaire、Artifact、Queue admissionを入力契約とする。ただし、完了済みSlice 1/2に確認されたpre-Queue runtime handoff不整合は独立したremediation planで修正し、本書の実装scopeへ混ぜない。

remediation plan完了後、本書のTask `archived`までを同一Sessionで完了する統合E2EをMVP全体の最終acceptance gateとする。Project Evaluation再実行と評価結果からの次Task生成はMVP後続であり、このgateへ含めない。

### 0.1 Prerequisite boundary

本書の実装開始条件は、`spec/docs/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`が完了し、次のhandoff contractがfocused testとE2Eで確認済みであることとする。

- Session `desired_state === playing`。
- Session `phase === queued`。
- active Implementation Queue entryがexactly one。
- Queue pass済みlatest Context revision / digestが固定済み。
- exact Feature Plan / Verification Document / Plan review refsが取得可能。
- Queue admission前のImplementation / Test / Review runが存在しない。
- Taskがnon-terminal。

本書は初回Play、汎用WorkBench intake、Questionnaire生成、Plan Artifact生成、Plan self-review、Queue entry作成の修正を行わない。これらを変更する必要が判明した場合はremediation planを更新し、本書へ実装を混在させない。

## 1. 今回の計画が受け止める現状の失敗

現状は各機能が個別には存在するが、Mission Pilotの一続きの自律workflowになっていない。

1. Implementation完了後は最終報告へTest Modeリンクを付けるだけで、Test Modeを自動開始しない。
2. Test Mode完了後はReview Modeリンクを表示するだけで、Review Session / Review Runを自動開始しない。
3. Test Modeの画面進捗は一部のraw `command_execution`も正式check相当に推測でき、managed evidenceとの境界が曖昧である。
4. Test runの`completed`とTask全体の`completed`がgeneric finalizerで同じように扱われる。
5. Review Sessionは実装run、test run、review runのどれをMission全体の対象にするかを持たない。
6. Review targetは単一runの`git.diff_collected` / `run.diffPatch`と現在diffを中心に作られ、Mission Pilotの複数run変更を集約しない。
7. Review Runの終了statusが`done`でも、blocking findingがない`pass`とは限らない。
8. `finalizeReviewRunFromRuntime()`はfree-form final reportからfindingを抽出するが、review verdictを強制する構造化contractがない。
9. Review Sessionの`status` / `completedAt` / `finalAction`がReview Run完了と一貫して閉じない経路がある。
10. Git closeoutは1つの`task_run_commit_records`だけを対象にするため、Implementation runとTest runが別々に所有する変更をまとめてcommitできない。
11. 現在のcloseout gateは`Boolean(reviewRunStatus)`でReview evidenceありとみなせるため、`running`や`needs_human`でもtruthyになり得る。
12. Review Statusの「完了してアーカイブ」はTaskを`cancelled`へ変更するだけで、完了、closeout、review passを検証しない。
13. `cancelled`と`failed`がArchive groupへまとめられ、正常完了のArchiveと中断・失敗が区別できない。
14. Task statusに`archived`がなく、Taskの`archivedAt`もない。
15. Queue entryのArchiveとTaskのArchiveが別概念として契約化されていない。
16. Mission Pilotのcanonical ContextはQueueまで計画済みだが、Implementation / Test / Review / closeout evidenceを継続して追加するschemaが未定義である。

### 1.1 2026-07-10 historical post-run snapshot

2026-07-10時点の`sqlite.db`では、同一Taskについて次の分断を確認した。

```text
Task: cancelled
Implementation Queue: execution_completed
Implementation run: completed
Test run: completed
Review run: completed
Review Session: in_progress
Review Run artifact: done
Implementation commit record: not_requested
Test commit record: needs_human
Review commit record: needs_human
```

これは「各runが終了した」ことと「Mission PilotがTaskを完了しArchiveした」ことが同義ではない証拠である。本書ではこの状態を正常完了として扱わない。

### 1.2 2026-07-11 pre-Queue runtime failureの扱い

2026-07-11 local runtimeでは、Queue entryなしのまま`workbench_intake` Implementation runが完了し、Task `completed` / Mission Pilot Session `attention`へ分断した状態を確認した。このfailureは本書のpost-Queue state machineへ取り込まず、prerequisite remediation planの修正・回帰fixtureとして扱う。

本書は、そのfailureをTask status rollback、Queue entry backfill、initial Play変更によって修復しない。remediation完了後に新規または明示的にreconciledされたhealthy handoffだけを入力として受け付ける。

## 2. 目的

Mission PilotのPlayを開始意図として、次を人手による「次へ」操作なしで完了させる。

```text
Queue admission済みContext
  -> Queue schedulerがImplementation runをclaim
  -> Implementation roleが仕様を実装
  -> implementation completion gate
  -> canonical Contextへ実装差分・run evidenceを追加
  -> 独立Test Mode runを作成
  -> Test roleが完了条件テストを実装
  -> managed run_check
  -> completion_check
  -> test completion gate
  -> canonical Contextへfrozen test evidenceを追加
  -> 独立Review Session / Review Runを作成
  -> Review roleがMission全変更をレビュー
  -> blocking findingあり
       -> Implementation rework run
       -> 新しいTest Mode run
       -> 新しいReview Run
  -> review pass
  -> Mission全runの所有差分を集約
  -> local Git commit
  -> push policyを評価
  -> Task completed
  -> Task archived
  -> Mission Pilot stopped / archived
```

実装LLM、Test LLM、Review LLMがRole Routerで別model / providerになっても、全roleは同じMission Pilot Sessionの最新canonical Context revisionからprojectionを受け取る。各roleのthread/historyは独立してよいが、判断根拠は断絶させない。

## 3. 成功条件

次をすべて満たしたとき、このphaseを完了とする。

1. Queue claim後のImplementation runがMission Pilot Sessionへ関連付けられる。
2. Implementation roleはQueue直前にpassしたContext revisionを受け取る。
3. Implementation roleへChat transcriptを渡さない。
4. Implementation runの終了だけでTask全体を`completed`にしない。
5. open implementation Todo、security gate、runtime failureが残る場合はTest Modeへ進まない。
6. implementation completion evidenceがcanonical Contextへimmutable revisionとして追加される。
7. Test ModeはImplementation runと別のTaskRun / provider sessionで開始する。
8. Test ModeはImplementation Todo / thread historyを継承しない。
9. Test roleは同じMission Pilot Context chainと最新実装evidenceを受け取る。
10. Test Mode開始前にexact Feature PlanからVerification Documentを確定する。
11. Test Modeの進捗はruntime Todoではなくmanaged tool eventとVerification Checklistを正本にする。
12. raw `bun run test ...`等のcommand executionだけではTest completion gateを通さない。
13. `nightworkers.run_check` / `run_verification`のraw output artifactとnormalized evidenceを永続化する。
14. `nightworkers.completion_check`がすべてのrequired conditionをcompleteと判定する。
15. Test runが`completed`でもrequired conditionがfailed / unknownならReviewへ進まない。
16. Test roleはテスト、fixture、test supportを実装できる。
17. production defectが見つかった場合は構造化rework packetを作り、Implementation roleへ戻す。
18. Test Modeがproduction code修正を自分の責務として抱え込まない。
19. Test pass時のchecklist / command / evidence IDsをfrozen snapshotとして保存する。
20. Review Modeへ移った後、過去のTest progress表示が別runに上書きされない。
21. Review Session / Review RunはImplementation/Testとは別sessionで開始する。
22. Review roleはChat transcriptやImplementation thread historyを引き継がない。
23. Review roleは同じMission Pilot Context、frozen test evidence、Mission全runのtarget manifestを受け取る。
24. Review targetは単一runの`run.diffPatch`だけでなく、全Mission phase runのtyped edit signalとcommit ownership evidenceから作る。
25. pre-existing dirty filesとMission外dirty filesを除外する。
26. code review、仕様・受け入れ条件照合、回帰、責務境界、security baselineを一通り実行する。
27. optional security integration未設定と、実際のsecurity findingを混同しない。
28. Review Runは構造化verdictとfinding listを返す。
29. `run completed` / `artifact done`と`review pass`を別状態として保存する。
30. unresolved blocking findingが1件でもあればGit closeoutへ進まない。
31. blocking findingはImplementation rework packetへ変換される。
32. rework後は古いTest / Review passを無効化し、新しいTest ModeとReview Modeを必ず実行する。
33. warning / info findingはpolicyに従いTask proposal候補へ変換できるが、既定ではArchiveを妨げない。
34. 修正loopが無限にならず、上限超過時は`attention`で停止する。
35. Git closeoutはMission Pilotに属する全phase runの所有pathを集約する。
36. pre-existing dirty path、Mission外path、既存staged pathをcommitへ混ぜない。
37. commit直前にHEAD、baseline、owned path、Review pass digestを再検証する。
38. local commit成功時にcommit SHA、message、pathsを永続化する。
39. pushは明示済みproject policyが許可する場合だけ自動実行する。
40. push未承認はlocal completion / Archiveを妨げない。
41. push required policyでpush失敗時はArchiveせず`attention`へ移る。
42. commit hookがsourceを変更した場合はTest / Reviewを無効化して再実行する。
43. Task `completed`はTest pass、Review pass、closeout passの後にだけ設定される。
44. Task `archived`はTask `completed`の後にだけ設定される。
45. `cancelled`を正常Archiveとして使わない。
46. `failed`を自動的にArchive表示へ送らない。
47. `tasks.archived_at`とTask Archive audit recordを保存する。
48. Queue entryの`execution_archived`とTaskの`archived`を両方整合させる。
49. Archive transaction途中のprocess restartからexactly-onceで復旧する。
50. Archive済みTaskは通常active listから除外されるが、Archive view / historyから取得できる。
51. ArchiveからのRestoreは以前のterminal statusへ戻し、自動実装を再開しない。
52. 再実装はRestoreとは別の明示的Reopen / new Mission Pilot cycleで行う。
53. Stopはどのphaseでも新step開始を禁止し、active runを既存stop経路で停止できる。
54. Play再開時は最新永続phaseから進み、完了済みrunやcommitを重複作成しない。
55. 通常Taskの手動Test Mode、手動Review Run、手動commit、手動Archiveに回帰がない。
56. migration、focused tests、typecheck、verify、restart E2E、実browser E2Eが成功する。

## 4. Locked Decisions

以下をこのphaseの固定契約とする。

1. post-Queue Mission Pilot orchestrationの正本は`api/modules/missionPilot`とする。
2. frontend integrationの正本は`src/modules/missionPilot`とする。
3. Test / Review / Queue / Gitの既存domain serviceをport経由で再利用し、Mission Pilot固有判断を各domainへ分散させない。
4. Mission Pilot専用Test画面、Review画面、Archive画面を作らない。
5. browser UIのリンク、button click、active tabを自動進行triggerにしない。
6. Chat本文を監視、要約、分類してphase遷移を決めない。
7. phase遷移はtyped domain event、永続step、canonical Context revisionで決める。
8. Role Routerはmodel/providerを選ぶだけで、Mission Pilot state machineを所有しない。
9. llm-providerはprovider call、JSON抽出、schema検証、最小互換正規化だけを担当する。
10. prompt文言は日本語を維持する。
11. ユーザー文言のkeyword / regex分類でfailure routeやreview verdictを決めない。
12. Queue直前Context review `pass`が、このphaseのImplementation input revisionになる。
13. Implementation / Test / ReviewのCodex thread resumeは無効のままにし、各roleをfresh sessionにする。
14. fresh provider sessionとcanonical Context continuityは両立させる。
15. Test Modeはruntime Todoを持たない。
16. Test Mode progressの正本はVerification Checklist、verification evidence row、managed tool eventである。
17. raw command outputはdiagnosticとして表示できるが、formal Test pass evidenceに昇格させない。
18. Test roleが編集できる既定scopeはtest file、fixture、test utility、test configの必要最小限に限定する。
19. production code defectはImplementation reworkへ戻す。
20. Review ModeはTest Modeの証跡作成責務を再実行しない。frozen Test snapshotを入力として確認するだけとする。
21. Mission Pilot Review Runでは`applyFixes=false`、`commitChanges=false`を固定する。
22. Review roleは指摘を作り、Implementation roleが修正し、Test roleが再検証する。
23. code reviewは常に有効にする。
24. baseline security reviewは常に有効にする。
25. vulnWorkbench等のoptional integrationはproject policyが有効な場合に使う。
26. optional integration未設定だけをblocking findingにしない。
27. project policyがsecurity integration必須なら、未設定・実行失敗を`attention`にする。
28. `Review Run status=done`は`Review verdict=pass`を意味しない。
29. Review verdictは`pass | rework | attention`の構造化schemaを必須にする。
30. blocking findingがある`pass` responseはschema validation後も採用しない。
31. findingはseverity、category、file、line、evidence、recommended action、blocking reasonを持つ。
32. review targetはMission Pilot Session配下の全relevant runから決定的に構築する。
33. current git diffだけをtarget source of truthにしない。
34. `git.diff_collected`、run ownership、baseline/current Gitを照合する。
35. implementation / test / reworkによる所有pathをMission closeout単位で集約する。
36. Review run自身は既定で編集しないためcloseout pathへ追加しない。
37. Review Sessionのcompatibility anchorは、そのcycleのlatest accepted Implementation runとする。latest Test runを暗黙anchorにしない。
38. Test snapshotとMission-wide target manifestはReview Session artifact / decisionから別refとして参照する。
39. Mission Pilot Playは、そのTaskについてPlan、Queue、local implementation、test mutation、review、local commit、Task complete、Task archiveまで進めるauthorizationとする。
40. このauthorizationは`authorization_json` version 2として保存する。
41. `git push`は外部状態変更のため、Playだけから暗黙承認しない。
42. pushはproject settingの明示policyが`allowed`または`required`の場合だけ行う。
43. default push policyは`never`とする。
44. local commitは変更があるMission Pilotの正常完了条件とする。
45. no-op implementationはowned diffがない証拠を保存すればcommit不要とする。
46. pre-existing staged fileがある場合は自動unstageせず`attention`にする。
47. commit hookによる内容変更は新しいimplementation mutationとして扱い、Test / Review passをinvalidateする。
48. Task statusへ`archived`を追加する。
49. `cancelled`は利用者またはruntimeの中断、`failed`は失敗、`archived`は履歴保管を表す。
50. Task ArchiveとQueue entry archiveを別event / 別gateとして扱う。
51. completedとarchivedは別stepにし、process crash時にcompletedからArchiveを再開できるようにする。
52. Archive groupは`archived`だけを正本にし、`completed`の24時間経過を表示上だけArchive扱いする現行規則を廃止する。
53. normal completed Taskは明示Archiveまたは将来のretention jobがtrue Archive serviceを通すまで`completed`のままにする。
54. Archive Restoreは保存済み`previous_status`へ戻す。自動的に`ready`へ戻さない。
55. Restore後も古いMission Pilot Sessionを自動再生しない。
56. retry / rework回数は永続化し、process restartでリセットしない。
57. implementation reworkは最大3 cycle、review reworkは最大2 cycle、post-Queue total correction cycleは最大5とする。
58. limit到達前に判断が曖昧ならcontextStill `context_decision`を使う。
59. contextStill `reject`または実行不能は`attention`にする。
60. `execute` / `revise_and_execute`は構造化routeへ反映して継続する。
61. Stopはactive run cancellationを既存`stopTaskRun()`へ委譲し、独自cancellation engineを作らない。
62. runtime / MCP / generatorの固定エラー本文でLLMの有効な本文を置き換えない。
63. 通常Taskの手動workflowはMission Pilot Sessionの存在を明示確認した場合だけPilot pathへ入る。
64. 本契約を変更する場合は実装より先に本書を更新する。

## 5. Scope

### 5.1 含む

- Queue claim後のMission Pilot run association。
- Implementation completion gate。
- post-Queue canonical Context extension。
- separate Test Mode run自動開始。
- Verification Document準備とcycle snapshot。
- test implementation / managed checks / completion check。
- test failure分類とImplementation rework loop。
- separate Review Session / Review Run自動開始。
- Mission全runのReview target aggregation。
- structured Review verdict / findings。
- blocking findingのImplementation rework loop。
- Mission aggregate Git ownership / closeout。
- local commit、optional push policy。
- Task completed / true archived lifecycle。
- Archive history / Restore / Reopenの分離。
- pause / resume / restart recovery / idempotency。
- existing Test / Review / Sidebar UIへの状態projection。
- migration / backfill / focused / integration / E2E / verify。

### 5.2 含まない

- initial Play / generic WorkBench intakeのrouting修正。
- Questionnaire / Plan Artifact / Plan self-review / Queue admissionのhandoff修正。
- Queue admission前にterminal化した既存Sessionのreconcile / rollback。
- Mission Pilot専用page / modal / wizard。
- Chat transcript summarization。
- Chat contentをContextへ取り込むこと。
- Review後のProject Evaluation再実行。
- Evaluationから次Taskを無限生成するloop。
- PR作成、merge、release、deployment。
- defaultでのGit push。
- user所有のunrelated dirty file cleanup。
- normal Taskを自動的にMission Pilotへ変換すること。
- Test ModeとReview Modeを同一runへ統合すること。
- contextStill内にNightWorkersのTask DBを複製すること。

## 6. 現在の実装状態と再利用境界

### 6.1 Queue / Implementation

`api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts`は前段Artifact生成、Plan self-review、Queue admissionまで実装済みである。ただし、初回PlayからQueue admissionまでのruntime handoff修正はprerequisite remediation planが所有する。本書はその修正を再実装しない。

`api/modules/nightworkers/run-orchestration/queues.ts`はImplementation Queue entryをclaimし、`startTaskRun(..., executionMode: "implementation")`を開始する。capacity、lease、processor slot、sequenceを既に持つため、Mission Pilotはこのschedulerを迂回しない。

`api/modules/nightworkers/run-orchestration/runtime-execution.ts`はruntime終了後にTodo closeout、Security Oracle gate、run status、Task status、Queue entry statusを更新する。現在はexecution modeごとの親Task lifecycleを十分区別せず、Test / Review runの`completed`もTaskへ反映し得る。

再利用するもの:

- Queue claim / lease / capacity / sequence。
- `startTaskRun()`。
- run event ledger。
- Todo closeout / security gate。
- `task_run_commit_records`のrun単位ownership evidence。

変更するもの:

- Mission Pilot session association。
- execution-mode別parent Task status projection。
- completion domain event。
- run単位完了とMission全体完了の分離。

### 6.2 Test Mode

`api/modules/nightworkers/nightworkers.service.ts`の`startTestModeRunFromArtifact()`はVerification Documentを解決し、`executionMode: "test"`の別TaskRunを作る。

`api/modules/nightworkers/run-orchestration/start-task-run.ts`はTest Modeでinitial Todoを空にし、Codex runtime resumeを`test_mode_fresh_context`として無効化する。

`api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`はTest Modeに次を要求している。

- `read_current_specification view=verification`。
- Verification Checklistをsource of truthにする。
- separate sessionで動く。
- `run_check` / `run_verification`でmanaged evidenceを残す。
- `completion_check`を実行する。
- TodoListを使わない。

`api/modules/nightworkers/nightworkers.verification.service.ts`はevidenceをchecklistへ適用し、required conditionのfailed / unknownを含むcompletion resultを返す。

`src/modules/nightworkers/testModeWorkflowView.ts`はmanaged tool eventからTest progressを組み立てる基盤を持つ。一方でraw `command_execution`を`run_check`相当に推測するfallbackもあるため、formal pass gateとしては使わない。

再利用するもの:

- Verification Document / Checklist / Evidence tables。
- Test Mode separate run。
- managed `run_check` / `completion_check` tools。
- Test Mode artifact UI。
- Todoなしのprogress model。

変更するもの:

- automatic start。
- Mission Pilot Context projection。
- backend completion gate。
- frozen evidence snapshot。
- defect classification / rework handoff。
- raw commandとformal evidenceの分離。

### 6.3 Review Mode

`api/modules/review/review-mode.service.ts`はReview recommendation / Session / artifact / findingを管理し、`startReviewRun()`を提供する。

`api/modules/review/review-run.service.ts`はcode review、security review、fix、commit optionからReview TODOを作り、`executionMode: "review"`の別TaskRunを開始する。

`api/modules/review/review-targets.service.ts`は`git.diff_collected`、`run.diffPatch`、current dirty diffを照合し、run外dirty fileを除外する。この考え方は維持するが、Mission Pilotでは単一runではなく全phase runへ拡張する。

`api/modules/review/review-run-finalize.service.ts`はReview Runのfinal reportからfindingsを抽出し、Review Run artifactを更新する。現在はReview Sessionを必ずterminalへ閉じるstructured verdictがない。

`src/modules/review/components/ReviewStatusViewer.tsx`はReview Run option、result、manual commit、Task archive操作を表示する。Mission Pilot中はこの既存surfaceをread/control projectionとして使い、backend coordinatorが自動進行する。

再利用するもの:

- Review Session / Recommendation / Artifact / Finding persistence。
- Review Run separate TaskRun。
- Review targetのedit-signal優先原則。
- Review Status UI。
- security diagnostic integration。

変更するもの:

- Mission-wide target manifest。
- structured Review result schema。
- Review Session terminal transition。
- pass / rework / attention gate。
- Pilot固定option `applyFixes=false`, `commitChanges=false`。

### 6.4 Git closeout

`api/modules/nightworkers/nightworkers.git-closeout.service.ts`はbaseline HEAD、pre-existing dirty path、stageable owned path、excluded path、current staged pathを確認し、対象pathだけをstage / commitできる。

この安全境界は維持する。ただし現在のAPIは単一run IDをownerとし、Review Sessionも単一runへ紐づく。Implementation run、Test run、rework runがそれぞれ変更を持つMission Pilotでは、単一run recordだけでは全変更を安全にcommitできない。

また現在の`requiredReview.complete`は`testCoverageStatus === "done" || Boolean(reviewRunStatus)`であり、Review Run statusが`running`や`needs_human`でもcomplete相当になり得る。Mission Pilot closeoutではこの判定を使わない。

再利用するもの:

- Git process wrapper。
- repository-level closeout lock。
- baseline / HEAD / staged / ownership checks。
- commit message LLM fallback。
- push safety policy。

変更するもの:

- Session-level aggregate closeout record。
- exact Test / Review pass evidence gate。
- all phase run ownership union。
- commit hook mutation invalidation。

### 6.5 Archive

現在の`archiveTask()`はTask statusを`cancelled`へ変更する。`ReviewStatusViewer`の「完了してアーカイブ」も`updateSessionStatus(taskId, "cancelled")`を呼ぶ。

`src/modules/nightworkers/workbenchSessionSelectors.ts`は`cancelled`と`failed`をArchive groupとし、`completed`は24時間後にArchive groupへ表示する。これは表示groupと実際のTask lifecycleを混同している。

`implementation_queue_entries`には`execution_archived`と`archived_at`があるが、`tasks`には`archived` statusも`archived_at`もない。

本phaseでは正常完了Archiveを独立したTask lifecycleへ改める。

## 7. 全体アーキテクチャ

```text
Implementation Queue
  -> existing scheduler / TaskRun
  -> typed run completion event
  -> MissionPilotCoordinator
       -> load canonical Context revision N
       -> validate phase completion gate
       -> append Context revision N+1
       -> create next phase run through domain port
       -> persist phase-run relation
       -> wait for typed completion event
  -> Test Mode domain
  -> Review domain
  -> Mission aggregate Git closeout
  -> Task completion service
  -> Task archive service

Existing UI
  <- Mission Pilot session summary
  <- Test evidence snapshot
  <- Review status / findings
  <- closeout / archive projection
```

### 7.1 Domain ownership

`api/modules/missionPilot`が所有するもの:

- post-Queue phase state machine。
- canonical Context revision。
- phase run association。
- completion gate orchestration。
- correction cycle / limit。
- aggregate closeout decision。
- Task completion / Archive admission。

既存domainが所有し続けるもの:

- Queue: claim / lease / scheduling。
- NightWorkers runtime: TaskRun execution / tool event / Todo。
- Verification: document / checklist / evidence normalization。
- Review: session / artifact / finding / rubric / security diagnostic。
- Git closeout: Git command / path safety checks。
- Task repository: Task row mutation。

Mission Pilotは各domainの内部tableを直接更新せず、明示port / serviceを呼ぶ。transactionが複数domainにまたがるTask completion / Archiveだけは、専用application serviceでrepository transactionを束ねる。

## 8. Post-Queue state machine

前段の`mission_pilot_sessions.phase`へ次を追加する。

```text
queued
implementation_starting
implementing
implementation_evaluating
test_preparing
testing
test_evaluating
implementation_rework
review_preparing
reviewing
review_evaluating
review_rework
closeout_preparing
committing
pushing
completing
completed
archiving
archived
paused
attention
cancelled
```

### 8.1 Transition table

| from | event / gate | to | mutation |
| --- | --- | --- | --- |
| queued | Queue entry claimed | implementation_starting | implementation run relation作成 |
| implementation_starting | TaskRun created | implementing | active phase run更新 |
| implementing | run terminal completed | implementation_evaluating | completion gate開始 |
| implementing | run failed / blocked / cancelled | attention / paused | evidence保存 |
| implementation_evaluating | gate pass | test_preparing | Context revision追加 |
| implementation_evaluating | gate fail | attention | Test開始禁止 |
| test_preparing | Verification Document fixed | testing | test run開始 |
| testing | test run terminal | test_evaluating | checklist / evidence読取 |
| test_evaluating | test pass | review_preparing | frozen test snapshot保存 |
| test_evaluating | test defect | test_preparing | test attempt更新 |
| test_evaluating | implementation defect | implementation_rework | rework packet保存 |
| implementation_rework | rework run開始 | implementing | cycle更新 |
| review_preparing | target manifest / session ready | reviewing | Review Run開始 |
| reviewing | review run terminal | review_evaluating | structured result読取 |
| review_evaluating | pass | closeout_preparing | Review pass snapshot保存 |
| review_evaluating | blocking finding | review_rework | rework packet保存 |
| review_rework | rework run開始 | implementing | Test / Review pass invalidate |
| closeout_preparing | aggregate ownership ready | committing | commit lock取得 |
| committing | commit success | pushing / completing | SHA保存 |
| pushing | push success | completing | pushed evidence保存 |
| pushing | optional push skipped | completing | skip reason保存 |
| completing | completion transaction success | completed | Task completed |
| completed | archive admission pass | archiving | archive step claim |
| archiving | archive transaction success | archived | Task / Queue / Session archive |
| any active | Stop | paused | next step禁止、active run stop |
| paused | Play | persisted prior phase | reconcile後継続 |
| any | unrecoverable / limit | attention | user visible evidence |

`run.status=completed`をそのままstate transitionにしない。必ずexecution mode、phase relation、input Context digest、domain-specific gateを照合する。

## 9. Persistence model

### 9.1 `mission_pilot_sessions` extension

前段tableへ次を追加する。

`authorization_version`はslice 1/2で初回Play時に設定済みであり、本書ではpost-Queue gateの入力として再掲する。別authorization rowや再承認stepを作らない。

| column | type | rule |
| --- | --- | --- |
| `authorization_version` | integer | version 2 |
| `implementation_cycle` | integer | initial=1 |
| `test_cycle` | integer | initial=0 |
| `review_cycle` | integer | initial=0 |
| `total_correction_cycle` | integer | durable loop cap |
| `active_phase_run_id` | text nullable FK task_runs | current run |
| `latest_test_snapshot_id` | text nullable | frozen evidence ref |
| `latest_review_decision_id` | text nullable | pass/rework ref |
| `active_closeout_id` | text nullable | aggregate closeout ref |
| `completed_at` | timestamp nullable | Mission completion |
| `archived_at` | timestamp nullable | Task archive synced |

`authorization_json` version 2:

```ts
type MissionPilotAuthorizationV2 = {
  version: 2;
  sessionId: string;
  taskId: string;
  sourceRef: MissionPilotSourceRef;
  grantedByAction: "mission_pilot_play";
  grantedAt: string;
  scopes: {
    plan: true;
    queue: true;
    implementation: true;
    testMutation: true;
    review: true;
    localCommit: true;
    taskComplete: true;
    taskArchive: true;
    push: boolean;
  };
  pushPolicy: "never" | "allowed" | "required";
};
```

このschemaの正本はslice 1で追加する`shared/schemas/mission-pilot.schema.ts`である。本書はpost-Queue gateで使用するfieldを再掲しており、別schemaを定義しない。

project setting `repositories.feature_settings.missionPilot.pushPolicy` が`allowed|required`の場合だけ`scopes.push`をtrueとしてactivation snapshotへ固定する。未設定は`never`とする。実行途中のsetting変更はcurrent Missionへ暗黙適用せず、明示refresh eventで新revisionを作る。

### 9.2 `mission_pilot_phase_runs`

Mission全体に属するTaskRunを明示する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | relation ID |
| `session_id` | text FK | Mission owner |
| `task_id` | text FK | denormalized boundary |
| `phase` | text | implementation / test / review |
| `cycle` | integer | phase cycle |
| `attempt` | integer | same cycle retry |
| `run_id` | text unique FK task_runs | exact run |
| `parent_phase_run_id` | text nullable | rework origin |
| `input_context_revision` | integer | frozen input |
| `input_context_digest` | text | stale check |
| `output_context_revision` | integer nullable | accepted output |
| `status` | text | starting / running / completed / failed / invalidated |
| `verdict` | text nullable | pass / rework / attention |
| `evidence_json` | JSON | refs only |
| `started_at` / `finished_at` | timestamp | audit |

unique `(session_id, phase, cycle, attempt)`。

TaskRunの`context_snapshot`にも`missionPilot` envelopeを複製するが、relation tableを正本とする。

### 9.3 `mission_pilot_test_snapshots`

Test Modeを離れた後も証跡を固定する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | snapshot ID |
| `session_id` | text FK | owner |
| `phase_run_id` | text unique FK | source Test run |
| `verification_document_id` | text FK | exact document |
| `context_revision` / `context_digest` | integer / text | tested implementation |
| `checklist_digest` | text | immutable summary digest |
| `required_total` | integer | count |
| `required_complete` | integer | count |
| `failed_required` | integer | must be 0 |
| `unknown_required` | integer | must be 0 |
| `evidence_run_ids_json` | JSON | managed evidence refs |
| `completion_check_event_id` | text | exact event |
| `test_changed_paths_json` | JSON | test-owned edits |
| `verdict` | text | pass / rework / attention |
| `snapshot_json` | JSON | frozen normalized result |
| `created_at` | timestamp | immutable |

同一Test phase runに1件。新しいImplementation mutationが起きたら古いsnapshot rowは消さず、Session latest refだけをnullにしてinvalidated eventを作る。

### 9.4 `mission_pilot_review_decisions`

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | decision ID |
| `session_id` | text FK | owner |
| `review_session_id` | text FK | existing Review Session |
| `review_phase_run_id` | text unique FK | Review TaskRun relation |
| `context_revision` / `context_digest` | integer / text | reviewed Context |
| `test_snapshot_id` | text FK | reviewed Test pass |
| `target_manifest_digest` | text | reviewed diff set |
| `verdict` | text | pass / rework / attention |
| `blocking_count` | integer | pass requires 0 |
| `warning_count` / `info_count` | integer | audit |
| `finding_ids_json` | JSON | existing review findings refs |
| `decision_json` | JSON | structured result |
| `created_at` | timestamp | immutable |

### 9.5 `mission_pilot_closeouts`

単一runのcommit recordではなくMission全体のcloseoutを所有する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | closeout ID |
| `session_id` | text FK | owner |
| `attempt` | integer | closeout attempt |
| `repository_id` | text FK | lock scope |
| `baseline_head` | text | first implementation baseline |
| `review_decision_id` | text FK | exact pass |
| `reviewed_context_digest` | text | stale check |
| `owned_phase_run_ids_json` | JSON | source runs |
| `stageable_owned_paths_json` | JSON | union |
| `excluded_paths_json` | JSON | pre-existing / outside ownership |
| `status` | text | preparing / ready / committing / committed / pushing / pushed / skipped / needs_human / failed |
| `commit_sha` / `commit_message` | text nullable | result |
| `push_policy` | text | frozen policy |
| `push_status` | text | not_requested / pushing / pushed / skipped / blocked / failed |
| `push_remote` / `push_branch` | text nullable | result |
| `status_reason` | text nullable | stable diagnostic |
| `created_at` / `updated_at` | timestamp | audit |

unique `(session_id, attempt)`。Session `active_closeout_id`がcurrent attemptを指し、同時active closeoutは最大1件とする。hook mutationやpost-commit dirty changeで再closeoutが必要な場合、古いrowを監査用に残してattemptを増やす。

各`task_run_commit_records`はrun単位evidenceとして残す。aggregate closeoutはそれらを参照し、書き換えない。

### 9.6 Task true archive

`TaskStatus`へ`archived`を追加し、`tasks`へ次を追加する。

| column | type | rule |
| --- | --- | --- |
| `completed_at` | timestamp nullable | Task completion time |
| `archived_at` | timestamp nullable | Archive time |

`task_archive_records`:

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | archive record |
| `task_id` | text FK | Task owner |
| `mission_pilot_session_id` | text nullable FK | Pilot source |
| `source_run_id` | text nullable FK | final reviewed anchor |
| `previous_status` | text | must be completed for auto Pilot archive |
| `reason` | text | mission_pilot_completed / manual / retention |
| `evidence_json` | JSON | test/review/closeout refs |
| `archived_at` | timestamp | terminal time |
| `restored_at` | timestamp nullable | restore audit |
| `restored_to_status` | text nullable | exact restore result |
| `restored_by` | text nullable | actor |

active archive recordはTaskごとに最大1件とする。Restore時にrowを削除しない。

### 9.7 `mission_pilot_events`

前段実装では汎用outboxが意図的に見送られ、現在のDBに`mission_pilot_events`は存在しない。本phaseではRun、Review、Git closeout、Task completion、Archiveを跨ぐexactly-once progressionとresponse-loss recoveryに必要なため、post-Queue state machineのfoundationとして追加する。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | event ID |
| `session_id` | text FK | Mission owner |
| `task_id` | text FK | Task boundary |
| `event_type` | text | typed event name |
| `phase` | text | phase at emission |
| `cycle` | integer nullable | phase cycle |
| `context_revision` | integer | exact Context revision |
| `context_digest` | text | stale-response check |
| `dedupe_key` | text | source-domain exactly-once key |
| `source_kind` | text | queue / task_run / verification / review / git / task_archive / coordinator |
| `source_id` | text nullable | source row/event/run ID |
| `payload_json` | JSON | refs and normalized decision only |
| `process_status` | text | pending / processing / processed / failed |
| `attempt_count` | integer | durable retry count |
| `available_at` | timestamp | retry scheduling |
| `processed_at` | timestamp nullable | consumer completion |
| `last_error` | text nullable | stable diagnostic |
| `created_at` / `updated_at` | timestamp | audit |

unique `(session_id, dedupe_key)`。domain mutationと同一transactionにできるeventは同時insertする。TaskRun / Review / Git等の別transaction境界はsource rowとdedupe keyからreconcile可能にし、publish成功だけをevent発生証拠にしない。

pre-Queue remediationはこのtableを必須としない。最初のeventはhealthy Queue handoffを読み取って作る`queue.entry_claimed`またはpost-Queue coordinatorのassociation eventとし、過去のpre-Queue step履歴をmigrationで擬似event化しない。

## 10. Canonical Context extension

前段`MissionPilotContext`へpost-Queue sectionを追加する。

```ts
type MissionPilotExecutionContext = {
  implementation: {
    currentCycle: number;
    latestAcceptedRunId: string | null;
    phaseRunIds: string[];
    changedPaths: string[];
    diffDigest: string | null;
    finalReportSummary: string | null;
    reworkPackets: MissionPilotReworkPacket[];
  };
  test: {
    currentCycle: number;
    verificationDocumentId: string | null;
    latestSnapshotId: string | null;
    latestVerdict: "pass" | "rework" | "attention" | null;
    requiredConditionSummary: {
      total: number;
      complete: number;
      failed: number;
      unknown: number;
    } | null;
    evidenceRefs: MissionPilotEvidenceRef[];
  };
  review: {
    currentCycle: number;
    latestDecisionId: string | null;
    latestVerdict: "pass" | "rework" | "attention" | null;
    targetManifestDigest: string | null;
    findingRefs: MissionPilotEvidenceRef[];
  };
  closeout: {
    closeoutId: string | null;
    status: string | null;
    commitSha: string | null;
    pushStatus: string | null;
  };
  lifecycle: {
    completedAt: string | null;
    archivedAt: string | null;
    archiveRecordId: string | null;
  };
};
```

### 10.1 Contextへ追加するもの

- phase / cycle / run identity。
- accepted implementation changed pathsとdiff digest。
- run final reportの構造化summary。
- managed verification evidence refs。
- frozen Test snapshot summary。
- structured Review verdictとfinding refs。
- aggregate closeout status / commit SHA。
- completion / Archive evidence refs。

### 10.2 Contextへ追加しないもの

- Task Chat本文。
- Implementation / Test / Reviewのprovider transcript。
- raw stdout / stderr全文。
- full diffの重複copy。
- Review final reportのfree-form全文。
- Git credential / remote secret。
- frontend local workflow state。

raw artifactは既存artifact store / event ledgerに置き、ContextはID、digest、必要な決定summaryだけを持つ。

### 10.3 Role projection

- `implementation`: Goal、Tech Stack、Feature Plan、acceptance criteria、最新Review/Test rework packet、最新owned path境界。
- `test`: Goal、Feature Plan、acceptance criteria、Verification Document、latest accepted implementation diff summary、repository root。
- `review`: Goal、Feature Plan、acceptance criteria、frozen Test snapshot、Mission target manifest、security policy。
- `completion`: Test pass、Review pass、aggregate closeoutだけを含むdeterministic gate projection。

全projectionは同じcanonical revision / digestを持つ。provider call開始後にContext revisionが変わったresponseは採用しない。

## 11. Typed domain events

本phaseで追加するevent schemaへ次を定義する。

```text
queue.entry_claimed
mission_pilot.phase_run_created
implementation.completed
implementation.completion_rejected
test_mode.preparation_started
test_mode.run_started
test_mode.evidence_recorded
test_mode.completion_evaluated
test_mode.snapshot_frozen
mission_pilot.rework_requested
review_mode.session_started
review_mode.target_frozen
review_mode.run_started
review_mode.decision_recorded
mission_pilot.evidence_invalidated
git_closeout.prepared
git_closeout.committed
git_closeout.push_skipped
git_closeout.pushed
task.completion_admitted
task.completed
task.archive_started
task.archived
task.archive_restored
mission_pilot.attention_required
```

event payloadは少なくとも`eventId`, `sessionId`, `taskId`, `phase`, `cycle`, `contextRevision`, `contextDigest`, `occurredAt`を持つ。

すべて本phaseの`mission_pilot_events` ledgerへappendする。TaskRun / Review / Git domain event adapterも、Mission eventのdedupe keyを作ってledgerへtransactionalまたはreconcilableに記録する。

TaskRunのgeneric eventをMission eventへ変換するadapterは、run IDを`mission_pilot_phase_runs`で照合する。Task title、message本文、final report文字列のregexでMission eventを作らない。

## 12. Queue claimからImplementation開始

このsectionはprerequisite handoff contractを満たすSession / Queue entryだけを入力として受け付ける。Queue entryがない、Taskがterminal、Queue前unexpected runがある、またはContext / Verification / review refsが欠ける場合はpost-Queue coordinatorで補修せず`attention`へ停止し、remediation境界のfailureとして扱う。

### 12.1 Association

Queue schedulerがMission Pilot Taskをclaimしたら、`startTaskRun()`前後にMission Pilot portを呼ぶ。

1. Task IDからactive Mission Pilot Sessionを取得する。
2. `desired_state === playing`とphase `queued|implementation_starting`を確認する。
3. latest Queue pass Context revisionをfreezeする。
4. `mission_pilot_steps`で`implementation:<cycle>:start`をclaimする。
5. existing schedulerからImplementation runを作る。
6. `mission_pilot_phase_runs`へrun relationをinsertする。
7. TaskRun `context_snapshot.missionPilot`へsession/revision/digest/cycleを記録する。
8. Session `active_phase_run_id` / phaseを更新する。

Queue lease conflictやrun作成失敗は既存Queue errorを維持し、Pilot Sessionを`attention`へ同期する。

### 12.2 Implementation prompt

Implementation roleへ次を渡す。

- Queue直前self-review pass済みFeature Plan。
- Goal / Tech Stack / initial Task prompt / acceptance criteria。
- Plan Artifact refs。
- repository root / safety policy。
- initial implementationならreworkなし。
- reworkならstructured rework packetだけを追加。

Chat transcript、Test/Review provider会話、古いfree-form assistant messageは渡さない。

## 13. Implementation completion gate

Implementation run terminal eventを受けたら、次を順に検査する。

1. phase relationがcurrent cycle / runと一致する。
2. run input Context digestがSessionの期待digestと一致する。
3. run statusが`completed`または明示的にaccept可能な`needs_review`である。
4. runtime terminal reasonがcancel / timeout / needs_humanでない。
5. Implementation Todoにpending / runningがない。
6. required DB migration gateがある場合は完了している。
7. Security Oracle gateがallow finalizeである。
8. Git ownership evidenceが作成されている。
9. `git.diff_collected`またはno-op evidenceがある。
10. run final report / summaryが保存されている。

pass時:

- phase runをcompletedにする。
- changed path、diff digest、ownership record、security gate refsをContextへ追加する。
- Task全体statusを`verifying`へ投影する。
- Session phaseを`test_preparing`へ進める。

fail時:

- Test Modeを開始しない。
- recoverableなtool failureならsame phase attemptをretryする。
- open Todo / migration / security / ownership不明なら`attention`にする。

generic runtime finalizerはMission Pilot active Taskに対し、run `completed`をTask `completed`へ直接copyしない。parent statusはMission Pilot lifecycle portが次のように返す。

| executionMode | run completed後のTask status |
| --- | --- |
| implementation | `verifying` |
| test | `needs_review`または`verifying` |
| review | `needs_review` |

Task `completed`はSection 23のcompletion admissionだけが設定できる。

## 14. Test Mode preparation

### 14.1 Verification Document

coordinatorはlatest Feature Plan message / artifact IDをContextから取得し、`ensureTestModeVerificationDocument()`相当のportを呼ぶ。

gate:

- Task ID / Project IDがSessionと一致する。
- source Feature Plan digestがlatest accepted Planと一致する。
- Verification Document schemaがvalid。
- required conditionが0件の場合、no-opとしてpassせず`attention`にする。ただし仕様が明示的にverification不要と構造化宣言している場合だけ`not_applicable` policyを使う。
- command planのcondition IDが存在する。

既存Verification Checklistはspec定義の正本として再利用する。実行cycleの結果は`mission_pilot_test_snapshots`へfreezeし、過去cycleのevidenceを破壊しない。

### 14.2 Test run start

`startTestModeRunFromArtifact()`へ次を渡す。

```ts
{
  mode: "test",
  action: "plan_and_implement_tests",
  rerun: true,
  verificationDocumentId,
  missionPilot: {
    sessionId,
    cycle,
    contextRevision,
    contextDigest
  }
}
```

同一cycleにactive Test runがあれば新規作成しない。terminal runをretryする場合だけattemptを増やす。

### 14.3 Test role responsibilities

Test roleは次を実施する。

1. `read_current_specification view=verification`。
2. repositoryのtest framework / conventionsを確認する。
3. required acceptance conditionと既存test coverageをmappingする。
4. 不足testを追加・修正する。
5. focused managed `run_check`を実行する。
6. repository representative gateをmanaged `run_check`で実行する。
7. `completion_check`を実行する。
8. failed / unknown required conditionが0になるまでtest-owned defectを修正する。
9. structured Test resultを返す。

Test roleはruntime Todoを作らない。UIの3-step workflowはmanaged event projectionであり、Todo tableの代替ではない。

## 15. Test completion gate

Test runのterminal statusだけでpassしない。backend gateが次をDBから確認する。

1. exact Test phase runがterminal `completed`。
2. exact Verification Document IDを使用した。
3. 少なくとも1件のmanaged verification evidence runがある。
4. projectにrepresentative `verify`がある場合、そのmanaged evidenceがpassしている。
5. verifyがない場合、document command planのrequired command setがpassしている。
6. raw stdout / stderr artifact IDが存在する。
7. exit codeが0。
8. `completion_check` eventがexact Test runにある。
9. completion result `ok === true`。
10. failed required countが0。
11. unknown required countが0。
12. all required checklist itemがcomplete status。
13. evidenceのContext digestがtested implementation digestと一致する。
14. Test run終了後にowned source pathが変化していない。

pass時、`mission_pilot_test_snapshots`を作成し、Context revisionへsnapshot refを追加する。

raw `command_execution`:

- UIへdiagnostic表示してよい。
- focused investigation evidenceとして保持してよい。
- `verification_evidence_runs`とmanaged tool eventがない限りcompletion countへ入れない。
- `buildTestModeWorkflowSteps()`のformal pass判定から除外する。

## 16. Test failure classificationとrework

Test runがpassしない場合、Test-role structured resultを次schemaで要求する。

```ts
type MissionPilotTestDecision = {
  verdict: "pass" | "rework" | "attention";
  defectOwner: "test" | "implementation" | "environment" | "unknown";
  failedConditionIds: string[];
  evidenceRunIds: string[];
  affectedPaths: string[];
  summary: string;
  implementationRework: {
    objective: string;
    acceptanceCriteria: string[];
    evidenceRefs: MissionPilotEvidenceRef[];
  } | null;
};
```

分類をtest名やerror本文のkeywordで決めない。schema、LLM判断、actual changed paths、managed evidenceを使う。

route:

- `defectOwner=test`: 同じTest cycle内でtest-owned fileを修正しattemptを増やす。
- `defectOwner=implementation`: rework packetをContextへ追加しImplementation cycleを増やす。
- `defectOwner=environment`: retryable infrastructureならbackoff、継続不能ならattention。
- `defectOwner=unknown`: contextStill `context_decision`へ問い合わせる。

Implementation reworkへ戻る時点でlatest Test snapshotとReview decisionをinvalidateする。rework後は必ず新Test runを作り、古いpassを再利用しない。

## 17. Review Mode preparation

Test pass後にcoordinatorが次を行う。

1. latest frozen Test snapshotを確認する。
2. Mission-wide Review target manifestを構築する。
3. Review recommendationを作成する。
4. exact reviewed anchorとしてlatest accepted Implementation runを選ぶ。
5. existing Review Sessionを作成する。
6. `review_status`, `review_targets` artifactを保存する。
7. Mission Pilot固定optionでReview Runを開始する。

Pilot options:

```ts
{
  codeReview: true,
  securityReview: true,
  applyFixes: false,
  commitChanges: false
}
```

`securityReview: true`はbaseline security reviewを意味する。optional vulnWorkbench integrationが未設定なら、その部分だけ`skipped_optional` evidenceを残す。project policyでrequiredなら`attention`にする。

existing `review_sessions.run_id`と`review_artifacts.run_id`にはcompatibility anchorとしてlatest accepted Implementation run IDを保存する。Test runをUI上のlatest runだからという理由でanchorにしない。Mission全体のsource run IDs、Test snapshot ID、target manifest digestはReview artifact / Mission Pilot decisionへ明示保存する。

## 18. Mission-wide Review target

`buildMissionPilotReviewTarget(sessionId, reviewCycle)`を`api/modules/missionPilot`に実装し、既存`buildReviewTarget()`のpath normalization / diff read helperを再利用する。

source:

1. first implementation runのbaseline HEAD / dirty snapshot。
2. Session配下implementation / test / rework phase runの`git.diff_collected` events。
3. 各`task_run_commit_records.stageable_owned_paths_json`。
4. Test snapshotのtest changed paths。
5. latest current git status / diff。
6. pre-existing dirty paths / excluded paths。

manifest:

```ts
type MissionPilotReviewTargetManifest = {
  sessionId: string;
  reviewCycle: number;
  baselineHead: string;
  contextRevision: number;
  contextDigest: string;
  sourcePhaseRunIds: string[];
  targetFiles: Array<{
    path: string;
    status: string;
    sources: string[];
    eventIds: string[];
    ownershipRecordIds: string[];
    diffDigest: string;
  }>;
  excludedFiles: Array<{ path: string; reason: string }>;
  warnings: MissionPilotReviewTargetWarning[];
  digest: string;
};
```

target file limit超過、Git diff読取失敗、ownership矛盾、HEAD moveはblocking preparation errorとする。run eventにあるがcurrent diffにないpathはcommitted/removedの可能性をGit historyで解決し、単純に無視しない。

## 19. Review Run contractとcompletion gate

### 19.1 Review responsibilities

Review roleは次を一通り確認する。

1. Feature Plan / acceptance criteriaとの一致。
2. target diffの機能的correctness。
3. regression / edge case / error handling。
4. module boundary /責務分離 /既存規約。
5. schema / migration / backward compatibility。
6. concurrency / retry / idempotency。
7. security / data exposure / command boundary。
8. frozen Test evidenceが対象Contextを検証していること。
9. unrelated dirty fileがtargetに混入していないこと。
10. completion / Archiveを妨げるfindingの有無。

ReviewはTestを再実装・再実行してTest passを作り直さない。Test evidenceが不足していればblocking findingとしてImplementation/Test loopへ戻す。

### 19.2 Structured output

```ts
type MissionPilotReviewDecisionPayload = {
  version: 1;
  verdict: "pass" | "rework" | "attention";
  summary: string;
  reviewedContextRevision: number;
  reviewedContextDigest: string;
  testSnapshotId: string;
  targetManifestDigest: string;
  findings: Array<{
    severity: "blocking" | "warning" | "info";
    category:
      | "correctness"
      | "regression"
      | "architecture"
      | "test_gap"
      | "security"
      | "migration"
      | "operations";
    title: string;
    body: string;
    path: string | null;
    line: number | null;
    evidenceRefs: MissionPilotEvidenceRef[];
    recommendedAction: string;
  }>;
  residualRisks: string[];
};
```

free-form final reportは表示用に残せるが、coordinatorはこのpayloadだけを判定する。JSON parse失敗時にfree-form line regexへfallbackしてpassさせない。本文はartifactへ保存し、decisionは`attention`またはschema retryにする。

### 19.3 Gate

pass条件:

- Review TaskRun completed。
- structured payload valid。
- reviewed Context revision / digestがcurrentと一致。
- Test snapshot IDがcurrent latestと一致。
- target manifest digestがcurrentと一致。
- blocking finding countが0。
- Review Session required sectionがdone。
- security required policyが満たされる。
- Review Sessionが`approved` / completedAtありへ更新される。
- Review artifact statusだけでなくdecision rowが`pass`。

`review.run_completed`と`review.decision_recorded`を別eventにする。

## 20. Review rework loop

blocking findingがある場合:

1. findingをexisting `review_findings`へ保存する。
2. `MissionPilotReviewDecision.verdict = rework`を保存する。
3. Review Sessionを`changes_requested`で閉じる。
4. blocking findingをstructured rework packetへ変換する。
5. Context revisionへpacketとfinding refsを追加する。
6. current Test snapshot / Review pass refsをinvalidateする。
7. Implementation cycleを増やす。
8. fresh Implementation rework runを開始する。
9. completion後にfresh Test Modeを実行する。
10. Test pass後にfresh Review Session / Review Runを実行する。

Review role自身へ`applyFixes=true`を与えない。Review修正後にTestを飛ばしてcommitする経路を禁止する。

warning / info finding:

- Contextにrefとresidual risk summaryを残す。
- project policyが許せばpass可能。
- 後続Project Evaluation / task proposalのcandidateにできる。
- candidate生成の失敗はcurrent Task Archiveを妨げない。

## 21. Aggregate Git closeout

### 21.1 Preparation

Review pass後、`prepareMissionPilotCloseout(sessionId)`がrepository-level lock内で次を行う。

1. exact latest Review decisionがpass。
2. reviewed Context digestがSession latestと一致。
3. latest Test snapshotがpass。
4. all implementation/test phase runsがterminal。
5. first implementation baseline HEADを取得。
6. phase run commit ownership recordsを収集。
7. owned pathsのunionを作る。
8. pre-existing dirty / excluded pathを差し引く。
9. current dirty pathsと照合する。
10. current staged pathsが空であることを確認する。
11. current HEADがbaselineまたは既知Mission commit状態と一致する。
12. target manifest pathsとowned pathsが矛盾しない。
13. aggregate closeout rowを`ready`で保存する。

複数runで同じpathを変更していてもpathは1回だけstageする。あるrunでowned、別runでexcludedとなる矛盾は自動解決せず`attention`にする。

### 21.2 no-op

stageable pathが0件でも、次を満たす場合はno-op closeoutとして`skipped`にできる。

- Implementation completion evidenceがexplicit no-op。
- Test / Review pass。
- baselineからHEAD / worktree contentにMission-owned changeがない。
- Task目的が調査・確認でコード変更不要とPlanに明記される。

通常の実装Taskでownership取得失敗により0件になった場合はno-opとして扱わない。

## 22. Commit / Push policy

### 22.1 Local commit

`commitMissionPilotCloseout(closeoutId)`:

1. repository lockを再取得する。
2. closeout status `ready`をCASする。
3. latest Review / Context digestを再確認する。
4. HEAD / staged / owned pathsを再確認する。
5. owned pathsだけ`git add -- <paths>`する。
6. staged path setがallowed setと完全一致することを確認する。
7. LLMまたはfallbackでcommit messageを作る。
8. `git commit`する。
9. new HEAD SHAを保存する。
10. post-commit status / diffを確認する。

pre-commit / commit-msg hook失敗:

- staged pathsを勝手にresetしない。
- closeout statusをfailed / needs_humanへする。
- TaskをArchiveしない。

hookがsourceを変更した場合:

- commit前のstaged tree digestとcommit tree digest、commit後worktreeを比較する。
- commitが成功していてもmutation paths / new HEADを記録する。
- current Test / Review decisionをinvalidateする。
- commitへ含まれたhook mutationはcommitted stateを対象にfresh Test / Reviewを実行する。
- commit後にdirty changeが残った場合はfresh Test / Review後にcloseout attemptを増やして追加commitする。
- committed stateのfresh Review passが得られ、追加mutationがないことを確認してからcompletionへ進む。
- local historyを自動rewrite / amendしない。

### 22.2 Push

| policy | behavior | Archive gate |
| --- | --- | --- |
| never | pushしない、`skipped_not_authorized` | local commitで可 |
| allowed | upstreamあり・safety policy許可ならpush、失敗はattentionにせず記録してlocal完了可 | local commitで可 |
| required | push必須 | pushedのみ可 |

`allowed`で認証失敗した場合はpush failureを明示し、Taskはlocal completionとしてArchive可能にする。`required`ならTaskを`attention`にしてArchiveしない。

## 23. Task completion admission

`completeMissionPilotTask(sessionId)`は次をすべてtransaction直前に再評価する。

1. Session desired stateがplaying。
2. phaseがcompleting。
3. latest Context revisionが変わっていない。
4. latest Test snapshot verdict pass。
5. latest Review decision verdict pass。
6. Review decisionがlatest Test snapshotを参照。
7. Review decisionがlatest target manifestを参照。
8. closeoutがcommitted / skipped_noop / required push済み。
9. active TaskRunがない。
10. open Queue processor leaseがない。
11. Taskがcancelled / failed / needs_humanでない。

transaction:

1. Task statusを`completed`へ更新する。
2. `tasks.completed_at`を設定する。
3. Session phaseを`completed`へ更新する。
4. Session `completed_at`を設定する。
5. `task.completed` outbox eventを作る。
6. Contextへcompletion evidenceを追加する。

Task `completed`は正常な成果の終端判定であり、まだArchive historyへの移動は完了していない。

## 24. True Task Archive

### 24.1 Archive admission

`archiveCompletedMissionPilotTask(sessionId)`は次を要求する。

- Task status `completed`。
- `completed_at`あり。
- Mission Pilot Session phase `completed|archiving`。
- Test pass / Review pass / closeout evidenceあり。
- active TaskRunなし。
- active Queue claimなし。
- active archive recordなし。

### 24.2 Archive transaction

1. Session phaseを`archiving`へCASする。
2. `task_archive_records`をinsertする。
3. Task statusを`archived`へ更新する。
4. `tasks.archived_at`を設定する。
5. relevant Implementation Queue entryを`execution_archived`へ更新する。
6. Queue `archived_at`を設定する。
7. Review Session / artifactsがterminalであることを再確認する。
8. Session phaseを`archived`へ更新する。
9. Session desired stateを`stopped`へ更新する。
10. Session `archived_at`を設定する。
11. canonical Contextへarchive record refを追加する。
12. `task.archived` outbox eventを作る。

同一DB transactionで更新できるtableはまとめる。outbox consumer publish失敗はtransaction済みrowから再送する。

### 24.3 Archive UI semantics

- active / queue / processing listから`archived`を除外する。
- Archive groupは`status === archived`を正本にする。
- `failed` / `cancelled`をArchive成功扱いしない。
- completedはArchive step待ちとして短時間processing/completed表示できるが、24時間経過だけでArchive groupへ移さない。
- normal Taskを自動整理する場合も、将来のretention jobがtrue Archive serviceを呼んで`archived`へ遷移させる。
- Mission Pilot rowのgreen Glowはarchived時に解除する。
- Review StatusのbuttonはMission Pilot active中はbackend gate結果を表示し、gate bypassの単純status patchをしない。

### 24.4 Restore / Reopen

Restore:

1. active archive recordを取得する。
2. Task statusをrecord `previous_status`へ戻す。
3. `archived_at`をnullにする。
4. record `restored_at`, `restored_to_status`, `restored_by`を設定する。
5. Session phaseは`completed`、desired stateは`stopped`に戻す。
6. Queue executionを自動再開しない。

Reopen:

- separate commandでTaskを`ready`またはnew Mission Pilot cycleへ移す。
- new authorization / Context revision / baselineを作る。
- old Test / Review / closeout evidenceを再利用しない。

## 25. Pause / Resume / Restart recovery

### 25.1 Stop

Stop時:

1. Session desired stateをstoppedへ更新する。
2. phase resume pointerを保存する。
   - `resume_phase`へcurrent phaseを保存してから`phase=paused`へ移す。
3. 未開始stepをclaim禁止にする。
4. active TaskRunがあればexisting `stopTaskRun()`を呼ぶ。
5. running external call responseはdesired state / Context digest再確認後にdiscardまたはevidence-only保存する。
6. Taskをcancelled / archivedにしない。

### 25.2 Play

Play時:

1. authorization versionを確認する。
2. desired stateをplayingへ更新する。
3. current phaseをreconcileする。
   - `resume_phase`、active phase run、closeout / archive rowを照合し、単なる文字列復元で再開しない。
4. DB上完了済みのstepをskipする。
5. active run / commit / archive recordを照合する。
6. missing next stepだけscheduleする。

### 25.3 Recovery scan

startup schedulerは次をscanする。

- playingかつexpired lease。
- active phase runがterminalだがevaluation未実施。
- Test snapshot作成前のcompleted Test run。
- Review decision作成前のcompleted Review run。
- closeout status committing / pushingでprocess死。
- Task completedだがSession archivedでない。
- Task archivedだがQueue entry / Sessionが未同期。

Git commandの再実行前にHEAD / commit SHA / remote stateを照合する。response lossで同じcommitを二重作成しない。

## 26. UI projection

Mission Pilotの自動進行に新しい操作stepを増やさない。

既存Task row:

- playing中はgreen design token / Glow。
- phase labelをImplementing / Testing / Reviewing / Committing / Archivingへ投影。
- Stop / Playは全phaseで同じcommand。

Composer上部gap:

- Play / Stop。
- current phase。
- attention reasonがある場合だけ短い状態表示。

Test Mode artifact:

- current/frozen Test cycle。
- managed check結果。
- completion condition status。
- Mission Pilot中は「Review Modeへ進む」linkを自動進行の必須操作にしない。

Review Status artifact:

- Review Run progress / structured findings。
- correction cycle。
- closeout state / commit SHA。
- archived state。
- manual controlsは通常Task用に残す。
- Mission Pilot playing中のmanual Run / Commit / Archiveはduplicateを起こさないようbackend idempotent commandへ収束させるかdisabledにする。

## 27. Failure / attention matrix

| failure | automatic action | terminal behavior |
| --- | --- | --- |
| Queue lease conflict | existing recovery | retry / attention |
| Implementation run failed | bounded retry | attention |
| open Todo | no Test start | attention |
| Security gate blocked | no Test start | implementation rework / attention |
| Verification Document invalid | regenerate once | attention |
| Test-owned test failure | Test retry | limitでattention |
| implementation defect | Implementation rework | cycle limitでattention |
| environment failure | backoff retry | attention |
| completion_check incomplete | no Review start | Test/rework |
| Review target ownership conflict | no Review run | attention |
| Review JSON invalid | same Review attempt retry | attention |
| Review blocking finding | Implementation rework | cycle limitでattention |
| optional security integration missing | warning evidence | continue |
| required security integration missing | no pass | attention |
| HEAD moved | no commit | attention |
| unrelated staged path | no commit | attention |
| owned path missing | reconcile once | attention |
| commit failed | no completion | attention |
| commit hook mutation | invalidate pass | Test/Review rerun |
| optional push failed | record failure | continue local closeout |
| required push failed | no Archive | attention |
| completion transaction conflict | reload / retry | attention after limit |
| Archive response lost | row reconciliation | exactly-once recover |

attention時もChat本文をContextへ追加しない。ユーザーがChatへ入力した場合は通常Chatとして表示し、Pilot coordinatorはtyped resume / policy update commandだけを参照する。

## 28. API / command contract

新規または拡張:

```text
GET  /api/mission-pilot/tasks/:taskId/session
POST /api/mission-pilot/tasks/:taskId/play
POST /api/mission-pilot/tasks/:taskId/stop
GET  /api/mission-pilot/sessions/:id/execution
POST /api/mission-pilot/sessions/:id/reconcile
GET  /api/mission-pilot/sessions/:id/test-snapshot
GET  /api/mission-pilot/sessions/:id/review-decision
GET  /api/mission-pilot/sessions/:id/closeout
POST /api/tasks/:taskId/archive
POST /api/tasks/:taskId/archive/restore
POST /api/tasks/:taskId/reopen
```

内部ports:

```ts
interface MissionPilotRunPort {
  startImplementation(input: MissionPilotRunInput): Promise<TaskRunRef>;
  startTest(input: MissionPilotTestRunInput): Promise<TaskRunRef>;
  startReview(input: MissionPilotReviewRunInput): Promise<TaskRunRef>;
  stop(runId: string): Promise<void>;
}

interface MissionPilotVerificationPort {
  ensureDocument(input: VerificationDocumentInput): Promise<VerificationDocumentRef>;
  evaluateCompletion(input: TestCompletionInput): Promise<TestCompletionResult>;
}

interface MissionPilotReviewPort {
  createSession(input: MissionReviewInput): Promise<ReviewSessionRef>;
  startRun(input: MissionReviewRunInput): Promise<TaskRunRef>;
  readStructuredDecision(runId: string): Promise<MissionPilotReviewDecisionPayload>;
}

interface MissionPilotCloseoutPort {
  prepare(sessionId: string): Promise<MissionPilotCloseout>;
  commit(closeoutId: string): Promise<MissionPilotCloseout>;
  push(closeoutId: string): Promise<MissionPilotCloseout>;
}
```

API handlerはstate machineを再実装せずapplication serviceへ委譲する。

## 29. 実装ファイル計画

`api/modules/missionPilot`:

- `mission-pilot-post-queue-coordinator.service.ts`
- `mission-pilot-run-association.service.ts`
- `mission-pilot-implementation-gate.service.ts`
- `mission-pilot-test.service.ts`
- `mission-pilot-test-gate.service.ts`
- `mission-pilot-rework.service.ts`
- `mission-pilot-review.service.ts`
- `mission-pilot-review-target.service.ts`
- `mission-pilot-review-gate.service.ts`
- `mission-pilot-closeout.service.ts`
- `mission-pilot-completion.service.ts`
- `mission-pilot-archive.service.ts`
- `mission-pilot-recovery.service.ts`
- `mission-pilot-post-queue-events.ts`
- `mission-pilot-event.repository.ts`
- `ports/mission-pilot-run.port.ts`
- `ports/mission-pilot-verification.port.ts`
- `ports/mission-pilot-review.port.ts`
- `ports/mission-pilot-closeout.port.ts`

`src/modules/missionPilot`:

- session execution projection hook。
- Test / Review / closeout summary adapters。
- existing Task row / Composer controls integration。
- Mission Pilot active時のduplicate manual action guard。

shared:

- `shared/schemas/mission-pilot-execution.schema.ts`
- `shared/schemas/mission-pilot-test.schema.ts`
- `shared/schemas/mission-pilot-review.schema.ts`
- `shared/schemas/mission-pilot-closeout.schema.ts`
- `shared/schemas/task-archive.schema.ts`
- `shared/schemas/mission-pilot-event.schema.ts`。
- existing mission-pilot context schema extension。

DB:

- `api/db/mission-pilot-schema.ts` extension。
- `api/db/mission-pilot-event-schema.ts`。
- `api/db/task-archive-schema.ts`。
- bootstrap registration。
- formal Drizzle migration。

integration changes:

- Queue claim port。
- runtime finalization parent status port。
- Test Mode runtime options / structured final judgment。
- Review Run structured final judgment / session closeout。
- aggregate Git helper extraction。
- Task status schema / selectors / route。
- Review Status / Artifact Pane projection。
- scheduler startup / graceful shutdown。

## 30. 実装フェーズ

### Phase 1: Schema / lifecycle foundation

1. shared execution / test / review / closeout / archive / event schemaを追加する。
2. Mission Pilot phase enumを拡張する。
3. `mission_pilot_events` ledgerとdedupe / process status repositoryを追加する。
4. phase run、test snapshot、review decision、closeout、archive record tableを追加する。
5. Task `archived`, `completed_at`, `archived_at` migrationを追加する。
6. current cancelled-as-archive semanticsをfeature flag下で分離する。
7. repository / service / transaction helperを追加する。

完了gate:

- fresh DB / existing DB migration成功。
- duplicate event / response lossをdedupeできる。
- archived / cancelled / failedが区別される。
- old queue rowsを破壊しない。

### Phase 2: Queue / Implementation continuation

1. prerequisite handoff contractをpreflightで検証する。
2. Queue claimへMission Pilot portを接続する。
3. phase run relationを作る。
4. Implementation Context projectionを接続する。
5. parent Task status projectionをexecution mode別に分ける。
6. implementation completion gateを実装する。
7. Context revision appendを実装する。

完了gate:

- Queueからexisting schedulerでImplementationが始まる。
- Queue前failureをbackfill / rollbackせずattentionへ停止する。
- implementation run completedだけでTask completedにならない。
- open Todo / security failureでTestが始まらない。

### Phase 3: Test Mode autonomy

1. Verification Document preparation portを実装する。
2. Test Mode自動開始を実装する。
3. Mission Pilot Test Context projectionを接続する。
4. managed evidence only gateを実装する。
5. frozen Test snapshotを実装する。
6. Test decision / defect owner schemaを実装する。
7. Test defect retry / Implementation reworkを実装する。
8. UI progressをbackend gateへ合わせる。

完了gate:

- separate Test run / no Todos。
- test実装、managed check、completion checkが自動完了。
- raw commandだけではpassしない。
- implementation defectがreworkへ戻る。

### Phase 4: Review Mode autonomy

1. Mission-wide target manifestを実装する。
2. Review Session / Review Run自動開始を実装する。
3. Pilot固定Review optionsを実装する。
4. structured Review resultをruntime final judgmentへ接続する。
5. Review Session terminal更新を実装する。
6. pass gateを実装する。
7. blocking finding rework loopを実装する。
8. warning / info candidate outputを非blockingに実装する。

完了gate:

- Mission全run差分がreview targetになる。
- unrelated dirty fileが除外される。
- Review artifact doneだけではpassしない。
- finding修正後に必ずTest / Reviewを再実行する。

### Phase 5: Aggregate Git closeout

1. run ownership aggregationを実装する。
2. Session closeout recordを実装する。
3. exact Review/Test gateを接続する。
4. safe local commitを実装する。
5. hook mutation invalidationを実装する。
6. push policyを実装する。
7. response loss recoveryを実装する。

完了gate:

- implementation + test変更が1つの安全なcommitになる。
- unrelated dirty / staged fileを巻き込まない。
- push未承認でpushしない。

### Phase 6: Task completion / true Archive

1. completion admission serviceを実装する。
2. Task completed eventを実装する。
3. true Archive transactionを実装する。
4. Queue / Session / Task整合を実装する。
5. Archive / failed / cancelled groupingを修正する。
6. Restore / Reopenを分離する。
7. Review Status manual bypassを除去する。

完了gate:

- final Task status archived。
- archive record / timestamp / evidenceあり。
- cancelledではない。
- Restoreが実行を勝手に再開しない。

### Phase 7: Recovery / E2E / regression

1. phaseごとのprocess kill/restart testを追加する。
2. duplicate event / stale response testを追加する。
3. full Mission Pilot E2Eを追加する。
4. manual Test / Review / Git / Archive regressionを追加する。
5. Role Router別model Context continuity evidenceを確認する。
6. internal module boundaryを検査する。
7. docs / READMEの利用説明を最終実装へ合わせる。

full Mission Pilot E2EはTask生成からArchiveまで通すが、本phaseの実装変更としてpre-Queue codeを修正しない。pre-Queue failureが再発した場合はprerequisite remediationの回帰として切り分け、本phaseへ修正scopeを移さない。

## 31. Test plan

### 31.1 State machine

- queued -> implementing -> testing -> reviewing -> committing -> completed -> archived。
- duplicate completion eventで次runを2つ作らない。
- stale Context responseを採用しない。
- Stopでnext stepを開始しない。
- Playでcurrent phaseから再開する。
- correction countがrestart後も維持される。
- limit超過でattention。

### 31.2 Implementation gate

- open TodoでTest禁止。
- migration gate incompleteでTest禁止。
- security gate failでTest禁止。
- no-op evidenceありでpass。
- ownership missingでattention。
- parent Task statusがverifyingになる。

### 31.3 Test Mode

- separate Test runを作る。
- implementation runtime resumeを使わない。
- Todo rowを作らない。
- exact Verification Documentを使う。
- test fileを追加できる。
- managed focused checkを記録する。
- representative verifyを記録する。
- completion_check passでsnapshot作成。
- raw commandだけではsnapshotを作らない。
- failed required / unknown requiredでReview禁止。
- Test snapshotをReview移行後も保持する。

### 31.4 Test rework

- test defectはsame Test cycle retry。
- implementation defectはnew Implementation cycle。
- environment retry / attention。
- unknownはcontextStill decision。
- old Test / Review pass invalidate。

### 31.5 Review

- all Mission-owned pathsをtargetに含める。
- pre-existing dirty / unrelated pathを除外する。
- target limitでattention。
- structured Review JSONのみをgateに使う。
- blocking finding付きpassをrejectする。
- Review Session approved / changes_requestedを閉じる。
- security optional missingはwarning。
- security required missingはattention。
- Review roleがfile edit / commitしない。

### 31.6 Review rework

- blocking findingをrework packetへ変換する。
- Implementation -> Test -> Review順を再実行する。
- Testを飛ばしてcloseoutしない。
- nonblocking findingでArchive可能。
- max cycleでattention。

### 31.7 Closeout

- 複数run ownershipをunionする。
- duplicate pathを1回だけstageする。
- excluded pathをstageしない。
- staged pathありでblock。
- HEAD movedでblock。
- commit成功でSHA保存。
- commit response lossをHEADからreconcileする。
- hook mutationでTest/Review invalidate。
- no-op closeout条件を検証する。
- default policyでpushしない。
- required push failureでArchive禁止。

### 31.8 Archive

- Task completed前にArchive禁止。
- Test / Review / closeout欠落でArchive禁止。
- Task status archived / archivedAt設定。
- archive record作成。
- Queue entry execution_archived。
- Session archived / stopped。
- duplicate archive requestが1recordへ収束。
- completed途中restartからArchive再開。
- cancelled / failedを成功Archiveと表示しない。
- Restoreはprevious completedへ戻る。
- Reopenだけがreadyへ進める。

### 31.9 Regression

- normal Task queue / implementation。
- manual Test Mode。
- manual Review Run options。
- manual Git closeout。
- manual Task Archive / Restore。
- normal completed 24h groupingのmigration policy。
- Task generation / Plan Mode / Questionnaire。
- theme / sidebar / Composer。

## 32. End-to-end scenarios

### 32.1 Happy path

1. Mission Pilot TaskをPlayする。
2. Plan / Questionnaire / Artifact / Queueが前段計画通り完了する。
3. Queue schedulerがImplementation runを開始する。
4. implementationがsourceを変更し完了する。
5. Test Modeが自動開始する。
6. Test roleが不足unit/integration testを追加する。
7. managed focused testがpassする。
8. managed verifyがpassする。
9. completion_checkが全required conditionをcompleteにする。
10. Test snapshotがfreezeされる。
11. Review Session / Review Runが自動開始する。
12. code / acceptance / security reviewがpassする。
13. aggregate closeoutがimplementation + test pathをstageする。
14. local commitが作られる。
15. default push policyによりpushをskipする。
16. Taskがcompletedになる。
17. Taskがarchivedになる。
18. Queue entryがexecution_archivedになる。
19. SidebarのArchive groupへ移る。
20. Session desired stateがstoppedになる。

### 32.2 Test finds implementation defect

1. initial Implementation完了。
2. Test runでrequired condition failure。
3. structured ownerがimplementation。
4. rework packet作成。
5. second Implementation runが修正。
6. second Test runがpass。
7. Review runがpass。
8. closeout / Archive。

### 32.3 Review finds blocking issue

1. Test pass。
2. Reviewがblocking correctness findingを返す。
3. Review Session changes_requested。
4. Implementation rework run。
5. fresh Test run。
6. fresh Review run pass。
7. closeout / Archive。

### 32.4 Restart matrix

- Implementation completion event後。
- Test run作成直後。
- completion_check後、snapshot前。
- Review Run完了後、decision保存前。
- commit成功後、DB response前。
- Task completed後、Archive前。
- Task archived後、Queue sync前。

各地点でprocessをkillし、restart後にrun / commit / archive recordが重複しないことを確認する。

## 33. Migration / backfill

1. Task status enum/schemaへ`archived`を追加する。
2. `completed_at`, `archived_at`をnullable追加する。
3. new Mission Pilot tablesを追加する。
4. existing `cancelled` Taskを一律`archived`へ変換しない。
5. backfillはevidence-basedに限定する。

既存Task backfill rule:

- `cancelled` + explicit archive event / manual archive provenanceあり: `archived`候補。
- `cancelled` + runtime cancellation: cancelledのまま。
- `failed`: failedのまま。
- `completed`: completed_atをupdatedAtから暫定backfillできるが、archiveはしない。

判別evidenceがない`cancelled`は自動変換せず、migration reportへ`ambiguous`として出す。

既存Review Session / artifactは新Mission Pilot decision rowへ自動pass backfillしない。structured verdictがないため、必要なら再Reviewする。

## 34. Observability / audit

logs / metrics:

- session ID / task ID / phase / cycle。
- Context revision / digest。
- role / provider endpoint / model。
- phase run IDs。
- Test required complete / failed / unknown count。
- Review verdict / finding count / target digest。
- closeout owned / excluded path count。
- commit / push / Archive status。
- recovery action / dedupe reason。

metrics:

- queue-to-implementation latency。
- implementation-to-test latency。
- test duration / retry count。
- review duration / rework count。
- closeout duration。
- completion-to-archive latency。
- attention rate by stable code。
- restart recovery success。

raw Chat contentをlog / metric labelへ入れない。

## 35. Security / safety

- repository rootはregistered Project localPath / task worktreeを使う。
- temporary directoryを実workspaceや完成evidenceにしない。
- Test / Review roleへallowed path / blocked command policyを渡す。
- aggregate closeoutはrepo root外pathを拒否する。
- symlink / path traversalをnormalizationで拒否する。
- secret / credential fileをContextへ含めない。
- pushはfrozen explicit policyとsafety policyの両方を要求する。
- security reviewのLLM concernとscanner-confirmed findingを区別する。
- accepted riskはevidence / noteなしでpassさせない。

## 36. Verification commands

```bash
bun run test run tests/mission-pilot-post-queue-state.test.ts
bun run test run tests/mission-pilot-implementation-gate.test.ts
bun run test run tests/mission-pilot-test-mode.test.ts
bun run test run tests/mission-pilot-test-rework.test.ts
bun run test run tests/mission-pilot-review-target.test.ts
bun run test run tests/mission-pilot-review-gate.test.ts
bun run test run tests/mission-pilot-closeout.test.ts
bun run test run tests/task-archive-lifecycle.test.ts
bun run test run tests/mission-pilot-post-queue-recovery.test.ts
bun run test run tests/mission-pilot-manual-workflow-regression.test.ts
bun run typecheck
bun run check:docs
bun run verify:base
bun run test:e2e -- tests/e2e/mission-pilot-through-archive.spec.ts
git diff --check
```

上記の新規test fileは対応phaseで追加する。実装時は`package.json`と`scripts/verify.mjs`の最新gateを再確認する。代表verifyがformat / typecheck / lint / testを含む場合は、closeout evidenceとして重複実行しない。

## 37. Rollout strategy

1. schema / read-only projectionを先にdeployする。
2. `missionPilotPostQueueEnabled` feature flagを追加する。
3. shadow modeでcompletion gate判定を記録し、自動遷移しない。
4. fixture ProjectでImplementation -> Testまで有効化する。
5. Review automationを有効化する。
6. aggregate local commitを有効化する。
7. Task true Archiveを有効化する。
8. manual workflow regressionを確認後default onにする。

途中phaseを「MVP全体完成」と表現しない。Task `archived`までのE2E evidenceが揃った時点だけ、このphase completeとする。

## 38. Risks and mitigations

| risk | mitigation |
| --- | --- |
| generic runtimeがTask completedを先に設定 | parent status resolverを導入 |
| Test passがraw commandで偽陽性 | managed evidence DBのみgate |
| Review doneをpassと誤認 | immutable structured decision row |
| multi-run diff取りこぼし | phase run relation + ownership union |
| unrelated dirty file commit | baseline / excluded / exact staged set |
| Reviewが修正してTestを飛ばす | applyFixes=false固定、reworkはImplementationへ |
| correction loop無限 | durable phase / total cap |
| commit hookでreview後mutation | digest invalidate + Test/Review rerun |
| Archiveがcancelledと混在 | explicit archived status / record |
| response lossで二重commit | HEAD / SHA reconciliation |
| process restartでphase断絶 | durable steps / recovery scan |
| Context肥大化 | refs / digest / structured summaries、Chat除外 |
| push権限の過剰解釈 | default never、project explicit policy |

## 39. Definition of Done

1. Queue投入後も同じMission Pilot Session / Context chainが継続する。
2. Implementation roleがQueue pass Contextを受け取る。
3. Implementation completion gateがopen work / security / ownershipを検査する。
4. separate Test Modeが自動開始する。
5. Test ModeがTodoなし、fresh sessionで動く。
6. Test roleが必要testを実装する。
7. managed checkとcompletion_check evidenceが保存される。
8. raw commandだけではpassしない。
9. required conditionがすべてcompleteになる。
10. frozen Test snapshotが作られる。
11. implementation defectがImplementationへ戻る。
12. separate Review Session / Review Runが自動開始する。
13. Mission全runの差分がreview targetになる。
14. structured Review verdict / findingsが保存される。
15. blocking findingがImplementation -> Test -> Review loopへ戻る。
16. Review roleが直接修正 / commitしない。
17. latest Test pass / Review passだけがcloseout gateになる。
18. Mission全run ownershipがaggregate closeoutへ入る。
19. unrelated dirty / staged fileをcommitしない。
20. local commit SHAが保存される。
21. defaultでpushしない。
22. Task completedが全gate後にだけ設定される。
23. Task archivedがcompleted後にだけ設定される。
24. cancelled / failed / archivedが区別される。
25. archive record / archivedAt / Queue archive / Session archiveが整合する。
26. RestoreとReopenが分離する。
27. Stop / Play / restartで重複run / commit / archiveを作らない。
28. normal Task manual workflowsに回帰がない。
29. migration、focused tests、typecheck、docs、verify、E2Eが成功する。
30. 実装後に本書のstatus、実装commit、verification evidenceを更新する。

## 40. 前後phaseとの接続

completed baselineは`spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`である。その実装後に確認されたpre-Queue handoff不整合は`spec/docs/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`が所有する。

remediation planのQueue handoff acceptanceが成功し、active Queue entryとlatest pass Context revisionが揃った時点を本書のinitial inputとする。本書は前段修正を再実装しない。

本書完了時のfinal Contextは次を持つ。

```text
Plan pass Context
  + accepted implementation evidence
  + frozen Test pass evidence
  + Review pass decision
  + aggregate Git closeout evidence
  + Task completion evidence
  + Task Archive evidence
```

後続のProject Evaluation / next Task generationは、このarchived Missionのfinal Contextとstructured evidenceを入力にできる。ただし、その評価loopは別計画であり、本書のArchiveを評価処理の成功に依存させない。
