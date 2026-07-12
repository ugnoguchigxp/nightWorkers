# Mission Pilot Universal Task Model 実装計画

## Status

- Plan status: `completed-verified`
- Document created: 2026-07-11
- Implementation started: 2026-07-12
- Implementation completed: 2026-07-12
- Implementation status: `completed`
- Implemented scope: 全production Task producerのatomic stopped Session provisioning、既存Task backfill、Play activation v3、non-null contract、variant UI / API撤去
- Product decision: すべてのTaskをMission Pilot対応Taskとし、Mission Pilot無しTaskという製品概念を廃止する
- Canonical plan for universal Task adoption: this document
- Completed prerequisite 1: `spec/archive/mission-pilot-pre-queue-handoff-remediation-implementation-plan.md`
- Completed independent follow-up: `spec/archive/mission-pilot-test-review-archive-implementation-plan.md`（post-Queue自律進行）
- Baseline reviewed: 2026-07-11, `main` at `c597bdd522ef7e4594157131c9d1865ce9ea148b`
- Runtime evidence reviewed: 2026-07-11 local `sqlite.db`
- Target domains: `api/modules/nightworkers` / `api/modules/missionPilot` / Task生成元domain / `src/modules/nightworkers` / `src/modules/missionPilot` / `src/modules/taskGeneration`
- Target runtime span: Task作成、停止中の手動操作、Play activation、Stop / resume、Task一覧・Chat UI、既存Task backfill

この文書を、NightWorkersのTaskモデルを「通常Task」と「Mission Pilot付きTask」の二種類から、すべてのTaskが停止状態のMission Pilot Sessionを持つ一種類のモデルへ移行するための実装正本とする。

Mission PilotはTask作成時に自動実行しない。Task作成と自律実行の認可境界を分離し、すべてのTaskを`desired_state = stopped`で作成する。利用者がPlayを押した時点で、最新Task Contextと実行権限を同一transactionで固定し、Mission Pilot coordinatorへ制御を渡す。停止中は既存の手動Chat、Plan Mode、Queue、Test Mode、Review Mode、Git closeout、Archive操作を維持する。

この変更により、Mission PilotはTaskのvariantや付加機能ではなく、NightWorkersにおけるTask実行の標準control planeになる。ただし、Mission Pilot Sessionの存在だけを自律実行の根拠にしてはならない。全TaskがSessionを持つため、自動経路へ入る条件は`playing`、有効なactivation authorization、phase / cycle整合の組み合わせで判定する。

## 0. Plan boundary

本計画の完了対象は、全Taskが停止状態のMission Pilot Sessionを持つ一種類のTask model、全producerの原子的作成、Play activation v3、non-null API / frontend contract、variant UI / API撤去である。

pre-Queue remediationは完了済みであり、本計画はそのPlay / Queue handoff contractを再利用する。Queue claim後からImplementation、Test、Review、Git closeout、true Archiveまでの自律進行は`spec/archive/mission-pilot-test-review-archive-implementation-plan.md`で完了済みである。

この境界により、「全TaskにMission Pilot controlがある」という製品モデルの採用と、「Mission Pilotがpost-Queue lifecycleを最後まで自律完遂する」という別の機能完成度を混同しない。

## 1. Product decision

### 1.1 廃止する区別

次の区別を製品UI、API、型、永続化契約から段階的に廃止する。

- Mission Pilot無しTask。
- Task Candidateから「通常Taskを作成」と「Mission Pilot Taskを作成して開始」を選ぶ二重entry。
- `missionPilot === null`をTaskの正常な定常状態として扱うcontract。
- Mission Pilot Sessionの有無を自動制御の判定に使う実装。
- Mission Pilot専用Taskであることを示す常時badge / row styling。

### 1.2 維持する区別

区別するのはTask variantではなく、Mission Pilotの実行状態とphaseである。

```text
Task
  -> Mission Pilot Session: stopped / created
       -> 手動操作可能
       -> Play
            -> playing / pre-Queue
            -> playing / queued
            -> playing / implementation
            -> playing / test
            -> playing / review
            -> playing / closeout
            -> stopped / attention
            -> stopped / archived
       -> Stop
            -> stopped / paused
            -> 手動介入またはPlay再開
```

### 1.3 利用者向けの基本契約

NightWorkersの基本体験を次に固定する。

> Taskと初期プロンプトを用意し、Playを押すと、Mission Pilotが計画、実装、テスト、レビュー、完了までを進行する。いつでもStopでき、停止中は手動で操作できる。

「いつでもPlay」は、安全なidle / non-terminal Taskで任意の時点から開始できることを意味する。active manual run、競合Queue entry、terminal Taskを無条件に横取りする意味ではない。

## 2. 現状と解消する問題

### 2.1 現行contract

現行実装では次の非対称がある。

1. `missionPilotSourceRefSchema`は`mission_task_candidate | mission_task_proposal`だけを受け付ける。
2. Mission Pilot SessionはCandidate / Proposalから専用commandでTask化した場合だけ同一transactionで作られる。
3. 手動Task、Worktree Task、Project Evaluation Task、Coverage TaskはMission Pilot Sessionを作らない。
4. Mission Pilot Task作成actionは作成直後にPlayまで連続実行する。
5. `initial_prompt_snapshot`はTask作成時の`objective`で固定され、後からPlayする直前のTask編集をactivation inputにできない。
6. Task API / frontend型では`missionPilot`がnullable / optionalである。
7. 一部UI / backend gateはSessionの存在をMission Pilot固有経路の判定に使う。

### 2.2 2026-07-11 runtime baseline

local `sqlite.db`のbaselineは次の通りである。

```text
tasks: 2
mission_pilot_sessions: 1
tasks_without_session: 1
created_by=mission-task-candidate: 2 tasks / 1 without session
```

同じ生成元のTaskでも、押した作成buttonによってMission Pilot Sessionの有無が変わる。この差はTaskの目的、初期プロンプト、完了条件から導かれず、entry UIの選択だけで生じるため、Task lifecycleの本質的な差として扱わない。

### 2.3 変更後のinvariant

Migration完了後、次をDB invariantとする。

```sql
select count(*)
from tasks t
left join mission_pilot_sessions s on s.task_id = t.id
where s.id is null;
-- expected: 0
```

新規Task作成transactionは、Task rowだけがcommitされMission Pilot Sessionがない状態を作らない。

## 3. 目的

1. すべての新規TaskにMission Pilot Sessionをatomicに作成する。
2. 既存Taskへ停止状態のSessionを安全にbackfillする。
3. Task作成時は自動Playせず、利用者のPlayを自律進行の認可境界として維持する。
4. 初回Play時に最新Task Context、初期プロンプト、authorizationを同一activationとして固定する。
5. 停止中は従来の手動workflowを完全に利用できる。
6. playing中だけMission Pilot coordinatorが自動進行を所有する。
7. Task Candidate UIの二重作成actionを一つのTask化actionへ統合する。
8. API / frontendからMission Pilot nullable normal caseを除去する。
9. Mission PilotをNightWorkersの標準Task execution identityとして表示する。

## 4. 成功条件

1. production code上のすべてのTask作成経路がMission Pilot Sessionを作る。
2. Task rowとSession rowは同一transactionでcommit / rollbackされる。
3. Task作成後のSessionは`desired_state=stopped`であり、run、Queue entry、authorizationを作らない。
4. Taskの`objective`が空でもdraft TaskとSessionは作成できる。
5. 初期プロンプトが空のTaskはPlayできず、編集すべき項目を構造化errorで返す。
6. Play直前にTaskを編集した場合、編集後のtitle / objective / description / acceptance criteria / worktreeをactivation Contextへ固定する。
7. Play activationとauthorization保存の間にprocessが落ちても、二重initial prompt messageや二重runを作らない。
8. 停止中のTaskでは手動Chat / Plan / Queue / Test / Review / commit / Archiveが従来どおり利用できる。
9. Sessionが存在するだけではQueue claim、run finalizer、Test / Review automation、closeout automationがPilot pathへ入らない。
10. playing中のmanual duplicate actionは既存Mission Pilot gateへ収束するか明示disableされる。
11. Stop後は新stepを開始せず、active runを停止して永続phaseを保存する。
12. 再Play時、Task Contextが同じなら完了済みstep / evidenceを再生成しない。
13. 再Play前にTask Contextが変わった場合、phase-specific refresh gateを通り、stale evidenceを正常扱いしない。
14. terminal / archived TaskはPlayで暗黙再開せず、既存Reopen / new cycle契約を要求する。
15. active manual runまたは競合Queue entryがあるTaskをPlayが横取りしない。
16. Task一覧・Task詳細APIは常にnon-null Mission Pilot summaryを返す。
17. SidebarとComposerは全TaskでPlay controlを表示し、playing中だけactive visualを表示する。
18. Task Generation画面からMission Pilot専用作成buttonがなくなる。
19. 既存Task backfillはTask status、run、Queue、Git、TaskMessage、repo filesを変更しない。
20. fresh DB、既存DB、restart、browserの統合検証が成功する。

## 5. Locked Decisions

1. Taskは一種類とし、すべてMission Pilot Sessionを持つ。
2. Mission Pilot SessionはTaskのoptional extensionではなく、Task control planeの1:1 companion rowとする。
3. `mission_pilot_sessions.task_id` unique indexを1:1 invariantの正本として維持する。
4. Task作成時は常に`desired_state=stopped`とし、自動Playしない。
5. Task作成自体は自律実行の認可を意味しない。
6. Playだけをplan / queue / implementation / test mutation / review / local commit / complete / archiveの認可点とする。
7. Git pushは既存どおりPlayだけでは認可しない。
8. 初期プロンプトはTask `objective`を正本とし、Play activation時にsnapshotする。
9. Task作成時のContext snapshotはprovisioning baselineであり、activation snapshotではない。
10. 初期プロンプト空欄はTask / Session作成を妨げず、Playだけを妨げる。
11. Chat transcript全体をactivation Contextへ取り込まない。
12. typed Task field、Task provenance link、Plan / Verificationの構造化artifactだけをphaseに応じて参照する。
13. 全TaskがSessionを持つため、Session存在判定をPilot active判定として使わない。
14. Pilot active判定は`desired_state=playing`、schema-valid authorization、current cycle / phase整合を必須とする。
15. stopped Sessionは手動workflowを妨げない。
16. playing中の手動duplicate mutationはbackend idempotent commandへ収束させるかdisableする。
17. terminal TaskはPlayで暗黙rollbackしない。
18. active manual run / Queue entryをPlayがadoptまたはcancelしない。
19. Candidate / Proposal / Evaluation / Coverage等の由来はTask provenanceであり、Mission Pilot Sessionの有無を決めない。
20. 新規universal Sessionのcontrol sourceはTask自身とする。
21. 既存SessionのCandidate / Proposal sourceはhistorical provenanceとして破壊的に書き換えない。
22. authorization v2 historical rowをin-place変換しない。universal activation用authorization v3を追加する。
23. frontendだけでmissing Sessionを補完しない。DB migrationとbackend transactionを正本にする。
24. API response時に暗黙Session insertを行わない。read requestをwriteへ変えない。
25. migration / startupでTaskを自動Playしない。
26. migration / startupでterminal TaskをReopenしない。
27. permanent feature flagで二種類のTaskモデルを残さない。
28. rollout用temporary compatibilityは計画完了時に削除する。
29. prompt文言は日本語を維持する。
30. ユーザー文言のregex / keyword分類でPilot routeを決めない。

## 6. Scope

### 6.1 含む

- universal Mission Pilot Session provisioning。
- Task creation application boundaryの一本化。
- manual / Workbench / Worktree Task作成。
- Mission Task Candidate / Proposal Task作成。
- Project Evaluation improvement Task作成。
- Quality Coverage Task作成。
- test / seed factoryのinvariant更新。
- existing Task Session backfill。
- authorization v3とTask-based control ref。
- Play activation時のlatest Context snapshot。
- stopped / playing manual action gateの再定義。
- Task list / detail responseのnon-null Mission Pilot projection。
- Task Generationの二重entry削除。
- Sidebar / Composer controlの全Task表示。
- focused / migration / restart / browser E2E。
- 旧Mission Pilot Task作成endpointとfrontend commandの撤去。

### 6.2 含まない

- Mission Pilot pre-Queue / post-Queue orchestrationの再実装。
- Test ModeとReview Modeの統合。
- Review後のProject Evaluation自動再実行。
- Evaluationから次Taskを無限生成するloop。
- PR作成、merge、release、deployment。
- default Git push。
- Chat transcript summarization。
- Task Candidate / Proposal ontologyの再設計。
- Task title / objective生成promptの全面刷新。
- archived Taskの暗黙Restore / Reopen。
- active manual runをMission Pilot runへadoptする機能。
- unrelated dirty filesのcleanup。

## 7. Target domain model

### 7.1 Task / Session invariant

```ts
type UniversalTask = Task & {
  missionPilot: MissionPilotControlSummary;
};
```

API境界では`missionPilot`をnon-nullとする。DBではFK方向がSession -> Taskであるため、SQLだけでTask側の必須childを表現できない。Task作成application service、backfill migration、integrity testの三層で保証する。

### 7.2 Universal control source

新規Sessionは次のcontrol refを持つ。

```ts
type MissionPilotTaskRef = {
  source: "task";
  id: string; // taskId
};
```

Candidate / Proposal / Evaluation / Coverageの由来は既存link table、`createdBy`、TaskMessage metadataで保持する。Mission Pilot authorizationが生成元domainへ依存しないようにする。

### 7.3 Authorization v3

```ts
type MissionPilotAuthorizationV3 = {
  version: 3;
  sessionId: string;
  taskId: string;
  taskRef: { source: "task"; id: string };
  activationContextRevision: number;
  activationContextDigest: string;
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

v3はactivation Context revision / digestを認可payloadへ固定する。後続coordinatorはSessionのcurrent digestだけでなく、authorizationが指すactivation digestとの関係を検証する。

既存v2 authorizationはhistorical cycleの検証用にread可能なまま残す。新規universal activationはv3だけを発行する。既存active v2 SessionのMVP完了を妨げず、新しいPlay cycleへ入る時点でv3へ移行する。

### 7.4 Provisioning ContextとActivation Context

Session作成時にrevision 1としてprovisioning Contextを保存する。

```ts
type MissionPilotTaskContext = {
  title: string;
  initialPrompt: string;
  description: string | null;
  acceptanceCriteria: string | null;
  worktreePath: string | null;
  repositoryId: string;
};
```

Play時にTask rowを再読し、上記projectionのdigestを計算する。

- provisioning Contextと同じでも、初回Playでは`reason=play_activation` revisionをappendする。
- 同一cycleのresumeでdigestが同じなら新revisionを作らない。
- stopped中にpre-Queue Task fieldが変わった場合は新revisionをappendし、古い未完了stepをphase-specific ruleでinvalidateする。
- post-Queue evidence確定後にTask fieldが変わった場合は、既存post-Queue evidence invalidation / rework gateを通す。単純にlatest digestへ差し替えない。

`initial_prompt_snapshot`とactivation Contextの`initialPrompt`は同じtransactionで更新する。Task作成時の古いobjectiveをinitial prompt messageとして送信しない。

## 8. Task creation architecture

### 8.1 単一application boundary

`api/modules/nightworkers`にTask作成application serviceを追加する。

```ts
createTaskWithMissionPilot(input, transaction?)
  -> insert tasks
  -> provisionMissionPilotSession(task, transaction)
  -> return TaskWithMissionPilot
```

低水準の`nightworkers.repository.createTask()`はrepository内部とmigration / test helperだけで使用し、production domain serviceが直接呼ばないようにする。Mission Pilot moduleからNightWorkers repositoryへの逆importでcycleを作らず、application serviceからMission Pilot provisioning portを呼ぶ。

### 8.2 Transaction contract

呼出元がCandidate claim、Proposal link、Evaluation link等を同じtransactionへ含める必要があるため、次の二形態を用意する。

```ts
createTaskWithMissionPilot(input)
createTaskWithMissionPilot(input, tx)
```

transaction所有者を曖昧にしない。外側transactionが渡された場合、helperはcommit / rollbackしない。Session insert失敗時はTask insertとsource claim / linkをまとめてrollbackする。

### 8.3 作成経路inventory

| 作成元 | 現行path | 変更後 |
| --- | --- | --- |
| Sidebar / Workbench / Worktree | `nightworkers.basic.service.createTask` | common application service |
| Mission Task Candidate | `task-generation.repository.createTaskFromMissionCandidate` | transaction内common application service |
| Mission Task Proposal | `mission-planner.service` | transaction内common application service |
| Project Evaluation | `project-evaluation.service` | common application service + evaluation link transaction |
| Quality Coverage | `quality.service` | common application service |
| seed / tests | direct repository / fixture helper | universal Task fixture helper、または明示low-level fixture |

Candidate / Proposalだけに存在する`onTaskCreated` Mission Pilot hookは不要になる。Task作成そのものがSession provisioningを含むため、source別optional hookを削除する。

### 8.4 Empty prompt

Task `objective`はdraft作成時点では空を許容する。Sessionは空文字を含むprovisioning Contextで作成する。

Play APIは次を返す。

```json
{
  "error": "MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
  "field": "objective"
}
```

frontendはPlay controlをdisabledにし、Taskの初期プロンプト編集導線を表示する。Taskを作れない状態にはしない。

## 9. Play / Stop / manual workflow contract

### 9.1 Play eligibility

Play commandは同一transactionで次を確認する。

| Task / runtime state | Play |
| --- | --- |
| draft / ready、promptあり、active runなし、競合Queueなし | 許可 |
| draft / ready、promptなし | 400 `INITIAL_PROMPT_REQUIRED` |
| active manual runあり | 409 `MANUAL_RUN_ACTIVE` |
| Pilot active runあり | idempotent current state、またはversion conflict |
| manual Queue entryがclaim前 | 409 `QUEUE_OWNERSHIP_CONFLICT` |
| completed / failed / cancelled | Reopen / new cycleを要求 |
| archived | Restore後の明示Reopenを要求 |
| attention | 原因解消と既存resume gateを要求 |

### 9.2 Atomic activation sequence

```text
POST /api/mission-pilot/tasks/:taskId/play
  -> Task / Session / run / Queue stateをtransaction内で再読
  -> eligibility gate
  -> latest Task Contextをproject
  -> play_activation Context revisionをappendまたはreuse
  -> initial_prompt_snapshotをlatest objectiveへ更新
  -> authorization v3を保存
  -> desired_state=playing / phase=starting / version increment
  -> transaction commit
  -> initial prompt message exactly-once claim
  -> phase coordinator schedule
```

authorization保存前にTaskMessageやrunを作らない。transaction commit後のresponse lossではclientがversion conflictを受けても、再読によりplaying stateと同じactivationを取得できる。

### 9.3 Stopped semantics

全TaskにSessionがあるため、次を共通helperにする。

```ts
isMissionPilotControlling(session) =
  session.desiredState === "playing" &&
  authorizationIsValidForCurrentCycle(session) &&
  phaseIsActive(session.phase);
```

手動workflowのguardは`Boolean(session)`や`missionPilot != null`を使わない。

- stopped: 手動workflowを許可。
- playing: duplicate manual mutationをdisable / idempotent commandへ収束。
- stopping: 新しいmanual / Pilot stepを開始しない。
- attention: 自動進行を止め、明示された安全な手動復旧操作だけ許可。
- archived: read-only。Restore / Reopenを別commandで行う。

### 9.4 ResumeとContext変更

Stop後の再Playでは保存済み`resume_phase`を使用する。

1. Task projection digestが同じなら、同一activation / completed evidenceを再利用する。
2. pre-QueueでTask projectionが変わった場合、Context revisionをappendしてreview / verificationのstale判定を行う。
3. post-QueueでTask projectionまたはowned diffが変わった場合、Test / Review passをinvalidateし、既存rework cycleへ戻す。
4. completed / archived cycleは再利用せず、既存Reopen / new Mission Pilot cycleを使う。
5. Chat本文だけの追加ではContextを暗黙変更しない。Task fieldへ反映された変更だけをdeterministicに取り込む。

## 10. API / schema changes

### 10.1 Shared schema

- `missionPilotSourceRefSchema`へTask ref compatibilityを追加する。
- `missionPilotAuthorizationV3Schema`を追加する。
- authorization read schemaをv2 / v3 discriminated unionにする。
- `taskWithMissionPilotSchema.missionPilot`をnon-nullにする。
- frontend `Task.missionPilot`をrequiredにする。
- Play error responseをstructured unionにする。

### 10.2 Task API

次のresponseはすべてMission Pilot summaryを含む。

- `POST /api/tasks`
- Workbench session create response。
- Mission Candidate taskization response。
- Mission Proposal taskization response。
- Project Evaluation task create response。
- Quality Coverage task create response。
- `GET /api/tasks` / Task detail projection。

read時にSessionが欠けていた場合はsilent `null`や自動insertにせず、integrity errorとして記録する。Migration完了後に欠損が発生したことを観測可能にする。

### 10.3 Mission Pilot entry API

Task Candidate / ProposalからTaskとSessionを同時作成する専用`POST /api/mission-pilot/tasks`はfrontend caller移行後に削除する。

維持するcommand:

```text
POST /api/mission-pilot/tasks/:taskId/play
POST /api/mission-pilot/tasks/:taskId/stop
GET  /api/mission-pilot/tasks/:taskId/session
```

Task作成とPlayを一つのendpointへ再結合しない。

## 11. Database migration and backfill

### 11.1 Schema migration

post-Queue MVP完了時点の最新schemaをbaselineに、新しいmigrationを一つ追加する。

- authorization v3を保存できる既存JSON columnは再利用する。
- `source_kind=task` / `source_id=taskId`を許可する。
- 必要ならactivation revision / digestの明示columnを追加するが、canonical Context chainと二重正本にしない。
- Task 1件につきSession 1件のunique indexを維持する。
- Task source unique indexはhistorical sourceとTask sourceの両方で衝突しないことを検証する。

### 11.2 Backfill rule

SessionがないTaskだけを対象に、idempotent `insert ... select ... where not exists`相当で作成する。

```text
task_id = tasks.id
repository_id = tasks.repository_id
source_kind = task
source_id = tasks.id
desired_state = stopped
phase = created
initial_prompt_snapshot = tasks.objective ?? ""
initial_prompt_state = pending
authorization_version = null
authorization_json = null
active_run_id = null
resume_phase = null
context_revision = 1
context_digest = provisioning Context digest
```

同じtransactionでrevision 1の`mission_pilot_context_snapshots`を作る。

### 11.3 Backfill safety

Backfillは次を変更しない。

- Task status / updatedAt。
- TaskMessage。
- TaskRun / Todo / event。
- Queue entry。
- Review Session / artifact。
- commit record / Git index / working tree。
- completed / archived Taskの再生状態。

terminal TaskにもSessionは作るが、`stopped`のままとしPlay eligibilityはReopenを要求する。既存Mission Pilot Sessionは更新しない。

### 11.4 Integrity verification

Migration直後に少なくとも次を検証する。

```sql
select count(*) from tasks;
select count(*) from mission_pilot_sessions;
select count(*)
from tasks t left join mission_pilot_sessions s on s.task_id=t.id
where s.id is null;
select task_id, count(*)
from mission_pilot_sessions
group by task_id having count(*) <> 1;
select count(*)
from mission_pilot_sessions
where desired_state='playing' and authorization_json is null;
```

既存DBでは`tasks_without_session`が1から0になり、既存1 Sessionのversion / phase / error / authorizationが不変であることをsnapshot比較する。

## 12. Frontend / UX

### 12.1 Task Generation

- Candidate row / detail modalの「Mission Pilotとして開始」専用buttonを削除する。
- 「タスク化」を唯一の作成actionにする。
- 一括Task化と単体Task化は同じbackend invariantを使う。
- 作成直後にPlayしない。
- 作成後は既存Task list refresh / navigation policyを維持する。

### 12.2 Sidebar

- すべてのTask rowにMission Pilot controlを表示する。
- stopped Taskを「Mission Pilot Task」として特別な常時styleにしない。
- playing / stopping / attentionだけを状態に応じて視覚化する。
- green glowはplaying中だけに限定し、archivedで解除する。
- controlの有無でrow width / timestamp slotが揺れないようにする。

### 12.3 Composer

- すべてのTaskでPlay / Stop controlを表示する。
- prompt不足時はPlayをdisabledにし、初期プロンプト編集を案内する。
- active manual run / Queue conflict / terminal Taskでは理由をtooltip / statusで表示する。
- stopped中の通常送信、Plan Mode、Test Mode、Review Mode操作を隠さない。
- playing中はduplicate actionをbackend gateと一致する形でdisableする。

### 12.4 Copy

Mission PilotをTask variantとして表現しない。

- 廃止: 「Mission Pilot Taskを作成」「Mission Pilotとしてタスク化」。
- 維持: 「Mission Pilotを再生」「Mission Pilotを一時停止」。
- 状態表現: 「停止中」「計画中」「実装中」「テスト中」「レビュー中」「確認が必要」。

日本語を正本として更新し、英語辞書も同じ意味へ揃える。

## 13. Backend active-control audit

全Task Session化により、次のpatternを禁止する。

```ts
if (missionPilotSession) { /* autonomous path */ }
if (task.missionPilot) { /* block manual action */ }
```

実装時に`api` / `src`を検索し、各箇所を分類する。

1. projection目的: Session存在を使ってよいが、migration後は常にtrueになる前提へ更新。
2. visual目的: `desiredState` / `activityState` / `phase`へ変更。
3. mutation gate: `isMissionPilotControlling()`へ変更。
4. run association: authorization / cycle / relation rowを必須化。
5. compatibility merge: nullable assumptionを削除。

特にQueue claim、generic run finalizer、Test自動開始、Review自動開始、Git closeout、Task completion、ArchiveはSession存在だけでPilot pathへ入らないことをfocused testで固定する。

## 14. Implementation slices

### Slice 0: Prerequisite acceptance and baseline

1. pre-Queue remediation / post-Queue MVPの完了evidenceを確認する。
2. completed planを`spec/archive`へ移した状態を確認する。
3. Task creation callsite、nullable branch、Session存在gateを再inventoryする。
4. live DBのTask / Session / phase / authorization baselineを保存する。
5. current `bun run verify`結果を記録する。

### Slice 1: Universal provisioning contract

1. Task ref / authorization v3 schemaを追加する。
2. Mission Pilot provisioning portをTask-basedにする。
3. common `createTaskWithMissionPilot()` application serviceを追加する。
4. manual / Workbench / Worktree Task作成を移行する。
5. Task / Session atomic rollback testを追加する。

### Slice 2: All producer migration

1. Mission Candidate作成をcommon serviceへ移行する。
2. Mission Proposal作成をcommon serviceへ移行する。
3. Project Evaluation作成をcommon serviceへ移行する。
4. Quality Coverage作成をcommon serviceへ移行する。
5. source別optional Session hookを削除する。
6. production direct Task insertをゼロにする。

### Slice 3: Migration and non-null API

1. existing Task backfill migrationを追加する。
2. fresh DB / populated DB / repeated migration testを追加する。
3. Task list / create responseをnon-null Mission Pilot contractへ変更する。
4. frontend Task型のnullable / optionalを除去する。
5. missing Sessionをintegrity errorとして観測する。

### Slice 4: Play activation refresh

1. latest Task Context projection helperを追加する。
2. authorization v3 activationを実装する。
3. initial prompt snapshotをPlay transactionで更新する。
4. same-digest resume / changed-digest refreshを実装する。
5. manual run / Queue / terminal conflict gateを追加する。
6. response loss / retry / restart testを追加する。

### Slice 5: Active-control gate conversion

1. Session存在判定を全件auditする。
2. backend mutation gateを`isMissionPilotControlling()`へ変更する。
3. stopped Taskのmanual workflow regression testを追加する。
4. playing Taskのduplicate action testを追加する。
5. Queue / finalizer / Test / Review / closeout / Archiveの誤起動防止testを追加する。

### Slice 6: Unified UX and legacy removal

1. Task Generationの二重buttonを一つへ統合する。
2. 全TaskのSidebar / Composerへcontrolを表示する。
3. state-based styling / copyへ更新する。
4. legacy create-and-play frontend commandを削除する。
5. legacy Mission Pilot Task作成route / schema / serviceを削除する。
6. temporary compatibility branch / rollout flagを削除する。

### Slice 7: Integrated acceptance

1. focused / integration / migration testを実行する。
2. stopped manual workflow E2Eを実行する。
3. create -> edit prompt -> Play -> Archive E2Eを実行する。
4. Stop -> edit -> resume / evidence invalidation E2Eを実行する。
5. process restart E2Eを実行する。
6. `bun run verify`を実行する。
7. runtime DB invariantを確認する。
8. 計画完了後に本書を`spec/archive`へ移す。

## 15. File plan

### 15.1 `shared`

- `shared/schemas/mission-pilot.schema.ts`
  - Task ref、authorization v3、non-null Task projection、structured Play error。
- `shared/schemas/nightworkers/repository-task.schema.ts`
  - Task response contract整合。

### 15.2 `api/modules/nightworkers`

- `task-creation.service.ts`（新規候補）
  - Task / Session atomic creation application boundary。
- `nightworkers.basic.service.ts`
  - manual / Worktree creation移行。
- `nightworkers.repository.ts`
  - low-level insertのvisibility整理。
- Task routes / service facade
  - TaskWithMissionPilot response。

### 15.3 `api/modules/missionPilot`

- `mission-pilot-provisioning.port.ts`（新規候補）
  - Task-based stopped Session作成。
- `mission-pilot.repository.ts`
  - empty prompt provisioning、activation snapshot、v3 claim。
- `mission-pilot.service.ts`
  - eligibility / latest Context / atomic Play。
- `mission-pilot-active-control.ts`（新規候補）
  - active-control predicate / assertionの共通化。
- `mission-pilot.routes.ts`
  - create variant route削除、Play error contract更新。
- `mission-pilot-taskization.port.ts`
  - producer移行後に削除。

### 15.4 Task producers

- `api/modules/taskGeneration/task-generation.repository.ts`
- `api/modules/taskGeneration/task-generation.service.ts`
- `api/modules/mission-planner/mission-planner.service.ts`
- `api/modules/project-evaluation/project-evaluation.service.ts`
- `api/modules/quality/quality.service.ts`

すべてcommon Task creation boundaryへ移行する。

### 15.5 `src`

- `src/modules/taskGeneration/TaskGenerationPanel.tsx`
- `src/modules/taskGeneration/components/TaskGenerationTreeRow.tsx`
- `src/modules/taskGeneration/components/TaskGenerationCandidateDialogs.tsx`
  - Mission Pilot variant作成action削除。
- `src/modules/missionPilot/components/MissionPilotCreateButton.tsx`
  - caller消滅後に削除。
- `src/modules/missionPilot/missionPilotCommands.ts`
  - create variant command削除。
- `src/modules/nightworkers/components/ProjectSidebar.tsx`
- `src/modules/nightworkers/components/ThreadWorkspaceBody.tsx`
- `src/modules/missionPilot/components/MissionPilotControlPanel.tsx`
  - 全Task表示、eligibility / state-based表示。
- `src/modules/nightworkers/types/core.ts`
  - non-null Mission Pilot型。
- `src/i18n/dictionaries/ja.ts` / `en.ts`
  - variant copy削除、state copy追加。

### 15.6 Migration / tests

- `drizzle/migrations/<next>_mission_pilot_universal_tasks.sql`
- `tests/mission-pilot-universal-task-model.test.ts`（新規候補）
- `tests/mission-pilot-service.test.ts`
- `tests/mission-pilot-repository.test.ts`
- Task producer service / route tests。
- `tests/project-sidebar.test.tsx`
- `tests/useNightWorkersWorkspace.test.tsx`
- `tests/e2e/mission-pilot-universal-task.spec.ts`（新規候補）
- 既存`tests/e2e/mission-pilot-entry.spec.ts`はvariant作成前提を統一entryへ置換する。

## 16. Verification plan

### 16.1 Deterministic focused tests

```bash
bun run test run \
  tests/mission-pilot-universal-task-model.test.ts \
  tests/mission-pilot-service.test.ts \
  tests/mission-pilot-repository.test.ts \
  tests/mission-pilot-contract.test.ts \
  tests/project-sidebar.test.tsx \
  tests/useNightWorkersWorkspace.test.tsx
```

期待結果:

- すべてのTask producerがnon-null Sessionを返す。
- Task / Sessionの片方だけがcommitされない。
- stopped Taskは自動stepを開始しない。
- Play時だけauthorization v3が作られる。
- latest Task Contextがactivationへ固定される。
- duplicate Play / response lossで二重message / runを作らない。

### 16.2 Migration tests

1. fresh DBへ全migrationを適用する。
2. Session無しTask、既存stopped Session、existing playing v2 Session、terminal Taskを含むfixture DBへ適用する。
3. migrationを再実行してrow数が増えないことを確認する。
4. 既存Sessionのphase / version / error / authorization JSONが不変であることを比較する。
5. `tasks_without_session=0`を確認する。

### 16.3 API / integration tests

各作成routeについて次を確認する。

- responseにnon-null `missionPilot`がある。
- `desiredState=stopped`。
- authorization / activeRunId / nextWakeAtがない。
- Play前にQueue / runが作られない。
- prompt編集後のPlayが編集後内容を送る。

手動workflowについて次を確認する。

- stopped Taskで通常WorkBench intakeが動く。
- stopped Taskでmanual Plan / Queue / Test / Reviewが動く。
- playing Taskでduplicate manual actionが拒否またはidempotentになる。
- Sessionが存在するだけでPilot run associationされない。

### 16.4 Browser E2E

```bash
bun run test:e2e -- tests/e2e/mission-pilot-universal-task.spec.ts
```

Scenario A: manual Task

1. SidebarからTaskを作成する。
2. Task row / ComposerにPlayがある。
3. Taskはstoppedで、通常Chatを送信できる。
4. 自動Plan / Queue / runが始まらない。

Scenario B: Candidate Task

1. Task GenerationでCandidateをTask化する。
2. variant選択buttonがない。
3. 作成直後はstopped。
4. 初期プロンプトを編集する。
5. Playすると編集後promptでMission Pilotが開始する。

Scenario C: full lifecycle

1. Taskを作成してPlayする。
2. pre-Queueからpost-Queueへ進む。
3. Test / Review / closeout gateを通る。
4. Taskがtrue archivedになる。
5. restart後も重複run / commit / Archiveを作らない。

Scenario D: Stop / resume

1. active phaseでStopする。
2. 新stepが開始されない。
3. Task fieldを変更する。
4. 再PlayでContext revisionまたはevidence invalidationが正しく行われる。

### 16.5 Repository gates

```bash
bun run typecheck
bun run check:docs
bun run verify
```

`bun run verify`の失敗が今回の変更と無関係な既知failureである場合は、focused acceptanceの結果と切り分けて記録する。今回の変更に起因するfailureを既知failureとして扱わない。

### 16.6 Live verification

deterministic E2E完了後にだけ、実providerを使う代表Taskを1件実行する。

- Task作成時にprovider callが発生しない。
- Play後にだけMission Pilotが開始する。
- initial promptが最新Task objectiveと一致する。
- phaseごとにRole Routerのprovider / model選択が使われる。
- Stop / restart / resume後に重複runを作らない。

live failureをdeterministic contract failureと混同しない。provider unavailableの場合はruntime evidenceを保存し、deterministic acceptanceを再評価しない。

## 17. Failure and recovery rules

| Failure | Required behavior |
| --- | --- |
| Task insert成功 / Session insert失敗 | transaction rollback、Taskを残さない |
| backfill途中crash | 再実行可能、既存Sessionを重複作成しない |
| prompt空でPlay | stopped維持、field付き400 |
| activation commit後response loss | retryでcurrent playing stateを返す、二重authorization / message禁止 |
| active manual runあり | 横取りせず409、manual runを停止しない |
| Queue ownership conflict | attentionまたは明示409、entryを削除しない |
| stopped Taskでgeneric event受信 | Pilot phaseを進めない |
| playing TaskでTask Context変更 | evidence invalidation / rework gate、silent digest差替え禁止 |
| terminal TaskでPlay | Reopen / new cycle要求、status rollback禁止 |
| missing Session検出 | integrity diagnostic、read request中の自動repair禁止 |

欠損Sessionの修復が必要な場合は、migrationと同じidempotent provisioning serviceを明示maintenance commandから実行する。通常GET requestやfrontend mountをrepair triggerにしない。

## 18. Rollout and compatibility

1. prerequisite完了を確認する。
2. backend schemaがv2 / v3 authorizationをread可能にする。
3. migrationで全TaskへSessionをbackfillする。
4. backend全producerをuniversal provisioningへ切り替える。
5. APIをnon-null contractへ切り替える。
6. frontendを全Task controlへ切り替える。
7. legacy create-and-play route / buttonを削除する。
8. nullable compatibility、temporary flag、dead translationを削除する。

deploy途中に旧frontendと新backendが混在する必要がある場合だけ短期compatibilityを設ける。local-first desktop / APIの同梱versionでは原則としてmigration、backend、frontendを同一releaseで切り替える。

RollbackはDBからSession rowを削除しない。新UI / producerを戻しても、停止中Sessionは無害なcompanion dataとして保持する。v3 authorizationを発行済みのplaying Taskがある場合は、先に安全にStopしてからapplication rollbackする。

## 19. Definition of Done

次をすべて満たした時だけ本計画を完了とする。

1. [x] `tasks_without_session = 0`。
2. [x] production Task作成経路にSessionを作らないpathがない。
3. [x] Task / Session atomicityがtestで固定されている。
4. [x] Task作成UIにMission Pilot variant選択がない。
5. [x] すべてのTaskでPlay / Stop controlが表示される。
6. [x] 作成直後はstoppedであり、自動runを開始しない。
7. [x] Play時にlatest Task Contextとauthorization v3が固定される。
8. [x] stopped Taskの手動workflowが維持される。
9. [x] playing TaskだけがPilot automationへ入る。
10. [x] Session存在だけに依存するmutation gateがない。
11. [x] legacy Mission Pilot Task作成route / command / buttonが削除されている。
12. [x] API / frontend型で`missionPilot`がrequiredになっている。
13. [x] startup backfill / restart相当のisolated server / browser代表検証が完了している。
14. [x] `bun run check:docs`、focused tests、browser E2Eが成功し、全体gateの既存failureが対象差分外として分離されている。
15. [x] 本書が完了状態へ更新され、`spec/archive`へ移されている。

### 19.1 Completion evidence（2026-07-12）

- local DB: `tasks=2 / sessions=2 / tasks_without_session=0`。
- production inventory: Task insertは`nightworkers.task-creation.service.ts`から低水準repositoryを呼ぶ一経路だけ。
- focused regression: 74 tests pass（Universal creation、Mission Pilot repository / service / contract、Mission Planner、Task Generation route、Project Evaluation、Qualityを含む）。
- full Vitest: 1955 / 1962 pass。今回のcontract変更で露出した2件は修正済み。残るPlan Mode QueryClient系3件と並列共有DB由来の既存failureは本計画の対象外で、focused再実行はpass。
- browser E2E: `tests/e2e/mission-pilot-entry.spec.ts` 1 pass。variant action不在、Task化後のstopped Session、再読み込み後のPlay controlを確認。
- `bun run check:docs`: pass。
- `bun run typecheck`: 本変更の型errorなし。既存`PlanModeWorkspaceViewer.tsx`のMermaid `module_load` union mismatch 1件のみ。
- `git diff --check`: pass。
