# Native/API diff context control plan

## 背景

Native/API runner の LLM コードレビューでは、`git_diff` がレビュー対象を探す導線として必要になる。一方で、テンプレート import 直後の unborn repository や未追跡ファイルが多い状態では、`git_diff` がテンプレート全体を provider context に載せ、context 圧縮後にも再取得されて prompt が急増する。

第 1 段階として、starter import 後に `LICENSE.md` を削除してから initial commit を作り、以後の diff を実装差分だけに限定する。これで解消しない場合に、以下の第 2-4 段階を実装する。

## 2. git_diff の段階化

### 目的

`git_diff` を最初から raw diff 本文を返す tool にせず、レビュー対象発見用の軽量 summary と、必要箇所だけ読む raw diff に分ける。

### 方針

- `git_diff` の既定出力は changed file summary にする。
- summary には `name-status`、`diff --stat`、追加/削除行数、untracked のファイル名だけを含める。
- raw diff は `filePath` 指定、または明示オプション付きの限定取得にする。
- raw diff には上限を設け、上限超過時は「省略されたファイル」「取得方法」を返す。
- unborn repository では、raw untracked diff の合成を既定で行わず、untracked summary に留める。

### 期待する tool contract

```ts
type GitDiffInput = {
  repoRoot: string;
  mode?: 'summary' | 'file' | 'raw';
  filePath?: string;
  maxBytes?: number;
};
```

既定は `mode: 'summary'` とする。既存互換が必要な間は、Native/API runner の prompt 側で summary-first を指示し、UI や旧 runtime は raw mode を明示する移行期間を置く。

## 3. レビュー用差分パケット化

### 目的

LLM コードレビューで「全部の diff を読む」動きではなく、変更ファイルの種類とリスクに応じて読む順序を作る。

### 方針

- `git_diff summary` から `ReviewDiffPacket` を作る。
- packet には raw diff 本文ではなく、変更ファイル一覧、ファイル種別、変更規模、候補リスクだけを入れる。
- runner は packet を postImport/currentTodo と同様に小さい history item として保持する。
- 圧縮後は raw diff を再取得する前に、保持済み packet を見て必要ファイルだけ読む。
- LLM コードレビュー procedure では、最初に summary packet を見て、次に高リスクファイルだけ raw diff を要求する。

### ReviewDiffPacket 案

```ts
type ReviewDiffPacket = {
  generatedAt: string;
  baseRef: string | null;
  hasHead: boolean;
  changedFiles: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
    additions?: number;
    deletions?: number;
    category: 'source' | 'test' | 'config' | 'docs' | 'lockfile' | 'asset' | 'unknown';
    riskHint: 'high' | 'medium' | 'low';
  }>;
  totals: {
    files: number;
    additions?: number;
    deletions?: number;
  };
};
```

### 検証

- starter import 直後の `git_diff` summary がテンプレート全体の raw diff を返さない。
- 実装後の review Todo で、最初の provider turn に raw diff 全文が入らない。
- 圧縮後に `ReviewDiffPacket` が残り、同じ巨大 diff を再取得しない。
- raw diff は LLM が選んだファイルだけに限定される。

## 4. LLM コードレビュー procedure の summary-first 化

### 目的

LLM コードレビューの手順を、raw diff 全文を最初に読む流れから、差分 summary と review state を起点に必要箇所だけ掘る流れへ変える。

### 方針

- `llm_code_review` procedure では、最初に `git_diff` summary または `ReviewDiffPacket` を確認する。
- raw diff を読む前に、変更ファイルを source / test / config / docs / lockfile / asset に分類する。
- 高リスクの source / config / test から優先して、必要なファイルだけ `git_diff(filePath)` または `read_file` で確認する。
- lockfile、generated asset、テンプレート由来の大きな既存ファイルは、summary 上で存在を確認し、直接影響がある場合だけ raw diff を読む。
- 圧縮後は、同じ raw diff を再取得する前に `ReviewDiffPacket` と current Todo を参照する。
- review の完了条件は「raw diff 全文を読んだこと」ではなく、「変更範囲を分類し、リスクの高い変更に対して根拠付き findings か no finding を出したこと」に置く。

### procedure 更新対象

- `api/services/supervisor/skills/builtin/references/` 配下の review / evidence 系 reference。
- Native/API runner の LLM コードレビュー Todo に渡す prompt guidance。
- `git_diff` tool contract を summary-first に変えた場合は、tool description と schema。

### 検証

- LLM コードレビュー Todo の最初の provider turn が raw diff 全文を含まない。
- review が `ReviewDiffPacket` から対象ファイルを選び、必要な raw diff だけを読む。
- 圧縮後に review 対象や分類結果を失わず、同じ巨大 diff を再取得しない。
- review 結果が変更ファイル分類と読んだ根拠に紐づく。

## 実装順序

1. starter import 後の initial commit で、テンプレート全体 diff を消す。
2. `git_diff` に summary/file/raw mode を追加し、Native/API runner では summary を既定にする。
3. `ReviewDiffPacket` を作り、圧縮後にも残る小さい review state として保持する。
4. LLM コードレビュー procedure を summary-first に更新する。
