---
title: Supervisor Workflow Skills 実装計画
targetKind: wiki
priorityGroup: implementation-plan
status: planned
---

# Supervisor Workflow Skills 実装計画

作成日: 2026-06-03

## 目的

Supervisor の prompt 構造を、コードに残す共通 SystemPrompt と、場面ごとに編集可能な Skill.md / reference markdown に分離する。

現状は `api/services/supervisor/prompt.ts` に `general` / `evidence_review` / `code_change` / `research` の workflow-specific SystemContext が直書きされている。この計画では、LLM が Round 1 で単一 workflow を確定するのではなく、routing hypothesis として primary mode、secondary modes、phase、work kind、overlays を返し、Round 2 以降は必要な markdown を読み込んで振る舞う構造にする。

ユーザーが編集する対象は markdown とし、TypeScript 側には汎用の実行契約、tool catalog、decision JSON 契約、routing schema、読み込み・検証・fallback の仕組みだけを残す。

## 非目標

- ユーザー文言を正規表現、keyword、固定 phrase で分類する runtime 分岐。
- 任意コードを実行できる plugin 化。
- 既存 Todo procedure runtime の置き換え。
- 外部 MCP tool や worker tool の追加。
- UI から skill を編集する画面の実装。

## 現状

現在の workflow enum は `api/services/supervisor/prompt.ts` と `api/services/supervisor/llm-provider.ts` にある。

```ts
export type SupervisorWorkflow = 'general' | 'evidence_review' | 'code_change' | 'research';
```

Round 1 は `buildRound1SystemPrompt(projectRoot)` で workflow 選択を行う。Round 2 は `buildRound2SystemPrompt(workflow)` が workflow に応じた SystemContext を直書き関数から選んでいる。

Skill.md 外部化後は、4種類の enum では粗すぎる。ただし、25種類前後の分類をフラットな排他的 enum として扱うのも不安定である。コーディング作業は複合しやすいため、Round 1 は「確定分類」ではなく「routing hypothesis」を返し、各ラウンドで再評価する。

既に `api/services/procedures/builtin/*.md` と procedure registry があるが、これは Todo / taskType 向けの実行手順である。今回の markdown は Supervisor の routing / phase / work kind / overlay 用の判断ルールであり、用途が違うため別 namespace とする。

## 設計方針

### Prompt の責務分離

コードに残すもの:

- Base SystemContext。
- Round 1 routing prompt。
- Decision JSON 契約。
- Tool catalog。
- Round 2 の共通実行説明。
- markdown の読み込み、parse、validate、fallback。

markdown に移すもの:

- routing / phase / mode / work kind / overlay ごとの判断ルール。
- 場面ごとの必須動作。
- stop / report の条件。
- evidence / edit / verification の要求。
- finalResponse の報告契約。

### Routing hypothesis と markdown の対応

排他的な workflow enum と同数の Skill.md を作るのではなく、分類軸を分ける。

Round 1 は次を返す。

```json
{
  "primary_mode": "investigation",
  "secondary_modes": ["runtime_debug"],
  "phase": "analyze",
  "work_kinds": ["code"],
  "overlays": ["evidence", "performance", "production_risk"],
  "required_evidence": ["logs", "reproduction steps", "repo inspection"],
  "next_skill_files": [
    "SKILL.md",
    "references/phases/analyze.md",
    "references/modes/investigation.md",
    "references/modes/runtime_debug.md",
    "references/overlays/evidence.md",
    "references/overlays/performance.md"
  ],
  "confidence": 0.78
}
```

`primary_mode` はその時点の主作業を示すが、固定ではない。`secondary_modes` は同時に参照すべき判断ルールである。Round 2 以降は、観測結果に応じて `phase`、`primary_mode`、`secondary_modes`、`work_kinds`、`overlays` を再評価する。

### Markdown ファイル構成

初期構成は次の形にする。

```text
api/services/supervisor/skills/builtin/
  SKILL.md
  references/
    router.md
    phases/
      answer.md
      analyze.md
      plan.md
      execute.md
      review.md
      investigate.md
      verify.md
      summarize.md
    modes/
      general_answer.md
      planning.md
      code_edit.md
      review.md
      investigation.md
      runtime_debug.md
      test_and_verification.md
      research.md
      docs.md
      git_release.md
    work_kinds/
      code.md
      refactor.md
      test.md
      docs.md
      config.md
      dependency.md
      data_migration.md
      ui_ux.md
      git.md
      release.md
      research.md
    overlays/
      evidence.md
      security.md
      performance.md
      incident.md
      destructive_operation.md
      production_risk.md
      user_facing_change.md
      external_research_required.md
```

`SKILL.md` は共通原則と router の使い方だけを書く。詳細な判断ルールは `references/` 配下に置く。

### 分類軸

#### Phase

作業の現在位置を表す。

| Phase | 用途 |
| --- | --- |
| `answer` | 証拠取得や編集なしで直接回答する。 |
| `analyze` | 依頼を分解し、次に読む skill と必要証拠を決める。 |
| `plan` | 実装計画、設計メモ、spec 文書を作る。 |
| `execute` | 実際に編集、コマンド実行、設定変更を行う。 |
| `review` | diff、コード、文書、計画をレビューする。 |
| `investigate` | 原因調査、再現、ログ確認、仮説検証を行う。 |
| `verify` | テスト、ビルド、受け入れ条件確認を行う。 |
| `summarize` | 最終回答、結果整理、残リスク提示を行う。 |

#### Mode

その時点の主作業を表す。`primary_mode` は1つ、`secondary_modes` は0個以上を許可する。

| Mode | 用途 |
| --- | --- |
| `general_answer` | 軽い回答。 |
| `planning` | 実装計画や設計文書作成。 |
| `code_edit` | 通常のコード編集。 |
| `review` | code review / document review。 |
| `investigation` | bug investigation / evidence review / incident triage。 |
| `runtime_debug` | dev server、build、test、CLI、worker process の実行時問題。 |
| `test_and_verification` | テスト追加、検証、受け入れ条件確認。 |
| `research` | 外部公式 docs や最新 Web 情報確認。 |
| `docs` | README、spec、運用手順などの文書作業。 |
| `git_release` | git 操作、release prepare、publish dry-run。 |

#### Work kind

対象物を表す。

| Work kind | 用途 |
| --- | --- |
| `code` | source behavior。 |
| `refactor` | 振る舞いを保った構造変更。 |
| `test` | unit / integration / e2e。 |
| `docs` | docs / comments / spec。 |
| `config` | env / settings / policy / manifest。 |
| `dependency` | package / framework upgrade。 |
| `data_migration` | schema / migration / backfill。 |
| `ui_ux` | frontend / browser-visible behavior。 |
| `git` | status / diff / commit / branch / push / PR。 |
| `release` | version / release note / publish checks。 |
| `research` | external docs / public web source。 |

#### Overlay

常に追加で効く注意事項を表す。複数指定できる。

| Overlay | 用途 |
| --- | --- |
| `evidence` | repo evidence、logs、DB、run events が必要。 |
| `security` | secret、auth、permission、prompt injection、危険操作。 |
| `performance` | latency、resource usage、token / query / runtime cost。 |
| `incident` | production impact、regression、failed run、urgent triage。 |
| `destructive_operation` | delete、reset、force push、migration など戻しにくい操作。 |
| `production_risk` | 本番影響があり得る変更や調査。 |
| `user_facing_change` | UI、API response、final answer などユーザー可視の変更。 |
| `external_research_required` | 最新情報や外部公式 docs が必要。 |

### 細かい分類の扱い

旧候補の `code_review`、`document_review`、`bug_investigation`、`evidence_review`、`dependency_upgrade`、`data_migration`、`release_prepare` などは、フラットな primary enum ではなく mode / work kind / overlay / subtype として扱う。

例:

```json
{
  "primary_mode": "code_edit",
  "secondary_modes": ["test_and_verification"],
  "phase": "execute",
  "work_kinds": ["dependency"],
  "overlays": ["security", "evidence"],
  "subtype": "dependency_upgrade"
}
```

### 設定可能な skill フォルダ

skill フォルダは設定で差し替え可能にする。

候補:

```env
SUPERVISOR_SKILLS_DIR=/absolute/path/to/supervisor-skills
```

未指定時は built-in を使う。

```ts
const defaultSupervisorSkillsDirectory = path.join(
  process.cwd(),
  'api/services/supervisor/skills/builtin'
);
```

設定値は runtime-backed settings に寄せられるならそちらを優先する。ただし初期 slice では既存 `api/config.ts` の env schema に `SUPERVISOR_SKILLS_DIR` を optional で追加するだけでよい。後続で settings UI / DB-backed settings に移す。

### Markdown format

Skill.md / reference markdown は executable ではなく safe data として扱う。frontmatter は使わない。

識別は相対パスから決める。たとえば `references/modes/code_edit.md` は `mode=code_edit` の判断ルールであり、Markdown 本文に `id` や `workflow` を重複して書かせない。

```md
# Code Edit

## Use When

ユーザーが source behavior の変更、機能追加、バグ修正を求めているときに使う。

## Required Behavior

- 編集前に既存コードを確認する。
- observations が空の場合、phase="stop" または phase="report" を返してはいけない。
- 不具合原因が未確認なら、先に investigation / evidence の rule を読む。

## Stop Conditions

- 編集と検証が完了した場合だけ summarize / final answer へ進む。

## Report Contract

- finalResponse には変更ファイルと検証結果を要約する。
```

必須 section:

- `Use When`
- `Required Behavior`
- `Stop Conditions`
- `Report Contract`

任意 section:

- `Tool Guidance`
- `Verification Guidance`
- `Risk Notes`

parse 後は各 section を順番に結合して Round 2 prompt へ注入する。

title は H1 から取得する。H1 がない場合はファイル名から生成する。version は loader 側の schema version として扱い、digest はファイル内容から計算する。

## 追加・変更するファイル

### 新規

```text
api/services/supervisor/skills/types.ts
api/services/supervisor/skills/registry.ts
api/services/supervisor/skills/builtin/SKILL.md
api/services/supervisor/skills/builtin/references/router.md
api/services/supervisor/skills/builtin/references/phases/*.md
api/services/supervisor/skills/builtin/references/modes/*.md
api/services/supervisor/skills/builtin/references/work_kinds/*.md
api/services/supervisor/skills/builtin/references/overlays/*.md
```

### 変更

```text
api/config.ts
api/services/supervisor/prompt.ts
api/services/supervisor/llm-provider.ts
api/services/supervisor/supervisor-loop.ts
```

### テスト追加・変更

既存の test 配置に合わせて追加する。既存テストが `tests/services.supervisor-prompt.test.ts` にある場合はそこへ寄せる。

```text
tests/services.supervisor-prompt.test.ts
tests/services.supervisor-skills.test.ts
```

## 型

```ts
export const supervisorPhases = [
  'answer',
  'analyze',
  'plan',
  'execute',
  'review',
  'investigate',
  'verify',
  'summarize',
] as const;

export const supervisorModes = [
  'general_answer',
  'planning',
  'code_edit',
  'review',
  'investigation',
  'runtime_debug',
  'test_and_verification',
  'research',
  'docs',
  'git_release',
] as const;

export const supervisorWorkKinds = [
  'code',
  'refactor',
  'test',
  'docs',
  'config',
  'dependency',
  'data_migration',
  'ui_ux',
  'git',
  'release',
  'research',
] as const;

export const supervisorOverlays = [
  'evidence',
  'security',
  'performance',
  'incident',
  'destructive_operation',
  'production_risk',
  'user_facing_change',
  'external_research_required',
] as const;

export type SupervisorPhase = (typeof supervisorPhases)[number];
export type SupervisorMode = (typeof supervisorModes)[number];
export type SupervisorWorkKind = (typeof supervisorWorkKinds)[number];
export type SupervisorOverlay = (typeof supervisorOverlays)[number];

export type SupervisorRoutingHypothesis = {
  primaryMode: SupervisorMode;
  secondaryModes: SupervisorMode[];
  phase: SupervisorPhase;
  workKinds: SupervisorWorkKind[];
  overlays: SupervisorOverlay[];
  subtype?: string;
  requiredEvidence: string[];
  nextSkillFiles: string[];
  confidence: number;
};

export type SupervisorSkillSectionName =
  | 'Use When'
  | 'Required Behavior'
  | 'Stop Conditions'
  | 'Report Contract'
  | 'Tool Guidance'
  | 'Verification Guidance'
  | 'Risk Notes';

export type SupervisorSkillDocument = {
  id: string;
  kind: 'root' | 'router' | 'phase' | 'mode' | 'work_kind' | 'overlay';
  title: string;
  version: 1;
  source: 'builtin' | 'configured';
  relativePath: string;
  digest: string;
  sections: Partial<Record<SupervisorSkillSectionName, string>>;
};
```

`id` と `kind` は相対パスから決める。許可された phase / mode / work kind / overlay に対応しない markdown file name は起動時または初回読み込み時に失敗させる。

## 読み込み仕様

### registry

`api/services/supervisor/skills/registry.ts` に以下を持つ。

```ts
listSupervisorSkillDocuments(directory?: string): Promise<SupervisorSkillDocument[]>
resolveSupervisorSkillDocuments(
  routing: SupervisorRoutingHypothesis,
  directory?: string
): Promise<SupervisorSkillDocument[]>
renderSupervisorSkillDocuments(documents: SupervisorSkillDocument[]): string
clearSupervisorSkillDocumentCache(): void
```

### cache

起動後の通常実行では markdown を毎回 read しない。directory ごとに cache する。

初期実装では process memory cache でよい。開発中の編集反映は server restart 前提にする。hot reload は非目標。

### fallback

configured directory が指定されている場合:

- `SKILL.md`、`references/router.md`、定義済み phase / mode / work kind / overlay の markdown が揃っていることを要求する。
- 1つでも欠けている場合、起動時または初回読み込み時に error にする。
- built-in と configured を暗黙 merge しない。

理由:

- ユーザーが編集したつもりの reference だけが configured で、それ以外が built-in に戻ると実行時の説明が追いにくい。
- routing schema と markdown set は常に完全対応にする方が監査しやすい。

## Prompt 組み立て

### Round 1

Round 1 は routing hypothesis を返す。

- Base SystemContext。
- routing schema の説明。
- phase / mode / work kind / overlay の短い説明。
- Tool catalog の紹介は必要最小限。
- 原則 toolCall は null。
- LLM は `primaryMode`、`secondaryModes`、`phase`、`workKinds`、`overlays`、`requiredEvidence`、`nextSkillFiles`、`confidence` を返す。

Round 1 では references 本文を注入しない。routing に必要な短い説明だけをコード側に残す。

### Round 2

Round 2 は次の順で組み立てる。

```text
[SystemContext]
共通 SystemPrompt

[Round 2: 実行]
共通実行説明

[Routing Hypothesis]
primaryMode / secondaryModes / phase / workKinds / overlays / requiredEvidence / confidence

[Loaded Skill Documents]
SKILL.md と routing に対応する references を render した本文

[Re-evaluation Gate]
行動前に現在の routing がまだ正しいか確認し、必要なら別 reference を追加する

[Decision JSON 契約]
...

[Tool catalog]
...
```

`buildRound2SystemPrompt` は async にする案を第一候補にする。

```ts
export async function buildRound2SystemPrompt(
  routing: SupervisorRoutingHypothesis,
  options?: { skillsDirectory?: string }
): Promise<string>
```

呼び出し側が sync 前提で大きく崩れる場合は、server 起動時に registry を preload して sync lookup する第二案を使う。ただし最終的には「読み込み失敗を run 中ではなく起動時に検出できる」形が望ましい。

## 実装 slice

### Slice A: Skill file skeleton

目的:

- `SKILL.md` と `references/` 配下の phase / mode / work kind / overlay markdown を built-in に置く。
- 内容は現行 `buildGeneralContext` / `buildEvidenceReviewContext` / `buildCodeChangeContext` / `buildResearchContext` を分解し、近い references に移す。

完了条件:

- routing schema に対応する markdown set が存在する。
- markdown は必須 section を持つ。
- この slice では runtime 挙動を変えない。

### Slice B: Skill registry

目的:

- markdown を parse / validate / digest 化できる registry を作る。
- configured directory と built-in directory の読み分けを実装する。

完了条件:

- schema にない phase / mode / work kind / overlay は rejected。
- schema に対応する markdown 欠落は rejected。
- 許可されない relative path は rejected。
- digest が内容変更で変わる。
- configured directory 未指定時は built-in を読む。

### Slice C: Routing prompt integration

目的:

- `buildRound2SystemPrompt` が routing hypothesis に対応する markdown を読む。
- TypeScript から直書き workflow context を削除する。

完了条件:

- Base SystemContext、decision contract、tool catalog は TypeScript に残る。
- routing-specific な判断ルールは markdown 側だけにある。
- Round 2 prompt に routing hypothesis に対応する markdown だけが入る。
- Round 1 prompt には references 本文が入らない。
- Round 2 の各 decision 前に routing 再評価 gate が入る。

### Slice D: Configuration

目的:

- `SUPERVISOR_SKILLS_DIR` で skill folder を差し替えられるようにする。

完了条件:

- 未指定時は built-in を使用する。
- 指定時は指定 folder の markdown set だけを使う。
- 欠落や壊れた markdown は明示的な error になる。
- error には directory、relative path、routing axis が含まれる。

### Slice E: Runtime evidence and logging

目的:

- run がどの skill を使ったか追えるようにする。

完了条件:

- supervisor trace または task event data に `routingHypothesis` と `loadedSkillDocuments` の id / digest / source を残す。
- final report には通常出さない。debug / audit 用に残す。
- configured skill 使用時も digest で追跡できる。

### Slice F: Verification

目的:

- 既存挙動を壊していないことを確認する。

完了条件:

- supervisor prompt unit test が通る。
- skill registry unit test が通る。
- `pnpm verify` が通る。
- 代表 run で `primaryMode=code_edit`、`phase=execute`、`workKinds=["code"]` の routing が references 由来で toolCall へ進むことを確認する。

## 受け入れ基準

- `api/services/supervisor/prompt.ts` から routing-specific な長文直書きが消えている。
- TypeScript 側に残る SystemPrompt は共通部分だけである。
- built-in folder に `SKILL.md` と routing schema に対応する references が存在する。
- Round 1 は routing hypothesis とツール紹介だけを行い、references 本文を読ませない。
- Round 2 以降は routing hypothesis に対応する markdown だけを注入する。
- 各ラウンドの行動前に routing を再評価できる。
- `SUPERVISOR_SKILLS_DIR` で skill folder を差し替えられる。
- configured folder は routing schema 分の完全セットを要求する。
- skill parse error は黙って built-in fallback しない。
- 使った markdown の digest と routing hypothesis が trace / event から確認できる。
- `pnpm verify` が通る。

## テスト計画

### Unit

- built-in directory から routing schema と同数の skill document を読み込める。
- routing schema と markdown set が完全一致する。
- 必須 section 欠落で失敗する。
- routing schema に対応しない markdown file name で失敗する。
- configured directory 指定時に built-in と merge しない。
- `renderSupervisorSkillDocuments` が必須 section を含む。

### Prompt

- Round 1 prompt に routing schema の説明がある。
- Round 1 prompt に references の長文本文が入らない。
- Round 2 prompt に routing hypothesis に対応する markdown 本文が入る。
- Round 2 prompt に不要な markdown 本文が入らない。
- Round 2 prompt に re-evaluation gate が入る。
- Tool catalog と Decision JSON 契約は Round 2 prompt に残る。

### Runtime

- `primaryMode=general_answer` 選択時に関連 markdown の digest が記録される。
- `primaryMode=code_edit` 選択時に関連 markdown の digest が記録される。
- 観測結果に応じて `phase=verify` や `primaryMode=test_and_verification` へ再 routing できる。
- configured directory の markdown を使った run で source が `configured` になる。
- 壊れた configured directory では run を曖昧に続行しない。

## リスクと対策

### Skill.md が古くなる

対策:

- digest を event / trace に残す。
- built-in skill はコードレビュー対象にする。
- 将来、stale detector を future candidate として扱う。

### prompt token が増える

対策:

- Round 1 では references 本文を入れない。
- Round 2 でも routing hypothesis に対応する markdown だけを入れる。
- references 全部を毎回 prompt に入れない。

### configured skill の一部だけが反映される

対策:

- configured folder は完全セット必須にする。
- built-in との暗黙 merge を禁止する。

### runtime 分岐が復活する

対策:

- routing hypothesis は LLM の schema 出力に限定する。
- サーバー側は schema validation と markdown lookup だけを行う。
- ユーザー文言の regex / keyword / fixed phrase 分類を追加しない。

## 初回実装順

1. `api/services/supervisor/skills/builtin/SKILL.md` と `references/**/*.md` を追加する。
2. `types.ts` と `registry.ts` を追加し、built-in を parse できるようにする。
3. skill registry unit test を追加する。
4. `prompt.ts` の routing-specific context を markdown render に置き換える。
5. `buildRound2SystemPrompt` の async 化または preload 方式を決め、呼び出し側を合わせる。
6. `SUPERVISOR_SKILLS_DIR` を `api/config.ts` に追加する。
7. trace / event に routing hypothesis と loaded markdown digest を残す。
8. prompt tests と runtime tests を更新する。
9. `pnpm verify` を通す。

## PR 報告フォーマット

実装 PR では次を報告する。

- 変更点: 共通 SystemPrompt と routing markdown の分離内容。
- Skill files: 追加した built-in `SKILL.md` と references。
- Config: `SUPERVISOR_SKILLS_DIR` の扱い。
- Audit: run / trace に残る routing hypothesis と markdown id / digest。
- Verification: targeted tests と `pnpm verify` の結果。
- 残リスク: hot reload なし、UI 編集なし、runtime-backed settings 未対応ならその旨。
