# Project Intelligence Overview 実装計画

## 目的
NightWorkers に、Project Folder の現在地を一望する Overview Dashboard を追加する。
その裏側に、既存の run evidence、Blueprint artifact、adoption state、settings を横断して読む
Project Intelligence read model を置く。

この計画の対象は次の 3 点に限定する。

1. Project Health Snapshot
2. Decision Timeline
3. Drift Radar

Overview Dashboard は、詳細画面の焼き直しではなく「確認の入口」として扱う。
詳細確認は既存の Workbench、Artifact Pane、Run Timeline、Settings へ遷移する。

## スコープ

### 実装すること
- Project Folder 単位の Overview read model を作る。
- Project Health Snapshot を表示する。
- Decision Timeline を表示する。
- Drift Radar を表示する。
- 各 item から既存詳細画面へ遷移できる参照を持たせる。

### 実装しないこと
- Overview から run を開始しない。
- Overview から queue を操作しない。
- Overview から Blueprint / DB Design / Design Token を採用しない。
- Overview を設定編集画面にしない。
- score だけで Project Folder の良し悪しを断定しない。
- GitHub diff 解析、失敗収集、再発防止 knowledge 化をこの計画に含めない。
- Next Human Decision / 判断待ち一覧をこの計画に含めない。

## 全体構成

```text
task / run / event / message state
  + Blueprint / DB Design / Design Token adoption
  + Project Folder settings
    -> Project Intelligence read model
      -> Overview Dashboard
        -> Project Health Snapshot
        -> Decision Timeline
        -> Drift Radar
        -> detail links
```

## Backend Read Model

### 追加候補 module
```text
api/services/project-intelligence/
  collect-evidence.ts
  project-health.ts
  decision-timeline.ts
  drift-radar.ts
  types.ts
```

### 初期 API
```text
GET /api/repositories/:id/intelligence
```

### 返却 shape
```ts
type ProjectIntelligence = {
  repositoryId: string;
  generatedAt: string;
  health: ProjectHealthSnapshot;
  decisions: ProjectDecision[];
  driftItems: ProjectDriftItem[];
};
```

### 実装方針
- 新しい永続 table は追加しない。
- 既存 repository / service / task event / task message / adoption state / settings を読む。
- Project Intelligence は read model として計算し、source evidence の代替にはしない。
- 各 item は、task / run / event / message / adoption / settings のいずれかを evidence ref として持つ。

## Overview Dashboard

### 追加候補 route
```text
/repositories/:id/overview
```

または Project Folder 選択後の初期表示として Overview を置く。

### 表示方針
- Overview は詳細を抱え込まない。
- Project Health、Decision Timeline、Drift Radar の 3 section に限定する。
- 各 section は要約と確認先 link を出す。
- 詳細は Workbench、Artifact Pane、Run Timeline、Settings に任せる。
- Project Sidebar には Overview への導線と小さな状態 indicator だけを置く。

## 1. Project Health Snapshot

### 目的
Project Folder の現在状態を、最上段の summary として表示する。

### 対象データ
- task status
- latest run status
- verification evidence の有無
- Blueprint adoption state
- DB Design adoption state
- Design Token adoption state
- MCP / Hooks / queue settings の有効状態

### 表示内容
- 実行状態: draft / queued / running / needs_review / completed / blocked
- 検証状態: verification evidence の有無、未検証の completed run
- Blueprint 状態: adopted artifact の有無、最新 artifact との関係
- DB Design 状態: data contract が空か、採用済み revision があるか
- Design 状態: adopted design token の有無
- 設定状態: MCP / Hooks / queue settings の有効状態

### 実装タスク
1. `ProjectHealthSnapshot` type を定義する。
2. Project Folder 配下の task / run / message / adoption / settings を収集する。
3. health summary を evidence ref 付きで組み立てる。
4. Overview Dashboard の最上段に summary section を追加する。
5. Project Sidebar に Overview への導線を追加する。

### 検証
- completed run without verification を health に出せる。
- adopted Blueprint が存在する場合、health に反映される。
- settings が未設定の場合でも Overview が壊れない。
- health item が詳細画面への参照を持つ。

## 2. Decision Timeline

### 目的
run event timeline とは別に、Project Folder の意思決定だけを抽出して表示する。

### 対象データ
- Blueprint artifact の生成 message
- Blueprint adoption / unadoption
- DB Design revision の生成と採用
- Design Token settings の採用
- final judgment
- policy block
- verification result
- MCP / Hooks 設定の変更

### 表示内容
- 日時
- 種別
- summary
- evidence ref
- 詳細画面 link

### 実装タスク
1. `ProjectDecision` type を定義する。
2. task messages、task events、adoption state、settings update state から decision candidate を抽出する。
3. Project Folder 単位で時系列に並べる。
4. Decision Timeline section を Overview に追加する。
5. 詳細な run event は表示せず、必要な場合は Run Timeline に遷移する。

### 検証
- Blueprint artifact 生成が timeline に出る。
- Blueprint adoption が timeline に出る。
- final judgment / verification result が timeline に出る。
- run event 全量を Overview に表示しない。
- timeline item から詳細画面へ遷移できる参照を持つ。

## 3. Drift Radar

### 目的
採用済み artifact、最新 artifact、run evidence、settings のズレを read-only diagnostic として表示する。

### 初期 drift item
- 採用済み Blueprint より新しい未採用 Blueprint がある。
- 採用済み DB Design があるが、planning path が別 artifact を参照している可能性がある。
- Design Token adoption があるが、backend preset / preview settings / implementation reference の語彙が一致していない。
- completed run に verification evidence がない。
- queue settings と現在の running / queued state が直感的に読み取りにくい。
- MCP / Hooks が有効だが、直近の接続確認・test execution が古い。

### 表示内容
- severity
- reason
- evidence ref
- 確認先 link

### 実装タスク
1. `ProjectDriftItem` type を定義する。
2. 初期 drift rule を read-only 関数として実装する。
3. drift item に evidence ref と確認先 link を持たせる。
4. Drift Radar section を Overview に追加する。
5. 自動修正や採用操作は実装しない。

### 検証
- adopted Blueprint より新しい generated Blueprint を検出できる。
- completed run without verification を検出できる。
- settings が不足していても diagnostic が推測だけで出ない。
- drift item が evidence ref を持たない場合は表示しない。
- Drift Radar から自動修正操作ができない。

## 実装順
1. Backend type と read model の skeleton を追加する。
2. Project Health Snapshot を service test 付きで実装する。
3. Decision Timeline を service test 付きで実装する。
4. Drift Radar を service test 付きで実装する。
5. `GET /api/repositories/:id/intelligence` を route test 付きで追加する。
6. Overview Dashboard route / section を追加する。
7. 既存詳細画面への link をつなぐ。

## 検証計画
- `pnpm test run tests/services.project-intelligence.test.ts`
- `pnpm test run tests/routes.nightworkers.test.ts tests/routes.nightworkers-workbench.test.ts`
- `pnpm test run tests/nightworkers.workbench-selectors.test.ts`
- `pnpm verify`

## 完了条件
- Overview Dashboard が Project Health Snapshot、Decision Timeline、Drift Radar の 3 section だけを表示する。
- Backend read model が新しい永続 table なしで構築されている。
- すべての health / decision / drift item が evidence ref または確認先 link を持つ。
- Overview から run 開始、queue 操作、artifact 採用、settings 編集ができない。
- 失敗収集、GitHub diff 解析、再発防止 knowledge 化、Next Human Decision が混入していない。
