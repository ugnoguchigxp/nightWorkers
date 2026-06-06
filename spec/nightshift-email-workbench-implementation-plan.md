# NightShift Email Workbench Implementation Plan

## 実装ステータス

Status: **MVP implemented / Future phases deferred**

この設計書のうち、NightShift Email Workbench として必要な最小運用ループは実装済み。

```text
Session で実装計画を作る
  -> NightShift に追加する
    -> Queue Entry として実行する
      -> Review needed として朝レビューする
        -> 満足なら Accept
        -> 不満なら元の priority / queue position を尊重して優先再投入する
        -> 採用しない場合は Queue execution を Archive する
```

実装済み範囲:

- Project / Session の親子関係を維持した Email ライクな Session list。
- Session row の `plan_ready` / `queued` / `running` / `needs_input` / `review_needed` / `done` / `failed` 表示。
- Project 内 NightShift summary。
- Right Workbench の plan-ready / queued / review-needed banner。
- NightShift admission と `implementation_queue_entries` 作成の統合。
- Queue から外しても Session を保持する処理。
- completed run を `review_needed` として扱う derived state。
- human review submit API。
- Accept 後の Queue execution archive。
- stopped Queue Entry の requeue API。
- requeue 時に元の `priority` / `queuePosition` を維持する処理。
- contextStill 未接続を前提にした軽量 Decision support UI。

明示的に後続へ回す範囲:

- Phase 5: phase-based Model Routing の global defaults。
- Phase 6: Session / Queue Entry model override。
- Phase 7: Attention 補助ビュー。
- reviewChecklist の重い永続化。
- request fix を専用 workflow として保存・再投入する詳細導線。
- contextStill への decision packet / feedback 送信本体。

後続へ回す理由:

- MVP の価値は、実装計画から夜間実行、朝レビュー、優先再投入までの一本線が動くことにある。
- Model Routing と override は provider/model 解決、Settings UI、usage evidence、migration を伴う別の設計判断である。
- Attention は Project / Session 主構造を壊さない read model 設計が必要であり、急いで入れると専用 Queue board に戻りやすい。
- reviewChecklist は、人間レビューを重くしない方針と衝突しやすいため、軽量 review result と将来の自動コードレビュー結果の関係を先に整理する。
- contextStill 連携は contextStill 側の decision advice 機能が未実装であり、現時点では UI / service 境界だけを準備する。

## 目的

NightWorkers の Workbench を、Project と Session の親子関係を維持した Email ライクな UI に寄せる。

Queue は独立した巨大な管理画面として前面化するのではなく、Project 配下の Session 一覧に状態と操作として統合する。NightShift は「夜に実行する Queue」そのものではなく、選択中 Project の Session を、夜間実行・実行中・未レビュー完了・要対応の観点で見る運用モードとして扱う。

この計画は、既存の `spec/implementation-queue-redesign-plan.md` を削除するものではない。既存計画で定義した Queue Entry、Processor、claim、drain、Todo Workflow は backend control layer として維持する。一方で、ユーザーが日常的に触る主 UI は、専用 Queue board ではなく Project 配下の Email ライクな Session list と右側 Workbench に寄せる。

最終的な運用サイクルは次の形にする。

```text
Project を選ぶ
  -> Session 一覧を見る
    -> 右側の Chat Workbench で AI と会話して実装計画に到達する
      -> Session を NightShift / Queue に入れる
        -> 夜間に Processor が順次実行する
          -> 朝に未レビュー完了タスクを確認する
            -> accept / request fix / requeue / archive を選ぶ
```

## 背景

これまでの Implementation Queue は、通常 Chat と自動実行を分離するために必要だった。ただし、専用 Queue 画面を強く出すと、Project / Session の運用単位が崩れ、Session が Project から剥がれて散らばった印象になる。

NightWorkers の価値は、単に Queue を視覚的に管理することではない。価値の中心は、次の 3 点にある。

1. AI と会話しながら実装計画を作る。
2. 実装計画ができた Session を夜間実行へ流す。
3. 朝に完了結果をレビューし、必要なら修正再投入する。

そのため、右側の Chat Workbench と Prompt Composer は常に維持する。左側は Project / Session / NightShift 状態を一体で扱う。

## 既存 Queue 計画との関係

`spec/implementation-queue-redesign-plan.md` のうち、次は継続する。

- Queue Entry は `implementation_queue_entries` を source of truth にする。
- Processor は Queue Entry を atomic claim して `task_runs` を作る。
- TodoList は Run 内部の milestone であり、Queue item ではない。
- Queue membership は通常 Chat をブロックしない。
- Queue execution archive は Session archive ではない。

この計画で見直すのは主に次の UI 方針である。

- 専用 Queue screen を主導線にしない。
- Project 横断の Queue board を日常運用の中心にしない。
- Project 配下の Session list に Queue / NightShift state を統合する。
- Queue 候補、queued、running、review needed を同じ Session list 上で扱う。

既存 API や backend state は、可能な限り後方互換で使う。UI の見せ方を変えるためだけに Queue source of truth を増やさない。

## 非目標

- Project と Session の親子関係を壊すグローバル Inbox / global Review / global NightShift を主画面にしない。
- Queue を 4 カラム以上の巨大ボードとして作り直さない。
- risk low / risk medium のような抽象 badge を主表示にしない。
- TodoList を user-facing Queue item として扱わない。
- NightShift を Chat 応答可否の制御に使わない。
- user text の keyword / regex でモデルや実行フェーズを分類しない。

## 基本方針

### 1. Project -> Session を主構造にする

UI の主構造は次を維持する。

```text
Project
  Session
    Chat / Run / Artifact / Queue state
```

Session は Project 配下に残す。NightShift や Review は Session を別の場所へ移動する概念ではなく、Session の表示状態・filter・操作として扱う。

### 2. 右側 Chat Workbench は永続する

AI と会話しなければ実装計画に到達できない。したがって、Chat Workbench と Prompt Composer は画面右側に常時表示する。

右側には次を置く。

- selected Session title
- Session state / Queue state
- Artifact controls
- Chat timeline
- implementation plan banner
- NightShift / Queue admission action
- Prompt Composer

### 3. 左側 Session list に NightShift 状態を統合する

NightShift は上部 tab ではなく、Session list の filter / sort / row action として扱う。

Session row は 3 行程度に圧縮する。

```text
Queue 導線の見直し                         [Plan ready]
updated 12m · last message from assistant
Queue · Open
```

```text
設定画面 provider 表示改善                 [Queued #3]
waiting for processor · tonight order
Remove · Open
```

```text
Morning review 導線                         [Review needed]
tests passed · diff ready · final report
Review · Requeue
```

### 4. NightShift は選択中 Project の運用サマリーにする

Project header または Session list header に、選択中 Project の NightShift summary を表示する。

```text
NightShift: 5 queued · 1 running · 3 review needed · 1 needs input
```

これは global dashboard ではない。選択中 Project の作業状態を表す。

### 5. Attention は補助ビューとして検討する

Slack の attention list のように、人間の目が必要なものを横断表示する専用ビューは有効な可能性がある。ただし、Project / Session 主構造を壊さない。

Attention item は必ず元の Project / Session へ戻る参照を持つ。

対象候補:

- review needed
- needs input
- failed / blocked
- plan ready but not queued
- stale running
- provider / MCP / hook issue

この計画では Attention を主画面にはしない。後続拡張候補として扱う。

## 情報設計

### Left Rail

最小限にする。

```text
Projects
Attention
Settings
```

`Inbox`、`Review`、`NightShift` を rail の主項目にしない。これらは Project / Session から独立したグローバル状態に見えやすいため。

### Project / Session Pane

構成:

1. Project selector / Project list
2. selected Project header
3. NightShift summary
4. filter / sort controls
5. compact Session list

Filter 候補:

- All
- Plan ready
- Queued
- Running
- Review needed
- Needs input
- Done

Sort 候補:

- Recent
- Tonight order
- Needs attention

### Session Row State

Session row に出す状態は、Session と Queue の融合に必要なものだけにする。

| State | 意味 | Primary action |
| --- | --- | --- |
| `draft` | 会話・調査・計画中 | Open |
| `plan_ready` | 実装計画があり Queue に入れられる | Queue |
| `queued` | NightShift / Queue に投入済み | Remove |
| `running` | Processor が実行中 | Open run |
| `needs_input` | 人間判断待ち | Respond |
| `review_needed` | 実行完了、未レビュー | Review |
| `done` | レビュー済み・確認済み | Open |
| `failed` | 実行失敗 | Inspect |

`risk low` のような抽象 badge は出さない。必要なら review/report 側にリスク評価を残すが、Session list の主操作には使わない。

### Right Workbench

右側は selected Session の作業面。

必要要素:

- Session header
- queue state
- selected model profile summary
- artifact buttons
- chat timeline
- plan-ready banner
- queue admission banner
- review-needed banner
- prompt composer

Plan ready の banner:

```text
実装計画が作成されました
この Session を NightShift に追加できます。
[NightShift に追加] [計画を編集]
```

Queued の banner:

```text
NightShift に追加済み
Queue position #3。夜間 Processor が順次実行します。
[Queue から外す] [優先度を変更]
```

Review needed の banner:

```text
実行が完了しました。レビューが必要です。
diff、test result、final report を確認してください。
[Review] [修正を依頼して再投入] [Archive]
```

## NightShift / Queue の扱い

### Queue は backend control layer

Queue Entry、Processor、claim、drain、stale recovery は backend control layer として維持する。

UI では Queue そのものを主画面にしない。Session list 上で Queue state を見る。

### NightShift に入る条件

NightShift に入る Session は、原則として implementation plan があるものに限定する。

例外:

- user が明示的に immediate implementation として送った場合は、NightShift admission を経由せず直接 Run が始まることがある。
- 既存 workflow が code_change / code_edit として `startTaskRun(...)` へ進める場合も、Queue Entry を作らず running state として Session list に反映する。

ただし、Queue membership は通常 Chat をブロックしない。

### 未レビュー完了タスク

実行完了後、Session は自動で `done` にはしない。

まず `review_needed` として扱う。

`review_needed` へ入る条件:

1. final report が存在する。
2. Run が terminal state に到達している。
3. diff / artifact / verification result のいずれか、または「成果物なし」の明示的な final report が確認できる。

`review_needed` から出る条件:

1. user が accept / request fix / requeue / archive のいずれかを選ぶ。
2. 選択結果が review result として保存される。
3. Queue execution が必要に応じて archived / requeued される。

review 結果:

| Action | 結果 |
| --- | --- |
| Accept | review result を `accepted` として保存し、Queue execution を archived にする。Session は会話可能なまま残す |
| Request fix | 修正依頼 message を追加し、必要なら Queue に再投入 |
| Requeue | 同じ Session を新しい Queue Entry として再投入 |
| Archive | Queue execution を archive し、Session は保持 |

### Decision Support / contextStill 連携準備

contextStill に実行結果の判断を委ねる機能はまだ存在しない。そのため初期実装では、
判断そのものは人間が行う。ただし UI と service 境界は、将来 contextStill advice を差し込める
形にしておく。

右側 Workbench には軽量な Decision support panel を置く。

```text
Decision support
contextStill advice は未接続です。いまは人間が結果を確認し、満足なら Accept、
修正が必要なら優先再投入を選びます。

state: review_needed · queue: execution_completed · priority: 9 · position: #2
[Accept] [優先再投入] [Archive]
```

この panel は重い review checklist ではない。AI によるコードレビューや Todo 検証は
実行プロセス側で行い、ユーザーは成果物を見て「満足 / 不満 / 採用しない / 再投入」
程度の最終判断を行う。

将来 contextStill 連携を追加する場合は、次の情報を decision packet として渡す。

- Session / Queue Entry / Run の状態。
- final report、diff、test result、human note の参照。
- 現在止まっている理由。
- 選択可能な action: accept、request_fix、requeue、archive。
- 依存 Queue がある可能性と、requeue は元の priority / queue position を尊重する方針。

contextStill の回答は pros / cons / recommended action として panel に表示する。最終的な
accept / failure / user satisfaction は review result として保存し、後続で contextStill に
feedback できるようにする。

## フェーズ別 LLM Model Routing

NightWorkers は単一 active model だけではなく、フェーズ別モデル routing を持つ。

### Phase

初期対象:

| Phase | 用途 |
| --- | --- |
| `planning` | 実装計画作成 |
| `implementation` | 夜間実装 |
| `test_generation` | test 実装 |
| `verification` | lint / typecheck / test 結果の判断 |
| `repair` | 失敗時の修正 |
| `final_review` | 最終レビュー |
| `morning_summary` | 朝レビュー向け要約 |

### Routing Policy

グローバル既定を Settings に置く。

```text
Planning          high quality model
Implementation   fast / cost efficient model
Test generation   fast / cost efficient model
Verification      fast or medium model
Repair            high quality model when failure is complex
Final review      high quality model
Morning summary   high quality or medium model
```

### Override 優先順位

```text
Queue Entry override
  > Session override
    > Project override
      > Global phase default
        > Active provider/model fallback
```

### UI 方針

Settings:

```text
Model Routing
Planning          [provider / model]
Implementation   [provider / model]
Test generation   [provider / model]
Verification      [provider / model]
Repair            [provider / model]
Final review      [provider / model]
Morning summary   [provider / model]
```

Session:

```text
Model profile: Global default
[Override]
```

NightShift admission:

```text
この Session は以下のモデル設定で夜間実行されます。

Implementation: gpt-5.4-mini
Test generation: gpt-5.4-mini
Final review: gpt-5.5

[この Session だけ変更] [NightShift に追加]
```

### Persistence

LLM usage record には、provider/model だけでなく phase と routing source を残す。

```text
provider
model
phase
routingSource
resolvedFrom
```

これにより、Overview で planning / implementation / review のコスト・品質傾向を追える。

## Persistence 方針

### 既存 table の利用

- `repositories`: Project Folder。
- `tasks`: Session。
- `task_runs`: Run。
- `implementation_queue_entries`: Queue Entry。
- `task_run_todos`: Run 内部 TodoList。
- `task_events`: Run evidence。
- `activity_events`: Session / activity ledger。
- `llm_usage_records`: provider/model/usage evidence。

### 追加候補

最小変更の場合、まずは既存の settings JSON と、すでに `metadataJson` を持つ table に限定して保存する。`tasks` や `implementation_queue_entries` など、現時点で `metadataJson` を持たない table へ暗黙に詰め込む前提にはしない。

後続で安定したら、次の永続化を検討する。

1. `model_routing_settings`
2. `project_model_routing_overrides`
3. `task_model_routing_overrides`
4. `queue_entry_model_routing_overrides`
5. `task_review_results`

初期実装で override を永続化する場合、既存 table への ad hoc JSON 追加ではなく、migration で専用 table または明示 column を追加する。

### Review Result 共通 shape

未レビュー完了タスクを扱うため、review 結果は共通 shape に寄せる。

```ts
type SessionReviewResult = {
  taskId: string;
  runId: string;
  reviewedAt: string;
  reviewer: 'human' | 'llm' | 'mixed';
  decision: 'accepted' | 'request_fix' | 'requeue' | 'archived';
  summary: string;
  checklist: Array<{
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'not_applicable' | 'not_checked';
    evidenceRef?: string;
  }>;
  nextAction?: {
    type: 'none' | 'create_message' | 'queue_again' | 'archive_queue_execution' | 'open_session';
    payload?: Record<string, unknown>;
  };
};
```

### reviewChecklist

reviewChecklist は計画の一部として扱い、UI と persistence の両方で同じ shape を使う。

初期 checklist:

1. final report が存在する。
2. diff / artifact がある場合は確認できる。
3. verification result がある場合は確認できる。
4. 失敗・blocked・needs human が残っていない。
5. user が accept / request fix / requeue / archive のいずれかを選んだ。

## 実装順序

### Phase 0: 現状差分と用語を固定する

Status: **implemented**

目的: 既存 Queue 計画と今回の Email Workbench 方針の差分を明文化する。

作業:

1. `implementation-queue-redesign-plan.md` で専用 Queue 画面寄りの箇所を確認する。
2. UI 用語を `Project Folder`、`Session`、`Run`、`Queue Entry`、`NightShift`、`Review needed` に揃える。
3. `task` という内部名を UI 表示では Session に寄せる。
4. Queue は backend control layer、NightShift は Project 内 Session view と定義する。

検証:

```bash
rg -n "NightShift|Review needed|Queue Entry|Session" spec README.md src/modules/nightworkers
```

Exit:

- 用語の衝突が整理されている。

### Phase 1: Project / Session Pane を Email ライクに整理する

Status: **implemented**

目的: Project と Session の親子関係を維持したまま、Session list に Queue state を統合する。

作業:

1. Project selector / Project list を維持する。
2. Inbox / Sessions / NightShift の上部 tab を作らない。
3. Session list header に NightShift summary を追加する。
4. Session row を 3 行程度に圧縮する。
5. Session row に queue state と primary action を出す。
6. risk badge などの抽象 badge は出さない。

検証:

```bash
pnpm test run tests/nightworkers.workbench-selectors.test.ts tests/nightworkers-active-session.test.ts
pnpm lint
```

Exit:

- Project を選ぶと、その Project 配下の Session 一覧が Email ライクに表示される。
- Queue state が Session row 上で確認できる。

### Phase 2: Right Workbench を永続主面として固定する

Status: **implemented**

目的: AI と会話して実装計画へ到達する導線を維持する。

作業:

1. 右側 Workbench の Chat timeline と Prompt Composer を常時表示する。
2. plan-ready / queued / review-needed banner を追加する。
3. Artifact controls を右 Workbench header に残す。
4. `NightShift に追加` は plan-ready banner の primary action とする。
5. selected Session が変わっても、右側が Session の主作業面であることを維持する。

検証:

```bash
pnpm test run tests/thread-workspace-header.test.ts tests/thread-workspace-pending-indicator.test.tsx
pnpm lint
```

Exit:

- Chat と Prompt Composer が Queue / NightShift 操作で潰れない。

### Phase 3: NightShift admission と Queue state を統合する

Status: **implemented**

目的: Session を NightShift に入れる操作を、Queue Entry 作成と対応させる。

作業:

1. 既存の `implementation_queue_entries` 作成 API / service を確認し、NightShift admission が同じ経路を使うように整理する。
2. Session row と Workbench banner の両方から admission できるようにする。
3. admission 時に model routing summary を表示する。
4. queued Session は `Queued #n` として Session row に表示する。
5. Queue から外しても Session は残る。
6. 既存の専用 Queue screen / endpoint は互換のため残し、主導線だけを Email Workbench 側へ寄せる。

検証:

```bash
pnpm test run tests/routes.nightworkers-workbench.test.ts tests/services.nightworkers-service.test.ts
pnpm lint
```

Exit:

- NightShift admission が Queue Entry 作成と一致する。
- Queue membership が通常 Chat をブロックしない。

### Phase 4: 未レビュー完了タスクを Review needed として扱う

Status: **implemented as lightweight MVP**

目的: 夜間実行完了後、朝レビューの対象を明確にする。

作業:

1. completed / failed / needs_human などの terminal run から、review-needed に出す対象を derived state として定義する。
2. final report / diff / verification evidence を軽量 Decision support と review result の evidence として扱う。
3. Workbench に review-needed banner を出す。
4. Session row に `Review needed` と primary action `Review` を出す。
5. accept / request fix / requeue / archive の処理を整理する。
6. review result は既存 review-results service へ統合する。
7. request fix は初期実装では「優先再投入」として扱い、専用 workflow 化は後続に回す。

検証:

```bash
pnpm test run tests/services.review-results.test.ts tests/routes.nightworkers-workbench.test.ts
pnpm lint
```

Exit:

- 朝に見るべき completed run が Session list から分かる。
- review action 後の状態遷移が一貫している。

### Phase 5: フェーズ別 Model Routing の global defaults を追加する

Status: **deferred**

目的: 計画作成、夜間実装、テスト実装、最終レビューでモデルを使い分ける。

作業:

1. phase enum を定義する。
2. global model routing settings を追加する。
3. Settings UI に Model Routing を追加する。
4. LLM call 時に phase から provider/model を解決する。
5. llm-provider は provider 呼び出しに責務を限定し、routing 判断は別 service に置く。
6. usage record に phase / routingSource を保存する。
7. 既存の `ACTIVE_LLM_PROVIDER` / provider-specific model 設定は fallback として残す。

検証:

```bash
pnpm test run tests/services.supervisor-llm-provider.test.ts tests/services.llm-usage.test.ts
pnpm lint
pnpm typecheck
```

Exit:

- phase ごとに provider/model が解決される。
- usage evidence から phase と routing source が追える。

Deferred reason:

- provider/model 解決、Settings UI、usage evidence、prompt/workflow phase の責務境界を同時に変更するため、Email Workbench MVP とは別の設計単位として扱う。

### Phase 6: Session / Queue Entry override を追加する

Status: **deferred**

目的: global default を基本にしつつ、個別 Session / Queue Entry だけモデル設定を変えられるようにする。

作業:

1. Project override の要否を判断し、入れる場合は保存場所を決める。
2. Session override の保存場所を決める。
3. Queue Entry override の保存場所を決める。
4. Workbench header に model profile summary を出す。
5. NightShift admission dialog に resolved model routing を出す。
6. override 優先順位を test で固定する。

検証:

```bash
pnpm test run tests/services.llm-usage.test.ts tests/routes.nightworkers-workbench.test.ts
pnpm lint
pnpm typecheck
```

Exit:

- Queue Entry override > Session override > Project override > Global default > fallback が守られる。

Deferred reason:

- 保存先と migration 方針を決める必要があり、Model Routing global defaults の後に実装する方が安全。

### Phase 7: Attention 補助ビューを検討する

Status: **deferred**

目的: Project / Session 構造を壊さず、人間の目が必要なものを横断的に集める。

作業:

1. Attention item の対象を定義する。
2. Project / Session 参照を必須にする。
3. Review needed / Needs input / Failed / Plan ready but not queued を一覧できる read model を作る。
4. Rail に Attention を追加するか判断する。

検証:

```bash
pnpm test run tests/nightworkers.workbench-selectors.test.ts
pnpm lint
```

Exit:

- Attention が Project / Session 主構造を壊さない。

Deferred reason:

- Attention は便利だが、Project / Session 主構造を弱めるリスクがあるため、read model と遷移設計を別途固定してから入れる。

## 実装上の注意

- Queue state と Session state を同じ enum に潰さない。
- `implementation_queue_entries` は Queue source of truth として維持する。
- `tasks.status` は Session/planning 表示に使うが、Queue claim lock として扱わない。
- TodoList は Run 内部の milestone として扱う。
- model routing は prompt / workflow の phase に基づける。
- llm-provider に用途別判断を分散させない。
- fixed fallback prose で LLM output を隠さない。

## 完了条件

### MVP 完了条件

- Project / Session の親子関係が UI 上で維持されている。
- Session list が Email ライクに圧縮され、Queue state を表示できる。
- NightShift が Project 内 Session view / operation として扱われている。
- 右側 Workbench の Chat と Prompt Composer が常時維持されている。
- 未レビュー完了タスクが `review_needed` として朝レビュー対象になる。
- review action 後の Accept / Archive / 優先再投入が一貫して動く。
- contextStill 未接続を明示した Decision support UI がある。
- `pnpm lint` と対象 test が通る。

### Future phase 完了条件

- phase-based model routing の global default が定義されている。
- Session / Queue Entry override の優先順位が実装・検証されている。
- reviewChecklist または自動コードレビュー結果の永続化方針が、人間レビューを重くしない形で定義されている。
- Attention が Project / Session 主構造を壊さずに実装されている。
- contextStill decision advice と user feedback が連携されている。
