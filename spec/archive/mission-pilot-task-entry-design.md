# Mission Pilot タスク生成入口・再生操作 設計書

## Status

- Design status: `reviewed-ready-for-implementation`
- Document review completed: 2026-07-10
- Implementation status: `implemented`
- Deterministic verification completed: 2026-07-11
- Browser verification completed: `NW-E2E-MISSION-PILOT-001`でTask作成、同一画面維持、Sidebar / Composer controls、全8 themeのplaying token smoke、Stop、reload復元
- Live LLM verification: 未実行（`verify:live` と実provider Playはdeterministic gateから分離）
- MVP slice: `1/3` — Task生成入口・Play / Stop・初期Prompt exactly-once
- Canonical document for this slice: this document
- Baseline reviewed: 2026-07-10, `main` at `d08c7355bf88c6dc9e46152aae7f7be0dbcd7740`
- Current working-tree dependency reviewed: candidate taskizationの正本は`api/modules/taskGeneration` / `src/modules/taskGeneration`。削除済みProject Detail task-generation implementationを復元しない
- Target entrypoint: Project Detail のタスク生成画面
- Target domain: `src/modules/missionPilot` / `api/modules/missionPilot`
- Previous `mission-pilot-mvp` plan: discarded; do not use as implementation input
- Follow-up canonical plans:
  - `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`
  - `spec/archive/mission-pilot-test-review-archive-implementation-plan.md`

この文書は、Mission Pilot をタスク生成画面から開始し、既存タスク一覧の Mission Pilot variant から Play / Stop を操作し、最初のプロンプトを既存 Chat 処理へ送信するところまでの実装正本とする。

この文書が扱うのは Mission Pilot 全体の最初の縦切りである。Task作成時のMission Pilot Session、一貫Context、Questionnaire自動回答、Plan Artifact順次生成、Queue直前セルフレビュー、Queue投入は完了済み正本 `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md` が所有する。Queue後のImplementation、Test Mode、Review Mode、Git closeout、Task completion、真のTask Archiveは `spec/archive/mission-pilot-test-review-archive-implementation-plan.md` で完了済みである。

`mission_pilot_sessions` が本書のcontrol stateを統合して所有する。独立 `mission_pilot_controls` tableは作成しない。UIで使う`MissionPilotControlSummary`はSession rowから作るread projectionであり、永続entityではない。

## MVP document set

Mission Pilot MVPの実装正本は次の3文書だけとする。

1. 本書: Task生成入口、Task row variant、Play / Stop、初期Prompt exactly-once。
2. `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`: 完了済みのSession / canonical Context、Plan Mode、Questionnaire、Artifact、自動plan review、Queue admission。
3. `spec/archive/mission-pilot-test-review-archive-implementation-plan.md`: Implementation、Test Mode、Review Mode、修正loop、Git closeout、Task completed、真のTask Archive（完了済み）。

文書間の所有境界:

- 共通の永続正本は1つの`mission_pilot_sessions`とimmutable Context chainである。
- 後続文書は同じSession schemaへcolumn / phase / evidence relationを追加する。別Sessionや別control tableを作らない。
- Playは3文書を通したMVP全体の開始authorizationである。Task生成時点ではSessionは`stopped`で、実行authorizationは未activationとする。
- MVP完了は3文書を個別に実装した時点ではなく、Task生成から`task.status === "archived"`までの統合E2Eが通った時点とする。
- Project Evaluation再実行と評価結果からの次Task生成は、このMVPには含めない。

共有契約で記述が競合した場合は、入口UI / initial Promptは本書、QueueまでのSession / Contextは2文書目、Queue後のphase / closeout / Archiveは3文書目を正本とする。ただし、Chat本文をcanonical Contextへ入れない、Role RouterをContext ownerにしない、Mission Pilot専用画面を作らない、という横断invariantは全phaseで優先する。

### MVP integrated acceptance gate

1. Mission Pilot buttonが通常タスク化と同じTask fieldsでTask / Session / Context revision 1をatomicに作る。
2. 初回Playがinitial Promptをexactly onceで送信し、version 2 authorizationをactivationする。
3. Plan ModeのQuestionnaireをLLMが回答し、20秒の編集機会後に必要Artifactを順次生成する。
4. latest Contextに対するplan self-review pass後だけ既存Queueへ入る。
5. Implementation roleが同じContext chainから実装を完了する。
6. separate Test Modeがtest実装、managed checks、completion evidenceを完了する。
7. separate Review ModeがMission全差分をreviewし、blocking findingはImplementation -> Test -> Review loopへ戻す。
8. latest Test pass / Review pass後だけMission全runのowned pathsをlocal commitする。
9. Taskを`completed`にした後、`cancelled`ではなく`archived`へ遷移する。
10. 1から9まで、専用wizardや手動の「次へ」操作なしで、Stop / Play / restart recoveryを保ちながら完了する。

### MVP implementation order

1. 3文書のshared schema / Session phase / authorization / event unionを先にfreezeする。
2. base Mission Pilot migrationでSession、Context、durable events、steps、Questionnaire draft、plan reviewを作る。
3. slice 1のTask生成 / Play / Stop / UI projectionを実装する。
4. slice 2のPlan coordinator / intervention / Artifact / Queue admissionを実装する。
5. post-Queue extension migrationでphase run、Test snapshot、Review decision、aggregate closeout、Task Archiveを作る。
6. slice 3のImplementation / Test / Review / closeout / Archiveを実装する。
7. focused gateを各sliceで通し、最後にTask生成からArchiveまでの統合E2Eとrestart matrixを通す。

slice 1だけを先に実装する場合も、独立control table、別Session、Chat transcript依存など、後続で捨てる一時architectureを作らない。

## 1. 今回の設計が受け止める失敗

以前の実装は、利用者に承認と次アクションの選択を繰り返させる Pilot モーダルを中心にしていた。その結果、LLM が自律的にタスクを進める Mission Pilot ではなく、人間がステップごとに操作するウィザードになっていた。

今回の設計では、次を再発防止の固定条件とする。

1. Mission Pilot の開始に専用モーダルを使わない。
2. 「承認」「次のアクション」のような手動ゲートを入口に置かない。
3. Mission Pilot 用の別サイドバー、別タスク一覧、別 Chat 画面を作らない。
4. 既存タスクを下書きとして作るだけで終了しない。Play は実際に初期プロンプトを Chat intake へ送る。
5. frontend で Composer の送信ボタンを疑似クリックしない。backend の同じ Chat service を呼び出す。
6. Play / Stop を React のローカル状態だけで表現しない。再読込後も復元できる永続状態を持つ。
7. 同じ初期プロンプトを二重送信しない。
8. Pilot が再生中であることと、単一の `TaskRun` が `running` であることを同一視しない。
9. Mission Pilot 固有ロジックを `ProjectDetailScreen`、`ProjectSidebar`、`Composer`、llm-provider に分散させない。
10. ユーザー文言の keyword / 正規表現判定で Pilot の処理を分岐しない。

## 2. 目的

利用者がタスク候補から通常の「タスク化」と同じ情報を持つ Mission Pilot タスクを作成し、そのタスクに付いた Play を押すだけで、生成済み初期プロンプトが LLM へ送信され、既存の Chat 会話が開始する状態を作る。

画面上の差分は最小限にする。

- タスク候補の「タスク化」の隣に「Mission Pilot」を置く。
- 作成後のタスクは既存の同じタスク一覧、同じグループ、同じ並び順に表示する。
- タスク行は既存 `SessionRow` の Mission Pilot variant とする。
- Mission Pilot variant だけ、タイトル上へ Play / Stop の操作を重ねる。
- 再生中はタスク行全体を緑色にし、緑の Glow を出す。
- タスクタイトルをクリックした場合は、既存の Chat 画面へフォーカスする。
- フォーカス中の Mission Pilot タスクでは、Composer左上のWebSocket health indicator隣へ単一のMission Pilot control panelを置く。

## 3. 成功条件

次をすべて満たしたとき、この縦切りを完了とする。

1. タスク生成 tree-table の候補行で、「タスク化」の直隣に「Mission Pilot」操作が表示される。
2. Mission Pilot 操作は候補1件を、通常タスク化と同じ title、description、objective、acceptance criteria、`createdBy` で `draft` Task に変換する。
3. Mission Pilot 用 Task、Mission Pilot Session、initial Context revision 1の生成が同一 transaction で完了する。
4. Sessionまたはinitial Contextの生成に失敗した場合、見た目だけ通常タスクになった不完全な Task を残さない。
5. 作成後も Project Detail に留まり、既存タスク一覧が更新される。
6. 新しい Task は既存タスク一覧内に表示され、別セクションへ移動しない。
7. Mission Pilot Task だけ `SessionRow` が Mission Pilot variant になる。
8. 停止中の行には Play、再生中の行には Stop が同じ操作スロットへ入れ替わって表示される。
9. 再生中は行全体の背景、border、Glow が Mission Pilot 用 design token で緑色になる。
10. Play を押すと、Task に保存済みの初期プロンプトが user message として一度だけ保存される。
11. Play は既存 Workbench Chat intake と同じ routing / Plan Mode gate を通る。
12. 初期プロンプトの送信後、タスクをクリックすると既存 Chat timeline に user message と LLM の応答または開始済み run が表示される。
13. Composer左上にはSidebarと同じ単一controlが表示され、stopped=Play、starting/playing=running indicator、hover/focus=Pause、stopping=spinnerへ切り替わる。
14. Sidebar と Composer の操作は同じ backend command と永続状態を使用する。
15. Stop は Pilot の継続意図を停止し、active run が存在する場合は既存 run stop を呼ぶ。
16. Stop 後の Play で初期プロンプトが二重に user message 化されない。
17. 画面再読込後も Mission Pilot variant と再生状態が復元される。
18. 通常 Task の見た目、クリック、送信、停止動作に回帰がない。
19. light / dark / eclipse / macosclassic / campfire / mint / bloom / mocha の各 theme で文字と操作が判読可能である。
20. focused tests、typecheck、repo-native verify gate、実ブラウザ E2E が成功する。
21. Task生成時点のSessionは`stopped`かつauthorization未activationである。
22. 初回Playがauthorization version 2をactivationし、PlanからTask Archiveまでのlocal lifecycle scopeを保存する。
23. PlayだけからGit push authorizationを推測しない。

## 4. Locked Decisions

以下はこの設計で固定し、実装時に再解釈しない。

1. frontend の Mission Pilot 正本は `src/modules/missionPilot` とする。
2. backend の Mission Pilot 正本は `api/modules/missionPilot` とする。
3. runtime-neutral な request / response / state schema は `shared/schemas/mission-pilot.schema.ts` とする。
4. DB table 定義と bootstrap は DB 基盤責務として `api/db/mission-pilot-schema.ts` と `api/db/mission-pilot-schema-bootstrap.ts` に置く。
5. 正式な SQL migration を `drizzle/migrations/` に追加する。
6. `ProjectDetailScreen`、`ProjectSidebar`、`Composer` は Mission Pilot の業務状態を所有しない。
7. Mission Pilot は既存 Task の variant であり、別の sidebar entity ではない。
8. タスク一覧の grouping、sort、archive filter は現在の `WorkbenchSessionView` と `groupWorkbenchSessions()` をそのまま使う。
9. Mission Pilot 由来かどうかは `createdBy` の文字列から推測しない。Taskに1対1で存在する`mission_pilot_sessions` rowを正本にする。
10. 通常タスク化で使う `createdBy` は変更しない。候補なら `mission-task-candidate`、proposal なら `mission-task-proposal` のままにする。
11. 初期プロンプトは Mission Pilot 側で再生成しない。通常タスク化後の `task.objective` を exact snapshot として保存する。
12. Mission candidate と Mission proposal の両 source を同じ `sourceRef` contract で受ける。
13. 最初の実装は候補1件の Mission Pilot 化だけを扱う。複数選択の一括 Mission Pilot は追加しない。
14. 既存の一括「選択した候補をタスク化」は変更しない。
15. Mission Pilot 作成直後は `stopped` とし、自動再生しない。利用者が Play を押したことを明示的な開始意図とする。
16. Task生成時点ではauthorizationを未activationで保存し、初回Play transactionでversion 2 authorizationを有効化する。
17. version 2 authorizationはPlan、Queue、local implementation、test mutation、review、local commit、Task complete、Task archiveを含む。Play単独ではpushを含めず、事前設定済みproject push policyがある場合だけそのsnapshotを追加する。
18. Play は sidebar / Composer のどちらから押しても同じ API を呼ぶ。
19. Sidebar の Play / Stop はタスク選択を兼ねない。操作クリックでは現在の画面を維持する。
20. タイトル領域のクリックだけが既存 session route へ遷移する。
21. ComposerとSidebarは同じ単一controlを使い、状態に応じてPlay / running / Pause / stoppingを入れ替える。
22. 緑色は単一 run の状態ではなく、Mission Pilot の `desiredState === "playing"` を表す。
23. Stop を押した時点で新しい Pilot step の開始を禁止する。
24. active run があれば既存 `stopTaskRun()` を再利用する。別の run cancellation 実装を作らない。
25. Play は `appendWorkbenchMessage()` と同じ intake pipeline を再利用するが、初期 user message の idempotencyを追加する。
26. Play 時の provider / model はbackendの通常routingを使う。sidebar操作から一時的なComposer model overrideを推測しない。
27. Pilot routing 方針を llm-provider に埋め込まない。
28. Pilot の後続判断は Supervisor / coordinator の prompt と構造化状態で行い、keyword router を作らない。
29. この縦切りでは専用モーダル、承認UI、次アクション選択UIを追加しない。
30. 実装とこの契約が変わる場合は、先にこの文書を更新する。

## 5. スコープ

### 5.1 含む

- タスク生成候補1件からの Mission Pilot Task 作成。
- 通常タスク化 pipeline の再利用。
- Mission Pilot Sessionのdesired state / initial prompt state永続化。
- 同じタスク一覧内の Task row variant。
- Sidebar の Play / Stop 交換表示。
- 再生中の緑色背景と Glow。
- Composer左上connection panelの単一controlとoptional countdown。
- 初回 Play による初期プロンプトの自動 Chat 送信。
- 同じ Task Chat へのフォーカス。
- Stop による継続停止と active run stop。
- 再読込、二重クリック、通信失敗を含む状態復元。
- realtime / query cache 更新。
- focused unit / service / component / integration / E2E tests。

### 5.2 含まない

- Goal や Mission の生成方法変更。
- task candidate / proposal の LLM prompt 変更。
- 複数候補の一括 Mission Pilot 化。
- Plan questionnaire の自動回答方針。
- Plan の候補選択・再生成・完成判定。
- Plan 完成後の Implementation Queue 自動投入。
- 実装完了後の Test Mode 自動遷移。
- Test evidence 完了後の Review Mode 自動遷移。
- Review 完了後の評価・新規タスク生成 loop。
- Mission Pilot 全体の完了判定。
- 既存 Task 全体の status model 再設計。
- Project Queue / Kanban の専用表示。

これらは「不要」ではなく、後続の Mission Pilot coordinator 設計で扱う。今回のデータ契約は後続 phase を追加できる形にするが、未実装の自動遷移をUI上で実行済みに見せない。

## 6. 現在の実装状態

### 6.1 タスク生成

現在の候補行は `src/modules/taskGeneration/components/TaskGenerationTreeTable.tsx` が描画し、行末に `projectDetail.mission.createSingleTask` の「タスク化」操作を持つ。削除済みの`src/modules/nightworkers/components/project-detail/ProjectDetailMissionTree.tsx`を復元して入口を作らない。

`src/modules/taskGeneration/TaskGenerationPanel.tsx` の `createTasksFromUnifiedCandidates()` は source を次の2系統へ分ける。

- `mission_task_candidate` -> `createTasksFromMissionCandidates(..., mode: "draft")`
- `mission_task_proposal` -> `createTasksFromMissionTaskProposals(..., mode: "draft")`

`ProjectDetailScreen.tsx`は`TaskGenerationPanel`をhostし、作成後callbackでsession listをrefreshする。Task Chatへ自動遷移しない現在の挙動をMission Pilot作成後も維持する。

### 6.2 初期プロンプト

`mission_task_candidate` は、現在のworking treeでは `api/modules/taskGeneration/task-generation.repository.ts` の `buildMissionCandidateTaskObjective()` が Task objective を構築する。旧 `api/modules/project-detail/project-detail.repository.ts` を正本として復元してはならない。

`mission_task_proposal` は `api/modules/mission-planner/mission-planner.service.ts` の `buildTaskObjective()` が proposal の `initialPrompt` を基礎に Task objective を構築し、必要なら Plan 開始指示を前置する。

したがって Mission Pilot が送信すべき正本は raw candidate の `taskPrompt` や raw proposal の `initialPrompt` ではなく、通常タスク化後に確定した `task.objective` である。

### 6.3 Composer draft

`src/modules/nightworkers/components/ThreadWorkspaceBody.tsx` の `projectEvaluationComposerDraftState()` は、user message がまだ無い `project-evaluation` / `mission-task-candidate` Task の objective を Composer へ入れる。

現状は `mission-task-proposal` がこの判定に含まれていない。Mission Pilot 実装では `createdBy` の列挙を増やし続けず、Session summaryの`initialPromptSnapshot`とuser messageの有無から初期表示を解決する。通常proposal Taskの既存欠落もfocused regression testを追加して修正する。

### 6.4 Chat intake

通常の Composer 送信は `src/modules/nightworkers/hooks/nightWorkersChatActions.ts` から `POST /api/workbench/sessions/:id/messages` を呼ぶ。

backend の `appendWorkbenchMessage()` は user message を保存し、`handleWorkbenchIntakeMessage()` で Plan Mode gate / execution routing を行う。Mission Pilot の初回 Play はこの service seam を再利用する。

### 6.5 Sidebar

`src/modules/nightworkers/components/ProjectSidebar.tsx` は grouped sessions を `SessionList` -> `SessionRow` で表示する。現在の `SessionRow` は title と trailing indicator を持つ単一 `<a>` であり、Task variant は存在しない。

Mission Pilot は同じ `SessionList` の同じ位置に残す。`SessionRow` の土台を共通化し、Mission Pilot Session summaryが存在する場合だけ`variant="missionPilot"`を選ぶ。

### 6.6 Composer toolbar

現在の toolbar は左に `ModelThinkingControls`、右に send または active run stop の丸ボタンを置き、その間は flex gap で空いている。

Mission Pilot controls はこの中央 gap に置く。既存右端の send / run stop は削除しない。右端 stop は「現在の Chat run」、中央 Stop は「Mission Pilot の継続意図」を停止する操作であり、意味を区別する。

### 6.7 Stop

既存 `POST /api/runs/:id/stop` は active run を停止し、Task を `ready` へ戻す。これは単一 run の停止であり、Pilot の再生意図を保存しない。

Mission Pilot Stop は先に Pilot の desired state を `stopped` にして新規 step を禁止し、active run があれば既存 `stopTaskRun()` を呼ぶ orchestration command とする。

## 7. Target UX

### 7.1 タスク生成候補行

候補行末の操作順は次とする。

```text
[タスク化] [Mission Pilot] [削除]
```

- 「Mission Pilot」は1件の候補だけを対象にする。
- candidate status が `candidate` / `proposed` 以外なら disabled にする。
- 通常タスク化と Pilot 作成を同時に押せないよう、同じ row busy key を使う。
- request 中は Mission Pilot ボタンだけ spinner にする。
- 成功後は候補が `task_created` になり、Project Detail に留まる。
- 作成完了 toast は「Mission Pilot タスクを作成しました」とし、「実行を開始しました」とは表示しない。

候補 detail modal にも「タスク化」が存在するため、同じ `MissionPilotCreateButton` をその隣へ配置する。tree row と modal で別 command を実装しない。

### 7.2 同じタスク一覧内の Mission Pilot variant

```text
通常 Task
┌──────────────────────────────┐
│ タスクタイトル               3m │
└──────────────────────────────┘

Mission Pilot / stopped
┌──────────────────────────────┐
│ タスクタイトル   (Play)    3m │
└──────────────────────────────┘

Mission Pilot / playing
╔══════════════════════════════╗  <- green background + green glow
║ タスクタイトル   (Stop)    ●  ║
╚══════════════════════════════╝
```

実装形は次の通りとする。

- `SessionRow` の公開 variant は `default | missionPilot`。
- row link は従来どおり title と route を所有する。
- control button を `<a>` の中へ入れない。interactive element の nest を避ける。
- `<li className="relative">` 内で link と control slot を sibling にする。
- control slot はrow中央へ absolute overlayする。Playは背景、border、円形containerを表示せず、濃いgrayの三角iconだけをfloating表示する。control iconは通常のtrailing indicatorより大きく表示する。
- controlは背景をblurし、titleの上に重なっても独立した操作だと視認できるようにする。
- control click は `preventDefault()` と `stopPropagation()` を行い、Task focus を変えない。
- stopped / attention は Play を表示する。
- starting は通常spinnerを表示し、hover / focus中は赤い角丸borderのPause iconへ切り替える。Pauseを押すと進行中のPlayをStopする。playingはStop、stoppingはspinnerを表示する。
- active session の選択表現は維持する。Mission Pilot Glow と active selection が重なった場合、Pilot background を維持し、focus / selection は outline または inset ring で表す。
- trailing timestamp / status dot は通常Taskと同じ右端slotに残し、Mission Pilot controlと同時表示する。

### 7.3 タスククリック

タスクタイトル領域をクリックした場合は現在と同じ session route へ遷移する。

- stopped で未送信なら、Chat timeline はまだ空で、Composer に初期プロンプトが見える。
- Play 済みなら、初期 user message と LLM 応答、questionnaire、planning run、または run event が既存 timeline に見える。
- Mission Pilot 専用 Chat component は作らない。

### 7.4 Composer connection controls

```text
┌──────────────────────────────────────────────────────┐
│ ● [▶] [00:30] Prompt                                 │
├──────────────────────────────────────────────────────┤
│ [Model] [Thinking]                               [Send] │
└──────────────────────────────────────────────────────┘
```

- Mission Pilot Task がフォーカス中のときだけWebSocket health indicator隣へ小型panelを表示する。
- controlは1つだけ表示し、Sidebarのcontrolと同じstate/icon/action contractを共有する。
- stoppedではPlay、starting/playingではrunning indicator、hover/focus中は赤borderのPause、stoppingではspinnerを表示する。
- `nextWakeAt`が未来の場合だけcontrol右隣へcountdown timerを表示し、期限がない時はtimer領域自体を描画しない。
- countdown timerもbuttonとし、クリックするとMission Pilot Stopを実行する。
- attention では Play enabled、Stop disabled。error の詳細は button title だけに閉じず accessible status として表示できるようにする。
- generic `Composer` には `connectionControls?: ReactNode` slotだけを追加する。
- `Composer` が Mission Pilot schema、command、state machine を import してはならない。
- `MissionPilotComposerControls` は `src/modules/missionPilot` が所有する。
- toolbar右端の既存send / active-run stopは残す。Pilot playing中に手動user messageを送れるかは既存Chat behaviorを維持する。

## 8. Design tokens

既存 theme ごとの `--nw-success` を基礎に、`src/modules/missionPilot/mission-pilot.css` で次の semantic token を定義する。

```css
.nightworkers-shell {
  --nw-mission-pilot-playing-background: color-mix(
    in srgb,
    var(--nw-success) 24%,
    var(--nw-surface)
  );
  --nw-mission-pilot-playing-border: color-mix(
    in srgb,
    var(--nw-success) 72%,
    var(--nw-border)
  );
  --nw-mission-pilot-playing-foreground: color-mix(
    in srgb,
    var(--nw-success) 28%,
    var(--nw-text)
  );
  --nw-mission-pilot-playing-glow: color-mix(
    in srgb,
    var(--nw-success) 46%,
    transparent
  );
  --nw-mission-pilot-control-background: color-mix(
    in srgb,
    var(--nw-panel) 76%,
    transparent
  );
}
```

適用 class は literal Tailwind color ではなく semantic class とする。

- `.mission-pilot-task-row`
- `.mission-pilot-task-row-playing`
- `.mission-pilot-task-control`
- `.mission-pilot-composer-controls`

Glow の基準は次とする。

```css
box-shadow:
  inset 0 0 0 1px var(--nw-mission-pilot-playing-border),
  0 0 16px var(--nw-mission-pilot-playing-glow);
```

- `prefers-reduced-motion: reduce` では pulse animation を使わない。
- 初期実装は常時 static Glow とし、点滅 animation は追加しない。
- high contrast ではGlowだけに依存せず、2px row borderとPlay / Pauseのaccessible labelで状態を示す。

## 9. Domain ownership

### 9.1 frontend canonical owner

`src/modules/missionPilot` が次を所有する。

- `missionPilotCommands.ts`: create / play / stop API client。
- `missionPilotQueries.ts`: control summary の cache update helper。
- `useMissionPilotControls.ts`: mutations、busy state、session cache 更新。
- `components/MissionPilotCreateButton.tsx`。
- `components/MissionPilotTaskControl.tsx`。
- `components/MissionPilotComposerControls.tsx`。
- `missionPilotPresentation.ts`: variant、enabled/disabled、accessible label の決定的 mapping。
- `mission-pilot.css`: semantic tokens と variant style。
- `index.ts`: frontend の唯一の公開 import boundary。

NightWorkers 側は次だけを行う。

- `src/modules/taskGeneration/components/TaskGenerationTreeTable.tsx`: `MissionPilotCreateButton`の配置。
- `src/modules/taskGeneration/components/TaskGenerationDialogs.tsx`: detail modalへの同じbutton配置。
- `src/modules/taskGeneration/TaskGenerationPanel.tsx`: sourceRef、busy key、completion callbackの接続。
- `ProjectDetailScreen.tsx`: Task Generation hostとsession refresh callbackの接続。
- `ProjectSidebar.tsx`: `SessionRow` の variant slot へ `MissionPilotTaskControl` を配置。
- `ThreadWorkspaceBody.tsx`: focused Task の control summary を Composer slot へ渡す。
- `Composer.tsx`: generic `connectionControls` slotをWebSocket health隣へ描画。

NightWorkers component 内に `if (createdBy === "...")` を増やして Pilot 判定しない。

### 9.2 backend canonical owner

`api/modules/missionPilot` が次を所有する。

- `mission-pilot.routes.ts`: create / play / stop route。
- `mission-pilot.service.ts`: state transition と orchestration。
- `mission-pilot.repository.ts`: Session rowのquery / compare-and-set update。
- `mission-pilot-taskization.port.ts`: existing taskization services への adapter。
- `mission-pilot-workbench.port.ts`: Workbench intake / run stop の再利用境界。
- `mission-pilot-realtime.ts`: Session summary update event publish。
- `mission-pilot.errors.ts`: stable error code。
- `index.ts`: backend の公開 import boundary。

backend の既存 domain は次だけを提供する。

- Task Generation / Mission Planner:通常タスク化をtransaction内で再利用可能にするgeneric `onTaskCreated(task, tx)` hook。
- NightWorkers Workbench: user message append と intake 実行を分離した internal port。
- NightWorkers Run:既存 `stopTaskRun(runId)`。
- Task list projection: Mission Pilot Session summaryからcontrol projectionを付加。

Task Generation / Mission PlannerはMission Pilot Session tableを直接更新せず、transaction-aware Mission Pilot hookだけを呼ぶ。

## 10. Shared contract

`shared/schemas/mission-pilot.schema.ts` に次を定義する。

```ts
const missionPilotSourceRefSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("mission_task_candidate"),
    id: z.string().uuid(),
  }),
  z.object({
    source: z.literal("mission_task_proposal"),
    id: z.string().uuid(),
  }),
]);

const missionPilotPushPolicySchema = z.enum(["never", "allowed", "required"]);

const missionPilotAuthorizationV2Schema = z.object({
  version: z.literal(2),
  sessionId: z.string().uuid(),
  taskId: z.string().uuid(),
  sourceRef: missionPilotSourceRefSchema,
  grantedByAction: z.literal("mission_pilot_play"),
  grantedAt: z.string().datetime(),
  scopes: z.object({
    plan: z.literal(true),
    queue: z.literal(true),
    implementation: z.literal(true),
    testMutation: z.literal(true),
    review: z.literal(true),
    localCommit: z.literal(true),
    taskComplete: z.literal(true),
    taskArchive: z.literal(true),
    push: z.boolean(),
  }),
  pushPolicy: missionPilotPushPolicySchema,
});

const missionPilotDesiredStateSchema = z.enum(["stopped", "playing"]);

const missionPilotActivityStateSchema = z.enum([
  "idle",
  "starting",
  "running",
  "stopping",
  "attention",
]);

const missionPilotInitialPromptStateSchema = z.enum([
  "pending",
  "dispatching",
  "sent",
  "failed",
]);

const missionPilotControlSummarySchema = z.object({
  taskId: z.string().uuid(),
  desiredState: missionPilotDesiredStateSchema,
  activityState: missionPilotActivityStateSchema,
  phase: z.string(),
  authorizationVersion: z.number().int().nullable(),
  initialPromptState: missionPilotInitialPromptStateSchema,
  initialPromptMessageId: z.string().uuid().nullable(),
  activeRunId: z.string().uuid().nullable(),
  version: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  updatedAt: dateLikeSchema,
});
```

Task list の cross-domain projection は base `taskSchema` を直接 Mission Pilot 専用にせず、次の schema とする。

```ts
const taskWithMissionPilotSchema = taskSchema.extend({
  missionPilot: missionPilotControlSummarySchema.nullable(),
});
```

frontend `Task` type は `missionPilot?: MissionPilotControlSummary | null` を受け取れるようにする。Pilot ではない Task は `null` とし、`createdBy` から補完しない。

`activityState`は永続columnにしない。`mission_pilot_sessions.phase`、`desired_state`、`active_run_id`、lease / error stateから`missionPilotPresentation.ts`とbackend projectionが決定的に導出する。これにより3文書で別々の状態機械を持たない。

## 11. Persistence model

永続正本は後続計画で定義する `mission_pilot_sessions` とする。独立 `mission_pilot_controls` table は追加しない。Task row / Composerへ返す `MissionPilotControlSummary` はSessionのprojectionである。

| column | type | rule |
| --- | --- | --- |
| `id` | text PK | Mission Pilot Session ID |
| `task_id` | text unique FK tasks | Task削除でcascade |
| `repository_id` | text FK repositories | Project境界確認用、cascade |
| `source_kind` | text | candidate / proposal |
| `source_id` | text | 元候補ID |
| `authorization_version` | integer nullable | Task生成時null、初回Playで2 |
| `authorization_json` | JSON nullable | 初回PlayでMVP local lifecycle scopeを固定 |
| `desired_state` | text | stopped / playing |
| `phase` | text | Session state machine phase |
| `initial_prompt_snapshot` | text not null | task.objective の exact snapshot |
| `initial_prompt_state` | text | pending / dispatching / sent / failed |
| `initial_prompt_message_id` | text nullable FK task_messages | set null |
| `active_run_id` | text nullable FK task_runs | set null |
| `version` | integer not null | compare-and-set 用、初期0 |
| `context_revision` | integer not null | canonical Context revision |
| `context_digest` | text not null | canonical Context digest |
| `next_wake_at` | integer nullable | durable countdown / resume |
| `last_error_message` | text nullable | 内部失敗の要約 |
| `started_at` | integer nullable | 最新Play受付時刻 |
| `stopped_at` | integer nullable | 最新Stop完了時刻 |
| `created_at` | integer not null | 作成時刻 |
| `updated_at` | integer not null | 更新時刻 |

index / constraint:

- primary key: `id`
- unique: `task_id`
- unique: `(source_kind, source_id)`
- index: `(repository_id, desired_state, updated_at)`
- check 相当の schema validation: state enum、non-empty prompt snapshot

`initial_prompt_snapshot` はSession initial Context内のTask objective exact copyである。この表は入口sliceが使用するcolumnを示すsubsetであり、Context snapshot、Questionnaire draft、coordinator lease、post-Queue cycle / closeout refsを含む完全schemaは後続2文書のextensionを合成する。

## 12. 状態モデル

### 12.1 なぜ2軸に分けるか

Mission Pilot は複数 run や LLM turn の間でも「再生中」であり得る。したがって、利用者の継続意図と現在の処理状態を分ける。

- `desiredState`: 利用者が Pilot を再生し続けたいか。
- `activityState`: 現在 command / run が何をしているか。

Glow は `desiredState === "playing"` で決める。`TaskRun.status` だけでは決めない。

### 12.2 初期状態

Task とSessionのtransaction完了時。`activityState`はSession `phase`からfrontend projectionとして導出する:

```text
desiredState = stopped
activityState = idle
initialPromptState = pending
initialPromptMessageId = null
activeRunId = null
version = 0
```

### 12.3 遷移表

| command / event | before | after | UI |
| --- | --- | --- | --- |
| 候補から開始（Task作成） | none | stopped + idle + pending | 飛行機アイコンをspinner表示 |
| 候補から開始（Play受付） | stopped + idle + pending | playing + starting | 緑Glow、spinner |
| Play受付 | stopped + idle/attention | playing + starting | 緑Glow、spinner |
| prompt claim | pending | dispatching | 緑Glow、spinner |
| user message保存 | dispatching | sent、messageId設定 | 緑Glow |
| intakeがrun開始 | starting | playing + running、activeRunId設定 | Stop |
| intakeが質問/応答を生成 | starting | playing + idle | Stop、緑Glow維持 |
| intake失敗 | starting | stopped + attention | Play、Glowなし、error |
| Stop受付 | playing + any | stopped + stopping | Glowを外す、spinner |
| active run stop完了 | stopping | stopped + idle、activeRunId=null | Play |
| active runなしでStop | stopping | stopped + idle | Play |
| run自然完了 | playing + running | playing + idle | Stop、緑Glow維持 |
| 再Play・prompt送信済み | stopped + idle | playing + starting | user messageを追加せず intake resume |

### 12.4 `attention`

`attention` は人間の承認要求を表す generic state ではない。この縦切りでは、Play command が継続できなかった技術的 / contract上の失敗を表す。

- initial prompt が空。
- source / repository / task の対応が壊れている。
- Chat intake が失敗した。
- Sessionのversion conflictを再取得しても解消できない。

`attention` を専用モーダルへ誘導しない。Task Chat と既存 error presentation から原因を確認できるようにする。

## 13. API design

### 13.1 Mission Pilot Task作成

```http
POST /api/mission-pilot/tasks
```

request:

```json
{
  "repositoryId": "uuid",
  "sourceRef": {
    "source": "mission_task_candidate",
    "id": "uuid"
  }
}
```

response `201`:

```json
{
  "task": {
    "id": "uuid",
    "title": "...",
    "status": "draft",
    "objective": "...",
    "createdBy": "mission-task-candidate",
    "missionPilot": {
      "taskId": "uuid",
      "desiredState": "stopped",
      "activityState": "idle",
      "phase": "created",
      "authorizationVersion": null,
      "initialPromptState": "pending",
      "initialPromptMessageId": null,
      "activeRunId": null,
      "version": 0,
      "lastError": null
    }
  }
}
```

stable errors:

- `MISSION_PILOT_SOURCE_NOT_FOUND`
- `MISSION_PILOT_SOURCE_ALREADY_TASKED`
- `MISSION_PILOT_SOURCE_REPOSITORY_MISMATCH`
- `MISSION_PILOT_INITIAL_PROMPT_REQUIRED`
- `MISSION_PILOT_CREATE_CONFLICT`

### 13.2 Play

```http
POST /api/mission-pilot/tasks/:taskId/play
```

request:

```json
{
  "expectedVersion": 0
}
```

authorization versionはclient入力として選ばせない。backendがMVP contractのcurrent version 2を固定し、初回Play transactionでactivationする。

response `200`:

```json
{
  "missionPilot": {
    "desiredState": "playing",
    "activityState": "running",
    "authorizationVersion": 2
  },
  "task": { "id": "uuid", "status": "running" },
  "run": { "id": "uuid", "status": "running" },
  "messages": []
}
```

questionnaire / general response 等で run が作られない場合は `run: null` を許容する。
`task.status`はPlay handlerが固定で`running`へ書き換えず、Workbench intake / Plan Mode gateが永続化した実statusを返す。上記JSONはrun開始scenarioのexampleである。

stable errors:

- `MISSION_PILOT_NOT_FOUND`
- `MISSION_PILOT_ALREADY_PLAYING`
- `MISSION_PILOT_VERSION_CONFLICT`
- `MISSION_PILOT_INITIAL_PROMPT_REQUIRED`
- `MISSION_PILOT_INTAKE_FAILED`

### 13.3 Stop

```http
POST /api/mission-pilot/tasks/:taskId/stop
```

request:

```json
{
  "expectedVersion": 3
}
```

response `200`:

```json
{
  "missionPilot": {
    "desiredState": "stopped",
    "activityState": "idle",
    "activeRunId": null
  },
  "stoppedRun": null
}
```

Stop は idempotent にする。既にstoppedなら最新Session summaryを`200`で返し、user-facing errorにしない。

### 13.4 Task list projection

`GET /api/tasks` は各 Task に `missionPilot` summary を付ける。N+1 query にせず、Task IDs をまとめて `listSessionSummariesByTaskIds()` で取得する。

`missionPilot: null` の Task は通常 `SessionRow`、non-null の Task は Mission Pilot variant になる。

## 14. Task作成 sequence

```text
MissionPilotCreateButton（飛行機アイコン）
  -> POST /api/mission-pilot/tasks
    -> missionPilot.service.createFromSourceRef()
      -> taskization port が source を検証
      -> existing taskization service を mode=draft で実行
      -> Task title/description/objective/AC/createdBy を通常経路で作成
      -> onTaskCreated(task, tx)
        -> task.objective の non-empty を検証
        -> mission_pilot_sessions とinitial Contextをstopped/pending、authorization未activationでinsert
      -> source status/taskIdを更新
    -> transaction commit
  -> 作成済みTaskをTask一覧へ即時反映
  -> POST /api/mission-pilot/tasks/:taskId/play(expectedVersion=作成結果のversion)
  -> Play成功後のSession summaryをTask一覧へ反映
  -> Project Detail に留まる
```

Task候補の主操作は「Mission Pilot Taskを作る」だけではなく、「Mission Pilotで開始する」までを1クリックで行う。Task作成後にPlayが失敗した場合もTaskを失わず、Sidebar / ComposerのPlayから再試行できる。候補行では通常のタスク化ボタンと同じoutline icon controlを使い、Mission PilotはLucideの飛行機アイコンで区別する。名称はtooltip / accessible labelに残し、行内に追加文言を表示しない。

通常タスク化と差が生まれるのは `onTaskCreated()` でSessionとinitial Contextを付ける点だけである。Task 本体の生成ロジックを Mission Pilot module にコピーしない。

現在 proposal taskization は candidate path と同じ transaction shape ではないため、実装時に transaction 対応へ揃える。通常作成の response / status / metadata を変えない regression test を先に置く。

## 15. Play sequence

### 15.1 初回 Play

```text
Sidebar or Composer Play
  -> frontendはinitialPromptSnapshotと同値のTask objectiveを通常送信と同じuser bubbleとして楽観表示
  -> Composer draftを消去し、Mission Pilot activity=startingの間はassistant thinking indicatorを表示
  -> POST /api/mission-pilot/tasks/:taskId/play(expectedVersion)
    -> Sessionをcompare-and-setでplaying/startingへclaim
    -> authorization version 2を同じtransactionでactivation
       scopes = plan / queue / implementation / test / review / local commit / complete / archive
       push = false unless frozen project policy explicitly allows it
    -> initialPromptState=pending を dispatching へclaim
    -> initialPromptSnapshot を user message として一度だけ保存
       metadata.source = mission_pilot
       metadata.intent = initial_prompt
       metadata.controlVersion = claimed version
    -> initialPromptMessageId と sent を保存
    -> task_message_created realtime eventを通常送信と同じshapeでpublish
    -> Workbench intake port を同じ prompt / intent=intake で実行
    -> runができれば activeRunId を保存
    -> Session summaryをrunningまたはidleへ更新
    -> realtime event publish
  -> sessions/messages/runs cache更新
```

### 15.2 再Play

`initialPromptState === "sent"`の場合、同じuser messageを追加しない。保存済み`initialPromptMessageId`はexactly-once evidenceとして使い、resume先はSession phase / canonical Context / durable stepから決める。Chat会話履歴をMission Pilot Contextやphase判定の正本にしない。

この入口 slice では resume が既存 Workbench gate を再評価するところまでを実装する。後続 coordinator が導入された後は、同じ `resume(taskId)` port の内部を「次の Pilot step を決定して実行する」処理へ差し替える。UI / API contract は変えない。

## 16. Idempotency と競合制御

### 16.1 二重Play

- request は `expectedVersion` を必須にする。
- repository は `WHERE task_id = ? AND version = ?` の compare-and-set を使う。
- 最初のrequestだけが state を claim する。
- 2件目は `MISSION_PILOT_VERSION_CONFLICT` を返す。
- frontend は Task list を再取得し、既に playing なら成功相当の表示へ収束する。

### 16.2 初期プロンプト exactly-once

Sessionの`initial_prompt_state: pending -> dispatching -> sent`と`initial_prompt_message_id`を正本にする。

- `pending` だけが user message insert を許可する。
- insert と `initialPromptMessageId` 更新は同じ transaction にする。
- user message metadata に taskId / controlVersion / source を保存する。
- process crash 後に `dispatching` が残った場合、messageId または metadata evidence を照合して `sent` へ回復する。
- message evidence が無い場合だけ同じ snapshot を再insertする。
- 初期プロンプト送信済みかを、画面に見えている文字列比較や localStorage で判定しない。

### 16.3 Play とStopの競合

- Stop は desired state を最初に `stopped` へ更新する。
- intake / coordinator は外部処理の前後で current desired state と version を再確認する。
- Stop 後に遅れて返った Play result は、新しい step を開始しない。
- 既に開始済みの run は Stop 側が `stopTaskRun()` で停止する。
- stale response で frontend cache を巻き戻さない。response version が cache version 以上の場合だけ置換する。

## 17. Stop semantics

Mission Pilot Stop は次の順で動作する。

1. Sessionをcompare-and-setで`desiredState=stopped`へし、current phaseを`resume_phase`へ保存して`phase=paused`へ移し、projectionを`activityState=stopping`にする。
2. この時点以後、coordinator が次の step を開始できないようにする。
3. `activeRunId` があり、run が stoppable status なら既存 `stopTaskRun(activeRunId)` を呼ぶ。
4. active run がなくても成功とする。
5. `activeRunId=null`, `stoppedAt=now`を保存し、projectionを`activityState=idle`にする。`resume_phase`は次回Play reconcile成功まで保持する。
6. realtime event を publish する。

HTTP request の AbortController だけを Stop の正本にしない。client request abort は transport を止めても server-side LLM / run を止めた証拠にならない。

## 18. Realtime とfrontend cache

Mission Pilot Session summary update eventを追加する。

```ts
type MissionPilotUpdatedEvent = {
  type: "mission_pilot.updated";
  taskId: string;
  missionPilot: MissionPilotControlSummary;
};
```

- create / play / stop / failure / run completion sync で publish する。
- `useNightWorkersRealtime` は `sessions` cache 内の該当 Task の `missionPilot` だけを version-aware に更新する。
- focused Task の messages / runs は既存 event と query invalidation を使う。
- create 成功後は既存 `refreshProjectList()` を使う。
- Sidebar と Composer が別々の local state を持たない。

run の自然完了時は Mission Pilot domain が run event を購読または explicit callback で受け、`activeRunId` をnull、`activityState` をidleへ同期する。desired state は playing のままにする。

## 19. Error presentation

| failure | persisted state | UI |
| --- | --- | --- |
| Task作成前 validation | controlなし | row button error、候補は未変換 |
| transaction失敗 | Task/controlなし | retry可能 |
| Play version conflict | 最新stateを再取得 | 正しいPlay/Stopへ収束 |
| user message保存失敗 | stopped + attention / pending | Play retry、二重messageなし |
| intake失敗 | stopped + attention / sent | Chatに保存済みpromptを表示、Play retry |
| Stop中run stop失敗 | stopped + attention | Glowなし、error表示、次stepは禁止 |
| realtime切断 | server state維持 | mutation response + refreshで復元 |

LLM が本文を返した場合、schema parse の失敗を理由に固定エラー文へ置換しない。既存 Workbench の message / event contract に従って本文と診断 evidence を保持する。

## 20. Accessibility / interaction contract

1. Sidebar row の title link と Play / Stop button は別 focus target にする。
2. icon-only button は `aria-label` と `title` を持つ。
3. label は「Mission Pilotを再生」「Mission Pilotを停止」「Mission Pilotを開始中」「Mission Pilotを停止中」とする。
4. Task row は `aria-current="page"` を selection にだけ使い、playing の意味に流用しない。
5. playing state は色だけで表さず、button icon / label と optional `aria-live` status を持つ。
6. Enter on title は Chat focus、Enter / Space on control は play / stop とする。
7. mutation 中は `aria-busy="true"` を control に付ける。
8. Composer connection controls のtab orderはWebSocket health -> Mission Pilot control -> countdown -> prompt -> Model -> Thinking -> Sendとする。
9. disabled button に理由が必要な場合は visually hidden text または status text で補う。
10. Glow は focus ring を隠さない。

## 21. i18n

最低限次の key を日本語・英語 dictionary に追加する。

- `missionPilot.create`
- `missionPilot.created`
- `missionPilot.play`
- `missionPilot.stop`
- `missionPilot.starting`
- `missionPilot.stopping`
- `missionPilot.playing`
- `missionPilot.stopped`
- `missionPilot.attention`
- `missionPilot.createFailed`
- `missionPilot.playFailed`
- `missionPilot.stopFailed`

日本語 prompt / system message は日本語を維持する。運用規則を確認しづらい英語文へ置き換えない。

## 22. 実装ファイル計画

### Phase 1: schema / DB / backend domain

追加:

- `shared/schemas/mission-pilot.schema.ts`
- `api/db/mission-pilot-schema.ts`
- `api/db/mission-pilot-schema-bootstrap.ts`
- `drizzle/migrations/<next>_mission_pilot_sessions.sql`
- `api/modules/missionPilot/index.ts`
- `api/modules/missionPilot/mission-pilot.routes.ts`
- `api/modules/missionPilot/mission-pilot.service.ts`
- `api/modules/missionPilot/mission-pilot.repository.ts`
- `api/modules/missionPilot/mission-pilot-taskization.port.ts`
- `api/modules/missionPilot/mission-pilot-workbench.port.ts`
- `api/modules/missionPilot/mission-pilot-realtime.ts`
- `api/modules/missionPilot/mission-pilot.errors.ts`

変更:

- `api/db/schema.ts`: table export integration。
- `api/db/bootstrap.ts`: bootstrap integration。
- API router composition: `missionPilotRouter` 登録。
- `api/modules/taskGeneration` / Mission Planner taskization service: generic transaction hook。
- NightWorkers workbench service: message append と intake resume の internal seam。
- NightWorkers task list service / route: `taskWithMissionPilotSchema` projection。

### Phase 2: frontend domain

追加:

- `src/modules/missionPilot/index.ts`
- `src/modules/missionPilot/missionPilotCommands.ts`
- `src/modules/missionPilot/missionPilotQueries.ts`
- `src/modules/missionPilot/useMissionPilotControls.ts`
- `src/modules/missionPilot/missionPilotPresentation.ts`
- `src/modules/missionPilot/components/MissionPilotCreateButton.tsx`
- `src/modules/missionPilot/components/MissionPilotTaskControl.tsx`
- `src/modules/missionPilot/components/MissionPilotComposerControls.tsx`
- `src/modules/missionPilot/mission-pilot.css`

変更:

- `src/modules/nightworkers/types/core.ts`: optional control summary projection。
- `src/modules/taskGeneration/components/TaskGenerationTreeTable.tsx`: button placement。
- `src/modules/taskGeneration/components/TaskGenerationDialogs.tsx`: modal button placement。
- `src/modules/taskGeneration/TaskGenerationPanel.tsx`: create callback / busy key connection。
- `src/modules/nightworkers/components/ProjectDetailScreen.tsx`: session refresh callback connection。
- `src/modules/nightworkers/components/ProjectSidebar.tsx`: `SessionRow` variant / sibling overlay slot。
- `src/modules/nightworkers/components/ThreadWorkspaceBody.tsx`: focused control と Composer slot。
- `src/modules/nightworkers/components/Composer.tsx`: generic `connectionControls` prop。
- `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`: event cache sync。
- `src/i18n/dictionaries/ja.ts` / `en.ts`。
- `src/index.css`: Mission Pilot CSS import。

### Phase 3: Play / Stop integration

1. Sidebar と Composer を同じ mutation hook へ接続する。
2. initial prompt exactly-once transaction を実装する。
3. Workbench intake port を接続する。
4. activeRunId と run completion sync を接続する。
5. Stop -> existing run stop を接続する。
6. attention / retry / stale version handling を実装する。

### Phase 4: tests / visual verification / cleanup

1. unit / service / route / component tests を追加する。
2. light / dark を最低限 screenshot comparison する。
3. 全themeで contrast smoke を行う。
4. 実ブラウザで end-to-end evidence を採る。
5. generic component に残った Pilot 判定、literal green、重複 command を削除する。
6. `modules/missionPilot` の public `index.ts` を越える内部 import が無いことを確認する。

## 23. Test plan

### 23.1 schema / repository

- sourceRef の candidate / proposal をacceptする。
- unknown source をrejectする。
- Session initial stateがstopped / idle / pending、authorization未activationになる。
- empty objective では transaction 全体がrollbackする。
- source unique constraint が二重Pilot Taskを防ぐ。
- compare-and-set が stale version をrejectする。
- Project / Task削除でcontrolがcascade deleteされる。
- message / run削除時にnullable FKがset nullになる。

### 23.2 taskization regression

- 通常 candidate taskization の Task fields が変更前と同じ。
- 通常 proposal taskization の Task fields / system metadata が変更前と同じ。
- Pilot candidate taskization の Task fields が通常 candidate と同じ。
- Pilot proposal taskization の Task fields が通常 proposal と同じ。
- PilotだけMission Pilot Session rowが付く。
- Session / initial Context insert失敗でTask/source status更新がrollbackする。

### 23.3 Play service

- first Play がinitialPromptSnapshotをuser messageとして1件保存する。
- metadata が Mission Pilot source を持つ。
- existing Workbench intake が呼ばれる。
- planning gate がPlanを選んだ場合、planning run / questionnaire が既存通り生成される。
- double Play の同時requestでuser messageが1件だけになる。
- crash recovery 相当の dispatching + message evidence がsentへ収束する。
- intake失敗後のretryでuser messageが増えない。
- Play中のStopで遅いPlay responseがstateをplayingへ戻さない。

### 23.4 Stop service

- activeRunIdありで既存 stop port を1回呼ぶ。
- activeRunIdなしでも成功する。
- already stopped がidempotentに成功する。
- run stop失敗でもdesired stateはstoppedを維持し、attentionを残す。
- Stop後にcoordinatorが次stepを開始しない。

### 23.5 frontend presentation

- `missionPilot=null` は通常SessionRowになる。
- non-null はMission Pilot variantになる。
- stopped はPlay、playingはStopを表示する。
- playing rowだけsemantic Glow classを持つ。
- title link click はsessionを選択する。
- control click はsessionを選択しない。
- nested interactive element が無い。
- Composer controls はPilot Taskだけに表示する。
- Composer stopped / playing / starting / stopping / attention のenabled mappingが正しい。
- SidebarとComposer mutation後に同じcache versionへ収束する。

### 23.6 Composer draft regression

- stopped / pending Pilot Task はsnapshotをComposerへ表示する。
- user message送信済みならsnapshotを再投入しない。
- mission-task-proposal のgenerated objectiveも未送信時に表示される。
- localStorageの古いdraftがsent promptを復活させない。
- 通常manual Taskのdraft behaviorを変えない。

### 23.7 E2E

必須の実ブラウザ scenario:

1. Project Detail のタスク生成画面を開く。
2. candidate row に「タスク化」「Mission Pilot」「削除」が並ぶことを確認する。
3. Mission Pilot を押す。
4. 画面遷移せず、candidate が task_created になることを確認する。
5. 同じ Project のタスク一覧に stopped variant が出ることを確認する。
6. Sidebar Play を押す。
7. タスク行全体が緑色にGlowし、操作がStopへ入れ替わることを確認する。
8. Task title をクリックする。
9. 既存 Chat timeline に初期 user message が1件だけ存在することを確認する。
10. LLM応答、questionnaire、またはplanning run開始 evidence が見えることを確認する。
11. Composer左上に単一running controlがあり、`nextWakeAt`設定時だけcountdownが表示されることを確認する。
12. Composer Stopを押す。
13. Glowが消え、Sidebar操作がPlayへ戻ることを確認する。
14. 再Playしても初期 user message が1件のままであることを確認する。
15. reload後もvariantと状態が復元されることを確認する。
16. 通常タスク化したTaskはGlowもPilot controlsも持たないことを確認する。

DB evidence:

- `tasks` row の title / objective / createdBy / status。
- `mission_pilot_sessions` row の desired / phase / prompt state / version。
- `task_messages` の初期 user message 件数と metadata。
- `task_runs` の run type / status / taskId。
- Stop時の `run.stop_requested` event。

## 24. Verification commands

実装時は変更範囲に合わせて最低限次を実行する。

```bash
bun run test run <mission-pilot-focused-tests>
bun run test run <project-detail-taskization-regression-tests>
bun run test run <project-sidebar-and-composer-tests>
bun run typecheck
bun run verify:base
bun run test:e2e -- <mission-pilot-e2e-spec>
git diff --check
```

DB migration は fresh DB と既存 DB の両方で確認する。

```bash
bun run db:migrate
bun run db:init:empty
```

`db:init:empty` はローカル検証DBを破壊するため、実装時は対象DBを明示した隔離環境でだけ実行する。

## 25. Definition of Done

この縦切りは、次の evidence が揃うまで完了にしない。

1. Mission Pilot Task作成の transaction test。
2. 初期prompt exactly-onceの並行request test。
3. Sidebar variantのcomponent test。
4. Composer connection controlとoptional countdownのcomponent test。
5. Play -> Chat intakeのservice integration test。
6. Stop -> existing run stopのintegration test。
7. reload復元を含むE2E evidence。
8. semantic design tokenを使ったlight / dark screenshot。
9. 通常Taskのregression test。
10. `modules/missionPilot` ownership audit。
11. typecheck / verify gate成功。
12. 実装後に本書の `Implementation status` と実装済み範囲を更新すること。

これはslice 1/3のDefinition of Doneであり、Mission Pilot MVP全体の完了宣言ではない。MVP全体は3文書のintegrated Definition of Doneと、Task生成からtrue ArchiveまでのE2E evidenceを必要とする。

## 26. 後続設計への接続点

後続2文書は、この入口を壊さず`api/modules/missionPilot`のcoordinatorを拡張する。

```text
Task作成
  -> initial intake
  -> Plan Mode開始
  -> LLMによるPlan選択・質問回答
  -> 仕様完成判定
  -> 実装
  -> Test Mode
  -> test実装・証跡
  -> Review Mode
  -> review完了
  -> aggregate Git closeout
  -> Task completed
  -> Task archived
```

後続 phase が増えても、次は維持する。

- UI入口はタスク生成画面。
- 表示は同じTask rowのMission Pilot variant。
- Play / Stop APIは同じ。
- desired stateとactivity stateは同じ。
- 初期promptは一度だけ送る。
- Chatは既存Task conversationを使う。
- orchestrationの正本は`api/modules/missionPilot`。
- LLM判断はSupervisor prompt / structured stateに置く。

この接続点を守ることで、入口UIを作り直さずに Mission Pilot 本来の連続自動実行を追加できる。

Project Evaluation再実行と評価結果からの次Task生成はMVP後続であり、この3文書の実装完了条件へ混ぜない。
