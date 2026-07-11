# Mission Pilot Plan Mode 進捗Projection・画面同期 実装計画

## Status

- Plan status: `completed`
- Investigation completed: 2026-07-11
- Implementation completed: 2026-07-11
- Implementation status: `completed`
- Previous completed plan: `spec/archive/mission-pilot-plan-mode-autonomy-implementation-plan.md`
- Target domain: `api/modules/missionPilot` / `src/modules/missionPilot` / `src/modules/planMode`
- Target runtime span: Questionnaire確定後のPlan Artifact生成開始から、Feature Plan生成・plan review終了までの画面反映

この文書を、Mission PilotのPlan Mode自動生成でbackend上は正しく進んでいるArtifact生成・永続step・review phaseを、既存Plan Mode WorkspaceのStatusと生成済みタブへ即時かつ回復可能に反映するための実装正本とする。

Artifactの生成順、生成prompt、Artifact schema、self-review判定、改訂内容、Queue admissionは変更しない。今回扱うのは、既に正しく保存されている状態を画面へ投影する経路だけである。

### Completion evidence

- `mission_pilot_steps`のread-only projectionとOpenAPI routeを追加した。
- step synchronization / claim / complete / fail / adoptとphase変更後にtyped progress eventを発行する。
- Plan Mode WorkspaceとMission Pilot progressをtask ID単位のReact Queryへ統合した。
- Artifact message受信とWebSocket再接続でmessages / workspace / progressを再取得する。
- Statusはpersisted stepを優先し、running / completed / failed、phase、lastErrorを表示する。
- 実SQLiteの対象runに対して新endpointが6 stepと`attention`理由を正しく返すことを確認した。
- focused tests 79件、typecheck、docs check、`bun run verify`、deterministic Mission Pilot Playwright E2Eが成功した。

## 1. 確認済みの問題

2026-07-11の実行 `task=ab281cb2-505e-45a8-9712-b13bdef609b9` では、DB上の生成は次の順で完了していた。

```text
1. Questionnaire         completed
2. Blueprint             22:40:17 -> 22:41:43 completed
3. Data Model            22:41:43 -> 22:42:52 completed
4. User Flow             22:42:52 -> 22:43:06 completed
5. API Contract          22:43:06 -> 22:44:15 completed
6. Feature Plan          22:44:15 -> 22:44:52 completed
```

しかし同じ時点の画面は、次の矛盾した状態を表示した。

- BlueprintはStatus上で完了。
- Data Modelタブは表示済みだが、Status上では未完了。
- User FlowとAPI Contractは生成済みだが、Status上では未完了で、タブも非表示。
- Feature Planは生成・改訂済みだが、画面上は全工程完了にならない。
- Mission Pilotがどの番号を実行中かを示すspinnerやrunning表示がない。
- plan reviewが`attention`で停止しても、番号付き生成工程の状態と停止理由が同じ画面で整合しない。

### 1.1 直接原因

1. `mission_pilot_steps`は`pending / running / completed / failed`を永続化するが、step更新イベントや取得APIを持たない。
2. Artifact作成時の`task_message_created`は発行されるが、frontendは`taskMessages`だけを更新し、`planModeWorkspace`を更新しない。
3. `planModeWorkspace` Queryのinvalidateは`design_questionnaire_ready`だけに限定されている。
4. `PlanModeWorkspaceViewer`はReact Queryとは別にlocal `workspace` stateを持ち、mount時と手動生成完了時を中心にしかrefreshしない。
5. Mission Pilot backend coordinatorは手動生成用`runAction`を通らないため、`busyAction`、local workspace更新、生成後refreshが動かない。
6. Data Modelタブは`taskMessages`由来のmessageでも表示できる一方、Statusはlocal workspaceだけを参照する。
7. User Flow / API Contractタブは`workspace.dedicatedViewArtifacts`を必須とするため、古いworkspaceでは生成済みでも表示されない。
8. WebSocket再接続時とwindow focus時のworkspace回復refetchがない。
9. backend step、realtime effect、workspace Query、Status描画を一続きで検証するintegration testがない。

## 2. 目的

Mission PilotがPlan Artifactを自動生成している間、利用者がPlan Mode Workspaceを開いたままでも、次をreloadなしで確認できる状態にする。

1. 現在実行中の番号とArtifact名。
2. 完了した番号のcheck表示。
3. 生成直後に追加されるArtifactタブ。
4. failed stepとその停止状態。
5. Artifact生成後の`reviewing_plan / revising_plan / attention / queued` phase。
6. WebSocket切断・再接続や画面再表示後に、DBの最新状態へ自己回復した表示。

## 3. 成功条件

次をすべて満たしたとき、本計画を完了とする。

1. `mission_pilot_steps`を正本に、各Plan stepの`pending / running / completed / failed / skipped`をfrontendが取得できる。
2. Mission Pilotのstep claim、complete、fail、adopt後にtyped realtime eventが発行される。
3. realtime eventを取り逃しても、REST refetchで最新状態を復元できる。
4. Plan Mode Workspaceのfrontend cacheは同じtask IDについて一つのQueryを正本とする。
5. `PlanModeWorkspaceViewer`がReact Queryと別の長寿命workspace snapshotを保持しない。
6. 手動生成とMission Pilot自動生成が同じworkspace Queryへ収束する。
7. Artifactの`task_message_created`受信後、対応するworkspace Queryが更新される。
8. Data Model生成後、Data ModelタブとStatus完了表示が同じrenderで整合する。
9. User Flow生成後、User FlowタブとStatus完了表示がreloadなしで現れる。
10. API Contract生成後、API ContractタブとStatus完了表示がreloadなしで現れる。
11. Feature Plan生成後、仕様書stepがreloadなしで完了になる。
12. running stepにはspinnerと実行中表示が出る。
13. failed stepには失敗表示が出て、完了checkに見えない。
14. `reviewing_plan / revising_plan / attention`を番号付きArtifact生成とは別のphase表示として確認できる。
15. `attention`時は既存`lastError`を表示し、Artifact未生成に見せない。
16. generated-only tab policyを維持し、未生成のUser Flow/API Contractタブを先に表示しない。
17. omitted / disabled stepをpendingまたはfailedとして表示しない。
18. 通常Plan Modeの手動生成と「順次自動生成」に回帰がない。
19. WebSocket再接続後、task messages、workspace、plan progressが再取得される。
20. focused tests、typecheck、docs check、`bun run verify`が成功する。

## 4. Locked Decisions

1. Artifact生成順は変更しない。
2. `shared/plan-mode-execution.ts`のstep orderingを維持する。
3. Artifact generator、prompt、schema、provider routingを変更しない。
4. self-reviewのverdict、revision target、最大試行回数を変更しない。
5. Queue admission条件を変更しない。
6. 永続的な実行状態の正本は`mission_pilot_steps`とする。
7. Artifactがナビゲーション可能かどうかの正本は、再取得済み`PlanModeWorkspace.dedicatedViewArtifacts`とする。
8. realtime eventは更新通知であり、唯一の正本にしない。
9. reconnect、reload、別windowからの操作後はREST projectionでDB状態へ収束させる。
10. Plan Mode Workspaceのfrontend正本はtask IDをkeyにしたReact Query cacheとする。
11. Viewer内部に、Queryと独立して長期間残るworkspace copyを持たない。
12. API responseにworkspaceが含まれる手動生成経路も、local stateへ直接閉じず同じQuery cacheへ書き込む。
13. `taskMessages`だけからUser Flow/API Contractタブを作るfallbackは追加しない。generated-only tab policyを弱めず、workspace更新を正す。
14. `busyAction`は手動操作の一時状態として残すが、Mission Pilot実行中表示の正本にはしない。
15. Mission Pilot専用画面を新設しない。既存Statusと既存タブへ投影する。
16. Chat本文、表示文言、keyword、正規表現からstep種別や完了状態を推測しない。
17. prompt文言を変更する場合は日本語を維持するが、本計画ではprompt変更を予定しない。
18. pollingを通常更新の主経路にしない。realtime invalidateと明示的recovery refetchを使う。
19. DB migrationは追加しない。既存`mission_pilot_steps`をprojectionする。
20. 表示上の成功ではなく、DB step・workspace・画面が一致したことを完了条件にする。

## 5. Scope

### 5.1 含む

- Mission Pilot plan progressのshared response schema。
- task単位のplan progress REST endpoint。
- step start / complete / fail / adopt後のtyped realtime event。
- Plan Mode Workspace Queryの共有key・共有hook。
- Viewer local workspace stateの解消。
- Artifact message受信時のworkspace invalidate。
- Mission Pilot progress event受信時のprogress cache更新。
- WebSocket reconnect recovery。
- Statusのpending / running / completed / failed / skipped描画。
- Status上のMission Pilot phase・lastError表示。
- generated-only tabの即時更新。
- manual generationとMission Pilot generationの表示経路統合。
- focused backend/frontend/integration/E2E tests。

### 5.2 含まない

- Artifact生成順の変更。
- Artifact本文、Mermaid、OpenAPI、Feature Planの品質改善。
- Questionnaireの質問・回答生成変更。
- review指摘やrevision targetの改善。
- review試行回数の変更。
- Queue投入・Implementation開始の変更。
- Test Mode / Review Mode自律進行。
- Mission Pilot専用dashboard。
- Timelineへの新しい進捗カード追加。
- `task_messages`をstep状態の正本にすること。
- 通常Plan ModeのlocalStorage preference削除。

## 6. Target Contract

### 6.1 Plan progress response

`shared/schemas/mission-pilot.schema.ts`または責務を分けた`shared/schemas/mission-pilot-plan-progress.schema.ts`に、次のprojectionを定義する。

```ts
type MissionPilotPlanProgress = {
  taskId: string;
  sessionId: string;
  phase: string;
  desiredState: "playing" | "stopped";
  version: number;
  contextRevision: number;
  currentStepKey: string | null;
  steps: Array<{
    key: string;
    ordinal: number;
    kind: "questionnaire" | "blueprint" | "data_model" | "dedicated_view" | "feature_plan";
    view: string | null;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    attempt: number;
    artifactMessageId: string | null;
    lastError: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  lastError: string | null;
  updatedAt: string;
};
```

Rules:

- `steps`は`ordinal ASC`で返す。
- `currentStepKey`は最初の`running` stepとし、なければ`null`。
- Sessionは存在するがstep同期前の場合、`steps=[]`を正常値として返す。
- Mission Pilot Sessionが存在しない通常Taskでは`null`を返す。
- frontendは表示labelを既存`formatViewLabel`と共有し、backendから日本語labelを返さない。
- failed stepの`lastError`は内部stack traceではなく保存済みの短いerror messageとする。

### 6.2 REST endpoint

追加するendpoint:

```text
GET /api/mission-pilot/tasks/:taskId/plan-progress
```

Ownership:

- route: `api/modules/missionPilot/mission-pilot.routes.ts`
- service projection: `api/modules/missionPilot/mission-pilot-plan-progress.service.ts`
- persistence read: `api/modules/missionPilot/mission-pilot-plan.repository.ts`

このendpointは生成を開始・再開しない。現在のDB状態をread-only projectionとして返す。

### 6.3 Realtime event

追加するevent:

```ts
{
  type: "mission_pilot.plan_progress_updated";
  payload: {
    taskId: string;
    progress: MissionPilotPlanProgress;
  };
}
```

発行点:

1. step synchronization完了後。
2. `claimPlanStep()`成功後。
3. `completePlanStep()`成功後。
4. `failPlanStep()`成功後。
5. `adoptPlanStepArtifact()`成功後。
6. plan phaseが`reviewing_plan / revising_plan / attention / queued`へ変わった後。

EventはDB mutation成功後にだけ発行する。repository内部から直接brokerへ依存させず、Mission Pilot service/coordinator境界で最新projectionを読み、publishする。

### 6.4 Workspace Query

task IDごとに次のkeyを唯一のworkspace keyとして共有する。

```ts
["planModeWorkspace", taskId]
```

`useNightWorkersWorkspace`と`PlanModeWorkspaceViewer`が同じquery options / hookを使う。

Rules:

- Viewer mount時は既存cacheを使い、staleならfetchする。
- manual generate responseに`workspace`がある場合は`queryClient.setQueryData()`へ書き込む。
- response後もinvalidate/refetchしてserver projectionへ収束させる。
- Mission Pilot Artifactの`task_message_created`受信時は該当taskのworkspaceをinvalidateする。
- Questionnaire、Blueprint、Data Model、dedicated view、API Contract、Zod Schema、Feature Plan、verification sidecarをmetadata/message typeで構造的に判定する。
- message本文のkeyword判定は使わない。
- websocket reconnect時はactive taskの`taskMessages`、`planModeWorkspace`、`missionPilotPlanProgress`をinvalidateする。

## 7. UI Behavior

### 7.1 Status step

`PlanWorkspaceStatusView`は通常TaskとMission Pilot Taskを次のように扱う。

- 通常Task: 現在どおりArtifact存在と`busyAction`から状態を導出する。
- Mission Pilot Task: persisted `MissionPilotPlanProgress.steps`を優先する。
- progress未取得中: 古い完了状態を未完了へ戻さず、workspace由来表示にloading hintを重ねる。
- `running`: spinner、`生成中`、対応actionをdisabled。
- `completed`: check、`作成済み`、生成済みなら再生成label。
- `failed`: error style、短いerror、完了checkなし。
- `skipped`: Statusから非表示、または既存decision summaryでomitとして表示。
- `pending`: 番号と作成actionを維持。

### 7.2 Artifact tabs

- Blueprint/Data Model/User Flow/API Contract/その他dedicated viewは、共有workspace Queryの最新`dedicatedViewArtifacts`から表示する。
- User Flow/API Contractをinclude decisionだけで先行表示しない。
- Artifact message event後にworkspace refetchが完了したrenderでタブを追加する。
- active tabは、新しいArtifactが増えても利用者の現在選択を勝手に奪わない。
- 手動生成で明示的に生成した場合だけ、現在の既存focus挙動を維持する。

### 7.3 Overall phase

番号付きArtifact stepとは別に、Status上部または末尾へ小さなMission Pilot phase表示を追加する。

- `generating_artifacts`: `Plan Artifactを生成しています`
- `reviewing_plan`: `実装計画をレビューしています`
- `revising_plan`: `レビュー指摘を反映しています`
- `attention`: `確認が必要です`と既存`lastError`
- `queued`: `Implementation Queueへ追加済みです`

raw phase codeだけを利用者へ表示しない。phase labelはfrontendの日本語定数またはi18n dictionaryで管理する。

## 8. Implementation Plan

### Phase 0. Baseline testを先に固定する

対象:

- `tests/mission-pilot-plan-pipeline.test.ts`
- `tests/nightworkers-realtime-effects.test.ts`
- `tests/plan-mode-workspace-viewer.test.tsx`
- `tests/specification-status-view.test.tsx`
- 必要なら新規`tests/mission-pilot-plan-progress.test.ts`

失敗するbaselineとして次を追加する。

1. Data Model message受信後、タブはあるがStatusがpendingに残る現状ケース。
2. User Flow/API Contract message受信後もworkspace Queryがinvalidateされないケース。
3. Mission Pilot stepがrunningでもStatus spinnerが出ないケース。
4. reconnect後もworkspaceがrefetchされないケース。

Gate:

```bash
bun run test -- tests/nightworkers-realtime-effects.test.ts tests/plan-mode-workspace-viewer.test.tsx tests/specification-status-view.test.tsx
```

### Phase 1. Plan progress projectionを追加する

対象:

- `shared/schemas/mission-pilot-plan-progress.schema.ts`
- `api/modules/missionPilot/mission-pilot-plan-progress.service.ts`
- `api/modules/missionPilot/mission-pilot-plan.repository.ts`
- `api/modules/missionPilot/mission-pilot.routes.ts`
- `api/modules/missionPilot/index.ts`
- `src/modules/missionPilot/missionPilotCommands.ts`
- `src/modules/missionPilot/index.ts`

作業:

1. shared schemaと型を追加する。
2. Sessionとstep rowsをread-only projectionへ変換する。
3. GET endpointを追加する。
4. 通常Task、step同期前、生成中、失敗、完了のresponse testを追加する。
5. endpointを呼んでもcoordinatorが開始されないことを確認する。

Gate:

```bash
bun run test -- tests/mission-pilot-plan-pipeline.test.ts tests/mission-pilot-contract.test.ts tests/mission-pilot-plan-progress.test.ts
```

### Phase 2. Step progress realtime eventを追加する

対象:

- `api/modules/missionPilot/mission-pilot-realtime.ts`
- `api/modules/missionPilot/mission-pilot-plan-coordinator.service.ts`
- `api/modules/missionPilot/mission-pilot-plan-progress.service.ts`
- `tests/mission-pilot-plan-coordinator.test.ts`
- `tests/services.realtime-broker.test.ts`

作業:

1. 最新projectionをpublishするhelperを追加する。
2. synchronize / claim / complete / fail / adopt / phase transition後に発行する。
3. DB更新前や失敗したmutationではeventを発行しない。
4. event payloadのstep順とstatusをschema parseする。
5. 同じ状態の重複eventをfrontendが安全に受けられることを前提にする。

Gate:

```bash
bun run test -- tests/mission-pilot-plan-coordinator.test.ts tests/services.realtime-broker.test.ts
```

### Phase 3. Workspaceを単一Queryへ統合する

対象:

- `src/modules/specification/specificationCommands.ts`
- 新規`src/modules/specification/planModeWorkspaceQuery.ts`
- `src/modules/specification/index.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeWorkspace.controller.ts`

作業:

1. workspace query key/options/hookを共通化する。
2. `useNightWorkersWorkspace`を共有Queryへ移す。
3. Viewerのlocal `workspace` stateを共有Queryへ置き換える。
4. `refresh()`をworkspace refetchとQuestionnaire refreshへ分離する。
5. manual generator responseはQuery cacheへ反映する。
6. `generatedMessages`はmessage描画の即時性に必要な場合だけ残し、workspace完了判定の別正本にしない。
7. active tab、export、artifact contextが共有workspace更新後も安定することを確認する。

Gate:

```bash
bun run test -- tests/plan-mode-workspace-viewer.test.tsx tests/artifact-workspace-viewer.test.ts tests/plan-mode-workspace-model.test.ts
```

### Phase 4. Realtime invalidationとrecoveryを接続する

対象:

- `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `src/modules/missionPilot/missionPilotCommands.ts`
- `tests/nightworkers-realtime-effects.test.ts`

作業:

1. Plan Artifact messageをmetadata/message typeから判定するpure helperを追加する。
2. 対象message受信時にworkspace Queryをinvalidateする。
3. progress event受信時にplan progress Queryを更新する。
4. `mission_pilot.updated`受信時は既存sessions更新を維持し、phase変更に応じてprogressをinvalidateする。
5. reconnect open時にactive taskのmessages/workspace/progressをinvalidateする。
6. reconnect中に作成されたArtifactが接続回復後に表示されるtestを追加する。

Gate:

```bash
bun run test -- tests/nightworkers-realtime-effects.test.ts tests/mission-pilot-service.test.ts
```

### Phase 5. Statusをpersisted progressへ接続する

対象:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/workspace-panels/PlanWorkspaceStatusView.tsx`
- `src/modules/planMode/workspace-panels/types.ts`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`
- `tests/specification-status-view.test.tsx`

作業:

1. ViewerからStatusへplan progressを渡す。
2. shared execution stepsとpersisted progressをstep keyでmergeするpure functionを追加する。
3. pending / running / completed / failed / skippedを描画する。
4. Mission Pilot running中は対応する手動actionの重複実行を防ぐ。
5. phaseとlastErrorをStatusへ表示する。
6. 通常Taskでは既存`busyAction`動作を維持する。
7. Data Modelタブだけ表示されStatusはpending、という分裂ケースを回帰testにする。

Gate:

```bash
bun run test -- tests/specification-status-view.test.tsx tests/plan-mode-workspace-viewer.test.tsx tests/artifact-workspace-viewer.test.ts
```

### Phase 6. 結合E2Eで番号ごとの反映を確認する

対象:

- `tests/e2e/mission-pilot-entry.spec.ts`
- 必要なら新規`tests/e2e/mission-pilot-plan-progress.spec.ts`
- `tests/live/mission-pilot-plan-pipeline-live.test.ts`

fixtureまたはcontrolled generatorで、次を確認する。

1. Blueprint running -> completed -> Blueprintタブ表示。
2. Data Model running -> completed -> Data Modelタブ表示。
3. User Flow running -> completed -> User Flowタブ表示。
4. API Contract running -> completed -> API Contractタブ表示。
5. Feature Plan running -> completed -> specタブ表示。
6. 各完了時に前stepがcheckになり、次stepだけがrunningになる。
7. active tabを勝手に切り替えない。
8. WebSocketを切断した間にstepを進め、再接続後に最新状態へ追いつく。
9. failed stepがcheckにならず、attentionとlastErrorが表示される。
10. page reload後もDBと同じ状態を表示する。

Gate:

```bash
bun run test:e2e -- tests/e2e/mission-pilot-plan-progress.spec.ts
```

実providerを使うlive testはArtifact本文品質ではなく、step eventと表示projectionの順序だけを確認する。通常のfocused testで決定的に検証できる内容をlive providerへ依存させない。

### Phase 7. Repository gateと文書closeout

Gate:

```bash
bun run typecheck
bun run check:docs
bun run verify
```

完了後:

1. 本書のsuccess conditionsを実装・test evidenceと照合する。
2. 未確認項目を`completed`扱いしない。
3. すべて満たした場合だけPlan statusを`completed`へ変更する。
4. 完了済み文書として`spec/archive/`へ移す。

## 9. Failure Handling

### Statusだけ更新され、タブが出ない

- progress eventは届いている。
- workspace Queryのinvalidate/refetchと`dedicatedViewArtifacts`を確認する。
- task message metadataがworkspace serviceでparse可能か確認する。
- include decisionだけからタブを作るfallbackは追加しない。

### タブは出るがStatusがpendingのまま

- workspace QueryとStatusへ渡したworkspaceが同一object chainか確認する。
- Viewer local stateが残っていないか確認する。
- persisted progressのstep keyとshared execution step keyの対応を確認する。

### runningが表示されない

- claim後のprogress event発行を確認する。
- plan progress endpointが`running` rowを返すか確認する。
- `busyAction`だけを見ていないか確認する。

### reconnect後も古い

- socket open時のactive task invalidateを確認する。
- query keyのtask ID不一致を確認する。
- event再送を必須にせずREST refetchで回復できることを確認する。

### failedがcompletedに見える

- Artifact存在とstep完了を混同していないか確認する。
- Mission Pilot Taskではpersisted step statusを表示上優先する。
- 古いArtifactがあっても最新stepがfailedなら、再生成失敗をfailedとして表示する。

## 10. Review Checklist

- [ ] 生成順、generator、promptに変更が入っていない。
- [ ] review/Queue契約に変更が入っていない。
- [ ] `mission_pilot_steps`がprogressの正本である。
- [ ] progress endpointはread-onlyである。
- [ ] mutation成功後だけprogress eventを発行する。
- [ ] frontend workspace Queryがtask IDごとに一つである。
- [ ] Viewerに独立した長寿命workspace stateが残っていない。
- [ ] Artifact message受信でworkspaceが更新される。
- [ ] reconnectでmessages/workspace/progressが回復する。
- [ ] Data ModelのタブとStatusが同時に整合する。
- [ ] User Flow/API Contractタブは生成後だけ表示される。
- [ ] running / completed / failedが区別される。
- [ ] attentionとlastErrorが表示される。
- [ ] 通常Plan Modeの手動生成に回帰がない。
- [ ] integration testがeventからrenderまで確認する。
- [ ] `bun run verify`が成功する。

## 11. 完了条件

本計画は「APIが正しいJSONを返した」だけでは完了しない。Mission Pilotの実行中にPlan Mode Workspaceを開いたまま、番号2から6までがDBの実stepと一致して順次`running -> completed`へ変化し、対応Artifactタブが生成後に現れ、切断・再接続後も最新状態へ戻ることを確認して初めて完了とする。
