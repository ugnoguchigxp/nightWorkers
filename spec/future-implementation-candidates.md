---
title: 後日検討用 実装候補メモ
targetKind: wiki
priorityGroup: backlog
status: memo
---

# 後日検討用 実装候補メモ

作成日: 2026-06-02

## 目的

この文書は、優先度付きの基盤実装計画 1-8 の外に置いた後続候補を、後日再考できるように残すためのメモである。

ここでは実装順を確定しない。詳細な実装計画も作らない。

目的は次の 3 つである。

1. 既存計画の後続候補を散らばらせず、一箇所に集める。
2. すぐに着手しないが、価値がありそうな拡張案を失わない。
3. 優先度 1-8 の実装完了後に、何を再評価すべきかを明確にする。

## 前提

優先度付きの基盤計画は以下を一旦のセットとする。

| Priority | 計画 |
| --- | --- |
| 1 | AgentRuntime Interface |
| 2 | RunEvent Taxonomy / JSONL Export |
| 3 | ToolPolicyGate |
| 4 | ReviewResult Schema / Outcome Evidence |
| 5 | Agent Outcome E2E Harness |
| 6 | JSONL Replay / Import Regression |
| 7 | Memory Feedback Long-Run Scenario |
| 8 | LLM Reviewer / Rubric Replay Evaluation |

この文書の候補は、上記の完了後または実装中に不足が見えた時点で再評価する。

## この文書でやらないこと

- 今すぐ priority 9 以降を確定しない。
- 詳細な実装ステップを作らない。
- API schema や DB migration を確定しない。
- 外部 package / plugin を採用する判断をしない。
- browser / computer-use / sandbox / external MCP を基盤未完成のまま拡大しない。

## 再考時の判断基準

後日この backlog から実装計画へ昇格する条件は次の通り。

- 優先度 1-8 の完了条件を直接支える。
- 単独で PR review 可能な粒度に切れる。
- 検証コマンド、期待結果、失敗時対応を明文化できる。
- run ledger / evidence / replay / review のどれかに接続できる。
- 追加しない場合に、実運用で明確な不便またはリスクが残る。

逆に、見た目の改善や便利機能だけなら、基盤実装が進むまで保留する。

## Tier A: 基盤完了後に優先度化しやすい候補

### Browser / Computer-Use Outcome Harness

目的:

- browser / desktop 操作を行う agent run でも、観測、操作、副作用、結果を ledger で説明できるようにする。

検討理由:

- Personal Manus 的な価値を出すには browser / computer-use が必要になる。
- ただし外部サイト、認証情報、フォーム送信、ダウンロードなど、coding tool より危険な副作用を持つ。

着手条件:

- ToolPolicyGate が実 tool execution に効いている。
- Agent Outcome E2E Harness が deterministic lane を持っている。
- RunEvent / JSONL replay で observation と action を分けて保存できる。

主な論点:

- `browser.observe` と `browser.action` の event contract。
- 操作対象 domain / URL / download / form submit の policy。
- screenshot / DOM snapshot / user-visible state の保存範囲。
- credential / PII を ledger に残さない redaction。
- provider credential なしの fixture replay。

### Sandbox Runtime E2E

目的:

- local guarded process の次段として、OS / container / remote isolation の境界を検証する。

検討理由:

- ToolPolicyGate は application-level policy であり、OS-level isolation とは別物。
- 将来的に危険な command、browser、external tools を扱うなら、sandbox boundary の E2E が必要になる。

着手条件:

- AgentRuntime interface が主経路になっている。
- ToolPolicyGate が tool execution 前後で event を残している。
- run outcome と policy violation の判定が安定している。

主な論点:

- Docker / local process / remote isolated worker のどれを最初に検証するか。
- file mount / network / environment / timeout / process kill の contract。
- sandbox failure を run failure と区別する event taxonomy。
- sandbox log と command output の redaction。

### Imported Run Ledger Viewer / Support Bundle Import

目的:

- exported JSONL や support bundle を取り込み、live DB なしでも run の原因調査や review ができるようにする。

検討理由:

- JSONL replay/import ができても、人間が確認できる viewer がないと運用価値が弱い。
- bug report、失敗 run 共有、外部 agent run の比較に使える。

着手条件:

- JSONL parse / replay / import が安定している。
- ReviewResult / ToolPolicyGate / memory feedback / reviewer events が replay で復元できる。

主な論点:

- import_snapshot と read-only viewer を分けるか。
- support bundle に含めるもの: JSONL、diff、config digest、redacted logs、screenshots。
- imported run を通常 run と UI 上でどう区別するか。
- secret / local path / user name の redaction。

### Repository-Specific Skill / Procedure Injection

目的:

- repository ごとの手順、規約、検証コマンド、危険操作ルールを agent run の context に安全に注入する。

検討理由:

- 個人利用の開発 agent は、repo ごとの癖を覚えないと毎回同じ探索を繰り返す。
- ただし任意コード実行 plugin に早く進むと安全境界が崩れる。

着手条件:

- Memory Feedback Long-Run で candidate / injection / effectiveness が追える。
- context compile snapshot に included source refs を保存できる。
- skill / procedure は safe data format として扱う方針が固定されている。

主な論点:

- Markdown subset の skill format。
- repository-local procedure と global memory の優先順位。
- stale procedure の検出。
- procedure が間違っていた時の review / feedback path。

### Repository-Local Rubric Definition

目的:

- built-in rubric だけでなく、repository 固有の品質基準で reviewer evaluation を実行できるようにする。

検討理由:

- 汎用 rubric では、repo 固有の migration、test、release、security、style の判断が弱い。
- ただし executable plugin にすると安全性が落ちる。

着手条件:

- LLM Reviewer / Rubric Replay Evaluation が built-in rubric で安定している。
- RubricDefinition schema が executable field を拒否できる。
- reviewer result が run status を直接変更しない。

主な論点:

- rubric file location。
- allowed schema と validation error UX。
- repository-local rubric と organization/global rubric の merge rule。
- rubric change による replay regression。

### PR Review Comment Export

目的:

- reviewer findings / human review / agent follow-ups を PR comment や patch review 形式へ export する。

検討理由:

- agent run の結果を local UI だけでなく、GitHub などの review workflow に接続したくなる。
- ただし最初から posting automation を入れると権限と失敗時 rollback が複雑になる。

着手条件:

- ReviewResult と reviewer evaluation が structured findings を持っている。
- changed file / line / evidence refs が安定している。
- 外部投稿は explicit action として扱える。

主な論点:

- export only から始めるか、GitHub API posting まで含めるか。
- file/line mapping の精度。
- duplicate comment 防止。
- draft comment と publish action の分離。

## Tier B: 価値は高いが、前提が多い候補

### Capability-Based External MCP Tool Model

目的:

- external MCP tool を無条件に解禁せず、capability と policy に基づいて安全に使えるようにする。

検討理由:

- external MCP は強力だが、tool 名、引数、side effect、credential access の境界が曖昧になりやすい。

着手条件:

- ToolPolicyGate が native tool で安定している。
- external tool の before / after event contract が定義できる。
- capability manifest を safe data として読める。

主な論点:

- tool capability manifest。
- allowed scopes。
- user approval が必要な action。
- ledger に残す引数の redaction。
- external tool failure の分類。

### LSP / Static Analysis Integration

目的:

- grep と file read だけでなく、symbol search、references、diagnostics、type errors を agent evidence として扱う。

検討理由:

- coding agent の探索品質を上げるには、言語サーバや static analysis が有効。
- ただし LSP は language / workspace / dependency state によって不安定になりやすい。

着手条件:

- worker tool contract が安定している。
- tool result と verification result の event schema が揃っている。

主な論点:

- language support の初期対象。
- LSP server lifecycle。
- diagnostics の ledger format。
- stale diagnostics と current workspace state の区別。

### Scheduled / Long-Running Agent Runs

目的:

- 定期的な dependency check、test repair、docs sync、issue triage などを agent run として管理する。

検討理由:

- personal Devin 的な価値は、明示依頼だけでなく継続的な保守にもある。

着手条件:

- run budget / cancellation / policy / review が安定している。
- memory feedback が次 run に効くことを検証できる。

主な論点:

- schedule state。
- overlapping run prevention。
- stale branch / dirty worktree handling。
- human review queue。
- failed scheduled run の notification。

### Multi-Run Campaign / Task Graph

目的:

- 大きな依頼を複数 run / task に分割し、依存関係と進捗を管理する。

検討理由:

- 単発 run だけでは、複数 PR 相当の変更や段階的 refactor を扱いにくい。

着手条件:

- task/run lifecycle と ReviewResult が安定している。
- follow-up generation が structured に保存されている。

主な論点:

- task graph schema。
- dependency blocked / ready の判定。
- shared context と per-run context の分離。
- campaign-level summary。

### Remote / Headless Runtime Adapter

目的:

- local native runtime 以外に、remote worker、headless CLI、外部 coding agent を同じ AgentRuntime contract で扱う。

検討理由:

- 長時間実行や重い検証は local process だけでは扱いにくい。
- ただし外部 runtime の session log を primary truth にすると control plane の価値が落ちる。

着手条件:

- AgentRuntime contract が主経路になっている。
- run ledger が runtime-independent に機能している。

主な論点:

- event ingestion。
- cancellation。
- artifact sync。
- remote workspace identity。
- external runtime の failure をどう分類するか。

## Tier C: 探索枠として残す候補

### Agent Cost / Usage / Latency Observability

目的:

- provider call、tool call、verification、reviewer evaluation の cost / latency / failure rate を見える化する。

検討理由:

- 個人利用では cost と時間の予測可能性が重要。

保留理由:

- 先に run ledger と event taxonomy が安定する必要がある。

### Run Failure Taxonomy Dashboard

目的:

- failed / blocked / needs_human / policy_violation / verification_failed などを横断して分類し、改善対象を見つける。

検討理由:

- agent 改善は、単発の失敗ログより failure pattern の集計が有効。

保留理由:

- outcome gate、review result、replay の実装後でないと分類がぶれる。

### Golden Task Suite

目的:

- 複数 repository にまたがる標準タスク集を作り、agent の regression を測る。

検討理由:

- provider / runtime / policy 変更の品質劣化を検出しやすい。

保留理由:

- deterministic harness と JSONL replay が先。

### Agent Instruction / Prompt Versioning

目的:

- supervisor prompt、tool instruction、rubric prompt、context compile strategy の version を run に保存する。

検討理由:

- agent behavior の差分を後から説明するには prompt version が必要。

保留理由:

- event schema と runtime boundary が安定してからでよい。

### Local Model / Offline Fallback Lane

目的:

- cloud provider なしで最低限の planning / review / summarization を行う fallback lane を検討する。

検討理由:

- 個人利用では cost、privacy、offline 作業の価値がある。

保留理由:

- quality と speed の制約が大きく、まず deterministic evaluator と replay を優先する。

## Personal Devin Capability Landscape

この節は、個人利用の Devin / Manus 的な体験を目指すうえで、後日どこかの候補へ吸収される可能性がある機能・概念・アルゴリズムを一覧化する。

Tier A-C と重複するものはここでは再掲しない。ここに置くものは、まだ実装候補として独立させるには早いが、設計時に見落とすと後から境界を作り直す可能性があるものに限定する。

### Core Autonomous Development Capabilities

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Goal decomposition | objective / acceptance criteria から task graph を生成する planner | 大きい依頼を複数 run に分ける | Multi-Run Campaign / Task Graph |
| Plan quality gate | 実行前に plan の危険度、検証可能性、依存関係を採点する | 無謀な run 開始を減らす | Agent Outcome E2E Harness |
| Progress state machine | planning / editing / verifying / blocked / reviewing などの状態を固定する | UI、ledger、retry 判断を安定させる | RunEvent Taxonomy |
| Explicit uncertainty tracking | agent が未確認前提、仮説、保留事項を ledger に残す | 推測による誤実装を減らす | ReviewResult / Memory Feedback |
| Stop condition library | missing tool call、repeated action、low confidence、dirty worktree などの停止条件を部品化する | runaway run と無意味な継続を減らす | Run Control Layer |
| Recovery policy | failed / blocked / timed_out から再開、縮小、human escalation を選ぶ | long-running task の継続性を上げる | JSONL Replay / Import Regression |
| Worktree ownership model | agent が触ってよい変更、user-owned dirty change、generated artifact を区別する | ユーザー変更の破壊を避ける | ToolPolicyGate / Sandbox Runtime |
| Change intent ledger | 各 file change がどの要求・検証・follow-up に対応するかを残す | review と rollback の精度を上げる | ReviewResult |
| Verification strategy selection | repo 状況から lint / typecheck / test / smoke / e2e の最小セットを選ぶ | 検証コストと信頼性のバランスを取る | Agent Outcome E2E Harness |
| Minimal patch discipline | 大きい diff を避け、目的に対して最小変更かを検査する | personal agent の暴走感を減らす | LLM Reviewer / Rubric Replay |

### Context And Memory Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Context budget allocator | system / task / repo memory / file evidence / recent events の token 配分を管理する | context が長くなるほど重要 | Memory Feedback Long-Run |
| Evidence freshness model | compile context、file snapshot、diagnostic がいつの状態かを記録する | stale evidence による誤判断を減らす | RunEvent / JSONL Replay |
| Source trust tiers | user instruction、repo file、memory、agent-generated summary、external web を優先度分けする | prompt injection と古い知識の混入を抑える | Repository-Specific Skill / Procedure Injection |
| Memory applicability classifier | 過去手順が今回の repo/task に本当に適用できるか判定する | 間違った procedure 注入を減らす | Memory Feedback Long-Run |
| Stale knowledge detector | procedure / rubric / repo notes が現行コードと矛盾しないか検出する | learned memory の腐敗を抑える | Repository-Specific Skill / Procedure Injection |
| Run-to-memory distillation policy | 何を candidate にし、何を ephemeral event に留めるかを決める | memory 汚染を避ける | Memory Feedback Long-Run |
| Retrieval audit view | context に入った memory が outcome に役立ったかを後で確認する | contextStill 連携の価値検証 | Memory Feedback Long-Run |
| Cross-run pattern mining | 失敗、policy block、review finding の反復パターンを抽出する | agent 改善点を見つける | Run Failure Taxonomy Dashboard |

### Planning And Search Algorithms

| アルゴリズム候補 | 用途 | 注意点 |
| --- | --- | --- |
| Hierarchical task decomposition | 大きい依頼を epic / task / run / tool step に分割する | 分割結果を user review なしに実行しすぎない |
| ReAct style loop with typed events | reason / act / observe を ledger に分けて残す | reasoning text を保存しすぎるとノイズと機密リスクが増える |
| Plan-and-execute with re-planning | 実行途中の観測で plan を更新する | plan drift を ReviewResult / RunEvent で追跡する必要がある |
| Tree-of-thought / branch evaluation | 複数実装案から低リスク案を選ぶ | token cost が高く、deterministic scoring が必要 |
| Monte Carlo style retry selection | 同じ失敗後の再試行方針を複数候補から選ぶ | provider cost と runaway 防止が課題 |
| Reflexion / self-critique | run 後に失敗原因と次回ルールを生成する | 自動 memory 登録は禁止し、人間承認を挟む |
| Case-based reasoning | 類似過去 run の成功手順を今回に適用する | applicability と freshness の検査が必須 |
| Constraint solving for policy | allowed paths / commands / approvals から実行可能 action を選ぶ | policy を迂回する代替案を選ばせない |
| Dynamic verification planning | diff と repo metadata から検証コマンドを選ぶ | 検証不足を hidden success にしない |
| Failure clustering | failed run を原因別にクラスタリングする | outcome taxonomy が安定してからでよい |

### Coding-Agent Tooling Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Semantic code map | file tree ではなく symbol / module / dependency map を作る | 探索効率を上げる | LSP / Static Analysis Integration |
| Impact analysis | 変更が触れる API、tests、routes、schemas、migrations を推定する | review と verification selection に効く | LSP / Static Analysis Integration |
| Patch provenance | patch hunk ごとに intent、source evidence、prompt を紐付ける | human review と rollback に効く | ReviewResult |
| Rollback plan artifact | run 開始前後の diff / touched files / revert option を保持する | agent 変更を安心して試せる | Support Bundle Import |
| Test gap detector | diff に対して不足する test / fixture / e2e を提案する | completed 判定の品質を上げる | LLM Reviewer / Rubric Replay |
| Dependency change classifier | dependency / lockfile 変更を risk class に分ける | supply-chain risk を見える化する | Supply-chain Hardening |
| Migration safety checker | DB migration、schema change、destructive operation を検出する | high-risk change の review を強める | Repository-Local Rubric Definition |
| Generated artifact hygiene | build output、temp file、debug log が diff に混ざらないよう検査する | dirty diff を減らす | ReviewResult |

### Human Control And Trust Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Approval budget | command、network、file write、external post に approval cost を付ける | personal use で過剰確認と危険操作のバランスを取る | ToolPolicyGate |
| Risk preview before run | run 開始前に想定副作用、必要権限、予想検証時間を表示する | ユーザーが任せる範囲を選びやすくする | AgentRuntime / ToolPolicyGate |
| Human interrupt semantics | stop、pause、abort、cancel、rollback、continue を区別する | 長時間runの制御性を上げる | AgentRuntime |
| Review queue | needs_review / needs_human / blocked を横断して処理する | scheduled run や campaign の運用に必要 | Scheduled / Long-Running Agent Runs |
| Explainable final report | final report が evidence refs を持つ | LLM最終回答の自己申告問題を減らす | ReviewResult |
| User preference model | 「小さく直す」「自動commitしない」などの個人方針を safe data として持つ | personal agent 化に効く | Repository-Specific Skill / Procedure Injection |
| Notification policy | いつ通知し、いつ黙って進めるかを決める | long-running operation の体験を整える | Scheduled / Long-Running Agent Runs |

### Runtime, Reliability, And Operations Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Run lease / heartbeat | runner が生きているか、どの process が所有しているかを記録する | stuck run の復旧 | Remote / Headless Runtime Adapter |
| Durable cancellation | process kill、tool abort、provider abort、ledger close を一貫させる | stop が信用できるようにする | AgentRuntime |
| Idempotent tool execution | retry してよい tool としてはいけない tool を区別する | network / external action の安全性 | ToolPolicyGate |
| Backpressure management | event streaming、large output、tool logs の詰まりを制御する | long run の安定性 | RunEvent Taxonomy |
| Artifact retention policy | logs、diff、screenshots、JSONL をいつ消すか決める | local-first storage の肥大化を防ぐ | Support Bundle Import |
| Secret redaction pipeline | command output、tool args、JSONL、support bundle を横断 redaction する | ledger/export の安全性 | RunEvent / JSONL Export |
| Health and doctor view | runner、DB、provider、contextStill、sandbox の状態を一覧化する | 運用時の切り分け | Run Failure Taxonomy Dashboard |
| Provider failover policy | primary provider failure 時の retry / fallback / stop を定義する | run の安定性 | LLM Provider Operations |
| Model capability registry | tool calling、structured output、context window、cost、reasoning 対応を管理する | provider/model選択の事故を減らす | LLM Provider Operations |

### Security And Supply-Chain Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Supply-chain hardening | exact pin、ignore scripts、lockfile diff approval、lifecycle allowlist | agent が依存を触る時の安全性 | Repository-Local Rubric Definition |
| Package install policy | npm / pip / cargo / brew などの install 操作を approval 対象にする | tool が環境を汚すのを防ぐ | ToolPolicyGate |
| Network egress policy | default deny、domain allowlist、download classification | browser/external tool導入時に必要 | Sandbox Runtime E2E |
| Credential access boundary | env、auth files、cloud tokens、browser session を capability で制限する | secret leakage 防止 | Capability-Based External MCP Tool Model |
| Prompt injection classifier | repo file / web page / issue text の instruction injection を検出する | external context 利用時に必要 | Browser / Computer-Use Outcome Harness |
| Untrusted content quarantine | downloaded file、web content、issue body を trusted code と分ける | agent が悪意ある指示に従うのを防ぐ | Browser / Computer-Use Outcome Harness |
| Policy regression suite | dangerous command、secret output、path escape を fixture 化する | security boundary の劣化検出 | Golden Task Suite |

### Product Workflow Concepts

| 領域 | 候補 | 何に効くか | 関連する既存候補 |
| --- | --- | --- | --- |
| Issue / task intake | GitHub issue、local note、manual prompt を統一 task にする | personal backlog の入口 | Scheduled / Long-Running Agent Runs |
| Branch / worktree orchestration | task ごとの branch / worktree / base ref を管理する | 複数runの衝突回避 | Multi-Run Campaign / Task Graph |
| Commit / PR draft mode | user approval 後に commit / PR draft を作る | Devinらしい完了導線 | PR Review Comment Export |
| Dependency maintenance lane | renovate 的な検出から修正・検証・review まで回す | 継続保守 | Scheduled / Long-Running Agent Runs |
| Test repair lane | failing test を検知し、原因分析と最小修正を提案する | personal CI assistant | Scheduled / Long-Running Agent Runs |
| Docs sync lane | code change に伴う docs / README / changelog 更新を検出する | 完了品質向上 | LLM Reviewer / Rubric Replay |
| Release readiness lane | version、build、test、publish dry-run、changelog を検査する | 個人OSS運用に効く | Repository-Local Rubric Definition |

### Candidate Promotion Notes

この節の候補を実装計画へ昇格する時は、次を先に確認する。

1. 既存 Tier A-C の候補に吸収できないか。
2. 優先度 1-8 のどの contract を前提にするか。
3. run ledger / JSONL / ReviewResult / memory feedback のどこに evidence を残すか。
4. deterministic test または replay fixture で検証できるか。
5. 任意コード実行、credential access、network access を要求するか。

上記を満たせない候補は、実装ではなく探索メモに留める。

## 後日再考時の進め方

1. 優先度 1-8 の完了状況を確認する。
2. この文書の Tier A から、現在の最大ボトルネックに近いものを 1 つ選ぶ。
3. 既存計画に吸収できるなら吸収し、独立 PR が必要なら新しい実装計画を作る。
4. 実装計画へ昇格する場合は、必ず次を含める。
   - non-goals
   - event / evidence contract
   - persistence / replay behavior
   - verification commands
   - degraded / failure behavior
5. 実装後に、この文書から該当候補を削除するか、完了済みとして移動する。

## 現時点の結論

今すぐ priority 9 以降を確定する必要はない。

まずは priority 1-8 を進める。

その後、最初に再考する候補は以下が妥当である。

1. Browser / Computer-Use Outcome Harness
2. Sandbox Runtime E2E
3. Imported Run Ledger Viewer / Support Bundle Import

ただしこれは暫定であり、実装中に最も痛い不足が別に見えた場合は、その不足を優先する。
