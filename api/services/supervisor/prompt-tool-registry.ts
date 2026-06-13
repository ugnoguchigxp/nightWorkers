import {
  nightWorkersImportProjectInputSchema,
  nightWorkersReadCurrentSpecificationInputSchema,
  nightWorkersTodoListInputSchema,
  toNightWorkersJsonSchema,
} from '../../mcp/nightworkers-tool-manifest';
import type { WorkerToolName } from '../tool-policy/types';

export const jobTypes = [
  'general_answer',
  'planning',
  'minor_code_edit',
  'major_code_edit',
  'script_code_edit',
  'review',
  'investigation',
  'runtime_debug',
  'test_and_verification',
  'research',
  'docs',
  'git_release',
  'code',
  'refactor',
  'test',
  'config',
  'dependency',
  'data_migration',
  'blueprint',
  'ui_ux',
  'git',
  'release',
] as const;

export type JobType = (typeof jobTypes)[number];

export const initiallyImplementedJobTypes = [
  'minor_code_edit',
  'major_code_edit',
] as const satisfies JobType[];

export const jobTypeDescriptions: Record<JobType, string> = {
  general_answer: '軽い回答。実行やリポジトリ変更を伴わない場合。',
  planning: '実装前の計画、分解、方針整理。',
  minor_code_edit: '小さい修正、小さい新規作成、少数ファイルの明確な変更。',
  major_code_edit:
    '複数 Todo に分解すべき大きい変更。外部ディレクトリテンプレートのコピー、外部リポジトリーの clone や fork、migration、command、documentation、verification が混ざる可能性がある作業。',
  script_code_edit: '調査用の一時スクリプト。初期実装では実行対象外。',
  review: 'コード、ドキュメント、差分のレビュー。',
  investigation: '原因調査、ログ確認、事実確認。',
  runtime_debug: '実行時問題、ログ、再現、環境確認。',
  test_and_verification: 'テスト、検証、確認コマンド実行。',
  research: '外部情報や最新情報を伴う調査。',
  docs: 'ドキュメント作成、修正、レビュー。',
  git_release: 'git 状態確認、コミット、リリース準備。',
  code: 'コード関連の補助分類。初期実装では直接実行しない。',
  refactor: 'リファクタリング分類。初期実装では直接実行しない。',
  test: 'テスト分類。初期実装では直接実行しない。',
  config: '設定ファイル関連の分類。初期実装では直接実行しない。',
  dependency: '依存関係関連の分類。初期実装では直接実行しない。',
  data_migration: 'データ移行関連の分類。初期実装では直接実行しない。',
  blueprint: '画面案や Blueprint 関連の分類。初期実装では直接実行しない。',
  ui_ux: 'UI/UX 関連の分類。初期実装では直接実行しない。',
  git: 'git 操作分類。初期実装では直接実行しない。',
  release: 'リリース分類。初期実装では直接実行しない。',
};

export type TodoToolName = 'todo_list';

export type ToolDefinition = {
  name:
    | WorkerToolName
    | 'read_procedure'
    | 'search_procedure'
    | 'select_job_type'
    | TodoToolName
    | 'finalize_answer';
  description: string;
  inputSchema: Record<string, unknown>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
});

export const toolRegistry = {
  list_dir: {
    name: 'list_dir',
    description: 'リポジトリ相対ディレクトリのファイル一覧を取得する。',
    inputSchema: objectSchema({
      relativePath: { type: 'string' },
      recursive: { type: 'boolean' },
      maxEntries: { type: 'number' },
    }),
  },
  read_file: {
    name: 'read_file',
    description: 'リポジトリ相対パスのファイル内容を読む。',
    inputSchema: objectSchema(
      {
        filePath: { type: 'string' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
        compressionMode: { type: 'string', enum: ['auto', 'off'] },
      },
      ['filePath']
    ),
  },
  read_current_specification: {
    name: 'read_current_specification',
    description:
      'NightWorkers内蔵の現在タスク仕様書を読む。taskId を省略すると現在のTask IDを使う。git上のファイルではなく、Specification Artifact の最新 draft_spec Markdown だけを返す。Questionnaire / Blueprint / DB Design は直接返さない。',
    inputSchema: toNightWorkersJsonSchema(nightWorkersReadCurrentSpecificationInputSchema),
  },
  search_files: {
    name: 'search_files',
    description: 'リポジトリ内の文字列検索を行う。',
    inputSchema: objectSchema(
      {
        query: { type: 'string' },
        glob: { type: 'string' },
      },
      ['query']
    ),
  },
  search_web: {
    name: 'search_web',
    description: '最新情報や外部情報が必要な場合に Web 検索する。',
    inputSchema: objectSchema(
      {
        query: { type: 'string' },
        maxResults: { type: 'number' },
      },
      ['query']
    ),
  },
  fetch_content: {
    name: 'fetch_content',
    description: 'URL の本文を取得する。',
    inputSchema: objectSchema(
      {
        url: { type: 'string' },
        maxChars: { type: 'number' },
      },
      ['url']
    ),
  },
  import_project: {
    name: 'import_project',
    description:
      'Project import の単一入口。新規雛形は source=starter と stack/variant、任意の Git repository 取り込みは source=git と repoUrl を渡す。run_command git clone で代替しない。',
    inputSchema: toNightWorkersJsonSchema(nightWorkersImportProjectInputSchema),
  },
  copy_directory: {
    name: 'copy_directory',
    description:
      '許可済みの外部ディレクトリテンプレートからプロジェクト内へコピーする。コピー元がプロジェクト外の場合は事前に externalAllowedPaths で許可されている必要がある。',
    inputSchema: objectSchema(
      {
        sourcePath: { type: 'string' },
        targetPath: { type: 'string' },
        overwrite: { type: 'boolean' },
        exclude: { type: 'array', items: { type: 'string' } },
      },
      ['sourcePath']
    ),
  },
  apply_patch: {
    name: 'apply_patch',
    description: 'patchContent に指定した差分で新規作成または構造的な変更を行う。',
    inputSchema: objectSchema({ patchContent: { type: 'string' } }, ['patchContent']),
  },
  replace_content: {
    name: 'replace_content',
    description: '既存ファイル内の限定された文字列を置換する。',
    inputSchema: objectSchema(
      {
        filePath: { type: 'string' },
        needle: { type: 'string' },
        replacement: { type: 'string' },
        mode: { type: 'string', enum: ['literal', 'regex'] },
        allowMultipleOccurrences: { type: 'boolean' },
      },
      ['filePath', 'needle', 'replacement']
    ),
  },
  run_command: {
    name: 'run_command',
    description:
      '検証や確認のためにコマンドを実行する。stdout/stderr は既定で全文を返す。出力が大きすぎる場合だけ compressionMode=auto を指定する。',
    inputSchema: objectSchema(
      {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutSeconds: { type: 'number' },
        compressionMode: { type: 'string', enum: ['auto', 'off'] },
      },
      ['command']
    ),
  },
  run_background_command: {
    name: 'run_background_command',
    description:
      '開発サーバー、watch、ログ監視など、起動したまま別作業へ進むための背景コマンドを開始する。',
    inputSchema: objectSchema(
      {
        command: { type: 'string' },
        cwd: { type: 'string' },
      },
      ['command']
    ),
  },
  run_verification: {
    name: 'run_verification',
    description:
      '明示的な検証コマンドを実行する。stdout/stderr は既定で全文を返す。出力が大きすぎる場合だけ compressionMode=auto を指定する。',
    inputSchema: objectSchema(
      {
        command: { type: 'string' },
        reason: { type: 'string' },
        cwd: { type: 'string' },
        timeoutSeconds: { type: 'number' },
        compressionMode: { type: 'string', enum: ['auto', 'off'] },
      },
      ['command']
    ),
  },
  git_status: {
    name: 'git_status',
    description: '作業ツリーの状態を確認する。',
    inputSchema: objectSchema({}),
  },
  git_diff: {
    name: 'git_diff',
    description: '現在の差分を確認する。',
    inputSchema: objectSchema({}),
  },
  read_procedure: {
    name: 'read_procedure',
    description:
      '必要なときだけ jobType に対応する procedure 要約を読む。リポジトリファイルは読み書きしない。',
    inputSchema: objectSchema(
      {
        jobType: { type: 'string', enum: [...jobTypes] },
      },
      ['jobType']
    ),
  },
  search_procedure: {
    name: 'search_procedure',
    description:
      '適切な procedure が不明なとき、利用可能な procedure 名と要約を検索する。リポジトリファイルは読み書きしない。',
    inputSchema: objectSchema(
      {
        query: { type: 'string' },
        maxResults: { type: 'number' },
      },
      ['query']
    ),
  },
  select_job_type: {
    name: 'select_job_type',
    description: '別の jobType に切り替える。',
    inputSchema: objectSchema(
      {
        jobType: { type: 'string', enum: [...jobTypes] },
        context: { type: 'string' },
      },
      ['jobType']
    ),
  },
  todo_list: {
    name: 'todo_list',
    description:
      'Run 内部 TodoList を単一 JSON operation で管理する。operation=list/replace/start/done/block/fail。done は次の pending Todo を自動で running にする。',
    inputSchema: toNightWorkersJsonSchema(nightWorkersTodoListInputSchema),
  },
  finalize_answer: {
    name: 'finalize_answer',
    description: 'ユーザーへの最終回答を確定する。',
    inputSchema: objectSchema({ message: { type: 'string' } }, ['message']),
  },
} satisfies Record<string, ToolDefinition>;

export type SupervisorToolName = keyof typeof toolRegistry;

const allowedToolsByJobType: Record<JobType, SupervisorToolName[]> = {
  general_answer: ['finalize_answer'],
  planning: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'git_status',
    'finalize_answer',
  ],
  minor_code_edit: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'copy_directory',
    'apply_patch',
    'replace_content',
    'run_command',
    'select_job_type',
    'finalize_answer',
  ],
  major_code_edit: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'todo_list',
    'list_dir',
    'read_file',
    'search_files',
    'import_project',
    'copy_directory',
    'apply_patch',
    'replace_content',
    'run_command',
    'run_background_command',
    'run_verification',
    'git_status',
    'git_diff',
    'select_job_type',
    'finalize_answer',
  ],
  script_code_edit: ['read_procedure', 'search_procedure', 'finalize_answer'],
  review: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'git_status',
    'git_diff',
    'read_file',
    'search_files',
    'run_command',
    'finalize_answer',
  ],
  investigation: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'run_command',
    'run_background_command',
    'git_status',
    'finalize_answer',
  ],
  runtime_debug: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'run_command',
    'run_background_command',
    'git_status',
    'finalize_answer',
  ],
  test_and_verification: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'run_verification',
    'run_command',
    'read_file',
    'search_files',
    'finalize_answer',
  ],
  research: [
    'read_procedure',
    'search_procedure',
    'search_web',
    'fetch_content',
    'read_file',
    'finalize_answer',
  ],
  docs: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  git_release: [
    'read_procedure',
    'search_procedure',
    'git_status',
    'git_diff',
    'run_command',
    'finalize_answer',
  ],
  code: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  refactor: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  test: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_verification',
    'run_command',
    'finalize_answer',
  ],
  config: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  dependency: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'run_command',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  data_migration: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  blueprint: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  ui_ux: [
    'read_procedure',
    'search_procedure',
    'read_current_specification',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  git: [
    'read_procedure',
    'search_procedure',
    'git_status',
    'git_diff',
    'run_command',
    'finalize_answer',
  ],
  release: [
    'read_procedure',
    'search_procedure',
    'git_status',
    'git_diff',
    'run_command',
    'read_file',
    'finalize_answer',
  ],
};

export function getAllowedToolsForJobType(jobType: JobType): ToolDefinition[] {
  return allowedToolsByJobType[jobType].map((name) => toolRegistry[name]);
}

export function getExecutableWorkerToolName(name: string): WorkerToolName | null {
  if (
    name === 'list_dir' ||
    name === 'read_file' ||
    name === 'read_current_specification' ||
    name === 'search_files' ||
    name === 'search_web' ||
    name === 'fetch_content' ||
    name === 'import_project' ||
    name === 'copy_directory' ||
    name === 'apply_patch' ||
    name === 'replace_content' ||
    name === 'run_command' ||
    name === 'run_background_command' ||
    name === 'run_verification' ||
    name === 'git_status' ||
    name === 'git_diff'
  ) {
    return name;
  }
  return null;
}

export function validateToolCallForJobType(input: {
  jobType: JobType;
  toolCall: { name: string; arguments: Record<string, unknown> };
}): { ok: true; tool: ToolDefinition } | { ok: false; message: string } {
  const tool = Object.values(toolRegistry).find(
    (candidate) => candidate.name === input.toolCall.name
  );
  if (!tool) return { ok: false, message: `Unknown tool: ${input.toolCall.name}` };
  const allowed = getAllowedToolsForJobType(input.jobType).some(
    (candidate) => candidate.name === tool.name
  );
  if (!allowed)
    return { ok: false, message: `Tool is not allowed for ${input.jobType}: ${tool.name}` };
  return { ok: true, tool };
}

export function renderToolDefinitions(tools: ToolDefinition[]): string {
  return tools
    .map((tool) =>
      [
        `- ${tool.name}: ${tool.description}`,
        `  inputSchema: ${JSON.stringify(tool.inputSchema)}`,
      ].join('\n')
    )
    .join('\n');
}
