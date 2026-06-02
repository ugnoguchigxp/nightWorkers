# Personal Autonomous Development Workbench Concept

作成日: 2026-06-02  
対象プロジェクト: NightWorkers / contextStill を主軸にした personal Devin 型開発環境

---

## 1. コンセプト

このプロジェクトは、単なる AI コーディングエージェント UI ではなく、**個人用途で使える autonomous development workbench** を目指す。

中心となる思想は次の通り。

- **Chat を起点に仕様を検討する**
- **仕様からタスクを生成する**
- **タスクを Queue に積む**
- **Coding Agent が実装する**
- **NightWorkers が実行・監査・レビュー・ledger を管理する**
- **contextStill が手続き・ルール・経験を蓄積し、次回以降の精度を高める**
- **完了後は conductor agent が追加レビュー、テスト強化、coverage 改善、学習登録を半自動で進める**

従来の Kanban やタスク管理ではなく、**Project ごとの Session / Task 実行状態を見ながら、Chat で新規仕様検討や既存タスク調整を行う Chat-first Agent Workbench** として設計する。

---

## 2. 中核となる既存プロジェクト

### 2.1 contextStill

contextStill は、AI コーディングエージェント向けの local-first adaptive knowledge compiler。

役割:

- 手続き・ルール・過去の経験を保持する
- タスクごとに context を compile する
- AI エージェントへ適切なルール・やり方・注意点を提示する
- compile の有用性を評価し、次回以降の精度改善につなげる
- agent log、wiki/docs、Web、candidate note、レビュー結果などを知識化する

現状の前提:

- 約3000点の手続き・ルールを保持している
- タスクごとの context compile が機能し始めている
- LLM評価軸で compile 成功率は80点後半から90点台を維持している
- NightWorkers の実行結果や conductor agent の判断結果を取り込むことで、さらに精度を高める

### 2.2 NightWorkers

NightWorkers は、AI coding agent の実行・監査・レビュー・安全制御を担う local-first control plane。

役割:

- タスク実行を管理する
- Coding Agent / Codex の実行ログを保存する
- diff、test result、final judgment、review result を ledger として残す
- human review / conductor review を扱う
- policy block、needs human、failed run などを状態として管理する
- contextStill から compile された context を使って実行する

### 2.3 Conductor Agent

Conductor Agent は、Coding Agent がタスクを終了した時に Hook で起動する指揮者エージェント。

役割:

- NightWorkers の run ledger を読む
- diff、test、coverage、PR、review 結果を確認する
- タスクを Done にしてよいか判断する
- 必要なら追加タスクを生成する
- コードレビュー、coverage 改善、テスト追加、リファクタリング、ドキュメント更新を指示する
- contextStill に compile_eval や learning candidate を登録する
- 次回以降の精度改善に回す

Conductor Agent は直接大きなコード変更を行うのではなく、**状態遷移と次アクションの決定者** として設計する。

---

## 3. UI の基本方針

### 3.1 Kanban ではなく Project / Session List

通常の Kanban カード UI は、この用途には必ずしも適さない。

理由:

- 相手は人間ではなく AI agent
- 担当者、期限、コメント数、チーム通知は主軸ではない
- 重要なのは、どの Project で、どの Session / Task が、どの phase にあり、どこまで進んでいるか
- 新規機能や改善案は、タスクが存在する前に Chat で検討される

そのため、UI は **Codex のような Project 名配下の Session 一覧** に近づける。

### 3.2 Session 型の 1 行アイテム

カードではなく、Project 名の下に Session / Task を 1 行アイテムとして表示する。

表示例:

```text
contextStill
  ● Implementing 72%  Improve context ranking
  ○ Queued      --   Add compile quality dashboard
  ○ Queued      --   Improve MCP tool docs
  ▸ Archived 38

NightWorkers
  ● Reviewing   81%  Add conductor hook
  ○ Queued      --   Review result UI
  ▸ Archived 21
```

1行アイテムに表示する主な情報:

- 状態アイコン
- 現在フェーズ
- 進捗率
- タスク名 / セッション名
- 必要に応じて context score、test status、PR status、token 異常などの小さなバッジ

### 3.3 状態分類

Session / Task は主に次の3分類で表示する。

- **Processing**: 現在処理中
- **Queue**: 実行待ち
- **Archive**: 処理済み。普段は折りたたみ

Processing 内部のフェーズ:

- Analyzing
- Context Compiling
- Implementing
- Verifying
- Reviewing
- Improving
- Learning
- Needs Human

Queue は優先度順に並べる。縦並びの場合は、上ほど高優先とする。

---

## 4. 画面レイアウト

### 4.1 Artifact 非表示時

通常時は、Chat を主役にする。

```text
┌──────────────────────────────────────────────────────────────┐
│ Project / Queue 30% │ Chat 70%                               │
│                     │                                        │
│ Projects            │ Project-targeted / Session chat        │
│ Sessions            │                                        │
│ Running / Queue     │                                        │
│ Archived folded     │                                        │
└──────────────────────────────────────────────────────────────┘
```

左 30%:

- Project 一覧
- Project ごとの Processing / Queue / Archive
- Session item
- `+ New Session`

中央 70%:

- 選択中 Project / Session の Chat
- 新規機能検討
- 仕様検討
- タスク追加
- 既存タスクの調整
- conductor / review への指示

### 4.2 Artifact 表示時

Artifact を開いた時は、右側に Artifact 表示領域を追加する。

```text
┌──────────────────────────────────────────────────────────────┐
│ Project / Queue 30% │ Chat 40%              │ Artifact 30%    │
│                     │                       │                 │
│ Projects            │ Conversation          │ Spec / Diff     │
│ Sessions            │                       │ Tests / PR      │
│ Running / Queue     │                       │ File preview    │
└──────────────────────────────────────────────────────────────┘
```

左 30%:

- Project / Queue Navigator

中央 40%:

- Chat

右 30%:

- Spec
- Plan
- Diff
- Source code preview
- Test result
- Coverage
- PR
- contextStill compile output
- NightWorkers ledger
- Learning candidates

Artifact を閉じると Chat は再び 70% に戻る。

---

## 5. Chat の役割

### 5.1 Chat は補助 UI ではなく中核

この Workbench において、Chat は単なる会話欄ではない。  
Project や Task を生成・調整・レビューするための主要 UI である。

Chat の使い方:

- 新しい機能を考える
- 改善点を洗い出す
- 仕様を検討する
- 「仕様書に落として」と依頼する
- 「タスク化して Queue に入れて」と依頼する
- 実行中タスクへ追加要件を出す
- レビュー結果を見て追加修正を依頼する
- conductor agent に判断理由を聞く
- contextStill に登録すべき学びを整理する

### 5.2 Project-targeted New Session

タスクが存在しない状態でも、Project に対して新しい Chat Session を開始できる必要がある。

例:

```text
contextStill
  + New Session
  ● Implementing 72%  Improve context ranking
  ○ Queued      --   Add compile quality dashboard
```

`+ New Session` を押すと、中央 Chat がその Project を対象にした新規セッションになる。

そこで次のような会話を行う。

```text
ユーザー:
  contextStill の改善点を洗い出したい

LLM:
  改善候補を整理します...

ユーザー:
  このうち A と C を仕様書に落として

LLM:
  Spec Draft を生成します

ユーザー:
  タスク化して Queue に入れて

システム:
  Task Draft を作成し、Project の Queue に追加
```

### 5.3 Session item クリック時

既存 Session / Task をクリックすると、中央 Chat がその Session に復元される。

復元されるもの:

- 過去の会話
- 現在の phase
- NightWorkers run
- contextStill compile run
- Spec / Plan / Diff / Test / PR artifact
- conductor decision
- learning status

---

## 6. Artifact の役割

Artifact は、Chat で生成・参照される成果物を表示する右ペイン。

Artifact 種別:

- Spec Artifact
- Implementation Plan
- Context Pack
- Code Diff
- Source File Preview
- Test Result
- Coverage Report
- Pull Request
- Review Result
- NightWorkers Run Ledger
- contextStill Learning Candidate

Artifact は常時表示しない。必要な時だけ右 30% を開く。

---

## 7. Task / Session の概念

### 7.1 Session item の実体

UI上は Session item に見えるが、内部的には Task / ChatSession / Run / Artifact を束ねる実行単位。

```text
Session item =
  Task
  + ChatSession
  + NightWorkers Run
  + contextStill Compile Run
  + Artifact
  + Conductor Decision
  + Learning Capture
```

### 7.2 タスク生成の流れ

```text
Project-targeted Chat
  ↓
仕様検討
  ↓
Spec Artifact
  ↓
Task Draft
  ↓
Queue
  ↓
Processing
  ↓
NightWorkers Run
  ↓
Conductor Review
  ↓
Learning Capture
  ↓
Archive
```

### 7.3 Task status

大分類:

- queued
- processing
- needs_human
- done
- archived
- failed
- cancelled

### 7.4 Task phase

処理中の詳細フェーズ:

- analysis
- context_compile
- implementation
- verification
- review
- improvement
- learning

---

## 8. 進捗率

進捗率は LLM の自己申告ではなく、成果物・状態・gate に基づいて算出する。

例:

```text
0%   raw request
10%  structured ticket generated
20%  acceptance criteria validated
30%  contextStill compile completed
50%  coding agent produced diff
65%  verification started
75%  tests passing
85%  conductor review passed
95%  contextStill eval/candidates registered
100% archived / done
```

進捗率は UI のメイン情報として Session item に表示する。

---

## 9. Token KPI

Token budget は主役にしない。  
代わりに、実績ベースの token telemetry を KPI として扱う。

見るべき指標:

- input tokens
- output tokens
- total tokens
- tokens by phase
- tokens by agent
- tokens per completed task
- tokens per review cycle
- tokens until first green
- tokens until done
- context tokens ratio
- wasted tokens ratio
- anomalous token spike

目的:

- どの工程が token を消費しているかを見る
- contextStill の compile 精度が token 削減に効いているか確認する
- review loop が増えた原因を分析する
- 異常に token を使うタスクを検出する

---

## 10. Git / GitHub 連携

Git 管理は GitHub 依存でよい。  
Workbench 内で GitHub を再実装しない。

保持する情報:

- repo URL
- branch name
- base branch
- PR number
- PR URL
- checks status
- mergeable status
- changed files
- diff summary

Branch 命名例:

```text
agent/{task-id}-{slug}
```

PR は Artifact として右ペインに表示する。

---

## 11. Design System / Theme

Workbench 自体にもデザインシステムを持たせる。

デザインは直接 CSS を自由編集するのではなく、design token 経由で変更する。

対象 token:

- color
- spacing
- typography
- radius
- shadow
- density
- motion
- phase color
- status color
- card / session item style

将来的には、デザイン変更も Task として扱う。

例:

```text
Task:
  高密度表示に適した compact dark theme を作る

Acceptance Criteria:
  - Project Session list の縦密度が上がる
  - phase badge が読みやすい
  - Needs Human が高コントラストで目立つ
  - token 異常バッジが視認できる
  - screenshot regression が通る
```

---

## 12. 画像生成 API の位置づけ

画像生成 API は中核機能ではなく、デザイン探索の補助として扱う。

用途:

- theme mood board
- UI concept image
- empty state illustration
- project icon
- visual direction comparison
- design token 抽出の参考
- landing page hero

理想的な流れ:

```text
ユーザー:
  もっとSFっぽいが、実用的なUIテーマにしたい

Image / Design Agent:
  mood image / UI concept を生成

Theme Agent:
  画像から token 方針を抽出

Coding Agent:
  design tokens を変更

Review Agent:
  screenshot diff / contrast / density を確認
```

---

## 13. MVP

最初の MVP で必要なもの:

1. 左 30% の Project / Session / Queue Navigator
2. 中央 70% の Chat
3. Project-targeted New Session
4. Session item の復元
5. Processing / Queue / Archive 表示
6. 右 30% の Artifact Pane
7. Spec Artifact 生成
8. Task Draft 生成
9. Queue 追加
10. NightWorkers run 連携
11. contextStill compile 連携
12. token input/output の表示

初期段階では、GitHub PR 連携、coverage dashboard、画像生成 API、theme editor は後続でもよい。

ただし、design token の基盤だけは初期から入れる。

---

## 14. UI コンセプト名

候補:

- Agent Workbench
- Project Sessions
- Agent Sessions
- Personal DevOS
- Chat-first Agent Workbench
- Autonomous Development Workbench

現時点では、**Chat-first Agent Workbench** が最もコンセプトを表しやすい。

---

## 15. 最終まとめ

この構想は、Kanban でも単なる Chat UI でもない。

最終的な定義:

> Project ごとの Session / Task 状態を左で監視し、中央 Chat で新規仕様検討・タスク投入・既存タスク調整を行い、右 Artifact で仕様書・diff・test・PR・learning を確認する、Chat-first な AI coding agent workbench。

中核となる価値:

- タスクが存在する前から Project-targeted Chat で構想を始められる
- 仕様検討から Task 化、Queue 投入まで Chat で行える
- Coding Agent の実行は NightWorkers が管理する
- contextStill がルール・手続き・経験を蓄積し、精度を改善する
- conductor agent が完了後のレビュー・テスト強化・学習登録を半自動で進める
- token input/output を KPI として、AI 開発の効率を測定できる
- UI は Codex 的な Project / Session 一覧を拡張し、Processing / Queue / Archive と進捗率を持つ

この Workbench は、個人用途の Devin を目指すだけでなく、**構想 → 仕様 → タスク → 実装 → レビュー → 学習** を閉じた local-first autonomous development ecosystem の中核 UI となる。
