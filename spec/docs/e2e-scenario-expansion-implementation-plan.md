# NightWorkers E2E シナリオ拡充 実装計画

## 目的

NightWorkers 自身の主要なユーザーフローと失敗復帰経路について、今後追加すべき Playwright E2E を scenario ID 単位で一覧化し、優先度、前提 fixture、操作、期待結果、必要証跡、既存テストとの重複、実装順を固定する。

この文書は `spec/e2e-testing-policy.md` と `tests/e2e/scenario-catalog.json` を前提とする。テスト追加時は、この計画の scenario を catalog の `planned` から `required` へ変更し、同じ変更内で対応する Playwright test を通す。

## 対象外

- NightWorkers が外部プロジェクトへ追加する E2E 方針
- コーディングエージェントや LLM prompt の制御
- すべての API endpoint を1件ずつブラウザから呼ぶこと
- unit / integration test で十分な単純 CRUD、schema validation、純粋関数
- live provider の成功を通常の deterministic gate に含めること
- Chromium 以外の browser matrix

## 現在のベースライン

| 区分 | 件数 | 状態 |
| --- | ---: | --- |
| required deterministic scenario | 8 | すべて Playwright test へ紐付け済み |
| P0 required scenario | 3 | 自動化率100% |
| observational live scenario | 1 | credential がある場合だけ実行 |
| planned scenario | 29 | 本計画の Wave 1〜6 で実装候補として管理 |

catalog 全体では required 8件、observational 1件、planned 29件の計38件を管理する。本計画は既存 required scenario の再実装ではなく、planned 29件を優先順に required へ昇格するための実装一覧である。

現在の `verify:e2e` は scenario 対応自体を確認できているが、`NW-E2E-A11Y-001` が Settings UI の serious な色コントラスト違反を検出している。新しい scenario を `required` へ昇格する前に、この既存失敗を直して full deterministic suite を緑へ戻す。

## 優先度

- `P0`: データ破損、重複実行、実行不能、誤commit、誤順序、復帰不能につながる。required 昇格時に100%自動化する。
- `P1`: 主要画面、設定、運用確認、観測性。重み付き網羅率80%の対象にする。
- `P2`: 低頻度または外部依存が強い補助フロー。P0/P1完了後に扱う。

## 共通 fixture 方針

### Disposable Git workspace

`tests/e2e/helpers.ts` に、通常repository、dirty repository、local bare remote付きrepositoryを作るhelperを追加する。すべて `NIGHTWORKERS_E2E_WORKSPACE_ROOT` 配下へ作成し、test終了時に削除する。

### Deterministic runtime behavior

`api/services/agent-runtime/e2e-fixture-runtime.ts` に、E2E fixture runtimeが有効な場合だけ使える次のbehaviorを追加する。

- success
- needs_human
- retry_success
- hold_until_stopped
- timeout
- tool_failure
- needs_review
- verification_failure

production runtimeの分類には流用しない。既存の `[fixture:policy-block]` と同様、`NIGHTWORKERS_E2E_RUNTIME_FIXTURE=1` の内側だけで解釈する。

### Seed helper

Test Mode、Review Mode、Queue、Qualityの前提データは、可能な限り公開APIで作成する。公開APIだけでは対象状態を作れない場合は、`NIGHTWORKERS_E2E_DATABASE_PATH` だけを開く `tests/e2e/fixtures/database.ts` を用意し、fixture作成と事後assertionに限定する。開発用DBへ接続しないguardを必須にする。

## Wave 0: 既存ゲートを緑へ戻す

| ID | 優先度 | 前提 | 操作 | 期待結果 | 証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-A11Y-001 | P1 | 現在のSettings UI | `verify:e2e`でaxe実行 | serious/critical違反0件 | axe JSON、screenshot | 既存test。新規追加ではなく現在の失敗修正 |

成功条件は `bun run verify:e2e` が既存8 required scenarioで成功すること。色コントラスト違反をignore、除外、priority降格で回避しない。

## Wave 1: Run終端状態と復帰

追加先は `tests/e2e/run-lifecycle.spec.ts` とする。既存の正常系 `NW-E2E-RUN-001` とpolicy block `NW-E2E-RUN-002`は再実装しない。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-RUN-003 | P0 | needs_human後にretry_successへ切替可能なworkspace | needs_human runを再queue/run | 新runがcompleted、旧run証跡保持、workspace差分は新runだけ | task_runs、task_events、git diff | RUN-002の後半。重複なし |
| NW-E2E-RUN-004 | P0 | hold_until_stopped runtime | running確認後`POST /runs/:id/stop` | run/taskがcancelled、active processなし、再実行可能 | API、task_runs、task_events | 未網羅 |
| NW-E2E-RUN-005 | P0 | timeoutSecondsを短くしたhold runtime | timeoutまで待機 | timed_out終端、timeout理由、queue占有解除 | API、task_runs、task_events、queue row | 未網羅 |
| NW-E2E-RUN-006 | P0 | tool_failure runtime | ready→queue→run | failed終端、失敗理由、production diffなし | API、task_events、git diff | RUN-002はpolicy停止のため別経路 |
| NW-E2E-RUN-007 | P0 | hold runtime | 同じtaskへrun開始を短時間に2回送る | active runが重複せず、競合応答が決定論的 | task_runs件数、HTTP status、queue row | UI-002はmessage重複のみ |

### Wave 1完了条件

- 5 scenarioを単独実行して成功する。
- cancel / timeout / failed / needs_human / completed の各終端でactive workerとqueue占有が残らない。
- `NW-E2E-RUN-003`〜`007` をcatalogの`required`へ変更する。
- `bun run verify:e2e`が成功する。

## Wave 2: Test ModeとReview Mode

追加先は `tests/e2e/test-review-workflow.spec.ts` とする。Implementation runとTest Mode runは別run/sessionとしてassertする。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-TEST-001 | P0 | verification JSON付きcompleted implementation run | Test ArtifactからTest Mode開始 | executionMode=testの別run、Todo 0件、managed check evidenceあり | task_runs、todos、run events、UI | 未網羅 |
| NW-E2E-TEST-002 | P1 | verification documentなしのtask | Test Mode開始を要求 | 開始拒否またはdisabled理由表示、空runを作らない | UI、HTTP status、task_runs件数 | 未網羅 |
| NW-E2E-TEST-003 | P0 | required checkが失敗するverification fixture | run_check→completion_check | failed/unknown required項目が残り、完了扱いにならない | verification checklist、managed events | 未網羅 |
| NW-E2E-REVIEW-001 | P0 | needs_review runとreview session | Review Run完了action | review artifact done、run closeout可能、証跡保持 | review_sessions、artifacts、UI | RUN-001の簡易human reviewより深い |
| NW-E2E-REVIEW-002 | P0 | completed Test Mode run | result linkからReview Modeを開く | artifact paneを閉じずreview_statusへ遷移 | URL、artifact focus、review session | 未網羅 |
| NW-E2E-REVIEW-003 | P1 | findingとprompt suggestionを持つreview session | finding disposition更新、suggestion use | dispositionとsuggestion状態が再読込後も保持 | UI、review tables、API | 未網羅 |

### Wave 2完了条件

- Test Modeにimplementation Todoが混入しない。
- Review ModeがTest Modeの進捗を再計算しない。
- page reload後もreview artifactと状態が一致する。
- 6 scenarioをrequiredへ変更し、`verify:e2e`を通す。

## Wave 3: Git closeoutとArchive

追加先は `tests/e2e/git-closeout.spec.ts` とする。pushは外部networkを使わず、E2E workspace配下のlocal bare repositoryをremoteにする。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-GIT-001 | P0 | completed review、runtime-owned diff | commit closeout実行 | owned pathだけcommit、commit SHA保存、queueはawaitingから完了へ | git log/status、commit record、events | RUN-001はcommit未実施 |
| NW-E2E-GIT-002 | P0 | baseline後に外部commitまたはstaged外pathを追加 | commit closeout実行 | HEAD_MOVEDまたはownership block、誤commitなし | blockingCode、git log/status | 未網羅 |
| NW-E2E-GIT-003 | P1 | local bare remote付きcommitted run | push closeout実行 | saved SHAがremote branchへpush、pushStatus=pushed | local remote ref、commit record | 未網羅 |
| NW-E2E-ARCHIVE-001 | P1 | completed/reviewed task | archive後にproject sidebar確認、restore | active listから消え、restore後readyで再表示 | UI、task status、API | RUN-001はarchiveのみでrestore未確認 |

### Wave 3完了条件

- pre-existing dirty pathとruntime-owned pathを混同しない。
- local remote外への通信を行わない。
- commit/push/archive/restore後のDB状態とGit状態が一致する。

## Wave 4: Implementation Queue scheduling

追加先は `tests/e2e/queue-scheduling.spec.ts` とする。processor数とtask execution typeをtestごとに初期化し、serialで実行する。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-QUEUE-001 | P1 | processorCount=2、normal task 2件 | queue→drain | 異なるslotで実行し両方終端、slot重複なし | queue dashboard、runs、timestamps | 未網羅 |
| NW-E2E-QUEUE-002 | P0 | active normal + queued exclusive | drain | exclusiveはactive normal完了まで開始しない | queue health、claimedAt、events | 未網羅 |
| NW-E2E-QUEUE-003 | P0 | 同一sequence groupのorder 1/2/3 | queue→drain | 1→2→3の順で開始・完了 | queue rows、run timestamps | 未網羅 |
| NW-E2E-QUEUE-004 | P0 | sequence order 1がtool_failure | queue→drain | order 2以降を開始せずpredecessor_failedを表示 | queue health、failureKind、runs件数 | 未網羅 |
| NW-E2E-QUEUE-005 | P1 | needs_human queue entry | recover/requeue action | priority保持で新entryを作り、旧entryをarchive | queue rows、attempt、recoveryReason | RUN-003はsession retryで別責務 |

### Wave 4完了条件

- scheduling orderをUI表示順だけでなくDB timestampとrun件数で確認する。
- test間でprocessor setting、queue row、leaseを残さない。
- P0 sequence/exclusive scenarioをrequiredへ変更してからゲートを通す。

## Wave 5: Project、Quality、Settings、Security、Navigation

追加先は責務ごとに `project-quality.spec.ts` と `settings-security.spec.ts` へ分ける。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-PROJECT-001 | P1 | package/quality artifact付きrepository | Project DetailのOverview/Qualityを開く | metricsとlatest qualityが空表示ではなく実値で表示 | UI、quality API | UI-001はTask detailのみ |
| NW-E2E-QUALITY-001 | P1 | unit/coverage/e2e scriptを持つfixture repo | Quality runを作成し完了待機 | unit、coverage、E2E結果とartifactが履歴・詳細へ表示 | quality_runs、JSON artifact、UI | 未網羅 |
| NW-E2E-QUALITY-002 | P1 | 長時間quality command | cancel endpoint/UIを実行 | cancelled終端、child process停止、再実行可能 | process state、quality run、UI | 未網羅 |
| NW-E2E-SETTINGS-001 | P1 | registered repository | coverage minimum/max iterationsを保存しreload | 値が永続化されAPIとUIで一致 | settings file/DB、API、UI | 未網羅 |
| NW-E2E-REPO-001 | P0 | repo root外にsecret fixture | file API/UIから`../`参照を試す | repo外を読めず、secret内容を返さない | HTTP status、response、audit event | 未網羅 |
| NW-E2E-ACTIVITY-001 | P1 | 複数eventを持つrun | `afterSeq`で再取得しUI reconnect | 重複・欠落なく単調増加 | API payload、seq一覧、UI | RUN-001はevent存在だけ |
| NW-E2E-NAV-001 | P1 | test/review artifact付きtask | deep linkを直開きしreload/back-forward | 同じartifact focusとsessionを維持 | URL、visible artifact、network | REVIEW-002は遷移時だけ |
| NW-E2E-A11Y-005 | P1 | Project Detail、Quality、Test Mode、Review Modeの実データ状態 | 各dynamic surfaceでaxe実行 | critical/serious違反0件 | axe JSON、screenshot | A11Y-001のroute smokeを状態付きへ補完 |

### Wave 5完了条件

- Quality結果が単にAPIへ存在するだけでなく画面へ表示される。
- repo root外pathをtest artifactやerror messageへ露出しない。
- navigation/reconnect後もartifact stateを失わない。

## Wave 6: Mission workflowとlive観測

外部providerを通常ゲートへ混ぜない。deterministic candidate fixtureを用意できた場合だけMission workflowを追加する。

| ID | 優先度 | 前提fixture | 操作 | 期待結果 | 必要証跡 | 既存重複 |
| --- | --- | --- | --- | --- | --- | --- |
| NW-E2E-MISSION-001 | P2 | deterministic candidate生成fixture | goal作成→candidate生成→承認→task化 | approved candidateだけtaskとなりsource relationを保持 | mission tables、task、UI | 未網羅 |
| NW-E2E-LIVE-001 | P1 observational | provider credential | live agent E2E | workspace、Todo、verification evidence生成 | provider usage、events、git diff | 既存。通常gateへ昇格しない |

## 実装順

1. Wave 0で現在のa11y失敗を解消し、required baselineを緑にする。
2. Wave 1のRun終端・復帰を実装する。
3. Wave 2のTest Mode / Review Mode境界を実装する。
4. Wave 3のGit closeoutとArchiveを実装する。
5. Wave 4のQueue schedulingをserial suiteで実装する。
6. Wave 5のProject / Quality / Settings / Securityを実装する。
7. Wave 6はdeterministic fixtureが成立した範囲だけ実装する。

各waveは独立したPRまたはcommit単位にできる。scenarioを追加した変更では、対象testの成功、catalogのrequired昇格、coverage artifact更新を同じ単位に含める。

## 検証手順

### Scenario単独

```bash
node scripts/run-playwright.mjs test tests/e2e/<target>.spec.ts --grep @scenario:<ID>
```

期待結果は対象scenarioが1件以上実行され、skip、retry、failureがないこと。失敗時はPlaywright trace、screenshot、対象runのevents、E2E DB rowを同じrun rootから確認する。

### Wave完了

```bash
bun run test:e2e:coverage
bun run verify:e2e
```

期待結果はP0 coverage 100%、weighted coverage 80%以上、required pass rate 100%、P0 flaky 0件。

### Repository gate

```bash
bun run verify
```

E2E以外の型、lint、Supervisor regressionを壊していないことを確認する。

## 失敗時の切り分け

- scenario未登録: catalog IDとtest tagを修正する。
- required未自動化: 同じ変更でtestを追加するか、合意前ならplannedへ戻す。数値だけ下げない。
- fixture作成失敗: public API、E2E DB seed、runtime behaviorのどこで止まったか分ける。
- run終端不一致: `task_runs`、`task_events`、queue row、active processを確認する。
- UI不一致: API responseが正しいか確認してからroute/query cache/artifact focusを調べる。
- flaky: timeout延長より先にpoll対象、terminal condition、shared state、cleanupを確認する。

## 完了条件

- この文書の全scenarioがcatalogへrequired、planned、observationalのいずれかで登録されている。
- P0/P1 scenarioにfixture、操作、期待結果、証跡が定義されている。
- 実装済みscenarioはrequiredへ昇格し、対応testが存在する。
- required P0 coverage 100%、weighted coverage 80%以上を維持する。
- `bun run verify:e2e`と`bun run verify`が成功する。
- 完了後、この文書を`spec/archive/`へ移動する。
