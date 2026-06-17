# Native/API Tool Activity Card 実装計画

## 1. 目的

native/api レーンで LLM が実行した worker tool の活動を、通常 timeline 上で追跡できるカードとして再実装する。

特に次の状態を UI で分かるようにする。

- `read_file` がどのファイルを、どの範囲で、どれだけ読み込んだか。
- `apply_patch` がどのような patch を要求し、結果としてどのファイルを変更したか。
- `replace_content` / file write 系がどのファイルに、どの規模の編集を行ったか。
- tool 実行が started / completed / failed のどの段階なのか。

現状、native/api レーンは file write 可能になっているが、通常表示では `read_file started` や `apply_patch finished` 程度に潰れ、LLM が実際に読んだ内容や発生させた差分が見えない。既存の確認系カードと編集要約カードはあるが、native/api の保存形に対する正規化が不足しているため、イベントが存在してもカード表示に到達しないケースがある。

この計画では、イベント記録、payload 正規化、カードモデル、tool 別 UI、検証手順を整理する。実装そのものはこの計画書では行わない。

## 2. 現状

### 2.1 native/api 側の記録

native/api runner は worker tool 実行時に ledger event を発行している。

開始イベント:

```json
{
  "type": "tool_call_started",
  "payload": {
    "callId": "...",
    "toolName": "apply_patch",
    "arguments": {
      "patchContent": "..."
    }
  }
}
```

終了イベント:

```json
{
  "type": "tool_call_finished",
  "payload": {
    "callId": "...",
    "toolName": "apply_patch",
    "ok": true,
    "result": {
      "applied": true,
      "changedFiles": ["src/app/page.tsx"],
      "stdout": "",
      "stderr": ""
    }
  }
}
```

また、`native_api_tool_calls` には provider native の tool call が保存される。

- `tool_call_id`
- `tool_name`
- `status`
- `arguments_json`
- `result_json`
- `error_json`
- `model_visible_output`
- `todo_seq`
- `source`

このため、表示に必要な材料は DB 上に存在する。主な不足は、timeline card 側がこの保存形を安定して読めていない点にある。

### 2.2 activity projection

`tool.call_started` / `tool.call_progress` は `activity_events.kind = "tool.call"` に投影される。

`tool.call_finished` は `activity_events.kind = "tool.result"` に投影される。

通常 timeline は主に `activity_events` を読むため、第一目標は投影済み `activity_events.payload_json` だけでカードを構築できる状態にする。

不足がある場合だけ、`callId` / `tool_call_id` を使って `native_api_tool_calls` 側の情報を補える設計にする。ただし UI component が直接 DB を読む構造にはしない。

### 2.3 既存 UI の不足

既存の `ThreadTimelineInspectionToolCard` は `read_file` / `list_dir` / `search_files` など確認系 tool を扱う。

既存の `AgentEditSummaryCard` は `apply_patch` / `replace_content` を扱う。

不足している点:

- tool payload の抽出が `payload.result.payload` など一部の形に寄っており、native/api の `runEvent.data.result` が worker result payload そのものになっている形を十分に扱えていない。
- `apply_patch` の開始イベントにある `runEvent.data.arguments.patchContent` が、通常表示の編集カードとして安定して拾われない。
- 終了イベントだけが存在する場合、`changedFiles` から「何が変わったか」を表示する fallback が弱い。
- `apply_patch` の patch parser が `*** Begin Patch` 形式に偏ると、unified diff 形の patchContent で空カードになり得る。
- normal transcript と debug transcript の表示導線が分かれており、片方だけ直すとユーザーからは「表示されない」状態が残る。

## 3. 対象ツール

### 3.1 第一段階

- `read_file`
- `apply_patch`
- `replace_content`

### 3.2 第二段階

- file write 系 tool
- `copy_directory`
- `import_project`
- `run_command`
- `run_verification`

`run_command` / `run_verification` は既存 command card があるため、この計画では native/api payload 正規化への追随だけを対象にする。

`import_project` は既存の専用カードを優先し、必要な場合だけ native/api event shape を追加対応する。

### 3.3 対象外

- LLM prompt / raw response の全文表示改善。
- contextStill 専用カードの再設計。
- DB schema の大規模変更。
- tool の実行可否や policy 判定そのものの変更。

## 4. 実装方針

### 4.1 tool activity 正規化層を追加する

UI 側で tool payload を個別に探し回らないよう、共通の抽出関数を追加する。

候補:

- `extractToolActivityModel(event)`
- `getToolActivityModel(event)`

返却モデル:

```ts
type ToolActivityModel = {
  toolName: string;
  lifecycle: "started" | "progress" | "result" | "failed" | "other";
  callId?: string;
  status: "started" | "ok" | "failed" | "running";
  arguments: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  rawResult: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
  todo?: {
    seq?: number;
    title?: string;
    taskType?: string;
  };
  eventSeq?: number;
  sourceLane?: "native-api" | "schema-first" | "codex-sdk" | "unknown";
};
```

抽出対象 path:

- `payload.toolName`
- `payload.arguments`
- `payload.result`
- `payload.payload.toolName`
- `payload.payload.arguments`
- `payload.payload.result`
- `payload.runEvent.data.toolName`
- `payload.runEvent.data.arguments`
- `payload.runEvent.data.result`
- `payload.runEvent.data.error`
- `payload.runEvent.data.callId`
- `payload.toolCall.name`
- `payload.toolCall.arguments`
- `payload.decision.toolCall.name`
- `payload.decision.toolCall.arguments`

`resultPayload` は次を順に正規化する。

1. `rawResult.payload`
2. `rawResult.result.payload`
3. `rawResult.result`
4. `runEvent.data.result`
5. `payload.result`

`changedFiles` は必ず `string[]` に型ガードしてから使う。

### 4.2 lifecycle 判定を event kind だけに依存しない

既存実装は `event.kind === "tool.result"` や `runEvent.type === "tool.call_finished"` に依存している。

追加で次を扱う。

- `event.eventType === "tool_result"`
- `event.eventType === "tool_call"`
- `runEvent.type === "tool.call_started"`
- `runEvent.type === "tool.call_progress"`
- `runEvent.type === "tool.call_finished"`
- `runEvent.data.ok === false`
- `event.status === "failed"`

native/api の started / result が normal transcript で別 event として届いても、それぞれ独立したカードを出せるようにする。

## 5. Tool 別カード設計

### 5.1 read_file card

目的:

どのファイルをどの程度読んだかを一目で分かるようにする。

表示項目:

- tool name: `read_file`
- target: `arguments.filePath`
- requested range: `startLine` / `endLine`
- actual range: `resultPayload.startLine` / `resultPayload.endLine`
- volume: `linesReturned` / `totalLines`
- state badges: `fresh`, `cached`, `truncated`, compression strategy
- error: code / message

通常表示 summary:

```text
web/src/routes/root-route.tsx        read_file
Read · lines 1-84 / total 84 · returned 84
```

詳細表示:

```text
target: web/src/routes/root-route.tsx
requested: 1-120
lines: 1-84 / total 84
returned: 84
flags: cached, read_file_summary
```

### 5.2 apply_patch card

目的:

LLM が要求した patch と、実際に変更されたファイルを分けて表示する。

開始イベントの表示:

- tool name: `apply_patch`
- patchContent の対象ファイル
- `+/-` 行数
- patch preview
- callId
- todo seq / title

終了イベントの表示:

- `changedFiles`
- `applied`
- `stdout`
- `stderr`
- error code / message

通常表示 summary:

```text
src/components/TodoWorkspaceSection.tsx        apply_patch
Started · +157 -0 · Todo #5
```

終了イベント summary:

```text
src/components/TodoWorkspaceSection.tsx        apply_patch
Completed · changed 1 file
```

詳細表示:

- patchContent がある場合は diff code block。
- changedFiles しかない場合は fake diff を作らず、changed file list と `changedOnly` 表示にする。
- failed の場合は error を先頭に出し、patchContent があるなら失敗した patch を表示する。

重要:

- `*** Begin Patch` 形式と unified diff 形式の両方を扱う。
- parser がファイル名を取れない場合も、`changedFiles` か `patchContent` の `+++ b/...` / `--- a/...` から fallback する。
- hunk header がない patch でもカード自体は消さない。

### 5.3 replace_content card

目的:

needle / replacement の規模と対象を見えるようにする。

表示項目:

- target: `arguments.filePath`
- occurrences
- estimated added / deleted lines
- needle / replacement preview
- result payload の changedFiles
- error

詳細表示は擬似 diff を使う。

```diff
--- src/greeting.txt
+++ src/greeting.txt
# occurrences: 2
- old text
+ new text
```

### 5.4 file write 系 card

対象 tool が追加または有効化されている場合に対応する。

表示項目:

- target path
- operation: create / overwrite / append
- bytes
- lines
- changedFiles
- preview
- error

content 全文は出さず、最大行数または最大 byte の preview に制限する。

## 6. 表示導線

### 6.1 normal transcript

`ThreadTimelineNormalTranscript` に次の順でカードを出す。

1. edit activity card
2. command card
3. contextStill card
4. import_project card
5. inspection card

`apply_patch` / `replace_content` / file write 系は edit activity card に寄せる。

確認系は inspection card に寄せる。

同一 callId の started / result が両方ある場合でも、当面は lifecycle 別カードとして表示する。後続で grouped card に統合できる余地を残す。

### 6.2 debug transcript

debug 表示では、専用カードを先に表示し、必要に応じて raw JSON を折りたたみで確認できるようにする。

専用カードが出る event では、raw JSON だけのカードに落ちないことをテストで保証する。

### 6.3 fallback

カード化に失敗した場合でも、以下のいずれかは表示する。

- tool name
- target path
- query / command
- changedFiles
- error message

「材料があるのに何も表示されない」状態を避ける。

## 7. 実装手順

### Step 1: fixture を実イベントから固定する

`sqlite.db` の `activity_events` / `task_events` / `native_api_tool_calls` から、次の fixture をテストに固定する。

- native/api `read_file` started
- native/api `read_file` finished
- native/api `apply_patch` started with `patchContent`
- native/api `apply_patch` finished with `changedFiles`
- native/api `apply_patch` failed
- schema-first 既存 `apply_patch`
- existing codex-sdk `file.diff`

実 DB に該当 event がないものは、現行 dispatcher の payload contract から最小 fixture を作る。

### Step 2: 正規化 helper を実装する

`ThreadTimeline.tsx` または新規 `ThreadTimelineToolActivity.ts` に共通 helper を置く。

既存 helper の `getToolName` / `getToolArguments` / `getToolResult` は後方互換を保ちつつ、内部で新 helper を使う形に寄せる。

### Step 3: edit activity card を再実装する

`AgentEditSummaryCard` に閉じた実装を normal transcript でも使える形へ分離する。

候補:

- `ThreadTimelineEditToolCard.tsx`
- `getEditToolCardModel(event)`
- `NormalEditToolCard`
- `DebugEditToolCard`

対象:

- `apply_patch`
- `replace_content`
- file write 系

### Step 4: inspection card を native/api payload に対応させる

`ThreadTimelineInspectionToolCard` は共通正規化 helper から `args` / `resultPayload` を受け取る。

`read_file` の started event では `filePath` だけでもカードを出す。

`read_file` の result event では line metrics と cache/compression badges を出す。

### Step 5: normal/debug の接続を確認する

次を確認する。

- `buildNormalTranscriptItems` でカード対象 event が落ちない。
- `NormalVisibleActivityBlock` に edit card と inspection card が出る。
- `TranscriptActivityBlock` で debug card が raw JSON より先に出る。
- `ThreadTimeline` の fallback path でも task event ベースの card が出る。

### Step 6: grouping は後続に分離する

started / result を 1 枚にまとめる grouped card は有用だが、初回実装では必須にしない。

初回は「見えること」を優先し、callId 付きの started card / result card として表示する。

後続で次を検討する。

- callId で started / result を結合。
- patch request と changedFiles result を 1 枚に統合。
- 実行時間を表示。
- native_api_tool_calls の status と突合。

## 8. テスト計画

### 8.1 unit tests

追加または更新するテスト:

- `tests/thread-timeline-inspection-tool-card.test.ts`
- `tests/thread-timeline-edit-summary/thread-timeline-edit-summary-02.test.ts`
- 必要なら `tests/thread-timeline-native-api-tool-card.test.ts`

検証項目:

- native/api `read_file` started から filePath が表示される。
- native/api `read_file` result から `linesReturned` / `totalLines` / cached / compression が表示される。
- native/api `apply_patch` started から patchContent の対象ファイルと `+/-` が表示される。
- unified diff 形式の `patchContent` でも空カードにならない。
- native/api `apply_patch` result から `changedFiles` が表示される。
- `changedFiles` は `string[]` のみ採用し、混在型は除外される。
- failed tool result で error code / message が表示される。
- normal transcript にカードが残る。
- debug transcript で raw JSON だけにならない。

### 8.2 regression tests

既存カードの回帰確認:

- contextStill card
- import_project card
- command card
- codex-sdk diff card
- schema-first edit summary

### 8.3 推奨コマンド

```bash
bunx vitest run \
  tests/thread-timeline-inspection-tool-card.test.ts \
  tests/thread-timeline-edit-summary/thread-timeline-edit-summary-02.test.ts \
  tests/thread-timeline-context-still-cards.test.ts \
  tests/thread-timeline-import-project-card.test.ts
```

```bash
bun run typecheck
```

`vi.mocked` を使う既存テストがあるため、`bun test` ではなく `bunx vitest run` を優先する。

## 9. 完了条件

- native/api の `read_file` started / result が通常 timeline で対象ファイルと読み込み量を表示する。
- native/api の `apply_patch` started が patch 内容の要約と diff preview を表示する。
- native/api の `apply_patch` result が changedFiles と成功/失敗を表示する。
- `replace_content` が対象ファイルと置換規模を表示する。
- `changedFiles` の型ガードが入り、混在型 payload で UI が壊れない。
- unified diff 形式の patchContent でもカードが消えない。
- debug 表示と normal 表示の両方で同じ tool activity が追える。
- 既存の contextStill / import_project / command / codex diff card が壊れていない。

## 10. リスクと対策

### リスク: payload shape がさらに増える

対策:

正規化 helper に path 候補を集約し、card component 側で個別 path を読まない。

### リスク: patch parser が壊れて空カードになる

対策:

`changedFiles` / filename fallback / raw patch preview の順で表示を残す。

### リスク: started と result が重複してうるさくなる

対策:

初回は lifecycle 別表示で可視性を優先する。後続で callId grouping を追加する。

### リスク: 大きい patchContent で UI が重くなる

対策:

summary はファイル名と `+/-` に限定し、details の code block は高さ制限を維持する。

### リスク: native_api_tool_calls と activity_events の整合がずれる

対策:

UI は `activity_events` を第一ソースとし、DB 専用テーブルは API 側で補助情報として投影する場合に限って使う。
