# Task Generation Ontology Evidence Bridge Implementation Plan

## Use when

`spec/docs/task-generation-module-ontology-implementation-plan.md` の実装が進み、Task Generation 側で得られた Goal interpretation / TaskCandidate kind / module routing / project-wide constraints を、coding-agent module ontology と MCP context に接続する段階で使う。

この計画は、`spec/docs/coding-agent-module-ontology-implementation-plan.md` の `Unit 2: 実 task generation evidence の接続` を実装可能な粒度へ分解した下位計画である。独立した ontology roadmap ではなく、既存 coding-agent ontology 計画の Unit 2 execution plan として扱う。

この計画は、TaskCandidate 生成の意味論をさらに増やす計画ではない。すでに生成・保存されるようになったメタデータを、Codex 型エージェントが作業開始時に読める evidence として渡すための接続計画である。

対象は次の接続に絞る。

- Project Detail の Goal / Mission / TaskCandidate から task-scoped evidence を組み立てる。
- `.agent-ontology` の module manifest と Task Generation evidence を混ぜず、source truth と task hint を分離する。
- MCP の module context へ Task Generation evidence を追加する。
- `feature_entrypoint` の Plan-first handoff が、module routing と project-wide constraints を失わないようにする。
- 回帰 fixture で、候補生成の意味論と ontology context の接続を固定する。

## Relationship to Source Plans

この文書は、既存計画の責務を置き換えない。

- `coding-agent-module-ontology-implementation-plan.md`
  - source plan。
  - module ontology 全体の architecture、MCP tool contract、provenance separation、boundary gate、verification plan、agent workflow を定義する。
  - `compile_module_context` の最終 contract と source truth の優先順位はこの文書では変更しない。
- `task-generation-module-ontology-implementation-plan.md`
  - Task Generation 側の source plan。
  - Goal interpretation、TaskCandidate kind、project-wide constraints、Plan-first handoff の生成意味論を定義する。
  - この文書では、候補生成ルール自体を再設計しない。
- `task-generation-ontology-evidence-bridge-implementation-plan.md`
  - bridge implementation plan。
  - 保存済み Task Generation metadata を `taskGenerationEvidence` に変換し、coding-agent ontology の task-scoped context へ渡す実装順だけを扱う。

判断ルール:

- ontology architecture や MCP contract で矛盾した場合は、`coding-agent-module-ontology-implementation-plan.md` を優先する。
- candidate semantics で矛盾した場合は、`task-generation-module-ontology-implementation-plan.md` を優先する。
- adapter、fixture、接続順、focused verification の粒度は、この文書を優先する。

開始前提:

- `coding-agent-module-ontology-implementation-plan.md` の `Unit 1: compile_module_context provenance の安定化` が完了していること。
- `compile_module_context` が manifest / code evidence / taskGenerationEvidence を分離して返せる contract になっていること。
- この文書は Unit 1 の provenance contract を再設計せず、保存済み Task Generation metadata をその contract に渡す bridge だけを扱う。

## Implementation Impact

この文書を、すべての ontology 実装で常に必須入力にする必要はない。考慮すべき範囲は次の通り。

| 実装対象 | この文書を考慮するか | 扱い |
| --- | --- | --- |
| coding-agent ontology Unit 1 | SHOULD | 後続 Unit 2 の consumer として `taskGenerationEvidence` slot を壊さない。ただし Project Detail adapter はまだ実装しない。 |
| coding-agent ontology Unit 2 | MUST | この文書を詳細実装計画として使う。adapter、fixture、conflict handling、optional evidence の条件を満たす。 |
| coding-agent ontology Unit 3 以降 | SHOULD | Unit 2 が完了している場合だけ task-scoped context を prompt / reporting に利用する。未完了なら manifest + code evidence で継続する。 |
| task-generation module ontology Phase 3-5 | SHOULD | `candidateKind`, `moduleRouting`, `constraintGoalIds`, `planModeOpenQuestions`, candidate id を後続 bridge が読める形で保存・Task 化に残す。 |
| task-generation UI Phase 6 | MAY | evidence bridge のために UI を先行変更しない。表示対象 metadata が安定してから detail 表示へ反映する。 |
| boundary gate / strict enforcement | MUST NOT | bridge 完了前に Task Generation evidence を根拠に strict boundary enforcement を有効化しない。 |

実装判断:

- `compile_module_context` の provenance contract を変える作業では、この文書は将来 consumer として考慮する。
- 保存済み TaskCandidate を ontology context に接続する作業では、この文書を必須の実装計画として使う。
- Task Generation 側の candidate semantics を実装する作業では、この文書のために生成ルールを変えない。ただし、後続 adapter が読める metadata を欠落させない。
- Agent prompt / reporting へ広げる作業では、Unit 2 が未完了なら `taskGenerationEvidence: false` または absent として扱う。

## Current Baseline

現時点で前提にできる実装済み要素は次の通り。

- `MissionGoal` は interpretation を持てる。
- `MissionTaskCandidate` は `candidateKind`, `moduleRouting`, `constraintGoalIds`, `planModeOpenQuestions` を持てる。
- 候補生成 prompt は `feature_entrypoint`, project-wide constraints, module routing を扱う。
- 候補選別は `feature_entrypoint` を上位にし、project-wide Goal を constraint として反映する。
- Task 化 objective は candidate kind と module routing を含められる。
- coding-agent module ontology 側には `.agent-ontology` manifest、validation helper、MCP tools、boundary helper、verification plan helper がある。

不足している接続は次である。

- Task Generation evidence を独立した構造として組み立てる adapter がない。
- MCP の module context が、Project Detail の Goal / Mission / TaskCandidate を task hint として読めない。
- `compile_module_context` 相当の出力で、manifest 由来の module source truth と TaskCandidate 由来の task-scoped hint が分離されていない。
- `feature_entrypoint` を実行する Codex 側が、project-wide constraints と open questions を ontology context として参照できる保証が弱い。

## Workflow

### 1. Baseline audit

まず、既存実装のどこまでが入っているかを固定する。

確認対象:

- DB schema:
  - `mission_goals` の interpretation columns。
  - `mission_task_candidates` の `candidate_kind`, `module_routing_json`, `constraint_goal_ids_json`。
- shared schema:
  - `missionGoalInterpretationSchema`
  - `missionTaskCandidateKindSchema`
  - `missionTaskCandidateSchema.moduleRouting`
- repository/service:
  - Mission Goal 作成時の preset / user goal 初期値。
  - Candidate 保存時の metadata 永続化。
  - Task 化 objective の metadata 反映。
- UI:
  - Candidate kind 表示。
  - detail modal で module routing / constraints / open questions を確認できるか。
- ontology MCP:
  - `compile_module_context`
  - `classify_goal`
  - `get_module_ontology`
  - `get_verification_plan`

完了条件:

- 実装済みと未実装を、この文書または実装 PR の作業メモに分けて記録する。
- 既存の dirty change と新規実装を混ぜない方針を決める。
- この段階では仕様変更をしない。

検証:

```bash
git status --short
rg -n "candidateKind|moduleRouting|constraintGoalIds|goalScope|goalIntent|classification" api shared src tests
rg -n "compile_module_context|classify_goal|verification_plan|taskGenerationEvidence" api scripts tests
```

期待結果:

- Task Generation 側の metadata 保存点と、ontology MCP 側の context 出力点が特定できる。
- `taskGenerationEvidence` が未実装なら、次フェーズの新規追加対象として扱う。

### 2. Define TaskGenerationEvidence contract

Task Generation evidence を、manifest の source truth とは別の task-scoped hint として定義する。

追加候補:

```ts
type TaskGenerationEvidence = {
  source: 'nightworkers_project_detail';
  repositoryId: string;
  missionId: string | null;
  taskCandidateId: string | null;
  selectedGoalIds: string[];
  goals: Array<{
    id: string;
    title: string;
    scope: 'feature_domain' | 'project_wide' | 'unknown';
    intent: 'build' | 'maintain_threshold' | 'improve_metric' | 'unknown';
    confidencePercent: number;
    reason: string | null;
  }>;
  taskCandidate: {
    id: string;
    title: string;
    kind:
      | 'feature_entrypoint'
      | 'feature_followup'
      | 'constraint_enablement'
      | 'constraint_verification'
      | 'investigation';
    primaryModule: string | null;
    secondaryModules: string[];
    routingConfidencePercent: number;
    routingReason: string | null;
    planModeOpenQuestions: string[];
  } | null;
  projectWideConstraints: Array<{
    goalId: string;
    title: string;
    intent: string;
    reason: string | null;
  }>;
  acceptanceCriteria: string[];
  verificationHints: string[];
};
```

設計ルール:

- `primaryModule` は TaskCandidate の routing hint であり、manifest ownership の source truth ではない。
- `projectWideConstraints` は acceptance / verification / invariant hints として使う。
- `feature_entrypoint` の `planModeOpenQuestions` は、Task 化後も失わない。
- unknown / low confidence は、強制 routing ではなく Plan mode の未確定事項として渡す。
- evidence は repo file mutation を行わない read model として扱う。

完了条件:

- contract が shared schema または ontology service 内の型として表現される。
- null / absent / stale candidate を扱える。
- source truth と task hint の責務差がコメントまたはドキュメントで明示される。

検証:

```bash
bun run typecheck
```

期待結果:

- 型追加後も既存 schema と repository code が破綻しない。

### 3. Build evidence adapter

Project Detail の既存データから `TaskGenerationEvidence` を作る adapter を追加する。

候補配置:

- `api/modules/project-detail/project-detail.service.ts`
- または責務を分ける場合:
  - `api/modules/project-detail/task-generation-evidence.service.ts`

入力候補:

- `repositoryId`
- `missionId`
- `taskCandidateId`
- Task 実行時の request context から解決できる `taskId`

処理:

1. 対象 repository を確認する。
2. candidate が指定されていれば、TaskCandidate を取得する。
3. `taskId` が指定されていれば、`mission_task_candidates.task_id` から TaskCandidate を取得する。
4. candidate の `goalId` と `constraintGoalIds` から関連 Goal を取得する。
5. active project-wide Goals を必要に応じて含める。
6. candidate の `moduleRouting` を task hint として正規化する。
7. `acceptanceCriteria`, `verificationPlan`, `planModeOpenQuestions` を evidence に分解する。
8. 参照不能な ID があっても、失敗ではなく reason 付きの partial evidence にする。

完了条件:

- candidate あり、mission あり、taskId からの candidate 解決、candidate なしの経路で evidence が返る。
- TaskCandidate の `constraintGoalIds` が project-wide constraints に反映される。
- `feature_entrypoint` の open questions が保持される。
- LLM API は呼ばない。

検証:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/services.mission-task-candidates.test.ts
```

期待結果:

- 既存の候補生成テストを壊さない。
- 新規テストで `feature_entrypoint` evidence、project-wide constraints、unknown routing を確認できる。

### 4. Expose evidence to ontology MCP context

coding-agent module ontology の MCP context に Task Generation evidence を渡せるようにする。

実装候補:

- `compile_module_context` の入力に `taskCandidateId` / `missionId` / `repositoryId` を追加する。
- Codex MCP の request context に `taskId` または `runId` がある場合は、ユーザーに追加入力を求めず TaskCandidate evidence を解決する。
- 既存 tool contract を壊したくない場合は optional input にする。
- 既存の直接指定 `taskGenerationEvidence` input は維持し、ID 指定による evidence 取得は additive な導線として追加する。
- service 側で Project Detail adapter を呼び、出力に `taskGenerationEvidence` を追加する。

出力の責務分離:

```json
{
  "module": { "source": "manifest" },
  "codeEvidence": { "source": "repository" },
  "taskGenerationEvidence": { "source": "nightworkers_project_detail" },
  "summary": {
    "canonicalDomainSummary": "...",
    "taskScopedSummary": "..."
  }
}
```

ルール:

- manifest がない repository でも `taskGenerationEvidence` は返せる。
- TaskCandidate の `primaryModule` と manifest の module id が一致しない場合は、強制補正しない。`routingConflict` として出す。
- Task Generation evidence がない通常の coding-agent usage は壊さない。
- MCP tool は read-only のままにする。

完了条件:

- `compile_module_context` が optional な Task Generation evidence を返せる。
- evidence がない場合の出力は既存互換。
- routing conflict / unknown / missing candidate を構造化して返す。

検証:

```bash
node scripts/agent-ontology/smoke-mcp-contract.mjs
bunx vitest run tests/agent-ontology.test.ts tests/nightworkers-codex-mcp-integration.test.ts
```

期待結果:

- 既存 MCP contract が維持される。
- TaskCandidate 指定時、または TaskCandidate から作成された Task / Run context のときだけ `taskGenerationEvidence` が追加される。

### 5. Add task-scoped summary generation without LLM

まずは LLM API を呼ばず、deterministic な task-scoped summary を作る。

summary に含める内容:

- candidate title / kind。
- primary module / secondary modules。
- routing confidence / reason。
- project-wide constraints。
- acceptance criteria。
- verification hints。
- Plan mode open questions。
- unknown / low confidence の注意。

summary に含めない内容:

- manifest に存在しない owned paths の発明。
- 実装済みと断定できない domain model。
- project-wide Goal を primary module の source truth に昇格すること。

完了条件:

- `feature_entrypoint` の context で、Plan mode が何を決めるべきか読める。
- `project_wide` Goal が verification / constraints として見える。
- summary が missing metadata に強い。

検証:

```bash
node scripts/agent-ontology/compile-module-context.mjs --goal "Project Detail Mission task candidate UI" --primary project-detail --taskGenerationEvidence
node scripts/agent-ontology/smoke-mcp-contract.mjs
```

期待結果:

- CLI / MCP の出力に task-scoped summary を含めても、既存の manifest summary が上書きされない。

### 6. Wire Task creation to ontology context

TaskCandidate から Task を作るとき、objective に入っている metadata と ontology MCP context が対応するようにする。

実装方針:

- Task objective に `taskCandidateId` を含められるなら含める。
- Codex / composer / supervisor が読む metadata に、candidate kind と routing hint を落とさない。
- `feature_entrypoint` は Plan-first のまま維持する。
- Task 実行時に MCP context を引ける場合は、`taskCandidateId` を直接渡すか、request-scoped `taskId` / `runId` から candidate を解決する導線を用意する。

完了条件:

- Task 化された objective と MCP context の taskGenerationEvidence が同じ candidate を指す。
- project-wide constraints が objective と context の両方に残る。
- open questions が Plan mode で扱うべき未確定事項として残る。

検証:

```bash
bunx vitest run tests/project-detail-backend.test.ts
```

期待結果:

- `createTaskFromMissionCandidate` 系のテストで、candidate kind / module routing / constraints / open questions が欠落しない。

### 7. Add regression fixtures

Task Generation と ontology bridge の接続を壊さないため、fixture を追加する。

必須 fixture:

1. `todolist を作る`
   - `feature_entrypoint` が最上位。
   - title は `todolist 機能の初期実装計画を作成する`。
   - Plan mode open questions を持つ。
2. `todolist を作る` + coverage preset
   - coverage Goal は independent candidate ではなく constraint。
   - evidence に project-wide constraint と verification hint が出る。
3. ontology manifest あり
   - TaskCandidate routing と manifest module が一致した場合、task-scoped summary に primary module が出る。
4. ontology manifest なし
   - generation / evidence / MCP context が失敗しない。
   - routing confidence は低く、reason が出る。
5. routing conflict
   - TaskCandidate の primary module と manifest 候補が食い違う場合、補正せず conflict として出る。

完了条件:

- LLM 出力揺れに依存しない deterministic test を用意する。
- prompt 文言変更で重要な意味論が崩れた場合に検知できる。

検証:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts tests/agent-ontology.test.ts tests/nightworkers-codex-mcp-integration.test.ts
```

期待結果:

- candidate semantics と ontology context の接続が同時に確認できる。

### 8. UI detail confirmation

UI は接続が安定してから最小限だけ補強する。

対象:

- Candidate detail modal。
- TaskCandidate row の kind / confidence 表示。
- project-wide constraints の表示。
- Plan mode open questions の表示。

やらないこと:

- Goal / Mission / TaskCandidate 画面全体の再設計。
- ontology manifest editor の追加。
- DDD 用語をユーザー向け UI に増やすこと。

完了条件:

- ユーザーが、候補の種類、module routing、制約 Goal、未確定事項を detail で確認できる。
- 表示は i18n dictionary に追加する。

検証:

```bash
bunx vitest run tests/project-detail-screen.test.tsx
```

期待結果:

- 既存表示を壊さず、metadata がある候補だけ追加情報を表示する。

### 9. Final verification

最後に、Task Generation 側と ontology MCP 側の focused gate を通す。

実行候補:

```bash
bunx vitest run tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts tests/project-detail-screen.test.tsx
bunx vitest run tests/agent-ontology.test.ts tests/nightworkers-mcp-manifest.test.ts tests/nightworkers-codex-mcp-integration.test.ts
node scripts/agent-ontology/validate-manifests.mjs
node scripts/agent-ontology/smoke-mcp-contract.mjs
bun run typecheck
bun run verify:fast
```

完了条件:

- TaskCandidate 生成の意味論が維持される。
- Project Detail の Task 化で metadata が欠落しない。
- ontology MCP context が Task Generation evidence を optional に扱える。
- manifest source truth と task-scoped hint が混ざらない。
- `verify:fast` が通る、または既知の unrelated failure として切り分けられる。

## Verification

この計画全体の完了条件は次である。

- `feature_entrypoint` TaskCandidate から、Codex 型エージェントが読む task-scoped ontology context を作れる。
- project-wide Goal が独立候補ではなく、constraints / verification hints として context に出る。
- TaskCandidate の `moduleRouting` は hint として扱われ、manifest の ownership source truth を上書きしない。
- ontology manifest がない repository でも evidence bridge が失敗しない。
- routing conflict / low confidence / unknown が構造化され、Plan mode の未確定事項として扱える。
- MCP tool / CLI / tests のどれかで、Task Generation evidence を確認できる。

## Avoid

- Task Generation evidence を canonical domain summary の source truth にしない。
- TaskCandidate の `primaryModule` を manifest ownership として自動採用しない。
- LLM API をこの段階で必須にしない。
- Goal 登録時の LLM 分類を追加しない。
- project-wide Goal を本流 feature candidate より上位の独立タスクに戻さない。
- UI の大規模再設計を同時に行わない。
- strict boundary gate の強制適用をこの計画に含めない。
- `.agent-ontology` manifest を全 module に拡張する作業を混ぜない。
- unrelated な pricing / settings / quality UI 変更をこの計画の完了条件に含めない。
