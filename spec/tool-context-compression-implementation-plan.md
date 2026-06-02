---
title: Tool Context Compression 実装計画
targetKind: wiki
priorityGroup: implementation-plan
status: planned
---

# Tool Context Compression 実装計画

作成日: 2026-06-02

## 目的

NightWorkers の native tool が返す大きな出力を、LLM に渡す前に deterministic に小さくする。

この計画は Headroom の「tool output を内容種別ごとに扱い、重要行を残し、再読や巨大出力を抑制する」というコンセプトだけを参考にする。Python / Rust 実装、ML 要約、学習ベースの圧縮、CCR / evidence store は採用しない。実装は NightWorkers の既存 TypeScript tool 群に閉じる。

## 背景

現状の `read_file` は、ファイルを読み、指定行範囲または最大 1000 行を行番号付きで返す。再読、巨大ファイル、同じファイルの unchanged 判定、全文が既に context にある場合の省略はない。

現状の `run_command` は、stdout / stderr をそれぞれ先頭 20000 文字で切り、超過時は tmp artifact に全文を書く。これは単純で安全だが、失敗原因が末尾や stack trace にある場合、重要な情報を落としやすい。

この計画では、tool の実行結果そのものは保持しつつ、LLM に渡す inline payload を小さくする。圧縮は token 節約だけでなく、agent が重要な失敗箇所を見つけやすくするために行う。

## 非目標

- ML 要約、embedding、学習ベースの relevance ranking。
- Python / Rust 実装の移植。
- Headroom proxy、CCR retrieval、cross-agent memory の導入。
- evidence body や圧縮前 segment 本文の永続保存。
- provider request / response proxy の実装。
- UI の大規模変更。
- tool policy の緩和。

## 採用するコンセプト

### 0. Default to compressed context

既存 tool は同じ最小引数で呼べるが、返却結果の default は context 圧縮版にする。LLM が `read_file` や `run_command` を通常通り呼んだ場合、巨大な本文や再読は圧縮・省略される。

従来に近い使用感は `fresh`、`compressionMode: "off"`、明示的な line range、smaller scope を escape hatch として用意する。常時長い説明を tool result に混ぜず、案内は次のように LLM が困る可能性が高い場合だけ短く出す。

- cache marker を返したが、全文が必要そうな場合。
- command output を圧縮し、重要箇所だけでは次の判断に不足しそうな場合。
- search / diff が巨大で、より狭い scope を指定した方がよい場合。
- compression ratio が高く、omitted 部分を確認しないと編集や判断が危険な場合。

つまり、デフォルトは「従来通りの最小引数で呼べる context 圧縮版」。困った時だけ「この option で全文・範囲・非圧縮を取れる」と伝える。

### 1. Tool-specific compression profile

tool ごとに圧縮方針を分ける。

初期 profile:

| Tool | Strategy | 初期方針 |
| --- | --- | --- |
| `read_file` | file read cache / windowing | 初回の巨大ファイルは圧縮ビュー、同一ファイル同一内容の再読は marker、従来本文は `compressionMode: "off"` または範囲指定 |
| `search_files` | search result compression | file ごとに first / last / error-like match を保持する |
| `run_command` | command output compression | error / stack trace / summary / tail を優先保持する |
| `run_verification` | verification log compression | failed test / command / summary / tail を優先保持する |
| `inspect_structure` | structure inspection | TypeScript symbol / JSON shape を本文なしで返す |
| `git_diff` | diff compression | file list、hunk header、add/delete summary、変更本文の一部を保持する |
| `git_status` | passthrough | 通常短いので圧縮しない |
| `apply_patch` / `replace_content` | passthrough | 編集結果は圧縮せず、失敗 message を保持する |

### 2. Re-read marker for `read_file`

同一 run / session 内で同じ絶対パスかつ同じ content hash のファイルを再読した場合、全文を再送せず marker を返す。

返却例:

```json
{
  "status": "cached",
  "filePath": "api/services/worker-tools/read-file.ts",
  "totalLines": 121,
  "contentHash": "sha256:...",
  "note": "File is unchanged since the previous read in this run. Use fresh=true or a line range if the content is needed again."
}
```

重要な制約:

- `fresh: true` を追加し、必要時は必ず再読できる。
- `startLine` / `endLine` が指定された場合は、その範囲を返す。既読 cache は「全文再送の抑制」に使い、明示範囲の read を妨げない。
- read-before-edit gate は維持する。marker だけを read 済み扱いにするかは別途判断し、初期実装では初回の actual content read のみを read 済み根拠にする。

### 3. Deterministic command output compressor

`run_command` の出力は、単純な先頭切り詰めから次の保持順へ変える。

保持優先度:

1. command、cwd、exitCode、timeout、classification。
2. stderr の error / fatal / exception / failed / panic / traceback / stack trace 周辺。
3. stdout の failed test、summary、diagnostic line。
4. 最初の数行。
5. 最後の数十行。
6. 残りは omission marker。

圧縮例:

```text
[command-output-compressed]
command: pnpm test
exitCode: 1
strategy: log_error_tail
originalChars: 84213
returnedChars: 11840

--- stderr: important lines ---
...

--- stdout: summary ---
...

--- tail ---
...

[omitted 72173 chars; full output artifact: /tmp/nightworkers-command-artifacts/...json]
```

### 4. Structure inspection for code and JSON

`read_file` の前段として、本文を読まずに構造だけを読む tool を追加する。tool 名は初期案として `inspect_structure` とする。

この tool は圧縮 tool ではない。巨大ファイルを読む前に locator を得て、必要な範囲だけ `read_file` へ進むための探索 tool である。

対象:

| Input kind | Output focus | 初期実装 |
| --- | --- | --- |
| TypeScript / TSX / JavaScript / JSX | symbol | TypeScript compiler API で import / export / function / class / method / interface / type / const / test を読む |
| JSON | shape | `JSON.parse` で key path / value type / array sample shape / item count を読む |

TypeScript code symbol と JSON shape は混同しない。code は「識別・参照・編集範囲」を返し、JSON は「キー配置・型・配列構造」を返す。

TypeScript symbol 返却例:

```json
{
  "filePath": "api/services/worker-tools/run-command.ts",
  "kind": "code",
  "language": "typescript",
  "symbols": [
    {
      "name": "runCommandTool",
      "kind": "function",
      "exported": true,
      "startLine": 98,
      "endLine": 238,
      "signature": "runCommandTool(input: RunCommandInput): Promise<WorkerToolResult<RunCommandOutput>>"
    }
  ]
}
```

JSON shape 返却例:

```json
{
  "filePath": "package.json",
  "kind": "json",
  "rootType": "object",
  "paths": [
    { "path": "$.scripts.verify", "type": "string" },
    { "path": "$.dependencies", "type": "object", "keys": 31 },
    { "path": "$.devDependencies", "type": "object", "keys": 26 }
  ]
}
```

JSON shape の制約:

- value 本文は返さない。ただし短い primitive は option で preview 可能にする。
- array は全件展開しない。件数、先頭数件の shape、union type を返す。
- parse error は、エラー位置と周辺 locator を返す。
- JSONC は初期対象外。必要なら後続で `tsconfig.json` などに限り対応する。

### 5. Full output artifact remains available

圧縮した場合も、既存の artifact 出力は維持する。LLM inline payload は圧縮版、人間や後続 tool が必要なら artifact path を参照できる。

永続 DB に本文は保存しない。保存または event payload に含めてよいものは次に限定する。

- tool name
- strategy
- original chars / returned chars
- original line count / returned line count
- truncated / compressed flag
- artifact path
- content hash
- locator metadata

### 6. Compression should be opt-out and measurable

圧縮は安全側に倒す。

- 短い出力は passthrough。
- 圧縮後に十分小さくならなければ passthrough。
- `fresh` や `compressionMode: "off"` で明示的に解除できる。ただし通常の tool description や短い結果に毎回表示しない。
- escape hatch の案内は、圧縮・cache marker・omission が実際に起きた結果にだけ含める。
- tool result payload に `compression` metadata を付け、あとから効果を測れる。

### 7. Keep implementation files small

実装ファイルは概ね 600 行以内に収める。600 行を超えそうな場合は、機能追加前に責務単位で分割する。

この機能は `read_file`、`run_command`、`search_files`、`git_diff` へ広がるため、単一の巨大な `output-compression.ts` に集約しない。共通型、dispatch、strategy 実装、pattern helper、test fixture は分ける。

分割基準:

- 共通型と metadata builder。
- tool 名から strategy を選ぶ router。
- `read_file` cache marker。
- command / log output compression。
- search result compression。
- diff compression。
- artifact / omission marker helper。

## 全体設計

### 追加 module

```text
api/services/worker-tools/output-compression/
  types.ts
  router.ts
  metadata.ts
  read-cache.ts
  command-output.ts
  search-results.ts
  diff-output.ts
  markers.ts
  index.ts

api/services/worker-tools/structure-inspection/
  types.ts
  inspect-structure.ts
  code-symbols.ts
  json-shape.ts
  line-locator.ts
  index.ts

tests/services.worker-tool-output-compression.test.ts
tests/services.worker-tool-structure-inspection.test.ts
```

Slice ごとの実装時も、1 ファイルに新しい strategy を足し続けない。既存 file が 600 行前後に近づいたら、新しい module に切る。

想定 interface:

```ts
export type ToolOutputCompressionStrategy =
  | 'passthrough'
  | 'read_cache_marker'
  | 'search_result_subset'
  | 'log_error_tail'
  | 'verification_failure_summary'
  | 'diff_hunk_subset';

export interface ToolOutputCompressionMetadata {
  compressed: boolean;
  strategy: ToolOutputCompressionStrategy;
  originalChars: number;
  returnedChars: number;
  originalLines?: number;
  returnedLines?: number;
  artifactPath?: string;
  contentHash?: string;
  omittedReason?: string;
}
```

既存 `WorkerToolResult<T>` は破壊せず、payload ごとに `compression?: ToolOutputCompressionMetadata` を追加する。型変更の影響が大きい場合は、まず `RunCommandOutput` / `ReadFileOutput` のみに追加する。

### Read cache scope

初期実装では in-memory run scope とする。

候補:

- `dispatchWorkerTool` に `toolContext` を追加し、`readCache` を渡す。
- `NativeAgentRuntime` の run execution scope に cache を持たせる。
- 既存の `readFiles` set と混ぜない。read-before-edit 用の read tracking と、context compression 用の cache は目的が違う。

cache entry:

```ts
interface ReadFileCacheEntry {
  absolutePath: string;
  contentHash: string;
  totalLines: number;
  tokenEstimate: number;
  firstReadAt: string;
  lastReadAt: string;
}
```

### Command output classification

`run_command` の既存 `classification` は safety 用なので、圧縮 strategy とは分ける。

追加分類:

- `test_log`
- `install_log`
- `git_output`
- `search_output`
- `generic_log`

初期実装は command string と出力 pattern の deterministic rule で十分。

## 実装 slice

### Slice 1: Metadata and shared compressor shell

対象:

- `api/services/worker-tools/types.ts`
- `api/services/worker-tools/output-compression/types.ts`
- `api/services/worker-tools/output-compression/metadata.ts`
- `api/services/worker-tools/output-compression/router.ts`
- unit tests

完了条件:

- `ToolOutputCompressionMetadata` が定義される。
- 短い content は passthrough になる。
- original / returned chars が計測される。
- 各実装ファイルは概ね 600 行以内に収まる。
- `pnpm verify` が通る。

### Slice 2: `read_file` re-read marker

対象:

- `api/services/worker-tools/read-file.ts`
- `api/services/worker-tools/dispatcher.ts`
- `api/services/worker-tools/output-compression/read-cache.ts`
- worker tool tests

完了条件:

- 初回 read でも巨大ファイルは圧縮ビューを返す。
- 従来通りの content は `compressionMode: "off"` または line range で返す。
- 同一 run で同一内容を再読すると marker を返す。
- `fresh: true` は content を返す。
- `startLine` / `endLine` 指定は cache marker ではなく指定範囲を返す。
- path policy と read-before-edit gate は壊れない。

### Slice 3: `run_command` semantic compression

対象:

- `api/services/worker-tools/run-command.ts`
- `api/services/worker-tools/output-compression/command-output.ts`
- `api/services/worker-tools/output-compression/markers.ts`
- worker tool tests

完了条件:

- 長い成功ログは head / tail / summary に圧縮される。
- 長い失敗ログは error / stack trace / summary / tail を保持する。
- stdout と stderr は別々に圧縮され、どちらに重要行があるかを失わない。
- artifact path は従来通り残る。
- timeout / non-zero exit の error message は圧縮で消えない。

### Slice 4: `search_files` and `git_diff` subset compression

対象:

- `api/services/worker-tools/search-files.ts`
- `api/services/worker-tools/git.ts`
- `api/services/worker-tools/output-compression/search-results.ts`
- `api/services/worker-tools/output-compression/diff-output.ts`
- worker tool tests

完了条件:

- `search_files` は file ごとの first / last / error-like match を保持する。
- `git_diff` は file summary と hunk header を保持し、巨大 diff の本文を制限する。
- 明示的な smaller scope を user / agent に促す marker を出す。

### Slice 5: `inspect_structure` for code symbols and JSON shape

対象:

- `api/services/worker-tools/dispatcher.ts`
- `api/services/worker-tools/structure-inspection/types.ts`
- `api/services/worker-tools/structure-inspection/inspect-structure.ts`
- `api/services/worker-tools/structure-inspection/code-symbols.ts`
- `api/services/worker-tools/structure-inspection/json-shape.ts`
- `api/services/worker-tools/structure-inspection/line-locator.ts`
- worker tool tests

完了条件:

- TypeScript / TSX / JavaScript / JSX の symbol 一覧が本文なしで返る。
- JSON file の shape が key path / type / array count / object key count として返る。
- JSON value 本文は default で返さない。
- parse error は tool failure ではなく、構造化された parse diagnostics として返る。
- 返却された locator から `read_file` の明示範囲取得へ進める。
- 各実装ファイルは概ね 600 行以内に収まる。

### Slice 6: Runtime and ledger visibility

対象:

- run event payload construction
- ThreadTimeline 表示は必要最小限
- JSONL export

完了条件:

- tool result event から、圧縮有無と strategy が分かる。
- 本文を永続 DB に増やさない。
- replay/import は圧縮 metadata を失わない。
- `inspect_structure` の結果は locator / metadata として扱い、本文保存を増やさない。

## 受け入れ条件

- ML 要約、embedding、学習ベースの scoring を使っていない。
- 圧縮は deterministic で、同じ入力から同じ出力になる。
- 既存 tool は従来と同じ最小引数で呼べるが、default result は context 圧縮版になる。
- escape hatch の案内は、圧縮や cache marker によって LLM が追加取得を必要としそうな時だけ出る。
- 圧縮関連の実装ファイルは概ね 600 行以内に収まり、strategy 追加時も責務単位で分割される。
- 圧縮前の本文を DB に永続保存しない。
- `inspect_structure` は code symbol と JSON shape を分けて返し、JSON value 本文を default で返さない。
- `inspect_structure` の locator から `read_file` の範囲取得へ接続できる。
- 重要な error / failed / fatal / exception / panic / traceback は圧縮後にも残る。
- `read_file` の明示範囲取得と `fresh` が常に escape hatch になる。
- `run_command` の artifact path が残り、必要時に全文を確認できる。
- 既存 tool policy と read-before-edit gate が維持される。
- `pnpm verify` が通る。

## テスト方針

Unit:

- read cache marker / fresh / range read。
- command output compressor の long success / long failure / stack trace / timeout。
- search result subset。
- diff subset。
- TypeScript / TSX symbol extraction。
- JSON object / array shape extraction。
- JSON parse diagnostics。

Integration:

- `dispatchWorkerTool` 経由で read cache が run scope に閉じること。
- `run_command` の non-zero exit で compressed payload と error object が両方残ること。
- `inspect_structure` の locator を使って `read_file` で該当範囲を読めること。
- JSONL export に compression metadata が含まれること。

Regression:

- read-before-edit gate が marker だけで bypass されないこと。
- policy denied tool result は圧縮されず、denial message がそのまま残ること。

## 実装順

1. Slice 1
2. Slice 2
3. Slice 3
4. Slice 4
5. Slice 5
6. Slice 6

最初の価値は `read_file` と `run_command` で出る。`inspect_structure` は巨大な code / JSON を読む前の探索効率に効くため、`search_files` / `git_diff` と同じ段階で追加する。

## Headroom から採用しない判断

Headroom の ML / Kompress-base / proxy / CCR は、この計画では採用しない。

理由:

- NightWorkers の tool output は coding agent の判断材料であり、説明不能な要約で失う情報のコストが高い。
- TypeScript 実装に閉じたい。
- 既に contextStill が durable knowledge の責務を持っているため、Headroom の cross-agent memory / evidence store を重ねる必要がない。
- まずは deterministic rule と artifact fallback だけで、レビュー可能な改善にする。
