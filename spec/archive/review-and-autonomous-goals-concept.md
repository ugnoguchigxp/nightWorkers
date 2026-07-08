# Review And Autonomous Goals Concept

## 目的
NightWorkers におけるレビュー機能と自律目標設定機能を、既存の run evidence、review rubrics、Supervisor、Implementation Queue、contextStill 連携の上に再定義する。

この文書は実装計画ではない。次にタスク分解と実装計画を作るためのコンセプト境界を固定する。

## 背景
NightWorkers は Project Folder を登録し、Workbench Session から task / run / artifact / queue / review evidence を扱う local-first control plane である。

現状でも次の基盤は存在する。

- `ReviewEvidencePack`
  - run status、diff、verification、policy、final report、selected events、既存 review result を集約する。
- review rubrics
  - deterministic evaluator、firewall、merger、built-in rubric を持つ。
- Supervisor skill references
  - review phase / review mode / evidence overlay など、レビュー向けの手続き文書を持つ。
- Implementation Queue
  - 明示的に queue へ入れた実装作業を processor が扱う。
- contextStill MCP
  - `context_compile`、`context_decision`、`register_candidate(s)`、`compile_eval` を持つ。

不足しているのは、新しい巨大な Review Engine ではない。既存の evidence と rubric を、実際に役立つレビュー判断、再発防止 knowledge、次の実装候補へつなぐ循環である。

## 再定義
### Review
Review は、run の結果を承認または否認するだけの UI 操作ではない。

NightWorkers における Review は、保存済み evidence に基づいて次を行う制御点である。

1. 完了主張が evidence と一致しているかを確認する。
2. 変更が壊した可能性のある箇所を、diff、verification、policy、run events から検出する。
3. 指摘を `ReviewFinding` として保存可能な形に正規化する。
4. 修正が必要な finding を、人間向け callout、agent follow-up、または後続 Goal candidate に分ける。
5. 再利用できる知見だけを contextStill に候補登録する。

Review は「LLM に感想を聞く」機能ではない。LLM は evidence pack を読む reviewer の 1 レーンであり、deterministic rubric、firewall、verification に従属する。

### Autonomous Goals
Autonomous Goals は、agent が勝手に作業を始める機能ではない。

NightWorkers における Autonomous Goals は、保存済み evidence から「次にやる価値がある作業候補」を提案し、人間の承認後に既存 Queue / Task / Run へ接続するための候補管理レーンである。

初期の Goal は、発見根拠を持つ必要がある。根拠のない改善案、一般的なベストプラクティス、LLM の思いつきは Goal にしない。

初期ソースは review finding に限定する。test failure、TODO marker、dependency update、Project Intelligence drift、contextStill landscape は後続候補とする。

## 設計原則
### 1. Evidence First
Review finding と Goal は必ず evidence ref を持つ。

許可される evidence は、run event、diff、changed file、verification、policy、artifact、final report、review result など、NightWorkers が保存または再取得できるものに限る。

### 2. NightWorkers Owns Side Effects
Project tree の探索、file read、grep、test、typecheck、command execution、diff 取得は NightWorkers の責務である。

contextStill は knowledge retrieval、判断補助、candidate registration、compile evaluation に使う。contextStill に Project Folder の実作業 side effect を持たせない。

### 3. contextStill Is Advisory And Durable Knowledge
contextStill は Review や Goal の source of truth ではない。

- source of truth: NightWorkers の task、run、event、artifact、review、queue、goal rows。
- durable knowledge: contextStill の rule / procedure / failure pattern candidate。
- advisory decision: contextStill の `context_decision`。

contextStill が `execute` を返しても、それだけで NightWorkers が自動実行してよいわけではない。

### 4. Human Approval Before Execution
Goal discovery は自動化してよい。

Goal execution は初期段階では必ず人間の承認を必要とする。特に code change、schema change、public API change、destructive operation、security-sensitive change は自動承認しない。

### 5. Review Findings Are Not Knowledge Yet
Review finding は短期の実行証拠であり、そのまま knowledge ではない。

contextStill に送るのは、再発防止として一般化できる failure pattern、guardrail、procedure、rule に限る。単発のファイル名、行番号、現在の branch だけに依存する指摘は NightWorkers の review result に留める。

### 6. Do Not Replace Existing Queue Semantics
Goal は Queue の代替ではない。

Goal は「なぜ次にやるべきか」を保持する候補であり、Queue は「承認済み作業をどの順で実行するか」を扱う実行レーンである。

## 対象範囲
### In Scope
- LLM reviewer を既存 review-rubrics pipeline に接続する。
- `ReviewEvidencePack` を、reviewer が具体的な finding を出せる程度に拡張する。
- LLM finding を firewall と evidence verification に通す。
- review perspective を rubric / prompt hints / evaluator configuration として扱う。
- review result から contextStill candidate を作る post-review distillation。
- review finding 由来の proposed goal を作る。
- proposed goal を人間が approve / reject / defer できる状態にする。
- approved goal を既存 Task / Implementation Queue に接続する。
- goal outcome を review evidence と contextStill feedback に戻す。

### Out Of Scope
- contextStill に file read / shell exec / Project Tree Oracle を追加する。
- NightWorkers 内に汎用 knowledge store を作る。
- 初期実装で Night Mode の自動運転を完成させる。
- 初期実装で dependency update、TODO marker、drift radar、knowledge gap 由来の goal discovery を全部入れる。
- Supervisor の Round 1 schema を最初から全面的に multi-axis routing へ置き換える。
- LLM reviewer の verdict だけで deterministic blocking finding を上書きする。
- Goal を人間承認なしに code change として実行する。

## Review 循環
初期の review 循環は次の形にする。

```text
task run completes or needs_review
  -> build ReviewEvidencePack
  -> deterministic rubric evaluation
  -> optional LLM reviewer
  -> reviewer firewall
  -> finding evidence verification
  -> merge deterministic + LLM findings
  -> persist ReviewResult
  -> distill durable lessons to contextStill candidates
  -> propose follow-up Goals from actionable findings
```

重要なのは、LLM reviewer を中心に置かないことである。中心にあるのは保存済み evidence と rubric であり、LLM は不足する観点を補う reviewer である。

## Goal 循環
初期の Goal 循環は review finding 由来に限定する。

```text
blocking or warning ReviewFinding
  -> check evidence is still resolvable
  -> convert to Proposed Goal
  -> human approve / reject / defer
  -> approved Goal creates or links Task
  -> Task enters Implementation Queue by explicit action
  -> run executes
  -> verification and review evaluate outcome
  -> successful or failed outcome feeds contextStill candidates
```

Goal discovery と Goal execution は別物として扱う。

## Review Perspective
Review perspective は、独立した Review Planner ではなく、既存 review-rubrics pipeline の設定として始める。

初期 perspective は次を候補にする。

- correctness
- regression
- security
- data_integrity
- architecture
- type_contract
- performance
- test_coverage

perspective は次の用途に使う。

- rubric criterion の選択。
- LLM reviewer prompt hints の追加。
- contextStill `context_compile` の `changeTypes` / `domains` / `technologies` hints。
- finding の分類。
- post-review distillation の saveAs 判断。

Supervisor の routing hypothesis に perspective を追加するのは後続でよい。初期は review-rubrics 内で閉じた方が変更範囲が小さい。

## contextStill 連携
初期連携は新 MCP tool を前提にしない。

まず使うもの:

- `context_compile`
  - reviewer prompt の前に、関連する guardrail、failure pattern、procedure を短く取得する。
- `register_candidate` / `register_candidates`
  - 再利用可能な finding だけを rule / procedure 候補として送る。
- `compile_eval`
  - review に使った context pack が役に立ったかを評価する。
- `context_decision`
  - Goal の実行可否判断の advisory input としてだけ使う。

後続で検討するもの:

- `context_compile` の review scope / perspective hints。
- review finding 専用の candidate registration helper。
- negative knowledge / intent tag の強化。

専用 `register_review_finding` を作るかどうかは、`register_candidate(s)` で不足する具体的な情報が見えてから決める。

## データの考え方
### ReviewResult
ReviewResult は run に対する評価結果である。

保持すべきもの:

- reviewer identity
- verdict
- findings
- humanCallouts
- agentFollowUps
- suggestedNextTasks
- evidenceRefs
- createdAt

ReviewResult は短期から中期の execution evidence であり、contextStill knowledge ではない。

### Goal
Goal は Project Folder に紐づく実行候補である。

保持すべきもの:

- title
- description
- acceptance criteria
- discovery source
- discovery evidence refs
- priority
- risk / complexity
- status
- approval state
- linked task / run / queue entry
- outcome evidence
- contextStill feedback state

Goal は Queue Entry ではない。Queue Entry は実行順と processor claim を扱う。

## UI コンセプト
### Review UI
Review UI は findings-first にする。

表示するもの:

- blocking / warning / info findings
- evidence refs
- reviewer status
- degraded reasons
- verification status
- agent follow-ups
- suggested next tasks
- candidate distillation status

Review UI は LLM の文章をそのまま大きく見せる場所ではない。finding と evidence を確認し、承認、差し戻し、Goal 化、candidate 登録の判断をする場所である。

### Proposed Goals UI
Proposed Goals UI は approval queue であり、実行 queue ではない。

表示するもの:

- goal title
- source finding
- evidence summary
- risk / complexity
- acceptance criteria
- suggested task shape
- contextStill advisory decision
- approve / reject / defer

初期 UI は Project Folder 単位でよい。Night Mode や cross-project dashboard は後続にする。

## 安全制約
- evidence が解決できない finding は Goal に変換しない。
- deterministic blocking finding は LLM approval で消さない。
- LLM reviewer の unknown evidence ref は warning または degraded として扱う。
- secrets や provider credentials を evidence pack や reviewer output に混ぜない。
- code change Goal は人間承認なしに queue へ入れない。
- destructive operation、schema migration、public API change、security-sensitive change は明示確認を必要とする。
- Goal が 3 回以上失敗した場合は自動再試行せず needs_human にする。
- contextStill の recommendation は advisory であり、NightWorkers の approval / queue state を上書きしない。

## 成功条件
このコンセプトの初期実装が成功している状態は次である。

1. completed または needs_review run から ReviewEvidencePack が作られる。
2. deterministic rubric と LLM reviewer の findings が同じ ReviewResult に統合される。
3. LLM finding は evidence ref と firewall を通らない限り blocking authority を持たない。
4. actionable finding から Proposed Goal が生成される。
5. Proposed Goal は人間が approve / reject / defer できる。
6. approved Goal は既存 Task / Queue へ明示的に接続できる。
7. run outcome は review evidence と contextStill candidate / compile_eval に戻せる。

## 実装計画へ進む前の分解軸
次の実装計画では、少なくとも以下の単位に分ける。

1. Review LLM Lane
   - LLM reviewer provider 接続。
   - prompt / JSON schema / firewall / degraded handling。
2. Evidence Pack Expansion
   - changed file excerpts、verification detail、grep/test evidence の追加。
3. Finding Verification
   - finding の evidence ref 解決、file/line 検証、unsupported ref の降格。
4. Review Persistence And UI
   - ReviewResult の保存、表示、degraded reasons、finding actions。
5. Post-Review Distillation
   - durable lesson だけを contextStill candidate に変換。
6. Proposed Goal Model
   - review finding 由来 goal の保存、status、approval。
7. Goal Approval To Queue
   - approved goal から Task / Queue Entry への接続。
8. Outcome Feedback Loop
   - goal outcome、review result、contextStill eval / candidate feedback の接続。

各単位は、DB migration、service、API、UI、tests を同じ PR に詰め込みすぎないようにさらに分ける。

## 非目標の再確認
この構想は「完全自律で勝手に開発する agent」を作るものではない。

NightWorkers が目指すのは、保存済み evidence を使って、レビュー、次の作業候補、承認済み実行、再発防止 knowledge をつなぐことである。

自律性は実行権限ではなく、発見と提案の質から始める。
