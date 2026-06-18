# Codex SDK Tool Activity Card 実装計画

## 1. 目的

Codex レーンで実行された tool 利用の詳細を、通常の chat/timeline 欄で確認できるカードとして表示する。

現状でも Codex SDK の `command_execution` / `mcp_tool_call` / `file_change` は runtime ledger に変換され、`activity_events` に投影されている。しかし通常表示では次の情報が十分に見えない。

- `nightworkers.todo_list` など MCP tool の arguments / result / error。
- `item.started` / `item.updated` / `item.completed` の lifecycle。
- Codex native command と NightWorkers MCP tool の区別。
- provider item id、server/tool 名、status、exit code、changed files などの実行証跡。

この計画では、native/API レーンの既存カード実装を参考にしつつ、Codex SDK レーン専用の表示責務を定義する。実装そのものはこの計画書では行わない。

## 2. 現状整理

### 2.1 Codex SDK event mapping

Codex SDK stream は `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts` で `AgentRuntimeEvent` に変換される。

- `command_execution`
  - `toolName: "command_execution"`
  - `command`
  - `commandClass`
  - `aggregatedOutput`
  - `exitCode`
  - `status`
  - `providerItemId`
- `mcp_tool_call`
  - `toolName: "<server>.<tool>"`
  - `mcpServer`
  - `mcpTool`
  - `arguments`
  - `result`
  - `error`
  - `status`
  - `providerItemId`
- `file_change`
  - `type: "diff_collected"`
  - `changedFiles`
  - `changes`
  - `status`
  - `providerItemId`

`item.started` は `tool_call_started`、`item.updated` は `tool_call_progress`、`item.completed` は `tool_call_finished` に変換される。

### 2.2 Activity projection

`api/services/agent-runtime/ledger-sink.ts` は runtime event を canonical run event として保存する。

- `tool_call_started` -> `tool.call_started`
- `tool_call_progress` -> `tool.call_progress`
- `tool_call_finished` -> `tool.call_finished`
- `diff_collected` -> `git.diff_collected`

`api/modules/nightworkers/nightworkers.activity.repository.ts` はこれらを `activity_events` に投影する。

- `tool.call_started` / `tool.call_progress` -> `kind: "tool.call"`
- `tool.call_finished` -> `kind: "tool.result"`
- `git.diff_collected` -> `kind: "file.diff"`

したがって、チャット欄カードは基本的に `activity_events.payload_json` だけから構築できる。

### 2.3 既存 UI

通常表示は `src/modules/nightworkers/components/ThreadTimeline.tsx` で `activityEvents` がある場合に `buildNormalTranscriptItems(...)` を使う。

既存の表示導線:

- `NormalInspectionToolCard`
  - `read_file`
  - `list_dir`
  - `find_file`
  - `search_files`
  - `inspect_structure`
  - `git_status`
  - `git_diff`
  - `read_current_specification`
- `NormalImportProjectToolCard`
  - `import_project`
- `NormalContextStillToolCard`
  - `context-still.*`
- `NormalCliCommandBlock`
  - `run_command`
  - `run_verification`
  - `command_execution`
- `NormalEditDiffBlock`
  - `apply_patch`
  - `replace_content`
  - `file.diff`

`getToolActivityModel(...)` はすでに共通抽出層として存在するため、Codex 用の新規カードもこの抽出層を利用する。

## 3. 非目標

- Codex SDK の実行判断、tool policy、audit 警告の意味を変更しない。
- native/API レーンの provider-native tool call 保存構造を変更しない。
- `run_command` / `run_verification` を Codex MCP tool として追加しない。
- raw provider event 全文を通常表示に展開しない。
- DB schema の変更を前提にしない。

## 4. 実装方針

### 4.1 Codex Tool Activity Card を追加する

新規コンポーネント候補:

```text
src/modules/nightworkers/components/ThreadTimelineCodexToolCard.tsx
```

主な export:

```ts
export type CodexToolCardModel = {
  lifecycle: "started" | "progress" | "result" | "failed";
  status: "started" | "running" | "ok" | "failed";
  providerItemId?: string;
  toolName: string;
  codexKind: "command" | "mcp" | "file_change" | "unknown";
  title: string;
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  argumentsPreview?: string;
  resultPreview?: string;
  outputPreview?: string;
  errorMessage?: string;
};

export function getCodexToolCardModel(event: ActivityEvent | TaskEvent): CodexToolCardModel | null;
export function hasCodexToolCard(event: ActivityEvent | TaskEvent): boolean;
export function NormalCodexToolCard(props: { event: ActivityEvent | TaskEvent }): JSX.Element | null;
export function CodexToolCard(props: { event: ActivityEvent | TaskEvent }): JSX.Element | null;
```

### 4.2 対象 payload

`getToolActivityModel(event)` の結果と `payload.payload` / `payload.runEvent.data` を併用して、次を Codex tool card の対象にする。

1. `provider === "codex"` かつ `toolName === "command_execution"`
2. `provider === "codex"` かつ `mcpServer` / `mcpTool` がある
3. `provider === "codex"` かつ `toolName` が `nightworkers.` または `<server>.<tool>` 形式
4. `provider === "codex"` かつ `changedFiles` / `changes` がある file change

ただし既存専用カードと競合するものは専用カードを優先する。

- `nightworkers.import_project` は `NormalImportProjectToolCard` 優先。
- `context-still.*` は `NormalContextStillToolCard` 優先。
- `command_execution` は既存 `NormalCliCommandBlock` を残し、Codex card は metadata / lifecycle 補助を担うか、重複が強ければ command は対象外にする。

第一段階では MCP tool card を主対象にし、command/file change は既存表示の不足分だけを補う。

### 4.3 表示内容

MCP tool の summary:

```text
nightworkers.todo_list                         Codex MCP
finished · operation=done · status=failed · provider item mcp-1
```

詳細:

```text
server: nightworkers
tool: todo_list
status: failed
providerItemId: mcp-1
lifecycle: result

arguments:
{
  "runId": "run-1",
  "operation": "done",
  "seq": 1
}

result:
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":{\"code\":\"CURRENT_TODO_NOT_UNIQUE\"}}"
    }
  ]
}

error:
CURRENT_TODO_NOT_UNIQUE
```

Command の summary:

```text
pnpm test                                      Codex command
running · verification · exit=pending
```

詳細:

```text
toolName: command_execution
commandClass: verification
status: in_progress
exitCode: pending
providerItemId: cmd-1

output:
running tests
```

File change の summary:

```text
Changed files (2)                              Codex file change
completed · provider item file-1
```

詳細:

```text
changedFiles:
- src/app.ts
- README.md
```

## 5. UI 統合

### 5.1 Normal transcript

`src/modules/nightworkers/components/ThreadTimelineNormalTranscript.tsx` を更新する。

追加するもの:

- `seenCodexToolCards`
- `rememberVisibleCodexToolCard(...)`
- `visibleCodexToolCardKey(...)`
- `NormalVisibleActivityBlock` 内の `<NormalCodexToolCard event={event} />`

dedupe key は次の優先順で決める。

1. `providerItemId + lifecycle + toolName`
2. `runId + seq + lifecycle + toolName`
3. `toolName + status + summary`

同一 `providerItemId` の started/progress/result は lifecycle 別に表示してよい。ただし progress が多数来る場合は、同じ provider item の最新 progress だけを残すか、第一段階では既存の `buildNormalTranscriptItems` 側 dedupe で過剰表示を抑える。

### 5.2 Task event fallback

`src/modules/nightworkers/components/ThreadTimeline.tsx` の `latestRunEvents` fallback 表示にも `hasCodexToolCard` / `NormalCodexToolCard` を追加する。

`activityEvents` がまだ flush されていない短い時間でも、最新 run events から同じカードが表示されることを目標にする。

### 5.3 Debug transcript

debug 表示では `AgentDebugEventCard` は残す。必要なら `CodexToolCard` を debug 側にも出し、raw JSON の前に要約を置く。

## 6. Backend 正規化の確認ポイント

第一段階は UI 側だけで進める。ただし実装中に payload 不足が見つかった場合のみ、`codex-sdk-event-adapter.ts` を最小修正する。

確認する項目:

- `mcp_tool_call` completed event に `result` が保存される。
- failed/cancelled event に `error` が保存される。
- `providerItemId` が started/progress/result で一貫して入る。
- `arguments` は `redactProviderEvent(...)` 済みで、token/secret が通常表示に出ない。
- `command_execution` の `aggregatedOutput` と `exitCode` が completed event まで残る。

必要なら追加する payload:

```ts
codexItemType: item.type
providerEventType: eventType
```

これは表示側で `mcp_tool_call` / `command_execution` / `file_change` を判定しやすくするための補助であり、既存 contract warning の意味は変えない。

## 7. 実装タスク

### Phase 1: 表示モデル

対象:

- `src/modules/nightworkers/components/ThreadTimelineCodexToolCard.tsx`
- `tests/thread-timeline-codex-tool-card.test.ts`

作業:

1. `getCodexToolCardModel(...)` を実装する。
2. MCP tool の started/progress/result/failed を fixture でテストする。
3. `nightworkers.todo_list` の arguments / result / error が preview に入ることを確認する。
4. secret-like key が redacted 済みの payload をそのまま表示し、再展開しないことを確認する。

### Phase 2: normal transcript 統合

対象:

- `src/modules/nightworkers/components/ThreadTimelineNormalTranscript.tsx`
- `tests/thread-timeline-codex-tool-card.test.ts`

作業:

1. `buildNormalTranscriptItems(...)` の visible 判定に Codex card を追加する。
2. `NormalVisibleActivityBlock` に `NormalCodexToolCard` を追加する。
3. assistant turn の child tool events でもカードが表示されることを確認する。
4. `command_execution` / `file.diff` の既存表示と二重に出すかどうかをテストで固定する。

推奨は第一段階で MCP tool のみ Codex card 対象にし、command/file change は既存カードを維持する。

### Phase 3: timeline fallback 統合

対象:

- `src/modules/nightworkers/components/ThreadTimeline.tsx`
- `tests/thread-timeline-codex-tool-card.test.ts`

作業:

1. `activityEvents` がない fallback path に `hasCodexToolCard` を追加する。
2. `latestRunEvents` の `tool.call_finished` だけでもカードが出ることを確認する。
3. `showDebugEvents=false` で通常カード、`showDebugEvents=true` で debug raw JSON と共存することを確認する。

### Phase 4: backend payload regression

対象:

- `tests/services.codex-agent-runtime.test.ts`
- `tests/nightworkers-routes/routes-nightworkers-02.test.ts`
- 必要な場合のみ `api/services/agent-runtime/codex-sdk/codex-sdk-event-adapter.ts`

作業:

1. `mcp_tool_call` の started/progress/finished が `tool_call_*` として保存されるテストを確認・補強する。
2. `/api/runs/:id/activity-events` で Codex MCP payload が `payloadJson.payload` に残ることを確認する。
3. `runEventToActivityText(...)` は既存の簡易 text として維持し、カードは `payloadJson` から詳細を読む。

## 8. 受け入れ基準

- Codex レーンで `nightworkers.todo_list` を呼んだ場合、chat/timeline 通常表示で operation / seq / status / result/error がカードとして見える。
- Codex レーンで `nightworkers.import_project` を呼んだ場合、既存 import project card が優先され、汎用 Codex card と重複しない。
- Codex native command は既存 command card の表示を壊さない。
- Codex file change は既存 edit/file diff summary の表示を壊さない。
- `activityEvents` 経由と `latestRunEvents` fallback の両方で表示できる。
- secret-like key は provider event mapper の redaction 後の値だけが表示される。
- native/API レーンの inspection/edit/contextStill cards は回帰しない。

## 9. 検証コマンド

最低限:

```bash
bunx vitest run tests/thread-timeline-codex-tool-card.test.ts
bunx vitest run tests/thread-timeline-inspection-tool-card.test.ts tests/thread-timeline-context-still-cards.test.ts
bunx vitest run tests/services.codex-agent-runtime.test.ts tests/nightworkers-routes/routes-nightworkers-02.test.ts
```

UI 確認:

1. Codex レーンで `nightworkers.todo_list operation=replace` を含む run を作る。
2. chat/timeline 通常表示で Codex MCP card が出ることを確認する。
3. debug 表示で raw JSON も確認できることを確認する。
4. native/API レーンの `read_file` / `apply_patch` カードが従来通り表示されることを確認する。

## 10. 初回実装の推奨順

1. `ThreadTimelineCodexToolCard.tsx` と unit test を追加する。
2. `ThreadTimelineNormalTranscript.tsx` に MCP tool card だけ統合する。
3. `ThreadTimeline.tsx` の fallback path に同じカードを統合する。
4. route/runtime tests で payload が維持されることを確認する。
5. 必要な場合だけ `codex-sdk-event-adapter.ts` に `codexItemType` を追加する。

この順なら、native/API レーンや runtime policy に触れずに、ユーザーが必要としている「Codex レーンの tool 利用詳細が chat 欄で見える」状態を先に作れる。
