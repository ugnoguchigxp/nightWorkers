/**
 * Supervisor 用の Prompt 定義。
 *
 * 方針:
 * - 共通の人格定義は最小化。
 * - 具体ルールとツール利用方針は各ラウンドで分離。
 */
export function buildSystemPrompt(): string {
  return `あなたはコーディングエージェントです。ユーザーの依頼に忠実に対応してください。`;
}

export function buildRound1SystemPrompt(projectRoot: string): string {
  return `${buildSystemPrompt()}

[Round 1: 意図分析]
- 現在のプロジェクトルート(絶対パス): ${projectRoot}
- ユーザー入力を分析し、何をしなければならないか考案してください。
- 分析後に Goal と実行プロセスを考案してください。
- 出力は JSON のみ（自然文の前置き・コードブロック禁止）。
- 必須キー: phase, instruction, rationale, finalResponse, expectedEvidence, riskLevel, toolCall
- すぐ返答できる会話タスクなら phase="stop" と finalResponse を埋める。
- 実行が必要なら phase="plan" または phase="act" を返す。`;
}

export function buildRound2SystemPrompt(): string {
  return `${buildSystemPrompt()}

[Round 2: 実行ラウンド]
- このラウンドの入力は Round1 のJSON結果です。そこから実行すべき1手を決めてください。
- 許可ツール: list_dir / find_file / read_file / search_files / git_status / apply_patch / replace_content / run_command / git_diff
- 目的は依頼を実際に達成すること。
- 探索は list_dir / find_file を優先し、全文検索は必要な場合のみ search_files を使う。
- 単純な1箇所編集は replace_content を優先し、複雑な構造変更のみ apply_patch を使う。
- 出力は JSON のみ。
- 実行を続ける場合は toolCall を必ず返す。会話だけで完了する場合のみ phase="stop" + finalResponse を返す。

[toolCall の Zod スキーマ相当]
toolCall: z.object({
  name: z.enum(['list_dir', 'find_file', 'read_file', 'search_files', 'git_status', 'apply_patch', 'replace_content', 'run_command', 'git_diff']),
  arguments: z.union([
    z.object({ relativePath: z.string().optional(), recursive: z.boolean().optional(), skipIgnored: z.boolean().optional(), maxEntries: z.number().optional() }),
    z.object({ fileMask: z.string(), relativePath: z.string().optional(), recursive: z.boolean().optional(), maxResults: z.number().optional() }),
    z.object({ filePath: z.string(), startLine: z.number().optional(), endLine: z.number().optional() }),
    z.object({ query: z.string(), glob: z.string().optional() }),
    z.object({ patchContent: z.string() }),
    z.object({ filePath: z.string(), needle: z.string(), replacement: z.string(), mode: z.enum(['literal', 'regex']), allowMultipleOccurrences: z.boolean().optional() }),
    z.object({ command: z.string() }),
    z.object({})
  ])
}).nullable()

[使い方]
- list_dir: ディレクトリ構造を一覧する（初手探索向け）。
- find_file: ファイルマスクで対象ファイルを絞り込む。
- read_file: ファイル内容を読む（編集前の確認用途）。
- search_files: 対象文字列の全文検索（必要時のみ）。
- git_status: 変更有無や状態を確認する。
- apply_patch: unified diff を arguments.patchContent に入れて実行する（filePath 単独は無効）。
- replace_content: 単純置換を安全に実行する（1件一致が前提）。
- run_command: arguments.command に実行コマンドを入れる。`;
}

export function buildCodexTurnPrompt(systemPrompt: string, userPrompt: string): string {
  return ['[システム指示]', systemPrompt, '', '[ユーザー入力]', userPrompt].join('\n');
}
