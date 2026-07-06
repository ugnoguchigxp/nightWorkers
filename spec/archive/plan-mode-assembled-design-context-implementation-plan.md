# Plan Mode Assembled Design Context Implementation Plan

## Purpose

Plan Mode の `Feature Plan` から契約詳細の再掲を減らし、契約の正本を各 Plan Mode artifact に寄せる。

`Feature Plan` は実装前に読む実行計画として、目的、スコープ、タスク分類、実装計画、検証計画、完了条件を残す。API、UI、DB、Zod schema、flow などの詳細契約は `Questionnaire`、`Blueprint`、`Data Model`、`API Contract`、`Zod Schema`、dedicated flow view から組み立てた `assembledDesignContext` として runtime に渡す。

目的は spec をなくすことではない。`## 契約` と `## DDL` の二重化を減らし、後続 worker が同じ情報を標準導線で読める状態を保つ。

## Confirmed Baseline

現状の `Feature Plan` 生成は、次の情報を `api/modules/specification/specification-document-renderer.ts` で集約している。

- `Questionnaire Decisions`
- `Blueprint Summary`
- `Data Model DDL Reference`
- `Plan View References`
- `Plan Mode References`
- `Traceability`

その後、`api/services/structured-generation/prompts/design-questionnaire.ts` の `buildSpecificationDocumentSystemPrompt` が `## 契約` と `## DDL` を本文に出すよう指示している。

現状の runtime 導線:

- Native API runner は startup で `read_current_specification` を必須 gate として実行する。
- `context_compile` には `read_current_specification` の spec content 要約だけが渡る。
- Codex SDK lane も explicit planning / specification work では `nightworkers.read_current_specification` を読むよう指示している。
- `read_current_specification` は spec markdown と軽い `sources` だけを返し、各 Plan Mode artifact から組み立てた契約詳細は返していない。

関連ファイル:

- `api/modules/specification/specification-document-renderer.ts`
- `api/modules/specification/specification-generation.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `api/services/worker-tools/read-current-specification.ts`
- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/modules/specification/plan-mode-workspace.service.ts`
- `api/modules/planViews/planView-generation.service.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/workspace-panels/*`

## Scope

In scope:

- `Feature Plan` 本文から契約詳細の再掲を減らす。
- 各 Plan Mode artifact から `assembledDesignContext` を組み立てる backend helper を追加する。
- `read_current_specification` で spec と assembled design context を同じ導線から読めるようにする。
- Native API runner startup で assembled design context を provider history / context compile input に渡す。
- Codex SDK runtime prompt で、spec と assembled design context の読み分けを明示する。
- compact view の section 抽出を日本語見出しに対応させる。
- 既存 tests を、spec 本文契約から artifact-assembled context へ期待値を移す。

Out of scope:

- Plan Mode artifact generator の全面再設計。
- Blueprint / Data Model / API Contract / Zod Schema の schema 大改修。
- Plan Mode Workspace UI の全面再設計。
- 既存 artifact の DB migration。
- 完了済み artifact の再生成。
- `Questionnaire` の質問設計変更。
- Codex / Native API runner 以外の runtime lane の大幅な作り替え。

## Target Behavior

### Feature Plan body

`Feature Plan` 本文の標準見出しは次に寄せる。

```md
## 目的
## スコープ
## タスク分類
## 実装計画
## 検証計画
## 完了条件
## トレーサビリティ
```

`## トレーサビリティ` は任意だが、artifact source を短く示すために残してよい。

`## 契約` と `## DDL` は原則として本文に出さない。必要な場合でも、詳細の再掲ではなく参照方針だけにする。

例:

```md
## 実装計画

1. API 入出力は API Contract artifact を正として route/schema を更新する。
2. UI は Blueprint artifact の採用 screen/section を正として実装する。
3. DB 変更は Data Model artifact の DDL を正として schema/migration を作成する。
```

### Assembled design context

`assembledDesignContext` は実行時に worker が読む契約詳細である。

最低限の payload:

```ts
type AssembledDesignContext = {
  taskId: string;
  generatedAt: string;
  summary: string;
  sections: Array<{
    kind:
      | 'questionnaire'
      | 'blueprint'
      | 'data_model'
      | 'api_io_contract'
      | 'zod_schema_design'
      | 'user_flow'
      | 'activity_flow'
      | 'sequence_flow'
      | 'decision_review';
    title: string;
    sourceMessageId?: string | null;
    digest?: string | null;
    content: string;
  }>;
  sourceMessageIds: string[];
  omittedViews: Array<{ view: string; reason?: string }>;
  warnings: string[];
};
```

Rules:

- `content` は raw JSON 全文ではなく、実装判断に必要な圧縮済み contract にする。
- API Contract は endpoint / method / request / response / error / validation を短く含める。
- Blueprint は route / screen / section / component / visible state / sample を短く含める。
- Data Model は canonical source、DDL、table / relation / constraint の要約を含める。
- Zod Schema は schemaName、owner、fields、enum、validation behavior を含める。
- Flow view は Mermaid source と補助 note を含める。ただし実装手順の重複説明は避ける。
- `Questionnaire` は採用判断と unresolved blocking question を含める。
- `sourceMessageIds` と digest は監査と再実行確認のために残す。

## Implementation Plan

### Phase 0. Baseline and Test Lock

Goal: 変更前の参照導線と spec 出力を固定する。

Tasks:

- 現行の `buildSpecificationDocumentSystemPrompt` が `## 契約` / `## DDL` を要求していることをテストで確認する。
- `read_current_specification` が spec markdown だけを返す現状を確認する。
- Native API startup の `read_current_specification` gate と `context_compile` input を確認する。
- Codex SDK prompt の `nightworkers.read_current_specification` guidance を確認する。

Verification:

```bash
bunx vitest run tests/specification-document-generation.test.ts tests/services.spec-document-renderer.test.ts tests/read-current-specification-tool.test.ts
```

Stop condition:

- baseline tests が現状と一致しない場合、移行実装に進まない。

### Phase 1. Add Assembled Design Context Builder

Goal: spec 生成用 context と runtime 用 assembled context を分離する。

Files:

- `api/modules/specification/specification-document-renderer.ts`
- new `api/modules/specification/assembled-design-context.ts` or equivalent
- tests under `tests/services.spec-document-renderer.test.ts` or a new focused test

Tasks:

- `buildSpecificationDocumentContext` に混在している `Blueprint Summary`、`Data Model DDL Reference`、`Plan View References`、`Plan Mode References` の圧縮 logic を再利用できる helper に切り出す。
- `buildAssembledDesignContext({ task, session, workspace, messages, projectStackContext })` を追加する。
- `AssembledDesignContext` の markdown projection を追加する。
- source message id と digest を section ごとに付与する。
- missing artifact は warning として返し、存在しない契約を推測しない。

Verification:

```bash
bunx vitest run tests/services.spec-document-renderer.test.ts
```

Expected:

- API Contract / Zod Schema / Blueprint / Data Model の要約が assembled context に入る。
- `Feature Plan` 本文生成用 context は引き続き作れる。
- artifact が未生成の場合は fallback text と warning が出る。

### Phase 2. Extend `read_current_specification`

Goal: worker が spec と assembled design context を同じ標準導線で読めるようにする。

Files:

- `api/services/worker-tools/read-current-specification.ts`
- `api/services/worker-tools/dispatcher.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/mcp/nightworkers-tool-manifest.ts`
- `tests/read-current-specification-tool.test.ts`
- `tests/native-api-runner/result-projector.cases.ts`

Tasks:

- `ReadCurrentSpecificationInput` に `includeDesignContext?: boolean` を追加する。
- もしくは `view` に `assembled` を追加する。推奨は互換性のため `includeDesignContext`。
- `ReadCurrentSpecificationOutput` に `assembledDesignContext?: AssembledDesignContext` を追加する。
- `sources` を拡張し、`assembledDesignContextIncluded` と `sourceMessageIds` を返す。
- model-visible projection では spec 本文と assembled context を分けて表示する。
- compact output は token budget を守るため、assembled context section ごとに上限を持つ。

Verification:

```bash
bunx vitest run tests/read-current-specification-tool.test.ts tests/native-api-runner/result-projector.cases.ts
```

Expected:

- default は既存互換で spec markdown を返す。
- `includeDesignContext=true` では assembled context も返る。
- `view='full'` でも assembled context は raw JSON 全文ではなく圧縮済み contract を返す。

### Phase 3. Wire Runtime Startup

Goal: 実装 run の startup で assembled design context を確実に provider に渡す。

Files:

- `api/services/agent-runtime/native-api-runner/native-api-startup-controller.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-result-projector.ts`
- `tests/services.native-api-runner-startup.test.ts`
- `tests/native-api-runner/dispatcher-gates.cases.ts`

Tasks:

- Native API startup の `runSpecificationGate` で `read_current_specification` を `includeDesignContext=true` で呼ぶ。
- `renderSpecificationHistory` に `[Assembled Design Context]` section を追加する。
- `buildContextCompileArguments` の goal に assembled context の digest / source summary を含める。
- `context_compile` へ全文を渡しすぎない。goal には spec 要点と assembled context summary だけを入れる。
- `read_current_specification` が missing の resume fallback は既存通り維持する。

Verification:

```bash
bunx vitest run tests/services.native-api-runner-startup.test.ts tests/native-api-runner/dispatcher-gates.cases.ts
```

Expected:

- startup history に spec と assembled context の両方が入る。
- `context_initial_instructions` / `context_compile` の順序 gate は維持される。
- spec missing resume fallback は壊れない。

### Phase 4. Update Codex SDK Lane Guidance

Goal: Codex MCP lane でも artifact-assembled contract を読む前提を明示する。

Files:

- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/mcp/nightworkers-tool-manifest.ts`
- `tests/codex-agent-runtime/config-prompt.cases.ts`
- `tests/nightworkers-mcp-manifest.test.ts`

Tasks:

- prompt guidance を「specification content」だけではなく「specification + assembled design context」に更新する。
- explicit planning / implementation grounded in spec では `nightworkers.read_current_specification` を `includeDesignContext=true` で読むよう説明する。
- planning mode の read-only tool 制限は維持する。
- MCP manifest の tool description に assembled design context option を明記する。

Verification:

```bash
bunx vitest run tests/codex-agent-runtime/config-prompt.cases.ts tests/nightworkers-mcp-manifest.test.ts
```

Expected:

- Codex runtime prompt に assembled design context の読み方が出る。
- planning mode の mutating tool 制限は変わらない。

### Phase 5. Thin Feature Plan Contract Sections

Goal: spec 本文から契約詳細の二重化を外す。

Files:

- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `api/modules/specification/specification-document-renderer.ts`
- `tests/specification-document-generation.test.ts`
- `tests/services.spec-document-renderer.test.ts`
- `tests/read-current-specification-tool.test.ts`

Tasks:

- `buildSpecificationDocumentSystemPrompt` の標準見出しから `## 契約` と `## DDL` を外す。
- API / UI / DB / validation の詳細は assembled design context にある前提に変更する。
- `## 実装計画` には artifact の正本参照を短く入れるよう指示する。
- `## トレーサビリティ` には source ID 羅列ではなく、採用 artifact 種別と digest / source count の短い要約だけを許可する。
- `ensureSpecificationDdlSection` を削除または互換 fallback に変更する。新規生成では DDL を spec 末尾に自動追加しない。
- `buildImplementationPlanGuidance` から `## 契約` への反映指示を削る。

Verification:

```bash
bunx vitest run tests/specification-document-generation.test.ts tests/services.spec-document-renderer.test.ts tests/read-current-specification-tool.test.ts
```

Expected:

- system prompt が `## 契約` / `## DDL` を要求しない。
- `Feature Plan` の本文構造は目的、スコープ、タスク分類、実装計画、検証計画、完了条件を保つ。
- assembled design context には契約詳細が残る。

### Phase 6. Japanese Compact Section Extraction

Goal: 薄い日本語 spec でも compact view が実装に必要な section を落とさない。

Files:

- `api/services/worker-tools/read-current-specification.ts`
- `tests/read-current-specification-tool.test.ts`

Tasks:

- `selectSpecificationSections` の keyword に日本語見出しを追加する。
- default compact:
  - `目的`
  - `スコープ`
  - `タスク分類`
  - `実装計画`
  - `検証計画`
  - `完了条件`
- `view='implementation'`:
  - `実装計画`
  - `スコープ`
  - `タスク分類`
- `view='verification'`:
  - `検証計画`
  - `完了条件`
- `view='ui'` は spec 本文から UI 詳細を探しすぎず、assembled design context の Blueprint section を優先する。

Verification:

```bash
bunx vitest run tests/read-current-specification-tool.test.ts
```

Expected:

- 日本語見出しだけの長い `Feature Plan` でも compact view が必要 section を返す。
- `view='full'` は従来通り全文を返す。

### Phase 7. UI and Status Surface Alignment

Goal: Plan Mode Workspace 上でも契約詳細の正本が artifact 側にあることを確認できる。

Files:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/workspace-panels/PlanWorkspaceStatusView.tsx`
- `src/modules/planMode/workspace-panels/ApiContractViewer.tsx`
- `src/modules/planMode/workspace-panels/WorkspaceDataModelPanel.tsx`
- `tests/artifact-workspace-viewer.test.ts`
- `tests/specification-status-view.test.tsx`

Tasks:

- Status surface で generated artifact と omitted view の状態を確認できる既存表示を維持する。
- included だが未生成の Plan View tab は出さず、Status の生成 step に集約する。
- API Contract / Data Model / Zod Schema の viewer が実装契約を十分に表示できることを確認する。
- Feature Plan tab は薄い spec 本文として表示する。契約詳細を補うための重複 UI を追加しない。

Verification:

```bash
bunx vitest run tests/artifact-workspace-viewer.test.ts tests/specification-status-view.test.tsx
```

Expected:

- generated artifact がある場合だけ dedicated view tab が表示される。
- API Contract viewer に parameters / request body / responses / validation が表示される。
- Data Model viewer に canonical source / DDL / relation が表示される。

## Final Verification

Focused checks:

```bash
bunx vitest run \
  tests/specification-document-generation.test.ts \
  tests/services.spec-document-renderer.test.ts \
  tests/read-current-specification-tool.test.ts \
  tests/services.plan-view-generators.test.ts \
  tests/artifact-workspace-viewer.test.ts \
  tests/specification-status-view.test.tsx \
  tests/services.native-api-runner-startup.test.ts \
  tests/codex-agent-runtime/config-prompt.cases.ts
```

Repository gate:

```bash
bun run verify:fast
bun run verify
git diff --check
```

Manual checks:

- Plan Mode で Questionnaire、Blueprint、Data Model、API Contract、Zod Schema を生成する。
- Feature Plan を生成し、`## 契約` と `## DDL` の詳細再掲がないことを確認する。
- `read_current_specification includeDesignContext=true` 相当の tool call で assembled design context が返ることを確認する。
- Native API implementation run の startup history に assembled design context が含まれることを確認する。
- Codex MCP lane の prompt guidance が assembled design context を読むようになっていることを確認する。

## Rollback Plan

Rollback condition:

- assembled design context が runtime startup に渡らない。
- `read_current_specification` の互換性が壊れる。
- Feature Plan から契約詳細を薄くした結果、後続実装が artifact contract を読めない。
- compact view が日本語 spec の必要 section を落とす。

Rollback steps:

1. `buildSpecificationDocumentSystemPrompt` の `## 契約` / `## DDL` 生成指示を一時的に戻す。
2. `ensureSpecificationDdlSection` の自動追加を戻す。
3. `read_current_specification` の新 payload は後方互換の optional field として残し、既存 default を壊さない。
4. runtime startup の `includeDesignContext=true` 呼び出しだけを外す。
5. focused tests を再実行し、旧 spec 契約経路が復旧したことを確認する。

## Acceptance Criteria

- `Feature Plan` 本文は目的、スコープ、タスク分類、実装計画、検証計画、完了条件を保持している。
- 新規生成の `Feature Plan` は契約詳細を `## 契約` / `## DDL` として再掲しない。
- `assembledDesignContext` が Questionnaire / Blueprint / Data Model / API Contract / Zod Schema / flow view から組み立てられる。
- `read_current_specification` から spec と assembled design context を同じ標準導線で取得できる。
- Native API runner startup が assembled design context を provider に渡す。
- Codex MCP lane の guidance が assembled design context の読み方を示す。
- 日本語見出しの compact spec view が実装計画と検証計画を落とさない。
- focused tests と `bun run verify:fast` / `bun run verify` が成功する。

