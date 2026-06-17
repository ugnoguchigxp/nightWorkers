# 確認系ツールカード改修計画

## 1. 目的

`read_file | started` 相当の表示から、どのファイルを、どの範囲で、どの状態で読み取っているかを追えるようにする。

あわせて、`list_dir` など編集を伴わない確認系 worker tool についても、通常 timeline でほぼ何も見えない状態を改善する。

現行の確認系 tool 実行イベントは、`task_events.payload_json` に入力と結果を保存している。しかし通常の timeline 表示では `read_file started` や `list_dir started` 程度に潰れるか、通常表示に出ないことが多く、ユーザーが「どのファイルやディレクトリを確認したか」を UI 上で追いにくい。

この計画では、`read_file` を第一段階の具体例としつつ、確認系 tool 群へ展開できるカード出力改善の対象データ、表示方針、実装手順、検証観点を整理する。実装そのものはこの計画書では行わない。

## 2. 現状

### 2.1 対象ツール群

この計画で扱う中心対象は、workspace を編集せず、調査・確認・状態把握の evidence を返す worker tool とする。

第一段階:

- `read_file`

第二段階:

- `list_dir`
- `find_file`
- `search_files`
- `inspect_structure`
- `git_status`
- `git_diff`
- `read_current_specification`

後段候補:

- `search_web`
- `fetch_content`

`run_verification` は `mutatesWorkspace: false` だが、現行 UI では command 系カードとして扱われているため、この計画の中心対象には含めない。`context-still.*` と `import_project` も既に専用カードがあるため対象外にする。

### 2.2 read_file ツール仕様

`read_file` は Supervisor の worker tool として公開されている。

入力:

- `filePath`: 必須。repo root 基準のファイルパス。
- `startLine`: 任意。1-indexed の開始行。
- `endLine`: 任意。1-indexed の終了行。
- `fresh`: 任意。cache marker 後などに実内容の再読を強制する。
- `compressionMode`: 任意。`auto` または `off`。

出力:

- `content`
- `totalLines`
- `linesReturned`
- `startLine`
- `endLine`
- `truncated`
- `cached`
- `contentHash`
- `compression`

大きいファイルは `read_file_summary` に圧縮される。同一 run 内で未変更の再読は `read_cache_marker` を返す。`fresh: true`、行範囲指定、または `compressionMode: "off"` により、通常の cache / compression 挙動を一部回避できる。

### 2.3 イベント保存

Supervisor は tool 実行直前に `tool.started` を保存する。

保存される started payload:

```json
{
  "toolName": "read_file",
  "arguments": {
    "filePath": "web/src/routes/root-route.tsx"
  }
}
```

実行後は `tool.finished` または `tool.failed` が保存される。

保存される finished payload:

```json
{
  "step": 9,
  "toolName": "read_file",
  "ok": true,
  "arguments": {
    "filePath": "web/src/routes/root-route.tsx"
  },
  "summary": "tool=read_file status=ok\nlines=1-84 total=84\n...",
  "payload": {
    "totalLines": 84,
    "linesReturned": 84,
    "startLine": 1,
    "endLine": 84,
    "truncated": false,
    "cached": false,
    "contentHash": "sha256:..."
  }
}
```

現行 DB の `task_events` では、`agentEventType = "tool.started"` かつ `payload.toolName = "read_file"` のイベントから `payload.arguments.filePath` を取得できる。finished 側では、同じ `step` と近接する `seq` から結果情報を取得できる。

他の確認系 tool も、基本的には同じ `tool.started` / `tool.finished` / `tool.failed` の event shape に乗る。tool ごとに `arguments` と `payload` の内容は異なるが、カード化では次の共通項目を優先して抽出する。

- tool name
- lifecycle
- status
- arguments
- result payload
- error
- event seq
- run id

### 2.4 UI 表示

通常 transcript では、`run_command` / `run_verification` / `command_execution` や `apply_patch` / `replace_content` は専用表示されるが、`read_file` や `list_dir` などの確認系 tool は通常表示の visible card 対象ではない。

debug transcript では JSON を開けば追跡できる。ただし、ユーザーが通常表示だけを見る場合、読み取り対象ファイル、一覧取得ディレクトリ、検索クエリ、git 状態、cache / compression の状態は見えにくい。

## 3. 課題

- `read_file started` だけでは対象ファイルが分からない。
- `read_file` の started と finished が別イベントなので、UI 上で読み取り開始と結果が分断される。
- cache marker と fresh reread の意味が UI 上で分かりにくい。
- 大きいファイルが summary 圧縮された場合、実際に全文を読んだのか、要約だけが返ったのかが分かりにくい。
- `list_dir started` だけでは、どのディレクトリを、再帰的に、何件上限で一覧したのかが分からない。
- `search_files started` だけでは、検索語、glob、結果件数が分からない。
- `find_file` / `inspect_structure` / `git_status` / `git_diff` / `read_current_specification` も、通常表示では調査 evidence として読みにくい。
- 現在の通常 timeline は確認系 tool を表示対象にしていないため、調査作業の根拠が UI 上で見えづらい。

## 4. 改修方針

確認系 tool を Activity 投影対象として扱い、通常 timeline に専用カードを出す。

カードは「確認作業の監査ログ」として扱う。結果本文全体を大きく表示するのではなく、対象、条件、件数、状態を短く示し、必要な場合に detail / debug JSON で深掘りできる構造にする。

カードの主目的:

- 読み取ったファイル、一覧したディレクトリ、検索条件、git 対象などを明示する。
- 読み取り範囲、検索条件、一覧条件、結果件数を明示する。
- cache / fresh / compression / truncated の状態を明示する。
- failed の場合はエラー理由を明示する。
- started のみ存在する場合でも、対象と条件を表示する。

段階導入:

1. `read_file` card を追加する。
2. `list_dir` / `search_files` / `find_file` を同じ確認系 card 基盤に載せる。
3. `inspect_structure` / `git_status` / `git_diff` / `read_current_specification` を追加する。
4. 必要性が確認できた場合だけ、`search_web` / `fetch_content` を後段で検討する。

## 5. 表示モデル

### 5.1 対象イベント

対象は確認系 worker tool に限定する。

対象条件:

- `payload.toolName` が対象ツール名である
- または `runEvent.data.toolName` が対象ツール名である
- または既存 helper の `getToolName(payload)` が対象ツール名を返す

started:

- `agentEventType === "tool.started"`
- または `runEvent.type === "tool.call_started"`

result:

- `agentEventType === "tool.finished"`
- `agentEventType === "tool.failed"`
- または `runEvent.type === "tool.call_finished"`

初期実装では Supervisor schema-first 由来の event shape を主対象にする。Codex SDK の MCP tool event など、形が異なるイベントは同じ helper で拾える場合のみ表示する。

対象ツール名:

```ts
type InspectingToolName =
  | "read_file"
  | "list_dir"
  | "find_file"
  | "search_files"
  | "inspect_structure"
  | "git_status"
  | "git_diff"
  | "read_current_specification";
```

### 5.2 カードモデル

共通モデル:

```ts
type InspectionToolCardModel = {
  lifecycle: "started" | "result";
  status: "started" | "ok" | "failed";
  toolName: InspectingToolName;
  title: string;
  target?: string;
  query?: string;
  options?: Array<{ label: string; value: string }>;
  metrics?: Array<{ label: string; value: string }>;
  badges?: string[];
  errorCode?: string;
  errorMessage?: string;
  preview?: string;
};
```

`read_file` 用の詳細モデルは、共通モデルに読み取り範囲と cache / compression 情報を追加する。

```ts
type ReadFileToolCardModel = InspectionToolCardModel & {
  toolName: "read_file";
  target: string;
  lifecycle: "started" | "result";
  status: "started" | "ok" | "failed";
  filePath: string;
  requestedRange?: {
    startLine?: number;
    endLine?: number;
  };
  actualRange?: {
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    linesReturned?: number;
  };
  fresh?: boolean;
  cached?: boolean;
  truncated?: boolean;
  compressionStrategy?: string;
  contentHash?: string;
  errorCode?: string;
  errorMessage?: string;
  preview?: string;
};
```

第二段階以降の tool は、共通モデルを使って次のように表す。

- `list_dir`: target = `relativePath` または repo root、options = `recursive`, `maxEntries`, metrics = entry count
- `find_file`: target = `relativePath`、query = `fileMask`, metrics = result count
- `search_files`: query = `query`, options = `glob`, metrics = match count
- `inspect_structure`: target = `filePath`, options = `includeImports`, `previewPrimitives`, metrics = node / path count
- `git_status`: target = repo, metrics = changed file count, preview = short status
- `git_diff`: target = repo, metrics = changed file count / diff stat, preview = diff stat
- `read_current_specification`: target = task id, metrics = found / title / digest

### 5.3 表示内容

共通 started card:

- title: tool ごとの短い表示名
- status: `Started`
- main: target または query
- metadata: arguments から抽出した主要 option

共通 result card:

- title: tool ごとの短い表示名
- status: `Completed` / `Failed`
- main: target または query
- metadata: 件数、範囲、短い状態
- failed の場合: error code と message

`read_file` started card:

- title: `Read file`
- status: `Started`
- main: `filePath`
- metadata: requested range, `fresh`, `compressionMode`

`read_file` finished card:

- title: `Read file`
- status: `Read` / `Cached` / `Compressed` / `Failed`
- main: `filePath`
- metadata: actual range, total lines, lines returned
- badges: `cached`, `fresh`, `truncated`, compression strategy
- failed の場合: error code と message

本文 preview:

- 初期実装では常時展開しない。
- `summary` の先頭数行、`payload.content` の短い抜粋、または result count / stat を任意で表示する。
- 長文 content、巨大な検索結果、巨大な diff を通常 timeline にそのまま出さない。

## 6. 実装手順

1. 確認系 tool card model extractor を追加する。
   - 置き場候補: `src/modules/nightworkers/components/ThreadTimelineInspectionToolCard.tsx`
   - 既存の `ThreadTimelineContextStillCards.tsx` と `ThreadTimelineImportProjectCard.tsx` の構造に合わせる。
   - `getToolName(...)`, `getToolArguments(...)`, `getToolResult(...)`, `asRecord(...)`, `asString(...)`, `asNumber(...)` を再利用する。
   - まず `read_file` の extractor を実装し、共通モデルへ拡張できる形にする。

2. started / finished の両方から `filePath` を抽出する。
   - started は `arguments.filePath` を優先する。
   - finished は `arguments.filePath` を優先し、必要なら result payload から補完する。
   - `filePath` が取れない場合はカード化しない。

3. result payload から読み取り状態を抽出する。
   - `payload.startLine`
   - `payload.endLine`
   - `payload.totalLines`
   - `payload.linesReturned`
   - `payload.cached`
   - `payload.truncated`
   - `payload.contentHash`
   - `payload.compression.strategy`
   - `error.code`
   - `error.message`

4. `list_dir` / `search_files` / `find_file` の extractor を追加する。
   - `list_dir`: `relativePath`, `recursive`, `maxEntries`, result entries count を抽出する。
   - `search_files`: `query`, `glob`, match count を抽出する。
   - `find_file`: `fileMask`, `relativePath`, result count を抽出する。
   - result payload の詳細 shape が tool ごとに違うため、count / short preview は defensive に抽出する。

5. `inspect_structure` / `git_status` / `git_diff` / `read_current_specification` の extractor を追加する。
   - `inspect_structure`: `filePath` と構造 summary を短く出す。
   - `git_status`: short status と changed file count を出す。
   - `git_diff`: diff stat を出す。diff 本文は通常カードに全文表示しない。
   - `read_current_specification`: found / title / digest / taskId を出す。本文全文は表示しない。

6. 通常 transcript の visible 対象に加える。
   - `buildNormalTranscriptItems(...)` に `rememberVisibleInspectionToolCard(...)` を追加する。
   - 第一段階では `read_file` のみを返し、第二段階で対象ツール名を広げる。
   - 同一 read の started と finished が両方出る場合、finished を優先して重複を抑えるか、started と finished を別カードとして時系列表示するかを実装前に決める。
   - 推奨は初期実装では別カード表示。理由は `started` だけで止まったケースを消さず、実行順序をそのまま追えるため。

7. debug transcript 側にも専用カードを適用する。
   - `TranscriptActivityBlock` の前段で `hasInspectionToolCard(...)` を判定する。
   - JSON 表示は既存どおり残す。

8. normal timeline のカード群に統合する。
   - `ThreadTimeline.tsx` の normal event 表示で `NormalInspectionToolCard` を追加する。
   - `ContextStill` / `ImportProject` と同じく、専用カードは通常表示で見えるようにする。

9. activity text の最小改善を検討する。
   - backend の `runEventToActivityText(...)` は現在 `read_file started` に潰す。
   - 専用カードだけで足りるなら backend text は変えない。
   - 変える場合は `read_file started: <filePath>` や `list_dir started: <relativePath>` 程度に限定し、payload の source of truth は維持する。

## 7. 重複制御方針

初期実装では started と result を別イベントとして表示する。

理由:

- 実行順序を `seq` 通りに追える。
- started だけ保存され、finished が欠けた異常ケースを見落としにくい。
- cache marker 後の fresh reread など、同じ `filePath` の連続読み取りを潰さずに追える。
- `list_dir` や `search_files` の連続確認も、調査手順としてそのまま追える。

ただし、通常表示が冗長になる場合は第 2 段階で同一 `runId + step + toolName + target/query` を 1 カードにまとめる。まとめる場合も、内部には started / finished の両方の event id と seq を保持する。

## 8. 検証観点

### 8.1 unit test

追加対象:

- `tests/thread-timeline-edit-summary/...` と同等の timeline helper test
- 必要なら `tests/nightworkers.activity-transcript.test.ts`

確認すること:

- schema-first `tool.started` event から `read_file.filePath` が表示モデルに入る。
- schema-first `tool.finished` event から `read_file.filePath`、行範囲、total lines が表示モデルに入る。
- `payload.cached === true` の場合に `Cached` 状態になる。
- `payload.compression.strategy === "read_file_summary"` の場合に `Compressed` 状態になる。
- `tool.failed` の場合に error code / message が表示モデルに入る。
- `filePath` がない event は専用カード化しない。
- `list_dir` の started / finished event から `relativePath` と result count が表示モデルに入る。
- `search_files` の started / finished event から `query` / `glob` と match count が表示モデルに入る。
- `find_file` の started / finished event から `fileMask` と result count が表示モデルに入る。
- `git_status` / `git_diff` は short status / diff stat を preview として持つ。
- 対象外 tool は確認系カード化しない。

### 8.2 UI test

確認すること:

- normal transcript に `read_file` card が表示される。
- normal transcript に `list_dir` / `search_files` / `find_file` card が表示される。
- card に対象ファイル、対象ディレクトリ、検索条件が表示される。
- started と finished の順序が `seq` 通りに保たれる。
- `showDebugEvents` の切り替えで JSON 表示の既存挙動を壊さない。
- 既存の command / diff / ContextStill / ImportProject card が消えない。

### 8.3 DB 実データ確認

実装後に、既存 `sqlite.db` または fixture で次を確認する。

```sql
select
  seq,
  json_extract(payload_json, '$.agentEventType') as agent_event_type,
  json_extract(payload_json, '$.payload.toolName') as tool_name,
  json_extract(payload_json, '$.payload.arguments.filePath') as file_path,
  json_extract(payload_json, '$.payload.arguments.relativePath') as relative_path,
  json_extract(payload_json, '$.payload.arguments.query') as query,
  json_extract(payload_json, '$.payload.payload.cached') as cached,
  json_extract(payload_json, '$.payload.payload.compression.strategy') as compression_strategy
from task_events
where json_extract(payload_json, '$.payload.toolName') in (
  'read_file',
  'list_dir',
  'find_file',
  'search_files',
  'inspect_structure',
  'git_status',
  'git_diff',
  'read_current_specification'
)
order by task_run_id, seq;
```

確認すること:

- started event で `file_path` が取れる。
- finished event で `cached` / `compression_strategy` が取れる。
- `list_dir` で `relative_path` が取れる。
- `search_files` で `query` が取れる。
- UI の表示内容と DB の値が一致する。

## 9. 非目標

- worker tool の実行挙動を変えない。
- cache / compression の仕様を変えない。
- `task_events` schema を変えない。
- Supervisor prompt を変えない。
- LLM に渡す tool schema を変えない。
- `run_command` / `run_verification` の command card を作り直さない。
- `ContextStill` / `ImportProject` の専用カードを作り直さない。
- `search_web` / `fetch_content` は初期実装の必須対象にしない。
- 読み取ったファイル本文、検索結果全文、diff 本文を通常 timeline に全文表示しない。
- 確認系 tool の結果を LLM evidence として扱う既存ロジックは変えない。

## 10. 完了条件

- `read_file` の started / finished / failed が通常 timeline で確認系カードとして確認できる。
- `list_dir` / `search_files` / `find_file` の started / finished / failed が通常 timeline で確認系カードとして確認できる。
- `inspect_structure` / `git_status` / `git_diff` / `read_current_specification` についても、主要な入力と結果 summary が通常 timeline で確認できる。
- カードから対象 `filePath`、読み取り範囲、cache / compression / truncated / failed 状態を追える。
- カードから対象ディレクトリ、検索条件、結果件数、git status / diff stat、spec 取得状態を追える。
- debug JSON を開かなくても、最低限「どのファイルをどう読んだか」が分かる。
- debug JSON を開かなくても、最低限「どの確認 tool が何を対象に動いたか」が分かる。
- 既存の command / diff / ContextStill / ImportProject 表示が維持される。
- unit test と UI 表示確認で、started のみ、finished、cached、compressed、failed、list_dir result、search_files result、git status / diff summary の主要ケースを確認できる。
