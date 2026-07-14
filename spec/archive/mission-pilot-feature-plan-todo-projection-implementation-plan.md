# Mission Pilot Feature Plan Todo Projection 実装計画

## Status

- Plan status: `completed-archived`
- Document review: `accepted_after_revision`
- Implementation completed: 2026-07-14
- Archived: 2026-07-14
- Archive decision: Todo projection実装の領分ではDone。repo-wide gateの対象外並行変更は本計画のarchive blockerに含めない。
- Focused verification: `7 files / 42 tests + Mission Pilot regression 4 files / 37 tests + check:docs passed`
- Repository gate: `blocked by concurrent out-of-scope agent-mode session / usage-accounting changes (schema-task-execution.ts size, typecheck, lint)`
- Document created: 2026-07-14
- Last reviewed: 2026-07-14
- Review-time compatibility evidence: projection metadataを必要とする`queued + claim_ready=0`のMission Pilot rowは0件
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Target runtime span: reviewed Feature PlanのQueue handoff確定から、Repository Bootstrap完了後の通常Implementation Run作成まで
- Triggering incident:
  - Task: `d5ff9682-2654-448f-9b47-ecd2a873dc5b` / `todolist 本体を実装する`
  - Mission Pilot Session: `4343865a-117d-4cc4-acac-c419a7d16bfe`
  - Bootstrap Run: `f23ad05c-8057-4a5d-a07c-996581decd2a`
  - Implementation Run: `170daffa-51b2-46a1-a7cd-639a134e3713`
  - reviewed Feature PlanはDB、API、UI、test、verificationの実装順とAC-001〜006を保持していた。
  - Bootstrap完了後のQueue drainは`initialTodos`を渡さず通常Runを開始した。
  - Codex SDK laneの既定Todoが選ばれ、`compiledPromptText`先頭160文字から作られた汎用Todoだけが保存された。
  - Agentは`read_current_specification`を実行したが、`todo_list`は`list`と`done`のみで、Feature Planに基づく`replace`を実行しなかった。

この文書を、review済みFeature Planの実装計画を通常Implementation Runの中間Todoへ投影し、既存の固定Todo gateを変更せずに実装内容を永続化するための実装正本とする。

## 1. 問題

### 1.1 Feature PlanとTodoListが別経路になっている

`buildCompiledPromptText()`は最新のFeature Planを`<IMPLEMENTATION_HANDOFF>`として通常Runへ渡す。そのためAgentのmodel contextにはMission Goal、Task Candidate、実装計画、完了条件が残る。

一方、`task_run_todos`はFeature Planから作られない。Implementation Queueは`startTaskRun()`へ`initialTodos`を渡さず、runtime laneの既定Todo生成へフォールバックする。

Codex SDK laneでは次の1件だけが中間Todoになる。

- title: `対象変更を確認して実装する`
- description: `compiledPromptText`を空白へ圧縮し、先頭160文字で切った文字列

このため、Agentのpromptとユーザーが見るTodoListで作業の正本が分かれている。

### 1.2 `read_current_specification`はTodoを更新しない

`read_current_specification`はFeature Planとassembled design contextを返すread-only toolである。Todo更新は`todo_list operation=replace`という別のAgent判断に依存する。

現在のruntime promptは、仕様を読んだ後に必ずTodoを再構成する契約ではない。また`replace`は構造変更時だけ使うよう制限されているため、Agentが汎用Todoのまま実装へ進める。

### 1.3 Bootstrapと通常実装の分離は正しいが、handoffが不完全である

Repository Bootstrap Runが通常機能を実装しないこと自体は正しい。Bootstrapはimport、Git HEAD、baseline、workspace準備だけを担当し、完了後にheld Queue rowを解放する。

不足しているのは、解放後に作る通常Implementation Runへ、review済みFeature Planの実装ステップを渡す処理である。Bootstrap RunのTodoへ実装作業を混ぜる修正は行わない。

### 1.4 nullableなMission Pilot envelopeがfail-openになる

`getMissionPilotImplementationEnvelope()`はSessionまたはhandoffが不整合な場合に`null`を返す。Queue drainは`null`でも通常Runを開始するため、本来Mission Pilot handoffを必要とするTaskが通常タスクとして汎用Todoで走る可能性がある。

Todo projection欠落も同じfail-openにすると、今回の問題を再発させる。

## 2. 目的

次の状態を完成させる。

```text
Feature Plan structured implementation plan（single source）
  -> backendがFeature Plan Markdownの実装計画をrender
  -> 同じstructured planからimplementation Todoをproject
  -> Plan review pass
  -> Queue handoffへreview済みplanのpointer + digestを固定
  -> 必要ならRepository Bootstrap
  -> held Queue rowをrelease
  -> canonical planをinitialTodosへprojectして通常Implementation Runを作成
  -> standard Todo builderが固定gateの間へ実装Todoを差し込む
```

TodoList全体を後から置換するのではなく、Run作成時に固定gateと実装ステップを一度だけ組み立てる。

## 3. 成功条件

1. `mission_pilot_admission_key`を持つreviewed Feature Plan経路では、通常Implementation Run作成時点でFeature Plan由来の実装Todoが保存されている。
2. `coding_preparation`、`quality_gate_verify`、`final_completion_report`のtitle、description、procedure、evidence contractを変更しない。
3. Feature Plan由来Todoは固定first gateと固定final gatesの間だけに入る。
4. Repository Bootstrap RunにはFeature Plan由来Todoを入れない。
5. Bootstrap完了後の通常Runは、Agentの`todo_list replace`に依存せず正しいTodoで開始する。
6. Planなしの直接実装Taskでは、既存runtime laneの既定Todoを維持する。
7. Test Modeの作業、広域test実装、verify、closeoutをImplementation Runの投影Todoへ重複追加しない。
8. DB変更が必要なPlanでは、既存`DB migration を実行する`固定gateが実装Todoの後、verifyの前へ入る。
9. Queue handoffのFeature Plan message ID、Context revision/digest、review ID、implementation plan digestが一致する。
10. `mission_pilot_admission_key`があるQueue rowでは、stale、missing、invalidなplanを通常Runとしてfail-openさせない。
11. Queue再試行、process再起動、Implementation Run再開でTodoを再生成せず、保存済みsource pointer / digestへ収束する。
12. Feature Plan correction後は、古いFeature Planのimplementation planを使用しない。
13. Todo projectionのための追加Artifactや追加LLM callを増やさない。
14. user promptのkeywordまたは正規表現でTodo種別や手順を分類しない。
15. provider層へMission Pilot固有のSystemContext、Todo判断、workflow分岐を追加しない。
16. focused tests、`bun run check:docs`、`bun run verify`が成功する。

## 4. Locked Decisions

### 4.1 更新対象は中間の実装Todoだけ

既存の標準Todo builderが持つ次の固定gateを維持する。

1. `coding_preparation`
2. optional `data_migration.apply_migration`
3. `quality_gate_verify`
4. `final_completion_report`

Feature Plan由来Todoは`coding_preparation`の後、optional migration gateとfinal gatesの前へ差し込む。

Codex SDK laneの`対象変更を確認して実装する`は、PlanがないTask用のfallback implementation Todoとして残す。review済みFeature PlanがあるMission Pilot Runだけ、fallbackの代わりに投影Todoを`initialTodos`へ渡す。

### 4.2 TodoList全体の`replace`を自動実行しない

通常経路では`todo_list operation=replace`を使わない。`startTaskRun()`が既に受け取れる`initialTodos`を使用し、`buildStandardImplementationTodoList()`に固定gateと一緒に初期保存させる。

これにより次を避ける。

- 固定gate rowの不要な再作成。
- 進行済みstatusの上書き。
- runtime開始後のTodo flicker。
- Agentが`replace`を呼ぶかどうかによる挙動差。

### 4.3 Feature Planの実装計画をsingle sourceにする

Feature Plan Markdownの自由記述とTodo projectionを別々に生成しない。Feature Plan生成のstructured outputでは、production変更を表す`implementationPlan`を唯一の正本とし、本文templateには実装計画placeholderを正確に1件だけ返させる。

backendは`implementationPlan`から`## 実装計画`を決定的にrenderしてplaceholderへ差し込み、同じ`implementationPlan.steps`からImplementation Todoをprojectする。Markdownのregex / keyword解析と、LLMが返した二つの表現の一致判定は行わない。

通常のFeature Plan生成とfocused Feature Plan correctionは同じ`generateFeaturePlanArtifact()`を通るため、どちらも同じschemaと保存経路を使用する。

### 4.4 Implementation Modeの責務だけを投影する

投影Todoに含めるもの:

- target repositoryのinspection後に行うproduction source変更。
- scaffold後に必要なDB、API、UI、domain logic、configuration変更。
- production変更と不可分な局所確認。

投影Todoに含めないもの:

- `coding_preparation`。
- Test Modeが担当する新規test suiteや広域test coverage。
- `quality_gate_verify`。
- `final_completion_report`。
- Review Mode、Archive、Project Evaluation。

Feature Plan本文のtest / verification項目はVerification Documentと後段Test Modeの入力として維持し、Implementation Todoへ複製しない。

### 4.5 Queue handoffでreview済みsource pointerを固定する

Feature Plan message metadataは生成時のcanonical implementation planを保持する。Queue admission時に、passing reviewが参照する正確なFeature Plan messageからplanを読み、`queue_handoff_json`へsource message ID、schema version、digestだけを固定する。

`task_messages`はこの経路ではappend-only sourceとして扱う。Queue drainはworkspaceの最新Artifactを再検索せず、handoffのexact pointerからmessage metadataを読み、digestを再検証してTodoへprojectする。handoff JSONへstepsを複製して二つのsnapshotを持たない。

### 4.6 Mission Pilot経路はadmission keyで判定してfail closedにする

全Taskが停止状態を含むMission Pilot Sessionを持ち得るため、Sessionの存在や`desiredState`だけでMission Pilot Queue経路を判定しない。claimed Queue rowの`mission_pilot_admission_key`を判定境界にする。

- admission keyが`null`: 通常Queue経路。既存default Todoを維持する。
- admission keyが非`null`: Mission Pilot経路。Session handoffの`admissionKey`、`queueEntryId`、Context、review、Feature Plan pointerがすべて一致しなければfail closedにする。

resolverは次のdiscriminated resultを返す。

```ts
type MissionPilotImplementationStartResolution =
  | { kind: "not_mission_pilot" }
  | { kind: "ready"; envelope: MissionPilotEnvelope; implementationPlan: ResolvedImplementationPlan }
  | { kind: "blocked"; code: string; message: string };
```

resolverはTask IDではなくclaimed Queue entryを受け取る。`blocked`ではTaskRunを作らず、同じQueue rowを再開可能なholdへ戻し、Mission Pilot Sessionへ診断を保存して`attention`へ停止する。

## 5. Scope

### 5.1 含む

- Feature Plan structured outputへのcanonical implementation plan追加。
- canonical planからFeature Plan実装計画sectionをrenderする処理。
- 共有Zod schemaとTypeScript contract。
- Feature Plan message metadataへのcanonical implementation plan保存。
- Queue handoff JSONへのreview済みimplementation plan pointer / digest追加。
- Mission Pilot implementation start resolver。
- Queue drainから`initialTodos`と、既存Todo builderが認識するmigration markerを渡す処理。
- Run context / phase-run evidenceへのimplementation plan provenance保存。
- Bootstrap後のheld Queue resume。
- direct Queue start、restart recovery、retryの同一経路化。
- focused backend tests、isolated SQLite integration、Mission Pilot E2E回帰。

### 5.2 含まない

- 固定Todo gateの文言、順序、procedure、evidence要件の変更。
- `todo_list` worker toolの全面再設計。
- PlanなしTaskの既定Todo変更。
- Repository Bootstrap Runへの通常実装統合。
- Bootstrap final reportのUI表示変更。
- Plan review回数、Artifact correction回数、score thresholdの変更。
- Feature Plan以外のPlan Artifact追加。
- Test Mode / Review Mode / Archive Modeのworkflow変更。
- Markdown本文のregex / keyword解析。
- provider adapterのTodo判断。
- 実行開始済みRunのTodo自動書き換え。
- Todo projection専用の新規frontend view。

## 6. Target Contract

### 6.1 Shared schema

`shared/schemas/feature-plan-implementation-plan.schema.ts`を追加する。

```ts
const featurePlanImplementationTodoStepSchema = z.object({
  key: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4_000),
  taskType: z.enum(["scaffold", "implementation"]),
  dependsOnKeys: z.array(z.string().min(1).max(120)).default([]),
});

const featurePlanImplementationPlanSchema = z.object({
  version: z.literal(1),
  requiresDataMigration: z.boolean(),
  steps: z.array(featurePlanImplementationTodoStepSchema).min(1).max(20),
});
```

Validation rules:

1. `key`はimplementation plan内で一意。
2. dependencyは同じimplementation plan内の既知keyだけを参照する。
3. dependencyは表示順上の先行stepだけを参照し、dependency graphは循環しない。
4. fixed gate titleまたはreserved procedureをstepとして返せない。
5. `test`、`verification`、`completion_report` task typeを受理しない。
6. planは1件以上のproduction implementation stepを持つ。

### 6.2 Feature Plan output

`specificationDocumentDraftSchema`を次へ拡張する。

```ts
z.object({
  title: z.string().min(1),
  contentTemplate: z.string().min(1),
  implementationPlan: featurePlanImplementationPlanSchema,
});
```

Feature Plan system promptは日本語を維持し、次を指示する。

- `contentTemplate`には`{{IMPLEMENTATION_PLAN}}`を正確に1件だけ置き、`## 実装計画`を別途書かない。
- production変更は`implementationPlan`にだけ入れる。
- DB / API / UI等、実装者が順番に完了判定できる粒度にする。
- test / verification / closeoutは`implementationPlan`へ入れず、既存の別sectionへ書く。
- `dependsOnKeys`で実装順を表す。
- DB schema / migration変更がある場合だけ`requiresDataMigration=true`にする。
- TaskやQuestionnaireにない作業をTodo化しない。

backendはplaceholderが0件または複数ならschema contract failureとしてrejectする。`renderFeaturePlanImplementationSection()`はheading、番号、title、description、dependencyをcanonical planから決定的に生成し、差し込み後の本文へ既存sanitizationとverification sidecar処理を適用する。

### 6.3 Feature Plan message metadata

`intent: "feature_plan"`のmessage metadataへ次を保存する。

```ts
implementationPlan: {
  version: 1,
  requiresDataMigration: true,
  steps: [...],
  digest: "sha256:..."
}
```

digestはcanonical implementation planの正規化JSONからbackendで計算する。LLMにdigestを生成させない。

### 6.4 Queue handoff reference

既存`queue_handoff_json`へ次を追加する。

```ts
{
  implementationTodoProjectionVersion: 1,
  implementationPlanSourceMessageId: string,
  implementationPlanDigest: "sha256:..."
}
```

Queue admission時に以下を検証する。

1. passing reviewの`featurePlanMessageId`とimplementation plan sourceが一致する。
2. review、Session、handoffのContext revision/digestが一致する。
3. message metadataのimplementation planがschema-validである。
4. implementation plan digestが再計算値と一致する。
5. review対象Feature Planが最新routing revisionに属する。

`implementationPlanSourceMessageId === featurePlanMessageId`を必須とする。別messageへのfallbackや、handoff後のsource差し替えは許可しない。

### 6.5 Run start / persisted context

実装では`StartTaskRunOptions`を拡張しない。Mission Pilot resolverが`requiresDataMigration=true`を確認した場合、既存Todo builderが認識する予約済みmigration markerを`initialTodos`へ含める。builderはmarker自体を実装Todoから除外し、既存の`data_migration.apply_migration`固定gateを正規位置へ1件だけ挿入する。

provenanceとmigration hintは既存`runtimeOptionsPatch.missionPilot` envelopeへ保存する。

```ts
{
  missionPilot: {
    requireDataMigrationGates: boolean;
    implementationPlanProvenance: {
      sourceMessageId: string;
      digest: string;
      version: 1;
    };
  };
}
```

`requiresDataMigrationFromRun()`はlegacyのtop-level hintに加えて`contextSnapshot.missionPilot.requireDataMigrationGates`を読む。これによりruntime中に正当なTodo mutationが起きても既存migration fixed gateを維持する。

## 7. Runtime Flow

### 7.1 Feature Plan生成・修正

1. `generateFeaturePlanArtifact()`がcontent templateとcanonical implementation planを同じstructured callで受け取る。
2. schema、placeholder count、dependency graphを検証する。
3. implementation plan digestを計算する。
4. canonical planからFeature Planの`## 実装計画`をrenderする。
5. Feature Plan message metadataへcanonical planとdigestを保存する。
6. correctionの場合も新しいFeature Plan messageへ新しいplanを保存する。
7. 古いFeature Plan messageとplanは履歴として不変に保持する。

### 7.2 Plan reviewとQueue admission

1. self-reviewは現在と同じArtifact本文をreviewする。
2. passしたreviewが参照するFeature Plan message IDを確定する。
3. そのmessageからimplementation planを読み、schema/digestを検証する。
4. Queue handoffへreview evidenceと同時にplan pointer / digestを保存する。
5. handoff保存後にFeature Plan metadataを再検索しない。

### 7.3 Repository Bootstrap

1. repoにGit HEADがなければ既存どおりBootstrap Runを開始する。
2. Bootstrap Runの`initialTodos`は現在のbootstrap専用Todoだけにする。
3. import、baseline、workspace準備後にheld Queue rowをreleaseする。
4. Queue handoffに固定済みのplan pointer / digestは変更しない。

### 7.4 通常Implementation Run作成

1. Queue drainがclaimed Queue entry全体をMission Pilot implementation start resolverへ渡す。
2. admission keyがなければ`not_mission_pilot`、あればexact handoffを検証する。
3. `ready`ならexact source messageのcanonical planを読み、step keyを`ImplementationTodoInput`の相対seq / dependencyへ変換する。
4. `startTaskRun()`へ`initialTodos`を渡す。
5. `requiresDataMigration=true`なら既存Todo builder用の予約済みmigration markerを渡す。
6. `buildStandardImplementationTodoList()`が固定first gate、projected steps、optional migration gate、固定final gatesを一度だけ構成する。
7. runtime開始前に全Todo rowを保存する。
8. runtime contextとphase-run evidenceへplan provenanceを保存する。

想定されるtodolist TaskのTodoList:

```text
1. コーディング準備を行う                         fixed
2. TodoのSQLite schemaと永続化境界を実装する       projected
3. 所有者境界を持つTodo APIを実装する              projected
4. /todosの追加・完了・編集・削除UIを実装する      projected
5. DB migrationを実行する                          fixed optional
6. 品質ゲート verify コマンドを通す                fixed
7. 完了報告を行う                                  fixed
```

### 7.5 Retry / resume

- Queue start前の再試行はhandoffが指すexact source messageとplan digestを再利用する。
- TaskRun作成後のruntime再接続は保存済み`task_run_todos`を再利用する。
- interrupted Implementation Runの再開は既存`resumeTodosFromRunId`を優先し、Feature Planから再投影しない。
- implementation reworkは新cycleとして扱い、review decisionが新しい実装scopeを確定した場合だけ別planを作る。初回計画のplanを暗黙に再利用しない。
- 進行済みRunのTodoをFeature Plan correctionで自動変更しない。pre-Queue freeze boundaryを維持する。

## 8. Failure Contract

次のerror codeを追加する。

- `MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_MISSING`
- `MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_INVALID`
- `MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_STALE`
- `MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_DIGEST_MISMATCH`
- `MISSION_PILOT_IMPLEMENTATION_TODO_DEPENDENCY_INVALID`
- `MISSION_PILOT_IMPLEMENTATION_HANDOFF_MISMATCH`

Failure behavior:

1. admission keyがあるQueue rowではTaskRunを作らない。
2. resolverはQueue claim後、`startTaskRun()`前に実行する。
3. `blocked`は同一transactionでclaimed rowを`status="queued"`、`claim_ready=false`へ戻し、`processor_slot`、lease fields、`active_run_id`をclearする。`status_reason`と`last_failure_kind="mission_pilot_todo_projection_blocked"`を保存し、attempt countは履歴として保持する。
4. Sessionを`phase="attention"`、`resume_phase="implementation_starting"`にし、`last_error_code` / `last_error_message`を保存する。
5. 既存のpersisted Mission Pilot event / Pilot Thought経路へsource Feature Plan、review、Context、plan digestを含む診断eventを1件だけ追加する。専用UIは追加しない。
6. 同じsource pointer / digestを再検証できる一時障害だけは、既存Queue recoveryで同じrowを`queued`へ戻してerrorをclearした後に`claim_ready=true`へreleaseする。source欠落・不正を追加生成で補わない。
7. 固定文でLLM本文を置換せず、これはorchestration contract failureとして表示する。
8. admission keyが`null`のQueue rowだけは既存default Todoへフォールバックできる。

## 9. Compatibility

### 9.1 新規Feature Plan

新schema適用後に生成・修正されたFeature Planはcanonical implementation planを必須とする。通常経路で追加LLM callは発生しない。

### 9.2 既存Feature Plan / Queue row

implementation plan metadataがない既存Feature Planを黙って汎用Todoへ落とさない。

初期実装では次の安全側を採用する。

1. 既に通常Implementation Runが開始済みなら、そのRunのTodoを変更しない。
2. review時点のlive DBには、projection metadataを必要とする`queued + claim_ready=0`のMission Pilot rowは存在しないため、legacy backfillは実装しない。
3. cutover中にmetadataなしFeature Planが未開始Queueへ到達した場合は`attention`へ止め、追加LLM call、Artifact再生成、汎用Todo fallbackを自動実行しない。
4. source欠落を自動修復する互換処理は本計画の非目標とし、実データが発生した場合だけ別途設計する。

## 10. File-Level Implementation Plan

### Phase 1: canonical implementation plan contract / renderer

Add:

- `shared/schemas/feature-plan-implementation-plan.schema.ts`
- Feature Plan implementation section renderer（既存renderer moduleへ配置）

Change:

- `api/modules/specification/specification-generation.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`

Work:

1. schema、type、dependency validation、canonical digest helperを追加する。
2. Feature Plan structured outputへcontent templateとcanonical planを追加する。
3. placeholderをexactly once検証し、canonical planから`## 実装計画`をrenderする。
4. message metadataへcanonical planとdigestを保存する。
5. focused correctionも同じ経路を通ることをtestで固定する。

### Phase 2: reviewed handoff reference

Change:

- `api/modules/missionPilot/mission-pilot-queue-handoff.service.ts`
- Mission Pilot handoff JSON schema / typeを所有する既存file

Work:

1. passing reviewのFeature Plan messageをexact IDで読む。
2. implementation plan schema、source、Context、routing、digestを検証する。
3. queue handoffへplan pointer / version / digestだけを保存する。
4. idempotent admissionのsame-key rereadでpointer / digestも一致させる。

DB migrationは不要とする。既存JSON columnへversioned fieldを追加する。Drizzle schemaまたはbootstrap table定義を変更しない。

### Phase 3: implementation start resolver

Add:

- `api/modules/missionPilot/mission-pilot-implementation-todo-projection.service.ts`

Change:

- `api/modules/missionPilot/mission-pilot-run-association.service.ts`
- `api/modules/nightworkers/run-orchestration/queues.ts`
- `api/services/worker-tools/todo-list-context.ts`

Work:

1. resolver入力をTask IDからclaimed Queue entryへ変え、admission keyで通常/Mission Pilot経路を識別する。
2. admission key、queue entry ID、Session handoff、review、Context、plan pointer / digestを一続きで検証する。
3. ready resultへ`initialTodos`、migration hint、plan provenanceを含める。
4. Queue drainでMission Pilot ready時だけ`initialTodos`を渡す。
5. blocked resultではTaskRunを作らず、同じQueue rowを`queued + claim_ready=false`へ戻してSessionをattentionへ止める専用repository transactionを使う。
6. 予約済みmigration markerを既存standard builderへ渡し、固定migration gateを1件だけ生成する。
7. migration hintとplan provenanceを既存Mission Pilot runtime envelope / phase-run evidenceへ保存し、Todo toolの再構成でも同じhintを読む。
8. association処理へresolved envelopeを渡し、Task IDからMission Pilotか再推論しない。

実装時のarchitecture確認により、肥大化している`start-task-run.ts`へ新しい分岐を追加せず、Queue resolverと既存builder contractの範囲で完結させた。

## 11. Test Plan

### 11.1 Schema / generation tests

- projection key重複を拒否する。
- unknown dependencyを拒否する。
- dependency cycleを拒否する。
- fixed gate相当stepを拒否する。
- test / verification / completion stepを拒否する。
- DB変更あり/なしで`requiresDataMigration`が保存される。
- placeholderが0件または複数のcontent templateを拒否する。
- canonical planからrenderしたFeature Planの`## 実装計画`と、projected Todoのtitle / descriptionが一致する。
- initial Feature Planとfocused correctionの両方がimplementation plan metadataを持つ。

### 11.2 Todo builder regression

`tests/services.todo-list-builder.test.ts`で次を固定する。

- fixed first/final gateの内容が変わらない。
- projection stepsがfirst/final gateの間へ入る。
- dependency seqがoffset後も正しい。
- migration hintで既存migration gateが1件だけ入る。
- Run contextに保存したmigration hintをTodo mutation時にも再利用する。
- projectionにverify/closeoutを渡しても重複しない、またはschema段階で拒否される。

### 11.3 Queue / Mission Pilot integration

新規focused testを追加し、既存の変更中test fileへ不要に混在させない。

Candidate:

- `tests/mission-pilot-implementation-todo-projection.test.ts`

Cases:

1. reviewed handoffからexact Feature Plan projectionを解決する。
2. Queue drainが`startTaskRun()`へprojection Todoを渡す。
3. admission keyがあるhandoff不整合をnon-Mission Pilot fallbackへ落とさない。
4. Sessionが存在してもadmission keyがない通常Queue Taskは既定Todoを維持する。
5. admission key / queue entry ID / missing / stale / digest mismatchでTaskRunを作らない。
6. blocked時に同じQueue rowが`queued + claim_ready=false`へ戻り、lease fieldsがclearされ、Sessionがattentionになる。
7. transient retryで同じsource message / plan digestとQueue rowを再利用する。
8. metadata欠落時に追加LLM call、Artifact再生成、default Todo fallbackを起動しない。

### 11.4 Bootstrap integration

isolated SQLite fixtureで次を通す。

```text
review pass
  -> held Queue handoff with projection
  -> repository_bootstrap Run
  -> bootstrap completed
  -> Queue release
  -> normal Implementation Run
```

Assertions:

- Bootstrap Runはbootstrap専用Todoだけを持つ。
- normal Runはprojection Todoを持つ。
- normal Runに`対象変更を確認して実装する`汎用Todoがない。
- fixed gatesは既存contractと一致する。
- migration gateはprojection hintに従う。
- phase run evidenceがprojection provenanceを持つ。

### 11.5 Resume / recovery

- interrupted Run再開で旧RunのTodo statusを保持する。
- resume時にFeature Planから再投影しない。
- correction前projectionをQueueへ渡さない。
- process再起動後もheld handoff projectionから通常Runを開始できる。

### 11.6 E2E

既存`tests/e2e/mission-pilot-pre-queue-handoff.spec.ts`または専用fixtureで、空Projectのstarter import後に通常Implementation Runへ進むscenarioを追加する。

UI assertionはTodo titleの完全一致を中心にし、内部LLM本文や生成時刻へ依存しない。

## 12. Verification Gates

実装中のfocused verification:

```bash
bun test tests/services.todo-list-builder.test.ts
bun test tests/mission-pilot-implementation-todo-projection.test.ts
bun test tests/mission-pilot-pre-queue-handoff.test.ts
bun test tests/mission-pilot-post-queue-recovery.test.ts
```

必要な関連回帰:

```bash
bun test tests/mission-pilot-todo-resume.test.ts
bun test tests/implementation-queue-resilience.test.ts
```

最終gate:

```bash
bun run check:docs
bun run verify
```

`verify:live`は通常の完了条件に含めない。本計画はprojection用の追加provider callを導入しない。

## 13. Rollout and Recovery

### 13.1 Rollout order

1. shared schemaとFeature Plan metadata保存を先に導入する。
2. canonical implementation plan付きFeature Plan生成をfocused testで確認する。
3. Queue handoff referenceを導入する。
4. implementation start resolverをfail closedで接続する。
5. Bootstrap integrationとrepo-wide verifyを通す。

Queue consumerはwriter / handoff referenceの導入より先には切り替えない。implementation plan metadataのない新規handoffを大量にblockedへ送らない順序を維持する。

### 13.2 Rollback

- Queue consumerのTodo projection利用だけをfeature flagで切り戻せる構造にはしない。二重経路が恒久化するためである。
- rollback時はconsumer、handoff writer、Feature Plan schema変更を同一commit単位で戻す。
- 既存message metadataとhandoff JSONの追加fieldはreaderが無視できるため、物理cleanupは不要。
- 既に開始済みRunのTodoはrollback対象にせず、そのRunのsnapshotとして維持する。

## 14. Stop Conditions

次の場合は実装を完了扱いにせず停止する。

1. canonical implementation planからFeature Planの実装計画sectionを決定的にrenderできない。
2. fixed Todo gateのprocedureまたはevidence contractを変更しなければprojectionを挿入できない。
3. Test Modeの作業をImplementation Todoへ混ぜないと既存completion gateを通せない。
4. Queue handoffがreview済みFeature Plan message IDを一意に固定できない。
5. projection欠落を通常Todo fallbackへ落とさないと既存Queueが成立しない。
6. restart / retryで同じprojectionへ収束せず、Todoが重複または再生成される。
7. user prompt regex / keyword分類またはprovider固有分岐が必要になる。
8. `bun run verify`が失敗する。

Stop Condition 1が発生した場合だけ、Feature Plan全体をstructured section modelからbackend renderする別計画へ切り出す。本計画内でFeature Plan全面再設計へ拡張しない。

## 15. Completion Checklist

- [x] Feature Plan structured outputがcanonical implementation planを返す。
- [x] Feature Planの実装計画sectionとTodoが同じcanonical planから生成される。
- [x] initial generationとfocused correctionが同じimplementation plan contractを使う。
- [x] Feature Plan metadataにcanonical planとdigestが保存される。
- [x] passing reviewのexact Feature Plan pointer / digestがQueue handoffへ固定される。
- [x] Bootstrap RunのTodoは変更されない。
- [x] normal Implementation Runがprojection Todoで開始する。
- [x] fixed first/final gatesが変更されない。
- [x] migration gateが必要な場合だけ既存位置へ入る。
- [x] Agentの`todo_list replace`なしでTodoListが実装内容を表す。
- [x] PlanなしTaskの既定Todoが回帰しない。
- [x] admission keyがあるstale / missing planがfail closedになる。
- [x] Sessionがある通常Queue Taskはadmission key不在なら既定Todoを維持する。
- [x] blocked Queue rowは同じrowのrecoverable holdへ戻る。
- [x] retry / resumeでTodoを再投影しない。
- [x] metadata欠落時に追加LLM call、Artifact再生成、default Todo fallbackを起動しない。
- [x] focused testsが成功する。
- [x] `bun run check:docs`が成功する。
- [ ] `bun run verify`が成功する。

`bun run verify`は今回のprojection変更ではなく、同一worktreeで並行変更中のagent-mode session / usage-accounting実装で停止している。現在の主な失敗は`api/db/schema-task-execution.ts`の666行化、同schemaのDrizzle import / self-reference型、usage summary / runtime contextの型不一致、および関連format errorである。Todo projection実装についてはfocused regression、Mission Pilot回帰、scoped lint、docs checkが成功しており、ユーザー合意に基づく領分別Doneとして本書をarchiveする。
