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
