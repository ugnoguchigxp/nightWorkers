import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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

export const initiallyImplementedJobTypes = ['minor_code_edit'] as const satisfies JobType[];

export const jobTypeDescriptions: Record<JobType, string> = {
  general_answer: '軽い回答。実行やリポジトリ変更を伴わない場合。',
  planning: '実装前の計画、分解、方針整理。',
  minor_code_edit: '小さい修正、小さい新規作成、少数ファイルの明確な変更。',
  major_code_edit: '複数 Todo に分解すべき大きい変更。初期実装では実行対象外。',
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

export type ToolDefinition = {
  name: WorkerToolName | 'select_job_type' | 'finalize_answer';
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
  apply_patch: {
    name: 'apply_patch',
    description: 'unified diff で新規作成または構造的な変更を行う。',
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
    description: '検証や確認のためにコマンドを実行する。',
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
  run_verification: {
    name: 'run_verification',
    description: '明示的な検証コマンドを実行する。',
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
  finalize_answer: {
    name: 'finalize_answer',
    description: 'ユーザーへの最終回答を確定する。',
    inputSchema: objectSchema({ message: { type: 'string' } }, ['message']),
  },
} satisfies Record<string, ToolDefinition>;

export type SupervisorToolName = keyof typeof toolRegistry;

const allowedToolsByJobType: Record<JobType, SupervisorToolName[]> = {
  general_answer: ['finalize_answer'],
  planning: ['list_dir', 'read_file', 'search_files', 'git_status', 'finalize_answer'],
  minor_code_edit: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'select_job_type',
    'finalize_answer',
  ],
  major_code_edit: ['finalize_answer'],
  script_code_edit: ['finalize_answer'],
  review: ['git_status', 'git_diff', 'read_file', 'search_files', 'run_command', 'finalize_answer'],
  investigation: [
    'list_dir',
    'read_file',
    'search_files',
    'run_command',
    'git_status',
    'finalize_answer',
  ],
  runtime_debug: ['read_file', 'search_files', 'run_command', 'git_status', 'finalize_answer'],
  test_and_verification: [
    'run_verification',
    'run_command',
    'read_file',
    'search_files',
    'finalize_answer',
  ],
  research: ['search_web', 'fetch_content', 'read_file', 'finalize_answer'],
  docs: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  git_release: ['git_status', 'git_diff', 'run_command', 'finalize_answer'],
  code: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  refactor: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  test: [
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_verification',
    'run_command',
    'finalize_answer',
  ],
  config: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  dependency: [
    'read_file',
    'search_files',
    'run_command',
    'apply_patch',
    'replace_content',
    'finalize_answer',
  ],
  data_migration: [
    'list_dir',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'finalize_answer',
  ],
  blueprint: ['read_file', 'search_files', 'apply_patch', 'replace_content', 'finalize_answer'],
  ui_ux: ['read_file', 'search_files', 'apply_patch', 'replace_content', 'finalize_answer'],
  git: ['git_status', 'git_diff', 'run_command', 'finalize_answer'],
  release: ['git_status', 'git_diff', 'run_command', 'read_file', 'finalize_answer'],
};

export function getAllowedToolsForJobType(jobType: JobType): ToolDefinition[] {
  return allowedToolsByJobType[jobType].map((name) => toolRegistry[name]);
}

export function getExecutableWorkerToolName(name: string): WorkerToolName | null {
  if (
    name === 'list_dir' ||
    name === 'read_file' ||
    name === 'search_files' ||
    name === 'search_web' ||
    name === 'fetch_content' ||
    name === 'apply_patch' ||
    name === 'replace_content' ||
    name === 'run_command' ||
    name === 'run_verification' ||
    name === 'git_status' ||
    name === 'git_diff'
  ) {
    return name;
  }
  return null;
}

const jobTypeSelectionSchema = z
  .object({
    jobType: z.enum(jobTypes),
  })
  .strict();

const toolCallEnvelopeSchema = z
  .object({
    toolCall: z
      .object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  })
  .strict();

export type JobTypeSelection = z.infer<typeof jobTypeSelectionSchema>;
export type AgentToolCallEnvelope = z.infer<typeof toolCallEnvelopeSchema>;

export function buildResponseJsonSchema(round?: 1 | 2) {
  if (round === 1) {
    return {
      name: 'schema_first_round_1_job_type',
      strict: true,
      schema: {
        type: 'object',
        required: ['jobType'],
        additionalProperties: false,
        properties: {
          jobType: { type: 'string', enum: [...jobTypes] },
        },
      },
    };
  }
  return {
    name: 'schema_first_round_2_tool_call',
    strict: true,
    schema: {
      type: 'object',
      required: ['toolCall'],
      additionalProperties: false,
      properties: {
        toolCall: {
          type: 'object',
          required: ['name', 'arguments'],
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            arguments: { type: 'object' },
          },
        },
      },
    },
  };
}

export function parseSupervisorOutput(raw: unknown, round?: 1 | 2) {
  return round === 1 ? jobTypeSelectionSchema.parse(raw) : toolCallEnvelopeSchema.parse(raw);
}

export function validateToolCallForJobType(input: {
  jobType: JobType;
  toolCall: AgentToolCallEnvelope['toolCall'];
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

export function loadFlatSkill(jobType: JobType, directory = defaultFlatSkillDirectory()): string {
  const filePath = path.join(directory, `${jobType}.md`);
  return fs.readFileSync(filePath, 'utf8');
}

export function defaultFlatSkillDirectory(): string {
  return path.join(process.cwd(), 'api/services/supervisor/skills/flat');
}

export function buildRound1JobTypePrompt(projectRoot: string): string {
  return [
    'jobType を1つだけ選んでください。',
    'JSON のみ。rationale、plan、toolCall、phase、workflow、routingHypothesis は出さない。',
    '',
    `プロジェクトルート: ${projectRoot}`,
    '',
    '[Job Types]',
    jobTypes.map((jobType) => `- ${jobType}: ${jobTypeDescriptions[jobType]}`).join('\n'),
    '',
    '[Tool Overview]',
    renderToolDefinitions(Object.values(toolRegistry)),
    '',
    '[Output Schema]',
    '{ "jobType": "<job type>" }',
  ].join('\n');
}

export function buildRound2ToolCallPrompt(input: {
  projectRoot: string;
  jobType: JobType;
  skill: string;
  tools: ToolDefinition[];
}): string {
  return [
    `jobType=${input.jobType}`,
    '次の toolCall を1つだけ返してください。',
    'JSON のみ。rationale、plan、phase、workflow、routingHypothesis、finalResponse、expectedEvidence は出さない。',
    '完了したと判断したら finalize_answer を返す。',
    'finalize_answer.message でプロジェクト内のファイルに触れる場合は、プロジェクトルートからの相対パスで書く。',
    '',
    `プロジェクトルート: ${input.projectRoot}`,
    '',
    '[Skill]',
    input.skill,
    '',
    '[Allowed Tools]',
    renderToolDefinitions(input.tools),
    '',
    '[Output Schema]',
    '{ "toolCall": { "name": "<tool>", "arguments": { } } }',
  ].join('\n');
}
