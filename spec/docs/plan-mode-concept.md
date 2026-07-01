# Plan Mode Concept

## 目的

NightWorkers の Plan mode を、固定テンプレートを全部埋める機能ではなく、1つの機能ドメインを実装可能な形まで整理する Feature Plan 生成機能として再定義する。

この文書は実装計画ではない。次に Supervisor prompt、skill reference、Plan artifact schema、専用ビューを設計するためのコンセプト境界を固定する。

## 実装計画書

このコンセプトは、次の5本の実装計画書に分けて実装する。

1. [Plan Mode Phase 1: Artifact Model Replacement](./plan-mode-phase-1-artifact-model-replacement.md)
2. [Plan Mode Phase 2: Supervisor Flow Replacement](./plan-mode-phase-2-supervisor-flow-replacement.md)
3. [Plan Mode Phase 3: Dedicated View Generators](./plan-mode-phase-3-dedicated-view-generators.md)
4. [Plan Mode Phase 4: UI / Artifact UX Replacement](./plan-mode-phase-4-ui-artifact-ux-replacement.md)
5. [Plan Mode Phase 5: Cleanup / Verification Hardening](./plan-mode-phase-5-cleanup-verification.md)

## 背景

これまでの Plan mode は、questionnaire、blueprint、DB design、specification を一律に埋める方向で考えていた。しかし実際の案件では、UI がない、DB 変更がない、API contract だけが主題、Zod schema だけが主題、状態遷移だけが危険、といった差が大きい。

全案件で同じ成果物を強制すると、次の問題が起きる。

- UI がない案件に blueprint を要求して、存在しない画面設計を作らせる。
- DB がない案件に DB design を要求して、不要なデータ設計を作らせる。
- API、Zod schema、worker payload、state transition など、実装上重要な契約が specification の本文に埋もれる。
- 設計書が長くなり、NightWorkers が最初から最後まで実行しにくい。
- 専用ビューで表現できる内容を Markdown 本文に重複させ、正本が分からなくなる。

Plan mode は、網羅的な設計書を作る機能ではなく、実装者が迷わず着手し、検証までやり切れる Feature Plan を作る機能にする。

## 基本方針

Plan mode の primary artifact は `feature_plan` だけにする。

```ts
type CorePlanArtifact = 'feature_plan';
```

`feature_plan` は、1つの機能ドメインに閉じた実装計画書である。仕様、実装手順、検証は別成果物に分けず、1本の文書の中で責務を分ける。

別成果物として増やすのではなく、必要な場合だけ専用ビューを添える。

```ts
type DedicatedDesignView =
  | 'questionnaire'
  | 'user_flow'
  | 'blueprint'
  | 'data_model'
  | 'api_io_contract'
  | 'state_model'
  | 'activity_flow'
  | 'sequence_flow'
  | 'zod_schema_design';
```

Plan mode は、この `DedicatedDesignView` をすべて生成しない。案件特性を見て、必要なものだけを選ぶ。

## Feature Plan 本文

Feature Plan 本文は、実装を進めるための導線に集中する。

```ts
type FeaturePlanBody =
  | 'goal'
  | 'scope_non_goals'
  | 'current_and_desired_behavior'
  | 'acceptance_criteria'
  | 'constraints'
  | 'implementation_steps'
  | 'verification'
  | 'risk_notes';
```

### 1. Goal

何を達成する計画かを短く書く。

Goal は抽象的な改善目標ではなく、変更後に観測できる状態で書く。

例:

- Plan mode が、案件に応じて必要な専用ビューだけを選べる。
- UI なし案件では blueprint を要求しない。
- DB 変更がある案件では Data Model view に DDL を正本として表示する。

### 2. Scope / Non-goals

対象範囲と対象外を分けて書く。

Plan mode では、Non-goals が特に重要である。不要な設計ビューや、ついでの実装を抑止するために使う。

例:

- In scope: Plan mode の Feature Plan 構造、専用ビュー選択、本文とビューの責務分離。
- Out of scope: Plan mode 実行 UI の全面再設計、AI Coding Rules の埋め込み、contextStill 側のルール定義。

### 3. Current and Desired Behavior

現在の挙動と目標状態を並べる。

Current behavior は現行コード、既存 spec、runtime evidence から分かる範囲で書く。Desired behavior はユーザーに見える挙動、Supervisor の判断、保存される artifact の形に分けて書く。

### 4. Acceptance Criteria

Feature Plan が満たすべき pass/fail 条件を書く。

Acceptance Criteria は verification と重複させない。ここでは「何が満たされるべきか」を書き、verification では「どう確認するか」を書く。

### 5. Constraints

技術制約、運用制約、互換性制約を書く。

このセクションには AI Coding Rules を含めない。AI 実行規約や汎用 agent behavior は contextStill、Supervisor prompt、AGENTS.md、runtime instruction の領分であり、Feature Plan の機能ドメイン文書には入れない。

### 6. Implementation Steps

Feature Plan を実装に落とす順序を書く。

ここでは specification の再説明をしない。変更箇所、変更順、依存関係、受け入れ基準への対応だけを書く。

### 7. Verification

検証方針と完了 gate を書く。

`verification_matrix` は専用ビューにしない。Feature Plan 本文の `verification` が持つ。

Verification には最低限、次を含める。

- 必須 gate。
- focused test。
- manual または runtime evidence が必要な場合の確認方法。
- 期待結果。
- 失敗した場合の戻り先。

### 8. Risk Notes

実装時に壊しやすい点、スコープ外に広がりやすい点、後から戻しにくい判断を書く。

Risk Notes は一般論ではなく、この feature domain に固有の危険だけを書く。

## Specification の位置づけ

Feature Plan では、`specification` を独立 artifact にしない。Feature Plan 本文のうち、Goal、Scope、Current and Desired Behavior、Acceptance Criteria、Constraints が specification の役割を持つ。

必要に応じて specification 内の lens として、次の観点を使う。

```ts
type SpecificationLens =
  | 'target_users_or_actors'
  | 'functional_requirements'
  | 'business_rules'
  | 'input_output'
  | 'interface_contract'
  | 'data_requirements'
  | 'state_behavior'
  | 'workflow_behavior'
  | 'error_behavior'
  | 'permission_boundary'
  | 'compatibility'
  | 'observability';
```

これらは専用ビューではない。必要なときだけ specification 本文の小見出し、表、短い箇条書きとして使う。

未確定事項と前提確認は specification lens にしない。`open_questions` と `assumptions` は `questionnaire` に一本化する。

### interface_contract

API、worker tool、MCP tool、native bridge、provider adapter、LLM JSON など、呼び出し境界の入出力が重要な場合だけ使う。

複雑な場合は専用ビュー `api_io_contract` または `zod_schema_design` に昇格する。

### error_behavior

失敗時の扱いが仕様に影響する場合だけ使う。

例:

- LLM から本文が返ったが JSON parse に失敗した場合。
- provider timeout と schema validation failure を分ける場合。
- partial success を user-visible にする場合。

複雑な分岐は `activity_flow` で表す。

### permission_boundary

読み書き可能な範囲、repo root、secret、destructive operation、Plan 中の source edit 禁止など、許可境界が仕様に影響する場合だけ使う。

専用ビューにはしない。基本は Allowed / Forbidden の短いリストで十分である。

## 専用ビュー

専用ビューは、Feature Plan 本文から詳細を端折るために使う。本文の代替ではなく、本文から参照される詳細面である。

### questionnaire

`open_questions` と `assumptions` は `questionnaire` に寄せる。

Feature Plan 本文には、実装を止める未確定事項の存在と、その questionnaire への参照だけを残す。

`questionnaire` は、仕様策定アンケートを実装計画の代替にしない。曖昧さを減らすための補助ビューである。

### user_flow

ユーザー操作、画面遷移、手順が実装判断に影響する場合に使う。

UI がない案件、または user-visible flow が変わらない案件では生成しない。

### blueprint

`blueprint` は、UI specification と design view reference を統合するビューである。

UI がある場合は、画面構成、情報設計、主要 section、操作導線を扱う。UI がない場合は必須にしない。

Plan mode 全体の専用ビュー一覧を本文に `design_view_references` として持たせない。必要な場合、`blueprint` が関連ビューのハブになる。

ただし、blueprint は万能の設計書ではない。DB definition、DDL、API contract、Zod schema の正本を blueprint に置かない。

### data_model

`data_model` はデータ構造を見るビューである。`db_design` は専用ビューとして持たず、`data_model` に統合する。

DB が主題の場合、canonical source は DDL である。

```text
canonical source: DDL
user-facing view: Data Model
```

Data Model view は、DDL を編集または表示し、table、relation、constraint、index を読み取りビューとして見せる。

DDL と別の schema 正本を Data Model view に作らない。

DB がない場合、canonical source は対象に応じて変わる。

```ts
type DataModelSource =
  | 'ddl'
  | 'zod_schema'
  | 'json_schema'
  | 'typescript_type'
  | 'existing_runtime_shape';
```

例:

- DB table が主題: `ddl`
- API または tool payload が主題: `zod_schema`
- TypeScript 内部型が主題: `typescript_type`
- 既存 runtime の観測形状が主題: `existing_runtime_shape`

### api_io_contract

API、worker tool、MCP tool、native bridge、provider adapter などの境界契約が変更される場合に使う。

軽い入出力なら Feature Plan 本文の `interface_contract` lens で足りる。request / response、error shape、versioning、client impact、contract test が必要な場合だけ専用ビューにする。

### state_model

状態遷移が主題の場合に使う。

例:

- task lifecycle。
- run status。
- queue item status。
- approval state。
- retry / blocked / failed / completed の遷移。

Mermaid `stateDiagram` を使ってよい。ただし、図に存在しない state や将来拡張を混ぜない。

### activity_flow

条件分岐、fallback、validation、retry、error handling が主題の場合に使う。

Mermaid `flowchart` を使ってよい。文章で十分な場合は専用ビューにしない。

### sequence_flow

複数主体の呼び出し順が重要な場合に使う。

例:

- Supervisor -> worker tool -> provider -> DB。
- UI -> API -> native runner -> filesystem。
- Plan mode -> questionnaire -> blueprint -> data_model。

Mermaid `sequenceDiagram` を使ってよい。順序が実装リスクでない場合は生成しない。

### zod_schema_design

Zod schema、JSON schema、LLM response schema、tool input schema が主題の場合に使う。

`data_model` が構造を見せるビューだとすれば、`zod_schema_design` は validation、default、refinement、互換性、parse failure の扱いを決めるビューである。

DB DDL と Zod schema の両方がある場合、どちらを canonical source にするかを必ず明示する。

## 専用ビュー選択ルール

Plan mode は、最初に必要な専用ビューを選ぶ。

```ts
type DesignViewDecision = {
  view: DedicatedDesignView;
  decision: 'include' | 'omit';
  reason: string;
};
```

選択基準:

- 未確定事項が実装判断を止めるなら `questionnaire`。
- ユーザー操作や画面遷移が実装判断に影響するなら `user_flow`。
- UI specification または design view reference が必要なら `blueprint`。
- 永続データ、payload、artifact、queue shape が主題なら `data_model`。
- API、tool、bridge、provider adapter の境界が変わるなら `api_io_contract`。
- lifecycle が変わるなら `state_model`。
- 分岐や fallback が実装リスクなら `activity_flow`。
- 複数主体の呼び出し順が実装リスクなら `sequence_flow`。
- Zod schema や JSON validation が主題なら `zod_schema_design`。

省略基準:

- 図やビューがなくても実装判断が明確なら省略する。
- 同じ論点を複数ビューで重複説明しない。
- UI がない案件に blueprint を強制しない。
- DB がない案件に DDL を強制しない。
- 仕様本文で足りる入出力や error behavior を専用ビューに昇格しない。

## 図の扱い

Mermaid は使ってよい。ただし、図は専用成果物ではなく、専用ビュー内の表現手段である。

採用する図:

- `stateDiagram`: `state_model`。
- `flowchart`: `activity_flow`。
- `sequenceDiagram`: `sequence_flow`。

採用しない図:

- Usecase 図は初期 Plan mode では扱わない。
- 実装対象を増やすための将来像図は扱わない。
- 文章で十分な内容を見栄えのために図にしない。

図に出した node、actor、state、service は、既存実装、予定変更、acceptance criteria のいずれかに対応していなければならない。

## 出力構造

Feature Plan の標準構造:

```md
# Feature Plan: <feature domain>

## Goal

## Scope / Non-goals

## Current and Desired Behavior

## Acceptance Criteria

## Constraints

## Implementation Steps

## Verification

## Risk Notes
```

必要な専用ビューは、Feature Plan に添付または隣接 artifact として作る。

```md
# Data Model: <feature domain>

## Canonical Source

## DDL

## Derived Table Summary

## Relations

## Constraints and Indexes

## Migration / Compatibility Notes
```

```md
# Blueprint: <feature domain>

## Purpose

## Screens / Sections

## User Flow References

## Related Design Views
```

## Report Contract

Plan mode の完了報告では、次を短く返す。

- 作成または更新した Feature Plan。
- 採用した専用ビュー。
- 省略した専用ビューと理由。
- 最初に着手すべき implementation step。
- 実装開始前に残る questionnaire 項目。
- 必須 verification gate。

## Verification

このコンセプトが満たすべき条件:

1. Feature Plan 本文だけで、目的、範囲、目標状態、実装順、検証方針が追える。
2. 専用ビューが必要な場合だけ選ばれる。
3. `verification_matrix` が独立ビューではなく Feature Plan 本文の `verification` に統合されている。
4. `ui_specification` と `design_view_references` が `blueprint` に統合されている。
5. `open_questions` と `assumptions` が `questionnaire` に統合されている。
6. `db_design` が独立ビューではなく `data_model` に統合されている。
7. DB が主題の場合、DDL が canonical source として扱われる。
8. Usecase 図が初期 Plan mode から除外されている。
9. AI Coding Rules が Feature Plan から除外されている。
10. 専用ビューの詳細が Feature Plan 本文に重複していない。

## 非目標

- Plan mode で全専用ビューを必ず生成すること。
- Feature Plan を複数の仕様書、実装計画書、検証表に分割すること。
- AI Coding Rules を Feature Plan に含めること。
- Usecase 図を初期 Plan mode に入れること。
- DDL と Data Model summary の両方を正本として扱うこと。
- Blueprint に DB definition、API contract、Zod schema の正本を置くこと。
- contextStill のルールや運用知識を NightWorkers の Feature Plan に複製すること。
