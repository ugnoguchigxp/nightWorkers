# Plan Mode Artifact Chat Regeneration Implementation Plan

## Purpose

Plan Mode Workspace を開いた状態で chat composer に入力した指摘を、現在表示中の Plan Mode artifact/view への再生成依頼として扱えるようにする。

現在の UI は、composer の対象として `Plan Mode Workspace` を表示できる。しかし、ユーザーが `Blueprint` tab を開いて「この画面はこう直して」と入力しても、処理対象は `Blueprint` ではなく通常の Workbench intake に流れる。期待する動きは、chat と同じ入力体験のまま、表示中の tab に応じて対象 artifact を明示し、その artifact generator にユーザー指摘だけを再生成指示として渡すことである。

この計画では Plan Mode Workspace 全体の再設計は行わない。対象は、Plan Mode Workspace 内の active tab と composer submit を接続し、既存 generator を最小限拡張して「現在見ている artifact への注文」を成立させることに絞る。

## Confirmed Baseline

現状確認済みの経路:

- `PlanModeWorkspaceViewer` は内部で `activeTab` を保持し、tab 変更時に `onTabChange` を呼ぶ。
- `NightWorkersShellThreadPanel` は `onPlanWorkspaceTabChange` で route state を `artifact: { kind: 'plan_mode_workspace', tab }` に更新する。
- `ArtifactPane` は route / artifact metadata の `initialTab` を `PlanModeWorkspaceViewer` に渡す。
- `Composer` は `artifactContext` を表示でき、submit payload に載せる backend 経路も存在する。
- `appendWorkbenchMessage` は `artifactContext` を保存し、`renderArtifactContextualPrompt` で Workbench intake LLM prompt に混ぜる。

重要な弱点:

- composer の対象表示は `Plan Mode Workspace` / `PLAN_MODE_WORKSPACE` のままで、現在の `Blueprint` / `Data Model` / `API Contract` tab とは連動して見えない。
- `artifactContext` に `Workspace tab: blueprint` 相当を入れられても、backend はそれを再生成 command として扱わない。
- Workbench intake prompt には `完了済みの Plan Mode artifact は証跡として扱い、後続の質問や変更依頼で再編集対象にしないでください。` という、今回の要件と逆向きの指示がある。
- `Data Model` と generic Plan View generator は `prompt` を受け取れるが、`Blueprint` と `Feature Plan` generator は自由入力の `prompt` を受け取る API 契約になっていない。
- 既存 test には、active Blueprint workspace instruction から Blueprint artifact を自動生成しないことを期待するものがある。今回の要件ではこの期待値を置き換える必要がある。

関連ファイル:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx`
- `src/modules/nightworkers/components/Composer.tsx`
- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/nightworkers/hooks/nightWorkersChatActions.ts`
- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/modules/dataModel/dataModel-generation.service.ts`
- `api/modules/planViews/planView-generation.service.ts`

## Scope

In scope:

- Plan Mode Workspace の active tab から composer 用の対象 context を作る。
- composer の対象表示を `Plan Mode Workspace` ではなく、現在の対象 artifact/view 名にする。
- Plan Mode artifact 再生成用の submit branch を backend に追加する。
- `Blueprint` / `Feature Plan` generator に `prompt?: string` を追加する。
- `Data Model` / generic Plan View generator には既存の `prompt` 入力を使って再生成指示を渡す。
- user message は通常どおり保存し、metadata に artifact context を残す。
- 実装後の workspace / messages を frontend cache に反映する。
- 既存 test を、新しい「active tab 対象の再生成」期待へ更新する。

Out of scope:

- Plan Mode Workspace UI の全面再設計。
- Plan Mode artifact schema の大規模変更。
- 保存済み artifact の DB migration。
- Questionnaire の質問設計変更。
- Plan Mode Status の sequential auto-generate 動作変更。
- 通常 chat / run task / queue / review followup の routing semantics 変更。
- artifact ごとの差分適用や patch edit。初期実装は再生成のみ。

## Target Behavior

### Composer target

Plan Mode Workspace を開いている場合、composer の対象 chip は現在の tab と一致する。

| Active tab | Chip title | Chip kind |
| --- | --- | --- |
| `feature-plan` | `Feature Plan` | `PLAN_MODE:FEATURE_PLAN` |
| `blueprint` | `Blueprint` | `PLAN_MODE:BLUEPRINT` |
| `data-model` | `Data Model` | `PLAN_MODE:DATA_MODEL` |
| `user-flow` | `User Flow` | `PLAN_MODE:USER_FLOW` |
| `api-io-contract` | `API Contract` | `PLAN_MODE:API_IO_CONTRACT` |
| `activity-flow` | `Activity` | `PLAN_MODE:ACTIVITY_FLOW` |
| `sequence-flow` | `Sequence` | `PLAN_MODE:SEQUENCE_FLOW` |
| `zod-schema-design` | `Zod Schema` | `PLAN_MODE:ZOD_SCHEMA_DESIGN` |
| `questionnaire` | `Questionnaire` | `PLAN_MODE:QUESTIONNAIRE` |
| `status` | `Plan Mode Status` | `PLAN_MODE:STATUS` |

`status` と `questionnaire` は初期実装では再生成対象にしない。これらの tab で chat に入力した場合は、明示的な再生成 branch ではなく従来の intake に流すか、composer target を `Plan Mode Workspace` 扱いに戻す。初期実装では誤爆を避けるため、再生成 branch は generator を持つ tab のみに限定する。

### Regeneration submit

対象 tab が再生成対応の場合、chat submit は通常の Workbench intake gate に入らない。

処理:

1. user message を本文そのままで保存する。
2. user message metadata に `artifactContext` を保存する。
3. `artifactContext.metadata.planModeTarget` を見て対象 generator を直接呼ぶ。
4. generator には chat 本文を `prompt` として渡す。
5. 生成された artifact message と workspace を返す。
6. frontend は messages と Plan Mode workspace cache を更新し、対象 tab を維持する。

期待する user experience:

```text
User opens Plan Mode Workspace > Blueprint
Composer chip: 対象 Blueprint / PLAN_MODE:BLUEPRINT
User: TODO登録と一覧だけでよい。余計なセクションを増やさないでください。
System: Blueprint generator runs with that instruction.
Right pane remains on Blueprint and shows the regenerated artifact.
```

### Non-regeneration submit

次の場合は従来動作を維持する。

- Plan Mode Workspace が開いていない。
- active tab が `status` または `questionnaire`。
- ユーザーが chip を clear した。
- `artifactContext.metadata.instructionMode !== 'regenerate_artifact'`。
- `planModeTarget` が未知。

## Data Contract

Frontend から backend に渡す `artifactContext.metadata` を拡張する。

```ts
type PlanModeArtifactInstructionMetadata = {
  instructionMode?: 'regenerate_artifact';
  planModeTarget?:
    | 'feature_plan'
    | 'blueprint'
    | 'data_model'
    | 'user_flow'
    | 'api_io_contract'
    | 'activity_flow'
    | 'sequence_flow'
    | 'zod_schema_design';
  initialTab?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
};
```

既存 `WorkbenchArtifactContext` の `kind` は互換性のため `plan_mode_workspace` のままでもよい。ただし UI 表示用には `displayKind` 相当を metadata に足すか、`Composer` 側で `metadata.planModeTarget` から表示文字列を作る。

初期実装では API schema の破壊的変更を避ける。`workbenchArtifactContextSchema.metadata` に必要な optional fields を追加する。

## Implementation Plan

### Phase 0. Baseline test lock

Goal: 変更前の現在動作を test で確認し、置き換える期待を明確にする。

Tasks:

- `artifactContext` が backend prompt に入る既存 test を確認する。
- active Plan Mode Workspace instruction が generator に行かない既存 test を確認する。
- `Data Model` / generic Plan View generator が `prompt` を受け取る既存経路を確認する。
- `Blueprint` / `Feature Plan` generator が `prompt` 未対応であることを test または型で確認する。

Verification:

```bash
bun run test run tests/nightworkers-workbench-routes/routes-workbench-01.test.ts tests/nightworkers-workbench-routes/routes-workbench-02.test.ts tests/artifact-workspace-viewer.test.ts tests/specification-status-view.test.tsx
```

Stop condition:

- baseline が現状と一致しない場合、実装に入らず差分原因を先に確認する。

### Phase 1. Active Plan Mode target context

Goal: Plan Mode Workspace の active tab を composer 対象 context として扱えるようにする。

Files:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/nightworkers/components/ArtifactPane.tsx`
- `src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx`
- `src/modules/nightworkers/workbenchArtifactSelectors.ts`
- `src/modules/nightworkers/types/workbench.ts`

Tasks:

- `PlanModeWorkspaceViewer` から active tab と source ids を親へ通知する callback を追加する。
- `ArtifactPane` で Plan Mode active target を受け取り、thread panel へ戻す。
- `NightWorkersShellThreadPanel` で `selectedArtifactContext` を、Plan Mode active target がある場合だけ上書きする。
- source ids は既存 state から取れる範囲に限定する。
  - `questionnaireSessionId`
  - `featurePlanMessageId`
  - `sourceBlueprintMessageId`
  - `sourceDataModelMessageId`
- generator を持たない `status` / `questionnaire` は `instructionMode` を付けない。

Verification:

```bash
bun run test run tests/artifact-workspace-viewer.test.ts
```

Expected:

- Plan Mode Workspace の active tab を切り替えると composer context が変わる。
- `blueprint` tab では `planModeTarget: 'blueprint'` になる。
- `data-model` tab では `planModeTarget: 'data_model'` になる。
- `status` / `questionnaire` では regeneration context にならない。

### Phase 2. Composer display

Goal: ユーザーに「どの artifact への注文か」が明確に伝わる表示にする。

Files:

- `src/modules/nightworkers/components/Composer.tsx`
- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

Tasks:

- `artifactContext.metadata.planModeTarget` がある場合、chip title を Plan Mode target label にする。
- chip kind は `PLAN_MODE:BLUEPRINT` のように target を含める。
- clear button は既存動作を維持する。
- chip の幅・折り返しは既存 layout の範囲で収める。

Verification:

```bash
bun run test run tests/artifact-workspace-viewer.test.ts
```

Expected:

- スクリーンショットのような `Plan Mode Workspace` 固定表示ではなく、active tab に応じた label が出る。
- 長い target label でも composer layout が崩れない。

### Phase 3. Backend direct regeneration branch

Goal: Plan Mode artifact 再生成依頼を Workbench intake gate に通さず、対象 generator に直接流す。

Files:

- `api/modules/nightworkers/nightworkers.workbench.service.ts`
- `api/modules/nightworkers/routes/task-routes.ts`
- `api/modules/blueprint/blueprint.service.ts`
- `api/modules/specification/specification.service.ts`
- `api/modules/dataModel/dataModel.service.ts`
- `api/modules/planViews/planView-generation.service.ts`

Tasks:

- `isPlanModeArtifactRegenerationContext(artifactContext)` helper を追加する。
- `appendWorkbenchMessage` で user message 保存後、再生成 context なら `handlePlanModeArtifactRegeneration` を呼ぶ。
- 再生成 branch では `decideWorkbenchPlanModeGate` を呼ばない。
- target routing:
  - `feature_plan` -> `generateFeaturePlanArtifact(taskId, { prompt, questionnaireSessionId, sourceBlueprintMessageId, proceedWithUnansweredBlocking? })`
  - `blueprint` -> `generateBlueprintArtifact(taskId, { prompt, questionnaireSessionId, sourceBlueprintMessageId })`
  - `data_model` -> `generateDataModelArtifact(taskId, { prompt, questionnaireSessionId, featurePlanMessageId, sourceBlueprintMessageId })`
  - generic view -> `generatePlanViewArtifact(taskId, view, { prompt, questionnaireSessionId, featurePlanMessageId, sourceBlueprintMessageId, sourceDataModelMessageId })`
- unknown target は 400 `UNSUPPORTED_PLAN_MODE_REGENERATION_TARGET` にする。
- task が implemented / locked の場合は既存 mutability guard に任せる。

Verification:

```bash
bun run test run tests/nightworkers-workbench-routes/routes-workbench-01.test.ts tests/nightworkers-workbench-routes/routes-workbench-02.test.ts
```

Expected:

- regeneration context 付き submit では `workbench_plan_mode_gate` が呼ばれない。
- user message は本文そのまま保存される。
- user message metadata に `artifact_context_instruction` と `artifactContext` が残る。
- generator の結果 message が返る。

### Phase 4. Prompt support for Blueprint and Feature Plan

Goal: chat 本文を generator の明示的な再生成指示として使えるようにする。

Files:

- `src/modules/blueprint/blueprintCommands.ts`
- `src/modules/specification/specificationCommands.ts`
- `api/modules/blueprint/blueprint-route-definitions.ts` or equivalent route body schema
- `api/modules/specification/specification-route-definitions.ts`
- `api/modules/blueprint/blueprint-generation.service.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/services/blueprints/mock-llm-draft.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`

Tasks:

- `BlueprintGenerationInput` に `prompt?: string` と `sourceBlueprintMessageId?: string | null` を追加する。
- `SpecificationGenerationInput` に `prompt?: string` を追加する。
- Blueprint prompt に `## User Regeneration Request` を追加する。
- Feature Plan context に `userRegenerationRequest` 相当を追加し、prompt builder で明示する。
- 既存 artifact を参照する場合でも、全量 patch ではなく再生成 output を作る方針にする。
- LLM に「指摘された変更だけを反映し、既存 artifact の良い構造は維持する」と指示する。

Verification:

```bash
bun run test run tests/services.blueprints.test.ts tests/specification-document-generation.test.ts tests/services.plan-view-generators.test.ts tests/services.data-model-generation.test.ts
```

Expected:

- Blueprint prompt に user regeneration request が含まれる。
- Feature Plan prompt に user regeneration request が含まれる。
- prompt 未指定時の既存生成は従来どおり。
- Data Model / Plan View の既存 `prompt` 経路は壊れない。

### Phase 5. Frontend cache and tab retention

Goal: 再生成後に右 pane が対象 tab を維持し、新 artifact が見える状態にする。

Files:

- `src/modules/nightworkers/hooks/nightWorkersChatActions.ts`
- `src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`

Tasks:

- backend response に `workspace` が含まれる場合、`['planModeWorkspace', sessionId]` cache を更新する。
- messages cache は既存どおり result messages で更新する。
- regeneration submit 後も route state の `tab` を維持する。
- generated message がある場合、`PlanModeWorkspaceViewer` の local `generatedMessages` と query cache の二重表示が起きないことを確認する。

Verification:

```bash
bun run test run tests/artifact-workspace-viewer.test.ts tests/nightworkers-chat-actions.test.ts
```

Expected:

- submit 後も `blueprint` tab を維持する。
- workspace の artifact count が更新される。
- 同じ generated message が重複表示されない。

### Phase 6. End-to-end regression pass

Goal: Plan Mode 以外の chat routing と Plan Mode Status actions を壊していないことを確認する。

Verification:

```bash
bun run test run tests/nightworkers-workbench-routes/routes-workbench-01.test.ts tests/nightworkers-workbench-routes/routes-workbench-02.test.ts tests/nightworkers-workbench-routes/routes-workbench-03.test.ts tests/artifact-workspace-viewer.test.ts tests/specification-status-view.test.tsx tests/nightworkers-chat-actions.test.ts tests/services.plan-view-generators.test.ts tests/services.data-model-generation.test.ts tests/services.blueprints.test.ts tests/specification-document-generation.test.ts
bun run verify:fast
bun run verify
```

Expected:

- Plan Mode artifact regeneration tests pass.
- Normal intake / implementation / review / runtime debug routing tests pass.
- Plan Mode Status buttons still generate artifacts directly.
- Questionnaire gate behavior remains unchanged.
- Repo-native verification passes.

## Test Changes

Update existing tests:

- `tests/nightworkers-workbench-routes/routes-workbench-02.test.ts`
  - Replace the expectation that active Blueprint workspace instruction does not generate Blueprint with the new regeneration behavior.
- `tests/nightworkers-workbench-routes/routes-workbench-01.test.ts`
  - Keep tests that prove `artifactContext` is persisted and included in prompt where normal intake still applies.
- `tests/artifact-workspace-viewer.test.ts`
  - Add active tab to composer context expectations.
- `tests/nightworkers-chat-actions.test.ts`
  - Add cache update coverage when backend returns `workspace`.

Add or extend focused backend tests:

- `blueprint` regeneration context calls Blueprint generator without workbench gate.
- `feature_plan` regeneration context calls Feature Plan generator without workbench gate.
- `data_model` regeneration context passes `prompt` to Data Model generator.
- `api_io_contract` regeneration context passes `prompt` to Plan View generator.
- unknown target returns 400.
- `status` / `questionnaire` tabs do not trigger regeneration branch.

## Acceptance Criteria

- Composer target reflects the currently selected Plan Mode artifact/view, not just `Plan Mode Workspace`.
- Submitting chat while `Blueprint` is active regenerates Blueprint with the submitted text as the regeneration instruction.
- Submitting chat while `Data Model` is active regenerates Data Model with the submitted text as the regeneration instruction.
- Submitting chat while generic Plan View tabs are active regenerates that specific Plan View.
- Submitting chat while `Feature Plan` is active regenerates Feature Plan with the submitted text as the regeneration instruction.
- Regeneration branch does not call Workbench intake gate.
- User message content is not rewritten.
- User message metadata preserves the artifact context.
- Existing Plan Mode Status generation buttons keep working.
- Normal Workbench chat behavior is unchanged outside regeneration context.

## Risks and Controls

### Risk: accidental implementation run

If regeneration submit goes through normal intake, the gate may classify a correction as implementation. Control: regeneration context bypasses `decideWorkbenchPlanModeGate`.

### Risk: wrong artifact target

If target comes from stale route state, user may edit the wrong artifact. Control: active target is emitted from `PlanModeWorkspaceViewer` state, and route state is only a URL mirror.

### Risk: completed/locked task mutation

Regeneration should not mutate implemented tasks. Control: keep existing `assertPlanModeMutable` checks in each generator.

### Risk: prompt support changes normal generation

Adding `prompt?: string` to Blueprint / Feature Plan must not alter existing Status generation. Control: prompt section is omitted when prompt is empty, and existing tests cover prompt-less generation.

### Risk: duplicate artifact display

Both local generated messages and query cache updates can show the same artifact twice. Control: keep existing merge-by-id behavior and add frontend test coverage.

### Risk: status/questionnaire ambiguity

`status` and `questionnaire` are not direct artifact regeneration surfaces. Control: do not set `instructionMode: 'regenerate_artifact'` for those tabs in the first implementation.

## Open Questions

- `Questionnaire` tabへの chat 指示は、追加質問生成に回すべきか、通常 intake に残すべきか。初期実装では通常 intake に残す。
- `Status` tabへの chat 指示は、どの未完了 artifact を対象にするか曖昧である。初期実装では通常 intake に残す。
- `Feature Plan` 再生成で blocking unanswered questions が残る場合、既存の confirm UI を chat submit 経路でどう扱うか。初期実装では backend 409 を返し、UI で questionnaire tab へ誘導する方針が安全。
- 再生成された artifact の旧版との関係を UI に出すか。初期実装では既存の version navigation に任せる。

## Rollout Order

1. Phase 0 で baseline を固定する。
2. Phase 1 / 2 で frontend target 表示を先に作る。
3. Phase 3 で backend direct regeneration branch を入れる。
4. Phase 4 で Blueprint / Feature Plan prompt 対応を入れる。
5. Phase 5 で cache / tab retention を仕上げる。
6. Phase 6 の targeted tests と repo-native verification を通す。

実装後、この計画書は検証完了時に `spec/archive/` へ移動する。
