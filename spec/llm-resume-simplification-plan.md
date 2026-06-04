# LLM Resume Simplification Plan

## Purpose
NightWorkers の Supervisor 実行を、LLM の柔軟な再判断を残したまま、runtime loop と guard の複雑さを減らす。

現在の問題は、Round 1 の分類や worker tool の証拠解釈を runtime 側で補正しようとすると、`apply_patch` / `replace_content` 後に余計な確認や再試行が入り、完了できるタスクでも loop が続くことにある。

この計画では、Supervisor loop を「LLM decision を呼ぶ、tool を実行する、SessionMemory を更新する、stop なら Finalize Answer skill に渡す」だけに寄せる。作業判断は prompt / skill / SessionMemory の明示状態に置き、runtime 側の隠れた推論を減らす。

## User Orders Adopted
この計画は次のオーダーを前提にする。

- SystemContext は基本的に `api/services/supervisor/prompt.ts` に集約する。
- runtime loop や provider 側で prompt 断片を小出しに組み立て、用途別判断を分散させない。
- Tool、SessionMemory、routing、Finalize、stop の意味は、`prompt.ts` の SystemContext builder にまとめる。
- ループ終了判定ができない場合は、runtime の賢い推論ではなく、明示上限で止める。
- Round 1 は分類が主目的だが、Tool Capability Summary を使って必要 tool 候補を提案できる。

## Current Facts
- `workflow` は `general | evidence_review | code_change | research` の legacy 互換フィールドであり、細かい分類の本体ではない。
- 実際の分類軸は `routingHypothesis` の `phase / primaryMode / secondaryModes / workKinds / overlays / requiredEvidence / nextSkillFiles`。
- Round 1 は `routingHypothesis` の初期仮説を返すだけで、絶対視してはいけない。
- Round 2 は observations、tool result、todoPlan、SessionMemory を見て、毎回 `routingHypothesis` を更新できる必要がある。
- 必要があれば、1つのタスク内で複数 skill reference を読み、複数 worker tool を連続で実行してよい。
- `phase="stop"` は即ユーザー回答ではなく、必ず Finalize Answer skill に流すべきである。

## Terminology
この文書でいう LLM resume / 再起 は、process restart や thread resurrection ではない。1つの Supervisor run の中で、tool result と SessionMemory を渡して LLM decision を再度呼び出し、次の action を決め直すことを指す。

```text
LLM decision
  -> tool execution
  -> observations + SessionMemory update
  -> LLM decision again
```

この再起で重要なのは、Round 1 の初期仮説を固定しないことと、runtime が隠れた guard で判断を奪わないこと。

## Concept Mapping
ユーザー概念図の要素は、実装上は次のように扱う。

| Concept | Implementation |
| --- | --- |
| user Prompt | `latestUserMessage` と run prompt |
| round 1 pick Goal | 初回だけ呼ぶ routing hypothesis 作成 |
| job detector | Round 2 decision。SessionMemory と observations を見て phase / routing / skill / tools を再判断する |
| session Memory | Run 単位の explicit state。goal、routingHypothesis、evidence、changedFiles、verification、blockers を保持する |
| round 2 pick Skill | Round 2 system context と `skillRequests` による skill reference 選択 |
| edit_file skill | `primaryMode=code_edit` と code/edit tool guidance |
| finalize answer skill | `phase="stop"` 後に必ず呼ぶ専用 finalization LLM call |
| other skill | planning / review / investigation / runtime_debug / docs / git_release などの mode reference |
| tools | worker tool catalog。必要なら `toolCalls` で複数順次実行 |
| loop | runtime の薄い交通整理。LLM decision、state update、tool dispatch、Finalize 分岐だけを行う |

## Design Principles
### Keep Runtime Thin
Supervisor loop は決定的な交通整理だけを行う。

- LLM decision を呼ぶ。
- decision に含まれる state update を保存する。
- decision に tool calls があれば実行する。
- `phase="stop"` なら Finalize Answer skill を呼ぶ。
- tool failure、schema failure、budget 到達のような実行不能状態だけ runtime で止める。

Runtime は「証拠が足りるか」「編集済みだから完了か」「次に何を読むべきか」を独自に推論しない。

### Centralize SystemContext In prompt.ts
Supervisor の基本契約は `api/services/supervisor/prompt.ts` に集約する。loop、provider、dispatcher、skill registry は prompt 方針を小出しに持たない。

`prompt.ts` に置くべき builder:

```ts
buildRound1SystemPrompt()
buildRound2SystemPrompt()
buildFinalizeSystemPrompt()
buildToolCapabilitySummary()
buildToolContractSummary()
buildFullToolManual()
buildSessionMemoryContract()
buildRoutingContract()
buildFinalizeContract()
buildLoopBoundsContract()
```

Runtime 側に置いてよいもの:
- maxIterations などの上限値
- schema validation
- tool dispatch
- event persistence
- Finalize branch の呼び出し

Runtime 側に置かないもの:
- ユーザー文言による分類ルール
- 証拠十分性の判断
- code_edit / review / research などの workflow-specific prompt
- stop/report の意味の独自解釈

### Keep Round 2 Flexible
Round 2 は固定 router ではない。毎ラウンド、次を再評価する。

- goal はまだ同じか。
- phase は変わったか。
- primaryMode / secondaryModes は変わったか。
- workKinds / overlays は追加・削除すべきか。
- 追加 skill reference が必要か。
- 連続 tool 実行で済むか、Finalize に進むか。

### Make SessionMemory Explicit
SessionMemory は暗黙変数ではなく、LLM が読み書きできる明示状態にする。更新は run event に残し、後から「なぜ次の round がそうなったか」を追えるようにする。

### Stop Means Finalize
`phase="stop"` は「loop をその場で終える」ではなく、「最終回答を作る準備ができた」という decision として扱う。

```text
Round2 decision phase="stop"
  -> Finalize Answer skill をロード
  -> Finalize LLM call
  -> finalResponse / terminalState を保存
  -> run 終了
```

`phase="report"` は曖昧なので、新規設計では通常使わない。互換のため schema では受けても、runtime 内では `phase="stop"` 相当に正規化し、必ず Finalize Answer skill に流す。

### Split Tool Context By Round
Tool の利用方法は毎 round フルで入れ直さない。run 内で一度読めばよい詳細と、毎 round 必要な短い契約を分ける。

Round 1 は分類が主目的なので、詳細な tool manual ではなく capability summary を持つ。

- repo evidence: `read_file` / `search_files` / `inspect_structure`
- edit: `replace_content` / `apply_patch`
- verification: `run_command` / `run_verification`
- worktree evidence: `git_status` / `git_diff`
- external evidence: `search_web` / `fetch_content`
- external bridge: `mcp_call_tool`

Round 1 はこの tool map を使って、`routingHypothesis.requiredEvidence`、`nextSkillFiles`、`likelyTools` を提案する。ただし tool 実行はしない。

Round 2 は実行が主目的なので、実際に使える tool 名、toolCall schema、禁止事項、必要な詳細だけを持つ。各 tool の長い説明は初回または必要時だけ読み、毎 round は短い contract に圧縮する。

## Proposed Model
### Routing Axes
`workflow` は legacy 互換なので、SessionMemory には必ず `routingHypothesis` を本体として保存する。

現行候補:

```ts
type SupervisorWorkflow = 'general' | 'evidence_review' | 'code_change' | 'research';

type SupervisorPhase =
  | 'answer'
  | 'analyze'
  | 'plan'
  | 'execute'
  | 'review'
  | 'investigate'
  | 'verify'
  | 'summarize';

type SupervisorMode =
  | 'general_answer'
  | 'planning'
  | 'code_edit'
  | 'review'
  | 'investigation'
  | 'runtime_debug'
  | 'test_and_verification'
  | 'research'
  | 'docs'
  | 'git_release';

type SupervisorWorkKind =
  | 'code'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'config'
  | 'dependency'
  | 'data_migration'
  | 'blueprint'
  | 'ui_ux'
  | 'git'
  | 'release'
  | 'research';

type SupervisorOverlay =
  | 'evidence'
  | 'security'
  | 'performance'
  | 'incident'
  | 'destructive_operation'
  | 'production_risk'
  | 'user_facing_change'
  | 'external_research_required';
```

注意: decision JSON の `phase` は現在 `observe | plan | act | verify | report | stop` で、skill routing の `SupervisorPhase` とは別概念になっている。実装時は混同を避けるため、内部型では `decisionPhase` と `routingPhase` へ名前を分ける。JSON 互換のため外部 key は当面 `phase` のままでもよいが、prompt では必ず区別して説明する。

### SessionMemory
Run 単位で保持する軽量状態。

```ts
type SupervisorSessionMemory = {
  goal: {
    summary: string;
    source: 'round1' | 'round2' | 'user_update' | 'finalize';
    updatedAt: string;
  };
  phase: SupervisorPhase;
  routingHypothesis: SupervisorRoutingHypothesis;
  activeSkillFiles: string[];
  evidence: Array<{
    kind: 'file' | 'diff' | 'command' | 'web' | 'tool' | 'user';
    source: string;
    summary: string;
    toolName?: string;
    eventId?: string;
  }>;
  changedFiles: string[];
  verification: Array<{
    command?: string;
    ok: boolean;
    summary: string;
    eventId?: string;
  }>;
  blockers: Array<{
    reason: string;
    neededFromUser?: string;
  }>;
  loop: {
    iteration: number;
    lastDecisionPhase?: string;
    lastToolNames: string[];
  };
  toolContext: {
    fullManualLoaded: boolean;
    capabilitySummaryVersion: number;
    lastToolContractVersion: number;
  };
};
```

最初の実装では DB table を増やさず、`task_events` の `payloadJson.sessionMemory` と最新 snapshot の再構築で始める。必要になったら `task_run_session_memory` table を追加する。

### SessionMemory Tool
SessionMemory 更新は worker tool とは別の Supervisor 専用 tool として扱う。

```ts
type UpdateSessionMemoryArgs = {
  goal?: string;
  phase?: SupervisorPhase;
  routingHypothesis?: Partial<SupervisorRoutingHypothesis>;
  activeSkillFiles?: string[];
  evidence?: SupervisorSessionMemory['evidence'];
  changedFiles?: string[];
  verification?: SupervisorSessionMemory['verification'];
  blockers?: SupervisorSessionMemory['blockers'];
};
```

ただし v1 では本物の worker tool にせず、decision schema に `sessionMemoryUpdate` を追加して loop が保存する方が実装が軽い。

```ts
type SupervisorDecision = {
  phase: 'observe' | 'plan' | 'act' | 'verify' | 'report' | 'stop';
  workflow: 'general' | 'evidence_review' | 'code_change' | 'research';
  routingHypothesis: SupervisorRoutingHypothesis;
  likelyTools?: WorkerToolName[];
  sessionMemoryUpdate?: UpdateSessionMemoryArgs;
  skillRequests?: string[];
  toolCalls?: Array<{ name: WorkerToolName; arguments: object }>;
  toolCall?: { name: WorkerToolName; arguments: object } | null; // legacy single call
  finalResponse: string;
  terminalState?: SupervisorLoopResult['terminalState'];
};
```

`toolCall` は互換用に残し、内部では `toolCalls` に正規化する。

`likelyTools` は Round 1 / Round 2 の分類補助であり、tool 実行要求ではない。実行は必ず `toolCall` または `toolCalls` だけで表す。

内部正規化:

```ts
type NormalizedSupervisorDecision = {
  decisionPhase: 'observe' | 'plan' | 'act' | 'verify' | 'stop';
  routingPhase: SupervisorPhase;
  workflow: SupervisorWorkflow;
  routingHypothesis: SupervisorRoutingHypothesis;
  likelyTools: WorkerToolName[];
  sessionMemoryUpdate?: UpdateSessionMemoryArgs;
  toolCalls: Array<{ name: WorkerToolName; arguments: object }>;
  finalResponse: string;
  terminalState?: SupervisorLoopResult['terminalState'];
};
```

`report` は normalize 時に `decisionPhase='stop'` へ寄せる。これにより通常完了経路を Finalize だけに統一する。

### Tool Context Strategy
SystemContext の tool 情報は3層に分ける。

| Layer | When | Content | Purpose |
| --- | --- | --- | --- |
| Tool Capability Summary | Round 1 と必要時 | tool category、代表 tool 名、どの証拠・実行に向くか | 分類、requiredEvidence、likelyTools の提案 |
| Tool Contract Summary | 毎 Round 2 | available tool names、toolCall schema、禁止事項、observations 契約 | schema 崩れと存在しない tool 名を防ぐ |
| Full Tool Manual | run 初回または要求時 | 詳細説明、引数、使い分け、例 | 実行詳細が必要な場面だけ参照 |

毎 round 入れるべきなのは Full Tool Manual ではなく Tool Contract Summary。

Tool Contract Summary の最小内容:

```text
- toolCall.name は Tool catalog の worker tool 名だけを使う。
- `mcp__*`, `functions.*`, shell namespace を toolCall.name に入れない。
- worker tool の実行結果が observations に無い場合、実行済み・成功済み・失敗済みとして扱わない。
- toolCall は実行要求、likelyTools は分類上の候補であり、意味が違う。
- phase="stop" の場合は toolCall を返さず Finalize Answer skill に進む。
```

### Skill Loading
Round 2 system context には毎回すべての skill 本文や tool manual を入れない。代わりに固定ルール、短い tool contract、現在 snapshot を入れる。

毎ラウンド必ず入れるもの:
- Tool Contract Summary
- SessionMemory の意味と更新契約
- `phase="stop" -> Finalize Answer skill` の契約
- `workflow` は legacy 互換で、routing 本体は `routingHypothesis` であること
- 現在の SessionMemory snapshot
- 直近 observations

必要に応じて入れるもの:
- Full Tool Manual
- `activeSkillFiles`
- `routingHypothesis.nextSkillFiles`
- `skillRequests` で要求された追加 skill files

Round 2 は必要なら複数 skill reference を要求できる。runtime は allowlist 済み skill file だけをロードして、次 round の system context に追加する。

### Consecutive Tool Calls
LLM が複数 tool を連続で使う必要がある場合、1 decision に `toolCalls` を複数返せるようにする。

例:

```json
{
  "phase": "act",
  "toolCalls": [
    { "name": "read_file", "arguments": { "filePath": "src/a.ts" } },
    { "name": "search_files", "arguments": { "query": "createTaskRun" } }
  ]
}
```

Runtime は順番に実行し、各 result を observations と SessionMemory evidence に追加する。途中で失敗したら残りは実行せず `needs_human` へ進む。

最初の slice では `toolCalls.length <= 3` に制限する。大きい batch は観測不能な失敗を増やすため、後で必要になったら拡張する。

### Finalize Answer Skill
Finalize は通常の tool ではなく、専用 LLM call として扱う。

入力:
- latestUserMessage
- SessionMemory snapshot
- observations
- final decision
- changedFiles
- verification
- todoPlan / currentTodo

出力:

```ts
type FinalizeAnswerDecision = {
  finalResponse: string;
  terminalState: 'completed' | 'needs_review' | 'blocked' | 'failed' | 'needs_human';
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
};
```

Finalize の役割:
- ユーザー向け回答だけを作る。
- 内部 routing や skill 名を不要に説明しない。
- 証拠、変更ファイル、検証結果、残リスクを SessionMemory から要約する。
- code change の場合、編集成功後にレビュー待ちで止めるなら `needs_review` を返す。

## Simplified Runtime Algorithm
```text
load run/task
load or initialize SessionMemory
round1Decision = call Round 1 only if memory has no goal
  with Tool Capability Summary, not full tool manual
merge round1 routing into SessionMemory as initial hypothesis
store round1 likelyTools as planning hints

for iteration in 1..maxIterations:
  systemContext = base rules + Tool Contract Summary + SessionMemory contract + selected skill docs
  decision = call Round 2(systemContext, latestUserMessage, SessionMemory, observations)
  decision = normalize decision
    report -> stop
    phase -> decisionPhase
    routingHypothesis.phase -> routingPhase
    toolCall/toolCalls -> toolCalls

  persist decision event
  apply decision.sessionMemoryUpdate
  update SessionMemory.routingHypothesis from decision.routingHypothesis
  load requested skill files for next round if any

  if decision.decisionPhase == "stop":
    finalize = call Finalize Answer skill(SessionMemory, observations, decision)
    persist final report
    finish run

  normalizedToolCalls = decision.toolCalls ?? [decision.toolCall].filter(Boolean)

  if normalizedToolCalls is empty:
    finish needs_human with missing_tool_call

  for each toolCall in normalizedToolCalls:
    execute worker tool
    persist tool result event
    append observation
    update SessionMemory from tool result
    if tool failed:
      finish needs_human with tool_failure

finish needs_human with maxIterations
```

重要点:
- `apply_patch` / `replace_content` 成功を runtime が即 finalResponse にしない。
- 代わりに SessionMemory に `changedFiles` と edit evidence を入れる。
- 次の Round 2 で `phase="stop"` が返れば Finalize に進む。
- 当面の暴走対策として、edit tool 成功後に Round 2 が次 action を返せない場合だけ `phase=stop` 相当で Finalize に流す fallback を入れてよい。

### Loop Bounds
loop が終了判断を得られない場合は、runtime で賢い分類や証拠判断を追加せず、明示上限で止める。

推奨値:

```ts
const supervisorLoopDefaults = {
  maxIterations: 8,
  maxToolCalls: 20,
  maxToolCallsPerDecision: 3,
  maxConsecutiveNoProgress: 2,
  maxFinalizeAttempts: 1,
};
```

意味:
- `maxIterations=8`: Round 2 再起の上限。通常の code edit / investigation はこれ以内に収める。
- `maxToolCalls=20`: run 全体の worker tool 上限。探索が長引く場合は needs_human にする。
- `maxToolCallsPerDecision=3`: 1 decision 内の連続 tool 実行上限。
- `maxConsecutiveNoProgress=2`: 同じ decisionPhase / routing / no toolCall が続く場合の安全停止上限。
- `maxFinalizeAttempts=1`: Finalize は再試行しない。失敗したら fallback summary か needs_human。

no-progress は runtime guard ではなく暴走防止の停止条件として扱う。証拠十分性や次 action の推論には使わない。

## Implementation Slices
### Slice 0: Naming Clarification
目的: decision phase と routing phase の混同を止める。

変更候補:
- 型名だけ先に整理する。
  - existing `SupervisorDecision.phase` は `decisionPhase` と呼ぶ。
  - `routingHypothesis.phase` は `routingPhase` と呼ぶ。
- JSON 互換のため、外部 schema の key は当面 `phase` のままでもよい。
- prompt では明確に「decision phase」と「routing phase」を分けて説明する。
- `phase="report"` は互換入力として受けても、内部では `decisionPhase="stop"` に正規化する。

成功条件:
- 実装者が `phase="stop"` と `routingHypothesis.phase="summarize"` を混同しない。
- Finalize 分岐は decision phase だけを見る。
- 通常完了経路が Finalize に一本化される。

### Slice 1: Finalize Boundary
目的: `phase="stop"` を即終了ではなく Finalize Answer skill に流す。

変更候補:
- `api/services/supervisor/prompt.ts`
  - `phase="stop"` の意味を Finalize へ進む合図として明記する。
  - Round 2 の finalResponse 生成責務を弱める。
  - Round 1 には Tool Capability Summary を入れ、実行用の詳細 tool manual は入れない。
  - Round 2 には Tool Contract Summary を毎回入れる。
- `api/services/supervisor/supervisor-loop.ts`
  - stop/report branch を `requestFinalizeAnswer(...)` に置き換える。
  - 既存の `finalResponse` 直接採用を Finalize の fallback に限定する。
  - Finalize attempt は最大1回にする。
- `api/services/supervisor/llm-provider.ts`
  - Finalize 用 schema を追加する。
- `api/services/supervisor/skills/builtin/references/phases/summarize.md`
  - Finalize Answer skill の契約に合わせる。
- `tests/services.supervisor.test.ts`
  - `phase=stop` で Finalize call が必ず走ることを追加。

成功条件:
- `phase=stop` の decision だけでは run が終わらない。
- `phase=report` の decision も Finalize に流れる。
- Finalize response が `task_runs.finalReport` に保存される。
- code change は Finalize が `needs_review` を返せる。

### Slice 2: Prompt Centralization And SessionMemory Snapshot
目的: observations だけに依存せず、run の現在状態を明示する。

変更候補:
- `api/services/supervisor/prompt.ts`
  - SystemContext builder を集約する。
  - Tool Capability Summary / Tool Contract Summary / Full Tool Manual / SessionMemory Contract / Finalize Contract / Loop Bounds Contract を同ファイルに置く。
  - loop や provider に workflow-specific prompt を持たせない。
- `api/services/supervisor/session-memory.ts` を追加。
  - initialize / mergeDecision / mergeToolResult / compactForPrompt を実装。
- `supervisor-loop.ts`
  - local `toolObservations` に加えて `sessionMemory` を持つ。
  - decision event に snapshot digest を保存。
- `prompt.ts`
  - Round 2 input に `sessionMemory` を追加。
  - Round 1 output の `likelyTools` を分類ヒントとして SessionMemory に保存する。

成功条件:
- Supervisor の基本 SystemContext が `prompt.ts` から辿れる。
- loop に prompt 断片や workflow-specific prompt が増えない。
- Round 2 prompt に `goal / phase / routingHypothesis / evidence / changedFiles / verification` が入る。
- Round 1 の `likelyTools` は実行済み証拠ではなく planning hint として扱われる。
- edit tool success が `changedFiles` と evidence に記録される。
- Finalize は SessionMemory だけを見ても変更概要を書ける。

### Slice 3: Multi Skill Loading
目的: Round 2 が必要に応じて複数 skill reference を使えるようにする。

変更候補:
- decision schema に `skillRequests?: string[]` を追加。
- `resolveSupervisorSkillDocuments` に、現在 routing と `skillRequests` を合成する entrypoint を追加。
- `prompt.ts`
  - `activeSkillFiles` と `skillRequests` の契約を追加。

成功条件:
- Round 2 が `references/modes/code_edit.md` と `references/modes/test_and_verification.md` を同時に読める。
- allowlist 外 path は拒否される。
- skillRequests は次 round の context に反映される。

### Slice 4: Consecutive Tool Calls
目的: 単純な連続観測で LLM round を浪費しない。

変更候補:
- `llm-provider.ts`
  - `toolCalls` array を schema に追加。
  - legacy `toolCall` を `toolCalls` に正規化。
- `supervisor-loop.ts`
  - `executeToolCallsSequentially` を追加。
  - 1 decision あたり最大 3 calls に制限。
- tests
  - read_file + search_files の連続実行。
  - 途中 failure で後続 tool を実行しない。

成功条件:
- 複数 tool result が順番通り events / observations / SessionMemory に入る。
- 失敗時の停止理由が明確。

### Slice 5: Remove Edit-Success Immediate Stop
目的: 現在の暫定的な edit success 即 `needs_review` を、Finalize 境界へ移す。

変更候補:
- `supervisor-loop.ts`
  - `isEditTool(name) && toolResult.ok` の即終了 branch を削除。
  - edit result は SessionMemory に保存し、次 round へ進む。
  - 次 round が `phase=stop` なら Finalize。
- `code_edit.md`
  - 編集成功後は必要なら verify へ、十分なら stop へ進むと明記。

成功条件:
- edit success 後に無条件 loop 暴走しない。
- Round 2 が stop を返せば Finalize で終了。
- Round 2 が verify を返せば検証 tool を実行できる。

## Prompt Contract Updates
SystemContext に必ず入れる文言:

```text
workflow は legacy 互換フィールドです。分類の本体は routingHypothesis です。
Round 1 の routingHypothesis は初期仮説であり、Round 2 では observations と SessionMemory に基づいて更新できます。
Round 1 は Tool Capability Summary を使って requiredEvidence / nextSkillFiles / likelyTools を提案できます。ただし tool 実行はしません。
likelyTools は分類上の候補であり、toolCall / toolCalls とは違います。実行要求は toolCall / toolCalls だけで返してください。
Round 2 には Tool Contract Summary を毎回入れます。Full Tool Manual は run 初回または必要時だけ参照します。
SessionMemory は現在の run 状態です。decision で sessionMemoryUpdate を返すと runtime が保存します。
必要なら複数 skill reference を要求できます。要求は skillRequests に allowed relative path で返してください。
必要なら複数 worker tool を toolCalls に並べて返せます。ただし各 tool result を証拠として扱える粒度にしてください。
phase="stop" は最終回答を直接返す意味ではありません。必ず Finalize Answer skill に進む合図です。
phase="report" は互換目的で受けるだけです。内部では stop と同じく Finalize Answer skill に進みます。
phase="stop" 以外では terminalState を返さないでください。
終了判断ができない場合、runtime は明示上限で停止します。LLM は上限回避のために推測で完了扱いしてはいけません。
```

Round 1 input に必ず入れるもの:

```json
{
  "latestUserMessage": "...",
  "toolCapabilitySummary": {
    "repoEvidence": ["read_file", "search_files", "inspect_structure"],
    "edit": ["replace_content", "apply_patch"],
    "verification": ["run_command", "run_verification"],
    "worktreeEvidence": ["git_status", "git_diff"],
    "externalEvidence": ["search_web", "fetch_content"],
    "externalBridge": ["mcp_call_tool"]
  }
}
```

Round 2 input に必ず入れるもの:

```json
{
  "latestUserMessage": "...",
  "round1Decision": "...",
  "sessionMemory": "...",
  "toolContractSummary": "...",
  "todoPlan": [],
  "observations": []
}
```

## Rough Areas And Refinements
### Rough Area 1: SessionMemory を tool にするか schema field にするか
結論: v1 は `sessionMemoryUpdate` field にする。

理由:
- worker tool と同列にすると、tool catalog と dispatcher の責務が混ざる。
- 実体は Supervisor 内部状態であり、repo workspace を触る worker tool とは性質が違う。
- ただしログ上は tool 的に見えるよう、`supervisor.session_memory_updated` event を出す。

将来:
- UI から SessionMemory を検査・修正したくなったら repository-backed table と明示 API にする。

### Rough Area 2: Round 2 が複数 skill を読めると prompt が太る
結論: `activeSkillFiles` を SessionMemory に保持し、毎回全文 reload しない。

対策:
- root skill、router、現在 phase、primaryMode は優先して入れる。
- secondaryModes / workKinds / overlays は必要分だけ入れる。
- `skillRequests` で増やす場合も allowlist と最大数を設ける。
- 直近 round で使われていない skill は SessionMemory から外せる。

### Rough Area 2.5: Tool manual を毎 round 入れると prompt が太る
結論: Round 1 は Tool Capability Summary、Round 2 は Tool Contract Summary、詳細は Full Tool Manual として初回または必要時だけ入れる。

理由:
- Round 1 は分類が主目的なので、tool のカテゴリと用途がわかればよい。
- Round 2 は schema と禁止事項を忘れないことが重要で、長い説明は毎回不要。
- 引数詳細が必要なときだけ Full Tool Manual を追加すれば token を節約できる。

注意:
- Full Tool Manual を省略しても、available tool names と toolCall schema は毎 Round 2 に入れる。
- `likelyTools` は実行証拠ではないため、observations と混ぜない。

### Rough Area 3: 複数 toolCalls が危険
結論: v1 は最大 3 件、順次実行、失敗で即停止。

許可しやすい例:
- `read_file` を複数ファイルに対して実行する。
- `search_files` の後に関連ファイルを読む。
- `git_status` と `git_diff` を続けて確認する。

慎重に扱う例:
- 複数 edit tool の連続実行。
- edit 後に検証コマンドまで一気に実行。

v1 では edit tool を含む batch は edit tool で打ち切り、次 round に戻す方が安全。

### Rough Area 4: Finalize がまた推論を間違える
結論: Finalize は toolCall 不可、SessionMemory と observations の要約だけを許す。

Finalize に禁止すること:
- 新しい作業判断。
- 未実行 tool の主張。
- routing 再分類。
- 追加調査の開始。

Finalize が `needs_human` を返せる条件:
- SessionMemory に blocker がある。
- tool failure がある。
- ユーザー判断が必要な destructive / production risk がある。

### Rough Area 5: edit success 後の無限 loop
結論: edit tool result を SessionMemory に入れた後、Round 2 に明示的に「次は verify または stop」と指示する。

追加 fallback:
- edit success の次 round で toolCall なし、かつ phase が stop でない場合、missing_tool_call で人手停止せず Finalize に送る。
- これは runtime 推論ではなく、編集済み状態から空 decision が返った場合の停止安全弁として扱う。

### Rough Area 6: no-progress 判定がまた guard 化する
結論: no-progress は「停止上限」であり「次 action の判断」には使わない。

許可すること:
- 同じ `decisionPhase + routingHypothesis + toolCalls empty` が2回続いたら `needs_human`。
- edit evidence が SessionMemory にある状態で空 decision が返った場合、Finalize に送る。
- maxIterations / maxToolCalls 到達で止める。

禁止すること:
- no-progress 判定で read_file や verification を勝手に追加する。
- workflow ごとの完了条件を runtime に実装する。
- ユーザー文言の keyword / regex で分岐する。

## Tests
### Unit Tests
- SystemContext の主要 contract は `prompt.ts` builder から生成される。
- loop / provider に workflow-specific prompt 断片が増えていない。
- Round 1 routing は初期 SessionMemory に保存される。
- Round 1 は Tool Capability Summary から `likelyTools` を提案できるが、toolCall は返さない。
- `likelyTools` は observations に入らない。
- Round 2 routing が変わると SessionMemory が更新される。
- Round 2 には Tool Contract Summary が入り、Full Tool Manual は毎回入らない。
- `phase=stop` は Finalize Answer skill を必ず呼ぶ。
- `phase=report` は stop に正規化され、Finalize Answer skill を呼ぶ。
- Finalize が返した `terminalState` と `finalResponse` が保存される。
- Finalize は最大1回だけ試行される。
- `sessionMemoryUpdate` が event と snapshot に残る。
- `toolCalls` array が順次実行される。
- toolCalls の途中 failure で後続 tool が実行されない。
- skillRequests allowlist 外 path が拒否される。
- edit tool success は changedFiles/evidence に入る。
- maxIterations / maxToolCalls / maxToolCallsPerDecision / maxConsecutiveNoProgress の上限で停止できる。

### Integration Tests
- `fizzbuzz.ts` が既に存在する場合:
  - Round 2 が evidence を見て stop
  - Finalize が completed または needs_review を返す
  - missing_tool_call loop にならない
- 新規 `fizzbuzz.ts` 作成:
  - apply_patch success
  - SessionMemory.changedFiles に `fizzbuzz.ts`
  - 次 round で stop
  - Finalize で終了
- code review queued task:
  - edit
  - verify
  - stop
  - Finalize
  - Todo workflow の review/fix gate へ接続可能

## Migration Strategy
1. まず DB schema 追加なしで SessionMemory を run 内メモリと events に保存する。
2. Finalize 境界を入れる。
3. SystemContext builder を `prompt.ts` に集約する。
4. SessionMemory snapshot を prompt に入れる。
5. Round 1 Tool Capability Summary と Round 2 Tool Contract Summary を分離する。
6. Loop Bounds を既定値として導入する。
7. skillRequests を入れる。
8. toolCalls array を入れる。
9. 安定後に `task_run_session_memory` table を追加するか判断する。

## Open Questions
- SessionMemory snapshot を `task_events.payloadJson` だけに置く期間をどれくらい許容するか。
- Finalize Answer skill を phase `summarize` として実装するか、専用 `finalize` mode を追加するか。
- Full Tool Manual を run 初回にだけ入れるか、Round 2 が要求したときだけ入れるか。
- `maxConsecutiveNoProgress=2` が厳しすぎる場合に、queue 実行と通常 chat 実行で値を分けるか。
- edit tool を含む `toolCalls` batch を v1 で禁止するか、最後の1件に限って許可するか。
- Queue 実行時の Todo review/fix gate と Finalize の責務境界をどこで切るか。

## First Implementation Recommendation
最初の PR は Slice 0、Slice 1、Slice 2 のみを対象にする。

理由:
- decision phase と routing phase の命名を先に分けないと、`phase="stop"` の扱いがまた曖昧になる。
- `phase=stop -> Finalize` が入るだけで、完了報告の責務が明確になる。
- SystemContext を `prompt.ts` に集約すると、以後の実装で prompt 断片が runtime に散らない。
- SessionMemory snapshot が入ると、Round 2 が Round 1 の仮説に縛られず再判断できる。
- skillRequests と multi toolCalls は便利だが、同時に入れると失敗時の原因切り分けが難しくなる。

最初の PR のゴール:

```text
Round 1 creates initial routing hypothesis.
Round 1 can propose requiredEvidence, nextSkillFiles, and likelyTools from Tool Capability Summary.
Round 2 can update routing and SessionMemory.
Round 2 uses short Tool Contract Summary every round.
phase="stop" always calls Finalize Answer.
phase="report" normalizes to stop and calls Finalize Answer.
Finalize result is the only normal completion path.
Loop bounds stop undecidable runs without adding workflow-specific runtime guards.
```

この状態まで到達すれば、現在の「編集済みなのに loop する」「stop/report を runtime guard が邪魔する」「証拠判定が loop 内に散る」という問題はかなり減る。

## Feasibility Checklist
実装着手前に次を満たしていれば、最初の slice は十分現実的。

- DB migration なしで始められる。
- 既存 `task_events` に SessionMemory update event を追加するだけで監査できる。
- `workflow` enum は変更せず、legacy field として維持できる。
- `routingHypothesis` enum は現行 `skills/types.ts` の値をそのまま使える。
- SystemContext builder は `prompt.ts` に集約できる。
- Finalize は既存 `callSupervisorLLM` の別 schema call として追加できる。
- worker tool dispatcher は変更しない。
- Tool 情報は Round 1 capability summary、Round 2 short contract、必要時 full manual に分離できる。
- Loop Bounds は既定値の追加だけで始められる。
- 最初の PR では `skillRequests` と `toolCalls` をまだ入れないため、blast radius を抑えられる。
- 既存の薄い `supervisor-loop.ts` に、Finalize branch と SessionMemory merge を足すだけで始められる。
