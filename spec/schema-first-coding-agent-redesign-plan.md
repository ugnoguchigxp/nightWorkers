# Schema First Coding Agent Redesign Plan

## Purpose
NightWorkers の coding agent 実行系を、LLM に優しい schema first の最小構造として設計し直す。

既存の問題は、簡単なタスクでも LLM が巨大な decision JSON、routing hypothesis、evidence、ledger、状態更新、finalize などを毎 round 扱い、出力と判断の責務が膨らみすぎていることにある。新設計では、LLM が出す JSON を常に最小化し、round ごとの出力責務を固定する。

この設計では、activity ledger、監査表示、evidence model、chat transcript 再構築は扱わない。まず coding agent の実行ループだけを極限まで単純にする。

## Core Principle
LLM に全体状態を編集させない。

- Tool schema は runtime が事前定義する。
- Skill schema は job type と 1 対 1 にする。
- Round 1 の LLM 出力は `jobType` だけにする。
- Round 2 の LLM 出力は `toolCall` だけにする。
- Finalize の LLM 出力は `message` だけにする。
- LLM は巨大な task JSON、全体 plan JSON、状態 object を毎回再生成しない。
- runtime が job state、tool result、loop state を保持する。
- LLM が変更できるものは、その round の schema に明示された最小 field だけにする。
- 実行判断は prompt と Skill に置く。provider / runtime のロジックへ用途別の細かい判断を分散しない。
- ユーザー文言を正規表現や keyword 判定で分類して処理を分けない。
- runtime guard は実装しない。runtime は JSON 抽出、schema validation、tool input validation、allowed tool validation、path boundary だけを担当し、task 完了可否を判定しない。
- LLM 本文が返っている場合、固定のエラーメッセージに差し替えない。
- JSON修復、JSON抽出、schema検証、最小限の互換正規化だけはロジック依存してよい。これは壊れた入力/出力の形を整えるためであり、task判断を代替するためではない。

## Non Goals
- activity ledger redesign
- evidence completeness framework
- supervisor routing hypothesis
- runtime memory object を LLM に更新させる設計
- 汎用 workflow JSON
- plan / act / verify / report などの多段 phase machine
- LLM に Todo 全体や task 全貌 JSON を毎回出させる設計
- 正規表現や keyword による user request 分類
- runtime/provider 側の用途別 SystemContext 分岐
- 固定文 fallback による LLM 応答の差し替え
- ロジックで「できた」「できない」「このjobTypeだ」と判断する実装

`chat rendering redesign` は初期 coding loop slice では扱わない。ただし schema first runtime を実用するには、保存済み activity をチャット欄で正しく観測できる最低限の表示整形が必要になる。

## Chat Activity Rendering Policy
保存は全量、主表示は最小にする。

- run event は activity event へ必ず追記する。表示の都合で保存対象から落とさない。
- `agentEventType` と、その event が持つ最小 payload を activity payload に残す。
- assistant の主本文には、人間向けの最終文だけを出す。
- legacy decision JSON が主本文に来た場合は、`finalResponse` を優先して表示し、なければ `message` / `instruction` / `rationale` の順に表示する。
- schema first の `finalize_answer` toolCall JSON が主本文に来た場合は、`arguments.message` だけを表示する。
- LLM raw output、Round 1 の `jobType`、Round 2 の `toolCall`、prompt、skill、tool result は activity block として表示する。
- activity block は短い label と要約を常に見せ、詳細 payload / raw JSON / prompt は折りたたみ内に置く。
- 巨大 JSON を主本文に直出ししない。ただし raw JSON 自体は破棄せず、詳細ログとして開ける状態にする。
- 監査ビューと通常ビューは当面分けない。非表示にしたいものは後続で filter する。

代表的な表示 label:

| agentEventType | label | detail |
| --- | --- | --- |
| `run.started` | Run started | 実行開始 |
| `round1.prompt_built` | Round 1 prompt | Round 1 prompt |
| `model.request_started` | LLM request | provider request |
| `model.response_finished` | LLM raw output | LLM raw JSON/text |
| `round1.parsed` | Round 1 jobType | `{ jobType }` |
| `skill.loaded` | Skill loaded | skill path/content |
| `round2.prompt_built` | Round 2 prompt | Round 2 prompt |
| `round2.parsed` | Round 2 toolCall | `{ toolCall }` |
| `tool.started` | Tool started | tool name/arguments |
| `tool.finished` | Tool result | compact tool result |
| `tool.validation_failed` | Tool validation failed | validation issues |
| `finalize.received` | Final answer | `message` |
| `run.completed` | Run completed | terminal state |

## Definitions
### Job Type
仕事の種類。必ず Skill と 1 対 1 に対応する。

例:

```ts
type JobType =
  | 'general_answer'
  | 'planning'
  | 'minor_code_edit'
  | 'major_code_edit'
  | 'script_code_edit'
  | 'review'
  | 'investigation'
  | 'runtime_debug'
  | 'test_and_verification'
  | 'research'
  | 'docs'
  | 'git_release'
  | 'code'
  | 'refactor'
  | 'test'
  | 'config'
  | 'dependency'
  | 'data_migration'
  | 'blueprint'
  | 'ui_ux'
  | 'git'
  | 'release';
```

`jobType` は分類であり、実行判断ではない。Round 1 ではこれだけを選ぶ。

JobType は flat enum にする。Skill も同一フォルダに flat 配置する。`mode` / `work_kind` / `phase` / `overlay` のような分類軸は削除し、LLM に選ばせる値と Skill file を 1 対 1 にする。

同義の Skill は統合する。例えば既存の mode docs と work kind docs は `docs` に統合し、既存の mode research と work kind research は `research` に統合する。

## Target Job Type Coverage
Round 1 が選べる job type は、coding agent が担う仕事の種類を flat に網羅する。

この一覧は旧実装の分類軸を移植するためのものではない。新 runtime が最初から読む job type と Skill file の契約である。旧 supervisor の reference、routing、phase、overlay、workflow は互換対象でも廃止対象でもなく削除対象として扱う。

| JobType | Skill File |
| --- | --- |
| `general_answer` | `skills/general_answer.md` |
| `planning` | `skills/planning.md` |
| `minor_code_edit` | `skills/minor_code_edit.md` |
| `major_code_edit` | `skills/major_code_edit.md` |
| `script_code_edit` | `skills/script_code_edit.md` |
| `review` | `skills/review.md` |
| `investigation` | `skills/investigation.md` |
| `runtime_debug` | `skills/runtime_debug.md` |
| `test_and_verification` | `skills/test_and_verification.md` |
| `research` | `skills/research.md` |
| `docs` | `skills/docs.md` |
| `git_release` | `skills/git_release.md` |
| `code` | `skills/code.md` |
| `refactor` | `skills/refactor.md` |
| `test` | `skills/test.md` |
| `config` | `skills/config.md` |
| `dependency` | `skills/dependency.md` |
| `data_migration` | `skills/data_migration.md` |
| `blueprint` | `skills/blueprint.md` |
| `ui_ux` | `skills/ui_ux.md` |
| `git` | `skills/git.md` |
| `release` | `skills/release.md` |

Skill file は新規に書く。旧 reference markdown を機械的に移植しない。必要な制約がある場合も、各 job type の最小手順として再定義する。

### Code Edit Job Types
code edit は 3 種類に分ける。Round 1 はユーザー依頼に最も近い 1 つだけを選ぶ。

#### minor_code_edit
小さい変更タスクに使う。

Use when:

- ちょっとした修正
- 小さい新規作成
- 単一ファイルまたは少数ファイルの明確な変更
- TodoList に分解するほどではない変更

Runtime expectation:

- 必要最小限の確認をする。
- 変更を適用する。
- 必要最小限の verify をする。
- 完了したら `finalize_answer` を呼ぶ。

#### major_code_edit
複数ステップの変更に使う。

初期実装では扱わない。まず `minor_code_edit` の単純タスク成功率を優先する。`major_code_edit` は job type と Skill file の名前だけ定義し、runtime behavior は後続 slice で実装する。

Use when:

- 変更が複数の独立した作業に分かれる
- 1 回の `minor_code_edit` で終えると context が膨らむ
- 実装、検証、修正が複数単位に分かれる
- TodoList に分解して順番に進めるべき変更

後続設計メモ:

- まず TodoList を作る。
- 各 Todo を小さい単位にする。
- 各 Todo は `minor_code_edit` として実行する。
- `major_code_edit` 自体は大きな編集を直接抱え込まない。
- Todo が残っている間は次の `minor_code_edit` へ移る。
- 全 Todo が完了したら必要に応じて `test_and_verification` へ移り、最後に `finalize_answer` を呼ぶ。

#### script_code_edit
調査や確認のための一時スクリプトに使う。

初期実装では扱わない。まず `minor_code_edit` の単純タスク成功率を優先する。`script_code_edit` は job type と Skill file の名前だけ定義し、runtime behavior は後続 slice で実装する。

Use when:

- 調査用の一時スクリプトを書く
- データ確認、再現、変換、検証のために短いコードを反復編集する
- 欲しい結果が得られるまでスクリプトを修正して実行する

後続設計メモ:

- 一時スクリプトとして作成する。
- 結果が得られるまで編集と実行を反復してよい。
- 目的の結果を compact tool result として保持する。
- 結果が得られたら一時スクリプトを削除する。
- 削除後に必要なら元タスクの job type へ戻る。
- 一時スクリプトを成果物として残さない。ただしユーザーが明示的に保存を求めた場合は `minor_code_edit` に切り替えて通常ファイルとして扱う。

### Skill
job type ごとの実行手順。Round 2 でのみ読み込まれる。

Skill は次だけを定義する。

- この job type で使える tool
- tool を使う順序の原則
- 完了条件
- 次 job type へ移る条件
- 禁止事項

Skill は LLM に「状態全体を出せ」と要求してはいけない。必要な場合でも `toolCall` の選び方だけを指示する。
Skill と prompt の文言は日本語を維持する。確認しづらい英語の運用ルールへ置き換えない。

### Logic Boundary
この redesign でロジックが担当してよいことは狭い。

Allowed:

- provider 呼び出し
- JSON 抽出
- JSON repair package 等による構文修復
- schema validation
- tool input schema validation
- unknown tool rejection
- allowed tool list enforcement
- repository path boundary
- repeated invalid output limit
- LLM が返した `jobType` と Skill file の対応解決
- LLM が返した `toolCall` の実行

Not allowed:

- user text の keyword / regex 分類で `jobType` を決める
- runtime が「この依頼はコード変更だから minor_code_edit / major_code_edit」と推測して上書きする
- tool result の意味をロジックで解釈して次 tool を決める
- LLM の代わりに runtime が completion / failure を自然言語判断する
- LLM から本文が返っているのに固定のエラー文へ差し替える
- provider 層に job type 別の SystemContext や実行判断を分散する

Tool result の成功/失敗の機械的判定は runtime が行ってよい。ただし「その結果で次に何をするか」は、Skill prompt を読んだ LLM が次の `toolCall` として決める。

### Tool
runtime が提供する実行関数。各 tool は個別 schema を持つ。

例:

```ts
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};
```

LLM が返せる tool call は、この schema に一致するものだけ。
Tool output schema は LLM prompt に渡さない。tool の戻り値は runtime が受け取り、次 Round 2 に渡す短い tool result summary を作る。runtime は tool result の意味から task 完了可否を判断しない。

### Runtime State
LLM ではなく runtime が保持する状態。

```ts
type AgentRuntimeState = {
  taskId: string;
  userRequest: string;
  currentJobType: JobType | null;
  toolResults: ToolResult[];
  completedJobTypes: JobType[];
  loopCount: number;
  status: 'running' | 'needs_human' | 'completed' | 'failed';
};
```

この state を LLM に丸ごと出させない。prompt に渡す場合も、必要な summary だけを runtime が作る。

## Round Model
### Round 1: Job Type Selection
目的: ユーザー依頼に対して最初の job type だけを選ぶ。

Prompt input:

- user request
- job type 一覧
- 各 job type の短い説明
- tool 一覧
- tool の短い説明
- tool input schema

Round 1 output schema:

```json
{
    "jobType": "minor_code_edit"
}
```

Rules:

- 出力は `jobType` だけ。
- rationale、confidence、requiredEvidence、toolCall、plan は出さない。
- Round 1 で skill document は読まない。
- Round 1 で tool 実行はしない。
- job type が不明なら `general_answer` ではなく、最も近い実行 job type を選ぶ。どうしても実行不能なら `general_answer`。

### Round 2: Skill-Guided Tool Call
目的: 選ばれた job type の Skill を読み込み、次に実行する tool call だけを決める。

Prompt input:

- user request
- current job type
- corresponding skill
- available tool schemas for this job type
- compact tool result summary
- last tool result, if any

Round 2 output schema:

```json
{
  "toolCall": {
    "name": "read_file",
    "arguments": {
      "path": "src/example.ts"
    }
  }
}
```

または、別 job type に移る必要がある場合:

```json
{
  "toolCall": {
    "name": "select_job_type",
    "arguments": {
      "jobType": "test_and_verification"
    }
  }
}
```

または、task が完了した場合:

```json
{
  "toolCall": {
    "name": "finalize_answer",
    "arguments": {
      "message": "実装を完了しました。"
    }
  }
}
```

Rules:

- Round 2 の出力は `toolCall` だけ。
- `phase`、`workflow`、`routingHypothesis`、`finalResponse`、`expectedEvidence` は出さない。
- tool result を見て次 tool を選ぶ。
- Skill の完了条件を満たしたら `finalize_answer` を呼ぶ。
- 別の仕事が必要なら `select_job_type` を呼ぶ。
- `select_job_type` 後、runtime は対応 Skill を読み込み、Round 2 を継続する。

## Built-In Meta Tools
通常 tool と同じ schema first として扱うが、runtime 内部で処理する。

### select_job_type
次の job type に切り替える。

```json
{
  "name": "select_job_type",
  "inputSchema": {
    "type": "object",
    "required": ["jobType"],
    "properties": {
      "jobType": { "type": "string" },
      "context": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

Runtime behavior:

- `currentJobType` を更新する。
- `context` があれば次 job type の scoped user request として扱う。
- 対応 Skill を読み込む。
- tool result summary に job switch を追加する。
- Round 2 を続行する。

### finalize_answer
ユーザーへの最終回答を確定する。

```json
{
  "name": "finalize_answer",
  "inputSchema": {
    "type": "object",
    "required": ["message"],
    "properties": {
      "message": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

Runtime behavior:

- `message` を最終回答として保存する。
- run status を `completed` にする。
- 以降の LLM round は呼ばない。
- `message` は LLM が `finalize_answer` toolCall で返した文字列だけを使う。runtime が固定の成功/失敗文を生成して置き換えない。

## Example: Create `fizzbuzz.ts`
User:

```text
fizzbuzz.tsをプロジェクトルートに作って
```

Round 1 output:

```json
{ "jobType": "minor_code_edit" }
```

Runtime:

- `minor_code_edit` Skill を読み込む。
- `read_file`, `list_dir`, `apply_patch`, `run_command` などの schema を提示する。

Round 2 output:

```json
{
  "toolCall": {
    "name": "list_dir",
    "arguments": {
      "path": "."
    }
  }
}
```

Tool result:

```json
{
  "entries": ["package.json", "src", "tests"]
}
```

Round 2 output:

```json
{
  "toolCall": {
    "name": "apply_patch",
    "arguments": {
      "patch": "*** Begin Patch\n*** Add File: fizzbuzz.ts\n+...\n*** End Patch\n"
    }
  }
}
```

Tool result:

```json
{
  "ok": true,
  "changedFiles": ["fizzbuzz.ts"]
}
```

Round 2 output:

```json
{
  "toolCall": {
    "name": "read_file",
    "arguments": {
      "path": "fizzbuzz.ts"
    }
  }
}
```

Tool result:

```json
{
  "path": "fizzbuzz.ts",
  "content": "..."
}
```

Round 2 output:

```json
{
  "toolCall": {
    "name": "finalize_answer",
    "arguments": {
      "message": "プロジェクトルートに `fizzbuzz.ts` を作成しました。"
    }
  }
}
```

この程度のタスクなら、Round 1 + Round 2 数回で終わる。巨大な decision JSON、Round 3 finalize、ledger rendering、evidence table は不要。

## Skill Contract
Skill は markdown でよいが、LLM に要求する出力 schema は変えない。

```md
# minor_code_edit

## Use When
ファイル作成、既存コード変更、軽微な実装修正。

## Tools
- list_dir
- read_file
- apply_patch
- replace_content
- run_command
- select_job_type
- finalize_answer

## Procedure
1. 必要最小限のファイル状態を確認する。
2. 新規作成なら apply_patch を使う。
3. 既存ファイルの単純置換なら replace_content を使う。
4. 必要なら read_file または run_command で結果を確認する。
5. 完了したら finalize_answer を呼ぶ。

## Completion
- requested file change is applied
- minimal confirmation is done
- parent Todo がある場合、その Todo の範囲だけが完了している

## Switch Job Type
- verification が必要なら select_job_type({ jobType: "test_and_verification" })
- review が必要なら select_job_type({ jobType: "review" })
- 変更が複数 Todo に分かれるなら select_job_type({ jobType: "major_code_edit" })
- 調査用の一時スクリプトが必要なら select_job_type({ jobType: "script_code_edit" })

## Output
Always return only:
{ "toolCall": { "name": "...", "arguments": { ... } } }
```

`major_code_edit` と `script_code_edit` の Skill contract は初期実装では作らない。名前と用途だけを残し、単純タスクが安定してから別 slice で定義する。

## Tool Schema Registry
Tool schema はコード上で registry として持つ。

```ts
type ToolRegistry = Record<string, ToolDefinition>;

const toolRegistry = {
  list_dir: {
    name: 'list_dir',
    description: 'List files under a repository-relative directory.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' }
      },
      additionalProperties: false
    },
  }
};
```

Runtime は job type に対応する Skill から許可 tool list を読み、registry から schema を取り出して prompt に入れる。

## Runtime Loop
```ts
async function runAgent(userRequest: string) {
  const job = await callRound1JobTypeSelector(userRequest);
  let currentJobType = job.jobType;
  const results: ToolResult[] = [];

  for (let i = 0; i < MAX_TOOL_STEPS; i += 1) {
    const skill = loadSkill(currentJobType);
    const allowedTools = resolveToolsForSkill(skill);
    const toolCall = await callRound2ToolSelector({
      userRequest,
      currentJobType,
      skill,
      allowedTools,
      toolResults: compactToolResults(results)
    });

    if (toolCall.name === 'select_job_type') {
      currentJobType = toolCall.arguments.jobType;
      results.push(recordJobSwitch(currentJobType, toolCall.arguments.context));
      continue;
    }

    if (toolCall.name === 'finalize_answer') {
      return complete(toolCall.arguments.message);
    }

    const result = await executeTool(toolCall);
    results.push(result);
  }

  return needsHuman('Tool step limit reached before finalize_answer.');
}
```

## Failure Rules
Failure handlingも schema first にする。

- Tool schema validation failure:
  - runtime は tool を実行しない。
  - validation error を tool result summary として追加する。
  - Round 2 を同じ job type で再実行する。
- Unknown tool:
  - runtime は tool を実行しない。
  - allowed tool list を再提示して Round 2 を再実行する。
- Repeated invalid output:
  - 2回連続で schema invalid なら `needs_human`。
  - その場合も、LLM raw output があれば保存・表示対象にし、固定の「LLMが失敗しました」文へ置換しない。
- Tool execution failure:
  - failure result を Round 2 に渡す。
  - LLM は同じ schema で次 toolCall を返す。
- Tool output handling:
  - LLM に output schema を渡さない。
  - 次 Round 2 には compact summary だけを渡す。
  - runtime は tool output の意味から task 完了可否を判定しない。

## Runtime Boundaries
mechanical guard は実装しない。ただし、runtime は実行境界として以下だけを持つ。

- max tool steps
- allowed tools per job type
- tool input schema validation
- repository path boundary
- repeated invalid output limit

これらは task 完了可否を判断しない。`finalize_answer` が返ったら、その message を最終回答として扱う。

## Event Measurement
全イベントを runtime が計測する。これは LLM に ledger JSON を出させる設計ではない。runtime が発生した事実を append-only event として保存する。

計測原則:

- LLM output、tool call、tool result、validation failure、job switch、finalize、step limit などをすべて保存する。
- raw event は欠落させない。
- raw event の保存数は 20 step 制限の対象にしない。
- 20 step 制限は単純タスクの LLM/tool loop activity の上限として測る。
- 表示用の集約や filtering は保存後に行う。
- LLM に event object を生成させない。
- LLM に event state を更新させない。
- event 保存失敗で LLM output を固定文へ置換しない。

最小 event schema:

```ts
type AgentEvent = {
  id: string;
  runId: string;
  seq: number;
  timestamp: string;
  type: AgentEventType;
  actor: 'runtime' | 'llm' | 'tool';
  jobType?: JobType;
  step: number;
  payload: unknown;
};
```

Event types:

- `run.started`
- `round1.prompt_built`
- `round1.llm_requested`
- `round1.llm_raw_output`
- `round1.parsed`
- `round1.invalid`
- `skill.loaded`
- `round2.prompt_built`
- `round2.llm_requested`
- `round2.llm_raw_output`
- `round2.parsed`
- `round2.invalid`
- `tool.validation_failed`
- `tool.started`
- `tool.finished`
- `tool.failed`
- `job.switched`
- `finalize.received`
- `run.completed`
- `run.needs_human`
- `run.failed`

Definition of Done:

- 1 run のすべての event が `runId + seq` で順序復元できる。
- LLM raw output が parse 失敗時も保存される。
- tool input と tool result が保存される。
- final answer は `finalize.received` と `run.completed` で復元できる。
- UI は raw event を全部表示できる。
- 非表示や集約は後続 filter の責務であり、保存時点では捨てない。

## Prompt Shape
### Round 1 Prompt
```text
You must select exactly one jobType.
Return JSON only.

Available job types:
- minor_code_edit: ...
- major_code_edit: ...
- script_code_edit: ...
- review: ...
- blueprint: ...

Available tools:
- list_dir: ...
- read_file: ...
- apply_patch: ...

Tool schemas:
...

User request:
...

Output schema:
{ "jobType": "<job type>" }
```

### Round 2 Prompt
```text
You are executing jobType=<currentJobType>.
Return exactly one toolCall.
Do not return rationale, plan, phase, workflow, finalResponse, or evidence.

Skill:
...

Allowed tools and schemas:
...

User request:
...

Recent tool results:
...

Output schema:
{ "toolCall": { "name": "<tool>", "arguments": { ... } } }
```

## Acceptance Criteria
- Round 1 response schema has only `jobType`.
- Round 2 response schema has only `toolCall`.
- Final user message comes only from `finalize_answer.arguments.message`.
- No round requires full decision JSON.
- No round requires LLM to update runtime state object.
- Simple file creation can complete without Round 3.
- Simple file creation must complete in 20 or fewer visible activity steps in the fixture.
- Tool schemas are defined outside prompt text and reused from registry.
- Tool schema means input schema only; output schema is runtime-owned and not prompted.
- Skill controls procedure, but does not change output schema.
- Job switch is represented as `select_job_type` toolCall, not as global state JSON.
- Invalid schema output is handled by runtime retry, not by rendering invalid prose as final answer.
- Runtime/provider logic does not classify user requests by regex or keywords.
- Runtime/provider logic does not replace LLM text with fixed fallback prose except when the LLM is unreachable and no LLM text exists.
- JSON repair/extraction/schema validation is allowed only to handle malformed IO shape.

## Greenfield Implementation Plan
この計画は旧 supervisor を参考実装として読まない。新しい coding agent runtime を小さく作り、動作確認後に旧 runtime と旧分類資産を削除する。

### Slice 0: Boundary
目的: 旧実装に引っ張られない作業境界を固定する。

作るもの:

- new runtime entrypoint
- new schema definitions
- new tool schema registry
- new flat Skill directory
- new prompt builders
- new append-only event measurement
- new tests

やらないこと:

- old decision JSON を残す前提の設計
- old phase / workflow / routing object の読み替え
- old skill reference を残す前提の設計
- old finalize round の維持
- old session memory object の再利用

Definition of Done:

- 新 runtime の public contract が `jobType`、`toolCall`、`finalize_answer.message` だけで説明できる。
- 旧 runtime の型名や decision field を前提にした設計説明がない。

### Slice 1: Schema Package
目的: LLM が出してよい JSON を最初に固定する。

作る型:

```ts
type JobTypeSelection = {
  jobType: JobType;
};

type AgentToolCall = {
  toolCall: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

type FinalizeAnswerArguments = {
  message: string;
};
```

作る validator:

- `parseJobTypeSelection(rawText)`
- `parseAgentToolCall(rawText)`
- `validateToolArguments(toolName, arguments)`

許可する repair:

- JSON block 抽出
- trailing comma 等の構文修復
- schema validation 前の最小正規化

禁止する repair:

- `jobType` の推測補完
- tool name の類推置換
- arguments の意味的補完
- final message の固定文生成

Definition of Done:

- Round 1 schema に `jobType` 以外の field があると invalid。
- Round 2 schema に `toolCall` 以外の field があると invalid。
- `finalize_answer.arguments` に `message` 以外の field があると invalid。

### Slice 2: Tool Registry
目的: prompt に手書き tool 契約を散らさない。

ToolDefinition:

```ts
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};
```

最初に必要な tool:

- `list_dir`
- `read_file`
- `search_files`
- `apply_patch`
- `replace_content`
- `run_command`
- `select_job_type`
- `finalize_answer`

設計ルール:

- outputSchema は持たない。
- tool result は runtime 内部形式で保存する。
- LLM へ渡すのは compact summary だけ。
- tool schema は prompt string ではなく registry から render する。

Definition of Done:

- 全 tool が `name / description / inputSchema` だけで定義される。
- unknown tool は実行されず、validation result として Round 2 に戻る。
- allowed tool list 外の tool は実行されない。

### Slice 3: Flat Skill Pack
目的: job type と Skill を 1 対 1 にする。

配置:

```text
skills/
  general_answer.md
  planning.md
  minor_code_edit.md
  major_code_edit.md
  script_code_edit.md
  review.md
  investigation.md
  runtime_debug.md
  test_and_verification.md
  research.md
  docs.md
  git_release.md
  code.md
  refactor.md
  test.md
  config.md
  dependency.md
  data_migration.md
  blueprint.md
  ui_ux.md
  git.md
  release.md
```

各 Skill の最小章:

```md
# <jobType>

## Use When

## Tools

## Procedure

## Completion

## Switch Job Type

## Output
```

Skill の禁止事項:

- phase を選ばせない。
- workflow を選ばせない。
- evidence table を要求しない。
- task 全体 JSON を出させない。
- LLM に runtime state 更新を要求しない。

Definition of Done:

- すべての `JobType` に同名 Skill file がある。
- Skill loader は `jobType -> skills/<jobType>.md` 以外の探索をしない。
- Skill 内の Output は常に `toolCall` だけ。

### Slice 4: Round 1 Selector
目的: 最初の job type だけを選ばせる。

Prompt input:

- user request
- job type list
- job type one-line descriptions
- tool list
- tool input schemas

Prompt output:

```json
{ "jobType": "minor_code_edit" }
```

Runtime behavior:

- schema valid なら `currentJobType` に保存。
- schema invalid なら同じ Round 1 を最大 1 回だけ再試行。
- 2 回 invalid なら `needs_human`。

禁止:

- runtime が user request を keyword で見て jobType を上書きする。
- runtime が fallback で `general_answer` にする。

Definition of Done:

- Round 1 の保存対象は raw output と parsed `jobType` だけ。
- Round 1 で tool は実行されない。

### Slice 5: Round 2 Tool Loop
目的: Skill を読んだ LLM に、次の tool call だけを出させる。

Prompt input:

- user request
- current job type
- current Skill
- allowed tool schemas
- compact recent tool results

Prompt output:

```json
{
  "toolCall": {
    "name": "read_file",
    "arguments": {
      "path": "package.json"
    }
  }
}
```

Runtime behavior:

1. parse `toolCall`
2. validate tool exists
3. validate allowed for current Skill
4. validate arguments
5. execute tool
6. append compact result
7. loop

Definition of Done:

- 1 loop あたり LLM 出力 JSON は toolCall だけ。
- tool result 後に task 全体 JSON は再生成されない。
- `select_job_type` は tool として処理され、Round 2 を継続する。
- `finalize_answer` は tool として処理され、LLM round を追加せず完了する。

### Slice 6: Minimal Runtime State
目的: 状態は runtime が持ち、LLM に編集させない。

Runtime state:

```ts
type AgentRuntimeState = {
  runId: string;
  userRequest: string;
  currentJobType: JobType;
  currentContext: string;
  stepCount: number;
  invalidOutputCount: number;
  toolResults: CompactToolResult[];
  status: 'running' | 'needs_human' | 'completed' | 'failed';
  finalMessage?: string;
};
```

State rules:

- state は prompt に丸ごと渡さない。
- LLM から state patch を受け取らない。
- DB 保存する場合も runtime event として保存し、LLM に ledger 更新を要求しない。

Definition of Done:

- LLM output に state object が存在しない。
- runtime state の更新箇所が LLM parser と tool executor の機械的結果だけに限定される。

### Slice 7: Failure Semantics
目的: fallback で LLM の判断を上書きしない。

Failure categories:

- `invalid_json`
- `invalid_schema`
- `unknown_tool`
- `tool_not_allowed`
- `invalid_tool_arguments`
- `tool_execution_failed`
- `step_limit_reached`
- `llm_unreachable`

Rules:

- LLM raw output がある failure は raw output を保存する。
- LLM raw output がある failure は固定のユーザー向けエラー文に置換しない。
- `llm_unreachable` のみ runtime 固定文を許可する。
- tool failure は次 Round 2 の compact result として渡す。

Definition of Done:

- parse failure と tool failure は final answer ではない。
- final answer は常に `finalize_answer.arguments.message`。

### Slice 7.5: Event Measurement
目的: すべての runtime / LLM / tool activity を欠落なく保存する。

作るもの:

- `AgentEvent` type
- append-only event writer
- per-run monotonic `seq`
- event persistence test helper
- raw event replay helper

記録する境界:

- run start/end
- prompt build
- LLM request
- LLM raw output
- parse success/failure
- skill load
- tool validation
- tool start/end/failure
- job switch
- finalize receipt
- step limit / invalid output limit

禁止:

- LLM に event JSON を出させる。
- event 保存のために LLM prompt を肥大化する。
- event 表示の都合で raw event を捨てる。
- event 保存失敗を固定の LLM エラー文として表示する。

Definition of Done:

- `minor_code_edit` fixture のすべての activity が event として保存される。
- parse failure fixture でも raw LLM output が保存される。
- tool failure fixture でも tool input と failure payload が保存される。
- event replay だけで visible activity list を再構築できる。

### Slice 8: Tests
目的: シンプルなタスクがシンプルに終わることを固定する。

Unit tests:

- Round 1 parser rejects extra fields.
- Round 2 parser rejects extra fields.
- tool argument validation rejects invalid shape.
- unknown tool is not executed.
- outputSchema is absent from rendered tool definitions.
- Skill loader maps only `jobType -> skills/<jobType>.md`.

Loop fixture tests:

- `fizzbuzz.ts` create:
  - Round 1: `minor_code_edit`
  - Round 2: `list_dir`
  - Round 2: `apply_patch`
  - Round 2: `read_file`
  - Round 2: `finalize_answer`
  - no Round 3
  - no decision JSON
  - visible activity <= 20 steps
  - every activity is persisted as an event

- invalid tool retry:
  - LLM returns unknown tool
  - runtime returns validation result
  - LLM returns allowed tool
  - task completes
  - validation failure is persisted as an event

- event replay:
  - reconstructs visible activity list from persisted events
  - includes raw LLM output, parsed tool call, tool result, and final answer
  - does not require LLM-generated ledger JSON

Definition of Done:

- tests prove the loop can complete without old decision schema.
- tests fail if phase/workflow/routing fields reappear in LLM output schema.
- tests prove simple `minor_code_edit` fixture stays within 20 visible activity steps.

### Slice 9: Cutover
目的: 新 runtime が通ったあと、旧 coding agent path を削除する。

Cutover rule:

- 旧 runtime との fallback chain は作らない。
- 旧 runtime に失敗時 fallback しない。
- UI/API は新 runtime entrypoint だけを呼ぶ。
- 旧 skill/routing/finalize artifacts はソースツリーから削除する。

Definition of Done:

- new runtime が `minor_code_edit` fixture を通す。
- UI/API の coding agent execution が new runtime に接続される。
- old runtime が削除されている。
- compatibility fallback がない。

### Slice 10: Deletion Gate
目的: 新設計の横に旧設計が残り、LLM prompt や runtime 判断へ混入することを防ぐ。

削除対象:

- old decision schema
- old routing object
- old phase/workflow state machine
- old finalize-only LLM round
- old session memory update contract
- old multi-axis skill references
- old runtime fallback branch
- old prompt fragments that mention phase/workflow/routing/evidence contract as required output
- old tests that require full decision JSON

残してよいもの:

- provider call primitive
- worker tool execution primitive
- repository path safety primitive
- JSON extraction / repair / schema validation primitive
- DB/event persistence primitive, if it stores runtime facts without asking LLM to update ledger/state JSON

削除判定:

- `jobType` selector 以外で job type 相当の分類を出していない。
- `toolCall` selector 以外で action 相当の JSON を出していない。
- `finalize_answer.message` 以外から final answer を作っていない。
- old decision schema を import している production code がない。
- prompt に `phase`、`workflow`、`routingHypothesis`、`finalResponse` を出力要求する文がない。
- fallback として old runtime を呼ぶ code path がない。

Definition of Done:

- 新 runtime の周辺に旧 runtime compatibility layer が存在しない。
- 旧 schema を受ける parser が production path に存在しない。
- old prompt / old skill / old loop の削除後に test と typecheck が通る。

## Explicit Rejections
この redesign では次を採用しない。

- Round 1 で routing hypothesis object を返す。
- Round 2 で phase / workflow / rationale / finalResponse を返す。
- Finalize Answer 用に別 LLM round を必ず呼ぶ。
- LLM に SessionMemory や runtime state を JSON 更新させる。
- tool result を受けるたびに task 全体 JSON を再生成する。
- completion 判断のために巨大な evidence contract を毎回渡す。
- Chat / ledger 表示問題を coding agent loop に混ぜる。
- user request を正規表現や keyword で分類する。
- provider 層に jobType別の実行判断を置く。
- 固定エラー文 fallback で LLM 本文を上書きする。
- runtime guard を増やして素のLLM判断を置き換える。
