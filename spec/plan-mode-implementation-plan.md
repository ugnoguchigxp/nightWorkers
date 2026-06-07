# Plan Mode Implementation Plan

## 1. Summary
目的: NightWorkers を通常の Codex 会話から自然に `Plan mode` へ移行できるようにし、Plan mode 内で Design Questionnaire / Planning / Blueprint / DB Design を必要に応じて使い分け、完了後は通常 Codex に戻す。Plan mode の成果は Git 上の `spec/*.md` ではなく、NightWorkers 内蔵の設計データとして保存し、TitleBar の仕様書 Icon からいつでも戻れるようにする。

期待結果: ユーザーは普段どおりチャットできる。質問内容が計画・仕様策定に向いた場合だけ Plan mode が起動し、質問回答で仕様を固め、必要に応じて Blueprint / DB Design / implementation planning が補完する。生成されたアンケート履歴、Blueprint、DB Design、Decision Review、実装計画参照は Session / Project に紐づく Specification Workspace で再確認できる。

実装方針: 既存の Design Questionnaire、Blueprint Specification Workspace、Blueprint Preview、DB Design、Supervisor routing / skill reference、task message artifact の実装を最大限再利用する。新規で大きな保存基盤を作らず、まず既存の `blueprint-specification-workspace` を Plan mode の設計ホームへ昇格させる。

## 1.1 Review Findings and Corrections
### Finding 1: First implementation slice was still too broad
問題: 旧 Slice 1 は UI naming、artifact ref 条件、empty state、Workspace 表示をまとめていたが、実装順とテスト追加点が曖昧だった。これでは最初の PR でどこまで完了扱いにするか判断しにくい。

修正: First PR は `Specification Workspace` への導線統一と artifact ref 生成条件の拡張に限定する。`plan_mode_sessions`、自動 routing、DB migration は入れない。

### Finding 2: Routing work was mixed into UI enablement
問題: `design_questionnaire` / `db_design` work_kind の追加は重要だが、UI の仕様書 Icon を動かすための必須条件ではない。最初の PR に混ぜると skill registry、prompt、intake、UI の同時変更になり、検証範囲が広すぎる。

修正: PR1 は既存 `blueprint_workspace` / Questionnaire / Decision Review の read model 活用に絞る。Round 1 routing と work_kind 追加は PR2 に分離する。

### Finding 3: Existing UI/API implementation was underused
問題: `ArtifactPane.tsx` には `BlueprintSpecificationWorkspaceViewer` が既にあり、Questionnaire start / answer save / follow-up / review / accept まで実装済みだが、計画では新規構築のように読める箇所があった。

修正: 実装方針を「既存 viewer を Plan mode の設計ホームに改名・接続する」に寄せる。新規 screen は作らない。

### Finding 4: Verification order was not implementation-ready
問題: 旧 Verification Plan は focused tests と broader checks を列挙していたが、実装者がどの順で失敗を切り分けるか不明だった。

修正: 各 PR ごとに `typecheck -> focused vitest -> lint -> manual smoke` の順に固定し、失敗時の最短確認先を記載する。

## 2. Current Assets
### DB / Persistence
- `drizzle/migrations/0011_design_questionnaire.sql` と `api/db/bootstrap.ts` には、`design_questionnaire_sessions`、`design_questionnaire_question_sets`、`design_questionnaire_answers`、`design_questionnaire_reviews` が既にある。
- `api/db/schema.ts` には上記 table の Drizzle schema があり、session は `task_id`、`repository_id`、`source_blueprint_message_id` に紐づく。
- Blueprint / DB Design / Design Token の採用状態は `blueprint_*_adoptions` 系に分離済み。artifact 本体を変更せず、message ID と task ID に紐づける既存境界を使う。
- 採用済み Decision Review は `task_messages` の `markdown_document` として発行済みにできる。Git ファイルではなく DB 内 evidence として残せる。

### Shared Schemas
- `shared/schemas/design-questionnaire.schema.ts` に Design Questionnaire、answer、Decision Review、Blueprint Specification Workspace の schema / type がある。
- `blueprintSpecificationWorkspaceSchema` は `blueprintArtifacts`、`dbDesignArtifacts`、`questionnaireSessions`、`decisionReviews`、`implementationReferences` を既に表現できる。
- `WorkbenchArtifactKind` には `blueprint_workspace` がある。最初は互換名として残しつつ、UI 表示と導線を Plan mode / 仕様書 Icon に寄せる。

### API / Service / Repository
- `api/modules/nightworkers/nightworkers.routes.ts` には次が既にある。
  - `POST /api/tasks/:id/design-questionnaire`
  - `GET /api/tasks/:id/design-questionnaire`
  - `GET /api/tasks/:id/design-questionnaire/:sessionId`
  - `POST /api/tasks/:id/design-questionnaire/:sessionId/answers`
  - `POST /api/tasks/:id/design-questionnaire/:sessionId/follow-up`
  - `POST /api/tasks/:id/design-questionnaire/:sessionId/review`
  - `POST /api/tasks/:id/design-questionnaire/:sessionId/review/accept`
  - `POST /api/tasks/:id/design-questionnaire/:sessionId/review/leave-unadopted`
  - `GET /api/tasks/:id/blueprint-specification-workspace`
- `api/modules/nightworkers/nightworkers.service.ts` には question set generation、follow-up、review synthesis、review accept、workspace aggregation がある。
- `api/modules/nightworkers/nightworkers.repository.ts` には Questionnaire session / question set / answer / review の CRUD と Blueprint adoption helper がある。
- `callStructuredJsonLLM` 境界で schema-first generation を行っており、schema-invalid でも raw output を保持する方針が既に実装されている。

### UI
- `src/modules/nightworkers/components/ThreadWorkspace.tsx` の上部操作列に Blueprint artifact ボタンがある。現在は `PanelsTopLeft` icon で `blueprint_workspace` または `app_blueprint` artifact を開く。
- `src/modules/nightworkers/components/NightWorkersShell.tsx` は artifact pane の open / close、selected artifact、split panel 表示を管理している。
- `src/modules/nightworkers/components/ArtifactPane.tsx` には `BlueprintSpecificationWorkspaceViewer` が既にあり、Blueprints / DB Design / Questionnaire / Decisions / Implementation タブ、Questionnaire start / answer save / follow-up / review / accept まで実装済み。
- `src/modules/nightworkers/workbenchSelectors.ts` は Blueprint message がある場合に `blueprint_workspace` artifact ref を生成する。TitleBar の仕様書 Icon はこの ref を起点にできる。
- `src/modules/nightworkers/i18n/dictionary.ts` には `thread.openBlueprintArtifact` / `thread.hideBlueprintArtifact` / `thread.noBlueprintArtifact` が残っている。PR1 ではこれらを削除せず、Specification Workspace 向け key を追加して `ThreadWorkspace.tsx` だけ新 key に切り替える。

### Supervisor / Routing / Skills
- `AGENTS.md` は Round 1 で workflow / routing hypothesis を選ばせ、Round 2 で `resolveSupervisorSkillDocuments` が phase / mode / work_kind / overlay に対応する reference を読む構造を要求している。
- `api/services/supervisor/skills/types.ts` には `SupervisorRoutingHypothesis` があり、`primaryMode`、`phase`、`workKinds`、`nextSkillFiles` を持つ。
- `api/services/supervisor/skills/builtin/references/router.md` は routing を固定分類ではなく、observations / tool result / todoPlan / 追加入力で再評価するものとして定義している。
- `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md` は Blueprint と DB Design の境界を既に明記している。
- 現状の `supervisorWorkKinds` には `blueprint` はあるが、`design_questionnaire` と `db_design` はない。Plan mode の capability として追加する余地がある。

### Tests
- `tests/routes.nightworkers.test.ts` には Design Questionnaire 生成、回答保存、Decision Review accept、workspace aggregation の統合テストがある。
- `tests/nightworkers.workbench-selectors.test.ts` には Plan mode markdown message から Blueprint artifact ref を作るケースがある。
- `tests/services.supervisor-skills.test.ts` は skill markdown の parser-visible section と registry を検証する既存 gate として使える。
- `package.json` の focused verification は `pnpm vitest run tests/routes.nightworkers.test.ts tests/nightworkers.workbench-selectors.test.ts tests/services.supervisor-skills.test.ts` を第一候補にする。

## 2.1 Implementation Inventory
この表を first PR の実装チェックリストとして使う。

| 領域 | 既存ファイル | 既存責務 | First PR での扱い |
| --- | --- | --- | --- |
| Artifact ref | `src/modules/nightworkers/workbenchSelectors.ts` | Blueprint message から `blueprint_workspace` ref を作る | Blueprint / Decision Review message から Workspace ref を作る |
| Active workspace query | `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` | active session の messages / runs / reviews から artifact refs を作る | active session の Specification Workspace を取得し、in-progress Questionnaire だけでも Workspace ref を出せるようにする |
| TitleBar action | `src/modules/nightworkers/components/ThreadWorkspace.tsx` | Blueprint artifact button | 仕様書 Icon として label / aria-label / disabled 条件を変更 |
| Pane state | `src/modules/nightworkers/components/NightWorkersShell.tsx` | selected artifact / split panel を管理 | `blueprint_workspace` kind は維持し、選択ロジックだけ再利用 |
| Workspace viewer | `src/modules/nightworkers/components/ArtifactPane.tsx` | `BlueprintSpecificationWorkspaceViewer` | 新規 screen は作らず、見出し・empty state・tab labels を Plan mode 向けに調整 |
| Read model | `api/modules/nightworkers/nightworkers.service.ts` | `getBlueprintSpecificationWorkspace` | PR1 では既存関数維持。alias は追加しても wrapper のみ |
| Routes | `api/modules/nightworkers/nightworkers.routes.ts` | `/blueprint-specification-workspace` | 互換維持し、`/specification-workspace` alias を追加 |
| Schema/types | `shared/schemas/design-questionnaire.schema.ts`, `src/modules/nightworkers/types.ts` | Workspace schema / frontend type | PR1 で schema 追加は原則しない |
| Skill routing | `api/services/supervisor/skills/*` | Round 1 / Round 2 reference | PR2 に分離 |

## 3. Target Model
### User Flow
```text
通常 Codex
  -> user request から計画・仕様策定が必要と判断
  -> Plan mode に入る
  -> Design Questionnaire で仕様未確定点を質問化
  -> 回答から Decision Review を作る
  -> 必要に応じて Blueprint で画面/成果物構造を補完
  -> 必要に応じて DB Design で data contract を補完
  -> Planning で実装順序と検証条件をまとめる
  -> Plan mode 完了
  -> 通常 Codex に戻る
```

### State Vocabulary
- `lane = codex`: 通常のフラットな Codex 会話。余計な構造化を強制しない。
- `lane = plan`: 計画するための専用レーン。Design Questionnaire / Planning / Blueprint / DB Design を capability として使う。
- `planCapability = design_questionnaire | planning | blueprint | db_design`: Plan mode 内で使う機能群。これはレーン名ではない。
- `Specification Workspace`: Plan mode の成果を読む設計ホーム。Git ファイルではなく DB-backed read model。

### Persistence Boundary
- Plan mode の成果は、Git 作業ツリーではなく DB / task message / adoption table に残す。
- 編集中状態は専用 table に置く。採用済みの Decision Review や implementation reference は `task_messages` の `markdown_document` として timeline / artifact evidence に出す。
- Workspace は source of truth ではなく aggregation view。Blueprint、DB Design、Questionnaire、Decision Review の保存責務を統合しない。

## 3.1 First PR Contract
最初の実装 PR は、次だけを完了させる。

1. 仕様書 Icon から Specification Workspace を開ける。
2. Blueprint artifact がある場合の既存挙動を維持する。
3. Decision Review または Design Questionnaire session がある場合も Workspace ref が生成される。
4. Workspace の UI 表示が `Blueprint Specification Workspace` 専用名から Plan mode の設計ホームに寄る。
5. 追加 DB migration はない。
6. Round 1 routing / work_kind 追加は行わない。

PR1 完了時点で、Plan mode の「自然起動」はまだ実装しない。既存成果を見返せる設計ホームと仕様書 Icon を先に安定させる。

## 4. Implementation Slices
### PR1 / Slice 1: Specification Icon and Workspace Ref
目的: 既存 Blueprint Specification Workspace を Plan mode の設計ホームとして見せる。

変更対象:
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/components/NightWorkersShell.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/workbenchSelectors.ts`
- `src/modules/nightworkers/i18n/dictionary.ts`
- `src/modules/nightworkers/types.ts`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- `tests/nightworkers.workbench-selectors.test.ts`

作業:
1. `workbenchSelectors.ts` の `buildWorkbenchArtifactRefs` を変更する。
   - 現在: `blueprintMessages.length > 0` のときだけ `blueprint_workspace` ref を push する。
   - 変更後: `blueprintMessages.length > 0`、または `metadata.intent === "design_decision_review"` の message がある場合に `blueprint_workspace` ref を push する。
   - title は `Specification Workspace` にする。kind は互換のため `blueprint_workspace` のまま。
2. `artifactTitleForKind` の `blueprint_workspace` 表示を `Specification Workspace` に変更する。
3. `useNightWorkersWorkspace.ts` に active session の Workspace query を追加する。
   - query key は `['specificationWorkspace', activeSessionId]`。
   - endpoint は PR1 Slice 2 の `/api/tasks/:id/specification-workspace` を使う。
   - `workspace.questionnaireSessions.length > 0`、`workspace.decisionReviews.length > 0`、`workspace.blueprintArtifacts.length > 0`、`workspace.dbDesignArtifacts.length > 0`、`workspace.implementationReferences.length > 0` のいずれかなら、`activeArtifactRefs` に `blueprint_workspace` ref が存在する状態を保証する。
   - 既に `buildWorkbenchArtifactRefs` が `blueprint_workspace` ref を返している場合は重複追加しない。
4. `ThreadWorkspace.tsx` のボタン表示を仕様書 Icon にする。
   - 既存 `PanelsTopLeft` icon は維持してよい。
   - `noBlueprintArtifactLabel` は `No specification workspace` に変える。
   - 新 key `thread.openSpecificationWorkspace` / `thread.hideSpecificationWorkspace` / `thread.noSpecificationWorkspace` を追加して使う。旧 `thread.openBlueprintArtifact` 系は timeline 互換のため残す。
5. `NightWorkersShell.tsx` の `handleOpenBlueprintArtifact` は PR1 ではリネームしない。`blueprint_workspace` を最優先で開くロジックを維持し、呼び出し元の文言だけ Specification Workspace に変える。
6. `ArtifactPane.tsx` の `BlueprintSpecificationWorkspaceViewer` を表示上 `Specification Workspace` に寄せる。
   - 見出しを `Specification Workspace` に変更する。
   - Blueprints tab が空でも Questionnaire / Decisions / Implementation tab を使える空状態にする。
7. `tests/nightworkers.workbench-selectors.test.ts` に次のケースを追加する。
   - `design_decision_review` message だけでも `blueprint_workspace` ref が生成される。
   - ref title が `Specification Workspace` になる。
   - 既存 App Blueprint artifact ref は残る。

受け入れ基準:
- TitleBar の仕様書 Icon から設計ホームを開閉できる。
- Blueprint がある既存 Session の挙動は壊れない。
- Design Questionnaire / Decision Review がある Session でも設計ホームの入口が出る。
- UI の表示文言が「最新 Blueprint を開く」ではなく「仕様全貌へ戻る」意味になっている。
- `tests/nightworkers.workbench-selectors.test.ts` が通る。

### PR1 / Slice 2: Workspace Read Model Alias
目的: `blueprint-specification-workspace` を Plan mode の成果集約として使えるようにする。

変更対象:
- `shared/schemas/design-questionnaire.schema.ts`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `api/modules/nightworkers/nightworkers.repository.ts`
- `src/modules/nightworkers/types.ts`
- `tests/routes.nightworkers.test.ts`

作業:
1. 既存 endpoint `/api/tasks/:id/blueprint-specification-workspace` は削除しない。
2. 新 alias `GET /api/tasks/:id/specification-workspace` を追加する。
   - route schema は `blueprintSpecificationWorkspaceSchema` を再利用する。
   - handler は `service.getSpecificationWorkspace(id)` を呼ぶ。
3. `service.getSpecificationWorkspace(taskId)` を追加し、first PR では `return getBlueprintSpecificationWorkspace(taskId)` の wrapper にする。
4. `getBlueprintSpecificationWorkspace` の DB Design artifact で `sourceBlueprintMessageId` を取れる metadata がある場合は設定する。
   - `metadata.sourceBlueprintMessageId`
   - `metadata.dbDesignTarget?.sourceBlueprintMessageId`
   - 該当なしなら省略する。
5. `tests/routes.nightworkers.test.ts` に alias route の回帰を追加する。
   - 既存 questionnaire workspace test の最後で `/specification-workspace` を叩き、`questionnaireSessions` と `decisionReviews` が同じ意味で返ることを確認する。

受け入れ基準:
- 既存 `/blueprint-specification-workspace` テストが通る。
- 新 `/specification-workspace` が同じ read model を返す。
- Workspace が Blueprint 専用ではなく Plan mode 成果の集約として読める。
- 追加 migration なしで成立する。

### PR2 / Slice 3: Plan mode routing hypothesis
目的: ユーザー発言から自然に Plan mode を提案し、Round 2 で必要 capability の reference を読む。

変更対象:
- `api/services/supervisor/skills/types.ts`
- `api/services/supervisor/skills/registry.ts`
- `api/services/supervisor/skills/builtin/references/router.md`
- `api/services/supervisor/skills/builtin/references/modes/planning.md`
- `api/services/supervisor/skills/builtin/references/work_kinds/blueprint.md`
- 新規 `api/services/supervisor/skills/builtin/references/work_kinds/design_questionnaire.md`
- 新規 `api/services/supervisor/skills/builtin/references/work_kinds/db_design.md`
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/services/task-intake/*`

作業:
1. `supervisorWorkKinds` に `design_questionnaire` と `db_design` を追加する。`planning` は既に mode として存在するため、PR2 では work kind を追加しない。
2. `design_questionnaire.md` は、質問回答で仕様未確定点を固め、DB schema 詳細は `db_design` に渡すことを Required Behavior に書く。
3. `db_design.md` は、Blueprint の `databaseSchema` / `dataBindings` revision を扱い、物理 migration は行わないことを Required Behavior に書く。
4. Router reference に、Plan mode は単一ラベル分類ではなく `routingHypothesis` であり、通常 Codex へ復帰可能な一時レーンであることを追加する。
5. `appendWorkbenchMessage` / intake の流れで、Round 1 の routing が Plan mode を示した場合に、固定エラー文や keyword 分岐ではなく、assistant response と metadata に `lane: "plan"`、`planCapabilities`、`routingHypothesis` を残す設計へ寄せる。
6. 最初の自動化は「提案と metadata 保存」に留める。自動で Questionnaire を生成するのは次 slice に回し、ユーザーに見える遷移を確認する。

受け入れ基準:
- `resolveSupervisorSkillDocuments` が `design_questionnaire` / `db_design` reference を読める。
- `tests/services.supervisor-skills.test.ts` が新 reference を含めて通る。
- Round 1 が Plan mode を選んでも、通常の Codex answer を不要に塞がない。
- ユーザー文言の regex / keyword 判定で Plan mode を起動しない。

### PR3 / Slice 4: Capability orchestration inside Plan mode
目的: Plan mode 内で質問内容に応じて Design Questionnaire / Blueprint / DB Design / Planning を補完的に使う。

変更対象:
- `api/modules/nightworkers/nightworkers.service.ts`
- `api/modules/nightworkers/nightworkers.routes.ts`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/blueprint-preview/*`
- `api/services/blueprints/*`
- `api/services/supervisor/artifact-contract.ts`

作業:
1. Design Questionnaire の start は既存 API を使う。UI では active Blueprint がない場合の開始条件を明確化する。Blueprint がない場合は、先に Blueprint capability を使う導線を出す。
2. Questionnaire の DB Design handoff notes を DB Design tab に表示する。これは DB Design 実行前の入力候補であり、table/column 提案ではない。
3. DB Design は既存 `design_blueprint_data` intent と `BlueprintViewer` の DB Design request を再利用する。Plan mode Workspace から対象 Blueprint を選び、同じ prompt builder に接続する。
4. Planning は `implementationReferences` に出る既存 `implementation_plan` / `draft_spec` message を読む。Plan mode 内で採用済み Decision Review と Blueprint readiness を evidence として使う。
5. capability の完了状態を UI で出す。例: Questionnaire accepted、Blueprint adopted/latest、DB Design adopted/latest、Planning available/missing。

受け入れ基準:
- Questionnaire の回答から DB Design handoff が見える。
- DB Design は Blueprint Preview 既存機能を壊さず Workspace からも辿れる。
- Planning tab に implementation plan message が出る。
- Capability は同じ Plan mode 内の道具として見え、独立レーン乱立に見えない。

### PR4 / Slice 5: Leaving Plan mode and returning to Codex
目的: Plan mode の完了を明示し、その後の会話を通常 Codex に戻す。

変更対象:
- `api/modules/nightworkers/nightworkers.service.ts`
- `shared/schemas/nightworkers.schema.ts` または `shared/schemas/design-questionnaire.schema.ts`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/ThreadWorkspace.tsx`
- `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`

作業:
1. 最小では DB migration を追加せず、Plan mode の完了は accepted Decision Review / implementation plan message / UI local state から判定する。
2. 必要になったら後続 slice で `plan_mode_sessions` を追加する。初期実装では既存 Questionnaire session と task messages で十分か検証する。
3. UI に `Finish Plan mode` action を追加する。実装 queue には自動投入せず、Workspace pane を閉じて通常 chat composer を主表示に戻すだけにする。
4. 完了時の永続化は PR4 では追加しない。accepted Decision Review / implementation plan message が Plan mode 成果の永続証拠であり、UI の active lane は local state として扱う。

受け入れ基準:
- Plan mode を閉じても Specification Workspace の履歴は残る。
- 通常 chat composer は使える。
- Plan mode 完了が implementation queue 開始と混同されない。
- Git 作業ツリーに設計書が生成されない。

## 5. Data Model Decision
初期実装では `plan_mode_sessions` table は作らない。理由は、既存の `design_questionnaire_sessions`、`task_messages`、Blueprint adoption、DB Design adoption、Workspace read model で first slice の永続化が成立するため。

追加 table を検討する条件:
- Blueprint なしで Plan mode を開始し、複数 capability を横断する独立 session ID が必要になる。
- Plan mode の開始 / 終了 / active capability / 復帰状態を複数端末で厳密に同期する必要が出る。
- 1 task に複数 Plan mode run を持ち、成果を run 単位で比較する必要が出る。

その場合の候補:
```ts
planModeSessions {
  id
  taskId
  repositoryId
  status // active | completed | abandoned | needs_edit
  activeCapability // design_questionnaire | planning | blueprint | db_design | null
  summaryJson
  createdAt
  updatedAt
  completedAt
}
```

ただし first slice では追加しない。

## 6. UI Design Notes
- TitleBar の仕様書 Icon は文字ボタンではなく icon button にする。tooltip / aria-label で `仕様書` または `Specification Workspace` を示す。
- 仕様書 Icon は、現在の task に Plan mode 成果があるときだけ有効にする。何もない場合は disabled とし、tooltip は `No specification workspace` にする。
- Workspace は cards の入れ子にしない。既存 ArtifactPane のタブ構造を活かし、一覧は密度高めにする。
- Questionnaire は既存の grouped form を維持する。一問ずつチャットしない。
- DB Design は「聞いている限り DB 設計はこうなりそうです」という補完として表示し、migration 実行や物理 DB 変更とは明確に分離する。
- Planning は実装準備のためのまとめであり、Plan mode そのものとは同名衝突しないよう UI では `Implementation Plan` 表示に寄せる。

## 7. Verification Plan
### PR1 verification order
```bash
pnpm typecheck
pnpm vitest run tests/nightworkers.workbench-selectors.test.ts
pnpm vitest run tests/routes.nightworkers.test.ts
pnpm lint
```

期待結果:
- TypeScript の route / frontend type mismatch がない。
- `blueprint_workspace` ref の既存 case と Decision Review only case が両方通る。
- `/blueprint-specification-workspace` と `/specification-workspace` が同じ read model として扱える。
- lint で unused import / i18n key 変更の崩れが出ない。

失敗時の最短確認先:
- selector test failure: `src/modules/nightworkers/workbenchSelectors.ts`
- route test failure: `api/modules/nightworkers/nightworkers.routes.ts` と `api/modules/nightworkers/nightworkers.service.ts`
- typecheck failure: `src/modules/nightworkers/types.ts` と `shared/schemas/design-questionnaire.schema.ts`
- lint failure: i18n key rename と unused imports

### PR2 verification order
```bash
pnpm typecheck
pnpm vitest run tests/services.supervisor-skills.test.ts
pnpm vitest run tests/services.supervisor.test.ts tests/services.supervisor-prompt-packet.test.ts
pnpm lint
```

### PR3 verification order
```bash
pnpm typecheck
pnpm vitest run tests/routes.nightworkers.test.ts tests/services.blueprint-data-design.test.ts tests/services.blueprint-draft.test.ts tests/services.blueprints.test.ts
pnpm lint
```

### Final broad check before merge
```bash
pnpm verify:fast
```

### Manual smoke
1. 既存 Blueprint artifact がある Session を開く。
2. TitleBar の仕様書 Icon から Workspace を開く。
3. Questionnaire を開始し、回答を保存する。
4. Decision Review を生成して accept する。
5. DB Design tab と Decisions tab に履歴が残ることを確認する。
6. Workspace を閉じ、通常チャットに戻れることを確認する。
7. Git status に設計書や generated markdown が増えていないことを確認する。

## 8. Risks and Mitigations
- Risk: Plan mode と Planning capability が混同される。
  Mitigation: 内部名は `lane = plan`、capability は `implementation_planning` または UI 表示 `Implementation Plan` に寄せる。
- Risk: 既存 `blueprint_workspace` kind を急に変えて artifact pane が壊れる。
  Mitigation: kind は互換維持し、表示名と alias endpoint から段階的に移行する。
- Risk: Plan mode 起動が keyword 判定に戻る。
  Mitigation: Router / skill reference に routingHypothesis として書き、provider / frontend に regex 分岐を置かない。
- Risk: Workspace が source of truth 化して保存責務が混ざる。
  Mitigation: Workspace は read model と明記し、保存は Questionnaire table、task_messages、adoption table に残す。
- Risk: DB Design が物理 migration と誤解される。
  Mitigation: DB Design reference と UI copy で data contract revision のみに限定する。
- Risk: Git を汚さない方針と実装計画書作成が矛盾して見える。
  Mitigation: この `spec/` は開発用 implementation plan。ユーザーが Plan mode で作る設計成果は DB-backed Workspace に保存する。

## 9. First Day Checklist
PR1 の初日に、この順で進める。

1. `api/modules/nightworkers/nightworkers.service.ts` に `getSpecificationWorkspace(taskId)` wrapper を追加する。
2. `api/modules/nightworkers/nightworkers.routes.ts` に `GET /api/tasks/:id/specification-workspace` alias route を追加する。
3. `tests/routes.nightworkers.test.ts` の Design Questionnaire integration test に alias route assertion を足す。
4. `src/modules/nightworkers/workbenchSelectors.ts` で `design_decision_review` message から `blueprint_workspace` ref を作る。
5. `tests/nightworkers.workbench-selectors.test.ts` に Decision Review only case を追加する。
6. `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` で active Specification Workspace query を追加し、in-progress Questionnaire だけでも `blueprint_workspace` ref が出るようにする。
7. `src/modules/nightworkers/i18n/dictionary.ts` に `thread.openSpecificationWorkspace` / `thread.hideSpecificationWorkspace` / `thread.noSpecificationWorkspace` を日英両方で追加する。
8. `src/modules/nightworkers/components/ThreadWorkspace.tsx` のボタン title / aria-label / disabled tooltip を仕様書 Icon 向けに変える。
9. `src/modules/nightworkers/components/ArtifactPane.tsx` の Workspace 見出しと empty state を `Specification Workspace` に寄せる。
10. PR1 verification order を実行する。

## 10. Definition of Done
### PR1 Done
- `GET /api/tasks/:id/specification-workspace` が既存 `/blueprint-specification-workspace` と同じ read model を返す。
- Blueprint message、Decision Review message、または in-progress Questionnaire session のいずれかがある active session で仕様書 Icon が有効になる。
- 仕様書 Icon の title / aria-label / disabled tooltip が Blueprint artifact 専用文言ではない。
- `ArtifactPane` の Workspace 見出しが `Specification Workspace` 系になっている。
- `tests/nightworkers.workbench-selectors.test.ts` と `tests/routes.nightworkers.test.ts` が通る。
- 追加 DB migration がない。

### Overall Done
- 通常 Codex から Plan mode に入る導線が UI / routing の両方で説明できる。
- Plan mode 内の Design Questionnaire / Blueprint / DB Design / Planning が capability として見える。
- TitleBar の仕様書 Icon から、アンケート履歴、Blueprint、DB Design、Decision Review、implementation reference に戻れる。
- Plan mode を離れても通常チャットに戻れる。
- Plan mode 成果は Git 作業ツリーではなく DB-backed Workspace に残る。
- 既存 Blueprint Preview / DB Design / Design Questionnaire route tests が通る。
