# Coding Agent Module Ontology Implementation Plan

## Purpose

Codex のようなコーディングエージェントに、DDD 的な機能モジュール・オントロジーを意識させ、探索範囲、編集範囲、越境判断、検証、完了報告を制御できるようにする。

この計画は特定アプリケーションへ DDD を導入する計画ではない。対象は、コーディングエージェントの認識・行動プロトコルである。

狙いは次の4点に絞る。

- ユーザー goal から primary module / secondary modules を推定し、作業開始時の探索範囲を狭める。
- module ごとの責務、用語、owned paths、invariants、forbidden mutations、verification を manifest として与える。
- module 境界を越える変更を禁止ではなく明示コスト化し、越境理由なしの編集を防ぐ。
- MCP / prompt / reporting / verification を同じ ontology contract に揃え、単なる注意書きではなく実行時プロトコルにする。

## Design Direction

### 実行主体を分ける

この計画では、同じ「ontology」という語で複数の責務を混ぜない。

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Repository manifest | module の source truth を保持する | LLM 推測や過去履歴で暗黙更新しない |
| Local helper | manifest と file path を deterministic に検査する | LLM API や外部状態に依存しない |
| Ontology MCP | manifest、code evidence、task generation evidence、memory を集約して agent context を返す | repository file を直接 mutation しない |
| LLM synthesis | evidence pack を短い構造化要約へ圧縮する | owned paths、invariants、verification を発明しない |
| Coding agent | 要約と boundary gate に従って探索・編集・検証する | module 境界や source truth を自己判断だけで上書きしない |

### DDD をコード構造ではなくエージェントの世界モデルとして使う

エージェントに `Entity`, `Value Object`, `Aggregate` の全用語を強制するのではなく、まず次の概念だけを実行時に使わせる。

- `module`: 変更責務を持つ機能境界。
- `concept`: module 内のユビキタス言語。
- `responsibility`: module が担うこと。
- `invariant`: 変更後も壊してはいけない意味論。
- `boundary`: module が所有する範囲と越境条件。
- `verification`: module の完了確認。

この計画で扱う DDD は、設計美学ではなく、エージェントの探索・編集・検証を制約するための ontology layer である。

### プロンプトだけに頼らない

`AGENTS.md` や system prompt に「境界を守る」と書くだけでは弱い。効果を出すには、同じ contract を次の層に置く。

- Repository 内の module ontology manifest。
- MCP で取得できる module context。
- エージェントの作業開始プロトコル。
- 編集前の boundary gate。
- 検証計画の自動提示。
- 完了報告フォーマット。

### goal と module は完全一致させない

実務の goal は複数 module をまたぐことがあるため、`goal = module` と固定しない。

代わりに、作業ごとに次の関係を明示する。

```yaml
primaryModule: billing
secondaryModules:
  - overview
integrationBoundaries:
  - pricing-provider
```

原則:

- primary module 内の探索と編集を最優先する。
- secondary module は goal 達成に必要な範囲だけ触る。
- allowed cross-module 以外の編集は boundary crossing として理由を記録する。
- forbidden mutation に該当する編集は、ユーザー承認なしに行わない。

## Terms

### Module Ontology Manifest

機能 module ごとの agent-facing contract。責務、用語、所有範囲、禁止事項、検証方法を定義する。

### Module Index

repository 内の manifest を列挙し、goal classification の候補集合を作る index。

### Goal Routing

ユーザー goal を `primaryModule`, `secondaryModules`, `changeType`, `risk`, `confidence` に分類する処理。

Routing confidence が低い場合は、実装候補を確定せず、`unknown` または `emerging` として調査・Plan mode・ユーザー確認へ送る。

### Boundary Gate

編集計画または実際の touched files が module 境界を越えていないかを判定する処理。

### Boundary Crossing

primary module の所有範囲外に触る変更。禁止ではないが、理由、対象、範囲、検証を明記する。

### Invariant Check

module manifest に定義された意味論的制約が、変更後も成立しているか確認すること。

### Code Evidence

MCP または local helper が repository から抽出する現在の実装事実。exports、routes、schemas、DB tables、tests、import edges、recent touched files などを含む。

### Task Generation Evidence

NightWorkers の Goal / Mission / TaskCandidate 生成で得られた goal interpretation、module routing、candidate kind、project-wide constraints。task-scoped summary の手がかりであり、module ownership の source truth ではない。

### Canonical Domain Summary

module manifest と code evidence から作る安定要約。module 自体の責務・境界・invariants を説明する。

### Task-Scoped Summary

特定の user goal、GoalRouting、TaskCandidateKind、project-wide constraints を考慮して作る一時要約。Codex 型エージェントがその作業の開始時に読む。

## Scope

In scope:

- module ontology manifest の schema を定義する。
- manifest を repository に配置する conventions を定義する。
- goal routing の入出力 contract を定義する。
- MCP tool またはローカル helper として必要な操作を定義する。
- Codex 型エージェントの作業プロトコルに組み込む prompt contract を定義する。
- boundary crossing の判定と完了報告の contract を定義する。
- verification plan を module ontology から導出する流れを定義する。
- 段階導入手順と検証方法を定義する。

Out of scope:

- すべての repository を DDD 構造へ再編成すること。
- module ごとに `Entity`, `Value Object`, `Aggregate` を必ず定義すること。
- AI が完璧に domain modeling できる前提で自動編集を広げること。
- 全ファイルを機械的に `modules/*` 配下へ移動すること。
- goal classification を keyword regex だけで実装すること。
- 越境変更を完全禁止すること。
- 検証不能な ontology を運用ルールとして採用すること。

## Target Behavior

### 作業開始時

エージェントは編集前に次を行う。

1. ユーザー goal を短く再記述する。
2. `primaryModule` を1つ選ぶ。
3. 必要な `secondaryModules` を列挙する。
4. primary module の manifest を読む。
5. module の `ownedPaths` を優先して探索する。
6. `invariants`, `forbiddenMutations`, `verification` を計画に反映する。

Routing が低 confidence の場合:

- 既存 module に対応しない新機能は `primaryModule: emerging` として扱う。
- module が判定不能な修正依頼は `primaryModule: unknown` として扱う。
- `emerging` / `unknown` では、編集前に repository-wide 実装へ進まず、まず調査、Plan mode、またはユーザー確認を行う。
- `emerging` の Plan mode では、新 module manifest の候補 boundary を成果物に含める。

### 探索時

エージェントはまず primary module の owned paths を探索する。

探索中に別 module のファイルや責務が出てきた場合は、ただちに boundary crossing candidate として扱う。関連しそうという理由だけで編集しない。

### 編集前

エージェントは編集計画に対して boundary gate を通す。

Gate の結果は次のいずれかにする。

```ts
type BoundaryGateResult =
  | { decision: 'allow'; reason: string }
  | { decision: 'allow_with_crossing'; crossings: BoundaryCrossing[] }
  | { decision: 'needs_user_confirmation'; reason: string; crossings: BoundaryCrossing[] }
  | { decision: 'reject'; reason: string };
```

### 編集後

エージェントは touched files と module manifest を照合し、次を完了報告に含める。

- primary module。
- secondary modules。
- owned paths touched。
- boundary crossings。
- forbidden areas touched。
- invariants checked。
- verification run。
- verification skipped reason。

## Repository Artifacts

### Module index

推奨配置:

```text
.agent-ontology/
  modules.yaml
  modules/
    billing.yaml
    settings.yaml
    overview.yaml
```

別案:

```text
modules/
  billing/
    AGENT_MODULE.md
    module.ontology.yaml
```

初期実装では `.agent-ontology/` のような集中配置を推奨する。既存 repository のディレクトリ構造を変えずに導入でき、agent / MCP が読みやすいためである。

### `.agent-ontology/modules.yaml`

```yaml
version: 1
modules:
  - id: billing
    label: Billing
    manifest: modules/billing.yaml
    aliases:
      - pricing
      - cost
      - usage cost
  - id: settings
    label: Settings
    manifest: modules/settings.yaml
    aliases:
      - preferences
      - configuration
  - id: overview
    label: Overview
    manifest: modules/overview.yaml
    aliases:
      - dashboard
      - summary
```

### Module manifest schema

```yaml
version: 1
id: billing
label: Billing

summary: >
  Calculates, stores, imports, and displays usage cost information.

ubiquitousLanguage:
  - name: PricingRule
    meaning: Unit price definition used to calculate cost from usage.
  - name: TokenUsage
    meaning: Input/output token counts recorded for a provider call.
  - name: RunCost
    meaning: Derived cost for one execution or grouped executions.
  - name: ProviderAlias
    meaning: Normalized provider identifier used for lookup.

responsibilities:
  - Import pricing data.
  - Normalize provider and model identifiers for cost lookup.
  - Calculate cost from persisted pricing and usage rows.
  - Expose cost aggregates to consumers.

ownedPaths:
  - api/modules/billing/**
  - src/modules/billing/**
  - shared/schemas/billing*.ts

readMostlyPaths:
  - api/modules/settings/**
  - src/modules/overview/**

ownedData:
  tables:
    - llm_model_pricing
    - llm_usage_logs
  files:
    - data/pricing-cache.json

invariants:
  - id: pricing-derived-cost
    statement: Cost must be derived from persisted pricing rows, not hard-coded constants.
    check: Unit tests cover known model/provider normalization and cost calculation.
  - id: provider-model-normalization
    statement: Provider and model aliases must be normalized before pricing lookup.
    check: Tests include provider alias and model suffix variants.
  - id: missing-pricing-visible
    statement: Missing pricing must be surfaced as unknown or unavailable, not silently zero.
    check: UI and API tests cover missing pricing rows.

allowedMutations:
  - pricing import logic
  - cost aggregation logic
  - billing API contract
  - billing display components

forbiddenMutations:
  - provider routing policy
  - task execution policy
  - unrelated dashboard layout
  - authentication or account model

allowedCrossModule:
  - module: settings
    paths:
      - api/modules/settings/**
      - src/modules/settings/**
    reason: Pricing import UI may read or update provider configuration.
  - module: overview
    paths:
      - src/modules/overview/**
    reason: Cost aggregate may be displayed as a KPI.

verification:
  baseline:
    - command: bunx vitest run tests/billing-cost.test.ts
      expect: Current focused billing tests pass before edits.
  focused:
    - command: bunx vitest run tests/billing-cost.test.ts tests/routes.billing.test.ts
      expect: Pricing import and cost propagation tests pass.
  full:
    - command: bun run verify
      expect: Repository verification passes.

completionReport:
  require:
    - primaryModule
    - boundaryCrossings
    - invariantsChecked
    - verification
```

## MCP Tools

### `list_modules`

Returns module index.

Input:

```json
{}
```

Output:

```json
{
  "version": 1,
  "modules": [
    {
      "id": "billing",
      "label": "Billing",
      "aliases": ["pricing", "cost"],
      "manifestDigest": "sha256:..."
    }
  ]
}
```

### `classify_goal`

Classifies a user goal into module routing.

Input:

```json
{
  "goal": "Show average cost per run on the overview screen",
  "repoPath": "/path/to/repo"
}
```

Output:

```json
{
  "primaryModule": "billing",
  "secondaryModules": ["overview"],
  "changeTypes": ["api", "ui", "test"],
  "risk": "medium",
  "confidence": 0.78,
  "reason": "Goal changes billing aggregate semantics and displays them in overview."
}
```

Rules:

- Do not implement this with keyword regex alone.
- Use manifest aliases, owned paths, and existing code evidence for deterministic candidates.
- Use LLM classification only as reranking or tie-breaking after deterministic candidates exist.
- Low confidence must trigger a question, Plan mode, or an investigation-only pass before editing.

### `get_module_ontology`

Returns the manifest for one module.

Input:

```json
{
  "module": "billing",
  "repoPath": "/path/to/repo"
}
```

Output:

```json
{
  "module": "billing",
  "manifest": {
    "version": 1,
    "id": "billing",
    "ownedPaths": ["api/modules/billing/**"],
    "invariants": []
  }
}
```

### `compile_module_context`

Combines module ontology with memory, recent decisions, and source evidence.

Input:

```json
{
  "goal": "Show average cost per run on the overview screen",
  "primaryModule": "billing",
  "secondaryModules": ["overview"],
  "repoPath": "/path/to/repo"
}
```

Output:

```json
{
  "module": "billing",
  "summaryType": "task_scoped",
  "domainSummary": "Billing owns pricing import, provider/model normalization, and cost aggregation. This task also crosses into overview only for display.",
  "evidenceSources": {
    "manifestDigest": "sha256:...",
    "codeEvidenceDigest": "sha256:...",
    "taskGenerationEvidence": true,
    "memoryEvidence": true
  },
  "relevantConcepts": ["RunCost", "ProviderAlias"],
  "relevantInvariants": ["pricing-derived-cost", "provider-model-normalization"],
  "likelyFiles": ["api/modules/billing/billing.service.ts"],
  "boundaryWarnings": ["Do not change provider routing policy."],
  "knownPitfalls": ["Do not silently report zero when pricing is missing."],
  "verificationPlan": [
    "bunx vitest run tests/billing-cost.test.ts"
  ]
}
```

### Domain summary generation

`compile_module_context` は、LLM にドメイン要約を自由生成させない。NightWorkers または ontology MCP が根拠を分けて evidence pack を作り、LLM API はその evidence pack を構造化要約へ圧縮する役割に限定する。

Evidence layers:

1. `moduleManifest`
   - Source truth。
   - `summary`, `ubiquitousLanguage`, `responsibilities`, `ownedPaths`, `invariants`, `forbiddenMutations`, `verification` を提供する。
2. `codeEvidence`
   - 現在の実装事実。
   - owned paths 内の exports、routes、schemas、DB tables、tests、import edges、recent touched files を抽出する。
3. `taskGenerationEvidence`
   - Goal / Mission / TaskCandidate 生成から得られる手がかり。
   - `spec/archive/task-generation-module-ontology-implementation-plan.md` の GoalInterpretation、GoalRouting、TaskCandidateKind、ModuleRoutingMetadata、project-wide constraints の扱いを参照する。
   - これは source truth ではなく、task-scoped summary の入力 evidence として扱う。
4. `memoryEvidence`
   - 過去の失敗、scope drift、ユーザー判断、known pitfalls。
   - 現在の manifest やコード evidence と矛盾する場合は採用しない。
5. `llmSynthesis`
   - 上記 evidence を短い agent-facing context に統合する。
   - 根拠のない新事実、未確認の所有範囲、未確認の invariant を追加しない。

Evidence collection order:

1. Load `moduleManifest` and verify its digest.
2. Collect `codeEvidence` only from `ownedPaths`, `readMostlyPaths`, tests in `verification`, and explicit `allowedCrossModule` paths.
3. Collect `taskGenerationEvidence` only when a NightWorkers Goal / Mission / TaskCandidate already exists for the current task.
4. Collect `memoryEvidence` after manifest and code evidence so stale memories cannot override current facts.
5. Build the LLM evidence pack with separate fields for each layer.
6. Validate the LLM output against the summary schema.
7. Reject or downgrade any summary item that cannot be traced back to one of the evidence layers.

Summary types:

- `canonicalDomainSummary`
  - module manifest と code evidence から作る安定要約。
  - module manifest 更新時、または ontology index refresh 時に再生成する。
- `taskScopedSummary`
  - 今回の user goal、GoalRouting、TaskCandidateKind、project-wide constraints を考慮した一時要約。
  - Codex 型エージェントが作業開始時に読む。

Task generation evidence is especially useful when the user's goal has already been interpreted by NightWorkers:

```json
{
  "goalInterpretation": {
    "scope": "feature_domain",
    "intent": "build",
    "confidence": 0.82,
    "reason": "The goal describes a new user-facing feature."
  },
  "goalRouting": {
    "primaryModule": "todolist",
    "secondaryModules": ["settings"],
    "confidence": 0.74,
    "reason": "The feature owns todo creation and persistence, with settings integration."
  },
  "taskCandidate": {
    "kind": "feature_entrypoint",
    "constraintGoalIds": ["coverage-goal"],
    "boundaryNotes": ["New module may be emerging if no manifest exists."]
  }
}
```

The LLM summary prompt should preserve evidence provenance:

```text
Create a concise coding-agent context from the evidence pack.
Use moduleManifest and codeEvidence as source truth.
Use taskGenerationEvidence only as task-scoped hints.
Use memoryEvidence only when it does not conflict with current source truth.
Do not invent owned paths, invariants, verification commands, or module boundaries.
Return JSON matching the requested schema.
```

Summary acceptance checks:

- Every `likelyFiles` entry must match `ownedPaths`, `readMostlyPaths`, `allowedCrossModule`, or test paths from `verification`.
- Every `relevantInvariants` entry must exist in the manifest.
- Every `verificationPlan` entry must come from manifest verification or a documented repository verification command.
- `taskGenerationEvidence` may influence `summaryType`, `boundaryWarnings`, and task-specific emphasis, but must not create new module ownership.
- Contradictory task generation evidence must be returned as a warning and must not override manifest or code evidence.
- If LLM output fails schema validation, return deterministic manifest + code evidence context instead of failing the whole task.

Expected output uses the same schema as `compile_module_context`:

```json
{
  "module": "billing",
  "summaryType": "task_scoped",
  "domainSummary": "Billing owns pricing import, provider/model normalization, and cost aggregation. This task also crosses into overview only for display.",
  "evidenceSources": {
    "manifestDigest": "sha256:...",
    "codeEvidenceDigest": "sha256:...",
    "taskGenerationEvidence": true,
    "memoryEvidence": true
  },
  "relevantConcepts": ["RunCost", "ProviderAlias"],
  "relevantInvariants": ["pricing-derived-cost", "provider-model-normalization"],
  "likelyFiles": ["api/modules/billing/billing.service.ts"],
  "boundaryWarnings": ["Do not change provider routing policy."],
  "knownPitfalls": ["Do not silently report zero when pricing is missing."],
  "verificationPlan": ["bunx vitest run tests/billing-cost.test.ts"]
}
```

### `check_boundary`

Checks an edit plan or touched files against module ontology.

Input:

```json
{
  "primaryModule": "billing",
  "secondaryModules": ["overview"],
  "plannedFiles": [
    "api/modules/billing/billing.service.ts",
    "src/modules/overview/OverviewPanel.tsx"
  ],
  "repoPath": "/path/to/repo"
}
```

Output:

```json
{
  "decision": "allow_with_crossing",
  "crossings": [
    {
      "module": "overview",
      "paths": ["src/modules/overview/OverviewPanel.tsx"],
      "reason": "Allowed cross-module display of billing aggregate."
    }
  ],
  "forbiddenTouched": []
}
```

### `get_verification_plan`

Returns baseline, focused, and full verification for a module/change type.

Input:

```json
{
  "primaryModule": "billing",
  "secondaryModules": ["overview"],
  "changeTypes": ["api", "ui", "test"]
}
```

Output:

```json
{
  "baseline": [
    {
      "command": "bunx vitest run tests/billing-cost.test.ts",
      "expect": "Current focused billing tests pass before edits."
    }
  ],
  "focused": [
    {
      "command": "bunx vitest run tests/billing-cost.test.ts tests/routes.billing.test.ts",
      "expect": "Pricing import and cost propagation tests pass."
    }
  ],
  "full": [
    {
      "command": "bun run verify",
      "expect": "Repository verification passes."
    }
  ]
}
```

## Agent Protocol

### Start-of-task protocol

The coding agent must perform this sequence before editing.

```text
1. Restate the user goal.
2. Classify primaryModule and secondaryModules.
3. Load primary module ontology.
4. Load secondary module ontologies when planned files touch `allowedCrossModule` paths, when `classify_goal` returns secondary modules, or when the user goal explicitly names another module.
5. Build an allowed search scope from ownedPaths and readMostlyPaths.
6. Search inside allowed scope first.
7. Draft an edit plan with planned files.
8. Run boundary gate before editing.
9. If gate returns reject, stop and report.
10. If gate returns needs_user_confirmation, ask before editing.
```

### Search protocol

Default search order:

1. `ownedPaths` of primary module.
2. Tests named in module `verification`.
3. `readMostlyPaths`.
4. `allowedCrossModule` paths.
5. Repository-wide search only if the module-scoped search cannot explain the issue.

When repository-wide search is needed, the agent must state why module-scoped search was insufficient.

### Edit protocol

The agent may edit:

- primary module `ownedPaths`.
- secondary module paths that are explicitly part of `allowedCrossModule`.
- tests required by the module verification plan.

The agent must not edit:

- `forbiddenMutations` areas.
- unrelated formatting or cleanup targets.
- unknown module paths without boundary decision.

### Completion protocol

Final response must include this information when implementation changes were made.

```text
Primary module:
Secondary modules:
Owned paths touched:
Boundary crossings:
Forbidden areas touched:
Invariants checked:
Verification:
Known remaining risk:
```

For small changes, the agent can compress this into prose, but the same facts must be present.

## Prompt Contract

### System or developer prompt addition

```text
Before editing code, classify the user's goal into a primary feature module and optional secondary modules.
Load and follow the module ontology manifest when `.agent-ontology/modules.yaml` contains the selected module.
Search primary module owned paths first.
Treat edits outside the primary module as boundary crossings.
Do not edit forbidden mutation areas without explicit user approval.
Run the module verification plan or report why it could not be run.
In the final answer, report touched modules, boundary crossings, invariants checked, and verification results.
```

### Planning prompt addition

```text
For each implementation step, include:
- target module
- files likely to change
- relevant invariants
- expected boundary crossings
- verification command
- failure response
```

### Review prompt addition

```text
Review whether the patch stayed inside the declared module boundary.
Flag unexplained edits outside owned paths.
Flag invariant changes that were not tested.
Flag verification that does not cover the declared module.
```

## Implementation Phases

### Phase 0: Baseline and repository survey

Goal:

Confirm current agent workflow, existing module-like directories, test commands, and documentation conventions.

Tasks:

1. Identify existing module boundaries.
2. Identify existing instructions read by the coding agent.
3. Identify available MCP hooks or local helper scripts.
4. Identify current verification commands.
5. Record one or two recent failure examples caused by scope drift or boundary confusion.

Deliverables:

- Baseline note with current workflow.
- Candidate module list.
- Initial verification command list.

Verification:

```bash
find . -maxdepth 3 -type d | sort
```

Expected:

- Existing module-like paths are visible.

Failure response:

- If the repository has no clear module structure, start with ontology-only manifests and do not move files.

### Phase 1: Define ontology schema

Goal:

Create the manifest schema and repository conventions.

Tasks:

1. Add `.agent-ontology/modules.yaml`.
2. Add `.agent-ontology/schema/module-ontology.schema.json`.
3. Add `scripts/agent-ontology/validate-manifests.mjs`.
   - It must read `.agent-ontology/modules.yaml`.
   - It must validate every referenced module manifest.
   - It must print machine-readable JSON to stdout.
   - It must print diagnostics to stderr.
4. Define required fields:
   - `version`
   - `id`
   - `summary`
   - `ubiquitousLanguage`
   - `responsibilities`
   - `ownedPaths`
   - `invariants`
   - `forbiddenMutations`
   - `verification`
5. Define optional fields:
   - `readMostlyPaths`
   - `ownedData`
   - `allowedCrossModule`
   - `completionReport`

Deliverables:

- Schema file.
- Manifest validator.
- README section explaining the ontology contract.

Verification:

```bash
node scripts/agent-ontology/validate-manifests.mjs
```

Expected:

- The module index and all referenced manifests validate.
- The command returns non-zero when a manifest path is missing or a required field is absent.

Failure response:

- Keep schema permissive at first; do not block adoption on over-modeled fields.
- Do not proceed to pilot manifests until missing-path and missing-required-field failures are deterministic.

### Phase 2: Add pilot module manifests

Goal:

Create manifests for 3 to 5 high-value modules.

Selection criteria:

- Frequently edited by agents.
- Has recurring scope drift.
- Has meaningful invariants.
- Has focused tests.
- Has visible cross-module integration points.

Tasks:

1. Create one manifest per selected module.
2. Include owned paths and read-mostly paths.
3. Write 3 to 7 invariants per module.
4. Write forbidden mutations as behavior-level constraints, not just paths.
5. Add focused verification commands.

Deliverables:

- `.agent-ontology/modules/<module>.yaml` files.
- Updated module index.

Verification:

```bash
node scripts/agent-ontology/validate-manifests.mjs
```

Expected:

- All pilot manifests validate.

Failure response:

- Remove weak fields rather than inventing false precision.

### Phase 3: Add local ontology helper

Goal:

Provide deterministic local commands that the agent and MCP can reuse.

Tasks:

1. Add `scripts/agent-ontology/list-modules.mjs`.
2. Add `scripts/agent-ontology/get-module.mjs`.
3. Add `scripts/agent-ontology/check-boundary.mjs`.
4. Add `scripts/agent-ontology/verification-plan.mjs`.
5. Reuse `scripts/agent-ontology/validate-manifests.mjs` from Phase 1.
6. Keep stdout machine-readable JSON.
7. Send progress logs to stderr only.

Example:

```bash
node scripts/agent-ontology/check-boundary.mjs \
  --primary billing \
  --secondary overview \
  --files api/modules/billing/billing.service.ts src/modules/overview/OverviewPanel.tsx
```

Expected output:

```json
{
  "decision": "allow_with_crossing",
  "crossings": [
    {
      "module": "overview",
      "path": "src/modules/overview/OverviewPanel.tsx",
      "reason": "Allowed cross-module display path."
    }
  ],
  "forbiddenTouched": []
}
```

Verification:

```bash
node scripts/agent-ontology/list-modules.mjs
node scripts/agent-ontology/check-boundary.mjs --primary billing --files api/modules/billing/example.ts
```

Expected:

- Commands return valid JSON.

Failure response:

- Do not integrate MCP until local commands are stable.

### Phase 4: Expose ontology through MCP

Goal:

Make module ontology available through the same context channel the coding agent already uses.

Tasks:

1. Implement `list_modules`.
2. Implement `get_module_ontology`.
3. Implement `compile_module_context`.
4. Implement `check_boundary`.
5. Implement `get_verification_plan`.
6. Implement task generation evidence collection for `compile_module_context`.
   - Read GoalInterpretation / GoalRouting / TaskCandidateKind / ModuleRoutingMetadata when NightWorkers has them.
   - Treat `spec/archive/task-generation-module-ontology-implementation-plan.md` as the design reference for those fields.
   - Use this evidence only for task-scoped summaries, not canonical module ownership.
7. Reuse local helper scripts where possible.

Rules:

- MCP should not mutate repository files.
- MCP should return concise, action-oriented context.
- MCP should expose manifest digest so stale context can be detected.
- MCP should avoid broad historical summaries unless the module route requires them.
- MCP should keep `moduleManifest`, `codeEvidence`, `taskGenerationEvidence`, `memoryEvidence`, and `llmSynthesis` separate in debug output.
- MCP should not let task generation hints override current manifest or code evidence.

Verification:

```bash
node scripts/agent-ontology/smoke-mcp-contract.mjs
```

Expected:

- Each MCP contract returns valid JSON for pilot modules.
- `compile_module_context` can return a task-scoped summary with task generation evidence present.
- The same module can still return a canonical summary without task generation evidence.
- Contradictory task generation hints are reported as warnings rather than overriding manifest ownership.

Failure response:

- Fall back to local helper scripts and keep MCP integration disabled.
- If task generation evidence is missing or stale, continue with manifest + code evidence and mark `taskGenerationEvidence: false`.

### Phase 5: Add agent prompt integration

Goal:

Make the ontology protocol part of the coding agent's normal behavior.

Tasks:

1. Add start-of-task instructions to the agent instruction file.
2. Add edit-before-boundary-gate instructions.
3. Add completion report requirements.
4. Add review instructions for boundary drift.
5. Ensure instructions are short enough to be followed consistently.

Instruction block:

```text
Before code edits, identify primaryModule and optional secondaryModules.
Load the primary module ontology when .agent-ontology/modules.yaml contains the selected module.
Search ownedPaths before repository-wide search.
Run boundary gate before editing files outside ownedPaths.
Do not modify forbidden mutations without explicit approval.
Report modules touched, boundary crossings, invariants checked, and verification.
```

Verification:

- Run a dry-run agent task and inspect whether it reports module routing before editing.
- Run a task that requires a cross-module display change and check whether it records boundary crossing.

Failure response:

- If the agent ignores long instructions, move more enforcement into MCP gate and completion report checks.

### Phase 6: Add goal classification

Goal:

Implement the `classify_goal` contract and classify user goals into module routing before context compilation and editing.

Tasks:

1. Implement deterministic candidate generation from manifest aliases, responsibilities, and owned paths.
2. Optionally add LLM reranking over candidate modules.
3. Return confidence and reason.
4. Use low confidence as an investigation-only trigger.
5. Store routing decisions in task metadata when the host system has task metadata; otherwise include the routing in the generated plan or final report.
6. Expose the result through the MCP `classify_goal` tool.
7. Ensure `compile_module_context` can consume either an explicit caller-provided routing or the output of `classify_goal`.

Classification output:

```json
{
  "primaryModule": "billing",
  "secondaryModules": ["overview"],
  "confidence": 0.78,
  "reason": "The goal changes cost semantics and displays an aggregate."
}
```

Verification:

- Build a small fixture set of user goals and expected modules.
- Confirm known goals route to expected primary modules.
- Confirm ambiguous goals return low confidence rather than a forced module.
- Confirm `compile_module_context` uses the same routing fields returned by `classify_goal`.

Failure response:

- Prefer asking or investigating over confident wrong routing.
- If routing confidence is low, do not generate a task-scoped summary that implies a confirmed module owner.

### Phase 7: Add boundary gate enforcement

Goal:

Make boundary crossing visible before and after edits.

Tasks:

1. Check planned files before editing.
2. Check actual touched files after editing.
3. Reject forbidden mutations unless explicitly approved.
4. Mark unknown paths as `needs_user_confirmation` for write operations.
5. Include boundary result in final report.

Gate policy:

```text
owned path -> allow
allowedCrossModule path -> allow_with_crossing
readMostly path edited -> needs_user_confirmation
unknown path edited -> needs_user_confirmation
forbidden mutation -> reject
```

Verification:

```bash
node scripts/agent-ontology/check-boundary.mjs --primary billing --files api/modules/auth/auth.service.ts
```

Expected:

- Unknown or forbidden paths are not silently allowed.

Failure response:

- Tune manifests if legitimate integrations are repeatedly blocked.

### Phase 8: Add verification plan integration

Goal:

Ensure module ontology drives test selection and completion conditions.

Tasks:

1. Resolve baseline verification before edits for schema, boundary-gate, helper-script, or prompt-contract changes.
2. Resolve focused verification after edits.
3. Resolve full verification for broad or high-risk changes.
4. Require skipped verification reasons in final report.
5. Keep verification commands close to module manifests.

Verification:

- Patch a pilot module and confirm the agent suggests or runs the focused command from its manifest.
- Confirm final report includes pass/fail/skipped state.

Failure response:

- If commands are too slow or flaky, split `focused` from `full` and keep `focused` reliable.

### Phase 9: Add telemetry and review feedback

Goal:

Measure whether the ontology actually improves agent behavior.

Metrics:

- Percentage of tasks with primary module identified.
- Percentage of edits inside owned paths.
- Boundary crossings per task.
- Unexplained boundary crossings.
- Verification run rate.
- Review findings caused by scope drift.
- User corrections caused by wrong module classification.

Tasks:

1. Store routing decision metadata.
2. Store boundary gate output.
3. Store final touched files by module.
4. Store verification command outcomes.
5. Add a review query or report for drift patterns.

Verification:

- Run several pilot tasks and inspect metadata.
- Confirm scope drift is visible as data, not only reviewer memory.

Failure response:

- If telemetry is noisy, keep only routing, crossing, and verification outcome first.

## 現在地点からの実装ブレイクダウン

この節は、現在の部分実装を前提に、残り作業をレビュー可能な実装単位へ分解する。

現在のベースライン:

- `.agent-ontology/modules.yaml` と 3 つの pilot manifest は存在する。
- validation、module list、module ontology read、classification、context compilation、boundary check、verification plan lookup の local helper script は存在する。
- `list_modules`、`get_module_ontology`、`classify_goal`、`compile_module_context`、`check_boundary`、`get_verification_plan` の MCP tool は存在する。
- Task generation は `candidateKind`、`moduleRouting`、`constraintGoalIds`、`planModeOpenQuestions` を扱い始めている。
- 残っている主なリスクは、ontology context が helper output として存在する一方で、task generation、prompt setup、boundary check、verification、reporting をつなぐ agent-facing protocol としてはまだ一貫利用されていないことである。

次の実装単位の原則:

- context contract が安定する前に strict enforcement を有効化しない。
- 既存 3 module の有効性を確認する前に pilot module を増やさない。
- task generation evidence に manifest ownership を上書きさせない。
- 各 unit は focused test で確認できる大きさに保つ。
- deterministic な manifest / code evidence を先に使い、LLM synthesis は evidence layer を分離した後に限定する。

### Unit 1: `compile_module_context` provenance の安定化

Goal:

下流の task generation と coding agent が信頼できる安定 contract として `compile_module_context` を整える。

Tasks:

1. `scripts/agent-ontology/core.mjs` の `compileModuleContext` が、次の evidence section を分離して返すようにする。
   - `moduleManifest`
   - `codeEvidence`
   - `taskGenerationEvidence`
   - `memoryEvidence`
   - `llmSynthesis`
2. agent が読むための既存の簡潔な field は維持する。
   - `domainSummary`
   - `relevantConcepts`
   - `relevantInvariants`
   - `likelyFiles`
   - `boundaryWarnings`
   - `verificationPlan`
3. contradiction detection を追加する。
   - task generation が manifest-selected routing と異なる `primaryModule` を示す場合、manifest ownership を維持し warning を返す。
   - task generation が存在しない module id を参照する場合、confirmed ownership に含めず warning を返す。
   - task generation evidence が stale、malformed、absent の場合、manifest + code evidence で継続し、利用不可として明示する。
4. low-confidence behavior を維持する。
   - `unknown` は investigation-first context を返す。
   - `emerging` は Plan mode で boundary definition を行う context を返す。
   - どちらも confirmed module ownership を示さない。
5. `api/services/agent-ontology/agent-ontology.service.ts` は richer structure を pass-through するために必要な範囲だけ更新する。
6. `scripts/agent-ontology/smoke-mcp-contract.mjs` で richer context contract を検証する。

Verification:

```bash
bunx vitest run tests/agent-ontology.test.ts
node scripts/agent-ontology/smoke-mcp-contract.mjs
```

Expected:

- canonical context は manifest / code evidence を含み、task-scoped な task generation evidence は含まない。
- task-scoped context は入力された task generation evidence を分離して含む。
- contradictory task generation evidence は warning になり、manifest ownership を上書きしない。
- `unknown` / `emerging` は repository-wide edit guidance を返さない。

Failure response:

- richer contract が冗長になりすぎる場合、agent-facing field は維持し、詳細 provenance を `debug` または `evidence` object に寄せる。
- contradiction detection が曖昧な場合、この unit では reject より warning を優先する。

### Unit 2: 実 task generation evidence の接続

Goal:

NightWorkers の Goal / Mission / TaskCandidate metadata を task-scoped evidence として `compile_module_context` に接続する。

Detailed execution breakdown:

- `spec/archive/task-generation-ontology-evidence-bridge-implementation-plan.md`

Implementation consideration:

- Unit 2 を実装する場合は、上記 bridge plan を必ず考慮する。
- Unit 1 では bridge plan を将来 consumer として扱い、`taskGenerationEvidence` を optional evidence slot として壊さない。
- Unit 2 が未完了の間、Unit 3 以降は `taskGenerationEvidence` が absent / false でも manifest + code evidence で動く必要がある。

Dependencies:

- Unit 1 が完了していること。

Tasks:

1. 保存済み task generation metadata を context evidence shape に変換する小さな adapter を追加する。
   - Goal interpretation scope / intent。
   - Goal routing。
   - TaskCandidate kind。
   - ModuleRoutingMetadata。
   - project-wide constraint goal ids。
   - Plan mode open questions。
2. この adapter は、現在の task に紐づく Goal、Mission、TaskCandidate がある場合だけ使う。
3. canonical summary には task generation evidence を入れない。
4. 次の test case を追加する。
   - ontology present with matching module routing。
   - ontology present with contradictory module routing。
   - ontology absent。
   - feature entrypoint with project-wide constraints。
   - low-confidence or missing routing。

Verification:

```bash
bunx vitest run tests/agent-ontology.test.ts tests/services.mission-task-candidates.test.ts tests/project-detail-backend.test.ts
```

Expected:

- task-scoped summary に candidate kind と project-wide constraints が反映される。
- project-wide Goal は verification / acceptance criteria の制約になるが、standalone module ownership にはならない。
- contradiction は warning として見える。
- ontology が無い repository でも task candidate generation は失敗しない。

Failure response:

- persisted metadata が不完全な場合、missing-field warning 付きの best-effort evidence として扱う。
- Project Detail 側の変更が広がりすぎる場合、adapter を pure function に留め、まず fixture metadata を直接渡す test から始める。

### Unit 3: runtime ontology context snapshot の固定

Goal:

Codex lane / native API lane の run 開始時に、task-scoped ontology context を snapshot として固定し、prompt の注意書きではなく実行時 contract として参照できるようにする。

Dependencies:

- Unit 1 が完了していること。
- Unit 2 が完了していること。
- TaskCandidate 由来 Task では `taskId` から `taskGenerationEvidence` を解決できること。

Tasks:

1. Run start の baseline を明示する。
   - `taskId`
   - `runId`
   - `repoRoot`
   - runtime lane
   - TaskCandidate evidence の有無
   - current `HEAD` または runtime snapshot が既に持つ git baseline
2. run context 生成時に `compile_module_context` を呼ぶ小さな service を追加する。
   - `taskId` / `runId` から TaskCandidate evidence を解決する。
   - `summaryType=task_scoped` を使う。
   - TaskCandidate が無い場合は user goal + manifest / code evidence だけで継続する。
   - tool failure は run 全体を落とさず、`ontologyContext.available=false` と warning にする。
3. snapshot に保存する field を最小化する。
   - primary module。
   - secondary modules。
   - summary type。
   - evidence source flags。
   - task candidate id。
   - owned paths。
   - boundary warnings。
   - invariants。
   - focused verification candidates。
   - warnings。
4. Codex runtime prompt と native API system prompt に、snapshot の短い要約を渡す。
   - prompt は「必要なら取得せよ」ではなく「この run の ontology snapshot」として扱う。
   - snapshot が absent の場合だけ、既存の MCP tool guidance に fallback する。
5. provider layer へ用途別 routing policy を追加しない。
   - snapshot 作成と prompt 注入は runtime / supervisor side の責務に留める。
6. snapshot freshness を test する。
   - TaskCandidate 由来 Task では `taskGenerationEvidence=true`。
   - 通常 Task では `taskGenerationEvidence=false` でも run は継続。
   - ontology failure は warning になり、runtime prompt は壊れない。

Verification:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/nightworkers-codex-mcp-integration.test.ts tests/project-detail-backend.test.ts
```

Expected:

- Codex lane と native API lane の両方で、run start の ontology snapshot が prompt-visible context になる。
- TaskCandidate evidence は task-scoped hint として入るが、manifest ownership を上書きしない。
- snapshot が作れない場合でも run は停止せず、warning と MCP fallback guidance が残る。
- provider-layer code に workflow-specific policy が増えない。

Failure response:

- prompt が長くなりすぎる場合、snapshot payload は primary / secondary / warnings / verification candidates だけに圧縮する。
- snapshot 作成が DB 依存で広がりすぎる場合、まず read-only helper + prompt injection だけに留め、永続化は後続に回す。
- TaskCandidate 解決が不安定な場合、`taskGenerationEvidence=false` で継続し、bridge 側の regression test を先に直す。

Implementation targets:

- `api/services/agent-runtime/*`
- `api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-ontology/agent-ontology.service.ts`
- `api/mcp/nightworkers-codex-mcp.ts`
- `tests/services.codex-agent-runtime.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/nightworkers-codex-mcp-integration.test.ts`

### Unit 4: closeout boundary audit の追加

Goal:

実際に触ったファイルをもとに closeout 前に boundary audit を行い、final report に module / crossing / invariant / verification facts を残す。

Dependencies:

- Unit 3 が完了していること。

Tasks:

1. closeout の直前に touched files を取得する境界を決める。
   - Codex lane は runtime audit / file change events / git diff から取得する。
   - native API lane は worker tool history / git diff から取得する。
   - dirty tree に user change が混ざる可能性があるため、run baseline がある場合は baseline diff を優先する。
2. ontology snapshot の primary module と touched files で `check_boundary` 相当の判定を実行する。
   - owned。
   - allowed crossing。
   - unknown crossing。
   - forbidden mutation。
3. closeout report requirement に次を追加する。
   - primary module。
   - secondary modules。
   - touched owned paths。
   - boundary crossings。
   - forbidden areas touched。
   - invariants checked。
   - verification run or skipped reason。
4. enforcement は段階的にする。
   - forbidden mutation は closeout warning / failed review candidate にする。
   - `reject` の自動停止は strict mode まで有効化しない。
   - unknown path は reason または user confirmation evidence を要求する。
5. audit result を structured evidence として保存または run event に残す。
   - prompt の final report だけを source of truth にしない。
   - 保存 payload に source content や secret-bearing output を入れない。
6. closeout prompt / native API closeout guidance の test を追加する。

Verification:

```bash
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/services.native-api-runner-closeout.test.ts tests/agent-ontology.test.ts
```

Expected:

- ontology-guided run の closeout に boundary audit facts が含まれる。
- touched files が primary owned paths 内なら crossing count は 0 になる。
- allowed crossing は warning ではなく declared crossing として残る。
- unknown / forbidden は見えるが、strict mode までは自動 reject しない。

Failure response:

- closeout format が重すぎる場合、ontology snapshot がある run、または owned paths 外を触った run だけ full boundary report を必須にする。
- touched files の取得が lane ごとに揺れる場合、最初は git diff based audit に寄せ、runtime event based audit は補助 evidence にする。

### Unit 5: verification plan selection の統合

Goal:

module manifest と boundary audit から focused verification command を選び、skipped verification を closeout の明示対象にする。

Dependencies:

- Unit 3 が完了していること。
- Unit 4 が完了していることが望ましい。ただし closeout audit より先に verification candidates を prompt に載せる実装は可能。

Tasks:

1. Unit 3 の ontology snapshot に verification candidates を含める。
   - primary module focused。
   - secondary module focused。
   - baseline / full は必要時だけ表示する。
2. Unit 4 の boundary audit と組み合わせ、実際に触った module の verification を選ぶ。
   - primary owned edit は primary focused を優先する。
   - declared secondary crossing は secondary focused を追加する。
   - unknown crossing は focused verification だけで十分と判断せず、skipped reason または broader check を要求する。
3. runtime prompt の verification guidance を短くする。
   - 「まず snapshot の focused verification を見る」。
   - 「実行できない場合は skipped reason を残す」。
4. closeout で verification evidence を audit result と照合する。
   - 実行済み command。
   - exit code。
   - skipped reason。
   - unrelated failure の切り分け。
5. Project Detail / Mission Planner / agent-runtime の fixture で verification candidate selection を test する。

Verification:

```bash
bunx vitest run tests/agent-ontology.test.ts tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts
```

Expected:

- focused verification command は selected primary module manifest から出る。
- secondary module verification は primary focused command の代替ではなく追加として扱われる。
- missing verification は silently omitted にならず、report 対象になる。
- unknown crossing がある場合、verification selection は warning を含む。

Failure response:

- module verification command が遅い、または flaky な場合、enforcement を強める前に manifest の `baseline`、`focused`、`full` を分け直す。
- closeout との照合が不安定な場合、最初は prompt requirement + structured report field に留め、hard gate は strict mode に回す。

### Unit 6: LLM domain summary synthesis の準備

Goal:

LLM API による domain summary を入れる前に、evidence pack、schema、validation、fallback の境界を固定する。

Dependencies:

- Unit 1 が完了していること。
- Unit 2 が完了していること。
- Unit 3 の snapshot が、LLM synthesis なしでも動くこと。

Tasks:

1. LLM synthesis 入力の evidence pack schema を固定する。
   - `moduleManifest`
   - `codeEvidence`
   - `taskGenerationEvidence`
   - `memoryEvidence`
2. 出力 schema を固定する。
   - `summaryType`
   - `domainSummary`
   - `relevantConcepts`
   - `relevantInvariants`
   - `likelyFiles`
   - `boundaryWarnings`
   - `verificationPlan`
   - `unsupportedClaims`
3. validation policy を実装計画に固定する。
   - `likelyFiles` は owned / readMostly / allowedCrossModule / verification test paths だけ。
   - `relevantInvariants` は manifest 由来だけ。
   - `verificationPlan` は manifest または repo verification command 由来だけ。
   - task generation evidence は task-scoped emphasis にだけ使う。
4. LLM synthesis が失敗した場合は deterministic summary に fallback する。
   - provider failure。
   - schema validation failure。
   - unsupported claim が残る場合。
5. 初期実装では provider call を必須にしない。
   - deterministic summary を default。
   - `summaryType=task_scoped` で evidence pack が十分に分離されていることを先に確認する。

Verification:

```bash
bunx vitest run tests/agent-ontology.test.ts tests/nightworkers-codex-mcp-integration.test.ts
node scripts/agent-ontology/smoke-mcp-contract.mjs
```

Expected:

- LLM synthesis を入れなくても snapshot / boundary / verification flow は動く。
- LLM synthesis の出力候補は schema と provenance validation を通らない限り agent-facing source truth にならない。
- unsupported facts は warning または `unsupportedClaims` へ落ちる。

Failure response:

- schema が重すぎる場合、初期出力を `domainSummary`、`likelyFiles`、`boundaryWarnings`、`verificationPlan` に絞る。
- provider integration が広がりすぎる場合、この unit では prompt / schema / fallback test までに留める。

### Unit 7: 最小限の pilot telemetry を追加する

Goal:

大きな analytics system を作らず、ontology guidance が unexplained scope drift を減らしているか測れるようにする。

Dependencies:

- Unit 4 が完了していること。
- Unit 5 が完了していること。

Tasks:

1. 最小限の metadata だけを保存または structured event として記録する。
   - primary module。
   - secondary modules。
   - boundary decision。
   - unexplained crossings count。
   - focused verification run state。
2. recent ontology-guided tasks を確認する read-only query または debug report を追加する。
3. metadata の有効性が見えるまで dashboard は作らない。

Verification:

```bash
bunx vitest run tests/agent-ontology.test.ts tests/services.run-events.test.ts
```

Expected:

- pilot task 後に ontology routing と boundary outcome を確認できる。
- 保存 metadata は小さく、prompt、source、生ログ、secret-bearing content を含まない。

Failure response:

- telemetry が noisy な場合、primary module、boundary decision、verification outcome だけに絞る。
- storage integration が広すぎる場合、まず structured run event の emit に留め、persistent report は後続に回す。

### 推奨実装順

1. Unit 1: `compile_module_context` provenance の安定化。
2. Unit 2: 実 task generation evidence の接続。
3. Unit 3: runtime ontology context snapshot の固定。
4. Unit 4: closeout boundary audit の追加。
5. Unit 5: verification plan selection の統合。
6. Unit 6: LLM domain summary synthesis の準備。
7. Unit 7: 最小限の pilot telemetry を追加する。

Unit 4 と Unit 5 は、verification candidates を先に prompt へ渡す方が実装しやすい場合に入れ替えてよい。ただし closeout で実際の touched files と verification evidence を照合するまでは、verification selection を hard gate にしない。

### 次 tranche の implementation readiness checklist

実装開始前に次を確認する。

- Task Generation 側の semantics 修正が入っており、project-wide Goal が standalone candidate として残らない。
- `spec/archive/task-generation-ontology-evidence-bridge-implementation-plan.md` は archive 済みだが、Unit 2 の detailed execution reference として参照できる。
- `compile_module_context` は `taskId` / `taskCandidateId` / `missionId` のどれかから task generation evidence を解決できる。
- Codex lane と native API lane の prompt 生成箇所が特定済みである。
- touched files を closeout audit に渡す最初の実装では、runtime event より git diff based evidence を優先してよい。
- LLM domain summary は Unit 6 まで provider call を必須化しない。

次 tranche の最小実装対象:

1. ontology snapshot builder。
2. Codex / native API prompt への snapshot 注入。
3. closeout boundary audit helper。
4. verification candidate selector。
5. LLM synthesis evidence pack / schema / fallback plan。

次 tranche の最小 verification:

```bash
bunx vitest run tests/agent-ontology.test.ts tests/services.codex-agent-runtime.test.ts tests/services.native-api-runner.test.ts tests/nightworkers-codex-mcp-integration.test.ts tests/project-detail-backend.test.ts
node scripts/agent-ontology/smoke-mcp-contract.mjs
bun run verify:fast
```

### 近い範囲の non-goals

- strict mode を global に有効化しない。
- deterministic fixture が安定するまで goal classification の LLM reranking を追加しない。
- 現在の task で繰り返し module boundary を越える必要が見えるまで pilot manifest を増やさない。
- ontology module に合わせた source file 移動をしない。
- task generation evidence、memory、LLM summary を module ownership の source truth にしない。
- project-wide Goal を standalone module ownership に変換しない。

### 近い範囲の completion criteria

次の実装 tranche は、次を満たしたら完了とする。

- `compile_module_context` が separated provenance と concise agent-facing fields を返す。
- task generation metadata が canonical ownership を変えずに task-scoped summary へ影響できる。
- contradictory task generation evidence が warning として見える。
- runtime ontology snapshot が Codex lane / native API lane の prompt-visible context として入る。
- closeout boundary audit が touched files と primary module を照合し、boundary facts を structured evidence として残せる。
- primary module manifest と declared secondary crossing から focused verification を選べる。
- LLM domain summary synthesis を入れる前に、evidence pack、schema、validation、deterministic fallback の境界が固定されている。
- ontology-guided task の final report に module / boundary / invariant / verification facts を含められる。
- tranche 後に `bun run verify` が通る。または unrelated dirty-tree failure がある場合は別途明記される。

## Rollout Plan

### Pilot

Use 3 to 5 modules for initial rollout.

Pilot acceptance criteria:

- Each pilot module has a manifest.
- Agent can classify at least 80% of fixture goals into expected modules.
- Agent reports boundary crossings in final responses.
- Focused verification commands are used for pilot module changes.
- Reviewers can identify unexplained cross-module edits from the report.

### Expansion

Add manifests when a module meets one of these conditions.

- It is edited frequently by agents.
- It has recurring scope drift.
- It owns meaningful invariants.
- It has clear verification commands.
- It is a common integration point for other modules.

Do not create manifests for modules with no stable responsibility yet. Use `unknown` or `emerging` classification until the boundary stabilizes.

### Strict mode

Only enable strict enforcement after pilot metrics are acceptable.

Strict mode behavior:

- Unknown path edits require confirmation.
- Forbidden mutations are rejected.
- Missing final boundary report fails closeout.
- Missing focused verification requires an explicit skipped reason.

## Example Agent Flow

User goal:

```text
Overview に平均 run cost を表示してください。
```

Agent flow:

```text
1. classify_goal
   primaryModule: billing
   secondaryModules: overview

2. get_module_ontology(billing)
   loads cost invariants and verification

3. compile_module_context
   returns task-scoped summary, evidence sources, likely files, invariants, boundary warnings, and verification plan

4. Search
   api/modules/billing/**
   tests/billing-cost.test.ts
   src/modules/overview/** only after billing aggregate contract is clear

5. check_boundary
   billing service -> owned
   overview panel -> allowed crossing

6. Edit
   billing aggregate
   overview display
   focused tests

7. Verification
   billing focused tests
   overview UI tests when the overview manifest or verification plan lists them

8. Final report
   primary module, crossing, invariants, verification
```

Expected final report shape:

```text
Primary module: billing
Secondary modules: overview
Boundary crossings: overview display only, allowed by billing manifest
Invariants checked: persisted pricing lookup, provider/model normalization, missing pricing state
Verification: billing focused tests passed
```

## Risks

### Manifest becomes stale

Mitigation:

- Include `manifestDigest` in MCP output.
- Validate manifests in CI or focused verification.
- Review module manifests when a module's responsibility changes.

### Agent over-trusts wrong routing

Mitigation:

- Use confidence.
- Low confidence triggers investigation-only mode.
- Allow user or reviewer override.
- Keep routing reason visible.

### Boundary gate blocks legitimate work

Mitigation:

- Use `allow_with_crossing` instead of hard reject for known integrations.
- Treat manifests as living contracts.
- Add `allowedCrossModule` entries based on repeated legitimate crossings.

### Ontology becomes too abstract

Mitigation:

- Require owned paths, invariants, forbidden mutations, and verification.
- Reject manifests that only contain general prose.
- Keep each invariant tied to a check or expected behavior.

### Verification is too expensive

Mitigation:

- Separate baseline, focused, and full verification.
- Use focused verification for ordinary module edits.
- Reserve full verification for broad, risky, or release-bound changes.

### LLM summary includes unsupported facts

Mitigation:

- Validate LLM output against the summary schema.
- Require every `likelyFiles`, `relevantInvariants`, and `verificationPlan` item to trace back to manifest, code evidence, or repository verification commands.
- Fall back to deterministic manifest + code evidence context when LLM output is invalid.

### Task generation evidence is stale or overrules ownership

Mitigation:

- Treat task generation evidence as task-scoped hints only.
- Do not let GoalRouting or TaskCandidate metadata override manifest ownership.
- Return contradictions as warnings in `compile_module_context`.

## Completion Criteria

The implementation is complete when:

- Module ontology manifest schema exists.
- At least 3 pilot modules have manifests.
- `validate-manifests.mjs` fails deterministically for missing manifest paths and required fields.
- Local helper or MCP can list modules, read manifest, classify goals, compile module context, check boundary, and return verification plan.
- `compile_module_context` returns canonical and task-scoped summaries with separated `moduleManifest`, `codeEvidence`, `taskGenerationEvidence`, `memoryEvidence`, and `llmSynthesis` provenance.
- Task generation evidence from GoalInterpretation / GoalRouting / TaskCandidateKind can influence task-scoped summaries without changing canonical module ownership.
- Agent prompt requires module routing before edits.
- Boundary gate is used before planned cross-module edits.
- Final response includes module, crossing, invariant, and verification facts.
- Pilot tasks show fewer unexplained cross-module edits.

## Non-Goals

- This plan does not require reorganizing source files.
- This plan does not require adopting full tactical DDD patterns.
- This plan does not make AI classification authoritative without review.
- This plan does not remove the need for tests.
- This plan does not allow broad repository edits just because a module is selected.
- This plan does not replace human product judgment for ambiguous boundaries.
- This plan does not treat task generation evidence or memory as module ownership source truth.
